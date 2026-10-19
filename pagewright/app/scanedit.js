// Changing words on scanned pages.
//
// A scan has no font, only pictures of letters. To make an edit look like the
// rest of the page, Pagewright:
//   1. finds every letter on the page (ink blobs matched to the recognised text),
//   2. groups words by style (size, stroke weight, slant), so bold and italic
//      words get bold and italic letters,
//   3. keeps the original pixels of everything that didn't change,
//   4. builds new letters from the same letter elsewhere in the scan, in the same
//      style, and only for letters that never appear uses the closest-matching
//      font, tuned to the scan's size, weight, blur and ink colour,
//   5. learns the letter spacing from the scan itself,
//   6. paints the result onto the cleaned-up paper (noise included) and stores
//      it as an image patch on the scan's own pixel grid, with the new words in
//      the invisible text layer so the page stays searchable.

import { S, el, on, emit, rgbToHex, hexToRgb } from './state.js';
import { analyze, changeDoc, E, loadFontBytes } from './doc.js';
import { pageFacts, pageFactsNow, editScale, renderRaster, addTextLayer } from './ocr.js';
import { registerTextFonts } from './objects.js';
import { toast, busy } from './ui.js';

const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const median = (arr) => { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const lumOf = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

const XCH = new Set([...'acemnorsuvwxz']);
const CAPCH = new Set([...'ABCDEFGHIJKLMNOPRSTUVWXYZbdfhklt0123456789']);
const RING = 3; // pixels of anti-aliased edge kept around each blob

// ---------------------------------------------------------------- page analysis
let cache = null; // { key, promise }
export function dropScanCache() { cache = null; }

async function pageScan(pv) {
  const key = `${pv.key}@${S.version}`;
  if (!cache || cache.key !== key) {
    const c = { key, promise: buildPageScan(pv), ready: null };
    cache = c;
    c.promise.then((P) => { c.ready = P; emit('scan-ready', pv); }, () => {});
  }
  try { return await cache.promise; } catch (e) { cache = null; throw e; }
}

async function buildPageScan(pv) {
  const f = await pageFacts(pv);
  const R = editScale(pv, f);
  const r = await renderRaster(pv.pdfPage, R, pv.rotate);
  const rgba = r.ctx.getImageData(0, 0, r.w, r.h).data;
  r.canvas.width = r.canvas.height = 0;
  const gray = new Uint8Array(r.w * r.h);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  const P = { R, w: r.w, h: r.h, rgba, gray, vp: r.vp, lines: [], byGroup: new Map(), clusters: [] };
  const t0 = performance.now();
  const groups = analyze(pv.index).groups.filter((g) => g.invisible && g.text.trim());
  let n = 0;
  for (const g of groups) {
    const L = lineModel(P, g);
    if (!L) continue;
    analyzeLine(P, L, false);
    P.lines.push(L);
    P.byGroup.set(g.id, L);
    if (++n % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // stay responsive
  }
  const t1 = performance.now();
  buildClusters(P);
  await fitClusters(P);
  P.timing = { analyse: Math.round(t1 - t0), fit: Math.round(performance.now() - t1) };
  return P;
}

// Geometry of a recognised line in raster pixels
function lineModel(P, g) {
  const toR = (tx, ty) => P.vp.convertToViewportPoint(...ap(g.M, tx, ty));
  const a = toR(g.x0, 0), b = toR(g.x1, 0);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  if (!(Math.abs(ang) < 0.14) || b[0] <= a[0]) return null; // only (nearly) horizontal lines
  const slope = Math.tan(ang);
  const baseY = (x) => a[1] + (x - a[0]) * slope;
  const top = toR(g.x0, g.yHi), bot = toR(g.x0, g.yLo);
  const H = Math.max(6, Math.hypot(top[0] - bot[0], top[1] - bot[1]));
  const words = [];
  let cur = null;
  for (const u of g.units) {
    const sp = u.kind === 'vs' || u.isSpace || u.uni === ' ' || u.uni === ' ' || !u.uni;
    if (sp) { cur = null; continue; }
    if (!cur) { cur = { text: '', ux: [] }; words.push(cur); }
    cur.text += u.uni;
    cur.ux.push([toR(u.x, 0)[0], toR(u.x + u.adv, 0)[0]]);
  }
  for (const w of words) { w.ox0 = w.ux[0][0]; w.ox1 = w.ux[w.ux.length - 1][1]; w.chars = [...w.text]; }
  if (!words.length) return null;
  return { g, slope, baseY, H, words, sizePt: Math.abs(g.size) * Math.hypot(g.M[2], g.M[3]) };
}

// Adaptive (Sauvola) binarisation of a region of the gray raster
function binarize(P, x0, y0, w, h, win) {
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1)), sq = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0, rq = 0;
    const row = (y0 + y) * P.w + x0;
    for (let x = 0; x < w; x++) {
      const v = P.gray[row + x];
      rs += v; rq += v * v;
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + rs;
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rq;
    }
  }
  const bin = new Uint8Array(w * h);
  const r = win >> 1;
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const n = (yb - ya) * (xb - xa);
      const s = sum[yb * W + xb] - sum[ya * W + xb] - sum[yb * W + xa] + sum[ya * W + xa];
      const q = sq[yb * W + xb] - sq[ya * W + xb] - sq[yb * W + xa] + sq[ya * W + xa];
      const m = s / n;
      const sd = Math.sqrt(Math.max(0, q / n - m * m));
      const T = m * (1 + 0.25 * (sd / 128 - 1));
      const v = P.gray[(y0 + y) * P.w + x0 + x];
      if (v < T && v < m - 6) bin[y * w + x] = 1;
    }
  }
  return bin;
}

// 8-connected components
function label(bin, w, h) {
  const lab = new Int32Array(w * h);
  const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) { if (a < b) parent[b] = a; else parent[a] = b; } };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      const n = [];
      if (x > 0 && lab[i - 1]) n.push(lab[i - 1]);
      if (y > 0) {
        if (lab[i - w]) n.push(lab[i - w]);
        if (x > 0 && lab[i - w - 1]) n.push(lab[i - w - 1]);
        if (x < w - 1 && lab[i - w + 1]) n.push(lab[i - w + 1]);
      }
      if (!n.length) { lab[i] = next; parent.push(next); next++; } else {
        let m = n[0];
        for (const k of n) if (k < m) m = k;
        lab[i] = m;
        for (const k of n) unite(m, k);
      }
    }
  }
  const remap = new Int32Array(next);
  let count = 0;
  for (let k = 1; k < next; k++) { const r = find(k); if (!remap[r]) remap[r] = ++count; remap[k] = remap[r]; }
  const ccs = [];
  for (let k = 0; k <= count; k++) ccs.push(k ? { id: k, x0: Infinity, y0: Infinity, x1: -1, y1: -1, area: 0, per: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 } : null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!lab[i]) continue;
      const k = remap[lab[i]];
      lab[i] = k;
      const c = ccs[k];
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      c.area++; c.sx += x; c.sy += y; c.sxx += x * x; c.syy += y * y; c.sxy += x * y;
      if (x === 0 || !bin[i - 1]) c.per++;
      if (x === w - 1 || !bin[i + 1]) c.per++;
      if (y === 0 || !bin[i - w]) c.per++;
      if (y === h - 1 || !bin[i + w]) c.per++;
    }
  }
  return { lab, ccs: ccs.filter(Boolean) };
}

// Grow labels by `r` pixels into the background (the anti-aliased edge of each blob)
function grow(lab, w, h, r) {
  const a = lab.slice();
  // horizontal: nearest label within r on the same row
  const tmp = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let last = -1e9, lastV = 0;
    for (let x = 0; x < w; x++) { const v = lab[o + x]; if (v) { last = x; lastV = v; } tmp[o + x] = v || (x - last <= r ? lastV : 0); }
    last = 1e9; lastV = 0;
    for (let x = w - 1; x >= 0; x--) { const v = lab[o + x]; if (v) { last = x; lastV = v; } else if (!tmp[o + x] && last - x <= r) tmp[o + x] = lastV; }
  }
  // vertical, over the horizontally grown map
  for (let x = 0; x < w; x++) {
    let last = -1e9, lastV = 0;
    for (let y = 0; y < h; y++) { const v = tmp[y * w + x]; if (v) { last = y; lastV = v; } if (!a[y * w + x]) a[y * w + x] = v || (y - last <= r ? lastV : 0); }
    last = 1e9; lastV = 0;
    for (let y = h - 1; y >= 0; y--) { const v = tmp[y * w + x]; if (v) { last = y; lastV = v; } else if (!a[y * w + x] && last - y <= r) a[y * w + x] = lastV; }
  }
  return a;
}

