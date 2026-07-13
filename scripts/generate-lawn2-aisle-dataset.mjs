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
const AISLE_FRAME_COUNT = Number(process.argv[2] ?? 15);
// 抽稀理由与 generate-multilawn-dataset.mjs 相同：mapTimer 200ms/帧，只在可推流 phase 期间
// 推进，749 帧全量对单次 EXPAND_AREA 触发的短流程而言过多。
const DECIMATE = Number(process.argv[3] ?? 8);
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
  for (let step = 1; step <= AISLE_FRAME_COUNT; step += 1) {
    const t = step / (AISLE_FRAME_COUNT + 1);
    const aisleFrame = {
      ...lawn1Exit, // 通道帧图像内容复用占位（视觉真实性非刚需，见规格附录 B）
      originX: lawn1Exit.originX + (lawn2Entry.originX - lawn1Exit.originX) * t,
      originY: lawn1Exit.originY + (lawn2Entry.originY - lawn1Exit.originY) * t,
    };
    writeFrame(outIndex, timestampMs, aisleFrame);
    outIndex += 1;
    timestampMs += dtMs;
  }

  // lawn2 帧：复用 mapping_happy 模板帧，整体平移到网格另一处。
  for (const frame of template) {
    const lawn2Frame = { ...frame, originX: frame.originX + LAWN2_OFFSET_X_M, originY: frame.originY + LAWN2_OFFSET_Y_M };
    writeFrame(outIndex, timestampMs, lawn2Frame);
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
    notes: `由 scripts/generate-lawn2-aisle-dataset.mjs 从 ${SRC_DATASET} 派生：${AISLE_FRAME_COUNT} 帧线性插值通道过渡帧 + 平移 (${LAWN2_OFFSET_X_M}, ${LAWN2_OFFSET_Y_M})m 的第 2 块草坪帧（按 1/${DECIMATE} 抽稀，${template.length} 帧）。图像内容为复用/占位，非真实录制。设计为供 EXPAND_AREA 触发的 mapStream.switchDataset 运行时切入播放，与 mapping_multilawn（静态预加载、跨两块草坪连续播放）用途不同，见 mapping-v4-final-spec.md §7 + 附录 B。`,
    compatibleScenarios: [],
  };
  fs.writeFileSync(
    path.join(ROOT, 'fixtures', 'datasets', OUT_DATASET, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  console.log(`generated ${outIndex} frames (${AISLE_FRAME_COUNT} aisle + ${template.length} lawn2) into fixtures/datasets/${OUT_DATASET}/`);
}

main();
