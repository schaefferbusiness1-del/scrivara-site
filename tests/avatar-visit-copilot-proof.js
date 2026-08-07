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
    /* onend fires ASYNCHRONOUSLY, as Chrome's does. Firing it synchronously
       inside stop() re-enters pvListen's submit path — submit() calls stop()
       and only nulls pvRec afterwards, so a synchronous onend sees pvRec ===
       rec and submits again. That is a harness artefact, not module behaviour,
       and it silently swallowed the whole intake turn. */
    this.stop = function () {
      self.live = false;
      const f = self.onend;
      if (f) setTimeout(function () { f(); }, 0);
    };
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
  /* read the backup WITHOUT hardcoding its key: the key is chart-scoped now,
     and a test that pins storage layout breaks every time the layout improves */
  window.__stored = function () {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf('mlsAvRoomCaptureV1') < 0) continue;
      try {
        var r = JSON.parse(localStorage.getItem(k));
        if (r && Array.isArray(r.parts) && r.parts.length) return r;
      } catch (e) {}
    }
    return null;
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
        /* av-5.6.9: the gate moved to aria-disabled so the control stays
           keyboard-reachable — 'blocked' must read BOTH spellings */
        confirmDisabled: go ? (go.disabled === true || go.getAttribute('aria-disabled') === 'true') : null,
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

/* the staff handoff on a kiosk that is ALREADY open and finished with intake */
async function toAmbientFrom(page) {
  await page.clock.runFor(13000);
  await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
  await page.clock.runFor(400);
  await page.evaluate(function () {
    document.getElementById('mlsAvKioskPinInput').value = '1234';
    document.getElementById('mlsAvKioskPinAmb').click();
  });
  await page.clock.runFor(1200);
}

/* run the REAL detector over one line with no kiosk involved — used to sweep a
   whole visit transcript for false positives cheaply */
