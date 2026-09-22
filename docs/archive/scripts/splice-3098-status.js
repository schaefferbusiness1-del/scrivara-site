/* splice-3098-status.js — ext 3.0.98 status-1.0.0: capture per-row appointment
 * status from RAW row text BEFORE the name/reason scrubbers erase the vocabulary.
 * Additive only: no scrubber, STOP list, or gate is touched. 16 splices + manifest.
 * Run from repo root: node scripts/splice-3098-status.js
 */
'use strict';
var fs = require('fs');

var HELPER_MODULE = "  /* status-1.0.0 (3.0.98): per-row appointment status, read from the RAW row\n" +
  "     text BEFORE any scrub. The scrubbers below intentionally delete this exact\n" +
  "     vocabulary to keep names and reasons clean (correct - unchanged); the app's\n" +
  "     seen-ranking (tnSeenRank) and month attribution need it, so it is captured\n" +
  "     here first and rides each row as `status`. Conservative on purpose: only\n" +
  "     the -ed / hyphenated forms of check-in\\/out match, so reason prose like\n" +
  "     \"check in 3 months\" never mints a false checked-in. Fail-open: no match\n" +
  "     emits '' and the consumer falls back to the clock. */\n" +
  "  function mlsApptStatusFromRaw(t) { try { var s = ' ' + String(t == null ? '' : t).replace(/\\s+/g, ' ') + ' '; if (/\\bchecked[\\s-]?out\\b/i.test(s)) return 'checked out'; if (/\\bchecked[\\s-]?in\\b/i.test(s)) return 'checked in'; if (/\\b(?:with\\s+provider|in\\s+(?:exam\\s+)?room|roomed|ready\\s+for\\s+provider|intake\\s+complete)\\b/i.test(s)) return 'in room'; if (/\\barrived\\b/i.test(s)) return 'arrived'; if (/\\bno[\\s-]?show\\b/i.test(s)) return 'no show'; if (/\\bcancell?ed\\b/i.test(s)) return 'cancelled'; if (/\\bresched(?:uled)?\\b/i.test(s)) return 'rescheduled'; if (/\\bconfirmed\\b/i.test(s)) return 'confirmed'; if (/\\bscheduled\\b/i.test(s)) return 'scheduled'; return ''; } catch (e) { return ''; } }\n";

var HELPER_DRIVER = "    /* status-1.0.0 (3.0.98): same contract as mlsApptStatusFromRaw in the\n" +
  "       text\\/dom extractor module - injected-driver copy (this closure is\n" +
  "       serialized separately, so the module helper is not reachable here). */\n" +
  "    function _mlsApptStatusD(t){try{var s=' '+String(t==null?'':t).replace(/\\s+/g,' ')+' ';if(/\\bchecked[\\s-]?out\\b/i.test(s))return 'checked out';if(/\\bchecked[\\s-]?in\\b/i.test(s))return 'checked in';if(/\\b(?:with\\s+provider|in\\s+(?:exam\\s+)?room|roomed|ready\\s+for\\s+provider|intake\\s+complete)\\b/i.test(s))return 'in room';if(/\\barrived\\b/i.test(s))return 'arrived';if(/\\bno[\\s-]?show\\b/i.test(s))return 'no show';if(/\\bcancell?ed\\b/i.test(s))return 'cancelled';if(/\\bresched(?:uled)?\\b/i.test(s))return 'rescheduled';if(/\\bconfirmed\\b/i.test(s))return 'confirmed';if(/\\bscheduled\\b/i.test(s))return 'scheduled';return '';}catch(_e){return '';}}\n";

