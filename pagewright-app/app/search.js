// Find in document, using pdf.js text extraction (runs in the worker).

import { S, on, el, $ } from './state.js';
import { scrollToPage } from './viewer.js';
import { changeDoc, loadFontBytes, E } from './doc.js';
import { toast, confirmDialog } from './ui.js';

let index = null; // [{ items: [...], text, map: [[itemIdx, offset]] }] per page
let indexVersion = -1;
let hits = [];
let cur = -1;
let query = '';

async function pageIndex(i) {
  const pg = await S.pdf.getPage(i + 1);
  const tc = await pg.getTextContent();
  let text = '';
  const map = [];
  tc.items.forEach((it, k) => {
    if (typeof it.str !== 'string') return;
    for (let o = 0; o < it.str.length; o++) { map.push([k, o]); }
    text += it.str;
    if (it.hasEOL) { text += ' '; map.push([k, -1]); }
  });
  return { items: tc.items, text: text.toLowerCase(), map };
}

async function ensureIndex() {
  if (index && indexVersion === S.version && index.length === S.pages.length) return;
  indexVersion = S.version;
  index = await Promise.all(S.pages.map((_, i) => pageIndex(i).catch(() => ({ items: [], text: '', map: [] }))));
}

function boxesFor(pi, start, len) {
  const pg = index[pi];
  const byItem = new Map();
  for (let c = start; c < start + len; c++) {
    const m = pg.map[c];
    if (!m || m[1] < 0) continue;
    const [k, o] = m;
    if (!byItem.has(k)) byItem.set(k, [o, o]);
    else byItem.get(k)[1] = o;
  }
  const out = [];
  for (const [k, [a, b]] of byItem) {
    const it = pg.items[k];
    const [A, B, C, D, E, F] = it.transform;
    const n = it.str.length || 1;
    const dirLen = Math.hypot(A, B) || 1;
    const ux = A / dirLen, uy = B / dirLen;
    const h = it.height || Math.hypot(C, D);
    const vx = -uy, vy = ux; // up vector
    const t0 = (it.width * a) / n, t1 = (it.width * (b + 1)) / n;
    const P = (t, s) => [E + ux * t + vx * s, F + uy * t + vy * s];
    out.push([P(t0, h * 0.95), P(t1, h * 0.95), P(t0, -h * 0.22)]);
  }
  return out;
}

function draw() {
  document.querySelectorAll('.searchhit').forEach((n) => n.remove());
  hits.forEach((hit, i) => {
    const pv = S.pages[hit.page];
    if (!pv || !pv.vp) return;
    for (const [tl, tr, bl] of hit.boxes) {
      const a = pv.toView(...tl), b = pv.toView(...tr), c = pv.toView(...bl);
      const w = Math.hypot(b[0] - a[0], b[1] - a[1]), h = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const d = el('div', { class: `searchhit${i === cur ? ' current' : ''}` });
      Object.assign(d.style, { left: `${a[0]}px`, top: `${a[1]}px`, width: `${w}px`, height: `${h}px`, transformOrigin: '0 0', transform: `rotate(${Math.atan2(b[1] - a[1], b[0] - a[0])}rad)` });
      pv.uiLayer.append(d);
    }
  });
  $('#searchCount').textContent = query ? (hits.length ? `${cur + 1}/${hits.length}` : '0/0') : '';
}

let seq = 0;
export async function runSearch(q) {
  query = q.trim().toLowerCase();
  const my = ++seq;
  if (!query) { hits = []; cur = -1; draw(); return; }
  await ensureIndex();
  if (my !== seq) return;
  hits = [];
  index.forEach((pg, pi) => {
    let from = 0;
    for (;;) {
      const i = pg.text.indexOf(query, from);
      if (i < 0) break;
      hits.push({ page: pi, boxes: boxesFor(pi, i, query.length) });
      from = i + Math.max(1, query.length);
    }
  });
  cur = hits.findIndex((h) => h.page >= S.currentPage);
  if (cur < 0 && hits.length) cur = 0;
  draw();
  reveal();
}

