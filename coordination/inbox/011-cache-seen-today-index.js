'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'opnote-draft-quarantine-contract.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const indexHelper =
  "  var seenTodayCache = null;\n" +
  "  function seenTodayIndex(nm, today) {\n" +
  "    try {\n" +
  "      var cacheApi = window.__mlsStoreCache;\n" +
  "      if (!cacheApi || !isFn(cacheApi.ver) || !isFn(window.uns)) return null;\n" +
  "      var ver = Number(cacheApi.ver()), key = String(window.uns('patients') || '');\n" +
  "      if (!isFinite(ver) || ver < 0 || !key) return null;\n" +
  "      if (!seenTodayCache || seenTodayCache.ver !== ver || seenTodayCache.key !== key || seenTodayCache.day !== today) {\n" +
  "        var counts = Object.create(null), ids = Object.create(null);\n" +
  "        var ps = (isFn(window.getPatients) ? window.getPatients() : []) || [];\n" +
  "        for (var p = 0; p < ps.length; p++) {\n" +
  "          var pn = String(ps[p] && ps[p].name || '').trim().toLowerCase(); if (!pn) continue;\n" +
  "          counts[pn] = (counts[pn] || 0) + 1; if (counts[pn] === 1) ids[pn] = String(ps[p].id);\n" +
  "        }\n" +
  "        var byId = Object.create(null), noIdName = Object.create(null), anyName = Object.create(null);\n" +
  "        var notes = (isFn(window.getNotes) ? window.getNotes() : []) || [];\n" +
  "        for (var n = 0; n < notes.length; n++) {\n" +
  "          var note = notes[n]; if (!note || note.isDraft) continue;\n" +
  "          if (localYmd(new Date(note.updated || note.created || 0)) !== today) continue;\n" +
  "          var nn = String(note.patient || '').trim().toLowerCase(); if (nn) anyName[nn] = 1;\n" +
  "          if (note.patientId) byId[String(note.patientId)] = 1; else if (nn) noIdName[nn] = 1;\n" +
  "        }\n" +
  "        seenTodayCache = { ver: ver, key: key, day: today, counts: counts, ids: ids, byId: byId, noIdName: noIdName, anyName: anyName };\n" +
  "      }\n" +
  "      if (seenTodayCache.counts[nm] === 1) return !!(seenTodayCache.byId[seenTodayCache.ids[nm]] || seenTodayCache.noIdName[nm]);\n" +
  "      return !!seenTodayCache.anyName[nm];\n" +
  "    } catch (e) { return null; }\n" +
  "  }\n\n";

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  '  function installF2() {',
  indexHelper + '  function installF2() {',
  'F2 seen-today versioned index'
);

connect = replaceExactlyOnce(
  connect,
  "          var nm = String(name || '').trim().toLowerCase(); if (!nm) return false;\n          var today = todayLocal();",
  "          var nm = String(name || '').trim().toLowerCase(); if (!nm) return false;\n          var today = todayLocal();\n          var cachedSeen = seenTodayIndex(nm, today); if (cachedSeen !== null) return cachedSeen;",
  'F2 seen-today indexed fast path'
);

