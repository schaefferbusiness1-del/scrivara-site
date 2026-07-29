# P2 proposal: bound the template-keyword compatibility scrub

Date: 2026-07-29

## Measured problem

`mls-connect.js:34737-34745` installs the `__mlsTplKwFix` compatibility
owner. Its `sanitize()` function walks every `localStorage` key, reads every
key ending in `::templates`, parses each matching JSON library, walks every
template, and may serialize the library again.

The owner currently calls both `sanitize()` and `wrap()` every 3,000 ms
forever. That is 20 full storage walks and 20 parse passes per minute in every
open tab, even after all legacy keywords are normalized.

Reproducible synthetic probe, using no patient data:

- 510 storage keys;
- 10 account-scoped template libraries;
- 100 synthetic templates per library; and
- 20 timer ticks, representing one minute.

Observed on 2026-07-29:

- 10,200 `localStorage.key()` calls;
- 200 `getItem()` calls;
- 200 `JSON.parse()` calls;
- 10 first-pass writes; and
- 15.287 ms of Node CPU time.

The production cold-load measurement in
`coordination/outbox/002-phase1-complete.md` records the complete satellite
train at 16.3 seconds. The compatibility owner already normalizes once at
installation, once at `DOMContentLoaded` when applicable, and every time its
`openTemplates` wrapper is invoked.

## Proposed change

- Preserve the boot and `DOMContentLoaded` normalization.
- Preserve normalization immediately before the real Templates opener.
- During the cold satellite window, retry only `wrap()` every three seconds.
- Retire that retry after ten attempts, at 30 seconds. This leaves 13.7 seconds
  of measured headroom beyond the observed 16.3-second cold satellite train.
- Add a runtime contract proving:
  - legacy keyword strings still become arrays;
  - the original Templates opener still runs;
  - retry ticks perform zero storage reads, parses, or writes; and
  - the retry clears exactly once at its ten-attempt bound.

The patch reads and writes `mls-connect.js` with `latin1`.

## Expected effect

After the first 30 seconds, this owner contributes zero timer callbacks.
During those first 30 seconds, its ten callbacks perform only wrapper
discovery and no storage scan. In steady state this removes 20 full storage
walks and 20 template-library parse passes per minute per tab.

## Risks

- If a future module completely replaces `window.openTemplates` more than 30
  seconds after boot instead of wrapping the existing function, this
  compatibility wrapper would not rediscover it. Current template and op-note
  satellites are idle-scheduled during boot, and the measured cold train
  finishes by 16.3 seconds. Opus should verify a cold throttled load and open
  Templates once after 30 seconds.
- This changes compatibility scheduling only. It does not change the template
  schema, import behavior, visible UI, patient binding, or visit generation.

## Reviewer checks

1. Apply after any of proposals 031 and 032; the anchors remain compatible in
   either order.
2. Advance the core `mls-connect.js` release/site asset token if accepted; no
   immutable satellite bytes change.
3. Run `node tests/interaction-performance-contract.test.js`.
4. Run the full local gate.
5. On a cold throttled page, wait more than 30 seconds, open Templates, import a
   synthetic legacy template with comma-separated keywords, and confirm the
   library opens and the keywords are normalized.
6. Apply the script a second time and confirm it fails without changing either
   target file.
