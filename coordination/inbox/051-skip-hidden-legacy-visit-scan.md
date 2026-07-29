# 051 - Skip the hidden legacy visit-history scan

Date: 2026-07-29

## Measured problem

`feat_visits.js:1239-1288` keeps the original visit-history renderer alive on a
permanent 900 ms interval. Every callback:

- reads `#profileCard.offsetParent`;
- resolves the active patient;
- calls `__mlsVisitModel.getVisits()`, which copies and date-sorts the full
  visit array; and
- maps every sorted visit again to build an unchanged-content signature.

The newer `feat_visit_history_ext.js:25-27,640-648` keeps the legacy section in
the DOM but hides it and renders the visible enhanced history separately. Its
own source comment says the base module continues behind it. The legacy
heartbeat therefore performs data-scale and layout work for a section the
clinician cannot see.

A source-executing Node VM probe extracted the real `host()` and `render()`
functions from exact b793 plus proposals 031-046 and 049, with superseded 039
omitted. With the enhanced-owner node present and 100 fully synthetic visits,
4,000 callbacks (one hour at 900 ms) measured:

- 4,000 `getVisits()` calls;
- 400,000 copied visit rows;
- 400,000 signature row reads;
- 400,000 summary-state reads;
- 2,020,000 sort comparisons;
- 4,000 `offsetParent` layout reads; and
- 55.870 ms of Node CPU time.

The proposed guard on the same probe measured:

- 4,000 exact enhanced-owner ID lookups;
- zero visit copies, signature scans, summary reads, sorts, or layout reads; and
- 0.428 ms of Node CPU time.

This is a 99.2% probe-time reduction in the hidden legacy callback. It does not
change the newer visible history owner.

Pin inspection found exactly five uses of the retired immutable token
`20260728vis10`:

- production and staging loaders in `mls-connect.js:41904` and
  `mls-connect.staging.js:4364`; and
- exact pins in `full-visit-reader-runtime.test.js`,
  `visit-index-dupe-collapse.test.js`, and
  `visit-history-provenance-chip.test.js`.

## Change

- At the first line of legacy `render(force)`, return only when:
  - the call is the non-forced 900 ms heartbeat; and
  - the exact enhanced history owner `#mlsVisitHistoryExt` exists.
- Preserve all forced legacy refreshes.
- Preserve the existing heartbeat. If the enhanced owner is removed or
  reverted, the next tick automatically resumes the legacy fallback.
- Advance both production and staging URLs to
  `feat_visits.js?v=20260729vis11`.
- Move all three exact token pins and add the asset to the immutable-cache
  contract with the retired token rejected.
- Add a source-executing contract proving:
  - enhanced owner present: zero visit scans and zero layout reads; and
  - enhanced owner removed: the exact 100-row fallback scan and one visibility
    read resume.

The proposal script resolves the repository from its own inbox location.
`mls-connect.js` and `mls-connect.staging.js` are read and written with
`latin1`. All eight outputs are computed in memory before any write. Every
replacement requires exactly one occurrence and fails explicitly on a missing
or ambiguous anchor.

## Expected effect

For an active patient with the enhanced history installed, remove 4,000
full-array copy/sort/signature passes and 4,000 layout-sensitive
`offsetParent` reads per hour. The interval still exists, but its hidden-owner
path becomes one exact ID lookup.

No row selection, visit identity, persistence, visible copy, styling, controls,
render cadence, or enhanced-history behavior changes.

## Risks

- Low. The guard keys on the exact node owned by the enhanced history, not a
  broad class or route guess.
- A forced `__mlsVisitUI.render(true)` still updates the legacy backup while the
  enhanced section is present.
- If the enhanced owner is reverted, it removes `#mlsVisitHistoryExt`; the
  existing legacy interval then resumes within at most 900 ms.
- The optimization intentionally leaves the enhanced owner's own 3-second
  signature fallback unchanged.

## Validation

