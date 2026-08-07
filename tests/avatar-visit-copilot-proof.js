'use strict';
/*
 * THE VISIT COPILOT - EXECUTED END-TO-END PROOF (real Chromium, real origin)
 * =============================================================================
 * av-5.6.0 claims three things the room capture could not do. None of them are
 * proved by reading source, and two of them CANNOT be proved by the existing
 * ambient proof at all: that harness runs on `page.setContent`, an opaque
 * origin where localStorage throws, so the backup it reports is always
 * `backedUp:false`. (That is the module degrading honestly, which is worth
 * knowing - but it is not evidence the backup WORKS.)
 *
 * This harness serves the module over a real http origin and drives a whole
 * encounter:
 *
 *   A  THE VISIT SURVIVES A RELOAD. Intake -> staff PIN -> keep listening ->
 *      the doctor and patient talk -> the page is RELOADED mid-visit (the
 *      crash this feature exists for) -> the words are still there, bound to
 *      the chart -> one click files them into the transcript.
 *   B  ORDERS ARE PREPARED, NEVER PLACED. The doctor says an order aloud; the
 *      card appears. An order missing a clinically required detail CANNOT be
 *      confirmed until the doctor supplies it. Sentences that only sound like
 *      orders produce nothing.
 *   C  END VISIT. One control flushes the recogniser (including the last
 *      sentence, spoken as it is clicked), files, and reports what was saved,
 *      what was confirmed, and what was heard but never confirmed.
 *
 * Run: NODE_PATH=<playwright> node tests/avatar-visit-copilot-proof.js
 *      AVATAR_PROOF_EXECUTABLE=/path/to/chrome  (or AVATAR_PROOF_CHANNEL)
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

function loadChromium() {
  const tries = [];
  if (process.env.NODE_PATH) String(process.env.NODE_PATH).split(path.delimiter).forEach(function (p) {
    if (p) tries.push(path.join(p, 'playwright'));
  });
  tries.push('playwright');
  for (let i = 0; i < tries.length; i++) {
    try { return require(tries[i]).chromium; } catch (e) { /* next */ }
  }
  throw new Error('playwright not resolvable; set NODE_PATH');
}

const ROOT = path.resolve(__dirname, '..');
const AVATAR_SRC = fs.readFileSync(path.join(ROOT, 'feat_mls_avatar.js'), 'utf8');

const PAGE = '<!doctype html><meta charset="utf-8"><title>copilot proof</title>' +
  '<body style="margin:0;font-family:system-ui">' +
  '<div id="visitView"><h3>Visit</h3>' +
  '<textarea id="ez3flTranscript" rows="10" style="width:90%"></textarea></div>' +
  '</body>';

