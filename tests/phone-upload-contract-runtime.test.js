'use strict';

/* phone-upload-contract-runtime  (micfix-1.0.0, 2026-09-24; micfix-1.1.0 and
 * micfix-1.2.0, 2026-09-25)
 * ============================================================================
 * The standalone phone recorder (phone.html) in real Chromium at 390x844 with
 * Chrome's fake microphone and real MediaRecorder clips. The backend is a stub
 * in this file, in two shapes:
 *
 *  CONTRACT  the micfix-1.2.0 upload contract. Each accepted clip is its own
 *            row (t, clipId, the time its request arrived); the transcript is
 *            in ARRIVAL order, and t is kept but not sorted by. Every 2xx
 *            carries dedupe:true and echoes the clipId. A repeated clipId
 *            answers 200 {ok:true, duplicate:true}, also after Stop; the same
 *            clipId with another t answers 409 CLIP_ID_REUSED. After Stop, a
 *            clip that was never stored answers 410 MIC_SESSION_ENDED to a
 *            client that sends clipId or t, and 404 to one that sends
 *            neither. 402 NO_ACCESS, 422 AUDIO_UNREADABLE (retryable:false),
 *            404 for a code that was never issued.
 *  LEGACY    today's server: 404 for any missing or ended session, no clipId
 *            dedupe and no dedupe marker, appends in arrival order, 502
 *            retryable:false with an ai-* code on a refusal (ai-quota when
 *            the AI account is out of credit). Each clip takes a place in its
 *            code's line when it arrives and is added and answered only after
 *            every earlier clip of that code; a clip whose sender gave up is
 *            still added.
 *
 * Each clip's Blob is tagged "CLIP<n>|" at creation, so the stub knows which
 * recording each upload is and can check the transcript against the order the
 * clips were recorded in.
 *
 *  A  Done with clips waiting to retry sends them. Every POST carries clipId
 *     and t, and t is the moment that clip's recorder started; retries repeat
 *     both.
 *  B  Done while still offline keeps the clips, says how many wait, keeps the
 *     screen awake, never says Done early, and finishes once they are sent.
 *  C  A clip that fails twice arrives after later clips, and a clip whose
 *     reply was lost is sent again: each clip is in the transcript once, and
 *     t follows the recording order.
 *  D  410 (or today's 404 after an accepted clip) = the session ended:
 *     recording stops, the status says so, the clip is not counted.
 *  D2 A clip that landed but whose reply was lost is sent again after the
 *     desktop pressed Stop: it is answered 'duplicate' and counted as added,
 *     never as 'not added'.
 *  E  Today's 404 before any accepted clip is still "not accepted".
 *  F  retryable:false (422, or today's 502) is never re-sent; recording goes
 *     on, but the status stops saying "talk normally" until a clip lands.
 *  G  A clip that keeps failing with a RETRYABLE answer goes to the back of
 *     the queue and never holds up the clips behind it.
 *  H  An upload that never answers is given up and retried (same clipId, t).
 *  I  A refusal for this account (402 NO_ACCESS, 403) stops recording at
 *     once and says why; the clips are held, not re-sent on their own, and
 *     sent when the doctor taps Record or Done. Record then starts in the
 *     normal colour, not the red of the stop.
 *  J  A late answer for an earlier code never ends, or blames, the current
 *     code, whether it arrives on the code screen or while the next code
 *     records.
 *  K  Done never says Done before the last clip lands (no Done / Not done yet
 *     / Done flicker), and a double press does not lose the last clip.
 *  L  After the phone's clock steps back and the page reloads, the same code
 *     typed again goes on with a later t, never an earlier one.
 *  M  Today's server with one slow transcription: the page waits for the
 *     answers instead of giving up and re-sending, so no clip is added twice
 *     (micfix-1.2.0: attempts are given up only after MLS shows dedupe:true).
 *  N  Two quick taps on Record open ONE microphone, and a Done tapped while
 *     the microphone is being granted leaves no microphone on.
 *  O  While the microphone is being recovered, a clip accepted does not say
 *     'talk normally'; a microphone that comes back after Done is turned off.
 *  Q  Today's ai-quota (MLS cannot transcribe): recording goes on, the status
 *     says how many clips wait, new clips wait behind the first, the first is
 *     retried with a growing wait, and everything is added once MLS can
 *     transcribe again.
 *
 * The page's 8 s segment, 6 s retry (6 s to 60 s in an outage) and 40 s / 330 s
 * upload timeouts are shortened for the run (SEG_MS, UPLOAD_TIMEOUT_MS and
 * NO_DEDUPE_TIMEOUT_MS are page globals; retry timers of 6 s to 60 s are
 * scaled by an init script).
 *
 * Run: node tests/phone-upload-contract-runtime.test.js
 *      ONLY=A,G node tests/phone-upload-contract-runtime.test.js   (a subset)
 *      PHONE_HTML=<file> serves another copy of phone.html (red/green runs).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PHONE_FILE = process.env.PHONE_HTML ? path.resolve(process.env.PHONE_HTML) : path.join(ROOT, 'phone.html');
const BK = 'https://scrivara-backend.onrender.com';
const SEG_MS = 2000;
const RETRY_MS = 3000;
const UPLOAD_TIMEOUT_MS = 2500;
const NO_DEDUPE_TIMEOUT_MS = 20500;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const GREEN = 'rgb(169, 227, 196)';
const AMBER = 'rgb(255, 220, 174)';
const RED = 'rgb(255, 180, 180)';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.deepStrictEqual(a, b, msg); }
const range = n => Array.from({ length: n }, (_, i) => i + 1);
const sorted = a => a.slice().sort((x, y) => x - y);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'phone.html';
    const file = rel === 'phone.html' ? PHONE_FILE : path.resolve(ROOT, rel);
    if (rel !== 'phone.html' && !file.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function clipOf(dataUrl) {
  const b64 = String(dataUrl || '').slice(String(dataUrl || '').indexOf(',') + 1);
  const m = Buffer.from(b64.slice(0, 64), 'base64').toString('latin1').match(/^CLIP(\d+)\|/);
  return m ? Number(m[1]) : 0;
}

/* The backend stub. hook(post) may answer, for one upload: 'offline',
   'lose-reply' (stored, then the connection drops), 'refuse', 'hang' (never
   answers), {gate: promise} (answers when it settles, from the state then),
   {stall: ms} (its transcription takes ms), or {status, json}. net='down'
   fails every request like a dead Wi-Fi.
   refuseAll=true refuses every clip for the account: 402 NO_ACCESS (contract)
   or 502 ai-quota (legacy). afterAnswer(post) runs once a clip is answered. */
