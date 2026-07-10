import type { RobotWorkStatus, TaskContext } from './fsm-mirror/domain/shared/TaskFSM';

export interface DeviceProfileInput {
  readonly sn: string;
  readonly nickname: string;
  readonly status: RobotWorkStatus | 'estop';
  readonly activeContext: TaskContext<string>;
}

/** Detail API uses the device-local spelling instead of WS `return_dock`. */
function toDeviceRunningStatus(status: RobotWorkStatus | 'estop'): string {
  if (status === 'estop') return 'emergency_stop';
  if (status === 'return_dock') return 'returning_charge';
  return status;
}

/**
 * Build the stateful portion shared by device update and device-detail responses.
 * Map fields are intentionally added by the detail route because their URLs depend
 * on the incoming request host.
 */
export function buildDeviceInfo(input: DeviceProfileInput): Record<string, unknown> {
  const runningStatus = toDeviceRunningStatus(input.status);
  return {
    deviceId: input.sn,
    name: input.nickname,
    deviceName: input.nickname,
    model: 'Pudu Ratel Mower Simulator',
    status: runningStatus === 'idle' ? 'online' : 'working',
    sn: input.sn,
    mac: 'D2:9C:35:EF:D1:04',
    nickname: input.nickname,
    timezone: 'Asia/Shanghai',
    unit: 'metric',
    battery_level: Math.max(0, Math.min(100, Math.round(input.activeContext.battery || 80))),
    battery_charging: runningStatus === 'charging' ? 1 : 0,
    running_status: runningStatus,
    bt_connected: 1,
    bt_rssi: -55,
    wifi_connected: 1,
    wifi_rssi: -60,
    wifi_signal_strength: 'good',
    cellular_connected: 0,
    cellular_signal_strength: 'none',
    isConnected: true,
  };
}
