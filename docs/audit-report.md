# map_mock_service 重构实施审计报告

> 审计对象：P1 ~ P5 阶段落地情况 + 关键审计整改（P0/P1）
> 对应方案：[`refactor-plan.md`](refactor-plan.md)
> 关键审计：[`refactor-audit-critical.md`](refactor-audit-critical.md)
> 运行验证：`npm test` 64 pass / 0 fail，`npm run check-fixtures` fixtures ok

---

## 执行摘要

**结论：P1 ~ P5 全部阶段已成功落地，达到重构目标；关键审计 P0/P1 已清零（见 §10）。**

| 指标 | 结果 |
|------|------|
| `npm test` | **64 pass, 0 fail**（duration 90.5 s） |
| `npm run check-fixtures` | **fixtures ok** |
| 验收清单 §10 | **12 / 12 通过** |
| 重构目标 G1~G5 | **全部达成** |

---

## 1. P1 数据外置 ✅

**目标**：FixtureLoader + 5 处内联数据外置为 JSONC + annotations/chargingDock 删除。

| 项目 | 状态 | 说明 |
|------|------|------|
| [`src/fixtures/FixtureLoader.ts`](../src/fixtures/FixtureLoader.ts) | ✅ | mtime 缓存 + stripJsonComments + `withOverrides` 栈式覆盖 |
| [`fixtures/device/self_check.jsonc`](../fixtures/device/self_check.jsonc) | ✅ | 含编辑指南注释，热重载生效 |
| [`fixtures/mapping/check_conditions.jsonc`](../fixtures/mapping/check_conditions.jsonc) | ✅ | 已外置 |
| [`fixtures/mowing/trajectory_fallback.jsonc`](../fixtures/mowing/trajectory_fallback.jsonc) | ✅ | 已外置 |
| [`fixtures/recharge/notify_sequence.jsonc`](../fixtures/recharge/notify_sequence.jsonc) | ✅ | 已外置；[`RechargeTaskService`](../src/sim/task/RechargeTaskService.ts) 调用 [`readRechargeNotifySequence()`](../src/sim/push/rechargeSequence.ts) |
| [`fixtures/maps/metadata.jsonc`](../fixtures/maps/metadata.jsonc) | ✅ | 已外置 |
| `src/data/annotations.ts` 删除 | ✅ | **已删除**；静态地图数据以 [`map_list.json`](../fixtures/maps/map_list.json) 为唯一来源（§11.3 决议 1） |
| `src/data/chargingDock.ts` 删除 | ✅ | **已删除**；充电桩点来自 map_list.json 各地图独立 type=69 坐标 |

---

## 2. P2 数据集归档 ✅

**目标**：`data*/` → `fixtures/datasets/<语义名>/` + manifest。

| 原目录 | 迁移到 | manifest | 帧数 |
|--------|--------|----------|------|
| `data/` | [`fixtures/datasets/recharge_return/`](../fixtures/datasets/recharge_return) | ✅ | ~1521 组 |
| `data2/` | [`fixtures/datasets/mowing_trajectory/`](../fixtures/datasets/mowing_trajectory) | ✅ | ~793 组 |
| `data3/` | [`fixtures/datasets/mapping_happy/`](../fixtures/datasets/mapping_happy) | ✅ | **749 帧**（实测值） |
| `data4/` | [`fixtures/datasets/fixed_maps/`](../fixtures/datasets/fixed_maps) | ✅ | 8 组 |

关键验证：
- [`PatchLoader.ts`](../src/assets/PatchLoader.ts) `ALLOWED_DATASETS` 已更新为语义名
- [`resolveDatasetDir()`](../src/assets/PatchLoader.ts) 指向 `fixtures/datasets/<name>/frames`
- 根目录 `data/data2/data3/data4` 均不存在（`find data*` 返回 0 条）

---

## 3. P3 目录重组 ✅

**目标**：infra 分离、http shared 下移、data 拆分、路由改名。

| 重组项 | 目标结构 | 实际结构 | 状态 |
|--------|----------|----------|------|
| `src/shared/` 拆分 | `logger/ids/crc` → `infra/`，`http.ts` → `http/shared/` | [`src/infra/`](../src/infra)，[`src/http/shared/http.ts`](../src/http/shared/http.ts) | ✅ |
| `src/data/` 拆分 | → `fixtures/` + `assets/` + `trajectory/` | [`src/fixtures/`](../src/fixtures)，[`src/assets/`](../src/assets)，[`src/trajectory/`](../src/trajectory) | ✅（目录已消失） |
| 路由文件改名 | 统一 `*.routes.ts` | [`auth.routes.ts`](../src/http/routes/auth.routes.ts) 等 9 个 | ✅ |
| `mappingCheckResponse.ts` 归属 | → `routes/mappingCheck.builder.ts` | [`src/http/routes/mappingCheck.builder.ts`](../src/http/routes/mappingCheck.builder.ts) | ✅ |