function makeBackend(mode) {
  const be = { mode, net: 'up', posts: [], sessions: new Map(), hook: null, refuseAll: false, afterAnswer: null, closed: deferred() };
  be.open = code => be.sessions.set(code, { ended: false, rows: [], ids: new Map(), arrivals: 0 });
  be.end = code => { const s = be.sessions.get(code); if (mode === 'legacy') be.sessions.delete(code); else if (s) s.ended = true; };
  be.accepted = code => be.posts.filter(p => p.code === code && p.status === 200).length;
  be.arrival = code => ((be.sessions.get(code) || { rows: [] }).rows).map(r => r.clip);
  be.transcript = code => {
    const rows = ((be.sessions.get(code) || { rows: [] }).rows).slice();
    if (mode === 'contract') rows.sort((a, b) => a.received - b.received);
    return rows.map(r => r.clip);
  };
  be.answer = (post, body) => {
    const s = be.sessions.get(post.code);
    if (mode === 'legacy') {
      if (!s) return { status: 404, json: { error: 'Session not found or expired.' } };
      if (be.refuseAll) return { status: 502, json: { error: 'The audio could not be transcribed. The AI provider reports this account is out of credit or has hit its quota.', code: 'ai-quota', retryable: false } };
      if (post.hook === 'refuse') return { status: 502, json: { error: 'The audio could not be transcribed.', code: 'ai-unknown', retryable: false } };
      s.rows.push({ clip: post.clip, arrival: ++s.arrivals });
      return { status: 200, json: { ok: true, added: 20 } };
    }
    const newClient = typeof body.clipId === 'string' || body.t != null;
    if (!s) return { status: 404, json: { error: 'Session not found.' } };
    const echo = typeof body.clipId === 'string' ? { clipId: body.clipId } : {};
    if (typeof body.clipId === 'string' && s.ids.has(body.clipId)) {
      if (s.ids.get(body.clipId).t !== body.t) return { status: 409, json: { error: 'This clip id was already used for another clip.', code: 'CLIP_ID_REUSED', retryable: false } };
      return { status: 200, json: { ok: true, duplicate: true, dedupe: true, ...echo } };
    }
    if (s.ended) return newClient ? { status: 410, json: { error: 'This recording session has ended.', code: 'MIC_SESSION_ENDED', retryable: false } } : { status: 404, json: { error: 'Session not found or expired.' } };
    if (be.refuseAll) return { status: 402, json: { error: 'no_access', code: 'NO_ACCESS', retryable: false } };
    if (post.hook === 'refuse') return { status: 422, json: { error: 'This clip could not be read as audio.', code: 'AUDIO_UNREADABLE', retryable: false } };
    const row = { clip: post.clip, t: Number.isFinite(body.t) ? body.t : post.at, received: post.at, arrival: ++s.arrivals };
    s.rows.push(row);
    if (typeof body.clipId === 'string') s.ids.set(body.clipId, row);
    return { status: 200, json: { ok: true, added: 20, dedupe: true, ...echo } };
  };
  be.route = async route => {
    const req = route.request();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
    if (req.method() === 'OPTIONS') return be.net === 'down' ? route.abort('internetdisconnected') : route.fulfill({ status: 204, headers: cors });
    const m = new URL(req.url()).pathname.match(/^\/api\/mic\/([^/]+)\/audio$/);
    if (!m) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
    let body = {};
    try { body = JSON.parse(req.postData() || '{}'); } catch (_) {}
    const post = { at: Date.now(), code: decodeURIComponent(m[1]), clip: clipOf(body.audio), t: body.t, seq: body.seq, clipId: body.clipId, status: 0 };
    post.attempt = be.posts.filter(p => p.code === post.code && p.clip === post.clip).length + 1;
    let h = be.hook ? be.hook(post) : null;
    post.hook = h;
    be.posts.push(post);
    /* Today's server: a clip takes its place in its code's line on arrival. */
    const line = mode === 'legacy' ? be.sessions.get(post.code) : null;
    let release = () => {}, ahead = Promise.resolve();
    if (line) { ahead = line.tail || ahead; const mine = new Promise(resolve => { release = resolve; }); line.tail = ahead.then(() => mine); }
    try {
      if (h && h.gate) { post.status = 'held'; await h.gate; h = h.then || null; post.hook = h; }
      if (h === 'hang') { post.status = 'hung'; await be.closed.promise; try { await route.abort('failed'); } catch (_) {} return; }
      if (be.net === 'down' || h === 'offline') { post.status = 'offline'; return route.abort('internetdisconnected'); }
      if (h && h.status) { post.status = h.status; post.doneAt = Date.now(); return route.fulfill({ status: h.status, headers: cors, contentType: 'application/json', body: JSON.stringify(h.json || {}) }); }
      if (h && h.stall) { post.status = 'transcribing'; await sleep(h.stall); }
      if (line && be.sessions.get(post.code) && !be.refuseAll && h !== 'refuse') await ahead;
      const answer = be.answer(post, body);
      post.status = answer.status; post.doneAt = Date.now(); post.duplicate = !!answer.json.duplicate;
      if (be.afterAnswer) be.afterAnswer(post);
      if (h === 'lose-reply') { post.status = 'reply-lost'; return route.abort('connectionreset'); }
      try { await route.fulfill({ status: answer.status, headers: cors, contentType: 'application/json', body: JSON.stringify(answer.json) }); } catch (_) { post.gaveUp = true; }
    } finally { release(); }
  };
  return be;
}

/* Tags every audio Blob with its recording index (kept across a reload),
   scales the 6 s to 60 s retries, logs the status line and every recorder
   start, stands in a screen wake lock whose holds can be counted, and shifts
   the page's clock by sessionStorage.__clockSkewMs (a clock that stepped). */
function pageInit(retryMs) {
  const NativeBlob = window.Blob;
  const readMade = () => { try { return Number(sessionStorage.getItem('__clipsMade') || 0); } catch (_) { return 0; } };
  function TaggedBlob(parts, options) {
    if (options && /^audio\//.test(String(options.type || ''))) {
      const n = readMade() + 1;
      try { sessionStorage.setItem('__clipsMade', String(n)); } catch (_) {}
      parts = ['CLIP' + n + '|'].concat(parts || []);
    }
    return new NativeBlob(parts, options);
  }
  TaggedBlob.prototype = NativeBlob.prototype;
  window.Blob = TaggedBlob;
  window.__clipsMade = readMade;
  const nativeSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) { return nativeSetTimeout.call(window, fn, ms >= 6000 && ms <= 60000 && ms % 6000 === 0 ? ms / 6000 * retryMs : ms, ...rest); };
  const skew = (() => { try { return Number(sessionStorage.getItem('__clockSkewMs') || 0); } catch (_) { return 0; } })();
  if (skew) { const now = Date.now; Date.now = () => now.call(Date) + skew; }
  window.__starts = [];
  if (window.MediaRecorder) {
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...a) { window.__starts.push(Date.now()); return start.apply(this, a); };
  }
  window.__wake = { held: 0, requests: 0 };
  const fakeWake = {
    request: async () => {
      window.__wake.requests++; window.__wake.held++;
      let released = false; const listeners = [];
      return {
        get released() { return released; },
        addEventListener(type, fn) { if (type === 'release') listeners.push(fn); },
        async release() { if (released) return; released = true; window.__wake.held--; listeners.forEach(fn => fn()); }
      };
    }
  };
  try { Object.defineProperty(Navigator.prototype, 'wakeLock', { configurable: true, get: () => fakeWake }); } catch (_) {}
  window.__statusLog = [];
  document.addEventListener('DOMContentLoaded', () => {
    const s = document.getElementById('status');
    if (s) new MutationObserver(() => window.__statusLog.push([Date.now(), s.textContent, s.style.color])).observe(s, { childList: true, characterData: true, subtree: true, attributes: true });
  });
}

async function tune(page, uploadTimeoutMs = UPLOAD_TIMEOUT_MS, noDedupeTimeoutMs = NO_DEDUPE_TIMEOUT_MS) {
  await page.evaluate(([seg, up, nd]) => { window.SEG_MS = seg; window.UPLOAD_TIMEOUT_MS = up; window.NO_DEDUPE_TIMEOUT_MS = nd; }, [SEG_MS, uploadTimeoutMs, noDedupeTimeoutMs]);
}

async function openPhone(browser, origin, be, code, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA, permissions: ['microphone'] });
  await ctx.addInitScript(pageInit, RETRY_MS);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('pageerror', e => page.__errors.push(e.message));
  await page.route(BK + '/**', be.route);
  await page.goto(`${origin}/phone.html#code=${code}`);
  await page.waitForSelector('#recScreen:not(.hidden)');
  await tune(page, opts.uploadTimeoutMs, opts.noDedupeTimeoutMs);
  const close = async () => { be.closed.resolve(); await ctx.close(); };
  return { ctx, page, close };
}

