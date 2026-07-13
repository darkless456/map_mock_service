# 重构落地独立审计报告（对照 refactor-plan.md 目标）

> 历史说明：本文是对重构实施时工作区快照的审计记录，不代表当前文件布局或 FSM 状态。当前契约请参见 `README.md`、`docs/api.md` 和 `docs/fsm-mirror.md`。

> 审计方式：以 [`refactor-plan.md`](refactor-plan.md) 的重构目标（G1–G5）、验收清单（§10）、目录蓝图（§3.1）与硬约束为标准，逐文件核对 `src/` 与 `fixtures/` 实际落地代码，重点检查：逻辑严谨性、模块化与职责单一、目录组织合理性、**是否已全部移除兼容性逻辑与兜底逻辑**。
> 审计基准：工作区当前代码（非自报 `audit-report.md`）。
>
> **总体结论**：骨架重组基本到位，但 [`audit-report.md`](audit-report.md) 的「12/12 通过」判定过于乐观。本次独立审计发现 **3 项阻断性事实性错误**（与验收清单直接冲突）、**5 项应移除而未移除的兼容/兜底逻辑**、**2 项文档与代码不一致**。这些问题不修复，等于把缺陷藏进「兜底」与「死代码」，违背「有问题尽早暴露」的硬性要求。

---

## 一、阻断性问题（与验收清单 §10 直接冲突）

### A1. `taskBridge.ts` / `mappingTaskBridge.ts` 未删除 —— 违反验收 §10 第 3 项与 §11.3

- **计划要求**（§3.2 / §7 P4 / §10 第 3 项）：[`taskBridge.ts`](src/sim/taskBridge.ts) 与 [`mappingTaskBridge.ts`](src/sim/mappingTaskBridge.ts) 应「吸收进」对应 `*Service.ts`，验收清单明确「`src/sim/` 下无遗留文件未分类」。
- **实际**：两个旧文件仍原位存在，且只是纯 re-export 壳：
  - [`src/sim/taskBridge.ts:1`](src/sim/taskBridge.ts:1) → `export { ... } from './task/MowingTaskBridge'`
  - [`src/sim/mappingTaskBridge.ts:1`](src/sim/mappingTaskBridge.ts:1) → `export { ... } from './task/MappingTaskBridge'`
- **检索结论**：全仓 `grep` 这两个导入路径，**除文件自身外零引用**（路由层已直接从 `../../sim/task/MowingTaskBridge` 导入，见 [`task.routes.ts:3`](src/http/routes/task.routes.ts:3)、[`mappingTask.routes.ts:3`](src/http/routes/mappingTask.routes.ts:3)）。
- **判定**：这是典型的「兼容性遗留壳」。它没有任何消费者，却保留在源码树中制造「还有人在用」的假象。必须删除。
- **自报审计的错误**：[`audit-report.md`](audit-report.md) §4 写「吸收 `mappingTaskBridge.ts` ✅」「吸收 `taskBridge.ts` ✅」，与事实不符。

### A2. 二进制资产未迁入 `fixtures/maps/assets/` —— 违反验收 §10 与 §5.4

- **计划要求**（§3.1 目录树 / §5.4 迁移映射表 / §10）：`full_semanticmap.png` / `full_rgbmap.png` 必须迁入 `fixtures/maps/assets/`，作为「数据资产归入数据目录」的 G3 落地项。
- **实际**：两文件仍位于仓库**根目录**（`full_semanticmap.png` / `full_rgbmap.png`），`fixtures/maps/` 下只有 `map_list.json` 与 `metadata.jsonc`，**无 `assets/` 子目录**。
- **代码硬编码指向根目录**，且两处重复定义同一常量：
  - [`src/assets/BasemapAsset.ts:5`](src/assets/BasemapAsset.ts:5) `path.join(SERVICE_ROOT, 'full_semanticmap.png')`
  - [`src/trajectory/mowingTrajectory.ts:35`](src/trajectory/mowingTrajectory.ts:35) `path.join(SERVICE_ROOT, 'full_semanticmap.png')`
- **判定**：资产未归档，且路径常量在 `assets/` 与 `trajectory/` 两个模块各写一遍（DRP 违反 + 职责泄漏：`trajectory/` 不该知道资产物理位置）。应统一收口到 `assets/` 层并由 `FixtureLoader`/`BasemapAsset` 单点解析。
- **自报审计的错误**：[`audit-report.md`](audit-report.md) §3 表格把「`src/data/` 拆分 → `assets/`」标 ✅，未提资产文件仍在根目录。

