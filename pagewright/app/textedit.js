// Editing existing PDF text in place, and glyph-accurate text selection
// (copy, highlight, underline, strikethrough).

import { S, emit, on, el, hexToRgb, rgbToHex } from './state.js';
import { analyze, changeDoc, loadFontBytes, E, docSettled } from './doc.js';
import { pageByKey, whenBuilt } from './viewer.js';
import { addObject } from './objects.js';
import { toast } from './ui.js';
import { icon } from './icons.js';
import { unicodeFace } from './fontfaces.js';
import { registerTextFonts } from './objects.js';
import { pageFacts, pageFactsNow } from './ocr.js';
import { startScanEdit, inkFrame } from './scanedit.js';

const inv = (M) => {
  const d = M[0] * M[3] - M[1] * M[2];
  if (Math.abs(d) < 1e-12) return null;
  return [M[3] / d, -M[1] / d, -M[2] / d, M[0] / d, (M[2] * M[5] - M[3] * M[4]) / d, (M[1] * M[4] - M[0] * M[5]) / d];
};
const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];

// ---------------------------------------------------------------- geometry helpers
// View-space frame of a text-space rectangle in a group: origin (top-left), unit vectors, size
function frame(pv, g, x0, x1) {
  const tl = pv.toView(...ap(g.M, x0, g.yHi));
  const tr = pv.toView(...ap(g.M, x1, g.yHi));
  const bl = pv.toView(...ap(g.M, x0, g.yLo));
  const w = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const h = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const angle = Math.atan2(tr[1] - tl[1], tr[0] - tl[0]);
  return { x: tl[0], y: tl[1], w, h, angle };
}
function place(node, f, pad = 0) {
  Object.assign(node.style, {
    left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px`,
    transform: `rotate(${f.angle}rad)${pad ? ` translate(${-pad}px, ${-pad}px)` : ''}`,
  });
  if (pad) { node.style.width = `${f.w + pad * 2}px`; node.style.height = `${f.h + pad * 2}px`; }
}

// Invisible text counts on scanned pages: it is the recognised text of the scan
function isScanPage(pv) {
  const f = pageFactsNow(pv);
  if (!f) { if (pv.bound) pageFacts(pv).then((x) => { if (x.coverage > 0.02 && x.hasOcr) { emit('scan-facts'); if (S.tool === 'edittext' && !editing && pv.visible) showLineBoxes(pv); } }); return false; }
  return f.coverage > 0.02;
}
function groupsOf(pv) {
  const a = analyze(pv.index);
  const scan = a.groups.some((g) => g.invisible) && isScanPage(pv);
  return a.groups.filter((g) => !g.invisible || scan);
}

// Reading order: by baseline (view y), then x
function ordered(pv) {
  const gs = groupsOf(pv);
  return gs.map((g) => ({ g, o: pv.toView(g.M[4], g.M[5]) })).sort((a, b) => (Math.abs(a.o[1] - b.o[1]) > 3 ? a.o[1] - b.o[1] : a.o[0] - b.o[0])).map((x) => x.g);
}

// Find the group and caret position nearest a client point
export function hitText(pv, cx, cy, { slack = 3 } = {}) {
  const [px, py] = pv.clientToPdf(cx, cy);
  let best = null;
  for (const g of groupsOf(pv)) {
    const I = inv(g.M);
    if (!I) continue;
    const [tx, ty] = ap(I, px, py);
    const sy = Math.hypot(g.M[2], g.M[3]) * pv.scale || 1;
    const pad = slack / sy;
    if (ty < g.yLo - pad || ty > g.yHi + pad || tx < g.x0 - pad * 2 || tx > g.x1 + pad * 2) continue;
    const dy = ty < g.yLo ? g.yLo - ty : ty > g.yHi ? ty - g.yHi : 0;
    const dx = tx < g.x0 ? g.x0 - tx : tx > g.x1 ? tx - g.x1 : 0;
    const d = dx + dy;
    if (!best || d < best.d) best = { g, tx, d };
  }
  if (!best) return null;
  const { g, tx } = best;
  let pos = g.units.length;
  for (let i = 0; i < g.units.length; i++) {
    const u = g.units[i];
    if (tx < u.x + u.adv / 2) { pos = i; break; }
  }
  return { g, pos };
}

// ---------------------------------------------------------------- glyph selection
let gsel = null; // { pv, a: {gi,pos}, b: {gi,pos}, order }
export function clearGlyphSelection() {
  gsel = null;
  document.querySelectorAll('.glyphsel, .minibar').forEach((n) => n.remove());
  emit('glyph-selection');
}
export function hasGlyphSelection() { return !!(gsel && selectedRanges().length); }

function selectedRanges() {
  if (!gsel) return [];
  const { order, a, b } = gsel;
  let s = a, e = b;
  if (s.gi > e.gi || (s.gi === e.gi && s.pos > e.pos)) [s, e] = [e, s];
  const out = [];
  for (let gi = s.gi; gi <= e.gi; gi++) {
    const g = order[gi];
    const from = gi === s.gi ? s.pos : 0;
    const to = gi === e.gi ? e.pos : g.units.length;
    if (to > from) out.push({ g, from, to });
  }
  return out;
}

export function selectedText() {
  const rs = selectedRanges();
  let s = '';
  let prev = null;
  for (const r of rs) {
    const t = r.g.units.slice(r.from, r.to).map((u) => u.uni ?? '').join('');
    if (prev) {
      const sameLine = Math.abs(prev.M[5] - r.g.M[5]) < 2 && Math.abs(prev.M[1] - r.g.M[1]) < 1e-3;
      s += sameLine ? ' ' : '\n';
    }
    s += t;
    prev = r.g;
  }
  return s;
}

function quadsFor(r) {
  const g = r.g;
  const x0 = g.units[r.from].x;
  const last = g.units[r.to - 1];
  const x1 = last.x + last.adv;
  const P = (x, y) => ap(g.M, x, y);
  const ul = P(x0, g.yHi), ur = P(x1, g.yHi), ll = P(x0, g.yLo), lr = P(x1, g.yLo);
  return [ul[0], ul[1], ur[0], ur[1], ll[0], ll[1], lr[0], lr[1]];
}

function drawGlyphSelection() {
  document.querySelectorAll('.glyphsel').forEach((n) => n.remove());
  if (!gsel) return;
  const pv = gsel.pv;
  for (const r of selectedRanges()) {
    const x0 = r.g.units[r.from].x, last = r.g.units[r.to - 1];
    const f = frame(pv, r.g, x0, last.x + last.adv);
    const d = el('div', { class: 'glyphsel' });
    place(d, f);
    pv.uiLayer.append(d);
  }
}

export function beginGlyphSelection(e, pv, mode) {
  const hit = hitText(pv, e.clientX, e.clientY);
  if (!hit) return false;
  clearGlyphSelection();
  const order = ordered(pv);
  const gi = order.indexOf(hit.g);
  gsel = { pv, order, a: { gi, pos: hit.pos }, b: { gi, pos: hit.pos } };
  const onMove = (ev) => {
    const h = hitText(pv, ev.clientX, ev.clientY, { slack: 12 });
    if (!h) return;
    gsel.b = { gi: order.indexOf(h.g), pos: h.pos };
    drawGlyphSelection();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!selectedRanges().length) { clearGlyphSelection(); return; }
    if (mode === 'select') showMinibar(pv);
    else { createMarkup(mode); clearGlyphSelection(); }
    emit('glyph-selection');
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  return true;
}

export function selectWordAt(e, pv) {
  const hit = hitText(pv, e.clientX, e.clientY);
  if (!hit) return false;
  const order = ordered(pv);
  const gi = order.indexOf(hit.g);
  const us = hit.g.units;
  const isW = (u) => u && u.uni && /[\p{L}\p{N}_'’-]/u.test(u.uni);
  let a = Math.min(hit.pos, us.length - 1), b = a;
  if (!isW(us[a]) && isW(us[a - 1])) { a--; b--; }
  while (a > 0 && isW(us[a - 1])) a--;
  while (b < us.length && isW(us[b])) b++;
  if (b === a) b = a + 1;
  clearGlyphSelection();
  gsel = { pv, order, a: { gi, pos: a }, b: { gi, pos: b } };
  drawGlyphSelection();
  showMinibar(pv);
  return true;
}

export function createMarkup(kind) {
  const rs = selectedRanges();
  if (!rs.length) return;
  const color = kind === 'highlight' ? S.opts.highlight : S.opts.markupColor;
  addObject({
    type: 'markup', kind, page: gsel.pv.key, quads: rs.map(quadsFor), color,
    opacity: kind === 'highlight' ? S.opts.hlOpacity : 1, text: selectedText(), author: S.author, date: new Date().toISOString(),
  });
}

export async function copySelection() {
  const t = selectedText();
  if (!t) return;
  try { await navigator.clipboard.writeText(t); toast('Copied'); }
  catch (e) {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0', top: '0' } }, t);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select the text and press Ctrl+C to copy'); }
    ta.remove();
  }
}

function showMinibar(pv) {
  document.querySelectorAll('.minibar').forEach((n) => n.remove());
  const rs = selectedRanges();
  if (!rs.length) return;
  const last = rs[rs.length - 1];
  const lu = last.g.units[last.to - 1];
  const [vx, vy] = pv.toView(...ap(last.g.M, lu.x + lu.adv, last.g.yLo));
  const bar = el('div', { class: 'minibar' },
    el('button', { class: 'btn', onclick: () => copySelection() }, el('span', { html: icon('copy') }), 'Copy'),
    el('button', { class: 'btn', onclick: () => { createMarkup('highlight'); clearGlyphSelection(); } }, el('span', { html: icon('highlight') }), 'Highlight'),
    el('button', { class: 'btn', title: 'Underline', onclick: () => { createMarkup('underline'); clearGlyphSelection(); } }, el('span', { html: icon('underline') })),
    el('button', { class: 'btn', title: 'Strikethrough', onclick: () => { createMarkup('strike'); clearGlyphSelection(); } }, el('span', { html: icon('strike') })),
  );
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  Object.assign(bar.style, { left: `${Math.max(0, Math.min(vx - 120, pv.vp.width - 260))}px`, top: `${vy + 8}px` });
  pv.uiLayer.append(bar);
  bar.style.pointerEvents = 'all';
}

// ---------------------------------------------------------------- edit-mode line boxes
export function showLineBoxes(pv) {
  hideLineBoxes(pv);
  if (!pv.vp) return;
  let gs;
  try { gs = groupsOf(pv); } catch (e) { gs = []; }
  for (const g of gs) {
    if (!g.text.trim()) continue;
    const f = (g.invisible && inkFrame(pv, g)) || frame(pv, g, g.x0, g.x1);
    if (f.w < 1 || f.h < 1) continue;
    const ok = g.invisible || g.fonts.every((fo) => fo.editable);
    const box = el('div', { class: `tline${ok ? '' : ' uneditable'}${g.invisible ? ' scanline' : ''}`, 'data-gid': g.id, role: 'button', tabindex: '0', 'aria-label': `Edit text: ${g.text}`, title: ok ? '' : `This line can't be edited: ${g.fonts.find((fo) => !fo.editable).reason || 'unsupported font'}` });
    place(box, f, 1);
    // keyboard: Tab to a line, Enter or Space to edit it
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation();
      const r = box.getBoundingClientRect();
      startEditingAt(pv, r.left + r.width - 2, r.top + r.height / 2, g.id);
    });
    pv.uiLayer.append(box);
  }
}
export function hideLineBoxes(pv) { pv.uiLayer.querySelectorAll('.tline').forEach((n) => n.remove()); }
export function refreshLineBoxes() {
  for (const pv of S.pages) { if (S.tool === 'edittext' && !editing && pv.visible && pv.bound) showLineBoxes(pv); else hideLineBoxes(pv); }
}

