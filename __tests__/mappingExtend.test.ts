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
import {
  MAPPING_EXTEND_FIND_BOUNDARY_DELAY_MS,
  MAPPING_EXTEND_UNDOCK_DELAY_MS,
} from '../src/sim/SimulatorDefaults';

const TASK_LIST_PATH = '/ratel/central-control-service/api/v1/ratel_mapping_task/list';
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

/** Leaves the robot idle with one finished lawn — the real state when entering map edit. */
function seedFinishedLawn(robot: VirtualRobot): void {
  robot.startMapping({ mode: 'auto' });
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'map_edge_finish' });
  robot.forceMappingTaskStatus('COMPLETE');
}

const okSwitchDataset = () => ({ ok: true as const, name: 'mapping_lawn2_aisle', patchCount: 3 });

describe("ratel_mapping_task/create mode='extend'（v9 扩展建图 / 地图编辑页添加草坪）", () => {
  it('returns a task_id and creates an active extend task for the requested map', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPANSION-1' });
    seedFinishedLawn(robot);
    const { server, port, mapStream } = await startServer(robot);
    try {
      const res = await postJson(port, CREATE_PATH, {
        sn: 'SN-EXPANSION-1',
        map_id: 'map-001',
        mode: 'extend',
      });

      // create 对 extend 同样必须回 task_id —— Mower 侧缺 task_id 直接 fail-fast 不进建图页。
      assert.equal(res.status, 200);
      const data = res.json.data as Record<string, unknown>;
      assert.equal(typeof data.task_id, 'string');
      assert.ok((data.task_id as string).length > 0);

      // 任务列表里必须能查到同一条活跃任务（App 的懒回补兜底路径依赖它）。
      const list = await postJson(port, TASK_LIST_PATH, { sn: 'SN-EXPANSION-1', limit: 10 });
      const tasks = (list.json.data as Record<string, unknown>).list as Array<Record<string, unknown>>;
      const active = tasks.find(task => task.task_status === 'ON_THE_WAY');
      assert.ok(active, 'expansion must leave an ON_THE_WAY mapping task');
      assert.equal(active.task_id, data.task_id);
      assert.equal((active.task_info as Record<string, unknown>).map_id, 'map-001');
      // 任务列表回 extend；App 侧 normalizeSessionMode 归一为手摇会话 remote。
      assert.equal((active.task_info as Record<string, unknown>).mode, 'extend');

      assert.equal(mapStream.dataset, 'mapping_lawn2_aisle');
      // 首帧必须是 mapping/precondition：Mower 的 `PREPARING + idle` 是启动失败判据。
      assert.equal(robot.snapshot().lastNotifyWorkStatus, 'mapping');
      assert.equal(robot.snapshot().lastNotifySubStatus, 'precondition');
      assert.equal(robot.snapshot().mapping.state, 'PREPARING');
    } finally {
      robot.reset();
      server.close();
    }
  });

  it('drives PREPARING → UNDOCKING → REMOTE_CONTROL/MAP_SCAN_BOUNDARY_MANUAL without clearing existing labels', () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPANSION-2' });
    seedFinishedLawn(robot);
    const lawnsBefore = robot.mappingLawnCount();
    const aislesBefore = robot.mappingLabelsList().filter(label => label.type === 'aisle').length;
    assert.equal(lawnsBefore, 1);
    assert.equal(aislesBefore, 1);

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { task, error } = robot.createMappingTask(
        { sn: 'SN-EXPANSION-2', map_id: 'map-001', mode: 'extend' },
        { switchDataset: okSwitchDataset },
      );
      assert.equal(error, undefined);
      assert.ok(task, 'extend create must return a task record (task_id)');
      assert.equal(task.map_id, 'map-001');
      assert.equal(task.mode, 'extend');
      assert.equal(robot.snapshot().mapping.state, 'PREPARING');
      // 既有草坪的 label 必须保留 —— useMappingPassageCapture 靠它判定通道端点归属。
      assert.equal(robot.mappingLawnCount(), lawnsBefore);

      mock.timers.tick(MAPPING_EXTEND_UNDOCK_DELAY_MS);
      assert.equal(robot.snapshot().lastNotifySubStatus, 'leave_dock');
      assert.equal(robot.snapshot().mapping.state, 'UNDOCKING');

      mock.timers.tick(MAPPING_EXTEND_FIND_BOUNDARY_DELAY_MS - MAPPING_EXTEND_UNDOCK_DELAY_MS);
      assert.equal(robot.snapshot().lastNotifySubStatus, 'find_boundary');
      assert.equal(robot.snapshot().mapping.state, 'REMOTE_CONTROL');
      assert.equal(robot.snapshot().mapping.mode, 'remote');
      assert.equal(robot.snapshot().mapping.phase, 'MAP_SCAN_BOUNDARY_MANUAL');
      // 新草坪的通道 label 追加在既有 label 之后，而不是取代它们。
      assert.equal(robot.mappingLabelsList().filter(label => label.type === 'aisle').length, aislesBefore + 1);
      assert.equal(robot.mappingLawnCount(), lawnsBefore);
    } finally {
      mock.timers.reset();
      robot.reset();
    }
  });

  it('reaches an app-confirmable state well inside the mower 12s start watchdog', () => {
    assert.ok(
      MAPPING_EXTEND_FIND_BOUNDARY_DELAY_MS < 12_000,
      'extend push sequence must finish before START_STATUS_WATCHDOG_MS',
    );
    assert.ok(MAPPING_EXTEND_UNDOCK_DELAY_MS < MAPPING_EXTEND_FIND_BOUNDARY_DELAY_MS);
  });

  it('rejects missing params (400), unknown sn (404) and a busy device (409)', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPANSION-3' });
    const { server, port } = await startServer(robot);
    try {
      assert.equal((await postJson(port, CREATE_PATH, { map_id: 'map-001', mode: 'extend' })).status, 400);
      assert.equal((await postJson(port, CREATE_PATH, { sn: 'SN-EXPANSION-3', mode: 'extend' })).status, 400);

      // 「无法获取设备 MAC」
      const unknownSn = await postJson(port, CREATE_PATH, { sn: 'SN-NOT-BOUND', map_id: 'map-001', mode: 'extend' });
      assert.equal(unknownSn.status, 404);

      // 「设备返回非成功码」：设备正在建图时拒绝扩展，`data` 携带设备侧错误信息。
      await postJson(port, CREATE_PATH, { sn: 'SN-EXPANSION-3', map_id: 'mock_map_001', mode: 'auto' });
      const busy = await postJson(port, CREATE_PATH, { sn: 'SN-EXPANSION-3', map_id: 'map-001', mode: 'extend' });
      assert.equal(busy.status, 409);
      assert.equal((busy.json.data as Record<string, unknown>).robot_code, -1);
    } finally {
      robot.reset();
      server.close();
    }
  });
});

describe('legacy /ratel/api/v1/mapping/expansion is gone (v9 cutover)', () => {
  it('404s — no back-compat alias for the removed endpoint', async () => {
    const robot = new VirtualRobot({ sn: 'SN-EXPANSION-4' });
    const { server, port } = await startServer(robot);
    try {
      const res = await postJson(port, '/ratel/api/v1/mapping/expansion', {
        sn: 'SN-EXPANSION-4',
        map_id: 'map-001',
      });
      assert.equal(res.status, 404);
    } finally {
      robot.reset();
      server.close();
    }
  });
});