### A3. `@deprecated dispatchRatelNotify` 仍存在且被测试引用 —— 违反「全部移除兼容性逻辑」

- **实际**：[`src/sim/virtualRobotCore.ts:403`](src/sim/virtualRobotCore.ts:403) 保留 `/** @deprecated Use pushRatelStatus */ dispatchRatelNotify()`，内部仅转调 `pushRatelStatus`。
- **消费者**：3 个测试文件仍在调用（[`__tests__/virtualRobot.test.ts:16`](__tests__/virtualRobot.test.ts:16)、[`recorder.test.ts:19`](__tests__/recorder.test.ts:19) 等）。
- **判定**：这是一个已标注废弃的兼容入口。按「尽早暴露」原则，应删除该方法并同步把测试改用 `pushRatelStatus`。保留 `@deprecated` 壳 = 默许旧调用方式继续存活，问题永远不会暴露。

---

## 二、应移除而未移除的兜底/默认逻辑

按用户硬性要求「已全部移除兼容性逻辑和兜底逻辑（有问题尽早暴露）」，下列兜底分支均应改造为 fail-fast 或显式错误：

### B1. `mowingTrajectory.ts` 静默吞异常 + 双重兜底

[`src/trajectory/mowingTrajectory.ts:60`](src/trajectory/mowingTrajectory.ts:60) `loadMowingTrajectoryPoints()`：

```ts
try {
  const png = PNG.sync.read(fs.readFileSync(FULL_SEMANTIC_MAP_PATH));
  const result = buildRouteFromSemanticZero(png, ...);
  if (result.points.length >= 2) { ... return; }
} catch {
  // Fall through to deterministic fallback below.   ← 静默吞掉所有错误
}
cachedRoute = null;
const fallbackPoints = readFallbackPoints();   ← 兜底 1
```

- **问题**：`catch {}` 吞掉**所有**异常（文件缺失 / PNG 损坏 / 解析错误），无日志、无分类，直接回退到 `trajectory_fallback.jsonc`。资产配置错了，开发者看到的是「轨迹还能动」假象，根因被彻底掩盖。
- `createPoseState()`（[:42](src/trajectory/mowingTrajectory.ts:42)）还再做一层 `route.length >= 2 ? route : fallbackPoints` —— 双重兜底叠加。
- **建议**：移除 `try/catch` 兜底，资产缺失或解析失败直接抛错（与 `FixtureLoader` 的 fail-fast 校验风格一致）；`trajectory_fallback.jsonc` 若仍作为合法数据源应显式声明其为「主源」而非「兜底」。

### B2. `PatchLoader.numberValue` 对破损 XML 字段静默填默认值

[`src/assets/PatchLoader.ts:32`](src/assets/PatchLoader.ts:32) `numberValue(value, fallback=0)`，对 `timestamp_ms / resolution / origin_x / origin_y / map_cols / map_rows` 任一字段解析失败即回退 `0`（或 `0.05`）。

- **问题**：fixture XML 若漏字段或写错类型，mock 会用默认值「跑起来」，破损数据不暴露。`server.ts:21` 只校验 `patches.length === 0`，对「字段坏但能加载」无任何告警。
- **建议**：关键元数据字段（resolution/origin/cols/rows）缺失或非数值时抛错，由 `check-fixtures` 兜底；`timestamp_ms` 缺失可用 `Date.now()` 但应 `logger.warn`。

### B3. `mapMetadata.fixture.ts` 的 `default` 兜底

[`src/fixtures/mapMetadata.fixture.ts:26`](src/fixtures/mapMetadata.fixture.ts:26) `getMapMetadata()` 对未知 `mapId` 回退 `fixture.default`。`metadata.jsonc` 注释也写「default 用于未命中 map_id 的兜底」。

- **判定**：这是**有意设计的兜底**，但与「尽早暴露」相悖。若 `map_list.json` 新增了一张图却忘了在 `metadata.jsonc` 登记，mock 会用 `(2.5, 2.2, 0.05)` 静默凑数，地图落位错误且无提示。
- **建议**：未知 `mapId` 应 `logger.warn` 或直接抛错；至少在 `check-fixtures` 中校验「`map_list.json` 的所有 `map_id` 必须在 `metadata.jsonc.maps` 有对应条目」。

### B4. `sim.routes.ts` / `scenarioEngine.ts` 的 `readDomain` 未知值兜底

