# map_mock_service 重构方案

> 状态：方案设计（待评审）
> 适用版本：Mower Dev Simulator v1
> 编写依据：当前 `src/` 实际代码、`map_list.json`、`data*/` 数据集现状
>
> 本文档为**重构设计文档**，目标是给出可落地的改造蓝图与分阶段计划，而非一次性大爆炸式重写。
> 所有改造遵循「单一职责 + 可热编辑测试数据 + 文档同步」三条原则。
>
> ## 硬约束：FSM 镜像目录只读
>
> [`src/sim/fsm-mirror/`](src/sim/fsm-mirror/domain/shared/TaskFSM.ts:1) 是从外部仓库
> `pudu_ratel_app_mower` 通过 [`scripts/sync-fsm-mirror.mjs`](scripts/sync-fsm-mirror.mjs:11) 同步生成的，
> [`README.SYNC.md`](src/sim/fsm-mirror/README.SYNC.md:5) 明确规定 **禁止手动编辑镜像文件**。
> 同步脚本硬编码 `mirrorRoot = src/sim/fsm-mirror`，并会对 `@/` 别名做相对路径改写。
>
> 因此本方案涉及的所有结构重组 **均不得移动或修改 `src/sim/fsm-mirror/` 内任何文件**。
> mock 侧只能修改「适配/桥接」代码（即 `src/sim/` 下 fsm-mirror 之外的文件，如
> [`virtualRobot.ts`](src/sim/virtualRobot.ts:1)、[`mappingTaskBridge.ts`](src/sim/mappingTaskBridge.ts:1) 等）。
> 若引用路径因周边目录调整而变化，仅修正 mock 侧 import，FSM 镜像本身保持原样、原位、只读。

---

## 1. 现状分析

### 1.1 已有的好基础

当前项目并非一团乱麻，已经具备一些良好结构，重构应**保留并强化**这些部分：

| 现状 | 评价 |
|---|---|
| [`src/http/router.ts`](src/http/router.ts:29) 已按 `RouteHandler` 数组分发 | 路由注册清晰，可插拔 |
| [`map_list.json`](map_list.json:1) 作为外部 fixture，由 [`readMapListFixture()`](src/data/basemap.ts:130) 每次请求读取 | **已是热编辑友好模式**，改 JSON 无需重启 —— 这是本方案的范式样板 |
| [`scenarios/*.yaml`](scenarios/mapping_happy_auto.yaml:1) 外置场景脚本 | 场景与代码解耦 |
| [`src/sim/fsm-mirror/`](src/sim/fsm-mirror/domain/shared/TaskFSM.ts:1) 镜像真实后端 FSM | 状态机逻辑独立，可单测 |
| [`src/shared/`](src/shared/http.ts:1) 抽出 `sendJson`/`readJsonBody` 等 HTTP 工具 | 路由层无裸 `res.writeHead` 重复样板 |

### 1.2 核心痛点

#### 痛点 A：测试数据散落在代码里，修改必须重启

[`src/data/annotations.ts`](src/data/annotations.ts:37) 把 10 个地图标注包用 `store.set(...)` **硬编码在 TS 源码中**。改一条标注 → 改 `.ts` → `tsc` → 重启 `tsx`。这与 `map_list.json` 的热编辑能力完全割裂。

同样的硬编码还存在于：

| 位置 | 硬编码内容 |
|---|---|
| [`src/data/basemap.ts`](src/data/basemap.ts:41) `MAP_METADATA` | 11 条地图元数据写死在常量表 |
| [`src/data/mowingTrajectory.ts`](src/data/mowingTrajectory.ts:21) `FALLBACK_POINTS` | 割草轨迹兜底点写死 |
| [`src/http/routes.device.ts`](src/http/routes.device.ts:30) `self_check` 分支 | 自检结果 `blade/wheel/sensor/...` 字面量内联 |
| [`src/http/mappingCheckResponse.ts`](src/http/mappingCheckResponse.ts:29) `buildFullConditions` | 建图条件 `bluetooth/cellular/...` 状态写死 |
| [`src/sim/virtualRobot.ts`](src/sim/virtualRobot.ts:104) `RETURN_DOCK_NOTIFY_SEQUENCE` | 回桩 sub_status 时序写死 |
| [`src/data/chargingDock.ts`](src/data/chargingDock.ts:6) `CHARGING_DOCK_BACKEND_POINT` | 充电桩坐标写死为 `{0,0}`，被 [`annotations.ts`](src/data/annotations.ts:1) 10 个标注条目共享引用（原文档遗漏此文件） |

**根因**：缺少统一的「fixture 加载层」，数据与逻辑混在同一文件。

> ⚠️ **充电桩坐标是每张地图各自不同的数据，不存在统一位置**：审计 [`map_list.json`](map_list.json:4676) 真实返回可见，39 张地图的 type=69 充电桩点坐标各异（如 `1.16809,-0.018114` / `1.157164,-0.032504` / `1.166974,-0.017548`），而非统一值。当前 [`chargingDock.ts`](src/data/chargingDock.ts:6) 把它写死为 `{0,0}` 并被 10 个 annotations 条目共享引用，是**事实性错误**——它让所有 mock 地图的充电桩都落在世界原点，与真实后端行为不符。
>
> 因此 **不存在「共享常量被拆散」的取舍问题**：充电桩点本就该每图独立。最终决议（§11.3 决议 1）更彻底——**不拆 annotations fixture，整文件删除 [`annotations.ts`](src/data/annotations.ts:1) 与 [`chargingDock.ts`](src/data/chargingDock.ts:1)**，静态地图数据（含 increments、充电桩 type=69 point）以 [`map_list.json`](map_list.json:1) 为唯一来源，`semantic/save` 运行时增量保留在内存 Map 覆盖对应 item。这恰好是「单一职责 + 数据归数据」的正解，`chargingDock.ts` 的常量不再有存在理由。

#### 痛点 B：数据目录无规则，难以查找

当前根目录平铺四个数据集目录：

```
data/     # 1774431* 时间戳命名，png + xml 混放
data2/    # 1776306* 时间戳命名
data3/    # 1778726* 时间戳命名（默认）
data4/    # 3161766_fixed / 25912738_fixed 命名（又是另一套规则）
recordings/
```

问题：
- 目录名 `data/data2/data3/data4` **无语义**，不知道每个集代表什么场景；
- 文件名全是时间戳，无法判断哪个 patch 是「建图起始帧」「割草中」「回桩」；
- `data4` 又用 `<id>_fixed` 命名，**两套命名规则并存**；
- `recordings/` 与 `data*/` 同级，用途不清；
- 二进制（png）、结构化（xml）、配置（json/yaml）、源码（ts）四种数据**混在仓库根与 src/data 下**，没有「数据资产」统一入口。

