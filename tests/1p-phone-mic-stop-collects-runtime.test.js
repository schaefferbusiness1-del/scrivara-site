'use strict';

/* 1p-phone-mic-stop-collects-runtime  (micfix-1.0.0, 2026-09-24;
 * micfix-1.1.0 and micfix-1.2.0, 2026-09-25)
 * ============================================================================
 * The desktop side of "Record on phone" in the real 1p shell, in Chromium at
 * 1400x900. The paired phone (phone.html) is simulated at the server: the stub
 * below stores a clip's words exactly when a real phone's clip would land.
 * The stub runs in two shapes: CONTRACT (micfix-1.2.0: one row per clip, read
 * back in ARRIVAL order by every reader; an ended session stays readable for
 * a while and says ended:true; Stop answers the final transcript; a phone
 * clip after the end is a 410) and LEGACY (today's server: arrival order;
 * Stop deletes; a missing session is a 404). Either can fail the desktop's
 * reads (getFail) or its Stop (stopFail), as a network drop would.
 *
 *  A  Stop phone mic reads once more, waits a few seconds for a clip still in
 *     flight (saying so), reads again, and only then closes the session: text
 *     stored since the last 3 s read AND a clip landing after the press reach
 *     the visit. (findings 1 / 9 / 16)
 *  B  After Stop, Record on phone never shows the dead code as Ready; it pairs
 *     again. (finding 11)
 *  C  Try again closes the live code first (its last words still land), then
 *     takes a new one; the phone on the old code is told on its next clip.
 *     (finding 8)
 *  D  A session the server no longer has (410, or an older server's 404) ends
 *     the phone link on the computer, so the shared-computer idle lock works
 *     again; so does a session the server has let expire. (finding 13)
 *  E  New visit while the phone records does not empty the visit: it closes
 *     the phone link first and every word lands in this visit. (finding 9)
 *  F  Switching appointment while the phone records follows the in-app
 *     recorder's rule: the tap waits behind a Stop-first question, and the
 *     patient lock refuses a direct switch. (finding 15)
 *  H  A clip the server stores between the last read and Stop still reaches
 *     the visit, from Stop's own answer. (contract O3)
 *  I  Stop (the Easy pause/stop) never says everything is saved while the
 *     phone's last words are still being collected, and a second press
 *     during that Stop is ignored. (C5)
 *  (D, contract) A session that ends on the server answers ended:true with its
 *     last words: they are added, then the link ends.
 *  J  When the last reads and Stop fail, Stop says the phone's last words may
 *     be missing, never that everything is in the transcript; when Stop's own
 *     answer carries the transcript, failed reads cost nothing. (A4)
 *  K  The visit's "Pause recording" pill with only the phone link live stops
 *     that link, as the popup's Stop does: it never starts this computer's
 *     own recorder or re-binds the visit, and every word lands. (A6)
 *  M  When the open visit changes under a live phone link, the doctor is told
 *     at once, not only at Stop. (A6)
 *
 * Run: node tests/1p-phone-mic-stop-collects-runtime.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BK = 'https://scrivara-backend.onrender.com';
const USER = { id: 'harness', email: 'ui-harness@mlsscribe.test', role: 'doctor', name: 'Sample Provider, MD', premium: true, hasAccess: true, agreements: { required: false, signerComplete: true } };
const CLUNKY = fs.readFileSync(path.join(ROOT, 'tests/1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + CLUNKY.slice(CLUNKY.indexOf('function harness() {'), CLUNKY.indexOf('async function boot(page, port)')).trim() + ')()';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.deepStrictEqual(a, b, msg); }

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* The mic routes. log holds every desktop request in order. */
function makeBackend(mode) {
  const be = { mode, log: [], sessions: new Map(), n: 0, getHook: null, stopHook: null, getFail: false, stopFail: false };
  be.session = code => be.sessions.get(code);
  /* A phone clip lands: its words. */
  be.say = (code, text) => { const s = be.sessions.get(code); if (s && !s.ended) s.rows.push({ text }); };
  be.end = code => { const s = be.sessions.get(code); if (s) s.ended = true; };
  /* every reader gets the words in the order they arrived */
  be.text = code => { const s = be.sessions.get(code); return s ? s.rows.map(r => r.text + ' ').join('') : ''; };
  /* What the phone would be answered for a clip now. */
  be.phoneClip = code => {
    const s = be.sessions.get(code);
    if (mode === 'legacy') return (s && !s.ended) ? 200 : 404;
    if (!s) return 404;
    return s.ended ? 410 : 200;
  };
  be.gets = code => be.log.filter(l => l.m === 'GET' && l.code === code);
  be.route = async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    let m;
    if (url.pathname === '/api/mic/start' && method === 'POST') {
      const code = 'PH' + String(++be.n).padStart(4, '0');
      be.sessions.set(code, { rows: [], ended: false });
      be.log.push({ t: Date.now(), m: 'START', code });
      return json(200, { code, expires_at: new Date(Date.now() + 7200e3).toISOString() });
    }
    if ((m = url.pathname.match(/^\/api\/mic\/([A-Z0-9]+)\/stop$/)) && method === 'POST') {
      const code = m[1], s = be.sessions.get(code);
      be.log.push({ t: Date.now(), m: 'STOP', code, failed: be.stopFail });
      if (be.stopFail) return route.abort('internetdisconnected');
      if (!s) return json(404, { error: 'Session not found.' });
      if (mode === 'legacy') { be.sessions.delete(code); return json(200, { ok: true }); }
      if (be.stopHook) { const h = be.stopHook; be.stopHook = null; h(code); }
      s.ended = true;
      return json(200, { ok: true, transcript: be.text(code), ended: true });
    }
    if ((m = url.pathname.match(/^\/api\/mic\/([A-Z0-9]+)$/)) && method === 'GET') {
      const code = m[1], s = be.sessions.get(code);
      const entry = { t: Date.now(), m: 'GET', code, status: 200, transcript: '' };
      be.log.push(entry);
      if (be.getFail) { entry.status = 'failed'; return route.abort('internetdisconnected'); }
      if (!s || (mode === 'legacy' && s.ended)) { entry.status = 404; return json(404, { error: 'Session not found.' }); }
      entry.transcript = be.text(code);
      if (be.getHook) { const h = be.getHook; be.getHook = null; setTimeout(() => h(code), 0); }
      if (mode === 'legacy') return json(200, { transcript: entry.transcript, updated_at: new Date().toISOString() });
      return json(200, { transcript: entry.transcript, updated_at: new Date().toISOString(), ended: !!s.ended });
    }
    if (/\/api\/me(\?|$)/.test(url.pathname) || /\/api\/auth\/me\b/.test(url.pathname)) return json(200, { user: Object.assign({ access: 'premium', totp_enabled: false }, USER) });
    if (/\/api\/auth\/2fa\/status/.test(url.pathname)) return json(200, { enabled: false });
    if (/\/api\/keys\b/.test(url.pathname)) return json(200, { keys: [] });
    if (/\/api\/emr-sync\/settings/.test(url.pathname)) return json(200, { enabled: false, hour: 2, includeHistory: true, connected: false });
    if (/\/api\/avatar\/checkins/.test(url.pathname)) return json(200, { ok: true, checkins: [] });
    if (/\/api\/health\b/.test(url.pathname)) return json(200, { ok: true });
    if (/\/api\/agreements\/me(\?|$)/.test(url.pathname)) return json(200, { signed: true, version: '2026-06-10' });
    if (/\/api\/prefs(\?|$)/.test(url.pathname)) return json(200, { prefs: {} });
    if (/consent/i.test(url.pathname) && method === 'POST') return json(200, { ok: true });
    return route.fulfill({ status: 503, body: 'x' });
  };
  return be;
}

