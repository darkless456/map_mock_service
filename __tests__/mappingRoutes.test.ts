import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { MapStream } from '../src/sim/mapStream';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { Recorder } from '../src/sim/recorder';

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

describe('mapping HTTP routes', () => {
  it('POST /ratel/api/v1/mapping/check returns conditions per APP doc', async () => {
    const server = http.createServer();
    const robot = new VirtualRobot({ sn: 'MOCK:00:11:22:33:44' });
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

    try {
      const res = await postJson(address.port, '/ratel/api/v1/mapping/check', {
        sn: 'MOCK:00:11:22:33:44',
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.code, 200);
      const data = res.json.data as { all_ok: number; conditions: Record<string, string> };
      assert.equal(data.all_ok, 0);
      assert.equal(data.conditions.bluetooth_status, 'ok');
      assert.equal(data.conditions.wifi, '');

      const selfCheck = await postJson(address.port, '/ratel/api/v1/robot/self_check', {
        sn: 'MOCK:00:11:22:33:44',
      });
      assert.equal(selfCheck.status, 200);

      let complete = false;
      for (let i = 0; i < 8 && !complete; i += 1) {
        const polled = await postJson(address.port, '/ratel/api/v1/mapping/check', {
          sn: 'MOCK:00:11:22:33:44',
        });
        const polledData = polled.json.data as {
          all_ok: number;
          conditions: Record<string, string>;
        };
        if (
          polledData.conditions.wifi &&
          polledData.conditions.light &&
          polledData.all_ok === 1
        ) {
          complete = true;
        }
      }
      assert.equal(complete, true);
    } finally {
      server.close();
    }
  });
});
