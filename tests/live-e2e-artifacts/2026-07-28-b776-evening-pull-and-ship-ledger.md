# 2026-07-28 evening — live pull verification at b776 + the b769–b778 ship ledger

## Live read-only pull (QA tab, owner signed back into Athena ~10 PM)

- Page: b776, extension pong 3.0.31, `📥 Pull today` clicked with a real mouse click.
- Progress: `Finding patients on 2026-07-28…` → `Reading verified history N of 20` (schedule resolved on the FIRST attempt — no partial-read refusal, no roster refusal, no nav failure).
- **Receipt (the bar): `schedImportIndexV1::2026-07-28` → 20 rows, ALL `state:"done"`, ALL under real `appointment-id:` keys; `schedImportDaysV1` contains the day.** (Instrument note: the index stores rows under `.rows`, not `.entries` — first probe read zero and was proven wrong by key enumeration before being believed.)
- Zero warning banners at any point (`not confirmed` / `didn't work` / `incomplete for N`: none painted).
- After the main run the button returned to idle and the **automatic convergence round** re-read the bodies stragglers unprompted (`Reading verified history 7 of 14…` with the button already idle) — the b763/b766 design working without a human. Bodies re-checks crawl at the known occluded-tab pace (per-patient timeouts advance them); the day receipt was complete before the round began.

## Shipped this evening (each gated 413/414 suites, pushed origin HEAD:main, deploy-verified)

- backend `5106b36` (deployed 8:21 PM): OpenAI cascade retries network failures then advances models — the Draft-all 502 class.
- b769: op-note Draft-all truth chain (real per-row reasons, identity pre-check before AI spend, transient-only retries, Retry-failed(N), 180s abort, named truncation; oni-2.17.0).
- b770: one canonical stop (local+phone+dictation, no second confirm); #mlsTabPickerChip re-hidden (frozen extension unfolds it now that Copilot Voice's anchor node is gone); the two immortal roster scan loops gated on the store version counter; History segment in Review; managed-batch results no longer toast the generic pull warning.
- b771: phone pairing threads the real trusted click (the modal could never start pairing before); post-sign portal ask + Settings switch; verified-history chip is a hover/clickable button.
- b772: blank Copilot dock root fix (studio reorder stole the card 160ms after open — verified live: card stays adopted, 731 chars) + corner overlay; Start-the-visit-for-active-patient CTA.
- b773: bottom Phone-mic/Paste repaired through the continuity popups; duplicate row yields to the lane; one fold toggle for the bottom clusters.
- b774: Deselect survives re-render replacement windows (live-measured 0×0 rect snap; capture-phase delegation by id).
- b775: Draft-all ledger readable (180px → 52vh); Procedures-for picker untangled.
- b776: transient pull refusals (partly-read / roster-incomplete / nav-failed) auto-re-pull twice with settle time before surfacing; gates untouched.
- b777: guided walkthrough fr-2.0.0 — 8 anchored coach-marks, show-time lookup, silent skip, keyboard, mobile sheet.
- b778: Copilot answers "who has X" with actual local patient lists + typed navigation; `_calRowMatchesProv` honors the `pv:`/`nm:` values the provider chips actually arm; #6b7770→#6a7770 (build-token collision).

## Still open

Advanced-section reveal rework (plan chosen: rework what the reveal shows — the row itself is already invisible), screen-size pass, perf loader consolidation, final all-hands bug sweep (especially op notes end-to-end with a real template), practice-login diagnosis (owner-side credentials), Chrome Web Store publish of any future extension change (owner action, extension frozen at 3.0.31 tonight).

## Addendum (late evening, b779 live)

- **b779 note-card fold verified live** with a real note: #noteEmpty / .mlsf-note / .mls-fp-fmt / .mls-as-ind all `display:none 0x0`; the note-actions row (568x93), #visitOrdersCard (568x138), preview (568x38) and visit-tools toggle (568x42) kept their exact measured sizes.
- **b778 Copilot roster answers verified live**: "Who has lumbar spondylosis?" -> 67 of 1526 stored patients with names+fields, honesty line, Open-Patients action; aggregate starter chips still reach the AI; "gout" -> 2 of 1526.
- **End-to-end op-note draft verified live (generate-only, nothing saved)**: chart-verified patient, template auto-matched FROM THE PATIENT'S VISIT HISTORY (match source `history:keyword margin`), backend call through the retry-armored cascade, note 1087 chars, **template fidelity PASS**, procedure + technique sections present, zero unfilled boxes, empty error channel. The whole b769+backend chain works first-attempt on real data.
- Screen-size pass DEFERRED with reason: the shared Chrome window is maximized and ignores programmatic resizes (innerWidth never moved); the walkthrough's mobile sheet was DOM-verified at 375px in its build harness. A human 30-second look at phone width remains worthwhile.
- Convergence note: one bodies re-check round was interrupted by a QA-tab reload (mine); re-pulls re-converge idempotently and the day receipt was already complete.
