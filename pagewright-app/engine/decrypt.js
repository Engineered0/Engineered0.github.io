// Opens encrypted PDFs (Standard Security Handler, RC4 40/128, AES-128, AES-256)
// by decrypting every object while pdf-lib parses the file, then removing the
// encryption so the document can be edited and saved normally.

import { L, N, dget, nameOf, num, strBytes, enc } from './pdfobj.js';
import { md5, rc4, sha, aesCbcEncryptNoPad, aesCbcDecryptRaw, aesPdfDecrypt, aesPdfDecryptFast } from './crypto.js';

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

const cat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const eq = (a, b, n) => { for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false; return true; };

export class PasswordRequiredError extends Error { constructor(wrong) { super(wrong ? 'Incorrect password' : 'Password required'); this.wrong = wrong; this.name = 'PasswordRequiredError'; } }
export class UnsupportedEncryptionError extends Error { constructor(m) { super(m); this.name = 'UnsupportedEncryptionError'; } }

function padPwd(pwdBytes) {
  const out = new Uint8Array(32);
  const n = Math.min(32, pwdBytes.length);
  out.set(pwdBytes.subarray(0, n));
  out.set(PAD.subarray(0, 32 - n), n);
  return out;
}

function latin1Bytes(s) { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff; return o; }

async function hash2B(pwd, salt, udata, R) {
  let K = await sha(256, cat(pwd, salt, udata));
  if (R === 5) return K;
  for (let i = 0; ; i++) {
    const one = cat(pwd, K, udata);
    const K1 = new Uint8Array(one.length * 64);
    for (let k = 0; k < 64; k++) K1.set(one, k * one.length);
    const E = await aesCbcEncryptNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
    let sum = 0;
    for (let k = 0; k < 16; k++) sum += E[k];
    const m = sum % 3;
    K = await sha(m === 0 ? 256 : m === 1 ? 384 : 512, E);
    if (i >= 63 && E[E.length - 1] <= i - 31) break;
  }
  return K.subarray(0, 32);
}

export async function computeFileKey(encDict, id0, password, ctx) {
  const filter = nameOf(dget(ctx, encDict, 'Filter'));
  if (filter !== 'Standard') throw new UnsupportedEncryptionError(`Unsupported security handler: ${filter}`);
  const V = num(dget(ctx, encDict, 'V'), 0);
  const R = num(dget(ctx, encDict, 'R'), 2);
  const O = strBytes(dget(ctx, encDict, 'O')) || new Uint8Array(32);
  const U = strBytes(dget(ctx, encDict, 'U')) || new Uint8Array(32);
  const P = num(dget(ctx, encDict, 'P'), -1);
  const encMeta = dget(ctx, encDict, 'EncryptMetadata');
  const encryptMetadata = !(encMeta && encMeta.asBoolean && encMeta.asBoolean() === false) && String(encMeta) !== 'false';
  let lengthBits = num(dget(ctx, encDict, 'Length'), 40);
  // crypt filters
  let method = V >= 4 ? 'AESV2' : 'RC4';
  let strMethod = method;
  if (V >= 4) {
    const cf = dget(ctx, encDict, 'CF');
    const stmf = nameOf(dget(ctx, encDict, 'StmF')) || 'Identity';
    const strf = nameOf(dget(ctx, encDict, 'StrF')) || 'Identity';
    const cfm = (name) => {
      if (name === 'Identity') return 'None';
      const d = cf && dget(ctx, cf, name);
      const m = d && nameOf(dget(ctx, d, 'CFM'));
      if (d) { const len = num(dget(ctx, d, 'Length'), 0); if (len && m === 'V2') lengthBits = len <= 32 ? len * 8 : len; }
      return m === 'AESV2' ? 'AESV2' : m === 'AESV3' ? 'AESV3' : m === 'V2' ? 'RC4' : m === 'None' ? 'None' : 'RC4';
    };
    method = cfm(stmf);
    strMethod = cfm(strf);
  }
  const pwdUtf8 = enc.encode(password || '').subarray(0, 127);
  if (R >= 5) {
    const UE = strBytes(dget(ctx, encDict, 'UE'));
    const OE = strBytes(dget(ctx, encDict, 'OE'));
    const zero = new Uint8Array(16);
    // owner first (owner password opens with full rights), then user
    let h = await hash2B(pwdUtf8, O.subarray(32, 40), U.subarray(0, 48), R);
    if (eq(h, O, 32)) {
      const k = await hash2B(pwdUtf8, O.subarray(40, 48), U.subarray(0, 48), R);
      return { key: aesCbcDecryptRaw(k, zero, OE.subarray(0, 32)), method, strMethod, R, encryptMetadata };
    }
    h = await hash2B(pwdUtf8, U.subarray(32, 40), new Uint8Array(0), R);
    if (eq(h, U, 32)) {
      const k = await hash2B(pwdUtf8, U.subarray(40, 48), new Uint8Array(0), R);
      return { key: aesCbcDecryptRaw(k, zero, UE.subarray(0, 32)), method, strMethod, R, encryptMetadata };
    }
    return null;
  }
  const n = R === 2 ? 5 : Math.max(5, Math.min(16, lengthBits / 8));
  const Pb = Uint8Array.of(P & 0xff, (P >>> 8) & 0xff, (P >>> 16) & 0xff, (P >>> 24) & 0xff);
  const keyFrom = (padded) => {
    let k = md5(cat(padded, O.subarray(0, 32), Pb, id0, R >= 4 && !encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0)));
    if (R >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, n));
    return k.subarray(0, n);
  };
  const checkUser = (key) => {
    if (R === 2) return eq(rc4(key, PAD), U, 32);
    let x = rc4(key, md5(cat(PAD, id0)));
    for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
    return eq(x, U, 16);
  };
  const pwdLatin = latin1Bytes(password || '');
  // as user password
  let key = keyFrom(padPwd(pwdLatin));
  if (checkUser(key)) return { key, method, strMethod, R, encryptMetadata };
  // as owner password
  let ok = md5(padPwd(pwdLatin));
  if (R >= 3) for (let i = 0; i < 50; i++) ok = md5(ok);
  ok = ok.subarray(0, n);
  let user;
  if (R === 2) user = rc4(ok, O.subarray(0, 32));
  else { user = O.subarray(0, 32); for (let i = 19; i >= 0; i--) user = rc4(ok.map((b) => b ^ i), user); }
  key = keyFrom(user);
  if (checkUser(key)) return { key, method, strMethod, R, encryptMetadata };
  return null;
}

