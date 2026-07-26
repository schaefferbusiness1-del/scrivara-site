'use strict';

/*
 * "ALL PROVIDERS" HAS NEVER MEANT ALL PROVIDERS (prs-1.0.0)
 *
 * MEASURED on the owner's signed-in tab, 2026-07-26, b688 / ext 3.0.21:
 *
 *     mlsProviderRosterReceiptV2 = { complete: true, expectedCount: 1,
 *                                    observedCount: 1, providerMode: "all",
 *                                    targetDate: "2026-07-28" }
 *     mlsProviderRosterV2        = [ "Matthew Schaeffer, MD" ]      <- ONE
 *     the app's own calendar      = 18 providers, with appointment counts
 *
 * Both producers of that receipt in background.js compute `complete` from the
 * athenaOne Day grid that happened to be PAINTED:
 *
 *     _provCompleteS = observed > 0 && reachedEnd && restored && boundsStable
 *                      && !capReached && !budgetExpired
 *                      && (!declaredCount || observed >= declaredCount)
 *
 * Every clause of that is true of the SWEEP. Not one of them is about the
 * PRACTICE. The owner's Day view paints a single provider column, so a sweep
 * that correctly reads every painted column reads one provider — and then
 * declares the roster complete. Downstream believed it: an "all providers" day
 * pull was silently bounded to whatever athenaOne chose to paint, and the
 * month pull's "Choose a provider" starved on a one-entry dropdown.
 *
 * The earlier design note in this repo — "provider-roster-incomplete →
 * selected-provider/month pull before any full-day sweep; an ALL-provider day
 * pull needs no roster and BUILDS it" — assumed the grid paints everyone. It
 * does not. That assumption is superseded, and this suite is where the
 * replacement is pinned.
 *
 * THE FIX IS A DISCLOSURE, NOT A GATE, and the constraint is the same one
 * sfp-1.0.0 accepted: `complete` is NOT redefined, because a signal that can
 * fail a pull which works today is a regression traded for a disclosure. What
 * changes is that the receipt now carries its SCOPE, a separate `scopeComplete`
 * (which requires athenaOne's own provider list to have been enumerated — and
 * nothing enumerates it yet, so it is honestly false) is what any "we covered
 * everyone" claim must be built on, and the roster LEARNS from providers
 * observed on appointments MLS has already pulled so the other clinicians stop
 * being unreachable.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rosterSrc = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

function browserContext(opts) {
  opts = opts || {};
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const document = {
    readyState: 'complete',
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null
  };
  const window = {
    _calProviders: opts.calProviders || [],
    _calAppts: opts.calAppts || [],
    uns: n => `acct:${n}`,
    addEventListener: () => {}, removeEventListener: () => {},
    document, localStorage
  };
  window.window = window;
  const ctx = vm.createContext({
    window, document, localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    console
  });
  vm.runInContext(rosterSrc, ctx, { filename: 'feat_athena_provider_roster.js' });
  return ctx;
}

/* the EXACT receipt shape background.js produced on the owner's one-column grid */
const paintedGridComplete = (n) => ({
  complete: true, partial: false, reason: 'complete',
  expectedCount: n, observedCount: n,
  reachedEnd: true, capReached: false, budgetExpired: false,
  restored: true, boundsStable: true, steps: 1
});

