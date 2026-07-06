import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fixtureLoader } from '../fixtures';
import type { ChaosController, ChaosConfig, RealismConfig } from './chaos';
import type { FaultApplyResult } from './faults';
import type { Recorder } from './recorder';
import { parseRobotDomain, requireRobotDomain, type NonNullableRobotDomain } from './virtualRobot';
import type { RobotDomain, VirtualRobot, VirtualRobotSetup } from './virtualRobot';
import type { SimView } from './simFsmTypes';
import {
  listScenarioGuideSummaries,
  loadScenarioGuide,
  type ScenarioGuideDoc,
} from './scenarioGuide';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const SCENARIO_ROOT = path.join(SERVICE_ROOT, 'scenarios');

export interface LoopStep {
  /** Inner steps repeated each iteration. */
  readonly steps?: readonly ScenarioStep[];
  /** Optional cap; omit (or <= 0) for an infinite loop until the scenario is stopped. */
  readonly maxIterations?: number;
}

export type ScenarioStep =
  | { readonly emit: Record<string, unknown> }
  | { readonly notify: Record<string, unknown> }
  | { readonly expect: Record<string, unknown> }
  | { readonly wait: string | number | { readonly until?: Record<string, unknown>; readonly timeout?: string | number } }
  | { readonly loop: LoopStep }
  | { readonly chaos: ChaosConfig }
  | { readonly realism: RealismConfig }
  | { readonly fault: string | { readonly name?: string } }
  | { readonly note: string }
  | { readonly include: string }
  | { readonly record: boolean | string | Record<string, unknown> }
  | { readonly stopRecord: boolean };

/** Thrown to unwind the step stack when {@link ScenarioEngine.stop} is called. */
class ScenarioStopped extends Error {
  constructor() {
    super('scenario stopped');
    this.name = 'ScenarioStopped';
  }
}

/** Keeps `logs` bounded so infinite-loop scenarios don't grow memory without limit. */
const MAX_SCENARIO_LOGS = 500;

export interface ScenarioDefinition {
  readonly name: string;
  readonly description?: string;
  readonly domain: NonNullableRobotDomain;
  readonly dataset?: string;
  readonly fixtures?: Readonly<Record<string, unknown>>;
  readonly setup?: VirtualRobotSetup;
  readonly steps: readonly ScenarioStep[];
}

export interface ScenarioRunRequest {
  readonly name?: string;
  readonly inline?: string | ScenarioDefinition;
}

export interface ScenarioRunLog {
  readonly index: number;
  readonly kind: string;
  readonly ok: boolean;
  readonly detail?: unknown;
}

export interface ScenarioRunResult {
  readonly ok: boolean;
  readonly name: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly logs: readonly ScenarioRunLog[];
  readonly finalState: ReturnType<VirtualRobot['snapshot']>;
  readonly error?: string;
  /** True when the run ended because {@link ScenarioEngine.stop} was called (not a failure). */
  readonly stopped?: boolean;
}

export interface ScenarioEngineOptions {
  readonly robot: VirtualRobot;
  readonly chaos: ChaosController;
  readonly recorder?: Recorder;
  readonly scenarioRoot?: string;
  readonly switchDataset?: (name: string) => ScenarioDatasetSwitchResult;
  readonly applyFault?: (name: string) => FaultApplyResult;
}

export type ScenarioDatasetSwitchResult =
  | { readonly ok: true; readonly name: string; readonly patchCount: number }
  | { readonly ok: false; readonly error: string };

export class ScenarioEngine {
  private readonly robot: VirtualRobot;
  private readonly chaos: ChaosController;
  private readonly recorder?: Recorder;
  private readonly scenarioRoot: string;
  private readonly switchDataset?: (name: string) => ScenarioDatasetSwitchResult;
  private readonly applyFault?: (name: string) => FaultApplyResult;
  private abortRequested = false;
  private paused = false;
  private running: string | null = null;

