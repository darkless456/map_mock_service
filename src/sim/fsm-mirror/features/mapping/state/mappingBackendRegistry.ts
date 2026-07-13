/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/mapping/state/mappingBackendRegistry.ts. DO NOT EDIT. !!!
// Source SHA-256: 16dab44b92623823e00cb9b45a68182c116894be2c80934a79d62ed8e2e99c7a
// Synced at: 2026-07-13T09:08:25.761Z
import type { MappingPhase } from '../../../domain/mapping/MappingSession';
import type { BackendStatusRegistry } from '../../shared/mapping/BackendStatusMapper';

const now = () => Date.now();

/**
 * `work_status` 边沿 → 复合 FSM 事件。`sub_status` → phase 由 `BackendPhaseMapper` 处理。
 *
 * 建图完成：`work_status: mapping → idle` → 本表 `mapping→idle`（`MAP_COMPLETING` +
 * `CMD_CONFIRM`）→ `COMPLETED`。"等待建图结束"的真实 sub_status 键待后端定稿
 * （见 build-docs/pudu_ratel_app_mower/mapping_flow_refactor_design.md §10 #3）。
 *
 * 急停（`work_status: emergency_stop`）不在本表落普通 `DEVICE_WORK_STATUS`；
 * 统一由共享 `TaskEventPipeline` 归一为 `DEVICE_ESTOP{active:true|false}`。
 *
 * `mapping_completed` 是瞬时信号，不再作为结束建图的驱动信号（设计稿 §4.3 #1）：
 * 本表下方 `null->mapping_completed`/`mapping->mapping_completed` 仍如实转译该后端
 * 状态（避免走 fallback/`LOG_UNKNOWN_BACKEND_STATUS`），但派发出的
 * `DEVICE_WORK_STATUS status:'mapping_completed'` 到 `MappingSession.ts` 后是安全 no-op。
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
          { type: 'DEVICE_PHASE', phase: 'MAP_COMPLETING', source: 'ws', ts: now() },
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
    if (typeof curr === 'string' && !['idle', 'mapping', 'mowing', 'charging', 'mapping_completed', 'return_dock', 'emergency_stop', 'error'].includes(curr)) {
      return [{ type: 'LOG_UNKNOWN_BACKEND_STATUS', status: curr }];
    }
    return [];
  },
};
