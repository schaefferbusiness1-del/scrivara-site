'use strict';

/* Regression for the live b1050 symptom: a patient with full Athena bodies
 * stayed at "N being cleaned" long after import.  The renderer removes Athena
 * page furniture synchronously; a readable body must not remain in the pending
 * cleanup count.  This executes the shipped histview block directly and does
 * not rely on a mock browser or a generated copy. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const open = shell.indexOf('<!-- ===== histview-1.0.0');
const styleEnd = shell.indexOf('</style>', open);
const scriptStart = shell.indexOf('<script>', styleEnd);
const scriptEnd = shell.indexOf('</script>', scriptStart);
assert(open >= 0 && styleEnd > open && scriptStart > styleEnd && scriptEnd > scriptStart,
  'histview block could not be isolated');

const win = {};
const context = { window: win, navigator: {}, setTimeout, clearTimeout, setInterval, clearInterval, console };
vm.createContext(context);
vm.runInContext(shell.slice(scriptStart + 8, scriptEnd), context, { filename: 'histview-1.0.0' });
const api = win.__mlsEncView;
assert(api && api.version === 'histview-1.0.0', 'histview renderer did not publish');

const readableWithAthenaChrome =
  'Assessment: lumbar radiculopathy. recently edited this chart at . ' +
  'Refresh to view the most current information.REFRESH CHART';
const readable = api.junk(readableWithAthenaChrome);
assert.strictEqual(readable.illegible, false, 'readable clinical body became illegible');
assert.strictEqual(readable.flagged, false,
  'synchronously cleaned clinical body remained flagged as pending cleanup');
assert.strictEqual(readable.cleaned, true, 'cleaned-body provenance was not retained');

const pureAthenaChrome = 'REFRESH CHART\nrecently edited this chart at .';
const unreadable = api.junk(pureAthenaChrome);
assert.strictEqual(unreadable.illegible, true, 'pure Athena page furniture was not actionable');
assert.strictEqual(unreadable.flagged, true, 'pure page furniture was not counted as pending');
assert.strictEqual(unreadable.cleaned, false, 'unreadable body was marked fully cleaned');

const rows = [
  { id: 'full-a', date: '2026-08-20', type: 'Office visit', raw: readableWithAthenaChrome, source: 'athena-copy' },
  { id: 'full-b', date: '2026-08-19', type: 'Follow-up', raw: 'Clinical follow-up. No new complaints.', source: 'athena-copy' },
  { id: 'pending', date: '2026-08-18', type: 'Office visit', raw: pureAthenaChrome, source: 'athena-copy' },
  { id: 'index', date: '2026-08-17', type: 'Injection', indexOnly: true, raw: '', textHead: '08-17-2026, M Sample, DO', source: 'athena-copy' }
];
win.__mlsPtVisits = {
  version: 'pvr-1.0.0',
  resolve() {
    return { count: rows.length, entries: rows.map((row) => ({
      key: row.id, date: row.date, type: row.type, source: row.source, row
    })) };
  }
};
const view = api.forPatient({ id: 'patient-1' });
assert.strictEqual(view.count, 4, 'resolver count was not preserved');
assert.strictEqual(view.junk, 1, 'readable Athena bodies were counted as pending cleanup');
assert.strictEqual(view.indexOnly, 1, 'index-only count changed while fixing cleanup status');
assert.strictEqual(api.countLine(view), '4 visits · 1 index only · 1 need the full note reread',
  'History header still claims readable bodies are being cleaned');

console.log('PASS visit-history cleaning status: readable Athena bodies are completed synchronously, only unreadable bodies remain actionable');
