/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mapping/MappingSession.ts. DO NOT EDIT. !!!
// Source SHA-256: c741a343f727c0026d5e94c66aa114fc4722eb4ae12770631c27bca7ed11b0af
// Synced at: 2026-07-13T09:08:25.761Z
/**
 * MappingSession FSM — task-level `TaskState` + `MappingPhase` tuple from
 * `TaskFSM`. UI binding resolves a `PanelScene` directly from `(state, phase)`
 * via `resolvePanelScene` in `features/mapping/state`.
 */

import {
  createInitialTaskContext,
  createTaskReducer,
  TASK_STATES,
  TERMINAL_TASK_STATES,
  type DeviceEventSource,
  type RobotWorkStatus,
  type TaskContext,
  type TaskEvent,
  type TaskSource,
  type TaskState,
} from '../shared/TaskFSM';
import { safeLog, type LoggerLike } from '../shared/LoggerLike';

// ─── Phase model ───────────────────────────────────────────────────────

export type MappingBusinessPhase =
  | 'MAP_SCAN_BOUNDARY'
  | 'MAP_SCAN_BOUNDARY_FAILED'
  | 'MAP_UNDOCKING_FAILED'
  | 'MAP_FOLLOW_BOUNDARY'
  | 'MAP_FOLLOW_BOUNDARY_FAILED'
  | 'MAP_FOLLOW_BOUNDARY_MANUAL'
  | 'MAP_BOUNDARY_DONE'
  | 'MAP_COMPLETING';

export type RechargePhase = 'returning' | 'charging' | 'charged';
export type MappingPhase = MappingBusinessPhase | RechargePhase;
export type MappingState = TaskState;

export const MAPPING_PHASES: readonly MappingBusinessPhase[] = [
  'MAP_SCAN_BOUNDARY',
  'MAP_SCAN_BOUNDARY_FAILED',
  'MAP_UNDOCKING_FAILED',
  'MAP_FOLLOW_BOUNDARY',
  'MAP_FOLLOW_BOUNDARY_FAILED',
  'MAP_FOLLOW_BOUNDARY_MANUAL',
  'MAP_BOUNDARY_DONE',
  'MAP_COMPLETING',
] as const;

export const ALL_MAPPING_STATES = TASK_STATES;
export const MAPPING_TERMINAL_PHASES: readonly MappingPhase[] = [
  'MAP_COMPLETING',
] as const;

/** 退桩失败错误码（对齐割草域 `RETURN_DOCK_FAILED_CODE` 风格）。仅预留，不接转移规则。 */
export const MAP_UNDOCKING_FAILED_CODE = 'mapping.undocking_failed';

/** 建图域专属信号：驱动手摇"开始"/"完成"按钮可用性与草坪数展示，不进共享 `TaskContext`。 */
export interface MappingSignals {
  readonly canStartFollowBoundary: boolean;
  readonly canCloseBoundary: boolean;
  readonly lawnCount: number | null;
}

export type MappingContext = TaskContext<MappingPhase> & MappingSignals;

export const initialMappingState: MappingContext = {
  ...createInitialTaskContext<MappingPhase>(),
  canStartFollowBoundary: false,
  canCloseBoundary: false,
  lawnCount: null,
};

// ─── Events ────────────────────────────────────────────────────────────

/**
 * `RECONCILE_STARTED` / `RECONCILE_PAUSED` — 任务级 WS 推送（`RATEL_MAPPING_TASK`）
 * 与建图任务列表对齐时使用的"确认/兜底对齐"事件，镜像 `MowingTask.ts` 的同名事件。
 *
 * 与 `DEVICE_PHASE`/`DEVICE_WORK_STATUS` 不同：这两个事件**不携带相位信息**（新任务
 * 通道只有粗粒度 `task_status`），因此仅在本地 FSM 仍处于 `IDLE`（尚不知晓有任务）时
 * 才生效，只负责把状态从 IDLE 推进到 WORKING/PAUSED，具体 phase 仍完全依赖
 * `work_status/sub_status` 遥测通道后续推送来填充——不得用于驱动或抢占相位推进。
 */
