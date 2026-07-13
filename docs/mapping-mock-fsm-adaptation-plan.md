# Mapping Mock FSM Adaptation Plan

## Purpose

This document describes how `map_mock_service` should adapt its mapping-domain
simulation to the current mower FSM and the API conclusions in
`build-docs/pudu_ratel_app_mower/mapping_api_gap_audit.md`.

The generated FSM mirror remains read-only. The mock owns the device-protocol
projection, command acknowledgement simulation, and HTTP/WS recovery snapshots.

## Design Principles

1. Do not edit `src/sim/fsm-mirror/**` manually. Make FSM changes in mower,
   then run `npm run sync-fsm-mirror`.
2. An HTTP command means the device accepted an intent. It must not directly
   change an FSM phase; a simulated device status event is authoritative.
3. One protocol snapshot must feed WS pushes and HTTP recovery APIs so reconnect
   behavior cannot disagree with foreground behavior.
4. Do not invent production `sub_status` values before the backend confirms
   them. Unknown values must remain conservative no-ops.

## Target Flow

```text
HTTP action or simulated device input
  -> Mock protocol layer (validation, pending command, timestamps)
  -> NOTIFY_RATEL_STATUS / device detail / mapping status / labels
  -> mirrored EventAdapter and MappingSession
```

The mock must not bypass the mirrored reducer by assigning a mapping phase
directly in an HTTP route.

## FSM Boundaries

The synced `MappingSession` owns these mapping-specific fields and events:

| Mirrored context field | Mirrored event |
| --- | --- |
| `canStartFollowBoundary` | `DEVICE_FOLLOW_BOUNDARY_READY` |
| `canCloseBoundary` | `DEVICE_BOUNDARY_CLOSABLE` |
| `lawnCount` | `DEVICE_LAWN_COUNT` |
| `MAP_COMPLETING` | device phase once the backend `sub_status` is confirmed |

The mock may calculate simulated sensor values, but it must dispatch the
corresponding mirrored events so the context is the source for outbound state.

## Action Contract

Extend `POST /ratel_mapping_task/action` with these actions in addition to
`PAUSE`, `RESUME`, and `STOP`.

| Action | Preconditions | Device-authoritative acknowledgement |
| --- | --- | --- |
| `CONFIRM_START_BOUNDARY` | Active mapping task, remote mapping, legal start point | `work_status=mapping`, `sub_status=edge_mapping` |
| `CONFIRM_CLOSE` | Active mapping task, remote edge follow, legal close point | `work_status=mapping`, `sub_status=map_edge_finish` |

The action response only acknowledges receipt. The mock protocol layer records
a pending command and later emits the acknowledgement through the normal device
status path. This permits tests to assert that the client does not optimistically
change phase before the device acknowledgement.

Recommended validation responses:

| Condition | Response |
| --- | --- |
| Missing or inactive task | `404` |
| Illegal phase, duplicate action, or device busy | `409` |
| `legitimate_starting_point` or `legitimate_end_point` is false | `422` |

`CMD_CONFIRM` remains an internal FSM event. It is not an external replacement
for either boundary action.

## Button Signals

Use the existing v4 protocol fields, not mock-specific task-list fields.

| Protocol field | FSM context field |
| --- | --- |
| `extend_status.legitimate_starting_point` | `canStartFollowBoundary` |
| `extend_status.legitimate_end_point` | `canCloseBoundary` |

`MappingTelemetry` may generate simulated values from robot position. Whenever
one changes, `VirtualRobot` dispatches the appropriate mirrored signal event.
Outbound payloads then read the context values, rather than the telemetry object
directly.

Return the same `extend_status` object in:

- `NOTIFY_RATEL_STATUS.data`
- robot detail responses
- the mapping recovery snapshot, when that endpoint exposes device state

Remove the root-level `edge_start_available` and `region_closeable` fields once
clients have migrated. Do not add `can_start_follow_boundary` or
`can_close_boundary` to `RATEL_MAPPING_TASK` or its list response; they are
device-status signals, not task lifecycle fields.

## Protocol Snapshot

Introduce a mock-owned `MappingProtocolSnapshot` with at least:

```ts
interface MappingProtocolSnapshot {
  workStatus: string;
  subStatus: string | null;
  subStatusEnteredAt: number | null;
  lawnCount: number | null;
  lawnArea: number | null;
}
```

