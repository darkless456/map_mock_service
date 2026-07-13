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
import { MappingLabelsTracker } from './MappingLabels';
import { buildExtendStatus } from './MappingProtocolSnapshot';
import { MappingTelemetry } from './MappingTelemetry';
import { computeWorkStatus, shouldStreamMapping } from './RobotStatus';
import {
  EXPAND_AREA_DATASET,
  EXPAND_AREA_MAX_LAWNS,
  MAP_COMPLETING_DURATION_MS,
  MAPPING_ACTION_ACK_DELAY_MS,
  withSimulatorDefaults,
} from './SimulatorDefaults';
import type { RatelNotifyPayload } from './mappingNotify';
import { applyRatelStatusPush, type RatelStatusPushPayload } from './ratelStatusPush';
import { deriveSubStatus } from './pushChannels';
import type { SimOnlyEvent, SimView } from './simFsmTypes';
import { MappingTaskService } from './task/MappingTaskService';
import { MowingTaskService } from './task/MowingTaskService';
import { RechargeTaskService } from './task/RechargeTaskService';
import { taskModeFromCreateInfo } from './task/taskMode';
import { buildTranscript } from './transcript';
import type {
  AnyTaskEvent,
  MappingActionDeps,
  MappingActionError,
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
  MappingActionDeps,
  MappingActionError,
  MappingActionErrorKind,
  MappingDatasetSwitchResult,
  MappingDatasetSwitcher,
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
  /** ms epoch the current `lastNotifySubStatus` value was entered (mapping-v4-final-spec.md §2). */
  lastNotifySubStatusEnteredAt: number | null = null;
  private readonly mappingTelemetry = new MappingTelemetry(() => this.emit('changed', this.snapshot()));
  private readonly mappingLabels = new MappingLabelsTracker();
  /** Pending async device-ack timers scheduled by EDGE_START/EDGE_CLOSE (cleared on reset). */
  private readonly mappingActionTimers: Array<ReturnType<typeof setTimeout>> = [];
  /** A device action has been accepted and is awaiting its authoritative status push. */
  private pendingMappingAction: 'EDGE_START' | 'EDGE_CLOSE' | null = null;
  /** `MAP_COMPLETING` 120s auto-COMPLETE countdown (mapping-v4-final-spec.md §3). */
  private mapCompletingTimer: ReturnType<typeof setTimeout> | null = null;
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

  get legitimateStartingPoint(): boolean {
    return this.mappingTelemetry.legitimateStartingPoint;
  }

  get legitimateEndPoint(): boolean {
    return this.mappingTelemetry.legitimateEndPoint;
  }

  /** `ratel_map/labels` accumulated state (mapping-v4-final-spec.md §6). */
  mappingLabelsList() {
    return this.mappingLabels.list();
  }

  mappingLawnCount(): number {
    return this.mappingLabels.edgeStartCount();
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
      // §6.7(3) P5b 改进 3: surface last-notify projection so the panel metric
      // card reads live sub_status instead of a stale 'none'.
      lastNotifyWorkStatus: this.lastNotifyWorkStatus,
      lastNotifySubStatus: this.lastNotifySubStatus,
      lastNotifySubStatusEnteredAt: this.lastNotifySubStatusEnteredAt,
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
    this.lastNotifySubStatusEnteredAt = null;
    this.mappingTelemetry.reset();
    this.mappingLabels.reset();
    this.clearMappingActionTimers();
    this.clearMapCompletingCountdown();
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
    this.lastNotifySubStatusEnteredAt = null;
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
    // SimView 刻意与镜像 TaskContext 的 notices 模型不同（见 simFsmTypes），
    // 此处为适配层边界，给 unknown 转换存回。
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
   * 恢复建图：与割草 `applyMowingAction('RESUME')` 对称。先驱动 mock FSM `CMD_RESUME`，
   * 再*补推一帧 `work_status: mapping` 恢复确认**——云端无「已恢复」设备态，App 的
   * `RESUMING` 需靠活跃状态推送走出（见 mower `build-docs/pause_resume_contract_design.md`
   * §3.1/§3.5）。重置 notify 去重，确保即便 sub_status 未变也能广播该确认帧。
   */
  resumeMapping(): void {
    this.dispatchMapping({ type: 'CMD_RESUME' });
    const sub = this.lastNotifySubStatus ?? 'none';
    // Force a resume-confirmation push without changing the time the current phase began.
    this.lastNotifyWorkStatus = null;
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
    this.mappingLabels.reset();
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
   * `POST ratel_mapping_task/action`（PAUSE/RESUME/STOP/EDGE_START/EDGE_CLOSE）：按 `taskId`
   * 精确寻址，缺省按 `latestMappingTaskBySn` 回退；两者都找不到则报错终止（不做静默兜底，
   * 对齐建图任务 API 重构方案 §6.2 的"fail fast"要求）。复用既有 `pauseMapping/resumeMapping/
   * dispatchRaw` FSM 派发通路，STOP 的 save=true/false 分别映射为 `CMD_CONFIRM`/`CMD_CANCEL`。
   * EDGE_START/EDGE_CLOSE 见 mapping-v4-final-spec.md §1：只校验并消费 legitimate_* 信号，
   * 不在此同步切相位——权威过渡由 {@link scheduleMappingActionAck} 异步补推的 NOTIFY 承担。
   */
  applyMappingTaskAction(
    input: { sn: string; taskId?: string; action: string; save?: boolean },
    deps?: MappingActionDeps,
  ): MappingActionError | null {
    const task = this.mappingTaskRecords.resolve(input.sn, input.taskId);
    if (!task) {
      return {
        kind: 'not_found',
        message: input.taskId
          ? `mapping task ${input.taskId} not found`
          : `no active mapping task for sn ${input.sn}`,
      };
    }
    this.sn = input.sn;
    this.activeDomain = 'mapping';
    switch (input.action) {
      case 'PAUSE':
        this.pauseMapping();
        return null;
      case 'RESUME':
        this.resumeMapping();
        return null;
      case 'STOP':
        this.clearMappingActionTimers();
        this.dispatchRaw({ type: input.save ? 'CMD_CONFIRM' : 'CMD_CANCEL' }, 'mapping');
        return null;
      case 'EDGE_START':
        return this.applyEdgeStartAction(task);
      case 'EDGE_CLOSE':
        return this.applyEdgeCloseAction(task);
      case 'COMPLETE':
        return this.applyCompleteAction(task);
      case 'EXPAND_AREA':
        return this.applyExpandAreaAction(task, deps);
      default:
        return { kind: 'conflict', message: `unknown mapping action ${input.action}` };
    }
  }

  private applyEdgeStartAction(task: MappingTaskRecord): MappingActionError | null {
    const busy = this.mappingActionBusyError(task);
    if (busy) return busy;
    if (this.mapping.phase !== 'MAP_SCAN_BOUNDARY') {
      return { kind: 'conflict', message: `EDGE_START not allowed in phase ${this.mapping.phase ?? 'null'}` };
    }
    if (!this.legitimateStartingPoint) {
      return { kind: 'unprocessable', message: 'extend_status.legitimate_starting_point is 0' };
    }
    this.mappingTelemetry.confirmEdgeStart();
    this.scheduleMappingActionAck('EDGE_START', () => this.pushRatelStatus({ work_status: 'mapping', sub_status: 'edge_mapping' }));
    return null;
  }

  private applyEdgeCloseAction(task: MappingTaskRecord): MappingActionError | null {
    const busy = this.mappingActionBusyError(task);
    if (busy) return busy;
    if (this.mapping.phase !== 'MAP_FOLLOW_BOUNDARY' && this.mapping.phase !== 'MAP_FOLLOW_BOUNDARY_MANUAL') {
      return { kind: 'conflict', message: `EDGE_CLOSE not allowed in phase ${this.mapping.phase ?? 'null'}` };
    }
    if (!this.legitimateEndPoint) {
      return { kind: 'unprocessable', message: 'extend_status.legitimate_end_point is 0' };
    }
    this.mappingTelemetry.confirmRegionClosure();
    this.scheduleMappingActionAck('EDGE_CLOSE', () => this.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_edge_finish' }));
    return null;
  }

  /**
   * `COMPLETE`（mapping-v4-final-spec.md §1）：仅在 `sub_status === 'map_completing'` 时受理，
   * 中断 120s 倒计时并立即触发 `CMD_CONFIRM`（此 action 语义本身即"立即生效"，不走异步 ack）。
   * 重复调用会在第二次因 `task.status` 已不是 `ON_THE_WAY` 而落入 {@link mappingActionBusyError}
   * 的 409，不需要额外的去重状态。
   */
  private applyCompleteAction(task: MappingTaskRecord): MappingActionError | null {
    const busy = this.mappingActionBusyError(task);
    if (busy) return busy;
    if (this.lastNotifySubStatus !== 'map_completing') {
      return {
        kind: 'conflict',
        message: `COMPLETE not allowed outside MAP_COMPLETING (sub_status=${this.lastNotifySubStatus ?? 'none'})`,
      };
    }
    this.clearMapCompletingCountdown();
    this.dispatchRaw({ type: 'CMD_CONFIRM' }, 'mapping');
    return null;
  }

  /**
   * `EXPAND_AREA`（mapping-v4-final-spec.md §7）：同 `COMPLETE` 只在 `sub_status ===
   * 'map_completing'` 时受理，但效果立即生效（规格明确此 action 不走异步 ack）——切数据集、
   * 中断倒计时、把 `sub_status` 推成 `find_boundary`。通过 {@link pushRatelStatus} 走与首块
   * 草坪完全相同的 NOTIFY 路径，使 `onMappingPhaseChanged` 的既有钩子自然完成 §7 步骤 4/5
   * （`legitimate_starting_point` 复位 + 追加新 `aisle` label），无需在此重复实现。
   */
  private applyExpandAreaAction(task: MappingTaskRecord, deps?: MappingActionDeps): MappingActionError | null {
    const busy = this.mappingActionBusyError(task);
    if (busy) return busy;
    if (this.lastNotifySubStatus !== 'map_completing') {
      return {
        kind: 'conflict',
        message: `EXPAND_AREA not allowed outside MAP_COMPLETING (sub_status=${this.lastNotifySubStatus ?? 'none'})`,
      };
    }
    if (this.mappingLawnCount() >= EXPAND_AREA_MAX_LAWNS) {
      return { kind: 'conflict', message: `lawn count limit reached (>= ${EXPAND_AREA_MAX_LAWNS})` };
    }
    if (!deps?.switchDataset) {
      return { kind: 'conflict', message: 'switchDataset dependency not configured' };
    }
    const switched = deps.switchDataset(EXPAND_AREA_DATASET);
    if (!switched.ok) {
      return { kind: 'conflict', message: switched.error ?? `failed to switch dataset ${EXPAND_AREA_DATASET}` };
    }
    this.clearMapCompletingCountdown();
    this.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
    return null;
  }

  private mappingActionBusyError(task: MappingTaskRecord): MappingActionError | null {
    if (task.status !== 'ON_THE_WAY') {
      return { kind: 'conflict', message: `mapping task ${task.task_id} is not active (status=${task.status})` };
    }
    if (this.pendingMappingAction) {
      return { kind: 'conflict', message: `${this.pendingMappingAction} is awaiting device acknowledgement` };
    }
    return null;
  }

  /** Simulates the device's asynchronous ack for EDGE_START/EDGE_CLOSE (see class doc above). */
  private scheduleMappingActionAck(action: 'EDGE_START' | 'EDGE_CLOSE', effect: () => void): void {
    this.pendingMappingAction = action;
    const timer = setTimeout(() => {
      this.pendingMappingAction = null;
      effect();
    }, MAPPING_ACTION_ACK_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
    this.mappingActionTimers.push(timer);
  }

  private clearMappingActionTimers(): void {
    for (const timer of this.mappingActionTimers.splice(0)) clearTimeout(timer);
    this.pendingMappingAction = null;
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
      this.lastNotifySubStatusEnteredAt = null;
    }
    if (domain === 'mowing') this.dispatchMowing(event as MowingEvent | SimOnlyEvent);
    else this.dispatchMapping(event as MappingEvent | SimOnlyEvent);
  }

  /** Used by {@link applyRatelStatusPush} and scenario `emit`. */
  dispatchMappingEvent(event: MappingEvent): void {
    if (event.type === 'CMD_RESET') {
      this.lastNotifyWorkStatus = null;
      this.lastNotifySubStatus = null;
      this.lastNotifySubStatusEnteredAt = null;
    }
    this.dispatchMapping(event);
  }

  /** Used by {@link applyRatelStatusPush} for mowing-domain notify. */
  dispatchMowingEvent(event: MowingEvent): void {
    if (event.type === 'CMD_RESET') {
      this.lastNotifyWorkStatus = null;
      this.lastNotifySubStatus = null;
      this.lastNotifySubStatusEnteredAt = null;
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
      subStatus: this.lastNotifySubStatus ?? deriveSubStatus(this),
      subStatusEnteredAt: this.lastNotifySubStatusEnteredAt,
      extendStatus: buildExtendStatus(this),
    });
  }

  private createTask(sn: string, taskInfo: Record<string, unknown>): MowingTaskRecord {
    return this.mowingTasks.create(sn, taskInfo);
  }

  private ensureScenarioMowingTask(event: MowingEvent | SimOnlyEvent): void {
    this.mowingTasks.ensureScenarioTask(this.sn, event);
  }

  /**
   * 任何来源（Web 面板 / App API / 场景脚本）下发的暂停 / 恢复指令都会经过
   * dispatchMapping / dispatchMowing。这里在状态机处理前统一广播控制意图，
   * 供 {@link ScenarioEngine} 据此暂停 / 恢复脚本循环（而不仅仅是机器人 FSM）。
   * 即使当前 FSM 状态不接受该指令（reducer 未改变状态），意图仍会广播，
   * 保证调试时暂停始终生效。
   */
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
    if (this.mapping.phase !== prev.phase) this.onMappingPhaseChanged(prev.phase, this.mapping.phase);
    const after = this.snapshot();
    this.emitTranscript('mapping', event, before, after, this.mapping !== prev);
    if (this.mapping !== prev) this.emit('changed', after);
  }

  /**
   * mapping-v4-final-spec.md §5/§6: `edge_start`/`aisle` labels accumulate off real FSM
   * phase transitions (not `applySetup`, which is a raw test-only state override).
   */
  private onMappingPhaseChanged(from: MappingPhase | null, to: MappingPhase | null): void {
    this.mappingTelemetry.syncWithPhase(to);
    if (to === 'MAP_SCAN_BOUNDARY' && from !== 'MAP_SCAN_BOUNDARY') {
      this.mappingLabels.addAisle();
    } else if (to === 'MAP_BOUNDARY_DONE' && from !== 'MAP_BOUNDARY_DONE') {
      this.mappingLabels.addEdgeStart();
    }
    if (to === 'MAP_COMPLETING' && from !== 'MAP_COMPLETING') {
      this.armMapCompletingCountdown();
    } else if (from === 'MAP_COMPLETING' && to !== 'MAP_COMPLETING') {
      this.clearMapCompletingCountdown();
    }
  }

  /**
   * mapping-v4-final-spec.md §3: 120s after entering `MAP_COMPLETING`, auto-behave as if the
   * user tapped `COMPLETE`. `CMD_CONFIRM` at `MAP_COMPLETING` does not change `phase` (only
   * `state` → `COMPLETED`), so this does not re-trigger {@link onMappingPhaseChanged}.
   */
  private armMapCompletingCountdown(): void {
    this.clearMapCompletingCountdown();
    this.mapCompletingTimer = setTimeout(() => {
      this.mapCompletingTimer = null;
      this.dispatchRaw({ type: 'CMD_CONFIRM' }, 'mapping');
    }, MAP_COMPLETING_DURATION_MS);
    (this.mapCompletingTimer as { unref?: () => void }).unref?.();
  }

  private clearMapCompletingCountdown(): void {
    if (this.mapCompletingTimer) {
      clearTimeout(this.mapCompletingTimer);
      this.mapCompletingTimer = null;
    }
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
}
