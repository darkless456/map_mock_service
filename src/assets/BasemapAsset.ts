import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_ROOT } from '../fixtures';

const FULL_SEMANTIC_MAP_PATH = path.join(SERVICE_ROOT, 'full_semanticmap.png');
const FULL_RGB_MAP_PATH = path.join(SERVICE_ROOT, 'full_rgbmap.png');

const SEMANTIC_ASSET_PATH = '/sim/assets/full_semanticmap.png';
const RGB_ASSET_PATH = '/sim/assets/full_rgbmap.png';

export function hasBasemapAsset(): boolean {
  return fs.existsSync(FULL_SEMANTIC_MAP_PATH);
}

export function readBasemapAsset(): Buffer | null {
  if (!hasBasemapAsset()) return null;
  return fs.readFileSync(FULL_SEMANTIC_MAP_PATH);
}

export function hasRealsceneAsset(): boolean {
  return fs.existsSync(FULL_RGB_MAP_PATH);
}

export function readRealsceneAsset(): Buffer | null {
  if (!hasRealsceneAsset()) return null;
  return fs.readFileSync(FULL_RGB_MAP_PATH);
}

export function buildMapAssetUrl(baseUrl: string, mapId = 'mock_map_001'): string {
  return `${baseUrl}${SEMANTIC_ASSET_PATH}?map_id=${encodeURIComponent(mapId)}`;
}

export function buildRealsceneAssetUrl(baseUrl: string, mapId = 'mock_map_001'): string {
  return `${baseUrl}${RGB_ASSET_PATH}?map_id=${encodeURIComponent(mapId)}`;
}
