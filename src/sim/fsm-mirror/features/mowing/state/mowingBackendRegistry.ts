/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/mowing/state/mowingBackendRegistry.ts. DO NOT EDIT. !!!
// Source SHA-256: 0bd7f50dcb264b7fc758632798a413ef099eecb73af0a7db7b2564f704e6f56f
// Synced at: 2026-06-02T09:43:38.803Z
import type { MowingPhase } from '../../../domain/mowing/MowingTask';
import type { BackendStatusRegistry } from '../../shared/mapping/BackendStatusMapper';

const now = () => Date.now();

/** `work_status` 边沿表；`sub_status`（`mowing` / `edge` / `return_dock`）见 `BackendPhaseMapper`。 */
export const MOWING_BACKEND_REGISTRY: BackendStatusRegistry<MowingPhase> = {
  edges: {
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
