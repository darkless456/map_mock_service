/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/infra/events/Arbitrator.ts. DO NOT EDIT. !!!
// Source SHA-256: 1771423ef68537218081f2a285f87271050abc951b3628056b897e9cbaf0517f
// Synced at: 2026-07-06T12:55:44.977Z
import type { TaskEvent, TaskSource } from '../../domain/shared/TaskFSM';

export type UnknownArbitratedEvent = {
  readonly type: string;
  readonly source?: TaskSource;
  readonly ts?: number;
  readonly [key: string]: unknown;
};

export type ArbitratedEvent<P extends string> = TaskEvent<P> | UnknownArbitratedEvent;

export type TimerHandle = ReturnType<typeof setTimeout>;

export interface ArbitratorOptions<P extends string> {
  readonly now?: () => number;
  readonly staleWindowMs?: number;
  readonly ackTimeoutMs?: number;
  readonly setTimer?: (callback: () => void, timeoutMs: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
  readonly onDispatch?: (event: ArbitratedEvent<P>) => void;
}

interface RecentField {
  readonly source: TaskSource;
  readonly ts: number;
}

interface PendingAck<P extends string> {
  readonly command: ArbitratedEvent<P>;
  readonly startedAt: number;
}

const SOURCE_PRIORITY: Record<TaskSource, number> = {
  timeout: 1,
  ws: 2,
  ble: 3,
  cmd: 4,
};

export class Arbitrator<P extends string = string> {
  private readonly recentByField = new Map<string, RecentField>();
  private readonly now: () => number;
  private readonly staleWindowMs: number;
  private readonly ackTimeoutMs: number;
  private readonly setTimer: (callback: () => void, timeoutMs: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;
  private readonly onDispatch?: (event: ArbitratedEvent<P>) => void;
  private ackTimer: TimerHandle | null = null;
  private pendingAck: PendingAck<P> | null = null;

  constructor(options: ArbitratorOptions<P> = {}) {
    this.now = options.now ?? Date.now;
    this.staleWindowMs = options.staleWindowMs ?? 1000;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 3000;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.onDispatch = options.onDispatch;
  }

  accept(event: ArbitratedEvent<P>): ReadonlyArray<ArbitratedEvent<P>> {
    if (!this.shouldAccept(event)) return [];
    this.afterAccepted(event);
    return [event];
  }

  dispatch(event: ArbitratedEvent<P>): boolean {
    const accepted = this.accept(event);
    for (const item of accepted) {
      this.onDispatch?.(item);
    }
    return accepted.length > 0;
  }

  hasPendingAck(): boolean {
    return this.pendingAck !== null;
  }

  destroy(): void {
    this.clearAckTimer();
    this.recentByField.clear();
  }

  private shouldAccept(event: ArbitratedEvent<P>): boolean {
    const field = fieldForEvent(event);
    if (field === null) return true;

    const source = sourceForEvent(event);
    const ts = timestampForEvent(event, this.now());
    const current = this.recentByField.get(field);
    if (
      current &&
      SOURCE_PRIORITY[source] < SOURCE_PRIORITY[current.source] &&
      ts - current.ts < this.staleWindowMs
    ) {
      return false;
    }

    this.recentByField.set(field, { source, ts });
    return true;
  }

  private afterAccepted(event: ArbitratedEvent<P>): void {
    if (isAckEvent(event)) {
      this.clearAckTimer();
      return;
    }
    if (!isCommandEvent(event) || !isAckAwaitingCommand(event)) return;

    this.clearAckTimer();
    this.pendingAck = { command: event, startedAt: this.now() };
    this.ackTimer = this.setTimer(() => {
      this.pendingAck = null;
      this.ackTimer = null;
      this.onDispatch?.({ type: 'TIMEOUT', phase: 'ackPending' } as TaskEvent<P>);
    }, this.ackTimeoutMs);
  }

  private clearAckTimer(): void {
    if (this.ackTimer !== null) {
      this.clearTimer(this.ackTimer);
      this.ackTimer = null;
    }
    this.pendingAck = null;
  }
}

export function fieldForEvent<P extends string>(
  event: ArbitratedEvent<P>,
): string | null {
  switch (event.type) {
    case 'DEVICE_PHASE':
      return 'phase';
    case 'DEVICE_WORK_STATUS':
      return 'workStatus';
    case 'DEVICE_AREA':
      return 'area';
    case 'DEVICE_BATTERY':
    case 'DEVICE_LOW_BATTERY':
      return 'battery';
    case 'DEVICE_ERROR':
      return 'error';
    case 'LINK_BLE_UP':
    case 'LINK_BLE_DOWN':
      return 'bleLink';
    case 'LINK_WS_UP':
    case 'LINK_WS_DOWN':
      return 'wsLink';
    case 'LINK_NET_LOST':
      return 'network';
    default:
      if (event.type.startsWith('CMD_')) return 'command';
      if (event.type === 'TIMEOUT') return `timeout:${String(event.phase)}`;
      return null;
  }
}

export function sourceForEvent<P extends string>(event: ArbitratedEvent<P>): TaskSource {
  if (event.type.startsWith('CMD_')) return 'cmd';
  if (event.type === 'TIMEOUT') return 'timeout';
  if ('source' in event) {
    if (event.source === 'cmd' || event.source === 'ble' || event.source === 'ws') {
      return event.source;
    }
    if (event.source === 'timeout') return 'timeout';
  }
  if (event.type.startsWith('LINK_BLE')) return 'ble';
  if (event.type.startsWith('LINK_WS')) return 'ws';
  return 'timeout';
}

function timestampForEvent<P extends string>(
  event: ArbitratedEvent<P>,
  fallback: number,
): number {
  if ('ts' in event && typeof event.ts === 'number' && Number.isFinite(event.ts)) {
    return event.ts;
  }
  return fallback;
}

function isCommandEvent<P extends string>(event: ArbitratedEvent<P>): boolean {
  return event.type.startsWith('CMD_');
}

/**
 * 仅期望设备回执的状态变更命令才武装 ack 计时器；本地 UI 命令
 * （复位 / 添加新区域 / 关闭提醒）不等待设备 ack，避免误触发 `TIMEOUT`。
 */
function isAckAwaitingCommand<P extends string>(event: ArbitratedEvent<P>): boolean {
  return (
    event.type !== 'CMD_RESET' &&
    event.type !== 'CMD_ADD_NEW_AREA' &&
    event.type !== 'CMD_DISMISS_NOTICE'
  );
}

function isAckEvent<P extends string>(event: ArbitratedEvent<P>): boolean {
  return (
    event.type === 'DEVICE_PHASE' ||
    event.type === 'DEVICE_WORK_STATUS' ||
    event.type === 'DEVICE_DOCKED' ||
    event.type === 'DEVICE_UNDOCKED' ||
    event.type === 'DEVICE_ERROR'
  );
}