const ui = page => page.evaluate(() => {
  const el = id => document.getElementById(id) || { textContent: '', style: {} };
  const text = id => el(id).textContent;
  return {
    status: text('status'), statusColor: el('status').style.color || '', sent: text('sent'), recErr: text('recErr'), waitErr: text('waitErr'),
    waitLine: text('recErr') + ' ' + text('waitErr'), pill: text('linkPill'), label: text('recLabel'),
    active: typeof active !== 'undefined' && active === true, micReleased: typeof stream === 'undefined' || stream === null,
    pending: window.__mlsPhoneGuard.pending(), made: window.__clipsMade(), recode: el('recodeBtn').style.display || '',
    recScreen: !document.getElementById('recScreen').classList.contains('hidden'), codeShown: text('codeShown'),
    wakeHeld: window.__wake ? window.__wake.held : 0
  };
});
const statusLog = page => page.evaluate(() => window.__statusLog.map(([t, s, c]) => ({ t, s, c })));

async function until(what, fn, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const doneNow = async page => { const u = await ui(page); return u.pending === 0 && /^Done\. Return to your computer/.test(u.status) && u; };
const lostText = n => (n === 1 ? '1 clip was' : `${n} clips were`) + ' not added';

/* A. Done right after the connection returns, with clips waiting to retry. */
async function doneAfterReconnect(browser, origin) {
  const be = makeBackend('contract'); be.open('DONE01');
  const { page, close } = await openPhone(browser, origin, be, 'DONE01');
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted('DONE01') >= 1);
    be.net = 'down';
    await until('two clips waiting in memory', async () => (await ui(page)).pending >= 2);
    be.net = 'up';
    await page.tap('#doneBtn');
    await until('Done finished', () => doneNow(page));
    await sleep(RETRY_MS + 1000);
    const u = await ui(page);
    eq(sorted(be.transcript('DONE01')), range(u.made), `A: Done after reconnect dropped waiting clips; recorded ${u.made}, MLS got ${JSON.stringify(be.transcript('DONE01'))}`);
    ok(!/discarded/i.test(u.recErr), 'A: nothing was discarded, yet the page says so');
    ok(!/waiting to upload/.test(u.waitLine), 'A: the waiting line outlived the queue');
    const starts = await page.evaluate(() => window.__starts);
    for (const p of be.posts) {
      ok(typeof p.clipId === 'string' && p.clipId.length > 0 && p.clipId.length <= 64, `A: clip ${p.clip} was sent without a clipId`);
      ok(Number.isFinite(p.t), `A: clip ${p.clip} was sent without its start time t (got ${p.t})`);
      ok(starts.some(s => Math.abs(s - p.t) <= 5), `A: clip ${p.clip} t=${p.t} is not the moment one of its recorders started (${JSON.stringify(starts)})`);
    }
    for (const n of range(u.made)) {
      const tries = be.posts.filter(p => p.clip === n);
      eq(new Set(tries.map(p => p.clipId)).size, 1, `A: the retries of clip ${n} did not repeat one clipId`);
      eq(new Set(tries.map(p => p.t)).size, 1, `A: the retries of clip ${n} did not repeat one t`);
      if (n > 1) ok(tries[0].t > be.posts.find(p => p.clip === n - 1).t, `A: clip ${n} does not start after clip ${n - 1}`);
    }
    eq(new Set(be.posts.map(p => p.clipId)).size, u.made, 'A: two different clips shared a clipId');
    eq(page.__errors, [], 'A: page errors');
  } finally { await close(); }
}

/* B. Done while still offline: the clips stay, the count stays on screen,
   the screen stays awake, and the status never says Done before the end. */
async function doneWhileOffline(browser, origin) {
  const be = makeBackend('contract'); be.open('DONE02');
  const { page, close } = await openPhone(browser, origin, be, 'DONE02');
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted('DONE02') >= 1);
    be.net = 'down';
    await until('a clip waiting in memory', async () => (await ui(page)).pending >= 1);
    await page.evaluate(() => { window.__statusLog = []; });
    await page.tap('#doneBtn');
    const held = await until('the final clip handed over and held', async () => { const u = await ui(page); return !u.active && u.micReleased && u.pending === u.made - be.accepted('DONE02') && u; });
    ok(held.pending >= 2, `B: expected at least two clips held after Done, got ${held.pending}`);
    for (let i = 0; i < 6; i++) {
      const u = await ui(page);
      eq(u.pending, held.pending, 'B: Done while offline let go of waiting clips');
      ok(new RegExp(`${held.pending} clips waiting to upload`).test(u.waitLine), `B: the waiting count left the screen: ${JSON.stringify(u.waitLine)}`);
      ok(new RegExp(`${held.pending} clips still waiting`).test(u.status) && !/^Done\./.test(u.status), `B: the status claims Done while clips wait: ${JSON.stringify(u.status)}`);
      ok(u.wakeHeld >= 1, 'B: the screen may sleep while clips wait to upload after Done (no wake lock held)');
      await sleep(RETRY_MS / 2);
    }
    be.net = 'up';
    await until('the held clips sent and Done finished', () => doneNow(page), RETRY_MS * 4);
    await sleep(300);
    const u = await ui(page);
    eq(sorted(be.transcript('DONE02')), range(u.made), 'B: a held clip never reached MLS, or reached it twice');
    ok(!/waiting to upload/.test(u.waitLine), 'B: the waiting line outlived the queue');
    eq(u.wakeHeld, 0, 'B: the wake lock outlived Done');
    const log = (await statusLog(page)).map(e => e.s);
    const firstDone = log.findIndex(s => /^Done\./.test(s));
    ok(firstDone > 0 && log.slice(firstDone).every(s => /^Done\./.test(s)), `B: the status said Done before the clips were sent: ${JSON.stringify(log)}`);
    eq(page.__errors, [], 'B: page errors');
  } finally { await close(); }
}

/* C. A clip that fails twice arrives after later clips; a clip whose reply is
   lost is sent again. Each clip is in the transcript once (in arrival order,
   micfix-1.2.0), and t follows the recording order. */
async function orderAndDuplicates(browser, origin) {
  const be = makeBackend('contract'); be.open('ORDR01');
  be.hook = p => (p.clip === 2 && p.attempt <= 2 ? 'offline' : p.clip === 4 && p.attempt === 1 ? 'lose-reply' : null);
  const { page, close } = await openPhone(browser, origin, be, 'ORDR01');
  try {
    await page.tap('#recBtn');
    await until('clips 2 and 5 accepted', () => be.posts.some(p => p.clip === 2 && p.status === 200) && be.posts.some(p => p.clip === 5 && p.status === 200), 30000);
    await page.tap('#recBtn');
    await until('everything sent', async () => { const u = await ui(page); return !u.active && u.micReleased && u.pending === 0 && be.accepted('ORDR01') === u.made && u; });
    const u = await ui(page);
    const arrival = be.arrival('ORDR01');
    ok(arrival.indexOf(3) >= 0 && arrival.indexOf(3) < arrival.indexOf(2), `C: the retried clip did not arrive late, so order was not exercised: ${JSON.stringify(arrival)}`);
    eq(be.posts.filter(p => p.clip === 4).map(p => p.status), ['reply-lost', 200], 'C: the clip whose reply was lost was not re-sent once');
    eq(sorted(be.transcript('ORDR01')), range(u.made), 'C: a clip is missing from the transcript or in it twice');
    eq(be.transcript('ORDR01'), arrival, 'C: the transcript is not in arrival order');
    const tOf = n => be.posts.find(p => p.clip === n).t;
    for (const n of range(u.made).slice(1)) ok(tOf(n) > tOf(n - 1), `C: clip ${n} has a t before clip ${n - 1}'s`);
    eq(u.sent, `${u.made} clips uploaded to MLS`, 'C: the phone miscounted uploads');
    for (const n of [2, 4]) {
      const tries = be.posts.filter(p => p.clip === n);
      ok(tries.length >= 2 && tries.every(p => p.t === tries[0].t && p.clipId === tries[0].clipId), `C: a retry of clip ${n} changed its t or clipId: ${JSON.stringify(tries.map(p => [p.t, p.clipId]))}`);
    }
    eq(page.__errors, [], 'C: page errors');
  } finally { await close(); }
}