async function until(what, fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error('timed out waiting for ' + what);
}

async function boot(browser, origin, be) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(['microphone'], { origin });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('sf_session', 'ui-harness@mlsscribe.test'); sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {} });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(String(e.message).slice(0, 200)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, be.route);
  await page.goto(origin + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 90000 });
  await page.waitForTimeout(4000);
  await page.evaluate(user => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
    try { bkUser = user; } catch (e) {}
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
    try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
  }, USER);
  await page.waitForTimeout(2500);
  await page.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
  await page.evaluate(HARNESS);
  await page.evaluate(() => window.__clunky.seed());
  await page.evaluate(() => {
    window.__said = [];
    const t0 = window.toast;
    window.toast = function (m) { window.__said.push(String(m)); return t0 && t0.apply(this, arguments); };
  });
  /* the day's schedule: two synthetic appointments for today */
  await page.evaluate(() => {
    const day = (typeof _acctTodayKey === 'function') ? _acctTodayKey() : new Date().toISOString().slice(0, 10);
    const pts = getPatients();
    window._calAppts = pts.slice(0, 4).map((p, i) => ({
      id: 'appt-t' + i, athena_appointment_id: String(81000 + i), name: p.name, dob: p.dob, mrn: p.mrn, athenaId: p.athenaId, appt_date: day, day_local: day,
      start_at: day + 'T' + String(9 + i).padStart(2, '0') + ':00:00', reason: 'Follow up', providerName: 'Sample Provider, MD'
    }));
    try { if (window.__mlsDaySwitch && typeof window.__mlsDaySwitch.setDay === 'function') window.__mlsDaySwitch.setDay(day); } catch (e) {}
    try { window.dispatchEvent(new Event('mls:calendar-updated')); } catch (e) {}
  });
  await dismiss(page);
  return { ctx, page };
}

