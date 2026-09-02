'use strict';

/*
 * Standalone real-Chrome gate for the official Athena SMART/FHIR read-only UI.
 *
 * The exact local ScribeFlow.html and its production scripts are served from
 * disk without rewriting. Chrome uses a fresh temporary profile. Every API
 * response, popup, account, provider, appointment, and credential is a
 * synthetic in-page fixture; host resolution prevents real external traffic.
 * This test is intentionally not registered in run-all.js.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const APP_FILE = path.join(ROOT, 'ScribeFlow.html');
const SYNTHETIC_EMAIL = 'athena.smart.live@invalid.test';
const SYNTHETIC_PASSWORD = 'SyntheticOnly2026!';
const SYNTHETIC_TOKEN = 'synthetic-athena-smart-bearer';
const BACKEND = 'https://scrivara-backend.onrender.com';
const REDIRECT_URI = `${BACKEND}/smart/callback`;
const WRITEBACK_REASON = 'MLS does not have an authoritative visit-to-Athena encounter binding.';
const VALID_SCOPE = 'openid fhirUser offline_access user/Appointment.read';

/* Capture one local calendar date at process start.  The calendar opens on
   the current account month, so schedule fixtures must live in that same
   month/day window rather than a permanently hard-coded historical month. */
const RUN_STARTED_AT = new Date();
const RUN_LOCAL_NOON = new Date(
  RUN_STARTED_AT.getFullYear(), RUN_STARTED_AT.getMonth(), RUN_STARTED_AT.getDate(), 12, 0, 0, 0
);

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftedLocalDate(days) {
  return localDateString(new Date(
    RUN_LOCAL_NOON.getFullYear(), RUN_LOCAL_NOON.getMonth(), RUN_LOCAL_NOON.getDate() + days, 12, 0, 0, 0
  ));
}

const SYNTHETIC_TODAY = shiftedLocalDate(0);
const SYNTHETIC_START_AT = new Date(
  RUN_LOCAL_NOON.getFullYear(), RUN_LOCAL_NOON.getMonth(), RUN_LOCAL_NOON.getDate(), 9, 0, 0, 0
).toISOString();
const DATE_FIXTURES = Object.freeze({
  capturedAt: RUN_STARTED_AT.toISOString(),
  today: SYNTHETIC_TODAY,
  appointmentStartAt: SYNTHETIC_START_AT,
  allProviders31: Object.freeze({ from: shiftedLocalDate(-15), to: shiftedLocalDate(15), inclusiveDays: 31 }),
  rejected32: Object.freeze({ from: shiftedLocalDate(-15), to: shiftedLocalDate(16), inclusiveDays: 32 }),
  provider15: Object.freeze({ from: shiftedLocalDate(-7), to: shiftedLocalDate(7), inclusiveDays: 15 })
});

function inclusiveCalendarDays(range) {
  const [fy, fm, fd] = range.from.split('-').map(Number);
  const [ty, tm, td] = range.to.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
}

assert.strictEqual(inclusiveCalendarDays(DATE_FIXTURES.allProviders31), 31, 'synthetic All-providers fixture must be exactly 31 inclusive days');
assert.strictEqual(inclusiveCalendarDays(DATE_FIXTURES.rejected32), 32, 'synthetic rejected fixture must be exactly 32 inclusive days');
assert(inclusiveCalendarDays(DATE_FIXTURES.provider15) <= 31, 'synthetic provider fixture must stay within 31 inclusive days');

function authorizeUrl({ host = 'preview.athenahealth.com', scope = VALID_SCOPE } = {}) {
  const url = new URL(`https://${host}/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', 'synthetic-client-id');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', 'synthetic-state-123');
  url.searchParams.set('aud', 'https://api.preview.platform.athenahealth.com/v1/synthetic-practice');
  url.searchParams.set('code_challenge', 'synthetic-pkce-challenge');
  url.searchParams.set('code_challenge_method', 'S256');
  return url.href;
}

const VALID_AUTHORIZE_URL = authorizeUrl();
const MALICIOUS_HOST_URL = authorizeUrl({ host: 'preview.athenahealth.com.evil.invalid' });
const WRITE_SCOPE_URL = authorizeUrl({ scope: 'openid fhirUser user/Appointment.write' });

function parseArgs(argv) {
  const options = { chrome: '', artifacts: '', headed: false };
  for (const arg of argv) {
    if (arg === '--headed') options.headed = true;
    else if (arg.startsWith('--chrome=')) options.chrome = arg.slice(9);
    else if (arg.startsWith('--artifacts=')) options.artifacts = arg.slice(12);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node tests/live-athena-smart-ui.js [options]',
    '',
    '  --headed          Show the isolated synthetic Chrome window',
    '  --chrome=PATH     Explicit Chrome/Chromium executable',
    '  --artifacts=PATH  Report/screenshot destination'
  ].join('\n');
}

function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome-stable',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Chrome/Chromium was not found. Pass --chrome=PATH.');
  return found;
}

function mimeType(file) {
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
    '.webmanifest': 'application/manifest+json'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function startServer(requestLog) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      requestLog.push({ method: req.method, path: url.pathname, search: url.search });
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname === '/' ? '/ScribeFlow.html' : url.pathname);
      const target = path.resolve(ROOT, `.${pathname}`);
      if (target === ROOT || !target.startsWith(`${ROOT}${path.sep}`)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': mimeType(target),
        'Content-Length': stat.size,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff'
      });
      fs.createReadStream(target).pipe(res);
    } catch (_) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevToolsPort(file, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  let lastContents = '';
  while (Date.now() < deadline) {
    try {
      const contents = fs.readFileSync(file, 'utf8');
      lastContents = contents.slice(0, 200);
      const firstLine = contents.trim().split(/\r?\n/)[0] || '';
      if (/^\d+$/.test(firstLine)) {
        const port = Number(firstLine);
        if (Number.isSafeInteger(port) && port >= 1 && port <= 65535) return port;
      }
    } catch (error) {
      if (!error || !['ENOENT', 'EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw error;
      lastError = `${error.code}: ${error.message}`;
    }
    await sleep(40);
  }
  throw new Error(`Timed out waiting for a valid numeric Chrome DevTools port in ${file}` +
    (lastError ? `\nLast read error: ${lastError}` : '') +
    (lastContents ? `\nLast contents: ${JSON.stringify(lastContents)}` : ''));
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
      for (const handler of this.listeners.get(message.method) || []) handler(message.params || {});
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
        this.pending.delete(id);
        reject(new Error(`${method}: Chrome DevTools response timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { try { this.socket.close(); } catch (_) {} }
}

async function launchChrome(chromePath, profileDir, headed) {
  const chromeArgs = [
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
  if (!headed) chromeArgs.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') chromeArgs.unshift('--no-sandbox');
  const child = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  let port;
  try { port = await waitForDevToolsPort(portFile); }
  catch (error) {
    try { child.kill(); } catch (_) {}
    throw new Error(`${error.message}\nChrome stderr:\n${stderr.slice(-4000)}`);
  }
  return { child, port, stderr: () => stderr };
}

async function createPage(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  assert(response.ok, `Chrome target creation failed: ${response.status}`);
  const target = await response.json();
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Network.enable'),
    cdp.send('Log.enable')
  ]);
  return cdp;
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: !!options.awaitPromise,
    returnByValue: true,
    userGesture: options.userGesture !== false
  }, options.timeoutMs || 70000);
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || `Evaluation failed: ${expression.slice(0, 120)}`);
  }
  return result.result && result.result.value;
}

async function waitFor(cdp, description, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression, { userGesture: false, timeoutMs: 5000 });
      if (last) return last;
    } catch (error) { last = error.message; }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

function selectorLiteral(selector) { return JSON.stringify(selector); }

