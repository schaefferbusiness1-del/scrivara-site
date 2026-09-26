'use strict';

/* 1p-phone-direct-upload-contract-runtime  (micfix-1.0.0, 2026-09-24;
 * micfix-1.1.0 and micfix-1.2.0, 2026-09-25)
 * ============================================================================
 * The in-app iPhone recorder (the direct MediaRecorder lane of the 1p shell)
 * in real Chromium with Chrome's fake microphone and real MediaRecorder clips,
 * in the phone layout (390x844, iPhone user agent) and in the Easy/full layout
 * (1180x820, iPad user agent, no Web Speech, as the code models iOS). Each
 * clip's Blob is tagged "CLIP<n>|" when the lane makes it, so the backend stub
 * knows which recording every upload is. The stub runs in two shapes:
 * CONTRACT (micfix-1.2.0: one row per clip, read back in ARRIVAL order by
 * every reader; /start answers caps:{dedupe:true} and every accepted clip
 * dedupe:true with its clipId; a stored clipId answers duplicate even after
 * Stop; 410 MIC_SESSION_ENDED; 422 AUDIO_UNREADABLE; 402 NO_ACCESS; GET says
 * ended; Stop answers the final transcript) and LEGACY (today's server: 404
 * for a missing session, no clipId and no marker, arrival order, 502
 * retryable:false for ai-quota and for an unreadable clip).
 *
 *  A  A clip that cannot upload for longer than the old 3.5 s is kept and
 *     retried until it lands; the phone shows how many clips wait; every clip
 *     carries its start time t and one clipId, the same on every retry; the
 *     transcript is complete and in order. After Stop the bar shows Finishing,
 *     never Recording counting up again. The visit's local audio backup is
 *     deleted once the visit is saved, and a backup older than 24 h is
 *     deleted. (findings 4 / 7 / 6, C1)
 *  B  A clip whose reply was lost is re-sent with the same clipId and lands
 *     once; /start's capability marker is read. (C1, B2)
 *  C  An unreadable clip (422 retryable:false, or an older server's 502
 *     retryable:false) is never re-sent; the phone says so; recording goes on.
 *  D  An ended session (410, or an older server's 404 after an accepted clip)
 *     stops recording through the doctor's own Stop and says why; nothing is
 *     re-sent; no microphone is left live. (C2, A3)
 *  E  The microphone ends mid-recording: the clip the server is transcribing
 *     and the clip in progress both land, the session closes after them, the
 *     phone says why, and no microphone is left live. (finding 3, A3)
 *  F  The queue is strict first in, first out: a clip that keeps failing with
 *     a retryable answer holds the clips after it, so MLS, which adds clips as
 *     they arrive, keeps them in speaking order. (A2)
 *  G  An attempt that never settles is given up after its deadline and sent
 *     again with the same clipId and t, but only once MLS has said it dedupes
 *     (here the marker comes with an accepted clip). On today's server a slow
 *     answer is waited for: given up and sent again it was added twice. (A2)
 *  H  A refusal for this account (402, 403) stops recording through the
 *     doctor's own Stop: the lane's microphone and the local backup's recorder
 *     both stop, the clips MLS did not take are counted, their audio is named
 *     as kept on this device, and the backup is not marked clean. In the full
 *     layout nothing is left stuck. A refusal on MLS's side (today's ai-quota)
 *     keeps recording, keeps the clips in order, retries after 6 s and more,
 *     says so, and every clip lands once it clears. (A3)
 *  I  Stop never says the recording is complete before it is, and a second
 *     press during the first Stop is ignored; both microphones are released.
 *     (C5)
 *  J  The next part of the recording cannot start: recording stops through
 *     the doctor's own Stop, every clip made lands, and no microphone is left
 *     live. (A3)
 *  K  When the final read and Stop's own answer both fail, Stop says words may
 *     be missing and that this iPhone still has the audio, never that
 *     everything was captured, and the backup is not marked clean. When Stop's
 *     answer carries the transcript, a failed final read costs nothing. (A4)
 *  L  New visit, and the calendar's Start visit for another appointment, are
 *     refused while the recorder records or still sends its last clips;
 *     every clip reaches the visit. (A5)
 *  N  A Start that fails (MLS cannot open a session) ends through the doctor's
 *     own Stop: the local audio backup that began with the Start stops, and no
 *     microphone is left live. (A3)
 *  P  micfix-1.3.0 (R4-1): while the recorder starts, and while it still
 *     sends its last clips after Stop, the Easy room is 'finishing': Generate
 *     carries the disabled attribute, a finger tap on it re-binds nothing, a
 *     click that reaches its handler is refused first in the engine's words,
 *     and every clip reaches the (unlinked) visit.
 *  Q  micfix-1.3.0 (R4-2, R4-3): a Stop during an outage (MLS refusing every
 *     clip on its side, or the network down) releases the lane's microphone at
 *     once and is bounded (45 s; shortened for the run): then the lane is idle,
 *     the doctor is told how many segments were not added and that their audio
 *     is kept on this device, the backup is not marked clean, there is no
 *     success line, and New visit, another patient and Generate all work. A
 *     clip that lands within the bound is added as usual (a long backoff is
 *     brought forward), and #micWarn clears once nothing is pending. The clip
 *     whose attempt is cut is asked about by its clipId and counted only when
 *     MLS did not store it. The notes say 'this device' (K and L too).
 *
 * The full layout runs D, H, J, K, L, N, P and Q on the contract server.
 * The lane's 8 s segment is shortened to 2.5 s for the run.
 * Run: node tests/1p-phone-direct-upload-contract-runtime.test.js
 *      (ONLY=A,F runs the named scenarios; MODES=contract runs one server
 *       shape; LAYOUTS=phone or LAYOUTS=ipad runs one layout)
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SEG_MS = 2500;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const USER = { id: 'harness', email: 'ui-harness@mlsscribe.test', role: 'doctor', name: 'Sample Provider, MD', premium: true, hasAccess: true, agreements: { required: false, signerComplete: true } };
const CLUNKY = fs.readFileSync(path.join(ROOT, 'tests/1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + CLUNKY.slice(CLUNKY.indexOf('function harness() {'), CLUNKY.indexOf('async function boot(page, port)')).trim() + ')()';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.deepStrictEqual(a, b, msg); }
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/* The two layouts the in-app recorder runs in. */
const LAYOUTS = {
  phone: { key: 'phone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA } },
  ipad: { key: 'ipad', ctx: { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPAD_UA }, noSpeech: true }
};
let L = LAYOUTS.phone;

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

function clipOf(dataUrl) {
  const b64 = String(dataUrl || '').slice(String(dataUrl || '').indexOf(',') + 1);
  const m = Buffer.from(b64.slice(0, 64), 'base64').toString('latin1').match(/^CLIP(\d+)\|/);
  return m ? Number(m[1]) : 0;
}

/* hook(post) may answer 'offline', 'lose-reply', 'refuse', 'end', 'busy'
   (503 retryable), 'hang' (stored but never answered on the contract server;
   never answered on today's), 'no-access' (402), 'forbidden' (403), 'quota'
   (today's 502 ai-quota retryable:false) or a delay in ms, for one upload.
   startCaps=false: /start does not carry the marker; getFail / stopFail: the
   desktop's reads / Stop never reach the server; startFail: /start answers
   503 after 2 s; startDelay: /start answers after that many ms. An upload
   with no audio (the question a Stop asks about a clip it cut) is answered
   from what is stored: duplicate, or 410 once the session has ended. */
function makeBackend(mode) {
  const be = { mode, posts: [], log: [], sessions: new Map(), n: 0, hook: null, net: 'up', stopHook: null, startCaps: true, getFail: false, stopFail: false, startFail: false, startDelay: 0 };
  be.current = () => { const codes = [...be.sessions.keys()]; return codes[codes.length - 1]; };
  /* The clips the server holds, in the order it reads them back: arrival. */
  be.rows = code => (be.sessions.get(code) || { rows: [] }).rows.slice();
  be.clips = code => be.rows(code).map(r => r.clip);
  be.textOf = code => be.rows(code).map(r => 'Clip ' + r.clip + ' words. ').join('');
  be.route = async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    /* a request the page gave up on can no longer be answered */
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    let m;
    if (url.pathname === '/api/mic/start' && method === 'POST') {
      if (be.startFail) { await sleep(2000); return json(503, { error: 'MLS is not available right now.' }); }   /* the backup is recording by then */
      if (be.startDelay) await sleep(be.startDelay);   /* micfix-1.3.0: a start that takes a while */
      const code = 'DL' + String(++be.n).padStart(4, '0');
      be.sessions.set(code, { rows: [], ids: new Set(), ended: false });
      be.log.push({ t: Date.now(), m: 'START', code });
      const body = { code, expires_at: new Date(Date.now() + 7200e3).toISOString() };
      if (mode === 'contract' && be.startCaps) body.caps = { dedupe: true };
      return json(200, body);
    }
    if ((m = url.pathname.match(/^\/api\/mic\/([A-Z0-9]+)\/stop$/)) && method === 'POST') {
      be.log.push({ t: Date.now(), m: 'STOP', code: m[1], failed: be.stopFail });
      if (be.stopFail) return route.abort('internetdisconnected').catch(() => {});
      const s = be.sessions.get(m[1]);
      if (!s || (mode === 'legacy' && s.ended)) return json(404, { error: 'Session not found.' });
      if (mode === 'legacy') { s.ended = true; return json(200, { ok: true }); }  /* deleted, as far as any client can tell */
      if (be.stopHook) { const h = be.stopHook; be.stopHook = null; h(m[1]); }
      s.ended = true;
      return json(200, { ok: true, transcript: be.textOf(m[1]), ended: true });
    }
    if ((m = url.pathname.match(/^\/api\/mic\/([A-Z0-9]+)$/)) && method === 'GET') {
      if (be.getFail) return route.abort('internetdisconnected').catch(() => {});
      const s = be.sessions.get(m[1]);
      if (!s || (mode === 'legacy' && s.ended)) return json(404, { error: 'Session not found.' });
      if (mode === 'legacy') return json(200, { transcript: be.textOf(m[1]), updated_at: new Date().toISOString() });
      return json(200, { transcript: be.textOf(m[1]), updated_at: new Date().toISOString(), ended: !!s.ended });
    }
    if ((m = url.pathname.match(/^\/api\/mic\/([A-Z0-9]+)\/audio$/)) && method === 'POST') {
      let body = {};
      try { body = JSON.parse(req.postData() || '{}'); } catch (_) {}
      const code = m[1], s = be.sessions.get(code);
      const post = { t: Date.now(), code, clip: clipOf(body.audio), seq: body.seq, clipId: body.clipId, clipT: body.t, status: 0 };
      post.attempt = be.posts.filter(p => p.code === code && p.clip === post.clip).length + 1;
      const hook = be.hook ? be.hook(post) : null;
      be.posts.push(post);
      if (be.net === 'down' || hook === 'offline') { post.status = 'offline'; return route.abort('internetdisconnected').catch(() => {}); }
      if (typeof hook === 'number') await sleep(hook);
      if (hook === 'end' && s) s.ended = true;
      const store = () => {
        s.rows.push({ clip: post.clip });
        if (typeof body.clipId === 'string') s.ids.add(body.clipId);
      };
      let status = 200, answer = { ok: true, added: 14 };
      if (mode === 'legacy') {
        if (!s || s.ended) { status = 404; answer = { error: 'Session not found or expired.' }; }
        else if (hook === 'hang') { post.status = 'hung'; return new Promise(() => {}); }
        else if (hook === 'refuse') { status = 502; answer = { error: 'The audio could not be transcribed.', code: 'ai-unknown', retryable: false }; }
        else if (hook === 'quota') { status = 502; answer = { error: 'The transcription service is out of credit.', code: 'ai-quota', retryable: false }; }
        else if (hook === 'busy') { status = 503; answer = { error: 'Busy.', code: 'ai-overloaded', retryable: true }; }
        else store();
      } else if (!s) { status = 404; answer = { error: 'Session not found.' }; }
      else if (typeof body.clipId === 'string' && s.ids.has(body.clipId)) { answer = { ok: true, duplicate: true, added: 0 }; }
      else if (s.ended) { status = 410; answer = { error: 'This phone recording session has ended.', code: 'MIC_SESSION_ENDED', retryable: false }; }
      else if (hook === 'no-access') { status = 402; answer = { error: 'No active access.', code: 'NO_ACCESS', retryable: false }; }
      else if (hook === 'forbidden') { status = 403; answer = { error: 'Forbidden.' }; }
      else if (hook === 'quota') { status = 502; answer = { error: 'The audio could not be transcribed.', code: 'ai-quota', retryable: false }; }
      else if (hook === 'refuse') { status = 422; answer = { error: 'This clip could not be read as audio.', code: 'AUDIO_UNREADABLE', retryable: false }; }
      else if (hook === 'busy') { status = 503; answer = { error: 'Busy.', code: 'ai-overloaded', retryable: true }; }
      else if (hook === 'hang') { store(); post.status = 'hung'; return new Promise(() => {}); }
      else store();
      /* the capability marker (micfix-1.2.0): every accepted clip says the server dedupes */
      if (mode === 'contract' && status === 200) { answer.dedupe = true; if (typeof body.clipId === 'string') answer.clipId = body.clipId; }
      post.status = status;
      be.log.push({ t: Date.now(), m: 'AUDIO', code, clip: post.clip, status, dup: !!answer.duplicate });
      if (hook === 'lose-reply') { post.status = 'reply-lost'; return route.abort('connectionreset').catch(() => {}); }
      return json(status, answer);
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
    return route.fulfill({ status: 503, body: 'x' }).catch(() => {});
  };
  return be;
}

/* Tags every audio Blob with its recording index; shortens the 8 s segment;
   keeps every microphone stream and recorder the page opens, so a test can
   ask whether any is still live. */
function pageInit(segMs) {
  const NativeBlob = window.Blob;
  let made = 0;
  /* a recorder segment: an audio Blob built from the recorder's own chunks */
  function TaggedBlob(parts, options) {
    if (options && /^audio\//.test(String(options.type || '')) && Array.isArray(parts) && parts.length && parts.every(x => x instanceof NativeBlob)) {
      return new NativeBlob(['CLIP' + (++made) + '|'].concat(parts), options);
    }
    return new NativeBlob(parts, options);
  }
  TaggedBlob.prototype = NativeBlob.prototype;
  window.Blob = TaggedBlob;
  window.__clipsMade = () => made;
  window.__streams = [];
  try {
    const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md);
    md.getUserMedia = function (c) { return gum(c).then(s => { window.__streams.push(s); return s; }); };
  } catch (e) {}
  /* when each recorder segment began (clip n is the n-th start); the local
     audio backup's own recorder starts with a timeslice and is not a clip.
     __failNextStart: the next segment's start throws, once. */
  window.__recStarts = [];
  window.__recs = [];
  window.__failNextStart = false;
  try {
    const nativeStart = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function () {
      window.__recs.push(this);
      if (arguments.length) this.__backup = true;
      else {
        if (window.__failNextStart) { window.__failNextStart = false; throw new Error('the next part could not start (test)'); }
        window.__recStarts.push(Date.now());
      }
      return nativeStart.apply(this, arguments);
    };
  } catch (e) {}
  window.__live = () => ({
    tracks: window.__streams.reduce((n, s) => n + s.getTracks().filter(t => t.readyState === 'live').length, 0),
    lane: window.__recs.filter(r => !r.__backup && r.state !== 'inactive').length,
    backup: window.__recs.filter(r => r.__backup && r.state !== 'inactive').length
  });
  /* every line the Easy engine's toast shows, with the recorder's status then */
  window.__toasts = [];
  const hook = el => {
    if (el.__mlsObs) return;
    const note = () => { const d = window.__mlsDirectPhoneCapture; window.__toasts.push({ text: el.textContent, status: d ? String(d.state().status) : '' }); };
    el.__mlsObs = new MutationObserver(note);
    el.__mlsObs.observe(el, { childList: true, characterData: true, subtree: true });
  };
  document.addEventListener('DOMContentLoaded', () => {
    const find = () => { const el = document.getElementById('ez3Toast'); if (el) hook(el); };
    new MutationObserver(find).observe(document.body, { childList: true });
    find();
  });
  const nativeSetTimeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) { return nativeSetTimeout.call(window, fn, ms === 8000 ? segMs : ms, ...rest); };
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
  const ctx = await browser.newContext(L.ctx);
  await ctx.grantPermissions(['microphone'], { origin });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('sf_session', 'ui-harness@mlsscribe.test'); sessionStorage.setItem('sf_bk_token', 'harness-token'); } catch (e) {} });
  await ctx.addInitScript(pageInit, SEG_MS);
  if (L.noSpeech) {
    await ctx.addInitScript(() => {
      try { delete window.webkitSpeechRecognition; delete window.SpeechRecognition; } catch (e) {}
      try { Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true }); } catch (e) {}
    });
  }
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
    const day = (typeof _acctTodayKey === 'function') ? _acctTodayKey() : new Date().toISOString().slice(0, 10);
    const pts = getPatients();
    window._calAppts = pts.slice(0, 4).map((p, i) => ({
      id: 'appt-t' + i, athena_appointment_id: String(81000 + i), name: p.name, dob: p.dob, mrn: p.mrn, athenaId: p.athenaId, appt_date: day, day_local: day,
      start_at: day + 'T' + String(9 + i).padStart(2, '0') + ':00:00', reason: 'Follow up', providerName: 'Sample Provider, MD'
    }));
    try { if (window.__mlsDaySwitch && typeof window.__mlsDaySwitch.setDay === 'function') window.__mlsDaySwitch.setDay(day); } catch (e) {}
    try { window.dispatchEvent(new Event('mls:calendar-updated')); } catch (e) {}
    try { if (window.__mlsPhoneUI && typeof window.__mlsPhoneUI.render === 'function') window.__mlsPhoneUI.render(true); } catch (e) {}
    /* the Easy engine's toast, which the phone shell does not always create */
    if (!document.getElementById('ez3Toast')) { const el = document.createElement('div'); el.id = 'ez3Toast'; document.body.appendChild(el); }
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

