'use strict';

/*
 * aisfix-1.0.0 (b1169) - AI Studio / study builder proof.
 *
 * Pins the nine findings from the 2026-09-01 sweep digest (n=30..38), all in
 * the "MLS Study Pro" (__mlsStudyProB40) IIFE of 1p-mls-connect.js and the
 * Studio composer of 1pScribeFlow.html - un-prefixed mls-connect.js and
 * ScribeFlow.html are DERIVED (scripts/derive-production-from-1p.js), so the
 * source of truth here is the 1p-prefixed file; the derived/cloned outputs
 * are checked for parity, not re-implemented.
 *
 * Where the fix is a real behavioral change (n=30 cohort replace, n=32/37/38
 * runPro refusal/naming/revoke, n=35 Enter-to-submit) the exact function is
 * EXTRACTED from the shipped source by its own markers and EXECUTED in a vm
 * sandbox with a minimal mock of its dependencies - not re-typed by hand -
 * so a regression that reintroduces the old behavior fails this suite even
 * if the surrounding prose survives. Where the fix is a labeling/wording
 * change (n=31 report-contents honesty, n=33 PDF truncation notice, n=34
 * chip contract, n=36 premium-wall route) the property is pinned on the real
 * source text, scoped to the function it belongs to so a coincidental match
 * elsewhere in a 3.9MB file cannot satisfy it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')'); checks++; }

function slice(text, startMarker, endMarker, label) {
  const a = text.indexOf(startMarker);
  ok(a >= 0, label + ': start marker not found - the shipped source moved, this suite is stale not the code');
  const b = text.indexOf(endMarker, a + startMarker.length);
  ok(b > a, label + ': end marker not found after start');
  return text.slice(a, b);
}

const connectSrc = read('1p-mls-connect.js');
const shellSrc = read('1pScribeFlow.html');

/* =====================================================================
 * n=30 - "Build cohort from a pasted list of names" must REPLACE, not
 * accumulate, on a rebuild. EXECUTED: importIntoGroup extracted verbatim
 * and run against a fake study-groups engine (list/createGroup/deleteGroup/
 * addPatient/get), reproducing the exact digest repro (build #1 with 2
 * pasted lines, build #2 with a DIFFERENT 1 pasted line).
 * ===================================================================== */
{
  const igSrc = slice(connectSrc,
    'function importIntoGroup(sg, groupName, list) {',
    '\n  function srcLabel(bySrc) {',
    'n=30 importIntoGroup');
  const sandbox = { console };
  vm.runInNewContext('function importIntoGroup(sg, groupName, list) {' + igSrc.slice('function importIntoGroup(sg, groupName, list) {'.length) +
    '\nthis.__importIntoGroup = importIntoGroup;', sandbox, { filename: 'importIntoGroup', timeout: 5000 });
  const importIntoGroup = sandbox.__importIntoGroup;
  ok(typeof importIntoGroup === 'function', 'n=30: importIntoGroup did not survive extraction');

  function makeSG() {
    let groups = [];
    let seq = 0;
    return {
      list: () => groups.slice(),
      createGroup: (name) => { const g = { id: 'g' + (++seq), name, patients: [] }; groups.push(g); return g; },
      deleteGroup: (id) => { groups = groups.filter((g) => g.id !== id); },
      addPatient: (gid, p) => {
        const g = groups.filter((x) => x.id === gid)[0]; if (!g) return null;
        const np = { id: 'p' + (++seq), name: p.name, dob: p.dob, mrn: p.mrn, visits: p.visits || [] };
        g.patients.push(np); return np;
      },
      get: (id) => groups.filter((g) => g.id === id)[0] || null
    };
  }

  const sg1 = makeSG();
  const listA = [
    { name: 'Alpha One', dob: '1980-01-01', mrn: '', visits: [{ source: 'mls-note' }] },
    { name: 'Beta Two', dob: '1981-02-02', mrn: '', visits: [] }
  ];
  const r1 = importIntoGroup(sg1, 'Cohort - pasted names', listA);
  eq(r1.group.patients.length, 2, 'n=30: build #1 (2 pasted lines) must join exactly 2 patients');
  eq(r1.joined, 2, 'n=30: importIntoGroup must report .joined = the rows THIS build fed in');

  const listB = [{ name: 'Gamma Three', dob: '1982-03-03', mrn: '', visits: [] }];
  const r2 = importIntoGroup(sg1, 'Cohort - pasted names', listB);
  eq(r2.group.patients.length, 1,
    'n=30 REGRESSION: a rebuild with a DIFFERENT list accumulated onto the previous cohort instead of replacing it');
  eq(r2.group.patients[0].name, 'Gamma Three', 'n=30: the replaced cohort must hold ONLY the new build\'s patient');
  eq(r2.joined, 1, 'n=30: .joined on build #2 must be 1, never the stale accumulated total');
  ok(sg1.list().length === 1, 'n=30: a rebuild must not leave a second, orphaned group under the same name');
  ok(r2.group.id !== r1.group.id, 'n=30: a rebuild must create a fresh group (delete+recreate), not mutate the old one in place');

  /* the same law applies to "All patients (auto)" per the fix note */
  ok(/importIntoGroup\(sg, 'All patients \(auto\)', buildAll\(null\)\)/.test(connectSrc),
    'n=30: the "All patients (auto)" build must still route through the same replace-on-rebuild importIntoGroup');
}

