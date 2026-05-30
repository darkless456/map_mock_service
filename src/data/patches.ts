import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const ALLOWED_DATASETS = new Set(['data', 'data2', 'data3', 'data4']);

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
  return path.join(SERVICE_ROOT, name);
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadAllPatches(dataset = 'data'): MapPatch[] {
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
    if (!storage) continue;

    partial.push({
      id: basename,
      timestampMs: numberValue(storage.timestamp_ms, Date.now()),
      resolution: numberValue(storage.resolution, 0.05),
      originX: numberValue(storage.origin_x, 0),
      originY: numberValue(storage.origin_y, 0),
      mapCols: Math.trunc(numberValue(storage.map_cols, 0)),
      mapRows: Math.trunc(numberValue(storage.map_rows, 0)),
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