// Paper under the ink: fill masked pixels smoothly from the paper around them
// ("push-pull": average the known pixels at coarser and coarser scales, then blend back down).
function paperUnder(src, mask, w, h, C = 3) {
  const levels = [];
  let cw = w, ch = h;
  let S = new Float32Array(w * h * C), W = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) continue;
    W[i] = 1;
    for (let c = 0; c < C; c++) S[i * C + c] = src[i * C + c];
  }
  levels.push({ w: cw, h: ch, S, W });
  while (cw > 1 || ch > 1) {
    const nw = Math.max(1, Math.ceil(cw / 2)), nh = Math.max(1, Math.ceil(ch / 2));
    const S2 = new Float32Array(nw * nh * C), W2 = new Float32Array(nw * nh);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x, wt = W[i];
        if (!wt) continue;
        const j = (y >> 1) * nw + (x >> 1);
        W2[j] += wt;
        for (let c = 0; c < C; c++) S2[j * C + c] += S[i * C + c] * wt;
      }
    }
    for (let j = 0; j < nw * nh; j++) { const k = W2[j]; if (k) { for (let c = 0; c < C; c++) S2[j * C + c] /= k; W2[j] = Math.min(1, k / 2); } }
    cw = nw; ch = nh; S = S2; W = W2;
    levels.push({ w: cw, h: ch, S, W });
  }
  // pull: blend each level with the upsampled estimate of the level above
  let est = levels[levels.length - 1].S;
  for (let l = levels.length - 2; l >= 0; l--) {
    const L0 = levels[l], up = levels[l + 1];
    const out = new Float32Array(L0.w * L0.h * C);
    for (let y = 0; y < L0.h; y++) {
      const fy = Math.min(up.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(up.h - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < L0.w; x++) {
        const i = y * L0.w + x;
        const wt = L0.W[i];
        if (wt >= 1) { for (let c = 0; c < C; c++) out[i * C + c] = L0.S[i * C + c]; continue; }
        const fx = Math.min(up.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(fx), x1 = Math.min(up.w - 1, x0 + 1), tx = fx - x0;
        for (let c = 0; c < C; c++) {
          const v00 = est[(y0 * up.w + x0) * C + c], v01 = est[(y0 * up.w + x1) * C + c];
          const v10 = est[(y1 * up.w + x0) * C + c], v11 = est[(y1 * up.w + x1) * C + c];
          const a = (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty;
          out[i * C + c] = wt * L0.S[i * C + c] + (1 - wt) * a;
        }
      }
    }
    est = out;
  }
  return est;
}

// Small deterministic noise, so a cleaned area keeps the grain of the paper
function grain(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const u1 = ((h >>> 0) & 0xffff) / 65536, u2 = ((h >>> 16) & 0xffff) / 65536;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  const u3 = ((h >>> 0) & 0xffff) / 65536;
  return (u1 + u2 + u3 - 1.5) * 2; // roughly unit variance
}

// Fill the holes of each blob (thick strokes can come out of the threshold as hollow outlines)
function fillHoles(lab, w, h, c) {
  const x0 = Math.max(0, c.x0 - 1), y0 = Math.max(0, c.y0 - 1), x1 = Math.min(w - 1, c.x1 + 1), y1 = Math.min(h - 1, c.y1 + 1);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  if (bw < 3 || bh < 3) return;
  const seen = new Uint8Array(bw * bh);
  const stack = [];
  const push = (x, y) => { const i = y * bw + x; if (seen[i] || lab[(y + y0) * w + x + x0] === c.id) return; seen[i] = 1; stack.push(i); };
  for (let x = 0; x < bw; x++) { push(x, 0); push(x, bh - 1); }
  for (let y = 0; y < bh; y++) { push(0, y); push(bw - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % bw, y = (i - x) / bw;
    if (x > 0) push(x - 1, y); if (x < bw - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < bh - 1) push(x, y + 1);
  }
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const li = (y + y0) * w + x + x0;
      if (!seen[y * bw + x] && lab[li] !== c.id && !lab[li]) { lab[li] = c.id; c.area++; }
    }
  }
}

function findInk(P, L, H, top, bot) {
  const xs = L.words.map((w) => w.ox0), xe = L.words.map((w) => w.ox1);
  const pad = Math.ceil(H * 0.6);
  const lx0 = Math.min(...xs), lx1 = Math.max(...xe);
  const rx0 = clamp(Math.floor(lx0 - pad), 0, P.w - 1), rx1 = clamp(Math.ceil(lx1 + pad), rx0 + 1, P.w);
  const yTop = Math.min(L.baseY(rx0), L.baseY(rx1)) - H * top, yBot = Math.max(L.baseY(rx0), L.baseY(rx1)) + H * bot;
  const ry0 = clamp(Math.floor(yTop), 0, P.h - 1), ry1 = clamp(Math.ceil(yBot), ry0 + 1, P.h);
  const w = rx1 - rx0, h = ry1 - ry0;
  const win = Math.max(15, Math.round(H * 2.2)) | 1;
  const bin = binarize(P, rx0, ry0, w, h, win);
  const { lab, ccs } = label(bin, w, h);
  const minArea = Math.max(3, H * H * 0.003);
  const lineCcs = [];
  let touchTop = false, touchBot = false;
  for (const c of ccs) {
    const ax0 = c.x0 + rx0, ax1 = c.x1 + rx0, ay0 = c.y0 + ry0, ay1 = c.y1 + ry0;
    const cw = ax1 - ax0 + 1, ch = ay1 - ay0 + 1;
    const cx = (ax0 + ax1) / 2, cy = (ay0 + ay1) / 2;
    const by = L.baseY(cx);
    c.ax0 = ax0; c.ax1 = ax1; c.ay0 = ay0; c.ay1 = ay1; c.cx = cx;
    if (c.area < minArea && !(c.area >= 2 && ay1 <= by + H * 0.15 && ay1 >= by - H * 0.15)) continue; // specks (but keep small dots on the baseline)
    if (ax1 < lx0 - H * 0.3 || ax0 > lx1 + H * 0.3) continue;
    if (cw > H * 4 && ch < H * 0.22) continue; // rules and underlines stay put
    if (cw > H * 1.2 && ch > H * 0.5 && c.area > 0.7 * cw * ch) continue; // filled boxes (shaded table cells)
    if (cw > H * 3 && ch > H * 1.2) continue; // frames
    if (cw < H * 0.3 && ch > H * 1.3) continue; // arrows and other long strokes
    // ink of this line that runs off the top or bottom of the area: look again, bigger
    const onLine = ay1 >= by - H * 0.3 && ay0 <= by;
    if (c.y0 === 0 && ry0 > 0 && onLine) touchTop = true;
    if (c.y1 === h - 1 && ry1 < P.h && ay0 <= by && ay0 >= by - H * 1.1) touchBot = true;
    if (cy < by - H * 1.05 || cy > by + H * 0.4) continue;
    if (ch > H * 1.9) continue;
    if (c.y0 === 0 && ay1 < by - H * 0.5) continue; // cut-off ink from the line above
    lineCcs.push(c);
  }
  for (const c of lineCcs) fillHoles(lab, w, h, c);
  return { rx0, ry0, w, h, lab, lineCcs, lx0, lx1, minArea, touchTop, touchBot };
}

function analyzeLine(P, L, keep) {
  // Find the line's ink. If letters reach the edge of the area we looked at (big or tall
  // letters, an off baseline), look again with a bigger area so whole letters are found.
  if (!L.H0) L.H0 = L.H;
  let H = L.H0, top = 1.3, bot = 0.6;
  let found = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    found = findInk(P, L, H, top, bot);
    const { lineCcs, touchTop, touchBot } = found;
    const hs = lineCcs.map((c) => c.ay1 - c.ay0 + 1).sort((a, b) => a - b);
    const inkH = hs.length ? hs[Math.floor(hs.length * 0.9)] : 0;
    const growH = inkH > H * 0.95;
    if (!touchTop && !touchBot && !growH) break;
    if (growH) H = Math.min(L.H0 * 1.8, inkH * 1.15);
    if (touchTop) top += 0.8;
    if (touchBot) bot += 0.6;
  }
  L.H = H;
  const { rx0, ry0, w, h, lab, lineCcs, lx0, lx1, minArea } = found;
  // group the line's ink into words. We know how many words there are, so split at the widest gaps;
  // the recognised word positions are only a cross-check (they can be off on blurry scans).
  for (const word of L.words) word.ccs = [];
  const lineBlobs = mergeOverlaps([...lineCcs].sort((p, q) => p.ax0 - q.ax0));
  const n = L.words.length;
  let assigned = false;
  if (lineBlobs.length >= n && n > 0) {
    const gaps = [];
    let run = -Infinity;
    lineBlobs.forEach((bl, i) => { if (i) gaps.push({ i, g: bl.ax0 - run }); run = Math.max(run, bl.ax1); });
    const cut = [...gaps].sort((p, q) => q.g - p.g).slice(0, n - 1);
    const cutSet = new Set(cut.map((c) => c.i));
    const rest = gaps.filter((g) => !cutSet.has(g.i)).map((g) => g.g);
    const medRest = rest.length ? median(rest) : 0;
    const minCut = cut.length ? Math.min(...cut.map((c) => c.g)) : Infinity;
    if (minCut > Math.max(medRest * 1.4 + 1, H * 0.1)) {
      const inkWords = [[]];
      lineBlobs.forEach((bl, i) => { if (cutSet.has(i)) inkWords.push([]); inkWords[inkWords.length - 1].push(bl); });
      const ok = inkWords.length === n && inkWords.every((iw, k) => Math.abs(iw[0].ax0 - L.words[k].ox0) < H * 1.5);
      if (ok) { inkWords.forEach((iw, k) => { L.words[k].ccs = iw.flatMap((bl) => bl.ccs); }); assigned = true; }
    }
  }
  if (!assigned) {
    // fall back to the recognised word boxes: the one each blob overlaps most, else the nearest
    for (const bl of lineBlobs) {
      let wi = 0, best = -Infinity;
      for (let i = 0; i < n; i++) {
        const wd = L.words[i];
        const ov = Math.min(bl.ax1, wd.ox1) - Math.max(bl.ax0, wd.ox0);
        const score = ov > 0 ? ov : -Math.min(Math.abs(bl.ax0 - wd.ox1), Math.abs(bl.ax1 - wd.ox0));
        if (score > best) { best = score; wi = i; }
      }
      L.words[wi].ccs.push(...bl.ccs);
    }
  }
  // anti-aliased footprint of every blob, the paper under it, and an alpha (ink coverage) map.
  // Lines used only as a source of letters work in grey; the line being edited also in colour.
  const lab2 = grow(lab, w, h, RING);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = lab2[i] ? 1 : 0;
  const lum = new Float32Array(w * h);
  let rgb = null;
  if (keep) {
    rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s0 = ((ry0 + y) * P.w + rx0 + x) * 4, d = y * w + x;
        rgb[d * 3] = P.rgba[s0]; rgb[d * 3 + 1] = P.rgba[s0 + 1]; rgb[d * 3 + 2] = P.rgba[s0 + 2];
        lum[d] = lumOf(P.rgba[s0], P.rgba[s0 + 1], P.rgba[s0 + 2]);
      }
    }
  } else {
    for (let y = 0; y < h; y++) { const o = (ry0 + y) * P.w + rx0; for (let x = 0; x < w; x++) lum[y * w + x] = P.gray[o + x]; }
  }
  const paper = keep ? paperUnder(rgb, mask, w, h, 3) : null;
  const paperL = keep ? new Float32Array(w * h) : paperUnder(lum, mask, w, h, 1);
  if (keep) for (let i = 0; i < w * h; i++) paperL[i] = lumOf(paper[i * 3], paper[i * 3 + 1], paper[i * 3 + 2]);
  // grain of the paper: robust spread of neighbouring differences (histogram median)
  const hd = new Uint32Array(256);
  let nd = 0;
  for (let y = 0; y < h; y += 2) for (let x = 1; x < w; x += 2) { const i = y * w + x; if (!mask[i] && !mask[i - 1]) { hd[Math.min(255, Math.abs(Math.round(lum[i] - lum[i - 1])))]++; nd++; } }
  const histQ = (hist, total, q) => { let acc = 0; for (let v = 0; v < hist.length; v++) { acc += hist[v]; if (acc >= total * q) return v; } return hist.length - 1; };
  const noise = nd ? (histQ(hd, nd, 0.5) * 1.4826) / Math.SQRT2 : 0;
  // paper and ink levels of this line
  const hp = new Uint32Array(256), hi = new Uint32Array(256);
  let np = 0, ni = 0;
  const onLine = new Set(lineCcs.map((c) => c.id));
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) { hp[clamp(Math.round(paperL[i]), 0, 255)]++; np++; } else if (lab[i] && onLine.has(lab[i])) { hi[clamp(Math.round(lum[i]), 0, 255)]++; ni++; }
  }
  const paperLum = np ? histQ(hp, np, 0.5) : 255;
  const inkLum = ni ? histQ(hi, ni, 0.08) : 0;
  const ink = [0, 0, 0];
  if (keep) {
    let nInk = 0;
    const coreCut = inkLum + 0.12 * (paperLum - inkLum);
    for (let i = 0; i < w * h; i++) {
      if (!lab[i] || !onLine.has(lab[i]) || lum[i] > coreCut) continue;
      ink[0] += rgb[i * 3]; ink[1] += rgb[i * 3 + 1]; ink[2] += rgb[i * 3 + 2]; nInk++;
    }
    if (nInk) for (let c = 0; c < 3; c++) ink[c] /= nInk;
  }
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!lab2[i]) continue;
    const den = paperL[i] - inkLum;
    alpha[i] = den > 8 ? clamp((paperL[i] - lum[i]) / den, 0, 1) : (lab[i] ? 1 : 0);
  }
  Object.assign(L, { rx0, ry0, rw: w, rh: h, ink, inkLum, paperLum, noise });
  // words: blobs, letters, style
  const blobMask = (ids, bx0, by0, bx1, by1) => {
    const mw = bx1 - bx0 + 1, mh = by1 - by0 + 1;
    const m = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const lx = bx0 - rx0 + x, ly = by0 - ry0 + y;
        if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
        const i = ly * w + lx;
        if (ids.has(lab2[i])) m[y * mw + x] = alpha[i];
      }
    }
    return { m, mw, mh };
  };
  // letters: one blob per character. Where blurred letters touch, try darker cut-offs until they separate.
  const segmentWord = (word) => {
    const bx0 = Math.max(rx0, word.ix0 - RING), by0 = Math.max(ry0, word.iy0 - RING);
    const bx1 = Math.min(rx0 + w - 1, word.ix1 + RING), by1 = Math.min(ry0 + h - 1, word.iy1 + RING);
    const cw = bx1 - bx0 + 1, chh = by1 - by0 + 1;
    if (cw < 2 || chh < 2) return null;
    const foot = new Uint8Array(cw * chh), pl = new Float32Array(cw * chh);
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const ri = (by0 - ry0 + y) * w + (bx0 - rx0 + x);
        if (word.ccIds.has(lab2[ri])) foot[y * cw + x] = 1;
        pl[y * cw + x] = paperL[ri];
      }
    }
    for (const f of [0.42, 0.3, 0.55, 0.2]) {
      const bin = new Uint8Array(cw * chh);
      for (let y = 0; y < chh; y++) {
        for (let x = 0; x < cw; x++) {
          const i = y * cw + x;
          if (!foot[i]) continue;
          if (P.gray[(by0 + y) * P.w + bx0 + x] < inkLum + f * (pl[i] - inkLum)) bin[i] = 1;
        }
      }
      const seg = label(bin, cw, chh);
      const keepCcs = seg.ccs.filter((c) => c.area >= Math.max(2, minArea * 0.5));
      for (const c of keepCcs) { c.ax0 = c.x0 + bx0; c.ax1 = c.x1 + bx0; c.ay0 = c.y0 + by0; c.ay1 = c.y1 + by0; c.cx = (c.ax0 + c.ax1) / 2; }
      const bl = mergeOverlaps(keepCcs.sort((p, q) => p.ax0 - q.ax0));
      if (bl.length !== word.chars.length) continue;
      const keepIds = new Set(keepCcs.map((c) => c.id));
      for (let i = 0; i < seg.lab.length; i++) if (!keepIds.has(seg.lab[i])) seg.lab[i] = 0;
      const g2 = grow(seg.lab, cw, chh, RING);
      for (let i = 0; i < g2.length; i++) if (!foot[i]) g2[i] = 0;
      return { blobs: bl, lab: g2, x0: bx0, y0: by0, w: cw, h: chh };
    }
    return null;
  };
  for (const word of L.words) {
    word.ccs.sort((p, q) => p.ax0 - q.ax0);
    word.ccIds = new Set(word.ccs.map((c) => c.id));
    if (word.ccs.length) {
      word.ix0 = Math.min(...word.ccs.map((c) => c.ax0));
      word.ix1 = Math.max(...word.ccs.map((c) => c.ax1));
      word.iy0 = Math.min(...word.ccs.map((c) => c.ay0));
      word.iy1 = Math.max(...word.ccs.map((c) => c.ay1));
    } else { word.ix0 = Math.round(word.ox0); word.ix1 = Math.round(word.ox1); word.iy0 = Math.round(L.baseY(word.ox0) - H * 0.7); word.iy1 = Math.round(L.baseY(word.ox0)); }
    word.blobs = mergeOverlaps(word.ccs);
    word.seg = null;
    word.matched = word.blobs.length === word.chars.length && word.blobs.length > 0;
    if (!word.matched && word.ccs.length && word.chars.length > 1 && word.chars.length < 30) {
      const seg = segmentWord(word);
      if (seg) { word.seg = seg; word.blobs = seg.blobs; word.matched = true; }
    }
    if (word.matched) word.blobs.forEach((bl, i) => { bl.ch = word.chars[i]; });
  }
  // the baseline, measured from the ink (letters that sit on the line)
  fitBaseline(L);
  const blobMaskFrom = (word, bl, mx0, my0, mx1, my1) => {
    if (!word.seg) return blobMask(new Set(bl.ccs.map((c) => c.id)), mx0, my0, mx1, my1);
    const sg = word.seg;
    const ids = new Set(bl.ccs.map((c) => c.id));
    const mw = mx1 - mx0 + 1, mh = my1 - my0 + 1;
    const m = new Float32Array(mw * mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const sx = mx0 + x - sg.x0, sy = my0 + y - sg.y0;
        if (sx < 0 || sy < 0 || sx >= sg.w || sy >= sg.h) continue;
        if (!ids.has(sg.lab[sy * sg.w + sx])) continue;
        const lx = mx0 + x - rx0, ly = my0 + y - ry0;
        m[y * mw + x] = alpha[ly * w + lx];
      }
    }
    return { m, mw, mh };
  };
  for (const word of L.words) {
    const blobs = word.blobs;
    // style features
    let A = 0, Pm = 0;
    for (const c of word.ccs) { A += c.area; Pm += c.per; }
    word.deslant = word.chars.length >= 3 ? shearOf(lab, w, rx0, ry0, word.ccs, L.baseY) : null;
    const xh = [], cap = [];
    if (word.matched) {
      blobs.forEach((bl) => {
        const bh = bl.ay1 - bl.ay0 + 1;
        if (XCH.has(bl.ch)) xh.push(bh); else if (CAPCH.has(bl.ch)) cap.push(bh);
      });
    }
    word.style = { xh: xh.length ? median(xh) : null, cap: cap.length ? median(cap) : null, swr: 0, slant: word.deslant ?? 0, slantGuess: word.deslant === null };
    word.style.size = word.style.xh || (word.style.cap ? word.style.cap * 0.7 : null);
    const sw = Pm > 0 ? (2 * A) / Pm : 0;
    word.style.sw = sw;
    if (word.style.size) word.style.swr = sw / word.style.size;
    // letter samples
    if (word.matched) {
      word.samples = blobs.map((bl, i) => {
        const mx0 = bl.ax0 - RING, my0 = bl.ay0 - RING, mx1 = bl.ax1 + RING, my1 = bl.ay1 + RING;
        const mm = blobMaskFrom(word, bl, mx0, my0, mx1, my1);
        const cxm = (bl.ax0 + bl.ax1) / 2;
        return {
          ch: word.chars[i], ...mm, offX: mx0 - bl.ax0, offY: my0 - L.baseY(cxm), inkW: bl.ax1 - bl.ax0 + 1,
          inkTop: bl.ay0 - L.baseY(cxm), inkBot: bl.ay1 + 1 - L.baseY(cxm), word, line: L,
          ax0: bl.ax0, ax1: bl.ax1,
          sw: bl.ccs.reduce((t, c) => t + c.area, 0) * 2 / Math.max(1, bl.ccs.reduce((t, c) => t + c.per, 0)),
        };
      });
    } else word.samples = null;
    // whole-word picture, used when an unchanged word has to move
    if (keep) {
      const mx0 = word.ix0 - RING, my0 = word.iy0 - RING, mx1 = word.ix1 + RING, my1 = word.iy1 + RING;
      const cxm = (word.ix0 + word.ix1) / 2;
      word.piece = { ...blobMask(word.ccIds, mx0, my0, mx1, my1), offX: mx0 - word.ix0, offY: my0 - L.baseY(cxm), inkW: word.ix1 - word.ix0 + 1 };
    }
  }
  // short words can't show a slant on their own: use the rest of the line's
  const sl = L.words.filter((x) => !x.style.slantGuess).map((x) => x.style.slant);
  if (sl.length) for (const x of L.words) if (x.style.slantGuess) x.style.slant = median(sl);
  // words without a usable letter-to-blob match borrow the style of the nearest word that has one
  for (const word of L.words) {
    if (word.style.size) continue;
    const near = L.words.filter((o) => o.style.size).sort((a, b) => Math.abs(a.ix0 - word.ix0) - Math.abs(b.ix0 - word.ix0))[0];
    if (near) word.style = { ...near.style, borrowed: true };
    else {
      const hs = word.ccs.map((c) => c.ay1 - c.ay0 + 1);
      const size = hs.length ? median(hs) * 0.62 : H * 0.45;
      word.style = { xh: null, cap: null, size, sw: word.style.sw, swr: word.style.sw / size, slant: word.style.slant, borrowed: true };
    }
  }
  // gaps between words on this line
  const gaps = [];
  const sz = median(L.words.map((x) => x.style.size).filter(Boolean)) || H * 0.45;
  for (let i = 1; i < L.words.length; i++) { const g = L.words[i].ix0 - L.words[i - 1].ix1 - 1; if (g > 0 && g < sz * 1.6) gaps.push(g); }
  L.wordGap = gaps.length ? median(gaps) : null;
  if (keep) Object.assign(L, { lab2, alpha, paper, rgbRegion: rgb });
}

