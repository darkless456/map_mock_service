/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendPhaseMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: 23dad9b2211e435b014d5aa8d9257637d1cfe97cc3163a5baaceb64c102c8599
// Synced at: 2026-06-10T07:46:58.562Z
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

/**
 * 手摇建图「已寻到边」假定 sub_status（占位值，待后端最终确认后替换）。
 * 设备完成寻边、即将交给用户手摇沿边时上报此状态；FSM 据此在手摇模式下
 * 把控制权移交用户（WORKING → REMOTE_CONTROL，见 MappingSession）。
 * 调试期可用 mock service 模拟下发该 sub_status。
 */
export const ASSUMED_BOUNDARY_FOUND_SUB_STATUS = 'boundary_found';

const MAPPING_SUB: Readonly<Record<string, PhaseRule>> = {
  precondition: SKIP,
  complete: SKIP,
  leave_dock: UNDOCK,
  find_boundary: toPhase('MAP_SCAN_BOUNDARY'),
  [ASSUMED_BOUNDARY_FOUND_SUB_STATUS]: toPhase('MAP_BOUNDARY_FOUND'),
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

/** @internal Reset throttle state between tests. */
export function resetBackendPhaseMapperForTests(): void {
  resetUnknownBackendSubStatusLogForTests();
}
