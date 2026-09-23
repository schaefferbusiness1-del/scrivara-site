'use strict';
/* The sample workspace stops over-blocking and stops flickering (pvfix-1.0.0).
   Found by the ScribeFlow.html bug hunt on /ScribeFlow.html?preview=1:
   - "‹ Back to the day list" (#ez3Back) was blocked because its title says
     "visit room", and "Type or paste visit notes" (#ez3ActiveNotes) because
     its own "no recording" subtitle matched the danger words;
   - the Choose-patient search (#ez3Search), the Legal / IME Change search
     (#mlsP1LegalRosterSearch) and the dock Find box (#mlsDockAsk) were
     read-only; "Records review summary" could not be picked (id ~ /record/);
   - every lone Cancel (Settings, confirm boxes, the notes box) was blocked by
     \bcancel\b, and #idleMins was seeded '240', which is not an option;
   - the banner claimed "invented appointments are loaded for this day" on
     empty sample days;
   - the day-strip button flashed the live '📥 Pull today' every 1.2 s
     (syncStrip vs the preview runtime) and kept an "…from Athena" hint.
   Real Chrome, desktop 1400x900 and phone 390x844; every non-local request is
   stubbed and must not happen. Each step waits for the state it asserts, not
   for a fixed time: the Legal / IME module is a deferred asset that installs
   only after the page has been quiet, ~30 s into this run on a loaded box. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const status=pg=>pg.evaluate(()=>document.getElementById('mlsPublicPreviewStatus').textContent);
 /* Wait for a page condition but never throw: the assertion after it names what is wrong. */
 const until=(pg,fn,arg,ms)=>pg.waitForFunction(fn,arg,{timeout:ms||20000,polling:100}).then(()=>true,()=>false);
 async function open(ctxOpts){
  const ctx=await b.newContext(ctxOpts); const pg=await ctx.newPage();
  const errs=[], external=[];
  pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>{ external.push(r.request().url()); r.fulfill({status:503,body:'x'}); });
  await pg.goto('http://127.0.0.1:'+srv.address().port+'/ScribeFlow.html?preview=1');
  await pg.waitForFunction(()=>(window._calAppts||[]).length>0&&typeof window.showView==='function'&&document.getElementById('mlsDsPullBtn')&&document.getElementById('ez3Choose'),null,{timeout:60000});
  await until(pg,()=>document.getElementById('mlsDsPullBtn').textContent.trim()==='Reload sample day',null,30000);
  await pg.waitForTimeout(3500);
  return {ctx,pg,errs,external};
 }
 /* Every label #mlsDsPullBtn shows over `ms`, sampled per frame and on every mutation. */
 const watchPull=(pg,ms)=>pg.evaluate(ms=>new Promise(res=>{const btn=document.getElementById('mlsDsPullBtn');const seen=new Set([btn.textContent.trim()]);
   const mo=new MutationObserver(()=>seen.add(btn.textContent.trim()));mo.observe(btn,{childList:true,characterData:true,subtree:true});
   const t0=performance.now();(function f(){seen.add(btn.textContent.trim());if(performance.now()-t0<ms)requestAnimationFrame(f);else{mo.disconnect();res([...seen]);}})();}),ms);
 try{
  /* ---------------- desktop ---------------- */
  const D=await open({viewport:{width:1400,height:900}}); const pg=D.pg;
  // 1. the day-strip button holds one label across several 1.2 s ticks, with no live Athena hint
  assert.deepStrictEqual(await watchPull(pg,4000),['Reload sample day'],'the sample day button never flashes the live pull verb');
  const hint=await pg.evaluate(()=>{const b=document.getElementById('mlsDsPullBtn');const s=b.nextElementSibling;return {intent:s&&/mlsaa-intent/.test(s.className)&&getComputedStyle(s).display!=='none'?s.textContent:'',tip:b.getAttribute('data-tip')||b.title};});
  assert.strictEqual(hint.intent,'','no visible "brings in today\'s patients from Athena" caption beside the sample button');
  assert.match(hint.tip,/no request to Athena/,'the hint says the sample reload never contacts Athena: '+hint.tip);
  // 2. an empty sample day does not claim appointments are loaded
  await pg.click('#mlsDsPrev');
  await until(pg,()=>!!document.getElementById('ez3DayEmpty')&&/No invented appointments/.test((document.getElementById('mlsPrfProgress')||{}).textContent||''));
  assert.deepStrictEqual(await watchPull(pg,2600),['Reload sample day'],'the label stays put on another day too');
  const empty=await pg.evaluate(()=>({body:!!document.getElementById('ez3DayEmpty'),banner:(document.getElementById('mlsPrfProgress')||{}).textContent||''}));
  assert.ok(empty.body,'yesterday is an empty sample day');
  assert.doesNotMatch(empty.banner,/appointments are loaded|schedule loaded/i,'the banner does not contradict the empty day: '+empty.banner);
  assert.match(empty.banner,/No invented appointments on this sample date/,'the banner says the day is empty');
  await pg.click('#mlsDsNext');
  await until(pg,()=>/^Sample schedule loaded/.test((document.getElementById('mlsPrfProgress')||{}).textContent||''));
  assert.match(await pg.evaluate(()=>(document.getElementById('mlsPrfProgress')||{}).textContent||''),/^Sample schedule loaded/,'on a day with rows the banner says the schedule is loaded');
  // 3. "Type or paste visit notes" opens the no-recording room and a read-only notes box that Cancel closes
  assert.strictEqual(await pg.evaluate(()=>document.getElementById('ez3ActiveNotes').getAttribute('data-mls-preview-blocked')),null,'the notes card is not blocked by its own "no recording" subtitle');
  await pg.click('#ez3ActiveNotes');
  await until(pg,()=>!!document.getElementById('ez3flTranscript')&&!!document.querySelector('#mlsQuickToolPopup textarea'));
  const box=await pg.evaluate(()=>{const p=document.getElementById('mlsQuickToolPopup');const ta=p&&p.querySelector('textarea');const use=p&&p.querySelector('.mls-qtp-btn.primary');const cancel=p&&[...p.querySelectorAll('button')].find(x=>x.textContent.trim()==='Cancel');if(cancel)cancel.setAttribute('data-t','cancel');
    return {room:!!document.getElementById('ez3flTranscript'),box:!!p,ro:ta&&ta.readOnly,use:use&&use.getAttribute('data-mls-preview-blocked'),cancel:cancel&&cancel.getAttribute('data-mls-preview-blocked'),rec:!!document.querySelector('.ez3fl-recbtn:not([data-mls-preview-blocked="1"])')};});
  assert.ok(box.room,'the visit room opened');
  assert.ok(box.box,'the notes box opened');
  assert.strictEqual(box.ro,true,'the notes box stays read-only in the sample');
  assert.strictEqual(box.use,'1','"Use these visit notes" is disabled, not a false "Transcript added"');
  assert.strictEqual(box.cancel,null,'the notes box Cancel is not blocked');
  assert.strictEqual(box.rec,false,'recording stays off in the room');
  assert.match(await status(pg),/without recording/,'the strip says what happened');
  await pg.click('#mlsQuickToolPopup [data-t="cancel"]');
  await until(pg,()=>!document.getElementById('mlsQuickToolPopup'),null,5000);
  assert.strictEqual(await pg.evaluate(()=>!!document.getElementById('mlsQuickToolPopup')),false,'Cancel closes the notes box');
  // 4. "‹ Back to the day list" works by keyboard
  const back=await pg.evaluate(()=>{const e=document.getElementById('ez3Back');return e&&{t:e.textContent,bl:e.getAttribute('data-mls-preview-blocked'),ad:e.getAttribute('aria-disabled')};});
  assert.ok(back&&/Back to the/.test(back.t),'the room shows its back button');
  assert.strictEqual(back.bl,null,'Back is not blocked'); assert.notStrictEqual(back.ad,'true','Back is not announced disabled');
  await pg.focus('#ez3Back'); await pg.keyboard.press('Enter');
  await until(pg,()=>!document.getElementById('ez3flTranscript')&&!!document.getElementById('ez3Search'),null,8000);
  assert.ok(await pg.evaluate(()=>!document.getElementById('ez3flTranscript')&&!!document.getElementById('ez3Search')),'Enter on Back returns to the day list');
  // 5. the Choose-patient search filters
  await pg.click('#ez3Search'); await pg.keyboard.type('Three');
  await until(pg,()=>document.querySelectorAll('#ez3ChooseList .hd').length===1,null,8000);
  const found=await pg.evaluate(()=>({v:document.getElementById('ez3Search').value,rows:[...document.querySelectorAll('#ez3ChooseList .hd')].map(r=>r.textContent)}));
  assert.strictEqual(found.v,'Three','typing reaches the search box');
  assert.ok(found.rows.length===1&&/Sample Patient Three/.test(found.rows[0]),'the list filters to the match: '+JSON.stringify(found.rows).slice(0,200));
  // pointer Back from the room too
  await pg.evaluate(()=>document.querySelector('#ez3ChooseList .hd').click());
  await until(pg,()=>!!document.getElementById('ez3flTranscript'),null,8000);
  await pg.click('#ez3Back');
  await until(pg,()=>!!document.getElementById('ez3Search'),null,8000);
  assert.ok(await pg.evaluate(()=>!!document.getElementById('ez3Search')),'a click on Back returns to the day list');
  await pg.evaluate(()=>window.__mlsEasyV32.open('home'));
  await until(pg,()=>!!document.getElementById('ez3ActiveNotes'),null,8000);
  // 6. the dock Find box searches controls locally and explains its off hand-offs
  await pg.click('#mlsDockAsk');
  assert.match(await status(pg),/Find looks up buttons/,'focusing Find explains what it does in the sample');
  await pg.keyboard.type('reload sample');
  await until(pg,()=>/Reload sample day/.test((document.querySelector('#mlsAskResults .r.sel')||{}).textContent||''),null,8000);
  assert.strictEqual(await pg.evaluate(()=>document.getElementById('mlsDockAsk').value),'reload sample','typing reaches Find');
  assert.match(await pg.evaluate(()=>document.querySelector('#mlsAskResults .r.sel').textContent),/Reload sample day/,'Find matches the sample control');
  await pg.keyboard.press('Enter');
  await until(pg,()=>/Reloaded \d+ invented appointment/.test(document.getElementById('mlsPublicPreviewStatus').textContent),null,8000);
  assert.match(await status(pg),/Reloaded \d+ invented appointment/,'Enter runs the matched local control');
  await pg.click('#mlsDockAsk'); await pg.keyboard.type('zzqq nothing');
  await until(pg,()=>{const r=[...document.querySelectorAll('#mlsAskResults .r')];return r.length>=1&&r.every(x=>x.getAttribute('data-mls-preview-blocked')==='1');},null,8000);
  const off=await pg.evaluate(()=>[...document.querySelectorAll('#mlsAskResults .r')].map(r=>[r.textContent.slice(0,30),r.getAttribute('data-mls-preview-blocked')]));
  assert.ok(off.length>=1&&off.every(r=>r[1]==='1'),'Copilot and finder hand-offs are marked off: '+JSON.stringify(off));
  await pg.keyboard.press('Enter');
  await until(pg,()=>/Copilot and the patient finder are off/.test(document.getElementById('mlsPublicPreviewStatus').textContent),null,8000);
  await pg.waitForTimeout(300);
  assert.match(await status(pg),/Copilot and the patient finder are off/,'Enter on an off hand-off explains instead of doing nothing');
  assert.ok(await pg.evaluate(()=>{const o=document.getElementById('mlsFpQf');return !o||getComputedStyle(o).display==='none';}),'the global finder did not open');
  await pg.keyboard.press('Escape');
  // 7. Settings: auto log-off shows a real choice and Cancel closes
  await pg.click('#mlsAccountMenuBtn'); await pg.click('[data-account-action="settings"]');
  await until(pg,()=>{const m=document.getElementById('settingsModal');return !!m&&getComputedStyle(m).display!=='none'&&!!document.getElementById('idleMins');},null,8000);
  const set=await pg.evaluate(()=>{const s=document.getElementById('idleMins');const c=[...document.querySelectorAll('#settingsModal button')].find(x=>x.offsetParent&&/^(Cancel|Close)$/.test(x.textContent.trim())&&x.getAttribute('onclick')==='closeSettings()');if(c)c.setAttribute('data-t','settings-cancel');return {v:s.value,i:s.selectedIndex,c:c&&c.getAttribute('data-mls-preview-blocked')};});
  assert.ok(set.v!==''&&set.i>=0,'#idleMins shows one of its options: '+JSON.stringify(set));
  assert.strictEqual(set.c,null,'Settings Cancel is not blocked');
  await pg.click('[data-t="settings-cancel"]');
  await until(pg,()=>getComputedStyle(document.getElementById('settingsModal')).display==='none',null,5000);
  assert.strictEqual(await pg.evaluate(()=>getComputedStyle(document.getElementById('settingsModal')).display),'none','Settings Cancel closes the dialog');
  // 8. Legal / IME: Change search binds another sample patient; Records review summary can be picked
  //    The Tools row exists only once the deferred Legal / IME module has installed.
  assert.ok(await until(pg,()=>!!(window.__mlsLegalToolsRow&&window.__mlsLegalToolsRow.available()),null,120000),'the Legal / IME workspace module installs in the sample');
  await pg.evaluate(()=>{const t=[...document.querySelectorAll('#mlsDock button')].find(x=>/^Tools$/.test(x.textContent.trim()));t.click();});
  assert.ok(await until(pg,()=>[...document.querySelectorAll('#mlsToolsMenu .rn')].some(x=>/^Legal \/ IME workspace$/.test(x.textContent.trim())),null,8000),'Tools lists the Legal / IME workspace');
  await pg.evaluate(()=>{const r=[...document.querySelectorAll('#mlsToolsMenu .rn')].find(x=>/^Legal \/ IME workspace$/.test(x.textContent.trim()));r.click();});
  await until(pg,()=>!!document.getElementById('mlsP1LegalChange')&&!!document.getElementById('mlsP1LegalReport_records'),null,15000);
  await pg.click('#mlsP1LegalChange');
  await until(pg,()=>document.activeElement&&document.activeElement.id==='mlsP1LegalRosterSearch',null,5000);
  assert.strictEqual(await pg.evaluate(()=>document.activeElement&&document.activeElement.id),'mlsP1LegalRosterSearch','Change focuses the roster search');
  await pg.keyboard.type('Two');
  await until(pg,()=>!!document.querySelector('#mlsP1LegalRosterResults button[data-bind-id]'),null,8000);
  assert.match(await pg.evaluate(()=>document.getElementById('mlsP1LegalRosterResults').textContent),/Sample Patient Two/,'the roster search lists the sample match');
  await pg.click('#mlsP1LegalRosterResults button[data-bind-id]');
  await until(pg,()=>/Sample Patient Two/.test((document.querySelector('#mlsP1LegalRoot .p1l-bindname')||{}).textContent||''),null,8000);
  assert.match(await pg.evaluate(()=>(document.querySelector('#mlsP1LegalRoot .p1l-bindname')||{}).textContent||''),/Sample Patient Two/,'the workspace re-binds to the chosen sample patient');
  assert.strictEqual(await pg.evaluate(()=>document.getElementById('mlsP1LegalReport_records').getAttribute('data-mls-preview-blocked')),null,'Records review summary is not blocked by its id');
  await pg.click('#mlsP1LegalReport_records');
  await until(pg,()=>document.getElementById('mlsP1LegalReport_records').getAttribute('aria-pressed')==='true',null,5000);
  assert.strictEqual(await pg.evaluate(()=>document.getElementById('mlsP1LegalReport_records').getAttribute('aria-pressed')),'true','Records review summary can be picked');
  assert.deepStrictEqual(D.external,[],'the sample workspace made no non-local request');
  assert.deepStrictEqual(D.errs,[],'no page errors on desktop');
  await D.ctx.close();

  /* ---------------- phone ---------------- */
  const P=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true}); const ph=P.pg;
  assert.deepStrictEqual(await watchPull(ph,3000),['Reload sample day'],'the phone day button never flashes the live pull verb');
  await ph.tap('#ez3Choose');
  await until(ph,()=>!!document.getElementById('ez3Search'),null,8000);
  await ph.tap('#ez3Search'); await ph.keyboard.type('Two');
  await until(ph,()=>document.querySelectorAll('#ez3ChooseList .hd').length===1,null,8000);
  assert.strictEqual(await ph.evaluate(()=>[...document.querySelectorAll('#ez3ChooseList .hd')].filter(r=>/Sample Patient Two/.test(r.textContent)).length+':'+document.querySelectorAll('#ez3ChooseList .hd').length),'1:1','the phone search filters the day list');
  await ph.evaluate(()=>document.querySelector('#ez3ChooseList .hd').click());
  await until(ph,()=>!!document.getElementById('ez3flTranscript'),null,8000);
  await ph.tap('#ez3Back');
  await until(ph,()=>!document.getElementById('ez3flTranscript')&&!!document.getElementById('ez3Search'),null,8000);
  assert.ok(await ph.evaluate(()=>!document.getElementById('ez3flTranscript')&&!!document.getElementById('ez3Search')),'a tap on Back returns to the day list on a phone');
  assert.deepStrictEqual(P.external,[],'the phone sample made no non-local request');
  assert.deepStrictEqual(P.errs,[],'no page errors on the phone');
  console.log('PASS sample workspace on /ScribeFlow.html: Back, the notes card, three local searches, dialog Cancel buttons and the Records report work; auto log-off shows a real option; empty days say so; the Reload sample day label never flickers (desktop + phone)');
 } finally { await b.close(); srv.close(); }
});
