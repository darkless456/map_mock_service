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

function edgeStartPoint(lawnIndex: number): MapLabelPoint {
  return { x: 2 + (lawnIndex - 1) * 12, y: -4 };
}

function aislePoints(lawnIndex: number): MapLabelPoint[] {
  const baseX = (lawnIndex - 1) * 12;
  return [
    { x: baseX, y: 0 },
    { x: baseX + 2, y: -3 },
  ];
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

  addAisle(): void {
    const idx = this.labels.filter(label => label.type === 'aisle').length + 1;
    this.labels.push({ id: `aisle_${idx}`, type: 'aisle', shape: 'point', points: aislePoints(idx) });
  }

  addEdgeStart(): void {
    const idx = this.edgeStartCount() + 1;
    this.labels.push({ id: `edge_start_${idx}`, type: 'edge_start', shape: 'point', points: [edgeStartPoint(idx)] });
  }
}
