'use strict';

/* Real-Chrome, synthetic/no-PHI proof for the Avatar face transaction.
   The production reader and network are delayed independently so the suite can
   reproduce the exact races a user creates by editing or removing a portrait
   while Match is still working. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, '1p-feat_mls_avatar.js');
const source = fs.readFileSync(corePath, 'utf8');
const moduleEnd = source.lastIndexOf('})();');
assert(moduleEnd > 0, 'Avatar module terminator missing');

/* This instrumentation changes no decision. It only delays the existing image
   callback and exposes a synthetic kiosk controller so exact ownership can be
   observed without camera, microphone, patient data, or backend access. */
const servedSource = source.slice(0, moduleEnd) + `
  var __faceRaceTints = [];
  var __faceRaceKiosks = {};
  faceTintFromPortrait = function (dataUrl, then) {
    __faceRaceTints.push({ portrait:String(dataUrl || ''), then:then, settled:false });
  };
  window.__mlsAvatarFaceRaceTest = {
    mountSetup: function () { setupForm(document.getElementById('setupHost')); },
    tintState: function () { return __faceRaceTints.map(function (row, index) {
      return { index:index, portrait:row.portrait, settled:row.settled };
    }); },
    settleTint: function (index, result) {
      var row = __faceRaceTints[index];
      if (!row || row.settled) return false;
      row.settled = true;
      Promise.resolve().then(function () { row.then(result); });
      return true;
    },
    seedKiosk: function (label, portrait) {
      kiosk.open = true;
      kiosk.generation = (kiosk.generation | 0) + 1;
      kiosk.tinted = false; kiosk.photoFace = false; kiosk.tintPortrait = '';
      var record = { label:String(label), calls:[], destroyed:false };
      kiosk.face = {
        retint:function (look) { record.calls.push(faceLookSafe(look)); },
        destroy:function () { record.destroyed = true; }, mood:function(){}, talk:function(){}
      };
      __faceRaceKiosks[label] = record;
      kioskSetIdentity({ name:'Synthetic assistant', faceImage:String(portrait), faceMode:'drawn' });
      return { generation:kiosk.generation|0, tintPortrait:kiosk.tintPortrait };
    },
    kioskState: function (label) {
      var row = __faceRaceKiosks[label];
      return row ? { calls:row.calls.slice(), destroyed:row.destroyed } : null;
    }
  };
` + source.slice(moduleEnd);

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

const PORTRAIT = 'data:image/png;base64,U1lOVEhFVElDLVBPUlRSQUlU';
const PORTRAIT_B = 'data:image/png;base64,U1lOVEhFVElDLVBPUlRSQUlULUI=';
function config() {
  return { ok:true, config:{ name:'Synthetic Ava', intro:'', questions:['Synthetic question?'],
    tone:'friendly', voice:'coral', faceMode:'photo', faceImage:PORTRAIT,
    faceLook:{ skin:'#f0c8a0', hair:'#4e3b2a', shirt:'#2e6a4b', lip:'#a95f47',
      eyes:'#4a3423', hairStyle:'short', glasses:false, beard:'none', brows:'normal',
      nose:'straight', lips:'normal', faceShape:'oval', eyeSet:'normal', hairline:'full',
      age:'adult', browCol:'', cap:false, stethoscope:false } } };
}
function weakPixel() {
  return { look:{ hairStyle:'long' }, derived:['hairStyle'],
    refused:Array.from({length:13}, (_, index) => ({knob:'weak-' + index, reason:'synthetic refusal'})),
    found:['synthetic weak local read'], receipt:{ claimed:1, refused:13, examined:14,
      faceW:44, grid:256, srcKind:'photo', fromIllustration:false } };
}
function strongPixel() {
  const look = { skin:'#e9bd96', hair:'#271a12', hairStyle:'short', glasses:true,
    brows:'normal', eyes:'#4a3423', eyeSet:'normal', beard:'none' };
  return { look, derived:Object.keys(look), refused:Array.from({length:6}, (_, index) =>
    ({knob:'strong-refused-' + index, reason:'synthetic refusal'})), found:['synthetic strong read'],
    receipt:{ claimed:8, refused:6, examined:14, faceW:112, grid:256,
      srcKind:'photo', fromIllustration:false } };
}
function strongModel() {
  const look = { skin:'#e9bd96', hair:'#271a12', hairStyle:'short', glasses:true,
    brows:'normal', eyes:'#4a3423', eyeSet:'normal', beard:'none' };
  return { ok:true, look, claimed:Object.keys(look), unsure:[] };
}
function weakModel() {
  return { ok:true, look:{glasses:true,brows:'normal'}, claimed:['glasses','brows'],
    unsure:['skin','hair'] };
}

function harnessHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <main><div class="tools"></div><div id="visitView"></div><div id="setupHost"></div></main>
    <script>
      window.__mlsSessionEpoch=71;
      window.__mlsSessionAccount='avatar-race@example.test';
      window.__testToken='synthetic-token';
      window.bkToken=()=>window.__testToken;
      window.bkBase=()=>location.origin;
      window.uns=(key)=>'synthetic:'+key;
      window.getPatients=()=>[]; window.getActivePtId=()=>'';
      window.toast=()=>{};
      window.__requests=[];
      window.fetch=(url, options={})=>{
        const parsed=new URL(String(url),location.href);
        const row={id:window.__requests.length+1,path:parsed.pathname+parsed.search,
          method:String(options.method||'GET').toUpperCase(),body:String(options.body||''),settled:false};
        row.promise=new Promise((resolve,reject)=>{row.resolve=resolve;row.reject=reject;});
        window.__requests.push(row); return row.promise;
      };
      window.__settleRequest=(id,json,good=true)=>{
        const row=window.__requests.find(x=>x.id===id); if(!row||row.settled)return false;
        row.settled=true;row.resolve({ok:!!good,status:good?200:500,json:()=>Promise.resolve(json||{})});return true;
      };
      window.__requestState=()=>window.__requests.map(({id,path,method,body,settled})=>({id,path,method,body,settled}));
    </script>
    <script data-mls-install-token="avatar-face-race" src="/avatar.js"></script>
  </body></html>`;
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/avatar.js') {
        res.writeHead(200, {'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
        return res.end(servedSource);
      }
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(harnessHtml());
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch({channel:'chrome',headless:true});
  let failure = null;
  try {
    const page = await browser.newPage({viewport:{width:1100,height:900}});
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error && error.message || error)));
    await page.goto('http://127.0.0.1:' + server.address().port + '/', {waitUntil:'load'});
    await page.waitForFunction(() => window.__mlsAvatar && window.__mlsAvatar.installed === true);

    await page.evaluate(() => window.__mlsAvatarFaceRaceTest.mountSetup());
    await page.waitForFunction(() => window.__requests.some(r => r.path === '/api/avatar/config'));
    const configId = await page.evaluate(() => window.__requests.find(r => r.path === '/api/avatar/config').id);
    await page.evaluate(({id,value}) => window.__settleRequest(id,value), {id:configId,value:config()});
    await page.waitForSelector('#mlsAvLook_skin');

    async function clickMatch() {
      await page.getByRole('button',{name:/Match my photo/}).click();
      await page.waitForFunction((before) => window.__mlsAvatarFaceRaceTest.tintState().length > before,
        (await page.evaluate(() => window.__mlsAvatarFaceRaceTest.tintState().length)) - 1);
      const rows = await page.evaluate(() => window.__mlsAvatarFaceRaceTest.tintState());
      return rows[rows.length - 1].index;
    }
    async function settleTint(index, value) {
      ok(await page.evaluate(({index,value}) => window.__mlsAvatarFaceRaceTest.settleTint(index,value), {index,value}),
        'synthetic tint callback could not be settled');
      await page.waitForTimeout(0);
    }
    async function latestFacelook(afterId) {
      await page.waitForFunction((after) => window.__requests.some(r => r.id > after && r.path === '/api/avatar/office/facelook'), afterId);
      return page.evaluate((after) => window.__requests.filter(r => r.id > after && r.path === '/api/avatar/office/facelook').slice(-1)[0].id, afterId);
    }

    /* A manual edit after Match owns the new revision. A late local callback
       cannot even start the model request, much less erase that edit. */
    let beforeRequest = await page.evaluate(() => window.__requests.length);
    let tint = await clickMatch();
    await page.locator('#mlsAvLook_skin').evaluate((node) => {
      node.value='#dfaa86'; node.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await settleTint(tint, strongPixel());
    eq(await page.inputValue('#mlsAvLook_skin'), '#dfaa86', 'late local read overwrote a manual skin correction');
    eq(await page.evaluate((before) => window.__requests.filter(r => r.id > before && r.path === '/api/avatar/office/facelook').length, beforeRequest),
      0, 'a stale local read still started a model request');

    /* A manual edit while the model is pending invalidates the exact request. */
    beforeRequest = await page.evaluate(() => window.__requests.length);
    tint = await clickMatch();
    await settleTint(tint, weakPixel());
    let visionId = await latestFacelook(beforeRequest);
    await page.locator('#mlsAvLook_hair').evaluate((node) => {
      node.value='#382416'; node.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.evaluate(({id,value}) => window.__settleRequest(id,value), {id:visionId,value:strongModel()});
    await page.waitForTimeout(20);
    eq(await page.inputValue('#mlsAvLook_hair'), '#382416', 'late model read overwrote a manual hair correction');

    /* Weak pixels plus a coherent strong model read commit together. Before
       the response no control moves; afterward the one receipt proves all. */
    beforeRequest = await page.evaluate(() => window.__requests.length);
    tint = await clickMatch();
    const beforeCombined = await page.inputValue('#mlsAvLook_skin');
    await settleTint(tint, weakPixel());
    visionId = await latestFacelook(beforeRequest);
    eq(await page.inputValue('#mlsAvLook_skin'), beforeCombined, 'weak local evidence mutated the character before the combined decision');
    await page.evaluate(({id,value}) => window.__settleRequest(id,value), {id:visionId,value:strongModel()});
    await page.waitForFunction(() => window.__mlsAvatar.lastMatchReceipt && window.__mlsAvatar.lastMatchReceipt.wholeReadRefusal === false);
    eq(await page.inputValue('#mlsAvLook_skin'), '#e9bd96', 'strong combined evidence did not apply skin');
    eq(await page.inputValue('#mlsAvLook_hair'), '#271a12', 'strong combined evidence did not apply hair');
    const rescuedReceipt = await page.evaluate(() => window.__mlsAvatar.lastMatchReceipt);
    eq(rescuedReceipt.receipt.claimed, 8, 'combined receipt did not count the rescued evidence');
    eq(rescuedReceipt.receipt.examined, 14, 'combined receipt lost its fixed denominator');

    /* Two weak reads apply zero. The actual portrait remains the selected face. */
    await page.locator('#mlsAvLook_skin').evaluate((node) => {
      node.value='#dda77f'; node.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await page.locator('#mlsAvLook_hair').evaluate((node) => {
      node.value='#332116'; node.dispatchEvent(new Event('input',{bubbles:true}));
    });
    beforeRequest = await page.evaluate(() => window.__requests.length);
    tint = await clickMatch();
    await settleTint(tint, weakPixel());
    visionId = await latestFacelook(beforeRequest);
    await page.evaluate(({id,value}) => window.__settleRequest(id,value), {id:visionId,value:weakModel()});
    await page.waitForFunction(() => window.__mlsAvatar.lastMatchReceipt && window.__mlsAvatar.lastMatchReceipt.wholeReadRefusal === true);
    eq(await page.inputValue('#mlsAvLook_skin'), '#dda77f', 'weak combined evidence changed skin');
    eq(await page.inputValue('#mlsAvLook_hair'), '#332116', 'weak combined evidence changed hair');
    /* This session's saved config chose My photo deliberately (faceMode:'photo'
       at the top of this file), so the refusal must leave it exactly there.
       ⛔ avfit-1.0.0 changed what the SENTENCE says, by owner order 2026-08-17:
       the refusal used to promise "your real photo remains the patient-facing
       face" while ALSO forcing an untouched select to 'photo', which is how a
       doctor who never chose photo mode kept ending up in it. Nothing writes
       that select now, so the sentence names whichever face is really selected
       and says the control is the only thing that moves it. */
    eq(await page.inputValue('#mlsAvFaceMode'), 'photo', 'a deliberate My photo choice did not survive an incomplete match');
    const weakNote = await page.locator('#mlsAvLookNote').textContent();
    ok(/Your photo stays the patient-facing face/i.test(weakNote),
      'the refusal does not name the face that is actually selected: ' + weakNote);
    ok(/Face style only ever changes when you change it/i.test(weakNote),
      'the refusal does not tell the doctor that nothing moved his Face style');

    /* Removing the photo while a model read is pending invalidates that model
       response and leaves the previous receipt untouched. */
    const refusalAt = (await page.evaluate(() => window.__mlsAvatar.lastMatchReceipt)).at;
    beforeRequest = await page.evaluate(() => window.__requests.length);
    tint = await clickMatch();
    await settleTint(tint, weakPixel());
    visionId = await latestFacelook(beforeRequest);
    await page.getByRole('button',{name:'Remove face'}).click();
    await page.evaluate(({id,value}) => window.__settleRequest(id,value), {id:visionId,value:strongModel()});
    await page.waitForTimeout(20);
    eq((await page.evaluate(() => window.__mlsAvatar.lastMatchReceipt)).at, refusalAt,
      'a model response for a removed photo published a new receipt');

    /* Kiosk/account A's old Image.onload equivalent cannot retint the new B
       controller. The exact session, kiosk generation, portrait and controller
       identity all have to agree. */
    const tintBeforeKiosk = await page.evaluate(() => window.__mlsAvatarFaceRaceTest.tintState().length);
    await page.evaluate((portrait) => window.__mlsAvatarFaceRaceTest.seedKiosk('A',portrait), PORTRAIT);
    await page.evaluate((portrait) => window.__mlsAvatarFaceRaceTest.seedKiosk('B',portrait), PORTRAIT_B);
    let tintRows = await page.evaluate(() => window.__mlsAvatarFaceRaceTest.tintState());
    eq(tintRows.length, tintBeforeKiosk + 2, 'kiosk derivation did not queue both synthetic portraits');
    await settleTint(tintRows[tintBeforeKiosk].index, strongPixel());
    eq((await page.evaluate(() => window.__mlsAvatarFaceRaceTest.kioskState('B'))).calls.length, 0,
      'old kiosk portrait retinted the new controller');
    await settleTint(tintRows[tintBeforeKiosk + 1].index, strongPixel());
    const kioskB = await page.evaluate(() => window.__mlsAvatarFaceRaceTest.kioskState('B'));
    eq(kioskB.calls.length, 1, 'current kiosk portrait did not retint its own controller');
    eq(kioskB.calls[0].skin, '#e9bd96', 'current kiosk retint lost the proven skin value');

    eq(pageErrors.length, 0, 'Avatar race proof raised page errors: ' + pageErrors.join(' | '));
    await page.close();
  } catch (error) {
    failure = error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (failure) throw failure;
  console.log('PASS 1p avatar face async ownership: ' + checks + ' assertions');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
