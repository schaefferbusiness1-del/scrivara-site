'use strict';
/*
 * AMBIENT ROOM MODE - EXECUTED PROOF (real Chrome, Playwright clock)
 * =============================================================================
 * Owner, 2026-08-06: "make it possible for the avatar to just sit back and
 * listen for even when the doctor comes back and just put that into the text
 * box once done to be turned into all the notes and stuff ... just like having
 * someone else in the room to ask questions then take notes all for the
 * doctor."
 *
 * Nothing here is proved by reading the source. Every claim is executed in a
 * real Chrome page against the real feat_mls_avatar.js, with the recogniser,
 * the speech engine and the network stubbed so the test can DRIVE them, and
 * with Playwright's clock so a 90 minute exam takes a second.
 *
 * SCENARIOS
 *   0  CONTROL      - a normal interview left silent DOES auto-finish. Without
 *                     this the ambient claim below is unfalsifiable: a watchdog
 *                     that never fires at all would "pass" requirement 2.
 *   A  HAPPY PATH   - intake interview -> staff PIN -> "keep listening" ->
 *                     ~30 minutes of exam with silences and a dead recogniser
 *                     -> staff PIN -> "end". Asserts (a) (b) (d) (e) + silence
 *                     + the restart loop.
 *   B  WRONG CHART  - the same capture, but the open chart changes. Asserts (c):
 *                     refuse, say so on screen, write NOTHING.
 *   C  90 MIN CAP   - the capture ends itself at the cap and says so on screen,
 *                     and what it heard is still filed.
 * =========================================================================== */
/* av-5.7.0 — THE STAFF CONSENT TAP. The kiosk now asks "Did the patient
   consent to being recorded?" before it opens a microphone, posts a turn or
   goes fullscreen, so every scenario below answers it exactly as a member of
   staff does. If that button ever disappears these harnesses stop dead at the
   first turn, which is the correct failure: no consent, no interview. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

/* ---- playwright, from NODE_PATH or the known scratchpad install ---- */
function loadChromium() {
  const tries = [];
  if (process.env.NODE_PATH) String(process.env.NODE_PATH).split(path.delimiter).forEach(function (p) {
    if (p) tries.push(path.join(p, 'playwright'));
  });
  tries.push('playwright');
  tries.push('C:/Users/Micha/AppData/Local/Temp/claude/C--Users-Micha-Desktop-MLS-EVERYTHING/38a6e0a5-5b39-441e-be19-061b956571ff/scratchpad/node_modules/playwright');
  for (let i = 0; i < tries.length; i++) {
    try { return require(tries[i]).chromium; } catch (e) { /* next */ }
  }
  throw new Error('playwright not resolvable; set NODE_PATH. Tried:\n  ' + tries.join('\n  '));
}

const ROOT = path.resolve(__dirname, '..');
/* AVATAR_SRC_OVERRIDE exists for ONE purpose: running this proof against the
   PRE-CHANGE file to confirm it actually fails there. A test that passes
   against the code it is supposed to be testing is not a test. */
const SRC_PATH = process.env.AVATAR_SRC_OVERRIDE || path.join(ROOT, 'feat_mls_avatar.js');
const AVATAR_SRC = fs.readFileSync(SRC_PATH, 'utf8');

/* The doctor's transcript BEFORE the avatar touches it. Deliberately hostile to
   a careless writer: a tab, runs of trailing spaces before newlines, a real
   em-dash, and a trailing newline. `addToTranscript` (the older writer in this
   file) would eat the trailing whitespace with its .replace(/\s+$/,''); the
   ambient writer must not. */
const PRE = 'Doctor draft in progress.\tTabbed line.   \n' +
            'Patient said: "it hurts" \u2014 since Tuesday.  \n\n' +
            'BP 130/84    \n';