[`src/http/routes/sim.routes.ts:13`](src/http/routes/sim.routes.ts:13) 与 [`src/sim/scenarioEngine.ts:515`](src/sim/scenarioEngine.ts:515) 各自定义同名 `readDomain(value, fallback)`，对非 `mapping/mowing/mapEdit` 的值静默回退到 `fallback`。

- **问题**：两处重复实现（DRP 违反，应抽到公共 infra）；且把「非法 domain」静默当合法值处理，调用方拿不到错误信号。
- **建议**：非法 domain 应返回 400 / 抛错，而非回退。

### B5. `http/shared/http.ts` 的 `hostBaseUrl` 对缺失 host 兜底

[`src/http/shared/http.ts:88`](src/http/shared/http.ts:88) `req.headers.host || 'localhost:${fallbackPort}'`。HTTP/1.1 规范下 `Host` 头必存在，缺失属异常。兜底掩盖了客户端协议错误。低优先级，但符合「移除兜底」范畴。

---

## 三、模块化与职责单一问题

### C1. `virtualRobotCore.ts` 仍 538 行，职责偏重（P4 目标未完全达成）

- **计划目标**（§3.2 / §10 第 5 项）：`virtualRobot.ts` 拆分后应「仅持有 EventEmitter + 状态快照，协调子模块」。验收标准写「< 300 行」。
- **实际**：[`virtualRobot.ts`](src/sim/virtualRobot.ts) 是 15 行 re-export（满足字面标准），但真正逻辑落在 [`virtualRobotCore.ts`](src/sim/virtualRobotCore.ts) **538 行**，承担：FSM 派发（mapping/mowing）、任务创建/动作、回充编排、ratelStatus 推送、轨迹/通道 DVT helper、事件记录、transcript 广播。
- **判定**：把 963 行拆成「15 行壳 + 538 行 Core」只是把胖文件改名，Core 仍是上帝类。`resumeMapping`、`createMowingTask`、`applyMowingAction`、`startRecharge`、`confirmEdgeStart` 等业务方法本应下沉到 `task/*Service.ts` 或 `push/*` 模块，现仍集中在 Core。
- **建议**：P4 应补一轮拆分，把领域动作（mapping/mowing/recharge 的 create/action/progress）下沉到对应 Service，Core 仅保留 EventEmitter + snapshot + dispatch 路由。

### C2. `task/*Bridge.ts` 与 `task/*Service.ts` 职责边界合理但命名易误读

- **实际架构**（已验证）：`*Service.ts` = 状态持有 + CRUD（`Map<id, record>`），`*Bridge.ts` = HTTP 入参解析 + 调 `robot.*` + 构造响应体。路由层只引用 Bridge。这个切分本身合理。
- **问题**：命名「Bridge」与计划文档措辞「吸收 Bridge 进 Service」冲突，导致 [`audit-report.md`](audit-report.md) 误判「已吸收」。建议把 `*Bridge.ts` 改名为 `*RouteAdapter.ts` 或并入路由层私有 builder，消除「Bridge 还在」的语义歧义。

### C3. 静态资产路由寄居在 `mapping.routes.ts` —— 职责越界

[`src/http/routes/mapping.routes.ts:76`](src/http/routes/mapping.routes.ts:76) 处理 `GET /sim/assets/mapping_trajectory.bin`。静态二进制资产服务与「建图业务路由」是两个职责，混在一个 handler 里。`/sim/assets/*.png` 又在 [`map.routes.ts:60`](src/http/routes/map.routes.ts:60)。资产路由分散在两个业务路由文件，无统一 `assets.routes.ts`。建议独立 `sim.assets.routes.ts` 收口所有 `/sim/assets/*`。

### C4. `FULL_SEMANTIC_MAP_PATH` 在两个模块重复硬编码

见 A2。`trajectory/mowingTrajectory.ts` 与 `assets/BasemapAsset.ts` 各自 `path.join(SERVICE_ROOT, 'full_semanticmap.png')`。资产路径是 `assets/` 层的职责，`trajectory/` 不应重复定义。应通过 `BasemapAsset` 暴露 `readSemanticPng()` 给 trajectory 调用。

---

## 四、文档同步问题（违反用户自定义指令「代码改文档同步」）

### D1. `docs/mowing_trajectory.md` 仍链接根目录资产