export type MappingEvent =
  | TaskEvent<MappingPhase>
  | { readonly type: 'RECONCILE_STARTED' }
  | { readonly type: 'RECONCILE_PAUSED' }
  | {
      readonly type: 'DEVICE_FOLLOW_BOUNDARY_READY';
      readonly ready: boolean;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_BOUNDARY_CLOSABLE';
      readonly closable: boolean;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_LAWN_COUNT';
      readonly lawnCount: number;
      readonly source: DeviceEventSource;
      readonly ts: number;
    };
export type MappingEventType = MappingEvent['type'];

const baseReducer = createTaskReducer<MappingPhase>({
  domain: 'mapping',
  terminalPhases: MAPPING_TERMINAL_PHASES,
  // 进入遥控的业务例外：寻边 + 沿边阶段允许切手摇——寻边（`MAP_SCAN_BOUNDARY`）与
  // 自动沿边（`MAP_FOLLOW_BOUNDARY`）。离桩 / 沿边闭合 Loading / 等待建图结束均禁止；
  // 主守卫仍需 `PAUSED` + `canSwitchManual`。
  canEnterRemote: ctx =>
    ctx.phase === 'MAP_SCAN_BOUNDARY' || ctx.phase === 'MAP_FOLLOW_BOUNDARY',
});

/**
 * Pure FSM transition. Returns the SAME context reference when the event is
 * illegal in the current state so callers can detect no-op transitions with
 * `next === prev`.
 */
