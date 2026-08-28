# 建图域 v4 改造 — 最终权威规格

> **本文档地位**：本文档是 map_mock_service 建图域 v4 改造的**唯一权威依据**，并已整合此前
> 三份分析文档——`v4-mapping-api-gap.md`、`mapping-domain-newapi-impl-analysis.md`、
> `mapping-mock-fsm-adaptation-plan.md`——的有效内容。**原三份文档已删除**，其历史分析、
> 判断原则与验收标准细节收录于本文档附录（§13-§15）。如本文档与已删除文档的历史结论冲突，
> 以本文档为准。
>
> 上游需求基线：[`mapping_api_gap_audit.md`](../../build-docs/pudu_ratel_app_mower/mapping_api_gap_audit.md)、
> [`mapping_flow_refactor_design.md`](../../build-docs/pudu_ratel_app_mower/mapping_flow_refactor_design.md)
>
> 决议日期：2026-07-13　决议人：项目负责人（本仓库用户）

---

## 0. 决议清单（速查表）

| # | 决策点 | 最终结论 | 状态 |
|---|---|---|---|
| 1 | 用户指令 action 名称集合 | 新增 `EDGE_START` / `EDGE_CLOSE` / `COMPLETE` / `EXPAND_AREA`（在既有 `PAUSE`/`RESUME`/`STOP` 基础上） | ✅ 已定 |
| 2 | `/ratel/api/v1/mapping/manual` 处理方式 | **直接删除**，不做兼容别名过渡 | ✅ 已定 |
| 3 | FSM 相关改动的流程（硬约束） | 一律先在 `pudu_ratel_app_mower` 落地，再 `npm run sync-fsm-mirror` 同步回本仓库；map_mock_service 不维护脱离镜像的平行 FSM 逻辑 | ✅ 已定（见 §0.1） |
| 4 | `MAP_COMPLETING` 的 `sub_status` 值 | **2026-08-15 更正**：真实值为 `expand_area`（"等待用户决定是否再加一块草坪"），不是 2026-07-13 记录的 `map_completing`。Mower 侧 `BackendPhaseMapper.ts` 已把 `map_completing` 降为 `SKIP`、`expand_area → MAP_COMPLETING` 作为唯一入口；本仓库的推送、action 门禁、场景 YAML 均已跟随改为 `expand_area` | ✅ 已定（值已更正）|
| 5 | `extend_status` 承载 cmd | 与 `NOTIFY_RATEL_STATUS` 保持一致，不新增 cmd；`sub_status`/`sub_status_entered_at` 同样挂在 `NOTIFY_RATEL_STATUS.data` 下；`RATEL_MAPPING_TASK` 不携带相位 | ✅ 已定 |
| 6 | `sub_status`/`sub_status_entered_at` 查询快照端点 | `robot/detail`（唯一权威端点）；`/ratel/api/v1/mapping/status` 整体删除 | ✅ 已定 |
| 7 | `lawn_count` 来源 | 无独立协议字段；由消费方统计 `ratel_map/labels` 中 `type==='edge_start'` 的 label 个数得出 | ✅ 已定 |
| 8 | `labels` 生成方式 | 随当前 phase 动态生成，非静态全量 fixture | ✅ 已定 |
| 9 | 第 N 块草坪的 `sub_status` 编码 | 与遥控/手动建图完全复用同一套值，不新增 `lawn_index` 等区分字段 | ✅ 已定 |
| 10 | 第 2 块草坪数据集切换触发点 | `EXPAND_AREA` action 处理时触发 `mapStream.switchDataset` | ✅ 已定 |
| 11 | 退桩失败终态语义 + `sub_status` 值 | 直接终止任务，不提供重试路径；真实值未知，暂用假定占位值 `undocking_failed` 解除阻塞（2026-07-13 决策，非固件文档确认值，待后端定稿后回改），已在 `pudu_ratel_app_mower` 落地并同步 | ✅ 已定（占位值，见 §8） |
| 12 | `in_lawn` 字段 | **废弃，彻底删除**。不再需要"机器是否在草坪内"这个信号，起点/闭合点判定完全交给 `extend_status.legitimate_starting_point`/`legitimate_end_point` | ✅ 已定 |
| 13 | `labels` 同 `type` 多个时的选取规则 | **全部消费**：marker 按 `labels` 全部点位渲染（假设每个点位数据都正确，均位于草坪边界上），不做"取第一个"筛选；`lawn_count` 计数同样统计全部 | ✅ 已定 |
| 14 | 新 action 错误语义的 HTTP status | `404`（任务不存在/非 active）/ `409`（phase 不允许、重复请求、设备忙）/ `422`（`legitimate_starting_point`/`legitimate_end_point` 为 0 时的信号类拒绝） | ✅ 已定 |
| 15 | `countdown_seconds` 字段 | **不实现**。倒计时统一走 `sub_status_entered_at` + 前端自算模型 | ✅ 已定 |
| 16 | NRTK 自检 | **本次不做**，移出本轮改造范围 | ⏸️ 暂缓 |

