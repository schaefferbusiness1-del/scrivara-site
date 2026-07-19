'use strict';

/*
 * Dependency-free, real-Chrome smoke test for the clinician UI.
 *
 * This is intentionally separate from run-all.js: it launches Chrome, serves
 * the actual site, and produces screenshots/JSON evidence. It never opens a
 * real Athena page, uses only a fresh synthetic browser profile, and starts the
 * app with ?demo=1 so the production backend is disabled.
 *
 * Examples:
 *   node tests/live-synthetic-smoke.js
 *   node tests/live-synthetic-smoke.js --runs=10 --headed
 *   node tests/live-synthetic-smoke.js --artifacts=tmp/live-smoke/manual
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SYNTHETIC_EMAIL = 'clinician.live-smoke@mls.local';
const SYNTHETIC_PASSWORD = 'SyntheticOnly2026!';
const SYNTHETIC_PATIENT = {
  name: 'Synthetic Reliability Patient',
  dob: '1980-01-02',
  mrn: 'SYN-LIVE-0001',
  sex: 'Female'
};
const SYNTHETIC_TRANSCRIPT =
  'Synthetic fixture only. Follow-up for mechanical low back discomfort. ' +
  'No new weakness, bowel or bladder change, fever, or recent trauma. ' +
  'The clinician reviewed conservative care and return precautions.';
const SYNTHETIC_NOTE = [
  'SUBJECTIVE:',
  'Synthetic fixture only. Follow-up for mechanical low back discomfort. No new neurologic symptoms.',
  '',
  'OBJECTIVE:',
  'Synthetic fixture: alert, comfortable, gait steady. No real patient findings are represented.',
  '',
  'ASSESSMENT:',
  'Mechanical low back discomfort - synthetic test fixture.',
  '',
  'PLAN:',
  'Continue reviewed conservative measures. Synthetic return precautions reviewed.'
].join('\n');

function parseArgs(argv) {
  const out = { runs: 3, headed: false, chrome: '', artifacts: '' };
  for (const arg of argv) {
    if (arg === '--headed') out.headed = true;
    else if (arg.startsWith('--runs=')) out.runs = Number(arg.slice(7));
    else if (arg.startsWith('--chrome=')) out.chrome = arg.slice(9);
    else if (arg.startsWith('--artifacts=')) out.artifacts = arg.slice(12);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.runs) || out.runs < 1 || out.runs > 100) {
    throw new Error('--runs must be an integer from 1 through 100');
  }
  return out;
}

function usage() {
  return [
    'Usage: node tests/live-synthetic-smoke.js [options]',
    '',
    '  --runs=N          Repeat the reload/navigation/stability proof N times (default 3)',
    '  --headed          Show the isolated Chrome window instead of headless Chrome',
    '  --chrome=PATH     Explicit Chrome/Chromium executable',
    '  --artifacts=PATH  Screenshot/report destination (default tests/live-smoke-artifacts/<timestamp>)'
  ].join('\n');
}

function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome-stable',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Google Chrome/Chromium was not found. Pass --chrome=PATH. No package installation is required.');
  return found;
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
    '.mp4': 'video/mp4'
  })[ext] || 'application/octet-stream';
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/ScribeFlow.html' : url.pathname);
      const target = path.resolve(ROOT, `.${pathname}`);
      if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': mimeType(target),
        'Cache-Control': 'no-store, max-age=0',
        'Cross-Origin-Opener-Policy': 'same-origin'
      });
      fs.createReadStream(target).pipe(res);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function readTextWhenUnlocked(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return fs.readFileSync(file, 'utf8'); }
    catch (error) { lastError = error; await sleep(50); }
  }
  throw lastError || new Error(`Timed out reading ${file}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      const handlers = this.listeners.get(message.method) || [];
      for (const handler of handlers) handler(message.params || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chrome DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Could not connect to Chrome DevTools at ${url}`)), { once: true });
    });
  }

  on(method, handler) {
    const list = this.listeners.get(method) || [];
    list.push(handler);
    this.listeners.set(method, list);
  }

  send(method, params = {}, timeoutMs = 70000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method}: Chrome DevTools response timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.socket.close(); } catch (_) {}
  }
}

async function launchChrome(chromePath, profileDir, headed) {
  const args = [
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=MediaRouter,OptimizationHints,Translate,AutofillServerCommunication',
    '--disable-sync',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--window-size=1440,1000',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank'
  ];
  if (!headed) args.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') args.unshift('--no-sandbox');
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try {
    await waitForFile(portFile, 15000);
  } catch (error) {
    try { child.kill(); } catch (_) {}
    throw new Error(`${error.message}\nChrome stderr:\n${stderr.slice(-4000)}`);
  }
  let portText;
  try { portText = await readTextWhenUnlocked(portFile, 5000); }
  catch (error) { try { child.kill(); } catch (_) {} throw error; }
  const [port] = portText.trim().split(/\r?\n/);
  return { child, port: Number(port), stderr: () => stderr };
}

async function createPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome target creation failed: HTTP ${response.status}`);
  const target = await response.json();
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable')
  ]);
  return cdp;
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: !!options.awaitPromise,
    returnByValue: true,
    userGesture: options.userGesture !== false
  }, options.timeoutMs);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || `Evaluation failed: ${expression.slice(0, 120)}`);
  }
  return result.result ? result.result.value : undefined;
}

async function waitFor(cdp, description, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression, {
        userGesture: false,
        timeoutMs: Math.max(250, Math.min(5000, deadline - Date.now()))
      });
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

function selectorLiteral(selector) {
  return JSON.stringify(selector);
}

async function click(cdp, selector) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${selectorLiteral(selector)});
    if (!el) return { ok:false, reason:'missing' };
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width < 1 || rect.height < 1) {
      return { ok:false, reason:'not-visible', display:style.display, visibility:style.visibility, width:rect.width, height:rect.height };
    }
    el.scrollIntoView({ block:'center', inline:'center' });
    el.focus({ preventScroll:true });
    el.click();
    return { ok:true };
  })()`);
  assert(result && result.ok, `Could not click ${selector}: ${JSON.stringify(result)}`);
}

async function fill(cdp, selector, value) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${selectorLiteral(selector)});
    if (!el) return { ok:false, reason:'missing' };
    el.focus({ preventScroll:true });
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:null }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true, value:el.value };
  })()`);
  assert(result && result.ok && result.value === value, `Could not fill ${selector}: ${JSON.stringify(result)}`);
}

async function selectValue(cdp, selector, value) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${selectorLiteral(selector)});
    if (!el) return { ok:false, reason:'missing' };
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true, value:el.value };
  })()`);
  assert(result && result.ok && result.value === value, `Could not select ${selector}=${value}: ${JSON.stringify(result)}`);
}

async function screenshot(cdp, file, timeoutMs = 20000) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, timeoutMs);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
}

async function hardReload(cdp) {
  /* Navigate to the same app with a cache-busting marker. Chrome's Page.reload
     can keep its protocol response open while this very large page finishes
     deferred assets; Page.navigate acknowledges the new document promptly. */
  const beforeNavigate = await evaluate(cdp, `(() => ({
    href:location.href,
    visitDirty:typeof _visitDirty!=='undefined'?!!_visitDirty:null,
    capturing:typeof capturing!=='undefined'?!!capturing:null,
    currentNoteId:typeof currentNoteId!=='undefined'?currentNoteId:null,
    noteMatchesSaved:(()=>{try{return typeof _athenaEditorMatchesSavedVisit==='function'?!!_athenaEditorMatchesSavedVisit():null}catch(_){return null}})(),
    transcriptLength:(document.getElementById('transcript')||{}).value&&document.getElementById('transcript').value.length||0,
    noteLength:(document.getElementById('noteBox')||{}).value&&document.getElementById('noteBox').value.length||0
  }))()`, { userGesture: false, timeoutMs: 5000 });
  assert.strictEqual(beforeNavigate.visitDirty, false, `Saved visit incorrectly remained dirty before reload: ${JSON.stringify(beforeNavigate)}`);
  assert.strictEqual(beforeNavigate.capturing, false, `Visit capture was still active before reload: ${JSON.stringify(beforeNavigate)}`);
  const href = beforeNavigate.href;
  const target = new URL(href);
  target.searchParams.set('liveReload', String(Date.now()));
  const dialogStart = cdp.__mlsDialogEvidence ? cdp.__mlsDialogEvidence.events.length : 0;
  if (cdp.__mlsDialogEvidence) cdp.__mlsDialogEvidence.mayHandleCleanBeforeUnload = true;
  let navigationError = null;
  try {
    await cdp.send('Page.navigate', { url: target.href }, 15000);
  } catch (error) {
    navigationError = error;
  } finally {
    if (cdp.__mlsDialogEvidence) cdp.__mlsDialogEvidence.mayHandleCleanBeforeUnload = false;
  }
  const dialogs = cdp.__mlsDialogEvidence ? cdp.__mlsDialogEvidence.events.slice(dialogStart) : [];
  if (navigationError) {
    throw new Error(`${navigationError.message}; beforeNavigate=${JSON.stringify(beforeNavigate)}; dialogs=${JSON.stringify(dialogs)}`);
  }
  assert.deepStrictEqual(dialogs.filter((event) => event.phase === 'open'), [], `A JavaScript dialog blocked a clean saved-visit reload: ${JSON.stringify(dialogs)}`);
  await sleep(400);
  return { beforeNavigate, dialogs };
}

async function settleUi(cdp) {
  await evaluate(cdp, `(async () => {
    if (window.__mlsSessionReady) await Promise.race([
      Promise.resolve(window.__mlsSessionReady),
      new Promise((_, reject) => setTimeout(() => reject(new Error('session-ready-timeout')), 45000))
    ]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`, { awaitPromise: true, userGesture: false });
  await waitFor(
    cdp,
    'the calm clinician shell and write-flow enhancement',
    `document.body.classList.contains('mls-redesign') && !!document.getElementById('mlsRdNav') && !!window.__mlsWriteFlow`,
    50000
  );
  await sleep(500);
}

async function assertCalmBaseline(cdp, phase) {
  const state = await evaluate(cdp, `(() => {
    const visible = el => {
      if (!el) return false;
      const s=getComputedStyle(el), r=el.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' && r.width>0 && r.height>0;
    };
    const selectors = {
      legacyFab:'#mlsFab', payFloater:'#mlsPrvbBtn', phonePrompt:'#mlsPhPrompt',
      assistantDock:'#mlsAsstFab', dictateDock:'#mlsDaDock', voiceDock:'#mlsCopVoiceBtn',
      idleProgress:'#mlsPsChip.on', forcedTour:'#mlsObt,#mlsOnboardingTour,#obtTour,[data-mls-tour-root]',
      athenaOneClick:'#wf2OneClick', patientBar:'#patientBar'
    };
    const counts={};
    for (const [name, selector] of Object.entries(selectors)) {
      const nodes=[...document.querySelectorAll(selector)];
      counts[name]={ total:nodes.length, visible:nodes.filter(visible).length };
    }
    const duplicateCriticalIds={};
    ['mlsRdTop','mlsRdNav','mlsRdNewBtn','mlsTbMenuBtn','mlsPqsInput','wf2OneClick','mlsAthenaUnifiedConfirm'].forEach(id => {
      const count=document.querySelectorAll('#'+id).length;
      if (count>1) duplicateCriticalIds[id]=count;
    });
    return { counts, duplicateCriticalIds, activePatient:!!(window.activePatient&&window.activePatient()), currentView:window.__mlsCurrentView||'' };
  })()`);
  for (const name of ['legacyFab', 'payFloater', 'phonePrompt', 'assistantDock', 'dictateDock', 'voiceDock', 'idleProgress', 'forcedTour']) {
    assert.strictEqual(state.counts[name].visible, 0, `${phase}: ${name} was visible: ${JSON.stringify(state.counts[name])}`);
  }
  assert.strictEqual(state.counts.athenaOneClick.total, 0, `${phase}: retired #wf2OneClick still exists; #pushAllEmrBtn must be the single Athena review owner`);
  assert.deepStrictEqual(state.duplicateCriticalIds, {}, `${phase}: duplicate critical UI owners exist`);
  return state;
}

async function sampleStability(cdp, phase, durationMs = 1800) {
  const result = await evaluate(cdp, `(async () => {
    const visible = el => {
      if (!el) return false;
      const s=getComputedStyle(el), r=el.getBoundingClientRect();
      return s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' && r.width>0 && r.height>0;
    };
    const selectors=['#mlsFab','#mlsPrvbBtn','#mlsPhPrompt','#mlsAsstFab','#mlsDaDock','#mlsCopVoiceBtn','#mlsPsChip.on','#mlsObt','#mlsOnboardingTour','#obtTour','[data-mls-tour-root]'];
    const samples=[];
    const end=performance.now()+${Number(durationMs)};
    while(performance.now()<end){
      const nav=document.getElementById('mlsRdNav'), top=document.getElementById('mlsRdTop');
      const nr=nav&&nav.getBoundingClientRect(), tr=top&&top.getBoundingClientRect();
      samples.push({
        visibleCompeting:selectors.reduce((n,q)=>n+[...document.querySelectorAll(q)].filter(visible).length,0),
        activeNav:[...document.querySelectorAll('#mlsRdNav .navtab.on')].filter(visible).length,
        nav:nr?[Math.round(nr.x),Math.round(nr.y),Math.round(nr.width),Math.round(nr.height)]:null,
        top:tr?[Math.round(tr.x),Math.round(tr.y),Math.round(tr.width),Math.round(tr.height)]:null
      });
      await new Promise(resolve=>setTimeout(resolve,90));
    }
    const changes=(key)=>samples.slice(1).filter((sample,index)=>JSON.stringify(sample[key])!==JSON.stringify(samples[index][key])).length;
    return {
      sampleCount:samples.length,
      maxCompeting:Math.max(...samples.map(s=>s.visibleCompeting)),
      activeNavValues:[...new Set(samples.map(s=>s.activeNav))],
      navRectChanges:changes('nav'), topRectChanges:changes('top')
    };
  })()`, { awaitPromise: true, userGesture: false });
  assert.strictEqual(result.maxCompeting, 0, `${phase}: competing clinician overlays appeared during stability sampling`);
  assert(result.activeNavValues.every((count) => count <= 1), `${phase}: multiple active nav owners appeared: ${result.activeNavValues}`);
  assert(result.navRectChanges <= 1, `${phase}: sidebar kept moving after settle (${result.navRectChanges} changes)`);
  assert(result.topRectChanges <= 1, `${phase}: top bar kept moving after settle (${result.topRectChanges} changes)`);
  return result;
}

const ROUTES = {
  nav_visit: { route: 'visit', view: '#visitView' },
  nav_patients: { route: 'patients', view: '#patientsView' },
  nav_calendar: { route: 'calendar', view: '#calendarView' },
  nav_orders: { route: 'orders', view: '#ordersView' },
  nav_recs: { route: 'recs', view: '#recsView' },
  nav_history: { route: 'history', view: '#historyView' },
  nav_analysis: { route: 'analysis', view: '#analysisView' },
  nav_studio: { route: 'studio', view: '#studioView' },
  nav_team: { route: 'team', view: '#teamView' },
  nav_legalreq: { route: 'legalreq', view: '#legalReqView' },
  nav_admin: { route: 'admin', view: '#adminView' }
};
const ACTION_TABS = new Set(['nav_staffpull', 'nav_help', 'mlsPtab_reviews', 'mlsPtab_send']);

async function navigateVisibleRoutes(cdp) {
  const visible = await evaluate(cdp, `(() => {
    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    return [...document.querySelectorAll('#mlsRdNav .mainnav > .navtab')].filter(shown).map(el=>({id:el.id,label:(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim()}));
  })()`);
  assert(visible.length >= 4, `Primary navigation rendered only ${visible.length} visible destinations: ${JSON.stringify(visible)}`);
  const unknown = visible.filter((item) => !ROUTES[item.id] && !ACTION_TABS.has(item.id));
  assert.deepStrictEqual(unknown, [], `Visible top-level navigation has no live-smoke strategy: ${JSON.stringify(unknown)}`);
  const routeResults = [];
  for (const item of visible) {
    const spec = ROUTES[item.id];
    if (!spec) continue;
    const started = Date.now();
    await click(cdp, `#${item.id}`);
    await waitFor(cdp, `${item.label} route`, `window.__mlsCurrentView===${JSON.stringify(spec.route)} && (()=>{const el=document.querySelector(${JSON.stringify(spec.view)});if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()`, 10000);
    const owners = await evaluate(cdp, `(() => {
      const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      return {active:[...document.querySelectorAll('#mlsRdNav .navtab.on')].filter(shown).map(el=>el.id), title:(document.getElementById('mlsRdTitle')||{}).textContent||''};
    })()`);
    assert.strictEqual(owners.active.length, 1, `${item.label}: expected one active route, saw ${JSON.stringify(owners.active)}`);
    assert.strictEqual(owners.active[0], item.id, `${item.label}: wrong active navigation owner`);
    routeResults.push({ id: item.id, label: item.label, route: spec.route, elapsedMs: Date.now() - started, title: owners.title.trim() });
  }
  return { visible, routes: routeResults };
}

