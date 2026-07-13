import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { generateTicket } from '../../src/auth/ticket';
import { ChaosController } from '../../src/sim/chaos';
import { MapStream } from '../../src/sim/mapStream';
import { ScenarioEngine } from '../../src/sim/scenarioEngine';
import { VirtualRobot } from '../../src/sim/virtualRobot';
import { createWsServer } from '../../src/ws/wsServer';
import { createPoseState, currentRobotPose } from '../../src/trajectory/mowingTrajectory';

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === ws.CLOSED) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket close')), timeoutMs);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once('error', reject);
  });
}

function waitForCommand(ws: WebSocket, cmd: string, timeoutMs = 1000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${cmd}`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(raw.toString()) as { cmd?: string };
      if (parsed.cmd !== cmd) return;
      cleanup();
      resolve(parsed);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };
    ws.on('message', onMessage);
  });
}

function waitForCommandCount(ws: WebSocket, cmd: string, minCount: number, timeoutMs = 1200): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${minCount} ${cmd} messages, got ${messages.length}`));
    }, timeoutMs);
    const onMessage = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(raw.toString()) as { cmd?: string };
      if (parsed.cmd !== cmd) return;
      messages.push(parsed);
      if (messages.length >= minCount) {
        cleanup();
        resolve(messages);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };
    ws.on('message', onMessage);
  });
}

