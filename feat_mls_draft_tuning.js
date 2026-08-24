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

  var VERSION = '1.3.0';
  var STORE_KEY = 'draftTuningV1';
  var MAX_INSTRUCTIONS = 600;
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
    opnote: { key: 'templateMode', label: 'Template handling', choices: [['strict', 'Follow template strictly'], ['adapt', 'Adapt only where supported'], ['guide', 'Use template as a guide']] },
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
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function sectionProfiles(id) {
    return clone(SECTION_PROFILE_DEFAULTS[id] || GENERIC_PROFILE_DEFAULTS[id] || []).map(function (row) {
      row.templateText = row.templateText || '';
      row.instructions = row.instructions || '';
      row.when = row.when || '';
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
        sectionMode: has(modeValues, row.sectionMode) ? String(row.sectionMode) : (fallback.sectionMode || modes[0][0]),
        templateMode: enumValue('templateMode', row.templateMode, fallback.templateMode || SECTION_TEMPLATE_DEFAULT),
        templateText: cleanTemplate(row.templateText || row.templateBody || row.template, MAX_SECTION_TEMPLATE),
        instructions: cleanReusableText(row.instructions, MAX_INSTRUCTIONS)
      });
    });
    return out.length ? out : defaults;
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
      var profiles = sanitizeSectionProfiles(id, Array.isArray(request.profiles) ? request.profiles : state.profiles);
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
  function read() {
    try {
      var raw = localStorage.getItem(storageKey());
      return raw ? sanitize(JSON.parse(raw)) : defaultState();
    } catch (e) { return defaultState(); }
  }
  function write(state) {
    var clean = sanitize(state);
    try { localStorage.setItem(storageKey(), JSON.stringify(clean)); return clean; }
    catch (e) { return null; }
  }
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
  function exampleImporter(id, profile) {
    id = familyId(id);
    if (!isProfileFamily(id)) return null;
    var targetId = profileId(profile, ''), previewState = null;
    function sanitizeDerived(value) {
      value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      var templateText = cleanTemplate(value.templateText || value.template || value.templateBody, MAX_SECTION_TEMPLATE);
      var instructions = cleanReusableText(value.instructions || value.promptComments || value.comments, MAX_INSTRUCTIONS);
      var name = cleanReusableText(value.name || value.label, 80);
      if (!templateText) throw new Error('AI did not return a usable template preview.');
      return { name: name, templateText: templateText, instructions: instructions };
    }
    return {
      extract: privateExampleExtractor,
      derive: async function (extracted) {
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
        var payload = {}; try { payload = await response.json(); } catch (e) {}
        if (!response.ok) throw new Error(String(payload.error || payload.message || ('Template preview failed (' + response.status + ').')));
        return sanitizeDerived(payload.result || payload.template || payload);
      },
      preview: function (derived) {
        if (derived != null) previewState = sanitizeDerived(derived);
        return previewState ? clone(previewState) : null;
      },
      cancel: function () { var had = !!previewState; previewState = null; return had; },
      apply: function (derived) {
        if (derived != null) previewState = sanitizeDerived(derived);
        if (!previewState) return false;
        var editor = profileEditor(id);
        var changes = { templateText: previewState.templateText, instructions: previewState.instructions };
        if (previewState.name) changes.label = previewState.name;
        var applied = editor && editor.update(targetId, changes);
        if (applied) previewState = null;
        return applied || false;
      }
    };
  }
  function profileEditor(id) {
    id = familyId(id);
    if (!isProfileFamily(id)) return null;
    function current() {
      var state = read(), family = state.families[id] || familyDefaults(id);
      family.profiles = sanitizeSectionProfiles(id, family.profiles);
      return { state: state, family: family };
    }
    function persist(ctx, profiles, activeId) {
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
      var saved = write(ctx.state);
      if (!saved) return null;
      var savedFamily = saved.families[id];
      return clone(activeSectionProfile(id, savedFamily.profiles, savedFamily.activeProfile));
    }
    return {
      list: function () { return clone(current().family.profiles); },
      active: function () {
        var ctx = current();
        return clone(activeSectionProfile(id, ctx.family.profiles, ctx.family.activeProfile));
      },
      add: function (input) {
        var ctx = current(), profiles = ctx.family.profiles.slice();
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
        if (!input.templateMode) input.templateMode = (activeSectionProfile(id, profiles, ctx.family.activeProfile) || {}).templateMode;
        profiles.push(input);
        return persist(ctx, profiles, candidateId);
      },
      update: function (profile, changes) {
        var ctx = current(), wanted = profileId(profile, ''), found = false;
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
        var ctx = current(), wanted = profileId(profile, ''), profiles = ctx.family.profiles;
        if (profiles.length <= 1) return false;
        var index = profiles.findIndex(function (row) { return row.id === wanted; });
        if (index < 0) return false;
        var next = profiles.filter(function (row) { return row.id !== wanted; });
        var activeId = ctx.family.activeProfile === wanted ? next[Math.min(index, next.length - 1)].id : ctx.family.activeProfile;
        return persist(ctx, next, activeId) || false;
      },
      select: function (profile) {
        var ctx = current(), selected = activeSectionProfile(id, ctx.family.profiles, profile);
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
      Object.keys(soap).forEach(function (key) { request[key] = soap[key]; });
    }
    Object.keys(base).forEach(function (key) {
      if (key === 'profiles' || key === 'activeProfile' || key === 'sectionMode' || key === 'templateMode') {
        /* section profile selection is resolved below */
      } else if (key === 'instructions') {
        var account = cleanText(base.instructions, MAX_INSTRUCTIONS);
        var one = cleanText(request.instructions, MAX_INSTRUCTIONS);
        merged.instructions = cleanText([account, one].filter(Boolean).join(' | '), MAX_INSTRUCTIONS);
      } else if (request[key] != null) {
        merged[key] = enumValue(key, request[key], merged[key]);
      }
    });
    if (isProfileFamily(id)) {
      var suppliedProfiles = Array.isArray(request.profiles) ? request.profiles : base.profiles;
      var profiles = sanitizeSectionProfiles(id, suppliedProfiles);
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
    var soap = mergeFamily('soap', transient);
    var nested = transient && typeof transient === 'object' && !Array.isArray(transient)
      ? transient.families : null;
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
  var activeFamily = 'soap';
  var modalWasOpen = false;
  var sectionImportSession = null;
  var sectionImportEpoch = 0;
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
    if (panel && hide !== false) panel.style.display = 'none';
    if (preview) preview.style.display = 'none';
    ['mlsDtSectionImportExample', 'mlsDtSectionImportNamePreview', 'mlsDtSectionImportTemplatePreview', 'mlsDtSectionImportCommentsPreview'].forEach(function (id) {
      var el = q(id); if (el) el.value = '';
    });
    if (file) file.value = '';
    sectionImportStatus('', false);
  }
  function sectionImportMatches(panel) {
    return !!(panel && panel.getAttribute('data-family') === activeFamily && q('mlsDtSectionProfile') &&
      panel.getAttribute('data-profile') === q('mlsDtSectionProfile').value);
  }
  function openSectionImport() {
    if (SECTION_FAMILIES.indexOf(activeFamily) < 0 || !q('mlsDtSectionProfile')) return;
    resetSectionImport(false);
    var panel = q('mlsDtSectionImportPanel'), profile = q('mlsDtSectionProfile').value;
    sectionImportSession = exampleImporter(activeFamily, profile);
    panel.setAttribute('data-family', activeFamily);
    panel.setAttribute('data-profile', profile);
    panel.style.display = '';
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
    sectionImportStatus('AI is removing patient-specific details and building a reusable preview…', false);
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
    if (!sectionImportSession || !sectionImportMatches(panel)) { sectionImportStatus('This preview belongs to a different saved format. Open the importer again.', true); return; }
    var templateText = cleanTemplate(q('mlsDtSectionImportTemplatePreview').value, MAX_SECTION_TEMPLATE);
    if (!templateText) { sectionImportStatus('The reusable template preview is empty.', true); return; }
    var name = cleanReusableText(q('mlsDtSectionImportNamePreview').value, 80);
    if (name) q('mlsDtSectionName').value = name;
    q('mlsDtSectionTemplateText').value = templateText;
    q('mlsDtInstructions').value = cleanReusableText(q('mlsDtSectionImportCommentsPreview').value, MAX_INSTRUCTIONS);
    captureUi(activeFamily);
    resetSectionImport(true);
    paintCount();
    try { if (typeof window.toast === 'function') window.toast('Template preview applied to this saved format. Save Settings when you are finished.', 'ok'); } catch (e) {}
  }
  function mountSettings() {
    if (q('mlsDraftTuningSection')) return true;
    var modal = q('settingsModal');
    var box = modal && modal.querySelector('.modal');
    if (!box) return false;
    var sec = document.createElement('div');
    sec.className = 'set-section';
    sec.id = 'mlsDraftTuningSection';
    sec.innerHTML =
      '<p class="set-head">🤖 AI draft tuning</p>' +
      '<p class="set-desc">Set the writing defaults for every kind of AI draft. Every draft type supports multiple saved formats, conditional “use when” rules, reusable templates, AI prompt comments, and example import; MLS can choose the matching format from today\'s transcript, and you can still override it for one visit. These settings follow your account. Patient facts never belong here, and no setting can relax clinical, coding, legal, identity, or review safeguards.</p>' +
      '<div class="field"><label for="mlsDtFamily">Draft type</label><select class="sf-select" id="mlsDtFamily"></select></div>' +
      '<div class="set-grid2">' +
        '<div class="field"><label for="mlsDtLength">Detail</label><select class="sf-select" id="mlsDtLength">' + optionHtml([['concise','Concise'],['standard','Standard'],['detailed','Detailed']]) + '</select></div>' +
        '<div class="field"><label for="mlsDtTone">Tone</label><select class="sf-select" id="mlsDtTone">' + optionHtml([['clinical_neutral','Clinical neutral'],['patient_plain','Patient-friendly plain language'],['warm_patient','Warm patient-facing'],['payer_formal','Payer formal'],['legal_neutral','Legal neutral'],['operational_concise','Operational concise']]) + '</select></div>' +
        '<div class="field"><label for="mlsDtStructure">Structure</label><select class="sf-select" id="mlsDtStructure">' + optionHtml([['default','Best structure for this draft'],['fixed_headings','Fixed headings'],['problem_grouped','Group by problem'],['template_faithful','Follow the chosen template']]) + '</select></div>' +
        '<div class="field" id="mlsDtExtraHost"><label for="mlsDtExtra" id="mlsDtExtraLabel">Draft option</label><select class="sf-select" id="mlsDtExtra"></select></div>' +
        '<div class="field" id="mlsDtSectionProfileHost"><label for="mlsDtSectionProfile">Saved format</label><div class="row"><select class="sf-select" id="mlsDtSectionProfile"></select><button type="button" class="btn-ghost" id="mlsDtSectionAdd">+ Add format</button><button type="button" class="btn-ghost" id="mlsDtSectionDelete">Remove</button></div><p class="mini" id="mlsDtSectionProfileStatus" role="status">Up to 8 reusable formats per section.</p></div>' +
        '<div class="field" id="mlsDtSectionNameHost"><label for="mlsDtSectionName">Format name</label><input class="note-box" id="mlsDtSectionName" maxlength="80" placeholder="e.g. Routine follow-up"></div>' +
        '<div class="field" id="mlsDtSectionWhenHost"><label for="mlsDtSectionWhen">Use automatically when</label><input class="note-box" id="mlsDtSectionWhen" maxlength="180" placeholder="e.g. stable routine follow-up"><p class="mini">MLS checks only today\'s transcript. Leave this blank to use the format only as the account default or when you choose it for one visit.</p></div>' +
        '<div class="field" id="mlsDtSectionModeHost"><label for="mlsDtSectionMode" id="mlsDtSectionModeLabel">Section format</label><select class="sf-select" id="mlsDtSectionMode"></select></div>' +
        '<div class="field" id="mlsDtSectionTemplateHost"><label for="mlsDtSectionTemplate">Saved-template handling</label><select class="sf-select" id="mlsDtSectionTemplate">' + optionHtml([['strict','Follow saved template strictly'],['adapt','Adapt only supported fields'],['guide','Use saved template as a guide']]) + '</select></div>' +
      '</div>' +
      '<div class="field" id="mlsDtSectionTemplateTextHost"><label for="mlsDtSectionTemplateText">Template / outline for this saved format</label><textarea class="note-box" id="mlsDtSectionTemplateText" maxlength="2000" placeholder="Enter the headings, order, labels, or example structure MLS should follow. Do not put patient facts here."></textarea><p class="mini">The AI treats this as a format scaffold, never as evidence about the patient. 2,000 characters maximum.</p></div>' +
      '<div class="field" id="mlsDtSectionImportHost"><button type="button" class="btn-ghost" id="mlsDtSectionImportOpen">Import an example draft, document, or image</button><div id="mlsDtSectionImportPanel" style="display:none;margin-top:10px;padding:12px;border:1px solid var(--line);border-radius:10px">' +
        '<p class="mini" style="margin-top:0">Paste an example draft, or choose a document file or image (text, Word, PDF, PNG, JPEG, WebP, or GIF). MLS privately reads it, removes patient-specific content, and creates a reusable format preview. The example itself is never saved in these settings.</p>' +
        '<input type="file" id="mlsDtSectionImportFile" accept=".txt,.text,.md,.markdown,.rtf,.doc,.docx,.pdf,.png,.jpg,.jpeg,.webp,.gif,text/plain,text/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp,image/gif">' +
        '<textarea class="note-box" id="mlsDtSectionImportExample" maxlength="20000" placeholder="Or paste an example draft here…" style="margin-top:8px;min-height:120px"></textarea>' +
        '<div class="row" style="margin-top:8px"><button type="button" class="btn-green" id="mlsDtSectionImportDerive">Create AI template preview</button><button type="button" class="btn-ghost" id="mlsDtSectionImportCancel">Cancel</button></div>' +
        '<p class="mini" id="mlsDtSectionImportStatus" role="status"></p>' +
        '<div id="mlsDtSectionImportPreview" style="display:none;margin-top:10px">' +
          '<div class="field"><label for="mlsDtSectionImportNamePreview">Suggested format name</label><input class="note-box" id="mlsDtSectionImportNamePreview" maxlength="80"></div>' +
          '<div class="field"><label for="mlsDtSectionImportTemplatePreview">Reusable template preview</label><textarea class="note-box" id="mlsDtSectionImportTemplatePreview" maxlength="2000" style="min-height:130px"></textarea></div>' +
          '<div class="field"><label for="mlsDtSectionImportCommentsPreview">AI prompt comments preview</label><textarea class="note-box" id="mlsDtSectionImportCommentsPreview" maxlength="600" style="min-height:90px"></textarea></div>' +
          '<button type="button" class="btn-green" id="mlsDtSectionImportApply">Apply preview to this saved format</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="field"><label for="mlsDtInstructions" id="mlsDtInstructionsLabel">AI prompt comments for this saved format</label><textarea class="note-box" id="mlsDtInstructions" maxlength="600" placeholder="Non-patient writing preferences only…"></textarea><p class="mini" id="mlsDtCount">0 / 600</p></div>' +
      '<div class="field" id="mlsDtFamilyInstructionsHost"><label for="mlsDtFamilyInstructions">Standing instructions for this draft type</label><textarea class="note-box" id="mlsDtFamilyInstructions" maxlength="600" placeholder="Account-wide non-patient writing preferences only…"></textarea><p class="mini">Applied in addition to the selected saved format for this draft type.</p></div>' +
      '<div class="field" id="mlsDtResetField"><div class="row"><button type="button" class="btn-ghost" id="mlsDtReset" aria-describedby="mlsDtResetStatus">Reset this draft type</button><span class="mini" id="mlsDtResetStatus" role="status"></span></div></div>';
    var family = sec.querySelector('#mlsDtFamily');
    FAMILY_IDS.forEach(function (id) {
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
      activeFamily = familyId(family.value);
      loadUi(activeFamily);
    });
    ['mlsDtLength', 'mlsDtTone', 'mlsDtStructure', 'mlsDtExtra', 'mlsDtSectionName', 'mlsDtSectionMode', 'mlsDtSectionTemplate', 'mlsDtSectionTemplateText', 'mlsDtSectionWhen', 'mlsDtInstructions', 'mlsDtFamilyInstructions'].forEach(function (id) {
      var el = q(id); if (el) el.addEventListener('input', function () { captureUi(activeFamily); paintCount(); });
      if (el) el.addEventListener('change', function () { captureUi(activeFamily); paintCount(); });
    });
    q('mlsDtSectionProfile').addEventListener('change', function () {
      var selector = q('mlsDtSectionProfile'), profile = selector.value;
      resetSectionImport(true);
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
        templateMode: current.templateMode,
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
      working.families[activeFamily] = familyDefaults(activeFamily);
      loadUi(activeFamily);
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
    if (importHost) importHost.style.display = isSection ? '' : 'none';
    if (familyInstructionsHost) familyInstructionsHost.style.display = isSection && !isClinicalSection ? '' : 'none';
    var instructionLabel = q('mlsDtInstructionsLabel');
    if (instructionLabel) instructionLabel.textContent = isSection ? 'AI prompt comments for this saved format' : 'AI prompt comments for this saved format';
    if (!isSection) paintProfileButtons([]);
    if (!isSection || !profile || !mode || !template) return;
    profiles = sanitizeSectionProfiles(id, profiles);
    profile.innerHTML = profiles.map(function (row) { return '<option value="' + row.id + '">' + row.label + '</option>'; }).join('');
    profile.value = activeProfile || profiles[0].id;
    profile.setAttribute('data-active-profile', profile.value);
    var selected = profiles.filter(function (row) { return row.id === profile.value; })[0] || profiles[0];
    if (name) name.value = selected.label || '';
    if (when) when.value = selected.when || '';
    if (templateText) templateText.value = selected.templateText || '';
    modeLabel.textContent = SECTION_MODE_LABELS[id];
    mode.innerHTML = optionHtml(SECTION_MODES[id]);
    mode.value = value || SECTION_MODES[id][0][0];
    template.value = templateMode || SECTION_TEMPLATE_DEFAULT;
    paintProfileButtons(profiles);
  }
  function paintProfileButtons(profiles) {
    var add = q('mlsDtSectionAdd'), remove = q('mlsDtSectionDelete'), status = q('mlsDtSectionProfileStatus');
    profiles = Array.isArray(profiles) ? profiles : [];
    var section = isProfileFamily(activeFamily);
    if (add) { add.disabled = !section || profiles.length >= MAX_SECTION_PROFILES; add.setAttribute('aria-disabled', add.disabled ? 'true' : 'false'); }
    if (remove) { remove.disabled = !section || profiles.length <= 1; remove.setAttribute('aria-disabled', remove.disabled ? 'true' : 'false'); }
    if (status) status.textContent = !section ? '' : (profiles.length + ' of ' + MAX_SECTION_PROFILES + ' saved formats. ' +
      (profiles.length >= MAX_SECTION_PROFILES ? 'Remove one before adding another.' :
        (profiles.length <= 1 ? 'The final format cannot be removed.' : 'Names, rules, templates, and comments are saved independently.')));
  }
  function paintCount() {
    var el = q('mlsDtInstructions'), count = q('mlsDtCount');
    if (el && count) count.textContent = cleanText(el.value, MAX_INSTRUCTIONS).length + ' / ' + MAX_INSTRUCTIONS;
  }
  function paintResetState() {
    var button = q('mlsDtReset'), status = q('mlsDtResetStatus');
    if (!button) return;
    var current = working && working.families ? sanitizeFamily(activeFamily, working.families[activeFamily]) : familyDefaults(activeFamily);
    var changed = JSON.stringify(current) !== JSON.stringify(familyDefaults(activeFamily));
    button.disabled = !changed;
    button.setAttribute('aria-disabled', changed ? 'false' : 'true');
    button.title = changed ? 'Restore the defaults for this draft type' : 'This draft type is already at its defaults';
    if (status) status.textContent = changed ? 'Edits made — reset is available.' : 'Reset is unavailable because this draft type is already using its defaults.';
  }
  function loadUi(id) {
    if (!mountSettings()) return;
    if (!working) working = read();
    id = familyId(id); activeFamily = id;
    var p = working.families[id] || familyDefaults(id);
    q('mlsDtFamily').value = id;
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
    p.instructions = cleanText((q('mlsDtFamilyInstructions') && q('mlsDtFamilyInstructions').value) || p.instructions, MAX_INSTRUCTIONS);
    var ex = EXTRA[id], extra = q('mlsDtExtra');
    if (ex && extra) p[ex.key] = enumValue(ex.key, extra.value, p[ex.key]);
    if (isProfileFamily(id)) {
      var profiles = sanitizeSectionProfiles(id, p.profiles), selected = activeSectionProfile(id, profiles, q('mlsDtSectionProfile').value);
      selected.label = cleanReusableText(q('mlsDtSectionName').value, 80) || selected.label || ('Format ' + (profiles.indexOf(selected) + 1));
      selected.sectionMode = enumValue('sectionMode', q('mlsDtSectionMode').value, selected.sectionMode);
      selected.templateMode = enumValue('templateMode', q('mlsDtSectionTemplate').value, selected.templateMode);
      selected.when = cleanReusableText(q('mlsDtSectionWhen').value, 180);
      selected.templateText = cleanTemplate(q('mlsDtSectionTemplateText').value, MAX_SECTION_TEMPLATE);
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
  function beginSettings() { working = read(); activeFamily = 'soap'; mountSettings(); loadUi(activeFamily); }
  function saveFromUi() { if (!working) working = read(); captureUi(activeFamily); return write(working); }
  function discardUi() { resetSectionImport(true); working = null; activeFamily = 'soap'; }
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
  function boot() {
    mountSettings();
    watchModal();
    try { document.addEventListener('click', onClick, true); } catch (e) {}
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
    profiles: function (id) { var family = familyId(id); return isProfileFamily(family) ? clone(read().families[family].profiles || sectionProfiles(family)) : []; },
    profileState: function (id) { var family = familyId(id), state = read().families[family], profiles = isProfileFamily(family) ? (state.profiles || sectionProfiles(family)) : []; return { activeProfile: state.activeProfile || '', activeLabel: (profiles.filter(function (row) { return row.id === state.activeProfile; })[0] || profiles[0] || {}).label || '', profiles: clone(profiles) }; },
    profileEditor: profileEditor,
    exampleImporter: exampleImporter,
    autoRoute: automaticRoutes,
    forFamily: mergeFamily,
    forStructured: structuredFamily,
    infer: infer,
    promptBlock: promptBlock,
    selectProfile: function (id, selectionSource) { var family = familyId(id), state = read().families[family], routed = isProfileFamily(family) ? routedSectionProfile(family, state.profiles, state.activeProfile, selectionSource) : null; return routed ? { profileId: routed.profile.id, selection: routed.selection } : null; },
    mountSettings: mountSettings,
    beginSettings: beginSettings,
    saveFromUi: saveFromUi,
    _extra: clone(EXTRA),
    _enums: clone(ENUMS)
  };
  window.__mlsDraftTuning = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
