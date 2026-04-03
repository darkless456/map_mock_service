#pragma once
/**
 * @file MapTypes.h
 * @brief Shared data types for the Map streaming pipeline.
 *
 * All types are header-only, plain structs, no platform dependencies.
 * Safe to include from any compilation unit.
 */

#include <cstdint>
#include <string>
#include <vector>
#include <atomic>

namespace mapstream {

// ─── Connection Configuration ────────────────────────────────────────────
struct MqttConfig {
  std::string brokerUrl;   // e.g. "tcp://192.168.1.100" or "ws://192.168.1.100"
  int         port = 1883;
  std::string topic = "robot/map/increment";
  std::string clientId = "rn-map-client";
  int         qos = 0;
  int         keepAliveSec = 60;
  bool        cleanSession = true;
};

// ─── State Machine ───────────────────────────────────────────────────────
enum class StreamState : int {
  Disconnected = 0,
  Connecting   = 1,
  Connected    = 2,
  Subscribing  = 3,
  Streaming    = 4,  // actively receiving & decoding
  Paused       = 5,  // connected but not decoding
  Error        = 6,
};

inline const char* streamStateToString(StreamState s) {
  switch (s) {
    case StreamState::Disconnected: return "Disconnected";
    case StreamState::Connecting:   return "Connecting";
    case StreamState::Connected:    return "Connected";
    case StreamState::Subscribing:  return "Subscribing";
    case StreamState::Streaming:    return "Streaming";
    case StreamState::Paused:       return "Paused";
    case StreamState::Error:        return "Error";
  }
  return "Unknown";
}

// ─── Decoded Map Fragment ────────────────────────────────────────────────
struct MapFragment {
  double   timestampMs = 0;
  double   resolution  = 0;  // meters per pixel
  double   originX     = 0;  // world X of tile center
  double   originY     = 0;  // world Y of tile center
  int      cols        = 0;  // pixel width
  int      rows        = 0;  // pixel height
  int      seq         = 0;  // global sequence number

  // RGBA raw pixel data: cols * rows * 4 bytes
  std::vector<uint8_t> rgba;
};

// ─── Callback types ──────────────────────────────────────────────────────
using StateCallback   = std::function<void(StreamState state, const std::string& detail)>;
using FrameCallback   = std::function<void(std::shared_ptr<MapFragment> fragment)>;

} // namespace mapstream
