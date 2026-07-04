import { fixtureLoader } from '../fixtures';
import { readSemanticMapPngBytes } from '../assets/BasemapAsset';
import { logger } from '../infra/logger';
import { buildRouteFromSemanticZero, type PngImage } from './SemanticRouteExtractor';

const { PNG } = require('pngjs') as {
  PNG: {
    sync: {
      read(buffer: Buffer): PngImage;
    };
  };
};
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

/**
 * 割草轨迹数据源。
 *
 * - `semantic-zero`：从 `fixtures/maps/assets/full_semanticmap.png` 的语义类 0 草地区域
 *   提取弓字路线，**生产默认数据源**。
 * - `fallback`：`fixtures/mowing/trajectory_fallback.jsonc` 的显式点序列，
 *   仅在测试或显式降级时使用（通过 `MOWING_TRAJECTORY_SOURCE=fallback` 选择）。
 *
 * 不再保留「PNG 解析失败 → 静默回退 fallback」的兜底分支（refactor-audit-critical §B1）：
 * 资产缺失 / PNG 损坏 / 语义图无类 0 区域均直接抛错，让配置错误尽早暴露。
 */
const DEFAULT_RESOLUTION_M_PER_PX = 0.05;

function resolveTrajectorySource(): 'semantic-zero' | 'fallback' {
  const value = process.env.MOWING_TRAJECTORY_SOURCE;
  return value === 'fallback' ? 'fallback' : 'semantic-zero';
}

let cachedRoute: readonly TrajectoryPoint[] | null = null;
let cachedDebugInfo: MowingTrajectoryDebugInfo | null = null;

export function createPoseState(): PoseState {
  return createPoseStateFromPoints(loadMowingTrajectoryPoints());
}

/** 割草任务进入 `ON_THE_WAY` 时从路线起点重新开始。 */
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

  const source = resolveTrajectorySource();
  if (source === 'fallback') {
    const points = readFallbackPoints();
    cachedRoute = points;
    cachedDebugInfo = buildFallbackDebugInfo(points);
    logger.warn('mowing trajectory using fallback source', { pointCount: points.length });
    return cachedRoute;
  }

  const bytes = readSemanticMapPngBytes();
  const png = PNG.sync.read(bytes) as PngImage;
  const result = buildRouteFromSemanticZero(png, DEFAULT_RESOLUTION_M_PER_PX);
  if (!result.debugInfo || result.points.length < 2) {
    throw new Error(
      `semantic-zero route extraction yielded ${result.points.length} points; `
      + `check ${FULL_SEMANTIC_MAP_LABEL} contains a semantic-class-0 grass region`,
    );
  }
  cachedRoute = result.points;
  cachedDebugInfo = result.debugInfo;
  return cachedRoute;
}

export function getMowingTrajectoryDebugInfo(): MowingTrajectoryDebugInfo {
  loadMowingTrajectoryPoints();
  if (!cachedDebugInfo) throw new Error('mowing trajectory debug info not initialized');
  return cachedDebugInfo;
}

const FULL_SEMANTIC_MAP_LABEL = 'fixtures/maps/assets/full_semanticmap.png';

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
