# 建图域 v4 新增 API 落地缺口分析（map_mock_service 侧）

> 对齐基线：[`APP端接口文档v4.md`](../../build-docs/pudu_ratel_app_mower/APP端接口文档v4.md)、[`APP端接口文档-额外补充.md`](../../build-docs/pudu_ratel_app_mower/APP端接口文档-额外补充.md)、[`mapping_api_gap_audit.md`](../../build-docs/pudu_ratel_app_mower/mapping_api_gap_audit.md)（已与后端核对）
> Mock 现状基线：v2/v3 接口 + [`建图任务API重构方案.md`](../../build-docs/pudu_ratel_app_mower/建图任务API重构方案.md)（旧版 phase 集合）
> 用途：在 map_mock_service 上落地 v4 建图域新增 API 前，盘点"还缺什么"（基础数据、需求、字段、场景）

---

## 1. 总览

Mock 当前已实现"建图任务三接口"（`create`/`action`/`list`）和 `RATEL_MAPPING_TASK` WS 推送，但**仍停留在 v2/v3 的协议与旧 phase 集合**。对照 v4 文档 + 已核对的 [`mapping_api_gap_audit.md`](../../build-docs/pudu_ratel_app_mower/mapping_api_gap_audit.md)，要落地 v4 建图域 API，缺项分四类：

| 类别 | 说明 | 数量 |
|---|---|---|
| A. 缺新增 API/字段（协议层） | v4 新增的 action、WS 字段、HTTP 字段 | 8 |
| B. 缺基础数据 / fixture | 支撑新字段所需的可编辑数据 | 5 |
| C. 缺 phase / 语义映射（FSM 层） | mock FSM 尚未建模的新 phase 与事件 | 4 |
| D. 缺场景（scenario） | 演示新交互的 YAML 场景 | 5 |

---

## 2. A. 缺新增 API / 字段（协议层）

### A1. 🔴 `CONFIRM_START_BOUNDARY` / `CONFIRM_CLOSE` action

**现状：** [`MappingTaskBridge.ts`](../src/sim/task/MappingTaskBridge.ts) 的 `VALID_ACTIONS = new Set(['PAUSE', 'RESUME', 'STOP'])`，没有开始沿边 / 闭合边界两个用户确认动作。

**需要：**
- 在 `applyMappingTaskAction` 扩展 `action` 白名单：`CONFIRM_START_BOUNDARY`、`CONFIRM_CLOSE`。
- [`mapping.routes.ts`](../src/http/routes/mapping.routes.ts) 中现有的 `/mapping/manual`（`edge_start` / `region_closure`）是 v2 遗留入口，应**作废或仅保留向后兼容别名**；v4 走 `ratel_mapping_task/action`。
- 两个 action 都不应让 mock 本地乐观切 phase，必须经过 FSM 事件（见 C 类），并最终以 `NOTIFY_RATEL_STATUS` / `RATEL_MAPPING_TASK` 推送反映。

**缺的需求：** 两个 action 的错误语义（任务不存在 / 当前 phase 不允许 / `legitimate_starting_point=0` / 设备忙 / 重复确认）需要明确——目前 audit 文档已给出建议清单，mock 侧至少要实现"当前 phase 不允许"和"`legitimate_starting_point=0`"两个最常见的拒绝路径。

---

### A2. 🔴 `RATEL_MAPPING_TASK` WS payload 缺 `sub_status` / `sub_status_entered_at`

**现状：** [`pushChannels.ts`](../src/sim/pushChannels.ts) 的 `buildMappingTaskStatus` 注释明确写"不携带相位信息，相位推进仍完全由 NOTIFY_RATEL_STATUS 驱动"。payload 只有 `task_id/task_status/map_id/task_message/task_error_code`。

**v4 需要：** audit §3.1 / §3.2 确认 `MAP_COMPLETING` 与其他 mapping `sub_status` 共用同一推送/查询载体；冷启动倒计时必须用 `sub_status_entered_at`。因此 `RATEL_MAPPING_TASK` 必须开始携带：
- `sub_status`（string，建图细粒度 phase）
- `sub_status_entered_at`（int64 ms epoch，进入当前 sub_status 的时刻）

