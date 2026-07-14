const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const asset = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
const marker = '/*! visit-control continuity';
const at = asset.indexOf(marker);
assert(at >= 0, 'visit-control continuity module is missing');
const code = asset.slice(at);

new vm.Script(code, { filename: 'copilot-dock-fullheight.js' });
assert(!/chrome\.|browser\.|extension/i.test(code), 'Copilot dock fix must remain website-only');

assert(
  code.includes('#copilotDockBody{min-height:0;overflow:hidden!important;padding:0!important;display:flex!important;flex-direction:column;}'),
  'Copilot dock body must be a non-scrolling full-height flex column'
);
assert(
  code.includes('#copilotDockBody>#copilotCard{box-sizing:border-box;display:flex!important;flex:1 1 auto!important;flex-direction:column;min-height:0!important;max-height:none!important;height:100%!important;width:100%!important;'),
  'Copilot card must fill the dock body'
);
assert(
  code.includes('#copilotDockBody #copilotThread{box-sizing:border-box;order:2;flex:1 1 auto!important;min-height:120px!important;max-height:none!important;width:100%;'),
  'Copilot conversation must absorb remaining sidebar height'
);
assert(
  code.includes('#copilotDockBody #copilotCard>.note{box-sizing:border-box;order:4;'),
  'Copilot safety note must sit above the composer'
);
assert(
  code.includes('#copilotDockBody #copilotInputRow{box-sizing:border-box;order:5;flex:0 0 auto!important;display:grid!important;grid-template-columns:minmax(0,1fr) 46px 46px;'),
  'Copilot composer must be a full-width bottom bar'
);
assert(
  code.includes('#copilotDockBody #copilotMicBtn,#copilotDockBody #copilotSendBtn{box-sizing:border-box;width:46px!important;height:46px!important;'),
  'Composer actions must retain stable square controls'
);

console.log('PASS Copilot dock: full-height conversation and bottom composer bar');