async function tap(page, sel) {
  const c = await page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; }, sel);
  if (!c) throw new Error('nothing to tap at ' + sel);
  await page.touchscreen.tap(c.x, c.y);
}

/* Open Ada's appointment: the phone layout's day list, or the Easy engine. */
async function openVisit(page) {
  if (L.key === 'phone') {
    /* the day list can re-render under the first tap (the stub answers the
       shell's own calendar sync with a 503), so the tap is tried again */
    for (let i = 0; ; i++) {
      await until('the phone day list', () => page.evaluate(() => !!document.querySelector('#mlsPh3 [data-act="open"]')), 30000);
      await dismiss(page);
      await tap(page, '#mlsPh3 [data-act="open"]');
      const open = await until('the phone visit screen', () => page.evaluate(() => !!document.querySelector('#mlsPh3Go[data-act="record"]')), 8000).catch(() => false);
      if (open) return;
      if (i === 2) throw new Error('the phone visit screen never opened');
    }
  }
  ok(await page.evaluate(() => { const r = window.__mlsEasyV32 && window.__mlsEasyV32.remote; return !!(r && r.startVisitFor('appt-t0', {})); }), 'the synthetic appointment could not be opened');
  await page.waitForTimeout(2500);
  await dismiss(page);
  await until('Ada is the active patient', () => page.evaluate(() => (activePatient() || {}).name === 'Ada Sample'));
}

const state = page => page.evaluate(() => {
  const d = window.__mlsDirectPhoneCapture;
  const go = document.getElementById('mlsPh3Go');
  return {
    direct: d ? d.state() : null,
    transcript: (document.getElementById('transcript') || {}).value || '',
    act: go ? go.getAttribute('data-act') || '' : '',
    go: go ? go.textContent.trim() : '',
    goDisabled: !!(go && go.disabled),
    bar: ((document.querySelector('#mlsPh3Act .ph3-sub') || {}).textContent || '').trim(),
    acts: [...document.querySelectorAll('#mlsPh3Act [data-act]')].map(b => b.getAttribute('data-act')),
    said: window.__said.slice(-6),
    made: window.__clipsMade(),
    starts: window.__recStarts.slice()
  };
});

async function startRecording(page) {
  await dismiss(page);
  if (L.key === 'phone') {
    await until('Start recording', () => page.evaluate(() => !!document.querySelector('#mlsPh3Go[data-act="record"]')), 15000);
    await tap(page, '#mlsPh3Go[data-act="record"]');
  } else {
    ok(await page.evaluate(() => window.__mlsEasyV32.remote.record()), 'the Easy engine refused to start recording');
  }
  await page.waitForTimeout(800);
  if (await page.evaluate(() => !!(document.getElementById('_mlsAskYes') && document.getElementById('_mlsAskYes').offsetParent))) {
    if (L.key === 'phone') await tap(page, '#_mlsAskYes'); else await page.locator('#_mlsAskYes').click();
  }
  await until('recording', async () => ((await state(page)).direct || {}).status === 'recording', 15000);
}

async function stopRecording(page) {
  if (L.key === 'phone') await tap(page, '#mlsPh3Go[data-act="stop"]');
  else await page.evaluate(() => window.__mlsEasyV32.remote.stopRecording());
}
async function idle(page, ms) {
  return until('the recorder is idle', async () => { const s = await state(page); return s.direct && s.direct.status === 'idle' && s; }, ms || 30000);
}
/* Every microphone stream the page opened has ended and every recorder (the
   lane's and the local audio backup's) is inactive. */
async function released(page) {
  return until('every microphone released', async () => { const x = await page.evaluate(() => window.__live()); return (x.tracks === 0 && x.lane === 0 && x.backup === 0) && x; }, 4000)
    .catch(() => page.evaluate(() => window.__live()));
}
function allReleased(x) { return !!x && x.tracks === 0 && x.lane === 0 && x.backup === 0; }