async function click(cdp, selector) {
  const result = await evaluate(cdp, `(() => {
    const nodes=[...document.querySelectorAll(${selectorLiteral(selector)})];
    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const live=nodes.filter(shown);
    if(live.length!==1)return {ok:false,count:nodes.length,visible:live.length};
    if(live[0].disabled)return {ok:false,count:nodes.length,visible:live.length,disabled:true};
    live[0].click();return {ok:true};
  })()`);
  assert(result && result.ok, `Could not click ${selector}: ${JSON.stringify(result)}`);
}

async function waitForInAppConfirm(cdp, description) {
  return waitFor(cdp, description, `(() => {
    const overlay=document.getElementById('_mlsAskDialog');
    const card=overlay&&overlay.querySelector('[role="dialog"]');
    const cancel=document.getElementById('_mlsAskNo'),accept=document.getElementById('_mlsAskYes'),message=document.getElementById('_mlsAskMsg');
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    if(!shown(overlay)||!shown(card)||!shown(cancel)||!shown(accept)||!message)return false;
    const norm=value=>String(value||'').replace(/\\s+/g,' ').trim();
    return {message:norm(message.textContent),cancel:norm(cancel.textContent),accept:norm(accept.textContent),role:card.getAttribute('role')||'',ariaModal:card.getAttribute('aria-modal')||''};
  })()`);
}