let pass = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { failures.push(label + (detail ? '  [' + detail + ']' : '')); console.log('  FAIL  ' + label + (detail ? '  [' + detail + ']' : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

/* --------------------------------------------------------------------------
   Stubs. Same shape as the ambient proof: no real microphone, voice or network.
   -------------------------------------------------------------------------- */
function STUBS() {
  window.__log = { toasts: [], recStarts: 0 };
  window.__activePt = 'ext-77';
  window.__turnQueue = [];
  window.getActivePtId = function () { return window.__activePt; };
  window.getPatients = function () {
    return [{ id: 'ext-77', name: 'Test Patient', dob: '1971-03-02', sex: 'female',
      allergies: 'penicillin', meds: 'lisinopril 10 mg', problems: 'hypertension' }];
  };
  window.upsertPatient = function () {};
  window.toast = function (m) { window.__log.toasts.push(String(m)); };
  window.bkToken = function () { return 'tok'; };
  window.bkBase = function () { return 'https://backend.test'; };
  window.uns = function (k) { return 'acct-9::' + k; };     /* the real app namespaces per account */

  function jres(obj, status) {
    return Promise.resolve({
      ok: (status || 200) < 400, status: status || 200,
      headers: { get: function () { return 'application/json'; } },
      json: function () { return Promise.resolve(obj); },
      blob: function () { return Promise.resolve(new Blob([''])); }
    });
  }
  window.__fetchLog = [];
  window.fetch = function (url, opts) {
    const u = String(url);
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
    window.__fetchLog.push({ url: u, body: body });
    if (u.indexOf('/api/avatar/office/tts') >= 0) return jres({ error: 'none' }, 503);
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
    speak: function (u) { setTimeout(function () { if (u.onend) u.onend(); }, 5); },
    cancel: function () {}, getVoices: function () { return []; }, addEventListener: function () {}
  };
  try { Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true }); }
  catch (e) { window.speechSynthesis = synth; }
  window.SpeechSynthesisUtterance = function (t) { this.text = t; this.onend = null; this.onerror = null; };
  const md = { getUserMedia: function () { return Promise.resolve({ getTracks: function () { return []; } }); } };
  try { Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true }); } catch (e) {}

  window.__recs = [];
  window.SpeechRecognition = function () {
    const self = this;
    this.lang = ''; this.interimResults = false; this.continuous = false;
    this.onresult = null; this.onend = null; this.onerror = null; this.live = false;
    this.start = function () { if (self.live) throw new Error('started'); self.live = true; window.__recs.push(self); window.__log.recStarts++; };
    this.stop = function () { self.live = false; if (self.onend) self.onend(); };
    this.abort = function () { self.live = false; };
  };
  window.__emit = function (text, isFinal) {
    const r = window.__recs[window.__recs.length - 1];
    if (!r || !r.onresult) return false;
    const one = [{ transcript: text }];
    one.isFinal = !!isFinal;
    r.onresult({ resultIndex: 0, results: [one] });
    return true;
  };
  window.__amb = function () { try { return window.__mlsAvatar.ambientState(); } catch (e) { return { err: String(e) }; } };
  window.__box = function () { return document.getElementById('ez3flTranscript').value; };
  window.__cards = function () {
    return Array.prototype.map.call(document.querySelectorAll('#mlsAvKioskOrders .mlsAvOrd'), function (c) {
      const go = c.querySelector('.mlsAvOrdGo');
      return {
        title: (c.querySelector('b') || {}).textContent || '',
        detail: (c.querySelector('.mlsAvOrdDet') || {}).textContent || '',
        missing: (c.querySelector('.mlsAvOrdMiss') || {}).textContent || '',
        confirmDisabled: go ? !!go.disabled : null,
        sides: c.querySelectorAll('.mlsAvOrdPick').length,
        confirmed: !!c.querySelector('.mlsAvOrdOk')
      };
    });
  };
  window.__widgetVisible = function () {
    const h = document.getElementById('mlsAvKioskOrders');
    if (!h) return false;
    return getComputedStyle(h).display !== 'none';
  };
  window.__review = function () {
    const p = document.getElementById('mlsAvKioskReview');
    if (!p || getComputedStyle(p).display === 'none') return null;
    return (p.textContent || '').replace(/\s+/g, ' ').trim();
  };
}

async function newPage(browser, base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', function (e) { errors.push(String((e && e.message) || e)); });
  await page.clock.install({ time: new Date('2026-08-07T14:00:00Z') });
  await page.goto(base + '/page.html');
  await page.evaluate(STUBS);
  await page.evaluate(function () {
    document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
  });
  await page.addScriptTag({ content: AVATAR_SRC });
  await page.clock.runFor(4000);
  return { page: page, errors: errors };
}

