'use strict';
/* =========================================================================
   bla-1.2.0 (2026-09-25): THE LEGAL / IME WORKSPACE NEVER DROPS AN EDITED
   DRAFT UNASKED, A QUESTION NEVER OUTLIVES ITS SESSION, AND A REFUSAL IS
   SAID IN PLAIN WORDS.

   Defects found by the legal hunt on site 7d531737 (the workspace is the same
   at f57f2aaf), each measured in real Chrome with every press a real click or
   keypress:
     1. Pressing Generate again over a generated, doctor-edited draft replaced
        it at once - chronology and AI types alike - with nothing asked and
        nothing kept (and the box stayed editable while a run drafted, so
        typing then was lost too).
     2. Picking a patient under "Change to another patient" - even the
        patient already bound - threw the edited draft away with nothing
        asked.
     3. A refusal from the hosted route read "Drafting stopped: 502 The draft
        did not satisfy its family safety contract.." - a status code, jargon
        and a doubled period - and with a per-device key the AI provider's own
        401 read "your sign-in has expired": it is that provider refusing the
        key.
     4. The picker's question names a patient and sits on document.body. As
        first built it outlived the sheet: closing the sheet, a patient change
        outside it, and a sign-out all left it in the page, and the next doctor
        to sign in saw it and could press "Discard and change" inside their
        own session.

   Legalfix-1.0.0 (b1320) already asks before Close, Escape and a report-type
   change; this suite holds Generate and the patient picker to the same
   rule, at 1400x900 and at 390x844. The AI is answered in the page by a
   recorder that writes what the request asks for. Nothing leaves 127.0.0.1.
   ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
let checks = 0;
function check(value, message) { checks++; if (!value) failures.push(message); return !!value; }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(ROOT, '.' + p);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* In the page: the configured AI path, answered locally by a recorder that
   writes exactly the report the request asks for (JSON, or the text report a
   later workspace may ask for). A held answer waits for release(), so the
   test can look at the workspace while a run drafts; a queued failure is
   thrown as the transport throws it, with the server's receipt when set. */
function harness() {
  const DISCLAIMER = 'This is an unsigned draft for clinician review. It does not constitute a final medical-legal opinion unless verified, adopted, and signed by the evaluating clinician.';
  function report(sys, user, subtype) {
    const marker = 'Expected sections: ', allow = '. Evidence-ID allowlist: ';
    const start = sys.indexOf(marker), end = sys.indexOf(allow, start + marker.length);
    const specs = start >= 0 && end > start ? JSON.parse(sys.slice(start + marker.length, end)) : [];
    const narrative = subtype === 'narrative_medical_report';
    const lineOf = (spec) => String(spec.headingLine || spec.heading).replace(/^[IVXLC]+(?:-[A-Z])?\.\s+/, '');
    const body = (index) => 'The records reviewed do not document the supporting record for item ' + (index + 1) + '.';
    if (/Return STRICT JSON only/.test(sys)) return JSON.stringify({ sections: specs.map((spec, index) => ({ heading: spec.heading, paragraphs: [{ text: body(index), evidenceIds: [] }] })) });
    const lines = narrative ? ['UNSIGNED DRAFT FOR CLINICIAN REVIEW AND SIGNATURE', 'NARRATIVE MEDICAL REPORT', ''] : [];
    specs.forEach((spec, index) => { lines.push(spec.headingLine || lineOf(spec), body(index), ''); });
    lines.push(DISCLAIMER);
    return lines.join('\n');
  }
  window.__dr = { calls: [], hold: false, pending: [], fail: '' };
  window.__dr.release = function () { const p = window.__dr.pending.splice(0); p.forEach((fn) => fn()); return p.length; };
  window.aiCallRaw = function (sys, user, key, opts) {
    const call = { sys: String(sys || ''), user: String(user || ''), subtype: opts && opts.draftSubtype };
    window.__dr.calls.push(call);
    if (window.__dr.fail) {
      const f = window.__dr.fail, error = new Error(typeof f === 'string' ? f : f.message);
      if (f && f.mlsAi) error.mlsAi = f.mlsAi;
      return Promise.reject(error);
    }
    const answer = report(call.sys, call.user, call.subtype);
    if (!window.__dr.hold) return Promise.resolve(answer);
    return new Promise((resolve) => window.__dr.pending.push(() => resolve(answer)));
  };
  window.getKey = function () { return 'synthetic-local-key'; };
  return true;
}

