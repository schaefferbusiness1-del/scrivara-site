# P2 correction: compare Easy Home status after browser canonicalization

## Measured problem

Proposal 009 removed the dead roster scan, but its accepted write guard compares
the raw `homeStatus()` string directly with `element.innerHTML` in the active
Easy 3.7.3 poll, now at `mls-connect.js:20857` after proposal 012.

`esc()` emits apostrophes as `&#39;`. After assignment, browser DOM parsing can
serialize that text back with a literal apostrophe rather than the original
entity. A provider label containing an apostrophe therefore leaves
`st.innerHTML !== hs` true on every stable 700 ms tick, preserving the subtree
rebuild class the proposal is meant to remove. Ampersands and quotes have the
same general source-versus-canonical risk.

An exact generated-node probe canonicalized apostrophe, ampersand, and quote
entities on assignment. The accepted guard wrote on both the initial and
unchanged second call. It would therefore still reach approximately 5,143
writes per hour for that stable status.

## Proposed change

- Add a scope-local `setHomeStatusHtml(st, hs)` to the uniquely bounded active
  Easy owner.
- Cache both the raw generated source and the browser-canonical `innerHTML`
  recorded immediately after a real assignment.
- Skip only when the raw source is unchanged and the current canonical markup
  still equals the recorded canonical markup.
- Repaint when the provider/guard source changes or another owner mutates the
  subtree.

The runtime contract uses generated punctuation and proves one initial write,
zero stable-second writes, one content-change write, and one self-heal after an
external replacement.

The script targets the source and test after proposals 002-012 were applied.
All replacements are exact, single-occurrence, and fail on ambiguity inside the
unique active owner. `mls-connect.js` is read and written as `latin1`; the test
remains UTF-8. No satellite bytes or immutable loader token change.

## Expected effect

Stable provider/guard status produces zero recurring DOM writes regardless of
browser entity serialization. Real status changes and external replacement
still repaint once.

## Risks and release checks

- The expando cache is node-local; a rebuilt status element intentionally gets
  one initializing write and then stabilizes.
- Verify provider names with apostrophe, ampersand, and quote; guard-count
  changes; return to Home; active-patient changes; external status mutation;
  and a rebuilt Home node.
- Run:
  - `node tests/interaction-performance-contract.test.js`
  - Easy/Visit ownership and date contracts
  - the full release gate and a 60-second browser mutation counter.

No tracked source, Git state, browser, extension, live-site state, or patient
data was changed by Codex.
