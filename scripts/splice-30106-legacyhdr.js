/* splice-30106-legacyhdr.js - legacyhdr-1.0.0 (folded into 3.0.106).
 * MEASURED 2026-09-01 20:1x with the new reader trace: the rows that a
 * provider-scoped pull refused came from the LEGACY DAY-GRID reader
 * (reader.strategy 'legacy-day-grid'), not from the grid/coordinate/sequence
 * readers patched by sectionprov/stackprov. That reader derives ONE provider
 * per appointment list from the list's headings and, when a list carries more
 * than one heading (the dashboard widget puts BOTH clinicians' headings and
 * rows in a single list), gives every row provider '' - the exact receipt
 * ("2 of 2 rows carry no provider identity", discovered providers = both
 * names). Cure: when a list has several headings, each row takes the nearest
 * heading that PRECEDES it in document order inside that list. A list with a
 * single heading keeps the exact old rule; a list with none stays unbound.
 * The receipt counts rows bound this way (headingRows). ASCII-only inserts.
 */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var edits = [
  { n: 1,
    find: "var provider=local.length===1?local[0]:(out.diag.singleProviderName||'');",
    repl: "var listProvider=local.length===1?local[0]:(out.diag.singleProviderName||'');/* legacyhdr-1.0.0 (3.0.106): with several headings in one list, each row is bound to the heading that precedes it */var _lgHeadElsL=[];if(local.length>1){try{_lgHeadElsL=[].slice.call(list.querySelectorAll('[class~=\"appointment-header2\"],[class*=\"appointment-header\"],[class*=\"provider-header\"],[class*=\"provider-name\"],[class*=\"schedule-provider\"],[class*=\"column-header\"],[data-provider-name],header,h1,h2,h3,h4,caption,legend')).filter(function(h){var t=cl(tx(h));var inRow=false;try{inRow=!!(h.closest&&h.closest('[class~=\"filled-appointment-row\"]'));}catch(_eIR){}return !!(t&&lh(t)&&!inRow);});}catch(_eLHE){_lgHeadElsL=[];}}" },
  { n: 1,
    find: "if(!provider)_legacyAllBoundL=false;",
    repl: "/* legacyhdr-1.0.0: bound per row below */" },
  { n: 1,
    find: "var raw=tx(row),tm=ft(raw),appointmentId=_legacyAttrL(row,['data-appointment-id'",
    repl: "var provider=listProvider;if(!provider&&_lgHeadElsL.length){var _lgBest=null;for(var _lgH=0;_lgH<_lgHeadElsL.length;_lgH++){try{if(_lgHeadElsL[_lgH].compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING)_lgBest=_lgHeadElsL[_lgH];}catch(_eCDP){}}if(_lgBest){provider=_legacyProviderL(cl(tx(_lgBest)))||'';if(provider)out.diag.headingRows=(out.diag.headingRows||0)+1;}}if(!provider)_legacyAllBoundL=false;var raw=tx(row),tm=ft(raw),appointmentId=_legacyAttrL(row,['data-appointment-id'" }
];
edits.forEach(function (e, i) {
  var n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': hits=' + n); process.exit(1); }
  if (/[^\x00-\x7f]/.test(e.repl)) { console.error('ABORT edit ' + i + ': non-ASCII'); process.exit(1); }
  s = s.split(e.find).join(e.repl);
});
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK legacyhdr-1.0.0 spliced (3 edits)');
