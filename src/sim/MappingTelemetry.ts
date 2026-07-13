import type { MappingPhase } from './fsm-mirror/domain/mapping/MappingSession';

export interface PassageCheckpoint {
  start: { x: number; y: number };
  end: { x: number; y: number } | null;
}

/**
 * mapping-v4-final-spec.md §2 leaves the trigger conditions for
 * `extend_status.legitimate_starting_point`/`legitimate_end_point` undefined (audit gap G4).
 * Mock decision (Appendix A: values, not structure): treat each as a settle signal that
 * arms on entering the corresponding FSM phase and flips true after a short delay, so
 * EDGE_START/EDGE_CLOSE (batch 2) can exercise both the 409 (wrong phase) and 422
 * (right phase, signal not yet legitimate) failure paths.
 */
const START_POINT_SETTLE_MS = 3_000;
const END_POINT_SETTLE_MS = 3_000;

export class MappingTelemetry {
  legitimateStartingPoint = false;
  legitimateEndPoint = false;
  readonly passageCheckpoints: PassageCheckpoint[] = [];
  private lastPhase: MappingPhase | null = null;
  private startSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private endSettleTimer: ReturnType<typeof setTimeout> | null = null;

  /** @param onSettled Called when a delayed legitimacy flag flips, so the caller can re-broadcast state. */
  constructor(private readonly onSettled: () => void) {}

  reset(): void {
    this.clearTimers();
    this.legitimateStartingPoint = false;
    this.legitimateEndPoint = false;
    this.passageCheckpoints.length = 0;
    this.lastPhase = null;
  }

  /** Re-derives legitimacy signals on an FSM phase transition (called from `dispatchMapping`). */
  syncWithPhase(phase: MappingPhase | null): void {
    if (phase === this.lastPhase) return;
    this.lastPhase = phase;
    this.clearTimers();
    if (phase === 'MAP_SCAN_BOUNDARY') {
      this.legitimateStartingPoint = false;
      this.startSettleTimer = setTimeout(() => {
        this.startSettleTimer = null;
        this.legitimateStartingPoint = true;
        this.onSettled();
      }, START_POINT_SETTLE_MS);
      (this.startSettleTimer as { unref?: () => void }).unref?.();
    } else if (phase === 'MAP_FOLLOW_BOUNDARY' || phase === 'MAP_FOLLOW_BOUNDARY_MANUAL') {
      this.legitimateEndPoint = false;
      this.endSettleTimer = setTimeout(() => {
        this.endSettleTimer = null;
        this.legitimateEndPoint = true;
        this.onSettled();
      }, END_POINT_SETTLE_MS);
      (this.endSettleTimer as { unref?: () => void }).unref?.();
    } else {
      this.legitimateStartingPoint = false;
      this.legitimateEndPoint = false;
    }
  }

  generateTrajectoryUrl(baseUrl: string): string {
    return `${baseUrl}/sim/assets/mapping_trajectory.bin`;
  }

  buildTrajectoryBinary(): Buffer {
    const pts: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      pts.push(i * 0.5, i * 0.3, i * 150);
    }
    return Buffer.from(new Float32Array(pts).buffer);
  }

  /** Consumes the starting-point signal (called when EDGE_START is accepted). */
  confirmEdgeStart(): void {
    this.legitimateStartingPoint = false;
    this.recordPassageEnd();
  }

  /** Consumes the end-point signal (called when EDGE_CLOSE is accepted). */
  confirmRegionClosure(): void {
    this.legitimateEndPoint = false;
  }

  recordPassageStart(): void {
    this.passageCheckpoints.push({ start: { x: 0, y: 0 }, end: null });
  }

  private recordPassageEnd(): void {
    const last = this.passageCheckpoints[this.passageCheckpoints.length - 1];
    if (last && !last.end) {
      last.end = { x: 0, y: 0 };
    }
  }

  private clearTimers(): void {
    if (this.startSettleTimer) {
      clearTimeout(this.startSettleTimer);
      this.startSettleTimer = null;
    }
    if (this.endSettleTimer) {
      clearTimeout(this.endSettleTimer);
      this.endSettleTimer = null;
    }
  }
}
