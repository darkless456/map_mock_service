import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_ROOT } from '../fixtures';
import type { ChaosConfig, ChaosController } from './chaos';
import type { VirtualRobot, VirtualRobotSetup } from './virtualRobot';
import type { RatelNotifyPayload } from './mappingNotify';

const FAULT_ROOT = path.join(FIXTURE_ROOT, 'faults');

export interface FaultDefinition {
  readonly name: string;
  readonly description?: string;
  readonly chaos?: ChaosConfig;
  readonly dataset?: string;
  readonly setup?: VirtualRobotSetup;
  readonly notify?: RatelNotifyPayload;
  /**
   * 地图上传失败注入：上传进度到达该百分比时转失败态，并**停在 `upload_map` 不转 idle**
   * ——这正是 [决议-1] 承诺的真机行为，App 的失败页可达性依赖它。
   * `null` 显式解除注入（重试后应能走完）。
   */
  readonly upload_fail_at?: number | null;
  readonly fixtures?: Readonly<Record<string, unknown>>;
}

export interface FaultApplyDeps {
  readonly robot: VirtualRobot;
  readonly chaos: ChaosController;
  readonly switchDataset?: (name: string) => FaultDatasetSwitchResult;
}

export type FaultDatasetSwitchResult =
  | { readonly ok: true; readonly name: string; readonly patchCount: number }
  | { readonly ok: false; readonly error: string };

export interface FaultApplyResult {
  readonly ok: boolean;
  readonly fault: FaultDefinition;
  readonly chaos?: Required<ChaosConfig>;
  readonly dataset?: FaultDatasetSwitchResult;
  readonly notified?: boolean;
  readonly error?: string;
}

export function listFaults(): FaultDefinition[] {
  if (!fs.existsSync(FAULT_ROOT)) return [];
  return fs.readdirSync(FAULT_ROOT)
    .filter(file => file.endsWith('.json'))
    .sort()
    .map(file => readFaultFile(path.join(FAULT_ROOT, file)));
}

export function readFault(name: string): FaultDefinition {
  const safeName = path.basename(name, '.json');
  const file = path.join(FAULT_ROOT, `${safeName}.json`);
  if (!fs.existsSync(file)) throw new Error(`fault not found: ${name}`);
  return readFaultFile(file);
}

export function applyFault(name: string, deps: FaultApplyDeps): FaultApplyResult {
  const fault = readFault(name);
  let chaos: Required<ChaosConfig> | undefined;
  let dataset: FaultDatasetSwitchResult | undefined;
  let notified = false;

  if (fault.dataset) {
    if (!deps.switchDataset) {
      return { ok: false, fault, error: `fault ${fault.name} requires dataset switching` };
    }
    dataset = deps.switchDataset(fault.dataset);
    if (!dataset.ok) return { ok: false, fault, dataset, error: dataset.error };
  }

  if (fault.chaos) chaos = deps.chaos.update(fault.chaos);
  if (fault.setup) deps.robot.applySetup(fault.setup);
  // 先于 notify 生效：注入点必须在设备进入上传段之前就位。
  if (fault.upload_fail_at !== undefined) {
    deps.robot.uploadFailAt = fault.upload_fail_at;
  }
  if (fault.notify) notified = deps.robot.pushRatelStatus(fault.notify);

  return { ok: true, fault, chaos, dataset, notified };
}

function readFaultFile(file: string): FaultDefinition {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  assertFault(parsed, file);
  return parsed;
}

function assertFault(value: unknown, label: string): asserts value is FaultDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain an object`);
  }
  const fault = value as Record<string, unknown>;
  if (typeof fault.name !== 'string' || !fault.name.trim()) {
    throw new Error(`${label}.name must be a non-empty string`);
  }
  if (fault.description !== undefined && typeof fault.description !== 'string') {
    throw new Error(`${label}.description must be a string`);
  }
  if (fault.dataset !== undefined && typeof fault.dataset !== 'string') {
    throw new Error(`${label}.dataset must be a string`);
  }
  if (fault.chaos !== undefined) assertObject(fault.chaos, `${label}.chaos`);
  if (fault.setup !== undefined) assertObject(fault.setup, `${label}.setup`);
  if (fault.notify !== undefined) assertObject(fault.notify, `${label}.notify`);
  if (
    fault.upload_fail_at !== undefined &&
    fault.upload_fail_at !== null &&
    (typeof fault.upload_fail_at !== 'number' ||
      !Number.isFinite(fault.upload_fail_at) ||
      fault.upload_fail_at < 0 ||
      fault.upload_fail_at > 100)
  ) {
    throw new Error(`${label}.upload_fail_at must be null or a number in [0, 100]`);
  }
  if (fault.fixtures !== undefined) assertObject(fault.fixtures, `${label}.fixtures`);
}

function assertObject(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain an object`);
  }
}