/* D. The desktop ended the session mid-recording. */
async function sessionEnded(browser, origin, mode) {
  const code = mode === 'legacy' ? 'ENDOLD' : 'ENDNEW';
  const be = makeBackend(mode); be.open(code);
  const { page, close } = await openPhone(browser, origin, be, code);
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted(code) >= 1);
    be.end(code);
    const gone = mode === 'legacy' ? 404 : 410;
    await until('the ended answer', () => be.posts.some(p => p.status === gone));
    await until('recording stopped', async () => !(await ui(page)).active, 5000);
    await sleep(RETRY_MS * 2 + 500);
    const u = await ui(page);
    ok(!u.active && u.label === 'Record', `D(${mode}): the phone kept recording into an ended session`);
    ok(/session on your computer has ended/i.test(u.recErr), `D(${mode}): the page did not say the session ended: ${JSON.stringify(u.recErr)}`);
    ok(!/mistyped/i.test(u.recErr), `D(${mode}): an ended session was called a mistyped code`);
    ok(/Recording stopped/.test(u.status) && /session on your computer has ended/.test(u.status) && u.statusColor !== GREEN, `D(${mode}): the status does not say recording stopped because the session ended: ${JSON.stringify([u.status, u.statusColor])}`);
    eq(u.sent, '1 clip uploaded to MLS', `D(${mode}): a clip the session refused was counted as uploaded`);
    eq(u.pending, 0, `D(${mode}): clips for an ended session were kept for retry`);
    const perClip = new Map();
    for (const p of be.posts.filter(p => p.status === gone)) perClip.set(p.clip, (perClip.get(p.clip) || 0) + 1);
    ok([...perClip.values()].every(n => n === 1), `D(${mode}): a clip the ended session refused was sent again`);
    ok(u.recErr.includes(lostText(perClip.size)), `D(${mode}): the page did not say ${perClip.size} clip(s) were not added: ${JSON.stringify(u.recErr)}`);
    ok(/ended/i.test(u.pill) && !/Linked to computer/.test(u.pill), `D(${mode}): the pill still claims a live link: ${JSON.stringify(u.pill)}`);
    eq(page.__errors, [], `D(${mode}): page errors`);
  } finally { await close(); }
}

/* D2. A clip that landed but whose reply was lost is re-sent after the
   desktop pressed Stop. It is answered 'duplicate' and counted as added. */
async function lostReplyAfterStop(browser, origin) {
  const be = makeBackend('contract'); be.open('LOST01');
  be.hook = p => (p.clip === 2 && p.attempt === 1 ? 'lose-reply' : null);
  be.afterAnswer = p => { if (p.clip === 2 && p.attempt === 1) be.end('LOST01'); };
  const { page, close } = await openPhone(browser, origin, be, 'LOST01');
  try {
    await page.tap('#recBtn');
    await until('clip 2 stored, its reply lost, then Stop on the desktop', () => be.posts.some(p => p.clip === 2 && p.status === 'reply-lost'));
    await until('everything answered', async () => { const u = await ui(page); return !u.active && u.pending === 0 && be.posts.some(p => p.status === 410) && u; }, 15000);
    await sleep(500);
    const u = await ui(page);
    eq(be.posts.filter(p => p.clip === 2).map(p => p.status), ['reply-lost', 200], 'D2: the clip whose reply was lost was not sent again after Stop');
    ok(be.posts.some(p => p.clip === 2 && p.duplicate), 'D2: the re-sent clip was not answered as a duplicate');
    eq(be.transcript('LOST01'), [1, 2], 'D2: the stored transcript changed');
    eq(u.sent, '2 clips uploaded to MLS', 'D2: a clip MLS has was not counted as uploaded');
    const notAdded = new Set(be.posts.filter(p => p.status === 410).map(p => p.clip)).size;
    ok(u.recErr.includes(lostText(notAdded)), `D2: the page says the wrong number of clips were not added (expected ${notAdded}): ${JSON.stringify(u.recErr)}`);
    eq(page.__errors, [], 'D2: page errors');
  } finally { await close(); }
}

/* E. Today's 404 before anything was accepted is still a code problem. */
async function neverIssued(browser, origin) {
  const be = makeBackend('legacy');
  const { page, close } = await openPhone(browser, origin, be, 'NOPE01');
  try {
    await page.tap('#recBtn');
    await until('the 404', () => be.posts.some(p => p.status === 404));
    await until('recording stopped', async () => !(await ui(page)).active, 5000);
    await sleep(300);
    const u = await ui(page);
    ok(/That code was not accepted/.test(u.recErr) && /mistyped/.test(u.recErr), `E: a never-issued code lost its message: ${JSON.stringify(u.recErr)}`);
    ok(/Recording stopped/.test(u.status) && /not accepted/.test(u.status), `E: the status does not say why recording stopped: ${JSON.stringify(u.status)}`);
    eq(u.sent, '', 'E: a refused clip was counted as uploaded');
    eq(page.__errors, [], 'E: page errors');
  } finally { await close(); }
}

/* F. A refusal marked retryable:false is never sent again. */
async function notRetryable(browser, origin, mode) {
  const code = mode === 'legacy' ? 'BADOLD' : 'BADNEW';
  const be = makeBackend(mode); be.open(code);
  be.hook = p => (p.clip === 2 ? 'refuse' : null);
  const { page, close } = await openPhone(browser, origin, be, code);
  try {
    await page.tap('#recBtn');
    await until('clip 3 accepted', () => be.posts.some(p => p.clip === 3 && p.status === 200));
    await sleep(RETRY_MS * 2 + 500);
    const u = await ui(page);
    eq(be.posts.filter(p => p.clip === 2).length, 1, `F(${mode}): a retryable:false clip was sent again`);
    ok(u.active, `F(${mode}): one refused clip stopped the recording`);
    eq(u.pending, 0, `F(${mode}): a refused clip was kept for retry`);
    ok(!/waiting to upload/.test(u.waitLine), `F(${mode}): a refused clip is shown as waiting`);
    ok(mode === 'legacy' ? /could not accept a clip \(server 502\)/.test(u.recErr) : /could not be read as audio/.test(u.recErr), `F(${mode}): the page did not say the clip was refused: ${JSON.stringify(u.recErr)}`);
    const refusedAt = be.posts.find(p => p.clip === 2).doneAt;
    const after = (await statusLog(page)).filter(e => e.t >= refusedAt);
    ok(after.length && /could not be added/.test(after[0].s) && after[0].c !== GREEN, `F(${mode}): the status kept saying 'talk normally' after a clip was thrown away: ${JSON.stringify(after.slice(0, 3))}`);
    await page.tap('#recBtn');
    eq(page.__errors, [], `F(${mode}): page errors`);
  } finally { await close(); }
}