// ---------------------------------------------------------------- pdf.js font faces (for a faithful editor)
const faceCache = new WeakMap();
async function pdfjsFaces(pv) {
  let m = faceCache.get(pv.pdfPage);
  if (m) return m;
  m = [];
  try {
    const tc = await pv.pdfPage.getTextContent();
    const names = new Set(tc.items.map((i) => i.fontName).filter(Boolean));
    for (const n of names) {
      try { const f = pv.pdfPage.commonObjs.get(n); if (f) m.push(f); } catch (e) { /* not resolved */ }
    }
  } catch (e) { /* ignore */ }
  faceCache.set(pv.pdfPage, m);
  return m;
}
async function faithfulFamily(pv, g) {
  const faces = await pdfjsFaces(pv);
  const font = g.font;
  const cands = faces.filter((f) => f.data && f.toFontChar && !f.isType3Font && !f.missingFile
    && (f.name === font.baseFont || (f.name || '').replace(/^[A-Z]{6}\+/, '') === font.cleanName));
  // with several same-named subsets, prefer the face whose mapping covers this line's codes
  const units = g.units.filter((u) => u.kind === 'g' && u.run.font === font);
  cands.sort((a, b) => units.filter((u) => b.toFontChar[u.code]).length - units.filter((u) => a.toFontChar[u.code]).length);
  for (const f of cands) {
    const fam = await unicodeFace(f, font);
    if (fam) return fam;
  }
  return null;
}

