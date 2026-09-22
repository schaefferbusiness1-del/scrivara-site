# Op-Note Template Pack — for Dr. Schaeffer (2026-07-23)

Your Thursday procedure schedule needs four templates that are **missing from the
account library** — today the only TFESI template is a QA leftover that stamps
"SYNTHETIC QA OPERATIVE NOTE" into real drafts and leaves 17 blanks (validated
live on a real July-9 TF ESI patient; the generator itself filled patient, DOB,
MRN, provider, expanded "L L3 TF ESI P" into "Left L3 lumbar transforaminal
epidural steroid injection", and pulled the pre-op diagnosis from the chart —
the template is what's holding notes back).

**How to add each template (~2 min total):** Templates (📄) → paste the name and
text below into the Add form → 💾 Save template → your account is hosted, so a
review card appears ("Import preview … Nothing has been saved") → press
**Commit**. Leave "Activate after import" checked only if you want the cloud
set to become the active library; otherwise the templates stay device-local.
Even better: replace any of these with a paste of one of YOUR OWN prior op
notes — the app automatically strips the prior patient's identity and turns it
into a template with your exact wording.

**Cleanup recommended (Templates → Saved templates):** delete
"QA Bilateral Lumbar Facet Injection 20260722" and
"QA Lumbar Transforaminal ESI 20260722" (test debris from a QA session —
the first currently catches your MBB patients), and the History record
"ZZ QA Synthetic 20260722 — SYNTHETIC QA — Bilateral L4-L5 facet joint…".

---

## 1. Lumbar Medial Branch & Dorsal Ramus Block
*(covers "B/L L3, L4MB & L5 DR B #N P" rows — currently 14 Thursday patients route to the QA facet template)*

```
PATIENT: [[patient_name]]
DATE OF PROCEDURE: [[procedure_date]]
PREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]
POSTOPERATIVE DIAGNOSIS: Same.
PROCEDURE: Lumbar medial branch and dorsal ramus blocks under fluoroscopic guidance.
LEVELS AND SIDE: [[levels_and_side]]
INDICATION: [[indication]]
CONSENT: The risks, benefits, and alternatives of the procedure were discussed with the patient and informed consent was obtained prior to the procedure.
ANESTHESIA: Local skin anesthesia with 1% lidocaine.
TECHNIQUE: The patient was placed prone on the fluoroscopy table. The skin overlying the target levels was prepped and draped in the usual sterile fashion. Under fluoroscopic guidance, the junction of the superior articular process and the transverse process was identified at each medial branch target, and the junction of the sacral ala and the superior articular process of S1 for the L5 dorsal ramus. After local anesthesia, a [[needle_gauge]] spinal needle was advanced to each target under intermittent fluoroscopic visualization and needle tip position was confirmed in appropriate views. Following negative aspiration, [[injectate]] was injected at each site.
COMPLICATIONS: None. The patient tolerated the procedure well.
DISPOSITION: The patient was monitored post-procedure and discharged in stable condition with post-procedure instructions and follow-up.
```

## 2. Lumbar/Sacral Transforaminal ESI
*(replaces the QA TFESI template; "lumbar/sacral" wording lets "B/L S1 ESI" rows match transforaminal instead of caudal)*

```
PATIENT: [[patient_name]]
DATE OF PROCEDURE: [[procedure_date]]
PREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]
POSTOPERATIVE DIAGNOSIS: Same.
PROCEDURE: Transforaminal epidural steroid injection under fluoroscopic guidance, lumbar/sacral.
LEVELS AND SIDE: [[levels_and_side]]
INDICATION: [[indication]]
CONSENT: The risks, benefits, and alternatives of the procedure were discussed with the patient and informed consent was obtained prior to the procedure.
ANESTHESIA: Local skin anesthesia with 1% lidocaine.
TECHNIQUE: The patient was placed prone on the fluoroscopy table. The skin was prepped and draped in the usual sterile fashion. Under oblique fluoroscopic guidance, a [[needle_gauge]] spinal needle was advanced toward the superior-anterior aspect of the target neural foramen at each treated level. Needle position was confirmed in AP and lateral views. Contrast injection demonstrated appropriate epidural and perineural spread without vascular uptake. Following negative aspiration, [[injectate]] was injected at each level.
COMPLICATIONS: None. The patient tolerated the procedure well.
DISPOSITION: The patient was monitored post-procedure and discharged in stable condition with post-procedure instructions and follow-up.
```

## 3. Sacroiliac (SI) Joint Injection
*(currently every "SI joint inj" row has NO template and honestly refuses)*

```
PATIENT: [[patient_name]]
DATE OF PROCEDURE: [[procedure_date]]
PREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]
POSTOPERATIVE DIAGNOSIS: Same.
PROCEDURE: Sacroiliac joint injection under fluoroscopic guidance.
SIDE: [[side]]
INDICATION: [[indication]]
CONSENT: The risks, benefits, and alternatives of the procedure were discussed with the patient and informed consent was obtained prior to the procedure.
ANESTHESIA: Local skin anesthesia with 1% lidocaine.
TECHNIQUE: The patient was placed prone on the fluoroscopy table. The skin was prepped and draped in the usual sterile fashion. With cephalocaudal tilt, the inferior aspect of the sacroiliac joint was visualized. A [[needle_gauge]] spinal needle was advanced into the inferior third of the joint under fluoroscopic guidance. Contrast injection confirmed intra-articular placement. Following negative aspiration, [[injectate]] was injected.
COMPLICATIONS: None. The patient tolerated the procedure well.
DISPOSITION: The patient was monitored post-procedure and discharged in stable condition with post-procedure instructions and follow-up.
```

## 4. Hip Joint Injection (Fluoroscopic)
*(covers "R hip injection P" rows — no template today)*

```
PATIENT: [[patient_name]]
DATE OF PROCEDURE: [[procedure_date]]
PREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]
POSTOPERATIVE DIAGNOSIS: Same.
PROCEDURE: Intra-articular hip joint injection under fluoroscopic guidance.
SIDE: [[side]]
INDICATION: [[indication]]
CONSENT: The risks, benefits, and alternatives of the procedure were discussed with the patient and informed consent was obtained prior to the procedure.
ANESTHESIA: Local skin anesthesia with 1% lidocaine.
TECHNIQUE: The patient was placed supine on the fluoroscopy table. The skin overlying the hip was prepped and draped in the usual sterile fashion. Under fluoroscopic guidance, a [[needle_gauge]] spinal needle was advanced to the femoral head-neck junction. Following negative aspiration, contrast injection confirmed intra-articular placement. [[injectate]] was then injected.
COMPLICATIONS: None. The patient tolerated the procedure well.
DISPOSITION: The patient was monitored post-procedure and discharged in stable condition with post-procedure instructions and follow-up.
```

---

After adding these, drafting a Thursday list works as: 💉 Prep op notes → "All
scheduled patients" → ✨ Draft all → the Fields box shows the few real blanks →
**🎙 Dictate to fill** (speak all details naturally — AI puts each in the right
field and normalizes units/terms; confirmed fields are never overwritten) →
✓ Save all drafted. Everything stays a reviewable draft in MLS History; nothing
is ever sent to Athena by this flow.
