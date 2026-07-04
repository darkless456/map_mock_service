export const PANEL_STYLES = `
:root {
  color-scheme: light;
  font-family: Inter, "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
  --bg: #f5f7fb;
  --panel: #ffffff;
  --line: #d8dee9;
  --text: #18212f;
  --muted: #667085;
  --green: #168a4a;
  --blue: #2563eb;
  --amber: #b7791f;
  --red: #c2413a;
  --violet: #6d5bd0;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); }
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--line);
  background: #ffffff;
}
h1 { margin: 0; font-size: 18px; font-weight: 760; letter-spacing: 0; }
header p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
main {
  display: grid;
  grid-template-columns: 340px minmax(420px, 1fr) minmax(360px, 520px);
  gap: 12px;
  padding: 12px;
  align-items: start;
}
section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
}
h2 { margin: 0 0 10px; font-size: 14px; }
h3 { margin: 0 0 8px; font-size: 13px; }
label, .label {
  display: block;
  margin: 0 0 6px;
  color: #344054;
  font-size: 12px;
  font-weight: 700;
}
button, select {
  min-height: 36px;
  border-radius: 6px;
  border: 1px solid #b8c2d3;
  background: #ffffff;
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
}
button { cursor: pointer; font-weight: 700; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: var(--green); border-color: var(--green); color: #fff; }
button.secondary { background: var(--blue); border-color: var(--blue); color: #fff; }
button.danger { background: var(--red); border-color: var(--red); color: #fff; }
button.subtle { background: #eef2f7; border-color: #cbd5e1; }
.group { padding-top: 12px; margin-top: 12px; border-top: 1px solid #edf0f5; }
.group:first-child { padding-top: 0; margin-top: 0; border-top: 0; }
.row { display: flex; gap: 8px; align-items: stretch; }
.row > select, .row > input { flex: 1; min-width: 0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.full { width: 100%; }
.hint { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
.status-line { min-height: 18px; margin: 8px 0 0; color: var(--muted); font-size: 12px; }
.status-line.run { color: var(--amber); }
.status-line.ok { color: var(--green); }
.status-line.err { color: var(--red); }
.metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(110px, 1fr));
  gap: 8px;
  margin-bottom: 12px;
}
.metric {
  min-height: 70px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcff;
}
.metric .k { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
.metric .v { margin-top: 8px; overflow-wrap: anywhere; font-size: 17px; font-weight: 760; }
.metric.mapping .v { color: var(--violet); }
.metric.mowing .v { color: var(--green); }
.metric.estop .v, .metric.error .v { color: var(--red); }
.metric.idle .v { color: #475467; }
.lane {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  border-top: 1px solid #edf0f5;
}
.lane:first-child { border-top: 0; }
.lane-title { font-size: 12px; font-weight: 800; color: #344054; }
.nodes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.node {
  min-width: 70px;
  min-height: 42px;
  flex: 1 1 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 6px;
  background: #f8fafc;
  text-align: center;
  font-size: 11px;
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.edge {
  flex: 0 0 auto;
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
}
.edge.active-edge {
  color: var(--blue);
  animation: edge-pulse 1.1s ease-in-out infinite;
}
@keyframes edge-pulse {
  0%, 100% { opacity: 0.45; transform: translateX(0); }
  50%      { opacity: 1;    transform: translateX(2px); }
}
.node.active { border-color: var(--blue); background: #dbeafe; color: #1746a2; font-weight: 800; }
.node.done { border-color: #9cd3b3; background: #ecfdf3; color: #166534; }
.node.error { border-color: #f0a6a0; background: #fff1f0; color: #b42318; }
.guide-panel {
  display: none;
  max-height: 360px;
  overflow: auto;
  margin-top: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcff;
  line-height: 1.55;
  font-size: 12px;
}
.guide-panel.open { display: block; }
.guide-panel .muted { color: var(--muted); }
.guide-panel h3 { color: var(--blue); }
.guide-panel h4 { margin: 12px 0 4px; color: #344054; font-size: 12px; }
.guide-panel ol, .guide-panel ul { margin: 4px 0 0; padding-left: 18px; }
.event-list {
  display: grid;
  gap: 8px;
  max-height: calc(100vh - 142px);
  overflow: auto;
}
.event-card {
  border: 1px solid var(--line);
  border-left-width: 4px;
  border-radius: 8px;
  background: #ffffff;
  padding: 9px;
}
.event-card.cmd { border-left-color: var(--blue); }
.event-card.notify { border-left-color: var(--green); }
.event-card.fsm { border-left-color: var(--violet); }
.event-card.error { border-left-color: var(--red); }
.event-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.event-title { font-size: 12px; font-weight: 800; overflow-wrap: anywhere; }
.event-time { color: var(--muted); font-size: 11px; white-space: nowrap; }
.event-meta { margin-top: 6px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
details { margin-top: 6px; }
summary { cursor: pointer; color: var(--blue); font-size: 12px; font-weight: 700; }
pre {
  margin: 8px 0 0;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #f8fafc;
  padding: 8px;
  font-size: 11px;
}
.raw-state { max-height: 420px; }
@media (max-width: 1180px) {
  main { grid-template-columns: 320px 1fr; }
  .events { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  main { grid-template-columns: 1fr; }
  header { align-items: flex-start; flex-direction: column; }
  .metrics { grid-template-columns: 1fr 1fr; }
  .node { flex: 1 1 100%; }
}
`;
