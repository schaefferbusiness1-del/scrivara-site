'use strict';

/*
 * Real isolated-Chrome acceptance gate for an unpacked MLS Assist candidate.
 *
 * It never opens the user's Chrome profile or a signed-in Athena session. It
 * proves the source directory can install, inject one bridge owner, answer
 * correlated health/version probes, parse a deterministic synthetic schedule
 * on the exact Athena product origin, open one exact scheduled appointment by
 * its immutable appointment id with a real webNavigation frame delta, obtain a
 * read-only AthenaActionV2 context receipt without a write or schedule pull,
 * refuse ambiguous/wrong identities, own/open/close the one canonical Athena
 * widget without reviving the legacy panel, fail closed during a real renderer
 * offline interval, recover after the network returns, reject a chart-shaped
 * non-schedule, survive reloads, wake its service worker, and preserve the
 * explicit schedule relay on the exact MLS origin. External DNS is denied and
 * every synthetic page request is either deterministically fulfilled or failed.
 * The separate loopback privacy contract remains in the local regression suite,
 * and the working baseline is never modified.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = path.resolve(ROOT, '..', '..');
const DEFAULT_CFT_CACHE = path.join(WORKSPACE_ROOT, '.codex-tools', 'chrome-for-testing');
const CORE_FILES = [
  'background.js', 'destination_teach_navigation_guard.js', 'content.js', 'content.css',
  'popup.html', 'popup.js', 'mls-popup.js', 'mls-popup.css', 'offscreen.html',
  'offscreen.js', 'feat_codes_driver.js', 'ext_reviews_reader.js',
  'write_safety_guard.js', 'review_screen.js', 'teach_destination_memory.js',
  'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'
];
const PACKAGE_FILES = ['manifest.json', ...CORE_FILES];

function parseArgs(argv) {
  const out = {
    runs: 3,
    headed: false,
    chrome: '',
    candidate: ROOT,
    baseline: '',
    allowUnstamped: false,
    requirePackageInventory: false
  };
  for (const arg of argv) {
    if (arg === '--headed') out.headed = true;
    else if (arg === '--allow-unstamped') out.allowUnstamped = true;
    else if (arg === '--require-package-inventory') out.requirePackageInventory = true;
    else if (arg.startsWith('--runs=')) out.runs = Number(arg.slice(7));
    else if (arg.startsWith('--chrome=')) out.chrome = path.resolve(arg.slice(9));
    else if (arg.startsWith('--candidate=')) out.candidate = path.resolve(arg.slice(12));
    else if (arg.startsWith('--baseline=')) out.baseline = path.resolve(arg.slice(11));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.runs) || out.runs < 1 || out.runs > 100) throw new Error('--runs must be 1..100');
  return out;
}

function compareVersionsDescending(a, b) {
  const aa = String(a).split('.').map((part) => Number(part) || 0);
  const bb = String(b).split('.').map((part) => Number(part) || 0);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    if ((aa[i] || 0) !== (bb[i] || 0)) return (bb[i] || 0) - (aa[i] || 0);
  }
  return 0;
}

function cachedChromeForTesting(cacheRoot) {
  if (!fs.existsSync(cacheRoot)) return [];
  const currentPlatforms = process.platform === 'win32'
    ? (process.arch === 'ia32' ? ['win32'] : ['win64', 'win32'])
    : process.platform === 'darwin'
      ? (process.arch === 'arm64' ? ['mac-arm64'] : ['mac-x64'])
      : ['linux64'];
  const found = [];
  for (const versionEntry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!versionEntry.isDirectory() || !/^\d+(?:\.\d+){3}$/.test(versionEntry.name)) continue;
    for (const platformName of currentPlatforms) {
      const platformDir = path.join(cacheRoot, versionEntry.name, platformName);
      const sourceFile = path.join(platformDir, 'SOURCE.json');
      if (!fs.existsSync(sourceFile)) continue;
      try {
        const metadata = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
        if (metadata.version !== versionEntry.name || metadata.platform !== platformName) continue;
        const executable = path.resolve(platformDir, String(metadata.executable || ''));
        const relative = path.relative(platformDir, executable);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(executable)) continue;
        found.push({ path: executable, source: 'workspace Chrome for Testing cache', metadata, sourceFile, platformDir });
      } catch (_) {}
    }
  }
  return found.sort((a, b) => compareVersionsDescending(a.metadata.version, b.metadata.version));
}

function findChrome(explicit) {
  const explicitChoices = [
    explicit && { path: explicit, source: '--chrome' },
    process.env.CHROME_FOR_TESTING_PATH && { path: process.env.CHROME_FOR_TESTING_PATH, source: 'CHROME_FOR_TESTING_PATH' },
    process.env.CHROME_PATH && { path: process.env.CHROME_PATH, source: 'CHROME_PATH' }
  ].filter(Boolean);
  const selectedExplicit = explicitChoices.find((entry) => fs.existsSync(entry.path));
  if (selectedExplicit) return selectedExplicit;
  if (explicit) throw new Error(`--chrome does not exist: ${explicit}`);

  const cacheRoot = process.env.MLS_CFT_CACHE
    ? path.resolve(process.env.MLS_CFT_CACHE)
    : DEFAULT_CFT_CACHE;
  const cached = cachedChromeForTesting(cacheRoot);
  if (cached.length) return cached[0];

  // Unbranded Chromium remains a supported fallback. Do not silently select a
  // user's branded Google Chrome: Chrome 137+ ignores --load-extension, and a
  // test must never be mistaken for an MLS Assist candidate acceptance pass.
  const chromiumChoices = [
    process.platform === 'darwin' && '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium-browser'
  ].filter(Boolean);
  const chromium = chromiumChoices.find((file) => fs.existsSync(file));
  if (chromium) return { path: chromium, source: 'unbranded Chromium' };

  throw new Error(`No supported isolated extension-test browser found. Put a verified Chrome for Testing build under ${cacheRoot}, set CHROME_FOR_TESTING_PATH, or pass --chrome=PATH. Branded Google Chrome 137+ is intentionally not auto-selected because it ignores --load-extension.`);
}

function manifestAt(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
}

function coreDigest(dir) {
  const hash = crypto.createHash('sha256');
  for (const name of CORE_FILES) {
    hash.update(name, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(path.join(dir, name)));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function assertPackageInventory(dir, label) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort();
  const expected = [...PACKAGE_FILES].sort();
  assert.deepStrictEqual(actual, expected,
    `${label} must contain exactly the audited ${PACKAGE_FILES.length}-file extension package inventory`);
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    const stat = fs.lstatSync(file);
    assert(entry.isFile() && stat.isFile() && !stat.isSymbolicLink(),
      `${label} package entry must be a regular, non-symlink file: ${entry.name}`);
  }
}

function packageFileDigests(dir) {
  const result = {};
  for (const name of PACKAGE_FILES) {
    result[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
  }
  return result;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyCachedBrowser(selection) {
  if (!selection.metadata) return null;
  const metadata = selection.metadata;
  assert(/^https:\/\/googlechromelabs\.github\.io\/chrome-for-testing\//.test(String(metadata.catalogUrl || '')), 'cached Chrome for Testing metadata has a non-official catalog URL');
  assert(/^https:\/\/storage\.googleapis\.com\/chrome-for-testing-public\//.test(String(metadata.assetUrl || '')), 'cached Chrome for Testing metadata has a non-official asset URL');
  assert.strictEqual(path.resolve(selection.platformDir, String(metadata.executable || '')), path.resolve(selection.path), 'cached Chrome for Testing executable does not match its metadata');
  const archiveName = path.basename(new URL(metadata.assetUrl).pathname);
  const archive = path.join(selection.platformDir, archiveName);
  if (!fs.existsSync(archive)) return { sourceFile: selection.sourceFile, archive: null, sha256: null };
  const stat = fs.statSync(archive);
  assert.strictEqual(stat.size, Number(metadata.contentLength), 'cached Chrome for Testing archive length no longer matches verified metadata');
  const actualSha256 = await sha256File(archive);
  assert.strictEqual(actualSha256, metadata.downloadSha256, 'cached Chrome for Testing archive SHA-256 no longer matches verified metadata');
  return { sourceFile: selection.sourceFile, archive, sha256: actualSha256 };
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFile(file, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function readTextWhenUnlocked(file, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < end) {
    try { return fs.readFileSync(file, 'utf8'); }
    catch (error) { lastError = error; await sleep(50); }
  }
  throw lastError || new Error(`Timed out reading ${file}`);
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener('exit', done);
      resolve(false);
    }, timeoutMs);
    child.once('exit', done);
  });
}

async function terminateDisposableChromeTree(child, chromePath, profile, timeoutMs = 5000) {
  assert.strictEqual(process.platform, 'win32', 'process-tree fallback is Windows-only');
  assert(child && Number.isInteger(child.pid) && child.pid > 0, 'refusing to terminate an unknown browser PID');
  assert.strictEqual(path.resolve(child.spawnfile || ''), path.resolve(chromePath),
    'refusing to terminate a process that is not the selected isolated Chrome executable');
  const resolvedProfile = path.resolve(profile);
  const resolvedTemp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTemp, resolvedProfile);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `refusing to terminate a browser outside the disposable temp-profile contract: ${resolvedProfile}`);
  assert(path.basename(resolvedProfile).startsWith('mls-extension-candidate-'),
    `refusing to terminate a browser with an unexpected profile: ${resolvedProfile}`);
  assert(child.spawnargs.some((arg) => {
    const prefix = '--user-data-dir=';
    return String(arg).startsWith(prefix) && path.resolve(String(arg).slice(prefix.length)) === resolvedProfile;
  }), 'refusing to terminate a browser that was not launched with the exact disposable profile');
  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true
    });
    const timer = setTimeout(() => {
      try { killer.kill(); } catch (_) {}
      done();
    }, timeoutMs);
    killer.once('error', done);
    killer.once('exit', done);
  });
}

async function removeDisposableProfile(profile, timeoutMs = 10000) {
  const resolvedProfile = path.resolve(profile);
  const resolvedTemp = path.resolve(os.tmpdir());
  const relative = path.relative(resolvedTemp, resolvedProfile);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `refusing to remove profile outside the temp directory: ${resolvedProfile}`);
  assert(path.basename(resolvedProfile).startsWith('mls-extension-candidate-'), `refusing to remove unexpected profile: ${resolvedProfile}`);
  const end = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < end) {
    try {
      fs.rmSync(resolvedProfile, { recursive: true, force: true });
      if (!fs.existsSync(resolvedProfile)) return;
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw lastError || new Error(`could not remove disposable Chrome profile: ${resolvedProfile}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        const handlers = this.listeners.get(message.method);
        if (handlers) {
          for (const handler of [...handlers]) {
            try { Promise.resolve(handler(message.params || {})).catch(() => {}); } catch (_) {}
          }
        }
        return;
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP closed'));
      this.pending.clear();
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new Cdp(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
    });
  }
  send(method, params = {}, timeoutMs = 30000, sessionId = '') {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${method}: timed out`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.socket.send(JSON.stringify(payload));
    });
  }
  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(handler);
    return handler;
  }
  off(method, handler) {
    const handlers = this.listeners.get(method);
    if (!handlers) return;
    handlers.delete(handler);
    if (!handlers.size) this.listeners.delete(method);
  }
  close() { this.listeners.clear(); try { this.socket.close(); } catch (_) {} }
}

async function launch(chromePath, candidate, profile, headed) {
  const chromeArgs = [
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
    `--disable-extensions-except=${candidate}`, `--load-extension=${candidate}`,
    '--no-first-run', '--no-default-browser-check', '--disable-component-update',
    '--disable-default-apps', '--disable-sync', '--disable-background-networking',
    '--disable-domain-reliability', '--metrics-recording-only',
    '--password-store=basic', '--use-mock-keychain',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--window-size=1280,900', 'about:blank'
  ];
  if (!headed) chromeArgs.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') chromeArgs.unshift('--no-sandbox');
  const child = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  try { await waitFile(portFile, 20000); }
  catch (error) { try { child.kill(); } catch (_) {} throw new Error(`${error.message}\n${stderr.slice(-4000)}`); }
  let portText;
  try { portText = await readTextWhenUnlocked(portFile, 5000); }
  catch (error) { try { child.kill(); } catch (_) {} throw error; }
  const [port, browserPath] = portText.trim().split(/\r?\n/);
  return { child, port: Number(port), browserWs: `ws://127.0.0.1:${port}${browserPath}`, stderr: () => stderr };
}

async function createPage(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  assert(response.ok, `Could not create Chrome page: ${response.status}`);
  const target = await response.json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')]);
  return cdp;
}

async function createSyntheticOriginPage(port, initialUrl, htmlForUrl, bodyForRequest = null) {
  const targetUrl = new URL(initialUrl);
  const cdp = await createPage(port, 'about:blank');
  const patterns = [
    { urlPattern: 'http://*', requestStage: 'Request' },
    { urlPattern: 'https://*', requestStage: 'Request' }
  ];
  const state = { origin: targetUrl.origin, fulfilled: 0, blocked: [], errors: [], firewallEnabled: true };
  const onPaused = async (event) => {
    try {
      const requestUrl = String(event.request && event.request.url || '');
      const resourceType = String(event.resourceType || '');
      const sameOrigin = (() => { try { return new URL(requestUrl).origin === state.origin; } catch (_) { return false; } })();
      const body = sameOrigin
        ? (resourceType === 'Document' ? htmlForUrl(requestUrl) : (bodyForRequest ? bodyForRequest(requestUrl, resourceType, String(event.request && event.request.method || 'GET')) : null))
        : null;
      if (typeof body === 'string') {
        state.fulfilled++;
        await cdp.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 200,
          responsePhrase: 'OK',
          responseHeaders: [
            { name: 'Content-Type', value: 'text/html; charset=utf-8' },
            { name: 'Cache-Control', value: 'no-store' },
            { name: 'X-Content-Type-Options', value: 'nosniff' }
          ],
          body: Buffer.from(body, 'utf8').toString('base64')
        });
      } else {
        state.blocked.push({
          url: requestUrl,
          method: String(event.request && event.request.method || 'GET'),
          resourceType
        });
        await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' });
      }
    } catch (error) {
      state.errors.push(String(error && error.message || error));
    }
  };
  cdp.on('Fetch.requestPaused', onPaused);
  await cdp.send('Fetch.enable', { patterns });
  cdp.syntheticOrigin = { state, onPaused, htmlForUrl, patterns };
  await navigateSyntheticPage(cdp, initialUrl, 'initial synthetic origin page');
  return cdp;
}

async function setSyntheticFirewall(cdp, enabled) {
  assert(cdp && cdp.syntheticOrigin, 'synthetic firewall requires an intercepted origin page');
  if (enabled) await cdp.send('Fetch.enable', { patterns: cdp.syntheticOrigin.patterns });
  else await cdp.send('Fetch.disable');
  cdp.syntheticOrigin.state.firewallEnabled = !!enabled;
}

async function navigateSyntheticPage(cdp, url, label, readyExpression = 'document.readyState===\'complete\'') {
  assert(cdp && cdp.syntheticOrigin, 'synthetic navigation requires an intercepted origin page');
  const before = cdp.syntheticOrigin.state.fulfilled;
  await cdp.send('Page.navigate', { url });
  await waitFor(cdp, `location.href===${JSON.stringify(url)} && (${readyExpression})`, label, 30000);
  assert(cdp.syntheticOrigin.state.fulfilled > before, `${label} escaped deterministic document interception`);
  assert.deepStrictEqual(cdp.syntheticOrigin.state.errors, [], `${label} interception failed`);
}

const SYNTHETIC_MLS_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>MLS synthetic extension gate</title></head>
<body><main><h1>MLS synthetic extension gate</h1><p>No clinical data is present on this page.</p></main></body></html>`;
const SYNTHETIC_MYDATA_URL = 'https://mydata.athenahealth.com/';
const SYNTHETIC_MYDATA_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Non-clinical Athena patient portal</title></head>
<body><main><h1>Non-clinical synthetic Athena origin</h1><p>This page contains no patient data and is not athenaOne.</p></main></body></html>`;
const SYNTHETIC_ATHENA_DEVELOPER_URL = 'https://developer.api.athena.io/ams-portal/';
const SYNTHETIC_ATHENA_DEVELOPER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>Athena API developer portal</title></head>
<body><main><h1>Synthetic Athena API developer origin</h1><p>This page contains no patient data and is not athenaOne.</p></main></body></html>`;

const SYNTHETIC_ATHENA_SCHEDULE_URL = 'https://athenanet.athenahealth.com/1/1/schedule/dashboard';
const SYNTHETIC_ATHENA_CHART_URL = 'https://athenanet.athenahealth.com/1/1/encounter/synthetic';
const SYNTHETIC_ATHENA_EXACT_SCHEDULE_URL = 'https://athenanet.athenahealth.com/1/1/schedule/exact-appointment';
const SYNTHETIC_ATHENA_EXACT_AMBIGUOUS_URL = `${SYNTHETIC_ATHENA_EXACT_SCHEDULE_URL}?fixture=ambiguous`;
const SYNTHETIC_ATHENA_EXACT_WRONG_IDENTITY_URL = `${SYNTHETIC_ATHENA_EXACT_SCHEDULE_URL}?fixture=wrong-identity`;
const SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL = 'https://athenanet.athenahealth.com/1/1/encounter/700001?appointmentid=424242';
const SYNTHETIC_EXACT_APPOINTMENT_ID = '424242';
const SYNTHETIC_EXACT_ENCOUNTER_ID = '700001';
const SYNTHETIC_EXACT_PATIENT = Object.freeze({
  patientId: 'local-synthetic-424242',
  name: 'Casey Synthetic',
  dob: '04/12/1981',
  mrn: '9004242'
});
const SYNTHETIC_EXACT_CONTEXT = Object.freeze({
  appointmentId: SYNTHETIC_EXACT_APPOINTMENT_ID,
  visitDate: '07/18/2026',
  provider: 'Avery Stone MD'
});
const SYNTHETIC_ATHENA_SCHEDULE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>athenaOne | Clinical Schedule</title>
<style>body{font-family:Arial,sans-serif;margin:24px}.calendar-nav{height:1px}.schedule{border-collapse:collapse;width:760px}.schedule th,.schedule td{border:1px solid #ccd5d0;padding:10px;text-align:left}</style></head>
<body><div class="calendar-nav" aria-hidden="true"></div>
<h1 class="fe_c_heading--subsection">Saturday, July 18, 2026</h1>
<p>Clinical schedule: 2 appointments, 1 provider.</p>
<table class="schedule" role="grid" aria-label="Schedule grid" data-testid="schedule-grid">
<thead><tr><th>Time</th><th>Patient</th><th>Provider</th><th>Status</th></tr></thead>
<tbody>
<tr data-patient-dob="1981-04-12"><td>8:30 AM</td><td>Alpha Sample</td><td>Avery Stone MD</td><td>Scheduled</td></tr>
<tr data-patient-dob="1975-09-23"><td>10:15 AM</td><td>Bravo Sample</td><td>Avery Stone MD</td><td>Checked in</td></tr>
</tbody></table></body></html>`;
const SYNTHETIC_ATHENA_CHART_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>athenaOne | Encounter</title></head>
<body><div class="calendar-nav" aria-hidden="true"></div><h1>Encounter summary</h1>
<p>Medication last taken at 8:30 AM. Follow-up call documented at 10:15 AM.</p>
<section><h2>Assessment</h2><p>This is deliberately chart-shaped synthetic text, not a schedule.</p></section></body></html>`;

const SYNTHETIC_ATHENA_EXACT_ENCOUNTER_BODY = `<main id="encounter-shell" data-testid="encounter-workspace" aria-label="Encounter workspace">
  <header class="patient-header" data-testid="patient-header" data-patient-name="Casey Synthetic" data-patient-dob="04/12/1981" data-patient-mrn="9004242"><h1>Casey Synthetic</h1><p>DOB: 04/12/1981 | MRN: 9004242</p></header>
  <div class="encounter-metadata"><span class="meta-token" aria-label="Date of service: 07/18/2026"></span><span class="meta-token" aria-label="Rendering provider: Avery Stone MD"></span></div>
  <div class="clinical-pane-shell"><div class="clinical-pane-body"><section class="encounter-note" data-testid="encounter-note"><h2>Encounter note</h2><textarea id="exact-note-editor" aria-label="Visit narrative field"></textarea></section></div></div>
</main>`;

function syntheticExactScheduleHtml(variant) {
  const rows = variant === 'ambiguous'
    ? `<div class="PatientAppointment_appointment-container exact-row" data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"><a href="${SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL}">Casey Synthetic at 8:30 AM</a></div>
<div class="PatientAppointment_appointment-container exact-row" data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"><a href="${SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL}">Casey Synthetic at 9:00 AM</a></div>`
    : variant === 'wrong-identity'
      ? `<div class="PatientAppointment_appointment-container exact-row" data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"><a href="${SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL}">Jordan Different at 8:30 AM</a></div>`
      : `<div class="PatientAppointment_appointment-container exact-row" data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"><a id="exact-appointment-link" href="${SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL}">Casey Synthetic at 8:30 AM</a></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>athenaOne | Exact synthetic schedule</title>
<style>body{font-family:Arial,sans-serif;margin:24px}.calendar-nav{height:1px}.exact-row{display:block;width:720px;min-height:48px;border:1px solid #ccd5d0;padding:10px;margin:8px 0}.exact-row a{display:inline-block;min-width:260px;min-height:24px}#encounter-shell{display:block;width:940px;min-height:480px}.patient-header{display:block;min-height:48px}.meta-token{display:inline-block;width:24px;height:12px}.encounter-note{display:block;width:820px;min-height:260px}.encounter-note textarea{display:block;width:760px;height:180px}</style></head>
<body><div class="calendar-nav" aria-hidden="true"></div><h1>Saturday, July 18, 2026</h1>
<main data-testid="exact-schedule-grid">${rows}</main>
<script>
(function(){
  var audit=window.__syntheticExactScheduleAudit={rowClicks:0,framesCreated:0};
  document.addEventListener('click',function(){audit.rowClicks++;},true);
  var link=document.getElementById('exact-appointment-link');
  if(!link)return;
  link.addEventListener('click',function(event){
    event.preventDefault();event.stopPropagation();
    if(document.getElementById('exact-encounter-frame'))return;
    var frame=document.createElement('iframe');
    frame.id='exact-encounter-frame';
    frame.title='Exact synthetic Athena encounter';
    frame.src=${JSON.stringify(SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL)};
    frame.style.cssText='display:block;width:1000px;height:620px;border:1px solid #ccd5d0;margin-top:20px';
    document.body.appendChild(frame);audit.framesCreated++;
  });
})();
</script></body></html>`;
}

const SYNTHETIC_ATHENA_EXACT_ENCOUNTER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>athenaOne | Exact synthetic encounter</title>
<style>body{font-family:Arial,sans-serif;margin:18px}#encounter-shell{display:block;width:940px;min-height:480px}.patient-header{display:block;min-height:48px}.meta-token{display:inline-block;width:24px;height:12px}.encounter-note{display:block;width:820px;min-height:260px}.encounter-note textarea{display:block;width:760px;height:180px}</style></head>
<body>${SYNTHETIC_ATHENA_EXACT_ENCOUNTER_BODY}
<script>
(function(){
  var audit=window.__syntheticEncounterAudit={clicks:0,inputs:0,changes:0,submits:0,valueWrites:0,scopeMutations:0,fetches:0,xhrs:0,beacons:0};
  document.addEventListener('click',function(){audit.clicks++;},true);
  document.addEventListener('input',function(){audit.inputs++;},true);
  document.addEventListener('change',function(){audit.changes++;},true);
  document.addEventListener('submit',function(){audit.submits++;},true);
  var valueDescriptor=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
  if(valueDescriptor&&valueDescriptor.get&&valueDescriptor.set)Object.defineProperty(HTMLTextAreaElement.prototype,'value',{configurable:true,enumerable:valueDescriptor.enumerable,get:valueDescriptor.get,set:function(value){audit.valueWrites++;return valueDescriptor.set.call(this,value);}});
  var scope=document.querySelector('[data-testid="encounter-note"]');
  if(scope)new MutationObserver(function(rows){audit.scopeMutations+=rows.length;}).observe(scope,{subtree:true,childList:true,attributes:true,characterData:true});
  if(window.fetch){var oldFetch=window.fetch;window.fetch=function(){audit.fetches++;return oldFetch.apply(this,arguments);};}
  if(window.XMLHttpRequest){var oldOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(){audit.xhrs++;return oldOpen.apply(this,arguments);};}
  if(navigator.sendBeacon){var oldBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(){audit.beacons++;return oldBeacon.apply(navigator,arguments);};}
})();
</script></body></html>`;

async function evaluate(cdp, expression, awaitPromise = false, timeoutMs = 30000) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true }, timeoutMs);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result && result.result.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try { last = await evaluate(cdp, expression, false, 3000); if (last) return last; }
    catch (error) { last = error.message; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function bridge(cdp, type, extra = {}, timeoutMs = 20000) {
  const requestId = `candidate-${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return evaluate(cdp, `new Promise((resolve) => {
    const requestId=${JSON.stringify(requestId)};
    const expected={mlsPing:'mlsPong',mlsExtHealth:'mlsExtHealthResult',mlsAppPullSchedule:'mlsAppScheduleResult',mlsAppSearchOpenPatient:'mlsAppSearchOpenResult',mlsAppAthenaActionV2:'mlsAppAthenaActionV2Result'}[${JSON.stringify(type)}]||'mlsBridgeBlocked';
    let count=0, first=null;
    const done=()=>{removeEventListener('message',onMessage);resolve({requestId,count,first});};
    const onMessage=(event)=>{const data=event.data||{};if(data.source!=='mls-ext'||data.requestId!==requestId)return;if(data.type!==expected&&data.type!=='mlsBridgeBlocked')return;count++;if(!first)first=data;setTimeout(done,120);};
    addEventListener('message',onMessage);
    postMessage(Object.assign({source:'mls-app',type:${JSON.stringify(type)},requestId},${JSON.stringify(extra)}),location.origin);
    setTimeout(done,${Math.max(1000, timeoutMs - 500)});
  })`, true, timeoutMs);
}

function assertSyntheticSchedule(result, label) {
  assert.strictEqual(result.count, 1, `${label}: explicit schedule relay returned duplicate/missing result`);
  assert.strictEqual(result.first.type, 'mlsAppScheduleResult', `${label}: schedule pull was blocked before reaching the worker`);
  assert(result.first.resp && result.first.resp.reason !== 'loopback-synthetic-only', `${label}: schedule pull was misclassified as loopback`);
  assert.strictEqual(result.first.resp.ok, true, `${label}: exact-origin synthetic Athena schedule did not parse: ${JSON.stringify(result.first.resp)}`);
  assert.strictEqual(result.first.resp.scheduleVerified, true, `${label}: schedule surface was not verified`);
  assert(result.first.resp.receipt && result.first.resp.receipt.complete === true, `${label}: schedule receipt is incomplete: ${JSON.stringify(result.first.resp.receipt)}`);
  assert.strictEqual(result.first.resp.receipt.expectedCount, 2, `${label}: wrong expected appointment count`);
  assert.strictEqual(result.first.resp.receipt.parsedCount, 2, `${label}: wrong parsed appointment count: ${JSON.stringify({ receipt: result.first.resp.receipt, appts: result.first.resp.appts, providerDiag: result.first.resp.providerDiag })}`);
  assert.strictEqual(result.first.resp.schedDate, '2026-07-18', `${label}: wrong served schedule date`);
  const parsed = (result.first.resp.appts || []).map((appointment) => ({ time: appointment.time, name: appointment.name, provider: appointment.provider }));
  assert.deepStrictEqual(parsed, [
    { time: '8:30 AM', name: 'Alpha Sample', provider: 'Avery Stone MD' },
    { time: '10:15 AM', name: 'Bravo Sample', provider: 'Avery Stone MD' }
  ], `${label}: parsed schedule rows changed`);
  return parsed;
}

function assertReadOnlyEncounterState(state, label) {
  assert(state && state.audit, `${label}: synthetic encounter audit is missing`);
  assert.strictEqual(state.noteValue, '', `${label}: the read-only probe changed the note editor`);
  for (const key of ['clicks', 'inputs', 'changes', 'submits', 'valueWrites', 'scopeMutations', 'fetches', 'xhrs', 'beacons']) {
    assert.strictEqual(state.audit[key], 0, `${label}: read-only probe caused ${key}: ${JSON.stringify(state.audit)}`);
  }
}

async function proveNegativeAthenaOrigin(browser, workerSessionId, trusted, negativePage, expectedUrl, label) {
  const expectedOrigin = new URL(expectedUrl).origin;
  await waitFor(negativePage, `location.href===${JSON.stringify(expectedUrl)} && document.readyState==='complete'`, `synthetic non-clinical Athena origin (${label})`, 30000);
  const dom = await evaluate(negativePage, `(() => ({
    popupRoots:document.querySelectorAll('#mls-popup-root').length,
    legacyPanels:document.querySelectorAll('#mls-assist-panel').length,
    popupNodes:document.querySelectorAll('[class^="mlsp-"],[class*=" mlsp-"]').length,
    extensionElements:[...document.querySelectorAll('*')].filter(el=>/^mls(?:-|$)/i.test(String(el.id||''))||/^mlsp(?:-|$)/i.test(String(el.className||''))).length
  }))()`);
  assert.deepStrictEqual(dom, { popupRoots: 0, legacyPanels: 0, popupNodes: 0, extensionElements: 0 },
    `candidate injected MLS overlay DOM into the non-clinical Athena origin (${label}): ${JSON.stringify(dom)}`);

  const ping = await bridge(negativePage, 'mlsPing', {}, 2500);
  assert.deepStrictEqual(ping, { requestId: ping.requestId, count: 0, first: null },
    `non-clinical Athena origin (${label}) reached the candidate content bridge: ${JSON.stringify(ping)}`);

  const extensionAccess = await workerEvaluate(browser, workerSessionId, `(async()=>{
    const tabs=await chrome.tabs.query({});
    const matches=tabs.filter(tab=>{try{return new URL(tab.url||'').origin===${JSON.stringify(expectedOrigin)};}catch(_){return false;}});
    if(matches.length!==1)return {matches:matches.map(tab=>({id:tab.id,url:tab.url||''}))};
    const tab=matches[0];
    let script={ok:false,error:''};
    try { const rows=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({loaded:!!window.__mlsAssistLoaded,popup:!!document.getElementById('mls-popup-root'),legacy:!!document.getElementById('mls-assist-panel')})}); script={ok:true,rows:rows.map(row=>row.result)}; }
    catch(error){script={ok:false,error:String(error&&error.message||error)};}
    const message=await new Promise(resolve=>{try{chrome.tabs.sendMessage(tab.id,{type:'mlsOverlayOpen',source:'isolated-negative-origin-gate'},response=>{const err=chrome.runtime.lastError;resolve({response:response||null,error:String(err&&err.message||'')});});}catch(error){resolve({response:null,error:String(error&&error.message||error)});}});
    return {matches:matches.map(item=>({id:item.id,url:item.url||''})),script,message};
  })()`);
  assert(extensionAccess && extensionAccess.matches && extensionAccess.matches.length === 1,
    `isolated browser did not contain exactly one non-clinical Athena tab (${label}): ${JSON.stringify(extensionAccess)}`);
  assert(extensionAccess.script && extensionAccess.script.ok === false && extensionAccess.script.error,
    `candidate retained scripting host access to the non-clinical Athena origin (${label}): ${JSON.stringify(extensionAccess)}`);
  assert(extensionAccess.message && extensionAccess.message.response === null && extensionAccess.message.error,
    `candidate content script received a runtime message on the non-clinical Athena origin (${label}): ${JSON.stringify(extensionAccess)}`);

  const health = await bridge(trusted, 'mlsExtHealth', {}, 30000);
  assert.strictEqual(health.count, 1, `negative-origin health returned duplicate/missing receipt: ${JSON.stringify(health)}`);
  assert(health.first && health.first.resp && health.first.resp.ok === true, `negative-origin health failed: ${JSON.stringify(health)}`);
  assert.deepStrictEqual(health.first.resp.athena, { tabs: 0, discarded: 0 },
    `candidate classified the non-clinical Athena origin (${label}) as a usable clinical Athena tab: ${JSON.stringify(health.first.resp)}`);
  assert.deepStrictEqual(negativePage.syntheticOrigin.state.blocked, [], `non-clinical Athena synthetic page (${label}) attempted an external request: ${JSON.stringify(negativePage.syntheticOrigin.state.blocked)}`);
  assert.deepStrictEqual(negativePage.syntheticOrigin.state.errors, [], `non-clinical Athena synthetic firewall reported an error (${label})`);
  return {
    label,
    origin: expectedOrigin,
    tabId: extensionAccess.matches[0].id,
    scriptError: extensionAccess.script.error,
    messageError: extensionAccess.message.error,
    healthAthena: health.first.resp.athena
  };
}

async function proveExactScheduledAppointmentOpenAndProbe(browser, workerSessionId, trusted, athena, athenaTabId) {
  const openPayload = {
    name: SYNTHETIC_EXACT_PATIENT.name,
    dob: SYNTHETIC_EXACT_PATIENT.dob,
    mrn: SYNTHETIC_EXACT_PATIENT.mrn,
    appointmentId: SYNTHETIC_EXACT_APPOINTMENT_ID,
    bootstrapIdentity: true,
    scheduleDate: '2026-07-18',
    noReload: true
  };
  const probePayload = {
    mode: 'probe',
    action: 'write_note',
    previewHash: 'isolated-live-exact-probe-v1',
    manifestHash: 'isolated-live-exact-manifest-v1',
    expectedPatient: SYNTHETIC_EXACT_PATIENT,
    expectedContext: SYNTHETIC_EXACT_CONTEXT,
    noteText: 'Read-only encounter context verification payload.',
    notePolicy: 'empty_only'
  };

  const bridgeAuditReady = await evaluate(trusted, `(() => {
    if (window.__mlsExactBridgeAuditListener) removeEventListener('message', window.__mlsExactBridgeAuditListener);
    const rows=[];
    const listener=(event)=>{const data=event&&event.data||{};if(event.source!==window||!data||!data.type)return;rows.push({source:String(data.source||''),type:String(data.type||''),mode:String(data.mode||''),action:String(data.action||''),requestId:String(data.requestId||'')});};
    window.__mlsExactBridgeAudit=rows;window.__mlsExactBridgeAuditListener=listener;addEventListener('message',listener);return true;
  })()`);
  assert.strictEqual(bridgeAuditReady, true, 'could not install the exact-opener bridge audit');
  const workerAuditReady = await workerEvaluate(browser, workerSessionId, `(() => {
    self.__mlsExactRuntimeAudit=[];
    if (!self.__mlsExactRuntimeAuditListener) {
      self.__mlsExactRuntimeAuditListener=function(message){
        try { self.__mlsExactRuntimeAudit.push({type:String(message&&message.type||''),mode:String(message&&message.mode||''),action:String(message&&message.action||''),appointmentId:String(message&&message.appointmentId||''),bootstrapIdentity:message&&message.bootstrapIdentity===true}); } catch (_) {}
      };
      chrome.runtime.onMessage.addListener(self.__mlsExactRuntimeAuditListener);
    }
    return true;
  })()`);
  assert.strictEqual(workerAuditReady, true, 'could not install the exact-opener worker message audit');

  await navigateSyntheticPage(
    athena,
    SYNTHETIC_ATHENA_EXACT_SCHEDULE_URL,
    'synthetic exact-appointment schedule',
    `document.readyState==='complete' && document.querySelectorAll('[data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"]').length===1`
  );
  const opened = await bridge(trusted, 'mlsAppSearchOpenPatient', Object.assign({}, openPayload, { deadlineAt: Date.now() + 45000 }), 52000);
  assert.strictEqual(opened.count, 1, `exact appointment open returned duplicate/missing receipt: ${JSON.stringify(opened)}`);
  assert.strictEqual(opened.first.type, 'mlsAppSearchOpenResult', 'exact appointment open returned the wrong bridge receipt');
  assert.strictEqual(opened.first.ok, true, `exact appointment did not open: ${JSON.stringify(opened.first)}`);
  assert.strictEqual(opened.first.opened, true, `exact appointment open did not claim a completed navigation: ${JSON.stringify(opened.first)}`);
  assert.strictEqual(opened.first.via, 'appointment-id', `exact appointment open used a fallback route: ${JSON.stringify(opened.first)}`);
  assert.strictEqual(opened.first.appointmentId, SYNTHETIC_EXACT_APPOINTMENT_ID, 'exact appointment receipt changed the frozen appointment id');
  assert.strictEqual(opened.first.appointmentIdBound, true, `exact appointment receipt lacked a bound navigation proof: ${JSON.stringify(opened.first)}`);
  assert.strictEqual(opened.first.athenaTabId, athenaTabId, 'exact appointment receipt was bound to a different Athena tab');
  const navigationFrameIds = Array.isArray(opened.first.appointmentNavigationFrameIds) ? opened.first.appointmentNavigationFrameIds : [];
  assert(navigationFrameIds.length > 0, `exact appointment receipt returned no navigation frame IDs: ${JSON.stringify(opened.first)}`);
  assert(navigationFrameIds.every((id) => Number.isInteger(id) && id > 0), `exact appointment frame proof is not a positive-integer list: ${JSON.stringify(navigationFrameIds)}`);
  assert.strictEqual(new Set(navigationFrameIds).size, navigationFrameIds.length, `exact appointment frame proof contains duplicates: ${JSON.stringify(navigationFrameIds)}`);

  await waitFor(
    athena,
    `(() => {const f=document.getElementById('exact-encounter-frame');try{return !!f && f.contentWindow.location.href===${JSON.stringify(SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL)} && !!f.contentDocument.getElementById('exact-note-editor') && !!f.contentWindow.__syntheticEncounterAudit;}catch(_){return false;}})()`,
    'synthetic exact encounter frame',
    30000
  );
  const frameSnapshot = await workerEvaluate(browser, workerSessionId, `(async()=>await chrome.webNavigation.getAllFrames({tabId:${Number(athenaTabId)}}))()`);
  const exactEncounterFrames = (frameSnapshot || []).filter((frame) => String(frame.url || '').split('#')[0] === SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL);
  assert.strictEqual(exactEncounterFrames.length, 1, `expected one exact encounter frame after the appointment click: ${JSON.stringify(frameSnapshot)}`);
  assert.deepStrictEqual(
    [...navigationFrameIds].sort((a, b) => a - b),
    exactEncounterFrames.map((frame) => frame.frameId).sort((a, b) => a - b),
    'appointmentNavigationFrameIds did not identify the real changed encounter frame'
  );
  const happyScheduleAudit = await evaluate(athena, `window.__syntheticExactScheduleAudit`);
  assert.strictEqual(happyScheduleAudit.framesCreated, 1, `exact appointment click did not create exactly one real encounter frame: ${JSON.stringify(happyScheduleAudit)}`);
  assert(happyScheduleAudit.rowClicks >= 1, `exact appointment route did not click its bound row: ${JSON.stringify(happyScheduleAudit)}`);

  const encounterStateExpression = `(() => {const f=document.getElementById('exact-encounter-frame'),w=f&&f.contentWindow,d=f&&f.contentDocument,a=w&&w.__syntheticEncounterAudit,e=d&&d.getElementById('exact-note-editor');return {href:w&&w.location.href||'',noteValue:e&&e.value||'',audit:a?Object.assign({},a):null};})()`;
  const beforeProbe = await evaluate(athena, encounterStateExpression);
  assert.strictEqual(beforeProbe.href, SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL, 'exact encounter moved before its read-only probe');
  assertReadOnlyEncounterState(beforeProbe, 'before ActionV2 probe');

  const fixtureDiagnostic = await evaluate(athena, `(() => {
    const frame=document.getElementById('exact-encounter-frame'),w=frame&&frame.contentWindow,d=frame&&frame.contentDocument;
    if(!w||!d)return {frame:false};
    const shown=(el)=>{try{const r=el.getBoundingClientRect(),s=w.getComputedStyle(el);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden';}catch(_){return false;}};
    const identity=[...d.querySelectorAll('[data-testid*="patient-header" i],[data-testid*="patient-banner" i],[data-testid*="patient-identity" i],[data-testid*="patient-demographic" i],[data-testid*="chart-header" i],#patient-header,#patientHeader,#patient-banner,#patientBanner,#chart-header,#chartHeader,.patient-header,.patientHeader,.patient-banner,.patientBanner,.patient-identity,.patient-demographics,.chart-header,.chartHeader')].filter(shown);
    const notes=[...d.querySelectorAll('[data-testid*="encounter-note" i],[data-testid*="encounter-documentation" i],[data-testid*="note-container" i],[data-testid*="note-editor" i],[data-testid*="note-workspace" i],[data-testid*="documentation-container" i],[data-testid*="documentation-workspace" i],[data-component*="encounter-note" i],[data-component*="encounter-documentation" i],[data-component*="note-editor" i],[data-component*="note-workspace" i],[aria-label*="encounter note" i],[aria-label*="encounter documentation" i],[aria-label*="clinical note" i],[aria-label*="note editor" i],[aria-label*="note workspace" i],#encounter-note,#encounterNote,#clinical-note,#clinicalNote,.encounter-note,.encounterNote,.clinical-note,.clinicalNote,.note-editor,.note-workspace,.documentation-container,.documentation-workspace')].filter(shown);
    const labelled=[...d.querySelectorAll('label,dt,dd,th,td,[aria-label],[data-testid],section,fieldset,div,span')].filter(shown).map(el=>String(((el.getAttribute('aria-label')||'')+' '+(el.getAttribute('data-testid')||''))+' '+(el.textContent||'')).replace(/\\s+/g,' ').trim()).filter(t=>/date of service|visit date|appointment date|encounter date|rendering provider|visit provider|seen by|clinician|physician|provider/i.test(t));
    const editor=d.getElementById('exact-note-editor'),shell=d.getElementById('encounter-shell');
    return {frame:true,href:w.location.href,identityCount:identity.length,identity:identity.map(el=>({name:el.getAttribute('data-patient-name'),dob:el.getAttribute('data-patient-dob'),mrn:el.getAttribute('data-patient-mrn')})),noteCount:notes.length,noteIds:notes.map(el=>el.getAttribute('data-testid')||el.id||el.className),editorVisible:shown(editor),shellContainsIdentity:!!(shell&&identity[0]&&shell.contains(identity[0])),shellContainsNote:!!(shell&&notes[0]&&shell.contains(notes[0])),labelled};
  })()`);
  assert.deepStrictEqual(
    {
      frame: fixtureDiagnostic.frame,
      href: fixtureDiagnostic.href,
      identityCount: fixtureDiagnostic.identityCount,
      noteCount: fixtureDiagnostic.noteCount,
      editorVisible: fixtureDiagnostic.editorVisible,
      shellContainsIdentity: fixtureDiagnostic.shellContainsIdentity,
      shellContainsNote: fixtureDiagnostic.shellContainsNote
    },
    { frame: true, href: SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL, identityCount: 1, noteCount: 1, editorVisible: true, shellContainsIdentity: true, shellContainsNote: true },
    `synthetic encounter fixture lost a required exact-context anchor: ${JSON.stringify(fixtureDiagnostic)}`
  );
  assert.strictEqual(fixtureDiagnostic.labelled.length, 2, `synthetic encounter fixture has ambiguous labelled metadata: ${JSON.stringify(fixtureDiagnostic)}`);

  const directDriverDiagnostic = await workerEvaluate(browser, workerSessionId, `(async()=>{
    const source=String(mlsAthenaActionV2DriverFn);
    const needle="if (candidates.length !== 1) return { ok: false, blocked: true, reason: candidates.length ? 'context-mismatch' : (mode === 'teach' && sawOtherPatient ? 'patient-mismatch' : 'context-unverified'), error: mode === 'teach' && sawOtherPatient ? 'The open Athena chart is not the patient in this review.' : 'Could not identify one exact patient encounter frame.' };";
    const replacement="return {ok:false,blocked:true,reason:'gate-diagnostic',frames:frames.map(function(fr){var eid=encounterId(fr.url),header=anchoredIdentity(fr),identity=header.identity,scopes=explicitNoteScopes(fr),note=findNoteAction(fr,action),appointment=(note&&identity)?appointmentIdFor(fr,note.root,identity.root):'',metadata=(note&&identity)?encounterMetadataFor(fr,note.root,identity.root):null,textareas=deepQueryAll(fr.doc,'textarea').map(function(el){return {visible:visible(el,fr.w),hay:editorHay(el),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height};});return {path:fr.path,url:fr.url,encounterId:eid,identity:identity?{name:identity.name,dob:identity.dob,mrn:identity.mrn}:null,identityAmbiguous:header.ambiguous===true,noteTarget:!!note,noteScopes:scopes.map(function(el){return {descriptor:scopeDescriptor(el),strength:noteScopeStrength(el),editors:editorsIn(el,fr).length};}),textareas:textareas,appointmentId:appointment,metadata:metadata?{visitDate:metadata.visitDate,provider:metadata.provider}:null};})};";
    if(source.indexOf(needle)<0)return {error:'diagnostic-driver-anchor-missing'};
    const diagnosticFn=(0,eval)('('+source.replace(needle,replacement)+')');
    const rows=await chrome.scripting.executeScript({target:{tabId:${Number(athenaTabId)}},world:'MAIN',args:[${JSON.stringify({ mode: 'probe', action: 'write_note', expectedPatient: SYNTHETIC_EXACT_PATIENT, expectedContext: SYNTHETIC_EXACT_CONTEXT, noteText: 'Read-only encounter context verification payload.', notePolicy: 'empty_only' })}],func:diagnosticFn});
    return rows&&rows[0]&&rows[0].result||null;
  })()`);

  const probe = await bridge(trusted, 'mlsAppAthenaActionV2', probePayload, 40000);
  assert.strictEqual(probe.count, 1, `ActionV2 probe returned duplicate/missing receipt: ${JSON.stringify(probe)}`);
  assert.strictEqual(probe.first.type, 'mlsAppAthenaActionV2Result', 'ActionV2 probe returned the wrong bridge receipt');
  const probeResp = probe.first.resp || {};
  assert.strictEqual(probeResp.ok, true, `ActionV2 read-only probe failed: ${JSON.stringify({ response: probeResp, fixture: fixtureDiagnostic, direct: directDriverDiagnostic })}`);
  assert.strictEqual(probeResp.mode, 'probe', 'ActionV2 receipt changed out of probe mode');
  assert.strictEqual(probeResp.action, 'write_note', 'ActionV2 receipt changed the typed action');
  assert.strictEqual(probeResp.readOnly, true, 'ActionV2 receipt did not prove read-only mode');
  assert.strictEqual(probeResp.noAutomaticChaining, 'no-automatic-chaining', 'ActionV2 receipt lost the no-chaining guarantee');
  assert.strictEqual(typeof probeResp.actionToken, 'string', 'ActionV2 probe returned no ephemeral token');
  assert(probeResp.actionToken.length >= 16 && Number(probeResp.expiresAt) > Date.now(), 'ActionV2 probe token was empty or already expired');
  const context = probeResp.context || {};
  assert.strictEqual(context.patientName, SYNTHETIC_EXACT_PATIENT.name, 'ActionV2 context receipt changed the patient name');
  assert.strictEqual(context.dob, '4/12/1981', 'ActionV2 context receipt changed the patient DOB');
  assert.strictEqual(context.mrn, SYNTHETIC_EXACT_PATIENT.mrn, 'ActionV2 context receipt changed the patient MRN');
  assert.strictEqual(context.appointmentId, SYNTHETIC_EXACT_APPOINTMENT_ID, 'ActionV2 context receipt changed the appointment id');
  assert.strictEqual(context.encounterId, SYNTHETIC_EXACT_ENCOUNTER_ID, 'ActionV2 context receipt did not bind the encounter id');
  assert.strictEqual(context.encounterUrl, SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL, 'ActionV2 context receipt did not bind the exact encounter URL');
  assert.strictEqual(context.visitDate, '7/18/2026', 'ActionV2 context receipt changed the visit date');
  assert.strictEqual(context.provider, SYNTHETIC_EXACT_CONTEXT.provider, 'ActionV2 context receipt changed the provider');
  assert.strictEqual(context.framePath, 'top.0', `ActionV2 context receipt did not identify the exact encounter frame: ${JSON.stringify(context)}`);
  for (const key of ['encounterRootFingerprint', 'controlFingerprint', 'noteScopeFingerprint', 'actionContainerFingerprint', 'editorFingerprint', 'contextHash']) {
    assert(/^[0-9a-f]{8}$/.test(String(context[key] || '')), `ActionV2 context receipt lacks ${key}: ${JSON.stringify(context)}`);
  }
  assert.strictEqual(context.controlLabel, 'Visit narrative field', 'ActionV2 context receipt changed the typed read-only destination');
  await sleep(250);
  const afterProbe = await evaluate(athena, encounterStateExpression);
  assert.deepStrictEqual(afterProbe.audit, beforeProbe.audit, `ActionV2 probe changed the exact encounter audit: ${JSON.stringify({ before: beforeProbe.audit, after: afterProbe.audit })}`);
  assertReadOnlyEncounterState(afterProbe, 'after ActionV2 probe');

  const wrongIdentityProbe = await bridge(trusted, 'mlsAppAthenaActionV2', Object.assign({}, probePayload, {
    previewHash: 'isolated-live-wrong-identity-probe-v1',
    expectedPatient: Object.assign({}, SYNTHETIC_EXACT_PATIENT, { name: 'Jordan Different', mrn: '9009999' })
  }), 40000);
  assert.strictEqual(wrongIdentityProbe.count, 1, 'wrong-identity ActionV2 probe returned duplicate/missing receipt');
  assert(wrongIdentityProbe.first.resp && wrongIdentityProbe.first.resp.ok === false && wrongIdentityProbe.first.resp.blocked === true, `wrong-identity ActionV2 probe did not fail closed: ${JSON.stringify(wrongIdentityProbe.first)}`);
  assert.strictEqual(wrongIdentityProbe.first.resp.reason, 'context-unverified', `wrong-identity ActionV2 probe returned the wrong refusal: ${JSON.stringify(wrongIdentityProbe.first.resp)}`);
  assert(!wrongIdentityProbe.first.resp.actionToken, 'wrong-identity ActionV2 probe minted a token');
  const afterWrongProbe = await evaluate(athena, encounterStateExpression);
  assert.deepStrictEqual(afterWrongProbe.audit, beforeProbe.audit, 'wrong-identity probe changed the synthetic encounter');
  assertReadOnlyEncounterState(afterWrongProbe, 'after wrong-identity ActionV2 probe');

  await navigateSyntheticPage(
    athena,
    SYNTHETIC_ATHENA_EXACT_WRONG_IDENTITY_URL,
    'synthetic wrong-identity appointment schedule',
    `document.readyState==='complete' && document.querySelectorAll('[data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"]').length===1`
  );
  const wrongIdentityOpen = await bridge(trusted, 'mlsAppSearchOpenPatient', Object.assign({}, openPayload, { deadlineAt: Date.now() + 30000 }), 38000);
  assert.strictEqual(wrongIdentityOpen.count, 1, 'wrong-identity exact open returned duplicate/missing receipt');
  assert.strictEqual(wrongIdentityOpen.first.ok, false, `wrong-identity exact row was opened: ${JSON.stringify(wrongIdentityOpen.first)}`);
  assert.strictEqual(wrongIdentityOpen.first.opened, false, 'wrong-identity exact row claimed it opened');
  assert.strictEqual(wrongIdentityOpen.first.reason, 'appointment-id-not-found', `wrong-identity exact row returned the wrong refusal: ${JSON.stringify(wrongIdentityOpen.first)}`);
  const wrongOpenAudit = await evaluate(athena, `window.__syntheticExactScheduleAudit`);
  assert.deepStrictEqual(wrongOpenAudit, { rowClicks: 0, framesCreated: 0 }, `wrong-identity exact open touched its row: ${JSON.stringify(wrongOpenAudit)}`);

  await navigateSyntheticPage(
    athena,
    SYNTHETIC_ATHENA_EXACT_AMBIGUOUS_URL,
    'synthetic ambiguous exact-appointment schedule',
    `document.readyState==='complete' && document.querySelectorAll('[data-appointment-id="${SYNTHETIC_EXACT_APPOINTMENT_ID}"]').length===2`
  );
  const ambiguousOpen = await bridge(trusted, 'mlsAppSearchOpenPatient', Object.assign({}, openPayload, { deadlineAt: Date.now() + 30000 }), 38000);
  assert.strictEqual(ambiguousOpen.count, 1, 'ambiguous exact open returned duplicate/missing receipt');
  assert.strictEqual(ambiguousOpen.first.ok, false, `ambiguous exact appointment opened: ${JSON.stringify(ambiguousOpen.first)}`);
  assert.strictEqual(ambiguousOpen.first.opened, false, 'ambiguous exact appointment claimed it opened');
  assert.strictEqual(ambiguousOpen.first.reason, 'appointment-id-ambiguous', `ambiguous exact appointment returned the wrong refusal: ${JSON.stringify(ambiguousOpen.first)}`);
  const ambiguousAudit = await evaluate(athena, `window.__syntheticExactScheduleAudit`);
  assert.deepStrictEqual(ambiguousAudit, { rowClicks: 0, framesCreated: 0 }, `ambiguous exact appointment touched a row: ${JSON.stringify(ambiguousAudit)}`);

  const appAudit = await evaluate(trusted, `window.__mlsExactBridgeAudit.slice()`);
  const appRequests = appAudit.filter((row) => row.source === 'mls-app');
  assert.deepStrictEqual(appRequests.map((row) => row.type), [
    'mlsAppSearchOpenPatient', 'mlsAppAthenaActionV2', 'mlsAppAthenaActionV2',
    'mlsAppSearchOpenPatient', 'mlsAppSearchOpenPatient'
  ], `exact-opener app bridge dispatched an extra command: ${JSON.stringify(appRequests)}`);
  assert(appRequests.filter((row) => row.type === 'mlsAppAthenaActionV2').every((row) => row.mode === 'probe'), `exact-opener app bridge dispatched an execute: ${JSON.stringify(appRequests)}`);
  assert(!appRequests.some((row) => row.type === 'mlsAppPullSchedule'), `exact-opener app bridge dispatched a schedule pull: ${JSON.stringify(appRequests)}`);

  const runtimeAudit = await workerEvaluate(browser, workerSessionId, `self.__mlsExactRuntimeAudit.slice()`);
  const searchRuntime = runtimeAudit.filter((row) => row.type === 'mlsAppSearchOpenRequest');
  const actionRuntime = runtimeAudit.filter((row) => row.type === 'mlsAppAthenaActionV2Request');
  assert.strictEqual(searchRuntime.length, 3, `worker did not receive exactly three isolated exact-open requests: ${JSON.stringify(runtimeAudit)}`);
  assert(searchRuntime.every((row) => row.bootstrapIdentity === true && row.appointmentId === SYNTHETIC_EXACT_APPOINTMENT_ID), `worker exact-open request lost its immutable binding: ${JSON.stringify(searchRuntime)}`);
  assert.strictEqual(actionRuntime.length, 2, `worker did not receive exactly two read-only probes: ${JSON.stringify(runtimeAudit)}`);
  assert(actionRuntime.every((row) => row.mode === 'probe' && row.action === 'write_note'), `worker received a non-probe AthenaActionV2 request: ${JSON.stringify(actionRuntime)}`);
  assert(!runtimeAudit.some((row) => /PullSchedule|GotoDate|VerifiedWrite|PasteNote|PushVisit|SignAndSave/i.test(row.type)), `exact-opener path dispatched a schedule/navigation/write command: ${JSON.stringify(runtimeAudit)}`);
  assert(!runtimeAudit.some((row) => row.mode === 'execute'), `exact-opener path dispatched an execute request: ${JSON.stringify(runtimeAudit)}`);

  return {
    navigationFrameIds: navigationFrameIds.slice(),
    framePath: context.framePath,
    encounterId: context.encounterId,
    contextHash: context.contextHash,
    wrongIdentityReason: wrongIdentityProbe.first.resp.reason,
    wrongOpenReason: wrongIdentityOpen.first.reason,
    ambiguousReason: ambiguousOpen.first.reason,
    runtimeMessages: runtimeAudit.length
  };
}

async function overlaySnapshot(cdp) {
  return evaluate(cdp, `(() => {
    const shown=(el)=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0};
    const roots=[...document.querySelectorAll('#mls-popup-root')],legacy=[...document.querySelectorAll('#mls-assist-panel')],root=roots[0]||null;
    const cards=root?[...root.querySelectorAll('.mlsp-card')]:[],pills=root?[...root.querySelectorAll('.mlsp-pill')]:[],closes=root?[...root.querySelectorAll('.mlsp-head .mlsp-iconbtn')]:[];
    return {rootCount:roots.length,legacyCount:legacy.length,cardCount:cards.length,pillCount:pills.length,closeCount:closes.length,cardVisible:cards.length===1&&shown(cards[0]),pillVisible:pills.length===1&&shown(pills[0]),ownerToken:root&&root.getAttribute('data-live-owner-token')||''};
  })()`);
}

async function openAthenaOverlay(browser, workerSessionId, tabId, label) {
  const delivery = await workerEvaluate(browser, workerSessionId, `(async()=>{
    try { const response=await chrome.tabs.sendMessage(${Number(tabId)}, {type:'mlsOpenPanel'});return {delivered:true,response:response||null}; }
    catch(error) { return {delivered:false,error:String(error&&error.message||error)}; }
  })()`);
  assert.strictEqual(delivery.delivered, true, `${label}: runtime mlsOpenPanel was not delivered: ${JSON.stringify(delivery)}`);
  assert.deepStrictEqual(delivery.response, { ok: true, surface: 'athena-widget' }, `${label}: runtime open receipt changed`);
  return delivery;
}

async function proveAthenaOverlayOwnership(browser, workerSessionId, athena) {
  const tabs = await workerEvaluate(browser, workerSessionId, `(async()=>{const rows=await chrome.tabs.query({});return rows.filter(tab=>/^https:\\/\\/athenanet\\.athenahealth\\.com\\//.test(tab.url||'')).map(tab=>({id:tab.id,url:tab.url,title:tab.title||''}))})()`);
  assert.strictEqual(tabs.length, 1, `overlay proof expected exactly one synthetic Athena tab: ${JSON.stringify(tabs)}`);
  const tabId = tabs[0].id;
  /* The shipped widget is deliberately disabled unless its isolated content-
     script world explicitly opts in. A page-level fixture variable cannot
     cross Chrome's isolated-world boundary. Opt in only this synthetic tab,
     dispose the initially disabled API, and inject the exact packaged widget
     again so this optional-surface lifecycle proof remains meaningful without
     changing the production default or any shipped runtime bytes. */
  const optIn = await workerEvaluate(browser, workerSessionId, `(async()=>{try{
    await chrome.scripting.executeScript({target:{tabId:${Number(tabId)}},func:()=>{
      window.__mlsPopupShowOnAthena=true;
      try { if(window.__mlsPopup&&typeof window.__mlsPopup.revert==='function') window.__mlsPopup.revert(); } catch(error) {}
      return window.__mlsPopupShowOnAthena===true;
    }});
    await chrome.scripting.executeScript({target:{tabId:${Number(tabId)}},files:['mls-popup.js']});
    return {ok:true};
  }catch(error){return {ok:false,error:String(error&&error.message||error)}}})()`);
  assert.deepStrictEqual(optIn, { ok: true }, `synthetic Athena overlay opt-in failed: ${JSON.stringify(optIn)}`);
  await waitFor(athena, `document.querySelectorAll('#mls-popup-root').length===1 && !!document.querySelector('#mls-popup-root .mlsp-pill')`, 'canonical Athena overlay owner', 30000);
  const ownerToken = 'live-extension-candidate-owner';
  const initial = await evaluate(athena, `(() => {const root=document.getElementById('mls-popup-root');if(!root)return false;root.setAttribute('data-live-owner-token',${JSON.stringify(ownerToken)});return true})()`);
  assert.strictEqual(initial, true, 'canonical Athena overlay root was not available for ownership proof');
  const before = await overlaySnapshot(athena);
  assert.deepStrictEqual(before, { rootCount: 1, legacyCount: 0, cardCount: 0, pillCount: 1, closeCount: 0, cardVisible: false, pillVisible: true, ownerToken }, `canonical Athena overlay did not start with one collapsed owner: ${JSON.stringify(before)}`);

  const cycles = [];
  for (let run = 1; run <= 2; run++) {
    const receipt = await openAthenaOverlay(browser, workerSessionId, tabId, `overlay cycle ${run}`);
    await waitFor(athena, `document.querySelectorAll('#mls-popup-root').length===1 && document.querySelectorAll('#mls-popup-root .mlsp-card').length===1`, `overlay cycle ${run} open`, 10000);
    const opened = await overlaySnapshot(athena);
    assert.deepStrictEqual(opened, { rootCount: 1, legacyCount: 0, cardCount: 1, pillCount: 0, closeCount: 1, cardVisible: true, pillVisible: false, ownerToken }, `overlay cycle ${run}: duplicate, stale, or invisible open owner: ${JSON.stringify(opened)}`);
    const clicked = await evaluate(athena, `(() => {const rows=[...document.querySelectorAll('#mls-popup-root .mlsp-head .mlsp-iconbtn')];if(rows.length!==1)return false;rows[0].click();return true})()`);
    assert.strictEqual(clicked, true, `overlay cycle ${run}: canonical collapse control was missing or duplicated`);
    await waitFor(athena, `document.querySelectorAll('#mls-popup-root').length===1 && document.querySelectorAll('#mls-popup-root .mlsp-pill').length===1`, `overlay cycle ${run} close`, 10000);
    const closed = await overlaySnapshot(athena);
    assert.deepStrictEqual(closed, { rootCount: 1, legacyCount: 0, cardCount: 0, pillCount: 1, closeCount: 0, cardVisible: false, pillVisible: true, ownerToken }, `overlay cycle ${run}: close left a duplicate or stale owner: ${JSON.stringify(closed)}`);
    cycles.push({ run, receipt, opened, closed });
  }
  return { tabId, ownerToken, before, cycles };
}