[`docs/mowing_trajectory.md:5`](docs/mowing_trajectory.md:5) 写 `[full_semanticmap.png](../full_semanticmap.png)`。若按 §5.4 迁移资产，此链接应改为 `../fixtures/maps/assets/full_semanticmap.png`。当前与代码（也未迁移）一致，但与计划冲突——说明 P2 资产迁移这一项代码与文档**都没有按计划执行**。

### D2. `data-dictionary.md` 未登记二进制资产

[`docs/data-dictionary.md`](docs/data-dictionary.md) 的 Fixtures 表只列 JSON/JSONC，**未列 `full_semanticmap.png` / `full_rgbmap.png`**。G3「有数据字典」对二进制资产存在盲区。

### D3. `audit-report.md` 与实际代码不一致（自报审计失真）

[`audit-report.md`](audit-report.md) 多处 ✅ 与代码事实冲突（见 A1、A2、C1）。该文档应据实修订，否则会误导后续维护者认为遗留项已清理。

---

## 五、做得好的部分（确认无误）

为平衡审计，下列项经独立核对确实达标：

| 项 | 核对结论 |
|---|---|
| [`FixtureLoader.ts`](src/fixtures/FixtureLoader.ts) | mtime 缓存 + stripJsonComments + `withOverrides` 栈式覆盖，设计严谨，符合 §4.2 |
| `src/sim/fsm-mirror/` 只读约束 | 目录原位未动，mock 侧仅 import，硬约束遵守 |
| `src/data/` 消失 | 已确认不存在 `src/data/`，`annotations.ts`/`chargingDock.ts` 已删 |
| `data*/` 消失 | `fixtures/datasets/<语义名>/` 已落地，`PatchLoader.ALLOWED_DATASETS` 已改语义名 |
| HTTP realism 延时注入位置 | [`router.ts:53`](src/http/router.ts:53) 在 `for` 循环前一次性算延时，控制面豁免正确，无 §6.8 所述的 9 倍叠加 bug |
| `chaos.send()` 合并延时 | [`chaos.ts:81`](src/sim/chaos.ts:81) `latency + jitter + wsDelay` 单次 setTimeout，未叠加两次定时器 |
| 路由文件统一 `*.routes.ts` | 9 个路由文件命名一致 |
| fixture 类型守卫 | `device/mapping/mowing/recharge/mapList/mapMetadata` 均有 `validate` 函数，fail-fast 抛错 |

---

## 六、整改优先级

| 优先级 | 项 | 动作 |
|---|---|---|
| P0（阻断） | A1 | 删除 [`taskBridge.ts`](src/sim/taskBridge.ts) / [`mappingTaskBridge.ts`](src/sim/mappingTaskBridge.ts) |
| P0（阻断） | A3 | 删除 `dispatchRatelNotify`，改测试用 `pushRatelStatus` |
| P0（阻断） | A2 + C4 + D1 + D2 | 资产迁入 `fixtures/maps/assets/`，路径单点收口到 `BasemapAsset`，更新 `mowing_trajectory.md` 与 `data-dictionary.md` |
| P1（兜底移除） | B1 | 移除 `mowingTrajectory` 的 `try/catch` 静默兜底，改为抛错 + 日志 |
| P1（兜底移除） | B3 | `mapMetadata` 未知 `mapId` 改 warn 或抛错，`check-fixtures` 增加交叉校验 |
| P1（兜底移除） | B2 | `PatchLoader` 关键字段缺失改抛错 |
| P2（SRP） | C1 | `virtualRobotCore.ts` 继续拆分，领域动作下沉 Service |
| P2（SRP） | C3 | 抽离 `sim.assets.routes.ts` |
| P2（DRP） | B4 | 抽公共 `readDomain`，非法值改抛错 |
| P3（文档） | D3 | 据 A1/A2/C1 修订 [`audit-report.md`](audit-report.md) |

---

## 七、结论

重构的**数据外置（P1）与目录骨架（P3）**落地扎实，FixtureLoader 与 realism 延时设计严谨。但 **P4 大文件拆分只完成了「壳化」，Core 仍是上帝类**；更关键的是 **A1/A2/A3 三项阻断性问题说明「移除兼容性逻辑与兜底逻辑」这一硬性要求未达成**——死代码 re-export 壳、`@deprecated` 方法、根目录散落资产、静默 `catch` 兜底均仍存活。这些问题不会在运行时炸响，恰恰因为它们被「兜底」吸收，正是用户要求「尽早暴露」要消灭的对象。建议先清零 P0/P1 再宣告 P4 完成。
