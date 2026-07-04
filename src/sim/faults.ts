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
  if (fault.fixtures !== undefined) assertObject(fault.fixtures, `${label}.fixtures`);
}

function assertObject(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must contain an object`);
  }
}
