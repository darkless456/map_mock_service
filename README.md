# map_mock_service

`map_mock_service` 是一个用于本地联调的 Node.js 模拟服务。它读取 `data/` 目录中的 XML + PNG 地图样本，按照新版二进制协议打包后，通过 WebSocket 推送给客户端。

主要用途：

- 验证 `MapHeader` 51 字节编码是否正确
- 验证 WebSocket 鉴权和连接流程
- 验证 `MAP_INCREMENTAL_PATCH` / `MAP_FIX_PATCH` 推流行为
- 验证 cmd 信封格式、Base64 编解码和客户端帧解码逻辑

## 程序运行逻辑

```text
读取 data/*.xml + data/*.png
        ↓
解析 XML 元数据
  ├─ timestamp_ms
  ├─ resolution
  ├─ origin_x / origin_y (米，浮点数)
  └─ map_cols / map_rows
        ↓
读取 PNG 文件原始字节
        ↓
构造 MapHeader (51 字节 LE)
        ↓
Buffer → 102 个 hex 字符
        ↓
PNG 文件字节 → Base64 字符串
        ↓
拼成 cmd 信封 JSON
        ↓
通过 WebSocket 推送给客户端
```

## 协议格式

### MapHeader（新版 51B）

51 字节 Little-Endian 二进制格式，通过 hex 字符串传输（102 个 hex 字符）。

| 偏移 | 字段 | 类型 | 说明 |
|------|------|------|------|
| 0 | version | u8 | 协议版本 = 1 |
| 1 | msg_type | u8 | 0x01=灰度, 0x02=语义 |
| 2 | data_len | u32 | 图像数据字节数 |
| 6 | timestamp_sec | u32 | Unix 时间戳（秒） |
| 10 | timestamp_nsec | u32 | 纳秒部分 |
| 14 | width | u32 | 地图宽（像素） |
| 18 | height | u32 | 地图高（像素） |
| 22 | resolution | f32 | 分辨率（米/像素） |
| 26 | origin_x | f32 | 左上角世界坐标 X（米） |
| 30 | origin_y | f32 | 左上角世界坐标 Y（米） |
| 34 | sesstion_id | u32 | 帧唯一 ID |
| 38 | robot_x | f32 | 机器人 X（米） |
| 42 | robot_y | f32 | 机器人 Y（米） |
| 46 | robot_theta | f32 | 机器人朝向（弧度） |
| 50 | need_ack | u8 | 1=需要 ACK |

### WS 消息格式（cmd 信封）

```json
{
  "cmd": "MAP_INCREMENTAL_PATCH",
  "cmd_id": "42",
  "data": {
    "payload": "<102 hex 字符 Header><Base64 图像内容>"
  }
}
```

- `cmd = MAP_INCREMENTAL_PATCH`：增量帧
- `cmd = MAP_FIX_PATCH`：修正帧
- `payload` 前 102 字符：Header hex
- `payload` 剩余部分：PNG 文件字节的 Base64

### 客户端命令格式

```json
{"cmd": "PAUSE", "data": {}}
{"cmd": "RESUME", "data": {}}
{"cmd": "REQUEST_FULL_MAP", "data": {}}
{"cmd": "MAP_ACK", "cmd_id": "42", "data": {}}
```

## 环境依赖与安装

- Node.js 18+
- npm 9+

```bash
cd map_mock_service
npm install
```

## 如何启动服务

### 默认启动

```bash
npm start
```

默认配置：端口 `9900`，推送周期 `200ms`。

### 带环境变量

```bash
PORT=9900 PUSH_INTERVAL_MS=100 npm start
```

### 启动输出

```text
Loading map patches from data directory...
Loaded 1521 map patches.
Map Mock Service running on http://localhost:9900
  Auth endpoint: GET /api/auth/ws-signature
  Health check:  GET /api/health
  WebSocket:     ws://localhost:9900/ws/map?signature=<sig>
  Push interval: 200ms
```

## 鉴权流程

### 1. 准备 JWT Token

```bash
node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({userId:'demo-user',role:'map_viewer'}, 'mock-map-service-secret-key-2024', {expiresIn:'24h'}))"
```

### 2. 请求 WS 签名

```bash
curl -H "Authorization: Bearer <JWT>" http://127.0.0.1:9900/api/auth/ws-signature
```

签名接口返回的 `wsUrl` 会复用当前请求的 `Host`，因此：

- 模拟器走 `10.0.2.2:9900` 时，会拿到 `ws://10.0.2.2:9900/ws/map`
- 本机直接联调时，会拿到 `ws://localhost:9900/ws/map`

### 3. 连接 WebSocket

```text
ws://localhost:9900/ws/map?signature=<signature>
```

## 使用 wscat 调试

```bash
wscat -c "ws://localhost:9900/ws/map?signature=<sig>"

# 暂停
> {"cmd": "PAUSE", "data": {}}

# 恢复
> {"cmd": "RESUME", "data": {}}

# 请求全量
> {"cmd": "REQUEST_FULL_MAP", "data": {}}
```

## 常见问题

### 签名接口返回 401

- JWT 是否缺失或过期
- `Authorization` 是否格式正确（`Bearer <token>`）

### 连上后没有增量数据

- 是否发送了 PAUSE
- `PUSH_INTERVAL_MS` 是否太大

### Header 解析错位

- Header 长度为 **51 字节 / 102 hex 字符**
- 先取前 102 个字符作为 Header，再取剩余部分做 Base64
- 确认使用 Little-Endian

## 测试

```bash
npm test
```

16 个测试覆盖：header 编解码 roundtrip、cmd 信封格式、origin f32、robot 字段、need_ack 等。

## 当前验证状态

- `npm test` 通过，16 个测试全部成功
- 可正常返回 WS 签名
- 可自动下发首帧 `MAP_FIX_PATCH`
- 可周期推送 `MAP_INCREMENTAL_PATCH`
- 已与 Rust 侧联调成功
