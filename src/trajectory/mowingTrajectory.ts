import fs from 'node:fs';
import path from 'node:path';
import { fixtureLoader } from '../fixtures';
import { buildRouteFromSemanticZero, type PngImage } from './SemanticRouteExtractor';
import {
  advancePose,
  createPoseStateFromPoints,
  currentRobotPose,
} from './PoseAdvancer';
import type {
  MowingTrajectoryDebugInfo,
  PoseState,
  RobotPose,
  TrajectoryPoint,
} from './types';

export {
  advancePose,
  currentRobotPose,
  type MowingTrajectoryDebugInfo,
  type PoseState,
  type RobotPose,
  type TrajectoryPoint,
};

const { PNG } = require('pngjs') as {
  PNG: {
    sync: {
      read(buffer: Buffer): PngImage;
    };
  };
};

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const FULL_SEMANTIC_MAP_PATH = path.join(SERVICE_ROOT, 'full_semanticmap.png');

const DEFAULT_RESOLUTION_M_PER_PX = 0.05;

let cachedRoute: readonly TrajectoryPoint[] | null = null;
let cachedDebugInfo: MowingTrajectoryDebugInfo | null = null;

export function createPoseState(): PoseState {
  const route = loadMowingTrajectoryPoints();
  const fallbackPoints = readFallbackPoints();
  const points = route.length >= 2 ? route : fallbackPoints;
  return createPoseStateFromPoints(points);
}

/** 割草任务进入 `ON_THE_WAY` 时从语义地图路线起点重新开始。 */
export function resetPoseState(pose: PoseState): void {
  const fresh = createPoseState();
  pose.points = fresh.points;
  pose.index = fresh.index;
  pose.direction = fresh.direction;
  pose.x = fresh.x;
  pose.y = fresh.y;
  pose.angle = fresh.angle;
}

export function loadMowingTrajectoryPoints(): readonly TrajectoryPoint[] {
  if (cachedRoute) return cachedRoute;

  try {
    const png = PNG.sync.read(fs.readFileSync(FULL_SEMANTIC_MAP_PATH));
    const result = buildRouteFromSemanticZero(png, DEFAULT_RESOLUTION_M_PER_PX);
    if (result.points.length >= 2) {
      cachedRoute = result.points;
      cachedDebugInfo = result.debugInfo;
      return cachedRoute;
    }
  } catch {
    // Fall through to deterministic fallback below.
  }

  cachedRoute = null;
  const fallbackPoints = readFallbackPoints();
  cachedDebugInfo = buildFallbackDebugInfo(fallbackPoints);
  return fallbackPoints;
}

export function getMowingTrajectoryDebugInfo(): MowingTrajectoryDebugInfo {
  loadMowingTrajectoryPoints();
  return cachedDebugInfo ?? buildFallbackDebugInfo(readFallbackPoints());
}

function readFallbackPoints(): readonly TrajectoryPoint[] {
  return fixtureLoader.read('mowing/trajectory_fallback.jsonc', raw => {
    if (!Array.isArray(raw)) {
      throw new Error('fixtures/mowing/trajectory_fallback.jsonc must contain an array');
    }
    for (const point of raw) {
      if (
        typeof point !== 'object' ||
        point === null ||
        typeof (point as { x?: unknown }).x !== 'number' ||
        typeof (point as { y?: unknown }).y !== 'number'
      ) {
        throw new Error('fixtures/mowing/trajectory_fallback.jsonc points must contain numeric x/y');
      }
    }
    return raw as TrajectoryPoint[];
  });
}

function buildFallbackDebugInfo(points: readonly TrajectoryPoint[]): MowingTrajectoryDebugInfo {
  return {
    source: 'fallback',
    pointCount: points.length,
    bounds: null,
    resolutionMPerPx: DEFAULT_RESOLUTION_M_PER_PX,
    firstPoint: points[0] ?? { x: 0, y: 0 },
    lastPoint: points[points.length - 1] ?? { x: 0, y: 0 },
  };
}
