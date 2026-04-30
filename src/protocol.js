// protocol.js — WebSocket v2 message encoding (JSON + gzip)
//
// New format: JSON envelope with structured map_header and gzip+base64 map_data.
// Old binary 51-byte LE header format is intentionally removed.
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

// ── CRC32 table (pre-computed) ───────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Compress raw bytes with gzip and encode as base64 (new map_data format).
 * @param {Buffer} rawBuffer
 * @returns {string} base64-encoded gzip bytes
 */
function encodeMapData(rawBuffer) {
  const compressed = zlib.gzipSync(rawBuffer);
  return compressed.toString('base64');
}

/**
 * Build a MAP_INCREMENTAL WS message using the v2 JSON protocol.
 * @param {object} opts
 * @param {string} opts.sn            - Robot SN
 * @param {object} opts.headerFields  - map_header fields (see field list below)
 * @param {Buffer}  opts.imageBytes   - Raw image bytes (PNG or grayscale)
 * @param {string} [opts.cmdId]       - Override cmd_id (defaults to new UUID)
 * @param {string} [opts.cmd]         - WS command name (default 'MAP_INCREMENTAL')
 *
 * headerFields keys:
 *   version, msgType, timestampSec, timestampNsec,
 *   width, height, resolution, originX, originY,
 *   robotX, robotY, robotTheta, mapId,
 *   frameId, frameSlicingTotal, frameSlicingId, frameSlicingIndex
 */
function encodeMapMessage({ sn, headerFields, imageBytes, cmdId, cmd }) {
  const cmdIdStr = cmdId || uuidv4();
  const cmdName = cmd || 'MAP_INCREMENTAL';

  const mapHeader = {
    version:             headerFields.version             ?? 1,
    header_len:          36, // fixed as per protocol spec
    data_len:            imageBytes.length,
    msg_type:            headerFields.msgType             ?? 0x01,
    timestamp_sec:       headerFields.timestampSec        ?? Math.floor(Date.now() / 1000),
    timestamp_nsec:      headerFields.timestampNsec       ?? 0,
    width:               headerFields.width,
    height:              headerFields.height,
    resolution:          headerFields.resolution,
    origin_x:            headerFields.originX,
    origin_y:            headerFields.originY,
    robot_x:             headerFields.robotX              ?? 0.0,
    robot_y:             headerFields.robotY              ?? 0.0,
    robot_theta:         headerFields.robotTheta          ?? 0.0,
    format:              'png',
    map_id:              headerFields.mapId               ?? 0,
    frame_id:            headerFields.frameId             ?? 0,
    frame_slicing_total: headerFields.frameSlicingTotal   ?? 1,
    frame_slicing_id:    headerFields.frameSlicingId      ?? 0,
    frame_slicing_index: headerFields.frameSlicingIndex   ?? 0,
    crc32:               crc32(imageBytes),
  };

  const mapData = encodeMapData(imageBytes);

  return JSON.stringify({
    cmd:     cmdName,
    cmd_id:  cmdIdStr,
    version: 1,
    data:    { sn, map_header: mapHeader, map_data: mapData },
  });
}

module.exports = { encodeMapMessage, encodeMapData };