const backups = page => page.evaluate(() => new Promise(resolve => {
  const r = indexedDB.open('mls_rec_backup');
  r.onsuccess = () => {
    const d = r.result;
    try {
      const q = d.transaction('sessions', 'readonly').objectStore('sessions').getAll();
      q.onsuccess = () => { resolve(q.result.map(x => ({ sess: x.sess, at: x.at, visit: x.visit || '', clean: x.clean, open: x.open }))); d.close(); };
      q.onerror = () => { resolve([]); d.close(); };
    } catch (e) { resolve([]); d.close(); }
  };
  r.onerror = () => resolve([]);
}));
/* The local audio backups made since `since` (this recording's). */
async function backupsSince(page, since) {
  await sleep(600);
  return (await backups(page)).filter(b => b.sess >= since - 1500);
}

/* Runs every named group of checks and reports all that fail, so one
   scenario that covers several findings says which of them are broken. */
async function groups(list) {
  const failed = [];
  for (const [name, fn] of list) {
    try { await fn(); } catch (e) { failed.push(name + ': ' + String(e && e.message || e).split('\n')[0].slice(0, 300)); }
  }
  if (failed.length) throw new Error(failed.join(' || '));
}

/* ---- A ------------------------------------------------------------------- */
async function retriedUntilSent(page, be, mode) {
  const old = Date.now() - 25 * 60 * 60 * 1000;
  await page.evaluate(at => new Promise(resolve => {
    const r = indexedDB.open('mls_rec_backup', 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['sess', 'seq'] }); if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'sess' }); };
    r.onsuccess = () => { const d = r.result; const tx = d.transaction(['sessions', 'chunks'], 'readwrite'); tx.objectStore('sessions').put({ sess: at, at, patient: 'Old visit', mime: 'audio/webm', open: 0 }); tx.objectStore('chunks').put({ sess: at, seq: 0, blob: new Blob(['x']), size: 1 }); tx.oncomplete = () => { d.close(); resolve(); }; };
  }), old);
  let downSince = 0;
  be.hook = p => {
    if (p.clip === 2 && !downSince) downSince = Date.now();
    return (p.clip >= 2 && downSince && Date.now() - downSince < 6500) ? 'offline' : null;
  };
  await startRecording(page);
  const code = be.current();
  const waiting = await until('the phone shows clips waiting', async () => { const s = await state(page); return /waiting to upload/.test(s.bar) && s; }, 20000).catch(() => null);
  await until('clip 2 landed after the outage', () => be.clips(code).includes(2), 30000).catch(() => null);
  await until('two more clips accepted after the outage', () => be.clips(code).filter(n => n > 2).length >= 2, 20000).catch(() => null);
  const lastAccepted = Math.max(0, ...be.clips(code));
  be.hook = p => (p.clip > lastAccepted ? 3000 : null);  /* the last clip is slow: Stop has to finish */
  await stopRecording(page);
  const samples = [];
  for (let i = 0; i < 12; i++) { samples.push(await state(page)); if (samples[samples.length - 1].direct.status === 'idle') break; await sleep(250); }
  const s = await idle(page);
  be.hook = null;
  const made = s.made;
  const retried = be.posts.filter(p => p.code === code && p.clip === 2);
  await groups([
    ['finding 4 (a failed clip is kept, retried and shown)', () => {
      ok(waiting, `${mode} A: while clips could not upload the phone never said so on its bar`);
      ok(retried.length >= 2 && retried[retried.length - 1].t - downSince >= 6500, `${mode} A: clip 2 was not kept and retried past the 6.5 s outage (old limit 3.5 s): ${retried.length} tries over ${retried.length ? retried[retried.length - 1].t - downSince : 0} ms`);
      eq(be.clips(code), range(1, made), `${mode} A: clips were lost or out of order: recorded ${made}, MLS has ${JSON.stringify(be.clips(code))}`);
      const expected = range(1, made).map(n => 'Clip ' + n + ' words.').join(' ');
      eq(s.transcript.trim(), expected, `${mode} A: the visit transcript is not every clip in order: ${JSON.stringify(s.transcript)}`);
    }],
    ['C1 (the clip start time t and one clipId per clip)', () => {
      for (const p of be.posts.filter(x => x.code === code)) {
        const began = s.starts[p.clip - 1];
        ok(Number.isFinite(p.clipT) && Math.abs(p.clipT - began) < 250, `${mode} A: clip ${p.clip} was not sent with the time it began recording (t ${p.clipT}, began ${began})`);
        ok(typeof p.clipId === 'string' && p.clipId.length > 0 && p.clipId.length <= 64, `${mode} A: clip ${p.clip} was sent without a clipId`);
        ok(p.seq === undefined, `${mode} A: clip ${p.clip} still carries the retired seq`);
      }
      eq(new Set(retried.map(p => p.clipId)).size, 1, `${mode} A: the retries of clip 2 did not repeat one clipId`);
      eq(new Set(retried.map(p => p.clipT)).size, 1, `${mode} A: the retries of clip 2 did not repeat one t`);
      const ts = range(1, made).map(n => (be.posts.find(p => p.code === code && p.clip === n) || {}).clipT);
      ok(ts.every((t, i) => i === 0 || t > ts[i - 1]), `${mode} A: clip start times are not strictly increasing: ${JSON.stringify(ts)}`);
    }],
    ['finding 7 (Finishing, never Recording again)', () => {
      const finishing = samples.filter(x => x.direct.status === 'stopping');
      ok(finishing.length > 0, `${mode} A: no finishing window was observed`);
      for (const x of finishing) ok(!/^Recording\b/.test(x.bar) && x.act !== 'stop', `${mode} A: after Stop the bar showed Recording with a live Stop button: ${JSON.stringify({ bar: x.bar, go: x.go, act: x.act })}`);
      ok(finishing.some(x => /Finishing/.test(x.go + ' ' + x.bar)), `${mode} A: the finishing state was not shown`);
    }],
    ['finding 6 (no local audio backup older than 24 h)', async () => {
      ok(!(await backups(page)).some(b => b.sess === old), `${mode} A: a backup older than 24 h is still on this device`);
    }],
    ['finding 6 (a saved visit keeps no local audio backup)', async () => {
      ok((await backups(page)).some(b => b.sess !== old), `${mode} A: this recording left no backup to check`);
      await page.evaluate(() => saveDraft());
      const left = await until('the saved visit\'s backup deleted', async () => { const b = (await backups(page)).filter(x => x.sess !== old); return b.length === 0 && b; }, 8000).catch(async () => (await backups(page)).filter(x => x.sess !== old));
      eq(left, [], `${mode} A: the saved visit's audio is still kept on this device`);
    }]
  ]);
}

/* ---- B ------------------------------------------------------------------- */
async function lostReplyLandsOnce(page, be, mode) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  be.hook = p => (p.clip === first + 1 && p.attempt === 1 ? 'lose-reply' : null);
  await startRecording(page);
  const code = be.current();
  if (mode === 'contract') eq(await page.evaluate(() => _mlsDirectPhone.dedupe), true, 'contract B: /start said MLS dedupes a re-sent clip (caps.dedupe), and the recorder did not take it');
  await until('the third clip accepted', () => be.clips(code).includes(first + 2), 30000);
  be.hook = null;
  await stopRecording(page);
  const s = await idle(page);
  const expected = range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ');
  ok(s.transcript.trim().endsWith(expected), `${mode} B: a clip whose reply was lost landed twice or not at all: ${JSON.stringify(s.transcript.slice(-200))}`);
  eq(be.clips(code), range(first, s.made), `${mode} B: the server stored a clip twice`);
}

/* ---- C ------------------------------------------------------------------- */
async function unreadableNotResent(page, be, mode) {
  const clipsBefore = await page.evaluate(() => window.__clipsMade());
  const first = clipsBefore + 2;
  be.hook = p => (p.clip === first ? 'refuse' : null);
  await startRecording(page);
  const code = be.current();
  await until('the clip after the unreadable one accepted', () => be.clips(code).includes(first + 1), 30000);
  const said = await until('the phone said a clip could not be used', async () => { const s = await state(page); return (s.said.concat([s.bar]).some(x => /could not (be read|accept)/.test(x)) && s); }, 5000).catch(() => null);
  ok(said, `${mode} C: the phone did not say that a clip could not be used`);
  await stopRecording(page);
  await idle(page);
  be.hook = null;
  eq(be.posts.filter(p => p.code === code && p.clip === first).length, 1, `${mode} C: a retryable:false clip was sent again`);
}

/* ---- D ------------------------------------------------------------------- */
async function endedSessionStops(page, be, mode) {
  const clipsBefore = await page.evaluate(() => window.__clipsMade());
  const target = clipsBefore + 2;
  be.hook = p => (p.clip === target ? 'end' : null);
  await startRecording(page);
  const code = be.current();
  const s = await idle(page, 30000).catch(() => null);
  be.hook = null;
  ok(s, `${mode} D: recording went on after the session ended`);
  eq(be.posts.filter(p => p.code === code && p.clip === target).length, 1, `${mode} D: a clip for an ended session was sent again`);
  await sleep(SEG_MS + 1000);
  ok(!be.posts.some(p => p.code === code && p.clip > target), `${mode} D: clips kept going to an ended session`);
  const st = await state(page);
  ok(/closed this recording session/.test(st.bar + ' ' + st.said.join(' ')), `${mode} D: the phone did not say the session ended: ${JSON.stringify({ bar: st.bar, said: st.said })}`);
  const live = await released(page);
  ok(allReleased(live), `${mode} D (${L.key}): after the session ended a microphone is still live (the recorder's, or the local audio backup's): ${JSON.stringify(live)}`);
}

/* ---- E ------------------------------------------------------------------- */
async function micEndsKeepsAudio(page, be, mode, ctx, origin) {
  const clipsBefore = await page.evaluate(() => window.__clipsMade());
  const slow = clipsBefore + 2;
  be.hook = p => (p.clip === slow ? 2500 : null);
  await startRecording(page);
  const code = be.current();
  await until('clip 2 in flight', () => be.posts.some(p => p.code === code && p.clip === slow), 20000);
  await sleep(1200);
  await ctx.clearPermissions();
  const s = await idle(page, 30000).catch(() => null);
  be.hook = null;
  await ctx.grantPermissions(['microphone'], { origin });
  ok(s, `${mode} E: the recorder never settled after the microphone ended`);
  const made = (await state(page)).made;
  const inProgress = made;
  ok(be.clips(code).includes(slow), `${mode} E: the clip the server was transcribing was lost (${JSON.stringify(be.clips(code))})`);
  ok(inProgress > slow && be.clips(code).includes(inProgress), `${mode} E: the clip in progress when the microphone ended was never uploaded (made ${made}, MLS has ${JSON.stringify(be.clips(code))})`);
  const stopAt = be.log.findIndex(l => l.m === 'STOP' && l.code === code);
  const lastAudio = be.log.map((l, i) => (l.m === 'AUDIO' && l.code === code ? i : -1)).filter(i => i >= 0).pop();
  ok(stopAt > lastAudio, `${mode} E: the session was closed under a clip still being transcribed`);
  const st = await state(page);
  ok(/microphone stopped/.test(st.bar + ' ' + st.said.join(' ')), `${mode} E: the phone did not say why recording stopped: ${JSON.stringify({ bar: st.bar, said: st.said })}`);
  ok(st.transcript.includes('Clip ' + slow + ' words.') && st.transcript.includes('Clip ' + inProgress + ' words.'), `${mode} E: the visit transcript is missing the last clips: ${JSON.stringify(st.transcript.slice(-160))}`);
  const live = await released(page);
  ok(allReleased(live), `${mode} E: after the microphone ended a recorder is still live: ${JSON.stringify(live)}`);
}