  constructor(options: ScenarioEngineOptions) {
    this.robot = options.robot;
    this.chaos = options.chaos;
    this.recorder = options.recorder;
    this.scenarioRoot = options.scenarioRoot ?? SCENARIO_ROOT;
    this.switchDataset = options.switchDataset;
    this.applyFault = options.applyFault;
    // 任意来源（Web 面板 / App API）下发的暂停 / 恢复都会经机器人广播控制意图，
    // 这里订阅后即可暂停 / 恢复脚本循环本身，而不只是机器人 FSM。
    this.robot.on('controlPause', () => this.pause());
    this.robot.on('controlResume', () => this.resume());
  }

  listScenarios(): string[] {
    if (!fs.existsSync(this.scenarioRoot)) return [];
    return fs.readdirSync(this.scenarioRoot)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
      .sort()
      .map(file => path.basename(file, path.extname(file)));
  }

  snapshot(): Record<string, unknown> {
    return {
      running: this.running,
      paused: this.paused,
      scenarios: this.listScenarios(),
      catalog: listScenarioGuideSummaries(this.scenarioRoot),
    };
  }

  /** 读取场景 YAML 内 `guide` 块，供 Panel / API 展示。 */
  getScenarioGuide(name: string): ScenarioGuideDoc | null {
    return loadScenarioGuide(name, this.scenarioRoot);
  }

  stop(): void {
    this.abortRequested = true;
    // 停止时解除暂停，避免脚本循环卡在等待恢复而无法收尾。
    this.paused = false;
  }

  /** 暂停当前脚本循环：步骤推进与 wait 计时都会冻结，直至 {@link resume}。 */
  pause(): void {
    this.paused = true;
  }

