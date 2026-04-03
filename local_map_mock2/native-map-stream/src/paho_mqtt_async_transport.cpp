#include "mapstream/i_mqtt_transport.h"

#include <memory>
#include <mutex>
#include <string>
#include <utility>

#if defined(MAPSTREAM_WITH_PAHO)
#include <MQTTAsync.h>
#endif

namespace mapstream {

#if defined(MAPSTREAM_WITH_PAHO)

namespace {

std::string makeServerUri(const ConnectConfig &cfg) {
  const char *scheme = cfg.useTls ? "ssl://" : "tcp://";
  return std::string(scheme) + cfg.host + ":" + std::to_string(cfg.port);
}

class PahoMqttAsyncTransport final : public IMqttTransport {
public:
  PahoMqttAsyncTransport() = default;

  ~PahoMqttAsyncTransport() override {
    disconnectAsync();
  }

  void setHandlers(OnConnected onConn, OnDisconnected onDisc, OnMessage onMsg) override {
    std::lock_guard lk(mu_);
    onConn_ = std::move(onConn);
    onDisc_ = std::move(onDisc);
    onMsg_ = std::move(onMsg);
  }

  void connectAsync(const ConnectConfig &cfg) override {
    std::lock_guard lk(mu_);
    cfg_ = cfg;

    if (client_) {
      MQTTAsync_destroy(&client_);
      client_ = nullptr;
    }

    const std::string uri = makeServerUri(cfg);
    const int rc = MQTTAsync_create(
        &client_, uri.c_str(), cfg.clientId.c_str(), MQTTCLIENT_PERSISTENCE_NONE, nullptr);
    if (rc != MQTTASYNC_SUCCESS || !client_) {
      OnConnected cb = onConn_;
      if (cb) {
        cb(false, std::string("MQTTAsync_create failed: ") + std::to_string(rc));
      }
      return;
    }

    MQTTAsync_setCallbacks(
        client_,
        this,
        &PahoMqttAsyncTransport::onConnectionLostStatic,
        &PahoMqttAsyncTransport::onMessageArrivedStatic,
        nullptr);

    MQTTAsync_connectOptions opts = MQTTAsync_connectOptions_initializer;
    opts.keepAliveInterval = cfg.keepAliveInterval;
    opts.cleansession = 1;
    opts.connectTimeout = cfg.connectTimeoutSec;
    opts.automaticReconnect = 1;
    opts.minRetryInterval = 1;
    opts.maxRetryInterval = 8;
    opts.onSuccess = &PahoMqttAsyncTransport::onConnectSuccessStatic;
    opts.onFailure = &PahoMqttAsyncTransport::onConnectFailureStatic;
    opts.context = this;

    if (!cfg.username.empty()) {
      opts.username = cfg.username.c_str();
      opts.password = cfg.password.c_str();
    }

    const int crc = MQTTAsync_connect(client_, &opts);
    if (crc != MQTTASYNC_SUCCESS) {
      OnConnected cb = onConn_;
      MQTTAsync_destroy(&client_);
      client_ = nullptr;
      if (cb) {
        cb(false, std::string("MQTTAsync_connect failed: ") + std::to_string(crc));
      }
    }
  }

  void disconnectAsync() override {
    MQTTAsync client = nullptr;
    {
      std::lock_guard lk(mu_);
      client = client_;
      client_ = nullptr;
    }
    if (!client) {
      return;
    }

    MQTTAsync_disconnectOptions dopts = MQTTAsync_disconnectOptions_initializer;
    dopts.timeout = 2000;
    MQTTAsync_disconnect(client, &dopts);
    MQTTAsync_destroy(&client);
  }

  void subscribeAsync(const std::string &topic) override {
    std::lock_guard lk(mu_);
    if (!client_) {
      return;
    }
    MQTTAsync_responseOptions ropts = MQTTAsync_responseOptions_initializer;
    ropts.context = this;
    (void)MQTTAsync_subscribe(client_, topic.c_str(), 0, &ropts);
  }

  void unsubscribeAsync(const std::string &topic) override {
    std::lock_guard lk(mu_);
    if (!client_) {
      return;
    }
    MQTTAsync_responseOptions ropts = MQTTAsync_responseOptions_initializer;
    ropts.context = this;
    (void)MQTTAsync_unsubscribe(client_, topic.c_str(), &ropts);
  }

private:
  static void onConnectSuccessStatic(void *context, MQTTAsync_successData *response) {
    (void)response;
    auto *self = static_cast<PahoMqttAsyncTransport *>(context);
    OnConnected cb;
    {
      std::lock_guard lk(self->mu_);
      cb = self->onConn_;
    }
    if (cb) {
      cb(true, {});
    }
  }

  static void onConnectFailureStatic(void *context, MQTTAsync_failureData *response) {
    auto *self = static_cast<PahoMqttAsyncTransport *>(context);
    std::string err = "connect failed";
    if (response && response->message) {
      err = response->message;
    }
    OnConnected cb;
    {
      std::lock_guard lk(self->mu_);
      cb = self->onConn_;
    }
    if (cb) {
      cb(false, err);
    }
  }

  static void onConnectionLostStatic(void *context, char *cause) {
    auto *self = static_cast<PahoMqttAsyncTransport *>(context);
    OnDisconnected cb;
    {
      std::lock_guard lk(self->mu_);
      cb = self->onDisc_;
    }
    if (cb) {
      cb(cause ? std::string(cause) : std::string("connection lost"));
    }
  }

  static int onMessageArrivedStatic(void *context, char *topicName, int topicLen, MQTTAsync_message *message) {
    (void)topicLen;
    auto *self = static_cast<PahoMqttAsyncTransport *>(context);
    OnMessage cb;
    {
      std::lock_guard lk(self->mu_);
      cb = self->onMsg_;
    }
    if (cb && message && message->payload && message->payloadlen > 0) {
      auto *bytes = static_cast<const uint8_t *>(message->payload);
      cb(std::vector<uint8_t>(bytes, bytes + static_cast<size_t>(message->payloadlen)));
    }
    // Per Eclipse Paho MQTTAsync contract, returning 1 lets the library free topic/message.
    return 1;
  }

  std::mutex mu_;
  MQTTAsync client_{nullptr};
  ConnectConfig cfg_{};
  OnConnected onConn_;
  OnDisconnected onDisc_;
  OnMessage onMsg_;
};

} // namespace

std::unique_ptr<IMqttTransport> createPahoMqttAsyncTransport() {
  return std::make_unique<PahoMqttAsyncTransport>();
}

#else

std::unique_ptr<IMqttTransport> createPahoMqttAsyncTransport() {
  return nullptr;
}

#endif

} // namespace mapstream