let trustedClickSerial = 0;
async function trustedClick(cdp, selector) {
  const probeKey=`__mlsTrustedClickProbe${++trustedClickSerial}`;
  const target=await evaluate(cdp, `(() => {
    const nodes=[...document.querySelectorAll(${selectorLiteral(selector)})];
    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const live=nodes.filter(shown);
    if(live.length!==1)return {ok:false,count:nodes.length,visible:live.length};
    if(live[0].disabled)return {ok:false,count:nodes.length,visible:live.length,disabled:true};
    const el=live[0],r=el.getBoundingClientRect(),key=${JSON.stringify(probeKey)};
    window[key]=null;
    el.addEventListener('click',event=>{window[key]={seen:true,isTrusted:event.isTrusted};},{capture:true,once:true});
    return {ok:true,x:r.left+r.width/2,y:r.top+r.height/2};
  })()`, { userGesture: false });
  assert(target && target.ok, `Could not target trusted click ${selector}: ${JSON.stringify(target)}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1 });
  const observed=await waitFor(cdp, `trusted click ${selector}`, `window[${JSON.stringify(probeKey)}]`);
  assert.strictEqual(observed.isTrusted, true, `${selector} did not receive trusted browser input`);
  await evaluate(cdp, `delete window[${JSON.stringify(probeKey)}]`, { userGesture: false });
  return observed;
}

/* The label match is CASE-INSENSITIVE (2026-09-02). #settingsTabBar has two
   writers: the legacy builder labels each tab from its section's .set-head
   ("(emoji) Integrations"), and the settings organizer then renames the rail in
   place from its own LABELS table ("Connections & integrations"). Whichever ran
   last decides the capital I, so a case-sensitive substring could resolve zero
   buttons and fail with count:0 through no fault of the app. Only the letters
   are relaxed: this still requires EXACTLY ONE visible matching button, so an
   ambiguous or wrong label is still a loud failure rather than a stray click. */
async function clickButtonText(cdp, containerSelector, text) {
  const result = await evaluate(cdp, `(() => {
    const root=document.querySelector(${JSON.stringify(containerSelector)});if(!root)return {ok:false,reason:'missing-container'};
    const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const norm=value=>String(value||'').replace(/\\s+/g,' ').trim().toLowerCase();
    const all=[...root.querySelectorAll('button')];
    const nodes=all.filter(el=>shown(el)&&norm(el.textContent).includes(${JSON.stringify(String(text).toLowerCase())}));
    if(nodes.length!==1)return {ok:false,count:nodes.length,labels:all.map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {text:norm(el.textContent),shown:shown(el),display:s.display,visibility:s.visibility,rect:[r.x,r.y,r.width,r.height]}})};
    nodes[0].click();return {ok:true,label:norm(nodes[0].textContent)};
  })()`);
  assert(result && result.ok, `Could not click ${text} in ${containerSelector}: ${JSON.stringify(result)}`);
  return result;
}

async function fill(cdp, selector, value, eventType = 'input') {
  const result = await evaluate(cdp, `(() => {
    const el=document.querySelector(${selectorLiteral(selector)});if(!el)return {ok:false,reason:'missing'};
    const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value').set;setter.call(el,${JSON.stringify(value)});
    el.dispatchEvent(new Event(${JSON.stringify(eventType)},{bubbles:true}));
    return {ok:true,value:el.value};
  })()`);
  assert(result && result.ok && result.value === value, `Could not fill ${selector}: ${JSON.stringify(result)}`);
}

async function selectValue(cdp, selector, value) {
  const result = await evaluate(cdp, `(() => {
    const el=document.querySelector(${selectorLiteral(selector)});if(!el)return {ok:false,reason:'missing'};
    const values=[...el.options].map(option=>option.value);if(!values.includes(${JSON.stringify(value)}))return {ok:false,values};
    el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,value:el.value};
  })()`);
  assert(result && result.ok && result.value === value, `Could not select ${selector}=${value}: ${JSON.stringify(result)}`);
}

async function screenshot(cdp, file) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true }, 30000);
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
}

function statusResponse({ connection = null, scheduleReadReady = false, redirectUri = REDIRECT_URI } = {}) {
  return {
    configured: true,
    configurationIssue: null,
    vendor: 'athena',
    redirectUri,
    connection,
    scheduleReadReady,
    writeBack: { enabled: false, reason: WRITEBACK_REASON }
  };
}

function bootstrapSource() {
  const defaultStatus = statusResponse();
  const appointment = {
    id: 'synthetic-appointment-001',
    name: 'Synthetic Schedule Entry',
    appt_date: SYNTHETIC_TODAY,
    day_local: SYNTHETIC_TODAY,
    start_local: '09:00',
    start_at: SYNTHETIC_START_AT,
    provider: 'Synthetic Clinician',
    status: 'booked',
    reason: 'Synthetic fixture only'
  };
  return `(() => {
    const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
    const nativeFetch=window.fetch.bind(window);
    const h=window.__athenaSmartHarness={
      syntheticOnly:true,calls:[],fetchOrdinal:0,eventOrdinal:0,loadCalendarOrdinal:0,
      chronology:[],appointmentResponses:[],loadCalendarEvents:[],popupCalls:[],popupBlocked:false,
      statusResponse:${JSON.stringify(defaultStatus)},
      connectResponse:{authorizeUrl:${JSON.stringify(VALID_AUTHORIZE_URL)}},
      disconnectResponse:{ok:true,disconnected:true,deletedConnections:1,deletedOauthStates:1},
      scheduleAccepted:false,forcedStaleCount:0,scheduleResponses:[],lastScheduleBody:null,
      appointments:[${JSON.stringify(appointment)}],
      pageErrors:[],unhandled:[],refreshCalls:{loadCalendar:0,renderCalendar:0,updateNavCounts:0}
    };
    h.recordChronology=function(kind,detail){
      const event=Object.assign({ordinal:++h.eventOrdinal,kind:String(kind||'event')},clone(detail||{}));
      h.chronology.push(event);return event;
    };
    addEventListener('error',event=>h.pageErrors.push({message:String(event.message||''),source:String(event.filename||''),line:event.lineno||0}));
    addEventListener('unhandledrejection',event=>h.unhandled.push(String(event.reason&&event.reason.stack||event.reason||'')));
    window.open=function(url,target,features){
      h.popupCalls.push({url:String(url||''),target:String(target||''),features:String(features||''),blocked:!!h.popupBlocked});
      return h.popupBlocked?null:{closed:false,focus:function(){}};
    };
    window.fetch=function(input,init){
      const options=init||{}, rawUrl=typeof input==='string'?input:(input&&input.url)||String(input||'');
      const url=new URL(rawUrl,location.href), method=String(options.method||(input&&input.method)||'GET').toUpperCase();
      const headers={};try{new Headers(options.headers||(input&&input.headers)||{}).forEach((value,key)=>{headers[key.toLowerCase()]=value})}catch(_){}
      const rawBody=typeof options.body==='string'?options.body:'';let body=null;try{body=rawBody?JSON.parse(rawBody):null}catch(_){}
      const call={ordinal:++h.fetchOrdinal,url:url.href,path:url.pathname,method,headers,rawBody,body:clone(body)};h.calls.push(call);
      const reply=(status,data)=>Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
      if(url.origin===location.origin&&url.pathname==='/api/agreements/signup-manifest'&&method==='GET')return nativeFetch(input,init);
      if(url.pathname==='/smart/status')return reply(200,clone(h.statusResponse));
      if(url.pathname==='/smart/connect')return reply(200,clone(h.connectResponse));
      if(url.pathname==='/smart/connection'&&method==='DELETE')return reply(200,clone(h.disconnectResponse));
      if(url.pathname==='/api/emr-sync/schedule'&&method==='POST'){
        h.scheduleAccepted=true;h.lastScheduleBody=clone(body);
        h.recordChronology('schedule-accepted',{callOrdinal:call.ordinal,url:url.href,search:url.search,body:clone(body)});
        const alreadyImported=h.scheduleResponses.length>0;
        const result={ok:true,from:body&&body.from,to:body&&body.to,practitioner:body&&body.practitioner||null,appointments:1,created:alreadyImported?0:1,updated:alreadyImported?1:0,pages:1,includesSupported:true};
        h.scheduleResponses.push(clone(result));return reply(200,result);
      }
      if(url.pathname==='/api/appointments'){
        const scheduleAcceptedAtResponseCreation=!!h.scheduleAccepted;
        const forcedStale=scheduleAcceptedAtResponseCreation&&method==='GET'&&url.search===''&&h.forcedStaleCount===0;
        if(forcedStale)h.forcedStaleCount++;
        const returnedAppointments=scheduleAcceptedAtResponseCreation&&!forcedStale?clone(h.appointments):[];
        const event=h.recordChronology('appointments-response-created',{
          callOrdinal:call.ordinal,url:url.href,search:url.search,
          scheduleAcceptedAtResponseCreation,forcedStale,forcedStaleCount:h.forcedStaleCount,
          returnedAppointmentCount:returnedAppointments.length
        });
        h.appointmentResponses.push(clone(event));
        return reply(200,{appointments:returnedAppointments,me:{}});
      }
      if(url.pathname==='/api/providers')return reply(200,{providers:[]});
      return reply(404,{ok:false,error:'synthetic fixture has no route for '+url.pathname});
    };
  })();`;
}

async function settleUi(cdp) {
  await evaluate(cdp, `(async()=>{
    if(window.__mlsSessionReady)await Promise.race([Promise.resolve(window.__mlsSessionReady),new Promise((_,reject)=>setTimeout(()=>reject(new Error('session timeout')),45000))]);
    if(document.fonts&&document.fonts.ready)await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;
  })()`, { awaitPromise: true, userGesture: false });
  await waitFor(cdp, 'settled clinician shell', `document.body.classList.contains('mls-redesign')&&!!document.getElementById('mlsRdNav')&&!!document.getElementById('mlsTbMenuBtn')&&!!window.__mlsEasyV3`, 50000);
  await sleep(300);
}

async function signupLocalDemo(cdp) {
  await waitFor(cdp, 'local demo sign-up tab', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`, 40000);
  await click(cdp, '#tabSignup');
  const ceremony = await waitFor(cdp, 'local synthetic agreement manifest', `(() => {
    const fields=document.getElementById('authSignupAssentFields');
    const terms=document.getElementById('authTermsAssent'),authority=document.getElementById('authPracticeAuthority');
    const termsLink=document.getElementById('authTermsLink'),privacyLink=document.getElementById('authPrivacyLink');
    if(!fields||fields.disabled||!terms||!authority||!termsLink||!privacyLink||!termsLink.href||!privacyLink.href)return false;
    return {fieldsEnabled:true,termsInitiallyChecked:terms.checked,authorityInitiallyChecked:authority.checked,
      termsUrl:termsLink.href,privacyUrl:privacyLink.href,submitInitiallyDisabled:!!document.getElementById('authBtn').disabled};
  })()`, 10000);
  assert.strictEqual(ceremony.termsInitiallyChecked, false, 'synthetic Terms assent was pre-checked');
  assert.strictEqual(ceremony.authorityInitiallyChecked, false, 'synthetic practice-authority assent was pre-checked');
  assert.strictEqual(ceremony.submitInitiallyDisabled, true, 'synthetic signup was enabled before explicit assent');
  assert.strictEqual(new URL(ceremony.termsUrl).hostname, '127.0.0.1', 'synthetic Terms fixture escaped the isolated origin');
  assert.strictEqual(new URL(ceremony.privacyUrl).hostname, '127.0.0.1', 'synthetic Privacy fixture escaped the isolated origin');
  await fill(cdp, '#authEmail', SYNTHETIC_EMAIL);
  await fill(cdp, '#authPass', SYNTHETIC_PASSWORD);
  await fill(cdp, '#authPass2', SYNTHETIC_PASSWORD);
  await click(cdp, '#authTermsAssent');
  await click(cdp, '#authPracticeAuthority');
  const accepted = await waitFor(cdp, 'explicit local synthetic signup assent', `(() => {
    const terms=document.getElementById('authTermsAssent'),authority=document.getElementById('authPracticeAuthority'),submit=document.getElementById('authBtn');
    return !!(terms&&authority&&submit&&terms.checked&&authority.checked&&!submit.disabled)&&{termsAccepted:true,practiceAuthorityAccepted:true,submitEnabled:true};
  })()`, 5000);
  await click(cdp, '#authBtn');
  await waitFor(cdp, 'synthetic local login', `document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 40000);
  await settleUi(cdp);
  return { ...ceremony, ...accepted };
}

async function openSettingsIntegration(cdp) {
  /* Account/security owns the single visible Settings entry.  Older menu and
     rail rows stay in the DOM only as hidden compatibility controls. */
  await click(cdp, '#mlsAccountMenuBtn');
  await waitFor(cdp, 'Account menu', `(() => {const el=document.getElementById('mlsAccountPopover');return !!el&&!el.hidden})()`);
  await click(cdp, '#mlsAccountPopover [data-account-action="settings"]');
  await waitFor(cdp, 'Settings modal', `document.getElementById('settingsModal').classList.contains('show')`);
  const visible = await evaluate(cdp, `(() => {const el=document.getElementById('athApiSettingsCard');if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()`);
  if (!visible) await clickButtonText(cdp, '#settingsTabBar', 'Integrations');
  await waitFor(cdp, 'Athena API Settings card', `(() => {const el=document.getElementById('athApiSettingsCard');if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()`);
}

async function settingsState(cdp) {
  return evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const text=id=>{const el=document.getElementById(id);return el?(el.textContent||'').replace(/\\s+/g,' ').trim():''};
    const link=document.getElementById('athApiAuthorizeLink');
    return {status:text('athStatus'),redirect:text('athApiRedirectUri'),reason:text('athApiWritebackReason'),note:text('athApiActionNote'),
      connect:{visible:shown(document.getElementById('athApiConnectBtn')),text:text('athApiConnectBtn')},disconnectVisible:shown(document.getElementById('athApiDisconnectBtn')),
      authorize:{visible:shown(link),href:link&&link.href||'',target:link&&link.target||'',rel:link&&link.rel||''},state:window.mlsAthenaApiGetState()};
  })()`);
}

/* THE DOCK IS THE MENU NOW, and this function was still opening the old one.
   The 2026-07-28 owner sweep hides #mlsTbMenu outright - feat_mls_redesign.js:114
   puts it in a `display:none !important` list next to the search slot and the
   quick-create button, because the top bar was duplicating the dock. The nodes
   are hidden and never deleted precisely so satellites and tests can still
   reach them, and feat_mls_calm_shell.js already adapted: its Tools row drives
   the canonical Menu row inside the hidden subtree and dispatches
   mls:menu-staff-prep-request.
   This harness had not adapted. It clicked #mlsTbMenuBtn, which measures 0x0
   inside a display:none parent, so every run died on "Could not click" before a
   single Athena assertion ran - a whole suite reporting nothing at all.
   Nothing about Athena is touched here. Only the way IN changes, and it changes
   to the app's own current route: activate the canonical Staff-prep item where
   it actually lives. The item is still clicked rather than its handler called,
   so a Staff prep entry that stops working still fails this suite. */
async function openStaffPrep(cdp) {
  const opened = await evaluate(cdp, `(() => {
    const item = document.querySelector('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]');
    if (!item) return { ok: false, why: 'the canonical Staff prep menu item is gone' };
    item.click();
    return { ok: true };
  })()`);
  assert(opened && opened.ok, 'Could not reach Staff prep: ' + JSON.stringify(opened));
  await waitFor(cdp, 'Staff Prep workspace', `!!document.getElementById('ez3PullStart')&&!!document.getElementById('ez3Seg')`);
}

async function staffState(cdp) {
  return evaluate(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const ids=['ez3PullStart','ez3sPullToday','ez3PullRetry','ez3PullCancel','ez3sProv','ez3sPrep'];
    const controls={};ids.forEach(id=>{const el=document.getElementById(id);controls[id]={present:!!el,visible:shown(el)}});
    const card=document.getElementById('ez3AthenaApiCard'),status=document.getElementById('ez3sAthenaApiStatus');
    return {controls,cardPresent:!!card,verifiedConnected:card&&card.getAttribute('data-verified-connected'),
      checkPresent:!!document.getElementById('ez3sAthenaApiCheck'),pullPresent:!!document.getElementById('ez3sAthenaApiPull'),providerBlocked:!!document.getElementById('ez3sAthenaApiProviderBlocked'),
      apiStatus:status&&(status.textContent||'').replace(/\\s+/g,' ').trim()||'',ranges:[...document.querySelectorAll('#ez3Seg [data-r]')].map(el=>el.getAttribute('data-r')),
      providerValue:(document.getElementById('ez3Prov')||{}).value||'',syntheticRows:[...document.querySelectorAll('.ez3-list *')].filter(el=>(el.textContent||'').includes('Synthetic Schedule Entry')).length};
  })()`);
}

function smartCalls(snapshot, pathname, method) {
  return snapshot.calls.filter((call) => call.path === pathname && (!method || call.method === method));
}

async function harnessSnapshot(cdp) {
  return evaluate(cdp, `JSON.parse(JSON.stringify(window.__athenaSmartHarness))`);
}

async function calendarDiagnostics(cdp) {
  return evaluate(cdp, `(() => {
    const h=window.__athenaSmartHarness||{};
    const appts=(typeof _calAppts!=='undefined'&&Array.isArray(_calAppts))?_calAppts:(Array.isArray(window._calAppts)?window._calAppts:[]);
    const text=id=>{const el=document.getElementById(id);return el?String(el.textContent||'').replace(/\\s+/g,' ').trim():''};
    const calls=Array.isArray(h.calls)?h.calls:[];
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.hidden&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const rows=appts.slice(0,50).map(a=>({
      type:Array.isArray(a)?'array':a===null?'null':typeof a,
      keys:a&&typeof a==='object'?Object.keys(a).sort():[],
      id:a&&a.id||'',name:a&&a.name||'',appt_date:a&&a.appt_date||'',day_local:a&&a.day_local||'',
      start_local:a&&a.start_local||'',start_at:a&&a.start_at||''
    }));
    let state=null;try{state=typeof window.mlsAthenaApiGetState==='function'?window.mlsAthenaApiGetState():null}catch(_){}
    return {
      refreshCalls:h.refreshCalls||null,
      calAppts:{isArray:Array.isArray(appts),count:appts.length,names:rows.map(a=>a.name),dates:rows.map(a=>({appt_date:a.appt_date,day_local:a.day_local,start_local:a.start_local,start_at:a.start_at})),rows},
      bodyTextPresence:{syntheticScheduleEntry:String(document.body&&document.body.textContent||'').includes('Synthetic Schedule Entry')},
      calendar:{
        year:typeof _calYear!=='undefined'?_calYear:null,
        monthZeroBased:typeof _calMonth!=='undefined'?_calMonth:null,
        monthOneBased:typeof _calMonth!=='undefined'&&Number.isInteger(_calMonth)?_calMonth+1:null,
        mode:typeof _calMode!=='undefined'?_calMode:null,
        referenceDate:typeof _calRefDate!=='undefined'?_calRefDate:null,
        monthLabel:text('calMonthLabel'),jumpValue:(document.getElementById('calJump')||{}).value||''
      },
      view:{current:typeof currentView!=='undefined'?currentView:null,visible:[...document.querySelectorAll('.view')].filter(shown).map(el=>el.id||el.className||el.tagName)},
      sequence:typeof window.__mlsCalLoadSeq==='number'?window.__mlsCalLoadSeq:null,
      scheduleFetchCalls:calls.filter(call=>call&&call.path==='/api/emr-sync/schedule'),
      appointmentFetchCalls:calls.filter(call=>call&&call.path==='/api/appointments'),
      appointmentResponses:h.appointmentResponses||[],
      loadCalendarEvents:h.loadCalendarEvents||[],
      chronology:h.chronology||[],
      forcedStaleCount:Number(h.forcedStaleCount||0),
      latestApiStatus:{staffPrep:text('ez3sAthenaApiStatus'),settings:text('athStatus'),state,lastScheduleBody:h.lastScheduleBody||null,scheduleResponses:h.scheduleResponses||[]}
    };
  })()`);
}

async function setCustomRange(cdp, from, to) {
  if (!await evaluate(cdp, `!!document.querySelector('#ez3Seg [data-r="custom"].on')`)) {
    await click(cdp, '#ez3Seg [data-r="custom"]');
  }
  await waitFor(cdp, 'custom date fields', `!!document.getElementById('ez3From')&&!!document.getElementById('ez3To')`);
  await fill(cdp, '#ez3From', from, 'change');
  await waitFor(cdp, 'custom To field after From render', `!!document.getElementById('ez3To')`);
  await fill(cdp, '#ez3To', to, 'change');
  await waitFor(cdp, 'settled custom range values', `document.getElementById('ez3From').value===${JSON.stringify(from)}&&document.getElementById('ez3To').value===${JSON.stringify(to)}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(`${usage()}\n`); return; }
  const chromePath = findChrome(options.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(ROOT, options.artifacts || path.join('tests', 'live-athena-smart-ui-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-athena-smart-live-'));
  const requestLog = [];
  const { server, origin } = await startServer(requestLog);
  const report = {
    status: 'FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true,
    realAthenaUsed: false, signedInChromeUsed: false, appFile: APP_FILE,
    appSha256: crypto.createHash('sha256').update(fs.readFileSync(APP_FILE)).digest('hex'),
    dateFixtures: DATE_FIXTURES,
    scenarios: {}
  };
  let chrome;
  let cdp;
  const externalRequests = [];
  const consoleErrors = [];
  const pageExceptions = [];
  const logErrors = [];
  const dialogs = [];
  const dialogDecisions = [];
  try {
    chrome = await launchChrome(chromePath, profileDir, options.headed);
    cdp = await createPage(chrome.port);
    const requestUrls = new Map();
    cdp.on('Network.requestWillBeSent', (event) => {
      requestUrls.set(event.requestId, event.request.url);
      try {
        const url = new URL(event.request.url);
        if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') externalRequests.push({ url: url.href, method: event.request.method, type: event.type });
      } catch (_) {}
    });
    cdp.on('Runtime.consoleAPICalled', (event) => {
      if (event.type !== 'error') return;
      consoleErrors.push((event.args || []).map((arg) => String(arg.value != null ? arg.value : arg.description || arg.type || '')).join(' ').slice(0, 3000));
    });
    cdp.on('Runtime.exceptionThrown', (event) => {
      const detail = event.exceptionDetails || {};
      pageExceptions.push({ text: detail.text || '', description: detail.exception && detail.exception.description || '', url: detail.url || '', line: detail.lineNumber });
    });
    cdp.on('Log.entryAdded', (event) => {
      const entry = event.entry || {};
      if (entry.level === 'error') logErrors.push({ source: entry.source, text: entry.text, url: entry.url || '' });
    });
    cdp.on('Page.javascriptDialogOpening', (event) => {
      const decision = dialogDecisions.shift() || 'dismiss';
      dialogs.push({ type: event.type, message: event.message, decision });
      cdp.send('Page.handleJavaScriptDialog', { accept: decision === 'accept' }, 5000).catch(() => {});
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrapSource() });
    const appUrl = `${origin}/ScribeFlow.html?demo=1`;
    await cdp.send('Page.navigate', { url: appUrl });
    report.scenarios.signup = await signupLocalDemo(cdp);

    /* Demo: explicit Settings action stays local and every SMART action fails
       closed before fetch. */
    await openSettingsIntegration(cdp);
    await click(cdp, '#athApiRefreshBtn');
    await waitFor(cdp, 'demo Athena status', `/Unavailable in demo mode/.test((document.getElementById('athStatus')||{}).textContent||'')`);
    const demoDirect = await evaluate(cdp, `(async()=>({connect:await window.connectAthenaApi(),pull:await window.mlsAthenaApiPullSchedule(${JSON.stringify({ from: DATE_FIXTURES.allProviders31.from, to: DATE_FIXTURES.allProviders31.to })})}))()`, { awaitPromise: true });
    const demoHarness = await harnessSnapshot(cdp);
    const demoSettings = await settingsState(cdp);
    assert.strictEqual(demoDirect.connect, false, 'demo connect did not fail closed');
    assert.strictEqual(demoDirect.pull.ok, false, 'demo schedule pull did not fail closed');
    assert.strictEqual(smartCalls(demoHarness, '/smart/status').length, 0, 'demo status reached a backend');
    assert.strictEqual(smartCalls(demoHarness, '/smart/connect').length, 0, 'demo connect reached a backend');
    assert.strictEqual(smartCalls(demoHarness, '/api/emr-sync/schedule').length, 0, 'demo schedule reached a backend');
    assert.strictEqual(demoSettings.connect.visible, false, 'demo exposed Connect');
    assert.strictEqual(demoSettings.disconnectVisible, false, 'demo exposed Disconnect');
    report.scenarios.demo = { settings: demoSettings, directResults: demoDirect, smartCallCount: 0 };
    await screenshot(cdp, path.join(artifactDir, '01-demo-fail-closed.png'));

    /* Switch only the synthetic page fixture into hosted mode. Product code,
       constants, files, and browser profile remain untouched. */
    const hosted = await evaluate(cdp, `(() => {
      window.backendMode=function(){return true};window.bkToken=function(){return ${JSON.stringify(SYNTHETIC_TOKEN)}};window.bkBase=function(){return ${JSON.stringify(BACKEND)}};
      window.__mlsSessionAccount=${JSON.stringify(SYNTHETIC_EMAIL)};
      try{backendMode=window.backendMode;bkToken=window.bkToken;bkBase=window.bkBase;bkUser={email:${JSON.stringify(SYNTHETIC_EMAIL)},role:'user',lite:false}}catch(_){}
      sessionStorage.setItem('sf_bk_token',${JSON.stringify(SYNTHETIC_TOKEN)});return {backend:backendMode(),token:bkToken(),base:bkBase()};
    })()`);
    assert.deepStrictEqual(hosted, { backend: true, token: SYNTHETIC_TOKEN, base: BACKEND }, 'hosted synthetic fixture did not bind');

    /* Exact callback origin/path is server-authoritative. */
    await evaluate(cdp, `__athenaSmartHarness.statusResponse=${JSON.stringify(statusResponse({ redirectUri: 'https://evil.invalid/smart/callback' }))};true`);
    await click(cdp, '#athApiRefreshBtn');
    await waitFor(cdp, 'rejected callback status', `/exact MLS HTTPS/.test((document.getElementById('athStatus')||{}).textContent||'')`);
    const rejectedCallback = await settingsState(cdp);
    assert.strictEqual(rejectedCallback.state.verified, false, 'malicious callback was verified');
    assert.strictEqual(rejectedCallback.connect.visible, false, 'malicious callback enabled Connect');

    /* A valid configured status is fetched only from the explicit click. */
    await evaluate(cdp, `__athenaSmartHarness.statusResponse=${JSON.stringify(statusResponse())};true`);
    const beforeStatus = await harnessSnapshot(cdp);
    const connectBeforeStatus = smartCalls(beforeStatus, '/smart/connect').length;
    const popupsBeforeStatus = beforeStatus.popupCalls.length;
    await click(cdp, '#athApiRefreshBtn');
    await waitFor(cdp, 'configured Athena status', `/Configured on the MLS server/.test((document.getElementById('athStatus')||{}).textContent||'')`);
    const configured = await settingsState(cdp);
    const afterStatus = await harnessSnapshot(cdp);
    assert.strictEqual(configured.redirect, REDIRECT_URI, 'exact redirect URI was not rendered');
    assert.strictEqual(configured.reason, WRITEBACK_REASON, 'writeback-disabled reason drifted');
    assert.strictEqual(configured.connect.visible, true, 'configured status did not expose Connect');
    assert.strictEqual(configured.disconnectVisible, false, 'configured/disconnected status exposed Disconnect');
    assert.strictEqual(smartCalls(afterStatus, '/smart/connect').length, connectBeforeStatus, 'status check silently called Connect');
    assert.strictEqual(afterStatus.popupCalls.length, popupsBeforeStatus, 'status check opened authorization');

    /* Exact official HTTPS + read-only Appointment scope: popup succeeds. */
    await evaluate(cdp, `Object.assign(__athenaSmartHarness,{popupBlocked:false,connectResponse:{authorizeUrl:${JSON.stringify(VALID_AUTHORIZE_URL)}}});true`);
    const validPopupStart = await harnessSnapshot(cdp);
    await click(cdp, '#athApiConnectBtn');
    await waitFor(cdp, 'clinician-click popup result', `__athenaSmartHarness.popupCalls.length>${validPopupStart.popupCalls.length}`);
    const popupSettings = await settingsState(cdp);
    const popupHarness = await harnessSnapshot(cdp);
    const popup = popupHarness.popupCalls[popupHarness.popupCalls.length - 1];
    assert.strictEqual(smartCalls(popupHarness, '/smart/connect').length, smartCalls(validPopupStart, '/smart/connect').length + 1, 'Connect click did not make one GET');
    assert.strictEqual(popup.url, VALID_AUTHORIZE_URL, 'popup URL was not the exact validated Athena URL');
    assert.strictEqual(popup.target, '_blank', 'authorization popup target drifted');
    assert(/noopener/.test(popup.features) && /noreferrer/.test(popup.features), 'authorization popup lost isolation flags');
    assert(/authorization opened from your click/i.test(popupSettings.note), 'successful popup was not explained');

    /* Popup blocker: same validated URL becomes a visible, isolated fallback. */
    await evaluate(cdp, `__athenaSmartHarness.popupBlocked=true;__athenaSmartHarness.connectResponse={authorizeUrl:${JSON.stringify(VALID_AUTHORIZE_URL)}};true`);
    const fallbackStart = await harnessSnapshot(cdp);
    await click(cdp, '#athApiConnectBtn');
    await waitFor(cdp, 'popup-blocker fallback', `/blocked the new tab/.test((document.getElementById('athApiActionNote')||{}).textContent||'')`);
    const fallback = await settingsState(cdp);
    const fallbackHarness = await harnessSnapshot(cdp);
    assert.strictEqual(fallbackHarness.popupCalls.length, fallbackStart.popupCalls.length + 1, 'fallback click did not try one popup');
    assert.strictEqual(fallback.authorize.visible, true, 'popup blocker did not expose fallback link');
    assert.strictEqual(fallback.authorize.href, VALID_AUTHORIZE_URL, 'fallback link URL drifted');
    assert.strictEqual(fallback.authorize.target, '_blank', 'fallback link did not isolate target');
    assert(/noopener/.test(fallback.authorize.rel) && /noreferrer/.test(fallback.authorize.rel), 'fallback link lost rel isolation');

    /* Impostor host and Athena write scope both fail before window.open. */
    async function refuseConnect(url, label) {
      await evaluate(cdp, `__athenaSmartHarness.popupBlocked=false;__athenaSmartHarness.connectResponse={authorizeUrl:${JSON.stringify(url)}};true`);
      const before = await harnessSnapshot(cdp);
      await click(cdp, '#athApiConnectBtn');
      await waitFor(cdp, `${label} refusal`, `/did not match the expected Athena HTTPS flow/.test((document.getElementById('athApiActionNote')||{}).textContent||'')`);
      const state = await settingsState(cdp);
      const after = await harnessSnapshot(cdp);
      assert.strictEqual(after.popupCalls.length, before.popupCalls.length, `${label} reached window.open`);
      assert.strictEqual(state.authorize.visible, false, `${label} exposed a fallback link`);
      assert.strictEqual(state.authorize.href, '', `${label} left an authorization href`);
      return { note: state.note, connectCalls: smartCalls(after, '/smart/connect').length - smartCalls(before, '/smart/connect').length };
    }
    const maliciousHost = await refuseConnect(MALICIOUS_HOST_URL, 'malicious host');
    const writeScope = await refuseConnect(WRITE_SCOPE_URL, 'write scope');
    assert.strictEqual(maliciousHost.connectCalls, 1, 'malicious-host fixture was not exercised');
    assert.strictEqual(writeScope.connectCalls, 1, 'write-scope fixture was not exercised');

    /* OAuth without verified schedule permission is honest and reconnectable. */
    await evaluate(cdp, `__athenaSmartHarness.statusResponse=${JSON.stringify(statusResponse({ connection: { status: 'connected' }, scheduleReadReady: false }))};true`);
    await click(cdp, '#athApiRefreshBtn');
    await waitFor(cdp, 'permission-required status', `/Permission needed/.test((document.getElementById('athStatus')||{}).textContent||'')`);
    const permission = await settingsState(cdp);
    assert.strictEqual(permission.state.oauthConnected, true, 'permission state lost OAuth connection truth');
    assert.strictEqual(permission.state.connected, false, 'permission state claimed schedule connectivity');
    assert.strictEqual(permission.state.scheduleReadReady, false, 'permission state claimed schedule readiness');
    assert.strictEqual(permission.connect.text, 'Reconnect Athena API', 'permission state did not offer Reconnect');
    assert.strictEqual(permission.disconnectVisible, true, 'permission state hid Disconnect');

    /* Disconnect requires the exact local in-app confirmation. Cancel makes
       no call; trusted acceptance makes exactly one DELETE and changes only
       API state. */
    const disconnectConfirmCopy = 'Disconnect the read-only Athena API connection for this practice? This stops API schedule reads and disables the API backup schedule. MLS Assist is not changed.';
    const beforeCancel = await harnessSnapshot(cdp);
    await click(cdp, '#athApiDisconnectBtn');
    const cancelDialog = await waitForInAppConfirm(cdp, 'visible disconnect cancellation dialog');
    assert.deepStrictEqual(cancelDialog, { message: disconnectConfirmCopy, cancel: 'Cancel', accept: 'OK', role: 'dialog', ariaModal: 'true' }, 'disconnect cancellation dialog drifted');
    const beforeCancelDecision = await harnessSnapshot(cdp);
    assert.strictEqual(smartCalls(beforeCancelDecision, '/smart/connection', 'DELETE').length, smartCalls(beforeCancel, '/smart/connection', 'DELETE').length, 'disconnect called DELETE before the cancellation decision');
    const cancelInput = await trustedClick(cdp, '#_mlsAskNo');
    await waitFor(cdp, 'closed disconnect cancellation dialog', `!document.getElementById('_mlsAskDialog')`);
    const afterCancel = await harnessSnapshot(cdp);
    assert.strictEqual(smartCalls(afterCancel, '/smart/connection', 'DELETE').length, smartCalls(beforeCancel, '/smart/connection', 'DELETE').length, 'cancelled disconnect sent DELETE');
    await click(cdp, '#athApiDisconnectBtn');
    const confirmDialog = await waitForInAppConfirm(cdp, 'visible disconnect confirmation dialog');
    assert.deepStrictEqual(confirmDialog, { message: disconnectConfirmCopy, cancel: 'Cancel', accept: 'OK', role: 'dialog', ariaModal: 'true' }, 'disconnect confirmation dialog drifted');
    const beforeConfirmDecision = await harnessSnapshot(cdp);
    assert.strictEqual(smartCalls(beforeConfirmDecision, '/smart/connection', 'DELETE').length, smartCalls(afterCancel, '/smart/connection', 'DELETE').length, 'disconnect called DELETE before explicit confirmation');
    const confirmInput = await trustedClick(cdp, '#_mlsAskYes');
    await waitFor(cdp, 'confirmed disconnect', `/Disconnected/.test((document.getElementById('athApiActionNote')||{}).textContent||'')`);
    const afterDisconnect = await harnessSnapshot(cdp);
    const disconnected = await settingsState(cdp);
    assert.strictEqual(smartCalls(afterDisconnect, '/smart/connection', 'DELETE').length, smartCalls(afterCancel, '/smart/connection', 'DELETE').length + 1, 'confirmed disconnect did not send exactly one DELETE');
    const disconnectCall = smartCalls(afterDisconnect, '/smart/connection', 'DELETE').slice(-1)[0];
    assert.strictEqual(disconnectCall.headers.authorization, `Bearer ${SYNTHETIC_TOKEN}`, 'disconnect lost bearer binding');
    assert.strictEqual(disconnected.state.connectionStatus, 'not_connected', 'disconnect receipt did not update state');
    const disconnectDialogs = [Object.assign({ decision: 'cancel', trusted: cancelInput.isTrusted }, cancelDialog), Object.assign({ decision: 'confirm', trusted: confirmInput.isTrusted }, confirmDialog)];
    assert(disconnectDialogs.every(dialog => dialog.trusted && /MLS Assist is not changed/.test(dialog.message)), 'disconnect confirmation proof lost trusted input or MLS Assist copy');
    report.scenarios.settingsAndConnect = { rejectedCallback, configured, popup: popupSettings, fallback, maliciousHost, writeScope, permission, disconnected, dialogs: disconnectDialogs };
    await screenshot(cdp, path.join(artifactDir, '02-smart-settings-boundaries.png'));

    /* Install a synthetic provider roster fixture, then enter the real Staff
       Prep menu. The first render is disconnected and must keep all extension
       controls while withholding the API pull. */
    await click(cdp, '#settingsModal .modal-x');
    await waitFor(cdp, 'closed Settings', `!document.getElementById('settingsModal').classList.contains('show')`);
    const rosterInstalled = await evaluate(cdp, `(() => {
      const entries=[
        {stableKey:'synthetic-verified',name:'Synthetic Clinician',fhirPractitionerVerified:true,fhirPractitioner:'Practitioner/SYNTH-42'},
        {stableKey:'synthetic-unverified',name:'Unverified Synthetic Clinician',fhirPractitionerVerified:false,fhirPractitioner:''}
      ];
      const fixture={installed:true,version:'synthetic-live-fixture',list:()=>entries.map(x=>Object.assign({},x)),providers:()=>entries.map(x=>x.name),
        resolve:ref=>{let key=String(ref||'');if(key.startsWith('pv:')){try{key=decodeURIComponent(key.slice(3))}catch(_){return null}}return entries.find(x=>x.stableKey===key||x.name===key)||null},
        getReceipt:()=>({complete:true,synthetic:true}),merge:()=>{},ingestResp:()=>{}};
      window.__mlsProviderRoster=fixture;return window.__mlsProviderRoster===fixture;
    })()`);
    assert.strictEqual(rosterInstalled, true, 'synthetic provider roster could not be installed');
    await openStaffPrep(cdp);
    const staffDisconnected = await staffState(cdp);
    for (const id of ['ez3PullStart', 'ez3sPullToday', 'ez3PullRetry', 'ez3PullCancel', 'ez3sProv', 'ez3sPrep']) {
      assert.strictEqual(staffDisconnected.controls[id].present, true, `Staff Prep lost extension control #${id}`);
    }
    assert.strictEqual(staffDisconnected.controls.ez3PullStart.visible, true, 'month pull was not visible');
    assert.strictEqual(staffDisconnected.controls.ez3sPullToday.visible, true, 'day pull was not visible');
    assert.deepStrictEqual(staffDisconnected.ranges.sort(), ['custom', 'lastmonth', 'month', 'today', 'tomorrow'], 'Staff Prep range controls drifted');
    assert.strictEqual(staffDisconnected.checkPresent, true, 'disconnected Staff Prep did not offer explicit status check');
    assert.strictEqual(staffDisconnected.pullPresent, false, 'disconnected Staff Prep exposed API schedule pull');

    /* Verified schedule permission alone is still insufficient: implicit All
       and an unverified doctor fail closed until provider scope is explicit. */
    await evaluate(cdp, `__athenaSmartHarness.statusResponse=${JSON.stringify(statusResponse({ connection: { status: 'connected' }, scheduleReadReady: true }))};true`);
    await click(cdp, '#ez3sAthenaApiCheck');
    await waitFor(cdp, 'connected provider gate', `!!document.getElementById('ez3sAthenaApiProviderBlocked')`);
    const implicitProviderBlocked = await staffState(cdp);
    assert.strictEqual(implicitProviderBlocked.verifiedConnected, 'true', 'Staff Prep did not verify schedule readiness');
    assert.strictEqual(implicitProviderBlocked.pullPresent, false, 'implicit provider scope exposed API pull');
    assert.strictEqual(implicitProviderBlocked.providerBlocked, true, 'implicit provider scope lacked a fail-closed control');

    /* User explicitly chooses All providers; only then does the API control
       appear. Instrument the normal calendar refresh functions without
       replacing their behavior. */
    await selectValue(cdp, '#ez3Prov', '__all');
    await waitFor(cdp, 'explicit All-providers API pull', `!!document.getElementById('ez3sAthenaApiPull')&&!document.getElementById('ez3sAthenaApiProviderBlocked')`);
    const refreshInstalled = await evaluate(cdp, `(() => {
      const h=__athenaSmartHarness;if(h.refreshWrapped)return h.refreshWrapped;
      const names=['loadCalendar','renderCalendar','updateNavCounts'],originals={};for(const name of names){if(typeof window[name]!=='function')return {ok:false,missing:name};originals[name]=window[name];}
      const calSnapshot=()=>{const rows=Array.isArray(window._calAppts)?window._calAppts:[];return {
        sequence:typeof window.__mlsCalLoadSeq==='number'?window.__mlsCalLoadSeq:null,
        calApptsCount:rows.length,
        calApptsNames:rows.map(a=>a&&a.name||''),
        calApptsDates:rows.map(a=>({appt_date:a&&a.appt_date||'',day_local:a&&a.day_local||'',start_at:a&&a.start_at||''}))
      }};
      const recordLoad=(phase,loadCallOrdinal,outcome,error)=>{const detail=Object.assign({loadCallOrdinal,outcome:outcome||'',error:error||''},calSnapshot());const event=h.recordChronology('load-calendar-'+phase,detail);h.loadCalendarEvents.push(JSON.parse(JSON.stringify(event)));return event};
      window.loadCalendar=async function(){
        h.refreshCalls.loadCalendar++;const loadCallOrdinal=++h.loadCalendarOrdinal;recordLoad('start',loadCallOrdinal,'','');
        let outcome='resolved',error='';
        try{return await originals.loadCalendar.apply(this,arguments)}catch(err){outcome='rejected';error=String(err&&err.stack||err||'');throw err}finally{recordLoad('end',loadCallOrdinal,outcome,error)}
      };
      window.renderCalendar=function(){h.refreshCalls.renderCalendar++;return originals.renderCalendar.apply(this,arguments)};
      window.updateNavCounts=function(){h.refreshCalls.updateNavCounts++;return originals.updateNavCounts.apply(this,arguments)};
      h.refreshWrapped={ok:true};return h.refreshWrapped;
    })()`);
    assert.deepStrictEqual(refreshInstalled, { ok: true }, 'normal schedule refresh functions were unavailable');

    /* 32 inclusive days: no POST. */
    await setCustomRange(cdp, DATE_FIXTURES.rejected32.from, DATE_FIXTURES.rejected32.to);
    const beforeTooLong = await harnessSnapshot(cdp);
    await click(cdp, '#ez3sAthenaApiPull');
    await waitFor(cdp, '31-day cap message', `/limited to 31 inclusive calendar days/.test((document.getElementById('ez3sAthenaApiStatus')||{}).textContent||'')`);
    const tooLongMessage = await evaluate(cdp, `(document.getElementById('ez3sAthenaApiStatus')||{}).textContent||''`);
    const afterTooLong = await harnessSnapshot(cdp);
    assert.strictEqual(smartCalls(afterTooLong, '/api/emr-sync/schedule', 'POST').length, smartCalls(beforeTooLong, '/api/emr-sync/schedule', 'POST').length, '32-day range reached schedule API');

    /* Exact 31-day All-providers request: body is exactly {from,to}; receipt
       triggers the normal calendar reload and visible synthetic schedule row. */
    await setCustomRange(cdp, DATE_FIXTURES.allProviders31.from, DATE_FIXTURES.allProviders31.to);
    const beforeAllPull = await harnessSnapshot(cdp);
    const loadStartsBeforeAllPull = beforeAllPull.loadCalendarEvents.filter(event => event.kind === 'load-calendar-start').length;
    await click(cdp, '#ez3sAthenaApiPull');
    await waitFor(cdp, 'All-providers API receipt', `/API pull complete: 1 appointment/.test((document.getElementById('ez3sAthenaApiStatus')||{}).textContent||'')`);
    await waitFor(cdp, 'normal schedule UI refresh', `window._calAppts&&window._calAppts.some(a=>a&&a.name==='Synthetic Schedule Entry')&&document.body.textContent.includes('Synthetic Schedule Entry')`);
    const afterAllPull = await harnessSnapshot(cdp);
    const allProviderCalendarLoads = afterAllPull.loadCalendarEvents.filter(event => event.kind === 'load-calendar-start').length - loadStartsBeforeAllPull;
    const allCalls = smartCalls(afterAllPull, '/api/emr-sync/schedule', 'POST');
    const allCall = allCalls[allCalls.length - 1];
    assert.strictEqual(allCalls.length, smartCalls(beforeAllPull, '/api/emr-sync/schedule', 'POST').length + 1, 'All-providers pull did not send one POST');
    assert.deepStrictEqual(Object.keys(allCall.body).sort(), ['from', 'to'], 'All-providers body contained extra fields');
    assert.deepStrictEqual(allCall.body, { from: DATE_FIXTURES.allProviders31.from, to: DATE_FIXTURES.allProviders31.to }, 'All-providers body drifted');
    assert(!/(?:patient|mrn|dob|name)/i.test(allCall.rawBody), 'schedule request included a patient identifier field');
    assert.strictEqual(afterAllPull.forcedStaleCount - beforeAllPull.forcedStaleCount, 1, 'All-providers pull did not exercise exactly one forced-stale normal appointment read');
    assert(allProviderCalendarLoads >= 2, `All-providers pull did not recover through at least two calendar loads: ${allProviderCalendarLoads}`);
    assert(afterAllPull.refreshCalls.loadCalendar >= 1 && afterAllPull.refreshCalls.renderCalendar >= 1 && afterAllPull.refreshCalls.updateNavCounts >= 1, `normal refresh functions did not run: ${JSON.stringify(afterAllPull.refreshCalls)}`);

    /* Verified specific provider: exact optional Practitioner reference only. */
    await selectValue(cdp, '#ez3Prov', 'pv:synthetic-verified');
    await waitFor(cdp, 'verified provider API control', `!!document.getElementById('ez3sAthenaApiPull')`);
    await setCustomRange(cdp, DATE_FIXTURES.provider15.from, DATE_FIXTURES.provider15.to);
    const beforeProviderPull = await harnessSnapshot(cdp);
    await click(cdp, '#ez3sAthenaApiPull');
    await waitFor(cdp, 'provider-scoped API receipt', `/API pull complete: 1 appointment/.test((document.getElementById('ez3sAthenaApiStatus')||{}).textContent||'')`);
    const afterProviderPull = await harnessSnapshot(cdp);
    const providerCalls = smartCalls(afterProviderPull, '/api/emr-sync/schedule', 'POST');
    const providerCall = providerCalls[providerCalls.length - 1];
    assert.strictEqual(providerCalls.length, smartCalls(beforeProviderPull, '/api/emr-sync/schedule', 'POST').length + 1, 'provider pull did not send one POST');
    assert.deepStrictEqual(Object.keys(providerCall.body).sort(), ['from', 'practitioner', 'to'], 'provider body contained extra fields');
    assert.deepStrictEqual(providerCall.body, { from: DATE_FIXTURES.provider15.from, to: DATE_FIXTURES.provider15.to, practitioner: 'Practitioner/SYNTH-42' }, 'provider body drifted');
    assert(!/(?:patient|mrn|dob|name)/i.test(providerCall.rawBody), 'provider schedule request included a patient identifier field');

    /* Unverified doctor mapping removes the API control and sends nothing. */
    await selectValue(cdp, '#ez3Prov', 'pv:synthetic-unverified');
    await waitFor(cdp, 'unverified provider block', `!!document.getElementById('ez3sAthenaApiProviderBlocked')&&!document.getElementById('ez3sAthenaApiPull')`);
    const unverifiedProvider = await staffState(cdp);
    const afterUnverified = await harnessSnapshot(cdp);
    assert.strictEqual(smartCalls(afterUnverified, '/api/emr-sync/schedule', 'POST').length, providerCalls.length, 'unverified provider sent a schedule request');
    report.scenarios.staffPrep = {
      disconnected: staffDisconnected, implicitProviderBlocked,
      tooLongMessage,
      allProvidersRequest: allCall, providerRequest: providerCall,
      unverifiedProvider, refreshCalls: afterProviderPull.refreshCalls,
      scheduleResponses: afterProviderPull.scheduleResponses,
      forcedStaleCount: afterProviderPull.forcedStaleCount,
      allProviderCalendarLoads
    };
    await screenshot(cdp, path.join(artifactDir, '03-staff-prep-api-boundaries.png'));

    await sleep(500);
    const finalHarness = await harnessSnapshot(cdp);
    assert.deepStrictEqual(finalHarness.pageErrors, [], `page error events occurred: ${JSON.stringify(finalHarness.pageErrors)}`);
    assert.deepStrictEqual(finalHarness.unhandled, [], `unhandled rejections occurred: ${JSON.stringify(finalHarness.unhandled)}`);
    assert.deepStrictEqual(consoleErrors, [], `console errors occurred: ${JSON.stringify(consoleErrors)}`);
    assert.deepStrictEqual(pageExceptions, [], `runtime exceptions occurred: ${JSON.stringify(pageExceptions)}`);
    assert.deepStrictEqual(logErrors, [], `Chrome log errors occurred: ${JSON.stringify(logErrors)}`);
    assert.deepStrictEqual(externalRequests, [], `unmocked external network requests occurred: ${JSON.stringify(externalRequests)}`);

    report.status = 'PASS';
    report.appUrl = appUrl;
    report.chromePath = chromePath;
    report.chromeVersion = await evaluate(cdp, 'navigator.userAgent');
    report.externalRequests = externalRequests;
    report.consoleErrors = consoleErrors;
    report.pageExceptions = pageExceptions;
    report.logErrors = logErrors;
    report.localRequestCount = requestLog.length;
    report.mockedApiCalls = finalHarness.calls;
    report.appointmentResponses = finalHarness.appointmentResponses;
    report.loadCalendarEvents = finalHarness.loadCalendarEvents;
    report.chronology = finalHarness.chronology;
    report.forcedStaleCount = finalHarness.forcedStaleCount;
    report.popupCalls = finalHarness.popupCalls;
    report.refreshCalls = finalHarness.refreshCalls;
    report.screenshots = ['01-demo-fail-closed.png', '02-smart-settings-boundaries.png', '03-staff-prep-api-boundaries.png'];
    fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`PASS live Athena SMART/FHIR UI\nArtifacts: ${artifactDir}\n`);
  } catch (error) {
    report.error = error.stack || String(error);
    report.externalRequests = externalRequests;
    report.consoleErrors = consoleErrors;
    report.pageExceptions = pageExceptions;
    report.logErrors = logErrors;
    report.dialogs = dialogs;
    if (cdp) {
      try { report.failureDiagnostics = await calendarDiagnostics(cdp); }
      catch (diagnosticError) { report.failureDiagnosticsError = diagnosticError.stack || String(diagnosticError); }
    }
    try { fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); } catch (_) {}
    error.message += `\nArtifacts: ${artifactDir}`;
    throw error;
  } finally {
    if (cdp) cdp.close();
    if (chrome) try { chrome.child.kill(); } catch (_) {}
    await new Promise((resolve) => server.close(resolve));
    const tempRoot = path.resolve(os.tmpdir());
    const profile = path.resolve(profileDir);
    if (profile.startsWith(`${tempRoot}${path.sep}`) && path.basename(profile).startsWith('mls-athena-smart-live-')) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