#### 痛点 C：职责边界模糊

[`src/data/`](src/data/) 目录名义上是「数据」，实际混合了三类东西：
1. **纯数据容器**（`annotations.ts` 的 `store` Map）；
2. **业务计算逻辑**（`mowingTrajectory.ts` 的 `advancePose` 轨迹推进算法、PNG 像素扫描）；
3. **文件 IO**（`basemap.ts` 的 `readMapListFixture`、`patches.ts` 的 `loadAllPatches`）。

三者混在一起，违反单一职责。`mowingTrajectory.ts` 里既有「从 PNG 提取可行走区域」的算法，又有「沿轨迹推进机器人位姿」的模拟逻辑，还有「兜底点常量」。

#### 痛点 D：缺少文档统一入口

[`docs/`](docs/) 下有 5 个 md（`api.md` / `fsm-mirror.md` / `mowing_trajectory.md` / `ratel_backend_api.md` / `scenarios.md`），加上根 [`README.md`](README.md:1)，但：
- 无索引/目录页，新人不知道先读哪个；
- `README.md` 的 API 表与 `docs/api.md` 内容重叠且可能漂移；
- 测试数据在哪里、怎么改、改完要不要重启 —— **没有任何文档说明**。

---

## 2. 重构目标

| # | 目标 | 验收标准 |
|---|---|---|
| G1 | 代码按模块单一职责重组 | `src/` 每个目录职责单一且可一句话描述 |
| G2 | 测试 API 返回数据全部 JSON 化、热编辑 | 改任意 `.json` 后下次请求即生效，无需重启 |
| G3 | 测试数据分类归档、可检索 | 按业务域分目录，文件名含语义，有数据字典 |
| G4 | mock 服务场景化增强 | 支持按场景切换数据集、注入故障、回放录制 |
| G5 | 文档整合可查 | `docs/` 有索引页，使用说明单一信息源 |

---

## 3. 目标代码结构

### 3.1 目录重组蓝图

```
map_mock_service/
├── src/
│   ├── server.ts                    # 仅做装配，不含业务
│   ├── http/                        # HTTP 接入层（仅路由 + 请求/响应编解码）
│   │   ├── router.ts
│   │   ├── routes/
│   │   │   ├── auth.routes.ts       # 拆自 routes.acc.ts，命名统一 *.routes.ts
│   │   │   ├── device.routes.ts
│   │   │   ├── map.routes.ts
│   │   │   ├── mapping.routes.ts
│   │   │   ├── mappingTask.routes.ts
│   │   │   ├── task.routes.ts
│   │   │   ├── recharge.routes.ts
│   │   │   └── sim.routes.ts
│   │   └── shared/
│   │       └── http.ts              # 原 src/shared/http.ts 下移
│   ├── ws/                          # WebSocket 接入层
│   ├── auth/                        # 鉴权（ticket/jwt）
│   ├── sim/                         # 模拟器运行时（状态机驱动 + 推送）
│   │   ├── fsm-mirror/              # ⚠️ 只读：外部仓库同步产物，禁止移动/修改（见硬约束）
│   │   │   └── ...                  # 保持 src/sim/fsm-mirror/ 原位原结构
│   │   ├── VirtualRobot.ts          # 原 virtualRobot.ts，大文件拆分见 §3.2
│   │   ├── MapStream.ts
│   │   ├── ChaosController.ts
│   │   ├── Recorder.ts
│   │   ├── ScenarioEngine.ts
│   │   ├── push/                    # 推送编排拆分
│   │   │   ├── mappingNotify.ts
│   │   │   ├── mowingNotify.ts
│   │   │   ├── ratelStatusPush.ts
│   │   │   ├── pushChannels.ts      # 原 sim/pushChannels.ts 平移（原文档遗漏，见下方说明）
│   │   │   └── rechargeSequence.ts  # 新：回桩时序从 virtualRobot 抽出
│   │   ├── task/                    # 见 §3.2，taskBridge.ts/mappingTaskBridge.ts 并入对应 Service（原文档遗漏）
│   │   ├── simFsmTypes.ts           # 原样保留：fsm-mirror 之外的类型扩展点（原文档遗漏）
│   │   ├── scenarioGuide.ts         # 原样保留：YAML guide 块解析（原文档遗漏）
│   │   └── panel.ts
│   ├── fixtures/                    # 【新】fixture 加载层 —— 痛点 A 的解
│   │   ├── FixtureLoader.ts         # 统一「读 JSON + 缓存 + 热重载」
│   │   ├── mapList.fixture.ts       # map/list 响应（含 increments/充电桩），静态地图数据唯一来源（§11.3 决议 1）
│   │   ├── mapMetadata.fixture.ts
│   │   ├── deviceSelfCheck.fixture.ts
│   │   ├── mappingCheck.fixture.ts
│   │   ├── mowingTrajectory.fixture.ts
│   │   └── rechargeSequence.fixture.ts
│   ├── assets/                      # 【新】二进制资产读取层（png/xml 加载）
│   │   ├── BasemapAsset.ts          # 原 basemap.ts 的 readBasemapAsset
│   │   └── PatchLoader.ts           # 原 patches.ts
│   ├── trajectory/                  # 【新】割草轨迹算法（从 data 抽出）
│   │   ├── SemanticRouteExtractor.ts# PNG 像素扫描
│   │   └── PoseAdvancer.ts          # advancePose 沿轨迹推进
│   └── infra/                       # 跨切面基础设施（原 src/shared/ 中除 http.ts 外的部分平移，见 §7 P3 修正）
│       ├── logger.ts                # 原 src/shared/logger.ts
│       ├── ids.ts                   # 原 src/shared/ids.ts
│       └── crc.ts                   # 原 src/shared/crc.ts
│
├── fixtures/                        # 【新】所有 JSON 测试数据统一根（痛点 B/C 解）
│   ├── maps/
│   │   ├── map_list.json            # 原 map_list.json 迁入，**保持 .json**（9.9 万行纯粘贴数据，无需手写注释，见 §4.4）
│   │   ├── metadata.jsonc           # 原 basemap.ts MAP_METADATA 外置
│   │   ├── assets/                  # 【新】原文档遗漏：basemap.ts 引用的二进制资产迁入位置（见 §5.4）
│   │   │   ├── full_semanticmap.png
│   │   │   └── full_rgbmap.png
│   │   # 注：无 annotations/ 子目录——静态地图数据（含 increments/充电桩）以 map_list.json 为唯一来源（§11.3 决议 1）
│   ├── device/
│   │   └── self_check.jsonc         # 原 routes.device.ts 内联响应
│   ├── mapping/
│   │   └── check_conditions.jsonc   # 原 mappingCheckResponse.ts 内联
│   ├── mowing/
│   │   └── trajectory_fallback.jsonc # 原 mowingTrajectory.ts FALLBACK_POINTS
│   ├── recharge/
│   │   └── notify_sequence.jsonc    # 原 virtualRobot.ts RETURN_DOCK_NOTIFY_SEQUENCE
│   └── datasets/                    # 【新】地图帧数据集重组（痛点 B 解）
│       ├── mapping_happy/           # 原 data3，语义化重命名
│       │   ├── manifest.json        # 数据集元信息：场景、帧数、说明
│       │   └── frames/
│       │       ├── 000_start.xml/.png
│       │       ├── 001_edge.xml/.png
│       │       └── ...
│       ├── mowing_trajectory/       # 原 data2
│       ├── recharge_return/         # 原 data
│       └── fixed_maps/              # 原 data4
│           └── frames/
│               ├── 3161766_fixed.xml/.png
│               └── ...
│
├── scenarios/                       # 保留，YAML 场景
├── recordings/                      # 保留，运行时录制（加 .gitignore 规则）
├── __tests__/                       # 保留原位原结构（§11.3 决议 3：非必须不改）
├── docs/                            # 见 §8
```

