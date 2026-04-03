#include "mapstream/map_stream_worker.h"

#include "../../react-native-mvp/cpp/MapFrameParserCore.h"

#include <utility>

namespace mapstream {

namespace {

constexpr size_t kMaxQueuedPayloads = 16;

} // namespace

std::shared_ptr<MapStreamWorker> MapStreamWorker::create(std::unique_ptr<IMqttTransport> transport) {
  return std::shared_ptr<MapStreamWorker>(new MapStreamWorker(std::move(transport)));
}

MapStreamWorker::MapStreamWorker(std::unique_ptr<IMqttTransport> transport)
    : transport_(std::move(transport)) {}

MapStreamWorker::~MapStreamWorker() {
  disconnect();
}

void MapStreamWorker::setStateHandler(StateHandler handler) {
  std::lock_guard lk(handlerMu_);
  stateHandler_ = std::move(handler);
}

void MapStreamWorker::setFrameAvailableHandler(FrameAvailableHandler handler) {
  std::lock_guard lk(handlerMu_);
  frameHandler_ = std::move(handler);
}

void MapStreamWorker::ensureWorkerThread() {
  bool expected = false;
  if (!workerRunning_.compare_exchange_strong(expected, true)) {
    return;
  }
  stopRequested_ = false;
  worker_ = std::thread([this] { processingLoop(); });
}

void MapStreamWorker::connect(const ConnectConfig &cfg) {
  disconnecting_ = false;
  stopRequested_ = false;
  ensureWorkerThread();
  activeConfig_ = cfg;
  emitState(ConnectionState::Connecting, "connect");

  transport_->setHandlers(
      [this](bool success, std::string err) {
        if (success) {
          emitState(ConnectionState::Connected, "connected");
        } else {
          emitState(ConnectionState::Error, err.empty() ? "connect failed" : err);
        }
      },
      [this](std::string reason) {
        emitState(ConnectionState::Disconnected, reason.empty() ? "disconnected" : reason);
      },
      [this](std::vector<uint8_t> p) { enqueuePayload(std::move(p)); });

  transport_->connectAsync(cfg);
}

void MapStreamWorker::disconnect() {
  if (disconnecting_.exchange(true)) {
    return;
  }

  stopRequested_ = true;
  queueCv_.notify_all();

  if (transport_) {
    transport_->disconnectAsync();
  }

  if (worker_.joinable()) {
    worker_.join();
  }
  workerRunning_ = false;
  subscribed_ = false;
  paused_ = false;
  disconnecting_ = false;
  emitState(ConnectionState::Disconnected, "shutdown");
}

void MapStreamWorker::startSubscription() {
  if (activeConfig_.topic.empty()) {
    emitState(ConnectionState::Error, "topic empty");
    return;
  }
  transport_->subscribeAsync(activeConfig_.topic);
  subscribed_ = true;
  if (!paused_) {
    emitState(ConnectionState::Subscribed, activeConfig_.topic);
  }
}

void MapStreamWorker::stopSubscription() {
  if (!activeConfig_.topic.empty()) {
    transport_->unsubscribeAsync(activeConfig_.topic);
  }
  subscribed_ = false;
  if (paused_) {
    emitState(ConnectionState::Paused, "unsubscribed");
  } else {
    emitState(ConnectionState::Connected, "unsubscribed");
  }
}

void MapStreamWorker::pause() {
  paused_ = true;
  emitState(ConnectionState::Paused, "pause");
}

void MapStreamWorker::resume() {
  paused_ = false;
  if (subscribed_) {
    emitState(ConnectionState::Subscribed, "resume");
  } else {
    emitState(ConnectionState::Connected, "resume");
  }
}

std::shared_ptr<const DecodedMapFrame> MapStreamWorker::getLatestFrame() const {
  std::lock_guard lk(latestMu_);
  return latest_;
}

void MapStreamWorker::injectRawPayloadForTest(std::vector<uint8_t> bytes) {
  if (stopRequested_) {
    return;
  }
  ensureWorkerThread();
  {
    std::lock_guard lk(queueMu_);
    queue_.push_back(std::move(bytes));
  }
  queueCv_.notify_one();
}

ConnectionState MapStreamWorker::state() const {
  return state_.load(std::memory_order_acquire);
}

void MapStreamWorker::emitState(ConnectionState s, std::string detail) {
  state_.store(s, std::memory_order_release);
  StateHandler copy;
  {
    std::lock_guard lk(handlerMu_);
    copy = stateHandler_;
  }
  if (copy) {
    copy(s, detail);
  }
}

void MapStreamWorker::enqueuePayload(std::vector<uint8_t> payload) {
  if (stopRequested_) {
    return;
  }
  if (paused_) {
    return;
  }
  {
    std::lock_guard lk(queueMu_);
    while (queue_.size() >= kMaxQueuedPayloads) {
      queue_.pop_front();
    }
    queue_.push_back(std::move(payload));
  }
  queueCv_.notify_one();
}

void MapStreamWorker::processingLoop() {
  while (!stopRequested_) {
    std::vector<uint8_t> item;
    {
      std::unique_lock lk(queueMu_);
      queueCv_.wait(lk, [this] { return stopRequested_ || !queue_.empty(); });
      if (stopRequested_) {
        break;
      }
      item = std::move(queue_.front());
      queue_.pop_front();
    }
    if (paused_) {
      continue;
    }
    handleOnePayload(std::move(item));
  }
}

void MapStreamWorker::handleOnePayload(std::vector<uint8_t> payload) {
  mapmock::DecodedIncrement decoded;
  std::string err;
  if (!mapmock::decodeIncrementFrame(payload.data(), payload.size(), decoded, err)) {
    emitState(ConnectionState::Error, err);
    return;
  }

  auto rgba = std::make_shared<std::vector<uint8_t>>(std::move(decoded.rgba));
  auto frame = std::make_shared<DecodedMapFrame>();
  frame->rgba = std::move(rgba);
  frame->metaJsonUtf8 = std::move(decoded.metaJsonUtf8);
  frame->width = decoded.width;
  frame->height = decoded.height;
  const uint64_t seq = sequence_.fetch_add(1, std::memory_order_acq_rel) + 1;
  frame->sequence = seq;

  {
    std::lock_guard lk(latestMu_);
    latest_ = std::move(frame);
  }

  FrameAvailableHandler fh;
  {
    std::lock_guard lk(handlerMu_);
    fh = frameHandler_;
  }
  if (fh) {
    fh(seq);
  }
}

} // namespace mapstream
