'use strict';
/* MLS Assist 3.0.155 - pollaccept-1.0.0 + findbydob-1.2.0 (Fable, 2026-09-15).
 * Runs AD and AE (hidden, 3.0.153/3.0.154): the SAME row hit chart-deadline-exceeded twice with stage
 * "the read after identity poll 22-23 other": the banner was the right patient (its retry was adopted with an
 * exact DOB), but the poll's tolerant name matcher (two shared tokens) calls it 'other' for 42 s, the catch-all
 * then leaves 3 s for the read, and the retry waits the same 42 s again. pollaccept-1.0.0: outside the bootstrap
 * (write-grade) lease, a banner-grade candidate whose DOB is EXACTLY the expected DOB and whose name shares at
 * least one token with the expected name ends the poll at once - strictly no weaker than the existing 42 s
 * catch-all, which already returns any non-junk candidate; the app-side exact/alt name + DOB gate still judges
 * the read. The bootstrap lease is untouched (its exact-name bind is the write path). Every poll stage now
 * carries PHI-free codes (o<shared tokens> d<dob exact 0/1>) and every in-loop deadline carries the poll
 * counters (p<polls> n<no-click rounds> b<briefing seen>), so a slow row explains itself.
 * findbydob-1.2.0: the by-DOB shape diag was capped at the first four rows and a 35-row DOB list hid the one that
 * mattered; it is now a histogram over every DOB-hit row (code x count), 40 chars max.
 * Latin1 seams, inverse proof. Run once (after splice-30154.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
function splice(file, fn) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  const { out, inverse } = fn(before);
  assert.strictEqual(inverse(out), before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
}
const count = (s, n) => s.split(n).length - 1;
function mk(before) {
  let out = before; const edits = [];
  function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  const inverse = (x) => { let y = x; for (const [a, b] of edits.slice().reverse()) { assert(count(y, b) === 1, 'inverse unique: ' + b.slice(0, 40)); y = y.replace(b, () => a); } return y; };
  return { rep, inverse, get: () => out };
}
splice('background.js', (before) => {
  const m = mk(before);
  /* findbydob-1.2.0: histogram over every DOB-hit row */
  m.rep(" var __dobShapes = []; function __shapeCode(req, row) {", " var __dobShapes = {}; function __shapeCode(req, row) {", 'shape store');
  m.rep("        __fd.findRows++; if(byDob&&evidence.dobHit&&__dobShapes.length<4)__dobShapes.push(__shapeCode(name,evidence.rowName)); if(evidence.dobHit)__fd.findDobHit++;",
        "        __fd.findRows++; if(byDob&&evidence.dobHit){var __sc=__shapeCode(name,evidence.rowName);__dobShapes[__sc]=(__dobShapes[__sc]||0)+1;} if(evidence.dobHit)__fd.findDobHit++;", 'shape collect');
  m.rep("      if(byDob)__fd.findByDobShape=__dobShapes.join('-'); /* findbydob-1.1.0 */ if(pool.length!==1) return",
        "      if(byDob)__fd.findByDobShape=Object.keys(__dobShapes).sort().map(function(k){return k+'x'+__dobShapes[k];}).join('-').slice(0,40); /* findbydob-1.2.0 (3.0.155): every DOB-hit row, as code x count */ if(pool.length!==1) return", 'shape attach');
  /* pollaccept-1.0.0 */
  m.rep("        const nmm = (a, b) => { const nz = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim(); const ta = nz(a).split(' ').filter(x => x.length > 1), tb = nz(b).split(' ').filter(x => x.length > 1); const o = ta.filter(x => tb.indexOf(x) >= 0).length; return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1); };",
        "        const __nmmOverlap = (a, b) => { const nz = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim(); const ta = nz(a).split(' ').filter(x => x.length > 1), tb = nz(b).split(' ').filter(x => x.length > 1); return { o: ta.filter(x => tb.indexOf(x) >= 0).length, na: ta.length, nb: tb.length }; }; /* pollaccept-1.0.0 (3.0.155): the shared-token count, also as a PHI-free poll code */\n" +
        "        const nmm = (a, b) => { const r = __nmmOverlap(a, b); return r.o >= 2 || (r.o >= 1 && Math.min(r.na, r.nb) === 1); };\n" +
        "        const __dobExactHere = (c) => !!(wantDob && c && mlsExactDobKey(c.dob) && mlsExactDobKey(c.dob) === mlsExactDobKey(wantDob));", 'matcher');
  m.rep("          __chartStage = 'identity poll ' + polls + (cand && cand.name ? ((expectName && !nmm(cand.name, expectName)) ? ' other' : ' match') : ' none'); /* readstage-1.1.0 (3.0.137): which banner the poll saw, as a word */",
        "          __chartStage = 'identity poll ' + polls + (cand && cand.name ? ((expectName && !nmm(cand.name, expectName)) ? ' other' : ' match') : ' none') + (cand && cand.name && expectName ? (' o' + __nmmOverlap(cand.name, expectName).o + 'd' + (__dobExactHere(cand) ? 1 : 0)) : ''); /* readstage-1.1.0 (3.0.137): which banner the poll saw, as a word; pollaccept-1.0.0 (3.0.155): shared tokens + DOB-exact as codes */", 'stage codes');
  m.rep("          if (cand && cand.name && expectName && nmm(cand.name, expectName) && (!bootstrapIdentity || (polls >= 2 && bootstrapIdentityReady(cand, identityFrameResults)))) { ident = cand; if (!bootstrapIdentity) try { self.__mlsExpectOpen = null; } catch (e) {} break; }",
        "          if (cand && cand.name && expectName && nmm(cand.name, expectName) && (!bootstrapIdentity || (polls >= 2 && bootstrapIdentityReady(cand, identityFrameResults)))) { ident = cand; if (!bootstrapIdentity) try { self.__mlsExpectOpen = null; } catch (e) {} break; }\n" +
        "          /* pollaccept-1.0.0 (3.0.155): outside the bootstrap lease, a banner-grade candidate with the EXACT expected DOB and at least one shared name token is the expected patient printed under another name shape - no weaker than the 42 s catch-all below, and the app-side exact/alt name + DOB gate still judges the read. */\n" +
        "          if (!bootstrapIdentity && polls >= 2 && cand && cand.name && expectName && (cand.score || 0) >= 0 && /^(?:banner|shadow-banner|shadow-labels)$/.test(String(cand.via || '')) && __dobExactHere(cand) && __nmmOverlap(cand.name, expectName).o >= 1) { ident = cand; __chartStage += ' dob-exact'; try { self.__mlsExpectOpen = null; } catch (eDx) {} break; }", 'early accept');
  m.rep("            if (!(await chartWait(1800))) { chartFailDeadline('clinical chart load'); return; }",
        "            if (!(await chartWait(1800))) { chartFailDeadline('clinical chart load p' + polls + ' n' + noClickRounds + ' b' + (sawBriefing ? 1 : 0)); return; }", 'deadline load');
  m.rep("          if (!(await chartWait(bootstrapReadyEarly ? 600 : (polls < 3 ? 1200 : 2400)))) { chartFailDeadline('clinical chart readiness'); return; }",
        "          if (!(await chartWait(bootstrapReadyEarly ? 600 : (polls < 3 ? 1200 : 2400)))) { chartFailDeadline('clinical chart readiness p' + polls + ' n' + noClickRounds + ' b' + (sawBriefing ? 1 : 0)); return; }", 'deadline readiness');
  console.log('splice-30155 background.js: 8 seams');
  return { out: m.get(), inverse: m.inverse };
});
