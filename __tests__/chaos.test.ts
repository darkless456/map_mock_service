import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChaosController } from '../src/sim/chaos';

describe('ChaosController realism', () => {
  it('keeps realism disabled by default', () => {
    const chaos = new ChaosController();
    assert.equal(chaos.httpDelayMs(), 0);
    assert.equal(chaos.wsDelayMs(), 0);
  });

  it('generates bounded HTTP and WS realism delays', () => {
    const chaos = new ChaosController({
      enabled: true,
      httpDelayMinMs: 10,
      httpDelayMaxMs: 12,
      wsDelayMinMs: 20,
      wsDelayMaxMs: 22,
    });
    for (let i = 0; i < 20; i += 1) {
      assert.ok(chaos.httpDelayMs() >= 10 && chaos.httpDelayMs() <= 12);
      assert.ok(chaos.wsDelayMs() >= 20 && chaos.wsDelayMs() <= 22);
    }
  });

  it('normalizes reversed ranges', () => {
    const chaos = new ChaosController({
      enabled: true,
      httpDelayMinMs: 30,
      httpDelayMaxMs: 10,
      wsDelayMinMs: 40,
      wsDelayMaxMs: 20,
    });
    assert.deepEqual(chaos.realismSnapshot(), {
      enabled: true,
      httpDelayMinMs: 10,
      httpDelayMaxMs: 30,
      wsDelayMinMs: 20,
      wsDelayMaxMs: 40,
    });
  });
});
