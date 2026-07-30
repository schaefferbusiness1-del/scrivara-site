'use strict';

/*
 * live-draft-a-day.js — a real-Chrome, real-DOM proof that DRAFT ALL finishes
 * a whole synthetic procedure day and TELLS THE TRUTH about it.
 *
 * Shape copied from tests/live-synthetic-smoke.js: dependency-free, launches an
 * isolated Chrome against a local no-store server, drives the app over CDP,
 * never opens mlsscribe.com or athenanet, and uses ONLY obviously-synthetic
 * patients, templates and notes.
 *
 * THE ONE THING A LOCAL HARNESS CANNOT DO is call the real model. Generation
 * goes through window.aiCallRaw -> fetch. So a deterministic stub is installed
 * with Page.addScriptToEvaluateOnNewDocument BEFORE the app boots, underneath
 * every app-side fetch wrapper. The stub:
 *   - answers both transports (hosted {system,user} -> /api/complete and the
 *     per-device OpenAI chat/completions envelope) with the same app-level
 *     contract: a JSON string {"note":"...","missing":[...]};
 *   - ECHOES THE SELECTED TEMPLATE BACK, headings and fixed wording intact,
 *     filling only the genuinely case-variable [[slots]] with obviously
 *     synthetic values and deliberately leaving one slot open;
 *   - records every request so the SYSTEM PROMPT the app actually sent can be
 *     asserted on;
 *   - can be told to fail for specific patients (HTTP 500, or malformed JSON).
 * Template-following is therefore MEASURABLE without a model: if the app
 * mangles headings, drops fixed wording, or fails to fill slots, the product's
 * own fidelity gate refuses the draft and this test sees it.
 *
 * WHAT IT DRIVES: the LIVE Draft-all runner — the capture-phase click
 * interceptor on #opPrepGenAllBtn installed by mls-connect.js (__mlsTplPrepFix).
 * The inline onclick=opPrepGenerateAll() and the copy in
 * feat_mls_opnote_integrity.js are NOT the live path; this test dispatches a
 * TRUSTED CDP mouse click on the real button node, so whichever owner is
 * actually wired is the one under test.
 *
 * Usage:
 *   node tests/live-draft-a-day.js
 *   node tests/live-draft-a-day.js --headed --keep-artifacts
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ *
 * SYNTHETIC FIXTURES — nothing here resembles a real person.
 * ------------------------------------------------------------------ */
const SYNTHETIC_EMAIL = 'clinician.draft-a-day@mls.local';
const SYNTHETIC_PASSWORD = 'SyntheticOnly2026!';
const SYNTH_PROVIDER = 'Dr Synthetic Testprovider';
const SYNTH_FACILITY = 'Synthetic Test Procedure Suite';

/* Every row is a lumbar medial-branch block so ONE uploaded template can
   auto-match all of them (the auto-picker requirement in the brief), while
   side/levels vary per row so the product's per-row clinical-consistency gate
   actually has something to check. */
const PROC_VARIANTS = [
  'Bilateral L4-L5 lumbar medial branch block',
  'Left L3-L4 lumbar medial branch block',
  'Right L4-L5 lumbar medial branch block',
  'Bilateral L3-L4 lumbar medial branch block',
  'Left L4-L5 lumbar medial branch block',
  'Right L3-L4 lumbar medial branch block',
  'Bilateral L2-L3 lumbar medial branch block'
];

const GREEK = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf',
  'Hotel', 'India', 'Juliett', 'Kilo', 'Lima', 'Mike'
];

function buildDay(tag, count, dayKey) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const word = GREEK[i % GREEK.length];
    const n = String(i + 1).padStart(2, '0');
    rows.push({
      id: `syn-${tag}-${n}`,
      name: `Synthetic ${word}${tag === 'b' ? 'two' : 'one'} Testpatient`,
      dob: `19${60 + (i % 30)}-0${1 + (i % 9)}-1${i % 9}`,
      mrn: `SYN-${tag.toUpperCase()}-${n}`,
      sex: i % 2 ? 'Male' : 'Female',
      reason: PROC_VARIANTS[i % PROC_VARIANTS.length],
      dayKey,
      time: `${String(7 + i).padStart(2, '0')}:30`
    });
  }
  return rows;
}

/* An "uploaded" operative-note template. Deliberately ordinary in shape:
   real headings, real fixed boilerplate, and three [[slots]]. */
const SYNTH_TEMPLATE_NAME = 'SYNTHETIC TEST TEMPLATE - Lumbar Medial Branch Block';
const SYNTH_TEMPLATE_TEXT = [
  'OPERATIVE / PROCEDURE NOTE (SYNTHETIC TEST TEMPLATE - NOT A REAL PATIENT DOCUMENT)',
  '',
  'PATIENT:',
  'DATE OF PROCEDURE:',
  'PROVIDER:',
  'FACILITY:',
  '',
  'PRE-OPERATIVE DIAGNOSIS:',
  'POST-OPERATIVE DIAGNOSIS: Same.',
  '',
  'PROCEDURE:',
  '',
  'ANESTHESIA: Local anesthesia with one percent lidocaine infiltrated at each skin entry site.',
  '',
  'INDICATIONS: This synthetic test patient has ongoing axial low back pain that has failed a documented course of conservative care including activity modification, a supervised therapy program and oral analgesic medication.',
  '',
  'HISTORY:',
  '',
  'CONSENT: Informed consent was obtained after risks, benefits and alternatives were discussed in detail, and the patient verbalized understanding and agreed to proceed.',
  '',
  'TIME-OUT: A formal time-out was performed confirming patient identity, the planned procedure, the operative site and the laterality before any needle was placed.',
  '',
  'TECHNIQUE: The patient was positioned prone on the procedure table and the operative field was prepared and draped in the usual sterile fashion. Under intermittent fluoroscopic guidance a [[needle_size]] spinal needle was advanced to the target bony landmark at each planned level. Needle position was confirmed in both anteroposterior and lateral projections before any injection was made. After negative aspiration for blood and cerebrospinal fluid, [[injectate_per_level]] was deposited at each target. The needles were then removed intact and a sterile dressing was applied to each site.',
  '',
  'FLUOROSCOPY TIME: [[fluoroscopy_time]]',
  '',
  'ESTIMATED BLOOD LOSS: Minimal.',
  '',
  'COMPLICATIONS: None.',
  '',
  'DISPOSITION: The patient tolerated the procedure well and was transported to the recovery area in stable condition with continued monitoring of vital signs and neurologic status.',
  '',
  'POST-PROCEDURE PLAN: The patient will keep a pain diary for the next twenty-four hours and return to clinic for reassessment as already scheduled. Return precautions for fever, new weakness or a severe positional headache were reviewed in detail before discharge.'
].join('\n');

const SYNTH_TEMPLATE_KEYWORDS = [
  'medial branch block', 'mbb', 'lumbar', 'facet', 'medial branch',
  'diagnostic block', 'lumbar medial branch'
];

/* The [[slots]] the stub fills, and the one it deliberately leaves open so the
   "N blanks to fill" path is exercised end to end. */
const STUB_FILLS = {
  needle_size: '22g 3.5in SYNTHETIC-FIXTURE',
  injectate_per_level: '0.5 mL of SYNTHETIC-FIXTURE test injectate'
};
const STUB_LEAVES_OPEN = ['fluoroscopy_time'];

/* ------------------------------------------------------------------ *
 * The deterministic AI stub, installed before the app boots.
 * ------------------------------------------------------------------ */
