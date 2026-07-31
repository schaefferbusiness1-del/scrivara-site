'use strict';
/*
 * WHOLE-PROGRAM UI DEFECT SWEEP  (2026-07-30)
 * -----------------------------------------------------------------------------
 * Owner, verbatim: "just go and test literally everything in the whole program and
 * fix anything that's slow or broken except anything with the extension. I
 * expetially want no UI bugs."
 *
 * This is the INSTRUMENT half of that order. It changes nothing; it walks the
 * shipped app in a real Chrome and reports what is wrong, so the fixing that
 * follows is aimed at measured defects rather than guesses.
 *
 * EXTENSION BOUNDARY, ABSOLUTE. This harness drives ScribeFlow.html only. It
 * never loads, packs, installs or exercises the MLS Assist extension, never opens
 * athenanet, and blocks every non-loopback request. The Athena PULL path lives in
 * the extension on the owner's own Chrome and is deliberately out of scope.
 *
 * WHAT IT MEASURES, and why each one is here rather than in a unit test:
 *
 *   1. DRAWN BUT UNREACHABLE - a control that renders a healthy rectangle and
 *      still cannot be clicked because something is painted over it. Geometry
 *      always said these were fine; only elementFromPoint ever caught them. This
 *      project has shipped that defect at least three times.
 *   2. DUPLICATE VISIBLE CONTROLS - "WHY IS THERE 2 GENERATE NITES HERE".
 *   Both come from tests/live-standing-ui-sweeps.js so there is ONE implementation
 *   of each question, carrying its own positive control.
 *   3. HORIZONTAL OVERFLOW - a page wider than its viewport is the phone bug the
 *      owner reports as "cut off".
 *   4. UNDERSIZED TAP TARGETS - the app declares a 44px floor
 *      (`html body button{min-height:44px}`); anything visibly under it is a
 *      control that is hard to hit on a phone. The room's own Back button is the
 *      standing example.
 *   5. LONG TASKS - anything over 50ms blocks the main thread. Recorded per route
 *      so "slow" gets a number and a location instead of a feeling.
 *   6. CONSOLE ERRORS AND PAGE EXCEPTIONS - collected per route, not globally, so
 *      a thrown error names the screen that threw it.
 *
 * INSTRUMENT HONESTY. Every route is opened through the app's own visible control
 * and confirmed by the app's own view state before anything is measured, so a
 * screen that failed to open is reported as a failure to open - never swept while
 * blank and scored clean. A zero viewport voids the sweep rather than reporting
 * plausible numbers.
 *
 *   node tests/live-ui-defect-sweep.js
 *   node tests/live-ui-defect-sweep.js --headed
 *   node tests/live-ui-defect-sweep.js --artifacts=tmp/ui-sweep
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { SWEEP_SRC } = require('./live-standing-ui-sweeps');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------- synthetic fixtures only */
const ACCOUNT = { email: 'clinician.ui-sweep@mls.local', password: 'SyntheticOnly2026!' };
const PATIENT = { name: 'Synthetic UI Sweep Patient', mrn: 'SYN-UI-0001', dob: '1981-06-02', sex: 'Female' };
const NOTE = 'SYNTHETIC FIXTURE NOTE - not a real patient document.\n\nS: Synthetic follow-up.\nO: Synthetic exam.\nA: Synthetic assessment.\nP: Synthetic plan.';

const VIEWPORTS = [
  { n: '1440x900', w: 1440, h: 900 },
  { n: '1280x800', w: 1280, h: 800 },
  { n: '768x1024', w: 768, h: 1024 },
  { n: '390x844', w: 390, h: 844 }
];

