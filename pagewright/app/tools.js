// Tool definitions and pointer/keyboard handling on the page area.

import { pageFactsNow, readScannedPages } from './ocr.js';
import { S, emit, on, el, $, isTyping } from './state.js';
import { icon } from './icons.js';
import { pageAtClient, zoomStep, setZoom, fitScale, scrollToPage, ensureBound } from './viewer.js';
import { analyze, undo, redo, changeObjects, recordUndo } from './doc.js';
import {
  beginObjectPointer, select, selectedObject, addObject, deleteSelected, editTextObject, renderPageObjects,
  copySelected, pasteClipboard, nudgeSelected, registerTextFonts, arrowHead,
} from './objects.js';
import {
  beginGlyphSelection, clearGlyphSelection, hasGlyphSelection, copySelection, selectWordAt,
  refreshLineBoxes, startEditingAt, isEditingText, commitEditing, hitText,
} from './textedit.js';
import { toast } from './ui.js';
import { signatureDialog, readImageFile, registerImageAsset } from './signature.js';

// Toolbar buttons. Highlight and Shapes each cover several related tools;
// the options bar switches between them.
export const MARK_TOOLS = ['highlight', 'underline', 'strike'];
export const SHAPE_TOOLS = ['rect', 'ellipse', 'line', 'arrow'];
export const TOOLS = [
  { id: 'select', label: 'Select', ico: 'pointer', key: 'V', tip: 'Select and move things' },
  '|',
  { id: 'edittext', label: 'Edit Text', ico: 'editText', key: 'E', tip: 'Change words already in the PDF' },
  { id: 'text', label: 'Add Text', ico: 'addText', key: 'T', tip: 'Type new text anywhere' },
  { id: 'sign', label: 'Sign', ico: 'sign', key: 'S', tip: 'Add your signature' },
  '|',
  { id: 'highlight', label: 'Highlight', ico: 'highlight', key: 'M', group: MARK_TOOLS, tip: 'Highlight, underline or cross out words' },
  { id: 'draw', label: 'Draw', ico: 'draw', key: 'P', tip: 'Draw freehand' },
  { id: 'rect', label: 'Shapes', ico: 'shapes', key: 'R', group: SHAPE_TOOLS, tip: 'Boxes, circles, lines and arrows' },
  { id: 'whiteout', label: 'White-out', ico: 'whiteout', key: 'W', tip: 'Cover something with white' },
  '|',
  { id: 'note', label: 'Comment', ico: 'note', key: 'N', tip: 'Leave a sticky note' },
  { id: 'image', label: 'Picture', ico: 'image', key: 'I', tip: 'Add a picture' },
];
// keyboard-only tools
const KEY_TOOLS = { h: 'hand', u: 'underline', k: 'strike', o: 'ellipse', l: 'line', a: 'arrow' };

export function buildToolbar() {
  const bar = $('#toolbar');
  bar.textContent = '';
  for (const t of TOOLS) {
    if (t === '|') { bar.append(el('span', { class: 'tool-sep', 'aria-hidden': 'true' })); continue; }
    const b = el('button', { class: 'tool', 'data-tool': t.id, title: `${t.tip} (${t.key})`, 'aria-pressed': 'false' },
      el('span', { html: icon(t.ico) }), el('span', { class: 'lbl' }, t.label));
    b.addEventListener('click', () => {
      if (t.group) setTool(t.group.includes(S.tool) ? S.tool : (t.id === 'highlight' ? S.opts.markTool || 'highlight' : S.opts.shapeTool || 'rect'));
      else setTool(t.id);
    });
    bar.append(b);
  }
  markToolbar();
}

function markToolbar() {
  for (const b of document.querySelectorAll('.tool')) {
    const t = TOOLS.find((x) => x !== '|' && x.id === b.dataset.tool);
    const on = t && (t.group ? t.group.includes(S.tool) : t.id === S.tool);
    b.setAttribute('aria-pressed', String(!!on));
  }
}

