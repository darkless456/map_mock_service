import type {
  MappingContext,
  MappingEvent,
  MappingPhase,
} from './fsm-mirror/domain/mapping/MappingSession';
import type {
  MowingContext,
  MowingEvent,
  MowingPhase,
} from './fsm-mirror/domain/mowing/MowingTask';
import type {
  RobotWorkStatus,
  TaskContext,
  TaskEvent,
  TaskState,
} from './fsm-mirror/domain/shared/TaskFSM';
import type { SimOnlyEvent, SimTaskNotice } from './simFsmTypes';

export type RobotDomain = 'mapping' | 'mowing' | 'mapEdit' | null;

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

export interface MappingTaskRecord {
  readonly task_id: string;
  readonly sn: string;
  status: 'ON_THE_WAY' | 'PAUSE' | 'COMPLETE' | 'CANCEL' | 'FAILED';
  readonly map_id: string;
  readonly mode: string;
  task_message: string;
  task_error_code: number;
  readonly created_at: number;
  updated_at: number;
}

export interface RechargeTaskRecord {
  readonly task_id: string;
  readonly sn: string;
  status: 'ON_THE_WAY' | 'PAUSE' | 'COMPLETE' | 'CANCEL';
  readonly created_at: number;
}

export interface RechargeStatusPush {
  readonly sn: string;
  readonly task_id: string;
  readonly task_status: RechargeTaskRecord['status'];
  readonly remark: string;
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
  readonly mappingTasks: readonly MappingTaskRecord[];
  readonly latestMappingTaskBySn: Readonly<Record<string, string>>;
  readonly activeMappingTask: MappingTaskRecord | null;
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