async function dismiss(page) {
  for (let i = 0; i < 6; i++) {
    const hit = await page.evaluate(() => {
      const vis = x => x && x.offsetParent;
      const btns = [...document.querySelectorAll('button')];
      const pick = btns.find(x => vis(x) && (/Use faster day-only pulls|^No, it is mine$|^Choose later$|^Got it$|^Not now$/.test(x.textContent.trim()) ||
        (/^Later$/.test(x.textContent.trim()) && /MLS Assist is not installed/.test(((x.parentElement && x.parentElement.parentElement) || x).textContent))));
      if (pick) pick.click();
      return !!pick;
    });
    if (!hit && i > 2) break;
    await page.waitForTimeout(300);
  }
}

/* Open appointment 0 through the Easy engine, then the Visit shortcuts. */
async function openVisit(page) {
  const opened = await page.evaluate(() => {
    const r = window.__mlsEasyV32 && window.__mlsEasyV32.remote;
    return !!(r && r.startVisitFor('appt-t0', {}));
  });
  ok(opened, 'the synthetic appointment could not be opened');
  await page.waitForTimeout(2500);
  await dismiss(page);
  await until('Ada is the active patient', () => page.evaluate(() => (activePatient() || {}).name === 'Ada Sample'));
}

async function openPhonePopup(page) {
  const chip = page.locator('.ez3fl-qchip', { hasText: /Record on phone/i }).filter({ visible: true }).first();
  if (!(await chip.isVisible().catch(() => false))) {
    await page.locator('#ez3flToolsToggle').click();
    await page.waitForTimeout(800);
  }
  await chip.click();
  await page.waitForTimeout(800);
  if (await page.locator('#_mlsAskYes').isVisible().catch(() => false)) await page.locator('#_mlsAskYes').click();
}

const popupStatus = page => page.evaluate(() => {
  const s = document.querySelector('[data-qtp-phone-status]'), c = document.querySelector('[data-qtp-phone-code]');
  return s ? { status: s.textContent, code: c ? c.textContent : '' } : null;
});
const deskState = page => page.evaluate(() => ({
  code: phoneMicCode, transcript: document.getElementById('transcript').value,
  active: (activePatient() || {}).name || '', said: window.__said.slice(-6),
  confirm: (document.getElementById('ez3Confirm') || {}).innerText || ''
}));
async function popupButton(page, name) {
  return page.locator('.mls-qtp-foot button', { hasText: name }).filter({ visible: true }).first();
}

/* Wait for the desktop's 3 s read, then run fn right after it. */
async function rightAfterARead(page, be, code, fn) {
  const n = be.gets(code).length;
  await until('a desktop read of ' + code, () => be.gets(code).length > n, 8000);
  await fn();
}

/* Pair a new code through the real popup (a trusted click). On a build
   whose popup offers a dead code as Ready, Try again is the way out. */
async function pair(page, be, notCode) {
  await openPhonePopup(page);
  let d = await until('a paired code', async () => { const x = await deskState(page); return x.code && x.code !== notCode && x; }, 4000).catch(() => null);
  if (!d) {
    await (await popupButton(page, 'Try again')).click();
    d = await until('a paired code after Try again', async () => { const x = await deskState(page); return x.code && x.code !== notCode && x; }, 20000);
  }
  return d;
}
async function closePopup(page) {
  const close = await popupButton(page, 'Close');
  if (await close.isVisible().catch(() => false)) await close.click();
}
/* Between scenarios: no popup, no phone link, Ada's visit open. */
async function reset(page) {
  await page.evaluate(() => { const o = document.getElementById('mlsQtpModal') || document.querySelector('.mls-qtp-overlay'); if (o) o.remove(); const c = document.getElementById('ez3Confirm'); if (c) c.remove(); });
  await page.evaluate(() => { try { if (phoneMicCode) stopPhoneMic({ now: true }); } catch (e) {} });
  await until('no phone link', async () => !(await deskState(page)).code, 15000);
}

