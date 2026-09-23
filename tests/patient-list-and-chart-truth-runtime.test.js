'use strict';
/* Patient list and chart tell the truth (pvfix-1.0.0, hunt:patient +
   hunt:phone-dock). Found by the ScribeFlow.html bug hunt, every one measured
   on /ScribeFlow.html?preview=1:
   1. phone: tapping a patient in the Patient tab list never opened them - the
      list folded on the search box's focusout, before the click landed - and
      the dock's Patient button could not bring the folded list back;
   2. sample workspace: from the second patient switch on, the Visit card kept
      offering the PREVIOUS patient (its only repaint was a poll the sealed
      sample never starts);
   3. keyboard: no patient row could be focused or opened, their Record/🗑
      could never be revealed, the search box ignored ArrowDown/Enter, and the
      Recent menu could not be reached or closed from the keyboard;
   4. chart "Next appt" showed the LAST loaded appointment, time only;
   5. VISITS / History counted every MLS note twice ("4 visits" for 2) - and
      merging a note into its day must keep its text: the card, its Copy and
      "Copy all ... full notes" carry every note merged into that day (index-
      only or illegible athenaOne rows included), and the spent "Show more"
      button goes away;
   6. allergy "NKDA (sample)" was rewritten to "NKDA\nNKDA (sample)";
   7. phone Choose patient: names ran under the appointment time.
   Real Chrome, 1400x900 and 390x844 (isMobile+hasTouch), the clock pinned to
   Tue 2026-09-22 07:00 America/New_York. Nothing leaves 127.0.0.1. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const T0='2026-09-22T07:00:00-04:00', NOON='2026-09-22T12:00:00-04:00';
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const offsite=[], errs=[];
 async function open(mobile){
  /* a phone says so in its UA: without it the desktop-only "Use MLS on your
     phone" card mounts at 12s and sits over the rows this test taps */
  const ua=mobile?'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36':undefined;
  const ctx=await b.newContext({viewport:mobile?{width:390,height:844}:{width:1400,height:900},isMobile:mobile,hasTouch:mobile,userAgent:ua,timezoneId:'America/New_York'});
  const pg=await ctx.newPage();
  await pg.clock.install({time:new Date(T0)});
  pg.on('pageerror',e=>errs.push((mobile?'phone: ':'desk: ')+String(e.message).slice(0,160)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>{offsite.push(r.request().url().slice(0,120));return r.fulfill({status:503,body:'x'});});
  await pg.goto('http://127.0.0.1:'+srv.address().port+'/ScribeFlow.html?preview=1');
  await pg.waitForFunction(()=>(window._calAppts||[]).length>0&&typeof window.showView==='function'&&!!document.querySelector('#mlsDock button[data-dest="patient"]'),null,{timeout:60000});
  await pg.waitForTimeout(3000);
  return pg;
 }
 const st=pg=>pg.evaluate(()=>({active:getActivePtId(),list:getComputedStyle(document.getElementById('ptList')).display}));
 const tile=(pg,re)=>pg.evaluate(src=>{const q=document.getElementById('pf2Quick');return q?[...q.children].map(c=>c.innerText.replace(/\s+/g,' ').trim()).find(t=>new RegExp(src,'i').test(t))||'':'';},re);
 const visitCard=pg=>pg.evaluate(()=>{const g=document.getElementById('ez3ActiveGo');return (g&&g.getAttribute('aria-label'))||'';});
 try{
  /* ================= phone ================= */
  const ph=await open(true);
  await ph.locator('#mlsDock button[data-dest="patient"]').tap(); await ph.waitForTimeout(1200);
  assert.strictEqual((await st(ph)).list,'none','phone: with a chart open the list starts folded (master-detail is kept)');
  // 1a. search, then TAP a row: the row it was on opens
  await ph.locator('#ptSearch').tap(); await ph.keyboard.type('Three'); await ph.waitForTimeout(1000);
  let box=await ph.locator('#ptList .pt-item[data-patient-id="preview-patient-003"]').boundingBox();
  assert.ok(box,'phone: the search shows the Sample Patient Three row');
  await ph.touchscreen.tap(box.x+box.width/2,box.y+box.height/2); await ph.waitForTimeout(1200);
  let s=await st(ph);
  assert.strictEqual(s.active,'preview-patient-003','phone: tapping a searched row opens that patient (it used to fold away before the click landed)');
  assert.strictEqual(s.list,'none','phone: once the patient opens, the list folds back behind the chart');
  // 1b. the dock's Patient button brings the folded list back
  await ph.evaluate(()=>{const q=document.getElementById('ptSearch');q.value='';renderPatients();q.blur();scrollTo(0,900);}); await ph.waitForTimeout(400);
  await ph.locator('#mlsDock button[data-dest="patient"]').tap(); await ph.waitForTimeout(900);
  assert.strictEqual((await st(ph)).list,'block','phone: Patient pressed on the Patient tab reveals the patient list');
  const four=ph.locator('#ptList .pt-item[data-patient-id="preview-patient-004"]'); box=await four.boundingBox();
  const hit=await ph.evaluate(([x,y])=>{const e=document.elementFromPoint(x,y);const r=e&&e.closest('.pt-item');return r&&r.getAttribute('data-patient-id');},[box.x+box.width/2,box.y+box.height/2]);
  assert.strictEqual(hit,'preview-patient-004','phone: the revealed row is on screen and owns its pixels');
  await ph.touchscreen.tap(box.x+box.width/2,box.y+box.height/2); await ph.waitForTimeout(1200);
  s=await st(ph);
  assert.strictEqual(s.active,'preview-patient-004','phone: a row tapped in the revealed list opens that patient');
  assert.strictEqual(s.list,'none','phone: and the list folds again');
  // 7. Choose patient: a long name is clipped inside its column, never under the time
  await ph.locator('#mlsDock button[data-dest="visit"]').tap(); await ph.waitForTimeout(1200);
  await ph.locator('#ez3Choose').scrollIntoViewIfNeeded(); await ph.locator('#ez3Choose').tap(); await ph.waitForTimeout(1500);
  const rows=await ph.evaluate(()=>[...document.querySelectorAll('#ez3Wrap .ez3-prow')].filter(p=>p.offsetParent&&p.querySelector('.nm')&&p.querySelector('.tm')).map(p=>{const n=p.querySelector('.nm').getBoundingClientRect(),t=p.querySelector('.tm').getBoundingClientRect();return {name:p.querySelector('.nm').textContent,right:n.right,time:t.left};}));
  assert.ok(rows.length>=3,'phone: Choose patient lists the sample day');
  rows.forEach(r=>assert.ok(r.right<=r.time+0.5,'phone Choose: "'+r.name+'" ends at '+Math.round(r.right)+'px, under the time at '+Math.round(r.time)+'px'));

  /* ================= desktop ================= */
  const pg=await open(false);
  await pg.locator('#mlsDock button[data-dest="patient"]').click(); await pg.waitForTimeout(1500);
  // 4. Next appt is the NEXT one: 7:00 AM, so today's 8:10 - not Thursday's 11:10
  const next=await tile(pg,'^NEXT APPT');
  assert.match(next,/NEXT APPT\s*8:10 AM · Sample follow-up/i,'Next appt at 7:00 AM is today\'s 8:10 slot: '+next);
  // 5. VISITS counts each visit once; History lists no undated copy
  const visits=await tile(pg,'^VISITS');
  assert.match(visits,/^VISITS\s*2 visits/i,'two stored visits, each with its note, are 2 visits: '+visits);
  const hist=await pg.evaluate(()=>{const r=window.__mlsPtVisits.resolve(activePatient());return {count:r.count,undated:r.entries.filter(e=>!e.date).length};});
  assert.deepStrictEqual(hist,{count:2,undated:0},'the visit resolver merges each note into its own day');
  await pg.locator('.segbtn',{hasText:'History'}).click(); await pg.waitForTimeout(1500);
  assert.ok(!(await pg.evaluate(()=>/Date not documented/.test(document.getElementById('historyView').innerText))),'History shows no "Date not documented" copy of a dated note');
  /* 5b. merging a note into its day must not LOSE it: the card, its Copy and
     "Copy all ... full notes" carry the clinician's own note text (the first
     cut of the count fix dropped it: "2 with the full note", no SOAP in it) */
  /* the sample seals navigator.clipboard, so both copies take their own
     textarea + execCommand('copy') path: read the text they put there */
  await pg.evaluate(()=>{window.__copied=[];const ex=document.execCommand.bind(document);document.execCommand=function(c){if(c==='copy'){const a=document.activeElement;window.__copied.push(String(a&&a.value||''));return true;}return ex.apply(null,arguments);};});
  const card=()=>pg.evaluate(()=>{const c=document.querySelector('#mlsHxSection .hx-card[data-hx-key="d:2026-09-13"]');return c?c.textContent.replace(/\s+/g,' '):'';});
  let c913=await card();
  assert.match(c913,/99213/,'the 2026-09-13 card still shows the pulled visit\'s own codes');
  assert.match(c913,/Note recorded in MLS.*Fictional low-back follow-up.*Sample lumbar pain, improving/i,'the 2026-09-13 card shows the MLS note merged into that day: '+c913.slice(0,200));
  await pg.locator('#mlsHxSection .hx-card[data-hx-key="d:2026-09-13"] [data-hx-copy]').click(); await pg.waitForTimeout(400);
  assert.match((await pg.evaluate(()=>window.__copied.pop()))||'',/99213[\s\S]*SUBJECTIVE\s+Fictional low-back follow-up/,'the card\'s Copy carries the visit codes AND the merged note');
  await pg.locator('#hxCopyAll').click(); await pg.waitForTimeout(500);
  const all=(await pg.evaluate(()=>window.__copied.pop()))||'';
  assert.match(all,/2 encounters — 2 with the full note/,'Copy all tallies two encounters: '+all.slice(0,160));
  for(const t of ['Fictional low-back follow-up','Sample lumbar pain, improving','Fictional initial consultation']) assert.ok(all.includes(t),'Copy all carries every merged note in full, "'+t+'" is missing');
  // a SECOND note on a day that already has one: still one visit, and both notes are shown
  await pg.evaluate(()=>{window.__pn=window.patientNotes;const extra={id:'t-extra',patientId:'preview-patient-001',visitDate:'2026-09-13',provider:'Dr. Second Sample',isDraft:false,soap:'Procedure: SECOND SAME-DAY NOTE BODY\nPlan: recheck in two weeks.'};window.patientNotes=function(id){const r=(window.__pn.apply(this,arguments)||[]).slice();return String(id)==='preview-patient-001'?r.concat([extra]):r;};});
  await pg.waitForFunction(()=>/SECOND SAME-DAY NOTE BODY/.test(document.getElementById('mlsHxSection').textContent),null,{timeout:8000}).catch(()=>{});
  c913=await card();
  const two=await pg.evaluate(()=>({count:window.__mlsPtVisits.resolve(activePatient()).count,line:document.querySelector('#mlsHxSection [data-hx-count]').textContent}));
  assert.deepStrictEqual(two,{count:2,line:'2 visits'},'a second same-day note enriches its day, it does not add a visit');
  assert.match(c913,/Fictional low-back follow-up.*Note recorded in MLS — Dr\. Second Sample.*SECOND SAME-DAY NOTE BODY/,'both same-day notes are on the card, each under its own heading: '+c913.slice(0,260));
  await pg.locator('#mlsHxSection .hx-card[data-hx-key="d:2026-09-13"] [data-hx-more]').click(); await pg.waitForTimeout(300);
  assert.ok(await pg.evaluate(()=>{const c=document.querySelector('#mlsHxSection .hx-card[data-hx-key="d:2026-09-13"]');return /SECOND SAME-DAY NOTE BODY/.test(c.innerText)&&!/Show more/.test(c.innerText);}),'"Show more" reveals the folded note and then goes away');
  await pg.evaluate(()=>{window.patientNotes=window.__pn;});
  // an index-only or illegible athenaOne row never hides the note merged into it
  const odd=await pg.evaluate(()=>{const api=window.__mlsEncView,n={id:'t-n',soap:'Assessment: Sample lumbar strain.\nPlan: Sample home exercise.',provider:'Dr. Sample Clinician'};
    const one=row=>{const r=api.fromEntry({key:'d:2026-09-01',date:'2026-09-01',type:'Office visit',source:'athena',row:row,noteRow:n,noteRows:[n]});return {index:r.indexOnly,illegible:r.illegible,reread:!!r.athenaReread,text:api.textBlock(r,{source:true}),pull:/data-hx-read/.test(api.cardHtml(r)),glance:api.chronRow(r).impression};};
    return {index:one({date:'2026-09-01',indexOnly:true,textHead:'09-01-2026, M Sample, MD, Pain'}),junk:one({date:'2026-09-01',raw:'REFRESH CHART\nIsSafari = function(){ return 1; }'})};});
  for(const k of ['index','junk']){
   const r=odd[k];
   assert.ok(!r.index&&!r.illegible,k+': an encounter whose MLS note is readable is not an unread encounter');
   assert.match(r.text,/Sample lumbar strain[\s\S]*Sample home exercise/,k+': the merged note is printed in full: '+r.text);
   assert.match(r.text,k==='index'?/Index only — full note not read yet/:/no readable clinical text/,k+': the athenaOne row\'s own state is still said: '+r.text);
   assert.ok(r.reread&&r.pull,k+': the card still offers the athenaOne re-read');
   assert.strictEqual(r.glance,'Sample lumbar strain.',k+': the at-a-glance line reads the note\'s assessment');
  }
  await pg.locator('#mlsDock button[data-dest="patient"]').click(); await pg.waitForTimeout(900);
  // 6. NKDA (sample) stays one negation, on the record and on the chart
  assert.strictEqual(await pg.evaluate(()=>findPatient('preview-patient-003').allergies),'NKDA (sample)','the stored allergy is not rewritten into a duplicate');
  await pg.locator('#ptList .pt-item[data-patient-id="preview-patient-003"]').click(); await pg.waitForTimeout(1200);
  assert.strictEqual(await tile(pg,'^ALLERGIES'),'ALLERGIES NKDA (sample)','the chart lists the negation once');
  // 3a. rows are focusable, Enter opens one, and focus reveals its buttons
  const a11y=await pg.evaluate(()=>{const r=document.querySelector('#ptList .pt-item[data-patient-id="preview-patient-002"]');const vis=()=>[...r.querySelectorAll(':scope > div:last-child > button')].map(x=>getComputedStyle(x).visibility);const before=vis();r.focus();return {tab:r.tabIndex,role:r.getAttribute('role'),before:before,after:vis(),focused:document.activeElement===r};});
  assert.strictEqual(a11y.tab,0,'a patient row is in the Tab order'); assert.ok(a11y.focused,'a patient row takes focus');
  assert.notStrictEqual(a11y.role,'button','the row holds Record and 🗑, so it is not itself a button');
  assert.deepStrictEqual(a11y.after,['visible','visible'],'focusing a row reveals its Record and 🗑 (they were '+a11y.before.join('/')+')');
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(900);
  assert.strictEqual((await st(pg)).active,'preview-patient-002','Enter on a focused row opens that patient');
  // 3b. search: ArrowDown + Enter opens the picked match; Enter alone opens the first match
  await pg.evaluate(()=>selectPatient('preview-patient-001')); await pg.waitForTimeout(500);
  await pg.click('#ptSearch'); await pg.fill('#ptSearch',''); await pg.keyboard.type('Three',{delay:40}); await pg.waitForTimeout(700);
  await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(900);
  assert.strictEqual((await st(pg)).active,'preview-patient-003','search "Three" + ArrowDown + Enter opens Sample Patient Three');
  await pg.fill('#ptSearch',''); await pg.keyboard.type('Four',{delay:40}); await pg.keyboard.press('Enter'); await pg.waitForTimeout(900);
  assert.strictEqual((await st(pg)).active,'preview-patient-004','search "Four" + Enter opens the first match');
  await pg.fill('#ptSearch',''); await pg.keyboard.type('Sample Patient',{delay:20}); await pg.waitForTimeout(700);
  await pg.keyboard.press('Escape'); await pg.keyboard.press('ArrowDown');
  assert.ok(await pg.evaluate(()=>document.activeElement.classList.contains('pt-item')),'with the picker closed, ArrowDown steps from the search box into the list');
  await pg.keyboard.press('ArrowDown');
  assert.strictEqual(await pg.evaluate(()=>[...document.querySelectorAll('#ptList .pt-item')].indexOf(document.activeElement)),1,'ArrowDown walks to the next row');
  await pg.fill('#ptSearch','');
  // 3c. Recent: Enter puts focus in the menu, Escape closes it and returns focus
  await pg.evaluate(()=>{const e=document.querySelector('.mrp-btn:not([disabled])');e.scrollIntoView({block:'center'});e.focus();}); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  assert.ok(await pg.evaluate(()=>document.activeElement.classList.contains('mrp-item')&&!!document.activeElement.closest('#mlsRecentPtsMenu')),'Enter on Recent moves focus into its menu');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
  assert.ok(await pg.evaluate(()=>!document.querySelector('.mrp-item')&&document.activeElement.classList.contains('mrp-btn')),'Escape closes Recent and returns focus to it');
  // 2. the Visit card follows every switch, not only the first
  for(const [id,name] of [['preview-patient-002','Sample Patient Two'],['preview-patient-003','Sample Patient Three']]){
   await pg.locator('#mlsDock button[data-dest="patient"]').click(); await pg.waitForTimeout(800);
   await pg.locator('#ptList .pt-item[data-patient-id="'+id+'"]').click(); await pg.waitForTimeout(600);
   await pg.locator('#mlsDock button[data-dest="visit"]').click(); await pg.waitForTimeout(1500);
   const go=await visitCard(pg);
   assert.ok(go.includes(name),'Visit offers '+name+' after switching to them, not the previous patient: '+go);
  }
  // 4b. after the 8:10 slot has passed, Next appt names Thursday's date
  await pg.clock.setSystemTime(new Date(NOON));
  const ctx=await pg.evaluate(()=>window.__mlsEasyPrep.apptContext(findPatient('preview-patient-001')));
  assert.strictEqual(ctx.time,'Thu 9/24 · 11:10 AM','at noon the next appointment is Thursday\'s, and says so: '+JSON.stringify(ctx));
  /* 3d. signed-in shape (not the sample, where Record and 🗑 are blocked by
     design): Tab from a focused row reaches its Record and 🗑, then the next row */
  const lv=await b.newPage({viewport:{width:1366,height:900}});
  lv.on('pageerror',e=>errs.push('live: '+String(e.message).slice(0,160)));
  await lv.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.fulfill({status:503,body:'x'}));
  await lv.goto('http://127.0.0.1:'+srv.address().port+'/ScribeFlow.html');
  await lv.waitForTimeout(2500);
  await lv.evaluate(()=>typeof window.__mlsEnsureUiBundle==='function'?window.__mlsEnsureUiBundle():null);
  await lv.waitForFunction(()=>!!window.__mlsSimpleLayer,null,{timeout:60000}); await lv.waitForTimeout(5000);
  const seeded=await lv.evaluate(()=>{const a=document.getElementById('authScreen');if(a)a.style.display='none';const sc=document.getElementById('appScreen');if(sc)sc.style.display='';window.__mlsHarnessAccountEmail='ui-harness@mlsscribe.test';
    savePatients(['Sample Ada','Sample Bo','Sample Cy'].map((n,i)=>({id:'syn-'+i,name:n,dob:'1960-01-0'+(i+1),mrn:'M'+i,athenaId:String(900000+i),notes:[],visits:[]}))); renderPatients(); showView('patients'); return document.querySelectorAll('#ptList .pt-item').length;});
  assert.strictEqual(seeded,3,'the signed-in harness rendered its three synthetic rows');
  await lv.waitForTimeout(1200);
  await lv.evaluate(()=>document.querySelector('#ptList .pt-item[data-patient-id="syn-1"]').focus());
  const walk=[];
  for(let i=0;i<3;i++){ await lv.keyboard.press('Tab'); walk.push(await lv.evaluate(()=>{const a=document.activeElement;return a.classList.contains('pt-item')?'row:'+a.getAttribute('data-patient-id'):(a.classList.contains('del')?'delete':(/Record/.test(a.textContent)?'record':a.tagName));})); }
  assert.deepStrictEqual(walk,['record','delete','row:syn-2'],'Tab walks a focused row\'s Record and 🗑, then the next row: '+walk.join(' -> '));
  assert.deepStrictEqual(errs,[],'no page errors');
  assert.deepStrictEqual(offsite,[],'the sample workspace never leaves 127.0.0.1');
  console.log('PASS patient list and chart on /ScribeFlow.html: phone rows open on tap and the dock brings the list back, rows, their Record/🗑, search and Recent work from the keyboard, Visit follows every switch, Next appt is the next one with its date, visits are counted once and every merged note is shown and copied in full, NKDA (sample) stays one line, Choose names truncate');
 } finally { await b.close(); srv.close(); }
});
