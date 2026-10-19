// Font model for text editing: decoding codes to Unicode, glyph widths,
// and (crucially) encoding new text back into the *same* embedded font,
// using only glyphs that really exist in the embedded program.

import { L, N, dget, nameOf, num, arr, numArr, strBytes, streamBytes, lookup, enc as utf8 } from './pdfobj.js';
import { encodingArray, glyphToUnicode, unicodeToGlyphName, glyphNamesFor, standardFontFor } from './encodings.js';
import { parseCMap, makeSplitter, buildToUnicode } from './cmap.js';
import { parseTrueType, parseCFF, parseType1 } from './fontprog.js';

const stdEmbedders = new Map();
function stdEmbedder(name) {
  if (!stdEmbedders.has(name)) {
    let e = null;
    try { e = L().StandardFontEmbedder.for(name); } catch (err) { e = null; }
    stdEmbedders.set(name, e);
  }
  return stdEmbedders.get(name);
}

export class FontInfo {
  constructor(doc, dict, resName, ref) {
    this.doc = doc;
    const ctx = (this.ctx = doc.context);
    this.dict = dict;
    this.resName = resName;
    this.ref = ref;
    this.subtype = nameOf(dget(ctx, dict, 'Subtype')) || 'Type1';
    this.baseFont = nameOf(dget(ctx, dict, 'BaseFont')) || resName || 'Unknown';
    this.isSubset = /^[A-Z]{6}\+/.test(this.baseFont);
    this.cleanName = this.baseFont.replace(/^[A-Z]{6}\+/, '');
    this.isType0 = this.subtype === 'Type0';
    this.isType3 = this.subtype === 'Type3';
    this.observed = new Set();
    this.patches = { widths: new Map(), toUni: new Map() };
    this.editable = true;
    this.reason = '';
    this.widthScale = 0.001;
    this._prog = undefined;
    try {
      if (this.isType0) this._initType0(); else this._initSimple();
    } catch (e) {
      this.editable = false;
      this.reason = 'Font could not be read';
      this.split = this.split || ((b) => Array.from(b, (c, i) => ({ code: c, len: 1, off: i })));
      this.codeLen = this.codeLen || 1;
    }
    this._initDescriptor();
    this._initToUnicode();
  }

  // ----------------------------------------------------------- setup
  _initDescriptor() {
    const ctx = this.ctx;
    const fd = this.fd;
    this.ascent = 0.8; this.descent = -0.2;
    this.flags = 0; this.italicAngle = 0; this.weight = 400;
    if (fd) {
      const a = num(dget(ctx, fd, 'Ascent')); const d = num(dget(ctx, fd, 'Descent'));
      if (a && a > 100) this.ascent = a / 1000;
      if (d && d < 0) this.descent = d / 1000;
      this.flags = num(dget(ctx, fd, 'Flags'), 0) | 0;
      this.italicAngle = num(dget(ctx, fd, 'ItalicAngle'), 0);
      this.weight = num(dget(ctx, fd, 'FontWeight'), 0) || 0;
      if (this.ascent > 1.5) this.ascent = 0.9;
      if (this.descent < -1) this.descent = -0.25;
    } else {
      const std = standardFontFor(this.baseFont);
      if (std === 'Courier' || (std && std.startsWith('Courier'))) { this.ascent = 0.63; this.descent = -0.16; this.flags |= 1; }
      else if (std && std.startsWith('Times')) { this.ascent = 0.683; this.descent = -0.217; this.flags |= 2; }
      else { this.ascent = 0.718; this.descent = -0.207; }
    }
    if (this.isType3) {
      const bbox = numArr(ctx, dget(ctx, this.dict, 'FontBBox'));
      const fm = this.fontMatrix;
      if (bbox && fm && bbox[3] > bbox[1]) {
        this.ascent = bbox[3] * fm[3]; this.descent = bbox[1] * fm[3];
        if (!(this.ascent > 0)) { this.ascent = 0.8; this.descent = -0.2; }
      }
    }
    const n = this.cleanName.toLowerCase();
    this.bold = /bold|black|heavy|semibold|demibold|demi\b|extrabold/.test(n) || this.weight >= 600 || !!(this.flags & 0x40000);
    this.italic = /italic|oblique|-it\b|,it\b|slanted/.test(n) || Math.abs(this.italicAngle) > 0.5 || !!(this.flags & 64);
    this.mono = !!(this.flags & 1) || /courier|mono|consol|menlo|typewriter|cmtt|lmmono/.test(n);
    this.serif = !this.mono && (!!(this.flags & 2) || /times|roman|serif|georgia|garamond|cambria|caladea|book|palatino|minion|caslon|baskerville|cmr|lmroman|tinos|cmti|cmbx|century|bodoni|charter|utopia|didot/.test(n)) && !/sans/.test(n);
    this.vertical = this.vertical || false;
    if (this.vertical) { this.editable = false; this.reason = 'Vertical text'; }
  }

