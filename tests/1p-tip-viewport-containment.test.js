'use strict';

/*
 * DEFECT (owner screenshot, 2026-08-19): the app-wide hover explainer #mlsTip
 * — a dark-green pill under body.mls-redesign (feat_mls_redesign.js:319) —
 * rendered half BELOW the viewport bottom, clipped mid-sentence while showing
 * the pull button's explanation ("Reads whoever is open in your signed-in
 * athenaOne tab…"). "stuff liike this looiks so uinprofetional fix it."
 *
 * Two holes made that possible, and each is closed at its own layer:
 *
 *   1. initTooltips' place() clamped X to the viewport but NEVER clamped Y.
 *      find() walks up to 6 parents for a data-tip, so a hover anywhere inside
 *      a TALL data-tip-carrying container anchors the tip to the whole
 *      container; with no room above, the flip to r.bottom+8 lands near the
 *      page bottom and the tall bubble spills off-screen.
 *   2. pullverb-1.0.0's tipAvoid clamps its four alternative candidates but
 *      candidate 0 — "whatever place() chose" — passed through UNCLAMPED, and
 *      it wins whenever no form control collides… which is exactly the state
 *      at the bottom of the page, where there is nothing below to collide with.
 *
 * This suite extracts the REAL place() and the REAL tipAvoid closure from all
 * three shells (both twins + the derived clone) and executes them, then runs
 * the fix-removed source as a causal control so a green result cannot come
 * from a test that would pass either way.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), path.join('cloned', 'index.html')];

const VW = 1280, VH = 800;

function extract(src, startMark, endMark, what, shell) {
  const a = src.indexOf(startMark);
  assert(a >= 0, `${shell}: ${what} start anchor missing`);
  const b = src.indexOf(endMark, a);
  assert(b > a, `${shell}: ${what} end anchor missing`);
  return src.slice(a, b);
}

/* Run the real place() against one anchor rect and return where the tip went. */
function runPlace(placeSrc, opts) {
  const tip = { offsetWidth: opts.tw, offsetHeight: opts.th, style: {} };
  const ctx = {
    Math, String, Number,
    window: { innerWidth: VW, innerHeight: VH, __mlsTipAvoid: opts.tipAvoid },
    __tip: tip,
    __el: { getBoundingClientRect: () => opts.rect }
  };
  vm.createContext(ctx);
  vm.runInContext('var tip=__tip;\n' + placeSrc + '\nplace(__el);', ctx, { filename: 'place.js', timeout: 2000 });
  return { x: parseInt(tip.style.left, 10), y: parseInt(tip.style.top, 10) };
}

/* Build the real tipAvoid (formRects/areaOver/clampX/clampY + tipAvoid) from
   the pullverb block, with a fake document holding the given form controls. */
function buildTipAvoid(avoidSrc, controls) {
  const ctx = {
    Math, String, Number,
    window: { innerWidth: VW, innerHeight: VH },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    document: {
      querySelectorAll: () => controls.map((r) => ({ getBoundingClientRect: () => r }))
    }
  };
  vm.createContext(ctx);
  vm.runInContext(
    'var off=false;\nfunction safe(fn,d){try{return fn();}catch(e){return d;}}\n' + avoidSrc +
    '\nthis.__tipAvoid = tipAvoid;',
    ctx, { filename: 'tipAvoid.js', timeout: 2000 });
  return ctx.__tipAvoid;
}

