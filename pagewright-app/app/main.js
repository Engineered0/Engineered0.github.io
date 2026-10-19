// Pagewright PDF Editor — bootstrap and wiring.

import { S, on, emit, $, el, formatBytes } from './state.js';
import { icon, fillIcons } from './icons.js';
import { openBytes, undo, redo } from './doc.js';
import { buildPages, setZoom, zoomStep, fitScale, applyFit, scrollToPage, updateCurrentFromScroll, scheduleRender } from './viewer.js';
import { renderAllObjects, registerTextFonts } from './objects.js';
import { renderAllForms } from './forms.js';
import { buildToolbar, setTool, installPointer, installKeys } from './tools.js';
import { render as renderInspector } from './inspector.js';
import { installContextBar } from './contextbar.js';
import { rotatePages, deletePages, movePages, insertBlank, insertFromFile, extractPages } from './thumbs.js';
import { downloadDocument } from './export.js';
import { installSearch, openSearch, closeSearch, installReplace } from './search.js';
import { toast, modal, busy } from './ui.js';
import { isEditingText, commitEditing } from './textedit.js';

// ---------------------------------------------------------------- chrome
function setIcon(id, name) { const b = $(id); b.insertAdjacentHTML('afterbegin', icon(name)); }
fillIcons();
setIcon('#btnSidebar', 'sidebar');
setIcon('#btnInspector', 'inspector');
setIcon('#btnZoomOut', 'zoomOut');
setIcon('#btnZoomIn', 'zoomIn');
setIcon('#btnFit', 'fit');
setIcon('#btnSearch', 'search');
setIcon('#btnSearchPrev', 'up');
setIcon('#btnSearchNext', 'down');
setIcon('#btnUndo', 'undo');
setIcon('#btnRedo', 'redo');
setIcon('#pgRotL', 'rotL');
setIcon('#pgRotR', 'rotR');
setIcon('#pgUp', 'up');
setIcon('#pgDown', 'down');
setIcon('#pgBlank', 'blank');
setIcon('#pgInsert', 'insert');
setIcon('#pgExtract', 'extract');
setIcon('#pgDelete', 'trash');
buildToolbar();

const narrow = () => window.innerWidth <= 860;
function togglePanel(btn, panel, force) {
  const show = force !== undefined ? force : panel.hidden;
  panel.hidden = !show;
  btn.setAttribute('aria-pressed', String(show));
  requestAnimationFrame(() => { applyFit(); });
}
$('#btnSidebar').addEventListener('click', () => togglePanel($('#btnSidebar'), $('#sidebar')));
$('#btnInspector').addEventListener('click', () => togglePanel($('#btnInspector'), $('#inspector')));
// the details panel is optional; the options bar under the tools covers everyday use
togglePanel($('#btnInspector'), $('#inspector'), false);
if (narrow()) togglePanel($('#btnSidebar'), $('#sidebar'), false);
$('#btnHelp').addEventListener('click', showHelp);

function showHelp() {
  const topics = [
    ['editText', 'Change words in the PDF', ['Click <b>Edit Text</b> at the top.', 'Click on the words you want to change.', 'Type your changes. You can pick a colour and size in the bar under the buttons.', 'Press <b>Enter</b> or click <b>Done</b>.']],
    ['scan', 'Change words on a scanned page or photo', ['Open the scan (a PDF, or a photo of a page).', 'Click <b>Edit Text</b>, then click <b>Read the text</b>. Pagewright reads the words on the page. This happens on your computer, so nothing is uploaded.', 'Click the words you want to change and type. New letters are copied from the scan, so they look the same as the rest of the page.', 'Press <b>Enter</b> or click <b>Done</b>.']],
    ['sign', 'Sign the document', ['Click <b>Sign</b>.', 'Draw your signature with the mouse or your finger, or type your name.', 'Click <b>Place signature</b>.', 'Drag it onto the signature line. Drag a corner to make it bigger or smaller.']],
    ['pointer', 'Fill in a form', ['Click <b>Select</b>.', 'Click inside a box on the form and type.', 'Click a tick box to tick it.']],
    ['addText', 'Type new text', ['Click <b>Add Text</b>.', 'Choose a colour and size in the bar under the buttons.', 'Click on the page where you want to type, then type.', 'Click outside the box when you are done.']],
    ['highlight', 'Highlight, underline or cross out', ['Click <b>Highlight</b>.', 'Choose Highlight, Underline or Cross out, and a colour.', 'Drag across the words.']],
    ['note', 'Leave a comment', ['Click <b>Comment</b>.', 'Click on the page where the note should go.', 'Type your comment and click <b>Done</b>.']],
    ['rotR', 'Turn, move, add or delete pages', ['Use the <b>Pages</b> list on the left. (Click <b>Pages</b> at the top if you can’t see it.)', 'Click a page to choose it.', 'Use the buttons above the list: Turn left, Turn right, Move up, Delete and more.']],
    ['undo', 'Fix a mistake', ['Click <b>Undo</b> at the top to take back your last change.', 'You can click it again to go back further.']],
    ['download', 'Save your PDF', ['Click the blue <b>Download</b> button at the top right.', 'Click <b>Download PDF</b>.']],
  ];
  const body = el('div', { class: 'help' });
  topics.forEach(([ico, title, steps], i) => {
    const d = el('details', i === 0 ? { open: true } : {}, el('summary', { html: icon(ico) + `<span>${title}</span>` }), el('ol', { html: steps.map((x) => `<li>${x}</li>`).join('') }));
    body.append(d);
  });
  const links = el('div', { class: 'help-links' }, el('span', {}, 'About Pagewright:'));
  for (const [k, label] of [['privacy', 'Privacy'], ['terms', 'Terms of use'], ['licenses', 'Licenses']]) {
    links.append(el('button', { class: 'linkbtn', onclick: () => { dlg.close(); import('./legal.js').then((m) => m.showAbout(k)); } }, label));
  }
  body.append(links);
  const dlg = modal({ title: 'How do I…?', body, width: 560, actions: [{ label: 'Close', kind: 'primary' }] });
}

