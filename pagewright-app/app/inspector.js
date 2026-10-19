// Context-sensitive inspector: text-edit details, object properties, tool
// options, or document information.

import { S, on, el, $, formatBytes, rgbToHex } from './state.js';
import { selectedObject, updateObject, deleteSelected, TEXT_FONTS, renderSelection } from './objects.js';
import { currentEdit, setEditSize, setEditColor, deleteEditingLine, commitEditing, cancelEditing } from './textedit.js';
import { analyze, changeObjects, recordUndo } from './doc.js';
import { statusBox } from './ui.js';
import { icon } from './icons.js';

const INK = ['#1b1f26', '#e5322d', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#868e96', '#ffffff'];
const HL = ['#ffd400', '#8ce99a', '#74c0fc', '#faa2c1', '#ffa94d'];
const NOTE = ['#ffd400', '#8ce99a', '#74c0fc', '#faa2c1', '#ffffff'];

function sec(title, ...kids) { return el('section', { class: 'insp-sec' }, title ? el('h3', {}, title) : null, ...kids); }
function row(label, control, id) { return el('div', { class: 'row' }, el('label', { for: id }, label), control); }

function swatches(colors, value, onPick, { allowNone = false, id = 'sw' } = {}) {
  const box = el('div', { class: 'swatches', role: 'radiogroup' });
  const all = allowNone ? [null, ...colors] : colors;
  for (const c of all) {
    const b = el('button', { class: `sw${c ? '' : ' none'}`, title: c || 'None', 'aria-label': c || 'None', 'aria-pressed': String((value || null) === c) });
    if (c) b.style.background = c;
    b.addEventListener('click', () => onPick(c));
    box.append(b);
  }
  const custom = el('label', { class: 'sw custom', title: 'Custom colour' });
  const inp = el('input', { type: 'color', id, value: value || '#000000', 'aria-label': 'Custom colour' });
  inp.addEventListener('change', () => onPick(inp.value));
  custom.append(inp);
  if (value && !all.includes(value)) custom.setAttribute('aria-pressed', 'true');
  box.append(custom);
  return box;
}

function range(id, value, min, max, step, fmt, onInput, onStart) {
  const r = el('input', { type: 'range', id, min, max, step, value });
  const v = el('span', { class: 'val' }, fmt(value));
  r.addEventListener('pointerdown', () => onStart && onStart());
  r.addEventListener('keydown', () => onStart && onStart());
  r.addEventListener('input', () => { v.textContent = fmt(+r.value); onInput(+r.value); });
  return el('div', { class: 'row', style: { flex: '1', minWidth: '0' } }, r, v);
}

// apply a change to the selected object, recording undo once per gesture
function liveEditor(o) {
  let started = false;
  return {
    start() { if (!started) { recordUndo(); started = true; } },
    set(patch, { gesture = false } = {}) {
      if (!gesture) { changeObjects(() => Object.assign(o, patch)); return; }
      if (!started) { recordUndo(); started = true; }
      changeObjects(() => Object.assign(o, patch), { record: false });
    },
  };
}

// ---------------------------------------------------------------- panels
function scanTextPanel(ed) {
  const out = [];
  if (ed.pending || !ed.commit) return [sec('Edit scanned text', el('p', { class: 'hint' }, 'Getting the scanned line ready…'))];
  const p = ed.plan;
  out.push(el('div', { class: 'fontcard' }, el('div', { class: 'fn' }, 'Scanned text'), el('div', { class: 'fm' }, 'Letters are copied from the scan itself')));
  if (p && p.exact) out.push(statusBox('ok', 'Every letter is copied from the scan, in the same style, so the edit matches the page.'));
  else if (p) out.push(statusBox('warn', `These letters don’t appear anywhere in the scan: <span class="chars">${escapeHtml(p.fallbackChars.join(' '))}</span>. They are drawn with the closest-matching font, tuned to the scan’s size, weight and ink.`));
  out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(INK.slice(0, 7), ed.color(), (c) => { if (c) { setEditColor(c); render(); } }, { id: 'teColor' })));
  out.push(el('p', { class: 'hint' }, 'Enter applies · Esc cancels.'));
  out.push(el('div', { class: 'btnrow' },
    el('button', { class: 'btn primary', onclick: () => commitEditing() }, 'Apply'),
    el('button', { class: 'btn outline', onclick: () => cancelEditing() }, 'Cancel'),
    el('button', { class: 'btn danger', onclick: () => deleteEditingLine(), html: icon('trash') + 'Delete line' })));
  return [sec('Edit scanned text', ...out)];
}

