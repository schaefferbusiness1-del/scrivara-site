'use strict';
/* MLS Assist 3.0.149 - findmrn-1.0.0 + legsdiag-1.1.0 (Fable, 2026-09-15). Run Z on 3.0.148 (legsdiag) named the
 * legs of the row that refuses on every run: legFind = no-name-match (the Find page DID list results, but no row
 * passed the exact printed-name + DOB pair), legSched = not-run (the schedule re-ground refused first). The Find
 * driver already carries an MRN cell matcher (mrnCellMatches, labeled or whole-token, never a date or a short
 * number) that nothing calls. Cure, inside the owner's rule ("auto-merge only on MRN or name+DOB"): when no row
 * passes the exact pair and EXACTLY ONE row carries the requested MRN with no contradicting DOB, that row is the
 * patient (mrnMatched:true, mrnNarrowed:true, counted as findMrnHit); the re-read before the click accepts the same
 * evidence; the chart that opens is still identity-gated by the read path as before. legsdiag-1.1.0: a refusal
 * also carries the Find leg's PHI-free counts (findRows/findDobHit/findNameHit/findDobOnly/findAltRows/
 * findMrnHit/findTokens/findRetries) so the next refusal can be read without another run. content.js allowlists
 * findMrnHit. Latin1 seams, inverse proof. Run once (after splice-30149.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
function splice(file, edits) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  let out = before; const done = [];
  const count = (s, n) => s.split(n).length - 1;
  for (const [a, b, label] of edits) {
    assert(count(out, a) === 1, file + ' ' + label + ' unique seam: ' + a.slice(0, 80) + ' (' + count(out, a) + ')');
    assert(a.indexOf(b) >= 0 || count(out, b) === 0, file + ' ' + label + ' replacement absent');
    out = out.replace(a, () => b); done.push([a, b]);
  }
  let restored = out;
  for (const [x, y] of done.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
  assert.strictEqual(restored, before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
  console.log('splice-30149b ' + file + ': ' + done.length + ' verified seams');
}
splice('background.js', [
  ["return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,dob:dates.length===1?dates[0]:'',dobHit:__dobHit,nameHit:__nameHit,alt:/\\(|\\blegal\\b|\\bpreferred\\b/i.test(cells.join(' '))};",
   "return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,dob:dates.length===1?dates[0]:'',dobHit:__dobHit,nameHit:__nameHit,alt:/\\(|\\blegal\\b|\\bpreferred\\b/i.test(cells.join(' ')),mrnHit:!!wantMrn&&cells.some(function(x){return mrnCellMatches(x,wantMrn);}),dobVeto:dates.length===1&&!!mlsExactDobKey(dob)&&dates[0]!==mlsExactDobKey(dob)}; /* findmrn-1.0.0 (3.0.149): the row's MRN evidence and its DOB veto */",
   'evidence'],
  ["      var __fd = { findRows: 0, findDobHit: 0, findNameHit: 0, findDobOnly: 0, findAltRows: 0 };",
   "      var __fd = { findRows: 0, findDobHit: 0, findNameHit: 0, findDobOnly: 0, findAltRows: 0, findMrnHit: 0 }; var mrnPool = []; /* findmrn-1.0.0 (3.0.149) */",
   'counters'],
  ["        if(evidence.ok) pool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:false});",
   "        if(evidence.ok) pool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:false}); else if(evidence.mrnHit&&!evidence.dobVeto){__fd.findMrnHit++; mrnPool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:true});} /* findmrn-1.0.0 */",
   'pool'],
  ["      if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};",
   "      if(pool.length===0&&mrnPool.length===1){pool=mrnPool;mrnNarrowed=true;} /* findmrn-1.0.0 (3.0.149): the owner's rule - an exact MRN with no contradicting DOB identifies the row when the printed name does not; two MRN rows stay refused */\n" +
   "      if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};",
   'accept'],
  ["        for(var _rvI=0;_rvI<_rvAs.length;_rvI++) {var _rvTr=_rvAs[_rvI].closest ? _rvAs[_rvI].closest('tr') : null;if(_rvTr&&exactResultRow(_rvTr).ok)_rvRows.push(_rvAs[_rvI]);}",
   "        for(var _rvI=0;_rvI<_rvAs.length;_rvI++) {var _rvTr=_rvAs[_rvI].closest ? _rvAs[_rvI].closest('tr') : null;if(_rvTr){var _rvEv=exactResultRow(_rvTr);if(_rvEv.ok||(pool[0].mrnMatched===true&&_rvEv.mrnHit&&!_rvEv.dobVeto))_rvRows.push(_rvAs[_rvI]);}} /* findmrn-1.0.0: the re-read accepts the same evidence the choice used */",
   'reread'],
  ["legOrder: (typeof order !== 'undefined' && Array.isArray(order)) ? order.join('-') : '' }); } catch (_eLegs) {} }",
   "legOrder: (typeof order !== 'undefined' && Array.isArray(order)) ? order.join('-') : '' }); if (__fr && __fr.diag) { ['findRows', 'findDobHit', 'findNameHit', 'findDobOnly', 'findAltRows', 'findMrnHit', 'findTokens', 'findRetries'].forEach(function (k) { if (__p.diag[k] == null && __fr.diag[k] != null) __p.diag[k] = __fr.diag[k]; }); } /* legsdiag-1.1.0 (3.0.149): the Find leg's counts ride on every refusal */ } catch (_eLegs) {} }",
   'wrapper']
]);
splice('content.js', [[
  "'findRetries' /* compound3-1.0.0 (3.0.139) */].forEach(function (key) {",
  "'findRetries' /* compound3-1.0.0 (3.0.139) */, 'findMrnHit' /* findmrn-1.0.0 (3.0.149) */].forEach(function (key) {",
  'allowlist']]);
