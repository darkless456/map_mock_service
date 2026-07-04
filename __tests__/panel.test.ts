import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPanelHtml } from '../src/sim/panel';

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
});