function editTextPanel(ed) {
  if (ed.scan) return scanTextPanel(ed);
  const g = ed.g;
  const out = [];
  const fontsUsed = g.fonts;
  const f = g.font;
  const d = f.describe();
  const kind = d.embedded ? (d.subset ? 'Embedded subset' : 'Embedded') : 'Not embedded';
  const card = el('div', { class: 'fontcard' },
    el('div', { class: 'fn' }, d.name),
    el('div', { class: 'fm' }, `${kind} · ${d.type}${fontsUsed.length > 1 ? ` · +${fontsUsed.length - 1} more style${fontsUsed.length > 2 ? 's' : ''} on this line` : ''}`));
  out.push(card);
  const p = ed.plan;
  if (p) {
    if (p.exact) out.push(statusBox('ok', ed.faithful ? 'Exact font. Every character is drawn with the PDF’s own embedded font.' : 'Exact font. Every character is drawn with the PDF’s own font; the preview here is approximate until you apply.'));
    else {
      const chars = p.fallbackChars.map((c) => (c === ' ' ? '␣' : c)).join(' ');
      const fb = (p.fallbackKey || '').replace(/^Liberation/, 'Liberation ').replace('-', ' ').replace('Regular', '').trim();
      const subset = f.isSubset ? 'The embedded font is a subset that doesn’t include' : 'The embedded font doesn’t include';
      out.push(statusBox('warn', `${subset} <span class="chars">${escapeHtml(chars)}</span>. Those characters will use <b>${escapeHtml(fb)}</b>, a metric-compatible match; everything else stays in the original font.`));
    }
  }
  const sizeId = 'teSize';
  const size = el('input', { type: 'number', id: sizeId, min: 1, max: 400, step: 0.5, value: +(ed.size || Math.abs(g.size)).toFixed(2) });
  size.addEventListener('change', () => setEditSize(+size.value));
  const color = rgbToHex(ed.rgb || g.rgb);
  out.push(row('Size (pt)', size, sizeId));
  out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(INK.slice(0, 7), color, (c) => { if (c) { setEditColor(c); render(); } }, { id: 'teColor' })));
  out.push(el('p', { class: 'hint' }, 'Enter applies · Shift+Enter adds a line · Esc cancels. Drag the blue grip to move the line.'));
  out.push(el('div', { class: 'btnrow' },
    el('button', { class: 'btn primary', onclick: () => commitEditing() }, 'Apply'),
    el('button', { class: 'btn outline', onclick: () => cancelEditing() }, 'Cancel'),
    el('button', { class: 'btn danger', onclick: () => deleteEditingLine(), html: icon('trash') + 'Delete line' })));
  return [sec('Edit text', ...out)];
}

