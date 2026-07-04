export interface TrajectoryPoint {
  readonly x: number;
  readonly y: number;
}

export interface RobotPose {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

export interface PoseState {
  points: TrajectoryPoint[];
  index: number;
  direction: 1 | -1;
  x: number;
  y: number;
  angle: number;
}

export interface PixelBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface MowingTrajectoryDebugInfo {
  readonly source: 'semantic-zero' | 'fallback';
  readonly pointCount: number;
  readonly bounds: PixelBounds | null;
  readonly resolutionMPerPx: number;
  readonly firstPoint: TrajectoryPoint;
  readonly lastPoint: TrajectoryPoint;
}
