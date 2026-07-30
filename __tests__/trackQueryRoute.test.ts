import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { MapStream } from '../src/sim/mapStream';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { Recorder } from '../src/sim/recorder';

const TRACK_PATH = '/location-collection-service/api/location/track/query';
const TRACK_SCENARIO_PATH = '/sim/track-query';
const TASK_STATUS_PATH = '/sim/mapping-task/status';
const TASK_LIST_PATH = '/ratel/central-control-service/api/v1/ratel_mapping_task/list';

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

type TrackPoint = { map_id: string; x: number; y: number; angle: number };

function dataOf(json: Record<string, unknown>): { list: TrackPoint[]; total: number } {
  const data = json.data as Record<string, unknown>;
  return { list: data.list as TrackPoint[], total: data.total as number };
}

const MAP = 'mock_map_001';
const OK_QUERY = { sn: 'SN-TRACK', start_timestamp: 1785150000, end_timestamp: 1785150600, map_id: MAP, limit: 20000, offset: 0 };

describe(`POST ${TRACK_PATH}`, () => {
  it('returns a clean synthetic trajectory in the label coordinate frame', async () => {
    const robot = new VirtualRobot({ sn: 'SN-TRACK' });
    const { server, port } = await startServer(robot);
    try {
      const res = await postJson(port, TRACK_PATH, OK_QUERY);
      assert.equal(res.status, 200);
      assert.equal(res.json.code, 200);
      const { list, total } = dataOf(res.json);
      assert.ok(list.length > 0);
      assert.equal(total, list.length);
      for (const p of list) {
        assert.equal(p.map_id, MAP);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle));
      }
      // Anchored at the first lawn edge_start (11.3, 7.45).
      assert.deepEqual({ x: list[0].x, y: list[0].y }, { x: 11.3, y: 7.45 });
    } finally {
      server.close();
    }
  });

  it('400s when end_timestamp <= start_timestamp (contract §8.1)', async () => {
    const robot = new VirtualRobot({ sn: 'SN-TRACK' });
    const { server, port } = await startServer(robot);
    try {
      const res = await postJson(port, TRACK_PATH, { ...OK_QUERY, start_timestamp: 1785150600, end_timestamp: 1785150600 });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });

  it('defaults map_id to the active mapping task when omitted', async () => {
    const robot = new VirtualRobot({ sn: 'SN-TRACK' });
    robot.createMappingTask({ sn: 'SN-TRACK', map_id: 'map_from_task', mode: 'auto' });
    const { server, port } = await startServer(robot);
    try {
      const { map_id, ...noMap } = OK_QUERY;
      void map_id;
      const res = await postJson(port, TRACK_PATH, noMap);
      const { list } = dataOf(res.json);
      assert.equal(list[0].map_id, 'map_from_task');
    } finally {
      server.close();
    }
  });

  describe('fault injection (§19.5)', () => {
    async function withScenario(sn: string, scenario: Record<string, unknown>, query = OK_QUERY) {
      const robot = new VirtualRobot({ sn });
      const { server, port } = await startServer(robot);
      try {
        const setRes = await postJson(port, TRACK_SCENARIO_PATH, scenario);
        assert.equal(setRes.status, 200);
        return await postJson(port, TRACK_PATH, query);
      } finally {
        server.close();
      }
    }

    it('empty: returns an empty list', async () => {
      const res = await withScenario('SN-EMPTY', { mode: 'empty' });
      const { list, total } = dataOf(res.json);
      assert.deepEqual(list, []);
      assert.equal(total, 0);
    });

    it('truncate: returns exactly `limit` points (trips history_truncated)', async () => {
      const res = await withScenario('SN-TRUNC', { mode: 'truncate' }, { ...OK_QUERY, limit: 50 });
      const { list } = dataOf(res.json);
      assert.equal(list.length, 50);
    });

    it('map_id_mismatch: includes points from a different map', async () => {
      const res = await withScenario('SN-MISMATCH', { mode: 'map_id_mismatch' });
      const { list } = dataOf(res.json);
      assert.ok(list.some(p => p.map_id !== MAP));
      assert.ok(list.some(p => p.map_id === MAP));
    });

    it('non_finite: includes non-finite x/y and a non-finite angle (JSON encodes as null)', async () => {
      const res = await withScenario('SN-NAN', { mode: 'non_finite' });
      const { list } = dataOf(res.json);
      // JSON.stringify turns NaN/Infinity into null.
      assert.ok(list.some(p => p.x === null || p.y === null));
      assert.ok(list.some(p => p.x === 1e12));
      assert.ok(list.some(p => p.angle === null));
    });

    it('jump: includes a >5m discontinuity', async () => {
      const res = await withScenario('SN-JUMP', { mode: 'jump' });
      const { list } = dataOf(res.json);
      let maxJump = 0;
      for (let i = 1; i < list.length; i += 1) {
        const d = Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y);
        if (Number.isFinite(d)) maxJump = Math.max(maxJump, d);
      }
      assert.ok(maxJump > 5, `expected a >5m jump, got ${maxJump}`);
    });

    it('error: returns the injected HTTP error status', async () => {
      const res = await withScenario('SN-ERR', { mode: 'error', errorStatus: 500 });
      assert.equal(res.status, 500);
    });

    it('delay: applies the injected per-route delay', async () => {
      const robot = new VirtualRobot({ sn: 'SN-DELAY' });
      const { server, port } = await startServer(robot);
      try {
        await postJson(port, TRACK_SCENARIO_PATH, { mode: 'normal', delayMs: 120 });
        const startedAt = Date.now();
        const res = await postJson(port, TRACK_PATH, OK_QUERY);
        assert.equal(res.status, 200);
        assert.ok(Date.now() - startedAt >= 100, 'expected the response to be delayed');
      } finally {
        server.close();
      }
    });
  });
});

