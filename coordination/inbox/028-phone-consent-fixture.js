'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function atomicWriteUtf8(targetPath, contents) {
  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) throw new Error('target is not a regular file: ' + targetPath);
  const temporaryPath = path.join(
    path.dirname(targetPath),
    '.' + path.basename(targetPath) + '.028-' + process.pid + '-' + Date.now() + '.tmp'
  );
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: stat.mode });
    fs.renameSync(temporaryPath, targetPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch (_) {}
    throw error;
  }
}

const root = path.resolve(__dirname, '..', '..');
const targetPath = path.join(root, 'tests', 'live-phone-secure-lifecycle.js');
const original = fs.readFileSync(targetPath, 'utf8');
let patched = original;

patched = replaceOnce(
  patched,
  [
    '      /* This lifecycle test owns a deterministic exact-appointment fixture.',
    '         The separate clinical-action suite proves the production appointment',
    '         resolver; here we prove that phone pairing crosses both engine gates',
    '         in order without needing a real schedule or patient. */',
    '      window.__mlsPhoneExactGateAllowed=true;',
    '      window.__mlsPhoneExactGateCalls=[];',
    '      _mlsExactScheduledClinicalAction=function(actionLabel){',
    "        window.__mlsPhoneExactGateCalls.push(String(actionLabel||''));",
    "        return window.__mlsPhoneExactGateAllowed===true && actionLabel==='phone recording';",
    '      };',
    '      _athenaPrepareRecording=function(){return true;};',
    '      _athenaAsyncBindingStillSafe=function(){return true;};',
    "      currentVisitAthenaBinding={id:'synthetic-live-phone-visit'};",
    '      currentVisitAthenaEpoch=17;'
  ].join('\n'),
  [
    '      /* 2026-07-29: this lifecycle test owns a deterministic synthetic',
    '         patient and appointment. The separate clinical-action suite proves',
    '         the production appointment resolver; this test uses the real public',
    '         patient and consent contracts before crossing the phone gates. */',
    "      var syntheticPhonePatient={id:'synthetic-live-phone-patient',name:'Synthetic Phone Patient',dob:'2000-01-01',mrn:'SYNTH-PHONE-001',problems:'',meds:'',summary:'',docs:[]};",
    '      var syntheticPhonePatients=getPatients();',
    '      if(!syntheticPhonePatients.some(function(patient){return patient&&patient.id===syntheticPhonePatient.id;})){',
    '        syntheticPhonePatients.push(syntheticPhonePatient);',
    '        savePatients(syntheticPhonePatients);',
    '      }',
    '      setActivePtId(syntheticPhonePatient.id);',
    '      window.__mlsPhoneExactGateAllowed=true;',
    '      window.__mlsPhoneExactGateCalls=[];',
    '      _mlsExactScheduledClinicalAction=function(actionLabel){',
    "        window.__mlsPhoneExactGateCalls.push(String(actionLabel||''));",
    "        return window.__mlsPhoneExactGateAllowed===true && actionLabel==='phone recording';",
    '      };',
    '      _athenaPrepareRecording=function(){return true;};',
    '      _athenaAsyncBindingStillSafe=function(){return true;};',
    "      currentVisitAthenaBinding={id:'synthetic-live-phone-visit',patientId:syntheticPhonePatient.id,visitContext:{appointmentId:'synthetic-live-phone-appointment'}};",
    '      currentVisitAthenaEpoch=17;'
  ].join('\n'),
  'seed the isolated phone lifecycle with a synthetic patient and appointment'
);

