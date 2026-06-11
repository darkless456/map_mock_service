/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/mowing/state/mowingBackendRegistry.ts. DO NOT EDIT. !!!
// Source SHA-256: 1defa02e8d07428e87bfc1fc6a03bb2e2d8d953f8d96ca9a66e9110d7c65763a
// Synced at: 2026-06-11T13:44:16.069Z
import type { MowingPhase } from '../../../domain/mowing/MowingTask';
import type { BackendStatusRegistry } from '../../shared/mapping/BackendStatusMapper';

const now = () => Date.now();

/**
 * `work_status` 边沿表；`sub_status` 见 `BackendPhaseMapper`。
 *
 * 回桩（顶层 `work_status: return_dock`，docs §13）：
 * - 进入 / 完成无需自定义边沿——`mowing/idle->return_dock` 与 `return_dock->idle`
 *   未注册时 mapper 返回 `[]`，pipeline 直接下发原始 `DEVICE_WORK_STATUS`，由
 *   `mowingReducer` 接管（`return_dock` 进 `RETURNING_DOCK`、`idle` 收口 `COMPLETED`）。
 * - `stable.return_dock`：`return_dock` 稳定段不派事件，回桩子阶段交给 `DEVICE_PHASE`。
 */
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
      guard: ctx =>
        ctx.state === 'WORKING' ||
        ctx.state === 'PAUSED' ||
        ctx.state === 'RESUMING' ||
        ctx.state === 'RECHARGING',
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
      guard: ctx =>
        ctx.state === 'WORKING' ||
        ctx.state === 'PAUSED' ||
        ctx.state === 'RESUMING' ||
        ctx.state === 'RECHARGING',
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
    return_dock: { events: () => [] },
  },
};