/* ---- F ------------------------------------------------------------------- */
async function fifoKeepsSpeakingOrder(page, be, mode) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  const stuck = first + 1;
  let since = 0;
  be.hook = p => { if (p.clip !== stuck) return null; if (!since) since = Date.now(); return Date.now() - since < 7000 ? 'busy' : null; };
  await startRecording(page);
  const code = be.current();
  await until('the stuck clip refused with a retryable answer', () => be.posts.some(p => p.code === code && p.clip === stuck && p.status === 503), 20000);
  await until('the stuck clip accepted at last', () => be.clips(code).includes(stuck), 40000);
  await until('a later clip accepted', () => be.clips(code).includes(stuck + 1), 20000);
  const stuckAt = be.log.find(l => l.m === 'AUDIO' && l.code === code && l.clip === stuck && l.status === 200).t;
  const aheadOfIt = be.posts.filter(p => p.code === code && p.clip > stuck && p.t < stuckAt).map(p => p.clip);
  await stopRecording(page);
  const s = await idle(page);
  be.hook = null;
  const clips = range(first, s.made);
  eq(aheadOfIt, [], `${mode} F: a later clip was sent ahead of one still failing, so MLS, which adds clips as they arrive, would put it out of speaking order: ${JSON.stringify(aheadOfIt)}`);
  eq(be.clips(code), clips, `${mode} F: MLS does not hold every clip once, in speaking order: ${JSON.stringify(be.clips(code))}`);
  const expected = clips.map(n => 'Clip ' + n + ' words.').join(' ');
  ok(s.transcript.trim().endsWith(expected), `${mode} F: the visit transcript is not every clip once, in speaking order: ${JSON.stringify(s.transcript.slice(-320))}`);
}

/* ---- G ------------------------------------------------------------------- */
async function deadlineWaitsForTheMarker(page, be, mode) {
  /* A short deadline once MLS has said it dedupes, so the test does not wait
     40 s; before that, the recorder must not use it at all. */
  await page.evaluate(() => { _mlsDirectPhone.attemptBaseMs = 2000; });
  be.startCaps = false;   /* the marker comes with an accepted clip */
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const stall = first + 1;
    const tries = code => be.posts.filter(p => p.code === code && p.clip === stall);
    if (mode === 'contract') {
      be.hook = p => (p.clip === stall && p.attempt === 1 ? 'hang' : null);
      await startRecording(page);
      const code = be.current();
      const again = await until('the stalled clip sent again', () => tries(code).length >= 2, 25000).catch(() => false);
      ok(again, `contract G: an attempt that never settled was never sent again, though MLS had said it dedupes`);
      await until('a later clip accepted', () => be.clips(code).includes(stall + 1), 20000).catch(() => null);
      await stopRecording(page);
      const s = await idle(page, 30000).catch(() => null);
      be.hook = null;
      ok(s, `contract G: Stop never finished behind a request that never settled`);
      const t = tries(code);
      eq(new Set(t.map(p => p.clipId)).size, 1, `contract G: the stalled clip was sent again with a different clipId`);
      eq(new Set(t.map(p => p.clipT)).size, 1, `contract G: the stalled clip was sent again with a different t`);
      ok(t[1].t - t[0].t >= 1500, `contract G: the stalled request was not given its deadline (${t[1].t - t[0].t} ms)`);
      eq(be.clips(code), range(first, s.made), `contract G: the stalled clip was lost or stored twice: ${JSON.stringify(be.clips(code))}`);
      ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `contract G: the visit transcript is not every clip once, in order: ${JSON.stringify(s.transcript.slice(-240))}`);
    } else {
      /* today's server: a slow but successful transcription, and no marker */
      be.hook = p => (p.clip === stall && p.attempt === 1 ? 8000 : null);
      await startRecording(page);
      const code = be.current();
      await until('the slow clip answered', () => be.clips(code).includes(stall), 25000);
      await until('a later clip accepted', () => be.clips(code).includes(stall + 1), 20000).catch(() => null);
      await stopRecording(page);
      const s = await idle(page, 30000).catch(() => null);
      be.hook = null;
      ok(s, `legacy G: Stop never finished`);
      eq(tries(code).length, 1, `legacy G: a slow answer from a server that has not said it dedupes was given up and the clip sent again, so it was added twice (attempts ${tries(code).length})`);
      eq(be.clips(code), range(first, s.made), `legacy G: a clip was stored twice or lost: ${JSON.stringify(be.clips(code))}`);
      ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `legacy G: the visit transcript is not every clip once, in order: ${JSON.stringify(s.transcript.slice(-240))}`);
    }
  } finally {
    be.startCaps = true;
    await page.evaluate(() => { _mlsDirectPhone.attemptBaseMs = 40000; });
  }
}

/* ---- H ------------------------------------------------------------------- */
async function accountRefusalStops(page, be, mode, kind, why) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  const saidAt = await page.evaluate(() => window.__said.length);
  const since = Date.now();
  let refusing = false;
  be.hook = () => (refusing ? kind : null);
  await startRecording(page);
  const code = be.current();
  await until('the first clip accepted', () => be.clips(code).includes(first), 20000);
  refusing = true;
  await until('a refusal', () => be.posts.some(p => p.code === code && [402, 403].includes(p.status)), 20000);
  const s = await idle(page, 20000).catch(() => null);
  const now = await state(page);
  ok(s, `${mode} H ${kind} (${L.key}): the refusal did not stop recording: ${JSON.stringify({ direct: now.direct, bar: now.bar, acts: now.acts })}`);
  const live = await released(page);
  ok(allReleased(live), `${mode} H ${kind} (${L.key}): after the refusal a microphone is still live (the recorder's, or the local audio backup's): ${JSON.stringify(live)}`);
  const postsAtStop = be.posts.filter(p => p.code === code).length;
  await sleep(SEG_MS + 1000);
  eq(be.posts.filter(p => p.code === code).length, postsAtStop, `${mode} H ${kind}: clips were sent after the refusal`);
  const said = await page.evaluate(n => window.__said.slice(n), saidAt);
  const words = s.bar + ' ' + said.join(' ');
  const missing = (s.made - first + 1) - be.clips(code).length;
  ok(missing >= 1, `${mode} H ${kind}: no clip was refused`);
  ok(why.test(words), `${mode} H ${kind}: the doctor was not told plainly why recording stopped: ${JSON.stringify(words.slice(0, 600))}`);
  ok(new RegExp('\\b' + missing + ' recording segments? could not be added to the transcript').test(words), `${mode} H ${kind}: the doctor was not told that ${missing} clip(s) could not be added: ${JSON.stringify(words.slice(0, 600))}`);
  ok(/audio is kept on this device, in the MLS recording backup/.test(words), `${mode} H ${kind}: the doctor was not told the audio is kept on this device: ${JSON.stringify(words.slice(0, 600))}`);
  ok(!s.acts.some(a => /^direct-/.test(a)), `${mode} H ${kind}: the phone still offers held-clip controls: ${JSON.stringify(s.acts)}`);
  const mine = await backupsSince(page, since);
  ok(mine.length > 0 && mine.every(b => b.clean !== 1), `${mode} H ${kind}: the local audio backup of a recording MLS refused was marked clean (it would be deleted when the visit is saved): ${JSON.stringify(mine)}`);
  const gen = await page.evaluate(() => { try { const r = _mlsGenerationBlockReason(document.getElementById('transcript').value); return r ? r.code : ''; } catch (e) { return String(e); } });
  ok(gen !== 'capture-finishing', `${mode} H ${kind}: writing the note is still refused as if the recording were finishing`);
  if (L.key === 'ipad') {
    /* the full layout is not left stuck: recording starts again */
    await startRecording(page);
    await stopRecording(page);
    await idle(page, 30000);
  }
}
async function serviceRefusalKeepsRecording(page, be, mode) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  let until9 = 0;
  be.hook = () => (Date.now() < until9 ? 'quota' : null);
  await startRecording(page);
  const code = be.current();
  await until('the first clip accepted', () => be.clips(code).includes(first), 20000);
  until9 = Date.now() + 9000;
  await until('an ai-quota refusal', () => be.posts.some(p => p.code === code && p.status === 502), 20000);
  const head = be.posts.find(p => p.code === code && p.status === 502).clip;
  const during = await until('the phone says MLS cannot add clips and keeps recording', async () => {
    const x = await state(page);
    return x.direct.status === 'recording' && /MLS cannot add clips right now[^;]*; \d+ waiting, retrying/.test(x.bar) && x;
  }, 12000).catch(() => null);
  const now = await state(page);
  ok(during, `${mode} H quota: during a refusal on MLS's side the phone did not keep recording and say so: ${JSON.stringify({ direct: now.direct, bar: now.bar, said: now.said })}`);
  await until('the refused clip accepted once MLS recovered', () => be.clips(code).includes(head), 40000);
  await until('the clips waiting behind it accepted', () => be.clips(code).includes(head + 2), 20000).catch(() => null);
  const tries = be.posts.filter(p => p.code === code && p.clip === head).map(p => p.t);
  const gaps = tries.slice(1).map((t, i) => t - tries[i]);
  ok(gaps.length >= 1 && gaps.every(g => g >= 5500), `${mode} H quota: the refused clip was not retried with a backoff of 6 s or more: ${JSON.stringify(gaps)}`);
  await stopRecording(page);
  const s = await idle(page, 30000);
  be.hook = null;
  eq(be.clips(code), range(first, s.made), `${mode} H quota: after MLS recovered the clips did not all land once, in order: ${JSON.stringify(be.clips(code))}`);
  ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `${mode} H quota: the visit transcript is missing clips: ${JSON.stringify(s.transcript.slice(-240))}`);
}
async function refusals(page, be, mode) {
  const failed = [];
  const variants = mode === 'legacy' ? [['quota']]
    : L.key === 'ipad' ? [['no-access', /does not have active access/]]
      : [['no-access', /does not have active access/], ['forbidden', /server 403/]];
  for (const [kind, why] of variants) {
    try {
      if (kind === 'quota') await serviceRefusalKeepsRecording(page, be, mode);
      else await accountRefusalStops(page, be, mode, kind, why);
    } catch (e) { failed.push(kind + ': ' + String(e && e.message || e).split('\n')[0].slice(0, 700)); }
    be.hook = null;
    await page.evaluate(() => { try { const d = window.__mlsDirectPhoneCapture; if (d.state().status !== 'idle') d.stop('test-reset'); } catch (e) {} });
    await idle(page, 30000).catch(() => {});
  }
  if (failed.length) throw new Error(failed.join(' || '));
}

