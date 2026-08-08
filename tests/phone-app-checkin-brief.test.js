'use strict';

/* THE PRE-VISIT BRIEF ON THE DOCTOR'S PHONE.
 *
 * Owner, 2026-08-07: "it should show u[ on the docotrs phone if hes on the mobel
 * app when the sumamry is done he shouild get a ping form the app and up on the
 * phone wshould bea suimamry".
 *
 * Four things this can get wrong, and each of them is a lie of a different kind:
 *
 *  1. CLAIMING A PUSH IT DOES NOT HAVE. A real push needs APNs/FCM credentials
 *     and a server holding device tokens; neither exists. A doctor who believes
 *     his phone will buzz in his pocket and it does not is worse off than one
 *     who knows he has to open the app. So nothing in this app may promise a
 *     notification when it is closed.
 *  2. POLLING A BACKGROUNDED WEBVIEW. Its timers are frozen, so an ungated poll
 *     does nothing while away and then fires a burst on resume. The watch is
 *     gated on visibilityState and re-armed from the visibility handler.
 *  3. BUZZING FOR OLD NEWS. The first load after sign-in must mark what is
 *     already there WITHOUT announcing it, or the 9am open buzzes for
 *     yesterday's unread check-ins.
 *  4. WRITING PHI TO DISK. This app keeps patient data in one in-memory object.
 *     A check-in brief is the most sensitive text it has ever held.
 *
 * And the honesty rule this file shares with the rest of the app: a list that
 * could not be fetched must not render as "no check-ins" — the two look
 * identical and mean opposite things.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.resolve(__dirname, '..', 'app.html'), 'utf8');

/* ---------- 1. the fetch, and where its data lives ----------------------- */
assert.ok(/api\('GET','\/api\/avatar\/checkins\?status=ready'\)/.test(APP),
  'the phone no longer reads the ready check-ins');
assert.ok(/checkins: null,/.test(APP) && /ckSeen: \{\},/.test(APP),
  'the check-in state left the one in-memory state object');