async function proveOfflineScheduleRecovery(browser, workerSessionId, athena, trusted, athenaTabId) {
  let offline = false, firewallDisabled = false;
  const startedAt = Date.now();
  try {
    await athena.send('Network.enable');
    await athena.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: 'none' });
    offline = true;
    await athena.send('Page.navigate', { url: 'about:blank' });
    await waitFor(athena, `location.href==='about:blank' && document.readyState==='complete'`, 'offline proof blank isolation', 10000);
    await setSyntheticFirewall(athena, false);
    firewallDisabled = true;
    const offlineNavigation = await athena.send('Page.navigate', { url: SYNTHETIC_ATHENA_SCHEDULE_URL });
    assert.strictEqual(String(offlineNavigation && offlineNavigation.errorText || ''), 'net::ERR_INTERNET_DISCONNECTED', `CDP offline navigation did not prove the renderer was offline: ${JSON.stringify(offlineNavigation)}`);
    const failureStartedAt = Date.now();
    const failure = await bridge(trusted, 'mlsAppPullSchedule', { deadlineAt: Date.now() + 12000 }, 17000);
    const failureElapsedMs = Date.now() - failureStartedAt;
    assert.strictEqual(failure.count, 1, `offline schedule pull returned duplicate/missing failure receipt: ${JSON.stringify(failure)}`);
    assert.strictEqual(failure.first.type, 'mlsAppScheduleResult', 'offline schedule pull bypassed the schedule response contract');
    assert(failure.first.resp && failure.first.resp.ok === false, `offline schedule pull did not fail closed: ${JSON.stringify(failure.first.resp)}`);
    assert(failure.first.resp.reason, `offline schedule failure did not provide a bounded reason: ${JSON.stringify(failure.first.resp)}`);
    assert.notStrictEqual(failure.first.resp.scheduleVerified, true, `offline schedule failure claimed a verified surface: ${JSON.stringify(failure.first.resp)}`);
    assert(!Array.isArray(failure.first.resp.appts) || failure.first.resp.appts.length === 0, `offline schedule failure returned appointments: ${JSON.stringify(failure.first.resp.appts)}`);
    assert(failureElapsedMs < 17000, `offline schedule failure exceeded its bounded receipt window: ${failureElapsedMs}ms`);

    await setSyntheticFirewall(athena, true);
    firewallDisabled = false;
    await athena.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' });
    offline = false;
    await navigateSyntheticPage(athena, SYNTHETIC_ATHENA_SCHEDULE_URL, 'online synthetic Athena recovery', `document.readyState==='complete' && !!document.querySelector('[data-testid="schedule-grid"]')`);
    /* Navigation creates a fresh isolated world, so restore the synthetic-only
       overlay opt-in before asserting the test fixture's canonical owner. */
    const recoveredOverlayOptIn = await workerEvaluate(browser, workerSessionId, `(async()=>{try{
      await chrome.scripting.executeScript({target:{tabId:${Number(athenaTabId)}},func:()=>{
        window.__mlsPopupShowOnAthena=true;
        try { if(window.__mlsPopup&&typeof window.__mlsPopup.revert==='function') window.__mlsPopup.revert(); } catch(error) {}
        return window.__mlsPopupShowOnAthena===true;
      }});
      await chrome.scripting.executeScript({target:{tabId:${Number(athenaTabId)}},files:['mls-popup.js']});
      return {ok:true};
    }catch(error){return {ok:false,error:String(error&&error.message||error)}}})()`);
    assert.deepStrictEqual(recoveredOverlayOptIn, { ok: true }, `recovered synthetic Athena overlay opt-in failed: ${JSON.stringify(recoveredOverlayOptIn)}`);
    await waitFor(athena, `document.querySelectorAll('#mls-popup-root').length===1`, 'recovered Athena content owner', 30000);
    const recovery = await bridge(trusted, 'mlsAppPullSchedule', { deadlineAt: Date.now() + 30000 }, 45000);
    assertSyntheticSchedule(recovery, 'online recovery');
    return { offlineNavigation, failure, failureElapsedMs, recovery, totalElapsedMs: Date.now() - startedAt };
  } finally {
    if (firewallDisabled) { try { await setSyntheticFirewall(athena, true); } catch (_) {} }
    if (offline) { try { await athena.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: 'wifi' }); } catch (_) {} }
  }
}

