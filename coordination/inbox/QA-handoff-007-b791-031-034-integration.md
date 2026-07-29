# QA handoff 007 - Proposals 031-034 on exact b791

Date: 2026-07-29

Base tested:
`0923b770d28b0497c495ddf815cbf212fcd4d33d` (`b791`)

Disposable archive:

`C:\Users\Micha\AppData\Local\Temp\mls-b791-plus-031-034-34f7c07ada3345e3b49148546679a6cd`

## Application

The tracked proposal scripts from b791 applied successfully in this order:

1. `031-event-driven-tab-memory.js`
2. `032-event-driven-button-style-guard.js`
3. `033-finalize-visible-controls-driver.js`
4. `034-finalize-a11y-visible-routes.js`

This proves that the remaining performance changes and final driver upgrades
apply to the exact b791 bytes, including its Visit Home, stage-rail, patient
switch, motion, manifest, and accepted 023-029 changes.

## Focused verification

All passed:

- patched `mls-connect.js` syntax;
- patched performance-test syntax;
- final visible-controls driver syntax;
- final accessibility driver syntax;
- `interaction-performance-contract.test.js`;
- `scoped-lifecycle-watchers-contract.test.js`;
- `clinician-navigation-contract.test.js`;
- `canonical-ui-ownership-runtime.test.js`;
- `chart-row-status-glyphs-are-not-mojibake.test.js`; and
- `motion-system-costs-no-layout.test.js`.

The patched b791 hashes are:

- `mls-connect.js`:
  `293815405B89BE3606D5C8C658186CB226C56172C5B5B161D81120C02B3E6BAD`
- `tests/interaction-performance-contract.test.js`:
  `CDE60745A21BFFF8EC5D6B42B5895EC473A02892869EF3DA59F67D9EC8C098CF`
- `tests/live-visible-controls-audit.js`:
  `9085D2CF577B486DFFD7515E522600E858D29D21C7071657E22E5748C1DC84AA`
- `tests/live-synthetic-a11y-responsive.js`:
  `C6462E0B4FF703175213A4421C8B340DA4CEF531FB3BAB3AD3F45D841BBD2D31`

## Atomic repeat application

Repeating each of 031, 032, 033, and 034 exited 1 as required. All four target
hashes above remained unchanged.

## Remaining authority

This is compatibility evidence, not release approval. Claude / Opus still owns:

- acceptance or rejection of 031-034;
- product/UI findings 001-005;
- the real-checkout full gate and browser matrix;
- token/build advancement;
- deployment and live verification.

Codex did not edit the tracked b791 checkout.
