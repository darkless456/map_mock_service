import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, verifyJwt, verifyToken, generateTicket, verifyTicket } from '../src/auth/jwt';

describe('JWT auth', () => {
  it('generates and verifies a valid token', () => {
    const token = generateToken('user-123');
    const result = verifyJwt(`Bearer ${token}`);
    assert.equal(result.valid, true);
    assert.equal((result.payload as { userId: string }).userId, 'user-123');
  });

  it('keeps verifyToken as an alias', () => {
    const token = generateToken('user-456');
    assert.equal(verifyToken(`Bearer ${token}`).valid, true);
  });

  it('rejects missing or invalid Authorization', () => {
    assert.equal(verifyJwt(undefined).valid, false);
    assert.equal(verifyJwt('Bearer invalid.token.here').valid, false);
  });
});

describe('WS ticket', () => {
  it('generates a one-time ticket', () => {
    const token = generateToken('user-789');
    const auth = verifyJwt(`Bearer ${token}`);
    const { ticket, expire_seconds } = generateTicket(auth.payload);
    assert.equal(typeof ticket, 'string');
    assert.ok(expire_seconds > 0);
    assert.equal(verifyTicket(ticket).valid, true);
    assert.equal(verifyTicket(ticket).valid, false);
  });

  it('rejects empty and invalid tickets', () => {
    assert.equal(verifyTicket(null).valid, false);
    assert.equal(verifyTicket('not-a-valid-ticket').valid, false);
  });
});
