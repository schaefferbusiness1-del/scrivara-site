/* rr-1.1 (3.0.55) - the body-depth entry to the ax route.
 *
 * The rc-class lookup (2026-08-09) was unanimous: all 7 re-check-cleared rows
 * of the July run failed FIRST attempts at BODY depth on the classic surface
 * (visit-bodies-incomplete with no-group / no-bound-clinical-detail histograms)
 * and cleared on re-check AS clincmp-ax - the surface rotates DURING the
 * classic grind (the grind outlasts a ~25-30s recycle period). The rr-1.0
 * wait-arm sits inside the starved-walk hook and cannot reach a single one of
 * them. This splice wraps the ax-route body ONCE as a closure (wrap-once law)
 * with two entries:
 *   starved-walk (original semantics, unchanged acceptance: any ax visits),
 *   body-depth   (NEW: classic read ended partial; accept ONLY a COMPLETE ax
 *                 result, else the classic partial returns unchanged - the
 *                 chart can never end worse than today).
 * Identity discipline identical on both entries. visits-time-budget-exceeded
 * rows are out of scope BY ARITHMETIC (no runway left at that return site);
 * they stay with the si re-check. Latin1, all-or-nothing, landmark-guarded.
 */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;

/* ---- locate the current hook block (axr-1.0 + rr-1.0 as shipped) ---- */
const START = "      /* axr-1.0: when the classic walk STARVED";
const END = "      if (!gate.ok) {\n        return {\n          ok: false, reason: gate.reason, identity: identity, visits: [], diag: diag,";
function idxOne(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}
const a = idxOne(START, 'hook-start');
const b = idxOne(END, 'refusal-start');
if (!(b > a)) { console.error('ORDER violated'); process.exit(1); }
const oldBlock = s.slice(a, b);
/* landmarks: the block must be exactly the shipped axr+rr shape */
const landmarks = [
  "var rrWait = 0, rrRecovered = false;",
  "if (!axBest && Date.now() + 42000 < readDeadline) {",
  "rrStop = Math.min(readDeadline - 8000, rrT0 + 34000)",
  "if (axBest) { rrRecovered = true; break; }",
  "axRouteMs: Date.now() - axT0, axRrWaitMs: rrWait, axRrRecovered: rrRecovered,",
  "ax-identity-shape-unknown[",
  "if (axBest && Number.isFinite(axBestFrame)) {"
];
for (const l of landmarks) {
  if (oldBlock.split(l).length - 1 !== 1) { console.error('LANDMARK missing/dup: ' + l); process.exit(1); }
}
if (oldBlock.length < 5000 || oldBlock.length > 9000) { console.error('SIZE sanity failed: ' + oldBlock.length); process.exit(1); }

