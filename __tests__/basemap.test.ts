import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapListResponse } from '../src/fixtures/mapList.fixture';

describe('basemap fixture data', () => {
  it('builds map/list response from map_list.json with local asset URLs', () => {
    const res = buildMapListResponse('http://127.0.0.1:9900');
    assert.equal(res.code, 200);
    assert.equal(res.message, 'ok');
    assert.equal(res.data.total, 2);
    assert.equal(res.data.items.length, 2);

    const [map] = res.data.items;
    assert.equal(map.map_id, '0796e779_59c7_4533_b800_132148497ffd');
    assert.equal(map.is_use, true);
    assert.deepEqual(
      map.increments
        .filter(increment => increment.type === 71)
        .map(increment => increment.element_id),
      ['001', '002', '003'],
    );

    for (const item of res.data.items) {
      assert.match(item.map_url, /^http:\/\/127\.0\.0\.1:9900\/sim\/assets\/full_semanticmap\.png\?map_id=/);
      assert.equal(item.semantic_map_url, item.map_url);
      assert.match(item.real_view_map_url, /^http:\/\/127\.0\.0\.1:9900\/sim\/assets\/full_rgbmap\.png\?map_id=/);
    }
  });
});
