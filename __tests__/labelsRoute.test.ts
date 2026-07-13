import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { MapStream } from '../src/sim/mapStream';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { Recorder } from '../src/sim/recorder';

const LABELS_PATH = '/map-service/api/v1/ratel_map/labels';

function postJson(port: number, path: string, body: Record<string, unknown>) {
  return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) as Record<string, unknown> });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function startServer(robot: VirtualRobot): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  const chaos = new ChaosController();
  const recorder = new Recorder();
  const ctx: AppRouteContext = {
    port: 0,
    dataDir: '',
    robot,
    mapStream: new MapStream([]),
    chaos,
    scenarioEngine: new ScenarioEngine({ robot, chaos, recorder }),
    recorder,
  };
  server.on('request', createHttpHandler(ctx));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, port: address.port };
}

describe('POST /map-service/api/v1/ratel_map/labels', () => {
  it('returns an empty list (not an error) for a robot that has never entered a mapping phase', async () => {
    const robot = new VirtualRobot({ sn: 'SN-LABELS-1' });
    const { server, port } = await startServer(robot);
    try {
      const res = await postJson(port, LABELS_PATH, { map_id: 'mock_map_001' });
      assert.equal(res.status, 200);
      assert.equal(res.json.code, 200);
      const data = res.json.data as Record<string, unknown>;
      assert.equal(data.map_id, 'mock_map_001');
      assert.deepEqual(data.labels, []);
    } finally {
      server.close();
    }
  });

  it('does not crash on a missing map_id and defaults it, without ever emitting a malformed label', async () => {
    const robot = new VirtualRobot({ sn: 'SN-LABELS-2' });
    const { server, port } = await startServer(robot);
    try {
      const missingBody = await postJson(port, LABELS_PATH, {});
      assert.equal(missingBody.status, 200);
      assert.equal((missingBody.json.data as Record<string, unknown>).map_id, 'mock_map_001');

      robot.createMappingTask({ sn: 'SN-LABELS-2', map_id: 'mock_map_001', mode: 'auto' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_edge_finish' });

      const res = await postJson(port, LABELS_PATH, {});
      const labels = (res.json.data as Record<string, unknown>).labels as Array<Record<string, unknown>>;
      assert.ok(labels.length > 0);
      assert.deepEqual(labels[0].points, [{ x: 10.3, y: 6.45 }, { x: 12.3, y: 8.45 }]);
      assert.deepEqual(labels[1].points, [{ x: 11.3, y: 7.45 }]);
      for (const label of labels) {
        assert.equal(typeof label.id, 'string');
        assert.ok((label.id as string).length > 0);
        assert.ok(label.type === 'edge_start' || label.type === 'aisle');
        assert.equal(label.shape, 'point');
        const points = label.points as Array<Record<string, unknown>>;
        assert.ok(Array.isArray(points) && points.length > 0);
        for (const point of points) {
          assert.equal(typeof point.x, 'number');
          assert.equal(typeof point.y, 'number');
          assert.ok(Number.isFinite(point.x as number));
          assert.ok(Number.isFinite(point.y as number));
        }
      }
    } finally {
      server.close();
    }
  });
});