var edits = [
  /* A: extractor-module scope */
  { find: "  function firstTime(s) {",
    repl: HELPER_MODULE + "  function firstTime(s) {", n: 1 },
  { find: "out.appts.push({ time: tabTime, name: tabName, provider: tabProvider || '' });",
    repl: "out.appts.push({ time: tabTime, name: tabName, provider: tabProvider || '', status: mlsApptStatusFromRaw(ln) });", n: 1 },
  { find: "out.appts.push({ time: firstTime(ln), name: nm, provider: current || '' });",
    repl: "out.appts.push({ time: firstTime(ln), name: nm, provider: current || '', status: mlsApptStatusFromRaw(ln) });", n: 1 },
  { find: "providerId: ids.providerId || '', dob: identity.dob || '', mrn: identity.mrn || '' });",
    repl: "providerId: ids.providerId || '', dob: identity.dob || '', mrn: identity.mrn || '', status: mlsApptStatusFromRaw(rowText) });", n: 1 },
  { find: "providerId: ids2.providerId || '', dob: identity2.dob || '', mrn: identity2.mrn || '' });",
    repl: "providerId: ids2.providerId || '', dob: identity2.dob || '', mrn: identity2.mrn || '', status: mlsApptStatusFromRaw(n.text) });", n: 1 },
  { find: "'appt_date', 'reason'].forEach",
    repl: "'appt_date', 'reason', 'status'].forEach", n: 1 },
  /* B: injected-driver scope (sibling of _scheduleRowProofD) */
  { find: "    function _scheduleRowProofD(root){",
    repl: HELPER_DRIVER + "    function _scheduleRowProofD(root){", n: 1 },
  { find: "reason:_legacyReasonL(row),dob:rowProof.dob||''",
    repl: "reason:_legacyReasonL(row),status:_mlsApptStatusD(raw),dob:rowProof.dob||''", n: 1 },
  { find: "providerId:'',reason:'',dob:_lgIdn.dob||''",
    repl: "providerId:'',reason:'',status:_mlsApptStatusD(_snapText(_lgSnap)),dob:_lgIdn.dob||''", n: 1 },
  { find: "reason:_legacyReasonL(_lgRow),dob:_lgProof.dob||''",
    repl: "reason:_legacyReasonL(_lgRow),status:_mlsApptStatusD(_lgRaw),dob:_lgProof.dob||''", n: 1 },
  { find: "reason:a.reason||'',dob:a.dob||'',mrn:a.mrn||''};});",
    repl: "reason:a.reason||'',status:a.status||'',dob:a.dob||'',mrn:a.mrn||''};});", n: 1 },
  { find: "_candS[logicalKey]={prov:prov,time:tm,name:nm,reason:_reasonS(t),",
    repl: "_candS[logicalKey]={prov:prov,time:tm,name:nm,reason:_reasonS(t),status:_mlsApptStatusD(t),", n: 1 },
  { find: "_candS[lkR]={prov:p.prov||'',time:idnR.time||p.time,name:idnR.name,reason:'',",
    repl: "_candS[lkR]={prov:p.prov||'',time:idnR.time||p.time,name:idnR.name,reason:'',status:_mlsApptStatusD(_snapText(snapR)),", n: 1 },
  { find: "provider:a.prov||'',reason:a.reason||'',appointmentId:a.appointmentId||'',dob:a.dob||'',mrn:a.mrn||''};});",
    repl: "provider:a.prov||'',reason:a.reason||'',status:a.status||'',appointmentId:a.appointmentId||'',dob:a.dob||'',mrn:a.mrn||''};});", n: 1 },
  { find: "var row={time:tm,name:cl(nm),provider:prov||'',dob:proof.dob||'',mrn:proof.mrn||'',dobConflict:proof.dobConflict===true,mrnConflict:proof.mrnConflict===true};",
    repl: "var row={time:tm,name:cl(nm),provider:prov||'',status:_mlsApptStatusD(t),dob:proof.dob||'',mrn:proof.mrn||'',dobConflict:proof.dobConflict===true,mrnConflict:proof.mrnConflict===true};", n: 1 },
  { find: "out.appts.push({time:tm,name:cl(nm),provider:prov||'',dob:proof.dob||'',mrn:proof.mrn||''});",
    repl: "out.appts.push({time:tm,name:cl(nm),provider:prov||'',status:_mlsApptStatusD(rt),dob:proof.dob||'',mrn:proof.mrn||''});", n: 1 },
  { find: "out.appts.push({time:ft(n.t),name:nm2,provider:inRow||cur||'',dob:proof.dob||'',mrn:proof.mrn||''});",
    repl: "out.appts.push({time:ft(n.t),name:nm2,provider:inRow||cur||'',status:_mlsApptStatusD(n.t),dob:proof.dob||'',mrn:proof.mrn||''});", n: 1 }
];

var s = fs.readFileSync('background.js', 'latin1');
var total = 0;
for (var i = 0; i < edits.length; i++) {
  var e = edits[i];
  var n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': expected ' + e.n + ' hit(s), found ' + n + ' for: ' + e.find.slice(0, 80)); process.exit(1); }
  s = s.split(e.find).join(e.repl);
  total++;
}
fs.writeFileSync('background.js', s, 'latin1');

var m = fs.readFileSync('manifest.json', 'latin1');
var vc = m.split('"version": "3.0.97"').length - 1;
if (vc !== 1) { console.error('ABORT manifest: version anchor hits=' + vc); process.exit(1); }
m = m.split('"version": "3.0.97"').join('"version": "3.0.98"');
fs.writeFileSync('manifest.json', m, 'latin1');
console.log('OK: ' + total + ' background.js splices + manifest 3.0.97->3.0.98');
