// Document lifecycle: opening, the working pdf-lib copy, pdf.js rendering
// proxy, undo/redo history and the text-analysis cache.

import * as pdfjsLib from '../vendor/pdf.min.mjs';
import * as E from '../engine/index.js';
import { S, emit } from './state.js';
import { busy, toast, passwordDialog, confirmDialog } from './ui.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
export { pdfjsLib, E };

const VENDOR = new URL('../vendor/', import.meta.url).href;

// ---------------------------------------------------------------- fonts
const fontCache = new Map();
export function loadFontBytes(key) {
  if (!fontCache.has(key)) {
    fontCache.set(key, fetch(new URL(`../fonts/${key}.ttf`, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`Font ${key} unavailable`);
      return r.arrayBuffer();
    }).then((b) => new Uint8Array(b)).catch((e) => { fontCache.delete(key); throw e; }));
  }
  return fontCache.get(key);
}

// ---------------------------------------------------------------- pdf.js
// CMaps and standard fonts ship as base64 text files (the host serves a fixed
// set of file types), so pdf.js gets them through these small factories.
async function fetchB64(url) {
  const r = await fetch(url + '.b64.txt');
  if (!r.ok) throw new Error(`Missing ${url}`);
  const bin = atob((await r.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
class CMapFactory {
  constructor({ baseUrl = null, isCompressed = true }) { this.baseUrl = baseUrl; this.isCompressed = isCompressed; }
  async fetch({ name }) {
    const cMapData = await fetchB64(`${this.baseUrl}${name}.bcmap`);
    return { cMapData, isCompressed: true };
  }
}
class StdFontFactory {
  constructor({ baseUrl = null }) { this.baseUrl = baseUrl; }
  async fetch({ filename }) { return fetchB64(`${this.baseUrl}${filename}`); }
}
let loadingTask = null;
export async function reloadPdf() {
  const old = S.pdf;
  loadingTask = pdfjsLib.getDocument({
    data: S.bytes.slice(),
    cMapUrl: VENDOR + 'cmaps/', cMapPacked: true,
    standardFontDataUrl: VENDOR + 'standard_fonts/',
    CMapReaderFactory: CMapFactory, StandardFontDataFactory: StdFontFactory, useWorkerFetch: false,
    fontExtraProperties: true,
    isEvalSupported: false,
    enableXfa: false,
  });
  const pdf = await loadingTask.promise;
  S.pdf = pdf;
  if (old) setTimeout(() => old.destroy().catch(() => {}), 1500);
  return pdf;
}

export function pageKeyAt(i) { return S.doc.getPage(i).ref.toString(); }
export function pageIndexOf(key) {
  const n = S.doc.getPageCount();
  for (let i = 0; i < n; i++) if (S.doc.getPage(i).ref.toString() === key) return i;
  return -1;
}

// ---------------------------------------------------------------- analysis cache
const analysis = new Map();
export function analyze(pageIndex) {
  const key = `${pageKeyAt(pageIndex)}@${S.version}`;
  if (!analysis.has(key)) {
    let res;
    try { res = E.analyzeText(S.doc, pageIndex); } catch (e) { console.error('analysis failed', e); res = { groups: [], fonts: [], error: e }; }
    analysis.set(key, res);
  }
  return analysis.get(key);
}
function clearAnalysis() { analysis.clear(); }

// ---------------------------------------------------------------- history
function snapshot() {
  return {
    bytes: S.bytes,
    objects: JSON.stringify([...S.objects.values()]),
    formValues: JSON.stringify([...S.formValues]),
  };
}
function pushUndo() {
  S.undo.push(snapshot());
  if (S.undo.length > 60) S.undo.shift();
  S.redo.length = 0;
  S.dirty = true;
  emit('history');
}

async function restore(snap) {
  const done = busy('Restoring…');
  try {
    if (snap.bytes !== S.bytes) {
      S.doc = await PDFLib.PDFDocument.load(snap.bytes, { updateMetadata: false });
      S.bytes = snap.bytes;
      S.version++;
      clearAnalysis();
      await reloadPdf();
      S.objects = new Map(JSON.parse(snap.objects).map((o) => [o.id, o]));
      S.formValues = new Map(JSON.parse(snap.formValues));
      emit('doc-changed', { structural: true });
    } else {
      S.objects = new Map(JSON.parse(snap.objects).map((o) => [o.id, o]));
      S.formValues = new Map(JSON.parse(snap.formValues));
      emit('objects-changed');
      emit('forms-changed');
    }
    S.selection = null;
    emit('selection');
  } finally { done(); }
}

export async function undo() {
  if (!S.undo.length) return;
  const snap = S.undo.pop();
  S.redo.push(snapshot());
  await restore(snap);
  emit('history');
}
export async function redo() {
  if (!S.redo.length) return;
  const snap = S.redo.pop();
  S.undo.push(snapshot());
  await restore(snap);
  emit('history');
}

// Change overlay objects / form values (cheap, no document rewrite)
export function changeObjects(fn, { record = true } = {}) {
  if (record) pushUndo(); else S.dirty = true;
  fn();
  emit('objects-changed');
}
export function recordUndo() { pushUndo(); }

// Change the working PDF itself (text edits, page operations)
let docQueue = Promise.resolve();
export function docSettled() { return docQueue.then(() => {}, () => {}); }
export function changeDoc(fn, { message = 'Updating…', structural = false } = {}) {
  const run = async () => {
    const done = busy(message);
    const before = snapshot();
    try {
      const result = await fn(S.doc);
      if (result === false) return false;
      const bytes = await S.doc.save({ useObjectStreams: false, updateFieldAppearances: false, addDefaultPage: false });
      S.undo.push(before);
      if (S.undo.length > 60) S.undo.shift();
      S.redo.length = 0;
      S.dirty = true;
      S.bytes = bytes;
      S.version++;
      clearAnalysis();
      await reloadPdf();
      emit('doc-changed', { structural });
      emit('history');
      return result;
    } catch (e) {
      console.error(e);
      toast(`That change could not be applied: ${e.message || e}`);
      // roll back to the last good state
      try {
        S.doc = await PDFLib.PDFDocument.load(before.bytes, { updateMetadata: false });
        S.bytes = before.bytes; S.version++; clearAnalysis();
        await reloadPdf();
        emit('doc-changed', { structural: true });
      } catch (e2) { console.error(e2); }
      return false;
    } finally { done(); }
  };
  docQueue = docQueue.then(run, run);
  return docQueue;
}

// ---------------------------------------------------------------- open
export async function openBytes(bytes, name, { sample = false, skipDirtyCheck = false } = {}) {
  if (S.dirty && !skipDirtyCheck) {
    const ok = await confirmDialog('Discard changes?', `Your edits to “${S.fileName}” haven't been downloaded yet. Opening another file will discard them.`, 'Open anyway');
    if (!ok) return false;
  }
  let password = '';
  let res;
  for (;;) {
    const done = busy('Opening…');
    try {
      res = await E.loadDocument(bytes, password);
      done();
      break;
    } catch (e) {
      done();
      if (e && e.name === 'PasswordRequiredError' || e instanceof E.PasswordRequiredError) {
        const pw = await passwordDialog(name, !!password);
        if (pw === null) return false;
        password = pw;
        continue;
      }
      console.error(e);
      toast(e instanceof E.UnsupportedEncryptionError ? `This PDF uses a security handler Pagewright can't open (${e.message.replace(/^.*: /, '')}).` : `Couldn't open “${name}”. The file may be damaged or not a PDF.`, { ms: 6000 });
      return false;
    }
  }
  const done = busy('Preparing pages…');
  try {
    const { doc, wasEncrypted } = res;
    const { importOwnAnnotations } = await import('./export.js');
    const imported = importOwnAnnotations(doc);
    let out = bytes;
    if (wasEncrypted || imported.count) out = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    S.doc = wasEncrypted || imported.count ? await PDFLib.PDFDocument.load(out, { updateMetadata: false }) : doc;
    S.bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
    S.fileName = name;
    S.isSample = sample;
    S.wasEncrypted = wasEncrypted;
    S.objects = new Map(imported.objects.map((o) => [o.id, o]));
    for (const [id, img] of imported.images) S.images.set(id, img);
    S.formValues = new Map();
    S.undo.length = 0; S.redo.length = 0;
    S.dirty = false;
    S.selection = null;
    S.pageSel = new Set();
    S.version++;
    clearAnalysis();
    await reloadPdf();
    emit('doc-opened');
    emit('history');
    if (wasEncrypted) toast('Security removed for editing. The downloaded copy will not be password-protected.', { ms: 6000 });
    else if (hasDigitalSignature(S.doc)) toast('This PDF is digitally signed. Any change will invalidate the signature.', { ms: 7000 });
    return true;
  } catch (e) {
    console.error(e);
    toast(`Couldn't open “${name}”: ${e.message || e}`, { ms: 6000 });
    return false;
  } finally { done(); }
}

function hasDigitalSignature(doc) {
  try {
    const form = doc.catalog.lookupMaybe(PDFLib.PDFName.of('AcroForm'), PDFLib.PDFDict);
    if (!form) return false;
    const flags = form.lookupMaybe(PDFLib.PDFName.of('SigFlags'), PDFLib.PDFNumber);
    if (flags && (flags.asNumber() & 1)) return true;
    for (const f of doc.getForm().getFields()) {
      if (f instanceof PDFLib.PDFSignature && f.acroField.dict.get(PDFLib.PDFName.of('V'))) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}