/* intake -> rest behind the PIN -> "keep listening" (the ambient handoff) */
async function toAmbient(page) {
  await page.evaluate(function () {
    window.__turnQueue = [
      { ok: true, say: 'Hello, what brings you in today?', done: false, progress: { covered: 1, total: 2 } },
      { ok: true, say: 'Thanks. How long has it been going on?', done: false, progress: { covered: 2, total: 2 } },
      { ok: true, say: 'Thank you, that is everything I needed.', done: true }
    ];
    window.__mlsAvatar.openKiosk();
  });
  await page.clock.runFor(1200);
  await page.evaluate(function () { window.__emit('my knee has been hurting', true); });
  await page.clock.runFor(2500);
  await page.evaluate(function () { window.__emit('about three weeks', true); });
  await page.clock.runFor(2500);
  await page.clock.runFor(13000);                       /* the finish path */
  await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
  await page.clock.runFor(400);
  await page.evaluate(function () {
    document.getElementById('mlsAvKioskPinInput').value = '1234';
    document.getElementById('mlsAvKioskPinAmb').click();
  });
  await page.clock.runFor(1200);
}

async function say(page, text) {
  await page.evaluate(function (t) { window.__emit(t, true); }, text);
  await page.clock.runFor(1600);        /* past the detector's settle window */
}

