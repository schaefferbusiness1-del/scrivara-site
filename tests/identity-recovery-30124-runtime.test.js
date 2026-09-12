'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const bg=fs.readFileSync(path.join(__dirname,'..','background.js'),'latin1');
const helpers=require('../scripts/exact-identity-30123');
const helperSource=Object.values(helpers).map(f=>f.toString()).join('\n');
function slice(a,b){const s=bg.indexOf(a),e=bg.indexOf(b,s);assert(s>=0&&e>s,a);return bg.slice(s,e);}
let checks=0;function eq(a,b,label){checks++;assert.strictEqual(a,b,label);}
const match=vm.runInNewContext('(function(){'+helperSource+'\n'+slice('function mlsMatchPatients(mls, ath) {','// ---- Procedure-template prep driver')+'return mlsMatchPatients;})()');
const expected={name:'Dr. John Andrew O’Neill, Jr.',dob:'1960-01-02',mrn:'stale-100'};
const bootstrapSource=slice('        const exactBootstrapName =','        /* v2.9.27 SPEED');
function ready(selected,candidates,want=expected.name,wantDob=expected.dob){
 return vm.runInNewContext('(function(){'+bootstrapSource+'return bootstrapIdentityReady(selected,frames);})()',{
  ...helpers,bootstrapIdentity:true,exactOpenLease:{appointmentNavigationFrameIds:[7]},want,wantDob,selected,
  frames:candidates.map((r,i)=>({frameId:i+7,result:{via:'banner',score:1,w:400,h:100,...r}}))});
}
const live={name:"John O'Neill",dob:'01/02/1960',mrn:'live-200',via:'banner'};
for(const name of ["John O'Neill",'O’Neill, John A.','  JOHN   ONEILL  Jr. ','Dr. John O ’ Neill','Prof. John Andrew OʼNeill']) {
 const observed={...live,name};eq(match(expected,observed).status,'match','worker optional decorations/stale MRN');
 eq(ready(observed,[observed]),true,'appointment bootstrap uses the same contract');
}
for(const observed of [
 {...live,dob:'1960-01-03'}, {...live,name:'James ONeill'}, {...live,name:'John Other'},
 {...live,name:'J ONeill'}, {...live,dob:''}, {...live,dob:'1960-02-31'},
 {...live,ambiguous:true}, {...live,exactPairCandidateCount:2}
]) {eq(match(expected,observed).status==='match',false,'worker refuses conflict/missing/ambiguity');eq(ready(observed,[observed]),false,'bootstrap refuses conflict/missing/ambiguity');}
eq(match({...expected,dob:''},live).status,'uncertain','matching MRN never supplies missing DOB');
eq(match({name:'James Other',dob:expected.dob,mrn:live.mrn},live).status,'mismatch','DOB+MRN never overrides names');
eq(ready(live,[live,{...live,mrn:'live-300'}]),false,'distinct live patient IDs remain ambiguous');
eq(ready(live,[live,{...live,name:'John A ONeill',dob:'1960-1-2'}]),true,'same live ID copies agree despite name/date formatting');
eq(ready(live,[{...live,name:'James Other'}]),false,'stale banner is refused');
eq(ready(live,[live]),true,'fresh subsequent banner recovers without poisoned pending state');
eq(ready(live,[{...live,dob:'1960-1-3'}]),false,'stale DOB refuses');
eq(ready(live,[live]),true,'fresh retry revalidates DOB');
eq(helpers.mlsExactIdentityPair({name:'Mary Smith-Jones',dob:expected.dob},{name:'Mary A Smith ‑ Jones',dob:live.dob}).ok,true,'typographic spaced hyphen normalization');
const eaName=vm.runInNewContext('(function(){'+slice('                      var eaNameOk =','                      var eaWantDob =')+'return eaNameOk;})()',helpers);
eq(eaName(live.name,expected.name),true,'encounter-acceptance fallback ignores optional middle');
eq(eaName('Other, John',expected.name),false,'encounter-acceptance fallback still requires last');
const findStart=bg.indexOf('  async function mlsFindPatientOpenDriverFn('),queryStart=bg.indexOf('      var SUFX =',findStart);
const querySource=bg.slice(queryStart,bg.indexOf('      function nrmDob',queryStart));
function query(name){return vm.runInNewContext('(function(){'+querySource+'return searchStr;})()',{name});}
eq(query('Dr. John Andrew Smith, Jr.'),'Smith,John','Find query never searches for Dr as first name');
eq(query('Smith, Prof. John A.'),'Smith,John','comma-order title is optional');
eq(query("Mrs. Jane O'Neill"),"O'Neill,Jane",'Find query preserves Athena spelling');
const rowSource=slice('      function exactResultRow(row)','      /* rowreverify-1.0.0');
function rowResult(rows,headers=['Last Name','First Name','DOB'],legacy=false){
 const hnodes=headers.map(innerText=>({innerText}));
 const headerRow={querySelectorAll:()=>hnodes};
 const table={querySelectorAll:selector=>selector==='tr'?[headerRow]:legacy?[]:hnodes};
 const chartAs=rows.map(cells=>({closest:()=>({querySelectorAll:()=>cells.map(innerText=>({innerText})),closest:()=>table})}));
 return vm.runInNewContext('(function(){'+helperSource+'\n'+rowSource+'return {pool:pool.length};})()',{chartAs,name:expected.name,dob:expected.dob});
}
eq(rowResult([['ONeill','John','01/02/1960']],undefined,true).pool,1,'legacy tbody headers resolve unique pair');
eq(rowResult([['ONeill','John','01/02/1960','09/21/2026']],['Last.Name','First-Name','Date of Birth','Next Visit'],true).pool,1,'labelled DOB is not confused with appointment date');
eq(rowResult([['ONeill','James','01/02/1960']],undefined,true).opened,false,'legacy header cannot allow different first');
eq(rowResult([['ONeill','John','01/03/1960']],undefined,true).opened,false,'legacy header cannot allow different DOB');
eq(rowResult([['ONeill','John','01/02/1960'],['ONeill','John Andrew','01/02/1960']],undefined,true).reason,'ambiguous','duplicate pair stays ambiguous after legacy fallback');
eq(rowResult([['ONeill','John','01/02/1960']],['Last Name','First Name','First Name'],true).opened,false,'ambiguous column mapping refuses');
// Live row re-read is shared with initial proof and no persisted pending flag is consulted.
assert(bg.includes('if(_rvTr&&exactResultRow(_rvTr).ok)_rvRows.push(_rvAs[_rvI])'));
assert(bg.includes('if (_rvRows.length !== 1) return { opened: false'));
assert(bg.includes("locked && digits(locked.mrn) && digits(observedIdentity.mrn) !== digits(locked.mrn)"));
assert(bg.includes('rec.executionDocumentId'));
eq(bg.includes('identity-suggestion-pending'),false,'pending label is not extension-owned state');
console.log('PASS identity recovery 3.0.124: '+checks+' runtime assertions; bootstrap/worker/Find/encounter safety and stale-to-fresh recovery');
