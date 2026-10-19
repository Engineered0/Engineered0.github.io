// Reading scanned pages (OCR). Recognised words are written into the PDF as an
// invisible text layer, the same way scanners and Acrobat do it, so the scan
// becomes searchable and selectable, and Edit Text can change its words.

import { S, emit, on, el } from './state.js';
import { pdfjsLib, analyze, changeDoc, docSettled } from './doc.js';
import { busy, busyMessage, toast } from './ui.js';
import { ensureBound, whenBuilt } from './viewer.js';
import { icon } from './icons.js';

const OCR_BASE = new URL('../vendor/ocr/', import.meta.url).href;
const L = () => window.PDFLib || globalThis.PDFLib;

// ---------------------------------------------------------------- engine (worker)
let engine = null;
let engineInfo = null;
function startEngine() {
  if (engine) return engine;
  const worker = new Worker(new URL('./ocr-worker.js', import.meta.url));
  let seq = 0;
  const waiting = new Map();
  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data;
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (ok) w.resolve(result); else w.reject(new Error(error));
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || 'The text reader stopped.'));
    waiting.clear();
    engine = null;
  };
  const call = (cmd, args, transfer = []) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, cmd, args }, transfer);
  });
  engine = call('init', { base: OCR_BASE }).then((info) => { engineInfo = info.kind; return { call, info, worker }; });
  engine.catch(() => { engine = null; try { worker.terminate(); } catch (e) { /* ignore */ } });
  return engine;
}

// ---------------------------------------------------------------- page facts
const facts = new Map(); // key@version -> Promise<{ imageScale, coverage, scan, hasOcr }>
const factsDone = new Map();

function trackImages(opList, view) {
  const O = pdfjsLib.OPS;
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  let best = null;
  const pageArea = Math.abs((view[2] - view[0]) * (view[3] - view[1])) || 1;
  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const a = argsArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(a, ctm);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm); if (a && a[0]) ctm = mul(a[0], ctm); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || ctm;
    else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintImageMaskXObject) {
      let w = 0, h = 0;
      if (fn === O.paintImageXObject) { w = a[1]; h = a[2]; } else if (a && a[0]) { w = a[0].width; h = a[0].height; }
      const sx = Math.hypot(ctm[0], ctm[1]), sy = Math.hypot(ctm[2], ctm[3]);
      const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      if (!w || !h || !sx || !sy) continue;
      if (!best || area > best.area) best = { area, scale: Math.min(w / sx, h / sy), coverage: area / pageArea };
    }
  }
  return best;
}

export function pageFacts(pv) {
  const key = `${pv.key}@${S.version}`;
  if (!facts.has(key)) {
    const p = (async () => {
      await ensureBound(pv);
      let img = null;
      try { img = trackImages(await pv.pdfPage.getOperatorList({ intent: 'display', annotationMode: pdfjsLib.AnnotationMode.DISABLE }), pv.pdfPage.view); } catch (e) { /* ignore */ }
      let visibleChars = 0, invisibleChars = 0;
      try {
        for (const g of analyze(pv.index).groups) {
          const n = g.text.replace(/\s/g, '').length;
          if (g.invisible) invisibleChars += n; else visibleChars += n;
        }
      } catch (e) { /* ignore */ }
      const coverage = img ? img.coverage : 0;
      const scan = coverage > 0.45 && visibleChars < 60;
      const f = { imageScale: img ? img.scale : 0, coverage, scan, hasOcr: invisibleChars > 0, needsOcr: scan && invisibleChars === 0, canRead: coverage > 0.02 && invisibleChars === 0 };
      factsDone.set(key, f);
      return f;
    })();
    facts.set(key, p);
  }
  return facts.get(key);
}
export function pageFactsNow(pv) { return pv && pv.bound ? factsDone.get(`${pv.key}@${S.version}`) || null : null; }

