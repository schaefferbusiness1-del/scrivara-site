'use strict';
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');
function swap(a, b, count = 1) {
  if (/[^\x00-\x7f]/.test(b)) throw new Error('Non-ASCII splice');
  const indexes = [];
  for (let i = s.indexOf(a); i >= 0; i = s.indexOf(a, i + a.length)) indexes.push(i);
  if (indexes.length !== count) throw new Error('Anchor count ' + indexes.length + ': ' + a.slice(0, 60));
  for (const i of indexes.reverse()) s = s.slice(0, i) + b + s.slice(i + a.length);
}
function insertAfterLine(anchor, lines, scope) {
  const begin = scope ? s.indexOf(scope) : 0;
  const limit = scope ? s.indexOf('/*MLS_ATHENA_DRIVE_END*/', begin) : s.length;
  const i = s.indexOf(anchor, begin), end = s.indexOf('\n', i), next = s.indexOf(anchor, i + 1);
  if (begin < 0 || i < begin || i >= limit || end < 0 || (next >= 0 && next < limit)) throw new Error('Line anchor: ' + anchor);
  const eol = s[end - 1] === '\r' ? '\r\n' : '\n';
  const addition = lines.join(eol) + eol;
  if (/[^\x00-\x7f]/.test(addition)) throw new Error('Non-ASCII insertion');
  s = s.slice(0, end + 1) + addition + s.slice(end + 1);
}
swap("action && /^(type|pastenote)$/.test(String(action.type || ''))", "action && String(action.type || '').toLowerCase().trim() !== 'scroll'");
swap("Typing into athenaOne from this panel is disabled for safety. Use the reviewed write flow in MLS (Review selected Athena routes) so the patient banner, the exact field and your confirmation are verified first.", "Use Send to Athena in MLS to write the reviewed note or save a draft. This assistant panel can only read and scroll Athena.");
insertAfterLine('  function overlayPasteNote(arg) {', [
  "    return Promise.resolve({ ok: false, blocked: true, reason: 'legacy-write-route-disabled', error: 'Use Send to Athena in MLS to review and confirm the note.' }); // draftonly-1.0.0"
]);
insertAfterLine("  if (op === 'fill') {", [
  "    return { ok: false, blocked: true, reason: 'report-filter-scope-unverified', op: 'fill', acted: false }; // draftonly-1.0.0: no typing without a proven report scope"
], '/*MLS_ATHENA_DRIVE_START*/');
insertAfterLine("    if (msg.type === 'MLS_OVL_WRITEBACK') {", [
  "      sendResponse({ ok: false, blocked: true, reason: 'legacy-write-route-disabled', error: 'Use Send to Athena in MLS to review and confirm the note.' }); return true; // draftonly-1.0.0"
]);
insertAfterLine('  function fireClick(el) {', [
  '    // draftonly-1.0.0: caller configuration cannot authorize final controls.',
  "    var own = String((el && (el.textContent || el.value)) || '') + ' ' + ['aria-label', 'title', 'id', 'name', 'data-action', 'data-testid'].map(function (k) { return el && el.getAttribute ? el.getAttribute(k) || '' : ''; }).join(' ');",
  "    var human = own.toLowerCase().replace(/[^a-z0-9]+/g, ' ');",
  "    if (/\\b(save|sign|attest|submit|send|approve|finalize|finalise|order|orders|prescribe|prescription|bill|billing|charge|charges|claim|claims|delete|remove|void|discard|close|check\\s*(?:in|out))\\b/.test(human) || /signandsave|signsave|signencounter|placeorder|submitorder|checkin|checkout|closeencounter|postcharge|submitclaim/.test(human)) return false;"
], '/*MLS_ATHENA_DRIVE_START*/');
swap('    try { el.click && el.click(); } catch (e) {}', '    try { el.click && el.click(); } catch (e) {} return true;');
swap('    var desc = btnText(n2).slice(0, 40); fireClick(n2);', "    var desc = btnText(n2).slice(0, 40); if (!fireClick(n2)) return { ok: false, blocked: true, reason: 'final-action-blocked', op: 'next', clicked: false };");
swap("if (rb) { res.controls.run = btnText(rb).slice(0, 40); fireClick(rb); res.clickedRun = true; res.acted = true; }", "if (rb) { if (!fireClick(rb)) return { ok: false, blocked: true, reason: 'final-action-blocked', op: 'fill', clickedRun: false, acted: res.acted }; res.controls.run = btnText(rb).slice(0, 40); res.clickedRun = true; res.acted = true; }");
fs.writeFileSync('background.js', s, 'latin1');
console.log(JSON.stringify({proof:'draftonly-legacy-1.0.0',genericAthena:'scroll-only',legacyWriteback:'closed',reportFinalControls:'closed'}));
