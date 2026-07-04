import type {
  RobotDomain,
  VirtualRobotSnapshot,
  VirtualRobotTranscript,
} from './virtualRobotTypes';

export function buildTranscript(
  domain: RobotDomain,
  event: unknown,
  before: VirtualRobotSnapshot,
  after: VirtualRobotSnapshot,
  changed: boolean,
): VirtualRobotTranscript {
  return {
    ts: Date.now(),
    domain,
    event,
    before: pickTranscriptSnapshot(before),
    after: pickTranscriptSnapshot(after),
    changed,
  };
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
