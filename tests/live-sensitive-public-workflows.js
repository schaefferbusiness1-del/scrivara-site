'use strict';

/* Real-Chrome proof for public token/sensitive workflow pages. The backend is
 * stubbed before page code runs; every value and record is synthetic. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function args(argv) {
  const out = { chrome: '', artifacts: '' };
  for (const arg of argv) {
    if (arg.startsWith('--chrome=')) out.chrome = arg.slice(9);
    else if (arg.startsWith('--artifacts=')) out.artifacts = arg.slice(12);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error('Chrome not found; pass --chrome=PATH');
  return found;
}

function mime(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function startServer(requests) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      requests.push({ path: url.pathname, query: url.search, referer: req.headers.referer || '', method: req.method });
      const file = path.resolve(ROOT, `.${decodeURIComponent(url.pathname)}`);
      if (!file.startsWith(ROOT + path.sep) || !fs.statSync(file).isFile()) throw new Error('not found');
      res.writeHead(200, { 'Content-Type': mime(file), 'Cache-Control': 'no-store, max-age=0' });
      fs.createReadStream(file).pipe(res);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFile(file, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return;
    await sleep(40);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 1;
    this.pending = new Map();
    this.handlers = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const p = this.pending.get(message.id);
        if (!p) return;
        this.pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(new Error(`${p.method}: ${message.error.message}`));
        else p.resolve(message.result || {});
      } else {
        for (const fn of this.handlers.get(message.method) || []) fn(message.params || {});
      }
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
    });
  }
  on(method, fn) { this.handlers.set(method, (this.handlers.get(method) || []).concat(fn)); }
  send(method, params = {}, timeout = 30000) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function launch(chromePath, profile) {
  const child = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--user-data-dir=${profile}`, '--no-first-run', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-sync',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const portFile = path.join(profile, 'DevToolsActivePort');
  await waitFile(portFile);
  const port = Number(fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0]);
  return { child, port };
}

async function page(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  assert(response.ok, `Chrome target creation failed: ${response.status}`);
  const target = await response.json();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
  return cdp;
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const out = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception && out.exceptionDetails.exception.description || out.exceptionDetails.text);
  return out.result && out.result.value;
}

async function waitFor(cdp, expression, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await evaluate(cdp, expression)) return; } catch (_) {}
    await sleep(50);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function inspectBoundary(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 480 });
  await sleep(60);
  const state = await evaluate(cdp, `(() => {
    const all=[...document.querySelectorAll('[data-mls-synthetic-boundary="1"]')];
    const banner=all[0]||null;
    if(!banner) return {count:all.length};
    const style=getComputedStyle(banner),rect=banner.getBoundingClientRect(),form=document.querySelector('form');
    return {
      count:all.length,text:(banner.textContent||'').replace(/\\s+/g,' ').trim(),
      display:style.display,visibility:style.visibility,opacity:style.opacity,
      rect:{left:rect.left,right:rect.right,top:rect.top,width:rect.width,height:rect.height},
      innerWidth:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
      beforeForm:!form||!!(banner.compareDocumentPosition(form)&Node.DOCUMENT_POSITION_FOLLOWING)
    };
  })()`);
  assert.strictEqual(state.count, 1, `${width}px: expected one evaluation boundary`);
  assert.strictEqual(state.text, 'Synthetic evaluation only. Use fictional information; do not enter real patient or clinical data.', `${width}px: evaluation copy drifted`);
  assert(state.display !== 'none' && state.visibility !== 'hidden' && Number(state.opacity) > 0 && state.rect.height > 20, `${width}px: boundary is not visible`);
  assert(state.rect.left >= -0.5 && state.rect.right <= state.innerWidth + 0.5, `${width}px: boundary is offscreen: ${JSON.stringify(state)}`);
  assert(state.scrollWidth <= state.innerWidth + 1, `${width}px: page has horizontal overflow: ${JSON.stringify(state)}`);
  assert.strictEqual(state.beforeForm, true, `${width}px: boundary appears after a form`);
  return state;
}

async function main() {
  const options = args(process.argv.slice(2));
  const chromePath = findChrome(options.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(ROOT, options.artifacts || path.join('tests', 'live-sensitive-workflow-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-sensitive-workflow-'));
  const serverRequests = [];
  const { server, origin } = await startServer(serverRequests);
  let chrome, cdp;
  const externalRequests = [];
  const report = { status: 'FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true, chromePath, scenarios: [] };
  try {
    chrome = await launch(chromePath, profile);
    cdp = await page(chrome.port);
    cdp.on('Network.requestWillBeSent', (event) => {
      try {
        const url = new URL(event.request.url);
        if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') externalRequests.push(url.href);
      } catch (_) {}
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__syntheticInitialUrl=location.href;
      try{localStorage.clear();sessionStorage.clear();}catch(_){}
      window.__syntheticPrivateFetchCalls=[];
      window.fetch=function(input,init){
        const options=init||{};
        window.__syntheticPrivateFetchCalls.push({url:String(input),method:String(options.method||'GET'),cache:String(options.cache||''),referrerPolicy:String(options.referrerPolicy||'')});
        return Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({ok:false,error:'synthetic offline fixture'}),text:()=>Promise.resolve('')});
      };
    })();` });

    const scenarios = [
      { name: 'appointment', path: '/appointment.html?t=SYNTH_APPT_123&safe=1#code=SYNTH_CODE&tab=overview', clean: '/appointment.html?safe=1#tab=overview', capture: ['query.t'] },
      { name: 'best-doctors-optout', path: '/best-doctors-optout.html?t=0123456789abcdef0123456789abcdef0123456789abcdef&safe=1#code=SYNTH_CODE&tab=choice', clean: '/best-doctors-optout.html?safe=1#tab=choice', capture: ['query.t'] },
      { name: 'best-doctors-optout-invalid', path: '/best-doctors-optout.html?t=NOT_A_VALID_TOKEN&safe=invalid#code=SYNTH_CODE&tab=choice', clean: '/best-doctors-optout.html?safe=invalid#tab=choice', capture: ['query.t'], expectNoAppFetch: true },
      { name: 'booking', path: '/booking.html?token=SYNTH_BOOK_123&safe=1#invite=SYNTH_INVITE&tab=slots', clean: '/booking.html?safe=1#tab=slots', capture: ['query.token'] },
      { name: 'intake', path: '/intake.html?intake=SYNTH_INTAKE_123&safe=1#code=SYNTH_CODE&tab=form', clean: '/intake.html?safe=1#tab=form', capture: ['query.intake'] },
      { name: 'portal-session', path: '/patient-portal.html?invite=expired&safe=session#session=SYNTHETIC_SESSION_TOKEN_1234567890&setup=1&tab=records', clean: '/patient-portal.html?safe=session#tab=records', capture: ['query.invite','fragment.session','fragment.setup'] },
      { name: 'portal-claim', path: '/patient-portal.html?safe=claim#claim=SYNTHETIC_CLAIM_TOKEN_123456&tab=setup', clean: '/patient-portal.html?safe=claim#tab=setup', capture: ['fragment.claim'] },
      { name: 'send-invite', path: '/send-portal-invite.html?email=synthetic%40invalid.test&patient=SYNTHETIC#code=SYNTH_CODE&debug=1', clean: '/send-portal-invite.html', capture: [] }
    ];

    for (const scenario of scenarios) {
      const initialUrl=origin + scenario.path;
      await cdp.send('Page.navigate', { url: initialUrl });
      await waitFor(cdp, `window.__syntheticInitialUrl===${JSON.stringify(initialUrl)} && document.readyState==='complete' && !!window.__mlsSensitiveUrl && typeof window.mlsSensitiveFetch==='function'`);
      await sleep(250);
      let state = await evaluate(cdp, `(() => ({
        href:location.pathname+location.search+location.hash,
        captured:JSON.parse(JSON.stringify(window.__mlsSensitiveUrl)),
        calls:(window.__syntheticPrivateFetchCalls||[]).slice()
      }))()`);
      const appFetches = state.calls.slice();
      if (scenario.expectNoAppFetch) assert.strictEqual(appFetches.length, 0, `${scenario.name}: invalid token reached the backend`);
      if (!state.calls.length) {
        await evaluate(cdp, `mlsSensitiveFetch('/synthetic-private-probe',{method:'POST',cache:'force-cache',referrerPolicy:'origin'})`, true);
        state = await evaluate(cdp, `(() => ({
          href:location.pathname+location.search+location.hash,
          captured:JSON.parse(JSON.stringify(window.__mlsSensitiveUrl)),
          calls:(window.__syntheticPrivateFetchCalls||[]).slice()
        }))()`);
      }
      assert.strictEqual(state.href, scenario.clean, `${scenario.name}: sensitive URL was not scrubbed`);
      for (const ref of scenario.capture) {
        const [bucket, key] = ref.split('.');
        assert(state.captured[bucket] && state.captured[bucket][key], `${scenario.name}: ${ref} was not captured`);
      }
      assert(state.calls.length > 0, `${scenario.name}: no sensitive fetch was exercised`);
      assert(state.calls.every((call) => call.cache === 'no-store' && call.referrerPolicy === 'no-referrer'), `${scenario.name}: private fetch options drifted: ${JSON.stringify(state.calls)}`);
      const responsive = {
        mobile360: await inspectBoundary(cdp, 360, 800),
        desktop1440: await inspectBoundary(cdp, 1440, 1000)
      };
      report.scenarios.push({ name: scenario.name, cleanUrl: state.href, capturedKeys: scenario.capture, appFetches, fetches: state.calls, responsive });
    }

    assert.deepStrictEqual(externalRequests, [], `unexpected external network requests: ${JSON.stringify(externalRequests)}`);
    const bootstrapRequests = serverRequests.filter((request) => request.path === '/sensitive-workflow-bootstrap.js');
    assert.strictEqual(bootstrapRequests.length, scenarios.length, 'every scenario must load the real head bootstrap');
    assert(bootstrapRequests.every((request) => request.referer === ''), `bootstrap request leaked a Referer: ${JSON.stringify(bootstrapRequests)}`);
    report.status = 'PASS';
    report.chromeVersion = await evaluate(cdp, 'navigator.userAgent');
    report.externalRequests = externalRequests;
    report.bootstrapRequests = bootstrapRequests;
    fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`PASS live sensitive public workflows: ${scenarios.length}/${scenarios.length}\nArtifacts: ${artifactDir}\n`);
  } catch (error) {
    report.error = error.stack || String(error);
    report.externalRequests = externalRequests;
    try { fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); } catch (_) {}
    error.message += `\nArtifacts: ${artifactDir}`;
    throw error;
  } finally {
    if (cdp) cdp.close();
    if (chrome) try { chrome.child.kill(); } catch (_) {}
    await new Promise((resolve) => server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(tempRoot + path.sep) && path.basename(resolvedProfile).startsWith('mls-sensitive-workflow-')) {
      try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