/* G. After a Wi-Fi drop, clip 2 keeps failing with a RETRYABLE answer. The
   clips behind it must still be sent, and Done must wait for clip 2. */
async function headOfLine(browser, origin, mode) {
  const code = mode === 'legacy' ? 'HOLOLD' : 'HOLNEW';
  const be = makeBackend(mode); be.open(code);
  const { page, close } = await openPhone(browser, origin, be, code);
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted(code) >= 1);
    be.net = 'down';
    await until('clips 2 and 3 waiting', async () => (await ui(page)).pending >= 2);
    let stuck = true;
    const fail = mode === 'legacy'
      ? { status: 503, json: { error: 'The AI provider is overloaded or temporarily unavailable.', code: 'ai-overloaded', retryable: true } }
      : { status: 504, json: { error: 'The transcription did not finish in time.', code: 'ai-timeout', retryable: true } };
    be.hook = p => (p.clip === 2 && stuck ? fail : null);
    be.net = 'up';
    await until('clip 3 sent while clip 2 keeps failing', () => be.posts.some(p => p.clip === 3 && p.status === 200), RETRY_MS * 4);
    const mid = await ui(page);
    ok(mid.active, `G(${mode}): recording stopped`);
    await page.tap('#doneBtn');
    await until('Done waiting on clip 2', async () => { const u = await ui(page); return !u.active && u.pending === 1 && be.posts.filter(p => p.status === 0 || p.status === 'held').length === 0 && u; }, 10000);
    await sleep(RETRY_MS + 500);
    const u = await ui(page);
    ok(/Not done yet — 1 clip still waiting/.test(u.status), `G(${mode}): Done does not say clip 2 still waits: ${JSON.stringify(u.status)}`);
    ok(/1 clip waiting to upload/.test(u.waitErr), `G(${mode}): the waiting line lost clip 2`);
    const tries = be.posts.filter(p => p.clip === 2);
    ok(tries.length >= 3 && tries.every(p => p.clipId === tries[0].clipId && p.t === tries[0].t), `G(${mode}): clip 2 was not retried with one clipId and t`);
    stuck = false;
    await until('Done once clip 2 lands', () => doneNow(page), RETRY_MS * 3);
    const made = (await ui(page)).made;
    eq(sorted(be.transcript(code)), range(made), `G(${mode}): a clip never reached MLS, or reached it twice: ${JSON.stringify(be.arrival(code))}`);
    eq(page.__errors, [], `G(${mode}): page errors`);
  } finally { await close(); }
}

/* H. An upload that never answers is given up and retried. */
async function hungUpload(browser, origin) {
  const be = makeBackend('contract'); be.open('HANG01');
  be.hook = p => (p.clip === 2 && p.attempt === 1 ? 'hang' : null);
  const { page, close } = await openPhone(browser, origin, be, 'HANG01');
  try {
    await page.tap('#recBtn');
    await until('clip 2 hanging', () => be.posts.some(p => p.clip === 2 && p.status === 'hung'));
    await until('clip 2 retried after its attempt timed out', () => be.posts.some(p => p.clip === 2 && p.status === 200), 15000);
    const tries = be.posts.filter(p => p.clip === 2);
    ok(tries.length === 2 && tries[1].clipId === tries[0].clipId && tries[1].t === tries[0].t, 'H: the retry of a hung upload changed its clipId or t');
    /* micfix-1.2.0: clip 1's answer carried dedupe:true, so the short deadline applies. */
    const gap = tries[1].at - tries[0].at;
    ok(gap >= UPLOAD_TIMEOUT_MS && gap < NO_DEDUPE_TIMEOUT_MS, `H: after the dedupe marker the hung attempt was given up after ${gap} ms`);
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page), 10000);
    const u = await ui(page);
    eq(sorted(be.transcript('HANG01')), range(u.made), 'H: a clip is missing from the transcript or in it twice');
    eq(page.__errors, [], 'H: page errors');
  } finally { await close(); }
}

/* I. MLS refuses every clip for a reason on this account (402, 403). */
async function accountRefusal(browser, origin, kind) {
  const code = { 'contract-402': 'ACCT01', 'contract-403': 'ACCT03' }[kind];
  const be = makeBackend('contract'); be.open(code);
  let refusing = false;
  if (kind === 'contract-403') be.hook = () => (refusing ? { status: 403, json: { error: 'Forbidden' } } : null);
  const refuse = on => { refusing = on; if (kind !== 'contract-403') be.refuseAll = on; };
  const refusal = { 'contract-402': 402, 'contract-403': 403 }[kind];
  const reason = { 'contract-402': /does not have active access/, 'contract-403': /server 403/ }[kind];
  const { page, close } = await openPhone(browser, origin, be, code);
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted(code) >= 1);
    refuse(true);
    await until('the first refusal', () => be.posts.some(p => p.status === refusal));
    const firstAt = be.posts.find(p => p.status === refusal).doneAt;
    await until('recording stopped', async () => !(await ui(page)).active, 1500).catch(() => { throw new Error(`I(${kind}): recording went on after MLS refused the account (${Date.now() - firstAt} ms)`); });
    await until('the last clip handed over', async () => { const u = await ui(page); return u.micReleased && u.pending === u.made - be.accepted(code) && u; }, 5000);
    const u = await ui(page);
    ok(/Recording stopped/.test(u.status) && /not accepting clips/.test(u.status) && u.statusColor !== GREEN, `I(${kind}): the status does not say recording stopped: ${JSON.stringify([u.status, u.statusColor])}`);
    ok(reason.test(u.recErr) && /held in temporary memory/.test(u.recErr), `I(${kind}): the page does not say why, or that the clips are held: ${JSON.stringify(u.recErr)}`);
    ok(!/discarded|could not accept/.test(u.recErr), `I(${kind}): the page threw clips away: ${JSON.stringify(u.recErr)}`);
    ok(u.pending >= 1, `I(${kind}): no clip is held`);
    ok(/paused until you tap Record or Done/.test(u.waitErr), `I(${kind}): the waiting line claims a retry that is not happening: ${JSON.stringify(u.waitErr)}`);
    const postsHeld = be.posts.length;
    await sleep(RETRY_MS * 2 + 500);
    eq(be.posts.length, postsHeld, `I(${kind}): held clips were re-sent on their own while MLS still refuses them`);
    eq((await ui(page)).pending, u.pending, `I(${kind}): a held clip was let go`);
    if (kind === 'contract-403') { eq(page.__errors, [], `I(${kind}): page errors`); return; }
    refuse(false);
    await page.evaluate(() => { window.__statusLog = []; });
    await page.tap('#recBtn');
    await until('the held clips sent and recording again', async () => { const r = await ui(page); return r.active && r.pending === 0 && be.accepted(code) >= u.made + 1 && r; }, 15000);
    const r = await ui(page);
    ok(!/held in temporary memory/.test(r.recErr), 'I: the hold message outlived the hold');
    /* micfix-1.2.0: Record resets the red of the stop. */
    const restarted = (await statusLog(page)).find(e => /talk normally/.test(e.s));
    ok(restarted && restarted.c !== RED, `I(${kind}): Record said 'talk normally' in the red of the stop: ${JSON.stringify(restarted)}`);
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page), 10000);
    const made = (await ui(page)).made;
    eq(be.transcript(code), range(made), `I(${kind}): the held clips did not all reach MLS in order: ${JSON.stringify(be.transcript(code))}`);
    eq(page.__errors, [], `I(${kind}): page errors`);
  } finally { await close(); }
}

