export interface ProtocolPoint {
  readonly x: number;
  readonly y: number;
}

export type ProtocolShape = 'line' | 'polygon' | 'rect';
export type ProtocolUnit = 'meter' | 'px' | 'pixel' | '';
/** 标注来源：`robot` 机器人/后端拥有（APP 只读）；`app` 用户绘制（可编辑）。 */
export type AnnotationSource = 'robot' | 'app';

export interface ProtocolIncrement {
  readonly element_id: string;
  readonly type: number;
  readonly action?: 'add' | 'update' | 'delete';
  readonly shape: ProtocolShape;
  readonly points: readonly ProtocolPoint[];
  readonly properties?: Record<string, unknown>;
  /** 数据来源；map/list 下行携带，决定 APP 端可编辑性。semantic/save 不回传。 */
  readonly source?: AnnotationSource;
}

export interface IncrementPackage {
  readonly map_id: string;
  readonly base_version: number;
  readonly timestamp: number;
  readonly unit: ProtocolUnit;
  readonly increments: readonly ProtocolIncrement[];
}

const store = new Map<string, IncrementPackage>();

store.set('mock_map_001', {
  map_id: 'mock_map_001',
  base_version: 1,
  timestamp: 1779247395760,
  unit: 'meter',
  increments: [
    {
      element_id: '864e6ed1-add3-4070-84ba-9e63053ab276',
      type: 251,
      shape: 'rect',
      points: [
        { x: 7.082406624693581, y: 10.127967876160502 },
        { x: 11.80295047971377, y: 9.856281353411253 },
        { x: 12.06574135391247, y: 14.422263625189194 },
        { x: 7.345197498892281, y: 14.693950147938443 },
      ],
      properties: {},
      source: 'app',
    },
    {
      element_id: '3af8ca02-4e74-450e-9234-86e33074c6aa',
      type: 201,
      shape: 'polygon',
      points: [
        { x: 13.472582273130064, y: 7.783616016529225 },
        { x: 15.081918702302154, y: 8.999716779920792 },
      ],
      properties: {},
      source: 'app',
    },
    {
      element_id: '0a2821f1-1390-459d-889b-dbe07e9b7ede',
      type: 254,
      shape: 'line',
      points: [
        { x: 13.225205654568143, y: 12.243492783440484 },
        { x: 16.79287552303738, y: 14.918286980523003 },
      ],
      properties: {},
      source: 'app',
    },
    // 充电桩点位：type=69，单点（{x,y}）。协议无原生 point 形状，按 1 点退化 polygon
    // 下发；APP 端 ingestProtocol 通过 KindRegistry 把 type=69 反向迁移为 'point' 渲染。
    // source='robot'：机器人上报、APP 端只读不可编辑。properties.yawRad 可选朝向。
    {
      element_id: 'b2c5b3f0-7a1d-4d2e-9c3a-2f6e8a4d1c90',
      type: 69,
      shape: 'polygon',
      points: [{ x: 16.0, y: 9.0 }],
      properties: { yawRad: 0 },
      source: 'robot',
    },
  ],
});

export function getAnnotationPackage(mapId: string): IncrementPackage | undefined {
  return store.get(mapId);
}

export function setAnnotationPackage(mapId: string, pkg: IncrementPackage): void {
  store.set(mapId, pkg);
}

export function deleteAnnotationPackage(mapId: string): boolean {
  return store.delete(mapId);
}

export function listAnnotationPackages(): IncrementPackage[] {
  return [...store.values()];
}
