/* eslint-disable */
// @ts-nocheck
// !!! AUTO-GENERATED FROM mower/src/features/shared/mapping/workStatus.ts. DO NOT EDIT. !!!
// Source SHA-256: d1d6ea1b3fe35a9d29020895704c1aa48440b273544d86fb99e9f7263b6a7118
// Synced at: 2026-07-13T03:46:38.153Z
/**
 * `work_status` 单一事实源（SSOT）。
 *
 * 机器人 `NOTIFY_RATEL_STATUS.data.work_status` 的合法取值只在此声明一次，
 * 其余模块（`EventAdapter` / `BackendStatusMapper` / domain hooks）一律 import，
 * 杜绝"合法集合"被复制到多处导致改一处漏一处。
 *
 * - 云端权威枚举：`idle | mowing | charging | mapping | return_dock | emergency_stop | error`（7 值）。
 * - 遗留扩展：`mapping_completed`（仅 BLE / 本地 `running_status`，云端不推送）。
 *
 * `return_dock`（回桩）：割草「回充 / 结束并回桩」结束任务后由设备上报的顶层 work_status，
 * 自带 `sub_status` 子流程（见 `BackendPhaseMapper` 与 docs §13）。
 *
 * `emergency_stop`（急停）是**协议输入态**：桥接层会把 `work_status` 边沿归一为
 * `DEVICE_ESTOP{active:true|false}`，真正驱动 FSM `ESTOPPED` 的是任务事件而非普通
 * `DEVICE_WORK_STATUS`。
 *
 * 不要与首页 `RatelRunState` / BLE `running_status`（含 `returning_charge` 等更多值）混用。
 */

import type { RobotWorkStatus } from '../../../domain/shared/TaskFSM';

/** 云端 `NOTIFY_RATEL_STATUS.work_status` 权威 7 值。 */
export const CLOUD_WORK_STATUSES = [
  'idle',
  'mowing',
  'charging',
  'mapping',
  'return_dock',
  'emergency_stop',
  'error',
] as const;

/** App / BLE 遗留主状态，云端 WS 不推送。 */
export const LEGACY_WORK_STATUSES = ['mapping_completed'] as const;

/** 全部合法 `work_status`（云端 7 值 + 遗留）。 */
export const ROBOT_WORK_STATUSES = [
  ...CLOUD_WORK_STATUSES,
  ...LEGACY_WORK_STATUSES,
] as const;

export type CloudWorkStatus = (typeof CLOUD_WORK_STATUSES)[number];

// 编译期保证 SSOT 运行时集合与 domain `RobotWorkStatus` 类型双向一致：
// 任一侧增减取值而未同步，下面两行会立即报错。
type AssertExtends<A extends B, B> = A extends B ? true : never;
type _SsotIsSubsetOfDomain = AssertExtends<(typeof ROBOT_WORK_STATUSES)[number], RobotWorkStatus>;
type _DomainIsSubsetOfSsot = AssertExtends<RobotWorkStatus, (typeof ROBOT_WORK_STATUSES)[number]>;

const CLOUD_SET: ReadonlySet<string> = new Set(CLOUD_WORK_STATUSES);
const ROBOT_SET: ReadonlySet<string> = new Set(ROBOT_WORK_STATUSES);

/** 是否为云端权威 7 值（`mapping_completed` 返回 false）。 */
export function isCloudWorkStatus(value: string): value is CloudWorkStatus {
  return CLOUD_SET.has(value);
}

/** 是否为合法 `work_status`（云端 7 值 + `mapping_completed`）。 */
export function isRobotWorkStatus(value: string): value is RobotWorkStatus {
  return ROBOT_SET.has(value);
}
