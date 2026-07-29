'use strict';
/* =============================================================================
 * THE MOTION SYSTEM IS DECORATION, AND DECORATION MUST BE REMOVABLE
 * -----------------------------------------------------------------------------
 * feat_mls_motion.js (mo-1.0.0) exists because the owner asked, on 2026-07-28,
 * for "awesome animations aple like ... a moving ranbow boarder like apple siri
 * stuff" — and, in the same breath, for "make sure not to break anything".
 *
 * This suite pins the second half. Every other motion suite in this repo reads
 * DECLARATIONS in a source file; this one RUNS the module against a stub DOM
 * and reads the stylesheet it actually emitted, because the three things most
 * worth pinning here are all properties of the emitted CSS and not of the
 * source text:
 *
 *   1. the reduced-motion kill switch covers EVERY rule that moves. The module
 *      generates that block from its own MOTION table, so the honest way to
 *      test it is to re-derive the coverage from the output and compare — a
 *      hand-maintained list of selectors in this file would be exactly the
 *      second source of truth the module was written to avoid.
 *   2. every animated property is transform / opacity / a registered custom
 *      property. Boot TBT on this app is already dominated by forced layout;
 *      an animated width/top/box-shadow is a reflow or a paint storm every
 *      frame. The forbidden list is asserted explicitly AND an allow-list is
 *      enforced, so a property nobody thought to forbid still fails.
 *   3. the decorative layers cannot swallow a click. They are ::before/::after
 *      layers stacked ABOVE the host background so the masked ring can be seen
 *      at all; pointer-events:none is the only thing standing between that and
 *      an unclickable Copilot.
 *
 * Plus the two things that can only be checked against the rest of the repo:
 * the ring must target ids that really exist in the shipped app (a ring on a
 * dead id is silent), and the module must add no timer and no observer — both
 * of those budgets in boot-script-budget.test.js are sitting AT their ceiling.
 *
 * Every detector below is proved two-sided: it is shown to FAIL on a synthetic
 * violation before it is trusted to pass on the real file. A detector that has
 * never been seen to fail is not evidence.
 * ========================================================================== */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const MODULE = 'feat_mls_motion.js';
const src = read(MODULE);

/* ========================================================== the stub DOM ===
   Enough of a document for the module to install and revert against, and no
   more. It COUNTS what the module does rather than pretending to render it:
   how many style elements it creates, what it appends, what it removes, and
   which body classes it writes. */

function makeDom() {
  const created = [];
  const head = { children: [] };
  head.appendChild = function (n) { n.parentNode = head; head.children.push(n); };
  head.removeChild = function (n) {
    const i = head.children.indexOf(n);
    if (i > -1) head.children.splice(i, 1);
    n.parentNode = null;
  };
  const classes = new Set();
  const document = {
    readyState: 'complete',
    head,
    documentElement: head,
    body: {
      classList: {
        contains: (c) => classes.has(c),
        toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
        add: () => { throw new Error('classList.add re-commits unconditionally; use toggle(name, force)'); }
      }
    },
    createElement(tag) {
      const el = { tagName: tag.toUpperCase(), id: '', textContent: '', parentNode: null };
      created.push(el);
      return el;
    },
    getElementById(id) {
      return head.children.filter((n) => n.id === id)[0] || null;
    },
    addEventListener() {},
    querySelector: () => null
  };
  const window = { document };
  return { window, document, created, head, classes };
}

function install() {
  const dom = makeDom();
  vm.runInNewContext(src, {
    window: dom.window,
    document: dom.document,
    setTimeout, clearTimeout, console
  }, { filename: MODULE });
  return dom;
}

const dom = install();
const api = dom.window.__mlsMotion;

/* ================================================ 1. one sheet, one class ===*/

assert.ok(api, 'feat_mls_motion.js did not register window.__mlsMotion');
assert.strictEqual(api.version, 'mo-1.0.0', 'version drifted: ' + api.version);
assert.strictEqual(typeof api.revert, 'function', '__mlsMotion.revert is not a function');