const AI_STUB_SOURCE = `(() => {
  if (window.__mlsAiStub) return;
  var FILLS = ${JSON.stringify(STUB_FILLS)};
  var LEAVE_OPEN = ${JSON.stringify(STUB_LEAVES_OPEN)};
  var stub = {
    requests: [],
    failByPatient: {},
    latencyMs: 20,
    externalHits: [],
    reset: function () { stub.requests.length = 0; stub.externalHits.length = 0; },
    setFailures: function (map) { stub.failByPatient = map || {}; }
  };
  window.__mlsAiStub = stub;

  var MARKERS = [
    'SELECTED TEMPLATE \\u2014 COPY ITS STRUCTURE AND FIXED WORDING:',
    'SELECTED TEMPLATE:',
    'TEMPLATE (the doctor\\u2019s own prior op note \\u2014 match its structure & style exactly):',
    'DRAFT TO REPAIR:'
  ];
  function S(x) { return x == null ? '' : String(x); }
  /* The repair prompt embeds the TEMPLATE (whose own "PATIENT: [[patient]]"
     line comes first) and the draft, then the real context last. Reading the
     first match would target a placeholder and silently exempt every repair
     round from the injected failure — so read from the context block when it
     is present, and never accept a placeholder as an identity. */
  function lineField(user, label) {
    var u = S(user), at = u.indexOf('ORIGINAL PATIENT/PROCEDURE CONTEXT:');
    var scopes = at >= 0 ? [u.slice(at), u] : [u];
    var rx = new RegExp('^' + label + ':[ \\\\t]*(.*)$', 'gm');
    for (var s = 0; s < scopes.length; s++) {
      rx.lastIndex = 0;
      var m, best = '';
      while ((m = rx.exec(scopes[s]))) {
        var v = String(m[1] || '').trim();
        if (!v || /^\\[\\[.*\\]\\]$/.test(v) || /^\\[.*\\]$/.test(v)) continue;
        best = v; break;
      }
      if (best) return best;
    }
    return '';
  }
  function templateOf(user) {
    var u = S(user);
    /* the repair prompt puts "SELECTED TEMPLATE:" first, then the draft — take
       the template and stop at the next marker so a repair round still echoes
       the TEMPLATE, exactly as a co-operating model would. */
    for (var i = 0; i < MARKERS.length; i++) {
      var at = u.indexOf(MARKERS[i]);
      if (at < 0) continue;
      var rest = u.slice(at + MARKERS[i].length).replace(/^\\r?\\n/, '');
      for (var j = 0; j < MARKERS.length; j++) {
        if (j === i) continue;
        var stop = rest.indexOf(MARKERS[j]);
        if (stop > 0) rest = rest.slice(0, stop);
      }
      var ctxStop = rest.indexOf('ORIGINAL PATIENT/PROCEDURE CONTEXT:');
      if (ctxStop > 0) rest = rest.slice(0, ctxStop);
      return rest.replace(/\\s+$/, '');
    }
    return '';
  }
  function echoTemplate(tpl) {
    var missing = [], seen = {};
    var note = S(tpl).replace(/\\[\\[\\s*([a-z0-9_]+)\\s*\\]\\]/gi, function (whole, key) {
      var k = String(key).toLowerCase();
      if (LEAVE_OPEN.indexOf(k) >= 0) {
        if (!seen[k]) { seen[k] = 1; missing.push({ key: k, label: 'Fluoroscopy time', example: '1.2 minutes' }); }
        return whole;
      }
      if (Object.prototype.hasOwnProperty.call(FILLS, k)) return FILLS[k];
      /* every other slot belongs to the app's own deterministic fillers
         (identity, date, procedure, chart history) — leave it exactly as
         found so those fillers, not the model, own it. */
      return whole;
    });
    return { note: note, missing: missing };
  }

  function bodyOf(init, input) {
    try {
      if (init && typeof init.body === 'string') return init.body;
      if (input && typeof input === 'object' && typeof input.body === 'string') return input.body;
    } catch (e) {}
    return '';
  }
  function promptsOf(raw) {
    var o = null;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    if (typeof o.system === 'string') return { sys: o.system, user: S(o.user), transport: 'api-complete' };
    if (Array.isArray(o.messages)) {
      var sys = '', user = '';
      o.messages.forEach(function (m) {
        if (!m) return;
        if (m.role === 'system') sys += S(m.content);
        else if (m.role === 'user') user += S(m.content);
      });
      return { sys: sys, user: user, transport: 'openai-chat' };
    }
    if (typeof o.transcript === 'string') return { sys: '', user: o.transcript, transport: 'api-generate' };
    return null;
  }

  var real = window.fetch.bind(window);
  function isAiUrl(url) {
    return /\\/api\\/complete(?:[?#]|$)/.test(url)
      || /\\/api\\/generate(?:[?#]|$)/.test(url)
      || /api\\.openai\\.com\\/v1\\/chat\\/completions/.test(url);
  }
  function reply(transport, text, status) {
    var body;
    if (transport === 'openai-chat') body = JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] });
    else if (transport === 'api-generate') body = JSON.stringify({ result: text });
    else body = JSON.stringify({ content: text });
    return new Response(body, { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }

  window.fetch = function (input, init) {
    var url = '';
    try { url = (typeof input === 'string') ? input : S(input && input.url); } catch (e) {}
    if (!isAiUrl(url)) {
      try {
        var u = new URL(url, location.href);
        if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '127.0.0.1') {
          stub.externalHits.push({ url: u.href, at: Date.now() });
        }
      } catch (e2) {}
      return real(input, init);
    }
    var raw = bodyOf(init, input);
    var p = promptsOf(raw) || { sys: '', user: '', transport: 'unknown' };
    var patient = lineField(p.user, 'PATIENT');
    var procedure = lineField(p.user, 'PROCEDURE');
    var tpl = templateOf(p.user);
    var phase = /DRAFT TO REPAIR:/.test(p.user) ? 'repair' : 'initial';
    var mode = stub.failByPatient[patient] || 'ok';
    var record = {
      n: stub.requests.length + 1, url: url, transport: p.transport, phase: phase,
      patient: patient, procedure: procedure,
      sys: p.sys, sysChars: p.sys.length, userChars: p.user.length,
      templateChars: tpl.length, mode: mode, at: Date.now()
    };
    stub.requests.push(record);
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (mode === 'http500') {
          record.answered = 'http500';
          resolve(new Response('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } }));
          return;
        }
        if (mode === 'malformed') {
          record.answered = 'malformed';
          resolve(reply(p.transport, 'SYNTHETIC MALFORMED REPLY {"note": "unterminated', 200));
          return;
        }
        if (mode === 'wrongprocedure') {
          /* a well-formed reply that documents the WRONG procedure — the
             failure mode that actually matters clinically. */
          var bad = echoTemplate(tpl);
          bad.note = bad.note.replace(/^PROCEDURE:.*$/m, 'PROCEDURE: Left C5-C6 cervical interlaminar epidural steroid injection (SYNTHETIC WRONG-PROCEDURE FIXTURE)');
          record.answered = 'wrongprocedure';
          resolve(reply(p.transport, JSON.stringify(bad), 200));
          return;
        }
        var out = echoTemplate(tpl);
        record.answered = 'echo';
        record.noteChars = out.note.length;
        record.missingKeys = out.missing.map(function (m) { return m.key; });
        resolve(reply(p.transport, JSON.stringify(out), 200));
      }, stub.latencyMs);
    });
  };
  window.fetch.__mlsAiStub = true;
})();`;

/* ------------------------------------------------------------------ *
 * Harness plumbing — same shape as live-synthetic-smoke.js
 * ------------------------------------------------------------------ */
function parseArgs(argv) {
  const out = { headed: false, chrome: '', artifacts: '' };
  for (const arg of argv) {
    if (arg === '--headed') out.headed = true;
    else if (arg.startsWith('--chrome=')) out.chrome = arg.slice(9);
    else if (arg.startsWith('--artifacts=')) out.artifacts = arg.slice(12);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
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
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Google Chrome/Chromium was not found. Pass --chrome=PATH.');
  return found;
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4'
  })[ext] || 'application/octet-stream';
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/ScribeFlow.html' : url.pathname);
      const target = path.resolve(ROOT, `.${pathname}`);
      if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403).end('Forbidden'); return; }
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': mimeType(target), 'Cache-Control': 'no-store, max-age=0' });
      fs.createReadStream(target).pipe(res);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (fs.existsSync(file)) return; await sleep(50); }
  throw new Error(`Timed out waiting for ${file}`);
}