async function proveHeldWorkspacesAbsent(cdp) {
  const result = await evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&!el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0};
    const controls=[...document.querySelectorAll('button,a,[role="button"],.navtab')].filter(shown);
    const label=el=>(el.innerText||el.textContent||el.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim();
    const heldLabels=controls.map(label).filter(text=>/(?:Legal requests|Flag legal|Supervision queue|Set up payments|direct payouts|Doctor seats|Create a receptionist|Staff account|^Team$)/i.test(text));
    const publicExpertActions=controls.map(label).filter(text=>/(?:request consultation|hire expert|pay now|checkout|publish profile|accept cases)/i.test(text));
    const forbiddenAssets=${JSON.stringify([
      'feat_mls_navfeat_keep.js', 'legal-chart-fill-ui.js', 'feat_mls_legal_exact.js',
      'feat_mls_team_exact.js', 'feat_mls_legal_paywidget.js', 'feat_mls_expert_top.js',
      'feat_mls_legal_pay_setup.js', 'feat_mls_legalpack.js', 'feat_mls_staff_hub.js', 'legal-tracker.js'
    ])};
    const loadedAssets=[...document.scripts].map(script=>{try{return new URL(script.src,location.href).pathname.split('/').pop()}catch(_){return ''}}).filter(name=>forbiddenAssets.includes(name));
    const retiredPortalLinks=[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')||'').filter(href=>/send-portal-invite\\.html/i.test(href));
    const legalFlag=Object.getOwnPropertyDescriptor(window,'__MLS_LEGAL_WORKSPACE_RELEASED');
    const teamFlag=Object.getOwnPropertyDescriptor(window,'__MLS_TEAM_WORKSPACE_RELEASED');
    return {
      heldLabels,publicExpertActions,loadedAssets,retiredPortalLinks,
      legalGlobal:typeof window.__mlsLegalChain,
      supervisionGlobal:typeof window.__mlsSupervision,
      legalFlag:legalFlag&&{value:legalFlag.value,writable:legalFlag.writable,configurable:legalFlag.configurable},
      teamFlag:teamFlag&&{value:teamFlag.value,writable:teamFlag.writable,configurable:teamFlag.configurable}
    };
  })()`);
  assert.deepStrictEqual(result.heldLabels, [], `held legal/payment/team controls are visible: ${JSON.stringify(result.heldLabels)}`);
  assert.deepStrictEqual(result.publicExpertActions, [], `public expert-commerce controls are visible: ${JSON.stringify(result.publicExpertActions)}`);
  assert.deepStrictEqual(result.loadedAssets, [], `held scripts entered the production DOM: ${JSON.stringify(result.loadedAssets)}`);
  assert.deepStrictEqual(result.retiredPortalLinks, [], 'a primary workflow still links to the retired synthetic portal sender');
  assert.strictEqual(result.legalGlobal, 'undefined', 'held embedded legal chain initialized');
  assert.strictEqual(result.supervisionGlobal, 'undefined', 'held embedded supervision workflow initialized');
  assert.deepStrictEqual(result.legalFlag, { value:false, writable:false, configurable:false }, 'legal release flag is not immutable false');
  assert.deepStrictEqual(result.teamFlag, { value:false, writable:false, configurable:false }, 'Team release flag is not immutable false');
  return result;
}

async function proveNoPatientGuard(cdp) {
  await evaluate(cdp, `(() => { if (window.setActivePtId) window.setActivePtId(''); if (window.showView) window.showView('visit'); return true; })()`);
  await sleep(250);
  const result = await evaluate(cdp, `(() => {
    const visible=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const messages=[];
    const listener=event=>{if(event&&event.data&&/^mlsAppAthenaAction/.test(String(event.data.type||'')))messages.push(event.data.type)};
    window.addEventListener('message',listener);
    const originalAlert=window.alert;
    let alertText='';
    window.alert=value=>{alertText=String(value||'')};
    try { window.__mlsWriteFlow.oneClick(); } finally { window.alert=originalAlert; window.removeEventListener('message',listener); }
    return {
      activePatient:!!(window.activePatient&&window.activePatient()),
      oneClickVisible:visible(document.getElementById('wf2OneClick')),
      reviewVisible:visible(document.getElementById('mlsAthenaUnifiedConfirm'))||visible(document.getElementById('emrPanel')),
      alertText, writeMessages:messages
    };
  })()`);
  assert.strictEqual(result.activePatient, false, 'No-patient guard fixture unexpectedly has an active patient');
  assert.strictEqual(result.oneClickVisible, false, 'Athena one-click is visible without an active patient');
  assert.strictEqual(result.reviewVisible, false, 'Athena review opened without an active patient');
  assert(/pick a patient first/i.test(result.alertText), `No-patient guard did not explain the block: ${result.alertText}`);
  assert.deepStrictEqual(result.writeMessages, [], 'No-patient guard emitted an Athena write bridge message');
  return result;
}

async function inspectCanonicalUiRuntime(cdp) {
  await evaluate(cdp, `new Promise(resolve=>setTimeout(()=>resolve(true),1600))`, { awaitPromise: true, timeoutMs: 5000 });
  const result = await evaluate(cdp, `(() => {
    const retired=[
      'classic','mlsEasyClassic','easyV2on','mlsEasyV2On','easyOneOff','easyOneOn',
      '__mlsEasyV32_revert','__mlsEasyV31_revert','__mlsEasyV3_revert','__mlsEasyOne_revert'
    ];
    /* Simulate a delayed historical owner trying to republish every old route. */
    retired.forEach(name=>{try{window[name]=function(){return 'legacy';};}catch(_){}});
    const descriptors={};
    retired.forEach(name=>{
      const d=Object.getOwnPropertyDescriptor(window,name);
      descriptors[name]={type:typeof window[name],exists:!!d,configurable:d?!!d.configurable:null,hasSetter:!!(d&&typeof d.set==='function')};
    });
    const easy=window.__mlsEasyV32;
    const topbar=window.__mlsTopbar;
    return {
      locationPath:location.pathname+location.search+location.hash,
      rollbackParams:{classic:new URLSearchParams(location.search).has('classic'),mlseasy:new URLSearchParams(location.search).has('mlseasy'),easyone:new URLSearchParams(location.search).has('easyone')},
      rollbackStorage:{easyV2:localStorage.getItem('mls.easyV2.enabled'),easyOne:localStorage.getItem('mls.easyOne.enabled')},
      policy:window.__mlsCanonicalEasyPolicy||null,
      descriptors,
      owner:{version:easy&&easy.version||'',sameAliases:easy===window.__mlsEasyV31&&easy===window.__mlsEasyV3,keys:easy?Object.keys(easy).sort():[],openStaffType:easy?typeof easy.openStaff:'missing'},
      topbar:{version:topbar&&topbar.version||'',openStaffPrepType:topbar?typeof topbar.openStaffPrep:'missing'},
      dom:{easyOwners:document.querySelectorAll('#mlsEz3').length,legacyModeButtons:document.querySelectorAll('#ez3ModeDoc,#ez3ModeStaff').length}
    };
  })()`);
  assert.deepStrictEqual(result.rollbackParams, { classic: false, mlseasy: false, easyone: false }, `canonical boot left rollback query routes active: ${JSON.stringify(result)}`);
  assert.deepStrictEqual(result.rollbackStorage, { easyV2: null, easyOne: null }, `canonical boot left rollback storage routes active: ${JSON.stringify(result)}`);
  assert(result.policy && result.policy.installed === true && result.policy.version === 'ce-1.0.0' && result.policy.owner === '__mlsEasyV32', `canonical policy receipt is missing: ${JSON.stringify(result.policy)}`);
  for (const [name, descriptor] of Object.entries(result.descriptors)) {
    assert.deepStrictEqual(descriptor, { type: 'undefined', exists: true, configurable: false, hasSetter: true }, `delayed owner republished ${name}: ${JSON.stringify(descriptor)}`);
  }
  assert.strictEqual(result.owner.version, '3.7.2', `wrong canonical Easy owner survived boot: ${JSON.stringify(result.owner)}`);
  assert.strictEqual(result.owner.sameAliases, true, 'historical Easy aliases do not resolve to the one canonical owner');
  assert.strictEqual(result.owner.openStaffType, 'undefined', 'canonical Easy API exposes a direct Staff route');
  assert.strictEqual(result.topbar.openStaffPrepType, 'undefined', 'topbar API exposes a direct Staff route');
  assert.deepStrictEqual(result.dom, { easyOwners: 1, legacyModeButtons: 0 }, `rendered page has competing Easy owners or legacy mode controls: ${JSON.stringify(result.dom)}`);
  return result;
}

async function proveStaffAccountLocalDates(cdp) {
  const fixture = await evaluate(cdp, `(() => {
    const row=(id,day,name,time)=>({
      id,appointment_id:id,appt_date:day,day_local:day,start_local:time,time_display:time,
      start_at:day+'T'+(time==='08:00 AM'?'08:00:00':'09:00:00'),name,dob:'1980-01-01',mrn:'SYN-TZ-'+id,
      patient_external_id:'synthetic-staff-tz-'+id,provider:'',reason:'Synthetic account timezone boundary',status:'booked',source:'synthetic-live-account-tz'
    });
    window.__mlsLiveStaffDateOriginal={
      hadAppts:Object.prototype.hasOwnProperty.call(window,'_calAppts'),appts:window._calAppts,
      hadToday:Object.prototype.hasOwnProperty.call(window,'_acctTodayKey'),todayFn:window._acctTodayKey
    };
    window._acctTodayKey=function(){return '2026-02-28'};
    window._calAppts=[
      row('tz-jan','2026-01-31','Synthetic Account Last Month','08:00 AM'),
      row('tz-feb','2026-02-01','Synthetic Account February Early','08:00 AM'),
      row('tz-today','2026-02-28','Synthetic Account Today','09:00 AM'),
      row('tz-tomorrow','2026-03-01','Synthetic Account Tomorrow','08:00 AM'),
      row('tz-browser','2026-07-19','Synthetic Browser Local Leak','09:00 AM')
    ];
    const month=document.getElementById('ez3sMonth');if(month)month.value='';
    const today=document.querySelector('#ez3Seg [data-r="today"]');if(today)today.click();
    const now=new Date();
    const pad=n=>String(n).padStart(2,'0');
    return {ok:!!today,accountToday:'2026-02-28',browserToday:now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate())};
  })()`);
  assert(fixture && fixture.ok, `Could not install the live account-timezone Staff fixture: ${JSON.stringify(fixture)}`);

  const ranges = [];
  async function selectRange(range, label, from, to, expectedNames) {
    const clicked = await evaluate(cdp, `(() => {const b=document.querySelector('#ez3Seg [data-r="${range}"]');if(!b)return false;b.click();return true})()`);
    assert.strictEqual(clicked, true, `Staff ${label} range control was missing`);
    const state = await waitFor(cdp, `account-local Staff ${label} range`, `(() => {
      const active=document.querySelector('#ez3Seg [data-r="${range}"].on');
      const summary=document.querySelector('#ez3Seg + .ez3-sub');
      if(!active||!summary)return false;
      const text=(summary.textContent||'').replace(/\\s+/g,' ').trim();
      if(!text.includes(${JSON.stringify(from)})||!text.includes(${JSON.stringify(to)}))return false;
      const names=[...document.querySelectorAll('#ez3Wrap .ez3-prow .nm')].map(el=>(el.textContent||'').trim()).sort();
      const month=document.getElementById('ez3sMonth');
      return {range:${JSON.stringify(range)},summary:text,names,monthValue:month&&month.value||'',monthMax:month&&month.max||'',browserLeak:names.includes('Synthetic Browser Local Leak')};
    })()`, 5000);
    assert.deepStrictEqual(state.names, expectedNames.slice().sort(), `Staff ${label} used browser-local or wrong-month appointments: ${JSON.stringify(state)}`);
    assert.strictEqual(state.browserLeak, false, `Staff ${label} leaked the browser-local date row`);
    assert.strictEqual(state.monthValue, '2026-01', `Staff ${label} month default did not follow account-local February: ${JSON.stringify(state)}`);
    assert.strictEqual(state.monthMax, '2026-02', `Staff ${label} month max did not follow account-local February: ${JSON.stringify(state)}`);
    ranges.push(state);
  }

  let proof = null;
  let bodyError = null;
  try {
    await selectRange('today', 'Today', '2026-02-28', '2026-02-28', ['Synthetic Account Today']);
    await selectRange('tomorrow', 'Tomorrow', '2026-03-01', '2026-03-01', ['Synthetic Account Tomorrow']);
    await selectRange('month', 'This month', '2026-02-01', '2026-02-28', ['Synthetic Account February Early', 'Synthetic Account Today']);
    await selectRange('lastmonth', 'Last month', '2026-01-01', '2026-01-31', ['Synthetic Account Last Month']);
    proof = { accountToday: fixture.accountToday, browserToday: fixture.browserToday, ranges };
    return proof;
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    try {
      const restored = await evaluate(cdp, `(() => {
        const saved=window.__mlsLiveStaffDateOriginal;
        if(!saved)return {ok:false,reason:'missing-original'};
        if(saved.hadToday)window._acctTodayKey=saved.todayFn;else delete window._acctTodayKey;
        if(saved.hadAppts)window._calAppts=saved.appts;else delete window._calAppts;
        const today=document.querySelector('#ez3Seg [data-r="today"]');if(today)today.click();
        delete window.__mlsLiveStaffDateOriginal;
        return {ok:true,mode:window.__mlsEasyV32.state().mode,range:document.querySelector('#ez3Seg [data-r="today"].on')?'today':''};
      })()`);
      if (proof) assert.deepStrictEqual(restored, { ok:true,mode:'staff',range:'today' }, `Staff account-date fixture did not restore cleanly: ${JSON.stringify(restored)}`);
    } catch (cleanupError) {
      if (!bodyError) throw cleanupError;
      bodyError.message += `; Staff account-date cleanup also failed: ${cleanupError.message}`;
    }
  }
}

async function exerciseStaffPrepMenu(cdp, screenshotPath) {
  await waitFor(cdp, 'the single Staff prep Menu entry', `(() => {
    const rows=[...document.querySelectorAll('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]')];
    return rows.length===1 && /Staff prep & Athena month pull/i.test(rows[0].textContent||'');
  })()`, 10000);
  const before = await evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    return {
      menuRows:document.querySelectorAll('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]').length,
      visibleLegacyRail:shown(document.getElementById('nav_staffpull')),
      visibleInline:[...document.querySelectorAll('.ez3fl-staffLink')].filter(shown).length,
      visibleNativeMode:shown(document.getElementById('ez3ModeStaff'))
    };
  })()`);
  assert.strictEqual(before.menuRows, 1, 'Staff prep did not have exactly one Menu entry');
  assert.strictEqual(before.visibleLegacyRail, false, 'legacy Staff pulls rail button was still visible');
  assert.strictEqual(before.visibleInline, 0, 'legacy inline Staff tools button was still visible');
  assert.strictEqual(before.visibleNativeMode, false, 'native Staff prep mode remained visible outside Menu');

  const setupBefore = await evaluate(cdp, `(() => {
    openSetup();SU_STEP=3;suShow();
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const buttons=[...document.querySelectorAll('#su_step3 button')].filter(shown);
    return {modalVisible:shown(document.getElementById('setupModal')),buttons:buttons.map(el=>(el.textContent||'').replace(/\s+/g,' ').trim()),state:window.__mlsEasyV3.state()};
  })()`);
  assert.strictEqual(setupBefore.modalVisible, true, 'Setup Staff guidance step did not render');
  assert.deepStrictEqual(setupBefore.buttons, ['Show Staff Prep in Menu'], `Setup exposed a Staff activation control: ${JSON.stringify(setupBefore)}`);
  assert.strictEqual(setupBefore.state.mode, 'doctor', 'opening Setup changed Easy mode');
  await click(cdp, '#su_step3 button');
  const setupGuidance = await waitFor(cdp, 'Setup guidance opened Menu without Staff', `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const state=window.__mlsEasyV3.state();
    const staff=[...document.querySelectorAll('.ez3-h1')].some(el=>shown(el)&&/Staff prep/i.test(el.textContent||''));
    const panel=document.getElementById('mlsTbMenuPanel'),row=panel&&panel.querySelector('.mlsTbItem[data-mls-action="staff-prep"]');
    return panel&&panel.classList.contains('open')&&shown(row)&&state.mode==='doctor'&&!staff?{menuOpen:true,state,staffVisible:staff,focused:document.activeElement===row}:false;
  })()`, 5000);
  assert.strictEqual(setupGuidance.focused, true, `Setup did not focus the one Menu-owned Staff row: ${JSON.stringify(setupGuidance)}`);
  await evaluate(cdp, `window.__mlsTopbar.closeMenu();true`);
  await waitFor(cdp, 'close Setup-guided Menu', `!document.getElementById('mlsTbMenuPanel').classList.contains('open')`);

  await waitFor(cdp, 'canonical doctor day controls before Staff', `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    return shown(document.getElementById('mlsDsStrip'))&&shown(document.getElementById('mlsDsPullBtn'));
  })()`, 10000);
  await evaluate(cdp, `(() => {
    if(window.__mlsCanonicalModeAudit&&window.__mlsCanonicalModeAudit.stop)window.__mlsCanonicalModeAudit.stop();
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0};
    const audit={startedAt:performance.now(),events:[],samples:[],mutationCount:0,lastSignature:''};
    const controlLabel=el=>(el.getAttribute('aria-label')||el.innerText||el.textContent||el.value||'').replace(/\s+/g,' ').trim().slice(0,160);
    const scan=(label,detail)=>{
      const api=window.__mlsEasyV3;
      const state=api&&typeof api.state==='function'?api.state():null;
      const controls=[...document.querySelectorAll('button,input,select,a[href],[role="button"]')].filter(shown);
      const counts={};controls.forEach(el=>{if(el.id)counts[el.id]=(counts[el.id]||0)+1;});
      const duplicateVisibleIds=Object.keys(counts).filter(id=>counts[id]>1).sort();
      const staffHeading=[...document.querySelectorAll('.ez3-h1')].find(el=>shown(el)&&/Staff prep/i.test(el.textContent||''));
      const visibleToasts=[...document.querySelectorAll('#toast')].filter(shown).map(el=>(el.textContent||'').replace(/\s+/g,' ').trim());
      const directStaffOutsideMenu=controls.filter(el=>!el.closest('#mlsTbMenuPanel')&&(/Staff prep/i.test(controlLabel(el))||el.id==='nav_staffpull'||el.id==='ez3ModeStaff'||el.classList.contains('ez3fl-staffLink'))).map(el=>({id:el.id||'',label:controlLabel(el)}));
      const sample={
        label,at:performance.now(),mode:state&&state.mode||document.body.getAttribute('data-mls-easy-mode')||'',screen:state&&state.screen||'',
        eventPhase:detail&&detail.phase||'',eventReason:detail&&detail.reason||'',
        staffVisible:shown(staffHeading),doctorDateStripVisible:shown(document.getElementById('mlsDsStrip')),
        pullThisDayVisible:shown(document.getElementById('mlsDsPullBtn')),monthPullVisible:shown(document.getElementById('ez3PullStart')),
        visibleToastCount:visibleToasts.length,visibleToasts,
        easyOwnerCount:document.querySelectorAll('#mlsEz3').length,legacyModeButtonCount:document.querySelectorAll('#ez3ModeDoc,#ez3ModeStaff').length,
        visibleControlCount:controls.length,duplicateVisibleIds,directStaffOutsideMenu,
        visibleControls:controls.map(el=>({id:el.id||'',tag:el.tagName.toLowerCase(),label:controlLabel(el)}))
      };
      const signature=JSON.stringify([sample.mode,sample.screen,sample.staffVisible,sample.doctorDateStripVisible,sample.pullThisDayVisible,sample.monthPullVisible,sample.visibleToastCount,sample.easyOwnerCount,sample.legacyModeButtonCount,sample.visibleControlCount,sample.duplicateVisibleIds,sample.directStaffOutsideMenu]);
      if(label!=='mutation'||signature!==audit.lastSignature){if(audit.samples.length<300)audit.samples.push(sample);audit.lastSignature=signature;}
      return sample;
    };
    const listener=event=>{
      const d=event&&event.detail||{};
      audit.events.push({at:performance.now(),mode:d.mode||'',screen:d.screen||'',phase:d.phase||'',reason:d.reason||'',sequence:d.sequence||0,version:d.version||''});
      scan('event:'+String(d.phase||'')+':'+String(d.mode||''),d);
    };
    let pending=false;
    const observer=new MutationObserver(()=>{audit.mutationCount++;if(pending)return;pending=true;queueMicrotask(()=>{pending=false;scan('mutation',null);});});
    window.addEventListener('mls:easy-mode-changed',listener);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','hidden','aria-hidden','data-mls-easy-mode']});
    window.__mlsCanonicalModeAudit={audit,scan,stop:()=>{observer.disconnect();window.removeEventListener('mls:easy-mode-changed',listener);}};
    scan('doctor-before',null);
    return true;
  })()`);
  await evaluate(cdp, `toast('Synthetic stale toast that must not enter Staff Prep','ok');true`);
  const staleToast = await waitFor(cdp, 'the synthetic stale toast to finish becoming visible', `(() => {
    const el=document.getElementById('toast');if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();
    if(el.hidden||s.display==='none'||s.visibility==='hidden'||s.opacity==='0'||r.width<=0||r.height<=0)return false;
    return window.__mlsCanonicalModeAudit.scan('doctor-stale-toast',null);
  })()`, 5000);
  assert.strictEqual(staleToast.visibleToastCount, 1, `live proof could not seed a stale global toast: ${JSON.stringify(staleToast)}`);

  await click(cdp, '#mlsTbMenuBtn');
  await waitFor(cdp, 'open Menu panel', `document.getElementById('mlsTbMenuPanel').classList.contains('open')`);
  await click(cdp, '#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]');
  await waitFor(cdp, 'Staff prep screen from Menu', `(() => {
    const start=document.getElementById('ez3PullStart');
    const h=[...document.querySelectorAll('.ez3-h1')].find(el=>/Staff prep/i.test(el.textContent||''));
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    return shown(h)&&shown(start);
  })()`, 10000);
  const screen = await evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const heading=[...document.querySelectorAll('.ez3-h1')].find(el=>shown(el)&&/Staff prep/i.test(el.textContent||''));
    const host=heading&&(heading.closest('#mlsEz3Ov')||heading.closest('#mlsEz3')||heading.parentElement);
    const subtitle=[...(host||document).querySelectorAll('.ez3-sub')].find(el=>shown(el)&&/Pull schedules/i.test(el.textContent||''));
    const labels=[...(host||document).querySelectorAll('#ez3Seg button')].map(el=>(el.textContent||'').replace(/\\s+/g,' ').trim());
    const month=document.getElementById('ez3PullStart');
    const back=document.getElementById('ez3StaffBack');
    return {
      surfaceId:host&&host.id||'',
      surfaceVisible:shown(host),
      heading:heading&&heading.textContent||'',
      subtitle:subtitle&&(subtitle.textContent||'').replace(/\s+/g,' ').trim()||'',
      rangeLabels:labels,
      monthActionVisible:shown(month),
      monthActionLabel:month&&(month.textContent||'').replace(/\\s+/g,' ').trim()||'',
      backVisible:shown(back),
      state:window.__mlsEasyV3&&window.__mlsEasyV3.state?window.__mlsEasyV3.state():null
    };
  })()`);
  assert.strictEqual(screen.surfaceVisible, true, 'Staff prep surface was not visible after Menu activation');
  assert(/head back to the doctor view to record/i.test(screen.subtitle), `Staff Prep did not explain its doctor workflow: ${screen.subtitle}`);
  assert(!/doctors (?:don’t|don't) see this screen/i.test(screen.subtitle), `Staff Prep contradicted its doctor-visible Menu route: ${screen.subtitle}`);
  for (const label of ['Today', 'Tomorrow', 'This month', 'Last month', 'Custom range']) {
    assert(screen.rangeLabels.includes(label), `Staff prep lost the ${label} schedule range`);
  }
  assert.strictEqual(screen.monthActionVisible, true, `Athena month-pull action was not visible in Staff prep: ${JSON.stringify(screen)}`);
  assert(/Start month pull/i.test(screen.monthActionLabel), `Staff prep month action had unexpected copy: ${screen.monthActionLabel}`);
  assert.strictEqual(screen.backVisible, true, 'Staff prep rendered without its canonical Back to doctor view control');
  const accountLocalDates = await proveStaffAccountLocalDates(cdp);
  await evaluate(cdp, `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__mlsCanonicalModeAudit.scan('staff-settled',null);resolve(true)})))`, { awaitPromise: true, timeoutMs: 5000 });
  if (screenshotPath) await screenshot(cdp, screenshotPath);
  const closeAttempt = await evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const api=window.__mlsEasyV3;
    const state=()=>api&&typeof api.state==='function'?api.state():null;
    const before=state();
    const back=document.getElementById('ez3StaffBack');
    let method='none';
    if(shown(back)){back.click();method='back';}
    return {method,before,after:state(),apiVersion:api&&api.version||'',apiOpen:!!(api&&typeof api.open==='function'),backCount:document.querySelectorAll('.ez3fl-back').length,modeDocCount:document.querySelectorAll('#ez3ModeDoc').length};
  })()`);
  try {
    await waitFor(cdp, 'closed Staff prep screen', `(() => {
      const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
       return ![...document.querySelectorAll('.ez3-h1')].some(el=>shown(el)&&/Staff prep/i.test(el.textContent||''))&&shown(document.getElementById('mlsDsStrip'))&&shown(document.getElementById('mlsDsPullBtn'));
    })()`);
  } catch (error) {
    const diagnostics = await evaluate(cdp, `(() => {
      const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const apis=['__mlsEasyV3','__mlsEasyV31','__mlsEasyV32'].map(name=>{const api=window[name];return {name,same:api===window.__mlsEasyV3,version:api&&api.version||'',state:api&&typeof api.state==='function'?api.state():null,open:!!(api&&typeof api.open==='function')}});
      return {apis,backCount:document.querySelectorAll('.ez3fl-back').length,modeDocCount:document.querySelectorAll('#ez3ModeDoc').length,headings:[...document.querySelectorAll('.ez3-h1')].filter(shown).map(el=>(el.textContent||'').replace(/\s+/g,' ').trim()),currentView:window.__mlsCurrentView||''};
    })()`);
    throw new Error(`${error.message}; closeAttempt=${JSON.stringify(closeAttempt)}; diagnostics=${JSON.stringify(diagnostics)}`);
    }
  assert.strictEqual(closeAttempt.method, 'back', `Staff Prep did not use its canonical Back control: ${JSON.stringify(closeAttempt)}`);
  const transitionAudit = await evaluate(cdp, `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    const runtime=window.__mlsCanonicalModeAudit;
    runtime.scan('doctor-settled',null);runtime.stop();resolve(runtime.audit);
  })))`, { awaitPromise: true, timeoutMs: 5000 });
  const canonicalEvents = transitionAudit.events
    .filter(event=>event.reason==='menu-staff-prep'||event.reason==='staff-back')
    .map(event=>`${event.phase}:${event.mode}:${event.reason}`);
  assert.deepStrictEqual(canonicalEvents, [
    'before:staff:menu-staff-prep','after:staff:menu-staff-prep',
    'before:doctor:staff-back','after:doctor:staff-back'
  ], `Menu → Staff → Back event order was not synchronous: ${JSON.stringify(transitionAudit.events)}`);
  for (const sample of transitionAudit.samples) {
    assert(!(sample.staffVisible&&(sample.doctorDateStripVisible||sample.pullThisDayVisible)), `Staff and doctor-day controls co-rendered: ${JSON.stringify(sample)}`);
    if (sample.mode === 'staff') {
      assert.strictEqual(sample.doctorDateStripVisible, false, `doctor date strip survived Staff mode: ${JSON.stringify(sample)}`);
      assert.strictEqual(sample.pullThisDayVisible, false, `Pull this day survived Staff mode: ${JSON.stringify(sample)}`);
      assert.strictEqual(sample.visibleToastCount, 0, `stale global toast survived the private Staff transition: ${JSON.stringify(sample)}`);
    }
    assert.strictEqual(sample.easyOwnerCount, 1, `canonical Easy owner count changed during transition: ${JSON.stringify(sample)}`);
    assert.strictEqual(sample.legacyModeButtonCount, 0, `legacy mode control appeared during transition: ${JSON.stringify(sample)}`);
    assert.deepStrictEqual(sample.duplicateVisibleIds, [], `visible controls had duplicate ids: ${JSON.stringify(sample)}`);
    assert.deepStrictEqual(sample.directStaffOutsideMenu, [], `a direct Staff control appeared outside Menu: ${JSON.stringify(sample)}`);
  }
  const doctorBefore=transitionAudit.samples.find(sample=>sample.label==='doctor-before');
  const staffSettled=transitionAudit.samples.find(sample=>sample.label==='staff-settled');
  const doctorSettled=transitionAudit.samples.find(sample=>sample.label==='doctor-settled');
  assert(doctorBefore&&doctorBefore.doctorDateStripVisible&&doctorBefore.pullThisDayVisible&&!doctorBefore.staffVisible, `doctor start frame was incomplete: ${JSON.stringify(doctorBefore)}`);
  assert(staffSettled&&staffSettled.staffVisible&&staffSettled.monthPullVisible&&!staffSettled.doctorDateStripVisible&&!staffSettled.pullThisDayVisible, `Staff settled frame was not exclusive: ${JSON.stringify(staffSettled)}`);
  assert.strictEqual(staffSettled.visibleToastCount, 0, `Staff settled with a visible global toast: ${JSON.stringify(staffSettled)}`);
  assert(doctorSettled&&!doctorSettled.staffVisible&&doctorSettled.doctorDateStripVisible&&doctorSettled.pullThisDayVisible&&!doctorSettled.monthPullVisible, `doctor return frame was not exclusive: ${JSON.stringify(doctorSettled)}`);
  return { before, setupGuidance, screen, accountLocalDates, closeAttempt, transitionAudit };
}