### 3.2 大文件拆分

[`src/sim/virtualRobot.ts`](src/sim/virtualRobot.ts:1) 当前 **963 行**（原文档写作 964 行，误差 1 行），承担了：设备信息、mapping FSM、mowing FSM、回充任务、轨迹位姿、能力广播。建议拆为：

| 拆出文件 | 职责 |
|---|---|
| `sim/VirtualRobot.ts` | 仅持有 `EventEmitter` + 当前域/状态快照，协调子模块 |
| `sim/DeviceProfile.ts` | `buildDeviceInfo` / `updateDevice` / SN/nickname |
| `sim/task/MowingTaskService.ts` | `MowingTaskRecord` CRUD + `createMowingTask`/`applyTaskAction`，吸收现有 [`sim/taskBridge.ts`](src/sim/taskBridge.ts:1)（原文档遗漏此文件，未说明其去向） |
| `sim/task/MappingTaskService.ts` | `MappingTaskRecord` CRUD，吸收现有 [`sim/mappingTaskBridge.ts`](src/sim/mappingTaskBridge.ts:1)（文档开头「硬约束」一节点名了这个文件是 mock 侧适配代码，但正文 §3.1/§3.2 均未给出它的最终归宿，已在此补上） |
| `sim/task/RechargeTaskService.ts` | 回充任务 + 调用 `rechargeSequence` |
| `sim/push/rechargeSequence.ts` | `RETURN_DOCK_NOTIFY_SEQUENCE` 时序（数据走 fixture） |

> 另外，现有 [`sim/simFsmTypes.ts`](src/sim/simFsmTypes.ts:1)（对 fsm-mirror 之外概念的类型扩展）、[`sim/scenarioGuide.ts`](src/sim/scenarioGuide.ts:1)（YAML guide 解析）、[`sim/pushChannels.ts`](src/sim/pushChannels.ts:1)（WS envelope 编排，278 行）三个文件在原方案的目录蓝图（§3.1）里完全没有出现，均已按原位/合理位置补入 §3.1 目录树，避免 P3/P4 执行时找不到依据。

---

## 4. 测试数据 JSON 化与热重载（核心，对应要求 2）

### 4.1 范式样板与动机

**为什么用 JSON 文件而不是代码**：开发期间 API 协议极不稳定，字段/结构经常变动，有时甚至需要以真实后端返回为准直接粘贴覆盖。把响应写成 TS 代码意味着每次协议变更都要改源码 → `tsc` → 重启，成本高且易引入类型噪声；用 JSON fixture 则是「复制真实响应 → 存文件 → 下次请求即生效」，无需编译、无需重启、无需懂代码。这正是 [`map_list.json`](map_list.json:1) 已验证的范式。

以现有 [`map_list.json`](map_list.json:1) + [`readMapListFixture()`](src/data/basemap.ts:130) 为样板。该函数**每次请求都 `fs.readFileSync`**，因此天然支持热编辑。本方案把这一模式推广到所有 API 返回数据。

### 4.2 统一 FixtureLoader

新增 [`src/fixtures/FixtureLoader.ts`](src/fixtures/FixtureLoader.ts:1)（设计草案）：

```ts
// 统一职责：读 JSON → 校验 → 可选 mtime 缓存 → 热重载
export class FixtureLoader {
  constructor(private readonly rootDir: string) {}

  /** 每次调用都重读磁盘，保证热编辑即时生效；命中 mtime 才解析，避免大文件重复 parse */
  read<T>(relativePath: string, validate?: (raw: unknown) => T): T {
    const abs = path.join(this.rootDir, relativePath);
    const mtime = fs.statSync(abs).mtimeMs;
    const cached = this.cache.get(abs);
    if (cached && cached.mtime === mtime) return cached.data as T;
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const data = validate ? validate(raw) : (raw as T);
    this.cache.set(abs, { mtime, data });
    return data;
  }
}
```

**设计要点**：
- **不预加载**：启动不读 fixture，避免改 JSON 还要重启；
- **mtime 缓存**：`map_list.json` 有 9.9 万行，每次全量 parse 有成本，用 mtime 判断是否变化；
- **校验函数注入**：每个 fixture 提供类型守卫，校验失败抛明确错误（替代当前 [`basemap.ts`](src/data/basemap.ts:132) 的内联 `if` 校验）。

### 4.3 数据外置清单

| 原 TS 内联位置 | 迁移到 fixture | 热重载 |
|---|---|---|
| [`annotations.ts`](src/data/annotations.ts:37) `store.set` ×10 + [`chargingDock.ts`](src/data/chargingDock.ts:6) `CHARGING_DOCK_BACKEND_POINT` | **两文件均整文件删除，不建 fixture**。静态地图数据（含 increments、充电桩 type=69 point）以 [`map_list.json`](map_list.json:1) 为唯一来源（§11.3 决议 1）；`semantic/save` 运行时增量保留在内存 Map，覆盖对应 item | — |
| [`basemap.ts`](src/data/basemap.ts:41) `MAP_METADATA` | `fixtures/maps/metadata.jsonc` | ✅ |
| [`mowingTrajectory.ts`](src/data/mowingTrajectory.ts:21) `FALLBACK_POINTS` | `fixtures/mowing/trajectory_fallback.jsonc` | ✅ |
| [`routes.device.ts`](src/http/routes.device.ts:30) self_check 字面量 | `fixtures/device/self_check.jsonc` | ✅ |
| [`mappingCheckResponse.ts`](src/http/mappingCheckResponse.ts:29) conditions | `fixtures/mapping/check_conditions.jsonc` | ✅ |
| [`virtualRobot.ts`](src/sim/virtualRobot.ts:104) `RETURN_DOCK_NOTIFY_SEQUENCE` | `fixtures/recharge/notify_sequence.jsonc` | ✅ |

