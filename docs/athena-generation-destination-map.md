# Athena generation destination map

## Purpose and evidence boundary

This map defines where each MLS-generated artifact belongs in Athena, what the extension is allowed to do, and what must be proven before a route can be described as working. It separates live-observed Athena surfaces from routes inferred from source inspection. The map was created without an Athena write and contains no patient-specific clinical information. A controlled non-order placement proof may be appended only after immediate action-time confirmation, exact readback, and rollback; until then, the route remains source-inspected rather than live-write verified.

Evidence labels used below:

- **Live-verified surface**: the named Athena section or page was observed in the signed-in Athena UI.
- **Source-inspected route**: the extension route and its safety contract were inspected in source and synthetic tests; this does not by itself prove a live Athena write.
- **Live-write proof required**: if separately authorized in a future task, a controlled write, readback, and rollback must succeed on an owner-designated non-production test context before the route can be called end-to-end verified. No live write was performed for this audit.

## Non-negotiable safety rules

- A live non-order placement test may use only an owner-designated test context after immediate action-time confirmation; all other charts remain read-only.
- Order placement, order saving, order signing, and order submission are explicitly out of scope for this audit and must not be tested.
- The active patient and encounter identity must be verified immediately before every placement, save, or rollback action.
- A named clinical section may never silently fall back to the generic encounter note.
- An unknown, mixed, combined, duplicated, or payload-mismatched artifact must fail closed.
- Exact placement is not the same as saving, signing, ordering, submitting a claim, sending a message, or prescribing. Each state-changing step requires its own explicit proof and authorization.
- No route may be called live-verified merely because the destination exists or a synthetic DOM test passed.
- No live encounter was used for this audit. Named-section live-write proof therefore remains incomplete until a separately authorized, owner-designated non-production encounter is available.

## Live-verified Athena surfaces

The following surfaces were observed read-only in Athena:

| Surface | Live-observed sections or controls | What this proves | What it does not prove |
|---|---|---|---|
| Encounter workflow | Check-in, Intake, Exam, Sign-off, Checkout | These are distinct workflow stages. | It does not prove that the extension can navigate, save, or advance them safely. |
| Completed encounter summary | HPI; ROS; Physical Exam; Assessment / Plan; Return to Office; Encounter Sign-Off | These clinical destinations exist in the live completed-encounter presentation. | It does not prove each editor selector, placement action, save, or sign action. |
| Checkout / Claim | Appointment Summary; Diagnoses; Services; Clinical Add-Ons; Save; Review Claim | Billing is a separate Checkout/Claim surface, not a clinical-note subsection. | It does not prove charge entry, modifiers, units, diagnosis pointers, saving, reviewing, or claim submission. |
| Global navigation | Calendar; Patients; Claims; Financials; Reports; Quality; Apps; Support; Settings | These signed-in navigation destinations exist. | It does not authorize or prove any write within them. |

`Procedure Documentation` was **not** live-verified as an exact editable destination. It must remain manual/export-only until its precise editor, selectors, save behavior, readback, and rollback are proven in a separately authorized owner-designated non-production context.

## Supervised exact-write candidates (clinical note sections only)

These clinical-note routes have source-inspected contracts. They are candidates for supervised placement, not claims of completed live-write proof. Order rows are retained for destination documentation only and are manual/export-only for this audit.

