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
  robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'expand_area' });
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

/**
 * 上传段每步 500ms 且**在回调里重新注册下一个 timer**。
 * `mock.timers.tick(N * 500)` 只会推进一步——node 的 mock timers 不级联执行
 * tick 期间新注册的 timer。必须一步一 tick。
 */
function tickUploadSteps(steps: number): void {
  for (let i = 0; i < steps; i += 1) mock.timers.tick(500);
}

describe('MAP_COMPLETING lifecycle + EXPAND_AREA_FINISH action', () => {
  it('rejects EXPAND_AREA_FINISH outside MAP_COMPLETING (409) and outside an active task (404)', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-1' });
    const { server, port } = await startServer(robot);
    try {
      const noTask = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-1', action: 'EXPAND_AREA_FINISH' });
      assert.equal(noTask.status, 404);

      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-1', map_id: 'mock_map_001', mode: 'auto' });
      const wrongPhase = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-1', action: 'EXPAND_AREA_FINISH' });
      assert.equal(wrongPhase.status, 409);
    } finally {
      server.close();
    }
  });

  /**
   * COMPLETE 不再「立即完成」：它先进入上传段（`sub_status: upload_map`），
   * 按步进推进度，到 100% 才收尾成 COMPLETED。这一段此前在 Mock 上完全不可达
   * （从 expand_area 一步跳 idle），App 的上传页/失败页/重试都没法联调。
   */
  it('EXPAND_AREA_FINISH enters the upload stage and only completes once the upload reaches 100%', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-2' });
    mock.timers.enable({ apis: ['setTimeout'] });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-2', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETING');

      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-2', action: 'EXPAND_AREA_FINISH' });
      assert.equal(accepted.status, 200);
      // 上传中：会话仍存活，sub_status 已切到 upload_map。
      assert.equal(robot.snapshot().mapping.state, 'WORKING');
      assert.equal(robot.lastNotifySubStatus, 'upload_map');
      assert.equal(robot.mapUploadTelemetry().state, 'UPLOADING');

      tickUploadSteps(5);
      assert.equal(robot.mapUploadTelemetry().progress, 50);
      assert.equal(robot.snapshot().mapping.state, 'WORKING');

      tickUploadSteps(5);
      assert.equal(robot.mapUploadTelemetry().progress, 100);
      assert.equal(robot.mapUploadTelemetry().state, 'SUCCESS');
      assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
      assert.equal(robot.activeMappingTask()?.status, 'COMPLETE');

      const duplicate = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-2', action: 'EXPAND_AREA_FINISH' });
      assert.equal(duplicate.status, 409);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  /** 上传失败：停在 `upload_map` **不转 idle**（[决议-1] 承诺的真机行为），重试后走完。 */
  it('holds the session in upload_map on failure and recovers on RETRANSMIT_MAP', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-4' });
    mock.timers.enable({ apis: ['setTimeout'] });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-4', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      robot.uploadFailAt = 40;

      await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-4', action: 'EXPAND_AREA_FINISH' });
      tickUploadSteps(10);

      assert.equal(robot.mapUploadTelemetry().state, 'FAILED');
      assert.equal(robot.mapUploadTelemetry().progress, 40);
      // 关键：会话没有被终结，sub_status 停在 upload_map —— 失败页才可达。
      assert.equal(robot.snapshot().mapping.state, 'WORKING');
      assert.equal(robot.lastNotifySubStatus, 'upload_map');

      const retried = await postJson(port, ACTION_PATH, {
        sn: 'SN-COMPLETE-4',
        action: 'RETRANSMIT_MAP',
      });
      assert.equal(retried.status, 200);
      assert.equal(robot.mapUploadTelemetry().state, 'UPLOADING');
      assert.equal(robot.mapUploadTelemetry().progress, 0);

      tickUploadSteps(10);
      assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('rejects RETRANSMIT_MAP when the upload has not failed', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-5' });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-5', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);

      const tooEarly = await postJson(port, ACTION_PATH, {
        sn: 'SN-COMPLETE-5',
        action: 'RETRANSMIT_MAP',
      });
      assert.equal(tooEarly.status, 409);
    } finally {
      server.close();
    }
  });

  it('auto-completes 120s after entering MAP_COMPLETING when EXPAND_AREA_FINISH is never called', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-3' });
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      robot.createMappingTask({ sn: 'SN-COMPLETE-3', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      assert.equal(robot.snapshot().mapping.state, 'WORKING');

      mock.timers.tick(119_999);
      assert.equal(robot.snapshot().mapping.state, 'WORKING');

      mock.timers.tick(1);
      // 倒计时归零与手动 COMPLETE 走同一条路：先上传，上传完才进终态。
      assert.equal(robot.snapshot().mapping.state, 'WORKING');
      assert.equal(robot.lastNotifySubStatus, 'upload_map');

      tickUploadSteps(10);
      assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
      assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETING');
    } finally {
      mock.timers.reset();
    }
  });

  it('an explicit EXPAND_AREA_FINISH call cancels the pending 120s auto-complete timer', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-4' });
    const { server, port } = await startServer(robot);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-4', map_id: 'mock_map_001', mode: 'auto' });
      enterMapCompleting(robot);
      const accepted = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-4', action: 'EXPAND_AREA_FINISH' });
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
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'expand_area' });
      const detail = await postJson(port, '/ratel/api/v1/courtyard/robot/detail', { sn: 'SN-COMPLETE-5' });
      const data = detail.json.data as Record<string, unknown>;
      assert.equal(data.sub_status, 'expand_area');
      assert.ok(typeof data.sub_status_entered_at === 'number');
      assert.notEqual(data.sub_status_entered_at, enteredAtBoundary);
      assert.equal((data.extend_status as Record<string, unknown>).area_complete_map_build, 1);
    } finally {
      mock.timers.reset();
      server.close();
    }
  });

  it('exposes wait_extend_timestamp as the countdown anchor, and clears it when the window closes', async () => {
    const robot = new VirtualRobot({ sn: 'SN-COMPLETE-6' });
    const { server, port } = await startServer(robot);
    try {
      await postJson(port, CREATE_PATH, { sn: 'SN-COMPLETE-6', map_id: 'mock_map_001', mode: 'auto' });
      const before = Date.now();
      enterMapCompleting(robot);
      const after = Date.now();

      const detail = await postJson(port, '/ratel/api/v1/courtyard/robot/detail', { sn: 'SN-COMPLETE-6' });
      const extend = (detail.json.data as Record<string, unknown>).extend_status as Record<string, unknown>;
      const anchor = extend.wait_extend_timestamp as number;
      // 锚点必须是 armMapCompletingCountdown 的那一刻（毫秒 epoch），不是每次读取的当前时刻——
      // 否则 mock 自己的 120s 自动完成和 App 显示的剩余秒数会各走各的。
      assert.ok(anchor >= before && anchor <= after, `anchor ${anchor} outside [${before}, ${after}]`);

      // COMPLETE 关掉等待窗口 → 锚点归 0（App 读作「倒计时已归零」）。
      const res = await postJson(port, ACTION_PATH, { sn: 'SN-COMPLETE-6', action: 'EXPAND_AREA_FINISH' });
      assert.equal(res.status, 200);
      const detailAfter = await postJson(port, '/ratel/api/v1/courtyard/robot/detail', { sn: 'SN-COMPLETE-6' });
      const extendAfter = (detailAfter.json.data as Record<string, unknown>).extend_status as Record<string, unknown>;
      assert.equal(extendAfter.wait_extend_timestamp, 0);
    } finally {
      server.close();
    }
  });
});
