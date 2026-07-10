import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { MapStream } from '../src/sim/mapStream';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { Recorder } from '../src/sim/recorder';

type JsonResponse = {
  readonly status: number;
  readonly json: Record<string, unknown>;
};

function postJson(port: number, path: string, body: Record<string, unknown>): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
          });
        });
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

async function createTestServer(robot: VirtualRobot): Promise<http.Server> {
  const server = http.createServer();
  const chaos = new ChaosController();
  const recorder = new Recorder();
  const context: AppRouteContext = {
    port: 0,
    dataDir: '',
    robot,
    mapStream: new MapStream([]),
    chaos,
    scenarioEngine: new ScenarioEngine({ robot, chaos, recorder }),
    recorder,
  };
  server.on('request', createHttpHandler(context));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function serverPort(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

describe('machine detail HTTP route', () => {
  it('validates the requested SN and returns the complete stateful detail payload', async () => {
    const robot = new VirtualRobot({ sn: 'DETAIL-SN', nickname: 'Detail Mower', battery: 86 });
    const server = await createTestServer(robot);

    try {
      const missingSn = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', {});
      assert.equal(missingSn.status, 400);
      assert.equal(missingSn.json.code, 400);
      assert.equal(missingSn.json.message, 'sn is required');

      const unknownRobot = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', {
        sn: 'UNKNOWN-SN',
      });
      assert.equal(unknownRobot.status, 200);
      assert.equal(unknownRobot.json.code, 404);
      assert.equal(unknownRobot.json.message, 'robot not found');

      const response = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', {
        sn: 'DETAIL-SN',
      });
      assert.equal(response.status, 200);
      assert.equal(response.json.code, 200);

      const data = response.json.data as Record<string, unknown>;
      assert.equal(data.deviceId, 'DETAIL-SN');
      assert.equal(data.sn, 'DETAIL-SN');
      assert.equal(data.nickname, 'Detail Mower');
      assert.equal(data.timezone, 'Asia/Shanghai');
      assert.equal(data.unit, 'metric');
      assert.equal(data.battery_level, 86);
      assert.equal(data.battery_charging, 0);
      assert.equal(data.running_status, 'idle');
      assert.equal(data.wifi_connected, 1);
      assert.equal(data.cellular_connected, 0);
      assert.equal(data.bound_map_count, 1);
      assert.equal(typeof data.map_id, 'string');
      assert.match(data.map_url as string, /^http:\/\/127\.0\.0\.1:\d+\/sim\/assets\/full_semanticmap\.png\?map_id=/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });

  it('derives running status and charging state from the same virtual-robot task state', async () => {
    const robot = new VirtualRobot({ sn: 'DETAIL-TASK-SN' });
    const server = await createTestServer(robot);

    try {
      robot.createMowingTask({
        sn: robot.sn,
        task_info: { task_mode: 'global', map_id: 'first_map' },
      });
      const mowing = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', {
        sn: robot.sn,
      });
      assert.equal((mowing.json.data as Record<string, unknown>).running_status, 'mowing');
      assert.equal((mowing.json.data as Record<string, unknown>).battery_charging, 0);

      robot.startRecharge(robot.sn);
      const charging = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', {
        sn: robot.sn,
      });
      assert.equal((charging.json.data as Record<string, unknown>).running_status, 'returning_charge');
      assert.equal((charging.json.data as Record<string, unknown>).battery_charging, 0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });
});