const ROUTES = [
  { route: 'visit', entry: '#mlsDock button[data-dest="visit"]', label: 'Today' },
  { route: 'patients', entry: '#mlsDock button[data-dest="patient"]', label: 'Patients' },
  { route: 'calendar', entry: '#mlsDock button[data-dest="day"]', label: 'Calendar' },
  { route: 'studio', entry: '#mlsDock button[data-dest="studio"]', label: 'AI Studio' },
  /* "throguth out the whole app test verything" - the dock offers five
     destinations and this swept four. Review (orders/recommendations) and
     History are where a doctor lands after every single visit, and neither had
     ever been measured for overflow, tap targets, unreachable controls or
     duplicate labels at any viewport. Reached through their own dock entries,
     so a broken doorway is itself the finding. */
  { route: 'orders', entry: '#mlsDock button[data-dest="review"]', label: 'Review' },
  /* History has no dock button of its own. feat_mls_calm_shell.js carries it as
     an `extra` segment of the Review destination (DEST.review.extra includes
     nav_history, aliased to "History"), which renders as a .segbtn inside
     #mlsRightNow once Review is open - and the real #nav_history navtab is
     display:none, because the 2026-07-28 sweep hid the whole navtab row when
     the dock became the navigation. Pointing this route at #nav_history
     therefore reported "its view is gated off - expected" at every viewport and
     swept nothing at all. Reached the way the doctor reaches it: open Review,
     then press the History segment. */
  { route: 'history', label: 'History',
    openJs: `(() => {
      var dockBtn = document.querySelector('#mlsDock button[data-dest="review"]');
      if (!dockBtn) return false;
      dockBtn.click();
      return true;
    })()`,
    thenJs: `(() => {
      var seg = [...document.querySelectorAll('#mlsRightNow .segbtn')]
        .find(b => /^history$/i.test(String(b.textContent || '').trim()));
      if (!seg) return false;
      seg.click();
      return true;
    })()` }
];
/* The nav tab each dock destination is a doorway to - the same mapping
   feat_mls_calm_shell.js:851 DEST_TABS holds. A dock item hides itself when its
   tab is not offered, so knowing the tab's state is what turns "not visible"
   from a shrug into either "correctly gated" or "a doorway went missing". */
const ROUTE_TABS = {
  visit: ['nav_visit'],
  patients: ['nav_patients', 'nav_history'],
  calendar: ['nav_calendar'],
  studio: ['nav_studio', 'nav_analysis'],
  orders: ['nav_orders', 'nav_recs'],
  history: ['nav_history']
};

/* -------------------------------------------------------------- plumbing */
function parseArgs(argv) {
  const out = { headed: false, artifacts: '', chrome: '', help: false };
  for (const a of argv) {
    if (a === '--headed') out.headed = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--artifacts=')) out.artifacts = a.slice(12);
    else if (a.startsWith('--chrome=')) out.chrome = a.slice(9);
  }
  return out;
}
function findChrome(explicit) {
  const c = [explicit, process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const hit = c.find((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
  assert(hit, 'No Chrome/Chromium found. Set CHROME_PATH or pass --chrome=PATH.');
  return hit;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
/* SERVE ONLY WHAT GITHUB PAGES PUBLISHES - and ask the inventory, not a regex.
   A harness that serves the whole repo audits a build the doctor never receives:
   that produced 13 phantom "duplicate visible control" defects on the Templates
   tab, all contributed by feat_mls_staging_pack1.js, which is excluded and 404s
   live. The first fix over-corrected by matching `- "x.js"` across the whole of
   _config.yml, which also swept up its `include:` allowlist and began 404ing
   public-preview-policy.js and public-preview-runtime.js - two files
   ScribeFlow.html loads in <head> on every page. tests/published-tree.js reads
   the inventory CI verifies against a real Jekyll build instead. */
const isPublished = require('./published-tree.js').makeIsPublished();
/* Every 404 this server hands back is a file the running app asked for and
   production does not have. That is a finding in its own right - and, when the
   run goes wrong, the first thing worth reading. Keep the list. */
const NOT_PUBLISHED = new Map();
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'ScribeFlow.html';
    if (!isPublished(rel)) {
      NOT_PUBLISHED.set(rel, (NOT_PUBLISHED.get(rel) || 0) + 1);
      res.writeHead(404); return res.end('not published by GitHub Pages');
    }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      NOT_PUBLISHED.set(rel + ' (in inventory, missing on disk)', (NOT_PUBLISHED.get(rel) || 0) + 1);
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, origin: 'http://127.0.0.1:' + server.address().port })));
}
class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 1; this.pending = new Map(); this.handlers = new Map();
    socket.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id) {
        const p = this.pending.get(msg.id); if (!p) return;
        this.pending.delete(msg.id); clearTimeout(p.timer);
        msg.error ? p.reject(new Error(p.method + ': ' + msg.error.message)) : p.resolve(msg.result || {});
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach((fn) => { try { fn(msg.params || {}); } catch (_) {} });
      }
    });
  }
  static connect(url) {
    return new Promise((res, rej) => { const s = new WebSocket(url);
      s.addEventListener('open', () => res(new CDP(s)), { once: true });
      s.addEventListener('error', () => rej(new Error('cdp connect failed')), { once: true }); });
  }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  send(method, params, timeout) {
    const id = this.id++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error(method + ': timeout')); }, timeout || 40000);
      this.pending.set(id, { resolve: res, reject: rej, timer, method });
      this.socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}