  /** 恢复脚本循环，从暂停处继续执行后续步骤。 */
  resume(): void {
    this.paused = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  async run(request: ScenarioRunRequest): Promise<ScenarioRunResult> {
    if (this.running) {
      return {
        ok: false,
        name: this.running,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        logs: [],
        finalState: this.robot.snapshot(),
        error: `scenario already running: ${this.running}`,
      };
    }

    const scenario = this.resolveScenario(request);
    const startedAt = new Date().toISOString();
    const logs: ScenarioRunLog[] = [];
    this.abortRequested = false;
    this.paused = false;
    this.running = scenario.name;

    try {
      await this.executeScenario(scenario, logs, new Set([scenario.name]));
      return {
        ok: true,
        name: scenario.name,
        startedAt,
        endedAt: new Date().toISOString(),
        logs,
        finalState: this.robot.snapshot(),
      };
    } catch (error) {
      if (error instanceof ScenarioStopped) {
        return {
          ok: true,
          stopped: true,
          name: scenario.name,
          startedAt,
          endedAt: new Date().toISOString(),
          logs,
          finalState: this.robot.snapshot(),
        };
      }
      return {
        ok: false,
        name: scenario.name,
        startedAt,
        endedAt: new Date().toISOString(),
        logs,
        finalState: this.robot.snapshot(),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.running = null;
      this.abortRequested = false;
      this.paused = false;
    }
  }

  /**
   * 步骤之间的检查点：先响应停止请求，再在暂停期间挂起，恢复后继续。
   * 暂停状态下不推进任何步骤，确保可以稳定停在某个特定流程状态进行调试。
   */
  private async checkpoint(): Promise<void> {
    if (this.abortRequested) throw new ScenarioStopped();
    while (this.paused && !this.abortRequested) {
      await delay(50);
    }
    if (this.abortRequested) throw new ScenarioStopped();
  }

  private async executeScenario(
    scenario: ScenarioDefinition,
    logs: ScenarioRunLog[],
    includeStack: Set<string>,
  ): Promise<void> {
    await fixtureLoader.withOverrides(scenario.fixtures, async () => {
      if (scenario.fixtures) {
        logs.push({
          index: logs.length,
          kind: 'fixtures',
          ok: true,
          detail: Object.keys(scenario.fixtures).sort(),
        });
      }
      await this.executeScenarioBody(scenario, logs, includeStack);
    });
  }

  private async executeScenarioBody(
    scenario: ScenarioDefinition,
    logs: ScenarioRunLog[],
    includeStack: Set<string>,
  ): Promise<void> {
    const domain = scenario.domain;
    if (scenario.dataset) {
      if (this.switchDataset) {
        const result = this.switchDataset(scenario.dataset);
        logs.push({ index: logs.length, kind: 'dataset', ok: result.ok, detail: result });
        if (!result.ok) throw new Error(result.error);
      } else {
        logs.push({
          index: logs.length,
          kind: 'dataset',
          ok: true,
          detail: { name: scenario.dataset, skipped: true, reason: 'dataset switcher not configured' },
        });
      }
    }
    if (scenario.setup) {
      this.robot.applySetup({ ...scenario.setup, domain: parseRobotDomain(scenario.setup.domain, domain) });
      logs.push({ index: logs.length, kind: 'setup', ok: true, detail: scenario.setup });
    }

    for (const step of scenario.steps) {
      await this.checkpoint();
      await this.executeStep(step, domain, logs, includeStack);
    }
  }

  private pushLog(logs: ScenarioRunLog[], entry: ScenarioRunLog): void {
    logs.push(entry);
    if (logs.length > MAX_SCENARIO_LOGS) {
      logs.splice(0, logs.length - MAX_SCENARIO_LOGS);
    }
  }

  private async executeStep(
    step: ScenarioStep,
    domain: NonNullableRobotDomain,
    logs: ScenarioRunLog[],
    includeStack: Set<string>,
  ): Promise<void> {
    const index = logs.length;
    if ('emit' in step) {
      const event = normalizeEvent(step.emit);
      if (!event) throw new Error(`step ${index}: emit.type is required`);
      const eventDomain = parseRobotDomain(step.emit.domain, domain);
      this.robot.dispatchRaw(event as never, eventDomain);
      logs.push({ index, kind: 'emit', ok: true, detail: { domain: eventDomain, event } });
      return;
    }

    if ('notify' in step) {
      const body = step.notify;
      this.robot.pushRatelStatus({
        work_status: typeof body.work_status === 'string' ? body.work_status : undefined,
        sub_status: typeof body.sub_status === 'string' ? body.sub_status : undefined,
        battery_level: typeof body.battery_level === 'number' ? body.battery_level : undefined,
        sn: typeof body.sn === 'string' ? body.sn : undefined,
      });
      logs.push({ index, kind: 'notify', ok: true, detail: body });
      return;
    }

    if ('expect' in step) {
      const result = matchExpectation(this.robot.snapshot(), step.expect, domain);
      logs.push({ index, kind: 'expect', ok: result.ok, detail: result });
      if (!result.ok) throw new Error(`step ${index}: ${result.message}`);
      return;
    }

    if ('wait' in step) {
      await this.executeWait(step.wait, domain);
      this.pushLog(logs, { index, kind: 'wait', ok: true, detail: step.wait });
      return;
    }

    if ('loop' in step) {
      const inner = Array.isArray(step.loop?.steps) ? step.loop.steps : [];
      if (inner.length === 0) throw new Error(`step ${index}: loop.steps must be a non-empty array`);
      const rawMax = step.loop?.maxIterations;
      const maxIterations = typeof rawMax === 'number' && rawMax > 0 ? Math.floor(rawMax) : Infinity;
      this.pushLog(logs, { index, kind: 'loop', ok: true, detail: { maxIterations: rawMax ?? 'infinite', steps: inner.length } });
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        await this.checkpoint();
        for (const child of inner) {
          await this.checkpoint();
          await this.executeStep(child, domain, logs, includeStack);
        }
      }
      return;
    }

    if ('chaos' in step) {
      const next = this.chaos.update(step.chaos);
      logs.push({ index, kind: 'chaos', ok: true, detail: next });
      return;
    }

    if ('realism' in step) {
      const next = this.chaos.updateRealism(step.realism);
      logs.push({ index, kind: 'realism', ok: true, detail: next });
      return;
    }

    if ('fault' in step) {
      const name = typeof step.fault === 'string'
        ? step.fault
        : typeof step.fault.name === 'string'
          ? step.fault.name
          : '';
      if (!name) throw new Error(`step ${index}: fault.name is required`);
      if (!this.applyFault) throw new Error(`step ${index}: fault applier is not configured`);
      const result = this.applyFault(name);
      logs.push({ index, kind: 'fault', ok: result.ok, detail: result });
      if (!result.ok) throw new Error(result.error ?? `fault failed: ${name}`);
      return;
    }

    if ('note' in step) {
      this.recorder?.record({ dir: 'fsm', kind: 'note', note: step.note });
      logs.push({ index, kind: 'note', ok: true, detail: step.note });
      return;
    }

    if ('include' in step) {
      const child = this.loadScenarioByName(step.include);
      if (includeStack.has(child.name)) throw new Error(`recursive include: ${child.name}`);
      includeStack.add(child.name);
      await this.executeScenario(child, logs, includeStack);
      includeStack.delete(child.name);
      logs.push({ index, kind: 'include', ok: true, detail: child.name });
      return;
    }

    if ('record' in step) {
      const label = typeof step.record === 'string' ? step.record : scenarioNameFromStack(includeStack);
      this.recorder?.start(label);
      logs.push({ index, kind: 'record', ok: true, detail: this.recorder?.snapshot() ?? null });
      return;
    }

    if ('stopRecord' in step) {
      const stopped = this.recorder?.stop();
      logs.push({ index, kind: 'stopRecord', ok: true, detail: stopped ?? null });
      return;
    }

    logs.push({ index, kind: 'unknown', ok: false, detail: step });
    throw new Error(`step ${index}: unknown scenario step`);
  }

  private async executeWait(
    value: string | number | { readonly until?: Record<string, unknown>; readonly timeout?: string | number },
    domain: RobotDomain,
  ): Promise<void> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'until' in value) {
      const timeoutMs = parseDuration((value as { timeout?: string | number }).timeout ?? '3000ms');
      let elapsed = 0;
      while (elapsed <= timeoutMs) {
        if (this.abortRequested) throw new ScenarioStopped();
        // 暂停期间冻结超时计时，不推进、不判定，恢复后从原处继续。
        if (this.paused) {
          await delay(50);
          continue;
        }
        const result = matchExpectation(this.robot.snapshot(), (value as { until?: Record<string, unknown> }).until ?? {}, domain);
        if (result.ok) return;
        await delay(50);
        elapsed += 50;
      }
      throw new Error(`wait.until timeout after ${timeoutMs}ms`);
    }
    const totalMs = parseDuration(value as string | number);
    let remaining = totalMs;
    while (remaining > 0) {
      if (this.abortRequested) throw new ScenarioStopped();
      // 暂停期间不消耗等待时长，确保「暂停当前场景」语义。
      if (this.paused) {
        await delay(50);
        continue;
      }
      const slice = Math.min(50, remaining);
      await delay(slice);
      remaining -= slice;
    }
  }

  private resolveScenario(request: ScenarioRunRequest): ScenarioDefinition {
    if (request.inline) return normalizeScenario(parseScenario(request.inline), 'inline');
    if (!request.name) throw new Error('name or inline is required');
    return this.loadScenarioByName(request.name);
  }

  private loadScenarioByName(name: string): ScenarioDefinition {
    const safeName = name.replace(/\.ya?ml$/i, '');
    const candidates = [
      path.join(this.scenarioRoot, `${safeName}.yaml`),
      path.join(this.scenarioRoot, `${safeName}.yml`),
    ];
    const file = candidates.find(candidate => fs.existsSync(candidate));
    if (!file) throw new Error(`scenario not found: ${name}`);
    return normalizeScenario(parseScenario(fs.readFileSync(file, 'utf8')), safeName);
  }
}

