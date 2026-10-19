// Minimal readers for embedded font programs. They answer two questions the
// text editor needs: "does this glyph really exist in the (possibly subset)
// embedded font?" and "how wide is it?".

class Reader {
  constructor(b, p = 0) { this.b = b; this.p = p; }
  u8() { return this.b[this.p++]; }
  u16() { const v = (this.b[this.p] << 8) | this.b[this.p + 1]; this.p += 2; return v; }
  i16() { const v = this.u16(); return v & 0x8000 ? v - 0x10000 : v; }
  u32() { const v = ((this.b[this.p] << 24) >>> 0) + (this.b[this.p + 1] << 16) + (this.b[this.p + 2] << 8) + this.b[this.p + 3]; this.p += 4; return v >>> 0; }
  tag() { const s = String.fromCharCode(this.b[this.p], this.b[this.p + 1], this.b[this.p + 2], this.b[this.p + 3]); this.p += 4; return s; }
}

// ---------------------------------------------------------------- TrueType
export function parseTrueType(bytes) {
  const r = new Reader(bytes);
  let sfnt = r.u32();
  if (sfnt === 0x74746366) { // 'ttcf' collection: use first font
    r.u32(); r.u32();
    r.p = r.u32();
    sfnt = r.u32();
  }
  const numTables = r.u16();
  r.p += 6;
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const tag = r.tag(); r.u32();
    const off = r.u32(); const len = r.u32();
    tables[tag] = { off, len };
  }
  const font = { tables, unitsPerEm: 1000, numGlyphs: 0, cmaps: [] };
  if (tables.head) {
    const h = new Reader(bytes, tables.head.off + 18);
    font.unitsPerEm = h.u16() || 1000;
    h.p = tables.head.off + 50;
    font.indexToLocFormat = h.i16();
  }
  if (tables.maxp) font.numGlyphs = new Reader(bytes, tables.maxp.off + 4).u16();
  let numHMetrics = 0;
  if (tables.hhea) numHMetrics = new Reader(bytes, tables.hhea.off + 34).u16();
  const hmtxOff = tables.hmtx ? tables.hmtx.off : -1;
  font.advance = (gid) => {
    if (hmtxOff < 0 || numHMetrics === 0) return undefined;
    const idx = Math.min(gid, numHMetrics - 1);
    const p = hmtxOff + idx * 4;
    if (p + 2 > bytes.length) return undefined;
    return ((bytes[p] << 8) | bytes[p + 1]) * 1000 / font.unitsPerEm;
  };
  let loca = null;
  if (tables.loca && tables.glyf) {
    const n = font.numGlyphs + 1;
    loca = new Uint32Array(n);
    const lr = new Reader(bytes, tables.loca.off);
    for (let i = 0; i < n; i++) {
      if (lr.p + (font.indexToLocFormat ? 4 : 2) > tables.loca.off + tables.loca.len) { loca[i] = loca[i - 1] || 0; continue; }
      loca[i] = font.indexToLocFormat ? lr.u32() : lr.u16() * 2;
    }
  }
  // A glyph "has outline" when its glyf entry is non-empty.
  font.hasOutline = (gid) => {
    if (gid <= 0 || gid >= font.numGlyphs) return false;
    if (!loca) return true; // CFF-flavoured or unknown: assume present
    return loca[gid + 1] > loca[gid];
  };
  font.exists = (gid) => gid > 0 && gid < font.numGlyphs;
  if (tables.cmap) {
    const base = tables.cmap.off;
    const cr = new Reader(bytes, base + 2);
    const n = cr.u16();
    for (let i = 0; i < n; i++) {
      const pid = cr.u16(); const eid = cr.u16(); const off = cr.u32();
      try {
        const map = readCmapSubtable(bytes, base + off);
        if (map) font.cmaps.push({ pid, eid, map });
      } catch (e) { /* ignore broken subtable */ }
    }
  }
  font.cmap = (pid, eid) => {
    const c = font.cmaps.find((x) => x.pid === pid && x.eid === eid);
    return c ? c.map : null;
  };
  return font;
}

