# map_mock_service DVT 阶段适配方案

> 状态：方案设计（待评审）
> 适用版本：Mower Dev Simulator v1 → DVT1 适配版
> 编写依据：
> - `build-docs/pudu_ratel_app_mower/DVT阶段研发指引.md`（DVT1 需求全集，提测 2026/07/15，验收 2026/08/15，仅 Max 款）
> - `build-docs/pudu_ratel_app_mower/mapping_ui_rewrite_figma_component_mapping.md`（建图 UI 重写审计，含多草坪流程、状态机差异）
> - `build-docs/pudu_ratel_app_mower/APP端接口文档v3.md`（App 端 WS/HTTP 接口规范）
> - 当前 `map_mock_service` 代码现状（`src/`、`fixtures/`、`scenarios/`、`docs/`）
>
> 本文档覆盖：**设计方案 → 落地方案 → 测试方案 → 验收标准**，仅涉及 mock service 侧改造，不涉及 App/Rustkit/真实后端代码。
>
> ## 硬约束（继承自 `docs/fsm-mirror.md`）
> `src/sim/fsm-mirror/` 是从 `pudu_ratel_app_mower` 仓库同步的只读镜像，**禁止手动编辑**。凡涉及状态机新增/变更（跳过 COVERAGE、沿边丢失、抬起独立异常等），必须先在 App 仓库落地，再通过 `npm run sync-fsm-mirror` 同步进本仓库；mock 侧只能在 `src/sim/`（镜像之外）与 `src/http/routes/` 做桥接适配。**本方案中所有"状态机改动"条目均以"待 App 侧先行 + mock 侧同步"为前提，不在 mock 仓库里分叉出一份自造状态机。**

---

## 0. 背景与范围

`map_mock_service` 是 `pudu_ratel_app_mower` 的本地联调/测试替身，模拟其依赖的 REST API 与 `/acc` WebSocket 推送通道，并提供 `/sim/*` 控制面（场景编排、故障注入、chaos 延迟、录制回放、可视化面板）。

DVT1 阶段 App 侧的工作量集中在（详见 DVT 指引 §5、§7 优先级建议）：
1. 建图自检门禁化 + NRTK 信号项（B1/B2/B10）
2. 跳过内部覆盖建图，"建图完成"三按钮 + 120s 倒计时（B3/B4）
3. 割草参数口径切换 Max 款 + 选区/沿边独立参数（M1-M6）
4. 异常体系细分：抬起独立、重定位、低电前置拦截、雨天/勿扰拦截（X1-X8）
5. 新增模块：割草计划、OTA、设备日志、耗材保养、勿扰模式、NRTK 设置（N1-N11）
6. 地图编辑对齐：禁区/虚拟墙/分割合并/边界微调 + `base_version` 冲突仲裁（E1-E5）

**mock service 必须同步具备对应的接口行为、可配置故障场景与可观测状态**，否则 App 侧无法在无真机环境下联调、自测、验收。本方案按"App 侧要读什么 mock 就要能造什么数据、App 侧要触发什么异常 mock 就要能一键注入"的原则设计。

### 0.1 现状盘点摘要（来自代码审计）

| DVT 概念 | mock 现状 |
|---|---|
| 建图自检 6 项（含 NRTK） | ✅ 已有 5 项（`bluetooth_status/cellular/wifi/battery/docking_station/light`），**缺 NRTK 第 6 项**；battery 已按实时电量动态计算 |
| 自检失败场景 | ❌ 无对应 fault 预设，`self_check`/`mapping/check` fixture 恒为成功态 |
| 跳过覆盖建图（COVERAGE_*） | 🟡 FSM 镜像仍保留完整 `MAP_COVERAGE_*` 分支（因为 App 侧尚未改），mock 无法先于 App 改 |
| 沿边丢失（独立于寻边失败） | ❌ FSM 镜像无此 phase（同上，需 App 先加） |
| 多草坪/通道（passage） | ✅ 已实现 `add_lawn` + `edge_start` + `passage_checkpoints` |
| 闭合可达信号 / 草地识别信号 | 🟡 部分：`region_closure`/`in_lawn` 字段已有，但"开始"按钮的机器信号驱动（§5.5 figma 新增）字段未明确定义 |
| 禁区(251)/虚拟墙(254) | ✅ 静态标注数据已有，非行为化模拟 |
| `base_version` 冲突仲裁 | 🟡 仅自增，无版本冲突拒绝逻辑 |
| 回充流程 | ✅ 完整实现 |
| 急停 | ✅ 模拟器扩展实现 |
| 低电量 | 🟡 有 fault 预设，无自动电量衰减，无"<20%拒绝启动"校验 |
| 抬起/侧倾/侧翻/卡困/定位丢失 | ❌ 全部缺失，只有通用 `DEVICE_ERROR` |
| 雨天/勿扰 | ❌ 完全缺失 |
| NRTK | ❌ 完全缺失 |
| OTA | ❌ 完全缺失 |
| 割草计划 | ❌ 完全缺失 |
| 设备日志/耗材保养 | ❌ 完全缺失 |
| 割草参数口径（Max 款） | 🟡 任务创建接口已有 `mow_height/mow_speed/texture`，但无范围校验，无选区/沿边独立参数支持 |

---

## 1. 设计方案

### 1.1 设计原则

