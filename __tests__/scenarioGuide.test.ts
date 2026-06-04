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

  it('lists catalog with at least nine scenarios', () => {
    const catalog = listScenarioGuideSummaries(DEFAULT_SCENARIO_ROOT);
    assert.ok(catalog.length >= 9);
    const happy = catalog.find(entry => entry.name === 'mapping_happy_auto');
    assert.ok(happy);
    assert.ok(happy!.summary.length > 0);
    assert.equal(happy!.domainLabel, '建图');
  });

  it('returns null for unknown scenario', () => {
    assert.equal(loadScenarioGuide('not_a_real_scenario_xyz'), null);
  });
});
