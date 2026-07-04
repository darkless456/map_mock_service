import type { RobotWorkStatus, TaskContext } from './fsm-mirror/domain/shared/TaskFSM';

export interface DeviceProfileInput {
  readonly sn: string;
  readonly nickname: string;
  readonly status: RobotWorkStatus | 'estop';
  readonly activeContext: TaskContext<string>;
}

export function buildDeviceInfo(input: DeviceProfileInput): Record<string, unknown> {
  return {
    deviceId: input.sn,
    name: input.nickname,
    deviceName: input.nickname,
    model: 'Pudu Ratel Mower Simulator',
    status: input.status === 'idle' ? 'online' : 'working',
    sn: input.sn,
    mac: 'D2:9C:35:EF:D1:04',
    nickname: input.nickname,
    battery_level: input.activeContext.battery || 80,
    running_status: input.status,
    bound_map_count: 1,
    bt_connected: 1,
    bt_rssi: -55,
    wifi_connected: 1,
    wifi_rssi: -60,
    wifi_signal_strength: 'good',
    cellular_connected: -1,
    cellular_signal_strength: 'none',
    isConnected: true,
  };
}
