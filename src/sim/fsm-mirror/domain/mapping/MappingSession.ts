/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mapping/MappingSession.ts. DO NOT EDIT. !!!
// Source SHA-256: fe9309dc8cc569fa37411b17b7579c157dd72beefec7eaef193b176681253432
// Synced at: 2026-06-11T08:30:38.383Z
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
  | 'MAP_FOLLOW_BOUNDARY_MANUAL'
  | 'MAP_BOUNDARY_DONE'
  | 'MAP_COVERAGE_PROBE'
  | 'MAP_COVERAGE_NEW_AREA'
  | 'MAP_COVERAGE_RUN'
  | 'MAP_COVERAGE_DONE';

export type RechargePhase = 'returning' | 'charging' | 'charged';
export type MappingPhase = MappingBusinessPhase | RechargePhase;
export type MappingState = TaskState;

export const MAPPING_PHASES: readonly MappingBusinessPhase[] = [
  'MAP_SCAN_BOUNDARY',
  'MAP_SCAN_BOUNDARY_FAILED',
  'MAP_FOLLOW_BOUNDARY',
  'MAP_FOLLOW_BOUNDARY_MANUAL',
  'MAP_BOUNDARY_DONE',
  'MAP_COVERAGE_PROBE',
  'MAP_COVERAGE_NEW_AREA',
  'MAP_COVERAGE_RUN',
  'MAP_COVERAGE_DONE',
] as const;

export const ALL_MAPPING_STATES = TASK_STATES;
export const MAPPING_TERMINAL_PHASES: readonly MappingPhase[] = [
  'MAP_COVERAGE_DONE',
] as const;

export type MappingContext = TaskContext<MappingPhase>;

export const initialMappingState: MappingContext =
  createInitialTaskContext<MappingPhase>();

// ─── Events ────────────────────────────────────────────────────────────

export type MappingEvent = TaskEvent<MappingPhase>;
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
  // 进入遥控的业务例外（D5）：仅「沿边阶段」允许切手摇——自动沿边
  // （`MAP_FOLLOW_BOUNDARY`）与覆盖前探边（`MAP_COVERAGE_PROBE`）。离桩 / 寻边 /
  // 闭合 Loading / 弓形覆盖 / 预览均禁止；主守卫仍需 `PAUSED` + `canSwitchManual`。
  canEnterRemote: ctx =>
    ctx.phase === 'MAP_FOLLOW_BOUNDARY' || ctx.phase === 'MAP_COVERAGE_PROBE',
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
  // `MAP_COVERAGE_DONE` is the sticky map-preview step: once internal coverage finishes
  // (`exit_mapping` → `MAP_COVERAGE_DONE`), the UI shows the preview panel + save countdown
  // and must NOT react to any further device-originated status (e.g. `return_dock` →
  // `returning`, `charging`, low battery, errors, link/timeout, area). Only `CMD_*` events
  // act — the `mapping→idle` edge's `CMD_CONFIRM` still completes the task, and
  // save / cancel / reset still work. This keeps the preview frozen until the user decides.
  if (
    ctx.phase === 'MAP_COVERAGE_DONE' &&
    !event.type.startsWith('CMD_') &&
    !ORTHOGONAL_DEVICE_EVENTS.has(event.type)
  ) {
    return ctx;
  }

  if (event.type === 'DEVICE_WORK_STATUS') {
    return reduceWorkStatus(ctx, event, logger);
  }

  // 手摇交接：收到后端 edge_mapping（MAP_FOLLOW_BOUNDARY）且当前为手摇模式
  // → 把控制权交给用户。
  // `resumeTo` 指向自动沿边，使用户中途「退出遥控」时落回自动沿边（非手摇 phase）。
  if (
    event.type === 'DEVICE_PHASE' &&
    event.phase === 'MAP_FOLLOW_BOUNDARY' &&
    ctx.state === 'WORKING' &&
    ctx.mode === 'remote'
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
      { ...ctx, state: 'WORKING', phase: event.phase, resumeTo: null, error: null },
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

  if (event.status === 'mapping_completed') {
    if (ctx.state === 'CANCELLED') return ctx;
    return commit(
      ctx,
      {
        ...ctx,
        state: 'COMPLETED',
        phase: 'MAP_COVERAGE_DONE',
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
  return commit(
    ctx,
    {
      ...ctx,
      phase: 'MAP_SCAN_BOUNDARY_FAILED',
      error: { code: event.code, recoverable: true },
    },
    event,
    logger,
  );
}

function commit(
  prev: MappingContext,
  next: MappingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
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

function sourceFromEvent(event: { readonly type: string; readonly source?: DeviceEventSource }): TaskSource {
  if (event.type.startsWith('CMD_')) return 'cmd';
  if (event.type === 'TIMEOUT') return 'timeout';
  if (event.source) return event.source;
  if (event.type.startsWith('LINK_WS')) return 'ws';
  if (event.type.startsWith('LINK_BLE')) return 'ble';
  return 'ws';
}

export type { RobotWorkStatus };