**注意冲突：** 现有架构有意把相位放在 `NOTIFY_RATEL_STATUS`，任务级只放确认。v4 后端确认共用载体后，mock 需要重新决策：
- 方案 1：`RATEL_MAPPING_TASK` 也带上 `sub_status` / `sub_status_entered_at`（与后端一致，但和现有"任务级不携带相位"注释冲突，需要改注释）；
- 方案 2：保持 `RATEL_MAPPING_TASK` 不带相位，但必须保证 `ratel_mapping_task/list` 的 HTTP 查询能返回这两个字段（见 A3）。

**推荐方案 1**，因为 audit §3.3 明确要求"查询快照与 `NOTIFY_RATEL_STATUS` 必须采用同一枚举和同一语义"，统一在 `RATEL_MAPPING_TASK` 与 list 都返回最稳。

---

### A3. 🔴 `ratel_mapping_task/list` 缺 `sub_status` / `sub_status_entered_at`

**现状：** [`MappingTaskBridge.ts`](../src/sim/task/MappingTaskBridge.ts) 的 `buildMappingTaskListData` 只返回 `task_id/task_status/task_info/task_notify/create_time/update_time`。

**需要：** audit §3.3 要求 reconcile 必须能从 HTTP 拿到当前 phase + 进入时间。`list.data.list[i]` 需新增：
- `sub_status`（string）
- `sub_status_entered_at`（int64 ms epoch）

这两个字段的值必须和 `RATEL_MAPPING_TASK` WS 推送保持一致（同一数据源），否则冷启动 reconcile 会和实时推送撕裂。

---

### A4. 🟠 `NOTIFY_RATEL_STATUS` 缺 `extend_status` 结构

**现状：** [`ratelStatusPush.ts`](../src/sim/ratelStatusPush.ts) 的 `RatelStatusPushPayload` 把 `in_lawn` / `edge_start_available` / `region_closeable` **扁平地挂在顶层**，没有 v4 文档定义的 `extend_status` 对象。

**v4 文档要求：** `extend_status` 是嵌套对象，包含 `legitimate_starting_point` / `legitimate_end_point` / `manual_closure_suggested` / `locator_status` / `operation_status` / `switch_remote_control` / `area_complete_map_build` / `blade_status` 等字段。

audit §4.1 / §4.2 已确认：
- `legitimate_starting_point` ↔ `canStartFollowBoundary`
- `legitimate_end_point` ↔ `canCloseBoundary`

**需要：** mock 把扁平的 `edge_start_available` / `region_closeable` **重命名并迁入 `extend_status` 对象**，字段名严格对齐 v4 文档：
```jsonc
extend_status: {
  legitimate_starting_point: 0|1,   // 原 edge_start_available
  legitimate_end_point: 0|1,        // 原 region_closeable
  manual_closure_suggested: 0|1,
  // 其他字段按需补
}
```

**迁移注意：** 现有 FSM / scenario YAML 可能消费旧字段名 `edge_start_available`。需要全仓 grep 并一次性迁移，避免新旧字段并存。

---

### A5. 🟠 `robot/detail` 缺 `extend_status` 查询快照

**现状：** [`device.routes.ts`](../src/http/routes/device.routes.ts) 的 `buildDeviceDetail` 不返回 `extend_status`。

**需要：** audit §4.1 / §4.2 明确要求冷启动能从 `robot/detail` 读到与 WS 一致的 `extend_status`，否则断线重连后"开始/完成"按钮的 disabled 态不可信。

**需要：** `buildDeviceDetail` 增加与 `NOTIFY_RATEL_STATUS` 同构的 `extend_status` 字段，数据源与 WS 推送同一个 robot 状态对象。

---

### A6. 🟠 `/mapping/check` 缺 NRTK 字段

**现状：** [`mappingCheck.builder.ts`](../src/http/routes/mappingCheck.builder.ts) 的 `MappingCheckDataPayload` 只有 6 项：`bluetooth_status/cellular/wifi/battery/docking_station/light`，无 NRTK。

**需要：** audit §6.2 要求增加 NRTK 自检状态。`MappingCheckDataPayload` 新增 `nrtk_status`（string，`ok`/`warning`/`error`），并加入 `CONDITION_FIELDS` 轮询揭示序列。

**缺的基础数据：** [`fixtures/mapping/check_conditions.jsonc`](../fixtures/mapping/check_conditions.jsonc) 需要增加 `nrtk_status` 默认值。

---

### A7. 🟠 缺 `POST /map-service/api/v1/ratel_map/labels` 接口

