'use strict';

/* wdoc-1.0.0 — the Legal/IME draft downloads as an editable Word document.
 * Owner's father, 2026-08-18: "summarize the report and put into MS Word
 * format for me to make changes."
 *
 * The contract: the Word exit wraps the EXACT draft text the .txt exit uses
 * (letterhead lines, bracketed refusals and all — no second content path),
 * serves it as application/msword with a UTF-8 BOM escape (never a literal
 * BOM byte in source), renders the IME section heads bold, and rides the same
 * enable/disable state as its siblings. Executed below: the heading
 * classifier and the body builder run against real IME-shaped text.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_legalpack.js'), 'latin1');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* ---- wiring pins ---- */
ok(src.includes('id="mlsP1LegalDraftWord" disabled>Download for Word<'), 'the Word button must sit in the draft actions row, disabled until a draft exists');
ok(/\['mlsP1LegalDraftCopy', 'mlsP1LegalDraftDownload', 'mlsP1LegalDraftWord', 'mlsP1LegalDraftPrint'\]/.test(src), 'the Word button must ride the same enable/disable list as its siblings');
ok(/on\('mlsP1LegalDraftWord', 'click', function \(\) \{ exportDraft\(/.test(src), 'the Word exit must export through the SAME exportDraft the .txt exit uses — one content path');
ok(src.includes("'.doc', 'IME draft"), 'the download must be a .doc file');
ok(src.includes("{ type: 'application/msword' }"), 'the blob must be served as application/msword');
ok(src.includes("['\\ufeff', html]"), 'the BOM must be the escape sequence, never a literal BOM byte in source');
ok(!/new Blob\(\['﻿'/.test(src), 'no literal BOM byte may exist in the source (latin1/ASCII discipline)');

/* ---- executed: the heading classifier + body builder ---- */
const start = src.indexOf('function wdocHeadingLine');
const end = src.indexOf('function downloadWord');
ok(start >= 0 && end > start, 'wdoc helpers must exist');
const helpers = src.slice(start, end);
const ctx = vm.createContext({ esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') });
vm.runInContext(helpers + '\nthis.__h = wdocHeadingLine; this.__b = wdocBody;', ctx);

ok(ctx.__h('X. CAUSATION ANALYSIS') === true, 'IME roman-numeral heads classify as headings');
ok(ctx.__h('XI. MEDICAL NECESSITY OF CARE') === true, 'the necessity head classifies as a heading');
ok(ctx.__h('XIV. OPINIONS') === true, 'the opinions head classifies as a heading');
ok(ctx.__h('The patient reports low back pain.') === false, 'prose never classifies as a heading');
ok(ctx.__h('to a reasonable degree of medical certainty') === false, 'lowercase certainty language is prose');

const sample = 'Premier Orthopedic and Sports Medicine\n\nX. CAUSATION ANALYSIS\nThe record supports <this> analysis.\n';
const body = ctx.__b(sample);
ok(body.indexOf('font-weight:bold') >= 0, 'the body must render heads bold');
ok(body.indexOf('&lt;this&gt;') >= 0, 'draft text must be HTML-escaped into the Word body');
ok(body.indexOf('Premier Orthopedic and Sports Medicine') >= 0, 'the letterhead line must ride into the Word body verbatim');
ok((body.match(/<p /g) || []).length === 5, 'every line (blank and trailing included) becomes a paragraph');

/* ---- the template still carries every section the report needs ---- */
for (const head of ['X. CAUSATION ANALYSIS', 'XI. MEDICAL NECESSITY OF CARE', 'XII. FUTURE TREATMENT', 'XIV. OPINIONS']) {
  ok(src.includes(head), 'the IME template must keep its "' + head + '" section');
}
ok(src.includes('reasonable degree of medical certainty'), 'the certainty standard must survive');

console.log('PASS 1p legal Word download: ' + checks + ' checks — one content path, msword blob with escaped BOM, bold IME heads, escaped text, sections and certainty standard intact');
