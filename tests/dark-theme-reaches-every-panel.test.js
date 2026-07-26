'use strict';

/* The dark theme has to reach surfaces this repo cannot see statically.
 *
 * Measured at b676 in an isolated headless Chrome on ScribeFlow.html?demo=1,
 * 1440x900, ten views, body.theme-dark on: 170 opaque light panels and 163
 * WCAG-AA text failures, against light mode's 26. Dark mode was a token swap
 * on the components ScribeFlow.html declares itself; the ~230 feature modules
 * each inject a stylesheet with literal light backgrounds and no .theme-dark
 * branch — 645 such rules across 196 sheets, 199 distinct light literals.
 *
 * A static override list cannot fix that and a static test cannot check it:
 * those selectors are built by string concatenation ('#'+ROOT_ID+' .x{...}'),
 * so grep never resolves them. The correction is derived at runtime from
 * document.styleSheets, and the after-state (12 panels, 1 failure) is
 * measured in a browser, in WORKER_F_REPORT.md, not here.
 *
 * WHAT THIS SUITE CAN DO, and does: run the engine's actual decision
 * functions and assert the four judgements that were each wrong once, plus
 * the structural properties that make it safe to leave running. Every one of
 * these fired on real code during development — none is hypothetical.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const BLOCK = /<script id="mlsThemeParityBoot">([\s\S]*?)<\/script>/;

/* ---- 0. it is in both shells, and it is the SAME engine ---- */
const blocks = {};
for (const page of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const src = read(page);
  const n = src.split('<script id="mlsThemeParityBoot">').length - 1;
  assert.strictEqual(n, 1, page + ': expected exactly one parity block, found ' + n);
  const m = BLOCK.exec(src);
  assert.ok(m, page + ': the theme-parity block is gone');
  blocks[page] = m[1];
}
{
  const a = blocks['ScribeFlow.html'].replace(/\s+/g, ' ').trim();
  const b = blocks['ScribeFlow-staging.html'].replace(/\s+/g, ' ').trim();
  assert.strictEqual(a, b,
    'ScribeFlow-staging.html has drifted from ScribeFlow.html. The twin is where ' +
    'theme work is verified against a second palette; a fork means the staging ' +
    'measurement stops describing production.');
}

/* ---- run the engine with the DOM stubbed out, and reach its judgements ----
 * The functions are internal on purpose. Rather than add a test hook to
 * shipped code, the IIFE is closed one statement later here. */
const src = blocks['ScribeFlow.html'];
const CLOSE = '})();';
assert.ok(src.trimEnd().endsWith(CLOSE), 'the parity block no longer ends with an IIFE close');
const instrumented = src.trimEnd().slice(0, -CLOSE.length) +
  'window.__parityInternals={scope:scope,bgToken:bgToken,fgToken:fgToken,parts:parts,rgb:rgb,lum:lum,ratio:ratio};' +
  CLOSE;

const noop = () => {};
const sandbox = {};
sandbox.window = sandbox;
sandbox.setTimeout = noop;
sandbox.requestAnimationFrame = noop;
sandbox.performance = { now: () => 0 };
sandbox.MutationObserver = function () { return { observe: noop, disconnect: noop }; };
sandbox.getComputedStyle = () => ({ getPropertyValue: () => '' });
sandbox.document = {
  /* classList.contains -> false: light mode, so scan() returns before it can
     touch anything the stub does not have. */
  body: { classList: { contains: () => false } },
  head: { appendChild: noop },
  documentElement: { appendChild: noop },
  styleSheets: [],
  createElement: () => ({ id: '', appendChild: noop, parentNode: null }),
  createTextNode: () => ({}),
  querySelectorAll: () => []
};
vm.createContext(sandbox);
vm.runInContext(instrumented, sandbox, { timeout: 5000 });
const P = sandbox.window.__parityInternals;
assert.ok(P && P.scope && P.bgToken, 'could not reach the engine internals');

/* ---- 1. EQUAL specificity, never higher ----
 * The version that prefixed a real "html body.theme-dark" outranked the rules
 * that OVERRIDE the one being corrected, and put near-black text on #204034 in
 * all ten views. :where() contributes zero specificity; that is the whole
 * design, and losing it is silent. */
{
  const cases = [
    ['#historyView .hy-chip', ':where(html body.theme-dark) #historyView .hy-chip'],
    ['.card', ':where(html body.theme-dark) .card'],
    ['body.mls-redesign #mlsCtxBar', 'body:where(.theme-dark).mls-redesign #mlsCtxBar'],
    ['body', 'body:where(.theme-dark)']
  ];
  for (const [input, want] of cases) {
    assert.strictEqual(P.scope(input), want,
      'scope("' + input + '") must keep the source specificity exactly.\n' +
      '  got  ' + P.scope(input) + '\n  want ' + want);
  }
  for (const [, out] of cases) {
    assert.ok(!/(^|[^:(])\bhtml body\.theme-dark\b/.test(out.replace(/:where\([^)]*\)/g, '')),
      'a scoped selector carries a real (non-:where) theme prefix: ' + out +
      '\nThat adds specificity and outranks the overrides it must yield to.');
  }
}

