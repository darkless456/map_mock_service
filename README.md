# Mower Dev Simulator

`map-mock-service` is now the local **Mower Dev Simulator** for mower app development. It simulates the backend REST API, `/acc` WebSocket pushes, map incremental frames, mowing task status, robot location, and the development control surface.

The simulator is intentionally a breaking replacement for the old map-only mock service. Legacy `/api/robot/*` helper routes were removed; unknown paths return:

```json
{ "code": 404, "message": "deprecated; removed in simulator v1" }
```

## Quick start

```bash
npm install
npm run sync-fsm-mirror
npm start
```

Default URL: `http://localhost:9900`.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Run `tsx src/server.ts`. |
| `npm run build` | Type-check the TypeScript simulator. |
| `npm run check-fixtures` | Validate hot-loaded fixture JSON/JSONC files. |
| `npm test` | Run Node's TS unit and e2e scenario test suite. |
| `npm run lint` | Alias to `tsc --noEmit`. |
| `npm run sync-fsm-mirror` | Copy the mower FSM mirror into `src/sim/fsm-mirror/`. |

## Environment variables

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `9900` | HTTP and WebSocket port. |
| `MOCK_DATA_DIR` | `mapping_happy` | Dataset name under `fixtures/datasets`: `mapping_happy`, `mowing_trajectory`, `recharge_return`, or `fixed_maps`. |
| `ROBOT_SN` | `MOCK:00:11:22:33:44` | Default robot SN. |
| `PUSH_INTERVAL_MS` | `200` | Map incremental frame interval. |
| `MAP_MOCK_SLICE_BYTES` / `MMR_SLICE_BYTES` | disabled | Force map-frame base64 slicing for RustKit fragment reassembly tests. Slice boundaries are rounded down to a 4-character base64 boundary. |
| `JWT_SECRET` | local mock secret | JWT verification secret. |
| `TICKET_SECRET` | local mock secret | `/acc` ticket signing secret. |
| `SIM_PANEL` | enabled | Set `SIM_PANEL=0` to disable `/sim/*` control APIs. |
| `MOCK_ECHO_REQUEST_PAYLOAD` | disabled | Set to `1` to append a redacted `_mock.requestPayload` to business JSON responses. Intended only for local debugging. |
| `MOCK_DEBUG_PAYLOAD_MAX_BYTES` | `65536` | Maximum serialized request payload retained in debug output before it is replaced by a truncated preview. |

## HTTP request debugging

Every HTTP response includes an `X-Mock-Request-Id` header. Business requests are also written to an active recorder and streamed to the control panel event timeline with method, path, query, status, duration, and redacted request payload.

The normal response body remains identical to the backend contract. To inspect a request payload directly in React Native's response viewer, enable echoing for one request:

```http
X-Mock-Debug-Echo: 1
```

Alternatively, start the service with `MOCK_ECHO_REQUEST_PAYLOAD=1`. JSON business responses then include:

```json
{
  "code": 200,
  "data": {},
  "_mock": {
    "requestId": "...",
    "requestPayload": {}
  }
}
```

This does not apply to `/sim/*`, `/api/health`, binary assets, or WebSocket messages. Keys such as `password`, `token`, `ticket`, `secret`, and credentials are replaced with `[REDACTED]`; oversized payloads are represented by truncation metadata and a short preview.

## Business HTTP API

