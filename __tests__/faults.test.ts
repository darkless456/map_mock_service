import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChaosController } from '../src/sim/chaos';
import { applyFault, listFaults } from '../src/sim/faults';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';

describe('fault fixtures', () => {
  it('lists checked-in fault definitions', () => {
    const names = listFaults().map(fault => fault.name);
    assert.ok(names.includes('network_delay'));
    assert.ok(names.includes('mapping_estop'));
  });

  it('applies chaos from a fault definition', () => {
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const result = applyFault('network_delay', { robot, chaos });
    assert.equal(result.ok, true, result.error);
    assert.equal(chaos.snapshot().latencyMs, 800);
    assert.equal(chaos.snapshot().reorderWindowMs, 400);
  });

  it('applies notify faults through scenario steps', async () => {
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const engine = new ScenarioEngine({
      robot,
      chaos,
      applyFault: (name) => applyFault(name, { robot, chaos }),
    });
    const result = await engine.run({
      inline: {
        name: 'fault smoke',
        domain: 'mapping',
        setup: { state: 'WORKING', phase: 'MAP_SCAN_BOUNDARY' },
        steps: [
          { fault: 'mapping_estop' },
          { expect: { state: 'ESTOPPED' } },
        ],
      },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.logs[1]?.kind, 'fault');
  });
});