  _initToUnicode() {
    const tu = dget(this.ctx, this.dict, 'ToUnicode');
    this.toUni = new Map();
    this.toUniStream = null;
    if (tu && tu instanceof L().PDFStream) {
      try {
        const cm = parseCMap(streamBytes(tu));
        this.toUni = cm.toUni;
        this.toUniStream = tu;
      } catch (e) { /* ignore */ }
    }
  }

  _fontFile() {
    const fd = this.fd;
    if (!fd) return null;
    const ctx = this.ctx;
    for (const k of ['FontFile', 'FontFile2', 'FontFile3']) {
      const s = dget(ctx, fd, k);
      if (s && s instanceof L().PDFStream) {
        const sub = nameOf(dget(ctx, s.dict, 'Subtype'));
        return { key: k, stream: s, sub, len1: num(dget(ctx, s.dict, 'Length1'), 0), len2: num(dget(ctx, s.dict, 'Length2'), 0) };
      }
    }
    return null;
  }

  get isEmbedded() { return !!this._fontFile(); }

  // Lazily parsed embedded program
  get prog() {
    if (this._prog !== undefined) return this._prog;
    this._prog = null;
    const ff = this._fontFile();
    if (!ff) return null;
    try {
      const bytes = streamBytes(ff.stream);
      if (ff.key === 'FontFile2') this._prog = { kind: 'tt', tt: parseTrueType(bytes) };
      else if (ff.key === 'FontFile') this._prog = { kind: 't1', t1: parseType1(bytes, ff.len1, ff.len2) };
      else if (ff.key === 'FontFile3') {
        if (ff.sub === 'OpenType' || (bytes[0] === 0x4f && bytes[1] === 0x54) || (bytes[0] === 0 && bytes[1] === 1)) {
          const tt = parseTrueType(bytes);
          let cff = null;
          if (tt.tables['CFF ']) { try { cff = parseCFF(bytes.subarray(tt.tables['CFF '].off, tt.tables['CFF '].off + tt.tables['CFF '].len)); } catch (e) { cff = null; } }
          this._prog = { kind: 'otf', tt, cff };
        } else this._prog = { kind: 'cff', cff: parseCFF(bytes) };
      }
    } catch (e) {
      this._prog = null;
    }
    return this._prog;
  }

