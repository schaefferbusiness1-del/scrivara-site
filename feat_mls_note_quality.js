/* =============================================================================
 * MLS Scribe - NOTE QUALITY FLOOR  (noteq-1.0.0, b1169)
 *
 * Owner, 2026-09-01: "the outputs from an op note or really any outputs are
 * good. they are being run into 4o and they need to be tuned to actually give
 * good outputs and not just an output. they need to be at professional medical
 * quality... find really professional quality notes for op notes and for plan
 * and assessment and HPI and more and then don't let the quality ever degrade
 * below that. the notes still need to follow the templates too. also make sure
 * they are following the templates well."
 *
 * WHAT THIS IS. Two halves of one contract, both offline and deterministic:
 *
 *   contractFor(noteType, opts) - the prose contract appended to the 4o prompt
 *     at generation time and again at the template-reformat pass. It is what
 *     makes the model aim at a professional note instead of at "an output".
 *
 *   grade(noteText, noteType, ctx) - the same standard read back off the
 *     produced text with regexes only. No network, no model, no clock skew:
 *     the same note always scores the same. If it lands under floor(noteType)
 *     the caller regenerates EXACTLY ONCE with the findings quoted back, then
 *     keeps whichever draft scored higher.
 *
 * PRECEDENCE - THIS IS LAW AND IT IS NOT A STYLE PREFERENCE.
 *   1. the practice's template and the physician's own edits
 *   2. the governing payer LCD/LCA
 *   3. the cited national standards
 *   4. this rubric
 * A failed check is a PROMPT FOR REVIEW. It is never authority to alter a
 * clinical fact. Nothing in this module rewrites a note, changes a number,
 * supplies a laterality, or touches what the doctor typed. It scores, it
 * tells the truth about what it found, and it stops there.
 *
 * WHY A CONSTANT FLOOR. floor() reads from FLOORS below and from nowhere
 * else - not settings, not localStorage, not a server flag. A floor that a
 * user can lower is not a floor, and the owner's ask was that quality never
 * degrade below the standard. The ledger records what happened; it can never
 * change what passes.
 *
 * SOURCE OF THE RUBRIC. Ported faithfully from the quality-1.0.0 spec
 * (6 note types, 56 block rules, 55 warn rules) synthesized from TJC
 * RC.02.01.03, Universal Protocol, 42 CFR 482.51/482.24, ASC 416.48/416.52,
 * the MAC facet/ESI/SI LCDs, CPT 2021/2023 E/M, ASRA antithrombotic guidance,
 * FDA DSC 2014 particulate-steroid safeguards, SIS/ISIS/ASIPP/NASS target
 * nomenclature, the TJC Do Not Use list, and CDC 2022 opioid guidance.
 *
 * WHAT IS DELIBERATELY NOT PORTED. Rules that need data this app does not
 * hold at grade time - a slot-provenance map, the prior 20 notes on the same
 * templateId, encounter metadata for identity matching - are SKIPPED, not
 * failed. A check that cannot run must never manufacture a failure, because a
 * grader that cries wolf gets switched off and then nothing is graded at all.
 * Those rules stay in the CONTRACT text, where the model can still honour
 * them, and they are named in tips[] so the physician knows what was not
 * machine-checked.
 *
 * HOST-AGNOSTIC ON PURPOSE. No DOM access at load. Exports on window when
 * there is a window and on module.exports when there is one, so the proof
 * suite grades the very bytes that ship.
 * ============================================================================= */