SHELLS.forEach((shell) => {
  const src = fs.readFileSync(path.join(root, shell), 'utf8');

  const placeSrc = extract(src, 'function place(el){', '\n  var hoverTimer=', 'place()', shell);
  assert(/y=Math\.max\(6,Math\.min\(y,window\.innerHeight-th-6\)\)/.test(placeSrc),
    `${shell}: place() lost its Y viewport clamp — an anchor near the bottom will clip the bubble off-screen again`);

  const avoidSrc = extract(src, '  function formRects() {',
    '/* --------------------------------------------------------------- INSTALL */', 'tipAvoid closure', shell);
  assert(avoidSrc.includes('{ x: clampX(x, tw), y: clampY(y, th) }'),
    `${shell}: tipAvoid candidate 0 is no longer clamped — place()'s raw pick can be returned off-screen`);

  const TALL_TIP = { tw: 300, th: 120 };

  /* --- The owner's screenshot case: tall data-tip container near the page
     bottom, no room above, so place() flips below. Old code: y = 748, bottom
     868 — 68px below an 800px viewport. The bubble must now sit fully inside. */
  {
    const rect = { top: 40, bottom: 740, left: 200, right: 500, width: 300, height: 700 };
    const p = runPlace(placeSrc, { ...TALL_TIP, rect, tipAvoid: undefined });
    assert(p.y + TALL_TIP.th <= VH, `${shell}: flipped bubble still clips the viewport bottom (top ${p.y}, bottom ${p.y + TALL_TIP.th}, viewport ${VH})`);
    assert(p.y >= 0 && p.x >= 0 && p.x + TALL_TIP.tw <= VW, `${shell}: bubble left the viewport (${p.x},${p.y})`);
  }

  /* --- Preserved behavior: with room above, placement above the anchor is
     byte-for-byte what it was — the clamp must not move a bubble that fits. */
  {
    const rect = { top: 400, bottom: 440, left: 490, right: 790, width: 300, height: 40 };
    const p = runPlace(placeSrc, { ...TALL_TIP, rect, tipAvoid: undefined });
    assert.strictEqual(p.y, 400 - 120 - 8, `${shell}: an in-viewport above-placement moved — the clamp is over-reaching`);
    assert.strictEqual(p.x, Math.round(490 + 150 - 150), `${shell}: x centring changed`);
  }

  /* --- tipAvoid candidate 0, called DIRECTLY with an off-screen pick and one
     visible form control present (formRects must be non-empty or the function
     early-returns the raw values). Old code returned (500, 3000) untouched. */
  {
    const tipAvoid = buildTipAvoid(avoidSrc, [{ left: 8, top: 8, right: 208, bottom: 38, width: 200, height: 30 }]);
    const anchor = { top: 40, bottom: 740, left: 200, right: 500, width: 300, height: 700 };
    const q = tipAvoid(500, 3000, 300, 120, anchor);
    assert(q.y + 120 <= VH, `${shell}: tipAvoid returned an off-screen position (y ${q.y}) — candidate 0 is not clamped in the executed code`);
    assert(q.x + 300 <= VW && q.x >= 0 && q.y >= 0, `${shell}: tipAvoid result outside the viewport (${q.x},${q.y})`);
  }

  /* --- CAUSAL CONTROL: strip the Y clamp back out of the extracted source and
     prove the owner's case then DOES clip — so this suite measurably detects
     the defect rather than passing on any input. */
  {
    const broken = placeSrc.replace(/\n\s*\/\* x was clamped[^]*?\*\/\n\s*y=Math\.max\(6,Math\.min\(y,window\.innerHeight-th-6\)\);/, '');
    assert(broken !== placeSrc && !/innerHeight-th-6/.test(broken), `${shell}: control surgery failed — could not remove the clamp`);
    const rect = { top: 40, bottom: 740, left: 200, right: 500, width: 300, height: 700 };
    const p = runPlace(broken, { ...TALL_TIP, rect, tipAvoid: undefined });
    assert(p.y + TALL_TIP.th > VH,
      `${shell}: CONTROL BROKEN — with the clamp removed the bubble did not clip (top ${p.y}); this suite cannot detect the defect it claims to guard`);
  }

  console.log(`PASS ${shell}: bubble stays inside the viewport (flip case, direct tipAvoid case), in-viewport placement untouched, control clips without the fix`);
});

console.log('PASS 1p-tip-viewport-containment: the hover explainer can no longer render off the bottom of the screen in any shell');
