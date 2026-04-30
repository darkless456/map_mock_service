# map-mock-service

本地联调用 Node.js WebSocket mock 服务，用于模拟机器人地图推流，配合 `@pudu/mobile-map-rust-kit` 以及宿主 App 进行集成测试。

服务读取本地 `data/` 或 `data2/` 目录中的 XML + PNG 地图样本，按照 **WS 协议 v2（JSON 信封）** 打包后通过 WebSocket 持续向客户端推送增量帧。

---

## 目录结构

```
map_mock_service/
├── src/
│   ├── index.js          # HTTP + WebSocket 服务入口
│   ├── protocol.js       # WS v2 消息编码（JSON + gzip + base64）
│   ├── auth.js           # JWT 鉴权与短期 ticket 生成
│   ├── data-loader.js    # XML + PNG 地图数据加载
│   ├── encrypt.js        # RSA 加密工具（独立辅助，不参与主流程）
│   └── __tests__/
│       ├── auth.test.js
│       └── protocol.test.js
├── data/                 # 数据集 A（XML + PNG 对）
├── data2/                # 数据集 B（XML + PNG 对，默认使用）
└── package.json
```

---

## 环境要求

- Node.js 18+
- npm 9+

---

## 快速启动

```bash
cd map_mock_service
npm install
npm start
```

默认端口 **9900**，推送间隔 **200 ms**，使用 `data2/` 目录。

启动成功后输出示例：

```
Loading map patches from data2/ ...
Loaded 1521 map patches.
Map Mock Service running on http://localhost:9900
```

---

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `9900` | HTTP / WS 监听端口 |
| `MOCK_DATA_DIR` | `data2` | 使用的数据目录（`data` 或 `data2`） |
| `ROBOT_SN` | `MOCK:00:11:22:33:44` | 推流消息中的机器人序列号 `sn` 字段 |
| `PUSH_INTERVAL_MS` | `200` | 增量帧推送间隔（毫秒） |
| `JWT_SECRET` | `mock-map-service-secret-key-2024` | 验证客户端 JWT 的签名密钥 |
| `TICKET_SECRET` | `mock-ticket-secret-2024` | 签发 WS ticket 的密钥 |

示例：

```bash
PORT=8080 MOCK_DATA_DIR=data PUSH_INTERVAL_MS=100 npm start
```

---

## HTTP API

### POST `/ratel/api/v1/wss/acc_ticket` — 申请 WS 接入票据

**请求头：**

| Header | 说明 |
|--------|------|
| `Authorization` | `Bearer <JWT>` |
| `platform` | 客户端平台标识，任意非空字符串（如 `android`） |

**响应（200）：**

```json
{
  "code": 200,
  "message": "Success",
  "ticket": "<short-lived JWT>",
  "expire_seconds": 120,
  "wss_path_hint": "ws://localhost:9900/acc?ticket=<ticket>"
}
```

**错误响应：**

| HTTP 状态码 | 说明 |
|-------------|------|
| `400` | 缺少 `platform` 请求头 |
| `401` | JWT 无效或过期 |

---

### GET `/api/health` — 健康检查

```json
{
  "status": "ok",
  "dataDir": "data2",
  "patchCount": 1521
}
```

---

## 认证流程

整体采用 **两步鉴权**：

```
客户端                              服务端
  │                                   │
  │  POST /ratel/api/v1/wss/          │
  │        acc_ticket                 │
  │  Authorization: Bearer <JWT>      │
  │  platform: android                │
  │ ──────────────────────────────►   │  验证 JWT
  │ ◄──────────────────────────────   │  返回短期 ticket（TTL 120s）
  │                                   │
  │  WS /acc?ticket=<ticket>          │
  │ ══════════════════════════════►   │  验证 ticket，升级为 WebSocket
```

### 生成测试 JWT

服务不对外暴露 JWT 注册接口，本地测试时手动生成：

```bash
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { userId: 'demo-user', role: 'map_viewer' },
  'mock-map-service-secret-key-2024',
  { expiresIn: '24h' }
);
console.log(token);
"
```

---

## WebSocket 连接

**升级地址：**

```
ws://localhost:9900/acc?ticket=<ticket>
```

**连接行为：**

1. 握手时服务端验证 `ticket`，无效则返回 `HTTP 401` 并关闭 socket。
2. 握手成功后立即推送一帧**全量地图**（`MAP_INCREMENTAL` cmd，使用 `patches[0]`）。
3. 随后每隔 `PUSH_INTERVAL_MS` 循环推送各增量帧，帧序到末尾后从头重播。

---

## 推流协议 v2

### 服务端 → 客户端：地图帧

所有地图帧（全量和增量）均使用 cmd `MAP_INCREMENTAL`。

```json
{
  "cmd": "MAP_INCREMENTAL",
  "cmd_id": "<uuid-v4>",
  "version": 1,
  "data": {
    "sn": "MOCK:00:11:22:33:44",
    "map_header": { "...": "..." },
    "map_data": "<base64(gzip(PNG字节))>"
  }
}
```

