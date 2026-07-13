# map_mock_service 建图域新 API 实现差距分析

> 范围：仅建图域（Mapping Domain）
> 依据：
> - [`APP端接口文档v4.md`](../../build-docs/pudu_ratel_app_mower/APP端接口文档v4.md)
> - [`APP端接口文档v3与v4对比.md`](../../build-docs/pudu_ratel_app_mower/APP端接口文档v3与v4对比.md)
> - [`mapping_api_gap_audit.md`](../../build-docs/pudu_ratel_app_mower/mapping_api_gap_audit.md)（审计基线，区分"缺失/待确认/已确认可支撑"）
> - [`mapping_flow_refactor_design.md`](../../build-docs/pudu_ratel_app_mower/mapping_flow_refactor_design.md)（重构口径）
> - map_mock_service 现状代码（`src/http/routes/mapping.routes.ts`、`mappingTask.routes.ts`、`src/sim/pushChannels.ts`、`ratelStatusPush.ts`、`MappingTelemetry.ts`、`DeviceProfile.ts`、`virtualRobotCore.ts`）
>
> 目的：在 `map_mock_service` 实现建图域新 API 前，盘点"数据层缺失 / 逻辑层自洽性 / 乐观假设 vs 必须对齐"，给出可直接落地的结论。

---

## 0. 现状一句话结论

mock 现在跑的是一套**早于审计定稿的自造协议**：用 `/ratel/api/v1/mapping/manual`（旧接口）的 `edge_start`/`region_closure` 表达"开始/闭合"，用自造字段 `in_lawn`/`edge_start_available`/`region_closeable` 表达按钮使能态；而审计已经把这两件事**分别收口**到了：

1. 用户指令 → `ratel_mapping_task/action` 新增 `CONFIRM_START_BOUNDARY` / `CONFIRM_CLOSE`（🔴 缺失，待后端新增 action）；
2. 按钮使能态 → `NOTIFY_RATEL_STATUS.extend_status.legitimate_starting_point` / `legitimate_end_point`（✅ 已确认字段，WS 已有载体，查询快照待补）。

也就是说，mock 当前既没有对齐"已确认可支撑"的 `extend_status` 字段，也没有实现"待新增"的 action。下文逐项展开。

---

## 1. 数据层面：还缺什么，能否用现有资源生成

### 1.1 缺口总表（数据维度）

