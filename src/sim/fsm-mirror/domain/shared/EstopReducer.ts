/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/domain/shared/EstopReducer.ts. DO NOT EDIT. !!!
// Source SHA-256: ba17a65fc9d597985ae4d1251f27da169189960989b38aec85e4c0caca8138da
// Synced at: 2026-05-30T08:44:44.301Z
import type { TaskContext, TaskEvent, TaskResumeTarget, TaskSource } from './TaskFSM';

const RESUMABLE_ESTOP_STATES = new Set(['WORKING', 'REMOTE_CONTROL', 'RECHARGING']);

/**
 * Orthogonal emergency-stop reducer fragment.
 *
 * It is intentionally generic so mapping / mowing / map-edit reducers can share
 * the same semantics: active estop freezes the current tuple in `resumeTo`,
 * hardware clear marks the state resettable, and `CMD_RESET` either resumes the
 * interrupted task or falls back to `IDLE`.
 */
export function applyEstopTransition<P extends string>(
  ctx: TaskContext<P>,
  event: TaskEvent<P>,
  now: number,
): TaskContext<P> | null {
  if (event.type === 'DEVICE_ESTOP') {
    if (event.active) return enterEstopped(ctx, event);
    if (ctx.state !== 'ESTOPPED') return ctx;
    return {
      ...ctx,
      error: { code: 'ESTOP_CLEARED', recoverable: true },
      lastSource: event.source,
      lastSourceTs: event.ts,
    };
  }

  if (event.type !== 'CMD_RESET' || ctx.state !== 'ESTOPPED') return null;
  if (ctx.error?.code !== 'ESTOP_CLEARED') return ctx;

  const target = ctx.resumeTo;
  const shouldResume = target !== null && RESUMABLE_ESTOP_STATES.has(target.state);
  return {
    ...ctx,
    state: shouldResume ? 'RESUMING' : 'IDLE',
    phase: shouldResume ? target.phase : null,
    mode: shouldResume && target?.state === 'REMOTE_CONTROL' ? 'remote' : 'auto',
    taskMode: shouldResume ? ctx.taskMode : null,
    resumeTo: shouldResume ? target : null,
    error: null,
    notices: shouldResume ? ctx.notices : [],
    lastSource: 'cmd',
    lastSourceTs: now,
  };
}

function enterEstopped<P extends string>(
  ctx: TaskContext<P>,
  event: Extract<TaskEvent<P>, { readonly type: 'DEVICE_ESTOP' }>,
): TaskContext<P> {
  const resumeTo: TaskResumeTarget<P> | null =
    ctx.state === 'ESTOPPED'
      ? ctx.resumeTo
      : ctx.resumeTo ?? { state: ctx.state, phase: ctx.phase };
  return {
    ...ctx,
    state: 'ESTOPPED',
    resumeTo,
    error: { code: 'ESTOP_ACTIVE', recoverable: true },
    lastSource: event.source,
    lastSourceTs: event.ts,
  };
}

export function sourceFromEstopEvent<P extends string>(event: TaskEvent<P>): TaskSource {
  if (event.type === 'DEVICE_ESTOP') return event.source;
  if (event.type === 'CMD_RESET') return 'cmd';
  return 'timeout';
}