'use strict';
/*
 * OP NOTES THAT FOLLOW THE TEMPLATE, KNOW THEIR OWN DATE, AND PICK THE RIGHT FORM
 * -----------------------------------------------------------------------------
 * Owner, 2026-08-31, three complaints in one breath:
 *   "in the opn otes date of procidure needs to be known as it knows it"
 *   "the op notes just suck they dont add things and dont follow tempaltes right"
 *   "it does do a good job picking a tempate just does not follow it right.
 *    Its like summarizing the op notes not making a medically made op note"
 *   "wait a second its not choosing the correct temmplates"
 *
 * EVERY SUBJECT HERE IS THE SHIPPED FUNCTION, NOT A COPY OF IT.
 * feat_mls_opnote_integrity.js is loaded in a vm with a minimal window/document
 * and the assertions run against window.__mlsOpNoteIntegrity - the same object
 * install() builds in the browser. The shell halves are lifted out of
 * 1p/index.html by name. That distinction is not decoration: this lane has twice
 * shipped a fix into ScribeFlow.html's _genOpNote, which the integrity module
 * REPLACES at load, and watched a green suite while the live app was unchanged.
 *
 * NOT registered in run-all.js by instruction; run it directly.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const INTEGRITY = 'feat_mls_opnote_integrity.js';
const integritySrc = fs.readFileSync(path.join(root, INTEGRITY), 'utf8');
const shell1p = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const shellTwin = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')'); checks++; }

/* ---------------------------------------------------------------------------
 * Load the SHIPPED module. The stub is deliberately dumb: every DOM call the
 * module makes at install time is a no-op, so nothing here can accidentally
 * satisfy a check by simulating behaviour the browser would supply.
 * ------------------------------------------------------------------------ */
function stubEl() {
  const el = {
    style: {}, dataset: {}, id: '', value: '', innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
    removeAttribute() {}, appendChild() {}, insertBefore() {}, removeChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, focus() {}, closest() { return null; },
    parentElement: null, parentNode: null, childNodes: [], children: []
  };
  return el;
}

function loadIntegrity(fixture) {
  fixture = fixture || {};
  const templates = fixture.templates || [];
  const patients = fixture.patients || [];
  const store = Object.create(null);
  const doc = {
    readyState: 'complete',
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return stubEl(); },
    body: stubEl(), head: stubEl(), documentElement: stubEl()
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Promise, Math, Date, JSON, AbortController: global.AbortController,
    document: doc,
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    uns: (k) => k,
    toast() {},
    getTemplates: () => JSON.parse(JSON.stringify(templates)),
    getTemplateById: (id) => templates.filter((t) => t.id === id).map((t) => JSON.parse(JSON.stringify(t)))[0] || null,
    getPatients: () => patients
  };
  vm.createContext(sandbox);
  vm.runInContext('this.window=this; this.self=this;', sandbox);
  new vm.Script(integritySrc, { filename: INTEGRITY }).runInContext(sandbox);
  const api = sandbox.__mlsOpNoteIntegrity;
  assert(api && api.installed === true, 'feat_mls_opnote_integrity.js did not install in the harness — every assertion below would be vacuous');
  return { api, sandbox, store };
}

/* Lift a shell function out of the /1p twin by name and evaluate it, so the
   subject is the shipped source rather than a paraphrase of it. */
function liftShell(html, name, label) {
  const at = html.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' is not in ' + label + ' — it was renamed or removed');
  let depth = 0, started = false, end = at;
  for (let i = at; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return html.slice(at, end);
}

const { api } = loadIntegrity();

/* ===========================================================================
 * 1. DATE OF PROCEDURE — THE APP KNOWS IT, SO THE DRAFT MAY NEVER ASK FOR IT
 * ========================================================================= */

ok(typeof api.fillDateSlots === 'function', 'fillDateSlots is not exported by the installed module — the deterministic date fill is not reachable');

const KNOWN_DAY = 'Thursday, August 6, 2026';
const dateNote = [
  'OPERATIVE REPORT',
  'Patient: Jane Doe',
  'Date of procedure: [[date_of_procedure]]',
  'DOS: [DATE]',
  'Date of service: {{date_of_service}}',
  'Date of birth: [[dob]]',
  'DATE OF BIRTH: [DATE OF BIRTH]',
  'Needle: [[needle_size]]',
  'Steroid: [STEROID DOSE]'
].join('\n');

