'use strict';
/* MLS Assist 3.0.151 — axlistdate-1.0.0: the ax harvest carries the date printed beside each encounter link and the
 * briefing path; the scoped-day decision falls back to that date when the encounter body prints no labeled date;
 * the ax route puts the frame back on the briefing; an explicit empty on an encounter route is never an empty day.
 * Runs the REAL visits driver's axHarvest op in headless Chromium against a briefing-shaped fixture (links inside a
 * shadow root, dates beside them) and pins the loop seams. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }
const driver = fnBlock(bg, '  function mlsVisitsDriverFn(op, cfg, idx, expectedBinding) {');

/* static pins */
ok(driver.includes("hrefPath: ah.replace(/[#?].*$/, ''), listDate: axLd });"), 'the harvest carries listDate');
ok(driver.includes("return { ok: true, encounters: axUnique, briefingPath: (typeof location !== 'undefined' ? String(location.pathname || '') : ''), surfaceSig: {"), 'the harvest carries the briefing path (guarded for the Node suites)');
ok(bg.includes("var axBodyDate = mlsVisitDateKeyForHint(axBody.headerDate) || mlsVisitDateKeyForHint(axE.listDate);"), 'the scoped-day decision falls back to the list date');
ok(bg.includes("dateUnknownRows: axDateUnknown, dateFromListRows: axDateFromList"), 'the receipt counts list-dated rows');
ok(bg.includes("await exec(emrId, [axBestFrame], ['briefingGo', cfg, axBest.briefingPath]);"), 'the frame goes back to the briefing after the encounter reads');
ok(driver.includes("if (explicitEmptyVisits() && !/\\/ax\\/encounter\\//i.test(typeof location !== 'undefined' ? String(location.pathname || '') : '')) return { ok: true, selector: 'verified-empty-state',"), 'an explicit empty on an encounter route is not accepted');
/* the fallback keys a slash date the same way the body date would */
const keyFn = new Function(fnBlock(bg, '  function mlsVisitDateKeyForHint(sv) {') + '\nreturn mlsVisitDateKeyForHint;')();
eq(keyFn('09/14/2026'), '2026-09-14', 'a printed list date keys to the scoped day'); eq(keyFn(''), '', 'no date, no key');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    const html = '<html><body><div id="host"></div><script>(function(){var sr=document.getElementById("host").attachShadow({mode:"open"});sr.innerHTML=' +
      JSON.stringify('<ul class="enc-list"><li><span>Office Visit</span> <a href="/22724/6/ax/encounter/9001234/summary">09/14/2026</a></li><li><a href="/22724/6/ax/encounter/9001235/summary">Procedure</a> <span>08/02/2026</span></li><li><a href="/22724/6/ax/encounter/9001236/summary">Follow up</a></li></ul>') +
      ';})();</script></body></html>';
    await page.setContent(html);
    await page.evaluate('(function () {\n' + driver + '\nwindow.__vd = mlsVisitsDriverFn; })()');
    const r = await page.evaluate(() => { history.replaceState({}, '', '/22724/6/ax/briefing/7833832'); return window.__vd('axHarvest', {}); });
    eq(r.ok, true, 'harvest answers'); eq(r.encounters.length, 3, 'three encounters');
    eq(r.encounters[0].listDate, '09/14/2026', 'the anchor\'s own date is carried');
    eq(r.encounters[1].listDate, '08/02/2026', 'a date beside the anchor (its parent row) is carried');
    eq(r.encounters[2].listDate, '', 'no date printed, none invented');
    eq(r.briefingPath, '/22724/6/ax/briefing/7833832', 'the briefing path travels for the restore');
    ok(!('surfaceSig' in r) || r.surfaceSig.route.indexOf('7833832') < 0, 'the PHI-free surface signature stays digit-masked');
  } finally { await browser.close(); }
  console.log('PASS axlistdate-30151-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
