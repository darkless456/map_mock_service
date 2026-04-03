#pragma once
/**
 * @file MqttClient.h
 * @brief Lightweight MQTT client abstraction for the map streaming pipeline.
 *
 * Design decisions:
 *   - Uses Paho MQTT C async API (MQTTAsync_*) for non-blocking I/O.
 *   - All callbacks fire on Paho's internal network thread.
 *   - MapStreamWorker registers callbacks and owns the lifecycle.
 *   - This class is NOT thread-safe by itself — it relies on the caller
 *     (MapStreamWorker) to ensure correct sequencing of connect/subscribe/disconnect.
 *
 * Build dependency: paho-mqtt3as (Paho MQTT Asynchronous C library)
 *   - Android: build from source via CMake ExternalProject or pre-built .so
 *   - iOS: build via CMake or use CocoaPods/SPM
 */

#include "MapTypes.h"
#include <string>
#include <functional>
#include <cstring>

// Paho MQTT C async header
#include "MQTTAsync.h"

namespace mapstream {

using MessageCallback = std::function<void(const uint8_t* payload, size_t len)>;
using ConnectCallback = std::function<void(bool success, const std::string& reason)>;
using DisconnectCallback = std::function<void(const std::string& reason)>;

class MqttClient {
 public:
  MqttClient() = default;

  ~MqttClient() {
    disconnect();
    if (client_) {
      MQTTAsync_destroy(&client_);
      client_ = nullptr;
    }
  }

  // Non-copyable, non-movable (due to C callback pointers to `this`)
  MqttClient(const MqttClient&) = delete;
  MqttClient& operator=(const MqttClient&) = delete;

  void setOnMessage(MessageCallback cb)     { onMessage_ = std::move(cb); }
  void setOnConnect(ConnectCallback cb)      { onConnect_ = std::move(cb); }
  void setOnDisconnect(DisconnectCallback cb){ onDisconnect_ = std::move(cb); }

  /**
   * Initialize and begin async connection.
   * @return true if the connection attempt was initiated successfully.
   */
  bool connect(const MqttConfig& config) {
    config_ = config;

    std::string serverUri = config.brokerUrl + ":" + std::to_string(config.port);

    int rc = MQTTAsync_create(
        &client_,
        serverUri.c_str(),
        config.clientId.c_str(),
        MQTTCLIENT_PERSISTENCE_NONE,
        nullptr);

    if (rc != MQTTASYNC_SUCCESS) return false;

    // Set the C-level callbacks
    MQTTAsync_setCallbacks(client_, this, onConnectionLost, onMessageArrived, nullptr);

    MQTTAsync_connectOptions opts = MQTTAsync_connectOptions_initializer;
    opts.keepAliveInterval = config.keepAliveSec;
    opts.cleansession = config.cleanSession ? 1 : 0;
    opts.onSuccess = onConnectSuccess;
    opts.onFailure = onConnectFailure;
    opts.context = this;
    opts.automaticReconnect = 1;
    opts.minRetryInterval = 1;
    opts.maxRetryInterval = 16;

    rc = MQTTAsync_connect(client_, &opts);
    return rc == MQTTASYNC_SUCCESS;
  }

  /**
   * Subscribe to the configured topic.
   * Must be called after successful connection.
   */
  bool subscribe() {
    if (!client_) return false;

    MQTTAsync_responseOptions opts = MQTTAsync_responseOptions_initializer;
    opts.onSuccess = onSubscribeSuccess;
    opts.onFailure = onSubscribeFailure;
    opts.context = this;

    int rc = MQTTAsync_subscribe(client_, config_.topic.c_str(), config_.qos, &opts);
    return rc == MQTTASYNC_SUCCESS;
  }

  /**
   * Unsubscribe from the configured topic.
   */
  bool unsubscribe() {
    if (!client_) return false;

    MQTTAsync_responseOptions opts = MQTTAsync_responseOptions_initializer;
    int rc = MQTTAsync_unsubscribe(client_, config_.topic.c_str(), &opts);
    return rc == MQTTASYNC_SUCCESS;
  }

  /**
   * Disconnect from the broker.
   */
  void disconnect() {
    if (!client_) return;
    if (!MQTTAsync_isConnected(client_)) return;

    MQTTAsync_disconnectOptions opts = MQTTAsync_disconnectOptions_initializer;
    opts.timeout = 3000;
    MQTTAsync_disconnect(client_, &opts);
  }

  bool isConnected() const {
    return client_ && MQTTAsync_isConnected(client_);
  }

 private:
  MQTTAsync    client_ = nullptr;
  MqttConfig   config_;

  MessageCallback    onMessage_;
  ConnectCallback    onConnect_;
  DisconnectCallback onDisconnect_;

  // ── Paho C callbacks (static → dispatch to member) ──────────────────

  static void onConnectSuccess(void* context, MQTTAsync_successData* /*response*/) {
    auto* self = static_cast<MqttClient*>(context);
    if (self->onConnect_) self->onConnect_(true, "Connected");
  }

  static void onConnectFailure(void* context, MQTTAsync_failureData* response) {
    auto* self = static_cast<MqttClient*>(context);
    std::string reason = response && response->message
        ? response->message : "Connection failed";
    if (self->onConnect_) self->onConnect_(false, reason);
  }

  static void onConnectionLost(void* context, char* cause) {
    auto* self = static_cast<MqttClient*>(context);
    std::string reason = cause ? cause : "Connection lost";
    if (self->onDisconnect_) self->onDisconnect_(reason);
  }

  static int onMessageArrived(
      void* context, char* /*topicName*/, int /*topicLen*/,
      MQTTAsync_message* message) {
    auto* self = static_cast<MqttClient*>(context);
    if (self->onMessage_ && message && message->payload) {
      self->onMessage_(
          static_cast<const uint8_t*>(message->payload),
          static_cast<size_t>(message->payloadlen));
    }
    MQTTAsync_freeMessage(&message);
    return 1;  // ownership taken
  }

  static void onSubscribeSuccess(void* /*context*/, MQTTAsync_successData* /*response*/) {
    // Handled implicitly via state machine in MapStreamWorker
  }

  static void onSubscribeFailure(void* context, MQTTAsync_failureData* response) {
    auto* self = static_cast<MqttClient*>(context);
    std::string reason = response && response->message
        ? response->message : "Subscribe failed";
    if (self->onConnect_) self->onConnect_(false, reason);
  }
};

} // namespace mapstream
