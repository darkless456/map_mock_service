const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateToken, verifyJwt, verifyToken, generateTicket, verifyTicket } = require('../auth');

describe('JWT auth', () => {
  it('should generate and verify a valid token', () => {
    const token = generateToken('user-123');
    const result = verifyJwt(`Bearer ${token}`);
    assert.ok(result.valid);
    assert.equal(result.payload.userId, 'user-123');
    assert.equal(result.payload.role, 'map_viewer');
  });

  it('verifyToken is an alias for verifyJwt', () => {
    const token = generateToken('user-456');
    const r1 = verifyJwt(`Bearer ${token}`);
    const r2 = verifyToken(`Bearer ${token}`);
    assert.equal(r1.valid, r2.valid);
  });

  it('should reject missing Authorization header', () => {
    assert.ok(!verifyJwt(undefined).valid);
  });

  it('should reject malformed Authorization header', () => {
    assert.ok(!verifyJwt('Token abc').valid);
  });

  it('should reject invalid token', () => {
    assert.ok(!verifyJwt('Bearer invalid.token.here').valid);
  });
});

describe('WS ticket', () => {
  it('should generate a ticket and verify it', () => {
    const token = generateToken('user-789');
    const { payload } = verifyJwt(`Bearer ${token}`);
    const { ticket, expire_seconds } = generateTicket(payload);
    assert.ok(typeof ticket === 'string' && ticket.length > 0);
    assert.ok(expire_seconds > 0);
    const result = verifyTicket(ticket);
    assert.ok(result.valid);
  });

  it('should reject null ticket', () => {
    assert.ok(!verifyTicket(null).valid);
  });

  it('should reject invalid ticket', () => {
    assert.ok(!verifyTicket('not-a-valid-ticket').valid);
  });
});

