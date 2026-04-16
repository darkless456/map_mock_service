// MapHeader binary protocol encoder (新版协议)
//
// 新版布局: packed Little-Endian
// 移除: magic "NVMP", header_len, frag_total, frag_index, frag_data_len
// 新增: data_len, robot_x, robot_y, robot_theta, need_ack, sesstion_id
// 变更: origin_x/y 从 u32(mm) 改为 f32(米)
//
// 字段布局 (packed LE):
//   offset 0:  version        u8
//   offset 1:  msg_type       u8    (0x01=灰度, 0x02=语义)
//   offset 2:  data_len       u32   图像数据总字节数
//   offset 6:  timestamp_sec  u32
//   offset 10: timestamp_nsec u32
//   offset 14: width          u32
//   offset 18: height         u32
//   offset 22: resolution     f32
//   offset 26: origin_x       f32   米, 浮点数
//   offset 30: origin_y       f32   米, 浮点数
//   offset 34: sesstion_id    u32   帧唯一 ID
//   offset 38: robot_x        f32   机器人 X (米)
//   offset 42: robot_y        f32   机器人 Y (米)
//   offset 46: robot_theta    f32   机器人朝向 (弧度)
//   offset 50: need_ack       u8    1=需要 ACK
//   total = 51 bytes

const HEADER_SIZE = 51;
const HEX_STR_LEN = HEADER_SIZE * 2; // 102 hex chars

const MSG_TYPE_GRAYSCALE = 0x01;
const MSG_TYPE_SEMANTIC = 0x02;

/**
 * 将 MapHeader 编码为 LE Buffer。
 */
function encodeMapHeader({
  version = 1,
  msgType = MSG_TYPE_GRAYSCALE,
  dataLen = 0,
  timestampSec,
  timestampNsec,
  width,
  height,
  resolution,
  originX,
  originY,
  sesstionId,
  robotX = 0,
  robotY = 0,
  robotTheta = 0,
  needAck = 1,
}) {
  const buf = Buffer.alloc(HEADER_SIZE);
  let offset = 0;

  buf.writeUInt8(version, offset);
  offset += 1;

  buf.writeUInt8(msgType, offset);
  offset += 1;

  buf.writeUInt32LE(dataLen >>> 0, offset);
  offset += 4;

  buf.writeUInt32LE(timestampSec >>> 0, offset);
  offset += 4;

  buf.writeUInt32LE(timestampNsec >>> 0, offset);
  offset += 4;

  buf.writeUInt32LE(width >>> 0, offset);
  offset += 4;

  buf.writeUInt32LE(height >>> 0, offset);
  offset += 4;

  buf.writeFloatLE(resolution, offset);
  offset += 4;

  buf.writeFloatLE(originX, offset);
  offset += 4;

  buf.writeFloatLE(originY, offset);
  offset += 4;

  buf.writeUInt32LE(sesstionId >>> 0, offset);
  offset += 4;

  buf.writeFloatLE(robotX, offset);
  offset += 4;

  buf.writeFloatLE(robotY, offset);
  offset += 4;

  buf.writeFloatLE(robotTheta, offset);
  offset += 4;

  buf.writeUInt8(needAck, offset);
  offset += 1;

  return buf;
}

/**
 * 将 LE Buffer 解码为 MapHeader 对象。
 */
function decodeMapHeader(buf) {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`MapHeader buffer too short: ${buf.length} < ${HEADER_SIZE}`);
  }

  let offset = 0;

  const version = buf.readUInt8(offset);
  offset += 1;

  const msgType = buf.readUInt8(offset);
  offset += 1;

  const dataLen = buf.readUInt32LE(offset);
  offset += 4;

  const timestampSec = buf.readUInt32LE(offset);
  offset += 4;

  const timestampNsec = buf.readUInt32LE(offset);
  offset += 4;

  const width = buf.readUInt32LE(offset);
  offset += 4;

  const height = buf.readUInt32LE(offset);
  offset += 4;

  const resolution = buf.readFloatLE(offset);
  offset += 4;

  const originX = buf.readFloatLE(offset);
  offset += 4;

  const originY = buf.readFloatLE(offset);
  offset += 4;

  const sesstionId = buf.readUInt32LE(offset);
  offset += 4;

  const robotX = buf.readFloatLE(offset);
  offset += 4;

  const robotY = buf.readFloatLE(offset);
  offset += 4;

  const robotTheta = buf.readFloatLE(offset);
  offset += 4;

  const needAck = buf.readUInt8(offset);
  offset += 1;

  return {
    version,
    msgType,
    dataLen,
    timestampSec,
    timestampNsec,
    width,
    height,
    resolution,
    originX,
    originY,
    sesstionId,
    robotX,
    robotY,
    robotTheta,
    needAck,
  };
}

/**
 * 构建 WS 消息：二进制 header hex + base64 image，包裹在 cmd 信封中。
 */
function encodeMapMessage(headerFields, imageBytes, cmd = 'MAP_INCREMENTAL_PATCH') {
  const headerWithDataLen = { ...headerFields, dataLen: imageBytes.length };
  const headerBuf = encodeMapHeader(headerWithDataLen);
  const hexStr = headerBuf.toString('hex');
  const base64Data = imageBytes.toString('base64');
  const payload = hexStr + base64Data;

  return JSON.stringify({
    cmd,
    cmd_id: String(headerFields.sesstionId),
    data: { payload },
  });
}

module.exports = {
  HEADER_SIZE,
  HEX_STR_LEN,
  MSG_TYPE_GRAYSCALE,
  MSG_TYPE_SEMANTIC,
  encodeMapHeader,
  decodeMapHeader,
  encodeMapMessage,
};
