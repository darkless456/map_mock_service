import { EventEmitter } from 'node:events';
import {
  initialMappingState,
  mappingReducer,
  type MappingContext,
  type MappingEvent,
  type MappingPhase,
} from './fsm-mirror/domain/mapping/MappingSession';
import {
  initialMowingState,
  mowingReducer,
  type MowingContext,
  type MowingEvent,
  type MowingPhase,
} from './fsm-mirror/domain/mowing/MowingTask';
import type {
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
  TaskNotice,
  TaskState,
} from './fsm-mirror/domain/shared/TaskFSM';
import { createCompactId } from '../shared/ids';

export type RobotDomain = 'mapping' | 'mowing' | 'mapEdit' | null;
export type AnyTaskEvent = TaskEvent<MappingPhase> | TaskEvent<MowingPhase> | MappingEvent | MowingEvent;

export interface MowingTaskRecord {
  readonly task_id: string;
  readonly sn: string;
  status: 'ON_THE_WAY' | 'PAUSE' | 'COMPLETE' | 'CANCEL' | 'FAILED';
  readonly task_type: 'cloud' | 'button';
  task_message: string;
  task_error_code: number;
  mow_area: number;
  mow_progress: number;
  estimated_time: number;
  readonly task_info: Record<string, unknown>;
  readonly created_at: number;
}

export interface VirtualRobotSnapshot {
  readonly sn: string;
  readonly nickname: string;
  readonly activeDomain: RobotDomain;
  readonly workStatus: RobotWorkStatus | 'estop';
  readonly state: TaskState;
  readonly phase: string | null;
  readonly mapping: MappingContext;
  readonly mowing: MowingContext;
  readonly activeTask: MowingTaskRecord | null;
  readonly events: readonly RecordedEvent[];
}

export interface RecordedEvent {
  readonly ts: number;
  readonly domain: RobotDomain;
  readonly event: unknown;
  readonly state: TaskState;
  readonly phase: string | null;
}

export interface VirtualRobotSetup {
  readonly domain?: RobotDomain;
  readonly state?: TaskState;
  readonly phase?: string | null;
  readonly mode?: 'auto' | 'remote' | string;
  readonly taskMode?: string | null;
  readonly battery?: number;
  readonly area?: number;
  readonly capabilities?: Partial<{
    readonly canSwitchManual: boolean;
    readonly canSwitchAuto: boolean;
    readonly can_switch_manual: boolean;
    readonly can_switch_auto: boolean;
  }>;
  readonly notices?: readonly TaskNotice[];
  readonly error?: TaskContext<string>['error'];
  readonly sn?: string;
  readonly nickname?: string;
}

export interface VirtualRobotTranscript {
  readonly ts: number;
  readonly domain: RobotDomain;
  readonly event: unknown;
  readonly before: Pick<VirtualRobotSnapshot, 'activeDomain' | 'workStatus' | 'state' | 'phase' | 'mapping' | 'mowing' | 'activeTask'>;
  readonly after: Pick<VirtualRobotSnapshot, 'activeDomain' | 'workStatus' | 'state' | 'phase' | 'mapping' | 'mowing' | 'activeTask'>;
  readonly changed: boolean;
}

export interface VirtualRobotOptions {
  readonly sn?: string;
  readonly nickname?: string;
  readonly battery?: number;
  readonly maxEvents?: number;
}

function nowEvent<P extends string>(source: 'ws' | 'ble' = 'ws') {
  return { source, ts: Date.now() } as const;
}

function taskModeFromCreateInfo(taskInfo: Record<string, unknown>): string {
  switch (taskInfo.task_mode) {
    case 'area':
    case 'region':
      return 'MOW_REGION';
    case 'edge':
      return 'MOW_EDGE';
    default:
      return 'MOW_GLOBAL';
  }
}

export class VirtualRobot extends EventEmitter {
  sn: string;
  nickname: string;
  mapping: MappingContext;
  mowing: MowingContext;
  activeDomain: RobotDomain = null;
  private readonly maxEvents: number;
  private readonly events: RecordedEvent[] = [];
  private readonly tasks = new Map<string, MowingTaskRecord>();
  private readonly latestTaskBySn = new Map<string, string>();

