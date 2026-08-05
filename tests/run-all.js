'use strict';

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const tests = [
  'public-publication-boundary.test.js',
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
  'schedule-row-links-the-chart.test.js',
  'default-note-format-shows-matching-body.test.js',
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
  'progress-stages-runtime.test.js',
  'interaction-performance-contract.test.js',
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
  'studio-merge-keeps-every-route.test.js',
  'team-tab-reach-under-tools.test.js',
  'shell-label-authority-contract.test.js',
  'scribeflow-inline-syntax.test.js',
  'startup-hydration-contract.test.js',
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
  'history-organization-adversarial.test.js',
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
  'athena-pull-notification-ownership.test.js',
  'opnote-exact-patient-binding.test.js',
  'opnote-staging-identity-runtime.test.js',
  'opnote-verified-history-repair-runtime.test.js',
  'template-library-runtime.test.js',
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
  'patient-row-stability-contract.test.js',
  'task3-time-formatter-cache.test.js',
  'patient-card-contrast-contract.test.js',
  'patient-surface-design-language.test.js',
  'analysis-scope-chip-fits-a-phone.test.js',
  'patient-store-compression-runtime.test.js',
  'patient-store-batch-runtime.test.js',
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
  'schedule-authoritative-reconciliation-runtime.test.js',
  'schedule-calendar-partial-diagnostics-runtime.test.js',
  'schedule-import-scan-performance-contract.test.js',
  'provider-day-pull-contract.test.js',
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
  'ai-audit-safety-fixes-contract.test.js',
  'loading-vocabulary-contract.test.js',
  'late-surfaces-stay-deferred.test.js',
  'provider-default-is-the-signed-in-doctor.test.js',
  'copilot-loader-order-contract.test.js',
  'copilot-stable-dock-runtime.test.js',
  'copilot-unify-pending-runtime.test.js',
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
  'typing-does-not-force-layout.test.js'
];

const discovered = fs.readdirSync(__dirname)
  .filter(name => name.endsWith('.test.js'))
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

for (const test of tests) {
  const file = path.join(__dirname, test);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log(`PASS all ${tests.length} local regression suites`);
