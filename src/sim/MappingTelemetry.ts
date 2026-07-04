import type { MappingContext } from './fsm-mirror/domain/mapping/MappingSession';

export interface PassageCheckpoint {
  start: { x: number; y: number };
  end: { x: number; y: number } | null;
}

export class MappingTelemetry {
  inLawn = false;
  edgeStartAvailable = false;
  regionCloseable = false;
  readonly passageCheckpoints: PassageCheckpoint[] = [];
  private lastRobotX = 0;
  private lastRobotY = 0;
  private trajectoryLog: Array<{ x: number; y: number; t: number }> = [];

  reset(): void {
    this.inLawn = false;
    this.edgeStartAvailable = false;
    this.regionCloseable = false;
    this.passageCheckpoints.length = 0;
    this.lastRobotX = 0;
    this.lastRobotY = 0;
    this.trajectoryLog = [];
  }

  generateTrajectoryUrl(baseUrl: string): string {
    return `${baseUrl}/sim/assets/mapping_trajectory.bin`;
  }

  buildTrajectoryBinary(): Buffer {
    if (this.trajectoryLog.length === 0) {
      const pts: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        pts.push(i * 0.5 + this.lastRobotX * 0.2, i * 0.3 + this.lastRobotY * 0.2, i * 150);
      }
      return Buffer.from(new Float32Array(pts).buffer);
    }
    const flat: number[] = [];
    for (const pt of this.trajectoryLog.slice(-5000)) {
      flat.push(pt.x, pt.y, pt.t);
    }
    return Buffer.from(new Float32Array(flat).buffer);
  }

  confirmEdgeStart(): void {
    this.edgeStartAvailable = false;
    this.recordPassageEnd();
  }

  confirmRegionClosure(): void {
    this.regionCloseable = false;
  }

  recordPassageStart(): void {
    const start = { x: this.lastRobotX, y: this.lastRobotY };
    this.passageCheckpoints.push({ start, end: null });
  }

  updateRobotPosition(x: number, y: number, mapping: MappingContext): void {
    this.lastRobotX = x;
    this.lastRobotY = y;
    this.trajectoryLog.push({ x, y, t: Date.now() });
    this.inLawn = x > 3 && x < 20 && y > -15 && y < -2;
    this.edgeStartAvailable = this.inLawn && mapping.mode === 'remote' && mapping.state === 'REMOTE_CONTROL';
    if (this.trajectoryLog.length > 20) {
      const first = this.trajectoryLog[0];
      const dx = x - first.x;
      const dy = y - first.y;
      this.regionCloseable = Math.sqrt(dx * dx + dy * dy) < 1.0;
    }
  }

  private recordPassageEnd(): void {
    const last = this.passageCheckpoints[this.passageCheckpoints.length - 1];
    if (last && !last.end) {
      last.end = { x: this.lastRobotX, y: this.lastRobotY };
    }
  }
}
