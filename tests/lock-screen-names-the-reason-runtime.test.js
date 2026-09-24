'use strict';
/* lockreason-1.0.0 + setupwait-1.0.0. Found by the signup/billing hunt against
   the real backend, and re-measured before the fix:
     1. an ended trial and a cancelled subscription both showed "Not switched on
        yet - Your practice has not been switched on for patient work yet - ask
        your MLS administrator", and the access-code box lives inside the app
        this gate hides, so a code the server would accept had nowhere to go;
     2. every account whose first screen is the lock screen (or the agreements
        ceremony) waited ~32 s on "Still preparing your workspace…", because
        the first-frame wait looked for a UI bundle startSession never loads.
   Real Chrome, synthetic accounts, every backend call answered by page routes. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const API='https://scrivara-backend.onrender.com';
const EM='dr.synthetic@example.test';
let checks=0;
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const base='http://127.0.0.1:'+srv.address().port;
 const b=await chromium.launch({args:['--no-sandbox']});
 const cors={'access-control-allow-origin':'*'};
 const failures=[];
 async function run(name,locked,fn){
  const ctx=await b.newContext({viewport:{width:1300,height:900}});
  await ctx.addInitScript(s=>{ try{ if(localStorage.getItem('__seededOnce')) return; localStorage.setItem('__seededOnce','1');
    localStorage.setItem('sf_bk_token','synthetic.test.token'); localStorage.setItem('sf_session',s.em);
    localStorage.setItem('sf_shared_workstation','0'); localStorage.setItem('sf_shared_workstation_asked','1'); }catch(e){} },{em:EM});
  const st={unlocked:false,redeemed:[]};
  const ready={email:EM,name:'Dr Synthetic',role:'doctor',hasAccess:true,agreements:{required:false},readiness:{state:'ready',reasons:[]}};
  await ctx.route(API+'/**',async route=>{
   const req=route.request(), p=new URL(req.url()).pathname, m=req.method();
   const J=(o,s)=>route.fulfill({status:s||200,headers:cors,contentType:'application/json',body:JSON.stringify(o)});
   if(p==='/api/me') return J({user:st.unlocked?ready:locked,practice:{name:'Synthetic Clinic'},calendarEnabled:true});
   if(p==='/api/redeem'&&m==='POST'){ let c=''; try{ c=JSON.parse(req.postData()||'{}').code; }catch(e){} st.redeemed.push(c); if(String(c).toUpperCase()!=='TRIAL14') return J({error:'That code is not valid.'},404); st.unlocked=true; return J({ok:true,user:ready}); }
   if(p==='/api/agreements/me') return J({signed:true,version:'2026-06-10'});
   if(p==='/api/records') return J({records:[]});
   if(p==='/api/patients') return J({patients:[]});
   if(p==='/api/appointments') return J({appointments:[]});
   if(p==='/api/prefs') return J({prefs:{}});
   if(p==='/api/health') return J({ok:true});
   return J({error:'not found'},404);
  });
  const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,200)));
  const t0=Date.now();
  await pg.goto(base+'/ScribeFlow.html',{waitUntil:'domcontentloaded'});
  try{
   await pg.waitForFunction(()=>{ const g=document.getElementById('agreementsGate'); return g&&g.style.display==='block'&&!document.documentElement.classList.contains('mls-secure-loading'); },null,{timeout:40000});
   const ms=Date.now()-t0;
   await fn(pg,st,ms);
   console.log('  ok  '+name+' ('+ms+' ms to the lock screen)');
  }catch(e){ failures.push(name+': '+e.message); console.log('  FAIL '+name+'\n       '+e.message.split('\n')[0]); }
  finally{ await ctx.close(); }
 }
 const text=(pg,id)=>pg.evaluate(id=>{ const e=document.getElementById(id); return e?(e.innerText||e.textContent||'').replace(/\s+/g,' ').trim():''; },id);
 const past=new Date(Date.now()-3600000).toISOString();
 await run('an ended trial says so, offers the code box, and a code opens the app',{email:EM,name:'Dr Synthetic',role:'doctor',hasAccess:false,access:'active',access_expires:past,agreements:{required:false},readiness:{state:'blocked',reasons:['COMMERCIAL_ACCESS_INACTIVE']}},async(pg,st,ms)=>{
  assert.ok(ms<10000,'the lock screen took '+ms+' ms (the 32 s first-frame wait is back)'); checks++;
  assert.strictEqual(await text(pg,'agGateTitleText'),'Your trial has ended'); checks++;
  assert.doesNotMatch(await text(pg,'agGateSummary'),/not been switched on/,'an ended trial still reads as "not switched on"'); checks++;
  assert.ok(await pg.isVisible('#agRedeemInput'),'no access-code box on the lock screen'); checks++;
  /* a wrong code is refused and the gate stays */
  await pg.fill('#agRedeemInput','nope'); await pg.click('#agRedeemBtn'); await pg.waitForTimeout(800);
  assert.ok(await pg.isVisible('#agreementsGate'),'a refused code opened the app'); checks++;
  await pg.fill('#agRedeemInput','trial14'); await pg.click('#agRedeemBtn');
  await pg.waitForFunction(()=>getComputedStyle(document.getElementById('agreementsGate')).display==='none'&&getComputedStyle(document.getElementById('appScreen')).display!=='none',null,{timeout:30000});
  assert.deepStrictEqual(st.redeemed,['nope','trial14']); checks++;
 });
 await run('a cancelled subscription says the subscription is not active',{email:EM,name:'Dr Synthetic',role:'doctor',hasAccess:false,access:'blocked',access_expires:null,agreements:{required:false},readiness:{state:'blocked',reasons:['COMMERCIAL_ACCESS_INACTIVE']}},async(pg,st,ms)=>{
  assert.ok(ms<10000,'the lock screen took '+ms+' ms'); checks++;
  assert.strictEqual(await text(pg,'agGateTitleText'),'Your subscription is not active'); checks++;
  assert.ok(await pg.isVisible('#agRedeemInput')); checks++;
 });
 await run('an account the owner has not switched on keeps its own wording',{email:EM,name:'Dr Synthetic',role:'doctor',hasAccess:true,agreements:{required:false},readiness:{state:'blocked',reasons:['CLINICAL_APPROVAL_MISSING']}},async(pg,st,ms)=>{
  assert.ok(ms<10000,'the lock screen took '+ms+' ms'); checks++;
  assert.strictEqual(await text(pg,'agGateTitleText'),'Not switched on yet'); checks++;
  assert.ok(!(await pg.isVisible('#agRedeemInput')),'a code box appeared for an approval the owner gives'); checks++;
 });
 await b.close(); srv.close();
 if(failures.length){ console.error('FAILED:\n  '+failures.join('\n  ')); process.exit(1); }
 console.log('PASS lock screen names the reason: '+checks+' checks - an ended trial and a cancelled subscription say so and take an access code (a good code opens the app, a bad one does not), an unapproved account keeps its wording, and the lock screen appears in seconds, not 32 s');
});
