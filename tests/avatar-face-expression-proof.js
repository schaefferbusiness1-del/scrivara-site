'use strict';
/*
 * THE FACE ACTS - MECHANISM PROOF (drives real Chrome; needs playwright).
 * -----------------------------------------------------------------------------
 * Owner, 2026-08-07: "make the facial expresions better and really give the
 * avitar more features".
 *
 * Two claims are easy to make and impossible to trust by reading:
 *   (1) "the expressions are better"  - a face can hold five mood NAMES and
 *       render the same picture five times. So every mood here is measured on
 *       the parts that carry it (brows, lids, mouth path, head tilt, gaze) and
 *       every pair of moods must DIFFER on at least one of them.
 *   (2) "the new features work"       - an option that renders nothing, or
 *       renders the same thing for every value, would still "pass" a presence
 *       check. So each option is asserted BOTH ways: present when on, ABSENT
 *       when off, and materially different between values.
 *
 * The controls that matter most here are the negative ones:
 *   - CONTROL A: the default look must NOT contain the new accessories. Without
 *     it, "cap renders" passes on a face that always draws a cap.
 *   - CONTROL B: an unknown value for a whitelisted field must fall back to the
 *     default, and must NOT reach any attribute. Without it the whitelist is
 *     decorative.
 *   - CONTROL C: with prefers-reduced-motion, the breathing geometry must not
 *     move AT ALL over a window in which it demonstrably moves otherwise. A
 *     "reduced motion is honoured" claim measured only under reduced motion
 *     proves nothing - so the same measurement runs in both modes.
 *   - CONTROL D: two faces on one page must be independent. Driving face A must
 *     leave face B untouched - that is the whole point of class-scoped SVG.
 *
 * NOT registered in run-all: it launches real Chrome. Run manually with
 * NODE_PATH pointed at a playwright install:
 *   NODE_PATH=<scratch>/node_modules node tests/avatar-face-expression-proof.js
 * It also writes tests/face-gallery.png so a human can judge the drawing.
 */
/* av-5.7.0 — THE STAFF CONSENT TAP. The kiosk now asks "Did the patient
   consent to being recorded?" before it opens a microphone, posts a turn or
   goes fullscreen, so every scenario below answers it exactly as a member of
   staff does. If that button ever disappears these harnesses stop dead at the
   first turn, which is the correct failure: no consent, no interview. */
const { chromium } = require('playwright');
const path = require('path');
const ROOT = 'C:/Users/Micha/Desktop/MLS_EVERYTHING/dispatch-work/wt-copilot-power-20260805';
const SRC = process.env.AVATAR_SRC_OVERRIDE || path.join(ROOT, 'feat_mls_avatar.js');
/* a falsification run must never overwrite the artifact a human is judging */
const GALLERY = process.env.AVATAR_SRC_OVERRIDE
  ? path.join(path.dirname(process.env.AVATAR_SRC_OVERRIDE), 'face-gallery-FALSIFICATION.png')
  : path.join(ROOT, 'tests', 'face-gallery.png');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  PASS  ' + label); }
  else { fail++; console.log('  FAIL  ' + label + (detail === undefined ? '' : '   << ' + JSON.stringify(detail))); }
}
function head(t) { console.log('\n=== ' + t + ' ==='); }

