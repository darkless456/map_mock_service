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
 * 轨迹**必须逐块草坪走全**：`recoverPassagesFromTrack` 用 `labels.edge_start` 在轨迹上找
 * 邻近簇（ENTER 0.35m / EXIT 0.55m）来切出通道段。早期实现只绕**一块** 8×6 矩形，
 * 第 2 块草坪的 `edge_start`（+30m）从未被走过 → 找不到簇 → 多草坪场景下恢复出的通道恒为 0，
 * 端点吸附与去重都无从验证。现在锚点直接取自调用方传入的 `edgeStarts`（即 labels 里的同一批点），
 * 轨迹与 labels 从构造上就不会漂移。
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
  /**
   * 各块草坪的 `edge_start`（BackendWorld 米），来自 `MappingLabelsTracker`。
   * 传空则退化为单块草坪的旧行为。
   */
  edgeStarts?: readonly LawnAnchor[];
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
/** 走满一圈需要的点数（28m / 0.2m = 140），整除，末点回到锚点。 */
const LOOP_POINTS = Math.round((2 * (RECT_W + RECT_H)) / STEP_M);
/**
 * 多草坪时每块草坪沿边走的点数，**必须是整圈**。
 *
 * 若取 1.8 圈（单草坪默认那样），沿边段会停在离锚点 22m 的地方，
 * 于是「最后一次离开锚点邻域」到「到达下一个锚点」的切片里会混进剩下的 0.8 圈
 * —— 30m 的通道被算成 52m，形状也不是一条转场路径。整圈收尾后切片才等于纯转场段。
 */
const PERIMETER_POINTS = LOOP_POINTS * 2;

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

/** 单块草坪的沿边轨迹，锚点即该草坪的 `edge_start`。 */
function lawnLoop(anchor: LawnAnchor, mapId: string, count: number): TrackPoint[] {
  const dx = anchor.x - ANCHOR.x;
  const dy = anchor.y - ANCHOR.y;
  const points: TrackPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = pointAtDistance(i * STEP_M, mapId);
    points.push({ ...p, x: p.x + dx, y: p.y + dy });
  }
  return points;
}

/**
 * 两块草坪之间的转场直线。**这段就是通道**：
 * `recoverPassagesFromTrack` 取「离开上一个 edge_start 邻域」到「到达下一个邻域」的切片。
 * 步长同样是 `STEP_M`，保证与沿边段一致、不会被当成跳变。
 */
function transit(from: TrackPoint, to: LawnAnchor, mapId: string): TrackPoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / STEP_M));
  const angle = Math.atan2(dy, dx);
  const points: TrackPoint[] = [];
  // 从 1 开始：第 0 步就是 `from` 自身，已经在上一段里了。
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    points.push({ map_id: mapId, x: from.x + dx * t, y: from.y + dy * t, angle });
  }
  return points;
}

export interface LawnAnchor {
  readonly x: number;
  readonly y: number;
}

/**
 * 合成轨迹：逐块草坪「绕一圈 → 转场到下一块」。
 *
 * `anchors` 直接来自 `labels` 的 `edge_start` 点集，因此轨迹**必然**经过每一个
 * `edge_start`（首点即锚点，距离 0），`proximityClusters` 一定能找到簇。
 * `anchors` 为空时退化为原来的单矩形行为（锚点 = `ANCHOR`），保持既有测试不变。
 */
function generate(mapId: string, count: number, anchors: readonly LawnAnchor[]): TrackPoint[] {
  const lawns = anchors.length > 0 ? anchors : [ANCHOR];
  if (lawns.length === 1) {
    return lawnLoop(lawns[0], mapId, count);
  }
  const points: TrackPoint[] = [];
  for (let i = 0; i < lawns.length && points.length < count; i += 1) {
    if (i > 0) {
      const last = points[points.length - 1];
      if (last) points.push(...transit(last, lawns[i], mapId));
    }
    points.push(...lawnLoop(lawns[i], mapId, PERIMETER_POINTS));
  }
  // 点数不足时补走最后一块草坪，避免 `pointCount` 覆盖被无声截断。
  while (points.length < count) {
    const anchor = lawns[lawns.length - 1];
    const extra = lawnLoop(anchor, mapId, count - points.length);
    points.push(...extra);
  }
  return points.slice(0, count);
}

/** 所有相邻锚点间距之和，用于估算转场需要的点数。 */
function spanBetweenAnchors(anchors: readonly LawnAnchor[]): number {
  let total = 0;
  for (let i = 1; i < anchors.length; i += 1) {
    total += Math.hypot(anchors[i].x - anchors[i - 1].x, anchors[i].y - anchors[i - 1].y);
  }
  return total;
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
  query({ mapId, limit, offset, edgeStarts = [] }: TrackQueryParams): TrackPoint[] {
    const scenario = this.current;
    if (scenario.mode === 'empty') return [];

    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_POINT_COUNT;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;

    // Truncation: emit exactly `limit` points after paging so `list.length >= limit`
    // trips the app's `history_truncated` branch (design §8.2).
    // 多草坪时默认点数必须够「每块草坪 1.8 圈 + 各段转场」，否则第 2 块草坪的
    // edge_start 走不到，恢复链路又会退回 `insufficient_edge_starts`。
    const naturalCount =
      edgeStarts.length > 1
        ? edgeStarts.length * PERIMETER_POINTS +
          Math.ceil(spanBetweenAnchors(edgeStarts) / STEP_M)
        : DEFAULT_POINT_COUNT;
    const total =
      scenario.mode === 'truncate'
        ? safeOffset + safeLimit
        : scenario.pointCount ?? Math.max(DEFAULT_POINT_COUNT, naturalCount);

    let points = generate(mapId, total, edgeStarts);

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