| # | 数据项 | 后端契约状态 | mock 现状 | 能否用现有资源生成 |
|---|---|---|---|---|
| D1 | `CONFIRM_START_BOUNDARY` action | 🔴 缺失（待后端新增） | ❌ 未实现，`MappingTaskBridge.ts` 的 `VALID_ACTIONS` 仅 `PAUSE/RESUME/STOP` | ✅ 可生成：action 是字符串枚举，mock 自主扩展即可，无外部数据依赖 |
| D2 | `CONFIRM_CLOSE` action | 🔴 缺失（待后端新增） | ❌ 同上 | ✅ 可生成：同上 |
| D3 | `extend_status.legitimate_starting_point` | ✅ 已确认（WS） | ❌ `buildNotifyRatelStatus` 根本没有 `extend_status` 对象 | ✅ 可生成：现有 `MappingTelemetry.edgeStartAvailable` 语义等价，只需改名映射 |
| D4 | `extend_status.legitimate_end_point` | ✅ 已确认（WS） | ❌ 同上，现有 `regionCloseable` 可映射 | ✅ 可生成：`MappingTelemetry.regionCloseable` 语义等价 |
| D5 | `extend_status` 查询快照（`robot/detail`） | 🟠 待补 | ❌ `DeviceProfile.buildDeviceInfo` 无 `extend_status` | ✅ 可生成：与 WS 同源数据，`buildDeviceInfo` 注入同一份即可 |
| D6 | `MAP_COMPLETING` 的 `sub_status` 实际值 | 🔴 待确认 | 🟡 `deriveSubStatus` 已投影为 `exit_mapping`；镜像 `BackendPhaseMapper` 尚无真实后端键的反向映射 | ⚠️ `exit_mapping` 是 mock 兼容投影，不是已确认的真实枚举值 |
| D7 | `sub_status_entered_at`（phase 进入时间） | 🔴 缺失/核对中 | ❌ 完全不存在 | ✅ 可生成：mock 自有事件循环，`sub_status` 变更时记录 `Date.now()` 即可，不依赖外部 |
| D8 | mapping `sub_status` 查询快照 | 🔴 待落地 | 🟡 `/ratel/api/v1/mapping/status` 已返回 `sub_status`，但缺 `sub_status_entered_at`/`lawn_count` | ✅ 可生成：在现有端点补字段即可 |
| D9 | `lawn_count`（草坪数） | 🟠 缺失 | ❌ 无 | ✅ 可生成：从 `passageCheckpoints.length` + 1 推导（mock 已记录通道端点），或维护计数器 |
| D10 | NRTK 自检状态 | 🟠 缺失 | ❌ `buildMappingCheckData` 无此项 | ✅ 可生成：`check_conditions.jsonc` 加 `nrtk_status` 字段即可（无外部依赖） |
| D11 | 退桩失败 `MAP_UNDOCKING_FAILED` 语义 | 🟠 待确认 | ❌ 无对应 `sub_status`/错误码 | ✅ 可占位生成：自定义 `sub_status='undocking_failed'` + 错误码，真实编码待后端 |
| D12 | `lawn_area` 查询快照 | 🟠 待确认 | 🟡 WS `MAP_INCREMENTAL.map_header.lawn_area` 已有；HTTP 查询快照未明确 | ✅ 可生成：mock 已在推流时算面积，`/mapping/status` 回显即可 |
| D13 | 沿边/寻边起点坐标 | ✅ 已确认（`labels` 接口） | ❌ `/map-service/api/v1/ratel_map/labels` 未实现路由 | ✅ 可生成：mock 已有 `passageCheckpoints`/`edgeStart` 坐标，转成 `labels` 结构即可 |
| D14 | `manual_closure_suggested` | ✅ 已确认（WS） | ❌ 无 | ✅ 可生成：可由 `legitimate_end_point` 派生或独立开关 |
| D15 | `area_complete_map_build` / `blade_status` | ✅ 已确认（WS） | ❌ 无 | ✅ 可生成：静态/派生即可 |

### 1.2 关键结论

**绝大多数数据缺口 mock 都能自行生成**，原因有二：

1. mock 是数据的**生产者**而非消费者——它自己跑一个虚拟机器人，`sub_status` 变更时刻、坐标、面积、草坪数它全知道，不存在"后端不给我我就没有"的问题；
2. 审计里标注"✅ 已确认可支撑"的字段（`legitimate_starting_point`/`legitimate_end_point`/`labels`），mock 已有**语义等价**的内部状态（`edgeStartAvailable`/`regionCloseable`/`passageCheckpoints`），只是**字段名和承载结构没对齐**。

**真正不能纯靠现有资源生成的，只有"真实枚举值"类缺口**（D6/D11）：mock 可以自己定一个占位值让链路跑通，但这个值与真实后端是否一致无法保证——这部分见第 3 节。

---

## 2. 逻辑层面：不能自洽的逻辑

### 2.1 🔴 双轨指令冲突：旧 `mapping/manual` vs 新 `mapping_task/action`

**现状**：mock 同时存在两条"开始/闭合"通道——

- 旧：`POST /ratel/api/v1/mapping/manual`（`mapping.routes.ts:30`）接受 `edge_start`/`region_closure`，直接调 `confirmEdgeStart()`/`confirmRegionClosure()`；
- 新（待实现）：`POST /ratel_mapping_task/action` 应新增 `CONFIRM_START_BOUNDARY`/`CONFIRM_CLOSE`。

