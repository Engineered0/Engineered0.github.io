// Walks a page's content (and nested Form XObjects), tracking graphics and
// text state, and records every text-showing operation with glyph positions.

import { L, N, dget, nameOf, num, numArr, streamBytes, lookup, mul, apply, inv, IDENT, concatBytes, enc } from './pdfobj.js';
import { parseContent } from './lexer.js';
import { getFont } from './fonts.js';

function pageContentStreams(page) {
  const ctx = page.node.context;
  const raw = page.node.get(N('Contents'));
  const out = [];
  if (!raw) return out;
  const v = lookup(ctx, raw);
  if (v instanceof L().PDFArray) {
    for (let i = 0; i < v.size(); i++) {
      const r = v.get(i);
      const s = lookup(ctx, r);
      if (s instanceof L().PDFStream) out.push({ ref: r instanceof L().PDFRef ? r : null, stream: s });
    }
  } else if (v instanceof L().PDFStream) out.push({ ref: raw instanceof L().PDFRef ? raw : null, stream: v });
  return out;
}

export function pageContentBytes(page) {
  const parts = [];
  for (const { stream } of pageContentStreams(page)) {
    try { parts.push(streamBytes(stream)); } catch (e) { /* undecodable stream: skip */ }
    parts.push(enc.encode('\n'));
  }
  return concatBytes(parts);
}

export { pageContentStreams };

function fillFromOp(op, args, cur) {
  switch (op) {
    case 'g': return { space: 'DeviceGray', vals: [args[0] ?? 0] };
    case 'rg': return { space: 'DeviceRGB', vals: [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0] };
    case 'k': return { space: 'DeviceCMYK', vals: [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 1] };
    case 'cs': {
      const n = args[0] && args[0].name;
      if (n === 'DeviceGray' || n === 'G') return { space: 'DeviceGray', vals: [0], named: null };
      if (n === 'DeviceRGB' || n === 'RGB') return { space: 'DeviceRGB', vals: [0, 0, 0], named: null };
      if (n === 'DeviceCMYK' || n === 'CMYK') return { space: 'DeviceCMYK', vals: [0, 0, 0, 1], named: null };
      return { space: 'Named', named: n, vals: [] };
    }
    case 'sc': case 'scn': {
      const vals = args.filter((a) => typeof a === 'number');
      const pat = args.find((a) => a && a.name);
      return { ...cur, vals, pattern: pat ? pat.name : undefined };
    }
    default: return cur;
  }
}

export function colorOps(c) {
  const f = (v) => +(+v).toFixed(4);
  if (!c) return '0 g';
  if (c.space === 'DeviceGray') return `${f(c.vals[0])} g`;
  if (c.space === 'DeviceRGB') return `${c.vals.map(f).join(' ')} rg`;
  if (c.space === 'DeviceCMYK') return `${c.vals.map(f).join(' ')} k`;
  if (c.space === 'Named') {
    const nm = '/' + c.named.replace(/[^A-Za-z0-9_.\-+]/g, (ch) => '#' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
    return `${nm} cs ${c.vals.map(f).join(' ')}${c.pattern ? ' /' + c.pattern : ''} scn`;
  }
  return '0 g';
}

// Approximate sRGB of a fill colour (for UI display)
export function colorToRGB(c) {
  if (!c) return [0, 0, 0];
  const v = c.vals || [];
  if (c.space === 'DeviceGray') return [v[0], v[0], v[0]];
  if (c.space === 'DeviceRGB') return [v[0], v[1], v[2]];
  if (c.space === 'DeviceCMYK') { const [C, M, Y, K] = v; return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)]; }
  if (v.length === 1) { const t = Math.max(0, Math.min(1, 1 - v[0])); return [t, t, t]; }
  if (v.length === 3) return v;
  if (v.length === 4) { const [C, M, Y, K] = v; return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)]; }
  return [0, 0, 0];
}

class Interp {
  constructor(doc, pageIndex) {
    this.doc = doc;
    this.ctx = doc.context;
    this.pageIndex = pageIndex;
    this.runs = [];
    this.owners = [];
    this.formOwners = new Map();
    this.fonts = new Set();
  }

  resolveFont(resources, name) {
    const fdict = dget(this.ctx, resources, 'Font');
    if (!(fdict instanceof L().PDFDict)) return null;
    const fo = fdict.get(N(name));
    if (!fo) return null;
    const f = getFont(this.doc, fo, name);
    if (f) this.fonts.add(f);
    return f;
  }