Validated in a fresh disposable copy of exact b793 plus proposals 031-046 and
049, with superseded 039 omitted. The copied proposal was invoked from an
unrelated working directory.

- Proposal and all eight patched JavaScript files pass `node --check`.
- First application: pass.
- Focused contracts:
  - `performance-lifecycle-contract.test.js`: pass.
  - `full-visit-reader-runtime.test.js`: pass.
  - `visit-index-dupe-collapse.test.js`: pass.
  - `visit-history-provenance-chip.test.js`: pass.
  - `immutable-satellite-loader-cache-contract.test.js`: pass.
  - `chart-row-status-glyphs-are-not-mojibake.test.js`: pass, including the
    required `latin1` round-trip proof.
- Second application: exits 1 at the missing first anchor.
- All eight target hashes remain unchanged after the refused second
  application.
- The full suite is intentionally deferred to root's later combined reviewer
  gate.

Exact source -> patched SHA-256:

- `feat_visits.js`:
  `B0E955C243E9D10F3E4EDC41FA8C2FD48A4A6F073837979123E9FE03457E2EFF`
  ->
  `F528EF383EE37E40E384B357CF681A7357ACBA67F20D94B07D446F09D2BF7D45`
- `mls-connect.js`:
  `4C2941148AB472CEF71D9F27BA2A533B4604E7D3642C5AAD209B5A7DB0F5F18D`
  ->
  `E51EA1FFA2DA0863888145A1275D63836C7CA48B03999323231B71068A50A126`
- `mls-connect.staging.js`:
  `C032543FC358C1A6C7165CE004B5C7B1526D6C6888920AAE3566134C5426A9B8`
  ->
  `E0B23E94FD9FE2682963AE933BE21E3171EAD9707EAB5065CA22F3C3A95B4B73`
- `tests/performance-lifecycle-contract.test.js`:
  `BA1B5B4F78D8B69F995BDB669F5F53BF2BAE8ED39C3B24709983AC353391729A`
  ->
  `7AAC95B5C2A7B0A6C1B8694501978E81A632C5F2BC26CCE38609E47F190F5F81`
- `tests/full-visit-reader-runtime.test.js`:
  `2D7D1023FD129340D638189796D78222F1C8012A5AA36FA1086250AB6A83ABD5`
  ->
  `139DEBA744C7F2C590B7264A9876CA0B831DCA6861C99FDB14108DDC02181C30`
- `tests/visit-index-dupe-collapse.test.js`:
  `018C0B52B857081589B9004047A3666DA2EE6F2EC0A72981970E99F18C580F49`
  ->
  `E604FDD376557E4A2E5775A4E694CA0329EC4DC468222176B5A32816E490F8C9`
- `tests/visit-history-provenance-chip.test.js`:
  `D48242D31D62CB667B09C25F285D82DDD2DB5F1508BE1BE1FE7B139A8D202896`
  ->
  `8CC08B6930301C6DF71DAC04524FB89F2A4B1C8B3C29E5EC8C917CF1A6A0D508`
- `tests/immutable-satellite-loader-cache-contract.test.js`:
  `44188BA12B98321B13AFBA18A739E21F5F5CBA9A10DEDF72984640F2AEFE1E8B`
  ->
  `17A35C20EE9E90B3797B16816A28F68CEBA81233D17E86B7F9FF50FB3D1AB712`

## Reviewer checks

1. Apply against exact b793 plus proposals 031-046 and 049, with superseded 039
   omitted. Proposal 051 is independent of proposals 047, 048, 050, and 052;
   root will include it in the later combined gate.
2. Run:
   - `node tests/performance-lifecycle-contract.test.js`
   - `node tests/full-visit-reader-runtime.test.js`
   - `node tests/visit-index-dupe-collapse.test.js`
   - `node tests/visit-history-provenance-chip.test.js`
   - `node tests/immutable-satellite-loader-cache-contract.test.js`
3. Apply the script a second time. It must exit nonzero before any write and
   leave all eight target hashes unchanged.
4. Include proposal 051 in root's later combined full-suite gate.
