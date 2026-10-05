const encoder = new TextEncoder();

// Cloudflare Workers' Web Crypto implementation rejects PBKDF2 counts above
// 100,000. Keep the work factor explicit and versioned so it can be raised as
// soon as the runtime supports it or the application adopts a WASM Argon2id.
export const CURRENT_PASSWORD_ITERATIONS = 100000;

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = '';
  input.forEach((b) => (raw += String.fromCharCode(b)));
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Length-independent equality check for two ASCII strings. The salted hashes and
 * HMAC signatures compared with this are fixed length, so the early length check
 * leaks nothing useful while the XOR loop keeps the comparison timing-flat.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function digest(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function passwordHash(value: string, salt: string, iterations = CURRENT_PASSWORD_ITERATIONS): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(value), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(salt), iterations },
    material,
    256
  );
  return base64url(bits);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function fromBase32(value: string): Uint8Array<ArrayBuffer> {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Secret autentikator tidak valid.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(new Uint8Array(output).buffer);
}

async function hotp(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const digestBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digestBytes[digestBytes.length - 1] & 15;
  const value = ((digestBytes[offset] & 127) << 24) | (digestBytes[offset + 1] << 16) |
    (digestBytes[offset + 2] << 8) | digestBytes[offset + 3];
  return String(value % 1000000).padStart(6, '0');
}

export async function verifyTotp(secret: string, code: string, timestamp = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(timestamp / 30000);
  for (const offset of [-1, 0, 1]) if (timingSafeEqual(await hotp(secret, counter + offset), code)) return true;
  return false;
}

export async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt local-only patient identity before it reaches D1. */
export async function encryptSensitive(value: string, secret: string): Promise<string> {
  if (!value) return '';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), encoder.encode(value));
  return `v1.${base64url(iv)}.${base64url(encrypted)}`;
}

/** Decrypt a value written by encryptSensitive. */
export async function decryptSensitive(value: string, secret: string): Promise<string> {
  if (!value) return '';
  const [version, ivText, encryptedText] = value.split('.');
  if (version !== 'v1' || !ivText || !encryptedText) throw new Error('Format data sensitif tidak dikenali.');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(ivText) },
    await aesKey(secret),
    fromBase64url(encryptedText)
  );
  return new TextDecoder().decode(decrypted);
}

/** Keyed fingerprint supports duplicate warnings without exposing the identity. */
export async function sensitiveFingerprint(value: string, secret: string): Promise<string> {
  return value ? hmac(value.toLocaleLowerCase('id-ID').replace(/\s+/g, ' ').trim(), secret) : '';
}

export function randomSalt(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Uniformly random numeric PIN with no modulo bias. Draws a 32-bit value and
 * rejects any that fall in the truncated tail before taking the remainder.
 */
export function randomPin(digits = 8): string {
  const limit = 10 ** digits;
  const ceiling = Math.floor(0xffffffff / limit) * limit;
  const buffer = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(buffer);
    n = buffer[0];
  } while (n >= ceiling);
  return String(n % limit).padStart(digits, '0');
}
