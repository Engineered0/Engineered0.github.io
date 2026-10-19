// Shared application state and a tiny event bus.

export const S = {
  doc: null,          // pdf-lib document (working copy: text edits & page operations live here)
  bytes: null,        // bytes of the working document as last saved
  pdf: null,          // pdf.js document proxy for rendering
  fileName: 'document.pdf',
  isSample: false,
  wasEncrypted: false,
  pages: [],          // PageView objects in document order
  zoom: 1,
  fitMode: 'width',   // 'width' | 'page' | null
  tool: 'select',
  objects: new Map(), // overlay objects (annotations, added text, images), id -> object
  images: new Map(),  // image assets, id -> { url, bytes, mime, w, h }
  formValues: new Map(),
  selection: null,    // { type: 'object', id } | null
  pageSel: new Set(), // selected page keys in the sidebar
  currentPage: 0,
  version: 0,         // bumps whenever the working document changes
  dirty: false,
  undo: [],
  redo: [],
  opts: {
    color: '#1b1f26',
    highlight: '#ffd400',
    markupColor: '#e5322d',
    stroke: '#e5322d',
    fill: null,
    width: 2,
    opacity: 1,
    hlOpacity: 0.45,
    font: 'sans',
    fontSize: 12,
    bold: false,
    italic: false,
    noteColor: '#ffd400',
  },
  author: 'Me',
};

const listeners = new Map();
export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev).delete(fn);
}
export function emit(ev, data) {
  const ls = listeners.get(ev);
  if (ls) for (const fn of [...ls]) { try { fn(data); } catch (e) { console.error(e); } }
}

let uidN = 0;
export function uid(prefix = 'o') { uidN++; return `${prefix}${Date.now().toString(36)}${uidN.toString(36)}`; }

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function hexToRgb(hex) {
  if (!hex) return null;
  const m = hex.replace('#', '');
  const v = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}
export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')).join('');
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
