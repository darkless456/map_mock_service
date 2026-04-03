'use strict';

/**
 * Binary frame (big-endian length prefix) for MQTT payload:
 *   [0..3]   uint32 BE — JSON metadata UTF-8 byte length (N)
 *   [4..4+N) JSON UTF-8 (no NUL terminator)
 *   [4+N..)  raw PNG bytes
 *
 * @param {Buffer} jsonUtf8
 * @param {Buffer} pngBytes
 * @returns {Buffer}
 */
function buildIncrementFrame(jsonUtf8, pngBytes) {
  const n = jsonUtf8.length;
  const out = Buffer.allocUnsafe(4 + n + pngBytes.length);
  out.writeUInt32BE(n, 0);
  jsonUtf8.copy(out, 4);
  pngBytes.copy(out, 4 + n);
  return out;
}

module.exports = {
  buildIncrementFrame,
};
