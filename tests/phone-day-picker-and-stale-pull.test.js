'use strict';
/*
 * THE PHONE'S DAY PICKER, AND THE ANSWER THAT ARRIVES AFTER YOU HAVE LEFT.
 *
 * phday-1.0.0 gave the phone app a real day control (#dayInput -> goToDay), so
 * the doctor can move off "today" in one tap. It shipped in b1092 with NO
 * behavioural test - the only thing referencing it anywhere in tests/ was an
 * allow-list entry in phone-app-control-budget. A completeness review found
 * that, and found what the missing test would have caught:
 *
 *   pullDay() captures `var date = S.date` and then, in an async callback,
 *   writes S.msg and renders - with no check that S.date is still `date`.
 *   refreshToday() has had exactly that guard since it was written ("the day
 *   moved under us; drop the stale answer"). pullDay never got one.
 *
 * So a pull started on Tuesday that lands after the doctor has tapped through
 * to Wednesday paints Tuesday's sentence - a count, or a Tuesday-specific error
 * - under Wednesday's heading. The day picker is what made that easy to reach.
 *
 * This file EXECUTES the shipped functions. app.html is one inline script, so
 * each function is lifted by quote-aware brace matching - a brace inside a
 * string is not structure, and a slice that swallows a neighbour would not
 * parse.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

function lift(marker) {
  const at = app.indexOf(marker);
  assert.ok(at >= 0, 'app.html no longer defines ' + marker);
  let i = app.indexOf('{', at), depth = 0, quote = '', escaped = false;
  for (; i < app.length; i++) {
    const ch = app[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return app.slice(at, i + 1); }
  }
  throw new Error('unbalanced: ' + marker);
}

/* ---- 1. THE CONTROL EXISTS AND IS REACHABLE ---------------------------- */
ok(/<div id="todayDayNav"/.test(app), 'the phone day nav is gone');
ok(/<input id="dayInput" type="date"/.test(app),
  'the phone day picker is gone - the doctor is locked to today again, which is the report phday-1.0.0 answered');