export async function setTool(id) {
  if (isEditingText() && id !== 'edittext') await commitEditing();
  if (id === 'image') { await pickImage(); return; }
  if (id === 'sign') { await addSignature(); return; }
  S.tool = id;
  if (MARK_TOOLS.includes(id)) S.opts.markTool = id;
  if (SHAPE_TOOLS.includes(id)) S.opts.shapeTool = id;
  markToolbar();
  const v = $('#viewer');
  v.className = `viewer tool-${id}${id === 'hand' ? ' hand' : ''}${id !== 'select' ? ' no-obj-hit' : ''}${id === 'edittext' ? ' mode-edit' : ''}${['draw', 'rect', 'ellipse', 'line', 'arrow', 'whiteout', 'highlight', 'underline', 'strike'].includes(id) ? ' draw-tool' : ''}`;
  if (id !== 'select') clearGlyphSelection();
  if (id !== 'select' && id !== 'edittext') select(null);
  refreshLineBoxes();
  if (id === 'text') registerTextFonts();
  emit('tool', id);
}

// ---------------------------------------------------------------- placement helpers
function visibleCenter(pv) {
  const v = $('#viewer').getBoundingClientRect();
  const r = pv.el.getBoundingClientRect();
  const cx = Math.max(r.left, Math.min(r.right, (Math.max(v.left, r.left) + Math.min(v.right, r.right)) / 2));
  const cy = Math.max(r.top, Math.min(r.bottom, (Math.max(v.top, r.top) + Math.min(v.bottom, r.bottom)) / 2));
  return [cx, cy];
}

async function placeImage(asset, { sig = false } = {}) {
  const pv = S.pages[S.currentPage] || S.pages[0];
  if (!pv) return;
  await ensureBound(pv);
  const [cx, cy] = visibleCenter(pv);
  const pageW = Math.abs(pv.view[2] - pv.view[0]);
  const maxW = sig ? Math.min(180, pageW * 0.35) : pageW * 0.5;
  let w = asset.w * 0.75, h = asset.h * 0.75; // px -> pt at 96 dpi
  if (w > maxW) { h *= maxW / w; w = maxW; }
  if (sig && w < 120) { h *= 120 / w; w = 120; }
  const [vx, vy] = pv.clientToView(cx, cy);
  const a = pv.toPdf(vx - (w * pv.scale) / 2, vy - (h * pv.scale) / 2);
  const id = await registerImageAsset(asset.url, asset.mime || 'image/png', asset.w, asset.h);
  addObject({ type: 'image', page: pv.key, ax: a[0], ay: a[1], w, h, img: id, rot: pv.rotate, sig, keepRatio: true, opacity: 1 });
  setTool('select');
  toast(sig ? 'Signature added. Drag it into place.' : 'Image added. Drag it into place.');
}

export async function pickImage() {
  const input = $('#imageInput');
  input.value = '';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    try { await placeImage(await readImageFile(f)); } catch (e) { toast("That image couldn't be read. Use PNG or JPEG."); }
  };
  input.click();
}

export async function addSignature() {
  const sig = await signatureDialog();
  if (!sig) return;
  try { await placeImage({ ...sig, mime: 'image/png' }, { sig: true }); }
  catch (e) { console.error(e); toast(`The signature couldn't be placed: ${e.message || e}`, { ms: 6000 }); }
}

