'use strict';
/*
 * A NEW SESSION'S BACKUP MUST NOT ERASE ANOTHER SESSION'S RECORDED WORDS
 * -----------------------------------------------------------------------------
 * The held-capture slot in localStorage is keyed by the BOUND CHART, and kioskAmbientStart writes a
 * backup BEFORE the first ROOM word is spoken. Starting a check-in on a chart that still held an
 * UNFILED consultation therefore landed a record with zero room words on top of the only copy of it,
 * returned ok:true, and the doctor's Visit-card offer vanished at the same moment.
 *
 * ⛔ WHY THIS TEST IS SHAPED THE WAY IT IS — a previous version of it was GREEN OVER THE LIVE DEFECT.
 * That version hand-wrote `intake: []` on the placeholder record. The sole shipped writer
 * (kioskAmbientSaveNow) always forwards `intake: kiosk.intake || []`, so after any interview the
 * incoming record carries the whole check-in. A guard testing "no parts AND no intake" therefore
 * could never fire on the path that does the damage, and a fixture passing `intake: []` could never
 * notice. Both the guard and the test agreed with each other and disagreed with production.
 * So this suite does two things about that class of mistake:
 *   1. it builds every record through buildRecord(), mirroring the shipped call site's fields; and
 *   2. it ASSERTS that the field set matches the shipped caller's, read out of the source — so if
 *      kioskAmbientSaveNow ever forwards a field this fixture does not, the suite fails instead of
 *      quietly testing a shape production never produces.
 *
 * ⛔ AND IT RUNS IN A REAL BROWSER ON A REAL ORIGIN: localStorage THROWS on the opaque origin that
 * page.setContent() creates, so a setContent harness cannot see the backup at all.
 */
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.resolve(__dirname, '..');
const SRC = process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js');
const src = fs.readFileSync(SRC, 'utf8');

/* the shipped store layer, lifted by its own markers */
const from = src.indexOf('  var AMBIENT_STORE_KEY');
const to = src.indexOf('  function ambientActionsForStore');
assert.ok(from > 0 && to > from, 'could not extract the ambient store layer');
const layer = src.slice(from, to);
assert.ok(/function ambientStoreWrite/.test(layer) && /function ambientStoreList/.test(layer),
  'the extracted slice is not the store layer');

/* ── THE FIXTURE-FAITHFULNESS CHECK ────────────────────────────────────────────────────────────
   Read the fields the SHIPPED caller forwards, so a fixture that has drifted from production
   cannot pass. This is the assertion whose absence made the previous version of this file
   vacuous. */
const callerAt = src.indexOf('function kioskAmbientSaveNow');
assert.ok(callerAt > 0, 'kioskAmbientSaveNow not found — the caller may have been renamed');
/* ⚠️ STRIP THE COMMENTS FIRST. The call site documents two of its fields with a block comment
   sitting between the comma and the field name, so a lookbehind for `{` or `,` silently misses
   whatever follows a comment — this extractor's first version dropped `consentAt` and accused the
   shipped caller of no longer sending it. The instrument lies first. */
