export function renderPanelHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mower Dev Simulator</title>
  <script src="https://unpkg.com/htmx.org@1.9.12"></script>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0f172a; color: #e2e8f0; }
    header { padding: 24px 32px; background: linear-gradient(135deg, #14532d, #0f172a 70%); border-bottom: 1px solid #334155; }
    h1 { margin: 0; font-size: 28px; }
    main { display: grid; grid-template-columns: 380px 1fr; gap: 20px; padding: 24px 32px; }
    section { background: #111827; border: 1px solid #334155; border-radius: 16px; padding: 18px; box-shadow: 0 20px 50px rgb(0 0 0 / 25%); }
    label { display: block; margin: 12px 0 6px; color: #93c5fd; font-weight: 600; }
    button, select, input, textarea { width: 100%; box-sizing: border-box; border-radius: 10px; border: 1px solid #475569; background: #020617; color: #e2e8f0; padding: 10px 12px; }
    button { cursor: pointer; background: #16a34a; border-color: #22c55e; font-weight: 700; margin-top: 10px; }
    button.secondary { background: #1d4ed8; border-color: #3b82f6; }
    button.danger { background: #b91c1c; border-color: #ef4444; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #334155; border-radius: 12px; padding: 14px; max-height: 560px; overflow: auto; }
    .pill { display: inline-flex; gap: 6px; align-items: center; border-radius: 999px; padding: 4px 10px; background: #1e293b; color: #bfdbfe; margin-right: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>Mower Dev Simulator</h1>
    <p>Scenario runner, recorder/replay, chaos controls, and live FSM state.</p>
  </header>
  <main>
    <section>
      <h2>Controls</h2>
      <label for="scenario">Scenario</label>
      <select id="scenario"></select>
      <button onclick="runScenario()">Run scenario</button>
      <button class="danger" onclick="stopScenario()">Stop scenario</button>
      <div class="grid">
        <button class="secondary" onclick="emitEvent({domain:'mapping',type:'CMD_PAUSE'})">Pause</button>
        <button class="secondary" onclick="emitEvent({domain:'mapping',type:'CMD_RESUME'})">Resume</button>
        <button class="secondary" onclick="emitEvent({domain:'mapping',type:'DEVICE_ESTOP',active:true})">E-stop on</button>
        <button class="secondary" onclick="emitEvent({domain:'mapping',type:'DEVICE_ESTOP',active:false})">E-stop clear</button>
      </div>
      <button class="danger" onclick="post('/sim/reset', {})">Reset</button>
      <label>Chaos</label>
      <div class="grid">
        <input id="latency" type="number" placeholder="latency ms" value="0" />
        <input id="drop" type="number" step="0.05" min="0" max="1" placeholder="drop rate" value="0" />
      </div>
      <button onclick="setChaos()">Apply chaos</button>
      <label>Recorder</label>
      <div class="grid">
        <button onclick="post('/sim/recorder/start', { label: 'panel' })">Start</button>
        <button onclick="post('/sim/recorder/stop', {})">Stop</button>
      </div>
      <label>Raw event JSON</label>
      <textarea id="raw" rows="8">{"domain":"mapping","type":"DEVICE_PHASE","phase":"MAP_SCAN_BOUNDARY"}</textarea>
      <button onclick="emitRaw()">Emit raw event</button>
    </section>
    <section>
      <h2>State</h2>
      <div id="summary"></div>
      <pre id="state">Loading…</pre>
      <h2>Timeline</h2>
      <pre id="timeline"></pre>
    </section>
  </main>
<script>
async function json(url, opts) { const r = await fetch(url, opts); return r.json(); }
async function post(url, body) { const data = await json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); await refresh(); return data; }
async function refresh() {
  const payload = await json('/sim/state');
  const data = payload.data;
  document.getElementById('summary').innerHTML = ['state','phase','workStatus','activeDomain'].map(k => '<span class="pill">'+k+': '+(data[k] ?? '')+'</span>').join('');
  document.getElementById('state').textContent = JSON.stringify(data, null, 2);
  document.getElementById('timeline').textContent = JSON.stringify(data.events || [], null, 2);
}
async function loadScenarios() {
  const payload = await json('/sim/scenarios');
  const select = document.getElementById('scenario');
  select.innerHTML = payload.data.scenarios.map(s => '<option value="'+s+'">'+s+'</option>').join('');
}
async function runScenario() { const name = document.getElementById('scenario').value; const result = await post('/sim/scenario/run', { name }); alert(result.data.ok ? 'Scenario passed' : 'Scenario failed: ' + result.data.error); }
async function stopScenario() { await post('/sim/scenario/stop', {}); }
async function emitEvent(event) { await post('/sim/event', event); }
async function emitRaw() { await emitEvent(JSON.parse(document.getElementById('raw').value)); }
async function setChaos() { await post('/sim/chaos', { latencyMs: Number(document.getElementById('latency').value), dropRate: Number(document.getElementById('drop').value) }); }
loadScenarios(); refresh(); setInterval(refresh, 1500);
const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const inspect = new WebSocket(proto + '//' + location.host + '/sim/inspect');
inspect.onmessage = event => { const line = JSON.stringify(JSON.parse(event.data), null, 2); document.getElementById('timeline').textContent = line + '\\n\\n' + document.getElementById('timeline').textContent; };
</script>
</body>
</html>`;
}