async function captureSelectedVisitWorkspace(cdp) {
  return evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0};
    const root=document.getElementById('ez3Wrap');
    const strip=document.getElementById('mlsDsStrip');
    const pathOf=el=>{
      const parts=[];
      while(el&&el!==root){
        const parent=el.parentElement;
        if(!parent)break;
        parts.unshift([...parent.children].indexOf(el));
        el=parent;
      }
      return parts.join('.');
    };
    const shape=[root,...root.querySelectorAll('*')].map(el=>({
      path:el===root?'root':pathOf(el),
      tag:el.tagName.toLowerCase(),
      id:el.id||'',
      classes:[...el.classList].sort(),
      attrs:[...el.attributes].map(attr=>attr.name).filter(name=>name!=='value').sort(),
      disabled:'disabled' in el?!!el.disabled:false
    }));
    const controls=[...root.querySelectorAll('button,input,select,a,[role="button"]')].map(el=>({
      path:pathOf(el),tag:el.tagName.toLowerCase(),id:el.id||'',classes:[...el.classList].sort(),
      type:el.getAttribute('type')||'',role:el.getAttribute('role')||'',visible:shown(el),disabled:!!el.disabled,
      attrs:[...el.attributes].map(attr=>attr.name).filter(name=>name!=='value').sort()
    }));
    const stripTopology=[...strip.children].map((el,index)=>({
      index,tag:el.tagName.toLowerCase(),id:el.id||'',classes:[...el.classList].sort(),type:el.getAttribute('type')||''
    }));
    const stripControlTopology=[...strip.querySelectorAll('button,input,select')].map((el,index)=>({
      index,tag:el.tagName.toLowerCase(),id:el.id||'',classes:[...el.classList].sort(),type:el.getAttribute('type')||'',visible:shown(el)
    }));
    const todayShortcut=document.getElementById('mlsDsTodayBtn');
    const menuRows=[...document.querySelectorAll('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]')];
    return {
      easyVersion:window.__mlsEasyV32&&window.__mlsEasyV32.version||'',
      selectedDay:window.__mlsEasyV32&&window.__mlsEasyV32.remote&&window.__mlsEasyV32.remote.currentVisitDay(),
      daySwitchDay:window.__mlsDaySwitch&&window.__mlsDaySwitch.currentDay(),
      easyState:window.__mlsEasyV32&&window.__mlsEasyV32.state(),
      sameWorkspaceNode:root===window.__mlsLiveCrossDayWrap,
      sameStripNode:strip===window.__mlsLiveCrossDayStrip,
      ownerCounts:{easy:document.querySelectorAll('#mlsEz3').length,wrap:document.querySelectorAll('#ez3Wrap').length,dayStrip:document.querySelectorAll('#mlsDsStrip').length,retiredOtherDayList:document.querySelectorAll('#mlsDsList').length},
      heading:[...root.querySelectorAll('.ez3-h1')].filter(shown).map(el=>(el.textContent||'').replace(/\\s+/g,' ').trim()),
      patientNames:[...root.querySelectorAll('.ez3-prow .nm')].map(el=>(el.textContent||'').replace(/\\s+/g,' ').trim()),
      visibleText:(root.innerText||root.textContent||'').replace(/\\s+/g,' ').trim(),
      dayLabel:(document.getElementById('mlsDsDayLbl')||{}).textContent||'',
      shape,controls,stripTopology,stripControlTopology,
      todayShortcut:{
        exists:!!todayShortcut,visible:shown(todayShortcut),disabled:!!(todayShortcut&&todayShortcut.disabled),
        label:(todayShortcut&&todayShortcut.textContent||'').replace(/\\s+/g,' ').trim(),
        ariaDisabled:todayShortcut&&todayShortcut.getAttribute('aria-disabled')||'',
        ariaCurrent:todayShortcut&&todayShortcut.getAttribute('aria-current')||''
      },
      staffPrepOwnership:{
        menuRows:menuRows.length,
        menuLabel:menuRows[0]&&((menuRows[0].querySelector('span:last-child')||menuRows[0]).textContent||'').replace(/\\s+/g,' ').trim()||'',
        visibleLegacyRail:shown(document.getElementById('nav_staffpull')),
        visibleInline:[...document.querySelectorAll('.ez3fl-staffLink')].filter(shown).length,
        visibleNativeMode:shown(document.getElementById('ez3ModeStaff'))
      }
    };
  })()`);
}

async function proveCrossDayNativeWorkspace(cdp, todayScreenshotPath, nextScreenshotPath) {
  await waitFor(cdp, 'native Easy selected-day APIs', `(() => {
    const easy=window.__mlsEasyV32,ds=window.__mlsDaySwitch;
    const staffRows=[...document.querySelectorAll('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]')];
    return !!(easy&&easy.remote&&typeof easy.remote.setVisitDay==='function'&&
      ds&&typeof ds.setDay==='function'&&typeof ds.currentDay==='function'&&
      document.getElementById('ez3Wrap')&&document.getElementById('mlsDsStrip')&&
      staffRows.length===1&&/Staff prep & Athena month pull/i.test(staffRows[0].textContent||''));
  })()`, 15000);

  const fixture = await evaluate(cdp, `(() => {
    const pad=n=>String(n).padStart(2,'0');
    const key=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
    const plus=(day,n)=>{const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+n);return key(d)};
    const today=typeof window._acctTodayKey==='function'?window._acctTodayKey():key(new Date());
    const rawCases=[
      {label:'today',day:today,prefix:'Synthetic Today'},
      {label:'past',day:plus(today,-1),prefix:'Synthetic Past'},
      {label:'tomorrow',day:plus(today,1),prefix:'Synthetic Tomorrow'},
      {label:'month-end',day:'2026-01-31',prefix:'Synthetic Month End'},
      {label:'month-start',day:'2026-02-01',prefix:'Synthetic Month Start'},
      {label:'year-end',day:'2026-12-31',prefix:'Synthetic Year End'},
      {label:'year-start',day:'2027-01-01',prefix:'Synthetic Year Start'},
      {label:'dst-before',day:'2026-03-07',prefix:'Synthetic DST Before'},
      {label:'dst-start',day:'2026-03-08',prefix:'Synthetic DST Start'},
      {label:'dst-after',day:'2026-03-09',prefix:'Synthetic DST After'}
    ];
    const seen={},cases=[];
    rawCases.forEach(c=>{if(!seen[c.day]){seen[c.day]=1;cases.push(c)}});
    window.__mlsLiveCrossDayOriginal={had:Object.prototype.hasOwnProperty.call(window,'_calAppts'),value:window._calAppts,todayFn:window._acctTodayKey};
    window.__mlsLiveCrossDayWrap=document.getElementById('ez3Wrap');
    window.__mlsLiveCrossDayStrip=document.getElementById('mlsDsStrip');
    const row=(id,day,time,name,dob,mrn)=>({
      id,appointment_id:String(id),appt_date:day,day_local:day,start_local:time,time_display:time,
      start_at:day+'T'+(time==='08:15 AM'?'08:15:00':'09:45:00'),name,dob,mrn,
      patient_external_id:'synthetic-date-'+id,provider:'',reason:'Synthetic isolated date acceptance',
      status:'booked',source:'synthetic-live-date-matrix'
    });
    window._calAppts=[];
    cases.forEach((c,index)=>{
      c.names=[c.prefix+' Alpha',c.prefix+' Beta'];
      window._calAppts.push(
        row(9910000+index*10+1,c.day,'08:15 AM',c.names[0],'1981-01-01','SYN-DATE-'+index+'A'),
        row(9910000+index*10+2,c.day,'09:45 AM',c.names[1],'1982-02-02','SYN-DATE-'+index+'B')
      );
    });
    const accepted=window.__mlsDaySwitch.setDay(today);
    window.__mlsEasyV32.open('home');
    return {today,next:plus(today,1),cases,accepted,fixtureCount:window._calAppts.length};
  })()`);
  assert.strictEqual(fixture.accepted, true, `Easy refused the synthetic Today fixture: ${JSON.stringify(fixture)}`);
  assert.strictEqual(fixture.fixtureCount, fixture.cases.length*2, 'date-matrix fixture did not install exactly two isolated appointments per date');

  let proof;
  try {
    const matrix=[];
    let canonical=null;
    for(const dateCase of fixture.cases){
      const accepted=await evaluate(cdp, `(() => {
        const ok=window.__mlsDaySwitch.setDay(${JSON.stringify(dateCase.day)});
        if(ok)window.__mlsEasyV32.open('home');
        return {ok,day:window.__mlsDaySwitch.currentDay(),easyDay:window.__mlsEasyV32.remote.currentVisitDay(),state:window.__mlsEasyV32.state()};
      })()`);
      assert.strictEqual(accepted.ok,true,`${dateCase.label}: canonical workspace rejected selected date: ${JSON.stringify(accepted)}`);
      await waitFor(cdp,`${dateCase.label} native Easy home`,`window.__mlsDaySwitch.currentDay()===${JSON.stringify(dateCase.day)}&&window.__mlsEasyV32.remote.currentVisitDay()===${JSON.stringify(dateCase.day)}&&!!document.getElementById('ez3Choose')`);
      await click(cdp,'#ez3Choose');
      await waitFor(cdp,`${dateCase.label} native Easy patient list`,`document.querySelectorAll('#ez3Wrap .ez3-prow').length===2`);
      const cleanState=await evaluate(cdp,`(() => ({
        search:(document.getElementById('ez3Search')||{}).value||'',
        expanded:document.querySelectorAll('#ez3Wrap .ez3-prow.open').length,
        active:window.__mlsEasyV32.remote.snapshot().active,
        locked:window.__mlsEasyV32.state().locked
      }))()`);
      assert.deepStrictEqual(cleanState,{search:'',expanded:0,active:null,locked:null},`${dateCase.label}: patient/action state leaked from another date`);
      const state=await captureSelectedVisitWorkspace(cdp);
      if(dateCase.label==='today'&&todayScreenshotPath)await screenshot(cdp,todayScreenshotPath);
      if(dateCase.label==='tomorrow'&&nextScreenshotPath)await screenshot(cdp,nextScreenshotPath);

      assert.strictEqual(state.selectedDay,dateCase.day,`${dateCase.label}: Easy captured the wrong date`);
      assert.strictEqual(state.daySwitchDay,state.selectedDay,`${dateCase.label}: strip and Easy workspace disagreed`);
      assert.strictEqual(state.sameWorkspaceNode,true,`${dateCase.label}: date navigation replaced the canonical Easy workspace node`);
      assert.strictEqual(state.sameStripNode,true,`${dateCase.label}: date navigation replaced the canonical day-strip node`);
      assert.deepStrictEqual(state.ownerCounts,{easy:1,wrap:1,dayStrip:1,retiredOtherDayList:0},`${dateCase.label}: duplicate/retired Visit UI owner appeared`);
      const isToday=dateCase.day===fixture.today;
      assert.deepStrictEqual(state.todayShortcut,{
        exists:true,visible:true,disabled:isToday,label:'Today',ariaDisabled:isToday?'true':'false',ariaCurrent:isToday?'date':'false'
      },`${dateCase.label}: fixed Today shortcut changed visibility, label, or selected state`);
      assert.deepStrictEqual(state.patientNames,dateCase.names,`${dateCase.label}: rendered the wrong appointments`);
      const leaked=fixture.cases.filter(other=>other.day!==dateCase.day).flatMap(other=>other.names).filter(name=>state.visibleText.includes(name));
      assert.deepStrictEqual(leaked,[],`${dateCase.label}: appointment names leaked from another date`);
      assert(state.heading.some(text=>text.includes('Patients')),`${dateCase.label}: native Patients heading disappeared`);
      assert.strictEqual(state.easyState.mode,'doctor',`${dateCase.label}: Easy left doctor mode`);
      assert.strictEqual(state.easyState.screen,'choose',`${dateCase.label}: Easy left the native patient-list screen`);
      assert.deepStrictEqual(state.staffPrepOwnership,{
        menuRows:1,menuLabel:'Staff prep & Athena month pull',visibleLegacyRail:false,visibleInline:0,visibleNativeMode:false
      },`${dateCase.label}: Staff Prep was not exclusively Menu-owned`);
      if(!canonical)canonical=state;
      else{
        assert.deepStrictEqual(state.shape,canonical.shape,`${dateCase.label}: workspace structure differs from Today`);
        assert.deepStrictEqual(state.controls,canonical.controls,`${dateCase.label}: control topology differs from Today`);
        assert.deepStrictEqual(state.stripTopology,canonical.stripTopology,`${dateCase.label}: date-strip structure differs from Today`);
        assert.deepStrictEqual(state.stripControlTopology,canonical.stripControlTopology,`${dateCase.label}: date-strip controls differ from Today`);
        assert.deepStrictEqual(state.ownerCounts,canonical.ownerCounts,`${dateCase.label}: UI ownership differs from Today`);
      }

      await click(cdp,'#ez3Wrap .ez3-prow .moredots');
      const actions=await waitFor(cdp,`${dateCase.label} core row actions`,`(() => {
        const row=document.querySelector('#ez3Wrap .ez3-prow.open');if(!row)return false;
        return [...row.querySelectorAll('[data-act]')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.getAttribute('data-act'));
      })()`);
      assert.deepStrictEqual(actions,['rec','chart','gen','send'],`${dateCase.label}: core appointment actions changed`);
      await fill(cdp,'#ez3Search',dateCase.names[0]);
      const filtered=await waitFor(cdp,`${dateCase.label} local patient filter`,`(() => {
        const names=[...document.querySelectorAll('#ez3Wrap .ez3-prow .nm')].map(el=>(el.textContent||'').trim());
        return names.length===1?names:false;
      })()`);
      assert.deepStrictEqual(filtered,[dateCase.names[0]],`${dateCase.label}: patient filter returned another date/patient`);
      matrix.push({label:dateCase.label,day:dateCase.day,patientNames:state.patientNames,actions,searchIsolation:true,ownerCounts:state.ownerCounts,todayShortcut:state.todayShortcut});
    }

    const rollover=await evaluate(cdp,`(() => {
      window.__mlsLiveClockDay='2026-12-31';
      window._acctTodayKey=function(){return window.__mlsLiveClockDay};
      const accepted=window.__mlsDaySwitch.setDay('2026-12-31');
      if(accepted)window.__mlsEasyV32.open('home');
      window.__mlsLiveClockDay='2027-01-01';
      return {accepted,before:window.__mlsDaySwitch.currentDay()};
    })()`);
    assert.strictEqual(rollover.accepted,true,`midnight fixture could not follow Today: ${JSON.stringify(rollover)}`);
    await waitFor(cdp,'account-local midnight/year rollover',`window.__mlsDaySwitch.currentDay()==='2027-01-01'&&window.__mlsEasyV32.remote.currentVisitDay()==='2027-01-01'&&window.__mlsEasyV32.state().screen==='home'`,5000);
    const midnightFollow=await evaluate(cdp,`(() => {const t=document.getElementById('mlsDsTodayBtn');return {day:window.__mlsDaySwitch.currentDay(),easyDay:window.__mlsEasyV32.remote.currentVisitDay(),sameWorkspace:document.getElementById('ez3Wrap')===window.__mlsLiveCrossDayWrap,active:window.__mlsEasyV32.remote.snapshot().active,locked:window.__mlsEasyV32.state().locked,todayVisible:!!(t&&getComputedStyle(t).display!=='none'),todayDisabled:!!(t&&t.disabled),todayLabel:t&&(t.textContent||'').trim()||''}})()`);
    assert.deepStrictEqual(midnightFollow,{day:'2027-01-01',easyDay:'2027-01-01',sameWorkspace:true,active:null,locked:null,todayVisible:true,todayDisabled:true,todayLabel:'Today'},'midnight rollover did not keep a clean canonical Visit workspace and stable Today shortcut');

    const pinned=await evaluate(cdp,`(() => {const ok=window.__mlsDaySwitch.setDay('2026-03-08');window.__mlsLiveClockDay='2027-01-02';return {ok,day:window.__mlsDaySwitch.currentDay()}})()`);
    assert.strictEqual(pinned.ok,true,`explicit selected-day fixture failed: ${JSON.stringify(pinned)}`);
    await sleep(1700);
    const midnightPinned=await evaluate(cdp,`(() => {const t=document.getElementById('mlsDsTodayBtn');return {day:window.__mlsDaySwitch.currentDay(),easyDay:window.__mlsEasyV32.remote.currentVisitDay(),sameWorkspace:document.getElementById('ez3Wrap')===window.__mlsLiveCrossDayWrap,todayVisible:!!(t&&getComputedStyle(t).display!=='none'),todayDisabled:!!(t&&t.disabled),todayLabel:t&&(t.textContent||'').trim()||''}})()`);
    assert.deepStrictEqual(midnightPinned,{day:'2026-03-08',easyDay:'2026-03-08',sameWorkspace:true,todayVisible:true,todayDisabled:false,todayLabel:'Today'},'midnight rollover overwrote an explicitly selected date or changed the Today shortcut topology');

    const today=matrix.find(item=>item.label==='today');
    const next=matrix.find(item=>item.label==='tomorrow');
    proof={
      today:fixture.today,next:fixture.next,easyVersion:canonical.easyVersion,
      sameWorkspaceNode:true,identicalWorkspaceShape:true,identicalControlTopology:true,identicalDateStripTopology:true,
      ownerCounts:canonical.ownerCounts,staffPrepOwnership:canonical.staffPrepOwnership,
      todayPatientNames:today.patientNames,nextPatientNames:next.patientNames,
      dateMatrix:matrix,midnightFollow,midnightPinned,
      controlCount:canonical.controls.length,elementCount:canonical.shape.length,stripElementCount:canonical.stripTopology.length
    };
    return proof;
  } finally {
    await evaluate(cdp, `(() => {
      const saved=window.__mlsLiveCrossDayOriginal;
      if(saved){if(saved.had)window._calAppts=saved.value;else delete window._calAppts;}
      if(saved&&saved.todayFn)window._acctTodayKey=saved.todayFn;
      delete window.__mlsLiveClockDay;
      const today=typeof window._acctTodayKey==='function'?window._acctTodayKey():new Date().toISOString().slice(0,10);
      try{window.__mlsDaySwitch.setDay(today)}catch(_){}
      try{window.__mlsEasyV32.open('home')}catch(_){}
      delete window.__mlsLiveCrossDayOriginal;
      delete window.__mlsLiveCrossDayWrap;
      delete window.__mlsLiveCrossDayStrip;
      return true;
    })()`);
  }
}

async function proveLiveSameTabAccountBoundary(cdp) {
  const accountA = SYNTHETIC_EMAIL;
  const accountB = 'clinician.account-b.live-smoke@mls.local';
  const accountADay = '2031-11-22';
  const fixture = await evaluate(cdp, `(() => {
    const accountA=${JSON.stringify(SYNTHETIC_EMAIL)},accountB=${JSON.stringify('clinician.account-b.live-smoke@mls.local')};
    const accountADay=${JSON.stringify('2031-11-22')},fixedIso='2026-03-01T04:30:00.000Z';
    const missing=[];
    ['startSession','loadCalendar','_athenaFreezeVisitBinding','_athenaSetVisitBinding'].forEach(name=>{if(typeof window[name]!=='function')missing.push(name)});
    if(!(window.__mlsEasyV32&&window.__mlsEasyV32.remote&&window.__mlsDaySwitch))missing.push('canonical Easy/DaySwitch');
    if(missing.length)return {ok:false,reason:'missing-runtime',missing};
    const current=String((typeof session!=='undefined'&&session&&session.email)||(typeof getSessionEmail==='function'&&getSessionEmail())||'').toLowerCase();
    if(current!==accountA.toLowerCase())return {ok:false,reason:'wrong-start-account',current};

    const NativeDate=window.Date,realFetch=window.fetch,realBackendMode=window.backendMode,
      realBkToken=window.bkToken,realBkBase=window.bkBase;
    const fixedMs=NativeDate.parse(fixedIso);
    const browserDate=new NativeDate(fixedMs);
    const pad=n=>String(n).padStart(2,'0');
    const browserDay=browserDate.getFullYear()+'-'+pad(browserDate.getMonth()+1)+'-'+pad(browserDate.getDate());
    const tzDay=tz=>{
      const parts={};
      new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(browserDate)
        .forEach(part=>{parts[part.type]=part.value});
      return parts.year+'-'+parts.month+'-'+parts.day;
    };
    const accountBTz=['Asia/Tokyo','Pacific/Kiritimati','Pacific/Honolulu','America/Los_Angeles']
      .find(tz=>tzDay(tz)!==browserDay);
    if(!accountBTz)return {ok:false,reason:'no-distinct-timezone',browserDay};
    const accountBDay=tzDay(accountBTz);
    const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(_){return null}};
    const saved={
      NativeDate,realFetch,realBackendMode,realBkToken,realBkBase,
      calAppts:clone(window._calAppts||[]),calProviders:clone(window._calProviders||[]),
      calMe:clone(window._calMe||{}),calYear:window._calYear,calMonth:window._calMonth,
      calMode:window._calMode,calRefDate:window._calRefDate,
      calOwnerAccount:window._calOwnerAccount,calOwnerEpoch:window._calOwnerEpoch,
      bTzStorage:localStorage.getItem('sf_u::'+accountB+'::acctTz')
    };
    class FixedDate extends NativeDate{
      constructor(){super(...(arguments.length?arguments:[fixedMs]));}
      static now(){return fixedMs;}
      static parse(value){return NativeDate.parse(value);}
      static UTC(){return NativeDate.UTC.apply(NativeDate,arguments);}
    }
    Object.setPrototypeOf(FixedDate,NativeDate);
    window.Date=FixedDate;
    localStorage.setItem('sf_u::'+accountB+'::acctTz',accountBTz);

    const fixture={saved,accountA,accountB,accountADay,accountBTz,accountBDay,browserDay,fixedIso,
      held:{},actionCalls:[],buttonActions:[],networkWrites:[],boundary:null,loadPromise:null,bReady:null};
    window.__mlsLiveAccountBoundary=fixture;
    const actionNames=['toggleCapture','startCapture','generateNote','pushEntireVisitToAthena','pushSuperbillToAthena','pushHistoryNoteToAthena','reviewAndPlaceOrderInAthena','pushToAthena'];
    fixture.actionFns={};
    actionNames.forEach(name=>{
      if(typeof window[name]!=='function')return;
      const original=window[name];fixture.actionFns[name]=original;
      window[name]=function(){fixture.actionCalls.push(name);return original.apply(this,arguments)};
    });
    fixture.onClick=event=>{
      const target=event.target&&event.target.closest&&event.target.closest('button,[role="button"],[data-act]');
      if(!target)return;
      const id=target.id||'',act=target.getAttribute('data-act')||'',text=(target.textContent||'').replace(/\\s+/g,' ').trim();
      if(/record|generate|send|sign|athena|save/i.test(id+' '+act+' '+text))fixture.buttonActions.push({id,act,text:text.slice(0,120)});
    };
    document.addEventListener('click',fixture.onClick,true);

    const provider={id:'provider-account-a',name:'Account A Provider'};
    const row={id:7711001,appointment_id:'7711001',appt_date:accountADay,day_local:accountADay,
      start_local:'08:15',time_display:'8:15 AM',start_at:accountADay+'T13:15:00.000Z',
      name:'Account A Calendar Patient',dob:'1970-01-01',mrn:'SYN-ACCOUNT-A',provider:provider.name,
      doctor_user_id:provider.id,status:'booked',source:'synthetic-live-account-boundary'};
    window._calAppts=[row];window._calProviders=[provider];window._calMe={id:provider.id,name:provider.name};
    _calAppts=window._calAppts;_calProviders=window._calProviders;_calMe=window._calMe;
    _calYear=2031;_calMonth=10;_calMode='day';_calRefDate=accountADay;
    _calOwnerAccount=accountA.toLowerCase();_calOwnerEpoch=Number(window.__mlsSessionEpoch)||0;
    const pf=document.getElementById('calProvFilter');
    if(pf){pf.innerHTML='<option value="">All providers</option><option value="'+provider.id+'">'+provider.name+'</option>';pf.value=provider.id;pf.style.display=''}
    const grid=document.getElementById('calGrid');if(grid)grid.textContent='Account A Calendar Patient — Account A Provider';
    const panel=document.getElementById('calDayPanel');if(panel){panel.textContent='Account A Calendar Patient';panel.style.display='block'}
    window.__mlsDaySwitch.setDay(accountADay);window.__mlsEasyV32.open('home');
    const binding=_athenaFreezeVisitBinding({id:'account-a-patient',name:'Account A Calendar Patient',dob:'1970-01-01',mrn:'SYN-ACCOUNT-A'},
      {source:'synthetic-live-account-boundary',visitContext:{visitDate:accountADay,provider:provider.name,appointmentId:'7711001'},displayDate:accountADay,displayProvider:provider.name});
    _athenaSetVisitBinding(binding,true);

    const snapshot=()=>{
      const easy=window.__mlsEasyV32,ds=window.__mlsDaySwitch,pfNow=document.getElementById('calProvFilter');
      const easySnapshot=easy&&easy.remote&&easy.remote.snapshot?easy.remote.snapshot():null;
      return {
        sessionEmail:String(typeof session!=='undefined'&&session&&session.email||''),storedEmail:typeof getSessionEmail==='function'?String(getSessionEmail()||''):'',
        sessionAccount:String(window.__mlsSessionAccount||''),sessionEpoch:Number(window.__mlsSessionEpoch)||0,
        accountTz:typeof _acctTz==='function'?_acctTz():'',accountToday:typeof _acctTodayKey==='function'?_acctTodayKey():'',
        calendar:{rows:(window._calAppts||[]).map(item=>item&&item.name||''),providers:(window._calProviders||[]).map(item=>item&&item.name||''),
          refDate:window._calRefDate==null?null:String(window._calRefDate),owner:String(window._calOwnerAccount||''),ownerEpoch:Number(window._calOwnerEpoch)||0,
          filterValue:pfNow?pfNow.value:null,filterOptions:pfNow?[...pfNow.options].map(option=>option.textContent):[],
          gridText:((document.getElementById('calGrid')||{}).textContent||'').replace(/\\s+/g,' ').trim(),
          dayPanelText:((document.getElementById('calDayPanel')||{}).textContent||'').replace(/\\s+/g,' ').trim()},
        easy:{state:easy&&easy.state?easy.state():null,day:easy&&easy.remote&&easy.remote.currentVisitDay?easy.remote.currentVisitDay():'',
          active:easySnapshot&&easySnapshot.active||null,provider:easySnapshot&&easySnapshot.provider||'',rows:easySnapshot&&easySnapshot.today||[]},
        daySwitchDay:ds&&ds.currentDay?ds.currentDay():'',dayLabel:((document.getElementById('mlsDsDayLbl')||{}).textContent||'').replace(/\\s+/g,' ').trim(),
        todayDisabled:!!((document.getElementById('mlsDsTodayBtn')||{}).disabled),
        binding:typeof currentVisitAthenaBinding!=='undefined'&&currentVisitAthenaBinding?{id:currentVisitAthenaBinding.id,patient:currentVisitAthenaBinding.patient,visitContext:currentVisitAthenaBinding.visitContext}:null,
        capturing:typeof capturing!=='undefined'?!!capturing:null
      };
    };
    fixture.snapshot=snapshot;
    fixture.before=snapshot();
    fixture.onBoundary=event=>{
      const detail=event&&event.detail||{};
      if(String(detail.nextAccount||'').toLowerCase()!==accountB.toLowerCase())return;
      fixture.boundary={detail:clone(detail),state:snapshot()};
    };
    window.addEventListener('mls:session-boundary',fixture.onBoundary);

    window.backendMode=()=>true;
    window.bkToken=()=>String(typeof session!=='undefined'&&session&&session.email||'').toLowerCase()===accountB.toLowerCase()?'token-account-b':'token-account-a';
    window.bkBase=()=>location.origin+'/synthetic-account-boundary';
    window.fetch=(input,init)=>{
      const url=String(input&&input.url||input||''),method=String(init&&init.method||'GET').toUpperCase();
      if(!['GET','HEAD'].includes(method))fixture.networkWrites.push({url,method});
      const kind=url.includes('/api/appointments')?'appointments':(url.includes('/api/providers')?'providers':'');
      if(kind)return new Promise(resolve=>{fixture.held[kind]={url,method,resolve}});
      return realFetch.apply(this,arguments);
    };
    fixture.loadPromise=loadCalendar();
    window.backendMode=realBackendMode;
    fixture.bReady=startSession(accountB);
    fixture.immediate=snapshot();
    return {ok:true,accountA,accountB,accountADay,accountBTz,accountBDay,browserDay,fixedIso,
      held:Object.keys(fixture.held).sort(),before:fixture.before,boundary:fixture.boundary,immediate:fixture.immediate};
  })()`);
  assert(fixture && fixture.ok, `Could not install the live account-boundary fixture: ${JSON.stringify(fixture)}`);
  assert.deepStrictEqual(fixture.held, ['appointments', 'providers'], `Account A calendar reads were not both deliberately held: ${JSON.stringify(fixture)}`);
  assert.notStrictEqual(fixture.accountBDay, fixture.browserDay, `Account B timezone did not differ from the browser-local day: ${JSON.stringify(fixture)}`);
  assert.deepStrictEqual(fixture.before.calendar.rows, ['Account A Calendar Patient'], `Account A calendar row was not seeded: ${JSON.stringify(fixture.before)}`);
  assert.deepStrictEqual(fixture.before.calendar.providers, ['Account A Provider'], `Account A provider was not seeded: ${JSON.stringify(fixture.before)}`);
  assert.strictEqual(fixture.before.calendar.refDate, accountADay, `Account A reference date was not seeded: ${JSON.stringify(fixture.before)}`);
  assert.strictEqual(fixture.before.calendar.filterValue, 'provider-account-a', `Account A provider filter was not selected: ${JSON.stringify(fixture.before)}`);
  assert(fixture.before.binding && fixture.before.binding.patient && fixture.before.binding.patient.name === 'Account A Calendar Patient', `Account A visit binding was not seeded: ${JSON.stringify(fixture.before)}`);
  assert.strictEqual(fixture.before.easy.day, accountADay, `Easy did not own Account A's selected day before the boundary: ${JSON.stringify(fixture.before)}`);
  assert.strictEqual(fixture.before.daySwitchDay, accountADay, `DaySwitch did not own Account A's selected day before the boundary: ${JSON.stringify(fixture.before)}`);

  const sync = fixture.boundary && fixture.boundary.state;
  assert(sync, `The product did not emit a synchronous Account B boundary receipt: ${JSON.stringify(fixture)}`);
  assert.strictEqual(sync.sessionEmail, accountB, `startSession reset listeners ran before adopting Account B: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.storedEmail, accountB, `startSession reset listeners saw stale persisted identity: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.sessionAccount, accountB, `the synchronous boundary was not owned by Account B: ${JSON.stringify(sync)}`);
  assert.strictEqual(fixture.boundary.detail.previousAccount, accountA, `the boundary lost Account A audit ownership: ${JSON.stringify(fixture.boundary)}`);
  assert.strictEqual(fixture.boundary.detail.nextAccount, accountB, `the boundary receipt did not name Account B: ${JSON.stringify(fixture.boundary)}`);
  assert.deepStrictEqual(sync.calendar.rows, [], `Account A rows survived the synchronous boundary: ${JSON.stringify(sync)}`);
  assert.deepStrictEqual(sync.calendar.providers, [], `Account A providers survived the synchronous boundary: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.calendar.refDate, null, `Account A reference date survived the synchronous boundary: ${JSON.stringify(sync)}`);
  assert.deepStrictEqual(sync.calendar.filterOptions, ['All providers'], `Account A provider choices survived the synchronous boundary: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.calendar.filterValue, '', `Account A provider filter survived the synchronous boundary: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.binding, null, `Account A visit binding survived the synchronous boundary: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.easy.state.mode, 'doctor', `Easy did not synchronously return to doctor mode: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.easy.state.screen, 'home', `Easy did not synchronously return home: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.easy.active, null, `Easy retained an active Account A appointment: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.easy.day, fixture.accountBDay, `Easy did not render Account B-local Today in the boundary task: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.daySwitchDay, fixture.accountBDay, `DaySwitch did not render Account B-local Today in the boundary task: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.accountTz, fixture.accountBTz, `reset listeners read the wrong account timezone namespace: ${JSON.stringify(sync)}`);
  assert.strictEqual(sync.accountToday, fixture.accountBDay, `reset listeners read browser-local instead of Account B-local Today: ${JSON.stringify(sync)}`);

  let late;
  try {
    late = await evaluate(cdp, `(async () => {
      const fixture=window.__mlsLiveAccountBoundary;
      const headers={'Content-Type':'application/json'};
      fixture.held.appointments.resolve(new Response(JSON.stringify({appointments:[{
        id:7711999,appointment_id:'7711999',appt_date:fixture.accountADay,day_local:fixture.accountADay,
        start_at:fixture.accountADay+'T16:00:00.000Z',name:'LATE ACCOUNT A PATIENT',dob:'1972-02-02',
        provider:'LATE ACCOUNT A PROVIDER',doctor_user_id:'provider-account-a-late',status:'booked'
      }],me:{id:'provider-account-a-late',name:'LATE ACCOUNT A PROVIDER'}}),{status:200,headers}));
      fixture.held.providers.resolve(new Response(JSON.stringify({providers:[{id:'provider-account-a-late',name:'LATE ACCOUNT A PROVIDER'}]}),{status:200,headers}));
      const result=await fixture.loadPromise;
      await Promise.resolve();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const state=fixture.snapshot();
      const bodyText=(document.body.innerText||document.body.textContent||'').replace(/\\s+/g,' ');
      return {result,state,lateMarkersVisible:/LATE ACCOUNT A PATIENT|LATE ACCOUNT A PROVIDER/.test(bodyText),
        actionCalls:fixture.actionCalls.slice(),buttonActions:fixture.buttonActions.slice(),networkWrites:fixture.networkWrites.slice()};
    })()`, { awaitPromise: true, userGesture: false, timeoutMs: 10000 });
    assert.strictEqual(late.result.applied, false, `the delayed Account A response reported itself applied: ${JSON.stringify(late)}`);
    assert.strictEqual(late.result.discarded, 'session_changed', `the delayed Account A response was not rejected for account ownership: ${JSON.stringify(late)}`);
    assert.deepStrictEqual(late.state.calendar.rows, [], `the delayed Account A response repainted calendar rows: ${JSON.stringify(late)}`);
    assert.deepStrictEqual(late.state.calendar.providers, [], `the delayed Account A response repainted provider choices: ${JSON.stringify(late)}`);
    assert.strictEqual(late.state.calendar.refDate, fixture.accountBDay, `the delayed Account A response restored Account A's reference date instead of Account B-local Today: ${JSON.stringify(late)}`);
    assert.strictEqual(late.lateMarkersVisible, false, `the delayed Account A response painted old-account text: ${JSON.stringify(late)}`);
    assert.strictEqual(late.state.easy.day, fixture.accountBDay, `the delayed response moved Easy away from Account B-local Today: ${JSON.stringify(late)}`);
    assert.strictEqual(late.state.daySwitchDay, fixture.accountBDay, `the delayed response moved DaySwitch away from Account B-local Today: ${JSON.stringify(late)}`);
    assert.strictEqual(late.state.binding, null, `the delayed response restored Account A's visit binding: ${JSON.stringify(late)}`);
    assert.strictEqual(late.state.capturing, false, `the account switch started recording: ${JSON.stringify(late)}`);
    assert.deepStrictEqual(late.actionCalls, [], `the account switch invoked a record/generate/Athena action: ${JSON.stringify(late)}`);
    assert.deepStrictEqual(late.buttonActions, [], `the account switch clicked a record/generate/write control: ${JSON.stringify(late)}`);
    assert.deepStrictEqual(late.networkWrites, [], `the account switch attempted a network write: ${JSON.stringify(late)}`);
    assert(/^Today\b/.test(late.state.dayLabel), `Account B-local Today was not visibly labeled in the date strip: ${JSON.stringify(late)}`);
    assert.strictEqual(late.state.todayDisabled, true, `the Today shortcut was not selected for Account B: ${JSON.stringify(late)}`);
  } finally {
    const cleanup = await evaluate(cdp, `(async () => {
      const fixture=window.__mlsLiveAccountBoundary;if(!fixture)return {ok:false,reason:'fixture-missing'};
      try{window.removeEventListener('mls:session-boundary',fixture.onBoundary)}catch(_){}
      try{document.removeEventListener('click',fixture.onClick,true)}catch(_){}
      Object.keys(fixture.actionFns||{}).forEach(name=>{try{window[name]=fixture.actionFns[name]}catch(_){}});
      window.fetch=fixture.saved.realFetch;window.backendMode=fixture.saved.realBackendMode;
      window.bkToken=fixture.saved.realBkToken;window.bkBase=fixture.saved.realBkBase;window.Date=fixture.saved.NativeDate;
      const bKey='sf_u::'+fixture.accountB+'::acctTz';
      if(fixture.saved.bTzStorage==null)localStorage.removeItem(bKey);else localStorage.setItem(bKey,fixture.saved.bTzStorage);
      const ready=startSession(fixture.accountA);if(ready&&typeof ready.then==='function')await ready;
      _calAppts=Array.isArray(fixture.saved.calAppts)?fixture.saved.calAppts:[];
      _calProviders=Array.isArray(fixture.saved.calProviders)?fixture.saved.calProviders:[];
      _calMe=fixture.saved.calMe&&typeof fixture.saved.calMe==='object'?fixture.saved.calMe:{};
      window._calAppts=_calAppts;window._calProviders=_calProviders;window._calMe=_calMe;
      _calYear=fixture.saved.calYear;_calMonth=fixture.saved.calMonth;_calMode=fixture.saved.calMode;_calRefDate=fixture.saved.calRefDate;
      _calOwnerAccount=String(window.__mlsSessionAccount||fixture.accountA).toLowerCase();_calOwnerEpoch=Number(window.__mlsSessionEpoch)||0;
      try{window.__mlsDaySwitch.resetSession()}catch(_){}
      try{window.__mlsEasyV32.resetSession()}catch(_){}
      const out={ok:true,sessionEmail:String(typeof session!=='undefined'&&session&&session.email||''),storedEmail:String(getSessionEmail()||''),
        day:window.__mlsDaySwitch&&window.__mlsDaySwitch.currentDay(),easyDay:window.__mlsEasyV32&&window.__mlsEasyV32.remote.currentVisitDay()};
      delete window.__mlsLiveAccountBoundary;return out;
    })()`, { awaitPromise: true, userGesture: false, timeoutMs: 45000 });
    assert(cleanup && cleanup.ok, `Live account-boundary cleanup failed: ${JSON.stringify(cleanup)}`);
    assert.strictEqual(cleanup.sessionEmail, accountA, `Live account-boundary cleanup did not restore Account A: ${JSON.stringify(cleanup)}`);
    assert.strictEqual(cleanup.storedEmail, accountA, `Live account-boundary cleanup did not restore Account A storage ownership: ${JSON.stringify(cleanup)}`);
    await settleUi(cdp);
  }
  return {
    accountA, accountB, fixedInstant: fixture.fixedIso,
    browserLocalDay: fixture.browserDay, accountBTimeZone: fixture.accountBTz, accountBToday: fixture.accountBDay,
    synchronousBoundary: fixture.boundary,
    delayedAccountAResult: late.result,
    afterDelayedAccountA: late.state,
    noActionProof: { actionCalls: late.actionCalls, buttonActions: late.buttonActions, networkWrites: late.networkWrites, capturing: late.state.capturing }
  };
}

