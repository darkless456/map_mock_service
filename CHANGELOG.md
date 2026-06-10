# Changelog

## Unreleased

### Changed

- **建图增量帧默认不再 gzip 压缩，与真实后端保持一致。** `encodeMapData` 现在仅做 `base64`（不压缩），客户端需配置 `mapConfig.enableGzipDecompression: false`（POC `MapBuilderScreen` 已为 `false`）。如需回归压缩解码路径，设置 `MMR_GZIP=1` / `MAP_MOCK_GZIP=1` 切回 `base64 + gzip`。
- WS status pushes now use **`NOTIFY_RATEL_STATUS`** only (removed `ROBOT_STATUS` broadcasts).
- Mowing task create / resume drive FSM via `sub_status` notify sequence (`map_check` → `leave_dock` → `mowing`).
- Scenario `notify` steps work for both `mapping` and `mowing` domains.
- **Scenarios 精简为 4 个核心场景**（不再模拟异常）：`mapping_happy_auto`、`mowing_happy_auto`（正常流程，自动结束）、`mapping_stream_incremental`、`mowing_trajectory_stream`（无限循环帧/轨迹，手动停止）。删除 `mapping_pause_resume` / `mapping_scan_failed_manual` / `mapping_cancel_during_work` / `mowing_task_normal` / `mowing_task_normal_standalone`。
- 全部场景改为**自包含**（`emit CMD_START` 自建任务），无需 App 先调 HTTP `mapping/start` / `ratel_task/create`。
- **`/sim/panel` 重做**：聚焦运行/停止场景；暂停/恢复改为按当前活跃域（mapping/mowing）下发且恢复自动回到 WORKING（修复原先硬编码 `mapping` 导致按钮无效）；移除令人困惑的混沌网络、急停、底部原始事件单步调试；新增运行状态提示与按钮禁用态。

### Fixed

- **暂停 / 恢复现在会真正暂停「场景脚本」本身（修复调试时无法停在特定流程状态）。** 此前暂停 / 恢复（无论 Web 面板还是 App 调 API）只把 `CMD_PAUSE`/`CMD_RESUME` 下发给机器人 FSM，而 `ScenarioEngine` 的脚本循环只检查 `abortRequested`（停止），没有「暂停」概念，于是场景照旧推进、`wait` 照旧计时，根本停不下来。现在：① `ScenarioEngine` 新增 `paused` 标志与 `pause()`/`resume()`，步骤推进与 `wait` 计时在暂停期间一并冻结（恢复后从原处继续）；② `VirtualRobot` 在 `dispatchMapping`/`dispatchMowing` 收到 `CMD_PAUSE`/`CMD_RESUME` 时广播 `controlPause`/`controlResume`，引擎据此自动暂停 / 恢复——因此 **Web 面板按钮与 App 的 `mapping/pause`、`ratel_task/action` 等 API 两条路径都生效**；③ 新增 `POST /sim/scenario/pause`、`POST /sim/scenario/resume` 显式端点，`/sim/state` 的 `scenario.paused` 暴露暂停态，面板在运行中展示「场景: 运行中 ▶ / 已暂停 ⏸」。`stop()` 会先解除暂停以免脚本卡死在等待恢复。
- **连接即自动订阅位置流（修复 POC 收不到 `ROBOT_LOCATION` / 机器人不动）。** 诊断发现：mock 正确广播 `ROBOT_LOCATION` 但 `subscriberCount` 恒为 0，且从未收到任何 `LOCATION_REGISTER` —— 即客户端（POC RN 集成）的原生 `wsSend` 上行不可靠，登记请求到不了服务端。作为开发模拟器，现在 WS 连接建立时**自动把该连接登记为当前机器人 SN 的位置订阅者**，只要任务 `ON_THE_WAY` 机器人就会动；客户端显式 `LOCATION_REGISTER`/`LOCATION_UNREGISTER` 仍正常生效。新增诊断日志：`LOCATION_REGISTER received`（含 `subscriberCount`/`snMatchesRobot`/`taskStatus`）、`ROBOT_LOCATION broadcast`（每秒一条，含 `subscriberCount`）。
- **「停止场景」现在会真正停止推流。** 此前 `/sim/scenario/stop` 仅中止脚本循环，而 WS 推流（`mapTimer` 的 `MAP_INCREMENTAL` / `locationTimer` 的 `ROBOT_LOCATION`）由机器人 FSM 状态驱动，停止后机器人仍处于 `WORKING`/`ON_THE_WAY`，数据继续广播。现停止运行中的场景时会一并 `robot.reset()`，`activeTask` 置空、`shouldStreamMap` 转 false，两个定时器立即停止。
- **新连接不再补发终态任务的 `NOTIFY_MOW_STATUS`。** 仅当活跃任务为 `ON_THE_WAY`/`PAUSE` 时才在 WS 连接建立时补发。终态任务（`COMPLETE`/`CANCEL`/`FAILED`）会让 App 割草页直接进入 `finished`，阻断「底图就绪 → REST 建任务 → `LOCATION_REGISTER`」的自动握手，导致重新进入割草页后收不到 `ROBOT_LOCATION`、机器人与轨迹都不刷新。

