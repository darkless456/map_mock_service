import type { VirtualRobot, MowingTaskRecord, VirtualRobotSnapshot } from './virtualRobot';
import type { RatelStatusPushPayload } from './ratelStatusPush';
import { createId } from '../shared/ids';

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
    cellular: { connected: 0, signal_strength: 'weak' },
  };
}

/** Cloud `NOTIFY_RATEL_STATUS` — primary driver for App FSM (`useWsDeviceListener`). */
export function buildNotifyRatelStatus(
  robot: VirtualRobot,
  payload: RatelStatusPushPayload,
): WsEnvelope<Record<string, unknown>> {
  const snapshot = robot.snapshot();
  const ctx = snapshot.mapping;
  const workStatus = payload.work_status;
  const subStatus = payload.sub_status;
  const batteryLevel = payload.battery_level ?? ctx.battery ?? 80;
  return {
    cmd: 'NOTIFY_RATEL_STATUS',
    cmd_id: createId(),
    version: 1,
    data: {
      sn: payload.sn,
      work_status: workStatus,
      sub_status: subStatus,
      work_msg: '',
      battery_level: batteryLevel,
      battery: batteryPayload(batteryLevel, workStatus === 'charging'),
      signals: signalPayload(),
      state: ctx.state,
      phase: ctx.phase,
    },
  };
}

/** Legacy/auxiliary status frame; includes `sub_status` when known. */
export function buildRobotStatus(robot: VirtualRobot): WsEnvelope<Record<string, unknown>> {
  const snapshot = robot.snapshot();
  const ctx = snapshot.activeDomain === 'mowing' ? snapshot.mowing : snapshot.mapping;
  const capabilities = (ctx as { capabilities?: { canSwitchManual: boolean; canSwitchAuto: boolean } }).capabilities ?? {
    canSwitchManual: false,
    canSwitchAuto: false,
  };
  const workStatus = robot.lastNotifyWorkStatus ?? robot.workStatus();
  const subStatus = robot.lastNotifySubStatus ?? 'none';
  const isEstop = ctx.state === 'ESTOPPED' || workStatus === 'estop';
  return {
    cmd: 'ROBOT_STATUS',
    cmd_id: createId(),
    version: 1,
    data: {
      sn: snapshot.sn,
      work_status: isEstop ? 'estop' : workStatus,
      sub_status: subStatus,
      work_msg: ctx.error?.code ?? '',
      battery: batteryPayload(ctx.battery || 80, workStatus === 'charging'),
      signals: signalPayload(),
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
      state: ctx.state,
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

export interface RobotPose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export function buildRobotLocation(sn: string, pose: RobotPose): WsEnvelope<Record<string, unknown>> {
  const now = Date.now();
  return {
    cmd: 'ROBOT_LOCATION',
    cmd_id: createId(),
    version: 1,
    data: {
      sn,
      mac: 'D2:9C:35:EF:D1:04',
      map_id: 'mock_map_001',
      x: pose.x,
      y: pose.y,
      yaw: pose.angle,
      angle: pose.angle,
      timestamp: Math.floor(now / 1000),
      notify_time: now,
    },
  };
}

/** On FSM change: ROBOT_STATUS (+ mow). NOTIFY_RATEL_STATUS is sent via `ratelStatus` event. */
export function changedPushes(robot: VirtualRobot, snapshot?: VirtualRobotSnapshot): WsEnvelope[] {
  const pushes: WsEnvelope[] = [buildRobotStatus(robot)];
  const activeTask = snapshot?.activeTask ?? robot.activeTask();
  if (activeTask) pushes.push(buildMowStatus(activeTask));
  return pushes;
}
