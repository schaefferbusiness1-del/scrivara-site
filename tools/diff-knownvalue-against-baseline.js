#!/usr/bin/env node
/* DIFF knownValue AGAINST A BASELINE COMMIT
 * =========================================================================
 * Answers the one question a green suite cannot: "did this change make any
 * op-note field WORSE than it was before?"
 *
 * It extracts the whole resolution ladder from feat_mls_opnote_fill.js twice -
 * once from the working tree, once from `git show <baseline>:` - runs BOTH over
 * every [FILL:] label shipped anywhere in the repo plus the identity/role
 * vocabulary, across three appointment shapes, and prints only the labels whose
 * output changed, tagged GAINED / LOST / CHANGED.
 *
 * Written during the b815 self-audit, which used it to establish the number that
 * mattered: ZERO changes on the Settings-only path, i.e. the common case was
 * untouched while 4 assistant fabrications and 28 borrowed credentials went away.
 *
 * Usage:   node tools/diff-knownvalue-against-baseline.js [baseline-ref]
 *          (default baseline 0939b4b, the commit before the integration lane)
 *
 * Reading the output: GAINED is a field that now fills where it was blank. LOST
 * is a field that no longer fills - each one needs a reason, because most of the
 * time it is a regression. CHANGED is a different value, which needs the most
 * scrutiny of all.
 *
 * Not registered in run-all.js on purpose: it is a comparison against a moving
 * baseline, not an invariant. The invariants it found live in
 * tests/settings-identity-reaches-the-op-note.test.js.
 * ======================================================================= */
const fs=require('fs'), vm=require('vm'), cp=require('child_process');
function fb(src,name){const a=src.indexOf('function '+name+'(');if(a<0)throw new Error('missing '+name);
 const br=src.indexOf('{',a);let d=0,q='',e=false,lc=false,bc=false;
 for(let i=br;i<src.length;i++){const c=src[i],n=src[i+1];
  if(lc){if(c==='\n')lc=false;continue;} if(bc){if(c==='*'&&n==='/'){bc=false;i++;}continue;}
  if(q){if(e)e=false;else if(c==='\\')e=true;else if(c===q)q='';continue;}
  if(c==='/'&&n==='/'){lc=true;i++;continue;} if(c==='/'&&n==='*'){bc=true;i++;continue;}
  if(c==='"'||c==="'"||c==='`'){q=c;continue;}
  if(c==='{')d++; else if(c==='}'&&--d===0)return src.slice(a,i+1);}
 throw new Error('unterminated '+name);}
const LADDER=['safe','isFn','S','plausibleMrn','canonicalSetting','provProfile','apptProvider','apptFacility',
 'commonApptProvider','seedProfile','normPatientName','normPatientDob','rowPatientId','chartPatient','knownValue'];
function build(src, settings, patients){
 const ctx={console,String,Number,JSON,Object,Array,RegExp,Error,Math,isNaN,_calAppts:[],getPatients(){return patients||[];}};
 ctx.window=ctx;
 for(const k of Object.keys(settings)) { const v=settings[k]; ctx[k]=()=>v; ctx.window[k]=ctx[k]; }
 // apptFacility does not exist in the OLD version; supply a no-op so the old ladder loads
 const names = LADDER.filter(n=>{ try{ fb(src,n); return true; }catch(e){ return false; } });
 vm.createContext(ctx);
 vm.runInContext(names.map(n=>fb(src,n)).join('\n')+'\nthis.k=knownValue;',ctx);
 return ctx.k;
}
const NEW=fs.readFileSync('feat_mls_opnote_fill.js','utf8');
const BASE=process.argv[2]||'0939b4b';
const OLD=cp.execSync('git show '+BASE+':feat_mls_opnote_fill.js',{encoding:'utf8',maxBuffer:1<<28});
// every real label shipped anywhere, plus the identity/role vocabulary
const raw=cp.execSync("grep -rho '\\[FILL: *[^]]*\\]' --include='*.js' --include='*.html' --include='*.md' . 2>/dev/null || true",{encoding:'utf8'});
let labels=new Set();
raw.split('\n').forEach(l=>{const m=l.match(/^\[FILL: *([^\]]*)\]$/); if(m&&/^[a-zA-Z0-9 %.+/&'-]+$/.test(m[1])) labels.add(m[1].trim());});
['Surgeon','Provider','Physician','Attending','Operating physician','Performed by','Dictated by','Performing provider',
 'Rendering provider','Proceduralist','Assistant','Assistant surgeon','First assistant','Assisting physician','Co-surgeon',
 'Resident','Fellow','Scrub tech','Circulator','Anesthesiologist','Anesthetist','CRNA','Anesthesia','Anesthesia type',
 'Sedation','NPI','Provider NPI','Practice','Practice name','Facility','Facility name','Clinic','Location','Site',
 'Hospital','Surgery center','ASC','Patient','Patient name','DOB','MRN','Date of procedure','Specialty','Surgeon/Assistant',
 'Anesthesia provider','Estimated blood loss','Complications','Consent','Specimens','Laterality','Side','Levels'
].forEach(l=>labels.add(l));
const SET={getProviderName:'Jane A. Smith',getProviderCred:'MD',getNpi:'1548273901',
 getPracticeName:'Chester County Spine Care',getFacilityName:''};   // facility unset: the common real state
const SET_OLD=Object.assign({},SET); delete SET_OLD.getFacilityName; // undefined before, as it really was
const kNew=build(NEW,SET,[]), kOld=build(OLD,SET_OLD,[]);
const ROWS=[
 ['no appointment context',{patientId:'',appt:{}}],
 ['room row w/ provider+facility',{patientId:'pt-1',appt:{name:'Ada Lovelace',dob:'03/12/1970',providerName:'Kelly Carter, PA-C',facilityName:'Paoli Hospital'}}],
 ['calendar row',{patientId:'pt-1',appt:{name:'Ada Lovelace',dob:'03/12/1970',provider_raw:'Carter_Kelly_PA-C'}}],
];
let changed=0, better=0, worse=[];
for(const [rlabel,row] of ROWS){
 for(const L of Array.from(labels).sort()){
  let a='',b='';
  try{a=kOld(L,row)||'';}catch(e){a='<<throw>>';}
  try{b=kNew(L,row)||'';}catch(e){b='<<throw>>';}
  if(a===b) continue;
  changed++;
  const gainedValue = !a && b, lostValue = a && !b, replaced = a && b;
  const tag = gainedValue?'GAINED':(lostValue?'LOST ':'CHANGED');
  if(gainedValue) better++;
  else worse.push({row:rlabel,label:L,old:a,now:b,tag});
  console.log(`${tag} [${rlabel}] "${L}"\n    old=${JSON.stringify(a)}\n    now=${JSON.stringify(b)}`);
 }
}
console.log(`\n--- ${changed} label outputs changed; ${better} gained a value; ${worse.length} lost or replaced one ---`);
