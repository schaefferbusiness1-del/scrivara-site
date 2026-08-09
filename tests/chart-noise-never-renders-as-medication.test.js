'use strict';

/* A TABLE HEADER IS NOT A MEDICATION.
 *
 * Measured live at b685 on the owner's signed-in tab, real chart (patient "A",
 * MRN 8300571). The patient card's Medications panel rendered, as medications:
 *
 *     "check now"           an athenaOne row action LINK
 *     "Name"  "Date"        the meds grid's COLUMN HEADER ROW, swallowed whole
 *     "Deborah Hendricks"   a PERSON'S NAME out of the prescriber column
 *     "SHAMPOO 3 TIMES ..." the sig of the row above it, split off as its own drug
 *
 * and the Problem list rendered "Discussion", "Discussion Notes" and "Ordered
 * sacroiliac joint injection (PROC)" as problems. Real medications (calcium,
 * Fish Oil, ketoconazole 2 % shampoo) were in there too - the card was not
 * empty, it was UNTRUSTWORTHY, which is worse. This is the most clinically
 * sensitive surface in the app and it was asserting things-as-medications that
 * are not medications.
 *
 * This suite pins the fix in BOTH directions, because the old code was wrong
 * both ways:
 *
 *   1. page furniture must never reach the medication / problem list
 *   2. a row the parser cannot classify must never be silently DELETED - it
 *      lands in the unsorted fold and RENDERS, plainly labelled as not clinical
 *
 * NEGATIVE-TESTED BOTH DIRECTIONS (the b669 rule - a gate that has not been
 * proven to fail on the real regression is not a gate). Arm 0 below runs the
 * fixture through the RETIRED v1.1.0 keep-tests, taken verbatim out of git
 * history, and asserts they DO admit the garbage. If someone reverts the parser,
 * arm 1 fails; if someone weakens this fixture so it no longer contains the
 * defect, arm 0 fails.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const pack = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, begin, end, label) {
  const a = source.indexOf(begin);
  assert(a >= 0, `${label}: missing start marker ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `${label}: missing end marker ${end}`);
  return source.slice(a, b);
}

/* The two halves of the fix, sliced out of the shipped satellite. Each slice
   starts inside a banner comment and (for module 7) stops inside the next one,
   so the borrowed comment delimiters are re-balanced around it. */
const cleaner = '/*\n' + between(pack, ' * MODULE 7 - CHART-SECTION CLEANER', ' * __mlsDobEverywhere v1.0.0', 'module 7') + '\n*/';
const fold = '/*\n' + between(pack, ' * MODULE 10 - UNSORTED-FROM-CHART FOLD', '\n})();', 'module 10') + '\n})();';
/* the REAL profile renderer out of the app, not a re-implementation */
const profile = between(app, 'function _athenaProfileEmptyText(p,key,fallback)', '/* "At a glance" chips', 'renderProfile');

/* ---------------------------------------------------------------------------
 * THE FIXTURE - the shape athenaOne's medication grid actually produces:
 * a header row, an action link per row, a prescriber column, and a sig that
 * arrives on its own line. Names are the ones measured live at b685.
 * ------------------------------------------------------------------------ */
const GRID_MEDS = [
  'Medications (7 new)',
  'Name', 'Date', 'Prescriber', 'Sig', 'Refills', 'Status',
  'check now',
  'calcium',
  '01/14/2026',
  'Deborah Hendricks',
  'Fish Oil',
  'ketoconazole 2 % shampoo',
  'SHAMPOO 3 TIMES WEEKLY AS DIRECTED',
  'metformin HCl 500 mg tablet',
  'TAKE 1 TABLET BY MOUTH TWICE A DAY',
  'lisinopril 10 mg'
].join('\n');

const NOTE_PROBLEMS = [
  'Discussion',
  'Discussion Notes',
  'Ordered sacroiliac joint injection (PROC)',
  'M54.5 Low back pain',
  'Cervical spondylosis'
].join('\n');

const FURNITURE = ['Name', 'Date', 'Prescriber', 'Sig', 'Refills', 'Status', 'check now'];
const REAL_MEDS = ['calcium', 'Fish Oil', 'ketoconazole 2 % shampoo', 'metformin HCl 500 mg tablet', 'lisinopril 10 mg'];

/* ===========================================================================
 * ARM 0 - the fixture really does contain the b685 defect
 * The RETIRED v1.1.0 keep-tests, verbatim. If these stop admitting the
 * garbage, the fixture has been defanged and arm 1 proves nothing.
 * ======================================================================== */
