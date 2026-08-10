'use strict';
/*
 * LENS "overlap-remains" — is #mlsAvKioskOrders sitting on the patient-facing line?
 * -----------------------------------------------------------------------------------------
 * This reuses the author's own harness (kiosk-render-lib.js) and the author's own MEASURE
 * expression VERBATIM, with exactly ONE change: the id list gains #mlsAvKioskOrders and
 * #mlsAvKioskEndVisit. Both are absolutely positioned, opaque, z-index:6 children of
 * #mlsAvKiosk that render text, and neither is in the proof's id list — so the proof's
 * `covered` check (which only counts a text box covered by an ABSOLUTE sibling) can never
 * look at them.
 *
 * The orders widget is NOT hand-written markup here: ordersRender/ordersCard/ordersCounts/
 * make/clean/safe/gid/actTitleCase are lifted out of feat_mls_avatar.js and executed in the
 * page against a realistic kiosk.ambActions, so the panel has the height the shipped code
 * gives it.
 *
 * RUN: node tests/avatar-kiosk-overlap-lens-probe.js
 */
const fs = require('fs');
const path = require('path');
const lib = require('./kiosk-render-lib.js');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

/* ── lift the REAL orders renderer ─────────────────────────────────────────────────────── */
function liftOrders(src) {
  const lines = src.split('\n');
  function slice(a, b) { return lines.slice(a - 1, b).join('\n'); }
  function need(re, label) {
    const i = lines.findIndex((l) => re.test(l));
    if (i < 0) throw new Error('lift failed: ' + label);
    return i + 1;
  }
  const safeAt = need(/^  function safe\(fn, fallback\)/, 'safe');
  const gidAt = need(/^  function gid\(id\)/, 'gid');
  const cleanAt = need(/^  function clean\(value\)/, 'clean');
  const makeAt = need(/^  function make\(tag, className, textValue\)/, 'make');
  const titleAt = need(/^  function actTitleCase\(s\)/, 'actTitleCase');
  const countsAt = need(/^  function ordersCounts\(\)/, 'ordersCounts');
  const footAt = need(/mlsAvOrdFoot', 'Nothing here is sent anywhere/, 'ordersRender foot');
  return [
    slice(safeAt, safeAt),
    slice(gidAt, gidAt),
    slice(cleanAt, cleanAt + 3),
    slice(makeAt, makeAt + 5),
    slice(titleAt, titleAt),
    slice(countsAt, footAt + 1),          /* ordersCounts .. end of ordersRender */
    'function kioskAmbientSave(){}',
  ].join('\n');
}

/* two proposals the shipped detector really produces: one with a missing side (so it gets the
   left/right/both row and a disabled Confirm) and one medication with a missing dose */
const ACTIONS = [
  { id: 'a1', kind: 'imaging', title: 'MRI lumbar spine', detail: '', heard: "let's get an MRI of the lower back",
    missing: ['side'], fields: {}, status: 'proposed', at: 1 },
  { id: 'a2', kind: 'medication', title: 'Meloxicam', detail: '', heard: 'I want to start you on meloxicam',
    missing: ['dose', 'frequency'], fields: {}, status: 'proposed', at: 2 },
];

const MEASURE_EXT = lib.MEASURE.replace(
  "'mlsAvKioskRest','mlsAvKioskTypeRow','mlsAvKioskSkip','mlsAvKioskEnd','mlsAvKioskMute'];",
  "'mlsAvKioskRest','mlsAvKioskTypeRow','mlsAvKioskSkip','mlsAvKioskEnd','mlsAvKioskMute',\n    'mlsAvKioskOrders','mlsAvKioskEndVisit'];"
);
if (MEASURE_EXT === lib.MEASURE) throw new Error('could not extend the id list — the harness drifted');

/* the ambient states a room capture really passes through, with the orders widget up */
const AMB = [
  { id: 'H', label: 'room capture, long live transcript', cls: 'ambient',
    say: 'I am listening to the visit and taking notes for the doctor.',
    interim: '… d my wife says i have been limping which i did not even notice myself until she said it',
    progress: '' },
  { id: 'H2', label: 'room capture, short live transcript', cls: 'ambient',
    say: 'I am listening to the visit and taking notes for the doctor.',
    interim: 'okay so we will get the scan first', progress: '' },
  { id: 'H3', label: 'room capture, staff alert on the line', cls: 'ambient',
    say: 'I am listening to the visit and taking notes for the doctor.',
    interim: 'Staff: the microphone was refused or lost, so nothing more is being recorded.', progress: '' },
  { id: 'H4', label: 'room capture, PAUSED', cls: 'ambient paused',
    say: 'Paused — nothing is being recorded.',
    interim: 'Recording paused. Nothing is being recorded until Resume.', progress: '' },
];

(async () => {
  const { chromium } = require('playwright');
  const exe = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const src = lib.readSource();
  const html = lib.page(src);
  const orders = liftOrders(src);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let coveredTotal = 0, rows = 0;
  const hits = [];
  for (const vp of lib.VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('void (function(){\nvar kiosk = {};\n' + orders +
      '\nwindow.__kiosk = kiosk; window.__ordersRender = ordersRender;\n})()');
    for (const st of AMB) {
      await page.evaluate(lib.applyStateScript(st));
      await page.evaluate((acts) => {
        window.__kiosk.ambActions = JSON.parse(JSON.stringify(acts));
        window.__ordersRender();
      }, ACTIONS);
      const m = await page.evaluate(MEASURE_EXT);
      rows++;
      coveredTotal += m.covered.length;
      const ord = await page.evaluate(() => {
        const o = document.getElementById('mlsAvKioskOrders').getBoundingClientRect();
        const i = document.getElementById('mlsAvKioskInterim').getBoundingClientRect();
        const s = document.getElementById('mlsAvKioskSay').getBoundingClientRect();
        return { ord: [o.left, o.top, o.right, o.bottom].map(Math.round),
          interim: [i.left, i.top, i.right, i.bottom].map(Math.round),
          say: [s.left, s.top, s.right, s.bottom].map(Math.round) };
      });
      const flag = m.covered.length ? 'COVER' : 'ok   ';
      console.log(('  ' + flag + ' ' + vp.w + 'x' + vp.h + ' [' + st.id + '] ' + st.label).padEnd(66) +
        'coveredText=' + m.covered.length + ' spills=' + m.spills.length +
        ' clipped=' + m.clipped.length + ' sliced=' + m.sliced.length);
      for (const c of m.covered) {
        console.log('        ' + c.text + ' is UNDER ' + c.under + ' — ' + c.h + 'px tall, ' + c.px + 'px^2');
        hits.push({ vp: vp.w + 'x' + vp.h, state: st.id, label: st.label, ...c, rects: ord });
      }
      if (m.covered.length) console.log('        rects orders=' + JSON.stringify(ord.ord) +
        ' interim=' + JSON.stringify(ord.interim) + ' say=' + JSON.stringify(ord.say));
    }
    await page.close();
  }
  await browser.close();
  console.log('');
  console.log('ambient states measured                     : ' + rows);
  console.log('text COVERED by an absolute opaque sibling   : ' + coveredTotal);
  if (coveredTotal) {
    console.log('\nFAIL — the patient-facing text is still covered:');
    for (const h of hits) console.log('  ' + h.vp + ' [' + h.state + '] ' + h.text + ' under ' + h.under + ' (' + h.h + 'px)');
    process.exit(1);
  }
  console.log('\nPASS — no absolute sibling paints over the patient-facing text in room capture.');
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