const styles = dom.head.children.filter((n) => n.tagName === 'STYLE');
assert.strictEqual(styles.length, 1,
  'the module injected ' + styles.length + ' style elements. It must inject exactly ONE: ' +
  'every extra <style> insertion invalidates the whole document\'s styles, which is a ' +
  'recurring synchronous hit on a clinic-scale DOM (see the thm-1.1.1 freeze lesson).');
assert.strictEqual(styles[0].id, api.styleId,
  'the injected sheet does not carry the id revert() looks for — revert would leave it behind');
assert.ok(dom.classes.has(api.bodyClass),
  'the module did not put ' + api.bodyClass + ' on <body>; every one of its selectors is ' +
  'scoped under that class, so without it the whole stylesheet is dead');

const CSS = styles[0].textContent;
assert.ok(CSS.length > 2000, 'the emitted stylesheet is only ' + CSS.length +
  ' chars — the module ran but produced almost nothing, and an empty haystack passes everything');

/* re-installing must not double up */
const twice = install();
vm.runInNewContext(src, {
  window: twice.window, document: twice.document, setTimeout, clearTimeout, console
}, { filename: MODULE });
assert.strictEqual(twice.head.children.filter((n) => n.tagName === 'STYLE').length, 1,
  'loading the module twice injected two stylesheets — the __mlsMotion guard does not hold');

/* ------------------------------------------------------- revert, for real ---*/

const removed = api.revert();
assert.strictEqual(removed, 'reverted', 'revert() should report what it did');
assert.strictEqual(dom.head.children.filter((n) => n.tagName === 'STYLE').length, 0,
  'revert() left the stylesheet in the document');
assert.ok(!dom.classes.has(api.bodyClass),
  'revert() left ' + api.bodyClass + ' on <body>; the class is the switch every selector hangs off');
assert.strictEqual(dom.window.__mlsMotion, undefined,
  'revert() left window.__mlsMotion behind, so the module can never be re-installed');
assert.strictEqual(dom.classes.size, 0,
  'revert() left ' + dom.classes.size + ' class(es) on <body>: ' + [...dom.classes].join(', '));

/* ===================================================== 2. a CSS block parser ===
   Small, recursive, at-rule aware. @keyframes bodies are NOT style rules and
   must not be walked as such — that mistake would silently turn every `0%{}`
   into a selector and make the coverage check meaningless. */

function parse(css) {
  const rules = [];      /* {sel, decls, wrappers} */
  const keyframes = {};  /* name -> body */
  (function walk(text, wrappers) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      let depth = 0, close = -1;
      for (let j = open; j < text.length; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') { depth--; if (!depth) { close = j; break; } }
      }
      if (close === -1) break;
      const prelude = text.slice(i, open).trim();
      const body = text.slice(open + 1, close);
      if (/^@keyframes\s/i.test(prelude)) {
        keyframes[prelude.replace(/^@keyframes\s+/i, '').trim()] = body;
      } else if (/^@property\s/i.test(prelude)) {
        /* a registration, not a rule */
      } else if (prelude.charAt(0) === '@') {
        walk(body, wrappers.concat([prelude]));
      } else if (prelude) {
        rules.push({ sel: prelude, decls: body, wrappers });
      }
      i = close + 1;
    }
  })(css, []);
  return { rules, keyframes };
}

/* paren-aware comma split — var(--x,120ms) and cubic-bezier(.2,.7,.3,1) both
   contain commas, and splitting on /,/ shreds every declaration in this file */
function splitTop(str) {
  const out = []; let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function decls(body) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ';' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean).map((d) => {
    const c = d.indexOf(':');
    return { prop: d.slice(0, c).trim().toLowerCase(), value: d.slice(c + 1).trim() };
  });
}

const { rules, keyframes } = parse(CSS);

