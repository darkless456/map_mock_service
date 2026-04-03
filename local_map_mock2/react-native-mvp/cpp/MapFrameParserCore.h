#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace mapmock {

struct DecodedIncrement {
  /** UTF-8 JSON metadata (same payload the mock server embedded in-frame). */
  std::string metaJsonUtf8;
  int width = 0;
  int height = 0;
  /** RGBA8, length == width * height * 4 */
  std::vector<uint8_t> rgba;
};

/**
 * Parses the mock-server MQTT payload:
 *   [0..3]   uint32 big-endian — N = JSON byte length
 *   [4..4+N) JSON UTF-8
 *   [4+N..)  PNG
 *
 * Decodes PNG to RGBA8 via stb_image. On failure, returns false and sets err.
 */
bool decodeIncrementFrame(const uint8_t *data, size_t len, DecodedIncrement &out, std::string &err);

} // namespace mapmock
