// Signature creation (draw / type / upload) and image import helpers.

import { el, uid, S } from './state.js';
import { modal, toast } from './ui.js';

const SIG_FONTS = [
  { css: '"Caveat", cursive', label: 'Caveat' },
  { css: '"Dancing Script", cursive', label: 'Dancing' },
  { css: '"Great Vibes", cursive', label: 'Vibes' },
];
const INK = '#1a2a6c';

function loadSaved() {
  try { return JSON.parse(localStorage.getItem('folio.signatures') || '[]'); } catch (e) { return []; }
}
// Everything Pagewright keeps in this browser (and nowhere else)
export function forgetSavedData() {
  try { localStorage.removeItem('folio.signatures'); localStorage.removeItem('folio.sigName'); } catch (e) { /* storage unavailable */ }
}
function saveSaved(list) {
  try { localStorage.setItem('folio.signatures', JSON.stringify(list.slice(0, 4))); } catch (e) { /* storage unavailable */ }
}

// Decode a data: URL directly (fetching data: URLs is blocked by the artifact's security policy)
function dataUrlToBytes(url) {
  const i = url.indexOf(',');
  const meta = url.slice(0, i), body = url.slice(i + 1);
  if (!/;base64/i.test(meta)) return new TextEncoder().encode(decodeURIComponent(body));
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

// Trim transparent margins of a canvas, return PNG data URL + size
function trimmed(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 1; c.height = y1 - y0 + 1;
  c.getContext('2d').drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
  return { url: c.toDataURL('image/png'), w: c.width, h: c.height };
}

export async function registerImageAsset(url, mime, w, h) {
  const bytes = dataUrlToBytes(url);
  const id = uid('img');
  S.images.set(id, { url, bytes, mime, w, h });
  return id;
}

export function signatureDialog() {
  return new Promise((resolve) => {
    let mode = 'draw';
    let font = 0;
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    const tabs = el('div', { class: 'tabs', role: 'tablist' });
    const panel = el('div');
    const saved = loadSaved();
    // draw
    const pad = el('canvas', { class: 'sigpad', 'aria-label': 'Signature drawing area' });
    let strokes = [];
    const setupPad = () => {
      const r = pad.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      pad.width = Math.max(10, r.width * dpr); pad.height = Math.max(10, r.height * dpr);
      redraw();
    };
    const redraw = () => {
      const ctx = pad.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, pad.width, pad.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const s of strokes) {
        ctx.beginPath();
        s.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
        ctx.stroke();
      }
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      const s = [[e.clientX - r.left, e.clientY - r.top]];
      strokes.push(s);
      const mv = (ev) => { s.push([ev.clientX - r.left, ev.clientY - r.top]); redraw(); };
      const up = () => { pad.removeEventListener('pointermove', mv); pad.removeEventListener('pointerup', up); };
      pad.addEventListener('pointermove', mv);
      pad.addEventListener('pointerup', up);
      redraw();
    });
    const clearBtn = el('button', { class: 'btn outline', onclick: () => { strokes = []; redraw(); } }, 'Clear');
    // type
    const typed = el('input', { type: 'text', class: 'sigtype', id: 'sigName', placeholder: 'Type your name', 'aria-label': 'Your name', value: localStorage && (() => { try { return localStorage.getItem('folio.sigName') || ''; } catch (e) { return ''; } })() });
    const fontBtns = el('div', { class: 'sigfonts' });
    const styleTyped = () => { typed.style.fontFamily = SIG_FONTS[font].css; [...fontBtns.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === font))); };
    SIG_FONTS.forEach((fo, i) => fontBtns.append(el('button', { style: { fontFamily: fo.css }, onclick: () => { font = i; styleTyped(); } }, typed.value || 'Signature')));
    typed.addEventListener('input', () => [...fontBtns.children].forEach((b) => (b.textContent = typed.value || 'Signature')));
    // upload
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', id: 'sigFile' });
    let uploaded = null;
    const preview = el('img', { style: { maxHeight: '120px', maxWidth: '100%', display: 'none', background: '#fff', border: '1px solid var(--line)', borderRadius: '6px' } });
    const removeWhite = el('input', { type: 'checkbox', id: 'sigWhite', checked: true });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      uploaded = await readImageFile(f);
      preview.src = uploaded.url; preview.style.display = 'block';
    });

    const show = () => {
      panel.textContent = '';
      [...tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === mode)));
      if (mode === 'draw') {
        panel.append(pad, el('div', { class: 'btnrow', style: { marginTop: '8px', justifyContent: 'space-between', alignItems: 'center' } }, el('span', { class: 'hint' }, 'Sign with a mouse, trackpad or finger.'), clearBtn));
        requestAnimationFrame(setupPad);
      } else if (mode === 'type') {
        panel.append(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, typed, fontBtns));
        styleTyped();
        setTimeout(() => typed.focus(), 30);
      } else if (mode === 'upload') {
        panel.append(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, file, preview, el('label', { class: 'check', for: 'sigWhite' }, removeWhite, el('span', {}, 'Make white background transparent'))));
      } else {
        const list = el('div', { class: 'saved-sigs' });
        saved.forEach((s, i) => list.append(el('button', { title: 'Use this signature', onclick: () => finish({ url: s.url, w: s.w, h: s.h }, false) }, el('img', { src: s.url, alt: `Saved signature ${i + 1}` }))));
        const forget = el('button', { class: 'btn outline', onclick: () => { forgetSavedData(); saved.length = 0; list.textContent = ''; toast('Saved signatures deleted from this device'); show(); } }, 'Delete saved signatures');
        panel.append(saved.length ? list : el('p', { class: 'hint' }, 'No saved signatures yet.'), saved.length ? el('div', { class: 'btnrow', style: { marginTop: '8px' } }, forget) : null);
      }
    };
    const tabDefs = [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']];
    if (saved.length) tabDefs.unshift(['saved', 'Saved']);
    if (saved.length) mode = 'saved';
    for (const [m, label] of tabDefs) tabs.append(el('button', { role: 'tab', 'data-m': m, onclick: () => { mode = m; show(); } }, label));
    // saving is opt-in: nothing is kept unless the box is ticked
    const remember = el('input', { type: 'checkbox', id: 'sigRemember' });
    body.append(tabs, panel, el('label', { class: 'check', for: 'sigRemember' }, remember, el('span', {}, 'Remember this signature on this device (it stays in this browser only)')));
    let dlg;
    const finish = (sig, store = true) => {
      if (!sig) return;
      if (store && remember.checked) { saved.unshift(sig); saveSaved(saved); }
      dlg.close('done');
      resolve(sig);
    };
    const build = async () => {
      if (mode === 'draw') {
        if (!strokes.length) { toast('Draw your signature first'); return false; }
        return trimmed(pad);
      }
      if (mode === 'type') {
        const name = typed.value.trim();
        if (!name) { toast('Type your name first'); return false; }
        if (remember.checked) { try { localStorage.setItem('folio.sigName', name); } catch (e) { /* ignore */ } }
        try { await document.fonts.load(`64px ${SIG_FONTS[font].css}`, name); } catch (e) { /* use fallback */ }
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.font = `96px ${SIG_FONTS[font].css}`;
        const w = Math.ceil(ctx.measureText(name).width) + 40;
        c.width = w; c.height = 150;
        ctx.font = `96px ${SIG_FONTS[font].css}`;
        ctx.fillStyle = INK; ctx.textBaseline = 'middle';
        ctx.fillText(name, 20, 75);
        return trimmed(c);
      }
      if (mode === 'upload') {
        if (!uploaded) { toast('Choose an image first'); return false; }
        if (!removeWhite.checked) return { url: uploaded.url, w: uploaded.w, h: uploaded.h };
        const c = document.createElement('canvas');
        c.width = uploaded.w; c.height = uploaded.h;
        const ctx = c.getContext('2d');
        await new Promise((r) => { const im = new Image(); im.onload = () => { ctx.drawImage(im, 0, 0); r(); }; im.src = uploaded.url; });
        const id = ctx.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < id.data.length; i += 4) {
          const m = Math.min(id.data[i], id.data[i + 1], id.data[i + 2]);
          if (m > 225) id.data[i + 3] = 0; else if (m > 180) id.data[i + 3] = Math.round(255 * (225 - m) / 45);
        }
        ctx.putImageData(id, 0, 0);
        return trimmed(c) || { url: uploaded.url, w: uploaded.w, h: uploaded.h };
      }
      return false;
    };
    dlg = modal({
      title: 'Add signature', body, width: 520,
      actions: [
        { label: 'Cancel' },
        { label: 'Place signature', kind: 'primary', onClick: async () => { const sig = await build(); if (sig) finish(sig); return false; } },
      ],
      onClose: (v) => { if (v !== 'done') resolve(null); },
    });
    show();
  });
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const url = fr.result;
      const im = new Image();
      im.onload = () => {
        let out = url, mime = file.type;
        if (mime !== 'image/png' && mime !== 'image/jpeg') {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          c.getContext('2d').drawImage(im, 0, 0);
          out = c.toDataURL('image/png'); mime = 'image/png';
        }
        resolve({ url: out, mime, w: im.naturalWidth, h: im.naturalHeight });
      };
      im.onerror = () => reject(new Error('Unsupported image'));
      im.src = url;
    };
    fr.readAsDataURL(file);
  });
}
