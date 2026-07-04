# Semantic-zero mowing trajectory

## Overview

The simulator generates its mowing `ROBOT_LOCATION` stream from the semantic class `0` grass area in [`fixtures/maps/assets/full_semanticmap.png`](../fixtures/maps/assets/full_semanticmap.png). This replaces the previous hard-coded rectangle so the POC mowing screen can render the robot icon, trajectory line, and mowed-area coverage over the actual black grass region in the static semantic map.

## Artifact Design

- Source image: [`fixtures/maps/assets/full_semanticmap.png`](../fixtures/maps/assets/full_semanticmap.png) (read exclusively via [`src/assets/BasemapAsset.ts`](../src/assets/BasemapAsset.ts)).
- Generator: [src/trajectory/mowingTrajectory.ts](../src/trajectory/mowingTrajectory.ts).
- Stream integration: [src/ws/wsServer.ts](../src/ws/wsServer.ts).
- Test coverage: [__tests__/mowingTrajectory.test.ts](../__tests__/mowingTrajectory.test.ts) and [__tests__/e2e/happy_mapping.test.ts](../__tests__/e2e/happy_mapping.test.ts).

The generator reads the PNG at startup, treats pixels with RGB values `<= 1` as semantic class `0`, computes the grass bounding box, and builds a lane-by-lane route using:

| Parameter | Value | Purpose |
|---|---:|---|
| Resolution | `0.05 m/px` | Matches the POC semantic map loader. |
| Lane spacing | `0.4 m` | Matches the mock mowing width. |
| Pose step | `0.1 m` | Smooth 300ms robot-location movement. |
| Edge margin | `0.1 m` | Keeps route points inside the grass pixels. |

The generator reads the PNG via `readSemanticMapPngBytes()` and **fails fast** if the asset is missing, the PNG is corrupt, or it contains no semantic-class-0 region: such errors surface at startup instead of silently degrading. An explicit `fixtures/mowing/trajectory_fallback.jsonc` route is available for tests by setting `MOWING_TRAJECTORY_SOURCE=fallback` — it is no longer a silent fallback path.

## Usage

1. Start the simulator with `npm start`.
2. Open the POC mowing screen and let it create a mock mowing task.
3. The app sends `LOCATION_REGISTER`; the simulator immediately sends the current semantic-zero pose and then pushes `ROBOT_LOCATION` every 300ms while the active task is `ON_THE_WAY`.
4. For scenario-based checks, run `mowing_trajectory_stream`（无限循环轨迹，自建任务）或 `mowing_happy_auto`（正常割草流程）from `/sim/panel`：

```bash
curl -s -X POST http://localhost:9900/sim/scenario/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"mowing_trajectory_stream"}'
```

`mowing_trajectory_stream` 为无限循环，测试完成后调用 `POST /sim/scenario/stop` 或在 Panel 点击「停止场景」（停止时会一并复位机器人，立即停止推流）。两个割草场景都自带 `CMD_START`，无需 App 先 HTTP create。

> **App 收不到轨迹的一个常见坑**：若上一轮场景留下终态任务（`COMPLETE`/`CANCEL`/`FAILED`），App 割草页在 WS 建连时会收到该终态 `NOTIFY_MOW_STATUS` 并直接进入 `finished`，从而不再执行「建图就绪 → REST 建任务 → `LOCATION_REGISTER`」自动握手，导致再进割草页时机器人与轨迹都不刷新。模拟器现已在连接建立时**只对活跃任务（`ON_THE_WAY`/`PAUSE`）补发** `NOTIFY_MOW_STATUS`；如仍异常，可先 `POST /sim/reset` 清理状态。

Alternatively create a task via `POST /ratel/central-control-service/api/v1/ratel_task/create`.

## Change Points

- `ROBOT_LOCATION` no longer follows a fixed rectangular field.
- The initial pose and subsequent route points are derived from [`fixtures/maps/assets/full_semanticmap.png`](../fixtures/maps/assets/full_semanticmap.png), so changing the semantic map asset changes the simulated trajectory without changing WS code.
- The route reverses at the end instead of jumping back to the first point, avoiding a long artificial trajectory segment during long visual checks.

## Key Considerations

- The generator assumes semantic-local world space: pixel `(x, y)` maps to `(x * 0.05, y * 0.05)` meters, with Y positive downward.
- Anti-aliased semantic-zero edges in the PNG can contain RGB `1`; these are included by the `<= 1` threshold.
- The route intentionally uses the longest valid run per lane to keep the robot inside the connected grass area and avoid drawing through nearby non-grass gaps.
- Plan/no-go overlays are still supplied by the POC screen; this artifact only controls the robot pose stream.

## API Details

No new external API is added. Existing behavior remains:

- Client registers with `LOCATION_REGISTER { sn }`.
- Server pushes `ROBOT_LOCATION` with `x`, `y`, `yaw`, and `angle`.
- The stream is active only while a mowing task exists and its status is `ON_THE_WAY`.
