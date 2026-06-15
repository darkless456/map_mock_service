# Simulator API

This document is the S0-S3 API contract for Mower Dev Simulator. Business API paths are intentionally limited to the mower app integration and the backend docs. The old `open-platform-service` mowing paths and legacy `/api/robot/*` helpers are not accepted.

## HTTP

| Method | Path | Response summary |
|---|---|---|
| `POST` | `/ratel/api/v1/wss/acc_ticket` | `{ code, message, ticket, expire_seconds, wss_path_hint }` |
| `GET/POST` | `/ratel/api/v1/courtyard/robot/detail` | `{ code, message, data: IDevice }` |
| `POST` | `/ratel/api/v1/courtyard/robot/info/update` | `{ code, message, data: IDevice }` |
| `POST` | `/ratel/api/v1/courtyard/robot/unbind` | `{ code, message, data: { robot_code, robot_message } }` |
| `GET/POST` | `/ratel/map-service/api/v1/ratel/map/list` | `{ code, data: { total, items } }`；`items[]` 含 `map_url` / `semantic_map_url` / `real_view_map_url` / `map_origin_x` / `map_origin_y` / `resolution` / `base_version` / `unit` / `increments`（命名对齐 APP端接口文档v2.md） |
| `POST` | `/ratel/map-service/api/v1/ratel/semantic/save` | `{ code, data: { base_version } }` |
| `POST` | `/ratel/api/v1/map/delete` | `{ code, data: { deleted, map_id } }` |
| `POST` | `/ratel/api/v1/robot/self_check` | `{ code, data: { checked_at, overall, … } }` — 建图前置触发机器自检 |
| `POST` | `/ratel/api/v1/mapping/check` | `{ code, data: { bluetooth_status, cellular, wifi, … } }` 扁平 — 建图条件检测（须先 self_check；mock 渐进返回） |
| `POST` | `/ratel/api/v1/mapping/start` | `{ code, data: { robot_code, robot_message, map_id } }` |
| `POST` | `/ratel/api/v1/mapping/pause` | `{ code, data: { robot_code, robot_message } }` |
| `POST` | `/ratel/api/v1/mapping/resume` | `{ code, data: { robot_code, robot_message } }` |
| `POST` | `/ratel/api/v1/mapping/stop` | `{ code, data: { robot_code, robot_message } }` — body `{ sn, save }` |
| `POST` | `/ratel/api/v1/mapping/mode` | `{ code, data: { robot_code, robot_message } }` — body `{ sn, mode }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/create` | `{ code, data: { task_id, robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/action` | `{ code, data: { robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/list` | `{ code, data: { total, list, task_info, task_notify } }` |
| `GET` | `/api/health` | Local health status. |

### Notes

- `map/list` 的 `items[].increments[]` 为标注 / 点位增量，单项形如 `{ element_id, type, shape, points, properties, source }`。`type` 是 0-255 语义码：禁区 `251`、圆禁区 `201`、虚拟墙 `254`、**充电桩 `69`** 等。充电桩为单点位，协议无原生 point 形状，按 `shape: 'polygon'` + 1 个点（`points: [{x, y}]`）下发，APP 端按 `type` 反向迁移为 point 渲染；可选 `properties.yawRad`（BackendWorld 顺时针）控制朝向。增量数据源在 `src/data/annotations.ts`。
- `increments[].source` = `"robot"` / `"app"`，标识数据来源并决定 APP 端可编辑性：`robot`（机器人/后端上报，如充电桩）只读不可编辑、不参与 `semantic/save` 回传；`app`（用户绘制，如禁区/虚拟墙）可编辑可保存。**`semantic/save` 的回传 body 不含 `source`**（与 `APP端接口文档v2.md` 一致）。
- `ratel_backend_api.md`（`pudu_ratel_app_mower/build-docs/`）中若示例使用 `/ratel/open-platform-service/api/v1/ratel_task/{action,list}`，模拟器不实现该路径。Mower App 实际调用 `/ratel/central-control-service/api/v1/...`，模拟器与之对齐。
- Device detail and map list support `POST` because the mower app's HTTP bridge currently posts to these constants.
- Unknown routes return `404 { code: 404, message: 'deprecated; removed in simulator v1' }`.

## WebSocket

Connect to:

```text
ws://localhost:9900/acc?ticket=<ticket>
```

A ticket is issued by `POST /ratel/api/v1/wss/acc_ticket` and is one-time use.

### Envelope

All JSON WS messages use:

```json
{ "cmd": "...", "cmd_id": "...", "version": 1, "data": {} }
```

### Client to server

