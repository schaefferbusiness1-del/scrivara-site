'use strict';

/* The visit store holds three trust tiers (indexOnly shell, unflagged copied
 * excerpt, fullDetail+bodyComplete verified body) but the profile timeline
 * rendered them identically — an index row read like a complete visit
 * (observed live 2026-07-20: 25 pulled visits, 0 verified bodies, only 3 even
 * flagged indexOnly). Contract: pulled rows that are NOT complete verified
 * bodies carry an honest marker naming what is missing and how to fetch it;
 * clinician-authored MLS visits and complete verified bodies stay unmarked.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

const start = source.indexOf('function visitProvenance(v)');
const end = source.indexOf('function visitCard(p, v)', start);
assert(start > 0 && end > start, 'visitProvenance boundaries missing');
const slice = source.slice(start, end);

// the renderer must actually consume it: a header chip and a body line
assert(/head\.appendChild\(pv\)/.test(source), 'the provenance chip is not appended to the visit header');
assert(/mlsvh-prov-line/.test(source), 'the provenance detail line is not rendered in the visit body');

const context = vm.createContext({
  S: x => (x == null ? '' : String(x)),
  trim: x => String(x == null ? '' : x).trim()
});
vm.runInContext(slice, context, { filename: 'feat_visits.js:visitProvenance' });
const prov = v => vm.runInContext('visitProvenance(' + JSON.stringify(v) + ')', context);

// 1. index-only shell → "index only" with the re-pull remedy
const shell = prov({ source: 'athena-order-group-index', indexOnly: true });
assert(shell && shell.chip === 'index only', 'index shell not marked');
assert(/Re-pull this day/.test(shell.detail), 'index marker lacks the remedy');

// 2. unflagged copied excerpt (the live 22/25 class) → "partial"
const copy = prov({ source: 'athena-copy', textHead: 'copied excerpt', raw: '' });
assert(copy && copy.chip === 'partial', 'unflagged copied excerpt not marked partial');

// 2b. unflagged pulled row with NO text at all → "index only", never "partial"
//     ("partial" claims a copied excerpt exists; an empty unmarked row has none)
const bare = prov({ source: 'athena-visits', raw: '', textHead: '' });
assert(bare && bare.chip === 'index only', 'content-less unmarked pulled row must read as index only, got: ' + JSON.stringify(bare));
assert(/Re-pull this day/.test(bare.detail), 'content-less unmarked row lacks the re-pull remedy');

// 3. full verified body → unmarked
assert.strictEqual(prov({ source: 'athena-visits', fullDetail: true, bodyComplete: true, raw: 'Full verified encounter body text.' }), null,
  'a complete verified body must carry no caveat');

// 4. clinician-authored MLS visit → unmarked (no pull ever happened)
assert.strictEqual(prov({ source: 'mls-visit-editor', indexOnly: false }), null,
  'clinician-authored visits must carry no pull caveat');

// 5. loaders ship the new module bytes
for (const loader of ['mls-connect.js', 'mls-connect.staging.js']) {
  const text = fs.readFileSync(path.join(root, loader), 'utf8');
  assert(text.includes('feat_visits.js?v=20260722vis7'), loader + ': feat_visits cache pin not bumped — the SW would serve the old module forever');
}

console.log('PASS visit-history provenance: index shells and copied excerpts are honestly marked with a remedy; verified bodies and clinician-authored visits stay unmarked; loader pins bumped');
