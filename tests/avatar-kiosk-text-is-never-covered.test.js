'use strict';
/*
 * NOTHING IS EVER PAINTED ON TOP OF THE PATIENT'S WORDS (av-6.3.0, defect 3)
 * ===========================================================================================
 * Owner, twice: "having text constantly overlapping and being such a paIUN IN THE ASS", then
 * "fix the overlaying text to".
 *
 * ⛔ WHY THIS FILE EXISTS AT ALL — THE TEST WAS THE DEEPER DEFECT.
 * The first fix serialised fourteen writers onto the patient-facing text node. The second capped
 * the boxes and stopped the flex column compressing them. Both were real, and neither could have
 * fixed what the owner was looking at, because #mlsAvKioskOrders — an OPAQUE white card,
 * position:absolute, right:16px bottom:16px, up to 52vh tall, z-index 6 — is painted directly over
 * the live transcript and the progress line. An arbitrator owns one NODE. This is a different
 * ELEMENT on top of that node.
 * And the suites could not see it:
 *   · the code-reading suites asked what was WRITTEN to the line, never what was DRAWN over it;
 *   · the rendered proof enumerated a HAND-WRITTEN LIST OF FIFTEEN IDS, and #mlsAvKioskOrders was
 *     not on it — a harness that enumerates what its author remembered cannot find what its author
 *     forgot. It also required an occluder to have text of its own, required it to be
 *     absolutely positioned, and probed ONE point at the centre of a rect intersection.
 * So the measurement now asks the browser the only question that matters, at the coordinates of
 * the words themselves: WHAT IS ACTUALLY PAINTED HERE? Every element under the root, a grid of
 * elementFromPoint samples inside every text box, and anything that comes back which is neither
 * that element, nor inside it, nor an ancestor of it, is on top of it.
 * ⚠️ Geometry is not visibility — an earlier probe in this lane reported 21 false overlaps from
 * rect intersections alone — which is exactly why nothing here is inferred from a rect.
 *
 * REGISTERED IN run-all.js: the rendered proof next to this file
 * (avatar-kiosk-text-never-overlaps-proof.js) prints the long report for a human, but only
 * *.test.js runs in the gate, and a layout guarantee nobody runs is not a guarantee.
 *
 * CONTROL: node tests/avatar-half-duplex-control.js — variant "B7" removes the reservation rule
 * and this suite fails by name, reporting #mlsAvKioskOrders over #mlsAvKioskSay and
 * #mlsAvKioskInterim at 1366x768 and 1024x768.
 */
const assert = require('assert');
const fs = require('fs');
const lib = require('./kiosk-render-lib.js');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const src = lib.readSource();
const css = lib.liftKioskCss(src);

/* ── 1. THE RESERVATION IS STRUCTURAL, AND IT HAS ONE SOURCE OF TRUTH ──────────────────────
   The panel's width and the space the text column leaves for it must be the SAME number, or the
   day they drift the card is back on the words. */
