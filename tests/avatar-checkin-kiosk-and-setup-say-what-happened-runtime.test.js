'use strict';
/*
 * THE AVATAR SAYS WHAT HAPPENED (h10-1.0.0, 2026-09-25)
 * =============================================================================
 * Thirteen measured defects in the Avatar check-in (1p-feat_mls_avatar.js and
 * 1p-feat_mls_avatar_face.js), each driven here in real Chrome against the
 * shipped bytes. Synthetic identities only; every request is held or answered
 * in the page and anything not on 127.0.0.1 is refused.
 *
 *   AV-1  a check-in is never written into another patient's (or visit's)
 *         transcript when the patient changes during the full-row refetch
 *   AV-2  an UNFINISHED check-in with emergency language shows a red banner and
 *         "NOT finished" - never "completed", never "Seen"
 *   AV-3  a same-account token rotation keeps every control alive and never
 *         wedges the check-in refresh
 *   AV-4  Pause is silent: no nudge, no self-finish, no reply spoken over it;
 *         the held reply is delivered on Resume
 *   AV-5  Resume and "Back to the interview" reopen listening without confirmed
 *         echo cancellation
 *   AV-6  typed mode never paints the Listening pill, dot, wave or chip
 *   AV-7  a failed unlock request is not "That PIN isn't right"
 *   AV-8  a failed finish is retried, and a finish that never lands is said
 *   AV-9  at 390x844 End interview is tappable and the question is not under
 *         the Listening pill
 *   AV-10 at 390x844 the Setup form fits its panel
 *   AV-11 a failed Save never stays on "Saving…"; a failed Mark seen says so
 *   AV-12 the face meter follows the engine's no-photo refusal at once
 *   AV-13 "Hear this voice" retries the real voice and says when it could not
 *
 * MLS_AVATAR_DIR=<dir holding the two 1p avatar files> runs the same checks
 * against other bytes (the pre-fix copies fail every item by name).
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DIR = process.env.MLS_AVATAR_DIR ? path.resolve(process.env.MLS_AVATAR_DIR) : ROOT;
const AVATAR = fs.readFileSync(path.join(DIR, '1p-feat_mls_avatar.js'), 'utf8');
const FACE = fs.readFileSync(path.join(DIR, '1p-feat_mls_avatar_face.js'), 'utf8');

let passed = 0;
const failures = [];
function check(id, cond, message) {
  if (cond) { passed++; return true; }
  failures.push(id + ': ' + message);
  return false;
}

function pageHtml(opts) {
  const patients = JSON.stringify(opts.patients || [
    { id: 'pt-A', name: 'Alice Synthetic', summary: '' },
    { id: 'pt-B', name: 'Bob Synthetic', summary: '' }
  ]);
  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
  <main id="appShell"><div class="tools"></div>
    <div id="visitView"><textarea id="ez3flTranscript"></textarea></div></main>
  <script>
    window.__mlsSessionEpoch = 7;
    window.__mlsSessionAccount = 'doc@example.test';
    window.__tok = 'token-A'; window.bkToken = () => window.__tok;
    window.bkBase = () => location.origin;
    window.uns = (k) => 'doc:' + k;
    window.__patients = ${patients};
    window.__active = 'pt-A';
    window.getPatients = () => window.__patients;
    window.getActivePtId = () => window.__active;
    window.setActivePtId = (id) => { window.__active = id; };
    window.openPatient = () => {}; window.showView = () => {};
    window.upsertPatient = (next) => { window.__patients = window.__patients.map(p => p.id === next.id ? next : p); };
    window.__toasts = [];
    window.toast = (m) => { window.__toasts.push(String(m)); };
    window.__requests = [];
    window.__respond = (json, status = 200, ctype = 'application/json', text) => ({
      ok: status >= 200 && status < 300, status,
      headers: { get: (h) => /content-type/i.test(h) ? ctype : null },
      json: () => text != null ? Promise.reject(new SyntaxError('Unexpected token')) : Promise.resolve(json),
      text: () => Promise.resolve(text != null ? text : JSON.stringify(json)),
      blob: () => Promise.resolve(new Blob(['x'], { type: ctype }))
    });
    window.fetch = (url, options = {}) => {
      const u = new URL(String(url), location.href);
      const row = { id: window.__requests.length + 1, path: u.pathname + u.search,
        method: String(options.method || 'GET').toUpperCase(), body: String(options.body || ''),
        auth: (options.headers && options.headers.Authorization) || '', settled: false };
      row.promise = new Promise((res, rej) => { row.resolve = res; row.reject = rej; });
      window.__requests.push(row);
      if (window.__autoFetch) {
        const auto = window.__autoFetch(row);
        if (auto) { row.settled = true; setTimeout(() => auto.error ? row.reject(auto.error) : row.resolve(auto), 0); }
      }
      return row.promise;
    };
    window.__settle = (id, json, status = 200, text) => {
      const row = window.__requests.find(r => r.id === id); if (!row || row.settled) return false;
      row.settled = true; row.resolve(window.__respond(json, status, 'application/json', text)); return true;
    };
    window.__fail = (id) => {
      const row = window.__requests.find(r => r.id === id); if (!row || row.settled) return false;
      row.settled = true; row.reject(new TypeError('Failed to fetch')); return true;
    };
    window.__pending = (frag) => window.__requests.filter(r => !r.settled && r.path.includes(frag));
    window.__media = [];
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => {
      if (window.__denyMic) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      const tracks = [{ kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; },
        getSettings: () => ({ echoCancellation: !window.__noAec, noiseSuppression: true }) }];
      window.__media.push(tracks);
      return Promise.resolve({ getTracks: () => tracks, getAudioTracks: () => tracks });
    } } });
    class TestAudioContext {
      constructor() { this.state = 'running'; }
      resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 0, frequencyBinCount: 128, connect() {}, disconnect() {},
        getByteTimeDomainData(a) { a.fill(128); }, getByteFrequencyData(a) { a.fill(0); } }; }
      createMediaElementSource() { return { connect() {}, disconnect() {} }; }
      get destination() { return {}; }
    }
    window.AudioContext = TestAudioContext; window.webkitAudioContext = TestAudioContext;
    window.__spoken = [];
    window.__voices = [];
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() {}, getVoices() { return window.__voices; }, addEventListener() {},
      speak(u) { window.__spoken.push(u.text);
        setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 30); }, 5); } } });
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    window.__recs = [];
    class TestRecognition { constructor() { window.__recs.push(this); this.running = false; }
      start() { this.running = true; } stop() { this.running = false; } abort() { this.running = false; } }
    window.SpeechRecognition = TestRecognition; window.webkitSpeechRecognition = TestRecognition;
    window.__liveRec = () => window.__recs.filter(r => r.running);
    Element.prototype.requestFullscreen = function () { return Promise.resolve(); };
  </script>
  <script data-mls-install-token="h10-cap" src="/avatar.js"></script>
  ${opts.face ? '<script>window.__MLS_P1_PREVIEW={enabled:true};window.__mlsP1AvatarFaceLoader={installed:true,version:"p1-face-studio-1.0.1",installToken:"face-cap"};</script><script data-mls-install-token="face-cap" src="/face.js"></script>' : ''}
  </body></html>`;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/avatar.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(AVATAR); }
      if (url.pathname === '/face.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(FACE); }
      const opts = JSON.parse(url.searchParams.get('o') || '{}');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(pageHtml(opts));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

let BASE = '';
async function open(browser, opts, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1100, height: 850 } });
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  if (opts && opts.clock) await page.clock.install();
  await page.goto(BASE + '/?o=' + encodeURIComponent(JSON.stringify(opts || {})), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mlsAvatar && window.__mlsAvatar.installed === true);
  page.__errors = errors;
  return page;
}
const sleep = (page, ms) => page.waitForTimeout(ms);

/* the backend's own answer for an interview that raised emergency language and
   was never finished (routes/patientAvatar.js, the ready inbox mapper) */