/* =====================================================================
 * n=35 - Enter must submit in the two single-line study inputs. EXECUTED:
 * enterSubmits extracted verbatim (with its two real wiring calls) and run
 * against mock elements that record addEventListener/click.
 * ===================================================================== */
{
  const esSrc = slice(connectSrc,
    'function enterSubmits(inputId, btnId) {',
    '\n  }\n  function refreshSgSelect(name) {',
    'n=35 enterSubmits');
  ok(/enterSubmits\("sgpProcTx", "sgpProcBtn"\)/.test(esSrc), 'n=35: the procedure box must be wired to its own button');
  ok(/enterSubmits\("sgpCustomTx", "sgpRunBtn"\)/.test(esSrc), 'n=35: the custom-question box must be wired to Run the study');

  const elements = {};
  function makeEl() {
    const listeners = {};
    return {
      addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
      __fire(type, ev) { (listeners[type] || []).forEach((cb) => cb(ev)); },
      click() { this.clicked = (this.clicked || 0) + 1; }
    };
  }
  ['sgpProcTx', 'sgpProcBtn', 'sgpCustomTx', 'sgpRunBtn'].forEach((id) => { elements[id] = makeEl(); });
  const sandbox = { console, $: (id) => elements[id] || null };
  vm.runInNewContext('function enterSubmits(inputId, btnId) {' + esSrc.slice('function enterSubmits(inputId, btnId) {'.length),
    sandbox, { filename: 'enterSubmits', timeout: 5000 });

  const fire = (id, ev) => elements[id].__fire('keydown', ev);
  fire('sgpProcTx', { key: 'Enter', isComposing: false, keyCode: 13, preventDefault() { this.pd = true; } });
  eq(elements.sgpProcBtn.clicked, 1, 'n=35 REGRESSION: Enter in the procedure box did not click its button');
  fire('sgpCustomTx', { key: 'Enter', isComposing: false, keyCode: 13, preventDefault() { this.pd = true; } });
  eq(elements.sgpRunBtn.clicked, 1, 'n=35 REGRESSION: Enter in the custom-question box did not click Run the study');

  fire('sgpProcTx', { key: 'a', isComposing: false, keyCode: 65, preventDefault() { this.pd = true; } });
  eq(elements.sgpProcBtn.clicked, 1, 'n=35: an unrelated key must never submit');
  fire('sgpProcTx', { key: 'Enter', isComposing: true, keyCode: 229, preventDefault() { this.pd = true; } });
  eq(elements.sgpProcBtn.clicked, 1, 'n=35: an Enter mid-IME-composition (keyCode 229) must never submit');
}

