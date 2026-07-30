'use strict';
/*
 * HOW LONG IS THE APP INVISIBLE? - the secure loading gate, timed live
 * -----------------------------------------------------------------------------
 * Found by tests/live-ui-defect-sweep.js, not by reading. The sweep reported the
 * bottom dock as visibility:hidden while its nav tab was still offered, and the
 * payload named the real culprit:
 *
 *     htmlClass: "mls-secure-loading mls-sv-active mls-redesign", gateUp: true
 *
 * #sfGateLoading does not merely cover the app. Showing it puts
 * `mls-secure-loading` on <html>, and that class carries
 *     html.mls-secure-loading body>:not(#sfGateLoading){visibility:hidden!important}
 * (ScribeFlow.html:26334) - so while it is set, EVERY body child except the
 * loading card is invisible. The dock was not hiding; it was wearing the gate's
 * consequence. The doctor sees the branded loading screen, and nothing else.
 *
 * The gate is correct in principle: a hosted session must not paint clinical
 * surfaces before the compliance decision lands. What was never measured is how
 * long it actually lasts on the path the doctor takes. This file measures it,
 * on a LOCAL no-backend account where there is no compliance decision to wait
 * for and therefore nothing legitimate to wait on.
 *
 * It samples document.documentElement.className every 100ms from the moment
 * signup is submitted, so the answer is an observed interval, not a promise
 * about one. Three numbers come out:
 *
 *   gateUpAfterMs   - when the gate first appeared (should be ~immediately;
 *                     that is the anti-flash owner, and it is wanted)
 *   gateDownAfterMs - when `mls-secure-loading` finally left <html>
 *   blankMs         - how long the app was invisible in total
 *
 * The budget below is not invented. ScribeFlow.html's own lifecycle declares a
 * 300ms anti-flash floor with a 350ms quiet window (see
 * tests/boot-loading-lifecycle-runtime.test.js), a 32s force release and a 40s
 * watchdog. A local session that needs the FORCE or the WATCHDOG to end its
 * loading screen has failed - those are the last-resort floors written for the
 * "I CANT EVEN SIGN IN THE LOADING SCREEN HAS ME STUCK" report, not a schedule.
 * So the budget is 8000ms: generous next to the 350ms the machinery aims for,
 * and far under the 32s that means the normal path never completed.
 *
 * PHI-free: one obviously synthetic local account. No backend, no model call, no
 * extension. Serves only what _config.yml publishes, so it times the build the
 * doctor actually receives.
 *
 *   node tests/live-loading-gate-lifetime.js
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACCOUNT = { email: 'clinician.gatetiming@mls.local', password: 'SyntheticOnly2026!' };

/* The gate's own machinery aims for ~350ms and holds 32s/40s as last resorts.
   Anything past this budget means the normal reveal never happened. */
const BLANK_BUDGET_MS = 8000;
const SAMPLE_MS = 100;
const OBSERVE_MS = 45000;   /* past the 40s watchdog, so a stuck gate is seen stuck */

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function note(msg) { console.log('  note  ' + msg); }

