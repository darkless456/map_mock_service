/**
 * Converts NOTIFY_RATEL_STATUS-shaped payloads into mapping FSM events
 * (same path as the mower app's EventAdapter).
 */
import { normalizeDeviceEvent } from './fsm-mirror/services/events/EventAdapter';
import type { MappingEvent } from './fsm-mirror/domain/mapping/MappingSession';

export interface RatelNotifyPayload {
  readonly work_status?: string;
  readonly sub_status?: string;
  readonly battery_level?: number;
  readonly sn?: string;
}

export function ratelNotifyToMappingEvents(
  payload: RatelNotifyPayload,
  sn: string,
): readonly MappingEvent[] {
  const data: Record<string, unknown> = {
    sn: payload.sn ?? sn,
    work_status: payload.work_status ?? 'mapping',
    sub_status: payload.sub_status ?? 'none',
  };
  if (payload.battery_level != null) {
    data.battery_level = payload.battery_level;
  }
  return normalizeDeviceEvent(
    { cmd: 'NOTIFY_RATEL_STATUS', data },
    'ws',
  ) as MappingEvent[];
}
