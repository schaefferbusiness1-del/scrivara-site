/* splice-30105-stackprov.js - ext 3.0.105 stackprov-1.0.0.
 * MEASURED 2026-09-01 (owner's athenaOne dashboard schedule widget, single-day
 * pull of 2026-08-05 scoped to one PA, read by the coordinate reader with
 * countStrategy legacy-grid-candidate-rows): the widget paints each provider as
 * a full-width HEADING stacked vertically (Uyen Phan, PA-C ... then Matthew
 * Schaeffer, MD ...), not as side-by-side columns. _headCols() sorts the
 * headings by LEFT edge and sets each column's `hi` to the NEXT column's `lo`;
 * with both headings at the same left edge that gives hi == lo, an empty
 * range, so every row's centre matched no column and every row came back
 * provider '' while the read still named both clinicians. The app-side
 * identity gate then refused all 13 remaining days as "no provider identity"
 * (fail-closed, correctly). Cure, in the reader that saw the headings: when
 * the headings are STACKED (same left edge), a row belongs to the nearest
 * heading ABOVE it; side-by-side columns keep the exact x-range rule. The
 * receipt counts rows tagged this way. ASCII-only insert; exact-count anchors.
 */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var edits = [
  { n: 1,
    find: "cols.push({name:nm,lo:r.left,rr:r.right});",
    repl: "cols.push({name:nm,lo:r.left,rr:r.right,top:r.top});/* stackprov-1.0.0: keep the heading's top so a stacked layout can assign by vertical order */" },
  { n: 1,
    find: "var prov='';for(var k=0;k<cols.length;k++){if(cx>=cols[k].lo-6&&cx<cols[k].hi){prov=cols[k].name;break;}}",
    repl: "var prov='';var _stacked=cols.length>=2&&cols.every(function(c){return Math.abs(c.lo-cols[0].lo)<24;});if(_stacked){/* stackprov-1.0.0 (3.0.105, measured 2026-09-01): headings share one left edge = the dashboard widget's vertical per-provider groups, where the x-range rule below degenerates to an empty range; a row belongs to the nearest heading ABOVE it */var _best=null;for(var k=0;k<cols.length;k++){if(typeof cols[k].top==='number'&&cols[k].top<=r.top+2&&(!_best||cols[k].top>_best.top))_best=cols[k];}if(_best){prov=_best.name;out.diag.stackedTagged=(out.diag.stackedTagged||0)+1;}}else{for(var k=0;k<cols.length;k++){if(cx>=cols[k].lo-6&&cx<cols[k].hi){prov=cols[k].name;break;}}}" }
];
edits.forEach(function (e, i) {
  var n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': hits=' + n); process.exit(1); }
  if (/[^\x00-\x7f]/.test(e.repl)) { console.error('ABORT edit ' + i + ': non-ASCII'); process.exit(1); }
  s = s.split(e.find).join(e.repl);
});
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK stackprov-1.0.0 spliced (2 edits)');
