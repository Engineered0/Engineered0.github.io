// Builds the downloadable PDF: annotations with appearance streams,
// added text / images / whiteout flattened into page content, form values.
// Also re-imports annotations Pagewright wrote earlier so they stay editable.

import { S, hexToRgb } from './state.js';
import { E, loadFontBytes } from './doc.js';
import { fontKeyFor, arrowHead } from './objects.js';
import { toast, busy } from './ui.js';

const L = () => window.PDFLib || globalThis.PDFLib;
const N = (n) => L().PDFName.of(n);
const f = (n) => { if (!isFinite(n)) return '0'; const s = (+n).toFixed(4).replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' ? '0' : s; };
const rgbOp = (hex, op = 'rg') => { const c = hexToRgb(hex) || [0, 0, 0]; return `${f(c[0])} ${f(c[1])} ${f(c[2])} ${op}`; };
const pdfStr = (s) => L().PDFHexString.fromText(s || '');
const pdfDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  const t = d instanceof Date ? d : new Date(d || Date.now());
  return L().PDFString.of(`D:${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`);
};

function bbox(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

// quadratic-smoothed polyline as cubic Béziers (matches the on-screen drawing)
function inkPath(p) {
  const pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
  if (!pts.length) return '';
  if (pts.length < 3) return `${f(pts[0][0])} ${f(pts[0][1])} m ` + (pts.length === 1 ? `${f(pts[0][0] + 0.01)} ${f(pts[0][1])} l` : `${f(pts[1][0])} ${f(pts[1][1])} l`);
  let d = `${f(pts[0][0])} ${f(pts[0][1])} m`;
  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const q = pts[i], end = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
    const c1 = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])];
    const c2 = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])];
    d += ` ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(end[0])} ${f(end[1])} c`;
    cur = end;
  }
  const l = pts[pts.length - 1];
  return d + ` ${f(l[0])} ${f(l[1])} l`;
}

function ellipsePath(x0, y0, x1, y1) {
  const k = 0.5522847498;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  return `${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + k * ry)} ${f(cx + k * rx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c `
    + `${f(cx - k * rx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + k * ry)} ${f(cx - rx)} ${f(cy)} c `
    + `${f(cx - rx)} ${f(cy - k * ry)} ${f(cx - k * rx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c `
    + `${f(cx + k * rx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - k * ry)} ${f(cx + rx)} ${f(cy)} c h`;
}

