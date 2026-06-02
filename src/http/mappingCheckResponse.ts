import type { VirtualRobot } from '../sim/virtualRobot';

/** Shape of `POST /ratel/api/v1/mapping/check` → `data` (see build-docs/APP端接口文档.md). */
export interface MappingCheckConditionsPayload {
  readonly bluetooth_status: string;
  readonly bluetooth_msg: string;
  readonly cellular: string;
  readonly wifi: string;
  readonly battery: string;
  readonly docking_station: string;
  readonly light: string;
}

export interface MappingCheckDataPayload {
  readonly all_ok: number;
  readonly conditions: MappingCheckConditionsPayload;
}

const CONDITION_FIELDS: readonly (keyof Omit<MappingCheckConditionsPayload, 'bluetooth_msg'>)[] = [
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

function buildFullConditions(robot: VirtualRobot): MappingCheckConditionsPayload {
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

function emptyConditions(): MappingCheckConditionsPayload {
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
 * Builds mapping pre-check payload. Before `robot/self_check`, only partial data;
 * after self-check, each poll reveals one more condition (simulates robot reporting).
 */
export function buildMappingCheckData(robot: VirtualRobot): MappingCheckDataPayload {
  if (robot.mappingPrepareSelfCheckAt == null) {
    return {
      all_ok: 0,
      conditions: {
        ...emptyConditions(),
        bluetooth_status: 'ok',
      },
    };
  }

  robot.mappingCheckPollCount += 1;
  const revealed = Math.min(robot.mappingCheckPollCount, CONDITION_FIELDS.length);
  const full = buildFullConditions(robot);
  const conditions = emptyConditions();
  for (let i = 0; i < CONDITION_FIELDS.length; i += 1) {
    const key = CONDITION_FIELDS[i];
    if (i < revealed) {
      conditions[key] = full[key];
    }
  }

  const statusFields = CONDITION_FIELDS.map(key => conditions[key]);
  const allPass =
    revealed >= CONDITION_FIELDS.length &&
    statusFields.every(value => value === 'ok' || value === 'warning');

  return {
    all_ok: allPass ? 1 : 0,
    conditions,
  };
}
