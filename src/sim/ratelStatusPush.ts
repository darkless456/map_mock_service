import type { VirtualRobot, RobotDomain } from './virtualRobot';
import type { RatelNotifyPayload } from './mappingNotify';
import { ratelNotifyToMappingEvents } from './mappingNotify';
import { ratelNotifyToMowingEvents } from './mowingNotify';
import type { MappingEvent } from './fsm-mirror/domain/mapping/MappingSession';
import type { MowingEvent } from './fsm-mirror/domain/mowing/MowingTask';

export interface RatelStatusPushPayload {
  readonly work_status: string;
  readonly sub_status: string;
  readonly battery_level?: number;
  readonly sn: string;
}

function nowEvent() {
  return { source: 'ws' as const, ts: Date.now() };
}

function notifyTargetDomain(
  work: string,
  prevWork: string | null,
  activeDomain: RobotDomain,
): 'mapping' | 'mowing' {
  if (work === 'mowing') return 'mowing';
  // `return_dock` 属于割草域设备态（docs §13）。
  if (work === 'return_dock') return 'mowing';
  if (work === 'mapping' || work === 'mapping_completed') return 'mapping';
  if (prevWork === 'mowing') return 'mowing';
  if (prevWork === 'mapping' || prevWork === 'mapping_completed') return 'mapping';
  if (activeDomain === 'mowing') return 'mowing';
  return 'mapping';
}

function applyEmergencyStopEdge(
  robot: VirtualRobot,
  domain: 'mapping' | 'mowing',
  prevWork: string | null,
  work: string,
): boolean {
  const now = nowEvent();
  const dispatch =
    domain === 'mowing'
      ? (event: MowingEvent) => robot.dispatchMowingEvent(event)
      : (event: MappingEvent) => robot.dispatchMappingEvent(event);

  if (work === 'emergency_stop') {
    dispatch({ type: 'DEVICE_ESTOP', active: true, ...now } as never);
    return true;
  }

  if (prevWork === 'emergency_stop') {
    dispatch({ type: 'DEVICE_ESTOP', active: false, ...now } as never);
  }

  return false;
}

/** Applies the mapping completion composite for mock FSM only. */
function applyMappingToIdleCompletion(robot: VirtualRobot): void {
  const ctx = robot.mapping;
  if (ctx.state !== 'WORKING' && ctx.state !== 'PAUSED' && ctx.state !== 'RESUMING') {
    return;
  }
  if (ctx.phase !== 'MAP_COMPLETING') {
    robot.dispatchMappingEvent({
      type: 'DEVICE_PHASE',
      phase: 'MAP_COMPLETING',
      ...nowEvent(),
    });
  }
  robot.dispatchMappingEvent({ type: 'CMD_CONFIRM' });
}

/**
 * mapping-v4-final-spec.md §8: undocking failure is terminal, no retry path. The FSM mirror
 * treats `MAP_UNDOCKING_FAILED` as a plain phase value (same convention as the mowing domain's
 * `RETURN_DOCK_FAILED`, see `BackendPhaseMapper.ts`) — it does not itself drive `state`
 * to `ERRORED`. The mock layers a terminal `DEVICE_ERROR` on top once that phase lands, so
 * `MappingTaskService.syncFromContext`'s existing `ERRORED → task_status=FAILED` mapping fires.
 */
function applyUndockingFailedTermination(robot: VirtualRobot): void {
  const ctx = robot.mapping;
  if (ctx.phase !== 'MAP_UNDOCKING_FAILED' || ctx.state === 'ERRORED') return;
  robot.dispatchMappingEvent({ type: 'DEVICE_ERROR', code: 'undocking_failed', recoverable: false });
}

/** Mirrors mowing `work_status` idle edge for mock FSM when backend sends `idle/none`. */
function applyMowingToIdleCompletion(robot: VirtualRobot): void {
  const ctx = robot.mowing;
  if (ctx.state !== 'WORKING' && ctx.state !== 'PAUSED' && ctx.state !== 'RESUMING') {
    return;
  }
  robot.dispatchMowingEvent({
    type: 'DEVICE_WORK_STATUS',
    status: 'idle',
    ...nowEvent(),
  });
}

/**
 * Applies NOTIFY_RATEL_STATUS to mock FSM and returns WS broadcast payload.
 * Skips duplicate `(work_status, sub_status)` pairs (搂5 backend-status-mapper-update).
 */
export function applyRatelStatusPush(
  robot: VirtualRobot,
  input: RatelNotifyPayload,
): RatelStatusPushPayload | null {
  const work = input.work_status ?? robot.lastNotifyWorkStatus ?? 'idle';
  const sub = input.sub_status ?? 'none';
  const sn = input.sn ?? robot.sn;

  if (robot.lastNotifyWorkStatus === work && robot.lastNotifySubStatus === sub) {
    return null;
  }

  const prevWork = robot.lastNotifyWorkStatus;
  const prevSub = robot.lastNotifySubStatus;
  robot.lastNotifyWorkStatus = work;
  robot.lastNotifySubStatus = sub;
  if (prevSub !== sub) robot.lastNotifySubStatusEnteredAt = Date.now();

  const domain = notifyTargetDomain(work, prevWork, robot.activeDomain);
  if (domain === 'mowing') {
    robot.activeDomain = 'mowing';
    const isEmergencyStop = applyEmergencyStopEdge(robot, 'mowing', prevWork, work);
    if (!isEmergencyStop) {
      for (const event of ratelNotifyToMowingEvents(
        { sn, work_status: work, sub_status: sub, battery_level: input.battery_level },
        sn,
      )) {
        robot.dispatchMowingEvent(event);
      }
      if (prevWork === 'mowing' && work === 'idle') {
        applyMowingToIdleCompletion(robot);
      }
    }
  } else {
    robot.activeDomain = 'mapping';
    const isEmergencyStop = applyEmergencyStopEdge(robot, 'mapping', prevWork, work);
    if (!isEmergencyStop) {
      for (const event of ratelNotifyToMappingEvents(
        { sn, work_status: work, sub_status: sub, battery_level: input.battery_level },
        sn,
      )) {
        robot.dispatchMappingEvent(event);
      }
      if (prevWork === 'mapping' && work === 'idle') {
        applyMappingToIdleCompletion(robot);
      }
      applyUndockingFailedTermination(robot);
    }
  }

  return {
    work_status: work,
    sub_status: sub,
    battery_level: input.battery_level,
    sn,
  };
}

export type { MappingEvent };