/* ================================================================= *
 * 1. The owner's exact state: one painted column, eighteen real
 *    clinicians. The receipt must stop implying the first is the
 *    second — WITHOUT breaking the completeness the pull depends on.
 * ================================================================= */
{
  /* Realistic names on purpose: canonicalProviderName rejects any provider
     string containing a digit (a correct rule — "Provider 2" is a placeholder,
     not a clinician), so synthetic Provider0/Provider1 fixtures silently
     measure nothing. That cost a debugging pass here. */
  const SURNAMES = ['Benner', 'Carter', 'Hoynak', 'Lopez', 'Nguyen', 'Patel', 'Quinn', 'Rivera',
                    'Stone', 'Turner', 'Vance', 'Walsh', 'Young', 'Zeller', 'Abbott', 'Brooks', 'Chen'];
  const eighteen = SURNAMES.map((sn, i) => ({ id: 'p' + i, name: 'John ' + sn + ', MD' }));
  const ctx = browserContext({ calProviders: eighteen });
  const api = ctx.window.__mlsProviderRoster;

  api.ingestResp({
    requestId: 'r1',
    providerRoster: [{ stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD' }],
    providerRosterReceipt: paintedGridComplete(1)
  });

  const receipt = api.getReceipt();

  assert.strictEqual(receipt.complete, true,
    'the sweep receipt must KEEP its completeness. Redefining it would fail every selected-provider and month pull that works today — the same trade sfp-1.0.0 refused to make');

  assert.strictEqual(receipt.scope, 'painted-day-grid',
    'the receipt must NAME what it swept. `complete` alone is a true statement about a scroll and a false one about a practice, and nothing in the old shape let a consumer tell those apart');
  assert.strictEqual(receipt.athenaListEnumerated, false,
    'nothing in this codebase reads athenaOne\'s OWN provider list, so this must be honestly false rather than absent — an absent field reads as "unknown" and gets rounded up');
  assert.strictEqual(receipt.scopeComplete, false,
    'and scopeComplete — the flag a "we covered everyone" claim must be built on — must be FALSE while the practice list is unverified, even though the grid sweep is complete');

  const scope = api.getScope();
  assert.strictEqual(scope.gridSweptCount, 1, 'one column was painted');
  assert.strictEqual(scope.scopeComplete, false,
    'and the SCOPE object must agree with the receipt. Both are read by different callers, and a scopeComplete that drops the athenaListEnumerated requirement is the original defect restored under a new field name');
  assert.strictEqual(scope.athenaListEnumerated, false,
    'nothing enumerates athenaOne\'s provider control yet; the day this becomes true, the disclosure must be re-derived rather than left warning about a solved problem');
  assert(scope.knownCount >= 18,
    'and the roster must know the other clinicians the app already has. Before this they were absent from the canonical roster entirely, which is why every one of them failed `provider-unverified`');
  assert(/18/.test(scope.statement) && /1/.test(scope.statement),
    'the statement must carry BOTH numbers — the gap between them is the entire finding');
  assert(/painted only/.test(scope.statement) || /Day view painted/.test(scope.statement),
    'and must say the limit came from what athenaOne painted, not from MLS');
  assert(/not the practice|cannot say this is everyone/.test(scope.statement),
    'and it must END on the limitation. An earlier version of this arm banned the phrase "all providers" outright and failed on correct text: the statement uses it in scare quotes precisely to correct it ("an “all providers” pull covers the 1 painted column, not the practice"). Ban the CLAIM, not the vocabulary');
  assert.strictEqual(receipt.rosterScope.knownCount, scope.knownCount,
    'the scope must travel WITH the receipt: a consumer that reads only getReceipt() must not be able to miss it');
}

/* ================================================================= *
 * 2. The roster LEARNS from providers observed on appointments MLS
 *    has already pulled — so every known clinician is reachable.
 * ================================================================= */
{
  const ctx = browserContext({
    calProviders: [],
    calAppts: [
      { patient: 'SHOULD NEVER BE READ', provider: 'Kelly Carter, PA-C' },
      { patient: 'ALSO NEVER', provider: 'John Benner, MD' },
      { patient: 'x', provider: 'John Benner, MD' }
    ]
  });
  const api = ctx.window.__mlsProviderRoster;
  api.ingestResp({
    requestId: 'r2',
    providerRoster: [{ stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD' }],
    providerRosterReceipt: paintedGridComplete(1)
  });

  const names = api.list().map(e => e.name);
  assert(names.some(n => /Carter/.test(n)),
    'a clinician whose patients are already in the app\'s calendar must be in the canonical roster. This is real evidence of a real provider and it was being discarded, so selecting them failed provider-unverified');
  assert(names.some(n => /Benner/.test(n)), 'and so must the second one');

  const carter = api.resolve('Kelly Carter, PA-C');
  assert(carter && carter.stableKey,
    'and each must RESOLVE — reachability is the point; a name in a list that the gate cannot resolve is still an unreachable provider');
  assert.strictEqual(api.list().filter(e => /Benner/.test(e.name)).length, 1,
    'a provider seen on two appointments is one provider');

  const sources = api.getScope().sources;
  assert(Object.keys(sources).some(s => /observed-appointments/.test(s)),
    'and their PROVENANCE must be recorded: a provider inferred from an appointment is weaker evidence than one athenaOne named in its own roster, and the receipt must be able to say which is which');

  /* PHI: only the provider field may be read off an appointment row. */
  const stored = ctx.localStorage.getItem('acct:mlsProviderRosterV2') || '';
  assert(!/SHOULD NEVER BE READ|ALSO NEVER/.test(stored),
    'no patient name may reach the provider cache');
}

/* ================================================================= *
 * 3. Discovery must never be able to REVOKE. This is the arm that
 *    protects the pulls that work today.
 * ================================================================= */
{
  const ctx = browserContext({
    calProviders: [],
    calAppts: [
      { provider: 'Provider undefined' },
      { provider: '' },
      { provider: 'Aetna PPO' },
      { provider: 'West Chester' },
      { provider: '3:15 pm' }
    ]
  });
  const api = ctx.window.__mlsProviderRoster;
  api.ingestResp({
    requestId: 'r3',
    providerRoster: [{ stableKey: 'athena:matthew schaeffer, md', raw: 'Matthew Schaeffer, MD' }],
    providerRosterReceipt: paintedGridComplete(1)
  });

  /* list() forces the sync that a stray seed would pollute; receiptSnapshot()
     copies lastReceipt BEFORE it syncs, so reading the receipt alone can miss a
     downgrade by exactly one call. Measure the instrument. */
  api.list();
  assert.strictEqual(api.getReceipt().complete, true,
    'junk provider strings on appointment rows must NOT sanitize the cache. mergeEntries flags `_cacheSanitized` when an incoming semantic row is rejected, and a sanitized cache DOWNGRADES a complete receipt — so an unfiltered seed would have silently broken every selected-provider pull. Candidates are filtered through makeEntry BEFORE the merge for exactly this reason');
  assert.strictEqual(api.list().length, 1,
    'and none of that junk may render as a clinician');
}

/* ================================================================= *
 * 4. The disclosure reaches the doctor, and only where it is true.
 * ================================================================= */

assert(/function providerScopeNotice\(providerMode\)/.test(si),
  'the schedule importer must have a provider-scope notice; a receipt nobody renders is the 3.0.19 inert-guard defect wearing new clothes');
const notice = si.slice(si.indexOf('function providerScopeNotice(providerMode) {'), si.indexOf('function providerScopeReceipt('));
assert(/if \(providerMode !== "all"\) return "";/.test(notice),
  'a SELECTED-provider pull is honestly scoped to that provider and must say nothing extra');
assert(/if \(!sc\) return "";/.test(notice),
  'an absent roster module must produce SILENCE, never a coverage claim: silence plus a clean receipt is how "unknown" gets upgraded to "all", which is the original defect in a new place');
assert(/if \(sc\.scopeComplete === true\) return "";/.test(notice),
  'and once athenaOne\'s own list really is enumerated, the warning must stop');
assert(/pull again/.test(notice) && /Choose a provider/.test(notice),
  'the notice must name a real next step — this repo has a documented defect class of failure messages pointing nowhere');

/* it must be attached to the sentences the doctor actually acts on */
assert(/Verified complete: schedule[\s\S]{0,140}providerScopeNotice\(selectedProvider\.mode\)/.test(si),
  '"Verified complete" is the terminal verdict; a coverage caveat missing from it is missing where it matters');
assert(/Schedule-only complete:[\s\S]{0,160}providerScopeNotice\(selectedProvider\.mode\)/.test(si),
  'and from the schedule-only verdict, which is the path the owner runs by default');
assert(/has no appointments\." \+ freshnessNotice\(r\) \+ providerScopeNotice\(selectedProvider\.mode\)/.test(si),
  'an EMPTY day is the worst case: "nobody is coming" read off a one-provider grid is a positive clinical claim about seventeen other clinicians');

/* and it must be EVIDENCE, not a gate — `complete` must not learn about it. */
const completeStmt = si.slice(si.indexOf('            var complete = !!(r.receipt.complete'), si.indexOf('\n', si.indexOf('            var complete = !!(r.receipt.complete')));
assert(completeStmt.length > 0 && completeStmt.length < 400, 'the day-pull completeness statement could not be bounded');
assert(!/providerScope|scopeComplete|coversPractice/.test(completeStmt),
  'the provider-scope verdict must NOT feed `complete`. A one-provider day is still a COMPLETE read of that provider, and failing it would break the pull to buy a disclosure');
assert(/providerScope: providerScopeReceipt\(selectedProvider\.mode\)/.test(si),
  'but it must be RECORDED on the calendar receipt, so the lead can read the coverage of a finished pull rather than infer it');

/* ================================================================= *
 * 5. The extension-side origin of the claim is still what this says
 *    it is. If background.js ever starts enumerating athenaOne's own
 *    provider control, this arm is the reminder to revisit the whole
 *    disclosure rather than leave it warning about a solved problem.
 * ================================================================= */
assert(/_provCompleteS=_provObservedS>0&&_hMetaS\.reachedEnd/.test(bg),
  'the structured sweep must still derive provider completeness from the PAINTED grid bounds — this suite\'s entire premise. If this changes, re-derive the disclosure before trusting it');
assert(/_legacyRosterCompleteL=_legacyHeaderProofL&&_legacyAllBoundL&&out\.providers\.length>0/.test(bg),
  'and so must the legacy day-grid producer: two producers, one claim, both scoped to what was painted');

console.log('all-providers-means-all-providers: OK');