// Appearance content (in page coordinates) and annotation entries for an object
function appearance(o) {
  const op = o.opacity ?? 1;
  const gs = op < 1 || (o.type === 'markup' && o.kind === 'highlight');
  let content = '';
  let rect;
  const ext = {};
  if (gs) ext.GS0 = { Type: 'ExtGState', CA: op, ca: op, ...(o.type === 'markup' && o.kind === 'highlight' ? { BM: 'Multiply' } : {}) };
  const pre = gs ? '/GS0 gs ' : '';
  if (o.type === 'markup') {
    const pts = o.quads.flatMap((q) => [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]);
    rect = bbox(pts, 1);
    if (o.kind === 'highlight') {
      content = `${pre}${rgbOp(o.color)} ` + o.quads.map((q) => `${f(q[0])} ${f(q[1])} m ${f(q[2])} ${f(q[3])} l ${f(q[6])} ${f(q[7])} l ${f(q[4])} ${f(q[5])} l h`).join(' ') + ' f';
    } else {
      const t = o.kind === 'underline' ? 0.93 : 0.52;
      content = `${pre}${rgbOp(o.color, 'RG')} `;
      for (const q of o.quads) {
        const h = Math.hypot(q[4] - q[0], q[5] - q[1]);
        const a = [q[0] + (q[4] - q[0]) * t, q[1] + (q[5] - q[1]) * t], b = [q[2] + (q[6] - q[2]) * t, q[3] + (q[7] - q[3]) * t];
        content += `${f(Math.max(0.5, h * 0.07))} w ${f(a[0])} ${f(a[1])} m ${f(b[0])} ${f(b[1])} l S `;
      }
    }
    const sub = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut' }[o.kind];
    return { sub, rect, content, ext, extra: { QuadPoints: o.quads.flat(), C: hexToRgb(o.color) } };
  }
  if (o.type === 'ink') {
    const pts = []; for (const p of o.paths) for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]);
    rect = bbox(pts, o.width / 2 + 1);
    content = `${pre}${rgbOp(o.stroke, 'RG')} ${f(o.width)} w 1 J 1 j ` + o.paths.map(inkPath).join(' S ') + ' S';
    return { sub: 'Ink', rect, content, ext, extra: { InkList: o.paths, C: hexToRgb(o.stroke), BS: { W: o.width, S: 'S' } } };
  }
  if (o.type === 'rect' || o.type === 'ellipse') {
    const w = o.stroke ? o.width : 0;
    rect = [o.x0 - w / 2 - 1, o.y0 - w / 2 - 1, o.x1 + w / 2 + 1, o.y1 + w / 2 + 1];
    const path = o.type === 'rect' ? `${f(o.x0)} ${f(o.y0)} ${f(o.x1 - o.x0)} ${f(o.y1 - o.y0)} re` : ellipsePath(o.x0, o.y0, o.x1, o.y1);
    const paint = o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S';
    content = `${pre}${o.fill ? rgbOp(o.fill) + ' ' : ''}${o.stroke ? rgbOp(o.stroke, 'RG') + ` ${f(w)} w ` : ''}0 j ${path} ${paint}`;
    const extra = { BS: { W: w, S: 'S' } };
    if (o.stroke) extra.C = hexToRgb(o.stroke); else extra.C = [];
    if (o.fill) extra.IC = hexToRgb(o.fill);
    return { sub: o.type === 'rect' ? 'Square' : 'Circle', rect, content, ext, extra };
  }
  if (o.type === 'line') {
    const head = o.arrow ? arrowHead(o.x1, o.y1, o.x2, o.y2, o.width) : null;
    const pts = [[o.x1, o.y1], [o.x2, o.y2], ...(head || [])];
    rect = bbox(pts, o.width + 2);
    content = `${pre}${rgbOp(o.stroke, 'RG')} ${f(o.width)} w 1 J 1 j ${f(o.x1)} ${f(o.y1)} m ${f(o.x2)} ${f(o.y2)} l S`;
    if (head) content += ` ${f(head[0][0])} ${f(head[0][1])} m ${f(head[1][0])} ${f(head[1][1])} l ${f(head[2][0])} ${f(head[2][1])} l S`;
    return { sub: 'Line', rect, content, ext, extra: { L: [o.x1, o.y1, o.x2, o.y2], LE: [N('None'), N(o.arrow ? 'OpenArrow' : 'None')], C: hexToRgb(o.stroke), BS: { W: o.width, S: 'S' } } };
  }
  if (o.type === 'note') {
    const s = 20;
    rect = [o.x - s / 2, o.y - s / 2, o.x + s / 2, o.y + s / 2];
    const [x0, y0] = rect;
    content = `${rgbOp(o.color)} 0.25 0.25 0.25 RG 0.8 w ${f(x0 + 1)} ${f(y0 + 1)} ${f(s - 2)} ${f(s - 2)} re B `
      + `0.25 0.25 0.25 RG 1 w ${f(x0 + 5)} ${f(y0 + 13)} m ${f(x0 + 15)} ${f(y0 + 13)} l S ${f(x0 + 5)} ${f(y0 + 9.5)} m ${f(x0 + 15)} ${f(y0 + 9.5)} l S ${f(x0 + 5)} ${f(y0 + 6)} m ${f(x0 + 12)} ${f(y0 + 6)} l S`;
    return { sub: 'Text', rect, content, ext: {}, extra: { Name: 'Comment', C: hexToRgb(o.color), Open: false } };
  }
  return null;
}

function addResources(ctx, page, { fonts = {}, xobjects = {}, ext = {} }) {
  const node = page.node;
  let res = node.Resources();
  if (!res) { res = ctx.obj({}); node.set(N('Resources'), res); }
  const sub = (key) => {
    let d = res.lookup ? res.lookupMaybe(N(key), L().PDFDict) : null;
    if (!d) { d = ctx.obj({}); res.set(N(key), d); }
    return d;
  };
  const names = {};
  const put = (dict, prefix, entries) => {
    for (const [want, value] of Object.entries(entries)) {
      let i = 1, name = `${prefix}${i}`;
      while (dict.has(N(name))) name = `${prefix}${++i}`;
      dict.set(N(name), value instanceof L().PDFObject || value instanceof L().PDFRef ? value : ctx.obj(value));
      names[want] = name;
    }
  };
  if (Object.keys(fonts).length) put(sub('Font'), 'FoF', fonts);
  if (Object.keys(xobjects).length) put(sub('XObject'), 'FoX', xobjects);
  if (Object.keys(ext).length) put(sub('ExtGState'), 'FoG', ext);
  return names;
}

