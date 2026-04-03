/**
 * MapDecoderModule.cpp — Compilation unit
 *
 * Pull in stb_image implementation + module registration glue.
 */

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#include "MapDecoderModule.h"

// Module registration is typically done in the app's OnLoad or via
// TurboModuleProvider. Example registration:
//
//   #include "MapDecoderModule.h"
//
//   // In your app's native module registration:
//   auto module = std::make_shared<facebook::react::MapDecoderModule>(jsInvoker);
//   facebook::react::MapDecoderModule::install(runtime, module);