$('#btnZoomIn').addEventListener('click', () => zoomStep(1));
$('#btnZoomOut').addEventListener('click', () => zoomStep(-1));
$('#zoomVal').addEventListener('click', () => setZoom(fitScale('width'), { mode: 'width' }));
$('#btnFit').addEventListener('click', () => setZoom(fitScale('page'), { mode: 'page' }));
$('#btnUndo').addEventListener('click', () => undo());
$('#btnRedo').addEventListener('click', () => redo());
$('#btnSearch').addEventListener('click', () => ($('#searchBar').hidden ? openSearch() : closeSearch()));
$('#btnSearchPrev').addEventListener('click', () => import('./search.js').then((m) => m.step(-1)));
$('#btnSearchNext').addEventListener('click', () => import('./search.js').then((m) => m.step(1)));
installSearch();
installReplace();

$('#pgRotL').addEventListener('click', () => rotatePages(-90));
$('#pgRotR').addEventListener('click', () => rotatePages(90));
$('#pgUp').addEventListener('click', () => movePages(-1));
$('#pgDown').addEventListener('click', () => movePages(1));
$('#pgBlank').addEventListener('click', () => insertBlank());
$('#pgInsert').addEventListener('click', () => insertFromFile());
$('#pgExtract').addEventListener('click', () => extractPages());
$('#pgDelete').addEventListener('click', () => deletePages());

// ---------------------------------------------------------------- open / save
const isPdfFile = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
const isImageFile = (f) => /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);

// A photo or scanned picture becomes a one-page PDF (turned the right way up)
async function imageToPdf(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const photo = /jpe?g|webp/i.test(file.type) || /\.(jpe?g|webp)$/i.test(file.name);
  const blob = await new Promise((r) => c.toBlob(r, photo ? 'image/jpeg' : 'image/png', 0.92));
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await PDFLib.PDFDocument.create();
  const img = photo ? await doc.embedJpg(data) : await doc.embedPng(data);
  // the long side becomes 11 inches, like a letter page
  const dpi = Math.max(72, Math.max(bmp.width, bmp.height) / 11);
  const w = (bmp.width * 72) / dpi, h = (bmp.height * 72) / dpi;
  const page = doc.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  return doc.save();
}

async function openFile(file) {
  if (!file) return;
  if (isImageFile(file)) {
    let pdf;
    try { pdf = await imageToPdf(file); } catch (e) { toast(`“${file.name}” couldn't be opened as a picture.`); return; }
    await openBytes(new Uint8Array(pdf), file.name.replace(/\.[^.]+$/, '') + '.pdf');
    return;
  }
  if (!isPdfFile(file)) { toast(`“${file.name}” isn't a PDF or a picture.`); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  await openBytes(bytes, file.name);
}
$('#btnOpen').addEventListener('click', () => { const i = $('#fileInput'); i.value = ''; i.click(); });
$('#fileInput').addEventListener('change', (e) => openFile(e.target.files[0]));

async function save() {
  if (isEditingText()) await commitEditing();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const hasForm = S.formValues.size > 0;
  const body = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    el('p', { style: { margin: 0 } }, 'Text edits and page changes are written into the PDF. Comments, highlights and drawings are saved as standard annotations that other PDF apps can show and edit.'),
    el('label', { class: 'check', for: 'optFlatAnn' }, el('input', { type: 'checkbox', id: 'optFlatAnn' }), el('span', {}, 'Flatten annotations into the page (they can no longer be edited)')),
    hasForm ? el('label', { class: 'check', for: 'optFlatForm' }, el('input', { type: 'checkbox', id: 'optFlatForm' }), el('span', {}, 'Flatten form fields (answers become fixed text)')) : null,
  );
  modal({
    title: `Download “${S.fileName.replace(/\.pdf$/i, '')}.pdf”`, body,
    actions: [
      { label: 'Cancel' },
      { label: 'Download PDF', kind: 'primary', onClick: async (close) => {
        const flattenAnnots = $('#optFlatAnn').checked;
        const flattenForms = hasForm && $('#optFlatForm').checked;
        close('go');
        const ok = await downloadDocument({ flattenAnnots, flattenForms });
        if (ok) toast('Download ready');
        updateTitle();
        return false;
      } },
    ],
  });
}
$('#btnSave').addEventListener('click', save);

