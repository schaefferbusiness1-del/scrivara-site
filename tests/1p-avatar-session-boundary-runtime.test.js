'use strict';

/* P1 AVATAR SESSION OWNER + ACCESSIBLE MODAL RUNTIME
 * --------------------------------------------------------------------------
 * Synthetic identities only. This suite never contacts the backend: every
 * Avatar request is held in the page until the test settles it. It proves a
 * forced same-email account boundary, a deliberately awkward logout where the
 * old bearer token is still present, stale public/DOM references, late GET and
 * POST completions, and the exact modal/kiosk/media teardown in real Chrome.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const avatarPath = path.join(root, '1p-feat_mls_avatar.js');
const source = fs.readFileSync(avatarPath, 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function slice(first, last) {
  const at = source.indexOf(first);
  const end = source.indexOf(last, at + first.length);
  assert.ok(at >= 0 && end > at, 'could not isolate ' + first);
  return source.slice(at, end);
}

/* Every named async surface has both the exact response receipt and its own
 * occurrence/form/kiosk owner. Runtime below supplies the cross-account race;
 * these pins make the population explicit so adding a new unguarded path is a
 * visible review decision rather than an accidental omission. */
const guarded = [
  ['config GET', "api('/api/avatar/config')", "/* ---- inbox tab"],
  ['face model POST', "api('/api/avatar/office/facelook'", 'var aiKnobs = []'],
  ['config POST', "api('/api/avatar/config', { method: 'POST'", '/* av-5.3.0'],
  ['inbox GET', "api('/api/avatar/checkins?status=' + status)", 'function open()'],
  ['kiosk turn POST', "api('/api/avatar/office/turn'", '/* THE SELF-END WATCHDOG'],
  ['unlock probe POST', "api('/api/avatar/office/unlock'", '/* Staff leaving must CLOSE'],
  ['unlock submit POST', "function kioskPinSubmit(mode)", 'function kioskMicPreflight'],
  ['full-summary GET', 'function withSummary(run, button)', "actions.appendChild(visitButton('Add to visit transcript'"]
];
for (const [name, first, last] of guarded) {
  const block = slice(first, last);
  ok(block.includes('apiResponseCurrent('), name + ' can apply a completion without the exact session receipt');
}
ok(/function sessionCredentialsCurrent\(receipt\)[\s\S]*!receipt\.account[\s\S]*!receipt\.token[\s\S]*receipt\.epoch !== sessionEpoch[\s\S]*receipt\.account !== sessionAccount[\s\S]*receipt\.token !== clean\(token\(\)\)/.test(source),
  'the response receipt is not exact across generation, epoch, account, and token');
ok(/function api\(path, options\)[\s\S]{0,900}if \(!sessionReceiptCurrent\(receipt\)\)[\s\S]{0,260}blocked: 'stale-or-blank-session'/.test(source),
  'the network door does not fail closed before fetch for a blank/stale session');
ok(/function publicCallCurrent\(owner, generation\)[\s\S]{0,180}publicOwnerCurrent\(owner, generation\) && liveSessionCredentials\(\)/.test(source),
  'exported reads/mutations are not bound to a live account and token');
ok(/function onSessionBoundary\(event\)[\s\S]*sessionGeneration\+\+[\s\S]*scrubAvatarSession\(\)[\s\S]*publishDormantApi\('no-authenticated-session'\)/.test(source),
  'logout cannot synchronously retire the generation into a dormant owner');
ok(/function dormantOwnerCurrent\(owner, generation\)[\s\S]*owner === currentApi[\s\S]*window\.__mlsAvatar === owner[\s\S]*owner\.instanceToken === INSTANCE_TOKEN[\s\S]*owner\.installToken === INSTALL_TOKEN/.test(source) &&
  /dormant\.revert = function \(\) \{ return revert\(dormant, generation\); \}/.test(source),
  'a capability-exact loader cannot retire a dormant owner safely');
ok(/back\.setAttribute\('role', 'dialog'\)[\s\S]*back\.setAttribute\('aria-modal', 'true'\)[\s\S]*back\.setAttribute\('aria-labelledby', 'mlsAvDialogTitle'\)/.test(source),
  'the Setup/inbox overlay is not a labelled modal dialog');
ok(/event\.key === 'Tab' && dialogState[\s\S]*event\.shiftKey[\s\S]*items\[items\.length - 1\]\.focus\(\)[\s\S]*items\[0\]\.focus\(\)/.test(source),
  'the modal has no two-way focus trap');
