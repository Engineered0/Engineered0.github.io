// Text encodings for simple PDF fonts and glyph-name -> Unicode resolution.

const GLYPHS = {
  space: 0x20, exclam: 0x21, quotedbl: 0x22, numbersign: 0x23, dollar: 0x24, percent: 0x25,
  ampersand: 0x26, quotesingle: 0x27, parenleft: 0x28, parenright: 0x29, asterisk: 0x2a,
  plus: 0x2b, comma: 0x2c, hyphen: 0x2d, period: 0x2e, slash: 0x2f, zero: 0x30, one: 0x31,
  two: 0x32, three: 0x33, four: 0x34, five: 0x35, six: 0x36, seven: 0x37, eight: 0x38,
  nine: 0x39, colon: 0x3a, semicolon: 0x3b, less: 0x3c, equal: 0x3d, greater: 0x3e,
  question: 0x3f, at: 0x40, bracketleft: 0x5b, backslash: 0x5c, bracketright: 0x5d,
  asciicircum: 0x5e, underscore: 0x5f, grave: 0x60, braceleft: 0x7b, bar: 0x7c,
  braceright: 0x7d, asciitilde: 0x7e, bullet: 0x2022, Euro: 0x20ac, quotesinglbase: 0x201a,
  florin: 0x192, quotedblbase: 0x201e, ellipsis: 0x2026, dagger: 0x2020, daggerdbl: 0x2021,
  circumflex: 0x2c6, perthousand: 0x2030, Scaron: 0x160, guilsinglleft: 0x2039, OE: 0x152,
  Zcaron: 0x17d, quoteleft: 0x2018, quoteright: 0x2019, quotedblleft: 0x201c,
  quotedblright: 0x201d, endash: 0x2013, emdash: 0x2014, tilde: 0x2dc, trademark: 0x2122,
  scaron: 0x161, guilsinglright: 0x203a, oe: 0x153, zcaron: 0x17e, Ydieresis: 0x178,
  exclamdown: 0xa1, cent: 0xa2, sterling: 0xa3, currency: 0xa4, yen: 0xa5, brokenbar: 0xa6,
  section: 0xa7, dieresis: 0xa8, copyright: 0xa9, ordfeminine: 0xaa, guillemotleft: 0xab,
  logicalnot: 0xac, registered: 0xae, macron: 0xaf, degree: 0xb0, plusminus: 0xb1,
  twosuperior: 0xb2, threesuperior: 0xb3, acute: 0xb4, mu: 0xb5, paragraph: 0xb6,
  periodcentered: 0xb7, cedilla: 0xb8, onesuperior: 0xb9, ordmasculine: 0xba,
  guillemotright: 0xbb, onequarter: 0xbc, onehalf: 0xbd, threequarters: 0xbe,
  questiondown: 0xbf, Agrave: 0xc0, Aacute: 0xc1, Acircumflex: 0xc2, Atilde: 0xc3,
  Adieresis: 0xc4, Aring: 0xc5, AE: 0xc6, Ccedilla: 0xc7, Egrave: 0xc8, Eacute: 0xc9,
  Ecircumflex: 0xca, Edieresis: 0xcb, Igrave: 0xcc, Iacute: 0xcd, Icircumflex: 0xce,
  Idieresis: 0xcf, Eth: 0xd0, Ntilde: 0xd1, Ograve: 0xd2, Oacute: 0xd3, Ocircumflex: 0xd4,
  Otilde: 0xd5, Odieresis: 0xd6, multiply: 0xd7, Oslash: 0xd8, Ugrave: 0xd9, Uacute: 0xda,
  Ucircumflex: 0xdb, Udieresis: 0xdc, Yacute: 0xdd, Thorn: 0xde, germandbls: 0xdf,
  agrave: 0xe0, aacute: 0xe1, acircumflex: 0xe2, atilde: 0xe3, adieresis: 0xe4, aring: 0xe5,
  ae: 0xe6, ccedilla: 0xe7, egrave: 0xe8, eacute: 0xe9, ecircumflex: 0xea, edieresis: 0xeb,
  igrave: 0xec, iacute: 0xed, icircumflex: 0xee, idieresis: 0xef, eth: 0xf0, ntilde: 0xf1,
  ograve: 0xf2, oacute: 0xf3, ocircumflex: 0xf4, otilde: 0xf5, odieresis: 0xf6, divide: 0xf7,
  oslash: 0xf8, ugrave: 0xf9, uacute: 0xfa, ucircumflex: 0xfb, udieresis: 0xfc, yacute: 0xfd,
  thorn: 0xfe, ydieresis: 0xff, fi: 0xfb01, fl: 0xfb02, ff: 0xfb00, ffi: 0xfb03, ffl: 0xfb04,
  dotlessi: 0x131, dotlessj: 0x237, Lslash: 0x141, lslash: 0x142, fraction: 0x2044,
  breve: 0x2d8, dotaccent: 0x2d9, ring: 0x2da, hungarumlaut: 0x2dd, ogonek: 0x2db,
  caron: 0x2c7, minus: 0x2212, nbspace: 0xa0, nonbreakingspace: 0xa0, sfthyphen: 0xad,
  softhyphen: 0xad, Abreve: 0x102, abreve: 0x103, Aogonek: 0x104, aogonek: 0x105,
  Amacron: 0x100, amacron: 0x101, Cacute: 0x106, cacute: 0x107, Ccaron: 0x10c, ccaron: 0x10d,
  Dcaron: 0x10e, dcaron: 0x10f, Dcroat: 0x110, dcroat: 0x111, Emacron: 0x112, emacron: 0x113,
  Edotaccent: 0x116, edotaccent: 0x117, Eogonek: 0x118, eogonek: 0x119, Ecaron: 0x11a,
  ecaron: 0x11b, Gbreve: 0x11e, gbreve: 0x11f, Gcommaaccent: 0x122, gcommaaccent: 0x123,
  Imacron: 0x12a, imacron: 0x12b, Iogonek: 0x12e, iogonek: 0x12f, Idotaccent: 0x130,
  Kcommaaccent: 0x136, kcommaaccent: 0x137, Lacute: 0x139, lacute: 0x13a,
  Lcommaaccent: 0x13b, lcommaaccent: 0x13c, Lcaron: 0x13d, lcaron: 0x13e, Nacute: 0x143,
  nacute: 0x144, Ncommaaccent: 0x145, ncommaaccent: 0x146, Ncaron: 0x147, ncaron: 0x148,
  Omacron: 0x14c, omacron: 0x14d, Ohungarumlaut: 0x150, ohungarumlaut: 0x151, Racute: 0x154,
  racute: 0x155, Rcommaaccent: 0x156, rcommaaccent: 0x157, Rcaron: 0x158, rcaron: 0x159,
  Sacute: 0x15a, sacute: 0x15b, Scedilla: 0x15e, scedilla: 0x15f, Scommaaccent: 0x218,
  scommaaccent: 0x219, Tcommaaccent: 0x162, tcommaaccent: 0x163, Tcaron: 0x164, tcaron: 0x165,
  Umacron: 0x16a, umacron: 0x16b, Uring: 0x16e, uring: 0x16f, Uhungarumlaut: 0x170,
  uhungarumlaut: 0x171, Uogonek: 0x172, uogonek: 0x173, Zacute: 0x179, zacute: 0x17a,
  Zdotaccent: 0x17b, zdotaccent: 0x17c, Alpha: 0x391, Beta: 0x392, Gamma: 0x393, Delta: 0x2206,
  Epsilon: 0x395, Zeta: 0x396, Eta: 0x397, Theta: 0x398, Iota: 0x399, Kappa: 0x39a,
  Lambda: 0x39b, Mu: 0x39c, Nu: 0x39d, Xi: 0x39e, Omicron: 0x39f, Pi: 0x3a0, Rho: 0x3a1,
  Sigma: 0x3a3, Tau: 0x3a4, Upsilon: 0x3a5, Phi: 0x3a6, Chi: 0x3a7, Psi: 0x3a8, Omega: 0x2126,
  alpha: 0x3b1, beta: 0x3b2, gamma: 0x3b3, delta: 0x3b4, epsilon: 0x3b5, zeta: 0x3b6,
  eta: 0x3b7, theta: 0x3b8, iota: 0x3b9, kappa: 0x3ba, lambda: 0x3bb, nu: 0x3bd, xi: 0x3be,
  omicron: 0x3bf, pi: 0x3c0, rho: 0x3c1, sigma: 0x3c3, sigma1: 0x3c2, tau: 0x3c4,
  upsilon: 0x3c5, phi: 0x3c6, chi: 0x3c7, psi: 0x3c8, omega: 0x3c9, theta1: 0x3d1, phi1: 0x3d5,
  omega1: 0x3d6, summation: 0x2211, product: 0x220f, integral: 0x222b, infinity: 0x221e,
  lessequal: 0x2264, greaterequal: 0x2265, notequal: 0x2260, approxequal: 0x2248,
  radical: 0x221a, partialdiff: 0x2202, lozenge: 0x25ca, arrowright: 0x2192,
  arrowleft: 0x2190, arrowup: 0x2191, arrowdown: 0x2193, arrowboth: 0x2194,
  arrowdblright: 0x21d2, arrowdblleft: 0x21d0, arrowdblboth: 0x21d4, universal: 0x2200,
  existential: 0x2203, element: 0x2208, notelement: 0x2209, suchthat: 0x220b,
  asteriskmath: 0x2217, proportional: 0x221d, angle: 0x2220, logicaland: 0x2227,
  logicalor: 0x2228, intersection: 0x2229, union: 0x222a, therefore: 0x2234, similar: 0x223c,
  congruent: 0x2245, equivalence: 0x2261, propersubset: 0x2282, propersuperset: 0x2283,
  reflexsubset: 0x2286, reflexsuperset: 0x2287, circleplus: 0x2295, circlemultiply: 0x2297,
  perpendicular: 0x22a5, dotmath: 0x22c5, emptyset: 0x2205, nabla: 0x2207, aleph: 0x2135,
  weierstrass: 0x2118, Ifraktur: 0x2111, Rfraktur: 0x211c, minute: 0x2032, second: 0x2033,
  club: 0x2663, diamond: 0x2666, heart: 0x2665, spade: 0x2660, checkmark: 0x2713,
  dotlessi_alt: 0x131, Ohorn: 0x1a0, ohorn: 0x1a1, Uhorn: 0x1af, uhorn: 0x1b0,
  quoteleftreversed: 0x201b, figuredash: 0x2012, horizontalbar: 0x2015, onethird: 0x2153,
  twothirds: 0x2154, oneeighth: 0x215b, threeeighths: 0x215c, fiveeighths: 0x215d,
  seveneighths: 0x215e, careof: 0x2105, estimated: 0x212e, numero: 0x2116,
  commaaccent: 0xf6c3, Delta_alt: 0x394, mu1: 0xb5, Omega_alt: 0x3a9, increment: 0x2206,
  zerooldstyle: 0x30, oneoldstyle: 0x31, twooldstyle: 0x32, threeoldstyle: 0x33,
  fouroldstyle: 0x34, fiveoldstyle: 0x35, sixoldstyle: 0x36, sevenoldstyle: 0x37,
  eightoldstyle: 0x38, nineoldstyle: 0x39, visiblespace: 0x2423, cwm: 0x200c,
  compwordmark: 0x200c, perthousandzero: 0x2030, Dbar: 0x110, dbar: 0x111, Hbar: 0x126,
  hbar: 0x127, Eng: 0x14a, eng: 0x14b, napostrophe: 0x149, IJ: 0x132, ij: 0x133,
  Ldot: 0x13f, ldot: 0x140, kgreenlandic: 0x138, longs: 0x17f, Tbar: 0x166, tbar: 0x167,
  Wcircumflex: 0x174, wcircumflex: 0x175, Ycircumflex: 0x176, ycircumflex: 0x177,
  Ccircumflex: 0x108, ccircumflex: 0x109, Cdotaccent: 0x10a, cdotaccent: 0x10b,
  Gcircumflex: 0x11c, gcircumflex: 0x11d, Gdotaccent: 0x120, gdotaccent: 0x121,
  Hcircumflex: 0x124, hcircumflex: 0x125, Itilde: 0x128, itilde: 0x129, Ibreve: 0x12c,
  ibreve: 0x12d, Jcircumflex: 0x134, jcircumflex: 0x135, Obreve: 0x14e, obreve: 0x14f,
  Scircumflex: 0x15c, scircumflex: 0x15d, Utilde: 0x168, utilde: 0x169, Ubreve: 0x16c,
  ubreve: 0x16d, Ebreve: 0x114, ebreve: 0x115,
};