| Generated artifact | Athena destination | Allowed mode | Validation and proof requirement |
|---|---|---|---|
| Generic visit, encounter, SOAP, progress, or insurance narrative | Encounter note | Supervised exact draft placement; supervised Save Draft may be a separate action | Require correct patient and encounter, exact destination, exact byte readback, and rollback on mismatch. Generic-note content must not contain a named-section routing request. Save Draft needs separate state verification. Sign & Save remains separately proof-gated. |
| HPI | Exact HPI editor | Supervised placement only; save/sign manual | Require immutable `HPI` artifact identity, exactly one HPI target and editor, exact payload bytes, active encounter identity, readback, and rollback. Live HPI section existence is verified; exact editor placement is not yet live-write proven. |
| Review of Systems | Exact ROS editor | Supervised placement only; save/sign manual | Require immutable `ROS` identity, one exact target/editor, exact bytes, identity check, readback, and rollback. Never route to the generic note. |
| Physical examination | Exact Physical Exam editor | Supervised placement only; save/sign manual | Require immutable `Exam` identity, one exact target/editor, exact bytes, identity check, readback, and rollback. This route excludes procedure/operative notes. |
| Assessment | Exact Assessment editor | Supervised placement only; save/sign manual | Require immutable `Assessment` identity, one exact target/editor, exact bytes, identity check, readback, and rollback. The live summary displays `Assessment / Plan`; the exact editor split still requires live selector validation. |
| Plan and follow-up | Exact Plan/Follow-up editor | Supervised placement only; save/sign manual | Require immutable `Plan` identity, one exact target/editor, exact bytes, identity check, readback, and rollback. Verify how saved content renders under Assessment / Plan and Return to Office before calling the route live-proven. |
| Exact E/M or CPT/HCPCS service code | Checkout / Claim billing service field | Supervised staging only | Accept only an exact supported five-character code, use the intended field, select the exact Athena suggestion, and read back the staged code. Modifiers, units, diagnosis pointers, Save, Review Claim, and claim submission remain manual. |
| Imaging order | Orders catalog | Implemented supervised single-order placement; synthetic-tested; no live order test in this release | Require one immutable clinician-accepted row, complete structured fields, an exact catalog code or ID, exact catalog selection and isolated readback, one-use authorization, and no automatic chaining. Saving, signing, or submitting another action is not implied. |
| Physical therapy order | Orders catalog | Implemented supervised single-order placement; synthetic-tested; no live order test in this release | Require one immutable clinician-accepted row with diagnosis, frequency, duration, and modalities; exact catalog identity and isolated readback; one-use authorization; and no automatic chaining. |
| Referral order | Orders catalog | Implemented supervised single-order placement; synthetic-tested; no live order test in this release | Require one immutable clinician-accepted row with specialty and reason, exact catalog identity and isolated readback, one-use authorization, and no automatic chaining. |
| DME order | Orders catalog | Implemented supervised single-order placement; synthetic-tested; no live order test in this release | Require one immutable clinician-accepted row with item, diagnosis, and ICD code, exact catalog identity and isolated readback, one-use authorization, and no automatic chaining. |

Before any candidate above is promoted to “end-to-end verified,” the release proof must capture the pre-write state, perform only the intended placement in the owner-designated test context after immediate confirmation, read back the exact result from Athena, and restore the original state or prove a safe rollback. A successful synthetic test alone is insufficient. Orders remain excluded from live testing in this release even though the supported adapters are implemented and synthetic-tested.

## Manual or export-only routes

| Generated artifact | Athena destination | Allowed mode | Validation and proof requirement |
|---|---|---|---|
| Procedure or operative note | Intended route: Physical Exam > Procedure Documentation | Manual copy/export only | Exact live editor and adapter are unverified. Do not flatten into Physical Exam prose or the generic encounter note. Promote only after exact live target, one-editor selection, byte readback, save behavior, and rollback are proven in a separately authorized owner-designated non-production context. |
| ICD-10 diagnoses | Assessment & Plan > Diagnoses | Manual entry and clinician review | Confirm code, description, encounter relevance, and ordering. Do not infer that a prose assessment authorizes diagnosis entry. |
| Billing modifiers, units, diagnosis pointers, or non-exact charge details | Checkout / Claim | Manual | Verify every field and claim context. Claim Save, Review Claim, and submission are separate human actions. |
| After-visit summary or patient summary | Patient Documents / Patient Instructions | Export, copy, or print for manual placement | Validate patient identity, encounter date, medications, instructions, and follow-up. Do not auto-send or auto-publish. |
| Patient instructions | Encounter > Patient Instructions | Manual placement | Clinician must review wording, precautions, and follow-up before saving or sharing. |
| Patient handout | Patient Documents > Handouts | Manual placement/export | Confirm topic, literacy level, language, and patient applicability before sharing. |
| Referral letter | Patient Documents / letter workflow | Manual placement/export | Verify recipient, specialty, reason, attachments, and patient identity before sending. |
| Prior authorization or appeal | Patient Documents | Manual placement/export | Verify payer, requested service, criteria, supporting facts, and recipient. No automatic submission. |
| Legal, IME, or narrative medical report | Patient Documents or local MLS chart | Local draft/export only | Require clinician review, source limitations, evidence support, and signature outside the generation step. No automatic Athena write or final legal opinion. |
| Consent document | Patient Documents > Consent | Manual workflow and signature | Verify correct consent version, patient, procedure, comprehension, and required signatures. |
| MIPS or other document aliases | Patient Documents | Manual placement/export | Confirm the exact document type and reporting context. |
| FHIR or chart export | File/export workflow | Export only | Validate requested scope, patient identity, file integrity, and destination. |
| Recommendations, red flags, differential, chart summary, or utilization-review prose | Local advisory/draft surface | Advisory, local, or export only | Clinician must validate facts and medical judgment. These artifacts do not map to a write destination merely because they mention a clinical section. |
| Portal message, staff message, fax, or email | Its separate communication workflow | Manual explicit workflow | Verify recipient, channel, content, attachments, and send action. Generation never authorizes transmission. |

