'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

/* These two deterministic visual proofs are automated release gates even
   though their historical filenames predate the .test.js convention. Keep
   the denominator explicit so live/manual proof scripts remain excluded. */
const AUTOMATED_PROOF_FILES = new Set([
  '1p-avatar-photo-framing-proof.js',
  '1p-avatar-professional-likeness-proof.js',
  /* avlook-1.0.0 (2026-08-17): the drawn face's proportions as eleven measured
     ratios against adult anthropometry, cross-checked against the module's own
     report so the instrument cannot agree with itself. */
  '1p-avatar-adult-proportions-proof.js'
]);

const tests = [
  'public-publication-boundary.test.js',
  '1p-preview-contract.test.js',
  /* The /cloned lane: a byte-faithful production clone that /1p features are
     promoted into one at a time. Runs beside the 1p contract because both
     answer the same question — did this lane drift from the surface it
     claims to mirror. */
  'cloned-lane-contract.test.js',
  /* The /1p Calendar repair of 2026-08-16: one pull entry point instead of
     four, the hero carrying the same caller contract the Visit strip has,
     and a per-appointment op-note action that fails closed rather than
     opening the room for whoever happened to be the active patient. */
  'p1-calendar-single-pull-entrypoint.test.js',
  'p1-calendar-hero-pull-contract.test.js',
  'p1-calendar-peek-opnote-action.test.js',
  /* The owner's standing UI complaints as machine-checkable properties: one
     lit next step per screen (and none outside guided mode), the three modes
     reachable without opening Settings, no horizontal overflow 320->2560, at
     most one Pull per screen, no developer language, no control stranded
     outside the viewport, the drafted day always on screen, and date-key
     regexes that actually contain backslashes. Drives the real shell in real
     Chrome with a synthetic 28-patient day. */
  '1p-ui-shape-contract.test.js',
  /* A black camera feed and a dim room are different faults with different
     remedies; two luminance thresholds decided which the doctor was told
     about, and only this keeps them equal. */
  'p1-avatar-dead-feed-threshold.test.js',
  /* avcam-1.0.0 (owner report 2026-08-17): the camera preview was BLACK and
     the matcher then reported "3 of 14" and "Skin — the sample was not a
     colour real skin has". The matcher was right; nothing above it had ever
     established that a frame existed. A <video> reports videoWidth from
     readyState 1 while drawImage paints nothing until readyState 2, so the
     analysis canvas stayed transparent black. Measured on the pre-fix source
     through this file's own harness: 8 matcher calls in one second, every one
     on a luminance-0 canvas, with the shutter enabled over it. This drives the
     real camera-open handler, the real live view and the real verdict through
     a virtual clock and a fake device. */
  'avatar-camera-feed-readiness.test.js',
  /* p1-lease-loan-1.0.0 (owner report 2026-08-16): schedule pull 6/6, mapped
     6/6, then all six today-note reads refused "pull-in-flight" because the
     frozen feat_visits.js calls _assistReadChart with no token at all. The
     pull now loans its own token; a no-token caller may join a LIVE loan but
     never claims or releases on it, and the publisher withdraws only its own
     loan. Runs the real sliced source from both shells plus the schedule
     pull's own publish/withdraw logic, and proves three of the six
     properties fail against deliberately broken scratch copies. */
  'p1-athena-lease-loan-runtime.test.js',
  /* p1-todaynote-deferred-retry-1.0.0: the other half of the same report. The
     loan removed the CAUSE of "pull-in-flight"; the retry fuse only knew
     timeout-class reasons, so all six refusals were attempt-once and terminal.
     pull-in-flight is now a deferred class with exactly one re-run after the
     pull releases the lease, bounded and setTimeout-only. */
  '1p-todaynote-deferred-retry-runtime.test.js',
  '1p-capture-before-ai-runtime.test.js',
  '1p-day-note-day-and-future-runtime.test.js',
  '1p-daynote-column-and-not-yet-runtime.test.js',
  /* pullspeed2 (owner 2026-08-17, "any way we can make it faster? this looks
     so clunky"): the day-note pass gets ONE total budget, the per-row ceiling
     may only be raised by a SUCCESS, a note already read this account day is
     never re-opened, and the background backfill asks mlsAthenaPresence before
     it repeats the false "open your signed-in athenaOne". Causal control
     against origin/main, and a before/after table. */
  '1p-daynote-pass-budget-and-backfill-runtime.test.js',
  '1p-empty-day-regex-and-authority-repair.test.js',
  /* dsdiag-1.1.0 (readiness §11): the copyable pull report carried no pull id,
     no user, no practice/plan and no storage receipt, so two doctors' reports
     were indistinguishable and a pull that lost its rows to a full store read
     exactly like a pull that read nothing. Executes the real report builder
     and asserts the four receipts are present AND carry no patient identifier,
     no storage namespace key and no per-tab id. */
  '1p-diag-report-receipts.test.js',
  /* apptclock-1.0.0 (readiness §23/§27): the Visit hero said "4:00 AM" and the
     day-chip rail said "8:00 AM" for the SAME appointment, because three files
     disagreed about what an offset-less ISO means. Runs the shipped resolver,
     the shipped hero path and the shared module's own installer in three
     laptop timezones, with a positive control that reproduces the old 4:00 AM. */
  '1p-appointment-clock-one-convention.test.js',
  /* advint-1.0.0: the Settings dialog carried "Developer mode" twice, a
     "Developer API key" card heading, an "Advanced: Developer API key" fold and
     "Paste a JSON export below - shape: {...}" in the open, one click from the
     doctor. Gathered behind ONE closed disclosure in physician language. Pins
     BOTH halves: the vocabulary is behind the fold, AND the four #extDl* ids
     the shipped refresher reads, the "<!-- Developer API key + MLS Assist"
     between() boundary comment, and every control/handler are untouched. */
  '1p-advanced-integrations-disclosure.test.js',
  /* sharedws-1.0.0 (readiness P0 #9): the 30-day token was written to
     localStorage and boot auto-entered from that seed, so Doctor A closing the
     exam-room tab put Doctor B inside A's charts. Runs the real token helpers
     and the real inactivity machinery on a FAKE CLOCK and proves both modes —
     private unchanged (seed written, 30 min, purging sign-out) and shared
     (session-only token, seed entry re-authenticates, 15 min, and a LOCK that
     keeps the unsaved visit and purges nothing). */
  '1p-shared-workstation-runtime.test.js',
  '1p-pull-stop-and-find-census-runtime.test.js',
  '1p-pull-resume-skip-and-cost-runtime.test.js',
  '1p-pull-honesty-and-daynote-budget-runtime.test.js',
  '1p-copilot-studio-safety-runtime.test.js',
  '1p-athena-occurrence-search-runtime.test.js',
  '1p-study-session-modal-runtime.test.js',
  '1p-study-provenance-runtime.test.js',
  '1p-provider-roster-session-loader-runtime.test.js',
  /* p1-roster-settle-preflight-1.0.0 (owner report 2026-08-16): the day-pull
     pre-flight sampled the roster receipt in the same turn its schedule read
     returned, so a roster that completed 300 ms later was published as
     rosterComplete:false and carried into providerReceipt.rosterVerified. */
  '1p-roster-settle-preflight-runtime.test.js',
  '1p-contamination-cleaner-fail-closed-runtime.test.js',
  '1p-preview-freshness-runtime.test.js',
  '1p-legal-ime-workspace-runtime.test.js',
  '1p-legal-loader-runtime.test.js',
  /* legal-tools-1.0.0: the Legal / IME workspace had exactly one route (the
     #ptLawyerBtn door inside Patients). The dock's Tools menu is built by the
     SHARED calm shell from a hardcoded spec list that cannot declare this row,
     so the /1p shells overlay it into the rendered menu. */
  '1p-legal-tools-row-runtime.test.js',
  '1p-marketing-identity-runtime.test.js',
  '1p-marketing-loader-runtime.test.js',
  '1p-marketing-workspace-runtime.test.js',
  '1p-ondemand-templates.test.js',
  '1p-autobind-encounter.test.js',
  '1p-athena-write-unlock-frozen-contract-runtime.test.js',
  '1p-athena-write-unlock-adversarial-runtime.test.js',
  /* wfdx-1.0.0 / opvs-1.0.0 / athena-probe-only-1.0.0 (owner 2026-08-17: "get
     this working and not grayed out ... verify that the op notes to Athena
     works too"). Drives the real 1p review against a fake MLS Assist: bound ->
     READY, unbound -> honest gray, PHI-free probe receipts and copyable error
     report, the read-only goto/open/re-check ladder, PROBE ONLY end to end
     with ONE enforcement point, and the op note -> review hand-off. */
  '1p-athena-write-readiness-and-probe-only.test.js',
  /* MLS Assist 3.0.62 / wsg-2.0.0 (owner directive 2026-08-12): with the
     capable extension every supervised action - note, billing, save, sign,
     one exact reviewed order - renders READY on /1p; an older extension gets
     honest manual rows that name the cure; a missing MRN still blocks all. */
  '1p-athena-all-actions-ready-3062.test.js',
  '1p-avatar-loader-runtime.test.js',
  '1p-calm-dock-owner-runtime.test.js',
  '1p-avatar-face-loader-runtime.test.js',
  '1p-avatar-face-studio-runtime.test.js',
  '1p-avatar-face-likeness-runtime.test.js',
  '1p-avatar-face-lifecycle-runtime.test.js',
  '1p-avatar-photo-truth-runtime.test.js',
  '1p-avatar-face-to-photo-runtime.test.js',
  '1p-avatar-camera-endurance-runtime.test.js',
  '1p-avatar-photo-framing-proof.js',
  '1p-avatar-professional-likeness-proof.js',
  /* 2026-08-17, owner §13/§14/§15/§16 — "the avatar must stop looking preschooly",
     the animation must stop being robotic, the intake must actually run, and intake
     plus visit must be ONE encounter record.
       - adult-proportions-proof MEASURES the drawing (eleven ratios against adult
         anthropometry, on the real 302px kiosk circle) and cross-checks every one
         against window.__mlsAvatar.lookProportions, so a report that drifts from the
         renderer fails. It also pins the fact a transform-string harness could not
         see: that a blink actually closes the eye.
       - intake-and-animation EXECUTES the topic vocabulary, the correction detector
         and the viseme mapper on real sentences, and drives kioskIntakeFile against a
         fake transcript to prove the check-in reaches the encounter exactly ONCE. */
  '1p-avatar-adult-proportions-proof.js',
  '1p-avatar-intake-and-animation-runtime.test.js',
  '1p-one-template-upload-and-month-range.test.js',
  '1p-template-mode-adapter-runtime.test.js',
  '1p-rangejobs-runtime.test.js',
  '1p-rangejobs-harness-runtime.test.js',
  '1p-mobile-encounter-runtime.test.js',
  '1p-coding-review-confirmation-runtime.test.js',
  '1p-avatar-face-async-ownership-runtime.test.js',
  '1p-avatar-speech-connection-runtime.test.js',
  '1p-avatar-mic-not-fragments.test.js',
  '1p-avatar-listener-reliability-runtime.test.js',
  '1p-avatar-transcript-sink-runtime.test.js',
  '1p-avatar-note-readiness-runtime.test.js',
  '1p-avatar-session-boundary-runtime.test.js',
  '1p-transcript-note-athena-handoff-contract.test.js',
  '1p-fullhistory-pdf-idle-runtime.test.js',
  'p1-appointment-census-display-authority.test.js',
  '1p-pull-storage-runtime.test.js',
  '1p-quota-notification-runtime.test.js',
  /* uns() tested the session OBJECT, not the email, so an unresolved email
     minted the literal 'sf_u::undefined::' namespace and one account's notes
     surfaced in another. Pins the mint contract, the write refusal while the
     email is unresolved, and the read-only stranded-key tracer. */
  '1p-uns-namespace-guard-runtime.test.js',
  /* one visit belongs to one patient: generating for A and switching to B left
     A's EMR block, ICD/CPT chips, patient handout and lastEMR in place, so
     noteRecordFromState() stamped B's id onto A's chart data. Carries its own
     causal control against origin/main's shell bytes. */
  '1p-visit-owner-isolation-runtime.test.js',
  '1p-provider-unknown-census-runtime.test.js',
  '1p-provider-day-calendar-runtime.test.js',
  /* b1026's pdr-1.0.0 provider Day render fix was never ported to the fork, so
     /1p hid object-provider, rendering_provider_id and doctor_user_id rows the
     production Day view renders. This is the 1p twin of the production suite
     below and names those row shapes so the regression cannot return. */
  '1p-provider-day-render-runtime.test.js',
  /* the /1p regression audit was token-presence only, so it could not see a
     production function that carries no release token. This diffs the FUNCTION
     SET of every production file against its 1p fork and fails when a
     production function with call sites has neither a fork counterpart nor a
     verified supersession record. */
  '1p-fork-parity-contract.test.js',
  '1p-pull-attempt-receipt-runtime.test.js',
  /* nq-1.0.0: upsertNote wrote the device copy through a bare setItem BEFORE
     the encrypted server write, so a full device threw the finished note away
     instead of letting the server accept it. */
  '1p-note-never-lost-to-quota-runtime.test.js',
  /* ptsmig-1.0.0: the sj-2.0 IndexedDB patient store shipped with five green
     suites and ZERO shipped migrate() call sites, so every account stayed on
     the localStorage lane. Pins the shipped activation and a 3,000-patient
     round trip through the real store. */
  '1p-pts-store-activation-runtime.test.js',
  /* psq-1.0.0: the pending patient-sync queue had ONE driver, a 60s interval
     capped at 25 ids, so a 300-patient pull idled a full minute before the
     first id moved (12 minutes against a refusing server) with nothing on
     screen counting a single outstanding patient. */
  '1p-pending-patient-sync-drain-runtime.test.js',
  'production-provider-day-render-runtime.test.js',
  'production-default-view-pull-runtime.test.js',
  'day-switch-current-pull-result-runtime.test.js',
  /* an unmapped Settings heading is INVISIBLE with no error - measured, 1 of 12
     sections was reachable from no tab at all */
  'settings-every-section-reachable.test.js',
  'pages-build-output-audit.test.js',
  'static-site.test.js',
  'hex-colour-integrity.test.js',
  'boot-script-budget.test.js',
  'public-preview-policy.test.js',
  'public-preview-runtime.test.js',
  'preview-route-canonicalize-runtime.test.js',
  'public-preview-integration-contract.test.js',
  'homepage-self-guided-preview.test.js',
  'public-release-truth-boundary.test.js',
  'public-release-preflight.test.js',
  'expert-public-release-boundary.test.js',
  'sensitive-public-workflows-boundary.test.js',
  'optout-failure-recovery.test.js',
  'sensitive-session-boundary.test.js',
  'same-tab-session-ui-isolation-runtime.test.js',
  'same-tab-owner-upgrade-runtime.test.js',
  'calendar-session-account-isolation-runtime.test.js',
  'session-account-date-ownership-runtime.test.js',
  'session-idle-crosstab-contract.test.js',
  'visit-session-clinical-state-runtime.test.js',
  'feature-account-isolation-runtime.test.js',
  /* Large-roster hot path: active-patient field sync and Copilot ownership
     follow exact patient/session/storage events. The old 400/600 ms polls
     scanned the saved-patient store 250 times per minute and could leave a
     just-selected chart inconsistent for 600 ms. */
  'active-patient-event-runtime.test.js',
  'review-finder-security-boundary.test.js',
  'expert-marketplace-review-boundary.test.js',
  'local-clinical-library-boundary.test.js',
  'local-qr-secret-boundary.test.js',
  'athena-write-contract.test.js',
  'write-confirm-requires-change.test.js',
  'one-canonical-stop.test.js',
  'deselect-releases-the-visit.test.js',
  /* Owner 2026-08-05: clicking a name on the left did not open that patient on
     the right. Four modules wrap renderProfile; two of them called each other
     until the stack overflowed and the app's own render never ran. Executes
     both real modules against a stub DOM with deterministic timers. */
  'patient-select-renders-that-patient.test.js',
  /* ...and the same class swept across every SHIPPED module, both load orders.
     b870 fixed one instance; this sweep found two more (the Up-Next hero and
     today's patient list), each broken in exactly one load order. */
  'wrapper-chains-reach-their-base.test.js',
  /* Owner 2026-08-05 'fix sign in screen'. The tabs were divs: no keyboard path
     to Sign up at all, and 3.31:1 contrast. Both already had fixes — in feat_*
     modules the sign-in screen never loads. */
  'sign-in-screen-is-reachable.test.js',
  /* The post-op video lane must be INVISIBLE until its backend deploys: a
     'Talk to your doctor now' button that 404s to someone in pain after surgery
     is worse than shipping nothing. Executes both halves against a stubbed
     fetch. Also pins that neither half prescribes. */
  'telehealth-ships-dark.test.js',
  'schedule-row-links-the-chart.test.js',
  'default-note-format-shows-matching-body.test.js',
  /* The other two Note defaults controls. Measured on b964, the practice
     billing table reached 4 of 8 prompts that TELL the model to emit a code -
     it missed all three op-note drafters and the prior-auth letter, i.e. the
     documents the Settings card itself names. Reach is now a chokepoint, and
     these two pin it: the contract prints coverage with a denominator, the
     runtime one drives real prompts through the real wrapper with controls. */
  'note-defaults-reach-contract.test.js',
  'note-defaults-reach-runtime.test.js',
  /* and the honest boundary: /api/generate takes no system prompt, so MAIN
     visit-note generation on a hosted account carries neither setting and
     cannot until the endpoint accepts them. Pinned so it is never credited. */
  'note-defaults-transport-split.test.js',
  'settings-scheduling-api-contract.test.js',
  'studio-tabs-show-one-panel.test.js',
  'visit-stage-rail-fills.test.js',
  /* b795 — three owner-reported defects, each gated by execution not grep:
     the Templates card could not be scrolled to its Close button; the pull
     panel showed every in-flight patient as a warning; and the op-note room
     had no responsive layout because a runtime skin outranked every
     max-width rule by append order. */
  'templates-panel-scrolls.test.js',
  'pull-rows-say-done-not-warning.test.js',
  'runtime-skin-cannot-outrank-responsive.test.js',
  'checklist-cannot-accuse-on-uncertainty.test.js',
  /* The op-note + Templates rebuild. The grip fence comes FIRST because it is
     what makes the redesign safe: 102 structural dependencies live in those two
     subtrees and they fail silently, so the suite that proves none of them moved
     is more important than the one that proves the pixels changed. */
  'opnote-templates-grips-survive-redesign.test.js',
  /* b813 — the owner asked the matcher to stop giving up and offer the closest
     template. That is a deliberate loosening of a matcher whose whole job is to
     refuse when unsure, so this is its fence: four refusals that must survive
     it, each written because the first version of the fallback broke it. */
  'closest-guess-never-invents-a-procedure.test.js',
  /* b824 — the second half of "why do u have to clikc review and sign twice".
     b819 made the refusal point at the blank; this pins that the visit-card
     driver does not then repaint the pointed-at editor out of existence, in
     all four byte-identical copies of it. */
  'sign-refusal-survives-the-repaint.test.js',
  /* b834 — a fix on the origin that a returning browser never receives is not
     shipped. feat_mls_opnote_integrity.js sat behind a hand-maintained cache
     token dated two days before its own content changed. This compares every
     hand-maintained token against its file's real history. */
  'cache-token-cannot-go-stale.test.js',
  /* 2026-08-06 — the same disease one layer out: a deploy that publishes an
     OLDER tree than the one already live silently reverts whatever landed in
     between, and reports success. Measured that day: 13 deploys, 3 inversions
     (23%), app-version.json going BACKWARDS twice, one inversion reverting
     another lane's shipped fix 51 seconds after it landed. This replays those
     exact pairs against the guard. */
  'forward-deploy-guard.test.js',
  /* b814 — "maybe add liquid glass designs some places your call". The call was
     the two fixed/sticky edge surfaces and nothing else; this pins the recipe,
     the theme derivation, the @supports fallback, and the surfaces that must
     stay solid because they carry clinical severity colour. */
  'glass-is-one-vocabulary.test.js',
  'opnote-template-rail-is-clickable.test.js',
  /* b798 — the owner named the fill-in-the-blank path and the missing animations
     explicitly. The first pins the placeholder mechanism across every new
     template-follow mode; the second is the general law that caught why the
     magic layer animated nothing: it styled five classes and set none. */
  'fill-in-the-blank-survives.test.js',
  /* 2026-07-30 — the owner: "the fill in the balnks should still show up even in
     the all scchaefualed patients view". The sibling above pins the CONTRACT by
     reading source; this one EXECUTES both modes. The defect was an id-keyed
     signature cache surviving the node it described: opPrepRender rebuilds the
     whole list, and drafting a day calls it once per row, so every previous
     row's Fields box was destroyed and never rebuilt. Only the LAST patient kept
     one — and the room opens on the FIRST. */
  'fields-box-shows-in-all-day-view.test.js',
  /* 2026-07-30 — a DEAD GUARD found beside the one above. fillProcInputs mapped
     an op-prep card's Procedure input back to its row by reading the inline
     handler out of `onchange`; the shipped renderer emits it as `oninput`
     (ScribeFlow.html:15858), so the regex never matched and the function had
     never filled a visible Procedure input since onf-1.6.0 — on a 1s tick.
     Assign-a-template-in-bulk then leaves the readiness checklist saying
     "Procedure ✓" over a visibly empty box. Executes the fill, and pins that a
     procedure the doctor typed is never overwritten. */
  'opnote-proc-input-prefill.test.js',
  /* b945 — the owner, on the op-note room: "every button freezes up and then
     only clicks after like 3 seconds", and "maybe could be drafted all at once
     for a day". The store was re-parsed per row on every repaint, and Draft-all
     waited for each round trip because the verdict for a draft lived in window
     globals the next row cleared. This runs the REAL Draft-all runner against a
     deliberately interleaved drafter and proves the ledger still blames the
     right patient — the thing that made overlapping unsafe before. */
  'opnote-drafting-is-not-serialised.test.js',
  'styled-trigger-classes-have-writers.test.js',
  /* The DYNAMIC counterpart: dispatch the real event, assert the class lands on
     the real node. A writer that exists but is unreachable passes the static
     check and fails this one. */
  'magic-moments-actually-fire.test.js',
  /* b799 — the Templates UI proved by execution: no dead buttons, and the six new
     animations emitted, off-switched, and their wrappers actually run. */
  'templates-ui-proved-working.test.js',
  /* ot-2.0.0 — the owner, a fourth time: "make a completely working new UI the
     templates tab only of op notes as I love the other tabs but just hate the
     templates UI". The three previous passes were paint; this one PLACES the
     children so his library stops being the last thing on a twenty-block stack.
     Paint could be proved by reading the stylesheet. A composition cannot, so
     this suite measures the rectangles in a real Chrome. */
  'templates-tab-layout-proved.test.js',
  'opnote-room-walkthrough-runtime.test.js',
  /* 2026-07-30 — the owner: the op-note room "is this full thing screen thats
     hard to get out of ... the bottom menu button should still be there". The
     dock was never hidden; the room's own opaque full-viewport card outranked
     it 9400 to 920 and every dock button hit-tested false. This is the only
     suite in the registry that launches a real browser: elementFromPoint is the
     assertion, and no source read can stand in for it. It says so in its final
     line if no Chrome binary is present. */
  'opnote-room-does-not-trap.test.js',
  'opnote-follow-modes-differ.test.js',
  'ui-clinical-pass.test.js',
  'ui-shell-pass.test.js',
  'schedule-mutating-row-reverify-contract.test.js',
  /* 3.0.40 candidate contracts (sn-1.1 / er-1.2 / csr-1.1 / pp-1.x / wv-1.x) */
  'schedule-chip-name-capture-contract.test.js',
  'schedule-empty-day-settle-contract.test.js',
  'schedule-pull-reconciliation-contract.test.js',
  'extension-orphan-neutralization-contract.test.js',
  'athena-write-verification-contract.test.js',
  /* fg-1.0 (3.0.41): the user-initiated retry may front the athena tab (panes
     never hydrate occluded) and must always restore focus */
  'history-retry-foreground-contract.test.js',
  /* sx-1.1: the bounded session probe rides every read-verb failure response
     (per-read session liveness, requirements ledger 6.2) */
  'per-read-session-liveness-contract.test.js',
  'candidate-3045-diagnostics-contract.test.js',
  'sanitize-regex-linear-time.test.js',
  'schedule-weektab-provider-header-variant.test.js',
  'opnote-room-remake-contract.test.js',
  'athena-action-contract.test.js',
  'athena-confirmation-runtime.test.js',
  'sign-claim-requires-receipt.test.js',
  'refusal-is-not-a-save.test.js',
  'unsaved-switch-leaves-no-trace.test.js',
  'staging-stamp-follows-production.test.js',
  'premium-block-names-a-real-route.test.js',
  'feature-directory-routes-exist.test.js',
  'calendar-deoverlap-skips-hidden-grid.test.js',
  'calendar-hidden-repaint-contract.test.js',
  'calendar-view-activation-runtime.test.js',
  'datalink-hidden-view-render-runtime.test.js',
  'datalink-event-driven-runtime.test.js',
  'allergy-strip-event-driven-runtime.test.js',
  'patients-view-activation-runtime.test.js',
  'autosave-draft-owner.test.js',
  'athena-unified-manifest-contract.test.js',
  'athena-final-action-truth-contract.test.js',
  'orders-unified-review-contract.test.js',
  'orders-human-place-button.test.js',
  'athena-order-action-runtime.test.js',
  'athena-unified-confirmation-contract.test.js',
  'athena-unified-confirmation-runtime.test.js',
  'destination-teaching-runtime.test.js',
  'athena-advanced-unified-entry-contract.test.js',
  'athena-session-preservation-contract.test.js',
  'athena-session-health-runtime.test.js',
  'athena-confirmed-billing-contract.test.js',
  'chartautofill-guard-active-patient-runtime.test.js',
  'commercial-hardening-contract.test.js',
  'visit-draft-lifecycle-runtime.test.js',
  'history-raw-note-wrapper-runtime.test.js',
  'quick-find-lifecycle-runtime.test.js',
  'find-canonical-route-runtime.test.js',
  'athena-adversarial-contract.test.js',
  'primary-workflow-contract.test.js',
  'calm-clinician-surface-contract.test.js',
  'redesign-surface-storage-performance-runtime.test.js',
  'patient-context-storage-performance-runtime.test.js',
  'mobile-transient-notice-runtime.test.js',
  'clinician-navigation-contract.test.js',
  'clinician-discoverability-single-owner.test.js',
  'redesign-hot-upgrade-runtime.test.js',
  'canonical-ui-ownership-runtime.test.js',
  'staging-staff-prep-menu-runtime.test.js',
  'easy-owner-visible-affordances-runtime.test.js',
  'athena-overlay-lifecycle-contract.test.js',
  'boot-loading-visual-contract.test.js',
  'boot-loading-lifecycle-runtime.test.js',
  'gate-loading-always-ends.test.js',
  'deferred-asset-scheduler-contract.test.js',
  'progress-stages-runtime.test.js',
  'interaction-performance-contract.test.js',
  'startup-heavy-work-deferral.test.js',
  'startup-list-pagination-runtime.test.js',
  'immutable-satellite-loader-cache-contract.test.js',
  'deterministic-cache-token-contract.test.js',
  'calm-shell-cache-bust.test.js',
  'body-class-writes-only-on-change.test.js',
  'bump-build-subject-names-its-build.test.js',
  'encounter-index-stability-survives-frame-reload.test.js',
  'visit-orders-write-on-change.test.js',
  'shell-passes-write-only-on-change.test.js',
  'control-accessible-name-runtime.test.js',
  'shell-hidden-controls-keep-reach.test.js',
  'calm-views-folds-keep-reach.test.js',
  'calm-views-performance-runtime.test.js',
  'studio-merge-keeps-every-route.test.js',
  'team-tab-reach-under-tools.test.js',
  'shell-label-authority-contract.test.js',
  'scribeflow-inline-syntax.test.js',
  'startup-hydration-contract.test.js',
  'upnow-past-all-startup.test.js',
  'upnow-wrapper-chain-contract.test.js',
  'hosted-login-usability-runtime.test.js',
  'legal-readiness-safety.test.js',
  'legal-network-workspace-held.test.js',
  'signup-assent-manifest-runtime.test.js',
  'athena-fhir-fallback-frontend.test.js',
  'day-progress-time-runtime.test.js',
  'day-progress-responsive-layout-contract.test.js',
  'cross-day-appointment-context-runtime.test.js',
  'visit-active-controls-contrast-contract.test.js',
  'easy-transcript-continuity.test.js',
  'transcript-mirror-merge-runtime.test.js',
  'no-merge-conflict-markers-in-shipped-assets.test.js',
  'no-speculative-preload-of-js-strings.test.js',
  'build-bump-names-its-build.test.js',
  'tree-contains-everything-published.test.js',
  'review-control-clears-fixed-furniture.test.js',
  'review-panel-is-a-review.test.js',
  'transcript-focus-survives-rebuild.test.js',
  'visit-host-never-moves-under-a-typing-doctor.test.js',
  'easy-lane-engine-rewrite-runtime.test.js',
  'easy-canonical-action-owner-runtime.test.js',
  'easy-pause-resume-runtime.test.js',
  'async-artifact-binding-contract.test.js',
  'async-artifact-source-guard.test.js',
  'note-editor-binding-contract.test.js',
  'dictate-anywhere-binding-contract.test.js',
  'record-backup-lifecycle.test.js',
  'autosave-patient-scope-runtime.test.js',
  'voice-ai-binding-contract.test.js',
  'assistant-readiness-runtime.test.js',
  'assistant-production-runtime.test.js',
  'copilot-request-binding-contract.test.js',
  'widget-builder-v2-runtime.test.js',
  'custom-widget-identity-runtime.test.js',
  'widget-builder-live-preview.test.js',
  /* Owner 2026-08-06: "it should be able to listen while it is talking" and
     "it doesn't really start listening right away it's delayed". The mic now
     opens WITH the question; the risk that creates - the avatar transcribing
     ITSELF into the patient's answer - is what most of this suite guards. */
  'avatar-listens-while-speaking.test.js',
  /* av-5.6.0 the visit copilot: the room capture survives a reload, the
     action detector refuses every negated/past/conditional/interrogative form
     of an order, and nothing consequential is confirmable while a clinically
     required field was never spoken. */
  'avatar-visit-copilot.test.js',
  'studio-creations-durability.test.js',
  'async-owner-guards.test.js',
  'history-duplicate-name-binding.test.js',
  'manual-history-exact-open-mrn-contract.test.js',
  'history-preopened-same-tab-contract.test.js',
  'visit-body-identity-302-contract.test.js',
  'history-absolute-deadline-runtime.test.js',
  'background-final-patient-timeout-runtime.test.js',
  'appointment-id-bootstrap-contract.test.js',
  'day-schedule-absolute-deadline-runtime.test.js',
  'schedule-scrape-deadline-searchopen-runtime.test.js',
  'background-all-visits-cleanup-serialization.test.js',
  'quiet-pull-pending-release-runtime.test.js',
  'chart-capture-excludes-script-text.test.js',
  'chart-request-deadline-runtime.test.js',
  'patient-chart-parse-abort-runtime.test.js',
  'chart-refresh-merge-runtime.test.js',
  'athena-problem-list-is-not-comma-shredded.test.js',
  'organize-history-never-strips-an-unread-slice.test.js',
  'briefing-problem-capture-runtime.test.js',
  'duplicate-render-is-not-ambiguity.test.js',
  'frame-url-binds-appointment.test.js',
  'chart-prompt-speaks-athena-medication-vocabulary.test.js',
  'provider-day-history-cards-runtime.test.js',
  'full-visit-reader-runtime.test.js',
  'visit-reader-minimal-deadline-contract.test.js',
  'visit-request-correlation-runtime.test.js',
  'cohort-request-correlation-runtime.test.js',
  'visit-accordion-body-runtime.test.js',
  'history-organization-runtime.test.js',
  'history-organization-responsive-runtime.test.js',
  'history-organization-adversarial.test.js',
  'patient-isolation-strong-key-binding.test.js',
  'visit-summary-quality-contract.test.js',
  'same-day-shell-upgrade-contract.test.js',
  'history-ingestion-card-hardening.test.js',
  'save-verify-managed-batch-toast.test.js',
  'save-verify-fold-tolerant-contract.test.js',
  'patient-row-loss-guard.test.js',
  'save-truth-contract.test.js',
  'pull-resume-contract.test.js',
  'phone-chip-trusted-gesture.test.js',
  'intake-attach-single-flight.test.js',
  'multi-tab-hint-contract.test.js',
  'athena-pull-toast-lifecycle.test.js',
  'athena-read-indicator.test.js',
  /* Owner 2026-08-06: "some times it puts in the wrong medication". Reproduced
     verbatim on a real patient - three drugs and an 80 mg dose invented to
     satisfy a prompt line telling the model to prefer routine values over
     blanks. 3 of 96 templates can reach it; the guard is proven on all 3. */
  'opnote-drug-blanks-never-invented.test.js',
  /* Owner 2026-08-06: "the date of procidure needs to be put in". Reproduced
     15/15 - the date is handed to the generator and rendered in no format at
     all. Deterministic, and it affects EVERY note, not the 3 at-risk ones. */
  'opnote-carries-its-procedure-date.test.js',
  /* b925 and b927 put both op-note safety guards in ScribeFlow.html's
     _genOpNote - which feat_mls_opnote_integrity.js REPLACES. Two builds of a
     patient-safety fix shipped and did nothing; QA proved it on live b926.
     This suite asserts on the INSTALLED generator, never on a file. */
  'opnote-guards-run-in-the-installed-generator.test.js',
  /* Owner 2026-08-06: "the template auto matching just is not that good".
     QA measured it on the text his SCHEDULE carries, not on well-formed
     strings: 24 of 27 real reasons REFUSED with the right template already
     ranked first. The gate, not the ranker - and a suite of ideal inputs
     could never have seen it. */
  'template-match-real-schedule-text.test.js',
  'athena-pull-notification-ownership.test.js',
  'opnote-exact-patient-binding.test.js',
  'opnote-staging-identity-runtime.test.js',
  'opnote-verified-history-repair-runtime.test.js',
  'opnote-rail-search-caret.test.js',
  'provider-key-credential-surname.test.js',
  'visit-reason-not-correspondence.test.js',
  'draft-all-panel-collapses-without-hiding-failure.test.js',
  'tesi-expands-to-the-region-the-text-supports.test.js',
  'tpl-word-junk.test.js',
  'template-library-runtime.test.js',
  'template-recognition-bounded-concurrency.test.js',
  'staging-history-writeflow-parity.test.js',
  'active-patient-sync-status.test.js',
  'voice-pill-persistence-runtime.test.js',
  'voice-dock-layout-contract.test.js',
  'portal-invite-placement-runtime.test.js',
  'portal-request-reliability-runtime.test.js',
  'strip-day-couple-runtime.test.js',
  'premium-gate-runtime.test.js',
  'pull-device-picker-runtime.test.js',
  'perf-sweep-contract.test.js',
  'patient-scale-perf-contract.test.js',
  'store-generation-perf-runtime.test.js',
  'quicksearch-command-palette-perf-runtime.test.js',
  'route-layout-fastpaths-runtime.test.js',
  'route-patient-read-fastpath-contract.test.js',
  'profile-calm-event-lifecycle-runtime.test.js',
  'widget-deck-event-lifecycle-runtime.test.js',
  'simple-active-id-fastpath-contract.test.js',
  'writeback-preview-patient-fastpath-contract.test.js',
  'patient-row-stability-contract.test.js',
  'task3-time-formatter-cache.test.js',
  'patient-card-contrast-contract.test.js',
  'patient-surface-design-language.test.js',
  'analysis-scope-chip-fits-a-phone.test.js',
  'patient-store-compression-runtime.test.js',
  'patient-store-batch-runtime.test.js',
  'managed-pull-persistence-performance-runtime.test.js',
  'maintenance-persistence-queue-runtime.test.js',
  'chart-structure-idle-scan-runtime.test.js',
  'clean-sections-boot-maintenance-performance-runtime.test.js',
  'visitfix-boot-maintenance-performance-runtime.test.js',
  'patient-save-wrapper-ownership-runtime.test.js',
  'patient-store-sync-rollback-runtime.test.js',
  'visit-shell-merge-alias-survival.test.js',
  'visit-index-dupe-collapse.test.js',
  'visit-pull-toggle-contract.test.js',
  'visit-wire-identity-guard-runtime.test.js',
  'unified-write-surface-contract.test.js',
  'schedule-time-contract.test.js',
  'schedule-pull-integrity.test.js',
  'schedule-packaged-reader-regression.test.js',
  'schedule-dom-text-echo-regression.test.js',
  'extension-schedule-support-diagnostic.test.js',
  'schedule-empty-day-proof-contract.test.js',
  'schedule-history-pipeline.test.js',
  'schedule-identity-adversarial-runtime.test.js',
  'schedule-row-demographics-adversarial.test.js',
  'schedule-visit-persistence-adversarial.test.js',
  'schedule-authoritative-empty-contract.test.js',
  /* ed-1.0.0 (2026-08-17, live production repro): a verified-empty day never
     reaches the AI schedule-text parser; the day-strip's 'grid still settling'
     auto-retry can no longer be triggered by an empty day. */
  'schedule-verified-empty-day-skips-ai-parse.test.js',
  'schedule-authoritative-reconciliation-runtime.test.js',
  'schedule-calendar-partial-diagnostics-runtime.test.js',
  'schedule-import-scan-performance-contract.test.js',
  'provider-day-pull-contract.test.js',
  'provider-incomplete-diagnostics-contract.test.js',
  'history-refusal-diagnostics-contract.test.js',
  'writeflow-presence-port-contract.test.js',
  'provider-month-exact-routing.test.js',
  'provider-roster-integrity.test.js',
  'provider-roster-ingest-dedupe-runtime.test.js',
  'provider-roster-machine-echo-collapse.test.js',
  'writeflow-athena-appointment-id-resolution.test.js',
  'patient-wipe-guard-hatch.test.js',
  'visit-draft-patient-identity-runtime.test.js',
  'visit-history-provenance-chip.test.js',
  'upsert-athena-proof-carryforward.test.js',
  'upsert-attested-slice-travels-with-receipt.test.js',
  'mrn-preserve-and-backfill.test.js',
  'pull-visit-bodies-default-on.test.js',
  'pull-first-attempt-convergence.test.js',
  'cross-tab-pull-shield.test.js',
  'fast-lane-saves-todays-note.test.js',
  'writeflow-duplicate-click-guard.test.js',
  'coding-suggestion-separation-contract.test.js',
  'templates-workspace-contract.test.js',
  'settings-workspace-contract.test.js',
  'pricing-billing-truth.test.js',
  'visit-binding-notice-persistence.test.js',
  'writeflow-auto-open-runtime.test.js',
  'provider-roster-provenance.test.js',
  'athena-tab-lease-over-pin.test.js',
  'status-notifier-guard.test.js',
  'schedule-nonpatient-row-guard.test.js',
  'provider-selector-sanitizer-runtime.test.js',
  'provider-identity-no-hardcode-contract.test.js',
  'server-authoritative-admin-contract.test.js',
  'test-content-production-boundary.test.js',
  'schedule-pull-ui-contract.test.js',
  '1p-provider-roster-settle-retry-runtime.test.js',
  'manual-history-retry-ui-runtime.test.js',
  'startup-explicit-pull-contract.test.js',
  'phone-pairing-explicit-click-runtime.test.js',
  'phone-secure-lifecycle.test.js',
  'startup-ai-notice-explicit-action-contract.test.js',
  'visible-control-context-accessibility-contract.test.js',
  'performance-lifecycle-contract.test.js',
  'extension-read-path.test.js',
  'extension-host-scope-contract.test.js',
  'extension-backend-origin-security.test.js',
  'extension-popup-accessibility-contract.test.js',
  'nightly-backup-tab-safety.test.js',
  'athena-import-backup-truth-contract.test.js',
  'extension-package.test.js',
  'extension-manifest-text-integrity.test.js',
  'enumerate-noise-surface-exclusion.test.js',
  'schedule-read-declares-its-freshness.test.js',
  'write-claims-need-a-receipt.test.js',
  'all-providers-means-all-providers.test.js',
  'enumerate-refusal-evidence.test.js',
  'enumerate-evidence-crosses-the-hop.test.js',
  'enumerate-gives-up-when-provably-stuck.test.js',
  'enumerate-all-events-is-not-the-row-count.test.js',
  'encounter-index-names-its-surface.test.js',
  /* svs-1.0.0 - the 2026-08-08 twin-tab clobber (98/153 healed rows overwritten
     by a wedged tab's ~45.6s trailing re-saves). A writer may only replace a
     record it has observed; stale bulk saves are per-row protected. */
  'stale-lineage-save-shield.test.js',
  'surface-recycle-rebind.test.js',
  'ax-native-reader.test.js',
  'fatigue-breaker.test.js',
  'department-scope-primitives.test.js',
  'qol-setting-reaches-the-pull.test.js',
  'qol-batch-scoped-focus-restore.test.js',
  'qol-pulled-day-note-honesty.test.js',
  'qol-follow-sees-cross-tab-pulls.test.js',
  'qol-off-lane-never-crashes.test.js',
  'qol-one-resolver-guard.test.js',
  'qol-resolver-four-sites.test.js',
  'qol-off-path-fails-loudly.test.js',
  'qol-panel-honesty.test.js',
  'qol-focus-comes-home.test.js',
  'qol-ax-identity-gate.test.js',
  'qol-arm-inside-the-mutex.test.js',
  'storage-janitor-allowlist.test.js',
  'quota-guard-edit-survives.test.js',
  'qg-latch-has-no-reader-yet.test.js',
  /* sj-2.0 (2026-08-11, INTEGRATION-ORDER Commit A): the patients-off-
     localStorage primitive - registered WITH the splice commit, never before
     (they fail loudly pre-splice by design). Boot barrier = conflict C4. */
  'sj2-pts-store-contract.test.js',
  'sj2-migration-fail-closed.test.js',
  'sj2-eviction-persist.test.js',
  'sj2-boot-barrier.test.js',
  /* sj-2.0 Commit C (design Q2 machinery): logout + clearDeviceData carry the
     HARD verifiedEmpty gate; the LIVE zero-idb-bytes check is the owner-gated
     BLOCKING criterion at the cutover, not this vm suite. */
  'wipes-contract.test.js',
  /* sj-2.0 Commit D: the four direct blob readers/writers outside the managed
     path (identity-proven against the shipped bytes), and the pre-registered
     merge-receipt criterion - registered WITH the receipt edit, never before
     (RED on unedited bytes at "SHIPPED CODE MERGED SILENTLY" by design). */
  'sj2-rogues-contract.test.js',
  'sj2-merge-receipt-required.test.js',
  'quota-verified-writes.test.js',
  /* Patricia Kirwin 2026-08-08: a never-read record's stored lone NKDA rendered
     as a chart fact; 1,340 of 1,567 records are never-read. The card annotates
     the unverifiable default instead of wearing it. */
  'unverified-default-never-reads-as-fact.test.js',
  'ext-3063-athena-tab-resilience-contract.test.js',
  'extension-reload-helper-contract.test.js',
  'portal-staff-booking-contract.test.js',
  'settings-cleanup-contract.test.js',
  'study-natural-request-report.test.js',
  'study-academic-paper.test.js',
  'comp-report-contract.test.js',
  'prep-summary-debris.test.js',
  'visit-single-transcript-contract.test.js',
  'onboarding-tour-v2-contract.test.js',
  'device-role-contract.test.js',
  'extension-health-contract.test.js',
  'conn-status-truth-contract.test.js',
  'athena-window-guard-contract.test.js',
  'pull-request-correlation-contract.test.js',
  'pull-progress-merge-defer-runtime.test.js',
  'pull-day-label-contract.test.js',
  'provider-identity-separation-contract.test.js',
  'oldbrowser-compat-runtime.test.js',
  'ext-update-hint-contract.test.js',
  'shared-progress-runtime.test.js',
  'opnote-clinical-consistency-runtime.test.js',
  'opnote-generation-jobs-runtime.test.js',
  'assistant-provider-event-lifecycle.test.js',
  'assistant-request-ownership-runtime.test.js',
  'copilot-actions-once-contract.test.js',
  'copilot-context-pack-runtime.test.js',
  /* 2026-08-05 Copilot Power (cpw-1.0.0): the snapshot gains providerCoverage +
     capabilities, the /api/copilot body gains an ABSOLUTE wire cap through the
     loaded wrapper, and the agentic kinds (pullProviders/draftNote) execute
     fail-closed with honest receipts. */
  'copilot-power-context-contract.test.js',
  'copilot-power-actions-runtime.test.js',
  /* 2026-08-05 AVATAR (av-1.0.0, owner-ordered): the doctor side of the
     patient-facing check-in — no polling, fail-closed chart match, idempotent
     stamped import, one idle-deferred loader. */
  'avatar-doctor-runtime.test.js',
  /* 2026-08-09 av-6.0.8: the Visit-page Avatar card must appear AT ONCE. Owner: "this top
     thing show shoup uop right away not take a secod". The loader drains ~100 deferred
     assets one at a time and the avatar is ~52nd, so the card was tens of seconds late;
     the loader now paints it and the module adopts the same node. Executes the shim. */
  'avatar-visit-card-appears-at-once.test.js',
  /* 2026-08-09 av-6.0.9: the avatar must FINISH ITS SENTENCES. Owner: "it doesnt even say
     eve4ryhhting its going to say it hears its self its a MESS FIX IT" — one defect, not
     two: the barge-in rule cut the question off whenever the echo filter missed the
     avatar's own voice (measured 18% overall, 52% on merged words). Barge-in now needs
     positive evidence of another voice; the filing path is deliberately unchanged. */
  'avatar-finishes-its-sentences.test.js',
  /* 2026-08-11 ROUND 10 — ONE TOKEN CANNOT ANSWER TWO QUESTIONS. Nine rounds failed at the same
     defect: `pvSaying` carried BOTH "what are we saying right now" (read to keep a sentence alive)
     and "what do we compare against for echo" (read by BOTH filing gates), so making the microphone
     unable to end a sentence — which requires the liveness value to survive the recogniser teardown
     — was inseparably a FILING change. Round 9 did exactly that and the avatar filed its own
     question as the patient's answer in 9 of 15 ordinary turns. The cure is a SPLIT, not a gate:
     pvEchoSaying is set and cleared at exactly the live build's pvSaying statements (plus pvStopMic,
     which is pvStopVoice's extracted half), both filing gates read it, and only liveness outlives
     the teardown. THE ACCEPTANCE GATE IS A DIFF: 32 derived scenarios are run through the shipped
     bytes of THREE builds — this tree, the pinned live commit, and the pinned round-9 commit — and
     this tree must be byte-identical to live while round 9 must not be. Every control runs in-suite:
     the derived call-graph walk names pvListen/kioskTurn/kioskFinish as mic-reachable stops on live
     and none here; the live watchdog cuts 4 / falls through 46 / re-arms 0 in 50 ticks and this one
     0/0/50. */
  'one-token-cannot-answer-two-questions.test.js',
  /* 2026-08-11 fx-1.0 — A REFUSAL NEVER LEAVES A STALE LOOK SILENTLY RENDERING. Owner (screenshot):
     the sampler refused his retaken photo and the panel kept rendering the stale poisoned saved
     look with a refusal line pale enough to miss. Root causes measured in the face-rework
     diagnosis: res.look carried REFUSED values and the kiosk applied them wholesale (the #333333
     gray-hair day-one path), one border-median background turned a white door into claimed long
     white hair, and a bad look once saved was trusted forever. This suite EXECUTES the real
     extracted sampler on T1/T8/posterized/no-face fixtures on BOTH this tree and the pre-fix
     bytes (in-suite controls must reproduce each defect), and pins the consumer contract
     (claimed-only look + shared applier + counted refusals), the duplicate-surface veto, the
     quarantine/reset/loud-note UI truth, and the vision claim gates. */
  'face-refusal-quarantines-the-stale-look.test.js',
  /* 2026-08-09 av-6.2.0: ONE OWNER for #mlsAvKioskInterim. Owner: "having text constantly
     overlapping and being such a paIUN IN THE ASS" — measured as FOURTEEN writers on one
     text node with no priority, clobbering each other mid-sentence. Executes the ranked
     arbitrator over adversarial orderings; the control fails on the pre-arbitrator file. */
  'avatar-one-owner-for-the-patient-line.test.js',
  /* 2026-08-09 round-three finding: kioskAmbientBlock suppressed the whole header on a RESUMED
     "keep listening" capture to avoid pasting the intake twice — and dropped the recording
     consent attestation with it. intakeFiled is a claim about a PREVIOUS write, not proof the
     line is in THIS transcript. Executes both branches; the control fails without the fix. */
  'consent-rides-with-every-block.test.js',
  /* 2026-08-10: the held-capture slot is keyed by CHART, and kioskAmbientStart writes a backup
     BEFORE the first ROOM word — so a record with no body. Starting a check-in on a chart that
     still held an unfiled consultation destroyed the only copy of it, silently, reporting ok:true.
     The held capture is now moved ASIDE to a chart-prefixed key instead.
     ⛔ THIS SUITE EXISTS IN ITS PRESENT FORM BECAUSE ITS FIRST VERSION WAS GREEN OVER THE LIVE
     DEFECT: it hand-wrote intake:[] while kioskAmbientSaveNow always forwards kiosk.intake, so both
     the guard and the fixture tested a shape production never produces. It now asserts its own
     fixture against the shipped call site's field list, and its controls include the earlier broken
     guard — which it fails. Real http origin: localStorage throws on setContent's opaque origin. */
  'an-empty-record-cannot-erase-a-consultation.test.js',
  /* the floating-card rule: a real browser, because the defect is geometry */
  'a-floating-card-never-covers-a-control.test.js',
  'copilot-dock-fullheight.test.js',
  'ask-bar-copilot-failover-contract.test.js',
  'right-now-bar-never-duplicates-the-hero.test.js',
  'record-not-blocked-by-unproven-binding.test.js',
  'calendar-list-keeps-its-exit.test.js',
  'copilot-panel-calm-contract.test.js',
  'opnote-graded-against-what-model-saw.test.js',
  'home-hero-follows-the-banner-patient.test.js',
  /* b808 — the same law as the line above, on the day shape that law never
     covered. home-hero-follows-the-banner-patient pins the EMPTY day; the owner
     found the working day, where the hero followed the schedule and the banner
     patient had no record offer at all. This one executes renderHome over
     twelve day-shape/selection combinations. */
  'visit-home-always-offers-the-banner-patient.test.js',
  'sweep-fixes-b711-contract.test.js',
  /* b808 — the owner's own sentence, as a suite: "if a provider sets their name
     in settings then they go to do an op note it should fill in automatically."
     Executes the shipped resolution ladder. Also pins the two fabrications it
     found: the account credential being appended to another clinician's name,
     and the assistant line being filled with the primary surgeon. */
  'settings-identity-reaches-the-op-note.test.js',
  /* b808 — the same law on the way OUT of the app. Five PDF letterheads read a
     shared config object that nothing ever populated, so every export was
     stamped with the vendor's name instead of the practice's; and four surfaces
     used the login/account display name as the clinical provider, two of them
     reading docname BEFORE providerName. */
  'exports-carry-the-practice-identity.test.js',
  /* b808 — the same law on the three pages a PATIENT sees. The portal resolved
     the practice from a localStorage key written only on the doctor's device and
     a global assigned nowhere, so every real patient saw "your care team". */
  'patient-pages-name-their-practice.test.js',
  /* The doctor's own custom intake questions existed on every layer except the
     one facing the patient: Settings stored them, PREF_SYNC_KEYS synced them, the
     in-app kiosk rendered them, and the link the doctor SENDS asked nothing.
     Executes all four hops, including the last one - the answers reaching the
     chart - because without it the patient answers into a void. */
  'custom-intake-questions-round-trip.test.js',
  /* b810 — the marketing console is a FORK of mls-marketing.html whose who()
     kept the pre-b385 one-liner, so it could not read the practice identity the
     doctor had already saved. Pins the two resolvers as behaviourally identical
     by executing both, so the fork cannot drift again. */
  'marketing-console-is-not-a-stale-fork.test.js',
  /* b820 — the outcome study asked the doctor to retype names and dates of
     service the app already holds (its own paste placeholder reads "Name, DOS /
     Jane Doe, 03/04/2026"), while the same module already called getPatients()
     to write results BACK. Executes the click handler rather than grepping it:
     a grep for the omission counter cannot tell a live report from a disabled
     one, because the counter also sits inside the branch it guards. */
  'outcome-study-builds-from-the-charts.test.js',
  /* b820 — five feature modules resolved the clinical provider themselves and
     each ended at the LOGIN/account name, so on a staff or shared login a
     letterhead, a fax FROM line, a medical-legal "Prepared by", a full-history
     PDF, an op-note provider blank and an EHR write context all attributed one
     person's work to another over the practice's real credentials. Executes the
     ARTIFACT PRODUCERS (not the helpers feeding them — an earlier form ran the
     helper and survived a revert of the field that calls it) across all four
     identity states, composed with the real resolver lifted from the shell. */
  'clinical-artifacts-never-sign-with-the-account-name.test.js',
  /* b822 — every op-note PDF was named with TODAY's date. dateForFile read
     meta.dop, appMeta() never sets a dop, so it always fell through to new Date()
     and a note written up days after the case was filed as if the case happened
     today — while feat_opnote_history_pdf.js was already computing the note's own
     date and handing it to an exportPdf that read only opts.patient. Evaluates the
     shipped filename EXPRESSION lifted from source (an earlier form re-composed
     the rungs in the test and survived a precedence reversal), and asserts the
     clinical Date of Procedure line in the note BODY is unmoved. */
  'op-note-pdf-is-filed-under-the-right-date.test.js',
  /* b823 — the after-visit summary told the patient to "contact the clinic" while
     its source packet carried NO practice name and NO phone, so the handout named
     neither, though both sat in Settings and the shared PDF letterhead already read
     them. Executes buildSource(): the two facts are labelled non-clinical and kept
     OUTSIDE the verbatim clinical block, a missing one says NOT CONFIGURED in words
     rather than leaving a blank a model would helpfully fill, and the prompt is
     evaluated (not sliced) so an instruction spanning two array elements is read as
     the model receives it. */
  'after-visit-summary-names-the-practice-to-call.test.js',
  /* b824 — a patient's AGE was computed two ways. Seven surfaces adjust for the
     birthday; the Study Groups builder and its satellite subtracted birth year
     from the current year, so everyone born later in the year read ONE YEAR
     OLDER. That resolver also gates cohort INCLUSION, so a 17-year-old reported
     as 18 was enrolled into an "18 and over" cohort and exported. Executed
     against a FIXED clock, with the year-only de-identified fallback pinned
     intact. */
  'one-age-for-one-patient.test.js',
  /* b825 — eight more shell surfaces read getName(), the device-local login name
     that is not even in PREF_SYNC_KEYS: the ELECTRONIC SIGNATURE written into the
     chart, the letterhead of a prior-auth letter sent to a payer (whose own body
     already resolved the provider correctly), the orders sheet pasted into a
     pharmacy portal, and five printed letterheads. Four of those also hardcoded
     the VENDOR's name and specialty onto documents the practice hands out. */
  'twelve-shell-documents-carry-the-practice.test.js',
  /* b832 — the prior-authorisation and appeal letters are addressed to a health
     plan the packet never named. Its own prompt says "leave the plan name bracketed
     if not given" and nothing gave it, while p.insurance holds payer/plan/memberId
     and the Superbill already prints them. A payer cannot process a PA addressed to
     "[Insurance Plan]" with no member ID. Absent facts are declared in WORDS, since
     the member ID is the one field where an invented value reaches an insurer
     looking real. */
  'payer-letters-know-which-payer.test.js',
  /* b832 — printExtra() is the print path for TWELVE generated documents (superbill,
     IME, medical-legal, good faith estimate, referral, AVS, UR, three analyses, the
     widget printouts) and its header carried no DOB and no MRN, so none of them
     could be filed against a chart — while two sibling builders in the same file
     already printed exactly that triple. And the printed patient handout said "Call
     the office" naming neither the office nor a number, ONE FILE AWAY from the
     surface b823 fixed, which a module-scoped test could not protect. Both degrade
     byte-identically when nothing is configured. */
  'printed-documents-can-be-filed-and-answered.test.js',
  /* b832 — three more places the app asked for what it held: the referral letter
     defaulted to the literal word "Specialist" while THIS VISIT's referral order
     carried the consultant; the dictated letter left the recipient blank for the two
     medical types though p.history.pcp holds it (prefilled per type, so an ATTORNEY
     never receives a doctor's name); and four workflow preferences now follow the
     doctor across devices. Also pins the pre-existing production/staging
     PREF_SYNC_KEYS drift so widening it has to be deliberate. */
  'the-app-offers-what-the-visit-already-decided.test.js',
  /* b832 — the Settings logo field promised "your logo appears on the printed/PDF
     letterhead, and the 'Prepared with MLS' line is removed". Browser Print honoured
     both; NOT ONE jsPDF builder did, so a Premium doctor handed out PDFs with no logo
     and a vendor footer. Two properties matter more than the happy path and are
     asserted hardest: a throwing addImage must never cost the doctor their export,
     and white-labelling must drop the BRANDING while keeping the [bracketed]-items
     SAFETY warning. */
  'the-premium-logo-reaches-the-pdf.test.js',
  'opnote-fillbox-sees-every-shape.test.js',
  'opnote-autoname-date-contract.test.js',
  'opnote-room-stage2-contract.test.js',
  'opnote-room-stage3-contract.test.js',
  'opnote-room-keeps-every-injection-point.test.js',
  'athena-follow-bidirectional-contract.test.js',
  'day-navigation-observes-the-header.test.js',
  'day-pull-lane-convergence.test.js',
  'day-note-foldin-contract.test.js',
  /* 420 backend rows carry start_at NULL (timeless-scan 2026-08-11, 0
     absorbable) and every list surface sorted nulls FIRST - Jul-7 opened as a
     screenful of bare dashes with all real times below the fold (DEFECT C).
     Drives the REAL calOpenDay old-vs-new: timed rows first, unknown rows
     LAST with a plain "time not recorded" chip, on today's nulls and the
     repair lane's time_unknown=1 alike; proves the OLD bytes fail. */
  'time-unknown-display-contract.test.js',
  'b749-incomplete-fixes-finished.test.js',
  'record-verb-names-the-patient-once.test.js',
  'history-outcome-is-recorded-and-reported-honestly.test.js',
  'pull-verdict-is-a-store-census.test.js',
  'live-measured-occlusion-regressions.test.js',
  'writeback-walkthrough-contract.test.js',
  'idle-logout-knows-athena-work.test.js',
  'session-sliding-refresh-client.test.js',
  'sms-twofa-client-contract.test.js',
  'pull-visit-bodies-setting-restored.test.js',
  'pull-panel-calm-under-fire.test.js',
  'writes-are-unblocked-safely.test.js',
  'pull-progress-feeds-modern-pull.test.js',
  'phone-has-a-transcript-and-a-way-on.test.js',
  /* 2026-08-07, ph2-1.0.0. The phone stopped being the desktop with 28 hide
     rules on it and became its own app; these two guard the replacement. The
     suite above stays: it pins the LEGACY layer, which is still installed and
     still correct the moment the new UI is reverted or declines the device. */
  'phone-app-is-its-own-app.test.js',
  'phone-menu-and-controls.test.js',
  /* The avatar intake summary reaching the workspace app, and the quick history
     under the patient. Both are about ABSENCES: "none recorded" and "never read
     from athenaOne" are the same empty field and opposite clinical claims, and a
     brief attached to the wrong patient is one person's answers in another
     person's room. */
  'phone-checkin-and-quick-history.test.js',
  /* The old product name reached seven surfaces across four lanes. This sweeps
     the reviewed publication inventory rather than a hand-list, and asserts the
     three lowercase infrastructure names are UNTOUCHED — renaming the live API
     host is an outage and renaming the bundle id is permanent. */
  'one-product-name.test.js',
  /* From the owner's own iPhone screenshot: his phone had mls_device_role='office'
     stored, which made wantPhone() answer false and handed a 390px screen the full
     desktop workspace — AND aimed every Athena pull at a device that can never run
     the Chrome extension. canHostExtension() had been saying so in amber for days. */
  'an-iphone-cannot-be-the-office-computer.test.js',
  'phone-setup-guide-contract.test.js',
  'ai-audit-safety-fixes-contract.test.js',
  'loading-vocabulary-contract.test.js',
  'late-surfaces-stay-deferred.test.js',
  'provider-default-is-the-signed-in-doctor.test.js',
  'copilot-loader-order-contract.test.js',
  'copilot-stable-dock-runtime.test.js',
  'copilot-unify-pending-runtime.test.js',
  'copilot-unify-active-id-fastpath-runtime.test.js',
  'day-switch-otherday-contract.test.js',
  'visit-date-matrix-runtime.test.js',
  'expert-profile-editorial-contract.test.js',
  'help-search-location-contract.test.js',
  'homepage-sales-video.test.js',
  'kickstarter-sales-contract.test.js',
  'lawyers-editorial-redesign.test.js',
  'legal-workspace-phone-setup.test.js',
  'local-navigation-contract.test.js',
  'opnote-field-defaults-runtime.test.js',
  'opnote-heading-content-fidelity-runtime.test.js',
  'opnote-integrity-audit-regressions-runtime.test.js',
  'opnote-integrity-hardening-runtime.test.js',
  'opnote-live-findings-regression.test.js',
  'opnote-staging-parity-runtime.test.js',
  'opnote-template-integrity-runtime.test.js',
  'opnote-workflow-hardening-runtime.test.js',
  'opnote-dictate-fill-runtime.test.js',
  'patient-bar-stability-contract.test.js',
  'patient-bar-recent-chip-stability-runtime.test.js',
  'recent-patients-exact-event-lifecycle-runtime.test.js',
  'patient-banner-minimal-contract.test.js',
  'recording-ai-visibility-contract.test.js',
  'documents-dialog-meds-runtime.test.js',
  'orders-required-fields-runtime.test.js',
  'intake-kiosk-navigation-contract.test.js',
  'settings-analytics-truth-contract.test.js',
  'extension-badge-never-claims-currency.test.js',
  'opnote-draft-quarantine-contract.test.js',
  'freeze-resistance-contract.test.js',
  'no-native-dialogs-contract.test.js',
  'provider-simultaneous-safety-contract.test.js',
  'recording-consent-gate-runtime.test.js',
  'ui-polish-costs-contract.test.js',
  'patientpick-canonical-identity-runtime.test.js',
  'patientpick-hidden-view-performance-runtime.test.js',
  'patient-reach-v2-runtime.test.js',
  'public-button-wiring-contract.test.js',
  'public-inline-handler-contract.test.js',
  'scoped-lifecycle-watchers-contract.test.js',
  'site-audit-regressions.test.js',
  'site-continuity-contract.test.js',
  'loading-states-contract.test.js',
  'visit-single-quick-tools-surface.test.js',
  'study-natural-request-comparison.test.js',
  'study-natural-request-identity-adversarial.test.js',
  'study-natural-request-inmemory-contract.test.js',
  'study-natural-request-parser.test.js',
  'study-natural-request-privacy-adversarial.test.js',
  'template-standard-line-runtime.test.js',
  'tooltip-single-source-contract.test.js',
  'tooltip-dedupe-concern-perf-runtime.test.js',
  'ui-single-owner-contract.test.js',
  'ui-control-coverage.test.js',
  'visit-control-continuity.test.js',
  'visit-day-ownership-contract.test.js',
  'visit-exact-appointment-binding-runtime.test.js',
  'visit-exact-action-gate-runtime.test.js',
  'visible-clinical-action-gate-runtime.test.js',
  'visit-selection-restore-identity.test.js',
  'prep-summary-clinical-negatives.test.js',
  'calm-shell-generic-naming-scope.test.js',
  'settings-preview-commit-contract.test.js',
  'calm-shell-return-path.test.js',
  'patient-surfaces-clip-nothing-and-stop-moving.test.js',
  'review-step-never-fails-silently.test.js',
  'modal-focus-goes-in-and-comes-back.test.js',
  'motion-system-costs-no-layout.test.js',
  'dark-theme-reaches-every-panel.test.js',
  'one-heading-system.test.js',
  'one-radius-scale.test.js',
  'motion-tokens-are-page-level-and-cannot-strand.test.js',
  'motion-that-cannot-run-is-not-motion.test.js',
  'motion-system-contract.test.js',
  'voice-cluster-expands-never-decides.test.js',
  'review-is-a-review-not-just-orders.test.js',
  'phone-capture-survival.test.js',
  'phone-install-contract.test.js',
  'phone-dock-fits-and-targets-reach-44.test.js',
  'pf2-fold-contract.test.js',
  'chart-row-status-glyphs-are-not-mojibake.test.js',
  'pull-visits-checkbox-has-a-reachable-home.test.js',
  'relay-full-notes-choice-travels.test.js',
  'relay-phone-claims-only-what-it-sees.test.js',
  'secondary-text-is-a-theme-token.test.js',
  'headings-do-not-swallow-their-controls.test.js',
  'visit-focus-keeps-every-route.test.js',
  'visit-voice-one-expands-never-decides.test.js',
  'visit-voice-one-hidden-work-runtime.test.js',
  'chart-noise-never-renders-as-medication.test.js',
  'triage-clinical-rows-never-vanish.test.js',
  'voice-reaches-one-copilot-brain.test.js',
  'capture-and-turns-are-honest.test.js',
  'use-every-time-round-trip.test.js',
  /* Two glitches the owner could see and the gate could not. Both were found by
     measuring the running app rather than by reading it, and both are fenced by
     the PROPERTY that makes the fix a fix — a fixpoint, and one measurement per
     frame — because a "did it change?" guard cannot detect either class. */
  'nav-labels-and-order-hold-still.test.js',
  'typing-does-not-force-layout.test.js',
  /* 2026-07-31 — the phone app (app.html) and its two store binaries. These
     three carry more weight than a normal suite because a regression here is a
     store release, not a git push: Apple and Google review the bytes, and a
     doctor cannot roll back an app the way they can reload a page.
       boundaries        — CSP, no PHI at rest, text-only DOM, relay-only pulls
       control-budget    — the owner asked for "very little buttons"; this is
                           the number, so growing it is a deliberate edit
       www-build         — the reviewed page and the shipped bundle are one
                           file, proved by running the build and diffing it */
  'phone-app-boundaries.test.js',
  'phone-app-control-budget.test.js',
  'phone-app-www-build-is-faithful.test.js',
  /* av-5.7.0: the pre-visit brief reaches the phone. The ping fires while the
     app is OPEN and says nothing more than that — there is no APNs/FCM path, and
     a doctor who believes his pocket will buzz is worse off than one who knows
     it will not. The watch is visibility-gated because a backgrounded webview's
     timers are frozen, the first load never announces, and neither the briefs
     nor the ids of the check-ins they belong to may reach disk. */
  'phone-app-checkin-brief.test.js',
  /* "Draft all op notes" wrote an operative note for every name on the day,
     including follow-ups, cancellations and no-shows, because nothing in the
     op-note path had ever asked whether a procedure happened. This pins the
     triage that stops it, the doctor's bypass, the fences that keep the new AI
     matching layer from ever being weaker than the deterministic ranker, and
     that the gate composes with mls-connect's richer draftAll rather than
     replacing it (the b943 owner truce). */
  'opnote-day-brain-drafts-only-real-procedures.test.js',
  /* av-6.4.0 — the OTHER half of the same report: "fix the overlaying text to". #mlsAvKioskOrders
     is an OPAQUE white card at z-index 6 painted over the live transcript and the progress line, and
     two earlier "fix the overlapping text" rounds could not have caught it: one owned the text NODE
     (an arbitrator cannot own what is drawn above it) and every code-reading suite asked what was
     WRITTEN to the line, never what was DRAWN over it. This one derives the occluders from the
     stylesheet, renders the shipped stylesheet and markup in real Chrome, and asks
     elementFromPoint at the words' own coordinates. */
  'avatar-kiosk-panel-never-covers-the-text.test.js',
  /* lr-1.0 (2026-08-11, silent-refusal-DIAGNOSIS.md) — a 12.8s roster-gate
     refusal ran to completion and painted ZERO visible pixels: the receipt was
     spoken into the 0x0 retired #heroPullStatus, discarded at the cv-handoff
     settle, and the advisory in-flight gate left no receipt at all (the one
     zero-trace exit in the chain — un-adjudicable after the fact, which is
     itself the defect). These three run the REAL shipped functions and fail
     on every old shape by name. */
  'loud-refusal-pull-receipt.test.js',
  /* the hero labeled "Pull Tuesday, Jul 7" dispatched _acctTodayKey() —
     proven live with an instrumented click. The labeled day now rides an
     explicit-date door; dateless callers (copilot pull-today, centerpiece
     Today) keep TODAY so the lie cannot re-form in the opposite direction. */
  'pull-label-dispatch-match.test.js',
  /* qv-1.1: __mlsStoreWriteFailed was maintained but NO surface rendered it
     (a 60s-rate-limited toast died ~90s before anyone looked), while dayPull
     drove Athena to read charts into a store silently dropping growth. */
  'quota-surface-chip-and-preflight.test.js',
  /* ql-1.0: the sj-2.0 migration retired the localStorage key the qv guard
     verified saves against, so the guard condemned every healthy idb save as
     silent-no-op and the b1014 quota preflight refused every pull off a latch
     frozen at boot (live proof 1, 2026-08-11); proof 2 disclosed that the
     month lane bypassed the preflight entirely. The gate now judges CURRENT
     reality (the store's own confirm receipt) in both lanes, and a genuinely
     failing store still refuses loudly. */
  'stale-quota-latch-contract.test.js',
  /* hs-1.0 (live 2026-08-12, b1017 proof-1 criterion-6 caveat): the managed
     wrapper stamped __mlsPullLastOutcome ok:true on ANY resolve, so the named
     terminal failure the owner watched live ("no readable appointment rows
     ... Nothing was imported") was recorded as a success on the machine
     surface, and the progress stage read it back as "Pull finished." The
     stamp now carries the settled receipt's OWN verdict; this suite drives
     the REAL wrapper's settle path with the live failure shape and fails the
     old bytes by name. */
  'pull-outcome-honest-stamp.test.js',
  /* sbp-1.0 (live b1016+b1017, Proof 3): the day-strip "Full visit notes"
     checkbox painted ONCE at strip render - on a cold boot before the session
     namespace exists the resolver reads the placeholder 'sf_u::_::' slot,
     answers 'unset' (= on), and the box shows CHECKED forever while the
     settled preference is off (same-tab writes fire no storage event). The
     checkbox is a VIEW of the ONE resolver: it re-paints until the answer is
     definitive, then the watcher stands down. Runs the REAL strip block
     against the REAL resolver with a late-arriving session. */
  'strip-checkbox-paints-resolver.test.js'
];

