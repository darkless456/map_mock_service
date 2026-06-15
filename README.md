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
| `npm test` | Run Node's TS unit and e2e scenario test suite. |
| `npm run lint` | Alias to `tsc --noEmit`. |
| `npm run sync-fsm-mirror` | Copy the mower FSM mirror into `src/sim/fsm-mirror/`. |

## Environment variables

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `9900` | HTTP and WebSocket port. |
| `MOCK_DATA_DIR` | `data3` | Dataset directory: `data`, `data2`, `data3`, or `data4`. |
| `ROBOT_SN` | `MOCK:00:11:22:33:44` | Default robot SN. |
| `PUSH_INTERVAL_MS` | `200` | Map incremental frame interval. |
| `MAP_MOCK_SLICE_BYTES` / `MMR_SLICE_BYTES` | disabled | Force map-frame base64 slicing for RustKit fragment reassembly tests. Slice boundaries are rounded down to a 4-character base64 boundary. |
| `JWT_SECRET` | local mock secret | JWT verification secret. |
| `TICKET_SECRET` | local mock secret | `/acc` ticket signing secret. |
| `SIM_PANEL` | enabled | Set `SIM_PANEL=0` to disable `/sim/*` control APIs. |

## Business HTTP API

The service only registers the mower API paths below. For app compatibility, device detail and map list accept both the documented `GET` method and the current mower app's `POST` calls.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/ratel/api/v1/wss/acc_ticket` | Validate `Authorization` + `platform`, issue one-time 120s WS ticket. |
| `GET/POST` | `/ratel/api/v1/courtyard/robot/detail` | Return current virtual robot device info. |
| `POST` | `/ratel/api/v1/courtyard/robot/info/update` | Update simulator nickname / SN and broadcast `NOTIFY_RATEL_STATUS`. |
| `POST` | `/ratel/api/v1/courtyard/robot/unbind` | Reset virtual robot state. |
| `GET/POST` | `/ratel/map-service/api/v1/ratel/map/list` | Return semantic + real-scene basemap URLs, map metadata (`resolution` / `origin`), and annotation increments. |
| `POST` | `/ratel/map-service/api/v1/ratel/semantic/save` | Save annotation increment package in memory and dispatch `CMD_SAVE`. |
| `POST` | `/ratel/api/v1/map/delete` | Delete an in-memory map package. |
| `POST` | `/ratel/api/v1/robot/self_check` | 通知机器开始自检（建图前置第一步） |
| `POST` | `/ratel/api/v1/mapping/check` | 建图条件检测 → 轮询直至六项齐全（mock 每次多返回一项） |
| `POST` | `/ratel/api/v1/mapping/start` | Dispatch mapping `CMD_START` → `PREPARING`. |
| `POST` | `/ratel/api/v1/mapping/pause` | Dispatch mapping `CMD_PAUSE`. |
| `POST` | `/ratel/api/v1/mapping/resume` | Dispatch mapping `CMD_RESUME`. |
| `POST` | `/ratel/api/v1/mapping/stop` | `CMD_CANCEL` or `CMD_CONFIRM` when `save: true`. |
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
| `WS` | `/sim/inspect` | Live reducer transcript stream for the panel and debugging. |

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
2. Generate a local JWT using `JWT_SECRET` and set it as the mower mock `accessToken`.
3. In mower app `mock/config.local.ts`, set `enabled: true` and `http.baseUrl: 'http://localhost:9900'`.
4. Start the app. Business HTTP calls and WS pushes should now come from the simulator.
5. Open `http://localhost:9900/sim/panel`：先选场景并点击 **阅读说明** 查看前置条件与步骤，再运行场景或发送原始 FSM 事件。

## More docs

- [docs/api.md](docs/api.md)
- [docs/fsm-mirror.md](docs/fsm-mirror.md)
- [docs/mowing_trajectory.md](docs/mowing_trajectory.md)
- [docs/scenarios.md](docs/scenarios.md)