export function parseScenario(input: string | ScenarioDefinition): unknown {
  if (typeof input !== 'string') return input;
  return yaml.load(input);
}

function normalizeScenario(value: unknown, fallbackName: string): ScenarioDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('scenario must be an object');
  }
  const raw = value as Record<string, unknown>;
  const steps = Array.isArray(raw.steps) ? raw.steps as ScenarioStep[] : [];
  if (steps.length === 0) throw new Error('scenario.steps must be a non-empty array');
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fallbackName,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    domain: requireRobotDomain(raw.domain, `scenario "${raw.name ?? fallbackName}"`),
    dataset: typeof raw.dataset === 'string' && raw.dataset.trim() ? raw.dataset.trim() : undefined,
    fixtures: typeof raw.fixtures === 'object' && raw.fixtures !== null && !Array.isArray(raw.fixtures)
      ? raw.fixtures as Readonly<Record<string, unknown>>
      : undefined,
    setup: typeof raw.setup === 'object' && raw.setup !== null && !Array.isArray(raw.setup)
      ? raw.setup as VirtualRobotSetup
      : undefined,
    steps,
  };
}

function normalizeEvent(body: Record<string, unknown>): Record<string, unknown> | null {
  const type = typeof body.type === 'string' ? body.type : '';
  if (!type) return null;
  const event: Record<string, unknown> = { ...body, type };
  delete event.domain;
  if (type === 'CMD_START' && event.mode == null) event.mode = 'auto';
  if (type.startsWith('DEVICE_')) {
    if (event.source == null) event.source = 'ws';
    if (event.ts == null) event.ts = Date.now();
  }
  if (type === 'DEVICE_CAPABILITIES') {
    const capabilities = typeof body.capabilities === 'object' && body.capabilities !== null
      ? body.capabilities as Record<string, unknown>
      : {};
    event.canSwitchManual = body.canSwitchManual ?? body.can_switch_manual ?? capabilities.canSwitchManual ?? capabilities.can_switch_manual ?? false;
    event.canSwitchAuto = body.canSwitchAuto ?? body.can_switch_auto ?? capabilities.canSwitchAuto ?? capabilities.can_switch_auto ?? false;
  }
  if (type === 'DEVICE_NOTICE' && typeof body.notice !== 'object') {
    event.notice = {
      id: typeof body.id === 'string' ? body.id : `notice-${Date.now()}`,
      kind: body.kind === 'new_area_available' ? 'new_area_available' : 'new_area_available',
      mode: body.mode === 'remote' ? 'remote' : 'auto',
      ts: Date.now(),
    };
  }
  return event;
}

