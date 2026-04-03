/*
 * Placeholder: Paho MQTT C headers
 *
 * ── Do NOT commit real Paho headers to this repository ──
 *
 * See:  map-stream-module/cpp/third_party/SETUP.md
 *       map-stream-module/docs/INTEGRATION_GUIDE.md  §3 — Third-party Setup
 *
 * Download the Paho MQTT C library source:
 *   https://github.com/eclipse/paho.mqtt.c
 *
 * Quick setup — build for Android (one ABI example):
 *
 *   git clone https://github.com/eclipse/paho.mqtt.c.git
 *   cd paho.mqtt.c && mkdir build-arm64 && cd build-arm64
 *   cmake .. \
 *     -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
 *     -DANDROID_ABI=arm64-v8a \
 *     -DANDROID_PLATFORM=android-27 \
 *     -DPAHO_WITH_SSL=OFF \
 *     -DPAHO_BUILD_SHARED=ON \
 *     -DPAHO_BUILD_STATIC=OFF \
 *     -DCMAKE_BUILD_TYPE=Release
 *   make -j$(nproc)
 *
 * Then copy these headers to this directory:
 *   MQTTAsync.h
 *   MQTTClient.h
 *   MQTTProperties.h
 *   MQTTReasonCodes.h
 *   MQTTSubscribeOpts.h
 *   MQTTExportDeclarations.h
 *
 * And copy libpaho-mqtt3as.so to:
 *   map-stream-module/cpp/third_party/jniLibs/${ANDROID_ABI}/libpaho-mqtt3as.so
 *
 * For iOS: see SETUP.md §2c for XCFramework build steps.
 */
#error "Please download Paho MQTT C headers and place them in this directory. See third_party/SETUP.md."
