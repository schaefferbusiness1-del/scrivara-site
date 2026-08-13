'use strict';

/* P1 STUDY SESSION OWNER + ACCESSIBLE MODAL RUNTIME
 * Synthetic identities only. Real Chrome executes the actual Study IIFE and
 * occurrence asset. No request reaches Athena, MLS, or any backend.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const connector = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const occurrence = fs.readFileSync(path.join(root, '1p-feat_mls_athena_occurrence.js'), 'utf8');
const moduleMark = connector.indexOf('/* ---- module: feat_study.js ---- */');
const studyStart = connector.indexOf('(function(){', moduleMark);
const studyEnd = connector.indexOf('/* ---- module: feat_tab_memory.js ---- */', studyStart);
assert(moduleMark >= 0 && studyStart >= 0 && studyEnd > studyStart, 'could not isolate the real Study module');
const study = connector.slice(studyStart, studyEnd);
const grabMark = connector.indexOf('Mode C: AUTOPILOT grab by procedure');
const grabStart = connector.indexOf('(function(){', grabMark);
const nextUpMark = connector.indexOf('feat_nextup_connect.js', grabStart);
const grabEnd = connector.lastIndexOf('/*', nextUpMark);
assert(grabMark >= 0 && grabStart >= 0 && grabEnd > grabStart, 'could not isolate the real Study Grab module');
const grab = connector.slice(grabStart, grabEnd);

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }
function eq(a, b, m) { assert.strictEqual(a, b, m); checks++; }

