import path from 'node:path';
import { fixtureLoader, FIXTURE_ROOT } from '../fixtures';

/**
 * 地图元数据（resolution / origin）。
 *
 * 语义图与实景图共享同一世界坐标系：同一 `resolution` 与同一 `origin`。
 * `origin_x / origin_y` 为后端 BackendWorld(Y-down) 下图片左上角像素对应的世界坐标。
 */
export interface MapMetadata {
  /** 米 / 像素。 */
  readonly resolution: number;
  /** 图片左上角在 BackendWorld(Y-down) 中的 X 坐标（米）。 */
  readonly origin_x: number;
  /** 图片左上角在 BackendWorld(Y-down) 中的 Y 坐标（米）。 */
  readonly origin_y: number;
}

interface MapMetadataFixture {
  readonly default: MapMetadata;
  readonly maps: Readonly<Record<string, MapMetadata>>;
}

export function getMapMetadata(mapId: string): MapMetadata {
  const fixture = readMapMetadataFixture();
  return fixture.maps[mapId] ?? fixture.default;
}

function readMapMetadataFixture(): MapMetadataFixture {
  return fixtureLoader.read('maps/metadata.jsonc', validateMapMetadataFixture);
}

function validateMapMetadataFixture(parsed: unknown): MapMetadataFixture {
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !isMapMetadata((parsed as { default?: unknown }).default) ||
    typeof (parsed as { maps?: unknown }).maps !== 'object' ||
    (parsed as { maps?: unknown }).maps === null
  ) {
    throw new Error(`${path.join(FIXTURE_ROOT, 'maps/metadata.jsonc')} must contain { default, maps } metadata`);
  }
  return parsed as MapMetadataFixture;
}

function isMapMetadata(value: unknown): value is MapMetadata {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { resolution?: unknown }).resolution === 'number' &&
    typeof (value as { origin_x?: unknown }).origin_x === 'number' &&
    typeof (value as { origin_y?: unknown }).origin_y === 'number'
  );
}
