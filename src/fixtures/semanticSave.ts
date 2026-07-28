/**
 * semantic/save 的增量合并。
 *
 * `semantic/save` 收到的是 **delta**（每条 increment 带 `action: add/update/delete`），
 * 不是整张地图的快照。此前 mock 直接把请求体整包写进 `setSemanticOverride`，等于用
 * "只含用户标注的包"替换掉整张地图的 increments —— 机器侧生成的草坪区域边界
 * （`type=71`）、通道（70）、充电桩（69）等会在一次保存后全部消失，APP 上表现为
 * 保存标注后区域面 / 边框不再显示。
 *
 * 这里改为按 `element_id` 合并，与 `topologyEdit.ts` 的写回语义保持一致：
 *  - `delete`        → 从现有集合中移除该 element；
 *  - `add` / `update`→ upsert（同 id 覆盖，否则追加）；
 *  - 请求里没提到的 element 一律原样保留。
 *
 * 合并基底取 `map/list` 当前结果（已包含既有 override），因此连续多次保存可累积。
 */

import { buildMapListResponse } from './mapList.fixture';
import {
  getSemanticOverride,
  setSemanticOverride,
  type IncrementPackage,
  type ProtocolIncrement,
} from './semanticOverrides';

export type SemanticSaveResult =
  | { readonly ok: true; readonly mapId: string; readonly baseVersion: number }
  | { readonly ok: false; readonly status: number; readonly message: string };

/** 仅用于取基底数据，URL 不会出现在写回结果里。 */
const INTERNAL_BASE_URL = 'http://semantic-save.local';

function elementId(increment: ProtocolIncrement): string {
  return increment.element_id;
}

/**
 * 把一批 delta 合并进现有 increments。
 *
 * `source` 的处理：`semantic/save` 协议不回传 source，所以更新已有 element 时沿用旧值，
 * 新增时按"来自 APP"落 `'app'` —— 否则重新拉取后 APP 会把自己刚画的标注当成机器所有
 * 的只读元素。
 */
export function mergeIncrements(
  base: IncrementPackage['increments'],
  delta: IncrementPackage['increments'],
): ProtocolIncrement[] {
  const merged: ProtocolIncrement[] = base.map(increment => ({ ...increment }));
  const indexById = new Map<string, number>();
  merged.forEach((increment, index) => indexById.set(elementId(increment), index));

  const removed = new Set<number>();

  for (const increment of delta) {
    const id = elementId(increment);
    const existingIndex = indexById.get(id);

    if (increment.action === 'delete') {
      if (existingIndex !== undefined) removed.add(existingIndex);
      continue;
    }

    const previous = existingIndex !== undefined ? merged[existingIndex] : undefined;
    const next: ProtocolIncrement = {
      ...increment,
      action: 'add',
      source: increment.source ?? previous?.source ?? 'app',
    };

    if (existingIndex === undefined) {
      indexById.set(id, merged.length);
      merged.push(next);
    } else {
      merged[existingIndex] = next;
      removed.delete(existingIndex);
    }
  }

  return merged.filter((_, index) => !removed.has(index));
}

export function applySemanticSave(
  body: Record<string, unknown> & {
    map_id: string;
    increments: IncrementPackage['increments'];
  },
): SemanticSaveResult {
  const mapId = body.map_id;
  const map = buildMapListResponse(INTERNAL_BASE_URL).data.items.find(
    item => item.map_id === mapId,
  );
  if (!map) return { ok: false, status: 404, message: `map ${mapId} not found` };

  const requestedBaseVersion =
    typeof body.base_version === 'number' && Number.isFinite(body.base_version)
      ? body.base_version
      : map.base_version;
  // 版本单调递增：即使客户端拿着过期 base_version 重放，也不会把版本号推回去。
  const nextVersion = Math.max(requestedBaseVersion, map.base_version) + 1;

  const previousOverride = getSemanticOverride(mapId);
  const pkg: IncrementPackage = {
    name:
      typeof body.name === 'string'
        ? body.name
        : previousOverride?.name ?? (typeof map.name === 'string' ? map.name : undefined),
    area:
      typeof body.area === 'number'
        ? body.area
        : typeof body.lawn_area === 'number'
          ? body.lawn_area
          : previousOverride?.area ?? (typeof map.area === 'number' ? map.area : undefined),
    map_id: mapId,
    base_version: nextVersion,
    timestamp: Date.now(),
    unit:
      typeof body.unit === 'string'
        ? (body.unit as IncrementPackage['unit'])
        : 'meter',
    is_use: previousOverride?.is_use ?? map.is_use,
    increments: mergeIncrements(map.increments, body.increments),
  };

  setSemanticOverride(mapId, pkg);

  return { ok: true, mapId, baseVersion: nextVersion };
}
