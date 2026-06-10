/**
 * /sim/panel — 模拟器控制台 HTML。
 * 聚焦四个核心场景：建图/割草正常流程 + 建图增量帧/割草轨迹无限循环。
 * 暂停/恢复按当前活跃域（mapping/mowing）下发，恢复时自动回到 WORKING。
 */
export function renderPanelHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mower 开发模拟器</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 20px 28px; background: linear-gradient(135deg, #14532d, #0f172a 70%); border-bottom: 1px solid #334155; }
    h1 { margin: 0; font-size: 24px; }
    header p { margin: 8px 0 0; color: #94a3b8; font-size: 14px; }
    main { display: grid; grid-template-columns: minmax(380px, 460px) 1fr; gap: 16px; padding: 20px 28px; align-items: start; }
    section { background: #111827; border: 1px solid #334155; border-radius: 14px; padding: 16px; box-shadow: 0 16px 40px rgb(0 0 0 / 22%); }
    h2 { margin: 0 0 12px; font-size: 17px; color: #f1f5f9; }
    h3 { margin: 0 0 8px; font-size: 15px; color: #86efac; }
    .group { margin-top: 18px; padding-top: 14px; border-top: 1px solid #1e293b; }
    .group:first-of-type { margin-top: 0; padding-top: 0; border-top: 0; }
    .group > .label { color: #93c5fd; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px; }
    button, select { box-sizing: border-box; border-radius: 10px; border: 1px solid #475569; background: #020617; color: #e2e8f0; padding: 10px 12px; font-size: 14px; }
    button { cursor: pointer; background: #16a34a; border-color: #22c55e; font-weight: 700; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    button.secondary { background: #1d4ed8; border-color: #3b82f6; }
    button.danger { background: #b91c1c; border-color: #ef4444; }
    button.ghost { background: #1e293b; border-color: #64748b; font-weight: 600; }
    .row { display: flex; gap: 8px; align-items: stretch; }
    .row select { flex: 1; }
    .row button { width: auto; white-space: nowrap; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .full { width: 100%; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #334155; border-radius: 10px; padding: 12px; max-height: 480px; overflow: auto; font-size: 12px; }
    .pill { display: inline-flex; gap: 6px; align-items: center; border-radius: 999px; padding: 3px 9px; background: #1e293b; color: #bfdbfe; margin: 0 6px 6px 0; font-size: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; background: #14532d; color: #bbf7d0; font-size: 12px; margin-right: 8px; }
    .status-line { margin: 10px 0 0; font-size: 13px; min-height: 18px; }
    .status-line.run { color: #fbbf24; }
    .status-line.ok { color: #86efac; }
    .status-line.err { color: #fca5a5; }
    .guide-panel { margin-top: 12px; border: 1px solid #475569; border-radius: 12px; padding: 14px; background: #0b1220; max-height: 480px; overflow: auto; display: none; line-height: 1.55; font-size: 13px; }
    .guide-panel.open { display: block; }
    .guide-panel .muted { color: #94a3b8; margin: 0 0 10px; }
    .guide-panel section.block { margin: 12px 0 0; }
    .guide-panel h4 { margin: 0 0 6px; font-size: 13px; color: #7dd3fc; }
    .guide-panel ol, .guide-panel ul { margin: 4px 0 0; padding-left: 20px; }
    .guide-panel li { margin: 4px 0; }
    .guide-empty { color: #64748b; font-size: 13px; padding: 8px 0; }
    .hint { font-size: 12px; color: #64748b; margin: 6px 0 0; }
  </style>
</head>
<body>
  <header>
    <h1>Mower 开发模拟器</h1>
    <p>四个核心场景：建图 / 割草正常流程，建图增量帧 / 割草轨迹无限循环。运行后可暂停 / 恢复 / 停止。</p>
  </header>
  <main>
    <section>
      <div class="group">
        <div class="label">场景</div>
        <div class="row">
          <select id="scenario" onchange="onScenarioChange()"></select>
          <button type="button" class="ghost" onclick="toggleGuide()" title="展开/收起说明">说明</button>
        </div>
        <p class="hint">无限循环场景需手动「停止场景」结束。</p>
        <div id="guide-panel" class="guide-panel" aria-live="polite"></div>
        <div class="grid2" style="margin-top:10px">
          <button type="button" id="btn-run" onclick="runScenario()">运行场景</button>
          <button type="button" id="btn-stop" class="danger" onclick="stopScenario()" disabled>停止场景</button>
        </div>
        <p id="status-line" class="status-line"></p>
      </div>

      <div class="group">
        <div class="label">运行中操作</div>
        <div class="grid2">
          <button type="button" class="secondary" onclick="pauseActive()">暂停</button>
          <button type="button" class="secondary" onclick="resumeActive()">恢复</button>
        </div>
        <p class="hint">按当前活跃域（建图 / 割草）下发；恢复会自动回到 WORKING。</p>
      </div>

      <div class="group">
        <div class="label">工具</div>
        <div class="grid2">
          <button type="button" class="ghost" onclick="startRecording()">开始录制</button>
          <button type="button" class="ghost" onclick="stopRecording()">停止录制</button>
        </div>
        <button type="button" class="danger full" style="margin-top:8px" onclick="resetSim()">重置模拟器</button>
      </div>
    </section>
    <section>
      <h2>状态</h2>
      <div id="summary"></div>
      <pre id="state">加载中…</pre>
      <h2 style="margin-top:16px">时间线</h2>
      <pre id="timeline"></pre>
    </section>
  </main>
<script>
let guideOpen = false;
let catalog = [];
let currentState = {};
let scenarioRunning = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderList(title, items) {
  if (!items || !items.length) return '';
  const ordered = title.indexOf('步骤') >= 0 || title.indexOf('自动') >= 0;
  const tag = ordered ? 'ol' : 'ul';
  const lis = items.map(item => '<li>' + escapeHtml(item) + '</li>').join('');
  return '<section class="block"><h4>' + escapeHtml(title) + '</h4><' + tag + '>' + lis + '</' + tag + '></section>';
}

function renderGuide(doc) {
  if (!doc) {
    return '<p class="guide-empty">该场景暂无 guide 说明，请查看 scenarios/*.yaml 内 description。</p>';
  }
  const pushes = doc.pushes && doc.pushes.length
    ? '<section class="block"><h4>涉及推送</h4><p>' + escapeHtml(doc.pushes.join(' · ')) + '</p></section>'
    : '';
  return [
    '<h3>' + escapeHtml(doc.title) + '</h3>',
    '<span class="badge">' + escapeHtml(doc.domainLabel) + '</span>',
    doc.duration ? '<span class="pill">耗时 ' + escapeHtml(doc.duration) + '</span>' : '',
    '<p class="muted">' + escapeHtml(doc.summary) + '</p>',
    doc.whenToUse ? '<section class="block"><h4>何时使用</h4><p>' + escapeHtml(doc.whenToUse) + '</p></section>' : '',
    renderList('模拟内容', doc.simulates),
    renderList('前置条件', doc.prerequisites),
    renderList('操作步骤（建议）', doc.userSteps),
    renderList('场景自动执行', doc.autoBehavior),
    pushes,
  ].join('');
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

async function refresh() {
  const payload = await json('/sim/state');
  const data = payload.data;
  currentState = data;
  scenarioRunning = !!(data.scenario && data.scenario.running);
  document.getElementById('btn-run').disabled = scenarioRunning;
  document.getElementById('btn-stop').disabled = !scenarioRunning;
  document.getElementById('summary').innerHTML = ['state', 'phase', 'workStatus', 'activeDomain'].map(k =>
    '<span class="pill">' + k + ': ' + escapeHtml(data[k] ?? '') + '</span>'
  ).join('');
  document.getElementById('state').textContent = JSON.stringify(data, null, 2);
}

function selectedScenario() {
  return document.getElementById('scenario').value;
}

function optionLabel(entry) {
  const tag = entry.domainLabel ? '[' + entry.domainLabel + '] ' : '';
  const title = entry.title && entry.title !== entry.name ? entry.title + ' — ' : '';
  return tag + title + entry.name;
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
  panel.innerHTML = '<p class="guide-empty">加载说明中…</p>';
  try {
    const payload = await json('/sim/scenario/guide?name=' + encodeURIComponent(name));
    panel.innerHTML = renderGuide(payload.data);
  } catch (e) {
    panel.innerHTML = '<p class="guide-empty">无法加载说明：' + escapeHtml(String(e)) + '</p>';
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
  setStatus('场景运行中：' + name + '（无限循环场景请手动停止）', 'run');
  try {
    const r = await postJson('/sim/scenario/run', { name });
    const d = r.data || {};
    if (d.stopped) setStatus('场景已停止：' + name, 'ok');
    else if (d.ok) setStatus('场景完成 ✓ ' + name, 'ok');
    else setStatus('场景失败：' + (d.error || 'unknown'), 'err');
  } catch (e) {
    setStatus('运行出错：' + escapeHtml(String(e)), 'err');
  } finally {
    await refresh();
  }
}

async function stopScenario() {
  await postJson('/sim/scenario/stop', {});
  setStatus('正在停止…', 'run');
  await refresh();
}

async function pauseActive() {
  const domain = activeDomain();
  await postJson('/sim/event', { domain, type: 'CMD_PAUSE' });
  setStatus('已暂停（' + domain + '）', 'ok');
  await refresh();
}

async function resumeActive() {
  const domain = activeDomain();
  await postJson('/sim/event', { domain, type: 'CMD_RESUME' });
  if (domain === 'mowing') {
    await postJson('/sim/event', { domain, type: 'DEVICE_WORK_STATUS', status: 'mowing', source: 'ws' });
  } else {
    const phase = currentState.phase || 'MAP_COVERAGE_RUN';
    await postJson('/sim/event', { domain, type: 'DEVICE_PHASE', phase, source: 'ws' });
  }
  setStatus('已恢复（' + domain + '）', 'ok');
  await refresh();
}

async function resetSim() {
  await postJson('/sim/reset', {});
  setStatus('已重置模拟器', 'ok');
  await refresh();
}

async function startRecording() {
  await postJson('/sim/recorder/start', { label: 'panel' });
  setStatus('已开始录制', 'ok');
}

async function stopRecording() {
  await postJson('/sim/recorder/stop', {});
  setStatus('已停止录制', 'ok');
}

loadScenarios().then(refresh);
setInterval(refresh, 1500);

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const inspect = new WebSocket(proto + '//' + location.host + '/sim/inspect');
inspect.onmessage = event => {
  const line = JSON.stringify(JSON.parse(event.data), null, 2);
  document.getElementById('timeline').textContent = line + '\\n\\n' + document.getElementById('timeline').textContent;
};
</script>
</body>
</html>`;
}
