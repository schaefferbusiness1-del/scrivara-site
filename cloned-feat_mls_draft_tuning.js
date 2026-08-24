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

  var VERSION = '1.2.0';
  var STORE_KEY = 'draftTuningV1';
  var MAX_INSTRUCTIONS = 600;
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
  function familyId(value) { return has(FAMILY_IDS, value) ? String(value) : 'soap'; }
  function storageKey() {
    try {
      if (typeof window.uns === 'function') return window.uns(STORE_KEY);
      if (typeof uns === 'function') return uns(STORE_KEY);
    } catch (e) {}
    return STORE_KEY;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function sectionProfiles(id) { return clone(SECTION_PROFILE_DEFAULTS[id] || []); }
  function profileId(value, fallback) {
    var clean = cleanText(value, 48).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
    return clean || fallback;
  }
  function sanitizeSectionProfiles(id, input) {
    var defaults = sectionProfiles(id), rows = Array.isArray(input) ? input.slice(0, 8) : [];
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
        label: cleanText(row.label || row.name || fallback.label || ('Format ' + (index + 1)), 80) || ('Format ' + (index + 1)),
        when: cleanText(row.when || fallback.when, 180),
        sectionMode: has(modeValues, row.sectionMode) ? String(row.sectionMode) : (fallback.sectionMode || modes[0][0]),
        templateMode: enumValue('templateMode', row.templateMode, fallback.templateMode || SECTION_TEMPLATE_DEFAULT),
        instructions: cleanText(row.instructions, MAX_INSTRUCTIONS)
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
    SECTION_FAMILIES.forEach(function (id) {
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
    if (SECTION_FAMILIES.indexOf(id) >= 0) {
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
    if (SECTION_FAMILIES.indexOf(id) >= 0) {
      var suppliedProfiles = Array.isArray(request.profiles) ? request.profiles : base.profiles;
      var profiles = sanitizeSectionProfiles(id, suppliedProfiles);
      var selected = activeSectionProfile(id, profiles, request.profileId || request.activeProfile || base.activeProfile);
      if (request.profile && typeof request.profile === 'object' && !Array.isArray(request.profile)) {
        var override = sanitizeSectionProfiles(id, [Object.assign({}, selected, request.profile)])[0];
        profiles = profiles.map(function (row) { return row.id === selected.id ? override : row; });
        selected = override;
      }
      merged.profiles = profiles;
      merged.activeProfile = selected.id;
      merged.profileId = selected.id;
      merged.profileName = selected.label;
      merged.profileWhen = selected.when;
      merged.sectionMode = selected.sectionMode;
      merged.templateMode = selected.templateMode;
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
    if (SECTION_FAMILIES.indexOf(p.family) >= 0) {
      if (p.profileName) lines.push('- Reusable ' + p.family.toUpperCase() + ' format: ' + p.profileName + ' (profile ' + p.profileId + ').');
      if (p.profileWhen) lines.push('- Use this ' + p.family.toUpperCase() + ' format when: ' + p.profileWhen + '.');
      if (p.sectionMode) lines.push('- ' + SECTION_MODE_LABELS[p.family] + ': ' + p.sectionMode + '; preserve the exact Athena section heading and use only supported facts.');
      if (p.templateMode) lines.push('- ' + p.family.toUpperCase() + ' saved-template handling: ' + p.templateMode + '; adapt only documented content and never invent missing fields.');
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
        if (section.profileWhen) lines.push('- Use this ' + key.toUpperCase() + ' format when: ' + section.profileWhen + '.');
        if (section.sectionMode) lines.push('- ' + SECTION_MODE_LABELS[key] + ': ' + section.sectionMode + '; preserve the exact Athena section heading and use only supported facts.');
        if (section.templateMode) lines.push('- ' + key.toUpperCase() + ' saved-template handling: ' + section.templateMode + '; adapt only documented content and never invent missing fields.');
        if (section.instructions) lines.push('- ' + key.toUpperCase() + ' standing instructions (subordinate): ' + section.instructions);
      });
      if (coding.confidenceDisplay) lines.push('- Coding confidence display: ' + coding.confidenceDisplay + '; uncertainty must remain visible.');
      if (coding.payerPresentation) lines.push('- Coding presentation: ' + coding.payerPresentation + '; never alter code validity.');
    }
    if (p.instructions) lines.push('- Additional provider preference (subordinate, non-patient setting): ' + p.instructions);
    return lines.join('\n');
  }

  var working = null;
  var activeFamily = 'soap';
  var modalWasOpen = false;
  function q(id) { return document.getElementById(id); }
  function optionHtml(rows) {
    return rows.map(function (row) { return '<option value="' + row[0] + '">' + row[1] + '</option>'; }).join('');
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
      '<p class="set-desc">Set the writing defaults for every kind of AI draft. Save different HPI, ROS, Exam, Assessment, and Plan formats and MLS will choose the matching format from today\'s transcript; you can still override it for one visit. These settings follow your account. Patient facts never belong here, and no setting can relax clinical, coding, legal, identity, or review safeguards.</p>' +
      '<div class="field"><label for="mlsDtFamily">Draft type</label><select class="sf-select" id="mlsDtFamily"></select></div>' +
      '<div class="set-grid2">' +
        '<div class="field"><label for="mlsDtLength">Detail</label><select class="sf-select" id="mlsDtLength">' + optionHtml([['concise','Concise'],['standard','Standard'],['detailed','Detailed']]) + '</select></div>' +
        '<div class="field"><label for="mlsDtTone">Tone</label><select class="sf-select" id="mlsDtTone">' + optionHtml([['clinical_neutral','Clinical neutral'],['patient_plain','Patient-friendly plain language'],['warm_patient','Warm patient-facing'],['payer_formal','Payer formal'],['legal_neutral','Legal neutral'],['operational_concise','Operational concise']]) + '</select></div>' +
        '<div class="field"><label for="mlsDtStructure">Structure</label><select class="sf-select" id="mlsDtStructure">' + optionHtml([['default','Best structure for this draft'],['fixed_headings','Fixed headings'],['problem_grouped','Group by problem'],['template_faithful','Follow the chosen template']]) + '</select></div>' +
        '<div class="field" id="mlsDtExtraHost"><label for="mlsDtExtra" id="mlsDtExtraLabel">Draft option</label><select class="sf-select" id="mlsDtExtra"></select></div>' +
        '<div class="field" id="mlsDtSectionProfileHost"><label for="mlsDtSectionProfile">Saved format</label><select class="sf-select" id="mlsDtSectionProfile"></select></div>' +
        '<div class="field" id="mlsDtSectionWhenHost"><label for="mlsDtSectionWhen">Use automatically when</label><input class="note-box" id="mlsDtSectionWhen" maxlength="180" placeholder="e.g. stable routine follow-up"><p class="mini">MLS checks only today\'s transcript. Leave this blank to use the format only as the account default or when you choose it for one visit.</p></div>' +
        '<div class="field" id="mlsDtSectionModeHost"><label for="mlsDtSectionMode" id="mlsDtSectionModeLabel">Section format</label><select class="sf-select" id="mlsDtSectionMode"></select></div>' +
        '<div class="field" id="mlsDtSectionTemplateHost"><label for="mlsDtSectionTemplate">Saved-template handling</label><select class="sf-select" id="mlsDtSectionTemplate">' + optionHtml([['strict','Follow saved template strictly'],['adapt','Adapt only supported fields'],['guide','Use saved template as a guide']]) + '</select></div>' +
      '</div>' +
      '<div class="field"><label for="mlsDtInstructions" id="mlsDtInstructionsLabel">Standing instructions for this draft type</label><textarea class="note-box" id="mlsDtInstructions" maxlength="600" placeholder="Non-patient writing preferences only…"></textarea><p class="mini" id="mlsDtCount">0 / 600</p></div>' +
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
      captureUi(activeFamily);
      activeFamily = familyId(family.value);
      loadUi(activeFamily);
    });
    ['mlsDtLength', 'mlsDtTone', 'mlsDtStructure', 'mlsDtExtra', 'mlsDtSectionMode', 'mlsDtSectionTemplate', 'mlsDtSectionWhen', 'mlsDtInstructions'].forEach(function (id) {
      var el = q(id); if (el) el.addEventListener('input', function () { captureUi(activeFamily); paintCount(); });
      if (el) el.addEventListener('change', function () { captureUi(activeFamily); paintCount(); });
    });
    q('mlsDtSectionProfile').addEventListener('change', function () {
      var selector = q('mlsDtSectionProfile'), profile = selector.value;
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
      if (SECTION_FAMILIES.indexOf(activeFamily) >= 0 && working.families[activeFamily]) working.families[activeFamily].activeProfile = profile;
      loadUi(activeFamily);
    });
    q('mlsDtReset').addEventListener('click', function () {
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
    var modeHost = q('mlsDtSectionModeHost'), modeLabel = q('mlsDtSectionModeLabel'), mode = q('mlsDtSectionMode');
    var templateHost = q('mlsDtSectionTemplateHost'), template = q('mlsDtSectionTemplate');
    var isSection = SECTION_FAMILIES.indexOf(id) >= 0;
    if (profileHost) profileHost.style.display = isSection ? '' : 'none';
    if (whenHost) whenHost.style.display = isSection ? '' : 'none';
    if (modeHost) modeHost.style.display = isSection ? '' : 'none';
    if (templateHost) templateHost.style.display = isSection ? '' : 'none';
    if (!isSection || !profile || !mode || !template) return;
    profiles = sanitizeSectionProfiles(id, profiles);
    profile.innerHTML = profiles.map(function (row) { return '<option value="' + row.id + '">' + row.label + '</option>'; }).join('');
    profile.value = activeProfile || profiles[0].id;
    profile.setAttribute('data-active-profile', profile.value);
    if (when) when.value = (profiles.filter(function (row) { return row.id === profile.value; })[0] || profiles[0]).when || '';
    modeLabel.textContent = SECTION_MODE_LABELS[id];
    mode.innerHTML = optionHtml(SECTION_MODES[id]);
    mode.value = value || SECTION_MODES[id][0][0];
    template.value = templateMode || SECTION_TEMPLATE_DEFAULT;
    var instructionLabel = q('mlsDtInstructionsLabel'); if (instructionLabel) instructionLabel.textContent = 'Instructions for this saved format';
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
    var ex = EXTRA[id]; fillExtra(id, ex ? p[ex.key] : '');
    var active = activeSectionProfile(id, p.profiles, p.activeProfile);
    if (SECTION_FAMILIES.indexOf(id) >= 0 && active) {
      p.sectionMode = active.sectionMode; p.templateMode = active.templateMode;
      q('mlsDtSectionWhen').value = active.when || '';
      q('mlsDtInstructions').value = active.instructions || p.instructions || '';
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
    p.instructions = cleanText(q('mlsDtInstructions').value, MAX_INSTRUCTIONS);
    var ex = EXTRA[id], extra = q('mlsDtExtra');
    if (ex && extra) p[ex.key] = enumValue(ex.key, extra.value, p[ex.key]);
    if (SECTION_FAMILIES.indexOf(id) >= 0) {
      var profiles = sanitizeSectionProfiles(id, p.profiles), selected = activeSectionProfile(id, profiles, q('mlsDtSectionProfile').value);
      selected.sectionMode = enumValue('sectionMode', q('mlsDtSectionMode').value, selected.sectionMode);
      selected.templateMode = enumValue('templateMode', q('mlsDtSectionTemplate').value, selected.templateMode);
      selected.when = cleanText(q('mlsDtSectionWhen').value, 180);
      selected.instructions = cleanText(q('mlsDtInstructions').value, MAX_INSTRUCTIONS);
      p.profiles = profiles.map(function (row) { return row.id === selected.id ? selected : row; });
      // Section-specific instructions live on the selected saved profile. Keep
      // the legacy family-level field empty so transport cannot duplicate them.
      p.instructions = '';
      p.activeProfile = selected.id;
      p.sectionMode = selected.sectionMode;
      p.templateMode = selected.templateMode;
    }
    working.families[id] = sanitizeFamily(id, p);
    paintResetState();
  }
  function beginSettings() { working = read(); activeFamily = 'soap'; mountSettings(); loadUi(activeFamily); }
  function saveFromUi() { if (!working) working = read(); captureUi(activeFamily); return write(working); }
  function discardUi() { working = null; activeFamily = 'soap'; }
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
    profiles: function (id) { var family = familyId(id); return SECTION_FAMILIES.indexOf(family) >= 0 ? clone(read().families[family].profiles || sectionProfiles(family)) : []; },
    profileState: function (id) { var family = familyId(id), state = read().families[family], profiles = SECTION_FAMILIES.indexOf(family) >= 0 ? (state.profiles || sectionProfiles(family)) : []; return { activeProfile: state.activeProfile || '', activeLabel: (profiles.filter(function (row) { return row.id === state.activeProfile; })[0] || profiles[0] || {}).label || '', profiles: clone(profiles) }; },
    autoRoute: automaticRoutes,
    forFamily: mergeFamily,
    forStructured: structuredFamily,
    infer: infer,
    promptBlock: promptBlock,
    selectProfile: function (id, selectionSource) { var family = familyId(id), state = read().families[family], routed = SECTION_FAMILIES.indexOf(family) >= 0 ? routedSectionProfile(family, state.profiles, state.activeProfile, selectionSource) : null; return routed ? { profileId: routed.profile.id, selection: routed.selection } : null; },
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
