// Content stream tokenizer/parser. Produces a flat list of operations:
//   { op: 'Tj', args: [...], start, end }  (byte offsets into the stream)
// Operand values: number, {name}, {str: Uint8Array, hex}, array, {dict: {...}}, boolean, null.

const WS = new Uint8Array(256);
[0, 9, 10, 12, 13, 32].forEach((c) => (WS[c] = 1));
const DELIM = new Uint8Array(256);
'()<>[]{}/%'.split('').forEach((c) => (DELIM[c.charCodeAt(0)] = 1));

export class Lexer {
  constructor(bytes) {
    this.b = bytes;
    this.p = 0;
    this.n = bytes.length;
  }

  skipWS() {
    const b = this.b;
    while (this.p < this.n) {
      const c = b[this.p];
      if (WS[c]) { this.p++; continue; }
      if (c === 37) { // % comment
        while (this.p < this.n && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
        continue;
      }
      break;
    }
  }

  // Returns a token: {t:'num'|'name'|'str'|'op'|'[',']','<<','>>','eof', v}
  next() {
    this.skipWS();
    const b = this.b;
    if (this.p >= this.n) return { t: 'eof', s: this.p };
    const s = this.p;
    const c = b[this.p];
    if (c === 40) return { t: 'str', v: this.literal(), hex: false, s };
    if (c === 60) {
      if (b[this.p + 1] === 60) { this.p += 2; return { t: '<<', s }; }
      return { t: 'str', v: this.hexstr(), hex: true, s };
    }
    if (c === 62) {
      if (b[this.p + 1] === 62) { this.p += 2; return { t: '>>', s }; }
      this.p++; return { t: 'junk', s };
    }
    if (c === 91) { this.p++; return { t: '[', s }; }
    if (c === 93) { this.p++; return { t: ']', s }; }
    if (c === 123 || c === 125) { this.p++; return { t: 'junk', s }; }
    if (c === 47) { this.p++; return { t: 'name', v: this.regular(true), s }; }
    // number?
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      const w = this.regular(false);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return { t: 'num', v: parseFloat(w), s };
      // malformed numbers like "--1" or "1.2.3": try to salvage
      const m = w.match(/[+-]?(\d+\.?\d*|\.\d+)/);
      if (m && /^[+\-.\d]+$/.test(w)) return { t: 'num', v: parseFloat(m[0]) || 0, s };
      return { t: 'op', v: w, s };
    }
    const w = this.regular(false);
    if (w === 'true') return { t: 'bool', v: true, s };
    if (w === 'false') return { t: 'bool', v: false, s };
    if (w === 'null') return { t: 'null', v: null, s };
    if (w.length === 0) { this.p++; return { t: 'junk', s }; }
    return { t: 'op', v: w, s };
  }

  regular(isName) {
    const b = this.b;
    let out = '';
    while (this.p < this.n) {
      const c = b[this.p];
      if (WS[c] || DELIM[c]) break;
      if (isName && c === 35 && this.p + 2 < this.n) { // #xx
        const h = String.fromCharCode(b[this.p + 1], b[this.p + 2]);
        if (/^[0-9a-fA-F]{2}$/.test(h)) { out += String.fromCharCode(parseInt(h, 16)); this.p += 3; continue; }
      }
      out += String.fromCharCode(c);
      this.p++;
    }
    return out;
  }

  literal() {
    const b = this.b;
    this.p++; // (
    let depth = 1;
    const out = [];
    while (this.p < this.n) {
      let c = b[this.p++];
      if (c === 92) { // backslash
        if (this.p >= this.n) break;
        c = b[this.p++];
        switch (c) {
          case 110: out.push(10); break; // n
          case 114: out.push(13); break; // r
          case 116: out.push(9); break; // t
          case 98: out.push(8); break; // b
          case 102: out.push(12); break; // f
          case 40: case 41: case 92: out.push(c); break;
          case 13: if (b[this.p] === 10) this.p++; break; // line continuation
          case 10: break;
          default:
            if (c >= 48 && c <= 55) {
              let v = c - 48;
              for (let k = 0; k < 2 && this.p < this.n && b[this.p] >= 48 && b[this.p] <= 55; k++) v = v * 8 + (b[this.p++] - 48);
              out.push(v & 0xff);
            } else out.push(c);
        }
        continue;
      }
      if (c === 40) depth++;
      else if (c === 41) { depth--; if (depth === 0) break; }
      out.push(c);
    }
    return Uint8Array.from(out);
  }

