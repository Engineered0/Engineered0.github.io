// Text recognition worker (Tesseract). Uses the WebAssembly build when the page
// is allowed to compile WebAssembly, and the slower plain-JavaScript build otherwise.
/* global TesseractCore, TesseractCoreASM */

let M = null;
let api = null;
let kind = '';

const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

function wasmAllowed() {
  try {
    if (typeof WebAssembly !== 'object') return false;
    // compiling is what a content security policy may forbid
    new WebAssembly.Module(EMPTY_MODULE);
    return WebAssembly.validate(SIMD_TEST);
  } catch (e) { return false; }
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to unpack the text reader.');
  const ds = new DecompressionStream('gzip');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function init(base) {
  if (api) return { kind };
  const useWasm = wasmAllowed();
  if (useWasm) {
    importScripts(`${base}tesseract-core-simd-lstm.wasm.js`);
    M = await TesseractCore({ print: () => {}, printErr: () => {} });
    kind = 'wasm';
  } else {
    importScripts(`${base}tesseract-core.asm.js`);
    M = await new Promise((resolve, reject) => {
      const m = TesseractCoreASM({ print: () => {}, printErr: () => {}, onAbort: (e) => reject(new Error(String(e))) });
      // the module object is "thenable"; unwrap it once to avoid an endless resolve loop
      m.then((x) => { delete x.then; resolve(x); });
    });
    kind = 'asm';
  }
  const r = await fetch(`${base}eng.traineddata.gz.b64.txt`);
  if (!r.ok) throw new Error('The text reader’s language file is missing.');
  const b64 = (await r.text()).trim();
  const bin = atob(b64);
  const gz = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const data = await gunzip(gz);
  try { M.FS.mkdir('/tessdata'); } catch (e) { /* exists */ }
  M.FS.writeFile('/tessdata/eng.traineddata', data);
  api = new M.TessBaseAPI();
  const status = api.Init('/tessdata', 'eng', 1); // 1 = LSTM only
  if (status !== 0) throw new Error('The text reader could not start.');
  return { kind };
}

function recognize(args) {
  const { w, h, gray, dpi } = args;
  const px = new Uint8Array(gray);
  api.SetVariable('user_defined_dpi', String(Math.round(dpi)));
  api.SetVariable('tessedit_pageseg_mode', '3');
  let ptr = 0;
  if (typeof api.SetImageFile === 'function') {
    const head = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
    const pgm = new Uint8Array(head.length + px.length);
    pgm.set(head, 0); pgm.set(px, head.length);
    M.FS.writeFile('/input', pgm);
    if (api.SetImageFile(1, 0) === 1) throw new Error('The page image could not be read.');
  } else {
    ptr = M._malloc(px.length);
    M.HEAPU8.set(px, ptr);
    api.SetImage(ptr, w, h, 1, w);
  }
  try {
    api.Recognize(null);
    const main = api.GetHOCRText(0);
    let sparse = null;
    if (args.sparse) {
      // a second look for text the page layout pass skipped (table cells, labels, stamps)
      api.SetVariable('tessedit_pageseg_mode', '11');
      api.Recognize(null);
      sparse = api.GetHOCRText(0);
    }
    return { main, sparse };
  } finally {
    api.Clear();
    if (ptr) M._free(ptr);
    try { M.FS.unlink('/input'); } catch (e) { /* not there */ }
  }
}

self.onmessage = async (e) => {
  const { id, cmd, args } = e.data;
  try {
    let result;
    if (cmd === 'init') result = await init(args.base);
    else if (cmd === 'recognize') result = recognize(args);
    else throw new Error(`Unknown command ${cmd}`);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
