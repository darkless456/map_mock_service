/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/shared/TaskFSM.ts. DO NOT EDIT. !!!
// Source SHA-256: a4d2ecf3f4524b146de88f89d3f69d178324f971149467de84d532bfe53c2c21
// Synced at: 2026-06-02T09:43:38.803Z
import { safeLog, type LoggerLike } from './LoggerLike';

export type TaskState =
  | 'IDLE'
  | 'PREPARING'
  | 'UNDOCKING'
  | 'WORKING'
  | 'PAUSED'
  | 'REMOTE_CONTROL'
  | 'RECHARGING'
  | 'RESUMING'
  | 'RETURNING_DOCK'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ERRORED';

export type TaskSource = 'cmd' | 'ble' | 'ws' | 'timeout';
export type DeviceEventSource = Extract<TaskSource, 'ble' | 'ws'>;
export type TaskMode = 'auto' | 'remote';

export type RobotWorkStatus =
  | 'idle'
  | 'mowing'
  | 'charging'
  | 'mapping'
  | 'mapping_completed'
  | 'error';

export type AckTimeoutPhase =
  | 'preparing'
  | 'undocking'
  | 'resuming'
  | 'ackPending';

export interface TaskResumeTarget<P extends string> {
  readonly state: TaskState;
  readonly phase: P | null;
}

export interface TaskError {
  readonly code: string;
  readonly recoverable: boolean;
}

export interface TaskContext<P extends string> {
  readonly state: TaskState;
  readonly phase: P | null;
  readonly mode: TaskMode;
  readonly taskMode: string | null;
  readonly area: number;
  readonly battery: number;
  readonly resumeTo: TaskResumeTarget<P> | null;
  readonly error: TaskError | null;
  readonly lastSource: TaskSource;
  readonly lastSourceTs: number;
}

