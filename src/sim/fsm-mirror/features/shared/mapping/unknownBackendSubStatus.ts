/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/unknownBackendSubStatus.ts. DO NOT EDIT. !!!
// Source SHA-256: 251d3b57c22bb1991e87e84feff05a9a1e4037b2665ffff2cb07b2ed42b41c10
// Synced at: 2026-06-02T09:43:38.803Z
import type { LoggerLike } from '../../../domain/shared/LoggerLike';
import { getModuleLogger } from '../../../infra/bridges/log';
import { LogCategory } from '../../../infra/bridges/log/categories';
import type { UnknownBackendStatusEvent } from './BackendStatusMapper';

/** Emitted when robot `sub_status` is not in `BackendPhaseMapper` tables. */
export interface UnknownBackendSubStatusEvent {
  readonly type: 'LOG_UNKNOWN_BACKEND_SUB_STATUS';
  readonly subStatus: string;
  readonly workStatus: string;
}

const UNKNOWN_LOG_THROTTLE_MS = 5_000;
const unknownSubStatusLogAt = new Map<string, number>();

/**
 * Throttled warn for unmapped `sub_status` (category `ws.device.phase`).
 * Does not advance FSM — callers must not synthesize `*_FAILED` phases.
 */
export function logUnknownBackendSubStatus(
  logger: LoggerLike | undefined,
  event: UnknownBackendSubStatusEvent,
): void {
  const key = `${event.workStatus}:${event.subStatus}`;
  const now = Date.now();
  const last = unknownSubStatusLogAt.get(key) ?? 0;
  if (now - last < UNKNOWN_LOG_THROTTLE_MS) {
    return;
  }
  unknownSubStatusLogAt.set(key, now);

  try {
    const log = logger ?? getModuleLogger();
    log.warn(LogCategory.WS_DEVICE_PHASE, 'unknown_backend_sub_status', {
      workStatus: event.workStatus,
      subStatus: event.subStatus,
    });
  } catch {
    // Logger not mounted in unit tests.
  }
}

/** Throttled warn for unmapped `work_status` edge (registry fallback). */
export function logUnknownBackendWorkStatus(
  logger: LoggerLike | undefined,
  event: UnknownBackendStatusEvent,
): void {
  try {
    const log = logger ?? getModuleLogger();
    log.warn(LogCategory.WS_DEVICE_PHASE, 'unknown_backend_work_status', {
      status: event.status,
    });
  } catch {
    // Logger not mounted in unit tests.
  }
}

/** @internal */
export function resetUnknownBackendSubStatusLogForTests(): void {
  unknownSubStatusLogAt.clear();
}