// Blobs: components that overlap horizontally belong to one letter (the dot on an i, a colon)
function mergeOverlaps(list) {
  const blobs = [];
  for (const c of list) {
    const prev = blobs[blobs.length - 1];
    if (prev) {
      const ov = Math.min(prev.ax1, c.ax1) - Math.max(prev.ax0, c.ax0);
      if (ov > 0.5 * Math.min(prev.ax1 - prev.ax0 + 1, c.ax1 - c.ax0 + 1)) {
        prev.ccs.push(c);
        prev.ax0 = Math.min(prev.ax0, c.ax0); prev.ax1 = Math.max(prev.ax1, c.ax1);
        prev.ay0 = Math.min(prev.ay0, c.ay0); prev.ay1 = Math.max(prev.ay1, c.ay1);
        continue;
      }
    }
    blobs.push({ ccs: [c], ax0: c.ax0, ax1: c.ax1, ay0: c.ay0, ay1: c.ay1 });
  }
  return blobs;
}

const BELOW = new Set([...'gjpqyQ,;()[]{}|/@$']);
const ABOVE = new Set([...'\'"`^*°~-–—=+_']);
function fitBaseline(L) {
  const H = L.H;
  const pts = [];
  for (const w of L.words) {
    if (w.matched) w.blobs.forEach((b) => { if (!BELOW.has(b.ch) && !ABOVE.has(b.ch)) pts.push([(b.ax0 + b.ax1) / 2, b.ay1 + 1]); });
    else for (const c of w.ccs) if (c.ay1 - c.ay0 > H * 0.25) pts.push([c.cx, c.ay1 + 1]);
  }
  if (pts.length < 3) return;
  const res = pts.map(([x, y]) => y - L.baseY(x));
  const off = median(res);
  const inl = pts.filter((p, i) => Math.abs(res[i] - off) < H * 0.12);
  if (inl.length < 3) return;
  let slope = L.slope;
  const xs = inl.map((p) => p[0]);
  if (inl.length >= 6 && Math.max(...xs) - Math.min(...xs) > H * 4) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = inl.reduce((a, p) => a + p[1], 0) / inl.length;
    let sxy = 0, sxx = 0;
    for (const [x, y] of inl) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); }
    const b = sxx ? sxy / sxx : slope;
    if (Math.abs(b - slope) < 0.02) slope = b;
  }
  const c0 = median(inl.map(([x, y]) => y - slope * x));
  L.slope = slope;
  L.baseY = (x) => c0 + slope * x;
}