async function readTextWhenUnlocked(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) { lastError = error; await sleep(50); }
  }
  throw lastError || new Error(`Timed out reading ${file}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket; this.nextId = 1; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        return;
      }
      for (const handler of (this.listeners.get(message.method) || [])) handler(message.params || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Chrome DevTools connection closed')); }
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
    const list = this.listeners.get(method) || []; list.push(handler); this.listeners.set(method, list);
  }
  send(method, params = {}, timeoutMs = 70000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id); reject(new Error(`${method}: Chrome DevTools response timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function launchChrome(chromePath, profileDir, headed) {
  const args = [
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-domain-reliability',
    '--disable-features=MediaRouter,OptimizationHints,Translate,AutofillServerCommunication',
    '--disable-sync', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
    '--window-size=1440,1000', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
  ];
  if (!headed) args.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') args.unshift('--no-sandbox');
  const child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  try { await waitForFile(portFile, 20000); }
  catch (error) { try { child.kill(); } catch (_) {} throw new Error(`${error.message}\nChrome stderr:\n${stderr.slice(-4000)}`); }
  const portText = await readTextWhenUnlocked(portFile, 5000);
  const [port] = portText.trim().split(/\r?\n/);
  return { child, port: Number(port) };
}

async function createPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome target creation failed: HTTP ${response.status}`);
  const target = await response.json();
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
  return cdp;
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: !!options.awaitPromise, returnByValue: true,
    userGesture: options.userGesture !== false
  }, options.timeoutMs);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || `Evaluation failed: ${expression.slice(0, 160)}`);
  }
  return result.result ? result.result.value : undefined;
}

async function waitFor(cdp, description, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression, { userGesture: false, timeoutMs: Math.max(250, Math.min(5000, deadline - Date.now())) });
      if (last) return last;
    } catch (error) { last = error.message; }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

async function click(cdp, selector) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok:false, reason:'missing' };
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (s.display==='none' || s.visibility==='hidden' || r.width<1 || r.height<1) return { ok:false, reason:'not-visible' };
    el.scrollIntoView({ block:'center', inline:'center' }); el.focus({ preventScroll:true }); el.click();
    return { ok:true };
  })()`);
  assert(result && result.ok, `Could not click ${selector}: ${JSON.stringify(result)}`);
}

async function fill(cdp, selector, value) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok:false, reason:'missing' };
    el.focus({ preventScroll:true });
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true, value: el.value };
  })()`);
  assert(result && result.ok && result.value === value, `Could not fill ${selector}: ${JSON.stringify(result)}`);
}

async function screenshot(cdp, file, timeoutMs = 20000) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, timeoutMs);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  } catch (_) {}
}

/* A TRUSTED click on the real node: hit-test first (FOCUSED is not CLICKABLE),
   then dispatch through the Input domain so capture-phase interceptors and any
   isTrusted gate both see a genuine user click. */
async function trustedClick(cdp, selector) {
  const target = await evaluate(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok:false, reason:'missing' };
    el.scrollIntoView({ block:'center', inline:'center' });
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (s.display==='none' || s.visibility==='hidden' || Number(s.opacity||1)<0.05 || r.width<2 || r.height<2) {
      return { ok:false, reason:'not-visible', display:s.display, visibility:s.visibility, opacity:s.opacity, w:r.width, h:r.height };
    }
    const x = Math.round(r.left + r.width/2), y = Math.round(r.top + r.height/2);
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { ok:false, reason:'off-screen', x, y, vw:innerWidth, vh:innerHeight };
    const hit = document.elementFromPoint(x, y);
    const reachable = !!(hit && (hit === el || el.contains(hit) || (hit.contains && hit.contains(el))));
    return { ok: reachable, reason: reachable ? '' : 'occluded', x, y,
             hitId: hit ? (hit.id || hit.tagName) : null, rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
             label:(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80), disabled: !!el.disabled };
  })()`);
  assert(target && target.ok, `The real ${selector} was not clickable: ${JSON.stringify(target)}`);
  assert(!target.disabled, `${selector} was disabled: ${JSON.stringify(target)}`);
  const base = { x: target.x, y: target.y, button: 'left', clickCount: 1, buttons: 1 };
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 });
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
  await cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
  return target;
}

async function settleUi(cdp) {
  await evaluate(cdp, `(async () => {
    if (window.__mlsSessionReady) await Promise.race([
      Promise.resolve(window.__mlsSessionReady),
      new Promise((_, reject) => setTimeout(() => reject(new Error('session-ready-timeout')), 45000))
    ]);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`, { awaitPromise: true, userGesture: false });
  await waitFor(cdp, 'the calm clinician shell', `document.body.classList.contains('mls-redesign') && !!document.getElementById('mlsRdNav')`, 50000);
  await sleep(400);
}

/* ------------------------------------------------------------------ *
 * Steps
 * ------------------------------------------------------------------ */
