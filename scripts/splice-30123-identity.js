'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..'), helpers=require('./exact-identity-30123');
const block=Object.values(helpers).map(f=>f.toString()).join('\n');
for(const file of ['background.js','write_safety_guard.js']) {
 const before=fs.readFileSync(path.join(root,file),'latin1'); let after=before; const edits=[];
 function rep(a,b){assert(after.includes(a)&&after.indexOf(a)===after.lastIndexOf(a),'unique seam '+a.slice(0,100));after=after.replace(a,b);edits.push([a,b]);}
 function span(a,b,body){const at=after.indexOf(a),end=after.indexOf(b,at);assert(at>=0&&end>at,a);rep(after.slice(at,end),body);}
 function inject(seam){rep(seam,seam+'\n'+block+'\n');}
 if(file==='write_safety_guard.js') {
  inject("  var VERSION = 'wsg-3.0.0';");
  span('  function nameKey(v) {','  function simpleHash(v)',"  function nameKey(v) { return mlsExactNameKey(v); }\n");
  span('  function verifyPatientIdentity(opts) {','  function dateDigits(v)',`  function verifyPatientIdentity(opts) {
    opts = opts || {};
    var verdict = mlsExactIdentityPair(opts.expected, opts.observed);
    return verdict.ok ? null : {ok:false,blocked:true,reason:'patient-mismatch',detail:verdict.reason,error:'One exact full-name and DOB match is required. Nothing was changed.'};
  }
`);
 } else {
  inject('async function mlsAthenaActionV2DriverFn(req) {');
  span('    function nameKey(v) {','    function noteNorm(v)',"    function nameKey(v) { return mlsExactNameKey(v); }\n");
  rep("if (!text(expectedPatient.name) || !dateKey(expectedPatient.dob) || !digits(expectedPatient.mrn)) return { ok: false, blocked: true, reason: 'patient-mismatch', error: 'Expected patient name, DOB, and MRN are required.' };","if (!mlsExactIdentityPair(expectedPatient, expectedPatient).ok) return { ok: false, blocked: true, reason: 'patient-mismatch', error: 'Expected exact full name and DOB are required.' };");
  rep("if (!clean(p.name) || !dateKey(p.dob) || !digits(p.mrn)) return { ok: false, blocked: true, reason: 'patient-mismatch' };","if (!clean(p.name) || !dateKey(p.dob)) return { ok: false, blocked: true, reason: 'patient-mismatch' };");
  rep("            if (m1 && wantMrn && m1 !== wantMrn) return { identity: null, ambiguous: true };","            if (kept && m1 && digits(kept.mrn) && m1 !== digits(kept.mrn)) return { identity: null, ambiguous: true }; /* distinct live candidates, never cached MRN */");
  rep("      if (nameKey(observedIdentity.name) !== nameKey(expectedPatient.name) || dateKey(observedIdentity.dob) !== dateKey(expectedPatient.dob)) { sawOtherPatient = true; continue; }","      if (!mlsExactIdentityPair(expectedPatient, observedIdentity).ok) { sawOtherPatient = true; continue; }");
  rep("      if (wantMrn && digits(observedIdentity.mrn) !== wantMrn) { sawOtherPatient = true; continue; }","      if (locked && digits(locked.mrn) && digits(observedIdentity.mrn) !== digits(locked.mrn)) { sawOtherPatient = true; continue; } /* live probe lock remains mandatory */");
  rep("      if (digits(p.mrn) && digits(p.mrn) !== digits(rec.locked && rec.locked.mrn)) return { ok: false, blocked: true, reason: 'patient-mismatch' };", "      /* Cached MRN is not identity authority; patientHash still binds the original request. */");
  rep("      if (rec.expectedMrn && rec.expectedMrn !== digits(rec.locked && rec.locked.mrn)) return { ok: false, blocked: true, reason: 'patient-mismatch' };", "      /* Execute re-verifies the live MRN captured in rec.locked, not the stale roster hint. */");
  // Worker-level helpers serve strict chart reads and the visit gate.
  inject('  function visitIdentityGate(frozen, live) {');
  span('    frozen = frozen || {}; live = live || {};','  function realVisit(v, minLen)',"    return mlsExactIdentityPair(frozen, live);\n  }\n");
  // Strict chart matcher is local because this reader's scope is separate.
  rep('          const strictNameMatch = (observed, expected) => {','          '+block.replace(/\n/g,'\n          ')+'\n          const strictNameMatch = (observed, expected) => {');
  span('            /* Live 2026-07-16: athena\'s banner abbreviates long names','          const dobPartsStrict',"            return !!mlsExactNameKey(expected) && mlsExactNameKey(observed) === mlsExactNameKey(expected);\n          };\n");
  span('            if (!who || !strictNameMatch(who.name, want)) return false;','          const frameIdentity',"            return mlsExactIdentityPair({name:want,dob:wantDob,mrn:wantMrn},who).ok;\n          };\n");
  rep("const globalStrongMismatch = !!(globalNameMatches && ((wantDob && ident.dob && !sameDobStrict(ident.dob, wantDob)) || (wantMrn && ident.mrn && mrnKeyStrict(ident.mrn) !== mrnKeyStrict(wantMrn))));","const globalStrongMismatch = !!(globalNameMatches && wantDob && (!ident.dob || !sameDobStrict(ident.dob, wantDob)));");
  inject('  function mlsAlreadyOpenIdentityDecision(lightIdentity, shadowIdentity, expectedName, expectedDob, expectedMrn) {');
  span('      function nameTokens(value) {','      function dateKey(value)',"      function nameMatches(observed, expected) { return !!mlsExactNameKey(expected) && mlsExactNameKey(observed) === mlsExactNameKey(expected); }\n");
  rep(" && /^\\d{3,}$/.test(String(value.mrn || '').replace(/\\D/g, ''))",' /* exact-pair-30123: MRN optional on credible banner */');
  rep(" && String(value.mrn || '').replace(/\\D/g, '') === String(expectedMrn || '').replace(/\\D/g, '')",' /* exact-pair-30123: cached MRN is not authority */');
  rep('      out.conflict = candidates.some(function (candidate) { return !exact(candidate); });',"      var pairIds = new Set(exacts.map(function(c){return String(c.mrn || '');}).filter(Boolean));\n      out.conflict = pairIds.size > 1 || candidates.some(function (candidate) { return !exact(candidate); });");
 }
 let restored=after;for(const [a,b] of edits.slice().reverse()){assert(restored.indexOf(b)===restored.lastIndexOf(b),'inverse seam');restored=restored.replace(b,a);} assert.strictEqual(restored,before);
 fs.writeFileSync(path.join(root,file),Buffer.from(after,'latin1'));console.log(file+': '+edits.length+' seams; inverse byte preservation passed');
}
