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
 * 鍦板浘鍏冩暟鎹紙resolution / origin锛夈€? *
 * 璇箟鍥句笌瀹炴櫙鍥惧叡浜悓涓€涓栫晫鍧愭爣绯伙細鍚屼竴 `resolution` 涓庡悓涓€ `origin`
 * 锛堣 pudu-rn-poc/docs/map_world_frame_realscene_robot_design.md 搂2.4 / 搂3.2锛夈€? * `origin_x / origin_y` 涓哄悗绔?BackendWorld锛圷-down锛変笅鍥剧墖宸︿笂瑙掑儚绱犲搴旂殑涓栫晫鍧愭爣锛? * 鏉ユ簮浜?`鏈哄櫒绔帴鍙ｆ枃妗?md` 澧為噺甯?header 涓?`鍦板浘绠＄悊绯荤粺璁捐鏂规.md` 搂1.2.2
 * 涓殑 `full_semanticmap.xml`锛堝惈 map_id / resolution / origin锛夈€? */
export interface MapMetadata {
  /** 绫?/ cell锛堢背 / 鍍忕礌锛夈€?*/
  readonly resolution: number;
  /** 鍥剧墖宸︿笂瑙掑湪 BackendWorld(Y-down) 涓殑 X 鍧愭爣锛堢背锛夈€?*/
  readonly origin_x: number;
  /** 鍥剧墖宸︿笂瑙掑湪 BackendWorld(Y-down) 涓殑 Y 鍧愭爣锛堢背锛夈€?*/
  readonly origin_y: number;
}

/**
 * Mock 榛樿鍏冩暟鎹€? *
 * 512脳512 搴曞浘 脳 0.05 m/px 鈮?25.6m 瑙佹柟锛沷rigin 鍙?APP绔帴鍙ｆ枃妗2.md 绀轰緥鍊? * `(2.5, 2.2)`锛屾棦浣撶幇闈為浂鍘熺偣鍋忕Щ锛堢敤浜庨獙璇?Phase 3 origin 钀藉湴锛夛紝
 * 鍙堣兘璁╂棦鏈夋爣娉紙涓栫晫鍧愭爣 x鈮?~17銆亂鈮?~15锛夊畬鏁磋惤鍦ㄥ簳鍥捐寖鍥村唴銆? */
const DEFAULT_MAP_METADATA: MapMetadata = {
  resolution: 0.05,
  origin_x: 2.5,
  origin_y: 2.2,
};

/** 宸茬煡鍦板浘鐨勫厓鏁版嵁瑕嗙洊琛紙缂虹渷鍥炶惤鍒?DEFAULT_MAP_METADATA锛夈€?*/
const MAP_METADATA: Readonly<Record<string, MapMetadata>> = {
  mock_map_001: DEFAULT_MAP_METADATA,
  '4245b2a8-5394-4259-9a2f-0379c8f82f03': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  '7923da82-4803-47e4-b541-782e4ada3a10': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  'ae277bb2-d99e-4411-b900-4a26af41cfb4': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  'ed01fe3c-d2f1-4429-aec9-81ec4cb736e8': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  '04377a8f-df99-4630-8883-d967f255f383': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  'cf640c1d-4f1c-4f15-b292-71fbcae50e63': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  'f755fe0f-5958-4b0a-9fd5-47159ba440de': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  '2a27fcb3-c123-43fe-9653-5b5e31aff895': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  '04e5afc6-085c-4522-956e-a89379515621': { resolution: 0.05, origin_x: -12.8, origin_y: -12.8 },
  'first_map': { resolution: 0.05, origin_x: 0, origin_y: 0 },
};

export function getMapMetadata(mapId: string): MapMetadata {
  return MAP_METADATA[mapId] ?? DEFAULT_MAP_METADATA;
}

/**
 * `map/list` 鍒楄〃椤癸紝瀛楁鍛藉悕涓ユ牸瀵归綈 `APP绔帴鍙ｆ枃妗2.md` 鐨?`Rsp.data.items`銆? */
export interface MapItem {
  readonly map_id: string;
  /** 鏈哄櫒绔殑鍦板浘鍖?URL锛圓PP绔帴鍙ｆ枃妗2.md `map_url`锛夈€?*/
  readonly map_url: string;
  /** 鏈哄櫒涓婃姤鐨勮涔夊湴鍥?URL锛圓PP绔帴鍙ｆ枃妗2.md `semantic_map_url`锛夈€?*/
  readonly semantic_map_url: string;
  /** 鏈哄櫒涓婃姤鐨勫疄鏅湴鍥?URL锛圓PP绔帴鍙ｆ枃妗2.md `real_view_map_url`锛夈€?*/
  readonly real_view_map_url: string;
  readonly base_version: number;
  readonly unit: string;
  /** 鏄惁涓哄綋鍓嶄娇鐢ㄤ腑鐨勫湴鍥撅紙APP绔帴鍙ｆ枃妗2.md `is_use`锛夈€?*/
  readonly is_use: boolean;
  /**
   * 绫?/ 鍍忕礌锛岃涔夊浘涓庡疄鏅浘鍏变韩銆?   * 娉細APP绔帴鍙ｆ枃妗2.md 鐨?items 鏈垪璇ュ瓧娈碉紝real backend 鏉ユ簮浜?   * `full_semanticmap.xml`锛堝湴鍥剧鐞嗙郴缁熻璁℃柟妗?md 搂1.2.2锛夛紱mock 鍦ㄦ闅忓垪琛ㄩ」涓€骞朵笅鍙戙€?   */
  readonly resolution: number;
  /** 鍦板浘鍘熺偣 X锛圓PP绔帴鍙ｆ枃妗2.md `map_origin_x`锛夛紝BackendWorld(Y-down) 鍥剧墖宸︿笂瑙掍笘鐣屽潗鏍囷紝鍗曚綅绫炽€?*/
  readonly map_origin_x: number;
  /** 鍦板浘鍘熺偣 Y锛圓PP绔帴鍙ｆ枃妗2.md `map_origin_y`锛夛紝BackendWorld(Y-down) 鍥剧墖宸︿笂瑙掍笘鐣屽潗鏍囷紝鍗曚綅绫炽€?*/
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
      unit: pkg.unit ?? '',
      is_use: pkg.is_use ?? false,
      resolution: meta.resolution,
      map_origin_x: meta.origin_x,
      map_origin_y: meta.origin_y,
      increments: pkg.increments,
      timestamp: pkg.timestamp,
      name: pkg.name ?? `地图_${pkg.map_id.slice(0, 8)}`,
      area: pkg.area ?? 150.5,
      thumbnail_url: semanticUrl,
      create_time: pkg.timestamp ?? Date.now() - 86400000,
      update_time: pkg.timestamp ?? Date.now(),
    };
  });
  return { total: mapped.length, items: mapped };
}