### 4.4 注释驱动编辑：每个 fixture 文件头写编辑指南

```jsonc
// fixtures/device/self_check.jsonc
// 编辑指南：
//   自检结果字段，协议变动时直接粘贴真实响应覆盖
//   保存后无需重启，下次 self_check 即生效
{
  "checked_at": 0,
  "blade": "normal",
  "wheel": "normal",
  "sensor": "normal",
  "motor": "normal",
  "gps": "normal",
  "overall": "ok"
}
```

> **决策（非可选项）**：**API 响应类 fixture**（即 §4.3 清单里迁出的 5 项：metadata/self_check/check_conditions/trajectory_fallback/notify_sequence）统一用 `.jsonc`，`FixtureLoader` 内置 strip-comments 预处理，因为它们需要编辑指南注释、且经常被人手工改。**两类例外**：
> 1. `fixtures/maps/map_list.json`——从真实后端整段粘贴的 9.9 万行数据，不需要也不会手写编辑指南注释，保留 `.json`；
> 2. `fixtures/datasets/<name>/manifest.json`（§5.2）与 `fixtures/faults/*.json`（§6.2）——这两类是结构化元数据/配置，建议由脚本生成或整体替换而非逐字段手写注释，保持 `.json` 更合适。
>
> 除此之外，§3.1 目录蓝图、§4.3 迁移清单、§6.1 场景绑定示例中所有指向 API 响应类 fixture 的文件名均已统一为 `.jsonc`（原文档在多处混用 `.json`/`.jsonc`，已改正，避免实施时产生「到底是 .json 还是 .jsonc」的歧义）。

### 4.5 真实响应一键捕获（贴合「以真实 API 为准」工作流）

协议不稳定时最常见操作是「抓真实后端响应 → 覆盖 mock」。当前需要手动复制粘贴，建议提供一键通路：

1. **录制即落盘**：[`Recorder`](src/sim/recorder.ts:1) 已记录 HTTP 调用，扩展为「录制期间，凡命中某 fixture 路由的真实响应，自动写入对应 `fixtures/**/*.jsonc`」。
2. **`POST /sim/capture` 接口**：传入 `path` + 真实响应体（或 `proxy_url`），mock 侧把它原地写入 fixture 文件，下次同路径请求即用新数据。
3. **`fixtures/_captured/` 暂存区**：怕误覆盖的，先落 `_captured/<route>/<ts>.json`，人工确认后再 `mv` 到正式 fixture 路径。

这样「协议变了 → 抓包 → 一条命令落 fixture → 验证」闭环，全程不碰代码、不重启。

---

## 5. 测试数据分类归档（对应要求 3）

### 5.1 命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| 数据集目录 | `<业务域>_<场景>` | `mapping_happy`、`mowing_trajectory` |
| 帧文件 | `<序号:03d>_<语义>.{xml,png}` | `000_start.xml`、`015_edge_complete.xml` |
| fixture | `<功能>.jsonc`（唯一例外 `map_list.json`，见 §4.4） | `self_check.jsonc`、`check_conditions.jsonc` |

### 5.2 数据集 manifest

每个 `datasets/<name>/` 配一个 `manifest.json`，解决「不知道这个数据集干嘛用」：

```jsonc
// fixtures/datasets/mapping_happy/manifest.json
{
  "name": "mapping_happy",
  "scenario": "建图正常自动流程",
  "source": "原 data3",
  "frameCount": 749,
  "resolution": 0.05,
  "world": { "origin_x": -12.8, "origin_y": -12.8, "cols": 512, "rows": 512 },
  "notes": "首帧为建图起始，末帧为回桩。用于 mapping_happy_auto.yaml 场景。",
  "compatibleScenarios": ["mapping_happy_auto.yaml"]
}
```

> `frameCount` 必须来自迁移时的实际统计（`data3/` 现有 1498 个文件 = 749 组 xml+png，`data/` 约 1521 组，`data2/` 约 793 组，`data4/` 8 组），而非手抄本文档示例数字——原方案此处示例值为 60，与实际数据量（749）相差一个数量级，若被当作真实值誊抄会误导后续核对。建议 P2 阶段写一个一次性脚本按目录内 `.xml`/`.png` 配对数扫描生成 `manifest.json`，而非人工填写。

### 5.3 数据字典文档

新增 [`docs/data-dictionary.md`](docs/data-dictionary.md:1)（见 §6），表格化列出每个数据集/fixture 的用途、来源、对应场景。

### 5.4 迁移映射表

| 现目录 | 迁移到 | 说明 |
|---|---|---|
| `data/` | `fixtures/datasets/recharge_return/` | 时间戳帧重命名为序号 |
| `data2/` | `fixtures/datasets/mowing_trajectory/` | |
| `data3/` | `fixtures/datasets/mapping_happy/` | 默认数据集 |
| `data4/` | `fixtures/datasets/fixed_maps/` | `<id>_fixed` 保留语义后缀 |
| `recordings/` | 保留根目录，加 README 说明为运行时产物 | |
| `map_list.json` | `fixtures/maps/map_list.json` | 保持 `.json` 后缀（见 §4.4 例外） |
| `full_semanticmap.png` / `full_rgbmap.png` | `fixtures/maps/assets/` | 资产归入数据目录；已同步补入 §3.1 目录蓝图（原文档该路径只出现在本表，未出现在 §3.1 树中） |

---

## 6. mock 服务场景化增强建议（对应要求 4）

针对「机器人后端 mock」这一业务场景，除结构整理外提出以下增值建议：

### 6.1 场景→数据集绑定

当前 [`scenarios/*.yaml`](scenarios/mapping_happy_auto.yaml:1) 只描述状态推送时序，不绑定地图帧数据集。建议在 YAML 顶部增加：

```yaml
# scenarios/mapping_happy_auto.yaml
dataset: mapping_happy      # 启动该场景时自动切换 MapStream 数据源
fixtures:                    # 场景级 fixture 覆盖（支持「这个场景下 self_check 返回异常」）
  device/self_check.jsonc: { overall: 'error', blade: 'warning' }
```