  _initSimple() {
    const ctx = this.ctx, d = this.dict;
    this.codeLen = 1;
    this.split = (bytes) => Array.from(bytes, (c, i) => ({ code: c, len: 1, off: i }));
    this.fd = dget(ctx, d, 'FontDescriptor');
    if (!(this.fd instanceof L().PDFDict)) this.fd = null;
    this.firstChar = num(dget(ctx, d, 'FirstChar'), 0);
    this.widthsArr = numArr(ctx, dget(ctx, d, 'Widths')) || null;
    this.missingWidth = this.fd ? num(dget(ctx, this.fd, 'MissingWidth'), 0) : 0;
    if (this.isType3) {
      this.fontMatrix = numArr(ctx, dget(ctx, d, 'FontMatrix')) || [0.001, 0, 0, 0.001, 0, 0];
      this.widthScale = this.fontMatrix[0];
      this.charProcs = dget(ctx, d, 'CharProcs');
    }
    this.std = !this.fd || !this._fontFile() ? standardFontFor(this.baseFont) : undefined;
    // encoding
    const encObj = dget(ctx, d, 'Encoding');
    let baseName = null, diffs = null;
    if (encObj instanceof L().PDFName) baseName = nameOf(encObj);
    else if (encObj instanceof L().PDFDict) {
      baseName = nameOf(dget(ctx, encObj, 'BaseEncoding')) || null;
      diffs = arr(ctx, encObj.get(N('Differences')));
    }
    const symbolic = !!(this.fd && (num(dget(ctx, this.fd, 'Flags'), 0) & 4));
    this.symbolic = symbolic;
    const names = new Array(256).fill(undefined);
    let unis;
    if (baseName) {
      unis = encodingArray(baseName);
      for (let c = 0; c < 256; c++) if (unis[c]) names[c] = unicodeToGlyphName(unis[c]);
    } else {
      // built-in encoding of the font program
      let builtin = null;
      const ff = this._fontFile();
      if (ff && (ff.key === 'FontFile' || (ff.key === 'FontFile3' && ff.sub === 'Type1C'))) {
        const p = this.prog;
        if (p && p.kind === 't1' && p.t1.encoding) builtin = p.t1.encoding;
        if (p && p.kind === 'cff' && p.cff.encoding) builtin = p.cff.encoding;
      }
      if (builtin) {
        unis = new Array(256).fill(undefined);
        for (let c = 0; c < 256; c++) if (builtin[c]) { names[c] = builtin[c]; unis[c] = glyphToUnicode(builtin[c]); }
      } else if (this.std === 'Symbol' || this.std === 'ZapfDingbats') {
        unis = new Array(256).fill(undefined);
        const e = stdEmbedder(this.std);
        if (e && e.encoding && e.encoding.unicodeMappings) {
          for (const k of Object.keys(e.encoding.unicodeMappings)) {
            const [code, name] = e.encoding.unicodeMappings[k];
            unis[code] = String.fromCodePoint(+k); names[code] = name;
          }
        }
      } else if (this.subtype === 'TrueType' && symbolic) {
        // symbolic TrueType: codes map through (3,0) cmap. Unicode is a guess (WinAnsi).
        unis = encodingArray('WinAnsiEncoding');
        for (let c = 0; c < 256; c++) if (unis[c]) names[c] = unicodeToGlyphName(unis[c]);
      } else {
        unis = encodingArray(this.subtype === 'TrueType' ? 'WinAnsiEncoding' : 'StandardEncoding');
        for (let c = 0; c < 256; c++) if (unis[c]) names[c] = unicodeToGlyphName(unis[c]);
      }
    }
    if (diffs) {
      let code = 0;
      for (const v of diffs) {
        if (v instanceof L().PDFNumber) code = v.asNumber();
        else if (v instanceof L().PDFName) {
          if (code < 256) { names[code] = nameOf(v); unis[code] = glyphToUnicode(nameOf(v)); }
          code++;
        }
      }
    }
    // Glyph names like "a65"/"g65"/"c65" (TeX bitmap and some generated fonts):
    // when the number equals the code, read it as a TeX/ASCII character code.
    const TEX_LOW = ['`', '´', 'ˆ', '˜', '¨', '˝', '˚', 'ˇ', '˘', '¯', '˙', '¸', '˛', '‚', '‹', '›', '“', '”', '„', '«', '»', '–', '—', '', '0', 'ı', 'ȷ', 'ff', 'fi', 'fl', 'ffi', 'ffl'];
    for (let c = 0; c < 256; c++) {
      if (unis[c] || !names[c]) continue;
      const m = names[c].match(/^[A-Za-z]{1,3}(\d{1,3})$/);
      if (!m || +m[1] !== c) continue;
      if (c < 32) unis[c] = TEX_LOW[c] || undefined;
      else if (c === 39) unis[c] = '’';
      else if (c === 96) unis[c] = '‘';
      else if (c === 127) unis[c] = '-';
      else if (c < 127) unis[c] = String.fromCharCode(c);
      else if (c >= 160) unis[c] = String.fromCharCode(c);
    }
    this.hasDifferences = !!diffs;
    this.codeNames = names;
    this.codeUnis = unis;
  }

