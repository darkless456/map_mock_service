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

/** A `RobotDomain` value whose validity has been confirmed (i.e. not `null`). */
export type NonNullableRobotDomain = 'mapping' | 'mowing' | 'mapEdit';

const ROBOT_DOMAIN_VALUES: ReadonlySet<string> = new Set(['mapping', 'mowing', 'mapEdit']);

function isNonNullableRobotDomain(value: unknown): value is NonNullableRobotDomain {
  return typeof value === 'string' && ROBOT_DOMAIN_VALUES.has(value);
}

/**
 * Coerce an untrusted `value` to a `NonNullableRobotDomain`, returning `fallback`
 * when the value is absent or illegal. Used at HTTP and recording boundaries,
 * where an absent domain is a legitimate "use whatever the robot is already in"
 * signal rather than a config defect.
 */
export function parseRobotDomain(value: unknown, fallback: NonNullableRobotDomain): NonNullableRobotDomain {
  return isNonNullableRobotDomain(value) ? value : fallback;
}

/**
 * Coerce a declaratively-sourced `value` (e.g. a scenario YAML field) to a
 * `NonNullableRobotDomain`, throwing when the value is absent or illegal so a
 * broken scenario surfaces immediately instead of silently rerouting to
 * `mapping`. Pass a human-readable `source` to identify the offending config.
 */
export function requireRobotDomain(value: unknown, source: string): NonNullableRobotDomain {
  if (!isNonNullableRobotDomain(value)) {
    throw new Error(
      `${source}: domain must be one of ${[...ROBOT_DOMAIN_VALUES].join('/')} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
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
  /** Last WS `NOTIFY_RATEL_STATUS` projection — surfaced for the panel metric cards. */
  readonly lastNotifyWorkStatus: string | null;
  readonly lastNotifySubStatus: string | null;
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
