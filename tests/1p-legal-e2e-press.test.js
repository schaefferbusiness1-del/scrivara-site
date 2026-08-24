'use strict';

/* =========================================================================
   1p Legal / IME workspace - THE WHOLE FLOW, DRIVEN, IN A REAL BROWSER.

   The owner's father produces a narrative / IME report this week. Every
   other Legal suite in this repo drives the module through a hand-built DOM
   in a vm, which is fast and exact about logic but cannot answer the two
   questions that matter to him: does the flow WORK from the Tools menu to a
   Word file, and does every control in the room do something.

   So this one boots the real /1p shell in headless Chrome, seeds a synthetic
   chart, opens the workspace THE WAY HE WILL (the dock Tools menu row), and
   presses every control in it:

     bind -> pick the report -> compile the chronology -> generate ->
     Copy / Download .txt / Download for Word / Print

   THREE DEFECTS THIS SUITE WAS WRITTEN AGAINST, all measured at HEAD in this
   same harness before they were fixed:

     1. FIVE chronology rows read "Dec 31, 1969" (p1-legal-undated-1.0.0).
     2. Pressing "Pull a day of the schedule" with no EMR tab held the room
        for 90,058 ms with Compile, Generate and the file drop all disabled
        and no control that would let go - then claimed the read "finished
        ... refreshed" for a read that brought back nothing
        (p1-legal-readstop-1.0.0).
     3. Sixteen buttons at 38px against the app's own 40px floor, at every
        one of the five widths (p1-legal-taps-1.0.0).

   NOTHING LEAVES THIS PAGE. Synthetic names only; no login; the clipboard,
   the download anchor, window.open and the AI call are all replaced with
   local recorders, so "the export ran" is a measured receipt rather than a
   real exit. The one thing deliberately NOT relaxed is the workspace's own
   clinical-access gate: the harness supplies a signed-in clinical user the
   way the app does (the shell's own `bkUser` binding) and nothing else.
   ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function deep(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); checks++; }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected into the page. Synthetic names only. */
