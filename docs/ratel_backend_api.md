# Ratel App 后端 API 参考

> 文档版本：2026-06-04  
> 范围：WebSocket（换票、地图增量、机器状态、割草进度、位置流） HTTP（建图任务、割草任务）  
> 整合自：`robot_status_ws.md`、`mowing_api.md`、`mapbuilder_api.md`，并参照 `APP端接口文档.md` 补全字段  
> 关联：`build-docs/mapping-mowing-button-transport.md`、`build-docs/backend-status-mapper-update.md`

---

## 环境与公共约定

| 项目 | 说明 |
|------|------|
| 测试 Gateway | `https://ratel-cxg-test-internal.pudu.work`（与 `{{ratel-gateway}}` 等价）|
| HTTP 协议 | HTTPS REST，`Content-Type: application/json` |
| WS 协议 | 先换票再握手，见 [§1 WebSocket 接入](#1-websocket-接入) |
| 鉴权 | Header `Authorization`：Ratel 登录态 access token，支持 `Bearer <token>` 与裸 token |
| 设备头（推荐）| `platform: ratel`；`X-Device-Id`；`X-Device`（如 `Android:google:Pixel 8`）；`X-Device-Version` |
| HTTP 成功 | 响应体 `code === 200` |
| 机器侧错误 | 部分接口在 `code === -1` 时，`data` 内携带 `robot_code` / `robot_message` |

### WS 消息通用结构

所有 WebSocket 消息均遵循以下结构（客户端上行、服务端下行一致）：

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `cmd` | string | Y | 指令枚举 |
| `cmd_id` | string | Y | 消息唯一 ID（UUID）；回复时带上收到的 `cmd_id` |
| `version` | int32 | N | 协议版本，当前固定为 `1` |
| `data` | object | N | 业务载荷，结构随 `cmd` 而定 |

---

## 目录

1. [WebSocket 接入](#1-websocket-接入)
2. [机器人状态推送（WS）](#2-机器人状态推送ws)
3. [地图增量推送（WS）](#3-地图增量推送ws)
4. [建图任务（HTTP）](#4-建图任务http)
5. [割草任务（HTTP）](#5-割草任务http)
6. [割草进度与位置（WS）](#6-割草进度与位置ws)
7. [公共数据结构](#7-公共数据结构)
8. [待与后端对齐项](#8-待与后端对齐项)
9. [前端实现对照](#9-前端实现对照)

---

## 1. WebSocket 接入

建立 WebSocket 前，APP 须先获取一次性 `ticket`。

### 1.1 获取 ticket

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/ratel/api/v1/wss/acc_ticket` |

**请求 Headers**

| Header | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `Authorization` | string | 是 | 与登录态一致的 access token |
| `platform` | string | 是 | 调用方平台标识（大小写不敏感），如 `ratel`；部分环境亦支持 `1001` / `1002` / `1003` |
| `Content-Type` | string | 是 | `application/json` |

**响应 Body**

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | `200` 表示成功 |
| `message` | string | 描述文案 |
| `ticket` | string | 十六进制字符串，仅用于 WS 握手查询参数 |
| `expire_seconds` | int | 票据有效秒数（默认 120）|
| `wss_path_hint` | string | 提示，如 `ws://host/acc?ticket=<ticket>` |

**成功示例**

```json
{
  "code": 200,
  "message": "Success",
  "ticket": "5f2c6d8a7b9e1f20a4c3d2e1b0f9a8c7",
  "expire_seconds": 120,
  "wss_path_hint": "ws://127.0.0.1:8899/acc?ticket=<ticket>"
}
```

```bash
curl -X POST 'https://ratel-cxg-test-internal.pudu.work/ratel/api/v1/wss/acc_ticket' \
  -H 'Authorization: Bearer eyJhbGciOi...' \
  -H 'platform: ratel' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**常见失败**

- `400`：缺失 `Authorization` / `platform`、未知 platform
- `401`：token 校验失败
- `503`：业务不可用

### 1.2 WebSocket 握手

```
ws://<WSS_HOST>:<WSS_PORT>/acc?ticket=<ticket>
wss://<WSS_HOST>:<WSS_PORT>/acc?ticket=<ticket>
```

- 必须带查询参数 `ticket`；缺失时服务端返回 401
- 票据为 *一次性*：握手成功即失效；断线重连须**重新换票**
- 握手成功后服务端立即建立登录态，**无需** WS 发 login 指令

### 1.3 心跳

**客户端请求**

```json
{
  "cmd_id": "550e8400-e29b-41d4-a716-446655440000",
  "cmd": "heartbeat",
  "data": {
    "userId": "10086"
  }
}
```

**服务端响应**

```json
{
  "cmd_id": "与请求一致",
  "cmd": "与请求一致",
  "data": {
    "code": 200,
    "codeMsg": "Success",
    "data": {}
  }
}
```

---

## 2. 机器人状态推送（WS）

| 属性 | 值 |
|------|-----|
| 方向 | 服务端 → 客户端（Server Push）|
| 指令 | `NOTIFY_RATEL_STATUS` |
| 触发时机 | 机器人状态发生变化时主动推送 |

> 状态字段映射见 `build-docs/backend-status-mapper-update.md`。

### 2.1 顶层字段

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `cmd` | string | Y | 固定值 `"NOTIFY_RATEL_STATUS"` |
| `cmd_id` | string | Y | 消息唯一 ID（UUID）|
| `version` | int | Y | 协议版本，当前固定为 `1` |
| `data` | object | Y | 业务数据，见下表 |

### 2.2 `data` 字段

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `sn` | string | Y | 机器 SN |
| `mac` | string | N | 机器 MAC |
| `work_status` | string | Y | 机器工作状态，见 [work_status 枚举](#work_status-枚举) |
| `sub_status` | string | N | 主状态内阶段；`none` 或空表示无有效子状态（App 会回退读取 legacy `phase`）|
| `work_msg` | string | N | `work_status` 补充说明（如故障原因）|
| `battery` | object | N | 电池状态，见 [battery](#databattery) |
| `signals` | object | N | 网络信号，见 [signals](#datasignals) |
| `phase` | string | N | **遗留字段**：部分 mock/旧固件在 `sub_status` 无效时携带阶段名（如 `MOW_RUNNING`）|
| `state` | string | N | **调试/辅助**：服务端 FSM 快照（如 `PREPARING`、`WORKING`），非 App 主消费路径 |
| `capabilities` | object | N | 能力开关（如 `can_switch_manual`、`can_switch_auto`）|
| `estop` | object | N | 急停状态（如 `{ "active": false }`）|
| `notices` | array | N | 通知列表 |
| `error` | object | N | 错误详情 |

#### `work_status` 枚举

| 值 | 含义 |
|----|------|
| `idle` | 空闲中 |
| `mowing` | 割草中 |
| `charging` | 充电中 |
| `mapping` | 建图中 |
| `error` | 故障 |

### 2.3 `data.battery`

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `level` | int | Y | 电量百分比（0 ~ 100）|
| `charging` | int | Y | 是否充电：`1` = 充电中，`-1` = 未充电 |
| `temperature` | float | Y | 电池温度（℃）|
| `cycles` | int | Y | 充电循环次数 |

### 2.4 `data.signals`

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `bluetooth` | object | N | 见下表 |
| `wifi` | object | N | 见下表 |
| `cellular` | object | N | 见下表 |

**`data.signals.bluetooth`**

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `connected` | int | Y | `1` = 已连接，`-1` = 未连接 |
| `rssi` | int | Y | 信号强度（dBm，越大越强） |

**`data.signals.wifi`**

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `connected` | int | Y | `1` = 已连接，`-1` = 未连接 |
| `ssid` | string | Y | 已连接 WiFi 名称 |
| `rssi` | int | Y | 信号强度（dBm）|
| `signal_strength` | string | Y | `good` / `medium` / `poor` |

**`data.signals.cellular`**

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `connected` | int | Y | `1` = 已连接，`-1` = 未连接 |
| `signal_strength` | string | Y | `good` / `medium` / `poor` / `none` |

### 2.5 客户端 ACK

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `result` | string | Y | `"SUCCESS"` 表示接收成功 |

### 2.6 完整示例

```json
{
  "cmd": "NOTIFY_RATEL_STATUS",
  "cmd_id": "12345678-abcdefghi-111111111",
  "version": 1,
  "data": {
    "sn": "TSAABBC1C2C4C2",
    "sub_status": "none",
    "work_status": "mowing",
    "work_msg": "正常割草中",
    "battery": {
      "level": 78,
      "charging": -1,
      "temperature": 28.5,
      "cycles": 42
    },
    "signals": {
      "bluetooth": { "connected": 1, "rssi": -55 },
      "wifi": {
        "connected": 1,
        "ssid": "HomeWiFi",
        "rssi": -62,
        "signal_strength": "good"
      },
      "cellular": { "connected": -1, "signal_strength": "none" }
    }
  }
}
```

---

## 3. 地图增量推送（WS）

**cmd：** `MAP_INCREMENTAL`

**方向：** 服务端 → 客户端（地图增量）；客户端 → 服务端（ACK）

### 3.1 服务端 → 客户端 `data`

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `sn` | string | Y | 机器 SN |
| `map_header` | object | Y | 地图增量头信息 |
| `map_data` | string | Y | 增量数据：建图增量帧为 `base64`（不压缩）；Mock 默认与之一致，可用 `MMR_GZIP=1` 切回 `base64 + gzip` |

**`data.map_header` 主要字段**

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | int32 | 协议版本，固定 `1` |
| `header_len` | uint32 | header 长度 |
| `data_len` | uint32 | 解码后图像字节数 |
| `msg_type` | uint32 | `0x01` 灰度图；`0x02` 语义图 |
| `timestamp_sec` / `timestamp_nsec` | uint64 | Unix 时间戳 |
| `width` / `height` | uint32 | 增量宽高（cell 数） |
| `resolution` | float | 米/cell |
| `origin_x` / `origin_y` | double | 地图原点（米）|
| `robot_x` / `robot_y` / `robot_theta` | double | 机器人位姿 |
| `format` | string | 如 `png` |
| `map_id` | string / uint64 | 地图 ID |
| `frame_id` | uint64 | 当前帧 ID（ACK 须回传） |
| `frame_slicing_total` | uint32 | 切片总数 |
| `frame_slicing_id` | uint64 | 切片 ID（ACK 须回传） |
| `frame_slicing_index` | uint32 | 切片索引，从 0 起 |
| `crc32` | uint32 | 数据 CRC32 |
| `lawn_area` | float | 建图面积（单位以固件/产品为准）|

> 部分固件亦使用 `map_package_total`、`map_transfer_id`、`map_package_index` 等字段命名，语义与切片字段类似，以实际 payload 为准。

**接收示例**

```json
{
  "cmd": "MAP_INCREMENTAL",
  "cmd_id": "<指令唯一id>",
  "version": 1,
  "data": {
    "sn": "69:32:3B:eD:AA:64",
    "map_header": {
      "version": 1,
      "header_len": 36,
      "data_len": 1600,
      "msg_type": 2,
      "timestamp_sec": 1773890709,
      "timestamp_nsec": 416000000,
      "width": 40,
      "height": 40,
      "resolution": 0.05,
      "origin_x": 34.75,
      "origin_y": 25.65,
      "robot_x": 0.0,
      "robot_y": 0.0,
      "robot_theta": 0.0,
      "format": "png",
      "map_id": "0",
      "frame_id": 45545,
      "frame_slicing_total": 1,
      "frame_slicing_id": 522231,
      "frame_slicing_index": 0,
      "crc32": 363052545,
      "lawn_area": 20.2
    },
    "map_data": "<base64>"
  }
}
```

### 3.2 客户端 → 服务端 ACK `data`

App 处理成功后须回复（RustKit 可自动 ACK；字段以协议为准）：

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `result` | string | Y | `SUCCESS` 表示处理成功 |
| `payload` | object | N | 透传回机器端 |

**`payload`（推荐）**

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `session_id` | string | Y | 帧唯一编号 |
| `ack` | bool | Y | `true` 表示 App 确认收到 |

**简化 ACK 示例（`APP端接口文档` 形态）**

```json
{
  "cmd": "MAP_INCREMENTAL",
  "cmd_id": "与收到的 cmd_id 一致",
  "version": 1,
  "data": {
    "code": 200,
    "msg": ""
  }
}
```

---

## 4. 建图任务（HTTP）

路径前缀：`/ratel/api/v1/mapping/`（自检走 `/ratel/api/v1/robot/self_check`）。

**建图模式 `mode` 枚举**（`start` / `mode` 共用）：

| 值 | 含义 |
|----|------|
| `auto` | 自动探索建图 |
| `remote` | 手动遥控建图 |
| `follow` | 跟随用户建图 |

### 4.0 通知机器开始自检

建图前置页须**先**调用本接口，再轮询 [4.1 建图条件检测](#41-建图条件检测)。

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/ratel/api/v1/robot/self_check` |

**请求 Body**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sn` | string | 是 | 机器 SN |

**响应 `data`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `checked_at` | int64 | 自检时间戳（毫秒）|
| `overall` | string | 综合状态：`ok` / `warning` / `error` |
| `blade` | string | 刀片：`normal` / `warning` / `error` |
| `wheel` | string | 车轮状态 |
| `sensor` | string | 传感器状态 |
| `motor` | string | 电机状态 |
| `gps` | string | GPS 状态 |

前端：`postRobotSelfCheck` → `runMappingPrepareChecks`（轮询细节见 `src/features/mapping/prepare/README.md`）。

### 4.1 建图条件检测

在 [4.0](#40-通知机器开始自检) 成功后**轮询**（App 默认间隔 1.5s、超时 60s）。

| 项目 | 值 |
|------|-----|
| 方法 | `POST` |
| 路径 | `/ratel/api/v1/mapping/check` |

**请求 Body**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sn` | string | 是 | 机器 SN |

**响应 `data`（扁平结构，`APP端接口文档` 2026-06-04）**

> **迁移**：旧版曾使用 `data.all_ok` + `data.conditions.*` 嵌套；当前协议将下列字段直接挂在 `data` 下。App 在 `postMappingCheck` 入口用 `normalizeMappingCheckData` 兼容旧网关。

| 字段 | 类型 | 说明 | 前置项 id |
|------|------|------|-----------|
| `bluetooth_status` | string | `ok` / `warning` / `error` | `bluetooth` |
| `bluetooth_msg` | string | 蓝牙异常文案 | — |
| `cellular` | string | 蜂窝网络 | `4g` |
| `wifi` | string | WiFi | `wifi` |
| `battery` | string | 电量 | `battery` |
| `docking_station` | string | 充电座 / 归位 | `charger` |
| `light` | string | 光线 | `light` |

**轮询结束**：上述六项（不含 `bluetooth_msg`）均有非空返回值。
**是否可建图（App）**：六项齐全且均为 `ok`（`isServerAllOk`），不再读取 `all_ok`。

```bash
curl -X POST 'https://ratel-cxg-test-internal.pudu.work/ratel/api/v1/mapping/check' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"sn":"TSAABBC1C2C4C2"}'
```

### 4.2 建图任务

旧 `/ratel/api/v1/mapping/start|pause|resume|stop` 路由已移除，不提供兼容别名。
当前 mock 使用以下建图任务 API：

| 用途 | 方法 | 路径 | Body |
|------|------|------|------|
| 创建 | `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/create` | 建图任务参数 |
| 控制 | `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/action` | `{ sn, task_id?, action: PAUSE\|RESUME\|STOP, payload?: { save } }` |
| 查询 | `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/list` | `{ sn, limit?, offset? }` |

### 4.3 切换建图模式

| 方法 | `POST` |
| 路径 | `/ratel/api/v1/mapping/mode` |

**Body：** `sn`（string）、`mode`（`auto` \| `remote` \| `follow`）

---

## 5. 割草任务（HTTP）

路径前缀：`/ratel/central-control-service/api/v1/ratel_task/`

### 5.1 发起割草任务

| 方法 | `POST` |
| 路径 | `/ratel/central-control-service/api/v1/ratel_task/create` |

**请求 Body**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sn` | string | 是 | 设备 SN |
| `task_info` | object | 是 | 割草任务参数 |

**`task_info`**

| 字段 | 类型 | 必填 | 单位 | 说明 |
|------|------|------|------|------|
| `task_mode` | string | 是 | — | `"global"` 全局 \| `"area"` 局部 |
| `map_id` | string | 是 | — | 地图 ID |
| `area_id` | string[] | 条件 | — | `task_mode="area"` 时必填 |
| `mow_height` | float | 是 | mm | 割草高度 |
| `mow_speed` | float | 是 | m/s | 0.3 ~ 1.0，步进 0.1 |
| `texture` | object | 是 | — | 弓形纹理参数 |

**`task_info.texture`**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `mode` | string | 是 | `"global"` \| `"area"` |
| `bow_shaped_spacing` | number | 是 | 弓形间距（mm；文档亦有 int32 描述）|
| `texture_angle` | int32 | 是 | 纹理角度 [0, 180) 度 |
| `intelligent_alternation_mode` | boolean | 是 | 智能交替模式 |

**响应 `data`：** `task_id`、`robot_code`、`robot_message`

```bash
curl -X POST 'https://ratel-cxg-test-internal.pudu.work/ratel/central-control-service/api/v1/ratel_task/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <token>' \
  -H 'platform: ratel' \
  -H 'X-Device-Id: <device-id>' \
  -H 'X-Device: Android:google:Pixel 8' \
  -H 'X-Device-Version: 16' \
  -d '{
    "sn": "TSAABBC1C2C4C2",
    "task_info": {
      "task_mode": "global",
      "map_id": "123",
      "mow_height": 60,
      "mow_speed": 0.5,
      "texture": {
        "mode": "global",
        "bow_shaped_spacing": 6,
        "texture_angle": 0,
        "intelligent_alternation_mode": true
      }
    }
  }'
```

### 5.2 割草任务 Action（暂停 / 继续 / 取消）

| 方法 | `POST` |
| 路径 | `/ratel/central-control-service/api/v1/ratel_task/action` |

**Body：** `sn`、`task_id`、`action`（`PAUSE` \| `RESUME` \| `CANCEL`）
**响应 `data`：** `robot_code`、`robot_message`

### 5.3 割草任务列表

| 方法 | `POST` |
| 路径 | `/ratel/central-control-service/api/v1/ratel_task/list` |

**Body：** `{ "sn": "<SN>" }`

**响应 `data`**

| 字段 | 类型 | 说明 |
|------|------|------|
| `total` | int32 | 任务总数 |
| `list` | TaskSummary[] | 任务摘要列表 |
| `task_info` | object | 当前执行中任务参数（结构同 §5.1 `task_info`）|
| `task_notify` | object | 机器最后一次上报进度，见 [TaskNotify](#tasknotify) |

**`list[]` 条目（`APP端接口文档` 扩展）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 任务 ID |
| `task_status` | string | 见 [TaskStatus](#taskstatus-枚举) |
| `task_info` | object | 下发任务参数 |
| `task_notify` | object | 最近进度 |
| `create_time` | int64 | 创建时间（秒）|
| `update_time` | int64 | 更新时间（秒）|

---

## 6. 割草进度与位置（WS）

### 6.1 割草任务状态推送 — `NOTIFY_MOW_STATUS`

| 属性 | 值 |
|------|-----|
| 方向 | 服务端 → 客户端 |
| 触发 | 割草任务状态或进度变化 |

**消息结构**

| 字段 | 类型 | 说明 |
|------|------|------|
| `cmd` | string | `"NOTIFY_MOW_STATUS"` |
| `cmd_id` | string | UUID |
| `version` | int | `1` |
| `data.sn` | string | 设备 SN |
| `data.payload` | object | 任务进度，字段见 [TaskNotify](#tasknotify) + `task_id` / `task_status` |

> App 解析：`data.payload` 可能嵌套在 `data` 顶层重复一份；以 `payload` 为准（见 `mowStatusPayload.ts`）。

**接收示例**

```json
{
  "cmd": "NOTIFY_MOW_STATUS",
  "cmd_id": "2aa8d21f-ba5c-4cbd-a33c-6f82cd386837",
  "version": 1,
  "data": {
    "sn": "TSD29C35EFD104",
    "payload": {
      "sn": "TSD29C35EFD104",
      "task_id": "mock-task-001",
      "task_status": "ON_THE_WAY",
      "task_type": "cloud",
      "task_message": "",
      "task_error_code": 0,
      "mow_area": 256.5,
      "mow_progress": 100,
      "estimated_time": 0,
      "timestamp": 1779891513,
      "notify_timestamp": 1779891513108
    }
  }
}
```

### 6.2 位置推送登记 — `LOCATION_REGISTER`

**方向：** 客户端 → 服务端

割草任务开始时登记一次；任务结束可 [取消登记](#63-位置推送取消登记-location_unregister)。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cmd` | string | 是 | `"LOCATION_REGISTER"` |
| `cmd_id` | string | 是 | UUID |
| `version` | int | 是 | `1` |
| `data.sn` | string | 是 | 机器 SN |

```json
{
  "cmd": "LOCATION_REGISTER",
  "cmd_id": "loc-1730000000000",
  "version": 1,
  "data": { "sn": "SF3198423328000" }
}
```

> 须通过 RustKit `wsSend` 写入已建立的 WS 连接；登记成功后服务端才推送 `ROBOT_LOCATION`。

### 6.3 位置推送取消登记 — `LOCATION_UNREGISTER`

**方向：** 客户端 → 服务端

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cmd` | string | 是 | `"LOCATION_UNREGISTER"` |
| `data.sn` | string | 是 | 机器 SN |

### 6.4 机器位置推送 — `ROBOT_LOCATION`

**方向：** 服务端 → 客户端（完成 `LOCATION_REGISTER` 且任务为活跃割草态后持续推送，典型间隔 300ms）

| 字段 | 类型 | 单位 | 必填 | 说明 |
|------|------|------|------|------|
| `cmd` | string | — | 是 | `"ROBOT_LOCATION"` |
| `data.sn` | string | — | 是 | 机器 SN |
| `data.mac` | string | — | 是 | MAC |
| `data.map_id` | string | — | 是 | 当前地图 ID |
| `data.x` | float | m | 是 | X 坐标 |
| `data.y` | float | m | 是 | Y 坐标 |
| `data.angle` | float | rad | 是 | 朝向 |
| `data.timestamp` | int64 | s | 是 | 机器上报时间戳 |
| `data.notify_time` | int64 | ms | 是 | 服务端推送时间戳 |

```json
{
  "cmd": "ROBOT_LOCATION",
  "cmd_id": "<uuid>",
  "version": 1,
  "data": {
    "sn": "SF3198423328000",
    "mac": "B4:ED:D5:75:6E:BC",
    "map_id": "123",
    "x": -0.019724773,
    "y": 0.042629186,
    "angle": -0.21470512,
    "timestamp": 1779866504,
    "notify_time": 1779866504001
  }
}
```

---

## 7. 公共数据结构

### TaskSummary

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 割草任务 ID |
| `task_status` | string | 见 [TaskStatus](#taskstatus-枚举) |

### TaskNotify

用于 `list.task_notify` 或 `NOTIFY_MOW_STATUS.data.payload`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 任务 ID（WS payload 中） |
| `task_status` | string | 任务状态 |
| `task_type` | string | `"cloud"` 云端 \| `"button"` 按键 |
| `task_message` | string | 状态描述 |
| `task_error_code` | int32 | 错误码 |
| `mow_area` | float | 总割草面积（单位待确认） |
| `mow_progress` | float | 割草进度（推断为 0~100 百分比） |
| `estimated_time` | float | 预计完成时间（单位待确认）|
| `timestamp` | int64 | 机器上报时间（秒）|
| `notify_timestamp` | int64 | 通知时间（毫秒） |

### TaskStatus 枚举

| 值 | 含义 |
|----|------|
| `ON_THE_WAY` | 进行中（含前往割草区域途中）|
| `PAUSE` | 已暂停 |
| `COMPLETE` | 已完成 |
| `CANCEL` | 已取消 |
| `FAILED` | 失败（机器拒绝任务，由后端更新） |

---

## 8. 待与后端对齐项

> 以下问题需与后端确认后填入正式取值范围。

### 8.1 字段类型 / 取值范围

| # | 字段 | 待确认 |
|---|------|--------|
| T1 | `task_info.bow_shaped_spacing` | `float` 还是 `int32`（0.1mm 整数）？取值范围？ |
| T2 | `mow_progress` | 是否为 `[0, 100]` 百分比？ |

### 8.2 缺少单位

| # | 字段 | 待确认单位 |
|---|------|------------|
| U1 | `mow_area` | m² 或其他 |
| U2 | `estimated_time` | 秒、分钟或毫秒 |

### 8.3 缺少错误码定义

| # | 字段 | 待确认 |
|---|------|--------|
| E1 | `robot_code` | 枚举值 |
| E2 | `task_error_code` | 完整映射 |
| E3 | HTTP `code` | 除 `200` 外的业务码 |

### 8.4 空值 / 可选性

| # | 场景 | 待确认 |
|---|------|--------|
| N1 | 任务 `FAILED` / `CANCEL` | `task_info` / `task_notify` 为 `null` 还是省略？ |
| N2 | 无执行中任务 | `task_info` 为 `null`、`{}` 还是不返回？ |

---

## 9. 前端实现对照

### 建图 HTTP（截至 2026-06-04）

详见 `build-docs/mapping-mowing-button-transport.md`。

| 接口 | App 封装 | 触达 |
|------|----------|------|
| 开始自检 | `postRobotSelfCheck` | HTTP → `runMappingPrepareChecks` |
| 条件检测 | `postMappingCheck` → `normalizeMappingCheckData` | HTTP 轮询至六项齐全 |
| 开始 / 暂停 / 恢复 / 停止 / 切换模式 | `postStartMapping` 等 | HTTP，失败回退 BLE |

### 割草 WS / HTTP

| 能力 | App 模块 |
|------|----------|
| `NOTIFY_MOW_STATUS` | `useWsDeviceListener` → mowing FSM |
| `LOCATION_REGISTER` | `useLocationRegistration` → `wsSend`；成功后 30s 内无 `ROBOT_LOCATION` 触发 WARN `location.register.no_robot_location` |
| `ROBOT_LOCATION` | `useWsDeviceListener` → `useRobotTrajectory` |
| 创建 / Action / List | `useMowingCommands` / `mowingApi` |

### 机器人状态 WS

| 能力 | App 模块 |
|------|----------|
| `NOTIFY_RATEL_STATUS` | `useWsDeviceListener` → `EventAdapter` → mapping/mowing FSM（实现层对历史 mock 别名的兼容见代码，不在协议范围） |

---

**历史文档**：本文档取代 `robot_status_ws.md`、`mowing_api.md`、`mapbuilder_api.md`。更完整的非建图/割草接口（回充、地图列表、遥控等）仍见 `APP端接口文档.md`。