/* ---- the new block: same body, wrapped once, two entries ---- */
const newBlock =
`      /* axr-1.0 / rr-1.1: the ax-native route, wrapped ONCE with two entries.
         STARVED-WALK entry (original): the classic walk found no usable frame
         candidate - an identity-mismatch refusal never triggers it; acceptance
         is any ax visits (better than the refusal, receipt stays honest).
         BODY-DEPTH entry (rr-1.1): the classic read finished PARTIAL - the
         rc-class lookup was unanimous (7/7) that these charts rotate to
         clincmp-ax during the classic grind; acceptance is ONLY a COMPLETE ax
         result, else the classic partial returns unchanged. Identity
         discipline identical on both: every encounter passes the same
         visitIdentityGate; unknown shapes refuse as ax-identity-shape-unknown
         WITH captured signatures (the reader is its own census). */
      var rrWait = 0, rrRecovered = false;
      var axRouteRun = async function (rrFromPartial) {
        var axHR = await exec(emrId, null, ['axHarvest', cfg]);
        var axBest = null, axBestFrame = -1;
        ((axHR || [])).forEach(function (hr) {
          var r0 = hr && hr.result;
          if (r0 && r0.ok && r0.encounters && r0.encounters.length && (!axBest || r0.encounters.length > axBest.encounters.length)) { axBest = r0; axBestFrame = hr.frameId; }
        });
        if (!axBest && Date.now() + 42000 < readDeadline) {
          /* rr-1.0: a starved walk or unrotated partial with an EMPTY harvest
             is usually a surface MID-RECYCLE (the exam-prep context replaces
             the visits document every ~25-30s by itself). Wait out one recycle
             window - bounded, runway-gated - and re-harvest. The wait buys a
             SURFACE, never trust. The refusal/partial receipts carry
             axRrWaitMs so a wasted wait is visible. */
          var rrT0 = Date.now(), rrStop = Math.min(readDeadline - 8000, rrT0 + 34000);
          while (Date.now() < rrStop) {
            await sleep(1400);
            touchVisitLease();
            var rrHR = await exec(emrId, null, ['axHarvest', cfg]);
            ((rrHR || [])).forEach(function (hr) {
              var r1 = hr && hr.result;
              if (r1 && r1.ok && r1.encounters && r1.encounters.length && (!axBest || r1.encounters.length > axBest.encounters.length)) { axBest = r1; axBestFrame = hr.frameId; }
            });
            if (axBest) { rrRecovered = true; break; }
          }
          rrWait = Date.now() - rrT0;
        }
        if (axBest && Number.isFinite(axBestFrame)) {
          var axVisits = [], axRefused = 0, axShapeUnknown = 0, axSigs = [axBest.surfaceSig], axT0 = Date.now();
          var axCap = Math.min(axBest.encounters.length, Number(cfg.maxVisits) || 40);
          for (var axI = 0; axI < axCap; axI++) {
            if (Date.now() + 6000 >= readDeadline) break;
            var axE = axBest.encounters[axI];
            var axNav = await exec(emrId, [axBestFrame], ['axGo', cfg, axE.hrefPath]);
            var axNavOk = bestResult(axNav, function (r) { return r && r.ok === true ? 1 : 0; }).result;
            if (!axNavOk || axNavOk.ok !== true) { axRefused++; continue; }
            await sleep(1800);
            touchVisitLease();
            var axIdOk = false, axIdent = null;
            var axIdDeadline = Math.min(readDeadline, Date.now() + 5200);
            do {
              var axIds = await exec(emrId, [axBestFrame], ['identity', cfg]);
              axIdent = bestResult(axIds, function (r) { return (r && r.name ? 20 : 0) + (r && r.dob ? 15 : 0) + (r && r.mrn ? 10 : 0) + ((r && r.score) || 0); }).result || null;
              if (axIdent && visitIdentityGate(frozenHint, axIdent).ok) { axIdOk = true; break; }
              await sleep(700);
            } while (Date.now() < axIdDeadline);
            if (!axIdOk) {
              if (axIdent && (axIdent.name || axIdent.dob)) axRefused++; /* identity SEEN and mismatched - hard refusal */
              else { axShapeUnknown++; /* identity never found - the census case, own named class */
                var axSigR = await exec(emrId, [axBestFrame], ['axHarvest', cfg]);
                var axSig0 = bestResult(axSigR, function (r) { return r && r.ok ? 1 : 0; }).result;
                if (axSig0 && axSigs.length < 6) axSigs.push(axSig0.surfaceSig);
              }
              continue;
            }
            var axRd = await exec(emrId, [axBestFrame], ['axRead', cfg]);
            var axBody = bestResult(axRd, function (r) { return (r && r.ok && r.raw) ? r.raw.length : 0; }).result;
            if (!axBody || !axBody.ok) { axRefused++; continue; }
            axVisits.push({ date: axBody.headerDate || '', type: 'ax encounter', raw: axBody.raw, cpt: [], icd10: [], source: 'athena-copy', patientName: (axIdent && axIdent.name) || '', patientDob: (axIdent && axIdent.dob) || '', patientMrn: (axIdent && axIdent.mrn) || '', binding: { rowKey: 'enc:' + axE.eid, encounterId: axE.eid, index: axI } });
          }
          if (axVisits.length) {
            var axKept = axVisits.length, axTotalE = axBest.encounters.length;
            return {
              ok: true, reason: '', identity: (axVisits[0] ? { name: axVisits[0].patientName, dob: axVisits[0].patientDob, mrn: axVisits[0].patientMrn } : identity), visits: axVisits, diag: diag,
              receipt: { complete: axKept === axTotalE && axRefused === 0 && axShapeUnknown === 0, indexComplete: true, bodyComplete: axKept === axTotalE, fullDetail: axKept === axTotalE, expected: axTotalE, parsed: axKept, attempted: axCap, failures: axRefused + axShapeUnknown, cap: cfg.maxVisits, retryCount: 0, surfaceResets: 0, surfaceResetOps: [], chartSurface: 'clincmp-ax-route', axEntry: rrFromPartial ? 'body-depth' : 'starved-walk', axEncounters: axTotalE, axRefused: axRefused, axShapeUnknown: axShapeUnknown, axSigs: axSigs.slice(0, 6), axRouteMs: Date.now() - axT0, axRrWaitMs: rrWait, axRrRecovered: rrRecovered, identityVerified: true, stableKeysComplete: true, timeBudgetMs: readBudgetMs, elapsedMs: Math.max(0, Date.now() - readStartedAt) },
              error: axKept === axTotalE ? '' : ('The ax route read ' + axKept + ' of ' + axTotalE + ' encounters; ' + axRefused + ' refused (identity mismatch or read failure), ' + axShapeUnknown + ' refused as ax-identity-shape-unknown - signatures captured for the next probe shapes.')
            };
          }
          if (!rrFromPartial && (axShapeUnknown || axRefused)) {
            gate = { ok: false, reason: 'ax-identity-shape-unknown[' + axShapeUnknown + ' unknown, ' + axRefused + ' refused of ' + axBest.encounters.length + ']' };
            try { diag = diag || {}; diag.axSigs = axSigs.slice(0, 6); } catch (eAxD) {}
          }
        }
        return null;
      };
      if (!gate.ok && /^no-chart-frame-candidate/.test(String(gate.reason || '')) && Date.now() + 15000 < readDeadline) {
        var axStarvedRes = await axRouteRun(false);
        if (axStarvedRes) return axStarvedRes;
      }
`;
s = s.slice(0, a) + newBlock + s.slice(b);