const DOSE_v110 = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|g|ml|meq|units?|iu|%)\b|\b(?:tablet|capsule|patch|cream|ointment|solution|suspension|spray|inhaler|injection|gel|drops|lozenge)s?\b|\b(?:daily|nightly|weekly|monthly|bid|tid|qid|prn|qhs|qam|qpm|qd|q\s?\d+\s?h(?:ours?)?|twice a day|once a day|at bedtime|as needed|by mouth|oral(?:ly)?|topical(?:ly)?|subcutaneous|intramuscular)\b/i;
function lettersRatio_v110(t) { const s = t.replace(/\s+/g, ''); return s.length ? (s.match(/[A-Za-z]/g) || []).length / s.length : 0; }
function looksName_v110(t, maxWords) {
  if (t.length < 3 || t.length > 120) return false;
  const w = t.split(/\s+/); if (w.length > (maxWords || 12)) return false;
  if (lettersRatio_v110(t) < 0.55) return false;
  return w.some(x => /^[A-Za-z][A-Za-z'\-]{3,}$/.test(x));
}
const keepMed_v110 = t => DOSE_v110.test(t) || (t.length <= 80 && looksName_v110(t, 8));
const keepProblem_v110 = t => looksName_v110(t, 12);

for (const junk of ['Name', 'Date', 'check now', 'Deborah Hendricks']) {
  assert(keepMed_v110(junk), `arm 0: the retired keep-test no longer admits "${junk}" - the fixture no longer reproduces b685`);
}
for (const junk of ['Discussion', 'Discussion Notes', 'Ordered sacroiliac joint injection (PROC)']) {
  assert(keepProblem_v110(junk), `arm 0: the retired keep-test no longer admits "${junk}" - the fixture no longer reproduces b685`);
}

/* ===========================================================================
 * ARM 1 - the parser: furniture dropped, real meds kept, the rest set aside
 * ======================================================================== */
function loadCleaner() {
  const ctx = {
    console, JSON, Object, String, Number, Array, RegExp, Date, Math,
    URL: { createObjectURL() { throw new Error('no worker in test'); }, revokeObjectURL() {} },
    Blob: function () {}, Worker: function () { throw new Error('no worker in test'); },
    document: { addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {}
  };
  ctx.window = ctx;
  vm.runInNewContext(cleaner, ctx, { filename: 'clean-sections.js' });
  assert(ctx.__mlsCleanSections, 'module 7 did not install');
  return ctx.__mlsCleanSections;
}
const api = loadCleaner();
assert.strictEqual(api.version, '1.3.1', 'the input-safe triage build of __mlsCleanSections is not the one shipping');
assert.strictEqual(api.selfTest().pass, true, "module 7's own self-test failed");

const meds = api.triageMeds(GRID_MEDS);
const medsFlat = meds.keep.join(' | ');
for (const junk of FURNITURE) {
  assert(meds.keep.indexOf(junk) < 0, `"${junk}" is grid furniture and is rendering as a MEDICATION`);
  assert(meds.unsorted.indexOf(junk) < 0, `"${junk}" is grid furniture and should be dropped, not folded`);
}
for (const drug of REAL_MEDS) {
  assert(medsFlat.indexOf(drug) >= 0, `real medication "${drug}" was lost by the parser`);
}
/* the person is not a drug - and is not deleted either */
assert(meds.keep.indexOf('Deborah Hendricks') < 0, 'a prescriber name is still filed as a medication');
assert(meds.unsorted.indexOf('Deborah Hendricks') >= 0, 'a prescriber name was silently DELETED instead of set aside');
/* the sig belongs to the drug above it, not to itself */
assert(meds.keep.indexOf('SHAMPOO 3 TIMES WEEKLY AS DIRECTED') < 0, 'a sig line is still its own "medication"');
assert(medsFlat.indexOf('SHAMPOO 3 TIMES WEEKLY AS DIRECTED') >= 0, 'the sig text was lost instead of re-attached');
assert(/ketoconazole 2 % shampoo\s+—\s+SHAMPOO 3 TIMES WEEKLY/.test(medsFlat), 'the sig did not re-attach to the medication above it');
assert(/metformin HCl 500 mg tablet\s+—\s+TAKE 1 TABLET/.test(medsFlat), 'the second sig did not re-attach to its medication');

const probs = api.triageProblems(NOTE_PROBLEMS);
/* JSON, not deepStrictEqual: arrays built inside the vm realm have a different
   Array.prototype and compare unequal even when identical. */
assert.strictEqual(JSON.stringify(probs.keep), JSON.stringify(['M54.5 Low back pain', 'Cervical spondylosis']),
  'the problem list is not exactly the two real diagnoses: ' + JSON.stringify(probs.keep));
for (const frag of ['Discussion', 'Discussion Notes', 'Ordered sacroiliac joint injection (PROC)']) {
  assert(probs.unsorted.indexOf(frag) >= 0, `note fragment "${frag}" was dropped instead of set aside`);
}

/* nothing is invented and nothing evaporates: every input line either survives
   somewhere, or is furniture we can name */
const accounted = meds.keep.join('\n') + '\n' + meds.unsorted.join('\n');
for (const drug of REAL_MEDS) assert(accounted.indexOf(drug) >= 0, `${drug} unaccounted for`);

/* ===========================================================================
 * ARM 2 - idempotence, receipts, and a clinician's deletion
 * ======================================================================== */
const RECEIPTS = {
  athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'p1', capturedAt: '2026-07-26T00:00:00.000Z', cards: { meds: { status: 'found', populated: true }, problems: { status: 'found', populated: true } } },
  athenaChartSnapshot: { capturedAt: '2026-07-26T00:00:00.000Z', meds: ['calcium'], problems: ['M54.5 Low back pain'] },
  athenaChartImportedAt: '2026-07-26T00:00:00.000Z',
  athenaChartSummaryBlock: '- Pulled from Athena 7/26/2026 -'
};
const patient = Object.assign({ id: 'p1', name: 'A', mrn: '8300571', meds: GRID_MEDS, problems: NOTE_PROBLEMS, allergies: 'NKDA', summary: '' },
  JSON.parse(JSON.stringify(RECEIPTS)));
const receiptsBefore = JSON.stringify(RECEIPTS);

assert.strictEqual(api.cleanPatient(patient), true, 'the first clean pass reported no change on a dirty record');
assert.strictEqual(api.cleanPatient(patient), false, 'the cleaner is not idempotent - a second pass keeps rewriting the record');
assert.strictEqual(JSON.stringify({
  athenaProfileCoverage: patient.athenaProfileCoverage, athenaChartSnapshot: patient.athenaChartSnapshot,
  athenaChartImportedAt: patient.athenaChartImportedAt, athenaChartSummaryBlock: patient.athenaChartSummaryBlock
}), receiptsBefore, 'the cleaner modified an Athena coverage receipt');
assert(Array.isArray(patient._mlsUnsortedMeds) && patient._mlsUnsortedMeds.indexOf('Deborah Hendricks') >= 0,
  'the unsorted fold was not persisted on the record');
assert(typeof patient._rawMeds === 'string' && patient._rawMeds.indexOf('check now') >= 0,
  'the original chart text was not stashed before the field was rewritten');

/* a medication the clinician deletes must STAY deleted - deriving the fold from
   the _raw* stash resurrected them on every save, which is why it does not */
patient.meds = 'calcium\nFish Oil';
api.cleanPatient(patient);
assert(!/metformin|lisinopril/.test(String(patient.meds)),
  'a medication the clinician deleted came back from the raw stash');
assert(patient._mlsUnsortedMeds.indexOf('Deborah Hendricks') >= 0,
  'the fold was erased when the field shrank - a set-aside row must not vanish');
assert.strictEqual(api.cleanPatient(patient), false, 'the cleaner churns after a clinician edit');

/* ===========================================================================
 * ARM 3 - the render: the fold is ON SCREEN, and the meds panel is clean
 * Drives the REAL renderProfile out of ScribeFlow.html.
 * ======================================================================== */
class Element {
  constructor(tag, id, doc) {
    this.tagName = String(tag || 'div').toUpperCase(); this._id = id || ''; this.ownerDocument = doc;
    this.children = []; this.parentNode = null; this.style = { display: '', cssText: '', removeProperty() {} };
    this.className = ''; this._text = ''; this.innerHTML = ''; this.attributes = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }
  get id() { return this._id; }
  set id(value) { this._id = String(value || ''); if (this._id) this.ownerDocument.nodes[this._id] = this; }
  get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('\n') : this._text; }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children.length = 0; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; }
  appendChild(c) { c.parentNode = this; this.children.push(c); if (c.id) this.ownerDocument.nodes[c.id] = c; return c; }
  insertBefore(c, before) { c.parentNode = this; const i = before ? this.children.indexOf(before) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); if (c.id) this.ownerDocument.nodes[c.id] = c; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; if (c.id) delete this.ownerDocument.nodes[c.id]; return c; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  querySelector() { return null; }
}
function makeDocument() {
  const doc = {
    nodes: {}, readyState: 'complete',
    createElement(tag) { return new Element(tag, '', doc); },
    getElementById(id) { return doc.nodes[id] || null; },
    querySelector() { return null; },
    addEventListener() {}, removeEventListener() {}
  };
  doc.body = new Element('body', 'body', doc); doc.head = new Element('head', 'head', doc);
  doc.documentElement = new Element('html', 'html', doc);
  const card = new Element('section', 'profileCard', doc); doc.body.appendChild(card);
  for (const id of ['profileNonePanel', 'ptDeselectChip', 'profName', 'profDemo']) card.appendChild(new Element('div', id, doc));
  /* each body div lives inside its own .prof-box, exactly like the app markup */
  for (const id of ['profProblems', 'profMeds', 'profAllergies', 'profSummary']) {
    const box = new Element('div', '', doc); box.className = 'prof-box';
    box.appendChild(new Element('div', id, doc));
    card.appendChild(box);
  }
  return doc;
}

