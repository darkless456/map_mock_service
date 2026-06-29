import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadScenarioGuide,
  listScenarioGuideSummaries,
  DEFAULT_SCENARIO_ROOT,
} from '../src/sim/scenarioGuide';

describe('scenarioGuide', () => {
  it('loads guide for mapping_happy_auto', () => {
    const doc = loadScenarioGuide('mapping_happy_auto', DEFAULT_SCENARIO_ROOT);
    assert.ok(doc);
    assert.equal(doc!.name, 'mapping_happy_auto');
    assert.match(doc!.title, /建图/);
    assert.ok(doc!.userSteps.length >= 3);
    assert.ok(doc!.simulates.length >= 1);
    assert.equal(doc!.domain, 'mapping');
    assert.equal(doc!.domainLabel, '建图');
  });

  it('lists the core scenarios', () => {
    const catalog = listScenarioGuideSummaries(DEFAULT_SCENARIO_ROOT);
    const names = catalog.map(entry => entry.name).sort();
    assert.deepEqual(names, [
      'mapping_estop_edge_follow',
      'mapping_happy_auto',
      'mapping_happy_manual',
      'mapping_stream_incremental',
      'mowing_estop_running',
      'mowing_happy_auto',
      'mowing_recharge',
      'mowing_trajectory_stream',
    ]);
    const happy = catalog.find(entry => entry.name === 'mapping_happy_auto');
    assert.ok(happy);
    assert.ok(happy!.summary.length > 0);
    assert.equal(happy!.domainLabel, '建图');
  });

  it('returns null for unknown scenario', () => {
    assert.equal(loadScenarioGuide('not_a_real_scenario_xyz'), null);
  });
});