/* ---- A: Stop collects what the phone already sent ------------------------ */
async function stopCollects(page, be, mode) {
  const a = await pair(page, be, '');
  await until('the popup says Ready', async () => { const p = await popupStatus(page); return p && /^Ready/.test(p.status) && p.code === a.code; });
  be.say(a.code, 'Knee pain for two weeks.');
  await until('the first clip reached the visit', async () => /Knee pain for two weeks\./.test((await deskState(page)).transcript));
  await rightAfterARead(page, be, a.code, async () => {
    be.say(a.code, 'Worse on stairs.');                                /* stored, not read yet */
    await (await popupButton(page, 'Stop phone mic')).click();
    setTimeout(() => be.say(a.code, 'Plan: physical therapy.'), 1500); /* a clip still in flight */
  });
  const closing = await until('the popup says it is closing', async () => { const p = await popupStatus(page); return p ? (/Closing the phone link/.test(p.status) && p) : 'closed'; }, 3000).catch(() => null);
  const gone = await until('the phone link closed', async () => { const d = await deskState(page); return !d.code && d; }, 15000);
  const stopAt = be.log.findIndex(l => l.m === 'STOP' && l.code === a.code);
  ok(stopAt >= 0, `${mode} A: Stop never closed the session`);
  const lastRead = be.log.slice(0, stopAt).filter(l => l.m === 'GET' && l.code === a.code).pop();
  ok(lastRead && /Plan: physical therapy\./.test(lastRead.transcript), `${mode} A: the session was closed before a read that included the clip in flight`);
  ok(/Knee pain for two weeks\.\s+Worse on stairs\.\s+Plan: physical therapy\./.test(gone.transcript), `${mode} A: the visit lost words the phone sent: ${JSON.stringify(gone.transcript)}`);
  ok(closing === 'closed' || (closing && /Closing the phone link/.test(closing.status)) || gone.said.some(s => /adding the last words/i.test(s)), `${mode} A: the grace before closing was not visible`);
  ok(gone.said.some(s => /Phone mic stopped/.test(s)), `${mode} A: Stop did not say it finished: ${JSON.stringify(gone.said)}`);
  eq(await page.evaluate(() => document.getElementById('phoneMicCode').textContent), '------', `${mode} A: the dead code stayed on the page`);
}

/* ---- B: Record on phone pairs again; the dead code is never Ready -------- */
async function deadCodeNeverReady(page, be, mode) {
  const old = await pair(page, be, '');
  await closePopup(page);
  await page.evaluate(() => stopPhoneMic());
  await until('the link closed', async () => !(await deskState(page)).code, 15000);
  const startsBefore = be.log.filter(l => l.m === 'START').length;
  await openPhonePopup(page);
  const first = await popupStatus(page);
  ok(!(first && /^Ready/.test(first.status) && first.code === old.code), `${mode} B: the popup offered the stopped code ${old.code} as Ready`);
  const b = await until('a new pairing', async () => { const d = await deskState(page); return d.code && d.code !== old.code && d; }, 8000).catch(() => null);
  ok(b && be.log.filter(l => l.m === 'START').length === startsBefore + 1, `${mode} B: Record on phone did not start a new session`);
  if (b) await until('the popup says Ready with the new code', async () => { const p = await popupStatus(page); return p && /^Ready/.test(p.status) && p.code === b.code; });
}

/* ---- C: Try again closes the live code first ----------------------------- */
async function tryAgainClosesOld(page, be, mode) {
  const b = await pair(page, be, '');
  be.say(b.code, 'Second link words.');
  await until('the second link reached the visit', async () => /Second link words\./.test((await deskState(page)).transcript));
  await rightAfterARead(page, be, b.code, async () => {
    be.say(b.code, 'Said just before Try again.');
    await (await popupButton(page, 'Try again')).click();
  });
  const c = await until('a new code', async () => { const d = await deskState(page); return d.code && d.code !== b.code && d; }, 20000);
  const stopB = be.log.findIndex(l => l.m === 'STOP' && l.code === b.code);
  const startC = be.log.findIndex(l => l.m === 'START' && l.code === c.code);
  ok(stopB >= 0 && stopB < startC, `${mode} C: Try again left code ${b.code} open`);
  ok(/Said just before Try again\./.test(c.transcript), `${mode} C: words sent to the old code before Try again were lost: ${JSON.stringify(c.transcript)}`);
  ok([404, 410].includes(be.phoneClip(b.code)), `${mode} C: a phone still on the old code would be told it uploaded`);
}

