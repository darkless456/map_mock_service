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
} from './fsm-mirror/domain/shared/TaskFSM';
import { buildDeviceInfo as buildDeviceProfile } from './DeviceProfile';
import { EventLog } from './EventLog';
import { MappingTelemetry } from './MappingTelemetry';
import { computeWorkStatus, shouldStreamMapping } from './RobotStatus';
import { withSimulatorDefaults } from './SimulatorDefaults';
import type { RatelNotifyPayload } from './mappingNotify';
import { applyRatelStatusPush, type RatelStatusPushPayload } from './ratelStatusPush';
import type { SimOnlyEvent, SimView } from './simFsmTypes';
import { MappingTaskService } from './task/MappingTaskService';
import { MowingTaskService } from './task/MowingTaskService';
import { RechargeTaskService } from './task/RechargeTaskService';
import { taskModeFromCreateInfo } from './task/taskMode';
import { buildTranscript } from './transcript';
import type {
  AnyTaskEvent,
  MappingTaskRecord,
  MowingTaskRecord,
  RechargeStatusPush,
  RechargeTaskRecord,
  RecordedEvent,
  RobotDomain,
  VirtualRobotOptions,
  VirtualRobotSetup,
  VirtualRobotSnapshot,
  VirtualRobotTranscript,
} from './virtualRobotTypes';
export type {
  AnyTaskEvent,
  MappingTaskRecord,
  MowingTaskRecord,
  NonNullableRobotDomain,
  RechargeStatusPush,
  RechargeTaskRecord,
  RecordedEvent,
  RobotDomain,
  VirtualRobotOptions,
  VirtualRobotSetup,
  VirtualRobotSnapshot,
  VirtualRobotTranscript,
} from './virtualRobotTypes';
export {
  parseRobotDomain,
  requireRobotDomain,
} from './virtualRobotTypes';