/* ---- I ------------------------------------------------------------------- */
async function stopSaysDoneOnlyWhenDone(page, be, mode) {
  await sleep(200);
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  await startRecording(page);
  const code = be.current();
  await until('two clips accepted', () => be.clips(code).filter(n => n >= first).length >= 2, 20000);
  const accepted = Math.max(...be.clips(code));
  be.hook = p => (p.clip > accepted ? 2500 : null);  /* the last clip is slow */
  /* one press, and a second activation in the same task (a double tap) */
  await page.evaluate(() => { window.__toasts.length = 0; document.querySelector('#mlsPh3Go[data-act="stop"]').click(); window.__mlsEasyV32.remote.stopRecording(); });
  const s = await idle(page);
  await sleep(700);
  be.hook = null;
  const toasts = await page.evaluate(() => window.__toasts.slice());
  const done = toasts.filter(t => /Everything captured is/.test(t.text));
  eq(done.filter(t => t.status !== 'idle').map(t => t.text + ' @' + t.status), [], `${mode} I: Stop said the recording was complete while it was still finishing`);
  eq(done.length, 1, `${mode} I: the finished recording was not said exactly once: ${JSON.stringify(toasts)}`);
  eq(toasts.filter(t => /Finishing the recording/.test(t.text)).length, 1, `${mode} I: a second Stop press during the first was not ignored: ${JSON.stringify(toasts)}`);
  eq(be.clips(code), range(first, s.made), `${mode} I: clips were lost at Stop: ${JSON.stringify(be.clips(code))}`);
  const live = await released(page);
  ok(allReleased(live), `${mode} I: after a normal Stop a microphone is still live (the recorder's, or the local audio backup's): ${JSON.stringify(live)}`);
}

/* ---- J ------------------------------------------------------------------- */
async function nextPartCannotStart(page, be, mode) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  const saidAt = await page.evaluate(() => window.__said.length);
  await startRecording(page);
  const code = be.current();
  await until('the first clip accepted', () => be.clips(code).includes(first), 20000);
  await page.evaluate(() => { window.__failNextStart = true; });
  const s = await idle(page, 20000).catch(() => null);
  ok(s, `${mode} J (${L.key}): recording did not stop when its next part could not start`);
  const live = await released(page);
  ok(allReleased(live), `${mode} J (${L.key}): after the next part could not start a microphone is still live (the recorder's, or the local audio backup's): ${JSON.stringify(live)}`);
  const said = await page.evaluate(n => window.__said.slice(n), saidAt);
  ok(/could not start the next part/.test(s.bar + ' ' + said.join(' ')), `${mode} J: the doctor was not told why recording stopped: ${JSON.stringify({ bar: s.bar, said })}`);
  eq(be.clips(code), range(first, s.made), `${mode} J: a clip made before the stop did not land: ${JSON.stringify(be.clips(code))}`);
}

/* ---- K ------------------------------------------------------------------- */
async function stopNeverClaimsWhatItDidNotSee(page, be, mode) {
  const failed = [];
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const saidAt = await page.evaluate(() => window.__said.length);
    const since = Date.now();
    await startRecording(page);
    const code = be.current();
    await until('the second clip read into the visit', async () => (await state(page)).transcript.includes('Clip ' + (first + 1) + ' words.'), 25000);
    be.getFail = true; be.stopFail = true;
    await page.evaluate(() => { window.__toasts.length = 0; });
    await stopRecording(page);
    const s = await idle(page, 40000);
    await sleep(700);
    be.getFail = false; be.stopFail = false;
    const toasts = await page.evaluate(() => window.__toasts.slice());
    const said = await page.evaluate(n => window.__said.slice(n), saidAt);
    const words = s.bar + ' ' + said.join(' ');
    eq(toasts.filter(t => /Everything captured is/.test(t.text)).map(t => t.text), [], `${mode} K: Stop said everything was captured though its final read and Stop both failed`);
    ok(/may be missing/.test(words), `${mode} K: Stop did not say words may be missing: ${JSON.stringify(words.slice(0, 500))}`);
    ok(/still has the audio, in the MLS recording backup/.test(words), `${mode} K: Stop did not say this device still has the audio: ${JSON.stringify(words.slice(0, 500))}`);
    /* micfix-1.3.0 (R4-3): 'this device', on the iPad layout too */
    ok(/This device still has the audio/.test(words) && !/This iPhone/.test(words), `${mode} K (${L.key}): the stop note does not say 'this device': ${JSON.stringify(words.slice(0, 500))}`);
    const mine = await backupsSince(page, since);
    ok(mine.length > 0 && mine.every(b => b.clean !== 1), `${mode} K: the local audio backup was marked clean though words may be missing: ${JSON.stringify(mine)}`);
    ok(be.clips(code).length >= 2, `${mode} K: the stub stored nothing`);
  } catch (e) { failed.push('read and Stop fail: ' + String(e && e.message || e).split('\n')[0].slice(0, 600)); }
  be.getFail = false; be.stopFail = false;
  if (mode === 'contract') {
    try {
      /* the final read fails, and Stop's own answer carries every word */
      const first = (await page.evaluate(() => window.__clipsMade())) + 1;
      const saidAt = await page.evaluate(() => window.__said.length);
      await startRecording(page);
      const code = be.current();
      await until('two clips accepted', () => be.clips(code).filter(n => n >= first).length >= 2, 20000);
      be.getFail = true;
      await page.evaluate(() => { window.__toasts.length = 0; });
      await stopRecording(page);
      const s = await idle(page, 40000);
      await sleep(700);
      be.getFail = false;
      const toasts = await page.evaluate(() => window.__toasts.slice());
      ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `contract K: Stop's own answer did not bring the words the failed reads missed: ${JSON.stringify(s.transcript.slice(-240))}`);
      eq(toasts.filter(t => /Everything captured is/.test(t.text)).length, 1, `contract K: a Stop that saw every word did not say so: ${JSON.stringify(toasts)}`);
      const said = await page.evaluate(n => window.__said.slice(n), saidAt);
      ok(!/may be missing/.test(s.bar + ' ' + said.join(' ')), `contract K: a Stop that saw every word said words may be missing: ${JSON.stringify({ bar: s.bar, said })}`);
    } catch (e) { failed.push('read fails, Stop answers: ' + String(e && e.message || e).split('\n')[0].slice(0, 600)); }
    be.getFail = false;
  }
  if (failed.length) throw new Error(failed.join(' || '));
}

/* ---- L ------------------------------------------------------------------- */
async function rebindWaitsForTheLastClips(page, be, mode) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  await startRecording(page);
  const code = be.current();
  await until('two clips accepted', () => be.clips(code).filter(n => n >= first).length >= 2, 20000);
  const before = await page.evaluate(() => ({ epoch: currentVisitAthenaEpoch, active: (activePatient() || {}).name || '' }));
  const accepted = Math.max(...be.clips(code));
  be.hook = p => (p.clip > accepted ? 3000 : null);  /* the last clips are slow */
  const saidAt = await page.evaluate(() => window.__said.length);
  /* New visit while it records: refused, and the recording starts to stop */
  const nv1 = await page.evaluate(() => newVisit());
  const said1 = await page.evaluate(n => window.__said.slice(n), saidAt);
  const stopping = await until('the recorder finishing its last clips', async () => { const x = await state(page); return x.direct.status === 'stopping' && x; }, 6000).catch(() => null);
  /* while it still sends them: New visit, and Start visit for another appointment */
  const saidAt2 = await page.evaluate(() => window.__said.length);
  const nv2 = await page.evaluate(() => newVisit());
  const said2 = await page.evaluate(n => window.__said.slice(n), saidAt2);
  const cal = await page.evaluate(() => { try { return calStartVisit('appt-t1'); } catch (e) { return { threw: String(e) }; } });
  const mid = await page.evaluate(() => ({ epoch: currentVisitAthenaEpoch, active: (activePatient() || {}).name || '', status: _mlsDirectPhone.status }));
  const said = await page.evaluate(n => window.__said.slice(n), saidAt);
  const s = await idle(page, 40000);
  be.hook = null;
  eq(nv1, false, `${mode} L (${L.key}): New visit went ahead while the recorder was recording`);
  ok(stopping, `${mode} L (${L.key}): New visit during a recording did not start its stop`);
  eq(nv2, false, `${mode} L (${L.key}): New visit went ahead while the recorder was still sending its last clips (${mid.status})`);
  ok(cal && cal.ok === false, `${mode} L (${L.key}): the calendar's Start visit went ahead while the recorder was still sending its last clips: ${JSON.stringify(cal)}`);
  eq({ epoch: mid.epoch, active: mid.active }, before, `${mode} L (${L.key}): the visit was re-bound while clips were still on their way`);
  ok(said.some(x => /still sending this visit/.test(x)), `${mode} L (${L.key}): the doctor was not told why nothing changed: ${JSON.stringify(said)}`);
  /* micfix-1.3.0 (R4-3): New visit stopped the recording, and says so */
  ok(said1.some(x => /^Recording stopped\. It is still sending this visit to MLS, so the visit was not changed/.test(x)) && !said1.some(x => /nothing was changed/.test(x)), `${mode} L (${L.key}): New visit stopped the recording and did not say so (or said nothing was changed): ${JSON.stringify(said1)}`);
  ok(said2.some(x => /still sending this visit to MLS, so nothing was changed/.test(x)), `${mode} L (${L.key}): New visit while the recording finished did not say nothing was changed: ${JSON.stringify(said2)}`);
  ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `${mode} L (${L.key}): clips on their way when the visit was about to change never reached it: ${JSON.stringify(s.transcript.slice(-240))}`);
}

/* ---- N ------------------------------------------------------------------- */
async function failedStartReleases(page, be, mode) {
  const saidAt = await page.evaluate(() => window.__said.length);
  be.startFail = true;
  try {
    await dismiss(page);
    if (L.key === 'phone') {
      await until('Start recording', () => page.evaluate(() => !!document.querySelector('#mlsPh3Go[data-act="record"]')), 15000);
      await tap(page, '#mlsPh3Go[data-act="record"]');
    } else await page.evaluate(() => window.__mlsEasyV32.remote.record());
    await page.waitForTimeout(800);
    if (await page.evaluate(() => !!(document.getElementById('_mlsAskYes') && document.getElementById('_mlsAskYes').offsetParent))) {
      if (L.key === 'phone') await tap(page, '#_mlsAskYes'); else await page.locator('#_mlsAskYes').click();
    }
    const said = await until('the failed start said so', async () => { const x = await page.evaluate(n => window.__said.slice(n), saidAt); return x.some(y => /could not open a secure transcription session/.test(y)) && x; }, 15000).catch(() => null);
    ok(said, `${mode} N (${L.key}): a start MLS could not open was not said`);
    await idle(page, 10000);
    const live = await released(page);
    ok(allReleased(live), `${mode} N (${L.key}): after a start that failed a microphone is still live (the local audio backup's): ${JSON.stringify(live)}`);
  } finally { be.startFail = false; }
}

/* ---- P (micfix-1.3.0, R4-1) ------------------------------------------------ */
/* The Easy/iPad room while the recorder starts, and while it still sends its
   last clips after Stop: the phase is 'finishing', #ez3Gen carries the
   disabled attribute, a real finger tap on it re-binds nothing, and a click
   that does reach its handler is refused first, in the engine's own words,
   before any binding logic. The visit (an unlinked appointment, as every
   appointment here is) keeps its binding epoch, and every clip reaches it. */
