import type { VirtualRobot } from './virtualRobot';
import type { RatelNotifyPayload } from './mappingNotify';
import { ratelNotifyToMappingEvents } from './mappingNotify';
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

/**
 * Applies NOTIFY_RATEL_STATUS to mock FSM and returns WS broadcast payload.
 * Skips duplicate `(work_status, sub_status)` pairs (§5 backend-status-mapper-update).
 */
export function applyRatelStatusPush(
  robot: VirtualRobot,
  input: RatelNotifyPayload,
): RatelStatusPushPayload | null {
  const work = input.work_status ?? robot.lastNotifyWorkStatus ?? 'mapping';
  const sub = input.sub_status ?? 'none';
  const sn = input.sn ?? robot.sn;

  if (robot.lastNotifyWorkStatus === work && robot.lastNotifySubStatus === sub) {
    return null;
  }

  const prevWork = robot.lastNotifyWorkStatus;
  robot.lastNotifyWorkStatus = work;
  robot.lastNotifySubStatus = sub;
  robot.activeDomain = 'mapping';

  for (const event of ratelNotifyToMappingEvents(
    {
      sn,
      work_status: work,
      sub_status: sub,
      battery_level: input.battery_level,
    },
    sn,
  )) {
    robot.dispatchMappingEvent(event);
  }

  if (prevWork === 'mapping' && work === 'idle') {
    applyMappingToIdleCompletion(robot);
  }

  return {
    work_status: work,
    sub_status: sub,
    battery_level: input.battery_level,
    sn,
  };
}

export type { MappingEvent };