async function boot(browser, opts) {
  const page = await browser.newPage(Object.assign({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 }, opts || {}));
  const errs = [];
  page.on('pageerror', e => errs.push(String(e && e.message)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, r => r.abort());
  await page.setContent('<body style="margin:0;background:#EDEAE3"><div id="visitView"></div><div id="stage"></div></body>');
  await page.evaluate(() => {
    window.toast = () => {}; window.getPatients = () => []; window.getActivePtId = () => '';
    window.bkToken = () => ''; window.requestIdleCallback = window.requestIdleCallback || (f => setTimeout(f, 0));
    /* NULL-SAFE readers. Against an older build most of these nodes do not
       exist; a proof that throws on the first missing node reports nothing,
       which is exactly what a falsification run needs it not to do. */
    window.__at = function (box, sel, a) { const n = box.querySelector(sel); return n ? n.getAttribute(a) : null; };
    window.__tf = function (box, sel) { const n = box.querySelector(sel); return n ? (n.style.transform || '') : null; };
    window.__op = function (box, sel) { const n = box.querySelector(sel); return n ? n.style.opacity : null; };
    window.__has = function (box, sel) { return !!box.querySelector(sel); };
    window.__call = function (ctl, m) {
      try { if (ctl && typeof ctl[m] === 'function') { ctl[m](); return true; } } catch (e) { /* reported as false */ }
      return false;
    };
    window.__mk = function (look, w) {
      const box = document.createElement('div');
      box.style.cssText = 'width:' + (w || 220) + 'px;height:' + (w || 220) + 'px';
      document.getElementById('stage').appendChild(box);
      return { box: box, ctl: window.__mlsAvatar.faceDemo(box, look) };
    };
    /* read every part that carries an expression, as ONE record */
    window.__read = function (h) {
      const s = h.box.querySelector('svg'); if (!s) return null;
      const g = c => s.querySelector('.' + c);
      const st = n => (n && n.style && n.style.transform) || '';
      return {
        mood: s.getAttribute('data-mood'),
        browL: st(g('fBrowL')), browR: st(g('fBrowR')),
        lidL: st(g('fLidL')), lidR: st(g('fLidR')),
        lowL: st(g('fLowL')),
        mouth: g('fMouth') ? g('fMouth').getAttribute('d') : '',
        lipUp: g('fLipUp') ? g('fLipUp').getAttribute('d') : '',
        headT: st(g('fHead')), rigT: st(g('fHeadRig')), bodyT: st(g('fBody')),
        pupil: st(g('fPupilL')),
        knit: g('fKnit') ? g('fKnit').style.opacity : null,
        blush: s.querySelector('.fBlush') ? s.querySelector('.fBlush').style.opacity : null,
        dimple: g('fDimpleL') ? g('fDimpleL').style.opacity : null,
        shirtRy: g('fShirt') ? g('fShirt').getAttribute('ry') : null,
        shirtCy: g('fShirt') ? g('fShirt').getAttribute('cy') : null
      };
    };
    window.__pupilXY = function (h) {
      const p = h.box.querySelector('.fPupilL');
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec((p && p.style.transform) || '');
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : [0, 0];
    };
  });
  await page.addScriptTag({ path: SRC });
  await page.waitForTimeout(200);
  return { page, errs };
}

(async () => {
  console.log('AVATAR FACE - EXPRESSION + FEATURE PROOF (real Chrome)');
  console.log('source under test: ' + SRC);
  const browser = await chromium.launch({ channel: 'chrome' });

  /* ================================================================= 1 */
  head('1. the new fields exist, are whitelisted, and default OFF');
  {
    const { page, errs } = await boot(browser);
    const hooked = await page.evaluate(() => !!(window.__mlsAvatar && window.__mlsAvatar.faceDemo));
    ok(hooked, 'faceDemo diagnostic hook is available');
    if (!hooked) { console.log('NO HOOK - cannot proceed'); await browser.close(); process.exit(2); }

    const r = await page.evaluate(() => {
      const base = window.__mk({});
      const svg = base.box.innerHTML;
      const all = window.__mk({ cap: true, stethoscope: true, glasses: true }).box.innerHTML;
      /* CONTROL B: garbage in every whitelisted field */
      const junk = window.__mk({
        brows: '"><script>x</script>', nose: 'javascript:alert(1)', lips: { evil: 1 },
        cap: 'true', stethoscope: 1, glasses: 'yes', hairStyle: 'mohawk', beard: 'goatee',
        skin: 'red', lip: '#fff'
      });
      return {
        defOff: {
          cap: svg.indexOf('fCap') >= 0, steth: svg.indexOf('fSteth') >= 0, glasses: svg.indexOf('fGlasses') >= 0
        },
        onNow: {
          cap: all.indexOf('fCapDome') >= 0, steth: all.indexOf('fSthBell') >= 0, glasses: all.indexOf('fGlasses') >= 0
        },
        junkHtml: junk.box.innerHTML,
        junkNose: window.__at(junk.box, '.fNose', 'd'),
        junkBrowW: window.__at(junk.box, '.fBrowL path', 'stroke-width'),
        junkLipScale: window.__tf(junk.box, '.fLips'),
        junkHasCap: junk.box.innerHTML.indexOf('fCap') >= 0,
        junkHasSteth: junk.box.innerHTML.indexOf('fSteth') >= 0,
        /* the skin colour moved INTO a gradient at av-6.0.0, so reading `fill` off the
           face now returns "url(#mlsAvSkinf3)" and the fallback claim became unmeasurable.
           Follow the reference and read the ramp's middle stop, which IS look.skin —
           that keeps the claim (a junk colour falls back to the default hex) intact
           instead of quietly retiring it. */
        junkSkin: (function () {
          const f = junk.box.querySelector('.fFace');
          const m = /url\(#([^)]+)\)/.exec((f && f.getAttribute('fill')) || '');
          if (!m) return (f && f.getAttribute('fill')) || null;
          const g = junk.box.querySelector('[id="' + m[1] + '"]');
          const stops = g ? g.querySelectorAll('stop') : [];
          return stops.length ? stops[Math.floor(stops.length / 2)].getAttribute('stop-color') : null;
        })(),
        refNose: window.__at(window.__mk({ nose: 'straight' }).box, '.fNose', 'd')
      };
    });
    ok(!r.defOff.cap && !r.defOff.steth && !r.defOff.glasses,
      'CONTROL A: the DEFAULT look draws no cap, no stethoscope, no glasses', r.defOff);
    ok(r.onNow.cap && r.onNow.steth && r.onNow.glasses,
      'each accessory renders when its flag is true', r.onNow);
    ok(r.junkNose === r.refNose, 'CONTROL B: an unknown nose falls back to the default geometry');
    ok(r.junkBrowW === '5', 'CONTROL B: an unknown brow weight falls back to normal (5)', r.junkBrowW);
    ok(/scaleY\(1\)/.test(r.junkLipScale) || r.junkLipScale === 'scaleY(1)',
      'CONTROL B: a non-string lips value falls back to normal scale', r.junkLipScale);
    ok(r.junkHasCap === false && r.junkHasSteth === false,
      'CONTROL B: the string "true" and the number 1 do NOT switch an accessory on', { cap: r.junkHasCap, steth: r.junkHasSteth });
    ok(r.junkSkin === '#f0c8a0', 'CONTROL B: a named colour falls back to the default hex', r.junkSkin);
    ok(!/script|javascript:|alert\(/i.test(r.junkHtml),
      'CONTROL B: none of the hostile values reached the rendered markup');
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 2 */
  head('2. every new option CHANGES the drawing (not just adds a node)');
  {
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(() => {
      const nose = {}, brow = {}, lip = {};
      ['button', 'straight', 'wide', 'roman'].forEach(v => {
        nose[v] = window.__at(window.__mk({ nose: v }).box, '.fNose', 'd');
      });
      ['thin', 'normal', 'thick'].forEach(v => {
        brow[v] = window.__at(window.__mk({ brows: v }).box, '.fBrowL path', 'stroke-width');
      });
      ['thin', 'normal', 'full'].forEach(v => {
        const h = window.__mk({ lips: v });
        lip[v] = {
          scale: window.__tf(h.box, '.fLips'),
          liner: window.__at(h.box, '.fLipUp', 'stroke-width')
        };
      });
      /* lips must FOLLOW the lip colour: both the fill and the liner */
      const red = window.__mk({ lip: '#cc1144' }).box;
      const blue = window.__mk({ lip: '#1144cc' }).box;
      /* nostrils vary with the nose */
      const nwBox = window.__mk({ nose: 'wide' }).box;
      const nbBox = window.__mk({ nose: 'button' }).box;
      /* the cap colour is derived from the scrubs the doctor picked */
      const capA = window.__at(window.__mk({ cap: true, shirt: '#2E6A4B' }).box, '.fCapDome', 'fill');
      const capB = window.__at(window.__mk({ cap: true, shirt: '#7B2D8E' }).box, '.fCapDome', 'fill');
      return {
        nose, brow, lip,
        redFill: window.__at(red, '.fMouth', 'fill'),
        redLiner: window.__at(red, '.fLipUp', 'stroke'),
        blueFill: window.__at(blue, '.fMouth', 'fill'),
        blueLiner: window.__at(blue, '.fLipUp', 'stroke'),
        nostrilWide: parseFloat(window.__at(nwBox, '.fNostrilL', 'rx')), nostrilButton: parseFloat(window.__at(nbBox, '.fNostrilL', 'rx')),
        capA, capB
      };
    });
    const noseVals = Object.keys(r.nose).map(k => r.nose[k]);
    ok(new Set(noseVals).size === 4, 'all FOUR nose shapes are geometrically distinct', r.nose);
    ok(parseFloat(r.brow.thin) < parseFloat(r.brow.normal) && parseFloat(r.brow.normal) < parseFloat(r.brow.thick),
      'brow weight is strictly ordered thin < normal < thick', r.brow);
    /* null-safe: against an older build .fLips does not exist at all */
    const sc = v => {
      const m = (r.lip[v] && r.lip[v].scale) ? /scaleY\(([\d.]+)\)/.exec(r.lip[v].scale) : null;
      return m ? parseFloat(m[1]) : NaN;
    };
    ok(sc('thin') < sc('normal') && sc('normal') < sc('full'),
      'lip volume is strictly ordered thin < normal < full', { thin: sc('thin'), normal: sc('normal'), full: sc('full') });
    ok(parseFloat(r.lip.thin.liner) < parseFloat(r.lip.full.liner),
      'the lip line thickens with fuller lips', { thin: r.lip.thin.liner, full: r.lip.full.liner });
    ok(r.redFill === '#cc1144' && r.blueFill === '#1144cc' && r.redLiner !== r.blueLiner
      && r.redLiner !== r.redFill && r.blueLiner !== r.blueFill,
      'the lips AND their darker lip line both follow look.lip', r);
    ok(r.nostrilWide > r.nostrilButton, 'nostrils widen with a wide nose',
      { wide: r.nostrilWide, button: r.nostrilButton });
    ok(r.capA !== r.capB && /^#[0-9a-f]{6}$/i.test(r.capA) && /^#[0-9a-f]{6}$/i.test(r.capB),
      'the surgical cap colour is DERIVED from the chosen scrubs', { capA: r.capA, capB: r.capB });
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 3 */
  head('3. NO ids inside the SVG, and two faces on one page are independent');
  {
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const a = window.__mk({ cap: true, stethoscope: true, glasses: true, beard: 'beard', hairStyle: 'long' });
      const b = window.__mk({ nose: 'wide', lips: 'full', brows: 'thick' });
      /* av-6.0.0 — THIS USED TO BE `ids === 0`. The face now NEEDS ids: the skin ramp,
         the hair ramp, the two iris gradients and the eye apertures are gradients and
         clipPaths, and those can only be referenced by id. So "zero ids" stopped being
         the invariant and became a rule the drawing had to break. The invariant it was
         standing in for is the one measured here, and it is strictly stronger:
           (1) no id is shared between two faces in one document, and
           (2) every url(#…) inside a face resolves to a node INSIDE THAT FACE.
         Both are what actually breaks when ids collide — the second face silently
         paints with the first face's skin ramp and iris. `idsA.length > 0` is asserted
         too, so a build that renders no gradients at all cannot pass this vacuously. */
      const idsOf = box => Array.from(box.querySelectorAll('[id]')).map(n => n.id);
      const idsA = idsOf(a.box), idsB = idsOf(b.box);
      const refsOut = box => {
        const bad = [];
        Array.prototype.forEach.call(box.querySelectorAll('*'), n => {
          ['fill', 'stroke', 'clip-path', 'filter', 'mask'].forEach(att => {
            const m = /url\(#([^)]+)\)/.exec(n.getAttribute(att) || '');
            /* getElementById would find the OTHER face's node and call it resolved -
               the exact cross-wiring this is here to catch. Scope the lookup to the box. */
            if (m && !box.querySelector('[id="' + m[1] + '"]')) bad.push(att + '=' + m[1]);
          });
        });
        return bad;
      };
      const dupShared = idsA.filter(x => idsB.indexOf(x) >= 0);
      const dupInside = (idsA.length !== new Set(idsA).size) || (idsB.length !== new Set(idsB).size);
      const dangling = refsOut(a.box).concat(refsOut(b.box));
      /* face B blinks and breathes on its OWN timers, so those channels move
         whatever A does. The question here is only whether DRIVING A can reach
         B, so compare the channels a drive would move: mood, brows, mouth, head
         tilt, crease, cheeks, dimples. */
      const driven = r0 => ({ mood: r0.mood, browL: r0.browL, browR: r0.browR, mouth: r0.mouth,
        headT: r0.headT, knit: r0.knit, blush: r0.blush, dimple: r0.dimple });
      const before = driven(window.__read(b));
      a.ctl.mood('speaking', true, false);          // drive A hard
      window.__call(a.ctl, 'shake'); window.__call(a.ctl, 'curious'); window.__call(a.ctl, 'nod');
      await new Promise(r2 => setTimeout(r2, 260));
      const afterA = window.__read(a);
      const afterB = driven(window.__read(b));
      return { nIdsA: idsA.length, nIdsB: idsB.length, dupShared, dupInside, dangling,
        before, afterA, afterB, aParts: a.box.querySelectorAll('[class^="f"]').length,
        aMoved: JSON.stringify(driven(afterA)) !== JSON.stringify(before) };
    });
    ok(r.nIdsA > 0 && r.nIdsB > 0 && r.dupShared.length === 0 && !r.dupInside,
      'two faces on one page share NO svg id (per-face ramps and clips, not zero ids)',
      { a: r.nIdsA, b: r.nIdsB, shared: r.dupShared.slice(0, 4), dupInside: r.dupInside });
    ok(r.dangling.length === 0,
      'and every url(#...) reference resolves INSIDE its own face (no cross-wiring)', r.dangling.slice(0, 4));
    ok(r.aParts > 20, 'face A is built from many class-scoped parts', r.aParts);
    ok(r.afterA.mood.indexOf('caring') >= 0, 'face A took the caring mood');
    ok(r.aMoved, '(and the drive really did move A on those same channels - so the comparison below has teeth)');
    ok(JSON.stringify(r.before) === JSON.stringify(r.afterB),
      'CONTROL D: driving face A changed NOTHING on face B', { before: r.before, after: r.afterB });
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 4 */
  head('4. every mood READS differently - measured on the parts that carry it');
  {
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const h = window.__mk({ stethoscope: true });
      const shots = {};
      const moods = [['idle', 'idle', false, false], ['happy', 'speaking', false, true],
        ['listening', 'listening', false, false], ['thinking', 'thinking', false, false],
        ['caring', 'speaking', true, false]];
      for (const [name, st, c, hp] of moods) {
        h.ctl.mood(st, c, hp);
        await new Promise(r2 => setTimeout(r2, 60));
        const rec = window.__read(h);
        delete rec.rigT; delete rec.bodyT; delete rec.shirtRy; delete rec.shirtCy; // breathing is time-varying
        shots[name] = rec;
      }
      return shots;
    });
    const names = Object.keys(r);
    let allDistinct = true, same = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      if (JSON.stringify(r[names[i]]) === JSON.stringify(r[names[j]])) { allDistinct = false; same.push(names[i] + '=' + names[j]); }
    }
    ok(allDistinct, 'all 5 moods produce DIFFERENT face records (10 pairs compared)', same);
    /* and now the specific acting claims, one at a time */
    ok(r.happy.mouth !== r.idle.mouth && r.caring.mouth !== r.idle.mouth
      && r.listening.mouth !== r.idle.mouth && r.thinking.mouth !== r.idle.mouth,
      'each mood carries its OWN mouth shape (thinking included - it used to reuse the resting smile)',
      { idle: r.idle.mouth, thinking: r.thinking.mouth });
    ok(r.happy.lowL !== r.idle.lowL, 'smiling eyes: the lower lid climbs on a genuine smile',
      { idle: r.idle.lowL, happy: r.happy.lowL });
    ok(r.thinking.lidL !== r.thinking.lidR, 'thinking half-closes ONE eye (asymmetric lids)',
      { L: r.thinking.lidL, R: r.thinking.lidR });
    ok(r.thinking.browL !== r.thinking.browR && r.thinking.browL !== '' && r.thinking.browR !== '',
      'ASYMMETRIC BROW RAISE on thinking - curiosity, not surprise', { L: r.thinking.browL, R: r.thinking.browR });
    ok(/rotate\(-9deg\)/.test(r.caring.browL) && /rotate\(9deg\)/.test(r.caring.browR),
      'concern KNITS the brows: inner ends up and together (the old code rotated them the anger way)',
      { L: r.caring.browL, R: r.caring.browR });
    ok(parseFloat(r.caring.knit) > 0 && parseFloat(r.idle.knit) === 0 && parseFloat(r.happy.knit) === 0,
      'the glabellar crease appears ONLY on concern', { caring: r.caring.knit, idle: r.idle.knit, happy: r.happy.knit });
    ok(r.happy.dimple === '1' && r.idle.dimple === '0', 'dimples belong to the real smile only');
    ok(r.listening.headT !== r.thinking.headT && r.thinking.headT !== r.idle.headT,
      'the head tilt differs per mood', { l: r.listening.headT, t: r.thinking.headT, i: r.idle.headT });
    ok(r.happy.blush !== r.caring.blush, 'the cheeks warm on joy and drain on concern',
      { happy: r.happy.blush, caring: r.caring.blush });

    /* REGRESSION, found by this proof on the first run: entering "thinking"
       fires a 1000ms curious brow. A mood change INSIDE that window used to
       leave the curious override in place, so the concern knit - the single
       most important expression on a patient-facing face - simply never
       rendered. Two directions are checked, plus the scheduled variant. */
    const g = await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      const h = window.__mk({});
      h.ctl.mood('thinking', false, false);      // fires curious()
      await wait(80);                            // still well inside its 1000ms
      const midCurious = window.__tf(h.box, '.fBrowR');
      h.ctl.mood('speaking', true, false);       // concern, immediately
      const caringL = window.__tf(h.box, '.fBrowL');
      const caringR = window.__tf(h.box, '.fBrowR');
      await wait(1100);                          // past the old gesture's expiry
      const afterExpiry = window.__tf(h.box, '.fBrowL');
      /* and the reverse: a scheduled listening gesture must not land on a mood
         that has already moved on */
      h.ctl.mood('listening', false, false);
      h.ctl.mood('speaking', true, false);
      await wait(1300);
      const stillCaring = window.__tf(h.box, '.fBrowL');
      /* an abandoned shake must not leave the head crooked */
      h.ctl.mood('idle', false, false);
      h.ctl.mood('speaking', true, false);       // fires shake()
      await wait(60);
      h.ctl.mood('listening', false, false);     // abandon it mid-flight
      await wait(400);
      const rigAfter = window.__tf(h.box, '.fHeadRig');
      return { midCurious, caringL, caringR, afterExpiry, stillCaring, rigAfter };
    });
    ok(/-6.5px/.test(g.midCurious), '(the curious brow really was in flight when the mood changed)', g.midCurious);
    ok(/rotate\(-9deg\)/.test(g.caringL) && /rotate\(9deg\)/.test(g.caringR),
      'REGRESSION: a mood change RETIRES the gesture in flight - the concern knit renders',
      { L: g.caringL, R: g.caringR });
    ok(/rotate\(-9deg\)/.test(g.afterExpiry),
      'and the retired gesture cannot clear the new expression when its timer finally fires', g.afterExpiry);
    ok(/rotate\(-9deg\)/.test(g.stillCaring),
      'a SCHEDULED gesture from a mood already left never lands', g.stillCaring);
    ok(/rotate\(0(\.0+)?deg\)/.test(g.rigAfter) || g.rigAfter === '',
      'an abandoned concern shake resets - the head is never left crooked', g.rigAfter);

    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 5 */
  head('5. GAZE: settles on the viewer when speaking, drifts when thinking');
  {
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const h = window.__mk({});
      function sample(st, n) {
        const xs = [];
        for (let i = 0; i < n; i++) { h.ctl.mood(st === 'idle2' ? 'idle' : st, false, false); h.ctl.mood(st, false, false); xs.push(window.__pupilXY(h)); }
        return xs;
      }
      /* re-entering the same mood is a no-op for gestures but re-points the
         gaze, so sampling it many times measures the DISTRIBUTION per mood */
      const spk = [], thk = [], lis = [], idl = [];
      for (let i = 0; i < 40; i++) { h.ctl.mood('idle', false, false); h.ctl.mood('speaking', false, false); spk.push(window.__pupilXY(h)); }
      for (let i = 0; i < 40; i++) { h.ctl.mood('idle', false, false); h.ctl.mood('thinking', false, false); thk.push(window.__pupilXY(h)); }
      for (let i = 0; i < 10; i++) { h.ctl.mood('idle', false, false); h.ctl.mood('listening', false, false); lis.push(window.__pupilXY(h)); }
      for (let i = 0; i < 40; i++) { h.ctl.mood('speaking', false, false); h.ctl.mood('idle', false, false); idl.push(window.__pupilXY(h)); }
      void sample;
      const mag = a => a.map(p => Math.abs(p[0]));
      const max = a => Math.max.apply(null, mag(a));
      return {
        speakMax: max(spk), thinkMin: Math.min.apply(null, mag(thk)), thinkMax: max(thk),
        listenMax: max(lis), idleMax: max(idl),
        thinkBothSides: thk.some(p => p[0] < -1) && thk.some(p => p[0] > 1),
        thinkUp: thk.every(p => p[1] < 0)
      };
    });
    ok(r.listenMax === 0, 'LISTENING holds full eye contact (pupils dead centre)', r.listenMax);
    ok(r.speakMax < 0.5, 'SPEAKING settles on the viewer - only a micro-saccade', r.speakMax);
    ok(r.thinkMin > 2.5, 'THINKING drifts away every time, never at centre', r.thinkMin);
    ok(r.thinkUp, 'THINKING drifts UP (the recall gaze), never down', r.thinkUp);
    ok(r.thinkBothSides, 'the thinking drift goes either way, not a fixed stare', r.thinkBothSides);
    ok(r.idleMax > r.speakMax, 'IDLE still wanders more widely than a locked speaking gaze',
      { idle: r.idleMax, speaking: r.speakMax });
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 6 */
  head('6. GESTURES actually move the rig: nod, concern shake, curious brow');
  {
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      const h = window.__mk({});
      const rig = h.box.querySelector('.fHeadRig') || document.createElement('div');
      function rigY() { const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(rig.style.transform); return m ? parseFloat(m[2]) : NaN; }
      function rigDeg() { const m = /rotate\((-?[\d.]+)deg\)/.exec(rig.style.transform); return m ? parseFloat(m[1]) : NaN; }
      function boxTop() { return rig.getBoundingClientRect().top; }

      h.ctl.mood('idle', false, false);
      await wait(120);
      const restY = rigY(), restTop = boxTop();
      window.__call(h.ctl, 'nod');
      const nodY = rigY();
      await wait(120);
      const nodTop = boxTop();
      await wait(400);
      const backY = rigY();

      window.__call(h.ctl, 'shake');
      await wait(40);
      const s1 = rigDeg();
      await wait(160);
      const s2 = rigDeg();
      await wait(500);
      const s3 = rigDeg();

      const bL0 = window.__tf(h.box, '.fBrowL');
      const bR0 = window.__tf(h.box, '.fBrowR');
      window.__call(h.ctl, 'curious');
      const bL1 = window.__tf(h.box, '.fBrowL');
      const bR1 = window.__tf(h.box, '.fBrowR');
      await wait(1200);
      const bL2 = window.__tf(h.box, '.fBrowL');

      /* the LISTENING nod must fire on its own, without anyone calling nod() */
      h.ctl.mood('listening', false, false);
      let moved = false, base = rigY();
      for (let i = 0; i < 60; i++) { await wait(100); if (Math.abs(rigY() - base) > 1.5) { moved = true; break; } }
      return { restY, nodY, backY, restTop, nodTop, s1, s2, s3, bL0, bR0, bL1, bR1, bL2, autoNod: moved,
        rigTransform: rig.style.transform };
    });
    ok(r.nodY > r.restY + 1.5, 'nod() drives the head rig DOWN', { rest: r.restY, nod: r.nodY });
    ok(r.nodTop > r.restTop, 'and it moves the rendered box (a transform that actually paints)',
      { restTop: r.restTop, nodTop: r.nodTop });
    ok(Math.abs(r.backY) < 1.2, 'the nod returns to rest', r.backY);
    ok(r.s1 < -1 && r.s2 > 0.5, 'shake() rotates one way then the other (two beats)', { s1: r.s1, s2: r.s2 });
    ok(Math.abs(r.s3) < 0.01, 'the shake settles back to zero, never leaving the head crooked', r.s3);
    ok(r.bL1 !== r.bR1, 'curious() leaves the brows ASYMMETRIC', { L: r.bL1, R: r.bR1 });
    ok(r.bL1 !== r.bL0 || r.bR1 !== r.bR0, 'curious() actually changed the brows from rest');
    ok(r.bL2 === r.bL0, 'the curious brow releases back to the mood default', { before: r.bL0, after: r.bL2 });
    ok(r.autoNod, 'the LISTENING nod fires on its own - acknowledgement without being asked');
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 7 */
  head('7. BREATHING is real geometry - and reduced-motion kills it (both measured)');
  {
    const { page, errs } = await boot(browser);
    const normal = await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      const h = window.__mk({ stethoscope: true });
      const shirt = h.box.querySelector('.fShirt');
      const body = h.box.querySelector('.fBody');
      if (!shirt || !body) return { ryMin: 0, ryMax: 0, cyMin: 0, cyMax: 0, distinctBody: 0, topSpread: 0, missing: true };
      /* THE RENDERED BOX, NOT AN ATTRIBUTE. Until av-6.0.0 this read `ry`/`cy` off
         .fShirt. The torso became a <path> and those attributes stopped rendering —
         but setAttribute still stored them and getAttribute still read them back, so
         this check reported an expanding chest for a chest that only bobbed. Height
         and top of the painted box cannot be satisfied by writing a dead attribute. */
      const hs = [], tops = [], bt = [];
      for (let i = 0; i < 26; i++) {
        const b0 = shirt.getBoundingClientRect();
        hs.push(b0.height); tops.push(b0.top);
        bt.push(body.style.transform);
        await wait(100);
      }
      /* the head must NOT be inside the group that scales, or "the chest breathes"
         is just the whole drawing pulsing - the thing the old comment warned about */
      const headInBody = !!body.querySelector('.fHead');
      const faceH = [];
      const faceEl = h.box.querySelector('.fFace');
      for (let i = 0; i < 4; i++) { faceH.push(faceEl.getBoundingClientRect().height); await wait(220); }
      return { hMin: Math.min.apply(null, hs), hMax: Math.max.apply(null, hs),
        distinctBody: new Set(bt).size, headInBody: headInBody,
        faceSpread: Math.max.apply(null, faceH) - Math.min.apply(null, faceH),
        topSpread: Math.max.apply(null, tops) - Math.min.apply(null, tops) };
    });
    ok(normal.hMax - normal.hMin > 0.8, 'the chest itself EXPANDS on screen (real geometry, not a zoom of the drawing)',
      { min: normal.hMin, max: normal.hMax });
    ok(normal.headInBody === false && normal.faceSpread < 0.35,
      'and the HEAD does not scale with it - the face keeps its size while the chest inflates',
      { headInBody: normal.headInBody, faceSpread: normal.faceSpread });
    ok(normal.topSpread > 1, 'the rendered shoulder line actually moves on screen (px)', normal.topSpread);
    ok(normal.distinctBody > 8, 'the chest group travels through many distinct positions', normal.distinctBody);
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();

    /* the SAME measurement under prefers-reduced-motion */
    const rm = await boot(browser, { reducedMotion: 'reduce' });
    const reduced = await rm.page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      const h = window.__mk({ stethoscope: true });
      const shirt = h.box.querySelector('.fShirt');
      const rig = h.box.querySelector('.fHeadRig') || document.createElement('div');
      const hs = [], tops = [];
      h.ctl.mood('listening', false, false);
      window.__call(h.ctl, 'nod'); window.__call(h.ctl, 'shake'); window.__call(h.ctl, 'curious');
      for (let i = 0; i < 26; i++) {
        const b0 = shirt.getBoundingClientRect();
        hs.push(b0.height); tops.push(b0.top);
        await wait(100);
      }
      const eye = h.box.querySelector('.fEyeL') || { style: {} };
      return {
        hMin: Math.min.apply(null, hs), hMax: Math.max.apply(null, hs),
        topSpread: Math.max.apply(null, tops) - Math.min.apply(null, tops),
        rigT: window.__tf(h.box, '.fHeadRig'),
        headT: window.__tf(h.box, '.fHead'),
        pupil: window.__tf(h.box, '.fPupilL'),
        eyeTransition: eye.style.transition,
        stillMoods: (function () { h.ctl.mood('caring', true, false); return h.box.querySelector('svg').getAttribute('data-mood'); })()
      };
    });
    /* the SAME rendered measurement as the normal arm, so the two numbers are
       comparable: normally the chest height spreads > 0.8px, here it must not move at
       all. Asserting `=== 50` on an attribute could only ever be satisfied by the one
       implementation that wrote 50 there, which is why it broke the moment the torso
       changed shape and reported null in a control whose whole job is to fail loudly. */
    ok(reduced.hMax - reduced.hMin < 0.35,
      'CONTROL C: under prefers-reduced-motion the chest geometry NEVER moves (same 2.6s window, same rendered measure)',
      { min: reduced.hMin, max: reduced.hMax, normalSpread: normal.hMax - normal.hMin });
    ok(reduced.topSpread < 0.6, 'and the shoulder line does not move on screen either', reduced.topSpread);
    ok(reduced.rigT === '', 'the gesture rig carries no transform under reduced motion', reduced.rigT);
    ok(reduced.headT === '', 'the head tilt is suppressed under reduced motion', reduced.headT);
    {
      /* the browser normalises "0.00px" to "0px", so parse rather than match */
      const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(reduced.pupil);
      ok(!!m && parseFloat(m[1]) === 0 && parseFloat(m[2]) === 0,
        'the gaze is parked centre under reduced motion', reduced.pupil);
    }
    ok(reduced.eyeTransition === 'none', 'the inline transitions are stripped, not merely the loops', reduced.eyeTransition);
    ok(reduced.stillMoods.indexOf('caring') >= 0,
      'but the EXPRESSION still changes - reduced motion removes movement, not meaning', reduced.stillMoods);
    ok(rm.errs.length === 0, 'no page errors', rm.errs.slice(0, 2));
    await rm.page.close();
  }

  /* ================================================================= 8 */
  head('8. retint keeps the mood, re-binds the new parts, and fixes .node');
  {
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      const h = window.__mk({});
      h.ctl.mood('speaking', true, false);
      await wait(700);                              // let the concern shake finish
      const beforeNode = h.ctl.node;
      const beforeMood = h.box.querySelector('svg').getAttribute('data-mood');
      h.ctl.retint({ skin: '#7a4a24', hair: '#140f0b', cap: true, stethoscope: true, nose: 'wide', brows: 'thick', lips: 'full' });
      await wait(60);
      const afterMood = h.box.querySelector('svg').getAttribute('data-mood');
      const live = h.box.querySelector('svg');
      /* the new parts must be BOUND, not merely drawn: drive a mood and see the
         freshly-rendered knit respond */
      h.ctl.mood('idle', false, false);
      const knitIdle = window.__op(h.box, '.fKnit');
      h.ctl.mood('speaking', true, false);
      const knitCaring = window.__op(h.box, '.fKnit');
      return {
        beforeMood, afterMood,
        nodeWasStale: beforeNode !== live,
        nodeFixed: h.ctl.node === live,
        hasCap: !!h.box.querySelector('.fCapDome'), hasSteth: !!h.box.querySelector('.fSthBell'),
        knitIdle, knitCaring
      };
    });
    ok(r.beforeMood.indexOf('caring') >= 0 && r.afterMood.indexOf('caring') >= 0,
      'the mood survives a full re-render', { before: r.beforeMood, after: r.afterMood });
    ok(r.hasCap && r.hasSteth, 'retint can ADD accessories a colour-only tint could not');
    ok(r.nodeWasStale, '(the retint really did swap the svg element)');
    ok(r.nodeFixed, 'ctl.node now points at the LIVE svg after a retint - it used to stay detached');
    ok(r.knitIdle === '0' && parseFloat(r.knitCaring) > 0,
      'the freshly-rendered parts are re-BOUND, not just re-drawn', { idle: r.knitIdle, caring: r.knitCaring });
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 9 */
  head('9. the Setup Appearance studio exposes every new option, and previews it');
  {
    const { page, errs } = await boot(browser);
    /* the studio builds itself from a config GET - serve one locally */
    const r = await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      window.bkToken = () => 'tok';
      window.bkBase = () => 'https://backend.test';
      window.fetch = function (url) {
        if (String(url).indexOf('/api/avatar/config') >= 0) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, config: { name: 'Ava', questions: [], faceLook: {} } }) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [] }) });
      };
      window.__mlsAvatar.open();
      await wait(60);
      const tabs = Array.prototype.slice.call(document.querySelectorAll('.mlsAvTabs button, .mlsAvPanel button'));
      const setup = tabs.filter(b => /set up/i.test(b.textContent))[0];
      if (setup) setup.click();
      await wait(300);
      const g = id => document.getElementById(id);
      const ids = ['mlsAvLook_skin', 'mlsAvLook_hair', 'mlsAvLook_eyes', 'mlsAvLook_lip', 'mlsAvLook_shirt',
        'mlsAvLook_hairStyle', 'mlsAvLook_beard', 'mlsAvLook_brows', 'mlsAvLook_nose', 'mlsAvLook_lips',
        'mlsAvLook_glasses', 'mlsAvLook_cap', 'mlsAvLook_stethoscope'];
      const present = {}; ids.forEach(i => { present[i] = !!g(i); });
      const stage = g('mlsAvLookStage');
      const before = stage ? stage.innerHTML : '';
      /* drive the real controls the way a doctor would */
      const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
      if (g('mlsAvLook_nose')) { g('mlsAvLook_nose').value = 'wide'; fire(g('mlsAvLook_nose'), 'change'); }
      if (g('mlsAvLook_brows')) { g('mlsAvLook_brows').value = 'thick'; fire(g('mlsAvLook_brows'), 'change'); }
      if (g('mlsAvLook_lips')) { g('mlsAvLook_lips').value = 'full'; fire(g('mlsAvLook_lips'), 'change'); }
      if (g('mlsAvLook_cap')) { g('mlsAvLook_cap').checked = true; fire(g('mlsAvLook_cap'), 'change'); }
      if (g('mlsAvLook_stethoscope')) { g('mlsAvLook_stethoscope').checked = true; fire(g('mlsAvLook_stethoscope'), 'change'); }
      await wait(120);
      const after = stage ? stage.innerHTML : '';
      const opts = k => g('mlsAvLook_' + k) ? Array.prototype.map.call(g('mlsAvLook_' + k).options, o => o.value) : [];
      return {
        present, changed: before !== after,
        capDrawn: after.indexOf('fCapDome') >= 0, stethDrawn: after.indexOf('fSthBell') >= 0,
        capBefore: before.indexOf('fCapDome') >= 0,
        browW: (function () { var m = /class="fBrowL"[^>]*><path d="[^"]*" stroke="[^"]*" stroke-width="([\d.]+)"/.exec(after); return m ? m[1] : null; })(),
        noseOpts: opts('nose'), browOpts: opts('brows'), lipsOpts: opts('lips'),
        previewIsFace: after.indexOf('<svg') >= 0
      };
    });
    Object.keys(r.present).forEach(id => ok(r.present[id], 'the studio exposes ' + id));
    ok(r.noseOpts.join(',') === 'button,straight,wide,roman', 'the nose picker offers every whitelisted value', r.noseOpts);
    ok(r.browOpts.join(',') === 'thin,normal,thick', 'the eyebrow picker offers every whitelisted value', r.browOpts);
    ok(r.lipsOpts.join(',') === 'thin,normal,full', 'the lips picker offers every whitelisted value', r.lipsOpts);
    ok(r.previewIsFace, 'the live preview is a real drawn face');
    ok(r.changed, 'the live preview CHANGED when the new controls were used');
    ok(!r.capBefore && r.capDrawn && r.stethDrawn, 'the preview grew a cap and a stethoscope on the checkbox click',
      { before: r.capBefore, cap: r.capDrawn, steth: r.stethDrawn });
    ok(r.browW === '7.8', 'and the preview picked up the thick brows', r.browW);
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================ 9b */
  head('9b. THE SHIPPED SURFACE: the face a patient actually meets in the kiosk');
  {
    /* everything above drives faceDemo, which is a diagnostic hook. The face a
       patient sees is mounted by openKiosk into #mlsAvKioskFace. A face engine
       that is perfect in the harness and unmounted in the kiosk would pass all
       of the above, so the real surface is measured here. */
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      window.getActivePtId = () => 'ext-9';
      window.getPatients = () => [{ id: 'ext-9', name: 'Test Patient' }];
      window.bkToken = () => 'tok'; window.bkBase = () => 'https://backend.test';
      window.fetch = function (url) {
        const u = String(url);
        const j = u.indexOf('/office/turn') >= 0
          ? { ok: true, say: 'Hello, tell me what brings you in today.', avatar: { name: 'Ava', exitPinSet: true }, done: false }
          : { ok: true, checkins: [] };
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
      };
      /* the mic preflight must not hang the test; a refusal is a supported path */
      navigator.mediaDevices = navigator.mediaDevices || {};
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error('no mic in this harness'));
      window.__mlsAvatar.openKiosk(); var __cy = document.getElementById('mlsAvKioskConsentYes'); if (__cy) __cy.click();
      await wait(400);
      const mount = document.getElementById('mlsAvKioskFace');
      const svg = mount && mount.querySelector('svg');
      if (!svg) return { mounted: false };
      const shirt = svg.querySelector('.fShirt');
      const hs = [];
      /* the SAME 2.6s window section 7 uses. The breath cycle is ~4.35s, so a
         shorter window samples an arc, not the amplitude, and the two numbers
         would not be comparable.
         MEASURED ON SCREEN, not off an attribute: this sampled shirt.getAttribute('ry')
         until av-6.0.0, and when the torso became a <path> that attribute stopped
         meaning anything — but setAttribute still stored it, so this kept reporting a
         breathing chest that had stopped moving. A rendered height cannot be faked. */
      /* THE RATIO, not the height. #mlsAvKioskFace svg carries its own CSS keyframe that
         scales the WHOLE face 1.008, so the shirt's rendered height moves even when the
         chest is frozen — measured: with the chest deliberately broken this pin still
         passed on the CSS pulse alone. Dividing by the face's height cancels any transform
         applied to the svg as a whole and leaves only the chest's own expansion. */
      const faceEl = svg.querySelector('.fFace');
      for (let i = 0; i < 26; i++) {
        const sh0 = shirt.getBoundingClientRect().height, fh0 = faceEl.getBoundingClientRect().height;
        hs.push(fh0 > 0 ? sh0 / fh0 : 0);
        await wait(100);
      }
      const root = document.getElementById('mlsAvKiosk');
      const idsK = Array.from(mount.querySelectorAll('[id]')).map(n => n.id);
      const danglingK = [];
      Array.prototype.forEach.call(mount.querySelectorAll('*'), n => {
        ['fill', 'stroke', 'clip-path', 'filter', 'mask'].forEach(att => {
          const m = /url\(#([^)]+)\)/.exec(n.getAttribute(att) || '');
          if (m && !mount.querySelector('[id="' + m[1] + '"]')) danglingK.push(att + '=' + m[1]);
        });
      });
      const out = {
        mounted: true,
        nIds: idsK.length,
        idsUnique: idsK.length === new Set(idsK).size,
        danglingK: danglingK,
        hasRig: !!svg.querySelector('.fHeadRig'), hasBody: !!svg.querySelector('.fBody'),
        hasKnit: !!svg.querySelector('.fKnit'), hasLipUp: !!svg.querySelector('.fLipUp'),
        hasNostril: !!svg.querySelector('.fNostrilL'),
        breathSpread: Math.max.apply(null, hs) - Math.min.apply(null, hs),
        dataMood: svg.getAttribute('data-mood'),
        rootClass: root ? root.className : null
      };
      window.__mlsAvatar.closeKiosk();
      await wait(120);
      out.closedClean = !document.getElementById('mlsAvKiosk');
      return out;
    });
    ok(r.mounted, 'openKiosk mounts a drawn face into #mlsAvKioskFace');
    if (r.mounted) {
      ok(r.nIds > 0 && r.idsUnique && r.danglingK.length === 0,
        'the kiosk face owns UNIQUE ids and every url(#...) resolves inside it (it coexists with the Setup preview)',
        { ids: r.nIds, unique: r.idsUnique, dangling: r.danglingK.slice(0, 4) });
      ok(r.hasRig && r.hasBody, 'the gesture rig and the breathing chest are present on the SHIPPED face',
        { rig: r.hasRig, body: r.hasBody });
      ok(r.hasKnit && r.hasLipUp && r.hasNostril, 'the new expression/feature parts are present too',
        { knit: r.hasKnit, lipUp: r.hasLipUp, nostril: r.hasNostril });
      ok(r.breathSpread > 0.004, 'and the CHEST itself breathes in the kiosk, not just in the harness (chest:face height ratio over the same 2.6s window, so the kiosk CSS pulse cannot satisfy it)', r.breathSpread);
      ok(typeof r.dataMood === 'string', 'the kiosk face carries a mood attribute', r.dataMood);
      ok(r.closedClean, 'closing the kiosk removes the overlay (and destroys the face)');
    }
    ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
    await page.close();
  }

  /* ================================================================ 10 */
  /* ================================================================ 9c */
  head('9c. THE DRAWING FITS THE ROUND HOLE IT IS SHOWN IN (av-6.0.1)');
  {
    /* ⛔ THE DEFECT THIS EXISTS FOR. Every check above, and every gallery a human judged,
       mounts the face in a SQUARE div — because that is what faceDemo takes. Both shipped
       surfaces are circles with overflow:hidden: #mlsAvKioskFace at ~302px and the
       Setup/Settings preview at 72px. A square-framed portrait therefore arrived cropped on
       the diagonal, and on the real kiosk .fShirt spanned y 250-380 inside a 302-tall box —
       the shoulders, collar and V-neck were outside the mask entirely, while the crown
       crowded the top arc. The owner's verdict on the shipped build was "does not work
       correctly or look good". Nothing here could fail, because nothing here had ever
       looked at a circle. */
    const { page, errs } = await boot(browser);
    const r = await page.evaluate(async () => {
      const wait = (m) => new Promise((r2) => setTimeout(r2, m));
      const out = {};
      for (const size of [302, 72]) {
        const box = document.createElement('div');
        box.style.cssText = 'width:' + size + 'px;height:' + size + 'px;border-radius:999px;overflow:hidden';
        document.getElementById('stage').appendChild(box);
        window.__mlsAvatar.faceDemo(box, { stethoscope: true });
        await wait(120);
        const bb = box.getBoundingClientRect();
        const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2, rad = bb.width / 2;
        /* how far the FURTHEST corner of a part is from the centre, as a fraction of the
           radius: > 1 means that corner is outside the circle and is being cropped */
        const reach = (sel) => {
          const n = box.querySelector(sel); if (!n) return null;
          const b = n.getBoundingClientRect();
          const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]];
          let m = 0;
          pts.forEach((p) => { const d = Math.hypot(p[0] - cx, p[1] - cy) / rad; if (d > m) m = d; });
          return Math.round(m * 100) / 100;
        };
        /* and how much of the garment survives the mask, in px of visible height */
        const shirt = box.querySelector('.fShirt');
        const sb = shirt ? shirt.getBoundingClientRect() : null;
        /* ⛔ THE CLIPPING NUMBERS ABOVE DO NOT DISCRIMINATE — MEASURED. With the old square
           framing restored, every reach() was still <= 1.0 (head 0.89, ears 0.66), because a
           head whose BOUNDING BOX corners sit inside r=100 is not clipped by the mask. The
           first version of this section therefore passed against the very build the owner
           rejected: 117/117 both arms. Nothing was being cropped; the COMPOSITION was wrong.
           So the discriminating half is below, and it is three fractions of the container:
             crown gap   0.236 fixed vs 0.140 broken  (how far down the hair starts)
             head height 0.554 fixed vs 0.660 broken  (2/3 of a circle is a close-up, not a portrait)
             garment     0.177 fixed vs 0.161 broken  (how much shoulder survives the mask)
           All three were read off both builds before the thresholds were chosen, and all three
           fail on the broken one. */
        const fb2 = box.querySelector('.fFace').getBoundingClientRect();
        const hv = box.querySelector('.fHair') ? box.querySelector('.fHair').getBoundingClientRect() : null;
        out[size] = {
          head: reach('.fFace'), earL: reach('.fEarL'), earR: reach('.fEarR'), hair: reach('.fHair'),
          headFrac: +(fb2.height / bb.height).toFixed(3),
          crownFrac: hv ? +((hv.y - bb.y) / bb.height).toFixed(3) : null,
          shirtVisFrac: sb ? +((Math.min(bb.bottom, sb.bottom) - Math.max(bb.y, sb.y)) / bb.height).toFixed(3) : null,
          shirtVisible: sb ? Math.round(Math.min(bb.y + bb.height, sb.y + sb.height) - Math.max(bb.y, sb.y)) : null,
          boxH: Math.round(bb.height),
        };
      }
      return out;
    });
    [302, 72].forEach((size) => {
      const m = r[size];
      ok(m.head !== null && m.head <= 1.0,
        size + 'px circle: the whole HEAD is inside the mask (furthest corner ' + m.head + ' of the radius)', m);
      ok(m.earL !== null && m.earL <= 1.0 && m.earR <= 1.0,
        size + 'px circle: BOTH ears are inside the mask, not clipped by the sides', { l: m.earL, r: m.earR });
      ok(m.hair !== null && m.hair <= 1.0,
        size + 'px circle: the hair/crown is inside the mask, not crowding the top arc', m.hair);
      /* ---- the DISCRIMINATING trio: composition, not clipping ---- */
      ok(m.crownFrac !== null && m.crownFrac >= 0.19,
        size + 'px circle: the crown starts far enough down that it does not crowd the top arc (' +
        m.crownFrac + ' of the height, needs 0.19+; the rejected build measured 0.14)', m.crownFrac);
      ok(m.headFrac <= 0.60 && m.headFrac >= 0.42,
        size + 'px circle: the head is framed as a PORTRAIT, not a close-up (' + m.headFrac +
        ' of the height, needs 0.42-0.60; the rejected build measured 0.66)', m.headFrac);
      ok(m.shirtVisFrac !== null && m.shirtVisFrac >= 0.17,
        size + 'px circle: a real shoulder line survives the mask (' + m.shirtVisFrac +
        ' of the height = ' + m.shirtVisible + 'px of ' + m.boxH + ', needs 0.17+; the rejected build measured 0.161)', m);
    });
    ok(errs.length === 0, 'no page errors', errs.slice(0, 2));
    await page.close();
  }

  /* ================================================================= 10 */
  head('10. the gallery a human judges');
  {
    const { page, errs } = await boot(browser, { viewport: { width: 1320, height: 1500 } });
    await page.evaluate(async () => {
      const wait = m => new Promise(r2 => setTimeout(r2, m));
      document.body.innerHTML = '<div id="wrap" style="padding:18px;font:13px/1.4 system-ui,sans-serif;color:#22302a"></div>';
      const wrap = document.getElementById('wrap');
      function section(title, sub) {
        const h = document.createElement('div');
        h.style.cssText = 'margin:16px 0 8px;font:700 15px system-ui;color:#204034';
        h.textContent = title;
        const s = document.createElement('div');
        s.style.cssText = 'font:12px system-ui;color:#6b756f;margin:-6px 0 8px';
        s.textContent = sub || '';
        wrap.appendChild(h); wrap.appendChild(s);
        const g = document.createElement('div');
        g.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:10px';
        wrap.appendChild(g); return g;
      }
      function tile(grid, label, look) {
        const cell = document.createElement('div');
        cell.style.cssText = 'background:#fff;border:1px solid #E7E5DD;border-radius:14px;padding:7px;text-align:center';
        const box = document.createElement('div');
        box.style.cssText = 'width:100%;aspect-ratio:1;overflow:hidden;border-radius:11px;background:radial-gradient(circle at 50% 36%,#fff,#eef1ec)';
        const cap = document.createElement('div');
        cap.style.cssText = 'font:600 11px system-ui;color:#3d4a44;margin-top:5px';
        cap.textContent = label;
        cell.appendChild(box); cell.appendChild(cap); grid.appendChild(cell);
        return window.__mlsAvatar.faceDemo(box, look);
      }
      const D = { stethoscope: true };
      const g1 = section('EXPRESSIONS - the same face, five states',
        'brows, eyelids, mouth, head tilt, cheeks, gaze and the glabellar crease all move together');
      const moods = [['Resting', 'idle', false, false], ['Greeting (happy)', 'speaking', false, true],
        ['Listening', 'listening', false, false], ['Thinking', 'thinking', false, false],
        ['When it hurts (caring)', 'speaking', true, false]];
      const ctls = [];
      moods.forEach(([n, s, c, h]) => { const k = tile(g1, n, D); k.mood(s, c, h); ctls.push(k); });
      const cur = tile(g1, 'Curious (one brow)', D); cur.mood('listening', false, false);
      const talk = null; void talk;
      const g2 = section('SPEAKING - the mouth carries the voice',
        'amplitude drives the mouth shape and the jaw; a browser-speech fallback cycles');
      [['quiet', 0.05], ['soft', 0.2], ['open', 0.45], ['wide', 0.8]].forEach(([n, lv]) => {
        const k = tile(g2, 'talk ' + n + ' (' + lv + ')', D); k.mood('speaking', false, false); k.talk(lv);
      });
      tile(g2, 'concern + speaking', D).mood('speaking', true, false);
      tile(g2, 'happy + speaking', D).mood('speaking', false, true);

      const g3 = section('FEATURES - eyebrows, nose, lips', 'each is an optional whitelisted field; the middle value is the default');
      tile(g3, 'brows: thin', { brows: 'thin' });
      tile(g3, 'brows: natural', { brows: 'normal' });
      tile(g3, 'brows: thick', { brows: 'thick' });
      tile(g3, 'nose: button', { nose: 'button' });
      tile(g3, 'nose: wide', { nose: 'wide' });
      tile(g3, 'nose: roman', { nose: 'roman' });
      tile(g3, 'lips: thin', { lips: 'thin' });
      tile(g3, 'lips: natural', { lips: 'normal' });
      tile(g3, 'lips: full', { lips: 'full' });
      tile(g3, 'lip colour #a03', { lips: 'full', lip: '#aa0033' });
      tile(g3, 'lip colour #7a4', { lips: 'normal', lip: '#7a4436' });
      tile(g3, 'lip colour #c96', { lips: 'thin', lip: '#cc9966' });

      const g4 = section('ACCESSORIES - all optional, all default OFF', 'glasses (existing), surgical cap and stethoscope; the cap colour is derived from the scrubs');
      tile(g4, 'none (default)', {});
      tile(g4, 'glasses', { glasses: true });
      tile(g4, 'surgical cap', { cap: true });
      tile(g4, 'stethoscope', { stethoscope: true });
      tile(g4, 'cap + steth', { cap: true, stethoscope: true });
      tile(g4, 'all three', { cap: true, stethoscope: true, glasses: true });

      const g5 = section('THE CHARACTER - the knobs combined', 'one face engine, plausibly different people');
      tile(g5, 'A', { skin: '#f3d3b3', hair: '#241a12', brows: 'thick', nose: 'roman', stethoscope: true });
      tile(g5, 'B', { skin: '#7a4a24', hair: '#140f0b', beard: 'beard', nose: 'wide', brows: 'thick', cap: true, shirt: '#1F5C86' });
      tile(g5, 'C', { skin: '#f0c9a0', hair: '#d9b44a', hairStyle: 'long', glasses: true, lips: 'full', lip: '#b34a63', brows: 'thin', nose: 'button' });
      tile(g5, 'D', { skin: '#e8b98c', hair: '#6b6b6b', hairStyle: 'bald', beard: 'stubble', glasses: true, stethoscope: true, shirt: '#4A4E69' });
      tile(g5, 'E', { skin: '#c98d5e', hair: '#2b2b2b', hairStyle: 'bun', lips: 'full', lip: '#93394f', stethoscope: true, shirt: '#7B4B94' });
      tile(g5, 'F', { skin: '#f5ddc4', hair: '#8a5a2b', hairStyle: 'wavy', brows: 'thin', nose: 'button', cap: true, shirt: '#B4654A' });

      await wait(700);
      /* fire the transient gestures LAST so they are caught in the shot */
      window.__call(cur, 'curious');
      window.__call(ctls[4], 'shake');
      window.__galleryReady = true;
    });
    await page.waitForTimeout(340);
    const wrap = await page.$('#wrap');
    await wrap.screenshot({ path: GALLERY });
    ok(true, 'gallery written to ' + GALLERY);
    ok(errs.length === 0, 'no page errors while drawing the gallery', errs.slice(0, 2));
    await page.close();
  }

  await browser.close();
  console.log('\n--------------------------------------------------------------');
  console.log((fail === 0 ? 'PASS' : 'FAIL') + '  ' + pass + '/' + (pass + fail) + ' checks');
  console.log('--------------------------------------------------------------');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
