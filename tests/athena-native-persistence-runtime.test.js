'use strict';

/* PHI-free runtime proof for modern Athena Slate persistence.  The shipped
 * driver must observe Athena's own request, never send one itself, and must
 * refuse an unreadable controlled projection before paste or HTTP activity. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const begin = background.indexOf('async function mlsAthenaActionV2DriverFn(');
const end = background.indexOf('/* ATHENA_ACTION_V2_DRIVER_END */', begin);
assert(begin >= 0 && end > begin, 'active Athena ActionV2 driver is missing');
const rawDriverSource = background.slice(begin, end).trim();
assert(rawDriverSource.includes('nativePersistenceWatch.wait(15000)'), 'native persistence deadline anchor moved');
const driverSource = rawDriverSource.replace('nativePersistenceWatch.wait(15000)', 'nativePersistenceWatch.wait(250)');

const patient = { name: 'Synthetic Persistence Patient', dob: '04/12/1975', mrn: '700777' };
const context = {
  appointmentId: '8812777', encounterId: '9912777',
  encounterUrl: 'https://athenanet.athenahealth.com/one/two/ax/encounter/9912777/exam',
  visitDate: '08/27/2026', provider: 'Synthetic Clinician, MD'
};
const destinations = {
  hpi: 'Athena encounter > HPI', ros: 'Athena encounter > Review of Systems',
  exam: 'Athena encounter > Physical Exam', ap: 'Athena encounter > Assessment & Plan'
};

function request(key, text) {
  return {
    mode: 'execute', action: 'write_note', expectedPatient: patient,
    expectedContext: context, noteText: text,
    sections: [{ key, text, execute: true, destination: destinations[key] }],
    notePolicy: 'empty_only', locked: null
  };
}

function fixture(key, unknownShape) {
  const label = { hpi: 'History of Present Illness', ros: 'Review of Systems', exam: 'Physical Examination', ap: 'Assessment and Plan' }[key];
  const testId = { hpi: 'hpi-section', ros: 'ros-section', exam: 'physical-exam-section', ap: 'assessment-plan-section' }[key];
  const editor = unknownShape
    ? '<div id="target-editor" contenteditable="true" data-slate-editor="true" data-appointment-id="8812777" aria-label="' + label + ' editor"><span data-slate-node="text"><span data-slate-string="true">unreadable existing projection</span></span></div>'
    : '<div id="target-editor" contenteditable="true" data-slate-editor="true" data-appointment-id="8812777" aria-label="' + label + ' editor"><div data-slate-object="block"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-zero-width="z" data-slate-length="0">\uFEFF<br></span></span></span></div></div>';
  return '<!doctype html><html><body><main id="encounter-shell">' +
    '<header data-testid="patient-header" data-patient-name="' + patient.name + '" data-patient-dob="' + patient.dob + '" data-patient-mrn="' + patient.mrn + '">' + patient.name + '</header>' +
    '<div aria-label="Date of service">08/27/2026</div><div aria-label="Rendering provider">Synthetic Clinician, MD</div>' +
    '<section data-testid="encounter-note-workspace" aria-label="Encounter note workspace"><h2>Encounter note</h2><textarea data-appointment-id="8812777" aria-label="Visit narrative field"></textarea></section>' +
    '<section data-testid="' + testId + '" aria-label="' + label + '"><h2>' + label + '</h2>' + editor + '</section>' +
    '</main></body></html>';
}