export function mappingReducer(
  ctx: MappingContext,
  event: MappingEvent,
  logger?: LoggerLike,
): MappingContext {
  // `MAP_COMPLETING` means the device is waiting for mapping completion. It is not a local
  // sticky state: all subsequent device events continue through the normal FSM path so an
  // authoritative device transition immediately selects its corresponding UI.
  if (event.type === 'DEVICE_WORK_STATUS') {
    return reduceWorkStatus(ctx, event, logger);
  }

  // 建图域专属信号：驱动手摇"开始"/"完成"按钮可用性与草坪数展示。non-IDLE 随时生效；
  // 幂等更新依赖 commit()/sameContext() 已把这三个字段纳入比较（同值推送返回同引用）。
  if (event.type === 'DEVICE_FOLLOW_BOUNDARY_READY') {
    if (ctx.state === 'IDLE') return ctx;
    return commit(ctx, { ...ctx, canStartFollowBoundary: event.ready }, event, logger);
  }
  if (event.type === 'DEVICE_BOUNDARY_CLOSABLE') {
    if (ctx.state === 'IDLE') return ctx;
    return commit(ctx, { ...ctx, canCloseBoundary: event.closable }, event, logger);
  }
  if (event.type === 'DEVICE_LAWN_COUNT') {
    if (ctx.state === 'IDLE') return ctx;
    return commit(ctx, { ...ctx, lawnCount: event.lawnCount }, event, logger);
  }

  // 断链 / 复位：这三个字段的重置语义比照 capabilities（见 TaskFSM.ts 对应分支）——
  // LINK_BLE_DOWN/LINK_WS_DOWN/LINK_NET_LOST 在通用层无一例外都会把 capabilities 重置为
  // 默认值（含 ESTOPPED 态），这里统一同步重置。必须在此拦截并 return：baseReducer 的类型
  // 只认 TaskEvent<MappingPhase>，且它的返回值不携带这三个建图域专属字段，需要在这里补上。
  if (
    event.type === 'LINK_BLE_DOWN' ||
    event.type === 'LINK_WS_DOWN' ||
    event.type === 'LINK_NET_LOST'
  ) {
    const next = baseReducer(ctx, event, logger);
    if (next === ctx) return ctx;
    return { ...next, canStartFollowBoundary: false, canCloseBoundary: false, lawnCount: null };
  }

  // CMD_RESET：通用层只有"终态 → 全新 createInitialTaskContext"这条路径才会把 capabilities
  // 落回默认值；ESTOPPED 态触发时只是 spread ctx，不重置 capabilities（现状行为，非本次引入）。
  // 这三个字段镜像同样的取舍：终态复位回默认值，ESTOPPED 复位原样保留。
  if (event.type === 'CMD_RESET') {
    const next = baseReducer(ctx, event, logger);
    if (next === ctx) return ctx;
    if (ctx.state === 'ESTOPPED') {
      return {
        ...next,
        canStartFollowBoundary: ctx.canStartFollowBoundary,
        canCloseBoundary: ctx.canCloseBoundary,
        lawnCount: ctx.lawnCount,
      };
    }
    return { ...next, canStartFollowBoundary: false, canCloseBoundary: false, lawnCount: null };
  }

  // 任务级 WS 推送（RATEL_MAPPING_TASK）/ 任务列表对齐：仅在本地仍处于 IDLE
  // （例如重连后发现设备正在建图）时生效，绝不覆盖或倒退已经更靠后的相位——
  // 具体业务 phase 仍完全交给后续 work_status/sub_status 遥测通道去填充。
  if (event.type === 'RECONCILE_STARTED') {
    if (ctx.state !== 'IDLE') return ctx;
    return commit(
      ctx,
      { ...ctx, state: 'WORKING', mode: 'auto', resumeTo: null, error: null },
      event,
      logger,
    );
  }

  if (event.type === 'RECONCILE_PAUSED') {
    if (ctx.state !== 'IDLE') return ctx;
    return commit(
      ctx,
      {
        ...ctx,
        state: 'PAUSED',
        mode: 'auto',
        resumeTo: { state: 'WORKING', phase: ctx.phase },
        error: null,
      },
      event,
      logger,
    );
  }

  // CMD_SWITCH_MANUAL：标记遥控意图，走后端驱动路径。
  // - 寻边失败/沿边丢失边界：WORKING + MAP_SCAN_BOUNDARY_FAILED|MAP_FOLLOW_BOUNDARY_FAILED
  //   → 直接进入 REMOTE_CONTROL（设备已停止，无需暂停，对齐设计 §5.3）。
  // - 暂停寻边切手摇：PAUSED + MAP_SCAN_BOUNDARY → 直接同步完成交接（phase 不变）。
  //   寻边阶段后端不会推送 edge_mapping 回声，没有可等待的完成事件，
  //   不能走下面"仅标记意图"的路径，否则会永久卡在 PAUSED。
  // - 常规切手摇（沿边中）：PAUSED + 能力允许 + 业务阶段适配 → 标记 mode='remote'，
  //   后续后端 edge_mapping 经升级规则归一为 MAP_FOLLOW_BOUNDARY_MANUAL 后交接。
  if (event.type === 'CMD_SWITCH_MANUAL') {
    if (!ctx.capabilities.canSwitchManual) return ctx;

    // 寻边失败/沿边丢失边界：设备已停止，无暂停概念，直接进 REMOTE_CONTROL
    if (
      ctx.state === 'WORKING' &&
      (ctx.phase === 'MAP_SCAN_BOUNDARY_FAILED' ||
        ctx.phase === 'MAP_FOLLOW_BOUNDARY_FAILED')
    ) {
      return commit(
        ctx,
        {
          ...ctx,
          state: 'REMOTE_CONTROL',
          mode: 'remote',
          phase: 'MAP_FOLLOW_BOUNDARY_MANUAL',
          resumeTo: { state: 'WORKING', phase: 'MAP_FOLLOW_BOUNDARY' },
          error: null,
        },
        event,
        logger,
      );
    }

    if (ctx.state !== 'PAUSED') return ctx;

    // 暂停寻边切手摇：没有后端回声可等待，直接同步完成交接。
    if (ctx.phase === 'MAP_SCAN_BOUNDARY') {
      return commit(
        ctx,
        {
          ...ctx,
          state: 'REMOTE_CONTROL',
          mode: 'remote',
          error: null,
        },
        event,
        logger,
      );
    }

    // 常规切手摇（沿边中）：仅标记意图，等后端 edge_mapping
    if (ctx.phase !== 'MAP_FOLLOW_BOUNDARY') {
      return ctx;
    }
    return { ...ctx, mode: 'remote' };
  }

  // 后端 edge_mapping 在遥控模式下直接升级为 MAP_FOLLOW_BOUNDARY_MANUAL：
  // - DeviceStart：CMD_START 已设 mode='remote'
  // - CreateMap：CMD_SWITCH_MANUAL 已设 mode='remote'
  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_FOLLOW_BOUNDARY' &&
    ctx.mode === 'remote'
  ) {
    return mappingReducer(
      ctx,
      {
        type: 'DEVICE_PHASE',
        phase: 'MAP_FOLLOW_BOUNDARY_MANUAL',
        source: event.source,
        ts: event.ts,
      },
      logger,
    );
  }

  // 自动沿边暂停后切手摇：后端 edge_mapping 归一为 MAP_FOLLOW_BOUNDARY_MANUAL
  // 后经此规则交接到 REMOTE_CONTROL。
  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_FOLLOW_BOUNDARY_MANUAL' &&
    ctx.state === 'PAUSED' &&
    ctx.capabilities.canSwitchManual &&
    ctx.phase === 'MAP_FOLLOW_BOUNDARY'
  ) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'REMOTE_CONTROL',
        mode: 'remote',
        phase: 'MAP_FOLLOW_BOUNDARY_MANUAL',
        resumeTo: ctx.resumeTo ?? {
          state: 'WORKING',
          phase: ctx.phase,
        },
        error: null,
      },
      event,
      logger,
    );
  }

  // DeviceStart 入口：远程建图先由 HTTP ratel_mapping_task/create 发起任务，再 task=5
  // MAP_FOLLOW_BOUNDARY_MANUAL，即可直接交接到横屏手摇宿主。
  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_FOLLOW_BOUNDARY_MANUAL' &&
    ctx.mode === 'remote' &&
    (ctx.state === 'PREPARING' ||
      ctx.state === 'UNDOCKING' ||
      ctx.state === 'WORKING' ||
      ctx.state === 'RESUMING')
  ) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'REMOTE_CONTROL',
        phase: 'MAP_FOLLOW_BOUNDARY_MANUAL',
        resumeTo: { state: 'WORKING', phase: 'MAP_FOLLOW_BOUNDARY' },
        error: null,
      },
      event,
      logger,
    );
  }

  // 沿边闭合：手摇态收到 map_edge_finish（MAP_BOUNDARY_DONE）→ 设备驱动退出遥控，
  // 回到自动 WORKING，进入「沿边闭合 Loading + 确认进覆盖」闸门。
  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_BOUNDARY_DONE' &&
    ctx.state === 'REMOTE_CONTROL'
  ) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'WORKING',
        mode: 'auto',
        phase: 'MAP_BOUNDARY_DONE',
        resumeTo: null,
        error: null,
      },
      event,
      logger,
    );
  }

  // 暂停/恢复中收到"等待建图结束"：通用层 `DEVICE_PHASE` case 不处理 PAUSED 态，
  // 需域层补，行为与 WORKING 下的落位一致（落 WORKING + phase = 等待建图结束）。
  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_COMPLETING' &&
    (ctx.state === 'PAUSED' || ctx.state === 'RESUMING')
  ) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'WORKING',
        phase: event.phase,
        resumeTo: null,
        error: null,
      },
      event,
      logger,
    );
  }

  if (event.type === 'DEVICE_ERROR' && event.recoverable) {
    return reduceRecoverableError(ctx, event, logger);
  }

  return asMappingContext(baseReducer(ctx, event, logger));
}

