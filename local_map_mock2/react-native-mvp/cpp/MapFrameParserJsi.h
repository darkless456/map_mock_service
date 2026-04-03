#pragma once

#include <jsi/jsi.h>

#include "MapFrameParserCore.h"

namespace mapmock {

/**
 * Marshals a decoded frame into a plain JS object:
 *   { metaJson: string, width: number, height: number, rgba: ArrayBuffer }
 *
 * Copies RGBA into a fresh JS ArrayBuffer (Hermes-owned storage).
 */
facebook::jsi::Value marshalDecodedToJs(facebook::jsi::Runtime &rt, const DecodedIncrement &decoded);

/**
 * Synchronous decode + marshal. Throws jsi::JSError on failure.
 *
 * Memory: copies MQTT payload bytes, then copies RGBA into a new ArrayBuffer.
 * For production, replace the outer copy with a pinned external buffer policy, and
 * offload decode to a native thread using a RuntimeScheduler (see docs).
 */
facebook::jsi::Value decodeIncrementFrameSync(facebook::jsi::Runtime &rt, facebook::jsi::ArrayBuffer frame);

} // namespace mapmock
