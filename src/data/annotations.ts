import { CHARGING_DOCK_BACKEND_POINT } from './chargingDock';

export interface ProtocolPoint {
  readonly x: number;
  readonly y: number;
}

export type ProtocolShape = 'line' | 'polygon' | 'rect' | 'point';
export type ProtocolUnit = 'meter' | 'px' | 'pixel' | '';
/** 鏍囨敞鏉ユ簮锛歚robot` 鏈哄櫒浜?鍚庣鎷ユ湁锛圓PP 鍙锛夛紱`app` 鐢ㄦ埛缁樺埗锛堝彲缂栬緫锛夈€?*/
export type AnnotationSource = 'robot' | 'app';

export interface ProtocolIncrement {
  readonly element_id: string;
  readonly type: number;
  readonly action?: 'add' | 'update' | 'delete';
  readonly shape: ProtocolShape;
  readonly points: readonly ProtocolPoint[];
  readonly properties?: Record<string, unknown>;
  /** 鏁版嵁鏉ユ簮锛沵ap/list 涓嬭鎼哄甫锛屽喅瀹?APP 绔彲缂栬緫鎬с€俿emantic/save 涓嶅洖浼犮€?*/
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

const store = new Map<string, IncrementPackage>();

store.set('4245b2a8-5394-4259-9a2f-0379c8f82f03', {
  map_id: '4245b2a8-5394-4259-9a2f-0379c8f82f03',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: true,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '2425943b-92b6-43ea-a98a-6ae137741b48', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('7923da82-4803-47e4-b541-782e4ada3a10', {
  map_id: '7923da82-4803-47e4-b541-782e4ada3a10',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '19719b46-9bcd-4713-8bb4-8d1bc59703ae', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('ae277bb2-d99e-4411-b900-4a26af41cfb4', {
  map_id: 'ae277bb2-d99e-4411-b900-4a26af41cfb4',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '67b1b577-837f-4cd5-82e8-40a2cfee6aa8', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('ed01fe3c-d2f1-4429-aec9-81ec4cb736e8', {
  map_id: 'ed01fe3c-d2f1-4429-aec9-81ec4cb736e8',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: 'fa96915f-2962-4c75-8cfe-012b32137f47', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('04377a8f-df99-4630-8883-d967f255f383', {
  map_id: '04377a8f-df99-4630-8883-d967f255f383',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '179ec652-9c72-43bf-91a3-e670a932d8cc', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('cf640c1d-4f1c-4f15-b292-71fbcae50e63', {
  map_id: 'cf640c1d-4f1c-4f15-b292-71fbcae50e63',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: 'e1c05454-65d4-4967-bed8-9e99f4d202bc', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('f755fe0f-5958-4b0a-9fd5-47159ba440de', {
  map_id: 'f755fe0f-5958-4b0a-9fd5-47159ba440de',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: 'bbde93e7-36f7-4fd8-b5f0-7b03727f49a3', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('2a27fcb3-c123-43fe-9653-5b5e31aff895', {
  map_id: '2a27fcb3-c123-43fe-9653-5b5e31aff895',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '7f6ee3e0-fa8d-446b-9012-598180b6db00', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('04e5afc6-085c-4522-956e-a89379515621', {
  map_id: '04e5afc6-085c-4522-956e-a89379515621',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [
    { element_id: '001', type: 99, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '001', type: 98, action: 'add', shape: 'polygon', points: [], properties: {}, source: 'robot' },
    { element_id: '467d7724-3411-46be-87a2-f3bf561d234e', type: 69, action: 'add', shape: 'point', points: [CHARGING_DOCK_BACKEND_POINT], properties: {}, source: 'robot' },
  ],
});

store.set('first_map', {
  map_id: 'first_map',
  base_version: 1,
  timestamp: 0,
  unit: '',
  is_use: false,
  increments: [],
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