/* =====================================================================
 * n=31 / n=33 - scopedRun's deterministic graph/Excel/PDF must (a) never
 * claim to BE the selected Study type ("Procedure comparison") when it is
 * the same visit-history-and-volume report for all five choices, and
 * (b) never drop patients or cut a note past the page ceiling without
 * saying so. EXECUTED end-to-end against a mock jsPDF/XLSX/study-groups
 * engine so the actual page-cap arithmetic and the actual cover text are
 * both proven, not just grepped.
 * ===================================================================== */
{
  const srSrc = slice(connectSrc, 'function scopedRun(sg, groupId) {', '\n  function wrapEngine() {', 'n=31/33 scopedRun');
  const textCalls = [];
  const sheets = [];
  function makeFakeDoc(height) {
    return function FakeDoc() {
      return {
        /* a LARGE default height keeps the "Visit type breakdown"/"Pain
           trend" sections (which use the real, un-mockable M=48 and a
           hardcoded starting y=210) from ever triggering their OWN
           addPage() - so every page consumed in the n=33b/n=33c scenarios
           below is attributable solely to the patient loop under test, not
           to an artifact of a small mock page. The mid-note scenario
           passes a small height deliberately, to force that ONE overflow. */
        internal: { pageSize: { getWidth: () => 500, getHeight: () => height } },
        setFontSize() {}, setTextColor() {}, setDrawColor() {}, setFont() {}, line() {},
        text(str, x, y) { textCalls.push(String(str)); },
        addPage() {},
        /* deterministic: caller-controlled line breaks via '|', never real width math */
        splitTextToSize(str) { return String(str).split('|'); },
        output(kind) { return { mockPdf: true, kind }; }
      };
    };
  }
  function makePatients(n, opts) {
    opts = opts || {};
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ name: 'Patient ' + i, dob: '1970-01-01', visits: (opts.visitsFor && opts.visitsFor(i)) || [] });
    }
    return out;
  }
  function runScopedOnce(patients, scopeOverrides, height) {
    textCalls.length = 0; sheets.length = 0;
    const sandbox = {
      console, Promise, Blob,
      esc: (s) => String(s), MARK: 'data-mls-mark', pdfSafe: (s) => String(s),
      uiScope: () => Object.assign({ months: 0, type: 'procedure', typeLabel: 'Procedure comparison', rangeLabel: 'all time' }, scopeOverrides),
      filteredClone: (group) => group,
      painSVG: () => '',
      getJsPDF: () => Promise.resolve(makeFakeDoc(height || 5000)),
      getXLSX: () => Promise.resolve({
        utils: {
          book_new: () => ({ sheets: [] }),
          aoa_to_sheet: (aoa) => { sheets.push(aoa); return { aoa }; },
          book_append_sheet: () => {}
        },
        write: () => new Uint8Array([1])
      })
    };
    const analysis = {
      patientCount: patients.length,
      visitCount: patients.reduce((n, p) => n + p.visits.length, 0),
      avgVisits: patients.length ? patients.reduce((n, p) => n + p.visits.length, 0) / patients.length : 0,
      /* empty on purpose: a non-empty byType would make the "Visit type
         breakdown" section consume its OWN page against the small mocked
         page height, which would confound the patient-count arithmetic
         these scenarios depend on. Not under test here - n=31 covers the
         cover/summary labeling, not the breakdown content. */
      byType: {},
      pain: [],
      patients
    };
    const sg = {
      get: () => ({ name: 'Test Group' }),
      analyze: () => analysis,
      chartSVG: () => '<svg></svg>',
      visitRows: () => [['date', 'type', 'detail']]
    };
    vm.runInNewContext('function scopedRun(sg, groupId) {' + srSrc.slice('function scopedRun(sg, groupId) {'.length) +
      '\nthis.__scopedRun = scopedRun;', sandbox, { filename: 'scopedRun', timeout: 5000 });
    return sandbox.__scopedRun(sg, 'g1');
  }

  /* --- n=31: the cover/summary/graph label must not claim the selected
     type WAS the analysis performed - it must say what the report actually
     is (a general visit-history-and-volume report) and show the requested
     type honestly alongside it. --- */
  return runScopedOnce(makePatients(1), {}).then((res) => {
    const cover = textCalls.join(' | ');
    ok(/Visit history & volume report/.test(cover),
      'n=31 REGRESSION: the PDF no longer states what the report actually contains');
    ok(/requested type: Procedure comparison/.test(cover),
      'n=31 REGRESSION: the PDF must still show the doctor\'s requested type, just not as an unearned claim');
    ok(!/^Procedure comparison  \|/.test(cover) && cover.indexOf('Procedure comparison  |  all time') < 0,
      'n=31 REGRESSION: the PDF cover reverted to stamping the bare requested type as if it were the delivered analysis');
    const summarySheet = sheets[0];
    ok(Array.isArray(summarySheet) && summarySheet.some((row) => row[0] === 'Report contents' && /Visit history & volume report/.test(String(row[1]))),
      'n=31 REGRESSION: the Excel Summary sheet no longer states the report\'s real contents');
    ok(summarySheet.some((row) => row[0] === 'Requested study type' && row[1] === 'Procedure comparison'),
      'n=31 REGRESSION: the Excel Summary sheet dropped the honestly-labeled requested type');

    /* --- n=33a: a small cohort must NOT be flagged truncated, and every
       patient must be placed. --- */
    eq(res.pdfTruncated, false, 'n=33: a one-patient PDF must not be marked truncated');
    eq(res.pdfPatientsOmitted, 0, 'n=33: a one-patient PDF must not report omitted patients');

    /* --- n=33b: patients past the page ceiling must be OMITTED and SAID
       SO, never silently dropped. 150 zero-visit patients each consume
       exactly one page; maxPages=100 (page 1 is the cover), so only 99 can
       be placed and 51 must be reported omitted. --- */
    return runScopedOnce(makePatients(150), {}).then((res2) => {
      eq(res2.pdfTruncated, true, 'n=33 REGRESSION: a 150-patient cohort against a 100-page ceiling must be marked truncated');
      eq(res2.pdfPatientsOmitted, 51, 'n=33 REGRESSION: the omitted-patient count is wrong - the ceiling math drifted');
      const notice = textCalls.join(' | ');
      ok(/Truncated at the 100-page ceiling/.test(notice),
        'n=33 REGRESSION: no truncation notice was stamped into the PDF');
      ok(/51 of 150 patients are not included/.test(notice),
        'n=33 REGRESSION: the truncation notice does not name how many patients were omitted');
      ok(/complete row set is in the Excel export/.test(notice),
        'n=33 REGRESSION: the truncation notice must point at the Excel export, which always carries every row');

      /* --- n=33c: a note cut off MID-VISIT (not a whole omitted patient)
         must ALSO be flagged - the exact "cuts a note mid-sentence" bug.
         97 zero-visit filler patients land pages at exactly 99; the 98th
         (target) patient's OWN header addPage() lands pages at exactly 100
         (the ceiling) - so its 10-segment note starts writing on the very
         last page and must run out of room partway through. Numbers (97
         filler, height 158, a 10-segment note) were verified empirically
         against this exact extracted scopedRun, not hand-derived. */
      const noteSegments = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'];
      const target = makePatients(97).concat([{
        name: 'Target Patient', dob: '1970-01-01',
        visits: [{ date: '2026-01-01', type: 'Visit', source: 'mls-note', detail: noteSegments.join('|') }]
      }]);
      return runScopedOnce(target, {}, 158).then((res3) => {
        eq(res3.pdfTruncated, true, 'n=33 REGRESSION: a note cut off mid-visit must still be flagged truncated');
        eq(res3.pdfPatientsOmitted, 0,
          'n=33: every patient WAS placed in this scenario - only the last note was cut short, so 0 must be reported omitted');
        const notice3 = textCalls.join(' | ');
        ok(/notes near the page ceiling were cut short/.test(notice3),
          'n=33 REGRESSION: a mid-note truncation must use the "cut short" wording, not the omitted-patient wording');
        const targetLines = textCalls.filter((t) => /^L\d$/.test(t));
        ok(targetLines.length > 0 && targetLines.length < noteSegments.length,
          'n=33: SOME but not ALL of the note\'s segments must render - proving the cap actually cuts mid-note, not simulated: got ' + targetLines.length + ' of ' + noteSegments.length);
      });
    });
  }).then(() => {

/* =====================================================================
 * n=32 / n=37 / n=38 - runPro must (a) refuse a custom question run with
 * the AI narrative unticked instead of silently discarding it, (b) name
 * the Excel download by the format it actually is, and (c) revoke the
 * PREVIOUS run's object URLs before the next run, not leak them forever.
 * EXECUTED: proUrls/revokeProUrls + runPro extracted verbatim and run
 * against a mock SG/$/selectedGroup/URL.
 * ===================================================================== */
const proUrlsSrc = slice(connectSrc, 'var proUrls = [];', '\n\n  /* ---------- auto-format', 'n=38 proUrls');
ok(/function revokeProUrls\(\) \{/.test(proUrlsSrc), 'n=38: revokeProUrls must be defined alongside proUrls');
const runProSrc = slice(connectSrc, 'function runPro() {', '\n  function runNarrative(g, type, typeLabel, months) {', 'n=32/37/38 runPro');

function makeRunProHarness() {
  const state = { values: { sgpRange: '0', sgpType: 'volume' }, checked: { sgpAi: false }, texts: {}, htmls: {} };
  const elements = {};
  function elFor(id) {
    if (elements[id]) return elements[id];
    const e = {
      get value() { return state.values[id] || ''; }, set value(v) { state.values[id] = v; },
      get checked() { return !!state.checked[id]; }, set checked(v) { state.checked[id] = v; },
      get textContent() { return state.texts[id] || ''; }, set textContent(v) { state.texts[id] = v; },
      get innerHTML() { return state.htmls[id] || ''; }, set innerHTML(v) { state.htmls[id] = v; }
    };
    elements[id] = e; return e;
  }
  const urls = [];
  let runStudyCalls = 0;
  let mockRes = null;
  const sandbox = {
    console, Promise,
    URL: {
      createObjectURL(b) { const u = 'blob:mock-' + (urls.length + 1); urls.push({ u, revoked: false, blob: b }); return u; },
      revokeObjectURL(u) { const rec = urls.filter((r) => r.u === u)[0]; if (rec) rec.revoked = true; }
    },
    SG: () => ({ runStudy: (gid, o) => { runStudyCalls++; return Promise.resolve(mockRes); } }),
    $: (id) => elFor(id),
    selectedGroup: () => ({ id: 'g1', name: 'Test Group', patients: [{ id: 'p1' }] }),
    runNarrative: () => { state.narrativeCalled = true; }
  };
  vm.runInNewContext(proUrlsSrc + '\n' + runProSrc + '\nthis.__runPro = runPro;', sandbox, { filename: 'runPro', timeout: 5000 });
  return {
    setValue: (id, v) => { state.values[id] = v; },
    setChecked: (id, v) => { state.checked[id] = v; },
    setRes: (r) => { mockRes = r; },
    runPro: sandbox.__runPro,
    noteText: () => state.texts.sgpRunNote || '',
    outHtml: () => state.htmls.mlsSgProOut || '',
    urls, runStudyCalls: () => runStudyCalls
  };
}

/* n=32: custom + AI unticked must refuse BEFORE running */
{
  const h = makeRunProHarness();
  h.setValue('sgpType', 'custom'); h.setChecked('sgpAi', false);
  h.runPro();
  ok(/needs the Premium AI narrative/.test(h.noteText()),
    'n=32 REGRESSION: a custom question with the AI narrative unticked must refuse, not run silently');
  eq(h.runStudyCalls(), 0, 'n=32 REGRESSION: the refusal must happen BEFORE sg.runStudy is ever called');
}
/* n=32 negative: custom + AI ticked must proceed (the refusal is scoped, not blanket) */
{
  const h = makeRunProHarness();
  h.setValue('sgpType', 'custom'); h.setChecked('sgpAi', true);
  h.setRes({ svg: '', xlsxBlob: { m: 1 }, pdfBlob: { m: 2 }, pdfPages: 3, xlsxFallback: false, pdfTruncated: false });
  h.runPro();
  ok(!/needs the Premium AI narrative/.test(h.noteText()),
    'n=32: ticking the AI narrative for a custom question must NOT be refused');
  eq(h.runStudyCalls(), 1, 'n=32: a properly-configured custom run must actually call sg.runStudy');
}

/* n=37 + n=38, chained: first run (normal xlsx, not truncated), then a
   second run (CSV fallback, truncated) - proves both the filename/label
   honesty AND that the FIRST run's object URLs are revoked before/at the
   start of the SECOND run, never left to leak for the life of the tab. */
return (function () {
  const h = makeRunProHarness();
  h.setValue('sgpType', 'volume'); h.setChecked('sgpAi', false);
  h.setRes({ svg: '<svg></svg>', xlsxBlob: { m: 'xlsx1' }, pdfBlob: { m: 'pdf1' }, pdfPages: 5, xlsxFallback: false, pdfTruncated: false });
  h.runPro();
  return Promise.resolve().then(() => Promise.resolve()).then(() => {
    ok(/\.xlsx"/.test(h.outHtml()) && h.outHtml().indexOf('.csv"') < 0,
      'n=37: a normal (non-fallback) run must download an actual .xlsx');
    ok(h.outHtml().indexOf('(truncated)') < 0, 'n=33/UI: an untruncated PDF must not be labeled truncated');
    eq(h.urls.length, 2, 'n=38: the first run must create exactly two object URLs (xlsx + pdf)');
    ok(h.urls.every((r) => !r.revoked), 'n=38: a run\'s OWN object URLs must not be revoked while still on screen');
    const firstRunUrls = h.urls.slice();

    h.setRes({ svg: '', xlsxBlob: { m: 'xlsx2' }, pdfBlob: { m: 'pdf2' }, pdfPages: 101, xlsxFallback: true, pdfTruncated: true });
    h.runPro();
    /* revokeProUrls() runs SYNCHRONOUSLY at the top of runPro, before the
       async sg.runStudy(...).then(...) ever resolves - so the first run's
       URLs must already be revoked even before we await the second run. */
    ok(firstRunUrls.every((r) => r.revoked),
      'n=38 REGRESSION: starting the next run must revoke the PREVIOUS run\'s object URLs, not leak them');
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      ok(/\.csv"/.test(h.outHtml()) && h.outHtml().indexOf('MLS_Study_Test_Group.xlsx') < 0,
        'n=37 REGRESSION: a CSV-fallback run must download .csv, never a .xlsx that is really a CSV');
      ok(/CSV fallback/.test(h.outHtml()), 'n=37: a CSV-fallback run must say so next to the download');
      ok(h.outHtml().indexOf('(truncated)') >= 0, 'n=33/UI REGRESSION: a truncated PDF\'s download label must say so');
      eq(h.urls.length, 4, 'n=38: the second run must create its OWN two fresh object URLs');
      const secondRunUrls = h.urls.slice(2);
      ok(secondRunUrls.every((r) => !r.revoked), 'n=38: the CURRENT run\'s object URLs must remain live while displayed');

      /* =====================================================================
       * n=34 - starter chips in "Build a custom tool" must fill+focus only,
       * matching the neighboring "Try:" links' contract (studioEx) - never
       * wipe a draft and fire a model call without a press. Checked on both
       * halves of the byte-identical twin AND on the derived/cloned outputs,
       * since the digest's own second-instance lesson (n=36) applies here
       * too: a fix that lands in only one copy is not a fix.
       * ===================================================================== */
      [
        ['1pScribeFlow.html', shellSrc],
        ['1p/index.html', read('1p/index.html')],
        ['ScribeFlow.html', read('ScribeFlow.html')],
        ['cloned/index.html', read('cloned/index.html')]
      ].forEach(([name, text]) => {
        const fn = slice(text, 'function studioTemplate(i){', '\nfunction renderStudio(){', 'n=34 studioTemplate in ' + name);
        ok(fn.indexOf('generateStudioWidget()') < 0,
          'n=34 REGRESSION in ' + name + ': a starter chip still fires a model call without a press');
        ok(/p\.focus\(\)/.test(fn),
          'n=34 REGRESSION in ' + name + ': a starter chip no longer focuses the composer (studioEx contract)');
        ok(/p\.value=t\[1\]/.test(fn), 'n=34: a starter chip must still fill the composer with its template text');
      });

      /* =====================================================================
       * n=36 - the AI Studio premium wall ("Data Study engine ... premium
       * add-on") must name a route a solo doctor (no administrator) can
       * take, not dead-end on "Contact your administrator" alone. Checked
       * on the source twins and their derived/cloned outputs; the digest's
       * own point was that a fix landing in only one copy of a duplicated
       * message is how this defect class survives.
       * ===================================================================== */
      [
        ['1pScribeFlow.html', shellSrc],
        ['1p/index.html', read('1p/index.html')],
        ['ScribeFlow.html', read('ScribeFlow.html')],
        ['cloned/index.html', read('cloned/index.html')]
      ].forEach(([name, text]) => {
        const blocks = (text.match(/Data Study engine[^<'"]*premium add-on\.[^<'"]*/g) || []);
        ok(blocks.length >= 3, 'n=36: expected at least 3 premium-wall instances in ' + name + ', found ' + blocks.length);
        blocks.forEach((b, i) => {
          ok(!/^Data Study engine is a premium add-on\. Contact your administrator to enable it\.$/.test(b) &&
            !/premium add-on\. Contact your administrator to enable it\.$/.test(b) || /home page/.test(b),
            'n=36 REGRESSION in ' + name + ' (instance ' + i + '): the premium wall dead-ends on "Contact your administrator" with no route named: "' + b + '"');
          ok(/home page|pricing|plans/i.test(b),
            'n=36 REGRESSION in ' + name + ' (instance ' + i + '): the premium wall names no destination at all: "' + b + '"');
        });
      });

      console.log('PASS ai-studio-fixes: ' + checks + ' checks');
    });
  });
})();
  });
}
