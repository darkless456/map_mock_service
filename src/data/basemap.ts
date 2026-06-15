import fs from 'node:fs';
import path from 'node:path';
import type { IncrementPackage } from './annotations';
import { getAnnotationPackage, listAnnotationPackages } from './annotations';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
const FULL_SEMANTIC_MAP_PATH = path.join(SERVICE_ROOT, 'full_semanticmap.png');
const FULL_RGB_MAP_PATH = path.join(SERVICE_ROOT, 'full_rgbmap.png');

const SEMANTIC_ASSET_PATH = '/sim/assets/full_semanticmap.png';
const RGB_ASSET_PATH = '/sim/assets/full_rgbmap.png';

/**
 * 地图元数据（resolution / origin）。
 *
 * 语义图与实景图共享同一世界坐标系：同一 `resolution` 与同一 `origin`
 * （见 pudu-rn-poc/docs/map_world_frame_realscene_robot_design.md §2.4 / §3.2）。
 * `origin_x / origin_y` 为后端 BackendWorld（Y-down）下图片左上角像素对应的世界坐标，
 * 来源于 `机器端接口文档.md` 增量帧 header 与 `地图管理系统设计方案.md` §1.2.2
 * 中的 `full_semanticmap.xml`（含 map_id / resolution / origin）。
 */
export interface MapMetadata {
  /** 米 / cell（米 / 像素）。 */
  readonly resolution: number;
  /** 图片左上角在 BackendWorld(Y-down) 中的 X 坐标（米）。 */
  readonly origin_x: number;
  /** 图片左上角在 BackendWorld(Y-down) 中的 Y 坐标（米）。 */
  readonly origin_y: number;
}

/**
 * Mock 默认元数据。
 *
 * 512×512 底图 × 0.05 m/px ≈ 25.6m 见方；origin 取 APP端接口文档v2.md 示例值
 * `(2.5, 2.2)`，既体现非零原点偏移（用于验证 Phase 3 origin 落地），
 * 又能让既有标注（世界坐标 x≈7~17、y≈7~15）完整落在底图范围内。
 */
const DEFAULT_MAP_METADATA: MapMetadata = {
  resolution: 0.05,
  origin_x: 2.5,
  origin_y: 2.2,
};

/** 已知地图的元数据覆盖表（缺省回落到 DEFAULT_MAP_METADATA）。 */
const MAP_METADATA: Readonly<Record<string, MapMetadata>> = {
  mock_map_001: DEFAULT_MAP_METADATA,
};

export function getMapMetadata(mapId: string): MapMetadata {
  return MAP_METADATA[mapId] ?? DEFAULT_MAP_METADATA;
}

/**
 * `map/list` 列表项，字段命名严格对齐 `APP端接口文档v2.md` 的 `Rsp.data.items`。
 */
export interface MapItem {
  readonly map_id: string;
  /** 机器端的地图包 URL（APP端接口文档v2.md `map_url`）。 */
  readonly map_url: string;
  /** 机器上报的语义地图 URL（APP端接口文档v2.md `semantic_map_url`）。 */
  readonly semantic_map_url: string;
  /** 机器上报的实景地图 URL（APP端接口文档v2.md `real_view_map_url`）。 */
  readonly real_view_map_url: string;
  readonly base_version: number;
  readonly unit: string;
  /**
   * 米 / 像素，语义图与实景图共享。
   * 注：APP端接口文档v2.md 的 items 未列该字段，real backend 来源于
   * `full_semanticmap.xml`（地图管理系统设计方案.md §1.2.2）；mock 在此随列表项一并下发。
   */
  readonly resolution: number;
  /** 地图原点 X（APP端接口文档v2.md `map_origin_x`），BackendWorld(Y-down) 图片左上角世界坐标，单位米。 */
  readonly map_origin_x: number;
  /** 地图原点 Y（APP端接口文档v2.md `map_origin_y`），BackendWorld(Y-down) 图片左上角世界坐标，单位米。 */
  readonly map_origin_y: number;
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

export function buildMapList(baseUrl: string): MapListData {
  const packages = listAnnotationPackages();
  const fallback = getAnnotationPackage('mock_map_001');
  const items = packages.length > 0 ? packages : fallback ? [fallback] : [];
  const mapped = items.map<MapItem>(pkg => {
    const meta = getMapMetadata(pkg.map_id);
    const semanticUrl = buildMapAssetUrl(baseUrl, pkg.map_id);
    const realsceneUrl = buildRealsceneAssetUrl(baseUrl, pkg.map_id);
    return {
      map_id: pkg.map_id,
      map_url: semanticUrl,
      semantic_map_url: semanticUrl,
      real_view_map_url: realsceneUrl,
      base_version: pkg.base_version,
      unit: pkg.unit || 'meter',
      resolution: meta.resolution,
      map_origin_x: meta.origin_x,
      map_origin_y: meta.origin_y,
      increments: pkg.increments,
      timestamp: pkg.timestamp,
    };
  });
  return { total: mapped.length, items: mapped };
}