const FLAGGED_ACTIVE = { id: 1, status: 'active', patient_external_id: 'pt-A', created_at: '2026-09-25 11:39:34',
  ready_at: null, seen_at: null, turns: 2, bullets: [], summary: null, headline: null, askAbout: [],
  flags: ['emergency-language'], flaggedAt: '2026-09-25T11:39:34.966Z', inProgress: true, audited: null };

async function interview(page, opts) {
  await page.evaluate((o) => {
    if (o.noAec) window.__noAec = true;
    if (o.denyMic) window.__denyMic = true;
    window.__turnBodies = [];
    window.__autoFetch = (row) => {
      if (row.path.startsWith('/api/avatar/checkins')) return window.__respond({ checkins: [] });
      if (row.path === '/api/avatar/office/tts') return window.__respond({ ok: false }, 503);
      if (row.path === '/api/avatar/office/turn') {
        const b = JSON.parse(row.body || '{}'); window.__turnBodies.push(b);
        if (b.finish && o.holdFinish) return null;
        if (b.answer && o.holdAnswers) return null;
        return window.__respond({ ok: true, say: b.finish ? 'We will stop there.' : (b.answer ? 'Thanks. How long has the knee hurt?' : (o.say || 'Hi, I am Ava, an AI assistant. What brings you in today?')),
          done: !!b.finish, progress: { covered: window.__turnBodies.length, total: 4 },
          avatar: { name: 'Ava', voice: 'coral', exitPinSet: !!o.pin } });
      }
      if (row.path === '/api/avatar/office/unlock' && o.holdUnlock) return null;
      if (row.path === '/api/avatar/office/unlock') return window.__respond({ ok: true, unset: !o.pin });
      return null;
    };
  }, opts || {});
  await page.evaluate(() => window.__mlsAvatar.openKiosk());
  await page.click('#mlsAvKioskConsentYes');
}
function answer(page, text) {
  return page.evaluate((t) => {
    const r = window.__liveRec()[0];
    r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
  }, text);
}
const kioskSnap = (page) => page.evaluate(() => ({
  chip: (document.getElementById('mlsAvKioskState') || {}).textContent,
  say: (document.getElementById('mlsAvKioskSay') || {}).textContent,
  rootClass: (document.getElementById('mlsAvKiosk') || {}).className,
  pill: document.getElementById('mlsAvKioskMic') ? getComputedStyle(document.getElementById('mlsAvKioskMic')).display : null,
  live: window.__liveRec().length,
  spoken: window.__spoken.slice(),
  turns: (window.__turnBodies || []).slice()
}));

