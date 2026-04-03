# Paste/adapt into your app CMakeLists (Android) or Xcode project (iOS).
#
# Assumes this repo is vendored and `third_party/stb_image.h` is reachable.

add_library(mapframeparser_core STATIC
  MapFrameParserCore.cpp
  MapFrameParserJsi.cpp
)

target_include_directories(mapframeparser_core PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party"
)

target_compile_features(mapframeparser_core PUBLIC cxx_std_20)

# Link JSI + ReactCommon targets provided by the RN prefab / iOS pods:
#   target_link_libraries(mapframeparser_core PUBLIC ReactAndroid::jsi)
#   target_link_libraries(mapframeparser_core PUBLIC ReactAndroid::reactnativejni)
#
# iOS: add `.cpp` files to the target and set HEADER_SEARCH_PATHS to `third_party`.
