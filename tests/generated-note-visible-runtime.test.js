'use strict';
// Full shipped shell/action; synthetic engine result only. Independent painted-word
// measurement is shared with the existing Review landing property, not production.
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const oldControl = process.env.MLS_EXPECT_OLD_NOTE_HIDDEN === '1';
const oldBundle = oldControl ? require('child_process').execFileSync('git',['show','6fd82d4d7b0162194e0bdfa340a0b0ead584d3e7:1p-mls-connect.js'],{cwd:root,maxBuffer:20*1024*1024}) : null;
const instrument = fs.readFileSync(path.join(__dirname, 'review-note-tab-lands-on-the-note-runtime.test.js'), 'utf8');
const measure = eval('(' + instrument.slice(instrument.indexOf('function measureNoteOnScreen('), instrument.indexOf('\nasync function goToReview')) + ')');
const NOTE = 'SUBJECTIVE: Synthetic patient reports a mild sore throat for three days.\n\nOBJECTIVE: Temperature ninety eight point six degrees and lungs clear to auscultation.\n\nASSESSMENT: Synthetic viral pharyngitis without complication.\n\nPLAN: Synthetic supportive care and follow up as needed.';
const server = http.createServer((req,res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (oldBundle && file.endsWith('1p-mls-connect.js')) {res.writeHead(200,{'content-type':'text/javascript'});res.end(oldBundle);return;}
  if (!file.startsWith(root + path.sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(file,(err,data)=>{res.writeHead(err?404:200, {'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream'});res.end(err?'':data);});
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  await page.goto('http://127.0.0.1:'+server.address().port+'/1pScribeFlow.html',{waitUntil:'load'});
  await page.evaluate(()=>window.__mlsEnsureUiBundle());
  await page.waitForFunction(()=>!!window.__mlsSimpleLayer);
  await page.waitForTimeout(6000);
  await page.evaluate(()=>{
   document.getElementById('authScreen').style.display='none';document.getElementById('appScreen').style.display='';
   window.__mlsHarnessAccountEmail='generated-note@mlsscribe.test';
   savePatients([{id:'synthetic-generated',name:'Sample Ada',dob:'1970-01-01',mrn:'MRN100000',notes:[],visits:[]}]);
   selectPatient('synthetic-generated');
   document.getElementById('transcript').value='Synthetic patient with three days of sore throat. Lungs clear. Supportive care discussed.';
   document.getElementById('transcript').dispatchEvent(new Event('input',{bubbles:true}));
   window.__mlsEasyV3.open('doctor');
   window.__generationCount=0;
   // The only substituted boundary is the network-backed generator, after the
   // actual visible lane and canonical Easy action have dispatched to genBtn.
   window.generateNote=function(){
    const runId=++window.__generationCount;
    window.dispatchEvent(new CustomEvent('mls:generation-started',{detail:{source:'generation-engine',runId}}));
    setTimeout(()=>{
     document.getElementById('noteBox').value=window.__syntheticNote;
     document.getElementById('noteBox').dispatchEvent(new Event('input',{bubbles:true}));
     window.dispatchEvent(new CustomEvent('mls:generation-settled',{detail:{source:'generation-engine',runId,status:'success'}}));
    },100);
   };
  });
  await page.evaluate(n=>window.__syntheticNote=n,NOTE);
  await page.waitForTimeout(2000);
  await page.locator('#ez3flGen').click();
  await page.waitForTimeout(2500);
  const result=await page.evaluate(measure,NOTE);
  console.log('GENERATE_VIEWPORT',JSON.stringify(result));
  assert.equal(await page.evaluate(()=>window.__generationCount),1,'shipped Generate dispatched exactly once');
  if(oldControl) assert.equal(result.anyOnScreen,false,'positive control must detect hidden old result');
  else {
   assert.equal(result.anyOnScreen,true,'generated note words must immediately paint in viewport');
   assert.equal(await page.locator('#ez3Note').isEditable(),true,'canonical note immediately editable');
   assert.equal(await page.locator('#ez3Note').count(),1,'one canonical editor');
   assert.equal(await page.locator('#ez3flReview').isVisible(),true,'existing primary review action remains visible');
   await page.locator('#ez3Note').fill(NOTE+'\nSynthetic unsaved edit.');
   assert.equal(await page.locator('#noteBox').inputValue(),NOTE+'\nSynthetic unsaved edit.','existing two-way editor retained');
   await page.evaluate(()=>window.__mlsEasyV3.open('doctor'));
   await page.waitForTimeout(1000);
   assert.equal(await page.locator('#ez3Note').inputValue(),NOTE+'\nSynthetic unsaved edit.','restored view retains unsaved edits');
   assert.equal(await page.locator('#ez3Note').isEditable(),true,'restored view editable');
   await page.evaluate(()=>document.getElementById('ez3Regen').click());
   await page.waitForTimeout(1400);
   assert.equal(await page.evaluate(()=>window.__generationCount),2,'repeat generation dispatches once');
   assert.equal(await page.locator('#ez3Note').isEditable(),true,'repeat generation remains editable');
   assert.equal(await page.locator('#ez3Note').count(),1,'repeat generation does not duplicate editor');
   for(const width of [1280,1366]) {
    await page.setViewportSize({width,height:width===390?844:600});
    await page.waitForTimeout(600);
    const layout=await page.evaluate(measure,NOTE);
    console.log('LAYOUT',width,JSON.stringify(layout));
    assert.equal(layout.anyOnScreen,true,'note words visible at width '+width);
   }
   await page.setViewportSize({width:1366,height:900});
   const before=await page.locator('#noteBox').inputValue();
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mls:generation-settled',{detail:{source:'generation-engine',runId:1,status:'failed',message:'Synthetic failure'}})));
   await page.waitForTimeout(300);
   assert.equal(await page.locator('#noteBox').inputValue(),before,'failure preserves existing note');
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('mls:generation-refused',{detail:{source:'generation-engine',runId:2,message:'Synthetic refusal'}})));
   assert.equal(await page.locator('#noteBox').inputValue(),before,'refusal preserves existing note');
   assert.equal(await page.evaluate(()=>getActivePtId()),'synthetic-generated','no patient advance');
   assert.equal(await page.locator('#mlsAthenaUnifiedConfirm').count(),0,'no automatic Athena review/write');
  }
  console.log('PASS generated note viewport property');
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