  constructor(options: VirtualRobotOptions = {}) {
    super();
    this.sn = options.sn || process.env.ROBOT_SN || 'MOCK:00:11:22:33:44';
    this.nickname = options.nickname || 'Mower Dev Simulator';
    const battery = options.battery ?? 80;
    this.mapping = { ...initialMappingState, battery };
    this.mowing = { ...initialMowingState, battery };
    this.maxEvents = options.maxEvents ?? 50;
  }

  get activeContext(): TaskContext<string> {
    if (this.activeDomain === 'mowing') return this.mowing as TaskContext<string>;
    return this.mapping as TaskContext<string>;
  }

  snapshot(): VirtualRobotSnapshot {
    return {
      sn: this.sn,
      nickname: this.nickname,
      activeDomain: this.activeDomain,
      workStatus: this.workStatus(),
      state: this.activeContext.state,
      phase: this.activeContext.phase,
      mapping: this.mapping,
      mowing: this.mowing,
      activeTask: this.activeTask(),
      events: [...this.events],
    };
  }

  reset(): void {
    const battery = this.activeContext.battery || 80;
    this.mapping = { ...initialMappingState, battery };
    this.mowing = { ...initialMowingState, battery };
    this.activeDomain = null;
    this.tasks.clear();
    this.latestTaskBySn.clear();
    this.record(null, { type: 'SIM_RESET' });
    this.emit('changed', this.snapshot());
  }

  updateDevice(patch: Record<string, unknown>): void {
    if (typeof patch.sn === 'string' && patch.sn.trim()) this.sn = patch.sn.trim();
    if (typeof patch.nickname === 'string') this.nickname = patch.nickname;
    if (typeof patch.name === 'string') this.nickname = patch.name;
    this.emit('changed', this.snapshot());
  }

  applySetup(setup: VirtualRobotSetup = {}): void {
    if (typeof setup.sn === 'string' && setup.sn.trim()) this.sn = setup.sn.trim();
    if (typeof setup.nickname === 'string') this.nickname = setup.nickname;
    const domain = setup.domain === 'mowing' || setup.domain === 'mapEdit' ? setup.domain : 'mapping';
    this.activeDomain = domain;
    const target = domain === 'mowing' ? this.mowing : this.mapping;
    const capabilities = setup.capabilities
      ? {
          canSwitchManual: setup.capabilities.canSwitchManual ?? setup.capabilities.can_switch_manual ?? target.capabilities.canSwitchManual,
          canSwitchAuto: setup.capabilities.canSwitchAuto ?? setup.capabilities.can_switch_auto ?? target.capabilities.canSwitchAuto,
        }
      : target.capabilities;
    const next = {
      ...target,
      state: setup.state ?? target.state,
      phase: setup.phase === undefined ? target.phase : setup.phase,
      mode: setup.mode === 'remote' ? 'remote' : 'auto',
      taskMode: setup.taskMode === undefined ? target.taskMode : setup.taskMode,
      battery: typeof setup.battery === 'number' ? setup.battery : target.battery,
      area: typeof setup.area === 'number' ? setup.area : target.area,
      capabilities,
      notices: setup.notices ?? target.notices,
      error: setup.error === undefined ? target.error : setup.error,
      lastSource: 'cmd' as const,
      lastSourceTs: Date.now(),
    };
    if (domain === 'mowing') this.mowing = next as MowingContext;
    else this.mapping = next as MappingContext;
    this.record(domain, { type: 'SIM_SETUP', setup });
    this.emit('changed', this.snapshot());
  }

  startMapping(input: { sn?: string; mode?: 'auto' | 'remote' | string; map_id?: string } = {}): void {
    if (input.sn) this.sn = input.sn;
    this.activeDomain = 'mapping';
    const mode = input.mode === 'remote' ? 'remote' : 'auto';
    this.dispatchMapping({ type: 'CMD_START', mode, taskMode: 'MAP_BUILD' });
    this.dispatchMapping({ type: 'DEVICE_PHASE', phase: 'MAP_PRECHECK', ...nowEvent() });
  }

  pauseMapping(): void {
    this.dispatchMapping({ type: 'CMD_PAUSE' });
  }

  createMowingTask(input: { sn: string; task_info: Record<string, unknown> }): MowingTaskRecord {
    this.sn = input.sn;
    this.activeDomain = 'mowing';
    const task = this.createTask(input.sn, input.task_info);
    this.dispatchMowing({
      type: 'CMD_START',
      mode: 'auto',
      taskMode: taskModeFromCreateInfo(input.task_info),
    });
    this.dispatchMowing({ type: 'DEVICE_REPORT_STARTED' });
    this.syncActiveTaskFromContext();
    return task;
  }