patched = replaceOnce(
  patched,
  [
    "    assert.deepStrictEqual(exactCallsAfterDeniedProbe, ['phone recording'], 'trusted phone pairing did not request the exact phone-recording appointment gate once');",
    '',
    "    await evaluate(cdp, 'window.__mlsPhoneExactGateAllowed=true;true');",
    "    await trustedClick(cdp, '#mlsGpQrBox');"
  ].join('\n'),
  [
    "    assert.deepStrictEqual(exactCallsAfterDeniedProbe, ['phone recording'], 'trusted phone pairing did not request the exact phone-recording appointment gate once');",
    '',
    '    const phoneConsent = await evaluate(cdp, `(async()=>{',
    "      if(typeof window._mlsRequestEncounterConsent!=='function'||typeof window._mlsHasEncounterConsent!=='function')return{ready:false,reason:'public consent hooks missing'};",
    "      var active=typeof activePatient==='function'?activePatient():null;",
    "      if(!active||active.id!=='synthetic-live-phone-patient')return{ready:false,reason:'synthetic active patient missing',activeId:active&&active.id||''};",
    '      var before=window._mlsHasEncounterConsent();',
    "      var pending=window._mlsRequestEncounterConsent('phone recording');",
    '      var deadline=Date.now()+5000,dialog=null;',
    "      while(Date.now()<deadline&&!(dialog=document.getElementById('_mlsAskDialog')))await new Promise(function(resolve){setTimeout(resolve,25);});",
    "      if(!dialog)return{ready:false,reason:'consent dialog missing',before:before};",
    "      var verbal=dialog.querySelector('input[value=\"patient-verbal\"]');",
    "      var confirm=dialog.querySelector('#_mlsAskYes');",
    "      if(!verbal||!confirm)return{ready:false,reason:'consent controls missing',before:before};",
    '      verbal.click();',
    '      confirm.click();',
    '      var confirmed=await pending;',
    '      var after=window._mlsHasEncounterConsent();',
    "      var log=[];try{log=JSON.parse(localStorage.getItem(uns('consentLog'))||'[]')||[];}catch(_){}",
    '      var last=log[log.length-1]||null;',
    '      return{ready:confirmed===true&&after===true,before:before===true,confirmed:confirmed===true,after:after===true,activeId:active.id,logCount:log.length,consentType:last&&last.consentType||\'\',patientId:last&&last.patientId||\'\',encounterId:last&&last.encounterId||\'\'};',
    '    })()`, true);',
    "    assert(phoneConsent&&phoneConsent.ready===true, 'real synthetic encounter consent did not complete: '+JSON.stringify(phoneConsent));",
    "    assert.strictEqual(phoneConsent.before, false, 'synthetic phone fixture began with pre-existing consent');",
    "    assert.strictEqual(phoneConsent.activeId, 'synthetic-live-phone-patient', 'consent was not bound to the synthetic active patient');",
    "    assert(phoneConsent.logCount>=1, 'consent confirmation did not write its audit record');",
    "    assert.strictEqual(phoneConsent.consentType, 'patient-verbal', 'synthetic consent used the wrong real consent option');",
    "    assert.strictEqual(phoneConsent.patientId, 'synthetic-live-phone-patient', 'consent audit record used the wrong patient');",
    "    assert.strictEqual(phoneConsent.encounterId, 'appt:synthetic-live-phone-appointment', 'consent audit record used the wrong encounter');",
    "    const startsAfterConsent = backendRequests.filter(request => new URL(request.url).pathname.endsWith('/api/mic/start') && request.method === 'POST').length;",
    "    assert.strictEqual(startsAfterConsent, startsAfterExactGateProbe, 'consent confirmation itself contacted the phone backend');",
    '',
    "    await evaluate(cdp, 'window.__mlsPhoneExactGateAllowed=true;true');",
    "    await trustedClick(cdp, '#mlsGpQrBox');"
  ].join('\n'),
  'drive the exported encounter-consent contract before the trusted phone handoff'
);

if (patched === original) throw new Error('028-phone-consent-fixture: patch produced no change');
const beforeHash = sha256(original);
const afterHash = sha256(patched);
atomicWriteUtf8(targetPath, patched);
console.log('Patched ' + targetPath);
console.log('SHA256 ' + beforeHash + ' -> ' + afterHash);
