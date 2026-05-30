# FSM mirror

The simulator keeps a one-way copy of selected pure FSM files from the mower app. The mirror lets local backend simulation use the same reducer semantics without changing the mower repository layout or CI/CD.

## Files copied

```text
mower/src/domain/shared/TaskFSM.ts                         -> src/sim/fsm-mirror/domain/shared/TaskFSM.ts
mower/src/domain/shared/EstopReducer.ts                    -> src/sim/fsm-mirror/domain/shared/EstopReducer.ts
mower/src/domain/shared/LoggerLike.ts                      -> src/sim/fsm-mirror/domain/shared/LoggerLike.ts
mower/src/domain/mapping/MappingSession.ts                 -> src/sim/fsm-mirror/domain/mapping/MappingSession.ts
mower/src/domain/mowing/MowingTask.ts                      -> src/sim/fsm-mirror/domain/mowing/MowingTask.ts
mower/src/domain/mapEdit/MapEditSession.ts                 -> src/sim/fsm-mirror/domain/mapEdit/MapEditSession.ts
mower/src/features/shared/mapping/BackendStatusMapper.ts   -> src/sim/fsm-mirror/features/shared/mapping/BackendStatusMapper.ts
mower/src/features/mapping/state/mappingBackendRegistry.ts -> src/sim/fsm-mirror/features/mapping/state/mappingBackendRegistry.ts
mower/src/features/mowing/state/mowingBackendRegistry.ts   -> src/sim/fsm-mirror/features/mowing/state/mowingBackendRegistry.ts
mower/src/services/events/Arbitrator.ts                    -> src/sim/fsm-mirror/services/events/Arbitrator.ts
mower/src/services/events/EventAdapter.ts                  -> src/sim/fsm-mirror/services/events/EventAdapter.ts
mower/src/features/shared/mapping/TaskEventPipeline.ts     -> src/sim/fsm-mirror/features/shared/mapping/TaskEventPipeline.ts
```

A local type-only `AppError.ts` shim is generated because `MowingTask.ts` imports that type but it is not part of the official mirror list.

## Sync command

```bash
npm run sync-fsm-mirror
```

Optional custom mower path:

```bash
MOWER_REPO=/absolute/path/to/pudu_ratel_app_mower npm run sync-fsm-mirror
```

The script:

1. Copies the approved files.
2. Rewrites `@/domain`, `@/features`, and `@/services` aliases to relative mirror paths.
3. Adds a generated header with source SHA-256 and sync timestamp.
4. Writes `src/sim/fsm-mirror/.manifest.json`.

## After syncing

Run:

```bash
npm run build
npm test
```

Expected failures after mower FSM changes should be fixed in simulator-owned files, usually:

- `src/sim/virtualRobot.ts`
- `src/sim/pushChannels.ts`
- `src/sim/taskBridge.ts`
- future `scenarios/*.yaml`

Do not patch generated mirror files by hand.

## Common conflict cases

| Change in mower FSM | Simulator fix |
|---|---|
| New `TaskState` | Update status derivation in `VirtualRobot.workStatus()` and payload projection in `pushChannels.ts`. |
| New mapping phase | Add streaming decision or backend phase mapping in `mapStream.ts` / `pushChannels.ts`. |
| Renamed event | Update `taskBridge.ts`, `/sim/event` docs, and tests. |
| Deleted event | Remove simulator references and update docs/tests. |