async function createSyntheticPatient(cdp) {
  await click(cdp, '#nav_patients');
  await waitFor(cdp, 'Patients route', `window.__mlsCurrentView==='patients'`);
  /* Use the clinician's top-bar New menu, not a fixture-only storage shortcut. */
  await click(cdp, '#mlsRdNewBtn');
  await waitFor(cdp, 'New menu', `document.getElementById('mlsRdNewMenu') && document.getElementById('mlsRdNewMenu').classList.contains('open')`);
  const opened = await evaluate(cdp, `(() => {
    const buttons=[...document.querySelectorAll('#mlsRdNewMenu button')];
    const target=buttons.find(button=>/new patient/i.test(button.textContent||''));
    if(!target)return {ok:false,labels:buttons.map(button=>(button.textContent||'').trim())};
    target.click(); return {ok:true};
  })()`);
  assert(opened && opened.ok, `New > New patient action missing: ${JSON.stringify(opened)}`);
  await waitFor(cdp, 'New patient dialog', `document.getElementById('patientModal') && document.getElementById('patientModal').classList.contains('show')`);
  await fill(cdp, '#ptName', SYNTHETIC_PATIENT.name);
  await fill(cdp, '#ptMrn', SYNTHETIC_PATIENT.mrn);
  await fill(cdp, '#ptDob', SYNTHETIC_PATIENT.dob);
  await selectValue(cdp, '#ptSex', SYNTHETIC_PATIENT.sex);
  await click(cdp, '#patientModal button[onclick="savePatient()"]');
  const patient = await waitFor(cdp, 'the saved synthetic patient', `(() => {
    const p=window.activePatient&&window.activePatient();
    return p&&p.name===${JSON.stringify(SYNTHETIC_PATIENT.name)}&&p.dob===${JSON.stringify(SYNTHETIC_PATIENT.dob)}&&p.mrn===${JSON.stringify(SYNTHETIC_PATIENT.mrn)} ? p : false;
  })()`);
  return patient;
}

