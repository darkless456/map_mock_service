import type { VirtualRobot } from './virtualRobot';
import type { SimView } from './simFsmTypes';

export interface ExtendStatus {
  readonly legitimate_starting_point: 0 | 1;
  readonly legitimate_end_point: 0 | 1;
  readonly manual_closure_suggested: 0 | 1;
  readonly locator_status: number;
  readonly operation_status: number;
  readonly switch_remote_control: 0 | 1;
  readonly area_complete_map_build: 0 | 1;
  readonly blade_status: 0 | 1;
  /**
   * 建图完成等待窗口的起始时刻（ms epoch）；不在窗口里时为 `0`。
   * App 拿它当完成页倒计时的锚点（`countDownStartAt`），只在 `sub_status === 'expand_area'`
   * 的帧上有效。见 mower 仓 `pendingSignalsContract.waitExtendTimestampEventFromRaw`。
   */
  readonly wait_extend_timestamp: number;
  /**
   * 地图上传百分比 `0..100`。与 `wait_extend_timestamp` 同构的**帧门控**字段：
   * 只有 `sub_status === 'upload_map'` 的帧上有效，其余帧给 `0`。
   * [占位] 字段名与 mower 侧 `pendingSignalsContract` 的常量同步，机器端定稿后一起改。
   */
  readonly upload_map_progress: number;
  /** 上传三态：`0=none 1=上传中 2=成功 3=失败`。门控同上。 */
  readonly upload_map_status: number;
}

/**
 * mapping-v4-final-spec.md §2 defines the `extend_status` structure but not the trigger
 * semantics for all 8 fields (audit gap G1). Per the spec's own Appendix A autonomy rule
 * (values, not structure/channel, are the mock's call), only the two fields that gate
 * EDGE_START/EDGE_CLOSE — legitimate_starting_point/legitimate_end_point — are dynamically
 * derived from MappingTelemetry (see MappingTelemetry.syncWithPhase). The remaining fields
 * are conservative defaults with no upstream contract yet; revisit once the real device
 * semantics are confirmed.
 */
export function buildExtendStatus(robot: VirtualRobot): ExtendStatus {
  const isMapping = robot.activeDomain === 'mapping';
  const ctx = (isMapping ? robot.mapping : robot.mowing) as unknown as SimView<string>;
  return {
    legitimate_starting_point: isMapping && robot.legitimateStartingPoint ? 1 : 0,
    legitimate_end_point: isMapping && robot.legitimateEndPoint ? 1 : 0,
    manual_closure_suggested: 0,
    locator_status: ctx.error ? 3 : 1,
    operation_status: 0,
    switch_remote_control: ctx.capabilities?.canSwitchManual ? 1 : 0,
    // Derived from `lastNotifySubStatus` (the authoritative, always-current signal used for
    // `sub_status` itself) rather than raw FSM `phase`: the read-only FSM mirror does not
    // clear `phase` back out of `MAP_COMPLETING` on task completion, so a phase-only check
    // would keep reporting 1 after the task has already gone idle.
    area_complete_map_build: isMapping && robot.lastNotifySubStatus === 'expand_area' ? 1 : 0,
    blade_status: 0,
    // 与本类 auto-COMPLETE 用的那个 timer 同源（virtualRobotCore.armMapCompletingCountdown）。
    // 不在等待窗口里就是 0，对齐真机「字段时刻都在、无窗口时为 0」的行为。
    // 与 `area_complete_map_build` 同一个门：锚点只在 `expand_area` 这一档的帧上有效。
    // 真机的语义是「字段常在，无等待窗口时为 0」，App 侧 `toEpochMs(0) === null`
    // 会读成「倒计时已归零」，因此这里必须归 0 而不是留着上一轮的时刻。
    wait_extend_timestamp:
      isMapping && robot.lastNotifySubStatus === 'expand_area' ? robot.waitExtendTimestamp() : 0,
    // 上传两字段只在 `upload_map` 帧上有效——App 侧 `mapUploadEventFromRaw` 做的是同一道
    // 帧门控，非上传帧读到的值会被直接丢弃，这里给 0 保持「字段常在、无值时为 0」的真机语义。
    upload_map_progress:
      isMapping && robot.lastNotifySubStatus === 'upload_map'
        ? robot.mapUploadTelemetry().progress
        : 0,
    upload_map_status:
      isMapping && robot.lastNotifySubStatus === 'upload_map'
        ? robot.mapUploadTelemetry().status
        : 0,
  };
}
