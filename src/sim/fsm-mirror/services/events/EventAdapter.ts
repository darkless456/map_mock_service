/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/services/events/EventAdapter.ts. DO NOT EDIT. !!!
// Source SHA-256: 1fd6717bcc9db66b2f05f1cd84840c20a005b0a502e0edfe5f1ca43b739a7f51
// Synced at: 2026-05-30T08:44:44.301Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskEvent,
} from '../../domain/shared/TaskFSM';

type RawRecord = Record<string, unknown>;

const ROBOT_WORK_STATUSES: ReadonlySet<string> = new Set([
  'idle',
  'mowing',
  'charging',
  'mapping',
  'mapping_completed',
  'error',
]);

export function normalizeDeviceEvent<P extends string>(
  raw: unknown,
  source: DeviceEventSource,
  now: () => number = Date.now,
): ReadonlyArray<TaskEvent<P>> {
  const root = asRecord(raw);
  if (!root) return [];

  const payload = asRecord(root.payload) ?? asRecord(root.data) ?? {};
  const read = (key: string): unknown => root[key] ?? payload[key];
  const type = readString(read('type')) ?? readString(read('event')) ?? readString(read('msg'));
  const ts = readNumber(read('ts')) ?? readNumber(read('timestamp')) ?? now();
  const events: TaskEvent<P>[] = [];

  const status =
    readString(read('status')) ??
    readString(read('workStatus')) ??
    readString(read('work_status')) ??
    readString(read('running_status')) ??
    workStatusFromTaskStatus(readString(read('task_status')));
  if (status && isRobotWorkStatus(status)) {
    events.push({ type: 'DEVICE_WORK_STATUS', status, source, ts });
  }

  const phase =
    readString(read('phase')) ??
    readString(read('mappingPhase')) ??
    readString(read('step'));
  if (phase) {
    const mappedPhase = normalizePhase(phase);
    if (mappedPhase === 'DEVICE_UNDOCKED') {
      events.push({ type: 'DEVICE_UNDOCKED' });
    } else {
      events.push({ type: 'DEVICE_PHASE', phase: mappedPhase as P, source, ts });
    }
  }

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

function normalizePhase(phase: string): string {
  switch (phase) {
    case 'leaving':
      return 'DEVICE_UNDOCKED';
    case 'scanning':
      return 'MAP_SCAN_BOUNDARY';
    case 'scanningError':
    case 'hasBorderError':
      return 'MAP_SCAN_BOUNDARY_FAILED';
    case 'hasBorder':
      return 'MAP_BOUNDARY_FOUND';
    case 'fullBorder':
      return 'MAP_BOUNDARY_DONE';
    case 'newAreaChecking':
      return 'MAP_COVERAGE_PROBE';
    case 'newArea':
      return 'MAP_COVERAGE_NEW_AREA';
    case 'zigzagging':
      return 'MAP_COVERAGE_RUN';
    case 'zigzagged':
      return 'MAP_COVERAGE_DONE';
    default:
      return phase;
  }
}

function isRobotWorkStatus(value: string): value is RobotWorkStatus {
  return ROBOT_WORK_STATUSES.has(value);
}
