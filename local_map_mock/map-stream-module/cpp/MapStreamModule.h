#pragma once
/**
 * @file MapStreamModule.h
 * @brief JSI TurboModule that bridges MapStreamWorker ↔ JavaScript.
 *
 * This is the *only* file that touches JSI / RN internals.
 * All business logic is in MapStreamWorker and its dependencies.
 *
 * Installed global JS functions:
 *   mapStream_connect(config)    → Promise<boolean>
 *   mapStream_start()            → boolean
 *   mapStream_stop()             → boolean
 *   mapStream_pause()            → boolean
 *   mapStream_resume()           → boolean
 *   mapStream_disconnect()       → void
 *   mapStream_getState()         → string
 *   mapStream_acquireFrame()     → { metadata, rgbaBuffer } | null
 *   mapStream_setOnStateChange(callback)  → void
 *   mapStream_setOnFrameReady(callback)   → void
 *
 * Memory ownership model for ArrayBuffer:
 *   C++ decodes PNG → std::vector<uint8_t> (rgba)
 *   → shared_ptr<MapFragment> stored in FrameQueue
 *   → JS calls acquireFrame() → we wrap the same vector into jsi::ArrayBuffer
 *     via a VectorBuffer that holds a shared_ptr to the MapFragment
 *   → When JS GCs the ArrayBuffer, VectorBuffer destructor decrements refcount
 *   → MapFragment (and its rgba vector) freed when last shared_ptr dies
 *
 *   ∴ TRUE ZERO-COPY from decode output to JS: no memcpy on the hot path.
 */

#include <jsi/jsi.h>
#include <ReactCommon/CallInvoker.h>
#include <memory>
#include <string>

#include "mapstream/MapStreamWorker.h"

namespace facebook::react {

/**
 * jsi::MutableBuffer backed by a shared_ptr to MapFragment.
 * Prevents the RGBA data from being freed while JS holds a reference.
 */
class FragmentBuffer : public jsi::MutableBuffer {
 public:
  explicit FragmentBuffer(std::shared_ptr<mapstream::MapFragment> frag)
      : fragment_(std::move(frag)) {}

  uint8_t* data() override { return fragment_->rgba.data(); }
  size_t size() const override { return fragment_->rgba.size(); }

 private:
  std::shared_ptr<mapstream::MapFragment> fragment_;
};

class MapStreamModule {
 public:
  MapStreamModule(
      jsi::Runtime& rt,
      std::shared_ptr<CallInvoker> jsInvoker)
      : rt_(rt),
        jsInvoker_(std::move(jsInvoker)),
        worker_(std::make_shared<mapstream::MapStreamWorker>()) {}

  ~MapStreamModule() {
    worker_->disconnect();
  }

  /**
   * Install all global JSI functions. Call once at app startup.
   */
  void install() {
    installConnect();
    installStart();
    installStop();
    installPause();
    installResume();
    installDisconnect();
    installGetState();
    installAcquireFrame();
    installSetOnStateChange();
    installSetOnFrameReady();
  }

 private:
  jsi::Runtime& rt_;
  std::shared_ptr<CallInvoker> jsInvoker_;
  std::shared_ptr<mapstream::MapStreamWorker> worker_;

  // Persistent JS callbacks (stored as shared_ptr for thread safety)
  std::shared_ptr<jsi::Function> jsOnStateChange_;
  std::shared_ptr<jsi::Function> jsOnFrameReady_;

  // ── Helper: register a global JSI function ──────────────────────────
  template <typename Fn>
  void registerFunction(const char* name, int paramCount, Fn&& fn) {
    auto func = jsi::Function::createFromHostFunction(
        rt_,
        jsi::PropNameID::forAscii(rt_, name),
        paramCount,
        std::forward<Fn>(fn));
    rt_.global().setProperty(rt_, name, std::move(func));
  }