async function generateWaitsWhileFinishing(page, be, mode) {
  const first = (await page.evaluate(() => window.__clipsMade())) + 1;
  const bind = () => page.evaluate(() => ({ epoch: currentVisitAthenaEpoch, id: (currentVisitAthenaBinding || {}).id || '' }));
  const room = () => page.evaluate(() => {
    const g = document.getElementById('ez3Gen');
    let reason = '';
    try { const r = _mlsGenerationBlockReason(document.getElementById('transcript').value || 'The patient reports knee pain.'); reason = r ? r.code : ''; } catch (e) { reason = 'threw'; }
    return { status: _mlsDirectPhone.status, phase: window.__mlsEasyV32.state().phase, gen: !!g, disabled: !!(g && g.hasAttribute('disabled')), rec2: !!document.getElementById('ez3Rec2'), reason };
  });
  /* a finger on #ez3Gen, wherever the room draws it */
  const fingerOnGen = async () => {
    const c = await page.evaluate(() => { const b = document.getElementById('ez3Gen'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
    if (c) await page.touchscreen.tap(c.x, c.y);
    return !!c;
  };
  /* the visit already holds words, so Generate is on screen */
  await page.evaluate(() => {
    const t = document.getElementById('transcript');
    if (!t.value.trim()) { t.value = 'Knee pain for two weeks, worse on stairs. '; t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await page.waitForTimeout(900);
  /* 1. starting: MLS takes 2.5 s to open the session */
  be.startDelay = 2500;
  await dismiss(page);
  ok(await page.evaluate(() => window.__mlsEasyV32.remote.record()), 'P: the Easy engine refused to start recording');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => !!(document.getElementById('_mlsAskYes') && document.getElementById('_mlsAskYes').offsetParent))) await page.locator('#_mlsAskYes').click();
  const starting = await until('the room while the recorder starts', async () => { const r = await room(); return r.status === 'starting' && r.gen && r; }, 6000).catch(() => room());
  /* what the room shows a little later, once its 700 ms poll has run */
  const startingLater = starting.status === 'starting' ? await (async () => { await page.waitForTimeout(800); return room(); })() : starting;
  const b0 = await bind();
  const tappedStarting = starting.status === 'starting' ? await fingerOnGen() : false;
  await page.waitForTimeout(300);
  const b1 = await bind();
  await until('recording', async () => ((await state(page)).direct || {}).status === 'recording', 15000);
  be.startDelay = 0;
  const code = be.current();
  await until('two clips accepted', () => be.clips(code).filter(n => n >= first).length >= 2, 20000);
  const accepted = Math.max(...be.clips(code));
  be.hook = p => (p.clip > accepted ? 4000 : null);   /* the last clips are slow */
  /* 2. finishing after Stop */
  const b2 = await bind();
  await stopRecording(page);
  const finishing = await until('the room while the recorder finishes', async () => { const r = await room(); return r.status === 'stopping' && r.gen && r; }, 6000).catch(() => room());
  const finishingLater = finishing.status === 'stopping' ? await (async () => { await page.waitForTimeout(800); return room(); })() : finishing;
  const tappedFinishing = await fingerOnGen();
  await page.waitForTimeout(400);
  const b3 = await bind();
  /* a click that does reach the handler (the attribute taken off first) */
  const handler = await page.evaluate(() => {
    const g = document.getElementById('ez3Gen');
    if (!g) return { ran: false };
    const before = window.__said.length;
    g.removeAttribute('disabled');
    g.click();
    return { ran: true, said: window.__said.slice(before), status: _mlsDirectPhone.status };
  });
  const b4 = await bind();
  const s = await idle(page, 40000);
  be.hook = null;
  await page.waitForTimeout(1200);
  const after = await room();
  const b5 = await bind();
  await groups([
    ['starting', () => {
      eq(starting.status, 'starting', `P: the recorder was never seen starting with Generate on screen: ${JSON.stringify(starting)}`);
      for (const r of [starting, startingLater].filter(x => x.status === 'starting')) {
        eq(r.phase, 'finishing', `P: while the recorder starts the room is not finishing: ${JSON.stringify(r)}`);
        ok(r.disabled, `P: while the recorder starts Generate is not really disabled: ${JSON.stringify(r)}`);
        eq(r.reason, 'capture-finishing', `P: while the recorder starts the engine would write the note: ${JSON.stringify(r)}`);
      }
      ok(tappedStarting, 'P: Generate was not on screen to tap while the recorder started');
      eq(b1, b0, 'P: a tap on Generate while the recorder started re-bound the visit');
    }],
    ['finishing', () => {
      eq(finishing.status, 'stopping', `P: the recorder was never seen finishing with Generate on screen: ${JSON.stringify(finishing)}`);
      for (const r of [finishing, finishingLater].filter(x => x.status === 'stopping')) {
        eq(r.phase, 'finishing', `P: while the recorder finishes the phase is not finishing: ${JSON.stringify(r)}`);
        ok(r.disabled, `P: while the recorder finishes Generate is not really disabled (the disabled attribute): ${JSON.stringify(r)}`);
        ok(!r.rec2, `P: while the recorder finishes Resume is drawn: ${JSON.stringify(r)}`);
      }
      ok(tappedFinishing, 'P: Generate was not on screen to tap while the recorder finished');
      eq(b3, b2, 'P: a finger tap on Generate while the recorder finished re-bound the visit');
    }],
    ['the handler refuses first', () => {
      ok(handler.ran && handler.status === 'stopping', `P: the handler was not reached while the recorder finished: ${JSON.stringify(handler)}`);
      ok(handler.said.some(x => /The recording is still finishing/.test(x)), `P: the handler did not refuse in the engine's words: ${JSON.stringify(handler)}`);
      eq(b4, b2, 'P: a click that reached the handler while the recorder finished re-bound the visit');
    }],
    ['every clip reaches the visit', () => {
      eq(b5, b2, 'P: the visit was re-bound while clips were on their way');
      eq(be.clips(code).filter(n => n >= first), range(first, s.made), `P: MLS does not hold every clip: ${JSON.stringify(be.clips(code))}`);
      ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `P: clips on their way when Generate was tapped never reached the visit: ${JSON.stringify(s.transcript.slice(-240))}`);
    }],
    ['settled', () => {
      eq(after.phase, 'stopped', `P: after the recorder settled the room is not stopped: ${JSON.stringify(after)}`);
      ok(after.gen && !after.disabled && after.reason !== 'capture-finishing', `P: after the recorder settled Generate is still held: ${JSON.stringify(after)}`);
    }]
  ]);
}

/* ---- Q (micfix-1.3.0, R4-2 and R4-3) --------------------------------------- */
/* Stop during an outage. The lane's microphone is released at once, the queue
   is sent for at most the Stop's bound (45 s; shortened here), and then the
   Stop finishes like a refusal for the account: idle, the doctor told how
   many segments were not added and that their audio is kept on this device,
   the backup not marked clean, never a success line - and the doctor can move
   on. A clip that lands within the bound is added as usual, and the lane's
   waiting sentence comes off #micWarn once it is idle with nothing pending. */
const Q_BOUND_MS = 12000, Q_RETRY_MS = 2000;
let qDefaults = null;
/* micfix-1.3.2: an attempt still inside its own deadline is waited for, so the
   scenarios that cut a clip in flight shorten the attempt deadlines too. */
const Q_ATTEMPT_MS = Q_BOUND_MS + 4000;
async function boundStop(page) {
  qDefaults = await page.evaluate(() => [_mlsDirectPhone.stopBoundMs, _mlsDirectPhone.stopRetryMs]);
  await page.evaluate(([b, r, a]) => { _mlsDirectPhone.stopBoundMs = b; _mlsDirectPhone.stopRetryMs = r; _mlsDirectPhone.attemptBaseMs = a; _mlsDirectPhone.plainAttemptMs = a; }, [Q_BOUND_MS, Q_RETRY_MS, Q_ATTEMPT_MS]);
}
const qDefaultsCheck = () => ['a Stop is bounded at 45 s and retried at least every 5 s', () => eq(qDefaults, [45000, 5000], 'Q: the Stop\'s bound and retry are not 45 s and 5 s: ' + JSON.stringify(qDefaults))];
async function unboundStop(page) {
  await page.evaluate(() => { _mlsDirectPhone.stopBoundMs = 45000; _mlsDirectPhone.stopRetryMs = 5000; _mlsDirectPhone.attemptBaseMs = 40000; _mlsDirectPhone.plainAttemptMs = 330000; });
}
const micWarnShown = page => page.evaluate(() => { const w = document.getElementById('micWarn'); return w && w.style.display !== 'none' ? (w.textContent || '').trim() : ''; });
/* Stop, then: every microphone at +1.5 s, idle within the bound, what was said */
async function stopDuringOutage(page, be, mode, label, first, since, saidAt) {
  const code = be.current();
  await page.evaluate(() => { window.__toasts.length = 0; });
  const t0 = Date.now();
  await stopRecording(page);
  await sleep(1500);
  const liveSoon = await page.evaluate(() => Object.assign(window.__live(), { status: _mlsDirectPhone.status }));
  const during = await state(page);
  const s = await idle(page, Q_BOUND_MS + 9000).catch(() => null);
  const took = Date.now() - t0;
  const now = s || await state(page);
  const postsAtIdle = be.posts.filter(p => p.code === code).length;
  await sleep(1500);
  const said = await page.evaluate(n => window.__said.slice(n), saidAt);
  const toasts = await page.evaluate(() => window.__toasts.slice());
  const words = [now.bar, (now.direct || {}).note || ''].concat(said).join(' ');
  const mine = await backupsSince(page, since);
  return { code, liveSoon, during, s, took, now, postsAtIdle, postsLater: be.posts.filter(p => p.code === code).length, said, toasts, words, mine };
}
function checkCut(r, be, mode, label, first, cause) {
  const L_ = L.key;
  const stored = be.clips(r.code).filter(n => n >= first).length;
  const missing = r.s ? (r.s.made - first + 1) - stored : -1;
  return [
    qDefaultsCheck(),
    ['the microphone is released at once', () => {
      eq(r.liveSoon.status, 'stopping', `${mode} Q ${label} (${L_}): the Stop was over within 1.5 s, so nothing was waiting: ${JSON.stringify(r.liveSoon)}`);
      ok(r.liveSoon.tracks === 0 && r.liveSoon.lane === 0 && r.liveSoon.backup === 0, `${mode} Q ${label} (${L_}): 1.5 s after Stop a microphone is still live while the queue waits: ${JSON.stringify(r.liveSoon)}`);
    }],
    ['the Stop finishes within its bound', () => {
      ok(r.s, `${mode} Q ${label} (${L_}): the Stop never finished during the outage (${r.took} ms): ${JSON.stringify({ direct: r.now.direct, bar: r.now.bar })}`);
      ok(r.took <= Q_BOUND_MS + 8000, `${mode} Q ${label} (${L_}): the Stop took ${r.took} ms, past its ${Q_BOUND_MS} ms bound`);
      eq(r.postsLater, r.postsAtIdle, `${mode} Q ${label} (${L_}): clips were still sent after the Stop finished`);
    }],
    ['the doctor is told how many were not added, and where the audio is', () => {
      ok(missing >= 1, `${mode} Q ${label}: no clip was left unsent (${JSON.stringify(be.clips(r.code))})`);
      ok(new RegExp('\\b' + missing + ' recording segments? could not be added to the transcript').test(r.words), `${mode} Q ${label} (${L_}): the doctor was not told that ${missing} segment(s) were not added: ${JSON.stringify(r.words.slice(0, 700))}`);
      ok(cause.test(r.words), `${mode} Q ${label} (${L_}): the doctor was not told why: ${JSON.stringify(r.words.slice(0, 700))}`);
      ok(/audio is kept on this device, in the MLS recording backup/.test(r.words), `${mode} Q ${label} (${L_}): the doctor was not told the audio is kept on this device: ${JSON.stringify(r.words.slice(0, 700))}`);
      const note = (r.now.direct || {}).note || '';
      ok(note && !/iPhone/.test(note), `${mode} Q ${label} (${L_}): the recorder's note is missing or names an iPhone: ${JSON.stringify(note)}`);
    }],
    ['never a success line, and the backup is not marked clean', () => {
      eq(r.toasts.filter(t => /Everything captured is/.test(t.text)).map(t => t.text), [], `${mode} Q ${label} (${L_}): Stop said everything was captured`);
      ok(r.mine.length > 0 && r.mine.every(b => b.clean !== 1), `${mode} Q ${label} (${L_}): the local audio backup was marked clean though clips were not added: ${JSON.stringify(r.mine)}`);
    }]
  ];
}
async function movesOn(page, mode, label) {
  const gen = await page.evaluate(() => { try { const r = _mlsGenerationBlockReason(document.getElementById('transcript').value || 'x'); return r ? r.code : ''; } catch (e) { return String(e); } });
  const holds = await page.evaluate(() => _mlsPhoneMicHoldsVisit());
  ok(gen !== 'capture-finishing', `${mode} Q ${label} (${L.key}): Generate is still refused as if the recording were finishing`);
  eq(holds, false, `${mode} Q ${label} (${L.key}): the recording still holds the visit`);
}
async function stopQuotaOutage(page, be, mode) {
  await boundStop(page);
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const saidAt = await page.evaluate(() => window.__said.length);
    const since = Date.now();
    let quota = false;
    be.hook = p => (quota && p.clip >= first ? 'quota' : null);
    await startRecording(page);
    const code = be.current();
    await until('the first clip in the visit', async () => (await state(page)).transcript.includes('Clip ' + first + ' words.'), 25000);
    quota = true;
    const shown = await until('the busy note', async () => { const x = await state(page); return /MLS cannot add clips right now/.test(x.bar + ' ' + (x.direct.note || '')) && x; }, 20000).catch(() => state(page));
    const r = await stopDuringOutage(page, be, mode, 'quota', first, since, saidAt);
    be.hook = null;
    await groups(checkCut(r, be, mode, 'quota', first, /could not transcribe audio \(a problem on the MLS side, not on this device\)/).concat([
      ['the busy note names this device', () => {
        const note = shown.direct.note || '';
        ok(/not on this device/.test(note) && !/iPhone/.test(note), `${mode} Q quota (${L.key}): the busy note does not say 'this device': ${JSON.stringify(note)}`);
      }],
      ['the doctor can move on', () => movesOn(page, mode, 'quota')],
      /* micfix-1.3.1: the loss stays on screen in the room (a toast 45 s after the
         last tap was kept off screen by the quiet-notify rules on iPad) */
      ['the loss stays named in the room', async () => {
        await sleep(1200);
        const hint = await page.evaluate(() => { const h = document.querySelector('.ez3fl-rechint'); return h ? { text: (h.textContent || '').trim(), shown: !!(h.offsetWidth || h.offsetHeight) } : null; });
        if (mode === 'ipad' || (hint && hint.shown)) ok(hint && /could not be added to the transcript/.test(hint.text), `${mode} Q quota (${L.key}): the room does not keep saying segments were not added: ${JSON.stringify(hint)}`);
      }]
    ]));
    eq(be.clips(code).filter(n => n >= first), [first], `${mode} Q quota: MLS took clips during its own outage`);
  } finally { await unboundStop(page); }
}
/* micfix-1.3.1 (2026-09-26): the bound is "nothing reached MLS for the bound",
   not "the bound after Stop". A slow MLS that still takes every clip is never
   cut off: the round-4 wall clock dropped the end of such a visit. */
async function stopSlowButLanding(page, be, mode) {
  await boundStop(page);
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    let slow = false;
    be.hook = p => (slow && p.clip > first ? 5000 : null);
    await startRecording(page);
    const code = be.current();
    await until('the first clip in the visit', async () => (await state(page)).transcript.includes('Clip ' + first + ' words.'), 25000);
    slow = true;
    await until('eight slow clips made', () => page.evaluate(f => window.__clipsMade() >= f + 8, first), 40000);
    const t0 = Date.now();
    await stopRecording(page);
    const s1 = await idle(page, 120000).catch(() => null);
    const took = Date.now() - t0;
    be.hook = null;
    const made = s1 ? s1.made : await page.evaluate(() => window.__clipsMade());
    const tx = (await state(page)).transcript;
    await groups([
      ['a slow MLS that keeps taking clips is waited for past the bound', () => {
        ok(s1, `${mode} Q slow (${L.key}): the Stop never finished`);
        ok(took > Q_BOUND_MS, `${mode} Q slow (${L.key}): the backlog drained inside the bound (${took} ms), so this run proves nothing`);
        eq(be.clips(code).filter(n => n >= first), range(first, made), `${mode} Q slow (${L.key}): MLS does not hold every clip`);
        ok(tx.trim().endsWith(range(first, made).map(n => 'Clip ' + n + ' words.').join(' ')), `${mode} Q slow (${L.key}): the end of the visit is missing from the transcript: ${JSON.stringify(tx.slice(-200))}`);
        ok(!/could not be added/.test(((s1 || {}).direct || {}).note || ''), `${mode} Q slow (${L.key}): clips that landed were reported as not added`);
      }]
    ]);
  } finally { be.hook = null; await unboundStop(page); }
}
/* micfix-1.3.2 (2026-09-26): one transcription that takes longer than the Stop's
   bound, but still answers inside its own attempt deadline, is MLS working, not
   an outage: nothing is cut. Today's server can take up to 300 s on one clip. */
async function stopLongStall(page, be, mode) {
  await boundStop(page);
  await page.evaluate(() => { _mlsDirectPhone.attemptBaseMs = 40000; _mlsDirectPhone.plainAttemptMs = 330000; });
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const stall = first + 1;
    be.hook = p => (p.clip === stall && p.attempt === 1 ? Q_BOUND_MS + 9000 : null);
    await startRecording(page);
    const code = be.current();
    await until('the stalled clip in flight', () => be.posts.some(p => p.code === code && p.clip === stall), 20000);
    await until('two clips behind it', () => page.evaluate(f => window.__clipsMade() >= f + 3, first), 20000);
    const t0 = Date.now();
    await stopRecording(page);
    const s1 = await idle(page, 90000).catch(() => null);
    const took = Date.now() - t0;
    be.hook = null;
    const made = s1 ? s1.made : await page.evaluate(() => window.__clipsMade());
    const tx = (await state(page)).transcript;
    await groups([
      ['one slow transcription past the bound is waited for', () => {
        ok(s1, `${mode} Q stall (${L.key}): the Stop never finished`);
        ok(took > Q_BOUND_MS, `${mode} Q stall (${L.key}): the stall did not outlast the bound (${took} ms), so this run proves nothing`);
        eq(be.clips(code).filter(n => n >= first), range(first, made), `${mode} Q stall (${L.key}): MLS does not hold every clip`);
        ok(tx.trim().endsWith(range(first, made).map(n => 'Clip ' + n + ' words.').join(' ')), `${mode} Q stall (${L.key}): the end of the visit is missing: ${JSON.stringify(tx.slice(-200))}`);
        ok(!/could not be added/.test(((s1 || {}).direct || {}).note || ''), `${mode} Q stall (${L.key}): a clip that landed was reported as not added`);
      }]
    ]);
  } finally { be.hook = null; await unboundStop(page); }
}
async function stopNetworkDown(page, be, mode) {
  await boundStop(page);
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const saidAt = await page.evaluate(() => window.__said.length);
    const since = Date.now();
    await startRecording(page);
    const code = be.current();
    await until('the first clip in the visit', async () => (await state(page)).transcript.includes('Clip ' + first + ' words.'), 25000);
    be.net = 'down'; be.getFail = true; be.stopFail = true;
    await until('two clips made during the outage', () => page.evaluate(f => window.__clipsMade() >= f + 2, first), 20000);
    const r = await stopDuringOutage(page, be, mode, 'network', first, since, saidAt);
    be.net = 'up'; be.getFail = false; be.stopFail = false;
    await groups(checkCut(r, be, mode, 'network', first, /this device could not reach MLS/).concat([
      ['the end of the transcript is not claimed either', () => ok(/could not confirm the end of the transcript/.test(r.words), `${mode} Q network (${L.key}): the note does not say the end of the transcript was not confirmed: ${JSON.stringify(r.words.slice(0, 700))}`)],
      ['the doctor can move on: Generate, New visit, another patient', async () => {
        await movesOn(page, mode, 'network');
        const nv = await page.evaluate(() => { try { return newVisit(); } catch (e) { return 'threw ' + e.message; } });
        ok(nv !== false && !/^threw/.test(String(nv)), `${mode} Q network (${L.key}): New visit was refused after the Stop finished: ${JSON.stringify(nv)}`);
        const cal = await page.evaluate(() => { try { return calStartVisit('appt-t1'); } catch (e) { return { threw: String(e) }; } });
        ok(cal && cal.ok === true, `${mode} Q network (${L.key}): another patient could not be opened after the Stop finished: ${JSON.stringify(cal)}`);
        await sleep(1200);
        const other = await page.evaluate(() => { const h = document.querySelector('.ez3fl-rechint'); return h ? (h.textContent || '').trim() : ''; });
        ok(!/could not be added to the transcript/.test(other), `${mode} Q network (${L.key}): the loss note followed the doctor to another patient: ${JSON.stringify(other)}`);
      }]
    ]));
    eq(be.clips(code).filter(n => n >= first), [first], `${mode} Q network: the stub stored clips while the network was down`);
  } finally { be.net = 'up'; be.getFail = false; be.stopFail = false; await unboundStop(page); }
}
async function stopOutageEndsInTime(page, be, mode) {
  await boundStop(page);
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const since = Date.now();
    let quotaUntil = 0;
    be.hook = p => (p.clip > first && Date.now() < quotaUntil ? 'quota' : null);
    await startRecording(page);
    const code = be.current();
    await until('the first clip accepted', () => be.clips(code).includes(first), 20000);
    quotaUntil = Date.now() + 120000;
    /* long enough that the retry waits out a 24 s backoff */
    await until('three refusals on MLS\'s side', () => be.posts.filter(p => p.code === code && p.status === 502).length >= 3, 40000);
    await until('the busy note on #micWarn', async () => /MLS cannot add clips right now/.test(await micWarnShown(page)), 5000).catch(() => null);
    const warnBefore = await micWarnShown(page);
    await page.evaluate(() => { window.__toasts.length = 0; });
    const t0 = Date.now();
    await stopRecording(page);
    quotaUntil = Date.now() + 1000;   /* MLS recovers a second after Stop */
    const s = await idle(page, Q_BOUND_MS + 20000).catch(() => null);
    const took = Date.now() - t0;
    be.hook = null;
    await sleep(900);
    const toasts = await page.evaluate(() => window.__toasts.slice());
    const warnAfter = await micWarnShown(page);
    const mine = await backupsSince(page, since);
    await groups([
      qDefaultsCheck(),
      ['a clip that lands within the bound is added', () => {
        ok(s, `${mode} Q recovers: the Stop never finished`);
        ok(took <= Q_BOUND_MS, `${mode} Q recovers: the Stop took ${took} ms: a retry waited out its long backoff past the ${Q_BOUND_MS} ms bound`);
        eq(be.clips(code), range(first, s.made), `${mode} Q recovers: MLS does not hold every clip once, in order: ${JSON.stringify(be.clips(code))}`);
        ok(s.transcript.trim().endsWith(range(first, s.made).map(n => 'Clip ' + n + ' words.').join(' ')), `${mode} Q recovers: the visit transcript is missing clips: ${JSON.stringify(s.transcript.slice(-240))}`);
        eq(toasts.filter(t => /Everything captured is/.test(t.text)).length, 1, `${mode} Q recovers: a Stop that saw every word did not say so once: ${JSON.stringify(toasts)}`);
        ok(mine.length > 0 && mine.every(b => b.clean === 1), `${mode} Q recovers: the backup of a complete recording was not marked clean: ${JSON.stringify(mine)}`);
      }],
      ['#micWarn clears once the lane is idle and nothing is pending (R4-3)', () => {
        ok(/MLS cannot add clips right now/.test(warnBefore), `${mode} Q recovers: the busy note was never on #micWarn: ${JSON.stringify(warnBefore)}`);
        eq(warnAfter, '', `${mode} Q recovers: #micWarn still shows a waiting sentence after every clip landed and the lane is idle`);
      }]
    ]);
  } finally { be.hook = null; await unboundStop(page); }
}
/* the first clip at the bound was sent: its attempt in flight and MLS stored
   it, in flight and MLS did not, or an earlier reply was lost (stored) and its
   retries do not get through. It is asked about by clipId, and counted only
   when MLS did not store it. */
