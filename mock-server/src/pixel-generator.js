/**
 * Synthetic pixel data generator for SLAM mock frames.
 *
 * Generates a single-channel occupancy grid that simulates a local map
 * around a moving robot. The pattern evolves with each frame's world-space
 * origin to produce a visually meaningful incremental map.
 *
 * Semantic values follow the same palette as the app:
 *   0   = grass / free space
 *   1   = passable non-grass
 *   70  = channel
 *   250 = lawn boundary
 *   254 = obstacle
 *   205 = unexplored (used as the "unknown" fill in the builder)
 */

const SEED_PRIME_A = 1597;
const SEED_PRIME_B = 51749;
const SEED_PRIME_C = 2741;

function hash(x, y) {
  let h = (x * SEED_PRIME_A) ^ (y * SEED_PRIME_B);
  h = ((h >> 16) ^ h) * SEED_PRIME_C;
  return (h >>> 0) / 0xffffffff;
}

/**
 * Generate a synthetic occupancy grid for one frame.
 *
 * @param {object} frame - Frame metadata from frames.json
 * @param {number} seq   - Sequence index (used for animation)
 * @returns {Buffer}       Single-channel pixel buffer (cols * rows bytes)
 */
function generatePixels(frame, seq) {
  const { map_cols: cols, map_rows: rows, origin_x, origin_y, resolution } = frame;
  const pixels = Buffer.alloc(cols * rows);

  const cx = cols / 2;
  const cy = rows / 2;
  const maxR = Math.min(cols, rows) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c - cx;
      const dy = r - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const worldX = origin_x + c * resolution;
      const worldY = origin_y + r * resolution;

      let value;

      if (dist > maxR - 2) {
        value = 205;
      } else if (dist > maxR - 4) {
        value = 250;
      } else {
        const h = hash(Math.floor(worldX * 20), Math.floor(worldY * 20));

        if (h < 0.06) {
          value = 254;
        } else if (h < 0.10) {
          value = 1;
        } else if (h < 0.13) {
          value = 70;
        } else {
          value = 0;
        }
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