  // ── mapStream_connect(config) → Promise<boolean> ───────────────────
  void installConnect() {
    auto weakWorker = std::weak_ptr(worker_);
    auto invoker = jsInvoker_;

    registerFunction("mapStream_connect", 1,
      [weakWorker, invoker, this](
          jsi::Runtime& rt,
          const jsi::Value&,
          const jsi::Value* args,
          size_t count) -> jsi::Value {

        if (count < 1 || !args[0].isObject()) {
          throw jsi::JSError(rt, "mapStream_connect: expects config object");
        }

        // Extract config from JS object
        auto configObj = args[0].asObject(rt);
        mapstream::MqttConfig config;

        if (configObj.hasProperty(rt, "brokerUrl")) {
          config.brokerUrl = configObj.getProperty(rt, "brokerUrl")
                                 .asString(rt).utf8(rt);
        }
        if (configObj.hasProperty(rt, "port")) {
          config.port = static_cast<int>(
              configObj.getProperty(rt, "port").asNumber());
        }
        if (configObj.hasProperty(rt, "topic")) {
          config.topic = configObj.getProperty(rt, "topic")
                             .asString(rt).utf8(rt);
        }
        if (configObj.hasProperty(rt, "clientId")) {
          config.clientId = configObj.getProperty(rt, "clientId")
                                .asString(rt).utf8(rt);
        }

        // Create promise
        auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");
        auto configCopy = std::make_shared<mapstream::MqttConfig>(std::move(config));

        return promiseCtor.callAsConstructor(rt,
          jsi::Function::createFromHostFunction(rt,
            jsi::PropNameID::forAscii(rt, "executor"), 2,
            [weakWorker, invoker, configCopy](
                jsi::Runtime& rt,
                const jsi::Value&,
                const jsi::Value* promArgs,
                size_t) -> jsi::Value {

              auto resolve = std::make_shared<jsi::Value>(rt, promArgs[0]);
              auto reject  = std::make_shared<jsi::Value>(rt, promArgs[1]);

              auto worker = weakWorker.lock();
              if (!worker) {
                invoker->invokeAsync([reject](jsi::Runtime& rt) {
                  reject->asObject(rt).asFunction(rt).call(
                      rt, jsi::String::createFromUtf8(rt, "Module destroyed"));
                });
                return jsi::Value::undefined();
              }

              bool ok = worker->connect(*configCopy);
              auto okCapture = ok;
              invoker->invokeAsync([resolve, reject, okCapture](jsi::Runtime& rt) {
                if (okCapture) {
                  resolve->asObject(rt).asFunction(rt).call(rt, true);
                } else {
                  reject->asObject(rt).asFunction(rt).call(
                      rt, jsi::String::createFromUtf8(rt, "Connect failed"));
                }
              });

              return jsi::Value::undefined();
            }));
      });
  }

