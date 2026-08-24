'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

/* The easy lane must not claim ownership merely because its node is connected:
 * a zero-word stopped turn can leave it under a hidden ancestor during the
 * engine repaint. If that stale node claims ownership, the engine's editable
 * transcript is hidden too and the clinician has nowhere to type. */
const ownerStart = source.indexOf('var laneCandidate =');
const ownerEnd = source.indexOf('      if (body.classList.contains(\'ez3fl-top-owns\')', ownerStart);
assert(ownerStart >= 0 && ownerEnd > ownerStart, 'visible transcript ownership guard is missing');
const ownerBlock = source.slice(ownerStart, ownerEnd);
assert(ownerBlock.includes('topLaneIsVisible(laneCandidate)'),
  'transcript ownership still follows DOM attachment instead of visible geometry');
assert(ownerBlock.includes('var wantOwns = !staff && laneVisible'),
  'hidden easy lanes can still hide the engine transcript');

function functionBlock(input, name) {
  const start = input.indexOf(`function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const brace = input.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return input.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const visibleCode = functionBlock(source, 'topLaneIsVisible');
const syncCode = functionBlock(source, 'syncRealTranscript');
const body = {
  classList: { contains() { return false; } },
  contains(node) { return !!node && node.parentNode === this; }
};
const visit = { computedDisplay: 'block' };
const nodes = new Map([['visitView', visit]]);
const context = {
  document: {
    body,
    get activeElement() { return null; },
    getElementById(id) { return nodes.get(id) || null; }
  },
  window: { innerWidth: 1200, innerHeight: 900 },
  getComputedStyle(node) { return { display: node.computedDisplay || 'block', visibility: 'visible' }; },
  $(id) { return nodes.get(id) || null; },
  finalText: '',
  Event: function Event(type) { this.type = type; }
};
vm.createContext(context);
vm.runInContext(`${visibleCode}\nthis.__visible = topLaneIsVisible;`, context);

const zeroLane = {
  parentNode: body,
  computedDisplay: 'flex',
  getBoundingClientRect() { return { width: 0, height: 0, top: 0, bottom: 0, left: 0, right: 0 }; }
};
assert.strictEqual(context.__visible(zeroLane), false,
  'zero-word stopped lane was incorrectly treated as a visible transcript owner');

const visibleLane = {
  parentNode: body,
  computedDisplay: 'flex',
  getBoundingClientRect() { return { width: 640, height: 180, top: 100, bottom: 280, left: 20, right: 660 }; }
};
assert.strictEqual(context.__visible(visibleLane), true,
  'a real visible easy transcript lane was rejected as an owner');

const canonical = { value: '', dispatches: 0, dispatchEvent() { this.dispatches++; } };
nodes.set('transcript', canonical);
vm.runInContext(`${syncCode}\nthis.__sync = syncRealTranscript;`, context);
context.__sync('Synthetic stopped visit text for the live type/paste path.');
assert.strictEqual(canonical.value, 'Synthetic stopped visit text for the live type/paste path.');
assert.strictEqual(canonical.dispatches, 1, 'typing in the visible owner did not notify the canonical transcript');
assert.strictEqual(context.finalText, 'Synthetic stopped visit text for the live type/paste path. ');

console.log('PASS zero-word stopped visit: hidden easy lane cannot suppress the editable owner, and visible typing syncs #transcript');