  _initType0() {
    const ctx = this.ctx, d = this.dict;
    const desc = arr(ctx, d.get(N('DescendantFonts')));
    const cf = desc && desc[0];
    if (!(cf instanceof L().PDFDict)) throw new Error('Missing descendant font');
    this.cidFont = cf;
    this.cidSubtype = nameOf(dget(ctx, cf, 'Subtype'));
    this.fd = dget(ctx, cf, 'FontDescriptor');
    if (!(this.fd instanceof L().PDFDict)) this.fd = null;
    this.dw = num(dget(ctx, cf, 'DW'), 1000);
    this.cidWidths = new Map();
    const W = arr(ctx, cf.get(N('W')));
    if (W) {
      for (let i = 0; i < W.length;) {
        const c1 = num(W[i]);
        const next = W[i + 1];
        if (next instanceof L().PDFArray) {
          const ws = arr(ctx, next);
          ws.forEach((w, k) => this.cidWidths.set(c1 + k, num(w, this.dw)));
          i += 2;
        } else {
          const c2 = num(next), w = num(W[i + 2], this.dw);
          if (c1 !== undefined && c2 !== undefined && c2 - c1 < 70000) for (let c = c1; c <= c2; c++) this.cidWidths.set(c, w);
          i += 3;
        }
      }
    }
    // CID -> GID
    const c2g = dget(ctx, cf, 'CIDToGIDMap');
    this.cidToGidIdentity = true;
    if (c2g instanceof L().PDFStream) {
      this.cidToGidIdentity = false;
      const b = streamBytes(c2g);
      this.cidToGid = (cid) => (cid * 2 + 1 < b.length ? (b[cid * 2] << 8) | b[cid * 2 + 1] : 0);
      this._c2gBytes = b;
    } else this.cidToGid = (cid) => cid;
    const encObj = dget(ctx, d, 'Encoding');
    this.codeLen = 2;
    this.identity = false;
    if (encObj instanceof L().PDFName) {
      const en = nameOf(encObj);
      if (en === 'Identity-H' || en === 'Identity-V') {
        this.identity = true;
        this.vertical = en === 'Identity-V';
        this.split = makeSplitter(null, 2);
        this.codeToCid = (c) => c;
      } else {
        this.vertical = /-V$/.test(en);
        this.split = makeSplitter(null, 2);
        this.codeToCid = (c) => c;
        this.editable = false;
        this.reason = `Uses the ${en} character map`;
        this.cidUnknown = true;
      }
    } else if (encObj instanceof L().PDFStream) {
      const cm = parseCMap(streamBytes(encObj));
      this.vertical = cm.wmode === 1;
      this.split = makeSplitter(cm.codespace, 2);
      const ranges = cm.cidRanges, chars = cm.cid;
      this.codeToCid = (c) => {
        if (chars.has(c)) return chars.get(c);
        for (const r of ranges) if (c >= r.lo && c <= r.hi) return r.cid + (c - r.lo);
        return 0;
      };
      this.embeddedCMap = { codespace: cm.codespace, chars, ranges };
      if (cm.usecmap) { this.editable = false; this.reason = 'Uses a predefined character map'; }
    } else {
      this.split = makeSplitter(null, 2);
      this.codeToCid = (c) => c;
      this.identity = true;
    }
  }

  // ----------------------------------------------------------- queries
  width(code) {
    if (this.isType0) {
      const cid = this.codeToCid(code);
      const w = this.patches.widths.has(code) ? this.patches.widths.get(code) : (this.cidWidths.has(cid) ? this.cidWidths.get(cid) : this.dw);
      return w * 0.001;
    }
    if (this.patches.widths.has(code)) return this.patches.widths.get(code) * this.widthScale;
    if (this.widthsArr) {
      const i = code - this.firstChar;
      if (i >= 0 && i < this.widthsArr.length) return this.widthsArr[i] * this.widthScale;
      return this.missingWidth * this.widthScale;
    }
    const w = this._stdWidth(code);
    if (w !== undefined) return w * 0.001;
    return (this.missingWidth || 500) * this.widthScale;
  }

  _stdWidth(code) {
    const std = this.std || standardFontFor(this.baseFont);
    if (!std) return undefined;
    const e = stdEmbedder(std);
    if (!e) return undefined;
    const name = this.codeNames ? this.codeNames[code] : undefined;
    try {
      if (name) { const w = e.font.getWidthOfGlyph(name); if (w !== undefined) return w; }
      const u = this.codeUnis && this.codeUnis[code];
      if (u) {
        const g = e.encoding.encodeUnicodeCodePoint(u.codePointAt(0));
        const w = e.font.getWidthOfGlyph(g.name);
        if (w !== undefined) return w;
      }
    } catch (err) { /* not encodable */ }
    return undefined;
  }