// ---------------------------------------------------------------- rasters
// Render a page (page content only: no annotations, no form widgets) at `scale` pixels per point.
export async function renderRaster(pdfPage, scale, rotation) {
  const vp = pdfPage.getViewport({ scale, rotation });
  const w = Math.max(1, Math.floor(vp.width)), h = Math.max(1, Math.floor(vp.height));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  await pdfPage.render({ canvasContext: ctx, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.DISABLE, intent: 'print' }).promise;
  return { canvas, ctx, w, h, vp, scale };
}

const MAX_PIXELS = 24e6;
// Pixels per point for reading text: about 300 dpi, more if the scan has it
export function ocrScale(pv, f) {
  let s = 300 / 72;
  if (f && f.imageScale > s) s = Math.min(f.imageScale, 450 / 72);
  const [x0, y0, x1, y1] = pv.pdfPage.view;
  const area = Math.abs((x1 - x0) * (y1 - y0));
  if (area * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / area);
  return s;
}
// Pixels per point for editing: the scan's own pixel grid, so patches line up exactly
export function editScale(pv, f) {
  let s = 300 / 72;
  if (f && f.imageScale > 0) {
    s = f.imageScale;
    if (s < 200 / 72) s *= Math.ceil((200 / 72) / s);
    if (s > 600 / 72) s = 600 / 72;
  }
  const [x0, y0, x1, y1] = pv.pdfPage.view;
  const area = Math.abs((x1 - x0) * (y1 - y0));
  if (area * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / area);
  return s;
}

function toGray(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  return g;
}

// ---------------------------------------------------------------- hOCR
function parseHocr(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const lines = [];
  const prop = (t, name) => { const m = new RegExp(`${name}\\s+([^;]+)`).exec(t || ''); return m ? m[1].trim().split(/\s+/).map(Number) : null; };
  for (const ln of doc.querySelectorAll('.ocr_line, .ocr_caption, .ocr_textfloat, .ocr_header')) {
    const t = ln.getAttribute('title');
    const bbox = prop(t, 'bbox');
    if (!bbox) continue;
    const base = prop(t, 'baseline') || [0, 0];
    const xs = prop(t, 'x_size');
    const xd = prop(t, 'x_descenders');
    const words = [];
    for (const w of ln.querySelectorAll('.ocrx_word')) {
      const wt = w.getAttribute('title');
      const wb = prop(wt, 'bbox');
      const conf = (prop(wt, 'x_wconf') || [0])[0];
      const text = (w.textContent || '').trim();
      if (!wb || !text) continue;
      // drop recognition noise from pictures and stains
      if (conf < 25 && !/[\p{L}\p{N}]{2}/u.test(text)) continue;
      if (conf < 10) continue;
      if (/^[|_\-—–=~.,:;'"`!/\\()\[\]{}]+$/.test(text)) continue; // arrows, rules and box edges read as punctuation
      if ([...text].length <= 3 && conf < 45 && !/^\d+$/.test(text)) continue; // stray marks read as letters
      if (/^[Iil1|]$/.test(text) && conf < 85) continue; // a lone stroke (an arrow, a box edge) read as a letter
      words.push({ text, bbox: wb, conf });
    }
    if (!words.length) continue;
    lines.push({ bbox, slope: base[0], offset: base[1], xSize: xs ? xs[0] : bbox[3] - bbox[1], xDesc: xd ? xd[0] : 0, words });
  }
  return lines;
}

// Words far apart on one "line" (labels in a diagram, table cells) become separate lines,
// so each can be edited on its own
function splitAtGaps(lines) {
  const out = [];
  for (const l of lines) {
    const ws = [...l.words].sort((a, b) => a.bbox[0] - b.bbox[0]);
    const hs = ws.map((w) => w.bbox[3] - w.bbox[1]).sort((a, b) => a - b);
    const hMed = hs[hs.length >> 1] || 10;
    const baseAt = (x) => l.bbox[3] + l.offset + l.slope * (x - l.bbox[0]);
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const x0 = Math.min(...cur.map((w) => w.bbox[0])), y0 = Math.min(...cur.map((w) => w.bbox[1]));
      const x1 = Math.max(...cur.map((w) => w.bbox[2])), y1 = Math.max(...cur.map((w) => w.bbox[3]));
      out.push({ ...l, bbox: [x0, y0, x1, y1], offset: baseAt(x0) - y1, words: cur });
      cur = [];
    };
    for (const w of ws) {
      const prev = cur[cur.length - 1];
      if (prev && w.bbox[0] - prev.bbox[2] > Math.max(hMed * 1.4, 8)) flush();
      cur.push(w);
    }
    flush();
  }
  return out;
}

// Add words found by the sparse pass that the layout pass missed
function mergeHocr(main, extra) {
  const boxes = main.flatMap((l) => l.words.map((w) => w.bbox));
  const overlaps = (b) => boxes.some((a) => {
    const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ix <= 0 || iy <= 0) return false;
    const inter = ix * iy, area = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
    return inter > 0.25 * area;
  });
  const out = [...main];
  for (const l of extra) {
    const words = l.words.filter((w) => !overlaps(w.bbox) && (w.conf >= 55 || /[\p{L}\p{N}]{3}/u.test(w.text)));
    if (!words.length) continue;
    out.push({ ...l, words });
  }
  return out;
}