/* ------------------------------------------------------------------ AV-1 */
async function av1(browser) {
  const page = await open(browser, {});
  await page.waitForFunction(() => window.__pending('/api/avatar/checkins?status=ready').length > 0);
  const rowA = { id: 501, patient_external_id: 'pt-A', status: 'ready', ready_at: new Date().toISOString(), turns: 6,
    headline: 'ALICE: chest tightness on stairs', audited: 'passed', flags: [],
    bullets: ['ALICE bullet 1', 'ALICE bullet 2', 'ALICE bullet 3', 'ALICE bullet 4 (full row only)'],
    summary: 'ALICE summary: exertional chest tightness.' };
  const settleReady = () => page.evaluate((row) => window.__pending('/api/avatar/checkins?status=ready')
    .forEach(r => window.__settle(r.id, { checkins: [row] })), rowA);
  await settleReady();
  await page.waitForFunction(() => /ALICE/.test((document.getElementById('mlsAvVisitCard') || {}).textContent || ''));
  await page.evaluate(() => { document.getElementById('ez3flTranscript').value = 'Alice visit so far.'; });
  await page.getByRole('button', { name: 'Add to visit transcript' }).click();
  await page.waitForFunction(() => window.__pending('/api/avatar/checkins?status=ready').length === 1);
  await page.evaluate(() => {
    window.__active = 'pt-B';
    document.getElementById('ez3flTranscript').value = 'BOB visit transcript: knee pain.';
    window.dispatchEvent(new CustomEvent('mls:active-patient-changed'));
  });
  await settleReady();
  await sleep(page, 120);
  const out = await page.evaluate(() => ({ box: document.getElementById('ez3flTranscript').value, toasts: window.__toasts.slice() }));
  check('AV-1', !/ALICE/.test(out.box), 'patient A\'s check-in was written into patient B\'s transcript: ' + JSON.stringify(out.box.slice(0, 160)));
  check('AV-1', out.toasts.some(t => /Nothing was written/.test(t)) && !out.toasts.some(t => /added to the visit transcript/.test(t)),
    'the refused write did not say nothing was written: ' + JSON.stringify(out.toasts));

  /* control: back on Alice, the same button files all four bullets */
  await page.evaluate(() => {
    window.__active = 'pt-A';
    document.getElementById('ez3flTranscript').value = 'Alice visit so far.';
    window.dispatchEvent(new CustomEvent('mls:active-patient-changed'));
  });
  await page.waitForFunction(() => /ALICE/.test((document.getElementById('mlsAvVisitCard') || {}).textContent || ''));
  await page.getByRole('button', { name: 'Add to visit transcript' }).click();
  await page.waitForFunction(() => window.__pending('/api/avatar/checkins?status=ready').length === 1);
  await settleReady();
  await page.waitForFunction(() => /ALICE bullet 4/.test(document.getElementById('ez3flTranscript').value), null, { timeout: 3000 }).catch(() => {});
  check('AV-1', /ALICE bullet 4/.test(await page.evaluate(() => document.getElementById('ez3flTranscript').value)),
    'the same patient\'s own visit no longer receives the full check-in');

  /* the inbox route into the transcript still refuses the wrong open chart */
  await page.evaluate(() => {
    window.__active = 'pt-B';
    document.getElementById('ez3flTranscript').value = 'BOB again.';
    window.__autoFetch = (row) => row.path.startsWith('/api/avatar/checkins') ? window.__respond({ checkins: [window.__rowA] }) : null;
  });
  await page.evaluate((row) => { window.__rowA = row; window.__mlsAvatar.open(); }, rowA);
  await page.waitForSelector('#mlsAvBack .mlsAvCard');
  await page.locator('#mlsAvBack .mlsAvCard button', { hasText: 'Add to visit transcript' }).first().click();
  check('AV-1', !/ALICE/.test(await page.evaluate(() => document.getElementById('ez3flTranscript').value)),
    'the inbox wrote patient A\'s check-in into patient B\'s open transcript');
  check('AV-1', page.__errors.length === 0, 'page errors: ' + page.__errors.join(' | '));
  await page.close();
}

/* ------------------------------------------------------------------ AV-2 */
async function av2(browser) {
  const page = await open(browser, {});
  await page.waitForFunction(() => window.__pending('/api/avatar/checkins?status=ready').length > 0);
  await page.evaluate((row) => {
    window.__autoFetch = (r) => r.path.startsWith('/api/avatar/checkins') ? window.__respond({ ok: true, checkins: [row] }) : null;
    window.__pending('/api/avatar/checkins').forEach(r => window.__settle(r.id, { ok: true, checkins: [row] }));
  }, FLAGGED_ACTIVE);
  await page.waitForFunction(() => window.__mlsAvatar.lastReady && document.getElementById('mlsAvVisitCard'));
  await sleep(page, 80);
  const card = await page.evaluate(() => {
    const c = document.getElementById('mlsAvVisitCard');
    return { text: c.innerText, flagBanner: Array.from(c.querySelectorAll('.mlsAvBrief.flag')).map(n => n.textContent),
      buttons: Array.from(c.querySelectorAll('button')).map(b => b.textContent) };
  });
  check('AV-2', !/completed/i.test(card.text), 'the Visit card calls an unfinished check-in completed: ' + JSON.stringify(card.text));
  check('AV-2', /NOT finished/.test(card.text), 'the Visit card does not say the check-in is not finished');
  check('AV-2', card.flagBanner.some(t => /EMERGENCY LANGUAGE/.test(t) && /NOT finished/.test(t)),
    'no red emergency banner on the Visit card: ' + JSON.stringify(card.flagBanner));
  check('AV-2', !card.buttons.some(b => /Add to visit transcript|Add to chart/.test(b)),
    'file buttons offered for a check-in with no summary: ' + JSON.stringify(card.buttons));
  await page.evaluate(() => { window.__active = 'pt-B'; window.dispatchEvent(new CustomEvent('mls:active-patient-changed')); });
  await sleep(page, 80);
  const other = await page.evaluate(() => document.getElementById('mlsAvVisitCard').innerText);
  check('AV-2', !/finished their check-in/.test(other) && /NOT finished/.test(other),
    'another chart\'s Visit card counts the unfinished check-in as finished: ' + JSON.stringify(other));
  await page.evaluate(() => window.__mlsAvatar.open());
  await page.waitForSelector('#mlsAvBack .mlsAvCard');
  const inbox = await page.evaluate(() => document.querySelector('#mlsAvBack .mlsAvCard').innerText);
  check('AV-2', !/^Seen/m.test(inbox) && /NOT finished/.test(inbox), 'the inbox labels the unfinished check-in: ' + JSON.stringify(inbox));
  check('AV-2', /EMERGENCY LANGUAGE/.test(inbox), 'the inbox card drops the emergency flag');
  await page.close();
}

