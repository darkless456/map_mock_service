// MapHeader binary protocol encoder
// Struct layout: 4+1+1+2+4+4+4+4+4+4+4+4+2+2+4 = 48 bytes, Little-Endian
// Note: The spec stated 40 bytes but the actual field sum is 48.

const HEADER_SIZE = 48;
const HEX_STR_LEN = HEADER_SIZE * 2; // 96 hex chars
const MAGIC = Buffer.from('NVMP', 'ascii'); // 0x4E 0x56 0x4D 0x50

/**
 * Encode a MapHeader struct into a 40-byte LE Buffer.
 * @param {object} fields
 * @returns {Buffer} 40-byte buffer
 */
function encodeMapHeader({
  version = 1,
  msgType = 0x01,
  sessionId,
  timestampSec,
  timestampNsec,
  width,
  height,
  originX,
  originY,
  resolution,
  fragTotal = 1,
  fragIndex = 0,
  fragDataLen = 0,
}) {
  const buf = Buffer.alloc(HEADER_SIZE);
  let offset = 0;

  // magic[4]
  MAGIC.copy(buf, offset);
  offset += 4;

  // version (u8)
  buf.writeUInt8(version, offset);
  offset += 1;

  // msg_type (u8)
  buf.writeUInt8(msgType, offset);
  offset += 1;

  // header_len (u16 LE)
  buf.writeUInt16LE(HEADER_SIZE, offset);
  offset += 2;

  // session_id (u32 LE)
  buf.writeUInt32LE(sessionId >>> 0, offset);
  offset += 4;

  // timestamp_sec (u32 LE)
  buf.writeUInt32LE(timestampSec >>> 0, offset);
  offset += 4;

  // timestamp_nsec (u32 LE)
  buf.writeUInt32LE(timestampNsec >>> 0, offset);
  offset += 4;

  // width (u32 LE)
  buf.writeUInt32LE(width >>> 0, offset);
  offset += 4;

  // height (u32 LE)
  buf.writeUInt32LE(height >>> 0, offset);
  offset += 4;

  // origin_x (u32 LE)
  buf.writeUInt32LE(originX >>> 0, offset);
  offset += 4;

  // origin_y (u32 LE)
  buf.writeUInt32LE(originY >>> 0, offset);
  offset += 4;

  // resolution (float32 LE)
  buf.writeFloatLE(resolution, offset);
  offset += 4;

  // frag_total (u16 LE)
  buf.writeUInt16LE(fragTotal, offset);
  offset += 2;

  // frag_index (u16 LE)
  buf.writeUInt16LE(fragIndex, offset);
  offset += 2;

  // frag_data_len (u32 LE)
  buf.writeUInt32LE(fragDataLen >>> 0, offset);
  offset += 4;

  return buf;
}

/**
 * Decode a 40-byte LE Buffer back into a MapHeader object.
 * @param {Buffer} buf
 * @returns {object}
 */
function decodeMapHeader(buf) {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`MapHeader buffer too short: ${buf.length} < ${HEADER_SIZE}`);
  }

  let offset = 0;

  const magic = buf.subarray(offset, offset + 4).toString('ascii');
  offset += 4;

  const version = buf.readUInt8(offset);
  offset += 1;

  const msgType = buf.readUInt8(offset);
  offset += 1;

  const headerLen = buf.readUInt16LE(offset);
  offset += 2;

  const sessionId = buf.readUInt32LE(offset);
  offset += 4;

  const timestampSec = buf.readUInt32LE(offset);
  offset += 4;

  const timestampNsec = buf.readUInt32LE(offset);
  offset += 4;

  const width = buf.readUInt32LE(offset);
  offset += 4;

  const height = buf.readUInt32LE(offset);
  offset += 4;

  const originX = buf.readUInt32LE(offset);
  offset += 4;

  const originY = buf.readUInt32LE(offset);
  offset += 4;

  const resolution = buf.readFloatLE(offset);
  offset += 4;

  const fragTotal = buf.readUInt16LE(offset);
  offset += 2;

  const fragIndex = buf.readUInt16LE(offset);
  offset += 2;

  const fragDataLen = buf.readUInt32LE(offset);
  offset += 4;

  return {
    magic,
    version,
    msgType,
    headerLen,
    sessionId,
    timestampSec,
    timestampNsec,
    width,
    height,
    originX,
    originY,
    resolution,
    fragTotal,
    fragIndex,
    fragDataLen,
  };
}

/**
 * Encode header to hex string and image bytes to base64,
 * then produce the final JSON payload string.
 * @param {object} headerFields - MapHeader fields
 * @param {Buffer} imageBytes - raw image bytes (grayscale PNG pixel data)
 * @param {string} topic - message topic, defaults to map_update
 * @returns {string} JSON string: {"topic":"map_update","payload":"<hex><base64>"}
 */
function encodePayload(headerFields, imageBytes, topic = 'map_update') {
  const base64Data = imageBytes.toString('base64');
  const headerWithDataLen = {
    ...headerFields,
    fragDataLen: Buffer.byteLength(base64Data, 'utf8'),
  };
  const headerBuf = encodeMapHeader(headerWithDataLen);
  const hexStr = headerBuf.toString('hex'); // 40 bytes -> 80 hex chars
  const payload = hexStr + base64Data;

  return JSON.stringify({
    topic,
    payload,
  });
}

/**
 * Fragment image bytes and produce multiple JSON payload strings.
 * @param {object} headerFields - base MapHeader fields (without frag info)
 * @param {Buffer} imageBytes - raw image bytes
 * @param {number} fragTotal - number of fragments
 * @param {string} topic - message topic, defaults to map_update
 * @returns {string[]} array of JSON strings
 */
function encodeFragmentedPayloads(headerFields, imageBytes, fragTotal, topic = 'map_update') {
  if (fragTotal <= 1) {
    return [encodePayload(headerFields, imageBytes, topic)];
  }

  const fragSize = Math.ceil(imageBytes.length / fragTotal);
  const payloads = [];

  for (let i = 0; i < fragTotal; i++) {
    const start = i * fragSize;
    const end = Math.min(start + fragSize, imageBytes.length);
    const fragBytes = imageBytes.subarray(start, end);
    const base64Frag = fragBytes.toString('base64');

    const fragHeaderFields = {
      ...headerFields,
      fragTotal,
      fragIndex: i,
      fragDataLen: Buffer.byteLength(base64Frag, 'utf8'),
    };

    const headerBuf = encodeMapHeader(fragHeaderFields);
    const hexStr = headerBuf.toString('hex');
    const payload = hexStr + base64Frag;

    payloads.push(
      JSON.stringify({
        topic,
        payload,
      })
    );
  }

  return payloads;
}

module.exports = {
  HEADER_SIZE,
  HEX_STR_LEN,
  encodeMapHeader,
  decodeMapHeader,
  encodePayload,
  encodeFragmentedPayloads,
};