describe(`terminal task scenarios via ${TASK_STATUS_PATH}`, () => {
  async function forceStatusAndList(status: string, extra: Record<string, unknown> = {}) {
    const robot = new VirtualRobot({ sn: 'SN-TERM' });
    const { server, port } = await startServer(robot);
    try {
      const setRes = await postJson(port, TASK_STATUS_PATH, { status, ...extra });
      assert.equal(setRes.status, 200);
      const listRes = await postJson(port, TASK_LIST_PATH, { sn: 'SN-TERM', limit: 20 });
      const data = listRes.json.data as { list: Array<Record<string, unknown>> };
      return data.list[0];
    } finally {
      server.close();
    }
  }

  for (const status of ['COMPLETE', 'CANCEL', 'FAILED']) {
    it(`list[0] reflects a forced ${status} task`, async () => {
      const top = await forceStatusAndList(status);
      assert.equal(top.task_status, status);
    });
  }

  it('COMPLETE with ageMs backdates update_time past the 120s countdown', async () => {
    const top = await forceStatusAndList('COMPLETE', { ageMs: 200_000 });
    const nowSec = Math.floor(Date.now() / 1000);
    assert.ok(nowSec - (top.update_time as number) >= 120, 'update_time should be > 120s in the past');
  });

  it('FAILED carries task_error_code and message', async () => {
    const robot = new VirtualRobot({ sn: 'SN-TERM' });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, TASK_STATUS_PATH, { status: 'FAILED', message: 'boom', errorCode: -1 });
      const listRes = await postJson(port, TASK_LIST_PATH, { sn: 'SN-TERM', limit: 20 });
      const data = listRes.json.data as { list: Array<Record<string, unknown>> };
      const notify = data.list[0].task_notify as Record<string, unknown>;
      assert.equal(notify.task_message, 'boom');
      assert.equal(notify.task_error_code, -1);
    } finally {
      server.close();
    }
  });

  it('rejects an unknown status', async () => {
    const robot = new VirtualRobot({ sn: 'SN-TERM' });
    const { server, port } = await startServer(robot);
    try {
      const res = await postJson(port, TASK_STATUS_PATH, { status: 'BOGUS' });
      assert.equal(res.status, 400);
    } finally {
      server.close();
    }
  });
});
