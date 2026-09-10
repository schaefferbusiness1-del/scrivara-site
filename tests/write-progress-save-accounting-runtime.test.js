'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '..', '1p-feat_mls_writeflow.js'), 'utf8');
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated ' + name);
}

const SAVENAMED_ROW_ID = 'save-named-sections';
const factory = new Function('S', 'SAVENAMED_ROW_ID', 'wfprogCounts', 'savenamedVerified', 'savenamedRow',
  extract('wfprogSaveStep') + '\n' + extract('wfprogFooterText') + '\nreturn wfprogFooterText;');
const footer = factory(String, SAVENAMED_ROW_ID, () => ({}),
  state => !!state.saved,
  state => state.hasSave ? { id: SAVENAMED_ROW_ID } : null);

let checks = 0;
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function state(savePhase) {
  const rows = ['hpi', 'ros', 'exam', 'assessment-plan'].map(id => ({ id, phase: 'done' }));
  if (savePhase) rows.push({ id: SAVENAMED_ROW_ID, phase: savePhase });
  return { prog: { rows }, hasSave: !!savePhase };
}

eq(footer(state('write'), { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. Encounter save is in progress. MLS never signs.',
  'an in-progress encounter save was counted as a fifth clinical section or described as impossible');
eq(footer(state('done'), { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. Encounter saved and read back. MLS never signs.',
  'a verified encounter save was counted as a section or described as unsaved');
eq(footer(state('refused'), { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. Encounter save was not verified. Inspect Athena before retrying. MLS never signs.',
  'an uncertain encounter save was laundered into a saved or never-attempted state');

const partial = state('wait');
partial.prog.rows[2].phase = 'refused';
partial.prog.rows[3].phase = 'check';
eq(footer(partial, { outside: 1 }),
  '2 sections written, 1 not sent, 2 still to go. After the checked sections are verified, this same Confirm saves the encounter. MLS never signs.',
  'the clinical-section census or pending Save copy is incorrect');

console.log('PASS write-progress-save-accounting-runtime: ' + checks + ' checks');
