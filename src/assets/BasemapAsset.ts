import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_ROOT } from '../fixtures';
import {
  realsceneAssetPath,
  resolveMapEditProfile,
  semanticAssetPath,
  type MapEditProfile,
} from '../fixtures/mapEditProfile';

/**
 * 二进制地图资产的唯一物理路径解析点。
 * 资产已按 refactor-plan §5.4 迁入 `fixtures/maps/assets/`，
 * 任何模块需要语义/实景图 PNG 都必须通过本模块读取，不得重复硬编码路径。
 */
const SEMANTIC_ASSET_PATH = '/sim/assets/full_semanticmap.png';
const RGB_ASSET_PATH = '/sim/assets/full_rgbmap.png';

function fixtureAssetPath(relativePath: string): string {
  return path.join(FIXTURE_ROOT, relativePath);
}

export function hasBasemapAsset(
  profile: MapEditProfile = resolveMapEditProfile(),
): boolean {
  return fs.existsSync(fixtureAssetPath(semanticAssetPath(profile)));
}

export function readBasemapAsset(
  profile: MapEditProfile = resolveMapEditProfile(),
): Buffer | null {
  const assetPath = fixtureAssetPath(semanticAssetPath(profile));
  if (!fs.existsSync(assetPath)) return null;
  return fs.readFileSync(assetPath);
}

/**
 * 读取语义图 PNG 原始字节供轨迹提取使用。资产缺失即抛错（fail-fast），
 * 不再静默兜底，以便配置错误尽早暴露。
 */
export function readSemanticMapPngBytes(
  profile: MapEditProfile = resolveMapEditProfile(),
): Buffer {
  const assetPath = fixtureAssetPath(semanticAssetPath(profile));
  if (!fs.existsSync(assetPath)) {
    throw new Error(`semantic basemap not found: ${assetPath}`);
  }
  return fs.readFileSync(assetPath);
}

export function hasRealsceneAsset(
  profile: MapEditProfile = resolveMapEditProfile(),
): boolean {
  return fs.existsSync(fixtureAssetPath(realsceneAssetPath(profile)));
}

export function readRealsceneAsset(
  profile: MapEditProfile = resolveMapEditProfile(),
): Buffer | null {
  const assetPath = fixtureAssetPath(realsceneAssetPath(profile));
  if (!fs.existsSync(assetPath)) return null;
  return fs.readFileSync(assetPath);
}

export function buildMapAssetUrl(baseUrl: string, mapId = 'mock_map_001'): string {
  return `${baseUrl}${SEMANTIC_ASSET_PATH}?map_id=${encodeURIComponent(mapId)}`;
}

export function buildRealsceneAssetUrl(baseUrl: string, mapId = 'mock_map_001'): string {
  return `${baseUrl}${RGB_ASSET_PATH}?map_id=${encodeURIComponent(mapId)}`;
}
