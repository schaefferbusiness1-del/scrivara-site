'use strict';
/* Tools, the MLS Assistant panel, the Legal / IME sheet and the phone dock tell
   the truth about what is on top (tooldock-1.0.0). Found by the ScribeFlow.html
   bug hunt (hunt:tools, hunt:phone-dock):
   - with the Assistant open, Tools opened UNDER the panel (9500 vs 2147483601),
     the panel sat on the left dock (left:80px vs a rail ending at 119px) and
     its own tooltips painted under it;
   - the Legal / IME sheet (2147483000) buried the toast, the activity tray and
     the sample strip, so Print / Copy / blocked presses seemed to do nothing;
     sample toasts on a desktop were also painted under the strip;
   - on a phone the Tools menu lost "MLS Assistant" (an inline presentation
     hide read as "gated off"), the Navigation Auto-hide row and the taskbar
     placement rows offered choices that cannot take effect there, the dock pill
     stayed on Tools after the dock band resized the buttons, the iPhone
     "Add MLS to your Home Screen" card covered the lifted sample dock, and the
     Legal row summaries were squeezed to 3px across "Expand";
   - the Assistant's "Pull from athenaOne" button was fixed at 42px while its
     sentence spilled out of it.
   And the review of that fix (tooldock-1.0.1): kept clear of the dock and the
   strip, the panel can be SHORTER than its ~440-520px of fixed rows - at
   375x667 on an iPhone and 1366x657 with a top dock its only scroller
   (.as-body) collapsed to 1px, and the input and footer were clipped below an
   edge nothing could scroll. The short screens below must keep a readable
   conversation, reach the input by a real scroll, and keep Close on screen.
   Real Chrome on /ScribeFlow.html?preview=1, desktop 1400x900 and an iPhone at
   390x844. The sample workspace never contacts the network: every
   non-127.0.0.1 request is answered 503 here. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const IPHONE='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(f)]||'application/octet-stream','cache-control':'no-store'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const url='http://127.0.0.1:'+srv.address().port+'/ScribeFlow.html?preview=1';
 /* Is the element really on top at its own centre (and two side points)? A
    notice is pointer-events:none, which elementFromPoint skips, so it is made
    hit-testable for the one measurement. */
 const onTop=(pg,sel)=>pg.evaluate((sel)=>{const el=document.querySelector(sel);if(!el)return 'missing';const r=el.getBoundingClientRect();if(!r.width||!r.height)return 'no box';
   const pe=el.style.pointerEvents;el.style.pointerEvents='auto';
   const miss=[[r.left+r.width/2,r.top+r.height/2],[r.left+5,r.top+r.height/2],[r.right-5,r.top+r.height/2]].map(([x,y])=>{const e=document.elementFromPoint(x,y);return e&&el.contains(e)?'':((e&&(e.id||e.className||e.tagName))+'');}).filter(Boolean);
   el.style.pointerEvents=pe;return miss.length?'covered by '+miss.join(', '):'on top';},sel);
 /* A panel that is clear of the dock and the strip must still be USABLE when
    the room left is short: the conversation keeps real height, Close stays on
    screen, and the input and footer are reached by scrolling the panel (a
    real wheel on a desktop; on a touch screen the panel's own scroll). */
 const usable=async(pg,label,wheel)=>{
  const geo=()=>pg.evaluate(()=>{const p=document.getElementById('mlsAsstPanel'),pr=p.getBoundingClientRect(),d=document.getElementById('mlsDock').getBoundingClientRect(),s=document.getElementById('mlsPublicPreviewStrip').getBoundingClientRect();
    const ov=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;
    const at=sel=>{const e=p.querySelector(sel),r=e.getBoundingClientRect();if(r.top<pr.top-1||r.bottom>pr.bottom+1)return false;const x=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!x&&e.contains(x);};
    return {open:p.classList.contains('open'),h:Math.round(pr.height),vh:innerHeight,onDock:ov(pr,d),onStrip:ov(pr,s),body:Math.round(p.querySelector('.as-body').getBoundingClientRect().height),
      oy:getComputedStyle(p).overflowY,st:p.scrollTop,close:at('.as-x'),input:at('.as-input textarea'),foot:at('.as-foot')};});
  await pg.evaluate(()=>window.__mlsAsst.open()); await pg.waitForTimeout(800);
  const a=await geo();
  assert.ok(a.open,label+': the Assistant opens');
  assert.ok(!a.onDock&&!a.onStrip,label+': the Assistant panel covers the dock or the sample strip: '+JSON.stringify(a));
  assert.ok(a.body>=100,label+': the conversation / Schedule area is squeezed to '+a.body+'px in a '+a.h+'px panel');
  assert.ok(a.close,label+': the Close button is not on screen when the panel opens: '+JSON.stringify(a));
  /* the Pull button, brought into view the way focus or a finder does it,
     scrolls the panel - Close stays pinned on top */
  await pg.evaluate(()=>{window.__mlsAsst.setTab('schedule');document.querySelector('#mlsAsstPanel .as-pullbtn').scrollIntoView({block:'nearest'});}); await pg.waitForTimeout(400);
  assert.ok((await geo()).close,label+': bringing Pull from athenaOne into view took the Close button off the panel');
  await pg.evaluate(()=>{const p=document.getElementById('mlsAsstPanel');p.scrollTop=0;window.__mlsAsst.setTab('chat');}); await pg.waitForTimeout(400);
  if(wheel){const r=await pg.locator('#mlsAsstPanel .as-status').boundingBox();await pg.mouse.move(r.x+r.width/2,r.y+r.height/2);await pg.mouse.wheel(0,1500);}
  else { assert.ok(/auto|scroll/.test(a.oy),label+': the panel is taller than its room but cannot be scrolled (overflow-y '+a.oy+')'); await pg.evaluate(()=>{const p=document.getElementById('mlsAsstPanel');p.scrollTop=p.scrollHeight;}); }
  await pg.waitForTimeout(500);
  const z=await geo();
  assert.ok(z.input&&z.foot,label+': the message input / footer cannot be scrolled into the panel: '+JSON.stringify(z));
  assert.ok(z.close,label+': scrolled to the input, the Close button left the panel: '+JSON.stringify(z));
  assert.ok(z.body>=100,label+': scrolled to the input, the conversation is '+z.body+'px');
  await pg.evaluate(()=>window.__mlsAsst.close()); await pg.waitForTimeout(300);
 };
 const boot=async(pg)=>{
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.fulfill({status:503,body:'x'}));
  await pg.goto(url);
  await pg.waitForFunction(()=>!!(document.querySelector('#mlsDock button[data-dest="tools"]')&&document.documentElement.getAttribute('data-mls-dock-band')&&window.__mlsAsst&&window.__mlsAsst.installed&&window.__mlsQuietNotify),null,{timeout:60000});
  await pg.waitForTimeout(2000);
 };
 try{
  /* ================= DESKTOP ================= */
  {
   const ctx=await b.newContext({viewport:{width:1400,height:900}});
   const pg=await ctx.newPage();
   const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
   await boot(pg);
   /* a sample-workspace notice is not painted under the sample strip */
   await pg.evaluate(()=>window.toast('Could not open the local print view.','err')); await pg.waitForTimeout(500);
   assert.strictEqual(await onTop(pg,'#toast'),'on top','a desktop sample notice is painted under the sample strip');
   /* the Assistant panel clears the dock and the strip; its tip is above it */
   await pg.click('#mlsDock button[data-dest="tools"]'); await pg.waitForTimeout(700);
   await pg.locator('#mlsToolsMenu .r',{hasText:'MLS Assistant'}).click(); await pg.waitForTimeout(1200);
   const g=await pg.evaluate(()=>{const p=document.getElementById('mlsAsstPanel'),d=document.getElementById('mlsDock'),s=document.getElementById('mlsPublicPreviewStrip');const pr=p.getBoundingClientRect(),dr=d.getBoundingClientRect(),sr=s.getBoundingClientRect();
     const btns=[...d.querySelectorAll(':scope > button')].filter(x=>x.offsetWidth).map(x=>{const r=x.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width*0.75,r.top+r.height/2);return x.contains(e);});
     const pull=p.querySelector('.as-pullbtn'),sub=pull&&pull.querySelector('.mlsac-sub');const br=pull.getBoundingClientRect(),su=sub?sub.getBoundingClientRect():br;
     return {open:p.classList.contains('open'),left:pr.left,bottom:pr.bottom,dockRight:dr.right,stripTop:sr.top,btns,tipZ:+getComputedStyle(document.getElementById('mlsTip')).zIndex,panelZ:+getComputedStyle(p).zIndex,
       pull:{top:br.top,bottom:br.bottom,subTop:su.top,subBottom:su.bottom,over:pull.scrollHeight-pull.clientHeight}};});
   assert.ok(g.open,'Tools > MLS Assistant opens the panel');
   assert.ok(g.left>=g.dockRight,`the Assistant panel starts at x ${g.left}, on top of the dock that ends at ${g.dockRight}`);
   assert.ok(g.btns.length&&g.btns.every(Boolean),'every dock button is reachable with the Assistant open: '+JSON.stringify(g.btns));
   assert.ok(g.bottom<=g.stripTop+1,`the Assistant panel (bottom ${g.bottom}) covers the sample strip (top ${g.stripTop})`);
   assert.ok(g.tipZ>g.panelZ,`#mlsTip (z ${g.tipZ}) paints under the Assistant panel (z ${g.panelZ}) it explains`);
   assert.ok(g.pull.subTop>=g.pull.top-0.5&&g.pull.subBottom<=g.pull.bottom+0.5&&g.pull.over<=1,'the Pull from athenaOne sentence spills out of its button: '+JSON.stringify(g.pull));
   /* Tools, pressed with the panel open, is on top and every row is reachable */
   const tb=await pg.locator('#mlsDock button[data-dest="tools"]').boundingBox();
   await pg.mouse.click(tb.x+tb.width/2,tb.y+tb.height/2); await pg.waitForTimeout(800);
   const tm=await pg.evaluate(()=>{const m=document.getElementById('mlsToolsMenu');if(!m)return null;return {rows:[...m.querySelectorAll('.r')].map(x=>{const q=x.getBoundingClientRect();const e=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return {t:x.innerText.replace(/\s+/g,' ').trim(),top:x.contains(e)};}),panelOpen:document.getElementById('mlsAsstPanel').classList.contains('open')};});
   assert.ok(tm,'Tools opens with the Assistant open');
   assert.ok(tm.rows.length&&tm.rows.every(r=>r.top),'a Tools row is covered: '+JSON.stringify(tm.rows));
   assert.ok(tm.rows.some(r=>/MLS Assistant/.test(r.t)),'Tools offers MLS Assistant again once it has taken the floor');
   /* the Legal / IME sheet does not bury the toast, the tray or the strip */
   await pg.locator('#mlsToolsMenu .r',{hasText:'Legal / IME'}).click(); await pg.waitForTimeout(1200);
   assert.ok(await pg.evaluate(()=>!!document.getElementById('mlsP1LegalRoot')),'the Legal / IME sheet opens');
   await pg.evaluate(()=>window.toast('Could not open the local print view.','err')); await pg.waitForTimeout(500);
   assert.strictEqual(await onTop(pg,'#toast'),'on top','a notice raised in the Legal / IME sheet is painted under it');
   assert.strictEqual(await onTop(pg,'#mlsTrayBtn'),'on top','the activity tray (where "Chronology copied." lands) is painted under the Legal / IME sheet');
   const blk=pg.locator('#mlsP1LegalRoot [data-mls-preview-blocked="1"]:not([disabled])').first();
   await blk.scrollIntoViewIfNeeded(); const bb=await blk.boundingBox();
   await pg.mouse.click(bb.x+bb.width/2,bb.y+bb.height/2); await pg.waitForTimeout(500);
   assert.match(await pg.evaluate(()=>document.getElementById('mlsPublicPreviewStatus').textContent),/disabled/i,'a blocked press in the sheet explains itself in the sample strip');
   assert.strictEqual(await onTop(pg,'#mlsPublicPreviewStatus'),'on top','the sample strip that explains a blocked press is painted under the Legal / IME sheet');
   assert.deepStrictEqual(errs,[],'no desktop page errors');
   await ctx.close();
  }
  /* ================= SHORT SCREENS (tooldock-1.0.1) ================= */
  {
   /* a laptop with the dock on top: 245px above the panel is header and dock */
   const ctx=await b.newContext({viewport:{width:1366,height:657}});
   const pg=await ctx.newPage();
   const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
   await boot(pg);
   await pg.evaluate(()=>window.__mlsDock1p.side('top')); await pg.waitForTimeout(1200);
   assert.strictEqual(await pg.evaluate(()=>document.documentElement.getAttribute('data-mls-dock-band')),'top','the dock moved to the top');
   await usable(pg,'1366x657, dock on top',true);
   await pg.evaluate(()=>window.__mlsDock1p.side('bottom')); await pg.waitForTimeout(1200);
   await usable(pg,'1366x657, dock at the bottom',true);
   assert.deepStrictEqual(errs,[],'no short-desktop page errors');
   await ctx.close();
  }
  for(const [w,h] of [[375,667],[844,390]]){
   /* an iPhone SE-size screen, where the sample strip and the lifted dock
      leave ~447px, and a phone on its side (~218px) */
   const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:true,hasTouch:true,deviceScaleFactor:1,userAgent:IPHONE});
   const pg=await ctx.newPage();
   const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
   await boot(pg);
   await usable(pg,w+'x'+h+' phone',false);
   assert.deepStrictEqual(errs,[],'no '+w+'x'+h+' page errors');
   await ctx.close();
  }
  /* ================= iPHONE 390x844 ================= */
  {
   const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,userAgent:IPHONE});
   const pg=await ctx.newPage();
   const errs=[]; pg.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));
   await boot(pg);
   const tap=async(sel)=>{const r=await pg.locator(sel).first().boundingBox();await pg.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);};
   /* the pill sits on the current page after the band resized the buttons -
      measured before any dock tap, because a tap re-syncs it either way */
   const pill=await pg.evaluate(()=>{const d=document.getElementById('mlsDock'),p=d.querySelector('.mls-dock-pill').getBoundingClientRect(),a=d.querySelector('button[aria-current="page"]').getBoundingClientRect();return {band:document.documentElement.getAttribute('data-mls-dock-band'),dl:Math.round(Math.abs(p.left-a.left)),dw:Math.round(Math.abs(p.width-a.width))};});
   assert.strictEqual(pill.band,'bottom');
   assert.ok(pill.dl<2&&pill.dw<2,'the dock pill is not on the current page after boot: '+JSON.stringify(pill));
   /* the Home Screen card sits above the lifted dock; a dock tap navigates */
   const card=await pg.evaluate(()=>{const c=document.getElementById('mlsA2hsCard');if(!c)return null;const r=c.getBoundingClientRect(),d=document.getElementById('mlsDock').getBoundingClientRect();return {bottom:r.bottom,dockTop:d.top};});
   assert.ok(card,'a first iPhone visit shows the Add to Home Screen card');
   assert.ok(card.bottom<=card.dockTop,`the Home Screen card (bottom ${card.bottom}) covers the dock (top ${card.dockTop})`);
   await tap('#mlsDock button[aria-label="Patient"]'); await pg.waitForTimeout(900);
   assert.strictEqual(await pg.evaluate(()=>{const x=document.querySelector('#mlsDock button[aria-current="page"]');return x&&x.getAttribute('aria-label');}),'Patient','a tap on the Patient dock tab reaches the dock');
   await pg.evaluate(()=>{const n=[...document.querySelectorAll('#mlsA2hsCard button')].find(x=>/not now/i.test(x.textContent));if(n)n.click();});
   await tap('#mlsDock button[aria-label="Visit"]'); await pg.waitForTimeout(900);
   /* the mode chip offers no taskbar placement a phone cannot honour */
   await tap('#mslChipBtn'); await pg.waitForTimeout(600);
   const chip=await pg.evaluate(()=>[...document.querySelectorAll('#mslChipMenu button')].filter(x=>x.offsetWidth).map(x=>x.textContent.trim()));
   assert.ok(chip.length&&!chip.some(t=>/^(Side|Top$|Floating|Hide it until)/.test(t)),'the phone mode menu offers taskbar placements that cannot take effect: '+JSON.stringify(chip));
   await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
   /* Legal / IME rows: the summary is readable, never drawn across Expand;
      the sheet's notice and the sample strip stay on top */
   await tap('#mlsDock button[data-dest="tools"]'); await pg.waitForTimeout(800);
   await tap('#mlsToolsMenu [data-mls-legal-tools]'); await pg.waitForTimeout(1300);
   const sums=await pg.evaluate(()=>[...document.querySelectorAll('#mlsP1LegalRoot .p1l-disclose')].map(x=>{const s=x.querySelector('.sum'),c=x.querySelector('.cue').getBoundingClientRect();const rg=document.createRange();rg.selectNodeContents(s);
     return {id:s.id,w:Math.round(s.getBoundingClientRect().width),hitsCue:!!s.textContent.trim()&&[...rg.getClientRects()].some(q=>q.right>c.left&&q.left<c.right&&q.bottom>c.top&&q.top<c.bottom)};}));
   assert.ok(sums.length>=4,'the Legal / IME sheet has its disclosure rows');
   for(const s of sums){ assert.ok(!s.hitsCue,s.id+' is drawn across its Expand cue'); assert.ok(s.w>=100,s.id+' is squeezed to '+s.w+'px'); }
   await pg.evaluate(()=>window.toast('Could not open the local print view.','err')); await pg.waitForTimeout(500);
   assert.strictEqual(await onTop(pg,'#toast'),'on top','a phone notice raised in the Legal / IME sheet is painted under it');
   assert.strictEqual(await onTop(pg,'#mlsPublicPreviewStrip'),'on top','the sample strip is painted under the phone Legal / IME sheet');
   await pg.evaluate(()=>document.getElementById('mlsP1LegalClose').click()); await pg.waitForTimeout(600);
   /* Tools keeps MLS Assistant and drops the Auto-hide toggle */
   await tap('#mlsDock button[data-dest="tools"]'); await pg.waitForTimeout(800);
   const rows=await pg.evaluate(()=>[...document.querySelectorAll('#mlsToolsMenu .r')].map(x=>x.id||x.innerText.replace(/\s+/g,' ').trim()));
   assert.ok(rows.some(t=>/MLS Assistant/.test(t)),'the phone Tools menu has no MLS Assistant row: '+JSON.stringify(rows));
   assert.ok(!rows.includes('mlsP1DockMode'),'the phone Tools menu offers Navigation Auto-hide, which a phone never does');
   await tap('#mlsToolsMenu .r:has-text("MLS Assistant")'); await pg.waitForTimeout(1200);
   const ph=await pg.evaluate(()=>{const p=document.getElementById('mlsAsstPanel').getBoundingClientRect(),d=document.getElementById('mlsDock').getBoundingClientRect();return {open:document.getElementById('mlsAsstPanel').classList.contains('open'),left:p.left,right:p.right,bottom:p.bottom,dockTop:d.top,vw:innerWidth};});
   assert.ok(ph.open,'the phone Tools row opens the Assistant');
   assert.ok(ph.left>=0&&ph.right<=ph.vw&&ph.bottom<=ph.dockTop,'the phone Assistant panel leaves the screen or covers the dock: '+JSON.stringify(ph));
   assert.deepStrictEqual(errs,[],'no phone page errors');
   await ctx.close();
  }
  console.log('PASS tools/assistant/legal/phone dock on /ScribeFlow.html: Tools takes the floor over the Assistant, the panel clears the dock and strip and stays usable on short screens, the Legal / IME sheet keeps its feedback visible, and the phone keeps MLS Assistant, offers no dead dock choices, keeps the pill true, the Home Screen card off the dock, and the Legal rows readable');
 } finally { await b.close(); srv.close(); }
});
