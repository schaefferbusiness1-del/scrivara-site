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
  const __navDiag = { eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0 };
  const fn = new Function('eaIdX', 'eaSurById', 'msg', 'eaNameOk', 'eaDobKey', 'eaWantDob', 'eaWantDate', '__navDiag',
    loop + '\nreturn { eaMatches: eaMatches, d: __navDiag };');
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
  return fn(eaIdX, eaSurById, { name: want.name }, (a, b) => norm(a) === norm(b), (v) => String(v || '').replace(/\D/g, ''), want.dob, want.date, __navDiag);
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
  eq(r.d.eaRejDate, 1, 'a surface printing another day is counted');
  ok(Object.keys(r.d).every((k) => typeof r.d[k] === 'number'), 'the receipt holds counts, never the values');
}
{
  const r = run([], { name: 'A B', dob: '121990', date: '9/14/2026' });
  eq(r.eaMatches.length, 0, 'no frames, no matches'); eq(r.d.eaMatches, 0, 'zero counted');
}

/* 2. the refusal carries the opener diag and the counts; the other counters are set at their gates */
ok(bg.includes("var __navDiag = { navChangedFrames: 0, eaSkipped: 0, eaNoCand: 0, eaCand: 0, eaTimeout: 0, eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0 };"), 'closed counter set declared per open');
ok(bg.includes("__navDiag.navChangedFrames = appointmentNavigationFrameIds.length;"), 'URL-delta frames counted');
ok(bg.includes("if (!(eaWantDob && eaWantDate && (msg.name || ''))) __navDiag.eaSkipped = 1;"), 'a skipped acceptance leg is visible');
ok(bg.includes("__navDiag.eaCand = eaCand.length; if (!eaCand.length) __navDiag.eaNoCand = 1;"), 'candidate frames counted');
ok(bg.includes("if (!(eaIdX && !eaIdX.timeout && eaSurX && !eaSurX.timeout)) __navDiag.eaTimeout = 1;"), 'an injection timeout is visible');
ok(bg.includes("diag: searchOpenDiag(Object.assign({}, (sched && sched.diag) || {}, __navDiag, { appointmentNavigationProven: false })) }); return;"), 'the refusal carries the opener diag (route, apptIdBound, regrounds) and the counts');
eq(bg.split("reason: 'appointment-navigation-unverified'").length - 1, 1, 'one worker refusal site');

/* 3. content.js carries the counts through its closed allowlist (numbers only) and apptIdBound */
ok(ct.includes("'navChangedFrames', 'eaSkipped', 'eaNoCand', 'eaCand', 'eaTimeout', 'eaMatches', 'eaRejVia', 'eaRejName', 'eaRejDob', 'eaRejEncish', 'eaRejDate'"), 'bridge allowlist carries the counts');
ok(ct.includes("safeDiag.apptIdBound = openedDiag.apptIdBound === true;"), 'bridge carries apptIdBound as a boolean');
{
  const i = ct.indexOf("'navChangedFrames', 'eaSkipped'");
  const j = ct.indexOf("var value = Number(openedDiag[key]); if (isFinite(value)) safeDiag[key] = value;", i);
  ok(i > 0 && j > i && j - i < 400, 'the counts pass only as finite numbers');
}
/* 4. readstage-1.0.0 (3.0.136): the absolute chart-read timer names the last step reached */
ok(bg.includes("ok: false, reason: 'chart-deadline-exceeded', stage: String(stage || 'the read').replace(/[^a-z0-9 ()-]/gi, '').slice(0, 60),"), 'the deadline refusal carries a closed stage string');
ok(bg.includes("var __chartStage = 'request start';"), 'the marker starts at request start');
ok(bg.includes("chartDeadlineTimer = setTimeout(() => { chartFailDeadline('the read after ' + __chartStage); }"), 'the absolute timer reports the last stage');
ok(bg.includes("__chartStage = 'tab selection';") && bg.includes("__chartStage = 'identity poll ' + polls;") && bg.includes("__chartStage = 'identity settled after ' + polls + ' polls';") && bg.includes("__chartStage = 'text read';"), 'the four step markers are set in order');
{ const i1 = bg.indexOf("__chartStage = 'tab selection';"), i2 = bg.indexOf("__chartStage = 'identity poll ' + polls;"), i3 = bg.indexOf("__chartStage = 'identity settled after ' + polls + ' polls';"), i4 = bg.indexOf("__chartStage = 'text read';"); ok(i1 > 0 && i2 > i1 && i3 > i2 && i4 > i3, 'markers follow the read order'); ok(bg.indexOf('polls = 0') < i2, 'polls is declared before its first marker'); }
{ const f = new Function('stage', "return String(stage || 'the read').replace(/[^a-z0-9 ()-]/gi, '').slice(0, 60);"); eq(f('the read after identity poll 7'), 'the read after identity poll 7', 'a plain stage passes'); eq(f('x<script>y'), 'xscripty', 'markup is stripped'); eq(f(''), 'the read', 'empty defaults'); }
console.log('PASS navproof-diag-30136-runtime: ' + checks + ' checks');