async function stopCutInFlight(page, be, mode, kind) {
  await boundStop(page);
  const storedFirst = kind !== 'not-stored';
  const label = kind === 'stored' ? 'in flight, stored' : kind === 'lost-reply' ? 'reply lost, stored' : 'in flight, not stored';
  try {
    const first = (await page.evaluate(() => window.__clipsMade())) + 1;
    const saidAt = await page.evaluate(() => window.__said.length);
    const since = Date.now();
    await startRecording(page);
    const code = be.current();
    await until('the first clip in the visit', async () => (await state(page)).transcript.includes('Clip ' + first + ' words.'), 25000);
    const target = first + 1;
    be.hook = kind === 'lost-reply'
      ? p => (p.clip === target ? (p.attempt === 1 ? 'lose-reply' : 'offline') : (p.clip > target ? 'offline' : null))
      : p => (p.clip === target ? (kind === 'stored' ? 'hang' : Q_BOUND_MS + 8000) : null);
    await until('the target clip in flight', () => be.posts.some(p => p.code === code && p.clip === target), 20000);
    const r = await stopDuringOutage(page, be, mode, label, first, since, saidAt);
    const asked = be.posts.filter(p => p.code === code && p.clip === 0);
    const targetId = (be.posts.find(p => p.code === code && p.clip === target) || {}).clipId;
    const storedNow = be.clips(code);
    const words = r.words;
    be.hook = null;
    await groups([
      ['the Stop finishes within its bound', () => {
        ok(r.s, `${mode} Q ${label}: the Stop never finished`);
        ok(r.took <= Q_BOUND_MS + 8000, `${mode} Q ${label}: the Stop took ${r.took} ms, past its ${Q_BOUND_MS} ms bound`);
      }],
      ['MLS is asked about the cut clip by its clipId alone', () => {
        eq(asked.map(p => p.clipId), [targetId], `${mode} Q ${label}: the clip whose attempt was cut was not asked about once, by its clipId: ${JSON.stringify(asked)}`);
      }],
      ['the count is what MLS did not store', () => {
        const missing = r.s ? (r.s.made - first + 1) - be.clips(r.code).filter(n => n >= first).length : -1;
        eq(storedNow.includes(target), storedFirst, `${mode} Q ${label}: the stub did not do what the scenario needs: ${JSON.stringify(storedNow)}`);
        ok(missing >= 1, `${mode} Q ${label}: nothing was left unsent`);
        ok(new RegExp('\\b' + missing + ' recording segments? could not be added to the transcript').test(words), `${mode} Q ${label}: the doctor was not told that ${missing} segment(s) were not added: ${JSON.stringify(words.slice(0, 700))}`);
        if (storedFirst) ok(r.s.transcript.includes('Clip ' + target + ' words.') && r.s.transcript.split('Clip ' + target + ' words.').length === 2, `${mode} Q ${label}: the stored clip is not in the visit once: ${JSON.stringify(r.s.transcript.slice(-240))}`);
        else ok(!r.s.transcript.includes('Clip ' + target + ' words.'), `${mode} Q ${label}: a clip MLS never stored is in the visit`);
      }]
    ]);
  } finally { be.hook = null; await unboundStop(page); }
}
const stopCutStored = (page, be, mode) => stopCutInFlight(page, be, mode, 'stored');
const stopCutNotStored = (page, be, mode) => stopCutInFlight(page, be, mode, 'not-stored');
const stopCutLostReply = (page, be, mode) => stopCutInFlight(page, be, mode, 'lost-reply');

