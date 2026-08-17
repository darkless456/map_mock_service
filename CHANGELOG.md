# Changelog

## Unreleased

### Added

- **`extend_status` 新增 `wait_extend_timestamp`（建图完成等待页的倒计时锚点）。** 值为进入 `MAP_COMPLETING` 等待窗口的那一刻（**毫秒 epoch**），与 mock 自己的 120s 自动完成定时器（`armMapCompletingCountdown`）**同源**，因此 App 显示的剩余秒数与 mock 的自动 `COMPLETE` 时刻严格一致。窗口外恒为 `0`——真机语义是「字段常在，无窗口时为 `0`」，Mower 侧 `toEpochMs(0) === null` 会读成「倒计时已归零 → 立即下发完成请求」。门禁与 `area_complete_map_build` 完全一致：只有 `sub_status === 'expand_area'` 的帧上才是真实时刻。
- **新增 `POST /ratel/api/v1/mapping/expansion`（发起地图扩展，APP端接口文档 §9.1）——支撑地图编辑页「添加 → 添加草坪」。** 后端与 PuduLink 已实现、机器端尚未支持，先由模拟器补齐联调链路。行为对齐 §9.1：成功只返回 `{ code: 200, message: "SUCCESS" }`（**不带 `data`**，`data.robot_code`/`robot_message` 仅在设备拒绝时出现）；不校验 `map_id` 是否存在（PuduLink 只透传）；先同步等待 `MAPPING_EXPANSION_ACK_DELAY_MS` 模拟「等待设备回包」再响应。响应之后由 `VirtualRobot.startMappingExpansion` 异步推 `precondition → leave_dock → find_boundary(mode=remote)`，两个延迟常量都远小于 Mower 的 `START_STATUS_WATCHDOG_MS`（12s），确保 App 的启动看门狗不会误判失败。成功时切到 `EXPAND_AREA_DATASET`（`mapping_lawn2_aisle`），并**刻意保留既有 `mappingLabels`**（地图资产而非会话状态，`useMappingPassageCapture` 靠它做通道端点归属）。错误：`400` 缺参、`404`「无法获取设备 MAC」、`409` 设备忙 / 草坪数达 `EXPAND_AREA_MAX_LAWNS`。注意与 `ratel_mapping_task/action` 的 `EXPAND_AREA` 是**两条不同入口**：后者属于建图完成页、要求 `sub_status === 'expand_area'`，不能复用。
- **新增场景 `mapedit_add_lawn`**：建完一块草坪后 `idle` 收口，停在「设备空闲 + 已有地图」这一进入地图编辑页的真实前置，等 App 点「添加草坪」发起扩展；后续状态推进全部由路由与 `VirtualRobot` 定时器驱动。
- **新增 `src/http/routes/mappingErrors.ts`**：`MAPPING_ERROR_STATUS` 从 `mappingTask.routes.ts` 提取为共享映射，`ratel_mapping_task/action` 与 `mapping/expansion` 共用同一套 `400/404/409/422` 语义。

### Changed

- **⚠️ 协议更正：`MAP_COMPLETING` 的 `sub_status` 由 `map_completing` 改为 `expand_area`。** 2026-07-13 记录的 `map_completing` 是错的；固件的真实值是 `expand_area`（语义为「等待用户决定是否再加一块草坪」）。Mower 侧已把 `map_completing` 降为 `SKIP`、`expand_area → MAP_COMPLETING` 作为**唯一**入口，因此 mock 若继续推 `map_completing`，App 永远进不了建图完成页、也就永远读不到新的 `wait_extend_timestamp`。本仓库同步改动：`deriveSubStatus`（`pushChannels.ts`）、`COMPLETE`/`EXPAND_AREA` 两个 action 的门禁（`virtualRobotCore.ts`）、五个场景 YAML、以及 `docs/mapping-v4-final-spec.md` §3 决策表第 4 行。

- **建图增量帧默认不再 gzip 压缩，与真实后端保持一致。** `encodeMapData` 现在仅做 `base64`（不压缩），客户端需配置 `mapConfig.enableGzipDecompression: false`（POC `MapBuilderScreen` 已为 `false`）。如需回归压缩解码路径，设置 `MMR_GZIP=1` / `MAP_MOCK_GZIP=1` 切回 `base64 + gzip`。
- WS status pushes now use **`NOTIFY_RATEL_STATUS`** only (removed `ROBOT_STATUS` broadcasts).
- Mowing task create / resume drive FSM via `sub_status` notify sequence (`map_check` → `leave_dock` → `mowing`).
- Scenario `notify` steps work for both `mapping` and `mowing` domains.
- **Scenarios 精简为 4 个核心场景**（不再模拟异常）：`mapping_happy_auto`、`mowing_happy_auto`（正常流程，自动结束）、`mapping_stream_incremental`、`mowing_trajectory_stream`（无限循环帧/轨迹，手动停止）。删除 `mapping_pause_resume` / `mapping_scan_failed_manual` / `mapping_cancel_during_work` / `mowing_task_normal` / `mowing_task_normal_standalone`。
- 全部场景改为**自包含**（`emit CMD_START` 自建任务），无需 App 先调 HTTP `mapping/start` / `ratel_task/create`。
- **`/sim/panel` 重做**：聚焦运行/停止场景；暂停/恢复改为按当前活跃域（mapping/mowing）下发且恢复自动回到 WORKING（修复原先硬编码 `mapping` 导致按钮无效）；移除令人困惑的混沌网络、急停、底部原始事件单步调试；新增运行状态提示与按钮禁用态。

