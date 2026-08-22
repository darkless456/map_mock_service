import type { VirtualRobot, MappingTaskRecord, MowingTaskRecord, VirtualRobotSnapshot } from './virtualRobot';
import type { RatelStatusPushPayload } from './ratelStatusPush';
import type { SimTaskState, SimView } from './simFsmTypes';
import { buildExtendStatus } from './MappingProtocolSnapshot';
import { createId } from '../infra/ids';

export interface WsEnvelope<TData = Record<string, unknown>> {
  readonly cmd: string;
  readonly cmd_id: string;
  readonly version: number;
  readonly data: TData;
}

function batteryPayload(level: number, charging: boolean) {
  return {
    level,
    charging: charging ? 1 : -1,
    temperature: 30,
    cycles: 42,
  };
}

function signalPayload() {
  return {
    bluetooth: { connected: 1, rssi: -55 },
    wifi: { connected: 1, ssid: 'MockWiFi', rssi: -60, signal_strength: 'good' },
    cellular: { connected: -1, signal_strength: 'none' },
  };
}

function activeContext(snapshot: VirtualRobotSnapshot) {
  return snapshot.activeDomain === 'mowing' ? snapshot.mowing : snapshot.mapping;
}

/**
 * Coerces internal FSM work-status into the cloud WS enum
 * (`idle` / `mowing` / `charging` / `mapping` / `return_dock` / `error`), per
 * `ratel_backend_api.md` §2.2. `estop` → `error`; legacy `mapping_completed` is not a
 * cloud value → `idle` (completion surfaces as `sub_status: expand_area` then `idle`).
 * `return_dock`（回桩，docs §13）作为顶层 work_status 原样透传。
 */
function toCloudWorkStatus(rawWork: string): string {
  if (rawWork === 'estop') return 'error';
  if (rawWork === 'mapping_completed') return 'idle';
  return rawWork;
}

/** Derives `sub_status` from mock FSM when no prior NOTIFY was recorded. */
export function deriveSubStatus(robot: VirtualRobot): string {
  const snapshot = robot.snapshot();
  if (snapshot.activeDomain === 'mapping') {
    const ctx = snapshot.mapping;
    if (ctx.state === 'PREPARING') return 'precondition';
    if (ctx.state === 'UNDOCKING') return 'leave_dock';
    switch (ctx.phase) {
      case 'MAP_SCAN_BOUNDARY':
        return 'find_boundary';
      case 'MAP_FOLLOW_BOUNDARY':
      case 'MAP_FOLLOW_BOUNDARY_FAILED':
      case 'MAP_FOLLOW_BOUNDARY_MANUAL':
        return 'edge_mapping';
      case 'MAP_BOUNDARY_DONE':
        return 'map_edge_finish';
      // 建图完成等待窗口。固件的真实值是 `expand_area`（"等待用户决定是否再加一块草坪"），
      // 不是旧的 `map_completing`——后者 App 侧已降为 SKIP，Mock 若继续推它，App 永远
      // 进不了完成页。锚点 `extend_status.wait_extend_timestamp` 只在这一档的帧上有效。
      case 'MAP_COMPLETING':
        return 'expand_area';
      // 注意：上传段（`upload_map`）**不在这里**。fsm-mirror 的 MappingPhase 联合类型里
      // 没有 `MAP_UPLOADING`（镜像只覆盖设备自身建模的阶段），上传是 Mock 在 COMPLETE 之后
      // 用 `pushRatelStatus` 显式推的一段，`lastNotifySubStatus` 因此始终是权威值，
      // 不会掉进本函数的兜底分支。
      case 'returning':
        return 'return_dock';
      default:
        return 'none';
    }
  }
  if (snapshot.activeDomain === 'mowing') {
    const ctx = snapshot.mowing;
    if (ctx.state === 'PREPARING') return 'map_check';
    if (ctx.state === 'UNDOCKING') return 'leave_dock';
    if (ctx.phase === 'MOW_RUNNING') {
      return ctx.taskMode === 'MOW_EDGE' ? 'edge' : 'mowing';
    }
    if (ctx.phase === 'returning') return 'return_dock';
    // 回桩（RETURNING_DOCK）子阶段（docs §13）。
    switch (ctx.phase) {
      case 'RETURN_PRE_DOCK':
        return 'go_to_pre_dock_point';
      case 'RETURN_SEEK_CHARGER':
        return 'seek_charger_dock';
      case 'RETURN_ENTER_DOCK':
        return 'enter_dock';
      case 'RETURN_AT_DOCK':
        return 'at_dock';
      case 'RETURN_DOCK_FAILED':
        return 'failed';
      default:
        return 'none';
    }
  }
  return 'none';
}

/** Builds NOTIFY payload from robot snapshot (last notify or FSM-derived fallback). */
export function buildCurrentRatelStatusPayload(robot: VirtualRobot): RatelStatusPushPayload {
  const snapshot = robot.snapshot();
  const ctx = activeContext(snapshot);
  const rawWork = robot.lastNotifyWorkStatus ?? robot.workStatus();
  const workStatus = toCloudWorkStatus(rawWork);
  return {
    sn: snapshot.sn,
    work_status: workStatus,
    sub_status: robot.lastNotifySubStatus ?? deriveSubStatus(robot),
    battery_level: ctx.battery ?? 80,
  };
}