function nowEvent<P extends string>(source: 'ws' | 'ble' = 'ws') {
  return { source, ts: Date.now() } as const;
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
  private readonly mappingTelemetry = new MappingTelemetry();
  private readonly eventLog: EventLog;
  private readonly mowingTasks = new MowingTaskService();
  private readonly mappingTaskRecords = new MappingTaskService();
  private readonly rechargeTasks = new RechargeTaskService(
    (payload) => this.emit('rechargeStatus', payload),
    (payload) => { this.pushRatelStatus(payload); },
  );

  constructor(options: VirtualRobotOptions = {}) {
    super();
    this.sn = options.sn || process.env.ROBOT_SN || 'MOCK:00:11:22:33:44';
    this.nickname = options.nickname || 'Mower Dev Simulator';
    const battery = options.battery ?? 80;
    this.mapping = withSimulatorDefaults(initialMappingState, battery);
    this.mowing = withSimulatorDefaults(initialMowingState, battery);
    this.eventLog = new EventLog(options.maxEvents ?? 50);
  }

  get activeContext(): TaskContext<string> {
    if (this.activeDomain === 'mowing') return this.mowing as TaskContext<string>;
    return this.mapping as TaskContext<string>;
  }

  get inLawn(): boolean {
    return this.mappingTelemetry.inLawn;
  }

  get edgeStartAvailable(): boolean {
    return this.mappingTelemetry.edgeStartAvailable;
  }

  get regionCloseable(): boolean {
    return this.mappingTelemetry.regionCloseable;
  }

  get passageCheckpoints() {
    return this.mappingTelemetry.passageCheckpoints;
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
      mappingTasks: this.mappingTaskRecords.list(),
      latestMappingTaskBySn: this.mappingTaskRecords.latestBySnObject(),
      activeMappingTask: this.activeMappingTask(),
      events: this.eventLog.snapshot(),
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
    this.mappingTelemetry.reset();
    this.mowingTasks.clear();
    this.mappingTaskRecords.clear();
    this.rechargeTasks.clear();
    this.record(null, { type: 'SIM_RESET' });
    this.emit('changed', this.snapshot());
  }

  activeRechargeTask(): RechargeTaskRecord | null {
    return this.rechargeTasks.active();
  }

  startRecharge(sn?: string): RechargeTaskRecord {
    if (sn && sn.trim()) this.sn = sn.trim();
    this.activeDomain = 'mowing';
    // 回充会先结束当前割草任务：将割草 FSM 归位到 IDLE，使后续顶层
    // `work_status: return_dock` 能按真实设备链路进入 RETURNING_DOCK。
    this.mowing = withSimulatorDefaults(initialMowingState, this.mowing.battery ?? 80);
    this.lastNotifyWorkStatus = null;
    this.lastNotifySubStatus = null;
    this.mappingTelemetry.reset();
    const task = this.rechargeTasks.start(this.sn);
    this.emit('changed', this.snapshot());
    return task;
  }

  applyRechargeAction(action: string): string | null {
    return this.rechargeTasks.applyAction(action);
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
    this.mappingTelemetry.reset();
    this.pushRatelStatus({ work_status: 'mapping', sub_status: sub });
  }

  /**
   * `POST ratel_mapping_task/create`：新建建图任务记录并触发 FSM `CMD_START`
   * （复用 {@link dispatchMapping} 通路，相位驱动机制不受影响）。
   */
  createMappingTask(input: { sn: string; map_id: string; mode: string }): MappingTaskRecord {
    this.sn = input.sn;
    this.activeDomain = 'mapping';
    const task = this.createMappingTaskRecord(input.sn, input.map_id, input.mode);
    this.dispatchMapping({
      type: 'CMD_START',
      mode: input.mode === 'remote' ? 'remote' : 'auto',
      taskMode: 'MAP_BUILD',
    });
    this.pushRatelStatus({ work_status: 'mapping', sub_status: 'precondition' });
    return task;
  }

  /**
   * `POST ratel_mapping_task/action`（PAUSE/RESUME/STOP）：按 `taskId` 精确寻址，缺省按
   * `latestMappingTaskBySn` 回退；两者都找不到则报错终止（不做静默兜底，对齐建图任务 API
   * 重构方案 §6.2 的“fail fast”要求）。复用既有 `pauseMapping/resumeMapping/dispatchRaw`
   * FSM 派发通路，STOP 的 save=true/false 分别映射为 `CMD_CONFIRM`/`CMD_CANCEL`。
   */
  applyMappingTaskAction(input: { sn: string; taskId?: string; action: string; save?: boolean }): string | null {
    const task = this.mappingTaskRecords.resolve(input.sn, input.taskId);
    if (!task) {
      return input.taskId
        ? `mapping task ${input.taskId} not found`
        : `no active mapping task for sn ${input.sn}`;
    }
    this.sn = input.sn;
    this.activeDomain = 'mapping';
    switch (input.action) {
      case 'PAUSE':
        this.pauseMapping();
        break;
      case 'RESUME':
        this.resumeMapping();
        break;
      case 'STOP':
        this.dispatchRaw({ type: input.save ? 'CMD_CONFIRM' : 'CMD_CANCEL' }, 'mapping');
        break;
      default:
        return `unknown mapping action ${input.action}`;
    }
    return null;
  }

  listMappingTasks(sn?: string): MappingTaskRecord[] {
    return this.mappingTaskRecords.list(sn);
  }

  activeMappingTask(): MappingTaskRecord | null {
    return this.mappingTaskRecords.active(this.sn);
  }

  private createMappingTaskRecord(sn: string, mapId: string, mode: string): MappingTaskRecord {
    return this.mappingTaskRecords.create(sn, mapId, mode);
  }

  /** Mirrors {@link syncActiveTaskFromContext} for the mapping domain (task-level status only). */
  private syncActiveMappingTaskFromContext(): void {
    this.mappingTaskRecords.syncFromContext(this.sn, this.mapping);
  }

  /**
   * Scenario YAML `emit: { type: CMD_START }` bypasses the HTTP create route entirely
   * (see `scenarios/mapping_*.yaml`); mirrors {@link ensureScenarioMowingTask} so those
   * scripts still produce a `task_id`-bearing `MappingTaskRecord` for `RATEL_MAPPING_TASK`
   * pushes and `/sim/state` inspection, without requiring YAML changes.
   */
  private ensureScenarioMappingTask(event: MappingEvent | SimOnlyEvent): void {
    if (event.type !== 'CMD_START' || this.activeMappingTask()) return;
    const mode = 'mode' in event && typeof event.mode === 'string' ? event.mode : 'auto';
    this.createMappingTaskRecord(this.sn, 'mock_map_001', mode);
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
    const task = this.mowingTasks.get(taskId);
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
    return this.mowingTasks.list(sn);
  }

  activeTask(): MowingTaskRecord | null {
    return this.mowingTasks.active(this.sn);
  }

  workStatus(): RobotWorkStatus | 'estop' {
    return computeWorkStatus(this.activeDomain, this.activeContext);
  }

  shouldStreamMap(): boolean {
    return shouldStreamMapping(this.activeDomain, this.mapping);
  }

  buildDeviceInfo(): Record<string, unknown> {
    return buildDeviceProfile({
      sn: this.sn,
      nickname: this.nickname,
      status: this.workStatus(),
      activeContext: this.activeContext,
    });
  }

  private createTask(sn: string, taskInfo: Record<string, unknown>): MowingTaskRecord {
    return this.mowingTasks.create(sn, taskInfo);
  }

  private ensureScenarioMowingTask(event: MowingEvent | SimOnlyEvent): void {
    this.mowingTasks.ensureScenarioTask(this.sn, event);
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
    this.ensureScenarioMappingTask(event);
    this.mapping = mappingReducer(this.mapping, event as MappingEvent);
    this.record('mapping', event);
    this.syncActiveMappingTaskFromContext();
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
    this.mowingTasks.syncFromContext(this.sn, this.mowing);
  }

  private record(domain: RobotDomain, event: unknown): void {
    this.eventLog.record(domain, event, this.activeContext);
  }

  private emitTranscript(
    domain: RobotDomain,
    event: unknown,
    before: VirtualRobotSnapshot,
    after: VirtualRobotSnapshot,
    changed: boolean,
  ): void {
    this.emit('transcript', buildTranscript(domain, event, before, after, changed));
  }
  // ── DVT passage / trajectory helpers (mapping_api_dvt_gap.md 3-4) ──────────

  generateTrajectoryUrl(baseUrl: string): string {
    return this.mappingTelemetry.generateTrajectoryUrl(baseUrl);
  }

  buildTrajectoryBinary(): Buffer {
    return this.mappingTelemetry.buildTrajectoryBinary();
  }

  confirmEdgeStart(): void {
    this.mappingTelemetry.confirmEdgeStart();
    this.pushRatelStatus();
    this.emit('changed', this.snapshot());
  }

  confirmRegionClosure(): void {
    this.mappingTelemetry.confirmRegionClosure();
    this.pushRatelStatus();
    this.emit('changed', this.snapshot());
  }

  recordPassageStart(): void {
    this.mappingTelemetry.recordPassageStart();
    this.emit('changed', this.snapshot());
  }

  updateRobotPosition(x: number, y: number): void {
    this.mappingTelemetry.updateRobotPosition(x, y, this.mapping);
  }

}