function objectKey(info, num, gen, aes) {
  if (info.R >= 5) return info.key;
  const k = info.key;
  const parts = [k, Uint8Array.of(num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff)];
  if (aes) parts.push(Uint8Array.of(0x73, 0x41, 0x6c, 0x54));
  return md5(cat(...parts)).subarray(0, Math.min(k.length + 5, 16));
}

function decryptString(info, ref, bytes) {
  if (info.strMethod === 'None') return bytes;
  const aes = info.strMethod === 'AESV2' || info.strMethod === 'AESV3';
  const k = objectKey(info, ref.objectNumber, ref.generationNumber, aes);
  return aes ? aesPdfDecrypt(k, bytes) : rc4(k, bytes);
}

function decryptStringsIn(info, ref, obj, depth = 0) {
  const Lib = L();
  if (depth > 50) return obj;
  if (obj instanceof Lib.PDFString || obj instanceof Lib.PDFHexString) {
    return Lib.PDFHexString.of(toHex(decryptString(info, ref, obj.asBytes())));
  }
  if (obj instanceof Lib.PDFDict) {
    const isSig = obj.get(N('Type')) === N('Sig');
    for (const [k, v] of obj.entries()) {
      if (isSig && k === N('Contents')) continue;
      const nv = decryptStringsIn(info, ref, v, depth + 1);
      if (nv !== v) obj.set(k, nv);
    }
    return obj;
  }
  if (obj instanceof Lib.PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      const nv = decryptStringsIn(info, ref, v, depth + 1);
      if (nv !== v) obj.set(i, nv);
    }
    return obj;
  }
  return obj;
}

function toHex(b) { let s = ''; for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16); return s; }

async function decryptObject(info, ref, obj) {
  const Lib = L();
  if (obj instanceof Lib.PDFRawStream) {
    decryptStringsIn(info, ref, obj.dict);
    const type = obj.dict.get(N('Type'));
    if (type === N('XRef')) return obj;
    if (type === N('Metadata') && !info.encryptMetadata) return obj;
    // Crypt filter: identity means leave as is
    let filter = obj.dict.get(N('Filter'));
    if (filter instanceof Lib.PDFArray && filter.size() && filter.get(0) === N('Crypt')) {
      filter.remove(0);
      const dp = obj.dict.get(N('DecodeParms'));
      if (dp instanceof Lib.PDFArray && dp.size()) dp.remove(0);
      return obj;
    }
    if (filter === N('Crypt')) { obj.dict.delete(N('Filter')); obj.dict.delete(N('DecodeParms')); return obj; }
    if (info.method === 'None') return obj;
    const aes = info.method === 'AESV2' || info.method === 'AESV3';
    const k = objectKey(info, ref.objectNumber, ref.generationNumber, aes);
    const data = aes ? await aesPdfDecryptFast(k, obj.contents) : rc4(k, obj.contents);
    return Lib.PDFRawStream.of(obj.dict, data);
  }
  return decryptStringsIn(info, ref, obj);
}

