'use strict';

/* note-format-default-proof — fmt-1.0.0
 *
 * OWNER, 2026-09-02, on a real visit: the generated note read
 *   "History: ... Examination: Not documented in today's transcript.
 *    Assessment: 1. ... Plan: Not documented in today's transcript."
 * — the NARRATIVE prose family — and he said "this is not a good format and its
 * missing the hpi and other stuff wtf". He expects the chart shape: HPI / ROS /
 * Exam / Assessment / Plan, the flat SOAP family hostedNotePreferences() maps to
 * the backend's flat_hpi_ros_exam_assessment_plan_v1.
 *
 * The stored uns('genStyle') held 'narrative'. Nothing in the app defaults to
 * narrative: the only writer is setGenStyle(), pressed by the five #genStyleSeg
 * buttons and the Easy view's chips that forward to them. The same account
 * carried draft-tuning formats named "QA HPI Template 2026 ..." and
 * "Engineering Compliance Assessment Template" — test-lane artifacts. A bare
 * string cannot tell a test lane's press from the doctor's.
 *
 * WHAT THIS PROVES, by EXECUTING the shipped resolver out of all three shells
 * (never a re-implementation) and the shipped draft-tuning module:
 *   1. unset                          -> soap
 *   2. stored 'narrative', no stamp   -> soap  (and the stored value SURVIVES)
 *   3. stored 'narrative' WITH stamp  -> narrative
 *   4. an explicit pick stamps {format, chosenAt, source}
 *   5. a malformed / unknown stamp is not a choice
 *   6. the Settings picker says which format matches the athena chart fields,
 *      and the note card carries the active format name
 *   7. QA-pattern saved formats are filtered from the PICKER and from the
 *      TUNING PAYLOAD, are counted for the Settings line, and are removed only
 *      on the doctor's call — never silently.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

/* ---------------------------------------------------------------------------
 * 1. THE SHIPPED RESOLVER, LIFTED AND RUN — one harness, three shells.
 * ------------------------------------------------------------------------- */
const SHELLS = [
  ['1pScribeFlow.html', path.join(root, '1pScribeFlow.html')],
  ['1p/index.html', path.join(root, '1p', 'index.html')],
  ['ScribeFlow.html', path.join(root, 'ScribeFlow.html')]
];

function liftResolver(name, file) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('var GEN_FORMAT_IDS=');
  const bAt = src.indexOf('function refreshNoteFormatMigrationNote(){');
  ok(a >= 0, name + ': the fmt-1.0.0 note-format resolver is gone (GEN_FORMAT_IDS not found)');
  ok(bAt > a, name + ': refreshNoteFormatMigrationNote is gone — the "your stored format is not deleted" line has no writer');
  const bEnd = src.indexOf('\n}', bAt) + 2;
  ok(bEnd > bAt, name + ': refreshNoteFormatMigrationNote is not closed');
  return src.slice(a, bEnd);
}

function makeStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    api: {
      getItem(k) { return map.has(k) ? map.get(k) : null; },
      setItem(k, v) { map.set(k, String(v)); },
      removeItem(k) { map.delete(k); }
    }
  };
}