1. **数据与逻辑分离**：新增能力优先落在 fixture（JSON/JSONC，热重载）+ fault 预设（`fixtures/faults/*.json`），避免硬编码进 TS；仅当涉及跨请求状态流转（如 OTA 下载进度、计划触发）时才落进 `VirtualRobot`/新 Service。
2. **契约优先于行为仿真**：mock 的首要职责是让 App 能按接口文档联调成功、能触发全部异常/边界分支；不追求物理级真实（如不做实际的电量衰减物理模型），但要覆盖"App 需要处理的每一种服务端响应/推送形态"。
3. **新模块走既有分层**：新增 HTTP 路由放 `src/http/routes/<domain>.routes.ts`，注册进 `src/http/router.ts` 的 `ROUTES` 数组；新增 WS 推送放 `src/sim/pushChannels.ts` 新增 `build*` 函数；新增状态放 `VirtualRobot`（或独立 Service，参考 `RechargeTaskService` 模式）。
4. **状态机相关改动遵循镜像只读约束**：涉及 `MappingBusinessPhase`/`TaskState` 新增值的条目，标注为"待 App 侧先行"，mock 侧先用 `simFsmTypes.ts` 风格的模拟器扩展类型**临时**打样（不改镜像），待 App 正式改完、`sync-fsm-mirror` 同步后，再收敛为镜像内类型，删除临时扩展。这与现有 `ESTOPPED`（模拟器扩展 TaskState）的先例一致。
5. **所有新场景必须可通过 `/sim/*` 一键复现**：新增 fault 预设 + scenario YAML + panel 可视化入口，保证 QA/App 开发不需要改代码就能触达每个 DVT 分支。
6. **文档同步**：改动后同步更新 `docs/api.md`（契约）、`docs/data-dictionary.md`（新增 fixture）、`docs/scenarios.md`（新增场景）、`README.md`（HTTP/WS 表格），遵循仓库既有约定。

### 1.2 分模块设计

#### 模块 A：建图自检门禁 + NRTK（对应 DVT B1/B2/B10）

- **NRTK 自检项**：`fixtures/mapping/check_conditions.jsonc` 新增字段 `nrtk_status: ok|warning|error` + `nrtk_msg`；`mappingCheck.builder.ts` 在现有 5 项基础上追加第 6 项拼装逻辑，响应结构追加 `nrtk_status`/`nrtk_msg`。
- **电量阈值**：确认 `battery` 派生逻辑阈值改为 `>=50%` 判定通过（当前审计显示已是动态计算，需核实具体阈值常量并对齐 50%，而非历史 89%）。
- **失败场景可配置化**：新增 fault 预设，每项各自独立可触发失败：
  - `mapping_check_battery_low.json`（battery<50%）
  - `mapping_check_bluetooth_unauthorized.json` / `mapping_check_bluetooth_off.json` / `mapping_check_bluetooth_out_of_range.json`（区分 App 未授权 / 手机蓝牙未开 / 距离过远三种细分文案，对应 DVT §2.1 步骤1 ③ 的三种提示）
  - `mapping_check_network_down.json`（4G 与 WiFi 均不可用）
  - `mapping_check_nrtk_bad.json`
  - `mapping_check_not_on_dock.json`
- **自检超时**：`/ratel/api/v1/robot/self_check` 与 `/ratel/api/v1/mapping/check` 支持通过 `/sim/chaos` 或专用 fault（如 `mapping_check_timeout.json`，配合 `chaos.dropRate` 或长延迟）模拟 App 侧 1.5s 轮询 + 20s 超时的场景。

#### 模块 B：建图状态机改造（对应 DVT B3/B4、figma §5.5/§6）

> ⚠️ 以下均需等待 `pudu_ratel_app_mower` 完成对应 FSM 改动（P-1/P-2/P-3，见 figma 映射表 §8）并同步镜像后，mock 才能"真正"落地；本节给出 mock 侧的**适配计划**与**过渡期打样方案**。

- **跳过覆盖建图**：镜像同步后，`VirtualRobot`/`mappingReducer` 会在边界闭合后直接进入"建图完成"态而非 `MAP_COVERAGE_*`；mock 侧需要：
  - 核对 `pushChannels.ts` 中 `RATEL_MAPPING_TASK` 状态映射是否需要新增/调整（对照 `docs/fsm-mirror.md` "新增建图阶段"处理表）。
  - `mapStream.ts` 的 `shouldStreamMap()` 条件核对是否仍需在闭合后继续推流（用于"预览&编辑地图"页面）。
  - 更新 `scenarios/mapping_happy_auto.yaml`、`mapping_happy_manual.yaml`：闭合后不再驱动 `CMD_START_COVERAGE`，直接进入完成态并可选驱动 120s 倒计时（`CMD_FINISH_AND_RETURN_DOCK` 或新增等效模拟器事件）。
  - **过渡期打样**（App 侧尚未改完前，供 UI 重写先行联调）：在 `simFsmTypes.ts` 风格下新增一个 mock-only 的"跳过覆盖"开关（如 `/sim/state` 里 `mappingCoverageSkip: boolean`，默认关闭），开启后 mock 侧在 `dispatchMapping` 拦截 `MAP_BOUNDARY_DONE` 后不再自动流转 COVERAGE，仅用于并行验证新 UI，主线仍以镜像同步后的真实分支为准。
