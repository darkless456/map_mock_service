import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { ChaosController } from '../src/sim/chaos';
import { MapStream } from '../src/sim/mapStream';
import { Recorder, type RecordingEntry } from '../src/sim/recorder';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';

const originalEchoSetting = process.env.MOCK_ECHO_REQUEST_PAYLOAD;

afterEach(() => {
  if (originalEchoSetting === undefined) delete process.env.MOCK_ECHO_REQUEST_PAYLOAD;
  else process.env.MOCK_ECHO_REQUEST_PAYLOAD = originalEchoSetting;
});

interface JsonResponse {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly json: Record<string, unknown>;
}

function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<JsonResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(payload)),
        ...headers,
      },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function createTestServer(): Promise<{
  readonly server: http.Server;
  readonly port: number;
  readonly entries: RecordingEntry[];
}> {
  const server = http.createServer();
  const robot = new VirtualRobot();
  const chaos = new ChaosController();
  const recorder = new Recorder();
  const entries: RecordingEntry[] = [];
  recorder.on('entry', entry => entries.push(entry as RecordingEntry));
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
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, port: address.port, entries };
}

describe('HTTP request debugging', () => {
  it('adds a request id without changing the default response contract', async () => {
    delete process.env.MOCK_ECHO_REQUEST_PAYLOAD;
    const testServer = await createTestServer();
    try {
      const response = await postJson(
        testServer.port,
        '/ratel/map-service/api/v1/ratel/map/list?source=rn&source=debug',
        { sn: 'DEBUG-SN', password: 'do-not-log', nested: { access_token: 'secret-token' } },
      );

      assert.equal(response.status, 200);
      assert.match(String(response.headers['x-mock-request-id']), /^[0-9a-f-]{36}$/);
      assert.equal(response.json._mock, undefined);

      const entry = testServer.entries.find(item => item.kind === 'http');
      assert.ok(entry);
      assert.equal(entry.requestId, response.headers['x-mock-request-id']);
      assert.equal(entry.method, 'POST');
      assert.equal(entry.path, '/ratel/map-service/api/v1/ratel/map/list');
      assert.deepEqual(entry.query, { source: ['rn', 'debug'] });
      assert.equal(entry.statusCode, 200);
      assert.equal(typeof entry.durationMs, 'number');
      assert.deepEqual(entry.requestPayload, {
        sn: 'DEBUG-SN',
        password: '[REDACTED]',
        nested: { access_token: '[REDACTED]' },
      });
    } finally {
      await new Promise<void>((resolve, reject) => testServer.server.close(error => (error ? reject(error) : resolve())));
    }
  });

  it('echoes a redacted payload only when the debug header is enabled', async () => {
    delete process.env.MOCK_ECHO_REQUEST_PAYLOAD;
    const testServer = await createTestServer();
    try {
      const response = await postJson(
        testServer.port,
        '/ratel/map-service/api/v1/ratel/map/list',
        { sn: 'DEBUG-SN', password: 'hidden', payload: { ticket: 'hidden-too' } },
        { 'X-Mock-Debug-Echo': '1' },
      );

      const debug = response.json._mock as Record<string, unknown>;
      assert.equal(debug.requestId, response.headers['x-mock-request-id']);
      assert.deepEqual(debug.requestPayload, {
        sn: 'DEBUG-SN',
        password: '[REDACTED]',
        payload: { ticket: '[REDACTED]' },
      });
    } finally {
      await new Promise<void>((resolve, reject) => testServer.server.close(error => (error ? reject(error) : resolve())));
    }
  });
});