// Slant of the letters: the shear that makes the vertical strokes line up best
function shearOf(lab, w, rx0, ry0, ccs, baseY) {
  if (!ccs.length) return 0;
  const ids = new Set(ccs.map((c) => c.id));
  let n = 0;
  for (const c of ccs) n += c.area;
  if (n < 20) return 0;
  const xs = new Float32Array(n), ys = new Float32Array(n);
  let k = 0, xmin = Infinity, xmax = -Infinity, ymax = 0;
  for (const c of ccs) {
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        if (!ids.has(lab[y * w + x]) || k >= n) continue;
        const ax = x + rx0, up = baseY(ax) - (y + ry0);
        xs[k] = ax; ys[k] = up; k++;
        if (ax < xmin) xmin = ax; if (ax > xmax) xmax = ax; if (Math.abs(up) > ymax) ymax = Math.abs(up);
      }
    }
  }
  const off = Math.ceil(ymax * 0.6) + 2;
  const hist = new Int32Array(Math.ceil(xmax - xmin) + off * 2 + 4);
  const score = (s) => {
    hist.fill(0);
    for (let i = 0; i < k; i++) hist[Math.round(xs[i] - s * ys[i] - xmin) + off]++;
    let t = 0;
    for (let i = 0; i < hist.length; i++) t += hist[i] * hist[i];
    return t;
  };
  const steps = [];
  for (let s = -0.1; s <= 0.55001; s += 0.05) steps.push(s);
  const sc = steps.map(score);
  let best = 0, bs = -1;
  sc.forEach((v, i) => { if (v > bs) { bs = v; best = i; } });
  if (bs < sc[2] * 1.06) return 0; // no clear lean: call it upright
  if (best > 0 && best < sc.length - 1) {
    const a = sc[best - 1], b = sc[best], c = sc[best + 1];
    const den = a - 2 * b + c;
    const o = den ? (0.5 * (a - c)) / den : 0;
    return steps[best] + clamp(o, -0.5, 0.5) * 0.05;
  }
  return steps[best];
}


// ---------------------------------------------------------------- styles
function styleDist(a, b) {
  if (!a || !b || !a.size || !b.size) return 9;
  const sw = a.swr > 0 && b.swr > 0 ? Math.abs(Math.log(a.swr / b.swr)) : 0.5;
  return 3 * Math.abs(Math.log(a.size / b.size)) + 2.5 * sw + 4 * Math.abs(a.slant - b.slant);
}

function buildClusters(P) {
  const clusters = [];
  for (const L of P.lines) {
    for (const w of L.words) {
      if (!w.matched || !w.style.size || w.style.borrowed) continue;
      let best = null, bd = 0.65;
      for (const c of clusters) { const d = styleDist(w.style, c.style); if (d < bd) { bd = d; best = c; } }
      if (!best) { best = { words: [], style: { ...w.style } }; clusters.push(best); }
      best.words.push(w);
      const ws = best.words.map((x) => x.style);
      const med = (k) => median(ws.map((s) => s[k]).filter((v) => v !== null && v !== undefined));
      best.style = { size: med('size'), swr: med('swr'), slant: med('slant'), xh: med('xh') || null, cap: med('cap') || null, sw: med('sw') };
      if (Number.isNaN(best.style.xh)) best.style.xh = null;
      if (Number.isNaN(best.style.cap)) best.style.cap = null;
    }
  }
  for (const c of clusters) {
    c.samples = new Map();
    c.pairs = [];
    for (const w of c.words) {
      w.cluster = c;
      w.samples.forEach((s, i) => {
        if (!c.samples.has(s.ch)) c.samples.set(s.ch, []);
        c.samples.get(s.ch).push(s);
        const n = w.samples[i + 1];
        if (n) c.pairs.push([s.ch, n.ch, n.ax0 - s.ax1 - 1]);
      });
    }
    const gaps = [];
    for (const L of P.lines) for (let i = 1; i < L.words.length; i++) if (L.words[i].cluster === c && L.words[i - 1].cluster === c) { const g = L.words[i].ix0 - L.words[i - 1].ix1 - 1; if (g > 0 && g < c.style.size * 1.6) gaps.push(g); }
    c.wordGap = gaps.length ? median(gaps) : null;
  }
  P.clusters = clusters;
}

function clusterFor(P, style) {
  let best = null, bd = Infinity;
  for (const c of P.clusters) { const d = styleDist(style, c.style); if (d < bd) { bd = d; best = c; } }
  return best;
}

// ---------------------------------------------------------------- matching fonts
const FAMILIES = [
  { css: 'Folio Calibri', serif: false }, { css: 'Folio Cambria', serif: true }, { css: 'Folio Sans', serif: false },
  { css: 'Folio Serif', serif: true }, { css: 'Folio Mono', serif: false },
];
const VARIANTS = [];
for (const f of FAMILIES) for (const weight of ['400', '700']) for (const style of ['normal', 'italic']) VARIANTS.push({ ...f, weight, style });

