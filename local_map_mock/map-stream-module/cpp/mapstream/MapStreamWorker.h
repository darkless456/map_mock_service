#pragma once
/**
 * @file MapStreamWorker.h
 * @brief Self-contained MQTT streaming + PNG decode worker.
 *
 * Architecture overview:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  MapStreamWorker                                                │
 *   │                                                                 │
 *   │  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐      │
 *   │  │MqttClient│───▶│ Decode Thread │───▶│  FrameQueue      │      │
 *   │  │(Paho C)  │    │ (stb_image)  │    │  (triple-buffer) │      │
 *   │  └──────────┘    └──────────────┘    └────────┬─────────┘      │
 *   │                                               │                │
 *   │    StateCallback ◀──── state changes          │ acquire()      │
 *   │    FrameCallback ◀──── new frame ready ───────┘                │
 *   └─────────────────────────────────────────────────────────────────┘
 *               ▲                            │
 *               │  JS thread                 │  JS reads
 *               │  (via TurboModule)         ▼
 *            connect/start/stop         jsi::ArrayBuffer
 *            pause/resume
 *
 * This class is fully decoupled from JSI/TurboModule:
 *   - Takes plain C++ callbacks
 *   - Can be tested in a pure C++ test harness
 *   - TurboModule glue layer (MapStreamModule) wraps this class
 *
 * Thread model:
 *   - Paho MQTT runs its own internal network threads
 *   - Incoming messages are dispatched to our dedicated worker thread
 *     for decoding (to avoid blocking Paho's network I/O)
 *   - Decoded frames are published to the triple-buffer FrameQueue
 *   - Optional callback notifies consumer (JS) that a new frame is ready
 */

#include "MapTypes.h"
#include "MqttClient.h"
#include "FrameDecoder.h"
#include "FrameQueue.h"

#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <atomic>
#include <memory>
#include <functional>

namespace mapstream {

class MapStreamWorker {
 public:
  MapStreamWorker() = default;
  ~MapStreamWorker() { shutdown(); }

  // Non-copyable
  MapStreamWorker(const MapStreamWorker&) = delete;
  MapStreamWorker& operator=(const MapStreamWorker&) = delete;

  // ── Callback registration (set BEFORE connect) ──────────────────────

  void setOnStateChange(StateCallback cb)  { onStateChange_ = std::move(cb); }
  void setOnFrameReady(FrameCallback cb)   { onFrameReady_ = std::move(cb); }

  // ── Public API (called from JS thread via TurboModule) ──────────────

  /**
   * Initialize MQTT and begin connecting.
   * Starts the background decode worker thread.
   */
  bool connect(const MqttConfig& config) {
    std::lock_guard<std::mutex> lock(apiMutex_);
    if (state_ != StreamState::Disconnected) return false;

    config_ = config;
    shutdownRequested_.store(false);
    paused_.store(false);

    // Reset frame queue
    frameQueue_.reset();

    // Start decode worker thread
    workerThread_ = std::thread(&MapStreamWorker::decodeWorkerLoop, this);

    // Setup MQTT callbacks
    mqtt_ = std::make_unique<MqttClient>();
    mqtt_->setOnMessage([this](const uint8_t* data, size_t len) {
      onMqttMessage(data, len);
    });
    mqtt_->setOnConnect([this](bool ok, const std::string& reason) {
      onMqttConnect(ok, reason);
    });
    mqtt_->setOnDisconnect([this](const std::string& reason) {
      onMqttDisconnect(reason);
    });

    setState(StreamState::Connecting);
    if (!mqtt_->connect(config_)) {
      setState(StreamState::Error, "MQTT connect initiation failed");
      return false;
    }
    return true;
  }

  /**
   * Subscribe and start receiving frames.
   * Must be called after Connected state.
   */
  bool start() {
    std::lock_guard<std::mutex> lock(apiMutex_);
    if (state_ != StreamState::Connected && state_ != StreamState::Paused) return false;

    paused_.store(false);
    if (state_ == StreamState::Paused) {
      setState(StreamState::Streaming);
      return true;
    }

    setState(StreamState::Subscribing);
    if (!mqtt_->subscribe()) {
      setState(StreamState::Error, "Subscribe failed");
      return false;
    }
    setState(StreamState::Streaming);
    return true;
  }

  /**
   * Unsubscribe and stop receiving. Keeps connection alive.
   */
  bool stop() {
    std::lock_guard<std::mutex> lock(apiMutex_);
    if (state_ != StreamState::Streaming && state_ != StreamState::Paused) return false;

    paused_.store(false);
    mqtt_->unsubscribe();
    setState(StreamState::Connected);
    return true;
  }

  /**
   * Pause decoding. MQTT stays connected (heartbeat maintained).
   * Incoming messages are silently dropped to save CPU.
   */
  bool pause() {
    std::lock_guard<std::mutex> lock(apiMutex_);
    if (state_ != StreamState::Streaming) return false;

    paused_.store(true);
    setState(StreamState::Paused);
    return true;
  }