let UNI_TO_NAME = null;
export function unicodeToGlyphName(ch) {
  if (!ch) return undefined;
  if (!UNI_TO_NAME) {
    UNI_TO_NAME = new Map();
    for (const k in GLYPHS) if (!k.includes('_alt') && !UNI_TO_NAME.has(GLYPHS[k])) UNI_TO_NAME.set(GLYPHS[k], k);
    UNI_TO_NAME.set(0x2206, 'Delta'); UNI_TO_NAME.set(0x2126, 'Omega');
  }
  const cp = ch.codePointAt(0);
  if (ch.length === 1 && /[A-Za-z]/.test(ch)) return ch;
  if (UNI_TO_NAME.has(cp)) return UNI_TO_NAME.get(cp);
  return 'uni' + cp.toString(16).toUpperCase().padStart(4, '0');
}

// All plausible names for a character (fonts disagree on e.g. Delta/increment, mu/mu1)
export function glyphNamesFor(ch) {
  const out = [];
  const n = unicodeToGlyphName(ch);
  if (n) out.push(n);
  const cp = ch.codePointAt(0);
  for (const k in GLYPHS) if (GLYPHS[k] === cp && !out.includes(k)) out.push(k);
  const h = cp.toString(16).toUpperCase().padStart(4, '0');
  out.push('uni' + h, 'u' + h);
  return out;
}

