'use strict';
const fs=require('fs'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..'), helpers=require('./exact-identity-30123');
const block=Object.values(helpers).map(f=>f.toString()).join('\n');
for(const file of ['background.js','write_safety_guard.js']) {
 const before=fs.readFileSync(path.join(root,file),'latin1'); let after=before;const edits=[];
 function rep(a,b){assert(after.includes(a)&&after.indexOf(a)===after.lastIndexOf(a),'unique '+a.slice(0,90));after=after.replace(a,()=>b);edits.push([a,b]);}
 function span(a,b,body){const at=after.indexOf(a),end=after.indexOf(b,at);assert(at>=0&&end>at,a);rep(after.slice(at,end),body);}
 function inject(seam){rep(seam,seam+'\n'+block+'\n');}
 // Update all embedded copies from the first draft to the owner's final first/last rule.
 const re=/function mlsExactNameKey\(value\) \{[\s\S]*?\n\s*\}\n(?=\s*function mlsExactDobKey)/g;
 const matches=[...after.matchAll(re)];assert(matches.length>0);for(let i=matches.length-1;i>=0;i--){const m=matches[i];const indent=(m[0].match(/\n(\s*)var raw/)||[])[1]||'  '; const pad=indent.slice(0,-2);const newer=helpers.mlsExactNameKey.toString().replace(/\n/g,'\n'+pad)+'\n';after=after.slice(0,m.index)+newer+after.slice(m.index+m[0].length);}
 const baseline=after;
 if(file==='background.js') {
  inject('  async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn) {');
  rep("      var wantDob = nrmDob(dob);", "      var wantDob = nrmDob(dob);\n      if (!mlsExactIdentityPair({name:name,dob:dob},{name:name,dob:dob}).ok) return {opened:false,reason:'identity-hint-incomplete'};");
  const rowHelper=`      function exactResultRow(row) {
        var cells = Array.prototype.slice.call(row.querySelectorAll('td,th')).map(function(x){return String(x.innerText||'').trim();});
        var table = row.closest && row.closest('table'), headers = table ? Array.prototype.slice.call(table.querySelectorAll('thead th,thead td')).map(function(x){return String(x.innerText||'').trim().toLowerCase();}) : [];
        var fi=headers.findIndex(function(x){return /^(first|given)( name)?$/.test(x);}), li=headers.findIndex(function(x){return /^(last|family|sur)(name| name)?$/.test(x);});
        var rowName = fi>=0 && li>=0 ? (cells[fi]||'')+' '+(cells[li]||'') : '';
        if(!rowName) { var names=cells.filter(function(x){return !/[0-9]/.test(x)&&mlsExactNameKey(x)===mlsExactNameKey(name);}); if(names.length===1) rowName=names[0]; }
        var dates=[];cells.forEach(function(x){var k=mlsExactDobKey(x);if(k&&dates.indexOf(k)<0)dates.push(k);});
        return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,dob:dates.length===1?dates[0]:''};
      }
`;
  span('      var lnorm = lname.toLowerCase(), fnorm = fq.toLowerCase();','      /* rowreverify-1.0.0',rowHelper+`      var exact = [], prefix = [], pool = [], mrnNarrowed = false;
      for (var c=0;c<chartAs.length;c++) {
        var tr=chartAs[c].closest ? chartAs[c].closest('tr') : null;
        if(!tr) continue;
        var evidence=exactResultRow(tr);
        if(evidence.ok) pool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:false});
      }
      if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob'};
`);
  span('      var _rvWantMrn =','      if (_rvRows.length !== 1)',`      var _rvRows = [];
      try {
        var _rvAs=Array.prototype.slice.call(best.w.document.querySelectorAll('a')).filter(function(a){return /^chart$/i.test((a.innerText||'').trim());});
        for(var _rvI=0;_rvI<_rvAs.length;_rvI++) {var _rvTr=_rvAs[_rvI].closest ? _rvAs[_rvI].closest('tr') : null;if(_rvTr&&exactResultRow(_rvTr).ok)_rvRows.push(_rvAs[_rvI]);}
      } catch(e){_rvRows=[];}
`);
  // Named native editor binding derives machine patient ID only from a freshly matched banner.
  rep('      var hetStage = hetStageEncounterContext(fr, expectedPatient);',`      var pairHeader = hetAncestorIdentity(fr, expectedPatient), pairWin = fr.w, pairHops = 0;
      while (!pairHeader.identity && !pairHeader.ambiguous && pairWin && pairHops++ < 6) {
        try { if(!pairWin.parent || pairWin.parent===pairWin) break; pairWin=pairWin.parent; } catch(e){break;}
        var pairFrame=frames.filter(function(f){return f.w===pairWin;})[0]; if(!pairFrame) break;
        pairHeader=hetAncestorIdentity(pairFrame, expectedPatient);
      }
      if (pairHeader.ambiguous) continue;
      if (!observedIdentity && pairHeader.identity) { observedIdentity=pairHeader.identity; chartHeader=pairHeader; }
      var machinePatient = observedIdentity && mlsExactIdentityPair(expectedPatient,observedIdentity).ok ? Object.assign({},expectedPatient,{mrn:observedIdentity.mrn||''}) : null;
      var hetStage = machinePatient ? hetStageEncounterContext(fr, machinePatient) : null;`);
  rep("          if (!observedIdentity && hetWalkVerdict === 'none-found') {", "          if (false && !observedIdentity && hetWalkVerdict === 'none-found') { /* exact-pair-30123: never synthesize a missing DOB/banner */");
  rep('expectedMrn: digits(p.mrn),','expectedMrn: digits(probe.context.mrn),');
  rep('      /* Execute re-verifies the live MRN captured in rec.locked, not the stale roster hint. */',"      if (rec.expectedMrn && rec.expectedMrn !== digits(rec.locked && rec.locked.mrn)) return {ok:false,blocked:true,reason:'patient-mismatch'}; /* captured live probe lock */");
 }
 let restored=after;for(const [a,b] of edits.slice().reverse()){assert(restored.indexOf(b)===restored.lastIndexOf(b),'inverse');restored=restored.replace(b,()=>a);}assert(restored===baseline,'inverse byte preservation');
 fs.writeFileSync(path.join(root,file),Buffer.from(after,'latin1'));console.log(file+': '+matches.length+' canonical keys refreshed; '+edits.length+' resolution seams verified');
}
