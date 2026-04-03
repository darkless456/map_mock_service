cmake_minimum_required(VERSION 3.13)
project(MapDecoderModule CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ─── Source files ──────────────────────────────────────────────────────
add_library(map_decoder_module SHARED
  MapDecoderModule.cpp
)

# ─── stb_image is header-only, ensure it's on include path ─────────
target_include_directories(map_decoder_module PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}
)

# ─── React Native / JSI includes (set by RN's Gradle/CMake integration) ──
# These variables are typically provided by the RN build system:
#   REACT_NATIVE_DIR, FBJNI_DIR, etc.
#
# For Android (set by RN 0.82 new arch CMake integration):
if(DEFINED REACT_NATIVE_DIR)
  target_include_directories(map_decoder_module PRIVATE
    ${REACT_NATIVE_DIR}/ReactCommon
    ${REACT_NATIVE_DIR}/ReactCommon/jsi
    ${REACT_NATIVE_DIR}/ReactCommon/callinvoker
    ${REACT_NATIVE_DIR}/ReactCommon/turbomodule/core
  )

  # Link against the pre-built JSI / TurboModule libraries
  target_link_libraries(map_decoder_module
    jsi
    react_nativemodule_core
    turbomodulejsijni
  )
endif()

# ─── iOS: handled via Podspec, this CMake is Android-focused ──────
# For iOS, add MapDecoderModule.cpp to your Podspec's source_files
# and ensure stb_image.h is accessible.

# ─── Compiler warnings ───────────────────────────────────────────
target_compile_options(map_decoder_module PRIVATE
  -Wall -Wextra -Wno-unused-parameter
)