  unicode(code) {
    if (this.toUni.has(code)) return this.toUni.get(code);
    if (this.patches.toUni.has(code)) return this.patches.toUni.get(code);
    if (!this.isType0) {
      const u = this.codeUnis && this.codeUnis[code];
      if (u) return u;
      return undefined;
    }
    // Type0 without ToUnicode: try reversing the embedded TrueType cmap
    const g2u = this._gidToUni();
    if (g2u) {
      const gid = this.cidToGid(this.codeToCid(code));
      if (g2u.has(gid)) return g2u.get(gid);
    }
    return undefined;
  }

  _gidToUni() {
    if (this._g2u !== undefined) return this._g2u;
    this._g2u = null;
    const p = this.prog;
    if (p && (p.kind === 'tt' || p.kind === 'otf')) {
      const m = p.tt.cmap(3, 1) || p.tt.cmap(0, 3) || p.tt.cmap(0, 4) || p.tt.cmap(3, 10);
      if (m) {
        this._g2u = new Map();
        for (const [u, g] of m) if (!this._g2u.has(g)) this._g2u.set(g, String.fromCodePoint(u));
      }
    }
    return this._g2u;
  }

  // Does the glyph for this code exist in the embedded program (or can the viewer draw it)?
  glyphAvailable(code) {
    if (this.observed.has(code)) return true;
    if (!this.editable) return false;
    const p = this.prog;
    if (!this.isEmbedded) {
      if (this.isType0) return false;
      if (this.isType3) return this._type3Has(code);
      // non-embedded simple font: viewer substitutes; need a reliable width
      if (this.widthsArr) {
        const i = code - this.firstChar;
        return i >= 0 && i < this.widthsArr.length && this.widthsArr[i] > 0 && !!this.codeUnis[code];
      }
      return this._stdWidth(code) !== undefined;
    }
    if (!p) return false;
    if (this.isType0) {
      const cid = this.codeToCid(code);
      if (p.kind === 'tt' || (p.kind === 'otf' && !p.cff)) {
        const gid = this.cidToGid(cid);
        return p.tt.hasOutline(gid) || (p.tt.exists(gid) && this._isSpaceUni(this.unicode(code)));
      }
      const cff = p.cff;
      if (!cff) return false;
      if (cff.isCID) return cff.cidToGid.has(cid) && cid !== 0;
      return cid > 0 && cid < cff.nGlyphs;
    }
    // simple font: needs a width as well
    const name = this.codeNames[code];
    if (p.kind === 't1') return !!name && p.t1.glyphs.has(name) && this._hasSimpleWidth(code);
    if (p.kind === 'cff' || (p.kind === 'otf' && p.cff && !p.cff.isCID)) {
      const cff = p.cff;
      return !!name && cff.nameToGid && cff.nameToGid.has(name) && name !== '.notdef' && this._hasSimpleWidth(code);
    }
    if (p.kind === 'tt' || p.kind === 'otf') {
      const gid = this._ttGid(code);
      if (!gid) return false;
      const ok = p.tt.hasOutline(gid) || (p.tt.exists(gid) && this._isSpaceUni(this.codeUnis[code] || this.unicode(code)));
      return ok && (this._hasSimpleWidth(code) || p.tt.advance(gid) !== undefined);
    }
    return false;
  }

  _isSpaceUni(u) { return u === ' ' || u === ' '; }

  _hasSimpleWidth(code) {
    if (this.patches.widths.has(code)) return true;
    if (!this.widthsArr) return false;
    const i = code - this.firstChar;
    if (i < 0 || i >= this.widthsArr.length) return false;
    const w = this.widthsArr[i];
    return w > 0 || this._isSpaceUni(this.codeUnis[code]);
  }

  _type3Has(code) {
    const name = this.codeNames[code];
    if (!name || !(this.charProcs instanceof L().PDFDict)) return false;
    return this.charProcs.has(N(name));
  }

  _ttGid(code) {
    const p = this.prog;
    const tt = p.tt;
    const c30 = tt.cmap(3, 0), c31 = tt.cmap(3, 1), c10 = tt.cmap(1, 0);
    if (!c30 && !c31 && !c10) return code < tt.numGlyphs ? code : 0;
    if (c31 && !this.symbolic) {
      const u = this.codeUnis[code];
      if (u && c31.get(u.codePointAt(0))) return c31.get(u.codePointAt(0));
    }
    if (c30) for (const base of [0, 0xf000, 0xf100, 0xf200]) { const g = c30.get(base + code); if (g) return g; }
    if (c10) { const g = c10.get(code); if (g) return g; }
    if (c31) {
      const u = this.codeUnis[code];
      if (u && c31.get(u.codePointAt(0))) return c31.get(u.codePointAt(0));
    }
    return 0;
  }

