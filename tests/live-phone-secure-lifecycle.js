'use strict';

/*
 * Real-Chrome proof for the published phone recorder. Uses an isolated profile,
 * a synthetic pairing code, Chrome's fake microphone, and intercepted backend
 * responses. It never opens the user's Chrome profile or contacts production.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CHROME = 'C:\\Users\\Micha\\Desktop\\MLS_EVERYTHING\\.codex-tools\\chrome-for-testing\\150.0.7871.124\\win64\\chrome-win64\\chrome.exe';

function configLists() {
  const lists = Object.create(null);
  let section = '';
  for (const line of fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8').split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z][\w-]*):\s*$/);
    if (key) { section = key[1]; lists[section] ||= []; continue; }
    const item = line.match(/^\s{2}-\s+"([^"]+)"\s*$/);
    if (item && section) lists[section].push(item[1]);
  }
  return lists;
}

const PUBLICATION = configLists();
const PUBLIC_INCLUDES = new Set(PUBLICATION.include || []);
const EXPLICIT_EXCLUDES = new Set(PUBLICATION.exclude || []);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
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
  }
  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => resolve(new CdpClient(socket)), { once: true });
      socket.addEventListener('error', () => reject(new Error(`Could not connect to ${url}`)), { once: true });
    });
  }
  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }
  send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.socket.close(); } catch (_) {} }
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
    throw new Error(detail || result.exceptionDetails.text || 'Chrome evaluation failed');
  }
  return result.result && result.result.value;
}

async function waitFor(cdp, description, expression, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, expression, true);
      if (last) return last;
    } catch (error) { last = error.message; }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
}

async function trustedClick(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const el=document.querySelector(${JSON.stringify(selector)});
    if(!el) return null;
    el.scrollIntoView({block:'center',inline:'center'});
    const r=el.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};
  })()`);
  assert(point && point.width > 0 && point.height > 0, `trusted click target is not visible: ${selector}`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

function serve() {
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  const requests = [];
  const server = http.createServer((request, response) => {
    const parsedRequest = new URL(request.url, 'http://127.0.0.1');
    const pathname = parsedRequest.pathname;
    requests.push({ pathname, search: parsedRequest.search });
    if (pathname === '/__seed_phone_audio.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`<!doctype html><meta charset="utf-8"><body data-seed="pending"><script>
        const request=indexedDB.open('mlsPhoneRec',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('clips',{keyPath:'id',autoIncrement:true});
        request.onsuccess=()=>{const db=request.result;const tx=db.transaction('clips','readwrite');tx.objectStore('clips').add({t:Date.now(),mt:'audio/webm',blob:new Blob(['synthetic legacy audio'],{type:'audio/webm'})});tx.oncomplete=()=>{db.close();document.body.dataset.seed='done';};};
      <\/script>`);
      return;
    }
    const relative = decodeURIComponent(pathname.replace(/^\/+/, '')) || 'phone.html';
    const target = path.resolve(ROOT, relative);
    const name = path.basename(relative);
    const blockedByPublication =
      (/\.html$/i.test(name) && !PUBLIC_INCLUDES.has(name)) ||
      (EXPLICIT_EXCLUDES.has(name) && !PUBLIC_INCLUDES.has(name)) ||
      /\.zip$/i.test(name) || /\.staging\.js$/i.test(name) || /_append_[^/]*\.js$/i.test(name);
    if (blockedByPublication || !target.startsWith(ROOT + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('not found'); return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(target).pipe(response);
  });
  server.__phoneTestRequests = requests;
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${file}`);
}

(async () => {
  const chromePath = process.env.CHROME_PATH || DEFAULT_CHROME;
  assert(fs.existsSync(chromePath), `Chrome for Testing missing: ${chromePath}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-phone-live-'));
  const artifacts = path.join(ROOT, 'tests', 'live-phone-artifacts', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(artifacts, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const chrome = spawn(chromePath, [
    '--headless=new', '--hide-scrollbars', '--remote-debugging-port=0', '--remote-allow-origins=*',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--disable-domain-reliability', '--disable-sync',
    '--metrics-recording-only', '--password-store=basic', '--use-mock-keychain', '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream', '--window-size=430,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  chrome.stderr.on('data', chunk => { stderr += chunk.toString(); });
  let cdp;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await waitForFile(portFile, 15000);
    const port = Number(fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)[0]);
    const targetResponse = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
    const target = await targetResponse.json();
    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Network.enable'), cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://scrivara-backend.onrender.com/*', requestStage: 'Request' }] })]);

    let backendMode = 'ok';
    const backendRequests = [];
    cdp.on('Fetch.requestPaused', event => {
      const url = event.request.url;
      backendRequests.push({ url, method: event.request.method, cacheControl: event.request.headers['Cache-Control'] || event.request.headers['cache-control'] || '' });
      if (backendMode === 'fail') {
        cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'InternetDisconnected' }).catch(() => {});
        return;
      }
      const headers = [
        { name: 'Access-Control-Allow-Origin', value: origin },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
        { name: 'Access-Control-Allow-Headers', value: 'authorization, content-type' },
        { name: 'Cache-Control', value: 'no-store' },
        { name: 'Content-Type', value: 'application/json' }
      ];
      const route = new URL(url).pathname;
      const responseBody = route.endsWith('/api/mic/start') ? '{"ok":true,"code":"SYN123"}' : '{"ok":true}';
      cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: event.request.method === 'OPTIONS' ? 204 : 200, responseHeaders: headers, body: event.request.method === 'OPTIONS' ? '' : Buffer.from(responseBody).toString('base64') }).catch(() => {});
    });

    await cdp.send('Page.navigate', { url: `${origin}/ScribeFlow.html?demo=1&livePhoneOwner=1` });
    await waitFor(cdp, 'production auth-first UI loader', "document.readyState==='complete'&&typeof startPhoneMic==='function'&&typeof window.__mlsEnsureUiBundle==='function'", 30000);
    await evaluate(cdp, 'window.__mlsEnsureUiBundle();true');
    await waitFor(cdp, 'published production phone UI module', "document.readyState==='complete'&&typeof startPhoneMic==='function'&&window.__mlsFFP&&document.getElementById('mlsGpQrBox')&&document.getElementById('phoneMicLink')&&document.getElementById('phoneMicQR')", 30000);
    const enhancerRequests = server.__phoneTestRequests.filter(request => request.pathname === '/feat_mls_force_full_phone.js');
    assert(enhancerRequests.length >= 1, 'production ScribeFlow did not request its phone UI module');
    await evaluate(cdp, `(()=>{
      backendMode=function(){return true;};
      bkBase=function(){return 'https://scrivara-backend.onrender.com';};
      bkToken=function(){return 'synthetic-live-phone-token';};
      /* 2026-07-29: this lifecycle test owns a deterministic synthetic
         patient and appointment. The separate clinical-action suite proves
         the production appointment resolver; this test uses the real public
         patient and consent contracts before crossing the phone gates. */
      var syntheticPhonePatient={id:'synthetic-live-phone-patient',name:'Synthetic Phone Patient',dob:'2000-01-01',mrn:'SYNTH-PHONE-001',problems:'',meds:'',summary:'',docs:[]};
      var syntheticPhonePatients=getPatients();
      if(!syntheticPhonePatients.some(function(patient){return patient&&patient.id===syntheticPhonePatient.id;})){
        syntheticPhonePatients.push(syntheticPhonePatient);
        savePatients(syntheticPhonePatients);
      }
      setActivePtId(syntheticPhonePatient.id);
      window.__mlsPhoneExactGateAllowed=true;
      window.__mlsPhoneExactGateCalls=[];
      _mlsExactScheduledClinicalAction=function(actionLabel){
        window.__mlsPhoneExactGateCalls.push(String(actionLabel||''));
        return window.__mlsPhoneExactGateAllowed===true && actionLabel==='phone recording';
      };
      _athenaPrepareRecording=function(){return true;};
      _athenaAsyncBindingStillSafe=function(){return true;};
      currentVisitAthenaBinding={id:'synthetic-live-phone-visit',patientId:syntheticPhonePatient.id,visitContext:{appointmentId:'synthetic-live-phone-appointment'}};
      currentVisitAthenaEpoch=17;
      if(window.__mlsFFP&&window.__mlsFFP.observer) window.__mlsFFP.observer.disconnect();
      var box=document.getElementById('mlsGpQrBox');
      document.body.appendChild(box);
      box.style.cssText+=';position:fixed!important;left:24px!important;top:24px!important;right:auto!important;display:block!important;visibility:visible!important;z-index:2147483647!important';
      return true;
    })()`);
    const startsBeforeProgrammaticProbe = backendRequests.filter(request => new URL(request.url).pathname.endsWith('/api/mic/start') && request.method === 'POST').length;
    await evaluate(cdp, 'startPhoneMic()', true);
    await sleep(150);
    const startsAfterProgrammaticProbe = backendRequests.filter(request => new URL(request.url).pathname.endsWith('/api/mic/start') && request.method === 'POST').length;
    assert.strictEqual(startsAfterProgrammaticProbe, startsBeforeProgrammaticProbe, 'programmatic phone pairing crossed the trusted-click boundary');
    const exactCallsAfterProgrammaticProbe = await evaluate(cdp, 'window.__mlsPhoneExactGateCalls.slice()');
    assert.deepStrictEqual(exactCallsAfterProgrammaticProbe, [], 'programmatic pairing reached the exact-appointment gate before the trusted-click gate');

    await evaluate(cdp, 'window.__mlsPhoneExactGateAllowed=false;true');
    const startsBeforeExactGateProbe = backendRequests.filter(request => new URL(request.url).pathname.endsWith('/api/mic/start') && request.method === 'POST').length;
    await trustedClick(cdp, '#mlsGpQrBox');
    await sleep(150);
    const startsAfterExactGateProbe = backendRequests.filter(request => new URL(request.url).pathname.endsWith('/api/mic/start') && request.method === 'POST').length;
    assert.strictEqual(startsAfterExactGateProbe, startsBeforeExactGateProbe, 'trusted phone pairing without an exact scheduled appointment contacted the backend');
    const exactCallsAfterDeniedProbe = await evaluate(cdp, 'window.__mlsPhoneExactGateCalls.slice()');
    assert.deepStrictEqual(exactCallsAfterDeniedProbe, ['phone recording'], 'trusted phone pairing did not request the exact phone-recording appointment gate once');

    const phoneConsent = await evaluate(cdp, `(async()=>{
      if(typeof window._mlsRequestEncounterConsent!=='function'||typeof window._mlsHasEncounterConsent!=='function')return{ready:false,reason:'public consent hooks missing'};
      var active=typeof activePatient==='function'?activePatient():null;
      if(!active||active.id!=='synthetic-live-phone-patient')return{ready:false,reason:'synthetic active patient missing',activeId:active&&active.id||''};
      var before=window._mlsHasEncounterConsent();
      var pending=window._mlsRequestEncounterConsent('phone recording');
      var deadline=Date.now()+5000,dialog=null;
      while(Date.now()<deadline&&!(dialog=document.getElementById('_mlsAskDialog')))await new Promise(function(resolve){setTimeout(resolve,25);});
      if(!dialog)return{ready:false,reason:'consent dialog missing',before:before};
      var verbal=dialog.querySelector('input[value="patient-verbal"]');
      var confirm=dialog.querySelector('#_mlsAskYes');
      if(!verbal||!confirm)return{ready:false,reason:'consent controls missing',before:before};
      verbal.click();
      confirm.click();
      var confirmed=await pending;
      var after=window._mlsHasEncounterConsent();
      var log=[];try{log=JSON.parse(localStorage.getItem(uns('consentLog'))||'[]')||[];}catch(_){}
      var last=log[log.length-1]||null;
      return{ready:confirmed===true&&after===true,before:before===true,confirmed:confirmed===true,after:after===true,activeId:active.id,logCount:log.length,consentType:last&&last.consentType||'',patientId:last&&last.patientId||'',encounterId:last&&last.encounterId||''};
    })()`, true);
    assert(phoneConsent&&phoneConsent.ready===true, 'real synthetic encounter consent did not complete: '+JSON.stringify(phoneConsent));
    assert.strictEqual(phoneConsent.before, false, 'synthetic phone fixture began with pre-existing consent');
    assert.strictEqual(phoneConsent.activeId, 'synthetic-live-phone-patient', 'consent was not bound to the synthetic active patient');
    assert(phoneConsent.logCount>=1, 'consent confirmation did not write its audit record');
    assert.strictEqual(phoneConsent.consentType, 'patient-verbal', 'synthetic consent used the wrong real consent option');
    assert.strictEqual(phoneConsent.patientId, 'synthetic-live-phone-patient', 'consent audit record used the wrong patient');
    assert.strictEqual(phoneConsent.encounterId, 'appt:synthetic-live-phone-appointment', 'consent audit record used the wrong encounter');
    const startsAfterConsent = backendRequests.filter(request => new URL(request.url).pathname.endsWith('/api/mic/start') && request.method === 'POST').length;
    assert.strictEqual(startsAfterConsent, startsAfterExactGateProbe, 'consent confirmation itself contacted the phone backend');

    await evaluate(cdp, 'window.__mlsPhoneExactGateAllowed=true;true');
    await trustedClick(cdp, '#mlsGpQrBox');
    await waitFor(cdp, 'trusted production phone handoff', "document.getElementById('phoneMicLink').href.includes('/phone.html#code=SYN123')");
    const ownerHandoff = await evaluate(cdp, `(()=>{
      var link=document.getElementById('phoneMicLink');
      var qr=document.getElementById('phoneMicQR');
      return {href:link&&link.href||'',text:link&&link.textContent||'',qrIsLocal:!!(qr&&(qr.src||'').indexOf('data:image/png')===0)};
    })()`);
    assert.strictEqual(ownerHandoff.href, `${origin}/phone.html#code=SYN123`, 'production phone owner did not generate the fragment handoff');
    assert.strictEqual(ownerHandoff.text, ownerHandoff.href, 'visible phone handoff text drifted from its canonical fragment URL');
    assert.strictEqual(ownerHandoff.qrIsLocal, true, 'production phone owner did not render the fragment QR locally');

    await cdp.send('Page.navigate', { url: `${origin}/phone.html?code=LEGACY-MUST-FAIL` });
    await waitFor(cdp, 'legacy phone query refusal', "document.readyState==='complete'&&window.__mlsPhoneGuard&&location.search===''&&location.hash===''&&!document.getElementById('connectScreen').classList.contains('hidden')&&document.getElementById('connectErr').textContent.includes('old pairing link is no longer accepted')");
    const legacyEntry = await evaluate(cdp, `({
      search:location.search,
      hash:location.hash,
      recorderHidden:document.getElementById('recScreen').classList.contains('hidden'),
      shown:document.getElementById('codeShown').textContent,
      codeValue:typeof code==='string'?code:null
    })`);
    assert.strictEqual(legacyEntry.recorderHidden, true, 'legacy query entered recorder state');
    assert.strictEqual(legacyEntry.shown, '----', 'legacy query populated the visible pairing code');
    assert.strictEqual(legacyEntry.codeValue, '', 'legacy query populated the recorder upload code');

    await cdp.send('Page.navigate', { url: `${origin}/__seed_phone_audio.html` });
    await waitFor(cdp, 'synthetic legacy IndexedDB seed', "document.body&&document.body.dataset.seed==='done'");
    const seeded = await evaluate(cdp, "indexedDB.databases().then(rows=>rows.some(row=>row.name==='mlsPhoneRec'))", true);
    assert.strictEqual(seeded, true, 'synthetic legacy database was not seeded');

    await cdp.send('Page.navigate', { url: `${ownerHandoff.href}&token=ALSO-MUST-DISAPPEAR` });
    await waitFor(cdp, 'secure phone guard', "document.readyState==='complete'&&window.__mlsPhoneGuard&&document.getElementById('recScreen')&&!document.getElementById('recScreen').classList.contains('hidden')");
    await waitFor(cdp, 'legacy database deletion', "indexedDB.databases().then(rows=>!rows.some(row=>row.name==='mlsPhoneRec'))");
    const manifestRequests = server.__phoneTestRequests.filter(request => request.pathname === '/phone-manifest.json');
    assert(manifestRequests.length >= 1, 'published phone page did not load its public install manifest');

    const entry = await evaluate(cdp, `(() => ({
      search:location.search,
      hash:location.hash,
      shown:document.getElementById('codeShown').textContent,
      input:document.getElementById('codeInput').value,
      viewport:document.querySelector('meta[name="viewport"]').content,
      robots:document.querySelector('meta[name="robots"]').content,
      referrer:document.querySelector('meta[name="referrer"]').content,
      pending:window.__mlsPhoneGuard.pending()
    }))()`);
    assert.strictEqual(entry.search, '', 'pairing code/token remained in the live address bar');
    assert.strictEqual(entry.hash, '', 'pairing fragment remained in the live address bar');
    const phoneDocumentRequests = server.__phoneTestRequests.filter(request => request.pathname === '/phone.html');
    const fragmentPhoneRequests = phoneDocumentRequests.filter(request => request.search === '');
    const legacyPhoneRequests = phoneDocumentRequests.filter(request => request.search !== '');
    assert(fragmentPhoneRequests.length >= 1, 'fragment phone document was not requested from the deployed-like host');
    assert(legacyPhoneRequests.some(request => request.search.includes('code=LEGACY-MUST-FAIL')), 'legacy refusal probe did not reach the deployed-like route');
    assert.strictEqual(entry.shown, 'SYN123', 'synthetic pairing code was not captured before URL scrubbing');
    assert.strictEqual(entry.input, '', 'pairing input retained the captured code');
    assert(!/maximum-scale|user-scalable/i.test(entry.viewport), 'live viewport still disabled zoom');
    assert.strictEqual(entry.robots, 'noindex,nofollow,noarchive,nosnippet');
    assert.strictEqual(entry.referrer, 'no-referrer');
    assert.strictEqual(entry.pending, 0);

    await evaluate(cdp, "document.getElementById('recBtn').click();true");
    await waitFor(cdp, 'fake microphone recording', "typeof active!=='undefined'&&active===true&&document.getElementById('recLabel').textContent==='Stop'");
    await sleep(900);
    await evaluate(cdp, "document.getElementById('recBtn').click();true");
    await waitFor(cdp, 'successful synthetic audio upload', "document.getElementById('sent').textContent.includes('uploaded to MLS')");
    assert(backendRequests.some(request => request.method === 'POST' && /\/audio$/.test(new URL(request.url).pathname)), 'live recorder did not upload a MediaRecorder Blob');

    backendMode = 'fail';
    await evaluate(cdp, "document.getElementById('recBtn').click();true");
    await waitFor(cdp, 'second fake microphone recording', "typeof active!=='undefined'&&active===true");
    await sleep(900);
    await evaluate(cdp, "document.getElementById('recBtn').click();true");
    await waitFor(cdp, 'volatile offline retry', "window.__mlsPhoneGuard.pending()===1&&document.getElementById('recErr').textContent.includes('temporary memory')");
    await evaluate(cdp, "document.getElementById('doneBtn').click();true");
    await waitFor(cdp, 'Done cleanup', "window.__mlsPhoneGuard.pending()===0&&document.getElementById('status').textContent.includes('confirm the transcript')");
    const databaseAfterDone = await evaluate(cdp, "indexedDB.databases().then(rows=>rows.some(row=>row.name==='mlsPhoneRec'))", true);
    assert.strictEqual(databaseAfterDone, false, 'legacy audio database existed after live Done cleanup');

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(artifacts, 'phone-done.png'), Buffer.from(screenshot.data, 'base64'));
    const report = {
      ok: true,
      chrome: chromePath,
      origin,
      syntheticOnly: true,
      productionContacted: false,
      productionOwnerLink: ownerHandoff.href,
      productionOwnerUsedFragment: ownerHandoff.href.includes('/phone.html#code='),
      productionOwnerRenderedQrLocally: ownerHandoff.qrIsLocal,
      productionPhoneUiModuleRequested: enhancerRequests,
      programmaticPairingRefused: startsAfterProgrammaticProbe === startsBeforeProgrammaticProbe,
      exactScheduledGateRefusedPairing: startsAfterExactGateProbe === startsBeforeExactGateProbe,
      trustedClickPairingStarted: backendRequests.some(request => request.method === 'POST' && new URL(request.url).pathname.endsWith('/api/mic/start')),
      fragmentHandoffAvoidedServerQuery: entry.search === '',
      pairingFragmentScrubbed: entry.hash === '',
      legacyQueryFailedClosed: legacyEntry.recorderHidden && legacyEntry.codeValue === '',
      hostingFragmentPhoneRequests: fragmentPhoneRequests,
      hostingLegacyRefusalRequests: legacyPhoneRequests,
      phoneManifestRequests: manifestRequests,
      legacyDatabaseDeletedOnStartupAndDone: !databaseAfterDone,
      realMediaRecorderBlobUploaded: backendRequests.some(request => request.method === 'POST' && /\/audio$/.test(new URL(request.url).pathname)),
      successfulUploadCopy: 'uploaded to MLS',
      failedUploadWasVolatileThenCleared: true,
      viewport: entry.viewport,
      backendRequests: backendRequests.map(request => ({ method: request.method, route: new URL(request.url).pathname }))
    };
    fs.writeFileSync(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`PASS live phone secure lifecycle in Chrome: ${path.join(artifacts, 'report.json')}`);
  } finally {
    if (cdp) cdp.close();
    try { chrome.kill(); } catch (_) {}
    await new Promise(resolve => server.close(resolve));
    await sleep(100);
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(tempRoot + path.sep) && path.basename(resolvedProfile).startsWith('mls-phone-live-')) {
      try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch (_) {}
    }
    if (process.exitCode && stderr) console.error(stderr.slice(-4000));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