const doc = makeDocument();
let rendered = JSON.parse(JSON.stringify(patient));
rendered.meds = GRID_MEDS; rendered.problems = NOTE_PROBLEMS;
delete rendered._rawMeds; delete rendered._rawProblems;
delete rendered._mlsUnsortedMeds; delete rendered._mlsUnsortedProblems;
api.cleanPatient(rendered);

const view = {
  console, JSON, Object, String, Number, Array, RegExp, Date, Math,
  document: doc,
  getPatients: () => [rendered],
  activePatient: () => rendered,
  renderInsurance() {}, renderDocs() {}, renderPtTimeline() {}, toast() {},
  addEventListener() {}, removeEventListener() {}
};
view.window = view;
vm.runInNewContext(profile, view, { filename: 'render-profile.js' });
vm.runInNewContext(fold, view, { filename: 'unsorted-fold.js' });
assert(view.__mlsUnsortedFold, 'module 10 did not install');
assert.strictEqual(view.renderProfile.__mlsUnsFoldWrap, 1, 'module 10 is not in the renderProfile chain');

view.renderProfile();

const medsText = doc.getElementById('profMeds').textContent;
const probsText = doc.getElementById('profProblems').textContent;
for (const junk of FURNITURE.concat(['Deborah Hendricks'])) {
  assert(medsText.split('\n').indexOf(junk) < 0, `"${junk}" is still rendered inside the Medications panel`);
}
for (const drug of REAL_MEDS) assert(medsText.indexOf(drug) >= 0, `"${drug}" is missing from the rendered Medications panel`);
for (const frag of ['Discussion', 'Discussion Notes']) {
  assert(probsText.split('\n').indexOf(frag) < 0, `"${frag}" is still rendered inside the Problem list`);
}

