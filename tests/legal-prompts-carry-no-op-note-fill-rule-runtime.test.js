'use strict';
/* =========================================================================
   bla-1.2.0 (2026-09-25): A LEGAL PROMPT NEVER CARRIES THE OP-NOTE
   "STRICT DICTATION RULE".

   feat_mls_fixpack_0701.js wraps window.fetch and appends the op-note
   STRICT DICTATION RULE - "output ONE placeholder token EXACTLY in the form
   [FILL: ...]" - to every /api request whose body mentions an operative note,
   a procedure note or an injection. Only the 'opnote' and 'avs' families were
   excluded, so the Legal / IME workspace's IME, narrative and records review
   (family 'legal_ime') and every expert report section (family 'legal_ime',
   subtype 'legal_section') were told to write [FILL: ...] placeholders for any
   chart with an injection - placeholders their own contract forbids, which a
   report could then carry to print (hunt8 round-2 end-to-end, item 7).

   This suite drives the real request path in real Chrome: the shell's own
   aiCallRaw in hosted mode, behind every fetch wrapper the page installs.
   The hosted route is answered at the network edge, where the posted body is
   read. For a chart that documents an injection it checks that:
     - the workspace's IME, narrative and records review requests (real
       Generate presses) carry no STRICT DICTATION RULE and no [FILL: ...];
     - an expert report section request carries neither;
     - a free-form non-legal request about the same injection still gets the
       rule (the wrapper is live, so the checks above are not vacuous), and an
       op-note request still does not.
   It runs on the /1p shell and on production, one browser at a time, and
   nothing leaves 127.0.0.1.
   ========================================================================= */
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

function seed() {
  savePatients([{
    id: 'fr-1', name: 'Ada Sample', dob: '1962-03-04', mrn: 'MRN910001', problems: 'M54.16 Lumbar radiculopathy',
    visits: [
      { id: 'v1', date: '2026-02-11', type: 'Office visit', provider: 'M Sample, DO', source: 'athena-copy', detail: 'SUBJECTIVE: Low back pain.\nASSESSMENT: Lumbar radiculopathy, left L5.\nPLAN: Epidural steroid injection.' },
      { id: 'v2', date: '2026-04-20', type: 'Transforaminal epidural steroid injection', provider: 'M Sample, DO', source: 'athena-copy', detail: 'PROCEDURE PERFORMED: Left L5 transforaminal epidural steroid injection. Tolerated well.' }
    ]
  }]);
  saveNotes([]);
  setActivePtId('fr-1');
  return getActivePtId();
}

