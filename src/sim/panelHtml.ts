import { PANEL_CLIENT_SCRIPT } from './panelClient';
import { PANEL_STYLES } from './panelStyles';

export function renderPanelHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mower 开发模拟器</title>
  <style>${PANEL_STYLES}</style>
</head>
<body>
  <header>
    <div>
      <h1>Mower 开发模拟器</h1>
      <p>场景、数据集、故障注入、状态机与 WebSocket 事件流。</p>
    </div>
    <div class="metric" style="min-width:120px;min-height:52px">
      <div class="k">scenario</div>
      <div class="v" id="scenario-state-pill">idle</div>
    </div>
  </header>

  <main>
    <section>
      <div class="group">
        <label for="scenario">场景</label>
        <div class="row">
          <select id="scenario" onchange="onScenarioChange()"></select>
          <button type="button" class="subtle" onclick="toggleGuide()">说明</button>
        </div>
        <div id="guide-panel" class="guide-panel" aria-live="polite"></div>
        <div class="grid2" style="margin-top:8px">
          <button type="button" id="btn-run" class="primary" onclick="runScenario()">运行场景</button>
          <button type="button" id="btn-stop" class="danger" onclick="stopScenario()" disabled>停止场景</button>
        </div>
        <p id="status-line" class="status-line"></p>
      </div>

      <div class="group">
        <div class="label">运行控制</div>
        <div class="grid2">
          <button type="button" class="secondary" onclick="pauseActive()">暂停</button>
          <button type="button" class="secondary" onclick="resumeActive()">恢复</button>
        </div>
      </div>

      <div class="group">
        <label for="dataset">数据集</label>
        <div class="row">
          <select id="dataset">
            <option value="mapping_happy">mapping_happy</option>
            <option value="mapping_multilawn">mapping_multilawn</option>
            <option value="mowing_trajectory">mowing_trajectory</option>
            <option value="recharge_return">recharge_return</option>
            <option value="fixed_maps">fixed_maps</option>
          </select>
          <button type="button" class="subtle" onclick="switchDataset()">切换</button>
        </div>
      </div>

      <div class="group">
        <label for="fault">故障</label>
        <div class="row">
          <select id="fault"></select>
          <button type="button" class="subtle" onclick="applyFault()">应用</button>
        </div>
      </div>

      <div class="group">
        <div class="label">真实延时</div>
        <div class="grid2">
          <button type="button" class="subtle" onclick="setRealism(true)">开启</button>
          <button type="button" class="subtle" onclick="setRealism(false)">关闭</button>
        </div>
        <p id="realism-summary" class="hint"></p>
      </div>

      <div class="group">
        <div class="label">录制与复位</div>
        <div class="grid2">
          <button type="button" class="subtle" onclick="startRecording()">开始录制</button>
          <button type="button" class="subtle" onclick="stopRecording()">停止录制</button>
        </div>
        <button type="button" class="danger full" style="margin-top:8px" onclick="resetSim()">重置模拟器</button>
      </div>
    </section>

    <section>
      <h2>关键指标</h2>
      <div id="metrics" class="metrics"></div>
      <h2>FSM 泳道</h2>
      <div id="fsm-graph"></div>
      <h2 style="margin-top:12px">运行摘要</h2>
      <pre id="runtime-summary"></pre>
      <h2 style="margin-top:12px">状态快照</h2>
      <pre id="state" class="raw-state">加载中...</pre>
    </section>

    <section class="events">
      <h2>事件流</h2>
      <div id="timeline" class="event-list"></div>
    </section>
  </main>

  <script>${PANEL_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