`ScenarioEngine` 加载时把 `dataset` 注入 `MapStream`，把 `fixtures` 作为临时覆盖层叠加到 `FixtureLoader`。**实现一次，所有故障注入场景复用。**

### 6.2 故障注入矩阵化

当前 [`src/sim/chaos.ts`](src/sim/chaos.ts:1) 提供混沌控制，但故障类型零散。建议整理为「故障目录」：

```
fixtures/faults/
├── network_delay.json
├── ws_disconnect.json
├── mapping_estop.json
├── mowing_low_battery.json
└── recharge_failed.json
```

每个故障文件声明它要注入哪些 fixture 覆盖 + 哪些 chaos 开关，便于一键复现。

### 6.3 录制回放

`recordings/` 当前只记录 HTTP 调用，文件名格式为 `<timestamp>-panel.jsonl`（不含场景名）。建议：
- 录制格式标准化为 `<scenario>_<timestamp>.jsonl`，补上场景信息；
- ⚠️ **原方案在此提议新增 `POST /sim/replay` 接口是重复造轮子**：[`routes.sim.ts:155`](src/http/routes.sim.ts:155) 已存在 `POST /sim/recorder/replay`（与 `/sim/recorder/start`、`/sim/recorder/stop`、`/sim/recorder/list` 同组），§6.7(8) 也承认了这个既有接口的存在。两处描述自相矛盾——不应再建一个路径不同、语义重复的 `/sim/replay`，而应直接扩展现有 `/sim/recorder/replay`（例如支持按时间戳定位、配合 §6.7(8) 的 scrubber）；
- 用于「客户现场问题复现 → 仓库里跑回归」。

### 6.4 运行时切换数据集

当前 `MOCK_DATA_DIR` 是启动参数（[`server.ts:13`](src/server.ts:13)），切数据集要重启。建议新增 `POST /sim/dataset?name=mowing_trajectory`，运行时热切换 `MapStream` 数据源，配合 §6.1 场景绑定。

### 6.5 fixture 校验 + 启动自检

新增 `npm run check-fixtures`：遍历 `fixtures/` 所有 JSON，跑类型守卫，报告破损文件。CI 与启动可选执行，避免「改 JSON 改坏了到请求时才报错」。

### 6.6 调试日志分类

按 [`CONTRIBUTING.md`](CONTRIBUTING.md:1) 既有约定，新增 fixture 加载日志走 `logger.debug('fixture', ...)`，数据集切换走 `logger.info('dataset', ...)`，故障注入走 `logger.warn('fault', ...)`，便于按类别过滤。

### 6.7 控制台 UI 流程可视化重构

当前 [`src/sim/panel.ts`](src/sim/panel.ts:6)（304 行单文件 HTML）的「状态」区只是把 `JSON.stringify(snapshot)` 甩进 `<pre>`，「时间线」区是 WS inspect 的逐条 JSON 累积文本。开发者很难一眼看出「现在处于建图/割草的哪个阶段、下一步会发生什么、为什么状态跳转」。针对流程可读性，建议：

**(1) 状态机泳道图** — 用静态 SVG/Canvas 画出 mapping 与 mowing 两条 FSM 主干（节点 = phase，如 `PREPARING → EDGE_FOLLOW → MAP_COVERAGE_RUN → SAVE → COMPLETED`），高亮当前 phase，正在迁移的边用动画箭头。FSM 定义来自只读镜像 [`MappingSession.ts`](src/sim/fsm-mirror/domain/mapping/MappingSession.ts:1)/[`MowingTask.ts`](src/sim/fsm-mirror/domain/mowing/MowingTask.ts:1)，可写一个 `phaseGraphFromFsm()` 把 phase 枚举 + 合法迁移编译成图数据，UI 只渲染。比读 JSON 直观一个量级。

**(2) 时间线改为事件流卡片** — 当前 timeline 是纯文本 prepend，信息密度低且无结构。改为按时间倒序的事件卡片：每条显示 `[ts] cmd/notify | domain | 关键字段`，用颜色区分 `CMD_*`（下行控制，蓝）/`NOTIFY_*`（上行推送，绿）/`DEVICE_*`（设备事件，黄）/`ERROR`（红）。卡片可点击展开完整 payload。

**(3) 关键指标常驻顶栏** — 把现在散在 `<pre>` 里的核心字段提到顶部数字卡：`work_status`、`phase`、`sub_status`、`battery`、`map base_version`、`active domain`，配语义颜色（idle 灰/mapping 紫/mowing 绿/estop 红），1.5s 轮询已存在（[`panel.ts:292`](src/sim/panel.ts:292)），直接喂这些卡。

**(4) 场景进度条 + 下一步提示** — 场景 YAML 已有 step 概念。运行时显示「步骤 3/7 · 正在推送 leave_dock」，并高亮即将触发的下一个 `notify`/`emit`。让开发者预判「等几秒会出现什么」，而不是盲等。

**(5) WebSocket 推送实时预览** — 当前 `/sim/inspect`（[`panel.ts:295`](src/sim/panel.ts:295)）把整条 WS 消息 JSON dump。建议解析出 `cmd`/`task_status`/`work_status`/`sub_status` 等业务字段，只展示这些 + 一个「展开原文」折叠，减少视觉噪声。

**(6) 双栏布局改三栏** — 现在是「操作 | 状态+时间线」两栏。建议改「操作 | FSM 图+指标卡 | 事件流时间线」三栏，左控中观右流，一一对应心智模型。

**(7) panel.ts 拆分** — 304 行内联 HTML/JS 不易维护。重构时把 `renderPanelHtml()` 拆为：`panelHtml.ts`（壳）+ `panelState.ts`（数据拉取/轮询）+ `panelTimeline.ts`（时间线渲染）+ `panelGraph.ts`（FSM 图渲染），UI 资源（CSS/图）放 `src/sim/panel/assets/`。

**(8) 可选：录制回放带 scrubber** — [`routes.sim.ts:155`](src/http/routes.sim.ts:155) 已有 `/sim/recorder/replay`。在时间线上叠加一个时间轴 scrubber，拖拽即跳转到任意时刻的状态快照，方便回溯「状态在那一刻为什么变了」。

### 6.8 真实环境延时模拟（HTTP 0.5–3s / WS 2–8s，可开关）

#### 现状