const dateFilled = api.fillDateSlots(dateNote, KNOWN_DAY);
ok(dateFilled.indexOf('Date of procedure: ' + KNOWN_DAY) >= 0, 'a [[date_of_procedure]] slot was left for the doctor to type — this is the exact complaint');
ok(dateFilled.indexOf('DOS: ' + KNOWN_DAY) >= 0, 'a bracketed [DATE] slot was not filled from the known day');
ok(dateFilled.indexOf('Date of service: ' + KNOWN_DAY) >= 0, 'a {{date_of_service}} slot was not filled from the known day');
ok(dateFilled.indexOf('[[dob]]') >= 0, 'PATIENT SAFETY: a date-of-BIRTH slot was overwritten with the procedure date');
ok(dateFilled.indexOf('[DATE OF BIRTH]') >= 0, 'PATIENT SAFETY: a bracketed DATE OF BIRTH slot was overwritten with the procedure date');
ok(dateFilled.indexOf('[[needle_size]]') >= 0, 'a non-date slot was consumed by the date filler');
ok(dateFilled.indexOf('[STEROID DOSE]') >= 0, 'PATIENT SAFETY: a drug slot was consumed by the date filler');

/* Unknown stays an explicit placeholder — the whole difference between a value
   we were GIVEN and a value we would be inventing. */
eq(api.fillDateSlots(dateNote, ''), dateNote, 'an EMPTY date wrote something into the note');
eq(api.fillDateSlots(dateNote, '   '), dateNote, 'a whitespace-only date wrote something into the note');
eq(api.fillDateSlots(dateNote, null), dateNote, 'a null date wrote something into the note');

/* The three shapes this app actually supplies all parse to the same day. */
['2026-08-06', '8/6/2026', 'Thursday, August 6, 2026', 'August 6, 2026', 'Aug 6, 2026'].forEach((form) => {
  const p = api.parseDayParts(form);
  ok(p && p.y === 2026 && p.mo === 8 && p.d === 6, 'parseDayParts could not read "' + form + '" — the guard falls back to a verbatim compare for it');
});
ok(api.parseDayParts('') === null, 'parseDayParts invented a day out of an empty string');
ok(api.parseDayParts('sometime next week') === null, 'parseDayParts invented a day out of prose');

/* ---- the shell's own presence test, hardened ---------------------------- */
const hasDateSrc = liftShell(shell1p, '_opNoteHasDate', '1p/index.html');
// eslint-disable-next-line no-new-func
const _opNoteHasDate = new Function(hasDateSrc + '; return _opNoteHasDate;')();

ok(_opNoteHasDate('Date of Procedure: August 6, 2026', KNOWN_DAY),
  'THE MEASURED REGRESSION: a note that states the right day WITHOUT the weekday was judged date-less, so _opGuardProcedureDate prepended a SECOND date line above it');
ok(_opNoteHasDate('Date: 08/06/2026', KNOWN_DAY), 'the US numeric rendering of the same day was not recognised');
ok(_opNoteHasDate('Date: 2026-08-06', KNOWN_DAY), 'the ISO rendering of the same day was not recognised');
ok(_opNoteHasDate('Performed 6 Aug 2026.', KNOWN_DAY), 'the day-first rendering of the same day was not recognised');
ok(_opNoteHasDate('OPERATIVE REPORT\nno date here', KNOWN_DAY) === false, 'a genuinely date-less note was reported as carrying its date — the repair guard would never run');
ok(_opNoteHasDate('Date of Procedure: August 7, 2026', KNOWN_DAY) === false, 'a DIFFERENT day satisfied the check — the guard must still repair that note');
ok(_opNoteHasDate('anything', '') === true, 'an absent supplied date is nothing to enforce and must not trigger a repair');

/* noteStatesDay must be a STRICT SUPERSET of the shell check: it is used as the
   precondition on the repair guard, so anything it rejects that the shell would
   have accepted would be a duplicate date line, and anything the shell rejects
   that it accepts must still be a correct statement of the same day. */
const superset = [
  ['Date of Procedure: August 6, 2026', KNOWN_DAY],
  ['Date: 08/06/2026', KNOWN_DAY],
  ['Date: 2026-08-06', '2026-08-06'],
  ['Date: 8/6/2026', '2026-08-06'],
  ['Aug. 6, 2026', '2026-08-06'],
  ['nothing at all', KNOWN_DAY],
  ['Date of Procedure: August 7, 2026', KNOWN_DAY],
  ['whatever', '']
];
superset.forEach(([note, d]) => {
  if (_opNoteHasDate(note, d)) {
    ok(api.noteStatesDay(note, d) === true,
      'noteStatesDay REJECTED a note the shell accepts (' + JSON.stringify(note) + ' / ' + JSON.stringify(d) + ') — that narrows a validator');
  }
});
ok(api.noteStatesDay('Date of Procedure: August 7, 2026', KNOWN_DAY) === false, 'noteStatesDay accepted a DIFFERENT day');
ok(api.noteStatesDay('OPERATIVE REPORT only', KNOWN_DAY) === false, 'noteStatesDay accepted a note with no date, which would disarm the repair guard');