function parseDuration(value: string | number): number {
  if (typeof value === 'number') return Math.max(0, value);
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
  if (!match) throw new Error(`invalid duration: ${value}`);
  const amount = Number(match[1]);
  return match[2] === 's' ? Math.round(amount * 1000) : Math.round(amount);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function scenarioNameFromStack(includeStack: Set<string>): string | undefined {
  return [...includeStack][includeStack.size - 1];
}

function matchExpectation(
  snapshot: ReturnType<VirtualRobot['snapshot']>,
  expected: Record<string, unknown>,
  domain: RobotDomain,
): { ok: boolean; message: string; mismatches: string[] } {
  const ctx = (domain === 'mowing' ? snapshot.mowing : snapshot.mapping) as SimView<string>;
  const view = {
    ...snapshot,
    ...ctx,
    capabilities: ctx.capabilities,
    error: ctx.error,
    activeTask: snapshot.activeTask,
    task_status: snapshot.activeTask?.status,
    task_id: snapshot.activeTask?.task_id,
  };
  const mismatches = comparePartial(normalizeExpected(expected), view, 'expect');
  return {
    ok: mismatches.length === 0,
    message: mismatches.length === 0 ? 'ok' : mismatches.join('; '),
    mismatches,
  };
}

function normalizeExpected(expected: Record<string, unknown>): Record<string, unknown> {
  if (typeof expected.capabilities === 'object' && expected.capabilities !== null && !Array.isArray(expected.capabilities)) {
    const capabilities = expected.capabilities as Record<string, unknown>;
    return {
      ...expected,
      capabilities: {
        ...capabilities,
        canSwitchManual: capabilities.canSwitchManual ?? capabilities.can_switch_manual,
        canSwitchAuto: capabilities.canSwitchAuto ?? capabilities.can_switch_auto,
      },
    };
  }
  return expected;
}

function comparePartial(expected: unknown, actual: unknown, pathName: string): string[] {
  if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
    if (expected === actual) return [];
    if (pathName.endsWith('.mode') && expected === 'manual' && actual === 'remote') return [];
    return [`${pathName}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) {
    return [`${pathName}: expected object, got ${JSON.stringify(actual)}`];
  }
  const mismatches: string[] = [];
  const exp = expected as Record<string, unknown>;
  const act = actual as Record<string, unknown>;
  for (const [key, expValue] of Object.entries(exp)) {
    if (expValue === undefined) continue;
    mismatches.push(...comparePartial(expValue, act[key], `${pathName}.${key}`));
  }
  return mismatches;
}
