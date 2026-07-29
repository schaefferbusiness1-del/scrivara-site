'use strict';

/*
 * Exhaustive, synthetic-only audit of clinician-visible controls in real Chrome.
 *
 * Safety boundary:
 * - fresh temporary Chrome profile; extensions disabled
 * - local static server and ?demo=1 only
 * - every non-loopback page request is blocked before transmission
 * - window.open/native dialogs are captured, never accepted
 * - no Athena/backend/account/payment/legal/communication/destructive action
 *
 * The report distinguishes exercised, inspected, excluded, and failed controls
 * so an exclusion can never be mistaken for a pass.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT = { email: 'clinician.visible-controls@mls.local', password: 'SyntheticControls2026!' };
const PATIENT = { name: 'Synthetic Controls Patient', dob: '1980-01-02', mrn: 'SYN-CONTROLS-0001', sex: 'Female' };
const TRANSCRIPT = 'Synthetic fixture only. Mechanical back discomfort follow-up. No real patient data is represented.';
const NOTE = [
  'SUBJECTIVE:', 'Synthetic fixture only. Mechanical back discomfort follow-up.', '',
  'OBJECTIVE:', 'Synthetic fixture: alert and comfortable. No real findings.', '',
  'ASSESSMENT:', 'Mechanical back discomfort - synthetic test fixture.', '',
  'PLAN:', 'Continue reviewed conservative measures and synthetic return precautions.'
].join('\n');

const ROUTES = [
  { id: 'nav_visit', route: 'visit', dest: 'visit', entry: '#mlsDock button[data-dest="visit"]', label: 'Today', view: '#visitView' },
  { id: 'nav_patients', route: 'patients', dest: 'patient', entry: '#mlsDock button[data-dest="patient"]', label: 'Patients', view: '#patientsView' },
  { id: 'nav_calendar', route: 'calendar', dest: 'day', entry: '#mlsDock button[data-dest="day"]', label: 'Calendar', view: '#calendarView' },
  { id: 'nav_history', route: 'history', dest: 'patient', entry: '', label: 'History', view: '#historyView' },
  { id: 'nav_analysis', route: 'analysis', dest: 'studio', entry: '', label: 'Practice', view: '#analysisView' },
  { id: 'nav_studio', route: 'studio', dest: 'studio', entry: '#mlsDock button[data-dest="studio"]', label: 'AI Studio', view: '#studioView' }
];

function parseArgs(argv) {
  const out = { headed: false, chrome: '', artifacts: '', max: 0, only: '' };
  for (const arg of argv) {
    if (arg === '--headed') out.headed = true;
    else if (arg.startsWith('--chrome=')) out.chrome = arg.slice(9);
    else if (arg.startsWith('--artifacts=')) out.artifacts = arg.slice(12);
    else if (arg.startsWith('--max=')) out.max = Number(arg.slice(6));
    else if (arg.startsWith('--only=')) out.only = arg.slice(7);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(out.max) || out.max < 0 || out.max > 500) throw new Error('--max must be an integer from 0 through 500');
  return out;
}

function usage() {
  return [
    'Usage: node tests/live-visible-controls-audit.js [options]', '',
    '  --headed          Show the isolated Chrome window',
    '  --chrome=PATH     Explicit Chrome/Chromium executable',
    '  --artifacts=PATH  Evidence directory',
    '  --max=N           Cap safe route-control exercises (0 = all)',
    '  --only=TEXT       Exercise only controls whose id/label contains TEXT'
  ].join('\n');
}

function findChrome(explicit) {
  const candidates = [
    explicit, process.env.CHROME_PATH,
    process.platform === 'win32' && 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/google-chrome-stable',
    process.platform !== 'win32' && process.platform !== 'darwin' && '/usr/bin/chromium'
  ].filter(Boolean);
  const found = candidates.find((item) => fs.existsSync(item));
  if (!found) throw new Error('Chrome/Chromium was not found; pass --chrome=PATH');
  return found;
}

function mime(file) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function serve() {
  const sockets = new Set();
  /* Freeze each requested asset on first read. The audit deliberately reloads the
     app many times; serving a stable byte snapshot prevents a concurrent source
     edit from making the inventory and later click phases test different builds. */
  const assets = new Map();
  const server = http.createServer((req, res) => {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(parsed.pathname === '/' ? '/ScribeFlow.html' : parsed.pathname);
      const target = path.resolve(ROOT, `.${pathname}`);
      if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) return res.writeHead(403).end('Forbidden');
      if (!fs.statSync(target).isFile()) throw new Error('not-file');
      let asset = assets.get(target);
      if (!asset) {
        const body = fs.readFileSync(target);
        asset = { body, sha256: crypto.createHash('sha256').update(body).digest('hex') };
        assets.set(target, asset);
      }
      res.writeHead(200, { 'Content-Type': mime(target), 'Content-Length': asset.body.length, 'Cache-Control': 'no-store, max-age=0' });
      res.end(asset.body);
    } catch (_) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, sockets, assets, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 1; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id) {
        const pending = this.pending.get(msg.id); if (!pending) return;
        this.pending.delete(msg.id); clearTimeout(pending.timer);
        return msg.error ? pending.reject(new Error(`${pending.method}: ${msg.error.message}`)) : pending.resolve(msg.result || {});
      }
      for (const fn of this.listeners.get(msg.method) || []) {
        try { fn(msg.params || {}); } catch (_) {}
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Chrome DevTools connection closed')); }
      this.pending.clear();
    });
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CDP(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), { once: true });
    });
  }
  on(method, fn) { const rows = this.listeners.get(method) || []; rows.push(fn); this.listeners.set(method, rows); }
  send(method, params = {}, timeout = 70000) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method}: timed out`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function launch(executable, profile, headed) {
  const flags = [
    '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-domain-reliability',
    '--disable-features=MediaRouter,OptimizationHints,Translate,AutofillServerCommunication',
    '--disable-sync', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
    '--disable-extensions', '--window-size=1440,1000',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
  ];
  if (!headed) flags.unshift('--headless=new', '--hide-scrollbars');
  if (process.platform !== 'win32') flags.unshift('--no-sandbox');
  const child = spawn(executable, flags, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: !headed });
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const portFile = path.join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(portFile) && Date.now() < deadline) await sleep(50);
  if (!fs.existsSync(portFile)) { child.kill(); throw new Error(`Chrome did not start\n${stderr.slice(-3000)}`); }
  let content = '';
  for (let i = 0; i < 100 && !content.trim(); i++) { try { content = fs.readFileSync(portFile, 'utf8'); } catch (_) {} if (!content.trim()) await sleep(50); }
  return { child, port: Number(content.trim().split(/\r?\n/)[0]), stderr: () => stderr };
}

async function page(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome target failed: ${response.status}`);
  const target = await response.json(); const cdp = await CDP.connect(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable')]);
  return cdp;
}

async function evalJs(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception && response.exceptionDetails.exception.description;
    throw new Error(detail || response.exceptionDetails.text || `Evaluation failed: ${expression.slice(0, 100)}`);
  }
  return response.result && response.result.value;
}

async function wait(cdp, name, expression, timeout = 30000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) {
    try { last = await evalJs(cdp, expression); if (last) return last; } catch (error) { last = error.message; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${name}; last=${JSON.stringify(last)}`);
}

async function click(cdp, selector) {
  const point = await evalJs(cdp, `(() => {const rows=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&!el.hidden&&!el.closest('[inert],[aria-hidden="true"]')&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0});if(rows.length!==1)return{ok:false,count:rows.length};const el=rows[0],r=el.getBoundingClientRect();el.scrollIntoView({block:'center',inline:'center'});const q=el.getBoundingClientRect();return{ok:true,x:q.left+q.width/2,y:q.top+q.height/2};})()`);
  assert(point && point.ok, `Could not resolve one visible ${selector}: ${JSON.stringify(point)}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sleep(100);
}