/* ---- D: a session the server no longer has ends the link ----------------- */
async function endedSessionEndsLink(page, be, mode) {
  const c = await pair(page, be, '');
  await until('the popup says Ready', async () => { const p = await popupStatus(page); return p && /^Ready/.test(p.status) && p.code === c.code; });
  await rightAfterARead(page, be, c.code, async () => {
    if (mode === 'contract') be.say(c.code, 'Last words before it ended.');
    be.end(c.code);
  });
  const d1 = await until('the ended session noticed', async () => { const d = await deskState(page); return !d.code && d; }, 10000).catch(() => null);
  ok(d1, `${mode} D: the computer kept the link of a session the server has ended (${mode === 'legacy' ? '404' : 'ended:true'})`);
  if (d1 && mode === 'contract') ok(/Last words before it ended\./.test(d1.transcript), `contract D: the last words of an ended session never reached the visit: ${JSON.stringify(d1.transcript)}`);
  if (d1) ok(d1.said.some(s => /phone recording link has ended/.test(s)), `${mode} D: the end of the phone link was not said: ${JSON.stringify(d1.said)}`);
  await sleep(600);
  const p = await popupStatus(page);
  ok(p && !/^Ready/.test(p.status) && /phone link has ended/.test(p.status), `${mode} D: the open popup still offers the ended code: ${JSON.stringify(p)}`);
  await closePopup(page);
  const readsAfter = be.gets(c.code).length;
  await sleep(4000);
  eq(be.gets(c.code).length, readsAfter, `${mode} D: the computer kept polling a session the server no longer has`);
  const idleExempt = await page.evaluate(() => (typeof capturing !== 'undefined' && capturing) || !!phoneMicCode);
  eq(idleExempt, false, `${mode} D: the idle sign-out would still be skipped`);
}
async function expiredSessionEndsLink(page, be, mode) {
  const d2 = await pair(page, be, '');
  await closePopup(page);
  await page.evaluate(() => { phoneMicStartedAt = Date.now() - 2 * 60 * 60 * 1000 - 5000; phoneMicGrewAt = 0; });
  const gone = await until('the expired link closed', async () => !(await deskState(page)).code, 15000).catch(() => false);
  ok(gone, `${mode} D: a link with no new words for 2 h stayed open, so the idle sign-out stays off`);
  ok(be.log.some(l => l.m === 'STOP' && l.code === d2.code), `${mode} D: the expired link was not closed on the server`);
}

/* ---- E: New visit while the phone records -------------------------------- */
async function newVisitWaits(page, be, mode) {
  const e = await pair(page, be, '');
  await closePopup(page);
  be.say(e.code, 'Before new visit.');
  await until('the link reached the visit', async () => /Before new visit\./.test((await deskState(page)).transcript));
  let refused;
  await rightAfterARead(page, be, e.code, async () => {
    be.say(e.code, 'Unread at new visit.');
    refused = await page.evaluate(() => newVisit());
    setTimeout(() => be.say(e.code, 'In flight at new visit.'), 1500);
  });
  const e1 = await deskState(page);
  eq(refused, false, `${mode} E: New visit did not wait for the phone`);
  ok(/Before new visit\./.test(e1.transcript), `${mode} E: New visit emptied the visit while the phone was still sending`);
  const e2 = await until('the phone link closed', async () => { const d = await deskState(page); return !d.code && d; }, 15000);
  ok(/Before new visit\.\s+Unread at new visit\.\s+In flight at new visit\./.test(e2.transcript), `${mode} E: words the phone sent were lost: ${JSON.stringify(e2.transcript)}`);
}

/* ---- F: no patient switch while the phone records ------------------------ */
async function noSwitchWhileRecording(page, be, mode) {
  await openVisit(page);
  const f = await pair(page, be, '');
  await closePopup(page);
  const locked = await page.evaluate(() => window.__mlsPatientLock.switchAsDoctor(getPatients()[1].id));
  eq(locked, false, `${mode} F: the patient lock let a switch through while the phone records`);
  await page.evaluate(() => window.__mlsEasyV32.remote.startVisitFor('appt-t1', {}));
  await page.waitForTimeout(800);
  const f1 = await deskState(page);
  eq(f1.active, 'Ada Sample', `${mode} F: switched patients while the phone records`);
  ok(/Still recording/.test(f1.confirm), `${mode} F: no stop-first question: ${JSON.stringify(f1.confirm)}`);
  ok(!be.log.some(l => l.m === 'STOP' && l.code === f.code), `${mode} F: the phone session was closed by a refused switch`);
  be.say(f.code, 'Said before the switch.');
  await page.locator('#ez3Confirm button', { hasText: /Stop recording/ }).first().click();
  await until('the switch completed after the phone link closed', async () => { const d = await deskState(page); return !d.code && d.active === 'Bo Sample'; }, 30000);
  const stopF = be.log.findIndex(l => l.m === 'STOP' && l.code === f.code);
  const lastF = be.log.slice(0, stopF).filter(l => l.m === 'GET' && l.code === f.code).pop();
  ok(lastF && /Said before the switch\./.test(lastF.transcript), `${mode} F: the phone link closed before its last words were read`);
}

