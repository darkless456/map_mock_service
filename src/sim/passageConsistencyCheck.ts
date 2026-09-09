/**
 * 启动期自检：通道相关的 fixture 是否满足 App 侧的几何约束。
 *
 * 通道端点在 App 侧有三条链路会各产出一份，靠 `passageEndpointsMatch`（0.5m 容差）去重；
 * 实时采集的位姿又要过 RustKit 的连续性判据（`passage_engine.rs:692-708`）。
 * 这些约束跨 fixture / dataset / 常量，任何一处漂移都表现为「通道不显示」或「画了两条」
 * ——而且在 App 侧只能看到一条 `insufficient_edge_starts` 之类的日志，极难回溯到 mock。
 *
 * 这里在启动时一次性检出并 warn，不改数据、不阻断启动。
 */
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_ROOT } from '../fixtures';
import { logger } from '../infra/logger';

/** RustKit `default_max_speed_mps`（passage_engine.rs:236）。 */
const MAX_SPEED_MPS = 3.0;
/** RustKit `MAX_STEP_M_DEFAULT`（passage_engine.rs:12）。 */
const MAX_STEP_M = 5.0;
/** App `passageEndpointsMatch` 的端点容差。 */
const ENDPOINT_TOLERANCE_M = 0.5;
/** mapTimer 推流间隔，与 SimulatorDefaults 的 PUSH_INTERVAL_MS 默认值一致。 */
const PUSH_INTERVAL_S = 0.2;

interface Point {
  readonly x: number;
  readonly y: number;
}

function readXmlNumber(xml: string, tag: string): number | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** 帧头位姿的推法与 `src/assets/PatchLoader.ts` 一致：origin + 网格中心。 */
function datasetPoses(dataset: string): Point[] {
  const dir = path.join(FIXTURE_ROOT, 'datasets', dataset, 'frames');
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter(name => name.endsWith('.xml'))
    .sort();
  const poses: Point[] = [];
  for (const name of files) {
    const xml = fs.readFileSync(path.join(dir, name), 'utf8');
    const originX = readXmlNumber(xml, 'origin_x');
    const originY = readXmlNumber(xml, 'origin_y');
    const resolution = readXmlNumber(xml, 'resolution');
    const cols = readXmlNumber(xml, 'map_cols');
    const rows = readXmlNumber(xml, 'map_rows');
    if (
      originX === null || originY === null ||
      resolution === null || cols === null || rows === null
    ) {
      continue;
    }
    poses.push({ x: originX + (cols * resolution) / 2, y: originY + (rows * resolution) / 2 });
  }
  return poses;
}

function checkDatasetSpeed(dataset: string): void {
  const poses = datasetPoses(dataset);
  if (poses.length < 2) return;
  let overSpeed = 0;
  let overStep = 0;
  let maxStep = 0;
  for (let i = 1; i < poses.length; i += 1) {
    const step = Math.hypot(poses[i].x - poses[i - 1].x, poses[i].y - poses[i - 1].y);
    maxStep = Math.max(maxStep, step);
    if (step / PUSH_INTERVAL_S > MAX_SPEED_MPS) overSpeed += 1;
    if (step > MAX_STEP_M) overStep += 1;
  }
  if (overSpeed === 0 && overStep === 0) return;
  logger.warn(
    `[passage-check] dataset ${dataset}: ${overSpeed} 帧超 maxSpeedMps(${MAX_SPEED_MPS})、` +
      `${overStep} 帧超 maxStepM(${MAX_STEP_M})，最大步长 ${maxStep.toFixed(2)}m。` +
      'App 侧实时通道采集会被判 PASSAGE_DISCONTINUOUS，整条通道在 finalize 时被丢弃。' +
      '修法：重跑 scripts/generate-lawn2-aisle-dataset.mjs（内含 enforceStepLimit 限速）。',
  );
}

/** `map/list` 各地图的充电桩（type=69）。地图编辑「添加草坪」拿它当通道起点。 */
function chargingPiles(): Array<{ mapId: string; point: Point }> {
  const file = path.join(FIXTURE_ROOT, 'maps', 'map_list.json');
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    data?: { items?: Array<Record<string, unknown>> };
  };
  const out: Array<{ mapId: string; point: Point }> = [];
  for (const item of parsed.data?.items ?? []) {
    const mapId = typeof item.map_id === 'string' ? item.map_id : '(unknown)';
    const increments = Array.isArray(item.increments) ? item.increments : [];
    for (const increment of increments as Array<Record<string, unknown>>) {
      if (increment.type !== 69) continue;
      const points = Array.isArray(increment.points) ? increment.points : [];
      const first = points[0] as Point | undefined;
      if (first && Number.isFinite(first.x) && Number.isFinite(first.y)) {
        out.push({ mapId, point: first });
      }
    }
  }
  return out;
}

