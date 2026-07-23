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
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

assert(/var __allSlotDay = __legacyExactCount && __parsedCount === 0 && __candidateCount === 0 && Number\(__dd\.slotRowsRemoved \|\| 0\) > 0;/.test(bg),
  'all-slot-day proof must be narrow: legacy lane, zero parsed, zero candidates, >0 removed slot rows');
assert(/__authoritativeEmpty = \(__parsedCount === 0 && \(__surface\.probes \|\| \[\]\)\.some\(function \(p\) \{ return p && p\.verified && p\.empty; \}\)\) \|\| __allSlotDay;/.test(bg),
  'authoritative-empty must accept the all-slot-day proof alongside the verified-empty probe');
/* the slot classifier feeding slotRowsRemoved must still know frozen rows (3.0.3) */
assert(bg.includes('open|blocked?|frozen|freeze|hold|unavailable|lunch|closed'),
  'the slot classifier lost the 3.0.3 frozen alternation');

console.log('PASS schedule empty-day proof: block-only days are authoritatively empty (narrow legacy-lane proof), frozen classifier intact');
