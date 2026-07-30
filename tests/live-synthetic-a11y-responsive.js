'use strict';

/*
 * Real-Chrome, synthetic-only accessibility and responsive proof.
 *
 * This test is deliberately standalone and is not part of run-all.js. It uses
 * a fresh temporary Chrome profile, serves the real app with ?demo=1, blocks
 * non-local hosts, never loads an extension, and never performs an Athena or
 * backend write. Screenshots plus JSON/Markdown evidence are emitted under
 * tests/live-a11y-artifacts (or --artifacts=PATH).
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ACCOUNT = { email: 'clinician.a11y-smoke@mls.local', password: 'SyntheticA11y2026!' };
const PATIENT = { name: 'Synthetic A11y Patient', dob: '1980-01-02', mrn: 'SYN-A11Y-0001', sex: 'Female' };
const VISIBLE_ROUTE = Object.freeze({
  visit: '#mlsDock button[data-dest="visit"]',
  patients: '#mlsDock button[data-dest="patient"]'
});
const TRANSCRIPT = 'Synthetic fixture only. Follow-up for mechanical back discomfort. No real patient data is represented.';
const NOTE = [
  'SUBJECTIVE:', 'Synthetic fixture only. Mechanical back discomfort follow-up.', '',
  'OBJECTIVE:', 'Synthetic fixture: alert and comfortable. No real findings.', '',
  'ASSESSMENT:', 'Mechanical back discomfort - synthetic test fixture.', '',
  'PLAN:', 'Continue reviewed conservative measures and synthetic return precautions.'
].join('\n');

function args(argv) {
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
    'Usage: node tests/live-synthetic-a11y-responsive.js [options]', '',
    '  --headed          Show the isolated Chrome window',
    '  --chrome=PATH     Explicit Chrome/Chromium executable',
    '  --artifacts=PATH  Evidence directory'
  ].join('\n');
}

function chromePath(explicit) {
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
    '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2'
  })[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function serve() {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const pathname = decodeURIComponent(parsed.pathname === '/' ? '/ScribeFlow.html' : parsed.pathname);
      const target = path.resolve(ROOT, `.${pathname}`);
      if (target !== ROOT && !target.startsWith(`${ROOT}${path.sep}`)) return res.writeHead(403).end('Forbidden');
      if (!fs.statSync(target).isFile()) throw new Error('not-file');
      res.writeHead(200, { 'Content-Type': mime(target), 'Cache-Control': 'no-store, max-age=0' });
      fs.createReadStream(target).pipe(res);
    } catch (_) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      server, sockets, origin: `http://127.0.0.1:${server.address().port}`
    }));
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
      for (const fn of this.listeners.get(msg.method) || []) fn(msg.params || {});
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
    '--disable-sync', '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain',
    '--disable-extensions', '--window-size=1440,1000',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
  ];
  if (!headed) flags.unshift('--headless=new');
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

async function focus(cdp, selector) {
  const result = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return false; el.scrollIntoView({block:'center'}); el.focus({preventScroll:true}); return document.activeElement===el; })()`);
  assert(result, `Could not focus ${selector}`);
}

async function key(cdp, value, shift = false) {
  const map = { Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Space: ['Space', 32], ArrowDown: ['ArrowDown', 40] };
  const [code, vk] = map[value] || [value, 0];
  const modifiers = shift ? 8 : 0;
  const text = value === 'Space' ? ' ' : (value === 'Enter' ? '\r' : '');
  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: value === 'Space' ? ' ' : value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, text, unmodifiedText: text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value === 'Space' ? ' ' : value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(80);
}

async function keyboardRoute(cdp, route) {
  let selector = VISIBLE_ROUTE[route] || '';
  if (route === 'history') {
    await keyboardRoute(cdp, 'patients');
    await wait(cdp, 'visible keyboard History segment', `(() => {
      const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const el=[...document.querySelectorAll('#mlsRightNow .segbtn')].find(x=>shown(x)&&/^history$/i.test(String(x.textContent||'').trim()));
      if(!el)return false;el.setAttribute('data-live-a11y-route','history');return true;
    })()`);
    selector = '#mlsRightNow [data-live-a11y-route="history"]';
  }
  assert(selector, `No visible keyboard route is declared for ${route}`);
  await focus(cdp, selector);
  await key(cdp, 'Enter');
  await wait(cdp, `${route} route`, `window.__mlsCurrentView===${JSON.stringify(route)}`);
  return selector;
}

async function click(cdp, selector) {
  const ok = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return false; el.focus(); el.click(); return true; })()`);
  assert(ok, `Could not click ${selector}`);
}

async function fill(cdp, selector, value) {
  const result = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return null; el.focus(); const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); el.dispatchEvent(new Event('change',{bubbles:true})); return el.value; })()`);
  assert.strictEqual(result, value, `Could not fill ${selector}`);
}

async function select(cdp, selector, value) {
  const result = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)return null; el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); return el.value; })()`);
  assert.strictEqual(result, value, `Could not select ${selector}`);
}

async function shot(cdp, file) {
  const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 30000);
  fs.writeFileSync(file, Buffer.from(image.data, 'base64'));
}

async function viewport(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await sleep(180);
}

async function settle(cdp) {
  await evalJs(cdp, `(async()=>{ if(window.__mlsSessionReady)await Promise.race([Promise.resolve(window.__mlsSessionReady),new Promise((_,r)=>setTimeout(()=>r(new Error('session timeout')),45000))]); if(document.fonts&&document.fonts.ready)await document.fonts.ready; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return true; })()`, true);
  await wait(cdp, 'redesigned clinician shell', `document.body.classList.contains('mls-redesign')&&!!document.getElementById('mlsRdNav')&&!!window.__mlsWriteFlow`, 50000);
  await sleep(400);
}

async function audit(cdp, label) {
  const result = await evalJs(cdp, `(() => {
    const shown=el=>{ if(!el||el.hidden||el.closest('[aria-hidden="true"],[inert]'))return false; const s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0; };
    const name=el=>{ const labelled=el.getAttribute('aria-labelledby'); return (el.getAttribute('aria-label')||(labelled&&labelled.split(/\\s+/).map(id=>(document.getElementById(id)||{}).textContent||'').join(' '))||[...(el.labels||[])].map(x=>x.textContent||'').join(' ')||el.getAttribute('title')||'').trim(); };
    const dup={}; document.querySelectorAll('[id]').forEach(el=>{const id=el.id;if(id)dup[id]=(dup[id]||0)+1}); Object.keys(dup).forEach(id=>{if(dup[id]<2)delete dup[id]});
    const unlabeled=[...document.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(shown).filter(el=>!name(el)).map(el=>({tag:el.tagName,id:el.id,type:el.type||''}));
    const primary=[...document.querySelectorAll('#mlsRdTop button,#mlsRdNav .navtab,#mlsRdNewMenu button,.hist-item,[role="dialog"] button')].filter(shown).map(el=>{const r=el.getBoundingClientRect();return{id:el.id||'',text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,45),w:+r.width.toFixed(1),h:+r.height.toFixed(1)}});
    const undersized=primary.filter(x=>x.w<24||x.h<24);
    const top=[...document.querySelectorAll('#mlsRdTop button')].filter(shown).map(el=>({el,r:el.getBoundingClientRect()})); const overlap=[];
    for(let i=0;i<top.length;i++)for(let j=i+1;j<top.length;j++){const a=top[i].r,b=top[j].r,w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>2&&h>2)overlap.push([top[i].el.id,top[j].el.id]);}
    const parse=c=>{const m=String(c).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(Number);return p.length>=3?{rgb:p.slice(0,3),a:Number.isFinite(p[3])?p[3]:1}:null};
    const blend=(top,bottom)=>top.rgb.map((v,i)=>v*top.a+bottom[i]*(1-top.a));
    const effectiveBg=el=>{const layers=[];for(let cur=el;cur&&cur.nodeType===1;cur=cur.parentElement){const s=getComputedStyle(cur);if(s.backgroundImage!=='none')return null;const layer=parse(s.backgroundColor);if(layer&&layer.a>0)layers.push(layer)}let out=[255,255,255];for(let i=layers.length-1;i>=0;i--)out=blend(layers[i],out);return out};
    const lum=rgb=>{const v=rgb.map(x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)});return .2126*v[0]+.7152*v[1]+.0722*v[2]};
    const contrast=[]; [...document.querySelectorAll('p,span,label,button,a,div')].filter(shown).slice(0,2500).forEach(el=>{const text=(el.childElementCount?([...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ')):el.textContent||'').trim();if(!text)return;const s=getComputedStyle(el),fgLayer=parse(s.color),bg=effectiveBg(el);if(!fgLayer||!bg)return;const fg=blend(fgLayer,bg);const ratio=(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05);const large=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700);if(ratio<(large?3:4.5))contrast.push({id:el.id||'',text:text.replace(/\\s+/g,' ').slice(0,55),fg:s.color,bg:s.backgroundColor,ratio:+ratio.toFixed(2)});});
    const account=document.getElementById('mlsAccountMenuBtn');
    const html=document.documentElement;
    return {label:${JSON.stringify(label)},viewport:{innerWidth,innerHeight},doc:{clientWidth:html.clientWidth,scrollWidth:html.scrollWidth,overflowX:html.scrollWidth>html.clientWidth+1},duplicates:dup,unlabeled,undersized,overlap,contrast:contrast.slice(0,80),accountName:account&&name(account),errors:(window.__a11yErrors||[]).slice()};
  })()`);
  assert.strictEqual(result.doc.overflowX, false, `${label}: document horizontally overflows: ${JSON.stringify(result.doc)}`);
  assert.deepStrictEqual(result.duplicates, {}, `${label}: duplicate IDs: ${JSON.stringify(result.duplicates)}`);
  assert.deepStrictEqual(result.unlabeled, [], `${label}: visible controls lack labels: ${JSON.stringify(result.unlabeled)}`);
  assert.deepStrictEqual(result.overlap, [], `${label}: top-bar controls overlap: ${JSON.stringify(result.overlap)}`);
  assert.deepStrictEqual(result.undersized, [], `${label}: primary target below 24px: ${JSON.stringify(result.undersized)}`);
  assert.strictEqual(result.accountName, 'Account', `${label}: mobile/desktop account control lost its accessible name`);
  return result;
}

async function mobileNoticeLayout(cdp) {
  return evalJs(cdp, `(() => {
    const shown=el=>{if(!el||el.hidden||el.closest('[aria-hidden="true"],[inert]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    const rect=el=>{const r=el.getBoundingClientRect();return{left:+r.left.toFixed(1),right:+r.right.toFixed(1),top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),width:+r.width.toFixed(1),height:+r.height.toFixed(1)}};
    const notices=[document.getElementById('toast'),...document.querySelectorAll('.mls-sv-card')].filter(shown);
    const controls=[...document.querySelectorAll('button,input,select,textarea,a[href],[role="button"]')].filter(shown).filter(el=>!notices.some(n=>n.contains(el)));
    const overlaps=[];
    notices.forEach(n=>{const a=n.getBoundingClientRect();controls.forEach(c=>{const b=c.getBoundingClientRect(),w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>1&&h>1)overlaps.push({notice:(n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,45),control:(c.getAttribute('aria-label')||c.textContent||c.id||c.tagName).replace(/\\s+/g,' ').trim().slice(0,45),w:+w.toFixed(1),h:+h.toFixed(1)});});});
    const top=document.getElementById('mlsRdTop'),title=document.getElementById('mlsRdTitle'),topRect=top&&top.getBoundingClientRect(),limit=Math.min(innerWidth,document.documentElement.clientWidth);
    const topControls=top?[...top.querySelectorAll('button')].filter(shown):[];
    const outside=topControls.map(el=>({id:el.id||'',name:(el.getAttribute('aria-label')||el.textContent||'').replace(/\\s+/g,' ').trim(),box:rect(el)})).filter(x=>x.box.left<(topRect.left-1)||x.box.right>Math.min(topRect.right,limit)+1||x.box.top<topRect.top-1||x.box.bottom>topRect.bottom+1);
    const menuLabel=document.querySelector('#mlsTbMenuBtn>span'),menuButton=document.getElementById('mlsTbMenuBtn');
    const header=document.getElementById('appHeader'),hs=header&&getComputedStyle(header),ts=top&&getComputedStyle(top);
    const app=document.getElementById('appScreen'),bs=getComputedStyle(document.body),as=app&&getComputedStyle(app);
    return {notices:notices.map(n=>({id:n.id||'',role:n.getAttribute('role'),live:n.getAttribute('aria-live'),position:getComputedStyle(n).position,box:rect(n),text:(n.textContent||'').replace(/\\s+/g,' ').trim().slice(0,90)})),overlaps,topbar:{rect:topRect&&rect(top),body:{box:rect(document.body),width:bs.width,padding:bs.padding,margin:bs.margin},app:app&&{box:rect(app),width:as.width,padding:as.padding,margin:as.margin},header:header&&{box:rect(header),padding:hs.padding,width:hs.width,display:hs.display,gap:hs.gap},topStyle:top&&{width:ts.width,flex:ts.flex,padding:ts.padding,margin:ts.margin},controls:topControls.map(el=>({id:el.id||'',name:(el.getAttribute('aria-label')||el.textContent||'').replace(/\\s+/g,' ').trim(),box:rect(el)})),outside,title:title&&{text:title.textContent,clientWidth:title.clientWidth,scrollWidth:title.scrollWidth,clipped:title.scrollWidth>title.clientWidth+1},menuTextHidden:!!menuButton&&((menuLabel&&getComputedStyle(menuLabel).display==='none')||parseFloat(getComputedStyle(menuButton).fontSize)===0),menuButton:menuButton&&{html:menuButton.innerHTML,fontSize:getComputedStyle(menuButton).fontSize,before:getComputedStyle(menuButton,'::before').content,box:rect(menuButton)},limit}};
  })()`);
}

async function mobileNoticeProof(cdp, artifactDir) {
  const setup = await evalJs(cdp, `(() => {
    if(!window.__mlsSaveVerify||typeof window.__mlsSaveVerify.banner!=='function'||typeof window.toast!=='function')return null;
    const one=window.__mlsSaveVerify.banner('ok','Saved & verified: Synthetic mobile fixture',['1 visit stored.'],{ttl:1100});
    const same=window.__mlsSaveVerify.banner('ok','Saved & verified: Synthetic mobile fixture',['1 visit stored.'],{ttl:1100});
    window.toast('Synthetic phone status is ready.','ok'); window.toast('Synthetic phone status is ready.','ok');
    const shelf=document.getElementById('mlsMobileNoticeShelf');if(shelf)shelf.scrollIntoView({block:'start'});
    const stack=document.getElementById('mls-save-verify-stack');
    return{deduped:one===same,saveCards:stack?stack.querySelectorAll('.mls-sv-card').length:0,shelfParent:stack&&stack.parentElement&&stack.parentElement.id};
  })()`);
  assert.deepStrictEqual(setup, { deduped:true, saveCards:1, shelfParent:'mlsMobileNoticeShelf' }, `phone notice owners did not dedupe/place into normal flow: ${JSON.stringify(setup)}`);
  await sleep(220);
  const active = await mobileNoticeLayout(cdp);
  assert.strictEqual(active.notices.length, 2, `phone proof expected one general + one save status: ${JSON.stringify(active.notices)}`);
  assert(active.notices.every(row=>row.position!=='fixed'&&row.position!=='absolute'), `phone notices still float over content: ${JSON.stringify(active.notices)}`);
  assert.deepStrictEqual(active.overlaps, [], `phone status visually covers primary controls: ${JSON.stringify(active.overlaps)}`);
  assert.deepStrictEqual(active.topbar.outside, [], `360px top-bar control is clipped outside its row: ${JSON.stringify(active.topbar)}`);
  assert(active.topbar.title&&!active.topbar.title.clipped, `360px top-bar title is clipped: ${JSON.stringify(active.topbar)}`);
  assert.strictEqual(active.topbar.menuTextHidden, true, `360px Menu label still crowds the primary header: ${JSON.stringify(active.topbar)}`);
  await shot(cdp, path.join(artifactDir, 'viewport-360x800-notices-inline.png'));

  await sleep(4100);
  const retired = await mobileNoticeLayout(cdp);
  assert.deepStrictEqual(retired.notices, [], `stale success notices did not self-retire: ${JSON.stringify(retired.notices)}`);
  const failureSetup = await evalJs(cdp, `(() => {const card=window.__mlsSaveVerify.banner('warn','Synthetic save verification failed',['Retry is required.'],{ttl:0});const shelf=document.getElementById('mlsMobileNoticeShelf');if(shelf)shelf.scrollIntoView({block:'start'});return card&&{role:card.getAttribute('role'),live:card.getAttribute('aria-live')};})()`);
  assert.deepStrictEqual(failureSetup, { role:'alert', live:'assertive' }, `important failure lost accessible alert semantics: ${JSON.stringify(failureSetup)}`);
  await sleep(220);
  const failure = await mobileNoticeLayout(cdp);
  assert.strictEqual(failure.notices.length, 1, `persistent failure is not visibly present: ${JSON.stringify(failure.notices)}`);
  assert.strictEqual(failure.notices[0].position, 'static', `phone failure reverted to an overlay: ${JSON.stringify(failure.notices[0])}`);
  assert.deepStrictEqual(failure.overlaps, [], `phone failure covers primary controls: ${JSON.stringify(failure.overlaps)}`);
  await evalJs(cdp, `(() => {const card=document.querySelector('.mls-sv-warn');const close=card&&card.querySelector('.mls-sv-x');if(close)close.click();return !document.querySelector('.mls-sv-card');})()`);
  await evalJs(cdp, `window.scrollTo(0,0);true`); await sleep(220);
  await shot(cdp, path.join(artifactDir, 'viewport-360x800-after-clean.png'));
  return { setup, active, retired, failureSetup, failure };
}

async function focusState(cdp, selector) {
  return evalJs(cdp, `(() => {const el=document.querySelector(${JSON.stringify(selector)}),a=document.activeElement;if(!el)return null;const s=getComputedStyle(el);return{active:a===el,focusVisible:el.matches(':focus-visible'),outline:s.outlineStyle,outlineWidth:s.outlineWidth,shadow:s.boxShadow,name:el.getAttribute('aria-label')||el.textContent.trim()}})()`);
}

async function keyboardPatient(cdp) {
  await keyboardRoute(cdp, 'patients');
  await focus(cdp, '#ptNewBtn');
  const triggerFocus = await focusState(cdp, '#ptNewBtn');
  assert(triggerFocus.active && triggerFocus.focusVisible, `Visible New patient control lacks keyboard focus: ${JSON.stringify(triggerFocus)}`);
  await key(cdp, 'Enter'); await wait(cdp, 'new-patient dialog', `document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptName')`);
  const semantics = await evalJs(cdp, `(() => {const m=document.getElementById('patientModal');return{role:m.getAttribute('role'),ariaModal:m.getAttribute('aria-modal'),label:m.getAttribute('aria-labelledby'),hidden:m.getAttribute('aria-hidden'),focus:document.activeElement.id,labels:['ptName','ptMrn','ptDob','ptSex'].map(id=>({id,count:(document.getElementById(id).labels||[]).length}))}})()`);
  assert.deepStrictEqual({ role: semantics.role, ariaModal: semantics.ariaModal, label: semantics.label, hidden: semantics.hidden, focus: semantics.focus }, { role: 'dialog', ariaModal: 'true', label: 'patientModalTitle', hidden: 'false', focus: 'ptName' });
  assert(semantics.labels.every((row) => row.count > 0), `New-patient fields lost labels: ${JSON.stringify(semantics.labels)}`);
  await focus(cdp, '#patientModal .btn-ghost'); await key(cdp, 'Tab');
  assert.strictEqual(await evalJs(cdp, `document.activeElement===document.querySelector('#patientModal .modal-x')`), true, 'New-patient dialog did not wrap Tab to its first control');
  await key(cdp, 'Escape'); await wait(cdp, 'Escape closes patient dialog', `!document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptNewBtn')`);
  await key(cdp, 'Enter');
  await wait(cdp, 'patient dialog reopens', `document.getElementById('patientModal').classList.contains('show')&&document.activeElement.id==='ptName'`);
  await fill(cdp, '#ptName', PATIENT.name); await fill(cdp, '#ptMrn', PATIENT.mrn); await fill(cdp, '#ptDob', PATIENT.dob); await select(cdp, '#ptSex', PATIENT.sex);
  await focus(cdp, '#patientModal button[onclick="savePatient()"]'); await key(cdp, 'Enter');
  const patient = await wait(cdp, 'saved synthetic patient and focus restore', `(() => {const p=window.activePatient&&window.activePatient();return p&&p.name===${JSON.stringify(PATIENT.name)}&&!document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptNewBtn')?p:false})()`, 10000);
  return { triggerFocus, semantics, patient: { id: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn } };
}

async function saveSyntheticNote(cdp) {
  await keyboardRoute(cdp, 'visit');
  await fill(cdp, '#transcript', TRANSCRIPT);
  const saved = await evalJs(cdp, `(() => {
    const note=${JSON.stringify(NOTE)}; currentSoap=note; currentInsurance=''; currentFormat='soap';
    currentCoding={em:'99213',em_just:'Synthetic fixture only',icd:['M54.50'],cpt:[]};
    lastEMR={cc:'Synthetic back follow-up',dx:'M54.50 - synthetic fixture',meds:'None',orders:'None',fu:'Reviewed',em:'99213',icd:'M54.50',cpt:'None'};
    const box=document.getElementById('noteBox');box.value=note;box.style.display='block';box.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
    const simple=document.getElementById('mls-note');if(simple){simple.value=note;simple.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));}
    const empty=document.getElementById('noteEmpty');if(empty)empty.style.display='none'; if(typeof populateEMR==='function')populateEMR(lastEMR,currentCoding);if(typeof renderCoding==='function')renderCoding(currentCoding);if(typeof enableOutputs==='function')enableOutputs(true);
    saveCurrentNote(false); const p=activePatient(),n=getNotes().find(row=>row.patientId===p.id&&row.soap===note);return n&&{id:n.id,patientId:n.patientId};
  })()`);
  assert(saved && saved.id, `Synthetic note did not save: ${JSON.stringify(saved)}`);
  return saved;
}

async function keyboardHistory(cdp) {
  await keyboardRoute(cdp, 'history');
  await wait(cdp, 'History row', `window.__mlsCurrentView==='history'&&[...document.querySelectorAll('#histList .hist-item')].some(el=>(el.textContent||'').includes(${JSON.stringify(PATIENT.name)}))`);
  const selector = '#histList .hist-item[data-live-a11y-history="1"]';
  const row = await evalJs(cdp, `(() => {const el=[...document.querySelectorAll('#histList .hist-item')].find(x=>(x.textContent||'').includes(${JSON.stringify(PATIENT.name)}));if(!el)return null;el.setAttribute('data-live-a11y-history','1');return{role:el.getAttribute('role'),tabindex:el.getAttribute('tabindex'),label:el.getAttribute('aria-label')}})()`);
  assert.strictEqual(row.role, 'button'); assert.strictEqual(row.tabindex, '0'); assert(row.label, 'Saved History row lacks accessible name');
  await focus(cdp, selector); await key(cdp, 'Enter'); await wait(cdp, 'saved-detail dialog focus', `document.querySelector('.mlsvnd-modal[role="dialog"][aria-modal="true"]')&&document.activeElement===document.querySelector('.mlsvnd-modal .mlsvnd-x')`);
  const semantics = await evalJs(cdp, `(() => {const m=document.querySelector('.mlsvnd-modal');return{labelledby:m.getAttribute('aria-labelledby'),title:(document.getElementById(m.getAttribute('aria-labelledby'))||{}).textContent||'',focus:document.activeElement.getAttribute('aria-label')}})()`);
  assert(semantics.labelledby && semantics.title, `Saved-detail dialog lacks a valid accessible title: ${JSON.stringify(semantics)}`);
  const last = await evalJs(cdp, `(() => {const m=document.querySelector('.mlsvnd-modal'),shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const rows=[...m.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')].filter(shown);rows[rows.length-1].setAttribute('data-live-a11y-last','1');return rows.length})()`);
  assert(last > 1, 'Saved-detail dialog had no complete focus order'); await focus(cdp, '.mlsvnd-modal [data-live-a11y-last="1"]'); await key(cdp, 'Tab');
  assert.strictEqual(await evalJs(cdp, `document.activeElement===document.querySelector('.mlsvnd-modal .mlsvnd-x')`), true, 'Saved-detail dialog did not trap Tab');
  await key(cdp, 'Escape'); await wait(cdp, 'saved-detail Escape/restore', `!document.querySelector('.mlsvnd-scrim')&&document.activeElement===document.querySelector(${JSON.stringify(selector)})`);
  return { row, semantics, focusCount: last };
}

async function keyboardAthenaReview(cdp, noteId) {
  await keyboardRoute(cdp, 'visit');
  await evalJs(cdp, `(() => {const n=getNotes().find(x=>x.id===${JSON.stringify(noteId)});if(n&&typeof loadRecordIntoEditor==='function')loadRecordIntoEditor(n);return !!n})()`);
  const markTrigger = `(() => {const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};let el=document.getElementById('pushAllEmrBtn');if(!shown(el))el=[...document.querySelectorAll('button')].find(x=>shown(x)&&/review athena actions/i.test(x.textContent||''));if(!shown(el))return null;el.setAttribute('data-live-a11y-athena','1');return{id:el.id||'',text:(el.textContent||'').trim()}})()`;
  let trigger = await evalJs(cdp, markTrigger);
  if (!trigger) {
    const reviewStep = await evalJs(cdp, `(() => {const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const el=document.getElementById('ez3flReview')||document.querySelector('#mlsEz3 .ez3fl-openws')||document.getElementById('ez3Adv');if(!shown(el))return null;el.setAttribute('data-live-a11y-review-step','1');return{id:el.id||'',text:(el.textContent||'').trim()}})()`);
    if (!reviewStep) {
      const diagnostics = await evalJs(cdp, `(() => ({body:document.body.className,buttons:[...document.querySelectorAll('button')].filter(x=>/athena|advanced|workspace|review/i.test(x.textContent||'')||x.id==='ez3Adv'||x.id==='pushAllEmrBtn').map(x=>{const s=getComputedStyle(x),r=x.getBoundingClientRect();return{id:x.id,cls:x.className,text:(x.textContent||'').replace(/\\s+/g,' ').trim(),display:s.display,visibility:s.visibility,hidden:x.hidden,disabled:x.disabled,w:r.width,h:r.height,top:r.top}})}))()`);
      assert(reviewStep, `Neither Athena review nor Review/Advanced workspace had a visible keyboard trigger: ${JSON.stringify(diagnostics)}`);
    }
    await focus(cdp, '[data-live-a11y-review-step="1"]'); await key(cdp, 'Enter');
    await wait(cdp, 'Review step keyboard focus transfer', `document.body.classList.contains('ez3adv')&&document.activeElement===document.getElementById('pushAllEmrBtn')`, 5000);
    trigger = await wait(cdp, 'visible Athena review trigger', markTrigger, 5000);
  }
  assert(trigger, 'No visible keyboard-operable Athena review trigger was available');
  await focus(cdp, '[data-live-a11y-athena="1"]'); await key(cdp, 'Enter');
  await wait(cdp, 'unified Athena dialog focus', `document.getElementById('mlsAthenaUnifiedConfirm')&&document.activeElement===document.getElementById('mlsAthenaUnifiedClose')`, 10000);
  const semantics = await evalJs(cdp, `(() => {const m=document.getElementById('mlsAthenaUnifiedConfirm'),id=m.getAttribute('aria-labelledby'),radios=[...m.querySelectorAll('input[type="radio"]')];return{role:m.getAttribute('role'),ariaModal:m.getAttribute('aria-modal'),labelledby:id,title:(document.getElementById(id)||{}).textContent||'',radioLabels:radios.map(x=>x.getAttribute('aria-label')),confirmDisabled:document.getElementById('mlsAthenaUnifiedGo').disabled}})()`);
  assert.deepStrictEqual({ role: semantics.role, ariaModal: semantics.ariaModal, labelledby: semantics.labelledby }, { role: 'dialog', ariaModal: 'true', labelledby: 'mlsAthenaUnifiedTitle' });
  assert(semantics.title && semantics.radioLabels.every(Boolean), `Athena dialog controls lack names: ${JSON.stringify(semantics)}`);
  assert.strictEqual(semantics.confirmDisabled, true, 'Athena write unexpectedly enabled without extension verification');
  await focus(cdp, '#mlsAthenaUnifiedCancel'); await key(cdp, 'Tab');
  assert.strictEqual(await evalJs(cdp, `document.activeElement===document.getElementById('mlsAthenaUnifiedClose')`), true, 'Athena dialog did not trap Tab');
  await key(cdp, 'Escape'); await wait(cdp, 'Athena Escape/restore', `!document.getElementById('mlsAthenaUnifiedConfirm')&&document.activeElement===document.querySelector('[data-live-a11y-athena="1"]')`);
  return { trigger, semantics };
}

/* What a phone user actually needs at this width is PRIMARY NAVIGATION that is
   present, visible and keyboard-operable. Which control provides it is a shell
   decision, and it changed under this assertion:
   feat_mls_calm_shell.js:206 ships `html body.mls-calm #mlsRdRailBtn{display:none
   !important}` and hides #mlsRdNav with it — recorded at b730 (phone audit B4)
   as "the mobile burger opened a grey scrim over NOTHING - a dead control
   dressed as navigation. If the calm shell hides the rail, it hides the button
   that opens it."
   Measured 2026-07-29 at 360x800 in real Chrome on UNMODIFIED b799: #mlsRdRailBtn
   is display:none, 0x0, and cannot take focus. So the drawer branch below can
   never pass while the calm shell owns navigation, and it was only ever reached
   after an earlier assertion in this file started failing.
   Both branches assert real behaviour, so nothing is waved through:
     - burger visible  -> the drawer must still open, trap focus, close on
       Escape and restore focus. Unchanged from the original assertion, so a
       shell that brings the drawer back is held to exactly the old contract,
       and a burger that is visible but dead FAILS here.
     - burger retired  -> the retirement must be deliberate (calm shell active
       AND the rail it opens actually hidden), and the dock that replaced it
       must be visible and keyboard-operable at this width with visible focus.
   A burger that is missing for any OTHER reason satisfies neither branch. */