### Fixed

- **`httpRealism` 用例不再随机变红。** 注入延迟从 20ms 提到 200ms、阈值同步放宽（业务路由 ≥150ms / 控制路由 <100ms）：原阈值只有 15ms 余量，`node --test` 并行跑用例时的调度抖动就能让「控制路由未被延迟」这条断言失败。
- **暂停 / 恢复现在会真正暂停「场景脚本」本身（修复调试时无法停在特定流程状态）。** 此前暂停 / 恢复（无论 Web 面板还是 App 调 API）只把 `CMD_PAUSE`/`CMD_RESUME` 下发给机器人 FSM，而 `ScenarioEngine` 的脚本循环只检查 `abortRequested`（停止），没有「暂停」概念，于是场景照旧推进、`wait` 照旧计时，根本停不下来。现在：① `ScenarioEngine` 新增 `paused` 标志与 `pause()`/`resume()`，步骤推进与 `wait` 计时在暂停期间一并冻结（恢复后从原处继续）；② `VirtualRobot` 在 `dispatchMapping`/`dispatchMowing` 收到 `CMD_PAUSE`/`CMD_RESUME` 时广播 `controlPause`/`controlResume`，引擎据此自动暂停 / 恢复——因此 **Web 面板按钮与 App 的 `mapping/pause`、`ratel_task/action` 等 API 两条路径都生效**；③ 新增 `POST /sim/scenario/pause`、`POST /sim/scenario/resume` 显式端点，`/sim/state` 的 `scenario.paused` 暴露暂停态，面板在运行中展示「场景: 运行中 ▶ / 已暂停 ⏸」。`stop()` 会先解除暂停以免脚本卡死在等待恢复。
- **连接即自动订阅位置流（修复 POC 收不到 `ROBOT_LOCATION` / 机器人不动）。** 诊断发现：mock 正确广播 `ROBOT_LOCATION` 但 `subscriberCount` 恒为 0，且从未收到任何 `LOCATION_REGISTER` —— 即客户端（POC RN 集成）的原生 `wsSend` 上行不可靠，登记请求到不了服务端。作为开发模拟器，现在 WS 连接建立时**自动把该连接登记为当前机器人 SN 的位置订阅者**，只要任务 `ON_THE_WAY` 机器人就会动；客户端显式 `LOCATION_REGISTER`/`LOCATION_UNREGISTER` 仍正常生效。新增诊断日志：`LOCATION_REGISTER received`（含 `subscriberCount`/`snMatchesRobot`/`taskStatus`）、`ROBOT_LOCATION broadcast`（每秒一条，含 `subscriberCount`）。
- **「停止场景」现在会真正停止推流。** 此前 `/sim/scenario/stop` 仅中止脚本循环，而 WS 推流（`mapTimer` 的 `MAP_INCREMENTAL` / `locationTimer` 的 `ROBOT_LOCATION`）由机器人 FSM 状态驱动，停止后机器人仍处于 `WORKING`/`ON_THE_WAY`，数据继续广播。现停止运行中的场景时会一并 `robot.reset()`，`activeTask` 置空、`shouldStreamMap` 转 false，两个定时器立即停止。
- **新连接不再补发终态任务的 `NOTIFY_MOW_STATUS`。** 仅当活跃任务为 `ON_THE_WAY`/`PAUSE` 时才在 WS 连接建立时补发。终态任务（`COMPLETE`/`CANCEL`/`FAILED`）会让 App 割草页直接进入 `finished`，阻断「底图就绪 → REST 建任务 → `LOCATION_REGISTER`」的自动握手，导致重新进入割草页后收不到 `ROBOT_LOCATION`、机器人与轨迹都不刷新。

### Added

- **`map/list` 新增实景地图与地图元数据（字段命名严格对齐 `APP端接口文档v2.md` 的 `Rsp.data.items`）。** `items[]` 现返回 `semantic_map_url`（机器上报语义图，= `map_url`）、`real_view_map_url`（RGB 实景图，指向新增静态资源 `GET /sim/assets/full_rgbmap.png`，测试数据为根目录 `full_rgbmap.png`，512×512，与语义图同尺寸），以及共享世界元数据 `map_origin_x` / `map_origin_y` 与 `resolution`。语义图与实景图共享同一 `resolution` 与 `origin`（origin 为 BackendWorld(Y-down) 图片左上角世界坐标），mock 默认 `resolution=0.05`、`origin=(2.5, 2.2)`，参考 `地图管理系统设计方案.md`(`full_semanticmap.xml`) 与 `机器端接口文档.md` 增量帧 header。支撑 `pudu-rn-poc/docs/map_world_frame_realscene_robot_design.md` 需求 2（实景/语义切换）与需求 1（origin 偏移）。
- **新增 `mapping_happy_manual` 场景**（手动遥控建图 happy flow）：`emit CMD_START mode=remote` 自建任务，按 NOTIFY 顺序 `precondition → leave_dock → find_boundary → edge_mapping → map_edge_finish → bow_cover → exit_mapping → idle`。沿边状态（`edge_mapping`）交接手摇 `REMOTE_CONTROL`/`MAP_FOLLOW_BOUNDARY_MANUAL`，沿边闭合后回到自动 `WORKING` 并经「Loading + 确认进覆盖」（`emit CMD_START_COVERAGE`）进入内部覆盖至 `COMPLETED`。同步 `npm run sync-fsm-mirror`（FSM 镜像随 mower 手动建图重构更新；`cloudWorkStatus.ts` → `workStatus.ts`）。
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