/* ---- H: Stop's own answer carries the last clip -------------------------- */
async function stopAnswerClosesGap(page, be, mode) {
  const h = await pair(page, be, '');
  await closePopup(page);
  be.say(h.code, 'Before the stop.');
  await until('the first clip reached the visit', async () => /Before the stop\./.test((await deskState(page)).transcript));
  be.stopHook = code => be.say(code, 'Stored as the stop arrived.');
  await page.evaluate(() => stopPhoneMic());
  const d = await until('the phone link closed', async () => { const x = await deskState(page); return !x.code && x; }, 15000);
  ok(/Before the stop\.\s+Stored as the stop arrived\./.test(d.transcript), `${mode} H: a clip stored between the last read and Stop never reached the visit: ${JSON.stringify(d.transcript)}`);
}

/* Every line the Easy engine's toast shows, and whether the phone link was open then. */
async function watchEasyToasts(page) {
  await page.evaluate(() => {
    let el = document.getElementById('ez3Toast');
    if (!el) { el = document.createElement('div'); el.id = 'ez3Toast'; document.body.appendChild(el); }
    window.__easyToasts = [];
    if (!el.__mlsObs) {
      el.__mlsObs = new MutationObserver(() => window.__easyToasts.push({ text: el.textContent, linkOpen: !!phoneMicCode }));
      el.__mlsObs.observe(el, { childList: true, characterData: true, subtree: true });
    }
  });
}

/* ---- I: Stop says done only when done ------------------------------------ */
async function stopSaysDoneOnlyWhenDone(page, be, mode) {
  const i = await pair(page, be, '');
  await closePopup(page);
  be.say(i.code, 'Words before the stop.');
  await until('the words reached the visit', async () => /Words before the stop\./.test((await deskState(page)).transcript));
  await watchEasyToasts(page);
  await rightAfterARead(page, be, i.code, async () => {
    /* one press, and a second activation in the same task (a double click) */
    await page.evaluate(() => { window.__mlsEasyV32.remote.stopRecording(); window.__mlsEasyV32.remote.stopRecording(); });
    setTimeout(() => be.say(i.code, 'A clip still in flight at the stop.'), 1500);
  });
  const d = await until('the phone link closed', async () => { const x = await deskState(page); return !x.code && x; }, 20000);
  await sleep(600);
  const toasts = await page.evaluate(() => window.__easyToasts.slice());
  const done = toasts.filter(t => /Everything captured is/.test(t.text));
  eq(done.filter(t => t.linkOpen).map(t => t.text), [], `${mode} I: Stop said everything was saved while the phone's last words were still being collected`);
  eq(done.length, 1, `${mode} I: the finished stop was not said exactly once: ${JSON.stringify(toasts)}`);
  eq(toasts.filter(t => /Finishing the recording/.test(t.text)).length, 1, `${mode} I: a second press during the stop was not ignored: ${JSON.stringify(toasts)}`);
  ok(/A clip still in flight at the stop\./.test(d.transcript), `${mode} I: the clip in flight at the stop was lost: ${JSON.stringify(d.transcript)}`);
}

