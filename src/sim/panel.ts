/**
 * /sim/panel — 模拟器控制台 HTML（htmx + 场景说明侧栏）。
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
    main { display: grid; grid-template-columns: minmax(360px, 420px) 1fr; gap: 16px; padding: 20px 28px; align-items: start; }
    section { background: #111827; border: 1px solid #334155; border-radius: 14px; padding: 16px; box-shadow: 0 16px 40px rgb(0 0 0 / 22%); }
    h2 { margin: 0 0 12px; font-size: 17px; color: #f1f5f9; }
    h3 { margin: 0 0 8px; font-size: 15px; color: #86efac; }
    label { display: block; margin: 10px 0 6px; color: #93c5fd; font-weight: 600; font-size: 13px; }
    button, select, input, textarea {
      width: 100%; box-sizing: border-box; border-radius: 10px; border: 1px solid #475569;
      background: #020617; color: #e2e8f0; padding: 9px 11px; font-size: 14px;
    }
    button { cursor: pointer; background: #16a34a; border-color: #22c55e; font-weight: 700; margin-top: 8px; }
    button.secondary { background: #1d4ed8; border-color: #3b82f6; }
    button.danger { background: #b91c1c; border-color: #ef4444; }
    button.ghost { background: #1e293b; border-color: #64748b; font-weight: 600; }
    .row { display: flex; gap: 8px; align-items: stretch; }
    .row select { flex: 1; }
    .row button { width: auto; min-width: 108px; margin-top: 0; white-space: nowrap; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #334155; border-radius: 10px; padding: 12px; max-height: 480px; overflow: auto; font-size: 12px; }
    .pill { display: inline-flex; gap: 6px; align-items: center; border-radius: 999px; padding: 3px 9px; background: #1e293b; color: #bfdbfe; margin: 0 6px 6px 0; font-size: 12px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; background: #14532d; color: #bbf7d0; font-size: 12px; margin-right: 8px; }
    .guide-panel {
      margin-top: 12px; border: 1px solid #475569; border-radius: 12px; padding: 14px;
      background: #0b1220; max-height: 520px; overflow: auto; display: none; line-height: 1.55; font-size: 13px;
    }
    .guide-panel.open { display: block; }
    .guide-panel .muted { color: #94a3b8; margin: 0 0 10px; }
    .guide-panel section.block { margin: 12px 0 0; }
    .guide-panel h4 { margin: 0 0 6px; font-size: 13px; color: #7dd3fc; }
    .guide-panel ol, .guide-panel ul { margin: 4px 0 0; padding-left: 20px; }
    .guide-panel li { margin: 4px 0; }
    .guide-empty { color: #64748b; font-size: 13px; padding: 8px 0; }
    .hint { font-size: 12px; color: #64748b; margin-top: 4px; }
  </style>
</head>
<body>
  <header>
    <h1>Mower 开发模拟器</h1>
    <p>场景脚本、录制回放、混沌网络与 FSM 状态；每个场景可查看中文说明与操作步骤。</p>
  </header>
  <main>
    <section>
      <h2>控制</h2>
      <label for="scenario">场景脚本</label>
      <div class="row">
        <select id="scenario" onchange="onScenarioChange()"></select>
        <button type="button" class="ghost" onclick="toggleGuide()" title="展开/收起当前场景说明">阅读说明</button>
      </div>
      <p class="hint">切换场景后可点击「阅读说明」查看用途、模拟内容与逐步操作。</p>
      <div id="guide-panel" class="guide-panel" aria-live="polite"></div>
      <button type="button" onclick="runScenario()">运行场景</button>
      <button type="button" class="danger" onclick="stopScenario()">停止场景</button>
      <div class="grid">
        <button type="button" class="secondary" onclick="emitEvent({domain:'mapping',type:'CMD_PAUSE'})">暂停</button>
        <button type="button" class="secondary" onclick="emitEvent({domain:'mapping',type:'CMD_RESUME'})">继续</button>
        <button type="button" class="secondary" onclick="emitEvent({domain:'mapping',type:'DEVICE_ESTOP',active:true})">急停开</button>
        <button type="button" class="secondary" onclick="emitEvent({domain:'mapping',type:'DEVICE_ESTOP',active:false})">急停清</button>
      </div>
      <button type="button" class="danger" onclick="post('/sim/reset', {})">重置模拟器</button>
      <label>混沌网络</label>
      <div class="grid">
        <input id="latency" type="number" placeholder="延迟 ms" value="0" />
        <input id="drop" type="number" step="0.05" min="0" max="1" placeholder="丢包率 0-1" value="0" />
      </div>
      <button type="button" onclick="setChaos()">应用混沌</button>
      <label>录制</label>
      <div class="grid">
        <button type="button" onclick="post('/sim/recorder/start', { label: 'panel' })">开始录制</button>
        <button type="button" onclick="post('/sim/recorder/stop', {})">停止录制</button>
      </div>
      <label>原始事件 JSON</label>
      <textarea id="raw" rows="6">{"domain":"mapping","type":"DEVICE_PHASE","phase":"MAP_SCAN_BOUNDARY"}</textarea>
      <button type="button" onclick="emitRaw()">发送事件</button>
    </section>
    <section>
      <h2>状态</h2>
      <div id="summary"></div>
      <pre id="state">加载中…</pre>
      <h2>时间线</h2>
      <pre id="timeline"></pre>
    </section>
  </main>
<script>
let guideOpen = false;
let catalog = [];

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
    return '<p class="guide-empty">该场景暂无 guide 说明，请查看 scenarios/*.yaml 内 description 或 docs/scenarios.md。</p>';
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

async function post(url, body) {
  const data = await json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await refresh();
  return data;
}

async function refresh() {
  const payload = await json('/sim/state');
  const data = payload.data;
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

function onScenarioChange() {
  loadScenarioGuideContent();
}

function toggleGuide() {
  guideOpen = !guideOpen;
  const panel = document.getElementById('guide-panel');
  if (guideOpen && panel.innerHTML.indexOf('加载说明') < 0 && !panel.querySelector('h3')) {
    loadScenarioGuideContent();
  } else {
    panel.classList.toggle('open', guideOpen);
  }
}

async function runScenario() {
  const name = selectedScenario();
  const result = await post('/sim/scenario/run', { name });
  alert(result.data.ok ? '场景通过' : '场景失败: ' + (result.data.error || 'unknown'));
}

async function stopScenario() { await post('/sim/scenario/stop', {}); }
async function emitEvent(event) { await post('/sim/event', event); }
async function emitRaw() { await emitEvent(JSON.parse(document.getElementById('raw').value)); }
async function setChaos() {
  await post('/sim/chaos', {
    latencyMs: Number(document.getElementById('latency').value),
    dropRate: Number(document.getElementById('drop').value),
  });
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
