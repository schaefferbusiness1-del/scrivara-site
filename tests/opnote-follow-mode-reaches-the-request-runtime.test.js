'use strict';

/* The op-note follow mode the doctor picks is the one that reaches the model,
 * and the receipt says so.
 *
 * MEASURED (template-fidelity audit, 2026-09-22) with the real app and a
 * stubbed backend: the /api/complete body for an op note was identical in all
 * three modes - draftTuning.templateMode was the Settings profile's 'strict'
 * every time, Balanced added no clause, Adapt to case was told to reproduce
 * verbatim AND to write tighter, the old quality directive added example doses
 * and a second blank syntax, and the date/drug guards dropped templateMode so
 * the room's "Style used" receipt named the wrong mode.
 *
 * Real Chrome on /ScribeFlow.html (sample workspace). Its public-preview policy
 * locks window.fetch, so the capture point is the seam the installed generator
 * calls at run time, window.aiCallRaw: the generator's own system prompt, its
 * user message and opts are recorded there, and a faithful model answer flows
 * back through the real generate() -> date guard -> drug guard -> receipt. The
 * wire tuning is proved through the same __mlsDraftTuning.forFamily() that
 * aiCallRaw uses to build the /api/complete body; the two aiCallRaw wrappers
 * and the fetch-layer FILL rule are checked on their shipped source. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* the layers outside the capture point, on their shipped source */
const connect = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');
assert.ok(/tplLane=!!\(arguments\[3\]&&arguments\[3\]\.mlsTemplateFidelity===true\)/.test(connect) &&
  /if\(!tplLane && typeof a0==='string' && \/operative note/.test(connect),
  'the old quality directive (example doses, [VOLUME] blanks) must skip the template lane');
assert.ok(/contractFor\('operative-procedure-note',tplLane\?\{heldSlotSyntax:'\[\[snake_case\]\]'\}:\{\}\)/.test(connect),
  'the note-quality contract must name the [[snake_case]] blank as allowed on the template lane');
const nq = fs.readFileSync(path.join(ROOT, 'feat_mls_note_quality.js'), 'utf8');
assert.ok(/other than the required ' \+ held \+ ' held-for-physician marker/.test(nq), 'the contract exempts the named held marker');
/* the fetch-layer FILL rule (inside the capture point) must skip op notes */
const fixpack = fs.readFileSync(path.join(ROOT, 'feat_mls_fixpack_0701.js'), 'utf8');
assert.ok(/typeof o\.system === 'string' && o\.family !== 'opnote'\)/.test(fixpack),
  'the fetch-layer STRICT DICTATION RULE must not add a second blank syntax to op-note requests');