// ---------------------------------------------------------------- note popup
export function openNote(o, pv) {
  closeNote();
  const [x, y] = pv.toView(o.x, o.y);
  const ta = el('textarea', { id: 'noteText', 'aria-label': 'Comment text', placeholder: 'Write a comment…' }, o.text || '');
  let recorded = false;
  ta.addEventListener('focus', () => {});
  ta.addEventListener('input', () => {
    if (!recorded) { recordUndo(); recorded = true; }
    changeObjects(() => { o.text = ta.value; }, { record: false });
  });
  ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeNote(); });
  const pop = el('div', { class: 'notepop' },
    el('div', { class: 'meta' }, el('span', {}, `${o.author || S.author} · ${new Date(o.date || Date.now()).toLocaleDateString()}`),
      el('button', { class: 'btn', title: 'Close', onclick: closeNote, html: icon('close') })),
    ta,
    el('div', { class: 'btnrow', style: { justifyContent: 'space-between' } },
      el('button', { class: 'btn danger', onclick: () => { closeNote(); select(o.id); deleteSelected(); } }, 'Delete'),
      el('button', { class: 'btn outline', onclick: closeNote }, 'Done')));
  pop.addEventListener('pointerdown', (e) => e.stopPropagation());
  const left = Math.min(x + 16, pv.vp.width - 230);
  Object.assign(pop.style, { left: `${Math.max(4, left)}px`, top: `${Math.max(4, y - 10)}px`, pointerEvents: 'all' });
  pv.uiLayer.append(pop);
  setTimeout(() => ta.focus(), 20);
}
export function closeNote() { document.querySelectorAll('.notepop').forEach((n) => n.remove()); }

on('object-click', ({ id, pv }) => {
  const o = S.objects.get(id);
  if (o && o.type === 'note') openNote(o, pv);
});

// ---------------------------------------------------------------- drawing previews
const SVGNS = 'http://www.w3.org/2000/svg';
function previewSvg(pv) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', 'objsvg');
  s.setAttribute('width', pv.vp.width); s.setAttribute('height', pv.vp.height);
  pv.uiLayer.append(s);
  return s;
}

function dragShape(e, pv, tool) {
  const start = pv.clientToView(e.clientX, e.clientY);
  const s = previewSvg(pv);
  const node = document.createElementNS(SVGNS, tool === 'ellipse' ? 'ellipse' : tool === 'line' || tool === 'arrow' ? 'polyline' : 'rect');
  const o = S.opts;
  const isWhite = tool === 'whiteout';
  const stroke = isWhite ? 'none' : o.stroke || 'none';
  node.setAttribute('fill', isWhite ? '#ffffff' : o.fill || 'none');
  node.setAttribute('stroke', isWhite ? '#7aa2ff' : stroke);
  node.setAttribute('stroke-width', isWhite ? 1 : o.width * pv.scale);
  if (isWhite) node.setAttribute('stroke-dasharray', '4 3');
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.setAttribute('opacity', o.opacity);
  s.append(node);
  let cur = start;
  const upd = (shift) => {
    let [x2, y2] = cur;
    const [x1, y1] = start;
    if (shift && (tool === 'line' || tool === 'arrow')) {
      const a = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
      const d = Math.hypot(x2 - x1, y2 - y1); x2 = x1 + d * Math.cos(a); y2 = y1 + d * Math.sin(a); cur = [x2, y2];
    } else if (shift) {
      const d = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)); x2 = x1 + Math.sign(x2 - x1 || 1) * d; y2 = y1 + Math.sign(y2 - y1 || 1) * d; cur = [x2, y2];
    }
    if (tool === 'ellipse') {
      node.setAttribute('cx', (x1 + x2) / 2); node.setAttribute('cy', (y1 + y2) / 2);
      node.setAttribute('rx', Math.abs(x2 - x1) / 2); node.setAttribute('ry', Math.abs(y2 - y1) / 2);
    } else if (tool === 'line' || tool === 'arrow') {
      let pts = [[x1, y1], [x2, y2]];
      if (tool === 'arrow') { const h = arrowHead(x1, y1, x2, y2, o.width * pv.scale); pts = [[x1, y1], [x2, y2], h[0], h[1], h[2]]; }
      node.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    } else {
      node.setAttribute('x', Math.min(x1, x2)); node.setAttribute('y', Math.min(y1, y2));
      node.setAttribute('width', Math.abs(x2 - x1)); node.setAttribute('height', Math.abs(y2 - y1));
    }
  };
  const onMove = (ev) => { cur = pv.clientToView(ev.clientX, ev.clientY); upd(ev.shiftKey); };
  const onUp = (ev) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    s.remove();
    let [x1, y1] = start, [x2, y2] = cur;
    if (Math.hypot(x2 - x1, y2 - y1) < 4) { // a click: default size
      const d = (tool === 'line' || tool === 'arrow') ? 90 : 70;
      x2 = x1 + d * (tool === 'whiteout' ? 1.6 : 1); y2 = tool === 'line' || tool === 'arrow' ? y1 : y1 + (tool === 'whiteout' ? 22 : d * 0.7);
    }
    const p1 = pv.toPdf(x1, y1), p2 = pv.toPdf(x2, y2);
    if (tool === 'line' || tool === 'arrow') {
      addObject({ type: 'line', arrow: tool === 'arrow', page: pv.key, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: o.stroke || '#e5322d', width: o.width, opacity: o.opacity });
    } else if (tool === 'whiteout') {
      addObject({ type: 'rect', whiteout: true, flatten: true, page: pv.key, x0: Math.min(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), x1: Math.max(p1[0], p2[0]), y1: Math.max(p1[1], p2[1]), stroke: null, fill: '#ffffff', width: 0, opacity: 1 });
    } else {
      addObject({ type: tool, page: pv.key, x0: Math.min(p1[0], p2[0]), y0: Math.min(p1[1], p2[1]), x1: Math.max(p1[0], p2[0]), y1: Math.max(p1[1], p2[1]), stroke: o.stroke, fill: o.fill, width: o.width, opacity: o.opacity });
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  upd(false);
}

