'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const begin = source.indexOf('    function _scheduleNoteD(');
const end = source.indexOf('    function _snapCapture(', begin);
assert(begin > 0 && end > begin);
const helper = source.slice(begin, end);
const mergeStart = source.indexOf('var mlsProv = (function () {');
const mergeEnd = source.indexOf('/* A schedule surface must be proven', mergeStart);
const prov = vm.runInNewContext(source.slice(mergeStart, mergeEnd) + '\nmlsProv;', {});
const conflictAt = source.indexOf("_legacyUnvRowsL.push({kind:'copy-name-conflict'");
assert(conflictAt > 0);
const conflictSource = source.slice(conflictAt, source.indexOf(';', conflictAt) + 1);
const conflictContext = { _legacyUnvRowsL: [], a: { name: 'Private Canary One', _conflictName: 'Private Canary Two', appointmentId: '40001', time: '8:00 AM' } };
vm.runInNewContext(conflictSource, conflictContext);
assert.strictEqual(conflictContext._legacyUnvRowsL[0].nameConflict, true);
assert(!/Canary|names/.test(JSON.stringify(conflictContext._legacyUnvRowsL)), 'schedule conflict diagnostics leaked patient names');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    const results = await page.evaluate(({ helper }) => {
      const api = new Function('doc', helper + ';return {_scheduleNoteD,_mergeScheduleNoteD};')(document);
      const full = ('Left L3-L5 injection, 09/14/2026.\n' + 'Preserve dose 40 mg, duration 30 minutes, authorization and procedure details. '.repeat(22)).trim();
      function row(text, id='40001') { const r=document.createElement('div');r.dataset.appointmentId=id;const f=document.createElement('div');f.className='appointment-reason';f.textContent=text;r.append(f);document.body.append(r);return r; }
      const r=row(full);
      const captured=api._scheduleNoteD(r,'','40001');
      const snapshot=r.outerHTML;r.dataset.appointmentId='40002';r.firstChild.textContent='Foreign note';
      const frozen=api._scheduleNoteD(r,snapshot,'40001');
      const changed=api._scheduleNoteD(r,'','40001');
      const huge=api._scheduleNoteD(row('X'.repeat(16001)),'','40001');
      const limit=api._scheduleNoteD(row('Y'.repeat(16000)),'','40001');
      const missing=row('');missing.firstChild.remove();
      const absent=api._scheduleNoteD(missing,'','40001');
      const empty=api._scheduleNoteD(row(''),'','40001');
      const conflict=row('First distinct field');const extra=document.createElement('span');extra.className='other-reason';extra.textContent='Second distinct field';conflict.append(extra);
      const ambiguous=api._scheduleNoteD(conflict,'','40001');
      const foreign=row(full);const nested=row('Foreign', '40002');foreign.append(nested);
      const wrongScope=api._scheduleNoteD(foreign,'','40001');
      const churn=row(full);Object.defineProperty(churn.firstChild,'textContent',{get(){churn.dataset.appointmentId='40002';return full;}});
      const recycled=api._scheduleNoteD(churn,'','40001');
      const target={};api._mergeScheduleNoteD(target,captured);api._mergeScheduleNoteD(target,absent);
      const retained=JSON.parse(JSON.stringify(target));
      api._mergeScheduleNoteD(target,api._scheduleNoteD(row('Different complete note'),'','40001'));
      const collision=JSON.parse(JSON.stringify(target));
      return {full,captured,frozen,changed,huge,limit,absent,empty,ambiguous,wrongScope,recycled,retained,collision,truncated:api._scheduleNoteD(r,'x'.repeat(60000),'40001')};
    }, { helper });
    for (const key of ['captured','frozen']) { assert.strictEqual(results[key].text,results.full);assert.strictEqual(results[key].receipt.complete,true);assert.strictEqual(results[key].receipt.chars,results.full.length); }
    assert(results.full.length>500,'fixture must exceed both old truncation limits');
    assert.strictEqual(results.limit.text.length,16000);
    for(const [key,status] of Object.entries({changed:'row-changed',huge:'too-large',absent:'source-not-rendered',ambiguous:'conflicting-fields',wrongScope:'row-changed',recycled:'row-changed',truncated:'snapshot-truncated'})){assert.strictEqual(results[key].receipt.complete,false,key);assert.strictEqual(results[key].receipt.status,status,key);assert.strictEqual(results[key].text,'',key);}
    assert.strictEqual(results.empty.receipt.status,'empty');assert.strictEqual(results.empty.receipt.complete,true);
    assert.strictEqual(results.retained.schedulingNote,results.full,'a later unrendered copy erased a complete captured field');
    assert.strictEqual(results.collision.schedulingNoteReceipt.status,'conflicting-fields');assert.strictEqual(results.collision.schedulingNote,'');assert.strictEqual(results.collision.reason,'');
    for(const value of Object.values(results)){if(value&&value.receipt)assert(!/injection|Foreign|dose|40 mg|40001/.test(JSON.stringify(value.receipt)),'note text/identity leaked into receipt');}
    const appointment={time:'8:00 AM',name:'Jane Sample',provider:'Synthetic_Doctor_MD',appointmentId:'40001'};
    const capturedRow={...appointment,reason:'Old snippet',schedulingNote:results.full,schedulingNoteReceipt:results.captured.receipt};
    const merged=prov.merge({appts:[{...appointment},capturedRow],providers:[],diag:{}},{appts:[],providers:[],diag:{}});
    assert.strictEqual(merged.appts.length,1);assert.strictEqual(merged.appts[0].schedulingNote,results.full);assert.strictEqual(merged.appts[0].reason,results.full);
    const serialized=JSON.parse(JSON.stringify(merged.appts[0]));assert.strictEqual(serialized.schedulingNote,results.full);
    const two=prov.merge({appts:[capturedRow,{...capturedRow,appointmentId:'40002',schedulingNote:'Other appointment'}],providers:[],diag:{}},{appts:[],providers:[],diag:{}});
    assert.strictEqual(two.appts.length,2,'same-name different appointments merged scheduling notes');
    const collision=prov.merge({appts:[capturedRow,{...capturedRow,schedulingNote:'Conflict'}],providers:[],diag:{}},{appts:[],providers:[],diag:{}});
    assert.strictEqual(collision.appts[0].schedulingNoteReceipt.complete,false);
    assert.strictEqual(collision.appts[0].reason,'','legacy reason must not revive a conflicting note');
    console.log('PASS complete scheduling note: full fields and snapshots, numeric/newline preservation, exact binding, churn/conflict/oversize refusal, merge/serialization and PHI-free receipts');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