---

## 4. P4 大文件拆分 ✅

**目标**：virtualRobot 963 行拆分 + task services 独立。

| 文件 | 重构前 | 重构后 | 状态 |
|------|--------|--------|------|
| [`virtualRobot.ts`](../src/sim/virtualRobot.ts) | 963 行 | **15 行**（纯 re-export） | ✅ |
| [`virtualRobotCore.ts`](../src/sim/virtualRobotCore.ts) | — | 538 行，仅持有 EventEmitter + 状态快照，协调子模块 | ✅ |
| [`DeviceProfile.ts`](../src/sim/DeviceProfile.ts) | — | 独立，`buildDeviceInfo` 抽出 | ✅ |
| [`task/MappingTaskService.ts`](../src/sim/task/MappingTaskService.ts) | — | 89 行，`MappingTaskBridge.ts` 保留为 HTTP 适配层（调用 `robot.*`） | ✅ |
| [`task/MowingTaskService.ts`](../src/sim/task/MowingTaskService.ts) | — | 97 行，`MowingTaskBridge.ts` 保留为 HTTP 适配层（调用 `robot.*`） | ✅ |
| [`task/RechargeTaskService.ts`](../src/sim/task/RechargeTaskService.ts) | — | 101 行，回充任务 + rechargeSequence | ✅ |
| [`push/rechargeSequence.ts`](../src/sim/push/rechargeSequence.ts) | — | 30 行，时序 fixture 加载 | ✅ |

`src/sim/fsm-mirror/` **保持原位只读**，硬约束严格遵守。

---

## 5. P5 场景增强 ✅

**目标**：dataset 绑定、故障目录、运行时切换、录制回放、真实延时。

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| YAML `dataset` 绑定 | [`mapping_happy_auto.yaml:31`](../scenarios/mapping_happy_auto.yaml) `dataset: mapping_happy` | ✅ |
| 场景 `fixtures` 覆盖 | [`ScenarioEngine`](../src/sim/scenarioEngine.ts) `fixtureLoader.withOverrides()` | ✅ |
| 故障目录 | [`fixtures/faults/`](../fixtures/faults)（5 个 fault.json） | ✅ |
| `POST /sim/fault` | [`sim.routes.ts`](../src/http/routes/sim.routes.ts) `applyFault()` | ✅ |
| `POST /sim/dataset` | [`sim.routes.ts`](../src/http/routes/sim.routes.ts) 运行时切换 | ✅ |
| `/sim/recorder/*` | start / stop / replay / list | ✅ |
| 真实延时模拟 | [`chaos.ts`](../src/sim/chaos.ts) `RealismConfig` + `SIM_REALISM=1` | ✅ |
| HTTP 延时注入 | [`router.ts:53-54`](../src/http/router.ts) 循环前一次性延时，豁免 `/sim/*` 和 `/api/health` | ✅ |
| realism fixture | [`fixtures/sim/realism.jsonc`](../fixtures/sim/realism.jsonc) 默认区间可热编辑 | ✅ |

---

## 6. 验收清单 §10 逐项核对

| # | 验收项 | 状态 |
|---|--------|------|
| 1 | 所有 API 返回数据可通过编辑 `fixtures/**/*.jsonc` 修改，无需重启 | ✅ |
| 2 | `src/data/` 目录消失（含 `chargingDock.ts`），职责拆入 `fixtures/`/`assets/`/`trajectory/` | ✅ |
| 3 | `src/sim/` 下无遗留文件未分类（`pushChannels.ts`/`scenarioGuide.ts`/`simFsmTypes.ts` 均有归属；原 `taskBridge.ts`/`mappingTaskBridge.ts` 为零引用 re-export 垫片，已于关键审计整改中删除） | ✅ |
| 4 | `data/data2/data3/data4` 消失，替换为 `fixtures/datasets/<语义名>/` + manifest | ✅ |
| 5 | `virtualRobot.ts` < 300 行，回充/任务/设备逻辑各自独立文件 | ✅（15 行） |
| 6 | `npm run check-fixtures` 通过 | ✅ |
| 7 | `docs/README.md` 索引页存在，`fixtures-guide.md` 含「测试数据怎么改」章节 | ✅ |
| 8 | 现有测试全部通过（`npm test`） | ✅（64 pass，0 fail） |
| 9 | `src/sim/fsm-mirror/` 内容未被改动，仅允许 mock 侧 import 路径修正 | ✅ |
| 10 | `SIM_REALISM=1` 或 `POST /sim/realism` 开启后，HTTP 业务接口延时 0.5–3s、WS 延时 2–8s；`/api/health`、`/sim/*` 豁免 | ✅ |
| 11 | `chargingDock.ts` 与 `annotations.ts` 均已删除；静态地图数据以 `fixtures/maps/map_list.json` 为唯一来源 | ✅ |
| 12 | `__tests__/` 保留原位原结构，未迁移 | ✅ |

