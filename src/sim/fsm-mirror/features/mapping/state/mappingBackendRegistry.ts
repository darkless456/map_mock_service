/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/mapping/state/mappingBackendRegistry.ts. DO NOT EDIT. !!!
// Source SHA-256: c0d7269211b356df2f59ee89f38590e643d292aa71e359e6a58db5e34da1e4bb
// Synced at: 2026-06-11T13:20:40.103Z
import type { MappingPhase } from '../../../domain/mapping/MappingSession';
import type { BackendStatusRegistry } from '../../shared/mapping/BackendStatusMapper';

const now = () => Date.now();

/**
 * `work_status` 边沿 → 复合 FSM 事件。`sub_status` → phase 由 `BackendPhaseMapper` 处理。
 *
 * 建图完成（云端 WS，§5.4）：
 * 1. `sub_status: exit_mapping` → `MAP_COVERAGE_DONE`
 * 2. `work_status: mapping → idle` → 本表 `mapping→idle`（`MAP_COVERAGE_DONE` + `CMD_CONFIRM`）→ `COMPLETED`
 *
 * `mapping→mapping_completed` 仅 BLE/遗留协议；云端不推送 `mapping_completed`。
 */
export const MAPPING_BACKEND_REGISTRY: BackendStatusRegistry<MappingPhase> = {
  edges: {
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
