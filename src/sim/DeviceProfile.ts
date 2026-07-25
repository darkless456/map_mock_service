import type { RobotWorkStatus, TaskContext } from './fsm-mirror/domain/shared/TaskFSM';
import type { ExtendStatus } from './MappingProtocolSnapshot';

export interface DeviceProfileInput {
  readonly sn: string;
  readonly nickname: string;
  readonly status: RobotWorkStatus | 'estop';
  readonly activeContext: TaskContext<string>;
  /** mapping-v4-final-spec.md §4: `robot/detail` mirrors the WS `NOTIFY_RATEL_STATUS` projection. */
  readonly subStatus: string;
  readonly subStatusEnteredAt: number | null;
  readonly extendStatus: ExtendStatus;
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
  const isCharging = runningStatus === 'charging';
  // RTK fix is only meaningful while the mower is actually outdoors under GNSS coverage.
  const rtkFixed = runningStatus === 'mowing' || runningStatus === 'mapping';
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
    battery_charging: isCharging ? 1 : 0,
    battery_temperature: isCharging ? 32 : 25,
    running_status: runningStatus,
    bt_connected: 1,
    bt_rssi: -55,
    wifi_connected: 1,
    wifi_rssi: -60,
    wifi_signal_strength: 'good',
    wifi_ssid: 'Mock-WiFi',
    cellular_connected: 0,
    cellular_signal_strength: 'none',
    isConnected: true,
    sub_status: input.subStatus,
    sub_status_entered_at: input.subStatusEnteredAt,
    extend_status: input.extendStatus,
    // Present on the real gateway but not yet consumed by IDeviceInfo — archived for parity.
    ble_mac: 'D2:9C:35:EF:D1:04',
    access_role: 'owner',
    rtk_is_fixed: rtkFixed ? 1 : 0,
    rtk_satellites_used: rtkFixed ? 20 : 0,
  };
}
