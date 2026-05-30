/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/shared/TaskFSM.ts. DO NOT EDIT. !!!
// Source SHA-256: c575fc47ef9331cd53790961a48f7eae5a4566e244c0418cfeb4bb7e6c90fd79
// Synced at: 2026-05-30T08:44:44.301Z
import { applyEstopTransition } from './EstopReducer';
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
  | 'ERRORED'
  | 'ESTOPPED';

export type TaskSource = 'cmd' | 'ble' | 'ws' | 'timeout';
export type DeviceEventSource = Extract<TaskSource, 'ble' | 'ws'>;
export type TaskMode = 'auto' | 'remote';
export type IdlePhase = 'IDLE_DOCKED_FULL' | 'IDLE_OFF_DOCK' | null;

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

export interface TaskCapabilities {
  readonly canSwitchManual: boolean;
  readonly canSwitchAuto: boolean;
}

export const DEFAULT_CAPABILITIES: TaskCapabilities = {
  canSwitchManual: false,
  canSwitchAuto: false,
};

export type ErrorKind = 'stuck' | 'lifted' | 'tilted' | 'flipped' | 'other';

export type TaskNotice = {
  readonly id: string;
  readonly kind: 'new_area_available';
  readonly mode: TaskMode;
  readonly ts: number;
};

export interface TaskError {
  readonly code: string;
  readonly recoverable: boolean;
  readonly kind?: ErrorKind;
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
  readonly capabilities: TaskCapabilities;
  readonly notices: ReadonlyArray<TaskNotice>;
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
  | { readonly type: 'CMD_FINISH_AND_RETURN_DOCK' }
  | { readonly type: 'CMD_RESET' }
  | { readonly type: 'CMD_RETRY' }
  | { readonly type: 'CMD_ADD_NEW_AREA'; readonly mode: TaskMode }
  | { readonly type: 'CMD_DISMISS_NOTICE'; readonly id: string }
  | { readonly type: 'CMD_CONTINUE_COVERAGE' }
  | { readonly type: 'CMD_GOTO_EDIT' }
  | { readonly type: 'CMD_SAVE' }
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
  | {
      readonly type: 'DEVICE_ERROR';
      readonly code: string;
      readonly recoverable: boolean;
      readonly kind?: ErrorKind;
    }
  | {
      readonly type: 'DEVICE_CAPABILITIES';
      readonly canSwitchManual: boolean;
      readonly canSwitchAuto: boolean;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_NOTICE';
      readonly notice: TaskNotice;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
  | {
      readonly type: 'DEVICE_ESTOP';
      readonly active: boolean;
      readonly source: DeviceEventSource;
      readonly ts: number;
    }
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
  'ESTOPPED',
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
  readonly canSwitchAuto?: (ctx: TaskContext<P>) => boolean;
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
    capabilities: DEFAULT_CAPABILITIES,
    notices: [],
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
  const estopNext = applyEstopTransition(ctx, event, options.now?.() ?? Date.now());
  if (estopNext !== null) return estopNext;

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
          notices: [],
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
      if (ctx.state !== 'WORKING' && ctx.state !== 'UNDOCKING') return ctx;
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
      const allowedByCapability = options.canSwitchManual?.(ctx) ?? ctx.capabilities.canSwitchManual;
      if (!allowedByState || !allowedByCapability) return ctx;
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
      const allowedByCapability = options.canSwitchAuto?.(ctx) ?? ctx.capabilities.canSwitchAuto;
      if (!allowedByCapability) return ctx;
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

    case 'DEVICE_CAPABILITIES': {
      if (
        ctx.capabilities.canSwitchManual === event.canSwitchManual &&
        ctx.capabilities.canSwitchAuto === event.canSwitchAuto
      ) {
        return ctx;
      }
      return withMeta(
        {
          ...ctx,
          capabilities: {
            canSwitchManual: event.canSwitchManual,
            canSwitchAuto: event.canSwitchAuto,
          },
        },
        event,
        options,
      );
    }

    case 'DEVICE_NOTICE': {
      const notices = upsertNotice(ctx.notices, event.notice);
      if (notices === ctx.notices) return ctx;
      return withMeta({ ...ctx, notices }, event, options);
    }

    case 'CMD_DISMISS_NOTICE': {
      const notices = ctx.notices.filter(notice => notice.id !== event.id);
      if (notices.length === ctx.notices.length) return ctx;
      return withMeta({ ...ctx, notices }, event, options);
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
        if (sameError(ctx.error, event.code, true, event.kind)) return ctx;
        return withMeta(
          { ...ctx, error: createTaskError(event.code, true, event.kind) },
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

    case 'CMD_RETRY':
    case 'CMD_ADD_NEW_AREA':
    case 'CMD_CONTINUE_COVERAGE':
    case 'CMD_GOTO_EDIT':
    case 'CMD_SAVE':
    case 'CMD_FINISH_AND_RETURN_DOCK': {
      return ctx;
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
      error: createTaskError(
        code,
        recoverable,
        event.type === 'DEVICE_ERROR' ? event.kind : undefined,
      ),
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
    notices: TERMINAL_TASK_STATES.has(ctx.state) ? [] : ctx.notices,
    lastSource: sourceFromEvent(event),
    lastSourceTs: tsFromEvent(event, options.now?.() ?? Date.now()),
  };
}

function upsertNotice(
  notices: ReadonlyArray<TaskNotice>,
  next: TaskNotice,
): ReadonlyArray<TaskNotice> {
  const existing = notices.findIndex(notice => notice.id === next.id);
  if (existing < 0) return [...notices, next];
  const current = notices[existing];
  if (
    current.kind === next.kind &&
    current.mode === next.mode &&
    current.ts === next.ts
  ) {
    return notices;
  }
  return notices.map((notice, index) => (index === existing ? next : notice));
}

function sameError(
  error: TaskError | null,
  code: string,
  recoverable: boolean,
  kind: ErrorKind | undefined,
): boolean {
  return (
    error?.code === code &&
    error.recoverable === recoverable &&
    error.kind === kind
  );
}

function createTaskError(
  code: string,
  recoverable: boolean,
  kind: ErrorKind | undefined,
): TaskError {
  return kind ? { code, recoverable, kind } : { code, recoverable };
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