function seed() {
  const P = [{
    id: 'lg-1', name: 'Ada Sample', dob: '1962-03-04', mrn: 'MRN900001', problems: 'M54.16 Lumbar radiculopathy',
    visits: [
      { id: 'v1', date: '2026-02-11', type: 'Office visit', provider: 'M Sample, DO', source: 'athena-copy', detail: 'SUBJECTIVE: Low back pain since a collision on 01-20-2026.\nASSESSMENT: Lumbar radiculopathy, left L5.\nPLAN: Physical therapy. Follow-up in 4 weeks.' },
      { id: 'v2', date: '2026-03-15', type: 'Lumbar MRI', provider: 'R Reader, MD', source: 'athena-copy', detail: 'IMPRESSION: L4-L5 disc protrusion with left lateral recess stenosis.' },
      { id: 'v3', date: '2026-04-20', type: 'Transforaminal epidural steroid injection', provider: 'M Sample, DO', source: 'athena-copy', detail: 'PROCEDURE PERFORMED: Left L5 transforaminal epidural steroid injection. Tolerated well.' }
    ]
  }, { id: 'lg-2', name: 'Bea Sample', dob: '1970-01-02', mrn: 'MRN900002', visits: [
    { id: 'b1', date: '2026-05-05', type: 'Office visit', provider: 'M Sample, DO', source: 'athena-copy', detail: 'SUBJECTIVE: Neck pain.\nPLAN: Follow-up in 6 weeks.' }
  ] }];
  savePatients(P.map((p) => JSON.parse(JSON.stringify(p))));
  saveNotes([]);
  setActivePtId('lg-1');
  return getActivePtId();
}

