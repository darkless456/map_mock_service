/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mapping/MappingSession.ts. DO NOT EDIT. !!!
// Source SHA-256: d8b7e93f421dbb8bc9a1d825b4ed08667832ca77e44e211c289cec1d00e3f41d
// Synced at: 2026-07-06T12:55:44.977Z
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
  | 'MAP_FOLLOW_BOUNDARY'
  | 'MAP_FOLLOW_BOUNDARY_LOST' // DVT P-2: 沿边丢失，独立异常 phase，区别于初始 MAP_SCAN_BOUNDARY_FAILED
  | 'MAP_FOLLOW_BOUNDARY_MANUAL'
  | 'MAP_BOUNDARY_DONE'
  | 'MAP_COVERAGE_PROBE'
  | 'MAP_COVERAGE_NEW_AREA'
  | 'MAP_COVERAGE_RUN'
  | 'MAP_COVERAGE_DONE'
  | 'MAP_COMPLETE'; // DVT P-1: 建图完成三按钮页，跳过 COVERAGE 阶段后的终态

export type RechargePhase = 'returning' | 'charging' | 'charged';
export type MappingPhase = MappingBusinessPhase | RechargePhase;
export type MappingState = TaskState;

export const MAPPING_PHASES: readonly MappingBusinessPhase[] = [
  'MAP_SCAN_BOUNDARY',
  'MAP_SCAN_BOUNDARY_FAILED',
  'MAP_FOLLOW_BOUNDARY',
  'MAP_FOLLOW_BOUNDARY_LOST',
  'MAP_FOLLOW_BOUNDARY_MANUAL',
  'MAP_BOUNDARY_DONE',
  'MAP_COVERAGE_PROBE',
  'MAP_COVERAGE_NEW_AREA',
  'MAP_COVERAGE_RUN',
  'MAP_COVERAGE_DONE',
  'MAP_COMPLETE',
] as const;

export const ALL_MAPPING_STATES = TASK_STATES;
export const MAPPING_TERMINAL_PHASES: readonly MappingPhase[] = [
  'MAP_COVERAGE_DONE',
  'MAP_COMPLETE', // DVT P-1: 三按钮页也是终态
] as const;

export type MappingContext = TaskContext<MappingPhase>;

export const initialMappingState: MappingContext =
  createInitialTaskContext<MappingPhase>();

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
  | { readonly type: 'RECONCILE_PAUSED' };
export type MappingEventType = MappingEvent['type'];

/**
 * 急停 / 能力 / 通知属于正交事件：即便处于 `MAP_COVERAGE_DONE` 粘滞预览，
 * 也必须放行（急停要能打断、能力/通知要能更新）。
 */
const ORTHOGONAL_DEVICE_EVENTS: ReadonlySet<MappingEventType> = new Set([
  'DEVICE_ESTOP',
  'DEVICE_CAPABILITIES',
  'DEVICE_NOTICE',
]);