Update `subStatusEnteredAt` only when the simulated device changes
`sub_status`. Use this snapshot to build all mapping state projections:

- `NOTIFY_RATEL_STATUS`
- `POST /ratel/api/v1/mapping/status`
- mapping task recovery/list payloads if that is the chosen query carrier
- `/sim/state` and scenario expectations

The recovery response must include the current `sub_status`,
`sub_status_entered_at` in milliseconds since epoch, `lawn_count`, and
`lawn_area`.

## MAP_COMPLETING

The backend has not yet confirmed the real `sub_status` value for
`MAP_COMPLETING`. The synced mower `BackendPhaseMapper` intentionally has no
mapping for a placeholder value.

Until that value is confirmed, the current mock keeps normal completion on the
mirrored `mapping -> idle` registry edge. Its simulator projection maps
`MAP_COMPLETING` to the legacy-compatible `exit_mapping` value before the
immediate confirmation; this is a mock compatibility behavior, not a confirmed
production `sub_status`. Do not add a second placeholder mapping in the mower
mirror. Use explicit simulator events only for isolated `MAP_COMPLETING` UI
tests.

Once the backend provides the value and lifecycle:

1. Add the mapping in the mower repository's `BackendPhaseMapper`.
2. Sync the FSM mirror.
3. Configure the same value in the mock protocol fixture.
4. Emit it on WS and return it with `sub_status_entered_at` in recovery
   snapshots.

## Mapping Data

`lawnCount` is explicit mock state; do not infer it from passage checkpoints.
Update it with `DEVICE_LAWN_COUNT` and expose it through recovery state.

`MAP_INCREMENTAL.map_header.lawn_area` remains the real-time area source.
Recovery state returns a semantically equivalent `lawn_area` value.

The existing labels API remains the coordinate source:

| Marker | Label selection |
| --- | --- |
| Edge-follow start | `labels[type=edge_start].points[0]` |
| Scan-boundary start | `labels[type=aisle].points[0]` |

The mock needs representative labels fixtures and tests for missing labels,
empty points, and invalid coordinates. It does not need another coordinate API.

## Legacy Cleanup

After the new action and `extend_status` paths are available:

1. Reject or retire `/ratel/api/v1/mapping/manual` as a boundary-control path.
2. Remove root-level legacy button fields from WS and HTTP responses.
3. Remove old coverage flow references such as `bow_cover`, `MAP_COMPLETE`,
   `MAP_COVERAGE_*`, and `MAP_FOLLOW_BOUNDARY_LOST` from scenarios and current
   documentation.
4. Keep historical changelog entries unchanged, but mark active design documents
   with the current FSM terminology.

## Deferred Backend Contracts

These need a backend decision before mock production-parity behavior can be
implemented:

- Actual `MAP_COMPLETING` `sub_status` value and lifecycle
- `sub_status_entered_at` response placement and unit
- Mapping phase recovery endpoint or task-list field placement
- `lawn_count` real-time and recovery contract
- NRTK self-check field and failure semantics
- Stable mapping-undocking-failure status or error-code mapping

For undocking failure, provide a simulator-only explicit phase/fault scenario
until mower and backend define the stable production mapping.

## Delivery Order

1. Create the protocol snapshot and make mapping status recovery return it.
2. Project `extend_status` from mirrored context and feed context events from
   simulated telemetry.
3. Add `CONFIRM_START_BOUNDARY`, `CONFIRM_CLOSE`, pending commands, and delayed
   simulated device acknowledgements.
4. Add `lawn_count`, `lawn_area`, and timestamp recovery coverage.
5. Sync the confirmed `MAP_COMPLETING` mapper from mower and enable its live
   protocol projection.
6. Remove legacy mapping-control paths and stale scenarios.

## Acceptance Criteria

1. A false start or close signal rejects its action with `422`.
2. A successful action does not change phase until its simulated device status
   acknowledgement is emitted.
3. `edge_mapping` is the authoritative transition after start confirmation.
4. `map_edge_finish` is the authoritative transition after close confirmation.
5. Reconnect recovery restores phase, phase-entered timestamp, lawn count,
   lawn area, and `extend_status` consistently with live WS state.
6. Unknown `sub_status` values are no-ops and never force `MAP_COMPLETING`.
7. Missing labels or invalid points do not throw and do not render a marker.
8. No active scenario or runtime projection relies on legacy coverage phases.