// Convert recognised lines (raster pixels) into page-space lines for the text layer
function linesToPage(lines, vp) {
  const P = (x, y) => vp.convertToPdfPoint(x, y);
  const out = [];
  for (const l of lines) {
    const [bx0, , , by1] = l.bbox;
    const baseY = (x) => by1 + l.offset + l.slope * (x - bx0);
    const o = P(bx0, baseY(bx0));
    const e = P(bx0 + 100, baseY(bx0 + 100));
    const len = Math.hypot(e[0] - o[0], e[1] - o[1]) || 1;
    const dir = [(e[0] - o[0]) / len, (e[1] - o[1]) / len];
    const ptPerPx = len / Math.hypot(100, 100 * l.slope);
    // size from the words themselves (the line's own estimate can include boxes and rules)
    const hs = l.words.map((w) => w.bbox[3] - w.bbox[1]).sort((a, b) => a - b);
    const wordH = hs[hs.length >> 1];
    const size = Math.max(2, Math.min(l.xSize + l.xDesc * 0.6, wordH / 0.85) * ptPerPx);
    const along = (x) => { const p = P(x, baseY(x)); return (p[0] - o[0]) * dir[0] + (p[1] - o[1]) * dir[1]; };
    out.push({ origin: o, dir, size, words: l.words.map((w) => ({ text: w.text, s0: along(w.bbox[0]), s1: along(w.bbox[2]) })) });
  }
  return out;
}

// ---------------------------------------------------------------- the invisible text layer
const ff = (n) => { if (!isFinite(n)) return '0'; const s = (+n).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' ? '0' : s; };

function safeText(font, text) {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch (e) {
      const plain = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      let ok = true;
      try { font.encodeText(plain); } catch (e2) { ok = false; }
      out += ok && plain ? plain : '?';
    }
  }
  return out;
}

