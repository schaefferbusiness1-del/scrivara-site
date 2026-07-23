# b500 — Full live acceptance sweep (2026-07-23 afternoon)

Method: live testing on mlsscribe.com — real signed-in workspace (strictly read-only; clinic was mid-day), the read-only sample workspace (?preview=1), an isolated browser session for public/auth flows, plus curl for public endpoints and the Render-deployed backend. Every screen visually inspected in a real rendering browser; zero reliance on prior test results for the verdicts below.

## Verified working live (exercised, not assumed)
- **Boot/auth**: sign-in gate clean; full boot into workspace ~15s incl. SW + 205 modules; ZERO console errors on a tracked fresh boot of the real signed-in workspace.
- **Real signup path**: agreements hydrate from the live counsel-approved manifest (Terms/Privacy 2026-07-21); checkboxes enable only after manifest validation; account creation proceeds to mandatory 2FA (TOTP) enrollment. Demo-mode signup fail-closed with the server-owned-manifest design (localhost fixtures only for E2E) — confirmed intended.
- **Sample workspace (?preview=1)**: honest read-only labeling everywhere, patient chooser + instant identity-correct switching, sample banner, reset/exit.
- **Today view**: agenda strip, hero, quick tools, read-only Pull affordance; recording NOT triggered (real clinic day).
- **Portal requests**: modal + New/Reviewed/All filters + honest per-filter empty states.
- **Templates**: import batch UI, add form, saved list w/ search, versioned cloud library with honest "no cloud set active" state, template health panel.
- **Recommendations**: honest empty state + review disclaimer.
- **Analysis**: scoping banner (whole practice vs one provider), tiles + counts render; premium labels correct.
- **History**: visit list w/ unassigned-draft Attach affordances, signed-in-mode save banner, Review Athena actions chip.
- **Patients**: 1469-patient roster, grouping, profile pane, prep summary, export affordances.
- **Calendar**: month grid + day-at-a-glance (20 booked), provider scoping chips w/ counts, range tools, working hours.
- **AI Studio**: Study Groups panel, Copilot chat — live ask answered HONESTLY (no fabricated patient list; working "Navigate to Patients" action), custom-tool builder with practice-tailored starters.
- **Copilot Voice**: cv2-1.2.0 live, button present, assistant bridge ready (deterministic-local behavior pinned by suite).
- **Settings (cs-2.0.0)**: all sections render; Notes & AI shows the named model trio with GPT-5 mini selected (b499 verified in the real account).
- **Team**: honestly release-gated toast.
- **Public pages**: booking (surfaces server reasons), appointment (two-tap cancel live), patient-portal (DOB factor present), intake, privacy, terms, assist, lawyers, expert, get-extension — all 200; unpublished pages (easy-book, mls-widgets, patient-review, staging shell) correctly 404 per the publication boundary.
- **Extension channel**: live feed 3.0.4 + MLS_Assist_v3.0.4.zip byte-verified against the committed package (sha 953f5beb…, 376,822 bytes, exact match).
- **Backend**: booking transaction/idempotency + portal DOB live (Render 12:11 PM EDT); bad-token booking 404s with the honest message; portal login fails closed.
- **Responsive**: 375px phone width — zero horizontal overflow, no over-wide elements.

## Defects found → fixed in b500 (this build)
- **F1 · End-of-day banner contradiction** (unr-1.1.0): "No more patients today." was time-only truth — with the clinic running late it contradicted the agenda ("1 remaining") while an unseen patient waited. Now: when all appointment times have passed but unseen patients remain (staff excluded, same rule as the agenda), the banner says "All appointment times have passed — N patient(s) on today's list is/are not marked seen yet." Pinned in site-continuity-contract.
- **F3 · Duplicate provider chip** (t3-1.0.7): an imported appointment whose provider string carried a leading "PROVIDER " label ("Provider MATTHEW SCHAEFFER, MD") minted its own roster chip beside the real provider. cleanProv now strips the label prefix, and chip labels use the humanized name, so the row merges into the real provider's count. Pinned in visit-selection-restore-identity.

## Found, verified, NOT a code defect (documented/routed)
- **F2 · "1 visit" chip vs empty visit list** (John Kinnier): the store genuinely has 0 visit rows while a chart-import note from 08:11 AM exists — husk aftermath from before the 11:11 AM backend mirror fix; heals via the mirror-heal path. Routed to the Athena/extension session with the concrete patient id as a verification example.
- **Demo-mode signup blocked**: by design (server-owned legal manifest; sample day is the try-first path).
- **Dark scheme**: the app intentionally manages its own theme; it does not follow prefers-color-scheme on the auth/sample surfaces.

## Not exercised live (and why)
- Recording/consent/generate/sign on the REAL account: clinic was mid-day with real patients — write-path testing on live PHI is out of bounds. These paths are covered by the 17-step offline E2E (real UI flows: consent → capture → generate → sign → op-prep → resume) which ran green 2× today, plus the b490 consent-gate suites.
- Live Athena pull / writeback / extension reloads: other workstream's lane; standing prohibition.
- Full portal login/chat as a patient: requires an invited patient account; invite sending emails a real inbox — deferred to the owner-assisted QA-account plan (2FA step pending with the owner).

## Coordination
- Extension session: notified 3.0.4 is the live offered stable (byte-verified) + husk-heal example patient.
- Op-note session: notified oni-2.9.0 is live with token 20260723oni282; build on top, move the token together.
- Coordination file updated throughout; b500 claimed there.
