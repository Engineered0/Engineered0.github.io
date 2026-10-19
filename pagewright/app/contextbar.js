// The options bar under the tools: one plain sentence saying what to do next,
// plus the controls for whatever is being worked on (colour, size, delete, done).

import { S, on, el, $, rgbToHex } from './state.js';
import { icon } from './icons.js';
import { selectedObject, TEXT_FONTS, renderSelection, editTextObject, deleteSelected, select } from './objects.js';
import { currentEdit, setEditSize, setEditColor, deleteEditingLine, commitEditing, cancelEditing, hasGlyphSelection } from './textedit.js';
import { changeObjects } from './doc.js';
import { setTool, MARK_TOOLS, SHAPE_TOOLS } from './tools.js';
import { pageFactsNow, readScannedPages, readPictureObject } from './ocr.js';

const TEXT_COLORS = [['#1b1f26', 'Black'], ['#6b7280', 'Grey'], ['#d92d20', 'Red'], ['#f08c00', 'Orange'], ['#2f9e44', 'Green'], ['#1971c2', 'Blue'], ['#7048e8', 'Purple'], ['#ffffff', 'White']];
const HL_COLORS = [['#ffd400', 'Yellow'], ['#8ce99a', 'Green'], ['#74c0fc', 'Blue'], ['#faa2c1', 'Pink'], ['#ffa94d', 'Orange']];
const NOTE_COLORS = [['#ffd400', 'Yellow'], ['#8ce99a', 'Green'], ['#74c0fc', 'Blue'], ['#faa2c1', 'Pink']];
const THICK = [[1, 'Thin'], [2.5, 'Medium'], [5, 'Thick']];

// ---------------------------------------------------------------- building blocks
const hint = (ico, text) => el('div', { class: 'ctx-hint', html: icon(ico) }, el('span', {}, text));
const group = (label, ...kids) => el('div', { class: 'ctx-group' }, label ? el('span', { class: 'ctx-label' }, label) : null, ...kids);
const divider = () => el('span', { class: 'ctx-div', 'aria-hidden': 'true' });

function colors(list, value, onPick, { none = false, id = 'ccol' } = {}) {
  const box = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour' });
  const items = none ? [[null, 'No colour'], ...list] : list;
  const val = value ? value.toLowerCase() : null;
  for (const [c, name] of items) {
    const b = el('button', { class: `sw${c ? '' : ' none'}`, title: name, 'aria-label': name, role: 'radio', 'aria-checked': String(val === (c && c.toLowerCase())) });
    if (c) b.style.background = c;
    b.addEventListener('click', () => onPick(c));
    box.append(b);
  }
  const known = items.some(([c]) => (c && c.toLowerCase()) === val);
  const custom = el('label', { class: `sw custom${val && !known ? ' on' : ''}`, title: 'More colours' });
  const inp = el('input', { type: 'color', id, value: val && /^#[0-9a-f]{6}$/.test(val) ? val : '#000000', 'aria-label': 'More colours' });
  inp.addEventListener('input', () => onPick(inp.value));
  custom.append(inp);
  box.append(custom);
  return box;
}

function stepper(value, onChange, { min = 4, max = 200, step = 1, id = 'csize', label = 'Size' } = {}) {
  const inp = el('input', { type: 'text', inputmode: 'decimal', id, value: fmt(value), 'aria-label': label });
  const set = (v) => { v = Math.max(min, Math.min(max, Math.round(v * 2) / 2)); inp.value = fmt(v); onChange(v); };
  const minus = el('button', { title: 'Smaller', 'aria-label': 'Smaller' }, '−');
  const plus = el('button', { title: 'Bigger', 'aria-label': 'Bigger' }, '+');
  minus.addEventListener('click', () => set((parseFloat(inp.value) || value) - step));
  plus.addEventListener('click', () => set((parseFloat(inp.value) || value) + step));
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (v > 0) set(v); else inp.value = fmt(value); });
  inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); });
  return el('div', { class: 'stepper' }, minus, inp, plus);
}
const fmt = (v) => String(Math.round(v * 10) / 10);

