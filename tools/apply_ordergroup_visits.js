/* v2.9.32 order-group visibility: athena's Visits list interleaves clinical
 * encounter rows with administrative "order group" rows. The bodies walker
 * correctly refuses to read a clinical body from them (no note document), but
 * silently dropping them read as "skipping every other visit" to the doctor.
 * Fix: file each order-group row's own visible line as an INDEX-ONLY
 * administrative entry OUTSIDE the verified clinical chain, and narrate the
 * skip in the progress feed. The clinical receipt chain is unchanged. */
'use strict';
const fs = require('fs');
const path = require('path');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
function edit(file, fn) {
  const p = path.join(__dirname, '..', file);
  const src = fs.readFileSync(p, 'latin1');
  const before = crCount(src);
  const out = fn(src);
  if (crCount(out) !== before) throw new Error(file + ': CR census changed');
  fs.writeFileSync(p, out, 'latin1');
  console.log('OK', file);
}
function replaceOnce(hay, oldStr, newStr, label) {
  const i = hay.indexOf(oldStr);
  if (i < 0) throw new Error('anchor missing: ' + label);
  if (hay.indexOf(oldStr, i + 1) >= 0) throw new Error('anchor not unique: ' + label);
  if (/[^\x00-\x7F]/.test(newStr)) throw new Error('non-ASCII: ' + label);
  return hay.slice(0, i) + newStr + hay.slice(i + oldStr.length);
}

edit('background.js', src => {
  let out = src;
  out = replaceOnce(out,
    "var visits = [], failures = [], retryCount = 0, minimalBodies = 0, attemptedCount = 0, administrativeRows = [];",
    "var visits = [], failures = [], retryCount = 0, minimalBodies = 0, attemptedCount = 0, administrativeRows = [], administrativeVisits = [];",
    'admin visits decl');
  out = replaceOnce(out,
    "        if (/^\\s*order\\s*group\\b/i.test(String(snap.type || ''))) {\n" +
    "          administrativeRows.push({ index: i, type: String(snap.type || '').slice(0, 60) });\n" +
    "          continue;\n" +
    "        }",
    "        if (/^\\s*order\\s*group\\b/i.test(String(snap.type || ''))) {\n" +
    "          administrativeRows.push({ index: i, type: String(snap.type || '').slice(0, 60) });\n" +
    "          /* v2.9.32: the doctor SEES these rows in athena's list - dropping\n" +
    "             them silently looked like \"skipping every other visit\". They\n" +
    "             have no clinical note body (the fresh-frame proof fails on them\n" +
    "             deterministically), so each row's own visible line is filed as\n" +
    "             an INDEX-ONLY administrative entry OUTSIDE the verified\n" +
    "             clinical chain, and the skip is narrated instead of silent. */\n" +
    "          administrativeVisits.push({\n" +
    "            date: snap.date || '', type: String(snap.type || '').slice(0, 80), raw: String(snap.rowText || '').slice(0, 1200),\n" +
    "            cpt: [], icd10: [], source: 'athena-order-group-index',\n" +
    "            indexOnly: true, administrative: true, fullDetail: false, bodyMinimal: false,\n" +
    "            encounterIndex: i, encounterId: (expected && expected.encounterId) || '', sourceVisitKey: (expected && expected.rowKey) || '', rowKey: (expected && expected.rowKey) || ''\n" +
    "          });\n" +
    "          emit(appTabId, frozenRequestId, 'Indexed order group ' + (i + 1) + ' of ' + total + ' (administrative row - no clinical note body).', i + 1, total);\n" +
    "          continue;\n" +
    "        }",
    'admin visits collect');
  out = replaceOnce(out,
    "      return { ok: true, identity: identity, visits: visits, diag: diag, strategy: 'bound-click', found: total, receipt: receipt };",
    "      return { ok: true, identity: identity, visits: visits, administrativeVisits: administrativeVisits, diag: diag, strategy: 'bound-click', found: total, receipt: receipt };",
    'admin visits response');
  return out;
});

edit('feat_mls_schedimport_exact.js', src => {
  let out = src;
  out = replaceOnce(out,
    '    var organization=safe(function(){return isFn(vm.organizePatientHistory)?vm.organizePatientHistory(target.patientId):null;},null);',
    '    /* v2.9.32 order-group entries: filed AFTER the strict clinical proof\n' +
    '       chain, as UNVERIFIED index-only rows (source athena-order-group-index)\n' +
    '       that reconcile intentionally never deletes. A failure here can never\n' +
    '       break the verified receipt - it only skips the extra entries. Re-pull\n' +
    '       is idempotent: an entry is added only when no stored visit already\n' +
    '       carries the same date + trimmed row text (or the same encounter id). */\n' +
    '    var administrativeSaved=0;\n' +
    '    safe(function(){\n' +
    '      var adminRows=Array.isArray(r.administrativeVisits)?r.administrativeVisits:[];\n' +
    '      if(!adminRows.length||!isFn(vm.addVisit)) return;\n' +
    '      var existing=safe(function(){return vm.getVisits(patientById(target.patientId))||[];},[]);\n' +
    '      function adminKey(v){var eid=String(v&&(v.encounterId||v.encounterID)||"").trim().toLowerCase();var body=String(v&&(v.raw||v.text||v.note||v.detail)||"").replace(/\\s+/g," ").trim().toLowerCase();return (String(v&&v.date||"")+"|"+(eid||body)).slice(0,400);}\n' +
    '      var seenKeys={};\n' +
    '      existing.forEach(function(v){seenKeys[adminKey(v)]=1;});\n' +
    '      adminRows.forEach(function(row){\n' +
    '        if(!row||!String(row.raw||"").trim()) return;\n' +
    '        var key=adminKey(row); if(!key||seenKeys[key]) return; seenKeys[key]=1;\n' +
    '        if(vm.addVisit(target.patientId,row,{source:"athena-order-group-index",indexOnly:true,administrative:true,bodyComplete:false})) administrativeSaved++;\n' +
    '      });\n' +
    '    });\n' +
    '    var organization=safe(function(){return isFn(vm.organizePatientHistory)?vm.organizePatientHistory(target.patientId):null;},null);',
    'admin filing');
  out = replaceOnce(out,
    'return { visitCount: safe(function () { return vm.getVisits(fresh).length; }, visits.length), persistedVisits: persisted.length, savedCount: savedCount, parsedVisits: parsed, expectedVisits: expected,',
    'return { visitCount: safe(function () { return vm.getVisits(fresh).length; }, visits.length), persistedVisits: persisted.length, savedCount: savedCount, administrativeSaved: administrativeSaved, parsedVisits: parsed, expectedVisits: expected,',
    'admin receipt field');
  return out;
});
console.log('DONE');