const callArgs = src.slice(src.indexOf('ambientStoreWrite({', callerAt), src.indexOf('});', callerAt))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');
const shippedFields = [...new Set((callArgs.match(/(?:[{,]\s*)([A-Za-z_$][\w$]*)\s*:/g) || [])
  .map((m) => m.replace(/[{,\s:]/g, '')))].sort();
assert.ok(shippedFields.length >= 5,
  'the field extractor found only ' + shippedFields.length + ' fields (' + shippedFields.join(',') +
  '), so it is broken rather than the caller — a faithfulness check that matches nothing would ' +
  'pass vacuously against any fixture');
const FIXTURE_FIELDS = ['sid', 'bound', 'start', 'avName', 'intake', 'actions', 'parts',
  'consentAt', 'intakeFiled'].sort();
assert.deepStrictEqual(shippedFields, FIXTURE_FIELDS,
  'kioskAmbientSaveNow no longer forwards the fields this fixture builds.\n  shipped: ' +
  JSON.stringify(shippedFields) + '\n  fixture: ' + JSON.stringify(FIXTURE_FIELDS) +
  '\n  Update buildRecord() to match, or this suite tests a shape production never produces — ' +
  'which is exactly how the earlier version of this test passed while a consultation was ' +
  'being destroyed on every check-in.');

/* the check-in interview the avatar has ALWAYS collected before the room hand-off. Non-empty is
   the whole point: this is what production sends and what the broken guard could not see past. */
const INTAKE = [['Ava', 'what brings you in today'], ['Patient', 'my lower back'],
  ['Ava', 'how long has it been going on'], ['Patient', 'about three weeks']];
const ROOM = ['the pain radiates into the left leg', 'straight leg raise is positive on the right'];

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><meta charset="utf-8"><title>store</title><body></body>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + port + '/');

  const out = await page.evaluate(({ layer, INTAKE, ROOM }) => {
    const CHART = '7833832';
    const boot = new Function(`
      var kiosk = { ambient: false, ambBound: '${CHART}', sid: '' };
      var safe = function (fn, dflt) { try { var v = fn(); return v === undefined ? dflt : v; } catch (e) { return dflt; } };
      var clean = function (v) { return String(v == null ? '' : v).trim(); };
      var isFn = function (v) { return typeof v === 'function'; };
      var activePtIdSafe = function () { return '${CHART}'; };
      ${layer}
      return { write: ambientStoreWrite, parse: ambientRecParse, keyFor: ambientStoreKeyFor,
               list: ambientStoreList, kiosk: kiosk };
    `);
    const api = boot();
    const key = api.keyFor(CHART);

    /* every record built the way kioskAmbientSaveNow builds it */
    function buildRecord(sid, parts, intake) {
      return { sid: sid, bound: CHART, start: 1000, avName: 'Ava',
        intake: intake, actions: [], parts: parts, consentAt: 1786000000000, intakeFiled: false };
    }
    const R = {};

    /* ── 1. a real consultation from session A, stored by the shipped writer ── */
    localStorage.clear();
    R.first = api.write(buildRecord('office-A', ROOM, INTAKE));

    /* ── 2. THE PRODUCTION PATH: a NEW check-in (session B) on the same chart hands off to the
           room. Zero room words yet, but the FULL interview intake — the shape production sends. */
    R.second = api.write(buildRecord('office-B', [], INTAKE));
    R.atChartKey = api.parse(localStorage.getItem(key));
    const listed = api.list();
    R.listedCount = listed.length;
    R.consultationFound = listed.some((e) => e.rec.sid === 'office-A' && e.rec.parts.length === ROOM.length);
    R.consultationIntake = (listed.filter((e) => e.rec.sid === 'office-A')[0] || { rec: {} }).rec.intake;
    R.asideKeyHasChartPrefix = listed.filter((e) => e.rec.sid === 'office-A')
      .every((e) => e.key.indexOf(key) === 0);
    R.newCaptureBackedUp = !!(R.atChartKey && R.atChartKey.sid === 'office-B');

    /* ── 3. the SAME session saving again with no room words must NOT clone itself ── */
    const before = localStorage.length;
    R.same = api.write(buildRecord('office-B', [], INTAKE));
    R.sameSessionMadeNoCopy = localStorage.length === before;

    /* ── 4. a BODYLESS held record must not be preserved — it can never be offered, so keeping
           it would silt the chart's slot up with nothing ── */
    localStorage.clear();
    api.write(buildRecord('office-C', [], INTAKE));
    api.write(buildRecord('office-D', [], INTAKE));
    R.bodylessKeys = localStorage.length;

    /* ── 5. and a real capture still replaces a real capture only via the aside copy, never by
           silent destruction ── */
    localStorage.clear();
    api.write(buildRecord('office-E', ROOM, INTAKE));
    R.realOverReal = api.write(buildRecord('office-F', ['a different visit entirely'], INTAKE));
    R.afterRealOverReal = (api.parse(localStorage.getItem(key)) || {}).sid;

    return R;
  }, { layer, INTAKE, ROOM });

  await browser.close();
  server.close();

  /* 1 */
  assert.strictEqual(out.first.ok, true, 'the shipped writer failed to store the consultation');

  /* 2 — THE DEFECT, on the shape production actually sends */
  assert.strictEqual(out.consultationFound, true,
    'A NEW CHECK-IN DESTROYED AN UNFILED CONSULTATION. Session B handed off to the room with zero ' +
    'room words and a full interview intake — exactly what kioskAmbientSaveNow sends — and ' +
    "session A's recorded visit is gone. This is the shape the earlier intake-counting guard " +
    'could not see, and the earlier fixture could not produce.');
  assert.deepStrictEqual(out.consultationIntake, INTAKE,
    "the consultation survived but lost its interview answers");
  assert.strictEqual(out.asideKeyHasChartPrefix, true,
    'the preserved consultation is stored under a key that does NOT begin with the chart key, so ' +
    "ambientStoreList's prefix enumeration will never find it — preserved but unreachable");
  assert.strictEqual(out.listedCount, 2,
    'expected both the held consultation and the new capture to be listed, got ' + out.listedCount);

  /* the write must NOT be refused: kiosk.ambSaveOk feeds the patient-facing recording disclosure */
  assert.strictEqual(out.second.ok, true,
    'the write was refused, which sets kiosk.ambSaveOk false and paints the patient-facing ' +
    'recording disclosure as a backup failure on a perfectly healthy store');
  assert.strictEqual(out.newCaptureBackedUp, true,
    "the new check-in got no backup of its own — protecting the old capture must not cost the new " +
    'one its crash protection');

  /* 3 */
  assert.strictEqual(out.sameSessionMadeNoCopy, true,
    'a session saving again with no room words cloned itself; only a DIFFERENT session may be ' +
    'moved aside');

  /* 4 */
  assert.strictEqual(out.bodylessKeys, 1,
    'a bodyless held record was preserved (' + out.bodylessKeys + ' keys). ambientRecoverInfo can ' +
    'never offer it, so every wordless visit would leave a permanent record behind');

  /* 5 */
  assert.strictEqual(out.realOverReal.ok, true, 'a real capture can no longer write at all');
  assert.strictEqual(out.afterRealOverReal, 'office-F',
    'the live capture must hold the plain chart key — that is the one ambientStoreList can ' +
    'reconstruct by direct look without knowing any sid');

  console.log('PASS a new session cannot erase another session\'s recorded words: driven through the ' +
    'shipped writer with the record shape kioskAmbientSaveNow actually sends (0 room words, ' +
    INTAKE.length + ' intake turns), the held consultation survives with its ' + ROOM.length +
    ' room words and all intake under a chart-prefixed aside key, the new check-in still gets its ' +
    'own backup at the plain chart key, ok stays true so the patient-facing disclosure is not ' +
    'falsely reddened, same-session saves make no copy, and bodyless records are not preserved');
})().catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });
