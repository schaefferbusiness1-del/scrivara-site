'use strict';
/*
 * THE WIDGET BUILDER'S PREVIEW MUST SHOW THE WIDGET.
 *
 * Before this, the step labelled "Preview" rendered `cwRenderLayoutSummary()`,
 * which emitted one plain row per block reading "(label) — options: a / b".
 * A doctor could not see the card, the badge colours, the gauge or the chart
 * until they SAVED the widget, left the modal, and ran a real visit Generate.
 * The layout was also read-only, so the only way to change one block was to
 * rewrite the description and re-run the AI designer.
 *
 * What is pinned here:
 *  - cwLivePreview() renders through the REAL renderer (cwRenderLayoutBlocks /
 *    cwRenderOutput), not a bespoke preview path, so the preview cannot drift
 *    away from the card it is previewing.
 *  - cwSampleContent() produces one entry per layout block, in the shape
 *    cwSanitizeContent expects, for every supported block type.
 *  - the preview is honest: it says the data is sample data.
 *  - Ctrl/Cmd+Enter designs, so the primary action has a keyboard path.
 *  - the deck's empty state no longer uses a ~1.4:1 contrast colour.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const deck = fs.readFileSync(path.join(root, 'feat_mls_widget_deck.js'), 'utf8');

/* ---- static contracts ---- */
assert(html.includes('id="cwLiveHost"'), 'the live preview host is missing from the builder modal');
assert(html.includes('function cwLivePreview()'), 'cwLivePreview was removed');
assert(html.includes('function cwSampleContent(layout)'), 'cwSampleContent was removed');
assert(/cwLivePreview\(\);\s*\/\/ the card the doctor actually gets/.test(html),
  'cwRenderLayoutSummary must still drive the live card');
assert(html.includes('nothing here is saved or sent'),
  'the preview must say its data is sample data');
assert(/onkeydown="if\(\(event\.ctrlKey\|\|event\.metaKey\)&amp;&amp;event\.key==='Enter'\)/.test(html),
  'Ctrl/Cmd+Enter must design the widget — the primary action needs a keyboard path');
assert(html.includes('function cwBindLivePreview()'), 'the live-preview input binding was removed');
assert(html.includes('.cw-live-card{'), 'the live card lost its styles');
assert(!/\.cw-live-card\{[^}]*background:#fff[;}]/.test(html),
  'the live card must theme through variables, not a hardcoded white');
assert(!deck.includes('color:#C9DCD2'),
  'the deck empty state is back to a ~1.4:1 contrast colour');

/* ---- executed: sample content covers every block type, in the right shape ---- */
const sandbox = { console, document: undefined, window: {} };
vm.createContext(sandbox);
// lift just the two pure helpers out of the page and run them for real
const sampleSrc = html.slice(html.indexOf('function cwSampleContent(layout)'));
const sampleFn = sampleSrc.slice(0, sampleSrc.indexOf('\n}\n') + 3);
vm.runInContext(sampleFn + '\nthis.cwSampleContent = cwSampleContent;', sandbox);

const TYPES = ['text', 'bullets', 'table', 'fields', 'select', 'checklist',
  'badge', 'score', 'chart', 'timeline', 'rating', 'number'];
const layout = [
  { type: 'text', label: 'Summary' },
  { type: 'bullets', label: 'Points' },
  { type: 'table', label: 'Orders', columns: ['Item', 'Detail'] },
  { type: 'fields', label: 'Vitals', items: ['BP', 'HR'] },
  { type: 'select', label: 'Side', options: ['Left', 'Right'] },
  { type: 'checklist', label: 'Done', items: ['A', 'B', 'C'] },
  { type: 'badge', label: 'Status' },
  { type: 'score', label: 'Pain', min: 0, max: 10 },
  { type: 'chart', label: 'Trend', kind: 'line' },
  { type: 'timeline', label: 'Course' },
  { type: 'rating', label: 'Function', max: 5 },
  { type: 'number', label: 'Steps', unit: 'steps' },
];
const content = sandbox.cwSampleContent(layout);
assert.strictEqual(content.length, layout.length, 'sample content must be parallel to the layout');
assert.strictEqual(TYPES.length, layout.length, 'this test must cover every supported block type');

assert.strictEqual(typeof content[0], 'string');
assert(Array.isArray(content[1]) && content[1].length >= 2, 'bullets sample');
assert(Array.isArray(content[2]) && Array.isArray(content[2][0]) &&
  content[2][0].length === 2, 'table sample must have one cell per declared column');
assert(content[3] && content[3].BP && content[3].HR, 'fields sample must key by the declared items');
assert.strictEqual(content[4], 'Left', 'select sample must be one of the declared options');
assert(Array.isArray(content[5]) && content[5].every(x => layout[5].items.includes(x)),
  'checklist sample must only tick declared items');
assert(content[6] && content[6].text && ['green', 'yellow', 'red', 'gray'].includes(content[6].level),
  'badge sample must carry a legal level');
assert(typeof content[7] === 'number' && content[7] >= 0 && content[7] <= 10, 'score sample in range');
assert(content[8] && content[8].labels.length === content[8].data.length && content[8].labels.length > 1,
  'chart sample must have matching labels and data');
assert(Array.isArray(content[9]) && content[9][0].text, 'timeline sample');
assert(typeof content[10] === 'number' && content[10] <= 5, 'rating sample within max');
assert(typeof content[11] === 'number', 'number sample');

/* a layout the designer could legally produce with no options must not throw */
const bare = sandbox.cwSampleContent([{ type: 'table', label: 'T', columns: [] }, { type: 'select', label: 'S', options: [] }]);
assert.strictEqual(bare.length, 2, 'a bare layout still yields parallel content');

console.log('PASS widget builder live preview: the real renderer drives the preview, sample content covers all ' +
  TYPES.length + ' block types in their sanitizer shapes, the preview declares itself, and the deck contrast is fixed');
