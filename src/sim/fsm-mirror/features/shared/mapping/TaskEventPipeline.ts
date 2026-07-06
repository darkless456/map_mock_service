/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/TaskEventPipeline.ts. DO NOT EDIT. !!!
// Source SHA-256: c9d04358296b69bb0fd2b43ebdf517b602a27145ef5864a1dce44596f3b00e76
// Synced at: 2026-07-06T12:55:44.977Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
} from '../../../domain/shared/TaskFSM';
import { Arbitrator, type ArbitratedEvent } from '../../../infra/events/Arbitrator';
import { normalizeDevicePayload } from '../../../infra/events/EventAdapter';
import {
  isEmergencyStopStatus,
  mapBackendStatus,
  mapEmergencyStopEdge,
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
    const ctx = this.getContext();
    // Never skip DEVICE_PHASE while RESUMING: the FSM needs it to exit RESUMING
    // into WORKING (e.g. after CMD_RESET following an emergency-stop).
    const skipPhaseEvents =
      ctx.state !== 'RESUMING' &&
      subStatus !== null &&
      subStatus === this.prevSubStatus;

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
    const releasedFromEmergencyStop =
      this.prevBackendStatus !== null &&
      isEmergencyStopStatus(this.prevBackendStatus) &&
      !isEmergencyStopStatus(status);
    if (
      !isEmergencyStopStatus(status) &&
      !releasedFromEmergencyStop &&
      this.acceptBackendStatus &&
      !this.acceptBackendStatus(status, ctx)
    ) {
      return;
    }

    const estopEvents = mapEmergencyStopEdge(
      { prev: this.prevBackendStatus, curr: status, ctx },
      meta,
    );
    const events = mapBackendStatus(
      { prev: this.prevBackendStatus, curr: status, ctx },
      this.backendRegistry!,
    );
    this.prevBackendStatus = status;

    if (estopEvents.length > 0) {
      estopEvents.forEach(event => this.forwardMapped(event));
      if (isEmergencyStopStatus(status)) {
        this.prevSubStatus = null;
        return;
      }
      // React reducers do not synchronously update `getContext()` within the same
      // WS frame. Use the pre-release context captured above to decide whether
      // the release edge should auto-confirm recovery.
      if (releasedFromEmergencyStop && ctx.state === 'ESTOPPED' && ctx.resumeTo !== null) {
        this.arbitrator.dispatch({ type: 'CMD_RESET' });
      }
    }

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