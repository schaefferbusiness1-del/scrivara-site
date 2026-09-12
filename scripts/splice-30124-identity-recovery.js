'use strict';
// Byte-preserving bounded repair: retain mixed source encodings/EOLs elsewhere.
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..'),helpers=require('./exact-identity-30123');
for(const file of ['background.js','write_safety_guard.js']) {
 const target=path.join(root,file),before=fs.readFileSync(target,'latin1');let out=before;const edits=[];
 function rep(a,b){assert(out.includes(a)&&out.indexOf(a)===out.lastIndexOf(a),'unique seam: '+a.slice(0,85));out=out.replace(a,()=>b);edits.push([a,b]);}
 function span(a,b,value){const s=out.indexOf(a),e=out.indexOf(b,s);assert(s>=0&&e>s,a);rep(out.slice(s,e),value);}
 const re=/function mlsExactNameKey\(value\) \{[\s\S]*?\n\s*\}\n(?=\s*function mlsExactDobKey)/g;
 const copies=[...out.matchAll(re)];assert(copies.length>0);
 for(let i=copies.length-1;i>=0;i--){const m=copies[i],indent=(m[0].match(/\n(\s*)var raw/)||[])[1]||'  ',pad=indent.slice(0,-2);out=out.slice(0,m.index)+helpers.mlsExactNameKey.toString().replace(/\n/g,'\n'+pad)+'\n'+out.slice(m.index+m[0].length);}
 const baseline=out;
 if(file==='background.js') {
  span('function mlsMatchPatients(mls, ath) {','// ---- Procedure-template prep driver',Object.values(helpers).map(f=>f.toString()).join('\n')+`\nfunction mlsMatchPatients(mls, ath) {
  mls=mls||{};ath=ath||{};
  var pair=mlsExactIdentityPair(mls,ath), mn=mlsExactNameKey(mls.name), an=mlsExactNameKey(ath.name), md=mlsExactDobKey(mls.dob), ad=mlsExactDobKey(ath.dob);
  var normMrn=function(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}, mm=normMrn(mls.mrn), am=normMrn(ath.mrn);
  var conflict=!!((mn&&an&&mn!==an)||(md&&ad&&md!==ad)||ath.ambiguous===true||Number(ath.exactPairCandidateCount||0)>1);
  return {status:pair.ok?'match':(conflict?'mismatch':'uncertain'),dobMatch:!!(md&&ad&&md===ad),mrnMatch:!!(mm&&am&&mm===am),nameMatch:!!(mn&&an&&mn===an),reason:pair.reason};
}

`);
  span('        const bootstrapTokens = (value) => {','        const bootstrapIdentityReady =',`        const exactBootstrapName = (observed, expected) => !!mlsExactNameKey(expected) && mlsExactNameKey(observed) === mlsExactNameKey(expected);
        const validBootstrapDob = (value) => !!mlsExactDobKey(value) && (!wantDob || mlsExactDobKey(value) === mlsExactDobKey(wantDob));
        const bootstrapLiveIdsAgree = (selected, candidates) => {
          const ids = [selected].concat(candidates || []).map((candidate) => String(candidate && candidate.mrn || '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
          return new Set(ids).size <= 1 && !(candidates || []).some((candidate) => candidate.ambiguous === true || Number(candidate.exactPairCandidateCount || 0) > 1);
        };
`);
  rep("          const selectedDob = String(selected.dob || '').replace(/\\D/g, '');","          const selectedDob = mlsExactDobKey(selected.dob);");
  rep("          if (!visible.length || !visible.every((candidate) => exactBootstrapName(candidate.name, want) && validBootstrapDob(candidate.dob) && String(candidate.dob || '').replace(/\\D/g, '') === selectedDob)) return false;","          if (!visible.length || !bootstrapLiveIdsAgree(selected, visible) || !visible.every((candidate) => exactBootstrapName(candidate.name, want) && validBootstrapDob(candidate.dob) && mlsExactDobKey(candidate.dob) === selectedDob)) return false;");
  rep("          var chosenDobKey = String(ident && ident.dob || '').replace(/\\D/g, '');","          var chosenDobKey = mlsExactDobKey(ident && ident.dob);");
  rep('          var bannerCandidatesAgree = bannerCandidates.length > 0 && bannerCandidates.every(function (candidate) {','          var bannerCandidatesAgree = bannerCandidates.length > 0 && bootstrapLiveIdsAgree(ident, bannerCandidates) && bannerCandidates.every(function (candidate) {');
  rep("            var candidateDobKey = String(candidate.dob || '').replace(/\\D/g, '');","            var candidateDobKey = mlsExactDobKey(candidate.dob);");
  span('                      var eaTok = function (v)',"                      var eaWantDob =",`                      var eaNameOk = function (obs, exp) { return !!mlsExactNameKey(exp) && mlsExactNameKey(obs) === mlsExactNameKey(exp); };
                      var eaDobKey = mlsExactDobKey;
`);
  rep("      var fq = (fname.split(/\\s+/)[0] || '');",`      /* 3.0.124: comparison already ignored titles; the search query must too. */
      fname = fname.replace(/^(?:(?:mr|mrs|ms|miss|dr|prof)\\.?\\s+)+/i, '').trim();
      var fq = (fname.split(/\\s+/)[0] || '');`);
  span('      function exactResultRow(row) {','      var exact = [], prefix = [], pool = [], mrnNarrowed = false;',`      function exactResultRow(row) {
        var cells = Array.prototype.slice.call(row.querySelectorAll('td,th')).map(function(x){return String(x.innerText||'').trim();});
        var table = row.closest && row.closest('table');
        function labels(nodes){return Array.prototype.slice.call(nodes||[]).map(function(x){return String(x.innerText||'').toLowerCase().replace(/[^a-z]/g,'');});}
        function positions(h,re){var a=[];h.forEach(function(v,i){if(re.test(v))a.push(i);});return a;}
        var first=/^(first|given)(name)?$/,last=/^(last|family|sur)(name)?$/,birth=/^(dob|dateofbirth|birthdate)$/;
        var headers=table?labels(table.querySelectorAll('thead th,thead td')):[];
        if(table&&(!positions(headers,first).length||!positions(headers,last).length)) {
          var rows=Array.prototype.slice.call(table.querySelectorAll('tr'));
          for(var hi=0;hi<rows.length;hi++) {if(rows[hi]===row)continue;var h=labels(rows[hi].querySelectorAll('th,td'));if(positions(h,first).length&&positions(h,last).length){headers=h;break;}}
        }
        var fi=positions(headers,first),li=positions(headers,last),di=positions(headers,birth),rowName='';
        if(fi.length>1||li.length>1||di.length>1)return {ok:false};
        if(fi.length===1&&li.length===1)rowName=(cells[fi[0]]||'')+' '+(cells[li[0]]||'');
        if(!rowName){var names=cells.filter(function(x){return !/[0-9]/.test(x)&&mlsExactNameKey(x)===mlsExactNameKey(name);});if(names.length===1)rowName=names[0];}
        var dates=[];(di.length===1?[cells[di[0]]]:cells).forEach(function(x){var k=mlsExactDobKey(x);if(k&&dates.indexOf(k)<0)dates.push(k);});
        return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,dob:dates.length===1?dates[0]:''};
      }
`);
 }
 let restored=out;for(const [a,b]of edits.slice().reverse()){assert(restored.includes(b)&&restored.indexOf(b)===restored.lastIndexOf(b),'inverse unique');restored=restored.replace(b,()=>a);}assert(restored===baseline,'inverse byte preservation');
 fs.writeFileSync(target,Buffer.from(out,'latin1'));console.log(file+': '+copies.length+' canonical copies, '+edits.length+' verified recovery seams');
}
