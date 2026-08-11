'use strict';
/*
 * THE OPAQUE PANEL IS NEVER PAINTED ON THE PATIENT'S WORDS (av-6.4.0)
 * ==============================================================================================
 * Owner, twice: "having text constantly overlapping and being such a paIUN IN THE ASS", then
 * "fix the overlaying text to".
 *
 * ⛔ WHY THIS FILE EXISTS AT ALL — THE EARLIER FIXES COULD NOT HAVE WORKED.
 * One round serialised fourteen writers onto the patient-facing text NODE (a real defect, and
 * kioskLine still owns that node). Another capped the text boxes so the flex column could not
 * compress them (also real). Neither could fix what the owner was looking at, because
 * #mlsAvKioskOrders is a DIFFERENT ELEMENT painted on top of that node: opaque white,
 * position:absolute, right:16px bottom:16px, up to 52vh tall, z-index 6 — straight over the live
 * transcript and the progress line. An arbitrator owns one node; it cannot own what is drawn above
 * it. And the code-reading suites all asked what was WRITTEN to the line, never what was DRAWN
 * over it.
 *
 * ═══ POPULATION STATEMENT — READ THIS BEFORE TRUSTING A GREEN RESULT ════════════════════════════
 * This suite measures ONE occluder — #mlsAvKioskOrders, the proposed-actions panel — against the
 * THREE patient-facing text nodes (#mlsAvKioskSay, #mlsAvKioskInterim, #mlsAvKioskProgress), at
 * viewports chosen so that EVERY media condition the shipped stylesheet declares is matched by at
 * least one of them (asserted by the browser, not by reading the source).
 * ⛔ IT IS NOT A FULL SWEEP OF EVERY ELEMENT IN THE OVERLAY, AND IT DOES NOT CLAIM TO BE. A
 * whole-overlay sweep (every element under the root, a grid of elementFromPoint samples inside
 * every text box, plus spill/clip/slice detection) exists on wip/avatar-speech-round6 and depends
 * on that branch's larger layout restructure — capped text boxes, flex-shrink:0 on every child, a
 * face allowed to yield, a clipping root. That restructure is NOT landed here, deliberately: it is
 * a change set of its own, and landing half of a layout rework is the failure this lane has already
 * recorded ("never land it half-way"). So the honest scope is: the specific opaque card the owner
 * was looking at, proved not to cover the words, plus the structural invariant that keeps it that
 * way. Anything beyond that is open work, not a claim.
 *
 * The occluder is chosen BY MEASUREMENT, not by memory: section 0 derives every absolutely
 * positioned, opaque, z-indexed element from the stylesheet and asserts that the one this suite
 * measures is among them — because a hand-written list of fifteen element ids that omitted the
 * offender is one of the three hand-written-population defects this lane has already paid for.
 *
 * ═══ CONTROLS, MEASURED — THE PRE-FIX BYTES AND TWO MUTATIONS OF THE SHIPPED ONES ══════════════
 *   MLS_AVATAR_SRC=<origin/main checkout>
 *     Section 1 fails BY NAME: "the panel width is no longer declared as a custom property".
 *     main declares neither --mlsav-panel nor .hasorders, so nothing reserves the panel's area.
 *   The shipped bytes with the WIDE gutter zeroed
 *     (padding-right:calc(var(--mlsav-panel) + 32px) -> calc(var(--mlsav-panel) * 0)) —
 *     the static assertions still pass (the rule and the property are both still there), and the
 *     RENDERED sweep fails: #mlsAvKioskSay and #mlsAvKioskInterim covered at 5 of 25 points at
 *     1366x768 and 10 of 25 at 1024x768.
 *   The shipped bytes with the NARROW reservation zeroed
 *     (padding-bottom:calc(44vh + 16px) -> calc(44vh * 0)) —
 *     12 covered: at 720x1024, 414x896, 375x812 and 320x568 the transcript and the progress line
 *     are covered at 25 of 25 points and the question at 15-20 of 25.
 * So the static sections and the rendered section each fail on a mutation the other one passes.
 * Neither is decoration for the other.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(process.env.MLS_AVATAR_SRC || path.join(root, 'feat_mls_avatar.js'), 'utf8');

/* ── the stylesheet and the markup, exactly as the module installs them ───────────────────────── */
function liftKioskCss(src) {
  const at = src.indexOf('function kioskStyle()');
  assert.ok(at > 0, 'kioskStyle is gone, so nothing here can read the shipped stylesheet');
  const end = src.indexOf('\n  }', src.indexOf('appendChild(st)', at));
  const body = src.slice(at, end + 4);
  let captured = '';
  const fn = new Function('capture', `
    var gid = function () { return null; };
    var document = {
      createElement: function () { return { set textContent(v) { capture(v); }, get textContent() { return ''; } }; },
      head: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    };
    ${body}
    kioskStyle();
  `);
  fn((v) => { captured = v; });
  assert.ok(captured && captured.length > 500, 'the kiosk stylesheet did not lift');
  return captured;
}
function liftKioskHtml(src) {
  const at = src.indexOf('    root.innerHTML =');
  assert.ok(at > 0, 'the kiosk markup template is gone');
  const lines = src.slice(at).split('\n');
  const out = [];
  for (const ln of lines) { out.push(ln); if (/'\s*;\s*$/.test(ln) || /';\s*$/.test(ln)) break; }
  const expr = out.join('\n').replace('    root.innerHTML =', 'return (').replace(/;\s*$/, ');');
  const recAt = src.indexOf('var AMBIENT_REC_TEXT = ');
  const recTxt = /var AMBIENT_REC_TEXT = '([^']*)'/.exec(src.slice(recAt, recAt + 400));
  assert.ok(recTxt, 'AMBIENT_REC_TEXT is gone');
  const html = new Function('AMBIENT_REC_TEXT', expr)(recTxt[1]);
  assert.ok(html && html.indexOf('mlsAvKioskInterim') >= 0, 'the lifted markup has no interim line');
  return html;
}
const css = liftKioskCss(SRC);

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   0. THE OCCLUDER POPULATION IS DERIVED FROM THE STYLESHEET, NOT REMEMBERED
   ═════════════════════════════════════════════════════════════════════════════════════════════ */