/* J. Code A ends; late answers for A arrive on the code screen and while
   code B records. Only A's own screen may say A ended. The upload timeout is
   long here, so the two late answers are the first attempts still in flight. */
async function oldCodeStraggler(browser, origin, mode) {
  const A = mode === 'legacy' ? 'OLDA01' : 'NEWA01';
  const B = mode === 'legacy' ? 'OLDB02' : 'NEWB02';
  const be = makeBackend(mode); be.open(A); be.open(B);
  const gate2 = deferred(), gate3 = deferred();
  be.hook = p => (p.code === A && p.clip === 2 ? { gate: gate2.promise } : p.code === A && p.clip === 3 ? { gate: gate3.promise } : null);
  const gone = mode === 'legacy' ? 404 : 410;
  const noteOnA = new RegExp(`earlier code ${A}`);
  const { page, close } = await openPhone(browser, origin, be, A, { uploadTimeoutMs: 30500, noDedupeTimeoutMs: 60500 });
  try {
    await page.tap('#recBtn');
    await until('A clip 1 accepted', () => be.accepted(A) >= 1);
    await until('A clips 2 and 3 held by the server', () => be.posts.filter(p => p.code === A && p.status === 'held').length >= 2);
    be.end(A);
    await until('A ended on the phone', async () => { const u = await ui(page); return !u.active && /session on your computer has ended/.test(u.recErr) && u; }, 8000);
    await page.tap('#recodeBtn');
    await page.waitForSelector('#connectScreen:not(.hidden)');
    gate2.resolve();
    await until('the late answer for A on the code screen', () => be.posts.some(p => p.code === A && p.clip === 2 && p.status === gone));
    await until('the phone to note the late answer for the earlier code A', async () => noteOnA.test((await ui(page)).recErr), 3000)
      .catch(async () => { throw new Error(`J(${mode}): a late answer on the code screen was not a note about the earlier code: ${JSON.stringify((await ui(page)).recErr)}`); });
    await page.fill('#codeInput', B);
    await page.tap('#connectBtn');
    await until('the recorder open on code B', async () => { const u = await ui(page); return u.recScreen && u.codeShown === B && u; }, 3000)
      .catch(() => { throw new Error(`J(${mode}): code B could not be entered after a late answer for code A (page errors ${JSON.stringify(page.__errors)})`); });
    await page.tap('#recBtn');
    await until('B clip accepted', () => be.accepted(B) >= 1);
    gate3.resolve();
    await until('the late answer for A while B records', () => be.posts.some(p => p.code === A && p.clip === 3 && p.status === gone));
    await until('the phone to note it', async () => noteOnA.test((await ui(page)).recErr), 3000)
      .catch(async () => { throw new Error(`J(${mode}): a late answer for code A while code B records was not a note about the earlier code: ${JSON.stringify(await ui(page))}`); });
    await sleep(300);
    const u = await ui(page);
    ok(u.active, `J(${mode}): a late answer for code A stopped the recording on code B`);
    ok(new RegExp(`Linked to computer · code ${B}`).test(u.pill) && !/ended/i.test(u.pill), `J(${mode}): the pill blames code B: ${JSON.stringify(u.pill)}`);
    ok(u.recode !== 'inline-block', `J(${mode}): 'Enter a different code' is offered while code B works`);
    ok(!/session on your computer has ended|mistyped|new code/.test(u.recErr), `J(${mode}): the page says the current session ended: ${JSON.stringify(u.recErr)}`);
    ok(new RegExp(`earlier code ${A}`).test(u.recErr), `J(${mode}): the note does not name the earlier code: ${JSON.stringify(u.recErr)}`);
    ok(/Recording/.test(u.status) && !/stopped/i.test(u.status), `J(${mode}): the status says recording stopped: ${JSON.stringify(u.status)}`);
    await page.tap('#recBtn');
    eq(page.__errors, [], `J(${mode}): page errors`);
  } finally { await close(); }
}

/* K1. A normal Done: the status goes to Done once, after the last clip lands. */
async function doneNoFlicker(browser, origin) {
  const be = makeBackend('contract'); be.open('NORM01');
  be.hook = () => ({ gate: sleep(800) });
  const { page, close } = await openPhone(browser, origin, be, 'NORM01');
  try {
    await page.tap('#recBtn');
    await until('2 accepted', () => be.accepted('NORM01') >= 2);
    await page.evaluate(() => { window.__statusLog = []; });
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page));
    await sleep(1500);
    const u = await ui(page);
    const log = await statusLog(page);
    const firstDone = log.findIndex(e => /^Done\./.test(e.s));
    ok(firstDone >= 0 && log.slice(firstDone).every(e => /^Done\./.test(e.s)), `K1: Done was followed by another status: ${JSON.stringify(log.map(e => e.s))}`);
    const lastLanded = Math.max(...be.posts.filter(p => p.status === 200).map(p => p.doneAt));
    eq(be.accepted('NORM01'), u.made, 'K1: a clip did not land');
    ok(log[firstDone].t >= lastLanded, `K1: Done was shown ${lastLanded - log[firstDone].t} ms before the last clip landed`);
    eq(be.transcript('NORM01'), range(u.made), 'K1: the transcript is not complete and in order');
    eq(page.__errors, [], 'K1: page errors');
  } finally { await close(); }
}

/* K2. Done pressed twice in one go while offline keeps the last clip. */
async function doubleDone(browser, origin) {
  const be = makeBackend('contract'); be.open('DBL001');
  const { page, close } = await openPhone(browser, origin, be, 'DBL001');
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted('DBL001') >= 1);
    await sleep(700);
    be.net = 'down';
    await page.evaluate(() => { const d = document.getElementById('doneBtn'); d.click(); d.click(); });
    await sleep(2500);
    const u = await ui(page);
    ok(!/discarded/i.test(u.recErr), `K2: a second press of Done discarded the last clip: ${JSON.stringify(u.recErr)}`);
    ok(u.pending >= 1 && !/^Done\./.test(u.status), `K2: Done was claimed while the last clip waits: ${JSON.stringify([u.status, u.pending])}`);
    be.net = 'up';
    await until('Done', () => doneNow(page), RETRY_MS * 3);
    eq(sorted(be.transcript('DBL001')), range((await ui(page)).made), 'K2: a clip never reached MLS');
    eq(page.__errors, [], 'K2: page errors');
  } finally { await close(); }
}

/* L. The phone's clock steps back a minute (a network time fix), then the
   page reloads (as iOS does) and the same code is typed again: the next clip
   still starts after the last one (micfix-1.2.0: a per-code t floor kept in
   sessionStorage, a number only). */
