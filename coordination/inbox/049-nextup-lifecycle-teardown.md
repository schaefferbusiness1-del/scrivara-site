# 049 - Make Next Up teardown release all recurring work

Date: 2026-07-29

## Measured problem

The accepted 031-046 train still leaves one independently owned long-session
leak in `feat_nextup_connect.js:162-177`.

The module starts:

- one permanent 1,500 ms interval;
- two delayed boot callbacks; and
- one `mls-authoritative-schedule` listener.

Its `revert()` restores `_renderTodayPatients`, but clears none of those
callbacks and removes no listener. The next saved interval callback calls
`installRendererGuard()` and immediately wraps the renderer again, so teardown
does not hold.

A source-executing Node VM probe on the exact b793 plus 031-046 train used 20
fully synthetic schedule rows and invoked the real 1,500 ms callback 2,400
times, representing one hour. It measured:

- 2,400 callbacks;
- 4,800 array sorts;
- 2,405 session-date reads;
- 2,402 authoritative-status reads;
- 2,402 authoritative-row reads;
- 288,440 schedule/hero row-field reads;
- one unchanged-signature render; and
- 42.538 ms of Node CPU time.

After the real `revert()`, the probe measured the interval still active and the
schedule listener still registered. Invoking the saved interval callback
rewrapped the restored renderer. Each retired generation therefore retains
2,400 callbacks per hour and can reactivate itself.

Repository pin inspection found:

- the only immutable loader at
  `feat_mls_schedimport_exact.js:4377`, using
  `feat_nextup_connect.js?v=20260714auth1`;
- the outer `feat_mls_schedimport_exact.js` production and staging loaders at
  `mls-connect.js:42126` and `mls-connect.staging.js:4561`, both using
  `?v=` plus the shared `window.__MLS_AV` release token; and
- one behavior test,
  `tests/schedule-authoritative-reconciliation-runtime.test.js`; and
- no existing exact test pin for `20260714auth1`.

`tests/provider-day-pull-contract.test.js:37-38` pins that shared outer-loader
form in both production and staging. Therefore changing the nested loader line
requires a new fixed token for `feat_nextup_connect.js`, while the containing
schedule importer remains covered by the release-wide `window.__MLS_AV`
advance and does not need a second fixed asset token.

## Change

Change only the Next Up owner, its nested loader token, and two focused tests.

- Keep the existing 1,500 ms steady-state callback and all schedule behavior.
- Store the interval and both delayed boot handles.
- Replace the anonymous schedule listener with a named owner.
- On `revert()`, mark the owner inactive, remove a pending DOM-ready listener,
  clear the interval and delayed callbacks, remove the exact schedule listener,
  then restore the renderer.
- Make callbacks already queued before teardown inert.
- Permit the same reviewed owner to install again only after its prior API has
  been marked uninstalled; repeated live installation remains idempotent.
- Advance the changed satellite URL to
  `feat_nextup_connect.js?v=20260729auth2`.
- Add a VM contract proving install -> revert -> stale callback -> reinstall ->
  revert leaves 1 -> 0 -> 1 -> 0 live intervals and listeners, never rewraps
  after teardown, and preserves the 1,500 ms cadence.
- Pin the new immutable token and reject the retired token.

The script resolves the repository from its own `coordination/inbox` location,
so it is independent of the caller working directory. All four outputs are
computed in memory before any file is written. Every replacement requires
exactly one source occurrence and fails explicitly if an anchor is missing or
ambiguous.

## Expected effect

Ordinary installed behavior is byte-for-byte equivalent at the scheduling
boundary: one 1,500 ms interval, two delayed boot checks, and one schedule
listener.

Each revert or hot replacement now removes one otherwise permanent generation:
2,400 callbacks, 4,800 sorts, and roughly 288,000 row-field reads per hour in
the measured 20-row case. Renderer restoration remains durable instead of
being undone on the next stale tick.

## Risks

- Low lifecycle risk: the patch does not change row selection, identity,
  rendering, event names, cadence, or visible UI.
- A caller retaining an old API after `revert()` can still invoke its exported
  direct methods. Timer, delayed, and event-owned paths are inactive; changing
  the public method surface is intentionally out of scope.
- `feat_mls_schedimport_exact.js` changes by one immutable loader token only.
  Its own loader already uses the release-wide `window.__MLS_AV` token.

## Validation

Validated in a fresh disposable copy of the exact b793 plus accepted 031-046
train, with superseded 039 omitted. The proposal was copied into that
disposable tree and invoked from an unrelated working directory.

- Proposal script syntax: pass.
- First application: pass.
- Patched source and test syntax: pass.
- `schedule-authoritative-reconciliation-runtime.test.js`: pass.
- `immutable-satellite-loader-cache-contract.test.js`: pass.
- Full local gate: all 425 suites pass.
- Second application: exits 1 at the missing first anchor.
- All four patched target hashes remain unchanged after the refused second
  application.

Exact source -> patched SHA-256:

- `feat_nextup_connect.js`:
  `8443DC36BB6D4D58F15F98CB862B791BD88FD7C728B5377CE1BF6296E184FB70`
  ->
  `FD92C3B7FBA4C33C4D92A1A904A5F9FFEC10C6C8B8C5328784498E417D585558`
- `feat_mls_schedimport_exact.js`:
  `52F789F068056BC10C39A8B8F3FDCF809267FCF54BF7E057F5A0867228ACF310`
  ->
  `07687EC21355CE7E44F85E5F551A8E6460367BED581BA6929C0DE3A4D6AD950C`
- `tests/schedule-authoritative-reconciliation-runtime.test.js`:
  `5E1BC38A3031AD9B457CE430A819235906AF3E03220953B3C07BAD5486A82085`
  ->
  `415B09753A5E5FE3C58105D6940EDD20D17BB6B93AD68E88A26265016A8FA91C`
- `tests/immutable-satellite-loader-cache-contract.test.js`:
  `044721EFF50F5DFDA46BBAE4F7511713E061E6F6BA053E6D9E0A497D593B4DEF`
  ->
  `44188BA12B98321B13AFBA18A739E21F5F5CBA9A10DEDF72984640F2AEFE1E8B`

## Reviewer checks

1. Apply after proposals 031-046, excluding superseded 039.
2. Run:
   - `node tests/schedule-authoritative-reconciliation-runtime.test.js`
   - `node tests/immutable-satellite-loader-cache-contract.test.js`
   - the full local gate.
3. Apply the proposal script a second time; it must exit nonzero before any
   write and leave all four target hashes unchanged.
4. In the ten-cycle warm Chrome audit, record the Next Up owner as one active
   interval/listener while installed and zero after an explicit synthetic
   revert. No real patient data is required.
