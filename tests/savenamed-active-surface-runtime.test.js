'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const repo = path.resolve(__dirname, '..');
const candidate = process.argv[2] || path.resolve(repo, 'background.js');
const source = fs.readFileSync(candidate, 'latin1');
const begin = source.indexOf('var SNV_SAVE_CORES');
const end = source.indexOf('/* ATHENA_ACTION_V2_SAVENAMED_HELPERS_END */', begin);
assert(begin > 0 && end > begin, 'candidate named-save helpers not found');
const helpers = source.slice(begin, end);

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function rect(left, top, width, height) { return { left, top, width, height, right: left + width, bottom: top + height }; }
function node(desc, box, parent) {
  const attrs = Object.assign({}, desc.attrs || {});
  return {
    id: desc.id || '', name: desc.name || '', className: desc.className || '', textContent: desc.text || '', value: desc.value || '',
    parentElement: parent || null,
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    getBoundingClientRect() { return box; }
  };
}
function frame(controls, body) { return { controls, doc: { body }, w: { innerWidth: 1280, innerHeight: 800 } }; }

function load() {
  const factory = new Function('hetDiag', 'norm', 'label', 'exactSave', 'wsForbiddenControl', 'parentAcrossRoots', 'interactive',
    helpers + '\nreturn { snvSaveScope, snvInActiveViewport, snvFindEncounterSave };');
  const diag = {};
  const api = factory(diag,
    value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(),
    el => String(el.textContent || el.value || ''),
    el => /^save(?: draft| note)?$/i.test(String(el.textContent || el.value || '').trim()),
    () => false,
    el => el && el.parentElement,
    doc => doc.__frame.controls);
  return { api, diag };
}

/* Live-realistic closed Visits and Cases projection: styles are visible and
   every rectangle has size, but the mounted slideout is far left of the active
   viewport. It must not become the encounter Save merely because it is unique. */
{
  const { api, diag } = load();
  const body = node({ className: 'encounter-page exam' }, rect(0, 0, 1280, 800));
  const slideout = node({ className: 'slideout chart-component' }, rect(-1465, 0, 1180, 800), body);
  const metric = node({ className: 'section metric-location' }, rect(-1450, 0, 1100, 800), slideout);
  const visits = node({ className: 'visits-and-cases-container' }, rect(-1435, 0, 1000, 800), metric);
  const external = node({ className: 'external-encounter-view' }, rect(-1420, 0, 900, 800), visits);
  const footer = node({ className: 'external-encounter-footer document-footer' }, rect(-1414, 740, 850, 60), external);
  const save = node({ className: 'save-button', text: 'Save' }, rect(-1414, 772, 49, 28), footer);
  const fr = frame([save], body); fr.doc.__frame = fr;
  eq(api.snvFindEncounterSave(fr), null, 'offscreen closed projection was accepted');
  eq(diag.savenamed, 'save-control-not-active-surface', 'offscreen projection refusal lost its specific code');
}

/* A mounted history projection is refused even if animation temporarily puts
   its Save rectangle inside the viewport. */
{
  const { api, diag } = load();
  const body = node({ className: 'encounter-page exam' }, rect(0, 0, 1280, 800));
  const history = node({ className: 'visits-and-cases-container slideout' }, rect(0, 0, 500, 700), body);
  const external = node({ className: 'external-encounter-view' }, rect(0, 0, 500, 700), history);
  const save = node({ className: 'save-button', text: 'Save' }, rect(20, 650, 49, 28), external);
  const fr = frame([save], body); fr.doc.__frame = fr;
  eq(api.snvFindEncounterSave(fr), null, 'onscreen history projection was accepted');
  eq(diag.savenamed, 'save-control-not-active-surface', 'history projection refusal lost its specific code');
}

/* The active encounter's one exact Save remains reachable, and a closed
   projection beside it neither creates ambiguity nor displaces it. */
{
  const { api, diag } = load();
  const body = node({ className: 'encounter-page exam' }, rect(0, 0, 1280, 800));
  const active = node({ className: 'clinical-documentation encounter-workspace' }, rect(0, 0, 1280, 800), body);
  const activeSave = node({ className: 'save-button', text: 'Save' }, rect(1100, 740, 80, 32), active);
  const projection = node({ className: 'external-encounter-view slideout' }, rect(-1400, 0, 900, 800), body);
  const projectedSave = node({ className: 'save-button', text: 'Save' }, rect(-1390, 740, 80, 32), projection);
  const fr = frame([projectedSave, activeSave], body); fr.doc.__frame = fr;
  const found = api.snvFindEncounterSave(fr);
  ok(found && found.control === activeSave, 'one active encounter Save was not selected');
  eq(diag.savenamed, 'found', 'active Save did not produce the found verdict');
}

console.log('PASS savenamed-active-surface-runtime: ' + checks + ' checks');
