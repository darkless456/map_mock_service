# Fixture Guide

API response data that changes often lives under `fixtures/` and is hot-loaded by `src/fixtures/FixtureLoader.ts`.

Edit these files directly; the next matching request reads the latest content without restarting `npm start`:

| File | Used by |
|---|---|
| `fixtures/maps/map_list.json` | `GET/POST /ratel/map-service/api/v1/ratel/map/list` static map items and increments. |
| `fixtures/maps/metadata.jsonc` | Map metadata fallback/overrides for `getMapMetadata`. |
| `fixtures/device/self_check.jsonc` | `POST /ratel/api/v1/robot/self_check` response `data`. |
| `fixtures/mapping/check_conditions.jsonc` | Full `POST /ratel/api/v1/mapping/check` condition values. |
| `fixtures/mowing/trajectory_fallback.jsonc` | Fallback mowing route when semantic-map extraction fails. |
| `fixtures/recharge/notify_sequence.jsonc` | Return-dock `sub_status` timing sequence. |
| `fixtures/sim/realism.jsonc` | Default real-world HTTP/WS latency profile. |
| `fixtures/faults/*.json` | Named fault presets for `/sim/fault` and scenario `fault` steps. |

Run `npm run check-fixtures` after editing to catch malformed JSON/JSONC early.

`semantic/save` writes runtime overrides in memory only (`src/fixtures/semanticOverrides.ts`). Static map increments, including charging dock points (`type: 69`), come from `fixtures/maps/map_list.json`.

Map-frame datasets live in `fixtures/datasets/<name>/frames`; select one at startup with `MOCK_DATA_DIR=<name> npm start`, switch at runtime with `POST /sim/dataset`, or bind a YAML scenario with top-level `dataset: mapping_happy`.

Scenarios can temporarily override fixture values while they run:

```yaml
fixtures:
  device/self_check.jsonc: { overall: "error", blade: "warning" }
```

Fault presets are plain JSON:

```json
{
  "name": "network_delay",
  "chaos": { "latencyMs": 800, "dropRate": 0, "reorderWindowMs": 400 }
}
```

Apply them with `POST /sim/fault { "name": "network_delay" }` or a scenario step `fault: network_delay`.

Realism latency is off by default unless `SIM_REALISM=1` is set. Runtime changes go through `/sim/realism`; HTTP business routes receive one random delay per request, while `/sim/*` and `/api/health` stay responsive.
