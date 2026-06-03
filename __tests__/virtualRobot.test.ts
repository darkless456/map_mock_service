import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VirtualRobot } from '../src/sim/virtualRobot';
import { buildMowStatus, buildNotifyRatelStatus, buildCurrentRatelStatusPayload } from '../src/sim/pushChannels';
import { buildTaskListData } from '../src/sim/taskBridge';

describe('VirtualRobot mapping domain', () => {
  it('starts mapping in PREPARING and reaches a streamable phase via sub_status notify', () => {
    const robot = new VirtualRobot({ sn: 'SN-1' });
    robot.startMapping({ sn: 'SN-1', mode: 'auto' });
    assert.equal(robot.snapshot().activeDomain, 'mapping');
    assert.equal(robot.snapshot().mapping.state, 'PREPARING');
    assert.equal(robot.snapshot().mapping.phase, null);
    assert.equal(robot.shouldStreamMap(), false);

    robot.dispatchRatelNotify({ work_status: 'mapping', sub_status: 'leave_dock' });
    assert.equal(robot.snapshot().mapping.state, 'UNDOCKING');
    robot.dispatchRatelNotify({ work_status: 'mapping', sub_status: 'find_boundary' });
    assert.equal(robot.snapshot().mapping.state, 'WORKING');
    assert.equal(robot.snapshot().mapping.phase, 'MAP_SCAN_BOUNDARY');
    assert.equal(robot.shouldStreamMap(), true);
  });

  it('builds NOTIFY_RATEL_STATUS with simulator extension fields', () => {
    const robot = new VirtualRobot({ sn: 'SN-2' });
    robot.startMapping({ sn: 'SN-2', mode: 'auto' });
    const status = buildNotifyRatelStatus(robot, buildCurrentRatelStatusPayload(robot));
    assert.equal(status.cmd, 'NOTIFY_RATEL_STATUS');
    assert.equal(status.data.sn, 'SN-2');
    assert.equal(status.data.work_status, 'mapping');
    assert.ok(status.data.capabilities);
  });
});

describe('VirtualRobot mowing domain', () => {
  it('creates, pauses, resumes, and lists a mowing task', () => {
    const robot = new VirtualRobot({ sn: 'SN-M' });
    const task = robot.createMowingTask({
      sn: 'SN-M',
      task_info: { task_mode: 'global', map_id: 'mock_map_001', mow_height: 60, mow_speed: 0.3 },
    });
    assert.equal(task.status, 'ON_THE_WAY');
    assert.equal(robot.snapshot().mowing.state, 'WORKING');

    assert.equal(robot.applyMowingAction(task.task_id, 'PAUSE'), null);
    assert.equal(robot.activeTask()?.status, 'PAUSE');
    assert.equal(robot.applyMowingAction(task.task_id, 'RESUME'), null);
    assert.equal(robot.activeTask()?.status, 'ON_THE_WAY');

    const list = buildTaskListData(robot, 'SN-M') as { total: number; list: Array<{ task_status: string }> };
    assert.equal(list.total, 1);
    assert.equal(list.list[0].task_status, 'ON_THE_WAY');
  });

  it('builds flattened NOTIFY_MOW_STATUS payloads', () => {
    const robot = new VirtualRobot({ sn: 'SN-M2' });
    const task = robot.createMowingTask({ sn: 'SN-M2', task_info: { task_mode: 'global', map_id: 'm1' } });
    const msg = buildMowStatus(task);
    assert.equal(msg.cmd, 'NOTIFY_MOW_STATUS');
    assert.equal(msg.data.task_id, task.task_id);
    assert.equal(msg.data.task_status, 'ON_THE_WAY');
  });
});
