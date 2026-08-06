'use strict';

/* 3.0.4 (2026-07-23): a legacy-day-grid day whose rendered rows ALL classify
 * as slots (frozen/blocked/hold/open/...) must count as authoritatively empty
 * of appointments. The verified-empty probe never fires on block-only days —
 * the grid is not visually empty, it just has no patient rows — so
 * 2026-07-10 and 2026-07-18 (block-only) could never verify and every month
 * pull carried them as eternal retry days. The proof is deliberately narrow:
 * legacy exact lane only (non-virtualized grid), zero candidates, and at
 * least one row actually removed as a slot. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
/* er-1.2 (3.0.40): pin the STAGED candidate reader when one exists, exactly
   like the other schedule contracts - on publish the root carries the same
   bytes and the candidate path naturally wins either way. */
const candidateChain = ['3.0.45', '3.0.44', '3.0.43', '3.0.42', '3.0.41', '3.0.40', '3.0.38', '3.0.37', '3.0.36', '3.0.35', '3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const bgPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const bg = fs.readFileSync(bgPath, 'latin1');

assert(/var __allSlotDay = __legacyExactCount && __parsedCount === 0 && __candidateCount === 0 && Number\(__dd\.slotRowsRemoved \|\| 0\) > 0;/.test(bg),
  'all-slot-day proof must be narrow: legacy lane, zero parsed, zero candidates, >0 removed slot rows');
if (bg.indexOf('er-1.2') !== -1) {
  /* er-1.2: the probe branch additionally requires the picked frame's own
     settled empty proof; the narrow all-slot-day proof is unchanged. */
  assert(bg.includes("&& __dd.emptyStable === true) || __allSlotDay;"),
    'er-1.2: authoritative-empty must require the settled frame proof beside the probe, keeping the all-slot-day proof');
} else {
  assert(/__authoritativeEmpty = \(__parsedCount === 0 && \(__surface\.probes \|\| \[\]\)\.some\(function \(p\) \{ return p && p\.verified && p\.empty; \}\)\) \|\| __allSlotDay;/.test(bg),
    'authoritative-empty must accept the all-slot-day proof alongside the verified-empty probe');
}
/* the slot classifier feeding slotRowsRemoved must still know frozen rows (3.0.3) */
assert(bg.includes('open|blocked?|frozen|freeze|hold|unavailable|lunch|closed'),
  'the slot classifier lost the 3.0.3 frozen alternation');

console.log('PASS schedule empty-day proof: block-only days are authoritatively empty (narrow legacy-lane proof), frozen classifier intact');
