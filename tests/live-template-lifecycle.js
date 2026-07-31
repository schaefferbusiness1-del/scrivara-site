'use strict';

/*
 * LIVE OP-NOTE TEMPLATE LIFECYCLE TEST  (b799, 2026-07-30)
 * -----------------------------------------------------------------------------
 * Owner ask, verbatim: "do a live test of uplaoding a templates and using it on
 * a patienbt for all 3 diffrent How drafts follow your template ... and make
 * sure it always drafts each note and theat it follows the tempalte and that
 * the auto picker tempalte works".
 *
 * Real Chrome, real app, real UI. Shape copied from tests/live-synthetic-smoke.js:
 * an isolated Chrome profile, a local no-store static server, CDP over a plain
 * WebSocket, zero npm dependencies. Never opens mlsscribe.com or athenanet.
 * Every patient, template and note here is SYNTHETIC and says so in its text.
 *
 * THE ONE THING A LOCAL HARNESS CANNOT DO is call the real model. Generation
 * ends at window.aiCallRaw, which POSTs to {BACKEND}/api/complete in hosted mode
 * and to api.openai.com/v1/chat/completions in the ?demo=1 per-device-key mode
 * this harness runs in. So window.fetch is replaced BEFORE the app boots with a
 * deterministic stub that:
 *
 *   - records the EXACT system prompt that went over the wire (after every
 *     wrapper in the chain: feat_opnote_history's history injection and
 *     feat_opnote_quality's [MLS QUALITY DIRECTIVE] both run before it), so the
 *     three "How drafts follow your template" modes are asserted on what was
 *     really SENT, not on what a module intended to send;
 *   - ECHOES THE TEMPLATE BACK exactly as the app handed it over, headings and
 *     fixed wording preserved, with every [[slot]] filled - from the prompt's
 *     own declared facts where the slot names one, otherwise with an obviously
 *     synthetic marker value.
 *
 * That echo is what makes template-following MEASURABLE without a model. The
 * stub cannot mangle a heading, drop fixed wording or leave a slot unfilled, so
 * anything wrong in the finished note was done by the app.
 *
 *   node tests/live-template-lifecycle.js
 *   node tests/live-template-lifecycle.js --headed
 *   node tests/live-template-lifecycle.js --artifacts=tmp/tpl-lifecycle
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

/* --------------------------------------------------------------------------
   SYNTHETIC FIXTURES. Obviously fake, and they say so in their own text.
   -------------------------------------------------------------------------- */
const SYNTHETIC_EMAIL = 'clinician.template-lifecycle@mls.local';
const SYNTHETIC_PASSWORD = 'SyntheticOnly2026!';

const SYNTHETIC_PATIENT = {
  name: 'Synthetic Template Fixture Patient',
  dob: '1979-03-04',
  mrn: 'SYN-TPL-0001',
  sex: 'Female'
};

/* The procedure is chosen so its classified type (trigger_point) is one NO
   shipped starter template claims - the three starters are a caudal ESI, a
   lumbar facet injection and a genicular block. So a correct auto-picker has
   exactly one honest answer: the template this test uploads. */
const SYNTHETIC_PROCEDURE = 'Bilateral lumbar paraspinal trigger point injections';

const TEMPLATE_NAME = 'Synthetic Trigger Point Fixture Template';
const TEMPLATE_KEYWORDS = 'trigger point, paraspinal, synthetic fixture';

/* One heading per line and no blank lines: the app's own template sanitizer
   splits on a whitespace-preceded "label:" run, so multi-heading lines would
   reflow and this test would be measuring the reflow instead of the app. */
const TEMPLATE_HEADINGS = [
  'SYNTHETIC OP-NOTE FIXTURE TEMPLATE - TRIGGER POINT INJECTIONS',
  'PATIENT:',
  'DATE OF PROCEDURE:',
  'PROCEDURE:',
  'INDICATION:',
  'ANESTHESIA:',
  'TECHNIQUE:',
  'IMAGING GUIDANCE:',
  'COMPLICATIONS:',
  'DISPOSITION:',
  'FOLLOW-UP:'
];

const TEMPLATE_TEXT = [
  'SYNTHETIC OP-NOTE FIXTURE TEMPLATE - TRIGGER POINT INJECTIONS',
  'PATIENT: [[patient]]',
  'DATE OF PROCEDURE: [[date_of_procedure]]',
  'PROCEDURE: [[procedure]]',
  'INDICATION: [[clinical_indication]]',
  'ANESTHESIA: Local synthetic anesthetic only and no sedation was administered for this fixture case.',
  'TECHNIQUE: Each documented synthetic trigger point was marked and entered with a [[needle_gauge]] needle, and a total of [[injectate_volume]] was deposited across the marked points using the standard fixture technique.',
  'IMAGING GUIDANCE: [[imaging_modality]]',
  'COMPLICATIONS: None.',
  'DISPOSITION: The synthetic fixture patient tolerated the procedure well and was discharged in stable condition.',
  'FOLLOW-UP: Synthetic fixture reassessment in four weeks with the documented pain score.'
].join('\n');

/* The three slots that must come back FILLED, and that no declared fact can
   supply - so only the round trip through the app can have filled them. */
const TEMPLATE_FREE_SLOTS = ['clinical_indication', 'needle_gauge', 'injectate_volume', 'imaging_modality'];

/* The mode clauses, byte-for-byte from feat_mls_opnote_integrity.js. 'adapt' is
   deliberately empty there, so its assertion is the ABSENCE of both others. */
const MODE_CLAUSE = {
  strict: 'TEMPLATE FIDELITY - CLOSEST',
  guide: 'TEMPLATE FIDELITY - LOOSER'
};
const MODE_LABEL = {
  strict: 'Follow it closely',
  adapt: 'Adapt to the case',
  guide: 'Use it as a guide'
};
const MODE_ORDER = ['strict', 'adapt', 'guide'];

/* --------------------------------------------------------------------------
   Harness plumbing - same shape as tests/live-synthetic-smoke.js.
   -------------------------------------------------------------------------- */
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