/* PHI AT REST: the only keys this app may ever persist are the session token
   and the last email. Neither the briefs nor the ids of the check-ins they
   belong to may join them. */
{
  const writes = [...APP.matchAll(/localStorage\.setItem\(\s*([A-Za-z_$.]+)/g)].map((m) => m[1]);
  for (const key of writes) {
    assert.ok(key === 'TOK_KEY' || key === 'EMAIL_KEY',
      'app.html persists something new (' + key + ') — a check-in brief or its id must never reach disk');
  }
  const ck = APP.slice(APP.indexOf('function refreshCheckins'), APP.indexOf('/* ---------- find a patient'));
  assert.ok(!/localStorage|sessionStorage|indexedDB|caches/.test(ck),
    'the check-in path touches storage — the brief is the most sensitive text this app holds');
}

/* ---------- 2. the watch is visibility-gated, both ways ------------------ */
{
  const watch = APP.slice(APP.indexOf('function armCheckinWatch'), APP.indexOf('/* ---------- find a patient'));
  assert.ok(/if \(document\.visibilityState !== 'visible'\)\{ armCheckinWatch\(\); return; \}/.test(watch),
    'the poll fires while the app is backgrounded — a frozen webview timer would burst on resume');
  assert.ok(/setTimeout\(/.test(watch) && !/setInterval\(/.test(watch),
    'the watch must be a self-rescheduling timeout, not a permanent interval');
  const vis = APP.slice(APP.indexOf("document.addEventListener('visibilitychange'"), APP.indexOf('/* ---------- sign in'));
  assert.ok(/stopCheckinWatch\(\); return;/.test(vis),
    'going to the background does not stop the watch');
  assert.ok(/refreshCheckins\(true\)/.test(vis),
    'coming back to the app does not check for new briefs — the moment a doctor wants to know is the moment he looks');
}

/* ---------- 3. the first load does not buzz ------------------------------ */
{
  const auth = APP.slice(APP.indexOf('function afterAuth'), APP.indexOf('/* ---------- today'));
  assert.ok(/refreshCheckins\(false\)/.test(auth),
    'sign-in announces the check-ins that were already waiting — the 9am open would buzz for yesterday');
  assert.ok(/armCheckinWatch/.test(auth), 'the watch is never armed after sign-in');
  const ck = APP.slice(APP.indexOf('function refreshCheckins'), APP.indexOf('function buzz'));
  assert.ok(/if \(announce && fresh\.length\)/.test(ck),
    'the ping fires regardless of whether this was the first load');
  assert.ok(/S\.ckSeen\[id\] = 1/.test(ck), 'arrivals are not remembered, so every poll would re-announce everything');
}

/* ---------- 4. no promise of a push that does not exist ------------------ */
{
  /* the app may say it checks WHILE OPEN; it may not tell the doctor his phone
     will notify him when it is closed.
     CHECKED OVER STRING LITERALS, not the whole file: the first version of this
     assertion searched the source and failed on the COMMENT that explains the
     rule. A comment cannot reach a doctor's screen; a string can. (This lane has
     paid for that exact mistake once before, in a pin that forbade a retired
     button label and was defeated by the comment retiring it.) */
  const claims = /(push notification|notify you when|even when the app is closed|in the background we)/i;
  const literals = [...APP.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)]
    .map((m) => m[1] || m[2] || '');
  const bad = literals.filter((s) => claims.test(s));
  assert.deepStrictEqual(bad, [],
    'app.html promises the doctor an alert it cannot deliver. There is no APNs/FCM path — say what it does (checks while open) and nothing more');
  assert.ok(/navigator\.vibrate/.test(APP), 'the ping has no physical signal at all');
  const buzz = APP.slice(APP.indexOf('function buzz'), APP.indexOf('function stopCheckinWatch'));
  assert.ok(/try \{/.test(buzz) && /catch\(e\)\{\}/.test(buzz),
    'vibrate is not guarded — it throws on desktop Safari and iOS, and that would take the render down with it');
}

/* ---------- 5. honest states, and text-only rendering ------------------- */
{
  const sec = APP.slice(APP.indexOf('function checkinSection'), APP.indexOf('function renderPatient'));
  assert.ok(/if \(S\.ckErr\)/.test(sec),
    'a check-in list that could not be fetched renders as "no check-ins" — the two look identical and mean opposite things');
  assert.ok(!/innerHTML/.test(sec),
    'the brief is written with innerHTML — a patient\'s own words would become markup');
  assert.ok(/listCard\(/.test(sec),
    'the check-in rows bypass listCard, which is the app\'s only dynamic control');
  assert.ok(/S\.ckOpen === c\.id \? 0 : c\.id/.test(sec),
    'tapping an open brief must close it — otherwise reading one costs a second control');
  assert.ok(/askAbout/.test(sec) && /ckAsk/.test(sec), 'the gaps list is not shown on the phone');
  assert.ok(/summary corrected by the audit/.test(sec),
    'the phone does not distinguish an audited summary from a rewritten one');
  /* the headline WRAPS: the row's default is a single ellipsised line, which
     would cut the one sentence the doctor opened the app to read */
  assert.ok(/\.ckCard \.row \.name\{white-space:normal/.test(APP),
    'the headline is ellipsised to one line by the row default — it must wrap');
}

/* ---------- 6. the session boundary ------------------------------------- */
{
  const out = APP.slice(APP.indexOf('function signOut'), APP.indexOf('/* Idle lock'));
  assert.ok(/S\.checkins = null; S\.ckSeen = \{\}/.test(out),
    'sign-out leaves the briefs and the announced-ids behind — a second doctor on this phone would inherit them');
  assert.ok(/stopCheckinWatch\(\)/.test(out), 'sign-out leaves the watch running');
}

console.log('phone-app-checkin-brief.test.js: OK — reads the ready briefs, visibility-gated self-rescheduling watch, ' +
  'first load never buzzes, no push is promised, error state distinct from empty, text-only through listCard, ' +
  'and the session boundary drops both the briefs and the announced ids');