  run(owner, bytes, resources, baseCtm, depth, stack) {
    const ops = parseContent(bytes);
    owner.ops = ops;
    let gs = {
      ctm: IDENT.slice(), fill: { space: 'DeviceGray', vals: [0] },
      Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, fontName: null, Tfs: 0, Tr: 0, Ts: 0,
    };
    const gstack = [];
    let Tm = IDENT.slice(), Tlm = IDENT.slice();
    let inText = false;

    const show = (opIdx, opRec, items) => {
      const font = gs.font;
      if (!font) return;
      const run = {
        owner, opIndex: opIdx, op: opRec, font, fontName: gs.fontName,
        Tfs: gs.Tfs, Tc: gs.Tc, Tw: gs.Tw, Th: gs.Th, Ts: gs.Ts, Tr: gs.Tr, TL: gs.TL,
        fill: gs.fill, ctm: gs.ctm.slice(), baseCtm, tlm: Tlm.slice(), tmStart: Tm.slice(),
        glyphs: [],
      };
      let x = 0;
      const Tfs = gs.Tfs, Th = gs.Th;
      for (const it of items) {
        if (typeof it === 'number') {
          const d = -it / 1000 * Tfs * Th;
          x += d;
          if (run.glyphs.length) run.glyphs[run.glyphs.length - 1].kernAfter += d;
          else run.leadKern = (run.leadKern || 0) + d;
          continue;
        }
        if (!it || !it.str) continue;
        const bytesIn = it.str;
        const codes = font.split(bytesIn);
        for (const c of codes) {
          const w0 = font.width(c.code);
          const isSpace = c.len === 1 && c.code === 32;
          const adv = (w0 * Tfs + gs.Tc + (isSpace ? gs.Tw : 0)) * Th;
          font.observed.add(c.code);
          run.glyphs.push({
            code: c.code, bytes: bytesIn.subarray(c.off, c.off + c.len), uni: font.unicode(c.code),
            x, adv, w0, kernAfter: 0, isSpace,
          });
          x += adv;
        }
      }
      run.width = x;
      Tm = mul([1, 0, 0, 1, x, 0], Tm);
      run.tmEnd = Tm.slice();
      this.runs.push(run);
    };

    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const a = o.args;
      switch (o.op) {
        case 'q': gstack.push({ ...gs, ctm: gs.ctm.slice() }); break;
        case 'Q': if (gstack.length) gs = gstack.pop(); break;
        case 'cm': if (a.length >= 6 && a.every((v) => typeof v === 'number')) gs.ctm = mul(a.slice(0, 6), gs.ctm); break;
        case 'g': case 'rg': case 'k': case 'cs': case 'sc': case 'scn':
          gs.fill = fillFromOp(o.op, a, gs.fill); break;
        case 'BT': Tm = IDENT.slice(); Tlm = IDENT.slice(); inText = true; break;
        case 'ET': inText = false; break;
        case 'Tc': gs.Tc = a[0] ?? 0; break;
        case 'Tw': gs.Tw = a[0] ?? 0; break;
        case 'Tz': gs.Th = (a[0] ?? 100) / 100; break;
        case 'TL': gs.TL = a[0] ?? 0; break;
        case 'Ts': gs.Ts = a[0] ?? 0; break;
        case 'Tr': gs.Tr = a[0] ?? 0; break;
        case 'Tf':
          if (a[0] && a[0].name !== undefined) { gs.fontName = a[0].name; gs.font = this.resolveFont(resources, a[0].name); }
          gs.Tfs = typeof a[1] === 'number' ? a[1] : gs.Tfs;
          break;
        case 'Td': Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'TD': gs.TL = -(a[1] || 0); Tlm = mul([1, 0, 0, 1, a[0] || 0, a[1] || 0], Tlm); Tm = Tlm.slice(); break;
        case 'Tm': if (a.length >= 6) { Tlm = a.slice(0, 6).map((v) => (typeof v === 'number' ? v : 0)); Tm = Tlm.slice(); } break;
        case 'T*': Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice(); break;
        case 'Tj': show(i, o, [a[0]]); break;
        case 'TJ': show(i, o, Array.isArray(a[0]) ? a[0] : []); break;
        case "'":
          Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice();
          show(i, o, [a[0]]); break;
        case '"':
          gs.Tw = a[0] ?? gs.Tw; gs.Tc = a[1] ?? gs.Tc;
          Tlm = mul([1, 0, 0, 1, 0, -gs.TL], Tlm); Tm = Tlm.slice();
          show(i, o, [a[2]]); break;
        case 'Do': {
          if (depth > 10 || !a[0] || a[0].name === undefined) break;
          const xdict = dget(this.ctx, resources, 'XObject');
          if (!(xdict instanceof L().PDFDict)) break;
          const xref = xdict.get(N(a[0].name));
          const xo = lookup(this.ctx, xref);
          if (!(xo instanceof L().PDFStream)) break;
          if (nameOf(dget(this.ctx, xo.dict, 'Subtype')) !== 'Form') break;
          if (!(xref instanceof L().PDFRef)) break;
          const key = xref.toString();
          if (stack.includes(key)) break;
          const m = numArr(this.ctx, dget(this.ctx, xo.dict, 'Matrix')) || IDENT;
          const fres = dget(this.ctx, xo.dict, 'Resources');
          const res2 = fres instanceof L().PDFDict ? fres : resources;
          let fowner = this.formOwners.get(key);
          let fbytes;
          try { fbytes = streamBytes(xo); } catch (e) { break; }
          if (!fowner) {
            fowner = { kind: 'form', ref: xref, stream: xo, resources: res2, ownRes: fres instanceof L().PDFDict, name: a[0].name, bytes: fbytes };
            this.formOwners.set(key, fowner);
            this.owners.push(fowner);
          }
          const newBase = mul(mul(m.slice(0, 6), gs.ctm), baseCtm);
          this.run(fowner, fbytes, res2, newBase, depth + 1, [...stack, key]);
          break;
        }
        default: break;
      }
    }
  }
}

export function interpretPage(doc, pageIndex) {
  const page = doc.getPage(pageIndex);
  const it = new Interp(doc, pageIndex);
  const bytes = pageContentBytes(page);
  const resources = page.node.Resources() || doc.context.obj({});
  const owner = { kind: 'page', page, pageIndex, resources, bytes };
  it.owners.push(owner);
  it.run(owner, bytes, resources, IDENT.slice(), 0, []);
  return { runs: it.runs, owners: it.owners, fonts: [...it.fonts] };
}

export { apply, inv, mul };