function routeNamed(name) {
  const route = ROUTES.find(item => item.route === name);
  if (!route) throw new Error(`Unknown route ${name}`);
  return route;
}

async function routeEntryVisible(cdp, route) {
  return evalJs(cdp, `(() => {
    const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0};
    if(${JSON.stringify(route.route)}==='history'){const source=document.getElementById('nav_history'),dock=document.querySelector('#mlsDock button[data-dest="patient"]');return shown(dock)&&!!source&&!source.disabled&&!source.hidden&&!source.classList.contains('nav-feat-off');}
    if(!${JSON.stringify(route.entry)})return false;
    return shown(document.querySelector(${JSON.stringify(route.entry)}));
  })()`);
}

async function openRoute(cdp, route) {
  if (route.route === 'history') {
    await click(cdp, routeNamed('patients').entry);
    await wait(cdp, 'Patients route before History', `window.__mlsCurrentView==='patients'`);
    await wait(cdp, 'visible History segment', `(() => {
      const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const el=[...document.querySelectorAll('#mlsRightNow .segbtn')].find(x=>shown(x)&&/^history$/i.test(String(x.textContent||'').trim()));
      if(!el)return false;el.setAttribute('data-control-audit-route','history');return true;
    })()`);
    await click(cdp, '#mlsRightNow [data-control-audit-route="history"]');
  } else {
    assert(route.entry, `No visible route driver is declared for ${route.route}`);
    await click(cdp, route.entry);
  }
  await wait(cdp, `${route.label} route`, `window.__mlsCurrentView===${JSON.stringify(route.route)}`);
}

async function fill(cdp, selector, value) {
  const result = await evalJs(cdp, `(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.focus();const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;})()`);
  assert.strictEqual(result, value, `Could not fill ${selector}`);
}

async function select(cdp, selector, value) {
  const result = await evalJs(cdp, `(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;})()`);
  assert.strictEqual(result, value, `Could not select ${selector}`);
}

async function shot(cdp, file) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 30000);
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
}

async function settle(cdp) {
  await evalJs(cdp, `(async()=>{if(window.__mlsSessionReady)await Promise.race([Promise.resolve(window.__mlsSessionReady),new Promise((_,r)=>setTimeout(()=>r(new Error('session timeout')),45000))]);if(document.fonts&&document.fonts.ready)await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return true;})()`, true);
  await wait(cdp, 'clinician shell', `document.body.classList.contains('mls-redesign')&&!!document.getElementById('mlsRdNav')&&!!window.__mlsWriteFlow`, 50000);
  await wait(cdp, 'all startup veils to release', `(() => {const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0.01&&r.width>0&&r.height>0};return !shown(document.getElementById('sfGateLoading'))&&!shown(document.getElementById('mlsBootVeil'))&&!document.documentElement.classList.contains('mls-secure-loading')&&!document.documentElement.classList.contains('mls-booting')})()`, 15000);
  await sleep(450);
}