function harness() {
  /* The exits, replaced by recorders. Nothing is written, copied, downloaded,
     printed or sent; each one only records that the control reached it. */
  window.__lg = { calls: [], lastBlob: null, lastCopy: '', lastPrint: '' };
  const C = window.__lg.calls;
  try {
    navigator.clipboard.writeText = function (t) {
      C.push({ k: 'clipboard', n: String(t).length }); window.__lg.lastCopy = String(t); return Promise.resolve();
    };
  } catch (e) { C.push({ k: 'clipboard-stub-failed' }); }
  const realCreate = URL.createObjectURL;
  URL.createObjectURL = function (b) { C.push({ k: 'blob', type: b && b.type, size: b && b.size }); window.__lg.lastBlob = b; return realCreate.call(URL, b); };
  const realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { C.push({ k: 'download', name: this.download }); return; }
    return realClick.call(this);
  };
  window.open = function () {
    C.push({ k: 'window.open' });
    const doc = { _html: '', write(h) { doc._html += h; }, close() {}, title: '' };
    return { document: doc, focus() {}, print() { C.push({ k: 'print', chars: doc._html.length }); window.__lg.lastPrint = doc._html; }, close() {} };
  };
  /* The configured MLS AI path, answered locally. Derive the one whole-report
     JSON receipt from the request itself so this browser press follows the
     same exact section/order boundary as production. */
  window.aiCallRaw = function (sys, user, key, opts) {
    const marker = 'Expected sections: ', allow = '. Evidence-ID allowlist: ';
    const start = String(sys || '').indexOf(marker), end = String(sys || '').indexOf(allow, start + marker.length);
    const specs = start >= 0 && end > start ? JSON.parse(String(sys).slice(start + marker.length, end)) : [];
    const evidenceIds = start >= 0 && end > start ? JSON.parse(String(sys).slice(end + allow.length, String(sys).indexOf('.', end + allow.length))) : [];
    const narrative = opts && opts.draftSubtype === 'narrative_medical_report';
    const encounter = /\[(E\d+)\]\s+(\d{4}-\d{2}-\d{2})\s+·\s+([^·]+?)\s+·\s+[^\n]+/.exec(String(user || ''));
    const encounterId = encounter && evidenceIds.includes(encounter[1]) ? encounter[1] : evidenceIds.find((id) => /^E/.test(id));
    const missing = (label, detail) => ({
      text: label + ': Undeterminable on the record reviewed because ' + detail + '.', evidenceIds: []
    });
    C.push({ k: 'ai', sections: specs.map((spec) => spec.heading) });
    return Promise.resolve(JSON.stringify({ sections: specs.map((spec, index) => ({
      heading: spec.heading,
      paragraphs: narrative && spec.heading === 'SUMMARY OF OPINIONS'
        ? [missing('Causation', 'the mechanism and chronology'), missing('Neuropathy', 'objective neurologic testing or a formally documented diagnosis'), { text: 'Permanent and Stationary / Maximum Medical Improvement: Not formally established because the latest condition and pending care are not documented.', evidenceIds: [] }, missing('Future Care', 'the records do not establish a documented recommendation, schedule, or trigger')]
        : narrative && spec.heading === 'MEDICAL OPINIONS'
          ? [missing('Causation', 'the mechanism and chronology in the detailed analysis'), missing('Neuropathy', 'objective neurologic testing or a formally documented diagnosis for this issue'), { text: 'Permanent and Stationary / Maximum Medical Improvement: Not formally established because the latest condition and pending care remain undocumented in the detailed review.', evidenceIds: [] }]
        : narrative && spec.heading === 'HISTORY AND COURSE OF TREATMENT' && encounterId
            ? [{ text: encounter[2] + ' - ' + encounter[3].trim() + ': History: Not documented in the records reviewed. Pertinent Examination: Not documented in the records reviewed. Assessment and Plan: Not documented in the records reviewed.', evidenceIds: [encounterId] }]
            : [{ text: 'The records reviewed do not document sufficient evidence for requested item ' + (index + 1) + '; clinician verification is required.', evidenceIds: [] }]
    })) }));
  };
  window.getKey = function () { return 'synthetic-local-key'; };

  window.__lgApi = {
    q(sel) { const h = document.getElementById('mlsP1LegalRoot'); return h ? h.querySelector(sel) : null; },
    press(sel) {
      const el = window.__lgApi.q(sel);
      if (!el) return { sel, missing: true };
      const before = window.__lg.calls.length;
      /* Read `disabled` BEFORE the press, never after: Generate disables
         itself synchronously the moment a run starts, so an after-read
         reports a working control as a dead one. */
      const disabled = !!el.disabled;
      let err = '';
      try { el.click(); } catch (e) { err = String(e && e.message); }
      return { sel, missing: false, disabled, disabledAfter: !!el.disabled, err,
        calls: window.__lg.calls.slice(before),
        status: ((document.getElementById('mlsP1LegalStatus') || {}).textContent || '') };
    },
    gates() {
      const d = (id) => { const n = document.getElementById(id); return n ? !!n.disabled : null; };
      return { compile: d('mlsP1LegalCompile'), generate: d('mlsP1LegalGenerate'), drop: d('mlsP1LegalDrop'),
        stop: !!document.getElementById('mlsP1LegalReadStop'),
        reading: window.__mlsP1LegalPack.state().reading };
    },
    /* every control in the room, with the size it really renders at */
    controls() {
      const h = document.getElementById('mlsP1LegalRoot');
      if (!h) return [];
      return [].map.call(h.querySelectorAll('button,input,textarea,select,summary'), (el) => {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        return { tag: el.tagName, id: el.id || '', cls: String(el.className || '').split(' ')[0],
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44),
          disabled: !!el.disabled,
          onscreen: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden',
          short: Math.round(Math.min(r.width, r.height)) };
      });
    },
    tinyTaps() {
      return window.__lgApi.controls()
        .filter((c) => c.tag === 'BUTTON' && c.onscreen && c.short < 40)
        .map((c) => c.text + ':' + c.short);
    },
    overflow() { return document.documentElement.scrollWidth - window.innerWidth; },
    draft() { return (document.getElementById('mlsP1LegalDraft') || {}).value || ''; },
    chronRows() {
      const n = document.getElementById('mlsP1LegalChronology');
      return n ? [].map.call(n.querySelectorAll('.p1l-rowhead span:first-child'), (s) => s.textContent.trim()) : [];
    },
    expandAll() { ['report', 'chronology', 'records', 'generate', 'draft'].forEach((k) => { try { window.__mlsP1LegalPack.toggleCard(k, true); } catch (e) {} }); }
  };
  return true;
}

