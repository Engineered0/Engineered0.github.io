// Toasts, modal dialogs and the busy indicator. (alert/confirm/prompt are
// unavailable in the viewer, so every confirmation is built here.)

import { el, $ } from './state.js';
import { icon } from './icons.js';

export function toast(msg, { action, onAction, ms = 3800 } = {}) {
  const t = el('div', { class: 'toast', role: 'status' }, msg);
  if (action) t.append(el('button', { onclick: () => { onAction && onAction(); t.remove(); } }, action));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

let busyEl = null, busyCount = 0;
export function busyMessage(msg) { if (busyEl) busyEl.querySelector('.msg').textContent = msg; }
export function busy(msg = 'Working…', { onCancel } = {}) {
  busyCount++;
  if (!busyEl) {
    busyEl = el('div', { class: 'busy' }, el('div', {}, el('span', { class: 'spin' }), el('span', { class: 'msg' }, msg)));
    if (onCancel) {
      const b = el('button', { class: 'btn outline busy-cancel' }, 'Stop');
      b.addEventListener('click', () => { b.disabled = true; b.textContent = 'Stopping…'; onCancel(); });
      busyEl.firstChild.append(b);
    }
    // Show only if the work takes a moment, to avoid flashes
    busyEl.style.visibility = 'hidden';
    document.body.append(busyEl);
    const me = busyEl;
    setTimeout(() => { if (me.isConnected) me.style.visibility = 'visible'; }, 180);
  } else busyEl.querySelector('.msg').textContent = msg;
  let done = false;
  return () => {
    if (done) return; done = true;
    busyCount--;
    if (busyCount <= 0 && busyEl) { busyEl.remove(); busyEl = null; busyCount = 0; }
  };
}

export function modal({ title, body, actions = [], onClose, width }) {
  const back = el('div', { class: 'modal-back' });
  const tid = `mt${Math.random().toString(36).slice(2, 8)}`;
  const box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid });
  if (width) box.style.width = `min(${width}px, 100%)`;
  const footer = el('footer');
  const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); onClose && onClose(v); };
  for (const a of actions) {
    const b = el('button', { class: `btn ${a.kind || 'outline'}` }, a.label);
    b.addEventListener('click', async () => {
      if (a.onClick) {
        const r = await a.onClick(close);
        if (r === false) return;
      }
      close(a.value);
    });
    footer.append(b);
  }
  const bodyEl = el('div', { class: 'body' });
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  box.append(el('h2', { class: 'mtitle', id: tid }, title), bodyEl, footer);
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(undefined); });
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  const first = box.querySelector('input, textarea, select') || footer.querySelector('.primary') || footer.querySelector('button');
  setTimeout(() => first && first.focus(), 30);
  return { close, box, body: bodyEl };
}

export function confirmDialog(title, message, okLabel = 'Continue', danger = false) {
  return new Promise((resolve) => {
    modal({
      title, body: el('p', {}, message),
      actions: [
        { label: 'Cancel', value: false },
        { label: okLabel, value: true, kind: danger ? 'primary danger-primary' : 'primary' },
      ],
      onClose: (v) => resolve(!!v),
    });
  });
}

export function passwordDialog(fileName, wrong) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'password', id: 'pdfPassword', autocomplete: 'off', 'aria-label': 'Password' });
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      el('p', { style: { margin: 0 } }, `“${fileName}” is protected. Enter its password to open and edit it.`),
      input,
      wrong ? el('div', { class: 'err' }, 'That password is not correct. Try again.') : null,
    );
    let m;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { m.close(input.value); } });
    m = modal({
      title: 'Password required', body,
      actions: [{ label: 'Cancel', value: null }, { label: 'Open', kind: 'primary', onClick: (close) => { close(input.value); return false; } }],
      onClose: (v) => resolve(v === undefined ? null : v),
    });
  });
}

export function statusBox(kind, html) {
  const ico = kind === 'ok' ? 'check' : kind === 'warn' ? 'info' : 'alert';
  return el('div', { class: `status ${kind}`, html: icon(ico) + `<div>${html}</div>` });
}