**现状：** mock 完全没有实现这个接口（grep 无命中）。v4 文档 [`APP端接口文档v4.md`](../../build-docs/pudu_ratel_app_mower/APP端接口文档v4.md:1679) 定义了它返回 `data.labels`，含 `edge_start`（沿边起点 `points[0]`）和 `aisle`（通道，`points[0]` 为寻边起点）。

audit §5 已确认这是寻边/沿边起点的**唯一**坐标来源，不是缺口——但前提是 mock 要实现它。

**需要：**
- 新增路由 `POST /map-service/api/v1/ratel_map/labels`，入参 `map_id`，返回 `data.map_id` + `data.labels[]`。
- 每个 label：`id` / `type`(`edge_start`|`aisle`) / `shape`(`point`|`rect`) / `points`(`[{x,y}]`) / `start_areaid` / `end_areaid`。
- 数据源：fixture 或随 phase 动态生成（见 B 类）。

---

### A8. 🟠 缺 `lawn_count` 推送/查询字段

**现状：** grep 无 `lawn_count`。`MAP_INCREMENTAL.map_header` 只有 `lawn_area`（面积）。

**需要：** audit §6.1 要求草坪数。建议位置：
- `RATEL_MAPPING_TASK` payload 增加 `lawn_count`（int）；
- `ratel_mapping_task/list` 同步返回 `lawn_count`；
- `MAP_INCREMENTAL.map_header` 可选增加 `lawn_count`，但权威源应是任务级推送。

---

## 3. B. 缺基础数据 / fixture

### B1. `ratel_map/labels` 的 fixture 数据

A7 的新接口需要数据。需要为每个建图场景准备 labels fixture：
- `edge_start` label：单点，对应当前草坪沿边起点；
- `aisle` label：多点折线，`points[0]` 为寻边起点（= 通道起点）。

**缺的需求：** labels 是**随 phase 变化**的（第 2 块草坪开始时有新的 aisle 通道）。需要明确：
- labels 是按 map_id 全量返回，还是按当前 phase 动态生成？
- 多块草坪时 `edge_start` 有多个吗？audit §5 已标注"同一 type 多个 label 时选取规则待后端确认"，mock 侧先按"第一个有效 label"消费。

**建议：** 在 `fixtures/mapping/labels/` 下按场景建子目录，如 `mapping_happy.jsonc`、`mapping_manual.jsonc`，每个含对应场景的 labels 数组。

---

### B2. `check_conditions.jsonc` 增加 `nrtk_status`

A6 对应的 fixture 修改。当前文件只有 6 项，需加第 7 项 `nrtk_status: "ok"`。

---

### B3. `MAP_COMPLETING` 的时序数据

audit §3.2 要求 `sub_status_entered_at` 支撑 120s 倒计时。mock 侧需要：
- 进入 `MAP_COMPLETING` 时记录 `entered_at = Date.now()`；
- 120s 后自动推进到终态（`COMPLETED` 或失败）；
- reconcile 查询时返回剩余时间 = 120 - (now - entered_at)。

**缺的需求：** 120s 这个常量从哪来？audit 引用 [`mapping_flow_refactor_design.md`](../../build-docs/pudu_ratel_app_mower/mapping_flow_refactor_design.md) §2.3，但 mock 侧需要一个可配置的 `MAP_COMPLETING_DURATION_MS`（建议放 `SimulatorDefaults.ts`）。

---

### B4. 退桩失败 `MAP_UNDOCKING_FAILED` 的触发数据

audit §6.3 要求定义退桩失败的稳定触发语义。mock 侧需要：
- 一个 fault fixture（类似 [`faults/mapping_estop.json`](../faults/mapping_estop.json)）定义退桩失败；
- 明确退桩失败时 `sub_status` 取值（待后端确认，mock 先用 `MAP_UNDOCKING_FAILED` 占位）。

---

### B5. 多草坪场景的 map 数据

现有 `fixtures/datasets/mapping_happy/` 是单草坪帧序列。v4 第 2 块草坪+流程（figma `4.建图流程（第2块草坪+）`）需要：
- 通道（aisle）帧；
- 第 2 块草坪的沿边帧；
- `lawn_count` 从 1 变 2 的推送。

**缺的基础数据：** 多草坪的 map 增量帧序列目前不存在，需要录制或手工构造。

#### B5 设计草案：通过 API 触发第 2 块草坪建图

**目标场景（对齐 D5）：** 第 1 块草坪闭合、进入 `MAP_COMPLETING` 倒计时 → 用户通过 API 触发"添加草坪" → 通道录制 → 第 2 块草坪沿边 → `lawn_count` 从 1 变 2。这是一个**运行时由 action 触发**的流程，不是"场景启动时预置一份跨两块草坪的连续帧数据集"。

