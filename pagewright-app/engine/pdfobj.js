// Small helpers over pdf-lib's object model. pdf-lib is read from globalThis.PDFLib
// so the same code runs in the browser (UMD build) and in Node tests.

export const L = () => globalThis.PDFLib;

export function N(name) { return L().PDFName.of(name); }

export function lookup(ctx, obj) {
  if (obj === undefined || obj === null) return undefined;
  if (obj instanceof L().PDFRef) return ctx.lookup(obj);
  return obj;
}

export function dget(ctx, dict, key) {
  if (!dict || !(dict instanceof L().PDFDict)) return undefined;
  return lookup(ctx, dict.get(N(key)));
}

export function nameOf(v) {
  if (v instanceof L().PDFName) return v.decodeText();
  return undefined;
}

export function num(v, dflt) {
  if (v instanceof L().PDFNumber) return v.asNumber();
  return dflt;
}

export function arr(ctx, v) {
  v = lookup(ctx, v);
  if (!(v instanceof L().PDFArray)) return undefined;
  const out = [];
  for (let i = 0; i < v.size(); i++) out.push(lookup(ctx, v.get(i)));
  return out;
}

export function numArr(ctx, v) {
  const a = arr(ctx, v);
  if (!a) return undefined;
  return a.map((x) => num(x, 0));
}

export function strBytes(v) {
  const Lib = L();
  if (v instanceof Lib.PDFString || v instanceof Lib.PDFHexString) return v.asBytes();
  return undefined;
}

export function isDict(v) { return v instanceof L().PDFDict; }
export function isStream(v) { return v instanceof L().PDFStream; }

export function streamDict(s) { return s.dict; }

// Decoded bytes of a stream object (raw streams are decoded through their filters,
// pdf-lib-created streams return their unencoded contents).
export function streamBytes(s) {
  const Lib = L();
  if (s instanceof Lib.PDFRawStream) {
    const filter = s.dict.get(N('Filter'));
    if (!filter) return s.contents;
    return Lib.decodePDFRawStream(s).decode();
  }
  if (typeof s.getUnencodedContents === 'function') return s.getUnencodedContents();
  if (typeof s.getContents === 'function') return s.getContents();
  throw new Error('Unsupported stream type');
}

export const enc = new TextEncoder();
export const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};
export const fromLatin1 = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export function concatBytes(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// Matrices are [a b c d e f]; mul(A,B) = A x B (apply A first, then B).
export function mul(A, B) {
  return [
    A[0] * B[0] + A[1] * B[2],
    A[0] * B[1] + A[1] * B[3],
    A[2] * B[0] + A[3] * B[2],
    A[2] * B[1] + A[3] * B[3],
    A[4] * B[0] + A[5] * B[2] + B[4],
    A[4] * B[1] + A[5] * B[3] + B[5],
  ];
}
export function apply(M, x, y) { return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]]; }
export function inv(M) {
  const det = M[0] * M[3] - M[1] * M[2];
  if (Math.abs(det) < 1e-12) return null;
  return [
    M[3] / det, -M[1] / det, -M[2] / det, M[0] / det,
    (M[2] * M[5] - M[3] * M[4]) / det,
    (M[1] * M[4] - M[0] * M[5]) / det,
  ];
}
export const IDENT = [1, 0, 0, 1, 0, 0];

// Number formatting for content streams: no exponent notation, trimmed.
export function fmt(n) {
  if (!isFinite(n)) n = 0;
  if (Math.abs(n) < 1e-7) return '0';
  let s = n.toFixed(5);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

export function hexOf(bytes) {
  let s = '<';
  for (const b of bytes) s += (b < 16 ? '0' : '') + b.toString(16);
  return s + '>';
}
