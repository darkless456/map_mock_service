// 构造第 2 块草坪的独立数据集（mapping-v4-final-spec.md §7 + 附录 B）：
// EXPAND_AREA 触发运行时 mapStream.switchDataset('mapping_lawn2_aisle', ...)，从头播放
// 一段"通道过渡帧 + 复用 mapping_happy 的第 2 块草坪帧"，而不是像 mapping_multilawn 那样
// 把两块草坪拼成一条从场景开始就连续播放的时间序列（那是给 mapping_happy_auto_multilawn.yaml
// 静态预加载用的，语义不同，不适合被"运行时切换到一半"复用，见规格审计 G6）。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DATASET = 'mapping_happy';
const OUT_DATASET = 'mapping_lawn2_aisle';
// ⚠️ 帧步长受 RustKit 通道连续性判据约束（passage_engine.rs:692-708）：
//   d / dt > maxSpeedMps(默认 3.0 m/s) → PASSAGE_DISCONTINUOUS
// mapTimer 200ms/帧 ⇒ **每帧位移必须 ≤ 0.6m**，否则 App 侧实时通道采集会在
// appendPassagePose 阶段被判断裂，finalize 时整条通道被丢弃。
//
// 历史值 (15, 8) 下：转场帧 30m/15 = 1.88m/帧 = 9.4 m/s，第 2 块草坪帧 ~0.75m/帧 = 3.7 m/s
// —— 两者都超标。当时 App 传 maxSpeedMps:100 把这道判定关掉了，所以没暴露；
// 端点改造后阈值回到 RustKit 默认，必须让数据集本身物理合理。
//
// 现值：转场 30m/80 = 0.375m/帧 = 1.88 m/s；草坪帧 1/4 抽稀 ≈ 0.37m/帧 = 1.85 m/s。
// 抽稀之外还有一道 `enforceStepLimit` 兜底：源录制本身含个别跳变帧，抽稀改不掉，
// 由它按 MAX_STEP_M 插值补帧，保证**无论源数据如何**输出都满足速度约束。
const AISLE_FRAME_COUNT = Number(process.argv[2] ?? 80);
// 抽稀理由与 generate-multilawn-dataset.mjs 相同：mapTimer 200ms/帧，只在可推流 phase 期间
// 推进，749 帧全量对单次 EXPAND_AREA 触发的短流程而言过多。
// 1/8 会让每帧位移达 0.75m（3.7 m/s）超上限，故收到 1/4。
const DECIMATE = Number(process.argv[3] ?? 4);
const LAWN2_OFFSET_X_M = 30;
const LAWN2_OFFSET_Y_M = 0;

const srcDir = path.join(ROOT, 'fixtures', 'datasets', SRC_DATASET, 'frames');
const outDir = path.join(ROOT, 'fixtures', 'datasets', OUT_DATASET, 'frames');

function readNumberTag(xml, tag, file) {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  if (!match) throw new Error(`${file}: missing <${tag}>`);
  const value = Number(match[1]);
  if (Number.isNaN(value)) throw new Error(`${file}: <${tag}> is not numeric (${match[1]})`);
  return value;
}

function loadTemplateFrames() {
  const xmlFiles = fs.readdirSync(srcDir).filter(f => f.endsWith('.xml')).sort();
  const frames = xmlFiles.map(xmlFile => {
    const basename = path.basename(xmlFile, '.xml');
    const pngPath = path.join(srcDir, `${basename}.png`);
    if (!fs.existsSync(pngPath)) throw new Error(`${xmlFile}: missing paired png`);
    const xml = fs.readFileSync(path.join(srcDir, xmlFile), 'utf8');
    return {
      timestampMs: readNumberTag(xml, 'timestamp_ms', xmlFile),
      resolution: readNumberTag(xml, 'resolution', xmlFile),
      originX: readNumberTag(xml, 'origin_x', xmlFile),
      originY: readNumberTag(xml, 'origin_y', xmlFile),
      mapCols: readNumberTag(xml, 'map_cols', xmlFile),
      mapRows: readNumberTag(xml, 'map_rows', xmlFile),
      pngPath,
    };
  });
  frames.sort((a, b) => a.timestampMs - b.timestampMs);
  return frames.filter((_, i) => i % DECIMATE === 0);
}

function writeFrame(outIndex, timestampMs, frame) {
  const basename = String(outIndex).padStart(4, '0') + '_frame';
  const xml = [
    '<?xml version="1.0"?>',
    '<opencv_storage>',
    `<timestamp_ms>${timestampMs}</timestamp_ms>`,
    `<resolution>${frame.resolution}</resolution>`,
    `<origin_x>${frame.originX}</origin_x>`,
    `<origin_y>${frame.originY}</origin_y>`,
    `<map_cols>${frame.mapCols}</map_cols>`,
    `<map_rows>${frame.mapRows}</map_rows>`,
    '</opencv_storage>',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, `${basename}.xml`), xml);
  fs.copyFileSync(frame.pngPath, path.join(outDir, `${basename}.png`));
}

/**
 * 每帧最大位移（米）。mapTimer 200ms/帧 ⇒ 0.5m/帧 = 2.5 m/s，
 * 相对 RustKit maxSpeedMps 默认 3.0 留 20% 余量。
 */