async function enterAndSaveSyntheticNote(cdp) {
  await click(cdp, '#nav_visit');
  await waitFor(cdp, 'Visit route', `window.__mlsCurrentView==='visit'`);
  await fill(cdp, '#transcript', SYNTHETIC_TRANSCRIPT);
  const result = await evaluate(cdp, `(() => {
    const note=${JSON.stringify(SYNTHETIC_NOTE)};
    currentSoap=note;
    currentInsurance='';
    currentFormat='soap';
    currentCoding={em:'99213',em_just:'Synthetic fixture only',icd:['M54.50'],cpt:[]};
    lastEMR={cc:'Synthetic low back follow-up',dx:'M54.50 - synthetic fixture',meds:'None documented',orders:'None',fu:'As reviewed',em:'99213',icd:'M54.50',cpt:'None'};
    const box=document.getElementById('noteBox');
    box.value=note; box.style.display='block';
    /* The shipped Simple Visit surface mirrors the base editor into #mls-note;
       write through both real editor nodes so this fixture follows the same
       input/update path a generated note uses. */
    const simpleBox=document.getElementById('mls-note');
    if(simpleBox){ simpleBox.value=note; simpleBox.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); }
    document.getElementById('noteEmpty').style.display='none';
    document.getElementById('formatToggleRow').style.display='flex';
    box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    window.dispatchEvent(new CustomEvent('mls:note-updated',{detail:{source:'live-synthetic-fixture'}}));
    if(typeof populateEMR==='function') populateEMR(lastEMR,currentCoding);
    if(typeof renderCoding==='function') renderCoding(currentCoding);
    if(typeof enableOutputs==='function') enableOutputs(true);
    if(typeof setBadge==='function') setBadge(false);
    const saved=saveCurrentNote(false);
    const p=activePatient();
    const record=getNotes().find(n=>n.patientId===p.id && n.soap===note);
    return {saved:!!saved,noteId:record&&record.id,noteCount:getNotes().length,patientId:p&&p.id};
  })()`);
  assert(result.saved && result.noteId, `Synthetic note did not save through the live editor: ${JSON.stringify(result)}`);
  assert(await evaluate(cdp, `!!document.getElementById('pushAllEmrBtn')`), 'Canonical #pushAllEmrBtn Athena review owner is missing');
  return result;
}

