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
  TaskState,
} from './fsm-mirror/domain/shared/TaskFSM';
import { createCompactId } from '../shared/ids';
import type { RatelNotifyPayload } from './mappingNotify';
import { applyRatelStatusPush, type RatelStatusPushPayload } from './ratelStatusPush';
import type { SimCapabilities, SimOnlyEvent, SimTaskNotice, SimTaskState, SimView } from './simFsmTypes';

export type RobotDomain = 'mapping' | 'mowing' | 'mapEdit' | null;

const DEFAULT_SIM_CAPABILITIES: SimCapabilities = {
  canSwitchManual: false,
  canSwitchAuto: false,
};

function withSimulatorDefaults<P extends string>(
  ctx: TaskContext<P>,
  battery: number,
): SimView<P> {
  return {
    ...ctx,
    battery,
    capabilities: DEFAULT_SIM_CAPABILITIES,
    notices: [],
  };
}
export type AnyTaskEvent =
  | TaskEvent<MappingPhase>
  | TaskEvent<MowingPhase>
  | MappingEvent
  | MowingEvent
  | SimOnlyEvent;

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

/**
 * 鍥炲厖锛堝洖妗╋級浠诲姟璁板綍銆備笌鍓茶崏浠诲姟鐩镐簰鐙珛锛圓pp 渚?`rechargeTaskSlice`锛宒ocs 搂12锛夈€? * 鐢?`POST /robot/recharge/task` 鍒涘缓锛學S `cmd: RECHARGE` 鎺ㄩ€?`task_status` 椹卞姩鎸夐挳銆? */
export interface RechargeTaskRecord {
  readonly task_id: string;
  readonly sn: string;
  status: 'ON_THE_WAY' | 'PAUSE' | 'COMPLETE' | 'CANCEL';
  readonly created_at: number;
}

/** WS `cmd: RECHARGE` 鎺ㄩ€?payload锛坄onRechargeStatus`锛夈€?*/
export interface RechargeStatusPush {
  readonly sn: string;
  readonly task_id: string;
  readonly task_status: RechargeTaskRecord['status'];
  readonly remark: string;
}