const HTML = '<!doctype html><meta charset="utf-8"><title>ambient proof</title>' +
  '<body style="margin:0;font-family:system-ui">' +
  '<div id="visitView"><h3>Visit</h3>' +
  '<div class="ez3fl-transcript"><label for="ez3flTranscript">Transcript</label>' +
  '<textarea id="ez3flTranscript" rows="10" style="width:90%"></textarea></div></div>' +
  '</body>';

/* --------------------------------------------------------------------------
   Page stubs. Installed before ANY page script so the module never sees a real
   microphone, a real voice or a real network.
   -------------------------------------------------------------------------- */
function STUBS() {
  window.__log = { fetches: [], speaks: [], toasts: [], inputEvents: 0, recStarts: 0 };
  window.__activePt = 'ext-77';
  window.__turnQueue = [];

  window.getActivePtId = function () { return window.__activePt; };
  window.getPatients = function () { return [{ id: 'ext-77', name: 'Test Patient' }]; };
  window.upsertPatient = function () {};
  window.toast = function (m) { window.__log.toasts.push(String(m)); };
  window.bkToken = function () { return 'tok'; };
  window.bkBase = function () { return 'https://backend.test'; };

  function jres(obj, status) {
    return Promise.resolve({
      ok: (status || 200) < 400,
      status: status || 200,
      headers: { get: function () { return 'application/json'; } },
      json: function () { return Promise.resolve(obj); },
      blob: function () { return Promise.resolve(new Blob([''])); }
    });
  }
  window.fetch = function (url, opts) {
    const u = String(url);
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { body = {}; }
    window.__log.fetches.push({ url: u, body: body, at: Date.now() });
    /* a 503 from the TTS proxy trips the module's own circuit breaker, so every
       later sentence goes straight to the (stubbed, countable) synth path */
    if (u.indexOf('/api/avatar/office/tts') >= 0) return jres({ error: 'no tts in test' }, 503);
    if (u.indexOf('/api/avatar/office/unlock') >= 0) return jres({ ok: true });
    if (u.indexOf('/api/avatar/office/turn') >= 0) {
      if (body.finish) return jres({ ok: true, done: true, say: 'Thanks, all set.' });
      const next = window.__turnQueue.shift();
      return jres(next || { ok: true, done: true, say: 'Thanks, all set.' });
    }
    if (u.indexOf('/api/avatar/checkins') >= 0) return jres({ ok: true, checkins: [] });
    return jres({ ok: true });
  };

  const synth = {
    speaking: false,
    speak: function (u) {
      window.__log.speaks.push({ text: String(u.text || ''), at: Date.now() });
      setTimeout(function () { if (u.onend) u.onend(); }, 5);
    },
    cancel: function () {},
    getVoices: function () { return []; },
    addEventListener: function () {}
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); }
  catch (e) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.onend = null; this.onerror = null; };

  const md = { getUserMedia: function () { return Promise.resolve({ getTracks: function () { return []; } }); } };
  try { Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true }); } catch (e) {}

  /* the drivable recogniser */
  window.__recs = [];
  window.SpeechRecognition = function () {
    const self = this;
    this.lang = ''; this.interimResults = false; this.continuous = false;
    this.onresult = null; this.onend = null; this.onerror = null;
    this.live = false;
    this.start = function () {
      if (self.live) throw new Error('already started');
      self.live = true;
      window.__recs.push(self);
      window.__log.recStarts++;
    };
    this.stop = function () { self.live = false; };
    this.abort = function () { self.live = false; };
  };
  window.__lastRec = function () { return window.__recs[window.__recs.length - 1] || null; };
  window.__emit = function (text, isFinal) {
    const r = window.__lastRec();
    if (!r || !r.onresult) return false;
    const one = [{ transcript: text }];
    one.isFinal = !!isFinal;
    r.onresult({ resultIndex: 0, results: [one] });
    return true;
  };
  window.__die = function () {           /* Chrome ending the recogniser on its own */
    const r = window.__lastRec();
    if (!r || !r.onend) return false;
    r.live = false;
    r.onend();
    return true;
  };

  /* what the room can SEE - computed, not attributes */
  window.__vis = function (id) {
    const el = document.getElementById(id);
    if (!el) return { present: false, visible: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const root = document.getElementById('mlsAvKiosk');
    return {
      present: true,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      w: Math.round(r.width), h: Math.round(r.height),
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0,
      inKiosk: !!(root && root.contains(el)),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim()
    };
  };
  window.__say = function () {
    const s = document.getElementById('mlsAvKioskSay');
    const i = document.getElementById('mlsAvKioskInterim');
    return {
      say: s ? (s.textContent || '') : null,
      interim: i ? (i.textContent || '') : null,
      classes: (function () { const r = document.getElementById('mlsAvKiosk'); return r ? r.className : null; })()
    };
  };
  window.__box = function () { return document.getElementById('ez3flTranscript').value; };
  /* tolerant on purpose: run against a build WITHOUT ambient mode and this
     reports the absence as data instead of exploding, so the falsification
     run produces a list of FAILED checks rather than one stack trace. */
  window.__amb = function () {
    try { return window.__mlsAvatar.ambientState(); }
    catch (e) { return { running: null, boundPatient: null, capturedChars: null, filed: null, last: null, missing: String((e && e.message) || e) }; }
  };
  window.__turnPosts = function () {
    return window.__log.fetches.filter(function (f) { return f.url.indexOf('/api/avatar/office/turn') >= 0; });
  };
}

