'use strict';

/* sv-1.0.3 (owner screenshot 2026-07-21): the "Save not confirmed" wall.
 * Root cause: the dedupe guards deliberately FOLD a pulled name variant
 * ("Ellis Huff") into the existing full record ("Ellis R Huff") under a
 * DIFFERENT id — the save persists, but the verifier's exact-name fallback
 * could not see it, so every pull carrying a name variant produced a false
 * warning, and each warning stacked as its own full-width card.
 *
 * Contract:
 *  - freshPatient finds a folded record via DOB-anchored token-tolerant name
 *    match or exact MRN — never name-only fuzzy, never a DOB conflict;
 *  - repeated/rapid warnings AGGREGATE into one self-replacing card that
 *    names the items (no stacked wall), and the window resets over time.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_save_verify.js'), 'utf8');

assert(src.includes("var VERSION = '1.0.3';"), 'sv-1.0.3 must be the active version');

// ---- extract the pure helpers + freshPatient --------------------------------
const helpers = src.slice(src.indexOf('function _svNameTokens'), src.indexOf('function storedVisits'));
const support = `
  function fn(name){ return typeof CTX[name]==='function'?CTX[name]:null; }
  function lc(s){ return (s==null?'':String(s)).trim().toLowerCase(); }
  function normDob(d){ return (d==null?'':String(d)).trim(); }
`;
function harness(patients) {
  const ctx = { String, CTX: { getPatients: () => patients } };
  vm.createContext(ctx);
  vm.runInContext(support + helpers + '\nthis.freshPatient = freshPatient;', ctx);
  return ctx;
}

const store = [
  { id: 'a1', name: 'Ellis R Huff', dob: '03/14/1961', athenaId: '7712345' },
  { id: 'a2', name: 'Greg Adams', dob: '05/02/1955' },
  { id: 'a3', name: 'Greg Adams', dob: '01/01/1990' },
  { id: 'a4', name: 'Anne Spinner Mars', dob: '09/09/1949', athenaId: '7719999' }
];

{
  const h = harness(store);
  // exact id still wins
  assert.strictEqual(h.freshPatient({ id: 'a1', name: 'x' }).id, 'a1');
  // folded name variant + matching DOB -> found (THE bug case)
  assert.strictEqual(h.freshPatient({ id: 'zz-new', name: 'Ellis Huff', dob: '03/14/1961' }).id, 'a1');
  // banner-abbreviated variant ("Huff E") + DOB -> found
  assert.strictEqual(h.freshPatient({ id: 'zz', name: 'Huff E', dob: '03/14/1961' }).id, 'a1');
  // exact MRN alone -> found even without DOB
  assert.strictEqual(h.freshPatient({ id: 'zz', name: 'A Mars', athenaId: '7719999' }).id, 'a4');
  // name variant with a DIFFERENT DOB -> refused (never guess across DOBs)
  assert.strictEqual(h.freshPatient({ id: 'zz', name: 'Ellis Huff', dob: '01/01/2000' }), null);
  // name-only (no DOB, no MRN) variant -> refused (never name-only fuzzy)
  assert.strictEqual(h.freshPatient({ id: 'zz', name: 'Ellis Huff' }), null);
  // exact-name fallback still honors DOB disambiguation between same-name records
  assert.strictEqual(h.freshPatient({ id: 'zz', name: 'Greg Adams', dob: '01/01/1990' }).id, 'a3');
  // different clinician never matches
  assert.strictEqual(h.freshPatient({ id: 'zz', name: 'Michael Schaeffer', dob: '03/14/1961' }), null);
}

// ---- aggregated warning card (no stacked wall) ------------------------------
const warnSrc = src.slice(src.indexOf('var _svUnconfirmed = []'), src.indexOf('function scheduleUpsertVerify'));
{
  const banners = [];
  const ctx = {
    String, Date,
    banner: (kind, title, lines) => { const card = { kind, title, lines, removed: false, remove() { this.removed = true; } }; banners.push(card); return card; }
  };
  vm.createContext(ctx);
  vm.runInContext(warnSrc + '\nthis.warn = warnSaveNotConfirmed;', ctx);
  ctx.warn('Ellis Huff');
  ctx.warn('Greg Adams');
  ctx.warn('Anne Spinner Mars');
  ctx.warn('Greg Adams'); // duplicate name folds, no new entry
  const live = banners.filter(b => !b.removed);
  assert.strictEqual(live.length, 1, 'repeated warnings must collapse into ONE live card');
  assert(/3 saves not confirmed/.test(live[0].title), 'the single card must carry the aggregate count');
  assert(/Ellis Huff, Greg Adams, Anne Spinner Mars/.test(live[0].lines.join('\n')), 'the card must name the affected items');
  assert(/retry/i.test(live[0].lines.join('\n')), 'the card must offer the safe retry guidance');
}

console.log('PASS save-verify fold tolerance: folded saves are found (DOB/MRN-anchored, never fuzzy), and warnings aggregate into one self-replacing card');