export function glyphToUnicode(name) {
  if (!name) return undefined;
  if (GLYPHS[name] !== undefined) return String.fromCodePoint(GLYPHS[name]);
  if (name.length === 1 && /[A-Za-z]/.test(name)) return name;
  let m;
  if ((m = name.match(/^uni((?:[0-9A-Fa-f]{4})+)$/))) {
    let s = '';
    for (let i = 0; i < m[1].length; i += 4) s += String.fromCharCode(parseInt(m[1].substr(i, 4), 16));
    return s;
  }
  if ((m = name.match(/^u([0-9A-Fa-f]{4,6})$/))) return String.fromCodePoint(parseInt(m[1], 16));
  // strip suffix (.sc, .alt, .lf) and split ligatures (f_f_i)
  const dot = name.indexOf('.');
  if (dot > 0) return glyphToUnicode(name.slice(0, dot));
  if (name.includes('_')) {
    const parts = name.split('_').map(glyphToUnicode);
    if (parts.every((p) => p)) return parts.join('');
  }
  // TeX-ish names like "a69" (dingbats) or "g123" have no meaning
  return undefined;
}

const winAnsi = new Array(256).fill(undefined);
const macRoman = new Array(256).fill(undefined);
(function build() {
  let dec1252, decMac;
  try { dec1252 = new TextDecoder('windows-1252'); } catch (e) { /* ignore */ }
  try { decMac = new TextDecoder('macintosh'); } catch (e) { /* ignore */ }
  for (let c = 32; c < 256; c++) {
    if (dec1252) winAnsi[c] = dec1252.decode(Uint8Array.of(c));
    else winAnsi[c] = String.fromCharCode(c);
    if (decMac) macRoman[c] = decMac.decode(Uint8Array.of(c));
    else if (c < 128) macRoman[c] = String.fromCharCode(c);
  }
  // PDF's WinAnsi: unused codes render as bullet, 0xA0 is a space, 0xAD a hyphen
  for (const c of [0x7f, 0x81, 0x8d, 0x8f, 0x90, 0x9d]) winAnsi[c] = '•';
  winAnsi[0x7f] = '•';
  macRoman[0x7f] = undefined;
})();