// Content-stream text for lines: [{ origin:[x,y], dir:[c,s], size, words:[{ text, s0, s1 }] }].
// One text run per line; each word starts and ends exactly where it is on the page (the
// difference is spread over its letters), so selections and later edits line up with the ink.
export function textLayerContent(font, fontName, lines) {
  let c = 'BT\n3 Tr\n';
  for (const ln of lines) {
    const words = ln.words.map((w) => ({ ...w, text: safeText(font, w.text) })).filter((w) => w.text && w.s1 > w.s0);
    if (!words.length) continue;
    const size = ln.size;
    const natural = words.reduce((a, w) => a + font.widthOfTextAtSize(w.text, size), 0);
    const target = words.reduce((a, w) => a + (w.s1 - w.s0), 0);
    const Th = Math.max(20, Math.min(500, natural > 0 ? (100 * target) / natural : 100));
    const k = Th / 100;
    const unit = (d) => (-d * 1000) / (size * k); // TJ number that moves the pen by d
    const spaceW = font.widthOfTextAtSize(' ', size) * k;
    const [c0, s0] = ln.dir;
    c += `/${fontName} ${ff(size)} Tf ${ff(Th)} Tz\n${ff(c0)} ${ff(s0)} ${ff(-s0)} ${ff(c0)} ${ff(ln.origin[0])} ${ff(ln.origin[1])} Tm\n`;
    // each word: character spacing (Tc) stretches it to its true width; text readers don't
    // mistake character spacing for gaps between words the way they do with TJ offsets
    let pos = 0;
    words.forEach((w, i) => {
      // the space between words is stretched to fill the gap exactly
      if (i) {
        const adj = Math.max(w.s0 - pos - spaceW, 0.16 * size - spaceW); // wide enough that readers see a space
        c += `${ff(adj / k)} Tc ${font.encodeText(' ').toString()} Tj\n`;
        pos += spaceW + adj;
      }
      const shift = i ? Math.max(0, w.s0 - pos) : w.s0 - pos; // never jump backwards: readers split words there
      const n = [...w.text].length;
      const nat = font.widthOfTextAtSize(w.text, size) * k;
      const tc = n > 1 ? Math.max(-0.12 * size, Math.min(0.07 * size, (w.s1 - w.s0 - nat) / (n - 1))) / k : 0;
      c += `${ff(tc)} Tc [${Math.abs(shift) > 1e-3 ? ` ${ff(unit(shift))}` : ''} ${font.encodeText(w.text).toString()} ] TJ\n`;
      pos += shift + nat + tc * k * n;
    });
    c += '0 Tc\n';
  }
  return `${c}ET\n`;
}