(function () {
  'use strict';

  /* noteq-1.0.0 (b1169): identity + idempotent re-entry, mirroring the other
   * shared feat modules - a second load of the same version is a no-op. */
  var VERSION = 'noteq-1.0.0';
  var BUILD = 'b1169';
  var W = (typeof window !== 'undefined') ? window : null;
  if (W && W.__mlsNoteQuality && W.__mlsNoteQuality.version === VERSION) return;

  /* noteq-1.0.0 (b1169): the six canonical rubric ids. */
  var T_OP = 'operative-procedure-note';
  var T_HPI = 'hpi';
  var T_AP = 'assessment-plan';
  var T_PE = 'ros-pe';
  var T_SOAP = 'visit-note-soap';
  var T_TPL = 'template-fidelity';
  var ALL_TYPES = [T_OP, T_HPI, T_AP, T_PE, T_SOAP, T_TPL];

  /* noteq-1.0.0 (b1169): THE FLOOR IS A CONSTANT. Never read from settings.
   * Ranked by medico-legal exposure: an operative note carries wrong-site and
   * unit-of-service risk and a template breach carries the doctor's own
   * medico-legal wording, so both sit highest; an HPI on an established
   * follow-up is legitimately short, so it sits lowest. */
  var FLOORS = {};
  FLOORS[T_OP] = 92;
  FLOORS[T_TPL] = 92;
  FLOORS[T_AP] = 90;
  FLOORS[T_SOAP] = 90;
  FLOORS[T_PE] = 88;
  FLOORS[T_HPI] = 88;
  var DEFAULT_FLOOR = 88;

  /* noteq-1.0.0 (b1169): score weighting. Block rules are the safety tier and
   * carry 75 of the 100 points; warn rules are the completeness tier and carry
   * 25. Independently of the number, pass REQUIRES zero block failures - the
   * spec's minimumConformance is 1 and no amount of warn-tier credit buys a
   * block failure out. */
  var W_BLOCK = 0.75;
  var W_WARN = 0.25;

  /* noteq-1.0.0 (b1169): exactly one automatic regeneration, ever. The bound
   * is a constant so the loop cannot be widened by a caller. */
  var MAX_REGENERATIONS = 1;

  /* =========================================================================
   * PROMPT CONTRACTS - verbatim from the quality-1.0.0 spec, ASCII-folded.
   * These are appended to the 4o system prompt at generation AND at the
   * template-reformat pass. ASCII-only by house rule: a latin1 writer turns
   * smart quotes and em dashes into control bytes downstream.
   * ========================================================================= */
  var CONTRACTS = {};

  CONTRACTS[T_OP] =
    "THE TEMPLATE IS AUTHORITATIVE FOR STRUCTURE. Reproduce every heading the doctor's template supplies, verbatim - same spelling, punctuation, capitalization - in the template's order. Add no section the template does not contain. Reproduce every fixed template sentence character-for-character, including every 'no', 'not', 'without', and 'negative'. Where the template marks a block repeatable, expand it once per level/side/procedure actually performed, contiguously.\n\n" +
    "Fill each slot from the transcript, the chart, the order, or the fluoroscopy/device record only. If a value was not stated, write the practice's not-addressed marker or 'not documented' - never a plausible number. Fluoroscopy time and dose, sedation times, contrast volume, needle gauge, vitals, EBL, and pain scores are never estimated. Never document a step that was not performed: no time-out, no motor stimulation, no negative aspiration, no contrast injection, no observation period narrated by template rather than by event. That is the highest-severity failure in this note type.\n\n" +
    "Within that structure, the note must carry: date and time of procedure with proceduralist and any assistant; pre- and post-procedure diagnosis with level and laterality ('Same' is valid for post-); a procedure name enumerating every level, every side, and the guidance modality, matching the billed unit of service (for trigger points the unit is MUSCLES); indication with duration, conservative-care failure, and prior block response as percent AND duration; for facet RFA, the two prior diagnostic medial branch blocks with at least 80% concordant relief; pre- and post-procedure pain scores with the elapsed interval; allergy status and antithrombotic status with hold interval or explicit none; consent with risks, benefits, and alternatives, obtained before sedation; site marking when laterality or level applies; an itemized time-out documented before needle insertion; sedation detail with ASA class, agent/dose/route/time, monitoring modalities, and the dedicated monitoring individual when sedation is used, stating sedation was minimal for a diagnostic block; position, prep agent, drape, and local anesthetic with concentration; guidance modality with the specific views, fluoroscopy time and dose, and a statement that permanent images were retained; needle or cannula gauge and length, plus active tip and electrode type for RF; the target named by accepted nomenclature - medial branches and dorsal rami for denervation, not the joint (lumbar Lx-L(x+1) via the L(x-1) and Lx medial branches; L5-S1 via the L4 medial branch and L5 dorsal ramus; CERVICAL Cx-C(x+1) via the Cx and C(x+1) medial branches; C2-3 via the third occipital nerve); negative aspiration for blood and CSF; contrast agent, volume, spread, and explicit absence of vascular, intrathecal, subdural, and intraneural uptake; non-particulate steroid for any transforaminal and absolutely for cervical; for RF, 50 Hz sensory threshold with concordance, 2 Hz motor to at least 2 V with the response, pre-lesion anesthetic through each cannula, lesion temperature, duration, and lesions per target; every medication with concentration, volume, computed dose, and site, plus session totals; local anesthetic only in a diagnostic block; an explicit FINDINGS statement; needle removal intact, hemostasis, dressing; estimated blood loss; complications with the word 'none' when there were none, and any real event narrated with management and outcome; specimens when anything was aspirated; observation interval, vitals, motor and sensory check after any neuraxial injection, ambulation, and escort when sedated; instructions with red flags, follow-up, and the pain-diary window for a diagnostic block; and an authentication block with credentials, date, time, and a supervision attestation when a trainee participated.\n\n" +
    "Write in third person, past tense, standard operative register, passive for procedural steps, one action or observation per sentence in real procedural order. Use the conventional idioms rather than paraphrasing them. Leading zero before every decimal, no trailing zero, no U/IU/QD/QOD/MS/MSO4/MgSO4. Do not write first-person AI voice, meta-commentary, or a summary. Do not hedge a dose, concentration, volume, level, side, temperature, or the complications statement. Do not add a level, side, muscle, or unit of service the source does not support. Output the note unsigned, in draft.";

  CONTRACTS[T_HPI] =
    "THE TEMPLATE IS AUTHORITATIVE FOR STRUCTURE. If the practice supplies HPI headings or a paragraph shape, reproduce them exactly; this contract governs content within them and never reorders or renames a template heading. Ordering below is advisory.\n\n" +
    "First, honor the note subtype. A new-patient or consult HPI anchors with age, sex, and pertinent history. An established or post-procedure follow-up does NOT re-declare '58-year-old female' and does NOT reproduce the intake narrative - its defining content is the interval history: what has happened since the last visit or procedure, the percent relief and duration of relief obtained, adverse effects, current status, and what the patient wants today. A follow-up HPI is short by design; concision there is competence.\n\n" +
    "Write from the source only. Never state a date, dose, level, percentage, treatment, imaging finding, or prior diagnosis that is not in the transcript or the supplied chart context. This note reaches the patient's portal the day it is signed.\n\n" +
    "Cover, as the encounter warrants: reason for the encounter; onset, chronicity, and duration (state the three-month threshold explicitly when true); mechanism or an explicit atraumatic statement, with work or MVA context and work status when applicable; location with laterality and spinal level or region - describe midline and axial pain as axial or midline rather than inventing a side; radiation with a named distal extent, above or below the knee, or an explicit denial; quality in the patient's own descriptors; severity as average, worst, and best on a numeric scale ('severe stenosis' on an MRI is never a pain severity); timing, pattern, and - on follow-up - trajectory; aggravating and relieving factors; associated symptoms with explicit pertinent negatives; a region-appropriate red-flag screen with specific denials - bowel and bladder plus saddle for lumbosacral, the myelopathy set (hand clumsiness, dropping objects, buttons, handwriting, balance, urinary urgency, Lhermitte) for cervical, never saddle anesthesia for a neck complaint - and, when a red flag is positive, what is being done about it; prior workup with a date and attribution ('MRI of 05/12/2026 was reported as showing...'); prior treatments conservative-to-invasive with each outcome and the conservative trial's duration in weeks; every prior interventional procedure with laterality, level, date, PERCENT relief, and DURATION of relief; current medications with dose and frequency and controlled-substance status; functional impact quantified against a concrete activity or tolerance, plus work or disability status; and the patient's goal.\n\n" +
    "Third person for the patient, varied attribution verbs, no three-word stem opening more than two sentences. Limited clinician first person is correct for verifiable actions - 'I reviewed the MRI of 05/12/2026', 'I last saw her on 06/03/2026'. Describe the pattern, map it anatomically, and conclude nothing: write 'shooting pain radiating down the posterior right leg to the foot', not 'radicular'. State relief as a pair: 'approximately 80% relief of leg pain lasting three weeks.' Plain, neutral, non-stigmatizing language: 'has not been able to attend therapy', not 'non-compliant'; 'declines', not 'refuses'.\n\n" +
    "Do not include examination findings ('tender to palpation', 'SLR positive', '4/5 strength'), diagnostic conclusions asserted as fact, speaker labels, timestamps, ASR artifacts, second-person address, catch-all negatives ('no red flags', 'ROS negative'), boilerplate ROS dumps, copy-forward markers standing in for interval history, or error-prone dose designations. Reorganize into clinician synthesis, not transcript order.";

  CONTRACTS[T_AP] =
    "THE TEMPLATE IS AUTHORITATIVE FOR STRUCTURE. Reproduce the practice's A&P headings verbatim and in order; this contract governs content within them.\n\n" +
    "Write one numbered entry per problem addressed at this encounter, ordered by what actually drove today's decision-making. Each entry: a compact diagnostic header - '[side or midline] [level or joint] [pathology], [chronicity]' - then a short assessment clause giving exam and imaging concordance, trajectory, and the measured response to the last intervention as percent AND duration, then a plan sub-list scoped to that problem. Never leave a plan line unattached to a problem, and give every assessed problem either an action or an explicit 'no change'.\n\n" +
    "State a side for every paired structure, or mark the diagnosis midline, central, or axial when it genuinely is - central canal stenosis, discogenic pain, and midline compression fracture are correctly sideless. Never infer a side from elsewhere in the note and never supply one the source lacks; an undocumented side is a query to the author, not a guess. Name spinal levels as levels, and for facet and medial branch work name the medial branches, not only the joint.\n\n" +
    "Carry a baseline pain score and a functional measure or concrete deficit for the treated problem. Prescriptions carry drug, strength, route, frequency, indication, quantity, and refills; 'continue current regimen as listed' is fine, 'adjust gabapentin' is not. For opioids state total daily MME (never for buprenorphine; with a nonlinearity caveat for methadone), the PDMP query date and its actual finding, the UDS status and interpretation, the risk assessment and agreement status, and the naloxone decision; when a benzodiazepine is co-prescribed state the combined risk and the coordination. A taper states a rate and a reassessment point - never a bare abrupt stop of long-term therapy.\n\n" +
    "Before a first procedure, document the conservative trial as modality plus duration plus outcome. Before a repeat, give the percent and duration of relief from the prior identical procedure. Before radiofrequency neurotomy, give the two diagnostic medial branch blocks with their percent relief and concordance. Every procedure plan states name, level or joint, side, image-guidance modality, injectate class, diagnostic versus therapeutic intent, and the shared decision-making discussion - formal consent belongs to the day-of-service note. Cervical transforaminal injections use non-particulate corticosteroid; never triamcinolone, Kenalog, methylprednisolone, or Depo-Medrol. When an anticoagulant or antiplatelet is on board, state the hold or continue decision, the interval, the clearing prescriber, and the resumption plan. Imaging orders state modality, region, side, contrast status, and the clinical question. Counsel on glycemic effects when a steroid is planned in diabetes.\n\n" +
    "Close with a one-line MDM statement naming problems addressed with status, data reviewed and analyzed (name the study when claiming independent interpretation, name the professional when claiming external discussion), and the risk driver - plus total time on the date of service only if the level is time-based. Then Follow-Up as a concrete interval or defined trigger, then Return Precautions naming plan-specific symptoms with the matching action level, then the signature with credentials and a teaching-physician attestation if a trainee contributed.\n\n" +
    "First-person attending voice is correct and expected. Never write model self-reference, summary framing, unquantified conservative-care or response claims, generic safety-netting, or any dose, level, side, percent, duration, MME, lab, or imaging value not supported by the source. Fabricating a number to satisfy a completeness rule outranks every other failure here.";

  CONTRACTS[T_PE] =
    "THE TEMPLATE IS AUTHORITATIVE FOR STRUCTURE. Reproduce the practice's ROS and PE headings verbatim and in order. Either region-first or element-first PE organization is acceptable; apply one consistently.\n\n" +
    "Document only what was actually reviewed and actually performed. Every ROS system you name carries a pertinent positive or an explicit denial. Do not pad a 14-system ROS or a head-to-toe exam onto a brief interval follow-up - history and exam no longer drive the code level, so scope inflation is pure liability. Any element the template calls for that was not done is stated as not done with a reason: 'Reflexes deferred; patient unable to relax due to acute spasm.' Never fill a field with an invented normal.\n\n" +
    "Route the red-flag screen by region. Lumbosacral: bowel and bladder plus saddle anesthesia, and progressive weakness, fever, weight loss, or malignancy history. Cervical or thoracic: the myelopathy screen - hand clumsiness, dropping objects, buttons or handwriting, gait or balance change, urinary urgency, Lhermitte - with Hoffmann, Babinski, clonus, Romberg, and tandem gait as the exam companions. Saddle anesthesia is never templated into a neck complaint. A catch-all ('no red flags', 'ROS negative') does not satisfy the requirement.\n\n" +
    "In the exam: describe inspection with region-specific content, and for any pre-procedure note inspect the planned entry site for erythema, induration, rash, or breakdown. Localize palpation to a named structure or level with a side; for facet candidacy document paravertebral or facet-loading tenderness and state explicitly whether radicular findings are present. Give ROM in degrees or percent of normal with pain reproduction labeled concordant or non-concordant. Grade strength MRC 0-5 by myotome with laterality - 4+/5 and 4-/5 are valid - or write the honest screening statement ('5/5 throughout the bilateral lower extremities') when a screening exam is what you did, and never inflate that into a per-muscle table. Grade reflexes by named reflex with side comparison. State sensory modality and dermatome, or 'grossly intact to light touch' as an explicit screen. Every named special test carries a result and a side; for SI candidacy state how many of the provocation maneuvers were positive. Describe gait and station early, with assistive device. Screen the hip and, when claudication is plausible, distal pulses, in any buttock, thigh, or lumbar radicular complaint. Give a pain score on a named scale for the target region and a functional measure. For a repeat block, give the prior procedure, date, percent relief, and duration. Close with one plain sentence saying whether the findings support the planned target.\n\n" +
    "For a pre-procedure or day-of note, carry a labeled safety block: anticoagulant or antiplatelet with agent, last dose, and hold plan or explicit none; infection and fever screen; allergies by agent including contrast, local anesthetic class, and latex; pregnancy status when fluoroscopy is planned in a patient of childbearing potential; recent glucose or A1c when a steroid is planned in diabetes; ASA class and NPO when sedation is planned; and confirmation that the exam side and level match the consented target. For a day-of update, state that the H&P was reviewed, the patient re-examined, and either no interval change or the specific change, dated and signed.\n\n" +
    "Telegraphic clinical fragments are correct - do not force full sentences. Standard abbreviations (TTP, SLR, ROM, DTRs, BUE/BLE, EHL, FABER, Spurling's) are used bare. First-person clinician voice is required in teaching-physician and split/shared attestations. Never invent a maneuver, grade, ROM value, reflex, or score; never carry an exam forward verbatim; never contradict the HPI, the plan, or the consent; never document a pelvic, breast, rectal, or genitourinary exam in a spine encounter; never use stigmatizing language or frame Waddell signs as malingering.";

  CONTRACTS[T_SOAP] =
    "THE TEMPLATE IS AUTHORITATIVE FOR STRUCTURE. Reproduce the practice's SOAP headings verbatim and in order; this contract governs content within them.\n\n" +
    "Open with date and time of service, encounter modality (in-person, or telehealth with audio-video versus audio-only and the patient's location), visit type, a one-line chief complaint naming the condition and laterality, and allergies including NKDA.\n\n" +
    "SUBJECTIVE. Lead with interval history: what changed since the last visit, new symptoms, ED or urgent-care visits, falls, injuries, new prescribers. Then response to the last treatment anchored to a prior value and date: 'Pain today 4/10, improved from 7/10 at the 8/11/2026 visit.' State relief from any procedure as percent AND duration together, and for a diagnostic block say whether the relief occurred during the local anesthetic phase and was concordant. Give function in observable, comparable terms tied to the patient's goals. List every controlled substance in full - drug, strength, route, frequency, quantity, refills - and incorporate non-controlled medications by explicit reference to a list reconciled today. Carry a visit-specific risk block that names its sources: PDMP query date and its actual finding, UDS date with interpretation or an explicit pending or not-yet-due status, pill count, agreement status, naloxone status. State total daily MME for full-agonist regimens; never convert buprenorphine; caveat methadone as nonlinear. State the benefit-versus-harm reassessment in the patient's own functional terms.\n\n" +
    "OBJECTIVE. Vitals or an explicit deferral with a reason. A focused regional exam with laterality or explicit midline and quantified findings: ROM in degrees, strength by myotome, named provocative tests with side and result, reflexes, sensation by dermatome, gait. Say which findings were re-performed today versus referenced from a prior exam. Then data reviewed this visit, distinguishing your own independent interpretation of images from reading someone else's report, and naming and dating any discussion with an external physician.\n\n" +
    "ASSESSMENT. One item per active problem with diagnosis, laterality, level or joint, and a status word from: improved/improving, stable/unchanged/well-controlled, worsening/progressive, exacerbation/flare, refractory, resolved/resolving, newly diagnosed, chronic, recurrent. Then a one-line MDM statement naming problems, data, and risk.\n\n" +
    "PLAN. Cover every assessed problem with an action or an explicit no-change. Medication actions carry a rationale. Name interventional targets by the structure actually treated - 'right L3 and L4 medial branch blocks targeting the right L4-L5 facet joint', not 'right L4-L5 medial branch block'. Every planned procedure states laterality, level or joint, approach, image guidance, and indication. Address anticoagulants before any neuraxial or deep procedure with a hold interval, coordinating prescriber, and date. Document the risks, benefits, and alternatives discussion. State the leveling basis exactly once: an MDM statement, or total time on the DATE OF THE ENCOUNTER with a minute count - never '>50% of the visit in counseling', which was retired for office E/M in 2021. Close with a follow-up interval or event anchor and return precautions naming specific red-flag symptoms, then the signature with credential, date, time, and a scribe or teaching-physician attestation where applicable.\n\n" +
    "Never write stigmatizing substance-use language ('dirty urine', 'addict', 'drug-seeking', 'noncompliant'), vague filler as the entire response-to-treatment statement, 'continue current management' as the whole plan for a controlled-substance patient, an MME ceiling framed as a hard cutoff, a percent without a duration, a PDMP or UDS 'reviewed' with no finding, a status word contradicting the recorded data, or any invented vital, dose, date, or result. Do not reproduce a prior visit's exam or risk paragraph with unchanged numbers.";

  CONTRACTS[T_TPL] =
    "THIS CONTRACT IS APPENDED TO EVERY NOTE TYPE AND OVERRIDES ANY STYLE PREFERENCE THAT CONFLICTS WITH IT.\n\n" +
    "The doctor's template is the authority for structure. Reproduce every template heading in the note, spelled, punctuated, and capitalized exactly as the template writes it, in the template's order. Do not rename ('ASSESSMENT/PLAN:' does not become 'Assessment and Plan'), do not merge, split, drop, or reorder, and do not add any section the template does not contain. Where the template marks a block repeatable, instantiate it once per level, side, or procedure actually performed, keeping the instances contiguous and each instance internally in the template's order. Within a section, follow the template's own sub-heading and list order.\n\n" +
    "Reproduce every fixed template sentence character-for-character. Do not modernize it, condense it, clean it up, or rephrase it, and never alter a negation or quantifier - 'no', 'not', 'none', 'never', 'without', 'negative', 'denies', 'absent' must survive exactly. The doctor chose that wording and it carries the medico-legal weight.\n\n" +
    "Resolve every slot. A slot is filled with a value that has a real source, or with the practice's canonical not-addressed marker where the section permits it, or it is flagged as held for physician entry. Never leave a literal placeholder - no [BRACKETS], {{braces}}, <<angles>>, @TOKENS@, runs of asterisks or underscores, TBD, or TODO - and never silently delete a slot to hide that content is missing. A bare 'N/A' against a genuinely inapplicable field is legitimate charting, but it may never occupy a required-affirmative field.\n\n" +
    "Source discipline. Patient name, DOB, MRN, date of service, and performing provider come from the chart and encounter metadata, never from transcript text, even when the transcript happens to be right. Every other filled value traces to a transcript span, chart data, a structured order, a device record, or the template's own fixed text. Fluoroscopy time and radiation dose, sedation start and stop and intraservice time, contrast volume, needle gauge, vital signs, estimated blood loss, and pain scores are filled only from recorded values - if nobody recorded one, hold it for the physician and write nothing plausible in its place.\n\n" +
    "Attestations are never auto-filled. Consent obtained, time-out performed, site marked or verified, physician presence or supervision, sedation monitoring, and patient tolerance may be rendered only when the source affirmatively says so. If the source is silent, the note stops and asks the physician - it does not default the sentence, does not paraphrase around it, and does not quietly mark it not-addressed.\n\n" +
    "Required safety elements outrank template convenience in one direction only: a template that omits a required element is a template defect to surface to the practice, never a license to omit it and never a license to invent the section. A constrained slot is filled from its own option list or with the configured not-applicable escape plus a template-defect report - never with a forced wrong answer such as picking a side for a midline procedure.\n\n" +
    "Internal consistency: one laterality and one level string per anatomic reference throughout, and the levels and sides enumerated in header slots must reconcile with the levels and sides described in the technique narrative and with any code slot. Template author-facing instructions - '(dictate findings here)', 'choose one', 'if applicable' - never appear in the output, literally or as prose paraphrase such as 'details as described above'.\n\n" +
    "Do not reuse another encounter's variable content. Once the template's fixed text is set aside, what remains must be this patient, this day, this procedure. Output the note unsigned, in draft status, with the signature and cosign block unexecuted; any addendum appends below the signature and never edits text above it.";

  /* noteq-1.0.0 (b1169): the precedence clause is appended to EVERY contract.
   * It is the spec's own law and it is what keeps a completeness rule from
   * becoming a licence to fabricate. */
  var PRECEDENCE =
    "PRECEDENCE, IN THIS ORDER, AND IT IS NOT NEGOTIABLE: (1) the practice's template and the physician's own edits; (2) the governing payer LCD/LCA; (3) the cited national standards; (4) this contract. Where they conflict, the template and the physician win. Every requirement above is a prompt to document what actually happened - never authority to invent a clinical fact. If a required value is not in the source, write 'not documented' or the practice's not-addressed marker and leave it for the physician. Fabricating a number, a laterality, a level, or an attestation to satisfy a completeness rule is the single worst failure available to you and outranks every other rule here.";

  /* noteq-1.0.0 (b1169): the template-structure clause. Appended whenever a
   * template is in play - which is the owner's second ask: "the notes still
   * need to follow the templates too". */
  var TEMPLATE_LAW =
    "TEMPLATE STRUCTURE WINS. Every section and every field the template defines must appear in the output, spelled and capitalized exactly as the template writes it, in the template's order. A section is never dropped, never renamed, never merged, never reordered, and no section is ever added that the template does not contain. A field with nothing to say is filled with the practice's not-addressed marker or explicitly marked 'not applicable' - it is never silently omitted and never left as a placeholder.";

  /* noteq-1.0.0 (b1169): forbidden patterns stated in prose for the prompt.
   * The machine-checked forms live in the FORBIDDEN table further down; this
   * is the half the model reads. */
  var FORBIDDEN_LAW =
    "NEVER EMIT: unfilled placeholders of any syntax ([brackets], {{braces}}, <<angles>>, @TOKENS@, runs of underscores or asterisks, TBD, TODO, 'to be dictated'); template authoring instructions or prose paraphrases of them ('as described above', 'per template', 'insert findings'); AI or authoring voice ('as an AI', 'based on the transcript provided', 'Here is', 'In summary'); transcript artifacts (speaker labels such as 'Doctor:' or 'Patient:', [inaudible], [crosstalk], timestamps); stigmatizing language ('drug-seeking', 'addict', 'abuser', 'malingering', 'noncompliant patient', 'dirty urine', 'clean urine'); the retired '>50% of the visit in counseling' leveling construct; and the Do Not Use abbreviations - a bare U or IU for units, QD, QOD, MS, MSO4, MgSO4. Write a leading zero before every decimal (0.5 mL, never .5 mL) and never a trailing zero (1 mg, never 1.0 mg).";

  /* =========================================================================
   * NOTE-TYPE RESOLUTION
   * The app names its lanes 'soap', 'opnote', 'avs', 'hpi', 'assessment' and
   * a dozen other spellings. One tolerant resolver maps them all onto the six
   * rubric ids, because an unrecognised type must still be graded against
   * something rather than silently skipped.
   * ========================================================================= */
  function normalizeType(t) {
    var s = String(t == null ? '' : t).toLowerCase().replace(/[^a-z]+/g, '');
    if (!s) return T_SOAP;
    if (ALL_TYPES.indexOf(String(t)) >= 0) return String(t);
    if (/^(op|opnote|operative|operativeprocedurenote|procedurenote|operativereport|proc|opprep|injection)/.test(s)) return T_OP;
    if (/^(hpi|historyofpresentillness|subjective|history|interval)/.test(s)) return T_HPI;
    if (/^(ap|anp|assessment|plan|assessmentplan|assessmentandplan|impression|impressionandplan)/.test(s)) return T_AP;
    if (/^(ros|pe|exam|physical|physicalexam|physicalexamination|rospe|reviewofsystems|objective)/.test(s)) return T_PE;
    if (/^(templatefidelity|template|tpl|reformat|templatereformat)/.test(s)) return T_TPL;
    /* avs is patient-facing prose with no rubric of its own; the SOAP rubric
     * is the closest honest fit and its warn tier is what actually applies. */
    return T_SOAP;
  }

  function floor(noteType) {
    var t = normalizeType(noteType);
    return Object.prototype.hasOwnProperty.call(FLOORS, t) ? FLOORS[t] : DEFAULT_FLOOR;
  }

  /* =========================================================================
   * contractFor(noteType, opts)
   * opts: { template, templateName, procedureClass, subtype, findings,
   *         compact, includeTemplateLaw }
   * ========================================================================= */
  function contractFor(noteType, opts) {
    opts = opts || {};
    var t = normalizeType(noteType);
    var parts = [];
    parts.push('=== MLS PROFESSIONAL NOTE CONTRACT (' + VERSION + ', ' + t + ') ===');
    parts.push(CONTRACTS[t] || CONTRACTS[T_SOAP]);

    /* The template clause rides on whenever a template is actually in play,
     * and the cross-cutting template-fidelity contract with it. */
    var tpl = (typeof opts.template === 'string') ? opts.template : '';
    if (tpl && tpl.replace(/\s+/g, '') !== '') {
      parts.push(TEMPLATE_LAW);
      if (t !== T_TPL) parts.push(CONTRACTS[T_TPL]);
      var heads = headingsOf(tpl);
      if (heads.length) {
        var names = [];
        for (var i = 0; i < heads.length && i < 60; i++) names.push(heads[i].label);
        parts.push('THE BOUND TEMPLATE' + (opts.templateName ? " ('" + String(opts.templateName).replace(/[\r\n]+/g, ' ').slice(0, 80) + "')" : '') +
          ' DEFINES EXACTLY THESE SECTIONS, IN THIS ORDER. Every one must appear in your output, spelled exactly as written here, none added, none dropped, none reordered:\n' +
          names.join('\n'));
      }
    } else if (opts.includeTemplateLaw !== false) {
      parts.push(TEMPLATE_LAW);
    }

    if (opts.procedureClass) {
      parts.push('PROCEDURE CLASS FOR THIS NOTE: ' + String(opts.procedureClass).slice(0, 60) +
        '. Apply every class-conditional requirement above that this class triggers.');
    }
    if (opts.subtype) {
      parts.push('NOTE SUBTYPE: ' + String(opts.subtype).slice(0, 60) +
        '. Honour the subtype thresholds above rather than a generic length target.');
    }

    parts.push(FORBIDDEN_LAW);
    parts.push(PRECEDENCE);

    /* Regeneration pass: the findings are quoted back verbatim, and the pass
     * is bounded to repair only. This is the spec's own feedbackTemplate. */
    if (opts.findings) {
      var f = renderFindings(opts.findings);
      if (f) {
        parts.push('REGENERATION PASS 1 of 1. The prior draft failed automated review. Regenerate the SAME note from the SAME source material; do not add, infer, or supply any clinical fact that was not in the source. The template remains authoritative for structure - reproduce its headings verbatim, in order, with its fixed sentences character-for-character.\n\nFAILURES TO REPAIR:\n' + f +
          '\n\nRULES FOR THIS PASS:\n' +
          '1. Repair ONLY the listed failures. Do not rewrite passing content, do not restyle, do not add sections.\n' +
          '2. If a repair would require a value not present in the transcript, chart context, order, or device record, write the practice\'s not-addressed marker or "not documented" - never a plausible number.\n' +
          '3. Do not change any laterality, level, dose, date, or agent to make a check pass. If a check flags a contradiction, write only what the source supports and leave the rest for physician entry.\n' +
          '4. Do not add "None", "No complications", or any negative that the source does not support.\n' +
          '5. Preserve every negation in template boilerplate exactly.\n' +
          '6. Output the complete corrected note, unsigned, in draft status.');
      }
    }
    return parts.join('\n\n');
  }

  /* noteq-1.0.0 (b1169): the findings block quoted into the repair prompt. */
  function renderFindings(res) {
    if (!res || typeof res !== 'object') return '';
    var lines = [];
    var i;
    var miss = res.missing || [];
    for (i = 0; i < miss.length && i < 40; i++) {
      lines.push('- [' + (miss[i].severity || 'block') + '] ' + miss[i].id + ': ' + miss[i].label +
        (miss[i].why ? ' Required repair: ' + miss[i].why : ''));
    }
    var forb = res.forbidden || [];
    for (i = 0; i < forb.length && i < 40; i++) {
      lines.push('- [forbidden] ' + forb[i].id + ': ' + forb[i].label +
        (forb[i].excerpt ? ' Offending text: "' + forb[i].excerpt + '"' : '') + ' Remove it.');
    }
    var gaps = res.templateGaps || [];
    for (i = 0; i < gaps.length && i < 40; i++) {
      lines.push('- [template] ' + gaps[i].kind + ': "' + gaps[i].heading + '". ' + (gaps[i].why || ''));
    }
    return lines.join('\n');
  }

  /* =========================================================================
   * TEXT PREFLIGHT - the spec's normalize-and-mask and segment-and-classify.
   * Without the mask, 'L4' satisfies a reflex-grade check and '4/5/2026'
   * satisfies a strength check. Every numeric check runs on the masked copy.
   * ========================================================================= */
  var RE_LEVEL_G = /\b[CTLS]\s?\d{1,2}(\s?[-\/]\s?[CTLS]?\d{1,2})?\b/g;
  /* noteq-1.0.0 (b1169): the date mask requires the YEAR component.
   * The spec masks /\d{1,2}\/\d{1,2}(\/\d{2,4})?/ - but that two-part form is
   * exactly the shape of a pain score, so it swallows "6/10" and "7/10" and
   * every pain-severity check then fails on a note that documented severity
   * perfectly. Masking only the dated form (08/28/2026) keeps the property the
   * mask exists for - a date can never masquerade as a score, and "4/5/2026"
   * can never satisfy a strength check - without eating the scores. */
  var RE_DATE_G = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;
  var RE_UNIT_G = /\b\d+(\.\d+)?\s?(mg|mcg|ug|g|mL|ml|cc|units?|Fr|G)\b/gi;

  function maskOf(text) {
    return String(text || '')
      .replace(RE_LEVEL_G, 'LEVELTOK')
      .replace(RE_DATE_G, 'DATETOK')
      .replace(RE_UNIT_G, 'UNITTOK');
  }

  /* A heading is a short, capitalised, line-anchored label - either standing
   * alone or introducing an inline 'LABEL: value'. One detector, applied to
   * both the template and the note, is what makes the comparison meaningful. */
  function isHeadingish(lab) {
    if (!lab) return false;
    var s = lab.trim();
    if (!s || s.length > 60) return false;
    var words = s.split(/\s+/);
    if (words.length > 8) return false;
    if (/^[A-Z0-9 \/&'()\-,.#]+$/.test(s) && /[A-Z]/.test(s)) return true;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (/^(of|and|the|to|for|in|on|with|a|an|or|per|by)$/i.test(w)) continue;
      if (!/^[A-Z(]/.test(w)) return false;
    }
    return /[A-Za-z]/.test(s);
  }

  function headingsOf(text) {
    var out = [];
    var lines = String(text || '').split(/\r?\n/);
    var offset = 0;
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var s = raw.replace(/\s+/g, ' ').trim();
      s = s.replace(/^#{1,6}\s*/, '').replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '');
      s = s.replace(/^_{1,2}\s*/, '').replace(/\s*_{1,2}$/, '');
      if (s) {
        var m = s.match(/^([A-Za-z][A-Za-z0-9 \/&'()\-,.#]{0,58}?)\s*:\s*(.*)$/);
        if (m && isHeadingish(m[1])) {
          out.push({ label: m[1].trim(), rest: m[2] || '', line: i, offset: offset, inline: true });
        } else if (s.length <= 60 && !/[.!?]$/.test(s) && isHeadingish(s)) {
          out.push({ label: s, rest: '', line: i, offset: offset, inline: false });
        }
      }
      offset += raw.length + 1;
    }
    return out;
  }

  /* Section bodies: everything from a heading up to the next heading. */
  function sectionsOf(text) {
    var lines = String(text || '').split(/\r?\n/);
    var heads = headingsOf(text);
    var map = {};
    var list = [];
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var endLine = (i + 1 < heads.length) ? heads[i + 1].line : lines.length;
      var body = [];
      if (h.inline && h.rest) body.push(h.rest);
      for (var j = h.line + 1; j < endLine; j++) body.push(lines[j]);
      var entry = { label: h.label, key: normHead(h.label), body: body.join('\n').trim(), line: h.line };
      list.push(entry);
      if (!map[entry.key]) map[entry.key] = entry;
    }
    return { list: list, map: map };
  }

  function normHead(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().replace(/[:\s]+$/, '').toUpperCase();
  }

  /* A clinical sentence splitter that does not break on decimals, 'Dr.',
   * credentials, or level tokens. */
  function sentencesOf(text) {
    var t = String(text || '')
      .replace(/\b(Dr|Mr|Mrs|Ms|Prof|St|Jr|Sr|vs|approx|No)\./gi, '$1<DOT>')
      .replace(/\b([A-Z])\.(?=\s*[A-Z]\.)/g, '$1<DOT>')
      .replace(/\b(M|D|N|P|R)\.(?=\s?[A-Z]\.?)/g, '$1<DOT>')
      .replace(/(\d)\.(\d)/g, '$1<DOT>$2');
    var parts = t.split(/(?:[.!?]+["')\]]*\s+|\n{2,})/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].replace(/<DOT>/g, '.').trim();
      if (s) out.push(s);
    }
    return out;
  }

  function wordCount(s) {
    var m = String(s || '').trim().match(/[A-Za-z0-9][A-Za-z0-9'\/-]*/g);
    return m ? m.length : 0;
  }

  function has(re, s) { return re.test(String(s || '')); }

  function firstMatch(re, s) {
    var m = String(s || '').match(re);
    return m ? String(m[0]).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  }

  /* Distance-bounded co-occurrence: token B within N characters of token A. */
  function near(text, reA, reB, window) {
    var s = String(text || '');
    var ra = new RegExp(reA.source, reA.flags.indexOf('g') >= 0 ? reA.flags : reA.flags + 'g');
    var m;
    ra.lastIndex = 0;
    while ((m = ra.exec(s)) !== null) {
      var start = Math.max(0, m.index - window);
      var end = Math.min(s.length, m.index + m[0].length + window);
      if (reB.test(s.slice(start, end))) return true;
      if (m.index === ra.lastIndex) ra.lastIndex++;
    }
    return false;
  }

  /* noteq-1.0.0 (b1169): procedure-class detection, used only to decide which
   * conditional checks apply. An undetected class means the class-conditional
   * checks SKIP - they never fire speculatively. */
  function procClassOf(text, ctx) {
    if (ctx && ctx.procedureClass) return String(ctx.procedureClass);
    var s = String(text || '');
    var head = s.slice(0, 2500);
    if (/\bradiofrequency\b|\bRFA\b|\bneurotomy\b|\brhizotomy\b|\bablation\b/i.test(head)) {
      return /genicular/i.test(head) ? 'genicular-RFA' : 'RFA-facet';
    }
    if (/transforaminal|TFESI|selective nerve root/i.test(head)) return 'ESI-TF';
    if (/interlaminar|\bILESI\b|caudal epidural|epidural steroid/i.test(head)) return 'ESI-IL';
    if (/lateral branch/i.test(head)) return 'SIJ-lateral-branch';
    if (/sacroiliac|\bSI joint\b|\bSIJ\b/i.test(head)) return 'SIJ-IA';
    if (/medial branch block|\bMBB\b|medial branch/i.test(head)) return 'MBB';
    if (/genicular/i.test(head)) return 'genicular-block';
    if (/trigger point|\bTPI\b/i.test(head)) return 'TPI';
    if (/facet|zygapophys|intraarticular facet/i.test(head)) return 'facet-IA';
    if (/knee|shoulder|hip|glenohumeral|subacromial|arthrocentesis|large joint/i.test(head)) return 'large-joint';
    return '';
  }

  var NEEDLE_CLASSES = ['facet-IA', 'MBB', 'RFA-facet', 'ESI-IL', 'ESI-TF', 'SIJ-IA', 'SIJ-lateral-branch', 'large-joint', 'genicular-block', 'genicular-RFA'];
  var GUIDED_CLASSES = ['facet-IA', 'MBB', 'RFA-facet', 'ESI-IL', 'ESI-TF', 'SIJ-IA', 'SIJ-lateral-branch', 'genicular-block', 'genicular-RFA'];
  var NEURAXIAL_CLASSES = ['ESI-IL', 'ESI-TF'];
  var LENGTH_FLOOR = {
    'RFA-facet': 220, 'genicular-RFA': 220,
    'ESI-TF': 180, 'ESI-IL': 180, 'MBB': 180, 'facet-IA': 180, 'SIJ-IA': 180, 'SIJ-lateral-branch': 180,
    'large-joint': 120, 'genicular-block': 120,
    'TPI': 100
  };

  function inList(v, list) { return list.indexOf(v) >= 0; }

  /* =========================================================================
   * FORBIDDEN PATTERNS - boilerplate, dangerous abbreviations, trailing-zero
   * doses, AI voice, transcript leakage, stigmatizing language.
   * Every one of these is a literal regex ported from the spec. A hit is
   * reported with the offending excerpt so the physician can see exactly what
   * fired rather than being told "quality issue".
   * ========================================================================= */
  var NOT_ADDRESSED = /^(n\/a|not applicable|not addressed|none|not performed|not assessed|deferred|not documented)\.?$/i;
  var PLACEHOLDER_OK = /^\[(mg\/dL|mg\/dl|REDACTED|sic|mL|cc|%|\d+\]?)\]?$/i;

  var FORBIDDEN = [
    {
      id: 'placeholder-leak', sev: 'block', types: ALL_TYPES,
      re: /\[[^\]\n]{1,80}\]|\{\{[^}]+\}\}|<<[^>]+>>|@[A-Z][A-Z0-9_]{1,40}@|\*{3,}|\bTBD\b|\bTODO\b|_{3,}|\bto be dictated\b/gi,
      keep: function (hit) {
        var s = String(hit).trim();
        if (PLACEHOLDER_OK.test(s)) return false;
        if (NOT_ADDRESSED.test(s.replace(/^[\[<{]+|[\]>}]+$/g, ''))) return false;
        return true;
      },
      label: 'An unfilled template placeholder reached the note. Every slot must carry a value, the practice\'s not-addressed marker, or a hold flag.'
    },
    {
      id: 'instructional-meta-leak', sev: 'block', types: ALL_TYPES,
      re: /\binsert (findings|details|text)\b|\bper template\b|\bto be dictated\b|\bdictate (findings|here)\b|\b(details|findings|technique)?\s*(as )?(described|documented|noted)\s+(above|below|elsewhere)\b|\(choose one\)|\(if applicable\)/gi,
      label: 'Template authoring instructions, or a paraphrase of them, appear as clinical content.'
    },
    {
      id: 'no-ai-self-reference-or-meta', sev: 'block', types: ALL_TYPES,
      re: /\bas an (AI|assistant|language model)\b|\bAI (language )?model\b|\bI have generated\b|based on the (transcript|recording|conversation|audio)( provided)?|\bin the (audio|recording)\b|\bthe (transcript|recording) (does not|doesn't|did not)\b|\bI (cannot|can't|am unable to) (determine|examine|physically)\b|\bI do not have access\b|^(Here is|Here's|Summary:|In summary,|Overall,|To summarize)/gim,
      label: 'AI or authoring voice reached the note. First-person clinician voice is fine; model self-reference and transcript commentary are not.'
    },
    {
      id: 'transcript-artifact-leak', sev: 'block', types: ALL_TYPES,
      /* noteq-1.0.0 (b1169): a speaker label is followed by CONVERSATIONAL
       * prose, which starts lowercase. The spec's bare /patient\s*:/i also
       * matches the legitimate header field "PATIENT: Doe, Jane" that every
       * operative note begins with, so the lowercase-continuation requirement
       * is what separates a transcript leak from a chart header. */
      /* NOT case-insensitive, deliberately: under /i the [a-z] continuation
       * class also matches "D" of "PATIENT: Doe, Jane" and the chart header is
       * flagged as a transcript leak. The label alternation carries both cases
       * explicitly instead. */
      re: /(^|\n)[ \t]*([Dd]octor|[Dd]r\.?|[Pp]atient|[Ii]nterviewer|[Cc]linician|[Pp]rovider|DOCTOR|PATIENT|CLINICIAN|PROVIDER)\s*:\s*[a-z]|\[\d{1,2}:\d{2}|\[(inaudible|crosstalk|unintelligible|laughter|background noise|INAUDIBLE|CROSSTALK|UNINTELLIGIBLE)\]|\b[Ss]peaker\s*\d\b|\bSPEAKER\s*\d\b/g,
      label: 'Raw transcript artifacts (speaker labels, timestamps, or ASR markers) reached the note.'
    },
    {
      id: 'stigmatizing-language', sev: 'block', types: [T_HPI, T_AP, T_PE, T_SOAP],
      re: /\b(drug[- ]seeking|narcotic[- ]seeking|med[- ]seeking|malinger(ing|er)?|symptom magnificat\w*|drug abuser|abuser|addict|junkie|difficult patient|frequent flyer|poor historian|noncompliant patient)\b|\b(dirty|clean)\s+(urine|UDS|UDT|screen|tox)\b/gi,
      label: 'Stigmatizing language appears in a note the patient can read the day it is signed. Use neutral, factual phrasing.'
    },
    {
      id: 'do-not-use-trailing-zero', sev: 'block', types: ALL_TYPES,
      re: /\b\d+\.0+\s*(mg|mcg|g|mL|cc|units?)\b/gi,
      label: 'A trailing-zero dose appears (Joint Commission Do Not Use list): write 1 mg, never 1.0 mg.'
    },
    {
      id: 'do-not-use-naked-decimal', sev: 'block', types: ALL_TYPES,
      re: /(^|[^\d.])(\.\d+\s*(mg|mcg|g|mL|cc)\b)/gi,
      label: 'A dose is written without its leading zero (Joint Commission Do Not Use list): write 0.5 mL, never .5 mL.'
    },
    {
      id: 'do-not-use-abbreviations', sev: 'warn', types: ALL_TYPES,
      re: /\b\d+\s*U\b|\bIU\b|\bQ\.?D\.?\b|\bQOD\b|\bMSO4\b|\bMgSO4\b|\bMS\s+(?=\d)/g,
      label: 'An error-prone abbreviation from the Do Not Use list appears (U, IU, QD, QOD, MS, MSO4, MgSO4). Write the word out.'
    },
    {
      id: 'retired-counseling-construct', sev: 'block', types: [T_SOAP, T_AP],
      re: /(more than half|more than 50\s?%|>\s?50\s?%|majority of (the )?(time|visit))[^.]{0,60}(counsel|coordinat)/gi,
      label: 'The visit level uses the retired ">50% counseling" construct, eliminated for office E/M on 1/1/2021.'
    }
  ];

  function runForbidden(env) {
    var out = [];
    for (var i = 0; i < FORBIDDEN.length; i++) {
      var F = FORBIDDEN[i];
      if (!inList(env.type, F.types)) continue;
      var re = new RegExp(F.re.source, F.re.flags);
      re.lastIndex = 0;
      var m, seen = {}, n = 0;
      while ((m = re.exec(env.text)) !== null) {
        var hit = String(m[0]).replace(/\s+/g, ' ').trim();
        if (F.keep && !F.keep(hit)) { if (m.index === re.lastIndex) re.lastIndex++; continue; }
        if (!seen[hit.toLowerCase()]) {
          seen[hit.toLowerCase()] = 1;
          out.push({ id: F.id, severity: F.sev, label: F.label, excerpt: hit.slice(0, 60) });
          n++;
        }
        if (m.index === re.lastIndex) re.lastIndex++;
        if (n >= 6) break;
      }
    }
    return out;
  }

  /* =========================================================================
   * CHECK REGISTRY
   * { id, sev, types, need(env) -> applicable?, run(env) -> pass?, label, why }
   * A check whose `need` returns false is SKIPPED and counts in neither the
   * numerator nor the denominator - the spec's conditional-on-procedure-class
   * discipline. A check that cannot be evaluated for want of data returns
   * null from `need` and is likewise skipped.
   * ========================================================================= */
  var CHECKS = [];
  function chk(o) { CHECKS.push(o); }

  /* ---------- universal structure ---------- */
  chk({
    id: 'template-headers-present-and-ordered', sev: 'block', types: ALL_TYPES,
    need: function (e) { return !!e.tplHeads && e.tplHeads.length > 0; },
    run: function (e) { return e.gaps.length === 0; },
    label: 'A template section is missing, renamed, reordered, or an unrequested section was added.',
    why: 'Reproduce every template heading verbatim and in the template\'s order; add none.'
  });

  chk({
    id: 'boilerplate-negation-intact', sev: 'block', types: ALL_TYPES,
    need: function (e) { return !!e.tplText && e.protectedLines.length > 0; },
    run: function (e) { return e.negationBreaks.length === 0; },
    label: 'Fixed template wording was altered, or a negation was changed or dropped.',
    why: 'Reproduce the template\'s fixed sentences character-for-character, negations intact.'
  });

  /* ---------- operative / procedure note ---------- */
  chk({
    id: 'op.header', sev: 'block', types: [T_OP],
    run: function (e) {
      var head = e.text.slice(0, 1800);
      return has(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i, head) &&
        has(/\b([01]?\d|2[0-3]):[0-5]\d\s*(AM|PM|hrs|hours)?\b/i, head) &&
        has(/\b(M\.?D\.?|D\.?O\.?|N\.?P\.?|P\.?A\.?-?C|APRN|DNP|DPM)\b/, head);
    },
    label: 'Header is missing the date, the time of procedure, or the proceduralist with credentials.',
    why: 'State date AND clock time of the procedure, the facility, and the proceduralist with credentials.'
  });

  chk({
    id: 'op.dx', sev: 'block', types: [T_OP],
    run: function (e) {
      return has(/pre-?(procedure|operative)\s*diagnosis/i, e.text) &&
        has(/post-?(procedure|operative)\s*diagnosis/i, e.text);
    },
    label: 'Pre-procedure and post-procedure diagnosis are not both stated.',
    why: 'State both, with level and laterality. "Same" is a valid post-procedure value.'
  });

  chk({
    id: 'op.name-laterality-guidance', sev: 'block', types: [T_OP],
    run: function (e) {
      var head = e.text.slice(0, 2500);
      var lat = has(/\b(left|right|bilateral|bilat|midline|axial|central)\b/i, head);
      var site = has(/\b[CTLS]\d{1,2}\b|\b(knee|shoulder|hip|sacroiliac|glenohumeral|subacromial|trapezius|rhomboid|joint)\b/i, head);
      var guide = has(/\b(fluoroscop\w*|ultrasound|US[- ]guided|CT[- ]guided|landmark|image[- ]guided)\b/i, head);
      return lat && site && (guide || inList(e.cls, ['TPI', 'large-joint']));
    },
    label: 'The procedure name does not enumerate side, level or joint, and the guidance modality.',
    why: 'Name every level, every side, and the guidance modality, matching the billed unit of service.'
  });

  chk({
    id: 'op.indication', sev: 'block', types: [T_OP],
    run: function (e) { return has(/\b(indication|medical necessity|reason for (the )?procedure)\b/i, e.text); },
    label: 'No indication or medical-necessity statement.',
    why: 'State duration, exam/imaging correlation, failed conservative care, and prior block response.'
  });

  chk({
    id: 'timeout-itemized-and-positioned', sev: 'block', types: [T_OP],
    run: function (e) {
      if (!has(/time.?out/i, e.text)) return false;
      var items = [
        /two identifiers|patient identity|name and date of birth/i,
        /correct (site|side|level)/i,
        /correct procedure/i,
        /position/i,
        /allerg/i,
        /consent (confirmed|verified|reviewed)/i,
        /(equipment|implants?|imaging)\s+(available|displayed|verified)/i
      ];
      var n = 0;
      for (var i = 0; i < items.length; i++) if (items[i].test(e.text)) n++;
      if (n < 3) return false;
      var to = e.text.search(/time.?out/i);
      var needle = e.text.search(/(needle|cannula)[^.]{0,40}(was )?(inserted|advanced|placed|introduced)/i);
      return needle < 0 ? true : to < needle;
    },
    label: 'The time-out is missing, not itemized, or documented after needle insertion.',
    why: 'Document an itemized time-out (identity, site/side/level, procedure, position, allergies, consent) BEFORE the first needle placement.'
  });

  chk({
    id: 'consent-before-sedation', sev: 'block', types: [T_OP],
    run: function (e) {
      if (!near(e.text, /consent/i, /risk/i, 300)) return false;
      if (!near(e.text, /consent/i, /benefit/i, 300)) return false;
      if (!near(e.text, /consent/i, /alternativ/i, 300)) return false;
      var sed = e.text.search(/\b(midazolam|Versed|fentanyl|propofol|sedation was (given|administered)|moderate sedation)\b/i);
      if (sed < 0) return true;
      var con = e.text.search(/consent/i);
      return con >= 0 && con < sed;
    },
    label: 'Informed consent is missing risks, benefits and alternatives, or is documented after sedation was given.',
    why: 'State consent with risks, benefits and alternatives, obtained BEFORE any sedation.'
  });

  chk({
    id: 'denervation-names-nerves', sev: 'block', types: [T_OP],
    need: function (e) { return inList(e.cls, ['MBB', 'RFA-facet', 'SIJ-lateral-branch']); },
    run: function (e) { return has(/(medial branch|dorsal ram(us|i)|third occipital|lateral branch)/i, e.text); },
    label: 'A denervation or medial branch block does not name the nerves treated.',
    why: 'Name the medial branches and dorsal rami targeted, not only the joint.'
  });

  chk({
    id: 'cervical-transforaminal-particulate-ban', sev: 'block', types: [T_OP, T_AP, T_SOAP],
    need: function (e) {
      return (e.cls === 'ESI-TF' || has(/transforaminal|TFESI|selective nerve root/i, e.text)) &&
        has(/\bC[1-7]\b|\bC7-T1\b/, e.text);
    },
    run: function (e) {
      if (has(/(triamcinolone|Kenalog|methylprednisolone|Depo.?Medrol|betamethasone acetate|Celestone Soluspan)/i, e.text)) return false;
      return has(/(dexamethasone|betamethasone sodium phosphate|non.?particulate)/i, e.text);
    },
    label: 'Particulate corticosteroid is documented for a cervical transforaminal injection. Only non-particulate steroid is acceptable (FDA 2014).',
    why: 'Use dexamethasone or another non-particulate agent; never triamcinolone, Kenalog, methylprednisolone or Depo-Medrol.'
  });

  chk({
    id: 'diagnostic-block-purity', sev: 'block', types: [T_OP],
    need: function (e) {
      return has(/(diagnostic|comparative)\s+(medial branch\s+)?block/i, e.text) &&
        !has(/therapeutic/i, e.text.slice(0, 2000));
    },
    /* noteq-1.0.0 (b1169): the spec scopes this to the MEDICATIONS section.
     * Scanning the whole note fails the correct sentence "No corticosteroid
     * was administered", which is exactly the documentation the rule wants. */
    run: function (e) {
      var scope = e.medsText || e.text;
      var re = /(triamcinolone|Kenalog|methylprednisolone|Depo.?Medrol|dexamethasone|betamethasone|corticosteroid|steroid)\b/gi;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(scope)) !== null) {
        var before = scope.slice(Math.max(0, m.index - 30), m.index);
        if (!/\b(no|without|denies|not|zero)\b[^.]{0,20}$/i.test(before)) return false;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return true;
    },
    label: 'Corticosteroid is documented in a block described as diagnostic. A diagnostic block contains local anesthetic only.',
    why: 'Remove the steroid, or state that the block was therapeutic rather than diagnostic.'
  });

  chk({
    id: 'contrast-negative-uptake', sev: 'block', types: [T_OP],
    need: function (e) { return inList(e.cls, ['facet-IA', 'MBB', 'ESI-IL', 'ESI-TF', 'SIJ-IA', 'RFA-facet']) && has(/contrast/i, e.text); },
    run: function (e) {
      return near(e.text,
        /(intravascular|vascular|venous|arterial|intrathecal|subarachnoid|subdural|intraneural)/i,
        /(no|without|negative|absence of|free of|did not (demonstrate|show))/i, 60);
    },
    label: 'Contrast was injected but the note does not exclude vascular, intrathecal, subdural or intraneural uptake.',
    why: 'State explicitly that there was no vascular, intrathecal, subdural or intraneural uptake.'
  });

  chk({
    id: 'rfa-parameters-and-predicate', sev: 'block', types: [T_OP],
    need: function (e) { return inList(e.cls, ['RFA-facet', 'genicular-RFA']); },
    run: function (e) {
      var t = e.text;
      var ok = has(/\b(1[6-9]|2[0-7])\s*[- ]?\s*(g|ga|gauge)\b/i, t) &&
        has(/\d+\s*mm\s*(active\s*)?tip/i, t) &&
        near(t, /50\s*Hz/i, /\d+(\.\d+)?\s*(V\b|volt)/i, 120) &&
        near(t, /2\s*Hz/i, /\d+(\.\d+)?\s*(V\b|volt)/i, 120) &&
        has(/(no|without|negative|absent)[^.]{0,40}(motor|contraction|response)|multifidus/i, t) &&
        has(/\b(7\d|8\d|90)\s*(degrees?\s*)?(C\b|Celsius)/i, t) &&
        has(/\b([6-9]\d|1[0-2]\d)\s*(sec|seconds)\b/i, t);
      if (!ok) return false;
      if (e.cls === 'RFA-facet') {
        if (!has(/(two|2|both)\b[^.]{0,60}(diagnostic|medial branch|MBB|block)/i, t)) return false;
        if (!has(/\b(8\d|9\d|100)\s*%/, t)) return false;
      }
      return true;
    },
    label: 'Radiofrequency documentation is incomplete: a testing or lesion parameter, or the two prior diagnostic blocks with at least 80% concordant relief, is missing.',
    why: 'State cannula gauge, active tip length, 50 Hz sensory and 2 Hz motor thresholds with voltages and the motor response, pre-lesion anesthetic, lesion temperature and duration, and the two prior diagnostic blocks with their percent relief.'
  });

  chk({
    id: 'medication-dose-and-volume', sev: 'block', types: [T_OP, T_AP, T_SOAP],
    need: function (e) { return e.hasDrug; },
    run: function (e) {
      var conc = has(/\d+(\.\d+)?\s*(%|mg\/mL|mg per mL)/i, e.text);
      var mass = has(/\d+(\.\d+)?\s*(mg|mcg)\b/i, e.text);
      var vol = has(/\d+(\.\d+)?\s*(mL|cc)\b/i, e.text);
      if (e.type === T_OP) return (conc || mass) && vol;
      return conc || mass;
    },
    label: 'A medication is documented without its concentration, dose or volume.',
    why: 'Give every injectate its concentration, volume and computed dose; give every prescription drug, strength, route and frequency.'
  });

  chk({
    id: 'dose-arithmetic', sev: 'block', types: [T_OP, T_AP, T_SOAP],
    need: function (e) { return e.doseTriples.length > 0; },
    run: function (e) {
      for (var i = 0; i < e.doseTriples.length; i++) {
        var d = e.doseTriples[i];
        if (Math.abs(d.stated - d.computed) > Math.max(0.02 * d.computed, 0.01)) return false;
      }
      return true;
    },
    label: 'A stated dose does not match its volume and concentration. One of these numbers is wrong.',
    why: 'Recompute the dose from the volume and concentration actually given, or correct the volume or concentration.'
  });

  chk({
    id: 'complications-explicit', sev: 'block', types: [T_OP, T_SOAP],
    need: function (e) { return e.type === T_OP || has(/complication/i, e.text); },
    run: function (e) { return near(e.text, /complication/i, /(none|no immediate|without|there were no)/i, 40); },
    label: 'Complications are not addressed.',
    why: 'State complications explicitly - the word "none" when there were none, and any real event narrated with its management and outcome.'
  });

  chk({
    id: 'ebl-present', sev: 'block', types: [T_OP],
    need: function (e) { return e.cls !== 'TPI' || /estimated blood loss|\bEBL\b/i.test(e.tplText || ''); },
    run: function (e) {
      if (!has(/(estimated blood loss|\bEBL\b)/i, e.text)) return false;
      return near(e.text, /(estimated blood loss|\bEBL\b)/i, /(minimal|none|nil|negligible|scant|trace|\b0\b|<\s*1|\d+\s*(mL|cc))/i, 40) ||
        has(/(estimated blood loss|\bEBL\b)\s*:\s*$/im, e.text);
    },
    label: 'Estimated blood loss is missing. "Minimal" or "None" satisfies it.',
    why: 'State the estimated blood loss.'
  });

  chk({
    id: 'disposition-and-post-neuraxial-check', sev: 'block', types: [T_OP],
    run: function (e) {
      var stable = has(/(tolerated the procedure|stable condition|vital signs (remained )?stable|hemodynamically stable|awake and alert|neurovascularly intact|ambulated)/i, e.text);
      var obs = has(/\d+\s*(min|minutes|hour|hours)\b/i, e.text);
      if (!stable || !obs) return false;
      if (inList(e.cls, NEURAXIAL_CLASSES)) return has(/(motor|strength|sensation|neurolog|ambulat)/i, e.text);
      return true;
    },
    label: 'Post-procedure course is incomplete: state the observation interval, stability, and (after a neuraxial injection) the motor and sensory check.',
    why: 'State how long the patient was observed, that they were stable, and the motor/sensory check after any epidural injection.'
  });

  chk({
    id: 'post-procedure-instructions', sev: 'block', types: [T_OP],
    run: function (e) {
      var base = has(/(instructed|instructions)/i, e.text) &&
        has(/(follow.?up|return|call the office|clinic)/i, e.text) &&
        has(/(fever|worsening|weakness|numbness|severe headache|call|emergency)/i, e.text);
      if (!base) return false;
      if (has(/(diagnostic|comparative)\s+(medial branch\s+)?block/i, e.text)) {
        return has(/(diary|log|record)/i, e.text) && has(/\d+\s*(-\s*\d+\s*)?(hour|hours|hrs)\b/i, e.text);
      }
      return true;
    },
    label: 'Post-procedure instructions are missing follow-up, named red-flag symptoms, or (for a diagnostic block) the pain-diary window.',
    why: 'State the instructions given, the follow-up, the named red-flag symptoms, and the pain-diary window for a diagnostic block.'
  });

  chk({
    id: 'signature-authentication', sev: 'block', types: [T_OP, T_AP],
    run: function (e) {
      var tail = e.text.slice(Math.max(0, e.text.length - 500));
      var blk = /(electronically signed|signed by|signature)/i.test(e.text) ? e.text : tail;
      if (!/(M\.?D\.?|D\.?O\.?|N\.?P\.?|P\.?A\.?-?C|APRN|DNP|DPM)/.test(tail) && !/(M\.?D\.?|D\.?O\.?|N\.?P\.?|P\.?A\.?-?C|APRN|DNP|DPM)/.test(blk)) return false;
      if (!/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i.test(tail)) return false;
      return /\b([01]?\d|2[0-3]):[0-5]\d\s*(AM|PM|hrs|hours)?\b/i.test(tail);
    },
    label: 'The note lacks an authenticated signature with credentials, date and time.',
    why: 'Close with the proceduralist\'s name and credentials, the date and the time, unsigned and in draft.'
  });

  chk({
    id: 'allergy-and-antithrombotic-status', sev: 'block', types: [T_OP, T_PE],
    /* noteq-1.0.0 (b1169): on an operative note this is always required. On a
     * ROS/PE note the spec's own scope is the pre-procedure safety block, so a
     * routine office exam is not failed for lacking an antithrombotic line. */
    need: function (e) {
      return e.type !== T_PE || e.subtype === 'pre-procedure' || e.subtype === 'day-of-update';
    },
    run: function (e) {
      var allergy = near(e.text, /allerg(y|ies|ic)/i, /(NKDA|no known|none|denies|latex|iodine|contrast|[A-Z][a-z]+(cillin|mycin|caine))/i, 60);
      var anti = has(/(anticoagul|antiplatelet|antithrombotic|aspirin|clopidogrel|warfarin|apixaban|rivaroxaban|dabigatran|ticagrelor|\bINR\b|ASRA)/i, e.text);
      if (!allergy) return false;
      if (!anti) return false;
      return near(e.text, /(anticoagul|antiplatelet|antithrombotic|aspirin|clopidogrel|warfarin|apixaban|rivaroxaban|dabigatran|ticagrelor|\bINR\b|ASRA)/i,
        /(\d+\s*(hour|day)s?|none|not on|denies|no anticoagul)/i, 120);
    },
    label: 'Allergy status or antithrombotic status is not stated. Both are required before an interventional procedure.',
    why: 'State allergies by agent (or NKDA) and the antithrombotic status with a hold interval or an explicit none.'
  });

  chk({
    id: 'laterality-conflict', sev: 'block', types: ALL_TYPES,
    need: function (e) { return e.lateralities.length > 0; },
    run: function (e) {
      if (has(/\b(bilateral|bilat|staged|contralateral)\b/i, e.text)) return true;
      var seen = {};
      for (var i = 0; i < e.lateralities.length; i++) {
        var L = e.lateralities[i];
        if (!seen[L.anat]) seen[L.anat] = {};
        seen[L.anat][L.side] = 1;
      }
      for (var k in seen) {
        if (Object.prototype.hasOwnProperty.call(seen, k)) {
          var sides = Object.keys(seen[k]);
          if (sides.length > 1) return false;
        }
      }
      return true;
    },
    label: 'This note states two different sides for the same structure. This is a wrong-site risk - resolve before signing.',
    why: 'Use one laterality per anatomic reference throughout, or state bilateral explicitly.'
  });

  chk({
    id: 'level-conflict-and-coverage', sev: 'block', types: [T_OP],
    need: function (e) { return e.titleLevels.length > 0 && !!e.techniqueText; },
    run: function (e) {
      for (var i = 0; i < e.titleLevels.length; i++) {
        var lv = e.titleLevels[i];
        if (e.techniqueLevels.indexOf(lv) >= 0) continue;
        if (inList(e.cls, ['MBB', 'RFA-facet']) && has(/(medial branch|dorsal ram(us|i)|third occipital)/i, e.techniqueText)) continue;
        return false;
      }
      return true;
    },
    label: 'A level named in the procedure title is not accounted for in the technique.',
    why: 'Describe every titled level in the technique, or name the mapped medial branches for a denervation.'
  });

  /* ---------- operative note, warn tier ---------- */
  chk({
    id: 'image-guidance-conditional', sev: 'warn', types: [T_OP],
    need: function (e) { return inList(e.cls, GUIDED_CLASSES); },
    run: function (e) { return has(/(fluoroscop\w*|ultrasound|US[- ]guided|CT[- ]guided|image[- ]guided)/i, e.text); },
    label: 'Image guidance is not documented for a procedure class that requires it.',
    why: 'Name the guidance modality used.'
  });

  chk({
    id: 'fluoro-views-time-and-image-retention', sev: 'warn', types: [T_OP],
    need: function (e) { return has(/fluorosc/i, e.text); },
    run: function (e) {
      var views = /\b(AP|A\/P|anteroposterior|oblique|RAO|LAO|lateral|contralateral oblique|CLO)\b/i.test(
        String(e.techniqueText || e.text).replace(/(left|right|semi)[- ]lateral decubitus/gi, ' '));
      var time = near(e.text, /fluoro(scopy|scopic)?\s*(time|exposure)/i, /\d/, 60);
      var kept = /(image|images)\s*(were\s*)?(saved|retained|archived|stored|recorded)|PACS|permanent (image|record)/i.test(e.text);
      return views && time && kept;
    },
    label: 'Fluoroscopic views, fluoroscopy time or dose, or the permanent-image retention statement is missing - the last is a billing prerequisite for the guidance code.',
    why: 'Name the views obtained, the fluoroscopy time or dose, and that permanent images were retained.'
  });

  chk({
    id: 'negative-aspiration', sev: 'warn', types: [T_OP],
    need: function (e) { return inList(e.cls, NEEDLE_CLASSES); },
    run: function (e) { return has(/(negative aspiration|aspiration was negative|no (blood|CSF|cerebrospinal fluid|heme)[^.]{0,30}(return|aspirat|obtain|note))/i, e.text); },
    label: 'Negative aspiration for blood and cerebrospinal fluid is not documented.',
    why: 'State that aspiration was negative for blood and CSF before injection.'
  });

  chk({
    id: 'contrast-agent-and-volume', sev: 'warn', types: [T_OP],
    need: function (e) { return has(/contrast/i, e.text); },
    run: function (e) {
      return has(/(iohexol|Omnipaque|iopamidol|Isovue(-M)?|iodixanol|Visipaque|non.?ionic)/i, e.text) &&
        has(/\d+(\.\d+)?\s*(mL|cc)\b/i, e.text);
    },
    label: 'Contrast is documented without a named agent or a volume.',
    why: 'Name the contrast agent and the volume injected.'
  });

  chk({
    id: 'needle-spec-present', sev: 'warn', types: [T_OP],
    need: function (e) { return inList(e.cls, NEEDLE_CLASSES) || e.cls === 'TPI'; },
    run: function (e) {
      return has(/\b(1[6-9]|2[0-7])\s*[- ]?\s*(g|ga|gauge)\b/i, e.text) &&
        has(/\b\d+(\.\d+)?\s*[- ]?\s*(mm|cm|in|inch|inches)\b/i, e.text);
    },
    label: 'Needle or cannula gauge and length are not documented.',
    why: 'State the needle gauge and length (for example, 22-gauge, 3.5-inch).'
  });

  chk({
    id: 'site-marking-when-lateralized', sev: 'warn', types: [T_OP],
    need: function (e) { return has(/\b(left|right|bilateral)\b/i, e.text.slice(0, 2000)); },
    run: function (e) {
      return has(/(site|level|side)s?\b[^.]{0,40}\b(was|were)?\s*(marked|verified|confirmed)/i, e.text) ||
        has(/(marked|verification of)\s+(the\s+)?(site|level|side)/i, e.text);
    },
    label: 'Site marking or verification is not documented for a lateralized procedure.',
    why: 'State that the site, side or level was marked and verified.'
  });

  chk({
    id: 'needle-removal-hemostasis-dressing', sev: 'warn', types: [T_OP],
    need: function (e) { return inList(e.cls, NEEDLE_CLASSES) || e.cls === 'TPI'; },
    run: function (e) {
      return has(/(needle|cannula|needles|cannulae)[^.]{0,60}(removed|withdrawn)/i, e.text) &&
        has(/(hemostasis|manual pressure|pressure (was )?(held|applied))/i, e.text) &&
        has(/(dressing|bandage|Band.?Aid|adhesive strip)/i, e.text);
    },
    label: 'Needle removal, hemostasis, or dressing is not documented.',
    why: 'State that the needles were removed intact, hemostasis obtained, and a dressing applied.'
  });

  chk({
    id: 'sedation-discharge-safeguards', sev: 'warn', types: [T_OP],
    need: function (e) { return has(/\b(midazolam|Versed|fentanyl|propofol|moderate sedation|conscious sedation)\b/i, e.text); },
    run: function (e) {
      return has(/(NPO|nil per os|nothing by mouth|fasting)/i, e.text) &&
        has(/(escort|responsible adult|accompanied by|did not drive|driver)/i, e.text);
    },
    label: 'Sedation was given without a documented NPO status or discharge escort.',
    why: 'State the NPO status and the discharge escort when sedation is used.'
  });

  chk({
    id: 'specimens-conditional', sev: 'warn', types: [T_OP],
    /* noteq-1.0.0 (b1169): the spec's bare /aspirat/ also matches the
     * "negative aspiration" safety step that every needle note contains,
     * which would demand a specimens line from notes where nothing was ever
     * aspirated. Narrowed to an aspiration that is not the negative-aspiration
     * check - the rule's actual subject. */
    need: function (e) {
      if (has(/arthrocent|biops/i, e.text)) return true;
      if (!has(/aspirat/i, e.text)) return false;
      return !near(e.text, /aspirat\w*/i, /(negative|no (blood|CSF|heme)|without)/i, 40);
    },
    run: function (e) {
      return has(/specimen/i, e.text) ||
        has(/(fluid|aspirate)[^.]{0,60}(sent|discarded|to (pathology|lab)|none obtained)/i, e.text);
    },
    label: 'Aspiration or biopsy was performed without a specimen volume, character and disposition.',
    why: 'State what was aspirated, its volume and character, and where it went.'
  });

  chk({
    id: 'op.findings-statement', sev: 'warn', types: [T_OP],
    run: function (e) { return has(/\bfindings?\b/i, e.text); },
    label: 'No explicit FINDINGS statement.',
    why: 'State the findings - contrast spread, joint entry, or the concordant response observed.'
  });

  chk({
    id: 'op.pain-scores-pre-post', sev: 'warn', types: [T_OP],
    run: function (e) {
      var re = /(pain|NRS|VAS|NPRS)\D{0,20}(\d{1,2})\s*(\/|of|out of)\s*10/gi;
      var m, n = 0;
      re.lastIndex = 0;
      while ((m = re.exec(e.masked)) !== null) { n++; if (m.index === re.lastIndex) re.lastIndex++; }
      return n >= 2;
    },
    label: 'Pre-procedure and post-procedure pain scores are not both documented.',
    why: 'Give the pre-procedure pain score and the recovery score with the elapsed interval.'
  });

  chk({
    id: 'length-floor-by-class', sev: 'warn', types: [T_OP],
    need: function (e) { return !!LENGTH_FLOOR[e.cls]; },
    run: function (e) { return e.words >= LENGTH_FLOOR[e.cls]; },
    label: 'The note is shorter than expected for this procedure class and may be under-documented.',
    why: 'Document the technique step by step in real procedural order.'
  });

  chk({
    id: 'lumbar-transforaminal-particulate-flag', sev: 'warn', types: [T_OP, T_AP],
    need: function (e) { return e.cls === 'ESI-TF' && !has(/\bC[1-7]\b/, e.text); },
    run: function (e) { return !has(/(triamcinolone|Kenalog|methylprednisolone|Depo.?Medrol)/i, e.text); },
    label: 'Particulate corticosteroid is documented for a lumbar or thoracic transforaminal injection. Confirm this was intended.',
    why: 'Confirm particulate use was deliberate, or switch to a non-particulate agent.'
  });

  /* ---------- HPI ---------- */
  chk({
    id: 'exam-or-assessment-content-in-hpi', sev: 'block', types: [T_HPI],
    run: function (e) {
      return !has(/\bon (physical )?exam(ination)?\b|\btender to palpation\b|\bstraight leg raise\b|\bSLR (is |was )?(positive|negative)\b|\brange of motion (is|was|limited)\b|\b[0-5]\/5 strength\b|\breflexes are\b|\bgait is\b|\bFABER\b|\bSpurling\b/i, e.text);
    },
    label: 'Examination findings appear in the HPI. Move them to the physical examination section.',
    why: 'Keep exam findings out of the history; the HPI carries what the patient reports.'
  });

  chk({
    id: 'pain-severity-quantified', sev: 'block', types: [T_HPI, T_PE, T_SOAP],
    run: function (e) {
      if (/(^|[^\d\/])(10|[0-9])\s*(-|to)\s*(10|[0-9])\s*(\/|out of)\s*10\b/.test(e.masked)) return true;
      if (/(^|[^\d\/])(10|[0-9])\s*(\/|out of)\s*10\b/.test(e.masked)) return true;
      if (/\b(NRS|NPRS|VAS|PEG|DVPRS)\b\s*(of\s*|score\s*)?\d{1,2}/i.test(e.masked)) return true;
      if (/(nonverbal|unable to rate|cognitive impairment|interpreter unavailable)/i.test(e.text)) return true;
      var re = /\b(mild|moderate|severe)\b/gi, m;
      re.lastIndex = 0;
      while ((m = re.exec(e.text)) !== null) {
        var around = e.text.slice(Math.max(0, m.index - 60), m.index + 60);
        if (/(stenosis|foraminal|narrowing|degenerative|arthropathy|arthritis|disc|canal|spondylosis|\bOA\b)/i.test(around)) { if (m.index === re.lastIndex) re.lastIndex++; continue; }
        if (/\bpain\b/i.test(around)) return true;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return false;
    },
    label: 'No pain score on a named scale. "Severe" describing an imaging finding is not a pain severity.',
    why: 'Give the severity as a number on a named scale (for example 6/10 average, 9/10 worst).'
  });

  chk({
    id: 'red-flag-screen-region-routed', sev: 'block', types: [T_HPI, T_PE],
    need: function (e) { return e.region === 'lumbosacral' || e.region === 'cervical'; },
    run: function (e) {
      if (/no red flags|ROS (is )?negative/i.test(e.text) && !/bowel|bladder|saddle|clumsi|Lhermitte/i.test(e.text)) return false;
      if (e.region === 'lumbosacral') {
        return /bowel|bladder|incontinen|retention/i.test(e.text) && /saddle|perineal/i.test(e.text);
      }
      var set = [/clumsi/i, /dropping (things|objects)/i, /buttons/i, /handwriting/i, /balance/i, /gait (instabil|change|difficult)/i, /urinary urgency/i, /Lhermitte/i, /Hoffmann/i, /Babinski/i, /clonus/i];
      var n = 0;
      for (var i = 0; i < set.length; i++) if (set[i].test(e.text)) n++;
      return n >= 2;
    },
    label: 'The red-flag screen is missing, uses a catch-all, or is routed to the wrong region.',
    why: 'Screen bowel/bladder and saddle for lumbosacral complaints; screen the myelopathy set for cervical complaints. A catch-all does not satisfy it.'
  });

  chk({
    id: 'procedure-relief-percent-and-duration', sev: 'block', types: [T_HPI, T_AP, T_SOAP, T_PE],
    need: function (e) { return e.hasPriorProcedure; },
    run: function (e) {
      var pct = /\b\d{1,3}\s*%|\b(complete|no|minimal|partial) relief\b/i.test(e.text);
      var dur = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|several)\s*[- ]?\s*(hour|day|week|month)s?\b/i.test(e.text);
      return pct && dur;
    },
    label: 'A prior injection or block is described without both the percent relief and how long it lasted.',
    why: 'State relief as a pair - the percent AND the duration - for every prior interventional procedure.'
  });

  chk({
    id: 'reason-for-encounter-present', sev: 'warn', types: [T_HPI],
    run: function (e) {
      var ss = e.sents;
      var scope = (ss.slice(0, 2).join(' ') + ' ' + ss.slice(-2).join(' '));
      return /\b(presents? (today|for)|here for|returns for|seen in follow[- ]?up|referred (by|for)|evaluation of|reassessment|consideration of)\b/i.test(scope);
    },
    label: 'The reason for this encounter is not stated.',
    why: 'Open or close with why the patient is here today.'
  });

  chk({
    id: 'prior-workup-attribution', sev: 'warn', types: [T_HPI],
    need: function (e) { return has(/\b(MRI|CT scan|CT\b|radiograph|x-?ray|EMG|electrodiagnostic|nerve conduction)\b/i, e.text); },
    run: function (e) {
      return has(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(January|February|March|April|May|June|July|August|September|October|November|December)\b|\b\d+\s*(month|year|week)s? ago\b/i, e.text) &&
        has(/(demonstrated|showed|reported as|per the report|was read as)/i, e.text);
    },
    label: 'An imaging or electrodiagnostic finding is asserted without a date and attribution.',
    why: 'Attribute the study and date it - "MRI of 05/12/2026 was reported as showing...".'
  });

  chk({
    id: 'functional-impact-present', sev: 'warn', types: [T_HPI, T_AP, T_PE, T_SOAP],
    run: function (e) {
      if (/\b(tolerance|able to|limited to)\b[^.]{0,40}\b(\d+|one|two|several)\s*(minute|block|flight|hour|pound)s?\b/i.test(e.text)) return true;
      var ss = e.sents;
      for (var i = 0; i < ss.length; i++) {
        if (/\b(walk|walking|stand|standing|sit|sitting|stairs|lifting|sleep|dress|ADL|work|drive|driving|bend|carry)\w*\b/i.test(ss[i]) &&
          /\b(limit\w*|unable|difficult\w*|interfere\w*|restrict\w*|tolerat\w*|reduce\w*|prevent\w*|impair\w*)\b/i.test(ss[i])) return true;
      }
      return false;
    },
    label: 'No functional impact is documented. Coverage for interventional procedures requires a stated functional deficit.',
    why: 'Quantify the impact against a concrete activity or tolerance.'
  });

  chk({
    id: 'conservative-care-quantified', sev: 'warn', types: [T_HPI, T_AP, T_SOAP],
    need: function (e) { return e.plansFirstProcedure; },
    run: function (e) {
      return has(/(physical therapy|\bPT\b|home exercise|NSAID|chiropract|acupunctur|injection|medication|bracing|activity modification)/i, e.text) &&
        has(/\b\d+\s*[- ]?\s*\d*\s?(day|week|month)s?\b/i, e.text) &&
        has(/(fail|no relief|inadequate|partial|insufficient|unsuccessful|without (meaningful|adequate|sustained))/i, e.text);
    },
    label: 'A first procedure is planned without a documented conservative-care trial, its duration and its outcome.',
    why: 'State the conservative modality, how long it was tried, and the outcome.'
  });

  chk({
    id: 'prior-treatment-paired-response', sev: 'warn', types: [T_HPI],
    need: function (e) { return has(/(physical therapy|\bPT\b|chiropract|acupunctur|gabapentin|duloxetine|NSAID|meloxicam|ibuprofen|naproxen|injection|epidural|block)/i, e.text); },
    run: function (e) {
      return has(/(relief|improve\w*|help\w*|benefit\w*|fail\w*|no change|without (sustained|meaningful|adequate)|worse|unsuccessful|tolerated poorly|side effect)/i, e.text);
    },
    label: 'A prior treatment is listed with no stated outcome.',
    why: 'Give each prior treatment its outcome.'
  });

  chk({
    id: 'attribution-stem-repetition', sev: 'warn', types: [T_HPI, T_SOAP],
    need: function (e) { return e.sents.length >= 5; },
    run: function (e) {
      var stems = {}, n = 0, pat = 0, i;
      for (i = 0; i < e.sents.length; i++) {
        var w = e.sents[i].toLowerCase().split(/\s+/).slice(0, 3).join(' ');
        if (!w) continue;
        stems[w] = (stems[w] || 0) + 1;
        n++;
        if (/^(the patient|he |she |he's|she's)/.test(e.sents[i].toLowerCase())) pat++;
      }
      for (var k in stems) if (Object.prototype.hasOwnProperty.call(stems, k) && stems[k] > 2) return false;
      return n === 0 ? true : (pat / n) <= 0.6;
    },
    label: 'The same sentence opening repeats; vary the attribution.',
    why: 'Alternate surname and pronoun rather than repeating "the patient".'
  });

  chk({
    id: 'hedge-density', sev: 'warn', types: [T_HPI, T_OP, T_AP, T_SOAP],
    need: function (e) { return e.words >= 60; },
    run: function (e) {
      var n = 0, ss = e.sents;
      for (var i = 0; i < ss.length; i++) {
        if (!/\b(seems|seemingly|possibly|maybe|perhaps|I guess|might be|sort of|kind of|appears to have)\b/i.test(ss[i])) continue;
        if (/\d+(\.\d+)?\s*(mg|mcg|mL|cc|%|degrees?|C\b)|\b(left|right|bilateral)\b|\b[CTLS]\d/i.test(ss[i])) n++;
      }
      return (n / e.words) * 100 <= 1;
    },
    label: 'Hedging language attaches to a fact that should be stated definitely.',
    why: 'Do not hedge a dose, concentration, volume, level, side, temperature or the complications statement.'
  });

  /* ---------- assessment & plan ---------- */
  chk({
    id: 'assessment-status-and-plan-coverage', sev: 'block', types: [T_AP, T_SOAP],
    need: function (e) { return e.problems.length > 0; },
    run: function (e) {
      for (var i = 0; i < e.problems.length; i++) {
        if (!/(improv|stable|unchanged|controlled|worsen|worse|progress(ive|ing)|exacerbat|flare|refractory|resolv|new(ly)? (diagnosed|onset)|chronic|recurren)/i.test(e.problems[i])) return false;
      }
      return true;
    },
    label: 'An assessed problem carries no status word.',
    why: 'Give every problem a status - improved, stable, worsening, flare, refractory, resolved, chronic or recurrent.'
  });

  chk({
    id: 'laterality-stated-for-planned-procedure', sev: 'block', types: [T_AP, T_SOAP],
    need: function (e) { return e.plansProcedure; },
    run: function (e) {
      var scope = e.planText || e.text;
      var lat = /\b(left|right|bilateral|midline|central|axial)\b/i.test(scope);
      var site = /\b[CTLS]\d{1,2}\b|\b(knee|shoulder|hip|sacroiliac|joint|trapezius)\b/i.test(scope);
      var guide = /\b(fluorosc\w*|ultrasound|US[- ]guided|CT[- ]guided|landmark|image[- ]guided)\b/i.test(scope) ||
        /trigger point/i.test(scope);
      return lat && site && guide;
    },
    label: 'A planned procedure does not state side, level or joint, and image guidance.',
    why: 'State the side, the level or joint, and the guidance modality for every planned procedure.'
  });

  chk({
    id: 'ablation-coverage-predicate', sev: 'block', types: [T_AP, T_SOAP, T_PE],
    need: function (e) { return /\b(radiofrequency|neurotomy|rhizotomy|ablation)\b/i.test(e.planText || e.text); },
    run: function (e) {
      var two = /(two|2|second|repeat|confirmatory)\b[^.]{0,60}(diagnostic|medial branch|MBB|block)/i.test(e.text);
      var pct = /\b(8\d|9\d|100)\s*%/.test(e.text);
      var conc = /(concordan\w*|anesthetic phase|local anesthetic phase)/i.test(e.text);
      return two && pct && conc;
    },
    label: 'An ablation is requested without the two diagnostic blocks, their percent relief, and the concordant anesthetic-phase detail that coverage requires.',
    why: 'Document both diagnostic blocks with their percent relief and concordance before requesting radiofrequency.'
  });

  chk({
    id: 'pdmp-documented-with-finding', sev: 'block', types: [T_AP, T_SOAP],
    need: function (e) { return e.prescribesControlled; },
    run: function (e) {
      return near(e.text, /\bPDMP\b|prescription (drug )?monitoring/i,
        /(consistent|no (additional|other|outside)|single prescriber|discrepan|overlap|identified)/i, 200);
    },
    label: 'A controlled substance is prescribed without a PDMP query date and its actual finding. "PDMP reviewed" alone is not documentation.',
    why: 'State the PDMP query date and what it actually showed.'
  });

  chk({
    id: 'uds-interpreted-or-pending', sev: 'block', types: [T_AP, T_SOAP],
    need: function (e) { return has(/\bUDS\b|urine drug (screen|test)|\bUDT\b|toxicology screen/i, e.text); },
    run: function (e) {
      return near(e.text, /\bUDS\b|urine drug (screen|test)|\bUDT\b|toxicology screen/i,
        /(consistent|inconsistent|expected|unexpected|as prescribed|pending|ordered|collected today|sent to confirmatory|awaiting)/i, 300);
    },
    label: 'A urine drug screen is mentioned with no interpretation and no pending status.',
    why: 'State the interpretation, or that the result is pending.'
  });

  chk({
    id: 'anticoagulation-before-neuraxial', sev: 'block', types: [T_AP, T_SOAP, T_PE],
    need: function (e) {
      return /(epidural|transforaminal|interlaminar|neuraxial|radiofrequency|medial branch|sympathetic)/i.test(e.planText || e.text) &&
        /(anticoagul|antiplatelet|aspirin|clopidogrel|warfarin|apixaban|rivaroxaban|dabigatran|ticagrelor)/i.test(e.text);
    },
    run: function (e) {
      return near(e.text, /(anticoagul|antiplatelet|aspirin|clopidogrel|warfarin|apixaban|rivaroxaban|dabigatran|ticagrelor)/i,
        /(hold|held|continue|resume|days? (prior|before|after)|\bINR\b|cleared by|per ASRA|bridge|coordinated with)/i, 400);
    },
    label: 'An anticoagulant or antiplatelet is documented with a planned spinal procedure and no hold, continue or resumption plan.',
    why: 'State the hold or continue decision, the interval, the clearing prescriber and the resumption plan.'
  });

  chk({
    id: 'follow-up-and-return-precautions', sev: 'block', types: [T_AP, T_SOAP],
    run: function (e) {
      var fu = near(e.text, /(follow.?up|return to clinic|return in|recheck|see (her|him|the patient) (back|again))/i,
        /(\d+\s*(day|week|month)s?|one|two|three|four|six|eight|twelve|\d{1,2}\/\d{1,2}|after (the|his|her)|when|if)/i, 80);
      if (!fu) return false;
      if (/\bPRN\b\s*$/i.test(String(e.text).trim())) return false;
      return near(e.text, /(return precaution|seek (care|attention)|call the office|go to the emergency|present to the emergency|instructed to (call|return|seek))/i,
        /(fever|weakness|numbness|bowel|bladder|saddle|severe|worsening|chest pain|shortness of breath|redness|swelling|drainage)/i, 200);
    },
    label: 'Follow-up has no interval or trigger, or the return precautions name no specific symptom and action.',
    why: 'Give a concrete follow-up interval or trigger, and name the specific red-flag symptoms with the matching action.'
  });

  chk({
    id: 'mdm-and-data-credit-support', sev: 'warn', types: [T_AP, T_SOAP],
    run: function (e) { return has(/problem(s)? addressed|data reviewed|risk of (patient )?management|medical decision making|\bMDM\b|complexity/i, e.text); },
    label: 'The medical decision making is not stated.',
    why: 'Close with one MDM line naming problems addressed, data reviewed, and the risk driver.'
  });

  chk({
    id: 'consent-discussion-for-planned-procedure', sev: 'warn', types: [T_AP, T_SOAP],
    need: function (e) { return e.plansProcedure; },
    run: function (e) {
      return has(/(risks?,? benefits?,? and alternatives|informed consent|consent (obtained|signed|reviewed)|questions answered|verbalized understanding|wishes to proceed|elects to proceed|shared decision)/i, e.text);
    },
    label: 'A planned procedure carries no shared decision-making or consent discussion.',
    why: 'Document the risks, benefits and alternatives discussion.'
  });

  chk({
    id: 'opioid-monitoring-bundle', sev: 'warn', types: [T_AP, T_SOAP],
    need: function (e) { return e.prescribesOpioid; },
    run: function (e) {
      return has(/\bMME\b|morphine milligram equivalent/i, e.text) &&
        has(/\bPDMP\b|prescription (drug )?monitoring/i, e.text) &&
        has(/\bUDS\b|\bUDT\b|urine drug|toxicolog/i, e.text) &&
        has(/\bORT\b|risk assessment|opioid agreement|controlled substance agreement|treatment agreement/i, e.text);
    },
    label: 'The opioid monitoring set is incomplete (MME, PDMP, toxicology, or agreement status).',
    why: 'Name each of MME, the PDMP finding, the toxicology status and the agreement status.'
  });

  chk({
    id: 'opioid-benzodiazepine-and-naloxone', sev: 'warn', types: [T_AP, T_SOAP],
    need: function (e) {
      return e.prescribesOpioid &&
        (/(alprazolam|lorazepam|clonazepam|diazepam|benzodiazepine)/i.test(e.text) || /\bMME\b[^.]{0,30}\b([5-9]\d|\d{3,})\b/i.test(e.text));
    },
    run: function (e) { return has(/naloxone|Narcan/i, e.text); },
    label: 'Elevated-risk opioid therapy or opioid-benzodiazepine co-prescribing without a naloxone decision.',
    why: 'State the naloxone decision and the combined-risk rationale.'
  });

  chk({
    id: 'imaging-order-justification', sev: 'warn', types: [T_AP, T_SOAP],
    need: function (e) {
      var s = String(e.planText || '');
      return /\b(MRI|CT\b|radiograph|x-?ray|ultrasound|EMG)\b/i.test(s.replace(/[^.]{0,20}guid\w*/gi, ' '));
    },
    run: function (e) {
      return near(e.planText || e.text, /\b(MRI|CT\b|radiograph|x-?ray|EMG)\b/i,
        /(to (evaluate|assess|rule out|exclude|characterize|confirm)|for evaluation of|given|because of|to determine)/i, 120);
    },
    label: 'An imaging study is ordered without the clinical question it answers.',
    why: 'State modality, region, contrast status and the question the study answers.'
  });

  chk({
    id: 'glycemic-counseling-before-steroid', sev: 'warn', types: [T_AP, T_PE],
    need: function (e) {
      return /(steroid|corticosteroid|triamcinolone|dexamethasone|betamethasone|methylprednisolone)/i.test(e.planText || e.text) &&
        /\b(diabetes|diabetic|T2DM|DM2|A1c)\b/i.test(e.text);
    },
    run: function (e) { return has(/(glucose|blood sugar|hyperglyc|A1c|glycemic)/i, e.planText || e.text); },
    label: 'A steroid injection is planned in a patient with diabetes with no glycemic counseling documented.',
    why: 'Counsel on the transient glycemic effect and document it.'
  });

  chk({
    id: 'prn-without-trigger', sev: 'warn', types: [T_AP, T_SOAP],
    need: function (e) { return has(/\b(prn|as needed)\b/i, e.text); },
    run: function (e) { return near(e.text, /\b(prn|as needed)\b/i, /\b(for|if|when)\s+[a-z]/i, 60); },
    label: '"As needed" is used without a stated trigger.',
    why: 'Say what it is needed for.'
  });

  chk({
    id: 'pain-and-function-baseline', sev: 'warn', types: [T_AP, T_PE],
    run: function (e) {
      var pain = /(\d{1,2}\s*\/\s*10|\bNRS\b|\bVAS\b|\bNPRS\b|\bPEG\b)/i.test(e.masked);
      var fn = /\b(ODI|NDI|Oswestry|walking tolerance|standing tolerance|sitting tolerance|stairs|ADL|return to work|lifting|sleep interference|tolerance)\b/i.test(e.text);
      return pain && fn;
    },
    label: 'A baseline pain score or a functional measure is missing.',
    why: 'Carry both a pain intensity and a functional measure for the treated problem.'
  });

  chk({
    id: 'orphan-plan-line', sev: 'warn', types: [T_AP],
    need: function (e) { return e.problems.length > 0 && e.firstProblemAt >= 0; },
    run: function (e) {
      var before = e.text.slice(0, e.firstProblemAt);
      return !/^\s*(order|prescribe|refill|schedule|continue|start|stop|increase|decrease|refer)\b/im.test(before.replace(/^\s*plan\s*:?\s*$/im, ''));
    },
    label: 'A plan action is not linked to any assessed problem.',
    why: 'Attach every plan line to the problem it belongs to.'
  });

  /* ---------- ROS / physical exam ---------- */
  chk({
    id: 'ros-catchall-standing-alone', sev: 'block', types: [T_PE],
    need: function (e) { return !!e.rosBody; },
    run: function (e) {
      return !/^\s*(ROS[: ]*)?(all|complete) systems (were )?(reviewed and )?(are )?negative\.?\s*$/i.test(e.rosBody.trim());
    },
    label: 'The review of systems is a bare catch-all with no system carrying content.',
    why: 'Name each system reviewed with a pertinent positive or an explicit denial.'
  });

  chk({
    id: 'special-test-has-result', sev: 'block', types: [T_PE, T_SOAP],
    need: function (e) { return e.specialTests.length > 0; },
    run: function (e) {
      for (var i = 0; i < e.specialTests.length; i++) {
        if (!/(positive|negative|reproduc\w*|concordant|non-?concordant|absent|present|equivocal|deferred|unable|normal|intact)/i.test(e.specialTests[i].scope)) return false;
      }
      return true;
    },
    label: 'A named examination test is documented with no result.',
    why: 'Give every named special test a result and a side.'
  });

  chk({
    id: 'pe-scope-subset-of-source', sev: 'block', types: [T_PE],
    need: function (e) { return e.region === 'lumbosacral' || e.region === 'cervical' || /spine|extremity|knee|shoulder|hip/i.test(e.text); },
    run: function (e) { return !has(/\b(pelvic exam|breast exam|rectal exam|genitourinary exam)\b/i, e.text); },
    label: 'The examination documents a system that was not performed or is unrelated to this encounter.',
    why: 'Do not document a pelvic, breast, rectal or genitourinary exam in a spine or extremity encounter.'
  });

  chk({
    id: 'preprocedure-safety-block', sev: 'block', types: [T_PE],
    need: function (e) { return e.subtype === 'pre-procedure' || e.subtype === 'day-of-update'; },
    run: function (e) {
      var anti = near(e.text, /(anticoagul|antiplatelet|aspirin|clopidogrel|warfarin|apixaban|rivaroxaban)/i, /(hold|held|last dose|none|not on|denies|continue)/i, 200);
      var infect = has(/(fever|infection|febrile|afebrile|chills)/i, e.text);
      return anti && infect;
    },
    label: 'The pre-procedure safety block is incomplete: anticoagulation status and the infection screen are required.',
    why: 'State the anticoagulant with last dose and hold plan (or an explicit none) and the infection and fever screen.'
  });

  chk({
    id: 'day-of-hp-update-attestation', sev: 'block', types: [T_PE],
    need: function (e) { return e.subtype === 'day-of-update'; },
    run: function (e) {
      return has(/(H&P|history and physical)[^.]{0,60}(review|update)/i, e.text) &&
        has(/(no (interval )?change|change[sd]? (in|since))/i, e.text) &&
        has(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/, e.text);
    },
    label: 'The day-of-procedure H&P update is missing its review statement, interval-change statement, or date.',
    why: 'State that the H&P was reviewed, the patient re-examined, and either no interval change or the specific change, dated and signed.'
  });

  chk({
    id: 'rom-strength-reflex-sensory-quantified', sev: 'warn', types: [T_PE, T_SOAP],
    need: function (e) { return has(/\b(strength|motor|reflex|DTR|sensation|sensory|range of motion|\bROM\b)\b/i, e.text); },
    run: function (e) {
      var ok = true;
      if (/\b(strength|motor)\b/i.test(e.text)) {
        ok = ok && (/\b[0-5][+-]?\s?\/\s?5\b/.test(e.masked) || /(grossly (intact|normal)|full strength|screening)/i.test(e.text));
      }
      if (/\b(reflex|DTR)\w*\b/i.test(e.text)) {
        ok = ok && (/\b[0-4]\+?\s*\/\s*4\b|\b[0-4]\+\b|\b(symmetric|hypoactive|hyperactive|absent|normoactive|intact)\b/i.test(e.text));
      }
      if (/\b(sensation|sensory)\b/i.test(e.text)) {
        ok = ok && /(light touch|pinprick|\bLT\b|\bPP\b|dermatome|[CTLS]\d|grossly intact)/i.test(e.text);
      }
      if (/\brange of motion\b|\bROM\b/i.test(e.text)) {
        ok = ok && /(\d+\s*(degrees?|deg)|\d+\s*%|full|limited|restricted|deferred)/i.test(e.text);
      }
      return ok;
    },
    label: 'An examination element is documented without a measurable value.',
    why: 'Give ROM in degrees or percent, strength as MRC over 5, reflexes by grade, and sensation by modality and dermatome.'
  });

  chk({
    id: 'gait-and-myelopathy-exam', sev: 'warn', types: [T_PE],
    need: function (e) { return /spine|lumbar|cervical|back|leg|radicul/i.test(e.text); },
    run: function (e) {
      if (!/\b(gait|station|ambulat\w*)\b/i.test(e.text)) return false;
      if (e.region === 'cervical') return /\b(tandem|Romberg|Hoffmann|Babinski|clonus)\b/i.test(e.text);
      return true;
    },
    label: 'Gait was not described, or a cervical complaint carries no upper-motor-neuron screen.',
    why: 'Describe gait and station; add Hoffmann, Babinski, clonus, Romberg or tandem gait for a cervical complaint.'
  });

  chk({
    id: 'unlocalized-tenderness', sev: 'warn', types: [T_PE, T_SOAP],
    need: function (e) { return has(/tender(ness)?( to palpation)?|\bTTP\b/i, e.text); },
    run: function (e) {
      var ss = e.sents;
      for (var i = 0; i < ss.length; i++) {
        if (!/tender(ness)?( to palpation)?|\bTTP\b/i.test(ss[i])) continue;
        if (/\b(no|without|denies)\b/i.test(ss[i])) continue;
        var loc = /\b[CTLS]\d{1,2}\b|\b(paraspinal|paravertebral|facet|sacroiliac|trochanter|joint|muscle|trapezius|spinous|midline|knee|shoulder|hip)\b/i.test(ss[i]);
        var side = /\b(left|right|bilateral|midline)\b/i.test(ss[i]);
        if (!loc && !side) return false;
      }
      return true;
    },
    label: 'Tenderness is documented without a structure, level or side.',
    why: 'Localize palpation to a named structure or level with a side.'
  });

  chk({
    id: 'injection-site-skin-inspected', sev: 'warn', types: [T_PE],
    need: function (e) { return e.subtype === 'pre-procedure' || e.subtype === 'day-of-update'; },
    run: function (e) {
      return near(e.text, /(injection|procedure|planned|entry) site|overlying skin/i,
        /(no|without|denies)\s+(erythema|induration|rash|infection|breakdown|drainage)|skin (is )?intact/i, 200);
    },
    label: 'The planned injection site was not inspected for infection.',
    why: 'Inspect and document the planned entry site for erythema, induration, rash or breakdown.'
  });

  chk({
    id: 'si-joint-provocation-count', sev: 'warn', types: [T_PE],
    need: function (e) { return /sacroiliac|\bSI\b joint/i.test(e.text); },
    run: function (e) {
      var mans = [/FABER/i, /Patrick/i, /Gaenslen/i, /thigh thrust/i, /compression/i, /distraction/i, /sacral thrust/i];
      var n = 0;
      for (var i = 0; i < mans.length; i++) if (mans[i].test(e.text)) n++;
      return n >= 3;
    },
    label: 'Fewer than three sacroiliac provocation maneuvers with results are documented.',
    why: 'Document at least three named SI provocation maneuvers with their results.'
  });

  chk({
    id: 'facet-candidacy-elements', sev: 'warn', types: [T_PE, T_AP],
    need: function (e) { return /facet|medial branch|\bMBB\b|\bRFA\b|radiofrequency|neurotomy/i.test(e.text); },
    run: function (e) {
      var tender = /(paravertebral|paraspinal|facet)[^.]{0,60}(tender|TTP)|facet loading|extension and rotation|Kemp/i.test(e.text);
      var radic = /(radicular|radiculopath\w*|no radicular|without radicular|non-?radicular)/i.test(e.text);
      return tender && radic;
    },
    label: 'Facet coverage turns on documented facet-loading tenderness and an explicit statement about radicular findings; one or both are missing.',
    why: 'Document paravertebral or facet-loading tenderness with side and level, and state explicitly whether radicular findings are present.'
  });

  chk({
    id: 'vitals-or-explicit-deferral', sev: 'warn', types: [T_SOAP, T_PE],
    run: function (e) {
      return /\b(BP|blood pressure)\b[^.]{0,20}\d{2,3}\s*\/\s*\d{2,3}|\bHR\b[^.]{0,10}\d{2,3}|\bvital signs?\b|\bvitals\b/i.test(e.text);
    },
    label: 'Vital signs are neither recorded nor explicitly deferred with a reason.',
    why: 'Record vitals or state explicitly that they were deferred and why.'
  });

  /* ---------- SOAP visit note ---------- */
  chk({
    id: 'soap-headers-anchored-and-ordered', sev: 'block', types: [T_SOAP],
    run: function (e) {
      var re = /^\s*(?:\*\*)?\s*(S|SUBJ(?:ECTIVE)?|HPI|HISTORY|O|OBJ(?:ECTIVE)?|PHYSICAL(?: EXAM(?:INATION)?)?|EXAM(?:INATION)?|A|ASSESS(?:MENT)?|IMPRESSION|P|PLAN|A\/P|ASSESSMENT AND PLAN)\s*(?:\*\*)?\s*[:\-]?\s*$/gim;
      var m, seq = [];
      re.lastIndex = 0;
      while ((m = re.exec(e.text)) !== null) { seq.push(m[1].toUpperCase()); if (m.index === re.lastIndex) re.lastIndex++; }
      /* also accept inline 'SUBJECTIVE: ...' heading lines */
      if (!seq.length) {
        for (var i = 0; i < e.secs.list.length; i++) seq.push(e.secs.list[i].key);
      }
      function classOf(h) {
        if (/^(S|SUBJECTIVE|SUBJ|HPI|HISTORY)$/.test(h)) return 'S';
        if (/^(O|OBJECTIVE|OBJ|PHYSICAL|PHYSICAL EXAM|PHYSICAL EXAMINATION|EXAM|EXAMINATION)$/.test(h)) return 'O';
        if (/^(A|ASSESSMENT|ASSESS|IMPRESSION)$/.test(h)) return 'A';
        if (/^(P|PLAN)$/.test(h)) return 'P';
        if (/^(A\/P|ASSESSMENT AND PLAN)$/.test(h)) return 'AP';
        return '';
      }
      var order = [], k;
      for (k = 0; k < seq.length; k++) { var c = classOf(seq[k]); if (c) order.push(c); }
      var iS = order.indexOf('S'), iO = order.indexOf('O');
      var iA = order.indexOf('A'), iP = order.indexOf('P'), iAP = order.indexOf('AP');
      if (iS < 0 || iO < 0) return false;
      if (iAP < 0 && (iA < 0 || iP < 0)) return false;
      if (iS > iO) return false;
      var apAt = (iAP >= 0) ? iAP : iA;
      if (iO > apAt) return false;
      if (iAP < 0 && iA > iP) return false;
      return true;
    },
    label: 'The SOAP structure is missing a section or the sections are out of order.',
    why: 'Use Subjective, Objective, then Assessment and Plan (separate or combined), in that order.'
  });

  chk({
    id: 'leveling-basis-current', sev: 'block', types: [T_SOAP, T_AP],
    run: function (e) {
      if (/(more than half|more than 50\s?%|>\s?50\s?%|majority of (the )?(time|visit))[^.]{0,60}(counsel|coordinat)/i.test(e.text)) return false;
      if (/\b\d{1,3}\s*minutes?\b/i.test(e.text)) return true;
      return /(\bMDM\b|medical decision making|independent (interpretation|historian)|prescription drug management|data reviewed|risk of )/i.test(e.text);
    },
    label: 'The visit level uses the retired ">50% counseling" construct, or states neither an MDM basis nor total time on the date of the encounter.',
    why: 'State the leveling basis exactly once - an MDM statement, or total time on the date of the encounter with a minute count.'
  });

  chk({
    id: 'reconciled-medication-list', sev: 'warn', types: [T_SOAP],
    run: function (e) {
      return has(/(medication(s)? reconcil\w*|reviewed the (current )?medication list|med rec (completed|performed)|current medications)/i, e.text);
    },
    label: 'No medication list or reconciliation statement for this visit.',
    why: 'Include the medication list or an explicit reconciliation statement.'
  });

  chk({
    id: 'exam-reverification', sev: 'warn', types: [T_SOAP],
    need: function (e) { return has(/\b(exam|examination)\b/i, e.text); },
    run: function (e) {
      return has(/(re-?examin\w*|re-?performed|repeated today|examined today|on exam today|today's exam|reassessed)/i, e.text);
    },
    label: 'The exam does not say what was re-performed at this visit versus carried from a prior exam.',
    why: 'Say which findings were re-performed today.'
  });

  chk({
    id: 'telehealth-modality', sev: 'warn', types: [T_SOAP],
    need: function (e) { return has(/telehealth|telemedicine|virtual visit|video visit/i, e.text); },
    run: function (e) {
      return has(/(audio[- ]video|audio[- ]only|video and audio|two-way audio)/i, e.text) &&
        has(/(patient (was )?located|patient location|consent)/i, e.text);
    },
    label: 'A telehealth visit is missing its modality, or the patient location or consent.',
    why: 'State audio-video versus audio-only, the patient location, and consent.'
  });

  chk({
    id: 'soap.allergies-near-top', sev: 'warn', types: [T_SOAP],
    run: function (e) { return has(/allerg(y|ies)|NKDA/i, e.text); },
    label: 'Allergies are not stated.',
    why: 'State allergies, including NKDA, near the top of the note.'
  });

  chk({
    id: 'soap.interval-anchor', sev: 'warn', types: [T_SOAP],
    run: function (e) {
      return has(/(since (the )?last (visit|procedure)|interval|compared (with|to)|improved from|worse than|at the .{0,20}visit|previous visit)/i, e.text);
    },
    label: 'The response to treatment is not anchored to a prior value and date.',
    why: 'Anchor every comparison to a prior value and a prior date.'
  });

  /* =========================================================================
   * ENVIRONMENT BUILDER - one pass, everything the checks read.
   * ========================================================================= */
  var ANAT = /\b(knee|shoulder|hip|elbow|wrist|ankle|foot|hand|sacroiliac|facet|medial branch|leg|arm|paraspinal|paravertebral|trochanter|glenohumeral|subacromial|extremity|joint|[CTLS]\d{1,2})\b/i;
  var DRUG = /\b(lidocaine|bupivacaine|ropivacaine|marcaine|xylocaine|triamcinolone|Kenalog|methylprednisolone|Depo.?Medrol|dexamethasone|betamethasone|Celestone|iohexol|Omnipaque|iopamidol|Isovue|iodixanol|Visipaque|midazolam|Versed|fentanyl|propofol|gabapentin|pregabalin|duloxetine|meloxicam|ibuprofen|naproxen|oxycodone|hydrocodone|morphine|tramadol|methadone|buprenorphine|tizanidine|cyclobenzaprine|baclofen|celecoxib|diclofenac|prednisone|naloxone|alprazolam|lorazepam|clonazepam|diazepam)\b/i;
  var CONTROLLED = /\b(oxycodone|hydrocodone|morphine|tramadol|methadone|buprenorphine|hydromorphone|oxymorphone|codeine|fentanyl|alprazolam|lorazepam|clonazepam|diazepam|gabapentin|pregabalin)\b/i;
  var OPIOID = /\b(oxycodone|hydrocodone|morphine|tramadol|methadone|buprenorphine|hydromorphone|oxymorphone|codeine|fentanyl)\b/i;
  var PROC_TOKEN = /\b(injection|block|epidural|transforaminal|interlaminar|radiofrequency|neurotomy|rhizotomy|ablation|medial branch|arthrocentesis|aspiration|trigger point|genicular|sacroiliac|facet)\b/i;
  var SPECIAL_TESTS = ['Spurling', 'crossed SLR', 'straight leg raise', 'SLR', 'slump', 'Lasegue', 'FABER', 'Patrick', 'Gaenslen', 'thigh thrust', 'sacral thrust', 'Kemp', 'facet loading', 'Hoffmann', 'Babinski', 'clonus', 'Romberg', 'tandem gait', 'log roll', 'FADIR', 'Ober', 'Thomas', 'Trendelenburg', 'Hawkins', 'Neer', 'drop arm', 'empty can', 'Speed', 'Yergason', 'apprehension', 'McMurray', 'Lachman', 'pivot shift', 'Phalen', 'Tinel', 'Finkelstein', 'Waddell'];

  function tokenize(s) { return String(s || '').split(/\s+/); }

  function lateralitiesOf(text) {
    var s = String(text || '')
      .replace(/contralateral( oblique)?/gi, ' ')
      .replace(/(left|right|semi)[- ]lateral decubitus/gi, ' ')
      .replace(/ipsilateral/gi, ' ')
      .replace(/(left|right) (hand|side of the table)/gi, ' ')
      .replace(/\bleft (work|his|her|their|the) (job|house|hospital|ED|ER)\b/gi, ' ')
      .replace(/\bleft untreated\b/gi, ' ');
    var out = [];
    var sents = sentencesOf(s);
    for (var i = 0; i < sents.length; i++) {
      var sn = sents[i];
      if (/comparison|for reference|prior (injection|procedure)|history of|previously|last (year|month|visit)/i.test(sn)) continue;
      var toks = tokenize(sn);
      for (var j = 0; j < toks.length; j++) {
        var lm = toks[j].match(/^\(?(left|right|bilateral|bilat|lt|rt)\)?[.,;:]?$/i);
        if (!lm) continue;
        var side = lm[1].toLowerCase();
        if (side === 'lt') side = 'left';
        if (side === 'rt') side = 'right';
        if (side === 'bilat') side = 'bilateral';
        var lo = Math.max(0, j - 6), hi = Math.min(toks.length, j + 7);
        var anat = '';
        for (var k = j + 1; k < hi && !anat; k++) { var a = toks[k].match(ANAT); if (a) anat = a[0].toLowerCase(); }
        for (var k2 = j - 1; k2 >= lo && !anat; k2--) { var b = toks[k2].match(ANAT); if (b) anat = b[0].toLowerCase(); }
        if (anat) out.push({ side: side, anat: anat.replace(/\s+/g, '') });
      }
    }
    return out;
  }

  function levelsIn(s) {
    var out = [], m;
    var re = /\b([CTLS])(1[0-2]|[1-9])\s*[-\/]?\s*(?:([CTLS])?(1[0-2]|[1-9]))?\b/g;
    re.lastIndex = 0;
    while ((m = re.exec(String(s || ''))) !== null) {
      var a = m[1].toUpperCase() + m[2];
      var key = m[4] ? (a + '-' + (m[3] ? m[3].toUpperCase() : m[1].toUpperCase()) + m[4]) : a;
      if (out.indexOf(key) < 0) out.push(key);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  function doseTriplesOf(text) {
    var out = [], m;
    var s = String(text || '');
    var re1 = /(\d+(?:\.\d+)?)\s*(?:mL|cc)\s+of\s+(\d+(?:\.\d+)?)\s*%/gi;
    re1.lastIndex = 0;
    while ((m = re1.exec(s)) !== null) {
      var tail = s.slice(m.index, m.index + 140);
      var d = tail.match(/(\d+(?:\.\d+)?)\s*mg\b/i);
      if (d) out.push({ stated: parseFloat(d[1]), computed: parseFloat(m[1]) * parseFloat(m[2]) * 10 });
      if (m.index === re1.lastIndex) re1.lastIndex++;
    }
    var re2 = /(\d+(?:\.\d+)?)\s*(?:mL|cc)\s+of\s+(\d+(?:\.\d+)?)\s*mg\s*\/\s*mL/gi;
    re2.lastIndex = 0;
    while ((m = re2.exec(s)) !== null) {
      var tail2 = s.slice(m.index, m.index + 140);
      var d2 = tail2.match(/(?:=|total(?:ing)?|for a total of)\s*(\d+(?:\.\d+)?)\s*mg\b/i);
      if (d2) out.push({ stated: parseFloat(d2[1]), computed: parseFloat(m[1]) * parseFloat(m[2]) });
      if (m.index === re2.lastIndex) re2.lastIndex++;
    }
    return out;
  }

  var NEG_TOKENS = ['no', 'not', 'none', 'never', 'without', 'negative', 'denies', 'absent', 'unremarkable', 'all', 'any', 'each'];

  function shingles(s) {
    var w = String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    var out = {};
    for (var i = 0; i < w.length; i++) out[w[i]] = (out[w[i]] || 0) + 1;
    return { set: out, n: w.length };
  }

  function dice(a, b) {
    var A = shingles(a), B = shingles(b);
    if (!A.n || !B.n) return 0;
    var inter = 0;
    for (var k in A.set) if (Object.prototype.hasOwnProperty.call(B.set, k)) inter += Math.min(A.set[k], B.set[k]);
    return (2 * inter) / (A.n + B.n);
  }

  function negCounts(s) {
    var w = String(s || '').toLowerCase().match(/[a-z]+/g) || [];
    var c = {};
    for (var i = 0; i < w.length; i++) if (NEG_TOKENS.indexOf(w[i]) >= 0) c[w[i]] = (c[w[i]] || 0) + 1;
    return c;
  }

  function sameNeg(a, b) {
    var ca = negCounts(a), cb = negCounts(b), k;
    for (k in ca) if (Object.prototype.hasOwnProperty.call(ca, k) && ca[k] !== (cb[k] || 0)) return false;
    for (k in cb) if (Object.prototype.hasOwnProperty.call(cb, k) && cb[k] !== (ca[k] || 0)) return false;
    return true;
  }

  function buildEnv(text, type, ctx) {
    var e = {};
    e.text = String(text || '');
    e.type = type;
    e.ctx = ctx || {};
    e.masked = maskOf(e.text);
    e.words = wordCount(e.text);
    e.sents = sentencesOf(e.text);
    e.heads = headingsOf(e.text);
    e.secs = sectionsOf(e.text);
    e.cls = procClassOf(e.text, e.ctx);

    /* template comparison, only when a template was actually in use */
    e.tplText = (typeof e.ctx.template === 'string' && e.ctx.template.replace(/\s+/g, '') !== '') ? e.ctx.template : '';
    e.tplHeads = e.tplText ? headingsOf(e.tplText) : [];
    e.gaps = [];
    e.protectedLines = [];
    e.negationBreaks = [];
    if (e.tplHeads.length) {
      var noteKeys = [], i;
      for (i = 0; i < e.heads.length; i++) noteKeys.push(normHead(e.heads[i].label));
      var wanted = [];
      for (i = 0; i < e.tplHeads.length; i++) {
        var key = normHead(e.tplHeads[i].label);
        if (wanted.indexOf(key) < 0) wanted.push(key);
      }
      var present = [];
      for (i = 0; i < wanted.length; i++) {
        if (noteKeys.indexOf(wanted[i]) >= 0) { present.push(wanted[i]); }
        else {
          e.gaps.push({
            heading: e.tplHeads[i] ? e.tplHeads[i].label : wanted[i], kind: 'missing',
            why: 'This template section is absent from the note. Reproduce it verbatim, and fill it or mark it not applicable.'
          });
        }
      }
      /* order: the present ones must appear in the template's relative order */
      var lastAt = -1;
      for (i = 0; i < present.length; i++) {
        var at = noteKeys.indexOf(present[i]);
        if (at < lastAt) {
          e.gaps.push({ heading: present[i], kind: 'reordered', why: 'This section appears out of the template\'s order.' });
          break;
        }
        lastAt = at;
      }
      /* extras beyond the template, minus the standard whitelist */
      var WL = ['ADDENDUM', 'CODES'];
      for (i = 0; i < noteKeys.length; i++) {
        if (wanted.indexOf(noteKeys[i]) < 0 && WL.indexOf(noteKeys[i]) < 0) {
          e.gaps.push({ heading: e.heads[i].label, kind: 'extra', why: 'This heading is not in the bound template. Remove it.' });
        }
      }
      /* protected boilerplate lines: no slot markers, not a heading, prose */
      var tl = e.tplText.split(/\r?\n/);
      var nl = e.text.split(/\r?\n/);
      for (i = 0; i < tl.length; i++) {
        var line = tl[i].trim();
        if (!line || line.length < 25) continue;
        if (/[\[\]{}<>@]|_{3,}|\*{3,}/.test(line)) continue;
        if (headingsOf(line).length) continue;
        if (/\((dictate|choose|if applicable|insert)/i.test(line)) continue;
        e.protectedLines.push(line);
      }
      for (i = 0; i < e.protectedLines.length; i++) {
        var p = e.protectedLines[i], best = 0, bestLine = '';
        for (var j = 0; j < nl.length; j++) {
          var d = dice(p, nl[j]);
          if (d > best) { best = d; bestLine = nl[j].trim(); }
        }
        if (best >= 0.55 && !sameNeg(p, bestLine)) {
          e.negationBreaks.push({ template: p.slice(0, 90), note: bestLine.slice(0, 90) });
        }
      }
    }

    e.lateralities = lateralitiesOf(e.text);

    /* op-note title vs technique */
    var techSec = null, k2;
    for (k2 = 0; k2 < e.secs.list.length; k2++) {
      if (/^(TECHNIQUE|PROCEDURE IN DETAIL|DESCRIPTION OF PROCEDURE|PROCEDURE DETAIL|DETAILS OF PROCEDURE)$/.test(e.secs.list[k2].key)) { techSec = e.secs.list[k2]; break; }
    }
    e.techniqueText = techSec ? techSec.body : '';
    e.techniqueLevels = levelsIn(e.techniqueText);
    var titleSec = null;
    for (k2 = 0; k2 < e.secs.list.length; k2++) {
      if (/^(PROCEDURE|PROCEDURES|PROCEDURE PERFORMED|PROCEDURES PERFORMED|OPERATION)$/.test(e.secs.list[k2].key)) { titleSec = e.secs.list[k2]; break; }
    }
    e.titleLevels = levelsIn(titleSec ? titleSec.body : e.text.slice(0, 800));

    var medsSec = null;
    for (k2 = 0; k2 < e.secs.list.length; k2++) {
      if (/^(MEDICATIONS|MEDICATION|INJECTATE|DRUGS ADMINISTERED|MEDICATIONS ADMINISTERED)$/.test(e.secs.list[k2].key)) { medsSec = e.secs.list[k2]; break; }
    }
    e.medsText = medsSec ? medsSec.body : '';

    e.hasDrug = DRUG.test(e.text);
    e.doseTriples = doseTriplesOf(e.text);

    /* plan section and problem list */
    var planSec = null;
    for (k2 = 0; k2 < e.secs.list.length; k2++) {
      if (/^(PLAN|ASSESSMENT AND PLAN|ASSESSMENT\/PLAN|A\/P|IMPRESSION AND PLAN)$/.test(e.secs.list[k2].key)) { planSec = e.secs.list[k2]; break; }
    }
    e.planText = planSec ? planSec.body : '';
    var assessSec = null;
    for (k2 = 0; k2 < e.secs.list.length; k2++) {
      if (/^(ASSESSMENT|IMPRESSION|ASSESSMENT AND PLAN|ASSESSMENT\/PLAN|A\/P)$/.test(e.secs.list[k2].key)) { assessSec = e.secs.list[k2]; break; }
    }
    var problemScope = assessSec ? assessSec.body : (e.type === T_AP ? e.text : '');
    e.problems = [];
    e.firstProblemAt = -1;
    if (problemScope) {
      var plines = problemScope.split(/\r?\n/);
      var cur = null;
      for (k2 = 0; k2 < plines.length; k2++) {
        if (/^\s*(#\s*)?(\d{1,2}[.):\-]|[-*])\s+\S/.test(plines[k2])) {
          if (cur) e.problems.push(cur);
          cur = plines[k2];
          if (e.firstProblemAt < 0) e.firstProblemAt = e.text.indexOf(plines[k2].trim());
        } else if (cur != null) { cur += '\n' + plines[k2]; }
      }
      if (cur) e.problems.push(cur);
    }

    var planScope = e.planText || e.text;
    e.plansProcedure = PROC_TOKEN.test(planScope) &&
      /\b(will|plan|planned|schedule|scheduled|proceed|recommend|offered|elect)\w*\b/i.test(planScope);
    e.plansFirstProcedure = e.plansProcedure &&
      !/\b(prior|previous|last|s\/p|status post|history of|repeat|second|third|confirmatory|another|again|\d+ (month|year)s ago)\b/i.test(planScope);
    e.hasPriorProcedure = /\b(prior|previous|last|s\/p|status post|history of|underwent|received)\b[^.]{0,60}(injection|block|epidural|radiofrequency|ablation|neurotomy|medial branch)/i.test(e.text) ||
      /\b(injection|block|epidural|radiofrequency|ablation|neurotomy|medial branch)\b[^.]{0,60}\b(in|on|last)\b[^.]{0,30}(\d{1,2}\/\d{1,2}|\d+\s*(month|week|year)s? ago)/i.test(e.text);

    var rxScope = planScope;
    e.prescribesControlled = CONTROLLED.test(rxScope) &&
      /\b(prescrib|refill|continue|start|increase|decrease|dispense|#\s?\d|tablet|capsule|q\d+h|daily|BID|TID|QID)\b/i.test(rxScope);
    e.prescribesOpioid = OPIOID.test(rxScope) &&
      /\b(prescrib|refill|continue|start|increase|decrease|dispense|#\s?\d|tablet|capsule|q\d+h|daily|BID|TID|QID)\b/i.test(rxScope);

    var rosSec = null;
    for (k2 = 0; k2 < e.secs.list.length; k2++) {
      if (/^(ROS|REVIEW OF SYSTEMS)$/.test(e.secs.list[k2].key)) { rosSec = e.secs.list[k2]; break; }
    }
    e.rosBody = rosSec ? rosSec.body : '';

    e.specialTests = [];
    for (k2 = 0; k2 < SPECIAL_TESTS.length; k2++) {
      var name = SPECIAL_TESTS[k2];
      var rx = new RegExp('\\b' + name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + "(?:'s)?\\b", 'i');
      var at = e.text.search(rx);
      if (at < 0) continue;
      e.specialTests.push({ name: name, scope: e.text.slice(at, at + 160) });
    }

    e.region = '';
    if (/\b(cervical|neck|C[1-7]\b|myelopath)/i.test(e.text)) e.region = 'cervical';
    if (/\b(lumbar|lumbosacral|low back|L[1-5]\b|S1\b|sciatic|sacroiliac)/i.test(e.text)) {
      e.region = (e.region === 'cervical' && /\bcervical\b/i.test(e.text.slice(0, 400))) ? 'cervical' : 'lumbosacral';
    }

    e.subtype = e.ctx.subtype || '';
    if (!e.subtype) {
      if (/day of (the )?procedure|H&P update|history and physical.{0,30}(review|update)/i.test(e.text)) e.subtype = 'day-of-update';
      else if (/pre-?procedure (evaluation|visit|assessment)/i.test(e.text)) e.subtype = 'pre-procedure';
    }
    return e;
  }

  /* =========================================================================
   * grade(noteText, noteType, ctx)
   * ctx: { template, templateName, procedureClass, subtype }
   * -> { score, pass, floor, noteType, missing[], forbidden[], templateGaps[],
   *      tips[], counts{}, skipped[] }
   * ========================================================================= */
  function grade(noteText, noteType, ctx) {
    var type = normalizeType(noteType);
    var text = String(noteText == null ? '' : noteText);
    var e = buildEnv(text, type, ctx);

    var missing = [], skipped = [], tips = [];
    var blockTotal = 0, blockPass = 0, warnTotal = 0, warnPass = 0;

    for (var i = 0; i < CHECKS.length; i++) {
      var C = CHECKS[i];
      if (!inList(type, C.types)) continue;
      var applicable = true;
      try { if (typeof C.need === 'function') applicable = !!C.need(e); }
      catch (err) { applicable = false; }
      if (!applicable) { skipped.push(C.id); continue; }
      var ok = false;
      try { ok = !!C.run(e); } catch (err2) { ok = false; }
      if (C.sev === 'block') { blockTotal++; if (ok) blockPass++; }
      else { warnTotal++; if (ok) warnPass++; }
      if (!ok) missing.push({ id: C.id, severity: C.sev, label: C.label, why: C.why || '' });
    }

    var forbidden = runForbidden(e);
    /* a forbidden hit is a failure of its own rule; block-tier hits gate the
     * pass exactly as a failed block check does. */
    for (var f = 0; f < forbidden.length; f++) {
      if (forbidden[f].severity === 'block') { blockTotal++; }
      else { warnTotal++; }
    }

    var templateGaps = e.gaps.slice(0);
    for (var g = 0; g < e.negationBreaks.length && g < 6; g++) {
      templateGaps.push({
        heading: e.negationBreaks[g].template, kind: 'boilerplate-altered',
        why: 'Template wording or a negation was changed. Reproduce it character-for-character.'
      });
    }

    var blockConf = blockTotal ? (blockPass / blockTotal) : 1;
    var warnConf = warnTotal ? (warnPass / warnTotal) : 1;
    var score = Math.round(100 * (W_BLOCK * blockConf + W_WARN * warnConf));
    if (score < 0) score = 0; if (score > 100) score = 100;

    var fl = floor(type);
    var blockFailures = (blockTotal - blockPass);
    var pass = (blockFailures === 0) && (score >= fl);

    /* tips: what to fix first, plus an honest note about what was not checked */
    for (var t = 0; t < missing.length && tips.length < 6; t++) {
      if (missing[t].severity === 'block') tips.push(missing[t].why || missing[t].label);
    }
    for (var t2 = 0; t2 < missing.length && tips.length < 8; t2++) {
      if (missing[t2].severity === 'warn') tips.push(missing[t2].why || missing[t2].label);
    }
    if (!e.tplText) tips.push('No template was supplied to the check, so template fidelity was not machine-verified.');
    tips.push('Source grounding, slot provenance and cross-encounter cloning are not machine-checked here. Read every number before signing.');

    return {
      version: VERSION,
      noteType: type,
      score: score,
      floor: fl,
      pass: pass,
      missing: missing,
      forbidden: forbidden,
      templateGaps: templateGaps,
      tips: tips,
      skipped: skipped,
      counts: {
        blockTotal: blockTotal, blockPass: blockPass,
        warnTotal: warnTotal, warnPass: warnPass,
        blockFailures: blockFailures,
        words: e.words, procedureClass: e.cls
      }
    };
  }

  /* =========================================================================
   * LEDGER - {ts, noteType, score, pass, regenerated}, capped at 500.
   * Namespaced through the app's uns() when it is there, so one browser
   * shared by two accounts does not blend two doctors' ledgers.
   * ========================================================================= */
  var LEDGER_SUFFIX = 'mlsNoteQualityLedgerV1';
  var LEDGER_CAP = 500;

  function ledgerKey() {
    try {
      if (W && typeof W.uns === 'function') {
        var k = W.uns(LEDGER_SUFFIX);
        if (k && typeof k === 'string') return k;
      }
    } catch (err) { }
    return LEDGER_SUFFIX;
  }

  function store() {
    try { return (W && W.localStorage) ? W.localStorage : null; } catch (err) { return null; }
  }

  function ledgerRead() {
    var s = store();
    if (!s) return [];
    try {
      var raw = s.getItem(ledgerKey());
      if (!raw) return [];
      var v = JSON.parse(raw);
      return (v && v.length) ? v : [];
    } catch (err) { return []; }
  }

  function ledgerRecord(entry) {
    entry = entry || {};
    var row = {
      ts: entry.ts || Date.now(),
      noteType: normalizeType(entry.noteType),
      score: (typeof entry.score === 'number') ? entry.score : null,
      pass: !!entry.pass,
      regenerated: !!entry.regenerated
    };
    var s = store();
    if (!s) return row;
    try {
      var rows = ledgerRead();
      rows.push(row);
      if (rows.length > LEDGER_CAP) rows = rows.slice(rows.length - LEDGER_CAP);
      s.setItem(ledgerKey(), JSON.stringify(rows));
    } catch (err) { }
    return row;
  }

  function ledgerStats() {
    var rows = ledgerRead();
    var out = { total: rows.length, passed: 0, failed: 0, regenerated: 0, avgScore: null, byType: {} };
    var sum = 0, n = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.pass) out.passed++; else out.failed++;
      if (r.regenerated) out.regenerated++;
      if (typeof r.score === 'number') { sum += r.score; n++; }
      var t = r.noteType || 'unknown';
      if (!out.byType[t]) out.byType[t] = { total: 0, passed: 0, regenerated: 0, sum: 0, n: 0, avgScore: null };
      var bt = out.byType[t];
      bt.total++;
      if (r.pass) bt.passed++;
      if (r.regenerated) bt.regenerated++;
      if (typeof r.score === 'number') { bt.sum += r.score; bt.n++; }
    }
    out.avgScore = n ? Math.round(sum / n) : null;
    for (var k in out.byType) {
      if (Object.prototype.hasOwnProperty.call(out.byType, k)) {
        var b = out.byType[k];
        b.avgScore = b.n ? Math.round(b.sum / b.n) : null;
      }
    }
    return out;
  }

  function ledgerClear() {
    var s = store();
    if (!s) return false;
    try { s.removeItem(ledgerKey()); return true; } catch (err) { return false; }
  }

  /* =========================================================================
   * PUBLIC API
   * ========================================================================= */
  var api = {
    version: VERSION,
    build: BUILD,
    installed: true,
    noteTypes: ALL_TYPES.slice(0),
    /* noteq-1.0.0 (b1169): the exported table is a FROZEN COPY. floor() reads
     * the private FLOORS and nothing else, so a caller that writes to the
     * exported object - deliberately or by accident - cannot lower the bar. */
    FLOORS: (function () {
      var c = {}, k;
      for (k in FLOORS) if (Object.prototype.hasOwnProperty.call(FLOORS, k)) c[k] = FLOORS[k];
      try { return Object.freeze(c); } catch (err) { return c; }
    })(),
    MAX_REGENERATIONS: MAX_REGENERATIONS,
    normalizeType: normalizeType,
    contractFor: contractFor,
    grade: grade,
    floor: floor,
    renderFindings: renderFindings,
    ledger: {
      key: ledgerKey,
      record: ledgerRecord,
      read: ledgerRead,
      stats: ledgerStats,
      clear: ledgerClear,
      cap: LEDGER_CAP
    },
    stats: ledgerStats
  };

  if (W) W.__mlsNoteQuality = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})();