// CSS family of the fallback font Pagewright will use for characters the PDF font lacks
const FALLBACK_CSS = { Carlito: 'Folio Calibri', Caladea: 'Folio Cambria', LiberationSans: 'Folio Sans', LiberationSerif: 'Folio Serif', LiberationMono: 'Folio Mono' };
function fallbackCss(font) {
  const fam = font.fallbackKey().split('-')[0];
  return FALLBACK_CSS[fam] ? `"${FALLBACK_CSS[fam]}", ` : '';
}

// ---------------------------------------------------------------- inline editor
let editing = null;
export function isEditingText() { return !!editing; }
export function currentEdit() { return editing; }

function sampleBackground(pv, f) {
  const c = pv.canvas;
  if (!c) return '#ffffff';
  try {
    const k = c.width / pv.vp.width;
    const cos = Math.cos(f.angle), sin = Math.sin(f.angle);
    const at = (u, v) => [f.x + u * cos - v * sin, f.y + u * sin + v * cos];
    const pts = [];
    for (let i = 0; i <= 10; i++) { const u = (f.w * i) / 10; pts.push(at(u, -3), at(u, f.h + 3)); }
    pts.push(at(-4, f.h / 2), at(f.w + 4, f.h / 2));
    const xs = pts.map((p) => p[0] * k), ys = pts.map((p) => p[1] * k);
    const X0 = Math.max(0, Math.floor(Math.min(...xs))), Y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const X1 = Math.min(c.width - 1, Math.ceil(Math.max(...xs))), Y1 = Math.min(c.height - 1, Math.ceil(Math.max(...ys)));
    if (X1 < X0 || Y1 < Y0) return '#ffffff';
    // copy the region into a small CPU-side canvas, then read it there
    const scratch = document.createElement('canvas');
    scratch.width = X1 - X0 + 1; scratch.height = Y1 - Y0 + 1;
    const sctx = scratch.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(c, X0, Y0, scratch.width, scratch.height, 0, 0, scratch.width, scratch.height);
    const img = sctx.getImageData(0, 0, scratch.width, scratch.height);
    const W = X1 - X0 + 1;
    const counts = new Map();
    for (const [x, y] of pts) {
      const px = Math.round(x * k) - X0, py = Math.round(y * k) - Y0;
      if (px < 0 || py < 0 || px >= W || py > Y1 - Y0) continue;
      const o = (py * W + px) * 4;
      const cc = [img.data[o], img.data[o + 1], img.data[o + 2]];
      const key = cc.map((v) => v >> 3).join(',');
      if (!counts.has(key)) counts.set(key, []);
      counts.get(key).push(cc);
    }
    if (!counts.size) return '#ffffff';
    const best = [...counts.values()].sort((a, b2) => b2.length - a.length)[0];
    const avg = [0, 1, 2].map((i) => Math.round(best.reduce((s2, c2) => s2 + c2[i], 0) / best.length));
    return `rgb(${avg.join(',')})`;
  } catch (e) { return '#ffffff'; }
}

