const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const SERVICE_ROOT = path.resolve(__dirname, '..');

/** @type {readonly string[]} */
const ALLOWED_DATASETS = ['data', 'data2', 'data3'];

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
 * @property {number} robotX - robot world-frame x (center of patch tile, metres)
 * @property {number} robotY - robot world-frame y (centre of patch tile, metres)
 * @property {number} robotTheta - robot heading in radians, derived from patch-centre displacement
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

  // Derive robot pose from patch-centre positions.
  // robot position  = centre of each patch tile in world coordinates.
  // robot heading   = direction to the next patch centre; the last patch
  //                   inherits the heading of the second-to-last segment.
  //                   When consecutive centres coincide the previous theta is
  //                   reused so we never emit NaN.
  let prevTheta = 0;
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    p.robotX = p.originX + p.mapCols * p.resolution / 2;
    p.robotY = p.originY + p.mapRows * p.resolution / 2;

    if (i + 1 < patches.length) {
      const nx = patches[i + 1].originX + patches[i + 1].mapCols * patches[i + 1].resolution / 2;
      const ny = patches[i + 1].originY + patches[i + 1].mapRows * patches[i + 1].resolution / 2;
      const dx = nx - p.robotX;
      const dy = ny - p.robotY;
      if (dx !== 0 || dy !== 0) {
        prevTheta = Math.atan2(dy, dx);
      }
    }
    p.robotTheta = prevTheta;
  }

  return patches;
}

module.exports = { loadAllPatches };
