import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { ChaosController } from '../src/sim/chaos';
import { applyFault, readFault } from '../src/sim/faults';

describe('mapping_undock_failed fault', () => {
  it('is a listed fault fixture with the expected shape', () => {
    const fault = readFault('mapping_undock_failed');
    assert.equal(fault.name, 'mapping_undock_failed');
    assert.equal(fault.notify?.sub_status, 'undocking_failed');
  });

  it('terminates an active mapping task: state ERRORED, sub_status undocking_failed, task_status FAILED, no retry path', () => {
    const robot = new VirtualRobot({ sn: 'SN-UNDOCK-1' });
    const { task } = robot.createMappingTask({ sn: 'SN-UNDOCK-1', map_id: 'mock_map_001', mode: 'auto' });
    assert.ok(task);
    const chaos = new ChaosController();

    const result = applyFault('mapping_undock_failed', { robot, chaos });
    assert.equal(result.ok, true);

    const snapshot = robot.snapshot();
    assert.equal(snapshot.mapping.state, 'ERRORED');
    assert.equal(snapshot.mapping.phase, 'MAP_UNDOCKING_FAILED');
    assert.equal(snapshot.lastNotifySubStatus, 'undocking_failed');

    const updated = robot.activeMappingTask();
    assert.equal(updated?.task_id, task.task_id);
    assert.equal(updated?.status, 'FAILED');

    // Terminal: nothing in the FSM offers a resume/retry path back to ON_THE_WAY.
    assert.equal(snapshot.mapping.resumeTo, null);
  });

  it('does not re-fire DEVICE_ERROR if the phase is already ERRORED (idempotent)', () => {
    const robot = new VirtualRobot({ sn: 'SN-UNDOCK-2' });
    robot.createMappingTask({ sn: 'SN-UNDOCK-2', map_id: 'mock_map_001', mode: 'auto' });
    const chaos = new ChaosController();
    applyFault('mapping_undock_failed', { robot, chaos });
    assert.equal(robot.snapshot().mapping.state, 'ERRORED');

    // A second identical notify is deduped by pushRatelStatus itself (same work/sub pair).
    const pushed = robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'undocking_failed' });
    assert.equal(pushed, false);
    assert.equal(robot.snapshot().mapping.state, 'ERRORED');
  });
});