async function reloadKeepsT(browser, origin) {
  const be = makeBackend('contract'); be.open('RELD01');
  const { page, close } = await openPhone(browser, origin, be, 'RELD01');
  try {
    await page.tap('#recBtn');
    await until('2 accepted', () => be.accepted('RELD01') >= 2);
    await page.tap('#recBtn');
    await until('all sent before the reload', async () => { const u = await ui(page); return !u.active && u.micReleased && u.pending === 0 && be.accepted('RELD01') === u.made && u; });
    await sleep(300);
    const before = (await ui(page)).made;
    await page.evaluate(() => sessionStorage.setItem('__clockSkewMs', '-60000'));
    await page.reload();
    await page.waitForSelector('#connectScreen:not(.hidden)');
    await tune(page);
    ok(await page.evaluate(() => Date.now() < new Date().getTime() - 50000), 'L: the clock did not step back for the run');
    await page.fill('#codeInput', 'RELD01');
    await page.tap('#connectBtn');
    await page.waitForSelector('#recScreen:not(.hidden)');
    await page.tap('#recBtn');
    await until('2 clips after the reload', () => be.accepted('RELD01') >= before + 2, 20000);
    await page.tap('#recBtn');
    await until('all sent', async () => { const u = await ui(page); return !u.active && u.pending === 0 && be.accepted('RELD01') === u.made && u; });
    const made = (await ui(page)).made;
    const tOf = n => (be.posts.find(p => p.clip === n) || {}).t;
    ok(Number.isFinite(tOf(before)) && tOf(before + 1) > tOf(before), `L: after the clock stepped back and the page reloaded, t went backwards (t ${tOf(before)} then ${tOf(before + 1)})`);
    for (const n of range(made).slice(1)) ok(tOf(n) > tOf(n - 1), `L: clip ${n} has a t before clip ${n - 1}'s`);
    const kept = await page.evaluate(() => Object.keys(sessionStorage).filter(k => !/^__/.test(k)).map(k => [k, sessionStorage.getItem(k)]));
    ok(kept.every(([k, v]) => /^mlsPhoneT:/.test(k) && /^\d+$/.test(v)), `L: the page kept something other than a number in sessionStorage: ${JSON.stringify(kept)}`);
    eq(sorted(be.transcript('RELD01')), range(made), 'L: a clip is missing from the transcript or in it twice');
    eq(page.__errors, [], 'L: page errors');
  } finally { await close(); }
}

/* M. Today's server (no dedupe marker), one slow transcription. Clip 2 takes
   8 s; today's server answers every later clip only after it, and adds a clip
   whose sender gave up. The page must wait for the answers: every clip is
   sent once and added once, in order, and Done follows. The round-2 page gave
   up after 2.5 s (the scaled 40 s) and added clips 2 to 5 again. */
async function slowServerNoMarker(browser, origin) {
  const be = makeBackend('legacy'); be.open('SLOW01');
  be.hook = p => (p.clip === 2 && p.attempt === 1 ? { stall: 8000 } : null);
  const { page, close } = await openPhone(browser, origin, be, 'SLOW01');
  try {
    await page.tap('#recBtn');
    await until('clip 5 sent while clip 2 is transcribed', () => be.posts.some(p => p.clip === 5), 20000);
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page), 30000);
    await sleep(RETRY_MS + 500);
    const u = await ui(page);
    const perClip = range(u.made).map(n => be.posts.filter(p => p.clip === n).length);
    eq(perClip, range(u.made).map(() => 1), `M: a clip was sent more than once to a server that does not dedupe: ${JSON.stringify(be.posts.map(p => [p.clip, p.status]))}`);
    eq(be.arrival('SLOW01'), range(u.made), `M: the transcript lost or repeated a clip: ${JSON.stringify(be.arrival('SLOW01'))}`);
    const slow = be.posts.find(p => p.clip === 2);
    ok(slow.status === 200 && !slow.gaveUp && slow.doneAt - slow.at >= 8000, 'M: the slow clip was not waited for');
    eq(u.sent, `${u.made} clips uploaded to MLS`, 'M: the phone miscounted uploads');
    eq(page.__errors, [], 'M: page errors');
  } finally { await close(); }
}

/* Counts every microphone the page opened, with a controllable delay (the
   time the browser takes to grant it) and failure. */
async function watchMics(page) {
  await page.evaluate(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__streams = []; window.__gum = { delay: 0, fail: false, pending: 0 };
    navigator.mediaDevices.getUserMedia = async c => {
      window.__gum.pending++;
      try {
        await new Promise(r => setTimeout(r, window.__gum.delay));
        if (window.__gum.fail) throw new DOMException('Requested device not found', 'NotFoundError');
        const s = await gum(c); window.__streams.push(s); return s;
      } finally { window.__gum.pending--; }
    };
  });
  return () => page.evaluate(() => window.__streams.reduce((n, s) => n + s.getTracks().filter(t => t.readyState === 'live').length, 0));
}

/* N-tap. Two quick taps on Record while the microphone is being granted,
   then Done. N-done. Done tapped while the microphone is still being granted
   (after a first recording, so the Done button shows). N-hide. The page is
   left (pagehide) while the microphone is still being granted. */
async function doubleTapRecord(browser, origin, part) {
  const code = { tap: 'TAP001', done: 'TAP002', hide: 'TAP003' }[part];
  const be = makeBackend('contract'); be.open(code);
  const { page, close } = await openPhone(browser, origin, be, code);
  try {
    const liveMics = await watchMics(page);
    await page.evaluate(() => { window.__gum.delay = 300; });
    await page.tap('#recBtn');
    if (part === 'tap') { await sleep(80); await page.tap('#recBtn'); }
    await until('recording', async () => (await ui(page)).active, 5000);
    await sleep(SEG_MS * 2 + 500);
    eq(await page.evaluate(() => window.__streams.length), 1, 'N: two taps on Record opened the microphone twice');
    eq(await liveMics(), 1, 'N: more than one microphone is on while recording');
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page), 15000);
    await sleep(500);
    eq(await liveMics(), 0, 'N: a microphone was left on after Done');
    if (part === 'done') {
      await page.evaluate(() => { window.__gum.delay = 1500; });
      await page.tap('#recBtn'); await sleep(200); await page.tap('#doneBtn');
      await sleep(2500);
      eq(await liveMics(), 0, 'N: the microphone granted after Done was left on');
    }
    if (part === 'hide') {
      await page.evaluate(() => { window.__gum.delay = 1500; });
      await page.tap('#recBtn'); await sleep(200);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await sleep(2500);
      eq(await liveMics(), 0, 'N: the microphone granted after the page was left was turned on');
      const h = await ui(page);
      ok(!h.active && h.label === 'Record', 'N: recording started after the page was left');
      eq(page.__errors, [], 'N: page errors');
      return;
    }
    const u = await ui(page);
    ok(!u.active && u.label === 'Record', 'N: recording started after Done');
    ok(/^Done\./.test(u.status), `N: the Done status was replaced: ${JSON.stringify(u.status)}`);
    eq(sorted(be.transcript(code)), range(u.made), 'N: a clip is missing from the transcript or in it twice');
    eq(page.__errors, [], 'N: page errors');
  } finally { await close(); }
}

/* O-status. The microphone goes away mid-visit (a phone call, the OS takes
   it). While the page tries to get it back, a clip accepted must not say
   'talk normally'. O-done. A microphone that comes back after Done is
   turned off. */
async function micRecovery(browser, origin, part) {
  const code = part === 'status' ? 'MIC001' : 'MIC002';
  const be = makeBackend('contract'); be.open(code);
  const { page, close } = await openPhone(browser, origin, be, code);
  try {
    const liveMics = await watchMics(page);
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted(code) >= 1);
    await sleep(700);
    const before = be.accepted(code);
    await page.evaluate(() => { window.__gum.fail = true; window.__statusLog = []; const t = stream.getAudioTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); });
    await until('the last clip accepted while the microphone is recovered', () => be.accepted(code) > before, 8000);
    await sleep(700);
    if (part === 'status') {
      const u = await ui(page);
      ok(/Mic interrupted/.test(u.status) && u.statusColor !== GREEN, `O: while the microphone is recovered the status says: ${JSON.stringify([u.status, u.statusColor])}`);
      const log = await statusLog(page);
      ok(!log.some(e => /talk normally/.test(e.s)), `O: 'talk normally' was shown while the microphone was gone: ${JSON.stringify(log.map(e => e.s))}`);
      ok(/uploaded to MLS/.test(u.sent) && u.sent.startsWith(String(be.accepted(code))), `O: the uploaded count did not follow: ${JSON.stringify(u.sent)}`);
      eq(page.__errors, [], 'O: page errors');
      return;
    }
    await page.evaluate(() => { window.__gum.fail = false; window.__gum.delay = 2000; });
    await until('a slow microphone request in progress', () => page.evaluate(() => window.__gum.pending > 0), 5000);
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page), 15000);
    await sleep(2500);
    eq(await liveMics(), 0, 'O: the microphone that came back after Done was left on');
    const d = await ui(page);
    ok(!d.active && /^Done\./.test(d.status), `O: the recovered microphone replaced Done: ${JSON.stringify(d.status)}`);
    eq(page.__errors, [], 'O: page errors');
  } finally { await close(); }
}

