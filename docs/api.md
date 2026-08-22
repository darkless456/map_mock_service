# Simulator API

This document is the S0-S3 API contract for Mower Dev Simulator. Business API paths are intentionally limited to the mower app integration and the backend docs. The old `open-platform-service` mowing paths and legacy `/api/robot/*` helpers are not accepted.

## HTTP

| Method | Path | Response summary |
|---|---|---|
| `POST` | `/ratel/api/v1/wss/acc_ticket` | `{ code, message, ticket, expire_seconds, wss_path_hint }` |
| `POST` | `/ratel/api/v1/courtyard/robot/detail` | `{ code, message, data: IDevice }` — body `{ sn }`; validates the simulator SN, returns FSM-derived `running_status` / charging data, current map metadata, and (mapping-v4-final-spec.md §4) `sub_status` / `sub_status_entered_at` / `extend_status`, mirroring the WS `NOTIFY_RATEL_STATUS` projection for reconnect recovery. |
| `POST` | `/ratel/api/v1/courtyard/robot/info/update` | `{ code, message, data: IDevice }` |
| `POST` | `/ratel/api/v1/courtyard/robot/unbind` | `{ code, message, data: { robot_code, robot_message } }` |
| `GET/POST` | `/ratel/map-service/api/v1/ratel/map/list` | `{ code, data: { total, items } }`；`items[]` 含 `map_url` / `semantic_map_url` / `real_view_map_url` / `map_origin_x` / `map_origin_y` / `resolution` / `base_version` / `unit` / `increments`（命名对齐 APP端接口文档v2.md） |
| `POST` | `/ratel/map-service/api/v1/ratel/semantic/save` | `{ code, data: { base_version } }` |
| | | v1.6: body 支持 `name` 字段保存地图名称 |
| `POST` | `/ratel/api/v1/map/delete` | `{ code, data: { deleted, map_id } }` |
| `POST` | `/ratel/api/v1/robot/self_check` | `{ code, data: { checked_at, overall, … } }` — 建图前置触发机器自检 |
| `POST` | `/ratel/api/v1/mapping/check` | `{ code, data: { bluetooth_status, cellular, wifi, … } }` 扁平 — 建图条件检测（须先 self_check）；Mock 渐进返回） |
| `POST` | `/ratel/api/v1/mapping/mode` | `{ code, data: { robot_code, robot_message } }` — body `{ sn, mode }` |
| `POST` | `/ratel/api/v1/mapping/add_lawn` | `{ code, data: { robot_code, robot_message } }` — 添加新草坪（记录 passageStartPoint） |
| `POST` | `/map-service/api/v1/ratel_map/labels` | `{ code, data: { map_id, labels } }` — 动态生成的地图标注列表（mapping-v4-final-spec.md §6），`labels[]` 含 `edge_start`/`aisle` 两类，随建图 FSM 阶段推进增量追加 |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/create` | `{ code, data: { task_id, robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/action` | `{ code, data: { robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/list` | `{ code, data: { total, list, task_info, task_notify } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/create` | `{ code, data: { task_id, robot_code, robot_message } }` — replaces removed `mapping/start` (建图任务API重构方案.md §6.2)。`mode` 取 `auto`/`manual`/`follow`/**`extend`**；`extend`（APP端接口文档 v9 新增）= 地图编辑页「添加 → 添加草坪」的扩展建图入口，取代已删除的 `/ratel/api/v1/mapping/expansion`：复用请求里的既有 `map_id`（不校验其存在性）、任务记录 `mode` 记为 `extend`（任务列表回给 App，App 归一为手摇会话 `remote`）、**保留既有 `mappingLabels`**（新通道 label 追加而非取代），并切到 `EXPAND_AREA_DATASET`（`mapping_lawn2_aisle`）。与普通 create 一样**必须返回 `task_id`**（App 侧对 extend 同样 fail-fast）。响应后异步推 `precondition → leave_dock → find_boundary`，两个延迟都远小于 Mower `START_STATUS_WATCHDOG_MS`（12s，常量见 `SimulatorDefaults.ts`）。错误：`400` 缺 `sn`/`map_id`/`mode`、`404`「无法获取设备 MAC」（`sn` 与模拟器不符）、`409` 设备忙（建图/割草任务处于 `ON_THE_WAY`/`PAUSE`）或草坪数已达 `EXPAND_AREA_MAX_LAWNS`。区别于 `ratel_mapping_task/action` 的 `EXPAND_AREA`（建图完成页入口，要求 `sub_status === 'expand_area'`）。 |
| `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/action` | `{ code, data: { robot_code, robot_message } }` — body `{ sn, task_id?, action: PAUSE\|RESUME\|STOP\|EDGE_START\|EDGE_CLOSE\|COMPLETE\|EXPAND_AREA, payload?: { save } }`; replaces removed `mapping/pause`\|`resume`\|`stop`. `EDGE_START`/`EDGE_CLOSE` (mapping-v4-final-spec.md §1) only accept/consume the `extend_status.legitimate_starting_point`/`legitimate_end_point` signal — the actual `sub_status` transition (`edge_mapping`/`map_edge_finish`) arrives ~800ms later as a separate async device push, mirroring real "accepted ≠ effective" semantics. `COMPLETE` only accepted while `sub_status==='expand_area'`（完成等待页，见 §3）; takes effect immediately (cancels the 120s auto-complete countdown, dispatches `CMD_CONFIRM` synchronously) — see `MAP_COMPLETING_DURATION_MS` in `SimulatorDefaults.ts`. `EXPAND_AREA` (mapping-v4-final-spec.md §7) same precondition as `COMPLETE`, plus rejects with `409` once the `edge_start` label count (§5 `lawn_count`) reaches 15; on success switches `mapStream` to the `mapping_lawn2_aisle` dataset (reused for every lawn beyond the first — see `EXPAND_AREA_DATASET` in `SimulatorDefaults.ts`), cancels the countdown, and pushes `sub_status: find_boundary` (same value set as lawn 1 — "which lawn" is carried only by the `labels` count, never a new field). Errors carry a real HTTP status: `400` malformed body, `404` task not found, `409` wrong phase / task not active / lawn cap reached, `422` legitimacy signal is 0. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_mapping_task/list` | `{ code, data: { total, list } }` — `list[]` items: `{ task_id, task_status, task_info, task_notify, create_time, update_time }` |
| `GET` | `/api/health` | Local health status. |

### Notes

- Every HTTP response carries `X-Mock-Request-Id`. The default JSON body remains contract-exact. For local RN debugging only, send `X-Mock-Debug-Echo: 1` (or start with `MOCK_ECHO_REQUEST_PAYLOAD=1`) to add `_mock: { requestId, requestPayload }` to business JSON responses. Debug payloads are redacted and size-limited; `/sim/*`, health, binary assets, and WebSocket messages are excluded.
- `map/list` 的 `items[].increments[]` 为标注 / 点位增量，单项形如 `{ element_id, type, shape, points, properties, source }`。`type` 是 0-255 语义码：禁区 `251`、圆禁区 `201`、虚拟墙 `254`、**充电桩 `69`** 等。静态增量数据源为 `fixtures/maps/map_list.json`；`semantic/save` 写入的运行时覆盖保存在内存中，并在后续 `map/list` 中覆盖对应地图项。
- `increments[].source` = `"robot"` / `"app"`，标识数据来源并决定 APP 端可编辑性：`robot`（机器人/后端上报，如充电桩）只读不可编辑、不参与 `semantic/save` 回传；`app`（用户绘制，如禁区/虚拟墙）可编辑可保存。**`semantic/save` 的回传 body 不含 `source`**（与 `APP端接口文档v2.md` 一致）。
- `ratel_backend_api.md`（`pudu_ratel_app_mower/build-docs/`）中若示例使用 `/ratel/open-platform-service/api/v1/ratel_task/{action,list}`，模拟器不实现该路径。Mower App 实际调用 `/ratel/central-control-service/api/v1/...`，模拟器与之对齐。
- Device detail requires `POST` because the mower app's HTTP bridge posts `{ sn }` to this constant. The response is derived from the same virtual-robot FSM as task APIs and `NOTIFY_RATEL_STATUS`: `return_dock` is translated to the device-detail spelling `returning_charge`, and `estop` to `emergency_stop`. An active `RECHARGE` task is projected as `returning_charge` before its asynchronous first WS status frame. `battery_charging` is `1` only while the FSM is charging. `map_id` / `map_url` point to the active `map/list` fixture entry. The payload also carries the fields the mower app's `IDeviceInfo` consumes for the home-screen battery/charging/connectivity/map placeholders (`bt_connected`, `wifi_connected`/`wifi_rssi`/`wifi_signal_strength`, `cellular_connected`/`cellular_signal_strength`, `isConnected`, `bound_map_count`) plus fields the real gateway returns but the app does not yet consume (`ble_mac`, `access_role`, `wifi_ssid`, `rtk_is_fixed`, `rtk_satellites_used`, `battery_temperature`) — archived per `APP端接口文档-额外补充.md` for response parity; `rtk_is_fixed`/`rtk_satellites_used` derive from whether the FSM is `mowing`/`mapping`, and `battery_temperature` bumps while charging.
- Map list supports `POST` because the mower app's HTTP bridge currently posts to that constant.
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
| `NOTIFY_RATEL_STATUS` | `sn`, `work_status`, `sub_status`, `sub_status_entered_at`, `work_msg`, `battery_level`, `battery`, `signals`, `phase`, `state`; while `work_status=mapping` also carries `extend_status` (`legitimate_starting_point`/`legitimate_end_point`/`manual_closure_suggested`/`locator_status`/`operation_status`/`switch_remote_control`/`area_complete_map_build`/`blade_status`, mapping-v4-final-spec.md §2), `map_id`, `mode`; simulator also adds `capabilities`, `estop`, `notices`, `error` for dev parity. |
| `NOTIFY_MOW_STATUS` | Flattened `task_id`, `task_status`, `task_type`, `task_message`, `task_error_code`, `mow_area`, `mow_progress`, `estimated_time`; also duplicated under `payload`. |
| `RATEL_MAPPING_TASK` | `sn`, `payload: { task_id, task_status, map_id, task_message, task_error_code }`. Task-level confirmation push for the mapping task model (建图任务API重构方案.md §6.2), independent from phase-driven `NOTIFY_RATEL_STATUS`. Sent on task creation, FSM changes while a mapping task is active, and terminal status; also replayed on new WS connection if an active task exists (`ON_THE_WAY`/`PAUSE`). |
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
| `GET` | `/sim/realism` | Current real-world latency config. |
| `POST` | `/sim/realism` | Toggle/update `{ enabled?, httpDelayMinMs?, httpDelayMaxMs?, wsDelayMinMs?, wsDelayMaxMs? }`. |
| `GET` | `/sim/dataset` | Current map-frame dataset `{ name, patchCount }`. |
| `POST` | `/sim/dataset` | Switch map-frame dataset. Body/query: `{ name }`. |
| `GET` | `/sim/faults` | List `fixtures/faults/*.json` presets. |
| `POST` | `/sim/fault` | Apply a fault preset. Body/query: `{ name }`. |
| `POST` | `/sim/ble/register` | S1 placeholder endpoint. |
| `POST` | `/sim/ble/notify` | S1 placeholder endpoint. |
| `GET` | `/sim/assets/full_semanticmap.png` | Semantic basemap image returned by map list (`map_url` / `semantic_map_url`). |
| `GET` | `/sim/assets/full_rgbmap.png` | Real-scene (RGB) basemap image returned by map list (`real_view_map_url`). |
| `GET` | `/sim/assets/mapping_trajectory.bin` | Mock trajectory binary file for recovery testing (f32 triplets: x, y, t). |
| `WS` | `/sim/inspect` | Live reducer transcript and business HTTP request stream. |
