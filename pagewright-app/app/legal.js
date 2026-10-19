// About Pagewright: privacy policy, terms of use, open-source licenses, and deleting
// what Pagewright keeps in this browser. Plain language on purpose.

import { el } from './state.js';
import { modal, toast } from './ui.js';
import { forgetSavedData } from './signature.js';

// Who runs this copy of Pagewright. Fill these in before publishing it as your own
// website; the contact section only shows when an email is set.
export const OWNER = {
  name: '',      // e.g. 'Pagewright' or your business name
  email: '',     // e.g. 'hello@example.com'
  location: '',  // e.g. 'Ontario, Canada'
};

const UPDATED = 'October 19, 2026';

const LICENSES = [
  ['PDF.js (Mozilla)', 'Shows PDF pages', 'Apache License 2.0', 'Apache-2.0.txt'],
  ['pdf-lib', 'Writes PDF files', 'MIT License', 'pdf-lib-MIT.txt'],
  ['pako (inside pdf-lib)', 'Compression', 'MIT License', 'pako-MIT.txt'],
  ['Tesseract OCR and tesseract.js-core', 'Reads text in scans and photos', 'Apache License 2.0', 'Apache-2.0.txt'],
  ['Tesseract English language data', 'Reads text in scans and photos', 'Apache License 2.0', 'Apache-2.0.txt'],
  ['IBM Plex Sans, Mono and Serif', 'Fonts for the app', 'SIL Open Font License 1.1', 'OFL-1.1.txt'],
  ['Caveat, Dancing Script, Great Vibes', 'Fonts for typed signatures', 'SIL Open Font License 1.1', 'OFL-1.1.txt'],
  ['Carlito, Caladea, Liberation fonts', 'Look-alike fonts for editing', 'SIL Open Font License 1.1', 'OFL-1.1.txt'],
  ['DejaVu Sans', 'Fallback font for rare characters', 'Bitstream Vera License (DejaVu changes are public domain)', 'DejaVu.txt'],
  ['Foxit standard fonts (via PDF.js)', 'Built-in PDF fonts', 'BSD-style license', 'Foxit-fonts-BSD.txt'],
];

const p = (html) => el('p', { html });
const h = (t) => el('h3', {}, t);
const ul = (items) => el('ul', { html: items.map((x) => `<li>${x}</li>`).join('') });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const who = () => esc(OWNER.name || 'Pagewright');

function contact() {
  if (!OWNER.email) return [];
  return [h('Contact'), p(`Questions about this policy: <a href="mailto:${esc(OWNER.email)}">${esc(OWNER.email)}</a>${OWNER.location ? ` (${esc(OWNER.location)})` : ''}.`)];
}

function privacy() {
  return [
    p(`<i>Last updated ${UPDATED}</i>`),
    h('The short version'),
    p('Your documents never leave your device. Pagewright opens, edits, reads and saves your files inside your web browser. They are not uploaded to us or to anyone else.'),
    h('What Pagewright does not collect'),
    ul(['No accounts, names or email addresses.', 'No cookies, analytics, advertising or tracking of any kind.', 'No copies of your documents, signatures or the text in them.']),
    h('What is kept on your device'),
    p('Only if you tick <b>Remember this signature on this device</b>: your saved signatures and typed name are kept in this browser’s local storage. They stay on this device and are never sent anywhere. You can delete them at any time with the button below, or by clearing your browser’s site data.'),
    h('What the app downloads'),
    p(`To work, Pagewright downloads its own program files, fonts and the language file for reading text. These come from the same website that hosts Pagewright, not from other companies. Like any website, the hosting service may keep standard technical logs (such as your IP address and the time of a visit); ${who()} does not use them to identify you.`),
    h('Children'),
    p('Pagewright does not collect personal information from anyone, including children under 13.'),
    h('Your rights'),
    p('Because Pagewright does not collect or store your personal information on any server, there is nothing for us to send you, correct or delete. Anything Pagewright keeps on your device you can delete yourself, below.'),
    h('Changes'),
    p('If this policy changes, the new version will be posted here with a new date.'),
    ...contact(),
  ];
}

function terms() {
  return [
    p(`<i>Last updated ${UPDATED}</i>`),
    h('Using Pagewright'),
    p('Pagewright is free to use. By using it you agree to these terms.'),
    h('Your documents and your responsibility'),
    ul([
      'Only edit documents you have the right to change.',
      'Do not use Pagewright to forge or falsify documents or signatures, or to change a document to mislead someone.',
      'You are responsible for checking your documents before you rely on them or send them.',
    ]),
    h('Things to know'),
    ul([
      'Signatures you draw, type or upload are pictures placed on the page. They are not certificate-based digital signatures. Whether a signature like this is accepted depends on who you send it to and where you are.',
      'Reading text from scans and photos, and matching fonts, can make mistakes. Check the result.',
      'Changing a PDF that has a digital (certificate) signature makes that signature invalid.',
      'Downloading a password-protected PDF after opening it in Pagewright removes the password.',
    ]),
    h('No warranty'),
    p(`Pagewright is provided “as is”, without warranty of any kind. To the extent the law allows, ${who()} is not liable for any loss or damage arising from using it, including lost or altered documents. Keep a copy of your original files.`),
    h('Open-source parts'),
    p('Pagewright includes open-source software and fonts, each under its own license (see <b>Licenses</b>).'),
    h('Changes'),
    p('These terms may change. The new version will be posted here with a new date.'),
    ...contact(),
  ];
}

function licenses() {
  const box = el('div', { class: 'lic' });
  const viewer = el('pre', { class: 'lic-text', hidden: true, tabindex: '0', 'aria-label': 'License text' });
  const table = el('div', { class: 'lic-list' });
  for (const [name, what, lic, file] of LICENSES) {
    const btn = el('button', { class: 'btn outline small' }, 'Read license');
    btn.addEventListener('click', async () => {
      try {
        const r = await fetch(new URL(`../licenses/${file}`, import.meta.url));
        viewer.textContent = r.ok ? await r.text() : 'This license text could not be loaded.';
      } catch (e) { viewer.textContent = 'This license text could not be loaded.'; }
      viewer.hidden = false;
      viewer.scrollTop = 0;
      viewer.focus();
    });
    table.append(el('div', { class: 'lic-row' }, el('div', {}, el('b', {}, name), el('div', { class: 'hint' }, `${what} · ${lic}`)), btn));
  }
  box.append(p('Pagewright is built with these open-source projects. Thank you to their authors.'), table, viewer);
  return [box];
}

export function showAbout(start = 'privacy') {
  const tabs = el('div', { class: 'tabs', role: 'tablist' });
  const panel = el('div', { class: 'legal', role: 'tabpanel', tabindex: '0' });
  const pages = { privacy: ['Privacy', privacy], terms: ['Terms of use', terms], licenses: ['Licenses', licenses] };
  const show = (key) => {
    panel.textContent = '';
    for (const n of pages[key][1]()) panel.append(n);
    [...tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === key)));
    panel.scrollTop = 0;
  };
  for (const [k, [label]] of Object.entries(pages)) {
    const b = el('button', { role: 'tab', 'data-k': k }, label);
    b.addEventListener('click', () => show(k));
    tabs.append(b);
  }
  const body = el('div', { class: 'about' }, tabs, panel);
  show(start);
  modal({
    title: 'About Pagewright',
    body,
    width: 620,
    actions: [
      { label: 'Delete data saved on this device', onClick: () => { forgetSavedData(); toast('Done. Pagewright no longer keeps anything on this device.'); return false; } },
      { label: 'Close', kind: 'primary' },
    ],
  });
}
