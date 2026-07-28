import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapListResponse } from '../src/fixtures/mapList.fixture';
import { deleteSemanticOverride, setSemanticOverride } from '../src/fixtures/semanticOverrides';
import { applySemanticSave } from '../src/fixtures/semanticSave';

const BASE_URL = 'http://127.0.0.1:9900';
const [{ map_id: MAP_ID }] = buildMapListResponse(BASE_URL).data.items;

const AREA_BOUNDARY_TYPE = 71;
const FORBIDDEN_ZONE_TYPE = 251;

/** 机器侧生成的元素：区域边界 + 充电桩，APP 保存标注时不会带上它们。 */
const ROBOT_INCREMENTS = [
  {
    element_id: 'area-001',
    type: AREA_BOUNDARY_TYPE,
    action: 'add' as const,
    shape: 'polygon' as const,
    points: [
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
      { x: 2, y: -2 },
    ],
    properties: { area: 16 },
    source: 'robot' as const,
  },
  {
    element_id: 'pile-001',
    type: 69,
    action: 'add' as const,
    shape: 'point' as const,
    points: [{ x: 0, y: 0 }],
    properties: {},
    source: 'robot' as const,
  },
];

function seedRobotIncrements(): void {
  setSemanticOverride(MAP_ID, {
    map_id: MAP_ID,
    base_version: 1,
    timestamp: 0,
    unit: 'meter',
    is_use: true,
    increments: ROBOT_INCREMENTS,
  });
}

function currentIncrements() {
  const item = buildMapListResponse(BASE_URL).data.items.find(
    map => map.map_id === MAP_ID,
  );
  assert.ok(item, 'map must exist in map/list');
  return item.increments;
}

function forbiddenZone(elementId: string, x: number) {
  return {
    element_id: elementId,
    type: FORBIDDEN_ZONE_TYPE,
    action: 'add' as const,
    shape: 'polygon' as const,
    points: [
      { x, y: 1 },
      { x: x + 1, y: 1 },
      { x: x + 1, y: 0 },
      { x, y: 0 },
    ],
    properties: {},
  };
}

afterEach(() => {
  deleteSemanticOverride(MAP_ID);
});

describe('semantic/save 增量合并', () => {
  it('保存用户标注后，机器侧的 type=71 区域边界仍在 map/list 里', () => {
    seedRobotIncrements();

    const result = applySemanticSave({
      map_id: MAP_ID,
      base_version: 1,
      unit: 'meter',
      increments: [forbiddenZone('zone-001', 3)],
    });

    assert.equal(result.ok, true);
    const increments = currentIncrements();
    const types = increments.map(increment => increment.type).sort((a, b) => a - b);
    assert.deepEqual(types, [69, 71, 251]);

    const boundary = increments.find(
      increment => increment.type === AREA_BOUNDARY_TYPE,
    );
    assert.ok(boundary, 'type=71 区域边界不能被标注保存抹掉');
    assert.equal(boundary.element_id, 'area-001');
    assert.equal(boundary.points.length, 4);
  });

  it('同 element_id 的 update 覆盖旧几何，不产生重复条目', () => {
    seedRobotIncrements();
    applySemanticSave({
      map_id: MAP_ID,
      base_version: 1,
      increments: [forbiddenZone('zone-001', 3)],
    });

    applySemanticSave({
      map_id: MAP_ID,
      base_version: 2,
      increments: [{ ...forbiddenZone('zone-001', 9), action: 'update' as const }],
    });

    const zones = currentIncrements().filter(
      increment => increment.element_id === 'zone-001',
    );
    assert.equal(zones.length, 1);
    assert.equal(zones[0].points[0].x, 9);
  });

  it('action=delete 移除该 element，其余元素不受影响', () => {
    seedRobotIncrements();
    applySemanticSave({
      map_id: MAP_ID,
      base_version: 1,
      increments: [forbiddenZone('zone-001', 3), forbiddenZone('zone-002', 6)],
    });

    applySemanticSave({
      map_id: MAP_ID,
      base_version: 2,
      increments: [
        { ...forbiddenZone('zone-001', 3), action: 'delete' as const },
      ],
    });

    const ids = currentIncrements().map(increment => increment.element_id);
    assert.deepEqual(ids.sort(), ['area-001', 'pile-001', 'zone-002']);
  });

  it('APP 新画的标注默认落 source=app，机器侧元素的 source 不被改写', () => {
    seedRobotIncrements();
    applySemanticSave({
      map_id: MAP_ID,
      base_version: 1,
      increments: [forbiddenZone('zone-001', 3)],
    });

    const increments = currentIncrements();
    assert.equal(
      increments.find(increment => increment.element_id === 'zone-001')?.source,
      'app',
    );
    assert.equal(
      increments.find(increment => increment.element_id === 'area-001')?.source,
      'robot',
    );
  });

  it('base_version 单调递增，过期版本重放不会把版本推回去', () => {
    seedRobotIncrements();

    const first = applySemanticSave({
      map_id: MAP_ID,
      base_version: 1,
      increments: [forbiddenZone('zone-001', 3)],
    });
    assert.equal(first.ok && first.baseVersion, 2);

    const stale = applySemanticSave({
      map_id: MAP_ID,
      base_version: 1,
      increments: [forbiddenZone('zone-002', 6)],
    });
    assert.equal(stale.ok && stale.baseVersion, 3);
  });

  it('未知 map_id 返回 404', () => {
    const result = applySemanticSave({
      map_id: 'does-not-exist',
      base_version: 1,
      increments: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 404);
  });
});