/* ------------------------------------------------------------------ AV-3 */
async function av3(browser) {
  const page = await open(browser, {});
  await page.evaluate(() => {
    window.__autoFetch = (row) => {
      if (row.path === '/api/avatar/office/tts') return window.__respond({ ok: false }, 503);
      if (row.path === '/api/avatar/office/turn') return window.__respond({ ok: true, say: 'What brings you in today?',
        progress: { covered: 1, total: 3 }, avatar: { name: 'Ava', exitPinSet: false } });
      return null;
    };
  });
  await page.waitForFunction(() => window.__pending('/api/avatar/checkins?status=ready').length > 0);
  await page.evaluate(() => window.__pending('/api/avatar/checkins').forEach(r => window.__settle(r.id, { checkins: [] })));
  await page.waitForSelector('#mlsAvBtn');
  await page.waitForSelector('#mlsAvVisitCard button');
  /* same account, same epoch, a fresh bearer token (what slideSession does) */
  await page.evaluate(() => { window.__tok = 'token-A-rotated'; });
  await page.click('#mlsAvBtn');
  await sleep(page, 80);
  check('AV-3', await page.evaluate(() => !!document.getElementById('mlsAvBack')), 'the menu button is dead after a same-account token rotation');
  await page.evaluate(() => window.__mlsAvatar.close());
  await page.evaluate(() => window.__pending('/api/avatar/checkins').forEach(r => window.__settle(r.id, { checkins: [] })));
  await page.getByRole('button', { name: '🎙 Start check-in interview' }).click();
  await sleep(page, 80);
  check('AV-3', await page.evaluate(() => !!document.getElementById('mlsAvKiosk')), 'the Visit card cannot start the kiosk after a rotation');
  if (!(await page.evaluate(() => !!document.getElementById('mlsAvKiosk')))) await page.evaluate(() => window.__mlsAvatar.openKiosk());
  await page.click('#mlsAvKioskConsentYes');
  await sleep(page, 400);
  await page.evaluate(() => { window.__tok = 'token-A-rotated-again'; });
  await page.click('#mlsAvKioskMute');
  check('AV-3', /Resume/.test(await page.evaluate(() => document.getElementById('mlsAvKioskMute').textContent)),
    'Pause is dead on a kiosk that was open across a rotation');
  await page.click('#mlsAvKioskEnd');
  await sleep(page, 150);
  check('AV-3', !(await page.evaluate(() => !!document.getElementById('mlsAvKiosk'))), 'End interview is dead on a kiosk that was open across a rotation');
  /* a refresh in flight across the rotation must not wedge the next one */
  await page.evaluate(() => window.__pending('/api/avatar/checkins').forEach(r => window.__settle(r.id, { checkins: [] })));
  await sleep(page, 50);
  await page.evaluate(() => window.__mlsAvatar.refreshCount(true));
  await sleep(page, 30);
  const inflight = await page.evaluate(() => window.__pending('/api/avatar/checkins?status=ready').map(r => r.id));
  await page.evaluate(() => { window.__tok = 'token-A-rotated-3'; });
  await page.evaluate((ids) => ids.forEach(id => window.__settle(id, { checkins: [{ id: 5, patient_external_id: 'pt-A', status: 'ready',
    ready_at: new Date().toISOString(), headline: 'NEW CHECK-IN', bullets: [], summary: 's', flags: [] }] })), inflight);
  await sleep(page, 80);
  const before = await page.evaluate(() => window.__requests.filter(r => r.path.startsWith('/api/avatar/checkins?status=ready')).length);
  await page.evaluate(() => window.__mlsAvatar.refreshCount(true));
  await sleep(page, 50);
  const after = await page.evaluate(() => ({ n: window.__requests.filter(r => r.path.startsWith('/api/avatar/checkins?status=ready')).length,
    badge: (document.querySelector('#mlsAvBtn .mlsAvCount') || {}).textContent }));
  check('AV-3', inflight.length === 1 && after.n === before + 1, 'the check-in refresh wedged after a rotation (' + before + ' -> ' + after.n + ')');
  check('AV-3', after.badge === '1', 'the rotated response was thrown away (badge ' + JSON.stringify(after.badge) + ')');
  /* a real account change is still a boundary */
  const stale = await page.evaluate(() => {
    const old = window.__mlsAvatar;
    window.__mlsSessionAccount = 'other@example.test'; window.__mlsSessionEpoch = 8; window.__tok = 'token-B';
    window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { epoch: 8, nextAccount: 'other@example.test' } }));
    return { oldOpen: old.open(), oldRefresh: old.refreshCount(true) };
  });
  check('AV-3', stale.oldOpen === false && stale.oldRefresh === false, 'an account change no longer retires the old owner');
  await page.close();
}