---

## 0.1 硬约束：FSM 改动流程（继承自 `docs/fsm-mirror.md`）

`src/sim/fsm-mirror/` 是从 `pudu_ratel_app_mower` 仓库同步的只读镜像（各文件头部均标注
`AUTO-GENERATED ... DO NOT EDIT`）。任何涉及 FSM phase、事件、或 `sub_status → phase` 映射表
（`BackendPhaseMapper.ts`）的新增/变更，一律遵循：

1. 先在 `pudu_ratel_app_mower` 仓库落地该改动（新增 phase、事件，或在 `BackendPhaseMapper.ts`
   的映射表新增一行）；
2. 在本仓库运行 `npm run sync-fsm-mirror` 同步镜像；
3. map_mock_service 只在镜像**之外**（`src/sim/` 下的桥接层、HTTP 路由、协议投影）做适配，
   不手工编辑镜像文件，也不在镜像外分叉一套镜像不认识的并行 FSM 判定逻辑。

**直接后果**：凡是需要一个新的 `sub_status` 字符串值才能对外暴露的功能，在 mower 仓库补齐
映射并同步之前，map_mock_service **不自行发明占位字符串**对外下发。发明的占位值即使能让
mock 自身链路跑通，也会在真实 App 的 `BackendPhaseMapper`（同一份镜像）中落入 `unknown`
分支，造成"mock 上验证通过、真机上失效"的假象——这正是只读镜像机制本身要防止的问题。
本次改造中的两个实例：`MAP_COMPLETING`（§3）的真实值为 `expand_area`（2026-08-15 更正，
旧记录 `map_completing` 已作废）；
`MAP_UNDOCKING_FAILED`（§8）真实值未知，经项目负责人决策先用假定占位值 `undocking_failed`
落地（这是在 mower 仓库里做出的、明确标注"待后端定稿回改"的决策，而非 mock 自行绕过约束）。

凡是**不需要新增 `sub_status` 值**的功能（HTTP action 名称、`extend_status` 结构、
`labels` 接口等纯 mock 协议层设计）不受此约束，可以直接实施。

---

## 1. Action 协议：`POST ratel_mapping_task/action`

`MappingTaskBridge.ts` 的 `VALID_ACTIONS` 从 `{PAUSE, RESUME, STOP}` 扩展为：

```ts
const VALID_ACTIONS = new Set(['PAUSE', 'RESUME', 'CANCEL', 'EDGE_START', 'EDGE_CLOSE', 'EXPAND_AREA_FINISH', 'EXPAND_AREA', 'RETRANSMIT_MAP']);
// 2026-08-21 更正：结束建图的权威名是 EXPAND_AREA_FINISH（本文档早期写的 COMPLETE 是猜测名，
// 与 App 端接口文档和 mower 实现都不一致，已按接口文档改正）。
```

