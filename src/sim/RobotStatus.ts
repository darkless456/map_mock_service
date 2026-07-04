import type {
  RobotWorkStatus,
  TaskContext,
} from './fsm-mirror/domain/shared/TaskFSM';
import type { MappingContext, MappingPhase } from './fsm-mirror/domain/mapping/MappingSession';
import type { RobotDomain } from './virtualRobotTypes';

const STREAMING_MAPPING_PHASES = new Set<MappingPhase>([
  'MAP_SCAN_BOUNDARY',
  'MAP_FOLLOW_BOUNDARY',
  'MAP_FOLLOW_BOUNDARY_MANUAL',
  'MAP_COVERAGE_PROBE',
  'MAP_COVERAGE_NEW_AREA',
  'MAP_COVERAGE_RUN',
]);

export function computeWorkStatus(
  activeDomain: RobotDomain,
  ctx: TaskContext<string>,
): RobotWorkStatus | 'estop' {
  if (ctx.state === 'ESTOPPED') return 'estop';
  if (ctx.state === 'ERRORED') return 'error';
  if (ctx.state === 'RECHARGING') return 'charging';
  if (activeDomain === 'mapping') {
    if (ctx.state === 'COMPLETED') return 'mapping_completed';
    if (ctx.state === 'IDLE' || ctx.state === 'CANCELLED') return 'idle';
    return 'mapping';
  }
  if (activeDomain === 'mowing') {
    if (ctx.state === 'IDLE' || ctx.state === 'COMPLETED' || ctx.state === 'CANCELLED') return 'idle';
    if (ctx.state === 'RETURNING_DOCK') return 'return_dock';
    return 'mowing';
  }
  return 'idle';
}

export function shouldStreamMapping(
  activeDomain: RobotDomain,
  mapping: MappingContext,
): boolean {
  if (activeDomain !== 'mapping') return false;
  if (mapping.state !== 'WORKING' && mapping.state !== 'REMOTE_CONTROL') return false;
  return mapping.phase !== null && STREAMING_MAPPING_PHASES.has(mapping.phase);
}
