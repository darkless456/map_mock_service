# Third-Party Dependencies Setup

This directory holds external libraries required by `MapStreamModule`.
**None of them are committed to the repository** — they must be downloaded/built by the integrator.

---

## 1. stb_image.h (PNG Decoder)

**Location after download**: `../mapstream/stb_image.h`

```bash
# From the cpp/ directory:
curl -o mapstream/stb_image.h \
  https://raw.githubusercontent.com/nothings/stb/master/stb_image.h
```

License: MIT / Public Domain. Repository: https://github.com/nothings/stb

---

## 2. Paho MQTT C Library (Async Client)

**Source**: https://github.com/eclipse/paho.mqtt.c

### 2a. Headers

After building (see §2b), copy the following headers to `paho-mqtt/include/`:

```
third_party/paho-mqtt/include/
├── MQTTAsync.h
├── MQTTClient.h
├── MQTTProperties.h
├── MQTTReasonCodes.h
├── MQTTSubscribeOpts.h
└── MQTTExportDeclarations.h
```

### 2b. Pre-built .so for Android (per ABI)

**Location**: `jniLibs/<ABI>/libpaho-mqtt3as.so`

Build script (requires Android NDK):

```bash
git clone https://github.com/eclipse/paho.mqtt.c.git
cd paho.mqtt.c

for ABI in arm64-v8a armeabi-v7a x86 x86_64; do
  mkdir -p build-$ABI && cd build-$ABI
  cmake .. \
    -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
    -DANDROID_ABI=$ABI \
    -DANDROID_PLATFORM=android-27 \
    -DPAHO_WITH_SSL=OFF \
    -DPAHO_BUILD_SHARED=ON \
    -DPAHO_BUILD_STATIC=OFF \
    -DCMAKE_BUILD_TYPE=Release
  make -j$(nproc)
  mkdir -p <path-to-this-dir>/jniLibs/$ABI
  cp src/libpaho-mqtt3as.so <path-to-this-dir>/jniLibs/$ABI/
  cd ..
done
```

### 2c. Pre-built .a for iOS (Universal / XCFramework)

```bash
# Build for iOS device (arm64) and simulator (arm64 + x86_64)
cd paho.mqtt.c

# iOS device
cmake -B build-ios -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DPAHO_WITH_SSL=OFF \
  -DPAHO_BUILD_STATIC=ON \
  -DPAHO_BUILD_SHARED=OFF
cmake --build build-ios --config Release

# iOS Simulator
cmake -B build-sim -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DPAHO_WITH_SSL=OFF \
  -DPAHO_BUILD_STATIC=ON \
  -DPAHO_BUILD_SHARED=OFF
cmake --build build-sim --config Release

# Create XCFramework
xcodebuild -create-xcframework \
  -library build-ios/Release-iphoneos/libpaho-mqtt3a.a \
  -library build-sim/Release-iphonesimulator/libpaho-mqtt3a.a \
  -output <path-to-this-dir>/paho-mqtt/PahoMQTT.xcframework
```

---

## Expected Final Structure

```
third_party/
├── SETUP.md                        ← this file
├── paho-mqtt/
│   ├── include/
│   │   ├── MQTTAsync.h
│   │   ├── MQTTClient.h
│   │   ├── MQTTProperties.h
│   │   ├── MQTTReasonCodes.h
│   │   ├── MQTTSubscribeOpts.h
│   │   └── MQTTExportDeclarations.h
│   └── PahoMQTT.xcframework/       ← iOS only
│       ├── ios-arm64/
│       └── ios-arm64_x86_64-simulator/
└── jniLibs/                        ← Android only
    ├── arm64-v8a/
    │   └── libpaho-mqtt3as.so
    ├── armeabi-v7a/
    │   └── libpaho-mqtt3as.so
    ├── x86/
    │   └── libpaho-mqtt3as.so
    └── x86_64/
        └── libpaho-mqtt3as.so
```