/* The generator must actually CALL the filler and must gate the shell guard on
   the wider check — the shadow this lane keeps falling into. */
ok(/result\.note\s*=\s*fillDateSlots\(result\.note\s*,\s*dateStr\)/.test(integritySrc),
  'the installed generator does not run fillDateSlots on its result — the fix would be a function nothing calls');
ok(/!noteStatesDay\(result&&result\.note,dateStr\)/.test(integritySrc),
  'the shell repair guard is no longer gated on noteStatesDay — a correctly dated draft can get a second date line');
ok(integritySrc.indexOf('window._opGuardProcedureDate(') >= 0,
  'the installed generator no longer calls the shell repair guard at all — an undated draft would go out undated');
[/fillDateSlots\(fillChartSlots\(fillProcedureSlots\(forceFacts\(first\.note/,
 /fillDateSlots\(fillChartSlots\(fillProcedureSlots\(forceFacts\(repaired\.note/,
 /fillDateSlots\(fillChartSlots\(fillProcedureSlots\(reanchor\(repaired\.note/].forEach((rx, i) => {
  ok(rx.test(integritySrc), 'fill chain ' + (i + 1) + ' of 3 does not end in fillDateSlots — that path can still ship a date blank');
});
ok(/\['date','dos','procedure date'/.test(integritySrc),
  'the widened date heading aliases are gone — a template spelling its date line "DATE:" is unstamped again');

/* ===========================================================================
 * 2. TEMPLATE CONFORMANCE — A DETERMINISTIC, HONEST COUNT
 * ========================================================================= */

ok(typeof api.templateConformance === 'function', 'templateConformance is not exported by the installed module');

const TEMPLATE = [
  'OPERATIVE REPORT',
  'Patient: [[patient]]',
  'Date of procedure: [[date_of_procedure]]',
  'Pre-operative diagnosis: [[preoperative_diagnosis]]',
  'Procedure performed: [[procedure]]',
  'Anesthesia: Local anesthesia with moderate sedation as documented.',
  'Indications: The patient has failed conservative management including physical therapy and oral medication.',
  'Technique: After informed consent was obtained the patient was brought to the procedure suite and placed prone on the fluoroscopy table.',
  'The skin was prepped and draped in the usual sterile fashion and a surgical time-out was performed.',
  'Under intermittent fluoroscopic guidance the target was identified and the needle was advanced to the appropriate position.',
  'Estimated blood loss: Minimal.',
  'Complications: None. The patient tolerated the procedure well.',
  'Disposition: The patient was transferred to the recovery area in stable condition and discharged home with routine post-procedure instructions.'
].join('\n');

const FILLED = TEMPLATE
  .replace('[[patient]]', 'Jane Doe')
  .replace('[[date_of_procedure]]', KNOWN_DAY)
  .replace('[[preoperative_diagnosis]]', 'Lumbar spondylosis without myelopathy')
  .replace('[[procedure]]', 'Left L4-L5 medial branch block');

const good = api.templateConformance(FILLED, TEMPLATE);
ok(good.total >= 6, 'the conformance measure graded fewer than 6 template lines — it is not seeing the template');
eq(good.pct, 100, 'a draft that reproduces the template verbatim and fills only its slots was not scored as fully conformant');
eq(good.notFollowed, 0, 'a verbatim reproduction was reported as not following the template');
eq(good.belowThreshold, false, 'a verbatim reproduction was flagged as not following the template');

/* The summarised draft — the owner's actual complaint. It keeps the headings
   and says true things; it is simply not the doctor's note. */
const SUMMARY = [
  'OPERATIVE REPORT',
  'Patient: Jane Doe',
  'Date of procedure: ' + KNOWN_DAY,
  'Pre-operative diagnosis: Lumbar spondylosis without myelopathy',
  'Procedure performed: Left L4-L5 medial branch block',
  'Anesthesia: Local.',
  'Technique: The patient was positioned and the block was performed under fluoroscopy.',
  'Complications: None.',
  'Disposition: Discharged home.'
].join('\n');

const bad = api.templateConformance(SUMMARY, TEMPLATE);
eq(bad.total, good.total, 'the two drafts were graded against different template line counts — the measure is not stable');
ok(bad.notFollowed > 0, 'a SUMMARISED draft was scored as fully following the template — this is the defect the measure exists to name');
ok(bad.belowThreshold === true, 'a summarised draft was not flagged, so the room would accept it in silence');
ok(bad.pct < 75, 'a summarised draft scored 75% or better — the threshold cannot separate a copy from a summary');
ok(bad.verbatim + bad.reworded + bad.missing === bad.total, 'the counts do not add up to the graded total — the number shown to the doctor would be wrong');
ok(bad.lines.length > 0 && typeof bad.lines[0].text === 'string', 'the flagged draft names no specific template line, so "N missing" cannot be checked by anyone');
ok(bad.lines.every((l) => l.how === 'missing' || l.how === 'reworded'), 'a flagged line carries neither verdict');

/* PURE. It measures; it never rewrites. */
const beforeNote = SUMMARY;
const r1 = api.templateConformance(SUMMARY, TEMPLATE);
const r2 = api.templateConformance(SUMMARY, TEMPLATE);
eq(SUMMARY, beforeNote, 'the conformance checker mutated the draft it was handed');
eq(JSON.stringify(r1), JSON.stringify(r2), 'the conformance checker is not deterministic — the same draft scored differently twice');
ok(!Object.prototype.hasOwnProperty.call(r1, 'note'), 'the conformance result carries a note field, which invites a caller to write it back over the draft');

/* It is a MEASURE, not a gate: it must never be able to stop a draft. */
ok(!/throw[^\n]*conformance/i.test(integritySrc), 'something throws on a conformance result — this must never block a draft');
ok(/first\.templateConformance=conformanceOf\(/.test(integritySrc), 'the accepted draft does not carry its conformance measure');
ok(/repaired\.templateConformance=conformanceOf\(/.test(integritySrc), 'the repaired draft does not carry its conformance measure');
ok(/if\(c\.mode==='guide'\)c\.belowThreshold=false;/.test(integritySrc),
  "the 'guide' mode is no longer exempt — the doctor asked that mode to be tighter than his template and would be warned for getting what he asked for");

/* The prompt half. A measure that reports a failure nothing tries to prevent is
   only half the fix, and the contract must be in the prompt the INSTALLED
   generator sends — not in the shadowed ScribeFlow copy. */
ok(/REPRODUCE, THEN FILL/.test(integritySrc), 'the reproduce-verbatim contract is missing from the prompt the installed generator sends');
ok(/Do NOT summarize, condense, paraphrase/.test(integritySrc), 'the explicit do-not-summarize rule is missing from the installed prompt');
ok(/never invent a clinical fact, and never delete the sentence that contained it/.test(integritySrc),
  'the unknown-stays-a-placeholder half of the contract is missing — a model told to reproduce every line will otherwise fabricate one');
ok(/REQUESTED PROCEDURE FACTS/.test(integritySrc),
  'the parsed side/level/region/approach are no longer stated to the model, so it must re-derive the facts the draft is then graded against');

/* ===========================================================================
 * 3. TEMPLATE SELECTION — THE EXACT NAME IS NOT A SCORE
 * ========================================================================= */

const LIB = [
  { id: 'tpi', name: 'Trigger Point Injection', keywords: [], text: 'OPERATIVE REPORT\nProcedure: trigger point injection\nTechnique: the trigger point was injected.' },
  { id: 'tpi_us', name: 'Trigger Point Injection Ultrasound Guided', keywords: [], text: 'OPERATIVE REPORT\nProcedure: trigger point injection under ultrasound\nTechnique: the trigger point was injected under ultrasound guidance.' },
  { id: 'si_left', name: 'Left Sacroiliac Joint Injection', keywords: [], text: 'OPERATIVE REPORT\nProcedure: left sacroiliac joint injection\nTechnique: the left sacroiliac joint was injected.' },
  { id: 'si_right', name: 'Right Sacroiliac Joint Injection', keywords: [], text: 'OPERATIVE REPORT\nProcedure: right sacroiliac joint injection\nTechnique: the right sacroiliac joint was injected.' }
];
const libApi = loadIntegrity({ templates: LIB }).api;

ok(typeof libApi.exactNameMatch === 'function', 'exactNameMatch is not exported — the deterministic mapping is not reachable');

/* A reason that IS a template's name resolves to THAT template, even though a
   longer name contains every one of its words. Containment answers "two"; the
   token-set equality answers "this one". */
const exact = libApi.exactNameMatch('Trigger Point Injection', LIB);
ok(exact && exact.id === 'tpi', 'the exactly-named template lost to a longer name that merely contains its words');
/* The comparison runs on the module's own tokenizer, which drops the words that
   carry no identity in this domain ('injection', 'procedure', 'note',
   'operative', 'the', 'with', 'under', 'using'). So the doctor's shorthand
   "Trigger Point" IS the name of "Trigger Point Injection" — pinned, because
   that equivalence is the point rather than an accident of it. */
const shorthand = libApi.exactNameMatch('Trigger Point', LIB);
ok(shorthand && shorthand.id === 'tpi', "the doctor's own shorthand for a template name no longer resolves to it");
/* A SUPERSET of the name is not the name: adding a word the template does not
   carry must fall back to the scored path, never resolve as a certainty. */
ok(libApi.exactNameMatch('Trigger Point Injection Ultrasound', LIB) === null,
  'a name with an EXTRA word was treated as an exact name — that is a guess wearing a certainty');
ok(libApi.exactNameMatch('Sacroiliac Joint Injection', LIB) === null,
  'an ambiguous name matching TWO templates (left and right) was resolved anyway — the side would be invented');
ok(libApi.exactNameMatch('', LIB) === null, 'empty procedure text resolved to a template');
ok(libApi.exactNameMatch('Kyphoplasty', LIB) === null, 'a name that matches no template at all was resolved anyway');

const pick = libApi.best('Trigger Point Injection');
ok(pick && pick.tpl && pick.tpl.id === 'tpi', 'best() did not choose the template the procedure text literally names');
eq(pick.confident, true, 'an exactly-named template was not treated as a confident match');
eq(pick.exactName, true, 'the exact-name reason is not recorded, so the room cannot tell the doctor why it chose this one');

const pickFor = libApi.bestFor('Jane Doe', 'Trigger Point Injection', '', '');
eq(pickFor.tplId, 'tpi', 'bestFor did not carry the exact-name decision through');
eq(pickFor.source, 'exact-name', 'the exact-name source is not reported to the row badge');

/* AMBIGUOUS MUST SURFACE, NOT GUESS IN SILENCE. Two same-class templates that
   differ only by side, against a reason that states no side. */
const ambiguous = libApi.bestFor('Jane Doe', 'Sacroiliac Joint Injection', '', '');
ok(ambiguous.source !== 'reason' && ambiguous.source !== 'exact-name',
  'an undecidable side was reported as a confident match — this is the wrong-template complaint');
ok(Array.isArray(ambiguous.alternatives), 'the ambiguous result carries no alternatives array');
ok(ambiguous.alternatives.length >= 1,
  'the matcher had ranked candidates and threw them away — the doctor is told to "check this" with nothing to check it against');
ok(ambiguous.alternatives.every((a) => a.id && a.name), 'an offered alternative has no id or no name, so the one-click switch cannot render it');
ok(ambiguous.alternatives.every((a) => a.id !== ambiguous.tplId), 'the alternatives list offers the template that was already applied');
ok(ambiguous.alternatives.some((a) => a.id === 'si_left' || a.id === 'si_right'),
  'neither of the two genuinely competing templates is offered as an alternative');

/* A confident pick must NOT be turned into a question. */
ok(Array.isArray(pickFor.alternatives) && pickFor.alternatives.length === 0,
  'a confident, exactly-named match offers alternatives — every row becomes a question and the warning stops being read');

/* The alternatives have to reach the row, or they are another measure with no
   surface. */
ok(/built\.tplAlternatives\s*=/.test(integritySrc), 'newRow does not put the alternatives on the row');
ok(/row\.tplAlternatives=\(m&&m\.alternatives\)\|\|\[\]/.test(integritySrc), 'a matcher path does not refresh the row alternatives');
ok((integritySrc.match(/tplAlternatives/g) || []).length >= 4, 'not every matcher entry point carries the alternatives');

/* ===========================================================================
 * 4. THE SURFACE EXISTS, IN BOTH TWINS, BYTE-IDENTICAL
 * ========================================================================= */

['_opAltTplHtml', 'opPrepPickTemplate', '_opConformanceHtml', '_opNoteHasDate'].forEach((fn) => {
  const a = liftShell(shell1p, fn, '1p/index.html');
  const b = liftShell(shellTwin, fn, '1pScribeFlow.html');
  eq(a, b, fn + ' is not byte-identical in the two twins');
});

ok(/row\.tplConformance=\(out&&out\.templateConformance\)\|\|null;/.test(shell1p),
  'opPrepGenerateOne does not carry the conformance measure onto the row, so nothing can render it');
ok(/h\+=_opConformanceHtml\(i,row\);/.test(shell1p), 'opPrepRender never calls the conformance strip');
ok(/h\+=_opAltTplHtml\(i,row\);/.test(shell1p), 'opPrepRender never calls the alternatives strip');
ok(/did not follow the template/.test(shell1p), 'the honest wording the owner asked for is not on the screen');
ok(/Re-draft following the template/.test(shell1p), 'the one-click regenerate is missing from the flagged draft');
ok(/REPRODUCE, THEN FILL/.test(shell1p), 'the fallback generator in the shell was left with the old summarising contract');

/* The strip must be conditional on the measure, never on a guess. */
const stripSrc = liftShell(shell1p, '_opConformanceHtml', '1p/index.html');
ok(/if\(!c\|\|!c\.total\|\|!c\.belowThreshold\) return '';/.test(stripSrc),
  'the warning strip does not gate on the measured verdict — it would either cry wolf or hide a real one');
ok(!/fill|invent|write the missing/i.test(stripSrc.replace(/Re-draft following the template/g, '')),
  'the warning strip offers to fill the missing template lines — the only thing that could fill them is invention');

/* The twins may differ ONLY where they differed before this change. */
const headA = execFileSync('git', ['show', 'HEAD:1pScribeFlow.html'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
const headB = execFileSync('git', ['show', 'HEAD:1p/index.html'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
function twinDelta(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const setA = new Map(), setB = new Map();
  la.forEach((l) => setA.set(l, (setA.get(l) || 0) + 1));
  lb.forEach((l) => setB.set(l, (setB.get(l) || 0) + 1));
  const only = [];
  setA.forEach((n, l) => { const m = setB.get(l) || 0; if (n > m) only.push('A:' + l); });
  setB.forEach((n, l) => { const m = setA.get(l) || 0; if (n > m) only.push('B:' + l); });
  return only.sort().join('\n');
}
eq(twinDelta(shellTwin, shell1p), twinDelta(headA, headB),
  'the twins now differ somewhere they did not differ at HEAD — an edit landed in only one of them');

/* ===========================================================================
 * 5. END TO END, THROUGH THE GENERATOR THAT ACTUALLY SHIPS
 * Everything above slices one function. This drives window._genOpNote — the
 * function install() puts on the window — with a stubbed model reply, so the
 * claims are about the pipeline rather than about its parts. The shell's own
 * _opGuardProcedureDate is deliberately ABSENT from this harness: if the date
 * still lands, the deterministic fill is doing it and not the repair guard.
 * ========================================================================= */
async function endToEnd() {
  const TPL_TEXT = [
    'OPERATIVE REPORT',
    'Patient: [[patient]]',
    'Date of procedure: [[date_of_procedure]]',
    'Pre-operative diagnosis: Lumbar spondylosis without myelopathy.',
    'Procedure performed: [[procedure]]',
    'Anesthesia: Local anesthesia with moderate conscious sedation as documented in the record.',
    'Indications: The patient has failed conservative management including physical therapy and oral anti-inflammatory medication.',
    'Consent: obtained.',
    'Sterile prep and drape.',
    'Surgical time-out performed.',
    'Fluoroscopy was used.',
    'Technique: The patient was brought to the procedure suite and placed prone on the fluoroscopy table with monitoring in place.',
    'Complications: None. The patient tolerated the procedure well.',
    'Disposition: The patient was observed in recovery and discharged home in stable condition with routine instructions.'
  ].join('\n');

  const TPL = { id: 'mbb', name: 'Lumbar Medial Branch Block', keywords: ['medial branch', 'mbb'], text: TPL_TEXT };
  const PATIENT = { id: 'p1', name: 'Jane Doe', dob: '1970-01-02', mrn: 'M1', problems: 'Lumbar spondylosis', meds: '', allergies: '' };

  function run(reply) {
    const { sandbox } = loadIntegrity({ templates: [TPL], patients: [PATIENT] });
    sandbox.getKey = () => '';
    let calls = 0;
    sandbox.aiCallRaw = function () { calls++; return Promise.resolve(reply); };
    const ctx = { patientId: 'p1', dob: '1970-01-02', templateId: 'mbb', history: 'Prior lumbar MBB with good relief.' };
    return sandbox._genOpNote('Jane Doe', KNOWN_DAY, 'Left L4-L5 medial branch block', TPL_TEXT, ctx)
      .then((r) => ({ r, calls, sandbox }));
  }

  /* (a) THE MODEL LEAVES THE DATE AS A BLANK AND ASKS FOR IT. */
  const faithful = TPL_TEXT
    .replace('[[patient]]', 'Jane Doe')
    .replace('[[procedure]]', 'Left L4-L5 medial branch block');
  const a = await run(JSON.stringify({
    note: faithful,
    missing: [{ key: 'date_of_procedure', label: 'Date of procedure', example: '8/6/2026' }]
  }));
  ok(a.r.note.indexOf('[[date_of_procedure]]') < 0,
    'END TO END: the shipped generator returned a note still carrying a date blank, with no shell repair guard present — the Fields box would ask the doctor for the day the app already knows');
  ok(a.r.note.indexOf('Date of procedure: ' + KNOWN_DAY) >= 0,
    'END TO END: the known day did not land on the template\'s own date line');
  ok(a.r.note.split(KNOWN_DAY).length - 1 === 1,
    'END TO END: the known day was written more than once — the duplicate-date-line defect');

  /* and the shell's reconciler then drops it from the Fields box, which is the
     surface the doctor was complaining about */
  const reconcileSrc = liftShell(shell1p, '_opReconcileBlanks', '1p/index.html');
  // eslint-disable-next-line no-new-func
  const _opReconcileBlanks = new Function(reconcileSrc + '; return _opReconcileBlanks;')();
  const row = { note: a.r.note, missing: JSON.parse(JSON.stringify(a.r.missing || [])) };
  _opReconcileBlanks(row);
  ok(!row.missing.some((mf) => /date/.test(String(mf.key))),
    'END TO END: the Fields box still lists a date blank after reconciliation — the doctor is still asked for it');

  /* (b) A DRAFT THAT PASSES THE FIDELITY GATE AND STILL DID NOT FOLLOW THE
     TEMPLATE. Headings and every long fixed fragment are reproduced, so
     fidelity() passes on the first try (one model call, no repair). The short
     procedural lines fixedFragments does not grade are gone.
     THIS IS THE GAP THE MEASURE EXISTS TO CLOSE: fixedFragments() only grades a
     line once it reaches 5 words or 36 characters, so the short procedural
     lines every operative note is made of are invisible to the gate. */
  const thinned = faithful
    .split('\n')
    .filter((l) => !/^(Sterile prep|Surgical time-out|Fluoroscopy was used)/.test(l))
    .join('\n');
  const b = await run(JSON.stringify({ note: thinned, missing: [] }));
  eq(b.calls, 1, 'the thinned draft went through a repair round-trip, so it is not the gate-passes case this checks');
  ok(b.r.templateFidelity && b.r.templateFidelity.pass === true,
    'the fidelity GATE rejected this draft, so it is not the silent-acceptance case — rebuild the fixture');
  ok(b.r.templateConformance && b.r.templateConformance.total > 0,
    'END TO END: the accepted draft carries no conformance measure');
  eq(b.r.templateConformance.notFollowed, 3,
    'END TO END: the three template lines the fidelity gate cannot see were not counted either — nothing in the app would know');
  ok(b.r.templateConformance.mode === 'adapt', 'the conformance record does not name the mode that produced the note');

  /* (b2) A GENUINELY SUMMARISED REPLY IS NEVER SILENTLY ACCEPTED.
     Three outcomes are acceptable and one is not. The pipeline may refuse
     (MLS_OPNOTE_TEMPLATE_FIDELITY), it may rebuild the note from the template
     and SAY it did (reconstructed), or it may accept and flag it. What it may
     not do is hand back a summary with nothing marked. */
  const summary = [
    'OPERATIVE REPORT',
    'Patient: Jane Doe',
    'Date of procedure: ' + KNOWN_DAY,
    'Pre-operative diagnosis: Lumbar spondylosis without myelopathy.',
    'Procedure performed: Left L4-L5 medial branch block',
    'Anesthesia: Local.',
    'Indications: Failed conservative care.',
    'Consent: obtained.',
    'Technique: The block was performed under fluoroscopy.',
    'Complications: None.',
    'Disposition: Discharged home.'
  ].join('\n');
  let outcome = null;
  try {
    const s = await run(JSON.stringify({ note: summary, missing: [] }));
    outcome = s.r.reconstructed === true ? 'reconstructed'
      : (s.r.templateConformance && s.r.templateConformance.belowThreshold === true) ? 'flagged'
        : 'SILENT';
  } catch (e) {
    outcome = (e && (e.code === 'MLS_OPNOTE_TEMPLATE_FIDELITY' || e.code === 'MLS_OPNOTE_CLINICAL_CONFLICT')) ? 'refused' : ('THREW:' + (e && e.code));
  }
  ok(outcome === 'reconstructed' || outcome === 'flagged' || outcome === 'refused',
    'END TO END: a summarised draft came back with nothing marked (' + outcome + ') — that is the owner\'s complaint, unchanged');

  /* (c) THE FULLY FAITHFUL DRAFT IS NOT NAGGED. */
  const c = await run(JSON.stringify({ note: faithful, missing: [] }));
  eq(c.r.templateConformance.belowThreshold, false,
    'END TO END: a faithful draft was flagged as not following the template — a warning that fires on good work stops being read');

  /* (d) WHERE THE GATE IS TURNED OFF, THE MEASURE IS THE ONLY WITNESS.
     This is the seam between the owner's two complaints. When the selected
     template is for a DIFFERENT procedure, generateOnce sets crossAdapt and
     REPLACES the fidelity result with {pass:true} — deliberately, under the
     2026-07-23 directive that a compatibility conflict warns and goes through.
     From that point nothing measured template following at all, so a wrong
     template ("its not choosing the correct temmplates") produced a note that
     did not follow it ("dont follow tempaltes right") with no evidence on
     screen. Same for a template longer than the 12k drafting slice, and for
     'guide' mode. The measure runs on every one of those paths. */
  function runCross(reply) {
    const { sandbox } = loadIntegrity({ templates: [TPL], patients: [PATIENT] });
    sandbox.getKey = () => '';
    sandbox.aiCallRaw = function () { return Promise.resolve(reply); };
    const ctx = { patientId: 'p1', dob: '1970-01-02', templateId: 'mbb' };
    return sandbox._genOpNote('Jane Doe', KNOWN_DAY, 'Bilateral genicular nerve radiofrequency ablation', TPL_TEXT, ctx);
  }
  /* The reply states the REQUESTED procedure correctly — the requested-fact
     contract still runs in cross-adapt mode and would (rightly) refuse a note
     about the template's procedure. What it is, is a summary of the template's
     structure: the boilerplate is gone. */
  const crossSummary = [
    'OPERATIVE REPORT',
    'Patient: Jane Doe',
    'Date of procedure: ' + KNOWN_DAY,
    'Pre-operative diagnosis: Bilateral knee osteoarthritis.',
    'Procedure performed: Bilateral genicular nerve radiofrequency ablation',
    'Anesthesia: Local.',
    'Indications: Failed conservative care.',
    'Consent: obtained.',
    'Technique: Bilateral genicular nerve radiofrequency ablation of the knee was performed under fluoroscopic guidance.',
    'Complications: None.',
    'Disposition: Discharged home.'
  ].join('\n');
  const d = await runCross(JSON.stringify({ note: crossSummary, missing: [] }));
  ok(d.templateFidelity && d.templateFidelity.adapted === true,
    'the cross-procedure path no longer bypasses the fidelity gate — rebuild this fixture against whatever replaced it');
  ok(d.templateConformance && d.templateConformance.crossAdapted === true,
    'END TO END: the cross-procedure draft carries no conformance measure, so the one path with NO gate also has no witness');
  ok(d.templateConformance.belowThreshold === true,
    'END TO END: a summary accepted through the ungated cross-procedure path was not flagged — exactly the silent acceptance the owner is describing');
  ok(d.templateConformance.notFollowed > 0 && d.templateConformance.lines.length > 0,
    'END TO END: the flag names no template line, so "N missing" could not be checked by anyone');
}

endToEnd().then(() => {
  console.log('PASS opnote template fidelity (' + checks + ' checks): the known procedure date fills every date slot deterministically ' +
  'and never a birth-date or drug slot, an unknown date stays an explicit placeholder, the hardened presence test stops the ' +
  'duplicate date line without narrowing the guard, a verbatim draft scores 100 while a summarised one is flagged with an honest ' +
  'count it never rewrites, the exactly-named template beats a longer name that contains it, an undecidable side surfaces its ' +
  'alternatives instead of guessing, every edit is byte-identical in both twins, and the shipped generator proves all of it ' +
  'end to end with the shell repair guard absent');
}).catch((e) => {
  /* An async failure that only rejects a promise is a suite that passes without
     running. Fail the PROCESS. */
  console.error(e && e.stack || e);
  console.error('FAIL opnote template fidelity: the end-to-end section did not complete');
  process.exitCode = 1;
});
