import { roundPose } from './PoseAdvancer';
import type { MowingTrajectoryDebugInfo, PixelBounds, TrajectoryPoint } from './types';

const SEMANTIC_ZERO_THRESHOLD = 1;
const DEFAULT_MOW_WIDTH_M = 0.4;
const DEFAULT_STEP_M = 0.1;
const DEFAULT_EDGE_MARGIN_M = 0.1;

export interface PngImage {
  readonly width: number;
  readonly height: number;
  readonly data: Buffer;
}

interface PixelRun {
  readonly startX: number;
  readonly endX: number;
}

export interface SemanticRouteResult {
  readonly points: readonly TrajectoryPoint[];
  readonly debugInfo: MowingTrajectoryDebugInfo | null;
}

export function buildRouteFromSemanticZero(
  png: PngImage,
  resolutionMPerPx: number,
): SemanticRouteResult {
  const mask = buildSemanticZeroMask(png);
  const bounds = findMaskBounds(mask, png.width, png.height);
  if (!bounds) return { points: [], debugInfo: null };

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

  return {
    points: route,
    debugInfo: {
      source: 'semantic-zero',
      pointCount: route.length,
      bounds,
      resolutionMPerPx,
      firstPoint: route[0],
      lastPoint: route[route.length - 1],
    },
  };
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