(async () => {
  const server = await serve();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'offline' }));
    await page.goto(`http://127.0.0.1:${server.address().port}/ScribeFlow.html?preview=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window._genOpNote === 'function' && typeof window.getTemplates === 'function' &&
      (window.getTemplates() || []).length > 0 && (window._calAppts || []).length > 0, null, { timeout: 60000 });
    await page.waitForTimeout(2000);
    /* the tuning module loads on demand, exactly as aiCallRaw awaits it */
    await page.evaluate(async () => { if (typeof window.__mlsEnsureDraftTuning === 'function') await window.__mlsEnsureDraftTuning(); });
    await page.waitForFunction(() => !!(window.__mlsDraftTuning && window.__mlsDraftTuning.installed), null, { timeout: 30000 });
    await page.evaluate(() => {
      window.__cap = [];
      window.aiCallRaw = async function (sys, user, key, opts) {
        window.__cap.push({ sys: String(sys || ''), user: String(user || ''), opts: opts || {} });
        const tpl = String(user || '').split(/SELECTED TEMPLATE[^\n]*\n/).pop() || '';
        return JSON.stringify({ note: tpl, missing: [] });   /* a faithful model */
      };
      try { window.savePatients((window.getPatients() || []).concat([{ id: 'mode-syn-0', name: 'Ada Synthetic', dob: '1960-01-01', notes: [], visits: [] }])); } catch (e) {}
    });
    /* the verified-history owner re-wraps aiCallRaw on top of whatever displaced
       it (its order-independent rewire), so the capture sits BEHIND the wrapper
       that binds the exact patient's history - as the real transport does */
    await page.waitForFunction(() => !!(window.aiCallRaw && window.aiCallRaw.__mlsHistAiWrap), null, { timeout: 15000 });

    const seen = {};
    for (const mode of ['strict', 'adapt', 'guide']) {
      const out = await page.evaluate(async (m) => {
        localStorage.setItem(window.uns('opNoteTemplateMode'), m);
        window.__cap.length = 0;
        const T = window.getTemplates()[0];
        let res = null, err = '';
        try {
          res = await window._genOpNote('Ada Synthetic', 'Sep 22, 2026', T.name, T.text,
            { patientId: 'mode-syn-0', dob: '1960-01-01', patient: 'Ada Synthetic', name: 'Ada Synthetic', tplId: T.id });
        } catch (e) { err = String(e && e.message || e); }
        const c = window.__cap[0] || { sys: '', opts: {} };
        /* the wire value aiCallRaw would send: the room's mode must beat a routed
           Settings profile that says 'strict' */
        const wire = window.__mlsDraftTuning.forFamily('opnote', { templateMode: 'strict', templateText: 'PROFILE TEMPLATE' });
        return { err, templateMode: res && res.templateMode, hasConformance: !!(res && res.templateConformance),
          calls: window.__cap.length, family: c.opts.family, lane: c.opts.mlsTemplateFidelity === true,
          wireMode: wire.templateMode, wireTemplate: wire.templateText, system: c.sys };
      }, mode);
      assert.strictEqual(out.err, '', mode + ': the generator failed: ' + out.err);
      assert.ok(out.calls >= 1, mode + ': the installed generator never called the model');
      assert.strictEqual(out.family, 'opnote', mode + ': wrong family ' + out.family);
      assert.ok(out.lane, mode + ': the call is not marked as the template lane');
      assert.strictEqual(out.wireMode, mode, mode + ': draftTuning.templateMode on the wire would be ' + out.wireMode + ', not the room\'s choice');
      assert.strictEqual(out.wireTemplate, '', mode + ': a Settings profile template would ride along as a second template');
      assert.strictEqual(out.templateMode, mode, mode + ': the result receipt says ' + out.templateMode + ' (the date/drug guards must keep it)');
      assert.ok(out.hasConformance, mode + ': templateConformance was dropped from the result');
      seen[mode] = out.system;
    }
    assert.ok(/HOW TO PRODUCE THE NOTE — REPRODUCE, THEN FILL/.test(seen.strict), 'strict keeps the verbatim clause');
    assert.ok(/TEMPLATE FIDELITY - CLOSEST/.test(seen.strict), 'strict carries its clause');
    assert.ok(/TEMPLATE FIDELITY - BALANCED/.test(seen.adapt) && /change only the words that differ/.test(seen.adapt), 'Balanced carries its own clause');
    assert.ok(!/HOW TO PRODUCE THE NOTE — REPRODUCE, THEN FILL/.test(seen.guide), 'Adapt to case is not also told to reproduce verbatim');
    assert.ok(/TEMPLATE FIDELITY - LOOSER/.test(seen.guide) && /FILL FIELDS\./.test(seen.guide), 'Adapt to case carries its clause and the fill-field rule');
    assert.notStrictEqual(seen.strict, seen.adapt);
    assert.notStrictEqual(seen.adapt, seen.guide);
    console.log('PASS op-note follow mode reaches the request: on /ScribeFlow.html each of Closely / Balanced / Adapt to case sends its own mode and clause, and the receipt names the mode that ran');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