/* ------------------------------------------------------------ AV-4, AV-5 */
async function av4av5(browser) {
  { /* A: pause while listening - the silence clock must not speak or finish */
    const page = await open(browser, { clock: true });
    await interview(page, {});
    await page.clock.runFor(800);
    const before = await kioskSnap(page);
    await page.click('#mlsAvKioskMute');
    await page.clock.runFor(40000);
    const later = await kioskSnap(page);
    check('AV-4', later.spoken.length === before.spoken.length, 'spoken while paused: ' + JSON.stringify(later.spoken.slice(before.spoken.length)));
    check('AV-4', !later.turns.some(b => b.finish), 'the paused check-in was self-finished by the silence clock');
    check('AV-4', /Paused/.test(later.say), 'the paused screen was overwritten: ' + JSON.stringify(later.say));
    await page.close();
  }
  { /* B: a reply that lands while paused is held, then delivered on Resume */
    const page = await open(browser, {});
    await interview(page, { holdAnswers: true });
    await page.waitForFunction(() => window.__liveRec().length === 1);
    await sleep(page, 400);
    await answer(page, 'my right knee hurts');
    await page.waitForFunction(() => window.__pending('/api/avatar/office/turn').length === 1, null, { timeout: 5000 });
    await page.click('#mlsAvKioskMute');
    const paused = await kioskSnap(page);
    await page.evaluate(() => { const r = window.__pending('/api/avatar/office/turn')[0];
      window.__settle(r.id, { ok: true, say: 'Thanks. How long has the knee hurt?', progress: { covered: 2, total: 4 }, avatar: { name: 'Ava' } }); });
    await sleep(page, 500);
    const held = await kioskSnap(page);
    check('AV-4', held.spoken.length === paused.spoken.length, 'the reply was spoken over the Paused screen: ' + JSON.stringify(held.spoken.slice(paused.spoken.length)));
    check('AV-4', /Paused/.test(held.say), 'the reply replaced the Paused line: ' + JSON.stringify(held.say));
    await page.click('#mlsAvKioskMute');
    await sleep(page, 500);
    const resumed = await kioskSnap(page);
    check('AV-4', /How long has the knee hurt/.test(resumed.say) && resumed.spoken.slice(held.spoken.length).some(t => /How long has the knee hurt/.test(t)),
      'the held reply was not delivered on Resume: ' + JSON.stringify({ say: resumed.say, spoken: resumed.spoken.slice(held.spoken.length) }));
    await page.close();
  }
  { /* B2 (h10-1.0.1): an EMERGENCY reply is never held by Pause - it is shown and
       spoken at once, and listening stays closed until Resume */
    const page = await open(browser, {});
    await interview(page, { holdAnswers: true });
    await page.waitForFunction(() => window.__liveRec().length === 1);
    await sleep(page, 400);
    await answer(page, 'I have crushing chest pain and my left arm is numb');
    await page.waitForFunction(() => window.__pending('/api/avatar/office/turn').length === 1, null, { timeout: 5000 });
    await page.click('#mlsAvKioskMute');
    const paused = await kioskSnap(page);
    await page.evaluate(() => { const r = window.__pending('/api/avatar/office/turn')[0];
      window.__settle(r.id, { ok: true, emergency: true, say: 'Please stop and call 911 right now.', progress: { covered: 1, total: 4 }, avatar: { name: 'Ava' } }); });
    await sleep(page, 600);
    const warned = await kioskSnap(page);
    check('AV-4', /call 911/.test(warned.say), 'the emergency warning was held behind Pause: ' + JSON.stringify(warned.say));
    check('AV-4', warned.spoken.slice(paused.spoken.length).some(t => /call 911/.test(t)), 'the emergency warning was not spoken while paused');
    check('AV-4', warned.live === 0, 'Pause reopened the microphone after the emergency warning');
    await page.close();
  }
  { /* B3 (h10-1.0.1): the kiosk's controls stay on screen while its column scrolls */
    const page = await open(browser, {});
    await page.setViewportSize({ width: 390, height: 844 });
    await interview(page, {});
    await page.evaluate(() => { const k = document.getElementById('mlsAvKiosk'); k.scrollTop = k.scrollHeight; });
    await sleep(page, 200);
    const pos = await page.evaluate(() => ['mlsAvKioskEnd', 'mlsAvKioskMute'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.top), getComputedStyle(document.getElementById(id)).position]; }));
    for (const [id, top, position] of pos) check('AV-9', top >= 0 && top < 100 && position === 'fixed', id + ' scrolled off screen with the kiosk column: ' + JSON.stringify({ top, position }));
    await page.close();
  }
  { /* C: Resume without confirmed echo cancellation reopens listening */
    const page = await open(browser, {});
    await interview(page, { noAec: true });
    await page.waitForFunction(() => window.__liveRec().length === 1);
    await page.click('#mlsAvKioskMute');
    await sleep(page, 200);
    await page.click('#mlsAvKioskMute');
    await sleep(page, 600);
    check('AV-5', (await kioskSnap(page)).live >= 1, 'Resume left a "Listening" screen with no recogniser');
    await page.close();
  }
  { /* D: "Back to the interview" from the PIN pad reopens listening */
    const page = await open(browser, {});
    await interview(page, { noAec: true, pin: true });
    await page.waitForFunction(() => window.__liveRec().length === 1);
    await sleep(page, 300);
    await page.click('#mlsAvKioskEnd');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('mlsAvKioskPin')).display === 'flex');
    await page.click('#mlsAvKioskPinBack');
    await sleep(page, 600);
    check('AV-5', (await kioskSnap(page)).live >= 1, '"Back to the interview" left no recogniser');
    await page.close();
  }
}