// Patch pdf-lib's parser while a decrypting load is in progress.
let active = null;
let patched = false;
function patchParser() {
  if (patched) return;
  patched = true;
  const Lib = L();
  const P = Lib.PDFParser.prototype;
  const endobj = Array.from('endobj', (c) => c.charCodeAt(0));
  P.parseIndirectObject = async function () {
    const ref = this.parseIndirectObjectHeader();
    this.skipWhitespaceAndComments();
    let object = this.parseObject();
    this.skipWhitespaceAndComments();
    this.matchKeyword(endobj);
    if (active && active.encRefKey !== ref.toString()) object = await decryptObject(active, ref, object);
    if (object instanceof Lib.PDFRawStream && object.dict.lookup(N('Type')) === N('ObjStm')) {
      await Lib.PDFObjectStreamParser.forStream(object, this.shouldWaitForTick).parseIntoContext();
    } else if (object instanceof Lib.PDFRawStream && object.dict.lookup(N('Type')) === N('XRef')) {
      Lib.PDFXRefStreamParser.forStream(object).parseIntoContext();
    } else {
      this.context.assign(ref, object);
    }
    return ref;
  };
}

function hasEncryptKey(b) {
  const pat = [47, 69, 110, 99, 114, 121, 112, 116]; // "/Encrypt"
  outer: for (let i = 0; i + 8 < b.length; i++) {
    if (b[i] !== 47) continue;
    for (let k = 1; k < 8; k++) if (b[i + k] !== pat[k]) continue outer;
    const nx = b[i + 8];
    if (nx === 32 || nx === 10 || nx === 13 || nx === 9 || nx === 60 || nx === 47 || (nx >= 48 && nx <= 57)) return true;
  }
  return false;
}

// Load any PDF. Returns { doc, wasEncrypted, permissions }.
export async function loadDocument(bytes, password = '') {
  const Lib = L();
  const opts = { updateMetadata: false };
  if (!hasEncryptKey(bytes)) {
    try {
      const doc = await Lib.PDFDocument.load(bytes, opts);
      return { doc, wasEncrypted: false };
    } catch (e) {
      if (!(e && /encrypted/i.test(e.message || '') || e.name === 'EncryptedPDFError')) throw e;
    }
  }
  // First pass: read the encryption dictionary and ID
  // (object streams are still encrypted in this pass, so silence pdf-lib's parse warnings)
  const warn = console.warn, log = console.log;
  let pre;
  try {
    console.warn = () => {}; console.log = () => {};
    pre = await Lib.PDFDocument.load(bytes, { ...opts, ignoreEncryption: true });
  } finally { console.warn = warn; console.log = log; }
  const ctx = pre.context;
  const encRef = ctx.trailerInfo.Encrypt;
  const encDict = ctx.lookup(encRef);
  if (!(encDict instanceof Lib.PDFDict)) throw new UnsupportedEncryptionError('Missing encryption dictionary');
  let id0 = new Uint8Array(0);
  const idArr = ctx.lookup(ctx.trailerInfo.ID);
  if (idArr instanceof Lib.PDFArray && idArr.size()) id0 = strBytes(ctx.lookup(idArr.get(0))) || id0;
  const info = await computeFileKey(encDict, id0, password, ctx);
  if (!info) throw new PasswordRequiredError(!!password);
  info.encRefKey = encRef instanceof Lib.PDFRef ? encRef.toString() : '';
  // Second pass with decryption
  patchParser();
  if (active) throw new Error('Concurrent decrypting loads are not supported');
  active = info;
  let doc;
  try {
    doc = await Lib.PDFDocument.load(bytes, { ...opts, ignoreEncryption: true });
  } finally {
    active = null;
  }
  const dctx = doc.context;
  if (dctx.trailerInfo.Encrypt instanceof Lib.PDFRef) dctx.delete(dctx.trailerInfo.Encrypt);
  dctx.trailerInfo.Encrypt = undefined;
  doc.isEncrypted = false;
  const P = num(dget(ctx, encDict, 'P'), -1);
  return { doc, wasEncrypted: true, permissions: P, method: info.method, revision: info.R };
}