ok(/aria-label="Which day/.test(app), 'the day picker lost its accessible name');

/* ---- 2. goToDay IS THE ONLY WRITER OF S.date -------------------------- */
{
  const writers = [...app.matchAll(/S\.date\s*=\s*(?!==)/g)];
  eq(writers.length, 1,
    'S.date has ' + writers.length + ' writers. One writer is what keeps the heading, the pull and the ' +
    'read-back agreeing about which day is on screen; a second one can move the day without clearing ' +
    'the appointments or the message.');
  const inGoToDay = lift('function goToDay(iso){');
  ok(/S\.date\s*=\s*next;/.test(inGoToDay), 'the single S.date writer is no longer inside goToDay');
}

/* ---- 3. goToDay EXECUTED: it validates, clears, and refuses a no-op ---- */
{
  const runGoToDay = (startDate, arg) => {
    const calls = { render: 0, refresh: 0 };
    const sandbox = {
      S: { date: startDate, appts: [{ id: 'a1' }], msg: { kind: 'ok', text: 'stale text' } },
      render() { calls.render++; },
      refreshToday() { calls.refresh++; return { then() {} }; },
      String, RegExp
    };
    vm.createContext(sandbox);
    vm.runInContext(lift('function goToDay(iso){') + '\nthis.__go=goToDay;', sandbox);
    sandbox.__go(arg);
    return { S: sandbox.S, calls };
  };

  const moved = runGoToDay('2026-08-24', '2026-08-25');
  eq(moved.S.date, '2026-08-25', 'goToDay did not move the day');
  eq(moved.S.appts, null,
    "goToDay left the PREVIOUS day's appointments on screen under the new day's heading");
  eq(moved.S.msg, null,
    "goToDay left the previous day's message on screen - it would describe a day the doctor has left");
  eq(moved.calls.render, 1, 'goToDay did not repaint');
  eq(moved.calls.refresh, 1, 'goToDay did not re-read the new day');

  for (const bad of ['', 'tomorrow', '2026-8-5', '08/25/2026', null, undefined]) {
    const r = runGoToDay('2026-08-24', bad);
    eq(r.S.date, '2026-08-24', 'goToDay accepted a malformed day: ' + JSON.stringify(bad));
    eq(r.calls.refresh, 0, 'goToDay re-read the day for a malformed input: ' + JSON.stringify(bad));
  }

  const same = runGoToDay('2026-08-24', '2026-08-24');
  eq(same.calls.refresh, 0, 're-picking the SAME day starts another read - a tap that changes nothing should cost nothing');
  ok(same.S.appts !== null, 're-picking the same day threw away the appointments already on screen');
}

/* ---- 4. THE DEFECT: a pull answering about a day the doctor has left --- */
{
  const runPull = (opts) => {
    const painted = [];
    let relayCb = null;
    let refreshResolve = null;
    const sandbox = {
      S: { date: opts.startDate, appts: opts.appts || [], msg: null },
      relayPull(kind, payload, key, cb) { relayCb = cb; },
      render() { painted.push(sandbox.S.msg && sandbox.S.msg.text); },
      refreshToday() { return { then(fn) { refreshResolve = fn; } }; },
      longDate(iso) { return 'LONG(' + iso + ')'; },
      String
    };
    vm.createContext(sandbox);
    vm.runInContext(lift('function pullDay(){') + '\nthis.__pull=pullDay;', sandbox);
    sandbox.__pull();
    if (opts.moveTo) sandbox.S.date = opts.moveTo;      // the doctor taps to another day
    relayCb(opts.res);                                   // ...and only THEN the pull answers
    if (refreshResolve) {
      if (opts.moveDuringReadBack) sandbox.S.date = opts.moveDuringReadBack;
      refreshResolve();
    }
    return { S: sandbox.S, painted: painted.filter((t) => t != null) };
  };

  /* control: nobody moved - the answer is shown, as it must be */
  {
    const r = runPull({ startDate: '2026-08-24', res: { ok: true, data: { pulled: '2026-08-24' } }, appts: [{}, {}] });
    ok(r.painted.length > 0, 'CONTROL FAILED: a pull that nobody interrupted painted nothing, so the ' +
      'staleness assertions below would pass on a harness that cannot paint at all');
    ok(r.painted.some((t) => /LONG\(2026-08-24\)/.test(t)),
      'CONTROL FAILED: the pull did not report the day it was started for');
  }

  /* the doctor moves before the pull answers */
  for (const [label, res] of [
    ['a successful pull', { ok: true, data: { pulled: '2026-08-24' } }],
    ['a failed pull', { ok: false, error: 'the office computer refused' }],
    ['a pull that answered about another date', { ok: true, data: { pulled: '2026-08-19' } }]
  ]) {
    const r = runPull({ startDate: '2026-08-24', moveTo: '2026-08-25', res, appts: [{}, {}] });
    eq(r.painted.length, 0,
      label + ' painted a message after the doctor had already moved to another day. Whatever it says ' +
      'describes 2026-08-24 while the screen shows 2026-08-25 - a count, or an error naming the old ' +
      "day, under the new day's heading. Painted: " + JSON.stringify(r.painted));
    eq(r.S.msg, null, label + ' left a stale message in state for a day the doctor has left');
  }

  /* and the read-back is async too - moving during THAT must be dropped as well */
  {
    const r = runPull({
      startDate: '2026-08-24', res: { ok: true, data: { pulled: '2026-08-24' } },
      appts: [{}, {}], moveDuringReadBack: '2026-08-26'
    });
    ok(!r.painted.some((t) => /LONG\(2026-08-24\)/.test(t) && /patients are/.test(t)),
      'the read-back count for the old day was painted after the doctor moved during the read-back itself');
  }
}

/* ---- 5. the guard is REAL in the source, not just satisfied by a stub -- */
{
  const pullSrc = lift('function pullDay(){');
  ok(/function stale\(\)\s*\{\s*return S\.date !== date;\s*\}/.test(pullSrc),
    'pullDay lost its staleness test');
  const guards = (pullSrc.match(/if \(stale\(\)\) return;/g) || []).length;
  ok(guards >= 2,
    'pullDay checks staleness ' + guards + ' time(s). It needs one when the pull answers AND one after ' +
    'the async read-back, because the doctor can move during either.');
}

console.log('PASS phone day picker and stale pull: ' + checks +
  ' checks - the day control exists and is labelled, goToDay is the ONLY writer of S.date and clears the ' +
  "previous day's appointments and message, malformed and no-op days change nothing, and a pull that " +
  'answers after the doctor has moved to another day is DROPPED rather than painted under the wrong ' +
  'heading - proven against a control that shows the same pull does paint when nobody moves');
