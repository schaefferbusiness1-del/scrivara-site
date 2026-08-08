'use strict';
/*
 * CONSENT, TURN-TAKING AND THE ONE-BUTTON HAND-OFF — driven in real Chrome.
 *
 * Owner, 2026-08-07, three things in one message:
 *   "when u sick start avaratar it sohuld say did the pateint concent to
 *    recording then then u click yes and then it goes."
 *   "iits trying to constant lyly record which it has to to have normal convos
 *    but it arecords itself talking and doesnt listent for an swerser and is
 *    just a mess so fix that."
 *   "this avatar once its done should say ... your docotr will be in wi th u
 *    soon but it needs to stay up so when the docot entirer the room they click
 *    one button and the avatar just l;istens."
 *
 * WHAT THIS FILE IS FOR. The unit suite can pin that the code says the right
 * words; only a browser can prove that NOTHING RAN before consent was given and
 * that an echoed question never becomes an answer. Both are measured here from
 * outside the module: getUserMedia calls, fullscreen requests, and the actual
 * POST bodies that reached /api/avatar/office/turn.
 *
 * THE MEASUREMENT THAT MATTERS MOST is scenario 2: the avatar's own sentence is
 * fed back into the recogniser exactly as a room microphone would feed it, and
 * the check is that no turn carries it AND that the microphone is still open
 * afterwards. Before av-5.7.0 the first half failed (the question was posted as
 * the patient's answer) and so did the second (the recogniser was torn down by
 * the submit and only a 9-second watchdog could revive it).
 *
 * Run manually with NODE_PATH pointed at a playwright install.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.env.MLS_AVATAR_DIR || path.resolve(__dirname, '..');
const AVATAR_SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_avatar.js'), 'utf8');
function loadChromium() {
  try { return require('playwright').chromium; }
  catch (e) { console.log('NEEDS PLAYWRIGHT: NODE_PATH=<a playwright install> node ' + __filename); process.exit(2); }
}

const HTML = '<!doctype html><meta charset="utf-8"><title>consent proof</title>' +
  '<body style="margin:0;font-family:system-ui">' +
  '<div id="visitView"><h3>Visit</h3>' +
  '<textarea id="ez3flTranscript" rows="8" style="width:90%"></textarea></div></body>';

function STUBS() {
  window.__log = { fetches: [], speaks: [], toasts: [], mic: 0, fullscreen: 0, recStarts: 0 };
  window.__activePt = 'ext-77';
  window.__turnQueue = [];
  window.__slowSpeakMs = 0;          /* >0 keeps a sentence "in flight" */

  window.getActivePtId = function () { return window.__activePt; };
  window.getPatients = function () { return [{ id: 'ext-77', name: 'Test Patient' }]; };
  window.upsertPatient = function () {};
  window.toast = function (m) { window.__log.toasts.push(String(m)); };
  window.bkToken = function () { return 'tok'; };
  window.bkBase = function () { return 'https://backend.test'; };

  function jres(obj, status) {
    return Promise.resolve({
      ok: (status || 200) < 400, status: status || 200,
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

  /* the synth can be made SLOW, so a sentence is genuinely mid-flight while the
     recogniser is fed - that is the only way to exercise the speaking regime of
     the echo filter as opposed to its bounded tail */
  const synth = {
    speaking: false,
    speak: function (u) {
      window.__log.speaks.push({ text: String(u.text || ''), at: Date.now() });
      const ms = window.__slowSpeakMs || 5;
      setTimeout(function () { if (u.onend) u.onend(); }, ms);
    },
    cancel: function () {}, getVoices: function () { return []; }, addEventListener: function () {}
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); }
  catch (e) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.onend = null; this.onerror = null; };

  /* THE TWO THINGS THAT MUST NOT HAPPEN BEFORE CONSENT, counted */
  const md = { getUserMedia: function () {
    window.__log.mic++;
    return Promise.resolve({ getTracks: function () { return []; } });
  } };
  try { Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true }); } catch (e) {}
  document.documentElement.requestFullscreen = function () { window.__log.fullscreen++; return Promise.resolve(); };

  window.__recs = [];
  window.SpeechRecognition = function () {
    const self = this;
    this.lang = ''; this.interimResults = false; this.continuous = false;
    this.onresult = null; this.onend = null; this.onerror = null; this.live = false;
    this.start = function () {
      if (self.live) throw new Error('already started');
      self.live = true; window.__recs.push(self); window.__log.recStarts++;
    };
    this.stop = function () { self.live = false; };
    this.abort = function () { self.live = false; };
  };
  window.__lastRec = function () { return window.__recs[window.__recs.length - 1] || null; };
  window.__micLive = function () { const r = window.__lastRec(); return !!(r && r.live); };
  window.__emit = function (text, isFinal) {
    const r = window.__lastRec();
    if (!r || !r.onresult) return false;
    const one = [{ transcript: text }];
    one.isFinal = !!isFinal;
    r.onresult({ resultIndex: 0, results: [one] });
    return true;
  };
  window.__vis = function (id) {
    const el = document.getElementById(id);
    if (!el) return { present: false, visible: false };
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return { present: true, display: cs.display, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
      w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
  };
  window.__answers = function () {
    return window.__log.fetches
      .filter(function (f) { return f.url.indexOf('/api/avatar/office/turn') >= 0 && f.body && f.body.answer; })
      .map(function (f) { return f.body.answer; });
  };
  window.__turnPosts = function () {
    return window.__log.fetches.filter(function (f) { return f.url.indexOf('/api/avatar/office/turn') >= 0; });
  };
  window.__say = function () {
    const s = document.getElementById('mlsAvKioskSay');
    return s ? (s.textContent || '') : null;
  };
  window.__box = function () { const b = document.getElementById('ez3flTranscript'); return b ? b.value : null; };
}

