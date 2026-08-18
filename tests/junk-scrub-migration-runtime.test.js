'use strict';
/* junkscrub-1.0.0 — THE MIGRATION, RUN FOR REAL.
 *
 * tests/junk-scrub-detector.test.js proves the RULES. This suite proves the
 * MIGRATION: the real shipped shell, in a real browser, with the real
 * IndexedDB patient store (sj-2.0) migrated and serving, the real
 * getPatients / upsertPatient / savePatients, and the real per-patient server
 * mirror pointed at a mock endpoint whose POST bodies are read back.
 *
 * Nothing here is a stub of the thing under test. What is faked is exactly one
 * thing: the network, so that no byte leaves the machine.
 *
 * Five seeded charts, chosen so that a cleaner that is too eager fails:
 *   A  an Athena-pulled visit with the real interleaved junk    -> CLEANED
 *   B  an Athena-pulled visit with an ordinary clinical note    -> BYTE-IDENTICAL
 *   C  a DOCTOR-authored visit whose text contains the same junk-> BYTE-IDENTICAL
 *   D  an Athena visit that is NOTHING BUT junk                 -> BYTE-IDENTICAL (refused, never emptied)
 *   E  an Athena visit already carrying _rawBeforeScrub         -> BYTE-IDENTICAL (idempotent)
 *
 * and it asserts, by measurement:
 *   1  A's stored body shrank, and shrank to exactly the clinical sentence;
 *   2  A's untouched original is stored beside it under _rawBeforeScrub;
 *   3  A's patient record has a BUMPED `updated`, and B-E's do not;
 *   4  B, C, D and E are byte-identical to what went in;
 *   5  A's id entered the pending server-sync queue and the mock endpoint
 *      received a POST whose nested visit body is the CLEANED text;
 *   6  a SECOND run changes nothing and flags nothing;
 *   7  the cleaned body survives a full page RELOAD out of IndexedDB;
 *   8  the receipt names the affected DAY and carries no identity.
 *
 * No PHI: every name, MRN and note is invented here. No sign-in, no Athena. */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const ok = (c, m) => assert.ok(c, m);
const eq = (a, b, m) => assert.strictEqual(a, b, m);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      if (p.endsWith('/')) p += 'index.html';
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

/* ---- the seeded bodies. Real athenaOne page shapes, invented values. ----- */
const NOTE_A = 'Follow-up lumbar spine, pain 4/10 improving. Continue gabapentin 300 mg PO TID.';
const JUNK =
  'Print Example Ortho and Hand • 915 EXAMPLE RD STE 1 B-A, ANYTOWN PA 19380-4269 QUILFEATHER, Zzyxandra (id #7731709, dob: 06/01/1967) ' +
  'window.Original = {}; window.Original.IsSafari = IsSafari; IsSafari = function(){ return 0; } ' +
  'Jotter = function(params) { var svgjottercontainerid = params.div.id; }';
const BODY_A = JUNK + ' ' + NOTE_A;
const BODY_B = 'Lumbar ESI performed at L4-L5 under fluoroscopy; pain 8/10 -> 3/10 at 20 minutes. Patient fell through a window. Laceration to right forearm, 4 cm, repaired with 5-0 nylon.';
const BODY_C = JUNK + ' Doctor-authored addendum: patient tolerated the procedure well.';
const BODY_D = 'window.Original = {}; IsSafari = function(){ return 0; }';
const BODY_E = 'Already cleaned earlier. Pain 3/10, stable.';

/* A fixed, PAST `updated` on every seeded row: without one the bump assertion
   would be comparing against undefined and could never fail. */
