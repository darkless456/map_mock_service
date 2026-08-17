import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHttpHandler, type AppRouteContext } from '../src/http/router';
import { ChaosController } from '../src/sim/chaos';
import { MapStream } from '../src/sim/mapStream';
import { Recorder } from '../src/sim/recorder';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';

class MockRequest extends Readable {
  headers: IncomingMessage['headers'] = { host: 'localhost:9900' };

  constructor(
    readonly method: string,
    readonly url: string,
  ) {
    super();
  }

  _read(): void {
    this.push(null);
  }
}

class MockResponse {
  writableEnded = false;
  statusCode = 0;
  body = '';
  headers: Record<string, string | number | readonly string[]> = {};

  setHeader(name: string, value: string | number | readonly string[]): void {
    this.headers[name.toLowerCase()] = Array.isArray(value) ? [...value] : value;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): void {
    this.statusCode = statusCode;
    if (headers) {
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    }
  }

  end(chunk?: unknown): void {
    this.writableEnded = true;
    this.body = chunk == null ? '' : String(chunk);
  }
}

function makeContext(chaos: ChaosController): AppRouteContext {
  const robot = new VirtualRobot();
  const recorder = new Recorder();
  return {
    port: 9900,
    dataDir: '',
    robot,
    mapStream: new MapStream([]),
    chaos,
    scenarioEngine: new ScenarioEngine({ robot, chaos, recorder }),
    recorder,
  };
}

async function dispatch(path: string, chaos: ChaosController): Promise<{ elapsed: number; res: MockResponse }> {
  const handler = createHttpHandler(makeContext(chaos));
  const req = new MockRequest('GET', path) as unknown as IncomingMessage;
  const res = new MockResponse();
  const started = Date.now();
  await handler(req, res as unknown as ServerResponse);
  return { elapsed: Date.now() - started, res };
}

describe('HTTP realism delay', () => {
  it('delays business routes but not control routes', async () => {
    // 注入 200ms（而非 20ms）：阈值要扛得住 `node --test` 并行跑其它用例时的调度抖动，否则
    // 「控制路由未被延迟」这条断言会随机变红（20ms 档下实测约每三次一次）。
    const chaos = new ChaosController({
      enabled: true,
      httpDelayMinMs: 200,
      httpDelayMaxMs: 200,
      wsDelayMinMs: 0,
      wsDelayMaxMs: 0,
    });

    const business = await dispatch('/ratel/unknown', chaos);
    assert.ok(business.elapsed >= 150, `expected business route delay, got ${business.elapsed}ms`);
    assert.equal(business.res.statusCode, 404);

    const control = await dispatch('/sim/state', chaos);
    assert.ok(control.elapsed < 100, `expected control route to skip delay, got ${control.elapsed}ms`);
    assert.equal(control.res.statusCode, 200);
  });
});
