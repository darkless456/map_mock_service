# Scenario scripts guide

YAML scenarios drive **cloud-accurate** `NOTIFY_RATEL_STATUS` pushes over WebSocket so the mower App FSM and navigation match production.

## How it works

| Layer | Behavior |
|-------|----------|
| `notify` step | Updates mock FSM **and** broadcasts `NOTIFY_RATEL_STATUS` with `work_status` + `sub_status` |
| App (`useWsDeviceListener`) | Parses same payload → `TaskEventPipeline` → panel / navigation |
| `POST /ratel_mapping_task/create` | Mock FSM `CMD_START` + WS `mapping` + `precondition` |
| Dedup | Identical `(work_status, sub_status)` is not pushed twice |

**Important:** 当前 9 个场景均自包含（`setup: { state: IDLE }` + `emit CMD_START` 由场景自行建任务，无需 App 先发 HTTP `ratel_mapping_task/create` / `ratel_task/create`）。直接在 `/sim/panel` 运行即可驱动 App FSM 与导航；如需配合真机轨迹/瓦片渲染，App 仍需连上 WS（割草轨迹还需 `LOCATION_REGISTER`）。

## Mapping `sub_status` sequence (§5.1)

| Step `sub_status` | App FSM / navigation |
|-------------------|----------------------|
| `precondition` | Stay `PREPARING`（设备自检，不跳屏）|
| `leave_dock` | `UNDOCKING` → **DeviceStart** |
| `find_boundary` | `WORKING` + `MAP_SCAN_BOUNDARY` → **CreateMap** |
| `edge_mapping` | 自动：`WORKING/MAP_FOLLOW_BOUNDARY`（自动沿边）；*手摇（`mode=remote`）*：`WORKING` → `REMOTE_CONTROL` + `MAP_FOLLOW_BOUNDARY_MANUAL` → **ManualMap** 交接用户手摇沿边 |
| `map_edge_finish` | `MAP_BOUNDARY_DONE`；手摇态由此 *退出遥控* 回到自动 `WORKING`，进入「Loading」过渡 |
| `exit_mapping` | Legacy preview signal；新流程通常不再需要 |
| `work_status: idle` + `sub_status: none` | `mapping->idle` → `MAP_COMPLETING` + `CMD_CONFIRM` → `COMPLETED/MAP_COMPLETING` |

Between steps, scenarios use `wait: 5s`–`20s` (stream scenario holds 30s in streamable phases).

## Mowing `sub_status` sequence (§5.2)

| Step `sub_status` | Mock FSM |
|-------------------|----------|
| `map_check` | Stay in early prepare / accept `work_status: mowing` |
| `leave_dock` | `UNDOCKING` |
| `mowing` / `edge` | `WORKING` + `MOW_RUNNING` |
| `return_dock`（`work_status: mowing` 的 sub）| `returning` phase（低电回充语义，旧） |
| `work_status: idle` + `sub_status: none` | Task completion edge |

### 回桩（顶层 `work_status: return_dock`，§5.3）

「回充」按钮结束割草任务后，设备上报 *顶层* `work_status: return_dock` 的回桩子流程：

| Step `sub_status`（`work_status: return_dock`）| Mock FSM |
|-------------------|----------|
| `go_to_pre_dock_point` | `RETURNING_DOCK` + `RETURN_PRE_DOCK` |
| `seek_charger_dock` | `RETURN_SEEK_CHARGER` |
| `enter_dock` | `RETURN_ENTER_DOCK` |
| `at_dock` | `RETURN_AT_DOCK`（*不直接完成*）|
| `failed` | `RETURN_DOCK_FAILED`（可恢复错误，留在 `RETURNING_DOCK`）|
| `work_status: idle` + `sub_status: none` | `RETURNING_DOCK → COMPLETED` |

HTTP `POST /ratel/api/v1/robot/recharge/task` 会触发回充任务并自动推送上述 `return_dock`
子流程 + WS `cmd: RECHARGE`（`ON_THE_WAY → COMPLETE`，驱动回充槽按钮）。`mowing_recharge.yaml`
场景以 `notify` 直接驱动回桩子流程，无需 App 调 HTTP。

Mowing 场景使用 `domain: mowing` 且自行 `emit CMD_START` 建任务（`mowing_happy_auto`、`mowing_trajectory_stream` 均自包含）。注意：割草 `work_status: mowing` 在 `PREPARING` 下会直接进入 `UNDOCKING`（与建图不同，建图 `work_status: mapping` 在自检阶段保持 `PREPARING`，仅 `leave_dock` 才离桩）。

## 场景说明（Panel / API）

每个 `scenarios/*.yaml` 可包含 `guide:` 块（中文标题、用途、前置条件、操作步骤、自动行为、耗时、推送类型）。在控制台阅读：

