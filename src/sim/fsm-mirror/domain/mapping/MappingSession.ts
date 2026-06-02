/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mapping/MappingSession.ts. DO NOT EDIT. !!!
// Source SHA-256: 842df1fe764fe3e475e16e72be1c41ece0f35402949e40f898b0716a734384a0
// Synced at: 2026-06-02T09:43:38.803Z
/**
 * MappingSession FSM — task-level `TaskState` + `MappingPhase` tuple from
 * `TaskFSM`. UI binding uses `MappingPanelId` in `features/mapping/state`.
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
  | 'MAP_BOUNDARY_FOUND'
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
  'MAP_BOUNDARY_FOUND',
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

const baseReducer = createTaskReducer<MappingPhase>({
  domain: 'mapping',
  terminalPhases: MAPPING_TERMINAL_PHASES,
  canSwitchManual: ctx => ctx.phase === 'MAP_SCAN_BOUNDARY_FAILED',
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
  if (event.type === 'DEVICE_WORK_STATUS') {
    return reduceWorkStatus(ctx, event, logger);
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
      { ...ctx, state: 'COMPLETED', phase: 'MAP_COVERAGE_DONE', resumeTo: null, error: null },
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
