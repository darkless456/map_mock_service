import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTopologyEdit } from '../src/fixtures/topologyEdit';
import { buildMapListResponse } from '../src/fixtures/mapList.fixture';
import { deleteSemanticOverride, setSemanticOverride } from '../src/fixtures/semanticOverrides';
import { applySemanticSave } from '../src/fixtures/semanticSave';

const BASE_URL = 'http://127.0.0.1:9900';
const [{ map_id: MAP_ID }] = buildMapListResponse(BASE_URL).data.items;

// Two 2x4 rectangles sharing a straight 4m edge along x=0, forming a 4x4 square.
const ADJACENT_SQUARE_LAWN_INCREMENTS = [
  {
    element_id: '001',
    type: 71,
    action: 'add' as const,
    shape: 'polygon' as const,
    points: [
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
      { x: 2, y: -2 },
    ],
    properties: { area: 8 },
    source: 'robot' as const,
  },
  {
    element_id: '002',
    type: 71,
    action: 'add' as const,
    shape: 'polygon' as const,
    points: [
      { x: 0, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
      { x: 0, y: -2 },
    ],
    properties: { area: 8 },
    source: 'robot' as const,
  },
];

function seedAdjacentSquareLawn(): void {
  setSemanticOverride(MAP_ID, {
    map_id: MAP_ID,
    base_version: 1,
    timestamp: 0,
    unit: 'meter',
    is_use: true,
    increments: ADJACENT_SQUARE_LAWN_INCREMENTS,
  });
}

afterEach(() => {
  deleteSemanticOverride(MAP_ID);
});

describe('topology edit fixture state', () => {
  it('merges adjacent 001/002 and publishes the new boundary in map/list', () => {
    seedAdjacentSquareLawn();

    const result = applyTopologyEdit({
      sn: 'MOCK:00:11:22:33:44',
      map_id: MAP_ID,
      base_version: 1,
      unit: 'meter',
      area: [
        {
          id: ['merged-area', '001', '002'],
          action: 'merge',
          points: [],
        },
      ],
    });

    assert.deepEqual(result, {
      ok: true,
      mapId: MAP_ID,
      baseVersion: 2,
      resultAreaId: 'merged-area',
    });

    const [map] = buildMapListResponse(BASE_URL).data.items;
    assert.equal(map.base_version, 2);
    assert.equal(map.area, 16);
    const boundaries = map.increments.filter(increment => increment.type === 71);
    assert.equal(boundaries.length, 1);
    assert.equal(boundaries[0].element_id, 'merged-area');
    assert.deepEqual(boundaries[0].points, [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
    ]);
  });

  it('rejects a stale base version without changing map/list', () => {
    seedAdjacentSquareLawn();

    const result = applyTopologyEdit({
      map_id: MAP_ID,
      base_version: 99,
      area: [{ id: ['merged-area', '001', '002'], action: 'merge', points: [] }],
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
    assert.equal(
      buildMapListResponse(BASE_URL).data.items[0].base_version,
      1,
    );
  });
});

describe('cut and merge workflows', () => {
  const current = () => buildMapListResponse(BASE_URL).data.items[0];
  const edit = (action: string, id: string[], points: unknown = []) => applyTopologyEdit({
    map_id: MAP_ID, base_version: current().base_version, unit: 'meter', area: [{ action, id, points }],
  });

  it('retains annotations across cut, refresh, merge, annotation save and another cut', () => {
    seedAdjacentSquareLawn();
    const obstacle = {
      element_id: 'keep-out', type: 2, shape: 'polygon' as const, action: 'add' as const,
      points: [{ x: 1, y: 1 }, { x: 1.2, y: 1 }, { x: 1, y: 1.2 }],
    };
    assert.equal(applySemanticSave({ map_id: MAP_ID, increments: [obstacle] }).ok, true);
    assert.equal(edit('cut', ['001'], [{ x: -1, y: 0 }, { x: 3, y: 0 }]).ok, true);
    const splitMap = current();
    const children = splitMap.increments.filter(item => item.type === 71 && item.element_id !== '002');
    assert.equal(splitMap.base_version, 3);
    assert.equal(splitMap.area, 16);
    assert.equal(children.length, 2);
    assert.equal(new Set(children.map(item => item.element_id)).size, 2);
    assert.ok(children.every(item => item.element_id !== '001' && item.source === 'robot' && item.properties?.area === 4));
    assert.equal(edit('merge', ['rejoined', ...children.map(item => item.element_id)]).ok, true);
    assert.equal(current().base_version, 4);
    assert.equal(current().increments.filter(item => item.type === 71).length, 2);
    assert.equal(applySemanticSave({ map_id: MAP_ID, increments: [{ ...obstacle, action: 'update' }] }).ok, true);
    assert.equal(edit('cut', ['rejoined'], [{ x: 1, y: -3 }, { x: 1, y: 3 }]).ok, true);
    assert.equal(current().base_version, 6);
    assert.equal(current().area, 16);
    assert.deepEqual(current().increments.find(item => item.element_id === '002'), ADJACENT_SQUARE_LAWN_INCREMENTS[1]);
    assert.deepEqual(current().increments.find(item => item.element_id === 'keep-out'), { ...obstacle, source: 'app' });
  });

  it('merges partial shared edges and equal winding regardless of source order', () => {
    seedAdjacentSquareLawn();
    assert.equal(edit('cut', ['001'], [{ x: -1, y: 0 }, { x: 3, y: 0 }]).ok, true);
    const ids = current().increments.filter(item => item.type === 71).map(item => item.element_id).reverse();
    assert.equal(edit('merge', ['whole', ...ids]).ok, true);
    assert.equal(current().area, 16);
    assert.equal(current().increments.filter(item => item.type === 71).length, 1);
  });

  it('supports a diagonal cut and merging its children', () => {
    seedAdjacentSquareLawn();
    assert.equal(edit('cut', ['001'], [{ x: -1, y: -3 }, { x: 3, y: 3 }]).ok, true);
    const children = current().increments.filter(item => item.type === 71 && item.element_id !== '002');
    assert.equal(children.length, 2);
    assert.equal(edit('merge', ['diagonal-merged', ...children.map(item => item.element_id)]).ok, true);
    assert.ok(Math.abs(current().area! - 16) < 1e-7);
  });

  for (const [name, points, status] of [
    ['empty', [], 400],
    ['zero length', [{ x: 1, y: 0 }, { x: 1, y: 0 }], 400],
    ['invalid number', [{ x: NaN, y: 0 }, { x: 3, y: 0 }], 400],
    ['outside', [{ x: -1, y: 3 }, { x: 3, y: 3 }], 422],
    ['interior stroke', [{ x: 0.5, y: 0 }, { x: 1.5, y: 0 }], 422],
    ['along boundary', [{ x: -1, y: 2 }, { x: 3, y: 2 }], 422],
  ] as const) {
    it(`rejects ${name} without mutating the map`, () => {
      seedAdjacentSquareLawn();
      const before = current();
      const result = edit('cut', ['001'], points);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, status);
      assert.deepEqual(current(), before);
    });
  }

  it('rejects stale cuts and missing source ids without mutation', () => {
    seedAdjacentSquareLawn();
    const before = current();
    const stale = applyTopologyEdit({ map_id: MAP_ID, base_version: 0, area: [{ action: 'cut', id: ['001'], points: [] }] });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.status, 409);
    const missing = edit('cut', ['missing'], [{ x: -1, y: 0 }, { x: 3, y: 0 }]);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);
    assert.deepEqual(current(), before);
  });
});
