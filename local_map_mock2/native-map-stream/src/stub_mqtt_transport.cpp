#include "mapstream/i_mqtt_transport.h"

#include <utility>

namespace mapstream {

namespace {

class StubMqttTransport final : public IMqttTransport {
public:
  void setHandlers(OnConnected onConn, OnDisconnected onDisc, OnMessage onMsg) override {
    onConn_ = std::move(onConn);
    onDisc_ = std::move(onDisc);
    onMsg_ = std::move(onMsg);
  }

  void connectAsync(const ConnectConfig &cfg) override {
    (void)cfg;
    connected_ = true;
    if (onConn_) {
      onConn_(true, {});
    }
  }

  void disconnectAsync() override {
    connected_ = false;
    if (onDisc_) {
      onDisc_("stub disconnect");
    }
  }

  void subscribeAsync(const std::string &topic) override {
    (void)topic;
  }

  void unsubscribeAsync(const std::string &topic) override {
    (void)topic;
  }

private:
  OnConnected onConn_;
  OnDisconnected onDisc_;
  OnMessage onMsg_;
  bool connected_{false};
};

} // namespace

std::unique_ptr<IMqttTransport> createStubMqttTransport() {
  return std::make_unique<StubMqttTransport>();
}

} // namespace mapstream
