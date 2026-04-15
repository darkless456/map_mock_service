# map_mock_service

`map_mock_service` 是一个用于本地联调的 Node.js 模拟服务。它会读取 `data/` 目录中的 XML + PNG 地图样本，并按照当前项目约定的二进制协议打包后，通过 WebSocket 推送给客户端。

这个服务主要用于：

- 验证 `MapHeader` 的编码是否正确
- 验证 WebSocket 鉴权和连接流程
- 验证 `map_fix` / `map_update` 推流行为
- 验证分片乱序、Base64 编解码和客户端组装逻辑

## 程序运行逻辑

服务启动后的核心流程如下：

```text
读取 data/*.xml + data/*.png
        ↓
解析 XML 元数据
  ├─ timestamp_ms
  ├─ resolution
  ├─ origin_x / origin_y
  └─ map_cols / map_rows
        ↓
读取 PNG 文件原始字节
        ↓
构造 MapHeader
        ↓
MapHeader -> 48 字节 Little-Endian Buffer
        ↓
Buffer -> 96 个十六进制字符
        ↓
PNG 文件字节 -> Base64 字符串
        ↓
拼成 JSON 文本
        ↓
通过 WebSocket 推送给客户端
```

## 项目文件说明

```text
map_mock_service/
├── data/
│   ├── *.xml
│   └── *.png
├── src/
│   ├── auth.js
│   ├── data-loader.js
│   ├── index.js
│   ├── protocol.js
│   └── __tests__/
└── package.json
```

### `data-loader.js`

负责读取 `data/` 目录中的测试数据：

- XML：读取 `timestamp_ms`、`resolution`、`origin_x`、`origin_y`、`map_cols`、`map_rows`
- PNG：读取文件原始字节，不做像素级展开
- 最终按时间戳排序，形成待推送的 patch 队列

### `protocol.js`

负责把地图数据编码成 WebSocket 文本消息：

1. 将 `MapHeader` 明确写入 **48 字节 Little-Endian Buffer**
2. 把 48 字节 Header 转为 **96 个十六进制字符**
3. 把 PNG 文件字节转为 Base64
4. 拼接为：

```json
{
  "topic": "map_update",
  "payload": "<96-char-header-hex><base64-image>"
}
```

同时，这个模块还支持：

- 单包发送
- 按 `frag_total` 分片发送
- 自定义 topic，例如 `map_fix`

### `auth.js`

负责模拟鉴权逻辑：

- 校验客户端传入的 JWT
- 生成 WebSocket 签名
- 校验 WebSocket URL 上的 `signature`

这是 mock 行为，不依赖真实用户系统。

### `index.js`

负责对外暴露服务：

- HTTP 接口
- WebSocket 握手和鉴权
- 周期性推送 `map_update`
- 首帧或按指令推送 `map_fix`
- 心跳保活
- 模拟分片乱序

## 协议格式

### 1. Header

`MapHeader` 的实际长度为 **48 字节**，所有整数字段和浮点字段都使用 **Little-Endian**。

### 2. WebSocket 消息

服务端发送 JSON 文本：

```json
{
  "topic": "map_fix",
  "payload": "<96 个十六进制字符的 Header><Base64 图像内容>"
}
```

说明：

- `topic = map_fix`：全量快照
- `topic = map_update`：增量更新
- `payload` 前 96 个字符：Header 十六进制文本
- `payload` 剩余部分：PNG 文件字节的 Base64 字符串

## 环境依赖与安装

### 1. 依赖要求

建议使用以下环境：

- Node.js 18+
- npm 9+

### 2. 安装依赖

在项目根目录执行：

```bash
cd /Users/linyang1/Development/map_mock_service
npm install
```

## 如何启动服务

### 1. 默认启动

```bash
cd /Users/linyang1/Development/map_mock_service
npm start
```

默认配置：

- 端口：`9900`
- 推送周期：`200ms`
- 分片数：`1`

### 2. 带环境变量启动

```bash
PORT=9900 PUSH_INTERVAL_MS=100 FRAG_COUNT=3 npm start
```

参数说明：

- `PORT`：HTTP / WebSocket 服务端口
- `PUSH_INTERVAL_MS`：增量推送周期
- `FRAG_COUNT`：每帧拆成多少片，用于模拟分片乱序

### 3. 启动成功后的输出

启动后会看到类似输出：

```text
Loading map patches from data directory...
Loaded 1521 map patches.
Map Mock Service running on http://localhost:9900
  Auth endpoint: GET /api/auth/ws-signature
  Health check:  GET /api/health
  WebSocket:     ws://localhost:9900/ws/map?signature=<sig>
  Push interval: 100ms
  Fragment count: 3
```

## 如何连接与鉴权

当前 mock service 的鉴权分两步。

### 第一步：准备 JWT Token

服务端使用固定密钥校验 JWT：

```text
mock-map-service-secret-key-2024
```

可以直接用下面的命令在本地生成一个测试 Token：