| Action | 语义 | 前置条件 | 设备权威 ack（sub_status） | 失败语义 |
|---|---|---|---|---|
| `EDGE_START` | 用户点击"开始"，请求设备确认起点并开始沿边 | `phase === MAP_SCAN_BOUNDARY_MANUAL`；任务 active；`extend_status.legitimate_starting_point === 1` | `work_status=mapping, sub_status=edge_mapping`（已在镜像中映射，无需等待同步） | `422`：`legitimate_starting_point=0`；`409`：phase 不允许/重复请求/设备忙；`404`：任务不存在 |
| `EDGE_CLOSE` | 用户点击"完成"（沿边页），请求设备闭合当前边界 | 任务 active；`extend_status.legitimate_end_point === 1` | `sub_status=map_edge_finish`（已映射至 `MAP_BOUNDARY_DONE`，无需等待同步） | `422`：`legitimate_end_point=0`；`409`/`404` 同上 |
| `COMPLETE` | 建图完成页三按钮之一——"完成"：直接结束整张建图任务，中断 120s 倒计时 | 当前 `sub_status === 'expand_area'`（即 `MAP_COMPLETING`，已可达，见 §3） | 内部触发 `CMD_CONFIRM` → `task_status=COMPLETE` | `409`：当前不在 `MAP_COMPLETING`（非法调用时机）/ 重复请求；`404`：任务不存在 |
| `EXPAND_AREA` | 建图完成页三按钮之一——"添加草坪"：中断倒计时，开始下一块草坪的通道录制 | 当前 `sub_status === 'expand_area'`（即 `MAP_COMPLETING`，已可达，见 §3） | 中断倒计时 → 触发数据集切换 → `sub_status=find_boundary`（见 §7） | `409`：当前不在 `MAP_COMPLETING`/ 重复请求；`404`：任务不存在 |

**响应语义**：四个 action 的 HTTP 响应仅表示"设备受理请求"，不得让 mock 本地乐观切换 phase
（`COMPLETE`/`EXPAND_AREA` 除外——这两个动作的语义本身就是"发生在倒计时内的用户主动终结/
续接"，其效果是**立即**生效而非等待额外一轮设备状态推送）。`EDGE_START`/`EDGE_CLOSE` 严格
保持"受理不等于生效"，最终以 `sub_status` 推送为准。

**`COMPLETE`/`EXPAND_AREA` 的前置状态已可达**：`MAP_COMPLETING` 的真实 `sub_status`
（`expand_area`）已在 `pudu_ratel_app_mower` 落地并同步（见 §3），因此这两个 action 的
"设备已在 `MAP_COMPLETING` 等待"前置状态在协议层已经可达，可以正常实现与验证。

**Legacy 清理**：`POST /ratel/api/v1/mapping/manual` **直接删除**，不做兼容别名、不保留过渡期。
所有调用方（含现有 scenario YAML）直接切换到 `ratel_mapping_task/action` 的 `EDGE_START`/
`EDGE_CLOSE`。

---

## 2. WS 推送：`NOTIFY_RATEL_STATUS`

`extend_status` 挂在 `NOTIFY_RATEL_STATUS.data.extend_status` 下，与 `sub_status`/
`sub_status_entered_at` 同一份 `NOTIFY_RATEL_STATUS.data` 内，不新增 cmd：

```jsonc
{
  "cmd": "NOTIFY_RATEL_STATUS",
  "data": {
    // ...既有字段...
    "sub_status": "find_boundary",          // 建图细粒度 phase
    "sub_status_entered_at": 1752400000000, // ms epoch，进入当前 sub_status 的时刻
    "extend_status": {
      "legitimate_starting_point": 0,
      "legitimate_end_point": 0,
      "manual_closure_suggested": 0,
      "locator_status": 1,
      "operation_status": 0,
      "switch_remote_control": 0,
      "area_complete_map_build": 0,
      "blade_status": 0
    }
  }
}
```

