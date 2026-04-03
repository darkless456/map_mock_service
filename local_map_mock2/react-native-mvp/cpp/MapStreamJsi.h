#pragma once

#include <jsi/jsi.h>

#include <memory>

namespace mapstream {
struct DecodedMapFrame;
}

namespace mapstream_jsi {

/**
 * Builds a JS object:
 *   { metaJson, width, height, sequence, rgba: ArrayBuffer }
 *
 * `rgba` is backed by a jsi::MutableBuffer implementation that holds a shared_ptr to the
 * underlying std::vector<uint8_t>. When Hermes / RN uses the non-copying ArrayBuffer constructor,
 * JS holds the same bytes as C++ until GC collects the ArrayBuffer (then the vector refcount drops).
 *
 * If your engine version copies on ArrayBuffer construction, profile and adjust (see docs).
 */
facebook::jsi::Value decodedFrameToJs(
    facebook::jsi::Runtime &rt,
    std::shared_ptr<const mapstream::DecodedMapFrame> frame);

} // namespace mapstream_jsi
