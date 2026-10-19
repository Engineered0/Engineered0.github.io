// Page thumbnails and page management (rotate, reorder, insert, delete, extract).

import { S, on, el, $, emit } from './state.js';
import { changeDoc, pageIndexOf, E } from './doc.js';
import { scrollToPage, ensureBound } from './viewer.js';
import { toast, confirmDialog, passwordDialog, busy } from './ui.js';
import { downloadDocument } from './export.js';

const TW = 140;
let io = null;
const cache = new Map(); // key -> {canvas, version}

function thumbFor(pv) {
  const k = TW / pv.est.w;
  const h = Math.round(pv.est.h * k);
  return { k, h };
}

export function buildThumbs() {
  const box = $('#thumbs');
  box.textContent = '';
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) drawThumb(e.target.dataset.key);
  }, { root: box, rootMargin: '300px 0px' });
  for (const pv of S.pages) {
    const { h } = thumbFor(pv);
    const c = cache.get(pv.key);
    const pic = c && c.canvas ? c.canvas : el('div', { class: 'ph', style: { width: `${TW}px`, height: `${h}px` } });
    const t = el('div', { class: 'thumb', 'data-key': pv.key, draggable: 'true', tabindex: '0', role: 'button', 'aria-label': `Page ${pv.index + 1}` }, pic, el('span', { class: 'n' }, String(pv.index + 1)));
    t.addEventListener('click', (e) => onThumbClick(e, pv));
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onThumbClick(e, pv); } });
    t.addEventListener('dragstart', (e) => { dragKeys = S.pageSel.has(pv.key) ? [...S.pageSel] : [pv.key]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'pages'); });
    t.addEventListener('dragover', (e) => { if (!dragKeys) return; e.preventDefault(); markDrop(t, e); });
    t.addEventListener('dragleave', () => t.classList.remove('drop-before', 'drop-after'));
    t.addEventListener('drop', (e) => { e.preventDefault(); onDrop(t, e); });
    t.addEventListener('dragend', () => { dragKeys = null; document.querySelectorAll('.thumb').forEach((n) => n.classList.remove('drop-before', 'drop-after')); });
    box.append(t);
    io.observe(t);
  }
  markThumbs();
}

