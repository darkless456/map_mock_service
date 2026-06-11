/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/shared/TaskFSM.ts. DO NOT EDIT. !!!
// Source SHA-256: 8a99847f9105808a64cd6e3ad3bb8fcf1f1d260eb96890cb426df5daa45f955a
// Synced at: 2026-06-11T08:30:38.383Z
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
  | 'ESTOPPED'
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
  | 'return_dock'
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

/**
 * 机器人上报的能力位：决定哪些模式切换被允许。可由设备事件
 * （`DEVICE_CAPABILITIES`，经 WS/registry/EventAdapter 接入）更新。
 *
 * 默认全 `true`（对齐后端「能力字段默认 true」的调整）：在后端能力位接入前，
 * 应用先按「机器人具备切换能力」处理，因此模式切换仅由 `state`（如「先暂停再切
 * 手动」）门控；`CMD_RESET` / 断链（`LINK_*_DOWN`、`LINK_NET_LOST`）后回到此默认值。
 */
export interface TaskCapabilities {
  readonly canSwitchManual: boolean;
  readonly canSwitchAuto: boolean;
}

export const DEFAULT_CAPABILITIES: TaskCapabilities = {
  canSwitchManual: true,
  canSwitchAuto: true,
};

/** 非阻塞提醒类型（场景层渲染横幅，不改 `state/phase`）。 */
export type TaskNoticeKind = 'new_area_available';

/** 非阻塞提醒项；以 `id` 去重，进入终态时清空。 */
export interface TaskNotice {
  readonly id: string;
  readonly kind: TaskNoticeKind;
  readonly mode: TaskMode;
  readonly ts: number;
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
  /** 机器人能力位（模式切换守卫的唯一依据，见 §7.3）。 */
  readonly capabilities: TaskCapabilities;
  /** 非阻塞提醒队列（不参与 state/phase 流转）。 */
  readonly notices: ReadonlyArray<TaskNotice>;
  /** 物理急停是否仍处于激活：`true` 时拒绝 `CMD_RESET` 复位。 */
  readonly estopActive: boolean;
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
  | { readonly type: 'CMD_START_COVERAGE' }
  | { readonly type: 'CMD_RETURN_DOCK' }
  | { readonly type: 'CMD_RESET' }
  | { readonly type: 'CMD_ADD_NEW_AREA'; readonly mode: TaskMode }
  | { readonly type: 'CMD_DISMISS_NOTICE'; readonly id: string }
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
  'ESTOPPED',
  'COMPLETED',
  'CANCELLED',
  'ERRORED',
] as const;

export const TERMINAL_TASK_STATES: ReadonlySet<TaskState> = new Set([
  'COMPLETED',
  'CANCELLED',
  'ERRORED',
]);