function seg(options, value, onPick) {
  const box = el('div', { class: 'cseg', role: 'radiogroup' });
  for (const o of options) {
    const b = el('button', { role: 'radio', 'aria-checked': String(o.value === value), title: o.title || o.label, html: o.ico ? icon(o.ico) : '' }, o.label ? el('span', {}, o.label) : null);
    b.addEventListener('click', () => onPick(o.value));
    box.append(b);
  }
  return box;
}

function toggles(items, onToggle) {
  const box = el('div', { class: 'cseg' });
  for (const it of items) {
    const b = el('button', { 'aria-pressed': String(it.on), title: it.title, 'aria-label': it.title, html: icon(it.ico) });
    b.addEventListener('click', () => onToggle(it.key, !it.on));
    box.append(b);
  }
  return box;
}

function button(label, ico, onClick, kind = '') {
  const b = el('button', { class: `btn ${kind}`, html: ico ? icon(ico) : '' }, el('span', {}, label));
  b.addEventListener('click', onClick);
  return b;
}

// edit the selected object (one undo step per change)
const patchObj = (o, patch) => changeObjects(() => Object.assign(o, patch));

// ---------------------------------------------------------------- states
function textStyleControls(cur, apply) {
  const fontSel = el('select', { id: 'cfont', 'aria-label': 'Font' }, ...Object.entries(TEXT_FONTS).map(([k, v]) => el('option', { value: k, selected: k === cur.font }, v.label.replace(/ \(.*\)/, ''))));
  fontSel.addEventListener('change', () => apply({ font: fontSel.value }));
  return [
    group('Font', fontSel),
    group('Size', stepper(cur.size, (v) => apply({ size: v }), { min: 4, max: 144 })),
    toggles([{ key: 'bold', ico: 'bold', title: 'Bold', on: !!cur.bold }, { key: 'italic', ico: 'italic', title: 'Italic', on: !!cur.italic }], (k, v) => apply({ [k]: v })),
    group('Colour', colors(TEXT_COLORS, cur.color, (c) => c && apply({ color: c }))),
  ];
}

function scanLineState(ed) {
  if (ed.pending || !ed.commit) return [hint('scan', 'Getting the scanned line ready…')];
  const p = ed.plan;
  const n = p.fallbackChars.length;
  const chip = p.exact
    ? el('span', { class: 'fontchip ok', title: 'Every letter is copied from the scan itself, in the same style.', html: icon('check') }, 'Letters copied from the scan')
    : el('span', { class: 'fontchip warn', title: `These letters don't appear anywhere in the scan, so they use the closest-matching font: ${p.fallbackChars.join(' ')}`, html: icon('info') }, `${n} letter${n === 1 ? '' : 's'} not in the scan use a look-alike font`);
  return [
    hint('editText', 'Type your changes, then press Enter or Done. New letters are copied from the scan.'),
    el('div', { class: 'ctx-controls' },
      group('Colour', colors(TEXT_COLORS, ed.color(), (c) => { if (c) { setEditColor(c); render(true); } })),
      chip,
      divider(),
      button('Delete line', 'trash', () => deleteEditingLine(), 'danger'),
      button('Cancel', '', () => cancelEditing()),
      button('Done', 'check', () => commitEditing(), 'primary')),
  ];
}

