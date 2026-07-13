import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { generateTicket } from '../src/auth/ticket';
import { createHttpHandler } from '../src/http/router';
import { ChaosController } from '../src/sim/chaos';
import { MapStream } from '../src/sim/mapStream';
import { Recorder } from '../src/sim/recorder';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { createWsServer } from '../src/ws/wsServer';

/**
 * The mock sends `NOTIFY_RATEL_STATUS` synchronously in the server's `connection` handler —
 * often before the client's own `open` event fires. Attaching a `message` listener only after
 * awaiting `open` (the pattern other e2e tests use for later, action-triggered messages) loses
 * that first frame. So this buffers every message from construction time onward.
 */
function bufferMessages(ws: WebSocket): { data: Array<{ cmd?: string; data?: Record<string, unknown> }> } {
  const buffer: Array<{ cmd?: string; data?: Record<string, unknown> }> = [];
  ws.on('message', raw => buffer.push(JSON.parse(raw.toString())));
  return { data: buffer };
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForBufferedCommand(
  buffer: { data: Array<{ cmd?: string; data?: Record<string, unknown> }> },
  cmd: string,
  timeoutMs = 1000,
): Promise<{ data: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const found = buffer.data.find(m => m.cmd === cmd);
      if (found) {
        resolve(found as { data: Record<string, unknown> });
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`timed out waiting for ${cmd}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

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

describe('reconnect recovery (Appendix C #4)', () => {
  it('a fresh WS connection replays the exact sub_status/sub_status_entered_at/extend_status robot/detail reports mid-session', async () => {
    const httpServer = http.createServer();
    const robot = new VirtualRobot({ sn: 'SN-RECONNECT-1' });
    const chaos = new ChaosController();
    const mapStream = new MapStream([]);

    const recorder = new Recorder();
    httpServer.on(
      'request',
      createHttpHandler({
        port: 0,
        dataDir: '',
        robot,
        mapStream,
        chaos,
        scenarioEngine: new ScenarioEngine({ robot, chaos, recorder }),
        recorder,
      }),
    );
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const httpAddress = httpServer.address();
    assert.ok(httpAddress && typeof httpAddress === 'object');
    const httpPort = httpAddress.port;

    const wsRuntime = createWsServer({ server: httpServer, robot, mapStream, chaos });

    try {
      // Drive the robot mid-session: create a task, reach find_boundary, let the
      // legitimate_starting_point settle timer fire so extend_status isn't all-zero.
      await postJson(httpPort, '/ratel/central-control-service/api/v1/ratel_mapping_task/create', {
        sn: 'SN-RECONNECT-1',
        map_id: 'mock_map_001',
        mode: 'auto',
      });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' });
      robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'find_boundary' });
      await new Promise(resolve => setTimeout(resolve, 3100));

      const detail = await postJson(httpPort, '/ratel/api/v1/courtyard/robot/detail', { sn: 'SN-RECONNECT-1' });
      const detailData = detail.json.data as Record<string, unknown>;
      assert.equal(detailData.sub_status, 'find_boundary');

      // Simulate the App being killed and reopened: a brand-new WS connection.
      const { ticket } = generateTicket({ userId: 'reconnect-test' });
      const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/acc?ticket=${ticket}`);
      const buffer = bufferMessages(ws);
      try {
        await waitForOpen(ws);
        const notify = await waitForBufferedCommand(buffer, 'NOTIFY_RATEL_STATUS');

        assert.equal(notify.data.sub_status, detailData.sub_status);
        assert.equal(notify.data.sub_status_entered_at, detailData.sub_status_entered_at);
        assert.deepEqual(notify.data.extend_status, detailData.extend_status);
      } finally {
        ws.close();
      }
    } finally {
      wsRuntime.close();
      httpServer.close();
    }
  });
});
