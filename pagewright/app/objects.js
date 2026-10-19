// Overlay objects: rendering in view space, selection, move/resize.
// Geometry is always stored in PDF user space of the page, so objects stay
// attached to the page through zoom and rotation.

import { S, emit, on, el, uid } from './state.js';
import { pageByKey } from './viewer.js';
import { changeObjects, recordUndo } from './doc.js';
import { icon } from './icons.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };

// ---------------------------------------------------------------- fonts for added text
export const TEXT_FONTS = {
  sans: { label: 'Sans (Arial / Helvetica)', css: 'Folio Sans', file: 'LiberationSans' },
  serif: { label: 'Serif (Times)', css: 'Folio Serif', file: 'LiberationSerif' },
  mono: { label: 'Mono (Courier)', css: 'Folio Mono', file: 'LiberationMono' },
  calibri: { label: 'Calibri-compatible', css: 'Folio Calibri', file: 'Carlito' },
  cambria: { label: 'Cambria-compatible', css: 'Folio Cambria', file: 'Caladea' },
};
export function fontKeyFor(o) {
  const f = TEXT_FONTS[o.font] || TEXT_FONTS.sans;
  const style = o.bold && o.italic ? 'BoldItalic' : o.bold ? 'Bold' : o.italic ? 'Italic' : 'Regular';
  return `${f.file}-${style}`;
}
let fontsRegistered = false;
export function registerTextFonts() {
  if (fontsRegistered || !window.FontFace) return;
  fontsRegistered = true;
  for (const f of Object.values(TEXT_FONTS)) {
    for (const [style, weight, slant] of [['Regular', '400', 'normal'], ['Bold', '700', 'normal'], ['Italic', '400', 'italic'], ['BoldItalic', '700', 'italic']]) {
      try {
        const url = new URL(`../fonts/${f.file}-${style}.ttf`, import.meta.url).href;
        document.fonts.add(new FontFace(f.css, `url(${url})`, { weight, style: slant }));
      } catch (e) { /* ignore */ }
    }
  }
}
export function cssFont(o) {
  const f = TEXT_FONTS[o.font] || TEXT_FONTS.sans;
  const fb = o.font === 'serif' || o.font === 'cambria' ? 'serif' : o.font === 'mono' ? 'monospace' : 'sans-serif';
  return `"${f.css}", ${fb}`;
}

// ---------------------------------------------------------------- geometry
export function pointsOf(o) {
  switch (o.type) {
    case 'rect': case 'ellipse': return [[o.x0, o.y0], [o.x1, o.y1]];
    case 'line': return [[o.x1, o.y1], [o.x2, o.y2]];
    case 'ink': return o.paths.flatMap((p) => { const out = []; for (let i = 0; i < p.length; i += 2) out.push([p[i], p[i + 1]]); return out; });
    case 'markup': return o.quads.flatMap((q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]);
    case 'note': return [[o.x, o.y]];
    default: return [[o.ax, o.ay]];
  }
}
function setPoints(o, pts) {
  switch (o.type) {
    case 'rect': case 'ellipse':
      o.x0 = Math.min(pts[0][0], pts[1][0]); o.x1 = Math.max(pts[0][0], pts[1][0]);
      o.y0 = Math.min(pts[0][1], pts[1][1]); o.y1 = Math.max(pts[0][1], pts[1][1]);
      break;
    case 'line': [[o.x1, o.y1], [o.x2, o.y2]] = pts; break;
    case 'ink': { let k = 0; o.paths = o.paths.map((p) => { const np = []; for (let i = 0; i < p.length; i += 2) { np.push(pts[k][0], pts[k][1]); k++; } return np; }); break; }
    case 'markup': { let k = 0; o.quads = o.quads.map(() => { const q = []; for (let i = 0; i < 4; i++) { q.push(pts[k][0], pts[k][1]); k++; } return q; }); break; }
    case 'note': [[o.x, o.y]] = pts; break;
    default: [[o.ax, o.ay]] = pts;
  }
}
export function moveObject(o, dx, dy) { setPoints(o, pointsOf(o).map(([x, y]) => [x + dx, y + dy])); }