/**
 * `baseReducer` 的返回类型是 `TaskContext<MappingPhase>`，不携带 `canStartFollowBoundary`/
 * `canCloseBoundary`/`lawnCount`。这三个"生成全新 context、丢失建图域字段"的唯一真实来源是
 * `CMD_RESET` 从终态触发时的 `createInitialTaskContext`——已在 `mappingReducer` 顶部单独
 * 拦截并显式补齐，不会到达下面这三处兜底调用点。除此之外，`baseReducer` 内部所有分支都是
 * 对输入 `ctx` 的 spread，运行时始终携带这三个字段——这里只是把 TS 静态类型补回来。
 */
function asMappingContext(next: TaskContext<MappingPhase>): MappingContext {
  return next as MappingContext;
}

export function isMappingTerminal(ctx: MappingContext): boolean {
  return TERMINAL_TASK_STATES.has(ctx.state);
}

export function isMappingPaused(ctx: MappingContext): boolean {
  return ctx.state === 'PAUSED';
}

function reduceWorkStatus(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'DEVICE_WORK_STATUS' }>,
  logger?: LoggerLike,
): MappingContext {
  // 建图：仅 `leave_dock` → DEVICE_UNDOCKED 进入离桩；`work_status:mapping` 在自检阶段保持 PREPARING。
  if (
    ctx.state === 'PREPARING' &&
    (event.status === 'mapping' || event.status === 'mowing')
  ) {
    return ctx;
  }

  // 恢复确认（对齐割草 markRunning，见 build-docs/pause_resume_contract_design.md §3.1）：
  // 设备无「已恢复」专用态，`RESUMING` 期间活跃 `work_status: mapping` 推送视为恢复落地 →
  // `WORKING`（phase 复用 `resumeTo`）。仅 `RESUMING` 生效，`PAUSED` 不因周期性 `mapping`
  // 推送自动恢复（恢复须由用户 CMD_RESUME 触发）。
  //
  // 仅当存在可恢复的**工作 phase** 时才由 work_status 解除：退桩 / 自检阶段暂停（`UNDOCKING`/
  // `PREPARING`，`resumeTo.phase === null`）时，`work_status` 不带 phase，若据此落 `WORKING`
  // 会得到 `WORKING + phase=null`——该组合无任何按钮规则匹配，导致底部按钮消失。这类暂停应
  // 等待设备上报实际 `DEVICE_PHASE`（寻边等）再落 `WORKING`（由通用层宽松匹配处理）。
  const resumePhase = ctx.resumeTo?.phase ?? ctx.phase;
  if (
    ctx.state === 'RESUMING' &&
    event.status === 'mapping' &&
    resumePhase !== null
  ) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'WORKING',
        phase: resumePhase,
        resumeTo: null,
        error: null,
        pausedReason: null,
      },
      event,
      logger,
    );
  }

  // `mapping_completed` 是瞬时信号，不再作为"结束建图"的驱动信号（见设计稿 §4.3 #1）。
  // 不重映射，落 baseReducer 的 `DEVICE_WORK_STATUS` case（不识别该值）安全 no-op。
  return asMappingContext(baseReducer(ctx, event, logger));
}

