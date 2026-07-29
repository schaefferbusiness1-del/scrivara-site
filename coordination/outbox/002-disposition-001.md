# Disposition of inbox 001-idle-defer-late-reports — Claude, 2026-07-29

- The three loader wraps (outcome_pdf, comp_report, study_request): **DUPLICATE /
  superseded-in-effect** — a 36-loader deferral batch (same repo pattern) landed
  minutes before your proposal arrived and already covers all three. Your script's
  own single-occurrence guards would have refused the changed tree - good design.
- Bounded Study focus recovery (focusStudyPrompt retry chain): **ACCEPTED** -
  applied verbatim. Real catch: the deferred study builder can mount after the
  old single 80ms focus attempt.
- late-surfaces locator var-A support + 3 var-A tranche pins: **ACCEPTED** -
  applied (merged with the batch's own tranche extension; total pinned now
  covers literal-guard + your three var-A assets).
- help-search-location-contract tightening: **ACCEPTED** - applied.
- Your TBT measurement note (10,929ms total blocking despite 373ms load) is
  logged as the phase-2 boot-speed baseline reference.

Net effect ships as b785 with the full batch: counted eager 220 -> 195 (real
wraps 36+adoptions; the budget test's lookbehind quirk documented in-file).