const MAX_STEP_M = 0.5;

function frameCenter(frame) {
  return {
    x: frame.originX + (frame.mapCols * frame.resolution) / 2,
    y: frame.originY + (frame.mapRows * frame.resolution) / 2,
  };
}

/**
 * 把相邻两帧位移超过 `MAX_STEP_M` 的地方线性插值补帧。
 *
 * 位姿由帧头 origin + cols/rows 推出（见 src/assets/PatchLoader.ts），所以插值 origin
 * 即插值位姿。补出来的帧复用前一帧的 png（本数据集的图像本就是占位，见 manifest.notes）。
 *
 * 不做这一步的话，源录制里的个别跳变帧会让 App 的 `appendPassagePose` 抛
 * PASSAGE_DISCONTINUOUS，整条实时通道在 finalize 时被丢弃。
 */
function enforceStepLimit(frames) {
  const out = [];
  for (let i = 0; i < frames.length; i += 1) {
    if (i === 0) {
      out.push(frames[i]);
      continue;
    }
    const prev = frames[i - 1];
    const curr = frames[i];
    const a = frameCenter(prev);
    const b = frameCenter(curr);
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    const slices = Math.ceil(distance / MAX_STEP_M);
    for (let k = 1; k < slices; k += 1) {
      const t = k / slices;
      out.push({
        ...prev,
        originX: prev.originX + (curr.originX - prev.originX) * t,
        originY: prev.originY + (curr.originY - prev.originY) * t,
      });
    }
    out.push(curr);
  }
  return out;
}

function medianInterval(frames) {
  const diffs = [];
  for (let i = 1; i < frames.length; i += 1) diffs.push(frames[i].timestampMs - frames[i - 1].timestampMs);
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function main() {
  const template = loadTemplateFrames();
  const dtMs = medianInterval(template);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let outIndex = 0;
  let timestampMs = template[0].timestampMs;

  // 通道过渡帧：从 lawn1 出口坐标（模板起点，未平移）线性插值到 lawn2 入口坐标（模板起点 + 偏移）。
  const lawn1Exit = template[0];
  const lawn2Entry = { ...template[0], originX: template[0].originX + LAWN2_OFFSET_X_M, originY: template[0].originY + LAWN2_OFFSET_Y_M };
  const aisleFrames = [];
  for (let step = 1; step <= AISLE_FRAME_COUNT; step += 1) {
    const t = step / (AISLE_FRAME_COUNT + 1);
    aisleFrames.push({
      ...lawn1Exit, // 通道帧图像内容复用占位（视觉真实性非刚需，见规格附录 B）
      originX: lawn1Exit.originX + (lawn2Entry.originX - lawn1Exit.originX) * t,
      originY: lawn1Exit.originY + (lawn2Entry.originY - lawn1Exit.originY) * t,
    });
  }

  // lawn2 帧：复用 mapping_happy 模板帧，整体平移到网格另一处。
  const lawn2Frames = template.map(frame => ({
    ...frame,
    originX: frame.originX + LAWN2_OFFSET_X_M,
    originY: frame.originY + LAWN2_OFFSET_Y_M,
  }));

  // 转场段与草坪段拼成一条连续轨迹后统一限速，接缝处的跳变也一并被补上。
  const emitted = enforceStepLimit([...aisleFrames, ...lawn2Frames]);
  const aisleEmitted = enforceStepLimit(aisleFrames).length;
  for (const frame of emitted) {
    writeFrame(outIndex, timestampMs, frame);
    outIndex += 1;
    timestampMs += dtMs;
  }

  const manifest = {
    name: OUT_DATASET,
    scenario: '第 2 块草坪通道录制 + 建图（EXPAND_AREA 运行时切换，自动生成）',
    frameCount: outIndex,
    resolution: template[0].resolution,
    world: {
      origin_x: lawn2Entry.originX,
      origin_y: lawn2Entry.originY,
      cols: template[0].mapCols,
      rows: template[0].mapRows,
    },
    notes: `由 scripts/generate-lawn2-aisle-dataset.mjs 从 ${SRC_DATASET} 派生：${AISLE_FRAME_COUNT} 帧线性插值通道过渡帧（再经 enforceStepLimit 限速 ≤${MAX_STEP_M}m/帧） + 平移 (${LAWN2_OFFSET_X_M}, ${LAWN2_OFFSET_Y_M})m 的第 2 块草坪帧（按 1/${DECIMATE} 抽稀，${template.length} 帧）。图像内容为复用/占位，非真实录制。设计为供 EXPAND_AREA 触发的 mapStream.switchDataset 运行时切入播放，与 mapping_multilawn（静态预加载、跨两块草坪连续播放）用途不同，见 mapping-v4-final-spec.md §7 + 附录 B。`,
    compatibleScenarios: [],
  };
  fs.writeFileSync(
    path.join(ROOT, 'fixtures', 'datasets', OUT_DATASET, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  console.log(`generated ${outIndex} frames (~${aisleEmitted} aisle + rest lawn2, step<=${MAX_STEP_M}m) into fixtures/datasets/${OUT_DATASET}/`);
}

main();