describe('e2e scenarios', () => {
  it('runs the checked-in mapping_happy_auto scenario', { timeout: 150_000 }, async () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    assert.ok(engine.listScenarios().includes('mapping_happy_auto'));
    const result = await engine.run({ name: 'mapping_happy_auto' });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
    assert.deepEqual([...engine.listScenarios()].sort(), [
      'mapping_estop_edge_follow',
      'mapping_happy_auto',
      'mapping_happy_auto_multilawn',
      'mapping_happy_manual',
      'mapping_stream_incremental',
      'mowing_estop_running',
      'mowing_happy_auto',
      'mowing_recharge',
      'mowing_trajectory_stream',
    ]);
  });

  it('runs the checked-in mowing_recharge scenario to COMPLETED', { timeout: 60_000 }, async () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    assert.ok(engine.listScenarios().includes('mowing_recharge'));
    const result = await engine.run({ name: 'mowing_recharge' });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().mowing.state, 'COMPLETED');
  });

  it('runs the manual remote mapping chain (edge_mapping -> REMOTE_CONTROL -> complete)', async () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    assert.ok(engine.listScenarios().includes('mapping_happy_manual'));
    // Fast inline mirror of the checked-in scenario: validates the手动遥控 FSM
    // transitions without the long observation waits baked into the YAML.
    const result = await engine.run({
      inline: {
        name: 'fast_manual_mapping',
        domain: 'mapping',
        setup: { state: 'IDLE', phase: null },
        steps: [
          { emit: { type: 'CMD_START', mode: 'remote', taskMode: 'MAP_BUILD' } },
          { notify: { work_status: 'mapping', sub_status: 'precondition' } },
          { expect: { state: 'PREPARING', mode: 'remote' } },
          { notify: { work_status: 'mapping', sub_status: 'leave_dock' } },
          { expect: { state: 'UNDOCKING' } },
          { notify: { work_status: 'mapping', sub_status: 'find_boundary' } },
          { expect: { state: 'WORKING', phase: 'MAP_SCAN_BOUNDARY' } },
          { notify: { work_status: 'mapping', sub_status: 'edge_mapping' } },
          { expect: { state: 'REMOTE_CONTROL', phase: 'MAP_FOLLOW_BOUNDARY_MANUAL', mode: 'remote' } },
          { notify: { work_status: 'mapping', sub_status: 'map_edge_finish' } },
          { expect: { state: 'WORKING', phase: 'MAP_BOUNDARY_DONE', mode: 'auto' } },
          { notify: { work_status: 'idle', sub_status: 'none' } },
          { expect: { state: 'COMPLETED', phase: 'MAP_COMPLETING' } },
        ],
      },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
  });

  it('pushes MAP_INCREMENTAL when entering a streamable mapping phase', async () => {
    const server = http.createServer();
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const mapStream = new MapStream([
      {
        id: 'unit',
        timestampMs: 1700000000000,
        resolution: 0.05,
        originX: -1,
        originY: -1,
        mapCols: 2,
        mapRows: 2,
        imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        robotX: 0.5,
        robotY: 0.5,
        robotTheta: 0,
      },
    ]);
    const wsRuntime = createWsServer({ server, robot, mapStream, chaos, pushIntervalMs: 60_000 });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const { ticket } = generateTicket({ userId: 'unit-test' });
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/acc?ticket=${ticket}`);
    try {
      await waitForOpen(ws);
      const incrementalPromise = waitForCommand(ws, 'MAP_INCREMENTAL', 5000);
      const engine = new ScenarioEngine({ robot, chaos });
      const result = await engine.run({
        inline: {
          name: 'fast_streamable_mapping',
          domain: 'mapping',
          setup: { state: 'IDLE', phase: null },
          steps: [
            { emit: { type: 'CMD_START', mode: 'auto', taskMode: 'MAP_BUILD' } },
            { notify: { work_status: 'mapping', sub_status: 'leave_dock' } },
            { notify: { work_status: 'mapping', sub_status: 'find_boundary' } },
          ],
        },
      });
      assert.equal(result.ok, true, result.error);

      const incremental = await incrementalPromise as { data?: { map_header?: { frame_id?: number } } };
      assert.equal(typeof incremental.data?.map_header?.frame_id, 'number');
    } finally {
      ws.close();
      wsRuntime.close();
      server.close();
    }
  });

  it('keeps pushing MAP_INCREMENTAL while mapping remains streamable', async () => {
    const server = http.createServer();
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const mapStream = new MapStream([
      {
        id: 'unit',
        timestampMs: 1700000000000,
        resolution: 0.05,
        originX: -1,
        originY: -1,
        mapCols: 2,
        mapRows: 2,
        imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        robotX: 0.5,
        robotY: 0.5,
        robotTheta: 0,
      },
    ]);
    const wsRuntime = createWsServer({ server, robot, mapStream, chaos, pushIntervalMs: 50 });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const { ticket } = generateTicket({ userId: 'unit-test' });
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/acc?ticket=${ticket}`);
    try {
      await waitForOpen(ws);
      const incrementalPromise = waitForCommandCount(ws, 'MAP_INCREMENTAL', 3);
      const engine = new ScenarioEngine({ robot, chaos });
      const result = await engine.run({
        inline: {
          name: 'short_continuous_mapping_stream',
          domain: 'mapping',
          setup: { state: 'PREPARING', phase: null },
          steps: [
            { notify: { work_status: 'mapping', sub_status: 'leave_dock' } },
            { notify: { work_status: 'mapping', sub_status: 'find_boundary' } },
            { wait: '180ms' },
          ],
        },
      });
      assert.equal(result.ok, true, result.error);
      assert.equal((await incrementalPromise).length, 3);
    } finally {
      ws.close();
      wsRuntime.close();
      server.close();
    }
  });

  it('pushes ROBOT_LOCATION during mowing trajectory scenarios', { timeout: 15_000 }, async () => {
    const server = http.createServer();
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const mapStream = new MapStream([
      {
        id: 'unit',
        timestampMs: 1700000000000,
        resolution: 0.05,
        originX: -1,
        originY: -1,
        mapCols: 2,
        mapRows: 2,
        imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        robotX: 0.5,
        robotY: 0.5,
        robotTheta: 0,
      },
    ]);
    const wsRuntime = createWsServer({ server, robot, mapStream, chaos, pushIntervalMs: 60_000 });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const { ticket } = generateTicket({ userId: 'unit-test' });
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/acc?ticket=${ticket}`);
    try {
      await waitForOpen(ws);
      ws.send(JSON.stringify({ cmd: 'LOCATION_REGISTER', cmd_id: 'unit-location-register', version: 1, data: { sn: robot.sn } }));
      const locationPromise = waitForCommandCount(ws, 'ROBOT_LOCATION', 2, 1600);
      const engine = new ScenarioEngine({ robot, chaos });
      // mowing_trajectory_stream loops forever; run in background, assert frames, then stop.
      const runPromise = engine.run({ name: 'mowing_trajectory_stream' });
      const locations = await locationPromise as Array<{ data?: { x?: number; y?: number; angle?: number } }>;
      assert.equal(locations.length, 2);
      assert.equal(typeof locations[0].data?.x, 'number');
      assert.equal(typeof locations[0].data?.y, 'number');
      assert.equal(typeof locations[0].data?.angle, 'number');
      engine.stop();
      const result = await runPromise;
      assert.equal(result.ok, true, result.error);
      assert.equal(result.stopped, true);
    } finally {
      ws.close();
      wsRuntime.close();
      server.close();
    }
  });

  it('sends current ROBOT_LOCATION immediately when registering during active mowing', async () => {
    const server = http.createServer();
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const mapStream = new MapStream([
      {
        id: 'unit',
        timestampMs: 1700000000000,
        resolution: 0.05,
        originX: -1,
        originY: -1,
        mapCols: 2,
        mapRows: 2,
        imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        robotX: 0.5,
        robotY: 0.5,
        robotTheta: 0,
      },
    ]);
    robot.createMowingTask({ sn: robot.sn, task_info: { map_id: 'mock_map_001', task_mode: 'global' } });
    const wsRuntime = createWsServer({ server, robot, mapStream, chaos, pushIntervalMs: 60_000 });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const { ticket } = generateTicket({ userId: 'unit-test' });
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/acc?ticket=${ticket}`);
    try {
      await waitForOpen(ws);
      const locationPromise = waitForCommand(ws, 'ROBOT_LOCATION', 250);
      ws.send(JSON.stringify({ cmd: 'LOCATION_REGISTER', cmd_id: 'unit-location-register-active', version: 1, data: { sn: robot.sn } }));
      const location = await locationPromise as { data?: { x?: number; y?: number; angle?: number } };
      const expected = currentRobotPose(createPoseState());
      assert.equal(location.data?.x, expected.x);
      assert.equal(location.data?.y, expected.y);
      assert.equal(location.data?.angle, expected.angle);
    } finally {
      ws.close();
      wsRuntime.close();
      server.close();
    }
  });

  it('closes active websocket clients during runtime shutdown', async () => {
    const server = http.createServer();
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const mapStream = new MapStream([
      {
        id: 'unit',
        timestampMs: 1700000000000,
        resolution: 0.05,
        originX: -1,
        originY: -1,
        mapCols: 2,
        mapRows: 2,
        imageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        robotX: 0.5,
        robotY: 0.5,
        robotTheta: 0,
      },
    ]);
    const wsRuntime = createWsServer({ server, robot, mapStream, chaos, pushIntervalMs: 60_000 });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const { ticket } = generateTicket({ userId: 'unit-test' });
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/acc?ticket=${ticket}`);
    try {
      await waitForOpen(ws);
      wsRuntime.close();
      await waitForClose(ws);
      assert.equal(ws.readyState, ws.CLOSED);
    } finally {
      ws.terminate();
      wsRuntime.close();
      server.close();
    }
  });
});