function seed() {
  /* One chart, shaped like a real medical-legal request: a mechanism, imaging,
     a procedure, an outside record with NO date, a note whose only stamp is a
     bogus tiny number, a note with no date of any kind, and one encounter body
     carrying EMR page furniture so "Show raw" has something to show. */
  const JUNK = 'REFRESH CHART\nrecently edited this chart at . Refresh to view the most current information.\n' +
    'ASSESSMENT: Lumbar radiculopathy, left L5 - junk-carrying row.';
  const P = [{
    id: 'lg-1', name: 'Ada Sample', dob: '1962-03-04', mrn: 'MRN900001',
    problems: 'M54.16 Lumbar radiculopathy',
    visits: [
      { id: 'v1', date: '2026-02-11', type: 'Office visit', provider: 'M Sample, DO', source: 'athena-copy',
        detail: 'SUBJECTIVE: Low back pain since a collision on 01-20-2026.\nASSESSMENT: Lumbar radiculopathy, left L5.\nPLAN: Physical therapy. Follow-up in 4 weeks.' },
      { id: 'v2', date: '2026-03-15', type: 'Lumbar MRI', provider: 'R Reader, MD', source: 'athena-copy',
        detail: 'IMPRESSION: L4-L5 disc protrusion with left lateral recess stenosis.' },
      { id: 'v3', date: '2026-04-20', type: 'Transforaminal epidural steroid injection', provider: 'M Sample, DO', source: 'athena-copy',
        detail: 'PROCEDURE PERFORMED: Left L5 transforaminal epidural steroid injection. Tolerated well.' },
      { id: 'v4', type: 'Outside hospital records', source: 'athena-copy', detail: 'Emergency department records; no date stored.' },
      { id: 'v5', date: '2026-06-01', type: 'Office visit', provider: 'M Sample, DO', source: 'athena-copy', detail: JUNK }
    ],
    docs: [{ name: 'ED records 01-20-2026.pdf', date: '2026-01-20', text: 'Emergency department note. Lumbar strain.' }]
  }, { id: 'lg-2', name: 'Bea Sample', dob: '1970-01-02', mrn: 'MRN900002', visits: [] }];
  const N = [
    { id: 'n1', patientId: 'lg-1', date: '2026-05-18', cc: 'Follow-up', signed: true, provider: 'M Sample, DO', updated: 5,
      soap: 'SUBJECTIVE: 50% relief after the injection.\nASSESSMENT: M54.16 Radiculopathy, lumbar region.\nPLAN: Continue home exercise. Follow-up in 3 months.' },
    { id: 'n2', patientId: 'lg-1', cc: 'No date at all', signed: false, provider: 'M Sample, DO', updated: 0,
      soap: 'ASSESSMENT: An entry with no documented date.' }
  ];
  savePatients(P.map((p) => JSON.parse(JSON.stringify(p))));
  saveNotes(N.slice());
  setActivePtId('lg-1');
  return { patients: getPatients().length, notes: (getNotes() || []).length, active: getActivePtId() };
}

const WIDTHS = [390, 768, 1024, 1280, 1440];
const measured = {};

