# Simulator API

This document is the S0-S3 API contract for Mower Dev Simulator. Business API paths are intentionally limited to the mower app integration and the backend docs. The old `open-platform-service` mowing paths and legacy `/api/robot/*` helpers are not accepted.

## HTTP

| Method | Path | Response summary |
|---|---|---|
| `POST` | `/ratel/api/v1/wss/acc_ticket` | `{ code, message, ticket, expire_seconds, wss_path_hint }` |
| `GET/POST` | `/ratel/api/v1/courtyard/robot/detail` | `{ code, message, data: IDevice }` |
| `POST` | `/ratel/api/v1/courtyard/robot/info/update` | `{ code, message, data: IDevice }` |
| `POST` | `/ratel/api/v1/courtyard/robot/unbind` | `{ code, message, data: { robot_code, robot_message } }` |
| `GET/POST` | `/ratel/map-service/api/v1/ratel/map/list` | `{ code, data: { total, items } }` |
| `POST` | `/ratel/map-service/api/v1/ratel/semantic/save` | `{ code, data: { base_version } }` |
| `POST` | `/ratel/api/v1/map/delete` | `{ code, data: { deleted, map_id } }` |
| `POST` | `/ratel/api/v1/mapping/start` | `{ code, data: { robot_code, robot_message, map_id } }` |
| `POST` | `/ratel/api/v1/mapping/pause` | `{ code, data: { robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/create` | `{ code, data: { task_id, robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/action` | `{ code, data: { robot_code, robot_message } }` |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/list` | `{ code, data: { total, list, task_info, task_notify } }` |
| `GET` | `/api/health` | Local health status. |

### Notes

- `mowing_api.md` examples that use `/ratel/open-platform-service/api/v1/ratel_task/{action,list}` are not implemented. The mower app calls `/ratel/central-control-service/api/v1/...` and the simulator follows that path.
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
| `ROBOT_STATUS` | `sn`, `work_status`, `battery`, `signals`, `mapping_phase`, `phase`, `capabilities`, `estop`, `notices`, `error`, `state` |
| `NOTIFY_MOW_STATUS` | Flattened `task_id`, `task_status`, `task_type`, `task_message`, `task_error_code`, `mow_area`, `mow_progress`, `estimated_time`; also duplicated under `payload`. |
| `ROBOT_LOCATION` | `sn`, `mac`, `map_id`, `x`, `y`, `yaw`, `angle`, `timestamp`, `notify_time` |
| `MAP_FIX` | Full map frame on WS connection. |
| `MAP_INCREMENTAL` | Incremental map patches while mapping FSM is in a streaming phase. A frame is pushed immediately on streaming-state transitions, then continuously by `PUSH_INTERVAL_MS` while the phase remains streamable. |

`MAP_MOCK_SLICE_BYTES` / `MMR_SLICE_BYTES` can force `MAP_FIX` and `MAP_INCREMENTAL` frame slicing. The simulator splits the gzip+base64 payload on base64-safe 4-character boundaries so each slice remains decodable by RustKit before fragment reassembly.

`ROBOT_LOCATION` is sent every 300ms only to sockets that sent `LOCATION_REGISTER` for the robot SN and while an active mowing task is `ON_THE_WAY`. If the task is already active when the client registers, the server also sends the current pose immediately so mobile clients can bind the first trajectory point without waiting for the next timer tick. Scenario-based mowing `CMD_START` creates a mock active task automatically so `mowing_trajectory_stream` can drive trajectory rendering without going through the REST create-task API. The pose route is generated from the semantic class `0` grass pixels in `full_semanticmap.png`; see [mowing_trajectory.md](mowing_trajectory.md) for the artifact design.

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
| `GET` | `/sim/assets/full_semanticmap.png` | Basemap image returned by map list. |
| `WS` | `/sim/inspect` | Live reducer transcript stream. |