const gcan = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const gctx = gcan ? gcan.getContext('2d', { willReadFrequently: true }) : null;
const cssFont = (v, px) => `${v.style} ${v.weight} ${px.toFixed(2)}px "${v.css}", ${v.serif ? 'serif' : 'sans-serif'}`;

let fontsReady = null;
function loadFonts() {
  if (!fontsReady) {
    registerTextFonts();
    fontsReady = Promise.all(VARIANTS.map((v) => document.fonts.load(cssFont(v, 40), 'Hxg').catch(() => null))).then(() => {
      for (const v of VARIANTS) {
        gctx.font = cssFont(v, 100);
        v.xh = gctx.measureText('x').actualBoundingBoxAscent / 100 || 0.5;
        v.cap = gctx.measureText('H').actualBoundingBoxAscent / 100 || 0.7;
      }
    });
  }
  return fontsReady;
}

// A letter drawn with a font, as an ink-coverage mask
function fontGlyph(v, ch, px, { blur = 0, stroke = 0 } = {}) {
  gctx.font = cssFont(v, px);
  const m = gctx.measureText(ch);
  const pad = Math.ceil(2 + blur * 3 + stroke);
  const abl = m.actualBoundingBoxLeft || 0, abr = m.actualBoundingBoxRight || m.width;
  const asc = m.actualBoundingBoxAscent || px * 0.7, desc = m.actualBoundingBoxDescent || 0;
  const W = Math.max(1, Math.ceil(abl + abr) + pad * 2), H = Math.max(1, Math.ceil(asc + desc) + pad * 2);
  gcan.width = W; gcan.height = H;
  gctx.font = cssFont(v, px);
  gctx.clearRect(0, 0, W, H);
  gctx.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
  gctx.fillStyle = '#000'; gctx.strokeStyle = '#000';
  const ox = pad + abl, oy = pad + asc;
  gctx.fillText(ch, ox, oy);
  if (stroke > 0.05) { gctx.lineWidth = stroke; gctx.lineJoin = 'round'; gctx.strokeText(ch, ox, oy); }
  gctx.filter = 'none';
  const d = gctx.getImageData(0, 0, W, H).data;
  const mk = new Float32Array(W * H);
  let x0 = W, x1 = -1, y0 = H, y1 = -1, area = 0, per = 0;
  for (let i = 0; i < W * H; i++) mk[i] = d[i * 4 + 3] / 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const on = mk[y * W + x] >= 0.5;
      if (!on) continue;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || mk[y * W + x - 1] < 0.5) per++;
      if (x === W - 1 || mk[y * W + x + 1] < 0.5) per++;
      if (y === 0 || mk[(y - 1) * W + x] < 0.5) per++;
      if (y === H - 1 || mk[(y + 1) * W + x] < 0.5) per++;
    }
  }
  if (x1 < 0) { x0 = pad; x1 = pad; y0 = pad; y1 = pad; }
  return {
    m: mk, mw: W, mh: H, offX: -x0, offY: -oy, inkW: x1 - x0 + 1, inkTop: y0 - oy, inkBot: y1 + 1 - oy,
    adv: m.width, lsb: x0 - ox, rsb: m.width - (x1 + 1 - ox), sw: per ? (2 * area) / per : 0,
  };
}

function softness(mk, mw, mh) {
  let soft = 0, per = 0;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const a = mk[y * mw + x];
      if (a > 0.15 && a < 0.85) soft++;
      if (a >= 0.5 && x + 1 < mw && mk[y * mw + x + 1] < 0.5) per++;
      if (a >= 0.5 && y + 1 < mh && mk[(y + 1) * mw + x] < 0.5) per++;
    }
  }
  return per ? soft / per : 1;
}

// Overlap of two masks aligned on their ink centres (1 = identical)
function maskSimilarity(a, b) {
  const cen = (s) => { let sx = 0, sy = 0, t = 0; for (let y = 0; y < s.mh; y++) for (let x = 0; x < s.mw; x++) { const v = s.m[y * s.mw + x]; sx += v * x; sy += v * y; t += v; } return t ? [sx / t, sy / t] : [s.mw / 2, s.mh / 2]; };
  const [ax, ay] = cen(a), [bx, by] = cen(b);
  const dx = Math.round(ax - bx), dy = Math.round(ay - by);
  const x0 = Math.min(0, dx), y0 = Math.min(0, dy), x1 = Math.max(a.mw, b.mw + dx), y1 = Math.max(a.mh, b.mh + dy);
  let mn = 0, mx = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const va = x >= 0 && y >= 0 && x < a.mw && y < a.mh ? a.m[y * a.mw + x] : 0;
      const xb = x - dx, yb = y - dy;
      const vb = xb >= 0 && yb >= 0 && xb < b.mw && yb < b.mh ? b.m[yb * b.mw + xb] : 0;
      mn += Math.min(va, vb); mx += Math.max(va, vb);
    }
  }
  return mx ? mn / mx : 0;
}

function pxFor(v, style) {
  if (style.xh) return style.xh / v.xh;
  if (style.cap) return style.cap / v.cap;
  return style.size / v.xh;
}

function representative(list) {
  const hs = list.map((s) => s.mh);
  const mh = median(hs);
  return [...list].sort((a, b) => Math.abs(a.mh - mh) - Math.abs(b.mh - mh))[0];
}

// Fonts and spacing are fitted per style the first time that style is needed
async function fitClusters(P) {
  await loadFonts();
  for (const c of P.clusters) lazyFit(c);
  const main = P.clusters.slice().sort((a, b) => b.words.length - a.words.length)[0];
  Object.defineProperty(P, 'fallbackStyleFont', { configurable: true, get: () => (main ? main.font : null) });
}
function lazyFit(c) {
  let done = false;
  const ensure = () => { if (!done) { done = true; delete c.font; delete c.gap; delete c.space; fitCluster(c); } };
  Object.defineProperty(c, 'font', { configurable: true, enumerable: true, get: () => { ensure(); return c.font; } });
  Object.defineProperty(c, 'gap', { configurable: true, enumerable: true, get: () => { ensure(); return c.gap; } });
  Object.defineProperty(c, 'space', { configurable: true, enumerable: true, get: () => { ensure(); return c.space; } });
}

const fitCache = new Map();
function fitCluster(c) {
  // the letters to compare: the most frequent ones in this style
  const chars = [...c.samples.entries()].filter(([ch]) => /[\p{L}\p{N}]/u.test(ch)).sort((a, b) => b[1].length - a[1].length).slice(0, 10);
  const reps = chars.map(([ch, list]) => [ch, representative(list), list]);
  const sampleSoft = median(reps.slice(0, 4).map(([, r]) => softness(r.m, r.mw, r.mh)));
  const sig = `${Math.round(c.style.size * 2)}:${(c.style.swr || 0).toFixed(2)}:${(c.style.slant || 0).toFixed(1)}:${chars.map(([ch]) => ch).join('')}:${(sampleSoft || 0).toFixed(1)}`;
  let fit = fitCache.get(sig);
  if (!fit) {
    // first pass: overall shape
    const cand = [];
    for (const v of VARIANTS) {
      const px = pxFor(v, c.style);
      if (!(px > 2 && px < 2000)) continue;
      let score = 0;
      for (const [ch, rep] of reps) score += maskSimilarity(rep, fontGlyph(v, ch, px, { blur: 0.6 }));
      cand.push({ v, px, score: score / Math.max(1, reps.length) });
    }
    cand.sort((a, b) => b.score - a.score);
    // second pass: the best few, tuned to the scan's ink weight (ink mass is unchanged by blur) and edge softness
    const mass = (g) => { let t = 0; for (let i = 0; i < g.m.length; i++) t += g.m[i]; return t; };
    const sMass = reps.map(([, rep]) => mass(rep));
    let best = null;
    for (const cd of cand.slice(0, 5)) {
      const { v, px } = cd;
      let stroke = 0, rbest = Infinity, ratio = 1;
      for (const st of [0, 0.25, 0.5, 0.8, 1.1, 1.5].map((k) => (k * px) / 30)) {
        const r = median(reps.map(([ch], i) => mass(fontGlyph(v, ch, px, { stroke: st })) / Math.max(1, sMass[i])));
        if (Math.abs(Math.log(r)) < rbest) { rbest = Math.abs(Math.log(r)); stroke = st; ratio = r; }
      }
      let blur = 0, bd = Infinity;
      for (const b of [0, 0.35, 0.7, 1.05, 1.4, 1.8]) {
        const soft = median(reps.slice(0, 4).map(([ch]) => { const g = fontGlyph(v, ch, px, { blur: b, stroke }); return softness(g.m, g.mw, g.mh); }));
        const d = Math.abs(soft - sampleSoft);
        if (d < bd) { bd = d; blur = b; }
      }
      let score = 0;
      for (const [ch, rep] of reps) score += maskSimilarity(rep, fontGlyph(v, ch, px, { blur, stroke }));
      score /= Math.max(1, reps.length);
      const final = score - 1.2 * Math.abs(Math.log(ratio)) - (stroke > 0 ? 0.02 : 0);
      if (!best || final > best.final) best = { v, px, stroke, blur, score, final };
    }
    if (!best) best = { v: VARIANTS[2], px: (c.style.size || 10) / 0.52, stroke: 0, blur: 0, score: 0 };
    fit = best;
    fitCache.set(sig, fit);
  }
  const best = fit;
  const { v, px, stroke, blur } = fit;
  c.font = { v, px, stroke, blur, score: best.score };
  // letter spacing: side bearings fitted to the gaps seen in the scan, starting from the font's own
  const metric = new Map();
  const fm = (ch) => { if (!metric.has(ch)) { const g = fontGlyph(v, ch, px); metric.set(ch, { lsb: g.lsb, rsb: g.rsb }); } return metric.get(ch); };
  const resid = c.pairs.map(([a, b, gap]) => gap - fm(a).rsb - fm(b).lsb);
  const track = resid.length ? median(resid) : 0;
  const lsb = new Map(), rsb = new Map();
  const getL = (ch) => (lsb.has(ch) ? lsb.get(ch) : fm(ch).lsb + track / 2);
  const getR = (ch) => (rsb.has(ch) ? rsb.get(ch) : fm(ch).rsb + track / 2);
  const lam = 2;
  for (let it = 0; it < 6; it++) {
    const accR = new Map(), accL = new Map();
    for (const [a, b, gap] of c.pairs) {
      const r = accR.get(a) || [0, 0]; r[0] += gap - getL(b); r[1]++; accR.set(a, r);
    }
    for (const [ch, [s, n]] of accR) rsb.set(ch, (lam * (fm(ch).rsb + track / 2) + s) / (lam + n));
    for (const [a, b, gap] of c.pairs) {
      const l = accL.get(b) || [0, 0]; l[0] += gap - getR(a); l[1]++; accL.set(b, l);
    }
    for (const [ch, [s, n]] of accL) lsb.set(ch, (lam * (fm(ch).lsb + track / 2) + s) / (lam + n));
  }
  c.gap = (a, b) => Math.max(-c.style.size * 0.15, getR(a) + getL(b));
  const spaceAdv = (() => { gctx.font = cssFont(v, px); return gctx.measureText(' ').width; })();
  c.space = c.wordGap || Math.max(1, spaceAdv + track);
}

