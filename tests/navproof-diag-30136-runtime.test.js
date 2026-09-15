'use strict';
/* MLS Assist 3.0.136 — navproof-diag-1.0.0: the 'appointment-navigation-unverified' refusal carries the
 * schedule opener's own diag plus closed PHI-free COUNTS of why the encounter-acceptance leg rejected
 * every candidate frame. Executes the real rejection loop against synthetic frames and pins the
 * content.js allowlist that carries the counts to the app. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const ct = fs.readFileSync(path.join(root, 'content.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. execute the real rejection loop with its counters */
const s = bg.indexOf('                            var eaMatches = [];');
const endMark = '__navDiag.eaMatches = eaMatches.length;';
const e = bg.indexOf(endMark, s);
ok(s > 0 && e > s, 'rejection loop present');
const loop = bg.slice(s, e + endMark.length);
function run(frames, want) {
  const eaIdX = { r: frames.map((f, i) => ({ frameId: i, result: f.id })) };
  const eaSurById = {}; frames.forEach((f, i) => { if (f.sur) eaSurById[i] = f.sur; });
  const __navDiag = { eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0, eaDatelessChanged: 0 };
  const eaChangedIds = frames.map((f, i) => (f.changed ? i : -1)).filter((i) => i >= 0);
  const fn = new Function('eaIdX', 'eaSurById', 'msg', 'eaNameOk', 'eaDobKey', 'eaWantDob', 'eaWantDate', '__navDiag', 'eaChangedIds',
    loop + '\nreturn { eaMatches: eaMatches, d: __navDiag };');
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
  return fn(eaIdX, eaSurById, { name: want.name }, (a, b) => norm(a) === norm(b), (v) => String(v || '').replace(/\D/g, ''), want.dob, want.date, __navDiag, eaChangedIds);
}
{
  const r = run([
    { id: { via: 'banner', name: 'A B', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/14/2026'] } },
    { id: { via: 'guess', name: 'A B', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/14/2026'] } },
    { id: { via: 'banner', name: 'C D', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/14/2026'] } },
    { id: { via: 'banner', name: 'A B', dob: '1/2/1991' }, sur: { encish: true, dates: ['9/14/2026'] } },
    { id: { via: 'banner', name: 'A B', dob: '1/2/1990' }, sur: { encish: false, dates: ['9/14/2026'] } },
    { id: { via: 'banner', name: 'A B', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/13/2026'] } },
    { id: null, sur: { encish: true, dates: ['9/14/2026'] } }
  ], { name: 'A B', dob: '121990', date: '9/14/2026' });
  assert.deepStrictEqual(r.eaMatches, [0]); checks++;
  eq(r.d.eaMatches, 1, 'one exact frame counted');
  eq(r.d.eaRejVia, 1, 'a non-banner identity is counted as a via rejection');
  eq(r.d.eaRejName, 1, 'a different name is counted');
  eq(r.d.eaRejDob, 1, 'a different DOB is counted');
  eq(r.d.eaRejEncish, 1, 'a non-encounter surface is counted');
  eq(r.d.eaRejDate, 1, 'an UNCHANGED surface printing another day is still rejected and counted');
  eq(r.d.eaDatelessChanged, 0, 'no dateless acceptance when no frame changed');
  ok(Object.keys(r.d).every((k) => typeof r.d[k] === 'number'), 'the receipt holds counts, never the values');
}
{
  const r = run([], { name: 'A B', dob: '121990', date: '9/14/2026' });
  eq(r.eaMatches.length, 0, 'no frames, no matches'); eq(r.d.eaMatches, 0, 'zero counted');
}

{
  /* navaccept-1.0.0 (3.0.137): a frame our click navigated, with banner-grade exact name+DOB on an encounter-ish surface, is accepted without the bound date */
  const r = run([
    { id: { via: 'banner', name: 'A B', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/1/2026'] }, changed: true },
    { id: { via: 'guess', name: 'A B', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/1/2026'] }, changed: true }
  ], { name: 'A B', dob: '121990', date: '9/14/2026' });
  assert.deepStrictEqual(r.eaMatches, [0]); checks++;
  eq(r.d.eaDatelessChanged, 1, 'the dateless acceptance is counted');
  eq(r.d.eaRejDate, 0, 'no date rejection for a changed frame');
  const r2 = run([
    { id: { via: 'banner', name: 'A B', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/1/2026'] }, changed: true },
    { id: { via: 'banner', name: 'C D', dob: '1/2/1990' }, sur: { encish: true, dates: ['9/1/2026'] }, changed: true },
    { id: { via: 'banner', name: 'A B', dob: '1/2/1991' }, sur: { encish: true, dates: ['9/1/2026'] }, changed: true },
    { id: { via: 'banner', name: 'A B', dob: '1/2/1990' }, sur: { encish: false, dates: ['9/1/2026'] }, changed: true }
  ], { name: 'A B', dob: '121990', date: '9/14/2026' });
  assert.deepStrictEqual(r2.eaMatches, [0]); checks++;
  eq(r2.d.eaRejName + r2.d.eaRejDob + r2.d.eaRejEncish, 3, 'name, DOB and encounter-surface rules still reject changed frames');
}

/* 2. the refusal carries the opener diag and the counts; the other counters are set at their gates */
ok(bg.includes("var __navDiag = { navChangedFrames: 0, eaSkipped: 0, eaNoCand: 0, eaCand: 0, eaChanged: 0, eaTimeout: 0, eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0, eaDatelessChanged: 0 };"), 'closed counter set declared per open');
ok(bg.includes("if (eaChangedIds.indexOf(en.frameId) < 0) { __navDiag.eaRejDate++; return; }"), 'the date rule stays for unchanged frames');
ok(bg.includes("sched.diag.encounterAccepted = true; sched.diag.eaDatelessChanged = __navDiag.eaDatelessChanged;"), 'the acceptance receipt records dateless acceptance');
ok(bg.includes("__navDiag.navChangedFrames = appointmentNavigationFrameIds.length;"), 'URL-delta frames counted');
ok(bg.includes("if (!(eaWantDob && eaWantDate && (msg.name || ''))) __navDiag.eaSkipped = 1;"), 'a skipped acceptance leg is visible');
ok(bg.includes("__navDiag.eaCand = eaCand.length; if (!eaCand.length) __navDiag.eaNoCand = 1;"), 'candidate frames counted');
ok(bg.includes("if (!(eaIdX && !eaIdX.timeout && eaSurX && !eaSurX.timeout)) __navDiag.eaTimeout = 1;"), 'an injection timeout is visible');
ok(bg.includes("diag: searchOpenDiag(Object.assign({}, (findRes && findRes.diag) || {}, (sched && sched.diag) || {}, __navDiag, { appointmentNavigationProven: false })) }); return;"), 'the refusal carries the opener diag (route, apptIdBound, regrounds) and the counts');
eq(bg.split("reason: 'appointment-navigation-unverified'").length - 1, 1, 'one worker refusal site');

/* 3. content.js carries the counts through its closed allowlist (numbers only) and apptIdBound */
ok(ct.includes("'navChangedFrames', 'eaSkipped', 'eaNoCand', 'eaCand', 'eaTimeout', 'eaMatches', 'eaRejVia', 'eaRejName', 'eaRejDob', 'eaRejEncish', 'eaRejDate'"), 'bridge allowlist carries the counts');
ok(ct.includes("safeDiag.apptIdBound = openedDiag.apptIdBound === true;"), 'bridge carries apptIdBound as a boolean');
ok(ct.includes("'findRows', 'findDobHit', 'findNameHit', 'findDobOnly', 'findAltRows', 'findTokens', 'findPunct', 'findComma'") && ct.includes("'eaChanged', 'eaDatelessChanged'"), 'bridge allowlist carries the 3.0.137 counts');
/* finddiag-1.0.0 (3.0.137): the Find driver counts what it rejected, never what it saw */
ok(bg.includes("var __fd = { findRows: 0, findDobHit: 0, findNameHit: 0, findDobOnly: 0, findAltRows: 0 };"), 'find counters declared');
ok(bg.includes("reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};"), 'the no-name-match refusal carries the counts');
ok(bg.includes("diag: { findTokens: String(name || '').split(") && bg.includes("findPunct: /") && bg.includes("findComma: String(name || '').indexOf(',') >= 0 ? 1 : 0 }"), 'the no-results refusal carries the searched term shape');
ok(bg.includes("reason: findRes.reason, findReason: findRes.reason, diag: searchOpenDiag(Object.assign({}, findRes.diag || {}, { route: 'findpatient' })) }); return;"), 'the worker Find refusal carries the counts');
{ const i = bg.indexOf('var __fd = { findRows'); const j = bg.indexOf("diag:__fd};", i); const blk = bg.slice(i, j); ok(!/__fd.[a-zA-Z]+s*=s*(cells|rowName|dates|name|dob)/.test(blk), 'find counters never hold a cell, name or DOB value'); }
{
  const i = ct.indexOf("'navChangedFrames', 'eaSkipped'");
  const j = ct.indexOf("var value = Number(openedDiag[key]); if (isFinite(value)) safeDiag[key] = value;", i);
  ok(i > 0 && j > i && j - i < 800, 'the counts pass only as finite numbers');
}
/* 4. readstage-1.0.0 (3.0.136): the absolute chart-read timer names the last step reached */
ok(bg.includes("ok: false, reason: 'chart-deadline-exceeded', stage: String(stage || 'the read').replace(/[^a-z0-9 ()-]/gi, '').slice(0, 60),"), 'the deadline refusal carries a closed stage string');
ok(bg.includes("var __chartStage = 'request start';"), 'the marker starts at request start');
ok(bg.includes("chartDeadlineTimer = setTimeout(() => { chartFailDeadline('the read after ' + __chartStage); }"), 'the absolute timer reports the last stage');
ok(bg.includes("__chartStage = 'tab selection';") && bg.includes("__chartStage = 'identity poll ' + polls;") && bg.includes("__chartStage = 'identity settled after ' + polls + ' polls';") && bg.includes("__chartStage = 'text read';"), 'the four step markers are set in order');
{ const i1 = bg.indexOf("__chartStage = 'tab selection';"), i2 = bg.indexOf("__chartStage = 'identity poll ' + polls;"), i3 = bg.indexOf("__chartStage = 'identity settled after ' + polls + ' polls';"), i4 = bg.indexOf("__chartStage = 'text read';"); ok(i1 > 0 && i2 > i1 && i3 > i2 && i4 > i3, 'markers follow the read order'); ok(bg.indexOf('polls = 0') < i2, 'polls is declared before its first marker'); }
{ const f = new Function('stage', "return String(stage || 'the read').replace(/[^a-z0-9 ()-]/gi, '').slice(0, 60);"); eq(f('the read after identity poll 7'), 'the read after identity poll 7', 'a plain stage passes'); eq(f('x<script>y'), 'xscripty', 'markup is stripped'); eq(f(''), 'the read', 'empty defaults'); }
/* compound3-1.0.0 (3.0.139): a four-word name gets one more honest surname shape after the two-word retry fails */
{ const i = bg.indexOf("var cName3 = cTok.slice(-3).join(' ') + ', ' + cTok.slice(0, -3).join(' ');"); ok(i > 0, 'three-word surname shape built from the same tokens'); const blk = bg.slice(i - 400, i + 900);
  ok(blk.includes("cTok.length >= 4 && !responseSent"), 'only for four-or-more word names and only while no terminal answer went out');
  ok(blk.includes("if (frc3 && (frc3.opened || /^(ambiguous|dob-mismatch)$/.test(frc3.reason || ''))) findRes = frc3;"), 'adopted only when it opens or contradicts, like the two-word retry');
  ok(blk.includes("func: mlsFindPatientOpenDriverFn }, 42000)") && blk.includes("failOpenDeadline('compound-name open')"), 'same driver, same deadline discipline');
  ok(blk.includes("{ findRetries: 2 }") && bg.includes("{ findRetries: 1 }"), 'the refusal counts the honest retries');
  eq(bg.split('var cName3').length - 1, 1, 'one three-word retry site'); }
ok(ct.includes("'findRetries' /* compound3-1.0.0 (3.0.139) */"), 'bridge allowlist carries findRetries');
console.log('PASS navproof-diag-30136-runtime: ' + checks + ' checks');
