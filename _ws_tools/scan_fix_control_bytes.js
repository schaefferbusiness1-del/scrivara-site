/* Scan background.js for stray control bytes (anything < 0x20 other than
 * TAB/LF/CR) — e.g. an em-dash truncated by a latin1 write — and repair the
 * known 0x14 (truncated U+2014) to an ASCII hyphen. */
'use strict';
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
let s = fs.readFileSync(target, 'latin1');
const bad = [];
for (let i = 0; i < s.length; i++) {
  const c = s.charCodeAt(i);
  if (c < 0x20 && c !== 9 && c !== 10 && c !== 13) bad.push({ i, c, ctx: s.slice(Math.max(0, i - 40), i + 40).replace(/[\r\n]/g, '·') });
}
if (!bad.length) { console.log('clean: no stray control bytes'); process.exit(0); }
for (const b of bad) console.log('byte 0x' + b.c.toString(16) + ' at ' + b.i + ': ...' + b.ctx + '...');
let fixed = 0;
s = s.replace(/\x14/g, () => { fixed++; return '-'; });
const still = [...s].some((ch) => { const c = ch.charCodeAt(0); return c < 0x20 && c !== 9 && c !== 10 && c !== 13; });
if (still) { console.error('unfixable control bytes remain — manual review needed'); process.exit(1); }
fs.writeFileSync(target, s, 'latin1');
console.log('fixed ' + fixed + ' truncated em-dash byte(s) -> "-"');