function editLineState(ed) {
  if (ed.scan) return scanLineState(ed);
  const g = ed.g;
  const p = ed.plan;
  const chip = !p ? null : p.exact
    ? el('span', { class: 'fontchip ok', title: `Uses the PDF's own font: ${g.font.cleanName}`, html: icon('check') }, 'Same font as the document')
    : el('span', { class: 'fontchip warn', title: `The PDF only contains some letters of ${g.font.cleanName}. These will use a look-alike font: ${p.fallbackChars.join(' ')}`, html: icon('info') }, `${p.fallbackChars.length} new letter${p.fallbackChars.length === 1 ? '' : 's'} use a look-alike font`);
  const size = ed.size || Math.abs(g.size);
  const color = rgbToHex(ed.rgb || g.rgb);
  return [
    hint('editText', 'Type your changes, then press Enter or Done.'),
    el('div', { class: 'ctx-controls' },
      group('Size', stepper(size, (v) => setEditSize(v), { min: 2, max: 300, step: 1 })),
      group('Colour', colors(TEXT_COLORS, color, (c) => { if (c) { setEditColor(c); render(true); } })),
      chip,
      divider(),
      button('Delete line', 'trash', () => deleteEditingLine(), 'danger'),
      button('Cancel', '', () => cancelEditing()),
      button('Done', 'check', () => commitEditing(), 'primary')),
  ];
}

function objectState(o) {
  const out = [];
  if (o.type === 'text') {
    const n = document.querySelector(`.textobj[data-id="${o.id}"]`);
    const typing = n && n.classList.contains('editing');
    out.push(hint('addText', typing ? 'Type your text. Click outside the box when you are done.' : 'Drag the text to move it. Double-click it to change the words.'));
    out.push(el('div', { class: 'ctx-controls' },
      ...textStyleControls(o, (patch) => { patchObj(o, patch); Object.assign(S.opts, patchToOpts(patch)); render(true); }),
      divider(),
      typing ? null : button('Change words', 'editText', () => editTextObject(o.id, { selectAll: false })),
      button('Delete', 'trash', () => deleteSelected(), 'danger')));
    return out;
  }
  if (o.type === 'image') {
    out.push(hint('image', o.sig ? 'Drag your signature into place. Drag a corner to make it bigger or smaller.' : 'Drag the picture into place. Drag a corner to resize it.'));
    out.push(el('div', { class: 'ctx-controls' },
      o.sig ? null : button('Read its text', 'scan', () => readPictureObject(o)),
      button('Delete', 'trash', () => deleteSelected(), 'danger'), button('Done', 'check', () => select(null), 'primary')));
    return out;
  }
  if (o.type === 'note') {
    out.push(hint('note', 'Click the note to read or change it. Drag it to move it.'));
    out.push(el('div', { class: 'ctx-controls' },
      group('Colour', colors(NOTE_COLORS, o.color, (c) => { if (c) { patchObj(o, { color: c }); S.opts.noteColor = c; render(true); } })),
      button('Delete', 'trash', () => deleteSelected(), 'danger')));
    return out;
  }
  if (o.type === 'markup') {
    const hl = o.kind === 'highlight';
    out.push(hint('highlight', 'Pick a different colour, or delete this mark.'));
    out.push(el('div', { class: 'ctx-controls' },
      group('Colour', colors(hl ? HL_COLORS : TEXT_COLORS.slice(0, 7), o.color, (c) => { if (c) { patchObj(o, { color: c }); if (hl) S.opts.highlight = c; else S.opts.markupColor = c; render(true); } })),
      button('Delete', 'trash', () => deleteSelected(), 'danger')));
    return out;
  }
  if (o.whiteout) {
    out.push(hint('whiteout', 'Drag the white box over what you want to hide. Drag its corners to resize.'));
    out.push(el('div', { class: 'ctx-controls' }, button('Delete', 'trash', () => deleteSelected(), 'danger')));
    return out;
  }
  // shapes and drawings
  const shape = o.type === 'rect' || o.type === 'ellipse';
  out.push(hint(o.type === 'ink' ? 'draw' : 'shapes', 'Drag to move it. Drag the corners to resize it.'));
  out.push(el('div', { class: 'ctx-controls' },
    group(shape ? 'Line colour' : 'Colour', colors(TEXT_COLORS, o.stroke, (c) => { if (c || shape) { patchObj(o, { stroke: c }); S.opts.stroke = c; render(true); } }, { none: shape })),
    shape ? group('Fill', colors(TEXT_COLORS, o.fill, (c) => { patchObj(o, { fill: c }); S.opts.fill = c; render(true); }, { none: true, id: 'cfill' })) : null,
    group('Thickness', seg(THICK.map(([v, l]) => ({ value: v, label: l })), nearest(o.width), (v) => { patchObj(o, { width: v }); S.opts.width = v; renderSelection(); render(true); })),
    button('Delete', 'trash', () => deleteSelected(), 'danger')));
  return out;
}