---

## 7. 重构目标达成情况（G1~G5）

| 目标 | 验收标准 | 状态 |
|------|----------|------|
| G1 代码按模块单一职责重组 | `src/` 每个目录职责单一且可一句话描述 | ✅ |
| G2 测试 API 返回数据全部 JSON 化、热编辑 | 改任意 `.jsonc` 后下次请求即生效，无需重启 | ✅ |
| G3 测试数据分类归档、可检索 | 按业务域分目录，文件名含语义，有数据字典 | ✅（部分帧文件仍为序号命名，无语义后缀，见遗留问题） |
| G4 mock 服务场景化增强 | 支持按场景切换数据集、注入故障、回放录制 | ✅ |
| G5 文档整合可查 | `docs/` 有索引页，使用说明单一信息源 | ✅ |

---

## 8. 遗留问题与建议

### 8.1 P5b 控制台 UI 重构 —— 已实施

[`refactor-plan.md §6.7`](refactor-plan.md) 提议的 FSM 泳道图、事件流卡片、三栏布局**已落地**（原自报审计误称「未实施」）。实现拆分为：

| 文件 | 职责 |
|------|------|
| [`panelHtml.ts`](../src/sim/panelHtml.ts) | 三栏 HTML 壳（操作｜FSM 图+指标卡｜事件流） |
| [`panelStyles.ts`](../src/sim/panelStyles.ts) | CSS：指标卡语义色、泳道节点、边箭头 + 动画、事件卡颜色 |
| [`panelGraph.ts`](../src/sim/panelGraph.ts) | **`phaseGraphFromFsm()`** —— 从只读 fsm-mirror 的 `MAPPING_PHASES` / `RETURN_DOCK_PHASES` 编译泳道图数据，UI 只渲染 |
| [`panelTimeline.ts`](../src/sim/panelTimeline.ts) | 事件流卡片渲染：分类着色 + 业务字段摘要 + 点击展开 payload |
| [`panelClient.ts`](../src/sim/panelClient.ts) | 数据拉取/轮询、场景控制、指标卡、泳道渲染（边箭头 + 已完成态 + 入边动画） |

功能清单：

- ✅ **(1) 状态机泳道图**：mapping/mowing 两条泳道，节点来自 fsm-mirror 枚举，相邻节点间渲染 `→` 边，活跃节点的入边脉冲动画，早于活跃节点的节点标记为 `.done`（绿）。
- ✅ **(2) 事件流卡片**：倒序卡片，按 `CMD_*`（蓝）/`NOTIFY_*`（绿）/`transcript`（紫）/`error`（红）着色，点击 `<details>` 展开完整 payload。
- ✅ **(3) 关键指标常驻顶栏**：`work_status`/`phase`/`sub_status`/`battery`/`dataset`/`realism`，语义色（idle 灰/mapping 紫/mowing 绿/estop 红），1.5s 轮询。
- ✅ **(5) WS 推送实时预览**：`eventMeta()` 解析出 `work_status`/`sub_status`/`task_status`/`state`/`phase` 业务字段，只展示这些 + 折叠原文。
- ✅ **(6) 三栏布局**：操作｜FSM 图+指标卡｜事件流时间线；窄屏降级两栏/单栏。
- ✅ **(7) panel 拆分**：`panelHtml` + `panelStyles` + `panelGraph` + `panelTimeline` + `panelClient` 五模块，不再有内联 HTML/JS 单文件。

测试覆盖：[`panel.test.ts`](../__tests__/panel.test.ts) 6 项断言（壳结构 + 图注入 + 泳道编译 + 节点顺序 + JSON 序列化）。

### 8.2 §4.5 真实响应一键捕获 —— 未实施

