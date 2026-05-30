import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Recorder } from '../src/sim/recorder';
import { VirtualRobot } from '../src/sim/virtualRobot';

describe('Recorder', () => {
  it('records FSM transcripts and replays them', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mower-recorder-'));
    const robot = new VirtualRobot();
    const recorder = new Recorder(dir);
    recorder.attachRobot(robot);
    const started = recorder.start('unit');

    robot.applySetup({ domain: 'mapping', state: 'PREPARING', phase: 'MAP_PRECHECK' });
    robot.dispatchRaw({ type: 'DEVICE_WORK_STATUS', status: 'mapping', source: 'ws', ts: Date.now() }, 'mapping');
    recorder.stop();

    assert.ok(started.file);
    const entries = recorder.readRecording(started.file!);
    assert.ok(entries.some(entry => entry.dir === 'fsm'));

    const replayRobot = new VirtualRobot();
    replayRobot.applySetup({ domain: 'mapping', state: 'PREPARING', phase: 'MAP_PRECHECK' });
    const result = await recorder.replay(replayRobot, { inline: entries });
    assert.equal(result.replayed, 1);
    assert.equal(replayRobot.snapshot().mapping.state, 'UNDOCKING');
  });
});