const nearest = (w) => THICK.reduce((a, [v]) => (Math.abs(v - w) < Math.abs(a - w) ? v : a), THICK[0][0]);
function patchToOpts(p) {
  const o = {};
  if ('font' in p) o.font = p.font;
  if ('size' in p) o.fontSize = p.size;
  if ('bold' in p) o.bold = p.bold;
  if ('italic' in p) o.italic = p.italic;
  if ('color' in p) o.color = p.color;
  return o;
}

function toolState(tool) {
  const o = S.opts;
  if (tool === 'edittext') {
    const f = pageFactsNow(S.pages[S.currentPage]);
    if (f && f.needsOcr) {
      return [hint('scan', 'This page is a scan (a picture). Let Pagewright read its text first, then click any words to change them.'),
        el('div', { class: 'ctx-controls' }, button('Read the text', 'scan', () => readScannedPages(), 'primary'))];
    }
    if (f && f.canRead) {
      return [hint('editText', 'Click on any words to change them. Words inside a picture? Let Pagewright read them first.'),
        el('div', { class: 'ctx-controls' }, button('Read text in pictures', 'scan', () => readScannedPages({ pages: [S.pages[S.currentPage]] }), 'primary'))];
    }
    return [hint('editText', 'Click on any words in the document to change them.')];
  }
  if (tool === 'text') {
    return [hint('addText', 'Click on the page where you want to type.'),
      el('div', { class: 'ctx-controls' }, ...textStyleControls({ font: o.font, size: o.fontSize, bold: o.bold, italic: o.italic, color: o.color }, (patch) => { Object.assign(o, patchToOpts(patch)); render(true); }))];
  }
  if (MARK_TOOLS.includes(tool)) {
    const hl = tool === 'highlight';
    return [hint('highlight', hl ? 'Drag across words to highlight them.' : tool === 'underline' ? 'Drag across words to underline them.' : 'Drag across words to cross them out.'),
      el('div', { class: 'ctx-controls' },
        seg([{ value: 'highlight', label: 'Highlight', ico: 'highlight' }, { value: 'underline', label: 'Underline', ico: 'underline' }, { value: 'strike', label: 'Cross out', ico: 'strike' }], tool, (v) => setTool(v)),
        group('Colour', colors(hl ? HL_COLORS : TEXT_COLORS.slice(0, 7), hl ? o.highlight : o.markupColor, (c) => { if (c) { if (hl) o.highlight = c; else o.markupColor = c; render(true); } })))];
  }
  if (tool === 'draw') {
    return [hint('draw', 'Draw on the page with your mouse or finger.'),
      el('div', { class: 'ctx-controls' },
        group('Colour', colors(TEXT_COLORS, o.stroke || '#d92d20', (c) => { if (c) { o.stroke = c; render(true); } })),
        group('Thickness', seg(THICK.map(([v, l]) => ({ value: v, label: l })), nearest(o.width), (v) => { o.width = v; render(true); })))];
  }
  if (SHAPE_TOOLS.includes(tool)) {
    const shape = tool === 'rect' || tool === 'ellipse';
    return [hint('shapes', 'Drag on the page to draw it.'),
      el('div', { class: 'ctx-controls' },
        seg([{ value: 'rect', label: 'Box', ico: 'rect' }, { value: 'ellipse', label: 'Circle', ico: 'ellipse' }, { value: 'line', label: 'Line', ico: 'line' }, { value: 'arrow', label: 'Arrow', ico: 'arrow' }], tool, (v) => setTool(v)),
        group(shape ? 'Line colour' : 'Colour', colors(TEXT_COLORS, o.stroke, (c) => { if (c || shape) { o.stroke = c; render(true); } }, { none: shape })),
        shape ? group('Fill', colors(TEXT_COLORS, o.fill, (c) => { o.fill = c; render(true); }, { none: true, id: 'cfill' })) : null,
        group('Thickness', seg(THICK.map(([v, l]) => ({ value: v, label: l })), nearest(o.width), (v) => { o.width = v; render(true); })))];
  }
  if (tool === 'whiteout') return [hint('whiteout', 'Drag over anything you want to cover with white.')];
  if (tool === 'note') {
    return [hint('note', 'Click on the page where you want to leave a comment.'),
      el('div', { class: 'ctx-controls' }, group('Colour', colors(NOTE_COLORS, o.noteColor, (c) => { if (c) { o.noteColor = c; render(true); } })))];
  }
  if (tool === 'hand') return [hint('hand', 'Drag the page to move around.')];
  // select, nothing selected
  if (hasGlyphSelection()) return [hint('copy', 'Use the buttons next to the selected words to copy or highlight them.')];
  const f = pageFactsNow(S.pages[S.currentPage]);
  if (f && f.needsOcr) {
    return [hint('scan', 'This page is a scan (a picture of a page). Let Pagewright read its text to search it, copy it, or change the words.'),
      el('div', { class: 'ctx-controls' }, button('Read the text', 'scan', () => readScannedPages(), 'primary'), button('Sign', 'sign', () => setTool('sign')), button('How do I…?', 'help', () => document.getElementById('btnHelp').click()))];
  }
  return [hint('pointer', 'Choose what you want to do with the buttons above. To fill in a form, just click a box and type.'),
    el('div', { class: 'ctx-controls' },
      button('Change words', 'editText', () => setTool('edittext')),
      button('Sign', 'sign', () => setTool('sign')),
      button('How do I…?', 'help', () => document.getElementById('btnHelp').click()))];
}