async function drawThumb(key) {
  let pv = S.pages.find((p) => p.key === key);
  if (!pv) return;
  await ensureBound(pv);
  const c = cache.get(key);
  if (c && c.version === S.version && c.rot === pv.rotate) return;
  const { k, h } = thumbFor(pv);
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(TW * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = `${TW}px`; canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  cache.set(key, { canvas: (c && c.canvas) || null, version: S.version, rot: pv.rotate });
  try {
    await pv.pdfPage.render({ canvasContext: ctx, viewport: pv.pdfPage.getViewport({ scale: k * dpr, rotation: pv.rotate }) }).promise;
  } catch (e) { return; }
  cache.set(key, { canvas, version: S.version, rot: pv.rotate });
  const t = document.querySelector(`.thumb[data-key="${CSS.escape(key)}"]`);
  if (t) t.firstChild.replaceWith(canvas);
}

function markThumbs() {
  document.querySelectorAll('.thumb').forEach((t) => {
    const pv = S.pages.find((p) => p.key === t.dataset.key);
    t.classList.toggle('current', pv && pv.index === S.currentPage);
    t.classList.toggle('selected', S.pageSel.has(t.dataset.key));
  });
  const n = S.pageSel.size;
  const chip = $('#selCount');
  chip.hidden = n < 2;
  chip.textContent = `${n} selected`;
}

let lastClicked = null;
function onThumbClick(e, pv) {
  if (e.shiftKey && lastClicked !== null) {
    const a = Math.min(lastClicked, pv.index), b = Math.max(lastClicked, pv.index);
    S.pageSel = new Set(S.pages.slice(a, b + 1).map((p) => p.key));
  } else if (e.ctrlKey || e.metaKey) {
    if (S.pageSel.has(pv.key)) S.pageSel.delete(pv.key); else S.pageSel.add(pv.key);
    lastClicked = pv.index;
  } else {
    S.pageSel = new Set([pv.key]);
    lastClicked = pv.index;
    scrollToPage(pv.index);
  }
  markThumbs();
}

// pages the sidebar actions apply to: the selection, or the current page
function targetKeys() {
  const keys = S.pageSel.size ? [...S.pageSel] : [S.pages[S.currentPage] && S.pages[S.currentPage].key];
  return keys.filter((k) => S.pages.some((p) => p.key === k));
}

// ---------------------------------------------------------------- drag reorder
let dragKeys = null;
function markDrop(t, e) {
  const r = t.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  t.classList.toggle('drop-after', after);
  t.classList.toggle('drop-before', !after);
}
async function onDrop(t, e) {
  const keys = dragKeys;
  dragKeys = null;
  document.querySelectorAll('.thumb').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  if (!keys || !keys.length) return;
  const r = t.getBoundingClientRect();
  const after = e.clientY > r.top + r.height / 2;
  const order = S.pages.map((p) => p.key).filter((k) => !keys.includes(k));
  let at = order.indexOf(t.dataset.key);
  if (at < 0) { at = S.pages.findIndex((p) => p.key === t.dataset.key); }
  else if (after) at++;
  const moving = S.pages.map((p) => p.key).filter((k) => keys.includes(k));
  order.splice(at, 0, ...moving);
  await reorder(order);
}

export async function reorder(order) {
  const same = order.every((k, i) => S.pages[i] && S.pages[i].key === k);
  if (same) return;
  await changeDoc((doc) => {
    for (let t = 0; t < order.length; t++) {
      const cur = pageIndexOf(order[t]);
      if (cur === t || cur < 0) continue;
      const page = doc.getPage(cur);
      doc.removePage(cur);
      doc.insertPage(t, page);
    }
  }, { message: 'Reordering pages…', structural: true });
}

// ---------------------------------------------------------------- actions
export async function rotatePages(delta) {
  const keys = targetKeys();
  if (!keys.length) return;
  await changeDoc((doc) => {
    for (const k of keys) {
      const i = pageIndexOf(k);
      if (i < 0) continue;
      const p = doc.getPage(i);
      p.setRotation(PDFLib.degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
    }
  }, { message: 'Rotating…', structural: true });
}

export async function deletePages() {
  const keys = targetKeys();
  if (!keys.length) return;
  if (keys.length >= S.pages.length) { toast('A PDF needs at least one page. Keep at least one page.'); return; }
  const ok = await confirmDialog(`Delete ${keys.length === 1 ? 'this page' : `${keys.length} pages`}?`, `Page${keys.length === 1 ? '' : 's'} ${keys.map((k) => S.pages.findIndex((p) => p.key === k) + 1).sort((a, b) => a - b).join(', ')} will be removed. You can undo this.`, 'Delete');
  if (!ok) return;
  await changeDoc((doc) => {
    const idx = keys.map(pageIndexOf).filter((i) => i >= 0).sort((a, b) => b - a);
    for (const i of idx) doc.removePage(i);
    for (const [id, o] of [...S.objects]) if (keys.includes(o.page)) S.objects.delete(id);
  }, { message: 'Deleting pages…', structural: true });
  S.pageSel = new Set();
}

export async function movePages(dir) {
  const keys = targetKeys();
  if (!keys.length) return;
  const order = S.pages.map((p) => p.key);
  const idx = keys.map((k) => order.indexOf(k)).sort((a, b) => (dir < 0 ? a - b : b - a));
  for (const i of idx) {
    const j = i + dir;
    if (j < 0 || j >= order.length || keys.includes(order[j])) continue;
    [order[i], order[j]] = [order[j], order[i]];
  }
  await reorder(order);
}

export async function insertBlank() {
  const pv = S.pages[S.currentPage] || S.pages[0];
  const at = pv ? pv.index + 1 : 0;
  await changeDoc((doc) => {
    const ref = pv ? doc.getPage(pv.index) : null;
    const size = ref ? [ref.getWidth(), ref.getHeight()] : [612, 792];
    const p = doc.insertPage(at, size);
    if (ref) p.setRotation(ref.getRotation());
  }, { message: 'Adding page…', structural: true });
  emit('goto-page', at);
}

export function insertFromFile() {
  const input = $('#insertInput');
  input.value = '';
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let pw = '', res;
    for (;;) {
      const done = busy('Reading file…');
      try { res = await E.loadDocument(bytes, pw); done(); break; } catch (e) {
        done();
        if (e && e.name === 'PasswordRequiredError') { const p = await passwordDialog(f.name, !!pw); if (p === null) return; pw = p; continue; }
        toast(`Couldn't read “${f.name}”.`); return;
      }
    }
    const pv = S.pages[S.currentPage];
    const at = pv ? pv.index + 1 : S.pages.length;
    const n = res.doc.getPageCount();
    await changeDoc(async (doc) => {
      const pages = await doc.copyPages(res.doc, res.doc.getPageIndices());
      pages.forEach((p, i) => doc.insertPage(at + i, p));
    }, { message: `Inserting ${n} page${n === 1 ? '' : 's'}…`, structural: true });
    toast(`Inserted ${n} page${n === 1 ? '' : 's'} from “${f.name}”`);
    emit('goto-page', at);
  };
  input.click();
}

export async function extractPages() {
  const keys = targetKeys();
  if (!keys.length) return;
  const order = S.pages.map((p) => p.key).filter((k) => keys.includes(k));
  await downloadDocument({ pageKeys: order });
}

on('current-page', markThumbs);
on('pages-built', buildThumbs);
