// Server-side AES-256-GCM encryption for Yapily consent tokens at rest.
// SECURITY: YAPILY_TOKEN_ENC_KEY is a Vercel server env var — never in the client.
// Stored format: "ENC1:<iv_hex>:<authtag_hex>:<ciphertext_hex>" (single TEXT column, no schema change).

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO   = 'aes-256-gcm';
const PREFIX = 'ENC1:';

function getKey() {
  const hex = process.env.YAPILY_TOKEN_ENC_KEY?.trim();
  if (!hex || hex.length !== 64) {
    throw new Error('YAPILY_TOKEN_ENC_KEY must be set to a 64-character hex string (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plaintext) {
  if (!plaintext) throw new Error('encryptToken: plaintext is empty');
  const key    = getKey();
  const iv     = randomBytes(12); // 96-bit IV — GCM recommended size
  const cipher = createCipheriv(ALGO, key, iv);
  const ct     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag(); // 16-byte authentication tag
  return PREFIX + [iv.toString('hex'), tag.toString('hex'), ct.toString('hex')].join(':');
}

export function decryptToken(stored) {
  if (!stored) throw new Error('decryptToken: no token value in DB');
  if (!stored.startsWith(PREFIX)) {
    // Hard failure — plaintext token must never be used; clear the connection and reconnect.
    throw new Error('Token is stored as plaintext — connection must be re-authorised after encryption is deployed');
  }
  const key    = getKey();
  const [ivHex, tagHex, ctHex] = stored.slice(PREFIX.length).split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('decryptToken: malformed ENC1 payload');
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(ctHex, 'hex')) + decipher.final('utf8');
}