The service only registers the mower API paths below. The mower app calls device detail and map list with `POST`; device detail therefore requires `POST` with `{ "sn": "<robot-sn>" }`, while map list retains `GET/POST` compatibility.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/ratel/account-personal-service/api/v1/sso/getTokenByApp` | Mock login: accepts any non-empty `account`/`password` (not decrypted/validated), returns `access_token` + `refresh_token`. |
| `POST` | `/ratel/account-personal-service/api/v1/sso/refreshToken` | Verify `refresh_token` (body field or `Authorization: Bearer`), issue a fresh token pair. |
| `POST` | `/ratel/api/v1/wss/acc_ticket` | Validate `Authorization` + `platform`, issue one-time 120s WS ticket. |
| `POST` | `/ratel/api/v1/courtyard/robot/detail` | Validate request `{ sn }` and return the current virtual robot detail profile. `running_status`, `battery_charging`, and `battery_level` are derived from the same FSM used by task APIs / status pushes; `map_id` / `map_url` resolve from the active map-list fixture. |
| `POST` | `/ratel/api/v1/courtyard/robot/info/update` | Update simulator nickname / SN and broadcast `NOTIFY_RATEL_STATUS`. |
| `POST` | `/ratel/api/v1/courtyard/robot/unbind` | Reset virtual robot state. |
| `GET/POST` | `/ratel/map-service/api/v1/ratel/map/list` | Return semantic + real-scene basemap URLs, map metadata (`resolution` / `origin`), and annotation increments. |
| `POST` | `/ratel/map-service/api/v1/ratel/semantic/save` | Save annotation increment package in memory and dispatch `CMD_SAVE`. |
| `POST` | `/ratel/api/v1/map/topology/edit` | Apply a merge to the current map, increment `base_version`, and publish the merged `type:71` boundary through the next `map/list`. |
| `POST` | `/ratel/api/v1/map/delete` | Delete an in-memory map package. |
| `POST` | `/ratel/api/v1/robot/self_check` | 通知机器开始自检（建图前置第一步） |
| `POST` | `/ratel/api/v1/mapping/check` | 建图条件检测 → 轮询直至六项齐全（mock 每次多返回一项） |
| `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/create` | Create a mapping task and dispatch `CMD_START`. `mode:'extend'`（v9 新增）= 地图编辑页「添加草坪」的扩展建图：复用既有 `map_id`、保留 `mappingLabels`、任务 `mode` 记为 `extend`，同样返回 `task_id`；随后自动推送 `precondition → leave_dock → find_boundary`。取代已删除的 `/ratel/api/v1/mapping/expansion`。 |
| `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/action` | Handle mapping `PAUSE`, `RESUME`, or `STOP`. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/list` | Return mapping tasks and their current FSM-derived status. |
| `POST` | `/ratel/api/v1/mapping/mode` | `CMD_SWITCH_MANUAL` / `CMD_EXIT_MANUAL` for `remote` / `auto`. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/create` | Create mowing task, dispatch `CMD_START` + `NOTIFY_RATEL_STATUS` sequence (`map_check` → `leave_dock` → `mowing`). |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/action` | Handle `PAUSE`, `RESUME`, `CANCEL`, and `FINISH_AND_RETURN_DOCK`. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/list` | Return task list and active `task_notify`. |
| `POST` | `/ratel/api/v1/robot/recharge/task` | Trigger recharge (回桩); returns `task_id`, pushes WS `RECHARGE` + `work_status: return_dock` sub-status sequence → `idle`. |
| `POST` | `/ratel/api/v1/robot/recharge/action` | Recharge task `PAUSE` / `RESUME` / `CANCEL`. |
| `GET` | `/api/health` | Local health check. |

Each `map/list` item carries both basemap URLs and shared world metadata:

- `map_url` / `semantic_map_url` → `/sim/assets/full_semanticmap.png` (套色板灰度语义图)。
- `real_view_map_url` → `/sim/assets/full_rgbmap.png` (RGB 实景图)。
- `map_origin_x` / `map_origin_y` 与 `resolution`：语义图与实景图共享同一世界坐标系。origin 为 BackendWorld(Y-down) 下图片左上角的世界坐标，mock 默认 `resolution=0.05`、`origin=(2.5, 2.2)`，取自 `APP端接口文档v2.md` 示例并参考 `地图管理系统设计方案.md` 的 `full_semanticmap.xml`(map_id/resolution/origin)。字段命名严格对齐 `APP端接口文档v2.md` 的 `Rsp.data.items`。

## Test Data Fixtures

Hot-editable API response data lives in `fixtures/`. Edit `fixtures/**/*.jsonc` or `fixtures/maps/map_list.json`; the next request uses the new content without restarting the simulator. Static map increments and charging dock points come from `fixtures/maps/map_list.json`; `semantic/save` and `map/topology/edit` only create in-memory runtime overrides.

Run `npm run check-fixtures` after editing fixtures. See [docs/fixtures-guide.md](docs/fixtures-guide.md) and [docs/data-dictionary.md](docs/data-dictionary.md).

## WebSocket API

1. Request a ticket from `/ratel/api/v1/wss/acc_ticket`.
2. Connect to `ws://localhost:9900/acc?ticket=<ticket>`.
3. The simulator sends `MAP_FIX` and an initial `NOTIFY_RATEL_STATUS` snapshot immediately.

### Client to server

| `cmd` | Behavior |
|---|---|
| `heartbeat` | Reply with `{ code: 200, codeMsg: 'Success' }`. |
| `MAP_INCREMENTAL` ack | Acknowledge frame receipt. |
| `LOCATION_REGISTER` | Subscribe this socket to `ROBOT_LOCATION` for `sn`. |
| `LOCATION_UNREGISTER` | Remove location subscription. |

### Server to client

| `cmd` | Source |
|---|---|
| `NOTIFY_RATEL_STATUS` | Primary robot status push (`work_status` + `sub_status`). Includes simulator extensions: `capabilities`, `estop`, `notices`, `error`, `phase`, `state`. |
| `NOTIFY_MOW_STATUS` | Flattened mowing task status payload. |
| `ROBOT_LOCATION` | Semantic-zero grass-route location stream for registered SN while mowing. |
| `MAP_FIX` / `MAP_INCREMENTAL` | `data*/` XML + PNG patches encoded by protocol v2. |

`MAP_FIX` is sent once on WS connection. `MAP_INCREMENTAL` is sent immediately when mapping FSM enters a streamable phase and then every `PUSH_INTERVAL_MS` while that phase remains active, so fast `/sim/scenario/run` mapping scripts still produce frames for POC debugging.

