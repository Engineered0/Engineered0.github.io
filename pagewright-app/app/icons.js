// Stroke icons on a 24-unit grid.
const P = {
  open: '<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9.5A1.5 1.5 0 0 0 19.5 8H12l-2-2.5H4.5A1.5 1.5 0 0 0 3 7Z"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5"/><path class="f" d="M4.5 17.5h15v3h-15Z"/><path d="M4.5 17.5v3h15v-3"/>',
  undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-3"/>',
  redo: '<path d="m15 14 4.5-4.5L15 5"/><path d="M19.5 9.5H10a5.5 5.5 0 0 0 0 11h3"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M10.5 7.5v6M7.5 10.5h6"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M7.5 10.5h6"/>',
  fit: '<path d="M8 3.5H4.5a1 1 0 0 0-1 1V8M16 3.5h3.5a1 1 0 0 1 1 1V8M8 20.5H4.5a1 1 0 0 1-1-1V16M16 20.5h3.5a1 1 0 0 0 1-1V16"/><rect x="8" y="7.5" width="8" height="9" rx="1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/>',
  inspector: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M14.5 4.5v15M16.8 8.5h1.7M16.8 11.5h1.7"/>',
  select: '<path class="f" d="M6 3.5 18.5 12l-5.6 1.4-2.9 5.6Z"/><path d="M6 3.5 18.5 12l-5.6 1.4-2.9 5.6Z"/>',
  hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5V4a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V12m0-4a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-1.3a6 6 0 0 1-4.6-2.2L5 16.5a1.6 1.6 0 0 1 2.4-2.1L8 15"/>',
  editText: '<path d="M3.5 6.5v-2h11v2M9 4.5v13M7 17.5h4"/><path class="f" d="m14.6 20 .9-3.6 4.7-4.7a1.6 1.6 0 0 1 2.3 2.3l-4.7 4.7Z"/><path d="m14.6 20 .9-3.6 4.7-4.7a1.6 1.6 0 0 1 2.3 2.3l-4.7 4.7Z"/>',
  addText: '<rect class="f" x="3" y="3.5" width="18" height="17" rx="3"/><rect x="3" y="3.5" width="18" height="17" rx="3"/><path d="M8 9V8h8v1M12 8v8.5M10 16.5h4"/>',
  highlight: '<path class="f" d="m9 14.5 6.6-9.4a1.6 1.6 0 0 1 2.4-.3l1.3 1.1a1.6 1.6 0 0 1 .2 2.3L12 15.5Z"/><path d="m9 14.5 6.6-9.4a1.6 1.6 0 0 1 2.4-.3l1.3 1.1a1.6 1.6 0 0 1 .2 2.3L12 15.5"/><path d="m9 14.5-1.5 3H11l1-2Z"/><path d="M3.5 20.5h17" stroke-width="3"/>',
  underline: '<path d="M7 4.5v6a5 5 0 0 0 10 0v-6M5.5 20h13"/>',
  strike: '<path d="M16.5 7.5c-.6-1.8-2.4-3-4.6-3-2.6 0-4.4 1.4-4.4 3.4 0 1.5 1 2.4 2.7 3M4.5 12h15M14.5 13.5c1.3.6 2 1.5 2 2.8 0 2-2 3.4-4.6 3.4-2.4 0-4.3-1.1-4.9-3"/>',
  draw: '<path d="M4 19c3-1 4.5-6 7-6s2 4 4.5 4 3-4 4.5-6"/><path class="f" d="m14.5 3.5 5 5-2 2-5-5Z"/><path d="m14.5 3.5 5 5-2 2-5-5Z"/>',
  rect: '<rect x="4" y="5.5" width="16" height="13" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  line: '<path d="M5 19 19 5"/>',
  arrow: '<path d="M5 19 19 5M10.5 5H19v8.5"/>',
  note: '<path class="f" d="M5 4.5h14a1 1 0 0 1 1 1V15l-5 4.5H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z"/><path d="M5 4.5h14a1 1 0 0 1 1 1V15l-5 4.5H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z"/><path d="M20 15h-4a1 1 0 0 0-1 1v3.5M8 9h8M8 12.5h5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path class="f" d="m20.5 16-5-5-8.5 8.5h12a1.5 1.5 0 0 0 1.5-1.5Z"/><circle cx="9" cy="10" r="1.7"/><path d="m20.5 16-5-5-8.5 8.5"/>',
  sign: '<path d="M3.5 16.5c2.5-3 4-8.5 2.5-9s-3 7 .5 9c2.5 1.4 4-3 5-3s.5 2.5 2 2.5 2-1.5 3-1.5 1 1 2.5 1"/><path d="M3.5 20.5h17" stroke-dasharray="2 2.5"/>',
  whiteout: '<rect class="f" x="3.5" y="6" width="17" height="12" rx="2"/><rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M7.5 10h9M7.5 14h5" stroke-dasharray="1.5 2.2"/>',
  rotL: '<path d="M4.5 4.5V9H9"/><path d="M4.9 9A8 8 0 1 1 6 16"/>',
  rotR: '<path d="M19.5 4.5V9H15"/><path d="M19.1 9A8 8 0 1 0 18 16"/>',
  blank: '<path d="M6 3.5h8l4 4v13H6Z"/><path d="M14 3.5v4h4M12 11v6M9 14h6"/>',
  insert: '<path d="M6 3.5h8l4 4v13H6Z"/><path d="M14 3.5v4h4"/><path d="M12 16.5V11m0 0-2.3 2.3M12 11l2.3 2.3"/>',
  extract: '<path d="M14 20.5H6V3.5h8l4 4V11"/><path d="M14 3.5v4h4"/><path d="M14 16h7m0 0-2.5-2.5M21 16l-2.5 2.5"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10 10v6M14 10v6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>',
  alert: '<path d="M12 4 21 19.5H3Z"/><path d="M12 10v4.5M12 17v.1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/>',
  grip: '<path d="M9 6v.1M15 6v.1M9 12v.1M15 12v.1M9 18v.1M15 18v.1" stroke-width="3"/>',
  bold: '<path d="M7 4.5h6a3.5 3.5 0 0 1 0 7H7Zm0 7h7a4 4 0 0 1 0 8H7Z"/>',
  italic: '<path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15"/>',
  help: '<circle class="f" cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 16.8v.1"/>',
  shapes: '<rect class="f" x="3.5" y="9.5" width="10" height="10" rx="1.5"/><rect x="3.5" y="9.5" width="10" height="10" rx="1.5"/><circle cx="15.5" cy="8.5" r="5"/>',
  pointer: '<path class="f" d="M7 3.5v13l3.4-3.1 2.4 5.4 2.4-1.1-2.4-5.3h4.6Z"/><path d="M7 3.5v13l3.4-3.1 2.4 5.4 2.4-1.1-2.4-5.3h4.6Z"/>',
  scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path class="f" d="M7 8.5h10v7H7Z"/><path d="M7.5 10h9M7.5 12h9M7.5 14h5.5"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.3 2.6 2.6 5-5.2"/>',
};

export function icon(name, extra = '') {
  const p = P[name] || '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${p}</svg>`;
}

export function fillIcons(root = document) {
  root.querySelectorAll('[data-ico]').forEach((el) => { el.outerHTML = icon(el.dataset.ico); });
}
