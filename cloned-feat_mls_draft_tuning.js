/* feat_mls_draft_tuning.js
 * Account-scoped, bounded controls for every AI draft family.
 *
 * This module owns preferences only. Clinical/legal truth, evidence rules,
 * coding validation, patient identity and Athena write confirmation remain
 * server/extension-owned and cannot be relaxed from Settings.
 */
(function () {
  'use strict';
  if (window.__mlsDraftTuning && window.__mlsDraftTuning.installed) return;

  var VERSION = '1.4.0';
  var STORE_KEY = 'draftTuningV1';
  var MAX_INSTRUCTIONS = 600;

  /* opnk-1.0.0 (2026-08-28): the ONE key the op-note generator reads. Written by
     the Op Note Room rail (feat_mls_opnote_room.js) and, since this change, by
     the Settings select as well - two surfaces, one stored value, so they can no
     longer disagree. Deliberately NOT a second source of truth: this module only
     mirrors what the generator already consults, and the generator's own reader
     is left untouched because tests/opnote-follow-modes-differ pins its exact
     shape (one uns() call, one getItem, five tplMode sites). Same three-value
     vocabulary the rail enforces; anything else reads as the generator's own
     default, 'adapt'. */
  var OPNOTE_ROOM_TPL_KEY = 'opNoteTemplateMode';
  var OPNOTE_GENERATOR_DEFAULT = 'adapt';
  /* Returns what the GENERATOR WILL ACTUALLY USE, including its default - not
     merely what is stored. Returning '' for "unset" and letting the caller fall
     back to the saved profile's own default was my first attempt and it left
     the exact case that matters broken: on a fresh account the key is unset, the
     generator uses 'adapt', and the shipped op-note profile says 'strict', so
     Settings would still have displayed a mode no draft was using. Mirroring the
     generator's default here makes the two agree by construction. */
  function opnoteRoomTemplateMode() {
    try {
      if (typeof window.uns !== 'function') return OPNOTE_GENERATOR_DEFAULT;
      var raw = String(localStorage.getItem(window.uns(OPNOTE_ROOM_TPL_KEY)) || '').trim();
      return (raw === 'strict' || raw === 'guide' || raw === 'adapt') ? raw : OPNOTE_GENERATOR_DEFAULT;
    } catch (e) { return OPNOTE_GENERATOR_DEFAULT; }
  }
  function opnoteRoomTemplateModeSet(mode) {
    var m = String(mode || '').trim();
    if (m !== 'strict' && m !== 'guide' && m !== 'adapt') return false;
    /* Write, then READ BACK before believing it: a restricted or full profile
       can refuse the write, and "saved" is a claim this app has been caught
       making without proof before. */
    var landed = false;
    try {
      if (typeof window.uns !== 'function') return false;
      localStorage.setItem(window.uns(OPNOTE_ROOM_TPL_KEY), m);
      landed = String(localStorage.getItem(window.uns(OPNOTE_ROOM_TPL_KEY)) || '') === m;
    } catch (e) { landed = false; }
    if (!landed) {
      try { if (typeof window.toast === 'function') window.toast('Op note template handling could not be saved on this device.', 'err'); } catch (e2) {}
    }
    return landed;
  }
  var MAX_SECTION_TEMPLATE = 2000;
  var MAX_SECTION_PROFILES = 8;
  var MAX_SECTION_EXAMPLE = 12000;
  var FAMILY_IDS = ['soap', 'hpi', 'ros', 'exam', 'assessment', 'plan', 'opnote', 'avs', 'referral', 'priorauth', 'legal_ime', 'copilot', 'studio_widget', 'coding', 'general_draft'];
  var FAMILY_LABELS = {
    soap: 'Visit note / SOAP',
    hpi: 'HPI section',
    ros: 'ROS section',
    exam: 'Exam section',
    assessment: 'Assessment section',
    plan: 'Plan / follow-up section',
    opnote: 'Procedure / operative note',
    avs: 'After-visit summary',
    referral: 'Referral letter',
    priorauth: 'Prior authorization / appeal',
    legal_ime: 'Legal / IME report',
    copilot: 'Copilot answers and drafts',
    studio_widget: 'AI Studio / widget builder',
    coding: 'Coding review',
    general_draft: 'Other clinical drafts'
  };
  var ENUMS = {
    length: ['concise', 'standard', 'detailed'],
    tone: ['clinical_neutral', 'patient_plain', 'warm_patient', 'payer_formal', 'legal_neutral', 'operational_concise'],
    structure: ['default', 'fixed_headings', 'problem_grouped', 'template_faithful'],
    hpiOrganization: ['chronological', 'oldcarts', 'problem_focused'],
    sentenceCap: ['auto', '3', '5', '8'],
    templateMode: ['strict', 'adapt', 'guide'],
    readingLevel: ['grade6', 'grade8', 'clinical'],
    maxWords: ['150', '250', '400'],
    recipientStyle: ['consultative', 'specialist_concise', 'payer_formal'],
    placeholderPolicy: ['explicit', 'omit'],
    citationStyle: ['source_id', 'date_inline', 'section_end'],
    certaintyStyle: ['explicit', 'standard'],
    answerShape: ['direct', 'bullets', 'brief_then_detail'],
    density: ['compact', 'balanced', 'detailed'],
    visualTheme: ['practice', 'clinical', 'neutral'],
    confidenceDisplay: ['always', 'uncertain_only'],
    payerPresentation: ['code_first', 'description_first'],
    sectionMode: ['chronological', 'problem_focused', 'template_fields', 'pertinent_only', 'systems_by_system', 'focused', 'systematic', 'normal_template', 'problem_list', 'ranked_differential', 'narrative', 'problem_based', 'action_list', 'follow_up_first']
  };
  var SECTION_FAMILIES = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
  /* Every generated artifact gets the same reusable-format contract.  The
     five structured SOAP sections keep their richer clinical modes below;
     the remaining families use the bounded generic modes so settings never
     silently fall back to coarse length/tone/structure-only controls. */
  var PROFILE_FAMILIES = FAMILY_IDS.slice();
  var GENERIC_PROFILE_DEFAULTS = {
    soap: [
      { id: 'standard', label: 'Standard SOAP', when: 'Most visits', sectionMode: 'default', templateMode: 'adapt', instructions: 'Preserve the SOAP contract and keep each section evidence-grounded.' },
      { id: 'problem_focused', label: 'Problem-focused SOAP', when: 'Single active complaint', sectionMode: 'problem_grouped', templateMode: 'adapt', instructions: 'Lead with the addressed problem while retaining every required SOAP heading.' }
    ],
    opnote: [
      { id: 'standard', label: 'Standard procedure note', when: 'Routine completed procedure', sectionMode: 'template_fields', templateMode: 'strict', instructions: 'Use the selected procedure template and state only documented procedural facts.' },
      { id: 'complication', label: 'Complication-focused procedure note', when: 'Complication or unexpected event documented', sectionMode: 'problem_grouped', templateMode: 'guide', instructions: 'Make the documented event, response, and disposition easy to find; do not infer causality.' }
    ],
    avs: [
      { id: 'standard', label: 'Standard after-visit summary', when: 'Most visits', sectionMode: 'action_list', templateMode: 'adapt', instructions: 'Use plain language, clear actions, medications, follow-up, and documented precautions.' },
      { id: 'education', label: 'Education-first after-visit summary', when: 'Patient education is the main deliverable', sectionMode: 'narrative', templateMode: 'guide', instructions: 'Explain documented instructions in patient-friendly language without adding new medical advice.' }
    ],
    referral: [
      { id: 'standard', label: 'Standard referral letter', when: 'Routine referral', sectionMode: 'template_fields', templateMode: 'adapt', instructions: 'State the referral question and relevant documented findings before background detail.' },
      { id: 'urgent', label: 'Urgent referral letter', when: 'Urgent or expedited referral documented', sectionMode: 'action_list', templateMode: 'guide', instructions: 'Lead with urgency, reason, and requested action only when supported by the source.' }
    ],
    priorauth: [
      { id: 'standard', label: 'Standard prior authorization', when: 'Routine coverage request', sectionMode: 'problem_grouped', templateMode: 'adapt', instructions: 'Present requested service, diagnosis, prior treatment, and medical necessity from documented evidence.' },
      { id: 'appeal', label: 'Appeal / denial response', when: 'Coverage denial or appeal documented', sectionMode: 'narrative', templateMode: 'guide', instructions: 'Address the documented denial rationale directly and distinguish facts from requested reconsideration.' }
    ],
    legal_ime: [
      { id: 'standard', label: 'Standard legal / IME report', when: 'Most reports', sectionMode: 'template_fields', templateMode: 'strict', instructions: 'Use neutral, source-linked language; separate history, opinions, limitations, and unanswered questions.' },
      { id: 'causation', label: 'Causation-focused report', when: 'Causation or apportionment is specifically requested', sectionMode: 'problem_grouped', templateMode: 'guide', instructions: 'Address only the requested causation question and label evidence limits and uncertainty explicitly.' }
    ],
    copilot: [
      { id: 'standard', label: 'Direct Copilot answer', when: 'Most clinician questions', sectionMode: 'default', templateMode: 'adapt', instructions: 'Answer directly from the available snapshot and say exactly what source is missing.' },
      { id: 'actionable', label: 'Action-oriented Copilot answer', when: 'The clinician asks what to do next', sectionMode: 'action_list', templateMode: 'guide', instructions: 'Separate documented facts, possible next steps, and clinician decisions.' }
    ],
    studio_widget: [
      { id: 'standard', label: 'Standard AI Studio output', when: 'Most studio requests', sectionMode: 'template_fields', templateMode: 'adapt', instructions: 'Return the requested artifact in the caller contract with accessible, maintainable structure.' },
      { id: 'compact', label: 'Compact studio output', when: 'Small embedded widget or constrained surface', sectionMode: 'default', templateMode: 'guide', instructions: 'Keep the artifact compact without dropping required data or safety text.' }
    ],
    coding: [
      { id: 'standard', label: 'Standard coding review', when: 'Most coding reviews', sectionMode: 'problem_grouped', templateMode: 'adapt', instructions: 'Show supported codes, rationale, and uncertainty; never invent documentation or alter code validity.' },
      { id: 'payer', label: 'Payer-facing coding review', when: 'Payer or audit response is requested', sectionMode: 'template_fields', templateMode: 'guide', instructions: 'Lead with the documented code and supporting elements in the configured payer presentation.' }
    ],
    general_draft: [
      { id: 'standard', label: 'Standard clinical draft', when: 'Most supporting drafts', sectionMode: 'default', templateMode: 'adapt', instructions: 'Follow the caller output contract and use only source-supported clinical facts.' },
      { id: 'summary', label: 'Concise clinical summary', when: 'A short handoff or chart summary is requested', sectionMode: 'narrative', templateMode: 'guide', instructions: 'Prioritize the requested clinical question and omit unrelated detail.' }
    ]
  };
  var SECTION_MODES = {
    hpi: [['chronological', 'Chronological story'], ['problem_focused', 'Problem-focused'], ['template_fields', 'Saved template fields']],
    ros: [['pertinent_only', 'Pertinent positives / negatives'], ['systems_by_system', 'System-by-system'], ['template_fields', 'Saved template fields']],
    exam: [['focused', 'Focused exam'], ['systematic', 'Systematic exam'], ['normal_template', 'Normal-exam template']],
    assessment: [['problem_list', 'Problem list'], ['ranked_differential', 'Ranked differential'], ['narrative', 'Clinical narrative']],
    plan: [['problem_based', 'Problem-based actions'], ['action_list', 'Action list'], ['follow_up_first', 'Follow-up first']]
  };
  var SECTION_MODE_LABELS = {
    hpi: 'HPI format', ros: 'ROS format', exam: 'Exam format', assessment: 'Assessment format', plan: 'Plan format'
  };
  ['soap', 'opnote', 'avs', 'referral', 'priorauth', 'legal_ime', 'copilot', 'studio_widget', 'coding', 'general_draft'].forEach(function (id) {
    if (!SECTION_MODES[id]) SECTION_MODES[id] = [['default', 'Default format'], ['template_fields', 'Saved template fields'], ['problem_grouped', 'Group by problem'], ['narrative', 'Narrative format'], ['action_list', 'Action list']];
    if (!SECTION_MODE_LABELS[id]) SECTION_MODE_LABELS[id] = FAMILY_LABELS[id] + ' format';
  });
  var SECTION_TEMPLATE_DEFAULT = 'adapt';
  var SECTION_PROFILE_DEFAULTS = {
    hpi: [
      { id: 'standard', label: 'Standard HPI', when: 'Most visits', sectionMode: 'chronological', templateMode: 'adapt', instructions: '' },
      { id: 'focused', label: 'Focused HPI', when: 'Single active complaint', sectionMode: 'problem_focused', templateMode: 'guide', instructions: 'Lead with the actively addressed complaint and preserve documented chronology.' }
    ],
    ros: [
      { id: 'pertinent', label: 'Pertinent ROS', when: 'Focused problem visit', sectionMode: 'pertinent_only', templateMode: 'adapt', instructions: 'Include only source-supported pertinent positives and negatives.' },
      { id: 'systematic', label: 'Systematic ROS', when: 'Broad or multi-system visit', sectionMode: 'systems_by_system', templateMode: 'guide', instructions: 'Organize supported findings by system; do not infer normal systems.' }
    ],
    exam: [
      { id: 'focused', label: 'Focused exam', when: 'Single active complaint', sectionMode: 'focused', templateMode: 'adapt', instructions: 'Lead with the documented exam relevant to the active problem.' },
      { id: 'normal', label: 'Normal-exam template', when: 'Routine visit with documented normal findings', sectionMode: 'normal_template', templateMode: 'strict', instructions: 'Use normal-template language only for findings explicitly documented.' }
    ],
    assessment: [
      { id: 'problem_list', label: 'Problem list', when: 'Diagnoses are established', sectionMode: 'problem_list', templateMode: 'adapt', instructions: 'Order documented diagnoses by the problems addressed today.' },
      { id: 'differential', label: 'Ranked differential', when: 'Diagnosis remains uncertain', sectionMode: 'ranked_differential', templateMode: 'guide', instructions: 'Rank only diagnoses supported by the source and label uncertainty.' }
    ],
    plan: [
      { id: 'routine', label: 'Plan A — routine follow-up', when: 'Stable routine follow-up', sectionMode: 'problem_based', templateMode: 'adapt', instructions: 'Use problem-based actions, medications, monitoring, and routine follow-up when documented.' },
      { id: 'escalation', label: 'Plan B — escalation / precautions', when: 'Escalation, red flags, or close follow-up documented', sectionMode: 'follow_up_first', templateMode: 'guide', instructions: 'Lead with documented follow-up, escalation criteria, and return precautions; never invent them.' }
    ]
  };
  var EXTRA = {
    hpi: { key: 'hpiOrganization', label: 'HPI organization', choices: [['chronological', 'Chronological'], ['oldcarts', 'OLDCARTS when supported'], ['problem_focused', 'Problem-focused']] },
    /* dtc-1.0.0 (2026-08-27): the Op Note "Template handling" select is GONE
       because it could never do anything. PROFILE_FAMILIES is FAMILY_IDS
       verbatim, so opnote takes the isProfileFamily branch, and that branch
       assigns `merged.templateMode = selected.templateMode` unconditionally on
       every read and every capture - overwriting whatever this control wrote.
       Two controls were bound to one stored field and the loser was always this
       one. The live control is the per-format Template handling inside the saved
       format itself. Deleting the dead twin is safer than adding a second
       writer to a field that already has one. */
    avs: { key: 'readingLevel', label: 'Reading level', choices: [['grade6', 'Plain language (grade 6)'], ['grade8', 'Plain language (grade 8)'], ['clinical', 'Clinical language']] },
    referral: { key: 'recipientStyle', label: 'Recipient style', choices: [['consultative', 'Consultative'], ['specialist_concise', 'Specialist concise'], ['payer_formal', 'Payer formal']] },
    priorauth: { key: 'placeholderPolicy', label: 'Missing facts', choices: [['explicit', 'Show explicit placeholders'], ['omit', 'Omit unsupported optional sections']] },
    legal_ime: { key: 'citationStyle', label: 'Evidence references', choices: [['source_id', 'Source IDs'], ['date_inline', 'Dates inline'], ['section_end', 'Evidence at section end']] },
    copilot: { key: 'answerShape', label: 'Answer shape', choices: [['direct', 'Direct answer'], ['bullets', 'Bullets'], ['brief_then_detail', 'Brief answer, then detail']] },
    studio_widget: { key: 'density', label: 'Widget density', choices: [['compact', 'Compact'], ['balanced', 'Balanced'], ['detailed', 'Detailed']] },
    coding: { key: 'confidenceDisplay', label: 'Confidence display', choices: [['always', 'Always show confidence'], ['uncertain_only', 'Emphasize uncertainty only']] }
  };
  // These bounded family defaults are also understood by the hosted backend.
  // Keep them in the direct-key prompt so both transports apply the same
  // account-scoped contract even though the compact Settings UI exposes only
  // the primary family-specific selector above.
  var SECONDARY = {
    hpi: [{ key: 'sentenceCap', label: 'HPI sentence cap' }],
    avs: [{ key: 'maxWords', label: 'Maximum target length (words)' }],
    legal_ime: [{ key: 'certaintyStyle', label: 'Certainty wording' }],
    studio_widget: [{ key: 'visualTheme', label: 'Visual theme' }],
    coding: [{ key: 'payerPresentation', label: 'Coding presentation' }]
  };

  function has(arr, value) { return arr.indexOf(String(value || '')) >= 0; }
  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, max);
  }
  function scrubReusableText(value) {
    return String(value == null ? '' : value)
      .replace(/\bpatient\s+[A-Z][A-Za-z'’-]{1,40}\s+[A-Z][A-Za-z'’-]{1,40}\b/g, '[patient-specific name removed]')
      .replace(/\b(?:MRN|DOB|SSN)\s*[:#-]?\s*[A-Za-z0-9/.-]{3,32}\b/gi, '[patient-specific identifier removed]')
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email removed]');
  }
  function cleanReusableText(value, max) {
    return cleanText(scrubReusableText(value), max);
  }
  function cleanTemplate(value, max) {
    return scrubReusableText(value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim().slice(0, max).trim();
  }
  function familyId(value) { return has(FAMILY_IDS, value) ? String(value) : 'soap'; }
  function storageKey() {
    try {
      if (typeof window.uns === 'function') return window.uns(STORE_KEY);
      if (typeof uns === 'function') return uns(STORE_KEY);
    } catch (e) {}
    return STORE_KEY;
  }
  /* Every editor/import session is owned by both the account namespace and
     the app's real session epoch.  The local boundary counter also catches a
     logout/account switch event when a synthetic or older shell does not
     publish __mlsSessionEpoch. */
  var storageBoundaryEpoch = 0;
  function sessionEpochValue() {
    try { return window.__mlsSessionEpoch == null ? '' : String(window.__mlsSessionEpoch); }
    catch (e) { return ''; }
  }
  function storageScope() {
    return { key: String(storageKey() || STORE_KEY), sessionEpoch: sessionEpochValue(), boundaryEpoch: storageBoundaryEpoch };
  }
  function scopeCurrent(scope) {
    if (!scope || typeof scope !== 'object') return false;
    return String(storageKey() || STORE_KEY) === scope.key &&
      sessionEpochValue() === scope.sessionEpoch && storageBoundaryEpoch === scope.boundaryEpoch;
  }
  function scopeError() {
    var error = new Error('The MLS account changed while this template was open. Nothing was saved. Reopen Settings and try again.');
    error.code = 'draft-tuning-account-changed';
    return error;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function sectionProfiles(id) {
    return clone(SECTION_PROFILE_DEFAULTS[id] || GENERIC_PROFILE_DEFAULTS[id] || []).map(function (row) {
      row.templateText = row.templateText || '';
      row.instructions = row.instructions || '';
      row.when = row.when || '';
      row.whenAuto = row.whenAuto ? 1 : 0;
      row.templateMode = row.templateMode || SECTION_TEMPLATE_DEFAULT;
      return row;
    });
  }
  function isProfileFamily(id) { return PROFILE_FAMILIES.indexOf(familyId(id)) >= 0; }
  function profileId(value, fallback) {
    var clean = cleanText(value, 48).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
    return clean || fallback;
  }
  function sanitizeSectionProfiles(id, input) {
    var defaults = sectionProfiles(id), rows = Array.isArray(input) ? input.slice(0, MAX_SECTION_PROFILES) : [];
    if (!rows.length) return defaults;
    var seen = {}, out = [];
    rows.forEach(function (row, index) {
      row = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
      var fallback = defaults[index] || defaults[0] || { id: 'default', label: 'Default' };
      var pid = profileId(row.id, fallback.id || ('format_' + (index + 1)));
      if (seen[pid]) pid = pid + '_' + (index + 1);
      seen[pid] = true;
      var modes = SECTION_MODES[id] || [];
      var modeValues = modes.map(function (item) { return item[0]; });
      out.push({
        id: pid,
        label: cleanReusableText(row.label || row.name || fallback.label || ('Format ' + (index + 1)), 80) || ('Format ' + (index + 1)),
        when: cleanReusableText(Object.prototype.hasOwnProperty.call(row, 'when') ? row.when : fallback.when, 180),
        /* tplauto-1.0.0: "MLS has already proposed a rule for this format".
           It rides inside the saved format, so a rule the doctor cleared
           stays cleared across reloads instead of being proposed again. */
        whenAuto: (Object.prototype.hasOwnProperty.call(row, 'whenAuto') ? row.whenAuto : fallback.whenAuto) ? 1 : 0,
        sectionMode: has(modeValues, row.sectionMode) ? String(row.sectionMode) : (fallback.sectionMode || modes[0][0]),
        templateMode: enumValue('templateMode', row.templateMode, fallback.templateMode || SECTION_TEMPLATE_DEFAULT),
        templateText: cleanTemplate(row.templateText || row.templateBody || row.template, MAX_SECTION_TEMPLATE),
        instructions: cleanReusableText(row.instructions, MAX_INSTRUCTIONS)
      });
    });
    return out.length ? out : defaults;
  }
  /* ===== fmt-1.0.0 (2026-09-02) — TEST-LANE ARTIFACTS ARE NOT THE DOCTOR'S
     FORMATS.
     On 2026-09-01 the owner's account was measured carrying saved formats named
     "QA HPI Template 2026 ..." and "Engineering Compliance Assessment Template".
     No doctor typed those; earlier test lanes did, through this same Settings
     editor. A saved format's NAME reaches a real generation (see memory:
     a-saved-profile-name-steered-the-note-model — an op-note-only library once
     turned a visit note into a 12-line operative report), so a leftover QA
     format is not cosmetic.
     THEY ARE HIDDEN, NOT DELETED. This filter is read-only and client-side: it
     runs on the pickers and on the tuning payload, never on a persistence path,
     and the account copy on the server is left exactly as it is. Settings names
     the count and offers one Remove — the doctor's click, not ours. If every
     saved format in a family matches, the shipped defaults are shown rather than
     an empty picker, because a picker with no options is a worse defect than the
     one being fixed. ===== */
  var TEST_LANE_PROFILE_NAME = /QA HPI Template|Engineering Compliance|QA .* Template 2026/i;
  function isTestLaneProfile(row) {
    try { return !!(row && TEST_LANE_PROFILE_NAME.test(String(row.label == null ? '' : row.label))); }
    catch (e) { return false; }
  }
  function withoutTestLaneProfiles(id, list) {
    var rows = Array.isArray(list) ? list : [];
    var kept = rows.filter(function (row) { return !isTestLaneProfile(row); });
    return kept.length ? kept : sectionProfiles(id);
  }
  /* The reader every PICKER and every TUNING PAYLOAD uses. sanitizeSectionProfiles
     stays the writer's sanitizer and keeps returning everything stored, so no
     saved row is ever dropped on its way back to disk. */
  function visibleSectionProfiles(id, input) {
    return withoutTestLaneProfiles(id, sanitizeSectionProfiles(id, input));
  }
  /* Every hidden artifact currently stored, family by family — the number the
     Settings line reports and the exact set its Remove deletes. */
  function testLaneProfiles() {
    var state = read(), out = [];
    PROFILE_FAMILIES.forEach(function (id) {
      var family = state.families[id];
      var rows = family && Array.isArray(family.profiles) ? family.profiles : [];
      rows.forEach(function (row) {
        if (isTestLaneProfile(row)) out.push({ family: id, id: row.id, label: row.label });
      });
    });
    return out;
  }
  /* The doctor's click. Removes only the matching rows, re-points any active
     selection that pointed at one, writes through this module's own persistence
     and then asks the app's EXISTING account sync to carry the deletion to the
     server. Returns how many were actually removed — 0 if the write did not
     land, so the caller can never claim a deletion that did not happen. */
  function removeTestLaneProfiles() {
    var state = read(), removed = 0;
    PROFILE_FAMILIES.forEach(function (id) {
      var family = state.families[id];
      if (!family || !Array.isArray(family.profiles)) return;
      var kept = family.profiles.filter(function (row) { return !isTestLaneProfile(row); });
      if (kept.length === family.profiles.length) return;
      removed += family.profiles.length - kept.length;
      family.profiles = kept.length ? kept : sectionProfiles(id);
      if (!family.profiles.some(function (row) { return row.id === family.activeProfile; })) {
        family.activeProfile = family.profiles[0].id;
      }
    });
    if (!removed) return 0;
    if (!write(state)) return 0;
    try { if (typeof window.syncPrefsToServer === 'function') window.syncPrefsToServer({ notify: false }); } catch (eSync) {}
    return removed;
  }
  function activeSectionProfile(id, profiles, requested) {
    var list = Array.isArray(profiles) && profiles.length ? profiles : sectionProfiles(id);
    var wanted = profileId(requested, '');
    return list.filter(function (row) { return row.id === wanted; })[0] || list[0];
  }

  /* A saved format's "Use when" line is an executable, conservative rule.
     Selection reads ONLY the explicitly delimited TODAY_TRANSCRIPT block. It
     never sees background chart history or prompt boilerplate, and it returns
     only a saved profile -- no source text is persisted or transported. */
  var MATCH_STOP_WORDS = {
    a: 1, an: 1, and: 1, are: 1, as: 1, at: 1, be: 1, by: 1, for: 1, from: 1,
    has: 1, have: 1, in: 1, is: 1, it: 1, most: 1, of: 1, on: 1, or: 1,
    patient: 1, section: 1, the: 1, this: 1, to: 1, use: 1, visit: 1, visits: 1,
    when: 1, with: 1, documented: 1, documentation: 1, format: 1, active: 1
  };
  var MATCH_CONCEPTS = [
    { weight: 16, rule: ['red flag', 'emergency', 'urgent'], evidence: ['red flag', 'cauda equina', 'saddle anesthesia', 'bowel or bladder change', 'bowel bladder change', 'new motor deficit', 'progressive neurologic deficit', 'emergency department', 'go to the er', 'urgent evaluation'] },
    { weight: 14, rule: ['escalation', 'worsening', 'progressive'], evidence: ['escalation', 'worsening', 'getting worse', 'progressive', 'new weakness', 'rapid decline', 'failed conservative care', 'no longer helping'] },
    { weight: 12, rule: ['close follow up', 'return precaution', 'precaution'], evidence: ['close follow up', 'follow up in one week', 'follow up in 1 week', 'follow up in two weeks', 'follow up in 2 weeks', 'return precaution', 'strict precaution', 'return sooner'] },
    { weight: 12, rule: ['uncertain', 'differential', 'diagnosis remains uncertain'], evidence: ['uncertain', 'unclear', 'differential', 'rule out', 'possible', 'possibly', 'may represent', 'could be', 'versus'] },
    { weight: 10, rule: ['broad', 'multi system', 'multiple complaint'], evidence: ['multi system', 'multisystem', 'multiple complaints', 'several complaints', 'more than one complaint'] },
    { weight: 9, rule: ['normal finding', 'normal exam'], evidence: ['normal exam', 'normal findings', 'within normal limits', 'neurovascularly intact', 'full range of motion', 'no tenderness'] },
    { weight: 8, rule: ['single complaint', 'single active complaint', 'focused problem'], evidence: ['single complaint', 'single active complaint', 'one complaint', 'focused problem', 'localized pain', 'only complaint'] },
    { weight: 8, rule: ['stable', 'routine follow up'], evidence: ['stable', 'unchanged', 'no change', 'doing well', 'improved', 'routine follow up', 'continue current treatment'] },
    { weight: 7, rule: ['established', 'confirmed diagnosis'], evidence: ['established diagnosis', 'confirmed diagnosis', 'diagnosed with', 'known diagnosis'] }
  ];
  function normalizeMatchText(value) {
    var text = String(value == null ? '' : value).toLowerCase();
    try { if (typeof text.normalize === 'function') text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function todayTranscript(value) {
    var raw = String(value == null ? '' : value);
    var match = /TODAY_TRANSCRIPT_BEGIN\s*([\s\S]*?)\s*TODAY_TRANSCRIPT_END/i.exec(raw);
    return match ? normalizeMatchText(match[1]).slice(0, 24000) : '';
  }
  function meaningfulTokens(value) {
    var seen = {}, out = [];
    normalizeMatchText(value).split(' ').forEach(function (token) {
      if (!token || token.length < 3 || MATCH_STOP_WORDS[token] || seen[token]) return;
      seen[token] = true; out.push(token);
    });
    return out;
  }
  function affirmedPhrase(source, phrase) {
    phrase = normalizeMatchText(phrase);
    if (!source || !phrase) return false;
    var from = 0;
    while (from < source.length) {
      var index = source.indexOf(phrase, from);
      if (index < 0) return false;
      var beforeOk = index === 0 || source.charAt(index - 1) === ' ';
      var after = index + phrase.length;
      var afterOk = after === source.length || source.charAt(after) === ' ';
      if (beforeOk && afterOk) {
        var prior = source.slice(Math.max(0, index - 48), index).trim().split(' ').slice(-5).join(' ');
        var phraseOwnsNegative = /^(?:no|without)\b/.test(phrase);
        if (phraseOwnsNegative || !/(?:^|\s)(?:no|not|denies|denied|deny|without|negative for|free of)(?:\s|$)/.test(prior)) return true;
      }
      from = index + Math.max(1, phrase.length);
    }
    return false;
  }
  function scoreProfileCondition(condition, source) {
    var normalized = normalizeMatchText(condition), tokens = meaningfulTokens(condition);
    if (!normalized || !source || !tokens.length) return { eligible: false, score: 0 };
    var score = 0, strong = false;
    var clauses = String(condition || '').split(/[,;|/]+|\b(?:or|and)\b/i);
    clauses.forEach(function (clause) {
      var words = meaningfulTokens(clause), phrase = words.join(' ');
      if (phrase && affirmedPhrase(source, phrase)) score += words.length > 1 ? 6 : 3;
    });
    tokens.forEach(function (token) { if (affirmedPhrase(source, token)) score += 1; });
    MATCH_CONCEPTS.forEach(function (concept) {
      var applies = concept.rule.some(function (phrase) { return normalized.indexOf(normalizeMatchText(phrase)) >= 0; });
      if (!applies) return;
      var hit = concept.evidence.some(function (phrase) { return affirmedPhrase(source, phrase); });
      if (hit) { score += concept.weight; strong = true; }
    });
    return { eligible: strong || score >= (tokens.length === 1 ? 4 : 6), score: score };
  }
  function routedSectionProfile(id, profiles, fallbackId, selectionSource) {
    var list = Array.isArray(profiles) && profiles.length ? profiles : sectionProfiles(id);
    var fallback = activeSectionProfile(id, list, fallbackId);
    var source = todayTranscript(selectionSource);
    if (!source || list.length < 2) return { profile: fallback, selection: 'default' };
    var scoredRows = [];
    list.forEach(function (row, index) {
      var scored = scoreProfileCondition(row.when, source);
      scoredRows.push({ profile: row, score: scored.score, eligible: scored.eligible, index: index });
    });
    var eligible = scoredRows.filter(function (row) { return row.eligible; });
    if (!eligible.length) return { profile: fallback, selection: 'default' };
    eligible.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.profile.id === fallback.id) return -1;
      if (b.profile.id === fallback.id) return 1;
      return a.index - b.index;
    });
    var winner = eligible[0];
    var runner = scoredRows.filter(function (row) { return row.profile.id !== winner.profile.id; })
      .sort(function (a, b) { return b.score - a.score; })[0];
    /* A weak one-point lead is ambiguous. Keep the clinician's account
       default unless the automatic winner clears the runner-up by two. */
    if (winner.profile.id !== fallback.id && runner && winner.score - runner.score < 2) {
      return { profile: fallback, selection: 'default' };
    }
    return { profile: winner.profile, selection: winner.profile.id === fallback.id ? 'default' : 'automatic' };
  }
  function automaticRoutes(input, options) {
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    var rawToday = String(input.todayTranscript == null ? '' : input.todayTranscript);
    var envelope = /TODAY_TRANSCRIPT_BEGIN[\s\S]*TODAY_TRANSCRIPT_END/i.test(rawToday)
      ? rawToday : ('TODAY_TRANSCRIPT_BEGIN\n' + rawToday + '\nTODAY_TRANSCRIPT_END');
    var nested = options.families && typeof options.families === 'object' && !Array.isArray(options.families) ? options.families : {};
    var out = { schemaVersion: 1, families: {} };
    ['length', 'tone', 'structure'].forEach(function (key) { if (options[key] != null) out[key] = cleanText(options[key], 40); });
    if (options.instructions) out.instructions = cleanText(options.instructions, MAX_INSTRUCTIONS);
    PROFILE_FAMILIES.forEach(function (id) {
      var state = read().families[id] || familyDefaults(id);
      var request = nested[id] && typeof nested[id] === 'object' && !Array.isArray(nested[id]) ? nested[id] : {};
      /* fmt-1.0.0: routing chooses only among formats the doctor can see. */
      var profiles = visibleSectionProfiles(id, Array.isArray(request.profiles) ? request.profiles : state.profiles);
      var explicit = cleanText(request.profileId || request.activeProfile, 48);
      var chosen = explicit ? activeSectionProfile(id, profiles, explicit) : routedSectionProfile(id, profiles, state.activeProfile, envelope).profile;
      out.families[id] = { profileId: chosen.id };
    });
    if (nested.coding && typeof nested.coding === 'object' && !Array.isArray(nested.coding)) {
      out.families.coding = {};
      ['length', 'tone', 'structure', 'confidenceDisplay', 'payerPresentation'].forEach(function (key) {
        if (nested.coding[key] != null) out.families.coding[key] = cleanText(nested.coding[key], 40);
      });
      if (nested.coding.instructions) out.families.coding.instructions = cleanText(nested.coding.instructions, MAX_INSTRUCTIONS);
    }
    return out;
  }

  function familyDefaults(id) {
    id = familyId(id);
    var out = {
      length: id === 'legal_ime' ? 'detailed' : 'standard',
      tone: id === 'avs' ? 'patient_plain' : (id === 'legal_ime' ? 'legal_neutral' : 'clinical_neutral'),
      structure: (id === 'opnote' || id === 'legal_ime') ? 'template_faithful' : 'default',
      instructions: ''
    };
    if (isProfileFamily(id)) {
      out.sectionMode = SECTION_MODES[id][0][0];
      out.templateMode = SECTION_TEMPLATE_DEFAULT;
      out.profiles = sectionProfiles(id);
      out.activeProfile = out.profiles[0].id;
    }
    var ex = EXTRA[id];
    if (ex) out[ex.key] = ex.choices[0][0];
    if (id === 'hpi') out.sentenceCap = 'auto';
    if (id === 'avs') out.maxWords = '250';
    if (id === 'legal_ime') out.certaintyStyle = 'explicit';
    if (id === 'studio_widget') out.visualTheme = 'practice';
    if (id === 'coding') out.payerPresentation = 'code_first';
    return out;
  }
  function defaultState() {
    var state = { schemaVersion: 1, families: {} };
    FAMILY_IDS.forEach(function (id) { state.families[id] = familyDefaults(id); });
    return state;
  }
  function enumValue(key, value, fallback) {
    return ENUMS[key] && has(ENUMS[key], value) ? String(value) : fallback;
  }
  function sanitizeFamily(id, input) {
    var base = familyDefaults(id);
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    Object.keys(base).forEach(function (key) {
      if (key === 'instructions') base[key] = cleanText(input[key], MAX_INSTRUCTIONS);
      else if (key === 'profiles' || key === 'activeProfile') {
        /* normalized below, after legacy flat fields are read */
      }
      else if (key === 'sectionMode' && SECTION_MODES[id]) {
        var choices = SECTION_MODES[id].map(function (row) { return row[0]; });
        base[key] = has(choices, input[key]) ? String(input[key]) : base[key];
      }
      else base[key] = enumValue(key, input[key], base[key]);
    });
    if (SECTION_FAMILIES.indexOf(id) >= 0) {
      var suppliedProfiles = Array.isArray(input.profiles) ? input.profiles : null;
      var profiles = sanitizeSectionProfiles(id, suppliedProfiles);
      if (!suppliedProfiles) {
        profiles[0].sectionMode = base.sectionMode;
        profiles[0].templateMode = base.templateMode;
        profiles[0].instructions = base.instructions;
      }
      // Section instructions are profile-owned. Migrate a legacy flat value
      // into the first saved format once, then clear the family-level field so
      // mergeFamily cannot concatenate the same instruction twice.
      base.instructions = '';
      var selected = activeSectionProfile(id, profiles, input.activeProfile || input.profileId);
      base.profiles = profiles;
      base.activeProfile = selected.id;
      base.sectionMode = selected.sectionMode;
      base.templateMode = selected.templateMode;
    } else if (isProfileFamily(id)) {
      var genericProfiles = sanitizeSectionProfiles(id, Array.isArray(input.profiles) ? input.profiles : null);
      var genericSelected = activeSectionProfile(id, genericProfiles, input.activeProfile || input.profileId);
      base.profiles = genericProfiles;
      base.activeProfile = genericSelected.id;
      base.sectionMode = genericSelected.sectionMode;
      base.templateMode = genericSelected.templateMode;
    }
    return base;
  }
  function sanitize(input) {
    var out = defaultState();
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    var families = input.families && typeof input.families === 'object' && !Array.isArray(input.families) ? input.families : {};
    FAMILY_IDS.forEach(function (id) { out.families[id] = sanitizeFamily(id, families[id]); });
    return out;
  }
  function readForScope(scope) {
    if (scope && !scopeCurrent(scope)) return null;
    try {
      var key = scope ? scope.key : String(storageKey() || STORE_KEY);
      var raw = localStorage.getItem(key);
      if (scope && !scopeCurrent(scope)) return null;
      return raw ? sanitize(JSON.parse(raw)) : defaultState();
    } catch (e) { return scope ? null : defaultState(); }
  }
  function read() {
    return readForScope(null) || defaultState();
  }
  function writeForScope(state, scope) {
    if (scope && !scopeCurrent(scope)) return null;
    var clean = sanitize(state);
    try {
      var key = scope ? scope.key : String(storageKey() || STORE_KEY);
      if (scope && !scopeCurrent(scope)) return null;
      localStorage.setItem(key, JSON.stringify(clean));
      /* First-run owns only checklist presentation.  Tell it that the
         account-scoped store changed instead of making it poll Settings or
         infer completion from a click.  The event carries no settings or
         visit data; listeners re-read their own namespaced truth. */
      try { window.dispatchEvent(new CustomEvent('mls:draft-tuning-saved')); } catch (notifyError) {}
      return clean;
    }
    catch (e) { return null; }
  }
  function write(state) { return writeForScope(state, null); }
  function cleanTransientExample(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{5,}/g, '\n\n\n\n')
      .trim().slice(0, MAX_SECTION_EXAMPLE).trim();
  }
  function ensurePrivateExampleReader() {
    if (window.__mlsP1LegalPack && typeof window.__mlsP1LegalPack.readLocalFile === 'function') return Promise.resolve(window.__mlsP1LegalPack);
    var loader = window.__mlsP1LegalLoader;
    if (!loader || typeof loader.ensure !== 'function') return Promise.resolve(null);
    try { loader.ensure(); } catch (e) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var attempts = 0;
      function check() {
        var api = window.__mlsP1LegalPack;
        if (api && typeof api.readLocalFile === 'function') { resolve(api); return; }
        if (++attempts >= 40) { resolve(null); return; }
        setTimeout(check, 100);
      }
      check();
    });
  }
  function privateExampleExtractor(input) {
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    var kind = input.kind === 'image' ? 'image' : (input.kind === 'file' ? 'file' : 'draft');
    if (kind === 'draft') {
      var pasted = cleanTransientExample(input.text);
      return pasted ? Promise.resolve({ kind: kind, text: pasted }) : Promise.reject(new Error('Paste an example draft first.'));
    }
    var file = input.file;
    if (!file) return Promise.reject(new Error('Choose an example file first.'));
    if (Number(file.size || 0) > 20 * 1024 * 1024) return Promise.reject(new Error('That example is over the 20 MB private preview limit.'));
    var type = String(file.type || '').toLowerCase(), name = String(file.name || 'example');
    var isPlain = kind !== 'image' && (/^text\//.test(type) || /\.(txt|text|md|markdown|rtf|csv|tsv|json|html?)$/i.test(name));
    var work;
    if (isPlain && typeof file.text === 'function') work = Promise.resolve(file.text());
    else if (typeof window.__mlsPrivateExampleExtractor === 'function') {
      work = Promise.resolve(window.__mlsPrivateExampleExtractor({ kind: kind, file: file }));
    } else {
      work = ensurePrivateExampleReader().then(function (reader) {
        if (reader) return Promise.resolve(reader.readLocalFile(file, { timeoutMs: 90000 })).catch(function (readerError) {
          if (typeof window._tplReadAnyFile === 'function') return window._tplReadAnyFile(file);
          throw readerError;
        });
        if (typeof window._tplReadAnyFile === 'function') return window._tplReadAnyFile(file);
        if (typeof file.text === 'function') return file.text();
        throw new Error('The private file reader is not available. Reload MLS and try again.');
      });
    }
    return work.then(function (result) {
      var raw = result && typeof result === 'object' && !Array.isArray(result) ? result.text : result;
      var text = cleanTransientExample(raw);
      if (!text) throw new Error('No readable text was found. Try a sharper image or a searchable PDF.');
      return { kind: kind, name: name, type: type, text: text };
    });
  }
  function exampleImporter(id, profile, options) {
    id = familyId(id);
    if (!isProfileFamily(id)) return null;
    options = options && typeof options === 'object' && !Array.isArray(options) ? options : {};
    var targetId = profileId(profile, ''), previewState = null, originScope = storageScope();
    function requireOrigin() { if (!scopeCurrent(originScope)) { previewState = null; throw scopeError(); } }
    function sanitizeDerived(value) {
      value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      var templateText = cleanTemplate(value.templateText || value.template || value.templateBody, MAX_SECTION_TEMPLATE);
      var instructions = cleanReusableText(value.instructions || value.promptComments || value.comments, MAX_INSTRUCTIONS);
      var name = cleanReusableText(value.name || value.label, 80);
      if (!templateText) throw new Error('AI did not return a usable template preview.');
      return { name: name, templateText: templateText, instructions: instructions };
    }
    return {
      scopeCurrent: function () { return scopeCurrent(originScope); },
      extract: function (input) {
        try { requireOrigin(); } catch (error) { return Promise.reject(error); }
        return Promise.resolve(privateExampleExtractor(input)).then(function (result) {
          requireOrigin();
          return result;
        });
      },
      derive: async function (extracted) {
        requireOrigin();
        var text = cleanTransientExample(extracted && typeof extracted === 'object' ? extracted.text : extracted);
        if (!text) throw new Error('No readable example text is available to convert.');
        var base = typeof window.bkBase === 'function' ? String(window.bkBase() || '').replace(/\/$/, '') : '';
        var token = typeof window.bkToken === 'function' ? String(window.bkToken() || '') : '';
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        var response = await window.fetch(base + '/api/section-templates/derive', {
          method: 'POST', headers: headers,
          body: JSON.stringify({ family: id, exampleText: text })
        });
        requireOrigin();
        var payload = {}; try { payload = await response.json(); } catch (e) {}
        requireOrigin();
        if (!response.ok) throw new Error(String(payload.error || payload.message || ('Template preview failed (' + response.status + ').')));
        return sanitizeDerived(payload.result || payload.template || payload);
      },
      preview: function (derived) {
        if (!scopeCurrent(originScope)) { previewState = null; return null; }
        if (derived != null) previewState = sanitizeDerived(derived);
        return previewState ? clone(previewState) : null;
      },
      cancel: function () { var had = !!previewState; previewState = null; return had; },
      apply: function (derived) {
        if (!scopeCurrent(originScope)) { previewState = null; return false; }
        if (derived != null) previewState = sanitizeDerived(derived);
        if (!previewState) return false;
        var editor = profileEditor(id, originScope);
        var changes = { templateText: previewState.templateText, instructions: previewState.instructions };
        if (previewState.name) changes.label = previewState.name;
        /* A first imported example should keep its headings and structure by
           default. Guide is intentionally loose, so inheriting it from a
           neighboring/default profile makes an upload look ignored. Callers
           may preserve an explicit choice; replacing an existing template
           always keeps its saved mode. */
        var existing = editor && editor.list().filter(function (row) { return row.id === targetId; })[0];
        if (existing && !String(existing.templateText || '').trim()) {
          if (enumValue('templateMode', options.templateMode, '')) changes.templateMode = String(options.templateMode);
          else if (options.preserveTemplateMode !== true) changes.templateMode = SECTION_TEMPLATE_DEFAULT;
        }
        var applied = editor && editor.update(targetId, changes);
        if (applied) previewState = null;
        return applied || false;
      }
    };
  }
  function profileEditor(id, boundScope) {
    id = familyId(id);
    if (!isProfileFamily(id)) return null;
    boundScope = boundScope || storageScope();
    function current() {
      var state = boundScope ? readForScope(boundScope) : read();
      if (!state) return null;
      var family = state.families[id] || familyDefaults(id);
      family.profiles = sanitizeSectionProfiles(id, family.profiles);
      return { state: state, family: family };
    }
    function persist(ctx, profiles, activeId) {
      if (!ctx || (boundScope && !scopeCurrent(boundScope))) return null;
      profiles = sanitizeSectionProfiles(id, profiles);
      var selected = activeSectionProfile(id, profiles, activeId);
      ctx.family.profiles = profiles;
      ctx.family.activeProfile = selected.id;
      ctx.family.sectionMode = selected.sectionMode;
      ctx.family.templateMode = selected.templateMode;
      /* Clinical section comments are profile-owned for the legacy schema.
         Generic families also have account-wide standing instructions; profile
         edits must not erase those older settings. */
      if (SECTION_FAMILIES.indexOf(id) >= 0) ctx.family.instructions = '';
      else ctx.family.instructions = cleanText(ctx.family.instructions, MAX_INSTRUCTIONS);
      ctx.state.families[id] = ctx.family;
      var saved = boundScope ? writeForScope(ctx.state, boundScope) : write(ctx.state);
      if (!saved) return null;
      var savedFamily = saved.families[id];
      return clone(activeSectionProfile(id, savedFamily.profiles, savedFamily.activeProfile));
    }
    return {
      list: function () { var ctx = current(); return ctx ? clone(ctx.family.profiles) : []; },
      active: function () {
        var ctx = current();
        if (!ctx) return null;
        return clone(activeSectionProfile(id, ctx.family.profiles, ctx.family.activeProfile));
      },
      add: function (input) {
        var ctx = current(); if (!ctx) return false;
        var profiles = ctx.family.profiles.slice();
        if (profiles.length >= MAX_SECTION_PROFILES) return false;
        input = input && typeof input === 'object' && !Array.isArray(input) ? Object.assign({}, input) : {};
        var requested = profileId(input.id, '');
        var baseId = requested || ('custom_' + (profiles.length + 1));
        var candidateId = baseId, suffix = 2;
        while (profiles.some(function (row) { return row.id === candidateId; })) candidateId = baseId + '_' + suffix++;
        input.id = candidateId;
        input.label = cleanReusableText(input.label || input.name || ('New ' + id.toUpperCase() + ' format'), 80);
        if (!Object.prototype.hasOwnProperty.call(input, 'when')) input.when = '';
        if (!Object.prototype.hasOwnProperty.call(input, 'templateText')) input.templateText = '';
        if (!Object.prototype.hasOwnProperty.call(input, 'instructions')) input.instructions = '';
        if (!input.sectionMode) input.sectionMode = (activeSectionProfile(id, profiles, ctx.family.activeProfile) || {}).sectionMode;
        if (!input.templateMode) input.templateMode = SECTION_TEMPLATE_DEFAULT;
        profiles.push(input);
        return persist(ctx, profiles, candidateId);
      },
      update: function (profile, changes) {
        var ctx = current(); if (!ctx) return false;
        var wanted = profileId(profile, ''), found = false;
        changes = changes && typeof changes === 'object' && !Array.isArray(changes) ? changes : {};
        var profiles = ctx.family.profiles.map(function (row) {
          if (row.id !== wanted) return row;
          found = true;
          var next = Object.assign({}, row, changes);
          next.id = row.id;
          return next;
        });
        return found ? persist(ctx, profiles, ctx.family.activeProfile) : false;
      },
      remove: function (profile) {
        var ctx = current(); if (!ctx) return false;
        var wanted = profileId(profile, ''), profiles = ctx.family.profiles;
        if (profiles.length <= 1) return false;
        var index = profiles.findIndex(function (row) { return row.id === wanted; });
        if (index < 0) return false;
        var next = profiles.filter(function (row) { return row.id !== wanted; });
        var activeId = ctx.family.activeProfile === wanted ? next[Math.min(index, next.length - 1)].id : ctx.family.activeProfile;
        return persist(ctx, next, activeId) || false;
      },
      select: function (profile) {
        var ctx = current(); if (!ctx) return false;
        var selected = activeSectionProfile(id, ctx.family.profiles, profile);
        return persist(ctx, ctx.family.profiles, selected.id);
      }
    };
  }
  function transientSoap() {
    var out = {};
    try {
      // The visit's structured note format is carried by notePreferences and
      // must never be shadowed by account-level draft tuning.
      var length = typeof window.getGenLength === 'function' ? window.getGenLength() : '';
      if (has(ENUMS.length, length)) out.length = length;
      var instruction = typeof window.getGenInstr === 'function' ? window.getGenInstr() : '';
      if (instruction) out.instructions = cleanText(instruction, MAX_INSTRUCTIONS);
    } catch (e) {}
    return out;
  }
  function mergeFamily(id, transient) {
    id = familyId(id);
    var base = read().families[id];
    var merged = {};
    Object.keys(base).forEach(function (key) { merged[key] = base[key]; });
    var request = {};
    if (transient && typeof transient === 'object' && !Array.isArray(transient)) {
      Object.keys(transient).forEach(function (key) { request[key] = transient[key]; });
    }
    if (id === 'soap') {
      var soap = transientSoap();
      /* sfi-1.0.0 (2026-08-27). THIS COPY USED TO DELETE A SAFETY INSTRUCTION.
         request.instructions arrives carrying whatever the shell injected -
         and on a sparse visit that is the sparse-evidence rule from
         _mlsGenerationDraftTuning: the one that forbids inferring exam
         findings, a diagnosis, medication continuation, an order, a procedure
         or a follow-up from PRIOR CHART HISTORY when today's transcript is
         thin. transientSoap().instructions is the clinician's "Focus this
         note" box. Copying every key blindly meant the focus text REPLACED the
         safety rule outright.
         Measured by executing this module: with no focus text the payload
         carried the rule (480 chars); with the three words "emphasize the
         injection" it carried "emphasize the injection | Preserve the SOAP
         contract..." and the rule was gone. Three words in a text box removed
         a patient-safety guard.
         Both now survive, carried text FIRST so that if the pair exceeds
         MAX_INSTRUCTIONS it is the clinician's preference that is trimmed and
         never the safety rule. */
      var carriedInstructions = String(request.instructions || '').trim();
      Object.keys(soap).forEach(function (key) { request[key] = soap[key]; });
      if (carriedInstructions) {
        request.instructions = cleanText(
          [carriedInstructions, String(request.instructions || '').trim()].filter(Boolean).join('\n'),
          MAX_INSTRUCTIONS);
      }
    }
    Object.keys(base).forEach(function (key) {
      if (key === 'profiles' || key === 'activeProfile' || key === 'sectionMode' || key === 'templateMode') {
        /* section profile selection is resolved below */
      } else if (key === 'instructions') {
        var one = cleanText(request.instructions, MAX_INSTRUCTIONS);
        /* sfi-1.0.0: the ORDER is unchanged - account first, exactly as before -
           but the account instruction now yields the space instead of taking
           it. `one` is the per-visit instruction and may carry the
           sparse-evidence safety rule (see the soap block above); joining and
           then truncating from the tail could cut that rule off when a long
           standing instruction was set. Budgeting the account to what is left
           makes the per-visit instruction untruncatable by a preference. */
        var room = Math.max(0, MAX_INSTRUCTIONS - (one ? one.length + 3 : 0));
        var account = cleanText(base.instructions, room);
        /* sfi-1.0.0: yielding the space is the right trade - a shortened
           standing preference is an inconvenience, a fabricated exam finding is
           a patient-safety incident - but it must not be SILENT. Say it once,
           with the numbers, so a shortened instruction is diagnosable instead
           of mysterious. */
        try {
          var full = cleanText(base.instructions, MAX_INSTRUCTIONS);
          if (full && account !== full && typeof console !== 'undefined' && console.warn) {
            console.warn('[mls draft tuning] the standing instruction for "' + id + '" was shortened from ' +
              full.length + ' to ' + account.length + ' characters so this visit\'s instruction (' +
              one.length + ' characters, which may carry a safety rule) reaches the model intact.');
          }
        } catch (eRoom) {}
        merged.instructions = cleanText([account, one].filter(Boolean).join(' | '), MAX_INSTRUCTIONS);
      } else if (request[key] != null) {
        merged[key] = enumValue(key, request[key], merged[key]);
      }
    });
    if (isProfileFamily(id)) {
      var suppliedProfiles = Array.isArray(request.profiles) ? request.profiles : base.profiles;
      /* fmt-1.0.0: THIS is the payload. A test-lane format can never be the
         selected one, and its name can never travel with a generation. */
      var profiles = visibleSectionProfiles(id, suppliedProfiles);
      var selected = activeSectionProfile(id, profiles, request.profileId || request.activeProfile || base.activeProfile);
      if (request.profile && typeof request.profile === 'object' && !Array.isArray(request.profile)) {
        var override = sanitizeSectionProfiles(id, [Object.assign({}, selected, request.profile)])[0];
        profiles = profiles.map(function (row) { return row.id === selected.id ? override : row; });
        selected = override;
      }
      // Resolve locally and transport only the selected format. Sending every
      // saved template would waste context and expose unrelated account
      // preferences to a generation that cannot use them.
      delete merged.profiles;
      merged.activeProfile = selected.id;
      merged.profileId = selected.id;
      merged.profileName = selected.label;
      merged.profileWhen = selected.when;
      merged.sectionMode = selected.sectionMode;
      merged.templateMode = selected.templateMode;
      merged.templateText = selected.templateText;
      /* Section instructions were historically profile-owned; generic draft
         families retain their account-level comment and add the selected
         format's comments so old settings remain effective. */
      merged.instructions = cleanText([merged.instructions, selected.instructions].filter(Boolean).join(' | '), MAX_INSTRUCTIONS);
    }
    merged.schemaVersion = 1;
    merged.family = id;
    return merged;
  }
  // Structured note generation owns a SOAP JSON contract, while the backend
  // renders each independently tuned clinical section as a nested family.
  // Carry all five bounded section payloads alongside SOAP so saved formats
  // remain effective without competing with the visit's note format contract.
  function structuredFamily(transient) {
    var nested = transient && typeof transient === 'object' && !Array.isArray(transient)
      ? transient.families : null;
    /* dtc-1.0.0 (2026-08-27): SOAP's conditionally-routed saved format was
       computed and then thrown away - the ONE family of the seven where that
       happened. autoRoute resolves the routed choice and writes it to
       `out.families.soap.profileId`, but this function passed the whole
       `transient` to mergeFamily('soap', ...), and mergeFamily reads
       `request.profileId || request.activeProfile` off the object it is HANDED.
       transient has no top-level profileId, so it fell through to
       base.activeProfile and the routing decision never reached the request.
       The five nested sections below were always fine because they are handed
       `nested.hpi` etc. DIRECTLY - that is the working shape, and this now
       matches it. Only the two identity keys are overlaid, so the top-level
       length/tone/structure/instructions that autoRoute set stay untouched. */
    var routedSoap = nested && nested.soap && typeof nested.soap === 'object' && !Array.isArray(nested.soap)
      ? nested.soap : null;
    var soapRequest = transient;
    if (routedSoap && (routedSoap.profileId || routedSoap.activeProfile)) {
      soapRequest = Object.assign({}, transient, {
        profileId: routedSoap.profileId || routedSoap.activeProfile,
        activeProfile: routedSoap.activeProfile || routedSoap.profileId
      });
    }
    var soap = mergeFamily('soap', soapRequest);
    return {
      schemaVersion: 1,
      family: 'soap',
      length: soap.length,
      tone: soap.tone,
      structure: soap.structure,
      instructions: soap.instructions,
      activeProfile: soap.activeProfile,
      profileId: soap.profileId,
      profileName: soap.profileName,
      profileWhen: soap.profileWhen,
      sectionMode: soap.sectionMode,
      templateMode: soap.templateMode,
      templateText: soap.templateText,
      families: {
        hpi: mergeFamily('hpi', nested && nested.hpi),
        ros: mergeFamily('ros', nested && nested.ros),
        exam: mergeFamily('exam', nested && nested.exam),
        assessment: mergeFamily('assessment', nested && nested.assessment),
        plan: mergeFamily('plan', nested && nested.plan),
        coding: mergeFamily('coding', nested && nested.coding)
      }
    };
  }
  function infer(sys, user, opts) {
    opts = opts || {};
    // Some free-form tools intentionally remain on the generic contract. This
    // explicit escape hatch is important when their source prompt contains
    // vocabulary shared with a family (for example utilization review uses
    // the phrase "medical necessity" but is not a prior-auth letter).
    if (opts.draftFamily === 'generic' || opts.family === 'generic') return '';
    if (has(FAMILY_IDS, opts.draftFamily || opts.family)) return String(opts.draftFamily || opts.family);
    if (opts.legal === true) return 'legal_ime';
    var text = String(sys || '') + '\n' + String(user || '').slice(0, 1800);
    if (/reformat\b[\s\S]{0,100}\b(?:visit|clinical)\s+note|\btemplate\b[\s\S]{0,100}\bvisit\s+note/i.test(text)) return 'soap';
    if (/(?:rewrite|draft|generate|return)\s+(?:only\s+)?(?:the\s+)?(?:HPI|history of present illness)\b|(?:HPI|history of present illness)\b[^\n]{0,80}\bonly\b/i.test(text)) return 'hpi';
    if (/\b(operative|operation|procedure)\s+(?:report|note)|op(?:erative)?\s*note\b/i.test(text)) return 'opnote';
    if (/after[- ]visit (?:summary|instructions)|patient instructions|discharge instructions/i.test(text)) return 'avs';
    if (/referral (?:letter|note)|refer(?:ring|ral) (?:to|for)/i.test(text)) return 'referral';
    if (/prior auth|prior authorization|medical necessity|insurance appeal/i.test(text)) return 'priorauth';
    if (/independent medical examination|\bIME\b|medicolegal|legal report|reasonable degree of medical/i.test(text)) return 'legal_ime';
    if (/widget|standalone html|MLS_DATA|dashboard card/i.test(text)) return 'studio_widget';
    if (/ICD-?10|\bCPT\b|E\/M level|coding review/i.test(text)) return 'coding';
    if (/copilot|answer the clinician|patient panel/i.test(text)) return 'copilot';
    if (/\b(?:clinical recommendations?|red flags?|differential diagnosis|utilization review|chart summary|patient handout)\b/i.test(text)) return 'general_draft';
    // Unknown free-form helpers (document parsing, extraction, summarization,
    // etc.) are not draft families. Leaving them unclassified preserves their
    // caller-owned output contract and prevents SOAP preferences/validators
    // from being applied accidentally.
    return '';
  }
  function promptBlock(id, transient) {
    var p = mergeFamily(id, transient);
    var lines = [
      '',
      'SUBORDINATE ACCOUNT DRAFT PREFERENCES (apply only when consistent with source evidence and all safety/accuracy rules above; never invent facts, weaken coding safeguards, sign a legal opinion, or bypass clinician review):',
      '- Draft family: ' + FAMILY_LABELS[p.family] + '.',
      '- Detail: ' + p.length + '.',
      '- Tone: ' + p.tone + '.',
      '- Structure: ' + p.structure + '.'
    ];
    var ex = EXTRA[p.family];
    if (ex && p[ex.key]) lines.push('- ' + ex.label + ': ' + p[ex.key] + '.');
    var secondary = SECONDARY[p.family] || [];
    secondary.forEach(function (field) {
      if (p[field.key]) lines.push('- ' + field.label + ': ' + p[field.key] + '.');
    });
    if (isProfileFamily(p.family)) {
      if (p.profileName) lines.push('- Reusable ' + p.family.toUpperCase() + ' format: ' + p.profileName + ' (profile ' + p.profileId + ').');
      if (p.profileWhen) lines.push('- Use this ' + p.family.toUpperCase() + ' format when: ' + p.profileWhen + '; this selection hint is not patient evidence.');
      if (p.sectionMode) lines.push('- ' + SECTION_MODE_LABELS[p.family] + ': ' + p.sectionMode + '; preserve the exact Athena section heading and use only supported facts.');
      if (p.templateMode) lines.push('- ' + p.family.toUpperCase() + ' saved-template handling: ' + p.templateMode + '; adapt only documented content and never invent missing fields.');
      if (p.templateText) lines.push('- Selected ' + p.family.toUpperCase() + ' template (format scaffold only; never treat its words as patient facts):\n' + p.templateText);
    }
    if (p.family === 'soap') {
      /* Keep direct-key SOAP prompts in exact parity with the structured
         hosted payload. A per-request structured override may carry nested
         HPI/coding preferences; merge those through the same bounded family
         sanitizer instead of falling back to stale persisted values. */
      var nested = transient && typeof transient === 'object' && !Array.isArray(transient)
        ? transient.families : null;
      var hpi = mergeFamily('hpi', nested && nested.hpi);
      var ros = mergeFamily('ros', nested && nested.ros);
      var exam = mergeFamily('exam', nested && nested.exam);
      var assessment = mergeFamily('assessment', nested && nested.assessment);
      var plan = mergeFamily('plan', nested && nested.plan);
      var coding = mergeFamily('coding', nested && nested.coding);
      if (hpi.hpiOrganization) lines.push('- HPI organization: ' + hpi.hpiOrganization + '; use only where supported by source chronology.');
      if (hpi.sentenceCap) lines.push('- HPI sentence cap: ' + hpi.sentenceCap + '; combine supported facts rather than inventing detail.');
      [hpi, ros, exam, assessment, plan].forEach(function (section) {
        var key = section.family;
        if (SECTION_FAMILIES.indexOf(key) < 0) return;
        if (section.profileName) lines.push('- Reusable ' + key.toUpperCase() + ' format: ' + section.profileName + ' (profile ' + section.profileId + ').');
        if (section.profileWhen) lines.push('- Use this ' + key.toUpperCase() + ' format when: ' + section.profileWhen + '; this selection hint is not patient evidence.');
        if (section.sectionMode) lines.push('- ' + SECTION_MODE_LABELS[key] + ': ' + section.sectionMode + '; preserve the exact Athena section heading and use only supported facts.');
        if (section.templateMode) lines.push('- ' + key.toUpperCase() + ' saved-template handling: ' + section.templateMode + '; adapt only documented content and never invent missing fields.');
        if (section.templateText) lines.push('- Selected ' + key.toUpperCase() + ' template (format scaffold only; never treat its words as patient facts):\n' + section.templateText);
        if (section.instructions) lines.push('- ' + key.toUpperCase() + ' AI prompt comments (subordinate formatting/focus guidance only): ' + section.instructions);
      });
      if (coding.confidenceDisplay) lines.push('- Coding confidence display: ' + coding.confidenceDisplay + '; uncertainty must remain visible.');
      if (coding.payerPresentation) lines.push('- Coding presentation: ' + coding.payerPresentation + '; never alter code validity.');
    }
    if (p.instructions) lines.push(isProfileFamily(p.family)
      ? '- ' + p.family.toUpperCase() + ' AI prompt comments (subordinate formatting/focus guidance only): ' + p.instructions
      : '- Additional provider preference (subordinate, non-patient setting): ' + p.instructions);
    return lines.join('\n');
  }

  var working = null;
  var workingScope = null;
  var workingScopeInvalid = false;
  var activeFamily = 'opnote';
  var modalWasOpen = false;
  var sectionImportSession = null;
  var sectionImportEpoch = 0;
  var templateModeExplicit = Object.create(null);
  function templateModeKey(family, profile) { return familyId(family) + '::' + String(profile || ''); }
  function q(id) { return document.getElementById(id); }
  function optionHtml(rows) {
    return rows.map(function (row) { return '<option value="' + row[0] + '">' + row[1] + '</option>'; }).join('');
  }
  function sectionImportStatus(message, error) {
    var status = q('mlsDtSectionImportStatus');
    if (!status) return;
    status.textContent = message || '';
    status.style.color = error ? '#b4231e' : 'var(--muted)';
  }
  function resetSectionImport(hide) {
    sectionImportEpoch++;
    if (sectionImportSession && typeof sectionImportSession.cancel === 'function') {
      try { sectionImportSession.cancel(); } catch (e) {}
    }
    sectionImportSession = null;
    var panel = q('mlsDtSectionImportPanel'), preview = q('mlsDtSectionImportPreview'), file = q('mlsDtSectionImportFile');
    var openButton = q('mlsDtSectionImportOpen');
    if (panel && hide !== false) {
      panel.hidden = true;
      panel.style.display = 'none';
    }
    if (openButton && hide !== false) openButton.setAttribute('aria-expanded', 'false');
    if (preview) preview.style.display = 'none';
    ['mlsDtSectionImportExample', 'mlsDtSectionImportNamePreview', 'mlsDtSectionImportTemplatePreview', 'mlsDtSectionImportCommentsPreview'].forEach(function (id) {
      var el = q(id); if (el) el.value = '';
    });
    if (file) file.value = '';
    sectionImportStatus('', false);
  }
  function sectionImportMatches(panel) {
    return !!(panel && panel.getAttribute('data-family') === activeFamily && q('mlsDtSectionProfile') &&
      panel.getAttribute('data-profile') === q('mlsDtSectionProfile').value && sectionImportSession &&
      (typeof sectionImportSession.scopeCurrent !== 'function' || sectionImportSession.scopeCurrent()));
  }
  function openSectionImport() {
    if (activeFamily === 'opnote') {
      if (typeof window.openTemplates === 'function') window.openTemplates();
      return;
    }
    if (!isProfileFamily(activeFamily) || !q('mlsDtSectionProfile')) return;
    if (workingScopeInvalid || !workingScope || !scopeCurrent(workingScope)) {
      sectionImportStatus(scopeError().message, true);
      return;
    }
    resetSectionImport(false);
    var panel = q('mlsDtSectionImportPanel'), profile = q('mlsDtSectionProfile').value;
    sectionImportSession = exampleImporter(activeFamily, profile);
    panel.setAttribute('data-family', activeFamily);
    panel.setAttribute('data-profile', profile);
    panel.hidden = false;
    panel.style.display = '';
    q('mlsDtSectionImportOpen').setAttribute('aria-expanded', 'true');
    sectionImportStatus('Choose a file or paste an example draft. Nothing is saved until you apply the preview and save Settings.', false);
  }
  async function onSectionImportFile(event) {
    var file = event && event.target && event.target.files && event.target.files[0];
    if (!file || !sectionImportSession) return;
    var panel = q('mlsDtSectionImportPanel'), epoch = ++sectionImportEpoch;
    if (!sectionImportMatches(panel)) { resetSectionImport(true); return; }
    sectionImportStatus('Privately reading ' + String(file.name || 'the example') + '…', false);
    try {
      var type = String(file.type || '').toLowerCase();
      var result = await sectionImportSession.extract({ kind: /^image\//.test(type) ? 'image' : 'file', file: file });
      if (epoch !== sectionImportEpoch || !sectionImportMatches(panel)) return;
      q('mlsDtSectionImportExample').value = result.text;
      sectionImportStatus('Example text is ready. Review it, then create the AI template preview.', false);
    } catch (error) {
      if (epoch !== sectionImportEpoch) return;
      sectionImportStatus(String(error && error.message || error || 'Could not read that example.'), true);
    }
  }
  async function deriveSectionImport() {
    var panel = q('mlsDtSectionImportPanel');
    if (!sectionImportSession || !sectionImportMatches(panel)) { sectionImportStatus('Open the importer again for the selected format.', true); return; }
    var deriveButton = q('mlsDtSectionImportDerive'), epoch = ++sectionImportEpoch;
    if (deriveButton) deriveButton.disabled = true;
    sectionImportStatus('AI is building a reusable preview and removing patient-specific details from the result…', false);
    try {
      var extracted = await sectionImportSession.extract({ kind: 'draft', text: q('mlsDtSectionImportExample').value });
      var derived = await sectionImportSession.derive(extracted);
      if (epoch !== sectionImportEpoch || !sectionImportMatches(panel)) return;
      var preview = sectionImportSession.preview(derived);
      q('mlsDtSectionImportNamePreview').value = preview.name || q('mlsDtSectionName').value || '';
      q('mlsDtSectionImportTemplatePreview').value = preview.templateText || '';
      q('mlsDtSectionImportCommentsPreview').value = preview.instructions || '';
      q('mlsDtSectionImportExample').value = '';
      q('mlsDtSectionImportFile').value = '';
      q('mlsDtSectionImportPreview').style.display = '';
      sectionImportStatus('Preview ready. Edit it if needed, then Apply; Cancel keeps the saved format unchanged.', false);
    } catch (error) {
      if (epoch !== sectionImportEpoch) return;
      sectionImportStatus(String(error && error.message || error || 'Could not create the template preview.'), true);
    } finally { if (deriveButton && epoch === sectionImportEpoch) deriveButton.disabled = false; }
  }
  function applySectionImport() {
    var panel = q('mlsDtSectionImportPanel');
    if (!sectionImportSession || !sectionImportMatches(panel)) {
      sectionImportStatus(sectionImportSession && typeof sectionImportSession.scopeCurrent === 'function' && !sectionImportSession.scopeCurrent()
        ? scopeError().message : 'This preview belongs to a different saved format. Open the importer again.', true);
      return;
    }
    var templateText = cleanTemplate(q('mlsDtSectionImportTemplatePreview').value, MAX_SECTION_TEMPLATE);
    if (!templateText) { sectionImportStatus('The reusable template preview is empty.', true); return; }
    var name = cleanReusableText(q('mlsDtSectionImportNamePreview').value, 80);
    var priorTemplate = cleanTemplate((q('mlsDtSectionTemplateText') || {}).value, MAX_SECTION_TEMPLATE);
    var selectedProfileId = String((q('mlsDtSectionProfile') || {}).value || '');
    var modeWasExplicit = !!templateModeExplicit[templateModeKey(activeFamily, selectedProfileId)];
    var currentComments = cleanReusableText((q('mlsDtInstructions') || {}).value, MAX_INSTRUCTIONS);
    var derivedComments = cleanReusableText((q('mlsDtSectionImportCommentsPreview') || {}).value, MAX_INSTRUCTIONS);
    var combinedComments = currentComments;
    if (derivedComments && currentComments.toLowerCase().indexOf(derivedComments.toLowerCase()) < 0) {
      var proposedComments = [currentComments, derivedComments].filter(Boolean).join(' | ');
      if (proposedComments.length > MAX_INSTRUCTIONS) {
        sectionImportStatus('The existing format comments plus the preview exceed ' + MAX_INSTRUCTIONS + ' characters. Shorten one of them before applying; MLS did not replace or cut off either one.', true);
        return;
      }
      combinedComments = proposedComments;
    }
    if (name) q('mlsDtSectionName').value = name;
    if (!priorTemplate && !modeWasExplicit && q('mlsDtSectionTemplate')) q('mlsDtSectionTemplate').value = SECTION_TEMPLATE_DEFAULT;
    q('mlsDtSectionTemplateText').value = templateText;
    q('mlsDtInstructions').value = combinedComments;
    /* tplauto-1.0.0: an uploaded example that produced a template also
       produces the rule that picks it - but only into an EMPTY field. */
    var whenBox = q('mlsDtSectionWhen');
    if (whenBox && !String(whenBox.value || '').trim()) {
      var whenSug = suggestWhenFromUi();
      var importKey = activeFamily + '::' + String((q('mlsDtSectionProfile') || {}).value || '');
      whenOffered[importKey] = { text: '', why: '' };
      if (whenSug && whenSug.result) {
        whenBox.value = whenSug.result.terms.join(', ');
        whenOffered[importKey] = { text: whenBox.value, why: whenSug.result.why };
        paintWhenWhy(whenSug.result.why);
      }
    }
    captureUi(activeFamily);
    var appliedLabel = String((q('mlsDtSectionName') || {}).value || 'selected format').trim();
    var appliedStatus = q('mlsDtAppliedStatus');
    var appliedMode = String((q('mlsDtSectionTemplate') || {}).value || SECTION_TEMPLATE_DEFAULT);
    var appliedModeText = appliedMode === 'guide' ? 'Uses the template as a loose guide and may rewrite nonessential wording.' :
      (appliedMode === 'strict' ? 'Keeps template headings, order, and standard wording.' : 'Keeps template headings and structure.');
    if (appliedStatus) appliedStatus.textContent = 'Preview applied to ' + (FAMILY_LABELS[activeFamily] || 'this output') + ' → ' + appliedLabel + '. ' + appliedModeText + ' Save Settings to use it for future drafts.';
    resetSectionImport(true);
    paintEffectiveSummary();
    paintCount();
    try { if (typeof window.toast === 'function') window.toast('Template preview applied to ' + (FAMILY_LABELS[activeFamily] || 'this output') + '. Save Settings when you are finished.', 'ok'); } catch (e) {}
  }
  /* ==== tplauto-1.0.0 =====================================================
     Owner 2026-08-27, looking at this very field: "this should be able to
     auto generate when it thinks it will be used". A saved format already
     carries the words that describe it - its name and its own template
     outline - so the rule that picks it can be READ OUT of them instead of
     typed.
     ONE extractor, the shell's (_mlsTplSuggestFor). A second copy here
     would drift from it the first time either changed, and the doctor would
     get two different answers out of two settings panes. Deterministic and
     local: no AI call, no network, nothing that can make Save slow or fail.
     ==================================================================== */
  var whenOffered = Object.create(null);
  function suggestFn() {
    try { return typeof window._mlsTplSuggestFor === 'function' ? window._mlsTplSuggestFor : null; }
    catch (e) { return null; }
  }
  /* Rarity is measured against every OTHER saved format that has a template:
     a word all of them use cannot tell MLS which one to pick. */
  function suggestLibrary(skipFamily, skipId) {
    var lib = [];
    if (!working || !working.families) return lib;
    FAMILY_IDS.forEach(function (fam) {
      var p = working.families[fam];
      var rows = (p && Array.isArray(p.profiles)) ? p.profiles : [];
      rows.forEach(function (row) {
        if (!row || (fam === skipFamily && row.id === skipId)) return;
        if (!String(row.templateText || '').trim()) return;
        lib.push({ id: fam + '::' + row.id, name: String(row.label || ''), text: String(row.templateText || '') });
      });
    });
    return lib;
  }
  function suggestWhen(family, profileId, name, body) {
    var fn = suggestFn();
    if (!fn) return { error: 'unavailable' };
    if (!String(body || '').trim()) return { error: 'empty' };
    try {
      var out = fn({ id: family + '::' + profileId, name: String(name || ''), text: String(body || '') },
        suggestLibrary(family, profileId), { max: 6 });
      return { result: (out && out.terms && out.terms.length) ? out : null };
    } catch (e) { return { error: 'failed' }; }
  }
  function suggestWhenFromUi() {
    return suggestWhen(activeFamily, String((q('mlsDtSectionProfile') || {}).value || ''),
      (q('mlsDtSectionName') || {}).value, (q('mlsDtSectionTemplateText') || {}).value);
  }
  function paintWhenWhy(text) {
    var why = q('mlsDtSectionWhenWhy');
    if (!why) return;
    why.textContent = text || '';
    why.style.display = text ? '' : 'none';
  }
  /* An EMPTY rule on a format that DOES have a template is offered one -
     ONCE, and only until Save Settings records that he decided about the
     field. A rule he cleared stays cleared (whenAuto); the session latch
     stops a family round-trip from refilling it before he ever saves. */
  function offerWhenSuggestion(family, profile) {
    paintWhenWhy('');
    if (!profile || !isProfileFamily(family)) return;
    var box = q('mlsDtSectionWhen');
    if (!box) return;
    var key = family + '::' + profile.id, prior = whenOffered[key];
    if (String(box.value || '').trim()) {
      /* Already filled. If it still holds the proposal this session made,
         keep saying where the words came from: an explanation that vanishes
         on the next re-render is an explanation he never gets to read. */
      if (prior && prior.why && prior.text === String(box.value)) paintWhenWhy(prior.why);
      return;
    }
    if (profile.whenAuto || prior) return;
    if (!String(profile.templateText || '').trim()) return;
    var sug = suggestWhen(family, profile.id, profile.label, profile.templateText);
    whenOffered[key] = { text: '', why: '' };
    if (!sug || !sug.result) return;
    box.value = sug.result.terms.join(', ');
    whenOffered[key] = { text: box.value, why: sug.result.why };
    paintWhenWhy(sug.result.why);
  }
  /* THE EXPLICIT CONTROL. Reads the format as it stands in the editor right
     now, unsaved template and all, and OVERWRITES the rule - because he
     asked for it. Every outcome says something; a silent button is a button
     he cannot tell from a broken one. */
  function suggestWhenNow() {
    var box = q('mlsDtSectionWhen');
    if (!box || !isProfileFamily(activeFamily)) return;
    var sug = suggestWhenFromUi();
    if (sug.error === 'unavailable' || sug.error === 'failed') {
      paintWhenWhy('Suggestions are not available in this window. Reload MLS and try again, or type the rule yourself.');
      return;
    }
    if (sug.error === 'empty') {
      paintWhenWhy('Add the template or outline for this saved format first - the suggestion is read out of it.');
      return;
    }
    if (!sug.result) {
      paintWhenWhy('Nothing stood out in this format - every word it uses is one your other saved formats use too. Describe the visit in your own words instead.');
      return;
    }
    box.value = sug.result.terms.join(', ');
    paintWhenWhy(sug.result.why);
    whenOffered[activeFamily + '::' + String((q('mlsDtSectionProfile') || {}).value || '')] =
      { text: box.value, why: sug.result.why };
    captureUi(activeFamily);
    paintCount();
  }
  function mountSettings() {
    if (q('mlsDraftTuningSection')) return true;
    var modal = q('settingsModal');
    var box = modal && modal.querySelector('.modal');
    if (!box) return false;
    var sec = document.createElement('div');
    sec.className = 'set-section';
    sec.id = 'mlsDraftTuningSection';
    var style = document.createElement('style');
    style.id = 'mlsDraftTuningCss';
    style.textContent = '#mlsDraftTuningSection input.mls-dt-short-field{' +
      'display:block;width:100%;max-width:100%;min-height:0!important;height:42px!important;' +
      'box-sizing:border-box;white-space:normal;padding:8px 10px;line-height:1.3}';
    try { (document.head || document.documentElement).appendChild(style); } catch (e) {}
    sec.innerHTML =
      '<p class="set-head">Other document formats</p>' +
      '<p class="set-desc">For after-visit summaries, referrals and other documents. For SOAP, HPI, ROS, Exam, Assessment or Plan, use Visit note templates above. Operative note styles are available here; upload and edit operative templates in Templates. Apply a document preview and save Settings to keep it.</p>' +
      '<div class="field"><label for="mlsDtFamily">Output type</label><select class="sf-select" id="mlsDtFamily"></select></div>' +
      '<div id="mlsDtEffectiveSummary" role="status" style="margin:8px 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--soft,#f8fafc);font-size:13px;line-height:1.45"></div>' +
      '<button type="button" class="btn-ghost" id="mlsDtProcedureTemplatesLink" style="display:none;margin:-4px 0 12px">Open procedure template library</button>' +
      '<div class="field" id="mlsDtSectionProfileHost"><label for="mlsDtSectionProfile">Format used by this output</label><div class="row"><select class="sf-select" id="mlsDtSectionProfile"></select><button type="button" class="btn-ghost" id="mlsDtSectionAdd">+ Add format</button><button type="button" class="btn-ghost" id="mlsDtSectionDelete">Remove</button></div><p class="mini" id="mlsDtSectionProfileStatus" role="status">Up to 8 reusable formats per output.</p></div>' +
      '<div class="field" id="mlsDtSectionNameHost"><label for="mlsDtSectionName">Format name</label><input type="text" class="mls-dt-short-field" id="mlsDtSectionName" maxlength="80" placeholder="e.g. Routine follow-up"></div>' +
      '<div class="field" id="mlsDtSectionTemplateTextHost"><label for="mlsDtSectionTemplateText">Template / outline for this saved format</label><textarea class="note-box mls-dt-template-field" id="mlsDtSectionTemplateText" maxlength="2000" placeholder="Enter the headings, order, labels, or example structure MLS should follow. Do not put patient facts here." style="min-height:150px;height:150px;box-sizing:border-box"></textarea><p class="mini">The AI treats this as a format scaffold, never as evidence about the patient. 2,000 characters maximum.</p></div>' +
      '<pre id="mlsDtEffectivePreview" aria-label="Effective template preview" style="display:none;white-space:pre-wrap;max-height:150px;overflow:auto;margin:0 0 12px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fbfcfe;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace"></pre>' +
      '<div class="field" id="mlsDtSectionImportHost"><button type="button" class="btn-ghost" id="mlsDtSectionImportOpen" aria-controls="mlsDtSectionImportPanel" aria-describedby="mlsDtSectionImportScope" aria-expanded="false">Upload or paste an example for this saved format</button><p class="mini" id="mlsDtSectionImportScope">Applies only to the selected draft type and saved format. Procedure/op-note templates stay in Op Notes.</p><div id="mlsDtSectionImportPanel" hidden style="display:none;margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:10px">' +
        '<p class="mini" style="margin-top:0">Paste an example draft, or choose a document file or image (text, Word, PDF, PNG, JPEG, WebP, or GIF). Your example is processed through MLS\'s authenticated AI services. For images or scanned PDFs, MLS first performs temporary OCR. MLS removes common patient identifiers and embedded instructions from the reusable result, but review the preview before saving. The original example is used transiently, then cleared from this importer and is not saved in your draft-tuning settings. Only the reusable format fields are saved when you choose Apply and Save Settings.</p>' +
        '<input type="file" id="mlsDtSectionImportFile" accept=".txt,.text,.md,.markdown,.rtf,.doc,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/gif">' +
        '<textarea class="note-box" id="mlsDtSectionImportExample" maxlength="20000" placeholder="Or paste an example draft here…" style="margin-top:8px;min-height:120px"></textarea>' +
        '<div class="row" style="margin-top:8px"><button type="button" class="btn-green" id="mlsDtSectionImportDerive">Create AI template preview</button><button type="button" class="btn-ghost" id="mlsDtSectionImportCancel">Cancel</button></div>' +
        '<p class="mini" id="mlsDtSectionImportStatus" role="status"></p>' +
        '<div id="mlsDtSectionImportPreview" style="display:none;margin-top:10px">' +
          '<div class="field"><label for="mlsDtSectionImportNamePreview">Suggested format name</label><input type="text" class="mls-dt-short-field" id="mlsDtSectionImportNamePreview" maxlength="80"></div>' +
          '<div class="field"><label for="mlsDtSectionImportTemplatePreview">Reusable template preview</label><textarea class="note-box" id="mlsDtSectionImportTemplatePreview" maxlength="2000" style="min-height:130px"></textarea></div>' +
          '<div class="field"><label for="mlsDtSectionImportCommentsPreview">AI prompt comments preview</label><textarea class="note-box" id="mlsDtSectionImportCommentsPreview" maxlength="600" style="min-height:90px"></textarea></div>' +
          '<button type="button" class="btn-green" id="mlsDtSectionImportApply">Apply preview to this saved format</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="field" id="mlsDtSectionTemplateHost"><label for="mlsDtSectionTemplate">How closely to follow this template</label><select class="sf-select" id="mlsDtSectionTemplate">' + optionHtml([['strict','Strict — keep its headings, order, and standard wording'],['adapt','Follow template (recommended) — keep its structure'],['guide','Guide only — headings and layout may change']]) + '</select><p class="mini" id="mlsDtTemplateModeHelp"></p></div>' +
      '<p class="mini" id="mlsDtAppliedStatus" role="status" style="margin:8px 0 12px;color:var(--muted)"></p>' +
      '<details id="mlsDtAdvanced" style="margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:10px 12px">' +
        '<summary style="cursor:pointer;font-weight:700">Advanced style and automatic routing</summary>' +
        '<p class="mini">These controls refine the selected format. The template and safety rules remain authoritative.</p>' +
        '<div class="set-grid2">' +
          '<div class="field"><label for="mlsDtLength">Detail</label><select class="sf-select" id="mlsDtLength">' + optionHtml([['concise','Concise'],['standard','Standard'],['detailed','Detailed']]) + '</select></div>' +
          '<div class="field"><label for="mlsDtTone">Tone</label><select class="sf-select" id="mlsDtTone">' + optionHtml([['clinical_neutral','Clinical neutral'],['patient_plain','Patient-friendly plain language'],['warm_patient','Warm patient-facing'],['payer_formal','Payer formal'],['legal_neutral','Legal neutral'],['operational_concise','Operational concise']]) + '</select></div>' +
          '<div class="field"><label for="mlsDtStructure">Overall structure</label><select class="sf-select" id="mlsDtStructure">' + optionHtml([['default','Best structure for this draft'],['fixed_headings','Fixed headings'],['problem_grouped','Group by problem'],['template_faithful','Follow the chosen template']]) + '</select></div>' +
          '<div class="field" id="mlsDtExtraHost"><label for="mlsDtExtra" id="mlsDtExtraLabel">Draft option</label><select class="sf-select" id="mlsDtExtra"></select></div>' +
          '<div class="field" id="mlsDtSectionWhenHost"><label for="mlsDtSectionWhen">Use automatically when</label><input type="text" class="mls-dt-short-field" id="mlsDtSectionWhen" maxlength="180" placeholder="e.g. stable routine follow-up"><button type="button" class="btn-ghost" id="mlsDtSectionWhenSuggest" style="margin-top:6px" title="Read the template for this saved format and propose the words that should pick it">Suggest from this template</button><p class="mini" id="mlsDtSectionWhenWhy" role="status" style="display:none;color:#8A5A00"></p><p class="mini">Leave blank to keep this as the account default or choose it for one visit.</p></div>' +
          '<div class="field" id="mlsDtSectionModeHost"><label for="mlsDtSectionMode" id="mlsDtSectionModeLabel">Section format</label><select class="sf-select" id="mlsDtSectionMode"></select></div>' +
        '</div>' +
        '<div class="field"><label for="mlsDtInstructions" id="mlsDtInstructionsLabel">AI prompt comments for this saved format</label><textarea id="mlsDtInstructions" class="note-box mls-dt-comments-field" maxlength="600" placeholder="Non-patient writing preferences only…" style="min-height:96px;height:96px;box-sizing:border-box"></textarea><p class="mini" id="mlsDtCount">0 / 600</p></div>' +
        '<div class="field" id="mlsDtFamilyInstructionsHost"><label for="mlsDtFamilyInstructions">Standing instructions for this output type</label><textarea id="mlsDtFamilyInstructions" class="note-box mls-dt-comments-field" maxlength="600" placeholder="Account-wide non-patient writing preferences only…" style="min-height:96px;height:96px;box-sizing:border-box"></textarea><p class="mini">Applied in addition to the selected saved format for this output type.</p></div>' +
      '</details>' +
      '<div class="field" id="mlsDtResetField"><div class="row"><button type="button" class="btn-ghost" id="mlsDtReset" aria-describedby="mlsDtResetStatus">Reset this draft type</button><span class="mini" id="mlsDtResetStatus" role="status"></span></div></div>';
    var family = sec.querySelector('#mlsDtFamily');
    FAMILY_IDS.filter(function (id) { return SECTION_FAMILIES.indexOf(id) < 0 && id !== 'soap'; }).forEach(function (id) {
      var o = document.createElement('option'); o.value = id; o.textContent = FAMILY_LABELS[id]; family.appendChild(o);
    });
    var saveRow = null;
    for (var i = 0; i < box.children.length; i++) {
      var child = box.children[i];
      if (child.classList && child.classList.contains('row') && /saveSettings/.test(String(child.innerHTML || ''))) { saveRow = child; break; }
    }
    box.insertBefore(sec, saveRow || null);
    family.addEventListener('change', function () {
      resetSectionImport(true);
      captureUi(activeFamily);
      /* A stale option or an empty selection must never reopen the retired
         visit editor. The data API still supports every family; this UI does not. */
      if (!has(FAMILY_IDS, family.value) || visitTemplateFamily(family.value)) {
        family.value = activeFamily;
        openVisitTemplates();
        return;
      }
      activeFamily = familyId(family.value);
      var appliedStatus = q('mlsDtAppliedStatus'); if (appliedStatus) appliedStatus.textContent = '';
      loadUi(activeFamily);
    });
    var procedureTemplatesLink = q('mlsDtProcedureTemplatesLink');
    if (procedureTemplatesLink) procedureTemplatesLink.addEventListener('click', function () {
      try { if (typeof window.openTemplates === 'function') window.openTemplates(); }
      catch (e) { try { if (typeof window.toast === 'function') window.toast('The procedure template library could not be opened.', 'err'); } catch (e2) {} }
    });
    ['mlsDtLength', 'mlsDtTone', 'mlsDtStructure', 'mlsDtExtra', 'mlsDtSectionName', 'mlsDtSectionMode', 'mlsDtSectionTemplate', 'mlsDtSectionTemplateText', 'mlsDtSectionWhen', 'mlsDtInstructions', 'mlsDtFamilyInstructions'].forEach(function (id) {
      function changed() {
        if (id === 'mlsDtSectionTemplate') templateModeExplicit[templateModeKey(activeFamily, (q('mlsDtSectionProfile') || {}).value)] = true;
        captureUi(activeFamily); paintEffectiveSummary(); paintCount();
      }
      var el = q(id); if (el) el.addEventListener('input', changed);
      if (el) el.addEventListener('change', changed);
    });
    var whenSuggestButton = q('mlsDtSectionWhenSuggest');
    if (whenSuggestButton) whenSuggestButton.addEventListener('click', suggestWhenNow);
    q('mlsDtSectionProfile').addEventListener('change', function () {
      var selector = q('mlsDtSectionProfile'), profile = selector.value;
      resetSectionImport(true);
      var appliedStatus = q('mlsDtAppliedStatus'); if (appliedStatus) appliedStatus.textContent = '';
      /* A change event fires after the select value has moved. Capture the
         visible fields against the profile they came from, not against the
         newly selected row, or switching Plan A -> Plan B overwrites Plan B
         with Plan A before it can even be displayed. */
      var previous = selector.getAttribute('data-active-profile') || '';
      if (previous && previous !== profile) {
        selector.value = previous;
        captureUi(activeFamily);
        selector.value = profile;
      } else captureUi(activeFamily);
      if (isProfileFamily(activeFamily) && working.families[activeFamily]) working.families[activeFamily].activeProfile = profile;
      loadUi(activeFamily);
    });
    q('mlsDtSectionAdd').addEventListener('click', function () {
      if (!isProfileFamily(activeFamily)) return;
      resetSectionImport(true);
      captureUi(activeFamily);
      var p = working.families[activeFamily], profiles = sanitizeSectionProfiles(activeFamily, p.profiles);
      if (profiles.length >= MAX_SECTION_PROFILES) { paintProfileButtons(profiles); return; }
      var baseId = 'custom_' + (profiles.length + 1), nextId = baseId, suffix = 2;
      while (profiles.some(function (row) { return row.id === nextId; })) nextId = baseId + '_' + suffix++;
      var current = activeSectionProfile(activeFamily, profiles, p.activeProfile);
      profiles.push({
        id: nextId,
        label: 'New ' + activeFamily.toUpperCase() + ' format',
        when: '',
        sectionMode: current.sectionMode,
        templateMode: SECTION_TEMPLATE_DEFAULT,
        templateText: '',
        instructions: ''
      });
      p.profiles = sanitizeSectionProfiles(activeFamily, profiles);
      p.activeProfile = nextId;
      working.families[activeFamily] = sanitizeFamily(activeFamily, p);
      loadUi(activeFamily);
      try { q('mlsDtSectionName').focus(); q('mlsDtSectionName').select(); } catch (e) {}
    });
    q('mlsDtSectionDelete').addEventListener('click', function () {
      if (!isProfileFamily(activeFamily)) return;
      resetSectionImport(true);
      captureUi(activeFamily);
      var p = working.families[activeFamily], profiles = sanitizeSectionProfiles(activeFamily, p.profiles);
      if (profiles.length <= 1) { paintProfileButtons(profiles); return; }
      var wanted = p.activeProfile, index = profiles.findIndex(function (row) { return row.id === wanted; });
      if (index < 0) index = 0;
      if (activeFamily === 'opnote' && profiles[index].templateText) return;
      profiles = profiles.filter(function (row) { return row.id !== wanted; });
      p.profiles = profiles;
      p.activeProfile = profiles[Math.min(index, profiles.length - 1)].id;
      working.families[activeFamily] = sanitizeFamily(activeFamily, p);
      loadUi(activeFamily);
    });
    q('mlsDtSectionImportOpen').addEventListener('click', openSectionImport);
    q('mlsDtSectionImportFile').addEventListener('change', onSectionImportFile);
    q('mlsDtSectionImportDerive').addEventListener('click', deriveSectionImport);
    q('mlsDtSectionImportApply').addEventListener('click', applySectionImport);
    q('mlsDtSectionImportCancel').addEventListener('click', function () { resetSectionImport(true); });
    q('mlsDtReset').addEventListener('click', function () {
      resetSectionImport(true);
      if (!working) working = read();
      if (activeFamily === 'opnote' && working.families.opnote.profiles.some(function (row) { return !!row.templateText; })) return;
      working.families[activeFamily] = familyDefaults(activeFamily);
      loadUi(activeFamily);
      var resetStatus = q('mlsDtResetStatus');
      if (resetStatus) resetStatus.textContent = 'Restored MLS defaults for ' + FAMILY_LABELS[activeFamily] + '. Save changes to keep this reset.';
    });
    try { if (typeof window.mlsBuildSettingsTabs === 'function') window.mlsBuildSettingsTabs(); } catch (e) {}
    try { if (window.__mlsUiUnification && typeof window.__mlsUiUnification.reconcileSettings === 'function') window.__mlsUiUnification.reconcileSettings(); } catch (e2) {}
    return true;
  }
  function fillExtra(id, value) {
    var ex = EXTRA[id], host = q('mlsDtExtraHost'), label = q('mlsDtExtraLabel'), sel = q('mlsDtExtra');
    if (!host || !label || !sel) return;
    if (!ex) { host.style.display = 'none'; return; }
    host.style.display = '';
    label.textContent = ex.label;
    sel.innerHTML = optionHtml(ex.choices);
    sel.setAttribute('data-key', ex.key);
    sel.value = value || ex.choices[0][0];
  }
  function templateModeHelp(mode, hasTemplate) {
    if (!hasTemplate) return 'Add or import a template before choosing how closely MLS should follow it.';
    if (mode === 'strict') return 'Strict keeps the template\'s headings, order, and standard wording, while leaving unsupported clinical facts unfilled.';
    if (mode === 'guide') return 'Guide uses the template for ideas only. It does not preserve the template\'s headings, order, or layout.';
    return 'Follow template is recommended for uploaded templates. It keeps the template\'s headings and order while filling only fields supported by the visit.';
  }
  function paintEffectiveSummary() {
    var summary = q('mlsDtEffectiveSummary'), preview = q('mlsDtEffectivePreview');
    if (!summary) return;
    var id = familyId(activeFamily), family = working && working.families ? working.families[id] : null;
    var procedureLink = q('mlsDtProcedureTemplatesLink');
    if (procedureLink) procedureLink.style.display = id === 'opnote' ? '' : 'none';
    family = sanitizeFamily(id, family || familyDefaults(id));
    var profiles = isProfileFamily(id) ? visibleSectionProfiles(id, family.profiles) : [];
    var select = q('mlsDtSectionProfile');
    var selected = profiles.length ? activeSectionProfile(id, profiles, (select && select.value) || family.activeProfile) : null;
    var templateBox = q('mlsDtSectionTemplateText');
    var templateText = selected ? cleanTemplate(templateBox ? templateBox.value : selected.templateText, MAX_SECTION_TEMPLATE) : '';
    var modeSelect = q('mlsDtSectionTemplate');
    var mode = String((modeSelect && modeSelect.value) || (selected && selected.templateMode) || SECTION_TEMPLATE_DEFAULT);
    var modeHelp = q('mlsDtTemplateModeHelp');
    if (modeSelect) {
      modeSelect.disabled = !templateText;
      modeSelect.setAttribute('aria-disabled', templateText ? 'false' : 'true');
    }
    if (modeHelp) modeHelp.textContent = templateModeHelp(mode, !!templateText);
    var label = FAMILY_LABELS[id] || 'Selected output';
    if (!selected) {
      summary.textContent = label + ' uses its saved account defaults. No reusable format is selected for this output.';
      if (preview) { preview.textContent = ''; preview.style.display = 'none'; }
      return;
    }
    var profileLabel = String(selected.label || selected.id || 'Saved format');
    var routing = profiles.length > 1
      ? ' It is the account default; another saved format can be chosen only when its Use automatically when rule matches or you pick it for one visit.'
      : ' It is the only saved format for this output.';
    var modeSentence = mode === 'guide' ? ' It uses the template for ideas only and does not preserve its headings, order, or layout.' :
      (mode === 'strict' ? ' It keeps template headings, order, and standard wording.' : ' It keeps template headings and structure while filling supported content.');
    var templateSentence = templateText
      ? ' This Settings format has a ' + templateText.length + '-character template.' + modeSentence
      : ' This Settings format has no template, so template fidelity is inactive; its format and comments can still guide the draft.';
    var procedureSentence = id === 'opnote'
      ? ' This screen changes operative note style only. Upload and edit operative templates in Templates. Any older saved outline below is read-only and remains stored.' : '';
    if (id === 'opnote') templateSentence = '';
    var fieldSentence = id === 'soap'
      ? ' Visit notes always keep the five fields HPI, ROS, Exam, Assessment, and Plan.'
      : (SECTION_FAMILIES.indexOf(id) >= 0 ? ' This customizes only the matching ' + label + ' field inside that five-field visit note.' : '');
    summary.textContent = label + ' will use Settings format “' + profileLabel + '”.' + templateSentence + routing + fieldSentence + procedureSentence;
    if (preview) {
      preview.textContent = templateText ? templateText.slice(0, 600) : '';
      preview.style.display = templateText && id !== 'opnote' ? '' : 'none';
    }
  }
  function fillSectionControls(id, value, templateMode, activeProfile, profiles) {
    var profileHost = q('mlsDtSectionProfileHost'), profile = q('mlsDtSectionProfile'), whenHost = q('mlsDtSectionWhenHost'), when = q('mlsDtSectionWhen');
    var nameHost = q('mlsDtSectionNameHost'), name = q('mlsDtSectionName');
    var modeHost = q('mlsDtSectionModeHost'), modeLabel = q('mlsDtSectionModeLabel'), mode = q('mlsDtSectionMode');
    var templateHost = q('mlsDtSectionTemplateHost'), template = q('mlsDtSectionTemplate');
    var templateTextHost = q('mlsDtSectionTemplateTextHost'), templateText = q('mlsDtSectionTemplateText');
    var importHost = q('mlsDtSectionImportHost');
    var isSection = isProfileFamily(id), isClinicalSection = SECTION_FAMILIES.indexOf(id) >= 0;
    var familyInstructionsHost = q('mlsDtFamilyInstructionsHost');
    if (profileHost) profileHost.style.display = isSection ? '' : 'none';
    if (nameHost) nameHost.style.display = isSection ? '' : 'none';
    if (whenHost) whenHost.style.display = isSection ? '' : 'none';
    if (modeHost) modeHost.style.display = isSection ? '' : 'none';
    if (templateHost) templateHost.style.display = isSection ? '' : 'none';
    if (templateTextHost) templateTextHost.style.display = isSection ? '' : 'none';
    if (importHost) importHost.style.display = isSection && id !== 'opnote' ? '' : 'none';
    if (templateText) templateText.readOnly = id === 'opnote';
    var templateLabel = document.querySelector('label[for="mlsDtSectionTemplateText"]');
    if (templateLabel) templateLabel.textContent = id === 'opnote' ? 'Previously saved operative outline (read-only)' : 'Template / outline for this saved format';
    if (familyInstructionsHost) familyInstructionsHost.style.display = isSection && !isClinicalSection ? '' : 'none';
    var instructionLabel = q('mlsDtInstructionsLabel');
    if (instructionLabel) instructionLabel.textContent = isSection ? 'AI prompt comments for this saved format' : 'AI prompt comments for this saved format';
    if (!isSection) paintProfileButtons([]);
    if (!isSection || !profile || !mode || !template) return;
    profiles = visibleSectionProfiles(id, profiles); /* fmt-1.0.0: the Settings picker */
    profile.innerHTML = profiles.map(function (row) { return '<option value="' + row.id + '">' + row.label + '</option>'; }).join('');
    profile.value = activeProfile || profiles[0].id;
    profile.setAttribute('data-active-profile', profile.value);
    var selected = profiles.filter(function (row) { return row.id === profile.value; })[0] || profiles[0];
    if (name) name.value = selected.label || '';
    if (when) when.value = selected.when || '';
    if (templateText) templateText.value = selected.templateText || '';
    if (templateTextHost && id === 'opnote') templateTextHost.style.display = selected.templateText ? '' : 'none';
    modeLabel.textContent = SECTION_MODE_LABELS[id];
    mode.innerHTML = optionHtml(SECTION_MODES[id]);
    mode.value = value || SECTION_MODES[id][0][0];
    template.value = templateMode || SECTION_TEMPLATE_DEFAULT;
    /* opnk-1.0.0 (2026-08-28): OP NOTE TEMPLATE HANDLING LIVED IN TWO STORES.
       The op-note generator reads exactly one value - localStorage[uns(
       'opNoteTemplateMode')], written by the Op Note Room rail - and it is that
       value alone that produces the system clause, relaxes the fidelity gate
       and prints the "Style used" receipt. This Settings select wrote somewhere
       else entirely (draftTuningV1 -> families.opnote.profiles[n].templateMode)
       and reached no draft.
       They disagreed OUT OF THE BOX: the generator defaults to 'adapt' while
       the shipped op-note profile carries 'strict'. So a fresh account showed
       "Follow saved template strictly" in Settings, drafted in adapt, and the
       Room's own receipt said "Adapt to the case" - three surfaces, two
       answers, and the one the doctor could see was the wrong one.
       The generator's key stays the single authority (its reader is pinned by
       tests/opnote-follow-modes-differ and must not gain a second read). This
       control now DISPLAYS that authority, so Settings can no longer show a
       mode the drafts are not using. */
    if (id === 'opnote') template.value = opnoteRoomTemplateMode();
    paintProfileButtons(profiles);
    paintEffectiveSummary();
  }
  function paintProfileButtons(profiles) {
    var add = q('mlsDtSectionAdd'), remove = q('mlsDtSectionDelete'), status = q('mlsDtSectionProfileStatus');
    profiles = Array.isArray(profiles) ? profiles : [];
    var section = isProfileFamily(activeFamily);
    var selectedId = (q('mlsDtSectionProfile') || {}).value;
    var protectsOutline = activeFamily === 'opnote' && profiles.some(function (row) { return row.id === selectedId && !!row.templateText; });
    if (add) { add.disabled = !section || profiles.length >= MAX_SECTION_PROFILES; add.setAttribute('aria-disabled', add.disabled ? 'true' : 'false'); }
    if (remove) { remove.disabled = !section || profiles.length <= 1 || protectsOutline; remove.setAttribute('aria-disabled', remove.disabled ? 'true' : 'false'); remove.title = protectsOutline ? 'This format contains a preserved, read-only operative outline.' : ''; }
    if (status) status.textContent = !section ? '' : (profiles.length + ' of ' + MAX_SECTION_PROFILES + ' saved formats. ' +
      (profiles.length >= MAX_SECTION_PROFILES ? 'Remove one before adding another.' :
        (profiles.length <= 1 ? 'The final format cannot be removed.' : 'Names, rules, templates, and comments are saved independently.')));
  }
  function paintSectionImportScope(id) {
    id = familyId(id);
    var button = q('mlsDtSectionImportOpen'), scope = q('mlsDtSectionImportScope');
    var label = FAMILY_LABELS[id] || 'selected draft';
    if (button) button.textContent = 'Upload or paste an example for this ' + label + ' format';
    if (!scope) return;
    if (SECTION_FAMILIES.indexOf(id) >= 0) {
      scope.textContent = 'Applies only to the selected ' + label + ' saved format. It does not use or change procedure/op-note templates.';
    } else if (id === 'opnote') {
      scope.textContent = 'Applies only to this AI draft format. The full operative-template library stays in Op Notes.';
    } else {
      scope.textContent = 'Applies only to the selected ' + label + ' saved format.';
    }
  }
  function paintCount() {
    var el = q('mlsDtInstructions'), count = q('mlsDtCount');
    if (el && count) count.textContent = cleanText(el.value, MAX_INSTRUCTIONS).length + ' / ' + MAX_INSTRUCTIONS;
  }
  function paintResetState() {
    var button = q('mlsDtReset'), status = q('mlsDtResetStatus');
    if (!button) return;
    var current = working && working.families ? sanitizeFamily(activeFamily, working.families[activeFamily]) : familyDefaults(activeFamily);
    if (activeFamily === 'opnote' && current.profiles.some(function (row) { return !!row.templateText; })) {
      button.disabled = true; button.setAttribute('aria-disabled', 'true');
      button.title = 'Previously saved operative outlines are preserved.';
      if (status) status.textContent = 'Reset unavailable while this output contains previously saved operative outlines. Style fields remain editable.';
      return;
    }
    /* Compare canonical sanitized values. The raw defaults and sanitized
       values can carry identical profile fields in a different property
       order; order-sensitive JSON comparison made Reset appear available at
       semantic defaults and then look like it did nothing. */
    var defaults = sanitizeFamily(activeFamily, familyDefaults(activeFamily));
    var changed = JSON.stringify(current) !== JSON.stringify(defaults);
    button.disabled = !changed;
    button.setAttribute('aria-disabled', changed ? 'false' : 'true');
    button.title = changed ? 'Restore the defaults for this draft type' : 'This draft type is already at its defaults';
    if (status) status.textContent = changed ? 'Edits made — reset is available.' : 'Reset unavailable — already using MLS defaults.';
  }
  function loadUi(id) {
    if (!mountSettings()) return;
    if (!working) working = read();
    id = familyId(id);
    if (visitTemplateFamily(id)) id = 'opnote';
    activeFamily = id;
    var p = working.families[id] || familyDefaults(id);
    q('mlsDtFamily').value = id;
    paintSectionImportScope(id);
    q('mlsDtLength').value = p.length;
    q('mlsDtTone').value = p.tone;
    q('mlsDtStructure').value = p.structure;
    q('mlsDtInstructions').value = p.instructions || '';
    var familyInstructions = q('mlsDtFamilyInstructions');
    if (familyInstructions) familyInstructions.value = p.instructions || '';
    var ex = EXTRA[id]; fillExtra(id, ex ? p[ex.key] : '');
    var active = activeSectionProfile(id, p.profiles, p.activeProfile);
    if (isProfileFamily(id) && active) {
      p.sectionMode = active.sectionMode; p.templateMode = active.templateMode;
      q('mlsDtSectionName').value = active.label || '';
      q('mlsDtSectionWhen').value = active.when || '';
      q('mlsDtSectionTemplateText').value = active.templateText || '';
      q('mlsDtInstructions').value = active.instructions || '';
    }
    fillSectionControls(id, p.sectionMode, p.templateMode, p.activeProfile, p.profiles);
    paintEffectiveSummary();
    if (isProfileFamily(id) && active) offerWhenSuggestion(id, active);
    paintCount();
    paintResetState();
  }
  function captureUi(id) {
    if (!working || !q('mlsDtFamily')) return;
    id = familyId(id);
    var p = working.families[id] || familyDefaults(id);
    p.length = enumValue('length', q('mlsDtLength').value, p.length);
    p.tone = enumValue('tone', q('mlsDtTone').value, p.tone);
    p.structure = enumValue('structure', q('mlsDtStructure').value, p.structure);
    /* dtc-1.0.0 (2026-08-27): `|| p.instructions` made the box unclearable.
       An empty textarea is '', which is falsy, so deleting your standing
       instruction silently restored the previous one - the only way to get rid
       of an AI comment was to overwrite it with different text. Presence of the
       control is the right test; its value is then authoritative, empty or not.
       Nothing downstream distinguishes "cleared" from "never set". */
    var instrEl = q('mlsDtFamilyInstructions');
    p.instructions = cleanText(instrEl ? instrEl.value : p.instructions, MAX_INSTRUCTIONS);
    var ex = EXTRA[id], extra = q('mlsDtExtra');
    if (ex && extra) p[ex.key] = enumValue(ex.key, extra.value, p[ex.key]);
    if (isProfileFamily(id)) {
      var profiles = sanitizeSectionProfiles(id, p.profiles), selected = activeSectionProfile(id, profiles, q('mlsDtSectionProfile').value);
      selected.label = cleanReusableText(q('mlsDtSectionName').value, 80) || selected.label || ('Format ' + (profiles.indexOf(selected) + 1));
      selected.sectionMode = enumValue('sectionMode', q('mlsDtSectionMode').value, selected.sectionMode);
      /* opnk-1.0.0 NOTE FOR THE NEXT READER: for the OPNOTE family this stored
         profile field is VESTIGIAL. The op-note generator reads one global key
         and nothing else, so a per-profile template mode has never reached a
         draft; the line below still writes it only because every other family
         genuinely uses it. If op-note template handling should one day differ
         per saved format, that is a real feature and it starts in the
         generator - not here. */
      selected.templateMode = enumValue('templateMode', q('mlsDtSectionTemplate').value, selected.templateMode);
      /* opnk-1.1.0: keep the generator-owned op-note mode staged with the rest
         of Settings. Writing its separate compatibility key here made any
         unrelated keystroke (and even Reset) persist before Save Settings.
         saveFromUi() writes it through only after the bounded Settings snapshot
         itself lands. */
      selected.when = cleanReusableText(q('mlsDtSectionWhen').value, 180);
      /* tplauto-1.0.0: once a rule has been PROPOSED for this format, his
         next save is his decision about it - including a decision to leave
         it empty. Latch it so nothing proposes over that again. */
      if (whenOffered[id + '::' + selected.id]) selected.whenAuto = 1;
      if (id !== 'opnote') selected.templateText = cleanTemplate(q('mlsDtSectionTemplateText').value, MAX_SECTION_TEMPLATE);
      selected.instructions = cleanReusableText(q('mlsDtInstructions').value, MAX_INSTRUCTIONS);
      p.profiles = profiles.map(function (row) { return row.id === selected.id ? selected : row; });
      // Clinical section instructions are profile-owned. Generic families
      // retain their separate account-wide comments in the second field.
      if (SECTION_FAMILIES.indexOf(id) >= 0) p.instructions = '';
      p.activeProfile = selected.id;
      p.sectionMode = selected.sectionMode;
      p.templateMode = selected.templateMode;
    }
    working.families[id] = sanitizeFamily(id, p);
    paintResetState();
  }
  function beginSettings() {
    visitUploadRequest++;
    workingScope = storageScope();
    workingScopeInvalid = false;
    working = readForScope(workingScope);
    if (!working) { workingScopeInvalid = true; return false; }
    templateModeExplicit = Object.create(null);
    /* Visit note/SOAP families are owned by the first, per-section Visit note
       templates surface below. Keep this editor focused on non-visit outputs. */
    activeFamily = 'opnote';
    mountSettings();
    mountVisitTemplates();
    loadUi(activeFamily);
    try { renderTestProfileLine(); } catch (eTpl) {} /* fmt-1.0.0 */
    return true;
  }
  /* fmt-1.0.0: ONE Settings line, hosted in Note defaults beside the note
     format, because it answers the same question the owner asked — which saved
     format is steering my note. It names them, so "hidden" is never a silent
     disappearance, and Remove is a doctor's press that calls the module's own
     persistence plus the app's existing account sync. */
  function renderTestProfileLine() {
    var el = q('mlsDtTestProfileLine');
    if (!el) return 0;
    var found = testLaneProfiles();
    while (el.firstChild) el.removeChild(el.firstChild);
    if (!found.length) { el.style.display = 'none'; return 0; }
    el.style.display = '';
    var msg = document.createElement('span');
    msg.textContent = found.length + ' test profile' + (found.length === 1 ? '' : 's') + ' hidden (' +
      found.map(function (row) { return row.label; }).join(', ') +
      '). MLS test lanes created these, not you. They are not offered in any picker and are never sent with a note. ';
    el.appendChild(msg);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost';
    btn.id = 'mlsDtTestProfileRemove';
    btn.textContent = 'Remove';
    btn.addEventListener('click', function () {
      var n = removeTestLaneProfiles();
      try {
        if (typeof window.toast === 'function') {
          window.toast(n ? (n + ' test profile' + (n === 1 ? '' : 's') + ' removed.') : 'Those test profiles could not be removed on this device.', n ? 'ok' : 'err');
        }
      } catch (eToast) {}
      if (n) { try { beginSettings(); } catch (eRe) { renderTestProfileLine(); } }
      else renderTestProfileLine();
    });
    el.appendChild(btn);
    return found.length;
  }
  function settingsScopeFailure() {
    workingScopeInvalid = true;
    resetSectionImport(true);
    var message = scopeError().message;
    var status = q('mlsDtSectionProfileStatus');
    if (status) { status.textContent = message; status.style.color = '#b4231e'; }
    try { if (typeof window.toast === 'function') window.toast(message, 'err'); } catch (e) {}
    return null;
  }
  function saveFromUi() {
    if (workingScopeInvalid) return settingsScopeFailure();
    if (!working || !workingScope) { if (!beginSettings()) return settingsScopeFailure(); }
    if (!scopeCurrent(workingScope)) return settingsScopeFailure();
    captureUi(activeFamily);
    if (!scopeCurrent(workingScope)) return settingsScopeFailure();
    var saved = writeForScope(working, workingScope);
    if (!saved) return settingsScopeFailure();
    /* The op-note generator still reads its established compatibility key.
       Mirror the saved active profile only at the explicit Save Settings
       boundary, so editing or resetting this panel never persists early. */
    try {
      var op = saved.families && saved.families.opnote;
      var activeOp = op && activeSectionProfile('opnote', op.profiles, op.activeProfile);
      if (activeOp) opnoteRoomTemplateModeSet(activeOp.templateMode);
    } catch (eOpMode) {}
    return saved;
  }
  function discardUi() {
    visitUploadRequest++;
    resetSectionImport(true);
    working = null;
    workingScope = null;
    workingScopeInvalid = false;
    templateModeExplicit = Object.create(null);
    activeFamily = 'opnote';
  }
  function onSessionBoundary() {
    cloudView = null;
    paintCloudStatus();
    storageBoundaryEpoch++;
    resetSectionImport(true);
    if (working || workingScope || modalWasOpen) {
      working = null;
      workingScope = null;
      workingScopeInvalid = true;
      var status = q('mlsDtSectionProfileStatus');
      if (status) { status.textContent = scopeError().message; status.style.color = '#b4231e'; }
    }
  }
  function onClick(ev) {
    var button = ev.target && ev.target.closest ? ev.target.closest('#settingsModal button') : null;
    if (!button) return;
    var action = String(button.getAttribute('onclick') || '');
    if (/saveSettings\s*\(/.test(action)) saveFromUi();
    else if (/closeSettings\s*\(/.test(action)) discardUi();
  }
  function watchModal() {
    var modal = q('settingsModal');
    if (!modal) return;
    function pass() {
      var open = modal.classList.contains('show');
      if (open && !modalWasOpen) beginSettings();
      if (!open && modalWasOpen) discardUi();
      modalWasOpen = open;
    }
    pass();
    try { new MutationObserver(pass).observe(modal, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
  }
  /* ===================================================================
     vntpl-1.0.0 (2026-09-11) - VISIT NOTE TEMPLATES, THE PLAIN SCREEN.
     The owner asked what happened to a template upload / new UI for the
     VISIT note templates, and said plainly: do not get it confused with
     the op-note templates, they are totally different.

     Everything below is a SECOND FRONT DOOR onto the contract this module
     already owns. It stores nothing of its own: one press writes the very
     same families.<section> profiles, active selection and template mode
     that "AI output formats" writes, through the very same profileEditor()
     persistence - so the server prefs blob (draftTuningV1 already rides
     PREF_SYNC_KEYS) and the frozen generation tuning see it with no new
     reader anywhere. The op-note library ('templates', 'useTemplates',
     'templateActive', 'opNoteTemplateMode' and the Templates screen) is
     NOT touched by any path in here - the only thing shared with it is
     the file reader, reused on purpose rather than copied so the app has
     one Word/PDF parser instead of two.
     =================================================================== */
  var VISIT_TEMPLATE_PROFILE_ID = 'my_template';
  var VISIT_TEMPLATE_PROFILE_LABEL = 'My template';
  var VISIT_TEMPLATE_SECTIONS = [
    ['soap', 'Whole visit note / SOAP', 'The complete visit note shape, when you want one reusable format for the whole note.'],
    ['hpi', 'HPI', 'The story of what brought the patient in today.'],
    ['ros', 'ROS', 'The symptoms you asked about.'],
    ['exam', 'Exam', 'What you found when you examined the patient.'],
    ['assessment', 'Assessment', 'What you think is going on.'],
    ['plan', 'Plan', 'What happens next.']
  ];
  var VISIT_TEMPLATE_MODES = [
    ['strict', 'Follow it exactly', 'MLS keeps your headings, their order, and your usual wording.'],
    ['adapt', 'Follow it, skip what was not said', 'MLS keeps your headings and leaves out anything this visit did not cover. This is the usual choice.'],
    ['guide', 'Just a guide', 'MLS writes the section in its own words and only borrows the shape of yours.']
  ];
  var VISIT_TEMPLATE_EMPTY = 'No template - MLS writes this section from what was said.';
  var VISIT_TEMPLATE_FILE_ACCEPT = '.txt,.text,.md,.markdown,.rtf,.csv,.tsv,.json,.html,.htm,.doc,.docx,.odt,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/gif';
  var visitUploadFamily = '';
  var visitUploadRequest = 0, visitMountGeneration = 0;

  function visitTemplateFamily(id) {
    var clean = String(id || '');
    return (clean === 'soap' || SECTION_FAMILIES.indexOf(clean) >= 0) ? clean : '';
  }
  /* THE SHARED READER. The op-note uploader's own per-file dispatcher
     (_tplReadAnyFile in the shell: PDF text layer, .docx through the pinned
     mammoth build, legacy .doc, image OCR, then plain text) is CALLED here
     rather than reimplemented, so exactly one place in the app knows how to
     turn a doctor's file into template text. A synthetic shell without it
     still reads plain text rather than failing closed. */
  function visitTemplateFileText(file) {
    return Promise.resolve().then(function () {
      if (!file) return '';
      if (typeof window._tplReadAnyFile === 'function') return window._tplReadAnyFile(file);
      if (typeof file.text === 'function') return file.text();
      return '';
    }).then(function (text) { return String(text == null ? '' : text); })
      .catch(function () { return ''; });
  }
  function visitActiveTemplate(family) {
    family = visitTemplateFamily(family);
    if (!family) return { id: '', templateText: '', templateMode: SECTION_TEMPLATE_DEFAULT };
    var state = read().families[family] || familyDefaults(family);
    var rows = visibleSectionProfiles(family, state.profiles);
    var active = activeSectionProfile(family, rows, state.activeProfile) || {};
    return {
      id: String(active.id || ''),
      templateText: String(active.templateText || ''),
      templateMode: has(['strict', 'adapt', 'guide'], active.templateMode) ? String(active.templateMode) : SECTION_TEMPLATE_DEFAULT
    };
  }
  function visitTemplateProfiles(family) {
    family = visitTemplateFamily(family);
    if (!family) return [];
    try { return visibleSectionProfiles(family, (read().families[family] || {}).profiles); }
    catch (e) { return []; }
  }
  function visitTemplateSelectedProfile(family) {
    family = visitTemplateFamily(family);
    var sel = q('mlsVnTplProfile_' + family), state = (read().families[family] || familyDefaults(family));
    var profiles = visibleSectionProfiles(family, state.profiles);
    /* A freshly mounted selector has no value until its options are painted.
       Fall back to the persisted owner, not the first row, so reopening
       Settings displays and edits the same format generation is using. */
    var requested = sel && sel.value ? String(sel.value) : String(state.activeProfile || '');
    return activeSectionProfile(family, profiles, requested);
  }
  function visitTemplatePreviewText(text) {
    var lines = String(text || '').split('\n').map(function (line) { return line.trim(); })
      .filter(function (line) { return !!line; }).slice(0, 2);
    if (!lines.length) return VISIT_TEMPLATE_EMPTY;
    return lines.map(function (line) { return line.length > 78 ? line.slice(0, 75) + '...' : line; }).join('\n');
  }
  function visitTemplateStatus(message, bad) {
    var el = q('mlsVnTplStatus');
    if (!el) return;
    el.textContent = String(message || '');
    el.style.color = bad ? '#b4231e' : 'var(--muted)';
  }
  /* The ONE hazard this screen has to close. saveFromUi() writes the `working`
     snapshot taken when Settings opened; a direct profileEditor write made
     while that panel is mounted would otherwise be overwritten by the next
     press of "Save settings". Merge only the just-persisted visit family into
     that snapshot so unrelated unsaved Settings edits remain exactly as typed. */
  function visitTemplateResync(family) {
    try {
      var pending = working ? clone(working) : null, fresh = read();
      if (pending && fresh && family && pending.families && fresh.families && fresh.families[family]) {
        pending.families[family] = fresh.families[family];
        working = pending;
      } else {
        var modal = q('settingsModal');
        if (modal && modal.classList && modal.classList.contains('show')) beginSettings();
      }
    } catch (e) {}
    try { if (typeof window.syncPrefsToServer === 'function') window.syncPrefsToServer({ notify: false }); } catch (eSync) {}
    paintVisitTemplates();
  }
  function visitTemplateSave(family, text, mode) {
    family = visitTemplateFamily(family);
    if (!family) return false;
    var editor = profileEditor(family);
    if (!editor) return false;
    var clean = cleanTemplate(text, MAX_SECTION_TEMPLATE);
    var wanted = has(['strict', 'adapt', 'guide'], mode) ? String(mode) : SECTION_TEMPLATE_DEFAULT;
    var selected = visitTemplateSelectedProfile(family) || {};
    var targetId = String(selected.id || VISIT_TEMPLATE_PROFILE_ID);
    var name = q('mlsVnTplName_' + family), when = q('mlsVnTplWhen_' + family), section = q('mlsVnTplSectionMode_' + family), comments = q('mlsVnTplComments_' + family);
    var label = cleanReusableText(name ? name.value : selected.label, 80) || VISIT_TEMPLATE_PROFILE_LABEL;
    var useWhen = cleanReusableText(when ? when.value : selected.when, 180);
    var sectionMode = section && section.value ? String(section.value) : String(selected.sectionMode || (SECTION_MODES[family] || [])[0] && SECTION_MODES[family][0][0] || 'default');
    var instructions = cleanReusableText(comments ? comments.value : selected.instructions, MAX_INSTRUCTIONS);
    var mine = editor.list().filter(function (row) { return row.id === targetId; })[0];
    var saved;
    if (mine) {
      saved = editor.update(targetId, {
        label: label, when: useWhen, sectionMode: sectionMode, instructions: instructions, templateText: clean, templateMode: wanted
      });
      if (saved) saved = editor.select(targetId);
    } else {
      saved = editor.add({
        id: targetId, label: label, when: useWhen, sectionMode: sectionMode,
        templateText: clean, templateMode: wanted, instructions: instructions
      });
    }
    return saved ? true : false;
  }
  function visitTemplateClear(family) {
    family = visitTemplateFamily(family);
    if (!family) return false;
    var editor = profileEditor(family), selected = visitTemplateSelectedProfile(family) || {};
    var targetId = String(selected.id || VISIT_TEMPLATE_PROFILE_ID);
    return !!(editor && targetId && editor.update(targetId, { templateText: '', templateMode: 'guide' }));
  }
  function visitTemplateRemove(family) {
    family = visitTemplateFamily(family);
    if (!family) return false;
    var editor = profileEditor(family);
    if (!editor) return false;
    var rows = editor.list();
    var selected = visitTemplateSelectedProfile(family) || {};
    var selectedId = String(selected.id || VISIT_TEMPLATE_PROFILE_ID);
    var mine = rows.filter(function (row) { return row.id === selectedId; })[0];
    var shipped = sectionProfiles(family);
    var fallback = String((shipped[0] || {}).id || '');
    if (mine && rows.length > 1) {
      if (!editor.remove(selectedId)) return false;
      if (fallback && editor.list().some(function (row) { return row.id === fallback; })) editor.select(fallback);
      return true;
    }
    return false;
  }
  function visitTemplateEditorClose(family) {
    visitUploadRequest++;
    var host = q('mlsVnTplEditor_' + family);
    if (!host) return;
    host.setAttribute('data-open', '0');
    host.hidden = true; host.style.display = 'none';
    var toggle = q('mlsVnTplOpen_' + family);
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  function visitTemplateEditorOpen(family) {
    visitUploadRequest++;
    var host = q('mlsVnTplEditor_' + family);
    if (!host) return;
    var wasOpen = host.getAttribute('data-open') === '1';
    VISIT_TEMPLATE_SECTIONS.forEach(function (row) { visitTemplateEditorClose(row[0]); });
    if (wasOpen) { visitTemplateStatus(''); return; }
    var current = visitTemplateSelectedProfile(family) || visitActiveTemplate(family);
    var box = q('mlsVnTplText_' + family);
    if (box) box.value = current.templateText;
    var name = q('mlsVnTplName_' + family), when = q('mlsVnTplWhen_' + family), section = q('mlsVnTplSectionMode_' + family), comments = q('mlsVnTplComments_' + family);
    if (name) name.value = String(current.label || VISIT_TEMPLATE_PROFILE_LABEL);
    if (when) when.value = String(current.when || '');
    if (section) section.value = String(current.sectionMode || ((SECTION_MODES[family] || [])[0] || [])[0] || 'default');
    if (comments) comments.value = String(current.instructions || '');
    var picked = current.templateText ? current.templateMode : SECTION_TEMPLATE_DEFAULT;
    VISIT_TEMPLATE_MODES.forEach(function (row) {
      var radio = q('mlsVnTplMode_' + family + '_' + row[0]);
      if (radio) radio.checked = row[0] === picked;
    });
    var named = q('mlsVnTplFileName_' + family);
    if (named) named.textContent = '';
    host.setAttribute('data-open', '1');
    host.hidden = false; host.style.display = '';
    var toggle = q('mlsVnTplOpen_' + family);
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    visitTemplateStatus('');
    if (box && typeof box.focus === 'function') { try { box.focus({ preventScroll: true }); } catch (eFocus) {} }
  }
  function visitTemplatePickedMode(family) {
    var picked = SECTION_TEMPLATE_DEFAULT;
    VISIT_TEMPLATE_MODES.forEach(function (row) {
      var radio = q('mlsVnTplMode_' + family + '_' + row[0]);
      if (radio && radio.checked) picked = row[0];
    });
    return picked;
  }
  function paintVisitTemplates() {
    VISIT_TEMPLATE_SECTIONS.forEach(function (row) {
      var preview = q('mlsVnTplPreview_' + row[0]);
      if (!preview) return;
      var family = row[0], profiles = visitTemplateProfiles(family), current = visitTemplateSelectedProfile(family) || visitActiveTemplate(family);
      var selector = q('mlsVnTplProfile_' + family);
      if (selector) {
        while (selector.firstChild) selector.removeChild(selector.firstChild);
        profiles.forEach(function (profile) { var option = document.createElement('option'); option.value = String(profile.id || ''); option.textContent = String(profile.label || profile.id || ''); selector.appendChild(option); });
        selector.value = current.id || (profiles[0] && profiles[0].id) || '';
      }
      var del = q('mlsVnTplDelete_' + family);
      if (del) { del.disabled = profiles.length <= 1; del.setAttribute('aria-disabled', del.disabled ? 'true' : 'false'); }
      preview.textContent = visitTemplatePreviewText(current.templateText);
      var note = q('mlsVnTplNow_' + row[0]);
      if (!note) return;
      var label = '';
      if (current.templateText) {
        VISIT_TEMPLATE_MODES.forEach(function (mode) { if (mode[0] === current.templateMode) label = mode[1]; });
      }
      note.textContent = label ? ('Now set to: ' + label) : '';
      note.style.display = label ? '' : 'none';
    });
  }
  function buildVisitTemplateRow(family, title, hint) {
    var row = document.createElement('div');
    row.className = 'field';
    row.id = 'mlsVnTplRow_' + family;
    row.setAttribute('style', 'border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px');
    row.innerHTML =
      '<div class="row" style="align-items:flex-start;gap:10px;flex-wrap:wrap">' +
        '<div style="flex:1 1 240px;min-width:0">' +
          '<p style="margin:0 0 2px;font-weight:700">' + title + '</p>' +
          '<p class="mini" style="margin:0 0 6px;color:var(--muted)">' + hint + '</p>' +
          '<p class="mini" id="mlsVnTplPreview_' + family + '" style="margin:0;white-space:pre-wrap;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace"></p>' +
          '<p class="mini" id="mlsVnTplNow_' + family + '" style="margin:4px 0 0;display:none;color:#8A5A00"></p>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><label for="mlsVnTplProfile_' + family + '" class="mini">Saved format</label><select class="sf-select" id="mlsVnTplProfile_' + family + '" aria-label="Choose a saved ' + title + ' format"></select><button type="button" class="btn-ghost" id="mlsVnTplAdd_' + family + '" aria-label="Add a ' + title + ' format">＋ Add</button><button type="button" class="btn-ghost" id="mlsVnTplDelete_' + family + '" aria-label="Delete the selected ' + title + ' format">Delete format</button><button type="button" class="btn-ghost" id="mlsVnTplOpen_' + family + '" aria-label="Paste or upload a ' + title + ' template" aria-expanded="false" aria-controls="mlsVnTplEditor_' + family + '">Paste or upload a template</button></div>' +
      '</div>' +
      '<div id="mlsVnTplEditor_' + family + '" data-open="0" hidden style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">' +
        '<label for="mlsVnTplText_' + family + '">Paste your template here, or upload the file you already use.</label>' +
        '<textarea class="note-box" id="mlsVnTplText_' + family + '" maxlength="' + MAX_SECTION_TEMPLATE + '" placeholder="Type or paste the headings and wording you want MLS to use for this section." style="min-height:140px;box-sizing:border-box"></textarea>' +
        '<div class="row" style="margin-top:8px;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<button type="button" class="btn-ghost" id="mlsVnTplUpload_' + family + '" aria-label="Upload a ' + title + ' template file">Upload a file</button>' +
          '<span class="mini" id="mlsVnTplFileName_' + family + '" style="color:var(--muted)"></span>' +
        '</div>' +
        '<p class="mini" style="margin:6px 0 0;color:var(--muted)">Word, PDF or plain text. Keep patient facts out of it - this is only the shape of the section.</p>' +
        '<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Advanced format settings</summary><div style="display:grid;gap:8px;margin-top:8px"><label>Format name<input class="sf-input" id="mlsVnTplName_' + family + '" type="text" maxlength="80"></label><label>Use automatically when<input class="sf-input" id="mlsVnTplWhen_' + family + '" type="text" maxlength="180" placeholder="Optional trigger or context"><button type="button" class="btn-ghost" id="mlsVnTplWhenSuggest_' + family + '" style="margin-top:6px">Suggest from this template</button><p class="mini" id="mlsVnTplWhenWhy_' + family + '" role="status" style="display:none;color:#8A5A00"></p></label><label>Section format<select class="sf-select" id="mlsVnTplSectionMode_' + family + '"></select></label><label>AI comments for this format<textarea class="note-box" id="mlsVnTplComments_' + family + '" maxlength="' + MAX_INSTRUCTIONS + '" style="min-height:60px"></textarea></label></div></details>' +
        '<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Create from a past example</summary><p class="mini">Paste a de-identified example and MLS will make a PHI-stripped reusable preview. Nothing is saved until you apply it and save the format.</p><textarea class="note-box" id="mlsVnTplExample_' + family + '" maxlength="20000" style="min-height:90px" placeholder="Paste an example visit note here"></textarea><div class="row" style="margin-top:6px;gap:8px"><button type="button" class="btn-ghost" id="mlsVnTplExampleDerive_' + family + '">Create preview</button><button type="button" class="btn-green" id="mlsVnTplExampleApply_' + family + '" disabled>Apply preview</button></div><div id="mlsVnTplExamplePreview_' + family + '" hidden><label>Suggested format name<input class="sf-input" id="mlsVnTplExampleName_' + family + '" maxlength="80"></label><label>Reusable template preview<textarea class="note-box" id="mlsVnTplExampleTemplate_' + family + '" maxlength="2000"></textarea></label><label>AI comments preview<textarea class="note-box" id="mlsVnTplExampleComments_' + family + '" maxlength="' + MAX_INSTRUCTIONS + '"></textarea></label></div><p class="mini" id="mlsVnTplExampleStatus_' + family + '" role="status"></p></details>' +
        '<p style="margin:12px 0 4px;font-weight:700">How closely should MLS follow it?</p>' +
        '<div id="mlsVnTplModes_' + family + '"></div>' +
        '<div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
          '<button type="button" class="btn-green" id="mlsVnTplSave_' + family + '" aria-label="Save ' + title + ' template">Save</button>' +
          '<button type="button" class="btn-ghost" id="mlsVnTplClear_' + family + '" aria-label="Clear ' + title + ' template">Clear template</button>' +
          '<button type="button" class="btn-ghost" id="mlsVnTplCancel_' + family + '" aria-label="Cancel editing ' + title + ' template">Cancel</button>' +
        '</div>' +
      '</div>';
    var modes = row.querySelector('#mlsVnTplModes_' + family);
    VISIT_TEMPLATE_MODES.forEach(function (mode) {
      var wrap = document.createElement('div');
      wrap.setAttribute('style', 'margin-bottom:8px');
      var label = document.createElement('label');
      label.setAttribute('for', 'mlsVnTplMode_' + family + '_' + mode[0]);
      label.setAttribute('style', 'display:flex;gap:8px;align-items:flex-start;font-weight:600');
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'mlsVnTplModeGroup_' + family;
      input.id = 'mlsVnTplMode_' + family + '_' + mode[0];
      input.value = mode[0];
      if (mode[0] === SECTION_TEMPLATE_DEFAULT) input.checked = true;
      label.appendChild(input);
      label.appendChild(document.createTextNode(mode[1]));
      var why = document.createElement('p');
      why.className = 'mini';
      why.setAttribute('style', 'margin:2px 0 0 24px;color:var(--muted)');
      why.textContent = mode[2];
      wrap.appendChild(label);
      wrap.appendChild(why);
      modes.appendChild(wrap);
    });
    var sectionMode = row.querySelector('#mlsVnTplSectionMode_' + family);
    (SECTION_MODES[family] || []).forEach(function (choice) { var option = document.createElement('option'); option.value = choice[0]; option.textContent = choice[1]; sectionMode.appendChild(option); });
    row.querySelector('#mlsVnTplWhenSuggest_' + family).addEventListener('click', function () {
      var when = row.querySelector('#mlsVnTplWhen_' + family), why = row.querySelector('#mlsVnTplWhenWhy_' + family), selected = visitTemplateSelectedProfile(family) || {};
      var result = suggestWhen(family, selected.id, (row.querySelector('#mlsVnTplName_' + family) || {}).value, (row.querySelector('#mlsVnTplText_' + family) || {}).value);
      if (result.error === 'empty') { why.textContent = 'Add the template first - the suggestion is read from its headings.'; why.style.display = ''; return; }
      if (result.error || !result.result) { why.textContent = 'Suggestions are not available here. Type the rule yourself.'; why.style.display = ''; return; }
      when.value = result.result.terms.join(', '); why.textContent = result.result.why || ''; why.style.display = result.result.why ? '' : 'none';
    });
    var examplePreview = null, exampleImporterSession = null;
    row.querySelector('#mlsVnTplExampleDerive_' + family).addEventListener('click', async function () {
      var status = row.querySelector('#mlsVnTplExampleStatus_' + family), text = row.querySelector('#mlsVnTplExample_' + family).value;
      var selected = visitTemplateSelectedProfile(family) || {}, importer = exampleImporter(family, selected.id);
      if (!importer || !String(text || '').trim()) { status.textContent = 'Paste an example first.'; return; }
      status.textContent = 'Creating a private preview...';
      try { var extracted = await importer.extract({ kind: 'draft', text: text }); examplePreview = importer.preview(await importer.derive(extracted)); exampleImporterSession = importer; row.querySelector('#mlsVnTplExampleName_' + family).value = examplePreview.name || ''; row.querySelector('#mlsVnTplExampleTemplate_' + family).value = examplePreview.templateText || ''; row.querySelector('#mlsVnTplExampleComments_' + family).value = examplePreview.instructions || ''; row.querySelector('#mlsVnTplExamplePreview_' + family).hidden = !examplePreview; row.querySelector('#mlsVnTplExampleApply_' + family).disabled = !examplePreview; status.textContent = examplePreview ? 'Preview ready. Review and edit it, then apply.' : ''; }
      catch (error) { status.textContent = String(error && error.message || 'Preview unavailable.'); }
    });
    row.querySelector('#mlsVnTplExampleApply_' + family).addEventListener('click', function () {
      var status = row.querySelector('#mlsVnTplExampleStatus_' + family);
      if (!exampleImporterSession || !exampleImporterSession.scopeCurrent() || !examplePreview) { status.textContent = 'Create a preview first.'; return; }
      examplePreview = { name: row.querySelector('#mlsVnTplExampleName_' + family).value, templateText: row.querySelector('#mlsVnTplExampleTemplate_' + family).value, instructions: row.querySelector('#mlsVnTplExampleComments_' + family).value };
      if (!String(examplePreview.templateText || '').trim()) { status.textContent = 'The reusable template preview cannot be blank.'; return; }
      row.querySelector('#mlsVnTplName_' + family).value = examplePreview.name || '';
      row.querySelector('#mlsVnTplText_' + family).value = examplePreview.templateText || '';
      row.querySelector('#mlsVnTplComments_' + family).value = examplePreview.instructions || '';
      status.textContent = 'Preview applied to the editor. Review it, then save.';
    });
    row.querySelector('#mlsVnTplOpen_' + family).addEventListener('click', function () { visitTemplateEditorOpen(family); });
    row.querySelector('#mlsVnTplProfile_' + family).addEventListener('change', function () {
      examplePreview = null; exampleImporterSession = null;
      row.querySelector('#mlsVnTplExampleApply_' + family).disabled = true;
      visitTemplateEditorClose(family);
      var selector = row.querySelector('#mlsVnTplProfile_' + family);
      var editor = profileEditor(family);
      var picked = selector && String(selector.value || '');
      if (!editor || !picked || !editor.select(picked)) {
        paintVisitTemplates();
        visitTemplateStatus('That saved format could not be selected on this device. Try again.', true);
        return;
      }
      visitTemplateResync(family);
      visitTemplateStatus('Selected. MLS will use this saved format for ' + title + '.');
    });
    row.querySelector('#mlsVnTplAdd_' + family).addEventListener('click', function () {
      var editor = profileEditor(family), profiles = visitTemplateProfiles(family);
      if (!editor || profiles.length >= MAX_SECTION_PROFILES) { visitTemplateStatus('You can keep up to ' + MAX_SECTION_PROFILES + ' saved formats per section.', true); return; }
      var next = editor.add({ id: 'visit_' + (profiles.length + 1), label: 'New ' + title + ' format', templateText: '', templateMode: SECTION_TEMPLATE_DEFAULT, sectionMode: profiles[0] && profiles[0].sectionMode });
      if (!next) { visitTemplateStatus('That format could not be added on this device. Try again.', true); return; }
      visitTemplateResync(family);
      var selector = q('mlsVnTplProfile_' + family); if (selector) selector.value = next.id;
      visitTemplateEditorClose(family);
      visitTemplateEditorOpen(family);
    });
    row.querySelector('#mlsVnTplDelete_' + family).addEventListener('click', function () {
      if (!visitTemplateRemove(family)) { visitTemplateStatus('The final format cannot be deleted.', true); return; }
      visitTemplateResync(family); visitTemplateEditorClose(family);
    });
    row.querySelector('#mlsVnTplCancel_' + family).addEventListener('click', function () { visitTemplateEditorClose(family); visitTemplateStatus(''); });
    row.querySelector('#mlsVnTplUpload_' + family).addEventListener('click', function () {
      var input = q('mlsVnTplFile');
      if (!input) return;
      visitUploadFamily = family;
      visitUploadRequest++;
      try { input.value = ''; } catch (eClear) {}
      input.click();
    });
    row.querySelector('#mlsVnTplSave_' + family).addEventListener('click', function () {
      var box = q('mlsVnTplText_' + family);
      var text = box ? box.value : '';
      if (!visitTemplateSave(family, text, visitTemplatePickedMode(family))) {
        visitTemplateStatus('That template could not be saved on this device. Try again.', true);
        return;
      }
      visitTemplateEditorClose(family);
      visitTemplateResync(family);
      visitTemplateStatus('Saved. MLS will use this for your ' + title + ' section.');
      try { if (typeof window.toast === 'function') window.toast('Visit note template saved for ' + title + '.', 'ok'); } catch (eToast) {}
    });
    row.querySelector('#mlsVnTplClear_' + family).addEventListener('click', function () {
      if (!visitTemplateClear(family)) {
        visitTemplateStatus('That template could not be removed on this device. Try again.', true);
        return;
      }
      var box = q('mlsVnTplText_' + family);
      if (box) box.value = '';
      visitTemplateEditorClose(family);
      visitTemplateResync(family);
      visitTemplateStatus('Cleared. MLS writes your ' + title + ' section from what was said.');
      try { if (typeof window.toast === 'function') window.toast('Visit note template cleared for ' + title + '.', 'ok'); } catch (eToast2) {}
    });
    return row;
  }
  function mountVisitTemplates() {
    if (q('mlsVisitNoteTemplatesSection')) { paintVisitTemplates(); return true; }
    var modal = q('settingsModal');
    var box = modal && modal.querySelector('.modal');
    if (!box) return false;
    var sec = document.createElement('div');
    sec.className = 'set-section';
    sec.id = 'mlsVisitNoteTemplatesSection';
    var mountGeneration = ++visitMountGeneration;
    sec.innerHTML =
      '<p class="set-head">📋 Visit note templates</p>' +
      '<p class="set-desc">These shape your visit notes: Whole visit / SOAP, HPI, ROS, Exam, Assessment, Plan. Operative note templates are separate - find them under Templates.</p>' +
      '<button type="button" class="btn-ghost" id="mlsVnTplOpNoteLink" style="margin:-4px 0 12px">Open operative note templates</button>' +
      '<div id="mlsVnTplRows"></div>' +
      '<p class="mini" id="mlsVnTplStatus" role="status" style="margin:6px 0 0;color:var(--muted)"></p>' +
      '<div id="mlsDtCloudStatus" role="status"></div><div id="mlsDtCloudChoices" hidden><button type="button" class="btn-ghost" id="mlsDtCloudKeep">Keep this device</button><button type="button" class="btn-ghost" id="mlsDtCloudUse">Use account copy</button></div>' +
      '<input type="file" id="mlsVnTplFile" aria-hidden="true" tabindex="-1" accept="' + VISIT_TEMPLATE_FILE_ACCEPT + '" style="display:none">';
    var rows = sec.querySelector('#mlsVnTplRows');
    VISIT_TEMPLATE_SECTIONS.forEach(function (row) { rows.appendChild(buildVisitTemplateRow(row[0], row[1], row[2])); });
    sec.querySelector('#mlsDtCloudKeep').addEventListener('click', function () { resolveCloud('local'); });
    sec.querySelector('#mlsDtCloudUse').addEventListener('click', function () { resolveCloud('remote'); });
    paintCloudStatus();
    var link = sec.querySelector('#mlsVnTplOpNoteLink');
    if (link) link.addEventListener('click', function () {
      try { if (typeof window.openTemplates === 'function') window.openTemplates(); }
      catch (e) { try { if (typeof window.toast === 'function') window.toast('The operative note templates could not be opened.', 'err'); } catch (e2) {} }
    });
    var file = sec.querySelector('#mlsVnTplFile');
    if (file) file.addEventListener('change', function (ev) {
      var picked = ev && ev.target && ev.target.files ? ev.target.files[0] : null;
      var family = visitTemplateFamily(visitUploadFamily);
      try { ev.target.value = ''; } catch (eReset) {}
      if (!picked || !family) return;
      var request = ++visitUploadRequest, scope = storageScope();
      var profile = visitTemplateSelectedProfile(family);
      var profileId = profile && profile.id;
      var target = q('mlsVnTplText_' + family), named = q('mlsVnTplFileName_' + family);
      visitTemplateStatus('Reading ' + (picked.name || 'that file') + '...');
      visitTemplateFileText(picked).then(function (text) {
        var current = visitTemplateSelectedProfile(family);
        if (request !== visitUploadRequest || !scopeCurrent(scope) ||
            mountGeneration !== visitMountGeneration || q('mlsVisitNoteTemplatesSection') !== sec ||
            q('mlsVnTplFile') !== file || q('mlsVnTplText_' + family) !== target ||
            visitUploadFamily !== family || !current || current.id !== profileId) return;
        var clean = cleanTemplate(text, MAX_SECTION_TEMPLATE);
        if (!clean) {
          if (named) named.textContent = '';
          visitTemplateStatus('That file could not be read. Save it as a Word file or a PDF, or paste the text instead.', true);
          return;
        }
        if (target) target.value = clean;
        if (named) named.textContent = String(picked.name || '');
        visitTemplateStatus('Loaded from ' + (picked.name || 'that file') + '. Check it, choose how closely to follow it, then press Save.');
      });
    });
    /* FIRST card in Notes & AI, above "AI output formats" - anchored on the
       Note-defaults section by the stable id INSIDE it rather than by its
       heading copy, so a copy change cannot silently move this screen. */
    var anchor = null;
    var noteFormat = q('noteFormatSel');
    if (noteFormat && noteFormat.closest) anchor = noteFormat.closest('.set-section');
    if (!anchor || anchor.parentNode !== box) anchor = q('mlsDraftTuningSection');
    if (!anchor || anchor.parentNode !== box) {
      anchor = null;
      for (var i = 0; i < box.children.length; i++) {
        var child = box.children[i];
        if (child.classList && child.classList.contains('row') && /saveSettings/.test(String(child.innerHTML || ''))) { anchor = child; break; }
      }
    }
    box.insertBefore(sec, anchor || null);
    /* The Settings organizer files every card into a tab with a LIVE classifier,
       but it only re-runs that pass on a tab press or a Settings open. A card
       mounted after the rail was already built would otherwise sit visible under
       whatever tab happens to be showing. Match the selected tab now; the next
       organizer pass owns it from there.
       CLASS ONLY - vntplhide-1.0.0 (owner 2026-09-11: "Configure... does
       nothing"). MEASURED: this used to ALSO write sec.style.display='none'
       inline. mlsSelectSettingsTab() - the function every tab click and every
       other caller of "switch to Notes & AI" runs through, including
       feat_mls_firstrun.js's own Configure handler - only ever toggles the
       set-tab-hidden CLASS (secs.forEach((s,i)=>s.classList.toggle(...))); it
       never touches an element's inline style. An inline display:none beats
       that class forever, so the very first time Settings opened on any tab
       other than Notes & AI, this card was hidden and could never be shown
       again for the rest of the page's life - not from the Notes & AI tab,
       not from Configure, not by any means short of a reload. The CSS rule
       (.set-section.set-tab-hidden{display:none}) already does exactly what
       the inline write was trying to do, and it is the one mechanism every
       other caller actually clears. */
    try {
      var bar = q('settingsTabBar');
      var current = bar && bar.querySelector('[data-mls-settings-group].on');
      if (current && current.getAttribute('data-mls-settings-group') !== 'notes') {
        sec.classList.add('set-tab-hidden');
      }
    } catch (eRail) {}
    paintVisitTemplates();
    paintCloudStatus();
    return true;
  }
  /* The route the visit room's one-line link takes. */
  function openVisitTemplates(options) {
    try { if (typeof window.openSettings === 'function' && window.openSettings(options) === false) return false; } catch (e) { return false; }
    mountVisitTemplates();
    function focus(n) {
      var sec = q('mlsVisitNoteTemplatesSection');
      var modal = q('settingsModal');
      if (sec && modal && modal.classList.contains('show')) {
        var tab = document.querySelector('#settingsTabBar [data-mls-settings-group="notes"]');
        if (tab && typeof tab.click === 'function') { try { tab.click(); } catch (eTab) {} }
        sec.classList.remove('set-tab-hidden');
        sec.style.display = '';
        try { sec.scrollIntoView({ block: 'start', inline: 'nearest' }); } catch (eScroll) {}
        paintVisitTemplates();
        return true;
      }
      if (n >= 30) return false;
      setTimeout(function () { mountVisitTemplates(); focus(n + 1); }, 100);
      return false;
    }
    return focus(0);
  }
  /* Dedicated account copy. Metadata is local-only and never enters prefs.
     No profile union: deletion and active selection are deliberate choices. */
  var cloudQueues = Object.create(null), cloudView = null;
  function canonicalCloud(value) {
    function stable(v) {
      if (Array.isArray(v)) return v.map(stable);
      if (v && typeof v === 'object') { var out = {}; Object.keys(v).sort().forEach(function (key) { out[key] = stable(v[key]); }); return out; }
      return v;
    }
    return JSON.stringify(stable(sanitize(value)));
  }
  async function cloudHash(text) {
    var bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function cloudContext(opts) {
    opts = opts || {};
    var scope = storageScope(), token = typeof window.bkToken === 'function' ? window.bkToken() : '';
    var base = typeof window.bkBase === 'function' ? window.bkBase() : '';
    return { scope: scope, token: token, base: base, opts: opts, valid: function () {
      return scopeCurrent(scope) && token === (typeof window.bkToken === 'function' ? window.bkToken() : '') &&
        !(opts.signal && opts.signal.aborted) && (!opts.valid || opts.valid());
    } };
  }
  function cloudKey(ctx, suffix) { return ctx.scope.key + '::cloud-' + suffix; }
  function paintCloudStatus() {
    var status = q('mlsDtCloudStatus'), choices = q('mlsDtCloudChoices');
    var view = cloudView && scopeCurrent(cloudView.scope) ? cloudView : null;
    if (status) status.textContent = view ? view.message : '';
    if (choices) choices.hidden = !(view && view.conflict);
  }
  function cloudStatus(ctx, message, conflict) {
    if (!ctx.valid()) return;
    cloudView = { scope: ctx.scope, message: message, conflict: conflict || null };
    paintCloudStatus();
  }
  function cloudConflict(ctx, localHash, remote, revision, remoteHash) {
    cloudStatus(ctx, 'This device and your account have different saved formats. Both copies are safe. Choose which copy to use.',
      { localHash: localHash, remote: remote, revision: revision, remoteHash: remoteHash });
    return { ok: false, legacy: false, conflict: true };
  }
  function cloudMeta(ctx, revision, sha256) {
    if (ctx.valid()) localStorage.setItem(cloudKey(ctx, 'baseline'), JSON.stringify({ revision: revision, sha256: sha256 }));
  }
  async function cloudRequest(ctx, method, body) {
    if (!ctx.valid()) throw scopeError();
    var init = { method: method, headers: { Authorization: 'Bearer ' + ctx.token }, signal: ctx.opts.signal, cache: 'no-store' };
    if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    var response = await fetch(ctx.base + '/api/prefs/draft-tuning', init);
    if (!ctx.valid()) throw scopeError();
    return response;
  }
  async function runCloud(ctx, mode, decision) {
    if (!ctx.valid()) return { ok: false, legacy: false };
    if (!ctx.token || typeof window.backendMode !== 'function' || !window.backendMode()) {
      cloudStatus(ctx, 'Saved on this device. Sign in to save formats to your account.');
      return { ok: false, legacy: false };
    }
    var raw = localStorage.getItem(ctx.scope.key), local = raw ? canonicalCloud(JSON.parse(raw)) : null;
    var editingAtStart = working ? JSON.stringify(working) : null;
    var localHash = local === null ? null : await cloudHash(local);
    function unchanged() { return ctx.valid() && localStorage.getItem(ctx.scope.key) === raw; }
    if (!unchanged()) return { ok: false, legacy: false };
    var blocked = localStorage.getItem(cloudKey(ctx, 'too-large'));
    if (blocked && blocked === localHash && !decision) {
      cloudStatus(ctx, 'Saved on this device. These formats are too large for account storage; the account copy is unchanged. Shorten them before trying again.');
      return { ok: false, legacy: false, tooLarge: true };
    }
    cloudStatus(ctx, mode === 'load' ? 'Checking your account formats…' : 'Saving formats to your account…');
    var response = await cloudRequest(ctx, 'GET');
    if (!unchanged()) return { ok: false, legacy: false };
    if (response.status === 404 || response.status === 405) {
      cloudStatus(ctx, 'Saved on this device. This server uses the older account sync.');
      return { ok: false, legacy: true };
    }
    if (!response.ok) throw new Error('Account formats could not be checked (' + response.status + ').');
    var account = await response.json();
    if (!unchanged()) return { ok: false, legacy: false };
    if (!account || !Number.isInteger(account.revision) || account.revision < 0 ||
        !has(['segment', 'legacy', 'none'], account.source) || (account.source === 'segment' ? account.revision < 1 : account.revision !== 0) ||
        (account.draftTuning !== null && (!account.draftTuning || typeof account.draftTuning !== 'object' || Array.isArray(account.draftTuning)))) throw new Error('The account format response could not be read.');
    var remote = account.draftTuning === null ? null : canonicalCloud(account.draftTuning);
    var remoteHash = remote === null ? null : await cloudHash(remote);
    if (!unchanged()) return { ok: false, legacy: false };
    var meta = null;
    try { meta = JSON.parse(localStorage.getItem(cloudKey(ctx, 'baseline')) || 'null'); } catch (_) {}
    var same = localHash === remoteHash;
    if (decision && (decision.localHash !== localHash || decision.revision !== account.revision || decision.remoteHash !== remoteHash))
      return cloudConflict(ctx, localHash, remote, account.revision, remoteHash);
    var defaultHash = remote === null ? await cloudHash(canonicalCloud(defaultState())) : null;
    if (!unchanged()) return { ok: false, legacy: false };
    if (decision && decision.choice === 'remote' && remote === null) {
      localStorage.removeItem(ctx.scope.key);
      cloudMeta(ctx, 0, defaultHash);
      localStorage.removeItem(cloudKey(ctx, 'too-large'));
      try { window.dispatchEvent(new CustomEvent('mls:draft-tuning-saved')); } catch (_) {}
      if (working) working = defaultState();
      VISIT_TEMPLATE_SECTIONS.forEach(function (row) {
        visitTemplateEditorClose(row[0]);
        var select = q('mlsVnTplProfile_' + row[0]); if (select) select.value = read().families[row[0]].activeProfile;
      });
      paintVisitTemplates(); if (working) loadUi(activeFamily);
      cloudStatus(ctx, 'The account has no saved formats. This device now uses MLS defaults.');
      return { ok: true, legacy: false, changed: true };
    }
    var adopt = decision ? decision.choice === 'remote' :
      (local === null || (meta && meta.sha256 === localHash));
    var migrateLegacy = mode === 'sync' && same && local !== null && account.source === 'legacy';
    if ((same && !migrateLegacy) || (!same && adopt && remote !== null)) {
      if (!same) {
        if (!unchanged()) return { ok: false, legacy: false };
        var openEditor = VISIT_TEMPLATE_SECTIONS.some(function (row) { var el = q('mlsVnTplEditor_' + row[0]); return el && el.getAttribute('data-open') === '1'; });
        if (!decision && (openEditor || (working ? JSON.stringify(working) : null) !== editingAtStart)) {
          cloudStatus(ctx, 'Your template edits are still open. Save or close the editor, then save Settings to check account formats.');
          return { ok: false, legacy: false };
        }
        localStorage.setItem(ctx.scope.key, remote);
        raw = remote;
        if (working) working = sanitize(JSON.parse(remote));
        VISIT_TEMPLATE_SECTIONS.forEach(function (row) { visitTemplateEditorClose(row[0]); var select = q('mlsVnTplProfile_' + row[0]); if (select) select.value = read().families[row[0]].activeProfile; });
        try { window.dispatchEvent(new CustomEvent('mls:draft-tuning-saved')); } catch (_) {}
        paintVisitTemplates();
        if (working) loadUi(activeFamily);
      }
      if (remoteHash !== null) cloudMeta(ctx, account.revision, remoteHash);
      if (ctx.valid()) localStorage.removeItem(cloudKey(ctx, 'too-large'));
      if (mode === 'sync' && account.source === 'legacy' && remote !== null) return runCloud(ctx, 'sync');
      cloudStatus(ctx, remote === null ? 'No account formats saved yet.' : 'Formats saved in your account.');
      return { ok: true, legacy: false, changed: !same };
    }
    if (mode === 'conflict') return cloudConflict(ctx, localHash, remote, account.revision, remoteHash);
    var canPut = migrateLegacy || decision && decision.choice === 'local' ||
      (remote === null && meta && meta.revision === 0 && meta.sha256 === defaultHash) ||
      (!meta && remote === null) || (meta && meta.revision === account.revision && meta.sha256 === remoteHash);
    if (!canPut || local === null) return cloudConflict(ctx, localHash, remote, account.revision, remoteHash);
    var put = await cloudRequest(ctx, 'PUT', { draftTuning: JSON.parse(local), baseRevision: account.revision });
    if (!unchanged()) return { ok: false, legacy: false };
    if (put.status === 409) {
      return runCloud(ctx, 'conflict');
    }
    if (put.status === 413) {
      localStorage.setItem(cloudKey(ctx, 'too-large'), localHash);
      cloudStatus(ctx, 'Saved on this device. These formats are too large for account storage; the account copy is unchanged. Shorten them before trying again.');
      return { ok: false, legacy: false, tooLarge: true };
    }
    if (!put.ok) throw new Error('Account formats could not be saved (' + put.status + ').');
    var receipt = await put.json();
    if (!unchanged()) return { ok: false, legacy: false };
    if (!receipt || !Number.isInteger(receipt.revision) || receipt.revision < 1 || receipt.revision < account.revision || !receipt.draftTuning) throw new Error('The account save could not be confirmed.');
    var accepted = canonicalCloud(receipt.draftTuning), acceptedHash = await cloudHash(accepted);
    if (!unchanged()) return { ok: false, legacy: false };
    cloudMeta(ctx, receipt.revision, acceptedHash);
    if (acceptedHash !== localHash) return cloudConflict(ctx, localHash, accepted, receipt.revision, acceptedHash);
    localStorage.removeItem(cloudKey(ctx, 'too-large'));
    cloudStatus(ctx, 'Formats saved in your account.');
    return { ok: true, legacy: false };
  }
  function cloudRun(mode, opts, decision) {
    var ctx = cloudContext(opts), queueKey = ctx.scope.key + ':' + ctx.scope.sessionEpoch + ':' + ctx.scope.boundaryEpoch;
    var previous = cloudQueues[queueKey] || Promise.resolve();
    var next = previous.catch(function () {}).then(function () { return runCloud(ctx, mode, decision); }).catch(function () {
      cloudStatus(ctx, 'Saved on this device. The account copy could not be confirmed. Try saving again when connected.');
      return { ok: false, legacy: false };
    });
    cloudQueues[queueKey] = next;
    return next;
  }
  function resolveCloud(choice) {
    if (!cloudView || !scopeCurrent(cloudView.scope) || !cloudView.conflict) return Promise.resolve(false);
    var decision = Object.assign({ choice: choice }, cloudView.conflict);
    return cloudRun('sync', {}, decision);
  }
  function boot() {
    mountSettings();
    mountVisitTemplates();
    watchModal();
    try { document.addEventListener('click', onClick, true); } catch (e) {}
    try { window.addEventListener('mls:session-boundary', onSessionBoundary, true); } catch (eBoundary) {}
    try {
      if (typeof PREF_SYNC_KEYS !== 'undefined' && PREF_SYNC_KEYS.indexOf(STORE_KEY) < 0) PREF_SYNC_KEYS.push(STORE_KEY);
    } catch (e2) {}
  }

  var api = {
    installed: true,
    version: VERSION,
    storeKey: STORE_KEY,
    familyIds: FAMILY_IDS.slice(),
    familyLabels: clone(FAMILY_LABELS),
    defaults: defaultState,
    sanitize: sanitize,
    read: read,
    write: write,
    /* fmt-1.0.0: both readers feed PICKERS (the visit screen's per-section
       overrides and Settings), so both hide test-lane artifacts. Nothing here
       writes, so nothing here deletes. */
    profiles: function (id) { var family = familyId(id); return isProfileFamily(family) ? clone(visibleSectionProfiles(family, read().families[family].profiles)) : []; },
    profileState: function (id) { var family = familyId(id), state = read().families[family], profiles = isProfileFamily(family) ? visibleSectionProfiles(family, state.profiles) : []; return { activeProfile: state.activeProfile || '', activeLabel: (profiles.filter(function (row) { return row.id === state.activeProfile; })[0] || profiles[0] || {}).label || '', profiles: clone(profiles) }; },
    testProfiles: testLaneProfiles,
    removeTestProfiles: removeTestLaneProfiles,
    isTestProfile: isTestLaneProfile,
    profileEditor: profileEditor,
    exampleImporter: exampleImporter,
    autoRoute: automaticRoutes,
    forFamily: mergeFamily,
    forStructured: structuredFamily,
    infer: infer,
    promptBlock: promptBlock,
    selectProfile: function (id, selectionSource) { var family = familyId(id), state = read().families[family], routed = isProfileFamily(family) ? routedSectionProfile(family, state.profiles, state.activeProfile, selectionSource) : null; return routed ? { profileId: routed.profile.id, selection: routed.selection } : null; },
    mountSettings: mountSettings,
    mountVisitTemplates: mountVisitTemplates,
    openVisitTemplates: openVisitTemplates,
    visitTemplateSections: VISIT_TEMPLATE_SECTIONS.map(function (row) { return row[0]; }),
    beginSettings: beginSettings,
    saveFromUi: saveFromUi,
    cloudSync: function (opts) { return cloudRun('sync', opts); },
    cloudLoad: function (opts) { return cloudRun('load', opts); },
    resolveCloud: resolveCloud,
    cloudLegacyResult: function (opts) {
      var ctx = cloudContext(opts);
      cloudStatus(ctx, opts.ok ? 'Formats saved in your account using the older sync.' : 'Saved on this device. The older account sync could not save your formats.');
    },
    _extra: clone(EXTRA),
    _enums: clone(ENUMS)
  };
  window.__mlsDraftTuning = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