const baseReducer = createTaskReducer<MappingPhase>({
  domain: 'mapping',
  terminalPhases: MAPPING_TERMINAL_PHASES,
  // 进入遥控的业务例外：寻边 + 沿边阶段允许切手摇——寻边（`MAP_SCAN_BOUNDARY`）、
  // 自动沿边（`MAP_FOLLOW_BOUNDARY`）与覆盖前探边（`MAP_COVERAGE_PROBE`）。离桩 /
  // 沿边闭合 Loading / 弓形覆盖 / 预览均禁止；主守卫仍需 `PAUSED` + `canSwitchManual`。
  canEnterRemote: ctx =>
    ctx.phase === 'MAP_SCAN_BOUNDARY' ||
    ctx.phase === 'MAP_FOLLOW_BOUNDARY' ||
    ctx.phase === 'MAP_FOLLOW_BOUNDARY_LOST' || // DVT P-2: 沿边丢失后也可切遥控
    ctx.phase === 'MAP_COVERAGE_PROBE',
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
  // Sticky terminal-phase guard: both `MAP_COVERAGE_DONE` (legacy) and `MAP_COMPLETE` (DVT P-1)
  // are terminal display phases — once reached the UI freezes on the finish/preview panel until
  // the user explicitly acts (CMD_* events). Device-originated events (return_dock, charging,
  // errors, area, etc.) are silenced. Orthogonal events (estop / capabilities / notice) still pass.
  if (
    (ctx.phase === 'MAP_COVERAGE_DONE' || ctx.phase === 'MAP_COMPLETE') &&
    !event.type.startsWith('CMD_') &&
    !ORTHOGONAL_DEVICE_EVENTS.has(event.type)
  ) {
    return ctx;
  }

  // DVT P-1: skip COVERAGE阶段。设备上报任何 MAP_COVERAGE_* sub_status 时，直接流转到 MAP_COMPLETE
  // 而非进入覆盖建图流程。这涵盖 bow_cover / new_area / exit_mapping 等所有覆盖子状态。
  if (
    event.type === 'DEVICE_PHASE' &&
    (event.phase === 'MAP_COVERAGE_PROBE' ||
      event.phase === 'MAP_COVERAGE_NEW_AREA' ||
      event.phase === 'MAP_COVERAGE_RUN' ||
      event.phase === 'MAP_COVERAGE_DONE') &&
    ctx.state === 'WORKING' &&
    ctx.phase === 'MAP_BOUNDARY_DONE'
  ) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'WORKING',
        phase: 'MAP_COMPLETE',
        resumeTo: null,
        error: null,
      },
      event,
      logger,
    );
  }

  if (event.type === 'DEVICE_WORK_STATUS') {
    return reduceWorkStatus(ctx, event, logger);
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
  // - 寻边失败：WORKING + MAP_SCAN_BOUNDARY_FAILED → 直接进入 REMOTE_CONTROL
  //   （设备已停止，无需暂停，对齐设计 §5.3）。
  // - 常规切手摇：PAUSED + 能力允许 + 业务阶段适配 → 标记 mode='remote'，
  //   后续后端 edge_mapping 经升级规则归一为 MAP_FOLLOW_BOUNDARY_MANUAL 后交接。
  if (event.type === 'CMD_SWITCH_MANUAL') {
    if (!ctx.capabilities.canSwitchManual) return ctx;

    // 寻边失败 / 沿边丢失：设备已停止，无暂停概念，直接进 REMOTE_CONTROL
    // MAP_FOLLOW_BOUNDARY_LOST 同样直接切遥控（DVT P-2）
    if (
      ctx.state === 'WORKING' &&
      (ctx.phase === 'MAP_SCAN_BOUNDARY_FAILED' ||
        ctx.phase === 'MAP_FOLLOW_BOUNDARY_LOST')
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

    // 常规切手摇：仅标记意图，等后端 edge_mapping
    if (ctx.state !== 'PAUSED') return ctx;
    if (
      ctx.phase !== 'MAP_SCAN_BOUNDARY' &&
      ctx.phase !== 'MAP_FOLLOW_BOUNDARY' &&
      ctx.phase !== 'MAP_COVERAGE_PROBE'
    ) {
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
    (ctx.phase === 'MAP_FOLLOW_BOUNDARY' || ctx.phase === 'MAP_COVERAGE_PROBE')
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

  // 确认进入内部覆盖（CMD_START_COVERAGE）：乐观先行推进到弓形覆盖，
  // 设备随后上报 bow_cover 落位（与 cmdStart / cmdPause 的乐观模式一致）。
  if (event.type === 'CMD_START_COVERAGE') {
    if (ctx.state === 'WORKING' && ctx.phase === 'MAP_BOUNDARY_DONE') {
      return commit(
        ctx,
        { ...ctx, phase: 'MAP_COVERAGE_RUN', error: null },
        event,
        logger,
      );
    }
    return ctx;
  }

  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_COVERAGE_DONE' &&
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

  return baseReducer(ctx, event, logger);
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
      },
      event,
      logger,
    );
  }

  if (event.status === 'mapping_completed') {
    if (ctx.state === 'CANCELLED') return ctx;
    // DVT P-1: 建图完成直接进三按钮页（MAP_COMPLETE），跳过覆盖建图
    return commit(
      ctx,
      {
        ...ctx,
        state: 'COMPLETED',
        phase: 'MAP_COMPLETE',
        resumeTo: null,
        error: null,
        notices: [],
      },
      event,
      logger,
    );
  }

  return baseReducer(ctx, event, logger);
}

function reduceRecoverableError(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'DEVICE_ERROR' }>,
  logger?: LoggerLike,
): MappingContext {
  if (ctx.state !== 'WORKING') return baseReducer(ctx, event, logger);

  // DVT P-2: 沿边中（MAP_FOLLOW_BOUNDARY）丢失边缘 → MAP_FOLLOW_BOUNDARY_LOST
  // 其他阶段的可恢复错误仍回退到 MAP_SCAN_BOUNDARY_FAILED（寻边失败）
  const failPhase: MappingBusinessPhase =
    ctx.phase === 'MAP_FOLLOW_BOUNDARY'
      ? 'MAP_FOLLOW_BOUNDARY_LOST'
      : 'MAP_SCAN_BOUNDARY_FAILED';

  return commit(
    ctx,
    {
      ...ctx,
      phase: failPhase,
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
    a.error === b.error
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