const discovered = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('.test.js') || AUTOMATED_PROOF_FILES.has(name))
  .sort();
const duplicates = tests.filter((name, index) => tests.indexOf(name) !== index).sort();
const registered = [...new Set(tests)].sort();
const missing = discovered.filter(name => !registered.includes(name));
const stale = registered.filter(name => !discovered.includes(name));

if (duplicates.length || missing.length || stale.length) {
  const details = [];
  if (duplicates.length) details.push(`duplicate registrations: ${duplicates.join(', ')}`);
  if (missing.length) details.push(`unregistered automated tests: ${missing.join(', ')}`);
  if (stale.length) details.push(`registered tests missing on disk: ${stale.join(', ')}`);
  throw new Error(`Automated test registry is incomplete:\n- ${details.join('\n- ')}`);
}

/* 2026-08-10 DENOMINATOR LAW, applied to the gate itself: an exit code is
   only sound alongside a completeness assertion. A crashed partial run once
   produced an honest-looking file-read GATE_EXIT=0 over a fraction of the
   suite. The run now prints its own expected total up front and a
   GATE_COMPLETE line only after every registered suite executed — a wrapper
   must require BOTH the exit code and the matching GATE_COMPLETE line. */
console.log(`GATE_PLAN total=${tests.length}`);
let executed = 0;
for (const test of tests) {
  const file = path.join(__dirname, test);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log(`GATE_INCOMPLETE executed=${executed} of=${tests.length} failedAt=${test}`);
    process.exit(r.status || 1);
  }
  executed++;
}
if (executed !== tests.length) {
  console.log(`GATE_INCOMPLETE executed=${executed} of=${tests.length}`);
  process.exit(1);
}
console.log(`GATE_COMPLETE executed=${executed} of=${tests.length}`);
console.log(`PASS all ${tests.length} local regression suites`);
