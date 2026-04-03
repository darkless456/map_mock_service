#pragma once

#include <cstdint>
#include <string>

namespace mapstream {

enum class ConnectionState {
  Idle = 0,
  Connecting,
  Connected,
  Subscribed,
  Paused,
  Disconnecting,
  Disconnected,
  Error,
};

inline const char *connectionStateName(ConnectionState s) {
  switch (s) {
    case ConnectionState::Idle:
      return "Idle";
    case ConnectionState::Connecting:
      return "Connecting";
    case ConnectionState::Connected:
      return "Connected";
    case ConnectionState::Subscribed:
      return "Subscribed";
    case ConnectionState::Paused:
      return "Paused";
    case ConnectionState::Disconnecting:
      return "Disconnecting";
    case ConnectionState::Disconnected:
      return "Disconnected";
    case ConnectionState::Error:
      return "Error";
  }
  return "Unknown";
}

struct ConnectConfig {
  std::string host;
  int port = 1883;
  std::string topic;
  std::string clientId = "mapstream_rn";
  std::string username;
  std::string password;
  bool useTls = false;
  int keepAliveInterval = 60;
  int connectTimeoutSec = 10;
};

} // namespace mapstream