function drawInk(e, pv) {
  const s = previewSvg(pv);
  const path = document.createElementNS(SVGNS, 'path');
  const o = S.opts;
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', o.stroke || '#e5322d');
  path.setAttribute('stroke-width', o.width * pv.scale);
  path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('opacity', o.opacity);
  s.append(path);
  const vpts = [pv.clientToView(e.clientX, e.clientY)];
  const draw = () => { path.setAttribute('d', 'M' + vpts.map((p) => p.join(',')).join(' L')); };
  const onMove = (ev) => {
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (const c of evs) {
      const p = pv.clientToView(c.clientX, c.clientY);
      const l = vpts[vpts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= 1.2) vpts.push(p);
    }
    draw();
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    s.remove();
    const simplified = simplify(vpts, 0.6);
    const pts = simplified.flatMap(([x, y]) => pv.toPdf(x, y));
    if (pts.length === 2) pts.push(pts[0] + 0.5, pts[1]);
    // continue the previous stroke group if drawn moments ago
    const prev = selectedObject();
    if (prev && prev.type === 'ink' && prev.page === pv.key && prev._t && Date.now() - prev._t < 1500 && prev.stroke === (o.stroke || '#e5322d') && prev.width === o.width) {
      changeObjects(() => { prev.paths.push(pts); prev._t = Date.now(); });
    } else {
      addObject({ type: 'ink', page: pv.key, paths: [pts], stroke: o.stroke || '#e5322d', width: o.width, opacity: o.opacity, _t: Date.now() });
    }
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  draw();
}

// Ramer–Douglas–Peucker
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = d2(pts[i], pts[a], pts[b]); if (d > md) { md = d; mi = i; } }
    if (mi >= 0 && md > eps * eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function areaHighlight(e, pv) {
  const start = pv.clientToView(e.clientX, e.clientY);
  const s = previewSvg(pv);
  const r = document.createElementNS(SVGNS, 'rect');
  r.setAttribute('fill', S.opts.highlight); r.setAttribute('opacity', S.opts.hlOpacity);
  s.append(r);
  let cur = start;
  const onMove = (ev) => {
    cur = pv.clientToView(ev.clientX, ev.clientY);
    r.setAttribute('x', Math.min(start[0], cur[0])); r.setAttribute('y', Math.min(start[1], cur[1]));
    r.setAttribute('width', Math.abs(cur[0] - start[0])); r.setAttribute('height', Math.abs(cur[1] - start[1]));
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    s.remove();
    if (Math.abs(cur[0] - start[0]) < 4 || Math.abs(cur[1] - start[1]) < 4) return;
    const L = Math.min(start[0], cur[0]), R = Math.max(start[0], cur[0]), T = Math.min(start[1], cur[1]), B = Math.max(start[1], cur[1]);
    const ul = pv.toPdf(L, T), ur = pv.toPdf(R, T), ll = pv.toPdf(L, B), lr = pv.toPdf(R, B);
    addObject({ type: 'markup', kind: 'highlight', page: pv.key, quads: [[...ul, ...ur, ...ll, ...lr]], color: S.opts.highlight, opacity: S.opts.hlOpacity, text: '', author: S.author, date: new Date().toISOString() });
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------------------------------------------------------------- pointer routing
let spaceDown = false;
function pan(e) {
  const v = $('#viewer');
  v.classList.add('grabbing');
  const sx = e.clientX, sy = e.clientY, sl = v.scrollLeft, st = v.scrollTop;
  const onMove = (ev) => { v.scrollLeft = sl - (ev.clientX - sx); v.scrollTop = st - (ev.clientY - sy); };
  const onUp = () => { v.classList.remove('grabbing'); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

let noTextHintShown = false;
export function installPointer() {
  const pages = $('#pages');
  const viewer = $('#viewer');
  viewer.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || (e.button === 0 && (S.tool === 'hand' || spaceDown))) { e.preventDefault(); pan(e); return; }
    if (e.button !== 0) return;
    if (e.target.closest('.formfield, .notepop, .minibar, .teditor, .tgrip')) return;
    // we preventDefault below, which stops the browser moving focus; do it ourselves
    const ae = document.activeElement;
    if (ae && ae !== document.body && pages.contains(ae) && !ae.contains(e.target)) ae.blur();
    const pv0 = pageAtClient(e.clientX, e.clientY);
    const pv = pv0 && pv0.bound && pv0.vp ? pv0 : null;
    if (!pv) { if (S.tool === 'select') { select(null); clearGlyphSelection(); } closeNote(); return; }
    closeNote();
    const tool = S.tool;
    if (tool === 'select') {
      if (beginObjectPointer(e, pv)) { clearGlyphSelection(); return; }
      select(null);
      if (e.pointerType === 'touch') { clearGlyphSelection(); return; } // let the finger scroll
      e.preventDefault();
      if (!beginGlyphSelection(e, pv, 'select')) clearGlyphSelection();
      return;
    }
    e.preventDefault();
    if (tool === 'edittext') {
      const box = e.target.closest('.tline');
      if (box || hitText(pv, e.clientX, e.clientY, { slack: 1 })) { startEditingAt(pv, e.clientX, e.clientY, box ? box.dataset.gid : null); return; }
      if (!isEditingText()) {
        const f = pageFactsNow(pv);
        if (f && f.canRead) { toast('Those words are part of a picture. Pagewright can read them so you can change them.', { action: 'Read the text', onAction: () => readScannedPages({ pages: [pv] }), ms: 9000 }); return; }
        if (!noTextHintShown && !analyze(pv.index).groups.length) { noTextHintShown = true; toast('This page has no editable text. Use White-out and Add Text instead.', { ms: 6000 }); }
      }
      return;
    }
    if (tool === 'text') {
      const o = S.opts;
      const [vx, vy] = pv.clientToView(e.clientX, e.clientY);
      const a = pv.toPdf(vx, vy - o.fontSize * pv.scale * 0.6);
      const obj = addObject({ type: 'text', page: pv.key, ax: a[0], ay: a[1], text: '', font: o.font, size: o.fontSize, color: o.color, bold: o.bold, italic: o.italic, rot: pv.rotate, opacity: 1, _new: true });
      setTool('select');
      editTextObject(obj.id);
      return;
    }
    if (tool === 'highlight' || tool === 'underline' || tool === 'strike') {
      if (!beginGlyphSelection(e, pv, tool) && tool === 'highlight') areaHighlight(e, pv);
      return;
    }
    if (tool === 'draw') { drawInk(e, pv); return; }
    if (['rect', 'ellipse', 'line', 'arrow', 'whiteout'].includes(tool)) { dragShape(e, pv, tool); return; }
    if (tool === 'note') {
      const p = pv.clientToPdf(e.clientX, e.clientY);
      const obj = addObject({ type: 'note', page: pv.key, x: p[0], y: p[1], text: '', color: S.opts.noteColor, author: S.author, date: new Date().toISOString() });
      setTool('select');
      requestAnimationFrame(() => openNote(obj, pv));
    }
  });
  viewer.addEventListener('dblclick', (e) => {
    const pv = pageAtClient(e.clientX, e.clientY);
    if (!pv || !pv.bound || S.tool !== 'select') return;
    const n = e.target.closest('.textobj');
    if (n) { editTextObject(n.dataset.id, { selectAll: false }); return; }
    if (!e.target.closest('[data-id]')) selectWordAt(e, pv);
  });
  // two-finger pinch zoom on touch screens
  const touches = new Map();
  let pinch = null;
  viewer.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: S.zoom };
    }
  }, true);
  viewer.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      setZoom(pinch.z * d / pinch.d, { anchor: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    }
  }, true);
  const endTouch = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  viewer.addEventListener('pointerup', endTouch, true);
  viewer.addEventListener('pointercancel', endTouch, true);
  viewer.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      setZoom(S.zoom * k, { anchor: [e.clientX, e.clientY] });
    }
  }, { passive: false });
}

