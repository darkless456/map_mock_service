const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const DATA_DIR = path.resolve(__dirname, '..', '..'); // local_map root
const OUTPUT_FILE = path.resolve(__dirname, '..', 'data', 'frames.json');

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

function parseXmlFile(filePath) {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const parsed = parser.parse(xml);
  const storage = parsed.opencv_storage;
  return {
    timestamp: Math.round(storage.timestamp_ms),
    resolution: storage.resolution,
    origin_x: storage.origin_x,
    origin_y: storage.origin_y,
    map_cols: storage.map_cols,
    map_rows: storage.map_rows,
  };
}

function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.xml'));
  console.log(`Found ${files.length} XML files in ${DATA_DIR}`);

  const frames = [];
  let errors = 0;

  for (const file of files) {
    try {
      const frame = parseXmlFile(path.join(DATA_DIR, file));
      frames.push(frame);
    } catch (err) {
      errors++;
      console.error(`Failed to parse ${file}: ${err.message}`);
    }
  }

  frames.sort((a, b) => a.timestamp - b.timestamp);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(frames, null, 2));

  const tMin = frames[0]?.timestamp;
  const tMax = frames[frames.length - 1]?.timestamp;
  const durationSec = ((tMax - tMin) / 1e6).toFixed(2);

  console.log(`Preprocessed ${frames.length} frames (${errors} errors)`);
  console.log(`Time range: ${tMin} → ${tMax} (${durationSec}s)`);
  console.log(`Output: ${OUTPUT_FILE}`);
}

main();
