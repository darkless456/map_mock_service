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

async function createTestServer(robot: VirtualRobot, mapStream = new MapStream([])): Promise<http.Server> {
  const server = http.createServer();
  const chaos = new ChaosController();
  const recorder = new Recorder();
  const context: AppRouteContext = {
    port: 0,
    dataDir: '',
    robot,
    mapStream,
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
      // Archived real-gateway fields (APP端接口文档-额外补充.md): not yet consumed by IDeviceInfo,
      // but the mock should still return them for response parity.
      assert.equal(data.access_role, 'owner');
      assert.equal(typeof data.wifi_ssid, 'string');
      assert.equal(typeof data.ble_mac, 'string');
      assert.equal(data.rtk_is_fixed, 0);
      assert.equal(data.rtk_satellites_used, 0);
      assert.equal(data.battery_temperature, 25);
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
      assert.equal((mowing.json.data as Record<string, unknown>).rtk_is_fixed, 1);
      assert.equal((mowing.json.data as Record<string, unknown>).rtk_satellites_used, 20);

      robot.startRecharge(robot.sn);
      const charging = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', {
        sn: robot.sn,
      });
      assert.equal((charging.json.data as Record<string, unknown>).running_status, 'returning_charge');
      assert.equal((charging.json.data as Record<string, unknown>).battery_charging, 0);
      assert.equal((charging.json.data as Record<string, unknown>).rtk_is_fixed, 0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });

  it('returns lawn_area from the same current-dataset geometry as MAP_INCREMENTAL', async () => {
    const robot = new VirtualRobot({ sn: 'DETAIL-AREA-SN' });
    const mapStream = new MapStream(loadAllPatches('mapping_happy'), 'mapping_happy');
    const server = await createTestServer(robot, mapStream);
    try {
      const detail = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', { sn: robot.sn });
      assert.equal((detail.json.data as Record<string, unknown>).lawn_area, 4);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });

  it('extend_status/labels settle through a mapping session and area_complete_map_build clears on idle', async () => {
    const robot = new VirtualRobot({ sn: 'DETAIL-EXT-SN' });
    const server = await createTestServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      robot.createMappingTask({ sn: robot.sn, map_id: 'mock_map_001', mode: 'remote' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });

      let detail = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', { sn: robot.sn });
      let data = detail.json.data as Record<string, unknown>;
      assert.equal(data.sub_status, 'find_boundary');
      assert.equal((data.extend_status as Record<string, unknown>).legitimate_starting_point, 0);

      mock.timers.tick(3000);
      detail = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', { sn: robot.sn });
      data = detail.json.data as Record<string, unknown>;
      assert.equal((data.extend_status as Record<string, unknown>).legitimate_starting_point, 1);

      const labelsAfterBoundary = await postJson(serverPort(server), '/map-service/api/v1/ratel_map/labels', { map_id: 'mock_map_001' });
      const listAfterBoundary = (labelsAfterBoundary.json.data as Record<string, unknown>).labels as Array<Record<string, unknown>>;
      assert.equal(listAfterBoundary.length, 1);
      assert.equal(listAfterBoundary[0].type, 'aisle');

      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'edge_mapping' });
      mock.timers.tick(3000);
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_edge_finish' });

      const labelsAfterEdge = await postJson(serverPort(server), '/map-service/api/v1/ratel_map/labels', { map_id: 'mock_map_001' });
      const listAfterEdge = (labelsAfterEdge.json.data as Record<string, unknown>).labels as Array<Record<string, unknown>>;
      assert.equal(listAfterEdge.length, 2);
      assert.equal(listAfterEdge[1].type, 'edge_start');

      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'expand_area' });
      detail = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', { sn: robot.sn });
      data = detail.json.data as Record<string, unknown>;
      assert.equal((data.extend_status as Record<string, unknown>).area_complete_map_build, 1);
      // 完成等待页倒计时锚点：只在 expand_area 窗口里是真实时刻，App 用它算剩余秒数。
      const waitTs = (data.extend_status as Record<string, unknown>).wait_extend_timestamp;
      assert.equal(typeof waitTs, 'number');
      assert.ok((waitTs as number) > 0);

      // area_complete_map_build must clear once the task actually goes idle, even though the
      // read-only FSM mirror keeps reporting `phase: MAP_COMPLETING` afterwards.
      robot.pushRatelStatus({ work_status: 'idle', sub_status: 'none' });
      detail = await postJson(serverPort(server), '/ratel/api/v1/courtyard/robot/detail', { sn: robot.sn });
      data = detail.json.data as Record<string, unknown>;
      assert.equal(data.sub_status, 'none');
      assert.equal((data.extend_status as Record<string, unknown>).area_complete_map_build, 0);
      // 窗口关闭后锚点归 0——真机就是这个语义（字段常在，无窗口时为 0），
      // App 侧 `toEpochMs(0) === null` 会读成「倒计时已归零」。
      assert.equal((data.extend_status as Record<string, unknown>).wait_extend_timestamp, 0);
    } finally {
      mock.timers.reset();
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });
});
