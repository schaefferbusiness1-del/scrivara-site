'use strict';
/* Resilience honesty (resil-1.0.0). Found by the resilience hunt against
   /ScribeFlow.html with every backend call stubbed, and re-reproduced before the
   fix:
     1. a 502 / 500 / no answer at sign-in showed "Not switched on yet - ask your
        MLS administrator" about a check that never ran;
     2. the lock screen's "Log out" took the FORCED path and purged a note the
        server never accepted, with no warning;
     3. an expired token purged un-synced notes, and the sign-in card then said
        "nothing was lost" (page load) or nothing at all (mid-session);
     4. the calendar month grid never painted with 0 appointments, and
        "Loading appointments..." stayed forever (also on a 502);
     5. on a phone the offline banner covered the header: Account and the mode
        chip could not be tapped;
     6. "Check workspace access again" stayed on "Checking..." forever when the
        backend did not answer.
   And two regressions a review of that fix measured:
     7. a Retry still running when the doctor logged out re-raised the lock
        screen over the sign-in card (and, after signing back in, over the new
        session's app) when its bound ran out;
     8. the public sample workspace (?preview=1) showed the red "MLS server
        could not be reached" calendar alert - it has no MLS server at all.
   Real Chrome, synthetic account and synthetic note only, every backend call
   answered by page routes (502, 500, 401, never-answering, healthy). */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const API='https://scrivara-backend.onrender.com';
const EM='dr.synthetic@example.test';
const NOTE={id:'n-synth-1',patientId:'p-synth-1',patientName:'Synthetic Patient',created:Date.now()-60000,updated:Date.now()-60000,note:{hpi:'Synthetic un-synced visit note text'}};