/* ------------------------------------------------------------------ AV-6 */
async function av6(browser) {
  for (const mode of ['denied', 'network']) {
    const page = await open(browser, {});
    await interview(page, { denyMic: mode === 'denied' });
    if (mode === 'network') {
      for (let i = 0; i < 3; i++) {
        await page.waitForFunction(() => window.__liveRec().length === 1, null, { timeout: 5000 });
        await page.evaluate(() => { const r = window.__liveRec()[0]; r.running = false; r.onerror && r.onerror({ error: 'network' }); });
        await sleep(page, i < 2 ? 1700 : 100);
      }
    }
    await sleep(page, 700);
    const s1 = await kioskSnap(page);
    await page.fill('#mlsAvKioskInput', 'my right knee');
    await page.click('#mlsAvKioskSend');
    await sleep(page, 700);
    const s2 = await kioskSnap(page);
    for (const [n, s] of [['first question', s1], ['second question', s2]]) {
      check('AV-6', s.live === 0 && !/listening/.test(s.rootClass) && s.pill === 'none' && !/Listening/.test(s.chip),
        mode + ', ' + n + ': typed mode painted listening ' + JSON.stringify({ rootClass: s.rootClass, pill: s.pill, chip: s.chip }));
    }
    await page.close();
  }
}

/* ------------------------------------------------------------------ AV-7 */
async function av7(browser) {
  const CASES = [
    { name: 'network drop', kind: 'fail' },
    { name: '502 html', kind: 'status', status: 502, text: '<html>Bad gateway</html>' },
    { name: '429 text', kind: 'status', status: 429, text: 'Too many requests, please try again later.' },
    { name: '401 json', kind: 'json', status: 401, json: { error: 'Not authenticated' } },
    { name: 'wrong PIN', kind: 'json', status: 200, json: { ok: false, message: 'That PIN isn\'t right — try again.' }, wrong: true }
  ];
  const page = await open(browser, {});
  await interview(page, { pin: true, holdUnlock: true });
  await sleep(page, 400);
  await page.click('#mlsAvKioskEnd');
  for (const c of CASES) {
    await page.fill('#mlsAvKioskPinInput', '2468');
    await page.click('#mlsAvKioskPinGo');
    await page.waitForFunction(() => window.__pending('/api/avatar/office/unlock').length === 1);
    await page.evaluate((c) => {
      const r = window.__pending('/api/avatar/office/unlock')[0];
      if (c.kind === 'fail') window.__fail(r.id);
      else if (c.kind === 'status') window.__settle(r.id, null, c.status, c.text);
      else window.__settle(r.id, c.json, c.status);
    }, c);
    await sleep(page, 80);
    const out = await page.evaluate(() => ({ msg: document.getElementById('mlsAvKioskPinMsg').textContent,
      field: document.getElementById('mlsAvKioskPinInput').value }));
    if (c.wrong) {
      check('AV-7', /isn.t right/.test(out.msg) && out.field === '', 'a real wrong PIN is no longer called wrong: ' + JSON.stringify(out));
    } else {
      check('AV-7', !/isn.t right/.test(out.msg) && /Could not check the PIN/.test(out.msg) && out.field === '2468',
        c.name + ': a failed unlock request was reported as a wrong PIN: ' + JSON.stringify(out));
    }
  }
  await page.close();
}

/* ------------------------------------------------------------------ AV-8 */
async function av8(browser) {
  for (const recover of [false, true]) {
    const page = await open(browser, { clock: true });
    await interview(page, { holdFinish: true });
    await page.clock.runFor(800);
    await answer(page, 'my knee has been swelling for a week');
    await page.clock.runFor(2500);
    await page.click('#mlsAvKioskEnd');
    await page.clock.runFor(50);
    const failNext = () => page.evaluate(() => {
      const r = window.__requests.find(x => x.path === '/api/avatar/office/turn' && !x.settled && JSON.parse(x.body).finish);
      if (r) window.__settle(r.id, null, 502, '<html>Bad gateway</html>');
      return !!r;
    });
    check('AV-8', await failNext(), 'no finish request was sent at End interview');
    await page.clock.runFor(1500);
    const retried = await page.evaluate(() => window.__requests.filter(x => x.path === '/api/avatar/office/turn' && JSON.parse(x.body).finish).length);
    check('AV-8', retried >= 2, 'a failed finish was not retried (' + retried + ' finish request)');
    if (recover) {
      await page.evaluate(() => {
        const r = window.__requests.find(x => x.path === '/api/avatar/office/turn' && !x.settled && JSON.parse(x.body).finish);
        if (r) window.__settle(r.id, { ok: true, done: true, say: 'done' });
      });
      await page.clock.runFor(20000);
      const out = await page.evaluate(() => ({ toasts: window.__toasts.slice(),
        finishes: window.__requests.filter(x => x.path === '/api/avatar/office/turn' && JSON.parse(x.body).finish).length }));
      check('AV-8', out.finishes === 2 && !out.toasts.some(t => /NOT closed/.test(t)), 'a finish that recovered was still reported lost: ' + JSON.stringify(out));
    } else {
      for (let i = 0; i < 6; i++) { await failNext(); await page.clock.runFor(7000); }
      const out = await page.evaluate(() => ({ toasts: window.__toasts.slice(), kiosk: !!document.getElementById('mlsAvKiosk') }));
      check('AV-8', !out.kiosk && out.toasts.some(t => /NOT closed/.test(t)), 'a finish that never landed was silent: ' + JSON.stringify(out));
    }
    await page.close();
  }
}

