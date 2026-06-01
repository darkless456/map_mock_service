# Mower Dev Simulator

`map-mock-service` is now the local **Mower Dev Simulator** for mower app development. It simulates the backend REST API, `/acc` WebSocket pushes, map incremental frames, mowing task status, robot location, and the development control surface.

The simulator is intentionally a breaking replacement for the old map-only mock service. Legacy `/api/robot/*` helper routes were removed; unknown paths return:

```json
{ "code": 404, "message": "deprecated; removed in simulator v1" }
```

## Quick start

```bash
npm install
npm run sync-fsm-mirror
npm start
```

Default URL: `http://localhost:9900`.

## Scripts

| Script | Purpose |
|---|---|
| `npm start` | Run `tsx src/server.ts`. |
| `npm run build` | Type-check the TypeScript simulator. |
| `npm test` | Run Node's TS unit and e2e scenario test suite. |
| `npm run lint` | Alias to `tsc --noEmit`. |
| `npm run sync-fsm-mirror` | Copy the mower FSM mirror into `src/sim/fsm-mirror/`. |

## Environment variables

| Variable | Default | Description |
|---|---:|---|
| `PORT` | `9900` | HTTP and WebSocket port. |
| `MOCK_DATA_DIR` | `data3` | Dataset directory: `data`, `data2`, `data3`, or `data4`. |
| `ROBOT_SN` | `MOCK:00:11:22:33:44` | Default robot SN. |
| `PUSH_INTERVAL_MS` | `200` | Map incremental frame interval. |
| `MAP_MOCK_SLICE_BYTES` / `MMR_SLICE_BYTES` | disabled | Force map-frame base64 slicing for RustKit fragment reassembly tests. Slice boundaries are rounded down to a 4-character base64 boundary. |
| `JWT_SECRET` | local mock secret | JWT verification secret. |
| `TICKET_SECRET` | local mock secret | `/acc` ticket signing secret. |
| `SIM_PANEL` | enabled | Set `SIM_PANEL=0` to disable `/sim/*` control APIs. |

## Business HTTP API

The service only registers the mower API paths below. For app compatibility, device detail and map list accept both the documented `GET` method and the current mower app's `POST` calls.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/ratel/api/v1/wss/acc_ticket` | Validate `Authorization` + `platform`, issue one-time 120s WS ticket. |
| `GET/POST` | `/ratel/api/v1/courtyard/robot/detail` | Return current virtual robot device info. |
| `POST` | `/ratel/api/v1/courtyard/robot/info/update` | Update simulator nickname / SN and broadcast robot status. |
| `POST` | `/ratel/api/v1/courtyard/robot/unbind` | Reset virtual robot state. |
| `GET/POST` | `/ratel/map-service/api/v1/ratel/map/list` | Return semantic basemap URL and annotation increments. |
| `POST` | `/ratel/map-service/api/v1/ratel/semantic/save` | Save annotation increment package in memory and dispatch `CMD_SAVE`. |
| `POST` | `/ratel/api/v1/map/delete` | Delete an in-memory map package. |
| `POST` | `/ratel/api/v1/mapping/start` | Dispatch mapping `CMD_START` and `MAP_PRECHECK`. |
| `POST` | `/ratel/api/v1/mapping/pause` | Dispatch mapping `CMD_PAUSE`. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/create` | Create mowing task, dispatch mowing `CMD_START` + `DEVICE_REPORT_STARTED`. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/action` | Handle `PAUSE`, `RESUME`, `CANCEL`, and `FINISH_AND_RETURN_DOCK`. |
| `POST` | `/ratel/central-control-service/api/v1/ratel_task/list` | Return task list and active `task_notify`. |
| `GET` | `/api/health` | Local health check. |

Asset URLs returned by map list currently point to `/sim/assets/full_semanticmap.png`.

## WebSocket API

1. Request a ticket from `/ratel/api/v1/wss/acc_ticket`.
2. Connect to `ws://localhost:9900/acc?ticket=<ticket>`.
3. The simulator sends `MAP_FIX` and `ROBOT_STATUS` immediately.

### Client to server