### Added

- **新增 `mapping_happy_manual` 场景**（手动遥控建图 happy flow）：`emit CMD_START mode=remote` 自建任务，按 NOTIFY 顺序 `precondition → leave_dock → find_boundary → boundary_found → map_edge_finish → bow_cover → exit_mapping → idle`。寻到边（`boundary_found`）交接手摇 `REMOTE_CONTROL`/`MAP_FOLLOW_BOUNDARY_MANUAL`，沿边闭合后回到自动 `WORKING` 并经「Loading + 确认进覆盖」（`emit CMD_START_COVERAGE`）进入内部覆盖至 `COMPLETED`。同步 `npm run sync-fsm-mirror`（FSM 镜像随 mower 手动建图重构更新；`cloudWorkStatus.ts` → `workStatus.ts`）。
- 场景引擎新增 **`loop` 步骤**（`maxIterations` 省略/`<=0` 即无限循环），`wait` 在循环内可被「停止场景」按 ~50ms 粒度中断；停止时返回 `{ ok: true, stopped: true }`，运行日志上限 500 条。
- Docs updated for canonical WS status cmd and correct `ratel_task/create` path.

## v1.0.0 - 2026-05-30

### Breaking changes

- Rebuilt the service as **Mower Dev Simulator**.
- Removed the legacy JavaScript entry point `src/index.js`.
- Removed all legacy `/api/robot/*` status-helper routes, including `start_mapping`, `stop_mapping`, `start_charging`, and `set_sn`.
- Removed legacy JS tests under `src/__tests__/`.
- Switched runtime and tests to TypeScript via `tsx` and `node --test --import tsx`.

### Added

- TypeScript HTTP router for the mower business API paths.
- One-time `/acc` WebSocket ticket issuance.
- FSM mirror sync script: `npm run sync-fsm-mirror`.
- `VirtualRobot` bridge for mapping and mowing FSM state.
- `ROBOT_STATUS`, `NOTIFY_MOW_STATUS`, `ROBOT_LOCATION`, `MAP_FIX`, and `MAP_INCREMENTAL` pushes.
- Dev control APIs: `/sim/state`, `/sim/event`, `/sim/reset`, `/sim/chaos`, `/sim/ble/*` placeholders.
- YAML scenario engine with `/sim/scenario/run`, `/sim/scenario/stop`, and checked-in scenarios.
- htmx control panel at `/sim/panel` plus live reducer transcript WS at `/sim/inspect`.
- JSONL recorder/replay APIs: `/sim/recorder/start`, `/sim/recorder/stop`, `/sim/recorder/replay`, `/sim/recorder/list`.
- Chaos injection is now wired into outbound WS sending for latency, drop, and reorder-window jitter.
- New docs: [CONTRIBUTING.md](CONTRIBUTING.md), [docs/api.md](docs/api.md), [docs/fsm-mirror.md](docs/fsm-mirror.md), [docs/scenarios.md](docs/scenarios.md).