const SEEDED_AT = 1750000000000;
const SEED = [
  { id: 'qq-A', name: 'Zzyxandra Quilfeather', dob: '1967-06-01', mrn: 'MRNQQ1', notes: [], created: SEEDED_AT, updated: SEEDED_AT + 1,
    visits: [{ id: 'v-A', date: '2026-07-16', type: 'Follow-up', source: 'athena-visits', bodyComplete: true, fullDetail: true, indexOnly: false, raw: BODY_A }] },
  { id: 'qq-B', name: 'Wrenlow Kesterbrook', dob: '1971-02-02', mrn: 'MRNQQ2', notes: [], created: SEEDED_AT, updated: SEEDED_AT + 2,
    visits: [{ id: 'v-B', date: '2026-07-17', type: 'Procedure', source: 'athena-visits', bodyComplete: true, fullDetail: true, indexOnly: false, raw: BODY_B }] },
  { id: 'qq-C', name: 'Marisol Thundergast', dob: '1980-03-03', mrn: 'MRNQQ3', notes: [], created: SEEDED_AT, updated: SEEDED_AT + 3,
    visits: [{ id: 'v-C', date: '2026-07-18', type: 'Addendum', source: 'provider-entered', bodyComplete: true, fullDetail: true, indexOnly: false, raw: BODY_C }] },
  { id: 'qq-D', name: 'Peregrine Halloway', dob: '1990-04-04', mrn: 'MRNQQ4', notes: [], created: SEEDED_AT, updated: SEEDED_AT + 4,
    visits: [{ id: 'v-D', date: '2026-07-19', type: 'Follow-up', source: 'athena-visits', bodyComplete: true, fullDetail: true, indexOnly: false, raw: BODY_D }] },
  { id: 'qq-E', name: 'Octavia Brambleworth', dob: '1965-05-05', mrn: 'MRNQQ5', notes: [], created: SEEDED_AT, updated: SEEDED_AT + 5,
    visits: [{ id: 'v-E', date: '2026-07-20', type: 'Follow-up', source: 'athena-visits', bodyComplete: true, fullDetail: true, indexOnly: false,
      raw: BODY_E, _rawBeforeScrub: { raw: 'Already cleaned earlier. window.Original = {}; Pain 3/10, stable.' } }] }
];
const UNTOUCHED = ['qq-B', 'qq-C', 'qq-D', 'qq-E'];

async function bootShell(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'junkscrub-harness@mlsscribe.test'; });
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => typeof window.getPatients === 'function' && typeof window.upsertPatient === 'function',
    null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
  });
  await page.waitForFunction(() => !!window.__mlsJunkScrub, null, { timeout: 60000 });
}