function objectPanel(o) {
  const out = [];
  const ed = liveEditor(o);
  const names = { rect: o.whiteout ? 'Whiteout' : 'Rectangle', ellipse: 'Ellipse', line: o.arrow ? 'Arrow' : 'Line', ink: 'Drawing', markup: { highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough' }[o.kind], text: 'Text', image: o.sig ? 'Signature' : 'Image', note: 'Comment' };
  if (o.type === 'markup') {
    const pal = o.kind === 'highlight' ? HL : INK.slice(0, 6);
    out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(pal, o.color, (c) => { if (c) { ed.set({ color: c }); if (o.kind === 'highlight') S.opts.highlight = c; else S.opts.markupColor = c; render(); } })));
    if (o.kind === 'highlight') out.push(row('Opacity', range('obOp', o.opacity ?? 0.45, 0.15, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { ed.set({ opacity: v }, { gesture: true }); S.opts.hlOpacity = v; }), 'obOp'));
    if (o.text) out.push(el('p', { class: 'hint' }, `“${o.text.length > 120 ? o.text.slice(0, 120) + '…' : o.text}”`));
  } else if (o.type === 'text') {
    const fsel = el('select', { id: 'obFont' }, ...Object.entries(TEXT_FONTS).map(([k, v]) => el('option', { value: k, selected: k === o.font }, v.label)));
    fsel.addEventListener('change', () => { ed.set({ font: fsel.value }); S.opts.font = fsel.value; });
    out.push(row('Font', fsel, 'obFont'));
    const size = el('input', { type: 'number', id: 'obSize', min: 2, max: 400, step: 0.5, value: o.size });
    size.addEventListener('change', () => { if (+size.value > 0) { ed.set({ size: +size.value }); S.opts.fontSize = +size.value; } });
    out.push(row('Size (pt)', size, 'obSize'));
    out.push(el('div', { class: 'row' }, el('label', {}, 'Style'), el('div', { class: 'seg' },
      el('button', { 'aria-pressed': String(!!o.bold), title: 'Bold', html: icon('bold'), onclick: () => { ed.set({ bold: !o.bold }); S.opts.bold = o.bold; render(); } }),
      el('button', { 'aria-pressed': String(!!o.italic), title: 'Italic', html: icon('italic'), onclick: () => { ed.set({ italic: !o.italic }); S.opts.italic = o.italic; render(); } }))));
    out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(INK, o.color, (c) => { if (c) { ed.set({ color: c }); S.opts.color = c; render(); } })));
    out.push(el('p', { class: 'hint' }, 'Double-click the text to change it. Added text becomes part of the page when you download, and can then be edited with Edit text.'));
  } else if (o.type === 'note') {
    out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(NOTE, o.color, (c) => { if (c) { ed.set({ color: c }); S.opts.noteColor = c; render(); } })));
    out.push(el('p', { class: 'hint' }, 'Click the comment icon to read or edit it.'));
  } else if (o.type === 'image') {
    out.push(row('Opacity', range('obOp', o.opacity ?? 1, 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => ed.set({ opacity: v }, { gesture: true })), 'obOp'));
    out.push(el('p', { class: 'hint' }, 'Drag a corner to resize. Hold Shift with Rectangle-style handles to keep proportions.'));
  } else if (o.whiteout) {
    out.push(el('p', { class: 'hint' }, 'Whiteout is painted into the page when you download. It hides content visually; the text underneath is not removed from the file.'));
  } else {
    if (o.type === 'rect' || o.type === 'ellipse') {
      out.push(el('div', { class: 'row' }, el('label', {}, 'Stroke'), swatches(INK, o.stroke, (c) => { ed.set({ stroke: c }); S.opts.stroke = c; render(); }, { allowNone: true })));
      out.push(el('div', { class: 'row' }, el('label', {}, 'Fill'), swatches(INK, o.fill, (c) => { ed.set({ fill: c }); S.opts.fill = c; render(); }, { allowNone: true, id: 'swf' })));
    } else {
      out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(INK, o.stroke, (c) => { if (c) { ed.set({ stroke: c }); S.opts.stroke = c; render(); } })));
    }
    out.push(row('Width', range('obW', o.width, 0.5, 12, 0.5, (v) => `${v} pt`, (v) => { ed.set({ width: v }, { gesture: true }); S.opts.width = v; renderSelection(); }), 'obW'));
    out.push(row('Opacity', range('obOp', o.opacity ?? 1, 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { ed.set({ opacity: v }, { gesture: true }); S.opts.opacity = v; }), 'obOp'));
  }
  out.push(el('div', { class: 'btnrow' }, el('button', { class: 'btn danger', onclick: () => deleteSelected(), html: icon('trash') + 'Delete' })));
  return [sec(names[o.type] || 'Object', ...out)];
}

