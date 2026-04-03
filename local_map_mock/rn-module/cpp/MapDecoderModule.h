#pragma once

/**
 * MapDecoderModule — C++ TurboModule for RN 0.82 New Architecture
 *
 * Responsibilities:
 *  1. Parse the MQTT binary frame: [4B json_len][json_bytes][png_bytes]
 *  2. Decode PNG → RGBA raw pixels (stb_image, zero-copy friendly)
 *  3. Expose RGBA ArrayBuffer + metadata to JS via JSI
 */

#include <ReactCommon/TurboModule.h>
#include <ReactCommon/CallInvoker.h>
#include <jsi/jsi.h>
#include <memory>
#include <vector>
#include <string>
#include <cstring>
#include <thread>
#include <mutex>

// stb_image — single-header PNG decoder (define in ONE .cpp)
// #define STB_IMAGE_IMPLEMENTATION  // done in .cpp
#include "stb_image.h"

namespace facebook::react {

/**
 * Parsed incremental map fragment returned to JS.
 */
struct MapFragment {
  double timestamp_ms;
  double resolution;
  double origin_x;
  double origin_y;
  int    map_cols;
  int    map_rows;
  int    seq;

  // RGBA raw pixel data (map_cols * map_rows * 4 bytes)
  std::vector<uint8_t> rgbaData;
};

class MapDecoderModule : public TurboModule {
 public:
  MapDecoderModule(
      std::shared_ptr<CallInvoker> jsInvoker)
      : TurboModule("MapDecoderModule", jsInvoker) {}

  /**
   * Install JSI bindings onto the JS runtime.
   * Called once during module initialization.
   */
  static void install(
      jsi::Runtime& rt,
      std::shared_ptr<MapDecoderModule> module);

 private:
  /**
   * Core decode: binary frame buffer → MapFragment
   * Thread-safe, can be called from any thread.
   */
  static std::unique_ptr<MapFragment> decodeFrame(
      const uint8_t* data, size_t length);

