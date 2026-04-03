'use strict';

const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true,
  parseTrueNumberOnly: false,
});

/**
 * Converts OpenCV FileStorage XML map chunk metadata to a plain JSON object.
 * Adds rotation: 0 when absent (placeholder for future pose).
 *
 * @param {string} xmlText
 * @returns {Record<string, unknown>}
 */
function xmlMapMetaToJson(xmlText) {
  const doc = parser.parse(xmlText);
  const root = doc.opencv_storage;
  if (!root || typeof root !== 'object') {
    throw new Error('Invalid opencv_storage XML');
  }

  const pick = (key) => {
    const v = root[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'object' && v['#text'] !== undefined) return coerceNumber(v['#text']);
    return coerceNumber(v);
  };

  const meta = {
    timestamp_ms: pick('timestamp_ms'),
    resolution: pick('resolution'),
    origin_x: pick('origin_x'),
    origin_y: pick('origin_y'),
    map_cols: pick('map_cols'),
    map_rows: pick('map_rows'),
    rotation: pick('rotation') ?? 0,
  };

  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) {
      throw new Error(`Missing required field in XML: ${k}`);
    }
  }

  return meta;
}

function coerceNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

module.exports = { xmlMapMetaToJson };
