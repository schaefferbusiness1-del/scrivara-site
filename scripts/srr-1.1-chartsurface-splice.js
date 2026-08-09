/* srr-1.1 (3.0.51 candidate - DO NOT RUN while any train or live pull is active):
 * receipt.chartSurface = 'clincmp-ax' | 'classic' | '' derived from the accepted
 * encounter-list frame's own URL at index acceptance. Gives the owner the CLINCMP
 * rollout trend per day and gives us the denominator for the ax-native reader
 * decision (supervisor 2026-08-08). Latin1, exact-count anchors, all-or-nothing. */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* A. derive the surface beside the srr-1.0 epoch capture (identity.url is the
   accepted frame's own URL, read by the 3.0.49 walk). */
const A = '      var listDocId = await visitsListFrameDocId(emrId, listFrame);';
must(A, 'A-epoch-anchor');
const surf =
`      /* srr-1.1: name the surface this chart was read on. The CLINCMP/ax
         rollout only moves one way; the receipt carries which UI answered so
         the trend is a number, not a mystery that reads as regression. */
      var chartSurface = '';
      try { chartSurface = /\\/ax\\/|briefing/i.test(String((identity && identity.url) || '')) ? 'clincmp-ax' : 'classic'; } catch (eSurf) { chartSurface = ''; }
`;
s = s.slice(0, s.indexOf(A)) + surf + s.slice(s.indexOf(A));

/* B. receipt field rides beside surfaceResets. */
const B = 'retryCount: retryCount, surfaceResets: surfaceResets, surfaceResetOps: surfaceResetOps.slice(0, 6),';
must(B, 'B-receipt');
s = s.split(B).join(B + ' chartSurface: chartSurface,');

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED srr-1.1 chartSurface');
/* APP-SIDE SEAMS for the same train (feat_mls_schedimport_exact.js, Edit tool OK there):
 * 1. ~3443 `one.visitsComplete = true; one.visitCount = ...` — add
 *    `one.surfaceResets = savedVisits.surfaceResets; one.chartSurface = savedVisits.chartSurface;`
 *    and make the savedVisits builder copy both from the extension response receipt.
 * 2. ~3480 ppSettle(...) — extend the settled row `r` (in ppSettle, ~2907) with
 *    `sr` + `surface` optional params so __mlsDayHistoryPull.state.rows carries them.
 * 3. ppState rows ACCUMULATE across runs when entered with progressBase>0 (si-1.9.4
 *    owner law forbids mid-run bar resets) — stamp rows with a runId so readers can
 *    slice the current run without resetting anything.
 *
 * Test pins to add to tests/surface-recycle-rebind.test.js in the same train:
 *   r.push(/var chartSurface = '';/.test(s));
 *   r.push(/clincmp-ax/.test(s));
 *   r.push(/surfaceResetOps\.slice\(0, 6\), chartSurface: chartSurface,/.test(s));
 * plus the control-arm strips. Release train: manifest 3.0.51 + digest + zip +
 * pin sweep (reuse scripts/sweep-3050.js pattern with 3.0.50->3.0.51, new sha,
 * chk3051 rotation) + tests + gate + bump + push + serve/install/pong. */