// Start editing the line under a click, waiting for any edit still being written
export async function startEditingAt(pv, cx, cy, gid) {
  const v0 = S.version;
  if (editing) await commitEditing();
  await docSettled();
  await whenBuilt();
  let g = null;
  if (S.version === v0 && gid !== null) g = analyze(pv.index).groups.find((x) => String(x.id) === String(gid));
  if (!g) { const h = hitText(pv, cx, cy, { slack: 1 }); g = h && h.g; }
  if (g) await startEditing(pv, g, { clientX: cx });
}

export async function startEditing(pv, g, { clientX = null } = {}) {
  if (editing) await commitEditing();
  if (g.invisible) {
    hideLineBoxes(pv);
    const pending = { scan: true, pending: true, g };
    editing = pending;
    const sess = await startScanEdit(pv, g, {
      clientX,
      onEnd: () => { if (editing === sess) { editing = null; emit('textedit'); if (S.tool === 'edittext') refreshLineBoxes(); } },
    });
    if (editing !== pending) { if (sess) sess.cancel(); return; }
    editing = sess;
    if (!sess) { emit('textedit'); refreshLineBoxes(); return; }
    sess.onChange = () => emit('textedit');
    emit('textedit');
    return;
  }
  if (!g.fonts.every((fo) => fo.editable)) {
    toast(`This line can't be edited: ${g.fonts.find((fo) => !fo.editable).reason || 'unsupported font'}.`);
    return;
  }
  hideLineBoxes(pv);
  const f = frame(pv, g, g.x0, g.x1);
  const geo = E.groupGeometry(g);
  const px = Math.abs(g.size) * geo.sy * pv.scale;
  const stretch = (g.Th * geo.sx) / (geo.sy || 1);
  const mask = el('div', { class: 'tmask' });
  place(mask, f, 2);
  mask.style.background = sampleBackground(pv, f);
  const ed = el('div', { class: 'teditor', spellcheck: 'false', role: 'textbox', 'aria-label': 'Edit text line' });
  ed.contentEditable = 'plaintext-only';
  if (ed.contentEditable !== 'plaintext-only') ed.contentEditable = 'true';
  ed.textContent = g.text;
  registerTextFonts();
  const approx = fallbackCss(g.font) + g.font.cssFamily();
  Object.assign(ed.style, {
    left: `${f.x}px`, top: `${f.y}px`, minHeight: `${f.h}px`, lineHeight: `${f.h}px`, fontSize: `${px}px`,
    fontFamily: approx, fontWeight: g.font.bold ? '700' : '400', fontStyle: g.font.italic ? 'italic' : 'normal',
    color: rgbToHex(g.rgb), background: 'transparent',
    transform: `rotate(${f.angle}rad)${Math.abs(stretch - 1) > 0.01 ? ` scaleX(${stretch})` : ''}`,
  });
  const grip = el('div', { class: 'tgrip', title: 'Drag to move this line', html: icon('grip') });
  Object.assign(grip.style, { left: `${f.x}px`, top: `${f.y}px`, height: `${f.h}px`, transform: `rotate(${f.angle}rad)`, transformOrigin: `18px 0` });
  grip.style.pointerEvents = 'all';
  ed.style.pointerEvents = 'all';
  pv.uiLayer.append(mask, ed, grip);
  editing = { pv, g, ed, mask, grip, frame: f, dx: 0, dy: 0, size: null, rgb: null, plan: null, origText: g.text, version: S.version };
  ed.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(ed);
  range.collapse(false);
  sel.removeAllRanges(); sel.addRange(range);
  // try the PDF's own embedded face for a faithful preview
  faithfulFamily(pv, g).then((fam) => {
    if (fam && editing && editing.ed === ed) {
      ed.style.fontFamily = `"${fam}", ${approx}`;
      editing.faithful = true;
      emit('textedit');
    }
  });
  ed.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEditing(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  });
  ed.addEventListener('input', () => { updatePlan(); });
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, t.replace(/\r\n?/g, '\n'));
  });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const start = pv.clientToPdf(e.clientX, e.clientY);
    const base = [editing.dx, editing.dy];
    const [sx, sy] = [e.clientX, e.clientY];
    const onMove = (ev) => {
      const cur = pv.clientToPdf(ev.clientX, ev.clientY);
      editing.dx = base[0] + cur[0] - start[0];
      editing.dy = base[1] + cur[1] - start[1];
      const ox = ev.clientX - sx, oy = ev.clientY - sy;
      const t = (n, fr) => { n.style.left = `${fr.x + ox}px`; n.style.top = `${fr.y + oy}px`; };
      t(ed, f); t(grip, f);
      editing.frame = { ...f, x: f.x + ox, y: f.y + oy };
    };
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); ed.focus(); emit('textedit'); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
  updatePlan();
}