  // Width (in 1/1000 em) a newly used code should have, from the program if needed.
  _programWidth(code) {
    const p = this.prog;
    if (!p || !(p.kind === 'tt' || p.kind === 'otf')) return undefined;
    if (this.isType0) return p.tt.advance(this.cidToGid(this.codeToCid(code)));
    const g = this._ttGid(code);
    return g ? p.tt.advance(g) : undefined;
  }

  // Map of character -> code for every glyph we may safely use.
  reverseMap() {
    if (this._rev) return this._rev;
    const rev = new Map();
    const consider = (code, u) => {
      if (!u || [...u].length !== 1) return;
      if (rev.has(u)) { // prefer observed codes
        if (this.observed.has(rev.get(u)) || !this.observed.has(code)) return;
      }
      if (this.glyphAvailable(code)) rev.set(u, code);
    };
    for (const [c, u] of this.toUni) consider(c, u);
    if (!this.isType0) {
      for (let c = 0; c < 256; c++) if (!this.toUni.has(c)) consider(c, this.codeUnis[c]);
    } else if (this.identity && this.editable) {
      // full embedded TrueType CID fonts: unicode -> gid -> cid(=code)
      const p = this.prog;
      if (p && (p.kind === 'tt' || p.kind === 'otf') && !p.cff) {
        const m = p.tt.cmap(3, 1) || p.tt.cmap(0, 3) || p.tt.cmap(3, 10);
        if (m) {
          const gidToCid = this.cidToGidIdentity ? null : this._gidToCidMap();
          for (const [u, g] of m) {
            const ch = String.fromCodePoint(u);
            if (rev.has(ch)) continue;
            const cid = gidToCid ? gidToCid.get(g) : g;
            if (cid === undefined || cid > 0xffff) continue;
            if (p.tt.hasOutline(g) || (this._isSpaceUni(ch) && p.tt.exists(g))) rev.set(ch, cid);
          }
        }
      }
    }
    this._rev = rev;
    return rev;
  }

  _gidToCidMap() {
    const m = new Map();
    const b = this._c2gBytes;
    if (!b) return m;
    for (let cid = 0; cid * 2 + 1 < b.length; cid++) {
      const g = (b[cid * 2] << 8) | b[cid * 2 + 1];
      if (g && !m.has(g)) m.set(g, cid);
    }
    return m;
  }

