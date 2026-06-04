import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import {
  encodeMapData,
  encodeMapMessage,
  estimateLawnAreaM2,
  isClientFrameAck,
  splitBase64IntoDecodableChunks,
} from '../src/ws/protocol';

const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sampleFields = {
  msgType: 2,
  timestampSec: 1700000000,
  timestampNsec: 500000000,
  width: 40,
  height: 40,
  resolution: 0.05,
  originX: -1,
  originY: -1,
  robotX: 0,
  robotY: 0,
  robotTheta: 0,
  mapId: 0,
  frameId: 42,
  frameSlicingTotal: 1,
  frameSlicingId: 42,
  frameSlicingIndex: 0,
};

describe('encodeMapData', () => {
  it('is reversible gzip+base64', () => {
    const encoded = encodeMapData(imageBytes);
    const decompressed = zlib.gunzipSync(Buffer.from(encoded, 'base64'));
    assert.deepEqual(decompressed, imageBytes);
  });

  it('splits base64 only on decodable chunk boundaries', () => {
    const encoded = encodeMapData(Buffer.from('mock incremental frame payload'));
    const chunks = splitBase64IntoDecodableChunks(encoded, 7);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.slice(0, -1).every(chunk => chunk.length % 4 === 0));
    const compressed = Buffer.concat(chunks.map(chunk => Buffer.from(chunk, 'base64')));
    assert.equal(zlib.gunzipSync(compressed).toString(), 'mock incremental frame payload');
  });
});

describe('encodeMapMessage', () => {
  it('produces a protocol v2 MAP_INCREMENTAL envelope', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes }));
    assert.equal(parsed.cmd, 'MAP_INCREMENTAL');
    assert.equal(parsed.version, 1);
    assert.equal(parsed.data.sn, 'SN');
    assert.equal(parsed.data.map_header.msg_type, 2);
    assert.equal(parsed.data.map_header.frame_id, 42);
    assert.equal(typeof parsed.data.map_header.crc32, 'number');
    assert.equal(parsed.data.map_header.lawn_area, estimateLawnAreaM2(40, 40, 0.05));
  });

  it('allows explicit lawn_area override', () => {
    const parsed = JSON.parse(
      encodeMapMessage({
        sn: 'SN',
        headerFields: { ...sampleFields, lawnArea: 20.2 },
        imageBytes,
      }),
    );
    assert.equal(parsed.data.map_header.lawn_area, 20.2);
  });

  it('supports MAP_FIX override', () => {
    const parsed = JSON.parse(encodeMapMessage({ sn: 'SN', headerFields: sampleFields, imageBytes, cmd: 'MAP_FIX' }));
    assert.equal(parsed.cmd, 'MAP_FIX');
  });
});

describe('isClientFrameAck', () => {
  it('recognizes code/msg ACKs and mapbuilder result ACKs', () => {
    assert.equal(isClientFrameAck({ data: { code: 200, msg: 'success' } }), true);
    assert.equal(isClientFrameAck({ data: { code: 200, result: 'SUCCESS' } }), true);
  });

  it('rejects heartbeat and null payloads', () => {
    assert.equal(isClientFrameAck({ cmd: 'heartbeat', data: { code: 200, codeMsg: 'Success' } }), false);
    assert.equal(isClientFrameAck(null), false);
  });
});
