'use strict';
/* MLS Assist 3.0.138 — shadowbanner-1.0.0: the write probe's ancestor-banner identity falls back to
 * athena's 2026-09-02 shadow-DOM patient banner (the same two strategies the read path trusts) when no
 * classic identity root parses. Runs the REAL driver helpers in headless Chromium against a fixture
 * that reproduces the live shape: 18 decorative `.chart-header` section headers (none an identity)
 * plus an open shadow-root banner component printing the used/legal names, DOB and patient id. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
function sliceBetween(src, start, end) { const i = src.indexOf(start); const j = src.indexOf(end, i); assert(i >= 0 && j > i, 'slice: ' + start.slice(0, 50)); return src.slice(i, j); }
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) { e++; break; } } } return src.slice(i, e); }
const driver = sliceBetween(bg, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */');
const pieces = [
  fnBlock(driver, 'function mlsExactNameKey(value) {'),
  fnBlock(driver, 'function mlsExactDobKey(value) {'),
  fnBlock(driver, 'function mlsExactIdentityPair(expected, observed) {'),
  fnBlock(driver, '    function text(v) {'),
  fnBlock(driver, '    function digits(v) {'),
  fnBlock(driver, '    function dateKey(v) {'),
  fnBlock(driver, '    function nameKey(v) {'),
  fnBlock(driver, '    function visible(el, win) {'),
  fnBlock(driver, '    function deepQueryAll(root, selector) {'),
  fnBlock(driver, '    function uniqueBy(values, keyFn) {'),
  fnBlock(driver, '    function valueOf(el, attrs) {'),
  fnBlock(driver, '    function identityRoots(frame) {'),
  fnBlock(driver, '    function parseIdentity(root) {'),
  fnBlock(driver, '    function anchoredIdentity(frame) {'),
  fnBlock(driver, '    function shadowBannerIdentities(doc) {'),
  fnBlock(driver, '    function hetAncestorIdentity(frame, expectedPatient) {')
];
const harness = 'var hetDiag = { shadowHits: 0 };\n' + pieces.join('\n') + '\nwindow.__t = { anchoredIdentity: anchoredIdentity, hetAncestorIdentity: hetAncestorIdentity, shadowBannerIdentities: shadowBannerIdentities, hetDiag: hetDiag };';
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

