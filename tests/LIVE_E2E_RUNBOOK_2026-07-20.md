# Live end-to-end runbook — full provider loop on b440 / ext 2.9.43

Purpose: demonstrate the complete mission workflow (sign-in → auto context →
history → record → generate → review → write to Athena → verify → recover →
next patient) on the CURRENT build, repeatedly, in the real Chrome environment.

The loop was last fully live-proven across b359–b419 (write-test encounter
gate wf2, pull-truth "perfect loop"). b430–b440 changed the writeflow
substantially, so a current-build run is required evidence.

## Why this run is owner-assisted (by design, not by gap)

- Documentation writes: ONLY test patient **Adam J Schaeffer** (standing rule).
- The write floor requires Adam's encounter OPEN in DOCUMENTATION view —
  check-in is a clinical act the extension never performs (owner-enforced).
- Review/approve (step 6) and Sign & Save are human-only by contract
  (`verified-note-write-required`, one typed mutation per real click).
- Write probes REFUSE on multi-tab ambiguity: exactly ONE signed-in Athena tab
  must be open during the write phase.

## Preconditions (verify all before starting)

1. Machine idle — no clinic activity (evening). Ask Michael before starting.
2. Exactly ONE Athena tab, signed in (close the extras; today there were 4).
3. MLS app tab on b440 (`window.__MLS_AV === 'b440'`), extension 2.9.43
   (`mlsAppGetVersion` → 2.9.43 — reload the tab first; orphaned scripts lie).
4. Adam J Schaeffer has a TODAY appointment on the schedule (owner creates if
   absent) and his encounter is open in DOCUMENTATION view (owner clicks).
5. Session health green (read-only probe); repeat every ~7 min during the run.

## The loop (repeat 3× minimum; each pass ≤ 10 min)

| Step | Action | Evidence to capture |
|---|---|---|
| 1-2 | Fresh app-tab load; no manual setup | auto provider + schedule + Adam row present; screen state JSON |
| 3 | Open Adam from the row (single tap) | locked identity {name,dob,id}; binding context (appointmentId, date, provider); history panel populated; any "unavailable" markers honest |
| 4 | Record a short scripted test visit (owner speaks; or Paste-a-transcript lane for repeat passes) | transcript non-empty, patient-bound |
| 5 | Generate note | generated note references history correctly; no invented content (owner reads) |
| 6 | Owner reviews/edits/approves | edit persists across an app-tab reload (state recovery) |
| 7 | Athena write via unified manifest (write_note) | probe context-verified receipt; ONE confirm click; write receipt with noteWriteProof |
| 8 | Verification | `mlsAppVerifiedWrite` receipt; owner eyeballs the note in Athena's encounter (correct patient, correct section) |
| 9 | Recovery | reload app tab: draft/note/receipt all restored; History shows the visit |
| 10 | "Next patient" | switch to another (READ-ONLY) patient and back; no context bleed, no refresh needed |

Pass criteria: every step first-click, honest progress text, zero manual
recovery. Any deviation = file a defect with the exact receipt/console state.

## Safety rails during the run

- NO orders, prescriptions, labs, imaging, referrals — ever.
- Writes only to Adam's encounter; abort if the probe shows any other identity.
- Sign & Save in Athena is performed by the owner or not at all.
- If Athena signs out mid-run: pause, preserve state, owner signs back in,
  resume from the interrupted step (this itself is evidence for session
  recovery).

## Evidence storage

Save probe/receipt JSON snapshots per pass under
`tests/live-e2e-artifacts/2026-07-2X-b440/` and summarize results in
LIVE_SYNTHETIC_TEST_MATRIX.md as a new "Authenticated end-to-end" row.
