#include "mapstream/i_mqtt_transport.h"
#include "mapstream/map_stream_worker.h"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <thread>

int main() {
  using namespace mapstream;

  std::atomic<int> stateHits{0};
  std::atomic<uint64_t> lastSeq{0};

  auto worker = MapStreamWorker::create(createStubMqttTransport());
  worker->setStateHandler([&](ConnectionState s, const std::string &d) {
    ++stateHits;
    std::cout << "state=" << connectionStateName(s) << " detail=" << d << "\n";
  });
  worker->setFrameAvailableHandler([&](uint64_t seq) { lastSeq.store(seq, std::memory_order_relaxed); });

  ConnectConfig cfg;
  cfg.host = "127.0.0.1";
  cfg.port = 1883;
  cfg.topic = "robot/map/increment";
  worker->connect(cfg);
  worker->startSubscription();

  // Without a broker, stub still "connects"; inject a tiny invalid payload to exercise decode error path.
  worker->injectRawPayloadForTest(std::vector<uint8_t>{0, 0, 0, 0});

  std::this_thread::sleep_for(std::chrono::milliseconds(50));

  worker->pause();
  worker->resume();
  worker->stopSubscription();
  worker->disconnect();

  std::cout << "stateCallbacks=" << stateHits.load() << " lastSeq=" << lastSeq.load() << "\n";
  return EXIT_SUCCESS;
}