  applyMowingAction(taskId: string, action: string): string | null {
    const task = this.tasks.get(taskId);
    if (!task) return `task ${taskId} not found`;
    this.activeDomain = 'mowing';
    switch (action) {
      case 'PAUSE':
        this.dispatchMowing({ type: 'CMD_PAUSE' });
        break;
      case 'RESUME':
        this.dispatchMowing({ type: 'CMD_RESUME' });
        this.dispatchMowing({ type: 'DEVICE_REPORT_STARTED' });
        break;
      case 'CANCEL':
        this.dispatchMowing({ type: 'CMD_CANCEL' });
        break;
      case 'FINISH_AND_RETURN_DOCK':
        this.dispatchMowing({ type: 'CMD_FINISH_AND_RETURN_DOCK' });
        break;
      default:
        return `unknown action ${action}`;
    }
    this.syncActiveTaskFromContext();
    return null;
  }

  dispatchRaw(event: AnyTaskEvent, domain: RobotDomain = this.activeDomain): void {
    if (domain === 'mowing') this.dispatchMowing(event as MowingEvent);
    else this.dispatchMapping(event as MappingEvent);
  }

  progressMowing(delta = 2): void {
    const task = this.activeTask();
    if (!task || task.status !== 'ON_THE_WAY') return;
    task.mow_progress = Math.min(100, task.mow_progress + delta);
    task.estimated_time = Math.max(0, Math.round((100 - task.mow_progress) * 3));
    task.mow_area = Math.max(task.mow_area, Number((task.mow_progress * 2.56).toFixed(1)));
    if (task.mow_progress >= 100) {
      task.task_message = 'Mowing complete';
      this.dispatchMowing({ type: 'DEVICE_REPORT_FINISHED' });
      this.syncActiveTaskFromContext();
    }
    this.emit('changed', this.snapshot());
  }

  listTasks(sn?: string): MowingTaskRecord[] {
    return [...this.tasks.values()]
      .filter(task => !sn || task.sn === sn)
      .sort((a, b) => b.created_at - a.created_at);
  }

  activeTask(): MowingTaskRecord | null {
    const taskId = this.latestTaskBySn.get(this.sn);
    return taskId ? this.tasks.get(taskId) ?? null : null;
  }

  workStatus(): RobotWorkStatus | 'estop' {
    const ctx = this.activeContext;
    if (ctx.state === 'ESTOPPED') return 'estop';
    if (ctx.state === 'ERRORED') return 'error';
    if (ctx.state === 'RECHARGING') return 'charging';
    if (this.activeDomain === 'mapping') {
      if (ctx.state === 'COMPLETED') return 'mapping_completed';
      if (ctx.state === 'IDLE' || ctx.state === 'CANCELLED') return 'idle';
      return 'mapping';
    }
    if (this.activeDomain === 'mowing') {
      if (ctx.state === 'IDLE' || ctx.state === 'COMPLETED' || ctx.state === 'CANCELLED') return 'idle';
      return 'mowing';
    }
    return 'idle';
  }

  shouldStreamMap(): boolean {
    if (this.activeDomain !== 'mapping') return false;
    if (this.mapping.state !== 'WORKING' && this.mapping.state !== 'REMOTE_CONTROL') return false;
    return this.mapping.phase === 'MAP_SCAN_BOUNDARY' ||
      this.mapping.phase === 'MAP_FOLLOW_BOUNDARY' ||
      this.mapping.phase === 'MAP_FOLLOW_BOUNDARY_MANUAL' ||
      this.mapping.phase === 'MAP_COVERAGE_PROBE' ||
      this.mapping.phase === 'MAP_COVERAGE_NEW_AREA' ||
      this.mapping.phase === 'MAP_COVERAGE_RUN';
  }

  buildDeviceInfo(): Record<string, unknown> {
    const status = this.workStatus();
    return {
      deviceId: this.sn,
      name: this.nickname,
      deviceName: this.nickname,
      model: 'Pudu Ratel Mower Simulator',
      status: status === 'idle' ? 'online' : 'working',
      sn: this.sn,
      mac: 'D2:9C:35:EF:D1:04',
      nickname: this.nickname,
      battery_level: this.activeContext.battery || 80,
      running_status: status,
      bound_map_count: 1,
      bt_connected: 1,
      bt_rssi: -55,
      wifi_connected: 1,
      wifi_rssi: -60,
      wifi_signal_strength: 'good',
      cellular_connected: 0,
      cellular_signal_strength: 'weak',
      isConnected: true,
    };
  }