function usage() {
  return [
    'Usage: node tests/live-template-lifecycle.js [options]',
    '',
    '  --headed          Show the isolated Chrome window instead of headless Chrome',
    '  --chrome=PATH     Explicit Chrome/Chromium executable',
    '  --artifacts=PATH  Screenshot/report destination'
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
  if (!found) throw new Error('Google Chrome/Chromium was not found. Pass --chrome=PATH.');
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

  close() { try { this.socket.close(); } catch (_) {} }
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
  try { await waitForFile(portFile, 15000); }
  catch (error) {
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
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
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
    throw new Error(detail || result.exceptionDetails.text || `Evaluation failed: ${expression.slice(0, 160)}`);
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
    } catch (error) { last = error.message; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

function sel(selector) { return JSON.stringify(selector); }

async function visibility(cdp, selector) {
  return evaluate(cdp, `(() => {
    const els=[...document.querySelectorAll(${sel(selector)})];
    return els.map(el => {
      const s=getComputedStyle(el), r=el.getBoundingClientRect();
      return { display:s.display, visibility:s.visibility, opacity:s.opacity, w:Math.round(r.width), h:Math.round(r.height),
        visible: s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' && r.width>0 && r.height>0,
        text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80) };
    });
  })()`, { userGesture: false });
}

async function click(cdp, selector) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${sel(selector)});
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
  return result;
}

/* Click the first VISIBLE control from an ordered candidate list, and report
   which one it was. A control that is present-but-invisible is not a control
   the doctor can use, so it never counts here. */
async function clickFirstVisible(cdp, selectors, what) {
  const report = [];
  for (const selector of selectors) {
    const found = await visibility(cdp, selector);
    report.push({ selector, found });
    const index = found.findIndex((entry) => entry.visible);
    if (index >= 0) {
      await evaluate(cdp, `(() => {
        const el=[...document.querySelectorAll(${sel(selector)})][${index}];
        el.scrollIntoView({block:'center',inline:'center'}); el.focus({preventScroll:true}); el.click(); return true;
      })()`);
      return { used: selector, index, report };
    }
  }
  throw new Error(`No visible control for ${what}. Candidates: ${JSON.stringify(report)}`);
}

/* The calm shell collapses the header buttons (#opPrepSmartBtn measures 0x0)
   and offers them as rows in the dock's Tools launcher. That launcher IS the
   doctor's real door to the op-note room, so this test walks it. */
async function openViaTools(cdp, rowName) {
  await click(cdp, '#mlsDock button[data-dest="tools"]');
  const menu = await waitFor(cdp, 'the Tools launcher', `(() => {
    const m=document.getElementById('mlsToolsMenu');
    if(!m) return false;
    const rows=[...m.querySelectorAll('.r')].map(r => ({ i:r.getAttribute('data-i'), name:((r.querySelector('.rn')||{}).textContent||'').trim() }));
    return rows.length ? { rows } : false;
  })()`, 15000);
  const row = menu.rows.find((entry) => entry.name === rowName);
  if (!row) throw new Error(`The Tools launcher has no "${rowName}" row. Rows: ${JSON.stringify(menu.rows.map((r) => r.name))}`);
  const clicked = await evaluate(cdp, `(() => {
    const m=document.getElementById('mlsToolsMenu');
    const r=[...m.querySelectorAll('.r')].find(x => ((x.querySelector('.rn')||{}).textContent||'').trim()===${JSON.stringify(rowName)});
    if(!r) return { ok:false };
    const s=getComputedStyle(r), rect=r.getBoundingClientRect();
    if(s.display==='none'||s.visibility==='hidden'||rect.width<1||rect.height<1) return { ok:false, reason:'row-not-visible', w:rect.width, h:rect.height };
    r.scrollIntoView({block:'center'}); r.click();
    return { ok:true, w:Math.round(rect.width), h:Math.round(rect.height) };
  })()`);
  assert(clicked && clicked.ok, `Could not press the Tools row "${rowName}": ${JSON.stringify(clicked)}`);
  return `#mlsDock [data-dest="tools"] > Tools > "${rowName}"`;
}

async function fill(cdp, selector, value) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${sel(selector)});
    if (!el) return { ok:false, reason:'missing' };
    el.focus({ preventScroll:true });
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:null }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true, value:el.value };
  })()`);
  assert(result && result.ok && result.value === value, `Could not fill ${selector}: ${JSON.stringify(result).slice(0, 400)}`);
}

async function selectValue(cdp, selector, value) {
  const result = await evaluate(cdp, `(() => {
    const el = document.querySelector(${sel(selector)});
    if (!el) return { ok:false, reason:'missing' };
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('change', { bubbles:true }));
    return { ok:true, value:el.value };
  })()`);
  assert(result && result.ok && result.value === value, `Could not select ${selector}=${value}: ${JSON.stringify(result)}`);
}

async function screenshot(cdp, file, timeoutMs = 20000) {
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, timeoutMs);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
  } catch (_) { /* a screenshot is evidence, never a gate */ }
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
  await sleep(400);
}

/* --------------------------------------------------------------------------
   THE MODEL STUB. Installed before any app script runs.
   -------------------------------------------------------------------------- */
const STUB_SOURCE = String.raw`(() => {
  if (window.__mlsAiStub) return;
  const AI_RX = /\/api\/complete|api\.openai\.com\/v1\/chat\/completions/;
  const stub = { calls: [], intercepted: 0, passthrough: 0, mode: 'echo' };
  window.__mlsAiStub = stub;
  window.__mlsAiStubReset = () => { stub.calls.length = 0; };
  window.__mlsAiStubMode = (m) => { stub.mode = m; return stub.mode; };

  const origFetch = window.fetch.bind(window);

  const snake = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  /* Facts the prompt itself DECLARES, keyed snake_case. A compliant model fills
     a slot that names one of these from the declared value; anything else gets
     an obviously synthetic marker. */
  function declaredFacts(head) {
    const map = {};
    const put = (k, v) => { k = snake(k); v = String(v == null ? '' : v).trim(); if (k && v && !(k in map)) map[k] = v; };
    String(head == null ? '' : head).split(/\r?\n/).forEach((line) => {
      const m = String(line).match(/^\s*-?\s*([A-Za-z][A-Za-z \/-]{1,44}):\s*(.+?)\s*$/);
      if (m) put(m[1], m[2]);
    });
    const alias = [
      ['patient_name', 'patient'], ['name', 'patient'], ['patient', 'name'],
      ['date_of_procedure', 'date_of_operation'], ['date_of_operation', 'date_of_procedure'],
      ['date_of_procedure', 'date_of_service'], ['dob', 'date_of_birth'], ['date_of_birth', 'dob'],
      ['patient_dob', 'date_of_birth'], ['sex', 'gender'], ['gender', 'sex'],
      ['provider', 'operating_provider'], ['provider_name', 'operating_provider'],
      ['surgeon', 'operating_provider'], ['physician', 'operating_provider']
    ];
    alias.forEach(([want, from]) => { if (!(want in map) && map[from]) map[want] = map[from]; });
    return map;
  }

  const TEMPLATE_MARK = /(?:^|\n)SELECTED TEMPLATE[^\n]*\n/g;
  const TEMPLATE_END = /\n\n(?:DRAFT TO REPAIR:|ORIGINAL PATIENT\/PROCEDURE CONTEXT:)/;
  const DIRECTIVE_MARK = '[MLS QUALITY DIRECTIVE]';

  function splitPrompt(user) {
    const u = String(user == null ? '' : user);
    let at = -1, m;
    TEMPLATE_MARK.lastIndex = 0;
    while ((m = TEMPLATE_MARK.exec(u)) !== null) at = m.index + m[0].length;
    if (at < 0) return null;
    let tail = u.slice(at);
    const end = tail.match(TEMPLATE_END);
    if (end) tail = tail.slice(0, end.index);
    const raw = tail;
    /* feat_opnote_quality appends its instruction paragraph to EVERY matching
       string argument of aiCallRaw, including the USER message - so it lands
       inside the region the prompt itself labels "SELECTED TEMPLATE - COPY ITS
       STRUCTURE AND FIXED WORDING". A compliant model reads that as an
       instruction, not as template content, so this stub does the same and
       stops echoing at the marker. The fact that it is there at all is
       recorded and asserted separately (step 5d). */
    const directiveAt = tail.indexOf(DIRECTIVE_MARK);
    if (directiveAt >= 0) tail = tail.slice(0, directiveAt);
    return { head: u.slice(0, at), template: tail.replace(/\s+$/, ''), rawRegion: raw, directiveInTemplateRegion: directiveAt >= 0 };
  }

  function buildNote(user) {
    const parts = splitPrompt(user);
    if (!parts) return null;
    const facts = declaredFacts(parts.head);
    const filled = [];
    let note = parts.template.replace(/\[\[([^\]\n]+)\]\]/g, (all, rawKey) => {
      const key = snake(rawKey);
      const value = facts[key] || ('SYNTHETIC-' + key.toUpperCase().replace(/_/g, '-') + '-VALUE');
      filled.push({ key, fromPrompt: !!facts[key], value });
      return value;
    });
    /* NEGATIVE CONTROL. A model that ignores the template: one heading renamed,
       one fixed-wording line deleted, one slot left as literal syntax. Nothing
       shaped like this may ever land in a doctor's row. */
    if (stub.mode === 'mangle') {
      note = note
        .split(/\r?\n/)
        .filter((line) => line.indexOf('ANESTHESIA:') !== 0)
        .map((line) => (line.indexOf('IMAGING GUIDANCE:') === 0 ? 'RADIOLOGY NOTES: [[imaging_modality]]' : line))
        .join('\n');
    }
    return {
      note,
      filled,
      templateChars: parts.template.length,
      mangled: stub.mode === 'mangle',
      directiveInTemplateRegion: parts.directiveInTemplateRegion,
      templateRegionTail: parts.rawRegion.slice(-900)
    };
  }

  function payloadFor(url, body) {
    let system = '', user = '', shape = '';
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed && Array.isArray(parsed.messages)) {
        shape = 'openai';
        parsed.messages.forEach((msg) => {
          if (msg && msg.role === 'system') system = String(msg.content || '');
          if (msg && msg.role === 'user') user = String(msg.content || '');
        });
      } else if (parsed && (parsed.system != null || parsed.user != null)) {
        shape = 'complete';
        system = String(parsed.system || '');
        user = String(parsed.user || '');
      } else {
        shape = 'unknown';
      }
    } catch (e) { shape = 'unparsed'; }
    return { system, user, shape };
  }

  function respond(shape, content) {
    const body = (shape === 'openai')
      ? JSON.stringify({ choices: [{ message: { content } }] })
      : JSON.stringify({ content });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  window.fetch = function (input, init) {
    let url = '';
    try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) { url = ''; }
    if (!AI_RX.test(String(url))) { stub.passthrough++; return origFetch(input, init); }
    let body = '';
    try { body = (init && init.body) ? String(init.body) : ''; } catch (e) { body = ''; }
    const parsed = payloadFor(url, body);
    const built = buildNote(parsed.user);
    const record = {
      at: Date.now(),
      url: String(url),
      shape: parsed.shape,
      system: parsed.system,
      user: parsed.user,
      phase: /repair the draft/i.test(parsed.system) ? 'repair' : 'initial',
      isOpNote: !!built,
      filled: built ? built.filled : [],
      templateChars: built ? built.templateChars : 0,
      directiveInTemplateRegion: built ? built.directiveInTemplateRegion : false,
      directiveInSystem: parsed.system.indexOf(DIRECTIVE_MARK) >= 0,
      templateRegionTail: built ? built.templateRegionTail : ''
    };
    stub.calls.push(record);
    stub.intercepted++;
    if (!built) {
      /* Not an op-note prompt (e.g. the keyword back-filler). Answer with an
         empty JSON array so nothing downstream mutates a template. */
      return Promise.resolve(respond(parsed.shape, '[]'));
    }
    record.reply = built.note;
    return Promise.resolve(respond(parsed.shape, JSON.stringify({ note: built.note, missing: [] })));
  };
})();`;

/* --------------------------------------------------------------------------
   Result bookkeeping
   -------------------------------------------------------------------------- */
const RESULTS = [];
const DEFECTS = [];
function record(step, verdict, evidence) {
  RESULTS.push({ step, verdict, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
  process.stdout.write(`[${verdict}] ${step}\n        ${typeof evidence === 'string' ? evidence : JSON.stringify(evidence)}\n`);
}
function defect(severity, claim, evidence) {
  DEFECTS.push({ severity, claim, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence) });
}

/* --------------------------------------------------------------------------
   Note analysis - our OWN checks, not the app's gates.
   -------------------------------------------------------------------------- */
const ATTEST_MARK = 'PROVIDER & FACILITY (MLS op-note prep)';

function templateBodyOf(note) {
  const s = String(note || '');
  const at = s.indexOf(ATTEST_MARK);
  if (at < 0) return { body: s, footer: '' };
  const cut = s.lastIndexOf('\n', at);
  return { body: s.slice(0, cut < 0 ? at : cut), footer: s.slice(cut < 0 ? at : cut) };
}

function headingOrderReport(note) {
  const { body } = templateBodyOf(note);
  const lines = body.split(/\r?\n/);
  const positions = TEMPLATE_HEADINGS.map((heading) => {
    const index = lines.findIndex((line) => line.trim().toUpperCase().startsWith(heading.toUpperCase()));
    return { heading, line: index };
  });
  const missing = positions.filter((entry) => entry.line < 0).map((entry) => entry.heading);
  let outOfOrder = [];
  let previous = -1;
  positions.forEach((entry) => {
    if (entry.line < 0) return;
    if (entry.line <= previous) outOfOrder.push(entry.heading);
    previous = entry.line;
  });
  return { missing, outOfOrder, positions, ok: !missing.length && !outOfOrder.length };
}

function leftoverSlots(note) {
  const { body } = templateBodyOf(note);
  const out = [];
  const push = (rx) => { let m; const r = new RegExp(rx.source, rx.flags); while ((m = r.exec(body)) !== null) out.push(m[0]); };
  push(/\[\[[^\]\n]+\]\]/g);
  push(/\[FILL\s*:?[^\]\n]*\]/gi);
  push(/\{\{[^}\n]+\}\}/g);
  push(/(^|[^_])_{3,}(?!_)/g);
  return out;
}

/* --------------------------------------------------------------------------
   Steps
   -------------------------------------------------------------------------- */
async function uploadTemplateThroughUi(cdp, artifactDir) {
  /* Get into the op-note room, whose Templates tab is the door the doctor uses. */
  const opened = { used: await openViaTools(cdp, 'Prep op notes') };
  await waitFor(cdp, 'the op-note room', `(() => {
    const m=document.getElementById('opPrepModal');
    return !!(m && m.classList.contains('show')) ? { classes:m.className } : false;
  })()`, 20000);

  const tabs = await clickFirstVisible(cdp, ['#oprTabTpls', '#templatesBtn', 'button[onclick="openTemplates()"]'], 'the Templates tab');
  await waitFor(cdp, 'the Templates surface', `(() => {
    const m=document.getElementById('templatesModal'), n=document.getElementById('tplName');
    if(!m||!n) return false;
    const s=getComputedStyle(n), r=n.getBoundingClientRect();
    return (s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0) ? { shown:m.classList.contains('show'), w:Math.round(r.width) } : false;
  })()`, 20000);

  await fill(cdp, '#tplName', TEMPLATE_NAME);
  await fill(cdp, '#tplKeywords', TEMPLATE_KEYWORDS);
  await fill(cdp, '#tplText', TEMPLATE_TEXT);
  await screenshot(cdp, path.join(artifactDir, '02-template-form-filled.png'));
  await click(cdp, '#templatesModal button[onclick="saveTemplateFromForm()"]');

  const saved = await waitFor(cdp, 'the uploaded template in the library', `(() => {
    const list=(typeof getTemplates==='function') ? (getTemplates()||[]) : [];
    const t=list.find(x => x && x.name===${JSON.stringify(TEMPLATE_NAME)});
    if(!t) return false;
    const rows=[...document.querySelectorAll('#tplList div[role="option"]')];
    const row=rows.find(r => (r.textContent||'').indexOf(${JSON.stringify(TEMPLATE_NAME)})>=0);
    const rect=row?row.getBoundingClientRect():null;
    const style=row?getComputedStyle(row):null;
    return {
      id:String(t.id||''),
      textMatches: String(t.text||'')===${JSON.stringify(TEMPLATE_TEXT)},
      textChars: String(t.text||'').length,
      keywords: Array.isArray(t.keywords) ? t.keywords.slice() : t.keywords,
      libraryCount: list.length,
      rowFound: !!row,
      rowVisible: !!(row && rect && rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden'),
      rowText: row ? (row.textContent||'').replace(/\s+/g,' ').trim().slice(0,120) : ''
    };
  })()`, 20000);

  assert(saved.id, 'the saved template has no id');
  assert(saved.textMatches, `the library stored different text than was typed (${saved.textChars} chars)`);
  assert(saved.rowFound && saved.rowVisible, `the saved template has no visible row in #tplList: ${JSON.stringify(saved)}`);
  assert(Array.isArray(saved.keywords) && saved.keywords.length >= 2, `keywords did not round-trip as an array: ${JSON.stringify(saved.keywords)}`);
  return { saved, opened: opened.used, tabs: tabs.used };
}

