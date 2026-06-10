/**
 * Simulator-only extensions over the frozen, auto-generated `fsm-mirror` types.
 *
 * The `fsm-mirror/**` files are synced verbatim from the mower app and must not
 * be edited. The simulator augments them with a few concepts the gateway FSM
 * does not model (capabilities, notices, an estop state, an error `kind`, and
 * a handful of simulator-intent events). These types centralise those
 * extensions so the rest of `src/sim` stays type-checked under `tsc --noEmit`.
 */
import type { TaskContext, TaskError, TaskState } from './fsm-mirror/domain/shared/TaskFSM';

export interface SimCapabilities {
  readonly canSwitchManual: boolean;
  readonly canSwitchAuto: boolean;
}

/** Notice surfaced in `NOTIFY_RATEL_STATUS.data.notices` (FSM has no notice model). */
export interface SimTaskNotice {
  readonly code: string;
  readonly level?: string;
  readonly message?: string;
}

/** FSM `TaskError` plus the simulator's optional `kind` (used as NOTIFY `subcode`). */
export type SimTaskError = TaskError & { readonly kind?: string };

/** Generated `TaskState` set plus the simulator-only `ESTOPPED`. */
export type SimTaskState = TaskState | 'ESTOPPED';

/** `TaskContext` carrying the simulator-only fields injected by `withSimulatorDefaults`. */
export type SimView<P extends string> = Omit<TaskContext<P>, 'error'> & {
  readonly capabilities: SimCapabilities;
  readonly notices: readonly SimTaskNotice[];
  readonly error: SimTaskError | null;
};

/**
 * Simulator-intent events dispatched via {@link VirtualRobot}. The generated
 * reducers don't declare these, so they fall through to the reducer's `default`
 * branch (no-op) — they exist only to keep the call sites type-checked.
 */
export type SimOnlyEvent =
  | { readonly type: 'CMD_SAVE' }
  | { readonly type: 'CMD_FINISH_AND_RETURN_DOCK' }
  | { readonly type: 'DEVICE_REPORT_FINISHED' };
