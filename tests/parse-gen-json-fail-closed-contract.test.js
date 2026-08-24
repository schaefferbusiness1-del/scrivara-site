'use strict';

/* The model response parser must preserve a missing/blank/non-string note so
 * the existing structured quality gate can reject it before editor mutation.
 * It must never substitute the full JSON payload or insurance_note as note. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html', 'ScribeFlow-staging.html'];
function read(name) { return fs.readFileSync(path.join(ROOT, name), 'utf8'); }
function extract(source, signature) {
  const start = source.indexOf(signature); assert(start >= 0, 'missing ' + signature);
  const brace = source.indexOf('{', start); let depth = 0; let quote = ''; let escaped = false;
  for (let i = brace; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated ' + signature);
}

for (const name of SHELLS) {
  const source = read(name);
  const parse = extract(source, 'function parseGenJSON(content)');
  const sandbox = { emrText: () => '—', Object, Array, JSON, String };
  vm.runInNewContext(parse + '\nthis.parseGenJSON=parseGenJSON;', sandbox, { filename: name });
  const cases = [
    [{ insurance_note: 'INSURANCE ONLY' }, undefined, 'missing note'],
    [{ note: '' , insurance_note: 'INSURANCE ONLY' }, '', 'blank note'],
    [{ note: 42, insurance_note: 'INSURANCE ONLY' }, 42, 'non-string note'],
    [{ note: null, insurance_note: 'INSURANCE ONLY' }, null, 'null note'],
    [{ note: 'HPI: valid\nROS: valid\nEXAM: valid\nASSESSMENT: valid\nPLAN: valid' }, 'HPI: valid\nROS: valid\nEXAM: valid\nASSESSMENT: valid\nPLAN: valid', 'valid note'],
  ];
  for (const [payload, expected, label] of cases) {
    const result = sandbox.parseGenJSON(JSON.stringify(payload));
    assert.strictEqual(result.note, expected, `${name}: ${label} was substituted or coerced`);
    if (label !== 'valid note') assert.notStrictEqual(result.note, result.insuranceNote, `${name}: ${label} used insurance_note as note`);
  }
}

console.log('PASS parseGenJSON fail-closed contract: missing, blank, null, and non-string note fields remain invalid instead of falling back to payload or insurance_note');
