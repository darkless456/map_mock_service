/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendPhaseMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: 5526b378675ba6cafb7d0efc2ce580021f7c43ac46b73e171a9cf7d21085ec67
// Synced at: 2026-07-14T11:20:49.179Z
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
  // "等待建图结束"：后端已确认新的子状态字符串为 `map_completing`，取代旧的
  // `bow_cover`/`exit_mapping` 二段式（弓字覆盖中 / 退出建图）——后端不再下发这两个
  // 旧值，固件跳过可见的覆盖阶段直接一次性推送 `map_completing`。旧值不做兼容映射，
  // 若真机仍推送（理论上不会），按未列出取值处理，落 `unknown` 安全 no-op（见
  // EventAdapter.ts 的 pushPhaseMapResult），不会崩溃，只是暂不推进。
  map_completing: toPhase('MAP_COMPLETING'),
  // 退桩失败：后端真实值待确认，暂用假定占位值 `undocking_failed` 解除阻塞
  // （2026-07-13 决策，非固件文档确认值）。真实值定稿后只需改这一行。
  undocking_failed: toPhase('MAP_UNDOCKING_FAILED'),
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
    // COVERAGE 阶段的 legacy 别名（newAreaChecking/newArea/zigzagging/zigzagged）
    // 已随本次重构整体删除，不再映射——不存在对应的前端 phase，落 unknown 安全 no-op。
    default:
      return phase;
  }
}

/** @internal Reset throttle state between tests. */
export function resetBackendPhaseMapperForTests(): void {
  resetUnknownBackendSubStatusLogForTests();
}
