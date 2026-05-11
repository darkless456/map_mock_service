const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { encodeMapMessage, encodeMapData, isClientFrameAck } = require('../protocol');

// Minimal PNG-like bytes for testing (just the magic bytes)
const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sampleFields = {
  msgType:           2,
  timestampSec:      1700000000,
  timestampNsec:     500000000,
  width:             40,
  height:            40,
  resolution:        0.05,
  originX:           -1.0,
  originY:           -1.0,
  robotX:            0.0,
  robotY:            0.0,
  robotTheta:        0.0,
  mapId:             0,
  frameId:           42,
  frameSlicingTotal: 1,
  frameSlicingId:    42,
  frameSlicingIndex: 0,
};

describe('encodeMapData', () => {
  it('should produce a non-empty base64 string', () => {
    const result = encodeMapData(imageBytes);
    assert.ok(typeof result === 'string' && result.length > 0);
  });

  it('should be reversible via gzip decompress', () => {
    const encoded = encodeMapData(imageBytes);
    const decompressed = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
    assert.deepEqual(decompressed, imageBytes);
  });
});

describe('encodeMapMessage', () => {
  it('should produce valid JSON', () => {
    const result = encodeMapMessage({ sn: 'TEST:SN', headerFields: sampleFields, imageBytes });
    assert.doesNotThrow(() => JSON.parse(result));
  });

  it('should use MAP_INCREMENTAL as default cmd', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'TEST:SN', headerFields: sampleFields, imageBytes }));
    assert.equal(parsed.cmd, 'MAP_INCREMENTAL');
  });

  it('should support MAP_FIX cmd override', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'TEST:SN', headerFields: sampleFields, imageBytes, cmd: 'MAP_FIX' }));
    assert.equal(parsed.cmd, 'MAP_FIX');
  });

  it('should include cmd_id (UUID string) and version', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes }));
    assert.ok(typeof parsed.cmd_id === 'string' && parsed.cmd_id.length > 0);
    assert.ok(parsed.version != null);
  });

  it('should allow cmd_id override', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes, cmdId: 'fixed-id-42' }));
    assert.equal(parsed.cmd_id, 'fixed-id-42');
  });

  it('should include sn in data', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'MOCK:AA:BB', headerFields: sampleFields, imageBytes }));
    assert.equal(parsed.data.sn, 'MOCK:AA:BB');
  });

  it('should include map_header with snake_case field names', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes }));
    const h = parsed.data.map_header;
    assert.ok(h, 'map_header must be present');
    assert.equal(h.msg_type, 2);
    assert.equal(h.width, 40);
    assert.equal(h.height, 40);
    assert.ok(Math.abs(h.resolution - 0.05) < 1e-6);
    assert.ok(Math.abs(h.origin_x - (-1.0)) < 1e-6);
    assert.ok(Math.abs(h.origin_y - (-1.0)) < 1e-6);
    assert.equal(h.frame_id, 42);
    assert.equal(h.frame_slicing_total, 1);
    assert.equal(h.frame_slicing_id, 42);
    assert.equal(h.frame_slicing_index, 0);
    assert.ok(h.timestamp_sec != null, 'timestamp_sec');
    assert.ok(h.timestamp_nsec != null, 'timestamp_nsec');
  });

  it('should include map_data as base64-encoded gzip', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes }));
    const mapData = parsed.data.map_data;
    assert.ok(typeof mapData === 'string');
    const decompressed = zlib.gunzipSync(Buffer.from(mapData, 'base64'));
    assert.deepEqual(decompressed, imageBytes);
  });

  it('should compute crc32 in map_header', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes }));
    assert.ok(typeof parsed.data.map_header.crc32 === 'number');
  });

  it('should default msg_type to 2 when not specified', () => {
    const fieldsNoType = { ...sampleFields };
    delete fieldsNoType.msgType;
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: fieldsNoType, imageBytes }));
    assert.equal(parsed.data.map_header.msg_type, 2);
  });
});

describe('isClientFrameAck', () => {
  it('should recognise a minimal ACK with code=200 and msg="success"', () => {
    const ack = {
      cmd:     'MAP_INCREMENTAL',
      cmd_id:  'abc-123',
      version: 1,
      data:    { code: 200, msg: 'success' },
    };
    assert.ok(isClientFrameAck(ack));
  });

  it('should recognise an ACK that includes optional frame fields', () => {
    const ack = {
      cmd:     'MAP_INCREMENTAL',
      cmd_id:  'abc-123',
      version: 1,
      data:    { code: 200, msg: 'success', frame_id: 42, frame_slicing_id: 42, frame_slicing_index: 0 },
    };
    assert.ok(isClientFrameAck(ack));
  });

  it('should reject old-format ACK with result="SUCCESS"', () => {
    const oldAck = {
      cmd:     'MAP_INCREMENTAL',
      cmd_id:  'abc-123',
      version: 1,
      data:    { result: 'SUCCESS', payload: [{ session: 'abc-123', ack: true, frame_id: 42 }] },
    };
    assert.ok(!isClientFrameAck(oldAck));
  });

  it('should reject a heartbeat message', () => {
    const hb = { cmd: 'heartbeat', cmd_id: 'xyz', data: { code: 200, codeMsg: 'Success', data: {} } };
    assert.ok(!isClientFrameAck(hb));
  });

  it('should reject a ping message', () => {
    const ping = { cmd: 'ping', cmd_id: 'xyz', data: { code: 200, codeMsg: 'Success', data: 'pong' } };
    assert.ok(!isClientFrameAck(ping));
  });

  it('should reject non-200 code', () => {
    const ack = { cmd: 'MAP_INCREMENTAL', cmd_id: 'xyz', data: { code: 400, msg: 'error' } };
    assert.ok(!isClientFrameAck(ack));
  });

  it('should reject null', () => {
    assert.ok(!isClientFrameAck(null));
  });
});
