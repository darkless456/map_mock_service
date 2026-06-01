# Scenario scripts guide

Phase S2 is implemented: YAML scenarios under [scenarios](../scenarios) can be run from `/sim/panel`, `/sim/scenario/run`, or tests through `ScenarioEngine`.

## Five-minute flow

1. Start the simulator with `npm start`.
2. Open `http://localhost:9900/sim/panel`.
3. Select `happy_mapping` and click **Run scenario**.
4. Inspect live state with `GET /sim/state`.
5. Watch reducer transcript events through `WS /sim/inspect` or the panel timeline.

Mapping scenarios that pass through streamable phases such as `MAP_SCAN_BOUNDARY`, `MAP_FOLLOW_BOUNDARY`, and `MAP_COVERAGE_RUN` push at least one `MAP_INCREMENTAL` frame as soon as the FSM enters the phase. If a scenario also waits in a streamable phase, additional frames are pushed at `PUSH_INTERVAL_MS`.

For rendering checks, use these long-running scenarios from `/sim/panel`:

- `continuous_mapping_stream`: holds boundary scan, boundary follow, and coverage run for 30s each. Use it with the POC MapBuilder screen to inspect incremental map patch rendering.
- `mowing_trajectory_stream`: holds mowing in `MOW_RUNNING` for 60s. Use it with the POC Mowing screen after `LOCATION_REGISTER` to inspect robot trajectory and coverage rendering over the semantic class `0` grass route generated from `full_semanticmap.png`.

## Run by API

```bash
curl -s -X POST http://localhost:9900/sim/scenario/run \
    -H 'Content-Type: application/json' \
    -d '{"name":"precheck_failed_then_retry"}'
```

Inline YAML is also supported:

```json
{
    "inline": "name: smoke\ndomain: mapping\nsetup: { state: PREPARING, phase: MAP_PRECHECK }\nsteps:\n  - emit: { type: DEVICE_WORK_STATUS, status: mapping }\n  - expect: { state: UNDOCKING }\n"
}
```

## YAML shape

```yaml
name: precheck_failed_then_retry
domain: mapping
setup:
    state: PREPARING
    phase: MAP_PRECHECK
steps:
    - emit: { type: DEVICE_ERROR, code: PRECHECK_FAILED, recoverable: true }
    - expect: { state: PREPARING, phase: MAP_PRECHECK_FAILED }
    - emit: { type: CMD_RETRY }
    - expect: { phase: MAP_PRECHECK }
```

## Supported steps

| Step | Purpose |
|---|---|
| `emit` | Dispatch a real FSM `TaskEvent`. Optional `domain`. |
| `expect` | Deep-partial assertion against active ctx plus snapshot fields. |
| `wait` | Wait `Nms`, `Ns`, or `{ until, timeout }`. |
| `chaos` | Apply `{ latencyMs?, dropRate?, reorderWindowMs? }`. |
| `note` | Add a human-readable marker to recorder output. |
| `include` | Include another scenario by name. |
| `record` | Start JSONL recording, optionally with a label. |
| `stopRecord` | Stop JSONL recording. |

## Checked-in scenarios

| File | Coverage |
|---|---|
| `happy_mapping.yaml` | precheck -> scan -> follow -> coverage -> completed |
| `continuous_mapping_stream.yaml` | long-running streamable mapping phases for incremental rendering checks |
| `happy_mowing.yaml` | mowing start -> running -> completed |
| `mowing_trajectory_stream.yaml` | long-running mowing task for semantic-zero `ROBOT_LOCATION` trajectory checks |
| `precheck_failed_then_retry.yaml` | recoverable precheck failure |
| `scan_boundary_failed_then_pause_and_manual.yaml` | pause and remote/manual switch capability |
| `boundary_close_failed_then_retry.yaml` | boundary closing failure retry |
| `boundary_close_failed_then_retry_remote.yaml` | remote mode boundary retry |
| `boundary_wait_continue.yaml` | boundary wait -> coverage probe |
| `coverage_wait_save.yaml` | coverage wait -> save -> completed |
| `notice_new_area_auto_and_remote.yaml` | new-area notices in auto and remote flows |
| `estop_during_working.yaml` | ESTOPPED, hardware clear, reset/resume |
| `finish_and_return_dock.yaml` | mowing early finish and return dock |
| `capabilities_toggle.yaml` | capability flag updates |
| `error_kind_stuck.yaml` | `error.kind` projection |
| `low_battery_recharge_resume.yaml` | recharge and resume |
| `network_chaos.yaml` | latency/drop/reorder smoke path |
| `recorder_smoke.yaml` | scenario-level record/stopRecord |

## Recorder and replay

Start recording:

```bash
curl -s -X POST http://localhost:9900/sim/recorder/start \
    -H 'Content-Type: application/json' \
    -d '{"label":"bug-repro"}'
```

Stop and replay:

```bash
curl -s -X POST http://localhost:9900/sim/recorder/stop
curl -s -X POST http://localhost:9900/sim/recorder/replay \
    -H 'Content-Type: application/json' \
    -d '{"file":"<recording>.jsonl"}'
```

`recordings/*.jsonl` is git-ignored. Convert useful recordings into YAML scenarios before review whenever possible.

## Authoring rules

- One file should stay under 50 steps.
- `setup` must explicitly declare `state` and `phase`.
- `emit` must use real `TaskEvent` fields only.
- Every scenario needs at least one `expect`.
- File names should describe phenomenon, trigger, and expected result, such as `boundary_close_failed_then_retry.yaml`.
