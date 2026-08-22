'use strict';

/* Synthetic, PHI-free proof for the active supervised Athena ActionV2 driver.
 * A named section must land only in its exact semantic editor. The fixture
 * deliberately includes a tempting generic encounter-note editor so any
 * fallback is observable. No live Athena tab or account is touched. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function functionSource(source, name) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `${name} is missing`);
  const end = source.indexOf('/* ATHENA_ACTION_V2_DRIVER_END */', start);
  assert(end > start, 'ActionV2 driver end marker is missing');
  return source.slice(start, end).trim();
}

const driverSource = functionSource(background, 'mlsAthenaActionV2DriverFn');
assert((background.match(/sections:\s*noteSections/g) || []).length >= 2, 'probe/execute handler does not carry the frozen named section into the injected driver');
assert(/noteSections\s*=\s*Array\.isArray\(req\.sections\)/.test(driverSource), 'active driver ignores the transported section contract');
assert(/findNamedNoteAction\(fr,\s*action,\s*requestedNoteSection\)\s*:\s*findNoteAction/.test(driverSource), 'named destination is not selected before the generic note path');
const patient = { name: 'Synthetic Section Patient', dob: '03/14/1970', mrn: '700123' };
const context = {
  appointmentId: '8812345', encounterId: '9912345',
  encounterUrl: 'https://athenanet.athenahealth.com/encounter/9912345',
  visitDate: '08/22/2026', provider: 'Synthetic Clinician, MD'
};

const fields = {
  note: 'generic-note', hpi: 'hpi-editor', ros: 'ros-editor',
  exam: 'exam-editor', assessment: 'assessment-editor', plan: 'plan-editor'
};

function fixture(options = {}) {
  const omit = new Set(options.omit || []);
  const duplicate = new Set(options.duplicate || []);
  const combinedAssessmentPlan = options.combinedAssessmentPlan === true;
  const section = (key, label, id) => {
    if (omit.has(key)) return '';
    const one = `<section data-testid="${key}-section" aria-label="${label}"><h2>${label}</h2><textarea id="${id}" data-appointment-id="8812345" aria-label="${label} editor"></textarea></section>`;
    const two = duplicate.has(key) ? `<section data-testid="${key}-section-secondary" aria-label="${label}"><h2>${label}</h2><textarea id="${id}-secondary" data-appointment-id="8812345" aria-label="${label} editor secondary"></textarea></section>` : '';
    return one + two;
  };
  return `<!doctype html><html><head><style>body{font:16px sans-serif}main,section,header,div,textarea{display:block}section{padding:8px;margin:8px}textarea{width:420px;height:80px}</style></head><body>
    <main id="encounter-shell">
      <header data-testid="patient-header" data-patient-name="${patient.name}" data-patient-dob="${patient.dob}" data-patient-mrn="${patient.mrn}">${patient.name}</header>
      <div aria-label="Date of service">08/22/2026</div>
      <div aria-label="Rendering provider">Synthetic Clinician, MD</div>
      <section data-testid="encounter-note-workspace" aria-label="Encounter note workspace"><h2>Encounter note</h2><textarea id="generic-note" data-appointment-id="8812345" aria-label="Visit narrative field"></textarea></section>
      ${section('hpi', 'History of Present Illness', 'hpi-editor')}
      ${section('ros', 'Review of Systems', 'ros-editor')}
      ${section('exam', 'Physical Examination', 'exam-editor')}
      ${combinedAssessmentPlan ? '<section data-testid="assessment-plan-section" aria-label="Assessment and Plan"><h2>Assessment & Plan</h2><textarea id="assessment-plan-editor" data-appointment-id="8812345"></textarea></section>' : section('assessment', 'Assessment', 'assessment-editor') + section('plan', 'Plan', 'plan-editor')}
    </main></body></html>`;
}

function request(key, text, over = {}) {
  return Object.assign({
    mode: 'execute', action: 'write_note', expectedPatient: patient,
    expectedContext: context, noteText: text,
    sections: [{ key, text, execute: true, destination: `Synthetic ${key} destination` }],
    notePolicy: 'empty_only', locked: null
  }, over);
}