async function launch(exe, profile, headed) {
  const flags = ['--remote-debugging-port=0', '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-extensions',
    '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain', '--window-size=1440,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'];
  if (!headed) flags.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') flags.unshift('--no-sandbox');
  const child = spawn(exe, flags, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = ''; child.stderr.on('data', (c) => { stderr += String(c); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 25000;
  while (!fs.existsSync(portFile) && Date.now() < deadline) await sleep(50);
  if (!fs.existsSync(portFile)) { try { child.kill(); } catch (_) {} throw new Error('Chrome did not start\n' + stderr.slice(-1500)); }
  let text = '';
  for (let i = 0; i < 120 && !text.trim(); i++) { try { text = fs.readFileSync(portFile, 'utf8'); } catch (_) {} if (!text.trim()) await sleep(50); }
  return { child, port: Number(text.trim().split(/\r?\n/)[0]) };
}
async function evalJs(cdp, expression, awaitPromise) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function wait(cdp, name, expression, timeout) {
  const deadline = Date.now() + (timeout || 30000);
  for (;;) {
    let v = null; try { v = await evalJs(cdp, `(() => { try { return (${expression}); } catch (e) { return false; } })()`); } catch (_) {}
    if (v) return v;
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + name);
    await sleep(120);
  }
}
/* WAIT WITH THE WIRE QUIET.
   A 120ms Runtime.evaluate poll STARVES the page's timer queue. Measured in
   tests/live-loading-gate-lifetime.js: while Node polled every 150ms, the
   page's own 100ms interval advanced ZERO times in 45 seconds, and ticked four
   times in the first 600ms after the polling stopped. The loading gate's whole
   recovery vocabulary is setTimeout - a 300ms anti-flash floor, a 32s force
   release, a 40s watchdog - so wait() cannot be used to wait for anything the
   gate does. It reported this app's perfectly healthy 2.7s reveal as a gate
   that never came down, and that fiction reached this sweep as phantom
   "dock item hidden" defects at the first viewport.
   Poll a second apart so the page gets whole seconds of uninterrupted thread. */
async function waitQuietly(cdp, name, expression, timeout) {
  const deadline = Date.now() + (timeout || 30000);
  for (;;) {
    let v = null; try { v = await evalJs(cdp, `(() => { try { return (${expression}); } catch (e) { return false; } })()`); } catch (_) {}
    if (v) return v;
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + name);
    await sleep(1000);
  }
}
async function click(cdp, selector) {
  const r = await evalJs(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok:false, why:'absent' };
    const b = el.getBoundingClientRect(); if (b.width<=0||b.height<=0) return { ok:false, why:'zero-rect' };
    el.scrollIntoView({ block:'center' }); el.click(); return { ok:true }; })()`);
  assert(r && r.ok, 'Could not click ' + selector + ': ' + JSON.stringify(r));
}
async function fill(cdp, selector, value) {
  const r = await evalJs(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
    el.focus(); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    el.dispatchEvent(new Event('change',{bubbles:true})); return el.value; })()`);
  assert.strictEqual(r, value, 'Could not fill ' + selector);
}
async function settle(cdp) {
  await evalJs(cdp, `(async () => { for (let i=0;i<3;i++) await new Promise(r=>requestAnimationFrame(()=>r()));
    document.getAnimations().forEach(a=>{ try { a.finish(); } catch(e){} }); return 1; })()`, true);
  await sleep(220);
}

