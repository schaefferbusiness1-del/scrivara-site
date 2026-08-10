'use strict';
/*
 * PROOF: THE PATIENT-FACING TEXT NEVER PAINTS ON ANYTHING ELSE (av-6.3.0)
 * -----------------------------------------------------------------------------------------
 * Owner, twice: "having text constantly overlapping and being such a paIUN IN THE ASS", then
 * "fix the overlaying text to". It was "fixed" once by serialising fourteen writers onto one
 * text node — and that could never have fixed it, because the overlapping pixels belong to
 * DIFFERENT ELEMENTS and the arbitrator owns exactly one node.
 *
 * This is a RENDERED proof, not a code reading. It installs the SHIPPED stylesheet and the
 * SHIPPED markup (both lifted out of the module — see kiosk-render-lib.js), drives the ten
 * states a real check-in passes through at four viewport sizes, and measures:
 *   · does every box contain its own text, or does it own its own overflow?
 *   · if not, where does the escaped text land, and is that sibling opaque (which HIDES the
 *     text) or transparent (which INTERLEAVES it)?
 *   · does the column fit the screen at all?
 * elementFromPoint is used at every intersection because geometry is not visibility.
 *
 * RUN:   node tests/avatar-kiosk-text-never-overlaps-proof.js
 * CONTROL: AVATAR_SRC_OVERRIDE=<pre-fix copy> node tests/avatar-kiosk-text-never-overlaps-proof.js
 *          — the control must report spills. If it does not, this proof is worthless.
 */
const lib = require('./kiosk-render-lib.js');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

(async () => {
  const fs = require('fs');
  const { chromium } = require('playwright');
  const exe = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const src = lib.readSource();
  const html = lib.page(src);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  let spillTotal = 0, overflowUnowned = 0, tooTall = 0, rows = 0, clippedTotal = 0, coveredTotal = 0, slicedTotal = 0;
  const detail = [];
  for (const vp of lib.VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.setContent(html, { waitUntil: 'load' });
    for (const st of lib.STATES) {
      await page.evaluate(lib.applyStateScript(st));
      const m = await page.evaluate(lib.MEASURE);
      rows++;
      const unowned = m.overflows.filter((o) => !o.owns);
      spillTotal += m.spills.length;
      overflowUnowned += unowned.length;
      clippedTotal += m.clipped.length;
      coveredTotal += m.covered.length;
      slicedTotal += m.sliced.length;
      const over = m.columnNatural - m.viewport;
      if (over > 0) tooTall++;
      detail.push({ vp: vp.w + 'x' + vp.h, state: st.id, label: st.label,
        spills: m.spills, unowned, clipped: m.clipped, covered: m.covered, sliced: m.sliced, colOver: Math.round(over), face: m.faceW + 'x' + m.faceH,
        rootOverflowY: m.rootOverflowY });
      const flag = m.spills.length ? 'SPILL' : (unowned.length ? 'UNOWN' : (m.clipped.length ? 'CLIP ' : (m.covered.length ? 'COVER' : (m.sliced.length ? 'SLICE' : 'ok   '))));
      console.log(('  ' + flag + ' ' + vp.w + 'x' + vp.h + ' [' + st.id + '] ' + st.label).padEnd(74) +
        'spills=' + m.spills.length + ' unownedOverflow=' + unowned.length + ' clippedText=' + m.clipped.length + ' coveredText=' + m.covered.length + ' slicedLine=' + m.sliced.length +
        ' column=' + m.columnNatural + '/' + m.viewport + ' face=' + m.faceW + 'x' + m.faceH);
      for (const s of m.spills) {
        console.log('        ' + s.from + ' -> ' + s.into + ' ' + s.px + 'px opaqueSibling=' +
          s.siblingOpaque + ' topmost=' + s.topmost);
      }
    }
    await page.close();
  }
  await browser.close();
  console.log('');
  console.log('states measured  : ' + rows + ' (' + lib.STATES.length + ' states x ' + lib.VIEWPORTS.length + ' viewports)');
  console.log('cross-element spills          : ' + spillTotal);
  console.log('boxes overflowing UNOWNED     : ' + overflowUnowned);
  console.log('states whose column is taller than the viewport (clipped by the root, not painted out): ' + tooTall);
  console.log('text boxes CLIPPED by the viewport  : ' + clippedTotal);
  console.log('text COVERED by a floating control  : ' + coveredTotal);
  console.log('boxes clipping THROUGH a line of text : ' + slicedTotal);
  const bad = spillTotal + overflowUnowned + clippedTotal + coveredTotal + slicedTotal;
  if (bad) {
    console.log('\nFAIL — text still escapes its box onto another element:');
    for (const d of detail) {
      if (!d.spills.length && !d.unowned.length && !d.clipped.length && !d.covered.length && !d.sliced.length) continue;
      console.log('  ' + d.vp + ' [' + d.state + '] ' + d.label + ' :: ' + JSON.stringify(d.spills) +
        ' unowned=' + JSON.stringify(d.unowned) + ' clipped=' + JSON.stringify(d.clipped) + ' covered=' + JSON.stringify(d.covered) + ' sliced=' + JSON.stringify(d.sliced));
    }
    process.exit(1);
  }
  console.log('\nPASS — in all ' + rows + ' rendered states every text box either contains its own text or ' +
    'owns its own overflow, so nothing can be painted onto a sibling. Zero cross-element spills.');
})().catch((e) => { console.error('PROOF ERROR', e); process.exit(2); });
