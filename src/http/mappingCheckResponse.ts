import type { VirtualRobot } from '../sim/virtualRobot';

/** `POST /ratel/api/v1/mapping/check` → `data`（扁平，见 APP端接口文档 2026-06-04） */
export interface MappingCheckDataPayload {
  readonly bluetooth_status: string;
  readonly bluetooth_msg: string;
  readonly cellular: string;
  readonly wifi: string;
  readonly battery: string;
  readonly docking_station: string;
  readonly light: string;
}

const CONDITION_FIELDS: readonly (keyof Omit<MappingCheckDataPayload, 'bluetooth_msg'>)[] = [
  'bluetooth_status',
  'cellular',
  'wifi',
  'battery',
  'docking_station',
  'light',
] as const;

function conditionStatus(ok: boolean, warn = false): string {
  if (ok) return 'ok';
  if (warn) return 'warning';
  return 'error';
}

function buildFullConditions(robot: VirtualRobot): MappingCheckDataPayload {
  const batteryLevel = robot.snapshot().mapping.battery || 80;
  const batteryOk = batteryLevel >= 20;
  const batteryWarn = batteryLevel >= 10 && batteryLevel < 20;
  return {
    bluetooth_status: 'ok',
    bluetooth_msg: '',
    cellular: 'ok',
    wifi: 'ok',
    battery: conditionStatus(batteryOk, batteryWarn),
    docking_station: 'ok',
    light: 'ok',
  };
}

type MutableMappingCheckData = {
  -readonly [K in keyof MappingCheckDataPayload]: MappingCheckDataPayload[K];
};

function emptyConditions(): MutableMappingCheckData {
  return {
    bluetooth_status: '',
    bluetooth_msg: '',
    cellular: '',
    wifi: '',
    battery: '',
    docking_station: '',
    light: '',
  };
}

/**
 * 建图条件 mock：未 self_check 时仅部分字段；之后每次 poll 多揭示一项（模拟机器上报）。
 */
export function buildMappingCheckData(robot: VirtualRobot): MappingCheckDataPayload {
  if (robot.mappingPrepareSelfCheckAt == null) {
    return {
      ...emptyConditions(),
      bluetooth_status: 'ok',
    };
  }

  robot.mappingCheckPollCount += 1;
  const revealed = Math.min(robot.mappingCheckPollCount, CONDITION_FIELDS.length);
  const full = buildFullConditions(robot);
  const data = emptyConditions();
  for (let i = 0; i < CONDITION_FIELDS.length; i += 1) {
    const key = CONDITION_FIELDS[i];
    if (i < revealed) {
      data[key] = full[key];
    }
  }
  return data;
}
