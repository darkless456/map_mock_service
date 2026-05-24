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

// ── Forced slicing (Stage 4 / R3) ────────────────────────────────────────────
//
// When `MMR_SLICE_BYTES` (or the legacy `MAP_MOCK_SLICE_BYTES`) env var is set
// to a positive integer N, the encoder splits the base64 `map_data` payload
// into chunks of N characters and emits one WS message per chunk with
// `frame_slicing_total` / `frame_slicing_index` populated accordingly. This
// lets the POC stage-4 test harness exercise the Rust `frame_assembler` path
// without needing a real upstream that performs server-side slicing.
//
// All other header fields are duplicated verbatim across slices; the `crc32`
// field always carries the checksum of the FULL raw (post-gzip-decode) bytes
// so the assembler can validate reassembly. `data_len` likewise always
// carries the raw byte length, not the per-slice length.
const FORCE_SLICE_BYTES = (() => {
  const raw = process.env.MMR_SLICE_BYTES || process.env.MAP_MOCK_SLICE_BYTES;
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
})();

/**
 * Split a base64 string into chunks of at most `chunkChars` characters.
 * Returned in the original order so concatenation yields the input verbatim.
 * @param {string} b64
 * @param {number} chunkChars
 * @returns {string[]}
 */
function sliceBase64(b64, chunkChars) {
  if (chunkChars <= 0 || b64.length <= chunkChars) return [b64];
  const out = [];
  for (let i = 0; i < b64.length; i += chunkChars) {
    out.push(b64.slice(i, i + chunkChars));
  }
  return out;
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

  const baseHeader = {
    version:             headerFields.version             ?? 1,
    header_len:          36, // fixed as per protocol spec
    data_len:            imageBytes.length,
    msg_type:            headerFields.msgType             ?? 2,
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
    data:    { sn, map_header: baseHeader, map_data: mapData },
  });
}

/**
 * Stage 4 (R3) — encode a single map frame as one OR MORE WS messages.
 *
 * Returns an array of JSON strings, each ready to be `ws.send()`-ed. When
 * the `MMR_SLICE_BYTES` env var is set to a positive integer N, the base64
 * `map_data` payload is split into chunks of N characters and each chunk is
 * emitted as its own message with the appropriate
 * `frame_slicing_total` / `frame_slicing_index` populated. All other header
 * fields (including `crc32` and `data_len`, which always reference the FULL
 * raw post-gzip-decode payload) are duplicated verbatim across slices.
 *
 * Without `MMR_SLICE_BYTES` set, the array always has length 1 — semantically
 * equivalent to `[encodeMapMessage(opts)]`.
 *
 * The Rust `frame_assembler` accepts arbitrary base64 splits because it
 * decodes the concatenated slice payload as one base64 stream after
 * reassembly.
 *
 * @param {object} opts — same shape as `encodeMapMessage`
 * @returns {string[]}
 */
function encodeMapMessageSliced(opts) {
  if (FORCE_SLICE_BYTES <= 0) {
    return [encodeMapMessage(opts)];
  }

  const { sn, headerFields, imageBytes, cmdId, cmd } = opts;
  const callerDeclaredSlicing =
    headerFields.frameSlicingTotal !== undefined ||
    headerFields.frameSlicingIndex !== undefined;
  if (callerDeclaredSlicing) {
    return [encodeMapMessage(opts)];
  }

  const cmdIdStr = cmdId || uuidv4();
  const cmdName = cmd || 'MAP_INCREMENTAL';
  const mapData = encodeMapData(imageBytes);
  const chunks = sliceBase64(mapData, FORCE_SLICE_BYTES);
  if (chunks.length <= 1) {
    return [encodeMapMessage({ ...opts, cmdId: cmdIdStr, cmd: cmdName })];
  }

  const baseHeader = {
    version:             headerFields.version             ?? 1,
    header_len:          36,
    data_len:            imageBytes.length,
    msg_type:            headerFields.msgType             ?? 2,
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
    frame_slicing_id:    headerFields.frameSlicingId      ?? 0,
    crc32:               crc32(imageBytes),
  };

  return chunks.map((chunk, index) => JSON.stringify({
    cmd:     cmdName,
    cmd_id:  cmdIdStr,
    version: 1,
    data: {
      sn,
      map_header: {
        ...baseHeader,
        frame_slicing_total: chunks.length,
        frame_slicing_index: index,
      },
      map_data: chunk,
    },
  }));
}

/**
 * Check whether an incoming WebSocket message from the Rust client is a
 * frame-acknowledgement sent after receiving a MAP_INCREMENTAL (or similar)
 * map frame.
 *
 * The new ACK format sent by the Rust client (as of v1.1.0+) is:
 * ```json
 * {
 *   "cmd":     "<same cmd as received frame>",
 *   "cmd_id":  "<same cmd_id as received frame>",
 *   "version": 1,
 *   "data": {
 *     "code":               200,
 *     "msg":                "success",
 *     "frame_id":           42,      // optional – present when frame had frame_id
 *     "frame_slicing_id":   1,       // optional – present when frame had frame_slicing_id
 *     "frame_slicing_index": 0       // optional – present when frame had frame_slicing_index
 *   }
 * }
 * ```
 *
 * @param {object} msg - Already-parsed JSON message object
 * @returns {boolean}
 */
function isClientFrameAck(msg) {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof msg.data === 'object' &&
    msg.data !== null &&
    msg.data.code === 200 &&
    msg.data.msg === 'success'
  );
}

module.exports = { encodeMapMessage, encodeMapMessageSliced, encodeMapData, isClientFrameAck };
