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
import { MappingTrackHistory, type TrackPoint, type TrackQueryParams, type TrackQueryScenario } from './MappingTrackHistory';
import { computeWorkStatus, shouldStreamMapping } from './RobotStatus';
import {
  EXPAND_AREA_DATASET,
  EXPAND_AREA_MAX_LAWNS,
  MANUAL_SCAN_START_GATE_REQUIRED,
  MAP_COMPLETING_DURATION_MS,
  MAPPING_ACTION_ACK_DELAY_MS,
  MAPPING_EXTEND_FIND_BOUNDARY_DELAY_MS,
  MAPPING_EXTEND_UNDOCK_DELAY_MS,
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
  private readonly trackHistory = new MappingTrackHistory();
  /** Pending async device-ack timers scheduled by EDGE_START/EDGE_CLOSE (cleared on reset). */
  private readonly mappingActionTimers: Array<ReturnType<typeof setTimeout>> = [];
  /** A device action has been accepted and is awaiting its authoritative status push. */
  private pendingMappingAction: 'EDGE_START' | 'EDGE_CLOSE' | null = null;
  /** `MAP_COMPLETING` 120s auto-COMPLETE countdown (mapping-v4-final-spec.md §3). */
  private mapCompletingTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 等待窗口的起始时刻（ms epoch），即 {@link armMapCompletingCountdown} 被调用的那一刻。
   * `null` = 当前不在等待窗口里。对外经 `extend_status.wait_extend_timestamp` 暴露，App
   * 用它作为完成页倒计时的锚点（不再用「最后一次事件到达时刻」）——所以它必须与本类真正
   * 用来 auto-COMPLETE 的那个 timer 同源，否则 Mock 自己归零和 App 显示归零会对不上。
   */
  private mapCompletingStartedAt: number | null = null;
  /**
   * 地图上传段的模拟状态（mower 方案文档 §5.3）。
   *
   * 此前 Mock 从 `expand_area` 一步跳到 `idle`，**整个上传段在 Mock 上不可达**，
   * 上传页/失败页/重试都没法联调。现在 COMPLETE 会先进入 `upload_map`，
   * 按 {@link UPLOAD_STEP_MS} 步进推进度，到 100 才收尾。
   *
   * `uploadFailAt` 由场景注入：进度到达该值时推失败态并**停在 `upload_map` 不转 idle**
   * ——这正是 [决议-1] 承诺的真机行为，失败页的可达性依赖它。
   */
  private uploadProgress = 0;
  private uploadStatus: 0 | 1 | 2 | 3 = 0;
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;
  /** `null` = 不注入失败；数值 = 进度达到它时转失败态。 */
  uploadFailAt: number | null = null;
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

  /** `location/track/query` synthetic history + fault scenario (design §8 / §19.5). */
  trackQueryScenario(): Readonly<TrackQueryScenario> {
    return this.trackHistory.scenario();
  }

  setTrackQueryScenario(next: Partial<TrackQueryScenario>): TrackQueryScenario {
    return this.trackHistory.setScenario(next);
  }

  trackQuery(params: TrackQueryParams): TrackPoint[] {
    return this.trackHistory.query(params);
  }

  /** Force the active mapping task terminal (design §19.5 item 3); see MappingTaskService.forceStatus. */
  forceMappingTaskStatus(
    status: MappingTaskRecord['status'],
    opts: { ageMs?: number; mapId?: string; mode?: string; message?: string; errorCode?: number } = {},
  ): MappingTaskRecord {
    return this.mappingTaskRecords.forceStatus(this.sn, status, opts);
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
    this.trackHistory.reset();
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
  createMappingTask(
    input: { sn: string; map_id: string; mode: string },
    deps?: MappingActionDeps,
  ): { task?: MappingTaskRecord; error?: MappingActionError } {
    // mode='extend'（v9 新增）= 在既有地图上扩展建图，走 {@link startExtendMapping}：
    // 不重置 mappingLabels、复用传入的 map_id，其余（含返回 task_id）与普通 create 一致。
    if (input.mode === 'extend') {
      return this.startExtendMapping({ sn: input.sn, mapId: input.map_id }, deps);
    }
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
    return { task };
  }

  /**
   * `POST ratel_mapping_task/action`（PAUSE/RESUME/STOP/EDGE_START/EDGE_CLOSE）：按 `taskId`
   * 精确寻址，缺省按 `latestMappingTaskBySn` 回退；两者都找不到则报错终止（不做静默兜底，
   * 对齐建图任务 API 重构方案 §6.2 的"fail fast"要求）。复用既有 `pauseMapping/resumeMapping/
   * dispatchRaw` FSM 派发通路，CANCEL 的 save=true/false 分别映射为 `CMD_CONFIRM`/`CMD_CANCEL`。
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
      case 'CANCEL':
        this.clearMappingActionTimers();
        this.dispatchRaw({ type: input.save ? 'CMD_CONFIRM' : 'CMD_CANCEL' }, 'mapping');
        return null;
      case 'EDGE_START':
        return this.applyEdgeStartAction(task);
      case 'EDGE_CLOSE':
        return this.applyEdgeCloseAction(task);
      // [占位] 云端未定义该 action，与 mower 侧 `MappingTaskAction` 同步的占位名。
      case 'RETRY_UPLOAD_MAP':
        return this.retryMapUpload();
      case 'EXPAND_AREA_FINISH':
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
    if (this.mapping.phase !== 'MAP_SCAN_BOUNDARY_MANUAL') {
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
   * `EXPAND_AREA_FINISH`（mapping-v4-final-spec.md §1，权威名见 MappingTaskBridge 顶部注释）：
   * 仅在 `sub_status === 'expand_area'` 时受理，
   * 中断 120s 倒计时并进入上传段（此 action 语义本身即"立即生效"，不走异步 ack）。
   * 重复调用会在第二次因 `task.status` 已不是 `ON_THE_WAY` 而落入 {@link mappingActionBusyError}
   * 的 409，不需要额外的去重状态。
   */
  private applyCompleteAction(task: MappingTaskRecord): MappingActionError | null {
    const busy = this.mappingActionBusyError(task);
    if (busy) return busy;
    if (this.lastNotifySubStatus !== 'expand_area') {
      return {
        kind: 'conflict',
        message: `EXPAND_AREA_FINISH not allowed outside MAP_COMPLETING (sub_status=${this.lastNotifySubStatus ?? 'none'})`,
      };
    }
    this.clearMapCompletingCountdown();
    this.beginMapUpload();
    return null;
  }

  /**
   * `EXPAND_AREA`（mapping-v4-final-spec.md §7）：同 `EXPAND_AREA_FINISH` 只在 `sub_status ===
   * 'expand_area'` 时受理，但效果立即生效（规格明确此 action 不走异步 ack）——切数据集、
   * 中断倒计时、把 `sub_status` 推成 `find_boundary`。通过 {@link pushRatelStatus} 走与首块
   * 草坪完全相同的 NOTIFY 路径，使 `onMappingPhaseChanged` 的既有钩子自然完成 §7 步骤 4/5
   * （`legitimate_starting_point` 复位 + 追加新 `aisle` label），无需在此重复实现。
   */
  private applyExpandAreaAction(task: MappingTaskRecord, deps?: MappingActionDeps): MappingActionError | null {
    const busy = this.mappingActionBusyError(task);
    if (busy) return busy;
    if (this.lastNotifySubStatus !== 'expand_area') {
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
    // 新草坪统一从手动寻边开始；先更新 mirror 的 remote 意图，再广播 find_boundary，
    // 保证 Mock 快照与 App 都投影为 REMOTE_CONTROL / MAP_SCAN_BOUNDARY_MANUAL。
    this.dispatchRaw({ type: 'CMD_ADD_LAWN' }, 'mapping');
    this.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
    return null;
  }

  /**
   * `POST ratel_mapping_task/create` + `mode:'extend'`（APP端接口文档 v9 §发起建图任务）——
   * 地图编辑页「添加草坪」入口，v9 起取代已废弃的专用端点 `/ratel/api/v1/mapping/expansion`。
   *
   * 与完成页的 `EXPAND_AREA`（{@link applyExpandAreaAction}）仍是两条不同链路：`EXPAND_AREA`
   * 要求设备正停在 `expand_area` 的选择窗口里，而这里设备处于 idle，App 选中一张既有地图后
   * 直接发起，复用那条通路必然 409。
   *
   * 与普通 create（{@link createMappingTask}）的差异只有三点：map_id 复用既有地图、mode 记为
   * `extend`、**不 reset mappingLabels**。返回的任务记录带 task_id —— App 侧 create 对 extend
   * 同样 fail-fast，不返回 task_id 会被直接拒绝进入建图页。接口成功只代表「设备已确认指令」，
   * 真正把 App 带进建图页的是 {@link scheduleExtendLaunch} 补推的
   * `precondition → leave_dock → find_boundary` 序列。
   */
  startExtendMapping(
    input: { sn: string; mapId: string },
    deps?: MappingActionDeps,
  ): { task?: MappingTaskRecord; error?: MappingActionError } {
    const sn = input.sn.trim();
    const mapId = input.mapId.trim();
    if (!sn) return { error: { kind: 'bad_request', message: 'sn is required' } };
    if (!mapId) return { error: { kind: 'bad_request', message: 'map_id is required' } };
    // §9.1 失败原因「无法获取设备 MAC」：模拟器只认自己这一台虚拟机器。
    if (sn !== this.sn) return { error: { kind: 'not_found', message: `device mac not found for sn ${sn}` } };
    const busy = this.extendBusyError();
    if (busy) return { error: busy };
    if (this.mappingLawnCount() >= EXPAND_AREA_MAX_LAWNS) {
      return { error: { kind: 'conflict', message: `lawn count limit reached (>= ${EXPAND_AREA_MAX_LAWNS})` } };
    }
    if (!deps?.switchDataset) {
      return { error: { kind: 'conflict', message: 'switchDataset dependency not configured' } };
    }
    const switched = deps.switchDataset(EXPAND_AREA_DATASET);
    if (!switched.ok) {
      return { error: { kind: 'conflict', message: switched.error ?? `failed to switch dataset ${EXPAND_AREA_DATASET}` } };
    }

    this.activeDomain = 'mapping';
    this.clearMappingActionTimers();
    this.clearMapCompletingCountdown();
    // 地图编辑入口意味着设备已回到 idle，但 mock 里上一段建图会话的 FSM 可能还停在
    // WORKING/COMPLETED —— 那样 `CMD_START` 会被非 IDLE 守卫吞掉，状态永远推不动。先把建图
    // FSM 与 notify 去重归位（与 {@link startRecharge} 归位割草 FSM 同理）。
    // `mappingLabels` 属于地图资产而非会话状态，**刻意不清**。
    this.mapping = withSimulatorDefaults(initialMappingState, this.mapping.battery ?? 80);
    this.lastNotifyWorkStatus = null;
    this.lastNotifySubStatus = null;
    this.lastNotifySubStatusEnteredAt = null;
    this.mappingTelemetry.reset();
    // 与 {@link createMappingTask} 的三处关键差异：
    //  1. map_id 复用 App 选中的既有地图，不新生成；
    //  2. 任务记录的 mode 记为 `extend`（任务列表读侧会回给 App，App 归一为手摇会话 remote）；
    //     mock 自身的建图 FSM 仍以 remote 起，新草坪一律从手动寻边起步；
    //  3. **不 reset mappingLabels** —— 既有 edge_start/aisle label 代表「已有草坪」，Mower 的
    //     useMappingPassageCapture 靠它判定通道端点归属，清掉会让通道画不出来。
    const task = this.createMappingTaskRecord(this.sn, mapId, 'extend');
    this.dispatchMapping({ type: 'CMD_START', mode: 'remote', taskMode: 'MAP_BUILD' });
    // 首帧必须带 `work_status: 'mapping'`：Mower 的 `PREPARING + idle` 是显式的启动失败判据。
    this.pushRatelStatus({ work_status: 'mapping', sub_status: 'precondition' });
    this.scheduleExtendLaunch();
    return { task };
  }

  /** 扩展建图要求设备空闲：任一域仍有活跃任务都按「设备返回非成功码」拒绝。 */
  private extendBusyError(): MappingActionError | null {
    const mapping = this.activeMappingTask();
    if (mapping && (mapping.status === 'ON_THE_WAY' || mapping.status === 'PAUSE')) {
      return {
        kind: 'conflict',
        message: `mapping task ${mapping.task_id} is still active (status=${mapping.status})`,
      };
    }
    const mowing = this.activeTask();
    if (mowing && (mowing.status === 'ON_THE_WAY' || mowing.status === 'PAUSE')) {
      return {
        kind: 'conflict',
        message: `mowing task ${mowing.task_id} is still active (status=${mowing.status})`,
      };
    }
    return null;
  }

  /** 设备确认扩展指令后自行推进的状态序列（见 MAPPING_EXTEND_*_DELAY_MS 的注释）。 */
  private scheduleExtendLaunch(): void {
    this.scheduleMappingTimer(MAPPING_EXTEND_UNDOCK_DELAY_MS, () => {
      this.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
    });
    // mode=remote 下 find_boundary 投影为 REMOTE_CONTROL / MAP_SCAN_BOUNDARY_MANUAL，
    // 与 Mower 跳转时携带的 `mode: 'remote'` 对齐（遥控面板 + 手动寻边）。
    this.scheduleMappingTimer(MAPPING_EXTEND_FIND_BOUNDARY_DELAY_MS, () => {
      this.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
    });
  }

  private mappingActionBusyError(task: MappingTaskRecord): MappingActionError | null {
    const acceptsManualAction =
      task.status === 'PAUSE' && this.mapping.state === 'REMOTE_CONTROL';
    if (task.status !== 'ON_THE_WAY' && !acceptsManualAction) {
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
    this.scheduleMappingTimer(MAPPING_ACTION_ACK_DELAY_MS, () => {
      this.pendingMappingAction = null;
      effect();
    });
  }

  /** Registers a device-side timer so {@link clearMappingActionTimers} (STOP/reset) can cancel it. */
  private scheduleMappingTimer(delayMs: number, effect: () => void): void {
    const timer = setTimeout(effect, delayMs);
    (timer as { unref?: () => void }).unref?.();
    this.mappingActionTimers.push(timer);
  }

  private clearMappingActionTimers(): void {
    for (const timer of this.mappingActionTimers.splice(0)) clearTimeout(timer);
    this.pendingMappingAction = null;
    // 上传段的步进定时器同样要停：STOP / reset 之后不该再有进度帧冒出来。
    this.clearUploadTimer();
    this.uploadProgress = 0;
    this.uploadStatus = 0;
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
    // 场景需要能直接发出后端 phase 推送；是否在手动寻边阶段消费这些推送由 App 的
    // manualScanStartGateRequired 决定。EDGE_START API 自身仍在 applyEdgeStartAction 严格校验。
    this.mapping = mappingReducer(this.mapping, event as MappingEvent, undefined, {
      manualScanStartGateRequired: MANUAL_SCAN_START_GATE_REQUIRED,
    });
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
    if (
      (to === 'MAP_SCAN_BOUNDARY' || to === 'MAP_SCAN_BOUNDARY_MANUAL') &&
      from !== to
    ) {
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
   * user tapped `EXPAND_AREA_FINISH`. `CMD_CONFIRM` at `MAP_COMPLETING` does not change `phase` (only
   * `state` → `COMPLETED`), so this does not re-trigger {@link onMappingPhaseChanged}.
   */
  private armMapCompletingCountdown(): void {
    this.clearMapCompletingCountdown();
    this.mapCompletingStartedAt = Date.now();
    this.mapCompletingTimer = setTimeout(() => {
      this.mapCompletingTimer = null;
      // 与手动 COMPLETE 走**同一条**收尾路径：先上传，上传完才进终态。
      // 真机上倒计时归零与用户点「完成」是同一个动作，Mock 不该在这里抄近路。
      this.beginMapUpload();
    }, MAP_COMPLETING_DURATION_MS);
    (this.mapCompletingTimer as { unref?: () => void }).unref?.();
  }

  /** 每一步进度之间的间隔；一整段上传约 UPLOAD_STEP_MS × 10。 */
  private static readonly UPLOAD_STEP_MS = 500;
  private static readonly UPLOAD_STEP_PCT = 10;

  /**
   * 进入上传段：推一帧 `upload_map`，随后按步进推进度。
   * 每一帧都走 {@link pushRatelStatus}，因此天然带**递增**的 `timestamp` /
   * `notify_timestamp`——App 侧的上传通道水位依赖它（同一 ts == 同一帧被重放）。
   */
  private beginMapUpload(): void {
    this.clearUploadTimer();
    this.uploadProgress = 0;
    this.uploadStatus = 1;
    this.pushRatelStatus({ work_status: 'mapping', sub_status: 'upload_map' });
    this.scheduleUploadStep();
  }

  /** 重试上传：从 0 重新走完，并**清掉失败位**（真机上也应如此，见 §4.7 的建议项）。 */
  retryMapUpload(): MappingActionError | null {
    if (this.lastNotifySubStatus !== 'upload_map') {
      return {
        kind: 'conflict',
        message: `RETRY_UPLOAD_MAP not allowed outside MAP_UPLOADING (sub_status=${this.lastNotifySubStatus ?? 'none'})`,
      };
    }
    if (this.uploadStatus !== 3) {
      return { kind: 'conflict', message: 'RETRY_UPLOAD_MAP requires a failed upload' };
    }
    // 场景里注入的失败点只生效一次，否则重试永远失败、M3 走不通。
    this.uploadFailAt = null;
    this.beginMapUpload();
    return null;
  }

  private scheduleUploadStep(): void {
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = null;
      this.uploadProgress = Math.min(
        100,
        this.uploadProgress + VirtualRobot.UPLOAD_STEP_PCT,
      );
      if (this.uploadFailAt !== null && this.uploadProgress >= this.uploadFailAt) {
        // 失败：推失败态后**停住**——不转 idle、不再步进，等 App 决定重试还是退出。
        this.uploadStatus = 3;
        this.pushRatelStatus({ work_status: 'mapping', sub_status: 'upload_map' });
        return;
      }
      if (this.uploadProgress >= 100) {
        this.uploadStatus = 2;
        this.pushRatelStatus({ work_status: 'mapping', sub_status: 'upload_map' });
        // 收尾权在 `work_status`，不是 `CMD_CONFIRM`。
        // 后者只在 `phase === 'MAP_COMPLETING'` 时受理，而此刻 phase 已经被
        // `upload_map` 推成 `MAP_UPLOADING`，用它会静默无效（会话永远停在 WORKING）。
        // 推 `idle` 才是真机的收尾方式，也符合「sub_status 永不终结会话」的全表级约定。
        this.pushRatelStatus({ work_status: 'idle', sub_status: 'complete' });
        return;
      }
      this.uploadStatus = 1;
      this.pushRatelStatus({ work_status: 'mapping', sub_status: 'upload_map' });
      this.scheduleUploadStep();
    }, VirtualRobot.UPLOAD_STEP_MS);
    (this.uploadTimer as { unref?: () => void }).unref?.();
  }

  private clearUploadTimer(): void {
    if (this.uploadTimer) {
      clearTimeout(this.uploadTimer);
      this.uploadTimer = null;
    }
  }

  /** 供快照读取：`extend_status.upload_map_progress` / `upload_map_status`。 */
  mapUploadTelemetry(): { progress: number; status: number } {
    return { progress: this.uploadProgress, status: this.uploadStatus };
  }

  private clearMapCompletingCountdown(): void {
    this.mapCompletingStartedAt = null;
    if (this.mapCompletingTimer) {
      clearTimeout(this.mapCompletingTimer);
      this.mapCompletingTimer = null;
    }
  }

  /**
   * 等待窗口起点（ms epoch），不在窗口里时为 `0`。
   *
   * 用 `0` 而不是省略字段：真机上该字段时刻都在报文里，未进入等待窗口时就是 `0`——
   * App 侧 `toEpochMs` 把 `0` 判为「无值」，语义是「倒计时已归零」。保持一致才能让
   * 真机测试覆盖到 App 的归零分支。
   */
  waitExtendTimestamp(): number {
    return this.mapCompletingStartedAt ?? 0;
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