function fixture(opts) {
  opts = opts || {};
  const used = opts.used || 'Adam', legalFirst = opts.legalFirst || 'Adam', last = opts.last || 'Schaeffer', dob = opts.dob || '03-24-2006', mrn = opts.mrn || '7833832';
  const decorative = Array.from({ length: 18 }, (_, i) => '<header class="chart-header"><div>Section ' + i + ' HISTORICAL (0)</div></header>').join('');
  const banner = '<div class="autostart aggressive-start-banner" id="host"></div>';
  const second = opts.secondHost ? '<div class="autostart other-banner" id="host2"></div>' : '';
  return '<html><body>' + decorative + banner + second + '<div class="chart-header"><h1>Allergies</h1></div>' +
    '<script>' +
    'function build(hostId, first, legalFirst, last, dob, mrn) { var h = document.getElementById(hostId); var sr = h.attachShadow({ mode: "open" }); sr.innerHTML = ' +
    '"<div class=\\"fe_c_root __0040athena__002fpatient-banner\\">" +' +
    '"<div class=\\"pb_c_patient-id-module\\"><div class=\\"pb_c_patient-id-module__name\\"><span>" + first + "</span> <span>" + last.toUpperCase() + "</span></div>" +' +
    '"<div class=\\"pb_c_patient-id-module__details-row\\"><span class=\\"pb_c_patient-id-module__detail\\">20yo M</span><span class=\\"pb_c_patient-id-module__detail\\">" + dob + "</span><span class=\\"pb_c_patient-id-module__detail\\">#" + mrn + "</span><span class=\\"pb_c_patient-id-module__detail\\">E#" + mrn + "</span></div></div>" +' +
    '"<div class=\\"pb_c_patient-details-popover\\"><div>Patient Name</div><div>First Name Used</div><div>" + first + "</div><div>Legal First Name</div><div>" + legalFirst + "</div><div>Legal Last Name</div><div>" + last + "</div><div>Patient Details</div><div>Date of birth</div><div>" + dob + "</div><div>Patient ID</div><div>#" + mrn + "</div><div>Age</div><div>20yo</div></div></div>"; }' +
    'build("host", ' + JSON.stringify(used) + ', ' + JSON.stringify(legalFirst) + ', ' + JSON.stringify(last) + ', ' + JSON.stringify(dob) + ', ' + JSON.stringify(mrn) + ');' +
    (opts.secondHost ? 'build("host2", ' + JSON.stringify(opts.secondHost.first) + ', ' + JSON.stringify(opts.secondHost.first) + ', ' + JSON.stringify(opts.secondHost.last) + ', ' + JSON.stringify(opts.secondHost.dob) + ', ' + JSON.stringify(opts.secondHost.mrn) + ');' : '') +
    '</script></body></html>';
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    async function run(opts, expected) {
      await page.setContent(fixture(opts));
      await page.evaluate(harness);
      return page.evaluate((exp) => {
        const t = window.__t; const frame = { doc: document, w: window };
        const own = t.anchoredIdentity(frame);
        const anc = t.hetAncestorIdentity(frame, exp);
        const sh = t.shadowBannerIdentities(document);
        return { ownAmbig: own.ambiguous, ownIdentity: !!own.identity, ancIdentity: anc.identity ? { name: anc.identity.name, dob: anc.identity.dob, mrn: anc.identity.mrn } : null, ancAmbig: anc.ambiguous, ancForeign: !!anc.foreign, ancShadow: !!anc.shadow, shadowCount: sh.length, shadowVia: sh.map((s) => s.via), shadowAlt: sh.map((s) => s.altNames.length), shadowHits: t.hetDiag.shadowHits };
      }, expected);
    }
    /* 1. live shape: decorative roots make the frame's OWN read ambiguous; the shadow fallback proves the exact pair */
    let r = await run({}, { name: 'Adam J Schaeffer', dob: '2006-03-24', mrn: '7833832' });
    eq(r.ownAmbig, true, 'decorative chart-header roots leave the classic read ambiguous (live shape)');
    eq(r.ownIdentity, false, 'no classic identity');
    eq(r.shadowCount, 1, 'one shadow host prints a full identity');
    eq(r.shadowVia[0], 'shadow-labels', 'the label block is read first');
    ok(r.ancIdentity && r.ancIdentity.mrn === '7833832', 'the ancestor read accepts the exact pair from the shadow banner with its MRN');
    eq(r.ancAmbig, false, 'not ambiguous'); eq(r.ancShadow, true, 'flagged as the shadow read'); eq(r.shadowHits, 1, 'counted in hetDiag');
    /* 2. legal vs used name: the schedule may carry either printed name */
    r = await run({ used: 'Bob', legalFirst: 'Robert', last: 'Dunne', dob: '01-02-1980', mrn: '5551234' }, { name: 'Robert Dunne', dob: '1980-01-02', mrn: '5551234' });
    ok(r.ancIdentity && r.ancIdentity.name === 'Robert Dunne', 'the legal printed name matches when the schedule carries it');
    eq(r.shadowAlt[0], 1, 'the other printed name rides as an altName');
    r = await run({ used: 'Bob', legalFirst: 'Robert', last: 'Dunne', dob: '01-02-1980', mrn: '5551234' }, { name: 'Bob Dunne', dob: '1980-01-02', mrn: '5551234' });
    ok(r.ancIdentity && r.ancIdentity.name === 'Bob Dunne', 'the used printed name matches when the schedule carries it');
    /* 3. exactness: a different DOB or a different person never passes */
    r = await run({}, { name: 'Adam J Schaeffer', dob: '2006-03-25', mrn: '7833832' });
    eq(r.ancIdentity, null, 'one day off in the DOB refuses'); eq(r.ancForeign, false, 'same name, other date is decoration, not foreign evidence');
    r = await run({}, { name: 'Alan Schaeffer', dob: '2006-03-24', mrn: '7833832' });
    eq(r.ancIdentity, null, 'a different first name refuses'); eq(r.ancForeign, true, 'a complete identity of a different person is foreign evidence');
    /* 4. two matching hosts with conflicting MRNs stay ambiguous; agreeing hosts do not */
    r = await run({ secondHost: { first: 'Adam', last: 'Schaeffer', dob: '03-24-2006', mrn: '9990001' } }, { name: 'Adam Schaeffer', dob: '2006-03-24', mrn: '7833832' });
    eq(r.ancAmbig, true, 'two printed copies with different MRNs refuse as ambiguous');
    r = await run({ secondHost: { first: 'Adam', last: 'Schaeffer', dob: '03-24-2006', mrn: '7833832' } }, { name: 'Adam Schaeffer', dob: '2006-03-24', mrn: '7833832' });
    ok(r.ancIdentity && !r.ancAmbig, 'two agreeing copies are one identity');
    /* 5. no shadow banner and no classic root: nothing is invented */
    await page.setContent('<html><body><header class="chart-header"><div>Allergies</div></header></body></html>');
    await page.evaluate(harness);
    r = await page.evaluate((exp) => { const t = window.__t; const anc = t.hetAncestorIdentity({ doc: document, w: window }, exp); return { id: !!anc.identity, amb: anc.ambiguous }; }, { name: 'Adam Schaeffer', dob: '2006-03-24', mrn: '7833832' });
    eq(r.id, false, 'no banner, no identity'); eq(r.amb, false, 'and not ambiguous');
  } finally { await browser.close(); }
  /* 6. the two shadow readers stay word-for-word on the strategies they share */
  const readPath = fnBlock(bg, 'function mlsReadChartIdentityShadow() {');
  ['/^first name used$/i', '/^legal first name$/i', '/^legal last name$/i', '/^date of birth$/i', '/^patient id$/i', 'AGE_CHIP.test(lines[i3]) || !BARE_DATE.test(lines[i3])', "split(/legal\\s*:/i)"].forEach((needle) => {
    ok(readPath.includes(needle) && driver.includes(needle), 'shared strategy text present in both readers: ' + needle);
  });
  console.log('PASS shadowbanner-30138-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
