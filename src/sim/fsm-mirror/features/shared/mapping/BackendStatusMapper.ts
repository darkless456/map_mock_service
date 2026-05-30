/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendStatusMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: 402b65536a4f93eccfbd2d0eebcfdad7d5a279e4e8b27278a8736b37bc8eb668
// Synced at: 2026-05-30T08:44:44.301Z
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
  readonly prev: BackendStatus | null;
  readonly curr: BackendStatus;
  readonly ctx: TaskContext<P>;
  readonly raw?: Record<string, unknown>;
}

export type MapperOutput<P extends string> = ReadonlyArray<BackendMapperEvent<P>>;

export interface EdgeHandler<P extends string> {
  readonly guard?: (ctx: TaskContext<P>) => boolean;
  readonly events: (ctx: TaskContext<P>, input: MapperInput<P>) => MapperOutput<P>;
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
    return stable && matches(stable, input.ctx) ? stable.events(input.ctx, input) : [];
  }

  const handlers = lookupHandlers(input, registry);
  for (const handler of handlers) {
    if (matches(handler, input.ctx)) {
      return handler.events(input.ctx, input);
    }
  }

  return registry.fallback?.(input) ?? fallbackUnknown(input.curr);
}

function lookupHandlers<P extends string>(
  input: MapperInput<P>,
  registry: BackendStatusRegistry<P>,
): readonly EdgeHandler<P>[] {
  const key = edgeKey(input.prev, input.curr);
  const candidates = [
    key,
    `${input.prev ?? 'null'}->*`,
    `*->${input.curr}`,
    String(input.curr),
  ];
  for (const candidate of candidates) {
    const handlers = toHandlers(registry.edges[candidate]);
    if (handlers.length > 0) return handlers;
  }
  return [];
}

export function edgeKey(prev: BackendStatus | null, curr: BackendStatus): BackendEdge {
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