**不自洽点**：审计 §2.1/§2.2 明确要求新 action 承担"用户命令设备开始/闭合边界"的职责，而 `mapping/manual` 是 v4 仍保留但语义被拆分的旧接口（`in_lawn` 是设备感知态、不应由 App 上报）。如果 mock 两条都保留且都驱动同一 `confirmEdgeStart`，会出现：

- App 调新 action，mock 也接受；App 调旧 manual，mock 也接受 → **两条路都"成功"，但 App 无法验证"是否走对了通道"**；
- 旧 manual 的 `in_lawn` 字段被 App 误上报时 mock 不报错 → 与审计"`in_lawn` 不应由 App 上报"冲突。

**建议**：新 action 落地后，`mapping/manual` 在 mock 侧应**降级为仅接受 `edge_start`/`region_closure` 两个指令字段，拒绝 `in_lawn`**，并在文档里标注"指令通道已迁移至 `ratel_mapping_task/action`，此接口仅做兼容"。最终目标是删掉旧通道，与 v4 文档对 `mapping/start|pause|resume|stop` 的"一刀切删除"策略保持一致。

### 2.2 🔴 字段双名：`edge_start_available` vs `legitimate_starting_point`

**现状**：`pushChannels.ts:163` 与 `ratelStatusPush.ts:147` 推送 `edge_start_available`/`region_closeable`，而审计确认的后端字段是 `extend_status.legitimate_starting_point`/`legitimate_end_point`。

**不自洽点**：

1. mock 的字段直接平铺在 `data` 根下，而后端契约放在 `data.extend_status` 对象内（与 `locator_status`/`operation_status` 同级）；
2. mock 完全没有 `extend_status` 对象 → App 若按 v4 文档解析 `extend_status.legitimate_starting_point`，在 mock 上会拿到 `undefined`，按钮永远禁用；
3. mock 的 `edge_start_available` 是 App 按早期 `mapping_api_dvt_gap.md §3` 草案解析的，但该草案已被审计 §4.1/§4.2 **撤销**（确认复用 `legitimate_starting_point`/`legitimate_end_point`）。

**这是当前 mock 与"已确认契约"之间最大的不自洽**，且方向明确——审计已经赢了，mock 必须改字段名和嵌套结构。

### 2.3 🟠 `sub_status` 派生与 `MAP_COMPLETING` 协议待定

**现状**：`deriveSubStatus`（`pushChannels.ts`）已按 FSM 状态提供 `MAP_COMPLETING` 的完成投影；真实后端对应的 `sub_status` 键仍待确认。

**同步结果**：mower FSM 镜像已删除 `MAP_COVERAGE_*`，改为 `MAP_COMPLETING`；mock 在 `mapping -> idle` 完成边沿中按源 registry 派发 `MAP_COMPLETING` 后确认完成。

- mock 的 `MAP_COMPLETING` 当前向外投影为 `exit_mapping`，以保留现有状态推送结构；真实键定稿后再更新 mapper；
- `dvt-adaptation-plan.md` §1.2 模块 B 已规划"过渡期打样开关 `mappingCoverageSkip`"，但尚未落地。

**剩余风险**：后端若要求新的完成中 `sub_status` 键，需在 mower 的 `BackendPhaseMapper` 中定稿后重新运行镜像同步；未知键仍按保守 no-op 处理。

**已处理**：mock 侧在 `deriveSubStatus` 增加了 `MAP_COMPLETING` 分支，且没有修改生成镜像文件。

### 2.4 🟠 倒计时时间戳没有权威来源

**现状**：`dvt-adaptation-plan.md` W5 规划 `countdown_seconds` 占位字段，但审计 §3.2 明确要求的是 `sub_status_entered_at`（进入时刻），App 据此算剩余时间，而非服务端推剩余秒数。

**不自洽点**：

- 推 `countdown_seconds` 是"服务端推剩余值"模型，App 每帧刷新即可，但冷启动无法恢复（断线期间递减了多久不知道）；
- 审计要求的是"推进入时刻"模型，App 自己算 `now - entered_at`，冷启动也能准确恢复。

