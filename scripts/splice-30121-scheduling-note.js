'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let after = before;
const edits = [];
function replace(a, b) { assert(after.includes(a) && after.indexOf(a) === after.lastIndexOf(a), 'unique seam: ' + a.slice(0, 100)); after = after.replace(a, b); edits.push([a, b]); }
const anchor = '    function _snapCapture(row)';
const eol = before.slice(before.indexOf(anchor), before.indexOf(anchor) + 250).includes('\r\n') ? '\r\n' : '\n';
const helper = String.raw`    /* schedule-note-30121: preserve the complete exposed field, separately
       from the historical type snippet. Receipts carry counts/codes only. */
    function _scheduleNoteD(row,snapshot,appointmentId){
      var source=snapshot?'schedule-reason-snapshot':'schedule-reason-field';
      function answer(status,text,chars){return{text:text||'',receipt:{version:1,source:source,status:status,complete:status==='captured'||status==='empty',chars:chars||0}};}
      var wanted=String(appointmentId||'').trim();
      if(!wanted)return answer('appointment-unbound');
      var root=row;
      if(snapshot){
        if(snapshot.length>=60000)return answer('snapshot-truncated');
        try{var tpl=doc.createElement('template');tpl.innerHTML=snapshot;root=tpl.content;}catch(eNoteSnap){return answer('snapshot-unreadable');}
      }
      function bound(){
        try{
          if(!root||(!snapshot&&root.isConnected===false))return false;
          var ids={},nodes=[root].concat([].slice.call(root.querySelectorAll('[data-appointment-id], [data-appt-id], [data-appointmentid]')));
          nodes.forEach(function(n){['data-appointment-id','data-appt-id','data-appointmentid'].forEach(function(k){var v=n.getAttribute&&n.getAttribute(k);if(v&&String(v).trim())ids[String(v).trim()]=1;});});
          if(!Object.keys(ids).length)[].slice.call(root.querySelectorAll('a[href]')).forEach(function(n){var m=/[?&#/](?:appointmentid|appointment_id|appointment|apptid)[=\/:]([a-z0-9_-]{2,})/i.exec(String(n.getAttribute('href')||''));if(m)ids[m[1]]=1;});
          return Object.keys(ids).length===1&&ids[wanted]===1;
        }catch(eNoteBound){return false;}
      }
      if(!bound())return answer('row-changed');
      try{
        var fields=[].slice.call(root.querySelectorAll('[class*="reason"], [data-testid*="reason"], [aria-label*="reason"]'));
        if(!fields.length)return answer('source-not-rendered');
        var values=[],largest='';
        fields.forEach(function(n){var t=String(n.textContent||'').replace(/\r\n?/g,'\n').trim();if(values.indexOf(t)<0)values.push(t);if(t.length>largest.length)largest=t;});
        if(!bound())return answer('row-changed');
        if(largest.length>16000)return answer('too-large','',largest.length);
        if(values.some(function(t){return t&&largest.indexOf(t)<0;}))return answer('conflicting-fields');
        return answer(largest?'captured':'empty',largest,largest.length);
      }catch(eNoteRead){return answer('source-unreadable');}
    }
    function _mergeScheduleNoteD(target,note){
      if(!target||!note||!note.receipt)return;
      var prior=target.schedulingNoteReceipt;
      if(prior&&prior.status==='conflicting-fields')return;
      if(prior&&prior.complete&&note.receipt.complete&&String(target.schedulingNote||'')!==String(note.text||'')){target.schedulingNote='';target.schedulingNoteReceipt={version:1,source:'schedule-reason-field',status:'conflicting-fields',complete:false,chars:0};return;}
      if(prior&&prior.complete&&!note.receipt.complete)return;
      target.schedulingNote=note.text||'';target.schedulingNoteReceipt=note.receipt;
      if(note.receipt.complete&&note.text)target.reason=note.text;
    }
`;
if (!process.argv.includes('--follow-up') && !process.argv.includes('--finalize')) {
replace(anchor, helper.replace(/\n/g,eol) + anchor);
// Capture note fields from the same immutable snapshot used for recovered identity.
replace("rawKey:_legacyNormL(raw)});", "rawKey:_legacyNormL(raw)});_mergeScheduleNoteD(_legacyObsL[_legacyObsL.length-1],_scheduleNoteD(row,_snapCapture(row),appointmentId));");
replace("rawKey:_legacyNormL(_snapText(_lgSnap))});continue;", "rawKey:_legacyNormL(_snapText(_lgSnap))});_mergeScheduleNoteD(_legacyObsL[_legacyObsL.length-1],_scheduleNoteD(_lgRow,_lgSnap,_lgU.appointmentId||_lgIdn.appointmentId));continue;");
replace("rawKey:_legacyNormL(_lgRaw)});continue;", "rawKey:_legacyNormL(_lgRaw)});_mergeScheduleNoteD(_legacyObsL[_legacyObsL.length-1],_scheduleNoteD(_lgRow,'',_legacyObsL[_legacyObsL.length-1].appointmentId));continue;");
replace("reason:a.reason||'',status:a.status||'',dob:a.dob||'',mrn:a.mrn||''", "reason:a.reason||'',schedulingNote:a.schedulingNote||'',schedulingNoteReceipt:a.schedulingNoteReceipt||null,status:a.status||'',dob:a.dob||'',mrn:a.mrn||''");
replace("else{if(!prior.prov&&prov){prior.prov=prov;prior.providerKey=provKey;}if(!prior.reason)prior.reason=_reasonS(t);_mergeScheduleProofD(prior,proof);}", "else{if(!prior.prov&&prov){prior.prov=prov;prior.providerKey=provKey;}if(!prior.reason)prior.reason=_reasonS(t);_mergeScheduleProofD(prior,proof);}"+eol+"              _mergeScheduleNoteD(_candS[logicalKey],_scheduleNoteD(b,_snapCapture(b),anchor.appointmentId));");
replace("delete _pendingS[pk3];_snapRecoveredS++;return;", "_mergeScheduleNoteD(_candS[lkR],_scheduleNoteD(elR,snapR,aidR));delete _pendingS[pk3];_snapRecoveredS++;return;");
replace("reason:a.reason||'',status:a.status||'',appointmentId:a.appointmentId||'',dob:a.dob||'',mrn:a.mrn||''", "reason:a.reason||'',schedulingNote:a.schedulingNote||'',schedulingNoteReceipt:a.schedulingNoteReceipt||null,status:a.status||'',appointmentId:a.appointmentId||'',dob:a.dob||'',mrn:a.mrn||''");
// Existing identity reconciliation chooses the row; only exact same-ID copies
// may enrich its note. Conflicting complete copies remain explicitly incomplete.
replace('    function mergeRowFields(prior, a, lane) {', String.raw`    function mergeRowFields(prior, a, lane) {
      if (a && a.schedulingNoteReceipt && clean(prior.appointmentId) && clean(prior.appointmentId) === clean(a.appointmentId)) {
        var priorNote = prior.schedulingNoteReceipt, incomingNote = a.schedulingNoteReceipt;
        if (!(priorNote && priorNote.status === 'conflicting-fields')) {
          if (priorNote && priorNote.complete && incomingNote.complete && String(prior.schedulingNote || '') !== String(a.schedulingNote || '')) {
            prior.schedulingNote = ''; prior.schedulingNoteReceipt = {version:1,source:'schedule-reason-field',status:'conflicting-fields',complete:false,chars:0};
          } else if (!priorNote || !priorNote.complete || incomingNote.complete) {
            prior.schedulingNote = a.schedulingNote || ''; prior.schedulingNoteReceipt = incomingNote;
            if (incomingNote.complete && a.schedulingNote) prior.reason = a.schedulingNote;
          }
        }
      }`.replace(/\n/g,eol));
}
if (!process.argv.includes('--finalize')) replace('if(!prior.reason&&a.reason)prior.reason=a.reason;_mergeScheduleProofD(prior,a);return;', 'if(!prior.reason&&a.reason)prior.reason=a.reason;_mergeScheduleProofD(prior,a);if(prior.appointmentId&&prior.appointmentId===a.appointmentId)_mergeScheduleNoteD(prior,{text:a.schedulingNote||\'\',receipt:a.schedulingNoteReceipt});return;');
replace("if(prior&&prior.status==='conflicting-fields')return;", "if(prior&&prior.status==='conflicting-fields'){target.reason='';return;}");
replace("{target.schedulingNote='';target.schedulingNoteReceipt=", "{target.schedulingNote='';target.reason='';target.schedulingNoteReceipt=");
replace("prior.schedulingNote = ''; prior.schedulingNoteReceipt =", "prior.schedulingNote = ''; prior.reason = ''; prior.schedulingNoteReceipt =");
replace("if (!clean(prior[field]) && clean(a && a[field])) { prior[field] = a[field]; mergedFields++; }", "if (field === 'reason' && prior.schedulingNoteReceipt && prior.schedulingNoteReceipt.status === 'conflicting-fields') return;" + eol + "        if (!clean(prior[field]) && clean(a && a[field])) { prior[field] = a[field]; mergedFields++; }");
let inverse=after;
for(const [a,b] of edits.slice().reverse())inverse=inverse.replace(b,a);
assert.strictEqual(inverse,before,'inverse source-byte proof');
fs.writeFileSync(target,Buffer.from(after,'latin1'));
console.log('Preserved complete bound scheduling fields across reader/snapshot/merge seams.');
