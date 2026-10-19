// Page views: layout, zoom, lazy rendering and coordinate conversion.

import { S, emit, on, el, $ } from './state.js';
import { pdfjsLib, pageKeyAt } from './doc.js';

const CSS_UNITS = 96 / 72;
const MAX_CANVAS_PIXELS = 16777216;
const viewerEl = () => $('#viewer');
const pagesEl = () => $('#pages');

export class PageView {
  constructor(index, key) {
    this.index = index;
    this.key = key;
    this.el = el('div', { class: 'page', 'data-key': key });
    this.label = el('div', { class: 'pg-label' });
    this.loading = el('div', { class: 'loading' }, 'Rendering…');
    this.canvas = null;
    this.formLayer = el('div', { class: 'layer forms' });
    this.objLayer = el('div', { class: 'layer objs' });
    this.uiLayer = el('div', { class: 'layer ui' });
    this.uiLayer.style.pointerEvents = 'none';
    this.el.append(this.loading, this.formLayer, this.objLayer, this.uiLayer, this.label);
    this.renderedAt = null; // {scale, version}
    this.task = null;
    this.visible = false;
  }

  async bind(pdfPage) {
    this.pdfPage = pdfPage;
    this.rotate = pdfPage.rotate;
    this.view = pdfPage.view;
    this.bound = true;
    const v = pdfPage.getViewport({ scale: 1, rotation: pdfPage.rotate });
    this.est = { w: v.width, h: v.height };
    this.layout();
  }

  // size estimate used until the page is loaded (big documents load lazily)
  estimate(est) { this.est = est; this.bound = false; this.vp = null; this.layout(); }

  layout() {
    const scale = S.zoom * CSS_UNITS;
    this.scale = scale;
    this.label.textContent = `${this.index + 1}`;
    if (!this.bound) {
      this.el.style.width = `${Math.floor(this.est.w * scale)}px`;
      this.el.style.height = `${Math.floor(this.est.h * scale)}px`;
      return;
    }
    this.vp = this.pdfPage.getViewport({ scale, rotation: this.rotate });
    this.el.style.width = `${Math.floor(this.vp.width)}px`;
    this.el.style.height = `${Math.floor(this.vp.height)}px`;
    emit('page-layout', this);
  }

  toView(x, y) { return this.vp.convertToViewportPoint(x, y); }
  toPdf(vx, vy) { return this.vp.convertToPdfPoint(vx, vy); }
  clientToView(cx, cy) { const r = this.el.getBoundingClientRect(); return [cx - r.left, cy - r.top]; }
  clientToPdf(cx, cy) { const [vx, vy] = this.clientToView(cx, cy); return this.toPdf(vx, vy); }

  needsRender() {
    return !this.renderedAt || this.renderedAt.scale !== this.scale || this.renderedAt.version !== this.pdfVersion;
  }

  async render() {
    if (!this.bound || !this.pdfPage || !this.needsRender()) return;
    if (this.task) { try { this.task.cancel(); } catch (e) { /* ignore */ } this.task = null; }
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let w = this.vp.width * dpr, h = this.vp.height * dpr;
    let k = dpr;
    if (w * h > MAX_CANVAS_PIXELS) { const f = Math.sqrt(MAX_CANVAS_PIXELS / (w * h)); k = dpr * f; w *= f; h *= f; }
    const canvas = document.createElement('canvas');
    canvas.className = 'render';
    canvas.width = Math.floor(w); canvas.height = Math.floor(h);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const want = { scale: this.scale, version: this.pdfVersion };
    const task = this.pdfPage.render({
      canvasContext: ctx, viewport: this.vp, transform: [k, 0, 0, k, 0, 0],
      annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS,
    });
    this.task = task;
    try {
      await task.promise;
    } catch (e) {
      if (e && e.name === 'RenderingCancelledException') return;
      console.error('render failed', e);
    }
    if (this.task !== task) return;
    this.task = null;
    if (this.canvas) this.canvas.replaceWith(canvas); else this.el.prepend(canvas);
    this.canvas = canvas;
    this.loading.hidden = true;
    this.renderedAt = want;
    emit('page-rendered', this);
  }
}

// ---------------------------------------------------------------- build / rebuild
let io = null;
let generation = 0;
const EAGER = 40;

export async function ensureBound(pv) {
  if (pv.bound && pv.pdfVersion === pv.boundVersion) return pv;
  if (!pv.binding) {
    const gen = generation;
    pv.binding = S.pdf.getPage(pv.index + 1).then(async (pg) => {
      if (gen !== generation) return;
      pv.boundVersion = pv.pdfVersion;
      await pv.bind(pg);
    }).finally(() => { pv.binding = null; });
  }
  await pv.binding;
  return pv;
}

