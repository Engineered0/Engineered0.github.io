// Groups text runs into editable lines ("text groups") with per-glyph units.

import { mul, apply, inv } from './pdfobj.js';
import { interpretPage, colorToRGB } from './interpret.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const sameMat4 = (A, B, tol = 1e-3) => {
  const s = Math.max(1, Math.abs(A[0]) + Math.abs(A[1]) + Math.abs(A[2]) + Math.abs(A[3]));
  return near(A[0], B[0], tol * s) && near(A[1], B[1], tol * s) && near(A[2], B[2], tol * s) && near(A[3], B[3], tol * s);
};
const sameMat6 = (A, B, tol = 1e-3) => sameMat4(A, B, tol) && near(A[4], B[4], 0.01) && near(A[5], B[5], 0.01);
const sameColor = (a, b) => a && b && a.space === b.space && a.named === b.named && a.pattern === b.pattern
  && (a.vals || []).length === (b.vals || []).length && (a.vals || []).every((v, i) => near(v, b.vals[i], 1e-4));

function canJoin(prev, run) {
  if (prev.owner !== run.owner) return false;
  // Fonts, sizes and colours may differ within a line (bold words, fallback glyphs);
  // the geometry must agree.
  if (!near(prev.Th, run.Th, 1e-4) || prev.Tr !== run.Tr) return false;
  if (!prev.Tfs || !run.Tfs || run.Tfs / prev.Tfs > 2.5 || prev.Tfs / run.Tfs > 2.5) return false;
  if (!sameMat6(prev.ctm, run.ctm) || !sameMat6(prev.baseCtm, run.baseCtm)) return false;
  if (!sameMat4(prev.tmStart, run.tmStart)) return false;
  if (run.font.vertical) return false;
  // position of run start in prev's text space
  const I = inv(prev.tmStart);
  if (!I) return false;
  const [u, v] = apply(I, run.tmStart[4], run.tmStart[5]);
  const em = Math.max(Math.abs(prev.Tfs), Math.abs(run.Tfs)) || 1;
  if (Math.abs(v) > 0.15 * em) return false;
  const gap = u - prev.width;
  if (gap < -0.3 * em || gap > 1.0 * em) return false;
  return true;
}

let gidCounter = 1;

function buildGroup(runs) {
  const r0 = runs[0];
  const I = inv(r0.tmStart);
  const units = [];
  for (const r of runs) {
    const [u0, v0] = apply(I, r.tmStart[4], r.tmStart[5]);
    r.dy = Math.abs(v0) < 1e-6 ? 0 : v0; // baseline offset within the line (kept via text rise)
    for (const g of r.glyphs) {
      units.push({ kind: 'g', run: r, code: g.code, bytes: g.bytes, uni: g.uni, x: u0 + g.x, adv: g.adv, w0: g.w0, isSpace: g.isSpace });
    }
  }
  // primary style: the run holding most glyphs
  const counts = new Map();
  for (const r of runs) counts.set(r, (counts.get(r) || 0) + r.glyphs.length);
  let primary = r0;
  for (const [r, c] of counts) if (c > (counts.get(primary) || 0)) primary = r;
  const Tfs = primary.Tfs, Th = r0.Th || 1;
  // extra spacing after each unit (kerning / positioning), in pre-Th text units
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const next = units[i + 1];
    u.extraAfter = next ? (next.x - (u.x + u.adv)) / Th : 0;
    if (Math.abs(u.extraAfter) < 1e-6) u.extraAfter = 0;
  }
  // virtual spaces where a gap is wide enough to read as a word break
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    out.push(u);
    const next = units[i + 1];
    const isSp = (x) => x && (x.isSpace || x.uni === ' ' || x.uni === ' ');
    const em = Math.max(Math.abs(u.run.Tfs), next ? Math.abs(next.run.Tfs) : 0) || 1;
    if (next && u.extraAfter * Th > 0.15 * em && !isSp(u) && !isSp(next)) {
      const gapAdv = u.extraAfter * Th;
      out.push({ kind: 'vs', run: u.run, x: u.x + u.adv, adv: gapAdv, uni: ' ', extraAfter: 0 });
      u.extraAfter = 0;
    }
  }
  const text = out.map((u) => (u.uni === undefined || u.uni === null ? '\uFFFD' : u.uni)).join('');
  const last = out[out.length - 1];
  const x0 = out.length ? Math.min(0, out[0].x) : 0;
  const x1 = last ? last.x + last.adv : 0;
  let yLo = Infinity, yHi = -Infinity;
  for (const r of runs) {
    yLo = Math.min(yLo, r.font.descent * r.Tfs + r.Ts + r.dy);
    yHi = Math.max(yHi, r.font.ascent * r.Tfs + r.Ts + r.dy);
  }
  const f = primary.font;
  // text space -> page space
  const M = mul(mul(r0.tmStart, r0.ctm), r0.baseCtm);
  const quad = [apply(M, x0, yLo), apply(M, x1, yLo), apply(M, x1, yHi), apply(M, x0, yHi)];
  return {
    id: gidCounter++,
    runs, primary, owner: r0.owner, font: f, size: Tfs, Th, fill: primary.fill, rgb: colorToRGB(primary.fill),
    fonts: [...new Set(runs.map((r) => r.font))],
    Tc: primary.Tc, Tw: primary.Tw, Ts: primary.Ts, Tr: r0.Tr, TL: r0.TL,
    tmStart: r0.tmStart, ctm: r0.ctm, baseCtm: r0.baseCtm, M,
    units: out, text, x0, x1, yLo, yHi, quad,
    invisible: r0.Tr === 3 || r0.Tr === 7,
  };
}

// Effective font size in page units and rotation angle of a group
export function groupGeometry(g) {
  const M = g.M;
  const sx = Math.hypot(M[0], M[1]);
  const sy = Math.hypot(M[2], M[3]);
  const angle = Math.atan2(M[1], M[0]);
  return { sx, sy, angle, fontPx: Math.abs(g.size) * sy, origin: [M[4], M[5]] };
}

export function analyzeText(doc, pageIndex) {
  const { runs, owners, fonts } = interpretPage(doc, pageIndex);
  const groups = [];
  let cur = null;
  for (const r of runs) {
    if (!r.glyphs.length) continue;
    if (cur && canJoin(cur[cur.length - 1], r)) cur.push(r);
    else { if (cur) groups.push(cur); cur = [r]; }
  }
  if (cur) groups.push(cur);
  const built = groups.map(buildGroup).filter((g) => g.units.length);
  // leading: nearest group directly below with the same size, overlapping horizontally
  for (const g of built) {
    const I = inv(g.M);
    let best = Infinity;
    if (I) {
      for (const h of built) {
        if (h === g || !near(h.size, g.size, 0.01) || !sameMat4(h.M, g.M, 0.01)) continue;
        const [hx, hy] = apply(I, h.M[4], h.M[5]);
        const dy = -hy;
        if (dy > 0.5 * Math.abs(g.size) && dy < 3 * Math.abs(g.size) && hx < g.x1 && hx + (h.x1 - h.x0) > g.x0 - Math.abs(g.size) * 2) best = Math.min(best, dy);
      }
    }
    g.leading = isFinite(best) ? best : (g.TL > 0 ? g.TL : 1.2 * Math.abs(g.size));
  }
  return { groups: built, owners, fonts, runs };
}
