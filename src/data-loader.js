const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const DATA_DIR = path.resolve(__dirname, '../data');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
});

/**
 * @typedef {object} MapPatch
 * @property {string} id - timestamp-based ID (filename)
 * @property {number} timestampMs - timestamp in milliseconds
 * @property {number} resolution - meters per cell
 * @property {number} originX - origin x coordinate (米, 浮点数)
 * @property {number} originY - origin y coordinate (米, 浮点数)
 * @property {number} mapCols - width in cells
 * @property {number} mapRows - height in cells
 * @property {Buffer} imageData - raw PNG file bytes
 */

/**
 * Load all map patch data from the data directory.
 * Returns sorted by timestamp ascending.
 * @returns {MapPatch[]}
 */
function loadAllPatches() {
  const files = fs.readdirSync(DATA_DIR);
  const xmlFiles = files
    .filter((f) => f.endsWith('.xml'))
    .sort();

  const patches = [];

  for (const xmlFile of xmlFiles) {
    const basename = path.basename(xmlFile, '.xml');
    const pngFile = basename + '.png';
    const pngPath = path.join(DATA_DIR, pngFile);

    if (!fs.existsSync(pngPath)) {
      continue;
    }

    const xmlContent = fs.readFileSync(path.join(DATA_DIR, xmlFile), 'utf8');
    const parsed = xmlParser.parse(xmlContent);
    const storage = parsed.opencv_storage;

    if (!storage) {
      continue;
    }

    const imageData = fs.readFileSync(pngPath);

    patches.push({
      id: basename,
      timestampMs: parseFloat(storage.timestamp_ms),
      resolution: parseFloat(storage.resolution),
      originX: parseFloat(storage.origin_x),
      originY: parseFloat(storage.origin_y),
      mapCols: parseInt(storage.map_cols, 10),
      mapRows: parseInt(storage.map_rows, 10),
      imageData,
    });
  }

  patches.sort((a, b) => a.timestampMs - b.timestampMs);
  return patches;
}

module.exports = { loadAllPatches };
