'use strict';
/* MLS Assist 3.0.144 — visitsshadow-1.0.0 + rowveto-1.0.0. Runs the REAL visits driver (mlsVisitsDriverFn) in
 * headless Chromium against fixtures that reproduce the live shapes:
 *  - athena's 2026-09-02 shadow-root patient banner next to stale legacy text of ANOTHER patient: the
 *    'identity' op must answer from the banner (via 'banner'), not from body.innerText;
 *  - a clincmp-ax chart whose only dated rows are the problem list, medications and surgical history: the
 *    'diagnose' census must form NO encounter group and count the vetoed rows; plain dated rows still group.
 * The visits identity gate (visitIdentityGate) runs in Node: the banner's other printed name is an exact
 * alternative, DOB still exact. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

const driver = fnBlock(bg, '  function mlsVisitsDriverFn(op, cfg, idx, expectedBinding) {');
ok(driver.length > 60000 && driver.length < 120000, 'the visits driver is where it lives');
const defStart = driver.indexOf('    var DEFAULT = {');
const cfgObj = fnBlock(driver.slice(defStart + '    var DEFAULT = '.length), '{');
const cfg = new Function('return (' + cfgObj + ')')();
ok(Array.isArray(cfg.rowSelectors) && cfg.rowSelectors[0] === 'li.encounter-list-item', 'the real default cfg is used');
/* static pins */
eq(driver.split('function visitsShadowBanner(doc)').length - 1, 1, 'the driver carries its own shadow-banner reader');
ok(driver.includes("via: 'banner', score: 30, altNames:"), 'the identity op answers via banner with a score that outranks regex hits');
ok(driver.indexOf('function visitsShadowBanner(doc)') < driver.indexOf("if (op === 'identity') {"), 'the helper is defined before the op that calls it');
ok(driver.includes('function furnitureRow(n)') && driver.includes('__furnitureVetoed++; continue;'), 'generic rows of other chart sections are vetoed');
ok(driver.includes("furnitureVetoed: __furnitureVetoed }"), 'the census counts the vetoed rows');
const probe = fnBlock(bg, '    function shadowBannerIdentities(doc) {');
const copy = fnBlock(driver, '    function visitsShadowBanner(doc) {');
const strip = (s) => s.replace(/^[^\n]*\n/, '').replace(/\s+/g, ' ');
eq(strip(copy), strip(probe), 'the copy is word-for-word the write probe\'s helper below its header');
const gateSrc = fnBlock(bg, '  function visitIdentityGate(frozen, live) {');
ok(gateSrc.includes('__alt.viaAltName = true; return __alt;'), 'the gate accepts an exact alternative printed name');

/* the gate in Node */
const gate = new Function(gateSrc + '\nreturn visitIdentityGate;')();
let g = gate({ name: 'Robert Dunne', dob: '1980-01-02', mrn: '5551234' }, { name: 'Bob Dunne', dob: '01/02/1980', mrn: '5551234', altNames: ['Robert Dunne'] });
eq(g.ok, true, 'the legal printed name matches the requested legal name through altNames');
eq(g.viaAltName, true, 'and says so');
g = gate({ name: 'Robert Dunne', dob: '1980-01-02', mrn: '5551234' }, { name: 'Bob Dunne', dob: '01/03/1980', mrn: '5551234', altNames: ['Robert Dunne'] });
eq(g.ok, false, 'one day off in the DOB refuses even with a matching alternative name');
g = gate({ name: 'Robert Dunne', dob: '1980-01-02', mrn: '5551234' }, { name: 'Bob Dunne', dob: '01/02/1980', mrn: '5551234', altNames: ['Alan Dunne'] });
eq(g.ok, false, 'a different alternative name refuses'); eq(g.reason, 'same-frame-name-mismatch', 'with the original reason');
g = gate({ name: 'Robert Dunne', dob: '1980-01-02', mrn: '5551234' }, { name: 'Bob Dunne', dob: '01/02/1980', mrn: '5551234' });
eq(g.ok, false, 'no alternatives: unchanged refusal');
g = gate({ name: 'Bob Dunne', dob: '1980-01-02', mrn: '5551234' }, { name: 'Bob Dunne', dob: '01/02/1980', mrn: '5551234', altNames: ['Robert Dunne'] });
eq(g.ok, true, 'the primary printed name still matches first'); ok(!g.viaAltName, 'without the alternative flag');