// view-space bounding box of an object
export function viewBox(o, pv) {
  if (o.type === 'text' || o.type === 'image') {
    const node = pv.objLayer.querySelector(`[data-id="${o.id}"]`);
    const [x, y] = pv.toView(o.ax, o.ay);
    const rotd = (((pv.rotate - (o.rot || 0)) % 360) + 360) % 360;
    let w, h;
    if (o.type === 'image') { w = o.w * pv.scale; h = o.h * pv.scale; }
    else { w = node ? node.offsetWidth : 20; h = node ? node.offsetHeight : 20; }
    const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([cx, cy]) => {
      const a = rotd * Math.PI / 180;
      return [x + cx * Math.cos(a) - cy * Math.sin(a), y + cx * Math.sin(a) + cy * Math.cos(a)];
    });
    return bboxOf(corners);
  }
  if (o.type === 'note') { const [x, y] = pv.toView(o.x, o.y); return { x: x - 12, y: y - 12, w: 24, h: 24 }; }
  const pts = pointsOf(o).map(([x, y]) => pv.toView(x, y));
  const b = bboxOf(pts);
  const pad = o.type === 'ink' || o.type === 'line' ? (o.width || 1) * pv.scale / 2 : 0;
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}
function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- rendering
function rgba(hex, a = 1) {
  if (!hex) return 'none';
  const v = hex.replace('#', '');
  return `rgba(${parseInt(v.slice(0, 2), 16)},${parseInt(v.slice(2, 4), 16)},${parseInt(v.slice(4, 6), 16)},${a})`;
}

