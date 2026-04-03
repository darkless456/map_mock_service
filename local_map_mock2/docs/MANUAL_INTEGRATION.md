# 手动集成指南（React Native 新架构 + 本仓库 Native 代码）

本文档面向 **后续在自有 RN 工程中手动集成** 的场景，按顺序执行即可完成源码拷贝、Codegen、Android / iOS 编译与 TurboModule 注册。  
相关设计背景见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)、[`MAP_STREAM_WORKER.md`](./MAP_STREAM_WORKER.md)。

---

## 0. 前置条件

| 项 | 说明 |
|----|------|
| React Native | **0.82+**，已开启 **New Architecture**（Fabric + TurboModule）。 |
| 构建 | Android：NDK + CMake；iOS：Xcode + CocoaPods。 |
| 本仓库路径 | 下文以 `local_map_mock2` 表示你克隆/拷贝的参考仓库根目录。 |

---

## 1. 需要从本仓库拷贝的文件（清单）

按你的工程习惯放到 **单一目录**（例如 `modules/map-native/`），并在下文 CMake / Xcode 中引用该路径。

### 1.1 共享解码（任务二 / 任务一帧格式）

| 源（本仓库） | 用途 |
|-------------|------|
| `react-native-mvp/cpp/MapFrameParserCore.h` | PNG 帧解析 + 解码声明 |
| `react-native-mvp/cpp/MapFrameParserCore.cpp` | `stb_image` 实现单元（内含 `STB_IMAGE_IMPLEMENTATION`） |
| `react-native-mvp/cpp/MapFrameParserJsi.h` / `MapFrameParserJsi.cpp` | 同步解码结果 → JSI 对象（Hermes 分配 `ArrayBuffer` 的 MVP 路径） |
| `third_party/stb_image.h` | stb_image 头文件 |

> **注意**：整个工程里 **`STB_IMAGE_IMPLEMENTATION` 只能出现在一个 `.cpp` 中**（已在 `MapFrameParserCore.cpp`），不要重复定义。

### 1.2 流式 Worker + MQTT（任务四）

| 源 | 用途 |
|----|------|
| `native-map-stream/include/mapstream/*.h` | `MapStreamWorker`、`IMqttTransport`、配置类型 |
| `native-map-stream/src/map_stream_worker.cpp` | 工作线程 + 队列 + 解码调度 |
| `native-map-stream/src/stub_mqtt_transport.cpp` | 无 Broker 时的 Stub 传输层 |
| `native-map-stream/src/paho_mqtt_async_transport.cpp` | Paho `MQTTAsync`（需 `-DMAPSTREAM_WITH_PAHO` + 链接库） |

### 1.3 外部 ArrayBuffer（任务四 JSI）

| 源 | 用途 |
|----|------|
| `react-native-mvp/cpp/MapStreamJsi.h` / `MapStreamJsi.cpp` | `decodedFrameToJs`：`MutableBuffer` + `shared_ptr<vector>` 延长 RGBA 生命周期 |

### 1.4 TypeScript Spec（Codegen 输入）

| 源 | Native 模块名（`TurboModuleRegistry`） |
|----|----------------------------------------|
| `react-native-mvp/js/NativeMapFrameParser.ts` | `MapFrameParser` |
| `react-native-mvp/js/NativeMapStream.ts` | `MapStream` |

将上述 TS 文件复制到你 App 的 **Codegen 目录**（例如 `src/specs/`，见第 2 节）。

### 1.5 可选：业务侧 Three.js 示例

| 源 | 用途 |
|----|------|
| `react-native-mvp/js/incrementTextureMVP.ts` | `DataTexture` 示例（按需拷贝） |

---

## 2. JavaScript / TypeScript：Codegen 配置

### 2.1 在应用 `package.json` 增加 `codegenConfig`

以下为**示例**，请把 `name` 改成与你工程一致的 Spec 名称（会体现在生成的 C++ 符号前缀上）。

```json
{
  "codegenConfig": {
    "name": "YourAppSpec",
    "type": "all",
    "jsSrcsDir": "src/specs",
    "android": {
      "javaPackageName": "com.yourcompany.yourapp"
    }
  }
}
```

