import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTopologyEdit } from '../src/fixtures/topologyEdit';
import { buildMapListResponse } from '../src/fixtures/mapList.fixture';
import { deleteSemanticOverride, setSemanticOverride } from '../src/fixtures/semanticOverrides';

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
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
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
