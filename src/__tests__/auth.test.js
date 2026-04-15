const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateToken,
  verifyToken,
  generateWsSignature,
  verifyWsSignature,
} = require('../auth');

describe('JWT auth', () => {
  it('should generate and verify a valid token', () => {
    const token = generateToken('user-123');
    const result = verifyToken(`Bearer ${token}`);
    assert.ok(result.valid);
    assert.equal(result.payload.userId, 'user-123');
    assert.equal(result.payload.role, 'map_viewer');
  });

  it('should reject missing Authorization header', () => {
    const result = verifyToken(undefined);
    assert.ok(!result.valid);
  });

  it('should reject malformed Authorization header', () => {
    const result = verifyToken('Token abc');
    assert.ok(!result.valid);
  });

  it('should reject invalid token', () => {
    const result = verifyToken('Bearer invalid.token.here');
    assert.ok(!result.valid);
  });
});

describe('WebSocket signature', () => {
  it('should generate and verify a valid WS signature', () => {
    const token = generateToken('user-456');
    const tokenResult = verifyToken(`Bearer ${token}`);
    assert.ok(tokenResult.valid);

    const wsSign = generateWsSignature(tokenResult.payload);
    assert.ok(typeof wsSign.signature === 'string');
    assert.ok(wsSign.expiresAt > Math.floor(Date.now() / 1000));

    const verifyResult = verifyWsSignature(wsSign.signature);
    assert.ok(verifyResult.valid);
  });

  it('should reject null signature', () => {
    const result = verifyWsSignature(null);
    assert.ok(!result.valid);
  });

  it('should reject invalid signature', () => {
    const result = verifyWsSignature('not-a-valid-signature');
    assert.ok(!result.valid);
  });
});
