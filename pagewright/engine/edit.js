// Applies edits to a text group by rewriting the content stream in place:
// the original glyphs are removed (their advance is preserved so following
// text doesn't move) and the new text is drawn at the same position, in the
// same embedded font, reusing original glyph codes and kerning wherever the
// text is unchanged. Characters the embedded font can't draw fall back to a
// metric-compatible font of the same style.

import { L, N, dget, lookup, fmt, hexOf, mul, apply, inv, concatBytes, enc, latin1 } from './pdfobj.js';
import { colorOps, pageContentStreams } from './interpret.js';
import { EmbeddedTTF } from './embedfont.js';

// ---------------------------------------------------------------- diff
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  // trim common prefix / suffix first
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const pairs = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  const A = a.slice(pre, n - suf), B = b.slice(pre, m - suf);
  if (A.length && B.length && A.length * B.length <= 4e6) {
    const W = B.length + 1;
    const dp = new Uint16Array((A.length + 1) * W);
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { pairs.push([pre + i, pre + j]); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < suf; k++) pairs.push([n - suf + k, m - suf + k]);
  return pairs;
}

// Decide, for the new text of the first line, which original units are kept.
// Returns a sequence of {orig: unit} | {ch: string}
function planLine(units, newText) {
  const oc = [], owner = [];
  units.forEach((u, idx) => {
    const t = u.uni === undefined || u.uni === null ? '\uFFFD' : u.uni;
    const chars = [...t];
    if (!chars.length) { oc.push('\u0000'); owner.push(idx); return; }
    for (const c of chars) { oc.push(c); owner.push(idx); }
  });
  const nc = [...newText];
  const pairs = lcsPairs(oc, nc);
  const mapO = new Map(pairs.map(([i, j]) => [i, j]));
  // a unit is kept when all its chars matched consecutive new chars
  const keepAt = new Map(); // new char index -> unit idx
  let k = 0;
  while (k < oc.length) {
    const idx = owner[k];
    let e = k;
    while (e < oc.length && owner[e] === idx) e++;
    let ok = true;
    const j0 = mapO.get(k);
    if (j0 === undefined) ok = false;
    for (let q = k; ok && q < e; q++) if (mapO.get(q) !== j0 + (q - k)) ok = false;
    if (ok) keepAt.set(j0, { idx, len: e - k });
    k = e;
  }
  const seq = [];
  for (let j = 0; j < nc.length;) {
    if (keepAt.has(j)) { const { idx, len } = keepAt.get(j); seq.push({ orig: units[idx], idx }); j += len; }
    else { seq.push({ ch: nc[j] }); j++; }
  }
  return seq;
}

// ---------------------------------------------------------------- planning
// Resolve each item to an original font or a fallback; no PDF writes.
// New characters take the style of the character before them (like a word processor).
export function planEdit(group, text) {
  const lines = text.split('\n');
  const Th = group.Th || 1;
  const vs = group.units.filter((u) => u.kind === 'vs').map((u) => u.adv / Th / Math.abs(u.run.Tfs || 1));
  vs.sort((a, b) => a - b);
  const spaceGapEm = vs.length ? vs[Math.floor(vs.length / 2)] : 0.25; // in em
  const out = [];
  const fallbackChars = new Set();
  const keys = new Set();
  let lastRun = null;
  lines.forEach((line, li) => {
    const seq = li === 0 ? planLine(group.units, line) : [...line].map((ch) => ({ ch }));
    const items = [];
    for (let s = 0; s < seq.length; s++) {
      const it = seq[s];
      if (it.orig) {
        const u = it.orig;
        const nextIsOrigNext = seq[s + 1] && seq[s + 1].orig && seq[s + 1].idx === it.idx + 1;
        const extra = nextIsOrigNext ? u.extraAfter : 0;
        if (u.kind === 'vs') items.push({ t: 'gap', w: u.adv / Th, run: u.run });
        else items.push({ t: 'orig', run: u.run, bytes: u.bytes, code: u.code, ch: u.uni, extra });
        lastRun = u.run;
        continue;
      }
      let run = lastRun;
      if (!run) { const nx = seq.slice(s + 1).find((x) => x.orig); run = nx ? nx.orig.run : group.primary || group.runs[0]; }
      const ch = it.ch;
      const font = run.font;
      let e = font.encodeChar(ch);
      if (!e && group.primary && group.primary.font !== font && ch !== ' ') {
        // same style family? only reuse the primary font if it matches weight/slant
        const pf = group.primary.font;
        if (pf.bold === font.bold && pf.italic === font.italic && pf.fallbackKey() === font.fallbackKey()) {
          const e2 = pf.encodeChar(ch);
          if (e2) { items.push({ t: 'orig', run: group.primary, bytes: e2.bytes, code: e2.code, ch, extra: 0, fresh: true }); lastRun = run; continue; }
        }
      }
      if (e) { items.push({ t: 'orig', run, bytes: e.bytes, code: e.code, ch, extra: 0, fresh: true }); lastRun = run; continue; }
      if (ch === ' ' || ch === '\u00a0') { items.push({ t: 'gap', w: spaceGapEm * Math.abs(run.Tfs), run }); continue; }
      if (ch === '\t') { items.push({ t: 'gap', w: spaceGapEm * 4 * Math.abs(run.Tfs), run }); continue; }
      const key = font.fallbackKey();
      items.push({ t: 'fb', ch, run, key });
      fallbackChars.add(ch);
      keys.add(key);
      lastRun = run;
    }
    out.push(items);
  });
  return {
    lines: out, fallbackChars: [...fallbackChars], exact: fallbackChars.size === 0,
    fallbackKeys: [...keys], fallbackKey: [...keys][0] || (group.font && group.font.fallbackKey()),
  };
}

