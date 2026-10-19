// Builds a browser font from a PDF's embedded font so the inline editor shows
// the document's real typeface while typing. pdf.js has already converted and
// sanitised the embedded program; its cmap maps internal codes, so we rewrite
// just the cmap to map real Unicode characters to the same glyphs.

const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];

function readTables(b) {
  const n = u16(b, 4);
  const t = {};
  for (let i = 0; i < n; i++) {
    const d = 12 + i * 16;
    const tag = String.fromCharCode(b[d], b[d + 1], b[d + 2], b[d + 3]);
    t[tag] = { off: u32(b, d + 8), len: u32(b, d + 12) };
  }
  return t;
}

function readCmap(b, off) {
  const out = new Map();
  const n = u16(b, off + 2);
  const subs = [];
  for (let i = 0; i < n; i++) subs.push({ pid: u16(b, off + 4 + i * 8), eid: u16(b, off + 6 + i * 8), o: off + u32(b, off + 8 + i * 8) });
  // prefer (3,1)/(3,10), then others
  subs.sort((a, c) => (a.pid === 3 ? 0 : 1) - (c.pid === 3 ? 0 : 1));
  for (const s of subs) {
    const fmt = u16(b, s.o);
    if (fmt === 4) {
      const seg = u16(b, s.o + 6) / 2;
      const ends = s.o + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
      for (let i = 0; i < seg; i++) {
        const e = u16(b, ends + i * 2), st = u16(b, starts + i * 2), dl = u16(b, deltas + i * 2), ro = u16(b, ranges + i * 2);
        for (let c = st; c <= e && c !== 0xffff; c++) {
          let g;
          if (!ro) g = (c + dl) & 0xffff;
          else { const gp = ranges + i * 2 + ro + (c - st) * 2; g = u16(b, gp); if (g) g = (g + dl) & 0xffff; }
          if (g && !out.has(c)) out.set(c, g);
        }
      }
    } else if (fmt === 12) {
      const ng = u32(b, s.o + 12);
      for (let i = 0; i < ng && i < 50000; i++) {
        const p = s.o + 16 + i * 12;
        const a = u32(b, p), e = u32(b, p + 4), g = u32(b, p + 8);
        for (let c = a; c <= e && c - a < 70000; c++) if (!out.has(c)) out.set(c, g + (c - a));
      }
    } else if (fmt === 0) {
      for (let c = 0; c < 256; c++) { const g = b[s.o + 6 + c]; if (g && !out.has(c)) out.set(c, g); }
    } else if (fmt === 6) {
      const first = u16(b, s.o + 6), cnt = u16(b, s.o + 8);
      for (let i = 0; i < cnt; i++) { const g = u16(b, s.o + 10 + i * 2); if (g && !out.has(first + i)) out.set(first + i, g); }
    }
  }
  return out;
}

function buildCmap(map) {
  const bmp = [...map.entries()].filter(([c]) => c <= 0xfffe).sort((a, b) => a[0] - b[0]);
  const astral = [...map.entries()].filter(([c]) => c > 0xffff).sort((a, b) => a[0] - b[0]);
  const segs = bmp.map(([c, g]) => ({ s: c, e: c, d: (g - c) & 0xffff }));
  segs.push({ s: 0xffff, e: 0xffff, d: 1 });
  const segX2 = segs.length * 2;
  let es = 0; while ((1 << (es + 1)) <= segs.length) es++;
  const sr = (1 << es) * 2;
  const f4len = 16 + segs.length * 8;
  const f12len = astral.length ? 16 + astral.length * 12 : 0;
  const nSub = astral.length ? 2 : 1;
  const out = new Uint8Array(4 + nSub * 8 + f4len + f12len);
  const w16 = (p, v) => { out[p] = (v >> 8) & 255; out[p + 1] = v & 255; };
  const w32 = (p, v) => { out[p] = v >>> 24; out[p + 1] = (v >>> 16) & 255; out[p + 2] = (v >>> 8) & 255; out[p + 3] = v & 255; };
  w16(0, 0); w16(2, nSub);
  const f4 = 4 + nSub * 8;
  w16(4, 3); w16(6, 1); w32(8, f4);
  if (astral.length) { w16(12, 3); w16(14, 10); w32(16, f4 + f4len); }
  w16(f4, 4); w16(f4 + 2, f4len); w16(f4 + 4, 0); w16(f4 + 6, segX2); w16(f4 + 8, sr); w16(f4 + 10, es); w16(f4 + 12, segX2 - sr);
  let p = f4 + 14;
  for (const s of segs) { w16(p, s.e); p += 2; }
  w16(p, 0); p += 2;
  for (const s of segs) { w16(p, s.s); p += 2; }
  for (const s of segs) { w16(p, s.d); p += 2; }
  for (let i = 0; i < segs.length; i++) { w16(p, 0); p += 2; }
  if (astral.length) {
    const q = f4 + f4len;
    w16(q, 12); w16(q + 2, 0); w32(q + 4, f12len); w32(q + 8, 0); w32(q + 12, astral.length);
    astral.forEach(([c, g], i) => { w32(q + 16 + i * 12, c); w32(q + 20 + i * 12, c); w32(q + 24 + i * 12, g); });
  }
  return out;
}

