'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const agenda = fs.readFileSync(path.join(root, 'feat_mls_agenda_popover.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

assert(agenda.includes("LEGACY_LAYOUT_STYLE_ID='mls-patientbar-stable-layout'"), 'shared patient bar needs one idempotent layout owner');
assert(agenda.includes('#patientBar{display:grid!important'), 'desktop no-patient bar must use stable grid placement');
assert(agenda.includes('#patientBar>#mlsAgendaChip{grid-column:1;grid-row:1'), 'agenda needs a fixed grid area');
assert(agenda.includes('#patientBar>#patientBarInner{grid-column:2;grid-row:1'), 'patient state needs a fixed grid area');
assert(agenda.includes('#patientBar>#mlsDayProgress{grid-column:1/3;grid-row:2'), 'day progress needs a fixed grid area');
assert(agenda.includes('#patientBar>#mlsRecentPts{grid-column:3;grid-row:2'), 'recent patients needs a fixed grid area');
assert(agenda.includes('#patientBar>.btn-ghost{grid-column:3;grid-row:1'), 'switch-patient action needs a fixed grid area');
assert(agenda.includes('#patientBar>#wf2OneClick{grid-column:4;grid-row:1'), 'Athena draft action needs a fixed grid area');
assert(connect.includes('feat_mls_agenda_popover.js') && connect.includes('?v=20260714ag-stable1'), 'production loader must cache-bust the stable layout release');

console.log('PASS patient bar keeps one layout across periodic chip refreshes');