function banner(first, legalFirst, last, dob, mrn) {
  return '<div class="autostart aggressive-start-banner" id="host"></div><script>(function () { var h = document.getElementById("host"); var sr = h.attachShadow({ mode: "open" }); sr.innerHTML = ' +
    JSON.stringify('<div class="fe_c_root __0040athena__002fpatient-banner"><div class="pb_c_patient-id-module"><div class="pb_c_patient-id-module__name"><span>' + first + '</span> <span>' + last.toUpperCase() + '</span></div>' +
      '<div class="pb_c_patient-id-module__details-row"><span class="pb_c_patient-id-module__detail">20yo M</span><span class="pb_c_patient-id-module__detail">' + dob + '</span><span class="pb_c_patient-id-module__detail">#' + mrn + '</span></div></div>' +
      '<div class="pb_c_patient-details-popover"><div>Patient Name</div><div>First Name Used</div><div>' + first + '</div><div>Legal First Name</div><div>' + legalFirst + '</div><div>Legal Last Name</div><div>' + last + '</div><div>Date of birth</div><div>' + dob + '</div><div>Patient ID</div><div>#' + mrn + '</div></div></div>') +
    '; })();</script>';
}
function furniture(cls) {
  const li = (c, n, txt) => Array.from({ length: n }, (_, i) => '<li class="' + c + '"><span class="' + (c === 'problembullet' ? 'problemitem' : 'item') + '">' + txt + ' ' + (i + 1) + ' - onset 03/0' + ((i % 8) + 1) + '/2024</span></li>').join('');
  const tr = (c, n) => Array.from({ length: n }, (_, i) => '<tr class="' + c + '"><td>Medication ' + (i + 1) + '</td><td>10 mg daily</td><td>started 04/1' + (i % 9) + '/2023</td></tr>').join('');
  return '<h2>Problems</h2><ul>' + li(cls || 'problembullet', 11, 'Problem') + '</ul><h2>Medications</h2><table><tbody>' + tr(cls ? cls + 'x' : 'medicationrow', 7) + '</tbody></table><h2>Surgical History</h2><ul>' + li(cls || 'surgicalhxbullet', 2, 'Surgery') + '</ul>';
}
const stale = '<div class="legacy"><h1>Chart</h1><p>Patient Jane Doe</p><p>DOB: 01/02/1950</p><p>MRN: 9991110</p></div>';

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    async function ops(html) {
      await page.setContent('<html><body>' + html + '</body></html>');
      await page.evaluate('(function () {\n' + driver + '\nwindow.__vd = mlsVisitsDriverFn; })()');
      return page.evaluate((c) => { const id = window.__vd('identity', c); const dg = window.__vd('diagnose', c); return { id, groupCount: dg.groupCount, counts: dg.counts, cands: (dg.candidates || []).map((x) => ((x.rowSig && x.rowSig.classes) || []).join('.') + ':' + x.count) }; }, cfg);
    }
    /* 1. live shape: stale legacy text of another patient + the shadow banner of the expected one */
    let r = await ops(stale + banner('Adam', 'Adam', 'Schaeffer', '03-24-2006', '7833832') + furniture());
    eq(r.id.via, 'banner', 'the identity op answers from the shadow banner');
    eq(r.id.name, 'Adam Schaeffer', 'with the banner\'s printed name'); eq(r.id.dob, '03/24/2006', 'its DOB'); eq(r.id.mrn, '7833832', 'its patient id');
    eq(r.id.shadow, true, 'flagged as the shadow read'); eq(r.id.weakName, false, 'never weak');
    ok(r.id.name !== 'Jane Doe', 'the stale legacy text no longer wins');
    /* 2. the problem list / medications / surgical history never form an encounter index */
    eq(r.groupCount, 0, 'no encounter group on a chart whose only dated rows are section furniture');
    ok(r.counts.furnitureVetoed >= 20, 'the vetoed rows are counted (' + r.counts.furnitureVetoed + ')');
    /* 3. control: the same rows without section class names still group (the veto is by class, not blanket) */
    r = await ops(stale + banner('Adam', 'Adam', 'Schaeffer', '03-24-2006', '7833832') + furniture('row'));
    ok(r.groupCount >= 1, 'plain dated rows still form a candidate group'); eq(r.counts.furnitureVetoed, 0, 'nothing vetoed');
    /* 4. legal vs used name rides as an altName for the gate */
    r = await ops(banner('Bob', 'Robert', 'Dunne', '01-02-1980', '5551234'));
    eq(r.id.name, 'Bob Dunne', 'the used name is primary'); eq(JSON.stringify(r.id.altNames), JSON.stringify(['Robert Dunne']), 'the legal name is the alternative');
    /* 5. no shadow banner: the regex path is unchanged */
    r = await ops(stale + furniture());
    eq(r.id.name, 'Jane Doe', 'legacy text still reads when there is no banner'); eq(r.id.dob, '01/02/1950', 'legacy DOB'); ok(!r.id.shadow, 'not a shadow read');
  } finally { await browser.close(); }
  console.log('PASS visitsid-30144-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