const standard = new Array(256).fill(undefined);
(function build() {
  for (let c = 32; c < 127; c++) standard[c] = String.fromCharCode(c);
  standard[39] = '’';
  standard[96] = '‘';
  const hi = {
    161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin',
    167: 'section', 168: 'currency', 169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft',
    172: 'guilsinglleft', 173: 'guilsinglright', 174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger',
    179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph', 183: 'bullet', 184: 'quotesinglbase',
    185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright', 188: 'ellipsis',
    189: 'perthousand', 191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex',
    196: 'tilde', 197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring',
    203: 'cedilla', 205: 'hungarumlaut', 206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE',
    227: 'ordfeminine', 232: 'Lslash', 233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae',
    245: 'dotlessi', 248: 'lslash', 249: 'oslash', 250: 'oe', 251: 'germandbls',
  };
  for (const k in hi) standard[k] = glyphToUnicode(hi[k]);
})();

// PDFDocEncoding is close to WinAnsi for our purposes.
export const BASE_ENCODINGS = {
  WinAnsiEncoding: winAnsi,
  MacRomanEncoding: macRoman,
  StandardEncoding: standard,
  MacExpertEncoding: standard,
  PDFDocEncoding: winAnsi,
};

export function encodingArray(name) {
  return (BASE_ENCODINGS[name] || standard).slice();
}

// Standard 14 font name normalisation (incl. common aliases used without embedding)
export function standardFontFor(baseFont) {
  if (!baseFont) return undefined;
  const n = baseFont.replace(/^[A-Z]{6}\+/, '').replace(/[\s-]/g, '').toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/.test(n);
  const italic = /italic|oblique|ital|it$/.test(n);
  let fam = null;
  if (/^(helvetica|arial|arialmt|liberationsans|arimo|nimbussans)/.test(n)) fam = 'Helvetica';
  else if (/^(times|timesnewroman|liberationserif|tinos|nimbusroman)/.test(n)) fam = 'Times';
  else if (/^(courier|couriernew|liberationmono|cousine|nimbusmono)/.test(n)) fam = 'Courier';
  else if (/^symbol/.test(n)) return 'Symbol';
  else if (/^zapfdingbats/.test(n)) return 'ZapfDingbats';
  if (!fam) return undefined;
  if (fam === 'Times') {
    if (bold && italic) return 'Times-BoldItalic';
    if (bold) return 'Times-Bold';
    if (italic) return 'Times-Italic';
    return 'Times-Roman';
  }
  const suffix = fam === 'Helvetica' ? 'Oblique' : 'Oblique';
  if (bold && italic) return `${fam}-Bold${suffix}`;
  if (bold) return `${fam}-Bold`;
  if (italic) return `${fam}-${suffix}`;
  return fam;
}