ok(/ttsFetchControllers\.splice\(0\)[\s\S]*controller\.abort\(\)[\s\S]*faceLiveCanvas\.width = 0[\s\S]*delete currentApi\.lastReady[\s\S]*delete currentApi\.lastMatchReceipt/.test(source),
  'session scrub does not retire audio/pixel buffers and public receipts');

function harnessHtml(malformed) {
  const incumbent = malformed === 'active'
    ? "window.__mlsAvatar={installed:true,asset:'unknown',revert:'not-a-function'};"
    : (malformed === 'dormant'
      ? "window.__mlsAvatar={installed:false,dormant:'unknown',asset:'unknown',revert:'not-a-function'};"
      : (malformed === 'microphone'
        ? "window.__mlsAvP1Mic={installed:false,asset:'unknown',revert:'not-a-function'};"
        : ''));
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="appShell" aria-hidden="false">
      <button id="exactOpener" type="button">Open synthetic Avatar</button>
      <div class="tools"></div><div id="visitView"></div>
      <textarea id="ez3flTranscript"></textarea>
    </main>
    <aside id="preHidden" aria-hidden="true" inert>pre-hidden</aside>
    <script>
      window.__mlsSessionEpoch=11;
      window.__mlsSessionAccount='same-session@example.test';
      window.__testToken='token-A';
      window.bkToken=()=>window.__testToken;
      window.bkBase=()=>location.origin;
      window.uns=(key)=>'synthetic:'+key;
      window.__patients=[{id:'synthetic-1',name:'Synthetic Patient',summary:''}];
      window.getPatients=()=>window.__patients;
      window.getActivePtId=()=> 'synthetic-1';
      window.setActivePtId=()=>{}; window.openPatient=()=>{}; window.showView=()=>{};
      window.upsertPatient=(next)=>{ window.__patients=[next]; };
      window.toast=()=>{};
      ${incumbent}

      window.__requests=[];
      window.fetch=(url,options={})=>{
        const row={id:window.__requests.length+1,url:String(url),path:new URL(String(url),location.href).pathname+new URL(String(url),location.href).search,
          method:String(options.method||'GET').toUpperCase(),auth:(options.headers&&options.headers.Authorization)||'',body:String(options.body||''),settled:false,aborted:false};
        row.promise=new Promise((resolve,reject)=>{row.resolve=resolve;row.reject=reject;});
        if(options.signal){
          const abort=()=>{row.aborted=true;if(!row.settled){row.settled=true;row.reject(new DOMException('aborted','AbortError'));}};
          if(options.signal.aborted) abort(); else options.signal.addEventListener('abort',abort,{once:true});
        }
        window.__requests.push(row); return row.promise;
      };
      window.__settleRequest=(id,json,good=true,status)=>{
        const row=window.__requests.find(x=>x.id===id); if(!row||row.settled)return false;
        row.settled=true; const code=status==null?(good?200:500):status;
        row.resolve({ok:!!good,status:code,json:()=>Promise.resolve(json||{}),blob:()=>Promise.resolve(new Blob(['synthetic-audio'],{type:'audio/mpeg'}))}); return true;
      };
      window.__requestState=()=>window.__requests.map(({id,path,method,auth,body,settled,aborted})=>({id,path,method,auth,body,settled,aborted}));

      window.__media=[];
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:(constraints)=>{
        const row={id:window.__media.length+1,constraints,settled:false,stops:0};
        row.promise=new Promise((resolve,reject)=>{row.resolve=resolve;row.reject=reject;});
        window.__media.push(row); return row.promise;
      }}});
      window.__resolveMedia=(id)=>{
        const row=window.__media.find(x=>x.id===id); if(!row||row.settled)return false; row.settled=true;
        const track={stop:()=>{row.stops++;},getSettings:()=>({echoCancellation:true,noiseSuppression:true})};
        const stream={getTracks:()=>[track],getAudioTracks:()=>[track]}; row.resolve(stream); return true;
      };
      window.__mediaState=()=>window.__media.map(({id,constraints,settled,stops})=>({id,constraints,settled,stops}));

      window.__audioContexts=[];
      class TestAudioContext {
        constructor(){this.state='running';this.closed=false;window.__audioContexts.push(this);}
        resume(){this.state='running';return Promise.resolve();}
        close(){this.closed=true;this.state='closed';return Promise.resolve();}
        createMediaStreamSource(){return {connect(){},disconnect(){}};}
        createAnalyser(){return {fftSize:0,smoothingTimeConstant:0,connect(){},disconnect(){},getByteTimeDomainData(a){a.fill(128);},getByteFrequencyData(a){a.fill(0);}};}
        createMediaElementSource(){return {connect(){},disconnect(){}};}
        get destination(){return {};}
      }
      window.AudioContext=TestAudioContext; window.webkitAudioContext=TestAudioContext;
      window.__speechCancels=0;
      Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel(){window.__speechCancels++;},getVoices(){return [];},speak(u){setTimeout(()=>u.onend&&u.onend(),0);}}});
      window.SpeechSynthesisUtterance=function(text){this.text=text;};
      class TestRecognition {start(){this.started=true;} stop(){this.started=false;} abort(){this.started=false;}}
      window.SpeechRecognition=TestRecognition; window.webkitSpeechRecognition=TestRecognition;
      Element.prototype.requestFullscreen=function(){return Promise.resolve();};
      document.exitFullscreen=()=>Promise.resolve();
      window.__images=[];
      window.Image=class { constructor(){window.__images.push(this);} set src(v){this._src=v;} get src(){return this._src;} };
    </script>
    <script data-mls-install-token="cap-runtime" src="/avatar.js"></script>
  </body></html>`;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/avatar.js') {
        res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        return res.end(source);
      }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(harnessHtml(url.searchParams.get('malformed') || ''));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function checkin(marker, longSummary) {
  return {
    id: marker + '-checkin', patient_external_id: 'synthetic-1', status: 'ready',
    ready_at: '2026-08-13T12:00:00Z', turns: 2,
    headline: marker + ' headline', bullets: [marker + ' bullet'], flags: [], audited: 'passed',
    summary: marker + ' ' + (longSummary ? 'x'.repeat(4100) : 'summary')
  };
}
function config(marker) {
  return {ok:true,config:{name:'Synthetic '+marker,intro:'',questions:['Synthetic question?'],tone:'friendly',voice:'coral',faceMode:'drawn',faceLook:{},exitPin:'2468',faceImage:''}};
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({channel:'chrome',headless:true});
  let failure = null;
  try {
    /* A malformed direct/hot incumbent is never executed, trusted, or
     * overwritten. The capability-aware loader must retire it first. */
    for (const malformed of ['active', 'dormant']) {
      const page = await browser.newPage();
      await page.goto(base + '/?malformed=' + malformed, {waitUntil:'load'});
      const result = await page.evaluate(() => ({
        same: window.__mlsAvatar && window.__mlsAvatar.asset === 'unknown',
        reason: window.__mlsAvatarLoadRefusal && window.__mlsAvatarLoadRefusal.reason,
        requests: window.__requestState().length,
        button: !!document.getElementById('mlsAvBtn')
      }));
      eq(result.same, true, 'a malformed incumbent was overwritten by a direct hot evaluation');
      eq(result.reason, 'existing-owner-requires-loader-retirement', 'malformed ownership did not fail closed with a loader requirement');
      eq(result.requests, 0, 'malformed-owner refusal still reached the network');
      eq(result.button, false, 'malformed-owner refusal mounted an operational button');
      await page.close();
    }
    {
      const page = await browser.newPage();
      await page.goto(base + '/?malformed=microphone', {waitUntil:'load'});
      const result = await page.evaluate(() => ({
        avatar: window.__mlsAvatar,
        sameMic: window.__mlsAvP1Mic && window.__mlsAvP1Mic.asset === 'unknown',
        reason: window.__mlsAvatarLoadRefusal && window.__mlsAvatarLoadRefusal.reason,
        requests: window.__requestState().length,
        button: !!document.getElementById('mlsAvBtn')
      }));
      eq(result.avatar, undefined, 'a partial microphone incumbent was replaced by an Avatar owner');
      eq(result.sameMic, true, 'a partial microphone incumbent was overwritten');
      eq(result.reason, 'existing-microphone-owner-requires-loader-retirement', 'partial microphone ownership did not fail closed');
      eq(result.requests, 0, 'partial microphone-owner refusal reached the network');
      eq(result.button, false, 'partial microphone-owner refusal mounted an operational button');
      await page.close();
    }

    /* Same-email forced boundary with pending A GETs and POSTs, exact modal
     * containment, stale API references, then a logout whose old token lingers. */
    {
      const page = await browser.newPage({viewport:{width:1100,height:800}});
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));
      await page.goto(base + '/', {waitUntil:'load'});
      await page.waitForFunction(() => window.__mlsAvatar && window.__mlsAvatar.installed === true);

      /* Resolve the one boot refresh with a deliberately truncated cache row,
         which makes the Visit-card Full summary button issue its own GET. */
      await page.waitForFunction(() => window.__requests.some(r => r.path.includes('/api/avatar/checkins?status=ready')));
      const bootId = await page.evaluate(() => window.__requests.find(r => r.path.includes('/api/avatar/checkins?status=ready')).id);
      await page.evaluate(({id,row}) => window.__settleRequest(id,{checkins:[row]}), {id:bootId,row:checkin('SESSION-A',true)});
      await page.waitForFunction(() => window.__mlsAvatar.lastReady && document.getElementById('mlsAvVisitCard'));
      await page.getByRole('button',{name:'Full summary'}).click();
      await page.waitForFunction((before) => window.__requests.length > before, bootId);
      const fullId = await page.evaluate(() => window.__requests[window.__requests.length-1].id);

      await page.evaluate(() => { document.getElementById('exactOpener').focus(); window.__oldAvatarA=window.__mlsAvatar; window.__mlsAvatar.open(); });
      await page.waitForSelector('#mlsAvBack');
      const modal = await page.evaluate(() => {
        const back=document.getElementById('mlsAvBack');
        const labelled=document.getElementById(back.getAttribute('aria-labelledby'));
        return {role:back.getAttribute('role'),modal:back.getAttribute('aria-modal'),label:labelled&&labelled.textContent,
          active:document.activeElement&&document.activeElement.textContent,
          appAria:document.getElementById('appShell').getAttribute('aria-hidden'),appInert:document.getElementById('appShell').hasAttribute('inert'),
          preAria:document.getElementById('preHidden').getAttribute('aria-hidden'),preInert:document.getElementById('preHidden').hasAttribute('inert')};
      });
      eq(modal.role,'dialog','overlay has no dialog role');
      eq(modal.modal,'true','overlay is not announced as modal');
      eq(modal.label,'Avatar check-ins','dialog label does not resolve to its visible title');
      ok(/Close/.test(modal.active),'initial focus did not move inside the dialog');
      eq(modal.appAria,'true','app background was not aria-hidden');
      eq(modal.appInert,true,'app background was not inert');
      eq(modal.preAria,'true','pre-hidden sibling lost its exact aria state');
      eq(modal.preInert,true,'pre-inert sibling lost its exact inert state');

      await page.evaluate(() => {
        const late=document.createElement('section'); late.id='lateSibling'; late.setAttribute('aria-hidden','false'); document.body.appendChild(late);
      });
      await page.waitForFunction(() => document.getElementById('lateSibling').hasAttribute('inert'));
      eq(await page.getAttribute('#lateSibling','aria-hidden'),'true','late body sibling escaped aria hiding');

      const dialogFocus = page.locator('#mlsAvBack button:not([disabled]),#mlsAvBack input:not([disabled]),#mlsAvBack select:not([disabled]),#mlsAvBack textarea:not([disabled]),#mlsAvBack [tabindex]:not([tabindex="-1"])');
      const focusCount = await dialogFocus.count();
      ok(focusCount >= 4,'dialog did not expose enough controls to exercise its focus trap');
      await dialogFocus.nth(focusCount-1).focus(); await page.keyboard.press('Tab');
      eq(await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim()),'Close','Tab escaped instead of wrapping to the first dialog control');
      await dialogFocus.first().focus(); await page.keyboard.press('Shift+Tab');
      eq(await page.evaluate(() => document.activeElement === Array.from(document.querySelectorAll('#mlsAvBack button:not([disabled]),#mlsAvBack input:not([disabled]),#mlsAvBack select:not([disabled]),#mlsAvBack textarea:not([disabled]),#mlsAvBack [tabindex]:not([tabindex="-1"])')).slice(-1)[0]),true,
        'Shift+Tab escaped instead of wrapping to the last dialog control');
      await page.evaluate(() => { const t=document.createElement('textarea');t.id='typingEscape';document.querySelector('.mlsAvPanel').appendChild(t);t.focus(); });
      await page.keyboard.press('Escape');
      eq(await page.locator('#mlsAvBack').count(),1,'Escape while typing closed the dialog and discarded edits');
      eq(await page.evaluate(() => document.activeElement && document.activeElement.id === 'typingEscape'),false,'typing Escape did not blur the field');

      /* Resolve the first inbox, then leave mark-seen, config save, another
         inbox, and another config GET all pending under session A. */
      const firstInboxId = await page.evaluate(() => window.__requests.filter(r => r.path.includes('/api/avatar/checkins?status=ready')&&!r.settled).slice(-1)[0].id);
      await page.evaluate(({id,row}) => window.__settleRequest(id,{checkins:[row]}), {id:firstInboxId,row:checkin('SESSION-A-INBOX',false)});
      await page.getByRole('button',{name:'Mark seen'}).click();
      await page.getByRole('button',{name:'Set up the avatar'}).click();
      await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/avatar/config' && !r.settled));
      const configGetId = await page.evaluate(() => window.__requests.filter(r => r.path === '/api/avatar/config'&&!r.settled).slice(-1)[0].id);
      await page.evaluate(({id,payload}) => window.__settleRequest(id,payload), {id:configGetId,payload:config('A')});
      await page.getByRole('button',{name:'Save avatar'}).click();
      await page.getByRole('button',{name:'Ready'}).click();
      await page.getByRole('button',{name:'Set up the avatar'}).click();
      await page.waitForFunction(() => window.__requests.filter(r => !r.settled && r.auth === 'Bearer token-A').length >= 5);

      await page.evaluate(() => {
        window.__faceCallbackCount=0;
        window.__oldAvatarA.deriveLookFromPhoto('data:image/png;base64,SYNTHETIC',()=>window.__faceCallbackCount++);
      });
      ok(await page.evaluate(() => window.__images.length > 0),'pending face derivation was not created');
      const beforeBoundary = await page.evaluate(() => window.__requestState().length);
      const boundary = await page.evaluate(() => {
        window.__testToken='token-B'; window.__mlsSessionEpoch=12;
        window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{epoch:12,nextAccount:'same-session@example.test'}}));
        const next=window.__mlsAvatar, old=window.__oldAvatarA;
        const staleCalls={open:old.open(),refresh:old.refreshCount(true),kiosk:old.openKiosk(),patient:old.exactPatient('synthetic-1')};
        const newRefresh=next.refreshCount(true);
        return {oldInstalled:old.installed,nextInstalled:next.installed,same:old===next,staleCalls,newRefresh,
          state:next.sessionState(),dialog:!!document.getElementById('mlsAvBack'),kiosk:!!document.getElementById('mlsAvKiosk'),
          focus:document.activeElement&&document.activeElement.id,
          appAria:document.getElementById('appShell').getAttribute('aria-hidden'),appInert:document.getElementById('appShell').hasAttribute('inert'),
          preAria:document.getElementById('preHidden').getAttribute('aria-hidden'),preInert:document.getElementById('preHidden').hasAttribute('inert'),
          lateAria:document.getElementById('lateSibling').getAttribute('aria-hidden'),lateInert:document.getElementById('lateSibling').hasAttribute('inert')};
      });
      eq(boundary.oldInstalled,false,'session A API remained installed after the forced boundary');
      eq(boundary.nextInstalled,true,'session B did not receive an operational exact owner');
      eq(boundary.same,false,'forced same-email boundary reused the old API object');
      eq(boundary.staleCalls.open,false,'saved A open() still mutates session B');
      eq(boundary.staleCalls.refresh,false,'saved A refresh still reads with session B');
      eq(boundary.staleCalls.kiosk,false,'saved A kiosk API still mutates session B');
      eq(boundary.staleCalls.patient,null,'saved A API still exposes patient data in session B');
      eq(boundary.newRefresh,true,'new B API is not usable');
      eq(boundary.state.epoch,12,'new owner is not bound to the new exact epoch');
      eq(boundary.dialog,false,'session boundary did not synchronously close Setup/inbox');
      eq(boundary.kiosk,false,'session boundary left a kiosk mounted');
      eq(boundary.focus,'exactOpener','session boundary did not restore the exact opener');
      eq(boundary.appAria,'false','background aria-hidden was not restored byte-for-byte');
      eq(boundary.appInert,false,'background inert was not restored');
      eq(boundary.preAria,'true','pre-hidden sibling aria state was not restored exactly');
      eq(boundary.preInert,true,'pre-inert sibling inert state was not restored exactly');
      eq(boundary.lateAria,'false','late sibling aria state was not restored exactly');
      eq(boundary.lateInert,false,'late sibling inert state was not restored exactly');

      await page.waitForFunction(() => window.__requests.some(r => r.auth === 'Bearer token-B' && !r.settled));
      const afterBRequest = await page.evaluate(() => window.__requestState());
      const bRequest = afterBRequest.find(r => r.auth === 'Bearer token-B' && !r.settled);
      ok(!!bRequest,'B refresh was throttled or blocked by A in-flight state');
      eq(bRequest.path,'/api/avatar/checkins?status=ready','B refresh called an unexpected route');

      /* Fire the face callback and every old response after B owns the page. */
      await page.evaluate(() => { const image=window.__images[window.__images.length-1]; if(image&&image.onerror) image.onerror(new Event('error')); });
      eq(await page.evaluate(() => window.__faceCallbackCount),0,'late A face completion reached its saved callback');
      const aPending = afterBRequest.filter(r => r.auth === 'Bearer token-A' && !r.settled).map(r => r.id);
      ok(aPending.includes(fullId),'the full-summary A request was not actually pending at the boundary');
      ok(aPending.some(id => { const r=afterBRequest.find(x=>x.id===id); return r.method==='POST' && r.path==='/api/avatar/config'; }),
        'the config POST A request was not pending');
      ok(aPending.some(id => { const r=afterBRequest.find(x=>x.id===id); return r.method==='POST' && /\/seen$/.test(r.path); }),
        'the mark-seen A POST was not pending');
      for (const id of aPending) {
        const row = afterBRequest.find(r => r.id === id);
        const payload = row.path === '/api/avatar/config' ? config('LATE-A') :
          (/\/seen$/.test(row.path) ? {ok:true} : {checkins:[checkin('LATE-A',false)]});
        await page.evaluate(({id,payload}) => window.__settleRequest(id,payload), {id,payload});
      }
      await page.evaluate(({id,row}) => window.__settleRequest(id,{checkins:[row]}), {id:bRequest.id,row:checkin('SESSION-B',false)});
      await page.waitForFunction(() => window.__mlsAvatar.lastReady && window.__mlsAvatar.lastReady.checkins[0] && window.__mlsAvatar.lastReady.checkins[0].headline.includes('SESSION-B'));
      await page.waitForTimeout(30);
      const late = await page.evaluate(() => ({text:document.body.textContent,ready:window.__mlsAvatar.lastReady,requests:window.__requestState().length}));
      ok(!late.text.includes('LATE-A'),'late A response painted named evidence into B');
      ok(late.ready.checkins.every(r => !String(r.headline).includes('LATE-A')),'late A response replaced B public cache');

      /* Logout publishes blank account while token-B intentionally lingers. */
      await page.evaluate(() => { window.__avatarB=window.__mlsAvatar; });
      const requestCountBeforeLogout = await page.evaluate(() => window.__requestState().length);
      const logout = await page.evaluate(() => {
        window.__mlsSessionAccount=''; window.__mlsSessionEpoch=13;
        window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{epoch:13,nextAccount:''}}));
        const old=window.__avatarB, dormant=window.__mlsAvatar;
        window.__dormantLogout=dormant;
        return {oldInstalled:old.installed,dormantInstalled:dormant&&dormant.installed,dormantReason:dormant&&dormant.dormant,
          operational:typeof dormant.open==='function',button:!!document.getElementById('mlsAvBtn'),
          oldRefresh:old.refreshCount(true),oldOpen:old.open(),oldPatient:old.exactPatient('synthetic-1')};
      });
      eq(logout.oldInstalled,false,'logout did not retire B API synchronously');
      eq(logout.dormantInstalled,false,'blank-account boundary republished an installed API');
      eq(logout.dormantReason,'no-authenticated-session','blank-account owner is not explicitly dormant');
      eq(logout.operational,true,'blank-account owner lost the established public method shape');
      eq(logout.button,false,'blank-account boundary left an operational Avatar button');
      eq(logout.oldRefresh,false,'saved B API sent a read using the lingering old token');
      eq(logout.oldOpen,false,'saved B API reopened PHI UI after logout');
      eq(logout.oldPatient,null,'saved B API exposed a chart after logout');
      await page.waitForTimeout(30);
      eq(await page.evaluate(() => window.__requestState().length),requestCountBeforeLogout,'logout with a lingering token sent a backend request');

      /* The dormant exact owner can resume on a later authenticated boundary,
         while both A and B references stay inert. */
      const resumed = await page.evaluate(() => {
        window.__testToken='token-C'; window.__mlsSessionAccount='same-session@example.test'; window.__mlsSessionEpoch=14;
        window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{epoch:14,nextAccount:'same-session@example.test'}}));
        window.__avatarC=window.__mlsAvatar;
        let callbacks=0;
        window.__dormantLogout.voiceGateStart(()=>callbacks++);
        window.__dormantLogout.deriveLookFromPhoto('data:image/png;base64,SYNTHETIC',()=>callbacks++);
        return {installed:window.__avatarC.installed,state:window.__avatarC.sessionState(),refresh:window.__avatarC.refreshCount(true),
          oldB:window.__avatarB.refreshCount(true),dormantOpen:window.__dormantLogout.open(),
          dormantRevert:window.__dormantLogout.revert(),callbacks};
      });
      eq(resumed.installed,true,'authenticated session did not resume from the dormant exact owner');
      eq(resumed.state.epoch,14,'resumed owner has the wrong epoch');
      eq(resumed.refresh,true,'resumed owner is unusable');
      eq(resumed.oldB,false,'saved B API revived in session C');
      eq(resumed.dormantOpen,false,'saved dormant API became operational in session C');
      eq(resumed.dormantRevert,false,'saved dormant owner tore down session C');
      eq(resumed.callbacks,0,'saved dormant API invoked callbacks in session C');
      await page.waitForFunction(() => window.__requests.some(r => r.auth === 'Bearer token-C' && !r.settled));
      const cId = await page.evaluate(() => window.__requests.find(r => r.auth === 'Bearer token-C' && !r.settled).id);
      await page.evaluate(id => window.__settleRequest(id,{checkins:[]}),cId);

      const teardown = await page.evaluate(() => {
        const api=window.__avatarC; const first=api.revert(); const second=api.revert();
        const stale=api.open();
        window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{epoch:15,nextAccount:'same-session@example.test'}}));
        return {first,second,stale,avatar:window.__mlsAvatar,mic:window.__mlsAvP1Mic,
          button:!!document.getElementById('mlsAvBtn'),dialog:!!document.getElementById('mlsAvBack'),style:!!document.getElementById('mlsAvStyle')};
      });
      eq(teardown.first,true,'current exact owner did not revert');
      eq(teardown.second,true,'revert is not idempotent');
      eq(teardown.stale,false,'saved API was not inert after teardown');
      eq(teardown.avatar,undefined,'teardown did not delete the exact canonical Avatar owner');
      eq(teardown.mic,undefined,'teardown did not delete the exact canonical mic owner');
      eq(teardown.button,false,'teardown left the Avatar button');
      eq(teardown.dialog,false,'teardown left a dialog');
      eq(teardown.style,false,'teardown left its style owner');
      eq(pageErrors.length,0,'browser runtime raised errors: '+pageErrors.join(' | '));
      await page.close();
    }

    /* Pending camera permission, voice-gate permission, TTS, kiosk turn, and
     * staff unlock all belong to A and must die together at the boundary. */
    {
      const page = await browser.newPage({viewport:{width:1100,height:800}});
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));
      await page.goto(base + '/', {waitUntil:'load'});
      await page.waitForFunction(() => window.__mlsAvatar && window.__mlsAvatar.installed === true && window.__requests.length);
      const boot = await page.evaluate(() => window.__requests[0].id);
      await page.evaluate(id => window.__settleRequest(id,{checkins:[]}),boot);
      await page.waitForFunction(() => document.getElementById('mlsAvBtn'));

      await page.evaluate(() => { document.getElementById('exactOpener').focus(); window.__oldMediaApi=window.__mlsAvatar; window.__oldMediaApi.open(); });
      await page.getByRole('button',{name:'Set up the avatar'}).click();
      await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/avatar/config' && !r.settled));
      const cfgId = await page.evaluate(() => window.__requests.find(r => r.path === '/api/avatar/config'&&!r.settled).id);
      await page.evaluate(({id,payload}) => window.__settleRequest(id,payload),{id:cfgId,payload:config('MEDIA-A')});
      await page.getByRole('button',{name:/Create from my camera/}).click();
      await page.waitForFunction(() => window.__media.some(r => r.constraints && r.constraints.video));
      await page.evaluate(() => {
        window.__gateCallback=[];
        window.__oldMediaApi.voiceGateStart(ok => window.__gateCallback.push(ok));
        window.__savedSetupSave=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Save avatar');
        window.__oldMediaApi.openKiosk();
        window.__savedConsent=document.getElementById('mlsAvKioskConsentYes');
        window.__savedEnd=document.getElementById('mlsAvKioskEnd');
        window.__savedConsent.click();
      });
      await page.waitForFunction(() => window.__media.filter(r => r.constraints && r.constraints.audio).length >= 2);
      const mediaIds = await page.evaluate(() => ({
        video:window.__media.find(r=>r.constraints&&r.constraints.video).id,
        gate:window.__media.find(r=>r.constraints&&r.constraints.audio).id,
        kiosk:window.__media.filter(r=>r.constraints&&r.constraints.audio).slice(-1)[0].id
      }));
      await page.evaluate(id => window.__resolveMedia(id),mediaIds.kiosk);
      await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/avatar/office/turn' && !r.settled));
      await page.evaluate(() => window.__savedEnd.click());
      await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/avatar/office/unlock' && !r.settled));
      await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/avatar/office/tts'));
      const pendingA = await page.evaluate(() => window.__requestState().filter(r=>r.auth==='Bearer token-A'&&!r.settled));
      ok(pendingA.some(r=>r.path==='/api/avatar/office/turn'&&r.method==='POST'),'kiosk turn was not pending at boundary');
      ok(pendingA.some(r=>r.path==='/api/avatar/office/unlock'&&r.method==='POST'),'unlock probe was not pending at boundary');
      ok(pendingA.some(r=>r.path==='/api/avatar/office/tts'),'TTS request was not pending at boundary');
      const before = await page.evaluate(() => window.__requestState().length);
      const gateCallbacksBeforeBoundary = await page.evaluate(() => window.__gateCallback.slice());

      const stopped = await page.evaluate((kioskMediaId) => {
        window.__testToken='token-B';window.__mlsSessionEpoch=12;
        window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{epoch:12,nextAccount:'same-session@example.test'}}));
        const afterBoundary=window.__requestState().length;
        window.__savedConsent.click(); window.__savedEnd.click(); window.__savedSetupSave.click();
        let staleGateCalls=0;
        const staleGateStart=window.__oldMediaApi.voiceGateStart(()=>staleGateCalls++);
        return {afterBoundary,kiosk:!!document.getElementById('mlsAvKiosk'),dialog:!!document.getElementById('mlsAvBack'),
          gate:window.__oldMediaApi.voiceGate(),oldInstalled:window.__oldMediaApi.installed,
          staleGateStart,staleGateCalls,
          adoptedStops:window.__media.find(r=>r.id===kioskMediaId).stops,
          speechCancels:window.__speechCancels,closed:window.__audioContexts.filter(c=>c.closed).length,
          opener:document.activeElement&&document.activeElement.id};
      },mediaIds.kiosk);
      eq(stopped.afterBoundary,before,'session-boundary teardown sent a finish/write request');
      eq(stopped.kiosk,false,'session boundary left the kiosk mounted');
      eq(stopped.dialog,false,'session boundary left Setup mounted');
      eq(stopped.gate.ready,false,'stale voice gate still reports a live microphone');
      eq(stopped.oldInstalled,false,'media session A API remained installed');
      eq(stopped.staleGateStart,false,'stale saved API started a voice-gate request');
      eq(stopped.staleGateCalls,0,'stale saved API invoked a voice-gate callback');
      ok(stopped.adoptedStops >= 1,'adopted kiosk microphone track was not stopped synchronously');
      ok(stopped.speechCancels >= 1,'session boundary did not cancel active speech');
      ok(stopped.closed >= 1,'session boundary did not close audio contexts');
      eq(stopped.opener,'exactOpener','media boundary did not restore the exact dialog opener');
      await page.waitForTimeout(20);
      eq(await page.evaluate(() => window.__requestState().length),before,'saved detached A controls sent requests after boundary');

      await page.evaluate(({video,gate}) => { window.__resolveMedia(video); window.__resolveMedia(gate); },mediaIds);
      await page.waitForTimeout(20);
      const lateMedia = await page.evaluate(() => ({state:window.__mediaState(),gateCallbacks:window.__gateCallback.slice(),video:!!document.querySelector('#mlsAvBack video')}));
      ok(lateMedia.state.find(r=>r.id===mediaIds.video).stops >= 1,'late A camera permission resurrected or leaked its track');
      ok(lateMedia.state.find(r=>r.id===mediaIds.gate).stops >= 1,'late A voice-gate permission resurrected or leaked its track');
      eq(lateMedia.gateCallbacks.length,gateCallbacksBeforeBoundary.length,'boundary or late grant invoked an A voice-gate callback');
      eq(lateMedia.gateCallbacks[0],false,'pre-boundary kiosk cancellation reported voice-gate adoption');
      eq(lateMedia.video,false,'late A camera grant mounted video in B');

      for (const row of pendingA) {
        if (row.aborted) continue;
        const payload=row.path==='/api/avatar/office/turn'
          ? {ok:true,say:'LATE-A-SPEECH',done:true,avatar:{name:'Late A'}}
          : {ok:true,unset:true};
        await page.evaluate(({id,payload}) => window.__settleRequest(id,payload),{id:row.id,payload});
      }
      await page.waitForTimeout(30);
      eq(await page.locator('#mlsAvKiosk').count(),0,'late turn/unlock completion reopened kiosk UI');
      ok(!String(await page.textContent('body')).includes('LATE-A-SPEECH'),'late kiosk completion painted A speech into B');
      ok((await page.evaluate(() => window.__requestState().find(r=>r.path==='/api/avatar/office/tts').aborted)) === true,
        'session boundary did not abort the pending A TTS fetch');
      eq(pageErrors.length,0,'media runtime raised errors: '+pageErrors.join(' | '));
      await page.close();
    }
  } catch (error) {
    failure = error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure;
  console.log('PASS 1p Avatar session boundary + modal accessibility (' + checks + ' assertions)');
})().catch((error) => { console.error(error && error.stack || error); process.exit(1); });