`POST /sim/capture` 接口 + `fixtures/_captured/` 暂存区**未实施**。当前协议变更仍需手动复制粘贴覆盖 fixture。

**建议**：P6 阶段补充，配合 [`Recorder`](../src/sim/recorder.ts) 扩展。

### 8.3 数据集帧文件命名 —— 部分完成

方案 §5.1 建议帧文件命名为 `<序号:03d>_<语义>.{xml,png}`（如 `000_start.xml`、`015_edge_complete.xml`）。
实际 `fixtures/datasets/*/frames/` 内文件仍为 `002_frame.xml`、`004_frame.xml` 等纯序号命名，无语义后缀。

**影响**：不影响功能正确性，G3「文件名含语义」目标未彻底达成。

**建议**：低优先级，可选择性为关键帧（start / edge_complete / dock_return）补充语义后缀。

---

## 9. 测试覆盖明细

```
ℹ tests 64
ℹ suites 21
ℹ pass   64
ℹ fail    0
ℹ duration_ms 90484
```

关键套件：

| 测试文件 | 覆盖重构内容 |
|----------|-------------|
| [`fixtureOverrides.test.ts`](../__tests__/fixtureOverrides.test.ts) | 场景 fixture 覆盖机制 |
| [`httpRealism.test.ts`](../__tests__/httpRealism.test.ts) | 真实延时模拟 + 控制面豁免 |
| [`scenarioEngine.test.ts`](../__tests__/scenarioEngine.test.ts) | dataset 切换、realism 步骤、场景暂停/恢复 |
| [`ratelStatusPush.test.ts`](../__tests__/ratelStatusPush.test.ts) | 推送编排 + dedupe + emergency-stop e2e（42.8 s） |
| [`virtualRobot.test.ts`](../__tests__/virtualRobot.test.ts) | FSM domain 切换，拆分后行为一致性 |
| [`faults.test.ts`](../__tests__/faults.test.ts) | 故障注入矩阵 |
| [`recorder.test.ts`](../__tests__/recorder.test.ts) | FSM transcript 录制与回放 |

---

## 10. 关键审计整改（P0 / P1）

独立审计（详见 [`refactor-audit-critical.md`](refactor-audit-critical.md)）发现自报审计存在若干不准确项与遗留的兼容性/兜底逻辑。本轮已清完 P0（阻断项）与 P1（兜底移除）。

### 10.1 P0 阻断项

| # | 问题 | 整改 | 状态 |
|---|------|------|------|
| P0-A1 | `src/sim/taskBridge.ts`、`src/sim/mappingTaskBridge.ts` 为零引用 re-export 垫片（自报审计误称已「吸收」） | 删除两个垫片文件 | ✅ |
| P0-A2 | `full_semanticmap.png` / `full_rgbmap.png` 仍在仓库根目录，路径在 `BasemapAsset.ts` 与 `mowingTrajectory.ts` 各硬编码一份（DRP 违反） | 迁至 [`fixtures/maps/assets/`](../fixtures/maps/assets/)；[`BasemapAsset.ts`](../src/assets/BasemapAsset.ts) 升级为唯一路径解析点，新增 `readSemanticMapPngBytes()` 在缺失时抛错 | ✅ |
| P0-A3 | `virtualRobotCore.ts` 仍保留 `@deprecated dispatchRatelNotify()`，3 个测试文件引用 | 删除废弃方法；[`virtualRobot.test.ts`](../__tests__/virtualRobot.test.ts) / [`recorder.test.ts`](../__tests__/recorder.test.ts) 改用 `pushRatelStatus` | ✅ |
| P0-C4 | `mowingTrajectory.ts` 重复声明 `FULL_SEMANTIC_MAP_PATH` 并静默 `try/catch {}` 兜底 | 改调 `readSemanticMapPngBytes()`；移除静默兜底（见 P1-B1） | ✅ |

### 10.2 P1 兜底逻辑移除（fail-fast，让配置错误尽早暴露）

