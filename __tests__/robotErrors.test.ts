import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ChaosController } from '../src/sim/chaos';
import { MapStream } from '../src/sim/mapStream';
import { Recorder } from '../src/sim/recorder';
import {
  ScenarioEngine,
  parseScenario,
  type ScenarioDefinition,
  type ScenarioStep,
} from '../src/sim/scenarioEngine';
import { buildRobotError } from '../src/sim/pushChannels';
import { VirtualRobot } from '../src/sim/virtualRobot';
import type { RobotErrorRecord } from '../src/sim/virtualRobotTypes';
import fs from 'node:fs';
import path from 'node:path';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) =>
          server.close(error => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

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
  servers.push(server);
  return server;
}

function serverPort(server: http.Server): number {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
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
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            json: JSON.parse(
              Buffer.concat(chunks).toString('utf8'),
            ) as Record<string, unknown>,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(payload);
  });
}

describe('robot error snapshots and pushes', () => {
  it('returns active errors using the App unhandled-snapshot contract', async () => {
    const robot = new VirtualRobot({ sn: 'ERROR-SN' });
    robot.seedRobotError({
      errorId: '501001',
      errorType: 'EdgeFollowError',
      errorLevel: 'Warn',
      message: 'edge follow interrupted',
    });
    const server = await createTestServer(robot);

    const response = await postJson(
      serverPort(server),
      '/ratel/api/v1/robot/errors/unhandled',
      { sn: robot.sn, limit: 20, offset: 0 },
    );

    assert.equal(response.status, 200);
    const data = response.json.data as {
      total: number;
      items: Array<Record<string, unknown>>;
    };
    assert.equal(data.total, 1);
    assert.equal(data.items[0].error_type, 'EdgeFollowError');
    assert.deepEqual(data.items[0].data, {
      sn: 'ERROR-SN',
      error_id: '501001',
      error_type: 'EdgeFollowError',
      error_level: 'Warn',
      task_message: 'edge follow interrupted',
      notify_timestamp: assertNumber(data.items[0].data, 'notify_timestamp'),
    });

    assert.ok(robot.recoverRobotError('501001'));
    const recovered = await postJson(
      serverPort(server),
      '/ratel/api/v1/robot/errors/unhandled',
      { sn: robot.sn },
    );
    assert.deepEqual(recovered.json.data, { total: 0, items: [] });
  });

  it('builds canonical ROBOT_ERROR and ROBOT_ERROR_RECOVERY envelopes', () => {
    const robot = new VirtualRobot({ sn: 'WS-ERROR-SN' });
    const active = robot.reportRobotError({
      errorId: '502003',
      errorType: 'NoGrassLineVisible',
      message: 'no grass line',
    });
    const activeEnvelope = buildRobotError(active);
    assert.equal(activeEnvelope.cmd, 'ROBOT_ERROR');
    assert.equal(activeEnvelope.data.error_id, '502003');
    assert.equal(activeEnvelope.data.error_type, 'NoGrassLineVisible');

    const recovered = robot.recoverRobotError('502003');
    assert.ok(recovered);
    const recoveryEnvelope = buildRobotError(recovered);
    assert.equal(recoveryEnvelope.cmd, 'ROBOT_ERROR_RECOVERY');
    assert.equal(recoveryEnvelope.data.error_id, '502003');
    assert.ok(
      assertNumber(recoveryEnvelope.data, 'notify_timestamp') >
        active.notifyTimestamp,
    );
  });

  it('runs snapshot/live/recovery scenario steps without changing mapping state', async () => {
    const robot = new VirtualRobot({ sn: 'SCENARIO-ERROR-SN' });
    const engine = new ScenarioEngine({
      robot,
      chaos: new ChaosController(),
    });
    const result = await engine.run({
      inline: {
        name: 'robot_error_dsl_contract',
        domain: 'mapping',
        setup: { state: 'WORKING', phase: 'MAP_FOLLOW_BOUNDARY' },
        steps: [
          {
            robotErrorSnapshot: {
              error_id: '501001',
              error_type: 'EdgeFollowError',
            },
          },
          { robotErrorRecovery: { error_id: '501001' } },
          {
            robotError: {
              error_id: '502003',
              error_type: 'NoGrassLineVisible',
            },
          },
          { robotErrorRecovery: { error_id: '502003' } },
          { expect: { state: 'WORKING', phase: 'MAP_FOLLOW_BOUNDARY' } },
        ],
      },
    });

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(
      result.logs.map(log => log.kind),
      [
        'setup',
        'robotErrorSnapshot',
        'robotErrorRecovery',
        'robotError',
        'robotErrorRecovery',
        'expect',
      ],
    );
    assert.equal(robot.snapshot().mapping.state, 'WORKING');
    assert.equal(robot.snapshot().mapping.phase, 'MAP_FOLLOW_BOUNDARY');
    assert.equal(robot.activeRobotErrors().length, 0);
  });

  it('registers the checked-in mapping error scenario and guide', () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({
      robot,
      chaos: new ChaosController(),
    });

    assert.ok(
      engine.listScenarios().includes('mapping_auto_error_snapshot_and_ws'),
    );
    const guide = engine.getScenarioGuide(
      'mapping_auto_error_snapshot_and_ws',
    );
    assert.equal(guide?.domain, 'mapping');
    assert.match(guide?.summary ?? '', /501001\/502003/);
  });

  it('runs the 501001/502003 tip scenario with the design copy over WS', async () => {
    const robot = new VirtualRobot({ sn: 'AUTO-ERROR-TIP-SN' });
    const pushes = recordRobotErrorPushes(robot);
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });

    const result = await engine.run({
      inline: withoutWaits('mapping_auto_error_501001_502003'),
    });

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(pushes, [
      { errorId: '501001', active: true, message: '路径重复，请切换手动摇控建图' },
      { errorId: '501001', active: false, message: '路径重复，请切换手动摇控建图' },
      {
        errorId: '502003',
        active: true,
        message: '无法确认草坪边界，请切换手动摇控建图',
      },
      {
        errorId: '502003',
        active: false,
        message: '无法确认草坪边界，请切换手动摇控建图',
      },
    ]);
    assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETING');
    assert.equal(robot.activeRobotErrors().length, 0);
    assert.match(
      engine.getScenarioGuide('mapping_auto_error_501001_502003')?.summary ?? '',
      /501001\/502003/,
    );
  });

  it('runs the 502004 live scenario: app copy, recovery, device message, then 502003 contrast', async () => {
    const robot = new VirtualRobot({ sn: 'SCAN-FAIL-SN' });
    const pushes = recordRobotErrorPushes(robot);
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });

    const result = await engine.run({
      inline: withoutWaits('mapping_scan_boundary_fail_502004'),
    });

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(pushes, [
      // 第一次不带 task_message：App 必须走自带的 502004 文案。
      { errorId: '502004', active: true, message: '' },
      { errorId: '502004', active: false, message: '' },
      {
        errorId: '502004',
        active: true,
        message: '【设备文案】502004 task_message 优先显示',
      },
      {
        errorId: '502004',
        active: false,
        message: '【设备文案】502004 task_message 优先显示',
      },
      { errorId: '502003', active: true, message: '' },
      { errorId: '502003', active: false, message: '' },
    ]);
    assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETING');
    assert.equal(robot.activeRobotErrors().length, 0);
  });

  it('keeps the 502004 snapshot scenario silent on WS until recovery', async () => {
    const robot = new VirtualRobot({ sn: 'SCAN-FAIL-SNAPSHOT-SN' });
    const pushes = recordRobotErrorPushes(robot);
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });

    const result = await engine.run({
      inline: withoutWaits('mapping_scan_boundary_fail_502004_snapshot'),
    });

    assert.equal(result.ok, true, result.error);
    // 只有 recovery 走 WS：502004 本身只能经 HTTP unhandled 快照被 App 拿到。
    assert.deepEqual(pushes, [
      { errorId: '502004', active: false, message: '' },
    ]);
    assert.equal(robot.activeRobotErrors().length, 0);
  });

  it('registers both 502004 scenario guides', () => {
    const engine = new ScenarioEngine({
      robot: new VirtualRobot(),
      chaos: new ChaosController(),
    });

    for (const name of [
      'mapping_scan_boundary_fail_502004',
      'mapping_scan_boundary_fail_502004_snapshot',
    ]) {
      assert.ok(engine.listScenarios().includes(name), name);
      const guide = engine.getScenarioGuide(name);
      assert.equal(guide?.domain, 'mapping');
      assert.match(guide?.summary ?? '', /502004/);
    }
  });
});

/** 读入仓库内的场景并去掉所有 wait，让 60s+ 的人工观察场景在单测里瞬间跑完。 */
function withoutWaits(name: string): ScenarioDefinition {
  const file = path.join(__dirname, '..', 'scenarios', `${name}.yaml`);
  const scenario = parseScenario(
    fs.readFileSync(file, 'utf8'),
  ) as ScenarioDefinition;
  return {
    ...scenario,
    steps: scenario.steps.filter((step: ScenarioStep) => !('wait' in step)),
  };
}

function recordRobotErrorPushes(
  robot: VirtualRobot,
): Array<Pick<RobotErrorRecord, 'errorId' | 'active' | 'message'>> {
  const pushes: Array<Pick<RobotErrorRecord, 'errorId' | 'active' | 'message'>> = [];
  robot.on('robotError', (record: RobotErrorRecord) => {
    pushes.push({
      errorId: record.errorId,
      active: record.active,
      message: record.message,
    });
  });
  return pushes;
}

function assertNumber(value: unknown, key: string): number {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const field = (value as Record<string, unknown>)[key];
  assert.equal(typeof field, 'number');
  return field as number;
}