  codeBytes(code) {
    if (!this.isType0) return Uint8Array.of(code & 0xff);
    // determine code length from codespace
    let len = 2;
    if (this.embeddedCMap && this.embeddedCMap.codespace.length) {
      for (const r of this.embeddedCMap.codespace) if (code >= r.lo && code <= r.hi) { len = r.len; break; }
    }
    const out = new Uint8Array(len);
    for (let i = len - 1, v = code; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
    return out;
  }

  // Encode a single character in this font, or null if the font can't draw it.
  encodeChar(ch) {
    if (!this.editable) return null;
    const rev = this.reverseMap();
    if (!rev.has(ch)) return null;
    const code = rev.get(ch);
    return { code, bytes: this.codeBytes(code), width: this.width(code) };
  }

  // Record that we are drawing this code: patch widths/ToUnicode if needed.
  noteUse(code, ch) {
    if (!this.isType0) {
      if (!this._hasSimpleWidth(code)) {
        const w = this._programWidth(code);
        if (w !== undefined) this.patches.widths.set(code, Math.round(w));
      }
    } else {
      const cid = this.codeToCid(code);
      if (!this.cidWidths.has(cid)) {
        const w = this._programWidth(code);
        if (w !== undefined && Math.abs(w - this.dw) > 0.5) this.patches.widths.set(code, Math.round(w));
      }
    }
    if (ch && this.unicode(code) !== ch) this.patches.toUni.set(code, ch);
  }

  // Write width / ToUnicode patches into the PDF objects.
  flushPatches() {
    const Lib = L();
    const ctx = this.ctx;
    if (this.patches.widths.size) {
      if (this.isType0) {
        const W = ctx.obj([]);
        // keep original entries then add ours
        const all = new Map(this.cidWidths);
        for (const [code, w] of this.patches.widths) all.set(this.codeToCid(code), w);
        const sorted = [...all.entries()].sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < sorted.length;) {
          let j = i;
          while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[j][0] + 1 && j - i < 500) j++;
          W.push(ctx.obj(sorted[i][0]));
          W.push(ctx.obj(sorted.slice(i, j + 1).map((e) => e[1])));
          i = j + 1;
        }
        this.cidFont.set(N('W'), W);
        for (const [code, w] of this.patches.widths) this.cidWidths.set(this.codeToCid(code), w);
      } else {
        let first = this.firstChar, ws = this.widthsArr ? this.widthsArr.slice() : [];
        if (!this.widthsArr) { first = 0; ws = []; for (let c = 0; c < 256; c++) ws.push(Math.round((this.width(c)) / this.widthScale)); }
        for (const [code, w] of this.patches.widths) {
          while (code < first) { ws.unshift(this.missingWidth || 0); first--; }
          while (code >= first + ws.length) ws.push(this.missingWidth || 0);
          ws[code - first] = w;
        }
        this.dict.set(N('FirstChar'), ctx.obj(first));
        this.dict.set(N('LastChar'), ctx.obj(first + ws.length - 1));
        this.dict.set(N('Widths'), ctx.obj(ws));
        this.firstChar = first; this.widthsArr = ws;
      }
      this.patches.widths.clear();
    }
    if (this.patches.toUni.size && (this.toUniStream || this.isType0 || this.hasDifferences)) {
      const map = new Map(this.toUni);
      if (!this.toUniStream && !this.isType0) for (let c = 0; c < 256; c++) if (this.codeUnis[c] && !map.has(c)) map.set(c, this.codeUnis[c]);
      for (const [c, u] of this.patches.toUni) map.set(c, u);
      const body = buildToUnicode(map, this.isType0 ? 2 : 1);
      const stream = ctx.flateStream(utf8.encode(body));
      const ref = ctx.register(stream);
      this.dict.set(N('ToUnicode'), ref);
      this.toUni = map;
      this.toUniStream = stream;
      this.patches.toUni.clear();
    }
    this._rev = null;
  }

  // Fallback font family (metric-compatible open fonts we ship)
  fallbackKey() {
    const n = this.cleanName.toLowerCase();
    let fam;
    if (/calibri|carlito/.test(n)) fam = 'Carlito';
    else if (/cambria|caladea/.test(n)) fam = 'Caladea';
    else if (this.mono) fam = 'LiberationMono';
    else if (this.serif) fam = 'LiberationSerif';
    else fam = 'LiberationSans';
    const style = this.bold && this.italic ? 'BoldItalic' : this.bold ? 'Bold' : this.italic ? 'Italic' : 'Regular';
    return `${fam}-${style}`;
  }

  cssFamily() {
    const n = this.cleanName.replace(/[-,].*$/, '').replace(/(MT|PS|PSMT|Std|Pro|LT)$/,'');
    const fb = this.fallbackKey().split('-')[0];
    const map = { Carlito: '"Calibri", "Carlito"', Caladea: '"Cambria", "Caladea"', LiberationMono: '"Courier New", "Liberation Mono", monospace', LiberationSerif: '"Times New Roman", "Liberation Serif", Times, serif', LiberationSans: 'Arial, "Liberation Sans", Helvetica, sans-serif' };
    return `"${n}", ${map[fb]}`;
  }

  describe() {
    return {
      name: this.cleanName,
      embedded: this.isEmbedded,
      subset: this.isSubset,
      type: this.isType0 ? `${this.cidSubtype || 'CID'}` : this.subtype,
      editable: this.editable,
      reason: this.reason,
    };
  }
}

const cache = new WeakMap();
// One FontInfo per font dictionary (shared across pages using the same font).
export function getFont(doc, fontObj, resName) {
  const ctx = doc.context;
  const ref = fontObj instanceof L().PDFRef ? fontObj : null;
  const dict = lookup(ctx, fontObj);
  if (!(dict instanceof L().PDFDict)) return null;
  let perDoc = cache.get(doc);
  if (!perDoc) { perDoc = new Map(); cache.set(doc, perDoc); }
  const key = dict;
  if (perDoc.has(key)) {
    const f = perDoc.get(key);
    return f;
  }
  const f = new FontInfo(doc, dict, resName, ref);
  perDoc.set(key, f);
  return f;
}

export function resetFontCache(doc) { cache.delete(doc); }