export async function addTextLayer(doc, pageIndex, lines, extra = '') {
  const PDFLib = L();
  const page = doc.getPage(pageIndex);
  const font = await doc.embedStandardFont(PDFLib.StandardFonts.Helvetica);
  const fname = page.node.newFontDictionary('FoOCR', font.ref).toString().replace(/^\//, '');
  const content = `q\n${extra}${lines.length ? textLayerContent(font, fname, lines) : ''}Q\n`;
  const ref = doc.context.register(doc.context.flateStream(new TextEncoder().encode(content)));
  appendContentStream(doc, page, ref);
}

// Add a content stream after the page's own, with the page's content wrapped in q/Q
// so our drawing starts from the default coordinate system. (Works whether
// /Contents is a stream, an array, or a reference to an array.)
export function appendContentStream(doc, page, ref) {
  const PDFLib = L();
  const ctx = doc.context;
  const key = PDFLib.PDFName.of('Contents');
  const raw = page.node.get(key);
  const cur = raw ? ctx.lookup(raw) : null;
  let arr;
  if (cur instanceof PDFLib.PDFArray) arr = cur;
  else { arr = ctx.obj([]); if (raw) arr.push(raw); page.node.set(key, arr); }
  // fresh q / Q streams (pdf-lib's cached ones may have been dropped by an edit in the same change)
  const tiny = (op) => ctx.register(ctx.stream(`${op}\n`));
  if (arr.size()) { arr.insert(0, tiny('q')); arr.push(tiny('Q')); }
  arr.push(ref);
}

// ---------------------------------------------------------------- reading pages
let running = false;
export function isReading() { return running; }
export function engineKind() { return engineInfo; }

export async function scanPagesNeedingOcr() {
  await whenBuilt();
  const out = [];
  for (const pv of S.pages) {
    await ensureBound(pv);
    const f = await pageFacts(pv);
    if (f.needsOcr) out.push(pv);
  }
  return out;
}

export async function readScannedPages({ pages = null, quiet = false } = {}) {
  if (running) return false;
  running = true;
  let cancelled = false;
  const done = busy('Looking for scanned pages…', { onCancel: () => { cancelled = true; } });
  try {
    await docSettled();
    let targets = pages || await scanPagesNeedingOcr();
    if (pages) { const keep = []; for (const pv of pages) { const f = await pageFacts(pv); if (!f.hasOcr) keep.push(pv); } targets = keep; }
    if (!targets.length) {
      done();
      if (!quiet) toast('There are no scanned pages to read. The text in this document can already be changed with Edit Text.', { ms: 6000 });
      return false;
    }
    const v0 = S.version;
    busyMessage('Getting the text reader ready (the first time takes a few seconds)…');
    const eng = await startEngine();
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      if (cancelled) break;
      const pv = targets[i];
      busyMessage(targets.length > 1 ? `Reading page ${pv.index + 1} (${i + 1} of ${targets.length})…` : 'Reading the page…');
      const f = await pageFacts(pv);
      const scale = ocrScale(pv, f);
      const r = await renderRaster(pv.pdfPage, scale, pv.rotate);
      const gray = toGray(r.ctx, r.w, r.h);
      // on pages that also have real text, only read the words that aren't already text
      const textBoxes = [];
      try {
        for (const g of analyze(pv.index).groups) {
          if (g.invisible || !g.text.trim()) continue;
          const pts = g.quad.map(([x, y]) => r.vp.convertToViewportPoint(x, y));
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          textBoxes.push([Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2]);
        }
      } catch (e) { /* ignore */ }
      r.canvas.width = r.canvas.height = 0;
      const fast = eng.info.kind === 'wasm';
      const res = await eng.call('recognize', { w: r.w, h: r.h, gray: gray.buffer, dpi: scale * 72, sparse: fast }, [gray.buffer]);
      const main = parseHocr(res.main);
      let found = mergeHocr(main, res.sparse ? parseHocr(res.sparse) : []);
      // small text (labels in figures, footnotes) is read better from a bigger picture
      const hs = found.flatMap((l) => l.words.map((w) => w.bbox[3] - w.bbox[1])).sort((a, b) => a - b);
      const small = !hs.length || hs[Math.floor(hs.length * 0.3)] < 26;
      if (fast && small && !cancelled) {
        const k2 = Math.min(2, Math.sqrt(MAX_PIXELS / (r.w * r.h)));
        if (k2 > 1.3) {
          busyMessage(targets.length > 1 ? `Reading small text on page ${pv.index + 1}…` : 'Reading small text…');
          const r2 = await renderRaster(pv.pdfPage, scale * k2, pv.rotate);
          const g2 = toGray(r2.ctx, r2.w, r2.h);
          r2.canvas.width = r2.canvas.height = 0;
          const res2 = await eng.call('recognize', { w: r2.w, h: r2.h, gray: g2.buffer, dpi: scale * k2 * 72, sparse: false }, [g2.buffer]);
          const kx = r.w / r2.w;
          const back = parseHocr(res2.main).map((l) => ({
            ...l, bbox: l.bbox.map((v) => v * kx), offset: l.offset * kx, xSize: l.xSize * kx, xDesc: l.xDesc * kx,
            words: l.words.map((w) => ({ ...w, bbox: w.bbox.map((v) => v * kx) })),
          }));
          found = mergeHocr(found, back);
        }
      }
      found = splitAtGaps(found);
      if (textBoxes.length) {
        const inText = (b) => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; return textBoxes.some((t) => cx >= t[0] && cx <= t[2] && cy >= t[1] && cy <= t[3]); };
        found = found.map((l) => ({ ...l, words: l.words.filter((w) => !inText(w.bbox)) })).filter((l) => l.words.length);
      }
      const lines = linesToPage(found, r.vp);
      results.push({ key: pv.key, lines });
    }
    if (cancelled && !results.length) return false;
    if (S.version !== v0) { toast('The document changed while reading, so please try again.'); return false; }
    let words = 0;
    for (const r of results) for (const l of r.lines) words += l.words.length;
    const res = await changeDoc(async (doc) => {
      const { pageIndexOf } = await import('./doc.js');
      for (const r of results) {
        if (!r.lines.length) continue;
        const idx = pageIndexOf(r.key);
        if (idx >= 0) await addTextLayer(doc, idx, r.lines);
      }
      return true;
    }, { message: 'Adding the text to the document…' });
    if (res === false) return false;
    const pagesN = results.filter((r) => r.lines.length).length;
    if (!words) toast('No readable text was found on the scanned pages.', { ms: 6000 });
    else toast(`Done. ${pagesN === 1 ? 'The page' : `${pagesN} pages`} can now be searched, copied and changed with Edit Text.${cancelled ? ' (Stopped early.)' : ''}`, { ms: 7000 });
    emit('ocr-done');
    return true;
  } catch (e) {
    console.error(e);
    toast(`The text could not be read: ${e.message || e}`, { ms: 7000 });
    return false;
  } finally {
    running = false;
    done();
  }
}

