/**
 * 通道几何契约回归。
 *
 * 这几条约束跨 `MappingLabels` / `MappingTrackHistory` / `fixtures/datasets`，
 * 任何一处漂移在 App 上都只表现为「通道不显示」或「同一条画了两条」，
 * 几乎无法从 App 日志回溯到 mock —— 所以在这里锁死。
 *
 * 约束来源：
 *  - App `passageEndpointsMatch` 端点容差 0.5m；
 *  - App `recoverPassagesFromTrack`：ENTER 0.35m / EXIT 0.55m / MIN_PATH_LENGTH 0.2m；
 *  - RustKit `passage_engine.rs`：maxSpeedMps 3.0、maxStepM 5.0、MIN_PATH_LEN_M 0.05。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FIXTURE_ROOT } from '../src/fixtures';
import { MappingLabelsTracker } from '../src/sim/MappingLabels';
import { MappingTrackHistory } from '../src/sim/MappingTrackHistory';

const ENTER_RADIUS_M = 0.35;
const EXIT_RADIUS_M = 0.55;
const MIN_PATH_LENGTH_M = 0.2;
const ENDPOINT_TOLERANCE_M = 0.5;
const MAX_SPEED_MPS = 3.0;
const MAX_STEP_M = 5.0;
const PUSH_INTERVAL_S = 0.2;

interface Point {
  x: number;
  y: number;
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 建两块草坪，拿到累积后的 labels。 */
function twoLawnLabels() {
  const tracker = new MappingLabelsTracker();
  tracker.addAisle();
  tracker.addEdgeStart();
  tracker.addAisle();
  tracker.addEdgeStart();
  return tracker.list();
}

function edgeStartsOf(labels: ReturnType<typeof twoLawnLabels>): Point[] {
  return labels
    .filter(label => label.type === 'edge_start')
    .map(label => ({ x: label.points[0].x, y: label.points[0].y }));
}

/** 复刻 App `recoverPassagesFromTrack` 的迟滞邻近簇。 */
function proximityClusters(track: readonly Point[], target: Point) {
  const clusters: Array<{ enter: number; exit: number }> = [];
  let enter: number | null = null;
  for (let i = 0; i < track.length; i += 1) {
    const d = distance(track[i], target);
    if (enter === null && d <= ENTER_RADIUS_M) enter = i;
    else if (enter !== null && d > EXIT_RADIUS_M) {
      clusters.push({ enter, exit: Math.max(enter, i - 1) });
      enter = null;
    }
  }
  if (enter !== null) clusters.push({ enter, exit: track.length - 1 });
  return clusters;
}

function datasetPoses(dataset: string): Point[] {
  const dir = path.join(FIXTURE_ROOT, 'datasets', dataset, 'frames');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.xml')).sort();
  return files.map(name => {
    const xml = fs.readFileSync(path.join(dir, name), 'utf8');
    const tag = (key: string): number => Number(xml.match(new RegExp(`<${key}>([^<]+)</${key}>`))![1]);
    return {
      x: tag('origin_x') + (tag('map_cols') * tag('resolution')) / 2,
      y: tag('origin_y') + (tag('map_rows') * tag('resolution')) / 2,
    };
  });
}

describe('通道几何契约', () => {
  it('aisle 端点与 edge_start 严格重合（App 端点去重 0.5m 容差）', () => {
    const labels = twoLawnLabels();
    const edgeStarts = edgeStartsOf(labels);
    const aisles = labels.filter(label => label.type === 'aisle');

    // aisle_2 = 上一块草坪沿边起点 → 本块草坪沿边起点。
    const second = aisles[1].points;
    assert.equal(distance(second[0], edgeStarts[0]), 0);
    assert.equal(distance(second[second.length - 1], edgeStarts[1]), 0);

    // aisle_1 收尾于第一块草坪的沿边起点。
    const first = aisles[0].points;
    assert.ok(distance(first[first.length - 1], edgeStarts[0]) <= ENDPOINT_TOLERANCE_M);
  });

  it('合成轨迹走过每一块草坪的 edge_start，且能切出转场通道段', () => {
    const edgeStarts = edgeStartsOf(twoLawnLabels());
    assert.equal(edgeStarts.length, 2);
    const track = new MappingTrackHistory().query({
      mapId: 'mock_map_001',
      limit: 20_000,
      offset: 0,
      edgeStarts,
    });

    const ordered = edgeStarts
      .map(point => ({ point, clusters: proximityClusters(track, point) }))
      .sort((a, b) => (a.clusters[0]?.enter ?? Infinity) - (b.clusters[0]?.enter ?? Infinity));

    // 每个锚点都必须被走到，否则 App 侧恒为 insufficient/no_matching_segments。
    for (const entry of ordered) assert.ok(entry.clusters.length > 0, 'edge_start 未被轨迹经过');

    const nextArrival = ordered[1].clusters[0].enter;
    const prior = ordered[0].clusters.filter(cluster => cluster.exit < nextArrival);
    const closure = prior[prior.length - 1];
    assert.ok(closure, '找不到离开上一块草坪的簇');

    const slice = track.slice(closure.exit, nextArrival + 1);
    let length = 0;
    for (let i = 1; i < slice.length; i += 1) length += distance(slice[i], slice[i - 1]);
    assert.ok(length >= MIN_PATH_LENGTH_M, `通道段过短：${length}`);

    // 段长应当接近两锚点直线距离（沿边圈整圈收尾，不把剩余圈算进通道）。
    const span = distance(edgeStarts[0], edgeStarts[1]);
    assert.ok(length <= span * 1.2, `通道段 ${length.toFixed(1)}m 明显长于锚点间距 ${span}m`);
  });

  it('合成轨迹步长不触发 RustKit 连续性判定', () => {
    const edgeStarts = edgeStartsOf(twoLawnLabels());
    const track = new MappingTrackHistory().query({
      mapId: 'mock_map_001',
      limit: 20_000,
      offset: 0,
      edgeStarts,
    });
    for (let i = 1; i < track.length; i += 1) {
      assert.ok(distance(track[i], track[i - 1]) <= MAX_STEP_M);
    }
  });

  it('lawn2_aisle 数据集帧位姿满足 maxSpeedMps / maxStepM', () => {
    const poses = datasetPoses('mapping_lawn2_aisle');
    assert.ok(poses.length > 2);
    let maxStep = 0;
    for (let i = 1; i < poses.length; i += 1) {
      maxStep = Math.max(maxStep, distance(poses[i], poses[i - 1]));
    }
    assert.ok(maxStep <= MAX_STEP_M, `最大步长 ${maxStep} 超 maxStepM`);
    assert.ok(
      maxStep / PUSH_INTERVAL_S <= MAX_SPEED_MPS,
      `最大速度 ${(maxStep / PUSH_INTERVAL_S).toFixed(2)} m/s 超 maxSpeedMps —— ` +
        'App 侧实时通道会被判 PASSAGE_DISCONTINUOUS。重跑 scripts/generate-lawn2-aisle-dataset.mjs。',
    );
  });
});
