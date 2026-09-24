'use strict';
/* A LETTER NEVER DRAFTS A NOTE (tplsort-1.3.0, 2026-09-24).

   Round 3 of "Add templates" saved a template the doctor sent to "Letters &
   other documents" with NO kind. A template with no kind competes for every
   kind of note, and the keywords seeded from a consent form's own words
   ("lumbar epidural, steroid injection") out-scored the shipped operative
   template: measured in real Chrome, after saving "CONSENT FOR LUMBAR
   EPIDURAL STEROID INJECTION" and "AFTER YOUR KNEE CORTICOSTEROID INJECTION"
   as letters, the op-note room's auto-match for "Lumbar epidural steroid
   injection" chose the consent form (score 143 vs 63), "Right knee
   corticosteroid injection" chose the patient handout, and
   pickTemplateForVisit(..., 'op') and (..., 'soap') returned them too.

   Now a letter is saved as kind 'letter' - _mlsTplKindOf knows it, and every
   picker leaves it out: the op-note room's ranker and its dropdown and rail,
   the visit and op picker, the generation scope gate, the specialty preset
   list and the default an import sets. The cloud library keeps the kind
   (and a library server that predates it cannot turn it back into "any
   kind").

   Driven in real Chrome against the shipped 1p shell, signed in, with
   /api/templates/split answering in the backend's own contract
   (tests/fixtures/template-split-server.js). Nothing leaves 127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const SPLIT = require('./fixtures/template-split-server.js');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const L = (a) => a.join('\n');
const CONSENT = L(['CONSENT FOR LUMBAR EPIDURAL STEROID INJECTION', 'I consent to a lumbar epidural steroid injection at [level].',
  'Risks of the epidural steroid injection include infection, bleeding, headache and nerve injury.', 'Patient signature: [ ]', 'Witness: [ ]']);
const HANDOUT = L(['AFTER YOUR KNEE CORTICOSTEROID INJECTION', 'Your knee corticosteroid injection was done today.', 'Ice the knee for 20 minutes. Call us for fever or redness.']);
const PROCS = ['Lumbar epidural steroid injection', 'Right knee corticosteroid injection', 'Right L4-L5 transforaminal epidural steroid injection'];

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const server = { split: [], preview: [], commit: [], device: [], cloud: false, dropKind: false };
  const boot = async () => {
    const pg = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    pg.setDefaultTimeout(60000);
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const u = new URL(route.request().url());
      const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
      let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
      if (u.pathname === '/api/templates/split') {
        const text = String(body.text || '');
        server.split.push(text);
        /* the model names each letter's first line and says both are letters */
        return json(SPLIT.respond(text, SPLIT.modelFor([
          { first: 'CONSENT FOR LUMBAR EPIDURAL STEROID INJECTION', goes: 'letter', why: 'It is a consent form.', name: 'Consent for lumbar epidural steroid injection' },
          { first: 'AFTER YOUR KNEE CORTICOSTEROID INJECTION', goes: 'letter', why: 'It is a patient handout.', name: 'After your knee corticosteroid injection' }])).body);
      }
      if (u.pathname === '/api/template-sets') {
        if (!server.cloud) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return json({ activeSetId: server.commit.length ? 'set-1' : '', sets: server.commit.length ? [{ id: 'set-1', name: 'Imported templates', active: true, version: 1, templateCount: 1, scope: 'account' }] : [] });
      }
      if (u.pathname === '/api/template-imports/preview') {
        server.preview.push(body);
        const n = (body.templates || []).length;
        return json({ preview: { counts: { added: n, updated: 0, duplicated: 0, rejected: 0, unchanged: 0, removed: 0 }, canCommit: true, proposedTemplateCount: n, targetSetId: null, detail: { rejected: [] } } });
      }
      if (u.pathname === '/api/template-imports/commit') {
        server.commit.push(body);
        /* dropKind: a library server that predates kind letter answers it with no kind */
        const incoming = (body.templates || []).map((t, i) => { const c = Object.assign({}, t, { id: 'cloud-' + server.commit.length + '-' + i }); if (server.dropKind && c.kind === 'letter') delete c.kind; return c; });
        return json({ result: { status: 'complete', version: 1, counts: { added: incoming.length, updated: 0, duplicated: 0, rejected: 0, unchanged: 0, removed: 0 },
          set: { id: 'set-1', name: 'Imported templates', active: true, version: 1, scope: 'account', templates: server.device.concat(incoming) } } });
      }
      return route.fulfill({ status: 503, body: 'x' });
    });
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
    });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.evaluate(async () => {
      await window.__mlsEnsureDraftTuning();
      if (!window.__mlsTemplateLibrary && !document.querySelector('script[data-mls-asset="feat_mls_template_library.js"]')) {
        const s = document.createElement('script'); s.src = 'feat_mls_template_library.js'; s.setAttribute('data-mls-asset', 'feat_mls_template_library.js'); document.body.appendChild(s);
      }
    });
    await pg.waitForFunction(() => !!(window.__mlsDraftTuning && window.__mlsDraftTuning.installed && window.__mlsTemplateLibrary && window.__mlsTemplateLibrary.installed), null, { timeout: 60000 });
    await pg.evaluate(() => { sessionStorage.setItem('sf_bk_token', 'synthetic-test-token'); });
    return pg;
  };
  /* what every picker chooses for these procedures */
  const picks = (pg) => pg.evaluate((procs) => {
    const out = {};
    for (const p of procs) {
      const rank = _opRankTemplates(p);
      const op = pickTemplateForVisit('', { procedure: p }, 'op');
      const soap = pickTemplateForVisit('Patient here for follow up after ' + p.toLowerCase() + ', doing well.', { reason: p + ' follow-up' }, 'soap');
      out[p] = { room: rank[0] && rank[0].tpl ? rank[0].tpl.name : null, ranked: rank.map((r) => r.tpl && r.tpl.name), op: op ? op.name : null, soap: soap ? soap.name : null };
    }
    return out;
  }, PROCS);
  const addLetters = async (pg) => {
    await pg.evaluate(() => window.openTemplateIntake());
    await pg.waitForSelector('#tplIntakePaste', { state: 'visible', timeout: 45000 });
    await pg.evaluate(() => { const d = document.getElementById('tplIntakePasteWrap'); if (d) d.open = true; });
    await pg.fill('#tplIntakePaste', CONSENT + '\n\n' + HANDOUT);
    await pg.click('#tplIntakeSortBtn');
    await pg.waitForFunction(() => document.querySelectorAll('#tplMultiResult .tpl-sort-row').length === 2 && /Check where each one is going/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 60000 });
    const dests = await pg.$$eval('#tplMultiResult .tpl-sort-row', (els) => els.map((e) => e.getAttribute('data-tpl-dest')));
    assert.deepStrictEqual(dests, ['letters', 'letters'], 'the two letters were not placed in Letters: ' + dests);
    await pg.click('#tplSortSaveBtn');
    await pg.waitForFunction(() => /^Saved/.test(document.getElementById('tplMultiStatus').textContent), null, { timeout: 60000 });
    await pg.waitForTimeout(400);
    return pg.textContent('#tplMultiStatus');
  };
  const letterRows = (pg) => pg.evaluate(() => getTemplates().filter((t) => /^(CONSENT FOR LUMBAR|AFTER YOUR KNEE)/.test(String(t.text || ''))).map((t) => ({ id: t.id, name: t.name, kind: t.kind || '', keywords: t.keywords || [] })));
  try {
    /* ===== 1. on this device (no cloud library) ===== */
    const pg = await boot();
    await pg.evaluate(() => { try { localStorage.removeItem(uns('templateActive')); } catch (e) {} });
    const before = await picks(pg);
    assert.ok(/epidural|esi/i.test(String(before[PROCS[0]].room)), 'the fixture library has no ESI op template for the room to choose: ' + JSON.stringify(before));
    const said = await addLetters(pg);
    assert.strictEqual(said, 'Saved 2 letters or other documents.', said);
    const letters = await letterRows(pg);
    assert.strictEqual(letters.length, 2, 'the two letters were not saved');
    const after = await picks(pg);
    for (const p of PROCS) {
      assert.strictEqual(after[p].room, before[p].room, 'the op-note room\'s auto-match for "' + p + '" changed after two letters were saved: ' + JSON.stringify({ before: before[p], after: after[p] }));
      assert.ok(!after[p].ranked.some((n) => letters.some((l) => l.name === n)), 'the op-note room ranks a letter for "' + p + '": ' + JSON.stringify(after[p].ranked));
      assert.ok(!letters.some((l) => l.name === after[p].op || l.name === after[p].soap), 'pickTemplateForVisit picks a letter for "' + p + '": ' + JSON.stringify(after[p]));
      assert.deepStrictEqual([after[p].op, after[p].soap], [before[p].op, before[p].soap], 'a picker changed its choice for "' + p + '"');
    }
    assert.deepStrictEqual(letters.map((t) => t.kind), ['letter', 'letter'], 'the letters were not saved as kind letter: ' + JSON.stringify(letters));
    /* the exact-name pick, the scope gate, the dropdown lists and the default */
    const gates = await pg.evaluate((ids) => {
      const byId = (id) => getTemplates().find((t) => t.id === id);
      const out = { scope: ids.map((id) => _mlsGenTemplateScopeSkip(byId(id))), kindOf: ids.map((id) => _mlsTplKindOf(byId(id))), label: _mlsTplKindLabel('letter') };
      out.byName = ids.map((id) => { const t = byId(id); const r = pickTemplateForVisit('', { procedure: t.name }, 'op'); return r ? r.id : null; });
      out.active = localStorage.getItem(uns('templateActive')) || '';
      try { _syncSpecialtyPresetTemplates(); } catch (e) {}
      const og = document.querySelector('#specialtyPreset optgroup[data-mine]');
      out.preset = og ? Array.from(og.querySelectorAll('option'), (o) => o.value) : [];
      return out;
    }, letters.map((l) => l.id));
    assert.deepStrictEqual(gates.scope, ['letter', 'letter'], 'a letter can shape a visit note: ' + JSON.stringify(gates));
    assert.deepStrictEqual(gates.kindOf, ['letter', 'letter']);
    assert.ok(/never drafts a note/.test(gates.label), 'kind letter is not labelled as never drafting a note');
    assert.ok(gates.byName.every((id) => !letters.some((l) => l.id === id)), 'asking for a letter by its own name picks it to draft an op note: ' + JSON.stringify(gates.byName));
    assert.ok(!letters.some((l) => l.id === gates.active), 'a letter became the default template');
    assert.ok(!gates.preset.some((v) => letters.some((l) => l.id === v || l.name === v)), 'the specialty preset list offers a letter');
    /* the op-note room: its dropdown and its rail do not offer a letter */
    const room = await pg.evaluate(async (names) => {
      try { if (typeof closeTemplates === 'function') closeTemplates(); } catch (e) {}
      if (typeof openOpPrep === 'function') { try { await openOpPrep(); } catch (e) {} }
      await new Promise((r) => setTimeout(r, 1500));
      const rail = document.getElementById('oprTplRail');
      const railText = rail ? rail.innerText : '';
      const selects = Array.from(document.querySelectorAll('#opPrepList select, #opPrepModal select'));
      const offered = selects.flatMap((s) => Array.from(s.options, (o) => o.textContent));
      return { rail: !!rail, railHasLetter: names.some((n) => railText.includes(n)), selects: selects.length, offersLetter: offered.some((t) => names.some((n) => t.includes(n))) };
    }, letters.map((l) => l.name));
    assert.ok(!room.railHasLetter && !room.offersLetter, 'the op-note room offers a letter: ' + JSON.stringify(room));
    /* the doctor can still see and edit a letter in the library, and keep its kind */
    const detail = await pg.evaluate((id) => { tplSelect(id); const sel = document.getElementById('tplDetKind'); return sel ? sel.value : null; }, letters[0].id);
    assert.strictEqual(detail, 'letter', 'the template detail does not show (and would not keep) kind letter');

    /* ===== 2. signed in to the cloud library - and one that predates kind letter ===== */
    server.cloud = true; server.dropKind = true;
    const sp = await boot();
    server.device = await sp.evaluate(() => getTemplates());
    const cloudBefore = await picks(sp);
    const saidCloud = await addLetters(sp);
    assert.strictEqual(saidCloud, 'Saved 2 letters or other documents.', saidCloud);
    const sent = server.preview[server.preview.length - 1].templates;
    assert.deepStrictEqual(sent.map((t) => t.kind), ['letter', 'letter'], 'the cloud import did not carry kind letter: ' + JSON.stringify(sent.map((t) => [t.name, t.kind])));
    const cloudLetters = await letterRows(sp);
    assert.deepStrictEqual(cloudLetters.map((t) => t.kind), ['letter', 'letter'], 'a library server that predates kind letter turned the letters into "any kind": ' + JSON.stringify(cloudLetters));
    const cloudAfter = await picks(sp);
    for (const p of PROCS) assert.strictEqual(cloudAfter[p].room, cloudBefore[p].room, 'after a cloud save the op-note room\'s auto-match for "' + p + '" changed: ' + JSON.stringify({ before: cloudBefore[p], after: cloudAfter[p] }));
    server.cloud = false; server.dropKind = false;

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS letters never draft (real Chrome): "' + CONSENT.split('\n')[0] + '" and "' + HANDOUT.split('\n')[0] + '" added through "Add templates" are saved as kind letter, on the device and through the cloud library (even one that predates the kind); ' +
      'the op-note room\'s auto-match for "Lumbar epidural steroid injection", "Right knee corticosteroid injection" and a transforaminal ESI chooses exactly what it chose before (' + PROCS.map((p) => after[p].room).join(' / ') + '), never a letter; ' +
      'pickTemplateForVisit for op and soap, the exact-name pick, the generation scope gate, the specialty preset list, the default template and the op-note room\'s dropdown and rail all leave the letters out; the library still shows and keeps the kind');
  } finally { await b.close(); srv.close(); }
});
