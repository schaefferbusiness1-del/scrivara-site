# QA findings 001 - b788 visible workflow

## QA-001 - Setup points to an unreachable Staff Prep route

- Severity: High workflow regression
- Release measured: b788 (`3503e800`)
- Environment: isolated loopback Chrome, synthetic account and synthetic
  patient only, no extension loaded
- Frequency: 1/1 deterministic reproduction after the independent date,
  account-boundary, patient-create, save, and reload checks passed
- Combined optimization preflight: reproduced again on 2026-07-29 after
  proposals 019, 020, 022, and 023 were assembled in a fresh disposable
  snapshot. Signup/login, Easy ownership, local libraries, no-patient guard,
  the full date matrix, account isolation, synthetic patient creation, note
  save, hard reload, and History reopen all passed before the identical timeout:
  `Timed out waiting for Setup guidance opened Menu without Staff`.

### Reproduction

1. Sign in to the isolated synthetic workspace.
2. Open Setup and show step 3.
3. Press `Show Staff Prep in Menu`.
4. Observe the visible Calm dock and its Tools menu.

### Expected

The action opens a visible menu, exposes exactly one Staff Prep entry, focuses
that entry, and leaves Easy in doctor mode until the user selects it.

### Actual

The action gives `#mlsTbMenuPanel` the `open` class, but the panel and its Staff
row both measure 0x0. The visible `#mlsDock button[data-dest="tools"]` measures
64x54 and opens a visible 16-item menu, but that menu contains zero Staff
actions. `#nav_staffpull` is hidden, has `display:none`, measures 0x0, and has no
handler. There is no visible path from the Setup instruction to Staff Prep.

### Source evidence

- `feat_mls_redesign.js:114` hides `#mlsTbMenu`.
- `ScribeFlow.html:2782` retires and hides `#nav_staffpull`.
- `feat_mls_calm_shell.js:960` still declares Staff from that retired node.
- `feat_mls_calm_shell.js:1102-1107` rejects hidden sources, so visible Tools
  drops the row.
- `ScribeFlow.html:12351-12363` still opens and focuses the hidden top-bar menu.
- `mls-connect.js:21047-21053` already provides a private
  `mls:menu-staff-prep-request` delegate suitable for a visible owner.

### Console, network, and safety

No network request or extension action is needed to reproduce. The failure is
pure UI reachability. The harness does not activate Staff Prep and does not
touch Athena or patient data.

### Requested owner action

Owner: Claude/Opus. Codex is reporting this UI defect and will not implement
the UI correction.

Make visible Calm Tools own one Staff Prep delegate using the existing private
request flow; update Setup to name, open, and focus that visible Tools row.
Do not resurrect the retired rail control or expose a second Staff route.

## Non-product correction tracked separately

The saved-History failure is test drift, not a product defect. The measured
visible route is `Visit` then `#ez3Hist` (`View completed notes`); that route
passed the full saved-row, detail, edit, and raw-note reopen sequence. Proposal
020 updates only the synthetic driver.

## QA-002 - Phone long-press explanation does not open

- Severity: Medium accessibility and discoverability regression
- Environment: isolated local Chrome, iPhone 390x844 touch emulation, synthetic
  account only
- Frequency: 2/2 strict baseline runs

### Reproduction

1. Open the local synthetic phone workspace.
2. Find a visible control carrying `data-tip`; both runs selected
   `#mlsRdTitle`.
3. Send a short touch and confirm it does not open a tooltip.
4. Hold the same target for 800 ms.

### Expected

The 550 ms long-press path opens `#mlsTip` with a non-empty explanation and
suppresses the click that follows the hold.

### Actual

The short touch correctly leaves the tooltip closed, but after the 800 ms hold
`getComputedStyle(#mlsTip).display` is still `none`.

### Source evidence

- `ScribeFlow.html:30212-30218` removes native `title` tooltips and replaces
  them with `data-tip`.
- `ScribeFlow.html:30262` hides the custom tooltip on pointer down.
- `ScribeFlow.html:30267-30321` owns the replacement touch long-press path.
- `tests/e2e/run-e2e.js:1018-1103` performs the real touch sequence and checks
  both the explanation and destructive-click suppression.

### Requested owner action

Owner: Claude/Opus. Verify this once on an actual touch device. If it
reproduces, repair the long-press event path and retain click suppression. If
the physical device works, update the browser driver to use the event sequence
Chrome now emits without weakening the product contract. Codex will not make
the UI change.

## QA-003 - Standard-line wrapper drops the template visit binding

- Severity: High functional regression
- Environment: isolated local Chrome, synthetic account, in-memory ASCII text
  template, synthetic scheduled patient visit, controlled local AI boundary
- Frequency: 3/3 deterministic reproductions for both automatic and manual
  template application

### Reproduction

1. Import a `.txt` template through the real multi-file parser.
2. Click the visible `Add selected` action.
3. Reload and confirm the same template ID and exact body persisted.
4. Create a synthetic patient and lock an exact scheduled visit through the
   real day chooser.
5. Select the imported template, click `Set default`, and enable Templates.
6. Generate a note, then use the visible `Use on current note` action.

### Expected

Automatic Generate and manual Use both preserve the exact patient/visit
binding, call the template formatter, and return the imported headings, order,
and fixed line.

### Actual

Import, commit, reload, visible selection, Templates enabled state, template
resolution, and the exact visit binding all pass. Both application paths reach
the standard-line wrapper, but the formatting AI boundary is called zero
times. The base note remains unchanged and the app says:

`Open or generate this note inside the correct patient visit before applying a
template. Nothing changed in Athena.`

The visit binding remains exact throughout and no Athena or extension write is
emitted.

### Root cause

- `ScribeFlow.html:16192-16200` passes the frozen visit binding and epoch from
  the manual action.
- `ScribeFlow.html:16600-16640` requires those arguments and refuses safely
  when they are absent.
- `mls-template-stdline.js:205-219` replaces `applyTemplateToNote` with a
  two-argument wrapper and calls the original with only `template, visitText`.
  It drops `expectedBinding, expectedEpoch` for both automatic and manual use.
- `mls-connect.js:41753-41754` loads that satellite.
- `tests/template-standard-line-runtime.test.js:12,47` stubs and invokes only
  the old two-argument shape, so the existing green unit test cannot detect
  the dropped safety arguments.

### Requested owner action

Owner: Claude/Opus. Preserve every original argument through the standard-line
wrapper, pin binding and epoch forwarding in its runtime test, advance the
required asset/release token, and run proposal 024 end to end. Do not bypass or
weaken the visit-binding refusal. Codex is reporting the defect and will not
change the runtime/UI implementation.