async function openAndInspectAthenaReview(cdp) {
  /* Advanced is review-only. Exercise its real visible toggle and prove the
     raw capture/generation engine cannot reappear before using the one visible
     supervised Athena review owner. */
  const reviewWorkspaceTrigger = await evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0};
    const candidates=[document.getElementById('ez3flReview'),document.querySelector('#mlsEz3 .ez3fl-openws'),document.getElementById('ez3Adv')].filter(Boolean);
    const trigger=candidates.find(shown);
    const inventory=candidates.map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{id:el.id||'',text:(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim(),shown:shown(el),display:s.display,visibility:s.visibility,width:r.width,height:r.height}});
    if(document.body.classList.contains('ez3adv'))return{ok:true,alreadyOpen:true,inventory};
    if(!trigger)return{ok:false,inventory,body:document.body.className};
    trigger.click();return{ok:true,id:trigger.id||'',text:(trigger.innerText||trigger.textContent||'').replace(/\s+/g,' ').trim(),inventory};
  })()`);
  assert(reviewWorkspaceTrigger&&reviewWorkspaceTrigger.ok,`No visible review/Advanced trigger could open the contained workspace: ${JSON.stringify(reviewWorkspaceTrigger)}`);
  await waitFor(cdp, 'the Advanced review workspace to open', `document.body.classList.contains('ez3adv')`, 10000);
  const advancedContainment = await evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0};
    const inspect=selector=>{const nodes=[...document.querySelectorAll(selector)];return{selector,total:nodes.length,visible:nodes.filter(shown).length}};
    const raw=[
      inspect('#captureCard #captureBtn'),inspect('#captureCard #phoneMicBtn'),inspect('#captureCard #genBtn'),
      inspect('#noteCard button[onclick*="generateNote"]'),inspect('#noteCard button[onclick*="regenerateNote"]'),inspect('#noteCard .ne-regen')
    ];
    const capture=inspect('#captureCard'),note=inspect('#noteCard'),review=inspect('#noteCard #pushAllEmrBtn');
    return{bodyAdvanced:true,capture,note,review,raw};
  })()`);
  assert.deepStrictEqual({total:advancedContainment.capture.total,visible:advancedContainment.capture.visible},{total:1,visible:0},`Advanced exposed or lost the raw capture card: ${JSON.stringify(advancedContainment)}`);
  assert.deepStrictEqual({total:advancedContainment.note.total,visible:advancedContainment.note.visible},{total:1,visible:1},`Advanced did not expose exactly one note-review card: ${JSON.stringify(advancedContainment)}`);
  assert.deepStrictEqual({total:advancedContainment.review.total,visible:advancedContainment.review.visible},{total:1,visible:1},`Advanced did not expose exactly one supervised Athena review owner: ${JSON.stringify(advancedContainment)}`);
  for(const route of advancedContainment.raw){assert(route.total>=1&&route.visible===0,`Advanced raw clinical route was missing or visible: ${JSON.stringify(route)}; all=${JSON.stringify(advancedContainment)}`);}
  const invoked = await evaluate(cdp, `(() => {
    const panelState=el=>{if(!el)return {exists:false,visible:false};const s=getComputedStyle(el),r=el.getBoundingClientRect();return {exists:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0,display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height,classes:el.className||'',ariaHidden:el.getAttribute('aria-hidden')};};
    const syncCounts=()=>{const s=window.__mlsSync&&typeof window.__mlsSync.state==='function'?window.__mlsSync.state():null;return s?{verified:s.verified,pending:s.pending,failed:s.failed,uncertain:s.uncertain,count:s.count}:null;};
    const el=document.getElementById('pushAllEmrBtn');
    if(!el)return {ok:false};
    const before={emrPanel:panelState(document.getElementById('emrPanel')),unified:panelState(document.getElementById('mlsAthenaUnifiedConfirm')),syncCounts:syncCounts()};
    el.click();
    return {ok:true,before,afterReviewOpenSyncCounts:syncCounts()};
  })()`);
  assert(invoked && invoked.ok, 'Canonical #pushAllEmrBtn Athena review owner could not be invoked');
  assert.deepStrictEqual(invoked.afterReviewOpenSyncCounts,invoked.before.syncCounts,`Opening the read-only Athena review changed the mutation send badge: ${JSON.stringify(invoked)}`);
  await waitFor(cdp, 'the unified Athena review surface', `!!document.getElementById('mlsAthenaUnifiedConfirm')`, 10000);
  const result = await evaluate(cdp, `(() => {
    const modal=document.getElementById('mlsAthenaUnifiedConfirm');
    const panelState=el=>{if(!el)return {exists:false,visible:false};const s=getComputedStyle(el),r=el.getBoundingClientRect();return {exists:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0,display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height,classes:el.className||'',ariaHidden:el.getAttribute('aria-hidden')};};
    const text=(modal.innerText||modal.textContent||'').replace(/\\s+/g,' ').trim();
    const rows=[...modal.querySelectorAll('[data-manifest-row]')].map(row=>({id:row.getAttribute('data-manifest-row'),text:(row.innerText||row.textContent||'').replace(/\\s+/g,' ').trim()}));
    const radioRows=[...modal.querySelectorAll('input[name="mlsAthenaUnifiedAction"]')].map(radio=>radio.value);
    const confirm=document.getElementById('mlsAthenaUnifiedGo');
    return {text,rows,radioRows,confirmDisabled:!!(confirm&&confirm.disabled),role:modal.getAttribute('role'),ariaModal:modal.getAttribute('aria-modal'),emrPanel:panelState(document.getElementById('emrPanel')),athenaReceipt:panelState(document.getElementById('athenaReceipt'))};
  })()`);
  result.beforeOpen = invoked.before;
  result.advancedContainment = advancedContainment;
  assert(/nothing has changed yet/i.test(result.text), 'Athena review lacks the no-change pre-confirmation truth');
  assert(/complete final actions in athena/i.test(result.text), 'Athena review does not tell the clinician to complete final actions in Athena');
  assert(result.rows.some((row) => row.id === 'write-note'), 'Athena review lacks the reviewed note row');
  assert(result.rows.some((row) => row.id === 'save-draft'), 'Athena review lacks the independent Save Draft row');
  for (const manualId of ['stage-billing', 'sign-encounter']) {
    const row = result.rows.find((candidate) => candidate.id === manualId);
    assert(row && /manual|complete in athena/i.test(row.text), `${manualId} was not visibly manual/review-only`);
    assert(!result.radioRows.includes(manualId), `${manualId} was selectable as an executable action`);
  }
  /* No extension is loaded in this isolated proof, so a write must remain disabled. */
  assert.strictEqual(result.confirmDisabled, true, 'Athena write confirmation enabled without a verified extension/encounter check');
  assert.strictEqual(result.role, 'dialog', 'Unified Athena review lacks role=dialog');
  assert.strictEqual(result.ariaModal, 'true', 'Unified Athena review lacks aria-modal=true');
  assert.strictEqual(result.emrPanel.visible, false, `Legacy #emrPanel competed behind the unified Athena review: ${JSON.stringify(result.emrPanel)}`);
  assert.strictEqual(result.athenaReceipt.visible, false, `Legacy #athenaReceipt competed behind the unified Athena review: ${JSON.stringify(result.athenaReceipt)}`);
  return result;
}

async function closeAthenaReview(cdp) {
  const hasModal = await evaluate(cdp, `!!document.getElementById('mlsAthenaUnifiedConfirm')`);
  if (!hasModal) return { skipped: true };
  await click(cdp, '#mlsAthenaUnifiedClose');
  const postRemoval = await waitFor(cdp, 'Athena review to close', `(() => {
    if(document.getElementById('mlsAthenaUnifiedConfirm'))return false;
    const panelState=el=>{if(!el)return {exists:false,visible:false};const s=getComputedStyle(el),r=el.getBoundingClientRect();return {exists:true,visible:s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'&&r.width>0&&r.height>0,display:s.display,visibility:s.visibility,opacity:s.opacity,width:r.width,height:r.height,classes:el.className||'',ariaHidden:el.getAttribute('aria-hidden'),inert:!!el.inert};};
    return {modalExists:false,emrPanel:panelState(document.getElementById('emrPanel')),athenaReceipt:panelState(document.getElementById('athenaReceipt')),errors:(window.__mlsLiveSmokeErrors||[]).slice(-20),longTasks:(window.__mlsLiveSmokeLongTasks||[]).slice(-20)};
  })()`, 5000);
  try {
    const responsive = await evaluate(cdp, `(() => ({ready:document.readyState,modal:!!document.getElementById('mlsAthenaUnifiedConfirm')}))()`, {
      userGesture: false,
      timeoutMs: 5000
    });
    assert.deepStrictEqual(responsive, { ready: 'complete', modal: false }, `Unexpected post-review state: ${JSON.stringify(responsive)}`);
  } catch (error) {
    throw new Error(`Chrome renderer became unresponsive after closing the Athena review: ${error.message}; postRemoval=${JSON.stringify(postRemoval)}`);
  }
  return postRemoval;
}

