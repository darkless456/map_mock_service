// auth.js — ticket-based authentication for WebSocket v2 protocol
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET || 'mock-map-service-secret-key-2024';
const TICKET_SECRET = process.env.TICKET_SECRET || 'mock-ticket-secret-2024';

/**
 * Generate a mock JWT token for testing.
 * @param {string} userId
 * @returns {string}
 */
function generateToken(userId = 'test-user') {
  return jwt.sign({ userId, role: 'map_viewer' }, JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Verify a JWT token from Authorization header.
 * @param {string} authHeader - "Bearer <token>"
 * @returns {{ valid: boolean, payload?: object, error?: string, expired?: boolean }}
 */
function verifyJwt(authHeader) {
  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message, expired: err.name === 'TokenExpiredError' };
  }
}

/**
 * Generate a short-lived access ticket signed with TICKET_SECRET.
 * @param {object} jwtPayload - verified JWT payload containing userId
 * @param {number} ttlSec - ticket TTL in seconds (default 120)
 * @returns {{ ticket: string, expire_seconds: number }}
 */
function generateTicket(jwtPayload, ttlSec = 120) {
  const ticketId = uuidv4().replace(/-/g, ''); // 32-char hex string per API docs
  const signed = jwt.sign(
    { ticketId, userId: jwtPayload.userId, sub: 'ws-access' },
    TICKET_SECRET,
    { expiresIn: ttlSec }
  );
  return { ticket: signed, expire_seconds: ttlSec };
}

/**
 * Verify a WS access ticket.
 * @param {string} ticketStr
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
function verifyTicket(ticketStr) {
  if (!ticketStr) {
    return { valid: false, error: 'Missing ticket' };
  }
  try {
    const payload = jwt.verify(ticketStr, TICKET_SECRET);
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyJwt,
  generateTicket,
  verifyTicket,
  verifyToken: verifyJwt, // compat with existing tests
};