[`ChaosController`](src/sim/chaos.ts:1) 已支持 `latencyMs`（固定）+ `reorderWindowMs`（抖动窗口），但：
- **只作用于 WS 推送**：[`ws/outbound.ts:38`](src/ws/outbound.ts:38) 调 `chaos.send()`，HTTP 路由层完全无延时；
- 延时是**固定值 + 抖动**，不是「区间内随机」，与真实网络 RTT 分布不符；
- 没有「真实环境模式」总开关，每次要手动 `POST /sim/chaos` 设参数。

#### 目标

提供「真实环境延时」一键模式：开启后 HTTP 响应随机延时 0.5–3s，WS 推送随机延时 2–8s，还原弱网/远端后端体感。开关控制是否启用，关闭时回归即时响应（便于快速回归测试）。

#### 设计

**(1) 扩展 ChaosController 为双模式**

当前 `ChaosController` 只有「固定 latencyMs + dropRate + reorder」的混沌模式。新增独立的「realism」通道，二者正交：

```ts
// src/sim/chaos.ts 扩展
export interface RealismConfig {
  enabled: boolean;
  httpDelayMinMs: number;   // 默认 500
  httpDelayMaxMs: number;   // 默认 3000
  wsDelayMinMs: number;     // 默认 2000
  wsDelayMaxMs: number;     // 默认 8000
}

export class ChaosController {
  private realism: Required<RealismConfig> = { ... };

  updateRealism(next: Partial<RealismConfig>): Required<RealismConfig> { ... }

  /** 区间内均匀随机延时，realism 关闭时返回 0 */
  httpDelayMs(): number {
    if (!this.realism.enabled) return 0;
    return randBetween(this.realism.httpDelayMinMs, this.realism.httpDelayMaxMs);
  }
  wsDelayMs(): number {
    if (!this.realism.enabled) return 0;
    return randBetween(this.realism.wsDelayMinMs, this.realism.wsDelayMaxMs);
  }
  // 原 chaos.send() 保留，用于 dropRate/reorder；realism 的 ws 延时在 send() 内叠加
}
```

关键点：`realism` 与原 `chaos`（drop/reorder）**叠加而非互斥**——可以同时开真实延时 + 丢包。

**(2) HTTP 路由层注入延时**

⚠️ **原方案的插入位置描述有严重 bug，会导致延时被放大数倍**：[`createHttpHandler`](src/http/router.ts:41)（原文档写作 :42，行号有误）内部并非单次调用一个 `route(...)`，而是 `for (const route of ROUTES) { if (await route(req,res,url,ctx)) return; }`——`ROUTES` 当前有 9 个 handler（health/acc/device/map/mapping/mappingTask/task/recharge/sim），逐个尝试直到某个返回 `true`。如果照原文档字面意思把延时插到"调用 `route()` 之前"、又落在这个 `for` 循环体内，命中靠后的 handler（例如 `sim`）时，会在到达它之前把前面所有不匹配的 handler 都各自等一次随机延时，单次请求可能被叠加到 9 倍（最坏 ~27s），而不是文档目标的 0.5–3s。

正确做法是**在 `for` 循环开始之前、对每个请求只算一次延时**，并在同一处做控制面豁免判断：

```ts
// createHttpHandler 内，try 块顶部，进入 for (const route of ROUTES) 循环之前
ctx.recorder.recordHttp(req, url.pathname);

const isControlPlane = url.pathname === '/api/health' || url.pathname.startsWith('/sim/');
if (!isControlPlane) {
  const delay = ctx.chaos.httpDelayMs();
  if (delay > 0) {
    await new Promise(r => setTimeout(r, delay));
  }
}

for (const route of ROUTES) {
  if (await route(req, res, url, ctx)) return;
}
```

这样每个请求只产生一次延时，业务路由统一生效、无需逐个路由改，`/api/health`、`/sim/*` 控制面接口豁免（否则调面板自己都卡）。

**(3) WS 推送层叠加延时**

[`ws/outbound.ts`](src/ws/outbound.ts:38) 现有 `chaos.send()` 已处理 drop/reorder/latency。把 realism 的 ws 延时并入 `send()`：`send()` 内部 `delay = chaosLatency + realismWsDelay`，一次 setTimeout 合并，不叠加两次定时器。

**(4) 总开关与配置**

- **环境变量** `SIM_REALISM=1` 启动即开（默认关）；
- **运行时** `POST /sim/realism` 切换 + 调参：`{ enabled, httpDelayMinMs, ... }`，热生效；
- **面板** [`panel.ts`](src/sim/panel.ts:6) 工具区加「真实延时」开关 + 当前区间显示，配合 §6.7 指标卡展示「上次响应耗时」；
- **场景 YAML** 支持步骤级覆盖：`step: { realism: { enabled: true } }`，模拟「前半段流畅、后半段弱网」。

**(5) 配置外置**

realism 默认区间写入 `fixtures/sim/realism.jsonc`（原文档此处路径与括注后缀自相矛盾，写的是 `realism.json`（.jsonc，可热编辑）——已按 §4.4 的统一决策改为 `.jsonc`）：

```jsonc
// fixtures/sim/realism.jsonc — 还原真实后端延时，改完无需重启
{ "enabled": false, "httpDelayMinMs": 500, "httpDelayMaxMs": 3000,
  "wsDelayMinMs": 2000, "wsDelayMaxMs": 8000 }
```

走 §4 的 `FixtureLoader`，改区间即时生效。

#### 注意事项

| 项 | 说明 |
|---|---|
| 超时 | HTTP 3s 延时可能触发客户端超时；面板提示「realism 开启时部分请求接近超时阈值属正常」 |
| 测试 | 单测默认关 realism；e2e 场景显式开 realism 验证弱网 |
| 录制 | [`Recorder`](src/sim/recorder.ts:1) 记录真实耗时（含延时），回放时默认不重放延时，避免叠加 |
| 日志 | realism 延时走 `logger.debug('realism', ...)`，便于过滤 |

---

## 7. 分阶段落地计划

