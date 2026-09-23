'use strict';
/* Menus and dialogs keep the keyboard (menufocus-1.0.0). Found by the
   ScribeFlow.html bug hunt (visit-desktop, account-a11y, patient):
   - the Account menu (#mlsAccountPopover, role=menu) ignored Escape and the
     arrows, stayed open when focus Tabbed away, and opened on top of the mode
     ("Normal") menu, which stayed open under it;
   - Settings (#settingsModal, role=dialog aria-modal=true) let Tab walk 22
     controls behind the overlay, and closing it (Escape, x, Close) dropped focus
     on <body>, because the Account item that opened it was hidden first;
     and (menufocus-1.0.1) that trap must not take Tab from a layer painted
     over Settings that is not a [role=dialog] - the billing code table editor
     opened from Settings > Notes & AI, the dock nub and its menu;
   - Escape in the mode menu dropped focus on <body>;
   - the Recent (N) menu ignored Escape and sat at the END of the Tab order
     (15 Tabs from its button).
   Real Chrome on /ScribeFlow.html?preview=1, desktop and phone. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const url='http://127.0.0.1:'+srv.address().port+'/ScribeFlow.html?preview=1';
 async function boot(ctxOpts){
  const ctx=await b.newContext(ctxOpts); const pg=await ctx.newPage();
  const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.fulfill({status:503,body:'x'}));
  await pg.goto(url);
  await pg.waitForFunction(()=>(window._calAppts||[]).length>0&&typeof window.showView==='function'&&!!document.getElementById('mlsAccountMenuBtn')&&!!document.getElementById('mslChipBtn'),null,{timeout:60000});
  await pg.waitForTimeout(2500);
  return {pg,errs};
 }
 const active=pg=>pg.evaluate(()=>{const a=document.activeElement;return a===document.body?'BODY':(a.id||a.className||a.tagName)+'|'+(a.textContent||'').replace(/\s+/g,' ').trim().slice(0,24);});
 const state=pg=>pg.evaluate(()=>({acct:!document.getElementById('mlsAccountPopover').hidden,expanded:document.getElementById('mlsAccountMenuBtn').getAttribute('aria-expanded'),chip:!document.getElementById('mslChipMenu').hasAttribute('hidden'),settings:document.getElementById('settingsModal').classList.contains('show')}));
 const onAccountBtn=pg=>pg.evaluate(()=>document.activeElement===document.getElementById('mlsAccountMenuBtn'));
 try{
  const {pg,errs}=await boot({viewport:{width:1400,height:900}});
  // 1. Account menu: Escape closes it from the button and from an item, and focus lands on the button
  await pg.focus('#mlsAccountMenuBtn'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  assert.ok((await state(pg)).acct,'Enter on Account opens its menu');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  let st=await state(pg);
  assert.ok(!st.acct&&st.expanded==='false','Escape on the Account button closes the menu: '+JSON.stringify(st));
  assert.ok(await onAccountBtn(pg),'focus stays on the Account button');
  // 2. arrows walk role=menuitem items and wrap; Escape from an item returns focus to the button
  await pg.keyboard.press('ArrowDown'); await pg.waitForTimeout(150);
  assert.ok((await state(pg)).acct,'ArrowDown on the Account button opens the menu');
  const items=await pg.evaluate(()=>[...document.querySelectorAll('#mlsAccountPopover [role=menuitem]')].map(x=>x.textContent.trim()));
  assert.ok(items.length>=2,'the Account menu has its items: '+items);
  const cur=()=>pg.evaluate(()=>document.activeElement.closest('#mlsAccountPopover [role=menuitem]')?document.activeElement.textContent.trim():null);
  assert.strictEqual(await cur(),items[0],'ArrowDown from the button focuses the first item');
  await pg.keyboard.press('ArrowDown'); assert.strictEqual(await cur(),items[1],'ArrowDown moves to the next item');
  await pg.keyboard.press('End'); assert.strictEqual(await cur(),items[items.length-1],'End moves to the last item');
  await pg.keyboard.press('ArrowDown'); assert.strictEqual(await cur(),items[0],'ArrowDown wraps to the first item');
  await pg.keyboard.press('ArrowUp'); assert.strictEqual(await cur(),items[items.length-1],'ArrowUp wraps to the last item');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  assert.ok(!(await state(pg)).acct,'Escape inside the Account menu closes it');
  assert.ok(await onAccountBtn(pg),'Escape inside the Account menu hands focus to the Account button, not <body>: '+await active(pg));
  // 3. Tabbing out of the Account menu closes it
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  for(let i=0;i<=items.length;i++){ await pg.keyboard.press('Tab'); }
  await pg.waitForTimeout(150);
  assert.ok(!(await pg.evaluate(()=>document.getElementById('mlsAccountAccess').contains(document.activeElement))),'focus has left the Account menu');
  assert.ok(!(await state(pg)).acct,'the Account menu closes when focus Tabs away from it');
  // 4. one header menu at a time
  await pg.click('#mslChipBtn'); await pg.waitForTimeout(150);
  assert.ok((await state(pg)).chip,'the mode chip opens its menu');
  await pg.click('#mlsAccountMenuBtn'); await pg.waitForTimeout(150);
  st=await state(pg);
  assert.ok(st.acct&&!st.chip,'opening Account closes the mode menu (they overlapped by 145x133px): '+JSON.stringify(st));
  await pg.click('#mslChipBtn'); await pg.waitForTimeout(150);
  st=await state(pg);
  assert.ok(st.chip&&!st.acct,'opening the mode menu closes Account: '+JSON.stringify(st));
  // 5. mode menu: Escape from a choice returns focus to the chip
  await pg.click('#mslChipBtn'); await pg.waitForTimeout(150);
  await pg.focus('#mslChipBtn'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  await pg.keyboard.press('Tab'); await pg.waitForTimeout(100);
  assert.ok(await pg.evaluate(()=>!!document.activeElement.closest('#mslChipMenu')),'Tab moves into the mode menu');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  assert.ok(!(await state(pg)).chip,'Escape closes the mode menu');
  assert.ok(await pg.evaluate(()=>document.activeElement===document.getElementById('mslChipBtn')),'Escape in the mode menu hands focus to the chip, not <body>: '+await active(pg));
  // 6. Settings: Tab and Shift+Tab stay inside, every way out gives focus back to Account
  async function openSettingsFromAccount(){
   await pg.focus('#mlsAccountMenuBtn'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
   await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(700);
   assert.ok((await state(pg)).settings,'Account & security opens Settings');
  }
  await openSettingsFromAccount();
  const outside=()=>pg.evaluate(()=>!document.getElementById('settingsModal').contains(document.activeElement));
  let escaped=[];
  for(let i=0;i<40;i++){ await pg.keyboard.press('Tab'); if(await outside()) escaped.push(await active(pg)); }
  for(let i=0;i<8;i++){ await pg.keyboard.press('Shift+Tab'); if(await outside()) escaped.push('shift:'+await active(pg)); }
  assert.deepStrictEqual(escaped,[],'Tab never leaves the open Settings dialog');
  await pg.evaluate(()=>document.querySelector('#settingsModal .modal-x').focus()); await pg.keyboard.press('Shift+Tab');
  assert.ok(!(await outside()),'Shift+Tab from the first control wraps to the last one inside Settings');
  //    a dialog stacked on Settings keeps its own Tab
  await pg.evaluate(()=>{ window.__mfConfirm=mlsConfirm('Stacked dialog check'); }); await pg.waitForTimeout(200);
  await pg.keyboard.press('Shift+Tab'); await pg.waitForTimeout(100);
  assert.ok(await pg.evaluate(()=>!!document.activeElement.closest('#_mlsAskDialog')),'Settings does not pull focus out of a confirm dialog stacked on top of it: '+await active(pg));
  //    (the sample workspace blocks every 'Cancel' label, so dismiss through the button's own handler)
  await pg.evaluate(()=>document.getElementById('_mlsAskNo').onclick()); await pg.waitForTimeout(200);
  assert.ok((await state(pg)).settings,'Settings is still open under the dismissed confirm');
  //    a layer over Settings that is NOT a dialog keeps its own Tab too (menufocus-1.0.1): the
  //    billing code table editor (#mlsCtModal, no role) opened from Settings > Notes & AI. Its
  //    button is read-only-blocked in the sample workspace, so call what that button's click calls.
  const ctId=()=>pg.evaluate(()=>document.activeElement.id||document.activeElement.tagName);
  await pg.evaluate(()=>window.__mlsCodeTable.openEditor()); await pg.waitForTimeout(300);
  await pg.click('#mlsCtText');
  const ctSeq=[]; for(let i=0;i<4;i++){ await pg.keyboard.press('Tab'); ctSeq.push(await ctId()); }
  assert.deepStrictEqual(ctSeq,['mlsCtParse','mlsCtSave','mlsCtClear','mlsCtClose'],'Tab walks the code table editor stacked on Settings, not Settings behind it (1.0.0 sent it to the Settings x)');
  await pg.click('#mlsCtText'); await pg.keyboard.press('Shift+Tab');
  assert.strictEqual(await ctId(),'mlsCtFile','Shift+Tab stays in the code table editor (1.0.0 sent it to the Settings Cancel)');
  await pg.click('#mlsCtClose'); await pg.waitForTimeout(200);
  assert.ok(!(await pg.evaluate(()=>!!document.getElementById('mlsCtModal')))&&(await state(pg)).settings,'Close shuts only the editor; Settings is still open');
  await pg.keyboard.press('Tab');
  assert.ok(!(await outside()),'with the editor gone, Tab belongs to Settings again: '+await active(pg));
  //    ...and so does the dock nub, which sits above every overlay
  await pg.click('#mlsDockNub'); await pg.waitForTimeout(300);
  await pg.keyboard.press('Tab');
  assert.ok(await pg.evaluate(()=>!!document.activeElement.closest('#mlsDockNubMenu')),'Tab from the dock nub walks its own menu, not Settings behind it: '+await active(pg));
  await pg.click('#mlsDockNub'); await pg.waitForTimeout(200);
  assert.ok((await state(pg)).settings&&await pg.evaluate(()=>document.getElementById('mlsDockNubMenu').hasAttribute('hidden')),'the nub menu closes and Settings stays open');
  //    a control the overlay COVERS is still pulled back into Settings, both directions
  await pg.evaluate(()=>document.getElementById('mlsAccountMenuBtn').focus()); await pg.keyboard.press('Tab');
  assert.ok(!(await outside()),'Tab from the covered Account button goes into Settings: '+await active(pg));
  await pg.evaluate(()=>document.getElementById('mlsAccountMenuBtn').focus()); await pg.keyboard.press('Shift+Tab');
  assert.ok(!(await outside()),'Shift+Tab from the covered Account button goes into Settings: '+await active(pg));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
  assert.ok(!(await state(pg)).settings,'Escape closes Settings');
  assert.ok(await onAccountBtn(pg),'Escape on Settings gives focus back to the Account button: '+await active(pg));
  await openSettingsFromAccount();
  await pg.click('#settingsModal .modal-x'); await pg.waitForTimeout(400);
  assert.ok(!(await state(pg)).settings,'x closes Settings');
  assert.ok(await onAccountBtn(pg),'x on Settings gives focus back to the Account button: '+await active(pg));
  await openSettingsFromAccount();
  //    the footer Close/Cancel is read-only-blocked in the sample workspace, so run its own handler
  await pg.evaluate(()=>{ const c=document.querySelector('#settingsModal .modal > .row button[onclick="closeSettings()"]'); c.focus(); c.onclick(); }); await pg.waitForTimeout(400);
  assert.ok(!(await state(pg)).settings,'the footer Close/Cancel handler closes Settings');
  assert.ok(await onAccountBtn(pg),'Close/Cancel gives focus back to the Account button: '+await active(pg));
  //    after close, Tab is free again, and a stray closeSettings() never moves focus
  await pg.focus('#mslChipBtn'); await pg.evaluate(()=>closeSettings()); await pg.waitForTimeout(100);
  assert.ok(await pg.evaluate(()=>document.activeElement===document.getElementById('mslChipBtn')),'closeSettings() on a closed dialog leaves focus alone');
  // 7. Recent (N): the first chart is focused on open, arrows walk, Escape and Tab leave from the button
  await pg.evaluate(()=>showView('patients')); await pg.waitForTimeout(600);
  for(const id of ['preview-patient-002','preview-patient-003']){ await pg.evaluate(id=>window.__mlsPatientLock.switchAsDoctor(id),id); await pg.waitForTimeout(600); }
  await pg.evaluate(()=>showView('patients'));
  await pg.waitForFunction(()=>{const x=document.querySelector('#mlsRecentPts .mrp-btn'),n=x&&/Recent \((\d+)\)/.exec(x.textContent);return x&&!x.disabled&&x.getBoundingClientRect().width>0&&n&&+n[1]>=2;},null,{timeout:15000});
  await pg.focus('#mlsRecentPts .mrp-btn'); await pg.keyboard.press('Tab');
  const afterBtn=await active(pg);
  await pg.focus('#mlsRecentPts .mrp-btn'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  const rec=await pg.evaluate(()=>{const m=document.getElementById('mlsRecentPtsMenu');return m&&{role:m.getAttribute('role'),n:m.querySelectorAll('.mrp-item').length,firstFocused:document.activeElement===m.querySelector('.mrp-item')};});
  assert.ok(rec,'Enter on Recent opens its menu');
  assert.ok(rec.n>=2,'the Recent menu lists the other charts: '+JSON.stringify(rec));
  assert.strictEqual(rec.role,'menu');
  assert.ok(rec.firstFocused,'opening Recent puts the keyboard on the first chart (it used to be 15 Tabs away)');
  await pg.keyboard.press('ArrowDown');
  assert.ok(await pg.evaluate(()=>document.activeElement===document.querySelectorAll('#mlsRecentPtsMenu .mrp-item')[1]),'ArrowDown moves to the next chart');
  await pg.keyboard.press('ArrowUp');
  assert.ok(await pg.evaluate(()=>document.activeElement===document.querySelector('#mlsRecentPtsMenu .mrp-item')),'ArrowUp moves back');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
  assert.ok(!(await pg.evaluate(()=>!!document.getElementById('mlsRecentPtsMenu'))),'Escape closes the Recent menu');
  assert.ok(await pg.evaluate(()=>document.activeElement===document.querySelector('#mlsRecentPts .mrp-btn')),'Escape hands focus back to the Recent button: '+await active(pg));
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(200); await pg.keyboard.press('Tab'); await pg.waitForTimeout(150);
  assert.ok(!(await pg.evaluate(()=>!!document.getElementById('mlsRecentPtsMenu'))),'Tab closes the Recent menu');
  assert.strictEqual(await active(pg),afterBtn,'Tab out of the Recent menu continues from the button, not from the end of the page');
  await pg.keyboard.press('Shift+Tab'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(200); await pg.keyboard.press('Shift+Tab'); await pg.waitForTimeout(150);
  assert.ok(await pg.evaluate(()=>!document.getElementById('mlsRecentPtsMenu')&&document.activeElement===document.querySelector('#mlsRecentPts .mrp-btn')),'Shift+Tab out of the Recent menu lands on its button');
  //    keyboard pick still switches the chart
  const before=await pg.evaluate(()=>getActivePtId());
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(200);
  const pick=await pg.evaluate(()=>document.activeElement.getAttribute('data-id'));
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(700);
  assert.ok(pick&&pick!==before&&await pg.evaluate(()=>getActivePtId())===pick,'Enter on a Recent chart opens that chart');
  assert.deepStrictEqual(errs,[],'no page errors (desktop)');

  // 8. phone: pointer use is unchanged - tap opens, tap outside closes, Settings returns focus to Account
  const ph=await boot({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const p2=ph.pg;
  await p2.tap('#mlsAccountMenuBtn'); await p2.waitForTimeout(200);
  assert.ok((await state(p2)).acct,'phone: tapping Account opens its menu');
  await p2.touchscreen.tap(200,520); await p2.waitForTimeout(200);
  assert.ok(!(await state(p2)).acct,'phone: tapping outside closes the Account menu');
  await p2.tap('#mlsAccountMenuBtn'); await p2.waitForTimeout(200);
  await p2.tap('#mlsAccountPopover [data-account-action="settings"]'); await p2.waitForTimeout(700);
  assert.ok((await state(p2)).settings,'phone: Account & security opens Settings');
  const phEsc=[]; for(let i=0;i<14;i++){ await p2.keyboard.press('Tab'); if(await p2.evaluate(()=>!document.getElementById('settingsModal').contains(document.activeElement))) phEsc.push(await active(p2)); }
  assert.deepStrictEqual(phEsc,[],'phone (hardware keyboard): Tab stays inside the full-screen Settings');
  await p2.tap('#settingsModal .modal-x'); await p2.waitForTimeout(400);
  assert.ok(!(await state(p2)).settings&&await onAccountBtn(p2),'phone: closing Settings gives focus back to Account');
  await p2.evaluate(()=>showView('patients')); await p2.waitForTimeout(600);
  /* switchAsDoctor: an explicit pick with no event behind it - a bare selectPatient() from a script is a machine arrival, which may not move off the chart the doctor chose (nonag-1.0.0) */
  for(const id of ['preview-patient-002','preview-patient-003']){ await p2.evaluate(id=>window.__mlsPatientLock.switchAsDoctor(id),id); await p2.waitForTimeout(600); }
  await p2.evaluate(()=>showView('patients'));
  await p2.waitForFunction(()=>{const x=document.querySelector('#mlsRecentPts .mrp-btn'),n=x&&/Recent \((\d+)\)/.exec(x.textContent);return x&&!x.disabled&&x.getBoundingClientRect().width>0&&n&&+n[1]>=2;},null,{timeout:15000});
  await p2.tap('#mlsRecentPts .mrp-btn'); await p2.waitForTimeout(250);
  const target=await p2.evaluate(()=>document.querySelectorAll('#mlsRecentPtsMenu .mrp-item')[1].getAttribute('data-id'));
  await p2.tap('#mlsRecentPtsMenu .mrp-item:nth-child(2)'); await p2.waitForTimeout(700);
  assert.strictEqual(await p2.evaluate(()=>getActivePtId()),target,'phone: tapping a Recent chart still opens it');
  assert.ok(!(await p2.evaluate(()=>!!document.getElementById('mlsRecentPtsMenu'))),'phone: the Recent menu closes after a pick');
  assert.deepStrictEqual(ph.errs,[],'no page errors (phone)');
  console.log('PASS header menus and Settings keep the keyboard on /ScribeFlow.html: Account closes on Escape/Tab-away with arrow keys and never overlaps the mode menu, the mode menu and Settings hand focus back to their opener, Settings contains Tab but leaves it to any layer painted over it (code table editor, dock nub), and Recent opens on its first chart and closes on Escape');
 } finally { await b.close(); srv.close(); }
});
