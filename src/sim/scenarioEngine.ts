import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ChaosController, ChaosConfig } from './chaos';
import type { Recorder } from './recorder';
import type { RobotDomain, VirtualRobot, VirtualRobotSetup } from './virtualRobot';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const SCENARIO_ROOT = path.join(SERVICE_ROOT, 'scenarios');

export type ScenarioStep =
  | { readonly emit: Record<string, unknown> }
  | { readonly notify: Record<string, unknown> }
  | { readonly expect: Record<string, unknown> }
  | { readonly wait: string | number | { readonly until?: Record<string, unknown>; readonly timeout?: string | number } }
  | { readonly chaos: ChaosConfig }
  | { readonly note: string }
  | { readonly include: string }
  | { readonly record: boolean | string | Record<string, unknown> }
  | { readonly stopRecord: boolean };

export interface ScenarioDefinition {
  readonly name: string;
  readonly description?: string;
  readonly domain?: RobotDomain;
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
}

export interface ScenarioEngineOptions {
  readonly robot: VirtualRobot;
  readonly chaos: ChaosController;
  readonly recorder?: Recorder;
  readonly scenarioRoot?: string;
}

export class ScenarioEngine {
  private readonly robot: VirtualRobot;
  private readonly chaos: ChaosController;
  private readonly recorder?: Recorder;
  private readonly scenarioRoot: string;
  private abortRequested = false;
  private running: string | null = null;

  constructor(options: ScenarioEngineOptions) {
    this.robot = options.robot;
    this.chaos = options.chaos;
    this.recorder = options.recorder;
    this.scenarioRoot = options.scenarioRoot ?? SCENARIO_ROOT;
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
      scenarios: this.listScenarios(),
    };
  }

  stop(): void {
    this.abortRequested = true;
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
    }
  }

  private async executeScenario(
    scenario: ScenarioDefinition,
    logs: ScenarioRunLog[],
    includeStack: Set<string>,
  ): Promise<void> {
    const domain = readDomain(scenario.domain, 'mapping');
    if (scenario.setup) {
      this.robot.applySetup({ ...scenario.setup, domain: readDomain(scenario.setup.domain, domain) });
      logs.push({ index: logs.length, kind: 'setup', ok: true, detail: scenario.setup });
    }

    for (const step of scenario.steps) {
      if (this.abortRequested) throw new Error('scenario stopped');
      await this.executeStep(step, domain, logs, includeStack);
    }
  }

  private async executeStep(
    step: ScenarioStep,
    domain: RobotDomain,
    logs: ScenarioRunLog[],
    includeStack: Set<string>,
  ): Promise<void> {
    const index = logs.length;
    if ('emit' in step) {
      const event = normalizeEvent(step.emit);
      if (!event) throw new Error(`step ${index}: emit.type is required`);
      const eventDomain = readDomain(step.emit.domain, domain);
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
      logs.push({ index, kind: 'wait', ok: true, detail: step.wait });
      return;
    }

    if ('chaos' in step) {
      const next = this.chaos.update(step.chaos);
      logs.push({ index, kind: 'chaos', ok: true, detail: next });
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
      const label = typeof step.record === 'string' ? step.record : undefined;
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
      const started = Date.now();
      while (Date.now() - started <= timeoutMs) {
        const result = matchExpectation(this.robot.snapshot(), (value as { until?: Record<string, unknown> }).until ?? {}, domain);
        if (result.ok) return;
        await delay(50);
      }
      throw new Error(`wait.until timeout after ${timeoutMs}ms`);
    }
    await delay(parseDuration(value as string | number));
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
    domain: readDomain(raw.domain, 'mapping'),
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

function readDomain(value: unknown, fallback: RobotDomain): RobotDomain {
  return value === 'mapping' || value === 'mowing' || value === 'mapEdit' ? value : fallback;
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

function matchExpectation(
  snapshot: ReturnType<VirtualRobot['snapshot']>,
  expected: Record<string, unknown>,
  domain: RobotDomain,
): { ok: boolean; message: string; mismatches: string[] } {
  const ctx = domain === 'mowing' ? snapshot.mowing : snapshot.mapping;
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