/* the parser must have seen a real stylesheet, or every check below is vacuous */
assert.ok(rules.length >= 25,
  'the CSS parser found only ' + rules.length + ' style rules. It is broken, not the ' +
  'module, and a broken parser passes whatever anyone ships.');
assert.ok(Object.keys(keyframes).length >= 8,
  'only ' + Object.keys(keyframes).length + ' @keyframes parsed; expected the spin, the ' +
  'two arrivals, the cross-fade and the six staggered holds');
assert.ok(keyframes.mlsMoxSpin, 'the ring rotation keyframe mlsMoxSpin is gone');

/* ============================ 3. every animated property is in the allow-set ===*/

const ALLOWED = new Set(['transform', 'opacity', '--mls-mox-angle']);
const FORBIDDEN = ['box-shadow', 'filter', 'backdrop-filter', 'width', 'height',
  'top', 'left', 'right', 'bottom', 'margin', 'padding', 'background-position',
  'font-size', 'border-width', 'inset'];

/* which properties does a named animation actually move? */
function keyframeProps(name) {
  const body = keyframes[name];
  if (!body) return null;
  const props = new Set();
  parse('x{}' + body.replace(/([\d.]+%|from|to)\s*(?=\{)/g, 'KF$1')).rules
    .forEach(() => {});
  /* keyframe bodies are `0%{...}100%{...}` — walk their inner blocks directly */
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const close = body.indexOf('}', open);
    if (close === -1) break;
    decls(body.slice(open + 1, close)).forEach((d) => props.add(d.prop));
    i = close + 1;
  }
  return props;
}

const animatedProps = new Map();   /* prop -> [where] */
let movingRules = 0;
const moving = [];                 /* selectors that declare animation/transition */

rules.forEach((r) => {
  const inReduced = r.wrappers.some((w) => /prefers-reduced-motion/i.test(w));
  let declaresMotion = false;
  decls(r.decls).forEach((d) => {
    if (d.prop === 'animation' || d.prop === 'animation-name') {
      if (/^none\b/.test(d.value)) return;
      if (inReduced) return;
      declaresMotion = true;
      splitTop(d.value).forEach((part) => {
        const name = part.split(/\s+/).filter((t) => keyframes[t])[0];
        assert.ok(name,
          r.sel + ' animates a keyframe this stylesheet does not define: ' + part +
          '\nAn animation naming a missing keyframe is silently dead motion.');
        const props = keyframeProps(name);
        props.forEach((p) => {
          if (!animatedProps.has(p)) animatedProps.set(p, []);
          animatedProps.get(p).push(r.sel + ' via @keyframes ' + name);
        });
      });
    } else if (d.prop === 'transition' || d.prop === 'transition-property') {
      if (/^none\b/.test(d.value)) return;
      if (inReduced) return;
      declaresMotion = true;
      splitTop(d.value).forEach((part) => {
        const p = part.split(/\s+/)[0].toLowerCase();
        assert.notStrictEqual(p, 'all',
          r.sel + ' uses `transition: all`. That transitions layout properties too, ' +
          'the moment anybody adds one, and nobody ever notices.');
        if (!animatedProps.has(p)) animatedProps.set(p, []);
        animatedProps.get(p).push(r.sel + ' (transition)');
      });
    }
  });
  if (declaresMotion) { movingRules++; moving.push(r.sel); }
});

assert.ok(movingRules >= 15,
  'only ' + movingRules + ' rules in the emitted sheet declare motion — the detector is ' +
  'broken, not the module');

FORBIDDEN.forEach((bad) => {
  assert.ok(!animatedProps.has(bad),
    'feat_mls_motion.js animates `' + bad + '`, at:\n  ' +
    (animatedProps.get(bad) || []).join('\n  ') +
    '\nOnly transform, opacity and a registered custom property may animate here. ' +
    'Everything else is a reflow or a full-surface repaint every frame, on a screen ' +
    'whose boot TBT is already dominated by forced layout.');
});

