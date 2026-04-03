#pragma once
/**
 * @file FrameDecoder.h
 * @brief Stateless binary frame parser + PNG→RGBA decoder.
 *
 * Designed as a pure utility — no threads, no state, no platform deps.
 * Can be unit-tested in a standalone C++ harness.
 *
 * Frame wire format (from Mock Server):
 *   [4 bytes  uint32_be]  JSON payload length N
 *   [N bytes  UTF-8    ]  JSON metadata string
 *   [M bytes  binary   ]  PNG image data  (M = total - 4 - N)
 */

#include "MapTypes.h"
#include <memory>
#include <cstring>
#include <cstdlib>
#include <string>
#include <stdexcept>

// stb_image — included header-only. Implementation compiled in FrameDecoder.cpp.
#include "stb_image.h"

namespace mapstream {

class FrameDecoder {
 public:
  /**
   * Decode a full binary frame into a MapFragment.
   *
   * @param data  Pointer to the raw MQTT payload.
   * @param len   Total byte length of the payload.
   * @return      Shared pointer to decoded fragment, or nullptr on failure.
   *
   * Thread-safety: this is a pure function with no shared state. Safe to call
   * from any thread concurrently.
   */
  static std::shared_ptr<MapFragment> decode(const uint8_t* data, size_t len) {
    // ── 1. Read frame header ────────────────────────────────────────
    if (!data || len < 4) return nullptr;

    const uint32_t jsonLen =
        (static_cast<uint32_t>(data[0]) << 24) |
        (static_cast<uint32_t>(data[1]) << 16) |
        (static_cast<uint32_t>(data[2]) << 8)  |
        (static_cast<uint32_t>(data[3]));

    if (4 + jsonLen > len) return nullptr;  // malformed frame

    // ── 2. Extract JSON metadata ────────────────────────────────────
    std::string json(reinterpret_cast<const char*>(data + 4), jsonLen);

    auto frag = std::make_shared<MapFragment>();
    frag->timestampMs = extractNumber(json, "timestamp_ms");
    frag->resolution  = extractNumber(json, "resolution");
    frag->originX     = extractNumber(json, "origin_x");
    frag->originY     = extractNumber(json, "origin_y");
    frag->cols        = static_cast<int>(extractNumber(json, "map_cols"));
    frag->rows        = static_cast<int>(extractNumber(json, "map_rows"));
    frag->seq         = static_cast<int>(extractNumber(json, "seq"));

    // ── 3. Decode PNG → RGBA ────────────────────────────────────────
    const uint8_t* pngData = data + 4 + jsonLen;
    const size_t   pngLen  = len - 4 - jsonLen;

    int w = 0, h = 0, channels = 0;
    uint8_t* decoded = stbi_load_from_memory(
        pngData, static_cast<int>(pngLen),
        &w, &h, &channels, 4 /* force RGBA */);

    if (!decoded) return nullptr;

    const size_t rgbaSize = static_cast<size_t>(w) * h * 4;
    frag->rgba.resize(rgbaSize);
    std::memcpy(frag->rgba.data(), decoded, rgbaSize);
    stbi_image_free(decoded);

    // Override cols/rows from actual decoded image (defensive)
    frag->cols = w;
    frag->rows = h;

    return frag;
  }

 private:
  /**
   * Minimal numeric JSON value extractor.
   * Avoids pulling in a full JSON library for a handful of well-known keys.
   */
  static double extractNumber(const std::string& json, const std::string& key) {
    const std::string needle = "\"" + key + "\"";
    auto pos = json.find(needle);
    if (pos == std::string::npos) return 0.0;
    pos = json.find(':', pos + needle.size());
    if (pos == std::string::npos) return 0.0;
    ++pos;
    // Skip whitespace
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) ++pos;
    try {
      return std::stod(json.substr(pos));
    } catch (...) {
      return 0.0;
    }
  }
};

} // namespace mapstream