mock 现状两个都没有。若按 W5 先实现 `countdown_seconds`，后续对齐 `sub_status_entered_at` 时要返工。

**建议**：直接实现 `sub_status_entered_at`（mock 自有事件时间戳，零成本），`countdown_seconds` 作为派生展示字段可选附加，不要把 W5 的占位字段名当成最终协议。

### 2.5 🟠 `mapping/status` 恢复快照字段不全

**现状**：`mapping.routes.ts:12` 的 `/ratel/api/v1/mapping/status` 返回 `sub_status`/`map_id`/`mode`/`in_lawn`/`trajectory_url`/`passage_checkpoints`，但缺：

- `sub_status_entered_at`（D7）
- `lawn_count`（D9）
- `lawn_area`（D12）
- `extend_status` 快照（D5）

**不自洽点**：审计 §3.3 要求"查询快照与 `NOTIFY_RATEL_STATUS` 必须采用同一枚举和同一语义"。mock 的 HTTP 快照和 WS 推送目前连字段名都不一致（HTTP 用 `in_lawn`，WS 也用 `in_lawn` 但审计要 `extend_status.legitimate_starting_point`），更谈不上"同源"。

### 2.6 🟡 `labels` 接口未实现，起点坐标散落在两处

**现状**：mock 的起点坐标存在 `passageCheckpoints[].start`（寻边起点）和 `MappingTelemetry` 内部（沿边起点），但没有 `/map-service/api/v1/ratel_map/labels` 路由。

**不自洽点**：审计 §5.1 已确认 `labels` 接口是起点坐标的权威载体，mock 不实现 → App 按文档调 `labels` 会 404，只能退回 `mapping/status` 的 `passage_checkpoints`（那是 DVT gap 草案的字段，非 v4 文档字段）。两套坐标来源并存，App 侧会困惑该信哪个。

---

## 3. 未定义/缺少项：乐观假设 vs 必须对齐

### 3.1 可以乐观假设（mock 自主决定，不影响 App 联调正确性）

这些项的共同特征是：**mock 是数据生产者，选什么值 App 就收到什么值，只要 mock 与自己推送的值自洽，App 的解析/渲染逻辑就能验证通过**。真实后端上线后值可能不同，但 App 侧的翻译层（ACL）是按字段名而非枚举值硬编码的，换值不影响链路。

| 项 | 乐观假设 | 理由 |
|---|---|---|
| `CONFIRM_START_BOUNDARY`/`CONFIRM_CLOSE` 的 action 字符串 | mock 直接用这两个名字 | action 是字符串，后端最终定稿大概率也是这名（审计建议即此名）；即使改名，mock 改一处即可 |
| action 的错误语义（任务不存在/phase 不允许/`legitimate_starting_point=0`/设备忙/重复确认） | mock 自定义错误码与 `robot_message` | 审计只要求"区分"，具体码值后端未定；mock 覆盖五种分支即可让 App 验证错误处理 |
| `MAP_COMPLETING` 的 `sub_status` 占位值 | 当前 mock 用 `exit_mapping` | 真实值待后端；该值仅为 mock 兼容投影，不能视为真机协议定稿 |
| `sub_status_entered_at` 的单位/时区 | mock 用毫秒 epoch（审计建议值） | 审计已建议 `int64` 毫秒，mock 照做即可 |
| `lawn_count` 字段名 | mock 用 `lawn_count: int` | 审计建议名，无竞争方案 |
| NRTK 自检字段名 | mock 用 `nrtk_status`/`nrtk_msg` | `dvt-adaptation-plan.md` W1 已定 |
| 退桩失败 `sub_status` | mock 用 `undocking_failed` | 占位，与 `MAP_UNDOCKING_FAILED` phase 名对应 |
| `labels` 接口的 `type` 取值 | mock 用 `edge_start`/`aisle`（v4 文档示例值） | v4 文档已给示例，审计 §5.1 确认 |

### 3.2 必须和后端对齐（mock 不能自主决定，否则误导 App）

