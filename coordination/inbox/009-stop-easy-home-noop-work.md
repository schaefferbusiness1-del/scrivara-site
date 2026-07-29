# P2: stop dead scans and unchanged HTML writes on Easy Home

## Measured problem

The active Easy 3.7.3 owner runs a visible-Visit poll every 700 ms
(`mls-connect.js:20748-20800`).

On every stable Home tick:

- `homeStatus()` at `mls-connect.js:18832-18838` calls
  `dayRows(visitDay())`, then runs `rows.filter(isSeen)`, but neither `rows`
  nor `seen` contributes to the returned status.
- `dayRows` filters, deduplicates, and sorts the day's appointments
  (`mls-connect.js:17610-17636`).
- `isSeen` can call the active `_seenToday`, which scans patient/note stores.
- The poll unconditionally replaces `#ez3HomeStatus.innerHTML` at
  `mls-connect.js:20777`, even when provider and guard text are unchanged.

An exact-source VM probe called `homeStatus()` 1,000 times with 19 generated
rows and observed 1,000 `dayRows` calls plus 19,000 `isSeen` calls. At the
700 ms cadence, the dead locals alone represent approximately 5,143 roster
passes and 97,700 seen checks per hour. The unconditional write can replace the
same small subtree about 5,143 times per hour and notify any active mutation
observers.

## Proposed change

- Reduce the active `homeStatus()` locals to the two values it actually
  renders: provider and guard status.
- Route its HTML through a tiny writer that caches both the raw generated
  source and the browser-canonical `innerHTML`. This avoids false differences
  after entity decoding while still repainting on source changes or external
  subtree mutation.
- Add a contract scoped to the active 3.7.3 owner; historical dormant owners
  remain untouched. The runtime probe uses generated provider punctuation
  (apostrophe, ampersand, and quote) and proves one initial write, no stable
  second write, one content-change write, and external-mutation self-heal.

`mls-connect.js` is read and written as `latin1`; the test remains UTF-8. Both
source edits and the test insertion are explicit single-occurrence
replacements with ambiguity failure. No satellite bytes or cache token change.

## Expected effect

Eliminate the measured dead appointment/seen pass and stable status-subtree
replacements, including provider text whose escaped punctuation is normalized
by the browser, without changing the poll cadence, visible status, or
provider/guard updates.

## Risks and release checks

- The raw/canonical cache must still repaint when provider or identity-guard
  text changes and when another owner replaces the subtree. Exercise provider
  changes, punctuation, blocked-guard count changes, external replacement, and
  return-to-Home.
- Verify the initial Home render and a rebuilt status node both display the
  same text.
- Run `node tests/interaction-performance-contract.test.js`, Easy/Visit
  ownership contracts, the full gate, and a 60-second mutation/write counter
  on a stable synthetic Home screen.

No tracked source, Git state, browser, extension, or live-site state was changed
by Codex.
