/**
 * Synthetic pixel data generator for SLAM mock frames.
 *
 * Layout approximates the product reference: green lawn ring, light-gray
 * center “path”, thin red obstacle ring at the explored edge, unexplored outside.
 *
 * Semantic values (same as app shader):
 *   0   = grass
 *   1   = passable / light gray (center channel)
 *   254 = obstacle (red)
 *   205 = unexplored
 */

/**
 * Generate a synthetic occupancy grid for one frame.
 *
 * @param {object} frame - Frame metadata from frames.json
 * @param {number} seq   - Sequence index (used for animation)
 * @returns {Buffer}       Single-channel pixel buffer (cols * rows bytes)
 */
function generatePixels(frame, seq) {
  const { map_cols: cols, map_rows: rows } = frame;
  const pixels = Buffer.alloc(cols * rows);

  const cx = cols / 2;
  const cy = rows / 2;
  const maxR = Math.min(cols, rows) / 2;
  const pathR = Math.max(2, maxR * 0.38);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c - cx;
      const dy = r - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let value;
      if (dist > maxR - 2) {
        value = 205;
      } else if (dist > maxR - 3) {
        value = 254;
      } else if (dist < pathR) {
        value = 1;
      } else {
        value = 0;
      }

      pixels[r * cols + c] = value;
    }
  }

  return pixels;
}

/**
 * Pack a frame into the binary wire format.
 *
 * Binary layout (Little Endian):
 *   Offset  Size  Type      Field
 *   0       4     uint32    seq
 *   4       8     float64   timestamp
 *   12      4     float32   resolution
 *   16      4     float32   origin_x
 *   20      4     float32   origin_y
 *   24      2     uint16    cols
 *   26      2     uint16    rows
 *   28      N     uint8[]   pixels (N = cols * rows)
 *
 * @param {object} frame  - Frame metadata
 * @param {number} seq    - Sequence index
 * @param {Buffer} pixels - Single-channel pixel data
 * @returns {Buffer}        Complete binary frame
 */
const HEADER_SIZE = 28;

function packBinaryFrame(frame, seq, pixels) {
  const { map_cols: cols, map_rows: rows, timestamp, resolution, origin_x, origin_y } = frame;
  const buf = Buffer.alloc(HEADER_SIZE + cols * rows);

  buf.writeUInt32LE(seq, 0);
  buf.writeDoubleLE(timestamp, 4);
  buf.writeFloatLE(resolution, 12);
  buf.writeFloatLE(origin_x, 16);
  buf.writeFloatLE(origin_y, 20);
  buf.writeUInt16LE(cols, 24);
  buf.writeUInt16LE(rows, 26);

  pixels.copy(buf, HEADER_SIZE);

  return buf;
}

module.exports = { generatePixels, packBinaryFrame, HEADER_SIZE };