**1. 触发入口（协议层，需补 A1 同款缺口）**

新增 action（暂命名 `CONFIRM_ADD_LAWN`，需在 v4 文档缺口清单里补齐），走 `ratel_mapping_task/action`：
- 前置条件：任务处于 `MAP_COMPLETING`（倒计时中）。需要在 C1 的 `MAP_COMPLETING` 退出条件里加一个分支——原来只有"120s 到 → `COMPLETED`"，现在加"倒计时内收到 `CONFIRM_ADD_LAWN` → 进入通道录制 phase"。
- 拒绝路径参考 A1 已有套路：任务不存在 / 当前 phase 不允许 / 重复确认。

**2. FSM 新 phase（承接 C1/C3）**

```
MAP_BOUNDARY_DONE(lawn1) → MAP_COMPLETING
                              │
                    CONFIRM_ADD_LAWN 到达
                              ↓
                       MAP_AISLE_RECORDING       ← 通道录制
                              ↓ (寻边成功，legitimate_starting_point=1)
                       MAP_EDGE_FOLLOWING(lawn2) ← 复用现有沿边 phase，语义上是"第 N 块"
                              ↓
                       MAP_BOUNDARY_DONE(lawn2)
                              ↓
                       MAP_COMPLETING（二次进入）
```

**待后端确认的阻塞点：** `BackendPhaseMapper`（C4）需要能区分"第几块草坪"的沿边/闭合，不能和 lawn1 共用同一个 `sub_status` 值又分不清是第几圈——这个不能自行臆造，需要和 A1/C1 一起找后端拿口径。

**3. 帧流切换（工程实现点，当前完全缺失）**

现状：`MapStream.switchDataset()`（[`src/sim/mapStream.ts`](../src/sim/mapStream.ts)）只在场景启动时被 `scenarioEngine.ts:259` 调用一次；`MappingTaskBridge.applyMappingTaskAction`（[`MappingTaskBridge.ts`](../src/sim/task/MappingTaskBridge.ts)）目前拿不到 `mapStream` 引用（它只接收 `VirtualRobot`）。

设计：
- 给 `applyMappingTaskAction` 增加一个可选的 `switchDataset` 回调依赖，接线方式与 `server.ts` 里现有的 `applyFault` closure 一致，由路由层从 `ctx.mapStream`（`AppRouteContext`，[`router.ts`](../src/http/router.ts:20)）传入。
- 收到 `CONFIRM_ADD_LAWN` 且 FSM 允许时，调用 `switchDataset('mapping_lawn2_aisle', loadAllPatches('mapping_lawn2_aisle'))`，`MapStream` 内部按现有"整体替换 patch 数组 + 重置 index"语义即可，**不需要**新增"追加/拼接两段帧序列"的能力——lawn1 的帧在进入 `MAP_COMPLETING` 时已经播完，直接切下一段数据集即可。

**4. `lawn_count`（A8）与帧数据解耦**

`lawn_count` 不挂在某一帧上，而是挂在 phase 转换上：进入 `MAP_AISLE_RECORDING` / `MAP_EDGE_FOLLOWING(lawn2)` 时，与 `sub_status` / `sub_status_entered_at` 在同一次状态更新里，把 `RATEL_MAPPING_TASK` 和 `ratel_mapping_task/list` 的 `lawn_count` 从 1 改为 2，保证数据源一致、不撕裂。

**5. 数据构造（B5 本体的落地方式）**

- 新建 `fixtures/datasets/mapping_lawn2_aisle/`：
  - 通道（aisle）帧：数量不多，`origin_x/origin_y` 沿一条直线从 lawn1 出口坐标插值到 lawn2 入口坐标；图像内容不必真实，可用占位图——`PatchLoader.ts` 只依赖 XML 里的几何字段做位姿推算，通道帧的视觉真实感不是刚需。
  - lawn2 帧：直接复用 `mapping_happy` 已有的 749 帧 PNG，仅将 `origin_x/origin_y` 整体平移一个偏移量放到网格另一处，`timestamp_ms`/文件名续接在通道帧之后。
  - `manifest.json` 格式照抄 `mapping_happy` 的现有结构（`name/scenario/frameCount/resolution/world/notes/compatibleScenarios`）。