// ---------------------------------------------------------------- letters for new text
function resize(p, s) {
  if (Math.abs(s - 1) < 0.03) return p;
  const mw = Math.max(1, Math.round(p.mw * s)), mh = Math.max(1, Math.round(p.mh * s));
  const m = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const sy = clamp((y + 0.5) / s - 0.5, 0, p.mh - 1);
    const y0 = Math.floor(sy), y1 = Math.min(p.mh - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < mw; x++) {
      const sx = clamp((x + 0.5) / s - 0.5, 0, p.mw - 1);
      const x0 = Math.floor(sx), x1 = Math.min(p.mw - 1, x0 + 1), fx = sx - x0;
      const a = p.m[y0 * p.mw + x0] * (1 - fx) + p.m[y0 * p.mw + x1] * fx;
      const b = p.m[y1 * p.mw + x0] * (1 - fx) + p.m[y1 * p.mw + x1] * fx;
      m[y * mw + x] = a * (1 - fy) + b * fy;
    }
  }
  return { ...p, m, mw, mh, offX: p.offX * s, offY: p.offY * s, inkW: p.inkW * s, inkTop: p.inkTop * s, inkBot: p.inkBot * s };
}

function letter(P, ch, style, { word = null, line = null } = {}) {
  // 1. the same letter in the scan, in the same weight and slant (size is scaled to fit)
  let best = null, bd = Infinity;
  // stroke weight compared directly (sizes within ~15%) or relative to size otherwise
  const shape = (a, b) => {
    let w = 0.5;
    if (a.sw > 0 && b.sw > 0 && a.size && b.size) {
      const rs = a.size / b.size;
      w = 2.5 * Math.abs(Math.log((a.sw / b.sw) / (Math.abs(Math.log(rs)) > 0.14 ? rs : 1)));
    }
    return w + 4 * Math.abs(a.slant - b.slant);
  };
  for (const c of P.clusters) {
    const list = c.samples.get(ch);
    if (!list) continue;
    if (shape(style, c.style) > 0.7) continue;
    const med = median(list.map((x) => x.mh));
    for (const s of list) {
      const st = s.word.style;
      const ds = shape(style, st);
      if (ds > 0.45) continue;
      const r = style.size && st.size ? style.size / st.size : 1;
      if (r < 0.65 || r > 1.5) continue;
      let d = ds + 1.5 * Math.abs(Math.log(r)) + 0.02 * Math.abs(s.mh - med);
      if (word && (s.word === word || s.word === word.orig)) d -= 0.3;
      else if (line && (s.line === line || s.line === line.orig)) d -= 0.1;
      if (d < bd) { bd = d; best = s; }
    }
  }
  if (best) {
    const k = style.size && best.word.style.size ? style.size / best.word.style.size : 1;
    return { ...resize(best, k), ch, from: 'scan', srcWord: best.word.text, dist: bd };
  }
  // 2. the best-matching font, tuned to look like the scan
  const c = clusterFor(P, style);
  const font = c ? c.font : P.fallbackStyleFont;
  if (!font) return null;
  const k = c && c.style.size && style.size ? style.size / c.style.size : 1;
  const g = fontGlyph(font.v, ch, font.px * k, { blur: font.blur, stroke: font.stroke * k });
  return { ...g, ch, from: 'font' };
}

// ---------------------------------------------------------------- layout of an edited line
function lcs(a, b, eq = (x, y) => x === y) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

function tokenize(text) {
  const out = [];
  const re = /(\s*)(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push({ spaces: m[1].length, text: m[2], start: m.index + m[1].length });
  return { words: out, trailing: text.length - (out.length ? out[out.length - 1].start + out[out.length - 1].text.length : 0) };
}

function layoutLine(P, L, text, recolor) {
  const { words: toks } = tokenize(text);
  const O = L.words;
  const pairs = lcs(O.map((w) => w.text), toks.map((t) => t.text));
  // pair up the words between matches so edited words can keep their unchanged letters
  const src = toks.map(() => null);
  const used = new Set();
  let pi = 0, oi = 0, ti = 0;
  const flush = (oEnd, tEnd) => {
    let o = oi;
    for (let t = ti; t < tEnd; t++) { if (o < oEnd) { src[t] = { kind: 'mod', o: O[o] }; used.add(o); o++; } else src[t] = { kind: 'new' }; }
  };
  for (; pi <= pairs.length; pi++) {
    const [oEnd, tEnd] = pi < pairs.length ? pairs[pi] : [O.length, toks.length];
    flush(oEnd, tEnd);
    if (pi < pairs.length) { src[tEnd] = { kind: 'same', o: O[oEnd] }; used.add(oEnd); oi = oEnd + 1; ti = tEnd + 1; }
  }
  const pieces = [];
  const untouched = [];
  const erase = new Set();
  const fallback = new Set();
  const carets = new Array(text.length + 1).fill(null);
  const anchor = O.length ? O[0].ix0 : 0;
  const space = (st) => { const c = clusterFor(P, st); return L.wordGap || (c && c.space) || st.size * 0.6; };
  let prev = null; // { right, o (orig word index), style }
  let lastStyle = O.length ? O[0].style : null;
  for (let ti2 = 0; ti2 < toks.length; ti2++) {
    const t = toks[ti2];
    const s = src[ti2];
    const oIdx = s.o ? O.indexOf(s.o) : -1;
    const style = s.o ? s.o.style : (prev ? prev.style : lastStyle);
    const sp = space(style);
    let x;
    if (!prev) x = anchor + (t.spaces ? t.spaces * sp : 0);
    else if (oIdx > 0 && prev.oIdx === oIdx - 1 && t.spaces === 1 && s.kind !== 'new' && O[oIdx].ccs.length && O[oIdx - 1].ccs.length && O[oIdx].ix0 - O[oIdx - 1].ix1 > 1) x = prev.right + (O[oIdx].ix0 - O[oIdx - 1].ix1);
    else x = prev.right + 1 + Math.max(1, t.spaces) * sp;
    if (!prev && s.kind === 'same' && oIdx === 0) x = O[0].ix0;
    x = Math.round(x);
    let right;
    const charX = [];
    if (s.kind === 'same') {
      const o = s.o;
      const dx = x - o.ix0;
      if (dx !== 0 || recolor) {
        for (const id of o.ccIds) erase.add(id);
        pieces.push({ p: o.piece, x, cx: x + o.piece.inkW / 2 });
      } else if (o.ccs.length) untouched.push(o);
      right = x + (o.ix1 - o.ix0);
      if (o.matched) o.blobs.forEach((b) => charX.push([b.ax0 + dx, b.ax1 + dx]));
      else o.chars.forEach((_, i) => { const u = o.ux[i]; const k = (o.ix1 - o.ix0) / Math.max(1, o.ox1 - o.ox0); charX.push([x + (u[0] - o.ox0) * k, x + (u[1] - o.ox0) * k]); });
    } else {
      const chars = [...t.text];
      const o = s.kind === 'mod' ? s.o : null;
      if (o) for (const id of o.ccIds) erase.add(id);
      // which letters of the old word survive
      let keepMap = new Map();
      let block = null;
      if (o && o.matched) {
        for (const [a, b] of lcs(o.chars, chars)) keepMap.set(b, a);
      } else if (o && o.ccs.length) {
        const joined = chars.join('');
        if (joined.startsWith(o.text)) block = { at: 0, len: o.chars.length };
        else if (joined.endsWith(o.text)) block = { at: chars.length - o.chars.length, len: o.chars.length };
      }
      const wordPieces = [];
      let cx = x;
      let prevCh = null, prevKept = null;
      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci];
        let piece, kept = null;
        if (block && ci === block.at) {
          piece = o.piece; kept = 'block';
        } else if (block && ci > block.at && ci < block.at + block.len) {
          continue;
        } else if (keepMap.has(ci)) {
          const bi = keepMap.get(ci);
          const smp = o.samples[bi];
          piece = smp; kept = bi;
        } else {
          piece = letter(P, ch, style, { word: o, line: L });
          if (!piece) continue;
          if (piece.from === 'font') fallback.add(ch);
        }
        if (prevCh !== null) {
          let gap;
          if (typeof kept === 'number' && typeof prevKept === 'number' && kept === prevKept + 1) gap = o.blobs[kept].ax0 - o.blobs[prevKept].ax1 - 1;
          else {
            const c = clusterFor(P, style);
            const a = prevKept === 'block' ? o.chars[o.chars.length - 1] : prevCh;
            gap = c ? c.gap(a, kept === 'block' ? o.chars[0] : ch) : style.size * 0.1;
          }
          cx += gap + 1;
        }
        cx = Math.round(cx);
        wordPieces.push({ p: piece, x: cx, cx: cx + piece.inkW / 2 });
        if (kept === 'block') {
          const k = piece.inkW / Math.max(1, o.ox1 - o.ox0);
          o.ux.forEach((u) => charX.push([cx + (u[0] - o.ox0) * k, cx + (u[1] - o.ox0) * k]));
          prevCh = o.chars[o.chars.length - 1];
        } else {
          charX.push([cx, cx + piece.inkW - 1]);
          prevCh = ch;
        }
        prevKept = kept;
        cx += piece.inkW - 1;
      }
      pieces.push(...wordPieces);
      right = cx;
    }
    // caret positions inside the word
    for (let ci = 0; ci <= charX.length; ci++) {
      const pos = t.start + ci;
      if (pos > text.length) break;
      const xb = ci === 0 ? charX[0][0] - 1 : ci === charX.length ? charX[ci - 1][1] + 1 : (charX[ci - 1][1] + charX[ci][0]) / 2;
      carets[pos] = xb;
    }
    prev = { right, oIdx, style };
    lastStyle = style;
  }
  // removed words disappear
  O.forEach((o, i) => { if (!used.has(i)) for (const id of o.ccIds) erase.add(id); });
  // carets in runs of spaces: spread over the gap
  let last = anchor - 1;
  for (let i = 0; i <= text.length; i++) {
    if (carets[i] !== null) { last = carets[i]; continue; }
    let j = i;
    while (j <= text.length && carets[j] === null) j++;
    const nextX = j <= text.length ? carets[j] : last + (j - i + 1) * space(lastStyle || { size: L.H * 0.45 });
    for (let k = i; k < j; k++) carets[k] = last + ((nextX - last) * (k - i + 1)) / (j - i + 1);
    i = j - 1;
  }
  // where the line's ink ends up (for the frame around the line being edited)
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const o of untouched) { bx0 = Math.min(bx0, o.ix0); bx1 = Math.max(bx1, o.ix1); by0 = Math.min(by0, o.iy0); by1 = Math.max(by1, o.iy1); }
  for (const pc of pieces) {
    const p = pc.p;
    const left = Math.round(pc.x + p.offX), topY = Math.round(L.baseY(pc.cx) + p.offY);
    const r = p.offX < 0 ? -p.offX : 0;
    bx0 = Math.min(bx0, left + r); bx1 = Math.max(bx1, left + p.mw - 1 - r);
    by0 = Math.min(by0, topY + r); by1 = Math.max(by1, topY + p.mh - 1 - r);
  }
  const bounds = isFinite(bx0) ? { x0: bx0, y0: by0, x1: bx1, y1: by1 } : null;
  return { pieces, erase, fallback: [...fallback], carets, right: prev ? prev.right : anchor, bounds };
}

