import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapListResponse } from '../src/fixtures/mapList.fixture';
import { readBasemapAsset, readRealsceneAsset } from '../src/assets/BasemapAsset';

describe('basemap fixture data', () => {
  it('builds map/list response from map_list.json with local asset URLs', () => {
    const res = buildMapListResponse('http://127.0.0.1:9900');
    assert.equal(res.code, 200);
    assert.equal(res.message, 'ok');
    assert.equal(res.data.total, 1);
    assert.equal(res.data.items.length, 1);

    const [map] = res.data.items;
    assert.equal(map.map_id, '00f17a06_afbd_4c13_a89c_128d88f69261');
    assert.equal(map.is_use, true);
    assert.deepEqual(
      map.increments
        .filter(increment => increment.type === 71)
        .map(increment => increment.element_id),
      ['001', '002'],
    );

    for (const item of res.data.items) {
      assert.match(item.map_url, /^http:\/\/127\.0\.0\.1:9900\/sim\/assets\/full_semanticmap\.png\?map_id=/);
      assert.equal(item.semantic_map_url, item.map_url);
      assert.match(item.real_view_map_url, /^http:\/\/127\.0\.0\.1:9900\/sim\/assets\/full_rgbmap\.png\?map_id=/);
    }
  });

  it('builds an isolated adjacent double-lawn merge profile', () => {
    const res = buildMapListResponse('http://127.0.0.1:9900', 'merge');
    assert.equal(res.data.total, 1);

    const [map] = res.data.items;
    assert.equal(map.map_id, 'map_edit_adjacent_double_lawn');
    assert.equal(map.base_version, 1);
    assert.equal(map.resolution, 0.05);
    assert.equal(map.map_origin_x, -4);
    assert.equal(map.map_origin_y, -4);

    const boundaries = map.increments.filter(increment => increment.type === 71);
    assert.deepEqual(boundaries.map(increment => increment.element_id), ['001', '002']);
    assert.deepEqual(boundaries[0].points[1], boundaries[1].points[0]);
    assert.deepEqual(boundaries[0].points[2], boundaries[1].points[3]);
    assert.ok(readBasemapAsset('merge'));
    assert.ok(readRealsceneAsset('merge'));
  });
});