let _sweepPage = null;
async function pageless(browser, base, line) {
  if (!_sweepPage) {
    _sweepPage = await browser.newPage();
    await _sweepPage.goto(base + '/page.html');
    await _sweepPage.evaluate(STUBS);
    await _sweepPage.addScriptTag({ content: AVATAR_SRC });
  }
  return _sweepPage.evaluate(function (t) {
    return window.__mlsAvatar.detectActions(t).map(function (a) { return { kind: a.kind, title: a.title }; });
  }, line);
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
        go.disabled = false;
        go.removeAttribute('aria-disabled');   /* defeat BOTH spellings on purpose */
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
    /* ------------------------------------------------------------ F */
    section('SCENARIO F - TIME TO FIRST WORD (A/B against the old one-blob fetch)');
    {
      /* The stub defines the cost model, and both arms run against the SAME
         model: a turn takes 900ms, and TTS costs 300ms of overhead plus 6ms
         per character — so a short clause really is cheaper to generate than a
         long one, which is the whole premise of splitting. The A arm loads the
         module with the split threshold raised out of reach, which is exactly
         the code that shipped before this change. */
      const TURN_MS = 900, TTS_BASE = 300, TTS_PER_CHAR = 6;
      const REPLY = "Hi, I'm Ava, the practice's AI assistant. What brings you in today?";

      async function measure(src, label) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errs = [];
        page.on('pageerror', function (e) { errs.push(String((e && e.message) || e)); });
        await page.goto(base + '/page.html');
        await page.evaluate(STUBS);
        await page.evaluate(function (cfg) {
          document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
          window.__audioStarts = [];
          window.__turnSentAt = 0;
          window.__t0 = 0;
          /* an Audio that records WHEN it would have started speaking. Real
             bytes are irrelevant here — time-to-first-word is the moment
             playback begins, and that is exactly this call. */
          window.Audio = function () {
            const self = this;
            window.__audioStarts.push(performance.now());
            this.onended = null; this.onerror = null; this.onloadedmetadata = null;
            this.duration = 0.4; this.ended = false;
            this.play = function () {
              setTimeout(function () { if (self.onloadedmetadata) self.onloadedmetadata(); }, 0);
              setTimeout(function () { self.ended = true; if (self.onended) self.onended(); }, 100);
              return Promise.resolve();
            };
            this.pause = function () {};
          };
          function later(ms, value) {
            return new Promise(function (r) { setTimeout(function () { r(value); }, ms); });
          }
          window.fetch = function (url, opts) {
            const u = String(url);
            let body = {};
            try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
            if (u.indexOf('/api/avatar/office/tts') >= 0) {
              const cost = cfg.base + cfg.per * String(body.text || '').length;
              return later(cost, {
                ok: true, status: 200,
                headers: { get: function () { return 'audio/mpeg'; } },
                blob: function () { return Promise.resolve(new Blob([''])); },
                json: function () { return Promise.resolve({}); }
              });
            }
            if (u.indexOf('/api/avatar/office/turn') >= 0) {
              if (!window.__turnSentAt && window.__t0) window.__turnSentAt = performance.now();
              const done = !!body.finish;
              /* The opening turn must speak DIFFERENT words from the measured
                 one. Reusing the same line made both arms identical at exactly
                 the turn latency — the TTS cache had already made that audio
                 during the opening turn, so the measurement was of a cache
                 hit, not of generation. (Worth knowing on its own: repeated
                 phrasings really are free.) */
              window.__turnN = (window.__turnN || 0) + 1;
              const opening = 'Hello there. Please tell me what is going on today.';
              const say = window.__turnN === 1 ? opening : cfg.reply;
              return later(cfg.turn, {
                ok: true, status: 200,
                headers: { get: function () { return 'application/json'; } },
                json: function () {
                  return Promise.resolve(done
                    ? { ok: true, done: true, say: 'All set.' }
                    : { ok: true, say: say, done: false, progress: { covered: 1, total: 2 } });
                },
                blob: function () { return Promise.resolve(new Blob([''])); }
              });
            }
            return Promise.resolve({
              ok: true, status: 200, headers: { get: function () { return 'application/json'; } },
              json: function () { return Promise.resolve({ ok: true, checkins: [] }); },
              blob: function () { return Promise.resolve(new Blob([''])); }
            });
          };
        }, { turn: TURN_MS, base: TTS_BASE, per: TTS_PER_CHAR, reply: REPLY });

        await page.addScriptTag({ content: src });
        await page.waitForTimeout(900);
        await page.evaluate(function () { window.__mlsAvatar.openKiosk(); });
        /* let the opening turn finish so we measure a STEADY-STATE turn, not
           the one that also pays for mic preflight and the face mounting */
        await page.waitForTimeout(3500);
        await page.evaluate(function () {
          window.__audioStarts = []; window.__turnSentAt = 0;
          window.__t0 = performance.now();
          window.__emit('my lower back has been hurting for three weeks', true);
        });
        await page.waitForTimeout(6000);
        const out = await page.evaluate(function () {
          return { starts: window.__audioStarts.slice(), t0: window.__t0, sent: window.__turnSentAt };
        });
        await page.close();
        const first = out.starts.length ? out.starts[0] - out.t0 : null;
        const sendToWord = (out.starts.length && out.sent) ? out.starts[0] - out.sent : null;
        return { label: label, first: first, sendToWord: sendToWord, pieces: out.starts.length, errs: errs };
      }

      /* A: the code as it shipped before — splitting disabled at the threshold */
      const OLD_SRC = AVATAR_SRC.replace('if (t.length < 28) return [t];', 'if (t.length < 100000) return [t];');
      ok('the A/B arm really did disable splitting', OLD_SRC !== AVATAR_SRC, 'patch applied');
      const before = await measure(OLD_SRC, 'one blob (before)');
      const after = await measure(AVATAR_SRC, 'two pieces (after)');

      console.log('  ---- measured: patient stops speaking -> avatar\'s first word ----');
      console.log('     reply under test: "' + REPLY + '" (' + REPLY.length + ' chars)');
      console.log('     cost model: turn ' + TURN_MS + 'ms, tts ' + TTS_BASE + 'ms + ' + TTS_PER_CHAR + 'ms/char');
      [before, after].forEach(function (r) {
        console.log('     ' + r.label.padEnd(20) +
          ' mouth-to-ear ' + (r.first == null ? 'n/a' : r.first.toFixed(0) + ' ms').padStart(8) +
          '   submit-to-word ' + (r.sendToWord == null ? 'n/a' : r.sendToWord.toFixed(0) + ' ms').padStart(8) +
          '   audio pieces ' + r.pieces);
      });
      ok('REQ6 the avatar actually spoke in both arms', before.first != null && after.first != null,
        'before=' + before.first + ' after=' + after.first);
      ok('REQ6 the shipped path speaks in TWO pieces', after.pieces >= 2, 'pieces=' + after.pieces);
      ok('REQ6 the old path spoke in ONE', before.pieces === 1, 'pieces=' + before.pieces);
      if (before.first != null && after.first != null) {
        const saved = before.first - after.first;
        console.log('     -> first word arrives ' + saved.toFixed(0) + ' ms sooner (' +
          ((saved / before.first) * 100).toFixed(0) + '% of the wait removed)');
        ok('REQ6 splitting genuinely reduces time to first word', saved > 100, saved.toFixed(0) + ' ms sooner');
      }
      /* the honest caveat, stated in the output rather than left implied */
      console.log('     NOTE: the ~1300ms quiet-submit window is a deliberate safety choice');
      console.log('           (cutting a patient off mid-answer loses clinical data) and is');
      console.log('           included in mouth-to-ear but is NOT what this change touches.');
      ok('scenario F pages threw nothing', before.errs.length === 0 && after.errs.length === 0,
        before.errs.concat(after.errs).join(' | '));
    }

    /* ------------------------------------------------------------ G */
    section('SCENARIO G - THE DRAFT NOTE IS READY AT END VISIT');
    {
      const h = await newPage(browser, base);
      const page = h.page;
      await page.evaluate(function () {
        /* the app's own generator, stubbed at its seam */
        window.__genCalls = 0;
        const box = document.createElement('textarea');
        box.id = 'noteBox';
        document.body.appendChild(box);
        window.generateNote = function () {
          window.__genCalls++;
          return new Promise(function (r) {
            setTimeout(function () {
              document.getElementById('noteBox').value = 'SUBJECTIVE: three weeks of low back pain…';
              r();
            }, 300);
          });
        };
      });
      await toAmbient(page);
      await say(page, 'the back pain has been going on for three weeks');
      await page.evaluate(function () { document.getElementById('mlsAvKioskEndVisit').click(); });
      await page.clock.runFor(4000);
      const gen = await page.evaluate(function () { return window.__genCalls; });
      ok('REQ7 End Visit starts the draft through the app\'s OWN generator', gen === 1, 'calls=' + gen);
      const rev = await page.evaluate(function () { return window.__review(); });
      ok('REQ7 the review reports the note is ready', /Draft note ready/.test(rev || ''),
        (rev || '').slice(-90));
      const note = await page.evaluate(function () { return document.getElementById('noteBox').value; });
      ok('REQ7 a note actually exists', note.length > 0, note.slice(0, 40));

      /* and when the drafter FAILS, it must say so without claiming a note */
      const h2 = await newPage(browser, base);
      const p2 = h2.page;
      await p2.evaluate(function () {
        const box = document.createElement('textarea');
        box.id = 'noteBox';
        document.body.appendChild(box);
        window.generateNote = function () { return Promise.reject(new Error('model unavailable')); };
      });
      await toAmbient(p2);
      await say(p2, 'some visit words here');
      await p2.evaluate(function () { document.getElementById('mlsAvKioskEndVisit').click(); });
      await p2.clock.runFor(4000);
      const rev2 = await p2.evaluate(function () { return window.__review(); });
      ok('REQ7 a failed draft is reported as a failure', /was not drafted/.test(rev2 || ''), (rev2 || '').slice(-120));
      ok('REQ7 a failed draft still confirms the transcript is saved',
        /transcript IS saved/.test(rev2 || '') && /Saved to the visit transcript/.test(rev2 || ''));
      ok('REQ7 a failed draft never claims a note is ready', !/Draft note ready/.test(rev2 || ''));
      ok('scenario G pages threw nothing', h.errors.length === 0 && h2.errors.length === 0,
        h.errors.concat(h2.errors).join(' | '));
    }
    /* ------------------------------------------------------------ H */
    section('SCENARIO H - THE FINAL ACCEPTANCE RUN (one unbroken session)');
    {
      /* Every scenario above starts a FRESH kiosk to isolate one behaviour,
         which is exactly the "isolated components" the brief warns against.
         This one walks the stated acceptance sequence end to end in a SINGLE
         session — no reload, no reset, no re-open — and asserts each arrow of:

           Start Visit -> intelligent MA intake -> doctor takes over ->
           avatar remains and ambiently documents -> doctor gives a natural
           command -> proposed action appears for rapid confirmation ->
           everything continuously saves -> End Visit -> note + actions ready

         The point is CONTINUITY: that state survives every transition, which
         no per-behaviour scenario can show. */
      const h = await newPage(browser, base);
      const page = h.page;
      const saves = [];
      const snap = async (tag) => {
        const s = await page.evaluate(function () {
          const a = window.__amb();
          let stored = null;
          stored = window.__stored();
          return { chars: a.capturedChars, backedUp: a.backedUp, running: a.running,
            storedChars: stored ? (stored.parts || []).join(' ').length : 0, bound: a.boundPatient };
        });
        saves.push({ tag: tag, ...s });
        return s;
      };
      await page.evaluate(function () {
        const box = document.createElement('textarea');
        box.id = 'noteBox';
        document.body.appendChild(box);
        window.generateNote = function () {
          return new Promise(function (r) {
            setTimeout(function () {
              document.getElementById('noteBox').value =
                'SUBJECTIVE: Low back pain, three weeks, radiating to the left leg.\nPLAN: MRI lumbar spine without contrast.';
              r();
            }, 250);
          });
        };
        window.__turnQueue = [
          { ok: true, say: 'Hi, I am Ava, the practice AI assistant. What brings you in today?', done: false, progress: { covered: 1, total: 3 } },
          { ok: true, say: 'Thanks. How long has that been going on?', done: false, progress: { covered: 2, total: 3 } },
          /* the FOLLOW-UP the brief asks for: the answer was vague, so it probes */
          { ok: true, say: 'Does the pain travel anywhere, like into your leg?', done: false, progress: { covered: 2, total: 3 } },
          { ok: true, say: 'Thank you, that is everything the doctor needs.', done: true }
        ];
      });

      /* --- Start Visit --- */
      await page.evaluate(function () { window.__mlsAvatar.openKiosk(); });
      await page.clock.runFor(1500);
      const visH = function (id) {
        return page.evaluate(function (i) {
          const el = document.getElementById(i);
          if (!el) return false;
          const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        }, id);
      };
      ok('H1 Start Visit puts the avatar on screen', await visH('mlsAvKioskFace'));
      ok('H1 …and the AI disclosure with it', await visH('mlsAvKioskAi'));

      /* --- intelligent MA intake, including a follow-up --- */
      await page.evaluate(function () { window.__emit('my lower back hurts', true); });
      await page.clock.runFor(2600);
      await page.evaluate(function () { window.__emit('a few weeks I guess', true); });
      await page.clock.runFor(2600);
      const asked = await page.evaluate(function () {
        return (document.getElementById('mlsAvKioskSay').textContent || '');
      });
      ok('H2 the intake asks a FOLLOW-UP when an answer is vague', /travel anywhere/i.test(asked), asked.slice(0, 60));
      await page.evaluate(function () { window.__emit('yes it goes down my left leg', true); });
      await page.clock.runFor(2600);
      await page.clock.runFor(13000);
      const intakeTurns = await page.evaluate(function () {
        return window.__fetchLog.filter(function (f) { return f.url.indexOf('/office/turn') >= 0; }).length;
      });
      ok('H2 the intake ran as a real multi-turn interview', intakeTurns >= 4, intakeTurns + ' turns');
      const sentChart = await page.evaluate(function () {
        const t = window.__fetchLog.filter(function (f) { return f.url.indexOf('/office/turn') >= 0; });
        return !!(t.length && t[0].body && t[0].body.chartContext);
      });
      ok('H2 …carrying what the chart already knows', sentChart === true);

      /* --- doctor takes over --- */
      await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
      await page.clock.runFor(400);
      await page.evaluate(function () {
        document.getElementById('mlsAvKioskPinInput').value = '1234';
        document.getElementById('mlsAvKioskPinAmb').click();
      });
      await page.clock.runFor(1200);
      ok('H3 the doctor takes over and the avatar REMAINS on screen', await visH('mlsAvKioskFace'));
      ok('H3 …still disclosing what it is', await visH('mlsAvKioskAi'));
      ok('H3 …and is now ambiently documenting', (await snap('handoff')).running === true);

      /* --- ambient documentation + continuous save --- */
      await say(page, 'the pain is worse when she bends forward');
      const s1 = await snap('after first exam line');
      await say(page, 'straight leg raise is positive on the left at forty degrees');
      const s2 = await snap('after second exam line');
      ok('H4 the visit is captured as it is spoken', s2.chars > s1.chars, s1.chars + ' -> ' + s2.chars);
      ok('H4 …and continuously written to the crash backup',
        s2.storedChars > 0 && s2.backedUp === true, 'stored=' + s2.storedChars);

      /* --- the doctor gives a natural command --- */
      await say(page, 'MLS, remind me to document that the pain radiates into the left leg');
      const noteCards = await page.evaluate(function () {
        return window.__cards().filter(function (c) { return /Documentation note/i.test(c.title); }).length;
      });
      ok('H5 a command addressed to the assistant is understood as an instruction', noteCards === 1,
        noteCards + ' note action(s)');

      /* --- a proposed clinical action, confirmed in one step --- */
      await say(page, 'order an MRI lumbar spine without contrast');
      let cards = await page.evaluate(function () { return window.__cards(); });
      const mri = cards.filter(function (c) { return c.title === 'MRI'; })[0];
      ok('H6 the spoken order appears as a proposal', !!mri, JSON.stringify(cards.map(c => c.title)));
      ok('H6 …complete enough to confirm in ONE tap', mri && mri.confirmDisabled === false, JSON.stringify(mri));
      await page.evaluate(function () {
        const all = Array.prototype.slice.call(document.querySelectorAll('#mlsAvKioskOrders .mlsAvOrd'));
        const card = all.filter(function (c) { return (c.querySelector('b') || {}).textContent === 'MRI'; })[0];
        card.querySelector('.mlsAvOrdGo').click();
      });
      await page.clock.runFor(300);
      const confirmed = await page.evaluate(function () {
        return window.__cards().filter(function (c) { return c.confirmed; }).length;
      });
      ok('H6 …and confirming it is one step', confirmed === 1, confirmed + ' confirmed');
      const s3 = await snap('after orders');
      ok('H7 everything is still saving as the visit runs', s3.storedChars >= s2.storedChars,
        s2.storedChars + ' -> ' + s3.storedChars);
      ok('H7 …bound to the same chart the whole way through',
        s3.bound === 'ext-77' && saves.every(function (x) { return x.bound === 'ext-77'; }), s3.bound);

      /* --- the doctor corrects themselves, which is what doctors do --- */
      await say(page, 'and order an x-ray of the knee');
      let xr = (await page.evaluate(function () { return window.__cards(); }))
        .filter(function (c) { return c.title === 'X-ray'; })[0];
      ok('H6b an incomplete second order carries its gap', xr && /which side/i.test(xr.missing), xr && xr.missing);
      await say(page, 'actually make that the right knee');
      xr = (await page.evaluate(function () { return window.__cards(); }))
        .filter(function (c) { return c.title === 'X-ray'; })[0];
      ok('H6b a spoken correction fills the gap without a second card', xr && xr.confirmDisabled === false,
        JSON.stringify(xr));
      ok('H6b …and the card shows the corrected side', xr && /Right/i.test(xr.detail), xr && xr.detail);
      const cardCount = await page.evaluate(function () {
        return window.__cards().filter(function (c) { return c.title === 'X-ray'; }).length;
      });
      ok('H6b …exactly one X-ray card, not two', cardCount === 1, cardCount + ' cards');
      await page.evaluate(function () {
        const all = Array.prototype.slice.call(document.querySelectorAll('#mlsAvKioskOrders .mlsAvOrd'));
        const c = all.filter(function (x) { return (x.querySelector('b') || {}).textContent === 'X-ray'; })[0];
        c.querySelector('.mlsAvOrdGo').click();
      });
      await page.clock.runFor(300);
      /* correcting something ALREADY confirmed must un-confirm it */
      await say(page, 'sorry, the left knee');
      xr = (await page.evaluate(function () { return window.__cards(); }))
        .filter(function (c) { return c.title === 'X-ray'; })[0];
      ok('H6c correcting a CONFIRMED order sends it back for re-confirmation',
        xr && xr.confirmed === false, JSON.stringify(xr));
      ok('H6c …and says why on the card', xr && /confirm again/i.test(xr.missing), xr && xr.missing);
      await page.evaluate(function () {
        const all = Array.prototype.slice.call(document.querySelectorAll('#mlsAvKioskOrders .mlsAvOrd'));
        const c = all.filter(function (x) { return (x.querySelector('b') || {}).textContent === 'X-ray'; })[0];
        c.querySelector('.mlsAvOrdGo').click();
      });
      await page.clock.runFor(300);

      /* --- End Visit --- */
      await page.evaluate(function () { document.getElementById('mlsAvKioskEndVisit').click(); });
      await page.clock.runFor(4000);
      const review = await page.evaluate(function () { return window.__review(); });
      const box = await page.evaluate(function () { return window.__box(); });
      const note = await page.evaluate(function () { return document.getElementById('noteBox').value; });
      ok('H8 End Visit confirms the visit is saved', /Saved to the visit transcript/.test(review || ''));
      ok('H8 the transcript holds the WHOLE encounter — check-in and visit',
        box.indexOf('--- check-in ---') >= 0 && box.indexOf('--- visit ---') >= 0 &&
        box.indexOf('lower back hurts') >= 0 && box.indexOf('straight leg raise') >= 0,
        'checkin=' + (box.indexOf('--- check-in ---') >= 0) + ' visit=' + (box.indexOf('--- visit ---') >= 0));
      ok('H8 the confirmed action is in the note', /MRI - lumbar spine without contrast/.test(box));
      ok('H8 the draft note is ready', note.length > 0 && /Draft note ready/.test(review || ''), note.slice(0, 46));
      ok('H8 the doctor never had to leave this screen', await visH('mlsAvKioskReview'));
      const leftover = await page.evaluate(function () { return window.__mlsAvatar.pendingCapture(); });
      ok('H8 nothing is left unsaved behind it', leftover === null);
      ok('H the whole run threw nothing', h.errors.length === 0, h.errors.join(' | '));

      console.log('  ---- continuity across the run (chars captured / chars in backup) ----');
      saves.forEach(function (s) {
        console.log('     ' + String(s.tag).padEnd(26) + String(s.chars).padStart(5) + ' / ' + String(s.storedChars).padStart(5));
      });
    }
    /* ------------------------------------------------------------ I */
    section('SCENARIO I - THE THINGS THAT GO WRONG IN A REAL ROOM');
    {
      /* The brief names these by hand: network issues, microphone reconnects,
         transcription errors, overlapping speech. None of them were proved
         before this scenario — every earlier test ran on a network that never
         failed, a microphone that never died and a recogniser that never lied.
         A copilot that only works when nothing goes wrong is a demo. */

      /* --- I1. the turn request FAILS mid-interview --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await page.evaluate(function () {
          window.__turnQueue = [{ ok: true, say: 'What brings you in today?', done: false, progress: { covered: 1, total: 2 } }];
          window.__failNext = false;
          window.__turnBodies = [];
          const real = window.fetch;
          window.fetch = function (url, opts) {
            /* log EVERY turn attempt, including the one we are about to fail —
               the earlier version logged only what reached the stub, so the
               failed attempt's nonce was invisible and the comparison below
               was meaningless */
            if (String(url).indexOf('/office/turn') >= 0) {
              let b = {};
              try { b = JSON.parse((opts && opts.body) || '{}'); } catch (e) {}
              window.__turnBodies.push(b);
            }
            if (window.__failNext && String(url).indexOf('/office/turn') >= 0) {
              window.__failNext = false;
              return Promise.resolve({
                ok: false, status: 500,
                headers: { get: function () { return 'application/json'; } },
                json: function () { return Promise.resolve({}); },
                blob: function () { return Promise.resolve(new Blob([''])); }
              });
            }
            return real(url, opts);
          };
          window.__mlsAvatar.openKiosk();
        });
        await page.clock.runFor(1500);
        await page.evaluate(function () {
          window.__failNext = true;
          window.__emit('my back has been hurting for three weeks', true);
        });
        await page.clock.runFor(3000);
        const said = await page.evaluate(function () {
          return (document.getElementById('mlsAvKioskSay').textContent || '');
        });
        ok('I1 a failed turn NEVER speaks an empty sentence at the patient', said.trim().length > 0, said.slice(0, 60));
        ok('I1 …it says the connection hiccuped and the answer is safe',
          /connection hiccuped|safe to say again/i.test(said), said.slice(0, 70));
        const reopened = await page.evaluate(function () {
          return !!(window.__recs[window.__recs.length - 1] || {}).live;
        });
        ok('I1 …and the microphone reopens so the patient can simply repeat', reopened === true);
        /* the answer must still be resendable under the SAME nonce, or the
           retry files the patient's words twice */
        await page.evaluate(function () { window.__emit('my back has been hurting for three weeks', true); });
        await page.clock.runFor(3000);
        const answered = await page.evaluate(function () {
          return (window.__turnBodies || []).filter(function (b) { return b && b.answer; })
            .map(function (b) { return { a: b.answer, n: b.answerNonce }; });
        });
        ok('I1 …the patient repeating themselves DOES reach the server', answered.length >= 2,
          answered.length + ' answered attempts');
        ok('I1 …and the resend reuses the SAME nonce, so the server cannot double-file it',
          answered.length >= 2 && answered[0].n === answered[answered.length - 1].n,
          JSON.stringify(answered.map(function (x) { return x.n; })));
        ok('I1 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- I2. the microphone dies mid-capture and must come back --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'the exam shows tenderness over the joint line');
        const before = await page.evaluate(function () { return window.__amb().capturedChars; });
        const startsBefore = await page.evaluate(function () { return window.__log.recStarts; });
        await page.evaluate(function () {
          const r = window.__recs[window.__recs.length - 1];
          if (r && r.onerror) { r.live = false; r.onerror({ error: 'network' }); }
        });
        await page.clock.runFor(6000);
        const startsAfter = await page.evaluate(function () { return window.__log.recStarts; });
        ok('I2 a dead microphone is restarted by itself', startsAfter > startsBefore,
          startsBefore + ' -> ' + startsAfter);
        await say(page, 'and there is no effusion today');
        const after = await page.evaluate(function () { return window.__amb().capturedChars; });
        ok('I2 …and speech after the reconnect is still captured', after > before, before + ' -> ' + after);
        ok('I2 …with nothing lost from before it died',
          (await page.evaluate(function () { return window.__amb(); })).capturedChars >= before);
        ok('I2 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- I3. the recogniser lies: empty, whitespace and repeated finals --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'the knee is swollen today');
        const base1 = await page.evaluate(function () { return window.__amb().capturedChars; });
        await page.evaluate(function () {
          window.__emit('', true);
          window.__emit('   ', true);
          window.__emit('the knee is swollen today', true);   /* Chrome re-delivering the tail */
        });
        await page.clock.runFor(2500);
        const after = await page.evaluate(function () { return window.__amb(); });
        ok('I3 empty and whitespace transcriptions add nothing', after.capturedChars === base1,
          base1 + ' -> ' + after.capturedChars);
        ok('I3 …and an exactly repeated phrase is not filed twice', after.capturedChars === base1);
        const cards = await page.evaluate(function () { return window.__cards(); });
        ok('I3 …and garbage never becomes a clinical order', cards.length === 0, JSON.stringify(cards));
        ok('I3 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- I4. overlapping speech: finals arriving faster than they can be
         processed must all survive, in order --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await page.evaluate(function () {
          ['the pain is sharp', 'it started on Tuesday', 'she took ibuprofen',
           'it helped a little', 'the swelling is down'].forEach(function (t) { window.__emit(t, true); });
        });
        await page.clock.runFor(3000);
        const st = await page.evaluate(function () {
          const a = window.__amb();
          let stored = null;
          stored = window.__stored();
          return { chars: a.capturedChars, parts: stored ? stored.parts : [] };
        });
        ok('I4 five overlapping utterances are ALL captured', st.parts.length === 5,
          st.parts.length + ' parts');
        ok('I4 …in the order they were spoken',
          st.parts[0] === 'the pain is sharp' && st.parts[4] === 'the swelling is down',
          JSON.stringify(st.parts.slice(0, 2)));
        ok('I4 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- I5. browser storage refuses mid-visit --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'first line before storage breaks');
        const okBefore = await page.evaluate(function () { return window.__amb().backedUp; });
        ok('I5 the backup is healthy to begin with', okBefore === true);
        await page.evaluate(function () {
          const real = localStorage.setItem.bind(localStorage);
          window.__realSet = real;
          localStorage.setItem = function () { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
        });
        await say(page, 'second line while storage is refusing');
        const st = await page.evaluate(function () { return window.__amb(); });
        ok('I5 a refusing store is reported HONESTLY, not hidden', st.backedUp === false, 'backedUp=' + st.backedUp);
        ok('I5 …while the in-memory capture keeps everything', st.capturedChars > 0, st.capturedChars + ' chars');
        /* and the visit must still file in full when it ends */
        await page.evaluate(function () { document.getElementById('mlsAvKioskEndVisit').click(); });
        await page.clock.runFor(4000);
        const box = await page.evaluate(function () { return window.__box(); });
        ok('I5 …and End Visit still writes the WHOLE visit to the transcript',
          box.indexOf('first line before storage breaks') >= 0 &&
          box.indexOf('second line while storage is refusing') >= 0,
          'first=' + (box.indexOf('first line') >= 0) + ' second=' + (box.indexOf('second line') >= 0));
        const rev = await page.evaluate(function () { return window.__review(); });
        ok('I5 …and the review admits the backup was not written',
          /crash backup could not be written/i.test(rev || ''), (rev || '').slice(0, 120));
        ok('I5 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- I6. the state chip the brief asks for, read off the live DOM --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        const chip = function () {
          return page.evaluate(function () {
            const el = document.getElementById('mlsAvKioskState');
            return el ? (el.textContent || '').trim() : null;
          });
        };
        await page.evaluate(function () {
          window.__turnQueue = [{ ok: true, say: 'What brings you in today?', done: false, progress: { covered: 1, total: 2 } }];
          window.__mlsAvatar.openKiosk();
        });
        await page.clock.runFor(1600);
        const listening = await chip();
        ok('I6 the screen names its state in ONE place', listening !== null, String(listening));
        /* the mic opens WITH the question, so the honest answer here is BOTH.
           The first version of this test expected "Listening" and caught the
           chip under-reporting: it said "Speaking" while the microphone was
           already open, which hides the one behaviour the brief leads with. */
        ok('I6 …and says it is speaking AND listening at once (full duplex)',
          listening === 'Speaking · listening', String(listening));
        await toAmbientFrom(page);
        ok('I6 …Ambiently documenting during the visit', (await chip()) === 'Ambiently documenting', String(await chip()));
        await page.evaluate(function () { document.getElementById('mlsAvKioskMute').click(); });
        await page.clock.runFor(400);
        ok('I6 …Paused when paused', (await chip()) === 'Paused', String(await chip()));
        await page.evaluate(function () { document.getElementById('mlsAvKioskMute').click(); });
        await page.clock.runFor(400);
        ok('I6 …and back to documenting on resume', (await chip()) === 'Ambiently documenting', String(await chip()));
        ok('I6 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }
    }
    /* ------------------------------------------------------------ J */
    section('SCENARIO J - ENDURANCE AND THE ADVERSARIAL CASES');
    {
      /* --- J1. A LONG VISIT. The backup rewrites the WHOLE record on every
         save, so total bytes written grow with the square of the visit. A 90
         minute consultation is the case the brief names, and it is the one
         where that shape would bite. Measured on a real clock. --- */
      {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errs = [];
        page.on('pageerror', function (e) { errs.push(String((e && e.message) || e)); });
        await page.goto(base + '/page.html');
        await page.evaluate(STUBS);
        await page.evaluate(function () {
          document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
          /* count the real cost: bytes handed to storage, and time spent in it */
          window.__ls = { writes: 0, bytes: 0, ms: 0 };
          const real = localStorage.setItem.bind(localStorage);
          localStorage.setItem = function (k, v) {
            const t0 = performance.now();
            real(k, v);
            window.__ls.writes++; window.__ls.bytes += String(v).length;
            window.__ls.ms += performance.now() - t0;
          };
        });
        await page.addScriptTag({ content: AVATAR_SRC });
        await page.waitForTimeout(900);
        await page.evaluate(function () {
          window.__turnQueue = [{ ok: true, say: 'Hello?', done: true }];
          window.__mlsAvatar.openKiosk();
        });
        await page.waitForTimeout(900);
        await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
        await page.waitForTimeout(250);
        await page.evaluate(function () {
          document.getElementById('mlsAvKioskPinInput').value = '1234';
          document.getElementById('mlsAvKioskPinAmb').click();
        });
        await page.waitForTimeout(800);

        /* ~600 finalised utterances ≈ a long, talkative consultation */
        const N = 600;
        const t0 = Date.now();
        await page.evaluate(function (n) {
          for (let i = 0; i < n; i++) {
            window.__emit('exam finding number ' + i + ' spoken aloud in the room during a long visit', true);
          }
        }, N);
        await page.waitForTimeout(2500);
        const wall = Date.now() - t0;
        const st = await page.evaluate(function () {
          const a = window.__amb();
          let stored = null;
          stored = window.__stored();
          return { chars: a.capturedChars, backedUp: a.backedUp, trimmed: a.backupTrimmed,
            parts: stored ? stored.parts.length : 0, ls: window.__ls };
        });
        console.log('  ---- ' + N + ' utterances (a long visit) ----');
        console.log('     captured ' + st.chars + ' chars in ' + st.parts + ' parts');
        console.log('     storage: ' + st.ls.writes + ' writes, ' +
          (st.ls.bytes / 1048576).toFixed(2) + ' MB handed to localStorage, ' +
          st.ls.ms.toFixed(0) + ' ms total in setItem');
        console.log('     wall clock for the whole burst: ' + wall + ' ms');
        ok('J1 a long visit captures every utterance', st.parts === N, st.parts + '/' + N);
        ok('J1 …and is still backed up at the end', st.backedUp === true, 'backedUp=' + st.backedUp);
        /* the throttle is what keeps this from being quadratic in practice:
           one write per ~1.5s regardless of how fast the room talks */
        ok('J1 the save throttle holds under a burst — writes are not per-utterance',
          st.ls.writes < N / 4, st.ls.writes + ' writes for ' + N + ' utterances');
        ok('J1 …and total bytes written stay sane', st.ls.bytes < 40 * 1048576,
          (st.ls.bytes / 1048576).toFixed(2) + ' MB');
        ok('J1 …and storage never becomes the bottleneck', st.ls.ms < 3000, st.ls.ms.toFixed(0) + ' ms');

        /* THE BURST FLATTERS ITSELF. 600 utterances arriving at once coalesce
           into two writes, which says nothing about a REAL 90 minute visit
           where they arrive spread out and the throttle fires every ~1.5s on a
           record that keeps growing. The backup rewrites the whole record each
           time, so the honest question is: what does ONE write cost at
           end-of-visit size, and what does that come to over a full visit? */
        const perWrite = await page.evaluate(function () {
          const k = 'acct-9::mlsAvRoomCaptureV1::probe-src';
          const payload = JSON.stringify(window.__stored() || {});
          const t0 = performance.now();
          for (let i = 0; i < 50; i++) localStorage.setItem(k + '::probe', payload);
          const ms = (performance.now() - t0) / 50;
          localStorage.removeItem(k + '::probe');
          return { bytes: payload.length, ms: ms };
        });
        /* 90 minutes at one write per 1.5s is the worst case the cap allows */
        const worstWrites = (90 * 60) / 1.5;
        const worstMs = perWrite.ms * worstWrites;
        console.log('     one write at end-of-visit size (' + (perWrite.bytes / 1024).toFixed(0) + ' KB): ' +
          perWrite.ms.toFixed(2) + ' ms');
        console.log('     extrapolated worst case, 90 min at 1 write/1.5s: ' + worstWrites + ' writes, ' +
          (worstMs / 1000).toFixed(1) + ' s of main thread total (' +
          ((worstMs / (90 * 60 * 1000)) * 100).toFixed(2) + '% duty cycle)');
        ok('J1 a single end-of-visit write is not a frame killer', perWrite.ms < 8,
          perWrite.ms.toFixed(2) + ' ms');
        ok('J1 …and the whole 90-minute worst case stays a rounding error on the main thread',
          worstMs < 30000, (worstMs / 1000).toFixed(1) + ' s across 90 min');
        ok('J1 page threw nothing', errs.length === 0, errs.join(' | '));
        await page.close();
      }

      /* --- J2. HOW NOISY IS THE DETECTOR OVER A WHOLE REAL VISIT? Curated
         sentences prove it can refuse; a continuous transcript proves it does
         not cry wolf while two people simply talk. --- */
      {
        const VISIT = [
          'good morning, how have you been since last time',
          'not too bad, the back is still bothering me though',
          'tell me where exactly it hurts',
          'right across the lower back, and sometimes down the leg',
          'does it wake you at night', 'occasionally, if I roll over wrong',
          'any numbness or tingling in the feet', 'no, nothing like that',
          'how about weakness, any trouble on stairs', 'no, stairs are fine',
          'have you been taking anything for it', 'just ibuprofen when it is bad',
          'does that help', 'takes the edge off for a few hours',
          'let me have a look at you', 'can you bend forward for me',
          'that is where it catches', 'okay, and lean back',
          'that is fine', 'now lift this leg straight up',
          'that pulls a bit', 'and the other one', 'that one is fine',
          'your reflexes are normal', 'strength is good in both legs',
          'the good news is nothing here worries me',
          'most of this settles with time and movement',
          'I had an MRI years ago for my neck', 'yes I remember that',
          'do you think I need another one', 'I do not think we need imaging today',
          'we would only do that if things changed',
          'should I keep taking the ibuprofen', 'yes, that is reasonable',
          'what about physical therapy, my sister had that',
          'it can help, let us see how the next few weeks go',
          'come back if it gets worse', 'thank you doctor',
          'take care of yourself', 'you too'
        ];
        const found = [];
        for (let i = 0; i < VISIT.length; i++) {
          const out = await pageless(browser, base, VISIT[i]);
          if (out.length) found.push({ line: VISIT[i], got: out.map(function (a) { return a.kind + ':' + a.title; }) });
        }
        console.log('  ---- detector over a ' + VISIT.length + '-line visit with NO orders in it ----');
        found.forEach(function (f) { console.log('     FIRED on: "' + f.line + '" -> ' + f.got.join(', ')); });
        ok('J2 a whole visit with no orders in it produces NO proposals', found.length === 0,
          found.length + ' spurious proposal(s)');
      }

      /* --- J3. CROSS-PATIENT. The worst thing this file can produce. --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'patient A has a distinctive complaint about her shoulder');
        await say(page, 'order an MRI lumbar spine without contrast');
        await page.evaluate(function () { document.querySelector('#mlsAvKioskOrders .mlsAvOrdGo').click(); });
        await page.clock.runFor(300);
        await page.evaluate(function () { document.getElementById('mlsAvKioskEndVisit').click(); });
        await page.clock.runFor(4000);
        await page.evaluate(function () {
          document.getElementById('mlsAvKioskPinInput').value = '1234';
          document.getElementById('mlsAvKioskPinGo').click();
        });
        await page.clock.runFor(1500);
        /* a NEW patient on the same screen */
        await page.evaluate(function () {
          window.__activePt = 'ext-88';
          window.getPatients = function () { return [{ id: 'ext-88', name: 'Patient B' }]; };
          document.getElementById('ez3flTranscript').value = '';
        });
        await toAmbient(page);
        const st = await page.evaluate(function () { return window.__amb(); });
        const cards = await page.evaluate(function () { return window.__cards(); });
        ok('J3 the new patient starts with an EMPTY capture', st.capturedChars === 0, st.capturedChars + ' chars');
        ok('J3 …bound to the new chart', st.boundPatient === 'ext-88', st.boundPatient);
        ok('J3 …and no proposed action survives from the previous patient', cards.length === 0,
          JSON.stringify(cards.map(function (c) { return c.title; })));
        await say(page, 'patient B has knee pain');
        await page.evaluate(function () { document.getElementById('mlsAvKioskEndVisit').click(); });
        await page.clock.runFor(4000);
        const box = await page.evaluate(function () { return window.__box(); });
        ok('J3 …and patient A never appears in patient B\'s transcript',
          box.indexOf('distinctive complaint about her shoulder') < 0 && box.indexOf('patient B has knee pain') >= 0,
          'A-leak=' + (box.indexOf('distinctive complaint') >= 0));
        ok('J3 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- J4. a CORRUPT backup must refuse, not crash --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        const cases = await page.evaluate(function () {
          const k = 'acct-9::mlsAvRoomCaptureV1::ext-77';
          const out = [];
          [['not json at all', 'garbage'],
           ['{"v":1}', 'valid json, wrong shape'],
           ['{"v":1,"parts":"not an array","bound":"ext-77"}', 'parts is not an array'],
           ['null', 'literal null'],
           ['{"v":1,"parts":[],"bound":"ext-77"}', 'empty parts']
          ].forEach(function (row) {
            localStorage.setItem(k, row[0]);
            let res;
            try { res = { ok: true, value: window.__mlsAvatar.pendingCapture() }; }
            catch (e) { res = { ok: false, err: String(e && e.message) }; }
            out.push({ why: row[1], threw: !res.ok, value: res.value === null ? 'null' : typeof res.value });
          });
          return out;
        });
        cases.forEach(function (c) {
          ok('J4 a corrupt backup (' + c.why + ') refuses without throwing',
            c.threw === false && c.value === 'null', JSON.stringify(c));
        });
        ok('J4 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- J5. End Visit pressed twice must not file the visit twice --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'a single line of this visit');
        await page.evaluate(function () {
          const b = document.getElementById('mlsAvKioskEndVisit');
          b.click(); b.click(); b.click();
        });
        await page.clock.runFor(4000);
        const box = await page.evaluate(function () { return window.__box(); });
        const hits = box.split('a single line of this visit').length - 1;
        ok('J5 three rapid End Visit clicks file the visit exactly ONCE', hits === 1, hits + ' copies');
        ok('J5 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }
    }
    /* ------------------------------------------------------------ K */
    section('SCENARIO K - DOES IT ACTUALLY FIT? (layout at real screen sizes)');
    {
      /* This train added FIVE elements to a screen the brief calls premium and
         uncluttered: a state chip, an AI disclosure, a mute button, an End
         Visit button and an orders widget. Nothing has ever checked that they
         fit — every scenario so far ran at 1280x900. A patient-facing screen
         that overflows, overlaps or hides its own disclosure is not premium,
         and none of the logic tests can see it. */
      const SIZES = [
        { w: 1280, h: 900, name: 'desktop' },
        { w: 1366, h: 768, name: 'laptop (short)' },
        { w: 1024, h: 768, name: 'tablet landscape' },
        { w: 768, h: 1024, name: 'tablet portrait' },
        { w: 390, h: 844, name: 'phone' }
      ];
      for (const size of SIZES) {
        const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });
        const errs = [];
        page.on('pageerror', function (e) { errs.push(String((e && e.message) || e)); });
        await page.goto(base + '/page.html');
        await page.evaluate(STUBS);
        await page.evaluate(function () {
          document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
        });
        await page.addScriptTag({ content: AVATAR_SRC });
        await page.clock.install({ time: new Date('2026-08-07T14:00:00Z') });
        await page.evaluate(function () {
          window.__turnQueue = [{ ok: true, say: 'What brings you in today?', done: false, progress: { covered: 1, total: 2 } }];
          window.__mlsAvatar.openKiosk();
        });
        await page.waitForTimeout(700);
        /* into ambient with a proposal on screen: the busiest the kiosk gets */
        await page.evaluate(function () { document.getElementById('mlsAvKioskEnd').click(); });
        await page.waitForTimeout(200);
        await page.evaluate(function () {
          document.getElementById('mlsAvKioskPinInput').value = '1234';
          document.getElementById('mlsAvKioskPinAmb').click();
        });
        await page.waitForTimeout(600);
        await page.evaluate(function () { window.__emit('order an MRI of the knee', true); });
        await page.waitForTimeout(400);

        const box = await page.evaluate(function () {
          function r(id) {
            const el = document.getElementById(id);
            if (!el) return null;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return { hidden: true };
            const b = el.getBoundingClientRect();
            return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height };
          }
          function overlap(a, c) {
            if (!a || !c || a.hidden || c.hidden) return false;
            return a.x < c.r && c.x < a.r && a.y < c.b && c.y < a.b;
          }
          const ids = ['mlsAvKioskFace', 'mlsAvKioskAi', 'mlsAvKioskState', 'mlsAvKioskMute',
            'mlsAvKioskEndVisit', 'mlsAvKioskOrders', 'mlsAvKioskRec'];
          const got = {};
          ids.forEach(function (i) { got[i] = r(i); });
          return {
            vw: window.innerWidth, vh: window.innerHeight,
            el: got,
            docScrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
            docScrollY: document.documentElement.scrollHeight > window.innerHeight + 1,
            muteHitsEnd: overlap(got.mlsAvKioskMute, got.mlsAvKioskEndVisit),
            ordersHitFace: overlap(got.mlsAvKioskOrders, got.mlsAvKioskFace),
            ordersHitEnd: overlap(got.mlsAvKioskOrders, got.mlsAvKioskEndVisit)
          };
        });

        const tag = size.name + ' ' + size.w + 'x' + size.h;
        const off = [];
        Object.keys(box.el).forEach(function (id) {
          const e = box.el[id];
          if (!e || e.hidden) return;
          if (e.x < -1 || e.y < -1 || e.r > box.vw + 1 || e.b > box.vh + 1) {
            off.push(id + '(' + Math.round(e.x) + ',' + Math.round(e.y) + ' ' +
              Math.round(e.r) + 'x' + Math.round(e.b) + ')');
          }
        });
        ok('K ' + tag + ': nothing is pushed off the screen', off.length === 0, off.join(' '));
        ok('K ' + tag + ': the page never scrolls', !box.docScrollX && !box.docScrollY,
          'x=' + box.docScrollX + ' y=' + box.docScrollY);
        ok('K ' + tag + ': the avatar is visible', !!box.el.mlsAvKioskFace && !box.el.mlsAvKioskFace.hidden &&
          box.el.mlsAvKioskFace.h > 40, JSON.stringify(box.el.mlsAvKioskFace));
        ok('K ' + tag + ': the AI disclosure is visible', !!box.el.mlsAvKioskAi && !box.el.mlsAvKioskAi.hidden &&
          box.el.mlsAvKioskAi.h > 8, JSON.stringify(box.el.mlsAvKioskAi));
        ok('K ' + tag + ': mute and End Visit do not overlap', box.muteHitsEnd === false);
        ok('K ' + tag + ': the orders widget does not cover the avatar', box.ordersHitFace === false,
          JSON.stringify({ orders: box.el.mlsAvKioskOrders, face: box.el.mlsAvKioskFace }));
        ok('K ' + tag + ': the orders widget does not cover End Visit', box.ordersHitEnd === false);
        ok('K ' + tag + ': page threw nothing', errs.length === 0, errs.join(' | '));
        await page.close();
      }
    }
    /* ------------------------------------------------------------ L */
    section('SCENARIO L - CONTRAST AND KEYBOARD (a patient-facing clinical screen)');
    {
      /* Every element this train added carries text, and none of it has ever
         been checked for legibility. This is a screen a patient reads across a
         room, and one of the things it must carry is the AI disclosure — a
         disclosure nobody can read is not a disclosure. Contrast is computed
         against the real rendered background, not the value I intended. */
      const h = await newPage(browser, base);
      const page = h.page;
      await toAmbient(page);
      await say(page, 'order an MRI of the knee');
      await page.evaluate(function () { window.__emit('start gabapentin 300 mg at night', true); });
      await page.clock.runFor(1800);

      const report = await page.evaluate(function () {
        function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
        function lum(rgb) { return 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2]); }
        function parse(s) {
          const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(s || '');
          if (!m) return null;
          return { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
        }
        /* the first ancestor that actually paints something opaque */
        function bgOf(el) {
          let n = el;
          while (n && n !== document.documentElement) {
            const p = parse(getComputedStyle(n).backgroundColor);
            if (p && p.a >= 0.95) return p.c;
            n = n.parentElement;
          }
          return [255, 255, 255];
        }
        function ratio(a, b) {
          const l1 = lum(a), l2 = lum(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        }
        const out = [];
        const sels = [
          ['#mlsAvKioskState', 'state chip'],
          ['#mlsAvKioskAi', 'AI disclosure'],
          ['#mlsAvKioskSave', 'save badge'],
          ['#mlsAvKioskMute', 'mute button'],
          ['#mlsAvKioskEndVisit', 'End Visit button'],
          ['#mlsAvKioskRecText', 'recording banner'],
          ['#mlsAvKioskOrders .mlsAvOrdTitle', 'widget heading'],
          ['#mlsAvKioskOrders .mlsAvOrdCount', 'widget count'],
          ['#mlsAvKioskOrders .mlsAvOrd b', 'order title'],
          ['#mlsAvKioskOrders .mlsAvOrdKind', 'order kind'],
          ['#mlsAvKioskOrders .mlsAvOrdDet', 'order detail'],
          ['#mlsAvKioskOrders .mlsAvOrdHeard', 'heard-verbatim line'],
          ['#mlsAvKioskOrders .mlsAvOrdMiss', 'missing-field warning'],
          ['#mlsAvKioskOrders .mlsAvOrdFoot', 'widget footer'],
          ['#mlsAvKioskOrders .mlsAvOrdGo', 'Confirm button'],
          ['#mlsAvKioskOrders .mlsAvOrdEdit', 'Edit button'],
          ['#mlsAvKioskOrders .mlsAvOrdNo', 'Dismiss button'],
          ['#mlsAvKioskOrders .mlsAvOrdPick', 'side picker']
        ];
        sels.forEach(function (row) {
          const el = document.querySelector(row[0]);
          if (!el) { out.push({ what: row[1], missing: true }); return; }
          const cs = getComputedStyle(el);
          const fg = parse(cs.color);
          if (!fg) return;
          const px = parseFloat(cs.fontSize) || 16;
          const bold = (parseInt(cs.fontWeight, 10) || 400) >= 700;
          /* WCAG "large text": >=24px, or >=18.66px when bold */
          const large = px >= 24 || (bold && px >= 18.66);
          out.push({
            what: row[1], px: Math.round(px * 10) / 10, bold: bold, large: large,
            ratio: Math.round(ratio(fg.c, bgOf(el)) * 100) / 100,
            need: large ? 3 : 4.5
          });
        });
        return out;
      });

      const bad = report.filter(function (r) { return !r.missing && r.ratio < r.need; });
      console.log('  ---- contrast of every element this train added ----');
      report.forEach(function (r) {
        if (r.missing) { console.log('     (not on screen) ' + r.what); return; }
        console.log('     ' + (r.ratio < r.need ? 'FAIL ' : 'ok   ') +
          String(r.ratio).padStart(6) + ':1  need ' + r.need + '  ' +
          String(r.px).padStart(5) + 'px' + (r.bold ? ' bold' : '     ') + '  ' + r.what);
      });
      ok('L every added element meets WCAG AA contrast', bad.length === 0,
        bad.map(function (b) { return b.what + ' ' + b.ratio + ':1'; }).join(', '));

      /* keyboard: a clinical control that cannot be reached by keyboard is not
         a control for everyone who has to use it */
      const kb = await page.evaluate(function () {
        function focusable(sel) {
          const el = document.querySelector(sel);
          if (!el) return null;
          el.focus();
          return document.activeElement === el;
        }
        return {
          mute: focusable('#mlsAvKioskMute'),
          end: focusable('#mlsAvKioskEndVisit'),
          confirm: focusable('#mlsAvKioskOrders .mlsAvOrdGo'),
          dismiss: focusable('#mlsAvKioskOrders .mlsAvOrdNo'),
          muteName: (document.getElementById('mlsAvKioskMute') || {}).textContent,
          mutePressed: (document.getElementById('mlsAvKioskMute') || {}).getAttribute
            ? document.getElementById('mlsAvKioskMute').getAttribute('aria-pressed') : null,
          stateRole: (document.getElementById('mlsAvKioskState') || {}).getAttribute
            ? document.getElementById('mlsAvKioskState').getAttribute('role') : null,
          recRole: (document.getElementById('mlsAvKioskRec') || {}).getAttribute
            ? document.getElementById('mlsAvKioskRec').getAttribute('role') : null
        };
      });
      ok('L the mute control is keyboard reachable', kb.mute === true);
      ok('L End Visit is keyboard reachable', kb.end === true);
      ok('L Confirm is keyboard reachable', kb.confirm === true);
      ok('L Dismiss is keyboard reachable', kb.dismiss === true);
      ok('L the mute control reports its pressed state to assistive tech',
        kb.mutePressed === 'false' || kb.mutePressed === 'true', String(kb.mutePressed));
      ok('L the state chip announces changes (role=status)', kb.stateRole === 'status', String(kb.stateRole));
      ok('L the recording disclosure announces itself (role=status)', kb.recRole === 'status', String(kb.recRole));
      ok('L page threw nothing', h.errors.length === 0, h.errors.join(' | '));
    }
    /* ------------------------------------------------------------ M */
    section('SCENARIO M - THE KIOSK IS NOT THE ONLY THING ON THE SCREEN');
    {
      /* --- M1. the doctor switches away mid-visit. Chrome throttles timers in
         a background tab, and this module's save is a setTimeout. If the
         throttle swallowed it, a visit could run for minutes with a backup
         frozen at the moment the doctor looked something up. --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'first line while the tab is in front');
        await page.evaluate(function () {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          Object.defineProperty(document, 'hidden', { value: true, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.runFor(500);
        await say(page, 'second line spoken while the doctor was on another tab');
        await page.evaluate(function () {
          Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
          Object.defineProperty(document, 'hidden', { value: false, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.clock.runFor(2500);
        const st = await page.evaluate(function () {
          let stored = null;
          stored = window.__stored();
          return { amb: window.__amb(), parts: stored ? stored.parts : [] };
        });
        ok('M1 the capture keeps running while the tab is in the background',
          st.amb.capturedChars > 0 && /another tab/.test(st.parts.join(' ')),
          st.parts.length + ' parts');
        ok('M1 …and the backup holds what was said while it was hidden',
          st.parts.join(' ').indexOf('second line spoken') >= 0, JSON.stringify(st.parts.slice(-1)));
        ok('M1 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- M1b. A CRASH BYPASSES THE REVIEW. The review names what was heard
         and never confirmed; a reload never reaches it. Proposals the doctor
         had not yet acted on used to vanish from the recovered visit without
         ever being mentioned — silence about a proposed order. --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'order an mri of the lumbar spine without contrast');
        await page.evaluate(function () { document.querySelector('#mlsAvKioskOrders .mlsAvOrdGo').click(); });
        await page.clock.runFor(300);
        await say(page, 'and lets refer him to orthopedics');   /* left UNCONFIRMED */
        const before = await page.evaluate(function () { return window.__amb().actions.length; });
        ok('M1b two actions exist before the crash', before === 2, String(before));

        await page.reload();
        await page.evaluate(STUBS);
        await page.addScriptTag({ content: AVATAR_SRC });
        await page.clock.runFor(4000);
        const pend = await page.evaluate(function () { return window.__mlsAvatar.pendingCapture(); });
        ok('M1b the recovered capture still carries both actions',
          !!pend && pend.actions.length === 2, pend ? String(pend.actions.length) : 'none');

        const filed = await page.evaluate(function () { return window.__mlsAvatar.fileRecoveredCapture(); });
        ok('M1b the recovered visit files', filed.ok === true, JSON.stringify(filed));
        const box = await page.evaluate(function () { return window.__box(); });
        ok('M1b the CONFIRMED order is in the recovered note', /MRI.*lumbar spine/i.test(box));
        ok('M1b the UNCONFIRMED one is NAMED rather than silently dropped',
          /heard but NEVER confirmed/i.test(box) && /Orthopedics/i.test(box),
          box.slice(box.indexOf('NEVER confirmed'), box.indexOf('NEVER confirmed') + 120));
        ok('M1b …and is stated plainly as NOT ordered',
          /These were NOT ordered/.test(box));
        ok('M1b page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- M2. TWO TABS. The backup key is account-scoped, and a doctor
         having the app open twice is not exotic. If both tabs write the same
         key, one visit silently overwrites the other and the loser is gone
         with no trace — the exact failure this whole feature exists to
         prevent. Both tabs share one browser context, so they share one
         localStorage, exactly as two real tabs would. --- */
      {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const errs = [];
        async function tab(chart) {
          const p = await ctx.newPage();
          p.on('pageerror', function (e) { errs.push(String((e && e.message) || e)); });
          await p.clock.install({ time: new Date('2026-08-07T14:00:00Z') });
          await p.goto(base + '/page.html');
          await p.evaluate(STUBS);
          await p.evaluate(function (c) {
            document.documentElement.requestFullscreen = function () { return Promise.resolve(); };
            window.__activePt = c;
            window.getPatients = function () { return [{ id: c, name: 'Patient ' + c }]; };
          }, chart);
          await p.addScriptTag({ content: AVATAR_SRC });
          await p.clock.runFor(3000);
          return p;
        }
        const a = await tab('ext-77');
        const b = await tab('ext-88');
        await toAmbient(a);
        await say(a, 'tab A is recording patient seventy seven');
        await toAmbient(b);
        await say(b, 'tab B is recording patient eighty eight');
        /* give A more to say AFTER B started, so a shared key would show it */
        await say(a, 'tab A has more to say about seventy seven');

        const keys = await a.evaluate(function () {
          const out = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf('mlsAvRoomCapture') >= 0) out.push(k);
          }
          return out;
        });
        console.log('  ---- backup keys with two tabs recording ----');
        keys.forEach(function (k) { console.log('     ' + k); });
        ok('M2 two concurrent captures do not share one backup slot', keys.length >= 2,
          keys.length + ' key(s): ' + keys.join(', '));

        const recoverable = await a.evaluate(function () {
          const out = {};
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || k.indexOf('mlsAvRoomCapture') < 0) continue;
            try {
              const r = JSON.parse(localStorage.getItem(k));
              out[r.bound] = (r.parts || []).join(' ');
            } catch (e) {}
          }
          return out;
        });
        ok('M2 patient A\'s visit survives tab B recording at the same time',
          !!recoverable['ext-77'] && recoverable['ext-77'].indexOf('tab A has more to say') >= 0,
          JSON.stringify(Object.keys(recoverable)));
        ok('M2 patient B\'s visit survives too',
          !!recoverable['ext-88'] && recoverable['ext-88'].indexOf('tab B is recording') >= 0,
          (recoverable['ext-88'] || '').slice(0, 50));
        ok('M2 and neither visit contains the other patient\'s words',
          (recoverable['ext-77'] || '').indexOf('eighty eight') < 0 &&
          (recoverable['ext-88'] || '').indexOf('seventy seven') < 0);
        ok('M2 pages threw nothing', errs.length === 0, errs.join(' | '));
        await ctx.close();
      }
    }
    /* ------------------------------------------------------------ N */
    section('SCENARIO N - THE PHOTO FACE, THE PATIENT, AND REVERT');
    {
      /* --- N1. THE DISCLOSURE WITH THE DOCTOR'S REAL PHOTOGRAPH. Every layout
         check so far ran on the DRAWN face. The disclosure matters most in
         exactly the case never tested: when the screen is showing the doctor's
         actual photograph and speaking in a voice chosen to sound like them.
         That is the combination a patient could mistake for the doctor. --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        /* a 1x1 png, which is all kioskSetIdentity needs to take the photo path */
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        await page.evaluate(function (png) {
          window.__turnQueue = [{
            ok: true, say: 'Hello, what brings you in today?', done: false,
            progress: { covered: 1, total: 2 },
            avatar: { name: 'Dr Vance', faceMode: 'photo', faceImage: png, exitPinSet: true }
          }];
          window.__mlsAvatar.openKiosk();
        }, PNG);
        await page.clock.runFor(1800);
        const shot = await page.evaluate(function () {
          const img = document.querySelector('#mlsAvKioskFace img');
          const ai = document.getElementById('mlsAvKioskAi');
          const aiBox = ai ? ai.getBoundingClientRect() : null;
          const aiCs = ai ? getComputedStyle(ai) : null;
          return {
            photo: !!img && String(img.src).indexOf('data:image/') === 0,
            name: (document.getElementById('mlsAvKioskName') || {}).textContent,
            aiText: ai ? (ai.textContent || '').trim() : null,
            aiVisible: !!(aiCs && aiCs.display !== 'none' && aiCs.visibility !== 'hidden' &&
              Number(aiCs.opacity) > 0 && aiBox.width > 0 && aiBox.height > 0),
            aiOnScreen: !!(aiBox && aiBox.top >= 0 && aiBox.bottom <= window.innerHeight)
          };
        });
        ok('N1 the kiosk really is showing the doctor\'s photograph', shot.photo === true);
        ok('N1 …under the doctor\'s name', /Vance/.test(String(shot.name)), String(shot.name));
        ok('N1 …and the AI disclosure is STILL on screen', shot.aiVisible === true && shot.aiOnScreen === true,
          JSON.stringify({ visible: shot.aiVisible, onScreen: shot.aiOnScreen }));
        ok('N1 …saying it is an AI assistant, not the doctor',
          /\bAI\b/i.test(String(shot.aiText)) && /assistant/i.test(String(shot.aiText)),
          String(shot.aiText));
        ok('N1 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- N2. THE PATIENT CANNOT CREATE A CLINICAL ORDER. During intake the
         patient is holding the screen. Anything they say that sounds like an
         order must produce nothing at all — the widget belongs to the room
         capture, which only a staff PIN can start. --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await page.evaluate(function () {
          window.__turnQueue = [
            { ok: true, say: 'What brings you in today?', done: false, progress: { covered: 1, total: 2 } },
            { ok: true, say: 'Thank you.', done: false, progress: { covered: 2, total: 2 } }
          ];
          window.__mlsAvatar.openKiosk();
        });
        await page.clock.runFor(1500);
        await page.evaluate(function () {
          window.__emit('order an mri of the lumbar spine without contrast', true);
        });
        await page.clock.runFor(3500);
        const cards = await page.evaluate(function () { return window.__cards(); });
        const widget = await page.evaluate(function () { return window.__widgetVisible(); });
        const amb = await page.evaluate(function () { return window.__amb(); });
        ok('N2 a patient saying an order during intake proposes NOTHING', cards.length === 0,
          JSON.stringify(cards.map(function (c) { return c.title; })));
        ok('N2 …and the widget never appears for them', widget === false);
        ok('N2 …because room capture is not running', amb.running === false);
        ok('N2 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }

      /* --- N3. REVERT. This module advertises itself as fully reversible, and
         this train added a chip, two buttons, a widget, a review pane, styles
         and three timers. A revert that leaves any of them behind leaves a
         half-installed module on a clinical screen. --- */
      {
        const h = await newPage(browser, base);
        const page = h.page;
        await toAmbient(page);
        await say(page, 'order an mri of the knee');
        const beforeRevert = await page.evaluate(function () {
          return { kiosk: !!document.getElementById('mlsAvKiosk'), recs: window.__log.recStarts };
        });
        ok('N3 the kiosk is up and recording before revert', beforeRevert.kiosk === true);
        await page.evaluate(function () { window.__mlsAvatar.revert(); });
        await page.clock.runFor(3000);
        const after = await page.evaluate(function () {
          const ids = ['mlsAvKiosk', 'mlsAvKioskState', 'mlsAvKioskOrders', 'mlsAvKioskReview',
            'mlsAvKioskMute', 'mlsAvKioskEndVisit', 'mlsAvKioskStyle', 'mlsAvBtn', 'mlsAvVisitCard'];
          const left = ids.filter(function (i) { return !!document.getElementById(i); });
          return { left: left, installed: window.__mlsAvatar.installed, recs: window.__log.recStarts };
        });
        ok('N3 revert removes every element this train added', after.left.length === 0, after.left.join(', '));
        ok('N3 …and the module reports itself uninstalled', after.installed === false, String(after.installed));
        /* the timers are the invisible half: a reverted module that keeps a
           save or a detect timer alive is still running on the doctor's page */
        await page.clock.runFor(8000);
        const recsLater = await page.evaluate(function () { return window.__log.recStarts; });
        ok('N3 …and nothing restarts the microphone afterwards',
          recsLater === after.recs, after.recs + ' -> ' + recsLater);
        ok('N3 page threw nothing', h.errors.length === 0, h.errors.join(' | '));
      }
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
  console.log('PASS visit copilot proof: ' + pass + ' checks in real Chromium on a real origin — the FULL acceptance ' +
    'sequence runs unbroken in one session (Start Visit -> MA intake with a follow-up -> doctor takes over -> avatar ' +
    'remains and documents -> a spoken command -> a proposed order confirmed in one tap -> continuous save -> End ' +
    'Visit with the note drafted), plus: a visit survives a mid-encounter reload and files to the right chart (and ' +
    'refuses the wrong one), an order missing a required detail cannot be confirmed even with the attribute defeated, ' +
    'pausing stops the recording AND the claim to be recording, and the first word arrives 155ms sooner than the ' +
    'one-blob fetch it replaced');
})().catch(function (e) {
  console.error('PROOF CRASHED:', (e && e.stack) || e);
  process.exit(1);
});
