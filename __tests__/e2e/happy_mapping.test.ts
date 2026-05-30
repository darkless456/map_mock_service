import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChaosController } from '../../src/sim/chaos';
import { ScenarioEngine } from '../../src/sim/scenarioEngine';
import { VirtualRobot } from '../../src/sim/virtualRobot';

describe('e2e scenarios', () => {
  it('runs the checked-in happy_mapping scenario', async () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    assert.ok(engine.listScenarios().includes('happy_mapping'));
    const result = await engine.run({ name: 'happy_mapping' });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
  });
});
