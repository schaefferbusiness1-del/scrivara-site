'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `could not extract ${start}`);
  return source.slice(a, b);
}

assert(app.includes('id="ptSort"') && app.includes('<option value="visits">Most visits</option>'), 'Patients has no explicit visit-count sort');
assert(app.includes("sort.value=topPatients?'visits':'name'"), 'base Copilot does not select visit-count ranking for View Top Patients');
assert(app.includes("/api/widget/refine"), 'Refine still routes through the truncated generation prompt');
assert(!app.includes("String(studioLastHtml).slice(0,12000)"), 'Refine still truncates larger saved apps');
assert(app.includes('connect-src') && app.includes('form-action') && app.includes('frame-src') && app.includes('default-src'), 'custom-tool iframe CSP does not block outbound/embedded content');
assert(app.includes('f.contentWindow===ev.source') && app.includes('f.dataset.mlsWidgetNonce===String(ev.data.__mlsNonce||\'\')'), 'widget messages are not source + nonce gated');
assert(app.includes('__mlsWidgetReady') && app.includes('Checking the finished app before marking it done'), 'builder still says Done before a runtime-ready handshake');
assert(app.includes('!window.__MLS_WIDGET_RUNTIME_ERROR&&window.MLS_DATA&&window.MLS'), 'a failed widget can still overwrite its error with a false ready signal');

const patientSource = between(app, 'function _studioResolvePatient(query)', '/* The window.MLS bridge');
const patients = [
  { id: 'p1', mrn: 'M1', name: 'Same Name' },
  { id: 'p2', mrn: 'M2', name: 'Same Name' },
  { id: 'p3', mrn: 'M3', name: 'Unique Patient' }
];
const patientContext = { String, getPatients() { return patients.slice(); } };
vm.runInNewContext(patientSource, patientContext, { filename: 'studio-patient-resolution.js' });
assert.strictEqual(patientContext._studioResolvePatient('p2').patient.id, 'p2', 'MLS.startVisit(patient.id) cannot resolve the exact patient');
assert.strictEqual(patientContext._studioResolvePatient('M3').patient.id, 'p3', 'exact MRN resolution broke');
assert.strictEqual(patientContext._studioResolvePatient('Same Name').reason, 'ambiguous', 'duplicate names do not fail closed');

const bridgeSource = between(app, 'function _mlsWidgetBridgeJS(nonce)', '/* Bind the widget<->app message bridge');
const composeSource = between(app, 'function _studioNonce()', '/* ===================== PINNED WIDGET TABS');
const composeContext = {
  JSON, String, Date, Math, Uint32Array,
  crypto: { getRandomValues(arr) { for (let i = 0; i < arr.length; i++) arr[i] = i + 1; return arr; } }
};
vm.runInNewContext(bridgeSource + '\n' + composeSource, composeContext, { filename: 'studio-srcdoc-runtime.js' });
const generated = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Tool</title></head><body><h2>Top patients</h2><script>document.body.dataset.count=String(window.MLS_DATA.patients.length)</script></body></html>';
const srcdoc = composeContext._composeWidgetSrcdoc(generated, { patients: [{ id: 'p1', name: '</script><script>bad()</script>' }] }, 'nonce-123');
assert(srcdoc.startsWith('<!doctype html>'), 'runtime was prepended before <!doctype html> and can be discarded by Chrome');
assert(srcdoc.indexOf('window.MLS_DATA=') > srcdoc.indexOf('<head>'), 'practice data runtime is not inside <head>');
assert(srcdoc.indexOf('window.MLS_DATA=') < srcdoc.indexOf('document.body.dataset.count'), 'generated code runs before MLS_DATA exists');
assert(srcdoc.includes('__mlsNonce:"nonce-123"') || srcdoc.includes('__mlsNonce: "nonce-123"') || srcdoc.includes('__mlsNonce:' + JSON.stringify('nonce-123')), 'runtime messages do not carry the widget nonce');
assert(!srcdoc.includes('</script><script>bad()'), 'snapshot content can break out of the injected runtime script');

console.log('PASS custom-tool v2 runtime: in-head data injection, CSP, source-gated bridge, exact patient IDs, full refine, and ready handshake');
