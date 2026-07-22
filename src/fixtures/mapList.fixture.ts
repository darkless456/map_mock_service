import path from 'node:path';
import { buildMapAssetUrl, buildRealsceneAssetUrl } from '../assets/BasemapAsset';
import { fixtureLoader, FIXTURE_ROOT } from '../fixtures';
import { getSemanticOverride, type IncrementPackage } from './semanticOverrides';

const MAP_LIST_FIXTURE_PATH = 'maps/map_list.json';

/**
 * `map/list` 列表项，字段命名对齐 APP 端接口文档的 `Rsp.data.items`。
 */
export interface MapItem extends Record<string, unknown> {
  readonly map_id: string;
  /** 机器端地图 URL（APP 端接口文档 `map_url`）。 */
  readonly map_url: string;
  /** 机器上报的语义地图 URL（APP 端接口文档 `semantic_map_url`）。 */
  readonly semantic_map_url: string;
  /** 机器上报的实景地图 URL（APP 端接口文档 `real_view_map_url`）。 */
  readonly real_view_map_url: string;
  readonly base_version: number;
  readonly unit: string;
  /** 是否为当前使用中的地图（APP 端接口文档 `is_use`）。 */
  readonly is_use: boolean;
  /**
   * 米 / 像素，语义图与实景图共享。
   * APP 端接口文档的 items 未列该字段，mock 随列表项一起下发，方便客户端落图。
   */
  readonly resolution: number;
  /** 地图原点 X（APP 端接口文档 `map_origin_x`），BackendWorld(Y-down) 图片左上角世界坐标，单位米。 */
  readonly map_origin_x: number;
  /** 地图原点 Y（APP 端接口文档 `map_origin_y`），BackendWorld(Y-down) 图片左上角世界坐标，单位米。 */
  readonly map_origin_y: number;
  readonly increments: IncrementPackage['increments'];
  readonly timestamp?: number;
  /** DVT 3: map card fields (mapping_api_dvt_gap.md 1) */
  readonly name?: string;
  readonly area?: number;
  readonly thumbnail_url?: string;
  readonly create_time?: number;
  readonly update_time?: number;
}

export interface MapListData {
  readonly total: number;
  readonly items: readonly MapItem[];
}

export interface MapListResponse {
  readonly code: number;
  readonly message: string;
  readonly data: MapListData;
}

function readMapListFixture(): MapListResponse {
  return fixtureLoader.read(MAP_LIST_FIXTURE_PATH, validateMapListFixture);
}

function validateMapListFixture(parsed: unknown): MapListResponse {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('data' in parsed) ||
    typeof parsed.data !== 'object' ||
    parsed.data === null ||
    !Array.isArray((parsed.data as { items?: unknown }).items)
  ) {
    throw new Error(`${path.join(FIXTURE_ROOT, 'maps')} map-list fixture must contain { data: { items: [...] } }`);
  }
  return parsed as MapListResponse;
}

export function buildMapListResponse(baseUrl: string): MapListResponse {
  const fixture = readMapListFixture();
  const items = fixture.data.items.map<MapItem>(item => {
    const semanticUrl = buildMapAssetUrl(baseUrl, item.map_id);
    const realsceneUrl = buildRealsceneAssetUrl(baseUrl, item.map_id);
    const override = getSemanticOverride(item.map_id);
    return {
      ...item,
      ...mapOverrideFields(override),
      map_url: semanticUrl,
      semantic_map_url: semanticUrl,
      real_view_map_url: realsceneUrl,
    };
  });

  return {
    ...fixture,
    data: {
      ...fixture.data,
      total: items.length,
      items,
    },
  };
}

function mapOverrideFields(override: IncrementPackage | undefined): Partial<MapItem> {
  if (!override) return {};
  return {
    ...(override.name !== undefined ? { name: override.name } : {}),
    ...(override.area !== undefined ? { area: override.area } : {}),
    map_id: override.map_id,
    base_version: override.base_version,
    timestamp: override.timestamp,
    unit: override.unit,
    ...(override.is_use !== undefined ? { is_use: override.is_use } : {}),
    increments: override.increments,
  };
}
