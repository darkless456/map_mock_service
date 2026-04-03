# MapStreamModule — Integration Guide

Full manual integration instructions for Android and iOS in a React Native 0.82+ (New Architecture) project.

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Architecture Deep-Dive](#2-architecture-deep-dive)
3. [Third-Party Dependency Setup](#3-third-party-dependency-setup)
4. [Android Integration](#4-android-integration)
5. [iOS Integration](#5-ios-integration)
6. [JS Layer Integration](#6-js-layer-integration)
7. [API Reference](#7-api-reference)
8. [Memory Management](#8-memory-management)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Module Overview

### 1.1 What It Does

`MapStreamModule` streams incremental map fragments over MQTT to a React Native app with near-zero latency. It does all heavy lifting in C++:

- **MQTT receive** — Paho MQTT C async client; non-blocking network thread
- **PNG decode** — stb_image on a dedicated decode worker thread
- **Buffer management** — lock-free triple-buffer queue; zero-copy JSI ArrayBuffer to JS

### 1.2 File Structure

```
map-stream-module/
├── cpp/
│   ├── CMakeLists.txt             ← Android NDK build config
│   ├── MapStreamModule.h          ← JSI TurboModule glue (10 global functions)
│   ├── MapStreamModule.cpp        ← stb_image compilation unit
│   ├── mapstream/
│   │   ├── MapTypes.h             ← Shared plain-C++ types (no platform deps)
│   │   ├── FrameQueue.h           ← Lock-free SPSC triple-buffer
│   │   ├── FrameDecoder.h         ← Stateless frame parser (header+JSON+PNG→RGBA)
│   │   ├── MqttClient.h           ← Paho MQTT C async wrapper
│   │   ├── MapStreamWorker.h      ← State machine + thread orchestration
│   │   └── stb_image.h            ← PLACEHOLDER — download before building
│   └── third_party/
│       ├── SETUP.md               ← Detailed build scripts for all platforms
│       ├── paho-mqtt/
│       │   └── include/
│       │       └── MQTTAsync.h    ← PLACEHOLDER — copy real headers here
│       └── jniLibs/               ← PLACEHOLDER — place Android .so files here
│           ├── arm64-v8a/libpaho-mqtt3as.so
│           ├── armeabi-v7a/libpaho-mqtt3as.so
│           ├── x86/libpaho-mqtt3as.so
│           └── x86_64/libpaho-mqtt3as.so
├── js/
│   ├── mapStreamBridge.ts         ← TypeScript types + MapStream API object
│   └── useMapStream.ts            ← React hook for lifecycle management
└── docs/
    └── INTEGRATION_GUIDE.md       ← ← ← You are here
```

### 1.3 Layer Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  JS Layer (React)                                                │
│  useMapStream()  ──→  mapStreamBridge.ts  ──→  Three.js render  │
└──────────────────────────┬───────────────────────────────────────┘
                           │  JSI (direct C++ call, zero serialization)
┌──────────────────────────▼───────────────────────────────────────┐
│  JSI Glue (MapStreamModule.h)                                    │
│  10 mapStream_* global functions  ·  FragmentBuffer (zero-copy) │
└──────────────────────────┬───────────────────────────────────────┘
                           │  C++ function calls
┌──────────────────────────▼───────────────────────────────────────┐
│  C++ Business Logic                                              │
│  MapStreamWorker  ──→  MqttClient  ──→  FrameDecoder            │
│        └───────────────────→  FrameQueue (triple-buffer)        │
└──────────────────────────────────────────────────────────────────┘
                           │  TCP
                     MQTT Broker
```

---

## 2. Architecture Deep-Dive

### 2.1 Threading Model

Three threads collaborate:

| Thread | Owner | Role |
|--------|-------|------|
| **JS Thread** | React Native runtime | Calls API functions, acquires frames, runs callbacks |
| **Paho Network Thread** | Paho library (internal) | Receives raw MQTT payloads, pushes to `rawQueue_` |
| **Decode Worker** | `MapStreamWorker` (managed) | Pops from `rawQueue_`, decodes PNG, publishes to `FrameQueue` |

```
JS Thread           Paho Thread          Decode Worker
     │                   │                     │
     │  connect()        │                     │
     │──────────────────►│  (TCP connect)       │
     │                   │                     │
     │  start()          │                     │
     │────────┐          │                     │
     │        │ spawns   │                     │
     │        └─────────────────────────────►  │  (thread starts)
     │                   │                     │
     │             MQTT msg arrives             │
     │                   │──rawQueue.push()────►│
     │                   │  (mutex+cv, bounded 10)
     │                   │                     │
     │                   │              parse header
     │                   │              decode PNG
     │                   │              FrameQueue.publish()
     │                   │                     │
     │  invokeAsync(onFrameReady)◄─────────────┤
     │  acquireFrame()   │                     │
     │  → jsi::ArrayBuffer (zero-copy)         │
```

### 2.2 Lock-Free Triple Buffer

`FrameQueue` uses three slots to let producer and consumer run at different rates with no mutex on the hot path:

```
Slots:  [back]   [ready]   [front]
         Decode   Pending    JS

Producer publish():
  1. Write decoded frame to slots_[back]
  2. atomic swap(back, ready)   ← O(1), no lock
  3. hasNew_.store(true)

Consumer acquire():
  1. if !hasNew_.load() → return nullptr  (no new frame)
  2. atomic swap(front, ready)  ← O(1), no lock
  3. hasNew_.store(false)
  4. return slots_[front]
```

**Guarantees**: Producer and consumer never touch the same slot simultaneously. Consumer always gets the newest frame; intermediate frames are silently dropped (correct behavior for real-time map rendering).

### 2.3 State Machine

```
                    connect(config)
  Disconnected ──────────────────► Connecting
       ▲                               │
       │                ┌──────────────┤
       │  disconnect()  │ onSuccess    │ onFailure
       │                ▼             ▼
       │           Connected        Error
       │                │             │
       │  disconnect()  │ start()     │ disconnect()
       │◄───────────────┤             │
       │                ▼             │
       │           Subscribing        │
       │                │             │
       │         onSubscribeSuccess   │
       │                ▼             │
       │           Streaming ◄────────┘ (reset)
       │           │        │
       │  pause()  │        │ stop()
       │           ▼        │
       │          Paused    │
       │           │        │
       │  resume() │        │
       │           └────────┘
       │
       └── disconnect() from any state
```

**Paused state**: MQTT connection stays alive (heartbeat), decode worker sleeps — minimal CPU usage.

### 2.4 Zero-Copy ArrayBuffer Chain

The pixel data from `stb_image` reaches the JS `DataTexture` with **no memcpy on the hot path**:

```
Decode Thread:
  stbi_load_from_memory()          ← allocates pixels in stb heap
  → memcpy → MapFragment.rgba      ← copy INTO vector (1 copy total)
  → stbi_image_free()              ← immediately frees stb heap
  → shared_ptr<MapFragment>
  → FrameQueue.publish()           ← atomic swap, no copy

JS Thread:
  FrameQueue.acquire()             ← atomic swap, no copy
  → FragmentBuffer(shared_ptr)     ← holds ref, points to vector.data()
  → jsi::ArrayBuffer(FragmentBuffer)  ← JS sees raw pointer, no copy
  → Three.js DataTexture.image.data   ← GPU upload

GC:
  ArrayBuffer collected
  → ~FragmentBuffer()
  → shared_ptr refcount drops
  → (if last ref) → ~MapFragment() → vector deallocated
```

Total copies of pixel data: **exactly 1** (from stb heap into `MapFragment.rgba`).

---

## 3. Third-Party Dependency Setup

> Full build scripts are also in `cpp/third_party/SETUP.md`.

### 3.1 stb_image.h

Single-header PNG decoder. Download directly into the module:

```bash
# From map-stream-module/cpp/
curl -o mapstream/stb_image.h \
  https://raw.githubusercontent.com/nothings/stb/master/stb_image.h
```

License: MIT / Public Domain — safe to redistribute.

### 3.2 Paho MQTT C — Android (per-ABI .so)

```bash
git clone https://github.com/eclipse/paho.mqtt.c.git
cd paho.mqtt.c

# Build for each ABI (required: arm64-v8a, armeabi-v7a; optional: x86, x86_64)
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
  mkdir -p <path-to-module>/cpp/third_party/jniLibs/$ABI
  cp src/libpaho-mqtt3as.so <path-to-module>/cpp/third_party/jniLibs/$ABI/
  cd ..
done

# Copy headers (from paho.mqtt.c/src/)
mkdir -p <path-to-module>/cpp/third_party/paho-mqtt/include
cp src/MQTTAsync.h src/MQTTClient.h src/MQTTProperties.h \
   src/MQTTReasonCodes.h src/MQTTSubscribeOpts.h src/MQTTExportDeclarations.h \
   <path-to-module>/cpp/third_party/paho-mqtt/include/
```

### 3.3 Paho MQTT C — iOS (XCFramework)

```bash
cd paho.mqtt.c

# iOS device (arm64)
cmake -B build-ios-device -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DCMAKE_OSX_SYSROOT=iphoneos \
  -DPAHO_WITH_SSL=OFF \
  -DPAHO_BUILD_STATIC=ON \
  -DPAHO_BUILD_SHARED=OFF
cmake --build build-ios-device --config Release

# iOS Simulator (arm64 + x86_64)
cmake -B build-ios-sim -G Xcode \
  -DCMAKE_SYSTEM_NAME=iOS \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
  -DCMAKE_OSX_SYSROOT=iphonesimulator \
  -DPAHO_WITH_SSL=OFF \
  -DPAHO_BUILD_STATIC=ON \
  -DPAHO_BUILD_SHARED=OFF
cmake --build build-ios-sim --config Release

# Create XCFramework
xcodebuild -create-xcframework \
  -library build-ios-device/Release-iphoneos/libpaho-mqtt3a.a \
  -library build-ios-sim/Release-iphonesimulator/libpaho-mqtt3a.a \
  -output <path-to-module>/cpp/third_party/paho-mqtt/PahoMQTT.xcframework
```

---

## 4. Android Integration

### 4.1 Copy Files Into Project

Copy the entire `map-stream-module/cpp/` into your Android app:

```
your-rn-app/android/app/src/main/
├── cpp/
│   ├── CMakeLists.txt           ← keep or merge with existing
│   ├── MapStreamModule.h
│   ├── MapStreamModule.cpp
│   └── mapstream/
│       ├── MapTypes.h
│       ├── FrameQueue.h
│       ├── FrameDecoder.h
│       ├── MqttClient.h
│       ├── MapStreamWorker.h
│       └── stb_image.h          ← download first (§3.1)
└── jniLibs/
    ├── arm64-v8a/libpaho-mqtt3as.so
    ├── armeabi-v7a/libpaho-mqtt3as.so
    ├── x86/libpaho-mqtt3as.so
    └── x86_64/libpaho-mqtt3as.so
```

Place paho headers at:
```
android/app/src/main/cpp/paho-mqtt/include/MQTTAsync.h   (+ other headers)
```

Update `CMakeLists.txt` paho path to match (it currently points to `third_party/paho-mqtt/include` — adjust to `paho-mqtt/include` if you drop the `third_party/` wrapper).

### 4.2 CMakeLists.txt

The provided `CMakeLists.txt` is ready to use. Key points:

- **paho path**: `third_party/jniLibs/${ANDROID_ABI}/libpaho-mqtt3as.so` — adjust to your actual `.so` location
- **`REACT_NATIVE_DIR`**: set automatically by `react-native-gradle-plugin`; no manual action needed for standard RN projects
- **`mapstream_module`**: the resulting shared library that gets loaded via `System.loadLibrary`

If you rename the `cpp/` directory when copying into your app, update `CMAKE_CURRENT_SOURCE_DIR`-relative paths accordingly.

### 4.3 `android/app/build.gradle`

```groovy
android {
    defaultConfig {
        minSdk 27

        externalNativeBuild {
            cmake {
                cppFlags "-std=c++17 -frtti -fexceptions"
                arguments "-DANDROID_STL=c++_shared"
            }
        }
        ndk {
            abiFilters "arm64-v8a", "armeabi-v7a"
        }
    }

    externalNativeBuild {
        cmake {
            path "src/main/cpp/CMakeLists.txt"
            version "3.22.1"
        }
    }

    // Ensure the paho .so is packaged into the APK
    packagingOptions {
        jniLibs {
            useLegacyPackaging = true  // required for non-compressed .so
        }
    }
}
```

### 4.4 Load the Library + Register JSI Module

In React Native 0.82 new architecture, JSI module registration happens in C++ via the `OnLoad` mechanism.

**Option A — via `MainApplicationTurboModuleManagerDelegate`** (recommended for new arch):

Create or modify `android/app/src/main/jni/OnLoad.cpp`:

```cpp
#include <fbjni/fbjni.h>
#include "MapStreamModule.h"

// Called by React Native as part of JSI runtime setup.
// The exact integration point depends on your RN version setup.
// For RN 0.82+ with the default template, add this to your
// ReactInstanceManager / ReactHost initialization.
extern "C" JNIEXPORT void JNICALL
Java_com_yourapp_MainApplication_installMapStream(
    JNIEnv* env, jobject thiz,
    jlong jsRuntimePtr,
    jobject jsCallInvokerHolder) {

  auto runtime = reinterpret_cast<facebook::jsi::Runtime*>(jsRuntimePtr);
  auto holder = jni::make_local(
      reinterpret_cast<facebook::react::CallInvokerHolder::javaobject>(jsCallInvokerHolder));
  auto invoker = holder->cthis()->getCallInvoker();

  facebook::react::installMapStreamModule(*runtime, invoker);
}
```

**Option B — via `ReactPackage` + JSI installation** (simpler for quick integration):

```kotlin
// android/app/src/main/java/com/yourapp/MapStreamPackage.kt
class MapStreamPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) =
        emptyList<NativeModule>()
    override fun createViewManagers(context: ReactApplicationContext) =
        emptyList<ViewManager<*, *>>()
}
```

Then in your `MainApplication.kt`, install via `ReactInstanceEventListener`:

```kotlin
reactHost.addReactInstanceEventListener(object : ReactInstanceEventListener {
    override fun onReactContextInitialized(context: ReactContext) {
        context.runOnJSQueueThread {
            val runtime = context.javaScriptContextHolder?.get() ?: return@runOnJSQueueThread
            // Cast to jsi::Runtime* and call installMapStreamModule
            // This requires JNI bridge — see Option A for the native side
            installMapStream(runtime, context.catalystInstance.jsCallInvokerHolder)
        }
    }
})
```

**Load the shared library** in `MainApplication.kt`:

```kotlin
companion object {
    init {
        System.loadLibrary("mapstream_module")
    }
}
```

### 4.5 ProGuard

No Java/Kotlin classes to keep. The `.so` is loaded directly — no additional ProGuard rules needed.

---

## 5. iOS Integration

### 5.1 Copy Files Into Project

```
your-rn-app/ios/
└── MapStreamModule/           ← create this folder
    ├── MapStreamModule.h
    ├── MapStreamModule.cpp
    └── mapstream/
        ├── MapTypes.h
        ├── FrameQueue.h
        ├── FrameDecoder.h
        ├── MqttClient.h
        ├── MapStreamWorker.h
        └── stb_image.h        ← download first (§3.1)
```

Place paho headers alongside or under a `paho-mqtt/include/` path accessible to the build.

### 5.2 Podspec (CocoaPods)

Create `ios/MapStreamModule/MapStreamModule.podspec`:

```ruby
require "json"

Pod::Spec.new do |s|
  s.name             = "MapStreamModule"
  s.version          = "1.0.0"
  s.summary          = "C++ async MQTT map stream module for React Native"
  s.homepage         = "https://github.com/your-org/your-repo"
  s.license          = { :type => "MIT" }
  s.author           = { "Your Name" => "you@example.com" }
  s.platforms        = { :ios => "15.0" }

  s.source           = { :path => "." }
  s.source_files     = [
    "MapStreamModule.{h,cpp}",
    "mapstream/*.h",
    "paho-mqtt/include/*.h",
  ]
  s.private_header_files = "mapstream/*.h"

  # Link pre-built Paho static library
  s.vendored_frameworks = "paho-mqtt/PahoMQTT.xcframework"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD"        => "c++17",
    "CLANG_ENABLE_OBJC_EXCEPTIONS"       => "YES",
    "GCC_PREPROCESSOR_DEFINITIONS"       => "$(inherited)",
    "HEADER_SEARCH_PATHS"                => [
      '"$(PODS_TARGET_SRCROOT)"',
      '"$(PODS_TARGET_SRCROOT)/mapstream"',
      '"$(PODS_TARGET_SRCROOT)/paho-mqtt/include"',
    ].join(" "),
    "OTHER_CPLUSPLUSFLAGS"               => "-fvisibility=hidden -O2",
  }

  s.dependency "React-jsi"
  s.dependency "React-callinvoker"
end
```

In your app's `Podfile`, add:

```ruby
pod 'MapStreamModule', :path => './MapStreamModule'
```

Run `pod install`.

### 5.3 Manual Xcode Integration (without CocoaPods)

1. In Xcode, drag the `MapStreamModule/` folder into your project. Check "Copy items if needed".
2. In **Build Settings** for `MapStreamModule.cpp`:
   - `C++ Language Dialect`: `C++17`
   - `Header Search Paths`: add path to `mapstream/` and `paho-mqtt/include/`
3. In **Build Phases → Link Binary With Libraries**: add `PahoMQTT.xcframework`
4. Ensure `ENABLE_BITCODE = NO` (Paho XCFramework may not have bitcode)

### 5.4 AppDelegate — JSI Registration

In `ios/YourApp/AppDelegate.mm`:

```objc
#import "AppDelegate.h"
#include "MapStreamModule.h"

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  self.moduleName = @"YourApp";
  // ... standard RN setup ...
  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

// RN 0.71+ new arch: override this to install JSI modules
- (void)hostDidStart:(RCTHost *)host {
  [host addModuleClass:[RCTBridgelessModule class]];
}

// For JSI installation, use the JSI runtime setup callback:
// In RN 0.73+ with the new Bridgeless architecture:
- (std::shared_ptr<facebook::react::TurboModule>)
    getTurboModule:(const std::string &)name
    initParams:(const facebook::react::ObjCTurboModule::InitParams &)params {
  // Not a TurboModule; use direct JSI installation instead
  return nullptr;
}

@end
```

For direct JSI installation (no TurboModule registry), add this to a native module or `RCTBridge` delegate:

```objc
// When the JS runtime is ready:
- (void)reactBridgeDidFinishLoading:(RCTBridge *)bridge {
  auto runtime = (facebook::jsi::Runtime *)bridge.jsContextRef;
  auto callInvoker = bridge.jsCallInvoker;
  facebook::react::installMapStreamModule(*runtime, callInvoker);
}
```

> **Note**: The exact hook (bridgeDidFinishLoading vs hostDidStart) depends on your RN version and whether you use the old bridge or the new bridgeless mode. In RN 0.82, prefer the bridgeless path via `RCTHostDelegate`.

---

## 6. JS Layer Integration

### 6.1 File Placement

Copy both files from `map-stream-module/js/` into your app:

```
src/
├── native/
│   └── mapStreamBridge.ts    ← TypeScript types + MapStream object
└── hooks/
    └── useMapStream.ts       ← React hook
```

Adjust import paths inside `useMapStream.ts` if you place them in different directories.

### 6.2 Basic Usage with `useMapStream` Hook

```tsx
import { useMapStream } from '../hooks/useMapStream';

function LiveMapScreen() {
  const rendererRef = useRef(null);

  const { state, connect, start, stop, disconnect } = useMapStream({
    brokerUrl: '192.168.1.100',  // or 'ws://...' for WebSocket transport
    port: 1883,
    topic: 'robot/map/increment',
    autoConnect: true,           // connects on mount
    autoStart: true,             // starts streaming after connect
    onFrame: (frame) => {
      // frame.rgbaBuffer: ArrayBuffer — direct pointer to C++ memory (zero-copy)
      // frame.metadata.x, frame.metadata.y, frame.metadata.width, frame.metadata.height
      // frame.metadata.sequence: monotonic frame counter
      rendererRef.current?.applyFragment(frame);
    },
  });

  return (
    <View>
      <Text>State: {state}</Text>
      <Button title="Pause" onPress={() => MapStream.pause()} />
      <Button title="Resume" onPress={() => MapStream.resume()} />
    </View>
  );
}
```

The hook handles:
- Auto-connect on mount (if `autoConnect: true`)
- Auto-start streaming after `Connected` state (if `autoStart: true`)
- `disconnect()` on unmount — prevents dangling C++ callbacks

### 6.3 Manual Control via `MapStream` Object

```typescript
import { MapStream, StreamState, isNativeMapStreamAvailable } from '../native/mapStreamBridge';

// Check if native module was registered
if (!isNativeMapStreamAvailable()) {
  console.warn('Native MapStream not loaded — check JSI installation');
}

// Connect to broker
await MapStream.connect({
  brokerUrl: '192.168.1.100',
  port: 1883,
  clientId: 'rn-robot-map-001',     // optional, auto-generated if omitted
  keepAliveInterval: 30,             // seconds
  cleanSession: true,
});

// Register state change callback
MapStream.onStateChange((newState: StreamState) => {
  console.log('MQTT state:', newState);
  if (newState === 'streaming') {
    console.log('Ready to receive frames');
  }
});

// Start streaming (subscribes to MQTT topic)
MapStream.start();

// Register frame callback (called from C++ via invokeAsync)
MapStream.onFrameReady(() => {
  const frame = MapStream.acquireFrame();  // zero-copy ArrayBuffer
  if (frame) {
    // Use frame.rgbaBuffer and frame.metadata
  }
});

// Lifecycle
MapStream.pause();     // stop decoding, keep MQTT alive
MapStream.resume();    // resume decoding
MapStream.stop();      // unsubscribe, keep connected
MapStream.disconnect(); // full shutdown, join threads
```

### 6.4 Integration with Three.js DataTexture

```typescript
import * as THREE from 'three';

// Create a DataTexture sized for your map fragments
const texture = new THREE.DataTexture(
  null,
  fragmentWidth,   // e.g. 40
  fragmentHeight,  // e.g. 40
  THREE.RGBAFormat,
  THREE.UnsignedByteType
);

MapStream.onFrameReady(() => {
  const frame = MapStream.acquireFrame();
  if (!frame) return;

  // Wrap C++ memory as Uint8Array — NO copy
  const pixels = new Uint8Array(frame.rgbaBuffer);

  // Update texture from fragment position
  texture.image = {
    data: pixels,
    width: frame.metadata.width,
    height: frame.metadata.height,
  };
  texture.needsUpdate = true;

  // Composite into full map FBO
  compositor.apply(frame.metadata.x, frame.metadata.y, texture);
});
```

---

## 7. API Reference

All functions are installed as globals on the JSI runtime under the `mapStream_*` prefix. The `mapStreamBridge.ts` wraps them in a more ergonomic `MapStream` object.

| Function | Bridge Method | Description |
|----------|---------------|-------------|
| `mapStream_connect(config)` | `MapStream.connect(config)` | Connect to MQTT broker. Returns `Promise<void>`. |
| `mapStream_disconnect()` | `MapStream.disconnect()` | Disconnect, stop worker, join threads. |
| `mapStream_start()` | `MapStream.start()` | Subscribe to MQTT topic and start decode loop. |
| `mapStream_stop()` | `MapStream.stop()` | Unsubscribe, stop decode loop, keep TCP connection. |
| `mapStream_pause()` | `MapStream.pause()` | Pause decoding (drops frames). MQTT stays alive. |
| `mapStream_resume()` | `MapStream.resume()` | Resume decoding after pause. |
| `mapStream_acquireFrame()` | `MapStream.acquireFrame()` | Atomically acquire newest decoded frame. Returns `DecodedFrame \| null`. |
| `mapStream_onStateChange(cb)` | `MapStream.onStateChange(cb)` | Register state change callback. |
| `mapStream_onFrameReady(cb)` | `MapStream.onFrameReady(cb)` | Register frame-ready notification callback. |
| `mapStream_getState()` | `MapStream.getState()` | Returns current `StreamState` synchronously. |

### `MqttConfig` Type

```typescript
interface MqttConfig {
  brokerUrl: string;           // host only, e.g. "192.168.1.100"
  port: number;                // default 1883
  topic: string;               // MQTT topic to subscribe
  clientId?: string;           // auto-generated if omitted
  keepAliveInterval?: number;  // default 30s
  cleanSession?: boolean;      // default true
}
```

### `StreamState` Values

```typescript
type StreamState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'subscribing'
  | 'streaming'
  | 'paused'
  | 'error';
```

### `DecodedFrame` Type

```typescript
interface DecodedFrame {
  rgbaBuffer: ArrayBuffer;    // zero-copy pointer to C++ memory
  metadata: {
    x: number;                // fragment origin x (pixels)
    y: number;                // fragment origin y (pixels)
    width: number;            // fragment width (pixels)
    height: number;           // fragment height (pixels)
    sequence: number;         // monotonically increasing frame counter
  };
}
```

---

## 8. Memory Management

### 8.1 Ownership Diagram

```
                    shared_ptr<MapFragment>
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        FrameQueue    FrameQueue    FrameQueue
        slot[back]   slot[ready]  slot[front]
              │
              │  (after acquire(), front holds the newest frame)
              ▼
        FragmentBuffer
        (jsi::MutableBuffer subclass)
              │
              ▼
        jsi::ArrayBuffer
              │
              ▼
          JS code
              │
          GC collected
              │
              ▼
        ~FragmentBuffer()
              │
              ▼
        shared_ptr refcount--
              │
        (if 0) → ~MapFragment()
                 → ~vector<uint8_t>()
                 → pixels freed
```

### 8.2 Maximum Live Allocations

At any point:
- **3 MapFragment* slots** in FrameQueue (triple-buffer)
- **1 MapFragment** held by an active `jsi::ArrayBuffer` in JS

Total maximum simultaneous MapFragment allocations: **4**.  
For 40×40 RGBA: each is 6.4 KB → max ~26 KB peak heap from pixel data.

### 8.3 rawQueue_ Backpressure

```cpp
// In MapStreamWorker — Paho callback:
if (rawQueue_.size() >= 10) {
    rawQueue_.pop();  // drop oldest undecoded frame
}
rawQueue_.push(payload);
queueCv_.notify_one();
```

This caps the raw frame backlog at 10 entries × ~6 KB = ~60 KB max.

### 8.4 Shutdown Safety

`MapStreamWorker` destructor sequence:
1. `shutdownRequested_.store(true)`
2. `queueCv_.notify_all()` — wakes decode thread
3. `decodeThread_.join()` — waits for clean exit
4. `rawQueue_` drained
5. `frameBuffer_.reset()` — releases all FrameQueue shared_ptrs

If the JS `ArrayBuffer` is still alive when shutdown occurs, `~MapFragment()` will not run until the last `shared_ptr` (in the `FragmentBuffer`) is released by JS GC. The pixel data stays valid as long as the ArrayBuffer is alive.

---

## 9. Troubleshooting

### Build Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `fatal error: stb_image.h: No such file` | stb_image not downloaded | Run `curl` command in §3.1 |
| `fatal error: MQTTAsync.h: No such file` | Paho headers missing | Follow §3.2 / §3.3 |
| `cannot find -lpaho-mqtt3as` | .so not in jniLibs | Check ABI-specific path; verify `abiFilters` matches built ABIs |
| `undefined symbol: installMapStreamModule` | Library not linked | Add `mapstream_module` to `target_link_libraries` in your app's CMake |
| `REACT_NATIVE_DIR not set` | Old RN version or custom setup | Explicitly pass `-DREACT_NATIVE_DIR=$(pwd)/node_modules/react-native` to cmake |

### Runtime Errors

| Symptom | Cause | Fix |
|---------|-------|-----|
| `MapStream is undefined` / `mapStream_connect is not a function` | JSI module not registered | Verify `System.loadLibrary("mapstream_module")` runs before JS; verify `installMapStreamModule()` is called with the correct runtime |
| `state` stays `connecting` indefinitely | Broker unreachable | Check IP/port, firewall, broker running; try `mosquitto_sub` from the device |
| Frames received but `acquireFrame()` returns null | `onFrameReady` registered but `start()` not called | Call `MapStream.start()` after `MapStream.connect()` resolves |
| App crashes on disconnect | Decode thread not joined before module destruction | Ensure `MapStream.disconnect()` is called before runtime shutdown; useMapStream hook does this on unmount |
| Memory grows unbounded | JS holding refs to ArrayBuffer indefinitely | Don't store DecodedFrame in a ref/closure; use it and let it go |

### Performance Tips

- Set `abiFilters "arm64-v8a"` only for production builds (eliminates 3-ABI build time)
- Use `pause()` when the map view is off-screen to save CPU
- For fragments larger than 40×40, the decode time scales with pixel count — consider batching or reducing topic frequency at the broker
- `invokeAsync` enqueue latency is ~0.01 ms; if `onFrameReady` fires faster than Three.js can render, drop frames in the callback rather than queueing them

---

## Wire Protocol Reference

The MQTT payload format expected by `FrameDecoder`:

```
Offset  Size     Description
──────────────────────────────────────────
0       4 bytes  JSON length (uint32, big-endian)
4       N bytes  JSON string: {"x":…,"y":…,"w":…,"h":…,"seq":…}
4+N     M bytes  PNG binary data (RGBA output, any input format stb_image supports)
```

Example JSON field names (matched by `FrameDecoder::extractNumber`):
- `x` — fragment origin X in the full map (pixels)
- `y` — fragment origin Y in the full map (pixels)
- `w` — fragment width (pixels)
- `h` — fragment height (pixels)
- `seq` — monotonic sequence number

The mock broker at `local_map_mock/server/server.js` generates this exact format.