// ---------------------------------------------------------------- painting
function compose(P, L, lay, view, ink) {
  const { x0, y0, w, h } = view;
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * P.w + x0) * 4;
    d.set(P.rgba.subarray(s, s + w * 4), y * w * 4);
  }
  // clean the paper under removed or moved ink
  if (lay.erase.size) {
    for (let y = 0; y < L.rh; y++) {
      for (let x = 0; x < L.rw; x++) {
        const i = y * L.rw + x;
        const id = L.lab2[i];
        if (!id || !lay.erase.has(id)) continue;
        const vx = L.rx0 + x - x0, vy = L.ry0 + y - y0;
        if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
        const n = grain(L.rx0 + x, L.ry0 + y) * L.noise;
        const o = (vy * w + vx) * 4;
        d[o] = L.paper[i * 3] + n; d[o + 1] = L.paper[i * 3 + 1] + n; d[o + 2] = L.paper[i * 3 + 2] + n;
      }
    }
  }
  // ink
  for (const pc of lay.pieces) {
    const p = pc.p;
    const left = Math.round(pc.x + p.offX);
    const top = Math.round(L.baseY(pc.cx) + p.offY);
    for (let yy = 0; yy < p.mh; yy++) {
      const vy = top + yy - y0;
      if (vy < 0 || vy >= h) continue;
      for (let xx = 0; xx < p.mw; xx++) {
        const a = p.m[yy * p.mw + xx];
        if (a <= 0.004) continue;
        const vx = left + xx - x0;
        if (vx < 0 || vx >= w) continue;
        const o = (vy * w + vx) * 4;
        d[o] = d[o] * (1 - a) + ink[0] * a;
        d[o + 1] = d[o + 1] * (1 - a) + ink[1] * a;
        d[o + 2] = d[o + 2] * (1 - a) + ink[2] * a;
      }
    }
  }
  return img;
}

// ---------------------------------------------------------------- the editing session
export async function startScanEdit(pv, g, { onEnd, clientX = null }) {
  let P;
  const done = busy('Getting the scan ready…');
  try {
    P = await pageScan(pv);
  } catch (e) {
    console.error(e);
    toast(`This scanned line can't be edited: ${e.message || e}`);
    return null;
  } finally { done(); }
  const L0 = P.byGroup.get(g.id);
  if (!L0) { toast('This line is too slanted to edit. Straighten the scan, or cover it with white-out and add new text.', { ms: 6000 }); return null; }
  // full detail for the line being edited
  const L = { ...L0, orig: L0, words: L0.words.map((w) => ({ ...w, orig: w })) };
  analyzeLine(P, L, true);
  const version = S.version;
  const text0 = L.words.map((w) => w.text).join(' ');
  const k = pv.scale / P.R;
  // the area we preview: the line, with room to grow to the right edge of the page
  const view = {
    x0: L.rx0, y0: L.ry0,
    w: Math.max(L.rw, Math.min(P.w - L.rx0, Math.round(L.rw + L.H * 30))), h: L.rh,
  };
  const wrap = el('div', { class: 'scanedit' });
  Object.assign(wrap.style, { left: `${view.x0 * k}px`, top: `${view.y0 * k}px`, width: `${view.w * k}px`, height: `${view.h * k}px` });
  const canvas = el('canvas', { class: 'scancanvas' });
  canvas.width = view.w; canvas.height = view.h;
  const ctx = canvas.getContext('2d');
  const frame = el('div', { class: 'scanframe' });
  const caret = el('div', { class: 'scaret' });
  const selLayer = el('div', { class: 'scansel' });
  const input = el('input', { class: 'scaninput', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Edit scanned text line' });
  input.value = text0;
  wrap.append(canvas, frame, selLayer, caret, input);
  wrap.style.pointerEvents = 'all';
  pv.uiLayer.append(wrap);

  const sess = {
    scan: true, pv, g, version, rgb: null, size: null, faithful: true,
    plan: { exact: true, fallbackChars: [] }, text0, wrap,
  };
  sess.debug = () => ({ R: P.R, view, H: L.H, H0: L.H0, words: L.words.map((w) => [w.text, w.ox0, w.ox1, w.ix0, w.ix1, w.iy0, w.iy1, w.ccs.length]), bounds: lay && lay.bounds, carets: lay && lay.carets });
  let lay = null;
  let lastText = null, lastSel = '';
  const inkRgb = () => (sess.rgb ? sess.rgb.map((v) => v * 255) : L.ink);
  const relayout = () => {
    const text = input.value;
    lay = layoutLine(P, L, text, !!sess.rgb);
    sess.plan = { exact: !lay.fallback.length, fallbackChars: lay.fallback, scan: true };
    ctx.putImageData(compose(P, L, lay, view, inkRgb()), 0, 0);
    // the frame hugs the words (or marks where the line is, when it's empty)
    const b = lay.bounds;
    const pad = Math.max(2, L.H * 0.12);
    const fx0 = b ? b.x0 : lay.carets[0], fx1 = b ? Math.max(b.x1, lay.carets[lay.carets.length - 1]) : lay.carets[0] + L.H * 0.5;
    const fy0 = b ? Math.min(b.y0, L.baseY(fx0) - L.H * 0.6) : L.baseY(fx0) - L.H * 0.75, fy1 = b ? Math.max(b.y1, L.baseY(fx0)) : L.baseY(fx0) + L.H * 0.1;
    Object.assign(frame.style, { left: `${(fx0 - pad - view.x0) * k}px`, top: `${(fy0 - pad - view.y0) * k}px`, width: `${(fx1 - fx0 + pad * 2) * k}px`, height: `${(fy1 - fy0 + pad * 2) * k}px` });
    lastText = input.value;
    sess.onChange && sess.onChange();
  };
  const caretAt = (i) => (lay.carets[clamp(i, 0, lay.carets.length - 1)] - view.x0) * k;
  const drawCaret = () => {
    const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
    const key = `${a}:${b}:${input.value}`;
    if (key === lastSel) return;
    lastSel = key;
    const lb = lay.bounds;
    const cy0 = lb ? Math.min(lb.y0, L.baseY(L.rx0) - L.H * 0.6) : L.baseY(L.rx0) - L.H * 0.75;
    const cy1 = lb ? Math.max(lb.y1, L.baseY(L.rx0)) : L.baseY(L.rx0) + L.H * 0.1;
    const top = (cy0 - view.y0) * k;
    const hh = (cy1 - cy0) * k;
    selLayer.textContent = '';
    if (a !== b) {
      const x1 = caretAt(Math.min(a, b)), x2 = caretAt(Math.max(a, b));
      const s = el('div');
      Object.assign(s.style, { left: `${x1}px`, top: `${top}px`, width: `${Math.max(1, x2 - x1)}px`, height: `${hh}px` });
      selLayer.append(s);
      caret.hidden = true;
    } else {
      caret.hidden = false;
      Object.assign(caret.style, { left: `${caretAt(a)}px`, top: `${top}px`, height: `${hh}px` });
      caret.classList.remove('blink'); void caret.offsetWidth; caret.classList.add('blink');
    }
  };
  let raf = 0;
  const tick = () => {
    if (!wrap.isConnected) return;
    if (input.value !== lastText) relayout();
    drawCaret();
    raf = requestAnimationFrame(tick);
  };
  const indexAt = (clientX) => {
    const r = wrap.getBoundingClientRect();
    const x = (clientX - r.left) / k + view.x0;
    let best = 0, bd = Infinity;
    lay.carets.forEach((cx, i) => { const dd = Math.abs(cx - x); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === input) return;
    e.preventDefault(); e.stopPropagation();
    input.focus();
    const a = indexAt(e.clientX);
    input.setSelectionRange(a, a);
    const move = (ev) => { const b = indexAt(ev.clientX); input.setSelectionRange(Math.min(a, b), Math.max(a, b), b < a ? 'backward' : 'forward'); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  wrap.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const i = indexAt(e.clientX);
    const v = input.value;
    let a = i, b = i;
    while (a > 0 && /\S/.test(v[a - 1])) a--;
    while (b < v.length && /\S/.test(v[b])) b++;
    input.setSelectionRange(a, b);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); sess.commit(); } else if (e.key === 'Escape') { e.preventDefault(); sess.cancel(); }
  });
  input.addEventListener('input', () => relayout());

  let ended = false;
  const end = () => {
    if (ended) return false;
    ended = true;
    cancelAnimationFrame(raf);
    wrap.remove();
    onEnd && onEnd();
    return true;
  };
  sess.cancel = () => { end(); };
  sess.setColor = (hex) => { sess.rgb = hexToRgb(hex); relayout(); input.focus(); };
  sess.color = () => rgbToHex(sess.rgb || L.ink.map((v) => v / 255));
  sess.remove = () => { input.value = ''; return sess.commit(); };
  sess.commit = async () => {
    if (ended) return;
    if (input.value !== lastText) relayout();
    const text = input.value;
    const changed = text !== text0 || !!sess.rgb;
    const final = lay;
    end();
    if (!changed) return;
    if (S.version !== version) { toast('The document changed while editing, so that edit was not applied.'); return; }
    await applyScanEdit(pv, P, L, g, final, view, inkRgb(), text);
  };
  relayout();
  input.focus();
  const at = clientX !== null ? indexAt(clientX) : text0.length;
  input.setSelectionRange(at, at);
  raf = requestAnimationFrame(tick);
  return sess;
}

// After an edit the page only changed inside the patch, so the next edit can start from the
// same pixels and the same letters instead of reading the whole page again.
async function carryOver(pv, P, img, view, rect) {
  const key = `${pv.key}@${S.version}`;
  const Q = { ...P, rgba: P.rgba, gray: P.gray, lines: [], byGroup: new Map(), clusters: [] };
  if (rect) {
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const so = ((y - view.y0) * view.w + (x - view.x0)) * 4, d = (y * P.w + x) * 4;
        Q.rgba[d] = img.data[so]; Q.rgba[d + 1] = img.data[so + 1]; Q.rgba[d + 2] = img.data[so + 2];
        Q.gray[y * P.w + x] = (img.data[so] * 77 + img.data[so + 1] * 150 + img.data[so + 2] * 29) >> 8;
      }
    }
  }
  const touches = (L) => rect && !(L.rx0 + L.rw <= rect.x0 || L.rx0 >= rect.x1 || L.ry0 + L.rh <= rect.y0 || L.ry0 >= rect.y1);
  const old = P.lines.map((L) => ({ L, text: L.words.map((w) => w.text).join(' '), x: L.words[0].ox0, y: L.baseY(L.words[0].ox0) }));
  const groups = analyze(pv.index).groups.filter((g) => g.invisible && g.text.trim());
  for (const g of groups) {
    const fresh = lineModel(Q, g);
    if (!fresh) continue;
    const text = fresh.words.map((w) => w.text).join(' ');
    const fx = fresh.words[0].ox0, fy = fresh.baseY(fx);
    const prev = old.find((o) => o.text === text && Math.abs(o.x - fx) < 2 && Math.abs(o.y - fy) < 2 && !touches(o.L));
    let L;
    if (prev) { L = prev.L; L.g = g; } else { L = fresh; analyzeLine(Q, L, false); }
    Q.lines.push(L);
    Q.byGroup.set(g.id, L);
  }
  buildClusters(Q);
  await fitClusters(Q);
  cache = { key, promise: Promise.resolve(Q), ready: Q };
  emit('scan-ready', pv);
}