(async function main() {
  const server = http.createServer(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const chromium = loadChromium();
  const exe = process.env.AVATAR_PROOF_EXECUTABLE || '';
  const channel = process.env.AVATAR_PROOF_CHANNEL || 'chrome';
  const browser = await chromium.launch(exe ? { executablePath: exe } : (channel === 'chromium' ? {} : { channel: channel }));

  try {
    /* ------------------------------------------------------------ A */
    section('SCENARIO A - THE VISIT SURVIVES A RELOAD');
    {
      const h = await newPage(browser, base);
      const page = h.page;
      await toAmbient(page);
      const running = await page.evaluate(function () { return window.__amb(); });
      ok('the capture is running and bound to the chart', running.running === true && running.boundPatient === 'ext-77',
        JSON.stringify({ running: running.running, bound: running.boundPatient }));

      await say(page, 'the pain radiates into the left leg and is worse at night');
      await say(page, 'straight leg raise is positive on the left');
      const st = await page.evaluate(function () { return window.__amb(); });
      ok('REQ1 the capture is BACKED UP on a real origin', st.backedUp === true,
        'backedUp=' + st.backedUp + ' chars=' + st.capturedChars);
      ok('REQ1 the backup was not trimmed at this size', st.backupTrimmed === false, 'trimmed=' + st.backupTrimmed);

      /* THE CRASH. Everything in memory dies here. */
      await page.reload();
      await page.evaluate(STUBS);
      await page.addScriptTag({ content: AVATAR_SRC });
      await page.clock.runFor(4000);

      const pend = await page.evaluate(function () { return window.__mlsAvatar.pendingCapture(); });
      ok('REQ1 the visit is still there after a reload', !!pend && pend.chars > 0,
        pend ? (pend.words + ' words, chart ' + pend.bound) : 'NOTHING RECOVERED');
      ok('REQ1 the recovered capture names the chart it belongs to', !!pend && pend.bound === 'ext-77', pend && pend.bound);
      ok('REQ1 the doctor\'s words survived verbatim',
        !!pend && pend.body.indexOf('radiates into the left leg') >= 0 && pend.body.indexOf('straight leg raise') >= 0,
        pend ? pend.body.slice(0, 70) + '…' : '');

      /* the recovery card is offered where the doctor works */
      const cardText = await page.evaluate(function () {
        const c = document.getElementById('mlsAvVisitCard');
        return c ? (c.textContent || '').replace(/\s+/g, ' ').trim() : '';
      });
      ok('REQ1 the Visit card announces the recovered visit',
        /recorded visit was saved before this page reloaded/i.test(cardText), cardText.slice(0, 90) + '…');

      /* WRONG CHART: it must refuse and name the chart the words belong to */
      await page.evaluate(function () { window.__activePt = 'ext-99'; });
      const refused = await page.evaluate(function () { return window.__mlsAvatar.fileRecoveredCapture(); });
      ok('REQ1 a chart mismatch REFUSES and writes nothing', refused.ok === false && /not the one this recording belongs to/.test(refused.why), refused.why);
      const boxAfterRefusal = await page.evaluate(function () { return window.__box(); });
      ok('REQ1 the transcript is untouched by the refusal', boxAfterRefusal === '', JSON.stringify(boxAfterRefusal));

      /* the right chart files it */
      await page.evaluate(function () { window.__activePt = 'ext-77'; });
      const filed = await page.evaluate(function () { return window.__mlsAvatar.fileRecoveredCapture(); });
      ok('REQ1 the recovered visit files to the right chart', filed.ok === true && filed.chars > 0, 'chars=' + filed.chars);
      const box = await page.evaluate(function () { return window.__box(); });
      ok('REQ1 the words reached the doctor\'s transcript', box.indexOf('radiates into the left leg') >= 0);
      ok('REQ1 the recovered block says it was recovered', /RECOVERED after this page reloaded/.test(box));
      const twice = await page.evaluate(function () { return window.__mlsAvatar.fileRecoveredCapture(); });
      ok('REQ1 filing again is refused - a visit cannot be duplicated', twice.ok === false || twice.already === true, JSON.stringify(twice));
      const gone = await page.evaluate(function () { return window.__mlsAvatar.pendingCapture(); });
      ok('REQ1 the backup is dropped once it is safely filed', gone === null, JSON.stringify(gone));
      ok('scenario A page threw nothing', h.errors.length === 0, h.errors.join(' | '));
    }

    /* ------------------------------------------------------------ B */
    section('SCENARIO B - ORDERS ARE PREPARED, NEVER PLACED');
    {
      const h = await newPage(browser, base);
      const page = h.page;
      await toAmbient(page);

      ok('REQ2 the widget is absent before anything is proposed',
        (await page.evaluate(function () { return window.__widgetVisible(); })) === false);

      /* things that only SOUND like orders */
      await say(page, 'we do not need an MRI at this point');
      await say(page, 'she had an MRI last year for the same thing');
      await say(page, 'can I get an MRI');
      ok('REQ2 negated, past and interrogative forms propose NOTHING',
        (await page.evaluate(function () { return window.__cards(); })).length === 0,
        JSON.stringify(await page.evaluate(function () { return window.__cards(); })));

      /* a real order, missing the side */
      await say(page, 'lets order an MRI of the knee');
      let cards = await page.evaluate(function () { return window.__cards(); });
      ok('REQ2 a spoken order appears as ONE card', cards.length === 1, JSON.stringify(cards.map(c => c.title)));
      ok('REQ2 the card names the modality', cards[0] && cards[0].title === 'MRI', cards[0] && cards[0].title);
      ok('REQ2 a missing side is DECLARED, not guessed', cards[0] && /which side/i.test(cards[0].missing), cards[0] && cards[0].missing);
      ok('REQ2 Confirm is BLOCKED while the side is unknown', cards[0] && cards[0].confirmDisabled === true);
      ok('REQ2 the doctor is offered the side in one tap', cards[0] && cards[0].sides === 3, cards[0] && String(cards[0].sides));

      /* clicking Confirm while blocked must do nothing at all */
      await page.evaluate(function () {
        const go = document.querySelector('#mlsAvKioskOrders .mlsAvOrdGo');
        go.disabled = false;                 /* defeat the attribute on purpose */
        go.click();
      });
      await page.clock.runFor(300);
      cards = await page.evaluate(function () { return window.__cards(); });
      ok('REQ2 the confirm GATE holds even with the attribute defeated',
        cards[0] && cards[0].confirmed === false, JSON.stringify(cards[0]));

      /* the doctor supplies it */
      await page.evaluate(function () { document.querySelectorAll('#mlsAvKioskOrders .mlsAvOrdPick')[0].click(); });
      await page.clock.runFor(300);
      cards = await page.evaluate(function () { return window.__cards(); });
      ok('REQ2 supplying the side unblocks Confirm', cards[0] && cards[0].confirmDisabled === false);
      ok('REQ2 the side the doctor picked is on the card', cards[0] && /left/i.test(cards[0].detail), cards[0] && cards[0].detail);

      await page.evaluate(function () { document.querySelector('#mlsAvKioskOrders .mlsAvOrdGo').click(); });
      await page.clock.runFor(300);
      cards = await page.evaluate(function () { return window.__cards(); });
      ok('REQ2 confirming marks it confirmed', cards[0] && cards[0].confirmed === true);

      /* a second, DIFFERENT order must not be merged into the first */
      await say(page, 'and lets start gabapentin 300 mg at night');
      cards = await page.evaluate(function () { return window.__cards(); });
      ok('REQ2 a different action is its own card', cards.length === 2, JSON.stringify(cards.map(c => c.title)));

      /* NOTHING was sent anywhere */
      const posts = await page.evaluate(function () {
        return window.__fetchLog.filter(function (f) { return /order|prescri|refer/i.test(f.url); }).length;
      });
      ok('REQ2 no order was transmitted to anything', posts === 0, String(posts));
      ok('scenario B page threw nothing', h.errors.length === 0, h.errors.join(' | '));
    }

    /* ------------------------------------------------------------ C */
    section('SCENARIO C - END VISIT');
    {
      const h = await newPage(browser, base);
      const page = h.page;
      await toAmbient(page);
      await say(page, 'the back pain has been going on for three weeks');
      await say(page, 'order an MRI lumbar spine without contrast');
      await page.evaluate(function () { document.querySelector('#mlsAvKioskOrders .mlsAvOrdGo').click(); });
      await page.clock.runFor(300);
      await say(page, 'lets refer him to orthopedics');   /* left UNCONFIRMED on purpose */

      ok('REQ3 the End Visit control is on screen during a capture',
        await page.evaluate(function () {
          const b = document.getElementById('mlsAvKioskEndVisit');
          return !!b && getComputedStyle(b).display !== 'none';
        }));

      /* the last sentence lands as the doctor clicks - it must not be lost */
      await page.evaluate(function () {
        window.__emit('and we will see him back in six weeks', true);
        document.getElementById('mlsAvKioskEndVisit').click();
      });
      await page.clock.runFor(3000);

      const box = await page.evaluate(function () { return window.__box(); });
      ok('REQ3 the visit reached the transcript', box.indexOf('back pain has been going on') >= 0);
      ok('REQ3 the sentence spoken AS End Visit was clicked survived the flush',
        box.indexOf('see him back in six weeks') >= 0, box.slice(-90));
      ok('REQ3 the CONFIRMED order is in the note', /MRI.*lumbar spine/i.test(box));
      ok('REQ3 the note states nothing was transmitted', /have NOT been transmitted to any EMR/.test(box));
      ok('REQ3 the UNCONFIRMED referral is NOT in the note as an order',
        box.indexOf('--- actions the doctor confirmed') >= 0 &&
        box.split('--- actions the doctor confirmed')[1].indexOf('Orthopedics') < 0,
        (box.split('--- actions the doctor confirmed')[1] || '').slice(0, 110));

      const review = await page.evaluate(function () { return window.__review(); });
      ok('REQ3 the review is shown', !!review, review ? review.slice(0, 60) + '…' : 'NOT SHOWN');
      ok('REQ3 the review says it saved', /Saved to the visit transcript/.test(review || ''));
      ok('REQ3 the review lists what was confirmed', /Confirmed and written into the note/.test(review || ''));
      ok('REQ3 the review NAMES what was heard and never confirmed',
        /Heard but NOT confirmed/.test(review || '') && /Referral/.test(review || ''),
        (review || '').slice(0, 160));

      const after = await page.evaluate(function () { return window.__amb(); });
      ok('REQ3 the capture is stopped and marked filed', after.running === false && after.filed === true,
        JSON.stringify({ running: after.running, filed: after.filed }));
      const left = await page.evaluate(function () { return window.__mlsAvatar.pendingCapture(); });
      ok('REQ3 a filed visit leaves no backup behind to re-offer', left === null);
      const recStarts = await page.evaluate(function () { return window.__log.recStarts; });
      await page.clock.runFor(8000);
      const recAfter = await page.evaluate(function () { return window.__log.recStarts; });
      ok('REQ3 the microphone does NOT come back under the review screen',
        recAfter === recStarts, recStarts + ' -> ' + recAfter);
      ok('scenario C page threw nothing', h.errors.length === 0, h.errors.join(' | '));
    }
    /* ------------------------------------------------------------ D */
    section('SCENARIO D - DISCLOSURE, PRESENCE, BARGE-IN AND PAUSE');
    {
      const h = await newPage(browser, base);
      const page = h.page;
      await page.evaluate(function () {
        window.__turnQueue = [
          { ok: true, say: 'Hello, what brings you in today?', done: false, progress: { covered: 1, total: 2 } },
          { ok: true, say: 'Thanks. How long has it been going on?', done: false, progress: { covered: 2, total: 2 } },
          { ok: true, say: 'Thank you, that is everything I needed.', done: true }
        ];
        /* speech that does NOT end by itself, so barge-in is observable */
        window.__cancels = 0;
        window.speechSynthesis.cancel = function () { window.__cancels++; };
        window.speechSynthesis.speak = function () { /* keeps "speaking" */ };
        window.__mlsAvatar.openKiosk();
      });
      await page.clock.runFor(1500);

      const vis = function (id) {
        return page.evaluate(function (i) {
          const el = document.getElementById(i);
          if (!el) return { present: false };
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          return { present: true, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
            text: (el.textContent || '').replace(/\s+/g, ' ').trim() };
        }, id);
      };

      let ai = await vis('mlsAvKioskAi');
      ok('REQ4 the AI disclosure is on screen during INTAKE', ai.visible === true, ai.text);
      ok('REQ4 the disclosure says it is not the doctor', /not the doctor/i.test(ai.text || ''), ai.text);
      let face = await vis('mlsAvKioskFace');
      ok('REQ4 the avatar itself is on screen', face.visible === true);

      /* BARGE-IN: the patient talks over the question. Two words is the guard. */
      await page.evaluate(function () { window.__emit('actually my', false); });
      await page.clock.runFor(200);
      const cancels = await page.evaluate(function () { return window.__cancels; });
      const recAlive = await page.evaluate(function () {
        const r = window.__recs[window.__recs.length - 1]; return !!(r && r.onresult);
      });
      ok('REQ4 the patient can interrupt the avatar mid-sentence', cancels > 0, 'cancel calls=' + cancels);
      ok('REQ4 barge-in stops the VOICE and leaves the microphone alive', recAlive === true);

      /* into ambient, where the avatar MUST stay on screen */
      await page.evaluate(function () {
        window.speechSynthesis.speak = function (u) { setTimeout(function () { if (u.onend) u.onend(); }, 5); };
      });
      await page.clock.runFor(14000);
      await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
      await page.clock.runFor(400);
      await page.evaluate(function () {
        document.getElementById('mlsAvKioskPinInput').value = '1234';
        document.getElementById('mlsAvKioskPinAmb').click();
      });
      await page.clock.runFor(1200);

      ai = await vis('mlsAvKioskAi');
      ok('REQ4 the disclosure is STILL on screen during room capture', ai.visible === true, ai.text);
      face = await vis('mlsAvKioskFace');
      ok('REQ4 the avatar STAYS on screen for the doctor visit', face.visible === true);
      const rec = await vis('mlsAvKioskRec');
      ok('REQ4 the recording state is shown', rec.visible === true && /Recording this visit/.test(rec.text), rec.text.slice(0, 50));
      const save = await vis('mlsAvKioskSave');
      ok('REQ4 the SAVED state is shown', save.visible === true, save.text);

      await say(page, 'the pain started three weeks ago');
      const before = await page.evaluate(function () { return window.__amb().capturedChars; });

      /* PAUSE — the invariant: a paused screen never still claims to record */
      const startsBefore = await page.evaluate(function () { return window.__log.recStarts; });
      await page.evaluate(function () { document.getElementById('mlsAvKioskMute').click(); });
      await page.clock.runFor(500);
      const recPaused = await vis('mlsAvKioskRec');
      ok('REQ4 pausing stops the screen claiming to record',
        /PAUSED/.test(recPaused.text) && !/Recording this visit/.test(recPaused.text), recPaused.text.slice(0, 60));
      const pausedClass = await page.evaluate(function () {
        return document.getElementById('mlsAvKiosk').classList.contains('paused');
      });
      ok('REQ4 the paused state drives the whole screen off one class', pausedClass === true);

      /* words spoken while paused must NOT be captured */
      await page.evaluate(function () { window.__emit('this must not be recorded at all', true); });
      await page.clock.runFor(2000);
      const during = await page.evaluate(function () { return window.__amb(); });
      ok('REQ4 nothing spoken while paused is captured', during.capturedChars === before,
        before + ' -> ' + during.capturedChars);
      ok('REQ4 what was captured BEFORE the pause is kept', during.capturedChars > 0 && during.backedUp === true,
        'chars=' + during.capturedChars + ' backedUp=' + during.backedUp);
      const startsPaused = await page.evaluate(function () { return window.__log.recStarts; });
      await page.clock.runFor(6000);
      const startsIdle = await page.evaluate(function () { return window.__log.recStarts; });
      ok('REQ4 the microphone does not reopen by itself while paused', startsIdle === startsPaused,
        startsBefore + ' -> ' + startsPaused + ' -> ' + startsIdle);

      /* RESUME */
      await page.evaluate(function () { document.getElementById('mlsAvKioskMute').click(); });
      await page.clock.runFor(600);
      const recBack = await vis('mlsAvKioskRec');
      ok('REQ4 resuming restores the recording disclosure', /Recording this visit/.test(recBack.text), recBack.text.slice(0, 50));
      await say(page, 'and it radiates into the left leg');
      const after = await page.evaluate(function () { return window.__amb().capturedChars; });
      ok('REQ4 capture works again after resume', after > during.capturedChars, during.capturedChars + ' -> ' + after);
      ok('scenario D page threw nothing', h.errors.length === 0, h.errors.join(' | '));
    }

    /* ------------------------------------------------------------ E */
    section('SCENARIO E - MEASURED LATENCY (real clock, not a faked one)');
    {
      /* No page.clock here: latency measured against a faked clock is a
         number about the fake. This page runs on real time. */
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errs = [];
      page.on('pageerror', function (e) { errs.push(String((e && e.message) || e)); });
      await page.goto(base + '/page.html');
      await page.evaluate(STUBS);
      await page.evaluate(function () {
        document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
      });
      await page.addScriptTag({ content: AVATAR_SRC });
      await page.waitForTimeout(1200);
      await page.evaluate(function () {
        window.__turnQueue = [{ ok: true, say: 'Hello?', done: true }];
        window.__mlsAvatar.openKiosk();
      });
      await page.waitForTimeout(900);
      await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
      await page.waitForTimeout(300);
      await page.evaluate(function () {
        document.getElementById('mlsAvKioskPinInput').value = '1234';
        document.getElementById('mlsAvKioskPinAmb').click();
      });
      await page.waitForTimeout(900);

      /* MIC -> PROPOSAL ON SCREEN. The recogniser handing us a finalised
         phrase is t0; the card being painted is t1. Everything between is
         ours: dedupe, detection, upsert, render. */
      const samples = [];
      const SENTENCES = [
        'order an MRI lumbar spine without contrast',
        'lets get a CT of the abdomen and pelvis with contrast',
        'start gabapentin 300 mg at night',
        'lets refer him to orthopedics',
        'order an x-ray of the right shoulder'
      ];
      for (let i = 0; i < SENTENCES.length; i++) {
        const ms = await page.evaluate(function (text) {
          const t0 = performance.now();
          window.__emit(text, true);
          const n = document.querySelectorAll('#mlsAvKioskOrders .mlsAvOrd').length;
          return { ms: performance.now() - t0, cards: n };
        }, SENTENCES[i]);
        samples.push(ms);
        await page.waitForTimeout(120);
      }
      const times = samples.map(function (s) { return s.ms; });
      const worst = Math.max.apply(null, times);
      const mean = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
      const painted = samples.filter(function (s) { return s.cards > 0; }).length;
      console.log('  ---- measured: transcript-final -> proposal painted ----');
      samples.forEach(function (s, i) {
        console.log('     ' + s.ms.toFixed(1).padStart(6) + ' ms   ' + SENTENCES[i].slice(0, 46));
      });
      console.log('     mean ' + mean.toFixed(1) + ' ms, worst ' + worst.toFixed(1) + ' ms');
      ok('REQ5 a spoken order is on screen in the same tick it is heard', painted === SENTENCES.length,
        painted + '/' + SENTENCES.length + ' painted synchronously');
      ok('REQ5 mic-to-proposal stays under 50 ms', worst < 50, 'worst ' + worst.toFixed(1) + ' ms');

      /* END VISIT -> SAVED. Dominated by the deliberate recogniser-flush wait
         (the last sentence of a visit is usually the plan), so this measures
         that the wait is BOUNDED, not that it is zero.
         The stub recogniser stops SYNCHRONOUSLY, which real Chrome does not —
         measuring against it would report our own overhead and call it the
         flush. Model Chrome instead: onend arrives ~150ms after stop(), so the
         120ms poll loop is actually exercised. */
      await page.evaluate(function () {
        const r = window.__recs[window.__recs.length - 1];
        if (!r) return;
        r.stop = function () { r.live = false; setTimeout(function () { if (r.onend) r.onend(); }, 150); };
      });
      const endMs = await page.evaluate(function () {
        return new Promise(function (resolve) {
          const t0 = performance.now();
          document.getElementById('mlsAvKioskEndVisit').click();
          (function poll() {
            const p = document.getElementById('mlsAvKioskReview');
            if (p && getComputedStyle(p).display !== 'none') { resolve(performance.now() - t0); return; }
            setTimeout(poll, 15);
          })();
        });
      });
      console.log('  ---- measured: End Visit click -> review shown: ' + endMs.toFixed(0) + ' ms ----');
      ok('REQ5 End Visit completes well inside its flush budget', endMs < 2500, endMs.toFixed(0) + ' ms');
      const saved = await page.evaluate(function () { return window.__box().length; });
      ok('REQ5 and it actually saved', saved > 0, saved + ' chars');
      ok('scenario E page threw nothing', errs.length === 0, errs.join(' | '));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  if (failures.length) {
    console.log('FAIL visit copilot proof: ' + failures.length + ' of ' + (pass + failures.length) + ' checks failed');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
  console.log('PASS visit copilot proof: ' + pass + ' checks in real Chromium on a real origin — a visit survives a ' +
    'mid-encounter reload and files to the right chart (and refuses the wrong one), spoken orders are prepared but ' +
    'cannot be confirmed while a required detail is missing (gate holds with the attribute defeated), and End Visit ' +
    'flushes the last sentence, files, and names what was never confirmed');
})().catch(function (e) {
  console.error('PROOF CRASHED:', (e && e.stack) || e);
  process.exit(1);
});