function runResolver(slice, seed) {
  const store = makeStore(seed);
  const context = {
    console, JSON, Date, Object, String, Array,
    localStorage: store.api,
    document: { getElementById() { return null; }, querySelector() { return null; } },
    window: {}
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext('function uns(k){ return "fmt-proof::" + k; }\n' + slice, context, { filename: 'fmt-resolver' });
  return { context, store, key: k => 'fmt-proof::' + k };
}

const STAMP_KEY = 'fmt-proof::genStyleChoiceV1';
const FORMAT_KEY = 'fmt-proof::genStyle';

for (const [name, file] of SHELLS) {
  const slice = liftResolver(name, file);

  /* (1) unset -> SOAP. The chart shape is what a doctor who has said nothing
     gets, on a fresh account and on this account. */
  {
    const r = runResolver(slice, {});
    eq(r.context.getGenStyle(), 'soap', name + ': an account with no stored format did not resolve to SOAP');
    eq(r.context.getGenStyleIgnored(), '', name + ': nothing is stored, so there is nothing to report as ignored');
  }

  /* (2) stored 'narrative' with NO stamp -> SOAP, and the stored value is NOT
     deleted. This is the owner's exact measured state. */
  {
    const r = runResolver(slice, { [FORMAT_KEY]: 'narrative' });
    eq(r.context.getGenStyle(), 'soap',
      name + ': an unstamped stored "narrative" was honoured — a test lane\'s press is still steering the doctor\'s notes');
    eq(r.context.getGenStyleIgnored(), 'narrative',
      name + ': the ignored stored format is not reported, so Settings cannot say what it is doing');
    eq(r.store.map.get(FORMAT_KEY), 'narrative',
      name + ': the migration DELETED the stored setting — never delete a doctor\'s real setting silently');
  }

  /* Every non-SOAP format behaves the same way; the rule is "unstamped", not
     "narrative". */
  for (const other of ['apso', 'problem', 'hp']) {
    const r = runResolver(slice, { [FORMAT_KEY]: other });
    eq(r.context.getGenStyle(), 'soap', name + ': an unstamped stored "' + other + '" was honoured');
    eq(r.context.getGenStyleIgnored(), other, name + ': the ignored "' + other + '" is not reported');
  }

  /* A stored 'soap' needs no apology — nothing to report. */
  {
    const r = runResolver(slice, { [FORMAT_KEY]: 'soap' });
    eq(r.context.getGenStyle(), 'soap', name + ': a stored soap did not resolve to soap');
    eq(r.context.getGenStyleIgnored(), '', name + ': a stored soap was reported as an ignored format');
  }

  /* (3) stored 'narrative' WITH an explicit-choice stamp -> narrative. A doctor
     who really wants prose keeps it. */
  {
    const r = runResolver(slice, {
      [FORMAT_KEY]: 'narrative',
      [STAMP_KEY]: JSON.stringify({ format: 'narrative', chosenAt: '2026-09-02T11:40:00.000Z', source: 'settings' })
    });
    eq(r.context.getGenStyle(), 'narrative',
      name + ': a STAMPED narrative was overridden — the migration is eating explicit choices');
    eq(r.context.getGenStyleIgnored(), '', name + ': a stamped choice must not be reported as ignored');
    const choice = r.context.getGenStyleChoice();
    ok(choice && choice.format === 'narrative' && choice.chosenAt && choice.source === 'settings',
      name + ': the stamp did not read back as {format, chosenAt, source}');
  }

  /* (5) a stamp is only a choice when it is well formed. */
  const badStamps = [
    ['no chosenAt', { format: 'narrative', source: 'settings' }],
    ['unknown format', { format: 'freeform', chosenAt: '2026-09-02T11:40:00.000Z', source: 'settings' }],
    ['empty object', {}],
    ['an array', ['narrative']]
  ];
  for (const [why, value] of badStamps) {
    const r = runResolver(slice, { [FORMAT_KEY]: 'narrative', [STAMP_KEY]: JSON.stringify(value) });
    eq(r.context.getGenStyle(), 'soap', name + ': a stamp with ' + why + ' was accepted as an explicit choice');
  }
  {
    const r = runResolver(slice, { [FORMAT_KEY]: 'narrative', [STAMP_KEY]: '{not json' });
    eq(r.context.getGenStyle(), 'soap', name + ': unparseable stamp bytes were accepted as an explicit choice');
  }

  /* (4) an explicit pick STAMPS. Without this the press appears to do nothing,
     because getGenStyle() would keep answering soap. */
  {
    const r = runResolver(slice, {});
    r.context.setGenStyle('narrative');
    eq(r.context.getGenStyle(), 'narrative', name + ': setGenStyle did not take effect');
    eq(r.store.map.get(FORMAT_KEY), 'narrative', name + ': setGenStyle did not write the format');
    const stamp = JSON.parse(r.store.map.get(STAMP_KEY));
    eq(stamp.format, 'narrative', name + ': the stamp records the wrong format');
    eq(stamp.source, 'settings', name + ': the stamp lost its source');
    ok(typeof stamp.chosenAt === 'string' && !isNaN(Date.parse(stamp.chosenAt)),
      name + ': the stamp has no readable chosenAt');
    /* the pick survives a reload — the stamp, not the bare string, is what the
       next boot reads */
    const again = runResolver(slice, Object.fromEntries(r.store.map));
    eq(again.context.getGenStyle(), 'narrative', name + ': the explicit pick did not survive a reload');
    /* and it can be moved back */
    again.context.setGenStyle('soap');
    eq(again.context.getGenStyle(), 'soap', name + ': the doctor could not move the format back to SOAP');
  }

  /* an unknown value can never be stored as a format */
  {
    const r = runResolver(slice, {});
    r.context.setGenStyle('freeform');
    eq(r.context.getGenStyle(), 'soap', name + ': an unknown format id was accepted');
  }

  /* the SOAP name a doctor reads is the chart shape, everywhere it is shown */
  {
    const r = runResolver(slice, {});
    eq(r.context.genFormatName('soap'), 'HPI / ROS / Exam / Assessment / Plan',
      name + ': the SOAP format is no longer named by its chart fields');
    eq(r.context.genFormatName('narrative'), 'Narrative', name + ': the narrative format lost its name');
    eq(r.context.genFormatName(''), 'HPI / ROS / Exam / Assessment / Plan',
      name + ': an unknown format id must be named as the SOAP default, not blank');
  }
}

/* ---------------------------------------------------------------------------
 * 2. WHAT THE DOCTOR CAN SEE — the Settings picker copy and the note card.
 * ------------------------------------------------------------------------- */
for (const [name, file] of SHELLS) {
  const src = fs.readFileSync(file, 'utf8');
  ok(/id="noteFormatSel"/.test(src), name + ': the Settings note-format picker is gone');
  ok(src.includes('<option value="soap">HPI / ROS / Exam / Assessment / Plan — matches the athena chart fields (recommended)</option>'),
    name + ': the SOAP option no longer says it matches the athena chart fields');
  for (const value of ['apso', 'narrative', 'problem', 'hp']) {
    const at = src.indexOf('<option value="' + value + '">');
    ok(at > 0, name + ': the "' + value + '" option is missing from the Settings note-format picker');
    const label = src.slice(at, src.indexOf('</option>', at));
    ok(/—/.test(label), name + ': the "' + value + '" option does not explain what the format is');
  }
  ok(/id="noteFormatMigrationNote"/.test(src),
    name + ': the line that tells the doctor their stored format is being ignored is gone');
  ok(/id="mlsDtTestProfileLine"/.test(src), name + ': the hidden-test-profile Settings line has no host');
  /* the note card names the active format */
  const cardAt = src.indexOf('id="noteCard"');
  ok(cardAt > 0, name + ': #noteCard is gone');
  const head = src.slice(cardAt, cardAt + 1400);
  ok(/id="noteFormatBadge"/.test(head), name + ': the note card no longer shows the active note format');
  ok(head.indexOf('id="noteFormatBadge"') < head.indexOf('id="statusBadge"'),
    name + ': the format badge is not in the note card header beside the status badge');
  /* the visit-screen picker names the chart shape too */
  ok(src.includes('title="HPI / ROS / Exam / Assessment / Plan — matches the athena chart fields">SOAP</button>'),
    name + ': the visit-screen SOAP control no longer says what SOAP is');
  /* the chips the Easy view forwards by LABEL must keep their labels */
  for (const label of ['>SOAP<', '>APSO<', '>Narrative<', '>Problem-based<', '>H&amp;P<']) {
    ok(src.includes(label), name + ': a #genStyleSeg button label changed — the Easy view forwards to these by label');
  }
}

/* ---------------------------------------------------------------------------
 * 3. TEST-LANE ARTIFACTS — hidden from the pickers, never sent as tuning,
 *    counted for the Settings line, deleted only on the doctor's call.
 * ------------------------------------------------------------------------- */
const tuningSource = fs.readFileSync(path.join(root, 'feat_mls_draft_tuning.js'), 'utf8');
const tuningP1 = fs.readFileSync(path.join(root, '1p-feat_mls_draft_tuning.js'), 'utf8');
eq(tuningSource, tuningP1, 'the canonical and 1p draft-tuning modules diverged — run the derives');

const QA_HPI = 'QA HPI Template 2026 R3';
const QA_ASSESS = 'Engineering Compliance Assessment Template';
const REAL_HPI = 'Sports medicine follow-up';

function bootTuning(seedState) {
  const stored = new Map();
  if (seedState) stored.set('tuning-proof::draftTuningV1', JSON.stringify(seedState));
  const synced = [];
  const context = {
    console, JSON,
    window: {
      uns: key => 'tuning-proof::' + key,
      getGenLength: () => 'standard',
      getGenInstr: () => '',
      syncPrefsToServer(opts) { synced.push(opts || {}); return Promise.resolve(true); }
    },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem(k) { return stored.has(k) ? stored.get(k) : null; },
      setItem(k, v) { stored.set(k, String(v)); }
    },
    MutationObserver: function () { this.observe = function () {}; },
    CustomEvent: function () {}
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.addEventListener = function () {};
  context.window.dispatchEvent = function () {};
  vm.createContext(context);
  vm.runInContext(tuningSource, context, { filename: 'feat_mls_draft_tuning.js' });
  const api = context.window.__mlsDraftTuning;
  ok(api && api.installed, 'the draft-tuning module did not install');
  return { api, stored, synced };
}

const seeded = {
  schemaVersion: 1,
  families: {
    hpi: {
      profiles: [
        { id: 'standard', label: 'Standard HPI', when: 'Most visits', sectionMode: 'chronological', templateMode: 'adapt' },
        { id: 'qa_hpi', label: QA_HPI, when: 'qa harness', sectionMode: 'problem_focused', templateMode: 'strict' },
        { id: 'sports', label: REAL_HPI, when: 'sports injury follow-up', sectionMode: 'problem_focused', templateMode: 'adapt' }
      ],
      activeProfile: 'qa_hpi'
    },
    assessment: {
      profiles: [
        { id: 'problem_list', label: 'Problem list', when: 'Diagnoses are established', sectionMode: 'problem_list', templateMode: 'adapt' },
        { id: 'eng_compliance', label: QA_ASSESS, when: 'compliance sweep', sectionMode: 'ranked_differential', templateMode: 'strict' }
      ],
      activeProfile: 'eng_compliance'
    }
  }
};

{
  const t = bootTuning(seeded);

  /* the PICKERS */
  const hpiLabels = t.api.profiles('hpi').map(p => p.label);
  ok(!hpiLabels.includes(QA_HPI), 'a QA-pattern saved format is still offered in the HPI picker: ' + JSON.stringify(hpiLabels));
  ok(hpiLabels.includes(REAL_HPI), 'the doctor\'s own saved format was filtered out with the QA artifacts');
  ok(hpiLabels.includes('Standard HPI'), 'the shipped HPI format was filtered out with the QA artifacts');
  const assessLabels = t.api.profiles('assessment').map(p => p.label);
  ok(!assessLabels.includes(QA_ASSESS), 'a QA-pattern saved format is still offered in the Assessment picker');
  ok(assessLabels.length > 0, 'the Assessment picker was emptied instead of falling back to the shipped formats');

  /* profileState feeds the visit screen's per-section override row */
  const state = t.api.profileState('hpi');
  ok(!state.profiles.some(p => p.label === QA_HPI),
    'the visit-screen section-format row still lists a QA-pattern saved format');
  ok(state.activeLabel !== QA_HPI,
    'the "Account default" line still names a QA-pattern saved format');

  /* the TUNING PAYLOAD — the one that reaches a generation */
  const structured = t.api.forStructured({});
  ok(JSON.stringify(structured).indexOf(QA_HPI) < 0,
    'a QA-pattern format name is still transported with the structured note payload');
  ok(JSON.stringify(structured).indexOf(QA_ASSESS) < 0,
    'a QA-pattern format name is still transported with the structured note payload');
  const hpiPayload = t.api.forFamily('hpi');
  ok(hpiPayload.profileName !== QA_HPI, 'the HPI payload still selects the QA-pattern saved format');
  const assessPayload = t.api.forFamily('assessment');
  ok(assessPayload.profileName !== QA_ASSESS, 'the Assessment payload still selects the QA-pattern saved format');
  const routed = t.api.autoRoute({ todayTranscript: 'compliance sweep qa harness sports injury follow-up' });
  ok(routed.families.hpi.profileId !== 'qa_hpi', 'automatic routing can still land on a QA-pattern saved format');
  ok(routed.families.assessment.profileId !== 'eng_compliance', 'automatic routing can still land on a QA-pattern saved format');

  /* the COUNT for the Settings line, and the data still on disk */
  const found = t.api.testProfiles();
  eq(found.length, 2, 'the Settings line would report the wrong number of hidden test profiles');
  ok(found.some(r => r.label === QA_HPI) && found.some(r => r.label === QA_ASSESS),
    'the hidden test profiles are not named, so the Settings line cannot say what it is hiding');
  ok(t.stored.get('tuning-proof::draftTuningV1').indexOf(QA_HPI) >= 0,
    'hiding a test profile DELETED it — hiding is client-side and must never touch stored data');

  /* the doctor's press — and only then */
  const removed = t.api.removeTestProfiles();
  eq(removed, 2, 'Remove did not delete both test profiles');
  eq(t.api.testProfiles().length, 0, 'a test profile survived Remove');
  const after = t.stored.get('tuning-proof::draftTuningV1');
  ok(after.indexOf(QA_HPI) < 0 && after.indexOf(QA_ASSESS) < 0, 'Remove did not write the deletion to storage');
  ok(after.indexOf(REAL_HPI) >= 0, 'Remove deleted the doctor\'s own saved format');
  eq(t.synced.length, 1, 'Remove did not ask the existing account sync to carry the deletion to the server');
  /* the active selection no longer points at something that is gone */
  eq(t.api.profileState('assessment').profiles.some(p => p.id === 'eng_compliance'), false,
    'the removed format is still in the Assessment list');
  ok(t.api.forFamily('assessment').profileId, 'the Assessment family lost its active saved format after Remove');
}

/* a clean account reports nothing and Remove is a no-op */
{
  const t = bootTuning(null);
  eq(t.api.testProfiles().length, 0, 'a clean account reported hidden test profiles');
  eq(t.api.removeTestProfiles(), 0, 'Remove claimed a deletion on a clean account');
  eq(t.synced.length, 0, 'Remove synced the server with nothing to delete');
}

/* a family whose every saved format is an artifact still shows a usable picker */
{
  const t = bootTuning({
    schemaVersion: 1,
    families: {
      hpi: {
        profiles: [
          { id: 'qa_a', label: 'QA HPI Template 2026 A', when: '', sectionMode: 'chronological', templateMode: 'adapt' },
          { id: 'qa_b', label: 'QA Exam Template 2026 B', when: '', sectionMode: 'chronological', templateMode: 'adapt' }
        ],
        activeProfile: 'qa_a'
      }
    }
  });
  const labels = t.api.profiles('hpi').map(p => p.label);
  ok(labels.length > 0, 'a family of nothing but artifacts left an EMPTY picker');
  ok(!labels.some(l => /QA .* Template 2026/i.test(l)), 'the fallback picker still contains artifacts');
  eq(t.api.testProfiles().length, 2, 'both artifacts must still be counted for the Settings line');
}

/* the pattern is exactly the known test-lane shapes — no wider */
{
  const t = bootTuning(null);
  const artifacts = ['QA HPI Template 2026 R3', 'Engineering Compliance Assessment Template', 'QA Plan Template 2026'];
  const legitimate = ['Standard HPI', 'QA follow-up', 'Compliance letter', 'Engineering note', 'Template 2026 review'];
  for (const label of artifacts) ok(t.api.isTestProfile({ label }), 'a known test-lane name is not matched: ' + label);
  for (const label of legitimate) ok(!t.api.isTestProfile({ label }), 'a legitimate saved format is matched as an artifact: ' + label);
  ok(!t.api.isTestProfile(null), 'a missing row must not be matched as an artifact');
}

console.log('note-format-default-proof: PASS (' + checks + ' checks)');
