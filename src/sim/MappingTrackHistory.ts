/**
 * mapping_snapshot_recovery_design.md §8 / §19.5: backing store for
 * `POST /location-collection-service/api/location/track/query`.
 *
 * The virtual robot has NO recorded mapping-pose history (mapping poses are read
 * frame-by-frame off static dataset patches and never accumulated). So this module
 * *synthesises* a deterministic, realistic boundary-following trajectory anchored to
 * the same world-metre frame as the labels (`fixtures/mapping/label_coordinates.jsonc`,
 * `first_lawn.edge_start = {x:11.3, y:7.45}`), keeping track/query points visually
 * consistent with MAP_INCREMENTAL frame-header poses (design A6, BackendWorld metres).
 *
 * It also holds a per-route fault-injection scenario so the automated recovery tests
 * (design §19.5 item 2) can exercise: empty list, exact-`limit` truncation, map_id
 * mismatch, non-finite / out-of-range coords, >5 m jumps, delay and HTTP error — none
 * of which the global chaos/realism knobs can express (they only cover WS + a blanket
 * HTTP delay, and there is no per-route 500 mechanism to reuse).
 */

export type TrackQueryFaultMode =
  | 'normal'
  | 'empty'
  | 'truncate'
  | 'map_id_mismatch'
  | 'non_finite'
  | 'jump'
  | 'error';

export interface TrackQueryScenario {
  /** Injected fault shape; `'normal'` returns a clean synthetic trajectory. */
  mode: TrackQueryFaultMode;
  /** Extra per-route delay in ms (design §19.5: "延迟 5s"); 0 = no delay. */
  delayMs: number;
  /** HTTP status for `mode: 'error'` (design §19.5: "500 错误"). */
  errorStatus: number;
  /** Override for the synthetic point count in `'normal'`; null = default. */
  pointCount: number | null;
}

export interface TrackPoint {
  map_id: string;
  x: number;
  y: number;
  angle: number;
}

export interface TrackQueryParams {
  mapId: string;
  limit: number;
  offset: number;
}

/** World-metre anchor shared with the first lawn's `edge_start` label (design A6). */
const ANCHOR = { x: 11.3, y: 7.45 } as const;
/** Rectangle the synthetic path walks; perimeter = 2*(W+H) = 28 m. */
const RECT_W = 8;
const RECT_H = 6;
/** Point spacing along the perimeter — matches the design's stated 0.1~0.5 m real spacing. */
const STEP_M = 0.2;
/** Default synthetic point count for `'normal'` (walks ~1.8 loops → exercises revisits). */
const DEFAULT_POINT_COUNT = 500;

const DEFAULT_SCENARIO: TrackQueryScenario = {
  mode: 'normal',
  delayMs: 0,
  errorStatus: 500,
  pointCount: null,
};

/** Maps a cumulative walk distance to a point + heading (radians) on the rectangle. */
function pointAtDistance(distance: number, mapId: string): TrackPoint {
  const perimeter = 2 * (RECT_W + RECT_H);
  let t = ((distance % perimeter) + perimeter) % perimeter;
  // Edge 1: bottom, +x
  if (t <= RECT_W) return { map_id: mapId, x: ANCHOR.x + t, y: ANCHOR.y, angle: 0 };
  t -= RECT_W;
  // Edge 2: right, +y
  if (t <= RECT_H) return { map_id: mapId, x: ANCHOR.x + RECT_W, y: ANCHOR.y + t, angle: Math.PI / 2 };
  t -= RECT_H;
  // Edge 3: top, -x
  if (t <= RECT_W) return { map_id: mapId, x: ANCHOR.x + RECT_W - t, y: ANCHOR.y + RECT_H, angle: Math.PI };
  t -= RECT_W;
  // Edge 4: left, -y
  return { map_id: mapId, x: ANCHOR.x, y: ANCHOR.y + RECT_H - t, angle: -Math.PI / 2 };
}

function generate(mapId: string, count: number): TrackPoint[] {
  const points: TrackPoint[] = [];
  for (let i = 0; i < count; i += 1) points.push(pointAtDistance(i * STEP_M, mapId));
  return points;
}

export class MappingTrackHistory {
  private current: TrackQueryScenario = { ...DEFAULT_SCENARIO };

  reset(): void {
    this.current = { ...DEFAULT_SCENARIO };
  }

  scenario(): Readonly<TrackQueryScenario> {
    return this.current;
  }

  /** Partial update; unknown/omitted fields keep their current value. */
  setScenario(next: Partial<TrackQueryScenario>): TrackQueryScenario {
    this.current = {
      mode: next.mode ?? this.current.mode,
      delayMs: typeof next.delayMs === 'number' && next.delayMs >= 0 ? next.delayMs : this.current.delayMs,
      errorStatus: typeof next.errorStatus === 'number' && next.errorStatus > 0 ? next.errorStatus : this.current.errorStatus,
      pointCount:
        next.pointCount === null || (typeof next.pointCount === 'number' && next.pointCount >= 0)
          ? next.pointCount
          : this.current.pointCount,
    };
    return this.current;
  }

  /**
   * Returns the track points for a query, after applying the active fault scenario and
   * paging by offset/limit. `mode: 'error'` is handled by the route (it never calls this).
   */
  query({ mapId, limit, offset }: TrackQueryParams): TrackPoint[] {
    const scenario = this.current;
    if (scenario.mode === 'empty') return [];

    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_POINT_COUNT;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    // Truncation: emit exactly `limit` points after paging so `list.length >= limit`
    // trips the app's `history_truncated` branch (design §8.2).
    const total =
      scenario.mode === 'truncate'
        ? safeOffset + safeLimit
        : scenario.pointCount ?? DEFAULT_POINT_COUNT;

    let points = generate(mapId, total);

    if (scenario.mode === 'map_id_mismatch') {
      // Sprinkle points from a *different* map so the app's map_id filter (design §8.3)
      // has something to drop. Kept at low indices so they survive offset=0 paging.
      points = points.map((p, i) => (i > 0 && i % 5 === 0 ? { ...p, map_id: `${mapId}:other` } : p));
    } else if (scenario.mode === 'non_finite') {
      // Non-finite x/y must be dropped; non-finite angle must only be counted, not dropped
      // (design §8.3 / A3). Inject one of each plus one out-of-engine-range coord.
      points = points.map((p, i) => {
        if (i === 3) return { ...p, x: Number.NaN };
        if (i === 6) return { ...p, y: Number.POSITIVE_INFINITY };
        if (i === 9) return { ...p, x: 1e12 };
        if (i === 12) return { ...p, angle: Number.NaN };
        return p;
      });
    } else if (scenario.mode === 'jump') {
      // One >5 m discontinuity so the app's jump-break sanity (design §8.4) fires.
      points = points.map((p, i) => (i === 20 ? { ...p, x: p.x + 50, y: p.y + 50 } : p));
    }

    return points.slice(safeOffset, safeOffset + safeLimit);
  }
}
