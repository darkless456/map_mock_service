import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanelHtml } from '../src/sim/panel';
import { phaseGraphFromFsm, PANEL_GRAPH_JSON } from '../src/sim/panelGraph';

describe('sim panel', () => {
  it('renders the split control panel shell', () => {
    const html = renderPanelHtml();
    assert.match(html, /id="metrics"/);
    assert.match(html, /id="fsm-graph"/);
    assert.match(html, /id="timeline"/);
    assert.match(html, /id="dataset"/);
    assert.match(html, /id="fault"/);
    assert.match(html, /id="realism-summary"/);
  });

  it('injects the FSM-derived phase graph into the client script', () => {
    const html = renderPanelHtml();
    // The graph literal is embedded as `const PHASE_GRAPH = {...};`
    assert.match(html, /const PHASE_GRAPH = /);
    assert.match(html, /"lanes"/);
  });
});

describe('phaseGraphFromFsm', () => {
  const graph = phaseGraphFromFsm();

  it('compiles mapping + mowing lanes from the fsm-mirror enums', () => {
    assert.equal(graph.lanes.length, 2);
    const domains = graph.lanes.map(l => l.domain);
    assert.deepEqual(domains, ['mapping', 'mowing']);
  });

  it('maps every MAPPING_PHASES entry onto the mapping lane', () => {
    const lane = graph.lanes.find(l => l.domain === 'mapping')!;
    const keys = lane.nodes.map(n => n.key);
    // Spine nodes bookend the business phases
    assert.ok(keys.includes('IDLE'));
    assert.ok(keys.includes('PREPARING'));
    assert.ok(keys.includes('UNDOCKING'));
    assert.ok(keys.includes('COMPLETED'));
    // Mainline business phases are represented; skipped coverage phases stay off the lane.
    for (const phase of [
      'MAP_SCAN_BOUNDARY',
      'MAP_FOLLOW_BOUNDARY',
      'MAP_COMPLETE',
    ]) {
      assert.ok(keys.includes(phase), `mapping lane should include ${phase}`);
    }
    assert.ok(!keys.includes('MAP_COVERAGE_RUN'), 'mapping lane should skip coverage phases');
  });

  it('maps the mowing lane with MOW_RUNNING + return-dock sub-phases', () => {
    const lane = graph.lanes.find(l => l.domain === 'mowing')!;
    const keys = lane.nodes.map(n => n.key);
    assert.ok(keys.includes('MOW_RUNNING'));
    assert.ok(keys.includes('RETURN_PRE_DOCK'));
    assert.ok(keys.includes('RETURN_AT_DOCK'));
    assert.ok(keys.includes('COMPLETED'));
  });

  it('orders nodes so IDLE precedes COMPLETED in both lanes', () => {
    for (const lane of graph.lanes) {
      const keys = lane.nodes.map(n => n.key);
      const idleIdx = keys.indexOf('IDLE');
      const doneIdx = keys.indexOf('COMPLETED');
      assert.ok(idleIdx >= 0 && doneIdx >= 0, `${lane.domain}: IDLE/COMPLETED missing`);
      assert.ok(idleIdx < doneIdx, `${lane.domain}: IDLE must precede COMPLETED`);
    }
  });

  it('serializes to valid JSON matching the injected literal', () => {
    const parsed = JSON.parse(PANEL_GRAPH_JSON);
    assert.equal(parsed.lanes.length, 2);
    assert.equal(parsed.lanes[0].domain, 'mapping');
  });
});