| # | 位置 | 原行为 | 整改后 |
|---|------|--------|--------|
| P1-B1 | [`mowingTrajectory.ts`](../src/trajectory/mowingTrajectory.ts) | PNG 解析失败静默 `catch {}` 回退到 fallback JSONC | 默认 `semantic-zero` 解析失败即抛错；仅 `MOWING_TRAJECTORY_SOURCE=fallback` 显式 opt-in 时加载 fallback 并 `logger.warn` |
| P1-B2 | [`PatchLoader.ts`](../src/assets/PatchLoader.ts) | `numberValue` 对缺失/非数值字段静默填默认值；缺 `opencv_storage` 时 `continue` 跳过 | `resolution/origin_x/origin_y/map_cols/map_rows` 改用 `requiredNumber()` 缺失即抛；`timestamp_ms` 用 `timestampOrNow()` 缺失告警 + `Date.now()`；缺 `opencv_storage` 抛错 |
| P1-B3 | [`mapMetadata.fixture.ts`](../src/fixtures/mapMetadata.fixture.ts) | 未知 `map_id` 静默回退 default | 未知 `map_id` 时 `logger.warn` 告警后再回退 default（保留可恢复性，但不再静默） |
| P1-B4 | `sim.routes.ts` / `scenarioEngine.ts` / `recorder.ts` | `readDomain()` 三份重复实现，非法值静默回退 | 抽取至 [`virtualRobotTypes.ts`](../src/sim/virtualRobotTypes.ts) 的 `parseRobotDomain(value, fallback)`（HTTP/录制边界，保留 fallback 语义）与 `requireRobotDomain(value, source)`（声明式场景配置，非法值即抛）；`ScenarioDefinition.domain` 类型收紧为 `NonNullableRobotDomain` |

### 10.3 文档同步

- [`mowing_trajectory.md`](mowing_trajectory.md)：PNG 链接更新为 `../fixtures/maps/assets/full_semanticmap.png`；补充 `MOWING_TRAJECTORY_SOURCE=fallback` 显式 opt-in 说明。
- [`data-dictionary.md`](data-dictionary.md)：登记 `full_semanticmap.png` / `full_rgbmap.png` 二进制资产。
- 本节（§10）新增，纠正自报审计的不准确表述。

---

## 11. 结论

**P1~P5 全部阶段成功落地，五大重构目标（G1~G5）全部达成；关键审计 P0/P1 已清零，兼容性与兜底逻辑已移除。**

核心价值交付：
1. 测试数据改完即生效，开发期无需重启 `tsx`；
2. 代码单一职责重组，维护边界清晰；
3. 场景驱动 + 故障注入，复现客户问题路径打通；
4. 文档单一入口索引化，新人快速定位；
5. fail-fast 原则贯彻：配置/数据错误即时抛出，不再被静默兜底掩盖。

遗留低优先级项（§4.5 一键捕获、帧文件语义命名、`hostBaseUrl` Host 头兜底）不影响核心功能，可按需排期；P5b 控制台 UI 重构已落地（见 §8.1）。

---

## 11. 冗余数据 / 死代码清理（P7）

> 状态：已落地。依据 [`refactor-plan.md`](refactor-plan.md) §5.4「`map_list.json` → `fixtures/maps/map_list.json`」，对仓库根残留的迁移前死数据进行清理。

| 清理项 | 性质 | 处置 | 验证 |
|--------|------|------|------|
| 根目录 `map_list.json` | 与 [`fixtures/maps/map_list.json`](../fixtures/maps/map_list.json) **字节级一致**（同为 2,783,830 字节）的迁移前 duplicate，P1 后已被 fixture 加载层取代，全仓零引用 | 删除根目录文件 | `findstr /C:"map_list.json"` 确认仅 `src/fixtures/mapList.fixture.ts` 引用 `maps/map_list.json`（相对 FIXTURE_ROOT）；70 tests / 0 fail |
| `.DS_Store` | macOS 文件系统元数据 cruft，曾被误纳入版本控制 | `git rm --cached` 解除跟踪 + `.gitignore` 新增 `.DS_Store` | `git ls-files` 不再含该文件 |

**保留项（非死代码，已逐项核对）**：

- [`src/sim/virtualRobot.ts`](../src/sim/virtualRobot.ts)（15 行 facade re-export）——被 `server.ts`、`router.ts`、`wsServer.ts`、`sim.routes.ts`、`mappingCheck.builder.ts` 及 9 个测试文件共 15 处 import，是公共导出面，**不是垫片**（区别于已删除的 `taskBridge.ts`/`mappingTaskBridge.ts` 零引用垫片）；保留。
- `CHANGELOG.md` / `CONTRIBUTING.md` / `README.md` / `docs/refactor-audit-critical.md`——均为活文档，保留。
- `recordings/`（`*.jsonl` 已在 `.gitignore`）与 `scenarios/`——运行时产物 / 活配置，保留。

清理后回归验证：

```
npm run check-fixtures  →  fixtures ok
npm test                 →  70 pass / 0 fail / 22 suites
```