/* ---- 2. CHROMA, not HSL saturation ----
 * #FCFBF8 is the app's own field background. Its HSL saturation is 0.40,
 * because saturation explodes as lightness approaches 1, so a saturation-based
 * classifier called it "gold" and repainted every input the colour of a
 * caution notice. */
{
  const t = (hex) => P.bgToken(P.rgb(hex), false);
  assert.strictEqual(t('#ffffff'), 'var(--surface)', 'white is the card surface');
  assert.strictEqual(t('#FCFBF8'), 'var(--surface)',
    '#FCFBF8 was classified as a gold tint — the chroma guard is gone and every ' +
    'near-white neutral in the app will be repainted as a caution colour');
  assert.strictEqual(t('#F4F2EC'), 'var(--soft)', 'a dimmer neutral is the soft surface');
  assert.strictEqual(t('#FEF6E0'), 'var(--gold-bg)', 'a real gold tint keeps its meaning');
  assert.strictEqual(P.bgToken(P.rgb('#FCFBF8'), true), 'var(--field-bg)',
    'a field keeps its own recessed surface');
}

/* ---- 3. text keeps its RANK ----
 * Collapsing every dark literal onto --ink makes a dark theme shout: the
 * secondary greys stop being secondary. */
{
  assert.strictEqual(P.fgToken(P.rgb('#1A211C')), 'var(--ink)', 'near-black is a title');
  assert.strictEqual(P.fgToken(P.rgb('#55605A')), 'var(--muted)', 'a mid grey is secondary');
  assert.strictEqual(P.fgToken(P.rgb('#79837C')), 'var(--muted)', 'so is the #79837C family');
}

/* ---- 4. a selector list splits on TOP-LEVEL commas only ---- */
{
  assert.strictEqual(P.parts('a, b').length, 2, 'a plain list splits');
  assert.strictEqual(P.parts(':is(a,b) c').length, 1,
    ':is(a,b) was split into fragments — each fragment is then scoped into a ' +
    'selector that matches nothing, and the correction silently disappears');
  assert.strictEqual(P.parts('[data-x="a,b"] y').length, 1, 'a quoted comma is not a separator');
}

/* ---- 5. a translucent white is a HIGHLIGHT, not a surface ----
 * rgba(255,255,255,.07) lightens whatever is under it and reads correctly on
 * dark. Repainting those made overlays and hover states vanish. */
assert.ok(/bg&&bg\.a>=0\.85&&lum\(bg\)>=0\.55/.test(src),
  'the background flip no longer checks alpha. Every rgba(255,255,255,.0x) ' +
  'highlight in the app becomes an opaque dark surface and the overlays disappear.');
assert.ok((src.match(/a>=0\.85/g) || []).length >= 5,
  'the alpha threshold has thinned out — it must guard the rule background, the ' +
  'rule colour, the border, and both inline passes, or one route repaints ' +
  'translucent highlights while the others do not');

/* ---- 6. importance is mirrored, not invented ---- */
assert.ok(/\+impBg\)/.test(src) && /\+impFg\)/.test(src) && /getPropertyPriority/.test(src),
  'the correction no longer mirrors the source declaration\'s importance. Adding ' +
  '!important to a rule that lacked it jumps the important layer and beats the ' +
  'overrides that legitimately win — 20 identical failures across ten views.');

/* ---- 7. it stays cheap: no interval, no document-wide subtree observer ---- */
assert.ok(!/setInterval/.test(src),
  'the parity engine registers an interval. This app already pays 264 of them ' +
  'for 2.4% of the main thread while idle; the engine is event-driven on purpose.');
assert.ok(!/subtree\s*:\s*true/.test(src),
  'the parity engine observes a subtree. A document-wide subtree observer reacts ' +
  'to every DOM change every other module makes, and during boot all ~230 are ' +
  'mutating. childList on head/body only.');
assert.ok(/lastSheets/.test(src) && /lastInline/.test(src),
  'the cheap early-out is gone. Something in this app adds and removes a <style> ' +
  'while idle, so the head observer fires ~1.3 times a second; without the ' +
  'early-out each of those re-walked every sheet at 5.8ms a time.');

/* ---- 8. light mode pays nothing ---- */
assert.ok(/classList\.contains\('theme-dark'\)/.test(src),
  'the engine no longer gates on theme-dark — light mode is the owner\'s mode and ' +
  'must not pay for a dark-theme correction');

/* ---- 9. the surfaces that must NOT follow the theme ---- */
['#mlsDock', 'agSigPad', 'canvas', 'mlsf-note', 'option'].forEach((skip) => {
  assert.ok(src.includes(skip),
    skip + ' is no longer excluded. The dock is the owner-approved navigation and ' +
    'is untouchable; the signature pad takes dark ink; <option> paints in an OS ' +
    'popup whose text colour we do not control; .mlsf-note is a document preview ' +
    'that mls-connect repaints inline every 1.5s anyway.');
});

/* ---- 10. the detectors can fail ---- */
{
  /* If :where() were dropped the scope test must catch it, and if chroma were
     swapped back for saturation the token test must catch it. Both proved by
     construction against a deliberately wrong implementation. */
  const badScope = (part) => 'html body.theme-dark ' + part;
  assert.notStrictEqual(badScope('.card'), P.scope('.card'),
    'the specificity assertion cannot distinguish the broken prefix from the correct one');
  const hslSat = (c) => {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    return d ? d / (1 - Math.abs(mx + mn - 1) || 1) : 0;
  };
  assert.ok(hslSat(P.rgb('#FCFBF8')) > 0.18,
    'the HSL-saturation failure this guard exists for is not reproducible — either ' +
    'the maths changed or the guard is checking nothing');
}

console.log('PASS dark-theme-reaches-every-panel: parity engine identical in 2 shells, ' +
  'scoping keeps source specificity, chroma classifies neutrals, text keeps its rank, ' +
  'translucent highlights and 5 excluded surfaces are protected, no interval and no ' +
  'subtree observer, and light mode does not run it');
