import fs from 'node:fs';
import path from 'node:path';
import type { IncrementPackage } from './annotations';
import { getAnnotationPackage, listAnnotationPackages } from './annotations';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const FULL_SEMANTIC_MAP_PATH = path.join(SERVICE_ROOT, 'full_semanticmap.png');

export interface MapItem {
  readonly map_id: string;
  readonly map_url: string;
  readonly base_version: number;
  readonly unit: string;
  readonly increments: IncrementPackage['increments'];
  readonly timestamp?: number;
}

export interface MapListData {
  readonly total: number;
  readonly items: readonly MapItem[];
}

export function hasBasemapAsset(): boolean {
  return fs.existsSync(FULL_SEMANTIC_MAP_PATH);
}

export function readBasemapAsset(): Buffer | null {
  if (!hasBasemapAsset()) return null;
  return fs.readFileSync(FULL_SEMANTIC_MAP_PATH);
}

export function buildMapAssetUrl(baseUrl: string, mapId = 'mock_map_001'): string {
  return `${baseUrl}/sim/assets/full_semanticmap.png?map_id=${encodeURIComponent(mapId)}`;
}

export function buildMapList(baseUrl: string): MapListData {
  const packages = listAnnotationPackages();
  const fallback = getAnnotationPackage('mock_map_001');
  const items = packages.length > 0 ? packages : fallback ? [fallback] : [];
  const mapped = items.map(pkg => ({
    map_id: pkg.map_id,
    map_url: buildMapAssetUrl(baseUrl, pkg.map_id),
    base_version: pkg.base_version,
    unit: pkg.unit || 'meter',
    increments: pkg.increments,
    timestamp: pkg.timestamp,
  }));
  return { total: mapped.length, items: mapped };
}