async function run(browser, port, label, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.fulfill({ status: 503, body: 'offline' }));
  const L = (m) => label + ': ' + m;
  try {
    await page.goto('http://127.0.0.1:' + port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'legal-draft-kept@mlsscribe.test';
      bkUser = { role: 'doctor', isAdmin: false, email: 'legal-draft-kept@mlsscribe.test', name: 'Sample Provider' };
      const set = (k, v) => { try { localStorage.setItem(uns(k), v); } catch (e) {} };
      set('practiceName', 'Sample Orthopaedic Associates'); set('providerName', 'Sample Provider'); set('providerCred', 'MD');
    });
    await page.evaluate(harness);
    assert.strictEqual(await page.evaluate(seed), 'lg-1', L('the synthetic patient was not made active'));
    await page.evaluate(() => { const Ld = window.__mlsP1LegalLoader; if (Ld && typeof Ld.ensure === 'function') Ld.ensure(); });
    await page.waitForFunction(() => !!window.__mlsP1LegalPack, null, { timeout: 30000 });
    assert.ok(await page.evaluate(() => window.__mlsP1LegalPack.open() && !!document.getElementById('mlsP1LegalRoot')), L('the workspace did not open'));
    await page.evaluate(() => ['report', 'chronology', 'records', 'generate', 'draft'].forEach((k) => window.__mlsP1LegalPack.toggleCard(k, true)));
    await page.click('#mlsP1LegalCompile');

    const S = () => page.evaluate(() => window.__mlsP1LegalPack.state());
    const draft = () => page.evaluate(() => document.getElementById('mlsP1LegalDraft').value);
    const status = () => page.textContent('#mlsP1LegalStatus');
    const asked = () => page.evaluate(() => { const a = document.getElementById('mlsP1LegalAsk'); return a ? a.textContent : ''; });
    const calls = () => page.evaluate(() => window.__dr.calls.length);
    async function answer(which) { await page.click('#mlsP1LegalAsk button:has-text("' + which + '")'); await page.waitForTimeout(200); }
    async function pick(key) {
      await page.click('#mlsP1LegalReport_' + key);
      if (await page.$('#mlsP1LegalAsk')) await answer('Discard');
    }
    async function settle() {
      await page.waitForFunction(() => !window.__mlsP1LegalPack.state().generating, null, { timeout: 60000 });
      await page.waitForTimeout(250);
    }
    /* The doctor's edit, typed: open the draft's edit view if the formatted
       view is showing, then type at the end of the box. */
    async function typeEdit(text) {
      const hidden = await page.evaluate(() => { const d = document.getElementById('mlsP1LegalDraft'); return !d.getClientRects().length; });
      if (hidden) {
        const toggle = page.locator('#mlsP1LegalRoot .mls-fp-fmt .fmt-edit').first();
        if (await toggle.count()) await toggle.click();
      }
      await page.click('#mlsP1LegalDraft');
      await page.keyboard.press('Control+End');
      await page.keyboard.type(text);
    }

    /* ---- 1. Generate again: the chronology (no AI) ---------------------- */
    await pick('chronology');
    await page.click('#mlsP1LegalGenerate'); await settle();
    check((await draft()).length > 200, L('the chronology did not generate'));
    await typeEdit('\nDOCTOR ADDENDUM: reviewed with counsel.');
    check((await draft()).indexOf('DOCTOR ADDENDUM') >= 0, L('the typed addendum did not reach the draft'));
    await page.click('#mlsP1LegalGenerate'); await page.waitForTimeout(250);
    const chronAsk = await asked();
    if (check(/replaced/i.test(chronAsk), L('Generate over an edited chronology asked nothing: ' + JSON.stringify(chronAsk.slice(0, 80))))) {
      await answer('Keep the draft');
      check((await draft()).indexOf('DOCTOR ADDENDUM') >= 0, L('"Keep the draft" did not keep the edited chronology'));
      check(/kept/i.test(await status()), L('keeping the draft said nothing'));
      await page.click('#mlsP1LegalGenerate'); await page.waitForTimeout(250);
      await answer('Replace the draft'); await settle();
    }
    check((await draft()).indexOf('DOCTOR ADDENDUM') < 0 && (await draft()).length > 200, L('"Replace the draft" did not regenerate the chronology'));

    /* ---- 1b. Generate again: an AI report ------------------------------- */
    await pick('ime');
    await page.click('#mlsP1LegalGenerate'); await settle();
    check(/^Draft ready/.test(await status()), L('the IME did not generate: ' + (await status())));
    const firstCalls = await calls();
    await typeEdit('\nDOCTOR EDIT: causation revised after deposition.');
    await page.click('#mlsP1LegalGenerate'); await page.waitForTimeout(250);
    const imeAsk = await asked();
    if (check(/replaced/i.test(imeAsk), L('Generate over an edited IME asked nothing'))) {
      await answer('Keep the draft');
      check((await draft()).indexOf('DOCTOR EDIT') >= 0, L('"Keep the draft" did not keep the edited IME'));
      check((await calls()) === firstCalls, L('keeping the draft still called the AI'));
      await page.evaluate(() => { window.__dr.hold = true; });
      await page.click('#mlsP1LegalGenerate'); await page.waitForTimeout(250);
      await answer('Replace the draft');
      await page.waitForFunction(() => window.__dr.pending.length === 1, null, { timeout: 20000 });
      check(await page.evaluate(() => document.getElementById('mlsP1LegalDraft').readOnly), L('the draft box took typing while a run that will replace it was drafting'));
      await page.evaluate(() => { window.__dr.hold = false; window.__dr.release(); });
      await settle();
      check(!(await page.evaluate(() => document.getElementById('mlsP1LegalDraft').readOnly)), L('the draft box stayed read-only after the run'));
    } else {
      await settle();
    }
    check((await draft()).indexOf('DOCTOR EDIT') < 0 && /^Draft ready/.test(await status()), L('"Replace the draft" did not regenerate the IME'));

    /* ---- 2. The patient picker: the bound patient, then another --------- */
    await typeEdit('\nDOCTOR EDIT 2: keep this.');
    await page.fill('#mlsP1LegalRosterSearch', 'Ada');
    await page.click('#mlsP1LegalRosterResults button[data-bind-id="lg-1"]'); await page.waitForTimeout(250);
    const sameAsk = await asked();
    if (check(/Ada Sample/.test(sameAsk) && /discarded/i.test(sameAsk), L('re-picking the bound patient discarded the draft unasked: ' + JSON.stringify(sameAsk.slice(0, 80))))) {
      await answer('Keep the draft');
      check((await draft()).indexOf('DOCTOR EDIT 2') >= 0, L('"Keep the draft" on a re-pick lost the edit'));
      const kept = await S();
      check(kept.stage === 'generated' && kept.reportType === 'ime', L('"Keep the draft" on a re-pick changed the flow: ' + JSON.stringify(kept)));
      await page.fill('#mlsP1LegalRosterSearch', 'Ada');
      await page.click('#mlsP1LegalRosterResults button[data-bind-id="lg-1"]'); await page.waitForTimeout(250);
      await answer('Discard and re-bind');
    }
    const rebound = await S();
    check((await draft()) === '' && rebound.stage === 'bound' && rebound.reportType === '', L('the confirmed re-bind did not start over from a fresh snapshot: ' + JSON.stringify(rebound)));

    await pick('chronology');
    await page.click('#mlsP1LegalGenerate'); await settle();
    await typeEdit('\nDOCTOR EDIT 3: keep this too.');
    await page.fill('#mlsP1LegalRosterSearch', 'Bea');
    await page.click('#mlsP1LegalRosterResults button[data-bind-id="lg-2"]'); await page.waitForTimeout(250);
    const otherAsk = await asked();
    if (check(/Bea Sample/.test(otherAsk) && /discarded/i.test(otherAsk), L('picking another patient discarded the draft unasked'))) {
      await answer('Keep the draft');
      check((await draft()).indexOf('DOCTOR EDIT 3') >= 0, L('"Keep the draft" on another patient lost the edit'));
      check((await page.evaluate(() => getActivePtId())) === 'lg-1', L('"Keep the draft" still changed the patient'));
      await page.fill('#mlsP1LegalRosterSearch', 'Bea');
      await page.click('#mlsP1LegalRosterResults button[data-bind-id="lg-2"]'); await page.waitForTimeout(250);
      await answer('Discard and change');
    }
    check((await page.evaluate(() => getActivePtId())) === 'lg-2' && (await draft()) === '' && (await S()).stage === 'bound',
      L('the confirmed change did not bind the other patient'));

    /* ---- 3. A refused replacement keeps the edited draft, and says why - */
    const replaceAndFail = async (fail) => {
      await page.evaluate((f) => { window.__dr.fail = f; }, fail);
      await page.click('#mlsP1LegalGenerate'); await page.waitForTimeout(250);
      if (await page.$('#mlsP1LegalAsk')) await answer('Replace the draft');
      await settle();
      await page.evaluate(() => { window.__dr.fail = ''; });
      return status();
    };
    await page.fill('#mlsP1LegalRosterSearch', 'Ada');
    await page.click('#mlsP1LegalRosterResults button[data-bind-id="lg-1"]'); await page.waitForTimeout(300);
    if (await page.$('#mlsP1LegalAsk')) await answer('Discard');
    check((await page.evaluate(() => getActivePtId())) === 'lg-1', L('the first patient could not be bound again'));
    await pick('ime');
    await page.click('#mlsP1LegalGenerate'); await settle();
    check(/^Draft ready/.test(await status()), L('the IME did not generate before the refusals: ' + (await status())));
    await typeEdit('\nDOCTOR EDIT 5: survives a refusal.');
    const refused = await replaceAndFail({ message: '502 The draft did not satisfy its family safety contract.', mlsAi: { status: 502, code: 'draft_quality_failed', retryable: false, detail: 'The draft did not satisfy its family safety contract.' } });
    check(/^Drafting stopped: the server\u2019s safety check did not accept the draft it wrote, so nothing is shown\. Press Generate to try again/.test(refused) &&
      !/502|family safety contract|\.\./.test(refused), L('a safety-check refusal was not said in plain words: ' + refused));
    check((await draft()).indexOf('DOCTOR EDIT 5') >= 0, L('a refused replacement lost the edited draft'));
    const subtype = await replaceAndFail({ message: '400 invalid_legal_subtype', mlsAi: { status: 400, code: 'invalid_legal_subtype', retryable: false, detail: 'invalid_legal_subtype' } });
    check(/^Drafting stopped: the server does not offer this report type yet\./.test(subtype) && !/400|invalid_legal_subtype/.test(subtype), L('a report type the server does not know was not said plainly: ' + subtype));
    const busy = await replaceAndFail({ message: '429 Too many requests', mlsAi: { status: 429, code: 'rate_limited', retryable: true, detail: 'Too many requests' } });
    check(/^Drafting stopped: the AI service is busy\. Wait a minute, then press Generate again\./.test(busy) && !/\b429\b/.test(busy), L('a busy AI service was not said plainly: ' + busy));
    /* bla-1.2.1: any other hosted refusal keeps the server's own sentence, and
       offers Generate again only when the server says a retry can help. */
    const quota = await replaceAndFail({ message: '502 The AI provider account for MLS is out of credit. An administrator must add credit.', mlsAi: { status: 502, code: 'ai-quota', retryable: false, detail: 'The AI provider account for MLS is out of credit. An administrator must add credit.' } });
    check(/^Drafting stopped: The AI provider account for MLS is out of credit\. An administrator must add credit\./.test(quota) && !/Press Generate/.test(quota), L('a non-retryable server refusal lost its sentence or offered a useless retry: ' + quota));
    const timeout = await replaceAndFail({ message: '504 The AI service took too long to answer.', mlsAi: { status: 504, code: 'ai-timeout', retryable: true, detail: 'The AI service took too long to answer.' } });
    check(/^Drafting stopped: The AI service took too long to answer\. Press Generate to try again\./.test(timeout), L('a retryable server refusal lost its sentence: ' + timeout));
    check((await draft()).indexOf('DOCTOR EDIT 5') >= 0, L('the edited draft did not survive three refused replacements'));

    /* ---- 4. A provider 401 on a per-device key is the key, not the sign-in */
    await page.evaluate(() => { window.__realBackendMode = window.backendMode; window.backendMode = () => false; });
    const keySaid = await replaceAndFail('401 invalid_api_key Incorrect API key provided: sk-synthetic.');
    check(/^Drafting stopped: the AI provider refused the API key saved on this device\. Check the key in Settings/.test(keySaid) && !/sign-in|sign in/i.test(keySaid),
      L('a provider 401 on a per-device key was said as an expired sign-in: ' + keySaid));
    await page.evaluate(() => { window.backendMode = window.__realBackendMode; });
    check(/your sign-in has expired/.test(await replaceAndFail('401 unauthorized')), L('the hosted route\'s own 401 no longer says the sign-in expired: ' + (await status())));

    /* ---- 5. A question never outlives its workspace session ------------
       The picker's question names a patient. It was left on document.body
       when the sheet closed, when the patient changed outside the sheet, and
       through a sign-out; the next doctor then saw it over their own app
       and could press "Discard and change" inside their own session. */
    const asking = async () => {
      await pick('chronology');
      await page.click('#mlsP1LegalGenerate'); await page.waitForTimeout(200);
      if (await page.$('#mlsP1LegalAsk')) await answer('Replace the draft');
      await settle();
      await typeEdit('\nDOCTOR EDIT 4: keep.');
      await page.fill('#mlsP1LegalRosterSearch', 'Bea');
      await page.click('#mlsP1LegalRosterResults button[data-bind-id="lg-2"]'); await page.waitForTimeout(250);
      return /Change to Bea Sample\?/.test(await asked());
    };
    const questionGone = () => page.evaluate(() => !document.getElementById('mlsP1LegalAsk') &&
      !Array.prototype.some.call(document.querySelectorAll('[role="alertdialog"]'), (n) => /Bea Sample/.test(n.textContent)));
    /* a question left behind is recorded above and then taken away, so every
       later step is still measured */
    const dropStale = () => page.evaluate(() => { const stale = document.getElementById('mlsP1LegalAsk'); if (stale) stale.remove(); });
    const reopen = async () => {
      await dropStale();
      await page.evaluate(() => window.__mlsP1LegalPack.open());
      await page.evaluate(() => ['report', 'chronology', 'records', 'generate', 'draft'].forEach((k) => window.__mlsP1LegalPack.toggleCard(k, true)));
      await page.click('#mlsP1LegalCompile');
    };
    if (check(await asking(), L('the picker did not ask before discarding (setup for the close case)'))) {
      await page.evaluate(() => window.__mlsP1LegalPack.close());
      await page.waitForTimeout(200);
      check(await questionGone(), L('closing the workspace left the question naming Bea Sample on the page'));
      check((await page.evaluate(() => getActivePtId())) === 'lg-1', L('closing the workspace with the question open changed the patient'));
    }
    await reopen();
    if (check(await asking(), L('the picker did not ask before discarding (setup for the outside-change case)'))) {
      await page.evaluate(() => { setActivePtId('lg-2'); try { window.dispatchEvent(new CustomEvent('mls:active-patient-changed', { detail: { patientId: 'lg-2' } })); } catch (e) {} });
      await page.waitForTimeout(300);
      check(await questionGone(), L('a patient change outside the workspace left the stale question on the page'));
      check(!/draft on screen was kept/i.test((await page.evaluate(() => { const n = document.getElementById('mlsP1LegalStatus'); return n ? n.textContent : ''; }))),
        L('a question settled by an outside change still said the discarded draft was kept'));
      await page.evaluate(() => setActivePtId('lg-1'));
    }
    await reopen();
    if (check(await asking(), L('the picker did not ask before discarding (setup for the sign-out case)'))) {
      await page.evaluate(() => logout(true));
      await page.waitForTimeout(400);
      check(await questionGone(), L('a sign-out left the question naming the previous account\'s patient in the page'));
      await page.evaluate(() => { try { startSession('next-doctor@mlsscribe.test'); } catch (e) {} });
      await page.waitForTimeout(600);
      const visible = await page.evaluate(() => { const a = document.getElementById('mlsP1LegalAsk'); return !!a && a.getClientRects().length > 0 && /Bea Sample/.test(a.textContent); });
      check(!visible && await questionGone(), L('the next doctor to sign in saw the previous account\'s question'));
      check((await page.evaluate(() => (typeof getActivePtId === 'function' ? getActivePtId() : ''))) !== 'lg-2', L('the previous account\'s question changed the next doctor\'s patient'));
    }
    check(pageErrors.length === 0, L('page errors: ' + pageErrors.join(' | ')));
  } finally {
    await context.close();
  }
}

(async function main() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    await run(browser, port, 'desktop 1400x900', { width: 1400, height: 900 });
    await run(browser, port, 'phone 390x844', { width: 390, height: 844 });
  } finally {
    await browser.close();
    srv.close();
  }
  if (failures.length) {
    console.error('FAIL legal-workspace-never-drops-an-edited-draft: ' + failures.length + ' of ' + checks + ' checks failed:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('PASS legal-workspace-never-drops-an-edited-draft: ' + checks + ' checks at 1400x900 and 390x844 - Generate over an edited chronology or AI draft asks first and "Keep the draft" keeps every character (and calls no AI); the box takes no typing while a replacing run drafts; re-picking the bound patient or picking another asks before the draft is discarded and "Keep the draft" changes nothing; a refused replacement keeps the edited draft and says why in plain words (safety check, unknown report type, busy service); a provider 401 on a per-device key names the key, not the sign-in; a question naming a patient is gone when the sheet closes, when the patient changes outside it, and through a sign-out and the next sign-in');
})().catch((e) => { console.error(e); process.exit(1); });