const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const base='http://127.0.0.1:'+srv.address().port;
 const b=await chromium.launch({args:['--no-sandbox']});
 const cors={'access-control-allow-origin':'*'};
 const user={email:EM,name:'Dr Synthetic',role:'doctor',hasAccess:true,agreements:{required:false},readiness:{state:'ready',reasons:[]}};
 /* One stub per context; `st.mode` switches the whole backend at runtime. */
 async function open(opts){
  opts=opts||{};
  const ctx=await b.newContext(opts.phone?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1400,height:900}});
  if(opts.seed) await ctx.addInitScript(s=>{ try{ if(localStorage.getItem('__seededOnce')) return; localStorage.setItem('__seededOnce','1');
    localStorage.setItem('sf_bk_token','synthetic.test.token'); localStorage.setItem('sf_session',s.em);
    localStorage.setItem('sf_shared_workstation','0'); localStorage.setItem('sf_shared_workstation_asked','1');
    const P='sf_u::'+s.em+'::';
    if(s.note){ localStorage.setItem(P+'notes',JSON.stringify([s.note])); localStorage.setItem(P+'pendingBackup',JSON.stringify([s.note.id])); localStorage.setItem(P+'practiceName','Synthetic Clinic'); }
  }catch(e){} },{em:EM,note:opts.note?NOTE:null});
  const st={mode:opts.mode||'ok',appts:'ok',recordsPost:'ok',posts:[],pending:[]};
  await ctx.route(API+'/**',async route=>{
   const req=route.request(), u=new URL(req.url()), p=u.pathname, m=req.method();
   if(m==='POST'&&p==='/api/records'){ try{ st.posts.push(JSON.parse(req.postData()||'{}')); }catch(e){} }
   if(st.mode==='hang'){ st.pending.push(route); return; }
   if(st.mode==='502') return route.fulfill({status:502,headers:cors,contentType:'text/html',body:'<html><body><h1>502 Bad Gateway</h1></body></html>'});
   if(st.mode==='500') return route.fulfill({status:500,headers:cors,contentType:'application/json',body:'{"ok":false,"error":"Internal server error"}'});
   if(st.mode==='401') return route.fulfill({status:401,headers:cors,contentType:'application/json',body:'{"error":"Invalid or expired token"}'});
   const J=(o,s)=>route.fulfill({status:s||200,headers:cors,contentType:'application/json',body:JSON.stringify(o)});
   if(p==='/api/me') return J({user,practice:{name:'Synthetic Clinic'},calendarEnabled:true});
   /* 'policy': the server ANSWERS, and its answer is "not released" (a stale agreement). */
   if(p==='/api/agreements/me') return J(st.mode==='policy'?{signed:true,version:'2026-06-09'}:{signed:true,version:'2026-06-10'});
   if(p==='/api/auth/login'&&m==='POST') return J({token:'synthetic.test.token2',user});
   if(p==='/api/records'&&m==='POST') return st.recordsPost==='503'?J({error:'unavailable'},503):st.recordsPost==='403'?J({error:'plan does not allow'},403):J({ok:true});
   if(p==='/api/records') return J({records:[]});
   if(p==='/api/patients') return J({patients:[]});
   if(p==='/api/appointments') return st.appts==='502'?route.fulfill({status:502,headers:cors,contentType:'text/html',body:'<h1>502 Bad Gateway</h1>'}):J({appointments:[]});
   if(p==='/api/prefs') return J({prefs:{}});
   if(p==='/api/health') return J({ok:true});
   return J({error:'not found'},404);
  });
  const pg=await ctx.newPage();
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,200)));
  await pg.goto(base+'/ScribeFlow.html'+(opts.query||''),{waitUntil:'domcontentloaded'});
  const close=async()=>{ for(const r of st.pending.splice(0)){ try{ await r.abort(); }catch(e){} } await ctx.close(); };
  return {ctx,pg,st,errs,close};
 }
 const gateState=pg=>pg.evaluate(()=>{ const v=id=>{const e=document.getElementById(id);return !!(e&&e.getBoundingClientRect().height>0&&getComputedStyle(e).display!=='none');}; const t=id=>{const e=document.getElementById(id);return e?(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim():'';};
  const why=document.querySelector('#agLockedWrap details'); const btn=document.getElementById('agRetryBtn');
  return {gate:v('agreementsGate'),auth:v('authScreen'),title:t('agGateTitleText'),summary:t('agGateSummary'),err:t('agGateErr'),whyShown:!!(why&&why.getBoundingClientRect().height>0),btn:btn?{text:btn.textContent,disabled:btn.disabled}:null}; });
 const store=(pg,em)=>pg.evaluate(em=>{ const P='sf_u::'+em+'::'; const j=k=>{ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } };
  return {token:localStorage.getItem('sf_bk_token')||sessionStorage.getItem('sf_bk_token'),session:sessionStorage.getItem('sf_session')||localStorage.getItem('sf_session'),notes:j(P+'notes'),pending:j(P+'pendingBackup'),practice:localStorage.getItem(P+'practiceName')}; },em);
 const authErr=pg=>pg.evaluate(()=>{ const e=document.getElementById('authErr'); return {text:(e&&e.textContent||'').trim(),shown:!!(e&&e.getBoundingClientRect().height>0)}; });
 async function clickNav(pg,label){
  const h=await pg.evaluateHandle(label=>[...document.querySelectorAll('button,[role=tab],a')].find(e=>{ const r=e.getBoundingClientRect(); return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&(e.innerText||'').replace(/\s+/g,' ').trim().replace(/^\d+\s*/,'').replace(/\s*\d+$/,'')===label; })||null,label);
  const el=h.asElement(); assert.ok(el,'visible nav: '+label); await el.click();
 }
 async function dismissFirstRun(pg){ for(let k=0;k<3;k++){ for(const t of ['Choose later','No, it is mine','Got it','Not now','Maybe later']){ const l=pg.getByText(t,{exact:false}); if(await l.first().isVisible().catch(()=>false)){ await l.first().click({timeout:2000}).catch(()=>{}); await pg.waitForTimeout(400); } } } }
 const failures=[];
 const step=async(name,fn)=>{ try{ await fn(); console.log('  ok  '+name); }catch(e){ failures.push(name+': '+e.message); console.log('  FAIL '+name+'\n       '+e.message.split('\n')[0]); } };

 /* ---- 1 + 6 + 2: outage at sign-in, bounded retry, guarded lock-screen logout ---- */
 await step('outage at sign-in names the outage; retry is bounded; lock-screen Log out warns first',async()=>{
  const {pg,st,close}=await open({seed:true,note:true,mode:'502'});
  try{
   await pg.waitForFunction(()=>{ const g=document.getElementById('agreementsGate'); return g&&g.style.display==='block'; },null,{timeout:40000});
   let s=await gateState(pg);
   assert.notStrictEqual(s.title,'Not switched on yet','a 502 must not read as a policy refusal: '+s.title);
   assert.match(s.summary,/HTTP 502/,'the outage is named: '+s.summary);
   assert.doesNotMatch(s.summary,/Ask your MLS administrator to enable/,'no "ask your administrator" for an outage');
   assert.strictEqual(s.whyShown,false,'the "why signing in worked" explainer describes a refusal, not an outage');
   /* 6. backend stops answering: the retry is bounded and restores the button */
   st.mode='hang'; await pg.evaluate(()=>{ window.SF_GATE_RETRY_MS=4000; });
   await pg.click('#agRetryBtn'); await pg.waitForTimeout(800);
   s=await gateState(pg); assert.strictEqual(s.btn.disabled,true,'the retry is in flight');
   await pg.waitForFunction(()=>!document.getElementById('agRetryBtn').disabled,null,{timeout:15000});
   s=await gateState(pg);
   assert.strictEqual(s.btn.text,'Check workspace access again','the button label recovers: '+s.btn.text);
   assert.match(s.err,/did not answer within 4 seconds/,'the bound names what happened: '+s.err);
   assert.doesNotMatch(s.err,/not enabled/,'a timeout is not "not enabled"');
   assert.strictEqual(s.title,'MLS did not answer');
   for(const r of st.pending.splice(0)){ try{ await r.abort(); }catch(e){} }
   /* control: the server ANSWERS "not released" -> the policy copy is unchanged */
   st.mode='policy'; await pg.click('#agRetryBtn');
   await pg.waitForFunction(()=>!document.getElementById('agRetryBtn').disabled&&/still not enabled/.test(document.getElementById('agGateErr').textContent),null,{timeout:15000});
   s=await gateState(pg);
   assert.strictEqual(s.title,'Not switched on yet','a real refusal still says so');
   assert.match(s.summary,/Ask your MLS administrator/); assert.strictEqual(s.whyShown,true);
   /* 2. lock-screen Log out with a note the server never accepted */
   st.mode='502';
   await pg.click('#agLogoutLink'); await pg.waitForTimeout(700);
   const dlg=await pg.evaluate(()=>{ const d=document.querySelector('#_mlsAskDialog [role=dialog]'); return d?d.innerText.replace(/\s+/g,' '):''; });
   assert.match(dlg,/1 note on this device has NOT been backed up/,'the lock screen warns before purging: '+dlg);
   let k=await store(pg,EM);
   assert.deepStrictEqual(k.pending,['n-synth-1'],'nothing is purged while the warning is open'); assert.ok(k.token);
   await pg.click('#_mlsAskNo'); await pg.waitForTimeout(600);
   s=await gateState(pg); k=await store(pg,EM);
   assert.strictEqual(s.gate,true,'Cancel keeps the gate'); assert.ok(k.token,'Cancel keeps the session'); assert.strictEqual(k.notes.length,1,'Cancel keeps the note');
   await pg.click('#agLogoutLink'); await pg.waitForTimeout(600); await pg.click('#_mlsAskYes'); await pg.waitForTimeout(1200);
   s=await gateState(pg); k=await store(pg,EM);
   assert.strictEqual(k.token,null,'a confirmed Log out still ends the session'); assert.strictEqual(s.auth,true); assert.strictEqual(s.gate,false);
  }finally{ await close(); }
 });

 await step('500 and no answer at sign-in also name the outage',async()=>{
  const a=await open({seed:true,mode:'500'}); const h=await open({seed:true,mode:'hang'});
  try{
   await a.pg.waitForFunction(()=>{ const g=document.getElementById('agreementsGate'); return g&&g.style.display==='block'; },null,{timeout:40000});
   const s5=await gateState(a.pg); assert.match(s5.summary,/HTTP 500/,s5.summary); assert.notStrictEqual(s5.title,'Not switched on yet');
   await h.pg.waitForFunction(()=>{ const g=document.getElementById('agreementsGate'); return g&&g.style.display==='block'; },null,{timeout:60000});
   const sh=await gateState(h.pg); assert.strictEqual(sh.title,'MLS did not answer'); assert.match(sh.summary,/within 10 seconds/,sh.summary);
  }finally{ await a.close(); await h.close(); }
 });

 /* ---- 3 (page load): expiry keeps the un-synced note, ends the session, says so; re-login backs it up ---- */
 await step('expired token at page load: session ends and purges (owner rule), and the card names the un-synced note that was removed',async()=>{
  const {pg,st,close}=await open({seed:true,note:true,mode:'401'});
  try{
   await pg.waitForFunction(()=>/Your session ended/.test((document.getElementById('authErr')||{}).textContent||''),null,{timeout:30000});
   const e=await authErr(pg), k=await store(pg,EM);
   assert.strictEqual(k.token,null,'the dead token is gone'); assert.strictEqual(k.session,null,'the session is gone');
   assert.strictEqual(k.practice,null,'the rest of the account namespace is still purged');
   /* synctruth-1.0.0 (owner): sign-out purges local clinical state by design */
   assert.ok(!(k.notes||[]).length,'the forced sign-out still purges the account namespace (shared workstations)');
   assert.ok(e.shown,'the reason is on the sign-in card');
   assert.match(e.text,/1 note that had not been backed up to your account was removed from this device/,e.text);
   assert.doesNotMatch(e.text,/nothing was lost|Your work is saved/,'never claims nothing was lost');
  }finally{ await close(); }
 });

 /* ---- 4 + 3 (mid-session): calendar grid and failure notice, then expiry mid-session ---- */
 await step('calendar paints an empty month, names a failed read with Try again; mid-session expiry says why',async()=>{
  const {pg,st,close}=await open({seed:true});
  try{
   await pg.waitForFunction(()=>{ const a=document.getElementById('appScreen'); return a&&getComputedStyle(a).display!=='none'&&!document.documentElement.classList.contains('mls-secure-loading'); },null,{timeout:60000});
   await pg.waitForTimeout(3000); await dismissFirstRun(pg);
   await clickNav(pg,'Calendar'); await pg.waitForTimeout(3500);
   const grid=()=>pg.evaluate(()=>{ const g=document.getElementById('calGrid'), n=document.getElementById('calLoadNotice');
    return {text:(g.innerText||'').replace(/\s+/g,' '),days:g.querySelectorAll('[onclick^="calOpenDay"]').length,notice:n&&n.getBoundingClientRect().height>0?n.innerText.replace(/\s+/g,' '):'',empty:!!document.getElementById('mlsT3Empty')}; });
   let g=await grid();
   assert.ok(g.days>=28,'0 appointments still paints the month grid: '+g.days+' cells');
   assert.match(g.text,/Sun Mon Tue Wed Thu Fri Sat/); assert.doesNotMatch(g.text,/Loading appointments/,'no stale placeholder');
   st.appts='502';
   await pg.click('#mlsT3Empty .t3e-rf'); await pg.waitForTimeout(3000);
   g=await grid();
   assert.match(g.notice,/Appointments could not be loaded: the MLS server answered with an error \(HTTP 502\)/,'the failure is named: '+g.notice);
   assert.match(g.notice,/Try again/); assert.strictEqual(g.empty,false,'no "No appointments this month" after a failed read');
   assert.ok(g.days>=28,'the grid stays painted'); assert.doesNotMatch(g.text,/Loading appointments/);
   st.appts='ok';
   await pg.click('#calLoadRetry'); await pg.waitForTimeout(3000);
   g=await grid(); assert.strictEqual(g.notice,'','a good read clears the notice'); assert.ok(g.days>=28);
   /* a save the server did not take, then the token dies mid-session */
   st.recordsPost='503';
   const q=await pg.evaluate(async n=>{ saveNotes(getNotes().concat([n])); return await saveNoteToBackend(n); },Object.assign({},NOTE,{id:'n-mid-1'}));
   assert.strictEqual(q,'queued');
   st.recordsPost='403'; /* and one the server REFUSED (device-only) */
   const q2=await pg.evaluate(async n=>{ saveNotes(getNotes().concat([n])); return await saveNoteToBackend(n); },Object.assign({},NOTE,{id:'n-mid-2'}));
   assert.strictEqual(q2,'declined');
   st.mode='401';
   await pg.click('#mlsT3Empty .t3e-rf').catch(()=>pg.evaluate(()=>loadCalendar()));
   await pg.waitForFunction(()=>/Your session ended/.test((document.getElementById('authErr')||{}).textContent||''),null,{timeout:20000});
   const e=await authErr(pg), k=await store(pg,EM);
   assert.ok(e.shown,'mid-session the sign-in card says why'); assert.match(e.text,/2 notes that had not been backed up to your account were removed from this device/,e.text);
   assert.strictEqual(k.token,null,'the session ended'); assert.ok(!(k.notes||[]).length,'and purged, as the owner rule requires');
  }finally{ await close(); }
 });

 /* ---- 7: a retry belongs to the session that started it ---- */
 await step('a Retry still running at Log out never re-raises the lock screen (signed out, or signed back in)',async()=>{
  const {pg,st,close}=await open({seed:true,mode:'502'});
  try{
   await pg.waitForFunction(()=>{ const g=document.getElementById('agreementsGate'); return g&&g.style.display==='block'; },null,{timeout:40000});
   st.mode='hang'; await pg.evaluate(()=>{ window.SF_GATE_RETRY_MS=9000; });
   const t0=Date.now();
   await pg.click('#agRetryBtn'); await pg.waitForTimeout(800);
   await pg.click('#agLogoutLink'); await pg.waitForTimeout(1500);
   let s=await gateState(pg), k=await store(pg,EM);
   assert.strictEqual(k.token,null,'Log out ended the session'); assert.strictEqual(s.gate,false); assert.strictEqual(s.auth,true);
   st.mode='ok';
   await pg.fill('#authEmail',EM); await pg.fill('#authPass','Synthetic-Pass-2026'); await pg.click('#authBtn');
   await pg.waitForFunction(()=>{ const a=document.getElementById('appScreen'); return a&&getComputedStyle(a).display!=='none'&&!document.documentElement.classList.contains('mls-secure-loading'); },null,{timeout:40000});
   await pg.waitForTimeout(Math.max(0,11000-(Date.now()-t0))); /* past the old retry's 9s bound */
   s=await gateState(pg);
   const app=await pg.evaluate(()=>({app:getComputedStyle(document.getElementById('appScreen')).display,legal:sfSessionLegalState,live:!!(session&&bkToken())}));
   assert.strictEqual(s.gate,false,'the old retry did not re-raise the lock over the new session: '+s.title+' / '+s.err);
   assert.strictEqual(app.app,'block','the new session\'s app stays visible'); assert.strictEqual(app.legal,'verified'); assert.ok(app.live);
  }finally{ await close(); }
 });
 await step('a 401 on Retry ends the session and takes the lock screen down; the card says why',async()=>{
  const {pg,st,close}=await open({seed:true,note:true,mode:'502'});
  try{
   await pg.waitForFunction(()=>{ const g=document.getElementById('agreementsGate'); return g&&g.style.display==='block'; },null,{timeout:40000});
   st.mode='401'; await pg.click('#agRetryBtn');
   await pg.waitForFunction(()=>/Your session ended/.test((document.getElementById('authErr')||{}).textContent||''),null,{timeout:20000});
   await pg.waitForTimeout(800);
   const s=await gateState(pg), k=await store(pg,EM), e=await authErr(pg);
   assert.strictEqual(k.token,null,'the dead token is gone');
   assert.strictEqual(s.gate,false,'the lock screen no longer covers the sign-in card'); assert.strictEqual(s.auth,true);
   assert.ok(e.shown,'the sign-out reason is visible'); assert.ok(!(k.notes||[]).length,'purged, as the owner rule requires');
   assert.match(e.text,/1 note that had not been backed up to your account was removed from this device/,'the card names the loss: '+e.text);
   assert.doesNotMatch(s.err,/not enabled/,'the hidden gate never claimed "not enabled" for a 401: '+s.err);
  }finally{ await close(); }
 });

 /* ---- 8: the sample workspace has no MLS server to report on ---- */
 await step('sample workspace (?preview=1) calendar shows no server-failure alert and keeps its empty-month state',async()=>{
  const {pg,close}=await open({query:'?preview=1'});
  try{
   await pg.waitForFunction(()=>{ const x=document.getElementById('mlsAccountMenuBtn'); return x&&x.getBoundingClientRect().height>0&&!document.documentElement.classList.contains('mls-secure-loading'); },null,{timeout:60000});
   await pg.waitForTimeout(3000); await dismissFirstRun(pg);
   await clickNav(pg,'Calendar'); await pg.waitForTimeout(3500);
   const snap=()=>pg.evaluate(()=>{ const n=document.getElementById('calLoadNotice'), e=document.getElementById('mlsT3Empty'); return {backend:backendMode(),notice:n&&n.getBoundingClientRect().height>0?n.innerText.replace(/\s+/g,' '):'',empty:!!(e&&e.getBoundingClientRect().height>0),flag:window.__mlsCalendarLoadError}; });
   let r=await snap();
   assert.strictEqual(r.backend,false,'the sample workspace has no backend');
   assert.strictEqual(r.notice,'','no "MLS server could not be reached" in the sample calendar: '+r.notice); assert.ok(!r.flag);
   for(let i=0;i<4;i++){ await pg.evaluate(()=>calNext()); await pg.waitForTimeout(500); }
   r=await snap();
   assert.strictEqual(r.notice,''); assert.strictEqual(r.empty,true,'an empty sample month still gets its empty state');
  }finally{ await close(); }
 });

 /* ---- 5: the offline banner never covers the header ---- */
 await step('offline banner leaves Account and the mode chip tappable (390x844 phone, and desktop)',async()=>{
  for(const phone of [true,false]){
   const {ctx,pg,close}=await open({phone,query:'?preview=1'});
   try{
    await pg.waitForFunction(()=>{ const x=document.getElementById('mlsAccountMenuBtn'), l=document.getElementById('sfGateLoading'), h=document.documentElement.classList;
     return x&&x.getBoundingClientRect().height>0&&!h.contains('mls-secure-loading')&&!h.contains('mls-app-revealing')&&(!l||getComputedStyle(l).display==='none'); },null,{timeout:60000});
    await pg.waitForTimeout(3000);
    await ctx.setOffline(true); await pg.waitForTimeout(1200);
    const r=await pg.evaluate(()=>{ const bar=document.getElementById('mlsOfflineBar'), br=bar.getBoundingClientRect();
     const hit=id=>{ const e=document.getElementById(id), q=e.getBoundingClientRect(), t=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2); return {ok:!!(t&&(t===e||e.contains(t))),top:q.top,cx:q.left+q.width/2,cy:q.top+q.height/2}; };
     return {bar:getComputedStyle(bar).display,barBottom:br.bottom,text:bar.textContent,acct:hit('mlsAccountMenuBtn'),chip:hit('mslChipBtn')}; });
    const tag=phone?'phone':'desktop';
    assert.strictEqual(r.bar,'block',tag+': the offline banner still shows'); assert.match(r.text,/You are offline/);
    assert.ok(r.acct.ok&&r.acct.top>=r.barBottom-1,tag+': Account sits below the banner and is hit-testable '+JSON.stringify(r.acct)+' bar '+r.barBottom);
    assert.ok(r.chip.ok,tag+': the mode chip is hit-testable');
    if(phone) await pg.touchscreen.tap(r.acct.cx,r.acct.cy); else await pg.mouse.click(r.acct.cx,r.acct.cy);
    await pg.waitForTimeout(900);
    const opened=await pg.evaluate(()=>{ const p=document.getElementById('mlsAccountPopover'); return {exp:document.getElementById('mlsAccountMenuBtn').getAttribute('aria-expanded'),pop:!!(p&&p.getBoundingClientRect().height>0)}; });
    assert.strictEqual(opened.exp,'true',tag+': the Account menu opens while offline'); assert.ok(opened.pop,tag+': its popover is on screen');
    await ctx.setOffline(false); await pg.waitForTimeout(900);
    const on=await pg.evaluate(()=>({bar:getComputedStyle(document.getElementById('mlsOfflineBar')).display,cls:document.documentElement.classList.contains('mls-offline-on')}));
    assert.strictEqual(on.bar,'none'); assert.strictEqual(on.cls,false,tag+': the header clearance goes with the banner');
   }finally{ await close(); }
  }
 });

 await b.close(); srv.close();
 if(failures.length){ console.error('FAIL resilience honesty:\n - '+failures.join('\n - ')); process.exit(1); }
 console.log('PASS resilience honesty on /ScribeFlow.html: an outage at sign-in says outage (502/500/no answer) and its retry is bounded, the lock-screen Log out warns before purging, an expired session still purges (owner rule) and the card names what was removed, the calendar paints an empty month and names a failed read with Try again, the offline banner leaves the header tappable, a Retry never outlives its session, and the sample calendar reports no server failure');
});
