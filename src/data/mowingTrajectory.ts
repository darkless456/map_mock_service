import fs from 'node:fs';
import path from 'node:path';

const { PNG } = require('pngjs') as {
  PNG: {
    sync: {
      read(buffer: Buffer): PngImage;
    };
  };
};

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const FULL_SEMANTIC_MAP_PATH = path.join(SERVICE_ROOT, 'full_semanticmap.png');

const SEMANTIC_ZERO_THRESHOLD = 1;
const DEFAULT_RESOLUTION_M_PER_PX = 0.05;
const DEFAULT_MOW_WIDTH_M = 0.4;
const DEFAULT_STEP_M = 0.1;
const DEFAULT_EDGE_MARGIN_M = 0.1;

const FALLBACK_POINTS: readonly TrajectoryPoint[] = [
  { x: 10.8, y: 10.0 },
  { x: 14.0, y: 10.0 },
  { x: 14.0, y: 10.4 },
  { x: 10.8, y: 10.4 },
  { x: 10.8, y: 10.8 },
  { x: 14.0, y: 10.8 },
];

interface PngImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

interface PixelRun {
  readonly startX: number;
  readonly endX: number;
}

interface PixelBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

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

export interface MowingTrajectoryDebugInfo {
  readonly source: 'semantic-zero' | 'fallback';
  readonly pointCount: number;
  readonly bounds: PixelBounds | null;
  readonly resolutionMPerPx: number;
  readonly firstPoint: TrajectoryPoint;
  readonly lastPoint: TrajectoryPoint;
}

let cachedRoute: TrajectoryPoint[] | null = null;
let cachedDebugInfo: MowingTrajectoryDebugInfo | null = null;

export function createPoseState(): PoseState {
  const points = loadMowingTrajectoryPoints();
  const first = points[0] ?? FALLBACK_POINTS[0];
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

export function loadMowingTrajectoryPoints(): readonly TrajectoryPoint[] {
  if (cachedRoute) return cachedRoute;

  try {
    const png = PNG.sync.read(fs.readFileSync(FULL_SEMANTIC_MAP_PATH));
    const route = buildRouteFromSemanticZero(png, DEFAULT_RESOLUTION_M_PER_PX);
    if (route.length >= 2) {
      cachedRoute = route;
      return cachedRoute;
    }
  } catch {
    // Fall through to deterministic fallback below.
  }

  cachedRoute = [...FALLBACK_POINTS];
  cachedDebugInfo = {
    source: 'fallback',
    pointCount: cachedRoute.length,
    bounds: null,
    resolutionMPerPx: DEFAULT_RESOLUTION_M_PER_PX,
    firstPoint: cachedRoute[0],
    lastPoint: cachedRoute[cachedRoute.length - 1],
  };
  return cachedRoute;
}

export function getMowingTrajectoryDebugInfo(): MowingTrajectoryDebugInfo {
  loadMowingTrajectoryPoints();
  return cachedDebugInfo ?? {
    source: 'fallback',
    pointCount: FALLBACK_POINTS.length,
    bounds: null,
    resolutionMPerPx: DEFAULT_RESOLUTION_M_PER_PX,
    firstPoint: FALLBACK_POINTS[0],
    lastPoint: FALLBACK_POINTS[FALLBACK_POINTS.length - 1],
  };
}

function buildRouteFromSemanticZero(png: PngImage, resolutionMPerPx: number): TrajectoryPoint[] {
  const mask = buildSemanticZeroMask(png);
  const bounds = findMaskBounds(mask, png.width, png.height);
  if (!bounds) return [];

  const laneSpacingPx = Math.max(1, Math.round(DEFAULT_MOW_WIDTH_M / resolutionMPerPx));
  const stepPx = Math.max(1, Math.round(DEFAULT_STEP_M / resolutionMPerPx));
  const edgeMarginPx = Math.max(1, Math.round(DEFAULT_EDGE_MARGIN_M / resolutionMPerPx));
  const minRunPx = Math.max(laneSpacingPx, edgeMarginPx * 3);
  const route: TrajectoryPoint[] = [];
  let goingRight = true;

  for (let y = bounds.minY + edgeMarginPx; y <= bounds.maxY - edgeMarginPx; y += laneSpacingPx) {
    const runs = mergeCloseRuns(findRunsAtY(mask, png.width, y, bounds.minX, bounds.maxX), edgeMarginPx);
    const run = runs
      .filter(candidate => candidate.endX - candidate.startX + 1 >= minRunPx)
      .sort((a, b) => (b.endX - b.startX) - (a.endX - a.startX))[0];
    if (!run) continue;

    const startX = run.startX + edgeMarginPx;
    const endX = run.endX - edgeMarginPx;
    if (endX <= startX) continue;

    const laneXs = goingRight
      ? range(startX, endX, stepPx)
      : range(endX, startX, -stepPx);
    const laneEnd = goingRight ? endX : startX;
    if (laneXs[laneXs.length - 1] !== laneEnd) laneXs.push(laneEnd);

    for (const x of laneXs) {
      route.push(pixelToWorld(x, y, resolutionMPerPx));
    }
    goingRight = !goingRight;
  }

  cachedDebugInfo = {
    source: 'semantic-zero',
    pointCount: route.length,
    bounds,
    resolutionMPerPx,
    firstPoint: route[0],
    lastPoint: route[route.length - 1],
  };

  return route;
}

function buildSemanticZeroMask(png: PngImage): Uint8Array {
  const mask = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      const alpha = png.data[offset + 3];
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      if (alpha > 0 && r <= SEMANTIC_ZERO_THRESHOLD && g <= SEMANTIC_ZERO_THRESHOLD && b <= SEMANTIC_ZERO_THRESHOLD) {
        mask[y * png.width + x] = 1;
      }
    }
  }
  return mask;
}

function findMaskBounds(mask: Uint8Array, width: number, height: number): PixelBounds | null {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  return maxX >= minX && maxY >= minY ? { minX, maxX, minY, maxY } : null;
}

function findRunsAtY(mask: Uint8Array, width: number, y: number, minX: number, maxX: number): PixelRun[] {
  const runs: PixelRun[] = [];
  let startX = -1;
  for (let x = minX; x <= maxX; x += 1) {
    if (mask[y * width + x]) {
      if (startX < 0) startX = x;
    } else if (startX >= 0) {
      runs.push({ startX, endX: x - 1 });
      startX = -1;
    }
  }
  if (startX >= 0) runs.push({ startX, endX: maxX });
  return runs;
}

function mergeCloseRuns(runs: PixelRun[], maxGapPx: number): PixelRun[] {
  const merged: PixelRun[] = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (!previous || run.startX - previous.endX > maxGapPx + 1) {
      merged.push(run);
      continue;
    }
    merged[merged.length - 1] = { startX: previous.startX, endX: run.endX };
  }
  return merged;
}

function pixelToWorld(xPx: number, yPx: number, resolutionMPerPx: number): TrajectoryPoint {
  return {
    x: roundPose(xPx * resolutionMPerPx),
    y: roundPose(yPx * resolutionMPerPx),
  };
}

function range(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  if (step === 0) return [start];
  for (let value = start; step > 0 ? value <= end : value >= end; value += step) {
    values.push(value);
  }
  return values;
}

function angleBetween(from: TrajectoryPoint, to: TrajectoryPoint): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function roundPose(value: number): number {
  return Number(value.toFixed(3));
}
