import { fixtureLoader } from '../fixtures';

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

function aislePoints(lawnIndex: number, params: LabelCoordinateParameters): MapLabelPoint[] {
  const currentEntry = translate(params.first_lawn.entry, lawnTranslation(lawnIndex, params));
  if (lawnIndex === 1) {
    return [currentEntry, translate(currentEntry, params.first_lawn.exit_offset)];
  }
  const previousEntry = translate(params.first_lawn.entry, lawnTranslation(lawnIndex - 1, params));
  return [translate(previousEntry, params.first_lawn.exit_offset), currentEntry];
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
  }
}