| `cmd` | Behavior |
|---|---|
| `heartbeat` | Reply with `{ code: 200, codeMsg: 'Success' }`. |
| `MAP_INCREMENTAL` ack | Acknowledge frame receipt. |
| `LOCATION_REGISTER` | Subscribe this socket to `ROBOT_LOCATION` for `sn`. |
| `LOCATION_UNREGISTER` | Remove location subscription. |

### Server to client

| `cmd` | Source |
|---|---|
| `ROBOT_STATUS` | Derived from active FSM context. Includes `mapping_phase`, `capabilities`, `estop`, `notices`, and `error`. |
| `NOTIFY_MOW_STATUS` | Flattened mowing task status payload. |
| `ROBOT_LOCATION` | Semantic-zero grass-route location stream for registered SN while mowing. |
| `MAP_FIX` / `MAP_INCREMENTAL` | `data*/` XML + PNG patches encoded by protocol v2. |

`MAP_FIX` is sent once on WS connection. `MAP_INCREMENTAL` is sent immediately when mapping FSM enters a streamable phase and then every `PUSH_INTERVAL_MS` while that phase remains active, so fast `/sim/scenario/run` mapping scripts still produce frames for POC debugging.

For visual regression checks, run `continuous_mapping_stream` to keep `MAP_INCREMENTAL` flowing across mapping phases, or run `mowing_trajectory_stream` to keep `ROBOT_LOCATION` flowing for subscribed clients while the robot follows the semantic class `0` grass area in `full_semanticmap.png`. When a client sends `LOCATION_REGISTER` during an active mowing task, the server sends the current pose immediately and then continues the 300ms stream.

## Control API

`/sim/*` is dev-only and enabled by default.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/sim/state` | Inspect current robot contexts and recent events. |
| `GET` | `/sim/panel` | htmx control panel for scenarios, event buttons, chaos, and recorder. |
| `GET` | `/sim/scenarios` | List checked-in YAML scenarios. |
| `POST` | `/sim/event` | Dispatch raw FSM event. Optional body field: `domain`. |
| `POST` | `/sim/scenario/run` | Run `{ "name": "happy_mapping" }` or `{ "inline": "...yaml" }`. |
| `POST` | `/sim/scenario/stop` | Stop the active scenario. |
| `POST` | `/sim/recorder/start` | Start writing `recordings/<timestamp>.jsonl`. |
| `POST` | `/sim/recorder/stop` | Stop the active recording. |
| `POST` | `/sim/recorder/replay` | Replay `{ "file": "...jsonl" }` or inline entries. |
| `GET` | `/sim/recorder/list` | List recording files and recorder status. |
| `POST` | `/sim/reset` | Reset simulator state. |
| `POST` | `/sim/chaos` | Set WS latency/drop/reorder knobs. |
| `POST` | `/sim/ble/register` | Placeholder for mower mock BLE control-channel registration. |
| `POST` | `/sim/ble/notify` | Placeholder echo endpoint for future BLE notify injection. |
| `WS` | `/sim/inspect` | Live reducer transcript stream for the panel and debugging. |

Checked-in scenarios live in [scenarios](scenarios). `recordings/*.jsonl` is git-ignored by default; commit only curated regression recordings intentionally.

Useful rendering scenarios:

| Scenario | Use |
|---|---|
| `continuous_mapping_stream` | Incremental map rendering / atlas patch placement in the POC MapBuilder screen. |
| `mowing_trajectory_stream` | Robot trajectory and coverage rendering in the POC Mowing screen. |

## Mower app联调

1. Start this service: `npm start`.
2. Generate a local JWT using `JWT_SECRET` and set it as the mower mock `accessToken`.
3. In mower app `mock/config.local.ts`, set `enabled: true` and `http.baseUrl: 'http://localhost:9900'`.
4. Start the app. Business HTTP calls and WS pushes should now come from the simulator.
5. Open `http://localhost:9900/sim/panel` to run scenarios or trigger raw FSM events.

## More docs

- [docs/api.md](docs/api.md)
- [docs/fsm-mirror.md](docs/fsm-mirror.md)
- [docs/mowing_trajectory.md](docs/mowing_trajectory.md)
- [docs/scenarios.md](docs/scenarios.md)