const RULE = /STRICT DICTATION RULE|\[FILL:/;

async function run(browser, port, shell) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  const posted = [];
  await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.fulfill({ status: 503, body: 'offline' }));
  await context.route(/\/api\/complete(?:\?|$)/, (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    posted.push(body);
    route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'The draft did not satisfy its family safety contract.', code: 'draft_quality_failed', retryable: false }) });
  });
  const L = (m) => shell + ': ' + m;
  const since = (n) => posted.slice(n);
  try {
    await page.goto('http://127.0.0.1:' + port + '/' + shell, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForFunction(() => !!(window.__mlsFixpack && window.__mlsFixpack._orig && window.__mlsFixpack._orig.fetch9), null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    check(await page.evaluate(() => typeof backendMode === 'function' && backendMode()), L('the page is not in hosted mode, so the hosted request path was not measured'));
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'legal-fill-rule@mlsscribe.test';
      bkUser = { role: 'doctor', isAdmin: false, email: 'legal-fill-rule@mlsscribe.test', name: 'Sample Provider' };
      try { sessionStorage.setItem('sf_bk_token', 'synthetic-session'); } catch (e) {}
    });
    check((await page.evaluate(seed)) === 'fr-1', L('the synthetic patient was not made active'));

    /* control: the wrapper is live on this page */
    let at = posted.length;
    await page.evaluate(() => aiCallRaw('Draft a short procedure summary from the note below.', 'PROCEDURE PERFORMED: Left L5 transforaminal epidural steroid injection.', '', { freeform: true, family: 'general_draft' }).catch(() => null));
    const control = since(at)[0];
    check(!!control && /STRICT DICTATION RULE/.test(control.system || ''), L('a non-legal request about an injection no longer got the rule, so this page cannot show the legal exclusion'));
    at = posted.length;
    await page.evaluate(() => aiCallRaw('Write the operative note.', 'PROCEDURE PERFORMED: Left L5 transforaminal epidural steroid injection.', '', { freeform: true, family: 'opnote' }).catch(() => null));
    const opnote = since(at)[0];
    check(!!opnote && !RULE.test(opnote.system || ''), L('an op-note request got the second blank syntax'));

    /* the Legal / IME workspace: real Generate presses */
    await page.evaluate(() => { const Ld = window.__mlsP1LegalLoader; if (Ld && typeof Ld.ensure === 'function') Ld.ensure(); });
    await page.waitForFunction(() => !!window.__mlsP1LegalPack, null, { timeout: 30000 });
    check(await page.evaluate(() => window.__mlsP1LegalPack.open() && !!document.getElementById('mlsP1LegalRoot')), L('the workspace did not open'));
    await page.evaluate(() => ['report', 'chronology', 'records', 'generate', 'draft'].forEach((k) => window.__mlsP1LegalPack.toggleCard(k, true)));
    await page.click('#mlsP1LegalCompile');
    for (const key of ['ime', 'narrative', 'records']) {
      await page.click('#mlsP1LegalReport_' + key);
      if (await page.$('#mlsP1LegalAsk')) await page.click('#mlsP1LegalAsk button:has-text("Discard")');
      at = posted.length;
      await page.click('#mlsP1LegalGenerate');
      await page.waitForFunction(() => !window.__mlsP1LegalPack.state().generating, null, { timeout: 60000 });
      await page.waitForTimeout(200);
      const sent = since(at);
      if (!check(sent.length >= 1, L(key + ': Generate sent no hosted request'))) continue;
      sent.forEach((body, n) => {
        check(body.family === 'legal_ime' && body.legal === true, L(key + ' request ' + (n + 1) + ' is not a legal request: ' + JSON.stringify({ family: body.family, legal: body.legal })));
        check(/injection/i.test(JSON.stringify(body)), L(key + ' request ' + (n + 1) + ' does not mention the injection, so the rule had nothing to match'));
        check(!RULE.test(body.system || '') && !RULE.test(body.user || ''), L(key + ' request ' + (n + 1) + ' carried the op-note STRICT DICTATION RULE'));
      });
    }

    /* an expert report section, through the shell's own drafting loop */
    at = posted.length;
    const expert = await page.evaluate(() => generateExpertReportSections({
      attorney: 'Sample Law LLP', caseNo: 'SYN-1', doi: '2026-01-20', jurisdiction: 'Synthetic', questions: 'Was the injection reasonable?',
      patientRef: 'Ada Sample', recordsBlock: '', chartBlock: '2026-04-20 PROCEDURE PERFORMED: Left L5 transforaminal epidural steroid injection. Tolerated well.',
      ownRecord: false, cv: '', note: '', today: '2026-09-25', btn: null, docType: 'Retained expert report'
    }).then(() => 'finished', (e) => String(e && e.message || e)));
    const sections = since(at);
    check(/^Expert report section 1 /.test(expert), L('the expert report did not stop at its refused first section: ' + expert));
    if (check(sections.length >= 1, L('the expert report sent no hosted request'))) {
      sections.forEach((body, n) => {
        check(body.draftSubtype === 'legal_section' && /injection/i.test(body.user || ''), L('expert section request ' + (n + 1) + ' is not the injection section request'));
        check(!RULE.test(body.system || ''), L('expert section request ' + (n + 1) + ' carried the op-note STRICT DICTATION RULE'));
      });
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
    for (const shell of ['1pScribeFlow.html', 'ScribeFlow.html']) await run(browser, port, shell);
  } finally {
    await browser.close();
    srv.close();
  }
  if (failures.length) {
    console.error('FAIL legal-prompts-carry-no-op-note-fill-rule: ' + failures.length + ' of ' + checks + ' checks failed:\n- ' + failures.join('\n- '));
    process.exit(1);
  }
  console.log('PASS legal-prompts-carry-no-op-note-fill-rule: ' + checks + ' checks on the /1p shell and production - for a chart that documents an injection, the Legal / IME workspace\'s IME, narrative and records review requests and an expert report section request carry no op-note STRICT DICTATION RULE and no [FILL: ...]; a non-legal request about the same injection still gets the rule, and an op-note request still does not');
})().catch((e) => { console.error(e); process.exit(1); });
