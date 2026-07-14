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

describe('ratel_mapping_task/action EDGE_START/EDGE_CLOSE', () => {
  it('rejects malformed input with 400 and unknown task with 404', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EDGE-1' });
    const { server, port } = await startServer(robot);
    try {
      const missingSn = await postJson(port, ACTION_PATH, { action: 'EDGE_START' });
      assert.equal(missingSn.status, 400);

      const badAction = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-1', action: 'NOT_A_REAL_ACTION' });
      assert.equal(badAction.status, 400);

      const noTask = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-1', action: 'EDGE_START' });
      assert.equal(noTask.status, 404);
    } finally {
      server.close();
    }
  });

  it('requires MAP_SCAN_BOUNDARY_MANUAL and a legitimate starting point before accepting EDGE_START', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EDGE-2' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-EDGE-2', map_id: 'mock_map_001', mode: 'remote' });

      // Task exists but is still PREPARING/UNDOCKING (not MAP_SCAN_BOUNDARY_MANUAL yet) -> 409.
      const wrongPhase = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-2', action: 'EDGE_START' });
      assert.equal(wrongPhase.status, 409);

      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
      assert.equal(robot.snapshot().mapping.phase, 'MAP_SCAN_BOUNDARY_MANUAL');

      // Correct phase, but the settle timer (batch 1) hasn't flipped legitimate_starting_point yet -> 422.
      const notYetLegit = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-2', action: 'EDGE_START' });
      assert.equal(notYetLegit.status, 422);

      mock.timers.tick(3000);
      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-2', action: 'EDGE_START' });
      assert.equal(accepted.status, 200);
      // Acceptance must not optimistically flip sub_status (Appendix C #2).
      assert.equal(robot.snapshot().lastNotifySubStatus, 'find_boundary');

      // An accepted action is device-busy until its authoritative async ack arrives.
      const duplicate = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-2', action: 'EDGE_START' });
      assert.equal(duplicate.status, 409);

      mock.timers.tick(800);
      assert.equal(robot.snapshot().lastNotifySubStatus, 'edge_mapping');
      assert.equal(robot.snapshot().mapping.phase, 'MAP_FOLLOW_BOUNDARY_MANUAL');
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('EDGE_CLOSE settles legitimate_end_point and asynchronously acks map_edge_finish', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EDGE-3' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-EDGE-3', map_id: 'mock_map_001', mode: 'auto' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });

      const wrongPhase = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-3', action: 'EDGE_CLOSE' });
      assert.equal(wrongPhase.status, 409);

      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'edge_mapping' });
      const notYetLegit = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-3', action: 'EDGE_CLOSE' });
      assert.equal(notYetLegit.status, 422);

      mock.timers.tick(3000);
      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-3', action: 'EDGE_CLOSE' });
      assert.equal(accepted.status, 200);
      assert.equal(robot.snapshot().lastNotifySubStatus, 'edge_mapping');

      const duplicate = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-3', action: 'EDGE_CLOSE' });
      assert.equal(duplicate.status, 409);

      mock.timers.tick(800);
      assert.equal(robot.snapshot().lastNotifySubStatus, 'map_edge_finish');
      assert.equal(robot.snapshot().mapping.phase, 'MAP_BOUNDARY_DONE');
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('rejects EDGE_START/EDGE_CLOSE on a paused task with 409', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EDGE-4' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-EDGE-4', map_id: 'mock_map_001', mode: 'auto' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
      mock.timers.tick(3000);

      await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-4', action: 'PAUSE' });
      const res = await postJson(port, ACTION_PATH, { sn: 'SN-EDGE-4', action: 'EDGE_START' });
      assert.equal(res.status, 409);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });
});