/** 急停可恢复的现场态：仅这些态在急停时保存 `resumeTo`。 */
const ESTOP_RESUMABLE_STATES: ReadonlySet<TaskState> = new Set([
  'WORKING',
  'PAUSED',
  'REMOTE_CONTROL',
  'RESUMING',
  'RECHARGING',
  'UNDOCKING',
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
  /**
   * 进入遥控（`CMD_SWITCH_MANUAL`）的**额外业务例外**（默认允许）。
   * 主守卫始终是 `state==='PAUSED' && capabilities.canSwitchManual`；
   * 此钩子返回 `false` 可在特定 phase 下额外禁止（如建图 `MAP_COVERAGE_RUN`）。
   */
  readonly canEnterRemote?: (ctx: TaskContext<P>) => boolean;
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
    estopActive: false,
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
    const eventType = (event as { type?: string }).type;
    if (next !== ctx && next.state !== ctx.state) {
      safeLog(
        logger,
        'info',
        `${domain}.fsm.transition`,
        `${ctx.state} -> ${next.state}`,
        {
          // 稳定字符串 event（机读过滤）；触发事件名与完整对象另存（设计 §10.4）
          event: `${domain}.fsm.transition`,
          eventType,
          fsmEvent: event,
          from: ctx.state,
          to: next.state,
          source: next.lastSource,
          ts: next.lastSourceTs,
        },
      );
    } else if (next === ctx) {
      safeLog(logger, 'debug', `${domain}.fsm.transition`, `noop in ${ctx.state}`, {
        event: `${domain}.fsm.transition`,
        eventType,
        fsmEvent: event,
        from: ctx.state,
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
    if (ctx.state === 'ESTOPPED') {
      // 物理急停尚未解除：拒绝复位，必须先收到 DEVICE_ESTOP{active:false}。
      if (ctx.estopActive) return ctx;
      const base = { ...ctx, estopActive: false, error: null, notices: [] };
      if (ctx.resumeTo) {
        return withMeta({ ...base, state: 'RESUMING' }, event, options);
      }
      return withMeta(
        { ...base, state: 'IDLE', phase: null, resumeTo: null },
        event,
        options,
      );
    }
    if (!TERMINAL_TASK_STATES.has(ctx.state)) return ctx;
    return withMeta(
      createInitialTaskContext<P>({ battery: ctx.battery }),
      event,
      options,
    );
  }

  // 急停态是正交打断：除解除/复位与能力/通知更新外，忽略一切设备状态推送。
  if (ctx.state === 'ESTOPPED') {
    switch (event.type) {
      case 'DEVICE_ESTOP':
        return event.active
          ? ctx
          : withMeta({ ...ctx, estopActive: false }, event, options);
      case 'DEVICE_CAPABILITIES':
        return applyCapabilities(ctx, event, options);
      case 'DEVICE_NOTICE':
        return applyNotice(ctx, event, options);
      case 'CMD_DISMISS_NOTICE':
        return dismissNotice(ctx, event, options);
      case 'LINK_BLE_DOWN':
      case 'LINK_WS_DOWN':
      case 'LINK_NET_LOST':
        return resetCapabilities(ctx, event, options);
      default:
        return ctx;
    }
  }

  if (TERMINAL_TASK_STATES.has(ctx.state)) return ctx;

  switch (event.type) {
    case 'CMD_START': {
      if (ctx.state !== 'IDLE') return ctx;
      // 离桩 / 寻边由设备自驱，自动与手摇启动一致：始终进入 PREPARING。
      // 收到 edge_mapping 后交给自动还是手摇，由 `mode` 在 MappingSession 中分叉。
      return withMeta(
        {
          ...ctx,
          state: 'PREPARING',
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
      if (
        ctx.state !== 'WORKING' &&
        ctx.state !== 'UNDOCKING' &&
        ctx.state !== 'PREPARING'
      ) {
        return ctx;
      }
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
        { ...ctx, state: 'CANCELLED', resumeTo: null, error: null, notices: [] },
        event,
        options,
      );
    }

    case 'CMD_SWITCH_MANUAL': {
      // 守卫（设计 §5.1.2 / §7.3）：仅 PAUSED + 机器人允许手动 + 业务例外通过。
      if (ctx.state !== 'PAUSED') return ctx;
      if (!ctx.capabilities.canSwitchManual) return ctx;
      if (options.canEnterRemote && !options.canEnterRemote(ctx)) return ctx;
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
      // 守卫（设计 §5.1.3）：退出遥控需机器人允许切回自动。
      if (!ctx.capabilities.canSwitchAuto) return ctx;
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
        { ...ctx, state: 'COMPLETED', resumeTo: null, error: null, notices: [] },
        event,
        options,
      );
    }

    case 'CMD_START_COVERAGE': {
      // 业务特例（建图：MAP_BOUNDARY_DONE → 内部覆盖）由 MappingSession 处理；
      // 通用层不识别该命令，视为 no-op。
      return ctx;
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

    case 'DEVICE_ESTOP': {
      if (!event.active) {
        if (!ctx.estopActive) return ctx;
        return withMeta({ ...ctx, estopActive: false }, event, options);
      }
      // 正交打断：保存现场后进入 ESTOPPED（仅可恢复态保存 resumeTo）。
      return withMeta(
        {
          ...ctx,
          state: 'ESTOPPED',
          estopActive: true,
          resumeTo: ctx.resumeTo ?? estopSnapshot(ctx),
        },
        event,
        options,
      );
    }

    case 'DEVICE_CAPABILITIES':
      return applyCapabilities(ctx, event, options);

    case 'DEVICE_NOTICE':
      return applyNotice(ctx, event, options);

    case 'CMD_ADD_NEW_AREA': {
      // 用户确认添加新区域：清除提醒（实际指令由副作用层下发给机器人）。
      const notices = ctx.notices.filter(n => n.kind !== 'new_area_available');
      if (notices.length === ctx.notices.length) return ctx;
      return withMeta({ ...ctx, notices }, event, options);
    }

    case 'CMD_DISMISS_NOTICE':
      return dismissNotice(ctx, event, options);

    case 'LINK_NET_LOST': {
      if (ctx.state === 'WORKING' || ctx.state === 'RECHARGING') {
        return withMeta(
          {
            ...ctx,
            state: 'PAUSED',
            resumeTo: ctx.resumeTo ?? snapshot(ctx),
            capabilities: DEFAULT_CAPABILITIES,
          },
          event,
          options,
        );
      }
      return resetCapabilities(ctx, event, options);
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
    case 'LINK_WS_UP': {
      return withMeta(ctx, event, options);
    }

    case 'LINK_BLE_DOWN':
    case 'LINK_WS_DOWN': {
      // 断链：能力位不再可信，重置为默认（禁用模式切换）。
      return resetCapabilities(ctx, event, options);
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
      notices: [],
    },
    event,
    options,
  );
}

function applyCapabilities<P extends string>(
  ctx: TaskContext<P>,
  event: Extract<TaskEvent<P>, { type: 'DEVICE_CAPABILITIES' }>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  if (
    ctx.capabilities.canSwitchManual === event.canSwitchManual &&
    ctx.capabilities.canSwitchAuto === event.canSwitchAuto
  ) {
    // 能力位无变化：保持同引用，避免无谓重渲染。
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

function resetCapabilities<P extends string>(
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  if (ctx.capabilities === DEFAULT_CAPABILITIES) {
    return withMeta(ctx, event, options);
  }
  return withMeta({ ...ctx, capabilities: DEFAULT_CAPABILITIES }, event, options);
}

function applyNotice<P extends string>(
  ctx: TaskContext<P>,
  event: Extract<TaskEvent<P>, { type: 'DEVICE_NOTICE' }>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  const existing = ctx.notices.find(n => n.id === event.notice.id);
  if (existing && existing.kind === event.notice.kind && existing.mode === event.notice.mode) {
    // 同 id 同内容：去重，保持同引用。
    return ctx;
  }
  const others = ctx.notices.filter(n => n.id !== event.notice.id);
  return withMeta({ ...ctx, notices: [...others, event.notice] }, event, options);
}

function dismissNotice<P extends string>(
  ctx: TaskContext<P>,
  event: Extract<TaskEvent<P>, { type: 'CMD_DISMISS_NOTICE' }>,
  options: TaskReducerOptions<P>,
): TaskContext<P> {
  const notices = ctx.notices.filter(n => n.id !== event.id);
  if (notices.length === ctx.notices.length) return ctx;
  return withMeta({ ...ctx, notices }, event, options);
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

/** 急停现场：仅对可恢复态保存 `resumeTo`，IDLE/PREPARING 等不保存（复位回 IDLE）。 */
function estopSnapshot<P extends string>(
  ctx: TaskContext<P>,
): TaskResumeTarget<P> | null {
  return ESTOP_RESUMABLE_STATES.has(ctx.state) ? snapshot(ctx) : null;
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
