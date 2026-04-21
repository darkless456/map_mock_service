const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const SERVICE_ROOT = path.resolve(__dirname, '..');

/** @type {readonly string[]} */
const ALLOWED_DATASETS = ['data', 'data2'];

/**
 * @param {string} name - directory name under service root (`data` or `data2`)
 * @returns {string | null} absolute path, or null if not allowed
 */
function resolveDatasetDir(name) {
  if (!ALLOWED_DATASETS.includes(name)) return null;
  return path.join(SERVICE_ROOT, name);
}

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
 * Load all map patch data from a dataset directory (`data` or `data2`).
 * Returns sorted by timestamp ascending.
 * @param {string} [dataset='data']
 * @returns {MapPatch[]}
 */
function loadAllPatches(dataset = 'data') {
  const dataDir = resolveDatasetDir(dataset);
  if (!dataDir) return [];
  if (!fs.existsSync(dataDir)) return [];

  const files = fs.readdirSync(dataDir);
  const xmlFiles = files
    .filter((f) => f.endsWith('.xml'))
    .sort();

  const patches = [];

  for (const xmlFile of xmlFiles) {
    const basename = path.basename(xmlFile, '.xml');
    const pngFile = basename + '.png';
    const pngPath = path.join(dataDir, pngFile);

    if (!fs.existsSync(pngPath)) {
      continue;
    }

    const xmlContent = fs.readFileSync(path.join(dataDir, xmlFile), 'utf8');
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