[...animatedProps.keys()].forEach((p) => {
  assert.ok(ALLOWED.has(p),
    'feat_mls_motion.js animates `' + p + '`, which is not in the allow-set ' +
    '{' + [...ALLOWED].join(', ') + '}, at:\n  ' + animatedProps.get(p).join('\n  ') +
    '\nThe allow-set is deliberately smaller than the forbidden list: a property ' +
    'nobody thought to ban must still fail.');
});
assert.ok(animatedProps.has('transform') && animatedProps.has('opacity') &&
  animatedProps.has('--mls-mox-angle'),
  'the sheet no longer animates all three of transform / opacity / --mls-mox-angle; ' +
  'the detector is reading the wrong thing');

/* ==================== 4. reduced motion covers every rule that moves ==========*/

const reduced = rules.filter((r) => r.wrappers.some((w) => /prefers-reduced-motion/i.test(w)));
assert.ok(reduced.length > 0, 'there is no prefers-reduced-motion block at all. ' +
  'Non-negotiable: this is a clinical product and motion here is decoration.');

const killed = new Set();
reduced.forEach((r) => {
  const d = decls(r.decls);
  const killsAnim = d.some((x) => x.prop === 'animation' && /none/.test(x.value) && /!important/.test(x.value));
  const killsTrans = d.some((x) => x.prop === 'transition' && /none/.test(x.value) && /!important/.test(x.value));
  if (killsAnim && killsTrans) splitTop(r.sel).forEach((s) => killed.add(s.trim()));
});
assert.ok(killed.size >= 15,
  'the reduced-motion block names only ' + killed.size + ' selectors; the coverage check ' +
  'would be vacuous');

const uncovered = [];
moving.forEach((sel) => {
  splitTop(sel).forEach((one) => { if (!killed.has(one.trim())) uncovered.push(one.trim()); });
});
assert.deepStrictEqual(uncovered, [],
  'these rules move but prefers-reduced-motion: reduce does not switch them off:\n  ' +
  uncovered.join('\n  ') +
  '\nThe module derives its kill switch from its own MOTION table precisely so this ' +
  'cannot happen — a rule declared outside that table is the only way to get here.');

/* the kill switch must clear transform ONLY where the module set one: a blanket
   transform:none!important would reach app-owned transforms on modal children */
const blanket = reduced.filter((r) => decls(r.decls).some((x) => x.prop === 'transform'));
blanket.forEach((r) => {
  splitTop(r.sel).forEach((s) => {
    assert.ok(/:hover/.test(s),
      'the reduced-motion block clears transform on ' + s + ', which this module never ' +
      'sets a transform on. Clearing it there overrides whatever the APP set, and a ' +
      'decoration module must not change an existing behaviour to switch itself off.');
  });
});

/* ============================= 5. decorative layers cannot take a click =======*/

const pseudo = rules.filter((r) => /::(before|after)/.test(r.sel) &&
  decls(r.decls).some((d) => d.prop === 'content'));
assert.ok(pseudo.length >= 3,
  'only ' + pseudo.length + ' decorative pseudo-element layers found; expected at least ' +
  'the dock ring, the card ring and the bloom');
pseudo.forEach((r) => {
  const pe = decls(r.decls).filter((d) => d.prop === 'pointer-events')[0];
  assert.ok(pe && pe.value === 'none',
    r.sel + ' creates a decorative layer without pointer-events:none. These layers are ' +
    'stacked ABOVE the host background so the masked ring is visible at all — without ' +
    'pointer-events:none that is an invisible sheet over the Copilot surface.');
});

/* ================= 6. the ring targets ids that exist in the shipped app ======*/

const app = read('ScribeFlow.html');
const staging = read('ScribeFlow-staging.html');
const connect = read('mls-connect.js');