function reveal() {
  const h = hits[cur];
  if (!h) return;
  const pv = S.pages[h.page];
  const v = $('#viewer');
  const box = h.boxes[0];
  if (!box || !pv.vp) { scrollToPage(h.page); return; }
  const [x, y] = pv.toView(...box[0]);
  const top = pv.el.offsetTop + y - v.clientHeight / 3;
  const left = pv.el.offsetLeft + x - v.clientWidth / 3;
  v.scrollTo({ top, left: Math.max(0, left) });
}

export function step(dir) {
  if (!hits.length) return;
  cur = (cur + dir + hits.length) % hits.length;
  draw();
  reveal();
}

export function openSearch() {
  const bar = $('#searchBar');
  bar.hidden = false;
  const inp = $('#searchInput');
  inp.focus(); inp.select();
}
export function closeSearch() {
  $('#searchBar').hidden = true;
  query = ''; hits = []; cur = -1; draw();
}

export function installSearch() {
  const inp = $('#searchInput');
  let t = null;
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => runSearch(inp.value), 180); });
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); if (query !== inp.value.trim().toLowerCase()) runSearch(inp.value); else step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
}

on('page-layout', () => { if (hits.length) requestAnimationFrame(draw); });
on('doc-changed', () => { if (query) { const q = query; runSearch(q); } });

// ---------------------------------------------------------------- replace all
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export async function replaceAll(find, repl) {
  find = find.trim() ? find : '';
  if (!find) { toast('Type the text to find first.'); return; }
  const re = new RegExp(escapeRe(find), 'g'); // case-sensitive: safer for edits
  // count first
  let total = 0;
  for (let i = 0; i < S.doc.getPageCount(); i++) {
    for (const g of E.analyzeText(S.doc, i).groups) { const m = g.text.match(re); if (m) total += m.length; }
  }
  if (!total) { toast(`No editable text matches “${find}”.`); return; }
  const ok = await confirmDialog('Replace all?', `Replace ${total} occurrence${total === 1 ? '' : 's'} of “${find}” with “${repl}”? Text is rewritten in the document’s own fonts. You can undo this.`, 'Replace all');
  if (!ok) return;
  let done = 0, fallback = 0, skipped = 0;
  await changeDoc(async (doc) => {
    for (let i = 0; i < doc.getPageCount(); i++) {
      let k = 0;
      for (;;) {
        const groups = E.analyzeText(doc, i).groups;
        if (k >= groups.length) break;
        const g = groups[k];
        k++;
        if (!re.test(g.text)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        if (!g.fonts.every((f) => f.editable)) { skipped++; continue; }
        const n = (g.text.match(re) || []).length;
        const text = g.text.replace(re, repl);
        const rep = await E.applyGroupEdit(doc, g, text ? { text } : { remove: true }, loadFontBytes);
        done += n;
        if (!rep.exact) fallback++;
      }
    }
  }, { message: `Replacing ${total}…` });
  toast(`Replaced ${done} occurrence${done === 1 ? '' : 's'}${skipped ? `; ${skipped} line${skipped === 1 ? '' : 's'} couldn't be edited` : ''}${fallback ? `; ${fallback} line${fallback === 1 ? '' : 's'} needed a matching fallback font for new characters` : ''}.`, { ms: 6000 });
  const inp = $('#searchInput');
  if (inp.value) runSearch(inp.value);
}

export function installReplace() {
  const t = $('#btnReplaceToggle');
  t.addEventListener('click', () => {
    const box = $('#replaceBox');
    box.hidden = !box.hidden;
    t.setAttribute('aria-pressed', String(!box.hidden));
    if (!box.hidden) $('#replaceInput').focus();
  });
  $('#replaceInput').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') replaceAll($('#searchInput').value, $('#replaceInput').value); });
  $('#btnReplaceAll').addEventListener('click', () => replaceAll($('#searchInput').value, $('#replaceInput').value));
}