function checksum(b) {
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s = (s + (((b[i] << 24) >>> 0) + ((b[i + 1] || 0) << 16) + ((b[i + 2] || 0) << 8) + (b[i + 3] || 0))) >>> 0;
  return s >>> 0;
}

function replaceTable(b, tag, data) {
  const t = readTables(b);
  t[tag] = { data };
  const tags = Object.keys(t).sort();
  const n = tags.length;
  let es = 0; while ((1 << (es + 1)) <= n) es++;
  const sr = (1 << es) * 16;
  let size = 12 + n * 16;
  const datas = tags.map((k) => t[k].data || b.subarray(t[k].off, t[k].off + t[k].len));
  for (const d of datas) size += (d.length + 3) & ~3;
  const out = new Uint8Array(size);
  const w16 = (p, v) => { out[p] = (v >> 8) & 255; out[p + 1] = v & 255; };
  const w32 = (p, v) => { out[p] = v >>> 24; out[p + 1] = (v >>> 16) & 255; out[p + 2] = (v >>> 8) & 255; out[p + 3] = v & 255; };
  out.set(b.subarray(0, 4), 0);
  w16(4, n); w16(6, sr); w16(8, es); w16(10, n * 16 - sr);
  let off = 12 + n * 16, headOff = -1;
  tags.forEach((k, i) => {
    const d = datas[i];
    const e = 12 + i * 16;
    for (let j = 0; j < 4; j++) out[e + j] = k.charCodeAt(j);
    let data = d;
    if (k === 'head') { data = d.slice(); data[8] = data[9] = data[10] = data[11] = 0; headOff = off; }
    w32(e + 4, checksum(data)); w32(e + 8, off); w32(e + 12, data.length);
    out.set(data, off);
    off += (data.length + 3) & ~3;
  });
  if (headOff >= 0) w32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

const made = new WeakMap(); // pdf.js font object -> Promise<family|null>
let counter = 0;

// pdfFont: pdf.js FontFaceObject (with toFontChar); font: engine FontInfo
export function unicodeFace(pdfFont, font) {
  if (made.has(pdfFont)) return made.get(pdfFont);
  const p = (async () => {
    const data = pdfFont.data;
    if (!data || !pdfFont.toFontChar || !window.FontFace) return null;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const tables = readTables(bytes);
    if (!tables.cmap) return null;
    const internal = readCmap(bytes, tables.cmap.off);
    const rev = font.reverseMap(); // char -> code (only glyphs the PDF font really has)
    const uni = new Map();
    for (const [ch, code] of rev) {
      const keys = font.isType0 ? [code, font.codeToCid(code)] : [code];
      for (const k of keys) {
        const fc = pdfFont.toFontChar[k];
        if (!fc) continue;
        const g = internal.get(typeof fc === 'number' ? fc : fc.codePointAt(0));
        if (g) { uni.set(ch.codePointAt(0), g); break; }
      }
    }
    if (uni.size < 1) return null;
    const out = replaceTable(bytes, 'cmap', buildCmap(uni));
    const family = `folio-pdf-face-${++counter}`;
    const face = new FontFace(family, out, { weight: font.bold ? '700' : '400', style: font.italic ? 'italic' : 'normal' });
    await face.load();
    document.fonts.add(face);
    return family;
  })().catch(() => null);
  made.set(pdfFont, p);
  return p;
}