### 2.2 放置 Spec 文件

将 `NativeMapFrameParser.ts`、`NativeMapStream.ts` 复制到 `src/specs/`，并检查：

- `TurboModuleRegistry.getEnforcing<Spec>('MapFrameParser')` 与 C++ 注册的 **`kModuleName`** 一致。
- `getEnforcing<Spec>('MapStream')` 同理。

### 2.3 生成代码

在 App 根目录执行（以 RN 官方 CLI 为准）：

```bash
npx react-native codegen
```

生成结果通常位于：

- Android：`android/app/build/generated/source/codegen/jni/`
- iOS：`build/generated/ios/`（路径随模板略有差异）

### 2.4 关于 `setStateListener` / `setFrameTickListener` 的说明

部分 RN 版本对 TurboModule Spec 中 **「函数类型参数」** 的 Codegen 支持不完整。若 Codegen **报错或生成的 C++ 接口不含监听器方法**，可选用其一：

1. **轮询模式（推荐先打通链路）**：从 Spec 中暂时删除两个 `set*Listener`，仅保留 `getStatus()` + `consumeLatestFrame()`，在 JS 里用 `requestAnimationFrame` 轮询。  
2. **事件模式**：在 C++ 侧通过 `RCTDeviceEventEmitter` / 新架构等价机制发事件（需按你工程现有 Native 事件封装改）。  
3. **HostObject / 自定义 JSI**：绕过 TurboModule 的函数参数限制（工作量大，维护成本高）。

集成时以 **`npx react-native codegen` 实际输出** 为准调整 TS Spec。

---

## 3. Android 手动集成

以下路径以 **默认 RN Android 模板** 为参考；若你使用 monorepo 或自定义 `android/` 结构，请等价替换。

### 3.1 拷贝 Native 源码

将第 1 节列出的 `.h` / `.cpp` 放入例如：

`android/app/src/main/cpp/map-native/`（可自定义，与 CMake 一致即可）。

### 3.2 修改 `android/app/build.gradle`

确保开启新架构与 CMake（片段示例，需与现有文件合并而非整体替换）：

```gradle
android {
    defaultConfig {
        externalNativeBuild {
            cmake {
                cppFlags "-std=c++20", "-frtti", "-fexceptions", "-DFOLLY_NO_CONFIG=1"
                arguments "-DANDROID_STL=c++_shared"
            }
        }
        ndk {
            abiFilters "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
        }
    }
    externalNativeBuild {
        cmake {
            path "src/main/jni/CMakeLists.txt"
        }
    }
}
```

若你工程的 `CMakeLists.txt` 不在 `jni/`，改为实际路径。

### 3.3 编辑 `android/app/src/main/jni/CMakeLists.txt`

**目标**：把本仓库源文件编进 `react_codegen` / app 的 shared library，并链接 `ReactAndroid::jsi`、`ReactAndroid::reactnative` 等（具体 target 名称以 **RN 版本 prefab** 为准）。

**示例骨架**（需与你现有 `CMakeLists.txt` 合并）：

```cmake
cmake_minimum_required(VERSION 3.13)
project(appmodules)

# 按实际路径调整
set(MAP_NATIVE_DIR "${CMAKE_SOURCE_DIR}/../cpp/map-native")
set(MAPSTREAM_DIR "${CMAKE_SOURCE_DIR}/../../../../../../native-map-stream") # 若放在仓库根，请改为拷贝后的真实相对路径

add_library(mapnative STATIC
  ${MAP_NATIVE_DIR}/MapFrameParserCore.cpp
  ${MAP_NATIVE_DIR}/MapFrameParserJsi.cpp
  ${MAP_NATIVE_DIR}/MapStreamJsi.cpp
  ${MAPSTREAM_DIR}/src/map_stream_worker.cpp
  ${MAPSTREAM_DIR}/src/stub_mqtt_transport.cpp
  ${MAPSTREAM_DIR}/src/paho_mqtt_async_transport.cpp
)

target_include_directories(mapnative PUBLIC
  ${MAP_NATIVE_DIR}
  ${MAPSTREAM_DIR}/include
  ${CMAKE_SOURCE_DIR}/../cpp/third_party   # stb_image.h
)

target_compile_definitions(mapnative PUBLIC
  # MAPSTREAM_WITH_PAHO   # 启用 Paho 时打开
)

target_link_libraries(your_app_target mapnative) # your_app_target 替换为工程中实际 target
```

