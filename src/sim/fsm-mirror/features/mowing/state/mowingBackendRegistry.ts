/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/mowing/state/mowingBackendRegistry.ts. DO NOT EDIT. !!!
// Source SHA-256: 7a3932d71ae03d21e492ff5e063e1e30a75136436dcc48b9f4f0d0743d2ab23d
// Synced at: 2026-05-30T08:44:44.301Z
import type { MowingPhase } from '../../../domain/mowing/MowingTask';
import type { ErrorKind } from '../../../domain/shared/TaskFSM';
import type { BackendStatusRegistry } from '../../shared/mapping/BackendStatusMapper';

const now = () => Date.now();
const wsTs = () => ({ source: 'ws' as const, ts: now() });

export const MOWING_BACKEND_REGISTRY: BackendStatusRegistry<MowingPhase> = {
  edges: {
    '*->estop': {
      events: () => [{ type: 'DEVICE_ESTOP', active: true, ...wsTs() }],
    },
    'estop->*': {
      events: () => [{ type: 'DEVICE_ESTOP', active: false, ...wsTs() }],
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
    'null->mowing': {
      guard: ctx => ctx.state === 'IDLE' || ctx.state === 'PREPARING',
      events: () => [
        { type: 'CMD_START', mode: 'auto', taskMode: 'MOW_GLOBAL' },
        { type: 'DEVICE_WORK_STATUS', status: 'mowing', source: 'ws', ts: now() },
      ],
    },
    'null->charging': {
      guard: ctx => ctx.state === 'IDLE',
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'charging', source: 'ws', ts: now() },
      ],
    },
    'idle->mowing': {
      guard: ctx => ctx.state === 'IDLE' || ctx.state === 'PREPARING',
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'mowing', source: 'ws', ts: now() },
      ],
    },
    'idle->charging': {
      events: () => [
        { type: 'DEVICE_WORK_STATUS', status: 'charging', source: 'ws', ts: now() },
      ],
    },
    'mowing->idle': [
      {
        guard: ctx => ctx.state === 'CANCELLED' || ctx.state === 'COMPLETED',
        events: () => [],
      },
      {
        guard: ctx => ctx.state === 'WORKING' || ctx.state === 'PAUSED' || ctx.state === 'RESUMING',
        events: () => [
          { type: 'DEVICE_PHASE', phase: 'MOW_RUNNING', source: 'ws', ts: now() },
          { type: 'CMD_CONFIRM' },
        ],
      },
    ],
    'mowing->charging': {
      guard: ctx => ctx.state === 'WORKING' || ctx.state === 'PAUSED',
      events: () => [
        { type: 'DEVICE_LOW_BATTERY' },
        { type: 'DEVICE_WORK_STATUS', status: 'charging', source: 'ws', ts: now() },
      ],
    },
    'charging->mowing': {
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
    mowing: { events: () => [] },
  },
};

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
