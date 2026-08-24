'use strict';

/* Procedure-template creation is still a staging experiment. Production and
 * P1 keep it excluded: the active supervised lane may use only one already-
 * open exact Procedure Documentation editor and never creates a template. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const production = ['mls-connect.js', '1p-mls-connect.js', 'cloned-mls-connect.js']
  .map(name => fs.readFileSync(path.join(root, name), 'utf8'));
const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const opnote = fs.readFileSync(path.join(root, 'feat_athena_opnote_writeback.js'), 'utf8');
const asset = 'feat_athena_opnote_writeback.js';
const loader = new RegExp('script\\[data-mls-asset="' + asset.replace('.', '\\.') + '"\\]');
for (const source of production) {
  assert(!loader.test(source), 'production connect surface loads the unproven Procedure Documentation mutator');
  assert(source.includes(asset + ' intentionally not loaded'), 'production exclusion must remain explicit and reviewable');
}
assert(loader.test(staging), 'staging no longer exposes the isolated op-note writeback experiment');
const prep = opnote.indexOf("bridge('mlsAppPrepProcTemplate'");
const paste = opnote.indexOf('wb.writeNoteToChart({ note: note });');
assert(prep >= 0 && paste > prep, 'op-note module must prepare the exact template before delegating paste');
assert(opnote.includes("mode: 'prep'"), 'template mutation is not visibly marked as prep-only');
assert(opnote.includes("if (wb && isFn(wb.writeNoteToChart)"), 'op-note module bypasses the existing verified paste gate');
assert(opnote.includes('Procedure Documentation') && opnote.includes('Injection Generic Template'), 'fallback destination is not explicit');
console.log('PASS op-note loader boundary: production/P1/cloned exclude template creation; staging-only prep remains separate from the exact already-open Procedure Documentation lane');