test = replaceExactlyOnce(
  test,
  "console.log('PASS op-note draft quarantine: PDF/routing/sign gates fail closed on unresolved placeholders, and visit counters exclude drafts with id-reconciled seen-today');",
  "/* 2026-07-29: F2 builds one exact seen index per account/day/store version. */\nassert(f2.includes('seenTodayIndex(nm, today)') && f2.includes('cachedSeen !== null'),\n  'F2 _seenToday no longer uses the versioned index before its scan fallback');\n{\n  const helperStart = connect.indexOf('var seenTodayCache = null;');\n  const helperEnd = connect.indexOf('\\n  function installF2() {', helperStart);\n  assert(helperStart >= 0 && helperEnd > helperStart, 'F2 seen-today index helper is missing');\n  const helper = connect.slice(helperStart, helperEnd);\n  let version = 1, account = 'synthetic-a', patientReads = 0, noteReads = 0;\n  const patients = [\n    { id: 'same-1', name: 'Synthetic Duplicate' },\n    { id: 'same-2', name: 'Synthetic Duplicate' },\n    { id: 'unique-1', name: 'Synthetic Unique' },\n    { id: 'legacy-1', name: 'Synthetic Legacy' },\n    { id: 'draft-1', name: 'Synthetic Draft' },\n    { id: 'old-1', name: 'Synthetic Old' }\n  ];\n  const notes = [\n    { patient: 'Synthetic Unique', patientId: 'wrong-id', updated: '2026-07-29T12:00:00Z' },\n    { patient: 'Synthetic Duplicate', patientId: 'same-1', updated: '2026-07-29T12:00:00Z' },\n    { patient: 'Synthetic Legacy', updated: '2026-07-29T12:00:00Z' },\n    { patient: 'Synthetic Draft', isDraft: true, updated: '2026-07-29T12:00:00Z' },\n    { patient: 'Synthetic Old', updated: '2026-07-28T12:00:00Z' }\n  ];\n  const indexedCtx = {\n    window: {\n      __mlsStoreCache: { ver() { return version; } },\n      uns(suffix) { return account + '::' + suffix; },\n      getPatients() { patientReads++; return patients; },\n      getNotes() { noteReads++; return notes; }\n    },\n    isFn(f) { return typeof f === 'function'; },\n    localYmd(d) { return d.toISOString().slice(0, 10); },\n    Date, Number, String, Object, isFinite\n  };\n  vm.createContext(indexedCtx);\n  vm.runInContext(helper + '\\nthis.seenTodayIndex=seenTodayIndex;', indexedCtx,\n    { filename: 'f2-seen-today-index.js' });\n  const seen = indexedCtx.seenTodayIndex;\n  assert.strictEqual(seen('synthetic unique', '2026-07-29'), false,\n    'a same-name note carrying the wrong unique patient id counted as seen');\n  assert.strictEqual(seen('synthetic duplicate', '2026-07-29'), true,\n    'an ambiguous name lost the historical note.patient fallback');\n  assert.strictEqual(seen('synthetic legacy', '2026-07-29'), true,\n    'an id-less legacy note stopped counting for a unique patient');\n  assert.strictEqual(seen('synthetic draft', '2026-07-29'), false, 'a draft counted as seen');\n  assert.strictEqual(seen('synthetic old', '2026-07-29'), false, 'a prior-day note counted as seen');\n  seen('synthetic duplicate', '2026-07-29'); seen('synthetic legacy', '2026-07-29');\n  assert.strictEqual(patientReads, 1, 'same-version seen checks rebuilt the patient index');\n  assert.strictEqual(noteReads, 1, 'same-version seen checks rebuilt the note index');\n  notes.push({ patient: 'Different display', patientId: 'unique-1', updated: '2026-07-29T13:00:00Z' });\n  assert.strictEqual(seen('synthetic unique', '2026-07-29'), false,\n    'cache changed without a store-version invalidation');\n  version++;\n  assert.strictEqual(seen('synthetic unique', '2026-07-29'), true,\n    'store-version invalidation did not expose a new exact-id note');\n  account = 'synthetic-b';\n  seen('synthetic unique', '2026-07-29');\n  assert.strictEqual(patientReads, 3, 'account-key change did not rebuild the seen index');\n  assert.strictEqual(seen('synthetic unique', '2026-07-30'), false,\n    'day-key change did not exclude the prior-day note');\n  assert.strictEqual(patientReads, 4, 'day-key change did not rebuild the seen index');\n}\n\nconsole.log('PASS op-note draft quarantine: PDF/routing/sign gates fail closed on unresolved placeholders, and visit counters exclude drafts with id-reconciled seen-today');",
  'F2 seen-today indexed runtime contract'
);

test = replaceExactlyOnce(
  test,
  `  const indexedCtx = {
    window: {
      __mlsStoreCache: { ver() { return version; } },
      uns(suffix) { return account + '::' + suffix; },
      getPatients() { patientReads++; return patients; },
      getNotes() { noteReads++; return notes; }
    },`,
  `  let activePatients = patients, activeNotes = notes;
  const indexedCtx = {
    window: {
      __mlsStoreCache: { ver() { return version; } },
      uns(suffix) { return account + '::' + suffix; },
      getPatients() { patientReads++; return activePatients; },
      getNotes() { noteReads++; return activeNotes; }
    },`,
  'F2 seen-today account fixture ownership'
);

test = replaceExactlyOnce(
  test,
  `  account = 'synthetic-b';
  seen('synthetic unique', '2026-07-29');
  assert.strictEqual(patientReads, 3, 'account-key change did not rebuild the seen index');`,
  `  account = 'synthetic-b';
  activePatients = [{ id: 'other-1', name: 'Synthetic Other' }];
  activeNotes = [];
  assert.strictEqual(seen('synthetic unique', '2026-07-29'), false,
    'account-key change leaked the prior account seen index');
  assert.strictEqual(patientReads, 3, 'account-key change did not rebuild the seen index');
  assert.strictEqual(noteReads, 3, 'account-key change did not rebuild the note index');`,
  'F2 seen-today account-isolation assertion'
);

const helperStart = connect.indexOf('var seenTodayCache = null;');
const helperEnd = connect.indexOf('\n  function installF2() {', helperStart);
const f2Start = connect.indexOf('/* _seenToday: same logic as the base app but with LOCAL dates both sides */');
const f2End = connect.indexOf('/* _nextClinicDay:', f2Start);
const f2 = connect.slice(f2Start, f2End);
if (helperStart < 0 || helperEnd <= helperStart ||
    !f2.includes('seenTodayIndex(nm, today)') ||
    !f2.includes('cachedSeen !== null') ||
    !connect.slice(helperStart, helperEnd).includes("window.uns('patients')") ||
    !connect.slice(helperStart, helperEnd).includes('cacheApi.ver()')) {
  throw new Error('F2 seen-today indexed fast-path postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Added an account/day/version-keyed index to F2 seen-today checks.');
