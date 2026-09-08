import { it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleMapRoutes } from '../src/http/routes/map.routes';
import type { AppRouteContext } from '../src/http/router';
import { buildMapListResponse, type MapListResponse } from '../src/fixtures/mapList.fixture';
import { setSemanticOverride, deleteSemanticOverride } from '../src/fixtures/semanticOverrides';

it('HTTP cut -> map/list -> merge -> map/list keeps annotations and advances versions', async () => {
  const mapId = buildMapListResponse('http://localhost').data.items[0].map_id;
  const boundary = {
    element_id: 'source', type: 71, shape: 'polygon' as const, source: 'robot' as const,
    points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
  };
  const obstacle = { ...boundary, element_id: 'obstacle', type: 2, source: 'app' as const };
  setSemanticOverride(mapId, {
    map_id: mapId, base_version: 1, timestamp: 0, unit: '', increments: [boundary, obstacle],
  });
  const ctx = { port: 0 } as AppRouteContext;
  const server = http.createServer((req, res) => {
    void Promise.resolve(handleMapRoutes(req, res, new URL(req.url!, 'http://localhost'), ctx)).catch(error => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const list = async () => {
      const response = await fetch(`${base}/ratel/map-service/api/v1/ratel/map/list`);
      const json = await response.json() as MapListResponse;
      return json.data.items.find(item => item.map_id === mapId)!;
    };
    const edit = async (baseVersion: number, action: string, id: string[], points: { x: number; y: number }[]) => {
      const response = await fetch(`${base}/ratel/api/v1/map/topology/edit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ map_id: mapId, base_version: baseVersion, unit: 'meter', area: [{ action, id, points }] }),
      });
      assert.equal(response.status, 200);
      const json = await response.json() as { code: number; data: { robot_code: number; base_version: number } };
      assert.equal(json.code, 200);
      assert.equal(json.data.robot_code, 0);
      assert.equal(json.data.base_version, baseVersion + 1);
    };
    await edit(1, 'cut', ['source'], [{ x: -1, y: 2 }, { x: 5, y: 2 }]);
    const cut = await list();
    const children = cut.increments.filter(item => item.type === 71);
    assert.equal(children.length, 2);
    assert.equal(cut.base_version, 2);
    await edit(cut.base_version, 'merge', ['result', ...children.map(item => item.element_id)], [{ x: 2, y: 1 }, { x: 2, y: 3 }]);
    const merged = await list();
    assert.equal(merged.base_version, 3);
    assert.equal(merged.area, 16);
    assert.deepEqual(merged.increments.filter(item => item.type === 71).map(item => item.element_id), ['result']);
    assert.deepEqual(merged.increments.find(item => item.element_id === 'obstacle'), obstacle);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    deleteSemanticOverride(mapId);
  }
});
