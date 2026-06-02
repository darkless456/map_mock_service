/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mowing/MowingTask.ts. DO NOT EDIT. !!!
// Source SHA-256: 139e5c66dc54e6c262f43b925032a9f186047fc5f40b35a7cc152208518e79e2
// Synced at: 2026-06-02T09:43:38.803Z
/**
 * MowingTask FSM — generalized `TaskState` + `MowingPhase` tuple from TaskFSM.
 *
 * UI `MowingMode` (`global | region | edge`) is translated to `taskMode` at
 * `CMD_START`; all runtime events use standard `TaskEvent<MowingPhase>`.
 */

import {
  createInitialTaskContext,
  createTaskReducer,
  type DeviceEventSource,
  type TaskContext,
  type TaskEvent,
  type TaskSource,
  type TaskState,
} from '../shared/TaskFSM';
import { safeLog, type LoggerLike } from '../shared/LoggerLike';

export type MowingMode = 'global' | 'region' | 'edge';
export type MowingTaskMode = 'MOW_GLOBAL' | 'MOW_REGION' | 'MOW_EDGE';
export type MowingPhase = 'MOW_RUNNING' | 'returning' | 'charging' | 'charged';
export type MowingState = TaskState;
export type MowingContext = TaskContext<MowingPhase>;

type GenericMowingEvent = Exclude<
  TaskEvent<MowingPhase>,
  { readonly type: 'CMD_START' }
>;

export type MowingEvent =
  | GenericMowingEvent
  | {
      readonly type: 'CMD_START';
      readonly mode: MowingMode | 'auto' | 'remote';
      readonly taskMode?: string;
    }
  | { readonly type: 'RECONCILE_STARTED' }
  | { readonly type: 'RECONCILE_PAUSED' };

export const initialMowingState: MowingContext =
  createInitialTaskContext<MowingPhase>();

const baseReducer = createTaskReducer<MowingPhase>({
  domain: 'mowing',
  terminalPhases: ['MOW_RUNNING'],
});

export function mowingReducer(
  ctx: MowingContext,
  event: MowingEvent,
  logger?: LoggerLike,
): MowingContext {
  switch (event.type) {
    case 'CMD_START':
      if (event.mode === 'auto' || event.mode === 'remote') {
        return baseReducer(
          ctx,
          {
            type: 'CMD_START',
            mode: event.mode,
            taskMode: event.taskMode ?? ctx.taskMode ?? 'MOW_GLOBAL',
          },
          logger,
        );
      }
      return baseReducer(
        ctx,
        { type: 'CMD_START', mode: 'auto', taskMode: taskModeFromMowingMode(event.mode) },
        logger,
      );
    case 'CMD_CONFIRM':
      if (
        (ctx.state === 'PAUSED' || ctx.state === 'RESUMING') &&
        ctx.phase === 'MOW_RUNNING'
      ) {
        return complete(ctx, event, logger);
      }
      return baseReducer(ctx, event, logger);
    case 'RECONCILE_STARTED':
      if (ctx.state !== 'IDLE') return ctx;
      return commit(
        ctx,
        {
          ...ctx,
          state: 'WORKING',
          phase: 'MOW_RUNNING',
          taskMode: ctx.taskMode ?? 'MOW_GLOBAL',
          error: null,
        },
        event,
        logger,
      );
    case 'RECONCILE_PAUSED':
      if (ctx.state !== 'IDLE') return ctx;
      return commit(
        ctx,
        {
          ...ctx,
          state: 'PAUSED',
          phase: 'MOW_RUNNING',
          taskMode: ctx.taskMode ?? 'MOW_GLOBAL',
          resumeTo: { state: 'WORKING', phase: 'MOW_RUNNING' },
          error: null,
        },
        event,
        logger,
      );
    case 'DEVICE_WORK_STATUS':
      if (event.status === 'mowing') {
        return markRunning(ctx, event, logger);
      }
      if (event.status === 'charging') {
        return markCharging(ctx, event, logger);
      }
      if (event.status === 'idle') {
        return complete(ctx, event, logger);
      }
      return baseReducer(ctx, event, logger);
    default:
      return baseReducer(ctx, event, logger);
  }
}

export function taskModeFromMowingMode(mode: MowingMode): MowingTaskMode {
  switch (mode) {
    case 'global':
      return 'MOW_GLOBAL';
    case 'region':
      return 'MOW_REGION';
    case 'edge':
      return 'MOW_EDGE';
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function mowingModeFromTaskMode(taskMode: string | null): MowingMode | null {
  switch (taskMode) {
    case 'MOW_GLOBAL':
      return 'global';
    case 'MOW_REGION':
      return 'region';
    case 'MOW_EDGE':
      return 'edge';
    default:
      return null;
  }
}

function markRunning(
  ctx: MowingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
  if (ctx.state === 'COMPLETED' || ctx.state === 'CANCELLED' || ctx.state === 'ERRORED') {
    return ctx;
  }
  if (ctx.state === 'PREPARING' || ctx.state === 'UNDOCKING') {
    return baseReducer(ctx, event as Extract<MowingEvent, { type: 'DEVICE_WORK_STATUS' }>, logger);
  }
  if (ctx.state === 'WORKING' && ctx.phase === 'MOW_RUNNING') return ctx;
  return commit(
    ctx,
    { ...ctx, state: 'WORKING', phase: 'MOW_RUNNING', resumeTo: null, error: null },
    event,
    logger,
  );
}

function markCharging(
  ctx: MowingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
  if (ctx.state === 'IDLE') {
    return commit(ctx, { ...ctx, state: 'RECHARGING', phase: 'charging' }, event, logger);
  }
  if (ctx.state === 'COMPLETED' || ctx.state === 'CANCELLED' || ctx.state === 'ERRORED') {
    return ctx;
  }
  return commit(
    ctx,
    {
      ...ctx,
      state: 'RECHARGING',
      phase: 'charging',
      resumeTo: ctx.resumeTo ?? { state: 'WORKING', phase: 'MOW_RUNNING' },
    },
    event,
    logger,
  );
}

function complete(
  ctx: MowingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
  if (ctx.state === 'IDLE' || ctx.state === 'CANCELLED') return ctx;
  if (ctx.state === 'COMPLETED') return ctx;
  return commit(
    ctx,
    { ...ctx, state: 'COMPLETED', phase: 'MOW_RUNNING', resumeTo: null, error: null },
    event,
    logger,
  );
}

function commit(
  prev: MowingContext,
  next: MowingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
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
      'mowing.fsm.transition',
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

function sameContext(a: MowingContext, b: MowingContext): boolean {
  return (
    a.state === b.state &&
    a.phase === b.phase &&
    a.taskMode === b.taskMode &&
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