function toolPanel(tool) {
  const o = S.opts;
  const out = [];
  if (tool === 'edittext') {
    out.push(el('p', {}, 'Click any line of text to change it. Text is rewritten in the PDF itself using the document’s own embedded font, so it looks the same as the original.'));
    out.push(...pageFontsSection());
    return [sec('Edit text', ...out.slice(0, 1)), ...out.slice(1)];
  }
  if (tool === 'text') {
    const fsel = el('select', { id: 'tFont' }, ...Object.entries(TEXT_FONTS).map(([k, v]) => el('option', { value: k, selected: k === o.font }, v.label)));
    fsel.addEventListener('change', () => { o.font = fsel.value; });
    const size = el('input', { type: 'number', id: 'tSize', min: 2, max: 400, step: 0.5, value: o.fontSize });
    size.addEventListener('change', () => { if (+size.value > 0) o.fontSize = +size.value; });
    out.push(row('Font', fsel, 'tFont'), row('Size (pt)', size, 'tSize'));
    out.push(el('div', { class: 'row' }, el('label', {}, 'Style'), el('div', { class: 'seg' },
      el('button', { 'aria-pressed': String(o.bold), html: icon('bold'), title: 'Bold', onclick: () => { o.bold = !o.bold; render(); } }),
      el('button', { 'aria-pressed': String(o.italic), html: icon('italic'), title: 'Italic', onclick: () => { o.italic = !o.italic; render(); } }))));
    out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(INK, o.color, (c) => { if (c) { o.color = c; render(); } })));
    out.push(el('p', { class: 'hint' }, 'Click on the page where the text should start.'));
    return [sec('Add text', ...out)];
  }
  if (tool === 'highlight' || tool === 'underline' || tool === 'strike') {
    const hl = tool === 'highlight';
    out.push(el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(hl ? HL : INK.slice(0, 6), hl ? o.highlight : o.markupColor, (c) => { if (c) { if (hl) o.highlight = c; else o.markupColor = c; render(); } })));
    if (hl) out.push(row('Opacity', range('tOp', o.hlOpacity, 0.15, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { o.hlOpacity = v; }), 'tOp'));
    out.push(el('p', { class: 'hint' }, hl ? 'Drag across text to highlight it. Drag on an empty area to highlight a region.' : 'Drag across the text to mark.'));
    return [sec({ highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough' }[tool], ...out)];
  }
  if (['draw', 'rect', 'ellipse', 'line', 'arrow'].includes(tool)) {
    out.push(el('div', { class: 'row' }, el('label', {}, tool === 'rect' || tool === 'ellipse' ? 'Stroke' : 'Colour'), swatches(INK, o.stroke, (c) => { if (c || tool === 'rect' || tool === 'ellipse') { o.stroke = c; render(); } }, { allowNone: tool === 'rect' || tool === 'ellipse' })));
    if (tool === 'rect' || tool === 'ellipse') out.push(el('div', { class: 'row' }, el('label', {}, 'Fill'), swatches(INK, o.fill, (c) => { o.fill = c; render(); }, { allowNone: true, id: 'swf' })));
    out.push(row('Width', range('tW', o.width, 0.5, 12, 0.5, (v) => `${v} pt`, (v) => { o.width = v; }), 'tW'));
    out.push(row('Opacity', range('tOp', o.opacity, 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`, (v) => { o.opacity = v; }), 'tOp'));
    out.push(el('p', { class: 'hint' }, tool === 'draw' ? 'Draw freehand on the page.' : 'Drag on the page. Hold Shift to constrain.'));
    return [sec({ draw: 'Draw', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' }[tool], ...out)];
  }
  if (tool === 'whiteout') return [sec('Whiteout', el('p', {}, 'Drag over content to cover it with white. To change existing text, Edit text is the better choice: it really replaces the text.'))];
  if (tool === 'note') return [sec('Comment', el('div', { class: 'row' }, el('label', {}, 'Colour'), swatches(NOTE, o.noteColor, (c) => { if (c) { o.noteColor = c; render(); } })), el('p', { class: 'hint' }, 'Click where the comment should go.'))];
  return null;
}

function pageFontsSection() {
  const pv = S.pages[S.currentPage];
  if (!pv || !S.doc) return [];
  let a;
  try { a = analyze(pv.index); } catch (e) { return []; }
  if (!a.fonts || !a.fonts.length) return [sec(`Fonts on page ${pv.index + 1}`, el('p', { class: 'hint' }, 'No text on this page.'))];
  const list = el('div', { class: 'fontlist' });
  for (const f of a.fonts) {
    const d = f.describe();
    const tag = !d.editable ? 'Not editable' : d.embedded ? (d.subset ? 'Subset' : 'Embedded') : 'System';
    list.append(el('div', { class: 'fi', title: d.reason || '' }, el('span', {}, d.name), el('span', { class: 'chip' }, tag)));
  }
  return [sec(`Fonts on page ${pv.index + 1}`, list)];
}

function docPanel() {
  if (!S.doc) return [];
  const kv = el('dl', { class: 'kv' },
    el('dt', {}, 'Pages'), el('dd', {}, String(S.pages.length)),
    el('dt', {}, 'Size'), el('dd', {}, formatBytes(S.bytes ? S.bytes.length : 0)),
    el('dt', {}, 'Edits'), el('dd', {}, String(S.undo.length)),
    el('dt', {}, 'Annotations'), el('dd', {}, String(S.objects.size)));
  const parts = [sec('Document', kv)];
  if (S.isSample) parts.push(sec('', statusBox('warn', 'This is a <b>sample document</b> so you can try things out. Open your own PDF with <b>Open</b> or drop a file anywhere.')));
  parts.push(...pageFontsSection());
  parts.push(sec('Shortcuts', el('p', { class: 'hint' }, 'V select · E edit text · T add text · M highlight · P draw · N comment · S sign · Ctrl+Z undo · Ctrl+S download · Ctrl+scroll zoom · Space+drag pan')));
  return parts;
}

// ---------------------------------------------------------------- render
let pending = false, forced = false, lastKey = '';
export function render(force = true) {
  forced = forced || force === true;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const root = $('#inspector');
    const ed = currentEdit();
    const o = selectedObject();
    const key = ed ? `e${ed.g.id}${ed.scan ? `:${ed.pending ? 'p' : ''}${ed.plan ? ed.plan.fallbackChars.join('') : ''}` : ''}` : o ? `o${o.id}` : `t${S.tool}${S.currentPage}`;
    // don't rebuild under a control the user is operating, unless the context changed
    const active = document.activeElement;
    const wasForced = forced; forced = false;
    if (!wasForced && key === lastKey && active && root.contains(active) && active !== root) return;
    lastKey = key;
    let parts = null;
    if (ed) parts = editTextPanel(ed);
    else if (o) parts = objectPanel(o);
    else parts = toolPanel(S.tool) || docPanel();
    root.textContent = '';
    for (const p of parts) root.append(p);
  });
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

for (const ev of ['selection', 'tool', 'textedit', 'doc-opened', 'doc-changed', 'current-page', 'history', 'objects-changed']) on(ev, () => render(false));