function readLabelAnchor(): Point | null {
  const file = path.join(FIXTURE_ROOT, 'mapping', 'label_coordinates.jsonc');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const parsed = JSON.parse(raw) as { first_lawn?: { edge_start?: Point } };
  const anchor = parsed.first_lawn?.edge_start;
  return anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? anchor : null;
}

/**
 * 地图编辑「添加草坪」的通道 = 充电桩 → 新草坪沿边起点。
 * 静态 `map/list` 的世界系与建图数据集/labels 的世界系目前是**两套**
 * （前者 x∈[-6.5,2.2]，后者锚在 (11.3,7.45)），差 >5m 时该通道的第一段位移就会命中
 * RustKit 的 `maxStepM` 判定，通道直接不成立。
 */
function checkChargingPileFrame(): void {
  const anchor = readLabelAnchor();
  if (!anchor) return;
  const piles = chargingPiles();
  if (piles.length === 0) {
    logger.warn(
      '[passage-check] map_list.json 里没有 type=69 充电桩：' +
        '地图编辑「添加草坪」的通道起点取不到，App 会记 reason=no_charging_pile 并跳过采集。',
    );
    return;
  }
  const nearest = piles
    .map(pile => ({ ...pile, distance: Math.hypot(pile.point.x - anchor.x, pile.point.y - anchor.y) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (nearest.distance <= MAX_STEP_M) return;
  logger.warn(
    `[passage-check] 充电桩与建图 labels 锚点相距 ${nearest.distance.toFixed(1)}m ` +
      `（最近的一张：${nearest.mapId}，桩 ${JSON.stringify(nearest.point)}，锚点 ${JSON.stringify(anchor)}）。` +
      `超过 RustKit maxStepM(${MAX_STEP_M}) —— 地图编辑「添加草坪」场景下，` +
      '通道从桩到第一帧位姿的那一步会被判 PASSAGE_DISCONTINUOUS，通道画不出来。' +
      '根因是 map_list.json 的静态世界系与 fixtures/datasets 的建图世界系不是同一套，' +
      '需要一次坐标系归一（本次未做，见 mower 方案 §八）。',
  );
}

/** `aisle` label 端点必须与 `edge_start` 严格一致，否则 App 侧去重失败、同一条通道画两条。 */
export function checkAisleEndpoints(labels: ReadonlyArray<{
  readonly type: string;
  readonly id: string;
  readonly points: ReadonlyArray<Point>;
}>): void {
  const edgeStarts = labels.filter(label => label.type === 'edge_start');
  const aisles = labels.filter(label => label.type === 'aisle');
  for (let i = 1; i < aisles.length; i += 1) {
    const aisle = aisles[i];
    const from = edgeStarts[i - 1]?.points[0];
    const to = edgeStarts[i]?.points[0];
    const head = aisle.points[0];
    const tail = aisle.points[aisle.points.length - 1];
    if (!from || !to || !head || !tail) continue;
    const dHead = Math.hypot(head.x - from.x, head.y - from.y);
    const dTail = Math.hypot(tail.x - to.x, tail.y - to.y);
    if (dHead <= ENDPOINT_TOLERANCE_M && dTail <= ENDPOINT_TOLERANCE_M) continue;
    logger.warn(
      `[passage-check] ${aisle.id} 端点与 edge_start 相距 ${dHead.toFixed(2)}m / ${dTail.toFixed(2)}m，` +
        `超过 App passageEndpointsMatch 的 ${ENDPOINT_TOLERANCE_M}m 容差：` +
        '实时通道与 labels 通道会去重失败，同一条通道叠着画两条。',
    );
  }
}

/** 启动时跑一次；只 warn，不改数据、不阻断启动。 */
export function runPassageConsistencyCheck(datasets: readonly string[]): void {
  for (const dataset of datasets) checkDatasetSpeed(dataset);
  checkChargingPileFrame();
}