- 把 `mapping_lawn2_aisle` 加入 `PatchLoader.ts:7` 的 `ALLOWED_DATASETS`。
- D5 场景 YAML **不需要**在 `dataset:` 字段预置这份数据集给 `scenarioEngine` 一次性加载，而是断言"收到 `CONFIRM_ADD_LAWN` 后 `lawn_count`/`sub_status` 按预期变化"，底层的数据集切换由 `MappingTaskBridge` 在处理 action 时动态触发。

**相比最初设想的变化：** 不需要造一份跨两块草坪的超长连续帧数据集；只需要两份独立数据集（`mapping_happy` 复用 + 新增 `mapping_lawn2_aisle`）+ 一个"action 触发时的运行时切换"能力。工程量集中在给 `MappingTaskBridge` 接入 `mapStream` 引用和新增 `CONFIRM_ADD_LAWN` action，而非帧拼接逻辑。

---

## 4. C. 缺 phase / 语义映射（FSM 层）

### C1. 🟠 `MAP_COMPLETING` 协议、恢复与时序尚未建模

**已处理：** [`MappingSession.ts`](../src/sim/fsm-mirror/domain/mapping/MappingSession.ts) 已同步 mower 当前 phase 集合，包含 `MAP_COMPLETING`，不再包含旧版 `MAP_COMPLETE` / `MAP_COVERAGE_*`。

**当前行为：** mower registry 在后端 `work_status: mapping → idle` 边沿派发
`DEVICE_PHASE(MAP_COMPLETING)`，随后立刻派发 `CMD_CONFIRM`，因此 mock 最终进入
`COMPLETED`。`MAP_BOUNDARY_DONE` 本身不会直接进入完成态，也没有 120s 倒计时或
`sub_status_entered_at` 的恢复数据。

**仍需补齐：**
- 与后端确认 `MAP_COMPLETING` 的真实 `sub_status`、是否需要持续推送及终态迁移；
- 若产品仍要求倒计时，定义其触发条件、时长、取消行为和 HTTP/WS 恢复字段；
- 仅在协议确认后实现 `sub_status_entered_at` 与冷启动 reconcile，而不在镜像中自造 phase 转移。

**已处理：** [`ratelStatusPush.ts`](../src/sim/ratelStatusPush.ts) 的 `applyMappingToIdleCompletion` 在 `mapping→idle` 时 dispatch `MAP_COMPLETING` + `CMD_CONFIRM`。

---

### C2. 🟠 `MAP_UNDOCKING_FAILED` phase 未建模

audit §6.3 / [`mapping_flow_refactor_design.md`](../../build-docs/pudu_ratel_app_mower/mapping_flow_refactor_design.md) §2.5 预留类型。mock 侧需要：
- 新增 phase 类型；
- 触发：退桩阶段 fault（B4）；
- 终态：可重试或终止任务。

---

### C3. 🟠 `CONFIRM_START_BOUNDARY` / `CONFIRM_CLOSE` 的 FSM 事件

A1 的两个 action 需要 FSM 事件承接：
- `CMD_CONFIRM_START_BOUNDARY`：在寻边成功（`legitimate_starting_point=1`）时受理，锁定沿边起点，进入沿边；
- `CMD_CONFIRM_CLOSE`：在 `legitimate_end_point=1` 时受理，触发闭合计算，进入 `MAP_BOUNDARY_DONE`。

**现状：** [`mapping.routes.ts`](../src/http/routes/mapping.routes.ts) 的 `/mapping/manual` 调的是 `robot.confirmEdgeStart()` / `robot.confirmRegionClosure()`——这是 v2 的旧方法。需要迁移到 `ratel_mapping_task/action` 路径并改用新事件名。

---

### C4. 🟠 `BackendPhaseMapper` 缺 v4 sub_status 映射

**现状：** [`fsm-mirror/features/shared/mapping/BackendPhaseMapper.ts`](../src/sim/fsm-mirror/features/shared/mapping/BackendPhaseMapper.ts) 是从 mower app 同步来的镜像，其映射表可能还是旧版。

**需要：** audit §3.1 待后端确认 `MAP_COMPLETING` 的实际 `sub_status` 值。当前 mock
在状态投影中将该 phase 表示为 `exit_mapping`，但镜像 `BackendPhaseMapper` 尚不能从真实
后端 `sub_status` 反向映射该 phase。协议定稿后需要在 mower 侧新增：
- `MAP_COMPLETING` 的 sub_status → 内部 phase 映射；
- `MAP_UNDOCKING_FAILED` 的映射；
- 明确 active mapping phase 期间 `task_status` 保持 `ON_THE_WAY`（audit §6.5）。

