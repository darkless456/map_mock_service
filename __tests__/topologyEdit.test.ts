import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTopologyEdit } from '../src/fixtures/topologyEdit';
import { buildMapListResponse } from '../src/fixtures/mapList.fixture';
import { deleteSemanticOverride } from '../src/fixtures/semanticOverrides';

const MAP_ID = 'map_edit_adjacent_double_lawn';

afterEach(() => {
  deleteSemanticOverride(MAP_ID);
});

describe('topology edit fixture state', () => {
  it('merges adjacent 001/002 and publishes the new boundary in map/list', () => {
    const result = applyTopologyEdit(
      {
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
      },
      'merge',
    );

    assert.deepEqual(result, {
      ok: true,
      mapId: MAP_ID,
      baseVersion: 2,
      resultAreaId: 'merged-area',
    });

    const [map] = buildMapListResponse('http://127.0.0.1:9900', 'merge').data.items;
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
    const result = applyTopologyEdit(
      {
        map_id: MAP_ID,
        base_version: 99,
        area: [{ id: ['merged-area', '001', '002'], action: 'merge', points: [] }],
      },
      'merge',
    );

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 409);
    assert.equal(
      buildMapListResponse('http://127.0.0.1:9900', 'merge').data.items[0].base_version,
      1,
    );
  });
});