const medsFold = doc.getElementById('mlsUnsortedMeds');
assert(medsFold, 'nothing renders the medication rows the parser set aside - they are hidden');
assert(medsFold.parentNode && medsFold.parentNode.className === 'prof-box',
  'the fold must be a SIBLING of the body div (editProfField rewrites the body innerHTML)');
assert(medsFold.parentNode !== doc.getElementById('profMeds'), 'the fold is nested inside the editable body');
const foldText = medsFold.textContent;
assert(foldText.indexOf('Unsorted from chart') >= 0, 'the fold is not labelled');
assert(foldText.indexOf('Deborah Hendricks') >= 0, 'the set-aside row is not visible anywhere');
assert(/not treated as clinical facts/.test(foldText), 'the fold does not say what it is - it reads as a medication list');
assert(doc.getElementById('mlsUnsortedProblems'), 'the problem-list fold does not render');

/* zero controls: a fold behind a button is a place clinical text can hide, and
   an added control would also need a Tools reach path it does not have */
(function noControls(node) {
  assert(node.tagName !== 'BUTTON' && node.tagName !== 'A', 'the fold added a control');
  assert(!node.attributes.onclick, 'the fold added a click handler');
  node.children.forEach(noControls);
})(medsFold);

/* re-render must not rewrite the fold - the patient card was measured as the
   loudest idle churner in the app at b624 */
const writesBefore = view.__mlsUnsortedFold.writes;
view.renderProfile(); view.renderProfile(); view.renderProfile();
assert.strictEqual(view.__mlsUnsortedFold.writes, writesBefore,
  `the fold rewrote itself on ${view.__mlsUnsortedFold.writes - writesBefore} idle re-render(s)`);

