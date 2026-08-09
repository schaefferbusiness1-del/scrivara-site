'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

const helperStart = app.indexOf('function _ptLastSeenText(note)');
const helperEnd = app.indexOf('function _ptItemHtml', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'patient last-seen source formatter is missing');
const context = { Date };
vm.createContext(context);
vm.runInContext(app.slice(helperStart, helperEnd) + '\nthis.formatLastSeen=_ptLastSeenText;', context);

const stamp = new Date(2026, 6, 27, 12).getTime();
const raw = new Date(stamp).toLocaleDateString();
const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
const expected = numeric
  ? 'last seen ' + new Date(+numeric[3], +numeric[1] - 1, +numeric[2]).toLocaleDateString([], {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  : 'Seen ' + raw;
assert.strictEqual(context.formatLastSeen({ updated: stamp }), expected,
  'source formatting differs from the retired display-only observer');

const renderStart = app.indexOf('function renderPatients()');
const renderEnd = app.indexOf('function _ptItemHtml', renderStart);
const render = app.slice(renderStart, renderEnd);
assert(render.includes("shown.map(function(p){ return _ptItemHtml(p,''); })"),
  'active patient state still participates in the flat-list HTML signature');
assert(render.includes("groups[g].map(function(p){ return _ptItemHtml(p,''); })"),
  'active patient state still participates in grouped-list HTML signatures');
assert(render.includes('_ptPatchActive(list,activeId,_phRebuilt)') &&
  render.includes('_ptPatchActive(list,activeId,_pgRebuilt)'),
  'patient selection does not patch the existing prior/next rows');
assert(app.includes('data-patient-id="${esc(p.id)}"') && app.includes('pt-active-badge'),
  'patient rows lack stable identity or the targeted active badge');
const showView = app.slice(app.indexOf('function showView(v)'), app.indexOf('function renderPatientBar()', app.indexOf('function showView(v)')));
assert(!showView.includes('renderPatientBar()') && !showView.includes('updateNavCounts()'),
  'route navigation regained a full-roster patient-bar/count refresh');
assert(!/renderPatients\(\);\s*renderProfile\(\);\s*renderPatientBar\(\);\s*updateNavCounts\(\)/.test(app),
  'patient selection/save still repeats navigation counting after renderPatients');
const copilotNavigate = app.slice(app.indexOf('function _copilotNavigate'), app.indexOf('function _copilotDoAction'));
assert(!copilotNavigate.includes("if(v==='patients'&&typeof renderPatients"),
  'Copilot Patients navigation still renders the directory twice');

for (const [name, source] of [['production', connect], ['staging', staging]]) {
  assert(!source.includes('data-mls-asset="feat_mls_lastseen_rows.js"'),
    `${name} still loads the whole-document last-seen row observer`);
}

console.log('PASS patient row stability: active selection preserves row HTML and last-seen text is emitted at source');