installKeys({ save, open: () => $('#btnOpen').click(), find: openSearch });
installPointer();
installContextBar();

// drag and drop a PDF anywhere
let dz = null, dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
window.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; dragDepth++; if (!dz) { dz = el('div', { class: 'dropzone' }, el('div', {}, 'Drop a PDF or a photo to open it')); document.body.append(dz); } });
window.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; dragDepth--; if (dragDepth <= 0 && dz) { dz.remove(); dz = null; dragDepth = 0; } });
window.addEventListener('dragover', (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (dz) { dz.remove(); dz = null; } dragDepth = 0;
  const f = [...e.dataTransfer.files].find((x) => isPdfFile(x) || isImageFile(x));
  if (f) openFile(f); else toast('Drop a PDF or a photo to open it.');
});

window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- state -> UI
function updateTitle() {
  $('#fileName').textContent = S.fileName;
  const meta = $('#fileMeta');
  meta.textContent = '';
  if (S.isSample) meta.append(el('span', { class: 'chip sample' }, 'Sample'), ' ');
  meta.append(`${S.pages.length} page${S.pages.length === 1 ? '' : 's'} · ${formatBytes(S.bytes ? S.bytes.length : 0)}${S.dirty ? ' · edited' : ''}`);
  $('#pageCount').textContent = String(S.pages.length);
}

on('doc-opened', async () => {
  for (const pv of S.pages) pv.el.remove();
  S.pages = [];
  S.currentPage = 0;
  await buildPages();
  S.fitMode = 'width';
  setZoom(fitScale('width'), { mode: 'width' });
  $('#viewer').scrollTo(0, 0);
  updateTitle();
  renderAllForms();
  renderAllObjects();
  setTool(S.tool === 'image' || S.tool === 'sign' ? 'select' : S.tool);
});
on('doc-changed', async ({ structural } = {}) => {
  await buildPages();
  if (structural) applyFit();
  renderAllForms();
  renderAllObjects();
  updateTitle();
});
on('history', () => {
  $('#btnUndo').disabled = !S.undo.length;
  $('#btnRedo').disabled = !S.redo.length;
  updateTitle();
});
on('current-page', (i) => { $('#pageInput').value = String(i + 1); });
on('zoom', () => { $('#zoomVal').textContent = `${Math.round(S.zoom * 100)}%`; });
on('goto-page', (i) => requestAnimationFrame(() => scrollToPage(i)));

$('#pageInput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const n = parseInt(e.target.value, 10);
    if (n >= 1 && n <= S.pages.length) scrollToPage(n - 1); else e.target.value = String(S.currentPage + 1);
    e.target.blur();
  }
});

let scrollRaf = 0;
$('#viewer').addEventListener('scroll', () => {
  cancelAnimationFrame(scrollRaf);
  scrollRaf = requestAnimationFrame(() => { updateCurrentFromScroll(); scheduleRender(60); });
});
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(applyFit, 150); });

// ---------------------------------------------------------------- start
registerTextFonts();
renderInspector();
(async () => {
  try {
    const r = await fetch(new URL('../sample.pdf', import.meta.url));
    if (!r.ok) throw new Error('missing sample');
    const bytes = new Uint8Array(await r.arrayBuffer());
    await openBytes(bytes, 'Calibration Certificate (sample).pdf', { sample: true, skipDirtyCheck: true });
  } catch (e) {
    console.error(e);
    $('#fileName').textContent = 'Open a PDF to start';
    toast('Open a PDF to start editing.');
  }
})();

document.documentElement.lang = 'en';
if (!document.querySelector('h1')) document.body.prepend(Object.assign(document.createElement('h1'), { className: 'sr-only', textContent: 'Pagewright PDF Editor' }));
window.__folio = S; // handy for debugging in the console
