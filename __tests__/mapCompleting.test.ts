import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { MapStream } from '../src/sim/mapStream';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { Recorder } from '../src/sim/recorder';

const ACTION_PATH = '/ratel/central-control-service/api/v1/ratel_mapping_task/action';
const CREATE_PATH = '/ratel/central-control-service/api/v1/ratel_mapping_task/create';

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

describe('MAP_COMPLETING lifecycle + COMPLETE action', () => {
  it('rejects COMPLETE outside MAP_COMPLETING (409) and outside an active task (404)', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-1' });
    const { server, port } = await startServer(robot);
    try {
      const noTask = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-1', action: 'COMPLETE' });
      assert.equal(noTask.status, 404);

      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-1', map_id: 'mock_map_001', mode: 'auto' });
      const wrongPhase = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-1', action: 'COMPLETE' });
      assert.equal(wrongPhase.status, 409);
    } finally {
      server.close();
    }
  });

  it('COMPLETE succeeds in MAP_COMPLETING, completes the task immediately, and rejects a duplicate call with 409', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-2' });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-2', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETING');

      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-2', action: 'COMPLETE' });
      assert.equal(accepted.status, 200);
      assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
      assert.equal(robot.activeMappingTask()?.status, 'COMPLETE');

      const duplicate = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-2', action: 'COMPLETE' });
      assert.equal(duplicate.status, 409);
    } finally {
      server.close();
    }
  });

  it('auto-completes 120s after entering MAP_COMPLETING when COMPLETE is never called', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-3' });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      robot.createMappingTask({ sn: 'SN-COMPLETE-3', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      assert.equal(robot.snapshot().mapping.state, 'WORKING');

      mock.timers.tick(119_999);
      assert.equal(robot.snapshot().mapping.state, 'WORKING');

      mock.timers.tick(1);
      assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
      assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETING');
    } finally {
      mock.timers.reset();
    }
  });

  it('an explicit COMPLETE call cancels the pending 120s auto-complete timer', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-4' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-4', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-4', action: 'COMPLETE' });
      assert.equal(accepted.status, 200);

      const dispatchSpy = mock.method(robot, 'dispatchRaw');
      mock.timers.tick(120_000);
      // No further CMD_CONFIRM should fire from the (already-cancelled) countdown.
      assert.equal(dispatchSpy.mock.callCount(), 0);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('sub_status_entered_at refreshes when entering MAP_COMPLETING and robot/detail reflects it', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-5' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['Date'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-5', map_id: 'mock_map_001', mode: 'auto' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
      const enteredAtBoundary = robot.snapshot().lastNotifySubStatusEnteredAt;

      mock.timers.tick(1_000);
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_completing' });
      const detail = await postJson(port, '/ratel/api/v1/courtyard/robot/detail', { sn: 'SN-COMPLETE-5' });
      const data = detail.json.data as Record<string, unknown>;
      assert.equal(data.sub_status, 'map_completing');
      assert.ok(typeof data.sub_status_entered_at === 'number');
      assert.notEqual(data.sub_status_entered_at, enteredAtBoundary);
      assert.equal((data.extend_status as Record<string, unknown>).area_complete_map_build, 1);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });
});
