// Embeds a TrueType font as a Type0/CIDFontType2 (Identity-H) font.
// The font program is "hollowed": glyph IDs are kept, but every glyph we
// don't use is emptied, so the file stays small and glyph IDs never shift.
// Objects are re-written in place (same refs) every time new glyphs are used.

import { L, N, enc } from './pdfobj.js';
import { parseTrueType } from './fontprog.js';
import { buildToUnicode } from './cmap.js';

const u16 = (b, p) => (b[p] << 8) | b[p + 1];
const i16 = (b, p) => { const v = u16(b, p); return v & 0x8000 ? v - 0x10000 : v; };
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];

function checksum(b) {
  let sum = 0;
  const n = b.length;
  for (let i = 0; i < n; i += 4) {
    sum = (sum + (((b[i] << 24) >>> 0) + ((b[i + 1] || 0) << 16) + ((b[i + 2] || 0) << 8) + (b[i + 3] || 0))) >>> 0;
  }
  return sum >>> 0;
}

function randomTag() {
  let s = '';
  for (let i = 0; i < 6; i++) s += String.fromCharCode(65 + Math.floor(Math.random() * 26));
  return s;
}

export function hollowTrueType(bytes, tt, keep) {
  const T = tt.tables;
  const glyf = T.glyf, loca = T.loca;
  const n = tt.numGlyphs;
  const offs = [];
  const lf = tt.indexToLocFormat;
  for (let i = 0; i <= n; i++) offs.push(lf ? u32(bytes, loca.off + i * 4) : u16(bytes, loca.off + i * 2) * 2);
  // composite closure
  const set = new Set([0, ...keep]);
  const queue = [...set];
  while (queue.length) {
    const g = queue.pop();
    if (g >= n) continue;
    const s = glyf.off + offs[g], e = glyf.off + offs[g + 1];
    if (e - s < 10) continue;
    if (i16(bytes, s) >= 0) continue;
    let p = s + 10;
    for (;;) {
      const flags = u16(bytes, p), gi = u16(bytes, p + 2);
      p += 4;
      if (!set.has(gi)) { set.add(gi); queue.push(gi); }
      p += flags & 1 ? 4 : 2;
      if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
      if (!(flags & 0x20) || p >= e) break;
    }
  }
  // new glyf + loca (long format)
  let total = 0;
  const parts = [];
  const newOffs = new Uint32Array(n + 1);
  for (let g = 0; g < n; g++) {
    newOffs[g] = total;
    if (set.has(g)) {
      const s = glyf.off + offs[g], e = glyf.off + offs[g + 1];
      if (e > s) {
        let len = e - s;
        const pad = (4 - (len % 4)) % 4;
        parts.push(bytes.subarray(s, e));
        if (pad) parts.push(new Uint8Array(pad));
        total += len + pad;
      }
    }
  }
  newOffs[n] = total;
  const newGlyf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { newGlyf.set(p, o); o += p.length; }
  const newLoca = new Uint8Array((n + 1) * 4);
  for (let i = 0; i <= n; i++) {
    const v = newOffs[i];
    newLoca[i * 4] = v >>> 24; newLoca[i * 4 + 1] = (v >>> 16) & 255; newLoca[i * 4 + 2] = (v >>> 8) & 255; newLoca[i * 4 + 3] = v & 255;
  }
  const keepTags = ['OS/2', 'cvt ', 'fpgm', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post', 'prep'];
  const tables = [];
  for (const tag of keepTags) {
    if (tag === 'glyf') { tables.push({ tag, data: newGlyf }); continue; }
    if (tag === 'loca') { tables.push({ tag, data: newLoca }); continue; }
    const t = T[tag];
    if (!t) continue;
    let data = bytes.slice(t.off, t.off + t.len);
    if (tag === 'head') { data[50] = 0; data[51] = 1; data[8] = data[9] = data[10] = data[11] = 0; }
    if (tag === 'post' && data.length >= 32) { data = data.slice(0, 32); data[0] = 0; data[1] = 3; data[2] = 0; data[3] = 0; }
    tables.push({ tag, data });
  }
  const numTables = tables.length;
  let es = 0; while ((1 << (es + 1)) <= numTables) es++;
  const sr = (1 << es) * 16;
  const headerLen = 12 + numTables * 16;
  let size = headerLen;
  for (const t of tables) size += (t.data.length + 3) & ~3;
  const out = new Uint8Array(size);
  const w16 = (p, v) => { out[p] = (v >> 8) & 255; out[p + 1] = v & 255; };
  const w32 = (p, v) => { out[p] = v >>> 24; out[p + 1] = (v >>> 16) & 255; out[p + 2] = (v >>> 8) & 255; out[p + 3] = v & 255; };
  w32(0, 0x00010000); w16(4, numTables); w16(6, sr); w16(8, es); w16(10, numTables * 16 - sr);
  let off = headerLen;
  let headOff = -1;
  tables.forEach((t, i) => {
    const d = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[d + k] = t.tag.charCodeAt(k);
    w32(d + 4, checksum(t.data)); w32(d + 8, off); w32(d + 12, t.data.length);
    out.set(t.data, off);
    if (t.tag === 'head') headOff = off;
    off += (t.data.length + 3) & ~3;
  });
  if (headOff >= 0) w32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

export class EmbeddedTTF {
  constructor(doc, key, bytes) {
    this.doc = doc;
    this.key = key;
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.tt = parseTrueType(this.bytes);
    this.cmap = this.tt.cmap(3, 10) || this.tt.cmap(3, 1) || this.tt.cmap(0, 4) || this.tt.cmap(0, 3) || new Map();
    this.used = new Map(); // gid -> unicode string
    const ctx = doc.context;
    this.ref = ctx.nextRef();
    this.refs = { cid: ctx.nextRef(), fd: ctx.nextRef(), file: ctx.nextRef(), tu: ctx.nextRef() };
    const b = this.bytes, T = this.tt.tables;
    const upm = this.tt.unitsPerEm;
    const sc = (v) => Math.round(v * 1000 / upm);
    this.metrics = { ascent: 800, descent: -200, bbox: [0, -200, 1000, 800], italic: 0, capHeight: 700 };
    if (T.head) this.metrics.bbox = [sc(i16(b, T.head.off + 36)), sc(i16(b, T.head.off + 38)), sc(i16(b, T.head.off + 40)), sc(i16(b, T.head.off + 42))];
    if (T.hhea) { this.metrics.ascent = sc(i16(b, T.hhea.off + 4)); this.metrics.descent = sc(i16(b, T.hhea.off + 6)); }
    if (T.post) this.metrics.italic = i16(b, T.post.off + 4) + u16(b, T.post.off + 6) / 65536;
    if (T['OS/2'] && u16(b, T['OS/2'].off) >= 2 && T['OS/2'].len >= 90) this.metrics.capHeight = sc(i16(b, T['OS/2'].off + 88));
    else this.metrics.capHeight = Math.round(this.metrics.ascent * 0.7);
    this.psName = randomTag() + '+' + key.replace(/[^A-Za-z0-9\-]/g, '');
    this.dirty = true;
  }

  gidFor(ch) { const cp = ch.codePointAt(0); const g = this.cmap.get(cp); return g && g < this.tt.numGlyphs ? g : 0; }
  has(ch) { return this.gidFor(ch) > 0; }
  advance(ch) { const g = this.gidFor(ch); return g ? this.tt.advance(g) : 0; }

  // Returns hex string <....> for the text (one glyph per code point; missing glyphs skipped)
  encode(text) {
    let hex = '';
    for (const ch of text) {
      const g = this.gidFor(ch);
      if (!g) continue;
      if (!this.used.has(g)) { this.used.set(g, ch); this.dirty = true; }
      hex += g.toString(16).padStart(4, '0');
    }
    return '<' + hex + '>';
  }

  widthOf(text, size) {
    let w = 0;
    for (const ch of text) w += this.advance(ch);
    return w * size / 1000;
  }

  // Write/refresh the font objects. Safe to call repeatedly.
  flush() {
    if (!this.dirty) return;
    const ctx = this.doc.context;
    const Lib = L();
    const program = hollowTrueType(this.bytes, this.tt, this.used.keys());
    const file = ctx.flateStream(program, { Length1: program.length });
    ctx.assign(this.refs.file, file);
    const m = this.metrics;
    const flags = 4 | (Math.abs(m.italic) > 0.1 ? 64 : 0);
    ctx.assign(this.refs.fd, ctx.obj({
      Type: 'FontDescriptor', FontName: this.psName, Flags: flags, FontBBox: m.bbox,
      ItalicAngle: m.italic, Ascent: m.ascent, Descent: m.descent, CapHeight: m.capHeight,
      StemV: 80, FontFile2: this.refs.file,
    }));
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    const W = [];
    for (let i = 0; i < gids.length;) {
      let j = i;
      while (j + 1 < gids.length && gids[j + 1] === gids[j] + 1) j++;
      W.push(gids[i], gids.slice(i, j + 1).map((g) => Math.round(this.tt.advance(g) || 0)));
      i = j + 1;
    }
    ctx.assign(this.refs.cid, ctx.obj({
      Type: 'Font', Subtype: 'CIDFontType2', BaseFont: this.psName,
      CIDSystemInfo: { Registry: Lib.PDFString.of('Adobe'), Ordering: Lib.PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: this.refs.fd, CIDToGIDMap: 'Identity', DW: 1000, W,
    }));
    const tu = buildToUnicode(this.used, 2);
    ctx.assign(this.refs.tu, ctx.flateStream(enc.encode(tu)));
    ctx.assign(this.ref, ctx.obj({
      Type: 'Font', Subtype: 'Type0', BaseFont: this.psName, Encoding: 'Identity-H',
      DescendantFonts: [this.refs.cid], ToUnicode: this.refs.tu,
    }));
    this.dirty = false;
  }
}
