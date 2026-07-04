import type { PoseState, RobotPose, TrajectoryPoint } from './types';

const DEFAULT_STEP_M = 0.1;

export function createPoseStateFromPoints(points: readonly TrajectoryPoint[]): PoseState {
  const first = points[0] ?? { x: 0, y: 0 };
  const second = points[1] ?? first;
  return {
    points: [...points],
    index: 0,
    direction: 1,
    x: first.x,
    y: first.y,
    angle: angleBetween(first, second),
  };
}

export function currentRobotPose(pose: PoseState): RobotPose {
  const point = { x: pose.x, y: pose.y };
  const target = pose.points[pose.index + pose.direction] ?? pose.points[pose.index - pose.direction] ?? point;
  return {
    x: roundPose(point.x),
    y: roundPose(point.y),
    angle: pose.angle || angleBetween(point, target),
  };
}

export function advancePose(pose: PoseState, stepM = DEFAULT_STEP_M): RobotPose {
  if (pose.points.length < 2) return currentRobotPose(pose);

  let remaining = stepM;
  while (remaining > 0) {
    const current = { x: pose.x, y: pose.y };
    const targetIndex = pose.index + pose.direction;
    const target = pose.points[targetIndex];

    if (!target) {
      pose.direction = pose.direction === 1 ? -1 : 1;
      continue;
    }

    const dx = target.x - current.x;
    const dy = target.y - current.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= remaining || distance < 0.000001) {
      pose.index = targetIndex;
      pose.x = target.x;
      pose.y = target.y;
      pose.angle = angleBetween(current, target);
      remaining -= distance;
      if (pose.index === 0 || pose.index === pose.points.length - 1) {
        pose.direction = pose.direction === 1 ? -1 : 1;
        break;
      }
      continue;
    }

    const ratio = remaining / distance;
    pose.x = current.x + dx * ratio;
    pose.y = current.y + dy * ratio;
    pose.angle = Math.atan2(dy, dx);
    remaining = 0;
  }

  return currentRobotPose(pose);
}

export function angleBetween(from: TrajectoryPoint, to: TrajectoryPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function roundPose(value: number): number {
  return Number(value.toFixed(3));
}