| `cmd` | Required data | Behavior |
|---|---|---|
| `heartbeat` | none | Reply `heartbeat` success. |
| `MAP_INCREMENTAL` ack | `data.code=200` and `msg='success'` or `result='SUCCESS'` | Reply generic ack. |
| `LOCATION_REGISTER` | `{ sn }` | Add this socket to location subscribers. |
| `LOCATION_UNREGISTER` | `{ sn }` | Remove this socket from location subscribers. |

### Server to client

| `cmd` | Data fields |
|---|---|
| `NOTIFY_RATEL_STATUS` | `sn`, `work_status`, `sub_status`, `work_msg`, `battery_level`, `battery`, `signals`, `phase`, `state`; simulator also adds `capabilities`, `estop`, `notices`, `error` for dev parity. |
| `NOTIFY_MOW_STATUS` | Flattened `task_id`, `task_status`, `task_type`, `task_message`, `task_error_code`, `mow_area`, `mow_progress`, `estimated_time`; also duplicated under `payload`. |
| `ROBOT_LOCATION` | `sn`, `mac`, `map_id`, `x`, `y`, `yaw`, `angle`, `timestamp`, `notify_time` |
| `MAP_FIX` | Full map frame on WS connection. |
| `MAP_INCREMENTAL` | Incremental map patches while mapping FSM is in a streaming phase. `map_header` includes `lawn_area` (m², default `width×height×resolution²`). A frame is pushed immediately on streaming-state transitions, then continuously by `PUSH_INTERVAL_MS` while the phase remains streamable. |

`map_data` is **plain base64 (no gzip)** by default, matching the real backend's building increment frames. Clients must therefore set `mapConfig.enableGzipDecompression: false`. Set `MMR_GZIP=1` / `MAP_MOCK_GZIP=1` to opt back into `gzip+base64` for exercising the compressed decode path.

`MAP_MOCK_SLICE_BYTES` / `MMR_SLICE_BYTES` can force `MAP_FIX` and `MAP_INCREMENTAL` frame slicing. The simulator splits the base64 payload on base64-safe 4-character boundaries so each slice remains decodable by RustKit before fragment reassembly.

`ROBOT_LOCATION` is sent every 300ms only to sockets that sent `LOCATION_REGISTER` for the robot SN and while an active mowing task is `ON_THE_WAY`. If the task is already active when the client registers, the server also sends the current pose immediately so mobile clients can bind the first trajectory point without waiting for the next timer tick. Scenario `mowing_trajectory_stream` (or `POST /ratel/central-control-service/api/v1/ratel_task/create`) creates a mock active task so trajectory rendering can be exercised without a real backend. The pose route is generated from the semantic class `0` grass pixels in `full_semanticmap.png`; see [mowing_trajectory.md](mowing_trajectory.md) for the artifact design.

On WS connect the simulator sends `MAP_FIX` and an initial `NOTIFY_RATEL_STATUS` snapshot derived from the virtual robot FSM. Further status pushes use the same `cmd` on FSM changes and after each distinct `(work_status, sub_status)` notify.

## Control API

| Method | Path | Description |
|---|---|---|
| `GET` | `/sim/state` | Full simulator snapshot and chaos settings. |
| `GET` | `/sim/panel` | htmx control panel. |
| `GET` | `/sim/scenarios` | Scenario runner status and available YAML names. |
| `POST` | `/sim/event` | Dispatch a raw FSM event. Body: `{ type, domain?, ...payload }`. |
| `POST` | `/sim/scenario/run` | Run `{ name }` or `{ inline }`; returns logs and final state. |
| `POST` | `/sim/scenario/stop` | Request active scenario cancellation. |
| `POST` | `/sim/recorder/start` | Start JSONL recording. Optional `{ label }`. |
| `POST` | `/sim/recorder/stop` | Stop JSONL recording. |
| `POST` | `/sim/recorder/replay` | Replay `{ file, preserveTiming?, speed? }` or `{ inline }`. |
| `GET` | `/sim/recorder/list` | Recorder status and files. |
| `POST` | `/sim/reset` | Reset robot and task state. |
| `POST` | `/sim/chaos` | Set `{ latencyMs?, dropRate?, reorderWindowMs? }`. |
| `POST` | `/sim/ble/register` | S1 placeholder endpoint. |
| `POST` | `/sim/ble/notify` | S1 placeholder endpoint. |
| `GET` | `/sim/assets/full_semanticmap.png` | Semantic basemap image returned by map list (`map_url` / `semantic_map_url`). |
| `GET` | `/sim/assets/full_rgbmap.png` | Real-scene (RGB) basemap image returned by map list (`real_view_map_url`). |
| `WS` | `/sim/inspect` | Live reducer transcript stream. |