  private createTask(sn: string, taskInfo: Record<string, unknown>): MowingTaskRecord {
    const task: MowingTaskRecord = {
      task_id: createCompactId('mock-task'),
      sn,
      status: 'ON_THE_WAY',
      task_type: 'cloud',
      task_message: '',
      task_error_code: 0,
      mow_area: 0,
      mow_progress: 0,
      estimated_time: 300,
      task_info: taskInfo,
      created_at: Date.now(),
    };
    this.tasks.set(task.task_id, task);
    this.latestTaskBySn.set(sn, task.task_id);
    return task;
  }

  private ensureScenarioMowingTask(event: MowingEvent): void {
    if (event.type !== 'CMD_START' || this.activeTask()) return;
    const taskMode = 'taskMode' in event && typeof event.taskMode === 'string'
      ? event.taskMode
      : 'MOW_GLOBAL';
    this.createTask(this.sn, {
      map_id: 'mock_map_001',
      task_mode: taskMode === 'MOW_REGION' ? 'area' : taskMode === 'MOW_EDGE' ? 'edge' : 'global',
      source: 'scenario',
    });
  }

  private dispatchMapping(event: MappingEvent): void {
    const before = this.snapshot();
    const prev = this.mapping;
    this.mapping = mappingReducer(this.mapping, event);
    this.record('mapping', event);
    const after = this.snapshot();
    this.emitTranscript('mapping', event, before, after, this.mapping !== prev);
    if (this.mapping !== prev) this.emit('changed', after);
  }

  private dispatchMowing(event: MowingEvent): void {
    const before = this.snapshot();
    const prev = this.mowing;
    this.ensureScenarioMowingTask(event);
    this.mowing = mowingReducer(this.mowing, event);
    this.record('mowing', event);
    this.syncActiveTaskFromContext();
    const after = this.snapshot();
    this.emitTranscript('mowing', event, before, after, this.mowing !== prev);
    if (this.mowing !== prev) this.emit('changed', after);
  }

  private syncActiveTaskFromContext(): void {
    const task = this.activeTask();
    if (!task) return;
    switch (this.mowing.state) {
      case 'WORKING':
      case 'RESUMING':
      case 'PREPARING':
      case 'UNDOCKING':
        task.status = 'ON_THE_WAY';
        task.task_message = '';
        break;
      case 'PAUSED':
      case 'REMOTE_CONTROL':
        task.status = 'PAUSE';
        task.task_message = 'Paused by user';
        break;
      case 'COMPLETED':
        task.status = 'COMPLETE';
        task.task_message = task.task_message || 'Mowing complete';
        task.mow_progress = Math.max(task.mow_progress, 100);
        task.estimated_time = 0;
        break;
      case 'CANCELLED':
        task.status = 'CANCEL';
        task.task_message = 'Cancelled by user';
        break;
      case 'ERRORED':
      case 'ESTOPPED':
        task.status = 'FAILED';
        task.task_message = this.mowing.error?.code ?? 'Mowing failed';
        task.task_error_code = -1;
        break;
      default:
        break;
    }
  }

  private record(domain: RobotDomain, event: unknown): void {
    this.events.unshift({
      ts: Date.now(),
      domain,
      event,
      state: this.activeContext.state,
      phase: this.activeContext.phase,
    });
    if (this.events.length > this.maxEvents) this.events.pop();
  }

  private emitTranscript(
    domain: RobotDomain,
    event: unknown,
    before: VirtualRobotSnapshot,
    after: VirtualRobotSnapshot,
    changed: boolean,
  ): void {
    this.emit('transcript', {
      ts: Date.now(),
      domain,
      event,
      before: pickTranscriptSnapshot(before),
      after: pickTranscriptSnapshot(after),
      changed,
    } satisfies VirtualRobotTranscript);
  }
}

function pickTranscriptSnapshot(snapshot: VirtualRobotSnapshot): VirtualRobotTranscript['before'] {
  return {
    activeDomain: snapshot.activeDomain,
    workStatus: snapshot.workStatus,
    state: snapshot.state,
    phase: snapshot.phase,
    mapping: snapshot.mapping,
    mowing: snapshot.mowing,
    activeTask: snapshot.activeTask,
  };
}
