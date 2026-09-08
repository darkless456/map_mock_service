import { randomUUID } from 'node:crypto';
import polygonClipping, { type Polygon, type MultiPolygon } from 'polygon-clipping';
import { buildMapListResponse } from './mapList.fixture';
import { setSemanticOverride, type ProtocolIncrement, type ProtocolPoint, type ProtocolUnit } from './semanticOverrides';

const EPSILON = 1e-7;

export type TopologyEditResult =
  | { readonly ok: true; readonly mapId: string; readonly baseVersion: number; readonly resultAreaId: string }
  | { readonly ok: false; readonly status: number; readonly message: string };

export function applyTopologyEdit(body: Record<string, unknown>): TopologyEditResult {
  const mapId = nonEmptyString(body.map_id);
  const baseVersion = body.base_version;
  if (!mapId || typeof baseVersion !== 'number' || !Number.isInteger(baseVersion) ||
      !Array.isArray(body.area) || body.area.length !== 1) {
    return failure(400, 'map_id, integer base_version and exactly one area are required');
  }
  const area = recordValue(body.area[0]);
  if (!area) return failure(400, 'area[0] must be an object');
  if (area.action !== 'cut' && area.action !== 'merge') {
    return failure(422, 'supported topology actions are cut and merge');
  }
  const ids = Array.isArray(area.id) ? area.id.map(nonEmptyString) : [];
  if (!ids.every((id): id is string => id !== null) ||
      (area.action === 'cut' ? ids.length !== 1 : ids.length < 3)) {
    return failure(400, 'cut requires one source id; merge requires a result id and at least two source ids');
  }
  if (new Set(ids).size !== ids.length) return failure(400, 'area ids must be unique');
  const map = buildMapListResponse('http://map-edit.local').data.items.find(item => item.map_id === mapId);
  if (!map) return failure(404, `map ${mapId} not found`);
  if (map.base_version !== baseVersion) {
    return failure(409, `base_version conflict: expected ${map.base_version}, received ${baseVersion}`);
  }
  if (body.unit !== undefined && (body.unit || 'meter') !== (map.unit || 'meter')) {
    return failure(400, `unit must match map unit ${map.unit}`);
  }
  const boundaries = map.increments.filter(isBoundary);
  if (area.action === 'merge' && map.increments.some(item => item.element_id === ids[0])) {
    return failure(409, `result area ${ids[0]} already exists`);
  }
  const sourceIds = area.action === 'cut' ? ids : ids.slice(1);
  const selected: ProtocolIncrement[] = [];
  for (const id of sourceIds) {
    const boundary = boundaries.find(item => item.element_id === id);
    if (!boundary) return failure(404, `source area ${id} not found`);
    selected.push(boundary);
  }
  let polygons: MultiPolygon;
  try {
    if (area.action === 'cut') {
      const line = readLine(area.points);
      if (!line) return failure(400, 'cut points must contain two distinct finite coordinates');
      const pieces = cutPolygon(selected[0].points, line);
      if (!pieces) return failure(422, 'cut segment must cross the area from boundary to boundary');
      polygons = pieces;
    } else {
      polygons = polygonClipping.union(toPolygon(selected[0].points), ...selected.slice(1).map(item => toPolygon(item.points)));
      if (polygons.length !== 1) return failure(422, 'selected areas must form one connected polygon');
    }
  } catch {
    return failure(422, 'invalid topology geometry');
  }
  if (polygons.some(polygon => polygon.length !== 1)) {
    return failure(422, 'area boundaries with holes are not supported');
  }
  const replacements: ProtocolIncrement[] = polygons.map(polygon => {
    const points = polygon[0].slice(0, -1).map(([x, y]) => ({ x, y }));
    return {
      element_id: area.action === 'merge' ? ids[0] : randomUUID(),
      type: 71,
      action: 'add',
      shape: 'polygon',
      points,
      properties: { area: polygonArea(points) },
      source: 'robot',
    };
  });
  if (replacements.some(item => polygonArea(item.points) <= EPSILON)) {
    return failure(422, 'topology result contains a degenerate area');
  }
  const sourceIdSet = new Set(sourceIds);
  const increments = [
    ...map.increments.filter(item => !isBoundary(item) || !sourceIdSet.has(item.element_id)),
    ...replacements,
  ];
  const nextVersion = map.base_version + 1;
  setSemanticOverride(mapId, {
    ...(typeof map.name === 'string' ? { name: map.name } : {}),
    area: increments.filter(isBoundary).reduce((sum, item) => sum + polygonArea(item.points), 0),
    map_id: mapId,
    base_version: nextVersion,
    timestamp: Date.now(),
    unit: (map.unit || 'meter') as ProtocolUnit,
    is_use: map.is_use,
    increments,
  });
  return { ok: true, mapId, baseVersion: nextVersion, resultAreaId: replacements[0].element_id };
}

function isBoundary(item: ProtocolIncrement): boolean {
  return item.type === 71 && item.shape === 'polygon' && item.action !== 'delete';
}

function toPolygon(points: readonly ProtocolPoint[]): Polygon {
  return [points.map(point => [point.x, point.y])];
}

function readLine(value: unknown): [ProtocolPoint, ProtocolPoint] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const points: ProtocolPoint[] = [];
  for (const item of value) {
    const point = recordValue(item);
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number' ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    points.push({ x: point.x, y: point.y });
  }
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) > EPSILON
    ? [points[0], points[1]] : null;
}

function cutPolygon(points: readonly ProtocolPoint[], [start, end]: [ProtocolPoint, ProtocolPoint]): MultiPolygon | null {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const dx = (end.x - start.x) / length;
  const dy = (end.y - start.y) / length;
  const extent = Math.max(length, ...points.map(point => Math.hypot(point.x - start.x, point.y - start.y))) * 2 + 1;
  const world = (along: number, normal: number): [number, number] =>
    [start.x + along * dx - normal * dy, start.y + along * dy + normal * dx];
  // These boxes cover the source polygon on either side of the cutting line.
  const halves = [1, -1].map(sign => polygonClipping.intersection(toPolygon(points), [[
    world(-extent, 0), world(extent, 0), world(extent, sign * extent), world(-extent, sign * extent),
  ]]));
  if (halves.some(half => half.length === 0)) return null;
  const pieces = halves.flat();
  // Require the finite App segment to cover every crossing of the boundary.
  for (const polygon of pieces) {
    for (const [x, y] of polygon[0]) {
      const normal = -(x - start.x) * dy + (y - start.y) * dx;
      const along = (x - start.x) * dx + (y - start.y) * dy;
      if (Math.abs(normal) <= EPSILON && (along < -EPSILON || along > length + EPSILON)) return null;
    }
  }
  return pieces;
}

function polygonArea(points: readonly ProtocolPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(twiceArea) / 2;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function failure(status: number, message: string): TopologyEditResult {
  return { ok: false, status, message };
}