/* ---- J: Stop never claims what it did not see ---------------------------- */
async function stopSaysWhatItDidNotSee(page, be, mode) {
  const failed = [];
  try {
    const j = await pair(page, be, '');
    await closePopup(page);
    be.say(j.code, 'Words the computer read.');
    await until('the words reached the visit', async () => /Words the computer read\./.test((await deskState(page)).transcript));
    await watchEasyToasts(page);
    const saidAt = await page.evaluate(() => window.__said.length);
    be.getFail = true; be.stopFail = true;
    be.say(j.code, 'Words the computer never read.');
    const out = await page.evaluate(() => stopPhoneMic());
    await until('the phone link closed', async () => !(await deskState(page)).code, 20000);
    be.getFail = false; be.stopFail = false;
    const said = await page.evaluate(n => window.__said.slice(n), saidAt);
    eq(out, false, `${mode} J: Stop answered that everything landed though its last reads and Stop failed`);
    ok(said.some(x => /may be missing/.test(x)), `${mode} J: Stop did not say the phone's last words may be missing: ${JSON.stringify(said)}`);
    ok(!said.some(x => /The words the phone sent are in the transcript/.test(x)), `${mode} J: Stop said the phone's words are in the transcript though it never saw the last ones: ${JSON.stringify(said)}`);
    /* the same, from the Easy engine's own Stop */
    const j2 = await pair(page, be, j.code);
    await closePopup(page);
    be.say(j2.code, 'More words the computer read.');
    await until('the words reached the visit', async () => /More words the computer read\./.test((await deskState(page)).transcript));
    await page.evaluate(() => { window.__easyToasts.length = 0; });
    be.getFail = true; be.stopFail = true;
    await page.evaluate(() => window.__mlsEasyV32.remote.stopRecording());
    await until('the phone link closed', async () => !(await deskState(page)).code, 20000);
    await sleep(600);
    be.getFail = false; be.stopFail = false;
    const toasts = await page.evaluate(() => window.__easyToasts.map(t => t.text));
    eq(toasts.filter(t => /Everything captured is/.test(t)), [], `${mode} J: the Easy Stop said everything was captured though its last reads and Stop failed`);
  } catch (e) { failed.push('reads and Stop fail: ' + String(e && e.message || e).split('\n')[0].slice(0, 600)); }
  be.getFail = false; be.stopFail = false;
  await reset(page).catch(() => {});
  if (mode === 'contract') {
    try {
      /* the reads fail; Stop's own answer carries every word */
      const k = await pair(page, be, '');
      await closePopup(page);
      be.say(k.code, 'Read before the drop.');
      await until('the words reached the visit', async () => /Read before the drop\./.test((await deskState(page)).transcript));
      be.getFail = true;
      be.say(k.code, 'Never read, answered by Stop.');
      const saidAt = await page.evaluate(() => window.__said.length);
      const out = await page.evaluate(() => stopPhoneMic());
      const d = await until('the phone link closed', async () => { const x = await deskState(page); return !x.code && x; }, 20000);
      be.getFail = false;
      const said = await page.evaluate(n => window.__said.slice(n), saidAt);
      ok(/Read before the drop\.\s+Never read, answered by Stop\./.test(d.transcript), `contract J: Stop's own answer did not bring the words the failed reads missed: ${JSON.stringify(d.transcript)}`);
      eq(out, true, `contract J: a Stop that saw every word (in its own answer) did not say so`);
      ok(said.some(x => /Phone mic stopped\. The words the phone sent are in the transcript/.test(x)), `contract J: a Stop that saw every word did not say so: ${JSON.stringify(said)}`);
    } catch (e) { failed.push('reads fail, Stop answers: ' + String(e && e.message || e).split('\n')[0].slice(0, 600)); }
    be.getFail = false;
  }
  if (failed.length) throw new Error(failed.join(' || '));
}

/* ---- K: the Pause pill stops a phone link -------------------------------- */
async function pausePillStopsThePhone(page, be, mode) {
  await openVisit(page);
  const k = await pair(page, be, '');
  await closePopup(page);
  be.say(k.code, 'Before the pause.');
  await until('the words reached the visit', async () => /Before the pause\./.test((await deskState(page)).transcript));
  const pill = page.locator('.ez3fl-recbtn').filter({ visible: true }).first();
  await until('the pill reads Pause recording', async () => /Pause recording/.test(await pill.textContent().catch(() => '')), 8000);
  const before = await page.evaluate(() => ({ epoch: currentVisitAthenaEpoch, binding: currentVisitAthenaBinding && currentVisitAthenaBinding.id }));
  await rightAfterARead(page, be, k.code, async () => {
    be.say(k.code, 'Said just before the pause.');
    await pill.click();
    setTimeout(() => be.say(k.code, 'In flight at the pause.'), 1500);
  });
  const samples = [];
  const d = await until('the phone link closed', async () => {
    const x = await page.evaluate(() => ({ code: phoneMicCode, capturing: typeof capturing !== 'undefined' && !!capturing, rec: !!(document.getElementById('captureBtn') || { classList: { contains: () => false } }).classList.contains('recording'), epoch: currentVisitAthenaEpoch }));
    samples.push(x);
    return !x.code && x;
  }, 20000).catch(() => null);
  await sleep(1500);
  const after = await page.evaluate(() => ({ capturing: typeof capturing !== 'undefined' && !!capturing, rec: document.getElementById('captureBtn').classList.contains('recording'), epoch: currentVisitAthenaEpoch, binding: currentVisitAthenaBinding && currentVisitAthenaBinding.id, t: document.getElementById('transcript').value }));
  ok(d, `${mode} K: the pill did not stop the phone link`);
  ok(!samples.concat([after]).some(x => x.capturing || x.rec), `${mode} K: the pill started this computer's own recorder while the phone link was live: ${JSON.stringify(samples.concat([after]).filter(x => x.capturing || x.rec).slice(0, 3))}`);
  eq({ epoch: after.epoch, binding: after.binding }, before, `${mode} K: the pill re-bound the visit`);
  ok(/Before the pause\.\s+Said just before the pause\.\s+In flight at the pause\./.test(after.t), `${mode} K: the phone's words did not all reach the visit: ${JSON.stringify(after.t)}`);
  await page.evaluate(() => { try { if (capturing && typeof window.stopCapture === 'function') window.stopCapture(); } catch (e) {} });
}

