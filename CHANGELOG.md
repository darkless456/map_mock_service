# Changelog

## v1.0.0 - 2026-05-30

### Breaking changes

- Rebuilt the service as **Mower Dev Simulator**.
- Removed the legacy JavaScript entry point `src/index.js`.
- Removed all legacy `/api/robot/*` status-helper routes, including `start_mapping`, `stop_mapping`, `start_charging`, and `set_sn`.
- Removed legacy JS tests under `src/__tests__/`.
- Switched runtime and tests to TypeScript via `tsx` and `node --test --import tsx`.

### Added

- TypeScript HTTP router for the mower business API paths.
- One-time `/acc` WebSocket ticket issuance.
- FSM mirror sync script: `npm run sync-fsm-mirror`.
- `VirtualRobot` bridge for mapping and mowing FSM state.
- `ROBOT_STATUS`, `NOTIFY_MOW_STATUS`, `ROBOT_LOCATION`, `MAP_FIX`, and `MAP_INCREMENTAL` pushes.
- Dev control APIs: `/sim/state`, `/sim/event`, `/sim/reset`, `/sim/chaos`, `/sim/ble/*` placeholders.
- YAML scenario engine with `/sim/scenario/run`, `/sim/scenario/stop`, and checked-in scenarios.
- htmx control panel at `/sim/panel` plus live reducer transcript WS at `/sim/inspect`.
- JSONL recorder/replay APIs: `/sim/recorder/start`, `/sim/recorder/stop`, `/sim/recorder/replay`, `/sim/recorder/list`.
- Chaos injection is now wired into outbound WS sending for latency, drop, and reorder-window jitter.
- New docs: [CONTRIBUTING.md](CONTRIBUTING.md), [docs/api.md](docs/api.md), [docs/fsm-mirror.md](docs/fsm-mirror.md), [docs/scenarios.md](docs/scenarios.md).