(async function run() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));

  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'legal-e2e@mlsscribe.test';
      /* `bkUser` is a shell-level `let`, not a window property: the workspace's
         own clinicalAccess() reads the binding, so the harness assigns the
         binding. This is the session the app itself supplies, nothing more -
         the gate is not weakened. */
      bkUser = { role: 'doctor', isAdmin: false, email: 'legal-e2e@mlsscribe.test', name: 'Sample Provider' };
      /* the letterhead the report prints, through the app's own Settings keys */
      const set = (k, v) => { try { localStorage.setItem(uns(k), v); } catch (e) {} };
      set('practiceName', 'Sample Orthopaedic Associates');
      set('providerName', 'Sample Provider');
      set('providerCred', 'MD');
      set('npi', '1234567893');
      set('clinicAddress', '100 Sample Way, Springfield');
      set('clinicPhone', '555-0100');
    });
    await page.evaluate(harness);
    measured.seed = await page.evaluate(seed);
    eq(measured.seed.patients, 2, 'the synthetic roster did not save');
    eq(measured.seed.active, 'lg-1', 'the synthetic patient was not made active');

    /* --------------------------------------------------------------------
       1. THE WAY IN. The dock's Tools menu, pressed, and the row that names
          this workspace opens this workspace and closes the menu behind it.
       -------------------------------------------------------------------- */
    await page.evaluate(() => { try { window.__mlsP1CalmDock.ensure(); } catch (e) {} });
    await page.waitForFunction(() => !!document.getElementById('mlsDock'), null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const d = document.getElementById('mlsDock');
      const b = d && [].find.call(d.querySelectorAll('button,[role="button"]'),
        (x) => /tool/i.test((x.textContent || '') + ' ' + (x.id || '')));
      if (b) b.click();
    });
    await page.waitForTimeout(1200);
    measured.toolsRow = await page.evaluate(() => {
      const m = document.getElementById('mlsToolsMenu');
      if (!m) return { menu: false };
      const rows = [].map.call(m.querySelectorAll('.r'), (r) => ({
        name: ((r.querySelector('.rn') || {}).textContent || '').trim(),
        tip: r.getAttribute('data-tip') || '',
        legal: !!r.getAttribute('data-mls-legal-tools')
      }));
      const legal = rows.filter((r) => r.legal);
      const names = rows.map((r) => r.name);
      return { menu: true, count: rows.length, legal, untipped: names.filter((n, i) => !rows[i].tip),
        duplicates: names.filter((n, i) => names.indexOf(n) !== i) };
    });
    ok(measured.toolsRow.menu, 'the dock Tools button did not open the Tools menu');
    eq(measured.toolsRow.legal.length, 1,
      'the Tools menu carries ' + measured.toolsRow.legal.length + ' Legal / IME rows, not exactly one');
    eq(measured.toolsRow.legal[0].name, 'Legal / IME workspace', 'the Legal row is not named for what it opens');
    ok(measured.toolsRow.legal[0].tip.length > 10,
      'the Legal row has no hover explainer: ' + JSON.stringify(measured.toolsRow.legal[0].tip));
    deep(measured.toolsRow.duplicates, [], 'the Tools menu lists the same entry twice');
    /* Every row a doctor can hover explains itself. A row added later without
       one fails here: give it a line in the tools-tips-1.0.0 BY_TEXT table in
       BOTH /1p shells, keyed on the row's words in lower case, and claim only
       what its handler actually does. */
    deep(measured.toolsRow.untipped, [],
      'Tools entries ship with no hover explainer (add them to tools-tips-1.0.0 BY_TEXT in both /1p shells): ' +
      JSON.stringify(measured.toolsRow.untipped));

    measured.viaRow = await page.evaluate(() => {
      const row = document.querySelector('#mlsToolsMenu [data-mls-legal-tools]');
      if (!row) return { row: false };
      row.click();
      return { row: true, menuClosed: !document.getElementById('mlsToolsMenu'),
        opened: !!document.getElementById('mlsP1LegalRoot') };
    });
    ok(measured.viaRow.opened, 'pressing the Tools row did not open the Legal workspace');
    ok(measured.viaRow.menuClosed, 'the Tools menu stayed open behind the workspace');

    await page.evaluate(() => window.__lgApi.expandAll());
    await page.waitForTimeout(300);

    /* --------------------------------------------------------------------
       2. EVERY CONTROL IN THE ROOM IS PRESSABLE, NAMED, AND BIG ENOUGH.
       -------------------------------------------------------------------- */
    measured.controls = await page.evaluate(() => window.__lgApi.controls());
    const unnamed = measured.controls.filter((c) => c.tag === 'BUTTON' && c.onscreen && !c.text);
    deep(unnamed.map((c) => c.id || c.cls), [], 'a visible button in the workspace carries no words');
    ok(measured.controls.length > 30,
      'only ' + measured.controls.length + ' controls found - the workspace did not render');

    /* --------------------------------------------------------------------
       3. THE EMR READ IS ESCAPABLE, AND ITS RECEIPT IS MEASURED.
          At HEAD this press cost 90 seconds of a dead workspace.
       -------------------------------------------------------------------- */
    measured.readBefore = await page.evaluate(() => window.__lgApi.gates());
    eq(measured.readBefore.reading, '', 'a read was already running before one was started');
    await page.evaluate(() => window.__lgApi.press('[data-read-op="day"]'));
    await page.waitForTimeout(500);
    measured.reading = await page.evaluate(() => window.__lgApi.gates());
    eq(measured.reading.reading, 'day', 'pressing the day read did not start a read');
    ok(measured.reading.stop, 'a running read renders no "Stop the read" control - the room is wedged until the reader answers');
    eq(measured.reading.compile, true, 'Compile stayed live during a read');

    const stopped = await page.evaluate(() => window.__lgApi.press('#mlsP1LegalReadStop'));
    eq(stopped.missing, false, 'the Stop control could not be pressed');
    measured.afterStop = await page.evaluate(() => window.__lgApi.gates());
    eq(measured.afterStop.reading, '', 'Stop the read did not release the read slot');
    eq(measured.afterStop.compile, false, 'Compile stayed disabled after the read was stopped');
    eq(measured.afterStop.drop, false, 'the local-file drop stayed disabled after the read was stopped');
    ok(/was stopped/.test(stopped.status), 'stopping the read said nothing: ' + JSON.stringify(stopped.status.slice(0, 80)));

    /* The abandoned read really does come back - the measured hang was 90 s -
       and when it does it must own nothing. Waiting it out is the only honest
       way to prove that, so this suite waits. */
    measured.stoppedStatus = stopped.status;
    await page.waitForTimeout(100000);
    measured.after100s = await page.evaluate(() => ({
      gates: window.__lgApi.gates(),
      status: (document.getElementById('mlsP1LegalStatus') || {}).textContent || ''
    }));
    eq(measured.after100s.gates.reading, '', 'the abandoned read re-took the room when it finally answered');
    eq(measured.after100s.gates.generate === true && measured.after100s.gates.compile === true, false,
      'the abandoned read re-disabled the room when it finally answered');
    eq(measured.after100s.status, measured.stoppedStatus,
      'the abandoned read wrote a receipt over the room it was let go of: ' + JSON.stringify(measured.after100s.status.slice(0, 120)));

    /* A chart re-read with no EMR reachable must say what it actually got. */
    await page.evaluate(() => window.__mlsP1LegalPack.runReadOp('chart', {}));
    await page.waitForTimeout(1500);
    measured.chartReceipt = await page.evaluate(() => (document.getElementById('mlsP1LegalStatus') || {}).textContent || '');
    ok(/documented entries/.test(measured.chartReceipt),
      'a chart read did not report a measured entry count: ' + JSON.stringify(measured.chartReceipt.slice(0, 120)));
    ok(/nothing was faked/i.test(measured.chartReceipt),
      'a chart read that got nothing did not say so: ' + JSON.stringify(measured.chartReceipt.slice(0, 160)));
    ok(!/list above was refreshed/.test(measured.chartReceipt), 'a barren read still claims a refresh');

    /* --------------------------------------------------------------------
       4. THE CHRONOLOGY. Compiled, exported three ways, and NEVER 1969.
       -------------------------------------------------------------------- */
    const compiled = await page.evaluate(() => window.__lgApi.press('#mlsP1LegalCompile'));
    ok(/compiled from \d+ documented entries/.test(compiled.status),
      'Compile history did not report what it compiled: ' + JSON.stringify(compiled.status.slice(0, 90)));
    measured.chronRows = await page.evaluate(() => window.__lgApi.chronRows());
    ok(measured.chronRows.length >= 10, 'the chronology rendered only ' + measured.chronRows.length + ' rows');
    deep(measured.chronRows.filter((r) => /1969|1970/.test(r)), [],
      'an epoch date reached the rendered chronology');
    ok(measured.chronRows.some((r) => /^Undated/.test(r)),
      'no row says "Undated" - the undated entries were dropped or given a date they do not have');
    ok(measured.chronRows.some((r) => /May 18, 2026/.test(r)),
      'a note carrying its own documented service date was not dated by it');

    for (const [sel, kind] of [['#mlsP1LegalChronCopy', 'clipboard'], ['#mlsP1LegalChronDownload', 'download'], ['#mlsP1LegalChronPrint', 'window.open']]) {
      const r = await page.evaluate((s) => window.__lgApi.press(s), sel);
      eq(r.missing, false, sel + ' is not in the room');
      eq(r.disabled, false, sel + ' was disabled on a compiled chronology');
      ok(r.calls.some((c) => c.k === kind), sel + ' did not reach its exit: ' + JSON.stringify(r.calls));
      await page.waitForTimeout(150);
    }
    measured.chronCopy = await page.evaluate(() => window.__lg.lastCopy);
    ok(!/1969|1970-01-0/.test(measured.chronCopy), 'an epoch date reached the exported chronology');
    ok(/READ-ONLY MEDICAL-LEGAL CHRONOLOGY/.test(measured.chronCopy), 'the exported chronology lost its heading');
    ok(/Ada Sample/.test(measured.chronCopy), 'the exported chronology is not bound to a named patient');

    /* Show raw returns the exact stored bytes on the junk-carrying row. */
    const raw = await page.evaluate(() => window.__lgApi.press('.p1l-raw'));
    eq(raw.missing, false, 'no "Show raw" control on a cleaned row');
    measured.rawShown = await page.evaluate(() => /REFRESH CHART/.test((document.getElementById('mlsP1LegalChronology') || {}).innerHTML || ''));
    ok(measured.rawShown, 'Show raw did not bring the exact stored text back');
    await page.evaluate(() => window.__lgApi.press('.p1l-raw'));

    /* --------------------------------------------------------------------
       5. PICK EVERY REPORT TYPE, GENERATE THE TARGET-FORM NARRATIVE, THEN
          generate the IME. The narrative used to be selected here but never
          actually exercised; keep both report paths measured.
       -------------------------------------------------------------------- */
    measured.reportTypes = {};
    for (const key of ['narrative', 'records', 'chronology', 'ime']) {
      const r = await page.evaluate((k) => window.__lgApi.press('#mlsP1LegalReport_' + k), key);
      eq(r.missing, false, 'the ' + key + ' report type is not offered');
      ok(/^Report type: /.test(r.status), 'picking ' + key + ' said nothing: ' + JSON.stringify(r.status.slice(0, 60)));
      measured.reportTypes[key] = r.status.slice(0, 60);
    }
    await page.evaluate(() => {
      document.getElementById('mlsP1LegalDoi').value = '2026-01-20';
      document.getElementById('mlsP1LegalQuestions').value = 'Is the lumbar radiculopathy causally related to the collision of 01-20-2026?';
      document.getElementById('mlsP1LegalLetterheadEmail').value = 'office@sample.test';
    });
    await page.evaluate(() => window.__lgApi.press('#mlsP1LegalReport_narrative'));
    const narrativeGen = await page.evaluate(() => window.__lgApi.press('#mlsP1LegalGenerate'));
    eq(narrativeGen.disabled, false, 'the dedicated narrative Generate was disabled after selecting narrative');
    await page.waitForFunction(() => (document.getElementById('mlsP1LegalDraft') || {}).value, null, { timeout: 90000 });
    await page.waitForTimeout(300);
    measured.narrativeDraft = await page.evaluate(() => window.__lgApi.draft());
    ok(/^NARRATIVE MEDICAL REPORT$/m.test(measured.narrativeDraft), 'the browser flow did not produce a narrative report');
    ok(/^To Whom It May Concern:$/m.test(measured.narrativeDraft), 'the browser narrative omitted its deterministic addressee');
    ok(/^HISTORY AND COURSE OF LUMBAR TREATMENT$/m.test(measured.narrativeDraft), 'the browser narrative did not derive the lumbar history heading');
    ['Causation:', 'Neuropathy:', 'Permanent and Stationary / Maximum Medical Improvement:', 'Future Care:', 'History:', 'Pertinent Examination:', 'Assessment and Plan:']
      .forEach((label) => ok(measured.narrativeDraft.indexOf(label) >= 0, 'the browser narrative omitted ' + label));
    ok(/This is an unsigned draft for clinician review\. It does not constitute a final medical-legal opinion unless verified, adopted, and signed by/.test(measured.narrativeDraft),
      'the browser narrative omitted the deterministic unsigned-provider guard');
    /* Return to the IME type for the existing export and counsel-order proof. */
    await page.evaluate(() => window.__lgApi.press('#mlsP1LegalReport_ime'));
    const gen = await page.evaluate(() => window.__lgApi.press('#mlsP1LegalGenerate'));
    eq(gen.disabled, false, 'Generate was disabled on a bound patient with a report type picked');
    eq(gen.disabledAfter, true, 'Generate stayed pressable while its own run was starting');
    await page.waitForFunction(() => (document.getElementById('mlsP1LegalDraft') || {}).value, null, { timeout: 90000 });
    await page.waitForTimeout(600);
    measured.draft = await page.evaluate(() => window.__lgApi.draft());
    ok(measured.draft.length > 800, 'the draft is only ' + measured.draft.length + ' characters');

    /* The sections the father's report is judged on, and the pinned guards. */
    const REQUIRED = [
      'X. CAUSATION ANALYSIS', 'XI. MEDICAL NECESSITY OF CARE', 'XII. FUTURE TREATMENT',
      'XIV. OPINIONS', 'XV. ATTESTATION', 'XIII-A. ANSWERS TO THE QUESTIONS ASKED',
      'to a reasonable degree of medical certainty', 'UNSIGNED DRAFT',
      'Sample Orthopaedic Associates', 'Sample Provider, MD', 'NPI 1234567893',
      '100 Sample Way, Springfield', 'office@sample.test'
    ];
    measured.missingFromDraft = REQUIRED.filter((n) => measured.draft.indexOf(n) < 0);
    deep(measured.missingFromDraft, [], 'the generated report is missing pinned content');
    ok(!/1969|1970-01-0/.test(measured.draft), 'an epoch date reached the generated report');
    measured.sectionOrder = (measured.draft.match(/^[IVX]+(?:-A)?\. [A-Z][A-Z ,/&]+$/gm) || []);
    ok(measured.sectionOrder.indexOf('X. CAUSATION ANALYSIS') < measured.sectionOrder.indexOf('XIV. OPINIONS'),
      'the report sections are out of order: ' + JSON.stringify(measured.sectionOrder));
    /* p1-legal-counsel-order-1.0.0: the numbered heads must read in their own
       numbered order. Measured before the fix: XIII, XIV, XIII-A, XV. */
    eq(measured.sectionOrder.indexOf('XIII-A. ANSWERS TO THE QUESTIONS ASKED'),
      measured.sectionOrder.indexOf('XIII. SUMMARY AND CONCLUSION') + 1,
      'XIII-A does not follow XIII in the generated report: ' + JSON.stringify(measured.sectionOrder));
    eq(measured.sectionOrder[measured.sectionOrder.length - 1], 'XV. ATTESTATION',
      'the report does not end on the attestation: ' + JSON.stringify(measured.sectionOrder.slice(-3)));

    /* --------------------------------------------------------------------
       6. THE FOUR EXITS, including Download for Word (wdoc-1.0.0).
       -------------------------------------------------------------------- */
    measured.exports = {};
    for (const [sel, kind] of [['#mlsP1LegalDraftCopy', 'clipboard'], ['#mlsP1LegalDraftDownload', 'download'],
      ['#mlsP1LegalDraftWord', 'download'], ['#mlsP1LegalDraftPrint', 'window.open']]) {
      const r = await page.evaluate((s) => window.__lgApi.press(s), sel);
      eq(r.missing, false, sel + ' is not in the room');
      eq(r.disabled, false, sel + ' was disabled on a generated draft');
      ok(r.calls.some((c) => c.k === kind), sel + ' did not reach its exit: ' + JSON.stringify(r.calls));
      measured.exports[sel] = r.calls;
      await page.waitForTimeout(200);
    }
    /* The Word file, read back byte for byte. */
    await page.evaluate(() => window.__lgApi.press('#mlsP1LegalDraftWord'));
    await page.waitForTimeout(200);
    measured.word = await page.evaluate(async () => {
      const b = window.__lg.lastBlob;
      if (!b) return null;
      const bytes = new Uint8Array(await b.arrayBuffer());
      const text = new TextDecoder('utf-8').decode(bytes);
      return { type: b.type, bytes: bytes.length, bom: [bytes[0], bytes[1], bytes[2]].join(','),
        wordNs: text.indexOf('urn:schemas-microsoft-com:office:word') >= 0,
        boldHeads: (text.match(/font-weight:bold[^>]*>([^<]{3,60})</g) || []).map((s) => s.replace(/.*>/, '')),
        certainty: text.indexOf('to a reasonable degree of medical certainty') >= 0,
        epoch: /1969|1970-01-0/.test(text),
        unescapedAngle: /<(?!\/?(?:html|head|meta|title|body|p)\b)/.test(text) };
    });
    ok(measured.word, 'Download for Word produced no file');
    eq(measured.word.type, 'application/msword', 'the Word download is not served as a Word document');
    eq(measured.word.bom, '239,187,191', 'the Word download has no UTF-8 BOM - Word will mis-read its accents');
    ok(measured.word.wordNs, 'the Word download carries no Word namespace');
    ok(measured.word.certainty, 'the certainty standard did not survive into the Word download');
    ok(!measured.word.epoch, 'an epoch date reached the Word download');
    ok(!measured.word.unescapedAngle, 'the Word download carries unescaped markup from the draft text');
    ok(measured.word.boldHeads.some((h) => /CAUSATION ANALYSIS/.test(h)),
      'the IME section heads are not bold in the Word download: ' + JSON.stringify(measured.word.boldHeads.slice(0, 6)));

    /* --------------------------------------------------------------------
       7. THE LETTERHEAD REFUSES IN BRACKETS RATHER THAN GUESSING.
       -------------------------------------------------------------------- */
    measured.refusal = await page.evaluate(() => {
      ['practiceName', 'providerName', 'providerCred', 'npi', 'clinicAddress', 'clinicPhone']
        .forEach((k) => { try { localStorage.removeItem(uns(k)); } catch (e) {} });
      const block = window.__mlsP1LegalPack.letterheadBlock();
      const att = window.__mlsP1LegalPack.attestationBlock();
      return { block, bracketed: (block.match(/\[[^\]]+\]/g) || []).length,
        certainty: att.indexOf('to a reasonable degree of medical certainty') >= 0,
        signature: /Signature: _{10,}/.test(att) };
    });
    ok(measured.refusal.bracketed >= 3,
      'an unset letterhead field printed as a plausible blank instead of a bracketed refusal');
    ok(/is not configured - set it in Settings/.test(measured.refusal.block),
      'the letterhead refusal does not say where to set the value');
    ok(measured.refusal.certainty, 'the attestation lost the certainty standard');
    ok(measured.refusal.signature, 'the attestation lost its signature line');
    await page.evaluate(() => {
      const set = (k, v) => { try { localStorage.setItem(uns(k), v); } catch (e) {} };
      set('practiceName', 'Sample Orthopaedic Associates'); set('providerName', 'Sample Provider');
      set('providerCred', 'MD'); set('npi', '1234567893');
      set('clinicAddress', '100 Sample Way, Springfield'); set('clinicPhone', '555-0100');
    });

    /* --------------------------------------------------------------------
       8. THE AI DISCLOSURE, VERBATIM, IN THE OPEN.
       -------------------------------------------------------------------- */
    measured.disclosure = await page.evaluate(() => {
      const w = document.querySelector('#mlsP1LegalRoot .p1l-warn');
      return w ? String(w.textContent).replace(/\s+/g, ' ').trim() : '';
    });
    eq(measured.disclosure,
      'AI disclosure: this sends the compiled record context to the existing configured MLS AI path only when you press Generate. ' +
      'It is an unsigned draft, may be incomplete or wrong, and requires clinician verification.',
      'the AI disclosure was reworded or moved behind a fold');

    /* --------------------------------------------------------------------
       9. ALL FIVE WIDTHS: no sideways scroll, no tap target under 40px.
       -------------------------------------------------------------------- */
    measured.widths = {};
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(350);
      const m = await page.evaluate(() => ({ over: window.__lgApi.overflow(), tiny: window.__lgApi.tinyTaps() }));
      measured.widths[w] = m;
      ok(m.over <= 0, 'the workspace scrolls sideways at ' + w + 'px (' + m.over + 'px over)');
      deep(m.tiny, [], 'tap targets under 40px at ' + w + 'px: ' + JSON.stringify(m.tiny));
    }
    await page.setViewportSize({ width: 1366, height: 900 });

    /* --------------------------------------------------------------------
       10. THE LAST CONTROL: Change, and the roster it opens. Kept for the end
           because re-binding is fail-closed and discards the draft above.
       -------------------------------------------------------------------- */
    measured.change = await page.evaluate(() => {
      const before = !!document.getElementById('mlsP1LegalRosterSearch');
      const b = document.getElementById('mlsP1LegalChange');
      if (!b) return { button: false };
      b.click();
      const box = document.getElementById('mlsP1LegalRosterSearch');
      if (box) { box.value = 'Bea'; box.dispatchEvent(new Event('input', { bubbles: true })); }
      const results = document.getElementById('mlsP1LegalRosterResults');
      return { button: true, searchBefore: before, search: !!box,
        placeholder: box ? box.getAttribute('placeholder') : '',
        hits: results ? [].map.call(results.querySelectorAll('[data-bind-id]'), (n) => n.getAttribute('data-bind-id')) : [],
        label: results ? String(results.textContent || '').slice(0, 60) : '' };
    });
    ok(measured.change.button, 'the bound header has no Change control');
    ok(measured.change.search, 'Change opened no way to search this account');
    ok(/Search this account by name, DOB or MRN/.test(measured.change.placeholder),
      'the roster search does not say what it searches: ' + JSON.stringify(measured.change.placeholder));
    deep(measured.change.hits, ['lg-2'],
      'searching the roster for a patient on file returned ' + JSON.stringify(measured.change.hits));
    /* A search that matches nobody must say so rather than show an empty box. */
    measured.noMatch = await page.evaluate(() => {
      const box = document.getElementById('mlsP1LegalRosterSearch');
      box.value = 'Zzzznotapatient'; box.dispatchEvent(new Event('input', { bubbles: true }));
      const results = document.getElementById('mlsP1LegalRosterResults');
      return String((results && results.textContent) || '');
    });
    ok(/No patient in this account matches/.test(measured.noMatch),
      'an empty roster search said nothing: ' + JSON.stringify(measured.noMatch.slice(0, 80)));
    ok(/nothing is guessed/.test(measured.noMatch), 'the empty roster result does not say it guessed nothing');

    /* -------------------------------------------------------------------- */
    deep(pageErrors, [], 'the page threw while the workspace was being driven');
    measured.pageErrors = pageErrors.length;
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('MEASURED ' + JSON.stringify({
    toolsRows: measured.toolsRow.count, legalRow: measured.toolsRow.legal[0].name,
    controls: measured.controls.length,
    readStop: { reading: measured.reading, afterStop: measured.afterStop, after100s: measured.after100s.gates },
    chronRows: measured.chronRows,
    draftChars: measured.draft.length, sections: measured.sectionOrder.length,
    word: measured.word, change: measured.change, widths: measured.widths, pageErrors: measured.pageErrors
  }));
  console.log('PASS 1p-legal-e2e-press: ' + checks + ' checks — the Legal / IME workspace driven end to end in a real ' +
    'browser: opened from the dock Tools row, every control pressed, an EMR read started AND stopped (with the ' +
    'abandoned read proven to own nothing 100 s later), the chronology compiled and exported three ways with no ' +
    'epoch date anywhere, the IME generated with X / XI / XII / XIV, the certainty standard, the letterhead and the ' +
    'counsel section, all four exits reached including a byte-checked Word file, the letterhead refusing in brackets ' +
    'when Settings are empty, the AI disclosure verbatim, and no sideways scroll or sub-40px tap target at ' +
    WIDTHS.join(' / '));
})().catch((error) => { console.error(error && error.stack ? error.stack : error); process.exit(1); });