function editorText() {
  if (!editing) return '';
  return editing.ed.innerText.replace(/ /g, ' ').replace(/\n$/, '');
}

function updatePlan() {
  if (!editing) return;
  try { editing.plan = E.planEdit(editing.g, editorText() || ' '); } catch (e) { editing.plan = null; }
  emit('textedit');
}

export function setEditSize(size) {
  if (!editing || !(size > 0) || editing.scan) return;
  editing.size = size;
  const geo = E.groupGeometry(editing.g);
  editing.ed.style.fontSize = `${size * geo.sy * editing.pv.scale}px`;
  emit('textedit');
}
export function setEditColor(hex) {
  if (!editing) return;
  if (editing.scan) { if (editing.setColor) editing.setColor(hex); emit('textedit'); return; }
  editing.rgb = hexToRgb(hex);
  editing.ed.style.color = hex;
  emit('textedit');
}

function teardown() {
  if (!editing) return;
  if (editing.scan) { const e = editing; if (e.cancel) e.cancel(); else editing = null; return; }
  const { ed, mask, grip, pv } = editing;
  ed.remove(); mask.remove(); grip.remove();
  editing = null;
  emit('textedit');
  if (S.tool === 'edittext') refreshLineBoxes();
}

export function cancelEditing() { teardown(); }

