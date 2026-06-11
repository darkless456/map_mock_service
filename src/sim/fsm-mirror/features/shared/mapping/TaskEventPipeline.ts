/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/TaskEventPipeline.ts. DO NOT EDIT. !!!
// Source SHA-256: 042f910d8e1ce6ed1209d5b01dc1c19de6289a2643035943e64cda19a04eecc3
// Synced at: 2026-06-11T13:44:16.069Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
} from '../../../domain/shared/TaskFSM';
import { Arbitrator, type ArbitratedEvent } from '../../../infra/events/Arbitrator';
import { normalizeDevicePayload } from '../../../infra/events/EventAdapter';
import {
  mapBackendStatus,
  type BackendMapperEvent,
  type BackendStatusRegistry,
  type UnknownBackendStatusEvent,
} from './BackendStatusMapper';
import type { UnknownBackendSubStatusEvent } from './unknownBackendSubStatus';
import { logMappingWsPipeline } from './pipelineDebugLog';

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
    // 单次归一化：events + work/sub 上下文一并产出，sub_status 只映射一次。
    const {
      events,
      workStatus: rawWorkStatus,
      subStatus,
      unknownSubStatus,
    } = normalizeDevicePayload<P>(raw, source);
    const workStatus = rawWorkStatus ?? 'idle';
    const skipPhaseEvents =
      subStatus !== null && subStatus === this.prevSubStatus;
    const ctx = this.getContext();

    logMappingWsPipeline('dispatch_raw', {
      source,
      subStatus,
      workStatus,
      skipPhaseEvents,
      prevSubStatus: this.prevSubStatus,
      fsmState: ctx.state,
      phase: ctx.phase,
      raw,
    });

    if (subStatus !== null) {
      logMappingWsPipeline('sub_status_mapped', {
        subStatus,
        workStatus,
        unknown: unknownSubStatus !== null,
      });
      if (unknownSubStatus !== null) {
        this.onUnknownBackendSubStatus?.({
          type: 'LOG_UNKNOWN_BACKEND_SUB_STATUS',
          subStatus: unknownSubStatus,
          workStatus: String(workStatus),
        });
      }
      this.prevSubStatus = subStatus;
    }

    const toDispatch: TaskEvent<P>[] = [];
    for (const event of events) {
      if (skipPhaseEvents && isSubStatusPhaseEvent(event)) {
        logMappingWsPipeline('phase_event_skipped', {
          source,
          subStatus,
          event,
        });
        continue;
      }
      toDispatch.push(event);
    }

    logMappingWsPipeline('events_dispatch', {
      source,
      eventCount: toDispatch.length,
      events: toDispatch,
    });

    for (const event of toDispatch) {
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
    case 'CMD_START_COVERAGE':
    case 'CMD_RETURN_DOCK':
    case 'CMD_RESET':
    case 'CMD_ADD_NEW_AREA':
    case 'CMD_DISMISS_NOTICE':
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

function isSubStatusPhaseEvent<P extends string>(
  event: TaskEvent<P>,
): boolean {
  return event.type === 'DEVICE_PHASE' || event.type === 'DEVICE_UNDOCKED';
}