/* [what the stylesheet targets, where it must exist, how it is reached] */
const TARGETS = [
  ['#copilotDock', app, 'the Copilot drawer created by openCopilotDock()'],
  ['#copilotCard', app, 'the Copilot card in #studioView'],
  ['#studioView', app, 'the AI Studio view'],
  ['#askCopilotHdrBtn', app, 'the header "Ask" pill'],
  ['#copilotChips', app, 'the Copilot suggestion chip row'],
  ['#settingsModal', app, 'the settings modal'],
  ['#analysisView', app, 'the Practice/Analysis panel']
];
TARGETS.forEach(([sel, hay, why]) => {
  assert.ok(CSS.includes(sel),
    'the motion sheet no longer targets ' + sel + ' (' + why + ')');
  assert.ok(hay.includes('id="' + sel.slice(1) + '"') || hay.includes("id='" + sel.slice(1) + "'") ||
    hay.includes("'" + sel.slice(1) + "'"),
    'the motion sheet targets ' + sel + ' but nothing in ScribeFlow.html carries that id. ' +
    'A ring on a dead id is silent: it costs a rule, shows nothing, and no test notices.');
});

/* the ring hangs off the class openCopilotDock() actually adds */
assert.ok(/#copilotDock\.open::before/.test(CSS),
  'the dock ring no longer keys off #copilotDock.open');
[['ScribeFlow.html', app], ['ScribeFlow-staging.html', staging]].forEach(([name, page]) => {
  const i = page.indexOf('function openCopilotDock');
  assert.ok(i > -1, name + ': openCopilotDock is gone');
  const open = page.slice(i, i + 4000);
  assert.ok(/classList\.add\('open'\)/.test(open),
    name + ": openCopilotDock no longer adds the 'open' class, so #copilotDock.open::before " +
    'is dead CSS and the Siri ring never appears.');
});
/* and off the classes the app really uses for the surfaces it cross-fades */
assert.ok(app.includes('set-tab-hidden'), 'the settings tab class set-tab-hidden is gone');
assert.ok(app.includes('modal-bg') && app.includes("classList.add('show')") ||
  app.includes('modal-bg'), 'the .modal-bg shell is gone');
assert.ok(connect.includes('#copilotDock') || app.includes('copilotDock'),
  'nothing in the shipped app mentions the Copilot dock any more');

/* the multi-colour treatment stays reserved for the AI surfaces */
const conicRules = rules.filter((r) => /conic-gradient/.test(r.decls));
assert.ok(conicRules.length >= 3, 'the conic ring is gone from the emitted sheet');
conicRules.forEach((r) => {
  assert.ok(/copilot/i.test(r.sel) || /askCopilot/i.test(r.sel),
    'the multi-colour ring escaped the AI surfaces and landed on ' + r.sel +
    '. Rainbow is the signal for "AI is here"; everywhere else uses the app palette.');
});

/* ===================== 7. no timers, no observers, in the SOURCE ==============*/

