# Contributing

## Directory structure

```text
src/
├── server.ts
├── auth/               # JWT and one-time WS tickets
├── data/               # map patch and annotation loading
├── http/               # business routes + /sim control routes
├── sim/                # virtual robot, scenario engine, recorder, push mapping, chaos
├── ws/                 # /acc WebSocket server and protocol encoder
└── shared/             # small cross-cutting helpers
```

## FSM mirror workflow

1. Ensure the sibling mower repo exists, or set `MOWER_REPO=/path/to/pudu_ratel_app_mower`.
2. Run `npm run sync-fsm-mirror`.
3. Run `npm run build && npm test`.
4. Fix simulator adapter code under `src/sim/`, `src/ws/`, or `src/http/` if the mower FSM changed semantics.
5. Commit with title prefix `chore(sim): sync fsm-mirror from mower@<sha>`.

Do not manually edit generated files under `src/sim/fsm-mirror/`.

## Adding a route

1. Confirm the route exists in mower app integration or backend docs.
2. Add a handler in `src/http/routes.*.ts`.
3. Keep business routes strict; old `/api/robot/*` helpers must remain removed.
4. Add or update a test in `__tests__/`.
5. Update [docs/api.md](docs/api.md) and [README.md](README.md).

## Adding a simulator event translation

1. Prefer dispatching a real `TaskEvent` into `VirtualRobot`.
2. Add external frame translation in `src/sim/pushChannels.ts` only.
3. Add a unit test for the payload shape.
4. If the change needs a scripted flow, add or update a YAML file under [scenarios](scenarios) and cover it in tests when practical.

## Adding a scenario

1. Add `scenarios/<phenomenon>_then_<expectation>.yaml`.
2. Keep it under 50 steps and include at least one `expect`.
3. Run it through `/sim/panel` or `ScenarioEngine` tests.
4. Update [docs/scenarios.md](docs/scenarios.md) when adding a new scenario pattern.

## Recorder policy

- Local `recordings/*.jsonl` files are ignored by default.
- Commit only curated regression recordings with a short README explaining the bug or flow.
- Prefer converting recordings into YAML scenarios before review.

## Pre-submit checklist

```bash
npm run sync-fsm-mirror
npm run build
npm test
npm run lint
```
