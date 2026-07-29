# 043 — Study-owner render event replaces permanent Grab polling

Base reviewed: `b5cdff00371ceb0af07ba2a88b02b06292b7322b` (b792).

## Measured problem

- Production `mls-connect.js:41468` and staging `mls-connect.staging.js:4145` each run `setInterval(inject, 700)` for the page lifetime.
- Each callback performs at least `document.getElementById('mlsStudyBFind')`, including while the Study overlay is closed. That is approximately 5,143 timer callbacks and DOM lookups per hour per tab.
- Five-run synthetic VM probes measured median callback-only Node CPU of 1.492 ms/hour for production and 1.371 ms/hour for staging. This excludes browser timer dispatch, throttling bookkeeping, main-thread wake-ups, and DOM-engine cost.
- The Study owner is defined before Grab in both connectors:
  - production API assignment at `mls-connect.js:41088`, Grab IIFE at `mls-connect.js:41258`;
  - staging API assignment at `mls-connect.staging.js:3771`, Grab IIFE at `mls-connect.staging.js:3935`.
- `open(initTab)` renders synchronously in production (`mls-connect.js:40670`) and staging (`mls-connect.staging.js:3353`).
- Independent review rejected a first public-opener wrapper design because normal UI routes do not call the public property:
  - toolbar handlers close over local `open('A')` (`mls-connect.js:41008`, staging `:3691`);
  - timeline handlers close over local `open('C')` (`mls-connect.js:41021`, staging `:3704`);
  - tab handlers close over local `render()` (`mls-connect.js:40693`, staging `:3376`).
  The only reviewed runtime `window.__mlsStudy.open` caller is a production builder route, and staging has none. Wrapping the public property would therefore miss the real owners.

## Proposed change

- Leave `window.__mlsStudy.open` completely untouched.
- In the Study owner's existing Mode B branch, dispatch `mls:study-mode-b-rendered` only after synchronous `renderModeB(body)` returns. This is the one lifecycle point shared by toolbar, timeline, public API, and tab-switch routes.
- Replace Grab's permanent 700 ms poll with one exact listener for that owner event.
- Keep one install-time `inject()` so a hot-loaded enhancement can upgrade an already-open Mode B overlay.
- Retain `inject()` idempotency: an existing `#mlsGrabAthenaBtn` prevents duplicate controls on repeated signals.
- Add `window.__mlsGrab.revert()` that stops the closure, removes its exact listener, and deletes the duplicate-install guard so a reviewed reinstall can own exactly one listener.
- Expose a descriptive API version, `study-grab-event-1.0.0`, without changing any rendered UI.
- Apply the same source transformation to production and staging connectors.
- The patch reads and writes both byte-sensitive connectors as `latin1`, computes all three outputs before writing, and rejects missing, repeated, or already-applied anchors.

## Expected effect

- Study Grab contributes zero ongoing timers and zero closed-overlay polling DOM lookups.
- Mode B receives the enhancement synchronously after its DOM exists, with no former 0–700 ms delay.
- Normal toolbar and tab routes are covered because the signal belongs to `render()`, not to one public opener alias.
- Repeated render signals remain idempotent, while a genuinely fresh Mode B render receives one fresh control set.

## Contract coverage

The revised test extracts and evaluates the complete real Grab IIFE for both connectors. It checks:

- the owner signal occurs exactly once and after `renderModeB(body)`;
- the real toolbar-local `open()` and tab-local `render()` routes remain present and therefore flow through the shared render owner;
- the full IIFE retains its actual outer duplicate-install guard;
- Study Grab never assigns or wraps `window.__mlsStudy.open`;
- the install-time A/closed-overlay path creates no control;
- executing the exact owner Mode B branch signal against a minimal DOM creates the real button, options row, output area, badge, and style once;
- a repeated signal on the same DOM creates no duplicate;
- a fresh Mode B render is enhanced again without duplicating global style;
- duplicate full-IIFE evaluation adds no listener and performs no install work;
- revert removes the listener, disarms future injection, and clears the guard;
- reinstall owns exactly one listener and upgrades an already-open Mode B overlay;
- no install, render, failure, duplicate, revert, or reinstall path schedules a timer;
- synthetic DOM lookup failures remain silent; and
- Study opener identity is unchanged throughout.

No real patient or live-site data is used.

## Exact-base proposal validation

Validation uses fresh disposable archives from the exact reviewed commit; no tracked workspace file is changed.

- `node --check` passes for the proposal script.
- Independent application changes only production connector, staging connector, and the existing interaction-performance test.
- The revised `interaction-performance-contract.test.js` passes for both complete IIFEs and both owner render branches.
- The existing focused confirmed-billing contract also passes in the patched archive.
- A second application exits nonzero and leaves all three target SHA-256 hashes unchanged.
- Applying 042 then 043 and 043 then 042 in separate exact-base archives produces identical final bytes. The combined target SHA-256 hashes are:
  - `mls-connect.js`: `2CD6D0DB2601B9D48819F0D5BDF54D3C363F4C3EB05A7531AC1BC129BEF68C5C`
  - `mls-connect.staging.js`: `C032543FC358C1A6C7165CE004B5C7B1526D6C6888920AAE3566134C5426A9B8`
  - `tests/interaction-performance-contract.test.js`: `9F3F3AC97736352388CD573D857106FDC032F548CB50FE9B8E0A745B67079738`

## Risks and reviewer gates

- The event contract is intentionally coupled to the current synchronous Study owner. If Mode B becomes asynchronous, the signal must move to the point where its target DOM is actually complete.
- The signal adds one event dispatch per actual Mode B render. That replaces approximately 5,143 timer callbacks per hour with work proportional only to explicit Study use.
- Revert removes runtime ownership but does not delete controls from an overlay that is already open. Closing or rerendering the Study overlay removes those owner-rendered nodes; this avoids a new UI cleanup path in a performance-only proposal.
- A same-page hot upgrade should call the old owned `revert()` before evaluating newer bytes. Normal deployed upgrades occur on full page reload and start with a fresh global realm.
- Claude should run the complete 424-test gate, then use real signed-in Chrome to open Study through the toolbar, timeline, and builder routes; switch A/B/C repeatedly; confirm exactly one Search Athena control per B render; exercise failure/aborted paths; and verify performance instrumentation shows no recurring Study Grab timer.