/* Q. Today's ai-quota: MLS itself cannot transcribe for a while. The page
   keeps recording, says how many clips wait, sends no new clip ahead of the
   waiting ones (also while they are sent afterwards), retries the first with
   a growing wait (6 s, 12 s, ... scaled) and adds everything, each clip once
   and in order, when MLS can transcribe again. Round 2 stopped recording,
   which lost the rest of an unattended visit. */
async function serviceOutage(browser, origin) {
  const be = makeBackend('legacy'); be.open('QUOT01');
  const { page, close } = await openPhone(browser, origin, be, 'QUOT01');
  try {
    await page.tap('#recBtn');
    await until('clip 1 accepted', () => be.accepted('QUOT01') >= 1);
    be.refuseAll = true;
    await until('the first refusal', () => be.posts.some(p => p.status === 502));
    const first = be.posts.find(p => p.status === 502);
    const head = first.clip;
    await sleep(1000);
    ok((await ui(page)).active, 'Q: MLS being unable to transcribe stopped the recording');
    await until('the first waiting clip tried three times', () => be.posts.filter(p => p.clip === head && p.status === 502).length >= 3, RETRY_MS * 5);
    await sleep(300);
    const u = await ui(page);
    ok(u.active && u.label === 'Stop', 'Q: MLS being unable to transcribe stopped the recording');
    ok(/^● Recording… — MLS cannot add clips right now; \d+ waiting, retrying$/.test(u.status) && u.statusColor === AMBER, `Q: the status does not say MLS cannot add clips and that the phone retries: ${JSON.stringify([u.status, u.statusColor])}`);
    ok(u.status.includes(`; ${u.pending} waiting`), `Q: the status count is not the waiting count: ${JSON.stringify([u.status, u.pending])}`);
    ok(u.pending >= 3, `Q: the clips recorded during the outage were not kept (${u.pending} waiting)`);
    ok(/cannot transcribe audio right now/.test(u.recErr) && /keeps recording/.test(u.recErr) && /temporary memory/.test(u.recErr), `Q: the page does not explain the outage: ${JSON.stringify(u.recErr)}`);
    ok(/retrying/.test(u.waitErr) && !/paused/.test(u.waitErr), `Q: the waiting line does not say the clips are retried: ${JSON.stringify(u.waitErr)}`);
    eq(be.posts.filter(p => p.at > first.at && p.clip !== head).map(p => p.clip), [], 'Q: a clip recorded during the outage was sent ahead of the clips waiting before it');
    const at = be.posts.filter(p => p.clip === head).map(p => p.at);
    const gaps = [at[1] - at[0], at[2] - at[1]];
    ok(gaps[0] >= RETRY_MS * 0.8 && gaps[1] >= gaps[0] * 1.6, `Q: the retries did not wait longer each time: ${JSON.stringify(gaps)} ms`);
    const waitingAtRestore = (await ui(page)).pending;
    /* MLS transcribes again, 0.6 s a clip, so a clip is recorded while the
       waiting ones are still being sent. */
    be.hook = () => ({ stall: 600 });
    be.refuseAll = false;
    await until('the waiting clips added while recording goes on', async () => { const r = await ui(page); return be.accepted('QUOT01') >= 1 + waitingAtRestore && r.pending === 0 && r; }, 60000);
    const r = await ui(page);
    ok(r.active, 'Q: recording stopped when MLS took the clips again');
    ok(!/cannot transcribe/.test(r.recErr), 'Q: the outage note outlived the outage');
    await page.tap('#doneBtn');
    await until('Done', () => doneNow(page), 15000);
    const made = (await ui(page)).made;
    const arrival = be.arrival('QUOT01');
    eq(sorted(arrival), range(made), `Q: a clip is missing from the transcript or in it twice: ${JSON.stringify(arrival)}`);
    ok(made > head + waitingAtRestore, 'Q: no clip was recorded while the waiting clips were sent, so their order was not exercised');
    eq(arrival, range(made), `Q: the clips were not added in the order they were recorded: ${JSON.stringify(arrival)}`);
    eq(page.__errors, [], 'Q: page errors');
  } finally { await close(); }
}

const SCENARIOS = [
  ['A', (b, o) => doneAfterReconnect(b, o)],
  ['B', (b, o) => doneWhileOffline(b, o)],
  ['C', (b, o) => orderAndDuplicates(b, o)],
  ['D-contract', (b, o) => sessionEnded(b, o, 'contract')],
  ['D-legacy', (b, o) => sessionEnded(b, o, 'legacy')],
  ['D2', (b, o) => lostReplyAfterStop(b, o)],
  ['E', (b, o) => neverIssued(b, o)],
  ['F-contract', (b, o) => notRetryable(b, o, 'contract')],
  ['F-legacy', (b, o) => notRetryable(b, o, 'legacy')],
  ['G-contract', (b, o) => headOfLine(b, o, 'contract')],
  ['G-legacy', (b, o) => headOfLine(b, o, 'legacy')],
  ['H', (b, o) => hungUpload(b, o)],
  ['I-402', (b, o) => accountRefusal(b, o, 'contract-402')],
  ['I-403', (b, o) => accountRefusal(b, o, 'contract-403')],
  ['J-contract', (b, o) => oldCodeStraggler(b, o, 'contract')],
  ['J-legacy', (b, o) => oldCodeStraggler(b, o, 'legacy')],
  ['K1', (b, o) => doneNoFlicker(b, o)],
  ['K2', (b, o) => doubleDone(b, o)],
  ['L', (b, o) => reloadKeepsT(b, o)],
  ['M', (b, o) => slowServerNoMarker(b, o)],
  ['N-tap', (b, o) => doubleTapRecord(b, o, 'tap')],
  ['N-done', (b, o) => doubleTapRecord(b, o, 'done')],
  ['N-hide', (b, o) => doubleTapRecord(b, o, 'hide')],
  ['O-status', (b, o) => micRecovery(b, o, 'status')],
  ['O-done', (b, o) => micRecovery(b, o, 'done')],
  ['Q', (b, o) => serviceOutage(b, o)]
];

(async () => {
  const only = String(process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
  const pick = SCENARIOS.filter(([name]) => !only.length || only.some(o => name === o || name.startsWith(o + '-')));
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    for (const [name, run] of pick) {
      const t0 = Date.now();
      await run(browser, origin);
      console.log(`  ok ${name} (${Math.round((Date.now() - t0) / 100) / 10} s)`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`PASS phone upload contract (${checks} checks, ${pick.length} scenarios, Chromium 390x844, fake mic): every clip carries clipId and its start time t, and t never goes back across a reload; Done sends or keeps waiting clips, says Done only at the end and ignores a second press; a failing clip goes to the back of the queue; a hung upload is retried only once MLS shows it dedupes, and today's server is waited for, so no clip is added twice; an ended session stops recording and a lost-reply clip counts as added; a 402/403 stops recording and holds the clips; MLS unable to transcribe keeps recording and retries with a growing wait; one tap opens one microphone and none is left on after Done; a late answer for an old code never touches the current one`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
