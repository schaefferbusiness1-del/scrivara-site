'use strict';
/* cap-mrn-1.0.0 pins: the open-patient capture reply's MRN is digits-only at
   the reply boundary (the backend echoes the banner's raw decoration and it
   varies run-to-run). The normalizer is extracted from the SHIPPED bytes and
   executed against the measured live variants. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const bg = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'background.js'), 'latin1');

const start = bg.indexOf("try { if (res && res.captured && res.captured.mrn != null)");
assert.ok(start > 0, 'the capture MRN normalizer is gone');
const line = bg.slice(start, bg.indexOf('\n', start)).replace(/\r$/, '');
assert.ok(bg.indexOf("callBackend('/api/assist/extract'") < start && start < bg.indexOf('sendResponse(Object.assign({ fromTab: tab.url }, res));'),
  'the normalizer must sit between the backend call and the reply');
const run = new Function('res', line + ' return res;');
assert.strictEqual(run({ captured: { mrn: '#7833832' } }).captured.mrn, '7833832', 'the decorated live variant must normalize');
assert.strictEqual(run({ captured: { mrn: '7833832' } }).captured.mrn, '7833832', 'the clean variant must pass through');
assert.strictEqual(run({ captured: { mrn: 'MRN: 78-33-832' } }).captured.mrn, '7833832', 'labels and separators must strip');
assert.deepStrictEqual(run({ ok: false }), { ok: false }, 'a captureless reply must pass through untouched');

console.log('PASS capture MRN normalize pins: the reply-boundary digits normalization holds for the measured live variants');
