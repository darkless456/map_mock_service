import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMowStatus, buildRobotLocation, buildRobotStatus } from '../src/sim/pushChannels';
import { VirtualRobot } from '../src/sim/virtualRobot';

describe('pushChannels', () => {
  it('projects capabilities and sub_status into ROBOT_STATUS', () => {
    const robot = new VirtualRobot({ sn: 'SN-PUSH' });
    robot.applySetup({
      domain: 'mapping',
      state: 'WORKING',
      phase: 'MAP_FOLLOW_BOUNDARY',
      capabilities: { canSwitchManual: true, canSwitchAuto: false },
    });
    robot.pushRatelStatus({ work_status: 'mapping', sub_status: 'edge_mapping' });
    const msg = buildRobotStatus(robot);
    assert.equal(msg.cmd, 'ROBOT_STATUS');
    assert.equal(msg.data.sn, 'SN-PUSH');
    assert.equal(msg.data.sub_status, 'edge_mapping');
    assert.equal(msg.data.phase, 'MAP_FOLLOW_BOUNDARY');
    assert.deepEqual(msg.data.estop, { active: false });
    assert.equal((msg.data.capabilities as { can_switch_manual: boolean }).can_switch_manual, true);
  });

  it('keeps NOTIFY_MOW_STATUS flattened and nested for app compatibility', () => {
    const robot = new VirtualRobot({ sn: 'SN-MOW' });
    const task = robot.createMowingTask({ sn: 'SN-MOW', task_info: { task_mode: 'global', map_id: 'mock_map_001' } });
    const msg = buildMowStatus(task);
    assert.equal(msg.cmd, 'NOTIFY_MOW_STATUS');
    assert.equal(msg.data.task_id, task.task_id);
    assert.equal((msg.data.payload as { task_id: string }).task_id, task.task_id);
  });

  it('emits both yaw and angle in ROBOT_LOCATION', () => {
    const msg = buildRobotLocation('SN-LOC', { x: 1, y: 2, angle: Math.PI });
    assert.equal(msg.cmd, 'ROBOT_LOCATION');
    assert.equal(msg.data.yaw, Math.PI);
    assert.equal(msg.data.angle, Math.PI);
  });
});