> **要点**：`MapFrameParserCore.cpp` 内 `#include "../../third_party/stb_image.h"` 是相对 **该 cpp 文件所在目录** 的路径。若你改变了 `MapFrameParserCore.cpp` 的放置位置，应 **同步修改 include**，或改为 CMake `target_include_directories` 指向 `stb` 目录并改成 `#include "stb_image.h"`。

### 3.4 实现 Codegen 生成的 C++ Spec 子类

Codegen 会为每个模块生成类似 `NativeMapFrameParserSpecJSI.h` / `NativeMapStreamSpecJSI.h` 的头文件（名称随 RN 版本略有不同）。你需要：

1. 新建 `NativeMapFrameParserModule.cpp` / `NativeMapStreamModule.cpp`（名称自定）。  
2. 继承生成的 `Native*CxxSpec` 基类，实现各方法：  
   - `MapFrameParser`：调用 `mapmock::decodeIncrementFrameSync`（见 `MapFrameParserJsi.cpp`）或直接使用 `MapFrameParserCore`。  
   - `MapStream`：持有 `std::shared_ptr<mapstream::MapStreamWorker>`，在 `connect/disconnect/start/stop/pause/resume` 中转发；`consumeLatestFrame` 调用 `mapstream_jsi::decodedFrameToJs`。  
3. 在 **`TurboModuleManagerDelegate`**（或 RN 模板中集中注册 TurboModule 的位置）把模块名 **`MapFrameParser` / `MapStream`** 映射到你的实现类。

具体注册文件名因模板而异，常见为：

- `android/app/src/main/jni/OnLoad.cpp`
- `android/app/src/main/jni/MainApplicationTurboModuleManagerDelegate.cpp`

请在你的工程中搜索 `TurboModuleManagerDelegate` 或 `installModules`，按现有模块的写法 **追加** 两项。

### 3.5 网络与权限

- `AndroidManifest.xml`：`INTERNET` 权限。  
- 明文流量：若调试 `ws://` / `tcp://` 无 TLS，注意 **Network Security Config**（仅调试环境）。

### 3.6（可选）集成 Eclipse Paho

1. 使用 **Prefabricated** / `FetchContent` / 预编译 AAR 等方式引入 `paho.mqtt.c` 的 **异步库**（`mqtt3as`）。  
2. CMake：`target_compile_definitions(mapnative PUBLIC MAPSTREAM_WITH_PAHO)`，`target_link_libraries(... paho-mqtt3as ...)`（名称以实际导入为准）。  
3. `NativeMapStream.connect` 里 `usePaho == true` 时调用 `mapstream::createPahoMqttAsyncTransport()`；若返回 `nullptr`，应回退 Stub 或向 JS 报错。

---

## 4. iOS 手动集成

### 4.1 拷贝源码

将同一套 `.h` / `.cpp` 放入 Xcode 工程目录（例如 `ios/MapNative/`），并 **加入 App target 的 Compile Sources**。

### 4.2 Header Search Paths

在 Xcode **Build Settings → Header Search Paths** 添加：

- `map-native` 根目录（或各子目录）  
- `native-map-stream/include`  
- `third_party`（`stb_image.h`）

### 4.3 编译选项

- **C++20**（与 Worker 一致）。  
- 若启用 Paho：在 **Preprocessor Macros** 增加 `MAPSTREAM_WITH_PAHO=1`，并将 Paho **静态库 / xcframework** 链接进主 target。

### 4.4 TurboModule 注册

新架构下 iOS 通常通过 **Codegen 生成的 `*-generated.mm` + 你的实现类** 完成注册。请在你工程中搜索已有 TurboModule 的 **`RCT_EXPORT_MODULE`** / **ObjC++ 包装**，按相同模式增加 `MapFrameParser` 与 `MapStream`。

