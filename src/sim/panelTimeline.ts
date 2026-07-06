/**
 * Panel timeline client-script module — §6.7(2)(5)(7).
 *
 * Extracted from the monolithic panelClient script so the event-flow rendering
 * (classification, card markup, WS field parsing) is independently testable
 * and maintainable. Renders reverse-chronological event cards colored by kind
 * (CMD blue / NOTIFY green / FSM violet / ERROR red), each with a one-line
 * business-field summary and a click-to-expand raw payload.
 */
export const PANEL_TIMELINE_SCRIPT = `
let events = [];

// §6.7(1) P5b 改进 1: incremental lane state. A lane starts at just IDLE and
// grows as WS inspect events reveal phases the running scenario reaches.
// Declared here (alongside pushEvent) so trackVisitedPhases/resetVisitedPhases
// share scope; panelClient.renderLane reads it via the combined script scope.
const visitedPhases = { mapping: new Set(['IDLE']), mowing: new Set(['IDLE']) };

function resetVisitedPhases() {
  visitedPhases.mapping.clear();
  visitedPhases.mapping.add('IDLE');
  visitedPhases.mowing.clear();
  visitedPhases.mowing.add('IDLE');
}

function classifyEvent(payload) {
  if (payload && payload.kind === 'hello') return 'cmd';
  const cmd = payload.cmd || payload.kind || '';
  if (cmd === 'NOTIFY_RATEL_STATUS' || String(cmd).indexOf('NOTIFY') >= 0) return 'notify';
  if (cmd === 'transcript' || payload.kind === 'transcript') return 'fsm';
  if (payload.error) return 'error';
  return 'cmd';
}

function eventTitle(payload) {
  if (payload.cmd) return payload.cmd;
  // pushEvent already unwrapped transcript envelopes, so a transcript card
  // reaches here as { kind: 'transcript', event, before, after }.
  if (payload.kind === 'hello') return 'hello (snapshot)';
  if (payload.kind === 'transcript') {
    const evt = payload.event || {};
    if (evt.type) return evt.type;
    return 'transcript';
  }
  if (payload.kind) return payload.kind;
  if (payload.event && payload.event.type) return payload.event.type;
  return 'event';
}

// Normalize an inspect-WS message into the shape eventMeta / trackVisitedPhases
// read. The /sim/inspect socket enqueues two envelope shapes:
//   - transcript: { kind: 'transcript', transcript: { ts, domain, event, before, after, changed } }
//   - hello:      { kind: 'hello', snapshot: <VirtualRobotSnapshot> }
// Both are flattened so downstream code reads .before / .after / .event directly.
// Plain app-WS NOTIFY payloads pass through unchanged. NOTE: those NOTIFY bodies
// ride the business wss, not the inspect socket, so the inspect timeline only
// ever sees transcript/hello.
function unwrapInspect(payload) {
  if (payload && payload.kind === 'transcript' && payload.transcript) {
    const t = payload.transcript;
    return {
      kind: 'transcript',
      domain: t.domain,
      event: t.event,
      before: t.before || {},
      after: t.after || {},
      changed: t.changed,
    };
  }
  // The initial hello envelope carries a full snapshot; project it into the
  // after-slot so trackVisitedPhases seeds visited lanes from it and eventMeta
  // can render the starting phase without special-casing.
  if (payload && payload.kind === 'hello' && payload.snapshot) {
    return {
      kind: 'hello',
      domain: payload.snapshot.activeDomain,
      event: { type: 'hello' },
      after: payload.snapshot,
      before: {},
      changed: true,
    };
  }
  return payload;
}

function eventMeta(payload) {
  // pushEvent already unwrapped the inspect transcript envelope, so payload
  // is the flat shape here: { kind:'transcript', event, before, after, ... } or
  // a NOTIFY/HTTP payload. The data fallback covers app-WS NOTIFY bodies where
  // the live snapshot sits under payload.data.
  const data = payload.data || payload.after || payload;
  const parts = [];

  // §6.7(2) P5b 改进 2: surface the channel source so each card shows where the
  // event came from without expanding the payload.
  const source = payload.source || (payload.event && payload.event.source);
  if (source) parts.push('[' + source + ']');

  if (payload.cmd === 'NOTIFY_RATEL_STATUS' || String(payload.cmd).indexOf('NOTIFY') >= 0) {
    // NOTIFY cards: show "work_status → sub_status" (arrow form, more scannable
    // than the flat key=value list).
    if (data.work_status || data.sub_status) {
      parts.push((data.work_status || '?') + ' → ' + (data.sub_status || '-'));
    }
    if (data.task_status) parts.push('task=' + data.task_status);
    return parts.join(' ');
  }

  if (payload.kind === 'transcript' || (payload.event && payload.event.type)) {
    // FSM transcript cards: "before.state → after.state | event.type".
    const before = payload.before || {};
    const after = payload.after || {};
    const evt = payload.event || {};
    // Snapshots carry both the FSM state and the business phase; show the phase
    // when present (the lane tracks phases, not bare states) so the card stays
    // in sync with the lane labels rather than showing raw TaskState names.
    const beforeKey = before.phase || before.state || '?';
    const afterKey = after.phase || after.state || '?';
    const transition = beforeKey + ' → ' + afterKey;
    if (evt.type) parts.push(transition + ' | ' + evt.type);
    else parts.push(transition);
    return parts.join(' ');
  }

  if (data.work_status) parts.push('work=' + data.work_status);
  if (data.sub_status) parts.push('sub=' + data.sub_status);
  if (data.task_status) parts.push('task=' + data.task_status);
  if (data.state) parts.push('state=' + data.state);
  if (data.phase) parts.push('phase=' + data.phase);
  return parts.join(' / ');
}

// §6.7(1) P5b 改进 1: record each observed phase/state so the FSM lane only
// renders nodes the running scenario has actually reached. transcript events
// carry before/after snapshots (after unwrap); NOTIFY pushes carry the projected
// phase. payload here is already the unwrapped shape from pushEvent.
function trackVisitedPhases(payload) {
  const after = payload.after || payload.data || {};
  const before = payload.before || {};
  // Each transcript snapshot already nests per-domain contexts under
  // after.mapping / after.mowing, so the visited set grows per-domain as
  // a different FSM emits transitions.
  for (const dom of ['mapping', 'mowing']) {
    const visited = visitedPhases[dom];
    const ctx = after[dom] || before[dom];
    if (ctx) {
      if (ctx.state) visited.add(ctx.state);
      if (ctx.phase) visited.add(ctx.phase);
    }
  }
  // Top-level state/phase belongs to whichever domain the transcript is for.
  if (after.state) {
    const dom = payload.domain || (currentState.activeDomain || 'mapping');
    if (visitedPhases[dom]) visitedPhases[dom].add(after.state);
  }
  if (after.phase) {
    const dom = payload.domain || (currentState.activeDomain || 'mapping');
    if (visitedPhases[dom]) visitedPhases[dom].add(after.phase);
  }
}

function pushEvent(raw) {
  // §6.7(1)/(2) P5b: the /sim/inspect socket enqueues { kind:'transcript',
  // transcript:{...} } envelopes. Unwrap once here so eventMeta /
  // trackVisitedPhases / classifyEvent read flat fields instead of nested ones
  // (the prior bug swallowed before/after/state/phase -> cards showed '?' and
  // visited lanes never grew past IDLE). The raw envelope is kept under .raw
  // for the expandable payload dump; .view is the unwrapped shape used by the
  // card title/meta/classifiers.
  const view = unwrapInspect(raw);
  try { trackVisitedPhases(view); } catch (e) { /* best-effort, never break the timeline */ }
  events.unshift({ ts: new Date(), view, raw });
  events = events.slice(0, 80);
  const list = document.getElementById('timeline');
  list.innerHTML = events.map(item => {
    const klass = classifyEvent(item.view);
    return '<article class="event-card ' + klass + '">' +
      '<div class="event-head"><div class="event-title">' + escapeHtml(eventTitle(item.view)) + '</div><div class="event-time">' + item.ts.toLocaleTimeString() + '</div></div>' +
      '<div class="event-meta">' + escapeHtml(eventMeta(item.view) || klass) + '</div>' +
      '<details><summary>payload</summary><pre>' + escapeHtml(JSON.stringify(item.raw, null, 2)) + '</pre></details>' +
      '</article>';
  }).join('');
}
`;
