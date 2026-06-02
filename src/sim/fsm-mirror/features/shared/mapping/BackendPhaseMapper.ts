/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendPhaseMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: ae82ee5960db0c6be73c8969afcaa45364d4e3e233f6f32349b98faffa3a65d9
// Synced at: 2026-06-02T09:43:38.803Z
import type { RobotWorkStatus } from '../../../domain/shared/TaskFSM';
import { resetUnknownBackendSubStatusLogForTests } from './unknownBackendSubStatus';

/** Result of mapping robot `sub_status` (or legacy step) to FSM inputs. */
export type BackendPhaseMapResult =
  | { readonly kind: 'undocked' }
  | { readonly kind: 'phase'; readonly phase: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'unknown'; readonly subStatus: string };

export interface MapBackendSubStatusInput {
  readonly workStatus: RobotWorkStatus | string;
  readonly subStatus: string;
}

/**
 * Maps NOTIFY_RATEL_STATUS `sub_status` (+ `work_status` context) to phase / undock events.
 * See `build-docs/backend-status-mapper-update.md` §5.
 */
export function mapBackendSubStatus(input: MapBackendSubStatusInput): BackendPhaseMapResult {
  const sub = input.subStatus.trim();
  if (sub.length === 0 || sub === 'none') {
    return { kind: 'skip' };
  }

  const work = input.workStatus;

  if (work === 'mapping' || work === 'mapping_completed') {
    return mapMappingSubStatus(sub);
  }
  if (work === 'mowing') {
    return mapMowingSubStatus(sub);
  }
  if (work === 'charging' || work === 'idle') {
    return mapIdleChargingSubStatus(sub, work);
  }

  return mapUnknownSubStatus(sub, work);
}

/**
 * Legacy BLE / HTTP `step` aliases → generalized phase or undock sentinel.
 */
export function normalizeLegacyPhase(phase: string): string {
  switch (phase) {
    case 'leaving':
      return 'DEVICE_UNDOCKED';
    case 'scanning':
      return 'MAP_SCAN_BOUNDARY';
    case 'scanningError':
    case 'hasBorderError':
      return 'MAP_SCAN_BOUNDARY_FAILED';
    case 'hasBorder':
      return 'MAP_BOUNDARY_FOUND';
    case 'fullBorder':
      return 'MAP_BOUNDARY_DONE';
    case 'newAreaChecking':
      return 'MAP_COVERAGE_PROBE';
    case 'newArea':
      return 'MAP_COVERAGE_NEW_AREA';
    case 'zigzagging':
      return 'MAP_COVERAGE_RUN';
    case 'zigzagged':
      return 'MAP_COVERAGE_DONE';
    default:
      return phase;
  }
}

function mapMappingSubStatus(sub: string): BackendPhaseMapResult {
  switch (sub) {
    case 'precondition':
    case 'complete':
      return { kind: 'skip' };
    case 'leave_dock':
      return { kind: 'undocked' };
    case 'find_boundary':
      return { kind: 'phase', phase: 'MAP_SCAN_BOUNDARY' };
    case 'edge_mapping':
      return { kind: 'phase', phase: 'MAP_FOLLOW_BOUNDARY' };
    case 'map_edge_finish':
      return { kind: 'phase', phase: 'MAP_BOUNDARY_DONE' };
    case 'bow_cover':
      return { kind: 'phase', phase: 'MAP_COVERAGE_RUN' };
    case 'exit_mapping':
      return { kind: 'phase', phase: 'MAP_COVERAGE_DONE' };
    case 'return_dock':
      return { kind: 'phase', phase: 'returning' };
    default:
      return mapUnknownSubStatus(sub, 'mapping');
  }
}

function mapMowingSubStatus(sub: string): BackendPhaseMapResult {
  switch (sub) {
    case 'map_check':
    case 'complete':
      return { kind: 'skip' };
    case 'leave_dock':
      return { kind: 'undocked' };
    case 'mowing':
    case 'edge':
      return { kind: 'phase', phase: 'MOW_RUNNING' };
    case 'return_dock':
      return { kind: 'phase', phase: 'returning' };
    default:
      return mapUnknownSubStatus(sub, 'mowing');
  }
}

function mapIdleChargingSubStatus(
  sub: string,
  work: 'idle' | 'charging',
): BackendPhaseMapResult {
  switch (sub) {
    case 'none':
    case 'off_dock':
    case 'precondition':
    case 'complete':
      return { kind: 'skip' };
    case 'battery_full':
      return work === 'charging'
        ? { kind: 'phase', phase: 'charged' }
        : { kind: 'skip' };
    default:
      return mapUnknownSubStatus(sub, work);
  }
}

function mapUnknownSubStatus(sub: string, _workStatus: string): BackendPhaseMapResult {
  return { kind: 'unknown', subStatus: sub };
}

/** @internal Reset throttle state between tests. */
export function resetBackendPhaseMapperForTests(): void {
  resetUnknownBackendSubStatusLogForTests();
}