function html() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main id="appShell" aria-hidden="false"><button id="exactOpener" type="button">Open Study</button><span id="toolbar"><button id="ptPullAthenaBtn" type="button">Pull</button></span></main>
    <aside id="preHidden" aria-hidden="true" inert>pre-hidden</aside>
    <script>
      window.__MLS_P1_PREVIEW={enabled:true};
      window.__mlsSessionEpoch=41; window.__mlsSessionAccount='same-email@example.test'; window.__testToken='token-A';
      window.bkToken=()=>window.__testToken; window.__patients=[]; window.getPatients=()=>window.__patients;
      window.uns=(key)=>'synthetic:'+key; window.toast=()=>{}; window.renderPatients=()=>{}; window.loadCalendar=()=>{window.__calendarLoads++;};
      window.__calendarLoads=0; window.__calendarWrites=0; window._importPulledSchedule=()=>{window.__calendarWrites++;return Promise.resolve(true);};
      window.fetch=()=>Promise.resolve({ok:false,status:404,json:()=>Promise.resolve({available:false})});
      localStorage.setItem('sf_bk_token','token-A');
      window.__lease=''; window.__leaseSeq=0;
      window.__mlsP1AthenaReadLease={
        claim(){if(window.__lease)return null;window.__lease='study-lease-'+(++window.__leaseSeq);return window.__lease;},
        ready(t){return Promise.resolve(t===window.__lease);}, owns(t){return t===window.__lease;}, touch(t){return t===window.__lease;},
        release(t){if(t!==window.__lease)return false;window.__lease='';return true;}
      };
      window.__chartReads=[]; window.__saves=[]; window.__historyWrites=[]; window.__parseCalls=0; window.__grabSearchCalls=0;
      window._assistReadChart=(target)=>{const row={target};row.promise=new Promise(resolve=>{row.resolve=resolve;});window.__chartReads.push(row);return row.promise;};
      window.__resolveChart=(index,marker)=>{const row=window.__chartReads[index];if(!row||row.done)return false;row.done=true;row.resolve({text:'synthetic chart '+marker,url:'https://athena.invalid/chart',requestId:'chart-'+marker,chartName:row.target.name,chartDob:row.target.dob,chartMrn:row.target.patientId});return true;};
      window._athenaChartTextForParse=(r)=>r.text;
      window._parsePatientChart=(text)=>{window.__parseCalls++;return Promise.resolve({text,coverage:{}});};
      window._athenaChartProfileCoverage=()=>({complete:true});
      window._athenaNewPatientVerifiedRef=(row,observed)=>({patientId:'saved-'+row.patientId,name:row.name,dob:row.dob,observed});
      window._savePatientChart=(ref)=>{const receipt={id:ref.patientId,account:window.__mlsSessionAccount,epoch:window.__mlsSessionEpoch,token:window.__testToken};window.__saves.push(receipt);window.__historyWrites.push(receipt);return true;};
      window.__mlsP1AthenaOccurrenceLoader={installed:true,version:'p1-athena-occurrence-1.0.0',installToken:'occ-runtime'};
    </script>
    <script src="/occurrence.js" data-mls-asset="feat_mls_athena_occurrence.js" data-mls-version="p1-athena-occurrence-1.0.0" data-mls-install-token="occ-runtime"></script>
    <script src="/study.js"></script><script src="/grab.js"></script>
  </body></html>`;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      res.setHeader('Cache-Control', 'no-store');
      if (pathname === '/study.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(study); }
      if (pathname === '/grab.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(grab); }
      if (pathname === '/occurrence.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(occurrence); }
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html());
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let failure = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
    await page.goto('http://127.0.0.1:' + server.address().port + '/', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__mlsStudy && window.__mlsGrab && window.__mlsAthenaOccurrence);

    /* Labelled dialog, initial focus, two-way trap, late siblings and exact
       restoration through both Escape and the visible Close control. */
    await page.evaluate(() => { document.getElementById('exactOpener').focus(); window.__mlsStudy.open('A'); });
    await page.waitForSelector('#mlsStudyOv');
    const modal = await page.evaluate(() => {
      const dialog=document.querySelector('#mlsStudyOv [role="dialog"]');
      return {role:dialog&&dialog.getAttribute('role'),modal:dialog&&dialog.getAttribute('aria-modal'),label:dialog&&dialog.getAttribute('aria-labelledby'),
        activeInside:dialog&&dialog.contains(document.activeElement),appAria:document.getElementById('appShell').getAttribute('aria-hidden'),
        appInert:document.getElementById('appShell').hasAttribute('inert'),preAria:document.getElementById('preHidden').getAttribute('aria-hidden'),preInert:document.getElementById('preHidden').hasAttribute('inert')};
    });
    eq(modal.role, 'dialog', 'Study card has no dialog role'); eq(modal.modal, 'true', 'Study card is not modal'); eq(modal.label, 'mlsStudyTitle', 'Study dialog label is not its visible title');
    eq(modal.activeInside, true, 'initial focus did not move into Study'); eq(modal.appAria, 'true', 'background was not aria-hidden'); eq(modal.appInert, true, 'background was not inert');
    eq(modal.preAria, 'true', 'pre-hidden sibling lost aria state while modal was open'); eq(modal.preInert, true, 'pre-inert sibling lost inert state while modal was open');
    await page.evaluate(() => { const late=document.createElement('section');late.id='lateSibling';late.setAttribute('aria-hidden','false');document.body.appendChild(late); });
    await page.waitForFunction(() => document.getElementById('lateSibling').hasAttribute('inert'));
    const trap = await page.evaluate(() => { const o=document.getElementById('mlsStudyOv');const f=[...o.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];f[f.length-1].focus();return {first:f[0].className,lastId:f[f.length-1].id}; });
    await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement.className), trap.first, 'Tab escaped past the last Study control');
    await page.keyboard.press('Shift+Tab'); eq(await page.evaluate(() => document.activeElement.id), trap.lastId, 'Shift+Tab did not wrap to the last Study control');
    await page.keyboard.press('Escape');
    const restoredEscape = await page.evaluate(() => ({overlay:!!document.getElementById('mlsStudyOv'),focus:document.activeElement&&document.activeElement.id,appAria:document.getElementById('appShell').getAttribute('aria-hidden'),appInert:document.getElementById('appShell').hasAttribute('inert'),lateAria:document.getElementById('lateSibling').getAttribute('aria-hidden'),lateInert:document.getElementById('lateSibling').hasAttribute('inert')}));
    eq(restoredEscape.overlay,false,'Escape did not close Study');eq(restoredEscape.focus,'exactOpener','Escape did not restore the opener');eq(restoredEscape.appAria,'false','Escape did not exactly restore background aria');eq(restoredEscape.appInert,false,'Escape did not restore background inert');eq(restoredEscape.lateAria,'false','Escape did not restore late-sibling aria');eq(restoredEscape.lateInert,false,'Escape did not restore late-sibling inert');
    await page.evaluate(() => { document.getElementById('exactOpener').focus();window.__mlsStudy.open('A'); });
    await page.locator('#mlsStudyOv .mls-study-x').click();
    eq(await page.evaluate(() => document.activeElement&&document.activeElement.id),'exactOpener','Close did not restore the opener');

    /* One completed A import is legitimate. A second pending import crosses a
       forced same-email boundary: the detached DOM is scrubbed, B cannot steal
       A's quarantined reader, late A is silent, and a fresh B import succeeds. */
    const first = await page.evaluate(() => { const api=window.__mlsStudy,owner=api._captureOwner('completed-A',false);window.__pA1=api._importRow({name:'Synthetic Alpha',dob:'01/02/1980',patientId:'A-1'},'',{isCurrent:()=>api._ownerCurrent(owner,false)});return true; });
    ok(first,'completed A import did not start'); await page.waitForFunction(() => window.__chartReads.length===1); await page.evaluate(() => window.__resolveChart(0,'A1'));
    const firstResult=await page.evaluate(() => window.__pA1);eq(firstResult.code,'imported','completed A import did not use the canonical importer');eq((await page.evaluate(() => window.__saves.length)),1,'completed A import did not persist exactly once');

    await page.evaluate(() => { document.getElementById('exactOpener').focus();window.__mlsStudy.open('B'); });
    await page.waitForSelector('#mlsGrabAthenaBtn');
    await page.evaluate(() => {window.__oldGrabBtn=document.getElementById('mlsGrabAthenaBtn');window.__oldGrabSec=window.__oldGrabBtn.closest('.mls-study-sec');window.__mlsStudy._assistSearchProcedure=()=>{window.__grabSearchCalls++;return Promise.resolve({text:'Synthetic stale result'});};document.getElementById('mlsStudyBProc').value='Synthetic Pending, 03/04/1970';document.getElementById('mlsStudyBFindOut').innerHTML='<div class="mls-study-row"><span class="mls-study-rn">Synthetic Pending</span><span class="mls-study-rd">03/04/1970</span></div>';window.__oldStudyInput=document.getElementById('mlsStudyBProc');window.__oldStudyResults=document.getElementById('mlsStudyBFindOut');const api=window.__mlsStudy,owner=api._captureOwner('pending-A',false);window.__pA2=api._importRow({name:'Synthetic Pending',dob:'03/04/1970',patientId:'A-2'},'',{isCurrent:()=>api._ownerCurrent(owner,false)}); });
    await page.waitForFunction(() => window.__chartReads.length===2);
    await page.evaluate(() => { window.__mlsSessionEpoch=42;window.__testToken='token-B';localStorage.setItem('sf_bk_token','token-B');window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{reason:'forced-same-email'}})); });
    const scrubbed=await page.evaluate(() => ({overlay:!!document.getElementById('mlsStudyOv'),input:window.__oldStudyInput.value,results:window.__oldStudyResults.textContent,gen:window.__mlsStudy._debugOwner().generation}));
    eq(scrubbed.overlay,false,'session boundary left Study open');eq(scrubbed.input,'','session boundary retained pasted patient text');eq(scrubbed.results,'','session boundary retained result names/DOBs');ok(scrubbed.gen>1,'same-email boundary did not advance the Study generation');
    const blockedB=await page.evaluate(() => { const api=window.__mlsStudy,owner=api._captureOwner('blocked-B',false);return api._importRow({name:'Synthetic Beta',dob:'05/06/1985',patientId:'B-0'},'',{isCurrent:()=>api._ownerCurrent(owner,false)}); });
    eq(blockedB.code,'failed','B stole the still-quarantined A reader');eq(await page.evaluate(() => window.__chartReads.length),2,'blocked B dispatched an overlapping chart read');
    await page.evaluate(() => window.__resolveChart(1,'late-A2'));
    await page.evaluate(() => {window.__oldGrabBtn.click();window.__mlsGrab._runGrab(window.__oldGrabSec);});await page.waitForTimeout(30);eq(await page.evaluate(() => window.__grabSearchCalls),0,'detached Account-A Grab controls recaptured Account B');
    const lateA=await page.evaluate(() => window.__pA2);eq(lateA.code,'failed','late A completion was accepted under B');eq(await page.evaluate(() => window.__saves.length),1,'late A performed a B-session import');eq(await page.evaluate(() => window.__historyWrites.length),1,'late A persisted chart history under B');eq(await page.evaluate(() => window.__parseCalls),1,'late A entered chart parsing under B');eq(await page.evaluate(() => window.__calendarWrites),0,'late A performed a calendar write under B');
    await page.evaluate(() => { const api=window.__mlsStudy,owner=api._captureOwner('fresh-B',false);window.__pB=api._importRow({name:'Synthetic Beta',dob:'05/06/1985',patientId:'B-1'},'',{isCurrent:()=>api._ownerCurrent(owner,false)}); });
    await page.waitForFunction(() => window.__chartReads.length===3);await page.evaluate(() => window.__resolveChart(2,'B1'));
    const freshB=await page.evaluate(() => window.__pB);eq(freshB.code,'imported','fresh B operation did not start after A terminal');
    const saves=await page.evaluate(() => window.__saves);eq(saves.length,2,'fresh B did not persist exactly once');eq(saves[1].token,'token-B','fresh B persisted with the wrong session token');

    const dormant=await page.evaluate(() => {window.__mlsSessionAccount='';window.__mlsSessionEpoch=43;window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{reason:'logout'}}));const owner=window.__mlsStudy._captureOwner('logged-out',false);return {current:window.__mlsStudy._ownerCurrent(owner,false),opened:window.__mlsStudy.open('A'),overlay:!!document.getElementById('mlsStudyOv')};});
    eq(dormant.current,false,'empty-account Study owner remained operational while the old token lingered');eq(dormant.opened,false,'logged-out Study reopened with a lingering old token');eq(dormant.overlay,false,'logged-out Study painted patient UI');
    await page.evaluate(() => {window.__testToken='token-C';localStorage.setItem('sf_bk_token','token-C');window.__mlsSessionAccount='same-email@example.test';window.__mlsSessionEpoch=44;window.dispatchEvent(new CustomEvent('mls:session-boundary',{detail:{reason:'reauth'}}));});

    /* Real DOM lifecycle: the authenticated occurrence owner is loaded before
       Study, then mounts after Mode B creates its anchor. This reproduces the
       actual timing and disproves the isolated-world undefined-global signal. */
    await page.evaluate(() => window.__mlsStudy.open('B'));
    await page.waitForSelector('#mlsOccPanel');
    eq(await page.evaluate(() => !!document.querySelector('#mlsStudyOv #mlsOccPanel')),true,'occurrence panel did not mount inside a real Study Mode-B lifecycle');
    await page.evaluate(() => window.__mlsStudy.close());
    await page.waitForFunction(() => !document.getElementById('mlsOccPanel'));
    eq(pageErrors.length,0,'real Study runtime raised page errors: '+pageErrors.join(' | '));
    await page.close();
  } catch (e) { failure=e; }
  await browser.close(); await new Promise(resolve => server.close(resolve));
  if (failure) throw failure;
  console.log('PASS P1 Study session/modal runtime: '+checks+' assertions');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
