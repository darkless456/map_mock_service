/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/infra/events/EventAdapter.ts. DO NOT EDIT. !!!
// Source SHA-256: 05fb88f66404d503b74af7c6ca07971fea8db71f95421d8e9de84eda6bc4b76a
// Synced at: 2026-06-11T08:30:38.383Z
import type {
  DeviceEventSource,
  RobotWorkStatus,
  TaskEvent,
} from '../../domain/shared/TaskFSM';
import {
  mapBackendSubStatus,
  normalizeLegacyPhase,
} from '../../features/shared/mapping/BackendPhaseMapper';
import {
  isCloudWorkStatus,
  isRobotWorkStatus,
} from '../../features/shared/mapping/workStatus';

type RawRecord = Record<string, unknown>;

/**
 * Reads granular `sub_status` from WS/BLE notify roots (`data` / `payload` nested).
 * Cloud sentinel `none` / empty string is treated as absent so legacy `phase` can apply.
 */
export function readDeviceSubStatus(raw: unknown): string | null {
  const read = devicePayloadReader(raw);
  if (!read) return null;
  const sub = readString(read('sub_status'));
  if (sub == null) return null;
  const trimmed = sub.trim();
  if (trimmed.length === 0 || trimmed === 'none') return null;
  return trimmed;
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

/**
 * Single normalization point: raw payload → standard `TaskEvent[]` plus the
 * `work_status` / `sub_status` context the pipeline needs (dedup + unknown
 * reporting), so `sub_status` is mapped exactly once (see
 * `build-docs/fsm_ui_refactor_design.md` §4.4).
 */
export interface NormalizedDevicePayload<P extends string> {
  readonly events: ReadonlyArray<TaskEvent<P>>;
  readonly workStatus: RobotWorkStatus | string | null;
  readonly subStatus: string | null;
  /** Non-null when a present `sub_status` was not in the mapping table. */
  readonly unknownSubStatus: string | null;
}

export function normalizeDevicePayload<P extends string>(
  raw: unknown,
  source: DeviceEventSource,
  now: () => number = Date.now,
): NormalizedDevicePayload<P> {
  const read = devicePayloadReader(raw);
  if (!read) {
    return { events: [], workStatus: null, subStatus: null, unknownSubStatus: null };
  }
  const type = readString(read('type')) ?? readString(read('event')) ?? readString(read('msg'));
  const ts = readNumber(read('ts')) ?? readNumber(read('timestamp')) ?? now();
  const events: TaskEvent<P>[] = [];

  // 单一 work_status 来源（work_status 优先），DEVICE_WORK_STATUS 与 phase 上下文共用。
  const workStatus = readDeviceWorkStatus(raw);
  if (workStatus && isRobotWorkStatus(workStatus) && acceptsWorkStatusForSource(workStatus, source)) {
    events.push({ type: 'DEVICE_WORK_STATUS', status: workStatus, source, ts });
  }

  const subStatus = readDeviceSubStatus(raw);
  const { unknownSubStatus } = appendPhaseEvents(events, {
    subStatus,
    legacyPhase:
      readString(read('phase')) ??
      readString(read('mappingPhase')) ??
      readString(read('step')),
    workStatus,
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
      code: errorCode ?? errorCodeFromRead(read) ?? 'UNKNOWN_DEVICE_ERROR',
      recoverable: readBoolean(read('recoverable')) ?? false,
    });
  }

  return { events, workStatus, subStatus, unknownSubStatus };
}

export function normalizeDeviceEvent<P extends string>(
  raw: unknown,
  source: DeviceEventSource,
  now: () => number = Date.now,
): ReadonlyArray<TaskEvent<P>> {
  return normalizeDevicePayload<P>(raw, source, now).events;
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

function errorCodeFromRead(read: (key: string) => unknown): string | null {
  const code = readNumber(read('task_error_code')) ?? readNumber(read('error_code'));
  return code === null ? null : `mowing.failed.${code}`;
}

function appendPhaseEvents<P extends string>(
  events: TaskEvent<P>[],
  input: {
    readonly subStatus: string | null;
    readonly legacyPhase: string | null;
    readonly workStatus: RobotWorkStatus | string | null;
    readonly source: DeviceEventSource;
    readonly ts: number;
  },
): { readonly unknownSubStatus: string | null } {
  if (input.subStatus) {
    const mapped = mapBackendSubStatus({
      workStatus: input.workStatus ?? 'idle',
      subStatus: input.subStatus,
    });
    pushPhaseMapResult(events, mapped, input.source, input.ts);
    return { unknownSubStatus: mapped.kind === 'unknown' ? mapped.subStatus : null };
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

  return { unknownSubStatus: null };
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

/** Cloud WS only exposes five coarse statuses; BLE may still send `mapping_completed`. */
function acceptsWorkStatusForSource(
  status: RobotWorkStatus,
  source: DeviceEventSource,
): boolean {
  if (source !== 'ws') {
    return true;
  }
  return isCloudWorkStatus(status);
}