/** 鍥炴々 `sub_status` 椤哄簭锛堜笌 App `BackendPhaseMapper.RETURN_DOCK_SUB` 瀵归綈锛宒ocs 搂13锛夈€?*/
const RETURN_DOCK_NOTIFY_SEQUENCE: ReadonlyArray<{ readonly atMs: number; readonly subStatus: string }> = [
  { atMs: 0, subStatus: 'go_to_pre_dock_point' },
  { atMs: 3000, subStatus: 'seek_charger_dock' },
  { atMs: 6000, subStatus: 'enter_dock' },
  { atMs: 9000, subStatus: 'at_dock' },
];
/** `at_dock` 鍚庡啀寤惰繜鏀跺彛涓?`work_status: idle`锛堥┍鍔?FSM `RETURNING_DOCK 鈫?COMPLETED`锛夈€?*/
const RETURN_DOCK_IDLE_DELAY_MS = 12000;

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
  readonly notices?: readonly SimTaskNotice[];
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
  /** Set by `POST /robot/self_check`; drives progressive `mapping/check` in mock. */
  mappingPrepareSelfCheckAt: number | null = null;
  mappingCheckPollCount = 0;
  /** Last WS `NOTIFY_RATEL_STATUS` fields (for dedupe + status projection). */
  lastNotifyWorkStatus: string | null = null;
  lastNotifySubStatus: string | null = null;
  /** WS state fields for mapping_api_dvt_gap.md 3 */
  inLawn = false;
  edgeStartAvailable = false;
  regionCloseable = false;
  /** Passage checkpoints for recovery (mapping_api_dvt_gap.md 4) */
  readonly passageCheckpoints: Array<{ start: { x: number; y: number }; end: { x: number; y: number } | null }> = [];
  private lastRobotX = 0;
  private lastRobotY = 0;
  private trajectoryLog: Array<{ x: number; y: number; t: number }> = [];
  private readonly maxEvents: number;
  private readonly events: RecordedEvent[] = [];
  private readonly tasks = new Map<string, MowingTaskRecord>();
  private readonly latestTaskBySn = new Map<string, string>();
  /** 褰撳墠鍥炲厖锛堝洖妗╋級浠诲姟锛堜笌鍓茶崏浠诲姟鐙珛锛宒ocs 搂12 / 搂13锛夈€?*/
  private rechargeTask: RechargeTaskRecord | null = null;
  private rechargeTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(options: VirtualRobotOptions = {}) {
    super();
    this.sn = options.sn || process.env.ROBOT_SN || 'MOCK:00:11:22:33:44';
    this.nickname = options.nickname || 'Mower Dev Simulator';
    const battery = options.battery ?? 80;
    this.mapping = withSimulatorDefaults(initialMappingState, battery);
    this.mowing = withSimulatorDefaults(initialMowingState, battery);
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

  beginMappingPrepareSelfCheck(): void {
    this.mappingPrepareSelfCheckAt = Date.now();
    this.mappingCheckPollCount = 0;
  }

  reset(): void {
    const battery = this.activeContext.battery || 80;
    this.mapping = withSimulatorDefaults(initialMappingState, battery);
    this.mowing = withSimulatorDefaults(initialMowingState, battery);
    this.activeDomain = null;
    this.mappingPrepareSelfCheckAt = null;
    this.mappingCheckPollCount = 0;
    this.lastNotifyWorkStatus = null;
    this.lastNotifySubStatus = null;
    this.inLawn = false;
    this.edgeStartAvailable = false;
    this.regionCloseable = false;
    this.passageCheckpoints.length = 0;
    this.lastRobotX = 0;
    this.lastRobotY = 0;
    this.trajectoryLog = [];
    this.tasks.clear();
    this.latestTaskBySn.clear();
    this.clearRechargeTimers();
    this.rechargeTask = null;
    this.record(null, { type: 'SIM_RESET' });
    this.emit('changed', this.snapshot());
  }

  activeRechargeTask(): RechargeTaskRecord | null {
    return this.rechargeTask;
  }

  /**
   * 瑙﹀彂鍥炲厖锛堝洖妗╋級锛歚POST /robot/recharge/task`銆?   *
   * 缁撴潫褰撳墠鍓茶崏浠诲姟锛堝皢鍓茶崏 FSM 褰掍綅鍒?IDLE锛夛紝鍒涘缓鍥炲厖浠诲姟骞舵帹 `RECHARGE: ON_THE_WAY`锛?   * 闅忓悗鎸?{@link RETURN_DOCK_NOTIFY_SEQUENCE} 閫愭鎺ㄩ€?`work_status: return_dock` 鐨?   * `sub_status`锛屾渶缁?`work_status: idle` 鏀跺彛锛堥┍鍔?App FSM `RETURNING_DOCK 鈫?COMPLETED`銆?   * 闈㈡澘鏄剧ず銆屽洖妗╀腑銆嶏級銆?   */
  startRecharge(sn?: string): RechargeTaskRecord {
    if (sn && sn.trim()) this.sn = sn.trim();
    this.activeDomain = 'mowing';
    this.clearRechargeTimers();
    // 回充会先结束当前割草任务：将割草 FSM 归位到 IDLE，使后续顶层
    // `work_status: return_dock` 能按真实设备链路进入 RETURNING_DOCK。
    this.mowing = withSimulatorDefaults(initialMowingState, this.mowing.battery ?? 80);
    this.lastNotifyWorkStatus = null;
    this.lastNotifySubStatus = null;
    this.inLawn = false;
    this.edgeStartAvailable = false;
    this.regionCloseable = false;
    this.passageCheckpoints.length = 0;
    this.lastRobotX = 0;
    this.lastRobotY = 0;
    this.trajectoryLog = [];
    const task: RechargeTaskRecord = {
      task_id: createCompactId('mock-recharge'),
      sn: this.sn,
      status: 'ON_THE_WAY',
      created_at: Date.now(),
    };
    this.rechargeTask = task;
    this.emitRechargeStatus();
    this.scheduleReturnDockSequence();
    this.emit('changed', this.snapshot());
    return task;
  }

  /** 鍥炲厖浠诲姟鍔ㄤ綔锛歚POST /robot/recharge/action`锛圥AUSE / RESUME / CANCEL锛夈€?*/
  applyRechargeAction(action: string): string | null {
    const task = this.rechargeTask;
    if (!task) return 'no active recharge task';
    switch (action) {
      case 'PAUSE':
        task.status = 'PAUSE';
        break;
      case 'RESUME':
        task.status = 'ON_THE_WAY';
        break;
      case 'CANCEL':
        task.status = 'CANCEL';
        this.clearRechargeTimers();
        break;
      default:
        return `unknown recharge action ${action}`;
    }
    this.emitRechargeStatus();
    return null;
  }

  private emitRechargeStatus(): void {
    if (!this.rechargeTask) return;
    this.emit('rechargeStatus', {
      sn: this.rechargeTask.sn,
      task_id: this.rechargeTask.task_id,
      task_status: this.rechargeTask.status,
      remark: '',
    } satisfies RechargeStatusPush);
  }

  private scheduleReturnDockSequence(): void {
    for (const step of RETURN_DOCK_NOTIFY_SEQUENCE) {
      this.scheduleRechargeStep(step.atMs, () => {
        this.pushRatelStatus({ work_status: 'return_dock', sub_status: step.subStatus });
        if (step.subStatus === 'at_dock' && this.rechargeTask) {
          this.rechargeTask.status = 'COMPLETE';
          this.emitRechargeStatus();
        }
      });
    }
    this.scheduleRechargeStep(RETURN_DOCK_IDLE_DELAY_MS, () => {
      this.pushRatelStatus({ work_status: 'idle', sub_status: 'none' });
    });
  }

  private scheduleRechargeStep(atMs: number, run: () => void): void {
    const handle = setTimeout(() => {
      // 宸插彇娑堢殑鍥炲厖浠诲姟涓嶅啀鎺ㄨ繘鍥炴々搴忓垪銆?      if (!this.rechargeTask || this.rechargeTask.status === 'CANCEL') return;
      run();
    }, atMs);
    // 涓嶉樆濉炶繘绋嬮€€鍑猴紙娴嬭瘯 / 浼橀泤鍏抽棴锛夈€?    (handle as { unref?: () => void }).unref?.();
    this.rechargeTimers.push(handle);
  }

  private clearRechargeTimers(): void {
    for (const handle of this.rechargeTimers) clearTimeout(handle);
    this.rechargeTimers = [];
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
    const target = (domain === 'mowing' ? this.mowing : this.mapping) as SimView<string>;
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
    // SimView 鍒绘剰涓庨暅鍍?TaskContext 鐨?notices 妯″瀷涓嶅悓锛堣 simFsmTypes锛夛紝
    // 姝ゅ涓洪€傞厤灞傝竟鐣岋紝缁?unknown 杞崲瀛樺洖銆?
    if (domain === 'mowing') this.mowing = next as unknown as MowingContext;
    else this.mapping = next as unknown as MappingContext;
    this.record(domain, { type: 'SIM_SETUP', setup });
    this.emit('changed', this.snapshot());
  }

  startMapping(input: { sn?: string; mode?: 'auto' | 'remote' | string; map_id?: string } = {}): void {
    if (input.sn) this.sn = input.sn;
    this.activeDomain = 'mapping';
    const mode = input.mode === 'remote' ? 'remote' : 'auto';
    this.dispatchMapping({ type: 'CMD_START', mode, taskMode: 'MAP_BUILD' });
  }

  pauseMapping(): void {
    this.dispatchMapping({ type: 'CMD_PAUSE' });
  }

  /**
   * 鎭㈠寤哄浘锛氫笌鍓茶崏 `applyMowingAction('RESUME')` 瀵圭О銆傚厛椹卞姩 mock FSM `CMD_RESUME`锛?   * 鍐?*琛ユ帹涓€甯?`work_status: mapping` 鎭㈠纭**鈥斺€斾簯绔棤銆屽凡鎭㈠銆嶈澶囨€侊紝App 渚?   * `RESUMING` 闇€闈犳椿璺冪姸鎬佹帹閫佽蛋鍑猴紙瑙?mower `build-docs/pause_resume_contract_design.md`
   * 搂3.1/搂3.5锛夈€傞噸缃?notify 鍘婚噸锛岀‘淇濆嵆浣?sub_status 鏈彉涔熻兘骞挎挱璇ョ‘璁ゅ抚銆?   */
  resumeMapping(): void {
    this.dispatchMapping({ type: 'CMD_RESUME' });
    const sub = this.lastNotifySubStatus ?? 'none';
    this.lastNotifyWorkStatus = null;
    this.lastNotifySubStatus = null;
    this.inLawn = false;
    this.edgeStartAvailable = false;
    this.regionCloseable = false;
    this.passageCheckpoints.length = 0;
    this.lastRobotX = 0;
    this.lastRobotY = 0;
    this.trajectoryLog = [];
    this.pushRatelStatus({ work_status: 'mapping', sub_status: sub });
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
    const mowingSub =
      taskModeFromCreateInfo(input.task_info) === 'MOW_EDGE' ? 'edge' : 'mowing';
    this.pushRatelStatus({ work_status: 'mowing', sub_status: 'map_check' });
    this.pushRatelStatus({ work_status: 'mowing', sub_status: 'leave_dock' });
    this.pushRatelStatus({ work_status: 'mowing', sub_status: mowingSub });
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
        this.pushRatelStatus({
          work_status: 'mowing',
          sub_status: task.task_info.task_mode === 'edge' ? 'edge' : 'mowing',
        });
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
    if ((event as { type?: string }).type === 'CMD_RESET') {
      this.lastNotifyWorkStatus = null;
      this.lastNotifySubStatus = null;
    }
    if (domain === 'mowing') this.dispatchMowing(event as MowingEvent | SimOnlyEvent);
    else this.dispatchMapping(event as MappingEvent | SimOnlyEvent);
  }

  /** Used by {@link applyRatelStatusPush} and scenario `emit`. */
  dispatchMappingEvent(event: MappingEvent): void {
    if (event.type === 'CMD_RESET') {
      this.lastNotifyWorkStatus = null;
      this.lastNotifySubStatus = null;
    }
    this.dispatchMapping(event);
  }

  /** Used by {@link applyRatelStatusPush} for mowing-domain notify. */
  dispatchMowingEvent(event: MowingEvent): void {
    if (event.type === 'CMD_RESET') {
      this.lastNotifyWorkStatus = null;
      this.lastNotifySubStatus = null;
    }
    this.dispatchMowing(event);
  }

  /**
   * Simulates cloud `NOTIFY_RATEL_STATUS`: updates mock FSM and emits `ratelStatus` for WS broadcast.
   * @returns false when `(work_status, sub_status)` unchanged (deduped).
   */
  pushRatelStatus(payload: RatelNotifyPayload = {}): boolean {
    const applied = applyRatelStatusPush(this, payload);
    if (!applied) return false;
    this.emit('ratelStatus', applied);
    return true;
  }

  /** @deprecated Use {@link pushRatelStatus} */
  dispatchRatelNotify(payload: RatelNotifyPayload): void {
    this.pushRatelStatus(payload);
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
    if ((ctx.state as SimTaskState) === 'ESTOPPED') return 'estop';
    if (ctx.state === 'ERRORED') return 'error';
    if (ctx.state === 'RECHARGING') return 'charging';
    if (this.activeDomain === 'mapping') {
      if (ctx.state === 'COMPLETED') return 'mapping_completed';
      if (ctx.state === 'IDLE' || ctx.state === 'CANCELLED') return 'idle';
      return 'mapping';
    }
    if (this.activeDomain === 'mowing') {
      if (ctx.state === 'IDLE' || ctx.state === 'COMPLETED' || ctx.state === 'CANCELLED') return 'idle';
      if (ctx.state === 'RETURNING_DOCK') return 'return_dock';
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
      cellular_connected: -1,
      cellular_signal_strength: 'none',
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

  private ensureScenarioMowingTask(event: MowingEvent | SimOnlyEvent): void {
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

  /**
   * 浠讳綍鏉ユ簮锛圵eb 闈㈡澘 / App API / 鍦烘櫙鑴氭湰锛変笅鍙戠殑鏆傚仠 / 鎭㈠鎸囦护閮戒細缁忚繃
   * dispatchMapping / dispatchMowing銆傝繖閲屽湪鐘舵€佹満澶勭悊鍓嶇粺涓€骞挎挱鎺у埗鎰忓浘锛?   * 渚?{@link ScenarioEngine} 鎹鏆傚仠 / 鎭㈠鑴氭湰寰幆锛堣€屼笉浠呬粎鏄満鍣ㄤ汉 FSM锛夈€?   * 鍗充娇褰撳墠 FSM 鐘舵€佷笉鎺ュ彈璇ユ寚浠わ紙reducer 鏈敼鍙樼姸鎬侊級锛屾剰鍥句粛浼氬箍鎾紝
   * 淇濊瘉璋冭瘯鏃舵殏鍋滃缁堢敓鏁堛€?   */
  private emitControlIntent(event: { readonly type?: string }): void {
    if (event.type === 'CMD_PAUSE') this.emit('controlPause');
    else if (event.type === 'CMD_RESUME') this.emit('controlResume');
  }

  private dispatchMapping(event: MappingEvent | SimOnlyEvent): void {
    this.emitControlIntent(event as { type?: string });
    const before = this.snapshot();
    const prev = this.mapping;
    this.mapping = mappingReducer(this.mapping, event as MappingEvent);
    this.record('mapping', event);
    const after = this.snapshot();
    this.emitTranscript('mapping', event, before, after, this.mapping !== prev);
    if (this.mapping !== prev) this.emit('changed', after);
  }

  private dispatchMowing(event: MowingEvent | SimOnlyEvent): void {
    this.emitControlIntent(event as { type?: string });
    const before = this.snapshot();
    const prev = this.mowing;
    this.ensureScenarioMowingTask(event);
    this.mowing = mowingReducer(this.mowing, event as MowingEvent);
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
  // ── DVT passage / trajectory helpers (mapping_api_dvt_gap.md 3-4) ──────────

  generateTrajectoryUrl(baseUrl: string): string {
    return `${baseUrl}/sim/assets/mapping_trajectory.bin`;
  }

  buildTrajectoryBinary(): Buffer {
    if (this.trajectoryLog.length === 0) {
      // Return minimal mock trajectory: a straight line of 10 points
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        pts.push(i * 0.5 + this.lastRobotX * 0.2, i * 0.3 + this.lastRobotY * 0.2, i * 150);
      }
      return Buffer.from(new Float32Array(pts).buffer);
    }
    // Build binary from log: [x, y, t] f32 triplets
    const flat: number[] = [];
    for (const pt of this.trajectoryLog.slice(-5000)) {
      flat.push(pt.x, pt.y, pt.t);
    }
    return Buffer.from(new Float32Array(flat).buffer);
  }

  confirmEdgeStart(): void {
    this.edgeStartAvailable = false;
    // Record passage end point
    this.recordPassageEnd();
    // Push updated WS state
    this.pushRatelStatus();
    this.emit('changed', this.snapshot());
  }

  confirmRegionClosure(): void {
    this.regionCloseable = false;
    this.pushRatelStatus();
    this.emit('changed', this.snapshot());
  }

  recordPassageStart(): void {
    const start = { x: this.lastRobotX, y: this.lastRobotY };
    this.passageCheckpoints.push({ start, end: null });
    this.emit('changed', this.snapshot());
  }

  private recordPassageEnd(): void {
    const last = this.passageCheckpoints[this.passageCheckpoints.length - 1];
    if (last && !last.end) {
      last.end = { x: this.lastRobotX, y: this.lastRobotY };
    }
  }

  updateRobotPosition(x: number, y: number): void {
    this.lastRobotX = x;
    this.lastRobotY = y;
    this.trajectoryLog.push({ x, y, t: Date.now() });
    // Auto-detect: in lawn when position is within a simulated lawn region
    this.inLawn = x > 3 && x < 20 && y > -15 && y < -2;
    // edge_start_available when in lawn and remote mode
    this.edgeStartAvailable = this.inLawn && this.mapping.mode === 'remote' && this.mapping.state === 'REMOTE_CONTROL';
    // region_closeable when near start point
    if (this.trajectoryLog.length > 20) {
      const first = this.trajectoryLog[0];
      const dx = x - first.x;
      const dy = y - first.y;
      this.regionCloseable = Math.sqrt(dx * dx + dy * dy) < 1.0;
    }
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