/* -------------------------------------------------------------------------- */
const results = [];
let failures = 0;
function check(label, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push((ok ? '  PASS  ' : '  FAIL  ') + label + (detail === undefined ? '' : ('  [' + detail + ']')));
  return ok;
}
function section(name) { results.push(''); results.push('== ' + name + ' =='); }

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(String(e && e.message || e)); });
  page.on('console', function (m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.clock.install({ time: new Date('2026-08-06T14:00:00Z') });
  await page.setContent(HTML);
  await page.evaluate(STUBS);
  await page.evaluate(function (pre) {
    document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
    const box = document.getElementById('ez3flTranscript');
    box.value = pre;
    box.addEventListener('input', function () { window.__log.inputEvents++; });
  }, PRE);
  await page.addScriptTag({ content: AVATAR_SRC });
  await page.clock.runFor(4000);          /* the module's bounded mount ladder */
  return { page: page, errors: errors };
}

/* Drive the intake interview to completion. Leaves the kiosk AT REST behind the
   PIN, which is the real handoff point ambient mode hangs off. */
async function runIntake(page) {
  await page.evaluate(function () {
    window.__turnQueue = [
      { ok: true, say: 'Hello, what brings you in today?', avatar: { name: 'Ava', exitPinSet: true }, progress: { covered: 1, total: 3 } },
      { ok: true, say: 'How long has the knee been like that?', progress: { covered: 2, total: 3 } },
      { ok: true, done: true, say: 'Thank you, that is everything I needed.' }
    ];
    window.__mlsAvatar.openKiosk(); var __cy = document.getElementById('mlsAvKioskConsentYes'); if (__cy) __cy.click();
  });
  await page.clock.runFor(2000);                       /* preflight + turn 1 + speak */
  await page.evaluate(function () { window.__emit('My right knee is swollen and it hurts', true); });
  await page.clock.runFor(2000);                       /* 1.3s quiet -> submit -> turn 2 */
  await page.evaluate(function () { window.__emit('About three weeks now', true); });
  await page.clock.runFor(2000);                       /* -> turn 3, done -> kioskFinish */
}

async function unlockWith(page, buttonId) {
  const hasEnd = await page.evaluate(function () {
    const e = document.getElementById('mlsAvKioskEnd');
    if (!e) return false;
    e.click(); return true;
  });
  if (!hasEnd) { check('the kiosk exposes its staff End control', false, 'missing #mlsAvKioskEnd'); return false; }
  await page.clock.runFor(300);
  const clicked = await page.evaluate(function (id) {
    const i = document.getElementById('mlsAvKioskPinInput'); if (i) i.value = '1234';
    const b = document.getElementById(id); if (!b) return false;
    b.click(); return true;
  }, buttonId);
  if (!clicked) { check('the staff PIN pad exposes #' + buttonId, false, 'that outcome does not exist in this build'); return false; }
  await page.clock.runFor(500);
  return true;
}

/* ========================================================================== */
(async function main() {
  const chromium = loadChromium();
  /* Real Chrome is the default because that is what the doctor runs. A CI box
     with only Playwright's bundled Chromium can opt out via
     AVATAR_PROOF_CHANNEL=chromium rather than being unable to run this proof
     at all — the recogniser and speech engine are stubbed either way, so the
     browser build is not what this harness is measuring. */
  const channel = process.env.AVATAR_PROOF_CHANNEL || 'chrome';
  const exe = process.env.AVATAR_PROOF_EXECUTABLE || '';
  const launchOpts = exe ? { executablePath: exe }
    : (channel === 'chromium' ? {} : { channel: channel });
  const browser = await chromium.launch(launchOpts);
  try {
    /* ---------------------------------------------------------------- 0 */
    section('SCENARIO 0 - CONTROL: a normal interview DOES self-end on silence');
    {
      const h = await newPage(browser);
      const page = h.page;
      await page.evaluate(function () {
        window.__turnQueue = [
          { ok: true, say: 'Hello, what brings you in today?', avatar: { name: 'Ava', exitPinSet: true }, progress: { covered: 1, total: 3 } }
        ];
        window.__mlsAvatar.openKiosk(); var __cy = document.getElementById('mlsAvKioskConsentYes'); if (__cy) __cy.click();
      });
      await page.clock.runFor(2000);
      const before = await page.evaluate(function () { return window.__turnPosts().length; });
      await page.clock.runFor(60000);                  /* one minute of silence */
      const fin = await page.evaluate(function () {
        return window.__turnPosts().filter(function (f) { return f.body.finish === true; }).length;
      });
      check('the un-disarmed watchdog auto-finishes an abandoned interview', fin >= 1,
        'finish:true posts after 60s silence = ' + fin + ' (turn posts before = ' + before + ')');
      check('control page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }

    /* ---------------------------------------------------------------- A */
    section('SCENARIO A - HANDOFF, CAPTURE, MERGE');
    {
      const h = await newPage(browser);
      const page = h.page;
      await runIntake(page);

      /* av-5.7.0 — THE REST SCREEN IS THE HAND-OFF, AND IT SAYS SO TO THE
         PATIENT. Owner: "this avatar once its done should say ... your docotr
         will be in wi th u soon but it needs to stay up so when the docot
         entirer the room they click one button and the avatar just l;istens."
         The invariant asserted here is unchanged in substance - the finished
         kiosk does NOT close into the doctor's app - and now also covers the
         one-tap hand-off the owner asked for. The old pin matched a staff
         instruction in the SAY line; that line belongs to the patient. */
      const rest = await page.evaluate(function () {
        return {
          say: (window.__say() || {}).say || '',
          staff: (document.getElementById('mlsAvKioskInterim') || {}).textContent || '',
          stillUp: !!document.getElementById('mlsAvKiosk'),
          roomBtn: window.__vis('mlsAvKioskRoomGo')
        };
      });
      check('the finished interview STAYS UP - it never closes into the doctor\'s app',
        rest.stillUp, JSON.stringify(rest.stillUp));
      check('and it tells the PATIENT what happens next',
        /doctor will be in with you soon/i.test(rest.say), JSON.stringify(rest.say));
      check('the staff line still says to hand the screen back',
        /hand the screen back/i.test(rest.staff), JSON.stringify(rest.staff));
      check('ONE BUTTON starts listening to the visit, with no PIN in the way',
        rest.roomBtn.visible, JSON.stringify(rest.roomBtn));

      /* the PIN pad must offer TWO outcomes, both staff-gated */
      await page.evaluate(function () { const e = document.getElementById('mlsAvKioskEnd'); if (e) e.click(); });
      await page.clock.runFor(300);
      const pad = await page.evaluate(function () {
        return {
          padVisible: window.__vis('mlsAvKioskPin').visible,
          end: window.__vis('mlsAvKioskPinGo'),
          amb: window.__vis('mlsAvKioskPinAmb')
        };
      });
      check('REQ1 the staff PIN pad is shown', pad.padVisible);
      check('REQ1 outcome 1 "End check-in" is present and visible', pad.end.visible, pad.end.text);
      check('REQ1 outcome 2 "Keep listening for the visit" is present and visible', pad.amb.visible, pad.amb.text);

      /* a WRONG pin must not start a recording */
      await page.evaluate(function () {
        window.fetch = (function (real) {
          return function (u, o) {
            if (String(u).indexOf('/unlock') >= 0) {
              window.__log.fetches.push({ url: String(u), body: {}, at: Date.now() });
              return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return 'application/json'; } },
                json: function () { return Promise.resolve({ ok: false, message: 'nope' }); } });
            }
            return real(u, o);
          };
        })(window.fetch);
        const i = document.getElementById('mlsAvKioskPinInput'); if (i) i.value = '9999';
        const b = document.getElementById('mlsAvKioskPinAmb'); if (b) b.click();
      });
      await page.clock.runFor(400);
      const afterBadPin = await page.evaluate(function () { return window.__amb(); });
      check('REQ1 a REFUSED PIN starts no recording', afterBadPin.running === false, JSON.stringify(afterBadPin));
      check('scenario A gate page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }
    {
      /* the real staff unlock, choosing "keep listening", on a clean page */
      const h = await newPage(browser);
      const page = h.page;
      await runIntake(page);
      await unlockWith(page, 'mlsAvKioskPinAmb');

      const started = await page.evaluate(function () {
        return {
          state: window.__amb(),
          rec: window.__vis('mlsAvKioskRec'),
          mic: window.__vis('mlsAvKioskMic'),
          pad: window.__vis('mlsAvKioskPin'),
          say: window.__say(),
          recStarts: window.__log.recStarts,
          speaks: window.__log.speaks.length,
          turnPosts: window.__turnPosts().length
        };
      });
      check('REQ1 "keep listening" starts the capture and keeps the overlay up',
        started.state.running === true && started.pad.visible === false, JSON.stringify(started.state));
      check('REQ6 the capture is bound to the check-in patient',
        started.state.boundPatient === 'ext-77', started.state.boundPatient);
      check('REQ4 the recording disclosure is PRESENT, inside the kiosk overlay, and VISIBLE',
        started.rec.present && started.rec.inKiosk && started.rec.visible,
        started.rec.display + ' ' + started.rec.w + 'x' + started.rec.h);
      check('REQ4 the disclosure says, in words, that it is recording and listening',
        /recording/i.test(started.rec.text) && /listening/i.test(started.rec.text), started.rec.text);
      check('REQ4 the avatar shows its LISTENING state',
        /(^|\s)listening(\s|$)/.test(started.say.classes || '') && /ambient/.test(started.say.classes || ''),
        started.say.classes);
      check('REQ4 the intake mic pill is replaced, not doubled up',
        started.mic.visible === false, started.mic.display);
      check('REQ8 a recogniser is actually open', started.recStarts >= 1, 'starts=' + started.recStarts);

      const speaksAtStart = started.speaks;
      const turnPostsAtStart = started.turnPosts;

      /* --- the consultation: speech, long silences, and a dead recogniser --- */
      await page.evaluate(function () { window.__emit('doctor the knee is warm to touch', true); });
      await page.clock.runFor(1000);
      await page.evaluate(function () { window.__emit('lets get an x-ray of that knee today', true); });

      const samples = [];
      for (let i = 0; i < 3; i++) {
        await page.clock.runFor(300000);               /* FIVE MINUTES of silence */
        samples.push(await page.evaluate(function () {
          return {
            running: window.__amb().running,
            visible: window.__vis('mlsAvKioskRec').visible,
            clock: window.__vis('mlsAvKioskRecClock').text,
            finishes: window.__turnPosts().filter(function (f) { return f.body.finish === true; }).length
          };
        }));
      }
      check('REQ2 fifteen minutes of silence do NOT end the capture',
        samples.every(function (s) { return s.running === true; }), JSON.stringify(samples.map(function (s) { return s.running; })));
      check('REQ4 the disclosure stays visible through every silence',
        samples.every(function (s) { return s.visible === true; }), JSON.stringify(samples.map(function (s) { return s.visible; })));
      check('REQ2 no auto-finish turn is posted during the capture',
        samples.every(function (s) { return s.finishes === 0; }), JSON.stringify(samples.map(function (s) { return s.finishes; })));
      check('the disclosure clock keeps running (liveness, not a frozen badge)',
        /1[0-9]:[0-9][0-9]/.test(samples[2].clock), samples[2].clock);

      /* the recogniser dies the way Chrome dies: quietly */
      const recsBefore = await page.evaluate(function () { return window.__log.recStarts; });
      await page.evaluate(function () { window.__die(); });
      await page.clock.runFor(1000);
      const recsAfter = await page.evaluate(function () { return window.__log.recStarts; });
      check('REQ8 a silently dead recogniser is restarted within a second',
        recsAfter > recsBefore, recsBefore + ' -> ' + recsAfter);
      await page.evaluate(function () { window.__emit('after the restart we discussed physical therapy', true); });
      await page.clock.runFor(600000);                 /* TEN more minutes */
      await page.evaluate(function () { window.__die(); });
      await page.clock.runFor(1000);
      await page.evaluate(function () { window.__emit('start ibuprofen six hundred milligrams as needed', true); });
      await page.clock.runFor(600000);                 /* TEN more minutes */

      const late = await page.evaluate(function () {
        return {
          state: window.__amb(),
          visible: window.__vis('mlsAvKioskRec').visible,
          speaks: window.__log.speaks.length,
          ttsCalls: window.__log.fetches.filter(function (f) { return f.url.indexOf('/tts') >= 0; }).length,
          turnPosts: window.__turnPosts().length
        };
      });
      check('REQ2 ~35 minutes into the exam the capture is still running',
        late.state.running === true, JSON.stringify(late.state));
      check('REQ4 the disclosure is still visible at the end of the exam', late.visible === true);
      check('REQ3 the avatar spoke ZERO times during the whole capture',
        late.speaks === speaksAtStart, 'speaks ' + speaksAtStart + ' -> ' + late.speaks);
      check('REQ3 no turn was posted to the server during the capture',
        late.turnPosts === turnPostsAtStart, 'turn posts ' + turnPostsAtStart + ' -> ' + late.turnPosts);

      /* --- staff end it --- */
      await unlockWith(page, 'mlsAvKioskPinGo');
      const out = await page.evaluate(function () {
        return {
          box: window.__box(),
          state: window.__amb(),
          inputEvents: window.__log.inputEvents,
          kioskGone: !document.getElementById('mlsAvKiosk')
        };
      });

      check('REQ5 the staff PIN ends the capture', out.state.running === false);
      check('REQ5 the kiosk overlay is gone after End', out.kioskGone === true);
      check('the capture was filed', out.state.filed === true, JSON.stringify(out.state.last));

      /* (a) BYTE-IDENTICAL pre-existing text */
      check('REQ7 (a) the pre-existing transcript survives BYTE FOR BYTE',
        out.box.slice(0, PRE.length) === PRE,
        'prefix ' + JSON.stringify(out.box.slice(0, PRE.length)) + ' vs ' + JSON.stringify(PRE));
      check('REQ7 (a) the append is exactly PRE + blank line + block, nothing rewritten',
        out.box.length > PRE.length + 40 &&
        out.box.slice(PRE.length, PRE.length + 2) === '\n\n' &&
        out.box.slice(PRE.length + 2, PRE.length + 18) === '--- check-in ---',
        'len ' + out.box.length + ' seam ' + JSON.stringify(out.box.slice(PRE.length, PRE.length + 20)));

      /* (b) both sections, in order, with the boundary */
      const iCheck = out.box.indexOf('--- check-in ---');
      const iVisit = out.box.indexOf('--- visit ---');
      check('REQ7 (b) the "--- check-in ---" boundary is present', iCheck > 0, 'at ' + iCheck);
      check('REQ7 (b) the "--- visit ---" boundary is present', iVisit > 0, 'at ' + iVisit);
      check('REQ7 (b) check-in comes BEFORE visit', iCheck > 0 && iVisit > iCheck, iCheck + ' < ' + iVisit);
      check('REQ7 (b) the INTAKE answers are in the check-in section',
        out.box.indexOf('My right knee is swollen and it hurts') > iCheck &&
        out.box.indexOf('My right knee is swollen and it hurts') < iVisit,
        'at ' + out.box.indexOf('My right knee is swollen and it hurts'));
      check('REQ7 (b) the avatar QUESTIONS are in the check-in section too',
        out.box.indexOf('what brings you in today') > iCheck && out.box.indexOf('what brings you in today') < iVisit);
      check('REQ7 (b) the CONSULTATION text is in the visit section',
        out.box.indexOf('the knee is warm to touch') > iVisit, 'at ' + out.box.indexOf('the knee is warm to touch'));
      check('REQ8 text captured AFTER a recogniser death is in the transcript',
        out.box.indexOf('after the restart we discussed physical therapy') > iVisit &&
        out.box.indexOf('six hundred milligrams') > iVisit);
      check('REQ7 an input event was fired so the app mirror MERGES',
        out.inputEvents >= 1, 'input events = ' + out.inputEvents);
      check('scenario A page threw nothing', h.errors.length === 0, h.errors.join(' | '));

      results.push('');
      results.push('  ---- the transcript the doctor is handed ----');
      out.box.split('\n').forEach(function (l) { results.push('  | ' + l); });
      results.push('  --------------------------------------------');
      await page.close();
    }

    /* ---------------------------------------------------------------- B */
    section('SCENARIO B - THE CHART CHANGED: refuse, say so, write nothing');
    {
      const h = await newPage(browser);
      const page = h.page;
      await runIntake(page);
      await unlockWith(page, 'mlsAvKioskPinAmb');
      await page.evaluate(function () { window.__emit('this is a whole consultation nobody may misfile', true); });
      await page.clock.runFor(120000);
      const held = await page.evaluate(function () { return window.__amb(); });
      check('REQ6 the capture holds real text before the chart moves',
        held.running === true && held.capturedChars > 20, JSON.stringify(held));

      /* the doctor's app switches chart under the live recording */
      await page.evaluate(function () {
        window.__activePt = 'ext-99';
        window.dispatchEvent(new Event('mls:active-patient-changed'));
      });
      await page.clock.runFor(1000);

      const refused = await page.evaluate(function () {
        return {
          state: window.__amb(),
          say: window.__say(),
          rec: window.__vis('mlsAvKioskRec'),
          box: window.__box(),
          recStarts: window.__log.recStarts
        };
      });
      check('REQ6 (c) a chart change STOPS the microphone at once', refused.state.running === false);
      check('REQ6 (c) NOTHING was written - the transcript is byte-identical',
        refused.box === PRE, JSON.stringify(refused.box.slice(PRE.length)));
      check('REQ6 (c) the refusal is SAID ON SCREEN and names both charts',
        /ext-99/.test(refused.say.interim || '') && /ext-77/.test(refused.say.interim || '') &&
        /nothing was written/i.test(refused.say.interim || ''), refused.say.interim);
      check('REQ6 (c) the screen no longer claims to be recording', refused.rec.visible === false, refused.rec.display);
      check('REQ6 (c) the refusal is recorded honestly in state',
        refused.state.filed === false && /not the one this recording belongs to/.test((refused.state.last || {}).why || ''),
        JSON.stringify(refused.state.last));

      const stillDead = await page.evaluate(function () {
        const before = window.__log.recStarts;
        return { before: before };
      });
      await page.clock.runFor(30000);
      const after = await page.evaluate(function () { return window.__log.recStarts; });
      check('REQ6 (c) the microphone does not come back by itself',
        after === stillDead.before, stillDead.before + ' -> ' + after);

      /* and ending for staff still writes nothing */
      await unlockWith(page, 'mlsAvKioskPinGo');
      const final = await page.evaluate(function () { return window.__box(); });
      check('REQ6 (c) ending afterwards still writes nothing', final === PRE, JSON.stringify(final.slice(PRE.length)));
      check('scenario B page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }

    /* ---------------------------------------------------------------- C */
    section('SCENARIO C - THE 90 MINUTE HARD CAP');
    {
      const h = await newPage(browser);
      const page = h.page;
      await runIntake(page);
      await unlockWith(page, 'mlsAvKioskPinAmb');
      await page.evaluate(function () { window.__emit('long visit with a lot of quiet examination time', true); });

      let stoppedAtMin = null;
      for (let m = 1; m <= 95 && stoppedAtMin === null; m++) {
        await page.clock.runFor(60000);
        const running = await page.evaluate(function () { return window.__amb().running; });
        if (!running) stoppedAtMin = m;
      }
      check('REQ5 the capture ends ITSELF at the 90 minute cap',
        stoppedAtMin !== null && stoppedAtMin >= 89 && stoppedAtMin <= 92, 'stopped at minute ' + stoppedAtMin);

      const capped = await page.evaluate(function () {
        return {
          state: window.__amb(),
          say: window.__say(),
          rec: window.__vis('mlsAvKioskRec'),
          box: window.__box(),
          kiosk: !!document.getElementById('mlsAvKiosk')
        };
      });
      check('REQ5 the cap SAYS SO on screen', /90 minute limit/i.test(capped.say.say || ''), capped.say.say);
      check('REQ5 the screen stops claiming to record', capped.rec.visible === false, capped.rec.display);
      check('REQ5 the kiosk still rests behind the PIN - it never opens the app',
        capped.kiosk === true);
      check('REQ5 what it heard before the cap was still filed',
        capped.state.filed === true && capped.box.indexOf('long visit with a lot of quiet') > 0,
        JSON.stringify(capped.state.last));
      check('REQ7 the cap write is additive too', capped.box.slice(0, PRE.length) === PRE);

      const recsAtCap = await page.evaluate(function () { return window.__log.recStarts; });
      await page.clock.runFor(300000);
      const recsAfterCap = await page.evaluate(function () { return window.__log.recStarts; });
      check('REQ5 nothing restarts the microphone after the cap - it cannot roll into the next patient',
        recsAfterCap === recsAtCap, recsAtCap + ' -> ' + recsAfterCap);
      check('scenario C page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(results.join('\n'));
  console.log('');
  if (failures) {
    console.log('FAIL ambient room mode proof: ' + failures + ' failed check(s)');
    process.exit(1);
  }
  console.log('PASS ambient room mode: staff-gated handoff with two outcomes, auto-finish disarmed across ' +
    '35 minutes of exam (with a live control proving the watchdog still fires without it), silent avatar, ' +
    'permanent on-screen disclosure, wrong-chart refusal that writes nothing, 90 minute hard cap, and an ' +
    'additive check-in/visit merge that leaves the doctor\'s text byte-identical');
})().catch(function (e) { console.error(e); process.exit(1); });