**删除**：根级 `edge_start_available`、`region_closeable`、`in_lawn`（`ratelStatusPush.ts:9-11,
146-148` 与 `pushChannels.ts:160` 对应字段，含 `robot.inLawn` 在 `mapping.routes.ts:22` 的
回显）。`in_lawn` 不做任何迁移，直接整体删除，不进入 `extend_status`。全仓一次性清理，不保留
新旧字段并存。

**`RATEL_MAPPING_TASK` 不变**：继续保持"任务级不携带相位"的既有架构注释，只返回
`task_id/task_status/map_id/task_message/task_error_code`，不新增 `sub_status`/
`sub_status_entered_at`/`lawn_count`。

---

## 3. `MAP_COMPLETING` 生命周期（✅ 真实值 = `expand_area`，2026-08-15 更正）

`pudu_ratel_app_mower` 的 `BackendPhaseMapper.ts`（`src/features/shared/mapping/
BackendPhaseMapper.ts`）的 `MAPPING_SUB` 表：

```ts
expand_area: toPhase('MAP_COMPLETING'),   // 唯一入口
map_completing: SKIP,                     // 固件不下发；显式 no-op，不是 unknown
```

**依据**：固件的真实值是 `expand_area`（语义为"等待用户决定是否再加一块草坪"）。
2026-07-13 本节记录的 `map_completing` 是错的，已于 2026-08-15 更正。它取代旧的 `bow_cover`/
`exit_mapping` 二段式（弓字覆盖中 / 退出建图）——**后端不再下发这两个旧值**，固件跳过可见的
覆盖阶段，直接一次性推送 `expand_area`。`bow_cover`/`exit_mapping` 不做兼容映射，按未列出
取值处理；若真机意外仍推送（理论上不会发生），安全降级为 `unknown` no-op，不会崩溃。

**为什么 `map_completing` 必须是 `SKIP` 而不是删掉、更不能改回 `toPhase`**：改回 `toPhase`
会开出一个**拿不到 `wait_extend_timestamp` 锚点**的第二入口——App 进完成页即按"倒计时已归零"
自动下发完成请求；整行删掉则落到 `unknown`，刷 warn 日志。

> 修正记录：本节此前（同日早些时候）曾错误地复用旧字符串 `exit_mapping` 作为
> `MAP_COMPLETING` 的触发值，推理依据是"COVERAGE 重构前 `exit_mapping` 语义未变"。项目负责人
> 随后明确后端已弃用该值、只会下发 `map_completing`，因此已在 mower 仓库改回正确映射并重新
> `sync-fsm-mirror`。

该改动已完成：`pudu_ratel_app_mower` 侧对应单测（`BackendPhaseMapper.spec.ts`、
`EventAdapter.spec.ts`）已更新并全部通过，`npm run sync-fsm-mirror` 已同步回本仓库
（`.manifest.json` 记录的 Source SHA-256 已更新）。

**mock 侧待实现**：
- `MappingProtocolSnapshot`：记录当前 `sub_status`/`sub_status_entered_at`，在
  `sub_status` 变为 `expand_area` 时刻记录 `entered_at = 当前时间`，同一时刻写入
  `extend_status.wait_extend_timestamp`（ms epoch）——这是 App 完成等待页倒计时的**唯一**锚点，
  必须与 mock 自己的 120s 自动完成定时器同源，窗口外恒为 `0`。
- 120s 倒计时：常量 `MAP_COMPLETING_DURATION_MS = 120_000`（建议放 `SimulatorDefaults.ts`），
  到期后自动等效于用户点击 `COMPLETE`。
- 中断路径：倒计时期间收到 `COMPLETE` 或 `EXPAND_AREA` 均立即清除倒计时定时器。

**不实现 `countdown_seconds`**：只提供 `sub_status_entered_at`，由消费方自行计算剩余时间
`120000 - (now - entered_at)`。

---

## 4. 查询快照：`robot/detail`

`DeviceProfile.buildDeviceInfo` 新增字段，与 WS 推送同一份数据源（`MappingProtocolSnapshot`）：