/* [name, fn, layouts it runs in (default: the phone layout only)] */
const SCENARIOS = {
  contract: [['A kept and retried; finishing; backup (4/7/6, C1)', retriedUntilSent], ['B lost reply lands once; the marker (C1, B2)', lostReplyLandsOnce], ['C unreadable not re-sent (C5)', unreadableNotResent],
    ['D ended session stops, microphones released (C2, A3)', endedSessionStops, ['phone', 'ipad']], ['E microphone ends (3, A3)', micEndsKeepsAudio],
    ['F first in, first out (A2)', fifoKeepsSpeakingOrder], ['G given up only after the marker (A2)', deadlineWaitsForTheMarker],
    ['H an account refusal stops through Stop (A3)', refusals, ['phone', 'ipad']], ['I Stop says done only when done (C5)', stopSaysDoneOnlyWhenDone],
    ['J next part cannot start, microphones released (A3)', nextPartCannotStart, ['phone', 'ipad']], ['K Stop never claims what it did not see (A4; R4-3)', stopNeverClaimsWhatItDidNotSee, ['phone', 'ipad']],
    ['L a visit re-bind waits for the last clips (A5; R4-3)', rebindWaitsForTheLastClips, ['phone', 'ipad']],
    ['N a failed start releases the microphones (A3)', failedStartReleases, ['phone', 'ipad']],
    ['P Generate waits while the recorder starts or finishes (R4-1)', generateWaitsWhileFinishing, ['ipad']],
    ['Q an outage on MLS\'s side at Stop is bounded (R4-2, R4-3)', stopQuotaOutage, ['phone', 'ipad']],
    ['Q MLS recovers within the bound; #micWarn clears (R4-2, R4-3)', stopOutageEndsInTime],
    ['Q the clip cut in flight was stored (R4-2)', stopCutStored],
    ['Q the clip cut in flight was not stored (R4-2)', stopCutNotStored],
    ['Q the first clip\'s reply was lost; MLS stored it (R4-2)', stopCutLostReply],
    ['Q the network down at Stop is bounded; the doctor moves on (R4-2)', stopNetworkDown, ['phone', 'ipad']],
    ['Q a slow MLS that keeps taking clips is never cut off (micfix-1.3.1)', stopSlowButLanding, ['phone', 'ipad']],
    ['Q one transcription slower than the bound is waited for (micfix-1.3.2)', stopLongStall, ['phone', 'ipad']]],
  legacy: [['A kept and retried; finishing; backup (4/7/6)', retriedUntilSent], ['C refused not re-sent (C5)', unreadableNotResent], ['D ended session stops (C2, A3)', endedSessionStops],
    ['F first in, first out (A2)', fifoKeepsSpeakingOrder], ['G no marker: a slow answer is waited for (A2)', deadlineWaitsForTheMarker],
    ['H a quota refusal keeps recording (A3)', refusals], ['I Stop says done only when done (C5)', stopSaysDoneOnlyWhenDone],
    ['K Stop never claims what it did not see (A4)', stopNeverClaimsWhatItDidNotSee], ['L a visit re-bind waits for the last clips (A5)', rebindWaitsForTheLastClips],
    ['Q an outage on MLS\'s side at Stop is bounded (R4-2, R4-3)', stopQuotaOutage],
    ['Q the network down at Stop is bounded; the doctor moves on (R4-2)', stopNetworkDown],
    ['Q a slow MLS that keeps taking clips is never cut off (micfix-1.3.1)', stopSlowButLanding],
    ['Q one transcription slower than the bound is waited for (micfix-1.3.2)', stopLongStall]]
};

async function run(browser, origin, layout, mode, failures) {
  L = LAYOUTS[layout];
  const be = makeBackend(mode);
  const { ctx, page } = await boot(browser, origin, be);
  try {
    await openVisit(page);
    /* ONLY=A,D runs the named scenarios (letters) on their own. */
    const only = String(process.env.ONLY || '').split(',').filter(Boolean);
    for (const [name, fn, layouts] of SCENARIOS[mode].filter(([n, , ls]) => (!only.length || only.includes(n[0])) && (ls || ['phone']).includes(layout))) {
      const before = checks;
      try { await fn(page, be, mode, ctx, origin); console.log(`  ok   ${layout} ${mode}: ${name} (${checks - before} checks)`); }
      catch (e) { failures.push(`${layout} ${mode}: ${name}: ${String(e && e.message || e).split('\n')[0]}`); console.log(`  FAIL ${layout} ${mode}: ${name}: ${String(e && e.message || e).split('\n')[0].slice(0, 1600)}`); }
      be.hook = null; be.net = 'up'; be.getFail = false; be.stopFail = false; be.startCaps = true; be.startFail = false; be.startDelay = 0;
      await page.evaluate(() => { try { const d = window.__mlsDirectPhoneCapture; if (d && d.state().status !== 'idle') d.stop('test-reset'); } catch (e) {} });
      await idle(page, 30000).catch(() => {});
      await page.waitForTimeout(800);
    }
    eq(page.__errors, [], `${layout} ${mode}: page errors`);
  } finally { await ctx.close(); }
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const failures = [];
    const modes = String(process.env.MODES || 'contract,legacy').split(',').filter(Boolean);
    const layouts = String(process.env.LAYOUTS || 'phone,ipad').split(',').filter(Boolean);
    for (const layout of layouts) {
      for (const mode of modes) {
        if (layout === 'ipad' && mode !== 'contract') continue;
        await run(browser, origin, layout, mode, failures);
      }
    }
    assert.deepStrictEqual(failures, [], failures.join('\n'));
    console.log(`PASS in-app iPhone recorder upload contract (phone 390x844 and iPad 1180x820, contract + legacy servers): ${checks} checks`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
