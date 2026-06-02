import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';

describe('ScenarioEngine', () => {
  it('runs an inline mapping scenario', async () => {
    const robot = new VirtualRobot({ sn: 'SN-SCENARIO' });
    const chaos = new ChaosController();
    const engine = new ScenarioEngine({ robot, chaos });
    const result = await engine.run({
      inline: `
name: inline mapping smoke
domain: mapping
setup: { state: PREPARING, phase: null }
steps:
  - notify: { work_status: mapping, sub_status: leave_dock }
  - expect: { state: UNDOCKING }
  - notify: { work_status: mapping, sub_status: find_boundary }
  - expect: { state: WORKING, phase: MAP_SCAN_BOUNDARY }
`,
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().mapping.state, 'WORKING');
  });

  it('reports expectation mismatches', async () => {
    const robot = new VirtualRobot();
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const result = await engine.run({
      inline: {
        name: 'bad expectation',
        domain: 'mapping',
        setup: { state: 'IDLE', phase: null },
        steps: [{ expect: { state: 'WORKING' } }],
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /expected/);
  });
});