- **建图完成 120s 倒计时**：DVT 明确"以设备端为权威，App 仅展示"。mock 需要：
  - 在建图完成态下，通过 `NOTIFY_RATEL_STATUS` 或 `RATEL_MAPPING_TASK` 推送携带 `countdown_seconds` 剩余值（新增字段，需与 App/后端确认协议字段名，纳入 §1.4 待确认事项）。
  - 支持 `/sim/event` 手动推进/清零倒计时，便于测试"倒计时结束自动保存"与"用户提前点击结束"两条路径。
  - App 断线重进时，`/ratel/api/v1/mapping/status`（recovery 查询）需要能返回当前剩余倒计时，验证 reconcile 逻辑。
- **沿边丢失（独立于寻边失败）**：待 App 新增 `MAP_FOLLOW_BOUNDARY_LOST` phase 并同步后，mock 新增对应 fault 预设 `mapping_boundary_lost.json`，复用现有 `mapping_estop.json` 风格（`setup.domain=mapping` + 目标 phase）。
- **多草坪"开始/完成"按钮机器信号**（figma §5.5 两处强联调依赖）：
  - "开始"按钮激活 = 机器离开旧草坪区域 **且** 机器端信号到达。mock 侧在 `/ratel/api/v1/mapping/add_lawn` 前置状态中新增可配置字段（暂定 `grass_recognized: 0/1`，与 App/算法确认真实字段名后对齐），可通过 `/sim/event` 或 fault 手动切换 0→1，驱动 App 按钮态联调。
  - "闭合边界/完成"按钮激活 = 可闭合信号。复用现有 `region_closure` 语义，确认是否需要新增独立 `closeable: 0/1` 状态位（当前 `region_closure` 是"是否已闭合"的结果字段还是"是否可闭合"的前置信号，需与 App 侧对齐，纳入待确认事项）。
  - 退桩失败兜底：新增 fault `mapping_undock_failed.json`，模拟退桩阶段失败态，供 App 测试重试/退出兜底 UI。

#### 模块 C：割草参数口径 + 选区/沿边独立参数（对应 DVT M1-M6）

- **参数范围校验**：`ratel_task/create` 接口新增服务端校验（mock 侧模拟真实后端会做的边界拒绝行为）：
  - `mow_height`：15–100mm，步进 10mm，默认 60（含 20→15 特例：允许序列 `...30,20,15`）。
  - `mow_speed`：0.3–1.0 m/s，步进 0.1，默认 0.6。
  - `texture.bow_shaped_spacing`：200–350mm，步进 10，默认 350。
  - 智能交替角度：`intelligent_alternation_mode` 为 true 时，角度取值 `180|90|45`，默认 180，默认整体开启。
  - 越界请求返回 `code≠200` + 错误描述，供 App 测试参数校验失败路径。
- **强劲模式**：`task_info` 新增 `boost_mode: boolean`（替代"静音模式"语义），默认 `false`。
- **选区/沿边独立参数**：`task_info.area_id: string[]` 已有，DVT 要求"每个选区参数独立"。需要将 `mow_height/mow_speed/texture` 从"任务级单一对象"扩展为"可选的按 `area_id`/`edge_id` 覆盖表"，例如新增 `zone_params: [{area_id, mow_height, mow_speed, texture}]` / `edge_params: [...]`（具体字段名需与 App/后端接口团队对齐，纳入待确认事项）。mock 侧需相应扩展 fixture 与响应回显（`ratel_task/list` 需原样回显该结构）。
- **运行中限制**：`ratel_task/action` 校验——`RESUME`/运行中修改仅允许 `mow_speed` + `boost_mode`，其余参数字段变更需先 `PAUSE`，否则 mock 返回错误码，供 App 联调"运行中仅可改速度/强劲模式"约束。
- **虚拟/实景切换**：`GET /sim/assets/full_rgbmap.png` 已可支持，需确认接口层是否需要一个显式的"实景数据是否已生成"状态位（对应 rustkit `openRgbMap` 触发条件），新增到 `/ratel/api/v1/mapping/status` 或地图详情返回。

#### 模块 D：异常体系细分（对应 DVT X1-X8）

现状只有通用 `DEVICE_ERROR`/`work_status:error` 与模拟器扩展的 `ESTOPPED`。DVT 要求抬起/侧倾/侧翻/卡困/定位丢失独立建模，且抬起触发"终止任务+不续任务"，其余支持"重定位后续任务"。

- **新增 `sub_status` 枚举值**（在 mock 侧 `NOTIFY_RATEL_STATUS` 推送中先行落地，作为 App/后端对齐前的契约草案）：
  - `lifted`（抬起，防盗语义，终止任务不续）
  - `tilted` / `rollover`（侧倾/侧翻，需重定位续任务）
  - `stuck_wheel_slip`（卡困-打滑不可动）/ `stuck_movable`（卡困-可遥控脱困）
  - `localization_lost`（定位丢失）
- **`extend_status.locator_status` 复用**：现有接口文档已定义 `locator_status: 0 none/1 normal/2 relocating/3 failed`，mock 需要在对应异常 fault 触发后正确流转该字段（触发异常→`failed`→App 发起重定位→`relocating`→成功`normal`/失败`failed`），支撑"重定位中弹窗不可关"UI 联调。
- **新增 fault 预设**（每类异常一个，各自独立可重放）：
  - `error_lifted.json`（work_status:error, sub_status:lifted, 任务强制转 CANCELLED）
  - `error_tilted.json` / `error_rollover.json`（转 ERRORED + locator_status:failed）
  - `error_stuck_slip.json` / `error_stuck_movable.json`
  - `error_localization_lost.json`
  - 对应恢复场景（`relocate_success.json`/`relocate_failed.json`）驱动 `locator_status` 流转，用于验证"重定位成功续任务/失败兜底"。
