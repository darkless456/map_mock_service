import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePose,
  createPoseState,
  currentRobotPose,
  getMowingTrajectoryDebugInfo,
  loadMowingTrajectoryPoints,
  resetPoseState,
} from '../src/data/mowingTrajectory';

describe('semantic-zero mowing trajectory', () => {
  it('generates route points from full_semanticmap semantic-0 grass', () => {
    const route = loadMowingTrajectoryPoints();
    const debug = getMowingTrajectoryDebugInfo();

    assert.equal(debug.source, 'semantic-zero');
    assert.ok(route.length > 10);
    assert.ok(debug.bounds);
    assert.ok(debug.bounds.minX <= 213);
    assert.ok(debug.bounds.maxX >= 272);

    for (const point of route) {
      assert.ok(point.x >= 10.65 && point.x <= 14.2, `x ${point.x} should stay in semantic grass bounds`);
      assert.ok(point.y >= 9.75 && point.y <= 14.75, `y ${point.y} should stay in semantic grass bounds`);
    }
  });

  it('resetPoseState returns to route start', () => {
    const pose = createPoseState();
    advancePose(pose);
    advancePose(pose);
    const before = { x: pose.x, y: pose.y, index: pose.index };
    resetPoseState(pose);
    const start = currentRobotPose(pose);
    assert.equal(pose.index, 0);
    assert.notEqual(before.index, 0);
    assert.equal(start.x, loadMowingTrajectoryPoints()[0].x);
  });

  it('advances pose continuously along the generated route', () => {
    const pose = createPoseState();
    const first = currentRobotPose(pose);
    const second = advancePose(pose);
    const third = advancePose(pose);

    assert.notDeepEqual(second, first);
    assert.notDeepEqual(third, second);
    assert.equal(typeof second.angle, 'number');
  });
});