function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return `M${pts[0][0]},${pts[0][1]} ` + pts.slice(1).map((p) => `L${p[0]},${p[1]}`).join(' ') + (pts.length === 1 ? ` L${pts[0][0] + 0.01},${pts[0][1]}` : '');
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]},${l[1]}`;
}

export function arrowHead(x1, y1, x2, y2, w) {
  const len = Math.max(6, w * 4.5);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 0.45;
  return [[x2 - len * Math.cos(a - s), y2 - len * Math.sin(a - s)], [x2, y2], [x2 - len * Math.cos(a + s), y2 - len * Math.sin(a + s)]];
}

function shapeNode(o, pv) {
  const g = svg('g', { 'data-id': o.id });
  const sw = Math.max(0.5, (o.width || 1) * pv.scale);
  const op = o.opacity ?? 1;
  const hitW = Math.max(12, sw + 8);
  const add = (node, hit) => { g.append(node); if (hit) g.append(hit); };
  if (o.type === 'rect' || o.type === 'ellipse') {
    const p = [[o.x0, o.y0], [o.x1, o.y0], [o.x1, o.y1], [o.x0, o.y1]].map(([x, y]) => pv.toView(x, y));
    const b = bboxOf(p);
    const attrs = { fill: o.fill ? rgba(o.fill, op) : 'none', stroke: o.stroke ? rgba(o.stroke, op) : 'none', 'stroke-width': o.stroke ? sw : 0 };
    let shape, hit;
    if (o.type === 'rect') {
      const pts = p.map((q) => q.join(',')).join(' ');
      shape = svg('polygon', { points: pts, ...attrs, 'stroke-linejoin': 'miter' });
      hit = svg('polygon', { points: pts, fill: o.fill ? 'transparent' : 'none', stroke: 'transparent', 'stroke-width': hitW, class: o.fill ? 'hitfill' : 'hit' });
    } else {
      const e = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 };
      shape = svg('ellipse', { ...e, ...attrs });
      hit = svg('ellipse', { ...e, fill: o.fill ? 'transparent' : 'none', stroke: 'transparent', 'stroke-width': hitW, class: o.fill ? 'hitfill' : 'hit' });
    }
    add(shape, hit);
  } else if (o.type === 'line') {
    const [x1, y1] = pv.toView(o.x1, o.y1), [x2, y2] = pv.toView(o.x2, o.y2);
    add(svg('line', { x1, y1, x2, y2, stroke: rgba(o.stroke, op), 'stroke-width': sw, 'stroke-linecap': 'round' }),
      svg('line', { x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': hitW, class: 'hit' }));
    if (o.arrow) {
      const h = arrowHead(x1, y1, x2, y2, sw);
      g.append(svg('polyline', { points: h.map((q) => q.join(',')).join(' '), fill: 'none', stroke: rgba(o.stroke, op), 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    }
  } else if (o.type === 'ink') {
    const d = o.paths.map((p) => { const pts = []; for (let i = 0; i < p.length; i += 2) pts.push(pv.toView(p[i], p[i + 1])); return smoothPath(pts); }).join(' ');
    add(svg('path', { d, fill: 'none', stroke: rgba(o.stroke, op), 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      svg('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': hitW, class: 'hit', 'stroke-linecap': 'round' }));
  } else if (o.type === 'markup') {
    for (const q of o.quads) {
      const ul = pv.toView(q[0], q[1]), ur = pv.toView(q[2], q[3]), ll = pv.toView(q[4], q[5]), lr = pv.toView(q[6], q[7]);
      const poly = [ul, ur, lr, ll].map((p) => p.join(',')).join(' ');
      if (o.kind === 'highlight') {
        const node = svg('polygon', { points: poly, fill: rgba(o.color, o.opacity ?? 0.45) });
        node.style.mixBlendMode = 'multiply';
        g.append(node);
      } else {
        const t = o.kind === 'underline' ? 0.93 : 0.52;
        const a = [ul[0] + (ll[0] - ul[0]) * t, ul[1] + (ll[1] - ul[1]) * t], b = [ur[0] + (lr[0] - ur[0]) * t, ur[1] + (lr[1] - ur[1]) * t];
        const h = Math.hypot(ll[0] - ul[0], ll[1] - ul[1]);
        g.append(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: rgba(o.color, o.opacity ?? 1), 'stroke-width': Math.max(1, h * 0.07) }));
      }
      g.append(svg('polygon', { points: poly, fill: 'transparent', class: 'hitfill' }));
    }
  }
  return g;
}

function htmlNode(o, pv) {
  const rotd = (((pv.rotate - (o.rot || 0)) % 360) + 360) % 360;
  if (o.type === 'text') {
    const [x, y] = pv.toView(o.ax, o.ay);
    const n = el('div', { class: 'obj textobj', 'data-id': o.id, spellcheck: 'false' });
    Object.assign(n.style, {
      left: `${x}px`, top: `${y}px`, fontFamily: cssFont(o), fontSize: `${o.size * pv.scale}px`,
      color: o.color, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal',
      whiteSpace: 'pre', opacity: o.opacity ?? 1, transform: rotd ? `rotate(${rotd}deg)` : '',
    });
    n.textContent = o.text || '';
    if (!o.text) n.style.minWidth = '1ch';
    return n;
  }
  if (o.type === 'image') {
    const [x, y] = pv.toView(o.ax, o.ay);
    const img = S.images.get(o.img);
    const n = el('div', { class: 'obj imgobj', 'data-id': o.id }, el('img', { src: img ? img.url : '', alt: o.sig ? 'Signature' : 'Image', draggable: 'false' }));
    Object.assign(n.style, { left: `${x}px`, top: `${y}px`, width: `${o.w * pv.scale}px`, height: `${o.h * pv.scale}px`, opacity: o.opacity ?? 1, transform: rotd ? `rotate(${rotd}deg)` : '' });
    return n;
  }
  if (o.type === 'note') {
    const [x, y] = pv.toView(o.x, o.y);
    const n = el('div', { class: 'obj noteobj', 'data-id': o.id, title: o.text || 'Comment', html: icon('note') });
    Object.assign(n.style, { left: `${x}px`, top: `${y}px`, background: o.color, color: '#1b1f26' });
    return n;
  }
  return null;
}

export function renderPageObjects(pv) {
  if (!pv || !pv.vp) return;
  const layer = pv.objLayer;
  const editing = layer.querySelector('.textobj.editing');
  const keep = editing ? editing.dataset.id : null;
  // remove everything except an element being edited
  for (const c of [...layer.children]) if (!(keep && c.dataset.id === keep)) c.remove();
  if (keep && S.objects.has(keep)) {
    const o = S.objects.get(keep);
    Object.assign(editing.style, { fontFamily: cssFont(o), fontSize: `${o.size * pv.scale}px`, color: o.color, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal' });
  }
  const s = svg('svg', { class: 'objsvg', width: pv.vp.width, height: pv.vp.height });
  layer.prepend(s);
  for (const o of S.objects.values()) {
    if (o.page !== pv.key) continue;
    if (o.type === 'text' || o.type === 'image' || o.type === 'note') {
      if (o.id === keep) continue;
      const n = htmlNode(o, pv);
      if (n) layer.append(n);
    } else s.append(shapeNode(o, pv));
  }
  renderSelection();
}

export function renderAllObjects() { for (const pv of S.pages) renderPageObjects(pv); }

// ---------------------------------------------------------------- selection
export function select(id) {
  S.selection = id ? { type: 'object', id } : null;
  renderSelection();
  emit('selection');
}

export function selectedObject() {
  return S.selection && S.selection.type === 'object' ? S.objects.get(S.selection.id) : null;
}

const RESIZABLE = new Set(['rect', 'ellipse', 'image', 'ink', 'text']);
export function renderSelection() {
  for (const pv of S.pages) pv.uiLayer.querySelectorAll('.selbox, .handle').forEach((n) => n.remove());
  const o = selectedObject();
  if (!o) return;
  const pv = pageByKey(o.page);
  if (!pv || !pv.vp) return;
  const b = viewBox(o, pv);
  const pad = 3;
  const box = el('div', { class: 'selbox' });
  Object.assign(box.style, { left: `${b.x - pad}px`, top: `${b.y - pad}px`, width: `${b.w + pad * 2}px`, height: `${b.h + pad * 2}px` });
  pv.uiLayer.append(box);
  const rotd = (((pv.rotate - (o.rot || 0)) % 360) + 360) % 360;
  if (o.type === 'line') {
    for (const [i, [x, y]] of [[0, pv.toView(o.x1, o.y1)], [1, pv.toView(o.x2, o.y2)]]) {
      const h = el('div', { class: 'handle round', 'data-h': `p${i}` });
      Object.assign(h.style, { left: `${x}px`, top: `${y}px`, cursor: 'crosshair' });
      pv.uiLayer.append(h);
    }
  } else if (RESIZABLE.has(o.type) && !(rotd && (o.type === 'text' || o.type === 'image'))) {
    const L = b.x - pad, T = b.y - pad, R = b.x + b.w + pad, B = b.y + b.h + pad;
    const hs = o.type === 'text' || (o.type === 'image' && o.keepRatio !== false)
      ? [['nw', L, T], ['ne', R, T], ['se', R, B], ['sw', L, B]]
      : [['nw', L, T], ['n', (L + R) / 2, T], ['ne', R, T], ['e', R, (T + B) / 2], ['se', R, B], ['s', (L + R) / 2, B], ['sw', L, B], ['w', L, (T + B) / 2]];
    const cur = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
    for (const [k, x, y] of hs) {
      const h = el('div', { class: 'handle', 'data-h': k });
      Object.assign(h.style, { left: `${x}px`, top: `${y}px`, cursor: cur[k] });
      pv.uiLayer.append(h);
    }
  }
}

// ---------------------------------------------------------------- interactions (select tool)
export function objectIdFromEvent(e) {
  const n = e.target.closest && e.target.closest('[data-id]');
  if (!n) return null;
  if (!n.closest('.objs')) return null;
  return n.dataset.id;
}

// Begin dragging (move) an object or a handle. Returns true if handled.
export function beginObjectPointer(e, pv) {
  const handle = e.target.closest && e.target.closest('.handle');
  const o = selectedObject();
  if (handle && o) { startResize(e, pv, o, handle.dataset.h); return true; }
  const id = objectIdFromEvent(e);
  if (!id) return false;
  const obj = S.objects.get(id);
  if (!obj) return false;
  if (e.target.closest('.textobj.editing')) return true; // let the caret work
  select(id);
  startMove(e, pv, obj);
  return true;
}

function startMove(e, pv, o) {
  const start = pv.clientToPdf(e.clientX, e.clientY);
  const orig = JSON.parse(JSON.stringify(o));
  let moved = false;
  const onMove = (ev) => {
    const cur = pv.clientToPdf(ev.clientX, ev.clientY);
    const dx = cur[0] - start[0], dy = cur[1] - start[1];
    if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
    if (!moved) { moved = true; recordUndo(); }
    Object.assign(o, JSON.parse(JSON.stringify(orig)));
    moveObject(o, dx, dy);
    renderPageObjects(pv);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) emit('objects-changed', { quiet: true });
    else emit('object-click', { id: o.id, pv, event: e });
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function startResize(e, pv, o, h) {
  e.preventDefault();
  const orig = JSON.parse(JSON.stringify(o));
  const b0 = viewBox(orig, pv);
  const [sx, sy] = pv.clientToView(e.clientX, e.clientY);
  let started = false;
  const onMove = (ev) => {
    const [cx, cy] = pv.clientToView(ev.clientX, ev.clientY);
    const dx = cx - sx, dy = cy - sy;
    if (!started) { if (Math.hypot(dx, dy) < 2) return; started = true; recordUndo(); }
    Object.assign(o, JSON.parse(JSON.stringify(orig)));
    if (h === 'p0' || h === 'p1') {
      const p = pv.toPdf(cx, cy);
      if (h === 'p0') { o.x1 = p[0]; o.y1 = p[1]; } else { o.x2 = p[0]; o.y2 = p[1]; }
      renderPageObjects(pv);
      return;
    }
    let L = b0.x, T = b0.y, R = b0.x + b0.w, B = b0.y + b0.h;
    if (h.includes('w')) L += dx; if (h.includes('e')) R += dx;
    if (h.includes('n')) T += dy; if (h.includes('s')) B += dy;
    const proportional = o.type === 'text' || (o.type === 'image' && o.keepRatio !== false) || ev.shiftKey;
    if (proportional && h.length === 2 && b0.w > 0 && b0.h > 0) {
      const k = Math.max((R - L) / b0.w, (B - T) / b0.h, 0.05);
      const nw = b0.w * k, nh = b0.h * k;
      if (h.includes('w')) L = R - nw; else R = L + nw;
      if (h.includes('n')) T = B - nh; else B = T + nh;
    }
    if (R - L < 4) { if (h.includes('w')) L = R - 4; else R = L + 4; }
    if (B - T < 4) { if (h.includes('n')) T = B - 4; else B = T + 4; }
    if (o.type === 'text') {
      const k = (B - T) / Math.max(1, b0.h);
      o.size = Math.max(2, Math.round(orig.size * k * 10) / 10);
      const a = pv.toPdf(L, T); o.ax = a[0]; o.ay = a[1];
    } else if (o.type === 'image') {
      const a = pv.toPdf(L, T); o.ax = a[0]; o.ay = a[1];
      o.w = (R - L) / pv.scale; o.h = (B - T) / pv.scale;
    } else {
      const map = ([x, y]) => {
        const [vx, vy] = pv.toView(x, y);
        const nx = L + (b0.w ? (vx - b0.x) * (R - L) / b0.w : 0);
        const ny = T + (b0.h ? (vy - b0.y) * (B - T) / b0.h : 0);
        return pv.toPdf(nx, ny);
      };
      setPoints(o, pointsOf(orig).map(map));
    }
    renderPageObjects(pv);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (started) emit('objects-changed', { quiet: true });
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------------------------------------------------------------- create / edit / delete
export function addObject(o, { record = true, selectIt = true } = {}) {
  o.id = o.id || uid('o');
  changeObjects(() => { S.objects.set(o.id, o); }, { record });
  if (selectIt) select(o.id);
  return o;
}

export function updateObject(id, patch, { record = true } = {}) {
  const o = S.objects.get(id);
  if (!o) return;
  changeObjects(() => { Object.assign(o, patch); }, { record });
}

export function deleteSelected() {
  const o = selectedObject();
  if (!o) return false;
  changeObjects(() => { S.objects.delete(o.id); });
  select(null);
  return true;
}

let clipboard = null;
export function copySelected() {
  const o = selectedObject();
  if (!o) return false;
  clipboard = JSON.parse(JSON.stringify(o));
  return true;
}
export function pasteClipboard(pageKey) {
  if (!clipboard) return false;
  const o = JSON.parse(JSON.stringify(clipboard));
  o.id = uid('o');
  if (pageKey && pageKey !== o.page) o.page = pageKey; else moveObject(o, 10, -10);
  addObject(o);
  clipboard = JSON.parse(JSON.stringify(o));
  return true;
}

export function nudgeSelected(dx, dy) {
  const o = selectedObject();
  if (!o) return false;
  changeObjects(() => moveObject(o, dx, dy));
  return true;
}

// Text object editing (contenteditable)
export function editTextObject(id, { selectAll = true } = {}) {
  const o = S.objects.get(id);
  if (!o) return;
  const pv = pageByKey(o.page);
  if (!pv) return;
  const n = pv.objLayer.querySelector(`[data-id="${id}"]`);
  if (!n) return;
  select(id);
  n.contentEditable = 'plaintext-only';
  if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true';
  n.classList.add('editing');
  n.focus();
  const range = document.createRange();
  range.selectNodeContents(n);
  if (!selectAll) range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  const before = o.text;
  const finish = () => {
    n.removeEventListener('blur', finish);
    n.removeEventListener('keydown', onKey);
    n.contentEditable = 'false';
    n.classList.remove('editing');
    const text = n.innerText.replace(/ /g, ' ').replace(/\n$/, '');
    if (!text.trim()) {
      changeObjects(() => S.objects.delete(id), { record: !!before });
      if (S.selection && S.selection.id === id) select(null);
    } else if (text !== before) {
      changeObjects(() => { o.text = text; }, { record: !o._new });
    } else renderPageObjects(pv);
    delete o._new;
    emit('selection');
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); n.blur(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); n.blur(); }
    // keep the selection box in step while typing
    requestAnimationFrame(renderSelection);
  };
  n.addEventListener('blur', finish);
  n.addEventListener('keydown', onKey);
  n.addEventListener('input', () => requestAnimationFrame(renderSelection));
}

on('page-layout', (pv) => renderPageObjects(pv));
on('objects-changed', () => renderAllObjects());