async function installSlateAndNetwork(page, key, text, variation) {
  await page.evaluate(({ key, text, encounterId, variation }) => {
    const state = window.__nativeProof = { opens: 0, sends: 0, pastes: 0, body: '', url: '', method: '', restored: false };
    const html = value => value.split('\n').map(line => `<div>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`).join('');
    class FakeXHR {
      constructor() { this.listeners = {}; this.status = 0; }
      open(method, url) { this.method = method; this.url = url; state.opens++; }
      addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
      send(body) {
        state.sends++; state.body = String(body || ''); state.url = this.url; state.method = this.method;
        this.responseURL = variation === 'redirect-external' ? 'https://example.invalid/one/two/ax/exam_template/' + encounterId + '/hpi/freetext' : new URL(this.url, location.href).href;
        this.status = variation === 'server-error' ? 503 : 200;
        setTimeout(() => (this.listeners.loadend || []).forEach(fn => fn.call(this)), 20);
      }
    }
    window.XMLHttpRequest = FakeXHR;
    window.fetch = function (input, init) {
      state.sends++; state.method = String(init && init.method || input && input.method || 'GET'); state.url = String(input && input.url || input || '');
      if (input && typeof input.text === 'function') input.text().catch(() => {});
      return Promise.resolve({ status: variation === 'server-error' ? 503 : 200, url: variation === 'redirect-external' ? 'https://example.invalid/one/two/ax/exam_template/' + encounterId + '/hpi/freetext' : state.url });
    };
    const originalOpen = FakeXHR.prototype.open, originalSend = FakeXHR.prototype.send, originalFetch = window.fetch;
    window.__nativeOriginal = { originalOpen, originalSend, originalFetch, FakeXHR };
    const editor = document.getElementById('target-editor');
    function render(value) {
      editor.textContent = '';
      value.split('\n').forEach(line => {
        const block = document.createElement('div'); block.setAttribute('data-slate-object', 'block');
        const leaf = document.createElement('span'); leaf.setAttribute('data-slate-node', 'text');
        const inner = document.createElement('span'); inner.setAttribute('data-slate-leaf', 'true');
        if (line) { const str = document.createElement('span'); str.setAttribute('data-slate-string', 'true'); str.textContent = line; inner.appendChild(str); }
        else { const zero = document.createElement('span'); zero.setAttribute('data-slate-zero-width', 'z'); zero.setAttribute('data-slate-length', '0'); zero.appendChild(document.createTextNode('\uFEFF')); zero.appendChild(document.createElement('br')); inner.appendChild(zero); }
        leaf.appendChild(inner); block.appendChild(leaf); editor.appendChild(block);
      });
    }
    editor.addEventListener('paste', event => { event.preventDefault(); state.pastes++; render(event.clipboardData.getData('text/plain')); if (variation === 'paste-throw') throw new Error('synthetic paste failure'); });
    editor.addEventListener('focusout', () => {
      let method = key === 'ap' ? 'POST' : 'PUT';
      let routeKey = key === 'exam' ? 'pe' : key;
      let url = key === 'ap' ? `/one/two/ax/assessment_and_plan/persistence/assessment` : `/one/two/ax/exam_template/${encounterId}/${routeKey}/freetext`;
      let body = key === 'ap'
        ? JSON.stringify({ assessment: { __CLASS__: 'Synthetic', VersionToken: 'v', CreatedBy: 'synthetic', Note: html(text), CID: 'not-the-encounter' }, clinical_encounter_id: encounterId })
        : JSON.stringify({ freetext: html(text), version_token: 'v', section_refresh_token: 'r', is_document: false, current_findings: '' });
      if (variation === 'wrong-encounter') url = url.replace(encounterId, '9912000');
      if (variation === 'different-origin') url = 'https://example.invalid' + url;
      if (variation === 'wrong-ap-encounter' && key === 'ap') body = JSON.stringify({ assessment: { Note: html(text), CID: encounterId }, clinical_encounter_id: '9912000' });
      if (variation === 'wrong-body') body = key === 'ap' ? JSON.stringify({ assessment: { Note: html('different text'), CID: encounterId }, clinical_encounter_id: encounterId }) : JSON.stringify({ freetext: html('different text') });
      if (variation === 'direct-text-html') body = key === 'ap' ? JSON.stringify({ assessment: { Note: 'outside<div>' + text + '</div>', CID: 'decoy' }, clinical_encounter_id: encounterId }) : JSON.stringify({ freetext: 'outside<div>' + text + '</div>' });
      if (variation === 'nested-block-html') body = key === 'ap' ? JSON.stringify({ assessment: { Note: '<div><div>' + text + '</div></div>', CID: 'decoy' }, clinical_encounter_id: encounterId }) : JSON.stringify({ freetext: '<div><div>' + text + '</div></div>' });
      if (variation === 'fetch-request') {
        const req = new Request(new URL(url, location.href).href, { method, headers: { 'content-type': 'application/json' }, body });
        fetch(req);
      } else {
        const xhr = new XMLHttpRequest(); xhr.open(method, url); xhr.send(body);
      }
      if (variation === 'duplicate') { const second = new XMLHttpRequest(); second.open(method, url); second.send(body); }
    }, { once: true });
  }, { key, text, encounterId: context.encounterId, variation: variation || '' });
}

async function drive(page, req) {
  return page.evaluate(async ({ source, req }) => (0, eval)(`(${source})`)(req), { source: driverSource, req });
}

