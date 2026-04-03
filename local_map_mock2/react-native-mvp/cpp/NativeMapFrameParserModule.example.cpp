/**
 * Example TurboModule glue for React Native New Architecture (drop into your app after codegen).
 *
 * Replace the base class name with the one generated for your app, e.g.:
 *   class NativeMapFrameParser : public NativeMapFrameParserCxxSpec<NativeMapFrameParser>
 *
 * Register the module in your platform `*-TurboModuleManager` provider.
 *
 * Includes vary slightly by RN patch; adjust paths to match your template:
 *   #include <ReactCommon/TurboModule.h>
 *   #include <react/bridging/ArrayBuffer.h>
 */

// #include "NativeMapFrameParser.h" // generated header from codegen
#include "MapFrameParserJsi.h"
#include <jsi/jsi.h>
#include <memory>
#include <string>

// using namespace facebook;
// using namespace facebook::react;

// class NativeMapFrameParser : public NativeMapFrameParserCxxSpec<NativeMapFrameParser> {
//  public:
//   NativeMapFrameParser(std::shared_ptr<CallInvoker> jsInvoker) : NativeMapFrameParserCxxSpec(std::move(jsInvoker)) {}
//
//   jsi::Value decodeIncrementFrame(jsi::Runtime &rt, jsi::ArrayBuffer frame) override {
//     return mapmock::decodeIncrementFrameSync(rt, std::move(frame));
//   }
// };