async function draftOnce(cdp, label, allowRefusal) {
  const before = await evaluate(cdp, `(() => {
    const r=(window._opPrep||[])[0];
    return r ? { seq: r._genSeq||0 } : { seq:-1 };
  })()`, { userGesture: false });
  assert(before.seq >= 0, 'there is no op-note row to draft');
  await evaluate(cdp, 'window.__mlsAiStubReset && window.__mlsAiStubReset(); true', { userGesture: false });

  await click(cdp, '#opPrepList button[onclick="opPrepGenerateOne(0)"]');
  /* b392 guard: a draft the doctor (or a Fields-box write) has touched needs a
     second, explicit press. Honour it rather than reaching past it. */
  await sleep(250);
  const armed = await evaluate(cdp, `(() => { const r=(window._opPrep||[])[0]; return !!(r && r._confirmRedraft); })()`, { userGesture: false });
  if (armed) {
    await click(cdp, '#opPrepList button[onclick="opPrepGenerateOne(0)"]');
  }

  const outcome = await waitFor(cdp, `the ${label} draft to land`, `(() => {
    const r=(window._opPrep||[])[0];
    if(!r) return { failed:true, why:'row disappeared' };
    if((r._genSeq||0) > ${before.seq}) return { ok:true, seq:r._genSeq, chars:String(r.note||'').length, modeUsed:String(r.tplModeUsed||''), tplId:String(r.tplId||''), gen:!!r.gen };
    const why=String(window.__mlsLastOpFidelityError||'').trim();
    if(why) return { failed:true, why:why.slice(0,400), code:String(window.__mlsLastOpErrorCode||'') };
    return false;
  })()`, 180000);

  if (outcome.failed) {
    const calls = await evaluate(cdp, `(() => (window.__mlsAiStub.calls||[]).map(c => ({phase:c.phase, isOpNote:c.isOpNote, sysChars:c.system.length, replyChars:(c.reply||'').length})))()`, { userGesture: false });
    if (allowRefusal) {
      const raw = await evaluate(cdp, `(() => { const c=(window.__mlsAiStub.calls||[]).filter(x=>x.isOpNote); return c.length ? String(c[0].reply||'') : ''; })()`, { userGesture: false });
      const rowNote = await evaluate(cdp, `(() => { const r=(window._opPrep||[])[0]; return { note:String(r.note||''), seq:r._genSeq||0, gen:!!r.gen }; })()`, { userGesture: false });
      return { refused: true, why: outcome.why, code: outcome.code || '', calls, rawReply: raw, rowNote };
    }
    throw new Error(`${label}: the app refused to draft - ${outcome.why} (code=${outcome.code || 'none'}; stub calls=${JSON.stringify(calls)})`);
  }

  const detail = await evaluate(cdp, `(() => {
    const r=(window._opPrep||[])[0];
    const box=document.getElementById('opPrepNote_0');
    const calls=(window.__mlsAiStub.calls||[]);
    const initial=calls.find(c => c.isOpNote && c.phase==='initial') || null;
    const receipt=document.getElementById('oprReceipt');
    const usedEl=receipt ? receipt.querySelector('.opr-usedstyle b') : null;
    return {
      note: String(r.note||''),
      noteChars: String(r.note||'').length,
      rowGen: !!r.gen,
      rowTplId: String(r.tplId||''),
      rowTplManual: !!r.tplManual,
      missingKeys: (r.missing||[]).map(m => String((m&&m.key)||'')),
      blankKeys: (typeof window.opNoteBlankTokens==='function') ? window.opNoteBlankTokens(String(r.note||'')).map(t => String(t.key||'')) : null,
      modeUsed: String(r.tplModeUsed||''),
      textareaFound: !!box,
      textareaMatchesRow: !!box && box.value===String(r.note||''),
      textareaChars: box ? box.value.length : -1,
      receiptStyle: usedEl ? (usedEl.textContent||'').trim() : '',
      opNoteCalls: calls.filter(c => c.isOpNote).length,
      repairCalls: calls.filter(c => c.isOpNote && c.phase==='repair').length,
      system: initial ? initial.system : '',
      filled: initial ? initial.filled : [],
      rawReply: initial ? String(initial.reply||'') : '',
      templateChars: initial ? initial.templateChars : 0,
      directiveInTemplateRegion: initial ? !!initial.directiveInTemplateRegion : null,
      directiveInSystem: initial ? !!initial.directiveInSystem : null,
      templateRegionTail: initial ? String(initial.templateRegionTail||'') : ''
    };
  })()`, { userGesture: false, timeoutMs: 30000 });

  return detail;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }

  const chromePath = findChrome(args.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(ROOT, args.artifacts || path.join('tests', 'live-template-lifecycle-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-tpl-lifecycle-profile-'));
  const { server, origin } = await startStaticServer();
  const appUrl = `${origin}/ScribeFlow.html?demo=1&tplLifecycle=${encodeURIComponent(stamp)}&classic=1&mlseasy=classic&easyone=0`;

  let chrome, cdp;
  const externalRequests = [];
  const consoleErrors = [];
  const pageExceptions = [];
  const progress = (message) => process.stdout.write(`[live] ${message}\n`);

  try {
    progress('launching isolated Chrome + local no-store server');
    chrome = await launchChrome(chromePath, profileDir, args.headed);
    cdp = await createPage(chrome.port, 'about:blank');

    cdp.on('Runtime.exceptionThrown', (event) => {
      const detail = event.exceptionDetails || {};
      pageExceptions.push({
        text: String(detail.text || ''),
        description: String((detail.exception && detail.exception.description) || '').slice(0, 400),
        url: detail.url || ''
      });
    });
    cdp.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'error') return;
      const text = (event.args || []).map((a) => String(a.value != null ? a.value : (a.description || a.type || ''))).join(' ');
      consoleErrors.push(text.slice(0, 400));
    });
    cdp.on('Network.requestWillBeSent', (event) => {
      try {
        const url = new URL(event.request.url);
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
          externalRequests.push({ url: url.href, method: event.request.method });
        }
      } catch (_) {}
    });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB_SOURCE });

    /* ---- STEP 1: synthetic signup / login ---- */
    await cdp.send('Page.navigate', { url: appUrl });
    await waitFor(cdp, 'initial local-demo auth screen', `document.readyState==='complete' && !!document.getElementById('authScreen')`, 30000);
    await evaluate(cdp, `localStorage.clear();sessionStorage.clear();localStorage.setItem('mls.easyV2.enabled','0');localStorage.setItem('mls.easyOne.enabled','0');location.href=${JSON.stringify(appUrl)};true`);
    await waitFor(cdp, 'clean local-demo auth screen', `document.readyState==='complete' && !!document.getElementById('tabSignup')`, 30000);
    await click(cdp, '#tabSignup');
    await waitFor(cdp, 'the synthetic signup fields', `(() => {
      const f=document.getElementById('authSignupAssentFields');
      return !!(f && !f.disabled && document.getElementById('authTermsAssent') && document.getElementById('authPracticeAuthority'));
    })()`, 15000);
    await fill(cdp, '#authEmail', SYNTHETIC_EMAIL);
    await fill(cdp, '#authPass', SYNTHETIC_PASSWORD);
    await fill(cdp, '#authPass2', SYNTHETIC_PASSWORD);
    await click(cdp, '#authTermsAssent');
    await click(cdp, '#authPracticeAuthority');
    await waitFor(cdp, 'the enabled signup button', `document.getElementById('authTermsAssent').checked&&document.getElementById('authPracticeAuthority').checked&&!document.getElementById('authBtn').disabled`);
    await click(cdp, '#authBtn');
    await waitFor(cdp, 'the signed-in app', `document.getElementById('appScreen') && getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 40000);
    await settleUi(cdp);

    const stubAlive = await evaluate(cdp, `(() => ({ installed: !!window.__mlsAiStub, fetchPatched: String(window.fetch).indexOf('__mlsAiStub')<0 ? 'wrapped' : 'raw', passthrough: window.__mlsAiStub ? window.__mlsAiStub.passthrough : -1 }))()`, { userGesture: false });
    assert(stubAlive.installed, 'the deterministic model stub did not survive boot');
    const demo = await evaluate(cdp, `(() => ({ demo: /(?:^|[?&])demo=1/.test(location.search), backend: (typeof backendMode==='function') ? backendMode() : null }))()`, { userGesture: false });
    assert(demo.demo === true && demo.backend === false, `not in isolated demo mode: ${JSON.stringify(demo)}`);
    record('1. synthetic signup + login on an isolated origin', 'PASS', `demo=1, backendMode=false, model stub installed (${stubAlive.passthrough} non-AI fetches passed through)`);
    await screenshot(cdp, path.join(artifactDir, '01-signed-in.png'));

    /* the op-note modules are idle-deferred; every later step needs them */
    const modules = await waitFor(cdp, 'the op-note room + integrity owners', `(() => {
      const room=window.__mlsOpNoteRoom, oni=window.__mlsOpNoteIntegrity;
      if(!(room&&room.installed&&oni&&oni.installed)) return false;
      return { room:room.version, integrity:oni.version, fill: !!(window.__mlsOpNoteFill&&window.__mlsOpNoteFill.installed), prep: !!(window.__mlsOpNotePrep&&window.__mlsOpNotePrep.installed) };
    })()`, 60000);
    progress(`op-note owners ready: ${JSON.stringify(modules)}`);

    /* ---- STEP 2: upload a template through the real UI ---- */
    const upload = await uploadTemplateThroughUi(cdp, artifactDir);
    const templateId = upload.saved.id;
    record('2. upload a template through the real Templates UI', 'PASS',
      `opened via ${upload.opened} -> ${upload.tabs}; saved id=${templateId}; text round-tripped byte-for-byte (${upload.saved.textChars} chars); keywords=${JSON.stringify(upload.saved.keywords)}; visible library row present; library now holds ${upload.saved.libraryCount} templates`);
    await screenshot(cdp, path.join(artifactDir, '03-template-saved.png'));

    /* back to Procedures, then out of the room to create the patient */
    await click(cdp, '#oprTabProcs');
    await evaluate(cdp, `(() => { if(typeof closeOpPrep==='function') closeOpPrep(); return true; })()`);
    await sleep(300);

    /* ---- STEP 3: synthetic patient + a matching procedure ---- */
    await click(cdp, '#mlsDock button[data-dest="patient"]');
    await waitFor(cdp, 'the Patients route', `window.__mlsCurrentView==='patients'`);
    await click(cdp, '#ptNewBtn');
    await waitFor(cdp, 'the New patient dialog', `document.getElementById('patientModal') && document.getElementById('patientModal').classList.contains('show')`);
    await fill(cdp, '#ptName', SYNTHETIC_PATIENT.name);
    await fill(cdp, '#ptMrn', SYNTHETIC_PATIENT.mrn);
    await fill(cdp, '#ptDob', SYNTHETIC_PATIENT.dob);
    await selectValue(cdp, '#ptSex', SYNTHETIC_PATIENT.sex);
    await click(cdp, '#patientModal button[onclick="savePatient()"]');
    const patient = await waitFor(cdp, 'the saved synthetic patient', `(() => {
      const p=window.activePatient && window.activePatient();
      return (p && p.name===${JSON.stringify(SYNTHETIC_PATIENT.name)} && p.mrn===${JSON.stringify(SYNTHETIC_PATIENT.mrn)}) ? { id:String(p.id||''), dob:String(p.dob||''), sex:String(p.sex||p.gender||'') } : false;
    })()`, 20000);

    await openViaTools(cdp, 'Prep op notes');
    await waitFor(cdp, 'a single-patient op-note row', `(() => {
      const m=document.getElementById('opPrepModal');
      const rows=window._opPrep||[];
      return (m && m.classList.contains('show') && rows.length===1 && document.getElementById('opPrepProc_0')) ? { rows:rows.length, mode:window._opPrepMode } : false;
    })()`, 25000);

    const beforeProcedure = await evaluate(cdp, `(() => {
      const r=(window._opPrep||[])[0];
      return { tplId:String(r.tplId||''), tplManual:!!r.tplManual, proc:String(r.proc||''), source:String(r.tplMatchSource||'') };
    })()`, { userGesture: false });

    await fill(cdp, '#opPrepProc_0', SYNTHETIC_PROCEDURE);
    await sleep(250);
    record('3. synthetic patient + a procedure the template can match', 'PASS',
      `patient id=${patient.id} (synthetic, dob=${patient.dob}); one op-note row; procedure typed into the real #opPrepProc_0 field: "${SYNTHETIC_PROCEDURE}"; row template before typing was ${JSON.stringify(beforeProcedure)}`);

    /* ---- STEP 4a: the auto-picker, with no manual pick ---- */
    const auto = await evaluate(cdp, `(() => {
      const r=(window._opPrep||[])[0];
      const selEl=document.getElementById('opPrepTpl_0');
      const badge=selEl && selEl.parentElement ? selEl.parentElement.querySelector('span.mini span') : null;
      const match=(window.__mlsOpNoteIntegrity && window.__mlsOpNoteIntegrity.bestFor)
        ? window.__mlsOpNoteIntegrity.bestFor(r.appt.name, r.proc, r.appt.dob, r.patientId) : null;
      return {
        tplId:String(r.tplId||''), tplManual:!!r.tplManual, source:String(r.tplMatchSource||''), reason:String(r.tplMatchReason||''),
        selectValue: selEl ? String(selEl.value||'') : null,
        badge: badge ? (badge.textContent||'').trim() : '',
        matcherSaid: match,
        classOfProcedure: window.__mlsOpNoteIntegrity.classify(r.proc)
      };
    })()`, { userGesture: false });

    assert.strictEqual(auto.tplManual, false, `the auto-pick assertion is invalid - the row was already manual: ${JSON.stringify(auto)}`);
    assert.strictEqual(auto.tplId, templateId, `the auto-picker did not resolve to the uploaded template: ${JSON.stringify(auto)}`);
    assert.strictEqual(auto.selectValue, templateId, `the visible template picker does not show the auto-matched template: ${JSON.stringify(auto)}`);
    assert(/matched from procedure/i.test(auto.badge), `the visible badge does not say the template was auto-matched: ${JSON.stringify(auto)}`);
    record('4a. AUTO-PICKER: no manual pick, row resolves to the uploaded template', 'PASS',
      `procedure classified as "${auto.classOfProcedure}"; row.tplId=${auto.tplId} (=uploaded), tplManual=false, source="${auto.source}" (${auto.reason}); visible picker shows it; badge reads "${auto.badge}"`);

    /* ---- STEP 4b: a manual pick beats the auto-match, and sticks ---- */
    const otherTemplate = await evaluate(cdp, `(() => {
      const list=(getTemplates()||[]).filter(t => t && String(t.id)!==${JSON.stringify(templateId)});
      const t=list[0];
      return t ? { id:String(t.id), name:String(t.name||'') } : null;
    })()`, { userGesture: false });
    assert(otherTemplate, 'no second template exists, so "manual beats auto" cannot be proven');

    await click(cdp, `#oprTplRail .opr-tpl-item[data-tpl-id="${otherTemplate.id}"]`);
    await sleep(200);
    const manual = await evaluate(cdp, `(() => {
      const r=(window._opPrep||[])[0];
      const selEl=document.getElementById('opPrepTpl_0');
      return { tplId:String(r.tplId||''), tplManual:!!r.tplManual, source:String(r.tplMatchSource||''), selectValue: selEl?String(selEl.value||''):null };
    })()`, { userGesture: false });
    assert.strictEqual(manual.tplManual, true, `clicking a template in the rail did not record a manual pick: ${JSON.stringify(manual)}`);
    assert.strictEqual(manual.tplId, otherTemplate.id, `the manual pick did not take: ${JSON.stringify(manual)}`);

    /* the app's own re-render path - the seam where an auto-matcher would take it back */
    await evaluate(cdp, `(() => { window.opPrepRender(); return true; })()`);
    await sleep(250);
    const afterRender = await evaluate(cdp, `(() => {
      const r=(window._opPrep||[])[0];
      const selEl=document.getElementById('opPrepTpl_0');
      const badge=selEl && selEl.parentElement ? selEl.parentElement.querySelector('span.mini span') : null;
      const railOn=[...document.querySelectorAll('#oprTplRail .opr-tpl-item')].filter(b => b.getAttribute('aria-pressed')==='true').map(b => b.getAttribute('data-tpl-id'));
      return { tplId:String(r.tplId||''), tplManual:!!r.tplManual, selectValue: selEl?String(selEl.value||''):null, badge: badge?(badge.textContent||'').trim():'', railPressed:railOn };
    })()`, { userGesture: false });
    assert.strictEqual(afterRender.tplManual, true, `the manual pick evaporated across a re-render: ${JSON.stringify(afterRender)}`);
    assert.strictEqual(afterRender.tplId, otherTemplate.id, `the auto-matcher took the row back after a re-render: ${JSON.stringify(afterRender)}`);
    assert.deepStrictEqual(afterRender.railPressed, [otherTemplate.id], `the rail does not mark the manually picked template as in use: ${JSON.stringify(afterRender)}`);
    record('4b. MANUAL PICK beats the auto-match and survives a re-render', 'PASS',
      `clicked "${otherTemplate.name}" in the left rail -> tplManual=true, tplId=${manual.tplId}; after window.opPrepRender() it is still ${afterRender.tplId} with aria-pressed on that rail item and badge "${afterRender.badge}"`);

    /* ---- STEP 4c: A KEYWORD, AND ONLY A KEYWORD, CAN WIN THE MATCH ----
       The owner asked to "allow you to set key words (optional) in the
       templates for auto matching, MAKE IT EASY AND NOT NESSASARRY". The field
       exists and round-trips (step 2 proves that), but round-tripping is not
       the feature - the feature is that a word a doctor typed ONLY into the
       keywords box changes which template gets picked. Nothing above tested
       that: step 4a matches on words the template NAME already contains, so it
       would pass with keyword scoring deleted entirely.
       This writes a nonsense token no template name or body can contain, saves
       it as a keyword on the SECOND template through the app's own detail
       editor, then types that token as the procedure and asks the matcher. */
    const KW = 'zzsynthkw' + String(templateId).replace(/[^a-z0-9]/gi, '').slice(-6);
    const kwSaved = await evaluate(cdp, `(() => {
      const list = getTemplates() || [];
      const t = list.find(x => x && String(x.id) === ${JSON.stringify(otherTemplate.id)});
      if (!t) return { ok:false, why:'the second template vanished' };
      /* through the real editor: select it, type into #tplDetKw, press Save */
      if (typeof tplSelect === 'function') tplSelect(t.id);
      return { ok:true, selected:String(t.id) };
    })()`, { userGesture: false });
    assert(kwSaved && kwSaved.ok, `could not select the template to give it a keyword: ${JSON.stringify(kwSaved)}`);
    await sleep(250);
    const kwWritten = await evaluate(cdp, `(() => {
      const box = document.getElementById('tplDetKw');
      if (!box) return { ok:false, why:'the keywords editor is not on screen' };
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      proto.set.call(box, ${JSON.stringify(KW)});
      box.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText' }));
      if (typeof tplDetailSave !== 'function') return { ok:false, why:'tplDetailSave is gone' };
      tplDetailSave();
      const after = (getTemplates() || []).find(x => x && String(x.id) === ${JSON.stringify(otherTemplate.id)});
      return { ok:true, stored: after ? (after.keywords || []) : null };
    })()`, { userGesture: false });
    assert(kwWritten && kwWritten.ok, `could not save a keyword through the app's own editor: ${JSON.stringify(kwWritten)}`);
    assert(Array.isArray(kwWritten.stored) && kwWritten.stored.indexOf(KW) >= 0,
      `the keyword did not persist through the detail editor: ${JSON.stringify(kwWritten)}`);

    const kwMatch = await evaluate(cdp, `(() => {
      const rank = window._opRankTemplates(${JSON.stringify(KW)});
      const top = rank && rank[0];
      /* prove the token really is unique to the keywords field */
      const leaks = (getTemplates() || []).filter(t => t &&
        (String(t.name||'') + ' ' + String(t.text||'')).toLowerCase().indexOf(${JSON.stringify(KW)}) >= 0).length;
      return { topId: top && top.tpl ? String(top.tpl.id) : '', topScore: top ? top.score : null, leaks };
    })()`, { userGesture: false });
    assert.strictEqual(kwMatch.leaks, 0, `the probe token appears outside the keywords field, so this proves nothing: ${JSON.stringify(kwMatch)}`);
    assert.strictEqual(kwMatch.topId, otherTemplate.id, `a keyword-only term did not win the match: ${JSON.stringify(kwMatch)}`);
    assert(kwMatch.topScore > 0, `the keyword match scored zero, i.e. it was a fallback rather than a match: ${JSON.stringify(kwMatch)}`);
    record('4c. KEYWORDS: a term typed only into the optional keywords box wins the match', 'PASS',
      `wrote "${KW}" into #tplDetKw on "${otherTemplate.name}" and pressed the real Save; stored as ${JSON.stringify(kwWritten.stored)}; ` +
      `the token appears in 0 template names or bodies; _opRankTemplates("${KW}") ranks that template first with score ${kwMatch.topScore}`);

    /* ---- STEP 4d: NO CONFIDENT MATCH DOES NOT MEAN NO TEMPLATE ----
       Verbatim: "fix up the auto match system where it doesnt give up if it
       cant find a match and just warns the user but finds the closet option".
       The old behaviour returned tplId:'' and left the doctor to hunt the
       dropdown.

       The procedure below is the owner's actual case, not a nonsense string: it
       names a real, specific operation whose terms DO land on a template
       (levels, laterality, approach) without ever reaching the confidence
       margin. That is what "can't find a match" means at the keyboard.
       Pure noise is a different case and is asserted separately in 4e - a row
       with no procedure signal at all has nothing to be close TO, and guessing
       there would attach an operative template to a routine follow-up. */
    /* WHICH string is a near miss depends on the library, so the harness finds
       one instead of asserting a guess about it. The list is fixed in source
       (no drift); the search only decides which of these this particular
       library cannot resolve confidently. Requiring score > 0 AND
       confident === false is the definition of a near miss, and the run records
       which string qualified so the evidence names itself. */
    const NEAR_MISS_CANDIDATES = [
      'Lumbar paraspinal injection under ultrasound guidance',
      'Bilateral paraspinal injection, levels to be determined',
      'Lumbar injection for myofascial pain',
      'Paraspinal muscle injection'
    ];
    const nearPick = await evaluate(cdp, `(() => {
      const api = window.__mlsOpNoteIntegrity;
      return ${JSON.stringify(NEAR_MISS_CANDIDATES)}.map(s => {
        const d = api.best(s);
        return { s, confident: !!d.confident, score: d.score, hasCandidate: !!d.candidate,
                 noProcedure: !!d.noProcedure, multi: !!d.multi, conflicts: !!d.conflicts };
      });
    })()`, { userGesture: false });
    const near = (nearPick || []).find((x) => !x.confident && x.score > 0 && x.hasCandidate && !x.noProcedure && !x.multi && !x.conflicts);
    assert(near, `no candidate string is a near miss against this library, so 4d cannot be proven: ${JSON.stringify(nearPick)}`);
    const NEAR_MISS = near.s;

    const noMatch = await evaluate(cdp, `(() => {
      const api = window.__mlsOpNoteIntegrity;
      const direct = api.best(${JSON.stringify(NEAR_MISS)});
      const r = (window._opPrep || [])[0];
      const before = { tplId:String(r.tplId||''), guess: !!r._tplClosestGuess };
      /* drive the real button handler, not the ranker */
      r.tplManual = false;
      r.proc = ${JSON.stringify(NEAR_MISS)};
      window._opAutoTpl(0);
      const after = (window._opPrep || [])[0];
      return {
        confident: !!direct.confident, score: direct.score, hadCandidate: !!direct.candidate,
        before, afterTplId: String(after.tplId||''), afterGuess: !!after._tplClosestGuess,
        afterSource: String(after.tplMatchSource||'')
      };
    })()`, { userGesture: false });
    assert.strictEqual(noMatch.confident, false, `the near-miss probe matched confidently, so it proves nothing: ${JSON.stringify(noMatch)}`);
    assert(noMatch.score > 0, `the near-miss probe scored zero, i.e. it is noise rather than a near miss: ${JSON.stringify(noMatch)}`);
    assert(noMatch.afterTplId, `Match template gave up and left the row with no template: ${JSON.stringify(noMatch)}`);
    assert.strictEqual(noMatch.afterSource, 'closest', `the row was not recorded as a closest match: ${JSON.stringify(noMatch)}`);
    assert.strictEqual(noMatch.afterGuess, true, `the row was not flagged as a closest-guess, so nothing downstream can warn: ${JSON.stringify(noMatch)}`);
    record('4d. A NEAR MISS still lands on the closest template, flagged as a guess', 'PASS',
      `"${NEAR_MISS}" scored ${noMatch.score} against the library but never reached confidence; _opAutoTpl(0) still set ` +
      `tplId=${noMatch.afterTplId}, tplMatchSource="closest" and row._tplClosestGuess=true (the flag the draft ledger reads ` +
      `to warn, and the flag the card reads to show its amber "check this" line). It no longer refuses and leaves the row empty.`);

    /* ---- STEP 4e: THE TWO REFUSALS THAT MUST SURVIVE THE FALLBACK ----
       4d loosened the matcher on purpose, and this is the guard that keeps the
       loosening honest. feat_mls_opnote_integrity.js refuses to match in two
       cases that are NOT ambiguity and must never become a guess:

         "no procedure was performed" - attaching a procedure template to a
           visit that states none happened is fabricating an operation.
         a row naming TWO procedures - guessing is picking one operation over
           another by coin flip, which is worse than asking.

       If the closest-guess fallback ever swallows these, an op note gets
       written for surgery that did not happen, or for the wrong surgery. That
       is the most serious thing in this file, so it is asserted directly
       against the canonical matcher rather than inferred from the UI. */
    const refusals = await evaluate(cdp, `(() => {
      const api = window.__mlsOpNoteIntegrity;
      if (!api || typeof api.bestFor !== 'function') return { ok:false, why:'the canonical matcher is not exposed' };
      const none = api.bestFor('Synthetic Refusal Patient', 'No procedure was performed today; visit was consultation only.', '1970-01-01', '');
      const two  = api.bestFor('Synthetic Refusal Patient', 'TFESI vs medial branch block — decide at visit', '1970-01-01', '');
      const noise = api.bestFor('Synthetic Refusal Patient', 'Routine follow-up', '1970-01-01', '');
      const near  = api.bestFor('Synthetic Refusal Patient', ${JSON.stringify(NEAR_MISS)}, '1970-01-01', '');
      return { ok:true, none:{tplId:String(none.tplId||''), source:String(none.source||'')},
        two:{tplId:String(two.tplId||''), source:String(two.source||'')},
        noise:{tplId:String(noise.tplId||''), source:String(noise.source||''), facts:api.parseProcedureFacts('Routine follow-up')},
        nearFacts:api.parseProcedureFacts(${JSON.stringify(NEAR_MISS)}),
        near:{tplId:String(near.tplId||''), source:String(near.source||'')} };
    })()`, { userGesture: false });
    assert(refusals && refusals.ok, `could not reach the canonical matcher: ${JSON.stringify(refusals)}`);
    assert.strictEqual(refusals.none.tplId, '', `a visit stating NO procedure was given a procedure template: ${JSON.stringify(refusals)}`);
    assert.strictEqual(refusals.none.source, 'no-procedure', `the no-procedure refusal lost its reason: ${JSON.stringify(refusals)}`);
    assert.strictEqual(refusals.two.tplId, '', `a row naming two different procedures was auto-matched to one of them: ${JSON.stringify(refusals)}`);
    /* The third refusal is not a safety rule, it is an honesty rule: a row with
       no procedure signal has nothing to be CLOSE to, so rank[0] is whichever
       template sorts first, and calling that "the closest" would be a lie told
       on a visit with no operation in it. */
    assert.strictEqual(refusals.noise.tplId, '', `a routine follow-up with no procedure signal was given a procedure template: ${JSON.stringify(refusals)}`);
    /* Pin the DISCRIMINATOR too, not just the outcome. If procedureFacts ever
       starts returning a region for "Routine follow-up", the assertion above
       would fail with no clue why; this says which fact went missing. */
    assert.deepStrictEqual(
      { type: refusals.noise.facts.procedureType, region: refusals.noise.facts.region, side: refusals.noise.facts.side,
        levels: refusals.noise.facts.levelCount, approach: refusals.noise.facts.approach },
      { type: '', region: '', side: '', levels: 0, approach: '' },
      `"Routine follow-up" parsed a procedure fact, so the noise/near-miss discriminator no longer separates them: ${JSON.stringify(refusals)}`);
    assert(refusals.nearFacts.procedureType || refusals.nearFacts.region || refusals.nearFacts.side ||
      refusals.nearFacts.levelCount > 0 || refusals.nearFacts.approach,
      `the near miss parsed NO procedure fact, so it should not have been guessed either: ${JSON.stringify(refusals)}`);
    assert.strictEqual(refusals.near.source, 'closest', `a real near miss did not produce a closest guess, so 4d passed for the wrong reason: ${JSON.stringify(refusals)}`);
    record('4e. THE REFUSALS SURVIVE the closest-guess fallback', 'PASS',
      `"No procedure was performed" -> tplId:"" source:"${refusals.none.source}"; ` +
      `"TFESI vs medial branch block" -> tplId:"" source:"${refusals.two.source}"; ` +
      `"Routine follow-up" (no signal at all) -> tplId:"" source:"${refusals.noise.source}"; ` +
      `a real near miss -> source:"${refusals.near.source}" with a template. The fallback reaches near misses only.`);

    /* put the uploaded template back - also a manual pick, so drafting is deterministic */
    await evaluate(cdp, `(() => { const r=(window._opPrep||[])[0];
      r.proc=${JSON.stringify(SYNTHETIC_PROCEDURE)}; delete r._tplClosestGuess; window.opPrepRender(); return true; })()`, { userGesture: false });
    await sleep(200);
    await click(cdp, `#oprTplRail .opr-tpl-item[data-tpl-id="${templateId}"]`);
    await sleep(200);
    const restored = await evaluate(cdp, `(() => {
      const r=(window._opPrep||[])[0];
      return { tplId:String(r.tplId||''), tplManual:!!r.tplManual };
    })()`, { userGesture: false });
    assert.strictEqual(restored.tplId, templateId, `could not select the uploaded template back: ${JSON.stringify(restored)}`);
    await screenshot(cdp, path.join(artifactDir, '04-room-template-picked.png'));

    /* ---- STEP 5 + 6: draft in all three modes ---- */
    const modeResults = {};
    for (const mode of MODE_ORDER) {
      const modeBtn = `#oprTplMode [data-tplmode="${mode}"]`;
      const before = await visibility(cdp, modeBtn);
      assert(before.length && before[0].visible, `the "${MODE_LABEL[mode]}" control is not visible in the rail: ${JSON.stringify(before)}`);
      await click(cdp, modeBtn);
      await sleep(200);
      const stored = await evaluate(cdp, `(() => {
        const btn=document.querySelector(${sel(modeBtn)});
        return {
          stored: (typeof uns==='function') ? String(localStorage.getItem(uns('opNoteTemplateMode'))||'') : null,
          pressed: btn ? btn.getAttribute('aria-pressed') : null,
          onCount: document.querySelectorAll('#oprTplMode .opr-tplmode.on').length
        };
      })()`, { userGesture: false });
      assert.strictEqual(stored.stored, mode, `choosing "${MODE_LABEL[mode]}" did not persist the mode: ${JSON.stringify(stored)}`);
      assert.strictEqual(stored.pressed, 'true', `the "${MODE_LABEL[mode]}" control does not report itself pressed: ${JSON.stringify(stored)}`);

      const drafted = await draftOnce(cdp, MODE_LABEL[mode]);
      fs.writeFileSync(path.join(artifactDir, `note-${mode}.txt`), drafted.note, 'utf8');

      /* the manual pick still owns the row after the generator ran */
      assert.strictEqual(drafted.rowTplId, templateId, `drafting in "${MODE_LABEL[mode]}" changed the row's template to ${drafted.rowTplId}`);
      assert.strictEqual(drafted.rowTplManual, true, `drafting in "${MODE_LABEL[mode]}" handed the row back to the auto-matcher`);

      /* (a) a note actually landed in the row AND in the visible editor */
      assert(drafted.rowGen === true && drafted.noteChars > 0, `no note landed in the row for "${MODE_LABEL[mode]}": ${JSON.stringify({ gen: drafted.rowGen, chars: drafted.noteChars })}`);
      assert(drafted.textareaFound && drafted.textareaMatchesRow, `the drafted note is not in the visible editor for "${MODE_LABEL[mode]}": ${JSON.stringify({ found: drafted.textareaFound, chars: drafted.textareaChars, rowChars: drafted.noteChars })}`);

      /* (b) the SYSTEM PROMPT that actually went over the wire */
      assert(drafted.system && drafted.system.length > 200, `no system prompt was captured for "${MODE_LABEL[mode]}"`);
      const hasStrict = drafted.system.indexOf(MODE_CLAUSE.strict) >= 0;
      const hasGuide = drafted.system.indexOf(MODE_CLAUSE.guide) >= 0;
      if (mode === 'strict') {
        assert(hasStrict && !hasGuide, `"Follow it closely" did not send its clause (strict=${hasStrict}, guide=${hasGuide})`);
      } else if (mode === 'guide') {
        assert(hasGuide && !hasStrict, `"Use it as a guide" did not send its clause (strict=${hasStrict}, guide=${hasGuide})`);
      } else {
        assert(!hasStrict && !hasGuide, `"Adapt to the case" must send NEITHER clause, but strict=${hasStrict}, guide=${hasGuide}`);
      }

      /* the app's own record of which style produced this note */
      assert.strictEqual(drafted.modeUsed, mode, `row.tplModeUsed says "${drafted.modeUsed}" after drafting in "${mode}"`);
      assert.strictEqual(drafted.receiptStyle, MODE_LABEL[mode], `the "Style used" receipt above the editor reads "${drafted.receiptStyle}" instead of "${MODE_LABEL[mode]}"`);

      /* (c) the note still carries the template's headings in the template's order */
      const headingReport = headingOrderReport(drafted.note);
      assert(headingReport.ok, `"${MODE_LABEL[mode]}" lost template headings: missing=${JSON.stringify(headingReport.missing)}, out-of-order=${JSON.stringify(headingReport.outOfOrder)}`);

      /* no template slot passed through unfilled */
      const leftover = leftoverSlots(drafted.note);
      assert(leftover.length === 0, `"${MODE_LABEL[mode]}" left unfilled template syntax in the note: ${JSON.stringify(leftover.slice(0, 6))}`);

      /* the free slots really came back with the stub's synthetic values */
      const freeMissing = TEMPLATE_FREE_SLOTS.filter((key) => drafted.note.indexOf(`SYNTHETIC-${key.toUpperCase().replace(/_/g, '-')}-VALUE`) < 0);
      assert(freeMissing.length === 0, `"${MODE_LABEL[mode]}" dropped filled slot values from the note: ${JSON.stringify(freeMissing)}`);

      const fixedLine = 'ANESTHESIA: Local synthetic anesthetic only and no sedation was administered for this fixture case.';
      assert(drafted.note.indexOf(fixedLine) >= 0, `"${MODE_LABEL[mode]}" did not preserve the template's fixed wording line`);

      modeResults[mode] = {
        directiveInTemplateRegion: drafted.directiveInTemplateRegion,
        directiveInSystem: drafted.directiveInSystem,
        templateRegionTail: drafted.templateRegionTail,
        noteChars: drafted.noteChars,
        opNoteCalls: drafted.opNoteCalls,
        repairCalls: drafted.repairCalls,
        headings: headingReport.positions.length,
        filled: drafted.filled.length
      };

      if (drafted.repairCalls > 0) {
        defect('medium', `Drafting in "${MODE_LABEL[mode]}" needed a repair round trip even though the reply was a byte-exact echo of the template the app itself sent`,
          `${drafted.repairCalls} repair call(s) to /api/complete for one draft; the first-pass fidelity gate rejected an unmodified template echo`);
      }

      record(`5.${mode} DRAFT in "${MODE_LABEL[mode]}"`, 'PASS',
        `note landed (${drafted.noteChars} chars, editor matches row); system prompt clause check ok (strict=${hasStrict}, guide=${hasGuide}); row.tplModeUsed="${drafted.modeUsed}"; receipt reads "${drafted.receiptStyle}"; ${drafted.opNoteCalls} model call(s), ${drafted.repairCalls} repair; all ${TEMPLATE_HEADINGS.length} template headings present and in order; 0 unfilled slots`);
      await screenshot(cdp, path.join(artifactDir, `05-draft-${mode}.png`));
    }

    record('5. all three "How drafts follow your template" modes drafted a note', 'PASS',
      JSON.stringify(MODE_ORDER.reduce((acc, m) => { const r = modeResults[m]; acc[m] = { noteChars: r.noteChars, opNoteCalls: r.opNoteCalls, repairCalls: r.repairCalls, headings: r.headings, filled: r.filled }; return acc; }, {})));

    /* ---- STEP 5e: THE RE-DRAFT BUTTONS CONNECT TO THE RAIL ----
       OWNER, verbatim: "mane these buttons are so ugly pretty them up and amke
       srue they copnnect correclty to the buttons in the bottom left of this
       page". The buttons are the "Re-draft: <style>" chips that appear above the
       editor once a draft exists; the buttons in the bottom left are the three
       "How drafts follow your template" controls in the rail. He asked for two
       things and only one of them - the styling - can be seen in a screenshot.

       CONNECTED means three specific things, and all three are asserted here
       rather than inferred from the fact that redraftInStyle() calls
       tplModeSet(): the rail must move to the style the chip names, the STORED
       preference must move with it, and the note that comes back must actually
       have been drafted in that style (row.tplModeUsed is stamped by the
       generator itself, not by the button).

       The loop above left the row drafted in the last mode of MODE_ORDER, so the
       chips on screen offer the other two - which is exactly what this presses. */
    const redoOffered = await evaluate(cdp, `(() => {
      const wrap = document.querySelector('.opr-usedstyle');
      if (!wrap) return { ok:false, why:'no "Style used" receipt is on screen, so no re-draft chips exist' };
      const chips = [...wrap.querySelectorAll('[data-oprredo]')].map(b => {
        const s = getComputedStyle(b), r = b.getBoundingClientRect();
        return { mode: b.getAttribute('data-oprredo'), label: String(b.innerText||'').trim(),
                 visible: s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0,
                 size: [Math.round(r.width), Math.round(r.height)] };
      });
      return { ok:true, usedNow: String(((window._opPrep||[])[0]||{}).tplModeUsed||''), chips };
    })()`, { userGesture: false });
    assert(redoOffered.ok, `the re-draft chips are not reachable: ${JSON.stringify(redoOffered)}`);
    const liveChips = (redoOffered.chips || []).filter((c) => c.visible);
    assert.strictEqual(liveChips.length, 2,
      `a drafted note must offer the OTHER two styles as one-press re-drafts; found ${liveChips.length}: ${JSON.stringify(redoOffered)}`);
    assert(!liveChips.some((c) => c.mode === redoOffered.usedNow),
      `a re-draft chip offers the style the note is already in: ${JSON.stringify(redoOffered)}`);

    const target = liveChips[0];
    await evaluate(cdp, `(() => { const r=(window._opPrep||[])[0]; if(r) r.edited=false; return true; })()`, { userGesture: false });
    await click(cdp, `.opr-usedstyle [data-oprredo="${target.mode}"]`);
    await sleep(400);
    const afterRedo = await waitFor(cdp, `re-draft in "${MODE_LABEL[target.mode]}"`, `(() => {
      const r=(window._opPrep||[])[0];
      return !!(r && r.gen && String(r.tplModeUsed||'') === ${JSON.stringify(target.mode)});
    })()`, 60000).then(() => evaluate(cdp, `(() => {
      const r=(window._opPrep||[])[0];
      const btn=document.querySelector('#oprTplMode [data-tplmode=' + JSON.stringify(${JSON.stringify(target.mode)}) + ']');
      const receipt=document.querySelector('.opr-usedstyle b');
      return {
        modeUsed: String(r.tplModeUsed||''),
        stored: (typeof uns==='function') ? String(localStorage.getItem(uns('opNoteTemplateMode'))||'') : null,
        railPressed: btn ? btn.getAttribute('aria-pressed') : null,
        railOnCount: document.querySelectorAll('#oprTplMode .opr-tplmode.on').length,
        receipt: receipt ? String(receipt.textContent||'').trim() : '',
        noteChars: String(r.note||'').length
      };
    })()`, { userGesture: false }));

    assert.strictEqual(afterRedo.modeUsed, target.mode,
      `"${target.label}" did not produce a draft in that style: ${JSON.stringify(afterRedo)}`);
    assert.strictEqual(afterRedo.stored, target.mode,
      `"${target.label}" did not move the STORED preference, so the rail and the chip disagree: ${JSON.stringify(afterRedo)}`);
    assert.strictEqual(afterRedo.railPressed, 'true',
      `"${target.label}" did not move the bottom-left rail control to that style: ${JSON.stringify(afterRedo)}`);
    assert.strictEqual(afterRedo.railOnCount, 1,
      `the rail shows ${afterRedo.railOnCount} styles selected after a re-draft: ${JSON.stringify(afterRedo)}`);
    assert.strictEqual(afterRedo.receipt, MODE_LABEL[target.mode],
      `the "Style used" receipt reads "${afterRedo.receipt}" after re-drafting into "${MODE_LABEL[target.mode]}"`);
    assert(afterRedo.noteChars > 0, `the re-draft produced an empty note: ${JSON.stringify(afterRedo)}`);
    record('5e. RE-DRAFT chips connect to the bottom-left rail', 'PASS',
      `a drafted note offered exactly the other two styles (${liveChips.map((c) => `"${c.label}" ${c.size[0]}x${c.size[1]}`).join(', ')}); ` +
      `pressing "${target.label}" moved the stored preference to "${afterRedo.stored}", moved the rail control to aria-pressed=true ` +
      `with exactly one style lit, re-drafted the note (${afterRedo.noteChars} chars) with row.tplModeUsed="${afterRedo.modeUsed}" ` +
      `stamped by the generator, and the receipt now reads "${afterRedo.receipt}".`);

    /* ---- STEP 5d: PROMPT HYGIENE ----
       What the app labels "SELECTED TEMPLATE - COPY ITS STRUCTURE AND FIXED
       WORDING" must be the doctor's template and nothing else. This asserts on
       the bytes the stub saw on the wire, so no model behaviour is assumed. */
    const dirtyModes = MODE_ORDER.filter((m) => modeResults[m].directiveInTemplateRegion === true);
    if (dirtyModes.length) {
      const tail = String(modeResults[dirtyModes[0]].templateRegionTail || '');
      const directiveAt = tail.indexOf('[MLS QUALITY DIRECTIVE]');
      const excerpt = directiveAt >= 0 ? tail.slice(directiveAt, directiveAt + 220) : tail.slice(-220);
      fs.writeFileSync(path.join(artifactDir, 'defect-template-region-tail.txt'), tail, 'utf8');
      defect('medium',
        'feat_opnote_quality appends its ~700-character [MLS QUALITY DIRECTIVE] to the USER prompt as well as the system prompt, so an internal instruction lands INSIDE the block the prompt labels "SELECTED TEMPLATE - COPY ITS STRUCTURE AND FIXED WORDING"',
        `mls-connect.js, feat_opnote_quality: wrap('aiCallRaw') loops over EVERY argument and appends Q to any string matching /operative note|op[- ]?note|procedure note|operative report|injection procedure/i. The system prompt always matches ("operative/procedure note"), and the user prompt matches whenever the uploaded template contains its own document title - "OPERATIVE NOTE", "PROCEDURE NOTE", "OP NOTE" or "OPERATIVE REPORT" - which is nearly every real operative-note template. Captured on the wire in all of [${dirtyModes.join(', ')}]. Tail of the SELECTED TEMPLATE region: ...${JSON.stringify(excerpt)}`);
      record('5d. PROMPT HYGIENE: the SELECTED TEMPLATE block carries only the template', 'FAIL',
        `in mode(s) [${dirtyModes.join(', ')}] the user prompt's SELECTED TEMPLATE region ends with the internal [MLS QUALITY DIRECTIVE] paragraph instead of the doctor's template. Directive also present in the system prompt: ${modeResults[dirtyModes[0]].directiveInSystem}. Full region tail saved to defect-template-region-tail.txt`);
    } else {
      record('5d. PROMPT HYGIENE: the SELECTED TEMPLATE block carries only the template', 'PASS',
        'the user prompt\'s SELECTED TEMPLATE region contained the template and nothing else in all three modes');
    }

    record('6. FOLLOWS THE TEMPLATE in every mode', 'PASS',
      `for each of ${MODE_ORDER.map((m) => `"${MODE_LABEL[m]}"`).join(', ')}: all ${TEMPLATE_HEADINGS.length} uploaded headings appear in the drafted note in the uploaded order, the fixed ANESTHESIA wording survives verbatim, and none of ${JSON.stringify(TEMPLATE_FREE_SLOTS)} came through as literal [[slot]] syntax`);

    /* ---- STEP 6b: NEGATIVE CONTROL ----
       Everything above is only worth reading if these checks can fail. Make the
       stub answer like a model that ignored the template - one heading renamed,
       one fixed-wording line deleted, one slot left as literal [[syntax]] - and
       require BOTH that our own checks flag that reply, and that nothing shaped
       like it lands in the doctor's row. */
    await evaluate(cdp, `window.__mlsAiStubMode('mangle'); true`, { userGesture: false });
    const mangled = await draftOnce(cdp, 'negative control (mangled reply)', true);
    await evaluate(cdp, `window.__mlsAiStubMode('echo'); true`, { userGesture: false });

    const rawReply = mangled.refused ? mangled.rawReply : mangled.rawReply;
    const rawHeadings = headingOrderReport(rawReply);
    const rawSlots = leftoverSlots(rawReply);
    const rawFixed = rawReply.indexOf('ANESTHESIA: Local synthetic anesthetic only') >= 0;
    assert(rawReply.length > 100, 'the negative control never produced a mangled reply to check');
    assert(!rawHeadings.ok, 'INSTRUMENT BLIND: the heading check passed a reply with a renamed heading');
    assert(rawSlots.length > 0, 'INSTRUMENT BLIND: the unfilled-slot check passed a reply containing literal [[slot]] syntax');
    assert(rawFixed === false, 'the negative control did not actually delete the fixed-wording line');

    let landedReport;
    if (!mangled.refused) fs.writeFileSync(path.join(artifactDir, 'note-negative-control-landed.txt'), mangled.note, 'utf8');
    if (mangled.refused) {
      landedReport = `the app REFUSED the mangled reply: "${String(mangled.why).slice(0, 140)}" (code=${mangled.code}); the row kept its previous ${mangled.rowNote.note.length}-char note`;
      const kept = headingOrderReport(mangled.rowNote.note);
      assert(kept.ok, 'a refused draft left a note in the row that no longer follows the template');
    } else {
      const landed = headingOrderReport(mangled.note);
      const landedSlots = leftoverSlots(mangled.note);
      assert(landed.ok, `a mangled model reply LANDED in the row with broken headings: missing=${JSON.stringify(landed.missing)}, out-of-order=${JSON.stringify(landed.outOfOrder)}`);
      assert(mangled.note.indexOf('ANESTHESIA: Local synthetic anesthetic only') >= 0, 'a mangled model reply LANDED in the row with the template fixed wording deleted');
      /* A slot the model refused to answer is allowed to stay VISIBLE - that is
         the honest blank. What is not allowed is shipping it silently: every
         surviving slot must be surfaced as a field the doctor is asked to fill. */
      const unsurfaced = landedSlots
        .map((token) => (token.match(/\[\[\s*([a-z0-9_]+)\s*\]\]/i) || [])[1])
        .filter(Boolean)
        .map((k) => k.toLowerCase())
        .filter((k) => !(mangled.missingKeys || []).includes(k));
      assert(unsurfaced.length === 0, `a repaired note kept unfilled slots that were never surfaced as fields to fill: ${JSON.stringify(unsurfaced)} (row.missing=${JSON.stringify(mangled.missingKeys)})`);
      /* The repair restored the template's slots, and the app then auto-filled
         them with STANDARD CLINICAL DEFAULTS (needle gauge, drug + concentration
         + volume, imaging modality) that no one dictated - the 2026-07-13 owner
         directive. That is only safe if the doctor is told, so this asserts the
         two guards that make it safe: an amber "suggested" tag on the visible
         field, and a save that refuses the first press. */
      /* The Fields box is built by the onf owner's tick, which the room kicks
         synchronously after every render; poll it the same way rather than
         trusting a timer (hidden/occluded tabs freeze intervals). */
      const suggestion = await waitFor(cdp, 'the Fields box above the editor', `(() => {
        try { const onf=window.__mlsOpNoteFill; if(onf && onf.installed && typeof onf.tick==='function') onf.tick(); } catch(e) {}
        const ta=document.getElementById('opPrepNote_0');
        const box=(ta && ta.previousElementSibling && ta.previousElementSibling.classList && ta.previousElementSibling.classList.contains('onf-fillbox'))
          ? ta.previousElementSibling
          : document.querySelector('#opPrepList .onf-fillbox');
        if(!box) return false;
        const fields=[...box.querySelectorAll('label')].map(l => {
          const ctrl=l.querySelector('input,select');
          const r=l.getBoundingClientRect(), s=getComputedStyle(l);
          const tagEl=l.querySelector('.onf-sug,.onf-saved,.onf-default,.onf-hist,.onf-need');
          return { field:(l.childNodes[0]&&l.childNodes[0].textContent||'').trim(), value: ctrl?String(ctrl.value||''):'',
            tag: tagEl ? (tagEl.className+':'+(tagEl.textContent||'').trim()) : '',
            visible: s.display!=='none' && s.visibility!=='hidden' && r.width>0 && r.height>0 };
        });
        return { box:true, fields, tagged: fields.filter(f => /onf-sug/.test(f.tag)),
          header: (box.querySelector('.onf-h')||{}).textContent || '',
          html: box.innerHTML.slice(0, 4000),
          pending: Object.keys((window._opPrep[0]._onfSuggestedPending)||{}), reviewed: !!window._opPrep[0]._onfReviewed };
      })()`, 20000);
      fs.writeFileSync(path.join(artifactDir, 'negative-control-fields-box.json'), JSON.stringify(suggestion, null, 2), 'utf8');
      assert(suggestion.box, 'the Fields box did not render above the editor after the repair');
      const invented = ['25-gauge', 'bupivacaine', 'Fluoroscopy'].filter((v) => mangled.note.indexOf(v) >= 0);
      if (invented.length) {
        /* --- STEP 6d: is an undictated standard value MARKED as one? --- */
        const visibleFields = (suggestion.fields || []).filter((f) => f.visible);
        const carrying = invented.map((v) => {
          const field = visibleFields.find((f) => String(f.value).indexOf(v) >= 0);
          return { value: v, field: field ? field.field : '(no field)', tag: field ? field.tag : '' };
        });
        const untagged = carrying.filter((c) => !/onf-sug/.test(c.tag));
        if (untagged.length) {
          defect('high',
            'Undictated standard clinical values are written into the op note and presented as "filled automatically" - the amber "suggested" marker the owner directive promises survives only the FIRST render of the Fields box',
            `feat_mls_opnote_fill.js buildFillBox(): on the first pass vals[key] is null so meta[key] = resolved.kind ("suggested") and the field renders with the amber <span class="onf-sug">suggested</span> tag. row._onfVals then persists the value, so on EVERY later pass the else branch at :1239 sets meta[key] = 'set' - a kind the tag ternary at :1278 has no case for (no tag at all) and which the :1304 split treats as silently auto-filled. buildFillBox re-runs on the onf tick and after every opPrepRender, so the marker is gone within ~1s. Measured live: the note read "entered with a 25-gauge, 1.5-inch needle, and a total of 0.25% bupivacaine + dexamethasone, 1 mL per point" with "IMAGING GUIDANCE: Fluoroscopy" - none dictated, none in the chart, all three from the STD/needleOpts tables at feat_mls_opnote_fill.js:718-745 - while the Fields box header read "3 fields need you - 3 filled automatically" and those three carried NO tag: ${JSON.stringify(carrying)}. row._onfSuggestedPending still lists ${JSON.stringify(suggestion.pending)}, so the internal state is right and only the DISPLAY lies.`);
          record('6d. an undictated standard clinical value is visibly marked "suggested"', 'FAIL',
            `the note carries ${JSON.stringify(invented)} - a needle gauge, a drug+concentration+volume and an imaging modality that were never dictated - and the visible Fields box tags them ${JSON.stringify(carrying.map((c) => c.tag || '(none)'))} under the header ${JSON.stringify(suggestion.header)}. Internally row._onfSuggestedPending=${JSON.stringify(suggestion.pending)}, reviewed=${suggestion.reviewed}`);
        } else {
          record('6d. an undictated standard clinical value is visibly marked "suggested"', 'PASS',
            `every auto-filled standard value is amber-tagged: ${JSON.stringify(carrying)}`);
        }

        /* --- STEP 6e: the save gate. It is deliberately scoped to a FINALIZING
           save (feat_mls_opnote_prep.js: `unresolvedNow === 0`), so fill the
           remaining honest blanks through the real Fields box first, then press
           Save and require the confirming look. --- */
        const filledBlanks = await evaluate(cdp, `(() => {
          const box=document.querySelector('#opPrepList .onf-fillbox');
          if(!box) return { ok:false, reason:'no box' };
          const done=[];
          [...box.querySelectorAll('[data-onf-label]')].forEach(ctrl => {
            const lab=ctrl.getAttribute('data-onf-label')||'';
            if(String(ctrl.value||'').trim()) return;
            const value='SYNTHETIC-'+lab.toUpperCase().replace(/[^A-Z0-9]+/g,'-')+'-FIXTURE';
            const proto = ctrl.tagName==='SELECT' ? HTMLSelectElement.prototype : (ctrl.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype);
            const setter=Object.getOwnPropertyDescriptor(proto,'value').set;
            setter.call(ctrl, value);
            ctrl.dispatchEvent(new Event('change',{bubbles:true}));
            done.push(lab);
          });
          return { ok:true, done };
        })()`);
        const unresolved = await waitFor(cdp, 'every honest blank filled', `(() => {
          const n=(typeof window.opNoteBlankCount==='function') ? window.opNoteBlankCount((window._opPrep[0]||{}).note||'') : -1;
          return n===0 ? { blanks:n } : false;
        })()`, 15000);
        await click(cdp, '#opPrepList button[onclick="opPrepSave(0)"]');
        const gate = await waitFor(cdp, 'the save review gate', `(() => {
          const m=document.getElementById('opPrepMsg_0');
          const t=(m&&m.textContent||'').trim();
          return t ? { msg:t.slice(0,240), armed: !!(window._opPrep[0]._opnpSaveArm) } : false;
        })()`, 10000);
        if (/auto-suggested standard value/i.test(gate.msg) && gate.armed) {
          if (untagged.length && /amber/i.test(gate.msg)) {
            defect('high',
              'The save-time warning tells the doctor to "review the amber fields above" when no amber field is rendered',
              `feat_mls_opnote_prep.js emits "${gate.msg.slice(0, 160)}" while the Fields box shows those same three fields untagged under "${suggestion.header}". The instruction points at a marker that no longer exists - same root cause as 6d.`);
          }
          record('6e. saving a note that carries undictated standard values needs a confirming look', 'PASS',
            `filled the honest blanks ${JSON.stringify(filledBlanks.done)} (unresolved now ${unresolved.blanks}); the first Save was refused with: "${gate.msg.slice(0, 160)}"`);
        } else {
          defect('high', 'A note carrying undictated standard clinical values finalized without the promised confirming look',
            `after filling every honest blank (unresolved=${unresolved.blanks}) the first Save returned "${gate.msg}" with armed=${gate.armed}; feat_mls_opnote_prep.js gates on pendLabels.length && !row._onfReviewed && unresolvedNow === 0`);
          record('6e. saving a note that carries undictated standard values needs a confirming look', 'FAIL',
            `first Save produced "${gate.msg}" (armed=${gate.armed}) instead of the auto-suggested-value warning`);
        }
        landedReport = `the app REPAIRED the mangled reply back into template shape (${mangled.repairCalls} repair round trip(s)); all ${TEMPLATE_HEADINGS.length} headings in order and the deleted fixed wording is back. It then auto-filled the restored slots with standard clinical values (${JSON.stringify(invented)})`;
      } else {
        const unsurfaced = landedSlots
          .map((token) => (token.match(/\[\[\s*([a-z0-9_]+)\s*\]\]/i) || [])[1])
          .filter(Boolean)
          .map((k) => k.toLowerCase())
          .filter((k) => !(mangled.missingKeys || []).includes(k));
        assert(unsurfaced.length === 0, `a repaired note kept unfilled slots that were never surfaced as fields to fill: ${JSON.stringify(unsurfaced)} (row.missing=${JSON.stringify(mangled.missingKeys)})`);
        landedReport = `the app REPAIRED the mangled reply back into template shape (${mangled.repairCalls} repair round trip(s)); ${landedSlots.length} slot(s) stayed visible and every one is surfaced in the Fields box (row.missing=${JSON.stringify(mangled.missingKeys)})`;
      }
    }
    fs.writeFileSync(path.join(artifactDir, 'note-negative-control-raw-model-reply.txt'), rawReply, 'utf8');
    record('6b. NEGATIVE CONTROL: the checks can fail, and a mangled reply never lands as-is', 'PASS',
      `our own checks flagged the mangled reply (missing headings=${JSON.stringify(rawHeadings.missing)}, out-of-order=${JSON.stringify(rawHeadings.outOfOrder)}, literal slots=${JSON.stringify(rawSlots)}, fixed wording deleted); ${landedReport}`);

    /* back to a clean draft so the run does not end on the negative control */
    const recovered = await draftOnce(cdp, 'recovery after the negative control');
    const recoveredHeadings = headingOrderReport(recovered.note);
    assert(recoveredHeadings.ok && leftoverSlots(recovered.note).length === 0, 'the app did not recover after the negative control');
    record('6c. recovery', 'PASS', `after the negative control a normal draft landed again (${recovered.noteChars} chars, all headings in order, 0 unfilled slots)`);

    /* ---- STEP 7: environment hygiene ---- */
    const externals = externalRequests.filter((r) => !/^https?:\/\/127\.0\.0\.1/.test(r.url));
    assert.deepStrictEqual(externals, [], `the run reached the network: ${JSON.stringify(externals.slice(0, 5))}`);
    record('7. isolation', 'PASS', `0 external network requests; ${pageExceptions.length} page exception(s); ${consoleErrors.length} console error(s)`);
    if (pageExceptions.length) {
      defect('low', 'The app threw uncaught exceptions during the template lifecycle', JSON.stringify(pageExceptions.slice(0, 4)));
    }
  } finally {
    try { if (cdp) cdp.close(); } catch (_) {}
    try { if (chrome && chrome.child) chrome.child.kill(); } catch (_) {}
    try { server.close(); } catch (_) {}
    try { fs.writeFileSync(path.join(artifactDir, 'report.json'), JSON.stringify({ results: RESULTS, defects: DEFECTS }, null, 2)); } catch (_) {}
  }
}

main().then(() => {
  const failed = RESULTS.filter((r) => r.verdict !== 'PASS');
  process.stdout.write('\n');
  if (failed.length) {
    process.stdout.write(`FAIL — ${failed.length} of ${RESULTS.length} steps did not pass\n`);
    process.exit(1);
  }
  process.stdout.write(`PASS — ${RESULTS.length}/${RESULTS.length} steps passed (template upload, auto-picker, manual override, all three draft modes, template fidelity)\n`);
  process.exit(0);
}).catch((error) => {
  process.stdout.write('\n');
  record('run', 'FAIL', String((error && error.message) || error));
  process.stdout.write(`FAIL — ${String((error && error.stack) || error)}\n`);
  process.exit(1);
});
