// 自动构造 N 块草坪的 MAP_INCREMENTAL 帧数据集（docs/v4-mapping-api-gap.md B5）。
// 做法：复用 mapping_happy 的真实帧序列作为单块草坪模板，整体平移坐标后重复 N 次，
// 每两块草坪之间插入少量"通道"过渡帧（origin 线性插值），拼成一条连续的时间序列。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DATASET = 'mapping_happy';
const OUT_DATASET = 'mapping_multilawn';
const LAWN_COUNT = Number(process.argv[2] ?? 2);
const AISLE_FRAME_COUNT = Number(process.argv[3] ?? 15);
// 抽帧步长：mapTimer 按真实时钟 200ms/帧推进，且只在 MAP_SCAN_BOUNDARY/MAP_FOLLOW_BOUNDARY
// 等"可推流 phase"期间推进（MAP_BOUNDARY_DONE 等间隙 phase 不推流，见 RobotStatus.ts
// STREAMING_MAPPING_PHASES）。全自动 happy-flow 场景每个 phase 只停留数秒，
// 若每块草坪塞 749 帧真实轨迹，一个 lawn 都放不完场景就结束了。这里对模板帧做
// 抽稀（每 DECIMATE 帧取 1 帧，保留完整轨迹形状，只是采样更稀疏），
// 让单块草坪的帧数与场景实际可用的推流时间预算匹配。
const DECIMATE = Number(process.argv[4] ?? 8);
const LAWN_OFFSET_X_M = 30; // 每块草坪整体平移量（米），避免与前一块在世界坐标里重叠
const LAWN_OFFSET_Y_M = 0;

if (!Number.isInteger(LAWN_COUNT) || LAWN_COUNT < 2) {
  throw new Error(`LAWN_COUNT must be an integer >= 2, got ${LAWN_COUNT}`);
}
if (!Number.isInteger(DECIMATE) || DECIMATE < 1) {
  throw new Error(`DECIMATE must be an integer >= 1, got ${DECIMATE}`);
}

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

function main() {
  const template = loadTemplateFrames();
  const dtMs = (() => {
    const diffs = [];
    for (let i = 1; i < template.length; i += 1) diffs.push(template[i].timestampMs - template[i - 1].timestampMs);
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)]; // median frame interval
  })();

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let outIndex = 0;
  let timestampMs = template[0].timestampMs;
  let prevLastFrame = null;

  for (let lawn = 0; lawn < LAWN_COUNT; lawn += 1) {
    const offsetX = lawn * LAWN_OFFSET_X_M;
    const offsetY = lawn * LAWN_OFFSET_Y_M;
    const lawnFrames = template.map(f => ({ ...f, originX: f.originX + offsetX, originY: f.originY + offsetY }));

    if (lawn > 0 && prevLastFrame) {
      const first = lawnFrames[0];
      for (let step = 1; step <= AISLE_FRAME_COUNT; step += 1) {
        const t = step / (AISLE_FRAME_COUNT + 1);
        const aisleFrame = {
          ...prevLastFrame, // 通道帧图像内容复用上一块草坪的最后一帧（占位，视觉真实性非刚需）
          originX: prevLastFrame.originX + (first.originX - prevLastFrame.originX) * t,
          originY: prevLastFrame.originY + (first.originY - prevLastFrame.originY) * t,
        };
        timestampMs += dtMs;
        writeFrame(outIndex, timestampMs, aisleFrame);
        outIndex += 1;
      }
    }

    for (const frame of lawnFrames) {
      timestampMs += lawn === 0 && outIndex === 0 ? 0 : dtMs;
      writeFrame(outIndex, timestampMs, frame);
      outIndex += 1;
    }
    prevLastFrame = lawnFrames[lawnFrames.length - 1];
  }

  const manifest = {
    name: OUT_DATASET,
    scenario: `建图流程（${LAWN_COUNT} 块草坪，自动生成）`,
    frameCount: outIndex,
    resolution: template[0].resolution,
    world: {
      origin_x: template[0].originX,
      origin_y: template[0].originY,
      cols: template[0].mapCols,
      rows: template[0].mapRows,
    },
    lawnCount: LAWN_COUNT,
    notes: `由 scripts/generate-multilawn-dataset.mjs 从 ${SRC_DATASET} 派生：每块草坪整体平移 (${LAWN_OFFSET_X_M}, ${LAWN_OFFSET_Y_M})m 复用原始帧（按 1/${DECIMATE} 抽稀，每块草坪 ${template.length} 帧），草坪之间插入 ${AISLE_FRAME_COUNT} 帧线性插值的通道过渡帧。图像内容为复用/占位，非真实录制；抽稀是为了让帧数匹配 mapping_happy_auto_multilawn.yaml 场景实际的推流时间预算（mapTimer 200ms/帧 × 可推流 phase 停留时长），否则场景结束前放不完一整块草坪。`,
    compatibleScenarios: ['mapping_happy_auto_multilawn.yaml'],
  };
  fs.writeFileSync(
    path.join(ROOT, 'fixtures', 'datasets', OUT_DATASET, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  console.log(`generated ${outIndex} frames (${LAWN_COUNT} lawns) into fixtures/datasets/${OUT_DATASET}/`);
}

main();
