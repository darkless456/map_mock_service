/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/TaskEventPipeline.ts. DO NOT EDIT. !!!
// Source SHA-256: c64ff5ee587485c3c4abdaa991db4dd8c4cc513819ec4ae9fc53e47ff8030c04
// Synced at: 2026-05-30T08:44:44.301Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
} from '../../../domain/shared/TaskFSM';
import { Arbitrator, type ArbitratedEvent } from '../../../services/events/Arbitrator';
import { normalizeDeviceEvent } from '../../../services/events/EventAdapter';
import {
  mapBackendStatus,
  type BackendMapperEvent,
  type BackendStatusRegistry,
  type UnknownBackendStatusEvent,
} from './BackendStatusMapper';

export interface TaskEventPipelineOptions<P extends string> {
  readonly getContext: () => TaskContext<P>;
  readonly dispatch: (event: TaskEvent<P>) => void;
  readonly backendRegistry?: BackendStatusRegistry<P>;
  readonly acceptBackendStatus?: (
    status: RobotWorkStatus,
    ctx: TaskContext<P>,
  ) => boolean;
  readonly onUnknownBackendStatus?: (event: UnknownBackendStatusEvent) => void;
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
  private readonly arbitrator: Arbitrator<P>;
  private prevBackendStatus: RobotWorkStatus | null = null;

  constructor(options: TaskEventPipelineOptions<P>) {
    this.getContext = options.getContext;
    this.dispatchTaskEvent = options.dispatch;
    this.backendRegistry = options.backendRegistry;
    this.acceptBackendStatus = options.acceptBackendStatus;
    this.onUnknownBackendStatus = options.onUnknownBackendStatus;
    this.arbitrator = new Arbitrator<P>({
      now: options.now,
      staleWindowMs: options.staleWindowMs,
      ackTimeoutMs: options.ackTimeoutMs,
      onDispatch: event => this.forward(event),
    });
  }

  dispatch(event: TaskEvent<P>): void {
    if (event.type === 'DEVICE_WORK_STATUS' && this.backendRegistry) {
      this.dispatchBackendStatus(event.status);
      return;
    }
    this.arbitrator.dispatch(event);
  }

  dispatchRaw(raw: unknown, source: DeviceEventSource): void {
    for (const event of normalizeDeviceEvent<P>(raw, source)) {
      this.dispatch(event);
    }
  }

  resetBackendStatus(status: RobotWorkStatus | null = null): void {
    this.prevBackendStatus = status;
  }

  destroy(): void {
    this.arbitrator.destroy();
  }

  private dispatchBackendStatus(status: RobotWorkStatus): void {
    const ctx = this.getContext();
    if (this.acceptBackendStatus && !this.acceptBackendStatus(status, ctx)) {
      return;
    }

    const events = mapBackendStatus(
      { prev: this.prevBackendStatus, curr: status, ctx },
      this.backendRegistry!,
    );
    this.prevBackendStatus = status;
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
    case 'CMD_FINISH_AND_RETURN_DOCK':
    case 'CMD_RESET':
    case 'CMD_RETRY':
    case 'CMD_ADD_NEW_AREA':
    case 'CMD_DISMISS_NOTICE':
    case 'CMD_CONTINUE_COVERAGE':
    case 'CMD_GOTO_EDIT':
    case 'CMD_SAVE':
    case 'DEVICE_PHASE':
    case 'DEVICE_WORK_STATUS':
    case 'DEVICE_AREA':
    case 'DEVICE_BATTERY':
    case 'DEVICE_LOW_BATTERY':
    case 'DEVICE_DOCKED':
    case 'DEVICE_UNDOCKED':
    case 'DEVICE_ERROR':
    case 'DEVICE_CAPABILITIES':
    case 'DEVICE_NOTICE':
    case 'DEVICE_ESTOP':
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