async function reloadReady(cdp) {
  await cdp.send('Page.reload', { ignoreCache: true });
  await wait(cdp, 'restored synthetic session', `document.readyState==='complete'&&document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 30000);
  await settle(cdp);
}

function cleanFile(value) { return String(value || 'control').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'control'; }

function classify(control) {
  const base = `${control.id} ${control.label} ${control.title} ${control.href} ${control.onclick} ${control.classes}`.toLowerCase();
  const context = String(control.context || '').toLowerCase();
  const text = `${base} ${context}`;
  if (control.disabled) return { disposition: 'excluded', reason: 'disabled in the tested state' };
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(control.tag)) {
    if (control.type === 'file') return { disposition: 'excluded', reason: 'file upload excluded' };
    return { disposition: 'inspected', reason: 'field presence, visibility, labeling, and geometry inspected; value not changed' };
  }
  if (control.id === 'pushAllEmrBtn' || /review athena actions/.test(text)) return { disposition: 'exercise-review-only', reason: 'open review only; never confirm' };
  if (/delete|purge|remove|erase|clear all|reset all|wipe/.test(text)) return { disposition: 'excluded', reason: 'destructive action excluded' };
  if (/pay|payment|billing portal|upgrade|subscribe|subscription|purchase|checkout|credit card|start trial|change plan/.test(text)) return { disposition: 'excluded', reason: 'payment or plan action excluded' };
  if (/baa|agreement|contract|terms|legal|countersign|accept|signature/.test(text)) return { disposition: 'excluded', reason: 'legal acceptance/signing action excluded' };
  if (/send|email|e-mail|text a patient|sms|invite|share|submit for|cosign|publish|outreach|contact support/.test(text)) return { disposition: 'excluded', reason: 'communication or external submission excluded' };
  if (/sign out|log out|logout|delete account|account security|change password/.test(text)) return { disposition: 'excluded', reason: 'real account/security action excluded' };
  if (/athena|emr|extension|disconnect|\bsync\b|\bpull\b|import|backup|verify active|re-check|recheck|\brefresh\b/.test(text)) return { disposition: 'excluded', reason: 'Athena, extension, import, refresh, or integration action excluded' };
  if (/record|dictate|microphone|\bmic\b|voice|start[- ]?a?[- ]?visit|new visit/.test(base)) return { disposition: 'excluded', reason: 'microphone/audio or visit-capture action excluded' };
  if (/download|export|print|copy|clipboard|upload|choose file/.test(text)) return { disposition: 'excluded', reason: 'download, print, clipboard, or upload side effect excluded' };
  if (/generate|ask$|send message|ai sort|structure with ai|overall summary|panel summary|summarize my|which of my patients|reminder drafter|sgprunbtn|run the study/.test(text)) return { disposition: 'excluded', reason: 'AI/backend-generating action excluded' };
  if (/copilotdock|copilotcard|copilot-chip|mls-copilot|copilot-chat|copilot-prompt/.test(text)) return { disposition: 'excluded', reason: 'Copilot chat/send surface excluded' };
  if (control.href && !/^#|^javascript:/i.test(control.href)) return { disposition: 'excluded', reason: 'link/navigation outside the audited app excluded' };
  return { disposition: 'exercise', reason: 'local reversible UI action' };
}

async function collect(cdp, label) {
  return evalJs(cdp, `(() => {
    const shown=el=>{if(!el||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0};
    const norm=v=>String(v||'').replace(/\\s+/g,' ').trim();
    const name=el=>{const by=el.getAttribute('aria-labelledby');return norm(el.getAttribute('aria-label')||(by&&by.split(/\\s+/).map(id=>(document.getElementById(id)||{}).textContent||'').join(' '))||[...(el.labels||[])].map(x=>x.textContent||'').join(' ')||el.getAttribute('title')||el.innerText||el.textContent||el.value||el.placeholder)};
    const all=[...document.querySelectorAll('button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="menuitem"],[role="tab"],[tabindex]:not([tabindex="-1"])')].filter(shown);
    const counts={};all.forEach(el=>{const fp=[el.tagName,el.id||'',name(el),el.getAttribute('data-action')||'',el.getAttribute('data-act')||'',el.getAttribute('data-view')||''].join('|');counts[fp]=(counts[fp]||0)+1});
    const controls=all.map((el,index)=>{const r=el.getBoundingClientRect(),label=name(el),fp=[el.tagName,el.id||'',label,el.getAttribute('data-action')||'',el.getAttribute('data-act')||'',el.getAttribute('data-view')||''].join('|');let owner='global';for(const spec of ${JSON.stringify(ROUTES)}){const v=document.querySelector(spec.view);if(v&&v.contains(el)){owner=spec.route;break;}}if(el.closest('#mlsRdNav,#mlsDock'))owner='primary-nav';else if(el.closest('#mlsRdTop'))owner='topbar';else if(el.closest('[role="dialog"],.modal-bg.show,.mlsvnd-modal'))owner='dialog';let p=el,parts=[];for(let depth=0;p&&depth<6;depth++,p=p.parentElement){if(p.id)parts.push('#'+p.id);if(p.className&&typeof p.className==='string')parts.push('.'+p.className.trim().replace(/\s+/g,'.'));}const states={expanded:el.getAttribute('aria-expanded'),pressed:el.getAttribute('aria-pressed'),selected:el.getAttribute('aria-selected'),checked:el.getAttribute('aria-checked'),current:el.getAttribute('aria-current')};return{index,tag:el.tagName,id:el.id||'',label,title:el.getAttribute('title')||'',href:el.getAttribute('href')||'',onclick:el.getAttribute('onclick')||'',classes:String(el.className||''),context:parts.join(' '),states,type:el.type||'',disabled:!!el.disabled,owner,fp,fpCount:counts[fp],rect:{left:+r.left.toFixed(1),top:+r.top.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1),width:+r.width.toFixed(1),height:+r.height.toFixed(1)},inViewport:r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight,fullyInViewport:r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};});
    const ids={};[...document.querySelectorAll('[id]')].filter(shown).forEach(el=>{ids[el.id]=(ids[el.id]||0)+1});Object.keys(ids).forEach(id=>{if(ids[id]<2)delete ids[id]});
    const surfaceSelector='[role="dialog"],.modal-bg.show,.mlsvnd-scrim,.mls-qf-pro,#mlsRdNewMenu.open,[role="menu"],.mlsTbPanel.open,.mls-account-popover.open,#copilotDock.open,#copilotDockScrim.open';
    const surfaces=[...document.querySelectorAll(surfaceSelector)].filter(shown).map(el=>{const r=el.getBoundingClientRect();return{id:el.id||'',role:el.getAttribute('role')||'',cls:String(el.className||''),label:name(el),rect:{left:+r.left.toFixed(1),top:+r.top.toFixed(1),right:+r.right.toFixed(1),bottom:+r.bottom.toFixed(1),width:+r.width.toFixed(1),height:+r.height.toFixed(1)},intersects:r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight,reachable:(r.width<=innerWidth+2&&r.left>=-2&&r.right<=innerWidth+2)||(getComputedStyle(el).overflowX==='auto'),topReachable:r.top>=-2||(['auto','scroll'].includes(getComputedStyle(el).overflowY))};});
    const covering=[...document.querySelectorAll('body *')].filter(shown).filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.position==='fixed'&&r.left<=2&&r.top<=2&&r.right>=innerWidth-2&&r.bottom>=innerHeight-2}).map(el=>{const s=getComputedStyle(el);return{id:el.id||'',cls:String(el.className||''),role:el.getAttribute('role')||'',background:s.backgroundColor,opacity:s.opacity,pointerEvents:s.pointerEvents,zIndex:s.zIndex,label:name(el).slice(0,100)}});
    const nav=[...document.querySelectorAll('#mlsDock button[data-dest]')].filter(shown).map(el=>({id:el.getAttribute('data-dest')||'',label:name(el),on:el.getAttribute('aria-current')==='page'}));
    const visibleViews=${JSON.stringify(ROUTES)}.filter(spec=>{const el=document.querySelector(spec.view);return shown(el)}).map(spec=>spec.route);
    const statuses=[...document.querySelectorAll('[role="status"],#toast,[id*="Toast"],[class*="toast"]')].filter(shown).map(el=>({id:el.id||'',text:norm(el.innerText||el.textContent).slice(0,180),cls:String(el.className||'')}));
    const activeSpec=${JSON.stringify(ROUTES)}.find(spec=>spec.route===(window.__mlsCurrentView||''));const activeView=activeSpec&&document.querySelector(activeSpec.view);const content=activeView?norm(activeView.innerText||activeView.textContent):'';let viewDigest=2166136261;for(let i=0;i<content.length;i++){viewDigest^=content.charCodeAt(i);viewDigest=Math.imul(viewDigest,16777619);}viewDigest=(viewDigest>>>0).toString(16)+':'+content.length;
    return{label:${JSON.stringify(label)},view:window.__mlsCurrentView||'',url:location.href,controls,duplicateVisibleIds:ids,surfaces,covering,statuses,nav,visibleViews,viewDigest,active:{id:document.activeElement&&document.activeElement.id||'',tag:document.activeElement&&document.activeElement.tagName||'',label:document.activeElement?name(document.activeElement):''},scroll:{x:scrollX,y:scrollY},bodyClass:document.body.className,errors:(window.__controlAuditErrors||[]).slice(),nativeDialogs:(window.__controlAuditDialogs||[]).slice(),opens:(window.__controlAuditOpens||[]).slice(),mutations:window.__controlAuditMutations||0,clicks:(window.__controlAuditClicks||[]).slice(-30)};
  })()`);
}

function surfaceFailures(state, context) {
  const failures = [];
  for (const surface of state.surfaces) {
    if (!surface.intersects || !surface.reachable || !surface.topReachable) failures.push({ kind: 'offscreen-surface', context, surface });
  }
  return failures;
}

function stateSignature(state, target) {
  return JSON.stringify({
    view: state.view, surfaces: state.surfaces.map(s => [s.id, s.role, s.cls, s.label]),
    covering: state.covering, statuses: state.statuses, views: state.visibleViews,
    dialogs: state.nativeDialogs, opens: state.opens, bodyClass: state.bodyClass,
    scroll: state.scroll, active: state.active, viewDigest: state.viewDigest,
    controlSet: state.controls.map(x => [x.fp, x.classes, x.disabled, x.states]),
    target: target && [target.id, target.label, target.classes, target.disabled, target.states]
  });
}

async function dimState(cdp) {
  return evalJs(cdp, `(() => {
    const info=id=>{const el=document.getElementById(id);if(!el)return null;const s=getComputedStyle(el),r=el.getBoundingClientRect();return{id,cls:String(el.className||''),display:s.display,visibility:s.visibility,opacity:+s.opacity,filter:s.filter,pointerEvents:s.pointerEvents,animationName:s.animationName,animationDuration:s.animationDuration,animationPlayState:s.animationPlayState,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom}}};
    const shown=el=>{if(!el||el.hidden)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0};
    const covers=[...document.querySelectorAll('body *')].filter(shown).filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.position==='fixed'&&r.left<=2&&r.top<=2&&r.right>=innerWidth-2&&r.bottom>=innerHeight-2}).map(el=>{const s=getComputedStyle(el);return{id:el.id||'',cls:String(el.className||''),background:s.backgroundColor,opacity:+s.opacity,pointerEvents:s.pointerEvents,zIndex:s.zIndex,text:String(el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,100)}});
    return{at:Date.now(),elapsedMs:typeof window.__controlAuditDimStart==='number'?+(performance.now()-window.__controlAuditDimStart).toFixed(1):null,view:window.__mlsCurrentView||'',html:info(document.documentElement.id),body:info(document.body.id),app:info('appScreen'),visit:info('visitView'),covers,clicks:(window.__controlAuditClicks||[]).slice(-12)};
  })()`);
}

async function probeDimTransition(cdp, artifactDir) {
  const patientsRoute = routeNamed('patients'), visitRoute = routeNamed('visit');
  await reloadReady(cdp); await openRoute(cdp, patientsRoute);
  await evalJs(cdp, `window.__controlAuditDimStart=performance.now();document.querySelector(${JSON.stringify(visitRoute.entry)}).click();true`);
  const samples = [];
  samples.push({ delayMs: 0, state: await dimState(cdp) });
  for (const delay of [16, 32]) { await sleep(16); samples.push({ delayMs: delay, state: await dimState(cdp) }); }
  await shot(cdp, path.join(artifactDir, 'dim-probe-immediate.png'));
  for (const delay of [80, 160, 320, 800]) { await sleep(Math.max(0, delay - (samples[samples.length - 1].delayMs || 0))); samples.push({ delayMs: delay, state: await dimState(cdp) }); }
  await shot(cdp, path.join(artifactDir, 'dim-probe-settled.png'));
  const cycles = [];
  for (let i = 0; i < 12; i++) {
    await evalJs(cdp, `document.querySelector(${JSON.stringify(patientsRoute.entry)}).click();window.__controlAuditDimStart=performance.now();document.querySelector(${JSON.stringify(visitRoute.entry)}).click();true`);
    await sleep(36); const immediate = await dimState(cdp); await sleep(360); const settled = await dimState(cdp);
    cycles.push({ run: i + 1, immediate, settled });
  }
  const firstState = samples[0].state; const lastState = samples[samples.length - 1].state;
  const animatedSamples = samples.filter(x => x.state.visit && x.state.visit.animationName && x.state.visit.animationName !== 'none' && x.state.visit.opacity < 0.99);
  const coveringSamples = samples.filter(x => x.state.covers.length > 0);
  const first = firstState.visit || {}; const transient = animatedSamples.length ? animatedSamples[0].state.visit : null; const last = lastState.visit || {};
  const persistent = last.opacity < 0.99 || last.filter !== 'none' || last.pointerEvents === 'none' || lastState.covers.some(x => x.pointerEvents !== 'none');
  const cycleTransitionFailures = cycles.filter(x => !x.immediate.visit || x.immediate.visit.opacity < 0.99 || (x.immediate.visit.animationName && x.immediate.visit.animationName !== 'none') || x.immediate.covers.some(y => y.pointerEvents !== 'none'));
  const settledFailures = cycles.filter(x => !x.settled.visit || x.settled.visit.opacity < 0.99 || x.settled.visit.filter !== 'none' || x.settled.visit.pointerEvents === 'none' || x.settled.covers.some(y => y.pointerEvents !== 'none'));
  return {
    status: persistent || animatedSamples.length || coveringSamples.length || cycleTransitionFailures.length || settledFailures.length ? 'FAIL' : 'PASS',
    diagnosis: animatedSamples.length ? 'route-entry-animation' : (coveringSamples.length ? 'covering-overlay' : 'unexplained'),
    transientObserved: animatedSamples.length > 0 || coveringSamples.length > 0, persistent, first, transient, last,
    minOpacity: Math.min(...samples.map(x => x.state.visit ? x.state.visit.opacity : 1)),
    samples, cycles, cycleTransitionFailures, settledFailures
  };
}

async function auditNoPatient(cdp, artifactDir) {
  await openRoute(cdp, routeNamed('visit')); await sleep(450);
  const state = await collect(cdp, 'no-patient Today');
  const detail = await evalJs(cdp, `(() => {
    const shown=el=>{if(!el||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0};
    const norm=v=>String(v||'').replace(/\\s+/g,' ').trim();
    const selectors=['#mlsEasyTools','#mlsCockpit','#visitHero','#patientBar','#mlsCtxBar','[class*="quick"]','[id*="Quick"]','[id*="Tools"]'];
    const clusters=[];const seen=new Set();for(const sel of selectors)for(const el of document.querySelectorAll(sel)){if(seen.has(el)||!shown(el))continue;seen.add(el);const r=el.getBoundingClientRect();clusters.push({selector:sel,id:el.id||'',cls:String(el.className||''),text:norm(el.innerText||el.textContent).slice(0,400),rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},controls:[...el.querySelectorAll('button,a[href],[role="button"],[tabindex]:not([tabindex="-1"])')].filter(shown).map(x=>({id:x.id||'',label:norm(x.getAttribute('aria-label')||x.title||x.innerText||x.textContent),disabled:!!x.disabled}))})}
    return{activePatient:!!(window.activePatient&&window.activePatient()),clusters};
  })()`);
  assert.strictEqual(detail.activePatient, false, 'No-patient inventory unexpectedly had an active patient');
  await shot(cdp, path.join(artifactDir, 'no-patient-quick-tools.png'));
  await sleep(800); const quiet800 = await collect(cdp, 'no-patient quiet +800ms');
  await sleep(1200); const quiet2000 = await collect(cdp, 'no-patient quiet +2000ms');
  const controls = state.controls.filter(x => x.owner === 'visit' || x.owner === 'global');
  const duplicateLabels = {}; for (const control of controls) { const key = control.label.toLowerCase(); if (!key) continue; (duplicateLabels[key] ||= []).push(control); }
  for (const key of Object.keys(duplicateLabels)) if (duplicateLabels[key].length < 2) delete duplicateLabels[key];
  const decisions = controls.map(control => ({ control, ...classify(control) }));
  const clusterLabels = new Set(detail.clusters.flatMap(x => x.controls.map(y => y.label)));
  const clusterActions = [];
  const route = routeNamed('visit');
  const safeClusterControls = controls.filter(control => clusterLabels.has(control.label) && control.fpCount === 1 && classify(control).disposition === 'exercise');
  for (let i = 0; i < safeClusterControls.length; i++) {
    const control = safeClusterControls[i];
    const outcome = await exerciseCandidate(cdp, route, control, artifactDir, 900 + i);
    await shot(cdp, path.join(artifactDir, `no-patient-action-${String(i + 1).padStart(2, '0')}-${cleanFile(control.id || control.label)}.png`));
    clusterActions.push(outcome);
  }
  const autoChanges = [];
  const initialSurfaceKeys = new Set(state.surfaces.map(x => JSON.stringify(x)));
  const initialStatusKeys = new Set(state.statuses.map(x => JSON.stringify(x)));
  for (const sample of [{ at: 800, state: quiet800 }, { at: 2000, state: quiet2000 }]) {
    const newSurfaces = sample.state.surfaces.filter(x => !initialSurfaceKeys.has(JSON.stringify(x)));
    const newStatuses = sample.state.statuses.filter(x => !initialStatusKeys.has(JSON.stringify(x)));
    if (newSurfaces.length || newStatuses.length) autoChanges.push({ atMs: sample.at, surfaces: newSurfaces, statuses: newStatuses, clicks: sample.state.clicks });
  }
  const actionFailures = clusterActions.flatMap(x => x.failures || []);
  for (const outcome of clusterActions) if ((outcome.after.statuses || []).some(x => /open a patient first|select a patient first/i.test(x.text))) actionFailures.push({ kind: 'no-patient-visible-inapplicable-tool', control: outcome.control, statuses: outcome.after.statuses });
  return { status: actionFailures.length ? 'FAIL' : 'PASS', state: { view: state.view, controls, surfaces: state.surfaces, covering: state.covering, statuses: state.statuses, clicks: state.clicks, nativeDialogs: state.nativeDialogs, duplicateVisibleIds: state.duplicateVisibleIds }, quietSamples: [{ atMs: 800, surfaces: quiet800.surfaces, statuses: quiet800.statuses, clicks: quiet800.clicks }, { atMs: 2000, surfaces: quiet2000.surfaces, statuses: quiet2000.statuses, clicks: quiet2000.clicks }], autoChanges, clusters: detail.clusters, duplicateLabels, decisions, clusterActions, actionFailures };
}

async function auditPhoneLifecycle(cdp) {
  await reloadReady(cdp);
  const sample = () => evalJs(cdp, `(() => {
    const box=document.getElementById('mlsGpQrBox'),phone=document.getElementById('phoneMicBtn')||document.getElementById('mlsGpPhoneBtn');
    if(box&&!box.__controlAuditNodeToken)box.__controlAuditNodeToken='phone-box-'+Math.random().toString(36).slice(2);
    return{at:Date.now(),mutations:window.__controlAuditMutations||0,box:box?{token:box.__controlAuditNodeToken,parentId:box.parentElement&&box.parentElement.id||'',connected:box.isConnected}:null,phone:phone?{id:phone.id||'',parentId:phone.parentElement&&phone.parentElement.id||'',previousId:phone.previousElementSibling&&phone.previousElementSibling.id||'',connected:phone.isConnected}:null,intervals:(window.__controlAuditIntervals||[]).filter(x=>/feat_mls_force_full_phone\.js/i.test(x.stack||'')).map(x=>({delayMs:x.delayMs,fires:x.fires.slice(),stack:x.stack})) ,statuses:[...document.querySelectorAll('[role="status"],#toast,[id*="Toast"],[class*="toast"]')].filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0}).map(el=>String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim().slice(0,180))};
  })()`);
  const first = await sample(); await sleep(4800); const last = await sample();
  return { status: first.box && last.box && first.box.token === last.box.token && first.box.parentId === last.box.parentId && JSON.stringify(first.phone) === JSON.stringify(last.phone) ? 'STABLE' : 'CHANGED', first, last, mutationDelta: last.mutations - first.mutations, registeredBackgroundIntervals: last.intervals.length, backgroundIntervalFires: last.intervals.reduce((n, x) => n + x.fires.length, 0) };
}

async function prepareFixture(cdp) {
  await reloadReady(cdp);
  await openRoute(cdp, routeNamed('patients'));
  await click(cdp, '#ptNewBtn');
  await wait(cdp, 'New patient dialog', `document.getElementById('patientModal').classList.contains('show')`);
  await fill(cdp, '#ptName', PATIENT.name); await fill(cdp, '#ptMrn', PATIENT.mrn); await fill(cdp, '#ptDob', PATIENT.dob); await select(cdp, '#ptSex', PATIENT.sex);
  await click(cdp, '#patientModal button[onclick="savePatient()"]');
  const patient = await wait(cdp, 'saved patient', `(() => {const p=window.activePatient&&window.activePatient();return p&&p.name===${JSON.stringify(PATIENT.name)}?p:false})()`, 10000);
  await openRoute(cdp, routeNamed('visit')); await fill(cdp, '#transcript', TRANSCRIPT);
  const saved = await evalJs(cdp, `(() => {const note=${JSON.stringify(NOTE)};currentSoap=note;currentInsurance='';currentFormat='soap';currentCoding={em:'99213',em_just:'Synthetic fixture only',icd:['M54.50'],cpt:[]};lastEMR={cc:'Synthetic back follow-up',dx:'M54.50 - synthetic fixture',meds:'None',orders:'None',fu:'Reviewed',em:'99213',icd:'M54.50',cpt:'None'};const box=document.getElementById('noteBox');box.value=note;box.style.display='block';box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));const simple=document.getElementById('mls-note');if(simple){simple.value=note;simple.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));}const empty=document.getElementById('noteEmpty');if(empty)empty.style.display='none';if(typeof populateEMR==='function')populateEMR(lastEMR,currentCoding);if(typeof renderCoding==='function')renderCoding(currentCoding);if(typeof enableOutputs==='function')enableOutputs(true);saveCurrentNote(false);const p=activePatient(),n=getNotes().find(row=>row.patientId===p.id&&row.soap===note);return n&&{id:n.id,patientId:n.patientId};})()`);
  assert(saved && saved.id, `Synthetic note did not save: ${JSON.stringify(saved)}`);
  return { patient: { id: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn }, note: saved };
}

async function markByFingerprint(cdp, fp, marker) {
  return evalJs(cdp, `(() => {const shown=el=>{if(!el||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const norm=v=>String(v||'').replace(/\\s+/g,' ').trim();const name=el=>{const by=el.getAttribute('aria-labelledby');return norm(el.getAttribute('aria-label')||(by&&by.split(/\\s+/).map(id=>(document.getElementById(id)||{}).textContent||'').join(' '))||[...(el.labels||[])].map(x=>x.textContent||'').join(' ')||el.getAttribute('title')||el.innerText||el.textContent||el.value||el.placeholder)};const rows=[...document.querySelectorAll('button,a[href],[role="button"],[role="menuitem"],[role="tab"],[tabindex]:not([tabindex="-1"])')].filter(shown).filter(el=>[el.tagName,el.id||'',name(el),el.getAttribute('data-action')||'',el.getAttribute('data-act')||'',el.getAttribute('data-view')||''].join('|')===${JSON.stringify(fp)});if(rows.length!==1)return{ok:false,count:rows.length};rows[0].setAttribute('data-control-audit-marker',${JSON.stringify(marker)});return{ok:true};})()`);
}

/* Controls such as the active-patient Snapshot button can be legitimately
   remounted by a bounded card refresh. Resolve its stable fingerprint in the
   same live DOM turn that obtains the click point instead of trusting a
   temporary attribute on an older node. */
async function clickFingerprint(cdp, fp) {
  const point = await evalJs(cdp, `(() => {const shown=el=>{if(!el||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const norm=v=>String(v||'').replace(/\\s+/g,' ').trim();const name=el=>{const by=el.getAttribute('aria-labelledby');return norm(el.getAttribute('aria-label')||(by&&by.split(/\\s+/).map(id=>(document.getElementById(id)||{}).textContent||'').join(' '))||[...(el.labels||[])].map(x=>x.textContent||'').join(' ')||el.getAttribute('title')||el.innerText||el.textContent||el.value||el.placeholder)};const rows=[...document.querySelectorAll('button,a[href],[role="button"],[role="menuitem"],[role="tab"],[tabindex]:not([tabindex="-1"])')].filter(shown).filter(el=>[el.tagName,el.id||'',name(el),el.getAttribute('data-action')||'',el.getAttribute('data-act')||'',el.getAttribute('data-view')||''].join('|')===${JSON.stringify(fp)});if(rows.length!==1)return{ok:false,count:rows.length};rows[0].scrollIntoView({block:'center',inline:'center'});const r=rows[0].getBoundingClientRect();return{ok:true,x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  assert(point&&point.ok,`Could not resolve one live control fingerprint ${fp}: ${JSON.stringify(point)}`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  await sleep(100);
}

async function exerciseCandidate(cdp, route, candidate, artifactDir, serial) {
  await reloadReady(cdp);
  await evalJs(cdp, `(() => {if(typeof getPatients!=='function'||typeof setActivePtId!=='function')return false;const p=getPatients().find(x=>x&&x.name===${JSON.stringify(PATIENT.name)}&&x.mrn===${JSON.stringify(PATIENT.mrn)});if(!p)return false;setActivePtId(p.id);if(typeof renderPatients==='function')renderPatients();if(typeof renderProfile==='function')renderProfile();if(typeof renderPatientBar==='function')renderPatientBar();if(typeof updateNavCounts==='function')updateNavCounts();return p.id})()`);
  await openRoute(cdp, route);
  const setupStarted = Date.now(); await sleep(350);
  const marker = `${route.route}-${serial}`;
  /* Study Groups is deliberately a late, ordered satellite asset and its own boot
     defers 600 ms. After the audit's many ignore-cache isolation reloads it can sit
     behind the preceding satellite wave even though the clinician shell is ready.
     Give that exact owner a bounded asset-ready window; ordinary controls retain
     the tighter six-second consistency budget. */
  const setupBudgetMs = candidate.id === 'mlsB39SgHead' ? 30000 : 6000;
  let marked = null;
  while (Date.now() - setupStarted < setupBudgetMs) {
    marked = await markByFingerprint(cdp, candidate.fp, marker);
    if (marked.ok || marked.count > 1) break;
    await sleep(200);
  }
  const setupWaitMs = Date.now() - setupStarted;
  if (!marked || !marked.ok) {
    const readiness = candidate.id === 'mlsB39SgHead' ? await evalJs(cdp, `(() => {const s=document.querySelector('script[data-mls-asset="feat_mls_studygroups.js"]'),h=document.getElementById('mlsB39SgHead'),cs=h&&getComputedStyle(h),r=h&&h.getBoundingClientRect();return{ownerScript:!!s,ownerSrc:s&&s.src||'',apiReady:!!window.__mlsStudyGroups,rootReady:!!document.getElementById('mls-sg-root'),wrapperReady:!!document.getElementById('mlsB39SgWrap'),headReady:!!h,headName:h&&String(h.innerText||h.textContent||'').replace(/\s+/g,' ').trim()||'',headDisplay:cs&&cs.display||'',headVisibility:cs&&cs.visibility||'',headRect:r?{left:r.left,top:r.top,width:r.width,height:r.height}:null,launcherReady:!!document.getElementById('mls-sg-launch'),view:window.__mlsCurrentView||''}})()`) : null;
    return { status: 'FAIL', kind: 'route-inconsistent-control', route: route.route, control: candidate, setupWaitMs, setupBudgetMs, detail: Object.assign({}, marked || {}, readiness ? { readiness } : {}) };
  }
  const before = await collect(cdp, `${route.route}:before:${candidate.label}`);
  const errorCount = before.errors.length;
  const exceptionStart = before.nativeDialogs.length;
  await clickFingerprint(cdp, candidate.fp);
  await sleep(700);
  const after = await collect(cdp, `${route.route}:after:${candidate.label}`);
  const targetAfter = after.controls.find(x => x.fp === candidate.fp);
  const changed = stateSignature(before, candidate) !== stateSignature(after, targetAfter) || after.nativeDialogs.length > exceptionStart;
  const newErrors = after.errors.slice(errorCount);
  const failures = [];
  if (!changed) failures.push({ kind: 'no-observable-effect', route: route.route, control: candidate });
  if (newErrors.length) failures.push({ kind: 'handler-exception', route: route.route, control: candidate, errors: newErrors });
  failures.push(...surfaceFailures(after, `${route.route}:${candidate.label}`));
  if (failures.length) await shot(cdp, path.join(artifactDir, `failure-${String(serial).padStart(3, '0')}-${cleanFile(candidate.id || candidate.label)}.png`));
  return { status: failures.length ? 'FAIL' : 'PASS', route: route.route, control: candidate, setupWaitMs, changed, failures, after: { view: after.view, surfaces: after.surfaces, statuses: after.statuses, nativeDialogs: after.nativeDialogs.slice(-3), opens: after.opens.slice(-3) } };
}

async function auditNewMenu(cdp, artifactDir) {
  const results = [];
  await reloadReady(cdp); await openRoute(cdp, routeNamed('patients'));
  const offered = await evalJs(cdp, `(() => {const el=document.getElementById('mlsRdNewBtn');if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()`);
  if (!offered) return results;
  const expected = ['New patient', 'New visit', 'New appointment'];
  for (let i = 0; i < expected.length; i++) {
    const label = expected[i]; await reloadReady(cdp); await openRoute(cdp, routeNamed('patients'));
    await click(cdp, '#mlsRdNewBtn'); await wait(cdp, 'New menu open', `document.getElementById('mlsRdNewMenu').classList.contains('open')`);
    const menu = await collect(cdp, `New menu: ${label}`);
    const surface = menu.surfaces.find(x => x.id === 'mlsRdNewMenu');
    if (!surface || !surface.intersects || !surface.reachable || !surface.topReachable) {
      results.push({ status: 'FAIL', label, kind: 'menu-offscreen-or-missing', menu: surface || null }); continue;
    }
    const marked = await evalJs(cdp, `(() => {const labels=[...document.querySelectorAll('#mlsRdNewMenu button')].map(x=>(x.textContent||'').trim());const rows=[...document.querySelectorAll('#mlsRdNewMenu button')].filter(x=>(x.textContent||'').trim()===${JSON.stringify(label)});if(rows.length!==1)return{ok:false,count:rows.length,labels};rows[0].setAttribute('data-control-audit-new',${JSON.stringify(String(i))});return{ok:true,labels}})()`);
    const exactMenu = marked.ok && marked.labels.length === expected.length && marked.labels.every((value, at) => value === expected[at]);
    if (!exactMenu) { results.push({ status: 'FAIL', label, kind: 'missing-duplicate-or-unexpected-menu-action', detail: marked, expected }); continue; }
    const before = await collect(cdp, `New menu before ${label}`); await click(cdp, `[data-control-audit-new="${i}"]`); await sleep(700); const after = await collect(cdp, `New menu after ${label}`);
    const changed = stateSignature(before) !== stateSignature(after);
    const failures = [];
    if (!changed) failures.push({ kind: 'no-observable-effect' });
    failures.push(...surfaceFailures(after, `New > ${label}`));
    if (after.errors.length > before.errors.length) failures.push({ kind: 'handler-exception', errors: after.errors.slice(before.errors.length) });
    if (failures.length) await shot(cdp, path.join(artifactDir, `failure-new-${cleanFile(label)}.png`));
    results.push({ status: failures.length ? 'FAIL' : 'PASS', label, changed, after: { view: after.view, surfaces: after.surfaces }, failures });
  }
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2)); if (opts.help) return process.stdout.write(`${usage()}\n`);
  const executable = findChrome(opts.chrome); const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(opts.artifacts || path.join(__dirname, 'live-visible-controls-artifacts', stamp)); fs.mkdirSync(artifactDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-visible-controls-chrome-')); const hosted = await serve();
  let chrome = null, cdp = null; const blockedRequests = [], cdpExceptions = [], consoleErrors = [];
  let report = null;
  try {
    chrome = await launch(executable, profile, opts.headed); cdp = await page(chrome.port, 'about:blank');
    cdp.on('Runtime.exceptionThrown', (event) => cdpExceptions.push(event.exceptionDetails && (event.exceptionDetails.exception && event.exceptionDetails.exception.description || event.exceptionDetails.text) || 'unknown'));
    cdp.on('Runtime.consoleAPICalled', (event) => { if (event.type === 'error') consoleErrors.push((event.args || []).map(x => x.value || x.description || '').join(' ')); });
    cdp.on('Fetch.requestPaused', (event) => {
      let local = false; try { const u = new URL(event.request.url); local = u.hostname === '127.0.0.1' && u.origin === hosted.origin; } catch (_) {}
      if (local) cdp.send('Fetch.continueRequest', { requestId: event.requestId }, 5000).catch(() => {});
      else { blockedRequests.push({ url: event.request.url, method: event.request.method, resourceType: event.resourceType }); cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }, 5000).catch(() => {}); }
    });
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'http://*', requestStage: 'Request' }, { urlPattern: 'https://*', requestStage: 'Request' }] });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__controlAuditErrors=[];window.__controlAuditDialogs=[];window.__controlAuditOpens=[];window.__controlAuditClicks=[];window.__controlAuditMutations=0;window.__controlAuditIntervals=[];
      const __controlAuditSetInterval=window.setInterval.bind(window);window.setInterval=function(fn,delay){const args=[...arguments].slice(2),rec={delayMs:Number(delay)||0,stack:String(new Error().stack||''),fires:[]};window.__controlAuditIntervals.push(rec);return __controlAuditSetInterval(function(){rec.fires.push(Date.now());if(rec.fires.length>40)rec.fires.shift();return typeof fn==='function'?fn.apply(this,args):(0,eval)(String(fn));},delay)};
      addEventListener('error',e=>window.__controlAuditErrors.push(String(e.error&&e.error.stack||e.message||'error')));
      addEventListener('unhandledrejection',e=>window.__controlAuditErrors.push(String(e.reason&&e.reason.stack||e.reason||'rejection')));
      document.addEventListener('click',e=>{const x=e.target&&e.target.closest&&e.target.closest('button,a,[role="button"],[role="menuitem"],[role="tab"],[tabindex]');if(x)window.__controlAuditClicks.push({id:x.id||'',text:String(x.innerText||x.textContent||'').replace(/\\s+/g,' ').trim().slice(0,100),ts:Date.now()})},true);
      new MutationObserver(rows=>{window.__controlAuditMutations+=(rows||[]).length}).observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
      const _open=window.open;window.open=function(url){window.__controlAuditOpens.push(String(url||''));return null};
      window.alert=function(value){window.__controlAuditDialogs.push({type:'alert',text:String(value||'')});};
      window.confirm=function(value){window.__controlAuditDialogs.push({type:'confirm-denied',text:String(value||'')});return false;};
      window.prompt=function(value){window.__controlAuditDialogs.push({type:'prompt-denied',text:String(value||'')});return null;};
    ` });
    const appUrl = `${hosted.origin}/ScribeFlow.html?demo=1&visibleControlsAudit=20260718`;
    await cdp.send('Page.navigate', { url: appUrl }); await wait(cdp, 'auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`, 30000);
    await evalJs(cdp, `localStorage.clear();sessionStorage.clear();location.reload();true`); await wait(cdp, 'clean auth page', `document.readyState==='complete'&&!!document.getElementById('tabSignup')`, 30000);
    await click(cdp, '#tabSignup');
    await wait(cdp, 'local synthetic agreement manifest', `document.getElementById('authSignupAssentFields')&&!document.getElementById('authSignupAssentFields').disabled`, 10000);
    await fill(cdp, '#authEmail', ACCOUNT.email); await fill(cdp, '#authPass', ACCOUNT.password); await fill(cdp, '#authPass2', ACCOUNT.password);
    await click(cdp, '#authTermsAssent'); await click(cdp, '#authPracticeAuthority');
    await wait(cdp, 'explicit local synthetic signup assent', `document.getElementById('authTermsAssent').checked&&document.getElementById('authPracticeAuthority').checked&&!document.getElementById('authBtn').disabled`, 5000);
    await click(cdp, '#authBtn');
    await wait(cdp, 'synthetic local account', `document.getElementById('appScreen')&&getComputedStyle(document.getElementById('appScreen')).display!=='none'`, 30000); await settle(cdp);
    assert.strictEqual(await evalJs(cdp, `new URL(location.href).searchParams.get('demo')==='1'&&typeof _SF_DEMO!=='undefined'&&_SF_DEMO===true&&typeof backendMode==='function'&&backendMode()===false`), true, 'Audit escaped local demo/no-backend mode');
    const noPatientQuickTools = await auditNoPatient(cdp, artifactDir);
    const phoneLifecycle = await auditPhoneLifecycle(cdp);
    const fixture = await prepareFixture(cdp);
    const dimTransition = await probeDimTransition(cdp, artifactDir);
    const routeInventories = [], routeFailures = [], exclusions = [], inspected = [], candidates = [];
    if (phoneLifecycle.status !== 'STABLE') routeFailures.push({ kind: 'phone-ui-repositioned-during-quiet-window', detail: phoneLifecycle });
    if (phoneLifecycle.registeredBackgroundIntervals || phoneLifecycle.backgroundIntervalFires) routeFailures.push({ kind: 'phone-ui-background-polling-present', detail: phoneLifecycle });
    if (Object.keys(noPatientQuickTools.state.duplicateVisibleIds || {}).length) routeFailures.push({ kind: 'no-patient-duplicate-visible-ids', ids: noPatientQuickTools.state.duplicateVisibleIds });
    if (noPatientQuickTools.actionFailures.length) routeFailures.push(...noPatientQuickTools.actionFailures.map(x => ({ kind: 'no-patient-quick-tool-action', ...x })));
    if (noPatientQuickTools.autoChanges.length) routeFailures.push({ kind: 'no-patient-surprise-auto-status-change', changes: noPatientQuickTools.autoChanges });
    if (dimTransition.status !== 'PASS') routeFailures.push({ kind: 'route-dim-or-cover-transition-present', detail: dimTransition });
    const visibleRouteIds = [];
    for (const route of ROUTES) if (await routeEntryVisible(cdp, route)) visibleRouteIds.push(route.id);
    const requiredDemoRouteIds = ['nav_visit', 'nav_patients', 'nav_history', 'nav_studio'];
    for (const requiredId of requiredDemoRouteIds) {
      assert(visibleRouteIds.includes(requiredId), `Required demo clinician route is not visible: #${requiredId}`);
    }
    const routesToAudit = ROUTES.filter(route => visibleRouteIds.includes(route.id));
    assert(routesToAudit.length >= requiredDemoRouteIds.length, `Only ${routesToAudit.length} clinician routes are visible in demo mode`);
    const routeAvailability = ROUTES.map(route => ({
      id: route.id,
      route: route.route,
      label: route.label,
      visibleInDemo: visibleRouteIds.includes(route.id),
      disposition: visibleRouteIds.includes(route.id) ? 'live-audited' : 'hosted-role-only'
    }));
    for (let i = 0; i < routesToAudit.length; i++) {
      const route = routesToAudit[i]; await openRoute(cdp, route); await sleep(350);
      const state = await collect(cdp, `${route.label} first visit`); await shot(cdp, path.join(artifactDir, `route-${String(i + 1).padStart(2, '0')}-${route.route}.png`));
      await sleep(1500); const quiet = await collect(cdp, `${route.label} quiet window`);
      const stableState = quiet;
      if (stableState.duplicateVisibleIds && Object.keys(stableState.duplicateVisibleIds).length) routeFailures.push({ kind: 'duplicate-visible-ids', route: route.route, ids: stableState.duplicateVisibleIds });
      if (stableState.visibleViews.length !== 1 || stableState.visibleViews[0] !== route.route) routeFailures.push({ kind: 'competing-route-surfaces', route: route.route, visibleViews: stableState.visibleViews });
      const active = stableState.nav.filter(x => x.on); if (active.length !== 1 || active[0].id !== route.dest) routeFailures.push({ kind: 'wrong-or-competing-nav-owner', route: route.route, nav: stableState.nav });
      routeFailures.push(...surfaceFailures(stableState, `${route.route}:stable`));
      const missingNames = stableState.controls.filter(x => !x.label); if (missingNames.length) routeFailures.push({ kind: 'visible-controls-without-name', route: route.route, controls: missingNames });
      const surfaceKeys = new Set(state.surfaces.map(x => JSON.stringify(x))); const statusKeys = new Set(state.statuses.map(x => JSON.stringify(x)));
      const newSurfaces = quiet.surfaces.filter(x => !surfaceKeys.has(JSON.stringify(x))); const newStatuses = quiet.statuses.filter(x => !statusKeys.has(JSON.stringify(x)));
      if (newSurfaces.length || newStatuses.length) routeFailures.push({ kind: 'surprise-auto-surface-or-status', route: route.route, before: { surfaces: state.surfaces, statuses: state.statuses }, after: { surfaces: newSurfaces, statuses: newStatuses }, clicks: quiet.clicks });
      const routeControls = stableState.controls.filter(x => x.owner === route.route || (x.owner === 'global' && route.route === 'visit'));
      for (const control of routeControls) {
        const decision = classify(control); const row = { route: route.route, control, ...decision };
        if (decision.disposition === 'excluded') exclusions.push(row);
        else if (decision.disposition === 'inspected') inspected.push(row);
        else if (control.fpCount !== 1) exclusions.push({ ...row, disposition: 'excluded', reason: 'ambiguous duplicate fingerprint; not clicked' });
        else candidates.push({ route, control, reviewOnly: decision.disposition === 'exercise-review-only' });
      }
      routeInventories.push({ route: route.route, label: route.label, controlCount: stableState.controls.length, routeControlCount: routeControls.length, controls: stableState.controls, surfaces: stableState.surfaces, statuses: stableState.statuses, nav: stableState.nav });
      const next = routesToAudit[(i + 1) % routesToAudit.length]; await openRoute(cdp, next); await openRoute(cdp, route); await sleep(1850);
      const revisit = await collect(cdp, `${route.label} revisit`); const firstKeys = stableState.controls.filter(x => x.owner === route.route).map(x => x.fp).sort(); const revisitKeys = revisit.controls.filter(x => x.owner === route.route).map(x => x.fp).sort();
      if (JSON.stringify(firstKeys) !== JSON.stringify(revisitKeys)) routeFailures.push({ kind: 'route-dependent-control-inconsistency', route: route.route, first: firstKeys, revisit: revisitKeys });
    }
    const newMenu = await auditNewMenu(cdp, artifactDir);
    const selectedCandidates = opts.only ? candidates.filter(item => `${item.control.id} ${item.control.label}`.toLowerCase().includes(opts.only.toLowerCase())) : candidates;
    const exercises = []; const limit = opts.max ? Math.min(opts.max, selectedCandidates.length) : selectedCandidates.length;
    for (let i = 0; i < limit; i++) {
      const item = selectedCandidates[i]; process.stdout.write(`[controls] ${i + 1}/${limit} ${item.route.route}: ${item.control.id || item.control.label}\n`);
      const outcome = await exerciseCandidate(cdp, item.route, item.control, artifactDir, i + 1); exercises.push(outcome);
    }
    const exercisedKeys = new Set(selectedCandidates.slice(0, limit).map(item => `${item.route.route}|${item.control.fp}`));
    for (const item of candidates) if (!exercisedKeys.has(`${item.route.route}|${item.control.fp}`)) exclusions.push({ route: item.route.route, control: item.control, disposition: 'excluded', reason: opts.only && !`${item.control.id} ${item.control.label}`.toLowerCase().includes(opts.only.toLowerCase()) ? `not exercised because --only=${opts.only}` : `not exercised because --max=${opts.max}` });
    const exerciseFailures = exercises.filter(x => x.status === 'FAIL'); const newMenuFailures = newMenu.filter(x => x.status === 'FAIL');
    const finalState = await collect(cdp, 'final');
    const workspaceDrift = [];
    for (const [file, asset] of hosted.assets) {
      try {
        const current = fs.readFileSync(file); const sha256 = crypto.createHash('sha256').update(current).digest('hex');
        if (sha256 !== asset.sha256) workspaceDrift.push({ file: path.relative(ROOT, file), snapshotSha256: asset.sha256, currentSha256: sha256 });
      } catch (error) { workspaceDrift.push({ file: path.relative(ROOT, file), snapshotSha256: asset.sha256, currentSha256: null, error: error.message }); }
    }
    if (workspaceDrift.length) routeFailures.push({ kind: 'workspace-source-changed-during-audit', assets: workspaceDrift });
    const failures = [...routeFailures, ...newMenuFailures.map(x => ({ kind: 'new-menu-action', ...x })), ...exerciseFailures.flatMap(x => x.failures || [x])];
    const keyAssetNames = ['ScribeFlow.html', 'mls-connect.js', 'feat_mls_studygroups.js', 'feat_mls_calpro.js', 'feat_mls_force_full_phone.js'];
    const keyAssets = {};
    for (const name of keyAssetNames) {
      const asset = hosted.assets.get(path.join(ROOT, name));
      keyAssets[name] = asset ? { bytes: asset.body.length, sha256: asset.sha256 } : null;
    }
    report = {
      status: failures.length ? 'FAIL' : 'PASS', generatedAt: new Date().toISOString(), syntheticOnly: true,
      chrome: await evalJs(cdp, 'navigator.userAgent'), appUrl, fixture, safety: { temporaryProfile: true, extensionsDisabled: true, demoMode: true, backendMode: false, nonLoopbackRequestsBlocked: true, nativeConfirmDefault: false },
      assetSnapshot: { immutableDuringRun: true, servedAssetCount: hosted.assets.size, keyAssets, workspaceDrift },
      summary: { routesInventoried: routeInventories.length, hostedRoleRoutesExcluded: routeAvailability.filter(x => !x.visibleInDemo).length, controlsInventoried: routeInventories.reduce((n, x) => n + x.routeControlCount, 0), safeControlsExercised: exercises.length, safeControlFailures: exerciseFailures.length, newMenuActionsExercised: newMenu.length, newMenuFailures: newMenuFailures.length, fieldsInspected: inspected.length, explicitlyExcluded: exclusions.length, totalFailures: failures.length },
      failures, noPatientQuickTools, phoneLifecycle, dimTransition, routeAvailability, routeInventories, newMenu, exercises, inspected, exclusions, blockedRequests, cdpExceptions, consoleErrors, finalPageErrors: finalState.errors,
      coverageBoundary: {
        liveAutomated: ['real Google Chrome', 'fresh temporary profile', 'extensions disabled', 'local ?demo=1 account', `${routesToAudit.length} canonical clinician routes visible to the demo role`, 'visible control inventory', 'safe reversible control clicks', 'visible creation controls', 'route revisit consistency', 'handler exceptions', 'duplicate visible IDs', 'competing route owners', 'off-screen dialog/menu surfaces', 'surprise auto-surfaces'],
        explicitlyNotClaimed: ['hosted-role-only routes hidden from the no-backend demo role', 'Athena or other EMR page/data/write', 'MLS Assist extension', 'production or local backend', 'real account/session', 'PHI', 'microphone/camera', 'communications', 'downloads/uploads/printing/clipboard', 'destructive actions', 'payments/subscriptions', 'legal terms/signing', 'API/AI-generated results']
      }
    };
    fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    const md = [
      '# Live clinician-visible controls audit', '', `Status: **${report.status}**`, '', `Generated: ${report.generatedAt}`, '',
      `Chrome: ${report.chrome}`, '',
      `Inventoried ${report.summary.controlsInventoried} route-owned visible controls across ${report.summary.routesInventoried} routes. Exercised ${report.summary.safeControlsExercised} safe controls plus ${report.summary.newMenuActionsExercised} separately visible New-menu actions when offered.`, '',
      `Failures: ${report.summary.totalFailures}. Explicit exclusions: ${report.summary.explicitlyExcluded}.`, '',
      '## Failures', '', ...(failures.length ? failures.map((x, i) => `${i + 1}. \`${x.kind || x.status}\` — ${x.route || x.label || x.context || 'global'}${x.control ? ` — ${x.control.id || x.control.label}` : ''}`) : ['None.']), '',
      '## Safety boundary', '', 'Fresh-profile local demo only. Non-loopback requests were failed before transmission. The extension, Athena, backend, real accounts, PHI, microphone, communications, destructive actions, payments, and legal signing were not used.', '',
      'See `report.json` for every control, outcome, exact exclusion reason, and screenshot filename.'
    ].join('\n');
    fs.writeFileSync(path.join(artifactDir, 'report.md'), `${md}\n`);
    process.stdout.write(`${report.status} live visible-controls audit\nArtifacts: ${artifactDir}\nSummary: ${JSON.stringify(report.summary)}\n`);
    if (failures.length) process.exitCode = 1;
  } catch (error) {
    if (cdp) try { await shot(cdp, path.join(artifactDir, 'HARNESS-FAIL.png')); } catch (_) {}
    const failed = { status: 'HARNESS-FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true, error: error.stack || String(error), blockedRequests, cdpExceptions, consoleErrors };
    try { fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(failed, null, 2)}\n`); } catch (_) {}
    error.message += `\nArtifacts: ${artifactDir}`; throw error;
  } finally {
    if (cdp) { try { await cdp.send('Fetch.disable', {}, 3000); } catch (_) {} cdp.close(); }
    if (chrome && chrome.child) try { chrome.child.kill(); } catch (_) {}
    try { hosted.server.closeAllConnections(); } catch (_) {} for (const socket of hosted.sockets) try { socket.destroy(); } catch (_) {}
    await new Promise(resolve => hosted.server.close(resolve));
    if (path.basename(profile).startsWith('mls-visible-controls-chrome-')) try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