/* ---- M: a refused read is said at once ----------------------------------- */
async function refusedReadSaidAtOnce(page, be, mode) {
  const m = await pair(page, be, '');
  await closePopup(page);
  be.say(m.code, 'Paired visit words.');
  await until('the words reached the visit', async () => /Paired visit words\./.test((await deskState(page)).transcript));
  const saidAt = await page.evaluate(() => window.__said.length);
  /* the open visit changes under the link (a re-bind this computer made) */
  await page.evaluate(() => { const b = currentVisitAthenaBinding; _athenaSetVisitBinding(Object.assign({}, b, { id: String(b.id) + '-other' }), true); });
  be.say(m.code, 'Words for the paired visit.');
  const told = await until('the doctor is told', async () => { const x = await page.evaluate(n => window.__said.slice(n), saidAt); return x.some(y => /no longer open/.test(y)) && x; }, 8000).catch(() => null);
  const still = await deskState(page);
  ok(told, `${mode} M: the phone's words were refused by the regular read and the doctor was not told (only Stop would say it): ${JSON.stringify(await page.evaluate(n => window.__said.slice(n), saidAt))}`);
  ok(still.code, `${mode} M: the link was closed instead`);
  await sleep(3500);
  const again = await page.evaluate(n => window.__said.slice(n).filter(y => /no longer open/.test(y)).length, saidAt);
  eq(again, 1, `${mode} M: the refused read was said more than once`);
}

/* [name, fn, server shapes it applies to] */
const SCENARIOS = [
  ['A stop collects (1/9/16)', stopCollects],
  ['B dead code never Ready (11)', deadCodeNeverReady],
  ['C Try again closes the old code (8)', tryAgainClosesOld],
  ['D ended session ends the link (13)', endedSessionEndsLink],
  ['D expired session ends the link (13)', expiredSessionEndsLink],
  ['E New visit waits for the phone (9)', newVisitWaits],
  ['F no switch while the phone records (15)', noSwitchWhileRecording],
  ['H Stop answers the last clip (O3)', stopAnswerClosesGap, ['contract']],
  ['I Stop says done only when done (C5)', stopSaysDoneOnlyWhenDone],
  ['J Stop never claims what it did not see (A4)', stopSaysWhatItDidNotSee],
  ['K the Pause pill stops a phone link (A6)', pausePillStopsThePhone],
  ['M a refused read is said at once (A6)', refusedReadSaidAtOnce]
];

async function run(browser, origin, mode, failures) {
  const be = makeBackend(mode);
  const { ctx, page } = await boot(browser, origin, be);
  try {
    await openVisit(page);
    /* ONLY=A,C runs the named scenarios (letters) on their own. */
    const only = String(process.env.ONLY || '').split(',').filter(Boolean);
    for (const [name, fn] of SCENARIOS.filter(([n, , modes]) => (!only.length || only.includes(n[0])) && (!modes || modes.includes(mode)))) {
      const before = checks;
      try { await fn(page, be, mode); console.log(`  ok   ${mode}: ${name} (${checks - before} checks)`); }
      catch (e) { failures.push(`${mode}: ${name}: ${String(e && e.message || e).split('\n')[0]}`); console.log(`  FAIL ${mode}: ${name}: ${String(e && e.message || e).split('\n')[0].slice(0, 300)}`); }
      await reset(page).catch(() => {});
    }
    eq(page.__errors, [], `${mode}: page errors`);
  } finally { await ctx.close(); }
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const failures = [];
    const modes = String(process.env.MODES || 'contract,legacy').split(',').filter(Boolean);
    for (const mode of modes) await run(browser, origin, mode, failures);
    assert.deepStrictEqual(failures, [], failures.join('\n'));
    console.log(`PASS phone mic Stop collects every clip before closing (desktop 1400x900, contract + legacy servers): ${checks} checks`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