```jsonc
{
  // ...既有字段...
  "sub_status": "find_boundary",
  "sub_status_entered_at": 1752400000000,
  "extend_status": { /* 与 NOTIFY_RATEL_STATUS.data.extend_status 完全同构 */ }
}
```

`lawn_area` 沿用既有回显逻辑（`MAP_INCREMENTAL.map_header.lawn_area` 同源），**不新增
`lawn_count` 字段**——见 §5。

`ratel_mapping_task/list` **不作为** `sub_status` 权威查询载体，不新增相关字段。

`POST /ratel/api/v1/mapping/status`（`mapping.routes.ts:11-12`）是早于审计定稿的自造接口，
**整体删除**，不再作为过渡期兼容层保留。相应地删除 `docs/api.md` 中的对应条目、
`docs/scenarios.md` 中引用该端点的场景描述。该端点原有的响应字段（`mode`/`trajectory_url`/
`passage_checkpoints` 等）若仍有其他用途（如 §6 `labels` 生成的坐标来源），保留其底层数据/
逻辑，仅删除这个 HTTP 出口本身。

---

## 5. `lawn_count` — 无协议字段，间接计算

不新增任何 `lawn_count` 字段（WS、`robot/detail`、`list` 均不返回）。消费方按以下规则自行
推导草坪数：

```
lawn_count = ratel_map/labels 返回的 data.labels 中 type === 'edge_start' 的元素个数
```

**含义**：每完成一块草坪的沿边闭合（`EDGE_CLOSE` 被设备 ack，`sub_status` 进入
`map_edge_finish`），mock 就为该块草坪固化生成一个 `edge_start` label 并**永久保留**在
`labels` 数组中（不因后续进入下一块草坪而移除）。第 N 次完成沿边时，`labels` 中的
`edge_start` 累计到 N 个。

**注意**：mower FSM 镜像内部仍保留 `MappingSession.ts` 的 `lawnCount` context 字段与
`DEVICE_LAWN_COUNT` 事件——这是镜像的内部机制，**只读、不受本决议影响**，不作为对外协议的
数据源。对外（HTTP/WS）协议层面的"草坪数"一律通过统计 `labels` 得出，两者是不同层次，不要
混用。

**≥15 禁用"添加草坪"**：`EXPAND_AREA` 的 `409` 校验条件之一为"当前 `edge_start` label
计数 ≥ 15"，与"添加草坪"按钮禁用逻辑保持同源。

---

## 6. `ratel_map/labels` 接口（动态生成）

新增路由：`POST /map-service/api/v1/ratel_map/labels`

```jsonc
// Request
{ "map_id": "xxx" }

// Response
{
  "data": {
    "map_id": "xxx",
    "labels": [
      { "id": "edge_start_1", "type": "edge_start", "shape": "point", "points": [{"x":1,"y":2}] },
      { "id": "aisle_2",      "type": "aisle",      "shape": "point", "points": [{"x":3,"y":4}, ...] }
    ]
  }
}
```

**动态生成规则**（按当前 `MappingProtocolSnapshot` 计算，不做静态全量 fixture）：

1. 每完成一块草坪的沿边闭合，追加一个固化的 `edge_start` label，永久保留（供 §5 计数使用）。
2. 当前若处于寻边阶段（`sub_status='find_boundary'`），追加一个代表当前通道的 `aisle`
   label；寻边完成进入 `edge_mapping` 后，该 `aisle` label 依然保留在历史记录中（用于回看
   轨迹），但不影响 `edge_start` 计数。
3. 同一 `type` 出现多个 label 时，marker 消费（前端渲染起点标记）**取全部值**，逐个渲染，
   不做"取第一个"筛选——假设每个 label 的 `points` 数据都是正确的，所有点位都应位于草坪
   边界上，理应全部展示；`lawn_count` 计数同样统计全部 `edge_start` label。

**实现方式**：不使用 `fixtures/mapping/labels/*.jsonc` 这种静态全量 fixture。由
`VirtualRobot`/`MappingSession` 侧维护一个随 FSM 转移增量 push 的 labels 数组；场景 fixture
只提供"坐标生成参数"（如每块草坪闭合点、通道折线基准点），路由层根据当前 snapshot 动态
拼装返回。