let built = Promise.resolve();
export function whenBuilt() { return built; }
export function buildPages() {
  built = buildPagesInner();
  return built;
}
async function buildPagesInner() {
  const gen = ++generation;
  const n = S.pdf.numPages;
  const old = new Map(S.pages.map((p) => [p.key, p]));
  const pages = [];
  for (let i = 0; i < n; i++) {
    const key = pageKeyAt(i);
    let pv = old.get(key);
    if (pv) old.delete(key); else pv = new PageView(i, key);
    pv.index = i;
    pv.pdfVersion = S.version;
    pv.binding = null;
    pages.push(pv);
  }
  for (const pv of old.values()) { if (pv.task) pv.task.cancel(); pv.el.remove(); }
  S.pages = pages;
  // first page (and visible ones) now, sizes for the rest are estimated
  const first = await S.pdf.getPage(1);
  if (gen !== generation) return;
  const fv = first.getViewport({ scale: 1, rotation: first.rotate });
  const guess = { w: fv.width, h: fv.height };
  const container = pagesEl();
  pages.forEach((pv, i) => {
    if (!pv.est) pv.est = guess;
    if (container.children[i] !== pv.el) container.insertBefore(pv.el, container.children[i] || null);
  });
  while (container.children.length > pages.length) container.lastChild.remove();
  const eager = pages.filter((pv, i) => i < EAGER || pv.visible || i === S.currentPage);
  for (const pv of pages) if (!eager.includes(pv) && pv.boundVersion !== S.version) { pv.bound = false; pv.vp = null; pv.layout(); }
  await Promise.all(eager.map((pv) => ensureBound(pv)));
  if (gen !== generation) return;
  observe();
  emit('pages-built');
  scheduleRender();
  // load the remaining pages in the background
  (async () => {
    const rest = pages.filter((pv) => !pv.bound || pv.boundVersion !== S.version);
    for (let i = 0; i < rest.length; i += 25) {
      await new Promise((r) => setTimeout(r, 0));
      if (gen !== generation) return;
      await Promise.all(rest.slice(i, i + 25).map((pv) => ensureBound(pv).catch(() => {})));
    }
    if (gen === generation) emit('pages-bound');
  })();
}

function observe() {
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const pv = S.pages.find((p) => p.el === e.target);
      if (!pv) continue;
      const was = pv.visible;
      pv.visible = e.isIntersecting;
      if (pv.visible && !pv.bound) ensureBound(pv).then(() => { emit('page-visible', pv); scheduleRender(); });
      else if (pv.visible && !was) emit('page-visible', pv);
    }
    scheduleRender();
  }, { root: viewerEl(), rootMargin: '800px 0px' });
  for (const pv of S.pages) io.observe(pv.el);
}

let renderTimer = null;
export function scheduleRender(delay = 30) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    const vis = S.pages.filter((p) => p.visible && p.needsRender());
    // render pages closest to the current page first
    vis.sort((a, b) => Math.abs(a.index - S.currentPage) - Math.abs(b.index - S.currentPage));
    for (const pv of vis) await pv.render();
  }, delay);
}

// ---------------------------------------------------------------- zoom
export function fitScale(mode) {
  const v = viewerEl();
  const pv = S.pages[S.currentPage] || S.pages[0];
  if (!pv || !pv.est) return 1;
  const bw = pv.est.w * CSS_UNITS, bh = pv.est.h * CSS_UNITS;
  const availW = v.clientWidth - 48;
  const availH = v.clientHeight - 48;
  if (mode === 'page') return Math.max(0.1, Math.min(availW / bw, availH / bh));
  return Math.max(0.1, Math.min(4, availW / bw));
}

export function setZoom(z, { mode = null, anchor = null } = {}) {
  const v = viewerEl();
  const prev = S.zoom;
  z = Math.max(0.1, Math.min(6, z));
  S.fitMode = mode;
  if (Math.abs(z - prev) < 1e-4 && !mode) return;
  // keep the point under the anchor (or the viewport centre) steady
  const rect = v.getBoundingClientRect();
  const ax = anchor ? anchor[0] - rect.left : v.clientWidth / 2;
  const ay = anchor ? anchor[1] - rect.top : 0;
  const cx = (v.scrollLeft + ax) / prev, cy = (v.scrollTop + ay) / prev;
  S.zoom = z;
  for (const pv of S.pages) pv.layout();
  v.scrollLeft = cx * z - ax;
  v.scrollTop = cy * z - ay;
  emit('zoom');
  scheduleRender(120);
}

export function zoomStep(dir, anchor) {
  const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
  const z = S.zoom;
  let next = dir > 0 ? steps.find((s) => s > z + 0.001) : [...steps].reverse().find((s) => s < z - 0.001);
  if (!next) next = dir > 0 ? 6 : 0.25;
  setZoom(next, { anchor });
}

export function applyFit() {
  if (S.fitMode) setZoom(fitScale(S.fitMode), { mode: S.fitMode });
}

// ---------------------------------------------------------------- navigation
export function scrollToPage(i, { smooth = false } = {}) {
  const pv = S.pages[i];
  if (!pv) return;
  const v = viewerEl();
  v.scrollTo({ top: pv.el.offsetTop - 24, behavior: smooth ? 'smooth' : 'auto' });
  setCurrent(i);
}

export function setCurrent(i) {
  if (S.currentPage === i) return;
  S.currentPage = i;
  emit('current-page', i);
}

export function updateCurrentFromScroll() {
  const v = viewerEl();
  const mid = v.scrollTop + v.clientHeight * 0.35;
  let best = 0, bestD = Infinity;
  for (const pv of S.pages) {
    const top = pv.el.offsetTop, bot = top + pv.el.offsetHeight;
    const d = mid < top ? top - mid : mid > bot ? mid - bot : 0;
    if (d < bestD) { bestD = d; best = pv.index; }
  }
  setCurrent(best);
}

export function pageAtClient(cx, cy) {
  for (const pv of S.pages) {
    const r = pv.el.getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return pv;
  }
  return null;
}

export function pageByKey(key) { return S.pages.find((p) => p.key === key); }

on('doc-changed', () => { for (const pv of S.pages) pv.pdfVersion = S.version; });
export { CSS_UNITS };
