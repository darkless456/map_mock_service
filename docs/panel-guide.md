# Panel Guide

`/sim/panel` is the simulator workbench for scenario runs, dataset switching, fault injection, recorder control, FSM state, and live WS/FSM events.

## Layout

The three-column grid is responsive and capped so the center column never overflows into the time-flow column on high-DPI / wide displays:

- [`panelStyles.ts`](../src/sim/panelStyles.ts) sets `grid-template-columns: 340px minmax(420px, min(900px, 1fr)) minmax(360px, 480px)` with a `max-width: 1780px` container.
- A `@media (min-width: 1800px)` breakpoint widens the side columns and narrows the center band, keeping the metrics card grid and the time-flow column balanced on retina / 4K monitors.

| Area | Purpose |
|---|---|
| Left column | Run/pause/stop scenarios, switch datasets, apply fault presets, start/stop recordings, reset simulator state. |
| Center column | Key metrics, mapping/mowing FSM lanes, runtime summary, raw `/sim/state` snapshot. |
| Right column | Structured event cards from `/sim/inspect`; each card surfaces a one-line source/status summary, expand `payload` for full JSON. |

## Reading State

- `work status`, `phase`, `sub status`, `battery`, and `dataset` are pulled from `/sim/state` every 1.5 seconds.
- The **sub status** metric card now reads `lastNotifySubStatus` from the snapshot — the last `NOTIFY_RATEL_STATUS` projection surfaced by [`virtualRobotCore.ts`](../src/sim/virtualRobotCore.ts) `snapshot()`. Previously the field was never exposed via `/sim/state`, so the card always showed "none"; it now updates live alongside `work status`.
- The FSM lanes are compiled server-side from the read-only fsm-mirror phase enums ([`panelGraph.ts`](../src/sim/panelGraph.ts) `phaseGraphFromFsm()`), so the swim-lane stays in sync with the FSM source of truth — adding a phase to `MAPPING_PHASES` / `MowingPhase` surfaces in the panel without a separate client edit.
- Lanes render **incrementally**: only phases the running scenario has actually visited are drawn. [`panelTimeline.ts`](../src/sim/panelTimeline.ts) maintains a per-domain `visitedPhases` set (updated by `trackVisitedPhases()` on every incoming WS event). The `/sim/inspect` socket enqueues two envelope shapes — `{ kind: 'transcript', transcript: {…} }` and `{ kind: 'hello', snapshot: {…} }` — which `pushEvent()` flattens via `unwrapInspect()` before `trackVisitedPhases()` / `eventMeta()` read them; the raw envelope is preserved for the expandable `payload` dump. [`panelClient.ts`](../src/sim/panelClient.ts) `visibleNodes()` filters each lane to the visited set ∪ the current active node. `resetSim()` clears the set so a fresh scenario starts from a clean slate. This keeps short scenarios from being crowded by unrelated phases.
- Each visible lane is an ordered sequence of phase nodes joined by `→` connectors:
  - **Active node** (blue) — matches the current `state`/`phase`.
  - **Done nodes** (green) — visited phases earlier in the sequence than the active node, showing progress.
  - **Error node** (red) — matches `ERRORED`/`ESTOPPED`.
  - The **incoming edge** to the active node pulses to indicate a transition just landed.
- Event cards are color-coded by broad type: command/control (blue), notify (green), FSM transcript (violet), or error (red). Each card's `.event-meta` line now surfaces key info without expanding the payload:
  - **Source tag** — `[ws]` / `[http]` / `[ble]`, derived from the payload kind in [`panelTimeline.ts`](../src/sim/panelTimeline.ts) `eventMeta()`.
  - **NOTIFY_RATEL_STATUS** — rendered as `work_status → sub_status` so the transition is visible at a glance.
  - **FSM transcript events** — rendered as `before.state → after.state | event.type`.
  - For everything else the meta falls back to the broad type label. Expand `payload` for the full JSON.

## Common Flows

1. Pick a scenario and open `说明` if you need the YAML guide.
2. Click `运行场景`; use `暂停` / `恢复` to freeze and resume the script loop plus robot FSM. The FSM lanes grow incrementally as the scenario pushes new phases.
3. Use `数据集` to hot-switch map frames, or `故障` to apply a preset from `fixtures/faults/*.json`.
4. Toggle `真实延时` when you want HTTP business routes and outbound WS pushes to feel like a remote backend.
5. Use `开始录制` before reproducing an issue; recordings are saved as `<label>_<timestamp>.jsonl`.
6. Use `重置` to clear robot state **and** the incremental FSM lane history (visitedPhases), so the next scenario starts from a clean slate instead of accumulating nodes from the previous run.

## P5b 改进 (用户反馈)

The following improvements were applied in response to panel UX feedback (see [`refactor-plan.md`](./refactor-plan.md) §6.7):

| # | Issue | Fix | Files |
|---|---|---|---|
| 1 | FSM 泳道列出所有状态，太长 | Incremental rendering — only visited phases ∪ active node are drawn; visitedPhases reset on resetSim() | [`panelTimeline.ts`](../src/sim/panelTimeline.ts), [`panelClient.ts`](../src/sim/panelClient.ts) |
| 2 | 时间流卡片 payload 完全隐藏 | .event-meta line now shows source tag [ws]/[http]/[ble], work_status → sub_status for ratel notifies, and before.state → after.state | event.type for FSM transcripts | [`panelTimeline.ts`](../src/sim/panelTimeline.ts), [`panelStyles.ts`](../src/sim/panelStyles.ts) |
| 3 | 关键指标 sub status 无信息 | lastNotifyWorkStatus / lastNotifySubStatus added to VirtualRobotSnapshot and surfaced by snapshot() so the metric card reads live sub_status | [`virtualRobotTypes.ts`](../src/sim/virtualRobotTypes.ts), [`virtualRobotCore.ts`](../src/sim/virtualRobotCore.ts) |
| 4 | 高分屏三列布局溢出 | Center column capped with min(900px, 1fr), container max-width: 1780px, @media (min-width: 1800px) breakpoint rebalances columns | [`panelStyles.ts`](../src/sim/panelStyles.ts) |