---

## 7. 第 N 块草坪：`EXPAND_AREA` 触发流程

`EXPAND_AREA` 的前置条件"当前处于 `MAP_COMPLETING`"已可达（见 §3），以下链路可以正常实现
与端到端验证：

```
MAP_BOUNDARY_DONE(lawn1) → MAP_COMPLETING(倒计时中)
                              │
                    EXPAND_AREA action 到达（合法性：sub_status 处于 MAP_COMPLETING）
                              ↓
              1. 清除倒计时定时器
              2. mapStream.switchDataset('mapping_lawn2_aisle', loadAllPatches('mapping_lawn2_aisle'))
              3. sub_status → find_boundary（与首块草坪完全相同的值，不新增 lawn_index）
              4. legitimate_starting_point 复位为 0，等待新一轮寻边成功信号
              5. labels 追加新的 aisle label
                              ↓
                    （复用首块草坪的 EDGE_START → edge_mapping → EDGE_CLOSE → map_edge_finish 全流程）
                              ↓
                       MAP_BOUNDARY_DONE(lawn2) → MAP_COMPLETING（二次进入，sub_status_entered_at 刷新）
```

**关键结论（对应 §0 表 #9）**：第 2 块及以上草坪的沿边/闭合与首块共用完全相同的
`sub_status` 值集合（`find_boundary`/`edge_mapping`/`map_edge_finish`，均已在镜像中映射，
无需等待同步），**不新增任何区分"第几块"的字段**。区分"当前是第几块"完全交给 §5 的
`labels` 计数机制，`sub_status` 本身不承担这个职责。

**工程实现**：
- `MappingTaskBridge.applyMappingTaskAction` 新增可选 `switchDataset` 回调依赖参数，接线
  方式仿照 `server.ts` 中现有 `applyFault` closure，由路由层从 `AppRouteContext.mapStream`
  （`router.ts`）传入。
- 新建 `fixtures/datasets/mapping_lawn2_aisle/`（构造细节见附录 B）。
- 加入 `PatchLoader.ts` 的 `ALLOWED_DATASETS`。

---

## 8. 退桩失败：`MAP_UNDOCKING_FAILED`（✅ 已用假定占位值解除阻塞，2026-07-13）

`pudu_ratel_app_mower` 的 `BackendPhaseMapper.ts` 已在 `MAPPING_SUB` 表新增：

```ts
undocking_failed: toPhase('MAP_UNDOCKING_FAILED'),
```

**依据**：与 `MAP_COMPLETING` 不同，固件协议文档（`backend-status-mapper-update.md` §3.2）
里没有任何现成的"退桩失败"字符串可复用，真实值目前未知。项目负责人明确决策：**先用假定
占位值 `undocking_failed` 落地，以避免继续阻塞**（2026-07-13）。这与 §0.1 硬约束并不冲突——
硬约束禁止的是 mock **自行**在镜像之外发明占位值绕过流程；这里是在 mower 仓库本体、由决策者
明确授权的占位值，且已在代码注释中清楚标注"非固件文档确认值，待后端定稿后回改"，一旦真实值
确定，只需改 mower 仓库这一行并重新同步。

**终态语义**：无论最终真实取值是什么，退桩失败一律**直接终止任务**（`task_status` 转为
`FAILED`），不提供重试路径。App 侧应展示失败终态 UI + 退出建图流程，而非重试按钮。

该改动已完成：`pudu_ratel_app_mower` 侧单测已新增并通过，`sync-fsm-mirror` 已同步回本仓库。

**mock 侧待实现**：
- fault 预设 `fixtures/faults/mapping_undock_failed.json`，触发退桩阶段进入
  `sub_status='undocking_failed'` 并将 `task_status` 转为 `FAILED`。

---

## 9. NRTK 自检（本次暂缓）

