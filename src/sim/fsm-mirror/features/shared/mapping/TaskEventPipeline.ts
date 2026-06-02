/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/TaskEventPipeline.ts. DO NOT EDIT. !!!
// Source SHA-256: 3b03b5917642d2ce58c5fa5118b0b94f69d9550188d85fc02f062edb5f11f6c2
// Synced at: 2026-06-02T09:43:38.803Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
} from '../../../domain/shared/TaskFSM';
import { Arbitrator, type ArbitratedEvent } from '../../../infra/events/Arbitrator';
import {
  normalizeDeviceEvent,
  readDeviceSubStatus,
  readDeviceWorkStatus,
} from '../../../infra/events/EventAdapter';
import { mapBackendSubStatus } from './BackendPhaseMapper';
import {
  mapBackendStatus,
  type BackendMapperEvent,
  type BackendStatusRegistry,
  type UnknownBackendStatusEvent,
} from './BackendStatusMapper';
import type { UnknownBackendSubStatusEvent } from './unknownBackendSubStatus';

export interface TaskEventPipelineOptions<P extends string> {
  readonly getContext: () => TaskContext<P>;
  readonly dispatch: (event: TaskEvent<P>) => void;
  readonly backendRegistry?: BackendStatusRegistry<P>;
  readonly acceptBackendStatus?: (
    status: RobotWorkStatus,
    ctx: TaskContext<P>,
  ) => boolean;
  readonly onUnknownBackendStatus?: (event: UnknownBackendStatusEvent) => void;
  readonly onUnknownBackendSubStatus?: (event: UnknownBackendSubStatusEvent) => void;
  readonly now?: () => number;
  readonly staleWindowMs?: number;
  readonly ackTimeoutMs?: number;
}

/**
 * Runtime bridge for Phase 5/6: raw BLE/WS payload → normalized event →
 * backend edge mapper → source arbitrator → domain reducer dispatch.
 */
export class TaskEventPipeline<P extends string> {
  private readonly getContext: () => TaskContext<P>;
  private readonly dispatchTaskEvent: (event: TaskEvent<P>) => void;
  private readonly backendRegistry?: BackendStatusRegistry<P>;
  private readonly acceptBackendStatus?: (
    status: RobotWorkStatus,
    ctx: TaskContext<P>,
  ) => boolean;
  private readonly onUnknownBackendStatus?: (event: UnknownBackendStatusEvent) => void;
  private readonly onUnknownBackendSubStatus?: (event: UnknownBackendSubStatusEvent) => void;
  private readonly arbitrator: Arbitrator<P>;
  private prevBackendStatus: RobotWorkStatus | null = null;
  private prevSubStatus: string | null = null;

  constructor(options: TaskEventPipelineOptions<P>) {
    this.getContext = options.getContext;
    this.dispatchTaskEvent = options.dispatch;
    this.backendRegistry = options.backendRegistry;
    this.acceptBackendStatus = options.acceptBackendStatus;
    this.onUnknownBackendStatus = options.onUnknownBackendStatus;
    this.onUnknownBackendSubStatus = options.onUnknownBackendSubStatus;
    this.arbitrator = new Arbitrator<P>({
      now: options.now,
      staleWindowMs: options.staleWindowMs,
      ackTimeoutMs: options.ackTimeoutMs,
      onDispatch: event => this.forward(event),
    });
  }

  dispatch(event: TaskEvent<P>): void {
    if (event.type === 'DEVICE_WORK_STATUS' && this.backendRegistry) {
      this.dispatchBackendStatus(event.status, {
        source: event.source,
        ts: event.ts,
      });
      return;
    }
    this.arbitrator.dispatch(event);
  }

