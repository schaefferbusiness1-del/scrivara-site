'use strict';

/* recvis-1.0.0 — A PRESS THAT DOES NOT RECORD MUST SAY SO, WHERE IT WAS
 * PRESSED, WITH THE NEXT THING TO DO.
 *
 * OWNER, 2026-09-02: "sometimes when I click start recording, it doesn't
 * record."
 *
 * THE PATH, READ END TO END BEFORE ANYTHING WAS CHANGED.
 *   hero (#ez3Nxt / #ez3Now / #ez3Next / #ez3ActiveGo, data-rec != "0")
 *     -> lockAndStart(appt, {record:true})
 *     -> its last line:  var c = captureBtn(); if (c) c.click();
 *     -> #captureBtn -> toggleCapture() -> startCapture()
 * That click is fired and never read, and startCapture() returns FALSE on six
 * separate paths: the exact-scheduled-action gate, the Athena prepare gate,
 * consent not yet confirmed (it opens the dialog and returns), no recognizer
 * in this browser, a visit epoch that moved mid-start, and a throw out of
 * recog.start(). Three of those paint into #micWarn, which lives inside
 * #captureCard — a node the calm shell hides permanently (measured at b940) —
 * and the rest say nothing at all. Separately, the speech hub hands its lease
 * over ASYNCHRONOUSLY: claim() can return pending and begin() waits on
 * whenReady, by which point #captureBtn already reads "Recording… Stop Visit"
 * and `capturing` is already true while recog.start() has never been called.
 * The pill says live and not one word is captured.
 *
 * SO THIS SUITE MEASURES ONE PROPERTY, ONE FAILURE MODE AT A TIME:
 * after a press that ends with nothing recording, the lane carries a VISIBLE
 * one-line reason naming what happened and the next press — never a silent
 * no-op, and never the previous press's sentence.
 *
 * WHAT IT DOES NOT TOUCH: the consent law. Fresh consent per new encounter is
 * unchanged; the only thing added is that a consent dialog the doctor CANCELS
 * stops being silent.
 *
 * The failure modes are driven by stubbing the segment recorder's own API —
 * the surface toggleTopRecording() already calls — so the shipped lane code
 * runs exactly as it ships. No login, no microphone, no network, no PHI.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

/* ---------------------------------------------------------------- static -- */

const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

/* One sentence per mode, and each one names the next press. A reason with no
   next action is half a message. */
const SENTENCES = [
  'No patient is open, so there is no chart to lock this recording to. Choose the patient, then press Start recording again.',
  'The recorder is still loading. Wait a moment, then press Start recording again.',
  'Microphone blocked - allow it in the address bar, then press Start again.',
  'Waiting on the consent dialog - confirm consent and capture starts.',
  'Recording did not start - consent was not confirmed for this visit. Press Start recording again when you have it.',
  'The open patient changed while recording was starting, so nothing was recorded. Reopen the patient and press Start recording again.',
  'Recording did not start and MLS was not told why. Press Start again, or type/paste the visit below - nothing has been lost.',
  'The recorder is on but no words have arrived yet - check that the right microphone is selected, or press Pause and start again.'
];
SENTENCES.forEach(function (s) {
  ok(connect.indexOf(s) > 0,
    '1p-mls-connect.js no longer carries the visible reason: "' + s + '"');
});
ok(/Another recording is running \(' \+ other \+ '\) - stop it first, then press Start again\./.test(connect),
  '1p-mls-connect.js: the speech-hub conflict no longer names the lane that holds the microphone');

/* The verdict is derived from the page's own signals, never guessed. */
ok(/function recStartVerdict\(patientIdAtPress\)/.test(connect),
  '1p-mls-connect.js: recStartVerdict() is gone — the lane is back to a single generic sentence for six different causes');
ok(/function micWarnSentence\(\)/.test(connect),
  '1p-mls-connect.js: micWarnSentence() is gone, so the page\'s own mic diagnosis stays inside the node the calm shell hides');