export async function deleteEditingLine() {
  if (!editing) return;
  if (editing.scan) { if (editing.remove) await editing.remove(); return; }
  const { g, version } = editing;
  teardown();
  if (version !== S.version) { toast('The document changed while editing, so that edit was not applied.'); return; }
  await changeDoc((doc) => E.applyGroupEdit(doc, g, { remove: true }, loadFontBytes), { message: 'Removing text…' });
}

export async function commitEditing() {
  if (!editing) return;
  if (editing.scan) { if (editing.commit) await editing.commit(); else editing = null; return; }
  const { g, dx, dy, size, rgb, version } = editing;
  const text = editorText();
  if (version !== S.version) { teardown(); toast('The document changed while editing, so that edit was not applied.'); return; }
  const changed = text !== g.text || Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01 || (size && Math.abs(size - g.size) > 1e-3) || rgb;
  teardown();
  if (!changed) return;
  const change = text.trim() === '' && !text.includes('\n') ? { remove: true } : { text, dx, dy, size: size || undefined, rgb: rgb || undefined };
  let report = null;
  await changeDoc(async (doc) => { report = await E.applyGroupEdit(doc, g, change, loadFontBytes); }, { message: 'Applying edit…' });
  if (report && report.dropped && report.dropped.length) toast(`Couldn't draw ${[...new Set(report.dropped)].join(' ')} — no font on hand has these characters.`, { ms: 6000 });
}

// Commit when clicking elsewhere (but not in the inspector)
document.addEventListener('pointerdown', (e) => {
  if (!editing) return;
  if (e.target.closest('.teditor, .tgrip, .scanedit, .scanbanner, .inspector, .ctxbar, .modal-back, .toolbar, .topbar')) return;
  commitEditing();
}, true);

on('page-layout', (pv) => {
  if (editing && editing.pv === pv) commitEditing();
  if (gsel && gsel.pv === pv) clearGlyphSelection();
  if (S.tool === 'edittext' && !editing && pv.visible) showLineBoxes(pv);
});
on('page-visible', (pv) => { if (S.tool === 'edittext' && !editing && pv.bound && !pv.uiLayer.querySelector('.tline')) showLineBoxes(pv); });
on('doc-changed', () => { clearGlyphSelection(); });
on('scan-ready', (pv) => { if (S.tool === 'edittext' && !editing && pv && pv.visible && pv.bound) showLineBoxes(pv); });