1. 启动服务后打开 [http://localhost:9900/sim/panel](http://localhost:9900/sim/panel)
2. 在「场景脚本」下拉框选择场景（选项显示 `[域] 标题 — 文件名`）。
3. 点击 **阅读说明** 展开/收起当前场景的逐步说明；切换场景时会自动刷新说明内容。

API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sim/scenarios` | 返回 `scenarios` 列表、`catalog` 摘要、`running`、`paused` |
| GET | `/sim/scenario/guide?name=<场景名>` | 返回完整 `guide` 文档（JSON）|
| POST | `/sim/scenario/run` | 运行场景（`name` 或 `inline`），阻塞至完成/停止 |
| POST | `/sim/scenario/pause` | **暂停当前场景脚本**（冻结步骤推进与 `wait` 计时）|
| POST | `/sim/scenario/resume` | **恢复场景脚本**，从暂停处继续后续步骤 |
| POST | `/sim/scenario/stop` | 停止场景脚本并 `robot.reset()`（停推流）|

## Run

1. `npm start` mock service; App `mock/config.local.ts` → mock base URL.
2. `/sim/panel` → 选择场景 → **说明** 查看用途 → **运行场景**（自包含，无需 App 先建任务）。
3. 无限循环场景（`*_stream`）测试完成后点击 **停止场景**；运行中可用 **暂停 / 恢复**。

> **暂停 / 恢复会真正冻结场景脚本本身**（而非仅暂停机器人 FSM），便于停在某个特定流程状态调试。两条路径都生效：
> - **Web 面板** 暂停 / 恢复按钮（内部调 `/sim/scenario/pause`、`/sim/scenario/resume`，并同步下发 `CMD_PAUSE`/`CMD_RESUME` 保持机器人状态一致）；
> - **App 调真实 API** 暂停 / 恢复（`ratel_mapping_task/action`、`ratel_task/action` 最终对机器人下发 `CMD_PAUSE`/`CMD_RESUME`）——机器人会广播 `controlPause`/`controlResume`，引擎据此自动暂停 / 恢复。

> 暂停期间 `wait` 计时被冻结（不消耗等待时长），恢复后从原处继续。当前暂停状态可用 `GET /sim/state` 的 `scenario.paused` 读取，面板运行中会显示「场景 运行中 ▶ / 已暂停 ⏸」。

> ```bash
> curl -s -X POST http://localhost:9900/sim/scenario/pause -d '{}'
> curl -s -X POST http://localhost:9900/sim/scenario/resume -d '{}'
> ```

```bash
curl -s -X POST http://localhost:9900/sim/scenario/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"mapping_happy_auto"}'
```

## Emergency-stop scenarios

Two dedicated emergency-stop scenarios are now available:

- `mapping_estop_edge_follow.yaml`: trigger `work_status: emergency_stop` after `MAP_FOLLOW_BOUNDARY`, verify `ESTOPPED`, release via a real `mapping` frame, then `CMD_RESET` into `RESUMING` and continue to `COMPLETED`.
- `mowing_estop_running.yaml`: trigger `work_status: emergency_stop` during `WORKING/MOW_RUNNING`, verify `ESTOPPED`, release via a real `mowing` frame, then `CMD_RESET` into `RESUMING` and continue to `COMPLETED`.

Both scenarios rely on the mirrored mower FSM where `work_status: emergency_stop` is a protocol input that the shared pipeline normalizes into `DEVICE_ESTOP` instead of forwarding as a normal `DEVICE_WORK_STATUS`.

## Checked-in scenarios

> 更新日期：2026-07-13。当前共 9 个场景；两个 stream 场景均为**无限循环**，需在 `/sim/panel` 点击「停止场景」结束。所有场景均**自包含**（`emit CMD_START` 自建任务），无需 App 先调 HTTP `ratel_mapping_task/create` 或 `ratel_task/create`。

| File | 用途 | 结束方式 |
|------|------|----------|
| `mapping_happy_auto.yaml` | 正常建图 happy flow：完整 NOTIFY 链 → `COMPLETED` | 自动结束（约 1.5 分钟）|
| `mapping_happy_manual.yaml` | 手动遥控建图 happy flow：寻到边交接手摇沿边（`REMOTE_CONTROL`）→ 沿边闭合 → `MAP_COMPLETING` → `COMPLETED` | 自动结束（约 1.5 分钟）|
| `mowing_happy_auto.yaml` | 正常割草 happy flow：`map_check → mowing → return_dock → idle` → `COMPLETE` | 自动结束（约 40 秒） |
| `mowing_recharge.yaml` | 割草并回充（回桩）：割草中触发回充 → `RETURNING_DOCK` 回桩子阶段 → `at_dock` → `idle` → `COMPLETED` | 自动结束（约 35 秒） |
| `mapping_estop_edge_follow.yaml` | 建图沿边后急停：`MAP_FOLLOW_BOUNDARY` → `emergency_stop` → `ESTOPPED` → release + `CMD_RESET` → `RESUMING` → `COMPLETED` | 自动结束（约 1 分钟） |
| `mowing_estop_running.yaml` | 割草执行中急停：`MOW_RUNNING` → `emergency_stop` → `ESTOPPED` → release + `CMD_RESET` → `RESUMING` → `COMPLETED` | 自动结束（约 45 秒） |
| `mapping_stream_incremental.yaml` | **无限循环**：在可推流建图阶段间循环，持续广播 `MAP_INCREMENTAL`（测建图渲染）| 手动停止 |
| `mowing_trajectory_stream.yaml` | **无限循环**：保持 `ON_THE_WAY`，沿语义地图路线持续推 `ROBOT_LOCATION`（测割草轨迹渲染）| 手动停止 |

## Manual mapping with passages (v1.6)

The `mapping_happy_manual.yaml` scenario now supports the full DVT remote mapping workflow:

1. **Switch to remote**: App sends `POST /ratel/api/v1/mapping/mode { mode: "remote" }` or scenario emits `CMD_SWITCH_MANUAL`
2. **Add new lawn**: App sends `POST /ratel/api/v1/mapping/add_lawn` -> mock records `passageStartPoint`
3. **Robot moves**: WS `NOTIFY_RATEL_STATUS` carries `in_lawn: 1` and `edge_start_available: 1`
4. **Confirm edge start**: App sends `POST /ratel/api/v1/mapping/manual { edge_start: 1 }` -> mock records `passageEndPoint`, WS clears `edge_start_available`
5. **App computes passage**: Call `RustKit.queryTrajectorySegment()` between start/end -> construct `BoundaryFeature` -> render in `MapBuilder.passages`
6. **Region closure**: When robot returns near start, WS pushes `region_closeable: 1` -> user clicks confirm -> `POST /ratel/api/v1/mapping/manual { region_closure: 1 }`

### Recovery flow (APP killed and reopened)

1. `POST /ratel/api/v1/mapping/status` -> get `trajectory_url` + `passage_checkpoints`
2. `RustKit.loadTrajectoryFromUrl()` -> restore trajectory engine
3. For each checkpoint pair, call `RustKit.queryTrajectorySegment()` -> rebuild passages
4. Pass reconstructed `BoundaryFeature[]` to `MapBuilder.passages`

### New supported steps

| Step | Purpose |
|------|---------|
| `notify` | Now carries `in_lawn`, `edge_start_available`, `region_closeable` in WS payload |
| `emit` | New events: `CONFIRM_EDGE_START`, `CONFIRM_REGION_CLOSURE`, `RECORD_PASSAGE_START` |

## Supported steps

| Step | Purpose |
|------|---------|
| `notify` | `NOTIFY_RATEL_STATUS` (+ mock FSM via EventAdapter mirror) |
| `emit` | Raw FSM event (`CMD_START` / `CMD_PAUSE` / `CMD_RESUME` / `CMD_RESET` / `DEVICE_*` …) |
| `expect` | Assert mock FSM snapshot |
| `wait` | Delay between WS pushes（在 `loop` 内可被「停止场景」中断，约 50ms 粒度）|
| `loop` | 重复内层 `steps`；省略 `maxIterations`（或 `<= 0`）即无限循环，直到场景被停止 |
| `chaos` | Update WS chaos config: `{ latencyMs, dropRate, reorderWindowMs }` |
| `realism` | Toggle/update real-world latency: `{ enabled, httpDelayMinMs, httpDelayMaxMs, wsDelayMinMs, wsDelayMaxMs }` |
| `fault` | Apply a named preset from `fixtures/faults/*.json`, e.g. `fault: mapping_estop` |
| `record` / `stopRecord` | Start/stop JSONL recording. `record: true` uses the scenario name as file prefix. |

Top-level scenario fields now also support:

| Field | Purpose |
|---|---|
| `dataset` | Switch `MapStream` to `fixtures/datasets/<dataset>/frames` before steps run. |
| `fixtures` | Temporarily override fixture reads while the scenario is running. |

Example:

```yaml
name: self_check_fault_smoke
domain: mapping
dataset: mapping_happy
fixtures:
  device/self_check.jsonc: { overall: "error", blade: "warning" }
steps:
  - fault: network_delay
  - realism: { enabled: true, httpDelayMinMs: 500, httpDelayMaxMs: 3000, wsDelayMinMs: 2000, wsDelayMaxMs: 8000 }
  - emit: { type: CMD_START, mode: auto, taskMode: MAP_BUILD }
```

### `loop` 用法

```yaml
steps:
  - loop:
      maxIterations: 0   # 省略或 <=0 → 无限循环（手动停止）
      steps:
        - emit: { type: DEVICE_ERROR, code: boundary_lost, recoverable: true }
        - wait: 8s
```

无限循环场景下，引擎会自动限制运行日志数量（最多保留最近 500 条），并在停止时返回 `{ ok: true, stopped: true }`（Panel 显示「场景已停止」，非失败）。

> **停止即停推流**：`POST /sim/scenario/stop`（Panel「停止场景」）在中止运行中的脚本循环后会一并 `robot.reset()`。否则机器人会停留在 `WORKING`/`ON_THE_WAY`，`mapTimer`/`locationTimer` 仍按状态持续广播 `MAP_INCREMENTAL` / `ROBOT_LOCATION`。复位后 `activeTask` 置空、`shouldStreamMap` 转 false，推流立即停止。

See [backend-status-mapper-update.md](../../pudu_ratel_app_mower/build-docs/backend-status-mapper-update.md) and APP 端接口文档 §WS 接收机器状态变化。