> iOS 与 Android 的注册细节高度依赖 RN 补丁版本；请以 **`npx react-native codegen` 生成文件** 中的注释与官方模板为准。

---

## 5. `MapStreamWorker` 与传输层选择

| 场景 | 建议 |
|------|------|
| 先验证解码与 JSI | `createStubMqttTransport()` + `injectRawPayloadForTest`（仅 C++ 测试）或从 JS 仍用 `mqtt` 收包再调用 `MapFrameParser`（过渡方案）。 |
| 生产 Native MQTT | `createPahoMqttAsyncTransport()`，`connect` 使用 **TCP `tcp://host:1883`**；WebSocket 需 Paho 或其它支持 MQTT over WebSocket 的库（本仓库 Paho 示例为 **TCP Async**）。 |

若目标 Broker 仅有 **WebSocket**（如 `ws://host:8883`），需扩展 `IMqttTransport` 新实现，或改用支持 WebSocket 的 MQTT 客户端库；**不要**假设 Paho TCP 代码可直接连 WebSocket URL。

---

## 6. 集成完成后自检清单

- [ ] `npx react-native codegen` 无报错，Android / iOS 均生成对应 jni / mm 文件。  
- [ ] CMake / Xcode 能找到 `stb_image.h`，且无 **重复** `STB_IMAGE_IMPLEMENTATION`。  
- [ ] App 启动后 `TurboModuleRegistry.getEnforcing('MapFrameParser')` / `'MapStream'` 不抛错。  
- [ ] `MapFrameParser.decodeIncrementFrame` 对一帧 Mock 二进制包返回合法 `width/height/rgba`。  
- [ ] `MapStream.connect` + `start` 后，Broker 有发布时 `consumeLatestFrame()` 非空（或轮询 `getStatus` 状态合理）。  
- [ ] 退出页面调用 `disconnect()`，无崩溃、无 JNI 引用泄漏日志。  
- [ ]（可选）启用 Paho 后，断网 / 重连状态机与 `getStatus` 一致。

---

## 7. 常见问题（Troubleshooting）

| 现象 | 可能原因 | 处理 |
|------|-----------|------|
| `stb_image.h not found` | include 路径与 `MapFrameParserCore.cpp` 内相对路径不一致 | 改 include 或改 CMake/Xcode Header Search Paths |
| 链接重复符号 `stbi_*` | 多个 `.cpp` 定义了 `STB_IMAGE_IMPLEMENTATION` | 只保留一处 |
| `jsi::ArrayBuffer` 构造不匹配 | RN / Hermes 版本 API 差异 | 对照当前 `jsi.h` 中 `ArrayBuffer` 构造函数；必要时退回 `memcpy` 到 Hermes 分配的 buffer（见 `MapFrameParserJsi.cpp`） |
| Paho 连接成功无消息 | topic / QoS / 未 subscribe | 确认 `start()` 已调用且 topic 与 Broker 一致 |
| Debug 卡顿仍明显 | 仍在 JS 线程解码 / 未使用 Worker | 确认走 `MapStreamWorker` 路径；`MapFrameParser` 同步 API 仅适合小图或离线工具 |
| Codegen 不支持函数监听器 | 见 2.4 | 轮询或改事件通道 |

---

## 8. 文档索引

| 文档 | 内容 |
|------|------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | 端到端数据流、MQTT 帧格式 |
| [`MAP_STREAM_WORKER.md`](./MAP_STREAM_WORKER.md) | Worker 并发、Paho、JSI 所有权 |
| 本文 `MANUAL_INTEGRATION.md` | **手动拷贝与工程集成步骤** |

---

## 9. 版本与模板差异声明

React Native 的 **Gradle 插件、CMake 入口文件名、Codegen 输出路径、TurboModule 注册类名** 会随 **0.82.x 补丁版本** 变化。本文提供的是 **可迁移的步骤与检查点**；若与本地模板冲突，以你工程中 **已能编译的第三方 TurboModule** 为参照，把本仓库源文件按同样方式接入即可。
