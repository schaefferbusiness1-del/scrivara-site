/* splice-30106-stackprov.js - ext 3.0.106 stackprov-1.1.0.
 * MEASURED 2026-09-01 after 3.0.105 (same single-day pull, same refusal): the
 * dashboard widget paints the SAME provider heading once per day column - the
 * visible column at x=568 AND the scrolled-to column at x=1977 that actually
 * holds the target day's rows. _headCols() de-duplicates headings by NAME and
 * keeps the FIRST instance (x=568, top 116 / 376), so 3.0.105's "nearest
 * heading above" compared the target column's rows (top 113) against the
 * other column's heading tops and found nothing above them. Cure: keep EVERY
 * heading instance with its own left edge, and give a row the nearest heading
 * that is both ABOVE it and in the SAME column (|left - left| < 60). This is
 * a generalisation that also covers side-by-side provider columns (heading at
 * the top of its own column); the old x-range rule stays as the fallback.
 * ASCII-only inserts; exact-count anchors on the 3.0.105 text.
 */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var edits = [
  { n: 1,
    find: "var cols=[],seen={};",
    repl: "var cols=[],seen={},allHeads=[];/* stackprov-1.1.0: every heading instance, per column */" },
  { n: 1,
    find: "if(nm&&!seen[key]){seen[key]=1;cols.push({name:nm,lo:r.left,rr:r.right,top:r.top});",
    repl: "if(nm)allHeads.push({name:nm,lo:r.left,top:r.top});/* stackprov-1.1.0: every instance, not just the first per name */if(nm&&!seen[key]){seen[key]=1;cols.push({name:nm,lo:r.left,rr:r.right,top:r.top});" },
  { n: 1,
    find: "return cols;",
    repl: "cols.all=allHeads;return cols;" },
  { n: 1,
    find: "var prov='';var _stacked=cols.length>=2&&cols.every(function(c){return Math.abs(c.lo-cols[0].lo)<24;});if(_stacked){",
    repl: "var prov='';var _all=cols.all||[];var _same=null;for(var q=0;q<_all.length;q++){var hh=_all[q];if(Math.abs(hh.lo-r.left)<60&&hh.top<=r.top+2&&(!_same||hh.top>_same.top))_same=hh;}if(_same){/* stackprov-1.1.0 (3.0.106, measured 2026-09-01): nearest heading ABOVE the row in the row's OWN column - the widget repeats each heading per day column and dedupe kept the wrong column's copy */prov=_same.name;out.diag.columnTagged=(out.diag.columnTagged||0)+1;}var _stacked=!prov&&cols.length>=2&&cols.every(function(c){return Math.abs(c.lo-cols[0].lo)<24;});if(_stacked){" }
];
edits.forEach(function (e, i) {
  var n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': hits=' + n); process.exit(1); }
  if (/[^\x00-\x7f]/.test(e.repl)) { console.error('ABORT edit ' + i + ': non-ASCII'); process.exit(1); }
  s = s.split(e.find).join(e.repl);
});
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK stackprov-1.1.0 spliced (4 edits)');
