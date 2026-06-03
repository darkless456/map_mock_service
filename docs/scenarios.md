# Scenario scripts guide

YAML scenarios drive **cloud-accurate** `NOTIFY_RATEL_STATUS` pushes over WebSocket so the mower App FSM and navigation match production.

## How it works

| Layer | Behavior |
|-------|----------|
| `notify` step | Updates mock FSM **and** broadcasts `NOTIFY_RATEL_STATUS` with `work_status` + `sub_status` |
| App (`useWsDeviceListener`) | Parses same payload → `TaskEventPipeline` → panel / navigation |
| `POST /mapping/start` | Mock FSM `CMD_START` + WS `mapping` + `precondition` |
| Dedup | Identical `(work_status, sub_status)` is not pushed twice |

**Important:** Scenarios assume the App has already started mapping (`POST /mapping/start` or `session.cmdStart`) and is on **CreateMap** with `PREPARING`. Setup `state: PREPARING` matches that. Running a scenario alone does not replace HTTP start on the phone.

## Mapping `sub_status` sequence (§5.1)

| Step `sub_status` | App FSM / navigation |
|-------------------|----------------------|
| `precondition` | Stay `PREPARING`（设备自检，不跳屏） |
| `leave_dock` | `UNDOCKING` → **DeviceStart** |
| `find_boundary` | `WORKING` + `MAP_SCAN_BOUNDARY` → **CreateMap** |
| `edge_mapping` | `MAP_FOLLOW_BOUNDARY` |
| `map_edge_finish` | `MAP_BOUNDARY_DONE` |
| `bow_cover` | `MAP_COVERAGE_RUN` |
| `exit_mapping` | `MAP_COVERAGE_DONE` |
| `work_status: idle` + `sub_status: none` | `mapping→idle` → **COMPLETED** |

Between steps, scenarios use `wait: 5s`–`20s` (stream scenario holds 30s in streamable phases).

## Mowing `sub_status` sequence (§5.2)

| Step `sub_status` | Mock FSM |
|-------------------|----------|
| `map_check` | Stay in early prepare / accept `work_status: mowing` |
| `leave_dock` | `UNDOCKING` |
| `mowing` / `edge` | `WORKING` + `MOW_RUNNING` |
| `return_dock` | `returning` phase |
| `work_status: idle` + `sub_status: none` | Task completion edge |

Mowing scenarios use `domain: mowing` and assume the App has already called `POST /ratel/central-control-service/api/v1/ratel_task/create` (mock FSM `PREPARING`) unless the scenario emits `CMD_START` itself.

## Run

1. `npm start` mock service; App `mock/config.local.ts` → mock base URL.
2. On device: Prepare → Select mode → **CreateMap** (HTTP start).
3. `/sim/panel` → run `mapping_happy_auto` **or** rely on HTTP start + manual NOTIFY from firmware.

```bash
curl -s -X POST http://localhost:9900/sim/scenario/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"mapping_happy_auto"}'
```

## Checked-in scenarios

| File | Use |
|------|-----|
| `mapping_happy_auto.yaml` | Full NOTIFY flow → COMPLETED |
| `mapping_stream_incremental.yaml` | Long holds for `MAP_INCREMENTAL` |
| `mapping_pause_resume.yaml` | Pause / resume during cover |
| `mapping_scan_failed_manual.yaml` | Scan fail → remote |
| `mapping_cancel_during_work.yaml` | Cancel on edge |
| `mowing_happy_auto.yaml` | Mowing NOTIFY flow → `WORKING` / `MOW_RUNNING` |
| `mowing_trajectory_stream.yaml` | Hold `ON_THE_WAY` for `ROBOT_LOCATION` debugging |

## Supported steps

| Step | Purpose |
|------|---------|
| `notify` | `NOTIFY_RATEL_STATUS` (+ mock FSM via EventAdapter mirror) |
| `emit` | Raw FSM event (`CMD_*`, `DEVICE_ERROR`, …) |
| `expect` | Assert mock FSM snapshot |
| `wait` | Delay between WS pushes |

See [backend-status-mapper-update.md](../../pudu_ratel_app_mower/build-docs/backend-status-mapper-update.md) and APP 端接口文档 §WS接收机器状态变化.
