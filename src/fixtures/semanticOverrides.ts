export interface ProtocolPoint {
  readonly x: number;
  readonly y: number;
}

export type ProtocolShape = 'line' | 'polygon' | 'rect' | 'point';
export type ProtocolUnit = 'meter' | 'px' | 'pixel' | '';
/** 标注来源：`robot` 为机器/后端拥有（APP 只读）；`app` 为用户绘制（可编辑）。 */
export type AnnotationSource = 'robot' | 'app';

export interface ProtocolIncrement {
  readonly element_id: string;
  readonly type: number;
  readonly action?: 'add' | 'update' | 'delete';
  readonly shape: ProtocolShape;
  readonly points: readonly ProtocolPoint[];
  readonly properties?: Record<string, unknown>;
  /** 数据来源：随 map/list 下行携带，决定 APP 端可编辑性；semantic/save 不回传。 */
  readonly source?: AnnotationSource;
}

export interface IncrementPackage {
  readonly name?: string;
  readonly area?: number;
  readonly map_id: string;
  readonly base_version: number;
  readonly timestamp: number;
  readonly unit: ProtocolUnit;
  readonly is_use?: boolean;
  readonly increments: readonly ProtocolIncrement[];
}

const runtimeOverrides = new Map<string, IncrementPackage>();

export function getSemanticOverride(mapId: string): IncrementPackage | undefined {
  return runtimeOverrides.get(mapId);
}

export function setSemanticOverride(mapId: string, pkg: IncrementPackage): void {
  runtimeOverrides.set(mapId, pkg);
}

export function deleteSemanticOverride(mapId: string): boolean {
  return runtimeOverrides.delete(mapId);
}

export function listSemanticOverrides(): IncrementPackage[] {
  return [...runtimeOverrides.values()];
}
