'use strict';
/* MLS Assist 3.0.127 - bannernames-1.0.0 (Fable, 2026-09-14). Measured live on the
 * 2026-09-14 day pull (3.0.125): one row was refused wrong-chart twice because the chart
 * banner showed the patient's PREFERRED name while the schedule row (and MLS) carried the
 * LEGAL name printed right beside it ("Legal: ..."). Both names are athena's own names for
 * that chart, so the exact first+last+DOB rule now accepts a match against EITHER name the
 * banner prints; nothing is guessed, no nickname table exists, DOB stays exact.
 * Byte-preserving latin1 seams with an inverse proof. Run once: node scripts/splice-30127.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* A. light-DOM banner reader (mlsReadChartIdentity) */
{
  const a = "  var name = '', dob = '', mrn = '', via = '';";
  const N = eolAt(a);
  rep(a + N + "  function dstr(m) {", "  var name = '', dob = '', mrn = '', via = '', altNames = []; /* bannernames-1.0.0 */" + N + "  function dstr(m) {", 'A decl');
  const lb = "        var PL = lines[i - lb];";
  const N2 = eolAt(lb);
  rep(lb + N2 + "        name = looksName(PL);",
      lb + N2 + "        /* bannernames-1.0.0 (3.0.127): a name line that also carries \"Legal: ...\" keeps its" + N2 +
      "           used name before the colon; the legal name is collected below. */" + N2 +
      "        name = looksName(String(PL).split(/legal\\s*:/i)[0].replace(/[()]/g, ' ').replace(/\\s+/g, ' ').trim());", 'A lookback');
  const v = "    via = 'banner';";
  const N3 = eolAt(v);
  rep(v + N3,
      v + N3 +
      "    /* bannernames-1.0.0 (3.0.127): the banner prints the patient's used name and, when" + N3 +
      "       they differ, the legal name (\"Legal: ...\"). Collect the legal name as an" + N3 +
      "       alternative so the exact first+last+DOB rule can match either name athena" + N3 +
      "       itself prints for this chart. Nothing is guessed. */" + N3 +
      "    try {" + N3 +
      "      for (var lg = Math.max(0, i - 3); lg <= Math.min(lines.length - 1, i + 1); lg++) {" + N3 +
      "        var lgm = /legal\\s*:\\s*(.*)$/i.exec(lines[lg]);" + N3 +
      "        if (!lgm) continue;" + N3 +
      "        var lgc = lgm[1].replace(/[()]/g, ' ').replace(/\\s+/g, ' ').trim();" + N3 +
      "        if (!lgc && lg + 1 < lines.length) lgc = String(lines[lg + 1]).replace(/[()]/g, ' ').replace(/\\s+/g, ' ').trim();" + N3 +
      "        var lgn = looksName(lgc.split(/[\\u00b7|]/)[0].replace(/\\s+$/, ''));" + N3 +
      "        if (lgn && lgn !== name && altNames.indexOf(lgn) < 0) altNames.push(lgn);" + N3 +
      "      }" + N3 +
      "    } catch (eLegal) {}" + N3, 'A legal scan');
  rep("  return { name: name, dob: dob, mrn: mrn, score: score, via: via, w: bodyW, h: bodyH, url: String(typeof href !== 'undefined' ? (href || '') : '') };",
      "  return { name: name, dob: dob, mrn: mrn, altNames: altNames, score: score, via: via, w: bodyW, h: bodyH, url: String(typeof href !== 'undefined' ? (href || '') : '') };", 'A return');
}

/* B. shadow-DOM banner reader (mlsReadChartIdentityShadow): the label block names both */
{
  const a = "      var last = labelVal(lines, /^legal last name$/i);";
  const N = eolAt(a);
  rep(a + N, a + N + "      var legalFirstS = labelVal(lines, /^legal first name$/i), altNamesS = []; /* bannernames-1.0.0 */" + N, 'B decl');
  const b = "        if (okA && dm) { name = okA; dob = dstr(dm); mrn = pidA; via = 'shadow-labels'; }";
  const N2 = eolAt(b);
  rep(b + N2, b + N2 +
      "        /* bannernames-1.0.0 (3.0.127): the legal first name is a second name athena prints for this chart. */" + N2 +
      "        if (name && isVal(legalFirstS) && isVal(last) && legalFirstS !== first) { var altS = okName((legalFirstS + ' ' + last).replace(/\\s+/g, ' ').trim()); if (altS && altS !== name && altNamesS.indexOf(altS) < 0) altNamesS.push(altS); }" + N2, 'B alt');
  rep("      var r = { name: name, dob: dob, mrn: mrn, score: score, via: via, w: bodyW, h: bodyH, url: String(typeof href !== 'undefined' ? (href || '') : '') };",
      "      var r = { name: name, dob: dob, mrn: mrn, altNames: altNamesS, score: score, via: via, w: bodyW, h: bodyH, url: String(typeof href !== 'undefined' ? (href || '') : '') };", 'B return');
}

/* C. chart read handler: the exact pair may match any name the banner prints */
{
  const a = "          const identityMatchesTarget = (who) => {";
  const N = eolAt(a);
  rep(a + N + "            return mlsExactIdentityPair({name:want,dob:wantDob,mrn:wantMrn},who).ok;",
      "          /* bannernames-1.0.0 START */" + N +
      "          const exactPairAny = (expected, who) => {" + N +
      "            const base = mlsExactIdentityPair(expected, who || {});" + N +
      "            if (base.ok) return base;" + N +
      "            const alts = (who && Array.isArray(who.altNames)) ? who.altNames : [];" + N +
      "            for (let ai = 0; ai < alts.length; ai++) { const alt = mlsExactIdentityPair(expected, Object.assign({}, who, { name: alts[ai] })); if (alt.ok) return Object.assign({}, alt, { viaAltName: true }); }" + N +
      "            return base;" + N +
      "          };" + N +
      "          /* bannernames-1.0.0 END */" + N +
      a + N + "            return exactPairAny({name:want,dob:wantDob,mrn:wantMrn},who).ok;", 'C matcher');
  rep("          const exactGlobalPair = want ? mlsExactIdentityPair({name:want,dob:wantDob,mrn:wantMrn}, ident || {}) : { ok: false, reason: 'no-target' };",
      "          const exactGlobalPair = want ? exactPairAny({name:want,dob:wantDob,mrn:wantMrn}, ident || {}) : { ok: false, reason: 'no-target' };", 'C gate');
}

let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30127: ' + edits.length + ' verified seams, ' + (out.length - before.length) + ' bytes delta');
