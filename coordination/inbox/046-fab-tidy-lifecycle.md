# 046 - Retire Fab Tidy lifecycle owners

Date: 2026-07-29

This proposal is self-contained against exact release baseline `b792`
(`b5cdff00371ceb0af07ba2a88b02b06292b7322b`).

## Measured problem

The inline `__mlsFabTidy` module installs two recurring owners but its revert
removes only the stylesheet:

- `mls-connect.js:43449` starts `fhT` every 1,500 ms.
- `mls-connect.js:43474-43476` installs an anonymous document capture-click
  listener.
- `mls-connect.js:43477` removes neither owner before deleting the module
  global, so a reinstall creates another timer and listener.

An exact-source desktop VM produced these bounded measurements with synthetic
DOM nodes only:

- one hour: 2,400 timer callbacks and 16,800 `getElementById` calls;
- the 2,400 callbacks consumed 1.945 ms of Node CPU;
- boot: one live timer and one live click listener;
- after `api.revert()`: still one timer and one listener;
- after reinstall: two timers and two listeners.

The individual callback is cheap. The measured problem is lifecycle
accumulation on same-document reinstallation, which makes the warm-session
cost grow instead of remain constant.

Literal-pin review found that
`tests/voice-pill-persistence-runtime.test.js:71-82` pins the installed
`ft-1.1.4` behavior and the exact desktop pill-healing literals. No test pins
the anonymous listener or leaked interval. The broader
`voice-cluster-expands-never-decides` test pins the retired voice-cluster UI,
not these lifecycle owners.

## Proposed change

- Give the existing document capture-click callback the stable name
  `onFabTidyClick`.
- In `api.revert()`, clear the exact `fhT` interval and remove that exact named
  capture listener before removing the stylesheet and global.
- Keep the version, 1,500 ms cadence, capture phase, 90 ms augmentation delay,
  force-hide logic, menu rows, styling, and every installed UI literal
  unchanged.
- Extend the existing voice-pill runtime contract with the real extracted Fab
  Tidy IIFE. The VM asserts one timer/listener at boot, the unchanged desktop
  lookup behavior and click delay, zero owners after revert, one owner after
  reinstall, and zero again after the second revert.

No satellite bytes change, so no immutable satellite token moves. The inline
core `mls-connect.js` bytes do change, so release assembly must advance the
normal core site asset token.

The patch reads and writes byte-sensitive `mls-connect.js` with `latin1` and
the test with UTF-8. It validates both complete file plans and every
single-occurrence anchor before either write.

## Expected effect

Fab Tidy remains exactly one 1,500 ms force-hide owner and one delegated click
owner across any install/revert/reinstall sequence. A reverted instance
performs no later polling and receives no later click events.

The visible installed behavior is unchanged.

## Risks

- Cleanup depends on preserving the exact timer handle and function identity;
  the new runtime test exercises both identities rather than checking only
  source text.
- Revert no longer leaves force-hide enforcement running. That is the required
  reversible-module contract; reinstall immediately restores the same
  enforcement.
- The version remains `ft-1.1.4` because installed behavior and public API are
  unchanged, this is an inline core module, and the existing exact version pin
  remains valid.
- This proposal does not alter the per-pass lookup work or redesign the FAB.

## Verification

Disposable exact-b792 gate:

1. `node --check coordination/inbox/046-fab-tidy-lifecycle.js`
2. Apply once to a fresh exact-b792 archive.
3. `node --check mls-connect.js`
4. `node tests/voice-pill-persistence-runtime.test.js`
5. `node tests/voice-cluster-expands-never-decides.test.js`
6. `node tests/interaction-performance-contract.test.js`
7. Reapply and require nonzero exit with unchanged target hashes.

The standalone exact-b792 disposable gate completed on 2026-07-29:

- patched source syntax passed;
- the real-IIFE voice-pill lifecycle contract passed;
- voice-cluster, interaction-performance, performance-lifecycle,
  scoped-lifecycle-watcher, and inline-script syntax contracts passed;
- patched `mls-connect.js` SHA-256:
  `F5D7B6673395D8C3407812DA88519CCB251679A1A8065485EDA4B6AFAACEE323`;
- patched `tests/voice-pill-persistence-runtime.test.js` SHA-256:
  `6EC32105EE1097B71B1E51EA0B47E00AC1E039AFA05CB8C06722EC820AFE24CB`;
- a second application exited nonzero at the first missing source anchor and
  left both target hashes unchanged.

After release-owner deployment, verify in real Chrome with synthetic state:

1. Confirm desktop and phone FAB menus, retired pill visibility, and menu-row
   clicks behave exactly as before.
2. Inspect one installed Fab Tidy owner, call `revert()`, and confirm its
   interval and capture listener no longer fire.
3. Reinstall once and confirm exactly one interval and one click response.
