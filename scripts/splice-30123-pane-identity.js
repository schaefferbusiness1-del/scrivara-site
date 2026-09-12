'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const target=path.join(__dirname,'..','background.js'), before=fs.readFileSync(target,'latin1');let after=before;
const block=Object.values(require('./exact-identity-30123')).map(f=>f.toString()).join('\n');
const edits=[];function rep(a,b){assert(after.includes(a)&&after.indexOf(a)===after.lastIndexOf(a),a.slice(0,100));after=after.replace(a,()=>b);edits.push([a,b]);}
const begin=after.indexOf('async function mlsReadVisitsPaneDriverFn('),end=after.indexOf('async function mlsUnifiedWriteDriverFn(',begin);assert(begin>0&&end>begin);
const original=after.slice(begin,end);let pane=original;
const seam=pane.indexOf('{');pane=pane.slice(0,seam+1)+'\n'+block+'\n'+pane.slice(seam+1);
const na=pane.indexOf('    function nameMatch(a, b)'),nb=pane.indexOf('    function nrmDob(s)',na);assert(na>0&&nb>na);
pane=pane.slice(0,na)+"    function nameMatch(a,b) { return !!mlsExactNameKey(a) && mlsExactNameKey(a) === mlsExactNameKey(b); }\n"+pane.slice(nb);
const ga=pane.indexOf('    var wantDob = nrmDob(dob);'),gb=pane.indexOf('    /* ---- 5)',ga);assert(ga>0&&gb>ga);
pane=pane.slice(0,ga)+"    var exactPair = mlsExactIdentityPair({name:name,dob:dob,mrn:athenaId},ident);\n    if(!exactPair.ok) return {ok:false,reason:exactPair.reason,error:'The open chart did not prove the exact first/last name and DOB. No visits were read.'};\n"+pane.slice(gb);
rep(original,pane);
// The active writer must derive a stage identity from a real banner, never old cached fields.
const a=after.indexOf("          if (false && !observedIdentity && hetWalkVerdict === 'none-found')"),b=after.indexOf('          hetDiag.ancestorIdentity = hetWalkVerdict;',a);assert(a>0&&b>a);
rep(after.slice(a,b),'          /* exact-pair-30123: no name/DOB banner means no identity admission. */\n');
let restored=after;for(const[a,b]of edits.slice().reverse())restored=restored.replace(b,()=>a);assert(restored===before);
fs.writeFileSync(target,Buffer.from(after,'latin1'));console.log('Pane identity and no-synthetic-banner write gate: inverse bytes passed');