这些项的共同特征是：**涉及"哪条通道/哪个字段承载语义"的结构性决策，后端一旦定型，App 的翻译层和数据访问层都要按它走；mock 若抢先自造一套不同结构，会让 App 在 mock 上验证通过、上真机却失败**。

| 项 | 为什么必须对齐 | mock 当前风险 |
|---|---|---|
| **按钮使能态的承载结构**：必须是 `extend_status.legitimate_starting_point`/`legitimate_end_point`，不能是根下平铺的 `edge_start_available` | 审计已"确认"此为最终契约（§4.1/§4.2），非草案。App 翻译层会按 `extend_status.xxx` 取值 | 🔴 mock 现在平铺在根下且字段名不同，App 按真契约解析会全 `undefined` |
| **用户指令的通道**：必须走 `ratel_mapping_task/action` 新 action，不能继续走 `mapping/manual` | 审计 §2.1/§2.2 把新 action 列为 🔴 缺失项，意味着这是"待新增的正式通道"；`mapping/manual` 是旧接口，v4 已对其同类接口做删除线处理 | 🔴 mock 现在只走旧通道 |
| **`sub_status` 的分层**：建图 phase 必须落在 mapping `sub_status`，`task_status` 保持 `ON_THE_WAY`，不能扩张 `task_status` | 审计 §6.5 待确认，但方向明确。若 mock 把 phase 塞进 `task_status`，App 翻译层会错乱 | 🟡 mock 当前已将 `MAP_COMPLETING` 投影为 `exit_mapping`，但真实后端枚举和恢复快照契约仍未验证 |
| **`extend_status` 查询快照的载体**：审计建议在 `robot/detail` 返回与 WS 同结构的 `extend_status` | 冷启动按钮态必须可信。若 mock 不在 `robot/detail` 补，App 冷启动只能拿旧缓存 | 🔴 mock `buildDeviceInfo` 无 `extend_status` |
| **`MAP_COMPLETING` 是否持续推送 + 终态迁移**：进入成功/失败/取消后的后续 `sub_status`/`task_status` | 审计 §3.1 要求后端给出最小契约。mock 若自己定义一套迁移，可能与真机不一致 | 🟠 mock 可先按重构方案 §2.5 的提议实现，但标注"待后端确认" |
| **`mapping_completed` 的废弃边界**：审计 §6.6 建议标 deprecated，建图恢复不能用它 | 若 mock 仍推 `mapping_completed` 让 App 当 phase 信号，会强化错误用法 | 🟡 mock 需确认 `running_status.mapping_completed` 是否仍在 `robot/detail` 返回 |

### 3.3 判定原则（可复用）

> 一项缺口能否"乐观假设"，看它改的是**值**还是**结构**：
> - 改**值**（枚举字符串、错误码数字、时间戳单位）→ mock 自主决定，App 翻译层不关心具体值，可乐观假设；
> - 改**结构**（字段名、嵌套路径、承载通道、哪个 cmd）→ 必须与后端对齐，否则 App 的数据访问层在真机上取不到值。

---

## 4. 落地优先级建议（给 mock 实现者）

按"先对齐已确认契约，再补占位缺口"的顺序：

### P0：对齐"已确认可支撑"的契约（不依赖后端任何待确认项）

1. **`extend_status` 落地到 WS**（D3/D4/D14/D15）：`buildNotifyRatelStatus` 增加 `extend_status` 对象，把 `edgeStartAvailable`→`legitimate_starting_point`、`regionCloseable`→`legitimate_end_point`、补 `manual_closure_suggested`/`area_complete_map_build`/`blade_status`。删除根下平铺的 `edge_start_available`/`region_closeable`/`in_lawn`（`in_lawn` 按 `mapping_api_dvt_gap.md` 仍需保留为设备感知态，放进 `extend_status` 或保留根下需与 App 确认——审计未覆盖此字段，见 §5 待确认）。
2. **`extend_status` 落地到 `robot/detail`**（D5）：`DeviceProfile.buildDeviceInfo` 注入同一份 `extend_status`。
3. **`labels` 路由实现**（D13）：新增 `POST /map-service/api/v1/ratel_map/labels`，从 `passageCheckpoints` 和沿边起点生成 `edge_start`/`aisle` 两类 label。
4. **`mapping/status` 快照补齐**（D7/D9/D12）：补 `sub_status_entered_at`、`lawn_count`、`lawn_area`，并让 `sub_status` 与 WS 同源。