function findChrome() {
  const c = [process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  return c.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } }) || '';
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const EXCLUDED = new Set();
(fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8').match(/^\s*-\s*"([^"]+\.js)"/gm) || [])
  .forEach((l) => EXCLUDED.add(l.replace(/^\s*-\s*"/, '').replace(/"\s*$/, '')));
/* SERVE_ALL=1 lifts the publication exclusions for one run. It exists to answer
   one question and no other: does a script that 404s in production hold the
   loading gate up? Default OFF, because the published build is the build the
   doctor receives and that is what this file exists to time. */
const SERVE_ALL = process.env.SERVE_ALL === '1';
if (SERVE_ALL) EXCLUDED.clear();
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'ScribeFlow.html';
    if (EXCLUDED.has(rel)) { res.writeHead(404); return res.end('excluded from publication'); }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, origin: 'http://127.0.0.1:' + server.address().port })));
}
class CDP {
  constructor(s) { this.socket = s; this.id = 1; this.pending = new Map(); this.handlers = new Map();
    s.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data));
      if (!m.id) { if (m.method) (this.handlers.get(m.method) || []).forEach((fn) => { try { fn(m.params || {}); } catch (_) {} }); return; }
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(p.method + ': ' + m.error.message)) : p.resolve(m.result || {}); }); }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  static connect(u) { return new Promise((res, rej) => { const s = new WebSocket(u);
    s.addEventListener('open', () => res(new CDP(s)), { once: true });
    s.addEventListener('error', () => rej(new Error('cdp connect failed')), { once: true }); }); }
  send(m, p, t) { const id = this.id++; return new Promise((res, rej) => {
    const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(m + ': timeout')); }, t || 40000);
    this.pending.set(id, { resolve: res, reject: rej, timer, method: m });
    this.socket.send(JSON.stringify({ id, method: m, params: p || {} })); }); }
  close() { try { this.socket.close(); } catch (_) {} }
}
async function evalJs(cdp, e, aw) {
  const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!aw });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function wait(cdp, name, expr, t) {
  const dl = Date.now() + (t || 30000);
  for (;;) { let v = null; try { v = await evalJs(cdp, `(()=>{try{return (${expr});}catch(e){return false;}})()`); } catch (_) {}
    if (v) return v; if (Date.now() > dl) throw new Error('timed out waiting for ' + name); await sleep(150); }
}
async function fill(cdp, sel, v) {
  await evalJs(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 0;el.focus();
    const P=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(P,'value').set.call(el,${JSON.stringify(v)});
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    el.dispatchEvent(new Event('change',{bubbles:true}));return 1;})()`);
}

/* Sample the gate in the PAGE, not from Node. A Node-side poll measures the
   round trip as much as the gate, and a gate that flickers between two polls
   would be invisible to it.

   A MutationObserver on <html class> is the primary recorder, not a timer. The
   first draft of this file used setInterval and it recorded TWO samples in 46
   seconds - page timers on this surface are throttled hard enough that a
   timer-based tape cannot be trusted to see a transition at all. An observer
   fires on the mutation itself, so it cannot miss one and cannot be throttled
   into missing one. The interval survives only as a liveness counter, which is
   how the throttling was caught in the first place. */
const INSTALL_RECORDER = `
(function(){
  if (window.__gateTape) return 1;
  var t0 = Date.now();
  var tape = { t0: t0, events: [], samples: 0 };
  window.__gateTape = tape;
  function state(){
    var h = document.documentElement;
    return {
      loading: h.classList.contains('mls-secure-loading'),
      revealing: h.classList.contains('mls-app-revealing'),
      /* The consequence, measured rather than inferred: is a real app surface
         actually paintable right now? #appScreen is the app's own root. */
      appVisible: (function(){
        var a = document.getElementById('appScreen');
        if (!a) return false;
        var s = getComputedStyle(a);
        return s.display !== 'none' && s.visibility !== 'hidden';
      })()
    };
  }
  var last = null;
  function record(){
    var s = state();
    var key = s.loading + '|' + s.revealing + '|' + s.appVisible;
    if (key === last) return;
    last = key; s.atMs = Date.now() - t0; tape.events.push(s);
  }
  record();
  tape.observer = new MutationObserver(record);
  tape.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  /* #appScreen's own display is set separately from the class, so watch it too
     once it exists - the pair is what decides whether anything is paintable. */
  var app = document.getElementById('appScreen');
  if (app) { tape.appObserver = new MutationObserver(record);
    tape.appObserver.observe(app, { attributes: true, attributeFilter: ['style','class'] }); }
  tape.timer = setInterval(function(){ tape.samples++; record(); }, ${SAMPLE_MS});
  /* WHY THE GATE IS STILL UP matters as much as THAT it is. Every recovery the
     gate owns - the 32s force release, the 40s watchdog - is a setTimeout, so a
     main thread that never yields cannot run any of them. Long tasks are
     therefore not a side note here; they are the mechanism. */
  tape.longTasks = [];
  try {
    tape.po = new PerformanceObserver(function(list){
      list.getEntries().forEach(function(e){
        if (tape.longTasks.length < 400) tape.longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
      });
    });
    tape.po.observe({ entryTypes: ['longtask'] });
  } catch (e) { tape.longTaskError = String(e && e.message || e); }
  return 1;
})()`;

async function main() {
  const exe = findChrome();
  if (!exe) { console.log('  SKIP  no Chrome found; set CHROME_PATH.'); process.exit(0); }
  const hosted = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-gate-'));
  const flags = ['--no-sandbox', '--headless=new', '--hide-scrollbars', '--remote-debugging-port=0',
    '--remote-allow-origins=*', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--window-size=1440,900', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'];
  const child = spawn(exe, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const pf = path.join(profile, 'DevToolsActivePort');
  const dl = Date.now() + 25000;
  while (!fs.existsSync(pf) && Date.now() < dl) await sleep(50);
  let t = ''; for (let i = 0; i < 120 && !t.trim(); i++) { try { t = fs.readFileSync(pf, 'utf8'); } catch (_) {} if (!t.trim()) await sleep(50); }
  const port = Number(t.trim().split(/\r?\n/)[0]);
  const cdp = await CDP.connect((await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
  /* FOREGROUND THE PAGE BEFORE TIMING ANYTHING.
     A headless target created through /json/new is not the front tab, and
     Chrome is entitled to throttle or freeze a background page's task queues.
     Measured on this exact harness before this call existed: a 100ms interval
     ticked THREE times across a 45s observation while Runtime.evaluate kept
     answering normally - timers stopped, CDP did not. Every escape hatch the
     loading gate owns is a setTimeout, so a frozen queue would have been
     indistinguishable from a genuinely stuck gate. Bring the page to the front
     and emulate focus so the thing being timed is the app, not the harness. */
  try { await cdp.send('Page.bringToFront'); } catch (_) {}
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (_) {}

  /* A NATIVE DIALOG STOPS THE PAGE DEAD, AND CDP HIDES THAT FACT.
     alert/confirm/prompt block the page's whole task queue - timers, observers,
     rAF - while Runtime.evaluate keeps answering, so from Node the page looks
     alive while nothing in it runs. With Page.enable on, the browser does NOT
     auto-dismiss: the dialog waits for Page.handleJavaScriptDialog forever.
     That is indistinguishable from a hung gate unless the dialogs are recorded,
     so they are recorded, dismissed, and reported by name. */
  const dialogs = [];
  cdp.on('Page.javascriptDialogOpening', (p) => {
    dialogs.push({ type: p.type, message: String(p.message || '').slice(0, 200) });
    cdp.send('Page.handleJavaScriptDialog', { accept: p.type === 'beforeunload' }).catch(() => {});
  });

  try {
    console.log('LOADING GATE - how long is the app invisible on a local sign-up?\n');
    await cdp.send('Page.navigate', { url: `${hosted.origin}/ScribeFlow.html?demo=1&gateTiming=1` });
    await wait(cdp, 'auth', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await evalJs(cdp, `localStorage.clear();sessionStorage.clear();location.reload();true`);
    await wait(cdp, 'auth2', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await sleep(1200);

    await evalJs(cdp, `document.getElementById('tabSignup').click();1`);
    await wait(cdp, 'assent fields', `document.getElementById('authSignupAssentFields')&&!document.getElementById('authSignupAssentFields').disabled`, 12000);
    await fill(cdp, '#authEmail', ACCOUNT.email);
    await fill(cdp, '#authPass', ACCOUNT.password);
    await fill(cdp, '#authPass2', ACCOUNT.password);
    await evalJs(cdp, `document.getElementById('authTermsAssent').click();document.getElementById('authPracticeAuthority').click();1`);
    await wait(cdp, 'signup enabled', `!document.getElementById('authBtn').disabled`, 8000);

    /* recorder first, THEN the click, so t0 precedes the gate it is timing */
    await evalJs(cdp, INSTALL_RECORDER);
    await evalJs(cdp, `document.getElementById('authBtn').click();1`);

    /* Watch until the gate is down and stays down, or the observation window
       runs out. Either way the tape below is the evidence. */
    /* DO NOT POLL. This is the whole reason the tape lives in the page.
       MEASURED on this harness: while Node polled Runtime.evaluate every 150ms,
       the page's own 100ms interval advanced ZERO times across 45 seconds, and
       the moment the polling stopped it ticked four times in 600ms. A CDP poll
       loop starves the very timer queue the loading gate's 32s force release
       and 40s watchdog live in - so a polling observer would report every
       timer-driven recovery in this app as broken, forever, and be wrong.
       Sleep with the wire quiet, then read the tape once. */
    await sleep(OBSERVE_MS);
    await sleep(600);
    const tape = await evalJs(cdp, `(()=>{ try{ clearInterval(window.__gateTape.timer); }catch(e){}
      try{ window.__gateTape.observer.disconnect(); }catch(e){}
      try{ window.__gateTape.appObserver.disconnect(); }catch(e){}
      return { events: window.__gateTape.events, samples: window.__gateTape.samples }; })()`);

    note('gate tape: ' + JSON.stringify(tape.events));
    /* The gate's force release re-arms while document.hidden (a deliberate
       b407/b408 rule: never kill a healthy startup in a background tab). A
       headless page that reports itself hidden would therefore keep the gate up
       BY DESIGN, and this file would be measuring its own harness. Record the
       page's visibility so the reading can never be misattributed. */
    const env = await evalJs(cdp, `(()=>{ var t=window.__gateTape||{};
      try{ t.po.disconnect(); }catch(e){}
      var lt = t.longTasks || [];
      var total = lt.reduce(function(a,b){ return a + b.ms; }, 0);
      return { hidden: document.hidden, visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(), samples: t.samples,
        longTaskCount: lt.length, longTaskTotalMs: total,
        worstLongTasks: lt.slice().sort(function(a,b){return b.ms-a.ms;}).slice(0,6),
        longTaskError: t.longTaskError || null }; })()`);
    note('page during the measurement: ' + JSON.stringify(env));
    if (dialogs.length) note('native dialogs seen (each one halts the page until dismissed): ' + JSON.stringify(dialogs));
    ok(dialogs.length === 0, 'no native alert/confirm/prompt interrupted the sign-in path',
      'the app opened ' + dialogs.length + ' native dialog(s): ' + JSON.stringify(dialogs)
      + '. A native dialog freezes every timer the loading gate relies on to recover.');

    /* A 100ms interval that ticked a handful of times across the whole
       observation is not a slow app, it is a stopped one - and it explains a
       gate whose every escape hatch is a setTimeout. */
    const expectedTicks = Math.floor(OBSERVE_MS / SAMPLE_MS);
    if (env.samples >= 0 && env.samples < expectedTicks * 0.5) {
      note('TIMER STARVATION: a ' + SAMPLE_MS + 'ms interval ticked ' + env.samples
        + ' times where ~' + expectedTicks + ' were due. The gate cannot time itself out on a thread that never yields.');
    }

    const up = tape.events.find((e) => e.loading);
    const downAfterUp = up ? tape.events.find((e) => e.atMs > up.atMs && !e.loading && !e.revealing) : null;
    const localMode = await evalJs(cdp, `typeof backendMode==='function'&&backendMode()===false`);

    ok(localMode === true, 'the run really is a LOCAL no-backend session',
      'backendMode() was not false, so this measured a hosted gate that has a compliance decision to wait for');
    ok(!!up, 'the gate went up (the anti-flash owner did its job)',
      'no sample ever saw mls-secure-loading; signup may not have started');

    if (up) {
      note('gate up at ' + up.atMs + 'ms after the signup press');
      if (!downAfterUp) {
        ok(false, 'the loading gate came down within ' + BLANK_BUDGET_MS + 'ms',
          'the gate NEVER came down inside the ' + OBSERVE_MS + 'ms observation window - the app stayed invisible');
      } else {
        const blankMs = downAfterUp.atMs - up.atMs;
        note('gate down at ' + downAfterUp.atMs + 'ms; app invisible for ' + blankMs + 'ms');
        ok(blankMs <= BLANK_BUDGET_MS, 'the loading gate came down within ' + BLANK_BUDGET_MS + 'ms',
          'the app was invisible for ' + blankMs + 'ms on a local account with nothing to wait for. '
          + 'Past ~32s this is the force release or the 40s watchdog ending it, not a normal reveal.');
      }
    }

    /* A gate that goes up, comes down, and goes up AGAIN is the flicker the
       doctor reads as "the app keeps disappearing". One transition each way. */
    const upCount = tape.events.filter((e, i) => e.loading && (i === 0 || !tape.events[i - 1].loading)).length;
    ok(upCount <= 1, 'the gate went up ONCE, not repeatedly',
      'the gate was raised ' + upCount + ' times - the app blanked and returned more than once');

  } finally {
    try { cdp.close(); } catch (_) {}
    try { child.kill(); } catch (_) {}
    try { hosted.server.close(); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }

  console.log('');
  if (failures) { console.log('FAIL  live-loading-gate-lifetime: ' + failures + ' finding(s).'); process.exit(1); }
  console.log('PASS  live-loading-gate-lifetime: the app is invisible only for the anti-flash moment it is meant to be.');
}

main().catch((e) => { console.error('\nGATE TIMING ABORTED: ' + (e && e.stack || e)); process.exit(1); });
