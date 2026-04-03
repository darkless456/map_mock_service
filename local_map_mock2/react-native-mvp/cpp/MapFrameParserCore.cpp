#include "MapFrameParserCore.h"

#include <cstring>

#define STB_IMAGE_IMPLEMENTATION
#include "../../third_party/stb_image.h"

namespace mapmock {

namespace {

uint32_t readU32BE(const uint8_t *p) {
  return (static_cast<uint32_t>(p[0]) << 24) | (static_cast<uint32_t>(p[1]) << 16) |
         (static_cast<uint32_t>(p[2]) << 8) | static_cast<uint32_t>(p[3]);
}

bool isPngMagic(const uint8_t *p, size_t len) {
  static const uint8_t kPng[] = {0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};
  if (len < sizeof(kPng)) {
    return false;
  }
  return std::memcmp(p, kPng, sizeof(kPng)) == 0;
}

} // namespace

bool decodeIncrementFrame(const uint8_t *data, size_t len, DecodedIncrement &out, std::string &err) {
  out = DecodedIncrement{};
  if (len < 4) {
    err = "frame too small for length prefix";
    return false;
  }

  const uint32_t jsonLen = readU32BE(data);
  const size_t header = 4u + static_cast<size_t>(jsonLen);
  if (jsonLen > (1u << 27)) {
    err = "json length unreasonable";
    return false;
  }
  if (len < header) {
    err = "truncated frame (json)";
    return false;
  }

  const uint8_t *jsonBegin = data + 4;
  const uint8_t *pngBegin = data + header;
  const size_t pngLen = len - header;
  if (pngLen == 0) {
    err = "empty png segment";
    return false;
  }
  if (!isPngMagic(pngBegin, pngLen)) {
    err = "png magic mismatch";
    return false;
  }

  out.metaJsonUtf8.assign(reinterpret_cast<const char *>(jsonBegin), reinterpret_cast<const char *>(jsonBegin) + jsonLen);

  int w = 0;
  int h = 0;
  int channels = 0;
  unsigned char *pixels =
      stbi_load_from_memory(pngBegin, static_cast<int>(pngLen), &w, &h, &channels, 4);
  if (!pixels || w <= 0 || h <= 0) {
    if (pixels) {
      stbi_image_free(pixels);
    }
    err = std::string("stb_image decode failed: ") + (stbi_failure_reason() ? stbi_failure_reason() : "unknown");
    return false;
  }

  const size_t rgbaBytes = static_cast<size_t>(w) * static_cast<size_t>(h) * 4u;
  out.width = w;
  out.height = h;
  out.rgba.resize(rgbaBytes);
  std::memcpy(out.rgba.data(), pixels, rgbaBytes);
  stbi_image_free(pixels);
  return true;
}

} // namespace mapmock