### P1：实现"待新增"的用户指令 action（依赖后端新增，但 mock 可先行）

5. **`CONFIRM_START_BOUNDARY`/`CONFIRM_CLOSE` action**（D1/D2）：`MappingTaskBridge.VALID_ACTIONS` 增加两项，`virtualRobotCore` 增加对应方法（复用现有 `confirmEdgeStart`/`confirmRegionClosure` 逻辑），错误语义覆盖审计 §2.1 的五种。
6. **旧 `mapping/manual` 降级**（§2.1）：拒绝 `in_lawn` 上报，文档标注通道迁移。

### P2：占位"待确认"的语义缺口（mock 自定值，标注占位）

7. **`MAP_COMPLETING` 占位**（D6/§2.3）：`deriveSubStatus` 增加分支，`sub_status='map_completing'`，闭合后进入此态并推 `sub_status_entered_at`。
8. **退桩失败占位**（D11）：`sub_status='undocking_failed'` + fault 预设。
9. **NRTK 自检**（D10）：`check_conditions.jsonc` + `mappingCheck.builder.ts`。
10. **`lawn_count` 上限**（D9）：补"≥15 禁用添加草坪"逻辑（figma §2.7 有此约束）。

### P3：文档与测试

11. 同步 `docs/api.md`、`docs/data-dictionary.md`，所有占位字段标注"mock 占位，待后端定稿"。
12. `__tests__/mappingRoutes.test.ts` 增加新 action、`extend_status`、`labels`、`sub_status_entered_at` 的断言。

---

## 5. 遗留待确认事项（需在实现前拉通）

| # | 事项 | 涉及方 | 当前 mock 倾向 |
|---|---|---|---|
| Q1 | `in_lawn`（设备在草内感知态）的承载位置：审计未覆盖此字段，`mapping_api_dvt_gap.md §3` 建议放 `NOTIFY_RATEL_STATUS.data` 根下，但审计把同类按钮态收口到了 `extend_status` | App + 后端 | 倾向放 `extend_status.in_lawn`，与 `legitimate_starting_point` 同级，保持扩展状态集中 |
| Q2 | `MAP_COMPLETING` 的真实 `sub_status` 值、是否持续推送、终态迁移 | 后端 | mock 先用 `map_completing` 占位 |
| Q3 | `task_status` 与 mapping `sub_status` 的分层是否如审计 §6.5 所述 | 后端 | mock 保持 `task_status=ON_THE_WAY` + `sub_status` 表达 phase |
| Q4 | `mapping_completed` 是否在 `robot/detail` 标 deprecated | 后端 + App | mock 保留返回但加注释，不作为 phase 信号 |
| Q5 | `CONFIRM_START_BOUNDARY`/`CONFIRM_CLOSE` 的正式 action 名与错误码 | 后端 | mock 用审计建议名 |
| Q6 | `sub_status_entered_at` 是否由后端提供、单位/时区 | 后端 | mock 用毫秒 epoch |

---

## 6. 一页纸清单

```
数据层：15 项缺口，13 项 mock 可自生成，2 项（真实枚举值 D6/D11）需占位待后端
逻辑层：6 处不自洽，最严重是字段双名（§2.2）和双轨指令（§2.1）
乐观假设：8 项（§3.1），全是"改值"类
必须对齐：6 项（§3.2），全是"改结构/改通道"类
判定原则：改值可乐观，改结构必须对齐
落地顺序：P0 对齐已确认契约 → P1 实现新 action → P2 占位待确认 → P3 文档测试
```
