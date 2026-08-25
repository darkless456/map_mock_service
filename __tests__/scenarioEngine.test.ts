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

  it('runs a mapping task action from a scenario step', async () => {
    const robot = new VirtualRobot({ sn: 'SN-SCENARIO-ACTION' });
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const result = await engine.run({
      inline: {
        name: 'mapping action smoke',
        domain: 'mapping',
        setup: { state: 'IDLE', phase: null },
        steps: [
          { emit: { type: 'CMD_START', mode: 'auto', taskMode: 'MAP_BUILD' } },
          { mappingAction: { action: 'CANCEL', save: false } },
          { expect: { state: 'CANCELLED' } },
        ],
      },
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.logs.some(log => log.kind === 'mappingAction'), true);
  });

  it('runs an inline mowing scenario with notify steps', async () => {
    const robot = new VirtualRobot({ sn: 'SN-MOW-SCENARIO' });
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const result = await engine.run({
      inline: {
        name: 'inline mowing smoke',
        domain: 'mowing',
        setup: { state: 'PREPARING', phase: null },
        steps: [
          { notify: { work_status: 'mowing', sub_status: 'leave_dock' } },
          { expect: { state: 'UNDOCKING' } },
          { notify: { work_status: 'mowing', sub_status: 'mowing' } },
          { expect: { state: 'WORKING', phase: 'MOW_RUNNING' } },
        ],
      },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().activeDomain, 'mowing');
  });

  it('pauses the running scenario and resumes from where it left off', async () => {
    const robot = new VirtualRobot({ sn: 'SN-PAUSE' });
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const runPromise = engine.run({
      inline: {
        name: 'pause smoke',
        domain: 'mapping',
        setup: { state: 'WORKING', phase: 'MAP_SCAN_BOUNDARY' },
        steps: [
          { wait: '300ms' },
          { notify: { work_status: 'mapping', sub_status: 'find_boundary' } },
          { wait: '300ms' },
          { expect: { state: 'WORKING', phase: 'MAP_SCAN_BOUNDARY' } },
        ],
      },
    });

    // 暂停后脚本不再推进：等待远超步骤时长，run 仍未完成。
    engine.pause();
    assert.equal(engine.isPaused, true);
    assert.equal(engine.snapshot().paused, true);
    const settledWhilePaused = await Promise.race([
      runPromise.then(() => 'done'),
      new Promise(resolve => setTimeout(() => resolve('still-running'), 800)),
    ]);
    assert.equal(settledWhilePaused, 'still-running', 'scenario must not progress while paused');
    assert.equal(engine.snapshot().running, 'pause smoke');

    // 恢复后从暂停处继续直到完成。
    engine.resume();
    assert.equal(engine.isPaused, false);
    const result = await runPromise;
    assert.equal(result.ok, true, result.error);
    assert.equal(result.stopped ?? false, false);
    assert.equal(engine.snapshot().running, null);
  });

  it('pauses/resumes the scenario via robot CMD_PAUSE/CMD_RESUME (panel & app path)', async () => {
    const robot = new VirtualRobot({ sn: 'SN-PAUSE-CMD' });
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const runPromise = engine.run({
      inline: {
        name: 'cmd pause smoke',
        domain: 'mapping',
        setup: { state: 'WORKING', phase: 'MAP_SCAN_BOUNDARY' },
        steps: [{ wait: '300ms' }, { wait: '300ms' }],
      },
    });

    // 模拟 Web 面板 / App 下发的暂停指令（CMD_PAUSE 经机器人广播控制意图）。
    robot.dispatchRaw({ type: 'CMD_PAUSE' }, 'mapping');
    assert.equal(engine.isPaused, true);
    const settledWhilePaused = await Promise.race([
      runPromise.then(() => 'done'),
      new Promise(resolve => setTimeout(() => resolve('still-running'), 800)),
    ]);
    assert.equal(settledWhilePaused, 'still-running', 'CMD_PAUSE must freeze the scenario loop');

    robot.dispatchRaw({ type: 'CMD_RESUME' }, 'mapping');
    assert.equal(engine.isPaused, false);
    const result = await runPromise;
    assert.equal(result.ok, true, result.error);
  });

  it('stop() releases a paused scenario so it can finish unwinding', async () => {
    const robot = new VirtualRobot({ sn: 'SN-PAUSE-STOP' });
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const runPromise = engine.run({
      inline: {
        name: 'pause then stop',
        domain: 'mapping',
        setup: { state: 'WORKING', phase: 'MAP_SCAN_BOUNDARY' },
        steps: [{ wait: '5s' }, { wait: '5s' }],
      },
    });
    engine.pause();
    await new Promise(resolve => setTimeout(resolve, 100));
    engine.stop();
    const result = await runPromise;
    assert.equal(result.stopped, true);
    assert.equal(engine.isPaused, false);
    assert.equal(engine.snapshot().running, null);
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

  it('switches dataset declared by a scenario before running steps', async () => {
    const robot = new VirtualRobot();
    const switched: string[] = [];
    const engine = new ScenarioEngine({
      robot,
      chaos: new ChaosController(),
      switchDataset: (name) => {
        switched.push(name);
        return { ok: true, name, patchCount: 3 };
      },
    });
    const result = await engine.run({
      inline: {
        name: 'dataset smoke',
        dataset: 'mowing_trajectory',
        domain: 'mapping',
        setup: { state: 'IDLE', phase: null },
        steps: [{ expect: { state: 'IDLE' } }],
      },
    });

    assert.equal(result.ok, true, result.error);
    assert.deepEqual(switched, ['mowing_trajectory']);
    assert.equal(result.logs[0]?.kind, 'dataset');
  });

  it('applies realism scenario steps', async () => {
    const robot = new VirtualRobot();
    const chaos = new ChaosController();
    const engine = new ScenarioEngine({ robot, chaos });
    const result = await engine.run({
      inline: {
        name: 'realism smoke',
        domain: 'mapping',
        setup: { state: 'IDLE', phase: null },
        steps: [
          { realism: { enabled: true, httpDelayMinMs: 1, httpDelayMaxMs: 1, wsDelayMinMs: 2, wsDelayMaxMs: 2 } },
          { expect: { state: 'IDLE' } },
        ],
      },
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.logs[1]?.kind, 'realism');
    assert.equal(chaos.realismSnapshot().enabled, true);
    assert.equal(chaos.httpDelayMs(), 1);
    assert.equal(chaos.wsDelayMs(), 2);
  });
});
