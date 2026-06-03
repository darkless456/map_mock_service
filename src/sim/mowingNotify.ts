/**
 * Converts NOTIFY_RATEL_STATUS-shaped payloads into mowing FSM events
 * (same path as the mower app's EventAdapter).
 */
import { normalizeDeviceEvent } from './fsm-mirror/services/events/EventAdapter';
import type { MowingEvent } from './fsm-mirror/domain/mowing/MowingTask';
import type { RatelNotifyPayload } from './mappingNotify';

export type { RatelNotifyPayload };

export function ratelNotifyToMowingEvents(
  payload: RatelNotifyPayload,
  sn: string,
): readonly MowingEvent[] {
  const data: Record<string, unknown> = {
    sn: payload.sn ?? sn,
    work_status: payload.work_status ?? 'mowing',
    sub_status: payload.sub_status ?? 'none',
  };
  if (payload.battery_level != null) {
    data.battery_level = payload.battery_level;
  }
  return normalizeDeviceEvent(
    { cmd: 'NOTIFY_RATEL_STATUS', data },
    'ws',
  ) as MowingEvent[];
}
