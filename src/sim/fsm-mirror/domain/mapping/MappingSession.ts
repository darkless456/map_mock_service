/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mapping/MappingSession.ts. DO NOT EDIT. !!!
// Source SHA-256: 53bd1993a7c927fb9ccd9cf3f6dfc450bdce795132c0ecbb6f6926138abcc0e1
// Synced at: 2026-05-30T08:44:44.301Z
/**
 * MappingSession FSM — Phase 2 generalized task model.
 *
 * Domain state is now the task-level `TaskState` + `MappingPhase` tuple from
 * `TaskFSM`. The legacy 10-step `MappingStepState` union is kept only as a
 * display/route parameter type so existing screens can remain unchanged until
 * Phase UI.
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

// ─── Legacy display steps (not domain states) ───────────────────────────

export type MappingStepState =
  | 'leaving'
  | 'scanning'
  | 'scanningError'
  | 'hasBorder'
  | 'hasBorderError'
  | 'fullBorder'
  | 'newAreaChecking'
  | 'newArea'
  | 'zigzagging'
  | 'zigzagged';

export const MAPPING_STEP_STATES: readonly MappingStepState[] = [
  'leaving',
  'scanning',
  'scanningError',
  'hasBorder',
  'hasBorderError',
  'fullBorder',
  'newAreaChecking',
  'newArea',
  'zigzagging',
  'zigzagged',
] as const;

// ─── Phase model ───────────────────────────────────────────────────────

export type MappingBusinessPhase =
  | 'MAP_PRECHECK'
  | 'MAP_PRECHECK_FAILED'
  | 'MAP_SCAN_BOUNDARY'
  | 'MAP_SCAN_BOUNDARY_FAILED'
  | 'MAP_BOUNDARY_FOUND'
  | 'MAP_FOLLOW_BOUNDARY'
  | 'MAP_FOLLOW_BOUNDARY_MANUAL'
  | 'MAP_BOUNDARY_CLOSING'
  | 'MAP_BOUNDARY_CLOSE_FAILED'
  | 'MAP_BOUNDARY_DONE'
  | 'MAP_BOUNDARY_WAIT'
  | 'MAP_COVERAGE_PROBE'
  | 'MAP_COVERAGE_NEW_AREA'
  | 'MAP_COVERAGE_RUN'
  | 'MAP_COVERAGE_DONE'
  | 'MAP_COVERAGE_WAIT';

export type RechargePhase = 'returning' | 'charging' | 'charged';
export type MappingPhase = MappingBusinessPhase | RechargePhase;
export type MappingState = TaskState;

export const MAPPING_PHASES: readonly MappingBusinessPhase[] = [
  'MAP_PRECHECK',
  'MAP_PRECHECK_FAILED',
  'MAP_SCAN_BOUNDARY',
  'MAP_SCAN_BOUNDARY_FAILED',
  'MAP_BOUNDARY_FOUND',
  'MAP_FOLLOW_BOUNDARY',
  'MAP_FOLLOW_BOUNDARY_MANUAL',
  'MAP_BOUNDARY_CLOSING',
  'MAP_BOUNDARY_CLOSE_FAILED',
  'MAP_BOUNDARY_DONE',
  'MAP_BOUNDARY_WAIT',
  'MAP_COVERAGE_PROBE',
  'MAP_COVERAGE_NEW_AREA',
  'MAP_COVERAGE_RUN',
  'MAP_COVERAGE_DONE',
  'MAP_COVERAGE_WAIT',
] as const;

export const ALL_MAPPING_STATES = TASK_STATES;
export const MAPPING_TERMINAL_PHASES: readonly MappingPhase[] = [
  'MAP_COVERAGE_DONE',
] as const;

export type MappingContext = TaskContext<MappingPhase>;

export const initialMappingState: MappingContext =
  createInitialTaskContext<MappingPhase>();

// ─── Events ────────────────────────────────────────────────────────────

export type LegacyMappingEvent =
  | { readonly type: 'DEVICE_REPORT_STATUS'; readonly status: RobotWorkStatus }
  | { readonly type: 'DEVICE_AREA_UPDATE'; readonly area: number }
  | { readonly type: 'DEVICE_PROGRESS'; readonly step: MappingStepState }
  | { readonly type: 'BLE_DISCONNECTED' }
  | { readonly type: 'NETWORK_LOST' }
  | { readonly type: 'TIMEOUT'; readonly phase: 'leaving' };

export type MappingEvent = TaskEvent<MappingPhase> | LegacyMappingEvent;
export type MappingEventType = MappingEvent['type'];

const baseReducer = createTaskReducer<MappingPhase>({
  domain: 'mapping',
  terminalPhases: MAPPING_TERMINAL_PHASES,
  canSwitchManual: ctx =>
    ctx.state === 'PAUSED' &&
    ctx.capabilities.canSwitchManual === true &&
    ctx.phase !== 'MAP_COVERAGE_RUN',
  canSwitchAuto: ctx => ctx.capabilities.canSwitchAuto === true,
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
  if (isLegacyEvent(event)) {
    return reduceLegacyEvent(ctx, event, logger);
  }

  if (event.type === 'DEVICE_WORK_STATUS') {
    return reduceWorkStatus(ctx, event, logger);
  }

  if (event.type === 'DEVICE_PHASE') {
    return reduceDevicePhase(ctx, event, logger);
  }

  if (event.type === 'CMD_RETRY') {
    return reduceRetry(ctx, event, logger);
  }

  if (event.type === 'CMD_CONTINUE_COVERAGE') {
    return reduceContinueCoverage(ctx, event, logger);
  }

  if (event.type === 'CMD_GOTO_EDIT' || event.type === 'CMD_SAVE') {
    return reduceCompleteFromCoverageWait(ctx, event, logger);
  }

  if (event.type === 'CMD_ADD_NEW_AREA') {
    return reduceAddNewArea(ctx, event, logger);
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

export function mappingPhaseFromStep(step: MappingStepState): MappingPhase | null {
  switch (step) {
    case 'leaving':
      return null;
    case 'scanning':
      return 'MAP_SCAN_BOUNDARY';
    case 'scanningError':
    case 'hasBorderError':
      return 'MAP_SCAN_BOUNDARY_FAILED';
    case 'hasBorder':
      return 'MAP_BOUNDARY_FOUND';
    case 'fullBorder':
      return 'MAP_BOUNDARY_DONE';
    case 'newAreaChecking':
      return 'MAP_COVERAGE_PROBE';
    case 'newArea':
      return 'MAP_COVERAGE_NEW_AREA';
    case 'zigzagging':
      return 'MAP_COVERAGE_RUN';
    case 'zigzagged':
      return 'MAP_COVERAGE_DONE';
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

export function mappingStepFromPhase(
  phase: MappingPhase | null,
  fallback: MappingStepState = 'leaving',
): MappingStepState {
  switch (phase) {
    case 'MAP_SCAN_BOUNDARY':
      return 'scanning';
    case 'MAP_PRECHECK':
    case 'MAP_PRECHECK_FAILED':
      return fallback;
    case 'MAP_SCAN_BOUNDARY_FAILED':
      return 'scanningError';
    case 'MAP_BOUNDARY_FOUND':
      return 'hasBorder';
    case 'MAP_FOLLOW_BOUNDARY':
    case 'MAP_BOUNDARY_CLOSING':
    case 'MAP_BOUNDARY_CLOSE_FAILED':
    case 'MAP_BOUNDARY_DONE':
    case 'MAP_BOUNDARY_WAIT':
      return 'fullBorder';
    case 'MAP_COVERAGE_PROBE':
      return 'newAreaChecking';
    case 'MAP_COVERAGE_NEW_AREA':
      return 'newArea';
    case 'MAP_COVERAGE_RUN':
      return 'zigzagging';
    case 'MAP_COVERAGE_DONE':
    case 'MAP_COVERAGE_WAIT':
      return 'zigzagged';
    case 'MAP_FOLLOW_BOUNDARY_MANUAL':
    case 'returning':
    case 'charging':
    case 'charged':
    case null:
      return fallback;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export function mappingContextFromLegacyStep(
  step: MappingStepState,
  base: MappingContext = initialMappingState,
): MappingContext {
  if (step === 'leaving') {
    return {
      ...base,
      state: 'UNDOCKING',
      phase: null,
      error: null,
      resumeTo: null,
    };
  }
  const phase = mappingPhaseFromStep(step);
  return {
    ...base,
    state: step === 'zigzagged' ? 'COMPLETED' : 'WORKING',
    phase,
    error:
      step === 'scanningError' || step === 'hasBorderError'
        ? { code: 'E_NO_BORDER', recoverable: true }
        : null,
    resumeTo: null,
  };
}

function reduceLegacyEvent(
  ctx: MappingContext,
  event: LegacyMappingEvent,
  logger?: LoggerLike,
): MappingContext {
  switch (event.type) {
    case 'DEVICE_REPORT_STATUS':
      return mappingReducer(
        ctx,
        {
          type: 'DEVICE_WORK_STATUS',
          status: event.status,
          source: 'ws',
          ts: Date.now(),
        },
        logger,
      );
    case 'DEVICE_AREA_UPDATE':
      return mappingReducer(
        ctx,
        { type: 'DEVICE_AREA', area: event.area, source: 'ws', ts: Date.now() },
        logger,
      );
    case 'DEVICE_PROGRESS':
      return reduceLegacyProgress(ctx, event.step, logger);
    case 'BLE_DISCONNECTED':
      return mappingReducer(ctx, { type: 'LINK_BLE_DOWN' }, logger);
    case 'NETWORK_LOST':
      return mappingReducer(ctx, { type: 'LINK_NET_LOST' }, logger);
    case 'TIMEOUT':
      return mappingReducer(ctx, { type: 'TIMEOUT', phase: 'undocking' }, logger);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function reduceLegacyProgress(
  ctx: MappingContext,
  step: MappingStepState,
  logger?: LoggerLike,
): MappingContext {
  if (step === 'leaving') {
    return commit(
      ctx,
      { ...ctx, state: 'UNDOCKING', phase: null },
      { type: 'DEVICE_PHASE' },
      logger,
    );
  }

  if (step === 'zigzagged') {
    return commit(
      ctx,
      { ...ctx, state: 'COMPLETED', phase: 'MAP_COVERAGE_DONE', resumeTo: null },
      { type: 'DEVICE_PHASE' },
      logger,
    );
  }

  const phase = mappingPhaseFromStep(step);
  if (phase === null) return ctx;
  return commit(
    ctx,
    {
      ...ctx,
      state: 'WORKING',
      phase,
      error:
        phase === 'MAP_SCAN_BOUNDARY_FAILED'
          ? { code: 'E_NO_BORDER', recoverable: true }
          : null,
    },
    { type: 'DEVICE_PHASE' },
    logger,
  );
}

function reduceWorkStatus(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'DEVICE_WORK_STATUS' }>,
  logger?: LoggerLike,
): MappingContext {
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

function reduceDevicePhase(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'DEVICE_PHASE' }>,
  logger?: LoggerLike,
): MappingContext {
  if (event.phase === 'MAP_PRECHECK' || event.phase === 'MAP_PRECHECK_FAILED') {
    if (ctx.state !== 'PREPARING' && ctx.state !== 'IDLE') {
      return baseReducer(ctx, event, logger);
    }
    return commit(
      ctx,
      {
        ...ctx,
        state: 'PREPARING',
        phase: event.phase,
        error:
          event.phase === 'MAP_PRECHECK_FAILED'
            ? { code: 'PRECHECK_FAILED', recoverable: true }
            : null,
      },
      event,
      logger,
    );
  }

  if (
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

  return baseReducer(ctx, event, logger);
}

function reduceRecoverableError(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'DEVICE_ERROR' }>,
  logger?: LoggerLike,
): MappingContext {
  if (event.code === 'PRECHECK_FAILED') {
    if (ctx.state !== 'PREPARING' && ctx.state !== 'WORKING') {
      return baseReducer(ctx, event, logger);
    }
    return commit(
      ctx,
      {
        ...ctx,
        state: 'PREPARING',
        phase: 'MAP_PRECHECK_FAILED',
        error: createMappingError(event.code, event.kind),
      },
      event,
      logger,
    );
  }

  if (event.code === 'BOUNDARY_CLOSE_FAILED') {
    if (ctx.state !== 'WORKING') return baseReducer(ctx, event, logger);
    return commit(
      ctx,
      {
        ...ctx,
        phase: 'MAP_BOUNDARY_CLOSE_FAILED',
        error: createMappingError(event.code, event.kind),
      },
      event,
      logger,
    );
  }

  if (ctx.state !== 'WORKING') return baseReducer(ctx, event, logger);
  return commit(
    ctx,
    {
      ...ctx,
      phase: 'MAP_SCAN_BOUNDARY_FAILED',
      error: createMappingError(event.code, event.kind),
    },
    event,
    logger,
  );
}

function reduceRetry(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'CMD_RETRY' }>,
  logger?: LoggerLike,
): MappingContext {
  if (ctx.state === 'PREPARING' && ctx.phase === 'MAP_PRECHECK_FAILED') {
    return commit(
      ctx,
      { ...ctx, phase: 'MAP_PRECHECK', error: null },
      event,
      logger,
    );
  }
  if (ctx.state !== 'WORKING') return baseReducer(ctx, event, logger);
  if (ctx.phase === 'MAP_BOUNDARY_CLOSE_FAILED') {
    return commit(
      ctx,
      { ...ctx, phase: 'MAP_BOUNDARY_CLOSING', error: null },
      event,
      logger,
    );
  }
  if (ctx.phase === 'MAP_SCAN_BOUNDARY_FAILED') {
    return commit(
      ctx,
      { ...ctx, phase: 'MAP_SCAN_BOUNDARY', error: null },
      event,
      logger,
    );
  }
  return baseReducer(ctx, event, logger);
}

function reduceContinueCoverage(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'CMD_CONTINUE_COVERAGE' }>,
  logger?: LoggerLike,
): MappingContext {
  if (ctx.state !== 'WORKING' || ctx.phase !== 'MAP_BOUNDARY_WAIT') return ctx;
  return commit(
    ctx,
    { ...ctx, phase: 'MAP_COVERAGE_PROBE', error: null },
    event,
    logger,
  );
}

function reduceCompleteFromCoverageWait(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'CMD_GOTO_EDIT' | 'CMD_SAVE' }>,
  logger?: LoggerLike,
): MappingContext {
  if (ctx.state !== 'WORKING' || ctx.phase !== 'MAP_COVERAGE_WAIT') return ctx;
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

function reduceAddNewArea(
  ctx: MappingContext,
  event: Extract<MappingEvent, { type: 'CMD_ADD_NEW_AREA' }>,
  logger?: LoggerLike,
): MappingContext {
  if (isMappingTerminal(ctx) || ctx.state === 'IDLE') return ctx;
  if (ctx.phase === 'MAP_COVERAGE_RUN') return ctx;

  const notices = ctx.notices.filter(notice => notice.kind !== 'new_area_available');
  if (event.mode === 'auto') {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'WORKING',
        mode: 'auto',
        phase: 'MAP_SCAN_BOUNDARY',
        resumeTo: null,
        error: null,
        notices,
      },
      event,
      logger,
    );
  }

  return commit(
    ctx,
    {
      ...ctx,
      state: 'REMOTE_CONTROL',
      mode: 'remote',
      phase: 'MAP_FOLLOW_BOUNDARY_MANUAL',
      resumeTo: ctx.resumeTo ?? { state: ctx.state, phase: ctx.phase },
      error: null,
      notices,
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
    notices: TERMINAL_TASK_STATES.has(next.state) ? [] : next.notices,
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
    a.capabilities === b.capabilities &&
    a.notices === b.notices
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

function createMappingError(
  code: string,
  kind: Extract<MappingEvent, { type: 'DEVICE_ERROR' }>['kind'],
) {
  return kind ? { code, recoverable: true, kind } : { code, recoverable: true };
}

function isLegacyEvent(event: MappingEvent): event is LegacyMappingEvent {
  return (
    event.type === 'DEVICE_REPORT_STATUS' ||
    event.type === 'DEVICE_AREA_UPDATE' ||
    event.type === 'DEVICE_PROGRESS' ||
    event.type === 'BLE_DISCONNECTED' ||
    event.type === 'NETWORK_LOST' ||
    (event.type === 'TIMEOUT' && event.phase === 'leaving')
  );
}

export type { RobotWorkStatus };
