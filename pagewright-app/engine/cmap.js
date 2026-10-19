// CMap parsing: ToUnicode (bfchar/bfrange) and embedded CID CMaps
// (codespace ranges + cidchar/cidrange).

import { Lexer } from './lexer.js';

function bytesToInt(b) { let v = 0; for (const x of b) v = v * 256 + x; return v; }

function utf16beToString(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  if (b.length % 2 === 1) s += String.fromCharCode(b[b.length - 1]);
  return s;
}

export function parseCMap(bytes) {
  const lx = new Lexer(bytes);
  const res = {
    codespace: [], // {len, lo, hi}
    toUni: new Map(), // code -> string
    cid: new Map(), // code -> cid
    cidRanges: [], // {lo, hi, cid, len}
    wmode: 0,
    usecmap: null,
  };
  const stack = [];
  let mode = null;
  for (;;) {
    const t = lx.next();
    if (t.t === 'eof') break;
    if (t.t === 'op') {
      const op = t.v;
      if (op === 'begincodespacerange') { mode = 'cs'; stack.length = 0; continue; }
      if (op === 'beginbfchar') { mode = 'bfchar'; stack.length = 0; continue; }
      if (op === 'beginbfrange') { mode = 'bfrange'; stack.length = 0; continue; }
      if (op === 'begincidchar') { mode = 'cidchar'; stack.length = 0; continue; }
      if (op === 'begincidrange') { mode = 'cidrange'; stack.length = 0; continue; }
      if (op === 'usecmap') { const n = stack.pop(); if (n && n.name) res.usecmap = n.name; stack.length = 0; continue; }
      if (op === 'def') {
        if (stack.length >= 2 && stack[stack.length - 2] && stack[stack.length - 2].name === 'WMode') res.wmode = stack[stack.length - 1];
        stack.length = 0; continue;
      }
      if (op.startsWith('end') && mode) {
        if (mode === 'cs') {
          for (let i = 0; i + 1 < stack.length; i += 2) {
            const lo = stack[i], hi = stack[i + 1];
            if (lo && lo.str && hi && hi.str) res.codespace.push({ len: lo.str.length, lo: bytesToInt(lo.str), hi: bytesToInt(hi.str), loB: lo.str, hiB: hi.str });
          }
        } else if (mode === 'bfchar') {
          for (let i = 0; i + 1 < stack.length; i += 2) {
            const src = stack[i], dst = stack[i + 1];
            if (!src || !src.str) continue;
            if (dst && dst.str) res.toUni.set(bytesToInt(src.str), utf16beToString(dst.str));
            else if (dst && dst.name) res.toUni.set(bytesToInt(src.str), dst.name);
          }
        } else if (mode === 'bfrange') {
          for (let i = 0; i + 2 < stack.length; i += 3) {
            const lo = stack[i], hi = stack[i + 1], dst = stack[i + 2];
            if (!lo || !lo.str || !hi || !hi.str) continue;
            const a = bytesToInt(lo.str), b = bytesToInt(hi.str);
            if (b < a || b - a > 65536) continue;
            if (Array.isArray(dst)) {
              for (let c = a, k = 0; c <= b && k < dst.length; c++, k++) if (dst[k] && dst[k].str) res.toUni.set(c, utf16beToString(dst[k].str));
            } else if (dst && dst.str) {
              const base = utf16beToString(dst.str);
              const last = base.charCodeAt(base.length - 1);
              const prefix = base.slice(0, -1);
              for (let c = a; c <= b; c++) {
                const v = last + (c - a);
                res.toUni.set(c, prefix + (v > 0xffff ? String.fromCodePoint(v) : String.fromCharCode(v)));
              }
            }
          }
        } else if (mode === 'cidchar') {
          for (let i = 0; i + 1 < stack.length; i += 2) {
            const src = stack[i], cid = stack[i + 1];
            if (src && src.str && typeof cid === 'number') res.cid.set(bytesToInt(src.str), cid);
          }
        } else if (mode === 'cidrange') {
          for (let i = 0; i + 2 < stack.length; i += 3) {
            const lo = stack[i], hi = stack[i + 1], cid = stack[i + 2];
            if (lo && lo.str && hi && hi.str && typeof cid === 'number') res.cidRanges.push({ lo: bytesToInt(lo.str), hi: bytesToInt(hi.str), cid, len: lo.str.length });
          }
        }
        mode = null; stack.length = 0; continue;
      }
      stack.length = 0;
      continue;
    }
    if (t.t === 'num') stack.push(t.v);
    else if (t.t === 'str') stack.push({ str: t.v });
    else if (t.t === 'name') stack.push({ name: t.v });
    else if (t.t === '[') {
      const a = [];
      for (;;) { const t2 = lx.next(); if (t2.t === ']' || t2.t === 'eof') break; if (t2.t === 'str') a.push({ str: t2.v }); else if (t2.t === 'num') a.push(t2.v); }
      stack.push(a);
    }
  }
  return res;
}

// Split a byte string into codes given codespace ranges (falls back to fixed length)
export function makeSplitter(codespace, defaultLen) {
  if (!codespace || !codespace.length) {
    return (bytes) => {
      const out = [];
      for (let i = 0; i + defaultLen <= bytes.length; i += defaultLen) {
        let v = 0; for (let k = 0; k < defaultLen; k++) v = v * 256 + bytes[i + k];
        out.push({ code: v, len: defaultLen, off: i });
      }
      return out;
    };
  }
  const byLen = [1, 2, 3, 4].map((n) => codespace.filter((c) => c.len === n));
  return (bytes) => {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      let matched = false;
      let v = 0;
      for (let n = 1; n <= 4 && i + n <= bytes.length; n++) {
        v = v * 256 + bytes[i + n - 1];
        const ranges = byLen[n - 1];
        for (const r of ranges) {
          // each byte must lie within the corresponding byte range
          let ok = true;
          for (let k = 0; k < n; k++) { const bb = bytes[i + k]; if (bb < r.loB[k] || bb > r.hiB[k]) { ok = false; break; } }
          if (ok) { out.push({ code: v, len: n, off: i }); i += n; matched = true; break; }
        }
        if (matched) break;
      }
      if (!matched) {
        const n = Math.min(defaultLen, bytes.length - i) || 1;
        let w = 0; for (let k = 0; k < n; k++) w = w * 256 + bytes[i + k];
        out.push({ code: w, len: n, off: i });
        i += n;
      }
    }
    return out;
  };
}

// Build a ToUnicode CMap stream body from a code->string map.
export function buildToUnicode(map, codeLen) {
  const hex = (v, n) => v.toString(16).toUpperCase().padStart(n * 2, '0');
  const uniHex = (s) => {
    let h = '';
    for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0');
    return h;
  };
  const entries = [...map.entries()].filter(([, s]) => typeof s === 'string' && s.length).sort((a, b) => a[0] - b[0]);
  let out = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n';
  out += `1 begincodespacerange\n<${hex(0, codeLen)}> <${hex(codeLen === 1 ? 0xff : 0xffff, codeLen)}>\nendcodespacerange\n`;
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    out += `${chunk.length} beginbfchar\n`;
    for (const [c, s] of chunk) out += `<${hex(c, codeLen)}> <${uniHex(s)}>\n`;
    out += 'endbfchar\n';
  }
  out += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  return out;
}