function readCmapSubtable(b, off) {
  const r = new Reader(b, off);
  const format = r.u16();
  const map = new Map();
  if (format === 0) {
    r.u16(); r.u16();
    for (let c = 0; c < 256; c++) { const g = r.u8(); if (g) map.set(c, g); }
  } else if (format === 4) {
    r.u16(); r.u16();
    const segX2 = r.u16(); const seg = segX2 / 2;
    r.p += 6;
    const endP = r.p, startP = endP + segX2 + 2, deltaP = startP + segX2, rangeP = deltaP + segX2;
    const rd = (p) => (b[p] << 8) | b[p + 1];
    for (let i = 0; i < seg; i++) {
      const end = rd(endP + i * 2), start = rd(startP + i * 2);
      let delta = rd(deltaP + i * 2); const ro = rd(rangeP + i * 2);
      if (start > end) continue;
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gp = rangeP + i * 2 + ro + (c - start) * 2;
          if (gp + 1 >= b.length) continue;
          g = rd(gp);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else if (format === 6) {
    r.u16(); r.u16();
    const first = r.u16(); const count = r.u16();
    for (let i = 0; i < count; i++) { const g = r.u16(); if (g) map.set(first + i, g); }
  } else if (format === 12) {
    r.u16(); r.u32(); r.u32();
    const n = r.u32();
    for (let i = 0; i < n && i < 100000; i++) {
      const s = r.u32(), e = r.u32(), g = r.u32();
      for (let c = s; c <= e && c - s < 70000; c++) map.set(c, g + (c - s));
    }
  } else return null;
  return map;
}

// ---------------------------------------------------------------- CFF
const STD_STRINGS = (() => {
  const a = ['.notdef', 'space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quoteright', 'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash', 'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'colon', 'semicolon', 'less', 'equal', 'greater', 'question', 'at'];
  for (let c = 65; c <= 90; c++) a.push(String.fromCharCode(c));
  a.push('bracketleft', 'backslash', 'bracketright', 'asciicircum', 'underscore', 'quoteleft');
  for (let c = 97; c <= 122; c++) a.push(String.fromCharCode(c));
  a.push('braceleft', 'bar', 'braceright', 'asciitilde', 'exclamdown', 'cent', 'sterling', 'fraction', 'yen', 'florin', 'section', 'currency', 'quotesingle', 'quotedblleft', 'guillemotleft', 'guilsinglleft', 'guilsinglright', 'fi', 'fl', 'endash', 'dagger', 'daggerdbl', 'periodcentered', 'paragraph', 'bullet', 'quotesinglbase', 'quotedblbase', 'quotedblright', 'guillemotright', 'ellipsis', 'perthousand', 'questiondown', 'grave', 'acute', 'circumflex', 'tilde', 'macron', 'breve', 'dotaccent', 'dieresis', 'ring', 'cedilla', 'hungarumlaut', 'ogonek', 'caron', 'emdash', 'AE', 'ordfeminine', 'Lslash', 'Oslash', 'OE', 'ordmasculine', 'ae', 'dotlessi', 'lslash', 'oslash', 'oe', 'germandbls', 'onesuperior', 'logicalnot', 'mu', 'trademark', 'Eth', 'onehalf', 'plusminus', 'Thorn', 'onequarter', 'divide', 'brokenbar', 'degree', 'thorn', 'threequarters', 'twosuperior', 'registered', 'minus', 'eth', 'multiply', 'threesuperior', 'copyright', 'Aacute', 'Acircumflex', 'Adieresis', 'Agrave', 'Aring', 'Atilde', 'Ccedilla', 'Eacute', 'Ecircumflex', 'Edieresis', 'Egrave', 'Iacute', 'Icircumflex', 'Idieresis', 'Igrave', 'Ntilde', 'Oacute', 'Ocircumflex', 'Odieresis', 'Ograve', 'Otilde', 'Scaron', 'Uacute', 'Ucircumflex', 'Udieresis', 'Ugrave', 'Yacute', 'Ydieresis', 'Zcaron', 'aacute', 'acircumflex', 'adieresis', 'agrave', 'aring', 'atilde', 'ccedilla', 'eacute', 'ecircumflex', 'edieresis', 'egrave', 'iacute', 'icircumflex', 'idieresis', 'igrave', 'ntilde', 'oacute', 'ocircumflex', 'odieresis', 'ograve', 'otilde', 'scaron', 'uacute', 'ucircumflex', 'udieresis', 'ugrave', 'yacute', 'ydieresis', 'zcaron');
  while (a.length < 391) a.push(`.cffstd${a.length}`);
  return a;
})();

function cffIndex(b, p) {
  const count = (b[p] << 8) | b[p + 1];
  if (count === 0) return { items: [], end: p + 2 };
  const offSize = b[p + 2];
  const offs = [];
  let q = p + 3;
  for (let i = 0; i <= count; i++) {
    let v = 0;
    for (let k = 0; k < offSize; k++) v = v * 256 + b[q++];
    offs.push(v);
  }
  const dataStart = q - 1;
  const items = [];
  for (let i = 0; i < count; i++) items.push([dataStart + offs[i], dataStart + offs[i + 1]]);
  return { items, end: dataStart + offs[count] };
}

function cffDict(b, s, e) {
  const d = {};
  let ops = [];
  let p = s;
  while (p < e) {
    const v = b[p];
    if (v <= 21) {
      let key = v; p++;
      if (v === 12) { key = 1200 + b[p]; p++; }
      d[key] = ops; ops = [];
    } else if (v === 28) { ops.push(((b[p + 1] << 24) >> 16) | b[p + 2]); p += 3; }
    else if (v === 29) { ops.push((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]); p += 5; }
    else if (v === 30) { // real
      p++;
      let str = '';
      const nib = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'E', 'E-', '', '-', ''];
      for (;;) {
        const x = b[p++];
        const a1 = x >> 4, a2 = x & 15;
        if (a1 === 15) break; str += nib[a1];
        if (a2 === 15) break; str += nib[a2];
      }
      ops.push(parseFloat(str));
    } else if (v >= 32 && v <= 246) { ops.push(v - 139); p++; }
    else if (v >= 247 && v <= 250) { ops.push((v - 247) * 256 + b[p + 1] + 108); p += 2; }
    else if (v >= 251 && v <= 254) { ops.push(-(v - 251) * 256 - b[p + 1] - 108); p += 2; }
    else p++;
  }
  return d;
}

export function parseCFF(bytes) {
  const b = bytes;
  const hdrSize = b[2];
  const nameIdx = cffIndex(b, hdrSize);
  const topIdx = cffIndex(b, nameIdx.end);
  const strIdx = cffIndex(b, topIdx.end);
  const strings = strIdx.items.map(([s, e]) => String.fromCharCode(...b.subarray(s, e)));
  const sid = (n) => (n < 391 ? STD_STRINGS[n] : strings[n - 391]);
  if (!topIdx.items.length) throw new Error('CFF without top dict');
  const top = cffDict(b, topIdx.items[0][0], topIdx.items[0][1]);
  const isCID = top[1230] !== undefined;
  const csOff = top[17] ? top[17][0] : 0;
  const cs = cffIndex(b, csOff);
  const nGlyphs = cs.items.length;
  // charset: gid -> sid (or cid)
  const gidTo = new Array(nGlyphs).fill(0);
  const csetOff = top[15] ? top[15][0] : 0;
  if (csetOff === 0 && !isCID) for (let g = 1; g < nGlyphs; g++) gidTo[g] = g; // ISOAdobe
  else if (csetOff > 2) {
    let p = csetOff;
    const fmt = b[p++];
    let g = 1;
    if (fmt === 0) { while (g < nGlyphs) { gidTo[g++] = (b[p] << 8) | b[p + 1]; p += 2; } }
    else if (fmt === 1 || fmt === 2) {
      while (g < nGlyphs && p < b.length) {
        const first = (b[p] << 8) | b[p + 1]; p += 2;
        let left;
        if (fmt === 1) left = b[p++]; else { left = (b[p] << 8) | b[p + 1]; p += 2; }
        for (let k = 0; k <= left && g < nGlyphs; k++) gidTo[g++] = first + k;
      }
    }
  } else if (isCID) for (let g = 1; g < nGlyphs; g++) gidTo[g] = g;
  const res = { isCID, nGlyphs };
  if (isCID) {
    res.cidToGid = new Map();
    gidTo.forEach((cid, g) => res.cidToGid.set(cid, g));
    res.cidToGid.set(0, 0);
  } else {
    res.names = gidTo.map((s, g) => (g === 0 ? '.notdef' : sid(s)));
    res.nameToGid = new Map();
    res.names.forEach((n, g) => res.nameToGid.set(n, g));
    // built-in encoding
    const encOff = top[16] ? top[16][0] : 0;
    res.encoding = null; // null = StandardEncoding
    if (encOff > 1) {
      const enc = new Array(256).fill(undefined);
      let p = encOff;
      const fmt = b[p++];
      if ((fmt & 0x7f) === 0) {
        const n = b[p++];
        for (let i = 1; i <= n; i++) enc[b[p++]] = res.names[i];
      } else if ((fmt & 0x7f) === 1) {
        const nr = b[p++];
        let g = 1;
        for (let i = 0; i < nr; i++) {
          const first = b[p++], left = b[p++];
          for (let k = 0; k <= left; k++) enc[first + k] = res.names[g++];
        }
      }
      if (fmt & 0x80) {
        const ns = b[p++];
        for (let i = 0; i < ns; i++) { const code = b[p++]; const s = (b[p] << 8) | b[p + 1]; p += 2; enc[code] = sid(s); }
      }
      res.encoding = enc;
    }
  }
  return res;
}

// ---------------------------------------------------------------- Type 1
export function parseType1(bytes, len1, len2) {
  let clear = bytes;
  let enc = bytes.subarray(0);
  // PFB segments?
  if (bytes[0] === 0x80 && bytes[1] === 1) {
    const segs = [];
    let p = 0;
    while (p < bytes.length && bytes[p] === 0x80 && bytes[p + 1] !== 3) {
      const type = bytes[p + 1];
      const len = bytes[p + 2] | (bytes[p + 3] << 8) | (bytes[p + 4] << 16) | (bytes[p + 5] << 24);
      segs.push({ type, data: bytes.subarray(p + 6, p + 6 + len) });
      p += 6 + len;
    }
    clear = segs[0] ? segs[0].data : bytes;
    enc = segs[1] ? segs[1].data : new Uint8Array();
  } else if (len1 > 0 && len1 < bytes.length) {
    clear = bytes.subarray(0, len1);
    enc = bytes.subarray(len1, len2 ? len1 + len2 : bytes.length);
  } else {
    // find "eexec"
    const s = latin1Slice(bytes, 0, Math.min(bytes.length, 65536));
    const i = s.indexOf('eexec');
    if (i >= 0) {
      let j = i + 5;
      while (j < bytes.length && (bytes[j] === 13 || bytes[j] === 10 || bytes[j] === 32 || bytes[j] === 9)) j++;
      clear = bytes.subarray(0, j);
      enc = bytes.subarray(j);
    }
  }
  const clearStr = latin1Slice(clear, 0, clear.length);
  let encoding = null; // null = StandardEncoding
  if (!/\/Encoding\s+StandardEncoding\s+def/.test(clearStr)) {
    const re = /dup\s+(\d+)\s*\/([^\s{}()<>\[\]\/]+)\s+put/g;
    let m;
    const e = new Array(256).fill(undefined);
    let any = false;
    while ((m = re.exec(clearStr))) { const c = +m[1]; if (c < 256) { e[c] = m[2]; any = true; } }
    if (any) encoding = e;
  }
  // Is the encrypted part hex?
  let data = enc;
  if (data.length >= 4 && isHexDigit(data[0]) && isHexDigit(data[1]) && isHexDigit(data[2]) && isHexDigit(data[3])) {
    const out = [];
    let hi = -1;
    for (const c of data) {
      const v = hexVal(c);
      if (v < 0) continue;
      if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    data = Uint8Array.from(out);
  }
  const dec = eexecDecrypt(data, 55665);
  const ds = latin1Slice(dec, 4, dec.length);
  const glyphs = new Set();
  const csIdx = ds.indexOf('/CharStrings');
  if (csIdx >= 0) {
    const re = /\/([^\s{}()<>\[\]\/]+)\s+(\d+)\s+(RD|-\|)\s/g;
    re.lastIndex = csIdx;
    let m;
    while ((m = re.exec(ds))) {
      glyphs.add(m[1]);
      re.lastIndex = m.index + m[0].length + parseInt(m[2], 10);
    }
  }
  return { encoding, glyphs };
}

function eexecDecrypt(data, key) {
  let r = key;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    out[i] = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
  }
  return out;
}
const isHexDigit = (c) => hexVal(c) >= 0;
function hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}
function latin1Slice(b, s, e) {
  let out = '';
  for (let i = s; i < e; i += 8192) out += String.fromCharCode.apply(null, b.subarray(i, Math.min(e, i + 8192)));
  return out;
}
