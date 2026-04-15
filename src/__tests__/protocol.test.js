const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  HEADER_SIZE,
  HEX_STR_LEN,
  encodeMapHeader,
  decodeMapHeader,
  encodePayload,
  encodeFragmentedPayloads,
} = require('../protocol');

describe('MapHeader encode/decode', () => {
  const sampleFields = {
    version: 1,
    msgType: 0x01,
    sessionId: 42,
    timestampSec: 1700000000,
    timestampNsec: 500000000,
    width: 40,
    height: 40,
    originX: 24100,
    originY: 24150,
    resolution: 0.05,
    fragTotal: 1,
    fragIndex: 0,
    fragDataLen: 1234,
  };

  it('should produce a 48-byte buffer', () => {
    const buf = encodeMapHeader(sampleFields);
    assert.equal(buf.length, HEADER_SIZE);
    assert.equal(buf.length, 48);
  });

  it('should have correct magic bytes', () => {
    const buf = encodeMapHeader(sampleFields);
    assert.equal(buf.toString('ascii', 0, 4), 'NVMP');
    assert.equal(buf[0], 0x4e);
    assert.equal(buf[1], 0x56);
    assert.equal(buf[2], 0x4d);
    assert.equal(buf[3], 0x50);
  });

  it('should roundtrip encode/decode correctly', () => {
    const buf = encodeMapHeader(sampleFields);
    const decoded = decodeMapHeader(buf);

    assert.equal(decoded.magic, 'NVMP');
    assert.equal(decoded.version, 1);
    assert.equal(decoded.msgType, 0x01);
    assert.equal(decoded.headerLen, 48);
    assert.equal(decoded.sessionId, 42);
    assert.equal(decoded.timestampSec, 1700000000);
    assert.equal(decoded.timestampNsec, 500000000);
    assert.equal(decoded.width, 40);
    assert.equal(decoded.height, 40);
    assert.equal(decoded.originX, 24100);
    assert.equal(decoded.originY, 24150);
    assert.ok(Math.abs(decoded.resolution - 0.05) < 1e-6);
    assert.equal(decoded.fragTotal, 1);
    assert.equal(decoded.fragIndex, 0);
    assert.equal(decoded.fragDataLen, 1234);
  });

  it('should use Little-Endian byte order', () => {
    const buf = encodeMapHeader({ ...sampleFields, sessionId: 0x01020304 });
    // sessionId at offset 8, LE: 04 03 02 01
    assert.equal(buf[8], 0x04);
    assert.equal(buf[9], 0x03);
    assert.equal(buf[10], 0x02);
    assert.equal(buf[11], 0x01);
  });

  it('should reject too-short buffer on decode', () => {
    assert.throws(() => decodeMapHeader(Buffer.alloc(10)), /too short/);
  });
});

describe('encodePayload', () => {
  it('should produce valid JSON with correct structure', () => {
    const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const headerFields = {
      version: 1,
      msgType: 0x01,
      sessionId: 1,
      timestampSec: 100,
      timestampNsec: 0,
      width: 10,
      height: 10,
      originX: 0,
      originY: 0,
      resolution: 0.05,
      fragTotal: 1,
      fragIndex: 0,
    };

    const jsonStr = encodePayload(headerFields, imageBytes);
    const parsed = JSON.parse(jsonStr);

    assert.equal(parsed.topic, 'map_update');
    assert.ok(typeof parsed.payload === 'string');

    // First 96 chars = hex-encoded header (48 bytes)
    const hexPart = parsed.payload.substring(0, HEX_STR_LEN);
    assert.equal(hexPart.length, 96);

    // Decode hex back to buffer and verify magic
    const headerBuf = Buffer.from(hexPart, 'hex');
    assert.equal(headerBuf.length, 48);
    assert.equal(headerBuf.toString('ascii', 0, 4), 'NVMP');

    // Remaining = base64 of imageBytes
    const base64Part = parsed.payload.substring(HEX_STR_LEN);
    const decoded = Buffer.from(base64Part, 'base64');
    assert.deepEqual(decoded, imageBytes);
  });

  it('should set fragDataLen to base64 string length', () => {
    const imageBytes = Buffer.from([1, 2, 3, 4, 5]);
    const headerFields = {
      version: 1,
      msgType: 0x01,
      sessionId: 1,
      timestampSec: 0,
      timestampNsec: 0,
      width: 1,
      height: 1,
      originX: 0,
      originY: 0,
      resolution: 0.05,
    };

    const jsonStr = encodePayload(headerFields, imageBytes);
    const parsed = JSON.parse(jsonStr);
    const hexPart = parsed.payload.substring(0, HEX_STR_LEN);
    const headerBuf = Buffer.from(hexPart, 'hex');
    const decoded = decodeMapHeader(headerBuf);
    const base64Part = parsed.payload.substring(HEX_STR_LEN);

    assert.equal(decoded.fragDataLen, base64Part.length);
  });

  it('should support custom topic name', () => {
    const imageBytes = Buffer.from([1, 2, 3]);
    const headerFields = {
      version: 1,
      msgType: 0x02,
      sessionId: 1,
      timestampSec: 0,
      timestampNsec: 0,
      width: 1,
      height: 1,
      originX: 0,
      originY: 0,
      resolution: 0.05,
    };

    const jsonStr = encodePayload(headerFields, imageBytes, 'map_fix');
    const parsed = JSON.parse(jsonStr);
    assert.equal(parsed.topic, 'map_fix');
  });
});

describe('encodeFragmentedPayloads', () => {
  const headerFields = {
    version: 1,
    msgType: 0x01,
    sessionId: 99,
    timestampSec: 200,
    timestampNsec: 0,
    width: 4,
    height: 4,
    originX: 0,
    originY: 0,
    resolution: 0.05,
  };

  it('should produce single payload when fragTotal=1', () => {
    const imageBytes = Buffer.from([10, 20, 30, 40]);
    const payloads = encodeFragmentedPayloads(headerFields, imageBytes, 1);

    assert.equal(payloads.length, 1);
    const parsed = JSON.parse(payloads[0]);
    const hexPart = parsed.payload.substring(0, HEX_STR_LEN);
    const header = decodeMapHeader(Buffer.from(hexPart, 'hex'));
    assert.equal(header.fragTotal, 1);
    assert.equal(header.fragIndex, 0);
  });

  it('should split into correct number of fragments', () => {
    // 16 bytes, split into 4 fragments
    const imageBytes = Buffer.alloc(16, 0xab);
    const payloads = encodeFragmentedPayloads(headerFields, imageBytes, 4);

    assert.equal(payloads.length, 4);

    for (let i = 0; i < 4; i++) {
      const parsed = JSON.parse(payloads[i]);
      const hexPart = parsed.payload.substring(0, HEX_STR_LEN);
      const header = decodeMapHeader(Buffer.from(hexPart, 'hex'));
      assert.equal(header.fragTotal, 4);
      assert.equal(header.fragIndex, i);
      assert.equal(header.sessionId, 99);
    }
  });

  it('should reassemble fragments back to original data', () => {
    const imageBytes = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const payloads = encodeFragmentedPayloads(headerFields, imageBytes, 3);

    const reassembled = [];
    for (const jsonStr of payloads) {
      const parsed = JSON.parse(jsonStr);
      const base64Part = parsed.payload.substring(HEX_STR_LEN);
      const fragData = Buffer.from(base64Part, 'base64');
      reassembled.push(fragData);
    }

    const combined = Buffer.concat(reassembled);
    assert.deepEqual(combined, imageBytes);
  });
});
