'use strict';
/* Calendar tells one story (calid-1.0.0 / calnav-1.0.0, b1290). Found by the
   ScribeFlow.html bug hunt: string appointment ids were written unquoted into
   onclick handlers, so no appointment opened from Day/Week/Month; the arrows
   moved _calRefDate but not _calSelDay, so the status line counted a different
   day than the grid showed; Tab skipped every appointment; the Week roster
   counted the whole month. Real Chrome on /ScribeFlow.html?preview=1. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 try{
  const pg=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.fulfill({status:503,body:'x'}));
  await pg.goto('http://127.0.0.1:'+srv.address().port+'/ScribeFlow.html?preview=1');
  await pg.waitForFunction(()=>(window._calAppts||[]).length>0&&typeof window.showView==='function',null,{timeout:60000}); await pg.waitForTimeout(2500);
  await pg.evaluate(()=>{ showView('calendar'); }); await pg.waitForTimeout(1200);
  await pg.evaluate(()=>{ calSetMode('day'); calToday(); }); await pg.waitForTimeout(1200);
  /* the exact-layout pass places blocks on its own tick; under load give it time */
  await pg.waitForFunction(()=>{ const b=[...document.querySelectorAll('#calGrid [data-appt]')]; return b.length>0 && b.every(x=>getComputedStyle(x).display!=='none'&&x.getBoundingClientRect().height>0); },null,{timeout:15000}).catch(()=>{});
  // 1. a Day block opens its appointment by pointer
  const day=await pg.evaluate(async()=>{ const e=document.querySelector('#calGrid [data-appt]'); if(!e) return null;
    const bg=e.parentElement.closest('[onclick]'); e.click(); await new Promise(r=>setTimeout(r,500));
    const out={shown:[...document.querySelectorAll('#calGrid [data-appt]')].every(x=>getComputedStyle(x).display!=='none'&&x.getBoundingClientRect().height>0),oc:e.getAttribute('onclick'),peek:!!document.getElementById('calApptPeek'),role:e.getAttribute('role'),tab:e.getAttribute('tabindex'),bgRole:bg&&bg.getAttribute('role'),bgBlocked:bg&&bg.getAttribute('data-mls-preview-blocked')};
    const pk=document.getElementById('calApptPeek'); if(pk) pk.remove(); return out; });
  assert.ok(day,'the sample day has an appointment block');
  assert.ok(day.shown,'every Day appointment block is visible (a data-cx-orig clash once hid them all)');
  assert.match(day.oc,/calApptPeek\('preview-appt-[\w-]+',event\)/,'string ids are quoted in handlers: '+day.oc);
  assert.ok(day.peek,'clicking a Day block opens the appointment');
  assert.strictEqual(day.role,'button'); assert.strictEqual(day.tab,'0');
  assert.notStrictEqual(day.bgRole,'button','the click-to-book time grid is not one giant button wrapping every block');
  assert.notStrictEqual(day.bgBlocked,'1','the sample workspace does not block the whole grid');
  // 2. keyboard: Enter on a focused block opens it
  await pg.evaluate(()=>document.querySelector('#calGrid [data-appt]').focus()); await pg.keyboard.press('Enter'); await pg.waitForTimeout(500);
  assert.ok(await pg.evaluate(()=>!!document.getElementById('calApptPeek')),'Enter on a focused appointment opens it');
  await pg.evaluate(()=>{ const pk=document.getElementById('calApptPeek'); if(pk) pk.remove(); });
  // 3. arrows keep one day on screen: the status line counts the day the grid shows
  for(let i=0;i<6;i++){ await pg.evaluate(()=>calNext()); await pg.waitForTimeout(250); }
  const st=await pg.evaluate(()=>({ref:window._calRefDate,sel:window._calSelDay}));
  assert.strictEqual(st.sel,st.ref,'the arrows move the selected day with the grid');
  // 4. Month next then Day lands in the month that was on screen
  await pg.evaluate(()=>{ calToday(); calSetMode('month'); }); await pg.waitForTimeout(600);
  const ym=await pg.evaluate(()=>[window._calYear,window._calMonth]);
  await pg.evaluate(()=>calNext()); await pg.waitForTimeout(400); await pg.evaluate(()=>calSetMode('day')); await pg.waitForTimeout(600);
  const ref=await pg.evaluate(()=>window._calRefDate);
  const want=new Date(ym[0],ym[1]+1,1); assert.strictEqual(ref.slice(0,7),want.getFullYear()+'-'+String(want.getMonth()+1).padStart(2,'0'),'Day follows the month Month moved to: '+ref);
  // 5. Month chips open too
  await pg.evaluate(()=>{ calToday(); calSetMode('month'); }); await pg.waitForTimeout(600);
  assert.ok(await pg.evaluate(async()=>{ const e=document.querySelector('#calGrid [onclick*="calApptPeek"]'); if(!e) return false; e.click(); await new Promise(r=>setTimeout(r,500)); return !!document.getElementById('calApptPeek'); }),'a Month chip opens its appointment');
  // 6. Week roster counts the week, not the month
  await pg.evaluate(()=>{ const pk=document.getElementById('calApptPeek'); if(pk) pk.remove(); calSetMode('week'); }); await pg.waitForTimeout(800);
  const wk=await pg.evaluate(()=>({roster:(document.getElementById('mlsT3Roster')||{}).textContent||'',blocks:document.querySelectorAll('#calGrid [data-appt]').length}));
  const nums=(wk.roster.match(/Clinician\s*(\d+)/g)||[]).map(s=>+s.replace(/\D/g,''));
  if(nums.length) assert.strictEqual(nums.reduce((a,c)=>a+c,0),wk.blocks,'Week provider counts add up to the blocks on screen: '+wk.roster);
  assert.deepStrictEqual(errs,[],'no page errors');
  console.log('PASS calendar on /ScribeFlow.html: appointments open by click and Enter from Day and Month, the arrows keep one day on screen, Month→Day lands on the right month, and Week counts the week');
 } finally { await b.close(); srv.close(); }
});