本轮改造**不做** NRTK 自检。`fixtures/mapping/check_conditions.jsonc` 维持现状 6 项，不新增
`nrtk_status`/`nrtk_msg`；`mappingCheck.builder.ts` 不改动。何时启动另行评估。

---

## 10. 遗留清理清单

1. 删除根级 `edge_start_available`、`region_closeable`、`in_lawn`（`ratelStatusPush.ts`、
   `pushChannels.ts`）。`in_lawn` 不做任何迁移，直接整体删除。
2. 删除 `POST /ratel/api/v1/mapping/status` 整个端点（`mapping.routes.ts:11-12`）及
   `docs/api.md`/`docs/scenarios.md` 中的对应条目。
3. **直接删除** `POST /ratel/api/v1/mapping/manual`（不做兼容别名、不保留过渡期）；调用方
   （含 scenario YAML）直接切到 `ratel_mapping_task/action` 的 `EDGE_START`/`EDGE_CLOSE`。
4. `MAP_COMPLETING`（`expand_area`，2026-08-15 更正）与 `MAP_UNDOCKING_FAILED`（`undocking_failed`，
   假定占位值，待后端定稿回改）的 `sub_status` 映射均已按 §0.1 硬约束在
   `pudu_ratel_app_mower` 落地 + `sync-fsm-mirror` 同步完成（见 §3、§8）。
5. 现有 scenario YAML（`mapping_happy_manual.yaml` 等）中消费旧字段名（`in_lawn`/
   `edge_start_available`/`region_closeable`）或旧端点（`mapping/manual`、`mapping/status`）
   的部分需同步更新。

---

## 11. 实施顺序

| 批次 | 内容 | 依赖 |
|---|---|---|
| 1 | `extend_status` 重构（WS + `robot/detail`）+ `labels` 接口落地（动态生成基础设施）+ 删除 `/mapping/status`、`/mapping/manual` | 无 |
| 2 | `EDGE_START`/`EDGE_CLOSE` action（复用已同步的 `edge_mapping`/`map_edge_finish` 映射，FSM 侧无需改动） | 批次 1 |
| 3 | `MAP_COMPLETING` 协议投影 + 120s 倒计时 + `sub_status_entered_at` + `COMPLETE` action（`map_completing → MAP_COMPLETING` 已在 mower 落地并同步，见 §3） | 批次 2 |
| 4 | `EXPAND_AREA` + `mapStream` 依赖注入 + `mapping_lawn2_aisle` 数据集 | 批次 3 |
| 5 | 退桩失败 fault（`undocking_failed → MAP_UNDOCKING_FAILED` 已在 mower 落地并同步，见 §8） | 批次 1 |
| 6 | 文档同步（`docs/api.md`、`docs/data-dictionary.md`）+ 测试补齐 | 全部完成后 |

---

## 12. 外部仓库依赖（已全部完成，2026-07-13）

按 §0.1 硬约束，以下项已在 `pudu_ratel_app_mower` 仓库实际落地、再同步回本仓库：

1. ~~`BackendPhaseMapper.ts` 的 `MAPPING_SUB` 表新增 `MAP_COMPLETING` 对应的真实 `sub_status`
   键~~ **已完成**：新增 `map_completing: toPhase('MAP_COMPLETING')`（后端确认值，见 §3）。
2. ~~`BackendPhaseMapper.ts` 新增 `MAP_UNDOCKING_FAILED` 对应的真实 `sub_status` 键~~
   **已完成**：新增 `undocking_failed: toPhase('MAP_UNDOCKING_FAILED')`（假定占位值，
   待后端定稿回改，见 §8）。

两者均已 `sync-fsm-mirror` 同步，mock 侧协议投影层（§3、§8 的"mock 侧待实现"）可以正常推进。

NRTK 自检本次不做（§9），不属于本轮范围。

其余此前列出的悬而未决项（action 通道、`extend_status` 结构、查询快照端点、`lawn_count`
计算方式、`labels` 生成方式、第 N 块草坪编码方案）均已在本文档 §0-§11 拍板，不再视为待确认项。