async function workerTargets(browser, extensionId = '') {
  const result = await browser.send('Target.getTargets');
  return (result.targetInfos || []).filter((target) => {
    if (target.type !== 'service_worker' || !/^chrome-extension:\/\//.test(target.url || '')) return false;
    return !extensionId || new URL(target.url).hostname === extensionId;
  });
}

async function inspectWorkerTarget(browser, target) {
  let sessionId = '';
  try {
    const attached = await browser.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    sessionId = attached.sessionId;
    await browser.send('Runtime.enable', {}, 30000, sessionId);
    const workerState = await workerEvaluate(browser, sessionId, `({manifest:chrome.runtime&&chrome.runtime.getManifest?chrome.runtime.getManifest():null,apis:{tabs:!!chrome.tabs,scripting:!!chrome.scripting,storage:!!chrome.storage}})`);
    return { target, sessionId, workerState };
  } catch (error) {
    if (sessionId) {
      try { await browser.send('Target.detachFromTarget', { sessionId }); } catch (_) {}
    }
    return { target, sessionId: '', error: String(error && error.message || error) };
  }
}

async function waitForMlsWorkers(browser, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let diagnostics = [];
  while (Date.now() < end) {
    const targets = await workerTargets(browser);
    const inspected = [];
    const matches = [];
    for (const target of targets) {
      const result = await inspectWorkerTarget(browser, target);
      inspected.push({
        id: target.targetId,
        url: target.url,
        name: result.workerState && result.workerState.manifest && result.workerState.manifest.name,
        version: result.workerState && result.workerState.manifest && result.workerState.manifest.version,
        error: result.error || ''
      });
      if (result.workerState && result.workerState.manifest && result.workerState.manifest.name === 'MLS Assist') {
        matches.push(result);
      } else if (result.sessionId) {
        try { await browser.send('Target.detachFromTarget', { sessionId: result.sessionId }); } catch (_) {}
      }
    }
    diagnostics = inspected;
    if (matches.length) return { matches, diagnostics };
    await sleep(100);
  }
  return { matches: [], diagnostics };
}

async function workerEvaluate(browser, sessionId, expression, timeoutMs = 30000) {
  const result = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs, sessionId);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || 'worker Runtime.evaluate failed');
  }
  return result.result && result.result.value;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.requirePackageInventory) assertPackageInventory(options.candidate, 'candidate');
  const manifest = manifestAt(options.candidate);
  assert.strictEqual(manifest.name, 'MLS Assist', 'candidate manifest is not MLS Assist');
  const digest = coreDigest(options.candidate);
  const candidateFileDigests = packageFileDigests(options.candidate);
  const expectedVersionName = `${manifest.version}+core-sha256:${digest}`;
  if (!options.allowUnstamped) assert.strictEqual(manifest.version_name, expectedVersionName, 'candidate core digest is unstamped or stale');
  const expectedRuntimeBuildId = options.allowUnstamped
    ? (manifest.version_name || manifest.version)
    : expectedVersionName;

  let baseline = null;
  let baselineDigest = null;
  let baselineFileDigests = null;
  if (options.baseline) {
    assertPackageInventory(options.baseline, 'rollback baseline');
    baseline = manifestAt(options.baseline);
    assert.strictEqual(baseline.name, 'MLS Assist', 'rollback baseline is not MLS Assist');
    assert.notStrictEqual(path.resolve(options.baseline), path.resolve(options.candidate), 'candidate and rollback baseline must be separate directories');
    baselineDigest = coreDigest(options.baseline);
    baselineFileDigests = packageFileDigests(options.baseline);
    assert.strictEqual(baseline.version_name, `${baseline.version}+core-sha256:${baselineDigest}`,
      'rollback baseline is not internally digest-verified; refusing to treat it as a known-good immutable fallback');
  }

  const chromeSelection = findChrome(options.chrome);
  const verifiedBrowser = await verifyCachedBrowser(chromeSelection);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-extension-candidate-'));
  let chrome = null, browser = null, trusted = null, mydata = null, athenaDeveloper = null, athena = null, popupPage = null;
  try {
    chrome = await launch(chromeSelection.path, options.candidate, profile, options.headed);
    browser = await Cdp.connect(chrome.browserWs);
    const browserVersion = await browser.send('Browser.getVersion');
    if (chromeSelection.metadata) {
      assert(String(browserVersion.product || '').endsWith(`/${chromeSelection.metadata.version}`), `Chrome for Testing executable version does not match SOURCE.json: ${JSON.stringify(browserVersion)}`);
    }

    const discovered = await waitForMlsWorkers(browser);
    assert.strictEqual(discovered.matches.length, 1, `expected exactly one MLS Assist service worker, got ${discovered.matches.length}; browser=${JSON.stringify(browserVersion)}; workers=${JSON.stringify(discovered.diagnostics)}; stderr=${chrome.stderr().slice(-4000)}. Branded Google Chrome 137+ ignores --load-extension; use the workspace Chrome for Testing cache or pass a supported unbranded browser.`);
    const mlsWorker = discovered.matches[0];
    const extensionId = new URL(mlsWorker.target.url).hostname;
    const attachedWorker = { sessionId: mlsWorker.sessionId };
    const workerManifest = mlsWorker.workerState;
    assert(workerManifest && workerManifest.manifest && workerManifest.manifest.name === 'MLS Assist', `wrong extension worker selected: ${JSON.stringify({ workers: discovered.diagnostics, workerManifest })}`);
    assert.strictEqual(workerManifest.manifest.version, manifest.version,
      'loaded service worker version does not match the candidate manifest bytes');
    assert.strictEqual(workerManifest.manifest.version_name || workerManifest.manifest.version, expectedRuntimeBuildId,
      'loaded service worker build ID does not match the stamped candidate bytes');

    popupPage = await createPage(chrome.port, `chrome-extension://${extensionId}/popup.html`);
    await waitFor(popupPage, `location.protocol==='chrome-extension:' && document.readyState==='complete'`, 'candidate popup', 30000);
    const popupState = await evaluate(popupPage, `(() => {
      const controls=[...document.querySelectorAll('input,button')];
      const unlabeled=[...document.querySelectorAll('input')].filter(input=>{
        const explicit=document.querySelector('label[for="'+CSS.escape(input.id)+'"]');
        return !explicit&&!input.closest('label')&&!input.getAttribute('aria-label')&&!input.getAttribute('aria-labelledby');
      }).map(input=>input.id||input.type);
      const statuses=[...document.querySelectorAll('[role="status"][aria-live="polite"]')].map(el=>el.id);
      return {title:document.title||'',controls:controls.length,unlabeled,statuses,
        bodyWidth:document.body.getBoundingClientRect().width,scrollWidth:document.body.scrollWidth,
        hasOpen:!!document.getElementById('openTab'),hasSchedule:!!document.getElementById('bkSave')};
    })()`);
    assert.strictEqual(popupState.title, 'MLS Assist', `candidate popup lacks its product title: ${JSON.stringify(popupState)}`);
    assert.strictEqual(popupState.unlabeled.length, 0, `candidate popup has unlabeled inputs: ${JSON.stringify(popupState)}`);
    assert(popupState.statuses.includes('conn') && popupState.statuses.includes('bkStatus') && popupState.statuses.includes('ok'), `candidate popup status changes are not announced: ${JSON.stringify(popupState)}`);
    assert(popupState.hasOpen && popupState.hasSchedule && popupState.controls >= 7, `candidate popup lost a primary control: ${JSON.stringify(popupState)}`);
    assert(popupState.scrollWidth <= popupState.bodyWidth + 1, `candidate popup has horizontal overflow: ${JSON.stringify(popupState)}`);
    popupPage.close(); popupPage = null;

    trusted = await createSyntheticOriginPage(
      chrome.port,
      'https://mlsscribe.com/ScribeFlow.html?demo=1',
      () => SYNTHETIC_MLS_HTML
    );
    await waitFor(trusted, `location.origin==='https://mlsscribe.com' && document.readyState==='complete'`, 'exact MLS origin', 30000);
    const contentDiagnostic = await workerEvaluate(browser, attachedWorker.sessionId, `(async()=>{const all=await chrome.tabs.query({});const probes=[];for(const tab of all){try{const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({origin:location.origin,href:location.href,loaded:!!window.__mlsAssistLoaded})});probes.push({id:tab.id,result:result.map(x=>x.result)})}catch(error){probes.push({id:tab.id,error:String(error&&error.message||error)})}}return {all:all.map(t=>({id:t.id,url:t.url||'',pendingUrl:t.pendingUrl||'',status:t.status,title:t.title||''})),probes}})()`);
    const trustedTabIds = new Set(contentDiagnostic.all.filter((tab) => /^https:\/\/mlsscribe\.com\//.test(tab.url)).map((tab) => tab.id));
    const injectedTrustedTabs = contentDiagnostic.probes.filter((probe) => trustedTabIds.has(probe.id) && Array.isArray(probe.result) && probe.result.some((frame) => frame && frame.origin === 'https://mlsscribe.com' && frame.loaded === true));
    assert.strictEqual(trustedTabIds.size, 1, `expected one synthetic trusted MLS tab, got ${trustedTabIds.size}: ${JSON.stringify(contentDiagnostic)}`);
    assert.strictEqual(injectedTrustedTabs.length, 1, `the MLS Assist candidate's content bridge did not inject into the trusted synthetic tab: ${JSON.stringify(contentDiagnostic)}`);

    mydata = await createSyntheticOriginPage(
      chrome.port,
      SYNTHETIC_MYDATA_URL,
      () => SYNTHETIC_MYDATA_HTML
    );
    const mydataNegativeProof = await proveNegativeAthenaOrigin(browser, attachedWorker.sessionId, trusted, mydata, SYNTHETIC_MYDATA_URL, 'mydata.athenahealth.com');

    athenaDeveloper = await createSyntheticOriginPage(
      chrome.port,
      SYNTHETIC_ATHENA_DEVELOPER_URL,
      () => SYNTHETIC_ATHENA_DEVELOPER_HTML
    );
    const developerNegativeProof = await proveNegativeAthenaOrigin(browser, attachedWorker.sessionId, trusted, athenaDeveloper, SYNTHETIC_ATHENA_DEVELOPER_URL, 'developer.api.athena.io');

    athena = await createSyntheticOriginPage(
      chrome.port,
      SYNTHETIC_ATHENA_SCHEDULE_URL,
      (requestUrl) => {
        const parsedUrl = new URL(requestUrl);
        const pathname = parsedUrl.pathname;
        if (pathname === '/1/1/ax/dashboard') {
          return '<!doctype html><html><body><main>Signed-in synthetic Athena dashboard</main></body></html>';
        }
        if (pathname === new URL(SYNTHETIC_ATHENA_SCHEDULE_URL).pathname) return SYNTHETIC_ATHENA_SCHEDULE_HTML;
        if (pathname === new URL(SYNTHETIC_ATHENA_CHART_URL).pathname) return SYNTHETIC_ATHENA_CHART_HTML;
        if (pathname === new URL(SYNTHETIC_ATHENA_EXACT_SCHEDULE_URL).pathname) {
          return syntheticExactScheduleHtml(parsedUrl.searchParams.get('fixture') || 'happy');
        }
        if (pathname === new URL(SYNTHETIC_ATHENA_EXACT_ENCOUNTER_URL).pathname) return SYNTHETIC_ATHENA_EXACT_ENCOUNTER_HTML;
        return null;
      },
      (requestUrl) => new URL(requestUrl).pathname === '/1/1/ax/dashboard'
        ? '<!doctype html><html><body><main>Signed-in synthetic Athena dashboard</main></body></html>'
        : null
    );
    await waitFor(athena, `location.href===${JSON.stringify(SYNTHETIC_ATHENA_SCHEDULE_URL)} && !!document.querySelector('[data-testid="schedule-grid"]')`, 'synthetic Athena schedule', 30000);
    const overlayProof = await proveAthenaOverlayOwnership(browser, attachedWorker.sessionId, athena);
    assert.strictEqual(overlayProof.cycles.length, 2, 'canonical Athena overlay did not complete both ownership cycles');

    for (let run = 1; run <= options.runs; run++) {
      if (run > 1) {
        await trusted.send('Page.reload', { ignoreCache: true });
        await waitFor(trusted, `location.origin==='https://mlsscribe.com' && document.readyState==='complete'`, `trusted reload ${run}`, 30000);
      }
      await navigateSyntheticPage(
        athena,
        SYNTHETIC_ATHENA_SCHEDULE_URL,
        `synthetic Athena schedule ${run}`,
        `document.readyState==='complete' && !!document.querySelector('[data-testid="schedule-grid"]')`
      );
      const ping = await bridge(trusted, 'mlsPing', {}, 30000);
      assert.strictEqual(ping.count, 1, `run ${run}: duplicate/missing ping receipt; worker=${JSON.stringify(workerManifest)}; content=${JSON.stringify(contentDiagnostic)}; stderr=${chrome.stderr().slice(-2000)}`);
      assert.strictEqual(ping.first.type, 'mlsPong');
      assert.strictEqual(ping.first.version, manifest.version);
      assert.strictEqual(ping.first.buildId, expectedRuntimeBuildId,
        `run ${run}: content bridge build ID does not match the stamped candidate bytes`);
      const health = await bridge(trusted, 'mlsExtHealth', {}, 30000);
      assert.strictEqual(health.count, 1, `run ${run}: duplicate/missing health receipt`);
      assert(health.first.resp && health.first.resp.ok === true, `run ${run}: worker health failed`);
      assert.strictEqual(health.first.resp.version, manifest.version);
      assert.strictEqual(health.first.resp.versionName, expectedRuntimeBuildId,
        `run ${run}: worker health build ID does not match the stamped candidate bytes`);
      assert.deepStrictEqual(health.first.resp.athena, { tabs: 1, discarded: 0 });
      const schedule = await bridge(trusted, 'mlsAppPullSchedule', { deadlineAt: Date.now() + 30000 }, 45000);
      assertSyntheticSchedule(schedule, `run ${run}`);
    }

    const exactAppointmentProof = await proveExactScheduledAppointmentOpenAndProbe(
      browser,
      attachedWorker.sessionId,
      trusted,
      athena,
      overlayProof.tabId
    );

    const offlineProof = await proveOfflineScheduleRecovery(browser, attachedWorker.sessionId, athena, trusted, overlayProof.tabId);
    assert(offlineProof.failureElapsedMs < 17000, 'offline failure receipt exceeded its bound');

    await navigateSyntheticPage(
      athena,
      SYNTHETIC_ATHENA_CHART_URL,
      'synthetic Athena chart-shaped non-schedule',
      `document.readyState==='complete' && document.title==='athenaOne | Encounter'`
    );
    const wrongSurface = await bridge(trusted, 'mlsAppPullSchedule', { deadlineAt: Date.now() + 30000 }, 45000);
    assert.strictEqual(wrongSurface.count, 1, 'chart-shaped surface returned duplicate/missing schedule receipt');
    assert.strictEqual(wrongSurface.first.type, 'mlsAppScheduleResult', 'chart-shaped surface bypassed the schedule response contract');
    assert(wrongSurface.first.resp && wrongSurface.first.resp.ok === false, `chart-shaped surface was accepted as a schedule: ${JSON.stringify(wrongSurface.first.resp)}`);
    assert.strictEqual(wrongSurface.first.resp.reason, 'schedule-surface-unverified', `chart-shaped refusal had the wrong reason: ${JSON.stringify(wrongSurface.first.resp)}`);
    assert.strictEqual(wrongSurface.first.resp.scheduleVerified, false, 'chart-shaped surface was incorrectly marked verified');
    assert(!Array.isArray(wrongSurface.first.resp.appts) || wrongSurface.first.resp.appts.length === 0, 'chart-shaped text leaked fabricated appointments');
    assert.deepStrictEqual(trusted.syntheticOrigin.state.blocked, [], `trusted synthetic page attempted an external request: ${JSON.stringify(trusted.syntheticOrigin.state.blocked)}`);
    assert.deepStrictEqual(mydata.syntheticOrigin.state.blocked, [], `non-clinical Athena synthetic page attempted an external request: ${JSON.stringify(mydata.syntheticOrigin.state.blocked)}`);
    assert.deepStrictEqual(athenaDeveloper.syntheticOrigin.state.blocked, [], `Athena developer synthetic page attempted an external request: ${JSON.stringify(athenaDeveloper.syntheticOrigin.state.blocked)}`);
    assert.deepStrictEqual(athena.syntheticOrigin.state.blocked, [], `Athena synthetic page attempted an external request: ${JSON.stringify(athena.syntheticOrigin.state.blocked)}`);
    assert.deepStrictEqual(trusted.syntheticOrigin.state.errors, [], 'trusted synthetic firewall reported an error');
    assert.deepStrictEqual(mydata.syntheticOrigin.state.errors, [], 'non-clinical Athena synthetic firewall reported an error');
    assert.deepStrictEqual(athenaDeveloper.syntheticOrigin.state.errors, [], 'Athena developer synthetic firewall reported an error');
    assert.deepStrictEqual(athena.syntheticOrigin.state.errors, [], 'Athena synthetic firewall reported an error');
    assert.strictEqual(trusted.syntheticOrigin.state.firewallEnabled, true, 'trusted synthetic firewall was not enabled at completion');
    assert.strictEqual(mydata.syntheticOrigin.state.firewallEnabled, true, 'non-clinical Athena synthetic firewall was not enabled at completion');
    assert.strictEqual(athenaDeveloper.syntheticOrigin.state.firewallEnabled, true, 'Athena developer synthetic firewall was not enabled at completion');
    assert.strictEqual(athena.syntheticOrigin.state.firewallEnabled, true, 'Athena synthetic firewall was not restored after offline proof');

    const beforeStop = await workerTargets(browser, extensionId);
    assert.strictEqual(beforeStop.length, 1, `expected one MLS Assist worker before stop, got ${beforeStop.length}`);
    let closeResult = null;
    try { closeResult = await browser.send('Target.closeTarget', { targetId: beforeStop[0].targetId }); }
    catch (error) { closeResult = { unsupported: error.message }; }
    await sleep(300);
    const wake = await bridge(trusted, 'mlsExtHealth', {}, 30000);
    assert.strictEqual(wake.count, 1, 'health did not wake/respond after service-worker stop attempt');
    assert(wake.first.resp && wake.first.resp.ok, 'worker wake health failed');
    assert.strictEqual(wake.first.resp.version, manifest.version, 'woken worker version changed');
    assert.strictEqual(wake.first.resp.versionName, expectedRuntimeBuildId, 'woken worker build ID changed');
    const afterWake = await workerTargets(browser, extensionId);
    assert.strictEqual(afterWake.length, 1, `worker did not return exactly once after wake: ${afterWake.length}`);

    if (options.requirePackageInventory) assertPackageInventory(options.candidate, 'candidate after run');
    assert.strictEqual(coreDigest(options.candidate), digest,
      'candidate core changed while the isolated acceptance gate was running');
    assert.deepStrictEqual(manifestAt(options.candidate), manifest,
      'candidate manifest changed while the isolated acceptance gate was running');
    assert.deepStrictEqual(packageFileDigests(options.candidate), candidateFileDigests,
      'one or more candidate release files changed byte-for-byte while the isolated acceptance gate was running');

    if (baseline) {
      assertPackageInventory(options.baseline, 'rollback baseline after run');
      assert.strictEqual(coreDigest(options.baseline), baselineDigest,
        'rollback baseline core changed while the candidate gate was running');
      assert.deepStrictEqual(manifestAt(options.baseline), baseline,
        'rollback baseline manifest changed while the candidate gate was running');
      assert.deepStrictEqual(packageFileDigests(options.baseline), baselineFileDigests,
        'one or more rollback baseline release files changed byte-for-byte while the candidate gate was running');
    }

    process.stdout.write(`PASS isolated extension candidate ${manifest.version}: ${options.runs}/${options.runs} exact-origin synthetic Athena schedule parses, exact appointment-id open + read-only ActionV2 receipt, ambiguity/wrong-identity refusals, zero probe writes/pulls, 2/2 canonical overlay ownership cycles, CDP offline fail-closed/online recovery, chart refusal, external-network firewall, reload cycles, worker wake${options.requirePackageInventory ? `, exact ${PACKAGE_FILES.length}-file package inventory` : ''}; extension ${extensionId}; browser ${browserVersion.product}; source ${chromeSelection.source}\n`);
    process.stdout.write(`Exact appointment proof: encounter ${exactAppointmentProof.encounterId}, frame ${exactAppointmentProof.framePath}, navigation frame IDs ${exactAppointmentProof.navigationFrameIds.join(',')}; refusals ${exactAppointmentProof.wrongIdentityReason}/${exactAppointmentProof.wrongOpenReason}/${exactAppointmentProof.ambiguousReason}; ${exactAppointmentProof.runtimeMessages} audited runtime messages and no execute/write/schedule-pull.\n`);
    process.stdout.write(`Negative Athena origin proofs: ${mydataNegativeProof.origin} tab ${mydataNegativeProof.tabId} and ${developerNegativeProof.origin} tab ${developerNegativeProof.tabId} had no overlay/content bridge or extension host access; health classified ${developerNegativeProof.healthAthena.tabs} clinical Athena tabs before athenanet opened.\n`);
    process.stdout.write(`Offline navigation: ${offlineProof.offlineNavigation.errorText}; receipt ${offlineProof.failure.first.resp.reason} in ${offlineProof.failureElapsedMs}ms; online recovery parsed ${offlineProof.recovery.first.resp.receipt.parsedCount}/${offlineProof.recovery.first.resp.receipt.expectedCount}. Canonical overlay owner ${overlayProof.ownerToken} remained singular; legacy #mls-assist-panel count 0.\n`);
    if (verifiedBrowser) process.stdout.write(`Verified Chrome for Testing metadata and archive SHA-256: ${verifiedBrowser.sha256 || 'archive not retained'}\n`);
    if (closeResult && closeResult.unsupported) process.stdout.write(`Worker stop unsupported by this Chrome; wake response still passed: ${closeResult.unsupported}\n`);
    if (baseline) process.stdout.write(`Rollback baseline preserved separately: ${baseline.version}\n`);
  } finally {
    if (popupPage) popupPage.close();
    if (athena) athena.close();
    if (athenaDeveloper) athenaDeveloper.close();
    if (mydata) mydata.close();
    if (trusted) trusted.close();
    if (browser) {
      try { await browser.send('Browser.close', {}, 5000); } catch (_) {}
      browser.close();
    }
    if (chrome && chrome.child) {
      let exited = await waitForChildExit(chrome.child, 5000);
      if (!exited) {
        try { chrome.child.kill(); } catch (_) {}
        exited = await waitForChildExit(chrome.child, 5000);
      }
      if (!exited && process.platform === 'win32') {
        await terminateDisposableChromeTree(chrome.child, chromeSelection.path, profile);
        exited = await waitForChildExit(chrome.child, 5000);
      }
      assert(exited, 'isolated Chrome for Testing process did not exit during cleanup');
    }
    await removeDisposableProfile(profile);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
