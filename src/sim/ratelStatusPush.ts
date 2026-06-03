import type { VirtualRobot, RobotDomain } from './virtualRobot';
import type { RatelNotifyPayload } from './mappingNotify';
import { ratelNotifyToMappingEvents } from './mappingNotify';
import { ratelNotifyToMowingEvents } from './mowingNotify';
import type { MappingEvent } from './fsm-mirror/domain/mapping/MappingSession';

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
  if (work === 'mapping' || work === 'mapping_completed') return 'mapping';
  if (prevWork === 'mowing') return 'mowing';
  if (prevWork === 'mapping' || prevWork === 'mapping_completed') return 'mapping';
  if (activeDomain === 'mowing') return 'mowing';
  return 'mapping';
}

/** Mirrors `mappingBackendRegistry` `mapping→idle` composite for mock FSM only. */
function applyMappingToIdleCompletion(robot: VirtualRobot): void {
  const ctx = robot.mapping;
  if (ctx.state !== 'WORKING' && ctx.state !== 'PAUSED' && ctx.state !== 'RESUMING') {
    return;
  }
  if (ctx.phase !== 'MAP_COVERAGE_DONE') {
    robot.dispatchMappingEvent({
      type: 'DEVICE_PHASE',
      phase: 'MAP_COVERAGE_DONE',
      ...nowEvent(),
    });
  }
  robot.dispatchMappingEvent({ type: 'CMD_CONFIRM' });
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
 * Skips duplicate `(work_status, sub_status)` pairs (§5 backend-status-mapper-update).
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
  robot.lastNotifyWorkStatus = work;
  robot.lastNotifySubStatus = sub;

  const domain = notifyTargetDomain(work, prevWork, robot.activeDomain);
  if (domain === 'mowing') {
    robot.activeDomain = 'mowing';
    for (const event of ratelNotifyToMowingEvents(
      { sn, work_status: work, sub_status: sub, battery_level: input.battery_level },
      sn,
    )) {
      robot.dispatchMowingEvent(event);
    }
    if (prevWork === 'mowing' && work === 'idle') {
      applyMowingToIdleCompletion(robot);
    }
  } else {
    robot.activeDomain = 'mapping';
    for (const event of ratelNotifyToMappingEvents(
      { sn, work_status: work, sub_status: sub, battery_level: input.battery_level },
      sn,
    )) {
      robot.dispatchMappingEvent(event);
    }
    if (prevWork === 'mapping' && work === 'idle') {
      applyMappingToIdleCompletion(robot);
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