export type TaskEvent<P extends string> =
  | { readonly type: 'CMD_START'; readonly mode: TaskMode; readonly taskMode?: string }
  | { readonly type: 'CMD_PAUSE' }
  | { readonly type: 'CMD_RESUME' }
  | { readonly type: 'CMD_CANCEL' }
  | { readonly type: 'CMD_SWITCH_MANUAL' }
  | { readonly type: 'CMD_EXIT_MANUAL' }
  | { readonly type: 'CMD_CONFIRM' }
  | { readonly type: 'CMD_RETURN_DOCK' }
  | { readonly type: 'CMD_RESET' }
  | {
      readonly type: 'DEVICE_PHASE';
      readonly phase: P;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_WORK_STATUS';
      readonly status: RobotWorkStatus;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_AREA';
      readonly area: number;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_BATTERY';
      readonly battery: number;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | { readonly type: 'DEVICE_LOW_BATTERY' }
  | { readonly type: 'DEVICE_DOCKED' }
  | { readonly type: 'DEVICE_UNDOCKED' }
  | { readonly type: 'DEVICE_ERROR'; readonly code: string; readonly recoverable: boolean }
  | { readonly type: 'LINK_BLE_UP' }
  | { readonly type: 'LINK_BLE_DOWN' }
  | { readonly type: 'LINK_WS_UP' }
  | { readonly type: 'LINK_WS_DOWN' }
  | { readonly type: 'LINK_NET_LOST' }
  | { readonly type: 'TIMEOUT'; readonly phase: AckTimeoutPhase };

export type TaskReducer<P extends string> = (
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  logger?: LoggerLike,
) => TaskContext<P>;

export const TASK_STATES: readonly TaskState[] = [
  'IDLE',
  'PREPARING',
  'UNDOCKING',
  'WORKING',
  'PAUSED',
  'REMOTE_CONTROL',
  'RECHARGING',
  'RESUMING',
  'RETURNING_DOCK',
  'COMPLETED',
  'CANCELLED',
  'ERRORED',
] as const;

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set([
  'COMPLETED',
  'CANCELLED',
  'ERRORED',
]);

const RECHARGE_RETURNING_PHASE = 'returning';
const RECHARGE_CHARGING_PHASE = 'charging';
const RECHARGE_CHARGED_PHASE = 'charged';

export interface TaskReducerOptions<P extends string> {
  readonly domain?: string;
  readonly now?: () => number;
  readonly chargedBatteryLevel?: number;
  readonly terminalPhases?: readonly P[];
  readonly isTerminalPhase?: (phase: P | null, ctx: TaskContext<P>) => boolean;
  readonly canSwitchManual?: (ctx: TaskContext<P>) => boolean;
}

export function createInitialTaskContext<P extends string>(
  overrides: Partial<TaskContext<P>> = {},
): TaskContext<P> {
  return {
    state: 'IDLE',
    phase: null,
    mode: 'auto',
    taskMode: null,
    area: 0,
    battery: 0,
    resumeTo: null,
    error: null,
    lastSource: 'cmd',
    lastSourceTs: 0,
    ...overrides,
  };
}

export function createTaskReducer<P extends string>(
  options: TaskReducerOptions<P> = {},
): TaskReducer<P> {
  const domain = options.domain ?? 'task';

  return (ctx, event, logger) => {
    const next = transition(ctx, event, options);
    if (next !== ctx && next.state !== ctx.state) {
      safeLog(
        logger,
        'info',
        `${domain}.fsm.transition`,
        `${ctx.state} -> ${next.state}`,
        {
          from: ctx.state,
          to: next.state,
          event,
          source: next.lastSource,
          ts: next.lastSourceTs,
        },
      );
    } else if (next === ctx) {
      safeLog(logger, 'debug', `${domain}.fsm.transition`, `noop in ${ctx.state}`, {
        from: ctx.state,
        event,
      });
    }
    return next;
  };
}

function transition<P extends string>(
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  if (event.type === 'CMD_RESET') {
    if (!TERMINAL_TASK_STATES.has(ctx.state)) return ctx;
    return withMeta(
      createInitialTaskContext<P>({ battery: ctx.battery }),
      event,
      options,
    );
  }

  if (TERMINAL_TASK_STATES.has(ctx.state)) return ctx;

  switch (event.type) {
    case 'CMD_START': {
      if (ctx.state !== 'IDLE') return ctx;
      return withMeta(
        {
          ...ctx,
          state: event.mode === 'remote' ? 'REMOTE_CONTROL' : 'PREPARING',
          mode: event.mode,
          taskMode: event.taskMode ?? null,
          phase: null,
          resumeTo: null,
          error: null,
        },
        event,
        options,
      );
    }

    case 'DEVICE_WORK_STATUS': {
      if (event.status === 'error') {
        return withError(ctx, event, 'DEVICE_ERROR', false, options);
      }
      if (event.status === 'charging') {
        return enterRecharging(ctx, event, options);
      }
      if (
        ctx.state === 'PREPARING' &&
        (event.status === 'mapping' || event.status === 'mowing')
      ) {
        return withMeta({ ...ctx, state: 'UNDOCKING' }, event, options);
      }
      return ctx;
    }

    case 'DEVICE_UNDOCKED': {
      if (ctx.state !== 'PREPARING') return ctx;
      return withMeta({ ...ctx, state: 'UNDOCKING' }, event, options);
    }

    case 'DEVICE_PHASE': {
      if (ctx.state === 'UNDOCKING') {
        return withMeta(
          { ...ctx, state: 'WORKING', phase: event.phase, error: null },
          event,
          options,
        );
      }
      if (ctx.state === 'WORKING' || ctx.state === 'REMOTE_CONTROL') {
        if (ctx.phase === event.phase && ctx.error === null) return ctx;
        return withMeta({ ...ctx, phase: event.phase, error: null }, event, options);
      }
      if (ctx.state === 'RESUMING') {
        if (ctx.resumeTo?.phase !== null && ctx.resumeTo?.phase !== event.phase) {
          return ctx;
        }
        return withMeta(
          { ...ctx, state: 'WORKING', phase: event.phase, resumeTo: null, error: null },
          event,
          options,
        );
      }
      return ctx;
    }

    case 'CMD_PAUSE': {
      if (ctx.state !== 'WORKING') return ctx;
      return withMeta(
        { ...ctx, state: 'PAUSED', resumeTo: snapshot(ctx) },
        event,
        options,
      );
    }

    case 'CMD_RESUME': {
      if (ctx.state === 'PAUSED' && ctx.resumeTo !== null) {
        return withMeta({ ...ctx, state: 'RESUMING' }, event, options);
      }
      if (ctx.state === 'RECHARGING' && ctx.phase === rechargePhase<P>('charged')) {
        return withMeta({ ...ctx, state: 'RESUMING' }, event, options);
      }
      return ctx;
    }

    case 'CMD_CANCEL': {
      if (ctx.state === 'IDLE') return ctx;
      return withMeta(
        { ...ctx, state: 'CANCELLED', resumeTo: null, error: null },
        event,
        options,
      );
    }

    case 'CMD_SWITCH_MANUAL': {
      const allowedByState = ctx.state === 'PAUSED';
      const allowedByDomain = options.canSwitchManual?.(ctx) ?? false;
      if (!allowedByState && !allowedByDomain) return ctx;
      return withMeta(
        {
          ...ctx,
          state: 'REMOTE_CONTROL',
          mode: 'remote',
          phase: ctx.resumeTo?.phase ?? ctx.phase,
          resumeTo: ctx.resumeTo ?? snapshot(ctx),
        },
        event,
        options,
      );
    }

    case 'CMD_EXIT_MANUAL': {
      if (ctx.state !== 'REMOTE_CONTROL') return ctx;
      return withMeta(
        {
          ...ctx,
          state: 'WORKING',
          mode: 'auto',
          phase: ctx.resumeTo?.phase ?? ctx.phase,
          resumeTo: null,
        },
        event,
        options,
      );
    }

    case 'CMD_CONFIRM': {
      if (ctx.state !== 'WORKING') return ctx;
      if (!isTerminalPhase(ctx, options)) return ctx;
      return withMeta(
        { ...ctx, state: 'COMPLETED', resumeTo: null, error: null },
        event,
        options,
      );
    }

    case 'CMD_RETURN_DOCK':
    case 'DEVICE_LOW_BATTERY': {
      return enterRecharging(ctx, event, options);
    }

    case 'DEVICE_DOCKED': {
      if (ctx.state !== 'RECHARGING' && ctx.state !== 'RETURNING_DOCK') return ctx;
      return withMeta(
        { ...ctx, state: 'RECHARGING', phase: rechargePhase<P>('charging') },
        event,
        options,
      );
    }

    case 'DEVICE_BATTERY': {
      if (!Number.isFinite(event.battery) || event.battery < 0) return ctx;
      const chargedBatteryLevel = options.chargedBatteryLevel ?? 80;
      const phase =
        ctx.state === 'RECHARGING' && event.battery >= chargedBatteryLevel
          ? rechargePhase<P>('charged')
          : ctx.phase;
      if (ctx.battery === event.battery && ctx.phase === phase) return ctx;
      return withMeta({ ...ctx, battery: event.battery, phase }, event, options);
    }

    case 'DEVICE_AREA': {
      if (!Number.isFinite(event.area) || event.area < 0) return ctx;
      if (ctx.area === event.area) return ctx;
      return withMeta({ ...ctx, area: event.area }, event, options);
    }

    case 'DEVICE_ERROR': {
      if (event.recoverable) {
        if (ctx.error?.code === event.code && ctx.error.recoverable) return ctx;
        return withMeta(
          { ...ctx, error: { code: event.code, recoverable: true } },
          event,
          options,
        );
      }
      return withError(ctx, event, event.code, false, options);
    }

    case 'LINK_NET_LOST': {
      if (ctx.state !== 'WORKING' && ctx.state !== 'RECHARGING') return ctx;
      return withMeta(
        { ...ctx, state: 'PAUSED', resumeTo: ctx.resumeTo ?? snapshot(ctx) },
        event,
        options,
      );
    }

    case 'TIMEOUT': {
      if (event.phase === 'preparing' && ctx.state === 'PREPARING') {
        return withError(ctx, event, 'PREPARING_TIMEOUT', false, options);
      }
      if (event.phase === 'undocking' && ctx.state === 'UNDOCKING') {
        return withError(ctx, event, 'UNDOCKING_TIMEOUT', false, options);
      }
      if (event.phase === 'resuming' && ctx.state === 'RESUMING') {
        return withMeta({ ...ctx, state: 'PAUSED' }, event, options);
      }
      if (event.phase === 'ackPending' && ctx.state !== 'IDLE') {
        return withError(ctx, event, 'ACK_TIMEOUT', false, options);
      }
      return ctx;
    }

    case 'LINK_BLE_UP':
    case 'LINK_BLE_DOWN':
    case 'LINK_WS_UP':
    case 'LINK_WS_DOWN': {
      return withMeta(ctx, event, options);
    }

    default: {
      const _exhaustive: never = event;
      return _exhaustive ?? ctx;
    }
  }
}

function enterRecharging<P extends string>(
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  if (ctx.state === 'IDLE') {
    return withMeta(
      { ...ctx, state: 'RECHARGING', phase: rechargePhase<P>('charging') },
      event,
      options,
    );
  }
  if (ctx.state !== 'WORKING' && ctx.state !== 'PAUSED') return ctx;
  return withMeta(
    {
      ...ctx,
      state: 'RECHARGING',
      phase: rechargePhase<P>('returning'),
      resumeTo: ctx.resumeTo ?? snapshot(ctx),
    },
    event,
    options,
  );
}

function withError<P extends string>(
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  code: string,
  recoverable: boolean,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  return withMeta(
    {
      ...ctx,
      state: 'ERRORED',
      error: { code, recoverable },
      resumeTo: null,
    },
    event,
    options,
  );
}

function withMeta<P extends string>(
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  return {
    ...ctx,
    lastSource: sourceFromEvent(event),
    lastSourceTs: tsFromEvent(event, options.now?.() ?? Date.now()),
  };
}

function sourceFromEvent<P extends string>(event: TaskEvent<P>): TaskSource {
  if (event.type.startsWith('CMD_')) return 'cmd';
  if (event.type === 'TIMEOUT') return 'timeout';
  if ('source' in event) return event.source;
  if (event.type.startsWith('LINK_WS')) return 'ws';
  if (event.type.startsWith('LINK_BLE')) return 'ble';
  return 'timeout';
}

function tsFromEvent<P extends string>(event: TaskEvent<P>, fallback: number): number {
  if ('ts' in event) return event.ts;
  return fallback;
}

function snapshot<P extends string>(ctx: TaskContext<P>): TaskResumeTarget<P> {
  return { state: ctx.state, phase: ctx.phase };
}

function isTerminalPhase<P extends string>(
  ctx: TaskContext<P>,
  options: TaskReducerOptions<P>,
): boolean {
  if (options.isTerminalPhase) return options.isTerminalPhase(ctx.phase, ctx);
  if (ctx.phase === null) return false;
  return options.terminalPhases?.includes(ctx.phase) ?? false;
}

function rechargePhase<P extends string>(phase: 'returning' | 'charging' | 'charged'): P {
  switch (phase) {
    case 'returning':
      return RECHARGE_RETURNING_PHASE as P;
    case 'charging':
      return RECHARGE_CHARGING_PHASE as P;
    case 'charged':
      return RECHARGE_CHARGED_PHASE as P;
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
