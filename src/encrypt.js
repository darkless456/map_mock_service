/**
 * encrypt.js
 *
 * Replicates the React-Native encryptData() logic using Node.js built-in crypto.
 *
 * Encryption steps (matching the mobile client):
 *   1. UTF-8 → hex string  (Buffer.from(message, 'utf8').toString('hex'))
 *   2. RSA-PKCS1 public-key encrypt the hex string bytes
 *   3. base64-encode the ciphertext
 *   4. UTF-8 → hex the base64 string  (finalHex)
 *
 * Usage:
 *   node src/encrypt.js "your message here"
 * or require/import and call encryptData(message).
 */

'use strict';

const crypto = require('node:crypto');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA06HDU4phvspJ7PDXlvgY
p9QhHdLRwj7ylrtkZEKaPk3toURaDEAxcZd5xrAdz0F6lYXJcVXUB0guOYWEpZaj
QsHJAufAro6vWTAAT7O+5b3rR3OHC2CsQzKK7GGu8RAWvb/EoPJaKeKqT0gkTVUQ
Z5Qobqfp1HoIRCztvUM+j8j2t0zvR/dX5BVWFiqPJTxqJpyFEYge5jvGqiV8cz+2
l9mJzUO/OrZhvZfVDq+gbdM92GjbszhK5F/0tngBzhB5YaEKZV64MoCeC0V5LtHW
zKu5VcM7DbwxiyMI+yxx+nAtZMP2yJeMFWpCAgHmUI67n+X4KP//DggePRLuO90q
jwIDAQAB
-----END PUBLIC KEY-----`;

/**
 * @param {string} message - plaintext to encrypt
 * @returns {string} final hex string (matches mobile encryptData output)
 */
function encryptData(message) {
  if (message == null || String(message).length === 0) {
    throw new Error('encryptData: 待加密内容为空');
  }

  // Step 1: UTF-8 bytes → hex string
  const hexPayload = Buffer.from(message, 'utf8').toString('hex');

  // Step 2: RSA PKCS#1 v1.5 public-key encrypt (operating on the hex string's UTF-8 bytes)
  const encryptedBuffer = crypto.publicEncrypt(
    {
      key: PUBLIC_KEY,
      format: 'pem',
      type: 'spki',
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    Buffer.from(hexPayload, 'utf8')
  );

  // Step 3: ciphertext → base64 string
  const baseDataStr = encryptedBuffer.toString('base64');

  // Step 4: base64 string UTF-8 bytes → hex  (finalHex)
  const finalHex = Buffer.from(baseDataStr, 'utf8').toString('hex');

  return finalHex;
}

module.exports = { encryptData };

// CLI usage: node src/encrypt.js "hello"
if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node src/encrypt.js "<message>"');
    process.exit(1);
  }
  try {
    const result = encryptData(input);
    console.log(result);
  } catch (err) {
    console.error('[encryptData] 加密失败:', err.message);
    process.exit(1);
  }
}