function reduceRecoverableError(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'DEVICE_ERROR' }>,
  logger?: LoggerLike,
): MappingContext {
  if (ctx.state !== 'WORKING') return asMappingContext(baseReducer(ctx, event, logger));
  // 出错前处于自动沿边阶段 → 沿边丢失边界；其余（寻边等）沿用寻边失败态。
  const failedPhase: MappingBusinessPhase =
    ctx.phase === 'MAP_FOLLOW_BOUNDARY'
      ? 'MAP_FOLLOW_BOUNDARY_FAILED'
      : 'MAP_SCAN_BOUNDARY_FAILED';
  return commit(
    ctx,
    {
      ...ctx,
      phase: failedPhase,
      error: { code: event.code, recoverable: true },
    },
    event,
    logger,
  );
}

function commit(
  prev: MappingContext,
  next: MappingContext,
  event: {
    readonly type: string;
    readonly source?: DeviceEventSource;
    readonly ts?: number;
  },
  logger?: LoggerLike,
): MappingContext {
  const stamped = {
    ...next,
    lastSource: sourceFromEvent(event),
    lastSourceTs: typeof event.ts === 'number' ? event.ts : Date.now(),
  };
  if (sameContext(prev, stamped)) return prev;
  if (prev.state !== stamped.state) {
    safeLog(
      logger,
      'info',
      'mapping.fsm.transition',
      `${prev.state} -> ${stamped.state}`,
      {
        from: prev.state,
        to: stamped.state,
        event,
        source: stamped.lastSource,
        ts: stamped.lastSourceTs,
      },
    );
  }
  return stamped;
}

function sameContext(a: MappingContext, b: MappingContext): boolean {
  return (
    a.state === b.state &&
    a.phase === b.phase &&
    a.area === b.area &&
    a.battery === b.battery &&
    a.resumeTo === b.resumeTo &&
    a.error === b.error &&
    a.canStartFollowBoundary === b.canStartFollowBoundary &&
    a.canCloseBoundary === b.canCloseBoundary &&
    a.lawnCount === b.lawnCount
  );
}

function sourceFromEvent(event: {
  readonly type: string;
  readonly source?: DeviceEventSource;
}): TaskSource {
  if (event.type.startsWith('CMD_')) return 'cmd';
  if (event.type === 'TIMEOUT') return 'timeout';
  if (event.source) return event.source;
  if (event.type.startsWith('LINK_WS')) return 'ws';
  if (event.type.startsWith('LINK_BLE')) return 'ble';
  return 'ws';
}

export type { RobotWorkStatus };
