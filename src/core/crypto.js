// src/core/crypto.js — password/PIN hashing via WebCrypto with FNV fallback.

/** Compute hex SHA-256 of a string. Falls back to FNV-based digest if SubtleCrypto unavailable. */
export async function sha256(str) {
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const data = new TextEncoder().encode(str);
      const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch (_) {
    /* fall through to FNV */
  }
  return fnvDigest(str);
}

function fnvDigest(str) {
  // Eight independent FNV-1a passes over salted inputs → 64 hex chars.
  const pass = (s, seed) => {
    let h = seed >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  let out = '';
  for (let k = 0; k < 8; k++) {
    out += pass(str + '#' + k, (0x811c9dc5 + k * 0x9e3779b1) >>> 0);
  }
  return out;
}

/** Generate a random hex salt. */
export function makeSalt(bytes = 8) {
  const arr = new Uint8Array(bytes);
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < bytes; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash a password with a salt. Returns { salt, hash }. */
export async function hashPw(password, salt = makeSalt()) {
  const hash = await sha256(`${salt}:${password}`);
  return { salt, hash };
}

/** Verify a password against stored { salt, hash }. */
export async function verifyPw(password, salt, hash) {
  const candidate = await sha256(`${salt}:${password}`);
  return candidate === hash;
}

/** Hash a numeric PIN with a salt. Returns { pinSalt, pin }. */
export async function hashPin(pin, pinSalt = makeSalt(4)) {
  const hash = await sha256(`pin:${pinSalt}:${pin}`);
  return { pinSalt, pin: hash };
}

/** Verify a PIN against stored { pinSalt, pin }. */
export async function verifyPin(pin, pinSalt, hash) {
  const candidate = await sha256(`pin:${pinSalt}:${pin}`);
  return candidate === hash;
}
