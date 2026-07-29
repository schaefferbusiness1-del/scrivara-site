'use strict';

/* 2026-07-28 owner directive: writing must be theoretically flawless — a
 * write may be CONFIRMED only by evidence that could not exist without the
 * write. The landed() verifier in all three typing drivers carried a length
 * fallback ("field holds >=15 chars") that would confirm a FAILED paste into
 * any field that was already populated — a false "it saved" is the worst
 * possible outcome for a clinical note. v3.0.38: landed() snapshots the field
 * BEFORE the first write attempt and the fallback refuses when the content
 * did not change. This suite executes the shipped landed() bytes. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');

/* every driver carries the pre-write snapshot and the change-guard */
const snapshots = (bg.match(/var __mlsWrote0 = rd\(\), __mlsWrote0N = norm\(__mlsWrote0\);/g) || []).length;
assert.strictEqual(snapshots, 3, 'all three typing drivers must snapshot the field before writing (found ' + snapshots + ')');
const guards = (bg.match(/if \(norm\(cur\) === __mlsWrote0N\) return false;/g) || []).length;
assert.strictEqual(guards, 3, 'all three landed() verifiers must refuse an unchanged field (found ' + guards + ')');

/* execute the shipped landed() bytes with controlled closures */
const m = bg.match(/function landed\(\) \{[^\n]*__mlsWrote0N[^\n]*\}/);
assert(m, 'hardened landed() not found');
function makeLanded(fieldReads, txt, before, masked) {
  let i = 0;
  const ctx = {
    rd: () => fieldReads[Math.min(i++, fieldReads.length - 1)],
    norm: s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    digits: s => String(s || '').replace(/\D/g, ''),
    masked: !!masked,
    txt: txt,
    __mlsWrote0N: String(before || '').replace(/\s+/g, ' ').trim().toLowerCase()
  };
  return Function('rd', 'norm', 'digits', 'masked', 'txt', '__mlsWrote0N',
    m[0] + '\nreturn landed();')(ctx.rd, ctx.norm, ctx.digits, ctx.masked, ctx.txt, ctx.__mlsWrote0N);
}

const OLD = 'Existing prior clinical text already in this field 12345';
const NOTE = 'Operative note: right total knee arthroplasty performed today without complication.';

/* 1. THE KILLED CLASS: pre-filled field, write failed (content unchanged) ->
      must NOT confirm, even though the field holds far more than 15 chars. */
assert.strictEqual(makeLanded([OLD], NOTE, OLD), false,
  'a failed write into a pre-filled field must never read as landed');

/* 2. a real landing (content now contains the note) -> confirmed */
assert.strictEqual(makeLanded([NOTE], NOTE, OLD), true, 'a genuine landing still confirms');

/* 3. empty field before, long content after (formatting drifted) -> the
      length fallback may confirm because the field CHANGED */
assert.strictEqual(makeLanded(['some transformed representation of it'], NOTE, ''), true,
  'a changed field may still use the length fallback');

/* 4. masked digits path unaffected */
assert.strictEqual(makeLanded(['07/28/2026'], '7/28/2026', '', true), true, 'masked digit match still confirms');

console.log('write-confirm-requires-change: PASS');