// ---------------------------------------------------------------- fallback fonts
const fbCache = new WeakMap();
export async function getFallback(doc, key, loader) {
  let m = fbCache.get(doc);
  if (!m) { m = new Map(); fbCache.set(doc, m); }
  if (m.has(key)) return m.get(key);
  const p = (async () => {
    const bytes = await loader(key);
    if (!bytes) return null;
    return new EmbeddedTTF(doc, key, bytes);
  })();
  m.set(key, p);
  return p;
}
export function flushFallbacks(doc) {
  const m = fbCache.get(doc);
  if (!m) return Promise.resolve();
  return Promise.all([...m.values()]).then((fs) => fs.forEach((f) => f && f.flush()));
}
export function resetFallbacks(doc) { fbCache.delete(doc); }

function fontDictOf(ctx, resources) {
  let f = resources.get(N('Font'));
  let fd = lookup(ctx, f);
  if (!(fd instanceof L().PDFDict)) { fd = ctx.obj({}); resources.set(N('Font'), fd); }
  return fd;
}

function resNameFor(ctx, resources, ref, prefix = 'KPF') {
  const fd = fontDictOf(ctx, resources);
  for (const [k, v] of fd.entries()) if (v instanceof L().PDFRef && v.toString() === ref.toString()) return k.decodeText();
  let i = 1;
  while (fd.has(N(prefix + i))) i++;
  fd.set(N(prefix + i), ref);
  return prefix + i;
}

