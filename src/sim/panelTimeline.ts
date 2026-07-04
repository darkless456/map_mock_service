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

function classifyEvent(payload) {
  const cmd = payload.cmd || payload.kind || '';
  if (cmd === 'NOTIFY_RATEL_STATUS' || String(cmd).indexOf('NOTIFY') >= 0) return 'notify';
  if (cmd === 'transcript' || payload.kind === 'transcript') return 'fsm';
  if (payload.error) return 'error';
  return 'cmd';
}

function eventTitle(payload) {
  if (payload.cmd) return payload.cmd;
  if (payload.kind) return payload.kind;
  if (payload.event && payload.event.type) return payload.event.type;
  return 'event';
}

function eventMeta(payload) {
  const data = payload.data || payload.after || payload;
  const parts = [];
  if (data.work_status) parts.push('work=' + data.work_status);
  if (data.sub_status) parts.push('sub=' + data.sub_status);
  if (data.task_status) parts.push('task=' + data.task_status);
  if (data.state) parts.push('state=' + data.state);
  if (data.phase) parts.push('phase=' + data.phase);
  return parts.join(' / ');
}

function pushEvent(payload) {
  events.unshift({ ts: new Date(), payload });
  events = events.slice(0, 80);
  const list = document.getElementById('timeline');
  list.innerHTML = events.map(item => {
    const klass = classifyEvent(item.payload);
    return '<article class="event-card ' + klass + '">' +
      '<div class="event-head"><div class="event-title">' + escapeHtml(eventTitle(item.payload)) + '</div><div class="event-time">' + item.ts.toLocaleTimeString() + '</div></div>' +
      '<div class="event-meta">' + escapeHtml(eventMeta(item.payload) || klass) + '</div>' +
      '<details><summary>payload</summary><pre>' + escapeHtml(JSON.stringify(item.payload, null, 2)) + '</pre></details>' +
      '</article>';
  }).join('');
}
`;
