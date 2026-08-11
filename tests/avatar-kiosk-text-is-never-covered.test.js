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

/* ── 2b. THE STATE LIST IS AUDITED AGAINST THE STYLESHEET, NOT TRUSTED ─────────────────────────
   The rendered states are written by hand — their say/interim strings come from real call sites and
   nothing can derive those. But the ROOT CLASSES they exercise can be derived, and the class the
   previous round missed (`.hasorders`) is exactly the shape of miss this catches: a branch of the
   layout that the stylesheet styles and no state ever renders. */
{
  const styled = lib.rootStateClasses(css);
  assert.ok(styled.length >= 5,
    'only ' + styled.length + ' root state class(es) found in the stylesheet, so this audit is ' +
    'reading the wrong thing and guarding nothing');
  const exercised = Object.create(null);
  for (const st of lib.STATES) String(st.cls || '').split(/\s+/).filter(Boolean)
    .forEach((c) => { exercised[c] = true; });
  /* `preconsent` is the consent screen, and the consent overlay is one of the three declared modals
     the measurement exempts — covering the screen is its job, and it has its own suite
     (avatar-consent-and-turn-taking-proof.js). It is named here rather than filtered by a pattern. */
  const NOT_A_LAYOUT_STATE = ['preconsent'];
  const never = styled.filter((c) => !exercised[c] && NOT_A_LAYOUT_STATE.indexOf(c) < 0);
  assert.deepEqual(never, [],
    'THE STYLESHEET STYLES ROOT STATE(S) THAT NO RENDERED STATE EVER PUTS ON THE ROOT: ' +
    never.join(', ') + '. That is how #mlsAvKioskOrders survived two "fix the overlapping text" ' +
    'rounds — its class was styled and never rendered, so nothing could see the opaque card it ' +
    'puts on the patient-facing line. Add a state that wears it, or explain why it is not a layout ' +
    'state. Styled: ' + styled.join(', '));
}

