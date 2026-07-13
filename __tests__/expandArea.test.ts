import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { MapStream } from '../src/sim/mapStream';
import { loadAllPatches } from '../src/assets/PatchLoader';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { Recorder } from '../src/sim/recorder';

const ACTION_PATH = '/ratel/central-control-service/api/v1/ratel_mapping_task/action';
const CREATE_PATH = '/ratel/central-control-service/api/v1/ratel_mapping_task/create';
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

/** Drives the mock FSM from PREPARING to MAP_COMPLETING via the realistic notify sequence. */
function enterMapCompleting(robot: VirtualRobot): void {
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_completing' });
}

/** Cheaply closes N lawns (aisle + edge_start label pairs) without settle timers or actions. */
function closeLawns(robot: VirtualRobot, count: number): void {
  for (let i = 0; i < count; i += 1) {
    robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
    robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_edge_finish' });
  }
}

async function startServer(robot: VirtualRobot): Promise<{ server: http.Server; port: number; mapStream: MapStream }> {
  const server = http.createServer();
  const chaos = new ChaosController();
  const recorder = new Recorder();
  const mapStream = new MapStream(loadAllPatches('mapping_happy'), 'mapping_happy');
  const ctx: AppRouteContext = {
    port: 0,
    dataDir: '',
    robot,
    mapStream,
    chaos,
    scenarioEngine: new ScenarioEngine({ robot, chaos, recorder }),
    recorder,
  };
  server.on('request', createHttpHandler(ctx));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, port: address.port, mapStream };
}

describe('EXPAND_AREA', () => {
  it('rejects EXPAND_AREA with 404 outside an active task and 409 outside MAP_COMPLETING', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPAND-1' });
    const { server, port } = await startServer(robot);
    try {
      const noTask = await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-1', action: 'EXPAND_AREA' });
      assert.equal(noTask.status, 404);

      await postJson(port, CREATE_PATH, { sn: 'SN-EXPAND-1', map_id: 'mock_map_001', mode: 'auto' });
      const wrongPhase = await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-1', action: 'EXPAND_AREA' });
      assert.equal(wrongPhase.status, 409);
    } finally {
      server.close();
    }
  });

  it('switches the dataset, resets sub_status to find_boundary, appends a new aisle label, and cancels the countdown', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPAND-2' });
    const { server, port, mapStream } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-EXPAND-2', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      assert.equal(mapStream.dataset, 'mapping_happy');

      const labelsBefore = await postJson(port, LABELS_PATH, { map_id: 'mock_map_001' });
      const listBefore = (labelsBefore.json.data as Record<string, unknown>).labels as Array<Record<string, unknown>>;
      assert.equal(listBefore.filter(l => l.type === 'aisle').length, 1);

      const dispatchSpy = mock.method(robot, 'dispatchRaw');
      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-2', action: 'EXPAND_AREA' });
      assert.equal(accepted.status, 200);

      assert.equal(mapStream.dataset, 'mapping_lawn2_aisle');
      assert.ok(mapStream.patchCount > 0);
      assert.equal(robot.snapshot().lastNotifySubStatus, 'find_boundary');
      assert.equal(robot.snapshot().mapping.phase, 'MAP_SCAN_BOUNDARY');

      const labelsAfter = await postJson(port, LABELS_PATH, { map_id: 'mock_map_001' });
      const listAfter = (labelsAfter.json.data as Record<string, unknown>).labels as Array<Record<string, unknown>>;
      assert.equal(listAfter.filter(l => l.type === 'aisle').length, 2);

      const detail = await postJson(port, '/ratel/api/v1/courtyard/robot/detail', { sn: 'SN-EXPAND-2' });
      const data = detail.json.data as Record<string, unknown>;
      assert.equal((data.extend_status as Record<string, unknown>).legitimate_starting_point, 0);

      // The lawn-1 120s countdown must be cancelled — ticking it out must not fire another CMD_CONFIRM.
      mock.timers.tick(120_000);
      assert.equal(dispatchSpy.mock.callCount(), 0);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('legitimate_starting_point settles again 3s after EXPAND_AREA, letting EDGE_START succeed for lawn 2', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPAND-3' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-EXPAND-3', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-3', action: 'EXPAND_AREA' });

      const tooSoon = await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-3', action: 'EDGE_START' });
      assert.equal(tooSoon.status, 422);

      mock.timers.tick(3000);
      const started = await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-3', action: 'EDGE_START' });
      assert.equal(started.status, 200);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('rejects EXPAND_AREA with 409 once edge_start label count reaches the 15-lawn cap', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPAND-4' });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-EXPAND-4', map_id: 'mock_map_001', mode: 'auto' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      closeLawns(robot, 15);
      assert.equal(robot.mappingLawnCount(), 15);
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_completing' });

      const res = await postJson(port, ACTION_PATH, { sn: 'SN-EXPAND-4', action: 'EXPAND_AREA' });
      assert.equal(res.status, 409);
    } finally {
      server.close();
    }
  });
});