const TEXT_NODES = ['mlsAvKioskSay', 'mlsAvKioskInterim', 'mlsAvKioskProgress'];
const MODALS = ['mlsAvKioskConsent', 'mlsAvKioskPin', 'mlsAvKioskReview'];
let OCCLUDERS = [];
{
  const floating = [];
  const re = /#(mlsAv[A-Za-z]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const decl = m[2];
    if (!/position:absolute/.test(decl)) continue;
    if (!/z-index:\s*\d/.test(decl)) continue;
    if (!/background:\s*(#|rgb|linear-gradient)/.test(decl)) continue;   /* transparent cannot hide text */
    if (MODALS.indexOf(m[1]) >= 0) continue;   /* a modal covering the screen is its job */
    if (floating.indexOf(m[1]) < 0) floating.push(m[1]);
  }
  assert.ok(floating.length >= 1,
    'no absolutely positioned, opaque, z-indexed element was derived from the stylesheet, so this ' +
    'suite is reading the wrong thing and its "0 covered" result would mean nothing');
  assert.ok(floating.indexOf('mlsAvKioskOrders') >= 0,
    'THE PROPOSED-ACTIONS PANEL IS NO LONGER AN OPAQUE FLOATING CARD in the stylesheet, so the ' +
    'element this suite measures is not the element that caused the defect. Derived floating, ' +
    'opaque elements: ' + floating.join(', '));
  /* ⛔ EVERY DERIVED OCCLUDER IS MEASURED, NOT JUST THE ONE THIS CHANGE FIXED. Writing this
     derivation immediately found two the author had not thought of — #mlsAvKioskMute and
     #mlsAvKioskEndVisit, the opaque corner pills — and the first draft of this file EXEMPTED them
     with a hand-written note. That is the same defect as the fifteen-element list that omitted the
     offender: an exemption is a hand-written population wearing a reason. So the list the sweep
     uses IS the derived list, and adding an opaque floating element to the stylesheet
     automatically puts it under measurement. */
  OCCLUDERS = floating.slice().sort();
  assert.ok(OCCLUDERS.indexOf('mlsAvKioskOrders') >= 0 && OCCLUDERS.length >= 1,
    'the derived occluder list is empty or has lost the panel: ' + OCCLUDERS.join(', '));
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   1. THE RESERVATION IS STRUCTURAL, WITH ONE SOURCE OF TRUTH
   ═════════════════════════════════════════════════════════════════════════════════════════════
   FAILS ON origin/main: it declares neither --mlsav-panel nor .hasorders. */
assert.ok(/--mlsav-panel:\s*min\(/.test(css),
  'the panel width is no longer declared as a custom property. Two hand-written copies of it — one ' +
  'for the card, one for the gutter — drift, and the day they drift the opaque card is back on top ' +
  'of the patient-facing text.');
assert.ok(/#mlsAvKioskOrders\{[^}]*width:var\(--mlsav-panel\)/.test(css),
  'the proposed-actions panel no longer takes its width from --mlsav-panel');
assert.ok(/#mlsAvKiosk\.hasorders\{[^}]*padding-right:calc\(var\(--mlsav-panel\)/.test(css),
  'THE TEXT COLUMN NO LONGER RESERVES THE PANEL\'S AREA. #mlsAvKioskOrders is an opaque white card ' +
  'at right:16px;bottom:16px, up to 52vh tall, z-index 6 — i.e. painted straight over the live ' +
  'transcript and the progress line.');
assert.ok(/@media \(max-width:720px\)\{[^@]*#mlsAvKiosk\.hasorders\{[^}]*padding-bottom:calc\(/.test(css),
  'on a narrow screen the panel becomes a full-width bottom sheet (right:8px;left:8px;bottom:8px), ' +
  'so a right-hand gutter reserves the WRONG AXIS entirely and the card sits on the transcript. ' +
  'The column must reserve HEIGHT there.');

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   2. THE SHEET'S HEIGHT AND THE HEIGHT RESERVED FOR IT ARE THE SAME NUMBER — DERIVED, NOT SPOTTED
   ═════════════════════════════════════════════════════════════════════════════════════════════ */
{
  const narrow = /@media \(max-width:720px\)\{([\s\S]*?)\}\s*@/.exec(css);
  assert.ok(narrow, 'the narrow-screen branch of the stylesheet is gone');
  const sheet = /#mlsAvKioskOrders\{[^}]*max-height:(\d+)vh/.exec(narrow[1]);
  const reserve = /#mlsAvKiosk\.hasorders\{[^}]*padding-bottom:calc\((\d+)vh/.exec(narrow[1]);
  assert.ok(sheet && reserve,
    'the narrow-screen sheet height and its reservation could not both be derived from the ' +
    'stylesheet, so this check is not checking the pair it exists for');
  assert.strictEqual(reserve[1], sheet[1],
    'THE COLUMN RESERVES ' + reserve[1] + 'vh FOR A SHEET THAT IS ' + sheet[1] + 'vh TALL. The two ' +
    'numbers are ONE FACT; when they drift the opaque card is painted over the patient-facing text ' +
    'again. And it must be the sheet\'s MAX height, because a card that grows as the doctor talks ' +
    'must never grow into the words.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   3. ONE WRITER OWNS BOTH FACTS
   ═════════════════════════════════════════════════════════════════════════════════════════════
   ⚠️ THE STYLESHEET IS EXEMPTED BY WHERE IT IS, NOT BY WHAT ITS SELECTORS LOOK LIKE. A pattern
   exemption matches the rules that existed when it was written, so the next rule added reads as a
   second WRITER of the class. It never is: a CSS rule READS the class. The exemption is therefore
   the LINE RANGE of kioskStyle — a fact about the file rather than a guess about selector shapes. */
{
  const at = SRC.indexOf('function ordersRender()');
  assert.ok(at > 0, 'ordersRender is gone');
  const body = SRC.slice(at, SRC.indexOf('\n  function ', at + 20));
  assert.ok(/ordersReserve\(false\)/.test(body) && /ordersReserve\(true\)/.test(body),
    'ordersRender shows and hides the panel but does not set the class that makes the column ' +
    'reserve its area on BOTH branches. The panel appearing without the reservation is the defect ' +
    'itself; the reservation surviving the panel closing is a phantom gutter that pushes the ' +
    'question off-centre for the rest of the visit.');
  assert.ok(/function ordersReserve\(on\)[\s\S]{0,500}classList\.add\('hasorders'\)[\s\S]{0,120}classList\.remove\('hasorders'\)/.test(SRC),
    'ordersReserve no longer toggles the reservation class both ways');
  /* ⚠️ COMMENTS STRIPPED FIRST, and blanked line-for-line so line numbers still mean something.
     A text grep cannot tell code from prose, and the notes that EXPLAIN this rule mention the
     class by name. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const styleAt = code.indexOf('function kioskStyle()');
  const styleEnd = code.indexOf('appendChild(st)', styleAt);
  assert.ok(styleAt > 0 && styleEnd > styleAt,
    'kioskStyle is gone, so this scan cannot tell a stylesheet rule from a second writer');
  const firstStyleLine = code.slice(0, styleAt).split('\n').length;
  const lastStyleLine = code.slice(0, styleEnd).split('\n').length;
  const others = code.split('\n').map((ln, i) => [i + 1, ln])
    .filter(([, ln]) => /hasorders/.test(ln))
    .filter(([n]) => n < firstStyleLine || n > lastStyleLine)
    .filter(([, ln]) => !/classList\.(add|remove)\('hasorders'\)/.test(ln));
  assert.deepEqual(others.map(([n, ln]) => n + ': ' + ln.trim()), [],
    'something other than ordersReserve and the stylesheet touches `hasorders` — two writers for ' +
    'one fact is how the class survives the panel closing');
  assert.ok(/#mlsAvKiosk\.hasorders/.test(css),
    'the stylesheet no longer mentions `hasorders` at all, so the class reserves nothing');
  const showSites = (code.match(/mlsAvKioskOrders'\)/g) || []).length;
  assert.strictEqual(showSites, 1,
    'the panel is reached from ' + showSites + ' places. With more than one, "ordersRender is the ' +
    'single writer" is an unfounded claim and the class can be left behind.');
}

/* ═════════════════════════════════════════════════════════════════════════════════════════════
   4. AND THEN IT IS RENDERED AND MEASURED — elementFromPoint, INSIDE EACH TEXT BOX'S OWN RECT
   ═════════════════════════════════════════════════════════════════════════════════════════════
   ⚠️ NOTHING HERE IS INFERRED FROM A RECT. Geometry is not visibility: an earlier probe in this
   lane reported 21 false overlaps from rect intersections alone, which were a header sitting
   BEHIND an opaque card. The question asked is the only one that matters, at the coordinates of
   the words themselves: WHAT IS ACTUALLY PAINTED HERE?
   ⛔ AND THE DETECTOR IS PROVEN BEFORE IT IS BELIEVED. A sweep that has only ever said "clean" is
   indistinguishable from a sweep that cannot say anything else, so a KNOWN opaque occluder is
   placed over the transcript first and must be caught at all 25 sampled points. */
const CONTROL_ONLY = !!process.env.MLS_AVATAR_CSS_MUTANT;
(async () => {
  const { chromium } = require('playwright');
  const html = '<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{height:100%;font-family:system-ui}</style><style>' + css + '</style>' +
    '<div id="host"></div><script>document.getElementById("host").outerHTML=' +
    JSON.stringify('<div id="mlsAvKiosk">' + liftKioskHtml(SRC).replace(/^\s*/, '') + '</div>') +
    ';<\/script>';

  /* the panel exactly as ordersRender leaves it: inline display:block PLUS the root class, which
     ordersReserve is the single writer of. Both, because both is what the module does. */
  const OPEN_PANEL = `(() => {
    const root = document.getElementById('mlsAvKiosk');
    root.className = 'speaking hasorders';
    document.getElementById('mlsAvKioskConsent').style.display = 'none';
    document.getElementById('mlsAvKioskSay').textContent =
      'Thanks for that. Can you describe the pain for me — where it is, what it feels like, and whether anything makes it better or worse?';
    document.getElementById('mlsAvKioskInterim').textContent =
      'well it started maybe three weeks ago after i moved some boxes in the garage and now it wakes me up at night';
    document.getElementById('mlsAvKioskProgress').textContent = 'Question 4 of 9';
    const ord = document.getElementById('mlsAvKioskOrders');
    ord.style.display = 'block';
    let body = '';
    for (let i = 0; i < 4; i++) {
      body += '<div class="mlsAvOrd" data-kind="medication">' +
        '<div class="mlsAvOrdTop"><b>Naproxen 500 mg</b><span class="mlsAvOrdKind">MEDICATION</span></div>' +
        '<div class="mlsAvOrdDet">twice daily with food for ten days</div></div>';
    }
    ord.innerHTML = '<div class="mlsAvOrdHead"><span class="mlsAvOrdTitle">Proposed actions</span>' +
      '<span class="mlsAvOrdCount">4 to confirm</span></div><div class="mlsAvOrdList">' + body + '</div>';
  })()`;

  /* 25 samples on a 5x5 grid INSIDE each text box's own rect. Reported as covered only when what
     comes back is neither the box, nor inside it, nor an ancestor of it. */
  const MEASURE_FN = `((ids, occluderIds) => {
    const out = [];
    const occs = occluderIds.map((i) => document.getElementById(i)).filter(Boolean);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const hits = {};
      let of = 0;
      for (let i = 1; i <= 5; i++) {
        for (let j = 1; j <= 5; j++) {
          const x = r.left + (r.width * i) / 6, y = r.top + (r.height * j) / 6;
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
          of++;
          const hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          if (hit === el || el.contains(hit) || hit.contains(el)) continue;
          /* WALK UP FROM THE HIT ELEMENT. Geometry is not visibility: a rect intersection reported
             21 false overlaps in this lane, all of them elements sitting BEHIND an opaque card.
             Only something genuinely on the paint path between the hit point and the text counts. */
          let n = hit;
          while (n) {
            const found = occs.find((o) => n === o || o.contains(n));
            if (found) { hits[found.id] = (hits[found.id] || 0) + 1; break; }
            n = n.parentElement;
          }
        }
      }
      out.push({ id: id, of: of, hits: hits });
    }
    return out;
  })`;
  const MEASURE = MEASURE_FN + '(' + JSON.stringify(TEXT_NODES) + ', ' + JSON.stringify(OCCLUDERS) + ')';

  /* ⚠️ APPENDED INSIDE THE KIOSK ROOT, NOT TO document.body, AND A FAILED PROBE IS WHY. The root
     is z-index 2147483200, so a probe placed in the body under any lower z-index paints BEHIND the
     whole overlay and the detector correctly reported nothing — a self-proof that was measuring the
     wrong page. The real occluder (#mlsAvKioskOrders) is a child of the root, so the probe must be
     one too, or it is not the case this suite exists to construct. */
  const PROBE_COVER = `(() => {
    const t = document.getElementById('mlsAvKioskInterim').getBoundingClientRect();
    const d = document.createElement('div');
    d.id = 'mlsAvProbeCover';
    d.style.cssText = 'position:fixed;left:' + t.left + 'px;top:' + t.top + 'px;width:' + t.width +
      'px;height:' + t.height + 'px;background:#fff;z-index:999999';
    document.getElementById('mlsAvKiosk').appendChild(d);
  })()`;
  const MEASURE_PROBE = MEASURE_FN + '(' + JSON.stringify(TEXT_NODES) + ', ["mlsAvProbeCover"])';

  /* the media conditions the stylesheet declares, and the viewports that must match them */
  const conditions = [];
  const reM = /@media ([^{]+)\{/g;
  let mm;
  while ((mm = reM.exec(css))) { const c = mm[1].trim(); if (conditions.indexOf(c) < 0) conditions.push(c); }
  assert.ok(conditions.length >= 2,
    'the stylesheet declares only ' + conditions.length + ' media condition(s), so the viewport ' +
    'audit below is guarding nothing and the narrow-screen branch could vanish unnoticed');
  const VIEWPORTS = [
    { w: 1366, h: 768 }, { w: 1024, h: 768 },      /* the side-card layout */
    { w: 720, h: 1024 }, { w: 414, h: 896 }, { w: 375, h: 812 }, { w: 320, h: 568 },  /* the sheet */
  ];

  /* `channel: 'chrome'` is this repo's convention for every real-browser suite: it drives the
     INSTALLED Google Chrome rather than a downloaded playwright build, so the gate needs no
     `npx playwright install` step and measures the engine the clinicians actually run. */
  const browser = await chromium.launch({ channel: 'chrome' });
  const bad = [];
  const matched = Object.create(null);
  let measured = 0;
  try {
    /* ── PROVE THE DETECTOR CAN FAIL, before any shipped state is judged ───────────────────── */
    {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(OPEN_PANEL);
      await page.evaluate(PROBE_COVER);
      const probe = (await page.evaluate(MEASURE_PROBE))
        .filter((r) => r.id === 'mlsAvKioskInterim' && r.hits.mlsAvProbeCover > 0)
        .map((r) => ({ id: r.id, of: r.of, points: r.hits.mlsAvProbeCover }));
      assert.strictEqual(probe.length, 1,
        'THE OCCLUSION DETECTOR CANNOT SEE A KNOWN OCCLUDER. An opaque white div was placed exactly ' +
        'over #mlsAvKioskInterim at z-index 2147483000 and the sweep returned nothing about it. ' +
        'Every "0 covered" below would then be meaningless — which is exactly the state the ' +
        'previous suites were in while an opaque card sat on the patient-facing line.');
      assert.strictEqual(probe[0].points, probe[0].of,
        'the known occluder covers the whole box and was caught at only ' + probe[0].points + ' of ' +
        probe[0].of + ' sampled points, so the sample grid is not landing inside the text box');
      assert.ok(probe[0].of >= 20,
        'only ' + probe[0].of + ' of 25 grid points landed inside the viewport, so the measurement ' +
        'is sampling mostly off screen');
      await page.close();
    }
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.setContent(html, { waitUntil: 'load' });
      for (const c of await page.evaluate((cs) => cs.filter((c) => matchMedia(c).matches), conditions)) {
        matched[c] = (matched[c] || []).concat(vp.w + 'x' + vp.h);
      }
      await page.evaluate(OPEN_PANEL);
      for (const r of await page.evaluate(MEASURE)) {
        measured++;
        for (const by of Object.keys(r.hits)) {
          bad.push(vp.w + 'x' + vp.h + ': #' + r.id + ' is painted over by #' + by + ' at ' +
            r.hits[by] + ' of ' + r.of + ' sampled points');
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
  /* ⚠️ VIEWPORT-SHAPED CONDITIONS ONLY, partitioned by what the condition MENTIONS rather than by
     a list I typed: prefers-reduced-motion cannot be satisfied by resizing a window, and pretending
     otherwise would make this check either red for ever or quietly exempt whatever it could not
     match. This is the second of the three hand-written-population defects, by name: five landscape
     viewports that could never match the narrow media query. */
  const sizeShaped = conditions.filter((c) => /width|height|orientation|aspect-ratio/.test(c));
  const unmatched = sizeShaped.filter((c) => !matched[c]);
  assert.deepEqual(unmatched, [],
    'A RESPONSIVE BRANCH OF THE SHIPPED STYLESHEET IS NEVER RENDERED BY THIS SUITE: ' +
    unmatched.join(' | ') + '. That is exactly how the narrow-screen bottom-sheet layout shipped ' +
    'with an opaque card on the patient\'s words through two "fix the overlapping text" rounds — ' +
    'the rule was pinned as a STRING and no viewport in the list could make it match. Matched: ' +
    JSON.stringify(matched));
  assert.ok(measured >= VIEWPORTS.length * 2,
    'only ' + measured + ' text box(es) were measured across ' + VIEWPORTS.length + ' viewports, ' +
    'so most of the sweep found nothing to look at');
  assert.deepEqual(bad, [],
    'THE PROPOSED-ACTIONS PANEL IS PAINTED OVER THE PATIENT-FACING TEXT IN ' + bad.length +
    ' PLACE(S). This is the owner\'s "text constantly overlapping", measured by rendering the ' +
    'SHIPPED stylesheet and the SHIPPED markup and asking the browser what is painted at the ' +
    'words\' own coordinates:\n  ' + bad.join('\n  '));

  console.log('PASS the kiosk panel never covers the text: the occluder is DERIVED from the ' +
    'stylesheet (every absolutely positioned, opaque, z-indexed non-modal element) rather than ' +
    'remembered, and it is the one measured; ' + measured + ' text boxes sampled at up to 25 ' +
    'elementFromPoint coordinates each across ' + VIEWPORTS.length + ' viewports that between them ' +
    'match every viewport-shaped media condition the stylesheet declares — 0 covered. The panel\'s ' +
    'area is RESERVED by the text column from ONE custom property with ONE writer, and the ' +
    'narrow-screen sheet height and its reservation are derived from the stylesheet and asserted ' +
    'equal. THE DETECTOR IS PROVEN, NOT ASSUMED: a known opaque occluder over the transcript is ' +
    'caught at every sampled point first.\n' +
    '     SCOPE, STATED: one occluder against three text nodes. The whole-overlay sweep (spills, ' +
    'clips, sliced lines, the face yielding) is NOT landed here and is open work — see the header.');
})().catch((e) => { console.error(e && e.message || e); process.exit(1); });
