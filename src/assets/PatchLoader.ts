import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { FIXTURE_ROOT } from '../fixtures';
import { logger } from '../infra/logger';

const ALLOWED_DATASETS = new Set(['recharge_return', 'mowing_trajectory', 'mapping_happy', 'fixed_maps']);

export interface MapPatch {
  readonly id: string;
  readonly timestampMs: number;
  readonly resolution: number;
  readonly originX: number;
  readonly originY: number;
  readonly mapCols: number;
  readonly mapRows: number;
  readonly imageData: Buffer;
  readonly robotX: number;
  readonly robotY: number;
  readonly robotTheta: number;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
});

export function resolveDatasetDir(name: string): string | null {
  if (!ALLOWED_DATASETS.has(name)) return null;
  return path.join(FIXTURE_ROOT, 'datasets', name, 'frames');
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * 关键几何元数据缺失或非数值即抛错（refactor-audit-critical §B2）。
 * `timestamp_ms` 缺失允许回退 `Date.now()` 但需 warn，避免掩盖破损 fixture。
 */
function requiredNumber(value: unknown, field: string, xmlFile: string): number {
  const parsed = numberValue(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${xmlFile}: required field "${field}" missing or non-numeric (raw=${JSON.stringify(value)})`);
  }
  return parsed;
}

function timestampOrNow(value: unknown, xmlFile: string): number {
  const parsed = numberValue(value);
  if (Number.isNaN(parsed)) {
    logger.warn('frame missing timestamp_ms; using Date.now()', { xmlFile });
    return Date.now();
  }
  return parsed;
}

export function loadAllPatches(dataset = 'mapping_happy'): MapPatch[] {
  const dataDir = resolveDatasetDir(dataset);
  if (!dataDir || !fs.existsSync(dataDir)) return [];

  const xmlFiles = fs.readdirSync(dataDir).filter(file => file.endsWith('.xml')).sort();
  const partial: Omit<MapPatch, 'robotX' | 'robotY' | 'robotTheta'>[] = [];

  for (const xmlFile of xmlFiles) {
    const basename = path.basename(xmlFile, '.xml');
    const pngPath = path.join(dataDir, `${basename}.png`);
    if (!fs.existsSync(pngPath)) continue;

    const xmlContent = fs.readFileSync(path.join(dataDir, xmlFile), 'utf8');
    const parsed = xmlParser.parse(xmlContent) as { opencv_storage?: Record<string, unknown> };
    const storage = parsed.opencv_storage;
    if (!storage) {
      throw new Error(`${xmlFile}: missing opencv_storage root; not a valid map frame XML`);
    }

    partial.push({
      id: basename,
      timestampMs: timestampOrNow(storage.timestamp_ms, xmlFile),
      resolution: requiredNumber(storage.resolution, 'resolution', xmlFile),
      originX: requiredNumber(storage.origin_x, 'origin_x', xmlFile),
      originY: requiredNumber(storage.origin_y, 'origin_y', xmlFile),
      mapCols: Math.trunc(requiredNumber(storage.map_cols, 'map_cols', xmlFile)),
      mapRows: Math.trunc(requiredNumber(storage.map_rows, 'map_rows', xmlFile)),
      imageData: fs.readFileSync(pngPath),
    });
  }

  partial.sort((a, b) => a.timestampMs - b.timestampMs);

  let prevTheta = 0;
  return partial.map((patch, index) => {
    const robotX = patch.originX + (patch.mapCols * patch.resolution) / 2;
    const robotY = patch.originY + (patch.mapRows * patch.resolution) / 2;
    const next = partial[index + 1];
    if (next) {
      const nextX = next.originX + (next.mapCols * next.resolution) / 2;
      const nextY = next.originY + (next.mapRows * next.resolution) / 2;
      const dx = nextX - robotX;
      const dy = nextY - robotY;
      if (dx !== 0 || dy !== 0) prevTheta = Math.atan2(dy, dx);
    }
    return { ...patch, robotX, robotY, robotTheta: prevTheta };
  });
}
