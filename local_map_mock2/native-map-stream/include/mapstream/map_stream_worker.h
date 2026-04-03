#pragma once

#include "i_mqtt_transport.h"
#include "mqtt_types.h"

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace mapstream {

/**
 * Immutable, refcounted view of the latest decoded map chunk (RGBA8 + JSON meta).
 * The RGBA bytes are held in a shared std::vector so JSI can wrap them without copying
 * (via jsi::MutableBuffer) while lifetime extends until JS GC releases the ArrayBuffer.
 */
struct DecodedMapFrame {
  std::shared_ptr<std::vector<uint8_t>> rgba;
  std::string metaJsonUtf8;
  int width = 0;
  int height = 0;
  uint64_t sequence = 0;
};

/**
 * MapStreamWorker
 * - Owns a dedicated processing thread that drains incoming MQTT payloads, decodes PNG,
 *   and publishes the latest frame behind a mutex (cheap ref-count handoff for ~10Hz).
 * - MQTT I/O is delegated to IMqttTransport (Paho async or in-process stub for tests).
 * - TurboModule glue should hop thread boundaries via CallInvoker; this class stays RN-free.
 */
class MapStreamWorker : public std::enable_shared_from_this<MapStreamWorker> {
public:
  using StateHandler = std::function<void(ConnectionState state, const std::string &detail)>;
  /** Invoked from the worker thread after a new frame is published (glue must not call JSI here). */
  using FrameAvailableHandler = std::function<void(uint64_t sequence)>;

  static std::shared_ptr<MapStreamWorker> create(std::unique_ptr<IMqttTransport> transport);

  ~MapStreamWorker();

  MapStreamWorker(const MapStreamWorker &) = delete;
  MapStreamWorker &operator=(const MapStreamWorker &) = delete;

  void setStateHandler(StateHandler handler);
  void setFrameAvailableHandler(FrameAvailableHandler handler);

  /** Starts the worker thread (idempotent). Safe before connect. */
  void ensureWorkerThread();

  /**
   * connect + start + stop semantics:
   * - connect: transport connect only (no subscribe).
   * - startSubscription: SUBSCRIBE
   * - stopSubscription: UNSUBSCRIBE (keeps TCP/MQTT session for pause/resume heartbeats)
   * - disconnect: transport disconnect + stops worker thread
   */
  void connect(const ConnectConfig &cfg);
  void disconnect();

  void startSubscription();
  void stopSubscription();

  /** Pause: keep MQTT session; drop incoming payloads cheaply (no PNG decode, no frame publish). */
  void pause();
  void resume();

  /** Latest frame for the JS thread to wrap into JSI (shared_ptr copy is shallow). */
  std::shared_ptr<const DecodedMapFrame> getLatestFrame() const;

  /** Test hook: push a raw MQTT payload through the same decode path as real messages. */
  void injectRawPayloadForTest(std::vector<uint8_t> bytes);

  ConnectionState state() const;

private:
  explicit MapStreamWorker(std::unique_ptr<IMqttTransport> transport);

  void emitState(ConnectionState s, std::string detail = {});

  void enqueuePayload(std::vector<uint8_t> payload);
  void processingLoop();
  void handleOnePayload(std::vector<uint8_t> payload);

  std::unique_ptr<IMqttTransport> transport_;

  mutable std::mutex handlerMu_;
  StateHandler stateHandler_;
  FrameAvailableHandler frameHandler_;

  std::atomic<ConnectionState> state_{ConnectionState::Idle};
  std::atomic<bool> paused_{false};
  std::atomic<bool> stopRequested_{false};
  std::atomic<bool> disconnecting_{false};
  std::atomic<bool> subscribed_{false};

  ConnectConfig activeConfig_{};

  mutable std::mutex latestMu_;
  std::shared_ptr<const DecodedMapFrame> latest_;

  std::mutex queueMu_;
  std::condition_variable queueCv_;
  std::deque<std::vector<uint8_t>> queue_;
  std::atomic<uint64_t> sequence_{0};

  std::thread worker_;
  std::atomic<bool> workerRunning_{false};
};

} // namespace mapstream
