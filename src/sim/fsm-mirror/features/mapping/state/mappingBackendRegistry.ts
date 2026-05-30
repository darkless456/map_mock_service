/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/mapping/state/mappingBackendRegistry.ts. DO NOT EDIT. !!!
// Source SHA-256: e51c43c03a760a42927086cef74246d6a329a0b87ec585ffd5cd57be16f4a873
// Synced at: 2026-05-30T08:44:44.301Z
import type { MappingPhase } from '../../../domain/mapping/MappingSession';
import type { ErrorKind, TaskNotice } from '../../../domain/shared/TaskFSM';
import type { BackendStatusRegistry } from '../../shared/mapping/BackendStatusMapper';

const now = () => Date.now();

const wsTs = () => ({ source: 'ws' as const, ts: now() });

export const MAPPING_BACKEND_REGISTRY: BackendStatusRegistry<MappingPhase> = {
  edges: {
    '*->estop': {
      events: () => [{ type: 'DEVICE_ESTOP', active: true, ...wsTs() }],
    },
    'estop->*': {
      events: () => [{ type: 'DEVICE_ESTOP', active: false, ...wsTs() }],
    },
    'mapping.phase=precheck': {
      events: () => [{ type: 'DEVICE_PHASE', phase: 'MAP_PRECHECK', ...wsTs() }],
    },
    'mapping.phase=precheck_failed': {
      events: () => [
        { type: 'DEVICE_ERROR', code: 'PRECHECK_FAILED', recoverable: true },
      ],
    },
    'mapping.phase=boundary_closing': {
      events: () => [{ type: 'DEVICE_PHASE', phase: 'MAP_BOUNDARY_CLOSING', ...wsTs() }],
    },
    'mapping.phase=boundary_close_failed': {
      events: () => [
        { type: 'DEVICE_ERROR', code: 'BOUNDARY_CLOSE_FAILED', recoverable: true },
      ],
    },
    'mapping.phase=boundary_wait': {
      events: () => [{ type: 'DEVICE_PHASE', phase: 'MAP_BOUNDARY_WAIT', ...wsTs() }],
    },
    'mapping.phase=coverage_wait': {
      events: () => [{ type: 'DEVICE_PHASE', phase: 'MAP_COVERAGE_WAIT', ...wsTs() }],
    },
    'mapping.notice.new_area_available': {
      events: (_ctx, input) => [
        { type: 'DEVICE_NOTICE', notice: noticeFromRaw(input.raw), ...wsTs() },
      ],
    },
    capabilities: {
      events: (_ctx, input) => [
        {
          type: 'DEVICE_CAPABILITIES',
          canSwitchManual: readBoolean(input.raw?.can_switch_manual) ?? readBoolean(input.raw?.canSwitchManual) ?? false,
          canSwitchAuto: readBoolean(input.raw?.can_switch_auto) ?? readBoolean(input.raw?.canSwitchAuto) ?? false,
          ...wsTs(),
        },
      ],
    },
    'error.subcode': {
      events: (_ctx, input) => [
        {
          type: 'DEVICE_ERROR',
          code: readString(input.raw?.code) ?? 'DEVICE_ERROR',
          recoverable: readBoolean(input.raw?.recoverable) ?? false,
          kind: errorKindFromSubcode(readString(input.raw?.subcode)),
        },
      ],
    },
    '*->error': {
      events: (_ctx, input) => [
        {
          type: 'DEVICE_ERROR',
          code: readString(input.raw?.code) ?? 'DEVICE_ERROR',
          recoverable: readBoolean(input.raw?.recoverable) ?? false,
          kind: errorKindFromSubcode(readNestedErrorSubcode(input.raw)),
        },
      ],
    },
    'null->mapping': {
      guard: ctx => ctx.state === 'IDLE' || ctx.state === 'PREPARING',
      events: () => [
        { type: 'CMD_START', mode: 'auto' },
        { type: 'DEVICE_WORK_STATUS', status: 'mapping', source: 'ws', ts: now() },
      ],
    },
    'null->mapping_completed': {
      guard: ctx => ctx.state !== 'CANCELLED' && ctx.state !== 'COMPLETED',
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'mapping_completed', source: 'ws', ts: now() },
      ],
    },
    'null->charging': {
      guard: ctx => ctx.state === 'IDLE',
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'charging', source: 'ws', ts: now() },
      ],
    },
    'idle->mapping': {
      guard: ctx => ctx.state === 'IDLE' || ctx.state === 'PREPARING',
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'mapping', source: 'ws', ts: now() },
      ],
    },
    'idle->charging': {
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'charging', source: 'ws', ts: now() },
      ],
    },
    'mapping->idle': [
      {
        guard: ctx => ctx.state === 'CANCELLED' || ctx.state === 'COMPLETED',
        events: () => [],
      },
      {
        guard: ctx => ctx.state === 'WORKING' || ctx.state === 'PAUSED' || ctx.state === 'RESUMING',
        events: () => [
          { type: 'DEVICE_PHASE', phase: 'MAP_COVERAGE_DONE', source: 'ws', ts: now() },
          { type: 'CMD_CONFIRM' },
        ],
      },
    ],
    'mapping->mapping_completed': {
      guard: ctx => ctx.state !== 'CANCELLED' && ctx.state !== 'COMPLETED',
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'mapping_completed', source: 'ws', ts: now() },
      ],
    },
    'mapping_completed->idle': {
      events: () => [],
    },
    'mapping->charging': {
      guard: ctx => ctx.state === 'WORKING' || ctx.state === 'PAUSED',
      events: () => [
        { type: 'DEVICE_LOW_BATTERY' },
        { type: 'DEVICE_WORK_STATUS', status: 'charging', source: 'ws', ts: now() },
      ],
    },
    'charging->mapping': {
      guard: ctx => ctx.state === 'RECHARGING' && ctx.phase === 'charged',
      events: () => [{ type: 'CMD_RESUME' }],
    },
    'charging->idle': {
      guard: ctx => ctx.state === 'RECHARGING',
      events: () => [{ type: 'CMD_CANCEL' }],
    },
    'error->idle': {
      guard: ctx => ctx.state === 'ERRORED',
      events: () => [{ type: 'CMD_RESET' }],
    },
  },
  stable: {
    mapping: { events: () => [] },
  },
  fallback: ({ curr }) => {
    if (typeof curr === 'string' && !['idle', 'mapping', 'mowing', 'charging', 'mapping_completed', 'error'].includes(curr)) {
      return [{ type: 'LOG_UNKNOWN_BACKEND_STATUS', status: curr }];
    }
    return [];
  },
};

function noticeFromRaw(raw: Record<string, unknown> | undefined): TaskNotice {
  const mode = raw?.mode === 'remote' ? 'remote' : 'auto';
  return {
    id: readString(raw?.id) ?? `new_area_available:${mode}`,
    kind: 'new_area_available',
    mode,
    ts: now(),
  };
}

function errorKindFromSubcode(value: string | null): ErrorKind {
  switch (value) {
    case 'stuck':
    case 'lifted':
    case 'tilted':
    case 'flipped':
      return value;
    default:
      return 'other';
  }
}

function readNestedErrorSubcode(raw: Record<string, unknown> | undefined): string | null {
  const error = raw?.error;
  if (typeof error !== 'object' || error === null || Array.isArray(error)) {
    return readString(raw?.subcode);
  }
  return readString((error as { readonly subcode?: unknown }).subcode) ?? readString(raw?.subcode);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}
