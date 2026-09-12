'use strict';
// A reversible literal splice preserves every unrelated byte and mixed EOL.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'background.js');
const original = fs.readFileSync(file, 'latin1');
const edits = [];
let source = original;
function edit(oldText, newText) {
  assert(oldText && oldText !== newText);
  assert(source.indexOf(oldText) >= 0 && source.indexOf(oldText) === source.lastIndexOf(oldText), 'nonunique splice: ' + oldText.slice(0, 150));
  source = source.replace(oldText, newText);
  edits.push([oldText, newText]);
}
if (process.argv.includes('--normalize-added-eol')) {
  const { execFileSync } = require('child_process');
  const diff = execFileSync('git', ['diff', '--unified=0', '--', 'background.js'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const rows = source.split('\n'), changed = [];
  let line = 0;
  for (const entry of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(entry);
    if (hunk) { line = Number(hunk[1]) - 1; continue; }
    if (!line && !hunk && /^(?:diff |index |---|\+\+\+)/.test(entry)) continue;
    if (entry.startsWith('+') && !entry.startsWith('+++')) {
      if (rows[line] && rows[line].endsWith('\r')) { rows[line] = rows[line].slice(0, -1); changed.push(line); }
      line++;
    } else if (entry.startsWith(' ')) line++;
  }
  const formatted = rows.join('\n');
  for (const index of changed) rows[index] += '\r';
  assert.strictEqual(rows.join('\n'), original, 'formatting touched unrelated bytes');
  fs.writeFileSync(file, Buffer.from(formatted, 'latin1'));
  console.log('Normalized only ' + changed.length + ' added line endings; inverse byte proof passed.');
  process.exit(0);
}
const eol = '\n';
const lines = a => a.join(eol);
const oldDateCheck = "          var regroundOk = (regroundX.r || []).map(function (entry) { return entry && entry.result; }).filter(Boolean).some(function (value) { return value.done === true && value.dateUnverified !== true && String(value.schedDate || '') === frozenScheduleDate; });";
const newDateCheck = lines([
  "          var verifiedDates = (regroundX.r || []).map(function (entry) { return entry && entry.result; }).filter(function (value) { return value && value.done === true && value.dateUnverified !== true && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(value.schedDate || '')); });",
  "          var regroundOk = verifiedDates.length > 0 && verifiedDates.every(function (value) { return String(value.schedDate) === frozenScheduleDate; });"
]);
const oldRetryCheck = "            if (reason !== 'row-identity-changed' || pass === 2) return";
const newRetryCheck = "            if (reason !== 'row-identity-changed' || pass === 2 || !(requireAppointmentId === true || initial.viaApptId === true)) return";
if (source.includes('rowrebind-1.0.0 (3.0.119)')) {
  if (source.includes(oldDateCheck)) edit(oldDateCheck, newDateCheck);
  if (source.includes(oldRetryCheck)) edit(oldRetryCheck, newRetryCheck);
  let inverse = source;
  for (const [a, b] of edits.slice().reverse()) inverse = inverse.replace(b, a);
  assert.strictEqual(inverse, original);
  fs.writeFileSync(file, Buffer.from(source, 'latin1'));
  console.log('3.0.119 refinements verified; ' + edits.length + ' reversible splices.');
  process.exit(0);
}
const sleepMatch = source.match(/^ +function __svSleep\(ms\)[^\r\n]*(?:\r\n|\n)/m);
const sleep = sleepMatch && sleepMatch[0].replace(/\r?\n$/, '');
assert(sleep && sleep.includes('mls-hs-1.0.0'));
edit(sleepMatch[0], '          // __svSleep is shared with exact-row rebind above.' + eol);
const searchString = "      var searchStr = (lname && fname) ? (lname + ',' + fname) : String(name || '').trim();";
edit(searchString, sleep.slice(4) + eol + searchString);
const rowText = "        function rowText(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); }";
edit(rowText, rowText + eol + lines([
  '        /* rowrebind-1.0.0 (3.0.119): an exact-id row uses the SAME name',
  '           echo at selection and immediately before its click. Ordinary',
  '           name-only scans do not gain punctuation-folded matching. */',
  '        function rowNameMatches(text, idBound) {',
  "          var t = String(text || '').toLowerCase();",
  '          if (!t || t.length >= 700 || !lname) return false;',
  '          if (t.indexOf(lname) >= 0 && (!fname || t.indexOf(fname) >= 0)) return true;',
  '          if (idBound !== true) return false;',
  "          var folded = t.replace(/[^a-z]/g, ''), last = String(lname).replace(/[^a-z]/g, ''), first = String(fname || '').replace(/[^a-z]/g, '');",
  '          return !!last && folded.indexOf(last) >= 0 && (!first || folded.indexOf(first) >= 0);',
  '        }'
]));
const clickStart = source.indexOf('        function realClick(el) {', source.indexOf('async function mlsSearchOpenDriverFn'));
const clickEnd = source.indexOf('        /* v2.9.25:', clickStart);
assert(clickStart > 0 && clickEnd > clickStart);
const oldClick = source.slice(clickStart, clickEnd);
let newClick = oldClick.replace('function realClick(el)', 'function realClick(el, proof)');
newClick = newClick.replace("          try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}", lines([
  "          try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}",
  '          if (!el || el.isConnected === false || (proof && !proof())) return false;'
]));
newClick = newClick.replace('          try { el.click(); } catch (e4) { return false; }', lines([
  '          if (!el || el.isConnected === false || (proof && !proof())) return false;',
  '          try { el.click(); } catch (e4) { return false; }'
]));
const verifyStart = newClick.indexOf('        function clickRow(row) {');
const verifyEnd = newClick.indexOf('          var clickT = null;', verifyStart);
newClick = newClick.slice(0, verifyStart) + lines([
  '        function clickRow(row, idBound) {',
  "          clickRow.reason = '';",
  '          function verifyRow() {',
  '            try {',
  "              if (!row || row.isConnected === false || !rowNameMatches(rowText(row), idBound)) { clickRow.reason = 'row-identity-changed'; return false; }",
  '              if (idBound === true) {',
  '                var live = apptIdRow();',
  "                if (live && live.ambiguous) { clickRow.reason = 'appointment-id-ambiguous'; return false; }",
  "                if (!live || live.el !== row) { clickRow.reason = 'row-identity-changed'; return false; }",
  '              }',
  '              return true;',
  "            } catch (eVerify) { clickRow.reason = 'row-identity-changed'; return false; }",
  '          }',
  '          if (!verifyRow()) return false;'
]) + eol + newClick.slice(verifyEnd);
newClick = newClick.replace('          if (!realClick(clickT)) return false;', "          if (!realClick(clickT, verifyRow)) { if (!clickRow.reason) clickRow.reason = 'row-identity-changed'; return false; }");
newClick = newClick.replace('try { realClick(row); }', 'try { realClick(row, verifyRow); }');
edit(oldClick, newClick);
const matchStart = source.indexOf('                if (t && t.length < 700 && lname && t.indexOf(lname)', clickStart);
const matchEnd = source.indexOf('\n', source.indexOf('                if (t && t.length < 700 && lname) { var tF0', matchStart));
assert(matchStart > 0 && matchEnd > matchStart);
edit(source.slice(matchStart, matchEnd), '                if (rowNameMatches(t, true)) { matchedRow = row; break; }');
const fastMarker = '        // fast path: exact id only in bootstrap mode; ordinary opens retain the';
edit(fastMarker, lines([
  '        async function clickRebound(initial, scrolledTo) {',
  '          var candidate = initial, rebinds = 0;',
  '          for (var pass = 0; pass < 3; pass++) {',
  '            if (!openAllowed()) return deadlineOut();',
  '            var d = { frame: location.hostname, scanned: candidate.scanned || 0, topScore: candidate.sc || 0, apptIdBound: false, apptIdMatches: candidate.matches || 0, rowRebinds: rebinds };',
  "            if (typeof scrolledTo === 'number') d.scrolledTo = scrolledTo;",
  "            if (candidate.ambiguous) return { phase: 'open', opened: false, attempted: false, candidates: candidate.matches || 2, reason: 'appointment-id-ambiguous', diag: d };",
  '            if (candidate.el && clickRow(candidate.el, candidate.viaApptId === true)) {',
  '              d.apptIdBound = candidate.viaApptId === true;',
  "              return { phase: 'open', opened: true, via: candidate.viaApptId ? (typeof scrolledTo === 'number' ? 'appt-id-scroll' : 'appt-id') : (typeof scrolledTo === 'number' ? 'scroll' : 'quick'), candidates: 1, diag: d };",
  '            }',
  '            if (!openAllowed()) return deadlineOut();',
  "            var reason = candidate.el ? (clickRow.reason || 'row-identity-changed') : 'row-identity-changed';",
  newRetryCheck + " { phase: 'open', opened: false, attempted: false, candidates: candidate.el ? 1 : 0, reason: reason, diag: d };",
  '            rebinds++;',
  '            await __svSleep(Math.min(120, Math.max(0, __openGuard.deadline - Date.now())));',
  '            if (!openAllowed()) return deadlineOut();',
  '            candidate = (requireAppointmentId === true || initial.viaApptId === true) ? (apptIdRow() || { el: null, sc: 0, scanned: 0 }) : scanOnce();',
  '          }',
  '        }',
  fastMarker
]));
const fastStart = source.indexOf('        if (hit.el) {', source.indexOf(fastMarker));
const fastEnd = source.indexOf('        // v1.61: SCROLL', fastStart);
edit(source.slice(fastStart, fastEnd), '        if (hit.el) return await clickRebound(hit);' + eol);
const scrollStart = source.indexOf('            if (h2.el) {', fastStart);
const scrollTail = source.slice(scrollStart).search(/\r?\n          }\r?\n          if \(openAllowed\(\)\)/);
const scrollEnd = scrollTail < 0 ? -1 : scrollStart + scrollTail;
assert(scrollStart > 0 && scrollEnd > scrollStart);
edit(source.slice(scrollStart, scrollEnd), '            if (h2.el) return await clickRebound(h2, y);');

// Worker recovery: one exact-date restore; a missing/churned row is re-read,
// never promoted to a generic name click or to a different date/provider.
edit('        var bootstrapIdentity = msg.bootstrapIdentity === true;', lines([
  '        var bootstrapIdentity = msg.bootstrapIdentity === true;',
  '        var exactScheduleFallback = false, scheduleRegrounds = 0;'
]));
const waitOpenAt = '        async function waitOpen(ms) {';
edit(waitOpenAt, lines([
  '        async function restoreExactSchedule(stage) {',
  "          if (!frozenScheduleDate) { sendResponse({ ok: false, opened: false, reason: 'schedule-date-missing-after-recovery', error: 'The exact requested schedule date was missing. Nothing was opened.' }); return false; }",
  '          scheduleRegrounds++;',
  '          var regroundX = await execOpen({ target: { tabId: tab.id, allFrames: true }, args: [frozenScheduleDate, false, openGuard], func: mlsAthenaGotoDate }, 40000);',
  "          if (regroundX.timeout) { failOpenDeadline(stage || 'exact schedule restoration'); return false; }",
  newDateCheck,
  "          if (!regroundOk) { sendResponse({ ok: false, opened: false, reason: 'schedule-date-restore-failed', error: 'The exact requested date could not be verified. No appointment was opened.', diag: { route: 'schedule', scheduleRegrounds: scheduleRegrounds, scheduleDateVerified: false } }); return false; }",
  '          return true;',
  '        }',
  waitOpenAt
]));
const oldRestoreStart = source.indexOf('            if (bootstrapIdentity) {', source.indexOf('if (__mlsReadsSinceReload >= 5', source.indexOf("if (msg.type === 'mlsAppSearchOpenRequest')")));
const oldRestoreTail = source.slice(oldRestoreStart).search(/\r?\n          }\r?\n          \/\/ === v1\.53/);
const oldRestoreEnd = oldRestoreTail < 0 ? -1 : oldRestoreStart + oldRestoreTail;
assert(oldRestoreStart > 0 && oldRestoreEnd > oldRestoreStart);
edit(source.slice(oldRestoreStart, oldRestoreEnd), "            if (bootstrapIdentity && !(await restoreExactSchedule('post-recovery date restoration'))) return;");
const prep = "            if (order[oi] === 'sched') {";
edit(prep, prep + eol + lines([
  '              /* Exact ids/date let an ordinary failed Find route recover on',
  '                 its real schedule. It becomes the STRICT bootstrap route,',
  '                 including before/after navigation proof; never name-only. */',
  "              if (!bootstrapIdentity && frozenApptId && frozenScheduleDate && oi > 0 && order[oi - 1] === 'find') { bootstrapIdentity = true; exactScheduleFallback = true; }",
  "              if (exactScheduleFallback && !(await restoreExactSchedule('find-to-schedule restoration'))) return;"
]));
const schedStart = source.indexOf('              var beforeAppointmentFrames = [];', source.indexOf(prep));
const schedEnd = source.indexOf('              if (sched && sched.opened) {', schedStart);
const oldSched = source.slice(schedStart, schedEnd);
const bodyStart = oldSched.indexOf('              if (bootstrapIdentity) {');
const schedBody = oldSched.slice(bodyStart).split(eol).map(l => l ? '  ' + l : l).join(eol);
edit(oldSched, lines([
  '              var beforeAppointmentFrames = [];',
  '              for (var scheduleTry = 0; scheduleTry < 2; scheduleTry++) {'
]) + eol + schedBody + lines([
  '                if (sched && sched.opened) break;',
  "                if (!bootstrapIdentity || !frozenScheduleDate || scheduleTry > 0 || scheduleRegrounds > 0 || !/^(appointment-id-not-found|row-identity-changed)$/.test(String(sched && sched.reason || 'appointment-id-not-found'))) break;",
  "                if (senderTab) progress(senderTab, 'Restoring the exact schedule day and re-finding the appointment row...', openGuard.token);",
  "                if (!(await restoreExactSchedule('schedule-row recovery'))) return;",
  '              }',
  "              if (sched) { sched.diag = Object.assign({}, sched.diag || {}, { route: 'schedule', scheduleRegrounds: scheduleRegrounds, scheduleDateVerified: scheduleRegrounds > 0, exactScheduleFallback: exactScheduleFallback }); }"
]) + eol);
const findTerminal = "              if (findRes && /^(ambiguous|no-results|no-name-match|blank-error|rows-not-rendered|dob-mismatch|search-target-unverified)$/.test(findRes.reason || '')) {";
edit(findTerminal, findTerminal + eol + lines([
  '                /* A real identity contradiction stays terminal. A missing or',
  '                   unrendered Find result may use an independently supplied',
  '                   exact appointment/date, with every row/banner gate intact. */',
  "                if (frozenApptId && frozenScheduleDate && /^(no-results|no-name-match|blank-error|rows-not-rendered|search-target-unverified)$/.test(findRes.reason || '') && order.indexOf('sched', oi + 1) >= 0) { exactScheduleFallback = true; bootstrapIdentity = true; continue; }"
]));
edit('                  findReason: findRes.reason }); return;', '                  reason: findRes.reason, findReason: findRes.reason }); return;');
edit("reason: (fill && fill.reason) || '', error:", "reason: (fill && fill.reason) || 'patient-search-control-unavailable', error:");
edit("diag: opened && opened.diag, findReason: (findRes && (findRes.reason || findRes.error)) || '' });", "reason: (findRes && /^[a-z][a-z0-9-]{1,39}$/.test(String(findRes.reason || ''))) ? findRes.reason : 'patient-search-no-match', diag: opened && opened.diag, findReason: (findRes && /^[a-z][a-z0-9-]{1,39}$/.test(String(findRes.reason || ''))) ? findRes.reason : '' });");
const success = "via: bootstrapIdentity ? 'appointment-id' : 'schedule-click', candidates: sched.candidates";
edit(success, "via: bootstrapIdentity ? 'appointment-id' : 'schedule-click', exactScheduleFallback: exactScheduleFallback, candidates: sched.candidates");

let restored = source;
for (const [oldText, newText] of edits.slice().reverse()) {
  assert(restored.includes(newText), 'inverse marker missing');
  restored = restored.replace(newText, oldText);
}
assert.strictEqual(restored, original, 'unrelated source bytes changed');
fs.writeFileSync(file, Buffer.from(source, 'latin1'));
console.log('Applied 3.0.119 exact-row recovery; inverse byte proof passed for ' + edits.length + ' splices.');