async function drawerProof(cdp, width) {
  const shell = await evalJs(cdp, `(() => {
    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const b=document.getElementById('mlsRdRailBtn'),nav=document.getElementById('mlsRdNav');
    return{burger:!!b,burgerVisible:shown(b),railVisible:shown(nav),calm:!!(window.__mlsCalmShell&&window.__mlsCalmShell.active)&&document.body.classList.contains('mls-calm')};
  })()`);
  if (!shell.burgerVisible) {
    assert(shell.calm, `${width}px: the primary-navigation burger is not visible and the calm shell is not the reason: ${JSON.stringify(shell)}`);
    assert.strictEqual(shell.railVisible, false, `${width}px: the burger is hidden while the rail it opens is still on screen — navigation is unreachable: ${JSON.stringify(shell)}`);
    const dock = await evalJs(cdp, `(() => {
      const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const rows=[...document.querySelectorAll('#mlsDock button[data-dest]')].filter(shown);
      return{count:rows.length,dests:rows.map(x=>x.getAttribute('data-dest')),named:rows.every(x=>String(x.getAttribute('aria-label')||x.textContent||'').trim().length>0)};
    })()`);
    assert(dock.count >= 2, `${width}px: the calm dock replaced the drawer but offers fewer than two visible destinations: ${JSON.stringify(dock)}`);
    assert(dock.named, `${width}px: a visible dock destination has no accessible name: ${JSON.stringify(dock)}`);
    const target = `#mlsDock button[data-dest="${dock.dests.includes('patient') ? 'patient' : dock.dests[0]}"]`;
    await focus(cdp, target);
    const state = await focusState(cdp, target);
    assert(state && state.active && state.focusVisible && (state.outline !== 'none' || state.shadow !== 'none'),
      `${width}px: replacement primary navigation lacks visible keyboard focus: ${JSON.stringify(state)}`);
    await key(cdp, 'Enter');
    await wait(cdp, `${width}px dock navigation responds to Enter`, `!!window.__mlsCurrentView`);
    return { mode: 'calm-dock-replaces-rail-drawer', width, shell, dock, focus: state };
  }
  const initial = await evalJs(cdp, `(() => {const nav=document.getElementById('mlsRdNav'),b=document.getElementById('mlsRdRailBtn');return{hidden:nav.getAttribute('aria-hidden'),inert:nav.inert,expanded:b.getAttribute('aria-expanded'),label:b.getAttribute('aria-label')}})()`);
  assert.deepStrictEqual(initial, { hidden: 'true', inert: true, expanded: 'false', label: 'Open primary navigation' }, `${width}px drawer starts exposed to keyboard/accessibility tree`);
  await focus(cdp, '#mlsRdRailBtn'); await key(cdp, 'Enter');
  await wait(cdp, `${width}px drawer opens and moves focus`, `document.getElementById('mlsRdRailBtn').getAttribute('aria-expanded')==='true'&&document.activeElement&&document.activeElement.closest('#mlsRdNav')`);
  await key(cdp, 'Escape'); await wait(cdp, `${width}px drawer Escape close`, `document.getElementById('mlsRdRailBtn').getAttribute('aria-expanded')==='false'&&!document.documentElement.classList.contains('mls-rail-open')`); await sleep(250);
  const closed = await evalJs(cdp, `(() => {const nav=document.getElementById('mlsRdNav'),b=document.getElementById('mlsRdRailBtn'),a=document.activeElement;return{inert:nav.inert,hidden:nav.getAttribute('aria-hidden'),activeId:a&&a.id,activeTag:a&&a.tagName,burgerVisible:(()=>{const s=getComputedStyle(b),r=b.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()}})()`);
  assert.deepStrictEqual(closed, { inert:true, hidden:'true', activeId:'mlsRdRailBtn', activeTag:'BUTTON', burgerVisible:true }, `${width}px drawer did not restore focus/accessibility state: ${JSON.stringify(closed)}`);
  return initial;
}

