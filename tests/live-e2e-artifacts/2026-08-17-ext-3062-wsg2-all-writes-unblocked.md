# 2026-08-17 — MLS Assist 3.0.62 (wsg-2.0.0): every supervised Athena write unblocked, released to /1p

## The directive (owner, verbatim, 2026-08-17)

> "You have 1 job unblock the writes correctly and give me the new extension. EVERYTHING SHOULD be
> able to be wrote it has already been tested u just have it completely unblock it. when done upload
> new extension to settings in 1p. also make all changes for 1p site https://mlsscribe.com/1p"

This is the owner's word that starts the release the 2026-08-12 site-side lane left OWNER-GATED
(`2026-08-12-final-action-unblock-siteside.md`, "Open — owner-gated, item 1").

## What was actually blocking (all four layers were IN THE EXTENSION — no site change could lift them)

| # | Layer (3.0.61) | Where | 3.0.62 |
|---|---|---|---|
| 1 | Click-gate arm list: only `write_note`/`save_draft` could mint a trusted-click arm | `content.js` ATHENA_ACTION_V2_CLICK_GATE | every supervised action arms from ITS OWN exact confirm button; programmatic clicks and label/action mismatches still never arm |
| 2 | Bridge gate: execute for sign/order/billing replied `write-safety-final-action-blocked` | `content.js` MLS_WRITE_SAFETY_BRIDGE_GATE | refusal removed; the action-exact trusted-click arm check still stands |
| 3 | Background policy gate: `gateActionRequest` refused execute via `BLOCKED_EXECUTE_ACTIONS` | `write_safety_guard.js` (wsg-1.1.0) | wsg-2.0.0, `BLOCKED_EXECUTE_ACTIONS = {}`; test-content policy, forbidden matchers, identity helpers unchanged; guard-missing still fails closed |
| 4 | Driver guard: execute refusal + `clickOnce` forbidden-label list (would throw on the exact "Sign and Save" control) | `background.js` MLS_WRITE_SAFETY_DRIVER_GUARD | execute refusal removed; `clickOnce` refuses every forbidden control EXCEPT the exact `Sign and Save` control, and only for `sign_encounter` (`exactSign` carve-out) |

Plus: `mlsPong` now advertises `athenaFinalActionsV1: true` (beside `supervisedOrderPlacementV2`,
`destinationTeachingV2`) — the capability the /1p site has keyed its READY rows on since b1019.

**A real mismatch found and fixed on the way:** 3.0.61's `_mlsActionLabelMatches('stage_billing')`
demanded the phrase "confirm stage billing code(s)", while the 8/12 site lane's confirm button aria
reads "Confirm stage billing in Athena". Even with every gate lifted, every billing send would have
been refused `fresh-trusted-click-required`. 3.0.62 accepts both forms; pinned in
`athena-action-contract`.

## Correctness gates KEPT (these are what "correctly" means)

- exact three-factor identity (name + DOB + MRN) + immutable local id, at the site manifest AND the
  driver (`patient-mismatch`) — a missing MRN still blocks every typed row (pinned:
  `1p-athena-all-actions-ready-3062`);
- exact encounter lock (appointment id, or encounter id + URL) probed read-only, then re-verified at execute;
- one-use background token; fresh trusted click per action; no automatic chaining;
- `sign_encounter` requires a verified prior `write_note` proof for the SAME encounter
  (`sign-prerequisite-mismatch`, probe-time and execute-time);
- `place_order` = the supervised single-order contract: exact catalog item, isolated read-back,
  stale-token / payload / row / client-id / wrong-patient / replay refusals — the ORIGINAL pre-wsg
  runtime contract restored verbatim from `98441b16^` into `athena-order-action-runtime` and PASSING
  against the lifted handler;
- medication / injection orders stay manual on the site: there is no typed adapter (correctness,
  not policy) — the row says exactly that.

## Site (/1p only, owner rule)

- `1p-feat_mls_writeflow.js`: `place_order` joins `ATHENA_EXECUTABLE_ACTIONS`; a complete,
  clinician-accepted, catalog-bound imaging/PT/referral/DME order becomes a typed READY
  `place_order` row when the extension adverts `athenaFinalActionsV1` + `supervisedOrderPlacementV2`;
  `UNIFIED_ARIA.place_order` = "Confirm and place one reviewed order in Athena" (the exact arm phrase
  the extension demands); billing/sign rows already typed since b1019 light up with 3.0.62; the
  fallback (older extension) rows now say "Update MLS Assist (Settings > Get the extension, v3.0.62
  or newer)" instead of the old policy claim.
- `1p/index.html` + `1pScribeFlow.html`: the order chip button reads "Send to Athena" when the
  extension is capable; `reviewAndPlaceOrderInAthena` consequence/toast honest both ways.
- Settings card (both 1p pages): MLS Assist v3.0.62 + release notes.
- **Production `feat_mls_writeflow.js` / `ScribeFlow.html` write contract UNCHANGED** — production
  still offers note write / save only; billing, sign, orders remain manual there until the owner
  promotes. The release train moved only the production pin lines every extension release moves
  (Settings card version strings + notes, checker `SERVER_EXT_VERSION`, checker loader token
  chk3061→chk3062), so `athena-action-contract` still pins production's allowlist to note/save.

## Release pins (scripts/sweep-3062.js — all-or-nothing, counts probed)

manifest 3.0.62, core digest `e5579398b7e98c2d4e026dbc23460d0a0ea6f2177b679f8466e4a1354adfa6a0`,
zip sha256 `b8a12950f9272a1fd1f50a13ac7f123d2d5a3638ecd0b6a1ccbc37380901ec0f` (`.bin` byte-identical),
feed + notes, get-extension href/label/sha, Settings cards ×5 pages, `_config.yml` include + sha,
inventory, `SERVER_EXT_VERSION`, chk token in mls-connect / staging / 1p / cloned loaders, and the
pin suites (extension-package, public-publication-boundary, public-release-truth-boundary,
extension-reload-helper, immutable-satellite-loader-cache, athena-follow-bidirectional,
1p-preview-contract file list + baselines by the two-commit protocol).

## Suites re-pinned BOTH WAYS

athena-action-contract · athena-adversarial-contract · athena-final-action-truth-contract ·
athena-order-action-runtime (original contract restored) · test-content-production-boundary ·
1p-preview-contract (baselines) · NEW `1p-athena-all-actions-ready-3062` (capable = 5 typed READY
rows; old extension = honest manual + cure; missing MRN blocks all).

## Gate / ship / live — filled at closeout

(see the closeout section appended below)

## Honesty line

A byte-verified package and a green gate prove the CODE path. stage_billing, sign_encounter and
place_order have never EXECUTED against a live athenaOne encounter — they were policy-blocked until
this release. The owner said "it has already been tested"; what is proven is the note write
(owner-clicked, "VERIFIED — note written"). The first live sign / billing / order sends should be on
the authorized test patient (Adam J Schaeffer #7833832) with the owner present.