const results = [];
let failures = 0;
function check(label, cond, detail) {
  const ok = !!cond;
  if (!ok) failures++;
  results.push((ok ? '  PASS  ' : '  FAIL  ') + label + (detail === undefined ? '' : ('  [' + detail + ']')));
  return ok;
}
function section(n) { results.push(''); results.push('== ' + n + ' =='); }

/* TOLERANT ON PURPOSE. Run this against a build with no consent gate and every
   click below would throw, turning a falsification run into one stack trace
   instead of a list of what is missing. A control that cannot be read is not a
   control. */
async function tap(page, id) {
  const hit = await page.evaluate(function (i) {
    const el = document.getElementById(i);
    if (!el) return false;
    el.click(); return true;
  }, id);
  if (!hit) check('the control #' + id + ' exists to be tapped', false, 'absent in this build');
  return hit;
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(String((e && e.message) || e)); });
  await page.clock.install({ time: new Date('2026-08-07T14:00:00Z') });
  await page.setContent(HTML);
  await page.evaluate(STUBS);
  await page.addScriptTag({ content: AVATAR_SRC });
  await page.clock.runFor(300);
  return { page, errors };
}

(async function main() {
  const chromium = loadChromium();
  const channel = process.env.AVATAR_PROOF_CHANNEL || 'chrome';
  const browser = await chromium.launch(channel === 'chromium' ? {} : { channel: channel });
  try {
    /* ------------------------------------------------------------- 1 */
    section('1 - THE CONSENT GATE: nothing runs before the answer');
    {
      const h = await newPage(browser);
      const page = h.page;
      await page.evaluate(function () {
        window.__turnQueue = [{ ok: true, say: 'Hello, what brings you in today?', avatar: { name: 'Ava', exitPinSet: true }, progress: { covered: 1, total: 3 } }];
        window.__mlsAvatar.openKiosk();
      });
      await page.clock.runFor(3000);            /* three seconds of nobody answering */
      const before = await page.evaluate(function () {
        return {
          card: window.__vis('mlsAvKioskConsent'),
          yes: window.__vis('mlsAvKioskConsentYes'),
          no: window.__vis('mlsAvKioskConsentNo'),
          mic: window.__log.mic, full: window.__log.fullscreen,
          recs: window.__log.recStarts, turns: window.__turnPosts().length,
          overlay: !!document.getElementById('mlsAvKiosk')
        };
      });
      check('the consent question is on screen', before.card.visible && /Did the patient consent to being recorded\?/.test(before.card.text), before.card.text);
      check('both answers are reachable', before.yes.visible && before.no.visible, before.yes.text + ' / ' + before.no.text);
      check('the overlay is up, so the patient never sees the app', before.overlay);
      check('NO MICROPHONE was requested', before.mic === 0, 'getUserMedia calls = ' + before.mic);
      check('NO recogniser was started', before.recs === 0, 'starts = ' + before.recs);
      check('NO turn was posted to the server', before.turns === 0, 'posts = ' + before.turns);
      check('NO fullscreen was taken', before.full === 0, 'requests = ' + before.full);

      /* the REFUSAL */
      await tap(page, 'mlsAvKioskConsentNo');
      await page.clock.runFor(1000);
      const after = await page.evaluate(function () {
        return { gone: !document.getElementById('mlsAvKiosk'), mic: window.__log.mic,
          turns: window.__turnPosts().length, toast: window.__log.toasts.join(' | ') };
      });
      check('"No" closes the kiosk', after.gone);
      check('and STILL nothing was recorded', after.mic === 0 && after.turns === 0,
        'mic ' + after.mic + ', turns ' + after.turns);
      check('and it says so', /nothing was recorded/i.test(after.toast), after.toast);
      check('scenario 1 threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }

    /* ------------------------------------------------------------- 2 */
    section('2 - YES starts everything, and the avatar never hears ITSELF');
    {
      const h = await newPage(browser);
      const page = h.page;
      const QUESTION = 'Hello, what brings you in today?';
      await page.evaluate(function (q) {
        window.__slowSpeakMs = 4000;            /* the question is genuinely in flight */
        window.__turnQueue = [
          { ok: true, say: q, avatar: { name: 'Ava', exitPinSet: true }, progress: { covered: 1, total: 3 } },
          { ok: true, say: 'How long has that been going on?', progress: { covered: 2, total: 3 } }
        ];
        window.__mlsAvatar.openKiosk();
        var __cy = document.getElementById('mlsAvKioskConsentYes'); if (__cy) __cy.click();
      }, QUESTION);
      await page.clock.runFor(500);
      const started = await page.evaluate(function () {
        return { card: window.__vis('mlsAvKioskConsent'), mic: window.__log.mic,
          full: window.__log.fullscreen, turns: window.__turnPosts().length };
      });
      check('the consent card is gone', !started.card.visible, started.card.display);
      check('the microphone was requested ONCE, on the staff tap', started.mic === 1, 'calls = ' + started.mic);
      check('fullscreen was taken on that same tap', started.full === 1, 'requests = ' + started.full);
      check('and the first turn was posted', started.turns === 1, 'posts = ' + started.turns);

      await page.clock.runFor(500);             /* the question is now playing */
      /* THE ROOM MICROPHONE HEARS THE SPEAKER. Feed the avatar's own sentence
         back exactly as it would arrive. */
      await page.evaluate(function (q) { window.__emit(q, true); }, QUESTION);
      await page.clock.runFor(2000);            /* well past the 1.3s quiet-submit */
      const echo1 = await page.evaluate(function () {
        return { answers: window.__answers(), micLive: window.__micLive(), recs: window.__log.recStarts };
      });
      check('THE AVATAR\'S OWN QUESTION IS NOT POSTED AS THE PATIENT\'S ANSWER',
        echo1.answers.length === 0, JSON.stringify(echo1.answers));
      check('AND THE MICROPHONE IS STILL OPEN afterwards (an echo must not cost the mic)',
        echo1.micLive === true, 'live=' + echo1.micLive + ' starts=' + echo1.recs);

      /* THE LATE TAIL. The speech has now finished and Chrome delivers the end of
         that same sentence a moment later - the defect the owner reported, since
         the template used to be dropped the instant the audio stopped.
         THE TIMING HERE IS THE CONTRACT, not an accident: the module keeps the
         template for PV_ECHO_TAIL_MS (1.6s) after the audio ends, because
         Chrome's recogniser endpoints on the pause that our own silence creates
         and finalises within about a second. This emit lands ~100ms after the
         end. A tail delivered LATER than the window would be taken as an answer,
         which is the deliberate trade: a permanent template silences a patient
         who answers in the question's own words. */
      await page.clock.runFor(1600);            /* the 4s sentence ends here */
      await page.evaluate(function () { window.__emit('what brings you in today', true); });
      await page.clock.runFor(2000);
      const echo2 = await page.evaluate(function () { return { answers: window.__answers(), micLive: window.__micLive() }; });
      check('A LATE TAIL OF THE FINISHED QUESTION IS STILL NOT AN ANSWER',
        echo2.answers.length === 0, JSON.stringify(echo2.answers));
      check('the microphone survived that too', echo2.micLive === true);

      /* THE CONTROL. The filter must not be "never post": a real answer, said
         right after all that, has to go through. */
      await page.evaluate(function () { window.__emit('My right knee is swollen and it gave out yesterday', true); });
      await page.clock.runFor(2000);
      const real = await page.evaluate(function () { return { answers: window.__answers(), say: window.__say() }; });
      check('CONTROL: a real answer IS posted', real.answers.length === 1, JSON.stringify(real.answers));
      check('CONTROL: and the interview moved on', /how long has that been going on/i.test(real.say || ''), real.say);
      check('scenario 2 threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }

    /* ------------------------------------------------------------- 3 */
    section('3 - THE HAND-OFF: one button, no PIN, and the consent is in the record');
    {
      const h = await newPage(browser);
      const page = h.page;
      await page.evaluate(function () {
        window.__turnQueue = [
          { ok: true, say: 'What brings you in today?', avatar: { name: 'Ava', exitPinSet: true }, progress: { covered: 1, total: 2 } },
          { ok: true, done: true, say: 'Thank you, that is everything.' }
        ];
        window.__mlsAvatar.openKiosk();
        var __cy = document.getElementById('mlsAvKioskConsentYes'); if (__cy) __cy.click();
      });
      await page.clock.runFor(1500);
      await page.evaluate(function () { window.__emit('My knee hurts', true); });
      await page.clock.runFor(3000);            /* -> done -> kioskFinish */
      const rest = await page.evaluate(function () {
        return { say: window.__say(), room: window.__vis('mlsAvKioskRoomGo'),
          pin: window.__vis('mlsAvKioskPin'), up: !!document.getElementById('mlsAvKiosk') };
      });
      check('the kiosk STAYS UP after the check-in', rest.up);
      check('it tells the patient the doctor is coming', /doctor will be in with you soon/i.test(rest.say || ''), rest.say);
      check('ONE button offers to listen to the visit', rest.room.visible, rest.room.text);
      check('and no PIN pad stands in front of it', !rest.pin.visible, rest.pin.display);

      await tap(page, 'mlsAvKioskRoomGo');
      await page.clock.runFor(1000);
      const amb = await page.evaluate(function () {
        return { recording: window.__mlsAvatar.ambientState().running,
          banner: window.__vis('mlsAvKioskRec'), room: window.__vis('mlsAvKioskRoomGo'),
          say: window.__say() };
      });
      check('one tap starts the room recording', amb.recording === true, JSON.stringify(amb.recording));
      check('the recording disclosure is on screen the whole time', amb.banner.visible, amb.banner.text);
      check('the hand-off button gets out of the way', !amb.room.visible, amb.room.display);

      await page.evaluate(function () { window.__emit('Doctor: the knee is swollen and warm. Plan is an x-ray today.', true); });
      await page.clock.runFor(2500);
      await tap(page, 'mlsAvKioskEndVisit');
      await page.clock.runFor(3000);
      const filed = await page.evaluate(function () { return window.__box(); });
      check('the visit reached the transcript', /--- visit ---/.test(filed || '') && /x-ray today/.test(filed || ''),
        String(filed || '').slice(0, 80));
      check('THE CONSENT IS PART OF THE RECORD, with its clock time',
        /Recording consent confirmed by practice staff at .+, before any microphone was opened/.test(filed || ''),
        (String(filed || '').match(/Recording consent[^\]]*/) || ['(absent)'])[0]);
      check('and the check-in answers are in it too', /My knee hurts/.test(filed || ''));
      check('scenario 3 threw nothing', h.errors.length === 0, h.errors.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log(failures
    ? ('\nFAIL consent + turn-taking proof: ' + failures + ' failed check(s)')
    : ('\nPASS consent + turn-taking: nothing runs before the answer (no mic, no turn, no fullscreen), ' +
       'the avatar\'s own question is never posted as an answer and never costs the microphone, a real answer still goes through, ' +
       'and the finished kiosk rests with ONE button that starts a disclosed room recording whose consent is in the filed record'));
  process.exit(failures ? 1 : 0);
})();
