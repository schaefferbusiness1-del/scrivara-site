'use strict';

/* P1 PROVIDER ROSTER HOT TAKEOVER + SESSION OWNERSHIP RUNTIME
 * Synthetic clinician names only. Real Chrome executes the actual preview
 * loader and fork; no extension or backend is contacted.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const connector = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const roster = fs.readFileSync(path.join(root, '1p-feat_athena_provider_roster.js'), 'utf8');
const mark = connector.indexOf(';/* 1p-owned canonical roster.');
const loaderStart = connector.indexOf('(function(){try{', mark);
const loaderEnd = connector.indexOf(';(function(){try{var sched=', loaderStart);
assert(mark >= 0 && loaderStart >= 0 && loaderEnd > loaderStart, 'could not isolate the P1 roster loader');
const loader = connector.slice(loaderStart, loaderEnd);

let checks=0;
function ok(v,m){assert.ok(v,m);checks++;}
function eq(a,b,m){assert.strictEqual(a,b,m);checks++;}
ok(!/1p-feat_athena_provider_picker\.js/.test(loader),'preview loader still loads a provider-picker fork');
ok(!/__mlsProviderPicker/.test(roster),'P1 roster still calls the legacy picker');
ok(!/widenToAll|applyScope\s*\(/.test(roster),'P1 roster contains a selected-to-all widening path');

function html(mode){
  const picker = mode==='bad-picker'
    ? "window.__mlsProviderPicker={installed:true,version:'shared-picker'};"
    : "window.__mlsProviderPicker={installed:true,version:'shared-picker',revert(){window.__reverts.picker++;this.installed=false;document.getElementById('mlsppWrap')?.remove();return true;}};";
  const rosterOwner = mode==='bad-roster'
    ? "window.__mlsProviderRoster={installed:true,version:'shared-roster'};"
    : "window.__mlsProviderRoster={installed:true,version:'shared-roster',revert(){window.__reverts.roster++;this.installed=false;return true;}};";
  const priorController = mode==='malformed-controller'
    ? "window.__mlsP1ProviderRosterLoader={installed:true,version:'p1-provider-roster-1.0.0',installToken:'malformed-token',state:'ready',ensure(){return true;},revert(){window.__reverts.controller++;this.installed=false;delete window.__mlsP1ProviderRosterLoader;return true;}};"
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
    <script data-mls-asset="feat_athena_provider_picker.js"></script><script data-mls-asset="feat_athena_provider_roster.js"></script>
    </head><body><div id="mlsppWrap">duplicate Whose patients?</div><script>
      window.__MLS_P1_PREVIEW={enabled:true};window.__MLS_AV='synthetic';window.__mlsSessionAccount='same-email@example.test';window.__mlsSessionEpoch=71;window.__testToken='token-A';
      window.bkToken=()=>window.__testToken;window.uns=(key)=>'synthetic:'+window.__mlsSessionAccount+':'+key;window._calProviders=[];window._calAppts=[];
      window.__reverts={picker:0,tag:0,roster:0,controller:0};window.__rosterEvents=[];window.addEventListener('mls-provider-roster-updated',e=>window.__rosterEvents.push(e.detail));
      const nativeSet=Storage.prototype.setItem;window.__storageWrites=[];Storage.prototype.setItem=function(k,v){window.__storageWrites.push({key:String(k),value:String(v),epoch:window.__mlsSessionEpoch,token:window.__testToken});return nativeSet.call(this,k,v);};
      window.__mlsProviderTagFix={installed:true,version:'shared-tag',revert(){window.__reverts.tag++;this.installed=false;return true;}};
      ${picker}${rosterOwner}${priorController}
      window.__result=(id,name)=>({ok:true,requestId:id,providerRoster:[{stableKey:'athena-id:prov-'+name.toLowerCase(),id:'prov-'+name.toLowerCase(),name:name+' Synthetic, MD',raw:'Synthetic_'+name+'_MD'}],providerRosterReceipt:{complete:true,partial:false,reason:'synthetic-complete',requestId:id,expectedCount:1,observedCount:1,reachedEnd:true,capReached:false,budgetExpired:false,restored:true,boundsStable:true,steps:1}});
      window.__arm=(id)=>window.__mlsProviderRoster.beginOperation({targetDate:'2026-08-13',requestId:id,providerMode:'all',requestedProviderId:'',requestedProviderStableKey:''});
      window.__post=(resp)=>window.postMessage({source:'mls-ext',type:'mlsAppScheduleResult',resp},location.origin);
    </script><script src="/loader.js"></script></body></html>`;
}

function serve(){return new Promise(resolve=>{const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');res.setHeader('Cache-Control','no-store');if(u.pathname==='/loader.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(loader);}if(u.pathname==='/1p-feat_athena_provider_roster.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(roster);}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(u.searchParams.get('mode')||''));});server.listen(0,'127.0.0.1',()=>resolve(server));});}

(async()=>{
  const server=await serve(),base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({channel:'chrome',headless:true});let failure=null;
  try{
    const page=await browser.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e&&e.message||e)));
    await page.goto(base+'/',{waitUntil:'load'});
    await page.waitForFunction(()=>window.__mlsP1ProviderRosterLoader&&window.__mlsP1ProviderRosterLoader.state==='ready');
    const hot=await page.evaluate(()=>({reverts:window.__reverts,version:window.__mlsProviderRoster.version,token:window.__mlsProviderRoster.installToken===window.__mlsP1ProviderRosterLoader.installToken,picker:window.__mlsProviderPicker.installed,tag:window.__mlsProviderTagFix.installed,duplicate:!!document.getElementById('mlsppWrap'),pickerTags:document.querySelectorAll('script[data-mls-asset="feat_athena_provider_picker.js"]').length,rosterTags:document.querySelectorAll('script[data-mls-asset="feat_athena_provider_roster.js"]').length}));
    eq(hot.reverts.picker,1,'hot takeover did not revert the shared picker');eq(hot.reverts.tag,1,'hot takeover did not revert the appended picker tag owner');eq(hot.reverts.roster,1,'hot takeover did not revert the shared roster');eq(hot.version,'p1-provider-roster-1.0.0','hot takeover did not install the P1 fork');eq(hot.token,true,'P1 roster is not bound to the exact controller token');eq(hot.picker,false,'legacy picker remained live');eq(hot.tag,false,'legacy picker tag owner remained live');eq(hot.duplicate,false,'duplicate Whose patients UI survived takeover');eq(hot.pickerTags,0,'legacy picker script tag survived retirement');eq(hot.rosterTags,1,'canonical roster has duplicate script owners');

    /* Completed A is accepted. Pending A/raw/forged messages cross a forced
       same-email boundary and cannot write storage, events, diag or calendar. */
    await page.evaluate(()=>{window.__arm('req-A-complete');window.__post(window.__result('req-A-complete','Alpha'));});
    await page.waitForFunction(()=>window.__rosterEvents.length===1);
    const completed=await page.evaluate(()=>({writes:window.__storageWrites.length,events:window.__rosterEvents.length,diag:window.__mlsProviderRoster.getDiag(),receipt:window.__mlsProviderRoster.getReceipt()}));
    ok(completed.writes>=3,'completed A did not persist its account-owned roster/receipt');eq(completed.events,1,'completed A did not publish exactly one canonical event');eq(completed.receipt.requestId,'req-A-complete','completed A receipt lost exact request provenance');ok(completed.diag&&completed.diag.providerNames.includes('Alpha Synthetic, MD'),'completed A diagnostic omitted its synthetic clinician');
    await page.evaluate(()=>{window.__arm('req-A-late');window.__oldRosterOwner=window.__mlsProviderRoster._captureOwner('late-A-direct');window.__schedRaw=window.__result('req-A-late','RawAlpha');window.__writesAtBoundary=window.__storageWrites.length;window.__eventsAtBoundary=window.__rosterEvents.length;window.__mlsSessionEpoch=72;window.__testToken='token-B';window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{reason:'forced-same-email'}}));});
    const boundary=await page.evaluate(()=>({raw:window.__schedRaw,debug:window.__mlsProviderRoster._debugOwner(),diag:window.__mlsProviderRoster.getDiag()}));
    eq(boundary.raw,null,'boundary retained unowned __schedRaw patient rows');eq(boundary.debug.armedRequestId,'','boundary retained the armed A request');eq(boundary.debug.cacheCount,0,'boundary retained A request cache');eq(boundary.debug.hasReceipt,false,'boundary retained the in-memory A receipt');eq(boundary.diag,null,'boundary retained the A diagnostic banner');
    await page.evaluate(()=>{window.__arm('req-B');const b=window.__result('req-B','Beta');window.dispatchEvent(new MessageEvent('message',{data:{source:'mls-ext',type:'mlsAppScheduleResult',resp:b},origin:'https://evil.example',source:window}));window.dispatchEvent(new MessageEvent('message',{data:{source:'mls-ext',type:'mlsAppScheduleResult',resp:b},origin:location.origin,source:null}));window.__post(window.__result('req-A-late','LateAlpha'));window.__schedRaw=window.__result('req-A-late','RawAlpha');window.__rawVerdict=window.__mlsProviderRoster.sweepSchedRaw();window.__mlsProviderRoster.merge([{id:'late-direct',name:'Late Direct, MD'}],'backend-calendar',window.__oldRosterOwner);});
    await page.waitForTimeout(80);
    const ignored=await page.evaluate(()=>({writes:window.__storageWrites.length,events:window.__rosterEvents.length,rawVerdict:window.__rawVerdict,diag:window.__mlsProviderRoster.getDiag(),calendar:(window._calProviders||[]).map(x=>x.name)}));
    eq(ignored.writes,await page.evaluate(()=>window.__writesAtBoundary),'forged/late/raw A response wrote into the same-email B namespace');eq(ignored.events,await page.evaluate(()=>window.__eventsAtBoundary),'forged/late/raw A response published a B event');eq(ignored.rawVerdict.reason,'unowned-raw-replay-disabled','raw replay was not fail-closed');eq(ignored.diag,null,'late A repainted the provider diagnostic under B');ok(!ignored.calendar.some(x=>/Late|RawAlpha/.test(x)),'late A widened/mutated B calendar providers');
    await page.evaluate(()=>window.__post(window.__result('req-B','Beta')));await page.waitForFunction(()=>window.__rosterEvents.length===2);
    const fresh=await page.evaluate(()=>({receipt:window.__mlsProviderRoster.getReceipt(),names:window.__mlsProviderRoster.list().map(x=>x.name),writes:window.__storageWrites.filter(x=>x.epoch===72).length}));
    eq(fresh.receipt.requestId,'req-B','fresh B receipt did not bind to B request');ok(fresh.names.includes('Beta Synthetic, MD'),'fresh B provider was not accepted');ok(!fresh.names.some(x=>/Late|RawAlpha/.test(x)),'late A provider leaked into B');ok(fresh.writes>0,'fresh B could not persist after the boundary');

    /* Logout publishes the empty authoritative account before its old bearer
       token is removed. That transition must be dormant even if old code calls
       the current API during the small token-lingering window. */
    const dormant=await page.evaluate(()=>{const api=window.__mlsProviderRoster,beforeW=window.__storageWrites.length,beforeE=window.__rosterEvents.length;window.__mlsSessionAccount='';window.__mlsSessionEpoch=73;window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{reason:'logout'}}));const owner=api._captureOwner('logged-out');const merged=api.merge([{id:'logout-write',name:'Logout Write, MD'}],'backend-calendar',owner);const armed=api.beginOperation({targetDate:'2026-08-13',requestId:'logout-read',providerMode:'all',requestedProviderId:'',requestedProviderStableKey:''});return {current:api._ownerCurrent(owner),merged,armed,writes:window.__storageWrites.length-beforeW,events:window.__rosterEvents.length-beforeE};});
    eq(dormant.current,false,'empty-account owner remained operational while the old token lingered');eq(dormant.merged.length,0,'logged-out merge exposed or returned account roster data');eq(dormant.armed,null,'logged-out owner armed a schedule read');eq(dormant.writes,0,'logged-out owner wrote provider state');eq(dormant.events,0,'logged-out owner published provider state');
    await page.evaluate(()=>{window.__testToken='token-C';window.__mlsSessionAccount='same-email@example.test';window.__mlsSessionEpoch=74;window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{reason:'reauth'}}));});

    /* Hot P1->P1 refresh: saved stale controller/API/onload references are inert
       after the new exact token owner installs. */
    await page.evaluate(()=>{window.__oldCtl=window.__mlsP1ProviderRosterLoader;window.__oldApi=window.__mlsProviderRoster;window.__oldOwner=window.__oldApi._captureOwner('old-api');window.__oldNode=window.__oldCtl.node;window.__oldOnload=window.__oldNode.onload;window.__oldCtl.revert();const s=document.createElement('script');s.src='/loader.js?refresh=1';document.body.appendChild(s);});
    await page.waitForFunction(()=>window.__mlsP1ProviderRosterLoader&&window.__mlsP1ProviderRosterLoader!==window.__oldCtl&&window.__mlsP1ProviderRosterLoader.state==='ready');
    const stale=await page.evaluate(()=>{const before=window.__storageWrites.length;const ensure=window.__oldCtl.ensure(),ctlRevert=window.__oldCtl.revert(),apiRevert=window.__oldApi.revert(),boundary=window.__oldApi._sessionBoundary();window.__oldApi.merge([{id:'stale',name:'Stale Owner, MD'}],'backend-calendar',window.__oldOwner);window.__oldOnload();return {ensure,ctlRevert,apiRevert,boundary,writes:window.__storageWrites.length-before,newReady:window.__mlsProviderRoster.installed&&window.__mlsProviderRoster!==window.__oldApi};});
    eq(stale.ensure,false,'stale controller reopened');eq(stale.ctlRevert,false,'stale controller reverted the replacement');eq(stale.apiRevert,false,'stale roster API reverted the replacement');eq(stale.boundary,false,'stale roster API cleared the replacement session');eq(stale.writes,0,'stale roster API wrote after replacement');eq(stale.newReady,true,'stale callback damaged the new roster owner');
    await page.evaluate(()=>{window.__arm('req-B-fresh-2');window.__post(window.__result('req-B-fresh-2','Gamma'));});await page.waitForFunction(()=>window.__mlsProviderRoster.getReceipt()&&window.__mlsProviderRoster.getReceipt().requestId==='req-B-fresh-2');
    ok((await page.evaluate(()=>window.__mlsProviderRoster.list().map(x=>x.name))).includes('Gamma Synthetic, MD'),'replacement owner could not start a fresh B operation');eq(pageErrors.length,0,'provider runtime raised page errors: '+pageErrors.join(' | '));await page.close();

    const malformed=await browser.newPage();await malformed.goto(base+'/?mode=malformed-controller',{waitUntil:'load'});await malformed.waitForFunction(()=>window.__mlsP1ProviderRosterLoader&&window.__mlsP1ProviderRosterLoader.state==='ready'&&window.__mlsProviderRoster&&window.__mlsProviderRoster.version==='p1-provider-roster-1.0.0');const replaced=await malformed.evaluate(()=>({controller:window.__reverts.controller,token:window.__mlsProviderRoster.installToken===window.__mlsP1ProviderRosterLoader.installToken,methods:typeof window.__mlsProviderRoster.beginOperation==='function'&&typeof window.__mlsProviderRoster._ownerCurrent==='function'}));eq(replaced.controller,1,'malformed same-version controller was trusted without an exact runtime');eq(replaced.token,true,'replacement after malformed controller lost exact token ownership');eq(replaced.methods,true,'replacement after malformed controller is not shape complete');await malformed.close();

    for(const mode of ['bad-picker','bad-roster']){const p=await browser.newPage();await p.goto(base+'/?mode='+mode,{waitUntil:'load'});await p.waitForFunction(()=>window.__mlsP1ProviderRosterLoader&&/^blocked-/.test(window.__mlsP1ProviderRosterLoader.state));const blocked=await p.evaluate(()=>({state:window.__mlsP1ProviderRosterLoader.state,p1:window.__mlsProviderRoster&&window.__mlsProviderRoster.version==='p1-provider-roster-1.0.0',scripts:document.querySelectorAll('script[src*="1p-feat_athena_provider_roster.js"]').length}));eq(blocked.state,mode==='bad-picker'?'blocked-picker':'blocked-owner',mode+' did not fail closed');eq(blocked.p1,false,mode+' installed a competing P1 owner');eq(blocked.scripts,0,mode+' started the P1 asset despite an unrevertible owner');await p.close();}
  }catch(e){failure=e;}
  await browser.close();await new Promise(resolve=>server.close(resolve));if(failure)throw failure;
  console.log('PASS P1 provider roster session/loader runtime: '+checks+' assertions');
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1);});