## Blocked or fail-closed routes

| Generated artifact or action | Intended destination | Required mode | Reason and proof needed to unblock |
|---|---|---|---|
| Prose-only, incomplete, ambiguous, or multi-order request | Orders catalog | Blocked | A route must have one exact supported order and all mandatory structured fields. Ask for correction; do not guess or split silently. |
| Medication or prescription order | Medication / prescription workflow | Blocked from extension automation | Requires a separately validated prescribing adapter, identity checks, medication reconciliation, dose/route/frequency validation, interaction safeguards, and explicit clinician authorization. |
| Injection or in-office procedure order | Orders / procedure workflow | Blocked from extension automation | Requires an exact live destination, complete structured parameters, inventory/administration context where applicable, readback, and explicit clinician authorization. |
| Surgery scheduling | Surgery scheduling workflow | Blocked from automated scheduling; manual only | Requires exact live workflow mapping, dates, facility, procedure, laterality, authorization, and explicit scheduling confirmation. |
| Unknown, mixed, duplicate, mismatched, or combined named-section payload | None | Fail closed | The artifact must resolve to exactly one supported immutable section and exactly one editor. In particular, combined `Assessment & Plan` content may not be guessed into separate editors. |
| Named-section fallback to generic encounter note | Encounter note | Prohibited | No amount of generic-note readback proves correct named-section placement. Correct the route rather than degrading it. |
| Automatic signing, encounter sign-off, order signing, prescription submission, message sending, claim save/review/submission | Relevant final-action control | Blocked unless separately authorized and live-proven | Each action needs a dedicated adapter, identity and state checks, an explicit confirmation boundary, and controlled owner-authorized non-production proof where applicable. |
| Any live write outside an owner-authorized non-production context | Any Athena destination | Prohibited | No exception. All other charts remain read-only. |
| Any encounter-scoped live write without a separately authorized owner-designated non-production encounter | Encounter editors and orders | Blocked | This audit performs no live write. A future authorized test must re-verify identity and destination immediately before testing. |

## Release proof checklist

A route is eligible to be labeled fully working only when all applicable items are recorded:

1. The destination exists in the live Athena UI.
2. The selector identifies exactly one intended editor or field.
3. The patient and encounter match the separately authorized owner-designated non-production test context.
4. The source artifact type, target section, and payload agree exactly.
5. Placement produces an exact readback; any mismatch triggers fail-closed rollback.
6. No unrelated field, section, patient, order, charge, or document changes.
7. Save, sign, submit, send, prescribe, or claim actions are tested and authorized separately rather than inferred from placement.
8. The original state is restored after testing when rollback is part of the contract.
9. The result is rechecked in Athena after navigation or refresh, not only in the extension UI.
10. The evidence record names the site build, extension version/core digest, source commit, route key, live-versus-synthetic status, redacted frame/selector fingerprints, verified encounter locator, payload and readback hashes, rollback result, and final saved/signed state.

Until this checklist is complete for a route, documentation and product UI should describe it precisely as live-observed, source-inspected, supervised placement, manual/export-only, or blocked—not as an end-to-end verified Athena write.
