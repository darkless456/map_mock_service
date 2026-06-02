/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendStatusMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: 7b275f9b7e7e14733986bc3ed5be0b9d4231888c84955897e724167cc39e3f87
// Synced at: 2026-06-02T09:43:38.803Z
import type {
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
} from '../../../domain/shared/TaskFSM';

export type BackendStatus = RobotWorkStatus | string;
export type BackendEdge = `${RobotWorkStatus | 'null' | string}->${BackendStatus}`;

export interface UnknownBackendStatusEvent {
  readonly type: 'LOG_UNKNOWN_BACKEND_STATUS';
  readonly status: string;
}

export type BackendMapperEvent<P extends string> =
  | TaskEvent<P>
  | UnknownBackendStatusEvent;

export interface MapperInput<P extends string> {
  readonly prev: RobotWorkStatus | null;
  readonly curr: BackendStatus;
  readonly ctx: TaskContext<P>;
}

export type MapperOutput<P extends string> = ReadonlyArray<BackendMapperEvent<P>>;

export interface EdgeHandler<P extends string> {
  readonly guard?: (ctx: TaskContext<P>) => boolean;
  readonly events: (ctx: TaskContext<P>) => MapperOutput<P>;
}

export interface BackendStatusRegistry<P extends string> {
  readonly edges: Readonly<Record<string, EdgeHandler<P> | readonly EdgeHandler<P>[]>>;
  readonly stable?: Partial<Record<RobotWorkStatus, EdgeHandler<P>>>;
  readonly fallback?: (input: MapperInput<P>) => MapperOutput<P>;
}

export function mapBackendStatus<P extends string>(
  input: MapperInput<P>,
  registry: BackendStatusRegistry<P>,
): MapperOutput<P> {
  if (input.prev === input.curr) {
    const stable = isRobotWorkStatus(input.curr) ? registry.stable?.[input.curr] : undefined;
    return stable && matches(stable, input.ctx) ? stable.events(input.ctx) : [];
  }

  const key = edgeKey(input.prev, input.curr);
  const handlers = toHandlers(registry.edges[key]);
  for (const handler of handlers) {
    if (matches(handler, input.ctx)) {
      return handler.events(input.ctx);
    }
  }

  return registry.fallback?.(input) ?? fallbackUnknown(input.curr);
}

export function edgeKey(prev: RobotWorkStatus | null, curr: BackendStatus): BackendEdge {
  return `${prev ?? 'null'}->${curr}`;
}

function toHandlers<P extends string>(
  value: EdgeHandler<P> | readonly EdgeHandler<P>[] | undefined,
): readonly EdgeHandler<P>[] {
  if (!value) return [];
  return Array.isArray(value)
    ? [...value]
    : [value as EdgeHandler<P>];
}

function matches<P extends string>(handler: EdgeHandler<P>, ctx: TaskContext<P>): boolean {
  return handler.guard?.(ctx) ?? true;
}

function fallbackUnknown<P extends string>(status: BackendStatus): MapperOutput<P> {
  if (isRobotWorkStatus(status)) return [];
  return [{ type: 'LOG_UNKNOWN_BACKEND_STATUS', status }];
}

function isRobotWorkStatus(value: BackendStatus): value is RobotWorkStatus {
  return (
    value === 'idle' ||
    value === 'mowing' ||
    value === 'charging' ||
    value === 'mapping' ||
    value === 'mapping_completed' ||
    value === 'error'
  );
}
