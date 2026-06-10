# Scenario scripts guide

YAML scenarios drive **cloud-accurate** `NOTIFY_RATEL_STATUS` pushes over WebSocket so the mower App FSM and navigation match production.

## How it works

| Layer | Behavior |
|-------|----------|
| `notify` step | Updates mock FSM **and** broadcasts `NOTIFY_RATEL_STATUS` with `work_status` + `sub_status` |
| App (`useWsDeviceListener`) | Parses same payload → `TaskEventPipeline` → panel / navigation |
| `POST /mapping/start` | Mock FSM `CMD_START` + WS `mapping` + `precondition` |
| Dedup | Identical `(work_status, sub_status)` is not pushed twice |

**Important:** 现在的 4 个场景均自包含——`setup: { state: IDLE }` + `emit CMD_START` 由场景自行建任务，无需 App 先发 HTTP `mapping/start` / `ratel_task/create`。直接在 `/sim/panel` 运行即可驱动 App FSM 与导航；如需配合真机轨迹/瓦片渲染，App 仍需连上 WS（割草轨迹还需 `LOCATION_REGISTER`）。

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

Mowing 场景使用 `domain: mowing` 且自行 `emit CMD_START` 建任务（`mowing_happy_auto`、`mowing_trajectory_stream` 均自包含）。注意：割草 `work_status: mowing` 在 `PREPARING` 下会直接进入 `UNDOCKING`（与建图不同，建图 `work_status: mapping` 在自检阶段保持 `PREPARING`，仅 `leave_dock` 才离桩）。

## 场景说明（Panel / API）

每个 `scenarios/*.yaml` 可包含 `guide:` 块（中文标题、用途、前置条件、操作步骤、自动行为、耗时、推送类型）。在控制台阅读：

1. 启动服务后打开 [http://localhost:9900/sim/panel](http://localhost:9900/sim/panel)
2. 在「场景脚本」下拉框选择场景（选项显示 `[域] 标题 — 文件名`）
3. 点击 **阅读说明** 展开/收起当前场景的逐步说明；切换场景时会自动刷新说明内容

API：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sim/scenarios` | 返回 `scenarios` 列表与 `catalog` 摘要 |
| GET | `/sim/scenario/guide?name=<场景名>` | 返回完整 `guide` 文档（JSON） |

## Run

1. `npm start` mock service; App `mock/config.local.ts` → mock base URL.
2. `/sim/panel` → 选择场景 → **说明** 查看用途 → **运行场景**（自包含，无需 App 先建任务）。
3. 无限循环场景（`*_stream`）测试完成后点击 **停止场景**；运行中可用 **暂停 / 恢复**（按当前活跃域下发）。

```bash
curl -s -X POST http://localhost:9900/sim/scenario/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"mapping_happy_auto"}'
```

## Checked-in scenarios

> 更新日期：2026-06-08。精简为 4 个核心场景（不再模拟异常）。两个 stream 场景均为**无限循环**，需在 `/sim/panel` 点击「停止场景」结束。所有场景均**自包含**（`emit CMD_START` 自建任务），无需 App 先调 HTTP `mapping/start` 或 `ratel_task/create`。

| File | 用途 | 结束方式 |
|------|------|----------|
| `mapping_happy_auto.yaml` | 正常建图 happy flow：完整 NOTIFY 链 → `COMPLETED` | 自动结束（约 1.5 分钟） |
| `mowing_happy_auto.yaml` | 正常割草 happy flow：`map_check → mowing → return_dock → idle` → `COMPLETE` | 自动结束（约 40 秒） |
| `mapping_stream_incremental.yaml` | **无限循环**：在可推流建图阶段间循环，持续广播 `MAP_INCREMENTAL`（测建图渲染） | 手动停止 |
| `mowing_trajectory_stream.yaml` | **无限循环**：保持 `ON_THE_WAY`，沿语义地图路线持续推 `ROBOT_LOCATION`（测割草轨迹渲染） | 手动停止 |

## Supported steps

| Step | Purpose |
|------|---------|
| `notify` | `NOTIFY_RATEL_STATUS` (+ mock FSM via EventAdapter mirror) |
| `emit` | Raw FSM event (`CMD_START` / `CMD_PAUSE` / `CMD_RESUME` / `CMD_RESET` / `DEVICE_*` …) |
| `expect` | Assert mock FSM snapshot |
| `wait` | Delay between WS pushes（在 `loop` 内可被「停止场景」中断，约 50ms 粒度） |
| `loop` | 重复内层 `steps`；省略 `maxIterations`（或 `<= 0`）即无限循环，直到场景被停止 |

### `loop` 用法

```yaml
steps:
  - loop:
      maxIterations: 0   # 省略或 <=0 → 无限循环（手动停止）
      steps:
        - notify: { work_status: mapping, sub_status: bow_cover }
        - wait: 8s
```

无限循环场景下，引擎会自动限制运行日志数量（最多保留最近 500 条），并在停止时返回 `{ ok: true, stopped: true }`（Panel 显示「场景已停止」，非失败）。

> **停止即停推流**：`POST /sim/scenario/stop`（Panel「停止场景」）在中止运行中的脚本循环后会一并 `robot.reset()`。否则机器人会停留在 `WORKING`/`ON_THE_WAY`，`mapTimer`/`locationTimer` 仍按状态持续广播 `MAP_INCREMENTAL` / `ROBOT_LOCATION`。复位后 `activeTask` 置空、`shouldStreamMap` 转 false，推流立即停止。

See [backend-status-mapper-update.md](../../pudu_ratel_app_mower/build-docs/backend-status-mapper-update.md) and APP 端接口文档 §WS接收机器状态变化.
