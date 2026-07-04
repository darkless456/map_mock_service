import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureLoader } from '../src/fixtures';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';

describe('fixture overrides', () => {
  it('overrides fixture reads only within the async scope', async () => {
    const original = fixtureLoader.read<Record<string, unknown>>('device/self_check.jsonc');
    await fixtureLoader.withOverrides({
      'device/self_check.jsonc': { overall: 'error', blade: 'warning' },
    }, async () => {
      const overridden = fixtureLoader.read<Record<string, unknown>>('device/self_check.jsonc');
      assert.equal(overridden.overall, 'error');
      assert.equal(overridden.blade, 'warning');
    });

    const restored = fixtureLoader.read<Record<string, unknown>>('device/self_check.jsonc');
    assert.equal(restored.overall, original.overall);
  });

  it('applies scenario fixture overrides while steps run', async () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const result = await engine.run({
      inline: {
        name: 'fixture override smoke',
        fixtures: {
          'device/self_check.jsonc': { overall: 'error', blade: 'warning' },
        },
        domain: 'mapping',
        setup: { state: 'IDLE', phase: null },
        steps: [
          { expect: { state: 'IDLE' } },
        ],
      },
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.logs[0]?.kind, 'fixtures');
  });
});
