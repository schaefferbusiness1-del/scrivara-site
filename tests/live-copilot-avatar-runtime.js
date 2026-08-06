'use strict';
/*
 * LIVE RUNTIME PROOF — Copilot Power (cpw-1.0.0) + AVATAR (av-1.0.0)
 * -----------------------------------------------------------------------------
 * NOT registered in run-all.js — run by hand / by the evidence runner:
 *
 *   NODE_PATH=<scratchpad>/node_modules node tests/live-copilot-avatar-runtime.js
 *
 * A real Chrome executes the SHIPPED bytes served by a loopback static server
 * (responses hashed AT THE SERVER RESPONSE BOUNDARY); every non-loopback
 * request is intercepted — the backend is mocked at the network layer, so
 * nothing external is touched and no PHI exists anywhere in this run.
 *
 * SCENARIO A — patient portal: a mocked patient session signs in, the AVATAR
 *   check-in card renders, Start begins the interview, a typed answer advances
 *   it, and completion shows the done state. Real DOM, real clicks.
 * SCENARIO B — doctor side: feat_mls_avatar.js mounts its menu entry before
 *   Settings, the panel lists a mocked ready check-in with the flag bullet
 *   first, "Add to visit summary" imports ONCE (stamped, second tap refused),
 *   and Mark seen POSTs. Executed via real trusted clicks.
 * SCENARIO C — copilot power: a real click on a pullProviders offer resolves
 *   only roster-verified providers and runs the pull engine sequentially with
 *   honest receipts; a busy engine refuses; draftNote opens the exact patient.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'tests', 'live-copilot-avatar-artifacts', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(outDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  status: 'HARNESS-FAIL',
  scenarios: {},
  servedAssets: [],
  browser: null,
  provenance: {}
};
if (process.env.MLS_EVIDENCE_IDENTITY) report.evidenceIdentity = process.env.MLS_EVIDENCE_IDENTITY;

function reportStatus(code) {
  report.status = code === 0 ? 'PASS' : (report.status === 'HARNESS-FAIL' ? 'HARNESS-FAIL' : 'FAIL');
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log((code === 0 ? 'PASS' : 'FAIL') + ' live copilot+avatar runtime — artifacts: ' + outDir);
  process.exit(code);
}

/* ---- loopback static server with response-boundary hashing ---- */
const servedSeen = new Map();
const server = http.createServer((req, res) => {
  const clean = decodeURIComponent(String(req.url).split('?')[0]).replace(/^\/+/, '');
  const filePath = path.join(root, clean || 'index.html');
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  const bytes = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const row = servedSeen.get(clean) || { path: clean, bytes: bytes.length, sha256, requests: 0 };
  row.requests++; servedSeen.set(clean, row);
  const type = clean.endsWith('.html') ? 'text/html; charset=utf-8'
    : clean.endsWith('.js') ? 'text/javascript; charset=utf-8'
    : clean.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(bytes);
});

