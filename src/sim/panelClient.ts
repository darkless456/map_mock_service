export const PANEL_CLIENT_SCRIPT = `
let guideOpen = false;
let catalog = [];
let currentState = {};
let scenarioRunning = false;
let events = [];

const mappingNodes = [
  ['IDLE', 'IDLE'],
  ['PREPARING', 'PREPARING'],
  ['UNDOCKING', 'UNDOCKING'],
  ['MAP_SCAN_BOUNDARY', 'SCAN'],
  ['MAP_FOLLOW_BOUNDARY', 'EDGE'],
  ['MAP_COVERAGE_RUN', 'COVERAGE'],
  ['COMPLETED', 'DONE']
];
const mowingNodes = [
  ['IDLE', 'IDLE'],
  ['PREPARING', 'PREPARING'],
  ['UNDOCKING', 'UNDOCKING'],
  ['MOW_RUNNING', 'MOWING'],
  ['RETURNING_DOCK', 'RETURN'],
  ['COMPLETED', 'DONE']
];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function json(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

function postJson(url, body) {
  return json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
}

function setStatus(text, kind) {
  const el = document.getElementById('status-line');
  el.textContent = text || '';
  el.className = 'status-line' + (kind ? ' ' + kind : '');
}

function activeDomain() {
  return currentState.activeDomain || 'mapping';
}

function selectedScenario() {
  return document.getElementById('scenario').value;
}

function optionLabel(entry) {
  const tag = entry.domainLabel ? '[' + entry.domainLabel + '] ' : '';
  const title = entry.title && entry.title !== entry.name ? entry.title + ' - ' : '';
  return tag + title + entry.name;
}

function renderList(title, items) {
  if (!items || !items.length) return '';
  const ordered = title.indexOf('步骤') >= 0 || title.indexOf('自动') >= 0;
  const tag = ordered ? 'ol' : 'ul';
  const lis = items.map(item => '<li>' + escapeHtml(item) + '</li>').join('');
  return '<section><h4>' + escapeHtml(title) + '</h4><' + tag + '>' + lis + '</' + tag + '></section>';
}

function renderGuide(doc) {
  if (!doc) return '<p class="muted">该场景暂无 guide 说明，请查看 scenarios/*.yaml 内 description。</p>';
  const pushes = doc.pushes && doc.pushes.length
    ? '<section><h4>涉及推送</h4><p>' + escapeHtml(doc.pushes.join(' / ')) + '</p></section>'
    : '';
  return [
    '<h3>' + escapeHtml(doc.title) + '</h3>',
    '<p class="muted">' + escapeHtml(doc.domainLabel || '') + (doc.duration ? ' / ' + escapeHtml(doc.duration) : '') + '</p>',
    '<p>' + escapeHtml(doc.summary || '') + '</p>',
    doc.whenToUse ? '<section><h4>何时使用</h4><p>' + escapeHtml(doc.whenToUse) + '</p></section>' : '',
    renderList('模拟内容', doc.simulates),
    renderList('前置条件', doc.prerequisites),
    renderList('操作步骤', doc.userSteps),
    renderList('场景自动执行', doc.autoBehavior),
    pushes
  ].join('');
}

function metric(label, value, klass) {
  return '<div class="metric ' + escapeHtml(klass || '') + '"><div class="k">' + escapeHtml(label) + '</div><div class="v">' + escapeHtml(value || '-') + '</div></div>';
}

function renderMetrics(data) {
  const ctx = data.activeDomain === 'mowing' ? data.mowing : data.mapping;
  const statusClass = data.workStatus === 'estop' || data.workStatus === 'error' ? 'error' : data.activeDomain || data.workStatus;
  const dataset = data.dataset ? data.dataset.name + ' (' + data.dataset.patchCount + ')' : '-';
  document.getElementById('metrics').innerHTML = [
    metric('work status', data.workStatus, statusClass),
    metric('phase', data.phase || data.state, statusClass),
    metric('sub status', data.lastNotifySubStatus || 'none', ''),
    metric('battery', ctx && ctx.battery != null ? ctx.battery + '%' : '-', ''),
    metric('dataset', dataset, ''),
    metric('realism', data.realism && data.realism.enabled ? 'on' : 'off', '')
  ].join('');
}

function nodeClass(data, nodeKey, domain) {
  const ctx = domain === 'mowing' ? data.mowing : data.mapping;
  if (!ctx) return '';
  if (ctx.state === 'ERRORED' || ctx.state === 'ESTOPPED') return nodeKey === ctx.state ? 'active error' : '';
  if (ctx.phase === nodeKey || ctx.state === nodeKey) return 'active';
  return '';
}

function renderLane(title, nodes, data, domain) {
  return '<div class="lane"><div class="lane-title">' + title + '</div><div class="nodes">' +
    nodes.map(item => '<div class="node ' + nodeClass(data, item[0], domain) + '">' + escapeHtml(item[1]) + '</div>').join('') +
    '</div></div>';
}

function renderGraph(data) {
  document.getElementById('fsm-graph').innerHTML = [
    renderLane('Mapping', mappingNodes, data, 'mapping'),
    renderLane('Mowing', mowingNodes, data, 'mowing')
  ].join('');
}

function renderRawState(data) {
  document.getElementById('state').textContent = JSON.stringify(data, null, 2);
}

function renderScenarioState(data) {
  const scenario = data.scenario || {};
  const recorder = data.recorder || {};
  const chaos = data.chaos || {};
  const realism = data.realism || {};
  const lines = [
    'scenario: ' + (scenario.running || 'idle') + (scenario.paused ? ' / paused' : ''),
    'recorder: ' + (recorder.active ? 'recording ' + recorder.file : 'idle'),
    'chaos: latency=' + chaos.latencyMs + ' drop=' + chaos.dropRate + ' reorder=' + chaos.reorderWindowMs,
    'realism: ' + (realism.enabled ? 'on' : 'off') + ' http=' + realism.httpDelayMinMs + '-' + realism.httpDelayMaxMs + 'ms ws=' + realism.wsDelayMinMs + '-' + realism.wsDelayMaxMs + 'ms'
  ];
  document.getElementById('runtime-summary').textContent = lines.join('\\n');
  document.getElementById('realism-summary').textContent = realism.enabled
    ? '开启：HTTP ' + realism.httpDelayMinMs + '-' + realism.httpDelayMaxMs + 'ms / WS ' + realism.wsDelayMinMs + '-' + realism.wsDelayMaxMs + 'ms'
    : '关闭：请求和推送即时发送';
}

async function refresh() {
  const payload = await json('/sim/state');
  const data = payload.data;
  currentState = data;
  scenarioRunning = !!(data.scenario && data.scenario.running);
  const scenarioPaused = !!(data.scenario && data.scenario.paused);
  document.getElementById('btn-run').disabled = scenarioRunning;
  document.getElementById('btn-stop').disabled = !scenarioRunning;
  renderMetrics(data);
  renderGraph(data);
  renderRawState(data);
  renderScenarioState(data);
  document.getElementById('scenario-state-pill').textContent = scenarioRunning ? (scenarioPaused ? 'paused' : 'running') : 'idle';
}

async function loadScenarios() {
  const payload = await json('/sim/scenarios');
  catalog = payload.data.catalog || [];
  const names = payload.data.scenarios || [];
  const select = document.getElementById('scenario');
  select.innerHTML = names.map(name => {
    const entry = catalog.find(c => c.name === name);
    const label = entry ? optionLabel(entry) : name;
    return '<option value="' + escapeHtml(name) + '">' + escapeHtml(label) + '</option>';
  }).join('');
  await loadScenarioGuideContent();
}

async function loadScenarioGuideContent() {
  const name = selectedScenario();
  const panel = document.getElementById('guide-panel');
  panel.innerHTML = '<p class="muted">加载说明中...</p>';
  try {
    const payload = await json('/sim/scenario/guide?name=' + encodeURIComponent(name));
    panel.innerHTML = renderGuide(payload.data);
  } catch (e) {
    panel.innerHTML = '<p class="muted">无法加载说明：' + escapeHtml(String(e)) + '</p>';
  }
  panel.classList.toggle('open', guideOpen);
}

function onScenarioChange() { loadScenarioGuideContent(); }
function toggleGuide() {
  guideOpen = !guideOpen;
  document.getElementById('guide-panel').classList.toggle('open', guideOpen);
}

async function runScenario() {
  const name = selectedScenario();
  scenarioRunning = true;
  document.getElementById('btn-run').disabled = true;
  document.getElementById('btn-stop').disabled = false;
  setStatus('场景运行中：' + name, 'run');
  try {
    const r = await postJson('/sim/scenario/run', { name });
    const d = r.data || {};
    if (d.stopped) setStatus('场景已停止：' + name, 'ok');
    else if (d.ok) setStatus('场景完成：' + name, 'ok');
    else setStatus('场景失败：' + (d.error || 'unknown'), 'err');
  } catch (e) {
    setStatus('运行出错：' + String(e), 'err');
  } finally {
    await refresh();
  }
}

async function stopScenario() {
  await postJson('/sim/scenario/stop', {});
  setStatus('正在停止...', 'run');
  await refresh();
}

async function pauseActive() {
  const domain = activeDomain();
  if (scenarioRunning) await postJson('/sim/scenario/pause', {});
  await postJson('/sim/event', { domain, type: 'CMD_PAUSE' });
  setStatus('已暂停：' + domain, 'ok');
  await refresh();
}

async function resumeActive() {
  const domain = activeDomain();
  if (scenarioRunning) await postJson('/sim/scenario/resume', {});
  await postJson('/sim/event', { domain, type: 'CMD_RESUME' });
  if (domain === 'mowing') {
    await postJson('/sim/event', { domain, type: 'DEVICE_WORK_STATUS', status: 'mowing', source: 'ws' });
  } else {
    const phase = currentState.phase || 'MAP_COVERAGE_RUN';
    await postJson('/sim/event', { domain, type: 'DEVICE_PHASE', phase, source: 'ws' });
  }
  setStatus('已恢复：' + domain, 'ok');
  await refresh();
}

async function resetSim() {
  await postJson('/sim/reset', {});
  setStatus('已重置模拟器', 'ok');
  await refresh();
}

async function switchDataset() {
  const name = document.getElementById('dataset').value.trim();
  if (!name) return;
  await postJson('/sim/dataset', { name });
  setStatus('已切换数据集：' + name, 'ok');
  await refresh();
}

async function applyFault() {
  const name = document.getElementById('fault').value.trim();
  if (!name) return;
  const result = await postJson('/sim/fault', { name });
  setStatus(result.code === 200 ? '已应用故障：' + name : '故障失败：' + result.message, result.code === 200 ? 'ok' : 'err');
  await refresh();
}

async function setRealism(enabled) {
  await postJson('/sim/realism', { enabled: !!enabled });
  setStatus(enabled ? '真实延时已开启' : '真实延时已关闭', 'ok');
  await refresh();
}

async function loadFaults() {
  const payload = await json('/sim/faults');
  const select = document.getElementById('fault');
  const faults = payload.data || [];
  select.innerHTML = faults.map(fault => '<option value="' + escapeHtml(fault.name) + '">' + escapeHtml(fault.name) + '</option>').join('');
}

async function startRecording() {
  await postJson('/sim/recorder/start', { label: 'panel' });
  setStatus('已开始录制', 'ok');
  await refresh();
}

async function stopRecording() {
  await postJson('/sim/recorder/stop', {});
  setStatus('已停止录制', 'ok');
  await refresh();
}

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

loadScenarios().then(loadFaults).then(refresh);
setInterval(refresh, 1500);

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const inspect = new WebSocket(proto + '//' + location.host + '/sim/inspect');
inspect.onmessage = event => {
  try { pushEvent(JSON.parse(event.data)); }
  catch { pushEvent({ raw: event.data }); }
};
`;