/* ── 2c. AND THE ROWS THE STYLESHEET CANNOT SEE (av-6.3.2, defect 3) ───────────────────────────
   ⛔ THE THIRD HAND-WRITTEN POPULATION IN THIS DEFECT'S HISTORY. Round 1 of it was a hand-written
   list of fifteen element ids that omitted the offender. Round 2 was a hand-written list of five
   landscape viewports that could not match the narrow media query. This is round 3: the STATE list
   is hand-written, and it never PAIRED the proposed-actions sheet with either of the two other rows
   the module switches on with an INLINE `display` — #mlsAvKioskRest and #mlsAvKioskTypeRow. Section
   2b audits the root CLASSES against the stylesheet; an inline style is invisible to a stylesheet,
   so nothing audited these at all, and the suite was GREEN while the card covered the hand-off note
   at 25 of 25 sampled points on every phone size.
   The rows are DERIVED from the module now, every combination of them is declared with the call site
   that reaches it, and a combination declared unreachable has to prove it from the source. */
{
  const derived = lib.inlineDisplayRows(src);
  assert.ok(derived.rows.length >= 3,
    'only ' + derived.rows.length + ' inline-display row(s) derived from the module (' +
    derived.rows.join(', ') + '), so this audit is reading the wrong thing and guarding nothing');
  /* every derived row appears in the pair matrix, on its own at least once */
  const inMatrix = Object.create(null);
  for (const p of lib.ROW_PAIRS) p.rows.forEach((r) => { inMatrix[r] = true; });
  const unpaired = derived.rows.filter((r) => !inMatrix[r]);
  assert.deepEqual(unpaired, [],
    'THE MODULE TOGGLES ROW(S) THIS SUITE HAS NEVER HEARD OF: ' + unpaired.join(', ') + '. An inline ' +
    '`display` beats the stylesheet and is invisible to it, so a row nobody paired is a layout ' +
    'branch nobody renders — which is exactly how an opaque card sat on #mlsAvKioskRestNote at 25 ' +
    'of 25 points on every phone size while this file was green. Add it to ROW_PAIRS with the call ' +
    'site that shows it, and add a state that renders it.');
  /* every REACHABLE combination is actually rendered by the named state, with the right rows up */
  const byId = Object.create(null);
  for (const st of lib.STATES) byId[st.id] = st;
  const ROW_FLAG = { mlsAvKioskOrders: 'orders', mlsAvKioskRest: 'rest', mlsAvKioskTypeRow: 'typeRow' };
  for (const p of lib.ROW_PAIRS.filter((x) => x.reachable)) {
    const st = byId[p.state];
    assert.ok(st, 'ROW_PAIRS names state ' + p.state + ' for [' + p.rows.join('+') + '] and no such ' +
      'state exists, so that combination is declared covered and is not rendered');
    for (const r of derived.rows) {
      const want = p.rows.indexOf(r) >= 0;
      const got = !!st[ROW_FLAG[r]];
      assert.strictEqual(got, want,
        'state ' + p.state + ' is supposed to render [' + p.rows.join('+') + '] (' + p.by + ') but ' +
        r + ' is ' + (got ? 'up' : 'down') + ' in it. A pair claimed as covered and not actually ' +
        'rendered is the same blind spot with a label on it.');
    }
  }
  /* ⛔ AND A PAIR DECLARED UNREACHABLE MUST PROVE IT FROM THE SOURCE. "those two never happen
     together" is exactly the kind of claim that becomes the next blind spot, so the function named
     in `by` has to contain the statement that hides the other row. */
  for (const p of lib.ROW_PAIRS.filter((x) => !x.reachable)) {
    const at = src.indexOf('function ' + p.by + '(');
    assert.ok(at > 0, 'ROW_PAIRS claims [' + p.rows.join('+') + '] is unreachable because of ' +
      p.by + ', and there is no such function — the claim cannot be checked, so it is not a claim');
    const body = src.slice(at, at + 2600);
    const re = new RegExp('gid\\(\'' + p.hides + '\'\\)[\\s\\S]{0,120}display = \'none\'|' +
      'kioskRestHide\\(\\)');
    assert.ok(re.test(body),
      'ROW_PAIRS declares [' + p.rows.join('+') + '] unreachable because ' + p.by + ' hides #' +
      p.hides + ' — and ' + p.by + ' does not hide it any more. The combination is now REACHABLE ' +
      'and nothing renders it. Add a state for it, or restore the hide.');
  }
  /* the reservation classes the new rows need are really in the stylesheet, or the pairing above
     renders a layout that has no rule behind it */
  assert.ok(/#mlsAvKiosk\.resting/.test(css),
    'the stylesheet no longer mentions `resting`, so the hand-off row reserves nothing and the ' +
    'opaque proposed-actions card is back on #mlsAvKioskRestNote');
  assert.ok(/function kioskRestReserve\(on\)[\s\S]{0,400}classList\.add\('resting'\)[\s\S]{0,160}classList\.remove\('resting'\)/.test(src),
    'kioskRestReserve no longer toggles the `resting` reservation class both ways — the class and ' +
    'the row can then disagree, which is the ordersReserve defect on a second row');
  /* ⚠️ AND THE CALL SITES, WHICH THE RENDERED SWEEP CANNOT SEE. The harness puts the root class on
     from its own state list, so a kioskRestShow that stopped setting it would render an identical
     page and measure clean. Both writers of the row's inline display must move the class with it. */
  assert.ok(/function kioskRestShow\(\)[\s\S]{0,200}kioskRestReserve\(true\)/.test(src),
    'kioskRestShow shows the hand-off row without telling the layout it is there. The row is shown ' +
    'with an INLINE display, which the stylesheet cannot see, so the reservation never happens and ' +
    'the opaque proposed-actions card is painted over #mlsAvKioskRestNote (measured at 25 of 25 ' +
    'sampled points at 375x812, 414x896, 360x740 and 320x568).');
  assert.ok(/function kioskRestHide\(\)[\s\S]{0,200}kioskRestReserve\(false\)/.test(src),
    'kioskRestHide hides the hand-off row and leaves the reservation behind — a phantom band at the ' +
    'bottom of the screen that pushes the question off-centre for the rest of the visit');
  assert.strictEqual((src.match(/mlsAvKioskRest'\)/g) || []).length, 2,
    'the hand-off row is reached from ' + (src.match(/mlsAvKioskRest'\)/g) || []).length + ' places. ' +
    'With more than the two that own it (kioskRestShow and kioskRestHide), "one writer" is an ' +
    'unfounded claim and the class can be left behind.');
  {
    /* one writer, same rule as `hasorders`: outside the stylesheet only a classList add/remove may
       mention it, and the stylesheet is exempted by its LINE RANGE rather than by selector shape */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const styleAt = code.indexOf('function kioskStyle()');
    const styleEnd = code.indexOf('appendChild(st)', styleAt);
    const firstStyleLine = code.slice(0, styleAt).split('\n').length;
    const lastStyleLine = code.slice(0, styleEnd).split('\n').length;
    const others = code.split('\n').map((ln, i) => [i + 1, ln])
      .filter(([, ln]) => /'resting'/.test(ln))
      .filter(([n]) => n < firstStyleLine || n > lastStyleLine)
      .filter(([, ln]) => !/classList\.(add|remove)\('resting'\)/.test(ln))
      /* kioskState('resting') is the CHIP's data-state, a different fact with a different owner */
      .filter(([, ln]) => !/kioskState\('resting'\)/.test(ln));
    assert.deepEqual(others.map(([n, ln]) => n + ': ' + ln.trim()), [],
      'something other than kioskRestReserve and the stylesheet touches the `resting` class');
  }
  /* ── AND THE SHEET'S HEIGHT AND THE HEIGHT RESERVED FOR IT ARE THE SAME NUMBER ────────────────
     On a narrow screen the card is a bottom sheet, so the column reserves HEIGHT. Two hand-written
     copies of one number drift, and the day they drift the card is back on the words. There are two
     pairs now (the base narrow rule and the resting override), so this is derived rather than
     spot-checked. */
  {
    const narrow = /@media \(max-width:720px\)\{([\s\S]*?)\}\s*@/.exec(css);
    assert.ok(narrow, 'the narrow-screen branch of the stylesheet is gone');
    /* the state a rule applies to, with `hasorders` removed (it is a given on both sides of this
       comparison) and the rest sorted, so the sheet's selector and the column's selector produce
       the SAME key whatever order their classes are written in */
    const stateKey = (sel) => String(sel || '').split('.').filter(Boolean)
      .filter((c) => c !== 'hasorders').sort().join('.');
    const sheets = {};
    let m;
    const reS = /#mlsAvKiosk((?:\.[\w-]+)*)\s*#mlsAvKioskOrders\{[^}]*max-height:(\d+)vh/g;
    while ((m = reS.exec(narrow[1]))) sheets[stateKey(m[1])] = m[2];
    /* the base rule declares the sheet without a root-state prefix */
    const base = /#mlsAvKioskOrders\{[^}]*max-height:(\d+)vh/.exec(narrow[1]);
    if (base) sheets[''] = sheets[''] || base[1];
    const reserves = {};
    const reR = /#mlsAvKiosk((?:\.[\w-]+)*)\{[^}]*padding-bottom:calc\((\d+)vh/g;
    while ((m = reR.exec(narrow[1]))) reserves[stateKey(m[1])] = m[2];
    assert.ok(Object.keys(sheets).length >= 2 && Object.keys(reserves).length >= 2,
      'this check found ' + Object.keys(sheets).length + ' sheet height(s) and ' +
      Object.keys(reserves).length + ' reservation(s); with fewer than two of each it is not ' +
      'checking the pair it exists for. sheets=' + JSON.stringify(sheets) +
      ' reserves=' + JSON.stringify(reserves));
    for (const k of Object.keys(reserves)) {
      const want = sheets[k] || sheets[''];
      assert.strictEqual(reserves[k], want,
        'THE COLUMN RESERVES ' + reserves[k] + 'vh FOR A SHEET THAT IS ' + want + 'vh TALL' +
        (k ? ' in state "' + k + '"' : '') + '. The two numbers are one fact; when they drift the ' +
        'opaque card is painted over the patient-facing text again. sheets=' +
        JSON.stringify(sheets) + ' reserves=' + JSON.stringify(reserves));
    }
  }
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
    /* ══ FIRST, PROVE THE DETECTOR CAN FAIL — AND CAN REFUSE TO (av-6.3.2, defect 3) ═════════════
       A sweep that has only ever said "clean" is indistinguishable from a sweep that cannot say
       anything else, and this one was green at six viewports while an opaque card sat on the
       hand-off note. So before any of the shipped states are judged, three KNOWN states are
       constructed in a rendered page and the detector's verdict on each is asserted. If any of these
       three is wrong, every "0 covered" below is worthless and the suite says so here instead. */
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
      await page.setContent(html, { waitUntil: 'load' });
      const withOrders = lib.STATES.find((s) => s.id === 'L');
      /* 1 — A KNOWN COVERING ELEMENT MUST BE CAUGHT, and named, and called a paint defect. */
      await page.evaluate(lib.applyStateScript(withOrders));
      await page.evaluate(lib.PROBE_COVER);
      const c1 = (await page.evaluate(lib.MEASURE)).covered
        .filter((c) => c.under === 'mlsAvProbeCover' && c.text === 'mlsAvKioskInterim');
      assert.strictEqual(c1.length, 1,
        'THE OCCLUSION DETECTOR CANNOT SEE A KNOWN OCCLUDER. An opaque white div was placed exactly ' +
        'over #mlsAvKioskInterim at z-index 2147483000 and the sweep did not report it. Every ' +
        '"0 covered" this file prints is then meaningless — which is exactly the state it was in ' +
        'while #mlsAvKioskOrders covered the hand-off note at 25 of 25 points on every phone size.');
      assert.strictEqual(c1[0].points, 25,
        'the known occluder covers the whole box and was only caught at ' + c1[0].points +
        ' of 25 sampled points, so the sample grid is not landing inside the text box');
      assert.strictEqual(c1[0].kind, 'paint',
        'the known OPAQUE occluder was classified as "' + c1[0].kind + '" rather than paint, so the ' +
        'paint walk cannot tell something drawn over the words from something merely hit-tested');
      /* 2 — A KNOWN HARMLESS ELEMENT BEHIND AN OPAQUE CARD MUST NOT BE REPORTED. This is the false
         positive this lane has already shipped once: 21 "overlaps" that were a header sitting
         behind an opaque panel, inferred from rect intersections. */
      await page.evaluate(lib.applyStateScript(withOrders));
      const geo = await page.evaluate(lib.PROBE_BEHIND);
      /* the trap has to be real, or "it reported nothing" proves nothing */
      assert.strictEqual(geo.rectPointsInsideCard, geo.of,
        'the harmless-element proof is not set up: only ' + geo.rectPointsInsideCard + ' of ' +
        geo.of + ' of its sample points fall inside the opaque card\'s rect, so a rect-intersection ' +
        'detector would not have called this an overlap either and the proof discriminates nothing');
      assert.strictEqual(geo.pointsWhereSomethingElseIsHit, geo.of,
        'the harmless element is not actually hidden: it is hit-tested at ' +
        (geo.of - geo.pointsWhereSomethingElseIsHit) + ' of its own sample points, so it is NOT ' +
        'behind the card and this is not the case the proof claims to construct');
      const m2 = await page.evaluate(lib.MEASURE);
      const c2 = m2.covered.filter((c) => c.under === 'mlsAvProbeBehind');
      assert.deepEqual(c2.map((c) => c.text + ' under ' + c.under + ' (' + c.kind + ')'), [],
        'THE DETECTOR REPORTS A FALSE OVERLAP. An element was placed at the proposed-actions card\'s ' +
        'own coordinates but BEHIND it (z-index 1 against the card\'s 6): its rect intersects at ' +
        geo.of + ' of ' + geo.of + ' points and it is hidden at all of them, so it covers NOTHING. ' +
        'Geometry is not visibility, and this lane has already published 21 false overlaps of ' +
        'exactly this shape — a detector that cries wolf trains its readers to dismiss a real red.');
      /* ⚠️ AND THE OTHER DIRECTION OF THE SAME STATE IS *NOT* A FALSE POSITIVE: this element's own
         text really is hidden under an opaque card, and the sweep is right to say so. Asserted here
         so the proof above cannot be satisfied by a detector that has simply stopped looking. */
      const c2b = m2.covered.filter((c) => c.text === 'mlsAvProbeBehind' && c.under === 'mlsAvKioskOrders');
      assert.strictEqual(c2b.length, 1,
        'the element hidden UNDER the opaque card was not reported as covered. The detector is not ' +
        'reporting false overlaps because it has stopped detecting overlaps.');
      assert.strictEqual(c2b[0].kind, 'paint',
        'text hidden under the opaque white proposed-actions card was classified as "' +
        c2b[0].kind + '" rather than paint');
      /* 3 — A TRANSPARENT OVERLAY IS REPORTED, BUT AS A POINTER DEFECT, NOT AS COVERED TEXT. Both
         are failures; saying which turns a mystery into an instruction. */
      await page.evaluate(lib.applyStateScript(withOrders));
      await page.evaluate(lib.PROBE_TRANSPARENT);
      const c3 = (await page.evaluate(lib.MEASURE)).covered.filter((c) => c.under === 'mlsAvProbeGhost');
      assert.strictEqual(c3.length, 1,
        'a fully transparent box over #mlsAvKioskInterim was not reported at all. Nothing is drawn ' +
        'on the words, but the point is unreachable — which is how staff came to be able to SEE ' +
        '"End interview" and not press it. It must still be reported.');
      assert.strictEqual(c3[0].kind, 'pointer',
        'a fully transparent box over the text was classified as "' + c3[0].kind + '", i.e. as ' +
        'something drawn over the words. Nothing is drawn there; the walk is finding paint that is ' +
        'not on the path between the hit element and the text.');
      await page.close();
    }
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
          bad.push('COVERED  ' + where + ': "' + c.sample + '" (#' + c.text + ') is ' +
            (c.kind === 'paint' ? 'painted OVER by #' + c.under + ' (drawn by ' + c.by + ')'
              : 'unreachable under #' + c.under + ' (nothing painted — a POINTER defect)') +
            ' at ' + c.points + ' of ' + c.of + ' sampled points');
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
    'panel\'s area is RESERVED by the column (one custom property, one writer, and the sheet height ' +
    'and the reservation derived from the stylesheet and asserted equal), which is what makes the ' +
    'overlap structurally impossible rather than merely absent today.\n' +
    '     THE DETECTOR IS PROVEN, NOT ASSUMED: the three inline-display rows are DERIVED from the ' +
    'module and every combination of them is either rendered or proved unreachable from the source ' +
    '(the pairing nobody had made is what hid an opaque card on the hand-off note at 25 of 25 points ' +
    'on every phone size while this file was green) — and before any shipped state is judged, a ' +
    'known opaque occluder is caught at 25 of 25 points as "paint", a known element BEHIND the ' +
    'opaque card whose rect intersects at 25 of 25 points is reported as covering nothing (while its ' +
    'own hidden text IS reported, so the silence is not the detector giving up), and a fully ' +
    'transparent overlay is reported as "pointer" rather than as covered text.');
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