For visual regression checks, run `mapping_stream_incremental` to keep `MAP_INCREMENTAL` flowing across mapping phases. Mowing `ROBOT_LOCATION` can be exercised via `mowing_trajectory_stream`, `POST /ratel/central-control-service/api/v1/ratel_task/create`, or inline mowing scenarios; see [docs/mowing_trajectory.md](docs/mowing_trajectory.md).

## Control API

`/sim/*` is dev-only and enabled by default.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sim/state` | Inspect current robot contexts and recent events. |
| `GET` | `/sim/panel` | 中文控制台：场景下拉、**阅读说明**（逐步操作）、混沌、录制。 |
| `GET` | `/sim/scenarios` | 场景列表 + `catalog` 摘要（来自 YAML `guide`）。 |
| `GET` | `/sim/scenario/guide?name=…` | 单个场景的完整中文说明（JSON）。 |
| `POST` | `/sim/event` | Dispatch raw FSM event. Optional body field: `domain`. |
| `POST` | `/sim/scenario/run` | Run `{ "name": "mapping_happy_auto" }` or `{ "inline": "...yaml" }`. |
| `POST` | `/sim/scenario/stop` | Stop the active scenario. |
| `POST` | `/sim/recorder/start` | Start writing `recordings/<timestamp>.jsonl`. |
| `POST` | `/sim/recorder/stop` | Stop the active recording. |
| `POST` | `/sim/recorder/replay` | Replay `{ "file": "...jsonl" }` or inline entries. |
| `GET` | `/sim/recorder/list` | List recording files and recorder status. |
| `POST` | `/sim/reset` | Reset simulator state. |
| `POST` | `/sim/chaos` | Set WS latency/drop/reorder knobs. |
| `POST` | `/sim/ble/register` | Placeholder for mower mock BLE control-channel registration. |
| `POST` | `/sim/ble/notify` | Placeholder echo endpoint for future BLE notify injection. |
| `WS` | `/sim/inspect` | Live reducer transcript and business HTTP request stream for the panel and debugging. |

Checked-in scenarios live in [scenarios](scenarios). `recordings/*.jsonl` is git-ignored by default; commit only curated regression recordings intentionally.

Useful rendering scenarios:

所有场景均自包含（`emit CMD_START` 自建任务），直接在 `/sim/panel` 运行。两个 `*_stream` 为无限循环，需手动「停止场景」。

| Scenario | Use | 结束 |
|---|---|---|
| `mapping_happy_auto` | 正常建图 happy flow：完整 `NOTIFY_RATEL_STATUS` 链 → CreateMap 导航 → `COMPLETED` | 自动 |
| `mapping_happy_manual` | 手动遥控建图 happy flow：`edge_mapping` 交接手摇沿边（`REMOTE_CONTROL` → ManualMap）→ 沿边闭合 → 确认进覆盖 → `COMPLETED` | 自动 |
| `mowing_happy_auto` | 正常割草 happy flow：`map_check → mowing → return_dock → idle` → `COMPLETE` | 自动 |
| `mapping_stream_incremental` | 无限循环：可推流建图阶段间循环，持续 `MAP_INCREMENTAL`（测建图渲染） | 手动停止 |
| `mowing_trajectory_stream` | 无限循环：保持 `ON_THE_WAY`，沿语义地图持续 `ROBOT_LOCATION`（测割草轨迹渲染） | 手动停止 |

## Mower app联调

1. Start this service: `npm start`.
2. Get a JWT one of two ways:
   - Call the mock login endpoint with any non-empty account/password (nothing is validated):
     ```bash
     curl -X POST http://localhost:9900/ratel/account-personal-service/api/v1/sso/getTokenByApp \
       -H 'Content-Type: application/json' \
       -d '{"account":"any","password":"any","appid":"com.pudutech.ratel.core"}'
     ```
     Use the returned `data.access_token` as the mower mock `accessToken`. `data.refresh_token` works against `/ratel/account-personal-service/api/v1/sso/refreshToken`.
   - Or mint one programmatically with `generateToken()` / `generateTokenPair()` from `src/auth/jwt.ts`.
3. In mower app `mock/config.local.ts`, set `enabled: true` and `http.baseUrl: 'http://localhost:9900'`.
4. Start the app. Business HTTP calls and WS pushes should now come from the simulator.
5. Open `http://localhost:9900/sim/panel`：先选场景并点击 **阅读说明** 查看前置条件与步骤，再运行场景或发送原始 FSM 事件。

## More docs

- [docs/api.md](docs/api.md)
- [docs/fixtures-guide.md](docs/fixtures-guide.md)
- [docs/data-dictionary.md](docs/data-dictionary.md)
- [docs/fsm-mirror.md](docs/fsm-mirror.md)
- [docs/mowing_trajectory.md](docs/mowing_trajectory.md)
- [docs/scenarios.md](docs/scenarios.md)
