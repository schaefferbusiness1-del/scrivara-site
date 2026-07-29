# QA findings 012: exact b793 proposal-train Chrome matrix

Date: 2026-07-29

Release owner: Claude Opus  
Codex lane: measured optimization proposals and independent QA

## Scope and safety boundary

Codex ran the Chrome drivers against the disposable exact-b793 tree after
applying proposals 031-038 and corrected 040-046 in numeric order. Proposal
039 was excluded.

Source tree:

`C:\Users\Micha\AppData\Local\Temp\mls-b793-proposal-train-1bd784695aa94a0fa6db30b7e359b830`

All runs used the installed Google Chrome
`C:\Program Files\Google\Chrome\Application\chrome.exe`, product version
151.0.7922.48, with fresh isolated profiles and extensions disabled. They used
synthetic localhost demo state only. No production host was contacted, no
backend was enabled, and no real patient data was used.

These results establish Chrome compatibility of the proposed source train.
They do not replace the required production deployment byte proof, hosted
synthetic-account template acceptance, or ten-cycle live warm-session gate.

## Secure phone lifecycle: PASS

The phone lifecycle passed with real MediaRecorder blob upload, trusted-click
pairing, fragment-only handoff, legacy-query refusal, local QR rendering, and
legacy database cleanup.

- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-b793-proposal-train-phone-044-2821790e85ca427e962c889a6cbd55ac\tests\live-phone-artifacts\2026-07-29T20-30-05-233Z\report.json`
- Report SHA-256:
  `6B6F65F52739780F58165BC0A71D8912DF310BEC1167DA754B7C8E9BDC92D625`
- Completion screenshot SHA-256:
  `D4549BB59B36144E4EF62F737578957D6CF3FEB3B7D29A9FDE22772D504580F1`
- `productionContacted=false`

## Ten-cycle synthetic smoke: PRODUCT BLOCKER in cycle 1

The driver completed synthetic signup/login, canonical Easy ownership,
same-origin dependency checks, no-patient behavior, date and account
boundaries, synthetic patient creation and selection, transcript/note save,
hard reload, History persistence/reopen, and visible route traversal. It then
failed before recording cycle 1:

`Setup guidance opened Menu without Staff; last=false`

All Staff prerequisites passed, and the driver clicked the real visible Setup
action. The Menu did not open with a visible/focused Staff row within five
seconds. There were zero browser exceptions, app errors, dialogs, external
requests, and phase failures. This is a product reachability defect, not a
harness failure.

- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-b793-chrome-qa-98fd0056c23349589eb425df0e56c302\qa-artifacts\report.json`
- Report SHA-256:
  `52DBD89E67A2D41D8586CF30AB11A867D0C1AF0BCE63653231404EFF34E5B8A7`
- Failure screenshot SHA-256:
  `82EF16F6034E59B44CBC46100F8A9C97C2E6A4C5DBE7A13A16B846C96FBE208C`
- `productionContacted=false`
- Source integrity: 1,147 of 1,147 copied files remained byte-identical.

The ten-cycle longevity measurement remains blocked until Opus fixes the
Setup-to-Staff route.

## Strict visible-controls audit: one PRODUCT/UI finding

The driver inventoried 41 controls and safely exercised all 17 eligible
controls. It recorded zero control failures, harness failures, exceptions, or
app errors. One deterministic product finding remained:

- `route-dim-or-cover-transition-present`
- diagnosis: `route-entry-animation`
- the Visit route reaches opacity 0 during the 300 ms `mlsViewIn` transition
  while pointer events remain enabled;
- reproduced in 12 of 12 cycles;
- transient observation: true;
- persistent or settled failure: false.

Opus owns this UI fix. The audit must not be weakened to hide the interval.

History was not visible in the Calm shell, so its disposition is
`not-visible-not-audited`; this run does not claim History passed.

- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-b793-chrome-final-d3fc4baa255f4ab09c0a35ca0df1b91c\tests\final-chrome-evidence\visible-controls\report.json`
- Report SHA-256:
  `50A29E9872D4DF1BB0FF484956A7010316C0A375226CAAFD00A1FA78F28740D7`
- Markdown report SHA-256:
  `490638F57EAB6DC944AE45774C8FC268716C74685EAE078B6E9C943F16B8D97C`
- Immediate dim-probe screenshot SHA-256:
  `B04DA049F8EBD4E1B9F94F1EB008CF360428144D6A7C4C3ACA4FDC6A070FB780`
- `productionContacted=false`

## Accessibility and responsive audit: PASS within stated coverage

Desktop, tablet, 360 px mobile, keyboard, inline-notice, cleanup, and 200
percent zoom coverage passed with no product or harness failures, exceptions,
or external requests. History remains outside the pass claim because the Calm
shell does not visibly expose it.

- Report:
  `C:\Users\Micha\AppData\Local\Temp\mls-b793-chrome-final-d3fc4baa255f4ab09c0a35ca0df1b91c\tests\final-chrome-evidence\a11y-responsive\report.json`
- Report SHA-256:
  `EA4F1EE66C5091C116B01772F9EBBDEC2FD7522823D583082394EF1F6CD9B863`
- Markdown report SHA-256:
  `1D640DA1EFD27ADD25ABA680A1793F60EF4B83EBEC8B43E22FD0762E03A89702`
- 360 px screenshot SHA-256:
  `491F821BCBBB70BBFFEEEFFC05A64F89DD058EEC4688892C6AB3242BE7F4357B`
- 200 percent zoom screenshot SHA-256:
  `5507B161C95C718EAD7BF3C14C48944C49ECC5DCE05CF00E0204BF6A83538DED`
- `productionContacted=false`

## Release-owner actions

1. Review and disposition the optimization train documented in
   `QA-findings-011-b793-optimization-and-comment-review.md`.
2. Fix Setup-to-Staff reachability, visible History reachability, the route
   opacity/pointer interaction, and the other Opus-owned defects in the
   release handoff.
3. Run the complete real-Git gate and record exact deployment byte proof.
4. Only then run both independent live Chrome sweeps, the visible hosted
   synthetic template lifecycle, and ten uninterrupted warm cycles.

