import { buildMapListResponse } from './mapList.fixture';
import {
  setSemanticOverride,
  type IncrementPackage,
  type ProtocolIncrement,
  type ProtocolPoint,
  type ProtocolUnit,
} from './semanticOverrides';
import { resolveMapEditProfile, type MapEditProfile } from './mapEditProfile';

const AREA_BOUNDARY_TYPE = 71;
const EPSILON = 1e-7;

export type TopologyEditResult =
  | {
      readonly ok: true;
      readonly mapId: string;
      readonly baseVersion: number;
      readonly resultAreaId: string;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly message: string;
    };

export function applyTopologyEdit(
  body: Record<string, unknown>,
  profile: MapEditProfile = resolveMapEditProfile(),
): TopologyEditResult {
  const mapId = nonEmptyString(body.map_id);
  const baseVersion = finiteNumber(body.base_version);
  const areas = body.area;
  if (!mapId || baseVersion === null || !Array.isArray(areas) || areas.length !== 1) {
    return failure(400, 'map_id, base_version and exactly one area are required');
  }

  const area = recordValue(areas[0]);
  if (!area) return failure(400, 'area[0] must be an object');
  if (area.action !== 'merge') {
    return failure(422, 'mock topology/edit currently supports merge only');
  }

  const ids = stringArray(area.id);
  if (!ids || ids.length < 3) {
    return failure(400, 'merge id must contain result id and at least two source ids');
  }
  const [resultAreaId, ...sourceAreaIds] = ids;
  if (new Set(ids).size !== ids.length) {
    return failure(400, 'merge area ids must be unique');
  }

  const map = buildMapListResponse('http://map-edit.local', profile).data.items.find(
    item => item.map_id === mapId,
  );
  if (!map) return failure(404, `map ${mapId} not found`);
  if (map.base_version !== baseVersion) {
    return failure(
      409,
      `base_version conflict: expected ${map.base_version}, received ${baseVersion}`,
    );
  }

  const boundaries = map.increments.filter(
    increment =>
      increment.type === AREA_BOUNDARY_TYPE &&
      increment.shape === 'polygon' &&
      increment.action !== 'delete',
  );
  if (boundaries.some(boundary => boundary.element_id === resultAreaId)) {
    return failure(409, `result area ${resultAreaId} already exists`);
  }

  const selected = sourceAreaIds.map(id =>
    boundaries.find(boundary => boundary.element_id === id),
  );
  const missingIndex = selected.findIndex(boundary => boundary === undefined);
  if (missingIndex >= 0) {
    return failure(404, `source area ${sourceAreaIds[missingIndex]} not found`);
  }

  let merged = [...selected[0]!.points];
  for (const boundary of selected.slice(1)) {
    const next = mergeAlongReversedSharedEdge(merged, boundary!.points);
    if (!next) {
      return failure(422, 'selected areas do not share an exact boundary edge');
    }
    merged = next;
  }

  const sourceIdSet = new Set(sourceAreaIds);
  const mergedBoundary: ProtocolIncrement = {
    element_id: resultAreaId,
    type: AREA_BOUNDARY_TYPE,
    action: 'add',
    shape: 'polygon',
    points: merged,
    properties: { area: polygonArea(merged) },
    source: 'robot',
  };
  const nextVersion = map.base_version + 1;
  const pkg: IncrementPackage = {
    ...(typeof map.name === 'string' ? { name: map.name } : {}),
    area: mapAreaAfterMerge(map.increments, sourceIdSet, merged),
    map_id: map.map_id,
    base_version: nextVersion,
    timestamp: Date.now(),
    unit: protocolUnit(body.unit),
    is_use: map.is_use,
    increments: [
      ...map.increments.filter(
        increment =>
          increment.type !== AREA_BOUNDARY_TYPE ||
          !sourceIdSet.has(increment.element_id),
      ),
      mergedBoundary,
    ],
  };
  setSemanticOverride(map.map_id, pkg);

  return {
    ok: true,
    mapId: map.map_id,
    baseVersion: nextVersion,
    resultAreaId,
  };
}

function mergeAlongReversedSharedEdge(
  a: readonly ProtocolPoint[],
  b: readonly ProtocolPoint[],
): ProtocolPoint[] | null {
  for (let aIndex = 0; aIndex < a.length; aIndex += 1) {
    const aNext = (aIndex + 1) % a.length;
    for (let bIndex = 0; bIndex < b.length; bIndex += 1) {
      const bNext = (bIndex + 1) % b.length;
      if (!samePoint(a[aIndex], b[bNext]) || !samePoint(a[aNext], b[bIndex])) {
        continue;
      }

      const aOuter = walkRing(a, aNext, aIndex);
      const bOuter = walkRing(b, bNext, bIndex);
      const combined = [...aOuter, ...bOuter.slice(1)];
      if (samePoint(combined[0], combined[combined.length - 1])) combined.pop();
      return simplifyCollinear(combined);
    }
  }
  return null;
}

function walkRing(
  points: readonly ProtocolPoint[],
  start: number,
  end: number,
): ProtocolPoint[] {
  const result: ProtocolPoint[] = [];
  let index = start;
  for (;;) {
    result.push(points[index]);
    if (index === end) return result;
    index = (index + 1) % points.length;
  }
}

function simplifyCollinear(points: readonly ProtocolPoint[]): ProtocolPoint[] {
  let result = [...points];
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const current = result[index];
      const next = result[(index + 1) % result.length];
      if (Math.abs(cross(previous, current, next)) <= EPSILON) {
        result = result.filter((_, candidate) => candidate !== index);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function polygonArea(points: readonly ProtocolPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    twiceArea += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(twiceArea) / 2;
}

function mapAreaAfterMerge(
  increments: readonly ProtocolIncrement[],
  sourceIds: ReadonlySet<string>,
  merged: readonly ProtocolPoint[],
): number {
  return increments
    .filter(
      increment =>
        increment.type === AREA_BOUNDARY_TYPE &&
        increment.shape === 'polygon' &&
        increment.action !== 'delete' &&
        !sourceIds.has(increment.element_id),
    )
    .reduce((sum, increment) => sum + polygonArea(increment.points), polygonArea(merged));
}

function samePoint(a: ProtocolPoint, b: ProtocolPoint): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function cross(a: ProtocolPoint, b: ProtocolPoint, c: ProtocolPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function protocolUnit(value: unknown): ProtocolUnit {
  return value === 'px' || value === 'pixel' || value === '' ? value : 'meter';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result = value.map(nonEmptyString);
  return result.every((item): item is string => item !== null) ? result : null;
}

function failure(status: number, message: string): TopologyEditResult {
  return { ok: false, status, message };
}
