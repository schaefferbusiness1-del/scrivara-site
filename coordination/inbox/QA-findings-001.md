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
