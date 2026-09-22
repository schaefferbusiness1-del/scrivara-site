'use strict';
const fs = require('fs');
function comment(file, anchor, lines) {
  let s = fs.readFileSync(file, 'latin1');
  const i = s.indexOf(anchor), j = s.indexOf('*/', i);
  if (i < 0 || j < 0 || s.indexOf(anchor, i + 1) >= 0) throw new Error('Comment anchor: ' + file);
  const end = s.indexOf('\n', i), eol = s[end - 1] === '\r' ? '\r\n' : '\n';
  const replacement = lines.join(eol);
  if (/[^\x00-\x7f]/.test(replacement)) throw new Error('Non-ASCII comment');
  s = s.slice(0, i) + replacement + s.slice(j + 2);
  fs.writeFileSync(file, s, 'latin1');
}
comment('background.js', '/* MLS_WRITE_SAFETY_DRIVER_GUARD_START', [
  '/* MLS_WRITE_SAFETY_DRIVER_GUARD_START (draftonly-1.0.0)',
  '       The closed action map permits only note writes and draft saves.',
  '       clickOnce refuses every forbidden final control without exception.',
  '       These matchers mirror write_safety_guard.js. */'
]);
comment('background.js', '/* MLS_WRITE_SAFETY_GATE_START', [
  '/* MLS_WRITE_SAFETY_GATE_START (draftonly-1.0.0)',
  '         The dispatch map and shared policy independently permit only',
  '         write_note/save_draft. Identity and test-content gates remain.',
  '         A missing shared guard fails closed for every execute request. */'
]);
comment('content.js', '/* wsg-2.0.0 (owner directive 2026-08-12, released 2026-08-17): every', [
  '/* draftonly-1.0.0: only reviewed note writes and draft saves arm.',
  '             Labels must match; gestures remain single-use and short-lived. */'
]);
comment('content.js', '/* MLS_WRITE_SAFETY_BRIDGE_GATE', [
  '/* MLS_WRITE_SAFETY_BRIDGE_GATE (draftonly-1.0.0): the closed action',
  '         gate precedes gesture consumption and transport. Identity,',
  '         encounter, token and read-back gates remain mandatory. */'
]);
let c = fs.readFileSync('content.js', 'latin1');
for (const key of ['supervisedOrderPlacementV2', 'athenaFinalActionsV1']) {
  const a = key + ': true', i = c.indexOf(a);
  if (i < 0 || c.indexOf(a, i + 1) >= 0) throw new Error('Capability count');
  c = c.slice(0, i) + key + ': false' + c.slice(i + a.length);
}
fs.writeFileSync('content.js', c, 'latin1');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
if (manifest.version !== '3.0.111') throw new Error('Unexpected release baseline');
manifest.version = '3.0.112';
delete manifest.version_name;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({release:'3.0.112',policy:'draftonly-1.0.0'}));