const nameTok = (n) => '/' + n.replace(/[^\x21-\x7e]|[#()<>\[\]{}\/%]/g, (ch) => '#' + ch.charCodeAt(0).toString(16).padStart(2, '0'));

// ---------------------------------------------------------------- apply
const styleOf = (run) => ({ font: run.fontName, size: run.Tfs, Tc: run.Tc, Tw: run.Tw, Ts: run.Ts, color: colorOps(run.fill) });

// change: { text?, dx?, dy?, size?, rgb?: [r,g,b] (0..1), remove? }
export async function applyGroupEdit(doc, group, change, loader) {
  const ctx = doc.context;
  const owner = group.owner;
  const R0 = group.runs[0];
  const Th = group.Th || 1;
  const report = { fallback: [], dropped: [], exact: true };
  const resources = owner.resources;

  const newText = change.remove ? '' : (change.text !== undefined ? change.text : group.text);
  const scale = change.size ? change.size / group.size : 1;
  const colorOverride = change.rgb ? `${fmt(change.rgb[0])} ${fmt(change.rgb[1])} ${fmt(change.rgb[2])} rg` : null;

  let draw = '';
  if (!change.remove && newText.length) {
    const plan = planEdit(group, newText);
    const fbs = new Map();
    for (const key of plan.fallbackKeys) {
      const fb = await getFallback(doc, key, loader);
      if (fb) fbs.set(key, { fb, res: resNameFor(ctx, resources, fb.ref) });
    }
    let dv = null;
    const needDv = plan.lines.some((items) => items.some((it) => it.t === 'fb' && !(fbs.get(it.key) && fbs.get(it.key).fb.has(it.ch))));
    if (needDv) {
      const fb = await getFallback(doc, 'DejaVuSans', loader);
      if (fb) dv = { fb, res: resNameFor(ctx, resources, fb.ref) };
    }
    let M = group.tmStart.slice();
    if (change.dx || change.dy) {
      const C = mul(group.ctm, group.baseCtm);
      const Ci = inv([C[0], C[1], C[2], C[3], 0, 0]);
      if (Ci) { const [ux, uy] = apply(Ci, change.dx || 0, change.dy || 0); M[4] += ux; M[5] += uy; }
    }
    const base = styleOf(R0);
    const cur = { ...base };
    let parts = [];
    const flushTJ = () => { if (parts.length) { draw += `[${parts.join(' ')}] TJ\n`; parts = []; } };
    const want = (st) => {
      const ops = [];
      if (st.font !== cur.font || Math.abs(st.size - cur.size) > 1e-6) ops.push(`${nameTok(st.font)} ${fmt(st.size)} Tf`);
      if (Math.abs(st.Tc - cur.Tc) > 1e-7) ops.push(`${fmt(st.Tc)} Tc`);
      if (Math.abs(st.Tw - cur.Tw) > 1e-7) ops.push(`${fmt(st.Tw)} Tw`);
      if (Math.abs(st.Ts - cur.Ts) > 1e-7) ops.push(`${fmt(st.Ts)} Ts`);
      if (st.color !== cur.color) ops.push(st.color);
      if (ops.length) { flushTJ(); draw += ops.join(' ') + '\n'; Object.assign(cur, st); }
    };
    const scaled = (run, fontRes) => ({
      font: fontRes || run.fontName, size: run.Tfs * scale, Tc: run.Tc * scale, Tw: run.Tw * scale, Ts: (run.Ts + (run.dy || 0)) * scale,
      color: colorOverride || colorOps(run.fill),
    });
    const usedFonts = new Set();
    plan.lines.forEach((items, li) => {
      flushTJ();
      const Ml = li === 0 ? M : mul([1, 0, 0, 1, 0, -group.leading * scale * li], M);
      draw += `${Ml.map(fmt).join(' ')} Tm\n`;
      for (const it of items) {
        if (it.t === 'gap') {
          const d = it.w * scale; // pre-Th text units
          parts.push(fmt(-d * 1000 / (cur.size || 1)));
          continue;
        }
        if (it.t === 'orig') {
          want(scaled(it.run));
          parts.push(hexOf(it.bytes));
          if (it.extra) parts.push(fmt(-it.extra * 1000 / it.run.Tfs));
          const f = it.run.font;
          if (it.fresh || (it.ch && f.unicode(it.code) !== it.ch)) { f.noteUse(it.code, it.ch); usedFonts.add(f); }
          continue;
        }
        let target = fbs.get(it.key);
        if (!target || !target.fb.has(it.ch)) target = dv && dv.fb.has(it.ch) ? dv : null;
        if (!target) { report.dropped.push(it.ch); continue; }
        want(scaled(it.run, target.res));
        parts.push(target.fb.encode(it.ch));
        report.fallback.push(it.ch);
      }
      flushTJ();
    });
    want(base); // restore the state the rest of the stream expects
    flushTJ();
    for (const f of usedFonts) f.flushPatches();
    for (const { fb } of fbs.values()) fb.flush();
    if (dv) dv.fb.flush();
    if (plan.fallbackKeys.length) report.fallbackFont = plan.fallbackKeys.join(', ');
  }
  report.exact = report.fallback.length === 0 && report.dropped.length === 0;

  // Replacement strings for each run's operator
  const reps = [];
  group.runs.forEach((run, idx) => {
    const o = run.op;
    let prefix = '';
    if (o.op === "'") prefix = 'T*\n';
    else if (o.op === '"') prefix = `${fmt(o.args[0] ?? 0)} Tw ${fmt(o.args[1] ?? 0)} Tc T*\n`;
    const neutral = (adv) => {
      if (!run.Tfs || !Th) return '';
      const n = -(adv / Th) * 1000 / run.Tfs;
      return Math.abs(n) < 1e-9 ? '' : `[${fmt(n)}] TJ\n`;
    };
    let body;
    if (idx === 0 && draw) {
      // tmEnd = translate(ex, 0) x Tlm, so restoring Tlm and advancing by ex is exact
      const T = run.tlm;
      const I = inv(T);
      const [ex] = I ? apply(I, run.tmEnd[4], run.tmEnd[5]) : [0, 0];
      body = draw + `${T.map(fmt).join(' ')} Tm\n` + neutral(ex);
    } else body = neutral(run.width);
    reps.push({ start: o.start, end: o.end, str: '\n' + prefix + body });
  });
  reps.sort((a, b) => b.start - a.start);
  let bytes = owner.bytes;
  const seen = new Set();
  for (const r of reps) {
    if (seen.has(r.start)) continue;
    seen.add(r.start);
    bytes = concatBytes([bytes.subarray(0, r.start), enc.encode(r.str), bytes.subarray(r.end)]);
  }
  writeOwnerBytes(doc, owner, bytes);
  return report;
}

export function writeOwnerBytes(doc, owner, bytes) {
  const ctx = doc.context;
  if (owner.kind === 'page') {
    const page = owner.page;
    const old = pageContentStreams(page).map((s) => s.ref).filter(Boolean);
    const stream = ctx.flateStream(bytes);
    const ref = ctx.register(stream);
    page.node.set(N('Contents'), ref);
    // drop the old streams if no other page uses them
    if (old.length) {
      const used = new Set();
      for (const p of doc.getPages()) {
        if (p === page) continue;
        const c = p.node.get(N('Contents'));
        if (c instanceof L().PDFRef) used.add(c.toString());
        const v = lookup(ctx, c);
        if (v instanceof L().PDFArray) for (let i = 0; i < v.size(); i++) { const r = v.get(i); if (r instanceof L().PDFRef) used.add(r.toString()); }
      }
      for (const r of old) if (!used.has(r.toString())) ctx.delete(r);
    }
  } else {
    const oldDict = owner.stream.dict;
    const stream = ctx.flateStream(bytes);
    for (const [k, v] of oldDict.entries()) {
      const kn = k.decodeText();
      if (kn === 'Length' || kn === 'Filter' || kn === 'DecodeParms' || kn === 'DL') continue;
      stream.dict.set(k, v);
    }
    ctx.assign(owner.ref, stream);
  }
  owner.bytes = bytes;
}
