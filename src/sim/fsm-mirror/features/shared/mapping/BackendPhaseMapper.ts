/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/BackendPhaseMapper.ts. DO NOT EDIT. !!!
// Source SHA-256: 8fb2904caab19ee62c3bff030edf7c004b8fbdd6ce75520ffd4ec9158879838e
// Synced at: 2026-08-15T09:29:26.009Z
import type { RobotWorkStatus } from '../../../domain/shared/TaskFSM';
import { resetUnknownBackendSubStatusLogForTests } from './unknownBackendSubStatus';

/**
 * Result of mapping robot `sub_status` (or legacy step) to FSM inputs.
 *
 * 刻意**没有**「终结会话」这一档：`sub_status` 只推进 phase，会话存续与否一律由
 * `work_status` 决定（见 SUB_STATUS_TABLE 上方的全表级约定）。
 */
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
  // `map_completing` 曾映射到 `MAP_COMPLETING`（"等待建图结束"），现已确认固件不再
  // 下发该子状态，这里显式降为 SKIP：整帧不推进 phase。
  //
  // **不要改回 toPhase，也不要整行删掉**：
  // - 改回 toPhase 会给完成等待页开出第二个入口，而该入口拿不到 `expand_area` 帧上的
  //   `wait_extend_timestamp` 锚点，按归零规则会让页面一挂载就自动发完成请求
  //   （见 MappingSession 的 `waitExtendStartTs`）。
  // - 整行删掉会落进 `unknown` 分支，`logUnknownBackendSubStatus` 每帧一条 warn 刷屏。
  //
  // 现在 `MAP_COMPLETING` 的唯一入口是下面的 `expand_area`：phase 与倒计时锚点一一对应。
  map_completing: SKIP,
  upload_map: toPhase('MAP_UPLOADING'),
  expand_area: toPhase('MAP_COMPLETING'),
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

/** 回桩（`work_status: return_dock`）子状态 → 回桩 `MowingPhase`（docs §13）。 */
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
 *
 * ## 全表级约定：`sub_status` 永不终结会话
 *
 * 本表任何一格都**不得**产出「会话结束」语义——`sub_status` 只推进会话内 phase，
 * 会话存续与否一律由 `work_status` 决定。`complete` 因此在五行里统一是 `SKIP`：
 * 它只是收尾信号，真正的收口是随后的 `work_status: idle`。
 *
 * 这条约定曾被 `MAPPING_SUB.complete` 违反（映射成合成 `CMD_CONFIRM`）：2026-07-31
 * 它抢先把会话打成 COMPLETED，1ms 后到达的权威 `idle` 撞上终态被吞，UI 卡死在空壳
 * 建图页。约定现由 `BackendPhaseMapper.spec.ts` 的不变量用例在 CI 上强制。
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
 * Maps NOTIFY_RATEL_STATUS `sub_status` (+ `work_status` context) to phase, completion,
 * or undock events.
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
