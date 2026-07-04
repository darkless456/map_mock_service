# Panel Guide

`/sim/panel` is the simulator workbench for scenario runs, dataset switching, fault injection, recorder control, FSM state, and live WS/FSM events.

## Layout

| Area | Purpose |
|---|---|
| Left column | Run/pause/stop scenarios, switch datasets, apply fault presets, start/stop recordings, reset simulator state. |
| Center column | Key metrics, mapping/mowing FSM lanes, runtime summary, raw `/sim/state` snapshot. |
| Right column | Structured event cards from `/sim/inspect`; expand `payload` for full JSON. |

## Reading State

- `work status`, `phase`, `sub status`, `battery`, and `dataset` are pulled from `/sim/state` every 1.5 seconds.
- The FSM lanes are compiled server-side from the read-only fsm-mirror phase enums ([`panelGraph.ts`](../src/sim/panelGraph.ts) `phaseGraphFromFsm()`), so the swim-lane stays in sync with the FSM source of truth — adding a phase to `MAPPING_PHASES` / `MowingPhase` surfaces in the panel without a separate client edit.
- Each lane is an ordered sequence of phase nodes joined by `→` connectors:
  - **Active node** (blue) — matches the current `state`/`phase`.
  - **Done nodes** (green) — phases earlier in the sequence than the active node, showing progress.
  - **Error node** (red) — matches `ERRORED`/`ESTOPPED`.
  - The **incoming edge** to the active node pulses to indicate a transition just landed.
- Event cards are color-coded by broad type: command/control (blue), notify (green), FSM transcript (violet), or error (red). Each card shows a one-line `work/sub/task/state/phase` summary parsed from the payload; expand `payload` for the full JSON.

## Common Flows

1. Pick a scenario and open `说明` if you need the YAML guide.
2. Click `运行场景`; use `暂停` / `恢复` to freeze and resume the script loop plus robot FSM.
3. Use `数据集` to hot-switch map frames, or `故障` to apply a preset from `fixtures/faults/*.json`.
4. Toggle `真实延时` when you want HTTP business routes and outbound WS pushes to feel like a remote backend.
5. Use `开始录制` before reproducing an issue; recordings are saved as `<label>_<timestamp>.jsonl`.