- **按键组合解除急停**：DVT 三套语义（双击OK / 割草+OK / 回充+OK）目前设备是通过物理按键触发，App 是被动接收。mock 侧对应能力：`/sim/event` 支持模拟"设备端按键触发"事件（如 `type: DEVICE_KEY_RESET, variant: double_ok|mow_ok|recharge_ok`），推送对应 `NOTIFY_RATEL_STATUS` 变化，让 App 验证被动接收与页面联动，而非本地臆测。
- **低电量前置拦截**：`ratel_task/create` 新增校验——电量 <20% 时直接拒绝创建割草任务，返回明确错误码/消息；同时区分三种触发来源（`task_notify.task_type: cloud`（App弹窗）/`button`（设备按钮→App消息）/`schedule`（割草计划→App消息，待模块 E 落地后启用），不同来源需对应不同 mock 提示文本，通过 fixture 可配置。
- **雨天自动回充**：新增设备侧"雨量传感器"状态位（如 `extend_status.rain_status: none|raining|wet_wait`），配合"雨后重启等待时长"（App 侧设置项，mock 只需在 `/sim/event` 支持推送该状态变化，并在等待时长内拒绝/暂停新割草任务下发）。移除天气预报相关字段（DVT v2 已删除该条件，mock 不引入）。
- **勿扰模式拦截建图/割草**：mock 侧新增全局"勿扰时段"模拟状态（`/sim/state` 可查看/设置当前是否处于勿扰时段），`ratel_mapping_task/create` 与 `ratel_task/create` 在勿扰时段内返回明确拒绝码，供 App 验证二次确认文案与建图拦截逻辑。

#### 模块 E：割草计划（对应 DVT N1，全新模块）

DVT v2 明确"计划在机器本地执行，App 仅同步最近 7 天"。mock 侧新增：

- **HTTP**：
  - `POST /ratel/central-control-service/api/v1/ratel_mow_plan/list`（查询最近 7 天计划，分页）
  - `POST /ratel/central-control-service/api/v1/ratel_mow_plan/create|update|delete`（App 侧编辑计划，同步到"设备本地"）
  - `POST /ratel/central-control-service/api/v1/ratel_mow_plan/sync`（模拟设备端计划回传，供 App 拉取最新 7 天执行记录）
  - 冲突校验：新增/编辑计划时若与已有计划时段重叠，返回明确错误。
- **WS**：新增 `NOTIFY_MOW_PLAN_TRIGGERED`，模拟到点自动触发割草任务（同时驱动 `NOTIFY_MOW_STATUS`），并支持"与正在执行任务冲突→本次跳过"分支（fault 可配置）。
- **Fixture**：`fixtures/mowPlan/plans.jsonc`（默认周日–周六全年重复表 + 开关）、`fixtures/mowPlan/execution_log.jsonc`（近 7 天执行记录样例）。
- **Fault**：`mow_plan_conflict_with_running_task.json`、`mow_plan_trigger_success.json`。

#### 模块 F：OTA（对应 DVT N2，全新模块）

- **HTTP**：
  - `GET/POST .../ota/version`（版本查询：当前版本、可升级版本、强制/提醒标志、发布规则灰度命中结果）
  - `POST .../ota/precheck`（升级自检：在桩 + WiFi 正常）
  - `POST .../ota/download/start|action`（下载进度：轮询或 WS 推送百分比/剩余时间）
  - `POST .../ota/install`（安装，不可取消）
  - `GET .../ota/records`（升级记录）
- **WS**：新增 `NOTIFY_OTA_STATUS`（下载中/安装中/完成/失败进度推送）。
- **状态位**：设备工作状态需要能置为 `upgrading`（`RatelRunState` 已有此枚举值，mock 侧目前仅占位，需要接通），并在此状态下让割草/建图任务创建接口返回"设备升级中，无法执行任务"的拒绝响应。
- **Fault**：`ota_forced_upgrade.json`（模拟强制升级标志，供 App 验证"进插件必须先升级"全局拦截）、`ota_download_fail.json`。

#### 模块 G：设备日志 + 耗材保养（对应 DVT N3/N4，全新模块）

- **HTTP**：
  - `POST .../device_log/summary`（累计看板：面积/时长/次数）
  - `POST .../device_log/list` + `.../device_log/detail`（单次任务日志列表 + 详情，含地图回放引用）
  - `POST .../maintenance/status`（刀片剩余寿命 1800min 阈值、机身保养 12000min 阈值、4G/NRTK 套餐到期时间）
  - `POST .../maintenance/sharpen`（磨刀开关/自动磨刀开关下发）
- **Fixture**：`fixtures/deviceLog/summary.jsonc`、`fixtures/deviceLog/tasks.jsonc`、`fixtures/maintenance/status.jsonc`，均可配置逼近阈值的数值（如刀片剩余 50min）以测试临界提示。

#### 模块 H：NRTK 设备信息与套餐（对应 DVT 多处 v2 新增）