// Append a content stream; pdf-lib wraps the existing content in q/Q first
// (page normalisation), so our drawing starts from the default coordinate system.
function appendContent(ctx, page, content) {
  const ref = ctx.register(ctx.flateStream(new TextEncoder().encode(content)));
  page.node.addContentStream(ref);
}

function renameRes(content, names) {
  return content.replace(/\/(GS0|F_[A-Za-z0-9]+|IM0)\b/g, (m, k) => (names[k] ? `/${names[k]}` : m));
}

async function drawTextObject(doc, page, o, fontsCache) {
  const ctx = doc.context;
  const key = fontKeyFor(o);
  if (!fontsCache.has(key)) fontsCache.set(key, new E.EmbeddedTTF(doc, key, await loadFontBytes(key)));
  const font = fontsCache.get(key);
  const R = ((o.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(R), sin = Math.sin(R);
  const right = [cos, sin], down = [sin, -cos];
  const asc = font.metrics.ascent / 1000, desc = font.metrics.descent / 1000; // desc < 0
  const lh = 1.2;
  const half = (lh - (asc - desc)) / 2;
  const lines = (o.text || '').split('\n');
  const op = o.opacity ?? 1;
  const ext = op < 1 ? { GS0: { Type: 'ExtGState', ca: op, CA: op } } : {};
  // characters the chosen font lacks fall back to DejaVu Sans
  const needDv = lines.some((l) => [...l].some((ch) => ch.trim() && !font.has(ch)));
  let dv = null;
  if (needDv) {
    if (!fontsCache.has('DejaVuSans')) fontsCache.set('DejaVuSans', new E.EmbeddedTTF(doc, 'DejaVuSans', await loadFontBytes('DejaVuSans')));
    dv = fontsCache.get('DejaVuSans');
  }
  const names = addResources(ctx, page, { fonts: dv ? { F_T: font.ref, F_D: dv.ref } : { F_T: font.ref }, ext });
  let c = 'q\n' + (op < 1 ? `/${names.GS0} gs\n` : '') + `BT\n${rgbOp(o.color)}\n`;
  lines.forEach((line, i) => {
    const off = (half + asc + i * lh) * o.size;
    const ox = o.ax + down[0] * off, oy = o.ay + down[1] * off;
    c += `${f(right[0])} ${f(right[1])} ${f(-right[1])} ${f(right[0])} ${f(ox)} ${f(oy)} Tm\n`;
    // split into runs per font
    let run = '', runFont = null;
    const flush = () => { if (!run) return; const fo = runFont === 'D' ? dv : font; c += `/${names[runFont === 'D' ? 'F_D' : 'F_T']} ${f(o.size)} Tf ${fo.encode(run)} Tj\n`; run = ''; };
    for (const ch of line) {
      const which = font.has(ch) || !ch.trim() || !dv || !dv.has(ch) ? 'T' : 'D';
      if (which !== runFont) { flush(); runFont = which; }
      run += ch;
    }
    flush();
  });
  c += 'ET\nQ\n';
  appendContent(ctx, page, c);
}

async function drawImageObject(doc, page, o, imgCache) {
  const ctx = doc.context;
  const img = S.images.get(o.img);
  if (!img) return;
  if (!imgCache.has(o.img)) imgCache.set(o.img, img.mime === 'image/jpeg' ? await doc.embedJpg(img.bytes) : await doc.embedPng(img.bytes));
  const emb = imgCache.get(o.img);
  const R = ((o.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(R), sin = Math.sin(R);
  const down = [sin, -cos];
  const bl = [o.ax + down[0] * o.h, o.ay + down[1] * o.h];
  const op = o.opacity ?? 1;
  const ext = op < 1 ? { GS0: { Type: 'ExtGState', ca: op, CA: op } } : {};
  const names = addResources(ctx, page, { xobjects: { IM0: emb.ref }, ext });
  const c = `q\n${op < 1 ? `/${names.GS0} gs\n` : ''}${f(o.w * cos)} ${f(o.w * sin)} ${f(-o.h * sin)} ${f(o.h * cos)} ${f(bl[0])} ${f(bl[1])} cm /${names.IM0} Do\nQ\n`;
  appendContent(ctx, page, c);
}

function addAnnotation(doc, page, o, a) {
  const ctx = doc.context;
  const resources = {};
  if (Object.keys(a.ext).length) resources.ExtGState = a.ext;
  const ap = ctx.flateStream(new TextEncoder().encode(a.content), { Type: 'XObject', Subtype: 'Form', BBox: a.rect, Resources: resources });
  const apRef = ctx.register(ap);
  const data = JSON.parse(JSON.stringify(o));
  delete data.page;
  const dict = {
    Type: 'Annot', Subtype: a.sub, Rect: a.rect, F: 4, NM: L().PDFString.of(`folio-${o.id}`), M: pdfDate(new Date()),
    AP: { N: apRef }, T: pdfStr(o.author || S.author),
    Contents: pdfStr(o.type === 'note' ? o.text : o.text || ''),
    FolioData: pdfStr(JSON.stringify(data)),
    ...a.extra,
  };
  if (o.opacity !== undefined && o.opacity < 1) dict.CA = o.opacity;
  if (a.sub !== 'Text') dict.CreationDate = pdfDate(o.date || new Date());
  const ref = ctx.register(ctx.obj(dict));
  page.node.addAnnot(ref);
  if (a.sub === 'Text') {
    const [x0, , , y1] = a.rect;
    const popup = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Popup', Rect: [x0 + 24, y1 - 120, x0 + 224, y1], Parent: ref, Open: false, F: 28 }));
    ctx.lookup(ref).set(N('Popup'), popup);
    page.node.addAnnot(popup);
  }
}

function applyForms(doc) {
  if (!S.formValues.size) return { touched: 0 };
  const Lib = L();
  let form;
  try { form = doc.getForm(); } catch (e) { return { touched: 0 }; }
  let touched = 0, needApp = false;
  const winAnsiOk = (s) => /^[\x20-\x7e\xa0-\xff\n\r\t€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]*$/.test(s);
  for (const [name, v] of S.formValues) {
    let fld;
    try { fld = form.getField(name); } catch (e) { continue; }
    try {
      if (fld instanceof Lib.PDFTextField) {
        const s = Array.isArray(v) ? v.join(', ') : String(v ?? '');
        const max = fld.getMaxLength();
        fld.setText(max !== undefined && s.length > max ? s.slice(0, max) : s);
        if (!winAnsiOk(s)) { form.markFieldAsClean(fld.ref); needApp = true; }
      } else if (fld instanceof Lib.PDFCheckBox) {
        if (v && v !== 'Off') fld.check(); else fld.uncheck();
      } else if (fld instanceof Lib.PDFRadioGroup) {
        if (v && v !== 'Off') fld.select(v); else fld.clear();
      } else if (fld instanceof Lib.PDFDropdown) {
        if (v) fld.select(v); else fld.clear();
        if (v && !winAnsiOk(String(v))) { form.markFieldAsClean(fld.ref); needApp = true; }
      } else if (fld instanceof Lib.PDFOptionList) {
        fld.select(Array.isArray(v) ? v : [v]);
      }
      touched++;
    } catch (e) {
      console.warn('form field', name, e);
      try {
        fld.acroField.dict.set(N('V'), Array.isArray(v) ? doc.context.obj(v.map((x) => pdfStr(x))) : pdfStr(String(v)));
        form.markFieldAsClean(fld.ref);
        needApp = true;
      } catch (e2) { /* give up on this field */ }
    }
  }
  if (needApp) form.acroForm.dict.set(N('NeedAppearances'), L().PDFBool.True);
  return { touched, needApp, form };
}

// Build the final PDF bytes. pageKeys limits output to those pages (extract).
// Put one added picture into the page itself (so its text can be read)
export async function flattenImageObject(doc, page, o) { await drawImageObject(doc, page, o, new Map()); }

export async function buildOutput({ flattenAnnots = false, flattenForms = false, pageKeys = null } = {}) {
  const Lib = L();
  const doc = await Lib.PDFDocument.load(S.bytes, { updateMetadata: false });
  const fonts = new Map(), imgs = new Map();
  const formInfo = applyForms(doc);
  const pages = doc.getPages();
  const byKey = new Map(pages.map((p) => [p.ref.toString(), p]));
  // draw in a stable order: whiteout first, then text/images, then annotations
  const order = { rect: 1, ellipse: 1, image: 2, text: 3 };
  const objs = [...S.objects.values()].sort((a, b) => (order[a.type] || 9) - (order[b.type] || 9));
  for (const o of objs) {
    const page = byKey.get(o.page);
    if (!page) continue;
    if (o.type === 'text') { if ((o.text || '').trim()) await drawTextObject(doc, page, o, fonts); continue; }
    if (o.type === 'image') { await drawImageObject(doc, page, o, imgs); continue; }
    const a = appearance(o);
    if (!a) continue;
    if (flattenAnnots || o.flatten) {
      const names = addResources(doc.context, page, { ext: a.ext });
      appendContent(doc.context, page, `q\n${renameRes(a.content, names)}\nQ\n`);
    } else addAnnotation(doc, page, o, a);
  }
  for (const font of fonts.values()) font.flush();
  if (flattenForms && formInfo.form) {
    try { formInfo.form.flatten({ updateFieldAppearances: !formInfo.needApp }); } catch (e) { console.warn('flatten failed', e); toast('Some form fields could not be flattened and were left fillable.'); }
  }
  try { doc.setModificationDate(new Date()); } catch (e) { /* ignore */ }
  let out = doc;
  if (pageKeys) {
    out = await Lib.PDFDocument.create();
    const idx = pages.map((p, i) => (pageKeys.includes(p.ref.toString()) ? i : -1)).filter((i) => i >= 0);
    const copied = await out.copyPages(doc, idx);
    copied.forEach((p) => out.addPage(p));
  }
  return out.save({ useObjectStreams: true, updateFieldAppearances: !formInfo.needApp });
}

// ---------------------------------------------------------------- download
export async function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) {
      await dl.save({ filename, data: blob });
      return true;
    }
  } catch (e) {
    if (e && e.code === 'declined') return false;
    if (e && e.code && e.code !== 'unavailable' && e.code !== 'not_granted') { toast(`Download failed: ${e.message || e.code}`); return false; }
  }
  // Outside the Claude viewer: an ordinary download link
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

export function outputName(suffix = '') {
  const base = S.fileName.replace(/\.pdf$/i, '');
  return `${base}${suffix}.pdf`;
}

// ---------------------------------------------------------------- import
export function importOwnAnnotations(doc) {
  const Lib = L();
  const objects = [];
  const ctx = doc.context;
  let count = 0;
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const key = page.ref.toString();
    const remove = [];
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const d = ctx.lookup(ref);
      if (!(d instanceof Lib.PDFDict)) continue;
      const nm = d.lookup(N('NM'));
      const data = d.lookup(N('FolioData'));
      const parent = d.lookup(N('Parent'));
      if (parent instanceof Lib.PDFDict && parent.lookup(N('FolioData'))) { remove.push(i); continue; }
      if (!nm || !data) continue;
      const name = nm.decodeText ? nm.decodeText() : '';
      if (!name.startsWith('folio-')) continue;
      try {
        const o = JSON.parse(data.decodeText());
        o.page = key;
        if (!o.id) o.id = name.slice(6);
        // pick up comment edits made in other viewers
        const contents = d.lookup(N('Contents'));
        if (o.type === 'note' && contents && contents.decodeText) o.text = contents.decodeText();
        objects.push(o);
        remove.push(i);
        count++;
      } catch (e) { /* leave it as a normal annotation */ }
    }
    for (const i of remove.sort((a, b) => b - a)) annots.remove(i);
  }
  return { objects, images: new Map(), count };
}

export async function downloadDocument(opts = {}) {
  const done = busy('Preparing download…');
  try {
    const bytes = await buildOutput(opts);
    done();
    const ok = await downloadBytes(bytes, outputName(opts.pageKeys ? '-extract' : ''));
    if (ok && !opts.pageKeys) { S.dirty = false; }
    return ok;
  } catch (e) {
    done();
    console.error(e);
    toast(`Couldn't build the PDF: ${e.message || e}`, { ms: 6000 });
    return false;
  }
}
