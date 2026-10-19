// Crypto primitives for the PDF Standard Security Handler: MD5, RC4, AES (JS),
// with WebCrypto used for SHA-2 and bulk AES when available.

export function md5(data) {
  const K = new Int32Array(64), S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const len = data.length;
  const padLen = ((len + 72) >> 6) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(data);
  buf[len] = 0x80;
  const bits = len * 8;
  buf[padLen - 8] = bits & 0xff; buf[padLen - 7] = (bits >>> 8) & 0xff; buf[padLen - 6] = (bits >>> 16) & 0xff; buf[padLen - 5] = (bits >>> 24) & 0xff;
  buf[padLen - 4] = Math.floor(len / 0x20000000) & 0xff;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = buf[off + i * 4] | (buf[off + i * 4 + 1] << 8) | (buf[off + i * 4 + 2] << 16) | (buf[off + i * 4 + 3] << 24);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const tmp = D; D = C; C = B;
      const x = (A + F + K[i] + M[g]) | 0;
      B = (B + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { out[i * 4] = v & 0xff; out[i * 4 + 1] = (v >>> 8) & 0xff; out[i * 4 + 2] = (v >>> 16) & 0xff; out[i * 4 + 3] = (v >>> 24) & 0xff; });
  return out;
}

export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255;
    const t = s[i]; s[i] = s[j]; s[j] = t;
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// ------------------------------------------------------------- AES
const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
(function init() {
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
})();
const xt = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;
const gm = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };

function expandKey(key) {
  const Nk = key.length / 4, Nr = Nk + 6;
  const w = new Uint8Array(16 * (Nr + 1));
  w.set(key);
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % Nk === 0) {
      t = Uint8Array.of(SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]);
      rcon = xt(rcon);
    } else if (Nk > 6 && i % Nk === 4) t = t.map((b) => SBOX[b]);
    for (let k = 0; k < 4; k++) w[i * 4 + k] = w[(i - Nk) * 4 + k] ^ t[k];
  }
  return { w, Nr };
}

function encBlock(st, { w, Nr }) {
  const s = st.slice();
  for (let i = 0; i < 16; i++) s[i] ^= w[i];
  for (let r = 1; r <= Nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    // shift rows
    let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
    if (r !== Nr) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
        s[c * 4] = xt(a0) ^ xt(a1) ^ a1 ^ a2 ^ a3;
        s[c * 4 + 1] = a0 ^ xt(a1) ^ xt(a2) ^ a2 ^ a3;
        s[c * 4 + 2] = a0 ^ a1 ^ xt(a2) ^ xt(a3) ^ a3;
        s[c * 4 + 3] = xt(a0) ^ a0 ^ a1 ^ a2 ^ xt(a3);
      }
    }
    for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
  }
  return s;
}

function decBlock(st, { w, Nr }) {
  const s = st.slice();
  for (let i = 0; i < 16; i++) s[i] ^= w[Nr * 16 + i];
  for (let r = Nr - 1; r >= 0; r--) {
    let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
    t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
    t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
    for (let i = 0; i < 16; i++) s[i] = INV[s[i]];
    for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i];
    if (r !== 0) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3];
        s[c * 4] = gm(a0, 14) ^ gm(a1, 11) ^ gm(a2, 13) ^ gm(a3, 9);
        s[c * 4 + 1] = gm(a0, 9) ^ gm(a1, 14) ^ gm(a2, 11) ^ gm(a3, 13);
        s[c * 4 + 2] = gm(a0, 13) ^ gm(a1, 9) ^ gm(a2, 14) ^ gm(a3, 11);
        s[c * 4 + 3] = gm(a0, 11) ^ gm(a1, 13) ^ gm(a2, 9) ^ gm(a3, 14);
      }
    }
  }
  return s;
}

// CBC without padding handling
export function aesCbcDecryptRaw(key, iv, data) {
  const ks = expandKey(key);
  const out = new Uint8Array(data.length - (data.length % 16));
  let prev = iv;
  for (let o = 0; o + 16 <= data.length; o += 16) {
    const blk = data.subarray(o, o + 16);
    const d = decBlock(blk, ks);
    for (let i = 0; i < 16; i++) out[o + i] = d[i] ^ prev[i];
    prev = blk;
  }
  return out;
}
export function aesCbcEncryptRaw(key, iv, data) {
  const ks = expandKey(key);
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let o = 0; o < data.length; o += 16) {
    const blk = new Uint8Array(16);
    for (let i = 0; i < 16; i++) blk[i] = data[o + i] ^ prev[i];
    prev = encBlock(blk, ks);
    out.set(prev, o);
  }
  return out;
}

const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

export async function sha(bits, data) {
  const s = subtle();
  return new Uint8Array(await s.digest(`SHA-${bits}`, data));
}

// AES-CBC encrypt with no padding (input multiple of 16)
export async function aesCbcEncryptNoPad(key, iv, data) {
  const s = subtle();
  if (s) {
    try {
      const k = await s.importKey('raw', key, 'AES-CBC', false, ['encrypt']);
      const out = new Uint8Array(await s.encrypt({ name: 'AES-CBC', iv }, k, data));
      return out.subarray(0, data.length);
    } catch (e) { /* fall through */ }
  }
  return aesCbcEncryptRaw(key, iv, data);
}

// Decrypt a PDF AES stream/string: first 16 bytes are the IV, PKCS#7 padding.
export function aesPdfDecrypt(key, data) {
  if (data.length < 32 || data.length % 16 !== 0) {
    if (data.length === 16) return new Uint8Array(0);
    if (data.length < 16) return data;
  }
  const iv = data.subarray(0, 16);
  const body = data.subarray(16, 16 + Math.floor((data.length - 16) / 16) * 16);
  const out = aesCbcDecryptRaw(key, iv, body);
  const pad = out[out.length - 1];
  if (pad >= 1 && pad <= 16 && pad <= out.length) {
    let ok = true;
    for (let i = out.length - pad; i < out.length; i++) if (out[i] !== pad) { ok = false; break; }
    if (ok) return out.subarray(0, out.length - pad);
  }
  return out;
}

export async function aesPdfDecryptFast(key, data) {
  const s = subtle();
  if (s && data.length >= 32 && data.length % 16 === 0) {
    try {
      const k = await s.importKey('raw', key, 'AES-CBC', false, ['decrypt']);
      return new Uint8Array(await s.decrypt({ name: 'AES-CBC', iv: data.subarray(0, 16) }, k, data.subarray(16)));
    } catch (e) { /* bad padding etc: JS path */ }
  }
  return aesPdfDecrypt(key, data);
}