- `courtyard/robot/detail` 响应扩展 `signals.nrtk: {connected, coverage, signal_strength}`。
- `NOTIFY_RATEL_STATUS` 的 `signals` 对象同步新增 `nrtk` 子对象（与蓝牙/WiFi/蜂窝并列）。
- `maintenance/status` 增加 NRTK 套餐到期时间字段（仅展示）。
- Fault：`nrtk_signal_bad.json`、`nrtk_expired.json`。

#### 模块 I：地图编辑对齐（对应 DVT E1-E5）

- **`base_version` 冲突仲裁**：`semantic/save` 当前仅自增版本号，需新增校验——请求体 `base_version` 与服务端当前版本不一致时返回冲突错误码（模拟真实后端的乐观锁行为），供 App 侧 `decideSaveStrategy` 联调"仅保存/保存并切换"弹窗与冲突提示。
- **边界微调可调范围**：地图详情响应新增 `adjustable_ranges`（算法回传的可调范围数据结构，字段名待与算法组对齐，纳入待确认事项），mock 侧提供 fixture 化的示例范围数据。
- **分割/合并**：现有 `increments` 结构（`element_id/type/action/shape/points/properties/source`）已足够承载，无需新增字段，仅需在 fixture 里补充分割线/合并结果的示例数据供前端联调视觉。
- **面积换算来源**：确认地图列表/详情响应中 `lawn_area`（`map_header.lawn_area`，已有）作为面积权威来源，mock 侧补充英制换算前的"公制原始值"文档说明，换算逻辑留给 App 侧统一 formatter，不在 mock 里做单位转换。

### 1.3 Fixture / Fault / Scenario 命名规范（新增部分统一约定）

| 类别 | 目录 | 命名规则 |
|---|---|---|
| 建图自检失败 | `fixtures/faults/mapping_check_*.json` | `mapping_check_<item>_<state>.json` |
| 异常体系 | `fixtures/faults/error_*.json` | `error_<subtype>.json` |
| 恢复/重定位 | `fixtures/faults/relocate_*.json` | `relocate_<result>.json` |
| 割草计划 | `fixtures/faults/mow_plan_*.json` | — |
| OTA | `fixtures/faults/ota_*.json` | — |
| NRTK | `fixtures/faults/nrtk_*.json` | — |
| 新场景 YAML | `scenarios/<domain>_<case>.yaml` | 与现有 `mapping_happy_auto.yaml` 风格一致，附机读 `guide` 块 |

所有新增 fault/scenario 需在 `GET /sim/faults`、`GET /sim/scenarios`、面板（`/sim/panel`）自动可见（现有机制已支持目录扫描，无需改面板代码，仅需按规范放文件）。

### 1.4 待确认事项（需与 App / 算法 / 后端团队对齐，先在 mock 里占位实现）

1. 建图完成 120s 倒计时的协议字段名（推送在哪个 cmd、字段名）。
2. "添加起点"草地识别信号、"闭合边界/开始"按钮可达信号的正式字段名（figma §5.5、DVT §5.7 联调依赖 1/2）。
3. 抬起/侧倾/侧翻/卡困/定位丢失的正式 `sub_status`/`work_msg` 编码（本方案中的枚举值为占位草案）。
4. 选区/沿边独立参数的请求体字段名（`zone_params`/`edge_params` 为占位命名）。
5. 边界微调"可调范围"数据结构（来自算法回传）。
6. 割草计划、OTA、设备日志、耗材保养、NRTK 的正式接口路径与字段（本方案路径为占位草案，需按后端团队最终定稿的接口文档调整）。
7. `base_version` 冲突时后端期望的具体错误码/响应结构。

> 这些占位字段一旦后端/算法团队定稿，需要回来更新本文档 §1.4 及对应 fixture/路由实现，并同步 `docs/api.md`。

---

## 2. 落地方案

### 2.1 分期节奏（对齐 DVT §7 优先级建议）

| 梯队 | 内容 | 目标时间 |
|---|---|---|
| 第一梯队（P0，阻塞主流程联调） | 模块 A（自检+NRTK）、模块 B 的可先行部分（多草坪信号、退桩失败、倒计时占位）、模块 C（参数口径+校验）、模块 D 的 X1/X2/X6（抬起/重定位/低电前置） | 2026-07-15 前完成，配合 App 提测 |
| 第二梯队（P0/P1） | 模块 E（割草计划）、模块 F（OTA）、模块 G（设备日志/保养）、模块 D 剩余（雨天/勿扰）、模块 I（地图编辑 base_version） | 2026-07-15 ~ 2026-07-31 |
| 第三梯队（P1/P2） | 模块 H（NRTK 细节）、隐藏需求收尾（自检超时态、命名校验等）、文档与埋点相关 mock 支撑 | 2026-08-01 ~ 2026-08-15 验收前 |

### 2.2 详细工作项

#### 第一梯队