// Where a recognised line's ink actually is, in view pixels (null until the page has been looked at)
export function inkFrame(pv, g) {
  if (!cache || cache.key !== `${pv.key}@${S.version}` || !cache.ready) return null;
  const P = cache.ready;
  const L = P.byGroup.get(g.id);
  if (!L || P.R <= 0) return null;
  const ws = L.words.filter((w) => w.ccs && w.ccs.length);
  if (!ws.length) return null;
  const k = pv.scale / P.R;
  const x0 = Math.min(...ws.map((w) => w.ix0)), x1 = Math.max(...ws.map((w) => w.ix1));
  const y0 = Math.min(...ws.map((w) => w.iy0)), y1 = Math.max(...ws.map((w) => w.iy1));
  const pad = 2;
  return { x: (x0 - pad) * k, y: (y0 - pad) * k, w: (x1 - x0 + 1 + pad * 2) * k, h: (y1 - y0 + 1 + pad * 2) * k, angle: Math.atan(L.slope) };
}

// Get the page ready in the background, so clicking a line feels instant
let warmTimer = 0;
export function prewarmScan(pv) {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => {
    if (!pv || !pv.bound || S.tool !== 'edittext') return;
    const key = `${pv.key}@${S.version}`;
    if (cache && cache.key === key) return;
    pageScan(pv).catch(() => {});
  }, 400);
}

function maybeWarm() {
  if (S.tool !== 'edittext') return;
  const pv = S.pages[S.currentPage];
  const f = pageFactsNow(pv);
  if (f && f.coverage > 0.02 && f.hasOcr) prewarmScan(pv);
}
for (const ev of ['tool', 'current-page', 'ocr-done', 'scan-facts', 'doc-changed', 'pages-built']) on(ev, () => setTimeout(maybeWarm, 0));

// ---------------------------------------------------------------- writing the edit into the PDF
async function applyScanEdit(pv, P, L, g, lay, view, ink, text) {
  const img = compose(P, L, lay, view, ink);
  // only the pixels that actually changed
  const { w, h } = view;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const s = ((view.y0 + y) * P.w + view.x0) * 4;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, so = s + x * 4;
      if (img.data[o] !== P.rgba[so] || img.data[o + 1] !== P.rgba[so + 1] || img.data[o + 2] !== P.rgba[so + 2]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  let png = null, rect = null;
  if (x1 >= 0) {
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    const c = document.createElement('canvas');
    c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
    c.getContext('2d').putImageData(img, -x0, -y0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    png = new Uint8Array(await blob.arrayBuffer());
    rect = { x0: view.x0 + x0, y0: view.y0 + y0, x1: view.x0 + x1 + 1, y1: view.y0 + y1 + 1 };
  }
  // the new words for the invisible text layer, in page space
  const toPdf = (x, y) => P.vp.convertToPdfPoint(x, y);
  const ax = L.words.length ? L.words[0].ix0 : L.rx0;
  const o = toPdf(ax, L.baseY(ax));
  const e = toPdf(ax + 100, L.baseY(ax + 100));
  const len = Math.hypot(e[0] - o[0], e[1] - o[1]) || 1;
  const dir = [(e[0] - o[0]) / len, (e[1] - o[1]) / len];
  const along = (x) => { const p = toPdf(x, L.baseY(x)); return (p[0] - o[0]) * dir[0] + (p[1] - o[1]) * dir[1]; };
  const { words: toks } = tokenize(text);
  const words = toks.map((t) => {
    const a = lay.carets[t.start], b = lay.carets[t.start + [...t.text].length] ?? lay.carets[t.start + t.text.length];
    return { text: t.text, s0: along(a + 1), s1: along(b - 1) };
  }).filter((x2) => x2.s1 > x2.s0);
  const line = { origin: o, dir, size: L.sizePt || 10, words };
  let cm = '';
  if (png) {
    const bl = toPdf(rect.x0, rect.y1), br = toPdf(rect.x1, rect.y1), tl = toPdf(rect.x0, rect.y0);
    const f = (n) => (+n).toFixed(4);
    cm = [br[0] - bl[0], br[1] - bl[1], tl[0] - bl[0], tl[1] - bl[1], bl[0], bl[1]].map(f).join(' ');
  }
  const v0 = S.version;
  const ok = await changeDoc(async (doc) => {
    await E.applyGroupEdit(doc, g, { remove: true }, loadFontBytes);
    let extra = '';
    if (png) {
      const im = await doc.embedPng(png);
      const page = doc.getPage(pv.index);
      const name = page.node.newXObject('FoScan', im.ref).toString().replace(/^\//, '');
      extra = `q ${cm} cm /${name} Do Q\n`;
    }
    await addTextLayer(doc, pv.index, words.length ? [line] : [], extra);
  }, { message: 'Applying edit…' });
  if (ok !== false && S.version === v0 + 1) {
    try { await carryOver(pv, P, img, view, rect); } catch (e) { console.warn('scan cache not carried over', e); cache = null; }
  }
}

// for automated checks
export const __test = { pageScan, layoutLine, analyzeLine, compose };