---

## 附录 A：后续新增缺口的判断原则

处理任何尚未在本文档拍板的新缺口时，沿用以下判断原则（源自早期分析过程，原则本身仍然有效，
具体结论已被 §0-§12 取代）：

> 一项缺口能否由 map_mock_service 自主决定，看它改的是**值**还是**结构/通道**：
> - 改**值**（枚举字符串、错误码数字、时间戳单位、字段默认值）→ mock 可自主决定，因为
>   消费方的翻译层按字段名而非具体枚举值编码，换值不影响联调正确性；
> - 改**结构**（字段名、嵌套路径、承载通道、哪个 cmd、是否需要新的 FSM `sub_status`
>   映射）→ 必须先对齐（后端接口团队，或按 §0.1 硬约束先在 `pudu_ratel_app_mower`
>   落地），mock 不能抢先自造一套不同结构，否则会出现"mock 上验证通过、真机上失败"的分裂。

---

## 附录 B：`mapping_lawn2_aisle` 数据集构造细节

对应 §7 的工程实现。构造方式（不需要一份跨两块草坪的超长连续帧数据集，只需两份独立数据集 +
一次运行时切换）：

- **通道（aisle）帧**：数量不必多，`origin_x`/`origin_y` 沿一条直线从 lawn1 出口坐标插值到
  lawn2 入口坐标；图像内容不必真实，可用占位图——`PatchLoader.ts` 只依赖 XML 里的几何字段
  做位姿推算，通道帧的视觉真实感不是刚需。
- **lawn2 帧**：直接复用 `mapping_happy` 已有的 749 帧 PNG，仅将 `origin_x`/`origin_y`
  整体平移一个偏移量放到网格另一处，`timestamp_ms`/文件名续接在通道帧之后。
- **`manifest.json`**：格式照抄 `mapping_happy` 现有结构（`name`/`scenario`/`frameCount`/
  `resolution`/`world`/`notes`/`compatibleScenarios`）。
- 加入 `PatchLoader.ts:7` 的 `ALLOWED_DATASETS`。
- 场景 YAML 不需要在 `dataset:` 字段预置这份数据集给 `scenarioEngine` 一次性加载，而是断言
  "收到 `EXPAND_AREA` 后 `labels`/`edge_start` 计数按预期变化"，底层数据集切换由
  `MappingTaskBridge` 在处理 action 时动态触发。

---

## 附录 C：验收标准清单

1. `EDGE_START`/`EDGE_CLOSE` 收到非法信号（`legitimate_starting_point`/`legitimate_end_point`
   为 0）时返回 `422`。
2. 成功的 action 在设备模拟状态确认（`sub_status` 推送）到达前不改变 phase（`COMPLETE`/
   `EXPAND_AREA` 除外，见 §1）。
3. `edge_mapping` 是 `EDGE_START` 确认后的权威过渡值；`map_edge_finish` 是 `EDGE_CLOSE`
   确认后的权威过渡值。
4. 断线重连恢复能从 `robot/detail` 还原 `sub_status`、`sub_status_entered_at`、
   `extend_status`，且与实时 WS 状态一致。
5. 未知 `sub_status` 值保持 no-op，不强制进入任何 phase。
6. `labels` 缺失、`points` 为空或坐标非法时不抛错、不渲染 marker。
7. 无任何运行中的场景/协议投影依赖已删除的 legacy 分支（`mapping/manual`、
   `mapping/status`、`edge_start_available`、`region_closeable`、`in_lawn`、旧 coverage
   phase）。
8. `expand_area` 收到时权威过渡到 `MAP_COMPLETING`，`sub_status_entered_at` 与
   `extend_status.wait_extend_timestamp` 同步刷新（窗口外后者恒为 `0`）；
   `undocking_failed` 收到时权威过渡到 `MAP_UNDOCKING_FAILED` 并终止任务（`task_status=FAILED`），
   不提供重试路径。
