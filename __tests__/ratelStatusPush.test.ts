import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

  it('mapping then idle completes mock FSM like mapping→idle registry', () => {
    const robot = new VirtualRobot();
    robot.applySetup({ domain: 'mapping', state: 'WORKING', phase: 'MAP_COVERAGE_RUN' });
    robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'exit_mapping' });
    assert.equal(robot.mapping.phase, 'MAP_COVERAGE_DONE');
    robot.pushRatelStatus({ work_status: 'idle', sub_status: 'none' });
    assert.equal(robot.snapshot().mapping.state, 'COMPLETED');
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
});