| 阶段 | 范围 | 风险 | 可独立交付 |
|---|---|---|---|
| **P1 数据外置** | 抽 `FixtureLoader`；`metadata`/`self_check`/`mappingCheck`/`fallback`/`rechargeSequence` 五处内联 → JSONC；`annotations.ts`+`chargingDock.ts` 整文件删除（静态地图数据以 `map_list.json` 为唯一来源，§11.3 决议 1）；保持路由层不变 | 低，纯数据搬家 + 加载层 | ✅ |
| **P2 数据集归档** | `data*/` → `fixtures/datasets/<语义>/`；补 manifest；更新 `MOCK_DATA_DIR` 解析与文档 | 中，涉及二进制文件移动 + 测试 | ✅ |
| **P3 目录重组** | `src/shared/{logger,ids,crc}.ts`→`src/infra/`，`src/shared/http.ts`→`src/http/shared/http.ts`（HTTP 层专用，不进 infra，见 §3.1；原方案在此处写成整个 `src/shared`→`src/infra`，与 §3.1 目录树矛盾，已改正）；`src/data` 拆为 `fixtures`+`assets`+`trajectory`；路由文件改名 `*.routes.ts` | 中，import 路径全改 | ✅ |
| **P4 大文件拆分** | `virtualRobot.ts` 963 行拆 6 文件（见 §3.2，含吸收 `taskBridge.ts`/`mappingTaskBridge.ts`）；`mowingTrajectory.ts` 算法/IO 分离。**仅拆 mock 侧适配代码，`src/sim/fsm-mirror/` 保持原位只读** | 高，FSM 适配逻辑易引入回归，需测试覆盖 | ⚠️ 需先补单测 |
| **P5 场景增强** | YAML `dataset`/`fixtures` 绑定；故障目录；运行时切数据集；录制回放 | 中，新增能力 | ✅ |
| **P5b 控制台 UI 重构** | panel.ts 拆分 + FSM 泳道图 + 事件流卡片 + 指标卡（见 §6.7） | 中，前端纯静态，需联调 `/sim/state` 字段 | ✅ |
| **P5c 真实延时模拟** | ✅ ChaosController 双模式 + HTTP/WS 延时注入 + realism 开关 + fixture 配置（见 §6.8） | 低-中，复用现有 chaos 基建 | ✅ |
| **P6 文档整合** | 见 §8 | 低 | ✅ |

**建议**：P1 先行，立即解决「改数据要重启」的最大痛点；P4 必须在测试覆盖率达标后再做。

---

## 8. 文档整合（对应要求 5）

### 8.1 docs 目录重组

```
docs/
├── README.md                # 【新】文档索引页，列全部文档一句话简介
├── usage-guide.md           # 【新】整合使用说明（见 8.2）
├── api.md                   # 保留，HTTP API 详表（单一信息源）
├── websocket.md             # 【新】从 README 抽出 WS 章节
├── scenarios.md             # 保留，场景脚本说明
├── data-dictionary.md       # 【新】数据字典（见 5.3）
├── fixtures-guide.md        # 【新】如何编辑 fixture + 热重载说明
├── panel-guide.md           # 【新】控制台 UI 使用说明（FSM 图/时间线/指标卡）
├── fsm-mirror.md            # 保留
├── mowing_trajectory.md     # 保留
├── ratel_backend_api.md     # 保留
└── refactor-plan.md         # 本文档
```

### 8.2 `usage-guide.md` 大纲（整合使用说明）

作为「单一入口」，整合现 README + 各散落说明：

1. **快速开始**：install / start / 默认地址
2. **环境变量**：表格（迁自 README）
3. **业务 HTTP API**：链接 `api.md`（不再在 README 重复）
4. **WebSocket API**：链接 `websocket.md`
5. **测试数据怎么改**（新章节，最重要）：
   - 改 API 返回值 → 编辑 `fixtures/**/*.jsonc`，**无需重启**
   - 改地图帧 → `fixtures/datasets/<name>/frames/`
   - 改场景 → `scenarios/*.yaml`
   - 校验 → `npm run check-fixtures`
6. **场景与数据集对照表**：链接 `data-dictionary.md`
7. **调试与日志**：日志分类、`/sim/state`、`/sim/panel`
8. **故障注入**：`fixtures/faults/` 用法
9. **控制台 UI**：链接 `panel-guide.md`，含 FSM 泳道图怎么看、时间线事件流怎么读、场景进度条怎么用
10. **开发指南**：链接 `CONTRIBUTING.md` + `fsm-mirror.md`

### 8.3 文档同步规则（强制）

依据用户自定义指令，**任何代码改动必须同步文档**：
- 新增/修改 fixture 结构 → 更新 `fixtures-guide.md` + `data-dictionary.md`；
- 新增路由 → 更新 `api.md` + `usage-guide.md` API 表；
- 新增场景 → 更新 `scenarios.md` + `data-dictionary.md` 对照表；
- PR 检查清单加入「docs 是否同步」一项。

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| fixture JSON 改坏导致运行时 500 | `FixtureLoader` 强制类型守卫 + `check-fixtures` 脚本 + 请求级 try/catch 返回明确错误 |
| `map_list.json` 9.9 万行每次 parse 慢 | mtime 缓存（§4.2），仅文件变化才重新 parse |
| 大文件拆分引入 FSM 回归 | P4 前补齐 `virtualRobot` 单测，依赖 [`__tests__/virtualRobot.test.ts`](__tests__/virtualRobot.test.ts:1) 扩充用例 |
| 数据集重命名破坏现有 `MOCK_DATA_DIR` 用户 | `MOCK_DATA_DIR` 可 hardcode 在代码里，本地变量可改、不经常修改（§11.3 决议 2）；P2 直接改 [`patches.ts`](src/data/patches.ts:6) `ALLOWED_DATASETS` Set + `resolveDatasetDir` 为新语义目录名，无需兼容旧名 |
| `.jsonc` 注释不被某些工具识别 | Loader 内置 strip-comments；`tsconfig`/编辑器已支持；CI 用 `check-fixtures` 兜底 |
| 误改 `src/sim/fsm-mirror/` 破坏同步 | 该目录由 [`sync-fsm-mirror.mjs`](scripts/sync-fsm-mirror.mjs:11) 生成且路径硬编码，重构全程禁止移动/修改；仅修正 mock 侧 import 引用路径。CI 增加「fsm-mirror 文件不得出现在 git diff」检查 |

---

## 10. 验收检查清单

- [ ] 所有 API 返回数据均可通过编辑 `fixtures/**/*.jsonc` 修改，无需重启 `tsx`
- [ ] `src/data/` 目录消失（含容易被漏掉的 `chargingDock.ts`），职责拆入 `fixtures/`/`assets/`/`trajectory/`
- [ ] `git diff` 确认 `src/sim/` 下无遗留文件未分类——尤其是原方案曾漏掉的 `pushChannels.ts`/`taskBridge.ts`/`mappingTaskBridge.ts`/`scenarioGuide.ts`/`simFsmTypes.ts`，均已在新结构中有明确归属
- [ ] `data/data2/data3/data4` 消失，替换为 `fixtures/datasets/<语义名>/` + manifest
- [ ] `virtualRobot.ts` < 300 行，回充/任务/设备逻辑各自独立文件
- [ ] `npm run check-fixtures` 通过
- [ ] `docs/README.md` 索引页存在，`usage-guide.md` 含「测试数据怎么改」章节
- [ ] 现有测试全部通过（`npm test`）
- [ ] `src/sim/fsm-mirror/` 目录内容未被改动（git diff 不含该路径），仅允许 mock 侧 import 路径修正
- [ ] `SIM_REALISM=1` 或 `POST /sim/realism` 开启后，HTTP 业务接口延时 0.5–3s、WS 推送延时 2–8s；关闭后即时响应；`/api/health`、`/sim/*` 控制面豁免延时
- [ ] `src/data/chargingDock.ts` 与 `src/data/annotations.ts` 均已删除；静态地图数据（含充电桩 type=69 point）以 `fixtures/maps/map_list.json` 为唯一来源（§11.3 决议 1），不建独立 annotations fixture
- [ ] `__tests__/` 保留原位原结构，未迁移（§11.3 决议 3）