  /**
   * Resume decoding after pause.
   */
  bool resume() {
    std::lock_guard<std::mutex> lock(apiMutex_);
    if (state_ != StreamState::Paused) return false;

    paused_.store(false);
    setState(StreamState::Streaming);
    return true;
  }

  /**
   * Full teardown: unsubscribe, disconnect, stop worker thread.
   */
  void disconnect() {
    std::lock_guard<std::mutex> lock(apiMutex_);
    shutdownInternal();
    setState(StreamState::Disconnected);
  }

  // ── Frame access (called from JS thread) ────────────────────────────

  /**
   * Non-blocking: get the latest decoded frame, or nullptr.
   * Triple-buffer ensures no contention with the producer.
   */
  std::shared_ptr<MapFragment> acquireLatestFrame() {
    return frameQueue_.acquire();
  }

  StreamState getState() const {
    return state_.load(std::memory_order_acquire);
  }

 private:
  // ── Internal state ──────────────────────────────────────────────────
  std::mutex              apiMutex_;         // serializes public API calls
  std::atomic<StreamState> state_{StreamState::Disconnected};
  MqttConfig              config_;
  std::unique_ptr<MqttClient> mqtt_;

  // ── Decode worker ───────────────────────────────────────────────────
  std::thread                   workerThread_;
  std::mutex                    queueMutex_;
  std::condition_variable       queueCv_;
  std::queue<std::vector<uint8_t>> rawQueue_;  // pending undecoded payloads
  std::atomic<bool>             shutdownRequested_{false};
  std::atomic<bool>             paused_{false};

  // ── Triple-buffer output ────────────────────────────────────────────
  FrameQueue frameQueue_;

  // ── Callbacks ───────────────────────────────────────────────────────
  StateCallback onStateChange_;
  FrameCallback onFrameReady_;

  // ── State transition ────────────────────────────────────────────────
  void setState(StreamState newState, const std::string& detail = "") {
    state_.store(newState, std::memory_order_release);
    if (onStateChange_) {
      onStateChange_(newState, detail);
    }
  }

  // ── Shutdown helper (must hold apiMutex_) ───────────────────────────
  void shutdown() {
    std::lock_guard<std::mutex> lock(apiMutex_);
    shutdownInternal();
  }

  void shutdownInternal() {
    shutdownRequested_.store(true);

    // Disconnect MQTT
    if (mqtt_) {
      mqtt_->disconnect();
      mqtt_.reset();
    }

    // Wake up and join worker thread
    {
      std::lock_guard<std::mutex> lk(queueMutex_);
      queueCv_.notify_all();
    }
    if (workerThread_.joinable()) {
      workerThread_.join();
    }

    // Drain pending raw queue
    {
      std::lock_guard<std::mutex> lk(queueMutex_);
      std::queue<std::vector<uint8_t>> empty;
      rawQueue_.swap(empty);
    }
    frameQueue_.reset();
  }

  // ── MQTT message callback (Paho network thread) ─────────────────────
  void onMqttMessage(const uint8_t* data, size_t len) {
    // If paused, silently drop to save CPU
    if (paused_.load(std::memory_order_relaxed)) return;

    // Copy payload into decode queue (Paho owns the original buffer)
    std::vector<uint8_t> copy(data, data + len);
    {
      std::lock_guard<std::mutex> lk(queueMutex_);
      // Back-pressure: if queue grows too large, drop oldest
      if (rawQueue_.size() > 10) {
        rawQueue_.pop();
      }
      rawQueue_.push(std::move(copy));
    }
    queueCv_.notify_one();
  }

  // ── MQTT connection callback (Paho thread) ──────────────────────────
  void onMqttConnect(bool ok, const std::string& reason) {
    if (ok) {
      setState(StreamState::Connected, reason);
    } else {
      setState(StreamState::Error, reason);
    }
  }

  // ── MQTT disconnect callback (Paho thread) ─────────────────────────
  void onMqttDisconnect(const std::string& reason) {
    // Only report if we didn't request shutdown
    if (!shutdownRequested_.load()) {
      setState(StreamState::Disconnected, reason);
    }
  }

  // ── Decode worker loop (dedicated thread) ───────────────────────────
  void decodeWorkerLoop() {
    while (!shutdownRequested_.load()) {
      std::vector<uint8_t> payload;
      {
        std::unique_lock<std::mutex> lk(queueMutex_);
        queueCv_.wait(lk, [this] {
          return !rawQueue_.empty() || shutdownRequested_.load();
        });
        if (shutdownRequested_.load()) break;
        payload = std::move(rawQueue_.front());
        rawQueue_.pop();
      }

      // Decode (CPU-bound, runs on this dedicated thread)
      auto fragment = FrameDecoder::decode(payload.data(), payload.size());
      if (!fragment) continue;

      // Publish to triple-buffer (lock-free)
      frameQueue_.publish(fragment);

      // Notify (typically dispatches to JS thread)
      if (onFrameReady_) {
        onFrameReady_(fragment);
      }
    }
  }
};

} // namespace mapstream
