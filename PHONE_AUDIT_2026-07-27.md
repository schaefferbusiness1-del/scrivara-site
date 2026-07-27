# Phone audit (b726, Opus scout) — the fix plan of record

Owner: "the phone version is broken and way too crowded." Audit confirmed both,
with mechanisms. Gating: `body.mls-phone` via `__mlsPhoneHome` ph-1.1.0
(mls-connect.js ~44873–45070; 28-line static hide list written at b261, never
revised against the calm shell / redesign / visit-focus layers).

## Outright breakage (fix in this order)

- **B2 — No visible transcript anywhere on phone.** #transcript killed with
  #captureCard (mls-connect ~17701); #ez3flTranscript killed by the phone hide
  ~44935; #ez3Transcript killed TWICE — `ez3fl-top-owns` class set from MOUNT
  not visibility (~6735–6737, hide rule ~6146) + feat_mls_visit_focus.js:234
  whose `:not([hidden])` cannot see display:none. Fix: phone carve-out so
  `.ez3-transcript-card` survives; make the top-owns signal read visibility.
- **B3 — Post-stop dead end.** Every recovery control (#ez3Rec2 resume,
  #ez3CancelRec, #ez3Edit/#ez3Regen/#ez3Copy…) lives in .ez3-row2, folded by
  visit_focus:330 into the "Visit shortcuts" disclosure — which the phone hides
  (both instances: ~44935 + ~44919/6162). The generated note is a readonly
  textarea whose only unlock is hidden #ez3Edit. Fix: re-show one disclosure
  under body.mls-phone.
- **B1 — Dock overflows 375px by 48px.** 8 flex items × min-width:44px
  (ScribeFlow ~1558–1560) + gaps vs 345px content; #mlsAskResults absolute on
  the overflowed wrapper → off-screen. Fix: drop #mlsDockAskWrap ≤760px (Ask
  reachable via Tools) or trim destinations.
- **B5 — Mic failures silent.** showMicWarn (ScribeFlow ~16774) writes #micWarn
  inside permanently-hidden #captureCard; all iOS advice invisible. Fix: phone
  mic warnings route to toast/notice shelf.
- **B4 — Burger opens scrim over nothing.** #mlsRdRailBtn shows ≤900px but the
  calm shell holds #mlsRdNav display:none (calm_shell:202). Fix: hide the
  burger under body.mls-calm/phone.
- **B7 — No-schedule phone has no record button** (#ez3Choose gated on
  rows.length; per-row record not rendered for doctors; #ez3Nxt passes
  record:!t2.cur). Fix: empty-day state gains a record affordance.
- **B6 — QR pairing dead on desktop too** (#mlsGpQrBox appended into hidden
  #visitHero; isTrusted-gated paths silent). Lower priority; separate look.

## Crowding (after breakage)

Hide on phone: #mlsRightNow (duplicated nav ~14px above content). Demote:
#mlsStages (wraps 2 rows, pure status), #mlsDsStrip (collapse day label).
Retire: feat_mls_force_full_phone.js (targets only permanently-hidden ids;
runs a whole-subtree MutationObserver for nothing) + the burger.
Dead rules: `body.mls-phone .ez3-row2` loses specificity to redesign (1035);
[id^="mlsWd"]/.wd-deck redundant; provider-row JS-hide should be CSS
(.ez3-prov exists at ~18645).

## Verification bar

375×812 live: transcript visible + editable; record → stop → edit/copy/resume
all reachable; dock fits with no horizontal overflow; mic-denied shows a
visible message; burger gone; every check re-run at 390×844.

Status: B-fixes not started as of b728. Tasks: #21.
