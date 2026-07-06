import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChaosController } from '../src/sim/chaos';
import { ScenarioEngine } from '../src/sim/scenarioEngine';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { buildNotifyRatelStatus } from '../src/sim/pushChannels';

describe('pushRatelStatus / NOTIFY_RATEL_STATUS', () => {
  it('broadcast payload includes work_status and sub_status', () => {
    const robot = new VirtualRobot({ sn: 'SN-WS' });
    robot.applySetup({ domain: 'mapping', state: 'PREPARING', phase: null });
    const pushed: unknown[] = [];
    robot.on('ratelStatus', payload => pushed.push(payload));

    assert.equal(robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'leave_dock' }), true);
    assert.equal(robot.snapshot().mapping.state, 'UNDOCKING');
    assert.equal(pushed.length, 1);

    const envelope = buildNotifyRatelStatus(robot, pushed[0] as never);
    assert.equal(envelope.cmd, 'NOTIFY_RATEL_STATUS');
    assert.equal(envelope.data.work_status, 'mapping');
    assert.equal(envelope.data.sub_status, 'leave_dock');
  });

  it('dedupes identical work_status and sub_status', () => {
    const robot = new VirtualRobot();
    robot.applySetup({ domain: 'mapping', state: 'PREPARING', phase: null });
    assert.equal(robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'precondition' }), true);
    assert.equal(robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'precondition' }), false);
  });

  it('mapping then idle completes mock FSM like mapping->idle registry', () => {
    const robot = new VirtualRobot();
    robot.applySetup({ domain: 'mapping', state: 'WORKING', phase: 'MAP_BOUNDARY_DONE' });
    robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'bow_cover' });
    assert.equal(robot.mapping.phase, 'MAP_COMPLETE');
    robot.pushRatelStatus({ work_status: 'idle', sub_status: 'none' });
    assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
    assert.equal(robot.snapshot().mapping.phase, 'MAP_COMPLETE');
  });

  it('mowing notify sequence reaches WORKING via sub_status', () => {
    const robot = new VirtualRobot({ sn: 'SN-MOW-N' });
    robot.applySetup({ domain: 'mowing', state: 'PREPARING', phase: null });
    assert.equal(robot.pushRatelStatus({ work_status: 'mowing', sub_status: 'map_check' }), true);
    assert.equal(robot.snapshot().activeDomain, 'mowing');
    robot.pushRatelStatus({ work_status: 'mowing', sub_status: 'leave_dock' });
    robot.pushRatelStatus({ work_status: 'mowing', sub_status: 'mowing' });
    assert.equal(robot.snapshot().mowing.state, 'WORKING');
    assert.equal(robot.snapshot().mowing.phase, 'MOW_RUNNING');
  });

  it('return_dock notify drives RETURNING_DOCK sub-phases then idle → COMPLETED', () => {
    const robot = new VirtualRobot({ sn: 'SN-MOW-RD' });
    robot.applySetup({ domain: 'mowing', state: 'WORKING', phase: 'MOW_RUNNING' });
    robot.pushRatelStatus({ work_status: 'return_dock', sub_status: 'go_to_pre_dock_point' });
    assert.equal(robot.snapshot().mowing.state, 'RETURNING_DOCK');
    assert.equal(robot.snapshot().mowing.phase, 'RETURN_PRE_DOCK');
    robot.pushRatelStatus({ work_status: 'return_dock', sub_status: 'seek_charger_dock' });
    assert.equal(robot.snapshot().mowing.phase, 'RETURN_SEEK_CHARGER');
    robot.pushRatelStatus({ work_status: 'return_dock', sub_status: 'enter_dock' });
    assert.equal(robot.snapshot().mowing.phase, 'RETURN_ENTER_DOCK');
    robot.pushRatelStatus({ work_status: 'return_dock', sub_status: 'at_dock' });
    assert.equal(robot.snapshot().mowing.state, 'RETURNING_DOCK');
    assert.equal(robot.snapshot().mowing.phase, 'RETURN_AT_DOCK');
    // RETURN_AT_DOCK 不直接完成；需等 work_status idle。
    robot.pushRatelStatus({ work_status: 'idle', sub_status: 'none' });
    assert.equal(robot.snapshot().mowing.state, 'COMPLETED');
  });

  it('maps mapping emergency_stop into ESTOPPED and requires reset after release', () => {
    const robot = new VirtualRobot({ sn: 'SN-MAP-ESTOP' });
    robot.applySetup({ domain: 'mapping', state: 'WORKING', phase: 'MAP_FOLLOW_BOUNDARY' });

    assert.equal(robot.pushRatelStatus({ work_status: 'emergency_stop', sub_status: 'none' }), true);
    assert.equal(robot.snapshot().mapping.state, 'ESTOPPED');
    assert.equal(robot.snapshot().mapping.estopActive, true);

    assert.equal(robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'edge_mapping' }), true);
    assert.equal(robot.snapshot().mapping.state, 'ESTOPPED');
    assert.equal(robot.snapshot().mapping.estopActive, false);

    robot.dispatchMappingEvent({ type: 'CMD_RESET' });
    assert.equal(robot.snapshot().mapping.state, 'RESUMING');

    assert.equal(robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'edge_mapping' }), true);
    assert.equal(robot.snapshot().mapping.state, 'WORKING');
    assert.equal(robot.snapshot().mapping.phase, 'MAP_FOLLOW_BOUNDARY');
  });

  it('maps mowing emergency_stop into ESTOPPED and release resumes mowing status flow', () => {
    const robot = new VirtualRobot({ sn: 'SN-MOW-ESTOP' });
    robot.applySetup({ domain: 'mowing', state: 'WORKING', phase: 'MOW_RUNNING' });

    assert.equal(robot.pushRatelStatus({ work_status: 'emergency_stop', sub_status: 'none' }), true);
    assert.equal(robot.snapshot().mowing.state, 'ESTOPPED');
    assert.equal(robot.snapshot().mowing.estopActive, true);

    assert.equal(robot.pushRatelStatus({ work_status: 'mowing', sub_status: 'mowing' }), true);
    assert.equal(robot.snapshot().mowing.state, 'WORKING');
    assert.equal(robot.snapshot().mowing.phase, 'MOW_RUNNING');
    assert.equal(robot.snapshot().mowing.estopActive, false);
  });

  it('runs the checked-in mapping emergency-stop scenario to COMPLETED', async () => {
    const robot = new VirtualRobot({ sn: 'SN-MAP-SCENARIO' });
    const engine = new ScenarioEngine({ robot, chaos: new ChaosController() });
    const result = await engine.run({ name: 'mapping_estop_edge_follow' });
    assert.equal(result.ok, true, result.error);
    assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
  });

  it('startRecharge emits RECHARGE ON_THE_WAY and clears mowing FSM', () => {
    const robot = new VirtualRobot({ sn: 'SN-RC' });
    robot.applySetup({ domain: 'mowing', state: 'WORKING', phase: 'MOW_RUNNING' });
    const recharge: unknown[] = [];
    robot.on('rechargeStatus', payload => recharge.push(payload));
    const task = robot.startRecharge('SN-RC');
    assert.ok(task.task_id);
    assert.equal(robot.activeRechargeTask()?.status, 'ON_THE_WAY');
    assert.equal(robot.snapshot().mowing.state, 'IDLE');
    assert.equal(recharge.length, 1);
    assert.equal((recharge[0] as { task_status: string }).task_status, 'ON_THE_WAY');
    // CANCEL stops the scheduled return_dock sequence.
    assert.equal(robot.applyRechargeAction('CANCEL'), null);
    assert.equal(robot.activeRechargeTask()?.status, 'CANCEL');
  });
});
