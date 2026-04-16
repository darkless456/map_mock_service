const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  HEADER_SIZE,
  HEX_STR_LEN,
  encodeMapHeader,
  decodeMapHeader,
  encodeMapMessage,
} = require('../protocol');

describe('MapHeader encode/decode (新版协议)', () => {
  const sampleFields = {
    version: 1,
    msgType: 0x01,
    dataLen: 6400,
    timestampSec: 1700000000,
    timestampNsec: 500000000,
    width: 40,
    height: 40,
    resolution: 0.05,
    originX: 24.1,
    originY: 24.15,
    sesstionId: 42,
    robotX: 1.5,
    robotY: 2.3,
    robotTheta: 0.785,
    needAck: 1,
  };

  it('should produce a buffer with correct HEADER_SIZE', () => {
    const buf = encodeMapHeader(sampleFields);
    assert.equal(buf.length, HEADER_SIZE);
  });

  it('should NOT have NVMP magic bytes', () => {
    const buf = encodeMapHeader(sampleFields);
    assert.equal(buf[0], 1); // version
    assert.notEqual(buf.toString('ascii', 0, 4), 'NVMP');
  });

  it('should roundtrip encode/decode correctly', () => {
    const buf = encodeMapHeader(sampleFields);
    const decoded = decodeMapHeader(buf);

    assert.equal(decoded.version, 1);
    assert.equal(decoded.msgType, 0x01);
    assert.equal(decoded.dataLen, 6400);
    assert.equal(decoded.timestampSec, 1700000000);
    assert.equal(decoded.timestampNsec, 500000000);
    assert.equal(decoded.width, 40);
    assert.equal(decoded.height, 40);
    assert.ok(Math.abs(decoded.resolution - 0.05) < 1e-6);
    assert.ok(Math.abs(decoded.originX - 24.1) < 1e-4);
    assert.ok(Math.abs(decoded.originY - 24.15) < 1e-4);
    assert.equal(decoded.sesstionId, 42);
    assert.ok(Math.abs(decoded.robotX - 1.5) < 1e-6);
    assert.ok(Math.abs(decoded.robotY - 2.3) < 1e-4);
    assert.ok(Math.abs(decoded.robotTheta - 0.785) < 1e-4);
    assert.equal(decoded.needAck, 1);
  });

  it('should encode origin_x/y as float LE (not u32 mm)', () => {
    const buf = encodeMapHeader(sampleFields);
    const originX = buf.readFloatLE(26);
    const originY = buf.readFloatLE(30);
    assert.ok(Math.abs(originX - 24.1) < 1e-4);
    assert.ok(Math.abs(originY - 24.15) < 1e-4);
  });

  it('should encode robot_x/y/theta as float LE', () => {
    const buf = encodeMapHeader(sampleFields);
    const robotX = buf.readFloatLE(38);
    const robotY = buf.readFloatLE(42);
    const robotTheta = buf.readFloatLE(46);
    assert.ok(Math.abs(robotX - 1.5) < 1e-6);
    assert.ok(Math.abs(robotY - 2.3) < 1e-4);
    assert.ok(Math.abs(robotTheta - 0.785) < 1e-4);
  });

  it('should encode sesstion_id as u32 LE', () => {
    const buf = encodeMapHeader({ ...sampleFields, sesstionId: 0x01020304 });
    assert.equal(buf[34], 0x04);
    assert.equal(buf[35], 0x03);
    assert.equal(buf[36], 0x02);
    assert.equal(buf[37], 0x01);
  });

  it('should encode need_ack as u8', () => {
    const buf0 = encodeMapHeader({ ...sampleFields, needAck: 0 });
    assert.equal(buf0[50], 0);
    const buf1 = encodeMapHeader({ ...sampleFields, needAck: 1 });
    assert.equal(buf1[50], 1);
  });

  it('should use Little-Endian byte order', () => {
    const buf = encodeMapHeader({ ...sampleFields, timestampSec: 0x01020304 });
    assert.equal(buf[6], 0x04);
    assert.equal(buf[7], 0x03);
    assert.equal(buf[8], 0x02);
    assert.equal(buf[9], 0x01);
  });

  it('should reject too-short buffer on decode', () => {
    assert.throws(() => decodeMapHeader(Buffer.alloc(10)), /too short/);
  });
});

describe('encodeMapMessage', () => {
  const sampleFields = {
    version: 1,
    msgType: 0x01,
    timestampSec: 100,
    timestampNsec: 0,
    width: 10,
    height: 10,
    resolution: 0.05,
    originX: 1.0,
    originY: 2.0,
    sesstionId: 1,
    needAck: 1,
  };

  it('should produce JSON with cmd envelope', () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes);
    const parsed = JSON.parse(jsonStr);

    assert.equal(parsed.cmd, 'MAP_INCREMENTAL_PATCH');
    assert.equal(typeof parsed.cmd_id, 'string');
    assert.ok(parsed.data);
    assert.ok(typeof parsed.data.payload === 'string');
  });

  it('should have correct hex header length in data.payload', () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes);
    const parsed = JSON.parse(jsonStr);

    const hexPart = parsed.data.payload.substring(0, HEX_STR_LEN);
    assert.equal(hexPart.length, HEX_STR_LEN);

    const headerBuf = Buffer.from(hexPart, 'hex');
    assert.equal(headerBuf.length, HEADER_SIZE);
  });

  it('should decode hex back to valid header', () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes);
    const parsed = JSON.parse(jsonStr);

    const hexPart = parsed.data.payload.substring(0, HEX_STR_LEN);
    const headerBuf = Buffer.from(hexPart, 'hex');
    const decoded = decodeMapHeader(headerBuf);

    assert.equal(decoded.version, 1);
    assert.equal(decoded.width, 10);
    assert.equal(decoded.height, 10);
    assert.equal(decoded.sesstionId, 1);
  });

  it('should append base64 image after hex header', () => {
    const imageBytes = Buffer.from([1, 2, 3, 4, 5]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes);
    const parsed = JSON.parse(jsonStr);

    const base64Part = parsed.data.payload.substring(HEX_STR_LEN);
    const decoded = Buffer.from(base64Part, 'base64');
    assert.deepEqual(decoded, imageBytes);
  });

  it('should use MAP_INCREMENTAL_PATCH as default cmd', () => {
    const imageBytes = Buffer.from([1, 2, 3]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes);
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.cmd, 'MAP_INCREMENTAL_PATCH');
  });

  it('should support MAP_FIX_PATCH cmd', () => {
    const imageBytes = Buffer.from([1, 2, 3]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes, 'MAP_FIX_PATCH');
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.cmd, 'MAP_FIX_PATCH');
  });

  it('should set data_len to raw image byte count', () => {
    const imageBytes = Buffer.from([1, 2, 3, 4, 5]);
    const jsonStr = encodeMapMessage(sampleFields, imageBytes);
    const parsed = JSON.parse(jsonStr);

    const hexPart = parsed.data.payload.substring(0, HEX_STR_LEN);
    const headerBuf = Buffer.from(hexPart, 'hex');
    const decoded = decodeMapHeader(headerBuf);
    assert.equal(decoded.dataLen, 5);
  });
});