---

## 5. D. 缺场景（scenario）

### D1. 遥控建图"开始"按钮场景

演示 `CONFIRM_START_BOUNDARY` 全流程：寻边 → `legitimate_starting_point=1` → 用户点"开始" → `CONFIRM_START_BOUNDARY` → 沿边。

现有 `mapping_happy_manual.yaml` 走的是旧 `/mapping/manual` 路径，需要新增 v4 版本或改造。

---

### D2. 遥控建图"完成/闭合"按钮场景

演示 `CONFIRM_CLOSE` 全流程：沿边 → `legitimate_end_point=1` → 用户点"完成" → `CONFIRM_CLOSE` → `MAP_BOUNDARY_DONE` → `MAP_COMPLETING` → `COMPLETED`。

---

### D3. `MAP_COMPLETING` 冷启动 reconcile 场景

演示：进入 `MAP_COMPLETING` → 杀 App → 重开 → `ratel_mapping_task/list` 返回 `sub_status=MAP_COMPLETING` + `sub_status_entered_at` → 倒计时恢复。

这是 audit §3.2 / §3.3 的核心验证场景，**目前完全缺失**。

---

### D4. 退桩失败场景

演示 `MAP_UNDOCKING_FAILED`：建图开始 → 退桩失败 → `sub_status=MAP_UNDOCKING_FAILED` → 失败 UI → 重试。

---

### D5. 第 2 块草坪场景

演示多草坪：第 1 块完成 → "添加草坪" → 通道录制 → `legitimate_starting_point=1` → 开始第 2 块沿边 → `lawn_count` 从 1 变 2。

---

## 6. 落地优先级与依赖顺序

```
A4 extend_status 重构  ──┐
A6 NRTK 字段           ──┤
A7 ratel_map/labels 接口──┼─→ B1 labels fixture
                        │
C1 MAP_COMPLETING phase ─┼─→ B3 时序数据
C3 FSM 事件             ─┤
                        │
A1 CONFIRM_* action     ─┴─→ D1/D2 按钮场景
                        │
A2/A3 sub_status 字段   ──┼─→ D3 reconcile 场景
                        │
A5 robot/detail 快照    ──┘
                        │
A8 lawn_count           ──┬─→ D5 多草坪场景
C4 BackendPhaseMapper   ──┤
                        │
C2 UNDOCKING_FAILED     ──┴─→ B4 fault fixture → D4 退桩失败场景
```

**推荐落地批次：**

| 批次 | 内容 | 产出 |
|---|---|---|
| 第 1 批 | A4 + A6 + A7 + B1 + B2 | 协议字段对齐 v4，labels 接口可用 |
| 第 2 批 | C1 + C3 + C4 + A1 + A2 + A3 | 新 phase 与用户命令闭环，sub_status 可推送可查询 |
| 第 3 批 | A5 + A8 + B3 + D1 + D2 + D3 | 冷启动 reconcile 可验证，按钮场景可演示 |
| 第 4 批 | C2 + B4 + B5 + D4 + D5 | 退桩失败与多草坪完整覆盖 |

---

## 7. 阻塞性风险

1. **`MAP_COMPLETING` 的实际 `sub_status` 值待后端确认**（audit §3.1）。mock 侧可先用占位字符串 `MAP_COMPLETING` 实现，但 `BackendPhaseMapper` 的最终映射规则必须等后端定稿。建议 mock 侧把映射表做成可热改 fixture，避免后端改值时改代码。

2. **`extend_status` 重构是破坏性变更**。现有 scenario YAML / FSM 消费 `edge_start_available` / `region_closeable` 旧字段名，迁移时需要全仓一次性改完，否则新旧字段并存导致行为不一致。

3. **`/mapping/manual` 旧接口的去留**。v4 已用 `ratel_mapping_task/action` 替代，但 mock 现有 scenario 仍走旧接口。建议保留旧接口为 deprecated 别名（内部转调新 action），scenario 逐步迁移，避免一次性断裂。

4. **labels 的实时性**。audit §5 确认 labels 是查询接口（非 WS 推送），但寻边/沿边起点会随 phase 变化。mock 需要明确 labels 是按当前 phase 动态生成还是全量返回——建议按 phase 动态生成，否则 App 拿到的是陈旧起点。
