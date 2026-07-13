/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mowing/MowingTask.ts. DO NOT EDIT. !!!
// Source SHA-256: 9709ba9c6ab26be2e2ba1575b79f8b9bcda4ed4d62027477ed4e1ca30b24d0f4
// Synced at: 2026-07-13T03:46:38.153Z
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
/**
 * 割草业务阶段：
 * - `MOW_RUNNING`：割草执行中（模式由 `taskMode` 承载）。
 * - `returning` / `charging` / `charged`：低电回充子阶段（搭配 `RECHARGING`）。
 * - `RETURN_*`：回桩子阶段（搭配顶层态 `RETURNING_DOCK`，由设备 `work_status: return_dock`
 *   进入，结束当前割草任务，见 docs §13）。
 */
export type MowingPhase =
  | 'MOW_RUNNING'
  | 'returning'
  | 'charging'
  | 'charged'
  | 'RETURN_PRE_DOCK'
  | 'RETURN_SEEK_CHARGER'
  | 'RETURN_ENTER_DOCK'
  | 'RETURN_AT_DOCK'
  | 'RETURN_DOCK_FAILED';
export type MowingState = TaskState;
export type MowingContext = TaskContext<MowingPhase>;

/** 回桩子阶段集合（搭配 `RETURNING_DOCK`）。 */
export const RETURN_DOCK_PHASES: readonly MowingPhase[] = [
  'RETURN_PRE_DOCK',
  'RETURN_SEEK_CHARGER',
  'RETURN_ENTER_DOCK',
  'RETURN_AT_DOCK',
  'RETURN_DOCK_FAILED',
];

/** 回桩失败错误码（可恢复，留在 `RETURNING_DOCK`）。 */
export const RETURN_DOCK_FAILED_CODE = 'mowing.return_dock_failed';

export function isReturnDockPhase(phase: string | null): phase is MowingPhase {
  return phase !== null && RETURN_DOCK_PHASES.includes(phase as MowingPhase);
}

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
      if (event.status === 'return_dock') {
        return enterReturningDock(ctx, event, logger);
      }
      if (event.status === 'idle') {
        return complete(ctx, event, logger);
      }
      return baseReducer(ctx, event, logger);
    case 'DEVICE_PHASE':
      // 回桩子阶段（RETURN_*）不在通用 reducer 处理（其只认 WORKING/REMOTE/RESUMING/
      // UNDOCKING），改由割草域接管：从活跃态进入 RETURNING_DOCK 并更新子阶段。
      if (isReturnDockPhase(event.phase)) {
        return applyReturnDockPhase(ctx, event, logger);
      }
      return baseReducer(ctx, event, logger);
    default:
      return baseReducer(ctx, event, logger);
  }
}

/**
 * 可进入回桩态（`RETURNING_DOCK`）的来源态。
 *
 * 含 `IDLE`：割草页「回充」按钮会**先取消当前割草任务**（→ `CANCELLED` → 清理回 `IDLE`），
 * 设备再上报 `work_status: return_dock`；故 `IDLE` 也需接管，确保回桩态可达（docs §13）。
 * 排除：终态（已结束）、`RECHARGING`（低电回充保留 `resumeTo`）、`ESTOPPED`（急停正交）。
 */
function canEnterReturningDock(state: MowingContext['state']): boolean {
  return (
    state === 'IDLE' ||
    state === 'PREPARING' ||
    state === 'UNDOCKING' ||
    state === 'WORKING' ||
    state === 'PAUSED' ||
    state === 'RESUMING' ||
    state === 'REMOTE_CONTROL' ||
    state === 'RETURNING_DOCK'
  );
}

/**
 * 进入 / 推进回桩态（`RETURNING_DOCK`）。
 *
 * 由设备 `work_status: return_dock` 或回桩 `sub_status`（`RETURN_*` phase）触发；
 * 结束当前割草任务，**不保留 `resumeTo`**（不可恢复）。`RETURN_DOCK_FAILED` 写可恢复
 * 错误并留在 `RETURNING_DOCK`（见 docs §13）。终态 / `RECHARGING` / `ESTOPPED` 忽略。
 */
function enterReturningDock(
  ctx: MowingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
  if (!canEnterReturningDock(ctx.state)) return ctx;
  if (ctx.state === 'RETURNING_DOCK') return ctx;
  return commit(
    ctx,
    {
      ...ctx,
      state: 'RETURNING_DOCK',
      phase: 'RETURN_PRE_DOCK',
      resumeTo: null,
      error: null,
    },
    event,
    logger,
  );
}

function applyReturnDockPhase(
  ctx: MowingContext,
  event: { readonly type: 'DEVICE_PHASE'; readonly phase: MowingPhase; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
  if (!canEnterReturningDock(ctx.state)) return ctx;
  const error =
    event.phase === 'RETURN_DOCK_FAILED'
      ? { code: RETURN_DOCK_FAILED_CODE, recoverable: true }
      : null;
  return commit(
    ctx,
    {
      ...ctx,
      state: 'RETURNING_DOCK',
      phase: event.phase,
      resumeTo: null,
      error,
    },
    event,
    logger,
  );
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
    {
      ...ctx,
      state: 'WORKING',
      phase: 'MOW_RUNNING',
      resumeTo: null,
      error: null,
      pausedReason: null,
    },
    event,
    logger,
  );
}

function markCharging(
  ctx: MowingContext,
  event: { readonly type: string; readonly source?: DeviceEventSource; readonly ts?: number },
  logger?: LoggerLike,
): MowingContext {
  // Robot idle on dock reports `charging` — not an in-app return-to-charge session.
  if (ctx.state === 'IDLE') {
    return ctx;
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
  if (ctx.state === 'RECHARGING' && ctx.resumeTo === null) {
    return commit(
      ctx,
      {
        ...ctx,
        state: 'IDLE',
        phase: null,
        taskMode: null,
        area: 0,
        resumeTo: null,
        error: null,
        notices: [],
      },
      event,
      logger,
    );
  }
  return commit(
    ctx,
    {
      ...ctx,
      state: 'COMPLETED',
      phase: 'MOW_RUNNING',
      resumeTo: null,
      error: null,
      notices: [],
    },
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