  /**
   * JSI function: decodeMapFrame(arrayBuffer) → Promise<{metadata, rgbaBuffer}>
   * Performs PNG decode on a background thread, resolves on JS thread.
   */
  jsi::Value decodeMapFrameAsync(
      jsi::Runtime& rt,
      const jsi::Value& thisVal,
      const jsi::Value* args,
      size_t count);
};

// ───────────────────────────────────────────────────────────────────────────
// Implementation
// ───────────────────────────────────────────────────────────────────────────

inline void MapDecoderModule::install(
    jsi::Runtime& rt,
    std::shared_ptr<MapDecoderModule> module) {

  auto decodeFunc = jsi::Function::createFromHostFunction(
      rt,
      jsi::PropNameID::forAscii(rt, "decodeMapFrame"),
      1, // expect 1 argument: ArrayBuffer
      [weakModule = std::weak_ptr<MapDecoderModule>(module)](
          jsi::Runtime& rt,
          const jsi::Value& thisVal,
          const jsi::Value* args,
          size_t count) -> jsi::Value {
        auto mod = weakModule.lock();
        if (!mod) {
          throw jsi::JSError(rt, "MapDecoderModule has been destroyed");
        }
        return mod->decodeMapFrameAsync(rt, thisVal, args, count);
      });

  rt.global().setProperty(rt, "decodeMapFrame", std::move(decodeFunc));
}

inline std::unique_ptr<MapFragment> MapDecoderModule::decodeFrame(
    const uint8_t* data, size_t length) {
  // ─── Frame format ─────────────────────────────────────────────
  // [0..3]          uint32_be  json_length
  // [4..4+json_len) UTF-8 JSON metadata
  // [4+json_len..)  PNG binary
  if (length < 4) return nullptr;

  uint32_t jsonLen =
      (static_cast<uint32_t>(data[0]) << 24) |
      (static_cast<uint32_t>(data[1]) << 16) |
      (static_cast<uint32_t>(data[2]) << 8)  |
      (static_cast<uint32_t>(data[3]));

  if (4 + jsonLen > length) return nullptr;

  // Parse JSON (minimal: use a simple scan for known keys)
  std::string jsonStr(reinterpret_cast<const char*>(data + 4), jsonLen);

  auto fragment = std::make_unique<MapFragment>();

  // Simple JSON value extraction (avoids pulling in a JSON lib in C++)
  auto extractDouble = [&](const std::string& key) -> double {
    auto pos = jsonStr.find("\"" + key + "\"");
    if (pos == std::string::npos) return 0.0;
    pos = jsonStr.find(':', pos);
    if (pos == std::string::npos) return 0.0;
    return std::stod(jsonStr.substr(pos + 1));
  };
  auto extractInt = [&](const std::string& key) -> int {
    auto pos = jsonStr.find("\"" + key + "\"");
    if (pos == std::string::npos) return 0;
    pos = jsonStr.find(':', pos);
    if (pos == std::string::npos) return 0;
    return std::stoi(jsonStr.substr(pos + 1));
  };

  fragment->timestamp_ms = extractDouble("timestamp_ms");
  fragment->resolution   = extractDouble("resolution");
  fragment->origin_x     = extractDouble("origin_x");
  fragment->origin_y     = extractDouble("origin_y");
  fragment->map_cols     = extractInt("map_cols");
  fragment->map_rows     = extractInt("map_rows");
  fragment->seq          = extractInt("seq");

  // ─── PNG decode → RGBA ────────────────────────────────────────
  const uint8_t* pngData = data + 4 + jsonLen;
  size_t pngLen = length - 4 - jsonLen;

  int w = 0, h = 0, channels = 0;
  // Force 4-channel RGBA output
  uint8_t* decoded = stbi_load_from_memory(
      pngData, static_cast<int>(pngLen),
      &w, &h, &channels, 4 /*desired_channels=RGBA*/);

  if (!decoded) return nullptr;

  size_t rgbaSize = static_cast<size_t>(w) * h * 4;
  fragment->rgbaData.resize(rgbaSize);
  std::memcpy(fragment->rgbaData.data(), decoded, rgbaSize);
  stbi_image_free(decoded);

  // Override cols/rows with actual decoded dimensions (safety)
  fragment->map_cols = w;
  fragment->map_rows = h;

  return fragment;
}

inline jsi::Value MapDecoderModule::decodeMapFrameAsync(
    jsi::Runtime& rt,
    const jsi::Value& /*thisVal*/,
    const jsi::Value* args,
    size_t count) {

  if (count < 1 || !args[0].isObject()) {
    throw jsi::JSError(rt, "decodeMapFrame expects an ArrayBuffer argument");
  }

  auto arrayBuffer = args[0].asObject(rt).getArrayBuffer(rt);
  size_t byteLength = arrayBuffer.length(rt);
  uint8_t* rawPtr = arrayBuffer.data(rt);

  // Copy data for background thread (ArrayBuffer might be GC'd)
  auto dataCopy = std::make_shared<std::vector<uint8_t>>(rawPtr, rawPtr + byteLength);

  auto jsInvoker = jsInvoker_;

  // Create Promise
  auto promiseCtor = rt.global().getPropertyAsFunction(rt, "Promise");

  auto executor = jsi::Function::createFromHostFunction(
      rt,
      jsi::PropNameID::forAscii(rt, "executor"),
      2,
      [dataCopy, jsInvoker](
          jsi::Runtime& rt,
          const jsi::Value&,
          const jsi::Value* promiseArgs,
          size_t) -> jsi::Value {

        auto resolve = std::make_shared<jsi::Value>(rt, promiseArgs[0]);
        auto reject  = std::make_shared<jsi::Value>(rt, promiseArgs[1]);

        // Background decode thread
        std::thread([dataCopy, jsInvoker, resolve, reject]() {
          auto fragment = decodeFrame(dataCopy->data(), dataCopy->size());

          jsInvoker->invokeAsync([fragment = std::move(fragment),
                                  resolve, reject](jsi::Runtime& rt) {
            if (!fragment) {
              reject->asObject(rt).asFunction(rt).call(
                  rt, jsi::String::createFromUtf8(rt, "Frame decode failed"));
              return;
            }

            // Build result object
            jsi::Object result(rt);

            // Metadata sub-object
            jsi::Object meta(rt);
            meta.setProperty(rt, "timestamp_ms", fragment->timestamp_ms);
            meta.setProperty(rt, "resolution",   fragment->resolution);
            meta.setProperty(rt, "origin_x",     fragment->origin_x);
            meta.setProperty(rt, "origin_y",     fragment->origin_y);
            meta.setProperty(rt, "map_cols",      fragment->map_cols);
            meta.setProperty(rt, "map_rows",      fragment->map_rows);
            meta.setProperty(rt, "seq",           fragment->seq);
            result.setProperty(rt, "metadata", std::move(meta));

            // RGBA ArrayBuffer — zero-copy: move ownership into JSI
            size_t rgbaSize = fragment->rgbaData.size();
            auto rgbaPtr = std::make_shared<std::vector<uint8_t>>(
                std::move(fragment->rgbaData));

            // Create a MutableBuffer backed by our vector
            class VectorBuffer : public jsi::MutableBuffer {
             public:
              explicit VectorBuffer(std::shared_ptr<std::vector<uint8_t>> vec)
                  : vec_(std::move(vec)) {}
              uint8_t* data() override { return vec_->data(); }
              size_t size() const override { return vec_->size(); }

             private:
              std::shared_ptr<std::vector<uint8_t>> vec_;
            };

            auto buffer = std::make_shared<VectorBuffer>(rgbaPtr);
            auto arrayBuffer = jsi::ArrayBuffer(rt, std::move(buffer));
            result.setProperty(rt, "rgbaBuffer", std::move(arrayBuffer));

            resolve->asObject(rt).asFunction(rt).call(rt, std::move(result));
          });
        }).detach();

        return jsi::Value::undefined();
      });

  return promiseCtor.callAsConstructor(rt, std::move(executor));
}

} // namespace facebook::react
