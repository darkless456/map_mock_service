import type { TaskContext } from './fsm-mirror/domain/shared/TaskFSM';
import type { RecordedEvent, RobotDomain } from './virtualRobotTypes';

export class EventLog {
  private readonly events: RecordedEvent[] = [];

  constructor(private readonly maxEvents: number) {}

  snapshot(): RecordedEvent[] {
    return [...this.events];
  }

  record(domain: RobotDomain, event: unknown, activeContext: TaskContext<string>): void {
    this.events.unshift({
      ts: Date.now(),
      domain,
      event,
      state: activeContext.state,
      phase: activeContext.phase,
    });
    if (this.events.length > this.maxEvents) this.events.pop();
  }
}