  // ── mapStream_start() → boolean ───────────────────────────────────
  void installStart() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_start", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {
        auto w = weakWorker.lock();
        return jsi::Value(w && w->start());
      });
  }

  // ── mapStream_stop() → boolean ────────────────────────────────────
  void installStop() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_stop", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {
        auto w = weakWorker.lock();
        return jsi::Value(w && w->stop());
      });
  }

  // ── mapStream_pause() → boolean ───────────────────────────────────
  void installPause() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_pause", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {
        auto w = weakWorker.lock();
        return jsi::Value(w && w->pause());
      });
  }

  // ── mapStream_resume() → boolean ──────────────────────────────────
  void installResume() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_resume", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {
        auto w = weakWorker.lock();
        return jsi::Value(w && w->resume());
      });
  }

  // ── mapStream_disconnect() → void ─────────────────────────────────
  void installDisconnect() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_disconnect", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {
        auto w = weakWorker.lock();
        if (w) w->disconnect();
        return jsi::Value::undefined();
      });
  }

  // ── mapStream_getState() → string ─────────────────────────────────
  void installGetState() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_getState", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {
        auto w = weakWorker.lock();
        if (!w) return jsi::String::createFromUtf8(rt, "Disconnected");
        return jsi::String::createFromUtf8(
            rt, mapstream::streamStateToString(w->getState()));
      });
  }

  // ── mapStream_acquireFrame() → {metadata, rgbaBuffer} | null ──────
  //
  // This is the HOT PATH. Zero-copy design:
  //   1. acquireLatestFrame() returns shared_ptr<MapFragment> from triple-buffer
  //   2. FragmentBuffer wraps the shared_ptr (holds a ref to keep rgba alive)
  //   3. jsi::ArrayBuffer created from FragmentBuffer (no memcpy!)
  //   4. JS GC eventually releases the ArrayBuffer → FragmentBuffer destroyed
  //      → shared_ptr refcount drops → MapFragment freed (if no other refs)
  //
  void installAcquireFrame() {
    auto weakWorker = std::weak_ptr(worker_);
    registerFunction("mapStream_acquireFrame", 0,
      [weakWorker](jsi::Runtime& rt, const jsi::Value&,
                   const jsi::Value*, size_t) -> jsi::Value {

        auto w = weakWorker.lock();
        if (!w) return jsi::Value::null();

        auto fragment = w->acquireLatestFrame();
        if (!fragment) return jsi::Value::null();

        // Build metadata JS object
        jsi::Object meta(rt);
        meta.setProperty(rt, "timestamp_ms", fragment->timestampMs);
        meta.setProperty(rt, "resolution",   fragment->resolution);
        meta.setProperty(rt, "origin_x",     fragment->originX);
        meta.setProperty(rt, "origin_y",     fragment->originY);
        meta.setProperty(rt, "map_cols",      fragment->cols);
        meta.setProperty(rt, "map_rows",      fragment->rows);
        meta.setProperty(rt, "seq",           fragment->seq);

        // ★ ZERO-COPY ArrayBuffer: FragmentBuffer holds shared_ptr to fragment
        auto buffer = std::make_shared<FragmentBuffer>(fragment);
        auto arrayBuffer = jsi::ArrayBuffer(rt, std::move(buffer));

        jsi::Object result(rt);
        result.setProperty(rt, "metadata",    std::move(meta));
        result.setProperty(rt, "rgbaBuffer",  std::move(arrayBuffer));
        return std::move(result);
      });
  }

  // ── mapStream_setOnStateChange(callback) → void ───────────────────
  void installSetOnStateChange() {
    auto invoker = jsInvoker_;
    auto weakWorker = std::weak_ptr(worker_);

    registerFunction("mapStream_setOnStateChange", 1,
      [this, invoker, weakWorker](
          jsi::Runtime& rt, const jsi::Value&,
          const jsi::Value* args, size_t count) -> jsi::Value {

        if (count < 1 || !args[0].isObject()) {
          jsOnStateChange_.reset();
          auto w = weakWorker.lock();
          if (w) w->setOnStateChange(nullptr);
          return jsi::Value::undefined();
        }

        jsOnStateChange_ = std::make_shared<jsi::Function>(
            args[0].asObject(rt).asFunction(rt));

        auto weakCb = std::weak_ptr(jsOnStateChange_);
        auto w = weakWorker.lock();
        if (w) {
          w->setOnStateChange(
            [invoker, weakCb](mapstream::StreamState state,
                              const std::string& detail) {
              auto cb = weakCb.lock();
              if (!cb) return;
              auto stateStr = std::string(mapstream::streamStateToString(state));
              auto detailCopy = detail;
              invoker->invokeAsync(
                [cb, stateStr, detailCopy](jsi::Runtime& rt) {
                  cb->call(rt,
                      jsi::String::createFromUtf8(rt, stateStr),
                      jsi::String::createFromUtf8(rt, detailCopy));
                });
            });
        }
        return jsi::Value::undefined();
      });
  }

  // ── mapStream_setOnFrameReady(callback) → void ────────────────────
  //
  // Called from C++ decode thread → invokeAsync → JS thread.
  // The callback receives NO arguments (lightweight notification).
  // JS should call mapStream_acquireFrame() in response.
  //
  void installSetOnFrameReady() {
    auto invoker = jsInvoker_;
    auto weakWorker = std::weak_ptr(worker_);

    registerFunction("mapStream_setOnFrameReady", 1,
      [this, invoker, weakWorker](
          jsi::Runtime& rt, const jsi::Value&,
          const jsi::Value* args, size_t count) -> jsi::Value {

        if (count < 1 || !args[0].isObject()) {
          jsOnFrameReady_.reset();
          auto w = weakWorker.lock();
          if (w) w->setOnFrameReady(nullptr);
          return jsi::Value::undefined();
        }

        jsOnFrameReady_ = std::make_shared<jsi::Function>(
            args[0].asObject(rt).asFunction(rt));

        auto weakCb = std::weak_ptr(jsOnFrameReady_);
        auto w = weakWorker.lock();
        if (w) {
          w->setOnFrameReady(
            [invoker, weakCb](std::shared_ptr<mapstream::MapFragment>) {
              auto cb = weakCb.lock();
              if (!cb) return;
              invoker->invokeAsync(
                [cb](jsi::Runtime& rt) {
                  cb->call(rt);
                });
            });
        }
        return jsi::Value::undefined();
      });
  }
};

// ── Module lifecycle helper ─────────────────────────────────────────────
// Called from platform-specific registration (OnLoad / AppDelegate)
inline void installMapStreamModule(
    jsi::Runtime& rt,
    std::shared_ptr<CallInvoker> jsInvoker) {
  auto module = std::make_shared<MapStreamModule>(rt, jsInvoker);
  module->install();
  // Store the module as a weak ref to allow cleanup:
  // The module will be kept alive as long as any JSI closure captures it.
  // When the runtime is torn down, all closures are released.
}

} // namespace facebook::react