### `map_header` 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | number | 协议版本 = `1` |
| `header_len` | number | header 固定长度 = `36` |
| `data_len` | number | 原始 PNG 字节数 |
| `msg_type` | number | 消息类型（`0x01` 灰度） |
| `timestamp_sec` | number | Unix 时间戳（秒） |
| `timestamp_nsec` | number | 纳秒部分 |
| `width` | number | 地图宽度（像素） |
| `height` | number | 地图高度（像素） |
| `resolution` | number | 分辨率（米/像素） |
| `origin_x` | number | 地图原点世界坐标 X（米） |
| `origin_y` | number | 地图原点世界坐标 Y（米） |
| `robot_x` | number | 机器人 X（米），mock 固定为 `0` |
| `robot_y` | number | 机器人 Y（米），mock 固定为 `0` |
| `robot_theta` | number | 机器人朝向（弧度），mock 固定为 `0` |
| `format` | string | 图像格式 = `"png"` |
| `map_id` | string | 地图 ID（空字符串） |
| `frame_id` | number | 全局递增帧序号 |
| `frame_slicing_total` | number | 分片总数，默认 `1` |
| `frame_slicing_id` | number | 分片标识，默认 `0` |
| `frame_slicing_index` | number | 分片索引，默认 `0` |
| `crc32` | number | 原始 PNG 字节的 CRC32 校验值 |

### `map_data` 编码

```
map_data = base64( gzip( PNG 原始字节 ) )
```

CRC32 在 gzip 之前对原始 PNG 字节计算，写入 `map_header.crc32`。

---

## 客户端 → 服务端：控制消息

| `cmd` | 说明 |
|-------|------|
| `MAP_INCREMENTAL` + `data.result = "SUCCESS"` | 客户端 ACK，服务端忽略（无操作） |
| `heartbeat` | 心跳保活，服务端回复 `{code:200, codeMsg:"Success", data:{}}` |
| `ping` | 连通性探测，服务端回复 `{code:200, codeMsg:"Success", data:"pong"}` |
| `PAUSE` | 暂停增量帧推送 |
| `RESUME` | 恢复增量帧推送 |
| `MAP_INCREMENTAL_REISSUE` | 客户端丢帧，请求重传；服务端重新发送一次全量地图 |

**服务端响应示例：**

```json
// heartbeat
{ "cmd": "heartbeat", "cmd_id": "<原始cmd_id>", "data": { "code": 200, "codeMsg": "Success", "data": {} } }

// ping
{ "cmd": "ping", "cmd_id": "<原始cmd_id>", "data": { "code": 200, "codeMsg": "Success", "data": "pong" } }
```

---

## 使用 wscat 调试

```bash
# 1. 生成测试 JWT
TOKEN=$(node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({userId:'test'}, 'mock-map-service-secret-key-2024', {expiresIn:'1h'}))")

# 2. 获取 ticket
TICKET=$(curl -s -X POST http://localhost:9900/ratel/api/v1/wss/acc_ticket \
  -H "Authorization: Bearer $TOKEN" \
  -H "platform: android" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).ticket))")

# 3. 连接 WebSocket
wscat -c "ws://localhost:9900/acc?ticket=$TICKET"
```

连接后可发送控制消息：

```
> {"cmd": "PAUSE", "data": {}}
> {"cmd": "RESUME", "data": {}}
> {"cmd": "MAP_INCREMENTAL_REISSUE", "cmd_id": "1", "data": {"frame_id": 10}}
> {"cmd": "ping", "cmd_id": "2", "data": {}}
> {"cmd": "heartbeat", "cmd_id": "3", "data": {}}
```

---

## 数据集格式

`data/` 和 `data2/` 目录下均为成对的 `<timestamp_ms>.xml` 和 `<timestamp_ms>.png` 文件（OpenCV FileStorage 格式）。

**XML 字段：**

| 路径 | 说明 |
|------|------|
| `opencv_storage.timestamp_ms` | 帧时间戳（毫秒） |
| `opencv_storage.resolution` | 分辨率（米/像素） |
| `opencv_storage.origin_x` | 原点 X（米） |
| `opencv_storage.origin_y` | 原点 Y（米） |
| `opencv_storage.map_cols` | 地图宽度（像素） |
| `opencv_storage.map_rows` | 地图高度（像素） |

加载规则：

- 扫描目录下所有 `*.xml`，找到同名 `*.png` 配对；无法配对的文件跳过并输出警告
- 按 `timestamp_ms` 升序排序
- 仅允许 `data` 和 `data2` 作为有效目录名（防路径穿越）
- 若有效帧数为 0，服务启动失败并退出

---

## 切换数据集

**方式一：环境变量（推荐）**

```bash
MOCK_DATA_DIR=data npm start
```

**方式二：修改代码常量**

修改 `src/index.js` 顶部，将默认值改为 `'data'`，重启服务即可。

`GET /api/health` 响应中的 `dataDir` 字段反映当前实际使用的目录。

---

## 测试

```bash
npm test
```

> ⚠️ **注意**：`src/__tests__/auth.test.js` 中部分测试引用了旧 API 名称（`generateWsSignature` / `verifyWsSignature`），这些函数已被 ticket 体系取代，相关用例会失败。`src/__tests__/protocol.test.js` 引用了旧二进制协议 API（`HEADER_SIZE`、`encodeMapHeader`、`decodeMapHeader`），均已从 `protocol.js` 移除，这些用例也会失败。JWT 生成/验证相关用例仍可正常运行。

---

## `encrypt.js` 工具

`src/encrypt.js` 是一个**独立的 RSA 加密辅助工具**，不参与服务主流程。它模拟移动端 `encryptData()` 逻辑：

```
UTF-8 文本 → hex → RSA-PKCS1 公钥加密 → base64 → hex
```

可在需要验证 token 加密格式时单独导入使用，与 HTTP 路由和 WebSocket 无关。

