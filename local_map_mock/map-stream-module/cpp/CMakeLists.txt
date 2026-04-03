cmake_minimum_required(VERSION 3.22.1)
project(MapStreamModule CXX C)

# ─── NOTE ──────────────────────────────────────────────────────────────────
# This CMakeLists.txt targets Android (NDK).
# For iOS, see integration docs: ../docs/INTEGRATION_GUIDE.md §4.2
#
# Prerequisites before building:
#   1. Download stb_image.h →  mapstream/stb_image.h
#   2. Build Paho MQTT C    →  third_party/paho-mqtt/include/ + jniLibs/<ABI>/
# Full setup instructions:    ../docs/INTEGRATION_GUIDE.md §3
# ───────────────────────────────────────────────────────────────────────────

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 11)

set(MAPSTREAM_SRC_DIR ${CMAKE_CURRENT_SOURCE_DIR})

# ─── Paho MQTT C library ───────────────────────────────────────────────────
# Pre-built .so per ABI placed in third_party/jniLibs/${ANDROID_ABI}/
# (see build instructions in ../docs/INTEGRATION_GUIDE.md §3.2)
add_library(paho-mqtt3as SHARED IMPORTED)
set_target_properties(paho-mqtt3as PROPERTIES
  IMPORTED_LOCATION
    ${MAPSTREAM_SRC_DIR}/third_party/jniLibs/${ANDROID_ABI}/libpaho-mqtt3as.so
)
target_include_directories(paho-mqtt3as INTERFACE
  ${MAPSTREAM_SRC_DIR}/third_party/paho-mqtt/include
)

# ─── MapStream native module ──────────────────────────────────────────────
add_library(mapstream_module SHARED
  MapStreamModule.cpp
)

target_include_directories(mapstream_module PRIVATE
  ${MAPSTREAM_SRC_DIR}           # MapStreamModule.h
  ${MAPSTREAM_SRC_DIR}/mapstream # stb_image.h, MapTypes.h, etc.
)

# ─── React Native / JSI (provided by RN Gradle integration) ──────────────
# REACT_NATIVE_DIR is set automatically by react-native-gradle-plugin.
# If building outside of Gradle (e.g. unit tests), set it manually.
if(DEFINED REACT_NATIVE_DIR)
  target_include_directories(mapstream_module PRIVATE
    ${REACT_NATIVE_DIR}/ReactCommon
    ${REACT_NATIVE_DIR}/ReactCommon/jsi
    ${REACT_NATIVE_DIR}/ReactCommon/callinvoker
    ${REACT_NATIVE_DIR}/ReactCommon/turbomodule/core
    ${REACT_NATIVE_DIR}/ReactCommon/react/nativemodule/core
  )
  target_link_libraries(mapstream_module
    jsi
    react_nativemodule_core
  )
endif()

target_link_libraries(mapstream_module
  paho-mqtt3as
  log   # Android logging
)

# ─── Compiler flags ────────────────────────────────────────────────────────
target_compile_options(mapstream_module PRIVATE
  -Wall -Wextra -Wno-unused-parameter
  -fvisibility=hidden
  -O2
)
