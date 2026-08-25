'use strict';

/* PHI-free browser proof for the production Procedure Documentation lane.
 * The lane may write only one already-open exact editor. It never creates a
 * procedure template, falls back to Exam/generic note, saves, signs, clicks an
 * order control, or mutates a second field. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert(start >= 0, `${name} is missing`);
  const end = source.indexOf('/* ATHENA_ACTION_V2_DRIVER_END */', start);
  assert(end > start, 'ActionV2 driver end marker is missing');
  return source.slice(start, end).trim();
}

const driverSource = functionSource(background, 'mlsAthenaActionV2DriverFn');
assert(/procedure:\s*\{[^}]*['"]procedure documentation['"]\s*:\s*1/.test(driverSource), 'Procedure Documentation is not an exact named-section definition');
assert(driverSource.includes("procedure: 'Athena encounter > Physical Exam > Procedure Documentation'"), 'driver destination does not exactly match the reviewed site destination');
assert(driverSource.includes("procedure: 'Procedure Documentation editor'"), 'driver cannot report the exact procedure editor');
assert(!/mlsAppPrepProcTemplate|Injection Generic Template/.test(driverSource), 'exact procedure placement unexpectedly creates or selects a procedure template');

const patient = { name: 'Synthetic Procedure Patient', dob: '04/18/1972', mrn: '730041' };
const context = {
  appointmentId: '8830041', encounterId: '9930041',
  encounterUrl: 'https://athenanet.athenahealth.com/encounter/9930041',
  visitDate: '08/24/2026', provider: 'Synthetic Clinician, MD'
};
const destination = 'Athena encounter > Physical Exam > Procedure Documentation';

function procedureBlock(id = 'procedure-editor') {
  return `<section data-testid="procedure-documentation" aria-label="Procedure Documentation"><h3>Procedure Documentation</h3><textarea id="${id}" data-appointment-id="8830041" aria-label="Procedure Documentation editor"></textarea></section>`;
}

function fixture(options = {}) {
  const procedure = options.missing ? '' : procedureBlock();
  const duplicate = options.duplicate ? procedureBlock('procedure-editor-2') : '';
  const secondEditor = options.twoEditors ? '<textarea id="procedure-editor-2" data-appointment-id="8830041" aria-label="Procedure Documentation second editor"></textarea>' : '';
  const initial = options.initial || '';
  return `<!doctype html><html><head><style>body,main,section,header,div,textarea,button{display:block}textarea{width:420px;height:70px}</style></head><body>
    <main id="encounter-shell">
      <header data-testid="patient-header" data-patient-name="${patient.name}" data-patient-dob="${patient.dob}" data-patient-mrn="${patient.mrn}">${patient.name}</header>
      <div aria-label="Date of service">08/24/2026</div><div aria-label="Rendering provider">Synthetic Clinician, MD</div>
      <section data-testid="encounter-note-workspace" aria-label="Encounter note workspace"><h2>Encounter note</h2><textarea id="generic-note" data-appointment-id="8830041"></textarea></section>
      <section data-testid="hpi-section" aria-label="History of Present Illness"><h2>History of Present Illness</h2><textarea id="hpi-editor" data-appointment-id="8830041"></textarea></section>
      <section data-testid="ros-section" aria-label="Review of Systems"><h2>Review of Systems</h2><textarea id="ros-editor" data-appointment-id="8830041"></textarea></section>
      <section data-testid="exam-section" aria-label="Physical Examination"><h2>Physical Examination</h2><textarea id="exam-editor" data-appointment-id="8830041" aria-label="Physical Examination editor"></textarea>${procedure}${secondEditor}${duplicate}</section>
      <section data-testid="assessment-section" aria-label="Assessment"><h2>Assessment</h2><textarea id="assessment-editor" data-appointment-id="8830041"></textarea></section>
      <section data-testid="plan-section" aria-label="Plan"><h2>Plan</h2><textarea id="plan-editor" data-appointment-id="8830041"></textarea></section>
      <button id="save-button">Save</button><button id="sign-button">Sign and Save</button><button id="order-button">Place order</button>
    </main><script>window.__clicks=[];document.addEventListener('click',function(e){window.__clicks.push(e.target.id||e.target.tagName);});${initial ? `document.addEventListener('DOMContentLoaded',function(){document.getElementById('procedure-editor').value=${JSON.stringify(initial)};});` : ''}</script></body></html>`;
}

function request(key, text, overrides = {}) {
  const destinations = {
    exam: 'Athena encounter > Physical Exam',
    procedure: destination
  };
  return Object.assign({
    mode: 'execute', action: 'write_note', expectedPatient: patient,
    expectedContext: context, noteText: text,
    sections: [{ key, text, execute: true, destination: destinations[key] || `Unsupported ${key}` }],
    notePolicy: 'empty_only', locked: null
  }, overrides);
}

async function withPage(browser, html, run) {
  const page = await browser.newPage();
  await page.route('https://athenanet.athenahealth.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(context.encounterUrl);
  try { return await run(page); } finally { await page.close(); }
}

async function drive(page, req) {
  return page.evaluate(async ({ source, requestValue }) => (0, eval)(`(${source})`)(requestValue), { source: driverSource, requestValue: req });
}

async function diagnose(page, req) {
  const startNeedle = 'if (candidates.length !== 1) return ';
  const start = driverSource.indexOf(startNeedle);
  const end = driverSource.indexOf(';\n    var hit = candidates[0]', start);
  assert(start >= 0 && end > start, 'driver diagnostic anchor moved');
  const replacement = `if (candidates.length !== 1) return { debug: frames.map(function(fr){ return { namedScopes:namedNoteScopes(fr,requestedNoteSection).map(function(el){return {descriptor:namedSectionDescriptor(el),keys:namedKeysForElement(el),editors:editorsIn(el,fr).map(function(editor){return {id:editor.id,keys:namedKeysForElement(editor),conflict:namedVisibleConflict(editor,requestedNoteSection)};})};}), allSections:deepQueryAll(fr.doc,'section').map(function(el){return {testid:el.getAttribute('data-testid'),descriptor:namedSectionDescriptor(el),keys:namedKeysForElement(el),conflict:namedVisibleConflict(el,requestedNoteSection)};}) }; }) }`;
  const source = driverSource.slice(0, start) + replacement + driverSource.slice(end);
  return page.evaluate(async ({ driver, requestValue }) => (0, eval)(`(${driver})`)(requestValue), { driver: source, requestValue: req });
}

async function state(page) {
  return page.evaluate(() => {
    const ids = ['generic-note', 'hpi-editor', 'ros-editor', 'exam-editor', 'procedure-editor', 'procedure-editor-2', 'assessment-editor', 'plan-editor'];
    return {
      values: Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.value || ''])),
      clicks: window.__clicks.slice()
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let checks = 0;
  try {
    await withPage(browser, fixture(), async page => {
      const text = 'PREOPERATIVE DIAGNOSIS:\nDocumented synthetic diagnosis.\n\nPROCEDURE:\nDocumented synthetic procedure completed without an invented finding.';
      const result = await drive(page, request('procedure', text));
      if (result.ok !== true) result.debug = await diagnose(page, request('procedure', text));
      assert.strictEqual(result.ok, true, `exact Procedure Documentation write was refused: ${JSON.stringify(result)}`);
      assert.strictEqual(result.reason, 'exact-note-editor-verified-unsaved');
      assert.strictEqual(result.results[0].key, 'procedure');
      assert.strictEqual(result.results[0].verified, true);
      assert.strictEqual(result.saved, false);
      assert.strictEqual(result.persisted, false);
      assert.strictEqual(result.signed, false);
      const got = await state(page);
      assert.strictEqual(got.values['procedure-editor'], text, 'completed op note did not land byte-exact in Procedure Documentation');
      for (const [id, value] of Object.entries(got.values)) if (id !== 'procedure-editor') assert.strictEqual(value, '', `procedure note leaked into ${id}`);
      assert.deepStrictEqual(got.clicks, [], 'procedure placement clicked Save, Sign, Order, navigation, or another control');
      checks += 16;
    });

    await withPage(browser, fixture(), async page => {
      const text = 'Documented synthetic examination.';
      const result = await drive(page, request('exam', text));
      assert.strictEqual(result.ok, true, `Exam stopped resolving when Procedure Documentation was present: ${JSON.stringify(result)}`);
      const got = await state(page);
      assert.strictEqual(got.values['exam-editor'], text);
      assert.strictEqual(got.values['procedure-editor'], '', 'Exam write leaked into Procedure Documentation');
      assert.strictEqual(got.values['generic-note'], '', 'Exam write fell back to generic note');
      assert.deepStrictEqual(got.clicks, []);
      checks += 5;
    });

    for (const options of [{ missing: true }, { duplicate: true }, { twoEditors: true }]) {
      await withPage(browser, fixture(options), async page => {
        const result = await drive(page, request('procedure', 'Ambiguous or missing Procedure Documentation must refuse.'));
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.reason, 'context-unverified');
        const got = await state(page);
        assert(Object.values(got.values).every(value => value === ''), 'a refused procedure destination mutated a note field');
        assert.deepStrictEqual(got.clicks, []);
        checks += 4;
      });
    }

    await withPage(browser, fixture({ initial: 'Existing different procedure text.' }), async page => {
      const result = await drive(page, request('procedure', 'Replacement text must not overwrite.'));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'note-editor-not-empty');
      assert.strictEqual(result.attempted, false);
      const got = await state(page);
      assert.strictEqual(got.values['procedure-editor'], 'Existing different procedure text.');
      assert.strictEqual(got.values['generic-note'], '');
      assert.deepStrictEqual(got.clicks, []);
      checks += 6;
    });

    await withPage(browser, fixture({ initial: 'Exact prefilled Procedure Documentation.' }), async page => {
      const text = 'Exact prefilled Procedure Documentation.';
      const result = await drive(page, request('procedure', text));
      assert.strictEqual(result.ok, false, 'exact-prefilled Procedure Documentation was treated as a successful no-op write');
      assert.strictEqual(result.blocked, true);
      assert.strictEqual(result.reason, 'note-editor-not-empty');
      assert.strictEqual(result.attempted, false);
      assert.strictEqual(result.written, false);
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.noteWriteProof, undefined, 'exact-prefilled Procedure Documentation received a proof without mutation');
      assert.strictEqual(result.results[0].attempted, false);
      const got = await state(page);
      assert.strictEqual(got.values['procedure-editor'], text);
      for (const [id, value] of Object.entries(got.values)) if (id !== 'procedure-editor') assert.strictEqual(value, '', `exact-prefilled Procedure Documentation leaked into ${id}`);
      assert.deepStrictEqual(got.clicks, []);
      checks += 17;
    });

    await withPage(browser, fixture(), async page => {
      const mismatch = await drive(page, request('procedure', 'Destination mismatch.', { sections: [
        { key: 'procedure', text: 'Destination mismatch.', execute: true, destination: 'Athena encounter > Physical Exam' }
      ] }));
      assert.strictEqual(mismatch.ok, false);
      assert.strictEqual(mismatch.reason, 'note-destination-mismatch');
      const multiple = await drive(page, request('procedure', 'One', { sections: [
        { key: 'procedure', text: 'One', execute: true, destination },
        { key: 'exam', text: 'Two', execute: true, destination: 'Athena encounter > Physical Exam' }
      ] }));
      assert.strictEqual(multiple.ok, false);
      assert.strictEqual(multiple.reason, 'note-section-count-mismatch');
      const got = await state(page);
      assert(Object.values(got.values).every(value => value === ''), 'a mismatched/multi-destination request mutated a note field');
      assert.deepStrictEqual(got.clicks, []);
      checks += 6;
    });
  } finally {
    await browser.close();
  }
  console.log(`PASS Athena Procedure Documentation placement runtime: ${checks} checks; exact already-open editor only, ambiguity/missing/nonempty refuse, Exam and generic remain isolated, no click/save/sign/order/template creation`);
})().catch(error => { console.error(error); process.exit(1); });
