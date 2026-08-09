/* rr-1.0 (3.0.55) - the in-chart re-roll: when the classic walk STARVED and the
 * ax harvest found NOTHING, the surface is usually mid-recycle (the exam-prep
 * context replaces the visits document every ~25-30s by itself). Wait out one
 * recycle window - bounded, runway-gated - and re-harvest. The wait buys a
 * SURFACE, never trust: every downstream encounter read still passes the same
 * per-encounter visitIdentityGate. Latin1, all-or-nothing, count-guarded.
 * Observed class this converts: re-check-cleared rows that failed
 * no-surface-tag then landed clincmp-ax on the automatic re-check
 * (3/3 dissected on 3.0.53; day 8 had 4 of 13 such rows). */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* ---- A. init the telemetry vars at hook entry (always runs when hook fires) ---- */
const A = "        var axHR = await exec(emrId, null, ['axHarvest', cfg]);";
must(A, 'A-hook-entry');
s = s.slice(0, s.indexOf(A)) +
"        var rrWait = 0, rrRecovered = false;\n" + A +
s.slice(s.indexOf(A) + A.length);

/* ---- B. the wait-arm: empty harvest + runway >= 42s -> wait out one recycle ---- */
const B = "        if (axBest && Number.isFinite(axBestFrame)) {";
must(B, 'B-wait-arm-site');
const arm =
`        if (!axBest && Date.now() + 42000 < readDeadline) {
          /* rr-1.0: acceptance on this arm is the per-encounter identity gate
             (positive), not the srr epoch triple - a starved walk has no bound
             frame whose epoch could be measured. Cost bound: at most one
             34s window, only when the chart still has 42s of runway; the
             refusal receipt carries axRrWaitMs so a wasted wait is visible. */
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
${B}`;
s = s.slice(0, s.indexOf(B)) + arm.slice(0, arm.length - B.length) + s.slice(s.indexOf(B));

/* ---- C. success receipt carries the wait telemetry ---- */
const C = "axRouteMs: Date.now() - axT0,";
must(C, 'C-success-receipt');
s = s.slice(0, s.indexOf(C)) + C + " axRrWaitMs: rrWait, axRrRecovered: rrRecovered," + s.slice(s.indexOf(C) + C.length);

/* ---- D. the starved-refusal receipt carries it too (typeof-guarded: this
   return also serves identity-mismatch refusals where the hook never ran) ---- */
const D = "receipt: { complete: false, indexComplete: true, bodyComplete: false, fullDetail: false, expected: total, parsed: 0, attempted: 0, cap: cfg.maxVisits, identityVerified: false }";
must(D, 'D-refusal-receipt');
const D2 = "receipt: { complete: false, indexComplete: true, bodyComplete: false, fullDetail: false, expected: total, parsed: 0, attempted: 0, cap: cfg.maxVisits, identityVerified: false, axRrWaitMs: (typeof rrWait === 'number' ? rrWait : 0), axRrRecovered: (typeof rrRecovered === 'boolean' ? rrRecovered : false) }";
s = s.slice(0, s.indexOf(D)) + D2 + s.slice(s.indexOf(D) + D.length);

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED rr-1.0 bytes ' + before + ' -> ' + s.length);