async function withPage(browser, key, unknownShape, fn) {
  const page = await browser.newPage();
  await page.route('https://athenanet.athenahealth.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture(key, unknownShape) }));
  await page.goto(context.encounterUrl);
  try { return await fn(page); } finally { await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let checks = 0;
  try {
    for (const key of ['hpi', 'ros', 'exam', 'ap']) {
      await withPage(browser, key, false, async page => {
        const text = key === 'ap' ? 'Assessment:\nSynthetic assessment.\n\nPlan / Follow-up:\nSynthetic plan.' : `Synthetic ${key} persisted text.`;
        await installSlateAndNetwork(page, key, text, '');
        const result = await drive(page, request(key, text));
        assert.strictEqual(result.ok, true, `${key} exact native persistence refused: ${JSON.stringify(result)}`);
        assert.strictEqual(result.reason, 'exact-note-editor-persisted');
        assert.strictEqual(result.persisted, true); assert.strictEqual(result.serverVerified, true);
        assert.strictEqual(result.persistence.status, 200); assert.strictEqual(result.persistence.payloadMatch, true);
        const state = await page.evaluate(() => {
          const saved = window.__nativeOriginal, proof = window.__nativeProof;
          proof.restored = saved.FakeXHR.prototype.open === saved.originalOpen && saved.FakeXHR.prototype.send === saved.originalSend && window.fetch === saved.originalFetch;
          return proof;
        });
        assert.strictEqual(state.pastes, 1); assert.strictEqual(state.sends, 1, 'driver issued or duplicated Athena persistence');
        assert.strictEqual(state.restored, true, 'temporary network observer was not restored');
        checks += 9;
      });
    }

    await withPage(browser, 'hpi', false, async page => {
      const text = 'Synthetic Request-clone persistence.';
      await installSlateAndNetwork(page, 'hpi', text, 'fetch-request');
      const result = await drive(page, request('hpi', text));
      assert.strictEqual(result.ok, true, `fetch(Request) body was not observed: ${JSON.stringify(result)}`);
      assert.strictEqual(result.reason, 'exact-note-editor-persisted');
      const state = await page.evaluate(() => window.__nativeProof);
      assert.strictEqual(state.sends, 1); assert.strictEqual(state.pastes, 1);
      checks += 4;
    });

    for (const specimen of [
      ['hpi', 'wrong-encounter', 'native-persistence-request-missing'],
      ['hpi', 'different-origin', 'native-persistence-request-missing'],
      ['hpi', 'redirect-external', 'native-persistence-response-failed'],
      ['ros', 'wrong-body', 'native-persistence-request-missing'],
      ['ros', 'direct-text-html', 'native-persistence-request-missing'],
      ['ros', 'nested-block-html', 'native-persistence-request-missing'],
      ['exam', 'server-error', 'native-persistence-response-failed'],
      ['ap', 'wrong-ap-encounter', 'native-persistence-request-missing'],
      ['ap', 'duplicate', 'native-persistence-request-ambiguous']
    ]) {
      await withPage(browser, specimen[0], false, async page => {
        const text = specimen[0] === 'ap' ? 'Assessment:\nSynthetic.\n\nPlan / Follow-up:\nSynthetic.' : 'Synthetic refused persistence text.';
        await installSlateAndNetwork(page, specimen[0], text, specimen[1]);
        const result = await drive(page, request(specimen[0], text));
        assert.strictEqual(result.ok, false); assert.strictEqual(result.persisted, false);
        assert.strictEqual(result.reason, specimen[2], `${specimen[0]}/${specimen[1]} returned ${JSON.stringify(result)}`);
        assert.strictEqual(result.partialMutation, true); assert.strictEqual(result.serverVerified, false);
        checks += 5;
      });
    }

    await withPage(browser, 'hpi', false, async page => {
      const text = 'Throwing paste must restore observers.';
      await installSlateAndNetwork(page, 'hpi', text, '');
      const throwSource = driverSource.replace('var nativePersistence = await nativePersistenceWatch.wait(250);', "throw new Error('synthetic post-blur readback failure');");
      assert.notStrictEqual(throwSource, driverSource, 'throw-cleanup test anchor moved');
      const result = await page.evaluate(async ({ source, req }) => (0, eval)(`(${source})`)(req), { source: throwSource, req: request('hpi', text) });
      assert.strictEqual(result.ok, false); assert.strictEqual(result.attempted, true);
      const restored = await page.evaluate(() => {
        const saved = window.__nativeOriginal;
        return saved.FakeXHR.prototype.open === saved.originalOpen && saved.FakeXHR.prototype.send === saved.originalSend && window.fetch === saved.originalFetch;
      });
      assert.strictEqual(restored, true, 'throw path left a native observer installed');
      checks += 3;
    });

    await withPage(browser, 'hpi', true, async page => {
      await installSlateAndNetwork(page, 'hpi', 'Must never paste into unreadable Slate.', '');
      const result = await drive(page, request('hpi', 'Must never paste into unreadable Slate.'));
      assert.strictEqual(result.ok, false); assert.strictEqual(result.reason, 'note-editor-unreadable');
      assert.strictEqual(result.attempted, false);
      assert.strictEqual(await page.evaluate(() => document.querySelector('#target-editor').innerText), 'unreadable existing projection');
      const state = await page.evaluate(() => window.__nativeProof);
      assert.strictEqual(state.pastes, 0, 'unreadable Slate reached the paste mutation boundary');
      assert.strictEqual(state.sends, 0, 'unreadable Slate reached Athena persistence');
      checks += 6;
    });
  } finally { await browser.close(); }
  console.log(`PASS Athena native persistence runtime: ${checks} checks`);
})().catch(error => { console.error(error); process.exit(1); });
