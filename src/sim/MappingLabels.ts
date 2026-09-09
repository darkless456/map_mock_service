import { fixtureLoader } from '../fixtures';
import { checkAisleEndpoints } from './passageConsistencyCheck';

export interface MapLabelPoint {
  readonly x: number;
  readonly y: number;
}

export interface MapLabel {
  readonly id: string;
  readonly type: 'edge_start' | 'aisle';
  readonly shape: 'point';
  readonly points: readonly MapLabelPoint[];
}

interface LabelCoordinateParameters {
  readonly first_lawn: {
    readonly entry: MapLabelPoint;
    readonly exit_offset: MapLabelPoint;
    readonly edge_start: MapLabelPoint;
  };
  readonly lawn_offset: MapLabelPoint;
}

function coordinateParameters(): LabelCoordinateParameters {
  return fixtureLoader.read('mapping/label_coordinates.jsonc', raw => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('fixtures/mapping/label_coordinates.jsonc must contain an object');
    }
    const value = raw as Record<string, unknown>;
    const firstLawn = value.first_lawn as Record<string, unknown> | undefined;
    const lawnOffset = value.lawn_offset;
    const point = (input: unknown, field: string): MapLabelPoint => {
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error(`fixtures/mapping/label_coordinates.jsonc: ${field} must be a point`);
      }
      const pointValue = input as Record<string, unknown>;
      if (typeof pointValue.x !== 'number' || !Number.isFinite(pointValue.x) ||
          typeof pointValue.y !== 'number' || !Number.isFinite(pointValue.y)) {
        throw new Error(`fixtures/mapping/label_coordinates.jsonc: ${field} must have finite x/y`);
      }
      return { x: pointValue.x, y: pointValue.y };
    };
    if (!firstLawn) throw new Error('fixtures/mapping/label_coordinates.jsonc: first_lawn is required');
    return {
      first_lawn: {
        entry: point(firstLawn.entry, 'first_lawn.entry'),
        exit_offset: point(firstLawn.exit_offset, 'first_lawn.exit_offset'),
        edge_start: point(firstLawn.edge_start, 'first_lawn.edge_start'),
      },
      lawn_offset: point(lawnOffset, 'lawn_offset'),
    };
  });
}

function lawnTranslation(lawnIndex: number, params: LabelCoordinateParameters): MapLabelPoint {
  return {
    x: (lawnIndex - 1) * params.lawn_offset.x,
    y: (lawnIndex - 1) * params.lawn_offset.y,
  };
}

function translate(point: MapLabelPoint, offset: MapLabelPoint): MapLabelPoint {
  return { x: point.x + offset.x, y: point.y + offset.y };
}

function edgeStartPoint(lawnIndex: number, params: LabelCoordinateParameters): MapLabelPoint {
  return translate(params.first_lawn.edge_start, lawnTranslation(lawnIndex, params));
}

/**
 * 通道端点**必须**与 `edge_start` 严格相同。
 *
 * App 侧有三条通道链路会对同一条通道各产出一份，靠 `passageEndpointsMatch`（**0.5m** 容差）
 * 去重：
 *  1. 实时采集 `useMappingPassageCapture` —— 端点取设备下发的沿边起点；
 *  2. `recoverPassagesFromTrack` —— 端点吸附到 `edge_start`；
 *  3. 本函数产出的 `aisle` label（`pickAislePassages`）。
 *
 * 早期实现把 aisle 端点放在 `first_lawn.entry (±exit_offset)` 上，与 `edge_start`
 * 相距 `hypot(1,1)=1.41m` —— **超过 0.5m 容差**，导致同一条通道去重失败、在 App 上叠着画两条。
 * 端点定义变更后（通道起点 = 上一块草坪的沿边起点），这里必须跟着对齐。
 *
 * - `lawnIndex === 1`：桩/入场点 → 第一块草坪沿边起点；
 * - `lawnIndex >= 2`：上一块草坪沿边起点 → 本块草坪沿边起点。
 */
function aislePoints(lawnIndex: number, params: LabelCoordinateParameters): MapLabelPoint[] {
  const current = edgeStartPoint(lawnIndex, params);
  if (lawnIndex === 1) {
    return [translate(params.first_lawn.entry, lawnTranslation(lawnIndex, params)), current];
  }
  return [edgeStartPoint(lawnIndex - 1, params), current];
}

/**
 * mapping-v4-final-spec.md §6: labels are generated dynamically off the current mapping
 * session rather than a static fixture. `edge_start` labels accumulate permanently (one per
 * closed lawn, driving §5 `lawn_count`); `aisle` labels accumulate one per boundary-search
 * (`find_boundary`) entry and are kept for trajectory history.
 */
export class MappingLabelsTracker {
  private readonly labels: MapLabel[] = [];

  reset(): void {
    this.labels.length = 0;
  }

  list(): readonly MapLabel[] {
    return this.labels;
  }

  edgeStartCount(): number {
    return this.labels.filter(label => label.type === 'edge_start').length;
  }

  nextEdgeStartPoint(): MapLabelPoint {
    return edgeStartPoint(this.edgeStartCount() + 1, coordinateParameters());
  }

  addAisle(): void {
    const idx = this.labels.filter(label => label.type === 'aisle').length + 1;
    this.labels.push({ id: `aisle_${idx}`, type: 'aisle', shape: 'point', points: aislePoints(idx, coordinateParameters()) });
  }

  addEdgeStart(): void {
    const idx = this.edgeStartCount() + 1;
    this.labels.push({ id: `edge_start_${idx}`, type: 'edge_start', shape: 'point', points: [edgeStartPoint(idx, coordinateParameters())] });
    // 每闭合一块草坪就复核一次 aisle ↔ edge_start 端点是否仍然重合；
    // 漂了就 warn，避免 App 侧只看到「同一条通道画了两条」这种难回溯的表象。
    checkAisleEndpoints(this.labels);
  }
}
