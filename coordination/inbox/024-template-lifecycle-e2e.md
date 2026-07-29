# 024 - deterministic template lifecycle E2E

## Measured problem

The closest browser test is `tests/e2e/run-e2e.js:491-618`.

- Lines 500-511 type a template into the manual form and search for it. They do not send a real `File` through `tplMultiFile`.
- Lines 515-519 prove only that matcher text selects the saved template.
- Lines 521-583 create a synthetic scheduled visit and generate a note, but Templates remain off. `ScribeFlow.html:16328-16329` makes only the first saved template active and explicitly leaves template use off by default.
- Lines 585-589 save a manually seeded op-note draft. They do not generate it from the imported template.
- `tests/live-visible-controls-audit.js:261,270,272,634` intentionally excludes file import and AI-generated results.
- The real import path is `ScribeFlow.html:16343-16552`; automatic and manual application are `ScribeFlow.html:16600-16640` and `ScribeFlow.html:16192-16200`.

Nine focused storage, workspace, standard-line, and op-note fidelity tests passed before this proposal, but none bridges import, reload, visible selection, a bound synthetic patient visit, both application paths, local save, and another reload in one real browser.

## Change

Patch only `tests/e2e/run-e2e.js`.

Add one isolated local-demo step that:

1. Builds an ASCII synthetic `.txt` `File` in page memory.
2. Sends it through the real `tplMultiFile` parser and clicks the visible `Add selected` action.
3. Verifies metadata parsing, exact saved body and keywords, immutable template ID, and reload persistence.
4. Creates a synthetic patient and scheduled visit, then locks it through the real day chooser.
5. Selects the imported template through the visible workspace, clicks `Set default`, enables Templates, and pins explicit-default mode.
6. Uses a controlled in-page AI stub to exercise automatic `Generate` and the visible `Use on current note` action deterministically.
7. Requires every unique heading in order, the fixed sentinel exactly once, the correct synthetic patient, no known foreign synthetic facts, a stable visit binding, and no Athena or extension write message.
8. Saves locally, reloads, verifies the template and formatted note persisted under the same patient, then removes only this step's synthetic objects and restores prior settings.

The step is appended after the existing phone checks. A real product failure in
this new lane therefore cannot contaminate the earlier patient-lock or phone
fixtures and create misleading secondary failures.

The controlled stub proves UI, import, selection, patient binding, prompt plumbing, output application, and persistence. It does **not** prove hosted-model quality; that remains a separate post-deploy test in a dedicated synthetic AI-enabled account.

No runtime, UI, backend, manifest, extension, or live-site file changes.

## Expected effect

- Converts the currently disconnected template tests into one reproducible lifecycle gate.
- Detects a dead upload parser, invisible or inert `Add selected`, lost metadata/body/ID after reload, wrong default/toggle state, skipped automatic application, broken manual application, reordered or duplicated headings, fixed-line loss, cross-patient binding, local persistence loss, or an accidental external write.
- Adds no production runtime cost. The E2E cost is two reloads, one synthetic visit lock, and two immediate controlled AI calls, estimated at 4-8 seconds on the existing local Chrome run.

## Risks

- The test intentionally couples to the visible Templates controls and Easy day chooser. A deliberate workflow rename or route change must update the test with the product.
- An in-memory `File` exercises the browser `File` object, parser, preview, and commit path but not the operating-system file picker itself.
- The deterministic AI stub cannot grade a hosted model. Passing this proposal must never be reported as hosted AI template-quality acceptance.
- The test uses local demo storage only and cleans up its synthetic patient, appointment, template, and note. A failure before cleanup could leave temporary data only inside Puppeteer's disposable Chrome profile.

## Validation

In a disposable combined-optimization snapshot:

- the patch and patched E2E file both passed `node --check`;
- the patch applied once;
- a second application exited nonzero before writing and left the target
  SHA-256 unchanged; and
- strict Chrome execution used `MLS_E2E_REQUIRED=1`, so a missing browser or
  Puppeteer dependency could not be reported as a pass.

The new step reached real import preview and commit, reload persistence, the
visible template row, visible default action, enabled Templates state, an exact
synthetic scheduled-visit binding, and both application calls. It then exposed
product defect QA-003: `mls-template-stdline.js:205-219` forwards only
`template, visitText`, dropping the required `expectedBinding, expectedEpoch`
arguments. Both automatic and manual application therefore refuse safely with
`Open or generate this note inside the correct patient visit before applying a
template. Nothing changed in Athena.`

The base note still generated and the binding remained exact; zero Athena or
extension writes occurred. This test is expected to remain red until
Claude/Opus fixes QA-003. Codex did not change the affected runtime or UI code.

With the new step placed last, strict execution reported 31 steps and exactly
2 failures: the independently reproduced baseline phone long-press defect
QA-002 and this template defect QA-003. The prior patient-lock/isolation step
passed, confirming the new fixture no longer contaminates later state.
