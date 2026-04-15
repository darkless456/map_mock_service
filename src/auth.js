const jwt = require('jsonwebtoken');

// Mock secret key for JWT signing
const JWT_SECRET = 'mock-map-service-secret-key-2024';
const WS_SIGN_SECRET = 'mock-ws-sign-secret';

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
 * @returns {{ valid: boolean, payload?: object, error?: string }}
 */
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or malformed Authorization header' };
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Generate a WebSocket connection signature.
 * @param {object} payload - JWT decoded payload
 * @returns {{ signature: string, expiresAt: number }}
 */
function generateWsSignature(payload) {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const data = `${payload.userId}:${expiresAt}`;
  // Simple HMAC-like mock signature
  const signature = Buffer.from(
    jwt.sign({ data, exp: expiresAt }, WS_SIGN_SECRET)
  ).toString('base64url');
  return { signature, expiresAt };
}

/**
 * Verify a WebSocket signature from query params.
 * @param {string} signature
 * @returns {{ valid: boolean, error?: string }}
 */
function verifyWsSignature(signature) {
  if (!signature) {
    return { valid: false, error: 'Missing signature' };
  }

  try {
    const token = Buffer.from(signature, 'base64url').toString();
    jwt.verify(token, WS_SIGN_SECRET);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  generateWsSignature,
  verifyWsSignature,
};
