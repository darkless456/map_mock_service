#include "MapFrameParserJsi.h"

#include <cstring>
#include <vector>

namespace mapmock {

using namespace facebook;

static jsi::ArrayBuffer createRgbaArrayBuffer(jsi::Runtime &rt, const std::vector<uint8_t> &rgba) {
  if (rgba.empty()) {
    throw jsi::JSError(rt, "empty rgba buffer");
  }

  jsi::Function ctor = rt.global().getPropertyAsFunction(rt, "ArrayBuffer");
  jsi::Value size(static_cast<double>(rgba.size()));
  jsi::Object abObj = ctor.callAsConstructor(rt, size).getObject(rt);
  jsi::ArrayBuffer ab = abObj.getArrayBuffer(rt);
  std::uint8_t *dst = reinterpret_cast<std::uint8_t *>(ab.data(rt));
  if (!dst || ab.size(rt) != rgba.size()) {
    throw jsi::JSError(rt, "ArrayBuffer allocation failed");
  }
  std::memcpy(dst, rgba.data(), rgba.size());
  return ab;
}

jsi::Value marshalDecodedToJs(jsi::Runtime &rt, const DecodedIncrement &decoded) {
  jsi::Object o(rt);
  o.setProperty(rt, "metaJson", jsi::String::createFromUtf8(rt, decoded.metaJsonUtf8));
  o.setProperty(rt, "width", decoded.width);
  o.setProperty(rt, "height", decoded.height);

  jsi::ArrayBuffer rgba = createRgbaArrayBuffer(rt, decoded.rgba);
  o.setProperty(rt, "rgba", std::move(rgba));
  return o;
}

jsi::Value decodeIncrementFrameSync(jsi::Runtime &rt, jsi::ArrayBuffer frame) {
  const size_t len = frame.size(rt);
  void *raw = frame.data(rt);
  if (!raw || len == 0) {
    throw jsi::JSError(rt, "empty frame");
  }

  const auto *bytes = static_cast<const uint8_t *>(raw);
  std::vector<uint8_t> copy(bytes, bytes + len);

  DecodedIncrement out;
  std::string err;
  if (!decodeIncrementFrame(copy.data(), copy.size(), out, err)) {
    throw jsi::JSError(rt, err);
  }

  return marshalDecodedToJs(rt, out);
}

} // namespace mapmock