```bash
cd /Users/linyang1/Development/map_mock_service
node -e "const jwt=require('jsonwebtoken'); console.log(jwt.sign({userId:'demo-user',role:'map_viewer'}, 'mock-map-service-secret-key-2024', {expiresIn:'24h'}))"
```

### 第二步：请求 WebSocket 签名

```bash
curl -H "Authorization: Bearer <你的 JWT Token>" \
  http://127.0.0.1:9900/api/auth/ws-signature
```

返回结果示例：

```json
{
  "wsUrl": "ws://localhost:9900/ws/map",
  "signature": "<signature>",
  "expiresAt": 1776228944
}
```

### 第三步：连接 WebSocket

客户端使用返回的 `signature` 建立连接：

```text
ws://localhost:9900/ws/map?signature=<signature>
```

## 如何订阅数据

当前服务在连接成功后会自动做两件事：

- 立即推送一帧 `map_fix`
- 启动周期性 `map_update` 推送

除了自动行为外，客户端还可以发送控制指令。

### 1. 触发 `map_update`

#### 显式订阅增量流

```json
{"command":"subscribe","topic":"map_update"}
```

#### 恢复增量流

```json
{"command":"resume"}
```

### 2. 停止 `map_update`

#### 显式取消订阅增量流

```json
{"command":"unsubscribe","topic":"map_update"}
```

#### 兼容旧命令

```json
{"command":"pause"}
```

### 3. 触发 `map_fix`

#### 推荐命令

```json
{"command":"subscribe","topic":"map_fix"}
```

#### 兼容旧命令

```json
{"command":"full_map"}
```

这两个命令都会立即下发一帧 `map_fix`，并且对应的 `MapHeader.msg_type = 0x02`。

## 使用 `wscat` 调试的完整示例

### 1. 安装 `wscat`

```bash
npm install -g wscat
```

### 2. 建立连接

```bash
wscat -c "ws://localhost:9900/ws/map?signature=<signature>"
```

连接后你会立即收到一条 `map_fix`。

### 3. 手动触发指令

发送增量订阅：

```json
{"command":"subscribe","topic":"map_update"}
```

发送一次全量快照：

```json
{"command":"subscribe","topic":"map_fix"}
```

暂停增量推送：

```json
{"command":"pause"}
```

恢复增量推送：

```json
{"command":"resume"}
```

## 服务端如何模拟分片发送

当 `FRAG_COUNT > 1` 时，服务会这样处理：

1. 先把 PNG 文件字节拆成多个片段
2. 每个片段单独生成一份 Header
3. 为每个片段设置：
   - `frag_total`
   - `frag_index`
   - `frag_data_len`
4. 逐片通过 WebSocket 推送
5. 在部分情况下故意把片段顺序反转，以模拟乱序到达

这部分逻辑用于验证客户端的：

- 乱序重组能力
- `session_id` 维度缓存
- 超时清理能力

## 如何停止服务

最简单的方法是在启动服务的终端按：

```text
Ctrl + C
```

如果服务在后台运行，可以通过 `ps` / `kill` 终止对应的 Node 进程。

## 健康检查

服务提供了一个简单的健康检查接口：

```bash
curl http://127.0.0.1:9900/api/health
```

返回示例：

```json
{
  "status": "ok",
  "patchCount": 1521
}
```

## 常见问题与排查思路

### 问题 1：签名接口返回 401

排查方向：

- JWT 是否缺失
- `Authorization` 是否写成 `Bearer <token>`
- Token 是否已过期
- Token 是否使用了 mock 固定密钥签发

### 问题 2：客户端能连上，但没有持续收到增量数据

排查方向：

- 是否发送了 `pause`
- 是否执行了 `unsubscribe map_update`
- `PUSH_INTERVAL_MS` 是否太大
- `FRAG_COUNT` 是否设置异常导致客户端一直等待收齐

### 问题 3：客户端只能收到 `map_fix`，收不到 `map_update`

排查方向：

- 检查是否订阅了 `map_update`
- 检查客户端是否错误地过滤掉 `topic=map_update`
- 检查服务端日志里是否有 `Client unsubscribed from map_update`

### 问题 4：客户端组装后 RGBA 长度不对

排查方向：

- 当前 mock 发送的是 **PNG 文件字节**，不是裸灰度数组
- 客户端不能直接把 Base64 解码结果当灰度像素展开
- 应先尝试解码 PNG，再转换到 RGBA

### 问题 5：Header 解析错位

排查方向：

- 先确认 Header 长度为 **48 字节 / 96 十六进制字符**
- 先取前 96 个字符作为 Header，再取剩余部分做 Base64
- 检查是否误用了 Big-Endian

## 当前验证状态

当前 mock service 已完成以下验证：

- `npm test` 通过，18 个测试全部成功
- 可正常返回 WS 签名
- 可自动下发首帧 `map_fix`
- 可周期推送 `map_update`
- 支持分片乱序模拟
- 已与 Rust 侧 `map_integration_test` 联调成功