/** Cloud `NOTIFY_RATEL_STATUS` — primary driver for App FSM (`useWsDeviceListener`). */
export function buildNotifyRatelStatus(
  robot: VirtualRobot,
  payload: RatelStatusPushPayload,
): WsEnvelope<Record<string, unknown>> {
  const snapshot = robot.snapshot();
  const ctx = activeContext(snapshot) as SimView<string>;
  const capabilities = ctx.capabilities ?? {
    canSwitchManual: false,
    canSwitchAuto: false,
  };
  const workStatus = payload.work_status;
  const subStatus = payload.sub_status;
  const batteryLevel = payload.battery_level ?? ctx.battery ?? 80;
  const isEstop = (ctx.state as SimTaskState) === 'ESTOPPED';
  return {
    cmd: 'NOTIFY_RATEL_STATUS',
    cmd_id: createId(),
    version: 1,
    data: {
      sn: payload.sn,
      work_status: workStatus,
      sub_status: subStatus,
      sub_status_entered_at: robot.lastNotifySubStatusEnteredAt,
      work_msg: ctx.error?.code ?? '',
      battery_level: batteryLevel,
      battery: batteryPayload(batteryLevel, workStatus === 'charging'),
      signals: signalPayload(),
      state: ctx.state,
      phase: ctx.phase,
      capabilities: {
        can_switch_manual: capabilities.canSwitchManual,
        can_switch_auto: capabilities.canSwitchAuto,
        canSwitchManual: capabilities.canSwitchManual,
        canSwitchAuto: capabilities.canSwitchAuto,
      },
      can_switch_manual: capabilities.canSwitchManual,
      can_switch_auto: capabilities.canSwitchAuto,
      estop: { active: isEstop },
      notices: ctx.notices,
      error: ctx.error
        ? {
            code: ctx.error.code,
            subcode: ctx.error.kind ?? 'other',
            recoverable: ctx.error.recoverable,
          }
        : null,
      // mapping-v4-final-spec.md §2: real-time mapping state fields
      ...(workStatus === 'mapping' ? {
        extend_status: buildExtendStatus(robot),
        map_id: 'mock_map_001',
        mode: snapshot.mapping.mode ?? 'auto',
      } : {}),
    },
  };
}

export function buildMowStatus(task: MowingTaskRecord): WsEnvelope<Record<string, unknown>> {
  const payload = {
    sn: task.sn,
    task_id: task.task_id,
    task_status: task.status,
    task_type: task.task_type,
    task_message: task.task_message,
    task_error_code: task.task_error_code,
    mow_area: task.mow_area,
    mow_progress: task.mow_progress,
    estimated_time: task.estimated_time,
    timestamp: Math.floor(Date.now() / 1000),
    notify_timestamp: Date.now(),
  };
  return {
    cmd: 'NOTIFY_MOW_STATUS',
    cmd_id: createId(),
    version: 1,
    data: {
      ...payload,
      payload,
    },
  };
}

/**
 * WS `cmd: RATEL_MAPPING_TASK` — 建图任务级状态推送（建图任务 API 重构方案 §6.2 / APP 接口文档
 * 「WS建图任务状态推送」）。与 `NOTIFY_MOW_STATUS` 同构：仅承担任务级确认/断线对齐职责，
 * 不携带相位信息，相位推进仍完全由 `NOTIFY_RATEL_STATUS` 驱动。
 */
export function buildMappingTaskStatus(task: MappingTaskRecord): WsEnvelope<Record<string, unknown>> {
  return {
    cmd: 'RATEL_MAPPING_TASK',
    cmd_id: createId(),
    version: 1,
    data: {
      sn: task.sn,
      payload: {
        task_id: task.task_id,
        task_status: task.status,
        map_id: task.map_id,
        task_message: task.task_message,
        task_error_code: task.task_error_code,
      },
    },
  };
}

/** Cloud `cmd: RECHARGE` — 回充任务过程推送（驱动 App 回充槽按钮，docs §12 / §13）。 */
export function buildRecharge(payload: {
  readonly sn: string;
  readonly task_id: string;
  readonly task_status: string;
  readonly remark?: string;
}): WsEnvelope<Record<string, unknown>> {
  return {
    cmd: 'RECHARGE',
    cmd_id: createId(),
    version: 1,
    data: {
      sn: payload.sn,
      task_id: payload.task_id,
      task_status: payload.task_status,
      remark: payload.remark ?? '',
    },
  };
}

export interface RobotPose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export function buildRobotLocation(
  sn: string,
  pose: RobotPose,
  options?: { readonly mapId?: string },
): WsEnvelope<Record<string, unknown>> {
  const now = Date.now();
  return {
    cmd: 'ROBOT_LOCATION',
    cmd_id: createId(),
    version: 1,
    data: {
      sn,
      mac: 'D2:9C:35:EF:D1:04',
      map_id: options?.mapId ?? 'mock_map_001',
      x: pose.x,
      y: pose.y,
      yaw: pose.angle,
      angle: pose.angle,
      timestamp: Math.floor(now / 1000),
      notify_time: now,
    },
  };
}

/** On FSM change: NOTIFY_RATEL_STATUS (+ mow when active). */
export function changedPushes(robot: VirtualRobot, snapshot?: VirtualRobotSnapshot): WsEnvelope[] {
  const pushes: WsEnvelope[] = [buildNotifyRatelStatus(robot, buildCurrentRatelStatusPayload(robot))];
  const activeTask = snapshot?.activeTask ?? robot.activeTask();
  if (activeTask) pushes.push(buildMowStatus(activeTask));
  const activeMappingTask = snapshot?.activeMappingTask ?? robot.activeMappingTask();
  if (activeMappingTask) pushes.push(buildMappingTaskStatus(activeMappingTask));
  return pushes;
}