// A picture added with the Picture button lives on top of the page; put it into the page, then read it
export async function readPictureObject(o) {
  const { pageIndexOf } = await import('./doc.js');
  const { flattenImageObject } = await import('./export.js');
  const idx = pageIndexOf(o.page);
  if (idx < 0) return false;
  const ok = await changeDoc(async (doc) => {
    await flattenImageObject(doc, doc.getPage(idx), o);
    S.objects.delete(o.id);
    if (S.selection && S.selection.id === o.id) S.selection = null;
  }, { message: 'Placing the picture…' });
  if (ok === false) return false;
  emit('objects-changed'); emit('selection');
  await whenBuilt();
  const pv = S.pages[idx];
  if (!pv) return false;
  return readScannedPages({ pages: [pv] });
}

// ---------------------------------------------------------------- prompts on scanned pages
function banner(pv, f) {
  const b = el('div', { class: 'scanbanner', role: 'region', 'aria-label': 'Scanned page' },
    el('span', { class: 'ico', html: icon('scan') }),
    el('div', { class: 'txt' }, el('strong', {}, 'This page is a scan (a picture of a page).'), el('span', {}, ' To change its words, first let Pagewright read the text.')),
    el('button', { class: 'btn primary', onclick: () => readScannedPages() }, 'Read the text'));
  b.style.pointerEvents = 'all';
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}
function refreshBanner(pv) {
  if (!pv || !pv.uiLayer) return;
  const f = pageFactsNow(pv);
  const want = S.tool === 'edittext' && pv.bound && f && f.needsOcr;
  const cur = pv.uiLayer.querySelector('.scanbanner');
  if (want && !cur) pv.uiLayer.append(banner(pv, f));
  else if (!want && cur) cur.remove();
}
export function refreshBanners() {
  for (const pv of S.pages) {
    if (!pv.visible && !pv.uiLayer.querySelector('.scanbanner')) continue;
    if (pv.bound && !pageFactsNow(pv)) pageFacts(pv).then(() => { refreshBanner(pv); emit('scan-facts'); });
    else refreshBanner(pv);
  }
}

let offeredFor = null;
let pendingOffer = null;
async function offerAfterOpen() {
  const token = S.version;
  offeredFor = token;
  const first = S.pages.slice(0, 4).filter((pv) => pv.bound);
  let n = 0;
  for (const pv of first) { const f = await pageFacts(pv); if (f.needsOcr) n++; }
  if (!n || offeredFor !== token || S.version !== token) return;
  toast('This looks like a scanned document. Pagewright can read its text so you can search it and change the words.', { action: 'Read the text', onAction: () => readScannedPages(), ms: 12000 });
}

on('doc-opened', () => { pendingOffer = S.version; });
on('pages-built', () => { if (pendingOffer === S.version) { pendingOffer = null; offerAfterOpen(); } });
on('tool', () => refreshBanners());
on('page-visible', (pv) => { if (S.tool === 'edittext') refreshBanners(pv); });
on('pages-built', () => refreshBanners());
on('doc-changed', () => setTimeout(refreshBanners, 0));
on('page-layout', (pv) => refreshBanner(pv));