async function withPage(browser, html, run) {
  const page = await browser.newPage();
  await page.route('https://athenanet.athenahealth.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto(context.encounterUrl);
  try { return await run(page); } finally { await page.close(); }
}

async function drive(page, req) {
  return page.evaluate(async ({ source, requestValue }) => {
    const fn = (0, eval)(`(${source})`);
    return fn(requestValue);
  }, { source: driverSource, requestValue: req });
}

async function diagnose(page, req) {
  const startNeedle = 'if (candidates.length !== 1) return ';
  const start = driverSource.indexOf(startNeedle);
  const end = driverSource.indexOf(';\n    var hit = candidates[0]', start);
  assert(start >= 0 && end > start, 'driver diagnostic anchor moved');
  const replacement = `if (candidates.length !== 1) return { debug: frames.map(function(fr){ var header=anchoredIdentity(fr), identity=header.identity, named=requestedNoteSection!=='note'?findNamedNoteAction(fr,action,requestedNoteSection):null, generic=findNoteAction(fr,action), root=named&&named.root, metadata=(root&&identity)?encounterMetadataFor(fr,root,identity.root):null, ancestors=[],cur=root,guard=0; while(cur&&guard++<18){ancestors.push({tag:cur.tagName,id:cur.id||'',descriptor:scopeDescriptor(cur),containsIdentity:!!(identity&&deepContains(cur,identity.root)),dates:discoverLabeled(cur,'date'),providers:discoverLabeled(cur,'provider')});cur=parentAcrossRoots(cur);} return {url:fr.url, encounterId:encounterId(fr.url), identityRoots:identityRoots(fr).length, identity:identity&&{name:identity.name,dob:identity.dob,mrn:identity.mrn}, namedScopes:requestedNoteSection!=='note'?namedNoteScopes(fr,requestedNoteSection).map(function(el){return {descriptor:namedSectionDescriptor(el),editors:editorsIn(el,fr).length,id:el.id||''};}):[], namedTarget:!!named, genericTarget:!!generic, appointmentId:(root&&identity)?appointmentIdFor(fr,root,identity.root):'', metadata:metadata&&{visitDate:metadata.visitDate,provider:metadata.provider},ancestors:ancestors }; }) }`;
  const source = driverSource.slice(0, start) + replacement + driverSource.slice(end);
  return page.evaluate(async ({ driver, requestValue }) => (0, eval)(`(${driver})`)(requestValue), { driver: source, requestValue: req });
}

async function values(page) {
  return page.evaluate((map) => Object.fromEntries(Object.entries(map).map(([key, id]) => [key, (document.getElementById(id) || {}).value || ''])), fields);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let checks = 0;
  try {
    for (const [key, expectedField] of [['hpi','hpi'], ['ros','ros'], ['exam','exam'], ['assessment','assessment'], ['plan','plan']]) {
      await withPage(browser, fixture(), async page => {
        const text = `Synthetic ${key} reviewed text.`;
        const result = await drive(page, request(key, text));
        if (result.ok !== true) result.debug = await diagnose(page, request(key, text));
        assert.strictEqual(result.ok, true, `${key} write was refused: ${JSON.stringify(result)}`);
        assert.strictEqual(result.results[0].key, key, `${key} receipt lost its destination`);
        const got = await values(page);
        assert.strictEqual(got[expectedField], text, `${key} did not land in its named editor`);
        for (const [other, value] of Object.entries(got)) if (other !== expectedField) assert.strictEqual(value, '', `${key} leaked into ${other}`);
        checks += 8;
      });
    }

    await withPage(browser, fixture(), async page => {
      const text = 'Synthetic full encounter note.';
      const result = await drive(page, request('note', text));
      assert.strictEqual(result.ok, true, `generic note path regressed: ${JSON.stringify(result)}`);
      const got = await values(page);
      assert.strictEqual(got.note, text, 'generic note missed the encounter-note editor');
      for (const key of ['hpi','ros','exam','assessment','plan']) assert.strictEqual(got[key], '', `generic note leaked into ${key}`);
      checks += 7;
    });

    await withPage(browser, fixture({ omit: ['hpi'] }), async page => {
      const result = await drive(page, request('hpi', 'No HPI target may fall back.'));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'context-unverified');
      assert.strictEqual((await values(page)).note, '', 'missing HPI fell back to generic note');
      checks += 3;
    });

    await withPage(browser, fixture({ duplicate: ['hpi'] }), async page => {
      const result = await drive(page, request('hpi', 'Ambiguous HPI must refuse.'));
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.reason, 'context-unverified');
      assert.deepStrictEqual(await values(page), { note: '', hpi: '', ros: '', exam: '', assessment: '', plan: '' });
      checks += 3;
    });

    await withPage(browser, fixture({ combinedAssessmentPlan: true }), async page => {
      for (const key of ['assessment', 'plan']) {
        const result = await drive(page, request(key, `Combined ${key} must refuse.`));
        assert.strictEqual(result.ok, false);
        assert.strictEqual(result.reason, 'context-unverified');
      }
      assert.strictEqual(await page.locator('#assessment-plan-editor').inputValue(), '');
      assert.strictEqual((await values(page)).note, '');
      checks += 6;
    });

    await withPage(browser, fixture(), async page => {
      const unknown = await drive(page, request('procedure', 'Unknown destination.'));
      assert.strictEqual(unknown.ok, false);
      assert.strictEqual(unknown.reason, 'unknown-note-section');
      const many = await drive(page, request('hpi', 'One', { sections: [
        { key: 'hpi', text: 'One', execute: true }, { key: 'exam', text: 'Two', execute: true }
      ] }));
      assert.strictEqual(many.ok, false);
      assert.strictEqual(many.reason, 'note-section-count-mismatch');
      const hiddenExtra = await drive(page, request('hpi', 'One', { sections: [
        { key: 'hpi', text: 'One', execute: true }, { key: 'procedure', text: 'Hidden extra', execute: false }
      ] }));
      assert.strictEqual(hiddenExtra.ok, false);
      assert.strictEqual(hiddenExtra.reason, 'note-section-count-mismatch');
      const mismatch = await drive(page, request('hpi', 'Displayed text', { noteText: 'Different transport text' }));
      assert.strictEqual(mismatch.ok, false);
      assert.strictEqual(mismatch.reason, 'note-section-payload-mismatch');
      assert.deepStrictEqual(await values(page), { note: '', hpi: '', ros: '', exam: '', assessment: '', plan: '' });
      checks += 9;
    });
  } finally {
    await browser.close();
  }
  console.log(`PASS Athena named-section placement runtime: ${checks} checks; HPI/ROS/Exam/Assessment/Plan exact-only, generic preserved, missing/duplicate/combined/unknown/multi/payload-mismatch all fail closed`);
})().catch(error => { console.error(error); process.exit(1); });