(async function main() {
  let chromium;
  try { ({ chromium } = require('playwright-core')); }
  catch (e) { console.error('playwright-core unavailable: set NODE_PATH to a node_modules that has it'); reportStatus(3); }

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  report.browser = { version: browser.version() };
  try { report.provenance.chromeExecutable = fs.realpathSync(browser._options ? '' : ''); } catch (e) {}
  report.provenance.channel = 'chrome';

  const failures = [];
  function scenario(name, ok, detail) {
    report.scenarios[name] = { ok: !!ok, detail: detail || null };
    if (!ok) failures.push(name + (detail ? (': ' + detail) : ''));
    console.log((ok ? '  ok ' : '  FAIL ') + name + (detail && !ok ? ' — ' + detail : ''));
  }

  /* =========================== SCENARIO A: portal =========================== */
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const turnLog = [];
    let turnCount = 0;
    await page.route(/scrivara-backend\.onrender\.com/, async (route) => {
      const url = route.request().url();
      const respond = (json) => route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
        body: JSON.stringify(json)
      });
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST' } });
      }
      if (/\/api\/patient\/me/.test(url)) return respond({ ok: true, patient: { name: 'Synthetic Patient' }, practice: 'Synthetic Spine Clinic' });
      if (/\/api\/patient\/history/.test(url)) return respond({ ok: true, chart: {}, visits: [], appointments: [] });
      if (/\/api\/patient\/requests/.test(url)) return respond({ ok: true, requests: [] });
      if (/\/api\/patient\/avatar\/turn/.test(url)) {
        turnCount++;
        const body = JSON.parse(route.request().postData() || '{}');
        turnLog.push(body);
        if (turnCount === 1) return respond({ ok: true, say: 'Hi! I\'m Ava. What brings you in today?', done: false, progress: { covered: 1, total: 2 },
          avatar: { name: 'Ava', faceImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } });
        return respond({ ok: true, say: 'That covers everything — thank you!', done: true, progress: { covered: 2, total: 2 } });
      }
      return respond({ ok: true });
    });
    // block any other external origin outright
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|scrivara-backend\.onrender\.com)/, (route) => route.abort());

    // Stub the browser speech engines BEFORE page scripts: record what the
    // avatar SPEAKS and feed it a spoken ANSWER — the no-typing loop, proven.
    await page.addInitScript(() => {
      window.__spoken = [];
      window.__recs = [];
      // speechSynthesis is an accessor in Chrome — plain assignment is
      // silently ignored; defineProperty is required to stub it.
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        speak: (u) => { window.__spoken.push(u.text); try { u.onstart && u.onstart(); } catch (e) {} setTimeout(() => { try { u.onend && u.onend(); } catch (e) {} }, 30); },
        cancel: () => {}
      } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: function (t) { this.text = String(t); } });
      const FakeRec = function () {
        const rec = this;
        rec.start = () => { window.__recs.push(rec); };
        rec.stop = () => { try { rec.onend && rec.onend(); } catch (e) {} };
        rec.abort = rec.stop;
      };
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRec });
      Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRec });
    });
    await page.goto(base + '/patient-portal.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      sessionStorage.setItem('mls_patient_session', 'test-token.sig');
      if (window.__mlsPortalSess && window.__mlsPortalSess.set) window.__mlsPortalSess.set('test-token.sig');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#app:not(.hide)', { timeout: 10000 });
    await page.waitForSelector('#mlsAvCard', { timeout: 10000 });
    scenario('A1 portal shows the check-in card', true);

    await page.click('#mlsAvStart');
    await page.waitForFunction(() => {
      const log = document.getElementById('mlsAvLog');
      return log && /What brings you in today/.test(log.textContent || '');
    }, null, { timeout: 8000 });
    scenario('A2 Start begins the interview with the first question', true);
    const progressShown = await page.evaluate(() => {
      const el = document.getElementById('mlsAvProgress');
      return !!el && el.style.display !== 'none' && /Question 1 of 2/.test(el.textContent || '');
    });
    scenario('A2b honest progress shows (Question 1 of 2)', progressShown);
    const identityOk = await page.evaluate(() => {
      const face = document.getElementById('mlsAvFace');
      const name = document.getElementById('mlsAvName');
      const styleNode = document.getElementById('mlsAvStyle');
      return !!(face && face.querySelector('img') && name && /Ava/.test(name.textContent || '')
        && styleNode && /prefers-reduced-motion/.test(styleNode.textContent || '')
        && /mlsAvIdle/.test(styleNode.textContent || ''));
    });
    scenario('A2c the avatar face renders with animations + a reduced-motion kill', identityOk);

    // A3-voice: the avatar SPOKE the question and started LISTENING; a spoken
    // answer flows through the same nonce-safe turn path — zero typing.
    await page.waitForFunction(() => window.__spoken.some((t) => /What brings you in today/.test(t)) && window.__recs.length >= 1, null, { timeout: 8000 });
    scenario('A3a the avatar speaks its question aloud and starts listening', true);
    await page.evaluate(() => {
      const rec = window.__recs[window.__recs.length - 1];
      const result = [{ transcript: 'My lower back hurts.' }]; result.isFinal = true;
      rec.onresult({ resultIndex: 0, results: [result] });
      rec.stop(); // patient taps Done / recognition ends -> submits
    });
    await page.waitForFunction(() => {
      const done = document.getElementById('mlsAvDone');
      return done && done.style.display !== 'none';
    }, null, { timeout: 8000 });
    const answerReached = turnLog.some((t) => t.answer === 'My lower back hurts.' && t.answerNonce);
    scenario('A3 the SPOKEN answer reaches the backend (nonce-safe) and completion shows', answerReached, answerReached ? null : JSON.stringify(turnLog));
    const closingSpoken = await page.evaluate(() => window.__spoken.some((t) => /covers everything/.test(t)));
    scenario('A3b the closing message is spoken aloud too', closingSpoken);
    const typingFallback = await page.evaluate(() => !!document.getElementById('mlsAvInput'));
    scenario('A3c the typing fallback remains for accessibility', typingFallback);
    const inputHidden = await page.evaluate(() => document.getElementById('mlsAvInputRow').style.display === 'none');
    scenario('A4 a completed check-in retires its input row', inputHidden);
    await page.screenshot({ path: path.join(outDir, 'A-portal-checkin.png'), fullPage: true });
    await context.close();
  } catch (e) { scenario('A portal flow', false, String(e && e.message).slice(0, 300)); }

  /* ========================= SCENARIO B: doctor side ======================== */
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const posts = [];
    await page.route(/scrivara-backend\.onrender\.com/, async (route) => {
      const url = route.request().url();
      const respond = (json) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: JSON.stringify(json) });
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST' } });
      if (/\/seen$/.test(url)) { posts.push(url); return respond({ ok: true, status: 'seen' }); }
      if (/\/api\/avatar\/checkins/.test(url)) return respond({ ok: true, checkins: [{
        id: 5, status: 'ready', patient_external_id: 'ext-9', ready_at: '2026-08-05 15:00:00', turns: 6,
        bullets: ['⚠ Patient used emergency-sounding language during check-in — read the transcript.', 'Pain 8/10 for two weeks'],
        summary: 'Patient reports two weeks of lower back pain, rated 8/10.', flags: ['emergency-language']
      }] });
      if (/\/api\/avatar\/config/.test(url)) return respond({ ok: true, config: { name: 'Ava', intro: '', questions: ['Q1'], enabled: true } });
      return respond({ ok: true });
    });
    await page.goto(base + '/tests/fixtures/blank.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.setContent('<div id="mlsTbMenuPanel"><button>Something</button><button>Settings</button></div><div id="visitView"><div id="vExisting">existing visit content</div><textarea id="ez3flTranscript"></textarea></div>');
    await page.evaluate(() => {
      window.bkToken = () => 'tok';
      window.bkBase = () => 'https://scrivara-backend.onrender.com';
      window.__mlsImported = [];
      window.__mlsStore = [{ id: 'ext-9', name: 'Exact Patient', summary: 'Existing history.' }];
      window.getPatients = () => window.__mlsStore;
      window.getActivePtId = () => 'ext-9';
      // realistic upsert: applies the row into the store (av-1.1.0 verifies by
      // re-reading the store before claiming success)
      window.upsertPatient = (p) => {
        window.__mlsImported.push(JSON.parse(JSON.stringify(p)));
        const row = window.__mlsStore.find((x) => String(x.id) === String(p.id));
        if (row) row.summary = p.summary;
      };
      window.toast = () => {};
    });
    await page.addScriptTag({ url: base + '/feat_mls_avatar.js' });
    await page.waitForFunction(() => window.__mlsAvatar && window.__mlsAvatar.installed, null, { timeout: 5000 });
    await page.waitForFunction(() => {
      const menu = document.getElementById('mlsTbMenuPanel');
      const btn = document.getElementById('mlsAvBtn');
      return btn && menu.contains(btn);
    }, null, { timeout: 6000 });
    const beforeSettings = await page.evaluate(() => {
      const btn = document.getElementById('mlsAvBtn');
      return /settings/i.test((btn.nextSibling && btn.nextSibling.textContent) || '');
    });
    scenario('B1 menu entry mounts immediately before Settings', beforeSettings);

    await page.click('#mlsAvBtn');
    await page.waitForSelector('.mlsAvCard', { timeout: 6000 });
    const flagFirst = await page.evaluate(() => {
      const bullets = document.querySelectorAll('.mlsAvBullets li');
      return bullets.length === 2 && bullets[0].classList.contains('flag');
    });
    scenario('B2 ready check-in renders with the flag bullet FIRST', flagFirst);

    await page.click('.mlsAvPanel .mlsAvAction.primary');
    const imported = await page.evaluate(() => window.__mlsImported);
    const stampOk = imported.length === 1 && /\[Avatar check-in #5 — completed /.test(imported[0].summary) && imported[0].summary.startsWith('Existing history.');
    scenario('B3 import appends the stamped summary once, preserving history', stampOk, stampOk ? null : JSON.stringify(imported).slice(0, 200));
    await page.click('.mlsAvPanel .mlsAvAction.primary').catch(() => {});
    const stillOne = await page.evaluate(() => window.__mlsImported.length === 1);
    scenario('B4 a second import tap is refused by the stamp guard', stillOne);

    const seenBtn = await page.$('.mlsAvPanel button.mlsAvAction:not(.primary):not([disabled])');
    let seenOk = false;
    if (seenBtn) {
      const label = await seenBtn.textContent();
      if (/mark seen/i.test(label)) { await seenBtn.click(); await page.waitForTimeout(400); seenOk = posts.some((u) => /\/5\/seen$/.test(u)); }
    }
    // fall back: find by text among actions
    if (!seenOk) {
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('.mlsAvAction'));
        const b = btns.find((x) => /mark seen/i.test(x.textContent));
        if (b) { b.click(); return true; } return false;
      });
      if (clicked) { await page.waitForTimeout(400); seenOk = posts.some((u) => /\/5\/seen$/.test(u)); }
    }
    scenario('B5 Mark seen POSTs to the exact check-in', seenOk, seenOk ? null : posts.join(','));
    // B6: the Visit-page card — after a badge refresh, #visitView carries the
    // check-in card, and because the ACTIVE patient (ext-9) has a ready
    // check-in, the highlight line + View highlights button show.
    await page.evaluate(() => { document.querySelector('.mlsAvBack') && document.querySelector('.mlsAvClose').click(); });
    await page.evaluate(() => window.__mlsAvatar.refreshCount(true));
    await page.waitForFunction(() => {
      const card = document.getElementById('mlsAvVisitCard');
      return !!card && /completed their pre-visit check-in/.test(card.textContent || '')
        && card.querySelectorAll('.mlsAvBullets li').length >= 1
        && Array.from(card.querySelectorAll('button')).some((b) => /Add to visit transcript/.test(b.textContent || ''));
    }, null, { timeout: 6000 });
    const cardOnTop = await page.evaluate(() => {
      const view = document.getElementById('visitView');
      return view.firstElementChild && view.firstElementChild.id === 'mlsAvVisitCard'
        && !!document.getElementById('vExisting');
    });
    scenario('B6 the Visit page shows the check-in bullets INLINE, card on TOP, existing content intact', cardOnTop);

    // B7: one tap files the patient's words into the visit transcript,
    // labelled and idempotent; the app's input mirror is notified.
    await page.evaluate(() => {
      window.__mlsTxEvents = 0;
      document.getElementById('ez3flTranscript').addEventListener('input', () => window.__mlsTxEvents++);
      const btn = Array.from(document.querySelectorAll('#mlsAvVisitCard button')).find((b) => /Add to visit transcript/.test(b.textContent));
      btn.click();
    });
    await page.waitForTimeout(300);
    const txFacts = await page.evaluate(() => {
      const v = document.getElementById('ez3flTranscript').value;
      const btn = Array.from(document.querySelectorAll('#mlsAvVisitCard button')).find((b) => /In transcript/.test(b.textContent));
      return { v, events: window.__mlsTxEvents, done: !!btn && btn.disabled,
        stamps: (v.match(/\[Pre-visit check-in #5 — patient-reported\]/g) || []).length };
    });
    const txOk = txFacts.stamps === 1 && /lower back pain/.test(txFacts.v) && txFacts.events === 1 && txFacts.done;
    scenario('B7 the patient-reported summary lands in the visit transcript once, labelled, mirror notified', txOk, txOk ? null : JSON.stringify(txFacts).slice(0, 200));

    // B8: the Visit card's "Set up" opens the panel ON the Setup tab (the
    // round-3 review caught it landing on Ready and arming a stale flag).
    await page.evaluate(() => {
      // empty the ready cache so the card shows the Set up button
      window.__mlsAvatar.lastReady = { at: Date.now(), total: 0, checkins: [] };
      window.getActivePtId = () => '';
      window.dispatchEvent(new Event('mls:view-changed'));
    });
    await page.waitForFunction(() => {
      const card = document.getElementById('mlsAvVisitCard');
      return !!card && Array.from(card.querySelectorAll('button')).some((b) => /Set up/.test(b.textContent || ''));
    }, null, { timeout: 5000 });
    await page.evaluate(() => {
      Array.from(document.querySelectorAll('#mlsAvVisitCard button')).find((b) => /Set up/.test(b.textContent)).click();
    });
    await page.waitForFunction(() => {
      const panel = document.querySelector('.mlsAvPanel');
      if (!panel) return false;
      const onTab = panel.querySelector('.mlsAvTab.on');
      return !!onTab && /Set up the avatar/.test(onTab.textContent || '') && !!panel.querySelector('.mlsAvForm');
    }, null, { timeout: 6000 });
    scenario('B8 the Visit card Set up lands directly on the Setup tab', true);

    // B9: THE OFFICE INTERVIEW — patient in the room, doctor taps Start:
    // full-screen opaque kiosk, spoken question, spoken answer to the OFFICE
    // endpoint for the ACTIVE patient, emotion states, and honest close.
    await page.addInitScript(() => {}); // (stubs already installed for this context? no — install below)
    await page.evaluate(() => {
      window.__spoken = window.__spoken || []; window.__recs = window.__recs || [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        speak: (u) => { window.__spoken.push(u.text); try { u.onstart && u.onstart(); } catch (e) {} setTimeout(() => { try { u.onend && u.onend(); } catch (e) {} }, 30); },
        cancel: () => {} } });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: function (t) { this.text = String(t); } });
      const FakeRec = function () { const rec = this;
        rec.start = () => { window.__recs.push(rec); };
        rec.stop = () => { try { rec.onend && rec.onend(); } catch (e) {} };
        rec.abort = rec.stop; };
      Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRec });
      Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRec });
      window.getActivePtId = () => 'ext-9'; // the patient in the room
      // mic preflight granted instantly (no permission UI in the harness)
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
        getUserMedia: () => Promise.resolve({ getTracks: () => [] }) } });
      // av-5.0.0: record the true-fullscreen request (no gesture in a harness)
      window.__fsReqs = 0;
      document.documentElement.requestFullscreen = () => { window.__fsReqs++; return Promise.resolve(); };
    });
    // av-5.0.0: natural-voice endpoint answers 503 here — the kiosk must fall
    // back to browser speech WITHOUT stalling the loop.
    await page.route(/scrivara-backend\.onrender\.com\/api\/avatar\/office\/tts/, (route) => route.fulfill({
      status: 503, contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
      body: JSON.stringify({ ok: false, error: 'tts_unavailable' }) }));
    // office endpoint mock (same context route already covers the origin —
    // extend the handler map by re-routing)
    const officeTurns = [];
    await page.route(/scrivara-backend\.onrender\.com\/api\/avatar\/office\/turn/, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      officeTurns.push(body);
      const respond = (json) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: JSON.stringify(json) });
      if (!body.answer) return respond({ ok: true, say: 'Hi! What brings you in today?', done: false, progress: { covered: 1, total: 1 }, avatar: { name: 'Ava', faceImage: null, faceMode: 'drawn', exitPinSet: true } });
      return respond({ ok: true, say: 'That covers everything — thank you!', done: true, progress: { covered: 1, total: 1 } });
    });
    // av-5.1.0: the exit PIN is verified server-side — '4321' unlocks
    const unlockCalls = [];
    await page.route(/scrivara-backend\.onrender\.com\/api\/avatar\/office\/unlock/, async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      unlockCalls.push(body.pin);
      route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
        body: JSON.stringify(body.pin === '4321' ? { ok: true } : { ok: false, message: 'That PIN isn\'t right — try again.' }) });
    });
    await page.evaluate(() => window.__mlsAvatar.openKiosk());
    await page.waitForFunction(() => {
      const k = document.getElementById('mlsAvKiosk');
      return !!k && window.__spoken.some((t) => /What brings you in today/.test(t)) && window.__recs.length >= 1;
    }, null, { timeout: 8000 });
    const kioskShape = await page.evaluate(() => {
      const k = document.getElementById('mlsAvKiosk');
      const cs = getComputedStyle(k);
      const svg = k.querySelector('#mlsAvKioskFace svg');
      return { fixed: cs.position === 'fixed', full: k.getBoundingClientRect().width >= window.innerWidth - 2,
        opaque: /gradient|rgb/.test(cs.backgroundImage + cs.backgroundColor),
        say: document.getElementById('mlsAvKioskSay').textContent,
        // av-5.0.0: the LIVING face — drawn parts present, mood driven
        face: !!(svg && svg.querySelector('.fMouth') && svg.querySelector('.fEyeL') && svg.querySelector('.fBrowR')),
        mood: svg ? svg.getAttribute('data-mood') : null,
        fs: window.__fsReqs >= 1 };
    });
    scenario('B9a the kiosk is full-screen, opaque, speaks and listens', kioskShape.fixed && kioskShape.full && kioskShape.opaque && /What brings you in/.test(kioskShape.say), JSON.stringify(kioskShape).slice(0, 160));
    scenario('B9c the living face renders with expressions and true fullscreen was requested', kioskShape.face && !!kioskShape.mood && kioskShape.fs, JSON.stringify({ face: kioskShape.face, mood: kioskShape.mood, fs: kioskShape.fs }));
    // B9d: END is a STAFF action — the PIN pad gates it, a wrong PIN keeps
    // the kiosk, Back resumes the interview.
    await page.evaluate(() => document.getElementById('mlsAvKioskEnd').click());
    const padShown = await page.evaluate(() => getComputedStyle(document.getElementById('mlsAvKioskPin')).display !== 'none');
    await page.evaluate(() => { document.getElementById('mlsAvKioskPinInput').value = '1111'; document.getElementById('mlsAvKioskPinGo').click(); });
    await page.waitForFunction(() => (document.getElementById('mlsAvKioskPinMsg').textContent || '').length > 0, null, { timeout: 5000 });
    const stillOpen = await page.evaluate(() => !!document.getElementById('mlsAvKiosk'));
    await page.evaluate(() => document.getElementById('mlsAvKioskPinBack').click());
    const padHiddenAndListening = await page.evaluate(() => getComputedStyle(document.getElementById('mlsAvKioskPin')).display === 'none' && window.__recs.length >= 2);
    scenario('B9d End gates behind the exit PIN — wrong PIN refused, Back resumes the interview', padShown && stillOpen && padHiddenAndListening && unlockCalls.includes('1111'));

    await page.evaluate(() => {
      const rec = window.__recs[window.__recs.length - 1];
      const result = [{ transcript: 'My shoulder aches at night.' }]; result.isFinal = true;
      rec.onresult({ resultIndex: 0, results: [result] });
      rec.stop();
    });
    // av-5.1.0: with a PIN set, completion RESTS ("hand the screen back")
    // instead of exposing the app; the PIN then closes it for real.
    await page.waitForFunction(() => /hand the screen back/.test(document.getElementById('mlsAvKioskSay')?.textContent || ''), null, { timeout: 15000 });
    await page.evaluate(() => document.getElementById('mlsAvKioskEnd').click());
    await page.evaluate(() => { document.getElementById('mlsAvKioskPinInput').value = '4321'; document.getElementById('mlsAvKioskPinGo').click(); });
    await page.waitForFunction(() => !document.getElementById('mlsAvKiosk'), null, { timeout: 8000 });
    const officeOk = officeTurns.some((t) => t.answer === 'My shoulder aches at night.' && t.patientExternalId === 'ext-9' && t.answerNonce)
      && officeTurns.every((t) => t.patientExternalId === 'ext-9') && unlockCalls.includes('4321');
    scenario('B9b the spoken office answer files to the ACTIVE patient nonce-safe; completion rests until the PIN closes it', officeOk, officeOk ? null : JSON.stringify(officeTurns).slice(0, 200));
    await page.screenshot({ path: path.join(outDir, 'B-doctor-panel.png'), fullPage: true });
    await context.close();
  } catch (e) { scenario('B doctor side', false, String(e && e.message).slice(0, 300)); }

  /* ======================== SCENARIO C: copilot power ======================= */
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
    await page.setContent('<div id="host"></div>');
    await page.evaluate(() => {
      window.__mlsPulls = [];
      window.__mlsSaid = [];
      window.copilotSnapshot = () => ({ today: '2026-08-05', patients: [{ id: 'p1' }] });
      window._acctTodayKey = () => '2026-08-05';
      window.__mlsDayHistoryPull = { state: { running: false } };
      // the REAL unify signature: append(role, text, extra) -> message
      window.__mlsCopilotConvo = { append: (role, text, extra) => {
        const m = { role: role === 'user' ? 'user' : 'ai', text: String(text == null ? '' : text) };
        window.__mlsSaid.push(m.text);
        return m;
      } };
      window.__mlsProviderRoster = {
        list: () => [{ name: 'Smith, Adam', stableKey: 'athena:smith, adam', rosterVerified: true }],
        getReceipt: () => ({ complete: true }),
        resolve: (n) => (/smith/i.test(String(n)) ? { name: 'Smith, Adam', stableKey: 'athena:smith, adam', id: 'pr1' } : null)
      };
      window.__mlsSI = { dayPull: (opts) => { window.__mlsPulls.push(opts); return Promise.resolve({ ok: true, created: 2, repaired: 0, failed: 0 }); } };
      window.__mlsPick = { select: (id) => { window.__mlsSelected = id; return true; } };
      window.openOpPrepForPatient = (id) => { window.__mlsPrepped = id; };
      window.getPatients = () => [{ id: 'p-17', name: 'Exact Patient' }];
      window.toast = () => {};
    });
    await page.addScriptTag({ url: base + '/feat_mls_copilot_power.js' });
    await page.waitForFunction(() => window.__mlsCopilotPower && window.__mlsCopilotPower.installed, null, { timeout: 5000 });

    const snapOk = await page.evaluate(() => {
      const snap = window.copilotSnapshot();
      return !!(snap.providerCoverage && snap.capabilities && snap.capabilities.actions.indexOf('pullProviders') >= 0
        && snap.providerCoverage.providers[0] && snap.providerCoverage.providers[0].name === 'Smith, Adam');
    });
    scenario('C1 the snapshot carries providerCoverage + capabilities in a real page', snapOk);

    // a REAL button tap runs the pull, exactly once, verified provider only
    await page.evaluate(() => {
      const btn = document.createElement('button');
      btn.id = 'offer'; btn.textContent = 'Pull the missing providers';
      btn.addEventListener('click', () => {
        window.__mlsCopilotPower.run('pullProviders', '{"providers":["Smith, Adam","Ghost, Doc"],"date":"2026-08-01"}', btn);
      });
      document.getElementById('host').appendChild(btn);
    });
    await page.click('#offer');
    await page.waitForFunction(() => window.__mlsSaid.some((t) => /Provider pull finished/.test(t)), null, { timeout: 5000 });
    const pullFacts = await page.evaluate(() => ({
      pulls: window.__mlsPulls.map((p) => ({ key: p.provider && p.provider.stableKey, date: p.date, hist: p.includeHistory })),
      finalSay: window.__mlsSaid[window.__mlsSaid.length - 1]
    }));
    const pullOk = pullFacts.pulls.length === 1 && pullFacts.pulls[0].key === 'athena:smith, adam'
      && pullFacts.pulls[0].date === '2026-08-01' && pullFacts.pulls[0].hist === true
      && /2 added/.test(pullFacts.finalSay) && /Ghost, Doc/.test(pullFacts.finalSay);
    scenario('C2 tapped offer pulls ONLY the verified provider with honest receipts', pullOk, pullOk ? null : JSON.stringify(pullFacts).slice(0, 300));

    const busyOk = await page.evaluate(() => {
      window.__mlsDayHistoryPull.state.running = true;
      const before = window.__mlsPulls.length;
      const started = window.__mlsCopilotPower.run('pullProviders', '{"providers":["Smith, Adam"]}', null);
      window.__mlsDayHistoryPull.state.running = false;
      return started === false && window.__mlsPulls.length === before;
    });
    scenario('C3 a busy engine refuses a second pull', busyOk);

    const draftOk = await page.evaluate(() => {
      const r = window.__mlsCopilotPower.run('draftNote', 'p-17', null);
      return r === true && window.__mlsSelected === 'p-17' && window.__mlsPrepped === 'p-17';
    });
    scenario('C4 draftNote selects the exact patient and opens op-note prep', draftOk);
    await context.close();
  } catch (e) { scenario('C copilot power', false, String(e && e.message).slice(0, 300)); }

  report.servedAssets = Array.from(servedSeen.values());
  /* EVIDENCE NEGATIVE CONTROL: the harness proves its own instrument — the
     served-asset census must contain the three assets this run executed, with
     hashes matching the tree, or every green above is untrustworthy. */
  const mustServe = ['patient-portal.html', 'feat_mls_avatar.js', 'feat_mls_copilot_power.js'];
  for (const asset of mustServe) {
    const row = report.servedAssets.find((r) => r.path === asset);
    const disk = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex');
    if (!row || row.sha256 !== disk) failures.push('EVIDENCE-CONTROL: ' + asset + ' not served or hash mismatch');
  }

  await browser.close();
  server.close();
  report.status = failures.length ? 'FAIL' : 'PASS';
  if (failures.length) console.error('FAILURES:\n  ' + failures.join('\n  '));
  reportStatus(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); reportStatus(2); });