| # | 工作项 | 涉及文件 | 依赖 |
|---|---|---|---|
| W1 | `check_conditions.jsonc` 新增 `nrtk_status`/`nrtk_msg`；`mappingCheck.builder.ts` 拼装第 6 项 | `fixtures/mapping/check_conditions.jsonc`、`src/http/routes/mappingCheck.builder.ts` | — |
| W2 | 核实并修正电量阈值判定为 ≥50%（若现有阈值非 50%） | `src/http/routes/mappingCheck.builder.ts` 或电量派生逻辑所在文件 | — |
| W3 | 新增 5 个自检失败 fault 预设（battery/bluetooth×3/network/nrtk/not_on_dock） | `fixtures/faults/mapping_check_*.json` | W1 |
| W4 | 自检超时模拟：确认 chaos 延迟可覆盖 self_check/mapping_check 两接口，必要时新增 `mapping_check_timeout.json` | `fixtures/faults/`、`src/sim/chaos.ts` | — |
| W5 | 建图完成倒计时占位字段：`RATEL_MAPPING_TASK`/`NOTIFY_RATEL_STATUS` 新增 `countdown_seconds`（占位字段名，待确认后可改名） | `src/sim/pushChannels.ts`、`src/sim/task/MappingTaskService.ts` | 待确认事项#1 |
| W6 | 多草坪按钮信号占位字段：`add_lawn`/`mapping/manual` 响应及状态查询新增 `grass_recognized`/`closeable` 占位字段 + `/sim/event` 手动切换支持 | `src/http/routes/mapping.routes.ts`、`src/sim/virtualRobotCore.ts` | 待确认事项#2 |
| W7 | 退桩失败 fault：`mapping_undock_failed.json` | `fixtures/faults/` | — |
| W8 | `ratel_task/create` 参数范围校验（高度/速度/纹理间距/角度枚举）+ `boost_mode` 字段 | `src/http/routes/task.routes.ts` | — |
| W9 | 选区/沿边独立参数占位字段 `zone_params`/`edge_params` 透传与回显 | `src/http/routes/task.routes.ts`、`src/sim/task/MowingTaskService.ts` | 待确认事项#4 |
| W10 | 运行中参数变更限制校验（仅允许 speed+boost_mode） | `src/http/routes/task.routes.ts` | W8 |
| W11 | 异常体系 fault：`error_lifted.json`（终止不续）、`error_tilted.json`、`error_rollover.json`、`error_stuck_slip.json`、`error_stuck_movable.json`、`error_localization_lost.json` | `fixtures/faults/` | 待确认事项#3 |
| W12 | 重定位流程：`locator_status` 流转 + `relocate_success.json`/`relocate_failed.json` | `fixtures/faults/`、`src/sim/ratelStatusPush.ts` | W11 |
| W13 | 按键组合解除急停模拟：`/sim/event` 支持 `DEVICE_KEY_RESET` 变体事件 | `src/http/routes/sim.routes.ts`、`src/sim/virtualRobotCore.ts` | — |
| W14 | 低电前置拦截：`ratel_task/create` 电量<20% 拒绝 + 三种触发来源文案区分 | `src/http/routes/task.routes.ts` | — |

#### 第二梯队

| # | 工作项 | 涉及文件 |
|---|---|---|
| W15 | 割草计划模块：新增 `mowPlan.routes.ts` + fixture + `NOTIFY_MOW_PLAN_TRIGGERED` | `src/http/routes/mowPlan.routes.ts`（新建）、`fixtures/mowPlan/*`、`src/sim/pushChannels.ts` |
| W16 | OTA 模块：新增 `ota.routes.ts` + `NOTIFY_OTA_STATUS` + `upgrading` 状态接通 | `src/http/routes/ota.routes.ts`（新建）、`src/sim/pushChannels.ts`、`src/sim/virtualRobotCore.ts` |
| W17 | 设备日志/耗材保养模块：新增 `deviceLog.routes.ts`、`maintenance.routes.ts` + fixture | 新建路由文件 + `fixtures/deviceLog/*`、`fixtures/maintenance/*` |
| W18 | 雨天状态位 + 拦截逻辑 | `src/sim/pushChannels.ts`（`extend_status.rain_status`）、`src/http/routes/mappingTask.routes.ts`、`task.routes.ts` |
| W19 | 勿扰时段全局状态 + 建图/割草拦截 | `src/sim/virtualRobotCore.ts`（新增勿扰状态）、`src/http/routes/sim.routes.ts`（读写接口）、任务创建路由 |
| W20 | `semantic/save` base_version 冲突校验 | `src/http/routes/map.routes.ts` |
| W21 | 边界微调 `adjustable_ranges` 占位数据 | `src/http/routes/map.routes.ts`、`fixtures/maps/metadata.jsonc` |

#### 第三梯队

| # | 工作项 |
|---|---|
| W22 | NRTK 信号字段接入 `robot/detail` + `NOTIFY_RATEL_STATUS.signals.nrtk` + fault |
| W23 | 地图命名/校验相关 mock 侧无需改动，确认无遗漏 |
| W24 | 全量场景 YAML 补齐：新增模块对应的 happy-path scenario（`mow_plan_trigger.yaml`、`ota_upgrade_flow.yaml` 等） |
| W25 | 文档同步：`docs/api.md`、`docs/data-dictionary.md`、`docs/scenarios.md`、`README.md`、`docs/README.md` 索引更新 |

### 2.3 实施约定

- 每个工作项完成后运行 `npm run check-fixtures` + `npm test`，确保不破坏既有回归。
- 新增路由遵循 `src/http/router.ts` 现有注册模式（`RouteHandler` 数组尾部追加，保持 404 兜底不变）。
- 新增 WS 推送字段一律做**向后兼容的可选新增**，不修改/删除现有字段，避免破坏已联调通过的旧版 App。
- 状态机相关条目（模块 B 中标注"待 App 侧先行"）在 App 侧尚未完成同步前，mock 侧只做**接口占位 + 文档标注**，不抢先在 fsm-mirror 之外分叉一套并行状态机逻辑，避免后续同步冲突。