async function main() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));

  /* the mock server mirror. Every POST body is kept for inspection; no byte
     leaves this process. */
  const posted = [];
  await page.route('**/api/patients**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      let body = null;
      try { body = JSON.parse(req.postData() || 'null'); } catch (e) { body = { __unparseable: String(req.postData() || '').slice(0, 200) }; }
      posted.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'srv-' + posted.length }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ patients: [] }) });
  });

  try {
    const url = `http://127.0.0.1:${port}/1pScribeFlow.html`;
    await bootShell(page, url);

    /* ---- seed, then CUT OVER TO INDEXEDDB so this is a real IDB fixture --- */
    const seeded = await page.evaluate(async (rows) => {
      window.savePatients(rows);
      const store = window.__mlsPtsStore;
      /* the boot barrier ran before this harness adopted its account, so the
         store must be re-initialised against the namespace we are seeding */
      await store.init();
      const rep = await store.migrate();
      return {
        migrated: !!(rep && rep.migrated), mode: store.mode(), ready: store.isReady(),
        count: window.getPatients().length,
        blobGone: localStorage.getItem(window.uns('patients')) === null
      };
    }, SEED);
    eq(seeded.migrated, true, 'the sj-2.0 store refused to migrate the fixture, so this is not an IndexedDB test');
    eq(seeded.mode, 'idb', 'the store is not serving from IndexedDB: mode=' + seeded.mode);
    eq(seeded.ready, true, 'the store did not become ready');
    eq(seeded.count, SEED.length, 'the fixture did not round-trip: ' + seeded.count + ' of ' + SEED.length);
    eq(seeded.blobGone, true, 'the localStorage blob survived the cutover — the roster is not really coming from IndexedDB');

    /* ---- the BEFORE snapshot, byte-exact ------------------------------- */
    const before = await page.evaluate(() => {
      const out = {};
      (window.getPatients() || []).forEach((p) => { out[p.id] = { json: JSON.stringify(p), updated: p.updated }; });
      return out;
    });
    for (const p of SEED) ok(before[p.id], 'patient ' + p.id + ' is not in the store before the run');

    /* the dry run must find the same thing without writing anything */
    await page.evaluate(() => { sessionStorage.setItem('sf_bk_token', 'junkscrub-harness-token'); });
    const dry = await page.evaluate(() => window.__mlsJunkScrub.dryRun());
    eq(dry.mode, 'dry-run', 'dryRun did not report itself as a dry run');
    eq(dry.flaggedVisits, 1, 'the dry run flagged ' + dry.flaggedVisits + ' visits, expected exactly 1 (chart A)');
    eq(dry.appliedPatients, 0, 'the DRY RUN wrote to ' + dry.appliedPatients + ' patients');
    const afterDry = await page.evaluate(() => {
      const out = {};
      (window.getPatients() || []).forEach((p) => { out[p.id] = JSON.stringify(p); });
      return out;
    });
    for (const id of Object.keys(before)) {
      eq(afterDry[id], before[id].json, 'the DRY RUN changed stored bytes for ' + id);
    }
    eq(posted.length, 0, 'the DRY RUN pushed ' + posted.length + ' record(s) to the server');

    /* ---- the real run --------------------------------------------------- */
    const receipt = await page.evaluate(() => window.__mlsJunkScrub.run({ apply: true }));
    await page.evaluate(() => window.__mlsPtsStore.flushNow());
    await page.waitForTimeout(1200);

    eq(receipt.mode, 'applied', 'the run did not report itself as applied');
    eq(receipt.flaggedPatients, 1, 'the run flagged ' + receipt.flaggedPatients + ' charts, expected 1');
    eq(receipt.flaggedVisits, 1, 'the run flagged ' + receipt.flaggedVisits + ' visits, expected 1');
    eq(receipt.appliedPatients, 1, 'the run wrote to ' + receipt.appliedPatients + ' charts, expected 1');
    eq(receipt.errors, 0, 'the run reported ' + receipt.errors + ' write errors');
    eq(receipt.complete, true, 'the run did not finish');
    /* D is the never-empty refusal, and it must be COUNTED, not silent */
    ok(receipt.refusedBodies >= 1, 'the all-junk body was not recorded as a refusal: ' + JSON.stringify(receipt.refusals));
    eq(receipt.refusals['would-empty'], 1, 'the all-junk refusal was filed under the wrong reason: ' + JSON.stringify(receipt.refusals));
    /* 8 — the day, and no identity */
    eq(receipt.days.join(','), '2026-07-16', 'the receipt named the wrong affected days: ' + JSON.stringify(receipt.days));
    const rjson = JSON.stringify(receipt);
    for (const secret of ['Zzyxandra', 'Quilfeather', 'qq-A', 'MRNQQ', 'lumbar', 'gabapentin']) {
      eq(rjson.indexOf(secret), -1, 'the receipt leaked "' + secret + '": ' + rjson);
    }

    const after = await page.evaluate(() => {
      const out = {};
      (window.getPatients() || []).forEach((p) => {
        out[p.id] = { json: JSON.stringify(p), updated: p.updated, visit: (p.visits || [])[0] || null };
      });
      return out;
    });

    /* 1 — A shrank, to exactly the clinical sentence */
    const vA = after['qq-A'].visit;
    ok(vA, 'chart A lost its visit');
    ok(vA.raw.length < BODY_A.length, 'chart A did not shrink: ' + vA.raw.length + ' vs ' + BODY_A.length);
    eq(vA.raw, NOTE_A, 'chart A was not cleaned to exactly its clinical sentence: ' + JSON.stringify(vA.raw));
    ok(BODY_A.length - vA.raw.length > 200,
      'chart A only lost ' + (BODY_A.length - vA.raw.length) + ' bytes out of a ' + JUNK.length + '-byte junk prefix');
    /* 2 — the untouched original is stored beside it */
    ok(vA._rawBeforeScrub && typeof vA._rawBeforeScrub.raw === 'string', 'chart A has no _rawBeforeScrub copy');
    eq(vA._rawBeforeScrub.raw, BODY_A, 'the kept original is not byte-identical to what was stored before');
    ok(typeof vA._junkScrubbedAt === 'number' && vA._junkScrubbedAt > 0, 'chart A was not stamped with when it was cleaned');
    ok(Array.isArray(vA._junkScrubRules) && vA._junkScrubRules.length > 0, 'chart A does not record WHICH rules touched it');
    /* the visit itself is still a visit: nothing structural was lost */
    eq(vA.id, 'v-A', 'the cleaned visit lost its id');
    eq(vA.date, '2026-07-16', 'the cleaned visit lost its date');
    eq(vA.bodyComplete, true, 'the cleaned visit lost bodyComplete — the husk guard would treat it as an empty projection');
    eq(after['qq-A'].visit && (after['qq-A'].json.match(/"id":"v-A"/g) || []).length, 1, 'chart A gained or lost a visit row');

    /* 3 — updatedAt bumped for A, and ONLY for A */
    ok(after['qq-A'].updated > before['qq-A'].updated,
      'chart A\'s updated was not bumped (' + before['qq-A'].updated + ' -> ' + after['qq-A'].updated + '), so the sync path will never push it');
    for (const id of UNTOUCHED) {
      eq(after[id].updated, before[id].updated, 'chart ' + id + ' had its updated bumped although nothing changed');
    }

    /* 4 — every other chart is byte-identical */
    for (const id of UNTOUCHED) {
      eq(after[id].json, before[id].json, 'chart ' + id + ' was rewritten and must not have been');
    }
    /* stated explicitly, because these are the four dangerous cases */
    eq(after['qq-B'].visit.raw, BODY_B, 'a clean Athena body was rewritten');
    ok(after['qq-B'].visit.raw.indexOf('Laceration to right forearm, 4 cm') >= 0,
      'the clinical sentence the SHARED display cleaner destroys was destroyed here too');
    eq(after['qq-C'].visit.raw, BODY_C, 'a DOCTOR-authored body was rewritten');
    eq(after['qq-D'].visit.raw, BODY_D, 'an all-junk body was emptied instead of refused');
    eq(after['qq-E'].visit.raw, BODY_E, 'an already-scrubbed body was scrubbed again');

    /* 5 — the sync path picked it up */
    const queued = await page.evaluate(() => window._pendingSyncGet());
    const sawA = queued.indexOf('qq-A') >= 0 || posted.some((b) => b && b.external_id === 'qq-A');
    ok(sawA, 'chart A never entered the pending server-sync queue: ' + JSON.stringify(queued));
    for (const id of UNTOUCHED) {
      eq(queued.indexOf(id), -1, 'chart ' + id + ' was queued for a server push although nothing changed');
    }
    const postA = posted.filter((b) => b && b.external_id === 'qq-A');
    ok(postA.length >= 1, 'the server mirror never received chart A (' + posted.length + ' POSTs seen)');
    const sentVisit = postA[postA.length - 1].data.visits[0];
    eq(sentVisit.raw, NOTE_A, 'the server was sent a body that is not the cleaned text: ' + JSON.stringify(sentVisit.raw));
    eq(sentVisit._rawBeforeScrub.raw, BODY_A, 'the untouched original did not travel to the server with the record');
    ok(posted.every((b) => !b || UNTOUCHED.indexOf(String(b.external_id)) < 0),
      'an unchanged chart was pushed to the server: ' + JSON.stringify(posted.map((b) => b && b.external_id)));

    /* 6 — idempotent */
    const postsBeforeSecond = posted.length;
    const second = await page.evaluate(() => window.__mlsJunkScrub.run({ apply: true }));
    await page.evaluate(() => window.__mlsPtsStore.flushNow());
    await page.waitForTimeout(800);
    eq(second.flaggedVisits, 0, 'a SECOND run flagged ' + second.flaggedVisits + ' visits — the migration is not idempotent');
    eq(second.appliedPatients, 0, 'a SECOND run rewrote ' + second.appliedPatients + ' charts');
    const afterSecond = await page.evaluate(() => {
      const out = {};
      (window.getPatients() || []).forEach((p) => { out[p.id] = JSON.stringify(p); });
      return out;
    });
    for (const id of Object.keys(after)) {
      eq(afterSecond[id], after[id].json, 'a SECOND run changed stored bytes for ' + id);
    }
    eq(posted.length, postsBeforeSecond, 'a SECOND run pushed ' + (posted.length - postsBeforeSecond) + ' more record(s) to the server');

    /* 7 — it survives a reload, out of IndexedDB */
    await bootShell(page, url);
    const reloaded = await page.evaluate(async () => {
      /* same reason as the seed step: the boot barrier initialised the store
         before this harness adopted its account, so re-init against it. No
         migrate() here — the IndexedDB record must already be there. */
      await window.__mlsPtsStore.init();
      const rows = window.getPatients() || [];
      const a = rows.filter((p) => p.id === 'qq-A')[0] || null;
      const b = rows.filter((p) => p.id === 'qq-B')[0] || null;
      return {
        mode: window.__mlsPtsStore.mode(), count: rows.length,
        aRaw: a && a.visits[0].raw, aKept: a && a.visits[0]._rawBeforeScrub && a.visits[0]._rawBeforeScrub.raw,
        bRaw: b && b.visits[0].raw
      };
    });
    eq(reloaded.mode, 'idb', 'after a reload the store is not serving from IndexedDB');
    eq(reloaded.count, SEED.length, 'a reload lost patients: ' + reloaded.count + ' of ' + SEED.length);
    eq(reloaded.aRaw, NOTE_A, 'the cleaned body did not survive a reload out of IndexedDB');
    eq(reloaded.aKept, BODY_A, 'the untouched original did not survive a reload out of IndexedDB');
    eq(reloaded.bRaw, BODY_B, 'an untouched body changed across a reload');

    ok(pageErrors.length === 0, 'the shell threw during the run: ' + JSON.stringify(pageErrors.slice(0, 4)));

    console.log('junk-scrub-migration-runtime: OK — 1 of 5 charts cleaned (' + (BODY_A.length - NOTE_A.length)
      + ' bytes removed, original kept, updated bumped, mirrored to the server as cleaned text); '
      + '4 charts byte-identical (clean / doctor-authored / all-junk-refused / already-scrubbed); '
      + 'second run a no-op; survived a reload out of IndexedDB.');
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