async function syntheticLogin(cdp, appUrl) {
  await cdp.send('Page.navigate', { url: appUrl });
  await waitFor(cdp, 'initial local-demo auth screen', `document.readyState==='complete' && !!document.getElementById('authScreen')`, 40000);
  await evaluate(cdp, `localStorage.clear();sessionStorage.clear();localStorage.setItem('mls.easyV2.enabled','0');localStorage.setItem('mls.easyOne.enabled','0');location.href=${JSON.stringify(appUrl)};true`);
  await waitFor(cdp, 'clean local-demo auth screen', `document.readyState==='complete' && !!document.getElementById('tabSignup')`, 40000);
  await click(cdp, '#tabSignup');
  await waitFor(cdp, 'synthetic signup fields', `(() => { const f=document.getElementById('authSignupAssentFields'); return !!f && !f.disabled; })()`, 15000);
  await fill(cdp, '#authEmail', SYNTHETIC_EMAIL);
  await fill(cdp, '#authPass', SYNTHETIC_PASSWORD);
  await fill(cdp, '#authPass2', SYNTHETIC_PASSWORD);
  await click(cdp, '#authTermsAssent');
  await click(cdp, '#authPracticeAuthority');
  await waitFor(cdp, 'explicit synthetic signup confirmations', `document.getElementById('authTermsAssent').checked && document.getElementById('authPracticeAuthority').checked && !document.getElementById('authBtn').disabled`);
  await click(cdp, '#authBtn');
  await waitFor(cdp, 'synthetic local account login', `document.getElementById('appScreen') && getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 40000);
  await settleUi(cdp);
  const runtime = await evaluate(cdp, `({ demo: !!(window._SF_DEMO || /[?&]demo=1/.test(location.search)), backend: (typeof backendMode==='function' ? backendMode() : null), fetchIsStub: !!(window.fetch && window.fetch.__mlsAiStub) || (typeof window.__mlsAiStub==='object') })`);
  assert.strictEqual(runtime.backend, false, 'live-draft-a-day must run with the production backend disabled');
  assert.strictEqual(runtime.fetchIsStub, true, 'the deterministic AI stub was not installed before boot');
  return runtime;
}

async function seedTemplate(cdp) {
  const result = await evaluate(cdp, `(() => {
    const tpl = {
      id: 'syn-tpl-mbb-0001',
      name: ${JSON.stringify(SYNTH_TEMPLATE_NAME)},
      text: ${JSON.stringify(SYNTH_TEMPLATE_TEXT)},
      keywords: ${JSON.stringify(SYNTH_TEMPLATE_KEYWORDS)},
      created: Date.now(),
      source: 'live-draft-a-day synthetic fixture'
    };
    setTemplates([tpl]);
    const back = getTemplates();
    return { count: back.length, id: back[0] && back[0].id, name: back[0] && back[0].name, chars: (back[0] && back[0].text || '').length };
  })()`);
  assert.strictEqual(result.count, 1, `synthetic template did not persist through the app store: ${JSON.stringify(result)}`);
  assert.strictEqual(result.id, 'syn-tpl-mbb-0001', 'template id changed on the way through setTemplates/getTemplates');
  return result;
}

async function seedDay(cdp, patients, dayKey) {
  const result = await evaluate(cdp, `(() => {
    const seed = ${JSON.stringify(patients)};
    const now = Date.now();
    const existing = getPatients();
    const merged = existing.slice();
    seed.forEach(p => {
      if (merged.some(x => x && x.id === p.id)) return;
      merged.push({
        id: p.id, name: p.name, dob: p.dob, mrn: p.mrn, sex: p.sex,
        problems: 'Facet-mediated lumbar pain (SYNTHETIC TEST FIXTURE). Chronic axial low back pain without radiculopathy.',
        meds: 'None documented - synthetic fixture.',
        allergies: 'No known drug allergies - synthetic fixture.',
        summary: 'SYNTHETIC TEST PATIENT. Axial low back pain, conservative care exhausted, referred for a diagnostic medial branch block. No real patient data is represented.',
        created: now, updated: now, source: 'live-draft-a-day synthetic fixture'
      });
    });
    savePatients(merged);
    window._calAppts = (window._calAppts || []).filter(a => !seed.some(p => String(a && a.patient_external_id) === p.id));
    seed.forEach(p => {
      window._calAppts.push({
        patient_external_id: p.id, name: p.name, dob: p.dob, reason: p.reason,
        appt_date: p.dayKey, start_at: p.dayKey + 'T' + p.time + ':00',
        providerName: ${JSON.stringify(SYNTH_PROVIDER)}, providerId: 'syn-prov-1',
        facilityName: ${JSON.stringify(SYNTH_FACILITY)}, facilityId: 'syn-fac-1'
      });
    });
    const appts = _opApptsForDay(${JSON.stringify(dayKey)});
    const resolved = seed.map(p => !!_opResolvePatient(p.name, p.dob, p.id));
    const ranks = seed.map(p => { const r = _opRankTemplates(p.reason); return r && r[0] ? r[0].score : -1; });
    return {
      patientCount: getPatients().length, apptCount: appts.length,
      unresolved: resolved.filter(x => !x).length,
      minTemplateScore: Math.min.apply(null, ranks), ranks
    };
  })()`);
  assert.strictEqual(result.apptCount, patients.length, `synthetic day did not build ${patients.length} appointments: ${JSON.stringify(result)}`);
  assert.strictEqual(result.unresolved, 0, `some synthetic appointments do not resolve to an exact patient: ${JSON.stringify(result)}`);
  assert(result.minTemplateScore > 0, `the auto-picker could not match the uploaded template for every row (min score ${result.minTemplateScore}); Draft-all would skip those rows`);
  return result;
}

async function openDayRoom(cdp, dayKey, expectedRows) {
  await evaluate(cdp, `(() => { openOpPrep(${JSON.stringify(dayKey)}); return true; })()`);
  await waitFor(cdp, 'the op-note room to open on the synthetic day',
    `!!document.getElementById('opPrepModal') && document.getElementById('opPrepModal').classList.contains('show') && (window._opPrep||[]).length===${expectedRows}`, 20000);
  await waitFor(cdp, 'the live Draft-all ledger to be wired by mls-connect.js (__mlsTplPrepFix)',
    `!!document.getElementById('tpfLedger') && !!document.getElementById('tpfLedgerList')`, 20000);
  const owner = await evaluate(cdp, `({
    tpfInstalled: !!(window.__mlsTplPrepFix && typeof window.__mlsTplPrepFix.draftAll === 'function'),
    tpfVersion: (window.__mlsTplPrepFix && window.__mlsTplPrepFix.v) || '',
    integrityWrappedAll: !!(window.opPrepGenerateAll && window.opPrepGenerateAll.__oni),
    integrityWrappedOne: !!(window.opPrepGenerateOne && window.opPrepGenerateOne.__oni),
    mode: window._opPrepMode || '', rows: (window._opPrep||[]).length,
    rowsWithTemplate: (window._opPrep||[]).filter(r => r && r.tplId).length
  })`);
  assert.strictEqual(owner.tpfInstalled, true, 'the live Draft-all runner (__mlsTplPrepFix.draftAll) is not installed - this test would be driving a dead path');
  assert.strictEqual(owner.rowsWithTemplate, expectedRows, `not every row auto-matched a template: ${JSON.stringify(owner)}`);
  return owner;
}

async function pressDraftAll(cdp) {
  await evaluate(cdp, `(() => { const s=document.getElementById('opPrepStatus'); if(s) s.textContent=''; return true; })()`);
  const target = await trustedClick(cdp, '#opPrepGenAllBtn');
  assert(/draft all/i.test(target.label), `the clicked control is not the Draft-all button: ${JSON.stringify(target)}`);
  await waitFor(cdp, 'the Draft-all run to start painting its ledger',
    `(document.getElementById('tpfLedgerList')||{}).children && document.getElementById('tpfLedgerList').children.length > 0`, 20000);
  return target;
}

async function awaitRunFinished(cdp, timeoutMs = 300000) {
  const started = Date.now();
  const summary = await waitFor(cdp, 'the Draft-all completion line',
    `(() => { const t=((document.getElementById('opPrepStatus')||{}).textContent||''); return /(?:Done|Stopped):/.test(t) ? t : false; })()`, timeoutMs);
  await sleep(300);
  return { summary, elapsedMs: Date.now() - started };
}

async function collect(cdp) {
  return evaluate(cdp, `(() => {
    const txt = el => (el ? (el.innerText || el.textContent || '') : '').replace(/\\s+/g,' ').trim();
    const ledgerList = document.getElementById('tpfLedgerList');
    const ledger = ledgerList ? [...ledgerList.children].map(el => ({ cls: el.className || '', text: txt(el) })) : null;
    const nav = [...document.querySelectorAll('#oprRowNav .opr-nav-item')].map(b => ({
      name: txt(b.querySelector('.nm')).replace(txt(b.querySelector('.opr-nav-st')), '').trim(),
      state: txt(b.querySelector('.opr-nav-st')), dot: (b.querySelector('.opr-dot')||{}).className || ''
    }));
    const notes = (typeof getNotes === 'function' ? getNotes() : []).filter(n => n && n.kind === 'opnote');
    const rows = (window._opPrep || []).map((r, i) => ({
      i, name: (r.appt && r.appt.name) || '', proc: r.proc || '', tplId: r.tplId || '',
      gen: !!r.gen, edited: !!r.edited, genSeq: r._genSeq || 0,
      noteId: r._noteId || '', noteChars: String(r.note || '').length,
      missing: (r.missing || []).map(m => m && m.key),
      lastErr: String(r._lastDraftErr || ''),
      hasFills: {
        needle: String(r.note||'').indexOf('22g 3.5in SYNTHETIC-FIXTURE') >= 0,
        injectate: String(r.note||'').indexOf('0.5 mL of SYNTHETIC-FIXTURE test injectate') >= 0,
        openSlot: /\\[\\[fluoroscopy_time\\]\\]/.test(String(r.note||''))
      },
      headings: (window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.headings) ? window.__mlsOpNoteIntegrity.headings(String(r.note||'')) : null,
      procLine: ((String(r.note||'').match(/^PROCEDURE:.*$/m) || [''])[0]).slice(0, 220),
      /* the product's OWN fact parser, applied to what actually landed */
      noteFacts: (window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.parseProcedureFacts)
        ? (() => { const f = window.__mlsOpNoteIntegrity.parseProcedureFacts(String(r.note||'')); return { procedureType: f.procedureType, region: f.region, side: f.side, levels: f.levels, approach: f.approach }; })() : null,
      requestedFacts: (window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.parseProcedureFacts)
        ? (() => { const f = window.__mlsOpNoteIntegrity.parseProcedureFacts(String(r.proc||'')); return { procedureType: f.procedureType, region: f.region, side: f.side, levels: f.levels, approach: f.approach }; })() : null,
      blanksInNote: (typeof window.opNoteBlankCount === 'function') ? window.opNoteBlankCount(String(r.note||'')) : null,
      blankKeysInNote: (typeof window.opNoteBlankTokens === 'function') ? window.opNoteBlankTokens(String(r.note||'')).map(t => t.key) : null,
      savedNote: (() => {
        const n = notes.find(x => x.id === r._noteId);
        if (!n) return null;
        const a = String(r.note||''), b = String(n.text||'');
        let diff = -1;
        if (a !== b) { const lim = Math.min(a.length, b.length); for (let k = 0; k < lim; k++) { if (a[k] !== b[k]) { diff = k; break; } } if (diff < 0) diff = lim; }
        return {
          id: n.id, patientId: n.patientId, cc: n.cc, chars: b.length,
          matchesRow: a === b, isDraft: !!n.isDraft, firstDiffAt: diff,
          rowAtDiff: diff >= 0 ? a.slice(Math.max(0, diff - 60), diff + 90) : '',
          savedAtDiff: diff >= 0 ? b.slice(Math.max(0, diff - 60), diff + 90) : '',
          blanksInSaved: (typeof window.opNoteBlankCount === 'function') ? window.opNoteBlankCount(b) : null
        };
      })()
    }));
    const templateHeadings = (window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.headings && typeof getTemplates === 'function')
      ? window.__mlsOpNoteIntegrity.headings(window.__mlsOpNoteIntegrity.sanitizeTemplate ? window.__mlsOpNoteIntegrity.sanitizeTemplate((getTemplates()[0]||{}).text||'') : ((getTemplates()[0]||{}).text||''))
      : null;
    return {
      summary: txt(document.getElementById('opPrepStatus')),
      ledgerHead: txt(document.querySelector('#tpfLedger .tpf-lstat')),
      ledger, nav, rows, templateHeadings,
      notes: notes.map(n => ({ id: n.id, patientId: n.patientId, cc: n.cc, chars: String(n.text||'').length, isDraft: !!n.isDraft, kind: n.kind })),
      aiRequests: (window.__mlsAiStub && window.__mlsAiStub.requests || []).map(r => ({
        n: r.n, transport: r.transport, phase: r.phase, patient: r.patient, procedure: r.procedure,
        sysChars: r.sysChars, userChars: r.userChars, templateChars: r.templateChars,
        mode: r.mode, answered: r.answered, missingKeys: r.missingKeys || [],
        sysHasTemplateLaw: /Preserve its heading names, heading order/.test(r.sys||'') || /Keep the template/.test(r.sys||''),
        sysHasNoFabrication: /Never invent a fact|never invent/i.test(r.sys||''),
        sysHasJsonContract: /\\{"note"/.test(r.sys||'')
      })),
      externalHits: (window.__mlsAiStub && window.__mlsAiStub.externalHits || []).slice(0, 20)
    };
  })()`);
}

function parseSummary(text) {
  const m = /(Done|Stopped):\s*(\d+)\s*drafted\s*[\u00B7·]\s*(\d+)\s*failed\s*[\u00B7·]\s*(\d+)\s*skipped of\s*(\d+)/.exec(String(text || ''));
  if (!m) return null;
  return { kind: m[1], drafted: +m[2], failed: +m[3], skipped: +m[4], total: +m[5] };
}

function ledgerCounts(ledger) {
  const out = { ok: 0, bad: 0, skip: 0, pend: 0, run: 0, unknown: 0 };
  for (const entry of ledger) {
    const cls = String(entry.cls || '').trim();
    if (Object.prototype.hasOwnProperty.call(out, cls)) out[cls]++;
    else out.unknown++;
  }
  return out;
}

/* The reason a failed row shows must be something a doctor can act on: present,
   specific enough to read, and not merely a bare status code. */
function reasonOf(entry) {
  const text = String(entry.text || '');
  const at = text.indexOf('\u2014');
  return (at >= 0 ? text.slice(at + 1) : '').trim();
}

function assertDefiniteStates(step, snap, expectedTotal, failures) {
  assert(snap.ledger, `${step}: the Draft-all ledger did not render at all`);
  assert.strictEqual(snap.ledger.length, expectedTotal, `${step}: the ledger shows ${snap.ledger.length} rows for a ${expectedTotal}-row day`);
  assert.strictEqual(snap.rows.length, expectedTotal, `${step}: the run lost rows (${snap.rows.length} of ${expectedTotal})`);
  const counts = ledgerCounts(snap.ledger);
  assert.strictEqual(counts.pend, 0, `${step}: ${counts.pend} row(s) were left PENDING with no outcome: ${JSON.stringify(snap.ledger.filter(e => e.cls === 'pend'))}`);
  assert.strictEqual(counts.run, 0, `${step}: ${counts.run} row(s) were left mid-flight`);
  assert.strictEqual(counts.unknown, 0, `${step}: ledger rows carry an unrecognized state: ${JSON.stringify(snap.ledger.filter(e => !['ok','bad','skip'].includes(e.cls)))}`);
  assert.strictEqual(counts.ok + counts.bad + counts.skip, expectedTotal,
    `${step}: drafted+failed+skipped (${counts.ok}+${counts.bad}+${counts.skip}) does not equal ${expectedTotal}`);
  const reasonless = snap.ledger.filter((e) => e.cls === 'bad' && reasonOf(e).length < 12);
  assert.deepStrictEqual(reasonless, [], `${step}: a failed row was recorded WITHOUT an actionable reason: ${JSON.stringify(reasonless)}`);
  const skipReasonless = snap.ledger.filter((e) => e.cls === 'skip' && reasonOf(e).length < 8);
  assert.deepStrictEqual(skipReasonless, [], `${step}: a skipped row was recorded without a reason: ${JSON.stringify(skipReasonless)}`);
  if (failures) {
    assert.strictEqual(counts.bad, failures.length, `${step}: expected exactly ${failures.length} failed row(s), ledger shows ${counts.bad}`);
  }
  return counts;
}

function assertSummaryHonest(step, snap, counts) {
  const parsed = parseSummary(snap.summary);
  assert(parsed, `${step}: the completion line is not a countable summary: ${JSON.stringify(snap.summary)}`);
  assert.strictEqual(parsed.kind, 'Done', `${step}: the run did not finish cleanly (${parsed.kind})`);
  assert.deepStrictEqual(
    { drafted: parsed.drafted, failed: parsed.failed, skipped: parsed.skipped },
    { drafted: counts.ok, failed: counts.bad, skipped: counts.skip },
    `${step}: THE SUMMARY DISAGREES WITH THE ROWS. summary=${JSON.stringify(parsed)} rows=${JSON.stringify(counts)}`
  );
  assert.strictEqual(parsed.total, snap.ledger.length, `${step}: the summary total does not equal the number of rows`);

  /* the strongest form: the green number must equal the notes that actually
     landed in History for this run's rows. "Saved as draft" is a claim; a note
     in History with real text is the evidence. */
  const landed = snap.rows.filter((r) => r.savedNote && r.savedNote.chars > 400).length;
  assert.strictEqual(parsed.drafted, landed,
    `${step}: the summary claims ${parsed.drafted} drafted but only ${landed} row(s) have a note saved in History; ` +
    `rows=${JSON.stringify(snap.rows.map((r) => ({ name: r.name, gen: r.gen, noteChars: r.noteChars, saved: !!r.savedNote })))}`);

  const headHas = parseSummary(snap.ledgerHead);
  if (headHas) {
    assert.deepStrictEqual({ d: headHas.drafted, f: headHas.failed, s: headHas.skipped },
      { d: counts.ok, f: counts.bad, s: counts.skip },
      `${step}: the ledger header counts disagree with the ledger rows`);
  }
  return parsed;
}

function assertTemplateFollowed(step, snap, expectDraftedNames) {
  for (const row of snap.rows) {
    if (!expectDraftedNames.includes(row.name)) continue;
    assert(row.headings && row.headings.length >= 8, `${step}: ${row.name}'s note lost its section structure (headings=${JSON.stringify(row.headings)})`);
    assert.deepStrictEqual(row.headings.slice(0, snap.templateHeadings.length), snap.templateHeadings,
      `${step}: ${row.name}'s note does not preserve the template heading set/order`);
    assert(row.hasFills.needle, `${step}: ${row.name}'s note did not carry the filled needle slot`);
    assert(row.hasFills.injectate, `${step}: ${row.name}'s note did not carry the filled injectate slot`);
    assert(row.missing.includes('fluoroscopy_time'), `${step}: ${row.name}'s row did not record the open slot as a blank to fill: ${JSON.stringify(row.missing)}`);
    assert(row.noteChars > 900, `${step}: ${row.name}'s note is suspiciously short (${row.noteChars} chars)`);
  }
}

/* The single clinical-safety invariant of this whole feature: a note that is
   saved for a patient must document the procedure that patient is scheduled
   for. Judged with the product's OWN fact parser. */
function assertNoteDocumentsTheRightProcedure(step, snap) {
  const wrong = [];
  for (const row of snap.rows) {
    if (!row.gen || !row.savedNote) continue;
    const want = row.requestedFacts, got = row.noteFacts;
    if (!want || !got) continue;
    const bad = [];
    if (want.procedureType && got.procedureType && want.procedureType !== got.procedureType) bad.push('procedureType');
    if (want.region && got.region && want.region !== got.region) bad.push('region');
    if (want.side && got.side && want.side !== got.side) bad.push('side');
    if (want.levels.length && got.levels.length && want.levels.join(',') !== got.levels.join(',')) bad.push('levels');
    if (want.approach && got.approach && want.approach !== got.approach) bad.push('approach');
    if (bad.length) wrong.push({ name: row.name, scheduledFor: row.proc, conflicts: bad, requested: want, noteSays: got, procLine: row.procLine });
  }
  assert.deepStrictEqual(wrong.map((w) => w.name), [],
    `${step}: ${wrong.length} SAVED note(s) document a different procedure than the patient is scheduled for: ${JSON.stringify(wrong.slice(0, 2), null, 1)}`);
}

/* "saved as draft" is a claim about History. The note in History must BE the
   note the row is showing, or the doctor approves one document and stores
   another. */
function assertHistoryMatchesScreen(step, snap) {
  const divergent = snap.rows
    .filter((r) => r.savedNote && !r.savedNote.matchesRow)
    .map((r) => ({ name: r.name, screenChars: r.noteChars, historyChars: r.savedNote.chars, firstDiffAt: r.savedNote.firstDiffAt, screen: r.savedNote.rowAtDiff, history: r.savedNote.savedAtDiff }));
  assert.deepStrictEqual(divergent.map((d) => d.name), [],
    `${step}: ${divergent.length} of ${snap.rows.length} rows show one note and stored a different one: ${JSON.stringify(divergent.slice(0, 1), null, 1)}`);
}

/* Two surfaces on the same screen count the same blanks. The ledger prints the
   count captured at draft time (row.missing); the room's patient rail prints a
   live count from the note text. If they disagree the doctor is reading two
   different numbers for one note. */
function assertBlankCountsAgree(step, snap, drafted) {
  const disagree = [];
  for (const row of snap.rows) {
    if (!drafted.includes(row.name)) continue;
    const nav = snap.nav.find((n) => n.name === row.name);
    const ledger = snap.ledger.find((e) => String(e.text || '').indexOf(row.name) >= 0);
    const navN = nav ? (/(\d+)\s+blanks?\s+to\s+fill/.exec(nav.state) || [])[1] : undefined;
    const ledN = ledger ? (/(\d+)\s+blanks?\s+to\s+fill/.exec(ledger.text) || [])[1] : undefined;
    const rowN = row.missing.length, textN = row.blanksInNote;
    if (String(navN) !== String(ledN) || Number(ledN) !== Number(textN)) {
      disagree.push({
        name: row.name, roomRailSays: navN, draftAllLedgerSays: ledN,
        blanksActuallyLeftInNote: textN,
        rowMissingKeys: row.missing, blankKeysStillInNote: row.blankKeysInNote
      });
    }
  }
  assert.deepStrictEqual(disagree.map((d) => d.name), [],
    `${step}: ${disagree.length} of ${drafted.length} rows print two different blank counts on one screen: ${JSON.stringify(disagree.slice(0, 2), null, 1)}`);
}

function assertSystemPromptSent(step, requests) {
  assert(requests.length > 0, `${step}: the app made no AI call at all`);
  const initial = requests.filter((r) => r.phase === 'initial');
  assert(initial.length > 0, `${step}: no initial generation request was sent`);
  const noTemplate = initial.filter((r) => r.templateChars < 500);
  assert.deepStrictEqual(noTemplate, [], `${step}: a generation request was sent WITHOUT the selected template: ${JSON.stringify(noTemplate)}`);
  const weakSys = initial.filter((r) => !r.sysHasTemplateLaw || !r.sysHasNoFabrication || !r.sysHasJsonContract);
  assert.deepStrictEqual(weakSys.map((r) => ({ n: r.n, patient: r.patient, sysChars: r.sysChars, law: r.sysHasTemplateLaw, nofab: r.sysHasNoFabrication, json: r.sysHasJsonContract })), [],
    `${step}: the SYSTEM PROMPT actually sent is missing the template-fidelity law, the anti-fabrication rule, or the JSON contract`);
  const wrongPatient = initial.filter((r) => !/^Synthetic /.test(String(r.patient || '')));
  assert.deepStrictEqual(wrongPatient, [], `${step}: a generation request named a patient that is not a synthetic fixture`);
}

/* ------------------------------------------------------------------ *
 * main
 * ------------------------------------------------------------------ */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node tests/live-draft-a-day.js [--headed] [--chrome=PATH] [--artifacts=PATH]\n');
    return;
  }
  const chromePath = findChrome(args.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(ROOT, args.artifacts || path.join('tests', 'live-draft-a-day-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-draft-a-day-'));
  const { server, origin } = await startStaticServer();
  const appUrl = `${origin}/ScribeFlow.html?demo=1&draftADay=${encodeURIComponent(stamp)}&classic=1&mlseasy=classic&easyone=0`;

  const today = new Date();
  const dayA = new Date(today.getTime() + 86400000);
  const dayB = new Date(today.getTime() + 2 * 86400000);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const DAY_A = key(dayA), DAY_B = key(dayB);
  const PATIENTS_A = buildDay('a', 13, DAY_A);
  const PATIENTS_B = buildDay('b', 13, DAY_B);

  const results = [];
  const defects = [];
  const record = (step, verdict, evidence) => { results.push({ step, verdict, evidence }); };
  const progress = (m) => process.stdout.write(`[draft-a-day] ${m}\n`);
  /* Every assertion group is INDEPENDENT: a failure is recorded and the run
     continues, so one pass reports every defect instead of the first one. */
  const check = (step, fn, passEvidence) => {
    try {
      const out = fn();
      record(step, 'PASS', typeof passEvidence === 'function' ? passEvidence(out) : passEvidence);
      return out;
    } catch (error) {
      const msg = String(error.message || error).split('\n').slice(0, 6).join(' ');
      record(step, 'FAIL', msg);
      defects.push({ claim: step, evidence: msg.slice(0, 1400) });
      progress(`FAIL ${step}: ${msg.slice(0, 200)}`);
      return null;
    }
  };

  let chrome, cdp, exitCode = 0;
  const report = { status: 'FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true, appUrl, phases: {} };
  const browserErrors = [];

  try {
    chrome = await launchChrome(chromePath, profileDir, args.headed);
    cdp = await createPage(chrome.port);
    cdp.on('Runtime.exceptionThrown', (event) => {
      const d = event.exceptionDetails || {};
      browserErrors.push({ text: String(d.text || ''), description: String((d.exception && d.exception.description) || '').slice(0, 400) });
    });
    cdp.on('Page.javascriptDialogOpening', () => { cdp.send('Page.handleJavaScriptDialog', { accept: true }, 5000).catch(() => {}); });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: AI_STUB_SOURCE });
    progress('deterministic AI stub armed before app boot');

    /* ---------- STEP 1: synthetic login + a synthetic day ---------- */
    const runtime = await syntheticLogin(cdp, appUrl);
    progress('synthetic signup/login settled with the backend disabled');
    const tpl = await seedTemplate(cdp);
    const seedA = await seedDay(cdp, PATIENTS_A, DAY_A);
    record('1. synthetic login + 13-row synthetic procedure day seeded', 'PASS',
      `backendMode=false, stub installed pre-boot; ${seedA.apptCount} appointments on ${DAY_A}; all ${seedA.apptCount} resolve to an exact synthetic patient`);
    record('2. one uploaded synthetic template auto-matches every row', 'PASS',
      `template "${tpl.name}" (${tpl.chars} chars); _opRankTemplates top score per row = ${JSON.stringify(seedA.ranks)} (min ${seedA.minTemplateScore} > 0)`);

    /* ---------- STEP 3: press the REAL button ---------- */
    const ownerA = await openDayRoom(cdp, DAY_A, PATIENTS_A.length);
    const clickedA = await pressDraftAll(cdp);
    progress(`pressed the real ${JSON.stringify(clickedA.label)} at ${clickedA.x},${clickedA.y}`);
    const runA = await awaitRunFinished(cdp);
    const snapA = await collect(cdp);
    await screenshot(cdp, path.join(artifactDir, '01-day-a-happy-path.png'));
    report.phases.happyPath = snapA;
    record('3. the real "Draft all op notes" button was pressed (trusted CDP click)', 'PASS',
      `live owner = mls-connect.js __mlsTplPrepFix.draftAll (${ownerA.tpfVersion || 'tpf'}); button rect ${JSON.stringify(clickedA.rect)}, hit-tested reachable; run finished in ${(runA.elapsedMs / 1000).toFixed(1)}s`);

    /* ---------- STEP 4 + 5 ---------- */
    const countsA = check('4. every row ends in a definite state (no row left pending)',
      () => {
        const c = assertDefiniteStates('happy path', snapA, PATIENTS_A.length, null);
        assert.strictEqual(c.ok, PATIENTS_A.length, `happy path: only ${c.ok} of ${PATIENTS_A.length} rows drafted`);
        return c;
      },
      (c) => `ledger states: drafted=${c.ok} failed=${c.bad} skipped=${c.skip} pending=${c.pend}; drafted+failed+skipped=${c.ok + c.bad + c.skip}=${PATIENTS_A.length}; run took ${(runA.elapsedMs / 1000).toFixed(1)}s`);

    check('5. the completion line agrees with the rows AND with History',
      () => assertSummaryHonest('happy path', snapA, countsA || ledgerCounts(snapA.ledger)),
      (p) => `summary="${snapA.summary.slice(0, 110)}" -> ${JSON.stringify(p)}; ${snapA.rows.filter((r) => r.savedNote).length} rows have a note in History and every one equals the note on screen`);

    check('5b. template-following held (headings, fixed wording, filled slots)',
      () => { assertTemplateFollowed('happy path', snapA, snapA.rows.map((r) => r.name)); return true; },
      `all 13 notes preserved the ${snapA.templateHeadings ? snapA.templateHeadings.length : '?'} template headings in order, carried both synthetic slot fills, and kept the deliberately-open slot as a blank`);

    check('5c. the note in History is the note on the screen',
      () => { assertHistoryMatchesScreen('happy path', snapA); return true; },
      `all ${snapA.rows.filter((r) => r.savedNote).length} rows: the autosaved History draft is byte-identical to the note the row shows`);

    check('5f. every saved note documents the procedure that patient is scheduled for',
      () => { assertNoteDocumentsTheRightProcedure('happy path', snapA); return true; },
      () => `13/13 notes: procedure type, region, side and levels parsed out of the saved note equal the scheduled procedure (e.g. ${JSON.stringify(snapA.rows[1] && snapA.rows[1].noteFacts)})`);

    check('5e. the two on-screen blank counts agree with the note itself',
      () => { assertBlankCountsAgree('happy path', snapA, snapA.rows.map((r) => r.name)); return true; },
      'the Draft-all ledger, the room patient rail, and opNoteBlankCount(note) all report the same number of blanks per row');

    check('5d. the SYSTEM PROMPT actually sent carries the template law',
      () => { assertSystemPromptSent('happy path', snapA.aiRequests); return true; },
      () => `${snapA.aiRequests.length} recorded requests; every initial call carried the selected template (${snapA.aiRequests[0] ? snapA.aiRequests[0].templateChars : 0} chars) plus the heading-preservation, anti-fabrication and JSON-contract clauses`);
    progress(`happy path: ${snapA.summary.slice(0, 100)}`);

    /* ---------- STEP 7: idempotent re-run ---------- */
    const notesBefore = snapA.notes.length;
    const noteIdsBefore = snapA.rows.map((r) => r.noteId).sort();
    await pressDraftAll(cdp);
    const runA2 = await awaitRunFinished(cdp);
    const snapA2 = await collect(cdp);
    report.phases.idempotentRerun = snapA2;
    check('7. a second Draft-all is idempotent (no duplicated notes)',
      () => {
        const c = assertDefiniteStates('re-run', snapA2, PATIENTS_A.length, null);
        assertSummaryHonest('re-run', snapA2, c);
        assert.strictEqual(snapA2.notes.length, notesBefore,
          `re-run duplicated notes in History: ${notesBefore} -> ${snapA2.notes.length}`);
        assert.deepStrictEqual(snapA2.rows.map((r) => r.noteId).sort(), noteIdsBefore,
          're-run did not reuse the same History note ids');
        const dupCc = {};
        snapA2.notes.forEach((n) => { const k = `${n.patientId}|${n.cc}`; dupCc[k] = (dupCc[k] || 0) + 1; });
        const duplicated = Object.entries(dupCc).filter(([, v]) => v > 1);
        assert.deepStrictEqual(duplicated, [], `re-run produced duplicate op-note drafts: ${JSON.stringify(duplicated)}`);
        return c;
      },
      (c) => `re-ran all ${PATIENTS_A.length} rows in ${(runA2.elapsedMs / 1000).toFixed(1)}s: History op-note drafts stayed at ${snapA2.notes.length}, every row reused its original note id, no duplicate patient+cc pair; second summary "${snapA2.summary.slice(0, 70)}"`);
    progress(`idempotent re-run: ${snapA2.summary.slice(0, 100)}`);

    /* ---------- STEP 6: deliberate failure path on a virgin day ---------- */
    const failHttp = PATIENTS_B[3].name;         /* transport failure: HTTP 500 */
    const failWrongProc = PATIENTS_B[8].name;    /* clinically wrong draft */
    const garbled = PATIENTS_B[11].name;         /* malformed model reply - outcome observed, not assumed */
    await seedDay(cdp, PATIENTS_B, DAY_B);
    await evaluate(cdp, `(() => { window.__mlsAiStub.setFailures(${JSON.stringify({ [failHttp]: 'http500', [failWrongProc]: 'wrongprocedure', [garbled]: 'malformed' })}); window.__mlsAiStub.reset(); return true; })()`);
    await openDayRoom(cdp, DAY_B, PATIENTS_B.length);
    await pressDraftAll(cdp);
    const runB = await awaitRunFinished(cdp);
    const snapB = await collect(cdp);
    await screenshot(cdp, path.join(artifactDir, '02-day-b-failure-path.png'));
    report.phases.failurePath = snapB;

    const badEntries = snapB.ledger.filter((e) => e.cls === 'bad');
    const reasons = badEntries.map((e) => ({ row: String(e.text).slice(0, 34), reason: reasonOf(e) }));
    const attempts = (name) => snapB.aiRequests.filter((r) => r.patient === name).length;
    const injected = [failHttp, failWrongProc];
    const healthyNames = snapB.rows.map((r) => r.name).filter((n) => n !== failHttp && n !== failWrongProc && n !== garbled);
    const garbledRow = snapB.rows.find((r) => r.name === garbled);
    const garbledLedger = snapB.ledger.find((e) => String(e.text || '').indexOf(garbled) >= 0);

    const countsB = check('6a. one bad row does not poison the run',
      () => {
        const c = assertDefiniteStates('failure path', snapB, PATIENTS_B.length, null);
        assert.strictEqual(c.ok + c.bad + c.skip, PATIENTS_B.length, 'failure path: rows went missing');
        assert(c.ok >= healthyNames.length,
          `failure path: only ${c.ok} rows drafted; the ${healthyNames.length} healthy rows around the injected failures should all still draft`);
        assertTemplateFollowed('failure path', snapB, healthyNames);
        return c;
      },
      (c) => `injected HTTP 500 at row 4, a clinically wrong draft at row 9 and a malformed reply at row 12; the ${healthyNames.length} healthy rows all drafted and each preserved the template (ledger drafted=${c.ok} failed=${c.bad} skipped=${c.skip} pending=${c.pend})`);

    check('6e. a draft documenting the WRONG procedure never reaches History',
      () => {
        assertNoteDocumentsTheRightProcedure('failure path', snapB);
        const r = snapB.rows.find((x) => x.name === failWrongProc);
        assert(r, 'the wrong-procedure row vanished');
        assert(!r.savedNote || /medial branch/i.test(r.procLine),
          `a note stored for ${failWrongProc} still reads "${r.procLine}"`);
        return r;
      },
      (r) => `the model answered with a cervical interlaminar ESI for a patient scheduled for "${r.proc}"; ` +
        (r.savedNote
          ? `the pipeline overwrote the wrong procedure line deterministically and stored "${r.procLine}"`
          : `the clinical-consistency gate refused the draft and stored nothing (ledger: ${JSON.stringify((snapB.ledger.find((e) => String(e.text).indexOf(failWrongProc) >= 0) || {}).text || '')})`));

    check('6b. each failed row names a reason a doctor could act on',
      () => {
        const badNames = badEntries.map((e) => String(e.text || '').replace(/^\u2717\s*/, '').split('\u2014')[0].trim());
        for (const name of [failHttp]) {
          assert(badNames.some((n) => n.startsWith(name)), `${name} was injected to fail but is not marked failed (failed rows: ${JSON.stringify(badNames)})`);
          const row = snapB.rows.find((r) => r.name === name);
          assert(row, `${name} vanished from the run`);
          assert.strictEqual(row.gen, false, `${name} failed but the row is still marked generated`);
          assert.strictEqual(row.savedNote, null, `${name} failed but a note was saved to History anyway`);
        }
        for (const r of reasons) {
          assert(r.reason.length >= 12, `a failed row's reason is too thin to act on: ${JSON.stringify(r)}`);
          assert(!/^\d{3}\b/.test(r.reason), `a failed row reports only a bare HTTP status code, not a reason a doctor could act on: ${JSON.stringify(r)}`);
          assert(!/^AI draft failed twice/.test(r.reason), `a failed row fell back to the generic "AI draft failed twice" with no cause: ${JSON.stringify(r)}`);
        }
        return reasons;
      },
      () => `reasons shown: ${JSON.stringify(reasons)}; no failed row left a note in History; AI attempts spent: 500-row=${attempts(failHttp)}, wrong-procedure-row=${attempts(failWrongProc)}`);

    check('6c. the summary counts the failures as failures',
      () => assertSummaryHonest('failure path', snapB, countsB || ledgerCounts(snapB.ledger)),
      (p) => `completion line "${snapB.summary.slice(0, 90)}" -> ${JSON.stringify(p)}, matching the ledger row for row`);

    check('6d. a malformed model reply is never presented as a normal draft',
      () => {
        assert(garbledRow && garbledLedger, `the malformed-reply row disappeared`);
        const drafted = String(garbledLedger.cls) === 'ok';
        if (!drafted) return { outcome: 'failed-honestly', ledger: garbledLedger.text };
        /* it recovered. Then the recovery must be a real, template-shaped note
           AND the screen must not imply the model wrote it. */
        assert(garbledRow.noteChars > 900, `the recovered note is a stub (${garbledRow.noteChars} chars): ${JSON.stringify(garbledLedger.text)}`);
        assert.deepStrictEqual(garbledRow.headings.slice(0, snapB.templateHeadings.length), snapB.templateHeadings,
          'the recovered note does not follow the template');
        assert(/reconstructed|recovered|could not|template only|review/i.test(garbledLedger.text),
          `the row says "${garbledLedger.text}" \u2014 identical to a genuine AI draft, but the model returned nothing usable and the app rebuilt the note from the template alone`);
        return { outcome: 'recovered', ledger: garbledLedger.text };
      },
      (o) => `malformed reply outcome: ${JSON.stringify(o)}; ${attempts(garbled)} AI attempts spent`);
    progress(`failure path: ${snapB.summary.slice(0, 140)}`);

    /* ---------- guardrails ---------- */
    const fatal = browserErrors.filter((e) => !/ResizeObserver|Non-Error promise rejection/.test(e.text + e.description));
    check('8. no external network and no uncaught page errors',
      () => {
        assert.deepStrictEqual(snapB.externalHits, [], `a non-loopback network request escaped the synthetic run: ${JSON.stringify(snapB.externalHits)}`);
        assert.deepStrictEqual(fatal.slice(0, 5), [], `uncaught page exceptions during the run`);
        return true;
      },
      'zero non-loopback requests (Chrome also runs with MAP * ~NOTFOUND) and zero uncaught page exceptions across all three runs');

    report.status = results.some((r) => r.verdict === 'FAIL') ? 'FAIL' : 'PASS';
    if (report.status === 'FAIL') exitCode = 1;
  } catch (error) {
    exitCode = 1;
    report.error = error.stack || String(error);
    results.push({ step: 'RUN ABORTED', verdict: 'FAIL', evidence: String(error.message || error).split('\n').slice(0, 4).join(' ') });
    defects.push({ claim: String(error.message || error).split('\n')[0].slice(0, 400), evidence: (error.stack || '').slice(0, 1200) });
    if (cdp) await screenshot(cdp, path.join(artifactDir, 'FAIL.png'), 8000);
    try { if (cdp) report.failureSnapshot = await collect(cdp); } catch (_) {}
  } finally {
    report.results = results;
    report.defects = defects;
    report.browserErrors = browserErrors.slice(0, 20);
    try { fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); } catch (_) {}
    if (cdp) cdp.close();
    if (chrome && chrome.child) { try { chrome.child.kill(); } catch (_) {} }
    try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch (_) {}
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }

  process.stdout.write('\n================ live-draft-a-day ================\n');
  for (const r of results) process.stdout.write(`${r.verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${r.step}\n      ${r.evidence}\n`);
  process.stdout.write(`\n${report.status === 'PASS' ? 'PASS' : 'FAIL'} live Draft-all over a full synthetic day\n`);
  process.stdout.write(`Artifacts: ${artifactDir}\n`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