---

## 3. 测试方案

### 3.1 测试分层

| 层级 | 工具/方式 | 覆盖内容 |
|---|---|---|
| 单元测试 | `node --test`（`__tests__/*.test.ts`） | 新增路由的请求校验、fixture 加载、参数范围校验函数、base_version 冲突判定 |
| 集成/契约测试 | `__tests__/e2e/*.test.ts` | 新增 HTTP 接口的完整请求-响应链路；WS 新增 cmd 的推送时机与字段结构 |
| 场景回归测试 | `scenarios/*.yaml` + `ScenarioEngine` | 每个新模块至少 1 条 happy-path scenario + 关键异常分支 scenario |
| Fault 覆盖测试 | `POST /sim/fault {name}` 逐一调用 + 断言 `/sim/state` | 每个新增 fault 预设都能被独立触发且状态符合预期，互不干扰（触发 A 不残留影响 B） |
| 面板可用性验证 | 手动 + `GET /sim/panel` 走查 | 新场景/fault 在面板下拉列表可见、guide 可读、可一键运行 |
| Fixture 校验 | `npm run check-fixtures` | 所有新增 JSON/JSONC 语法与既有 schema 约定一致 |

### 3.2 分模块用例要点

- **模块 A（自检+NRTK）**：
  - 6 项全部通过 → `mapping/check` 返回全 `ok`，App 侧按钮应可点。
  - 分别使 6 项之一失败 → 其余保持 `ok`，验证细分文案字段正确（尤其蓝牙三种细分：未授权/未开启/超距离）。
  - 电量精确 49%/50%/51% 边界值 → 分别验证 fail/pass/pass。
  - 触发超时 fault → 验证接口在预期延迟后仍返回（或按约定超时无响应），供 App 侧验证 20s 超时兜底。
- **模块 B（建图流程）**：
  - 多草坪 `grass_recognized` 从 0→1 切换后，`add_lawn` 前置状态查询应反映按钮可点条件变化。
  - 退桩失败 fault 触发后，任务状态应进入约定的失败态，且可重试恢复正常退桩流程。
  - 倒计时字段：任务进入完成态后轮询/推送应看到 `countdown_seconds` 递减；`/sim/event` 手动清零后应立即触发保存/回充流转。
- **模块 C（割草参数）**：
  - 高度/速度/纹理间距分别测试下边界-1、下边界、上边界、上边界+1 四组值，验证越界拒绝、边界值接受。
  - 20mm→15mm 特例：构造从 20 递减的请求序列，验证接受 15 而非报错步进不符 10mm。
  - 选区任务：2 个 `area_id` 各自不同 `zone_params`，验证 `ratel_task/list` 回显与请求一致，互不覆盖。
  - 运行中变更：`PAUSE` 前尝试改 `mow_height` 应被拒绝，改 `mow_speed`/`boost_mode` 应被接受；`RESUME` 后再次尝试改高度仍应拒绝。
- **模块 D（异常体系）**：
  - `error_lifted` 触发后，验证进行中任务被强制 `CANCELLED` 且不进入续任务流程（对照 `error_tilted`/`error_rollover` 触发后允许重定位续任务的差异）。
  - 重定位链路：`error_tilted` → `locator_status:failed` → 手动推 `relocating` → 推 `normal` → 验证任务可恢复为 `RESUMING`/`WORKING`；另起一条推 `failed` 到底，验证走兜底话术分支。
  - 低电前置拦截：电量 19%/20%/21% 三组边界值分别测试 `ratel_task/create` 的拒绝/放行；分别用 `cloud`/`button`/`schedule` 三种来源触发，验证响应文案分支字段不同。
  - 雨天：推 `rain_status:raining` 后尝试创建割草/建图任务应被拒绝；等待设置的重启等待时长模拟到期后（`/sim/event` 手动推进）应恢复可创建。
  - 勿扰：设置勿扰时段开启 → 建图/割草任务创建均应返回拒绝码；关闭后应恢复正常。
- **模块 E/F/G（计划/OTA/日志保养）**：
  - 割草计划：创建重叠时段计划应报冲突；到点触发（`/sim/event` 模拟时间推进或直接触发事件）应产生 `NOTIFY_MOW_PLAN_TRIGGERED` + 对应任务创建；与正在执行任务冲突场景应被跳过且有相应记录。
  - OTA：`ota_forced_upgrade` fault 触发后，`ratel_mapping_task/create`/`ratel_task/create` 均应返回"设备升级中"拒绝；下载进度轮询/推送应从 0 递增到 100，安装阶段不可取消（校验对应 action 接口拒绝取消请求）。
  - 设备日志/保养：临界值 fixture（刀片剩余 <阈值）应在响应中标记告警状态，供 App 测试提醒 UI。
- **模块 H（NRTK）**：信号字段在 `robot/detail` 与 `NOTIFY_RATEL_STATUS` 中一致；`nrtk_signal_bad`/`nrtk_expired` fault 可独立触发。
- **模块 I（地图编辑）**：
  - `semantic/save` 提交与服务端当前 `base_version` 不一致 → 返回冲突响应；提交一致版本 → 正常保存并自增版本号。
  - 边界微调 `adjustable_ranges` 数据结构完整可解析。

### 3.3 回归与自动化要求

