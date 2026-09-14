'use strict';
/* MLS Assist 3.0.128 - bannernames-1.1.0 (Fable, 2026-09-14). The 3.0.127 run still refused
 * one same-DOB row as wrong-chart. Two gaps: the shadow-DOM reader's strategy B joins the
 * lines above the chip and okName() rejects any join carrying "Legal:", so a banner that
 * prints both names yields NO shadow identity at all; and the wrong-chart refusal carried
 * no PHI-free evidence of which reader produced the identity or how many printed names it
 * saw. Byte-preserving latin1 seams with an inverse proof. Run once: node scripts/splice-30128.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* 1. shadow strategy B: a joined banner that prints "Used Legal: Legal" yields the used name
      as the primary and the legal name as an alternative (identFrom's proven split) */
{
  const a = "            nameB = okName(lines.slice(i3 - kk, i3).join(' ').replace(/\\s+/g, ' ').trim());";
  const N = eolAt(a);
  rep(a,
      "            var joinedB = lines.slice(i3 - kk, i3).join(' ').replace(/[()]/g, ' ').replace(/\\s+/g, ' ').trim();" + N +
      "            /* bannernames-1.1.0 (3.0.128): split \"X Legal: Y\" into both printed names; the first" + N +
      "               valid one is the primary, the others ride as altNames for the exact-pair gate. */" + N +
      "            var partsB = joinedB.split(/legal\\s*:/i).map(function (s) { return s.replace(/\\s+/g, ' ').trim(); }).filter(Boolean);" + N +
      "            for (var pb = 0; pb < partsB.length; pb++) { var candB = okName(partsB[pb]); if (!candB) continue; if (!nameB) nameB = candB; else if (candB !== nameB && altNamesS.indexOf(candB) < 0) altNamesS.push(candB); }", 'B split');
  /* altNamesS is declared in strategy A's block above; make sure it is in scope for B (same function, var-hoisted) */
  assert(out.indexOf("var legalFirstS = labelVal(lines, /^legal first name$/i), altNamesS = [];") < out.indexOf("var joinedB = lines.slice(i3 - kk, i3)"), 'altNamesS declared before strategy B');
}

/* 2. the wrong-chart refusal says (PHI-free) which reader answered and how many names the banner printed */
rep("return chartRespond({ ok: false, reason: 'wrong-chart', attempted: false, captured: false, chartName: ident.name, chartDob: ident.dob || '', ",
    "return chartRespond({ ok: false, reason: 'wrong-chart', attempted: false, captured: false, chartName: ident.name, chartDob: ident.dob || '', bannerNamesPrinted: 1 + ((ident && Array.isArray(ident.altNames)) ? ident.altNames.length : 0), identVia: (ident && ident.via) || '', pairReason: exactGlobalPair.reason || '', ", 'wrong-chart diag');

let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30128: ' + edits.length + ' verified seams, ' + (out.length - before.length) + ' bytes delta');