  dispatchRaw(raw: unknown, source: DeviceEventSource): void {
    const subStatus = readDeviceSubStatus(raw);
    const workStatus = readDeviceWorkStatus(raw) ?? 'idle';
    const skipPhaseEvents =
      subStatus !== null && subStatus === this.prevSubStatus;

    if (subStatus !== null) {
      const mapped = mapBackendSubStatus({ workStatus, subStatus });
      if (mapped.kind === 'unknown') {
        this.onUnknownBackendSubStatus?.({
          type: 'LOG_UNKNOWN_BACKEND_SUB_STATUS',
          subStatus: mapped.subStatus,
          workStatus: String(workStatus),
        });
      }
      this.prevSubStatus = subStatus;
    }

    for (const event of normalizeDeviceEvent<P>(raw, source)) {
      if (skipPhaseEvents && isSubStatusPhaseEvent(event)) {
        continue;
      }
      this.dispatch(event);
    }
  }

  resetBackendStatus(status: RobotWorkStatus | null = null): void {
    this.prevBackendStatus = status;
  }

  /** Clears `work_status` and `sub_status` edge memory (e.g. new task start). */
  resetDevicePayloadTracking(status: RobotWorkStatus | null = null): void {
    this.prevBackendStatus = status;
    this.prevSubStatus = null;
  }

  destroy(): void {
    this.arbitrator.destroy();
  }

  private dispatchBackendStatus(
    status: RobotWorkStatus,
    meta: { readonly source: DeviceEventSource; readonly ts: number },
  ): void {
    const ctx = this.getContext();
    if (this.acceptBackendStatus && !this.acceptBackendStatus(status, ctx)) {
      return;
    }

    const events = mapBackendStatus(
      { prev: this.prevBackendStatus, curr: status, ctx },
      this.backendRegistry!,
    );
    this.prevBackendStatus = status;
    if (events.length === 0) {
      this.arbitrator.dispatch({
        type: 'DEVICE_WORK_STATUS',
        status,
        source: meta.source,
        ts: meta.ts,
      });
      return;
    }
    events.forEach(event => this.forwardMapped(event));
  }

  private forwardMapped(event: BackendMapperEvent<P>): void {
    if (isUnknownBackendStatusEvent(event)) {
      this.onUnknownBackendStatus?.(event);
      return;
    }
    this.arbitrator.dispatch(event);
  }

  private forward(event: ArbitratedEvent<P>): void {
    if (isTaskEvent(event)) {
      this.dispatchTaskEvent(event);
    }
  }
}

export function isTaskEvent<P extends string>(
  event: ArbitratedEvent<P> | BackendMapperEvent<P>,
): event is TaskEvent<P> {
  switch (event.type) {
    case 'CMD_START':
    case 'CMD_PAUSE':
    case 'CMD_RESUME':
    case 'CMD_CANCEL':
    case 'CMD_SWITCH_MANUAL':
    case 'CMD_EXIT_MANUAL':
    case 'CMD_CONFIRM':
    case 'CMD_RETURN_DOCK':
    case 'CMD_RESET':
    case 'DEVICE_PHASE':
    case 'DEVICE_WORK_STATUS':
    case 'DEVICE_AREA':
    case 'DEVICE_BATTERY':
    case 'DEVICE_LOW_BATTERY':
    case 'DEVICE_DOCKED':
    case 'DEVICE_UNDOCKED':
    case 'DEVICE_ERROR':
    case 'LINK_BLE_UP':
    case 'LINK_BLE_DOWN':
    case 'LINK_WS_UP':
    case 'LINK_WS_DOWN':
    case 'LINK_NET_LOST':
    case 'TIMEOUT':
      return true;
    default:
      return false;
  }
}

function isUnknownBackendStatusEvent(
  event: BackendMapperEvent<string>,
): event is UnknownBackendStatusEvent {
  return event.type === 'LOG_UNKNOWN_BACKEND_STATUS';
}

function isSubStatusPhaseEvent<P extends string>(
  event: TaskEvent<P>,
): boolean {
  return event.type === 'DEVICE_PHASE' || event.type === 'DEVICE_UNDOCKED';
}