// ---------------------------------------------------------------- keyboard
export function installKeys(actions) {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === ' ' && !isTyping(e)) { spaceDown = true; if (!mod) e.preventDefault(); }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); actions.save(); return; }
      if (k === 'o') { e.preventDefault(); actions.open(); return; }
      if (k === 'f') { e.preventDefault(); actions.find(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); zoomStep(1); return; }
      if (k === '-') { e.preventDefault(); zoomStep(-1); return; }
      if (k === '0') { e.preventDefault(); setZoom(fitScale('width'), { mode: 'width' }); return; }
      if (isTyping(e)) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 'c') { if (hasGlyphSelection()) { e.preventDefault(); copySelection(); } else if (copySelected()) { e.preventDefault(); toast('Copied object'); } return; }
      if (k === 'v') { const pv = S.pages[S.currentPage]; if (pasteClipboard(pv && pv.key)) e.preventDefault(); return; }
      if (k === 'd') { e.preventDefault(); if (copySelected()) pasteClipboard(); return; }
      return;
    }
    if (isTyping(e)) return;
    if (e.key === 'Escape') {
      closeNote();
      if (selectedObject()) select(null);
      else if (hasGlyphSelection()) clearGlyphSelection();
      else if (S.tool !== 'select') setTool('select');
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedObject()) { e.preventDefault(); deleteSelected(); return; }
    if (e.key.startsWith('Arrow') && selectedObject()) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const pv = S.pages.find((p) => p.key === selectedObject().page);
      // arrow keys move in view direction
      const [x0, y0] = pv.toPdf(0, 0);
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      const [x1, y1] = pv.toPdf(dir[0] * pv.scale, dir[1] * pv.scale);
      nudgeSelected((x1 - x0) * d, (y1 - y0) * d);
      return;
    }
    if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !selectedObject())) { if (e.key === 'PageDown') { e.preventDefault(); scrollToPage(Math.min(S.pages.length - 1, S.currentPage + 1)); } return; }
    if (e.key === 'PageUp') { e.preventDefault(); scrollToPage(Math.max(0, S.currentPage - 1)); return; }
    if (e.altKey) return;
    const k = e.key.toLowerCase();
    const t = TOOLS.find((x) => x !== '|' && x.key.toLowerCase() === k);
    if (t) { e.preventDefault(); setTool(t.id); return; }
    if (KEY_TOOLS[k]) { e.preventDefault(); setTool(KEY_TOOLS[k]); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
}
