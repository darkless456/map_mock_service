/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendPhaseMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: 28e8deaaa0b4fc90f1bf11829ac7f95ef2441cd5f39a065d6922099d8dd56058
// Synced at: 2026-06-11T13:20:40.103Z
import type { RobotWorkStatus } from '../../../domain/shared/TaskFSM';
import { resetUnknownBackendSubStatusLogForTests } from './unknownBackendSubStatus';

/** Result of mapping robot `sub_status` (or legacy step) to FSM inputs. */
export type BackendPhaseMapResult =
  | { readonly kind: 'undocked' }
  | { readonly kind: 'phase'; readonly phase: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'unknown'; readonly subStatus: string };

/** Table cell: every mapped `sub_status` resolves to one of these (unknown = fallback). */
type PhaseRule = Exclude<BackendPhaseMapResult, { kind: 'unknown' }>;

export interface MapBackendSubStatusInput {
  readonly workStatus: RobotWorkStatus | string;
  readonly subStatus: string;
}

const SKIP: PhaseRule = { kind: 'skip' };
const UNDOCK: PhaseRule = { kind: 'undocked' };
const toPhase = (phase: string): PhaseRule => ({ kind: 'phase', phase });

const MAPPING_SUB: Readonly<Record<string, PhaseRule>> = {
  precondition: SKIP,
  complete: SKIP,
  leave_dock: UNDOCK,
  find_boundary: toPhase('MAP_SCAN_BOUNDARY'),
  edge_mapping: toPhase('MAP_FOLLOW_BOUNDARY'),
  map_edge_finish: toPhase('MAP_BOUNDARY_DONE'),
  bow_cover: toPhase('MAP_COVERAGE_RUN'),
  exit_mapping: toPhase('MAP_COVERAGE_DONE'),
  return_dock: toPhase('returning'),
};

const MOWING_SUB: Readonly<Record<string, PhaseRule>> = {
  map_check: SKIP,
  complete: SKIP,
  leave_dock: UNDOCK,
  mowing: toPhase('MOW_RUNNING'),
  edge: toPhase('MOW_RUNNING'),
  return_dock: toPhase('returning'),
};

/**
 * 回桩（`work_status: return_dock`）子状态 → 回桩 `MowingPhase`（docs §13）。
 * `complete` 视为收尾信号（skip，由后续 `work_status: idle` 收口完成）。
 */
const RETURN_DOCK_SUB: Readonly<Record<string, PhaseRule>> = {
  go_to_pre_dock_point: toPhase('RETURN_PRE_DOCK'),
  seek_charger_dock: toPhase('RETURN_SEEK_CHARGER'),
  enter_dock: toPhase('RETURN_ENTER_DOCK'),
  at_dock: toPhase('RETURN_AT_DOCK'),
  failed: toPhase('RETURN_DOCK_FAILED'),
  complete: SKIP,
};

const CHARGING_SUB: Readonly<Record<string, PhaseRule>> = {
  precondition: SKIP,
  complete: SKIP,
  off_dock: SKIP,
  battery_full: toPhase('charged'),
};

const IDLE_SUB: Readonly<Record<string, PhaseRule>> = {
  precondition: SKIP,
  complete: SKIP,
  off_dock: SKIP,
  battery_full: SKIP,
};

/**
 * 声明式 `sub_status → phase` 映射表（SSOT）。
 * 行 = `work_status`，列 = `sub_status`；未列出的取值一律降级为 `unknown`。
 * 新增 / 改名 `sub_status` 只改本表一行，便于与后端 / Excel 逐条对照评审。
 * 对照协议见 `build-docs/backend-status-mapper-update.md` §5。
 */
export const SUB_STATUS_TABLE: Readonly<Record<string, Readonly<Record<string, PhaseRule>>>> = {
  mapping: MAPPING_SUB,
  mapping_completed: MAPPING_SUB,
  mowing: MOWING_SUB,
  return_dock: RETURN_DOCK_SUB,
  charging: CHARGING_SUB,
  idle: IDLE_SUB,
};

/**
 * Maps NOTIFY_RATEL_STATUS `sub_status` (+ `work_status` context) to phase / undock events.
 * Cloud sentinel `none` / empty string → `skip`. Unmapped values → `unknown` (callers must
 * NOT synthesize `*_FAILED` phases).
 */
export function mapBackendSubStatus(input: MapBackendSubStatusInput): BackendPhaseMapResult {
  const sub = input.subStatus.trim();
  if (sub.length === 0 || sub === 'none') {
    return { kind: 'skip' };
  }
  const rule = SUB_STATUS_TABLE[String(input.workStatus)]?.[sub];
  return rule ?? { kind: 'unknown', subStatus: sub };
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
      return 'MAP_FOLLOW_BOUNDARY';
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

/** @internal Reset throttle state between tests. */
export function resetBackendPhaseMapperForTests(): void {
  resetUnknownBackendSubStatusLogForTests();
}
