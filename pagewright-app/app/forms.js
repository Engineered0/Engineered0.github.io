// Fillable form fields: HTML inputs laid over each widget. Values are kept by
// field name and written into the PDF's AcroForm on download.

import { S, on, el, emit } from './state.js';
import { changeObjects } from './doc.js';

const annCache = new WeakMap();
async function widgets(pv) {
  let a = annCache.get(pv.pdfPage);
  if (!a) {
    a = pv.pdfPage.getAnnotations({ intent: 'display' }).then((list) => list.filter((x) => x.subtype === 'Widget' && x.fieldType && !x.hidden)).catch(() => []);
    annCache.set(pv.pdfPage, a);
  }
  return a;
}

export function fieldValue(w) {
  if (S.formValues.has(w.fieldName)) return S.formValues.get(w.fieldName);
  return w.fieldValue;
}

function setValue(name, v) {
  if (S.formValues.get(name) === v) return;
  changeObjects(() => S.formValues.set(name, v));
}

export async function renderForms(pv) {
  if (!pv.bound || !pv.vp) return;
  const list = await widgets(pv);
  pv.formLayer.textContent = '';
  for (const w of list) {
    const [x1, y1, x2, y2] = w.rect;
    const a = pv.toView(x1, y1), b = pv.toView(x2, y2);
    const left = Math.min(a[0], b[0]), top = Math.min(a[1], b[1]);
    const width = Math.abs(b[0] - a[0]), height = Math.abs(b[1] - a[1]);
    const ro = !!w.readOnly;
    let input = null;
    const fs = w.defaultAppearanceData && w.defaultAppearanceData.fontSize ? w.defaultAppearanceData.fontSize * pv.scale : Math.min(height * 0.7, 12 * pv.scale);
    if (w.fieldType === 'Tx') {
      const v = fieldValue(w);
      input = w.multiLine ? el('textarea', {}) : el('input', { type: w.password ? 'password' : 'text' });
      input.value = Array.isArray(v) ? v.join(', ') : (v ?? '');
      if (w.maxLen) input.maxLength = w.maxLen;
      input.style.fontSize = `${Math.max(6, fs || height * 0.6)}px`;
      if (w.textAlignment === 1) input.style.textAlign = 'center';
      if (w.textAlignment === 2) input.style.textAlign = 'right';
      if (w.comb && w.maxLen) { input.style.letterSpacing = `${width / w.maxLen - fs * 0.6}px`; input.style.fontFamily = 'monospace'; }
      input.addEventListener('change', () => setValue(w.fieldName, input.value));
    } else if (w.fieldType === 'Btn' && (w.checkBox || w.radioButton)) {
      input = el('input', { type: w.checkBox ? 'checkbox' : 'radio', name: `r_${w.fieldName}` });
      const v = fieldValue(w);
      const on = w.checkBox ? (v && v !== 'Off' && (v === w.exportValue || v === true || v === 'Yes' || v === w.exportValue)) : v === w.buttonValue;
      input.checked = !!on;
      input.addEventListener('change', () => {
        if (w.checkBox) setValue(w.fieldName, input.checked ? (w.exportValue || 'Yes') : 'Off');
        else if (input.checked) setValue(w.fieldName, w.buttonValue);
        renderAllForms();
      });
      Object.assign(input.style, { width: `${Math.min(width, height)}px`, height: `${Math.min(width, height)}px` });
    } else if (w.fieldType === 'Ch') {
      input = el('select', {});
      if (w.multiSelect) input.multiple = true;
      const v = fieldValue(w);
      const vals = Array.isArray(v) ? v : [v];
      if (!w.multiSelect && w.combo) input.append(el('option', { value: '' }, ''));
      for (const opt of w.options || []) {
        const o = el('option', { value: opt.exportValue }, opt.displayValue);
        if (vals.includes(opt.exportValue) || vals.includes(opt.displayValue)) o.selected = true;
        input.append(o);
      }
      input.style.fontSize = `${Math.max(6, Math.min(fs || 12, height * 0.7))}px`;
      input.addEventListener('change', () => setValue(w.fieldName, w.multiSelect ? [...input.selectedOptions].map((o) => o.value) : input.value));
    } else continue;
    input.classList.add('formfield');
    if (ro) { input.disabled = true; input.classList.add('readonly'); }
    input.title = w.alternativeText || w.fieldName;
    input.setAttribute('aria-label', w.alternativeText || w.fieldName);
    input.id = `ff_${pv.key.replace(/\W/g, '_')}_${w.id}`;
    const isBox = input.type === 'checkbox' || input.type === 'radio';
    Object.assign(input.style, isBox
      ? { left: `${left + (width - Math.min(width, height)) / 2}px`, top: `${top + (height - Math.min(width, height)) / 2}px` }
      : { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => e.stopPropagation());
    pv.formLayer.append(input);
  }
}

export function renderAllForms() { for (const pv of S.pages) renderForms(pv); }

export async function documentHasForm() {
  for (const pv of S.pages) if ((await widgets(pv)).length) return true;
  return false;
}

on('page-layout', (pv) => renderForms(pv));
on('forms-changed', () => renderAllForms()); // undo/redo of field values