/* ------------------------------------------------------------ AV-9, AV-10 */
async function av9av10(browser) {
  const phone = { width: 390, height: 844 };
  {
    const page = await open(browser, {}, phone);
    await interview(page, { pin: true, say: 'Hi, I am Ava, an AI assistant — not the doctor. What brings you in today, and how long has it been going on? Tell me in your own words, and take your time.' });
    await sleep(page, 900);
    const k = await page.evaluate(() => {
      const end = document.getElementById('mlsAvKioskEnd').getBoundingClientRect();
      const hit = document.elementFromPoint(end.left + end.width / 2, end.top + end.height / 2);
      const say = document.getElementById('mlsAvKioskSay');
      const range = document.createRange(); range.selectNodeContents(say);
      const lines = Array.from(range.getClientRects());
      const pill = document.getElementById('mlsAvKioskMic').getBoundingClientRect();
      const pillShown = getComputedStyle(document.getElementById('mlsAvKioskMic')).display !== 'none';
      return { endHit: !!hit && (hit.id === 'mlsAvKioskEnd' || !!hit.closest('#mlsAvKioskEnd')), hitId: hit && (hit.id || hit.tagName),
        textBottom: Math.max.apply(null, lines.map(l => l.bottom)), sayBottom: say.getBoundingClientRect().bottom,
        underPill: pillShown ? lines.filter(l => l.bottom > pill.top + 1 && l.top < pill.bottom - 1).length : 0 };
    });
    check('AV-9', k.endHit, 'End interview is covered at 390x844 by ' + k.hitId);
    check('AV-9', k.textBottom <= k.sayBottom + 1 && k.underPill === 0, 'the question runs under the Listening pill: ' + JSON.stringify(k));
    await page.close();
  }
  {
    const page = await open(browser, {}, phone);
    await page.evaluate(() => {
      window.__autoFetch = (row) => {
        if (row.path.startsWith('/api/avatar/checkins')) return window.__respond({ checkins: [] });
        if (row.path === '/api/avatar/config') return window.__respond({ ok: true, config: { name: 'Ava', intro: '', questions: ['What brings you in?'],
          tone: 'friendly', voice: 'coral', faceMode: 'drawn', faceLook: {}, faceImage: '' } });
        return null;
      };
    });
    await page.evaluate(() => window.__mlsAvatar.open());
    await page.getByRole('button', { name: 'Set up the avatar' }).click();
    await page.waitForSelector('#mlsAvSaveBtn');
    await sleep(page, 300);
    const s = await page.evaluate(() => {
      const panel = document.querySelector('.mlsAvPanel');
      const cs = getComputedStyle(panel);
      const right = panel.getBoundingClientRect().right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const hear = Array.from(panel.querySelectorAll('button')).find(b => /Hear this voice/.test(b.textContent)).getBoundingClientRect();
      return { sideways: panel.scrollWidth > panel.clientWidth + 1, hearRight: Math.round(hear.right), contentRight: Math.round(right) };
    });
    check('AV-10', !s.sideways && s.hearRight <= s.contentRight + 1, 'the Setup form is wider than its panel at 390x844: ' + JSON.stringify(s));
    await page.close();
  }
}

/* ----------------------------------------------------------------- AV-11 */
async function av11(browser) {
  const page = await open(browser, {});
  await page.evaluate(() => {
    window.__autoFetch = (row) => {
      if (row.path.startsWith('/api/avatar/checkins?status=ready')) return window.__respond({ checkins: [
        { id: 77, patient_external_id: 'pt-A', status: 'ready', ready_at: new Date().toISOString(), turns: 4, headline: 'h', bullets: ['b'], summary: 's', audited: 'passed', flags: [] }] });
      if (row.path === '/api/avatar/config' && row.method === 'GET') return window.__respond({ ok: true, config: { name: 'Ava', intro: '',
        questions: ['What brings you in?'], tone: 'friendly', voice: 'coral', faceMode: 'drawn', faceLook: {}, faceImage: '' } });
      return null;
    };
  });
  await page.evaluate(() => window.__mlsAvatar.open());
  await page.getByRole('button', { name: 'Set up the avatar' }).click();
  await page.waitForSelector('#mlsAvSaveBtn');
  await page.click('#mlsAvSaveBtn');
  await page.selectOption('#mlsAvFaceMode', 'photo');
  await page.evaluate(() => { const r = window.__requests.find(x => x.path === '/api/avatar/config' && x.method === 'POST' && !x.settled);
    window.__settle(r.id, { ok: false, error: 'server_error' }, 500); });
  await sleep(page, 300);
  const status = await page.evaluate(() => document.getElementById('mlsAvSaveBtn').parentNode.nextElementSibling.textContent);
  check('AV-11', status !== 'Saving…' && /Could not save/.test(status), 'a failed save still reads ' + JSON.stringify(status));
  await page.getByRole('button', { name: 'Ready' }).click();
  await page.getByRole('button', { name: 'Mark seen' }).click();
  await page.evaluate(() => { const r = window.__requests.find(x => /\/seen$/.test(x.path) && !x.settled); window.__settle(r.id, { error: 'Not authenticated' }, 401); });
  await sleep(page, 150);
  check('AV-11', await page.evaluate(() => window.__toasts.some(t => /Could not mark/.test(t))), 'a failed Mark seen reverted silently');
  await page.close();
}

