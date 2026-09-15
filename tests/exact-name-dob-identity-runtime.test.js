'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'), bg=fs.readFileSync(path.join(root,'background.js'),'latin1');
const canonical=require('../scripts/exact-identity-30123'); require('../write_safety_guard'); const safety=globalThis.MLSWriteSafety;
function slice(a,b){const i=bg.indexOf(a),j=bg.indexOf(b,i);assert(i>=0&&j>i);return bg.slice(i,j);}
const gate=vm.runInNewContext('('+slice('  function visitIdentityGate(', '  function realVisit(')+')');
const decision=vm.runInNewContext('('+slice('  function mlsAlreadyOpenIdentityDecision(', '  function mlsEncounterAcceptanceReaderFn')+')');
const expected={name:'Dr. John A. O’Neill, Jr.',dob:'1960-01-02',mrn:'stale-111'};
let checks=0;function eq(actual,want,label){checks++;assert.strictEqual(actual,want,label);}
for(const observed of [
 {name:"John O'Neill",dob:'01/02/1960'},
 {name:'O’Neill, John Andrew',dob:'1960-1-2',mrn:'live-222'},
 {name:'John A ONeill Junior',dob:'1-2-1960',mrn:'stale-111'}
]) {
 eq(canonical.mlsExactIdentityPair(expected,observed).ok,true,'canonical unique pair');
 eq(gate(expected,observed).ok,true,'actual visit gate unique pair');
 eq(safety.verifyPatientIdentity({expected,observed}),null,'write preflight unique pair');
}
for(const observed of [
 {name:'John ONeill',dob:'01/03/1960'},
 {name:'James ONeill',dob:'01/02/1960'},
 {name:'J ONeill',dob:'01/02/1960'},
 {name:'John Other',dob:'01/02/1960'},
 {name:'John ONeill',dob:''},
 {name:'John ONeill',dob:'02/31/1960'},
 {name:'John ONeill',dob:'01/02/1960',ambiguous:true},
 {name:'John ONeill',dob:'01/02/1960',exactPairCandidateCount:2}
]) {
 eq(canonical.mlsExactIdentityPair(expected,observed).ok,false,'canonical refuses mismatch/ambiguity');
 eq(gate(expected,observed).ok,false,'actual visit gate refuses mismatch/ambiguity');
 eq(safety.verifyPatientIdentity({expected,observed}).blocked,true,'write preflight refuses mismatch/ambiguity');
}
eq(gate({...expected,dob:''},{name:'John ONeill',mrn:'stale-111'}).ok,false,'MRN cannot substitute missing DOB');
const banner={name:'John ONeill',dob:'01/02/1960',mrn:'222222',via:'banner'};
eq(decision(banner,null,expected.name,expected.dob,expected.mrn).matched,true,'already open accepts stale caller MRN');
eq(decision(banner,{candidates:[{...banner,mrn:'333333'}]},expected.name,expected.dob,expected.mrn).matched,false,'distinct live same-pair candidates refuse');
eq(decision(banner,{candidates:[banner]},expected.name,expected.dob,expected.mrn).matched,true,'same live ID duplicate rendering is not two patients');
const find="var wantMrn='';function mrnCellMatches(){return false;}\n"+slice('      function exactResultRow(row)', '      /* rowreverify-1.0.0'); /* findmrn-1.0.0 (3.0.149): the evidence also reads the driver's wantMrn/mrnCellMatches; this harness pins the name+DOB pair with no MRN requested */
function search(rows){
 const clicks=[];
 const headers=['Last Name','First Name','DOB'];
 const chartAs=rows.map((r,i)=>({closest:()=>({querySelectorAll:()=>r.map(innerText=>({innerText})),closest:()=>({querySelectorAll:()=>headers.map(innerText=>({innerText}))})}),click:()=>clicks.push(i)}));
 const result=vm.runInNewContext('(function(){'+Object.values(canonical).map(f=>f.toString()).join('\n')+'\n'+find+'\nreturn {pool:pool.length};})()',{chartAs,name:expected.name,dob:expected.dob});
 return result;
}
eq(search([['ONeill','John','01/02/1960']]).pool,1,'Find unique first-last DOB');
eq(search([['ONeill','James','01/02/1960']]).opened,false,'Find same DOB different first refuses');
eq(search([['ONeill','John','01/03/1960']]).opened,false,'Find same name different DOB refuses');
eq(search([['ONeill','John','01/02/1960'],['ONeill','John Andrew','01/02/1960']]).reason,'ambiguous','Find duplicate pair cannot narrow by stale MRN');
assert(bg.includes('expectedMrn: digits(probe.context.mrn)'),'token must capture observed live MRN');
assert(bg.includes('locked && digits(locked.mrn) && digits(observedIdentity.mrn) !== digits(locked.mrn)'),'execute must reverify live MRN lock');
assert(bg.includes('rec.executionDocumentId'),'document lock remains');
console.log('PASS exact first/last+DOB identity: '+checks+' adversarial runtime assertions, actual Find/visit/already-open/write gates and observed-ID lock contracts');
