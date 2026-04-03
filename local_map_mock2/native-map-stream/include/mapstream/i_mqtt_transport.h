#pragma once

#include "mqtt_types.h"

#include <functional>
#include <memory>
#include <vector>

namespace mapstream {

/**
 * Abstract MQTT client so MapStreamWorker stays testable without network / Paho.
 * Implementations must not block the caller for long; prefer async connect + callback.
 */
class IMqttTransport {
public:
  using OnConnected = std::function<void(bool success, std::string errorMessage)>;
  using OnDisconnected = std::function<void(std::string reason)>;
  using OnMessage = std::function<void(std::vector<uint8_t> payload)>;

  virtual ~IMqttTransport() = default;

  virtual void setHandlers(OnConnected onConn, OnDisconnected onDisc, OnMessage onMsg) = 0;

  /** Non-blocking kick-off; result via OnConnected. */
  virtual void connectAsync(const ConnectConfig &cfg) = 0;

  virtual void disconnectAsync() = 0;

  virtual void subscribeAsync(const std::string &topic) = 0;

  virtual void unsubscribeAsync(const std::string &topic) = 0;
};

std::unique_ptr<IMqttTransport> createStubMqttTransport();

/** Requires -DMAPSTREAM_WITH_PAHO and linking eclipse-paho-mqtt-mqtt3as (see docs). */
std::unique_ptr<IMqttTransport> createPahoMqttAsyncTransport();

} // namespace mapstream
