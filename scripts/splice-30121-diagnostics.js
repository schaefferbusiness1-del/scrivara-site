'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const edits = process.argv.includes('--schedule') ? [
  ["names:[String(a.name||''),String(a._conflictName||'')]", "nameConflict:true"]
] : [
  ["url: ecUrl.slice(0, 110), score: ecScoreN, nm: String((ecIdentity && ecIdentity.name) || '').slice(0, 34)", "url: ecNoise ? 'shared-ui' : 'chart-ui', score: ecScoreN, identityPresent: !!(ecIdentity && ecIdentity.name)"],
  ["try { tail0 = String((res0 && res0.frameUrl) || '').replace(/[?#].*$/, '').split('/').slice(-1)[0].slice(0, 40); } catch (eT0) {}", "try { var tailMatch0 = /\\/(stm\\.esp|globalnav\\.esp|statusbar\\.esp|findpatient\\.esp|summary|exam|briefing|visits)(?:[?#]|$)/i.exec(String((res0 && res0.frameUrl) || '')); tail0 = tailMatch0 ? tailMatch0[1].toLowerCase() : 'other-surface'; } catch (eT0) {}"]
];
let after = before;
for (const [a, b] of edits) { assert(after.includes(a) && after.indexOf(a) === after.lastIndexOf(a)); after = after.replace(a, b); }
let inverse = after;
for (const [a, b] of edits.slice().reverse()) inverse = inverse.replace(b, a);
assert.strictEqual(inverse, before);
fs.writeFileSync(target, Buffer.from(after, 'latin1'));
console.log('Removed names and raw URLs from encounter frame diagnostics; inverse byte proof passed.');
