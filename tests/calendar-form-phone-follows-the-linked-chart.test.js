'use strict';
/* bla-1.0.1 (2026-09-25): the New-appointment form filled the phone number
   from the linked chart, but never replaced or cleared it when the link moved
   or dropped - retyping the name (or another chart's name) saved the previous
   patient's number with the new name. A number the person typed stays. */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let checks = 0;
function extract(src, sig) {
  const s = src.indexOf(sig); if (s < 0) throw new Error('missing ' + sig);
  let d = 0; for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(s, i + 1); }
  throw new Error('unbalanced');
}
for (const f of ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html']) {
  const fn = extract(fs.readFileSync(path.join(ROOT, f), 'utf8'), 'function _calLinkPt(prefer){');
  const el = (id) => { const attrs = {}; return { id, value: '', textContent: '', style: {}, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } }; };
  const els = { calNewName: el('calNewName'), calNewExtId: el('calNewExtId'), calNewPhone: el('calNewPhone'), calNewLinkInd: el('calNewLinkInd') };
  const pts = [{ id: 'syn-3', name: 'Dee Sample', phone: '555-0103' }, { id: 'syn-4', name: 'Eli Sample', phone: '555-0104' }, { id: 'syn-9', name: 'No Phone' }];
  const ctx = { document: { getElementById: (id) => els[id] || null }, getPatients: () => pts, String, Array };
  vm.createContext(ctx); vm.runInContext(fn, ctx);
  const type = (v) => { els.calNewName.value = v; ctx._calLinkPt(); };
  type('Dee Sample');
  assert.deepStrictEqual([els.calNewExtId.value, els.calNewPhone.value], ['syn-3', '555-0103'], f + ': linking fills the chart phone'); checks++;
  type('Eli Sample');
  assert.deepStrictEqual([els.calNewExtId.value, els.calNewPhone.value], ['syn-4', '555-0104'], f + ': a new link replaces the previous chart\'s phone'); checks++;
  type('Walk In Person');
  assert.deepStrictEqual([els.calNewExtId.value, els.calNewPhone.value], ['', ''], f + ': a dropped link clears the chart phone'); checks++;
  els.calNewPhone.value = '555-7777';
  type('Dee Sample');
  assert.deepStrictEqual([els.calNewExtId.value, els.calNewPhone.value], ['syn-3', '555-7777'], f + ': a typed phone is never replaced'); checks++;
  type('Walk In Person');
  assert.strictEqual(els.calNewPhone.value, '555-7777', f + ': a typed phone is never cleared'); checks++;
  els.calNewPhone.value = '';
  type('Eli Sample'); type('No Phone');
  assert.deepStrictEqual([els.calNewExtId.value, els.calNewPhone.value], ['syn-9', ''], f + ': a chart with no phone clears the previous chart\'s phone'); checks++;
}
console.log('PASS calendar form phone follows the linked chart: ' + checks + ' checks in 4 shells - a chart phone is replaced when the link moves and cleared when it drops; a typed phone is never touched');