async function reloadAndReopenSavedNote(cdp, noteId) {
  process.stdout.write('[live] hard-reloading for persistence proof\n');
  const reloadNavigation = await hardReload(cdp);
  await waitFor(cdp, 'restored local session', `document.readyState==='complete' && document.getElementById('appScreen') && getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 30000);
  process.stdout.write('[live] local session restored; waiting for clinician bundle\n');
  await settleUi(cdp);
  const restored = await evaluate(cdp, `(() => {
    const p=window.activePatient&&window.activePatient();
    const n=window.getNotes&&window.getNotes().find(n=>n.id===${JSON.stringify(noteId)});
    return {patient:p&&{id:p.id,name:p.name,dob:p.dob,mrn:p.mrn},note:n&&{id:n.id,patientId:n.patientId,soap:n.soap,transcript:n.transcript}};
  })()`);
  assert(restored.patient && restored.patient.name === SYNTHETIC_PATIENT.name, `Active synthetic patient did not survive reload: ${JSON.stringify(restored)}`);
  assert(restored.note && restored.note.soap === SYNTHETIC_NOTE && restored.note.transcript === SYNTHETIC_TRANSCRIPT, 'Exact synthetic transcript/note did not survive reload');
  assert.strictEqual(restored.note.patientId, restored.patient.id, 'Reloaded note detached from the selected synthetic patient');
  await click(cdp, '#nav_history');
  await waitFor(cdp, 'History route and saved note row', `window.__mlsCurrentView==='history' && document.querySelectorAll('#histList .hist-item').length>0`, 10000);
  const rowClick = await evaluate(cdp, `(() => {
    const rows=[...document.querySelectorAll('#histList .hist-item')];
    const row=rows.find(el=>(el.textContent||'').includes(${JSON.stringify(SYNTHETIC_PATIENT.name)}));
    if(!row)return {ok:false,rows:rows.map(el=>(el.textContent||'').replace(/\\s+/g,' ').trim()).slice(0,10)};
    row.click(); return {ok:true};
  })()`);
  assert(rowClick && rowClick.ok, `Could not open saved synthetic History row: ${JSON.stringify(rowClick)}`);
  const detailSurface = await waitFor(cdp, 'saved-note detail surface', `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const modern=document.querySelector('.mlsvnd-scrim > .mlsvnd-modal');
    if(shown(modern))return {kind:'modern',selector:'.mlsvnd-scrim > .mlsvnd-modal',id:modern.id||'',role:modern.getAttribute('role'),ariaModal:modern.getAttribute('aria-modal'),text:(modern.innerText||modern.textContent||'').replace(/\s+/g,' ').trim()};
    const legacy=document.getElementById('viewModal');
    if(shown(legacy)&&legacy.classList.contains('show'))return {kind:'legacy',selector:'#viewModal',id:legacy.id,role:legacy.getAttribute('role'),ariaModal:legacy.getAttribute('aria-modal'),text:(legacy.innerText||legacy.textContent||'').replace(/\s+/g,' ').trim()};
    return false;
  })()`, 10000);
  assert(/synthetic low back follow-up/i.test(detailSurface.text), `Saved-note detail showed the wrong visit: ${JSON.stringify(detailSurface)}`);
  if (detailSurface.kind === 'modern') {
    /* The shipped history wrapper first presents structured visit detail. Test
       its real Edit visit action, then follow the explicit Edit raw note escape
       hatch to the canonical saved-note editor/reopen control. */
    await click(cdp, '.mlsvnd-modal .mlsvd-edit');
    const structuredEdit = await waitFor(cdp, 'structured Edit visit form', `(() => {
      const form=document.querySelector('.mlsvnd-modal .mlsvd-editview');
      if(!form)return false;
      const value=name=>{const el=form.querySelector('[data-fld="'+name+'"]');return el&&el.value||''};
      return {type:value('type'),icd10:value('icd10'),cpt:value('cpt')};
    })()`, 5000);
    assert(/synthetic low back follow-up/i.test(structuredEdit.type), `Edit visit loaded the wrong type: ${JSON.stringify(structuredEdit)}`);
    assert(/M54\.50/i.test(structuredEdit.icd10), `Edit visit lost the synthetic ICD-10 fixture: ${JSON.stringify(structuredEdit)}`);
    assert(/99213/i.test(structuredEdit.cpt), `Edit visit lost the synthetic CPT fixture: ${JSON.stringify(structuredEdit)}`);
    await click(cdp, '.mlsvnd-modal .mlsvd-cancel');
    await waitFor(cdp, 'saved-note detail read view', `!!document.querySelector('.mlsvnd-modal .mlsvd-edit')`, 5000);
    const rawAction = await evaluate(cdp, `(() => {
      const buttons=[...document.querySelectorAll('.mlsvnd-modal .mlsvd-acts button')];
      const target=buttons.find(button=>/edit raw note/i.test(button.textContent||''));
      if(!target)return {ok:false,labels:buttons.map(button=>(button.textContent||'').replace(/\s+/g,' ').trim())};
      const fn=window.openNoteFromHistory,orig=fn&&fn.__mlsOrig;
      const chain={wrapper:!!(fn&&fn.__mlsNoteDetail),wrapperSource:String(fn||'').slice(0,240),origExists:typeof orig==='function',origWrapper:!!(orig&&orig.__mlsNoteDetail),origSource:String(orig||'').slice(0,240)};
      target.click();return {ok:true,chain};
    })()`);
    assert(rawAction && rawAction.ok, `Saved-note detail lacked Edit raw note: ${JSON.stringify(rawAction)}`);
    await sleep(250);
    const rawOutcome = await evaluate(cdp, `(() => ({
      legacyShow:!!(document.getElementById('viewModal')&&document.getElementById('viewModal').classList.contains('show')),
      modernShow:!!document.querySelector('.mlsvnd-scrim > .mlsvnd-modal'),
      viewingId:typeof viewingId!=='undefined'?viewingId:null,
      errors:(window.__mlsLiveSmokeErrors||[]).slice(-10)
    }))()`);
    assert.strictEqual(rawOutcome.legacyShow, true, `Edit raw note did not open the canonical saved-note editor: ${JSON.stringify({rawAction,rawOutcome})}`);
  }
  await waitFor(cdp, 'canonical raw saved-note modal', `document.getElementById('viewModal').classList.contains('show') && document.getElementById('viewBody').value.includes(${JSON.stringify('Mechanical low back discomfort')})`, 5000);
  await click(cdp, '#viewModal button[onclick="reopenViewed()"]');
  await waitFor(cdp, 'reopened note editor', `window.__mlsCurrentView==='visit' && document.getElementById('noteBox').value===${JSON.stringify(SYNTHETIC_NOTE)}`, 10000);
  return { ...restored, detailSurface, reloadNavigation };
}

async function recoverSyntheticEditorForRemainingChecks(cdp, noteId) {
  /* A failed user-path assertion must stay a release failure, but it should not
     hide unrelated route/overlay defects later in the same expensive Chrome
     run. This synthetic-only recovery closes test surfaces and invokes the
     shipped record loader solely so evidence collection can continue. */
  const recovered = await evaluate(cdp, `(() => {
    document.querySelectorAll('.mlsvnd-scrim').forEach(el=>el.remove());
    const legacy=document.getElementById('viewModal');if(legacy)legacy.classList.remove('show');
    const n=getNotes().find(n=>n.id===${JSON.stringify(noteId)});if(!n)return {ok:false,reason:'missing-note'};
    if(n.patientId&&findPatient(n.patientId))setActivePtId(n.patientId);
    showView('visit');loadRecordIntoEditor(n);renderPatientBar();
    if(typeof _wipeVisitDraft==='function')_wipeVisitDraft();
    return {ok:true,patientId:n.patientId,noteId:n.id,testRecoveryClearedDirty:typeof _visitDirty!=='undefined'?!_visitDirty:null};
  })()`);
  assert(recovered && recovered.ok, `Could not recover the synthetic editor after a recorded phase failure: ${JSON.stringify(recovered)}`);
  await waitFor(cdp, 'synthetic editor recovery', `window.__mlsCurrentView==='visit' && document.getElementById('noteBox').value===${JSON.stringify(SYNTHETIC_NOTE)}`, 10000);
  return recovered;
}

async function exerciseSearch(cdp) {
  const searchExists = await evaluate(cdp, `!!document.getElementById('mlsPqsInput')`);
  if (!searchExists) return { available: false };
  const decoyId = 'live-find-prior-patient';
  let setup = null;
  let proof = null;
  let bodyError = null;
  try {
    /* Start with a different chart genuinely active. A text-only Find check
       cannot catch the dangerous failure where the result name changes while
       the old chart remains selected underneath it. */
    setup = await evaluate(cdp, `(() => {
      const targetMatches=getPatients().filter(p=>p&&p.name===${JSON.stringify(SYNTHETIC_PATIENT.name)});
      if(targetMatches.length!==1||!targetMatches[0].id)return {ok:false,reason:'target-not-unique',matches:targetMatches.map(p=>({id:p&&p.id,name:p&&p.name}))};
      const target=targetMatches[0],decoyId=${JSON.stringify(decoyId)};
      const fixturePatients=getPatients().filter(p=>p&&String(p.id)!==decoyId);
      /* This disposable fixture must not enqueue the production save verifier:
         the test deliberately removes it later, which would otherwise create
         a false persistent "Save not confirmed" warning after cleanup. The
         isolated synthetic harness therefore installs this search fixture as
         one bulk store setup; real product saves continue through upsertPatient
         and its integrity verifier. */
      fixturePatients.push({id:decoyId,name:'Synthetic Prior Active Patient',dob:'1971-11-12',mrn:'SYN-FIND-PRIOR',sex:'Other',source:'synthetic-live-find'});
      savePatients(fixturePatients);
      openPatient(decoyId);showView('calendar');renderPatientBar();
      window.__mlsLiveFindOriginalEpoch={had:Object.prototype.hasOwnProperty.call(window,'__mlsSessionEpoch'),value:window.__mlsSessionEpoch};
      return {ok:true,target:{id:String(target.id),name:target.name,dob:target.dob||''},decoyId,patientCount:getPatients().length,activeId:getActivePtId(),view:window.__mlsCurrentView||'',fixtureMode:'bulk-synthetic-store'};
    })()`);
    assert(setup && setup.ok, `Could not prepare the stale-chart Find fixture: ${JSON.stringify(setup)}`);
    assert.strictEqual(setup.fixtureMode, 'bulk-synthetic-store', `Find fixture did not use its isolated synthetic store setup: ${JSON.stringify(setup)}`);
    assert.strictEqual(setup.activeId, decoyId, `Find fixture did not make the decoy chart active: ${JSON.stringify(setup)}`);
    assert.strictEqual(setup.view, 'calendar', `Find fixture did not start outside Visit: ${JSON.stringify(setup)}`);
    await waitFor(cdp, 'the prior synthetic chart to be active', `getActivePtId()===${JSON.stringify(decoyId)}&&activePatient()&&activePatient().id===${JSON.stringify(decoyId)}&&window.__mlsCurrentView==='calendar'`, 5000);

    /* The visible top-bar field must launch Find Anything Pro; testing a
       hidden/direct engine would miss a broken clinician entry point. */
    await click(cdp, '#mlsPqsInput');
    let surface;
    try {
      surface = await waitFor(cdp, 'Find search surface', `(() => {
      const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      if(shown(document.getElementById('mlsFpQf')))return {kind:'find-anything-pro',input:'#mlsFpQfInput',results:'#mlsFpQfList'};
      if(shown(document.getElementById('mlsQuickFindOv')))return {kind:'quick-find',input:'#mlsQfInput',results:'#mlsQfResults'};
      const native=document.getElementById('mlsPqsPanel');
      if(shown(native))return {kind:'patient-quick-search',input:'#mlsPqsInput',results:'#mlsPqsPanel'};
      return false;
    })()`, 5000);
    } catch (error) {
      const diagnostics = await evaluate(cdp, `(() => {
        const state=id=>{const el=document.getElementById(id);if(!el)return {exists:false};const s=getComputedStyle(el),r=el.getBoundingClientRect();return {exists:true,display:s.display,visibility:s.visibility,width:r.width,height:r.height,ariaHidden:el.getAttribute('aria-hidden')};};
        const launcher=document.getElementById('mlsPqsInput');
        return {activeId:document.activeElement&&document.activeElement.id||'',launcher:{wired:!!(launcher&&launcher.__mlsTbWired),value:launcher&&launcher.value||'',placeholder:launcher&&launcher.placeholder||''},legacy:state('mlsQuickFindOv'),pro:state('mlsFpQf'),native:state('mlsPqsPanel'),quickFindType:typeof window.mlsQuickFind,quickFindWrapped:!!(window.mlsQuickFind&&window.mlsQuickFind.__fpWrap)};
      })()`);
      throw new Error(`Visible Find launcher did not open a usable search surface: ${JSON.stringify(diagnostics)}; ${error.message}`);
    }
    assert.strictEqual(surface.kind, 'find-anything-pro', `Visible Find launcher opened the wrong search owner: ${JSON.stringify(surface)}`);
    await fill(cdp, surface.input, 'Synthetic Reliability');
    const result = await waitFor(cdp, 'the exact synthetic patient Find row', `(() => {
      const rows=[...document.querySelectorAll('#mlsFpQfList .qf-it')];
      const target=rows.filter(el=>(el.innerText||el.textContent||'').replace(/\\s+/g,' ').includes(${JSON.stringify(SYNTHETIC_PATIENT.name)}));
      return target.length===1?{count:target.length,text:(target[0].innerText||target[0].textContent||'').replace(/\\s+/g,' ').trim()}:false;
    })()`, 5000);

    /* Change only the synthetic session epoch after the result was indexed.
       Clicking that stale row must be a fail-closed no-op: overlay retained,
       old chart retained, route retained, and a visible account-change reason. */
    const staleClick = await evaluate(cdp, `(() => {
      const saved=window.__mlsLiveFindOriginalEpoch||{};
      window.__mlsSessionEpoch=Number(saved.value||0)+1;
      const rows=[...document.querySelectorAll('#mlsFpQfList .qf-it')];
      const row=rows.find(el=>(el.innerText||el.textContent||'').includes(${JSON.stringify(SYNTHETIC_PATIENT.name)}));
      if(!row)return {ok:false,reason:'missing-row'};
      row.click();return {ok:true,epoch:window.__mlsSessionEpoch};
    })()`);
    assert(staleClick && staleClick.ok, `Could not click the stale-session Find row: ${JSON.stringify(staleClick)}`);
    const staleBlock = await waitFor(cdp, 'stale-session Find result to fail closed', `(() => {
      const ov=document.getElementById('mlsFpQf'),status=document.getElementById('mlsFpQfStatus');
      const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const text=(status&&status.textContent||'').replace(/\\s+/g,' ').trim();
      if(!shown(ov)||!shown(status)||!/account changed/i.test(text)||getActivePtId()!==${JSON.stringify(decoyId)}||!activePatient()||activePatient().id!==${JSON.stringify(decoyId)}||window.__mlsCurrentView!=='calendar')return false;
      return {overlayVisible:true,status:text,activeId:getActivePtId(),activeName:activePatient().name,view:window.__mlsCurrentView};
    })()`, 5000);

    /* Restore the same session and click the same rendered result. Find must
       select the exact stable ID first, then route, then synchronize every
       clinician-facing patient surface. */
    const selectedClick = await evaluate(cdp, `(() => {
      const saved=window.__mlsLiveFindOriginalEpoch||{};
      if(saved.had)window.__mlsSessionEpoch=saved.value;else delete window.__mlsSessionEpoch;
      const rows=[...document.querySelectorAll('#mlsFpQfList .qf-it')];
      const row=rows.find(el=>(el.innerText||el.textContent||'').includes(${JSON.stringify(SYNTHETIC_PATIENT.name)}));
      if(!row)return {ok:false,reason:'missing-row'};
      row.click();return {ok:true};
    })()`);
    assert(selectedClick && selectedClick.ok, `Could not click the current-session Find row: ${JSON.stringify(selectedClick)}`);
    const selected = await waitFor(cdp, 'Find to select the exact chart before opening Visit', `(() => {
      const targetId=${JSON.stringify(setup.target.id)},targetName=${JSON.stringify(SYNTHETIC_PATIENT.name)},targetDob=${JSON.stringify(SYNTHETIC_PATIENT.dob)};
      const active=activePatient&&activePatient(),value=id=>{const el=document.getElementById(id);return el&&el.value||''};
      const ov=document.getElementById('mlsFpQf'),ovStyle=ov&&getComputedStyle(ov);
      const overlayClosed=!ov||ovStyle.display==='none';
      const bar=(document.getElementById('patientBarInner')&&document.getElementById('patientBarInner').innerText||'').replace(/\\s+/g,' ').trim();
      const state={activeId:getActivePtId(),activePatientId:active&&active.id||'',activeName:active&&active.name||'',view:window.__mlsCurrentView||'',heroName:value('heroPtName'),heroDob:value('heroPtDob'),patientLabel:value('patientLabel'),patientBar:bar,overlayClosed,easyOwners:document.querySelectorAll('#mlsEz3').length,easyWrapOwners:document.querySelectorAll('#ez3Wrap').length};
      return state.activeId===targetId&&state.activePatientId===targetId&&state.activeName===targetName&&state.view==='visit'&&state.heroName===targetName&&state.heroDob===targetDob&&state.patientLabel===targetName&&bar.includes(targetName)&&overlayClosed?state:false;
    })()`, 10000);
    assert.strictEqual(selected.easyOwners, 1, `Find route produced duplicate Easy owners: ${JSON.stringify(selected)}`);
    assert.strictEqual(selected.easyWrapOwners, 1, `Find route produced duplicate Easy workspaces: ${JSON.stringify(selected)}`);
    proof = { available: true, surface, result: result.text.slice(0, 300), staleBlock, selected };
    return proof;
  } catch (error) {
    bodyError = error;
    throw error;
  } finally {
    try {
      const cleanup = await evaluate(cdp, `(() => {
        const hasSaved=Object.prototype.hasOwnProperty.call(window,'__mlsLiveFindOriginalEpoch'),saved=window.__mlsLiveFindOriginalEpoch||{};
        if(hasSaved){if(saved.had)window.__mlsSessionEpoch=saved.value;else delete window.__mlsSessionEpoch;}
        const decoyId=${JSON.stringify(decoyId)};
        const beforeCleanup=getPatients();
        const targets=beforeCleanup.filter(p=>p&&p.name===${JSON.stringify(SYNTHETIC_PATIENT.name)});
        const target=targets.length===1?targets[0]:null;
        /* Restore the real synthetic chart before removing the temporary active
           chart. This keeps the production save verifier meaningful and avoids
           manufacturing a transient "Save not confirmed" warning in the final
           visual artifact. */
        if(target){openPatient(target.id);showView('visit');renderPatientBar();}
        savePatients(beforeCleanup.filter(p=>p&&String(p.id)!==decoyId));
        const note=target&&getNotes().find(n=>n.patientId===target.id&&n.soap===${JSON.stringify(SYNTHETIC_NOTE)});
        if(note&&typeof loadRecordIntoEditor==='function')loadRecordIntoEditor(note);
        const pro=document.getElementById('mlsFpQf');if(pro)pro.style.display='none';
        if(typeof window.mlsQuickFindClose==='function')try{window.mlsQuickFindClose()}catch(_){}
        const launcher=document.getElementById('mlsPqsInput');if(launcher){launcher.value='';launcher.blur();}
        delete window.__mlsLiveFindOriginalEpoch;
        return {patientCount:getPatients().length,targetCount:targets.length,activeId:getActivePtId(),targetId:target&&target.id||'',view:window.__mlsCurrentView||'',noteRestored:!!(note&&document.getElementById('noteBox')&&document.getElementById('noteBox').value===${JSON.stringify(SYNTHETIC_NOTE)})};
      })()`);
      if (proof) {
        assert.strictEqual(cleanup.patientCount, 1, `Find fixture cleanup left a synthetic decoy: ${JSON.stringify(cleanup)}`);
        assert.strictEqual(cleanup.targetCount, 1, `Find fixture cleanup lost or duplicated the target: ${JSON.stringify(cleanup)}`);
        assert.strictEqual(cleanup.activeId, cleanup.targetId, `Find fixture cleanup did not restore the target chart: ${JSON.stringify(cleanup)}`);
        assert.strictEqual(cleanup.view, 'visit', `Find fixture cleanup did not restore Visit: ${JSON.stringify(cleanup)}`);
        assert.strictEqual(cleanup.noteRestored, true, `Find fixture cleanup did not restore the saved synthetic note: ${JSON.stringify(cleanup)}`);
        proof.cleanup = cleanup;
      }
    } catch (cleanupError) {
      if (!bodyError) throw cleanupError;
      bodyError.message += `; Find fixture cleanup also failed: ${cleanupError.message}`;
    }
  }
}

async function diagnoseSearchEngineWithoutLauncher(cdp) {
  const opened = await evaluate(cdp, `(() => {if(typeof window.mlsQuickFind!=='function')return false;window.mlsQuickFind();return true})()`);
  if (!opened) return { available: false };
  const surface = await waitFor(cdp, 'direct Find engine surface', `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    if(shown(document.getElementById('mlsFpQf')))return {input:'#mlsFpQfInput',results:'#mlsFpQfList'};
    if(shown(document.getElementById('mlsQuickFindOv')))return {input:'#mlsQfInput',results:'#mlsQfResults'};
    return false;
  })()`, 5000);
  await fill(cdp, surface.input, 'Synthetic Reliability');
  const found = await waitFor(cdp, 'direct Find engine synthetic result', `(() => {const el=document.querySelector(${JSON.stringify(surface.results)});const text=el&&(el.innerText||el.textContent||'');return /Synthetic Reliability Patient/i.test(text||'')?{text:text.replace(/\\s+/g,' ').trim()}:false})()`, 5000);
  await evaluate(cdp, `(() => {const pro=document.getElementById('mlsFpQf');if(pro)pro.style.display='none';if(typeof window.mlsQuickFindClose==='function')try{window.mlsQuickFindClose()}catch(_){}return true})()`);
  return { available: true, surface, result: found.text.slice(0, 300) };
}

async function inspectRuntime(cdp, timeoutMs) {
  return evaluate(cdp, `(() => ({
    href:location.href,
    demo:typeof _SF_DEMO!=='undefined'&&_SF_DEMO===true,
    backend:typeof backendMode==='function'&&backendMode(),
    build:(window.__MLS_APP_BUILD||window.__MLS_AV||''),
    writeFlow:window.__mlsWriteFlow&&window.__mlsWriteFlow.version,
    redesign:window.__mlsRedesign&&window.__mlsRedesign.version,
    bodyClasses:document.body&&document.body.className,
    noteEditors:['mls-note','noteBox','ez3flNote','ez3Note'].map(id=>{const el=document.getElementById(id);return {id,exists:!!el,length:el&&String(el.value!=null?el.value:el.textContent||'').trim().length}}),
    athenaShortcut:(()=>{const el=document.getElementById('wf2OneClick');if(!el)return {exists:false};const s=getComputedStyle(el),r=el.getBoundingClientRect();return {exists:true,display:s.display,visibility:s.visibility,width:r.width,height:r.height,disabled:el.disabled,ariaHidden:el.getAttribute('aria-hidden')}})(),
    primaryAthenaReview:(()=>{const el=document.getElementById('pushAllEmrBtn');if(!el)return {exists:false};const s=getComputedStyle(el),r=el.getBoundingClientRect();return {exists:true,text:(el.textContent||'').trim(),display:s.display,visibility:s.visibility,width:r.width,height:r.height,disabled:el.disabled}})(),
    visibleReviewButtons:[...document.querySelectorAll('button')].filter(el=>/athena|review/i.test(el.textContent||'')).map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {id:el.id,text:(el.textContent||'').replace(/\\s+/g,' ').trim(),visible:s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0,width:r.width,height:r.height}}).filter(x=>x.visible),
    patientCount:window.getPatients?window.getPatients().length:null,
    noteCount:window.getNotes?window.getNotes().length:null,
    errors:(window.__mlsLiveSmokeErrors||[]).slice()
  }))()`, { userGesture: false, timeoutMs });
}

async function proveLocalSensitiveQr(cdp) {
  const result = await evaluate(cdp, `(() => {
    const old=document.getElementById('mlsLiveQrProbe'); if(old) old.remove();
    const img=document.createElement('img'); img.id='mlsLiveQrProbe'; img.alt='probe';
    document.body.appendChild(img);
    const ok=typeof window.mlsSetLocalQrImage==='function' &&
      window.mlsSetLocalQrImage('mlsLiveQrProbe','otpauth://totp/MLS-LIVE-SYNTHETIC?secret=NOT-A-REAL-SECRET',180);
    const out={ok:!!ok,src:String(img.getAttribute('src')||''),alt:String(img.alt||''),error:img.getAttribute('data-qr-error')||''};
    img.remove();
    return out;
  })()`);
  assert.strictEqual(result.ok, true, `Local sensitive QR rendering failed: ${JSON.stringify(result)}`);
  assert(/^data:image\/png;base64,/.test(result.src), 'Sensitive QR did not render to a local data URL');
  assert.strictEqual(result.error, '', 'Sensitive QR reported a local rendering error');
  return { ok: result.ok, srcKind: 'data:image/png', alt: result.alt };
}

async function proveLocalClinicalLibraries(cdp) {
  /* The production service worker correctly retires /tests/**. Inject the
     synthetic DOCX bytes through CDP so this proof does not race service-worker
     activation and accidentally depend on a non-public test URL. */
  const docxFixtureBase64 = fs.readFileSync(
    path.join(ROOT, 'tests', 'fixtures', 'vendor-boundary-single-paragraph.docx')
  ).toString('base64');
  const result = await evaluate(cdp, `(async () => {
    const proof={};

    const Chart=await loadChartJs();
    const canvas=document.createElement('canvas');
    canvas.width=320; canvas.height=160; canvas.style.cssText='position:fixed;left:-10000px;top:0';
    document.body.appendChild(canvas);
    const chart=new Chart(canvas.getContext('2d'),{
      type:'bar',
      data:{labels:['Synthetic A','Synthetic B'],datasets:[{label:'Synthetic only',data:[1,2]}]},
      options:{responsive:false,animation:false}
    });
    chart.update();
    proof.chart={version:String(Chart.version||''),pixel:Array.from(canvas.getContext('2d').getImageData(0,0,1,1).data)};
    chart.destroy(); canvas.remove();

    const XLSX=await loadSheetJs();
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Synthetic','Value'],['Fixture',1]]),'Synthetic');
    const workbook=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    proof.xlsx={version:String(XLSX.version||''),bytes:workbook.byteLength||workbook.length||0};

    const jspdf=await loadJsPdf();
    const outDoc=new jspdf.jsPDF({unit:'pt',format:'letter'});
    outDoc.text('Synthetic library boundary PDF',54,72);
    const pdfBytes=new Uint8Array(outDoc.output('arraybuffer'));
    proof.jspdf={version:String(jspdf.jsPDF.version||''),bytes:pdfBytes.byteLength};

    const pdfjs=await loadPdfJsOnDemand();
    proof.pdfjsModule=_mlsLocalVendorUrl('pdfjs');
    pdfjs.GlobalWorkerOptions.workerSrc=_mlsLocalVendorUrl('pdfWorker');
    const task=pdfjs.getDocument({data:pdfBytes,isEvalSupported:false});
    const parsed=await task.promise;
    const first=await parsed.getPage(1);
    const text=await first.getTextContent();
    proof.pdfjs={version:String(pdfjs.version||''),pages:parsed.numPages,text:text.items.map(item=>item.str).join(' '),workerSrc:pdfjs.GlobalWorkerOptions.workerSrc};
    await task.destroy();

    const mammoth=await _ensureMammoth();
    const fixtureBytes=Uint8Array.from(atob(${JSON.stringify(docxFixtureBase64)}),ch=>ch.charCodeAt(0));
    const extracted=await mammoth.extractRawText({arrayBuffer:fixtureBytes.buffer});
    proof.mammoth={text:String(extracted&&extracted.value||'').trim(),messages:(extracted&&extracted.messages||[]).length};

    try{ _mlsLocalVendorUrl('not-a-real-library'); proof.unknownKeyRefused=false; }
    catch(e){ proof.unknownKeyRefused=true; }
    proof.scripts=[...document.querySelectorAll('script[data-mls-local-vendor]')].map(script=>({
      key:script.getAttribute('data-mls-local-vendor'),
      src:script.src
    })).sort((a,b)=>a.key.localeCompare(b.key));
    return proof;
  })()`, { awaitPromise: true, userGesture: false, timeoutMs: 70000 });

  assert(/^4\.5\.1(?:$|[-+])/.test(result.chart.version), `Chart.js version/load failed: ${JSON.stringify(result.chart)}`);
  assert.strictEqual(result.xlsx.version, '0.20.3', `SheetJS version drift: ${JSON.stringify(result.xlsx)}`);
  assert(result.xlsx.bytes > 1000, 'SheetJS did not produce an XLSX workbook');
  assert.strictEqual(result.jspdf.version, '4.2.1', `jsPDF version drift: ${JSON.stringify(result.jspdf)}`);
  assert(result.jspdf.bytes > 500, 'jsPDF did not produce a PDF');
  assert.strictEqual(result.pdfjs.version, '6.1.200', `PDF.js version drift: ${JSON.stringify(result.pdfjs)}`);
  assert.strictEqual(result.pdfjs.pages, 1, 'PDF.js did not parse the synthetic PDF');
  assert(result.pdfjs.text.includes('Synthetic library boundary PDF'), `PDF.js text extraction failed: ${JSON.stringify(result.pdfjs)}`);
  assert(/\/vendor\/pdf-6\.1\.200\.min\.mjs\?v=4ba2f15599b03fde$/.test(result.pdfjsModule), 'PDF.js module is not pinned to the local file');
  assert(/\/vendor\/pdf\.worker-6\.1\.200\.min\.mjs\?v=2ab9e09667296dab$/.test(result.pdfjs.workerSrc), 'PDF.js worker is not pinned to the local file');
  assert(result.mammoth.text.length > 0, `Mammoth did not parse the synthetic DOCX fixture: ${JSON.stringify(result.mammoth)}`);
  assert.strictEqual(result.unknownKeyRefused, true, 'local loader did not refuse an unknown asset');
  assert.deepStrictEqual(result.scripts.map(item=>item.key), ['chart','jspdf','mammoth','xlsx'], 'not every classic-script local library was loaded exactly once');
  assert.deepStrictEqual(Object.fromEntries(result.scripts.map(item=>[item.key,new URL(item.src).pathname+new URL(item.src).search])), {
    chart:'/vendor/chart.umd-4.5.1.js?v=ecc3cd1eeb8c34d2',
    jspdf:'/vendor/jspdf.umd-4.2.1.min.js?v=e6551fcdc32f09d6',
    mammoth:'/vendor/mammoth.browser-1.12.0.min.js?v=5d4c0e7c9165d70b',
    xlsx:'/vendor/xlsx.full-0.20.3.min.js?v=cc015130aa8521e7'
  }, 'a classic-script local library did not use its exact pinned file');
  assert(result.scripts.every(item=>new URL(item.src).hostname === '127.0.0.1'), `a library loaded from outside the isolated origin: ${JSON.stringify(result.scripts)}`);
  assert(new URL(result.pdfjsModule).hostname === '127.0.0.1', `PDF.js loaded from outside the isolated origin: ${result.pdfjsModule}`);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const chromePath = findChrome(args.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(ROOT, args.artifacts || path.join('tests', 'live-smoke-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-live-smoke-profile-'));
  const { server, origin } = await startStaticServer();
  const appUrl = `${origin}/ScribeFlow.html?demo=1&liveSmoke=${encodeURIComponent(stamp)}&classic=1&mlseasy=classic&easyone=0`;
  let chrome;
  let cdp;
  let report;
  let review = null;
  let lastAthenaClose = null;
  let restored = null;
  let canonicalUiPolicy = null;
  const cycles = [];
  const phaseFailures = [];
  const externalRequests = [];
  const browserDiagnostics = { console: [], exceptions: [], dialogs: [] };
  const progress = (message) => process.stdout.write(`[live] ${message}\n`);
  try {
    progress('launching isolated Chrome and local no-store server');
    chrome = await launchChrome(chromePath, profileDir, args.headed);
    cdp = await createPage(chrome.port, 'about:blank');
    const dialogEvidence = { events: browserDiagnostics.dialogs, mayHandleCleanBeforeUnload: false };
    cdp.__mlsDialogEvidence = dialogEvidence;
    cdp.on('Page.javascriptDialogOpening', (event) => {
      const record = { phase: 'open', type: event.type, message: event.message || '', url: event.url || '', hasBrowserHandler: !!event.hasBrowserHandler, defaultPrompt: event.defaultPrompt || '' };
      dialogEvidence.events.push(record);
      if (event.type === 'beforeunload' && dialogEvidence.mayHandleCleanBeforeUnload) {
        record.handledAfterCleanAssertion = true;
        cdp.send('Page.handleJavaScriptDialog', { accept: true }, 5000).catch((error) => { record.handleError = error.message; });
      }
    });
    cdp.on('Page.javascriptDialogClosed', (event) => {
      dialogEvidence.events.push({ phase: 'closed', result: !!event.result, userInput: event.userInput || '' });
    });
    cdp.on('Runtime.consoleAPICalled', (event) => {
      const args = (event.args || []).map((arg) => String(arg.value != null ? arg.value : (arg.description || arg.type || ''))).join(' ');
      const frames = event.stackTrace && event.stackTrace.callFrames || [];
      browserDiagnostics.console.push({ type: event.type, text: args.slice(0, 2000), frames: frames.slice(0, 8) });
      if (browserDiagnostics.console.length > 100) browserDiagnostics.console.shift();
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      const detail = event.exceptionDetails || {};
      browserDiagnostics.exceptions.push({
        text: String(detail.text || ''),
        description: String(detail.exception && detail.exception.description || ''),
        lineNumber: detail.lineNumber,
        columnNumber: detail.columnNumber,
        url: detail.url || '',
        frames: (detail.stackTrace && detail.stackTrace.callFrames || []).slice(0, 12)
      });
      if (browserDiagnostics.exceptions.length > 100) browserDiagnostics.exceptions.shift();
    });
    cdp.on('Network.requestWillBeSent', (event) => {
      try {
        const url = new URL(event.request.url);
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
          externalRequests.push({ url: url.href, method: event.request.method, type: event.type });
        }
      } catch (_) {}
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__mlsLiveSmokeErrors=[];
        window.__mlsLiveSmokeLongTasks=[];
        addEventListener('error',event=>window.__mlsLiveSmokeErrors.push({type:'error',message:String(event.message||''),source:String(event.filename||''),line:event.lineno||0}));
        addEventListener('unhandledrejection',event=>window.__mlsLiveSmokeErrors.push({type:'unhandledrejection',message:String(event.reason&&event.reason.stack||event.reason||'')}));
        try{new PerformanceObserver(list=>list.getEntries().forEach(entry=>window.__mlsLiveSmokeLongTasks.push({name:entry.name,startTime:entry.startTime,duration:entry.duration}))).observe({entryTypes:['longtask']});}catch(_){}
      })();`
    });
    await cdp.send('Page.navigate', { url: appUrl });
    await waitFor(cdp, 'initial local-demo auth screen', `document.readyState==='complete' && !!document.getElementById('authScreen')`, 30000);
    await evaluate(cdp, `localStorage.clear();sessionStorage.clear();localStorage.setItem('mls.easyV2.enabled','0');localStorage.setItem('mls.easyOne.enabled','0');location.href=${JSON.stringify(appUrl)};true`);
    await waitFor(cdp, 'clean local-demo auth screen', `document.readyState==='complete' && !!document.getElementById('tabSignup')`, 30000);
    await click(cdp, '#tabSignup');
    const signupCeremony = await waitFor(cdp, 'loopback synthetic signup manifest', `(() => {
      const fields=document.getElementById('authSignupAssentFields');
      const terms=document.getElementById('authTermsAssent'),authority=document.getElementById('authPracticeAuthority');
      const termsLink=document.getElementById('authTermsLink'),privacyLink=document.getElementById('authPrivacyLink');
      if(!fields||fields.disabled||!terms||!authority||!termsLink||!privacyLink||!termsLink.href||!privacyLink.href)return false;
      return {
        fieldsEnabled:true,termsInitiallyChecked:terms.checked,authorityInitiallyChecked:authority.checked,
        termsUrl:termsLink.href,privacyUrl:privacyLink.href,
        syntheticOnly:/synthetic-evaluation/i.test((document.getElementById('authSignupDocs')||{}).textContent||'')||
          /server-approved documents/i.test((document.getElementById('authSignupDocs')||{}).textContent||'')
      };
    })()`, 10000);
    assert.strictEqual(signupCeremony.termsInitiallyChecked, false, 'synthetic Terms assent was pre-checked');
    assert.strictEqual(signupCeremony.authorityInitiallyChecked, false, 'synthetic practice-authority assent was pre-checked');
    assert.strictEqual(new URL(signupCeremony.termsUrl).hostname, '127.0.0.1', 'synthetic Terms fixture escaped the isolated origin');
    assert.strictEqual(new URL(signupCeremony.privacyUrl).hostname, '127.0.0.1', 'synthetic Privacy fixture escaped the isolated origin');
    await fill(cdp, '#authEmail', SYNTHETIC_EMAIL);
    await fill(cdp, '#authPass', SYNTHETIC_PASSWORD);
    await fill(cdp, '#authPass2', SYNTHETIC_PASSWORD);
    await click(cdp, '#authTermsAssent');
    await click(cdp, '#authPracticeAuthority');
    await waitFor(cdp, 'explicit synthetic signup confirmations', `document.getElementById('authTermsAssent').checked&&document.getElementById('authPracticeAuthority').checked&&!document.getElementById('authBtn').disabled`);
    await click(cdp, '#authBtn');
    await waitFor(cdp, 'synthetic local account login', `document.getElementById('appScreen') && getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 30000);
    await settleUi(cdp);
    progress('synthetic local signup/login settled');
    canonicalUiPolicy = await inspectCanonicalUiRuntime(cdp);
    progress('canonical Easy owner resisted URL, storage, console, and delayed-owner rollback tampering');
    const runtime = await inspectRuntime(cdp);
    assert.strictEqual(runtime.demo, true, 'Live smoke did not enter explicit ?demo=1 mode');
    assert.strictEqual(runtime.backend, false, 'Live smoke unexpectedly enabled the production backend');
    const localQr = await proveLocalSensitiveQr(cdp);
    const localClinicalLibraries = await proveLocalClinicalLibraries(cdp);
    progress('same-origin Chart/XLSX/PDF/DOCX libraries executed with the local PDF worker');
    await screenshot(cdp, path.join(artifactDir, '01-login-calm.png'));

    const noPatient = await proveNoPatientGuard(cdp);
    const prePatientCalm = await assertCalmBaseline(cdp, 'before patient selection');
    assert.strictEqual(prePatientCalm.counts.athenaOneClick.visible, 0, 'Athena review control visible before patient/note context');
    assert.strictEqual(prePatientCalm.counts.patientBar.visible, 0, 'Empty patient bar visible without an active patient');
    const firstStability = await sampleStability(cdp, 'first settled login');
    progress('no-patient guard and calm baseline passed');
    const crossDayVisit = await proveCrossDayNativeWorkspace(
      cdp,
      path.join(artifactDir, '01a-visit-today-native.png'),
      path.join(artifactDir, '01b-visit-next-day-native.png')
    );
    progress('past/tomorrow, month/year/leap/DST boundaries, midnight rollover, and account-local Staff ranges reused one native Easy workspace and fixed date-strip topology; Staff Prep stayed Menu-owned');
    const accountBoundary = await proveLiveSameTabAccountBoundary(cdp);
    progress('same-tab Account A to B boundary synchronously cleared clinical UI ownership and rejected a delayed Account A calendar response');
    const patient = await createSyntheticPatient(cdp);
    progress('synthetic patient created and selected');
    const note = await enterAndSaveSyntheticNote(cdp);
    progress('synthetic transcript/note saved through live editor');
    await screenshot(cdp, path.join(artifactDir, '02-synthetic-note.png'));
    try {
      restored = await reloadAndReopenSavedNote(cdp, note.noteId);
      progress('hard reload, History persistence, and reopen passed');
      await screenshot(cdp, path.join(artifactDir, '03-reload-restored-note.png'));
    } catch (error) {
      phaseFailures.push({ phase: 'reload-history-reopen', error: error.stack || String(error) });
      progress(`recorded History/reopen failure and continuing remaining independent checks: ${error.message}`);
      try { await screenshot(cdp, path.join(artifactDir, '03-FAIL-history-reopen.png')); } catch (_) {}
      await recoverSyntheticEditorForRemainingChecks(cdp, note.noteId);
    }

    for (let run = 1; run <= args.runs; run++) {
      progress(`starting stability cycle ${run}/${args.runs}`);
      const started = Date.now();
      if (run > 1) {
        await hardReload(cdp);
        await waitFor(cdp, `cycle ${run} restored session`, `document.readyState==='complete' && document.getElementById('appScreen') && getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 30000);
        await settleUi(cdp);
        await evaluate(cdp, `(() => {const n=getNotes().find(n=>n.id===${JSON.stringify(note.noteId)});if(!n)return false;if(n.patientId&&findPatient(n.patientId))setActivePtId(n.patientId);showView('visit');loadRecordIntoEditor(n);renderPatientBar();return true})()`);
        await waitFor(cdp, `cycle ${run} reopened editor`, `document.getElementById('noteBox').value===${JSON.stringify(SYNTHETIC_NOTE)}`);
      }
      const navigation = await navigateVisibleRoutes(cdp);
      const heldWorkspaces = await proveHeldWorkspacesAbsent(cdp);
      await evaluate(cdp, `showView('visit');true`);
      const staffPrep = await exerciseStaffPrepMenu(cdp, run === 1 ? path.join(artifactDir, '04-staff-prep-menu.png') : '');
      let search;
      try {
        search = await exerciseSearch(cdp);
      } catch (error) {
        phaseFailures.push({ phase: `cycle-${run}-find`, error: error.stack || String(error) });
        let directEngine = null;
        try { directEngine = await diagnoseSearchEngineWithoutLauncher(cdp); } catch (diagnosticError) { directEngine = { error: diagnosticError.message }; }
        search = { available: true, error: error.message, directEngine };
        progress(`cycle ${run}: recorded Find failure and continuing independent review checks: ${error.message}`);
        try { await screenshot(cdp, path.join(artifactDir, `cycle-${run}-FAIL-find.png`)); } catch (_) {}
        await evaluate(cdp, `(() => {const ids=['mlsFpQf','mlsQuickFindOv'];ids.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none'});const input=document.getElementById('mlsPqsInput');if(input){input.value='';input.blur()}return true})()`);
      }
      const calm = await assertCalmBaseline(cdp, `cycle ${run}`);
      const stability = await sampleStability(cdp, `cycle ${run}`);
      review = await openAndInspectAthenaReview(cdp);
      if (run === 1) await screenshot(cdp, path.join(artifactDir, '05-athena-review-read-only.png'));
      lastAthenaClose = await closeAthenaReview(cdp);
      progress(`cycle ${run}: Athena review manifest and close responsiveness passed`);
      const state = await inspectRuntime(cdp);
      assert.strictEqual(state.patientCount, 1, `cycle ${run}: synthetic patient duplicated or disappeared`);
      assert.strictEqual(state.noteCount, 1, `cycle ${run}: synthetic note duplicated or disappeared`);
      assert.deepStrictEqual(state.errors, [], `cycle ${run}: uncaught browser errors occurred`);
      cycles.push({ run, elapsedMs: Date.now() - started, navigation, heldWorkspaces, staffPrep, search, calm, stability, state });
      progress(`completed stability cycle ${run}/${args.runs}`);
    }
    const finalVisualSanity = await waitFor(cdp, 'all transient messages to clear before the final visual proof', `(() => {
      const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0.01&&r.width>0&&r.height>0};
      const text=el=>(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();
      const transients=[...document.querySelectorAll('#toast,#ez3Toast,[id$="Toast"],[role="alert"],.mls-sv-card')]
        .filter(el=>shown(el)&&text(el))
        .map(el=>({id:el.id||'',text:text(el).slice(0,240)}));
      const findOverlays=['mlsFpQf','mlsQuickFindOv'].map(id=>document.getElementById(id)).filter(shown).map(el=>el.id);
      return transients.length===0&&findOverlays.length===0?{visibleTransientCount:0,visibleFindOverlays:[]}:false;
    })()`, 10000);
    await screenshot(cdp, path.join(artifactDir, '06-final-stable.png'));
    const unsafeExternalRequests = externalRequests.filter((request) => {
      try {
        const url = new URL(request.url);
        const staticFontGet = request.method === 'GET' && (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com');
        return !staticFontGet;
      } catch (_) {
        return true;
      }
    });
    assert.deepStrictEqual(unsafeExternalRequests, [], `Local synthetic proof attempted an unapproved external request: ${JSON.stringify(unsafeExternalRequests)}`);
    if (phaseFailures.length) {
      throw new Error(`Live synthetic Chrome smoke recorded ${phaseFailures.length} failed phase(s): ${JSON.stringify(phaseFailures)}`);
    }
    report = {
      status: 'PASS',
      generatedAt: new Date().toISOString(),
      syntheticOnly: true,
      appUrl,
      chromePath,
      chromeVersion: await evaluate(cdp, `navigator.userAgent`),
      runs: args.runs,
      runtime,
      canonicalUiPolicy,
      signupCeremony,
      localQr,
      localClinicalLibraries,
      noPatient,
      patient: { id: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn },
      savedNoteId: note.noteId,
      review: {
        rowIds: review.rows.map((row) => row.id),
        selectableRows: review.radioRows,
        advancedContainment: review.advancedContainment,
        beforeOpen: review.beforeOpen,
        whileOpen: { emrPanel: review.emrPanel, athenaReceipt: review.athenaReceipt },
        afterClose: lastAthenaClose
      },
      reloadProof: restored,
      externalRequests,
      browserDiagnostics,
      unsafeExternalRequests,
      firstStability,
      finalVisualSanity,
      crossDayVisit,
      accountBoundary,
      cycles,
      phaseFailures,
      coverageBoundary: {
        liveAutomated: [
          'local demo signup/login', 'session reload', 'all visible top-level route navigation',
           'same-origin Chart.js/SheetJS/jsPDF/PDF.js-worker/Mammoth execution',
          'held Legal/Team/Supervision/payment/public-expert controls and scripts remain absent',
          'past/tomorrow, month/year/leap/DST boundaries, and midnight rollover reuse the identical native Easy workspace and fixed date-strip topology with isolated appointment/action state',
          'account-local Staff Today/Tomorrow/month filters and month input default/max remain correct when the computer is on a different calendar date/month',
          'same-tab Account A to B adoption before synchronous reset listeners, with calendar/provider/date/filter/Easy/DaySwitch/visit-binding clearing and delayed Account A response rejection',
          'Account B-local Today rendering with no record, generation, Athena action, or network write during the account boundary',
          'single Menu-owned Staff prep entry and visible day/month schedule controls',
          'canonical-only Easy owner under URL/storage/console/delayed-owner tampering',
          'synchronous Menu → Staff → Back mode events with all-visible-control and no-co-render timeline scans',
          'no-patient Athena guard', 'synthetic patient creation/selection', 'transcript entry',
          'generated-note editor save/reopen', 'history persistence', 'Athena review manifest rendering',
          'final-action rows remain manual', 'duplicate/competing overlay absence', 'repeated stability sampling'
        ],
        notClaimed: [
          'real Athena chart read/write', 'Athena Preview OAuth/FHIR/proprietary API',
          'extension service-worker lifecycle in a packaged Chrome profile', 'real microphone transcription',
          'hosted backend/2FA/compliance/production deployment'
        ]
      }
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`PASS live synthetic Chrome smoke: ${args.runs}/${args.runs} cycles\n`);
    process.stdout.write(`Artifacts: ${artifactDir}\n`);
  } catch (error) {
    if (cdp) {
      try { await screenshot(cdp, path.join(artifactDir, 'FAIL.png'), 5000); } catch (_) {}
      let state = null;
      try { state = await inspectRuntime(cdp, 5000); } catch (_) {}
      report = {
        status: 'FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true,
        error: error.stack || String(error), state, externalRequests, browserDiagnostics,
        phaseFailures, reloadProof: restored, cycles,
        athenaReviewDiagnostics: review && {
          beforeOpen: review.beforeOpen,
          whileOpen: { emrPanel: review.emrPanel, athenaReceipt: review.athenaReceipt },
          afterClose: lastAthenaClose
        }
      };
      try { fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); } catch (_) {}
    }
    error.message += `\nArtifacts: ${artifactDir}`;
    throw error;
  } finally {
    if (cdp) cdp.close();
    if (chrome && chrome.child) {
      try { chrome.child.kill(); } catch (_) {}
    }
    /* Chrome keeps HTTP/1.1 asset sockets alive. Stop the browser before
       awaiting server.close(), then explicitly drain any remaining sockets so
       a successful proof cannot hang forever during teardown. */
    try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch (_) {}
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