async function reducedMotionProof(cdp) {
  await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const result = await evalJs(cdp, `(() => {const shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const seconds=v=>Math.max(...String(v).split(',').map(x=>parseFloat(x)||0));const offenders=[...document.querySelectorAll('*')].filter(shown).map(el=>{const s=getComputedStyle(el);return{id:el.id||'',tag:el.tagName,animation:seconds(s.animationDuration),transition:seconds(s.transitionDuration)}}).filter(x=>x.animation>.02||x.transition>.02).slice(0,50);return{matches:matchMedia('(prefers-reduced-motion: reduce)').matches,offenders}})()`);
  assert.strictEqual(result.matches, true, 'Reduced-motion emulation did not apply');
  assert.deepStrictEqual(result.offenders, [], `Visible animations/transitions ignored reduced motion: ${JSON.stringify(result.offenders)}`);
  await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });
  return result;
}

async function main() {
  const opts = args(process.argv.slice(2)); if (opts.help) return process.stdout.write(`${usage()}\n`);
  const executable = chromePath(opts.chrome);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const artifactDir = path.resolve(opts.artifacts || path.join(__dirname, 'live-a11y-artifacts', stamp));
  fs.mkdirSync(artifactDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-a11y-chrome-'));
  const hosted = await serve(); let chrome = null, cdp = null, report = null;
  const external = [], exceptions = [];
  try {
    chrome = await launch(executable, profile, opts.headed); cdp = await page(chrome.port, 'about:blank');
    cdp.on('Network.requestWillBeSent', (event) => { try { const u=new URL(event.request.url);if(/^https?:$/.test(u.protocol)&&u.hostname!=='127.0.0.1')external.push({url:u.href,method:event.request.method}); } catch (_) {} });
    cdp.on('Runtime.exceptionThrown', (event) => exceptions.push(event.exceptionDetails && (event.exceptionDetails.text || event.exceptionDetails.exception && event.exceptionDetails.exception.description) || 'unknown'));
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__a11yErrors=[];addEventListener('error',e=>window.__a11yErrors.push(String(e.message||'error')));addEventListener('unhandledrejection',e=>window.__a11yErrors.push(String(e.reason&&e.reason.stack||e.reason||'rejection')));` });
    const appUrl = `${hosted.origin}/ScribeFlow.html?demo=1&a11yAudit=20260718`;
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

    await viewport(cdp, 1440, 1000); const baseline = await audit(cdp, '1440x1000 baseline'); await shot(cdp, path.join(artifactDir, '01-1440-baseline.png'));
    const navSelector = await keyboardRoute(cdp, 'visit'); const navFocus = await focusState(cdp, navSelector);
    assert(navFocus.active && navFocus.focusVisible && (navFocus.outline !== 'none' || navFocus.shadow !== 'none'), `Primary navigation lacks visible keyboard focus: ${JSON.stringify(navFocus)}`);
    const patient = await keyboardPatient(cdp); await shot(cdp, path.join(artifactDir, '02-patient-created.png'));
    const note = await saveSyntheticNote(cdp); const history = await keyboardHistory(cdp);
    const athena = await keyboardAthenaReview(cdp, note.id);

    const responsive = []; let mobileNotices = null;
    for (const [width, height] of [[360,800],[768,1024],[1440,1000]]) {
      await viewport(cdp, width, height); if (width <= 768) await drawerProof(cdp, width);
      if (width === 360) mobileNotices = await mobileNoticeProof(cdp, artifactDir);
      const row = await audit(cdp, `${width}x${height}`); responsive.push(row); await shot(cdp, path.join(artifactDir, `viewport-${width}x${height}.png`));
    }
    await viewport(cdp, 768, 1024); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 }); await sleep(150);
    const zoom = await evalJs(cdp, `({scale:visualViewport.scale,width:visualViewport.width,height:visualViewport.height,docOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1})`);
    assert(zoom.scale >= 1.99, `200% zoom did not apply: ${JSON.stringify(zoom)}`); assert.strictEqual(zoom.docOverflow, false, `200% zoom caused document overflow: ${JSON.stringify(zoom)}`);
    await shot(cdp, path.join(artifactDir, 'zoom-200-percent.png')); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    const reducedMotion = await reducedMotionProof(cdp);
    const unsafeExternal = external.filter((request) => { try { const host=new URL(request.url).hostname;return host!=='fonts.googleapis.com'&&host!=='fonts.gstatic.com'; } catch (_) { return true; } });
    assert.deepStrictEqual(unsafeExternal, [], `Synthetic proof attempted an unsafe external request: ${JSON.stringify(unsafeExternal)}`);
    assert.deepStrictEqual(exceptions, [], `Browser exceptions occurred: ${JSON.stringify(exceptions)}`);

    report = { status:'PASS', generatedAt:new Date().toISOString(), syntheticOnly:true, chrome:await evalJs(cdp,'navigator.userAgent'), appUrl, patient, note, history, athena, navFocus, baseline, responsive, mobileNotices, zoom, reducedMotion, externalRequests:external, unsafeExternalRequests:unsafeExternal, exceptions, coverageBoundary:{liveAutomated:['real isolated Chrome','keyboard-only primary navigation','visible New patient control and patient dialog','saved History row and detail dialog','Athena review dialog without write','normal-flow/deduped mobile status and persistent failure alert','360px unclipped top-bar controls/title','360x800','768x1024','1440x1000','200% zoom','prefers-reduced-motion','unique IDs','visible labels','primary 24px targets','horizontal overflow','top-bar overlap','contrast scan'],notClaimed:['real Athena data or write','extension lifecycle','production backend','PHI','microphone transcription']}};
    fs.writeFileSync(path.join(artifactDir,'report.json'),`${JSON.stringify(report,null,2)}\n`);
    const contrastCount=[baseline,...responsive].reduce((n,row)=>n+row.contrast.length,0);
    const md=[`# Live synthetic accessibility and responsive audit`,``,`Status: **PASS**`,``,`Generated: ${report.generatedAt}`,``,`Chrome: ${report.chrome}`,``,`All hard checks passed in isolated real Chrome. The audit was local-demo and synthetic-only; it did not load MLS Assist or Athena.`,``,`## Covered`,``,`- Keyboard-only primary navigation, New patient, saved History detail, and Athena review`,`- Focus entry, trapping, Escape, restoration, accessible dialog names, input labels, and unique IDs`,`- Phone statuses render in normal flow, duplicate success collapses, stale success retires, and persistent failures stay announced`,`- 360px top-bar controls and full title remain inside the header row`,`- 360x800, 768x1024, 1440x1000, 200% page zoom, reduced motion`,`- Horizontal overflow, top-bar overlap, and 24px primary target checks`,``,`## Advisory contrast samples`,``,`The heuristic recorded ${contrastCount} low-contrast samples for human review. Gradient/translucent backgrounds can produce false positives; exact samples are in report.json.`,``,`## Safety boundary`,``,`No extension, Athena page, backend, real account, or PHI was used.`].join('\n');
    fs.writeFileSync(path.join(artifactDir,'report.md'),`${md}\n`);
    process.stdout.write(`PASS live synthetic accessibility/responsive audit\nArtifacts: ${artifactDir}\n`);
  } catch (error) {
    if (cdp) try { await shot(cdp,path.join(artifactDir,'FAIL.png')); } catch (_) {}
    report={status:'FAIL',generatedAt:new Date().toISOString(),syntheticOnly:true,error:error.stack||String(error),externalRequests:external,exceptions};
    try{fs.writeFileSync(path.join(artifactDir,'report.json'),`${JSON.stringify(report,null,2)}\n`);}catch(_){}
    error.message += `\nArtifacts: ${artifactDir}`; throw error;
  } finally {
    if (cdp) { try{await cdp.send('Emulation.setEmulatedMedia',{media:'',features:[]},3000);}catch(_){} try{await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1},3000);}catch(_){} cdp.close(); }
    if(chrome&&chrome.child)try{chrome.child.kill();}catch(_){}
    try{hosted.server.closeAllConnections();}catch(_){} for(const socket of hosted.sockets)try{socket.destroy();}catch(_){}
    await new Promise(resolve=>hosted.server.close(resolve));
    if(path.basename(profile).startsWith('mls-a11y-chrome-'))try{fs.rmSync(profile,{recursive:true,force:true});}catch(_){}
  }
}

main().catch((error)=>{process.stderr.write(`${error.stack||error}\n`);process.exitCode=1;});