- 所有新增/修改的 HTTP 路由与 WS 推送必须有至少 1 条自动化测试（单元或 e2e），纳入 `npm test`。
- 新增 fault/scenario 需要在 CI（若有）或至少本地 `npm test` 前置检查中跑一遍 `check-fixtures`，避免语法错误合入。
- 建议新增一个汇总测试文件 `__tests__/dvt-adaptation.test.ts`，对本方案模块 A-I 的关键接口做一轮冒烟式断言，作为"DVT 适配是否完整"的单一回归入口。

---

## 4. 验收标准

### 4.1 总体验收标准

- [ ] 本方案 §2.2 中标注为**第一梯队**的全部工作项（W1-W14）已实现并通过对应测试用例，且已合入主分支。
- [ ] 第二梯队（W15-W21）在 2026-07-31 前完成，第三梯队（W22-W25）在 2026-08-15 验收前完成。
- [ ] `npm run check-fixtures`、`npm run lint`（`tsc --noEmit`）、`npm test` 全部通过，无既有回归破坏。
- [ ] `README.md`、`docs/api.md`、`docs/data-dictionary.md`、`docs/scenarios.md`、`docs/README.md` 索引已同步更新，反映所有新增接口/字段/fixture/scenario。
- [ ] `/sim/panel` 面板可见并可一键运行本方案新增的全部 scenario 与 fault，无需查看源码即可复现每个 DVT 分支。
- [ ] 本文档 §1.4"待确认事项"中，凡已由 App/算法/后端团队定稿的字段，均已回填并同步代码实现（未定稿的需在文档中保持"占位"标注，不得被误认为最终协议）。

### 4.2 分模块验收标准

| 模块 | 验收标准 |
|---|---|
| A 自检+NRTK | 6 项自检（含 NRTK）均可独立成功/失败；battery 阈值精确为 ≥50%；蓝牙失败文案区分未授权/未开启/超距离三态；超时场景可复现 |
| B 建图流程 | 多草坪按钮信号可通过 `/sim/event` 驱动 App 联调按钮态；退桩失败可复现且可恢复；倒计时字段存在并可推进/清零（协议字段名以 App/后端最终确认为准，若未确认则标注为占位） |
| C 割草参数 | 高度/速度/纹理间距/角度枚举校验生效，边界值与 20→15 特例通过；选区/沿边独立参数可正确回显；运行中变更限制生效 |
| D 异常体系 | 抬起/侧倾/侧翻/卡困(2种)/定位丢失均可独立触发且互不干扰；抬起终止不续、其余可重定位续任务的差异行为验证通过；低电<20%前置拦截三种来源均验证；雨天/勿扰拦截建图与割草均验证 |
| E 割草计划 | 计划 CRUD、冲突校验、到点触发、与正在执行任务冲突时跳过，均有对应场景可复现 |
| F OTA | 版本查询/自检/下载进度/安装不可取消/强制升级全局拦截/记录查询均可复现 |
| G 设备日志/保养 | 累计看板、单次日志详情、刀片/机身/4G/NRTK 阈值展示均有 fixture 可配置临界值 |
| H NRTK | 设备信息与状态推送中 NRTK 字段一致；信号异常/套餐到期 fault 可独立触发 |
| I 地图编辑 | `base_version` 冲突场景可复现（版本不一致时拒绝）；边界微调可调范围数据可返回；分割/合并示例数据可供前端联调 |

### 4.3 验收方式

1. **自动化验收**：运行 `npm test` 全量通过，作为准入门槛。
2. **人工走查验收**：按 §4.2 表格逐模块，在 `/sim/panel` 上手动触发对应 fault/scenario，配合 App 侧联调截图/录屏确认交互符合 DVT 指引描述。
3. **联调验收**：邀请 App 团队使用本 mock 完整走一遍 DVT §3.1 建图主流程闭环（含跳过覆盖建图、多草坪、异常兜底）与 §2.4 割草三模式闭环，确认无需修改 mock 代码即可完成端到端联调。
4. **文档验收**：由第二人 review 本文档与同步更新的 `docs/api.md` 等文件，确认"待确认事项"未被遗漏、已定稿字段已回填。

---

## 5. 风险与依赖

1. **状态机同步依赖 App 侧进度**：模块 B 中"跳过覆盖建图"“沿边丢失”等条目严格依赖 `pudu_ratel_app_mower` 完成 FSM 改动并允许同步镜像；若 App 侧延期，mock 侧对应工作项需要用"占位开关"方案（§1.2 模块 B 过渡期打样）先行支撑 UI 重写联调，待正式同步后再收敛。
2. **大量字段依赖后端/算法团队定稿**（§1.4 七项待确认事项）：mock 先用占位字段实现并在文档/代码注释中显著标注"占位，待确认"，避免 App 侧误以为是最终协议进行长期依赖。
3. **新增模块（计划/OTA/日志/保养/NRTK）无真实后端接口文档可依据**：当前 `APP端接口文档v3.md` 未覆盖这些模块，本方案中的路径/字段均为**基于 DVT 指引推断的草案**，需要在实施前尽快拉通后端接口团队确认真实路径与字段，避免返工。
4. **回归风险**：新增/修改的参数校验（如运行中变更限制、base_version 冲突）可能影响现有 e2e 测试对旧行为的假设，实施时需先跑一遍现有 `__tests__` 基线，逐项修正断言而非放宽校验掩盖问题。
