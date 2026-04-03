/**
 * Example TurboModule wiring for MapStreamWorker + JSI (integrate after codegen).
 *
 * Key rules:
 * - Never touch jsi::Runtime / jsi::Function from the MQTT or worker threads.
 * - MapStreamWorker::setFrameAvailableHandler runs on the worker thread: only enqueue work onto
 *   CallInvoker (or RuntimeScheduler) to call JS listeners.
 * - Store jsi::Function listeners as members that are assigned/destroyed exclusively on the JS thread.
 *
 * Sketch (pseudocode — adjust to your generated Spec base class and includes):
 *
 *   #include <ReactCommon/CallInvoker.h>
 *   #include <jsi/jsi.h>
 *   #include "mapstream/map_stream_worker.h"
 *   #include "MapStreamJsi.h"
 *   #include "mapstream/i_mqtt_transport.h"
 *
 *   class NativeMapStream : public NativeMapStreamCxxSpec<NativeMapStream> {
 *    public:
 *     NativeMapStream(std::shared_ptr<CallInvoker> jsInvoker)
 *         : NativeMapStreamCxxSpec(std::move(jsInvoker)) {
 *       worker_ = mapstream::MapStreamWorker::create(
 *           usePaho_ ? mapstream::createPahoMqttAsyncTransport()
 *                    : mapstream::createStubMqttTransport());
 *       worker_->setStateHandler([this](mapstream::ConnectionState s, const std::string& d) {
 *         jsInvoker_->invokeAsync([this, s, d] { emitStateToJs(s, d); });
 *       });
 *       worker_->setFrameAvailableHandler([this](uint64_t seq) {
 *         (void)seq;
 *         jsInvoker_->invokeAsync([this] { emitFrameTickToJs(); });
 *       });
 *     }
 *
 *     void connect(jsi::Runtime& rt, jsi::Object cfg) { ... parse fields, fill mapstream::ConnectConfig, worker_->connect(c); }
 *     void disconnect(jsi::Runtime&) { worker_->disconnect(); }
 *     void start(jsi::Runtime&) { worker_->startSubscription(); }
 *     void stop(jsi::Runtime&) { worker_->stopSubscription(); }
 *     void pause(jsi::Runtime&) { worker_->pause(); }
 *     void resume(jsi::Runtime&) { worker_->resume(); }
 *
 *     jsi::Object getStatus(jsi::Runtime& rt) { ... map worker_->state() to strings ... }
 *
 *     jsi::Value consumeLatestFrame(jsi::Runtime& rt) {
 *       auto f = worker_->getLatestFrame();
 *       return mapstream_jsi::decodedFrameToJs(rt, std::move(f));
 *     }
 *
 *     void setStateListener(jsi::Runtime& rt, jsi::Function fn) { stateListener_ = std::move(fn); }
 *     void setFrameTickListener(jsi::Runtime& rt, jsi::Function fn) { frameListener_ = std::move(fn); }
 *
 *    private:
 *     void emitStateToJs(mapstream::ConnectionState s, const std::string& d) {
 *       if (!stateListener_) return;
 *       // call(rt, stateName, detail) — obtain rt from TurboModule method storage pattern used in your app
 *     }
 *
 *     std::shared_ptr<mapstream::MapStreamWorker> worker_;
 *     bool usePaho_{true};
 *     jsi::Function stateListener_;
 *     jsi::Function frameListener_;
 *   };
 *
 * Note: holding jsi::Function across calls requires the same discipline as other native modules:
 * clear listeners in invalidate()/destructor on the JS thread, and null them before tearing down worker_.
 */
