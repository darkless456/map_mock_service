/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/mapEdit/MapEditSession.ts. DO NOT EDIT. !!!
// Source SHA-256: 2246ead89c0b8ecb6f290b395ffaa5f5f99256c6dd249c448e5d5a2b0cdea60d
// Synced at: 2026-06-29T07:01:12.946Z
/**
 * MapEditSession FSM — Phase 4 domain-only map-edit workflow.
 *
 * This module is intentionally not wired to screens in this iteration. It
 * provides the future domain/state contract for loading, editing, saving and
 * retrying map annotations.
 */

import {
  TERMINAL_TASK_STATES,
  createInitialTaskContext,
  type TaskContext,
  type TaskEvent,
  type TaskSource,
  type TaskState,
} from '../shared/TaskFSM';
import { safeLog, type LoggerLike } from '../shared/LoggerLike';

export type MapEditPhase =
  | 'EDIT_LOADING'
  | 'EDIT_EDITING'
  | 'EDIT_SAVING'
  | 'EDIT_SAVE_FAILED';

export interface MapEditContext extends TaskContext<MapEditPhase> {
  readonly dirty: boolean;
  readonly mapId: string | null;
}

export type MapEditEvent =
  | TaskEvent<MapEditPhase>
  | { readonly type: 'CMD_LOAD'; readonly mapId: string }
  | { readonly type: 'DEVICE_LOADED' }
  | { readonly type: 'CMD_MARK_DIRTY'; readonly dirty?: boolean }
  | { readonly type: 'DEVICE_SAVE_OK' }
  | { readonly type: 'DEVICE_SAVE_FAILED'; readonly code: string; readonly recoverable?: boolean };

export const initialMapEditState: MapEditContext = {
  ...createInitialTaskContext<MapEditPhase>(),
  dirty: false,
  mapId: null,
};

export function mapEditReducer(
  ctx: MapEditContext,
  event: MapEditEvent,
  logger?: LoggerLike,
): MapEditContext {
  const next = transition(ctx, event);
  if (next !== ctx && next.state !== ctx.state) {
    safeLog(
      logger,
      'info',
      'mapEdit.fsm.transition',
      `${ctx.state} -> ${next.state}`,
      { from: ctx.state, to: next.state, event, source: next.lastSource, ts: next.lastSourceTs },
    );
  } else if (next === ctx) {
    safeLog(logger, 'debug', 'mapEdit.fsm.transition', `noop in ${ctx.state}`, {
      from: ctx.state,
      event,
    });
  }
  return next;
}

function transition(ctx: MapEditContext, event: MapEditEvent): MapEditContext {
  if (event.type === 'CMD_RESET') {
    if (!TERMINAL_TASK_STATES.has(ctx.state)) return ctx;
    return withMeta(initialMapEditState, event);
  }

  if (TERMINAL_TASK_STATES.has(ctx.state)) return ctx;

  switch (event.type) {
    case 'CMD_LOAD':
      if (ctx.state !== 'IDLE') return ctx;
      return withMeta(
        {
          ...ctx,
          state: 'WORKING',
          phase: 'EDIT_LOADING',
          mapId: event.mapId,
          dirty: false,
          error: null,
        },
        event,
      );
    case 'CMD_START':
      if (ctx.state !== 'IDLE') return ctx;
      return withMeta(
        { ...ctx, state: 'WORKING', phase: 'EDIT_LOADING', dirty: false, error: null },
        event,
      );
    case 'DEVICE_LOADED':
      if (ctx.state !== 'WORKING' || ctx.phase !== 'EDIT_LOADING') return ctx;
      return withMeta({ ...ctx, phase: 'EDIT_EDITING', dirty: false }, event);
    case 'CMD_MARK_DIRTY':
      if (ctx.state !== 'WORKING' || ctx.phase !== 'EDIT_EDITING') return ctx;
      return withMeta({ ...ctx, dirty: event.dirty ?? true }, event);
    case 'CMD_CONFIRM':
      if (ctx.state !== 'WORKING') return ctx;
      if (ctx.phase !== 'EDIT_EDITING' && ctx.phase !== 'EDIT_SAVE_FAILED') return ctx;
      return withMeta({ ...ctx, phase: 'EDIT_SAVING' }, event);
    case 'DEVICE_SAVE_OK':
      if (ctx.state !== 'WORKING' || ctx.phase !== 'EDIT_SAVING') return ctx;
      return withMeta(
        { ...ctx, state: 'COMPLETED', dirty: false, error: null },
        event,
      );
    case 'DEVICE_SAVE_FAILED':
      if (ctx.state !== 'WORKING' || ctx.phase !== 'EDIT_SAVING') return ctx;
      return withMeta(
        {
          ...ctx,
          phase: 'EDIT_SAVE_FAILED',
          error: { code: event.code, recoverable: event.recoverable ?? true },
        },
        event,
      );
    case 'DEVICE_ERROR':
      if (event.recoverable) {
        return withMeta(
          {
            ...ctx,
            phase: 'EDIT_SAVE_FAILED',
            error: { code: event.code, recoverable: true },
          },
          event,
        );
      }
      return withMeta(
        { ...ctx, state: 'ERRORED', error: { code: event.code, recoverable: false } },
        event,
      );
    case 'CMD_CANCEL':
      if (ctx.state === 'IDLE') return ctx;
      return withMeta({ ...ctx, state: 'CANCELLED' }, event);
    case 'DEVICE_AREA':
    case 'DEVICE_BATTERY':
    case 'DEVICE_CAPABILITIES':
    case 'DEVICE_DOCKED':
    case 'DEVICE_ESTOP':
    case 'DEVICE_LOW_BATTERY':
    case 'DEVICE_NOTICE':
    case 'DEVICE_PHASE':
    case 'DEVICE_UNDOCKED':
    case 'DEVICE_WORK_STATUS':
    case 'LINK_BLE_DOWN':
    case 'LINK_BLE_UP':
    case 'LINK_NET_LOST':
    case 'LINK_WS_DOWN':
    case 'LINK_WS_UP':
    case 'CMD_ADD_NEW_AREA':
    case 'CMD_DISMISS_NOTICE':
    case 'CMD_EXIT_MANUAL':
    case 'CMD_PAUSE':
    case 'CMD_RESUME':
    case 'CMD_RETURN_DOCK':
    case 'CMD_SWITCH_MANUAL':
    case 'CMD_START_COVERAGE':
    case 'TIMEOUT':
      return ctx;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function withMeta(ctx: MapEditContext, event: MapEditEvent): MapEditContext {
  return {
    ...ctx,
    lastSource: sourceFromEvent(event),
    lastSourceTs: 'ts' in event && typeof event.ts === 'number' ? event.ts : Date.now(),
  };
}

function sourceFromEvent(event: MapEditEvent): TaskSource {
  if (event.type.startsWith('CMD_')) return 'cmd';
  if (event.type === 'TIMEOUT') return 'timeout';
  if ('source' in event) return event.source;
  if (event.type.startsWith('LINK_WS')) return 'ws';
  if (event.type.startsWith('LINK_BLE')) return 'ble';
  return 'ws';
}

export type { TaskState as MapEditState };