---

## 11. 审计附录（第二轮查缺补漏）

本轮审计在首轮方案基础上逐文件核对 `src/` 全量，补充以下遗漏与澄清：

### 11.1 已修正项

| 项 | 首轮问题 | 修正 |
|---|---|---|
| 充电桩坐标（§1.2/§3.1/§4.3/§4.4） | 误把 [`chargingDock.ts`](src/data/chargingDock.ts:6) 的 `{0,0}` 当作「跨条目共享常量」，纠结拆分后是否破坏共享关系 | 实测 [`map_list.json`](map_list.json:4676) 39 张地图 type=69 坐标各异，**充电桩位置是每图独立数据、不存在统一值**。`chargingDock.ts`+`annotations.ts` 整文件删除，静态地图数据以 `map_list.json` 为唯一来源（§11.3 决议 1），不建 annotations fixture |
| `virtualRobot.ts` 行数（§3.2） | 写作 964 行 | 实际 963 行，已改正 |
| `createHttpHandler` 行号（§6.8） | 写作 :42 | 实际 :41，已改正 |
| HTTP 延时插入位置（§6.8） | 原描述会落在 `for (const route of ROUTES)` 循环体内，导致命中靠后 handler 时延时叠加 9 倍 | 改为循环前一次性算延时 + 控制面豁免判断，已给出正确代码 |
| `/sim/replay` 重复造轮子（§6.3） | 提议新建 `/sim/replay`，与既有 [`/sim/recorder/replay`](src/http/routes.sim.ts:155) 重复 | 改为扩展现有接口，不新建 |
| `src/shared` 拆分矛盾（§7 P3） | §3.1 树中 `http.ts`→`http/shared/`，但 P3 写成整个 `src/shared`→`src/infra` | 已改正：`http.ts` 归 HTTP 层，`logger/ids/crc` 归 `infra` |
| `.json`/`.jsonc` 混用（§4.4） | 多处混用 | 统一决策：API 响应类 fixture 用 `.jsonc`，`map_list.json`/manifest/faults 用 `.json` |
| `data3` 帧数（§5.2） | 示例写 60 | 实际约 749 组，改为脚本扫描生成，不手抄 |
| 遗漏文件归属（§3.1/§3.2） | `pushChannels.ts`/`taskBridge.ts`/`mappingTaskBridge.ts`/`scenarioGuide.ts`/`simFsmTypes.ts`/`chargingDock.ts` 在目录树中缺失 | 均已补入对应位置 |

### 11.2 结构归属澄清（原文档未明示）

| 现文件 | 归属 | 说明 |
|---|---|---|
| [`src/ws/`](src/ws/wsServer.ts:1)（`wsServer`/`inbound`/`outbound`/`protocol` 4 文件） | 保留 `src/ws/` 原位 | WebSocket 接入层，职责单一，无需重组；§6.8 realism 延时注入点在 [`outbound.ts`](src/ws/outbound.ts:38) |
| [`src/auth/`](src/auth/jwt.ts:1)（`jwt`/`ticket` 2 文件） | 保留 `src/auth/` 原位 | 鉴权层独立，无需移动 |
| [`src/http/routes.health.ts`](src/http/routes.health.ts:1) | → `src/http/routes/health.routes.ts` | 随路由文件统一改名 `*.routes.ts` 一并迁入 `routes/` 子目录 |
| [`src/shared/http.ts`](src/shared/http.ts:1) | → `src/http/shared/http.ts` | 含 `RouteHandler`/`sendJson`/`readJsonBody` 等 HTTP 专用工具，属 HTTP 层而非通用 infra；与 `logger/ids/crc` 分离 |
| [`src/http/mappingCheckResponse.ts`](src/http/mappingCheckResponse.ts:1) | → `src/http/routes/mappingCheck.builder.ts` 或 `src/sim/MappingCheck.ts` | 当前是「按 robot 状态构造响应」的纯函数，既非路由也非数据。建议归入 `sim/`（依赖 VirtualRobot）或作为 mapping 路由的私有 builder，二选一在 P3 定稿 |

### 11.3 开放问题决议（已确认）

1. **`map_list.json` 与 annotations fixture 的关系** —— ✅ **已决议：以 `map_list.json` 为唯一准，不再需要 annotations fixture**。静态地图数据（含 increments、充电桩 type=69 point）全部来自 `map/list` API 对应的 [`map_list.json`](map_list.json:1)。原 [`annotations.ts`](src/data/annotations.ts:37) 的 10 个 `store.set` 硬编码条目整文件删除，**不拆出独立 annotations fixture**。`semantic/save` 写入的运行时增量仍保留在内存 Map（运行态，非 fixture），覆盖 `map_list.json` 的对应 item。§4.3 清单与 §3.1 目录树已据此修订。
2. **`MOCK_DATA_DIR` 与 datasets 的兼容映射** —— ✅ **已决议：`MOCK_DATA_DIR` 可 hardcode 在代码里，本地变量可改，不经常修改**。§9 风险表中「保留旧目录名兼容映射一个版本」的对策取消——无需兼容旧名，P2 直接把 `ALLOWED_DATASETS` Set 与 `resolveDatasetDir` 改为新语义目录名即可，[`patches.ts`](src/data/patches.ts:6) 的 Set 同步更新。
3. **`__tests__/` → `tests/` 迁移** —— ✅ **已决议：非必须，不改 test 目录**。[`__tests__/`](__tests__/auth.test.ts:1) 保留原位原结构，§3.1 目录树中的 `tests/` 行删除，§7 P3 不含测试目录迁移，[`package.json`](package.json:10) `test` 脚本不动。
4. **recordings/ 命名** —— ✅ **已确认**：§6.3 提议 `<scenario>_<timestamp>.jsonl`，录制时场景未运行则 fallback 为 `manual_<timestamp>.jsonl`。