/* ---- site 2: the body-depth call inside the classic partial return ---- */
const P = "      if (!bodyComplete) {\n        return {\n          ok: false, reason: 'visit-bodies-incomplete',";
const pIdx = idxOne(P, 'partial-return');
const P_HEAD = "      if (!bodyComplete) {\n";
const site2 =
`      if (!bodyComplete) {
        /* rr-1.1: the classic read ended partial. If the surface has rotated
           to clincmp-ax (usual: the grind outlasts a recycle period), a
           COMPLETE ax re-roll supersedes the partial; anything less keeps the
           classic partial - never worse than today. Time-budget-exceeded rows
           never reach here with runway and stay with the si re-check. */
        if (Date.now() + 15000 < readDeadline) {
          var axPartialRes = await axRouteRun(true);
          if (axPartialRes && axPartialRes.receipt && axPartialRes.receipt.complete === true) {
            axPartialRes.receipt.classicPartialSuperseded = { expected: clinicalTotal, parsed: visits.length, failures: failures.length };
            return axPartialRes;
          }
          receipt.axRrWaitMs = rrWait; receipt.axRrRecovered = rrRecovered;
        }
`;
s = s.slice(0, pIdx) + site2 + s.slice(pIdx + P_HEAD.length);

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED rr-1.1 bytes ' + before + ' -> ' + s.length + ' (hook block ' + oldBlock.length + ' -> ' + newBlock.length + ')');
