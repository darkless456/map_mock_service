/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/infra/events/EventAdapter.ts. DO NOT EDIT. !!!
// Source SHA-256: c2551d8b7b06602ade6389486a402bd3ac053c117d8d3e578d638c4381d4ada1
// Synced at: 2026-06-02T09:43:38.803Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskEvent,
} from '../../domain/shared/TaskFSM';
import {
  mapBackendSubStatus,
  normalizeLegacyPhase,
} from '../../features/shared/mapping/BackendPhaseMapper';
import { isCloudWsWorkStatus } from '../../features/shared/mapping/cloudWorkStatus';

type RawRecord = Record<string, unknown>;

/** Cloud WS: idle | mowing | charging | mapping | error — see `cloudWorkStatus.ts`. */
const ROBOT_WORK_STATUSES: ReadonlySet<string> = new Set([
  'idle',
  'mowing',
  'charging',
  'mapping',
  'error',
  /** BLE / local only; not in cloud NOTIFY_RATEL_STATUS. */
  'mapping_completed',
]);

/** Reads `sub_status` from WS/BLE notify roots (`data` / `payload` nested). */
export function readDeviceSubStatus(raw: unknown): string | null {
  const read = devicePayloadReader(raw);
  return read ? readString(read('sub_status')) : null;
}

/** Reads coarse `work_status` / `running_status` from the same notify roots. */
export function readDeviceWorkStatus(raw: unknown): RobotWorkStatus | string | null {
  const read = devicePayloadReader(raw);
  if (!read) return null;
  const status =
    readString(read('work_status')) ??
    readString(read('workStatus')) ??
    readString(read('running_status')) ??
    readString(read('status')) ??
    workStatusFromTaskStatus(readString(read('task_status')));
  return status;
}

export function normalizeDeviceEvent<P extends string>(
  raw: unknown,
  source: DeviceEventSource,
  now: () => number = Date.now,
): ReadonlyArray<TaskEvent<P>> {
  const read = devicePayloadReader(raw);
  if (!read) return [];
  const type = readString(read('type')) ?? readString(read('event')) ?? readString(read('msg'));
  const ts = readNumber(read('ts')) ?? readNumber(read('timestamp')) ?? now();
  const events: TaskEvent<P>[] = [];

  const status =
    readString(read('status')) ??
    readString(read('workStatus')) ??
    readString(read('work_status')) ??
    readString(read('running_status')) ??
    workStatusFromTaskStatus(readString(read('task_status')));
  if (status && isRobotWorkStatus(status) && acceptsWorkStatusForSource(status, source)) {
    events.push({ type: 'DEVICE_WORK_STATUS', status, source, ts });
  }

  appendPhaseEvents(events, {
    subStatus: readString(read('sub_status')),
    legacyPhase:
      readString(read('phase')) ??
      readString(read('mappingPhase')) ??
      readString(read('step')),
    workStatus: status,
    source,
    ts,
  });

  const area = readNumber(read('area')) ?? readNumber(read('area_m2'));
  if (area !== null) {
    events.push({ type: 'DEVICE_AREA', area, source, ts });
  }

  const battery =
    readNumber(read('battery')) ??
    readNumber(read('batteryPercent')) ??
    readNumber(read('battery_level'));
  if (battery !== null) {
    events.push({ type: 'DEVICE_BATTERY', battery, source, ts });
  }

  if (readBoolean(read('lowBattery')) || type === 'low_battery' || type === 'DEVICE_LOW_BATTERY') {
    events.push({ type: 'DEVICE_LOW_BATTERY' });
  }

  if (readBoolean(read('docked')) || type === 'docked' || type === 'DEVICE_DOCKED') {
    events.push({ type: 'DEVICE_DOCKED' });
  }

  if (readBoolean(read('undocked')) || type === 'undocked' || type === 'DEVICE_UNDOCKED') {
    events.push({ type: 'DEVICE_UNDOCKED' });
  }

  const errorCode = readString(read('errorCode')) ?? readString(read('code'));
  if (type === 'error' || type === 'DEVICE_ERROR' || errorCode || readString(read('task_status')) === 'FAILED') {
    events.push({
      type: 'DEVICE_ERROR',
      code: errorCode ?? errorCodeFromTaskStatus(root) ?? 'UNKNOWN_DEVICE_ERROR',
      recoverable: readBoolean(read('recoverable')) ?? false,
    });
  }

  return events;
}

export function normalizeDeviceEvents<P extends string>(
  rawEvents: readonly unknown[],
  source: DeviceEventSource,
  now: () => number = Date.now,
): ReadonlyArray<TaskEvent<P>> {
  return rawEvents.flatMap(raw => normalizeDeviceEvent<P>(raw, source, now));
}

function devicePayloadReader(raw: unknown): ((key: string) => unknown) | null {
  const root = asRecord(raw);
  if (!root) return null;
  const payload = asRecord(root.payload) ?? asRecord(root.data) ?? {};
  return (key: string) => root[key] ?? payload[key];
}

function asRecord(value: unknown): RawRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as RawRecord;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function workStatusFromTaskStatus(value: string | null): RobotWorkStatus | null {
  switch (value) {
    case 'ON_THE_WAY':
    case 'PAUSE':
      return 'mowing';
    case 'COMPLETE':
    case 'CANCEL':
      return 'idle';
    case 'FAILED':
      return 'error';
    default:
      return null;
  }
}

function errorCodeFromTaskStatus(raw: RawRecord): string | null {
  const code = readNumber(raw.task_error_code) ?? readNumber(raw.error_code);
  return code === null ? null : `mowing.failed.${code}`;
}

function appendPhaseEvents<P extends string>(
  events: TaskEvent<P>[],
  input: {
    readonly subStatus: string | null;
    readonly legacyPhase: string | null;
    readonly workStatus: RobotWorkStatus | null;
    readonly source: DeviceEventSource;
    readonly ts: number;
  },
): void {
  if (input.subStatus) {
    const mapped = mapBackendSubStatus({
      workStatus: input.workStatus ?? 'idle',
      subStatus: input.subStatus,
    });
    pushPhaseMapResult(events, mapped, input.source, input.ts);
    return;
  }

  if (input.legacyPhase) {
    const mappedPhase = normalizeLegacyPhase(input.legacyPhase);
    if (mappedPhase === 'DEVICE_UNDOCKED') {
      events.push({ type: 'DEVICE_UNDOCKED' });
    } else {
      events.push({
        type: 'DEVICE_PHASE',
        phase: mappedPhase as P,
        source: input.source,
        ts: input.ts,
      });
    }
  }
}

function pushPhaseMapResult<P extends string>(
  events: TaskEvent<P>[],
  mapped: ReturnType<typeof mapBackendSubStatus>,
  source: DeviceEventSource,
  ts: number,
): void {
  switch (mapped.kind) {
    case 'undocked':
      events.push({ type: 'DEVICE_UNDOCKED' });
      break;
    case 'phase':
      events.push({ type: 'DEVICE_PHASE', phase: mapped.phase as P, source, ts });
      break;
    case 'skip':
    case 'unknown':
      break;
    default: {
      const _exhaustive: never = mapped;
      return _exhaustive;
    }
  }
}

function isRobotWorkStatus(value: string): value is RobotWorkStatus {
  return ROBOT_WORK_STATUSES.has(value);
}

/** Cloud WS only exposes five coarse statuses; BLE may still send `mapping_completed`. */
function acceptsWorkStatusForSource(
  status: RobotWorkStatus,
  source: DeviceEventSource,
): boolean {
  if (source !== 'ws') {
    return true;
  }
  return isCloudWsWorkStatus(status);
}
