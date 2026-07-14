/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/unknownBackendSubStatus.ts. DO NOT EDIT. !!!
// Source SHA-256: 8077a3279ae96f5cfb619574c00baaa618b090d7833d6e5677eb007b3331f140
// Synced at: 2026-07-14T11:20:49.179Z
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

/**
 * Warn for unmapped `sub_status` (category `ws.device.phase`).
 * Does not advance FSM — callers must not synthesize `*_FAILED` phases.
 */
export function logUnknownBackendSubStatus(
  logger: LoggerLike | undefined,
  event: UnknownBackendSubStatusEvent,
): void {
  try {
    const log = logger ?? getModuleLogger();
    log.warn(LogCategory.WS_DEVICE_PHASE, 'unknown_backend_sub_status', {
      workStatus: event.workStatus,
      subStatus: event.subStatus,
      rawMessage: JSON.stringify(event),
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
      rawMessage: JSON.stringify(event),
    });
  } catch {
    // Logger not mounted in unit tests.
  }
}

/** @internal — 保留供单测兼容，节流已移除 */
export function resetUnknownBackendSubStatusLogForTests(): void {
  /* no-op */
}