/* ===========================================================================
 * ARM 4 - the fold must not build a renderProfile CYCLE
 *
 * Found in real Chrome, not by reading: the first build of module 10 re-armed
 * on every click and the page died with "Maximum call stack size exceeded",
 * frames alternating between feat_mls_visit_focus.js and the pack.
 *
 * feat_mls_visit_focus.js is re-entrant by construction - its guard is a marker
 * ON THE FUNCTION, its orig lives in a MODULE-LEVEL variable read at call time,
 * and it re-runs at 1.5s / 4s / 9s. So the moment an unmarked function lands on
 * window.renderProfile, its next retry re-points that shared variable at the
 * new wrapper, and the two call each other forever. Neither change is wrong
 * alone; the defect lives only where they meet.
 *
 * The stand-in below is that exact shape, taken from the real file. It proves
 * the marker carry-forward is what holds - remove __vfWrapped from CARRY and
 * this arm blows the stack, which is the b669 both-directions rule applied to
 * a defect that a static read of either file would never have shown.
 * ======================================================================== */
(function cycleArm() {
  const doc2 = makeDocument();
  const ctx = {
    console, JSON, Object, String, Number, Array, RegExp, Date, Math,
    document: doc2, setTimeout() { return 0; }, clearTimeout() {},
    getPatients: () => [], activePatient: () => null,
    renderInsurance() {}, renderDocs() {}, renderPtTimeline() {}, toast() {}
  };
  ctx.window = ctx;
  vm.runInNewContext(profile, ctx, { filename: 'render-profile-cycle.js' });

  /* verbatim shape of feat_mls_visit_focus.js's wrapRenderProfile */
  let vfCalls = 0, origRenderProfile = null;
  function wrapRenderProfile() {
    if (typeof ctx.renderProfile !== 'function' || ctx.renderProfile.__vfWrapped) return;
    origRenderProfile = ctx.renderProfile;
    const w = function () { vfCalls++; return origRenderProfile.apply(this, arguments); };
    w.__vfWrapped = true;
    ctx.renderProfile = w;
  }

  wrapRenderProfile();                                    // visit_focus boots first
  vm.runInNewContext(fold, ctx, { filename: 'unsorted-fold-cycle.js' });   // then us
  assert.strictEqual(ctx.renderProfile.__vfWrapped, true,
    'the fold did not carry visit_focus\'s head marker forward - its next retry will re-wrap and cycle');
  wrapRenderProfile(); wrapRenderProfile(); wrapRenderProfile();           // its 1.5s/4s/9s retries
  vfCalls = 0;
  ctx.renderProfile();                                    // must terminate
  assert.strictEqual(vfCalls, 1, `renderProfile re-entered ${vfCalls} times - the wrapper chain is a cycle`);

  /* and the reverse order: we install first, visit_focus wraps us, then retries */
  const ctx2 = {
    console, JSON, Object, String, Number, Array, RegExp, Date, Math,
    document: makeDocument(), setTimeout() { return 0; }, clearTimeout() {},
    getPatients: () => [], activePatient: () => null,
    renderInsurance() {}, renderDocs() {}, renderPtTimeline() {}, toast() {}
  };
  ctx2.window = ctx2;
  vm.runInNewContext(profile, ctx2, { filename: 'render-profile-cycle2.js' });
  vm.runInNewContext(fold, ctx2, { filename: 'unsorted-fold-cycle2.js' });
  let vf2 = 0, orig2 = null;
  const wrap2 = () => {
    if (typeof ctx2.renderProfile !== 'function' || ctx2.renderProfile.__vfWrapped) return;
    orig2 = ctx2.renderProfile;
    const w = function () { vf2++; return orig2.apply(this, arguments); };
    w.__vfWrapped = true; ctx2.renderProfile = w;
  };
  wrap2(); wrap2(); wrap2(); wrap2();
  vf2 = 0;
  ctx2.renderProfile();
  assert.strictEqual(vf2, 1, `renderProfile re-entered ${vf2} times when the fold installed first`);
})();

/* a patient with nothing unsorted gets no fold at all */
rendered = { id: 'p2', name: 'B', meds: 'lisinopril 10 mg daily', problems: 'M54.5 Low back pain', allergies: '', summary: '' };
api.cleanPatient(rendered);
view.renderProfile();
assert(!doc.getElementById('mlsUnsortedMeds'), 'a clean chart still shows an empty "Unsorted from chart" block');

console.log('PASS chart noise never renders as a medication: ' + FURNITURE.length + ' furniture rows dropped, ' +
  REAL_MEDS.length + ' real medications kept, 2 sigs re-attached, ' +
  (meds.unsorted.length + probs.unsorted.length) + ' unclassified rows folded and ON SCREEN, receipts untouched, 0 controls, 0 idle rewrites');