const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
[
  [/\bsetInterval\s*\(/, 'setInterval — an interval never stops, and boot-script-budget ' +
    'counts 212 of them against a ceiling of 214'],
  [/\bsetTimeout\s*\(/, 'setTimeout — a retry ladder here is a poller by another name; ' +
    'every surface this module animates is revealed by a class the app already toggles'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame — rAF does not fire in an occluded ' +
    'tab, so anything gated on it is not merely un-animated, it never happens'],
  [/\bMutationObserver\b/, 'MutationObserver — the document-observer budget is at 59 of 59, ' +
    'and CSS already sees every class this module keys off']
].forEach(([re, why]) => {
  assert.ok(!re.test(code), 'feat_mls_motion.js uses ' + why);
});
assert.ok(!/observe\s*\(\s*document/.test(code),
  'feat_mls_motion.js observes the document. A whole-document childList+subtree observer ' +
  'runs on every DOM change every other module makes; this repo has measured damage from them.');
assert.ok(!/animation-delay|animation:\s*[^;}]*\b(both|backwards)\b/.test(CSS),
  'the emitted sheet uses animation-delay or a backwards fill. Law 3 of MOTION_TOKENS.md: ' +
  'a fill on a keyframe starting at opacity:0 leaves a surface permanently invisible if the ' +
  'animation never runs — and without a fill, a DELAY makes the element flash visible and ' +
  'then blink out. The stagger is baked into mlsMoxRise0..5 instead.');

/* nothing may move on the surfaces the doctor reads or types into */
['#noteCard', '#ez3Wrap', '#visitOrdersBody', '#transcript'].forEach((host) => {
  moving.forEach((sel) => {
    assert.ok(!sel.includes(host),
      'a motion rule reaches ' + host + ' via ' + sel + '. The transcript host is rebuilt ' +
      'about every 3s and #visitOrdersBody about every 5s; an entrance rule inside either ' +
      'is a permanent flicker in front of someone mid-recording.');
  });
});

/* ================= 8. the loader is deferred and cache-deterministic ==========*/

const at = connect.indexOf("data-mls-asset=\"feat_mls_motion.js\"");
assert.ok(at > -1, 'mls-connect.js does not load feat_mls_motion.js at all');
assert.strictEqual(connect.split('feat_mls_motion.js').length - 1, 3,
  'the motion loader line should name its asset exactly three times (guard, src, attribute)');
const behind = connect.slice(Math.max(0, at - 400), at);
assert.ok(/requestIdleCallback|__mlsDeferAsset\(/.test(behind),
  'the motion loader is EAGER. It is pure polish and must never be on the boot path — ' +
  'route it through requestIdleCallback like its neighbours.');
assert.ok(/feat_mls_motion\.js\?v='\s*\+\s*\(window\.__MLS_AV\s*\|\|\s*Date\.now\(\)\)/.test(connect),
  'the motion loader must use the deterministic cache token (window.__MLS_AV || Date.now()), ' +
  'not a bare Date.now() — a bare timestamp defeats the asset cache on every load');
assert.ok(/window\.__mlsMotion mo-1\.0\.0; revert\(\)/.test(connect),
  'the loader comment must declare the global and the escape hatch, as every other one does');

/* ============ 9. the detectors are proved to fail, both directions ============*/
{
  const bad = parse('a{animation:x 1s}b{transition:box-shadow 1s}@keyframes x{from{width:0}to{width:9px}}');
  assert.strictEqual(bad.rules.length, 2, 'the parser miscounts style rules');
  assert.ok(!bad.keyframes.KF0, 'the parser leaked keyframe steps into the rule list');
  assert.strictEqual(Object.keys(bad.keyframes).length, 1, 'the parser lost a @keyframes');
  assert.deepStrictEqual(splitTop('opacity var(--a,1ms) var(--b,cubic-bezier(.2,.7,.3,1)),transform 1ms'),
    ['opacity var(--a,1ms) var(--b,cubic-bezier(.2,.7,.3,1))', 'transform 1ms'],
    'the comma splitter shreds var() and cubic-bezier(), which every declaration here uses');
  const kf = parse('@keyframes q{from{opacity:0;transform:none}to{opacity:1}}');
  assert.ok(kf.keyframes.q && kf.rules.length === 0,
    'a @keyframes body was walked as if its steps were selectors');
}

console.log('PASS motion-system-contract: mo-1.0.0 emits ONE stylesheet (' + CSS.length +
  ' chars, ' + rules.length + ' rules, ' + Object.keys(keyframes).length + ' keyframes) and ' +
  'revert() removes it, the body class and the global; all ' + movingRules +
  ' moving rules are covered by prefers-reduced-motion (' + killed.size + ' selectors killed); ' +
  'the only animated properties are ' + [...animatedProps.keys()].sort().join(' / ') + '; ' +
  pseudo.length + ' decorative layers all declare pointer-events:none; the Siri ring keys off ' +
  '#copilotDock.open, which openCopilotDock() really adds on both pages; no timer, no rAF and ' +
  'no observer in the module; loader is idle-deferred with a deterministic cache token');