assert.ok(/--mlsav-panel:\s*min\(/.test(css),
  'the panel width is no longer declared as a custom property. Two hand-written copies of it — one ' +
  'for the card, one for the gutter — drift, and the drift puts an opaque card back on top of the ' +
  'patient-facing text.');
assert.ok(/#mlsAvKioskOrders\{[^}]*width:var\(--mlsav-panel\)/.test(css),
  'the proposed-actions panel no longer takes its width from --mlsav-panel');
assert.ok(/#mlsAvKiosk\.hasorders\{[^}]*padding-right:calc\(var\(--mlsav-panel\)/.test(css),
  'THE TEXT COLUMN NO LONGER RESERVES THE PANEL\'S AREA. #mlsAvKioskOrders is an opaque white card ' +
  'at right:16px;bottom:16px, up to 52vh tall, z-index 6 — i.e. painted straight over the live ' +
  'transcript and the progress line. Measured with this rule removed: it covers #mlsAvKioskSay and ' +
  '#mlsAvKioskInterim at 1366x768 and at 1024x768.');
/* and on a narrow screen the card is a full-width bottom sheet, so the reserved axis changes */
assert.ok(/@media \(max-width:720px\)\{[^@]*#mlsAvKiosk\.hasorders\{[^}]*padding-bottom:calc\(44vh/.test(css),
  'on a narrow screen the panel becomes a full-width bottom sheet (right:8px;left:8px;bottom:8px), ' +
  'so a right-hand gutter reserves the wrong axis entirely and the card sits on the transcript. ' +
  'The column must reserve HEIGHT there — and the panel\'s MAX height, because a card that grows ' +
  'as the doctor talks must never grow into the words.');

/* ── 2. ONE WRITER OWNS BOTH FACTS ─────────────────────────────────────────────────────────
   A class set at a call site goes stale the first time a caller is added. ordersRender is the only
   function that shows or hides the panel, so it is the only one that may say so. */
{
  const at = src.indexOf('function ordersRender()');
  assert.ok(at > 0, 'ordersRender is gone');
  const body = src.slice(at, src.indexOf('\n  function ordersBlock()', at));
  /* BOTH BRANCHES, and through the one helper that owns the class. The panel appearing without the
     reservation is the defect itself; the reservation surviving the panel closing is a phantom
     gutter that pushes the question off-centre for the rest of the visit. */
  assert.ok(/ordersReserve\(false\)/.test(body) && /ordersReserve\(true\)/.test(body),
    'ordersRender shows and hides the panel but does not set the class that makes the column ' +
    'reserve its area — so the reservation and the panel can disagree, which is the same defect ' +
    'with an extra step');
  assert.ok(/function ordersReserve\(on\)[\s\S]{0,400}classList\.add\('hasorders'\)[\s\S]{0,120}classList\.remove\('hasorders'\)/.test(src),
    'ordersReserve no longer toggles the reservation class both ways');
  /* ⚠️ COMMENTS STRIPPED FIRST, and blanked line-for-line so the line numbers still mean
     something. A text grep cannot tell code from prose: the first version of this scan flagged the
     two block comments that EXPLAIN the rule, which is the seventh time in this lane a sweep has
     reported its own documentation as a defect. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  /* ⚠️ THE STYLESHEET IS EXEMPTED BY WHERE IT IS, NOT BY WHAT ITS SELECTORS LOOK LIKE. This filter
     used to be `!/#mlsAvKiosk\.hasorders\{/` — a pattern that happened to match the two rules that
     existed when it was written, so the moment the narrow-screen branch added descendant rules
     (`#mlsAvKiosk.hasorders #mlsAvKioskSay{...}`) the scan reported the stylesheet as a second
     WRITER of the class. It never was: a CSS rule READS the class. So the exemption is now the
     LINE RANGE of kioskStyle, which is a fact about the file rather than a guess about selector
     shapes, and it cannot be widened by adding a rule with a shape nobody predicted. Outside that
     range the only thing allowed to mention the class is a classList add/remove. */
  const styleAt = code.indexOf('function kioskStyle()');
  const styleEnd = code.indexOf('appendChild(st)', styleAt);
  assert.ok(styleAt > 0 && styleEnd > styleAt, 'kioskStyle is gone, so this scan cannot tell a ' +
    'stylesheet rule from a second writer');
  const firstStyleLine = code.slice(0, styleAt).split('\n').length;
  const lastStyleLine = code.slice(0, styleEnd).split('\n').length;
  const others = code.split('\n').map((ln, i) => [i + 1, ln])
    .filter(([, ln]) => /hasorders/.test(ln))
    .filter(([n]) => n < firstStyleLine || n > lastStyleLine)   /* the stylesheet READS it */
    .filter(([, ln]) => !/classList\.(add|remove)\('hasorders'\)/.test(ln));
  assert.deepEqual(others.map(([n, ln]) => n + ': ' + ln.trim()), [],
    'something other than ordersRender and the stylesheet touches `hasorders` — two writers for ' +
    'one fact is how the class survives the panel closing');
  /* and the stylesheet really does read it, so the exemption above is not hiding an empty range */
  assert.ok(/#mlsAvKiosk\.hasorders/.test(css),
    'the stylesheet no longer mentions `hasorders` at all, so the class reserves nothing and the ' +
    'opaque panel is back on the patient-facing text');
  /* the panel's display is set in exactly one place too, and it is this one */
  const showSites = (src.match(/mlsAvKioskOrders'\)/g) || []).length;
  assert.strictEqual(showSites, 1,
    'the panel is reached from ' + showSites + ' places. With more than one, "ordersRender is the ' +
    'single writer" is an unfounded claim and the class can be left behind.');
}

/* ── 3. THE MODAL EXEMPTION IS CHECKED, NOT ASSUMED ────────────────────────────────────────
   The measurement skips three full-screen overlays, because a modal is SUPPOSED to cover the
   screen and while one is up the patient line is not the subject. That exemption is only honest
   while each of them really is a full-inset overlay with its own backdrop — otherwise the skip
   list is a hole big enough to hide the next #mlsAvKioskOrders in. */
for (const id of ['mlsAvKioskConsent', 'mlsAvKioskPin', 'mlsAvKioskReview']) {
  const rule = new RegExp('#' + id + '\\{([^}]*)\\}').exec(css);
  assert.ok(rule, id + ' has no rule of its own, so the measurement is exempting an element it ' +
    'cannot describe');
  assert.ok(/position:absolute/.test(rule[1]) && /inset:0/.test(rule[1]),
    id + ' is exempted from the overlap measurement as a full-screen modal, but it is not one ' +
    '(' + rule[1] + '). Either it stops being exempt or it stops being a floating panel — an ' +
    'exemption that does not match its subject is how the next opaque card gets a free pass.');
  assert.ok(/background:(rgba|linear-gradient|#)/.test(rule[1]),
    id + ' has no backdrop of its own, so it is not a modal, it is a transparent sheet over the ' +
    'patient\'s words');
}

/* ── 4. AND THEN IT IS RENDERED AND MEASURED ─────────────────────────────────────────────────
   ⛔ AT WIDTHS THAT ACTUALLY TRIGGER EVERY BRANCH OF THE STYLESHEET. The previous version of this
   list was five LANDSCAPE sizes, 800-1920px wide, so the `@media (max-width:720px)` branch — the
   one where the proposed-actions panel becomes a full-width BOTTOM SHEET, i.e. a completely
   different stacking problem from the side card — was never executed by anything in the gate. It
   was pinned as a STRING by the regex in section 1 and nothing more, and a responsive rule pinned
   as a string is not tested. Measured the moment portrait viewports were added: the panel covered
   the live transcript at 20-25 of 25 points and the progress line at 25 of 25 on every narrow
   size, the opaque corner pills were painted over the avatar's name, and the face sat on top of
   "End interview" — none of which the desktop reservation can affect. */
(async () => {
  const { chromium } = require('playwright');
  const exe = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  const html = lib.page(src);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const bad = [];
  let rows = 0;
  /* the guard on the guard: every media condition the stylesheet declares must be MATCHED by a
     viewport in the list, asserted by the browser rather than by reading the source */
  const conditions = lib.mediaConditions(css);
  assert.ok(conditions.length >= 2,
    'the stylesheet declares only ' + conditions.length + ' media condition(s); this check is then ' +
    'guarding nothing and the narrow-screen branch could vanish unnoticed');
  const matched = Object.create(null);
  try {
    for (const vp of lib.VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.setContent(html, { waitUntil: 'load' });
      for (const c of await page.evaluate(
        (cs) => cs.filter((c) => matchMedia(c).matches), conditions)) {
        matched[c] = (matched[c] || []).concat(vp.w + 'x' + vp.h);
      }
      for (const st of lib.STATES) {
        await page.evaluate(lib.applyStateScript(st));
        const m = await page.evaluate(lib.MEASURE);
        rows++;
        const where = vp.w + 'x' + vp.h + ' [' + st.id + '] ' + st.label;
        for (const c of m.covered) {
          bad.push('COVERED  ' + where + ': "' + c.sample + '" (#' + c.text + ') is painted OVER by #' +
            c.under + ' at ' + c.points + ' of ' + c.of + ' sampled points');
        }
        for (const s of m.spills) {
          bad.push('SPILL    ' + where + ': #' + s.from + ' paints ' + s.px + 'px into #' + s.into);
        }
        for (const o of m.overflows.filter((x) => !x.owns)) {
          bad.push('UNOWNED  ' + where + ': #' + o.id + ' overflows its box by ' + o.over +
            'px with no scroller, so the surplus lands on the next sibling');
        }
        for (const c of m.clipped) {
          bad.push('CLIPPED  ' + where + ': "' + c.sample + '" (#' + c.id + ') is off screen (' +
            c.top + '..' + c.bottom + ' in a ' + vp.h + 'px viewport)');
        }
        for (const s of m.sliced) {
          bad.push('SLICED   ' + where + ': #' + s.id + ' clips at ' + s.lines +
            ' lines, so its last visible line is cut through the middle of the glyphs');
        }
        /* the face is decoration and it is the one element allowed to yield — but it must stay a
           CIRCLE while it does, or the portrait becomes an ellipse inside a border-radius frame */
        /* ⚠️ AND A FACE WITH NO SIZE MUST BE ONE A RULE REMOVED. `|faceW - faceH| <= 2` is
           satisfied perfectly by 0x0, so on its own it would pass a face that had collapsed to
           nothing — the exact "a better statistic over the wrong pixels" trap this lane keeps
           hitting. On a phone with the proposed-actions panel open the face IS deliberately
           display:none (it is the one decorative child, and the alternative was the panel on the
           words); anywhere else a zero-size face is a defect. */
        if (m.faceW === 0 && m.faceH === 0) {
          assert.strictEqual(m.faceDisplay, 'none',
            'the avatar\'s face has collapsed to 0x0 at ' + where + ' while still being laid out (' +
            m.faceDisplay + ') — it was squeezed out of existence rather than removed by a rule');
        } else {
          assert.ok(Math.abs(m.faceW - m.faceH) <= 2,
            'the avatar\'s face is ' + m.faceW + 'x' + m.faceH + ' at ' + where + ' — it yields by ' +
            'being SQUEEZED rather than scaled, so the portrait is an ellipse inside a ' +
            'border-radius:999px;overflow:hidden frame');
          assert.ok(m.faceH >= 40,
            'the avatar\'s face is ' + m.faceW + 'x' + m.faceH + ' at ' + where + ' — a patient ' +
            'cannot read a face that small, and it is the thing that makes this a person to talk to');
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  /* ⚠️ VIEWPORT-SHAPED CONDITIONS ONLY, and the partition is by what the condition MENTIONS, not by
     a list I typed: `prefers-reduced-motion` cannot be satisfied by resizing a window, and pretending
     otherwise would make this check either red for ever or quietly exempt whatever it could not
     match. Anything that talks about width, height, orientation or aspect-ratio is this list's job. */
  const sizeShaped = conditions.filter((c) => /width|height|orientation|aspect-ratio/.test(c));
  const unmatched = sizeShaped.filter((c) => !matched[c]);
  assert.deepEqual(unmatched, [],
    'A RESPONSIVE BRANCH OF THE SHIPPED STYLESHEET IS NEVER RENDERED BY THIS SUITE: ' +
    unmatched.join(' | ') + '. That is exactly how the narrow-screen bottom-sheet layout shipped ' +
    'with an opaque card on the patient\'s words through two "fix the overlapping text" rounds — ' +
    'the rule was pinned as a STRING by a regex and no viewport in the list could make it match. ' +
    'Add a viewport that triggers it. Matched: ' + JSON.stringify(matched));
  assert.deepEqual(bad, [],
    'THE PATIENT-FACING TEXT IS COVERED, SPILLED OR CLIPPED IN ' + bad.length + ' PLACE(S). This is ' +
    'the owner\'s "text constantly overlapping", measured by rendering the SHIPPED stylesheet and ' +
    'the SHIPPED markup and asking the browser what is painted at the words\' own coordinates:\n  ' +
    bad.join('\n  '));
  console.log('PASS the kiosk\'s text is never covered: ' + rows + ' rendered states (' +
    lib.STATES.length + ' x ' + lib.VIEWPORTS.length + ' viewports), every text box sampled at 25 ' +
    'points with elementFromPoint — 0 covered, 0 cross-element spills, 0 unowned overflows, 0 off ' +
    'screen, 0 lines sliced, and the face stays circular at every size. The proposed-actions ' +
    'panel\'s area is RESERVED by the column (one custom property, one writer), which is what makes ' +
    'the overlap structurally impossible rather than merely absent today.');
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