  hexstr() {
    const b = this.b;
    this.p++; // <
    const out = [];
    let hi = -1;
    while (this.p < this.n) {
      const c = b[this.p++];
      if (c === 62) break;
      let v = -1;
      if (c >= 48 && c <= 57) v = c - 48;
      else if (c >= 65 && c <= 70) v = c - 55;
      else if (c >= 97 && c <= 102) v = c - 87;
      if (v < 0) continue;
      if (hi < 0) hi = v; else { out.push(hi * 16 + v); hi = -1; }
    }
    if (hi >= 0) out.push(hi * 16);
    return Uint8Array.from(out);
  }
}

function valueOf(tok) {
  switch (tok.t) {
    case 'num': return tok.v;
    case 'name': return { name: tok.v };
    case 'str': return { str: tok.v, hex: tok.hex };
    case 'bool': return tok.v;
    case 'null': return null;
    default: return undefined;
  }
}

// Parse the full content stream into operations.
export function parseContent(bytes) {
  const lx = new Lexer(bytes);
  const ops = [];
  let stack = []; // operand stack
  let opStart = -1;
  const containers = []; // nested arrays / dicts

  const push = (v) => {
    if (containers.length) {
      const top = containers[containers.length - 1];
      if (top.kind === 'arr') top.v.push(v);
      else {
        if (top.key === null) {
          if (v && v.name !== undefined) top.key = v.name; // expecting a key
        } else { top.v[top.key] = v; top.key = null; }
      }
    } else stack.push(v);
  };

  for (;;) {
    const tok = lx.next();
    if (tok.t === 'eof') break;
    if (opStart < 0) opStart = tok.s;
    switch (tok.t) {
      case '[': containers.push({ kind: 'arr', v: [] }); break;
      case ']': {
        const top = containers.pop();
        if (top) push(top.kind === 'arr' ? top.v : { dict: top.v });
        break;
      }
      case '<<': containers.push({ kind: 'dict', v: {}, key: null }); break;
      case '>>': {
        const top = containers.pop();
        if (top) push(top.kind === 'dict' ? { dict: top.v } : top.v);
        break;
      }
      case 'op': {
        if (containers.length) { // stray operator inside array: treat as junk value
          break;
        }
        if (tok.v === 'BI') {
          // inline image: key/value pairs until ID, then binary data until EI
          const startBI = opStart;
          const dict = {};
          let key = null;
          for (;;) {
            const t2 = lx.next();
            if (t2.t === 'eof') break;
            if (t2.t === 'op' && t2.v === 'ID') break;
            if (key === null && t2.t === 'name') { key = t2.v; continue; }
            if (key !== null) {
              if (t2.t === '[') { // simple array of values
                const a = [];
                for (;;) { const t3 = lx.next(); if (t3.t === ']' || t3.t === 'eof') break; a.push(valueOf(t3)); }
                dict[key] = a;
              } else dict[key] = valueOf(t2) ?? (t2.t === 'op' ? { name: t2.v } : null);
              key = null;
            }
          }
          // skip single whitespace after ID
          if (lx.p < lx.n && WS[lx.b[lx.p]]) lx.p++;
          const dataStart = lx.p;
          const b = lx.b;
          let end = -1;
          for (let i = dataStart; i < lx.n - 1; i++) {
            if (b[i] === 69 && b[i + 1] === 73 && (i === dataStart || WS[b[i - 1]]) && (i + 2 >= lx.n || WS[b[i + 2]] || DELIM[b[i + 2]])) {
              // verify following bytes look like content (not binary garbage)
              let ok = true;
              for (let k = i + 2; k < Math.min(lx.n, i + 40); k++) {
                const ch = b[k];
                if (ch > 126 || (ch < 32 && !WS[ch])) { ok = false; break; }
              }
              if (ok) { end = i; break; }
            }
          }
          if (end < 0) end = lx.n - 2;
          lx.p = Math.min(lx.n, end + 2);
          ops.push({ op: 'BI', args: [{ dict }], start: startBI, end: lx.p });
          stack = []; opStart = -1;
          break;
        }
        ops.push({ op: tok.v, args: stack, start: opStart, end: lx.p });
        stack = []; opStart = -1;
        break;
      }
      case 'junk': break;
      default: push(valueOf(tok));
    }
  }
  return ops;
}