ok(/function speechOwnerLabel\(\)/.test(connect),
  '1p-mls-connect.js: speechOwnerLabel() is gone, so a microphone held by dictation or the phone is reported as "no reason"');
ok(/function consentAskOpen\(\)/.test(connect),
  '1p-mls-connect.js: consentAskOpen() is gone — an open consent dialog will be painted as a failure');

/* EVERY door, not just this lane's pill: b940 moved starting to the hero. */
ok(connect.indexOf("var REC_START_SEL = '#ez3ActiveGo,#ez3Rec,#ez3Rec2,#ez3Next,#ez3Nxt,#ez3Now,#captureBtn,.ez3fl-recbtn';") > 0,
  '1p-mls-connect.js: the record-start door list is gone, so a hero press (the one the owner is describing) is unwatched again');
ok(/function recPressWanted\(el\) \{[\s\S]{0,200}data-rec'\) !== '0'/.test(connect),
  '1p-mls-connect.js: the data-rec="0" guard is gone — pressing "next patient" would now be judged as a failed recording');
ok(/document\.addEventListener\('click', laneRecordPress, true\);/.test(connect),
  '1p-mls-connect.js: the record-press listener is not installed');
ok(/document\.removeEventListener\('click', laneRecordPress, true\);/.test(connect),
  '1p-mls-connect.js: revert() leaves the record-press listener behind');

/* NO NEW TIMER (hidden-tab law): every elapsed-time judgement is read from
   Date.now() on a pass the lane already runs. */
ok(/\(Date\.now\(\) - _recArmed\.at\) > REC_ARM_GRACE_MS/.test(connect),
  '1p-mls-connect.js: the armed-press grace is no longer measured from Date.now() on an existing pass');
ok(/\(Date\.now\(\) - _recLive\.since\) > REC_SILENT_MS/.test(connect),
  '1p-mls-connect.js: the "on but silent" check is no longer measured from Date.now() on an existing pass');
const recvis = connect.slice(connect.indexOf('recvis-1.0.0 begin'), connect.indexOf('recvis-1.0.0 end'));
ok(recvis.length > 500, '1p-mls-connect.js: the recvis-1.0.0 block markers are gone, so this file scan proves nothing');
eq((recvis.match(/setInterval\s*\(/g) || []).length, 0,
  'recvis-1.0.0 added a setInterval; a hidden tab freezes it and this block is required to ride passes the lane already runs');

/* The reason must not be gated on the record pill: b940 hides that pill in
   exactly the idle state the hero starts from. */
ok(/var show = !!\(_recFail && _recFail\.why\);/.test(connect),
  '1p-mls-connect.js: the reason row is gated on something other than "there is a reason" — b940 hides the record pill in the idle state, which is the one state this message exists for');

/* --------------------------------------------------------------- runtime -- */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      if (p.endsWith('/')) p += 'index.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function harness() {
  const NAMES = ['Ada Sample', 'Bo Sample'];
  const local = new Date();
  const DAY = (typeof window._acctTodayKey === 'function' && /^\d{4}-\d{2}-\d{2}$/.test(String(window._acctTodayKey() || '')))
    ? String(window._acctTodayKey())
    : (local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') + '-' + String(local.getDate()).padStart(2, '0'));

  window.__srT = {
    DAY,
    seed() {
      try {
        savePatients(NAMES.map((n, i) => ({
          id: 'syn-' + i, name: n, dob: '196' + i + '-01-0' + (i + 1),
          mrn: 'MRN' + (300000 + i), athenaId: String(920000 + i), notes: [], visits: []
        })));
      } catch (e) { return -1; }
      window._calAppts = NAMES.map((n, i) => ({
        id: 'sr-' + i, name: n, patientId: 'syn-' + i, appt_date: DAY,
        start_at: DAY + 'T0' + (8 + i) + ':00:00', reason: 'Lumbar medial branch block',
        providerName: 'Sample Provider, MD'
      }));
      try { renderPatients(); } catch (e) {}
      try { return getPatients().length; } catch (e) { return -1; }
    },
    /* selectPatient() is the Patients-page path and the one that actually
       moves canonical identity (getActivePtId), which is half of what
       verifiedActivePatient() compares; openPatient() alone left both empty.
       Both are called, in that order, exactly as lockAndStartPatient does. */
    pick(i) {
      try {
        const p = getPatients();
        const t = p[(i || 0) % p.length];
        if (!t) return '';
        try { if (typeof window.selectPatient === 'function') window.selectPatient(t.id); } catch (e) {}
        try { openPatient(t.id); } catch (e) {}
        return t.name;
      } catch (e) {}
      return '';
    },
    /* THE STUB. window.__mlsRecSegments is the surface toggleTopRecording()
       already calls, so replacing it drives the shipped lane code through each
       real failure shape without a microphone. `mode` decides the shape. */
    stubRecorder(mode) {
      window.__srMode = mode;
      window.__mlsRecSegments = {
        installed: true,
        CONSENT_PENDING: 'consent-pending',
        isArmed() { return false; },
        stopSegment() { return null; },
        startSegment() {
          const m = window.__srMode;
          if (m === 'throw') throw new Error('recognizer unavailable');
          if (m === 'consent') return 'consent-pending';
          if (m === 'ok') {
            const b = document.getElementById('captureBtn');
            if (b) { b.classList.add('recording'); b.textContent = '⏹ Stop recording'; }
            return 'seg-1';
          }
          return null;   /* the fail-closed refusal */
        }
      };
      return true;
    },
    micWarn(text) {
      const w = document.getElementById('micWarn');
      if (!w) return false;
      const span = w.querySelector('span');
      if (span) span.textContent = String(text || '');
      w.style.display = text ? 'flex' : 'none';
      return true;
    },
    /* A second lane holding the microphone, through the app's own hub. */
    claimHub(label) {
      try {
        const hub = (typeof window.mlsSpeechHub === 'function') ? window.mlsSpeechHub() : window.__mlsSpeechHub;
        if (!hub) return false;
        hub.register('dictate', label, function () { return true; });
        hub.claim('dictate');
        return true;
      } catch (e) { return false; }
    },
    releaseHub() { try { (window.__mlsSpeechHub || {}).release && window.__mlsSpeechHub.release('dictate'); } catch (e) {} return true; },
    consentOpen(on) { window._mlsConsentAsk = on ? Promise.resolve(false) : null; return true; },
    capture(on) {
      const b = document.getElementById('captureBtn');
      if (!b) return false;
      b.classList.toggle('recording', !!on);
      b.textContent = on ? '⏹ Stop recording' : '▶ Start Visit';
      return true;
    },
    setTranscript(v) {
      const t = document.getElementById('transcript');
      if (t) { t.value = v; try { t.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
      const top = document.getElementById('ez3flTranscript');
      if (top) top.value = v;
      return true;
    },
    clearVerdict() {
      try { window.__mlsEz3Flow.recRun.clear(); } catch (e) {}
      return true;
    },
    pressPill() {
      const b = document.querySelector('.ez3fl-recbtn');
      if (!b) return false;
      b.click();
      return true;
    },
    /* A HERO press, exactly as the engine renders one: a data-rec="1" control
       whose handler ends in captureBtn().click(). The synthetic control is the
       point — this proves the lane answers for a door it does not own. */
    pressHero() {
      /* One of the engine's OWN hero ids, chosen from the ones not currently
         rendered, and given no handler at all. That is the whole point: the
         lane must answer for a door it does not own and whose click it cannot
         read. Pressing a hero the engine did render would run lockAndStart()
         and re-render #ez3Wrap, which measures the engine, not this. */
      const ids = ['ez3Now', 'ez3Nxt', 'ez3Next', 'ez3ActiveGo'];
      const free = ids.filter((i) => !document.getElementById(i));
      if (!free.length) return false;
      const hero = document.createElement('button');
      hero.type = 'button';
      hero.id = free[0];
      hero.setAttribute('data-rec', '1');
      hero.textContent = '🎙 Start Recording — Ada Sample';
      const wrap = document.getElementById('ez3Wrap') || document.getElementById('mlsEz3Body');
      if (!wrap) return false;
      wrap.appendChild(hero);
      window.__srHeroId = hero.id;
      hero.click();
      return true;
    },
    dropHero() {
      const h = window.__srHeroId ? document.getElementById(window.__srHeroId) : null;
      if (h && h.parentNode) h.parentNode.removeChild(h);
      window.__srHeroId = '';
      return true;
    },
    row() {
      const r = document.querySelector('.ez3fl-recfail');
      if (!r) return { exists: false };
      const why = r.querySelector('.ez3fl-refailwhy');
      const go = r.querySelector('.ez3fl-refailgo');
      const rect = r.getBoundingClientRect();
      const cs = getComputedStyle(r);
      return {
        exists: true,
        visible: !r.hidden && rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
        why: String((why && why.textContent) || '').trim(),
        kind: r.getAttribute('data-kind') || '',
        live: String(r.getAttribute('aria-live') || ''),
        retry: !!(go && !go.hidden)
      };
    },
    counter() {
      const c = document.getElementById('ez3flCount');
      return c ? { text: String(c.textContent || '').trim(), live: c.getAttribute('data-live') || '' } : null;
    },
    recRun() { try { return window.__mlsEz3Flow.recRun.state(); } catch (e) { return null; } },
    /* The lane refuses a press with no chart to lock the recording to, which
       is correct and is its own mode below - but every OTHER mode has to be
       measured with a patient really open, or they all collapse into that one
       sentence. This is the same pair of signals verifiedActivePatient() reads. */
    active() {
      let ap = null, id = '';
      try { ap = (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) {}
      try { id = (typeof window.getActivePtId === 'function') ? String(window.getActivePtId() || '') : ''; } catch (e) {}
      return { name: (ap && ap.name) || '', apId: (ap && ap.id != null) ? String(ap.id) : '', activeId: id,
        agree: !!(ap && ap.id != null && id && String(ap.id) === id) };
    }
  };
}

async function until(page, fn, pred, ms) {
  const deadline = Date.now() + ms;
  let s = null;
  for (;;) {
    s = await page.evaluate(fn);
    if (pred(s)) return s;
    if (Date.now() > deadline) return s;
    await page.waitForTimeout(200);
  }
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!(window.__mlsEz3Flow && window.__mlsEz3Flow.installed), null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'start-recording-visible@mlsscribe.test';
    });
    await page.evaluate(harness);
    eq(await page.evaluate(() => window.__srT.seed()), 2, 'the synthetic roster did not land');
    await page.evaluate(() => { const b = document.getElementById('nav_visit'); if (b) b.click(); });
    await page.waitForTimeout(1200);
    ok(!!(await page.evaluate(() => window.__srT.pick(0))), 'no patient could be opened');
    await page.waitForTimeout(4000);
    const who = await until(page, () => window.__srT.active(), (x) => x.agree, 20000);
    ok(who.agree,
      `the harness could not get a chart open and agreed-on (${JSON.stringify(who)}); every mode below would collapse into the no-patient refusal`);

    let row = await until(page, () => window.__srT.row(), (x) => x.exists, 12000);
    ok(row.exists, 'the lane has no .ez3fl-recfail row at all — there is nowhere for a failed press to leave a mark');
    eq(row.visible, false, 'the reason row is painted before anything has failed');
    eq(row.live, 'polite', 'the reason row is not announced to assistive tech (aria-live)');

    /* ---- MODE 1: the recorder refused and the page knows the mic is blocked */
    await page.evaluate(() => {
      window.__srT.clearVerdict();
      window.__srT.stubRecorder('fail');
      window.__srT.micWarn('Microphone access was blocked. Allow mic access in your browser, or just type/paste the visit below.');
      window.__srT.setTranscript('Some captured words so the pill is offered.');
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__srT.pressPill());
    row = await until(page, () => window.__srT.row(), (x) => x.visible, 8000);
    ok(row.visible, 'a press that ended with nothing recording left NO visible reason — the exact silent no-op the owner is describing');
    eq(row.why, 'Microphone blocked - allow it in the address bar, then press Start again.',
      `the blocked microphone was not named; the lane said "${row.why}"`);
    eq(row.kind, 'err', 'a blocked microphone is not painted as a stop');
    ok(row.retry, 'a stopped recorder offers no way to try again');

    /* ---- MODE 2: another lane is holding the microphone ------------------ */
    await page.evaluate(() => {
      window.__srT.clearVerdict();
      window.__srT.micWarn('');
      window.__srT.claimHub('Dictate anywhere');
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__srT.pressPill());
    row = await until(page, () => window.__srT.row(), (x) => x.visible && /another recording/i.test(x.why), 8000);
    ok(/^Another recording is running \(Dictate anywhere\) - stop it first, then press Start again\.$/.test(row.why),
      `a microphone held by another lane was not named; the lane said "${row.why}"`);
    await page.evaluate(() => window.__srT.releaseHub());

    /* ---- MODE 3: it refused and nothing on the page knows why ------------ */
    await page.evaluate(() => { window.__srT.clearVerdict(); window.__srT.micWarn(''); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__srT.pressPill());
    row = await until(page, () => window.__srT.row(), (x) => x.visible && /not told why/i.test(x.why), 8000);
    ok(/nothing has been lost/.test(row.why),
      `an unexplained refusal did not say so, and did not say the transcript is safe; the lane said "${row.why}"`);

    /* ---- MODE 4: the start threw --------------------------------------- */
    await page.evaluate(() => { window.__srT.clearVerdict(); window.__srT.stubRecorder('throw'); });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__srT.pressPill());
    row = await until(page, () => window.__srT.row(), (x) => x.visible && /hit an error/i.test(x.why), 8000);
    ok(/recognizer unavailable/.test(row.why),
      `an exception out of the start path was swallowed instead of named; the lane said "${row.why}"`);

    /* ---- MODE 5: consent is pending, then cancelled ---------------------- */
    await page.evaluate(() => {
      window.__srT.clearVerdict();
      window.__srT.stubRecorder('consent');
      window.__srT.consentOpen(true);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__srT.pressPill());
    await page.waitForTimeout(1200);
    row = await page.evaluate(() => window.__srT.row());
    ok(!row.visible || !/did not start/i.test(row.why),
      `an OPEN consent dialog was painted as a failure ("${row.why}") — the app would be contradicting itself in front of the patient`);
    /* the doctor presses Cancel: the dialog closes and nothing records */
    await page.evaluate(() => window.__srT.consentOpen(false));
    row = await until(page, () => window.__srT.row(), (x) => x.visible && /consent was not confirmed/i.test(x.why), 12000);
    ok(/Press Start recording again when you have it\./.test(row.why),
      `a cancelled consent dialog left the press silent; the lane said "${row.why}"`);

    /* ---- MODE 6: THE HERO, which is the door the owner actually presses -- */
    await page.evaluate(() => {
      window.__srT.clearVerdict();
      window.__srT.stubRecorder('fail');
      window.__srT.micWarn('');
    });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => window.__srT.pressHero()), 'no hero record control could be pressed');
    row = await until(page, () => window.__srT.row(), (x) => x.visible, 12000);
    const heroDiag = await page.evaluate(() => ({ rec: window.__srT.recRun(), active: window.__srT.active() }));
    ok(row.visible,
      'THE OWNER\'S SENTENCE, REPRODUCED: the HERO "Start Recording" press ended with nothing recording and the app said nothing. b940 moved starting to the hero and hides the lane pill in that state, so a reason gated on the pill would be invisible in the one case it exists for. Saw: ' + JSON.stringify(heroDiag));
    ok(/Press Start again|Press Start recording again/.test(row.why),
      `the hero failure named no next press; the lane said "${row.why}"`);
    await page.evaluate(() => window.__srT.dropHero());

    /* ---- MODE 7: SUCCESS is unmistakable, and the counter MOVES ---------- */
    await page.evaluate(() => {
      window.__srT.clearVerdict();
      window.__srT.stubRecorder('ok');
      window.__srT.setTranscript('one two three');
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__srT.pressPill());
    let counter = await until(page, () => window.__srT.counter(), (x) => x && x.live === '1', 8000);
    ok(counter && counter.live === '1', 'capture is live and the word counter does not say so');
    ok(/^Listening - 3 words captured$/.test(counter.text),
      `the live counter reads "${counter && counter.text}" — a doctor cannot tell a live microphone from text pasted an hour ago`);
    row = await page.evaluate(() => window.__srT.row());
    eq(row.visible, false, `a successful start still shows a failure reason ("${row.why}")`);
    await page.evaluate(() => window.__srT.setTranscript('one two three four five'));
    counter = await until(page, () => window.__srT.counter(), (x) => /5 words/.test(x.text), 8000);
    ok(/^Listening - 5 words captured$/.test(counter.text),
      `the live counter did not move as words arrived (read "${counter.text}") — a number that changes is the only proof of a live microphone that does not ask the doctor to trust a label`);

    /* ---- MODE 8: the pill says live and NOTHING is arriving -------------- */
    /* This is the speech-hub handover: capturing:true, the button already
       repainted, recog.start() never called. It is deliberately slow to
       accuse — a doctor may be quiet at the top of a visit — so the suite
       waits out the real threshold rather than shortening it. */
    const silentMs = await page.evaluate(() => window.__mlsEz3Flow.recRun.SILENT_MS);
    ok(silentMs >= 10000, `the silent-recorder threshold is ${silentMs} ms, short enough to accuse a doctor who simply paused`);
    /* Stop first and let one sync land: once words HAVE arrived this lane
       deliberately stops accusing the microphone for the rest of that session,
       so a fresh live session is what this mode is about. */
    await page.evaluate(() => { window.__srT.clearVerdict(); window.__srT.capture(false); });
    await until(page, () => window.__srT.recRun(), (x) => x && !x.live, 8000);
    await page.waitForTimeout(3000);
    const fresh = await page.evaluate(() => window.__srT.recRun());
    eq(fresh.wordsMoved, false, 'the live-session memory did not reset when capture stopped, so the silent-recorder check can never arm again');
    await page.evaluate(() => { window.__srT.clearVerdict(); window.__srT.capture(true); });
    row = await until(page, () => window.__srT.row(),
      (x) => x.visible && /no words have arrived/i.test(x.why), silentMs + 12000);
    ok(row.visible && /no words have arrived/i.test(row.why),
      `capture reported live for over ${silentMs} ms with no words at all and the lane said nothing — that is the shape of "it doesn't record" with the pill insisting it does (saw ${JSON.stringify(row)})`);
    eq(row.kind, 'warn', 'an observation about a quiet microphone is painted as a hard refusal');
    eq(row.retry, false, 'the "on but silent" state offers Start again while it is already on — the honest action there is Pause');

    const fatal = pageErrors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
    eq(fatal.length, 0, `page errors during the start-recording proof: ${JSON.stringify(fatal.slice(0, 4))}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log(`start-recording-visible-proof: ${checks} checks passed`);
}).catch((e) => {
  console.error('start-recording-visible-proof FAILED:', e && e.message);
  process.exit(1);
});