/* ------------------------------------------------------- the extra probes */
const GEOMETRY_PROBE = `(() => {
  if (!window.innerWidth || !window.innerHeight) return { VOID: 'viewport 0x0' };
  const de = document.documentElement;
  const out = { horizontalOverflow: Math.max(0, de.scrollWidth - de.clientWidth), widest: [], smallTargets: [] };
  if (out.horizontalOverflow > 1) {
    out.widest = [...document.querySelectorAll('body *')]
      .filter(el => { const s = getComputedStyle(el); return s.display!=='none' && s.visibility!=='hidden' && s.position!=='fixed'; })
      .map(el => { const r = el.getBoundingClientRect();
        return { id: el.id || '', cls: String(el.className||'').slice(0,40), tag: el.tagName, right: Math.round(r.right), w: Math.round(r.width) }; })
      .filter(x => x.right > de.clientWidth + 1)
      .sort((a,b) => b.right - a.right).slice(0, 6);
  }
  /* The app declares html body button{min-height:44px} as a PHONE tap floor, so
     it is only measured at phone widths. Reported at every viewport it produced
     247 findings, of which 241 were desktop chips - section tabs, inline text
     buttons - that no floor claims. At 390px the same probe returns 6, and those
     6 are real: controls whose own rule out-specifies the floor and lowers it.
     A number that large reads as noise and gets ignored, which is worse than not
     measuring at all. */
  out.tapFloorApplies = window.innerWidth <= 760;
  out.smallTargets = !out.tapFloorApplies ? [] : [...document.querySelectorAll('button,[role=button],a[href]')]
    .filter(el => { const s = getComputedStyle(el); if (s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 24); })
    .map(el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      /* minHeight is the fix instruction. A target under the floor because its
         own rule LOWERED min-height (40px) needs that rule raised; one under the
         floor with min-height 44px already set is being squeezed by something
         else and needs a different fix entirely. Reporting only the measured
         height cannot tell a maintainer which of the two they are looking at. */
      return { id: el.id || '', text: String(el.innerText||el.textContent||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim().slice(0,40),
               w: +r.width.toFixed(1), h: +r.height.toFixed(1),
               minHeight: s.minHeight, paddingY: s.paddingTop + '/' + s.paddingBottom,
               display: s.display, boxSizing: s.boxSizing }; })
    .slice(0, 25);
  out.longTasks = (window.__uiSweepLongTasks || []).slice(-30);
  out.pageErrors = (window.__uiSweepErrors || []).slice(-20);
  return out;
})()`;