/* ----------------------------------------------------------------- AV-12 */
async function av12(browser) {
  const page = await open(browser, { face: true });
  await page.waitForFunction(() => window.__mlsAvatarFaceStudio && window.__mlsAvatarFaceStudio.installed);
  await page.evaluate(() => {
    window.__autoFetch = (row) => {
      if (row.path.startsWith('/api/avatar/checkins')) return window.__respond({ checkins: [] });
      if (row.path === '/api/avatar/config') return window.__respond({ ok: true, config: { name: 'Ava', intro: '', questions: ['Q?'],
        tone: 'friendly', voice: 'coral', faceMode: 'drawn', faceLook: {}, faceImage: '' } });
      return null;
    };
  });
  await page.evaluate(() => window.__mlsAvatar.open());
  await page.getByRole('button', { name: 'Set up the avatar' }).click();
  await page.waitForSelector('.mlsP1FaceMeter');
  await page.click('#mlsAvMatchBtn');
  await sleep(page, 700);
  const m = await page.evaluate(() => ({ head: document.querySelector('.mlsP1FaceMeterHead').textContent,
    detail: document.querySelector('.mlsP1FaceMeterDetail').textContent, note: document.getElementById('mlsAvLookNote').textContent }));
  check('AV-12', !/Matching your photo/.test(m.head) && /Capture your photo/.test(m.detail),
    'the meter still says it is matching after the engine refused: ' + JSON.stringify(m));
  await page.close();
}

/* ----------------------------------------------------------------- AV-13 */
async function av13(browser) {
  const page = await open(browser, {});
  await page.evaluate(() => {
    window.__voices = [{ name: 'Synthetic Browser Voice', lang: 'en-US', localService: true }];
    window.__ttsAsked = [];
    window.__autoFetch = (row) => {
      if (row.path.startsWith('/api/avatar/checkins')) return window.__respond({ checkins: [] });
      if (row.path === '/api/avatar/config') return window.__respond({ ok: true, config: { name: 'Ava', intro: '', questions: ['Q?'],
        tone: 'friendly', voice: 'coral', faceMode: 'drawn', faceLook: {}, faceImage: '' } });
      if (row.path === '/api/avatar/office/tts') { window.__ttsAsked.push(JSON.parse(row.body).voice); return window.__respond({ ok: false, error: 'tts_unavailable' }, 502); }
      return null;
    };
  });
  await page.evaluate(() => window.__mlsAvatar.open());
  await page.getByRole('button', { name: 'Set up the avatar' }).click();
  await page.waitForSelector('#mlsAvVoicePick');
  for (const v of ['onyx', 'ash']) {
    await page.selectOption('#mlsAvVoicePick', v);
    const n = await page.evaluate(() => window.__spoken.length);
    await page.getByRole('button', { name: '▶ Hear this voice' }).click();
    await page.waitForFunction((k) => window.__spoken.length > k, n, { timeout: 8000 });
    await sleep(page, 200);
  }
  const out = await page.evaluate(() => ({ asked: window.__ttsAsked.slice(),
    note: (document.getElementById('mlsAvBack').innerText.match(/[^\n]*browser.s own voice[^\n]*/) || [''])[0] }));
  check('AV-13', out.asked.indexOf('ash') >= 0, 'the second audition never asked for its voice (breaker held): ' + JSON.stringify(out.asked));
  check('AV-13', /Could not load Ash/.test(out.note), 'the substitute browser voice was not named next to the button: ' + JSON.stringify(out.note));
  await page.close();
}

(async () => {
  const server = await serve();
  BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const runs = [['AV-1', av1], ['AV-2', av2], ['AV-3', av3], ['AV-4/5', av4av5], ['AV-6', av6], ['AV-7', av7],
    ['AV-8', av8], ['AV-9/10', av9av10], ['AV-11', av11], ['AV-12', av12], ['AV-13', av13]];
  try {
    for (const [id, fn] of runs) {
      try { await fn(browser); } catch (e) { failures.push(id + ': threw ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' ')); }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log('FAILED ' + failures.length + ' check(s) (' + passed + ' passed):\n- ' + failures.join('\n- '));
    assert.fail(failures.length + ' avatar h10 check(s) failed');
  }
  console.log('avatar h10: ' + passed + ' checks passed across AV-1..AV-13 (wrong-patient write, unfinished emergency check-in, ' +
    'token rotation, pause, resume, typed mode, PIN, lost finish, phone layout, save/mark-seen, face meter, voice preview)');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