// ---------------------------------------------------------------- render
let pending = false, forced = false, lastKey = '';
export function render(force = false) {
  forced = forced || force;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const bar = $('#ctxbar');
    const ed = currentEdit();
    const o = selectedObject();
    const typing = o && o.type === 'text' && document.querySelector(`.textobj.editing[data-id="${o.id}"]`);
    const key = ed ? `e${ed.g.id}:${ed.pending ? 'p' : ''}:${ed.plan ? ed.plan.fallbackChars.join('') : ''}` : o ? `o${o.id}:${typing ? 1 : 0}` : `t${S.tool}:${hasGlyphSelection()}:${(pageFactsNow(S.pages[S.currentPage]) || {}).needsOcr ? 'scan' : ''}:${(pageFactsNow(S.pages[S.currentPage]) || {}).canRead ? 'pic' : ''}`;
    const active = document.activeElement;
    const wasForced = forced; forced = false;
    // don't rebuild under a field the user is typing in
    if (!wasForced && key === lastKey) return;
    if (active && bar.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT') && key === lastKey) return;
    lastKey = key;
    const parts = ed ? editLineState(ed) : o ? objectState(o) : toolState(S.tool);
    bar.textContent = '';
    for (const p of parts) if (p) bar.append(p);
  });
}

// keep focus where the user is working: clicking buttons here must not end typing
export function installContextBar() {
  const bar = $('#ctxbar');
  bar.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (t.closest('button') && !t.closest('input, select')) e.preventDefault();
  });
  bar.addEventListener('keydown', (e) => e.stopPropagation());
  for (const ev of ['selection', 'tool', 'textedit', 'doc-opened', 'objects-changed', 'glyph-selection', 'doc-changed', 'current-page', 'scan-facts', 'ocr-done']) on(ev, () => render(false));
  document.addEventListener('focusin', (e) => { if (e.target.classList && e.target.classList.contains('textobj')) render(true); });
  document.addEventListener('focusout', (e) => { if (e.target.classList && e.target.classList.contains('textobj')) setTimeout(() => render(true), 0); });
  render(true);
}