function defectsFrom(where, sweep, geom) {
  const found = [];
  if (sweep && sweep.drawnButUnreachable && sweep.drawnButUnreachable.VOID) {
    found.push({ kind: 'sweep-void', where, detail: sweep.drawnButUnreachable.VOID });
    return found;
  }
  const un = sweep && sweep.drawnButUnreachable;
  if (un) {
    if (un.positiveControl && un.positiveControl.detected === false) {
      found.push({ kind: 'instrument-blind', where, detail: 'the unreachability probe could not detect its own planted covered control' });
    }
    const list = un.unreachable || un.blocked || [];
    list.forEach((u) => found.push({ kind: 'drawn-but-unreachable', where, detail: u }));
  }
  const dup = sweep && sweep.duplicateVisibleControls;
  if (dup && Array.isArray(dup.exactDuplicates)) {
    dup.exactDuplicates.forEach((d) => {
      /* Two controls with the same label are only a defect when they are both
         real actions on one screen. Disabled twins and icon-only pagination
         reuse the same label legitimately, so those are reported at low weight. */
      const live = (d.controls || []).filter((c) => !c.disabled);
      if (live.length > 1) found.push({ kind: 'duplicate-visible-control', where, detail: d });
    });
  }
  if (geom && !geom.VOID) {
    if (geom.horizontalOverflow > 1) {
      found.push({ kind: 'horizontal-overflow', where, detail: { overflowPx: geom.horizontalOverflow, widest: geom.widest } });
    }
    (geom.smallTargets || []).forEach((t) => found.push({ kind: 'undersized-tap-target', where, detail: t }));
    (geom.longTasks || []).filter((t) => t.duration >= 120).forEach((t) => found.push({ kind: 'long-task', where, detail: t }));
    (geom.pageErrors || []).forEach((e) => found.push({ kind: 'page-error', where, detail: String(e).slice(0, 300) }));
  }
  return found;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write('node tests/live-ui-defect-sweep.js [--headed] [--artifacts=DIR] [--chrome=PATH]\n'); return; }
  const exe = findChrome(opts.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(opts.artifacts || path.join(__dirname, 'live-ui-sweep-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-ui-sweep-'));
  const hosted = await serve();
  let chrome = null, cdp = null;
  const externalRequests = [], consoleErrors = [], exceptions = [];
  const defects = [], visited = [];

  try {
    chrome = await launch(exe, profile, opts.headed);
    cdp = await CDP.connect((await (await fetch(`http://127.0.0.1:${chrome.port}/json/new?about:blank`, { method: 'PUT' })).json()).webSocketDebuggerUrl);
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
    cdp.on('Runtime.exceptionThrown', (e) => exceptions.push(String((e.exceptionDetails && ((e.exceptionDetails.exception || {}).description || e.exceptionDetails.text)) || 'unknown').slice(0, 300)));
    cdp.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') consoleErrors.push((e.args || []).map((x) => x.value || x.description || '').join(' ').slice(0, 300)); });
    cdp.on('Network.requestWillBeSent', (e) => {
      try { const u = new URL(e.request.url); if (u.hostname !== '127.0.0.1' && u.protocol !== 'data:' && u.protocol !== 'blob:') externalRequests.push(e.request.url); } catch (_) {}
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__uiSweepLongTasks=[];window.__uiSweepErrors=[];
      try { new PerformanceObserver(l=>{ for (const e of l.getEntries()) window.__uiSweepLongTasks.push({ duration:Math.round(e.duration), start:Math.round(e.startTime) }); })
        .observe({ entryTypes:['longtask'] }); } catch(e) {}
      addEventListener('error',e=>window.__uiSweepErrors.push(String((e.error&&e.error.stack)||e.message||'error')));
      addEventListener('unhandledrejection',e=>window.__uiSweepErrors.push(String((e.reason&&e.reason.stack)||e.reason||'rejection')));
      window.alert=function(v){window.__uiSweepErrors.push('alert(): '+String(v||''))};
      window.confirm=function(){return false};window.prompt=function(){return null};
    ` });

    /* ---------------- boot + synthetic local account ---------------- */
    const appUrl = `${hosted.origin}/ScribeFlow.html?demo=1&uiSweep=${stamp}`;
    await cdp.send('Page.navigate', { url: appUrl });
    await wait(cdp, 'auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await evalJs(cdp, `localStorage.clear();sessionStorage.clear();location.reload();true`);
    await wait(cdp, 'clean auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`);
    await click(cdp, '#tabSignup');
    await wait(cdp, 'signup assent fields', `document.getElementById('authSignupAssentFields')&&!document.getElementById('authSignupAssentFields').disabled`, 12000);
    await fill(cdp, '#authEmail', ACCOUNT.email); await fill(cdp, '#authPass', ACCOUNT.password); await fill(cdp, '#authPass2', ACCOUNT.password);
    await click(cdp, '#authTermsAssent'); await click(cdp, '#authPracticeAuthority');
    await wait(cdp, 'signup enabled', `!document.getElementById('authBtn').disabled`, 8000);
    await click(cdp, '#authBtn');
    await wait(cdp, 'app screen', `document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`);
    /* #appScreen going display:block is NOT the app becoming visible. While the
       secure loading gate holds `mls-secure-loading` on <html>, every body child
       except the loading card is visibility:hidden!important - so the app screen
       is "shown" and blank, and el.click() still works straight through it. That
       is why an earlier version of this sweep audited a dozen surfaces with the
       whole app invisible and reported the bottom dock as a defect. Wait for the
       gate itself, quietly, so what follows is measured on a painted app. */
    await waitQuietly(cdp, 'the loading gate to come down',
      `!document.documentElement.classList.contains('mls-secure-loading')
       && !document.documentElement.classList.contains('mls-app-revealing')`, 45000);
    await settle(cdp);
    assert.strictEqual(await evalJs(cdp, `typeof backendMode==='function'&&backendMode()===false`), true,
      'the sweep escaped local demo/no-backend mode');

    /* ---------------- a patient and a note, so screens have content ------ */
    /* The dock is built by feat_mls_calm_shell.js AFTER the app screen shows,
       and settle() waits on quiet frames, not on that build. Clicking straight
       through raced it: two runs in a row died on `absent` where an earlier run
       on identical code sailed past. Wait for the thing, and RECORD how long it
       took - if the dock ever stops arriving, that is an app defect and this
       number is the evidence, not a silent retry. */
    const dockMs = await (async () => {
      const t0 = Date.now();
      await wait(cdp, 'dock built', `!!document.querySelector('#mlsDock button[data-dest="patient"]')`, 20000);
      return Date.now() - t0;
    })();
    if (dockMs > 4000) defects.push({ kind: 'dock-slow-to-build', where: 'boot', detail: dockMs + 'ms after the app screen showed' });
    await click(cdp, '#mlsDock button[data-dest="patient"]');
    await wait(cdp, 'patients route', `window.__mlsCurrentView==='patients'`);
    await click(cdp, '#ptNewBtn');
    await wait(cdp, 'new patient dialog', `document.getElementById('patientModal').classList.contains('show')`);
    await fill(cdp, '#ptName', PATIENT.name); await fill(cdp, '#ptMrn', PATIENT.mrn); await fill(cdp, '#ptDob', PATIENT.dob);
    await evalJs(cdp, `(() => { const s=document.getElementById('ptSex'); if(s){ s.value=${JSON.stringify(PATIENT.sex)}; s.dispatchEvent(new Event('change',{bubbles:true})); } return 1; })()`);
    await click(cdp, '#patientModal button[onclick="savePatient()"]');
    await wait(cdp, 'saved synthetic patient', `(() => { const p=window.activePatient&&window.activePatient(); return !!(p&&p.name===${JSON.stringify(PATIENT.name)}); })()`, 12000);
    await click(cdp, '#mlsDock button[data-dest="visit"]');
    await wait(cdp, 'visit route', `window.__mlsCurrentView==='visit'`);
    await evalJs(cdp, `(() => { const box=document.getElementById('noteBox'); if(!box) return 0;
      box.value=${JSON.stringify(NOTE)}; box.style.display='block';
      box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
      try { if (typeof enableOutputs==='function') enableOutputs(true); } catch(e){}
      try { if (typeof saveCurrentNote==='function') saveCurrentNote(false); } catch(e){}
      return 1; })()`);
    await settle(cdp);

    /* ---------------- the sweep ---------------- */
    for (const vp of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: false, screenWidth: vp.w, screenHeight: vp.h });
      await settle(cdp);

      /* PROVE THE VIEWPORT BEFORE TRUSTING ANY MEASUREMENT TAKEN IN IT.
         The tap-target floor this sweep audits lives in @media(max-width:760px)
         (ScribeFlow.html:1692). If setDeviceMetricsOverride resized the layout
         box but the media query never flipped, the 390x844 column would be
         desktop CSS wearing a phone label, and every target it reported would
         be a fiction. That is the exact failure that produced 13 phantom
         duplicate controls earlier in this sweep's life, so it is measured
         here rather than assumed. */
      const vpFact = await evalJs(cdp, `(() => ({
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        phoneQuery: window.matchMedia('(max-width:760px)').matches
      }))()`);
      const wantPhone = vp.w <= 760;
      if (vpFact.clientWidth !== vp.w || vpFact.phoneQuery !== wantPhone) {
        defects.push({ kind: 'viewport-not-really-applied', where: vp.n,
          detail: JSON.stringify(Object.assign({ wantWidth: vp.w, wantPhoneQuery: wantPhone }, vpFact)) });
      }

      for (const route of ROUTES) {
        const where = vp.n + ' / ' + route.label;
        /* SAY WHY, NOT JUST "not visible". A dock destination hides itself when
           the app has gated its view off (feat_mls_calm_shell.js syncDock), and
           that is correct behaviour - the Day item is backend-only, so it is
           legitimately absent in this local no-backend account. A dock item
           that vanishes while its nav tab IS offered is a different animal
           entirely, and the old one-line "not visible" could not tell them
           apart. Report the facts that separate them.

           htmlClass/gateUp are in the payload because visibility:hidden on a
           dock item is almost never the dock's doing: the secure loading gate
           blanks every body child except itself (ScribeFlow.html:26237), so a
           dock item can wear a consequence it did not cause. Name the gate. */
        /* A multi-step route has no single entry element to inspect; its own
           steps report whether each doorway was there. */
        const entryFact = route.openJs ? { ok: true } : await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(route.entry)});
          const dock=document.getElementById('mlsDock');
          const ds=dock?getComputedStyle(dock):null, dr=dock?dock.getBoundingClientRect():null;
          if(!el) return { ok:false, why:'entry element absent', dockPresent:!!dock };
          const s=getComputedStyle(el), r=el.getBoundingClientRect();
          const ok = s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;
          const tabs=(${JSON.stringify(ROUTE_TABS)})[${JSON.stringify(route.route)}]||[];
          const tabOffered = tabs.some(function(id){ const t=document.getElementById(id);
            return !!t && getComputedStyle(t).display!=='none'; });
          return { ok, why: s.display==='none' ? 'dock item display:none'
              : s.visibility==='hidden' ? 'dock item visibility:hidden'
              : r.height<=0 ? 'dock item zero height'
              : r.width<=0 ? 'dock item zero width' : 'hidden',
            tabOffered: tabOffered, dockDisplay: ds?ds.display:null,
            entryRect: [Math.round(r.width*10)/10, Math.round(r.height*10)/10],
            entryStyle: { display:s.display, visibility:s.visibility, opacity:s.opacity, transform:s.transform },
            htmlClass: document.documentElement.className,
            gateUp: document.documentElement.classList.contains('mls-secure-loading')
                 || document.documentElement.classList.contains('mls-app-revealing'),
            dockRect: dr?[Math.round(dr.width),Math.round(dr.height)]:null }; })()`);
        if (!entryFact.ok) {
          /* An entry hidden while its own nav tab is still offered means the
             doctor lost a way in that the app still believes it is giving him. */
          if (entryFact.tabOffered) {
            defects.push({ kind: 'dock-entry-hidden-while-tab-offered', where, detail: JSON.stringify(entryFact) });
          }
          visited.push({ where, opened: false, why: entryFact.why + (entryFact.tabOffered ? ' (but its nav tab IS offered)' : ' (its view is gated off - expected)') });
          continue;
        }
        try {
          /* A route reached through more than one control (History rides a
             segment of the Review destination) declares the presses instead of
             a single entry selector. Each step must report that it found its
             control, so a missing doorway fails rather than silently sweeping
             whatever screen happened to be up. */
          if (route.openJs) {
            const stepA = await evalJs(cdp, route.openJs);
            if (!stepA) throw new Error('the first control on the way to ' + route.label + ' is not there');
            await sleep(600);
            if (route.thenJs) {
              const stepB = await evalJs(cdp, route.thenJs);
              if (!stepB) throw new Error('the ' + route.label + ' control is not offered after opening its parent destination');
            }
          } else {
            await click(cdp, route.entry);
          }
          await wait(cdp, route.label + ' route', `window.__mlsCurrentView===${JSON.stringify(route.route)}`, 15000);
        } catch (e) {
          defects.push({ kind: 'route-would-not-open', where, detail: String(e.message || e).slice(0, 200) });
          visited.push({ where, opened: false, why: String(e.message || e).slice(0, 120) });
          continue;
        }
        await settle(cdp);
        await evalJs(cdp, `window.__uiSweepLongTasks.length=0;1`);
        await settle(cdp);
        const sweep = await evalJs(cdp, SWEEP_SRC);
        const geom = await evalJs(cdp, GEOMETRY_PROBE);
        visited.push({ where, opened: true });
        defects.push(...defectsFrom(where, sweep, geom));
      }

      /* the two surfaces the owner named this week, opened through the app's own
         controls so a broken opener is itself a reported defect */
      for (const surface of [
        { label: 'Templates (op-note tab)', open: `(() => { if (typeof openOpPrep==='function'){ openOpPrep(); return 1; } return 0; })()`,
          ready: `document.getElementById('opPrepModal')&&document.getElementById('opPrepModal').classList.contains('show')`,
          then: `(() => { const t=document.getElementById('oprTabTpls'); if(t){ t.click(); return 1; } return 0; })()`,
          close: `(() => { if (typeof closeOpPrep==='function') closeOpPrep(); return 1; })()` },
        { label: 'Settings', open: `(() => { if (typeof openSettings==='function'){ openSettings(); return 1; } return 0; })()`,
          ready: `document.getElementById('settingsModal')&&document.getElementById('settingsModal').classList.contains('show')`,
          then: '', close: `(() => { if (typeof closeSettings==='function') closeSettings(); return 1; })()` }
      ]) {
        const where = vp.n + ' / ' + surface.label;
        let opened = 0;
        try { opened = await evalJs(cdp, surface.open); } catch (_) { opened = 0; }
        if (!opened) { visited.push({ where, opened: false, why: 'no opener function in this build' }); continue; }
        try { await wait(cdp, surface.label, surface.ready, 12000); } catch (e) {
          defects.push({ kind: 'surface-would-not-open', where, detail: String(e.message || e).slice(0, 200) });
          visited.push({ where, opened: false, why: 'did not reach shown state' });
          continue;
        }
        if (surface.then) { try { await evalJs(cdp, surface.then); } catch (_) {} }
        await settle(cdp);
        await evalJs(cdp, `window.__uiSweepLongTasks.length=0;1`);
        await settle(cdp);
        const sweep = await evalJs(cdp, SWEEP_SRC);
        const geom = await evalJs(cdp, GEOMETRY_PROBE);
        visited.push({ where, opened: true });
        defects.push(...defectsFrom(where, sweep, geom));
        try { await evalJs(cdp, surface.close); } catch (_) {}
        await settle(cdp);
      }
    }

    /* ---------------- report ---------------- */
    const byKind = {};
    defects.forEach((d) => { byKind[d.kind] = (byKind[d.kind] || 0) + 1; });
    const report = {
      generatedAt: new Date().toISOString(), syntheticOnly: true, extensionExercised: false,
      appUrl, viewports: VIEWPORTS.map((v) => v.n), routes: ROUTES.map((r) => r.label),
      surfacesVisited: visited, summaryByKind: byKind, defects,
      externalRequests, consoleErrors, exceptions
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));

    console.log('\n================ WHOLE-PROGRAM UI SWEEP ================');
    console.log('surfaces opened : ' + visited.filter((v) => v.opened).length + ' of ' + visited.length);
    visited.filter((v) => !v.opened).forEach((v) => console.log('  not opened   : ' + v.where + '  (' + v.why + ')'));
    console.log('external reqs   : ' + externalRequests.length + '   console errors: ' + consoleErrors.length + '   page exceptions: ' + exceptions.length);
    /* Printed on SUCCESS too, not only on abort. Every entry is a file the
       running app asked for and production does not have - which is how the
       preload scanner's speculative fetch of a JavaScript string literal was
       found (see tests/no-speculative-preload-of-js-strings.test.js). A 404 the
       doctor never sees is still a 404 the doctor's browser makes. */
    if (NOT_PUBLISHED.size) {
      console.log('requested but NOT published:');
      for (const [rel, n] of NOT_PUBLISHED) console.log('  404 x' + n + '  ' + rel);
    }
    console.log('\ndefects by kind:');
    Object.keys(byKind).sort((a, b) => byKind[b] - byKind[a]).forEach((k) => console.log('  ' + String(byKind[k]).padStart(4) + '  ' + k));
    if (!defects.length) console.log('  (none)');
    console.log('\nfirst 40 defects:');
    defects.slice(0, 40).forEach((d) => console.log('  [' + d.kind + '] ' + d.where + ' :: ' + JSON.stringify(d.detail).slice(0, 220)));
    console.log('\nArtifacts: ' + artifactDir);
    console.log('=======================================================\n');
  } finally {
    if (cdp) cdp.close();
    if (chrome) { try { chrome.child.kill(); } catch (_) {} }
    hosted.server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((e) => {
  console.error('\nUI SWEEP ABORTED: ' + (e && e.stack || e));
  if (NOT_PUBLISHED.size) {
    console.error('\nfiles the app requested that GitHub Pages does not publish:');
    for (const [rel, n] of NOT_PUBLISHED) console.error('  404 x' + n + '  ' + rel);
  }
  process.exit(1);
});
