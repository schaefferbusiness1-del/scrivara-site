'use strict';
/* =============================================================================
 * THE CLINICAL QUALITY PASS IS DECORATION, AND DECORATION MUST BE PROVABLE
 * -----------------------------------------------------------------------------
 * feat_mls_ui_clinical.js (uc-1.0.0) exists because the owner asked, on
 * 2026-07-29, for "THAT LEVEL OF QUALITY EVERYWHERE" and, in the same breath,
 * "maek sure it all works perfect and that we dont lose any features in the
 * porcess". Both halves are the brief and this suite pins the second one.
 *
 * It RUNS the module against a stub DOM and reads the stylesheet it actually
 * emitted, rather than grepping the source, because every property worth
 * pinning here is a property of the OUTPUT:
 *
 *   1. the reduced-motion kill switch covers every rule that moves, and it is
 *      re-derived from the emitted sheet rather than from a list in this file.
 *      A hand-kept list here would be exactly the second source of truth the
 *      module was written to avoid.
 *   2. only compositor/paint properties animate. The forbidden set is asserted
 *      explicitly AND an allow-set is enforced, so a property nobody thought
 *      to forbid still fails.
 *   3. the medical record does not move, and -- the half that is easy to get
 *      backwards -- the exclusion that protects it does NOT also delete the
 *      app's own transitions on those hosts. Four shipped rules transition a
 *      textarea; a blanket `transition:none!important` there is a feature loss
 *      dressed up as safety, which is the failure this suite exists to catch.
 *   4. ANTI-VACUITY. Every id and class this module targets is proved to exist
 *      in the shipped app, with the proof named. A selector that matches
 *      nothing looks exactly like a fix that shipped -- this repo has done it
 *      at least twice (`#mlsfhpdf-btn` for `.mlsfhpdf-btn`, and a whole motion
 *      block trapped inside a phone media query). This is the most important
 *      assertion in the file.
 *   5. no timer, no rAF, no observer, and no !important outside the three
 *      places where out-shouting is the point.
 *
 * Every detector is proved two-sided: shown to FAIL on a synthetic violation
 * before it is trusted to pass on the real file. A detector that has never
 * been seen to fail is not evidence.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const MODULE = 'feat_mls_ui_clinical.js';
const src = read(MODULE);

function fail(msg) {
  console.error('FAIL ui-clinical-pass: ' + msg);
  process.exit(1);
}

/* =========== 7 (RUN FIRST). No timers, no observers, presentation only =====
   This is a SOURCE scan and it runs before the module is ever executed, on
   purpose: the stub DOM below deliberately does not define setInterval,
   setTimeout, requestAnimationFrame or MutationObserver, so a module that
   reaches for one dies inside vm with a bare "ReferenceError: setInterval is
   not defined" and the reader learns nothing about WHY it is banned. Scanning
   first means the named assertion wins the race. (Both orders were tried; the
   ReferenceError is what the first version printed.) */

const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
[
  [/\bsetInterval\s*\(/, 'setInterval -- an interval never stops, and boot-script-budget counts ' +
    'them against a ceiling that is already at its limit'],
  [/\bsetTimeout\s*\(/, 'setTimeout -- a retry ladder here is a poller by another name; every ' +
    'state this module reads is a class the app already writes or a fact :has() can see'],
  [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame -- rAF does not fire in an occluded ' +
    'tab, so anything gated on it never happens at all'],
  [/\bMutationObserver\b/, 'MutationObserver -- the document-observer budget is at its ceiling, ' +
    'and CSS already sees every class this module keys off'],
  [/\bIntersectionObserver\b|\bResizeObserver\b/, 'an observer']
].forEach(([re, why]) => {
  assert.ok(!re.test(code), MODULE + ' uses ' + why);
});
assert.ok(!/observe\s*\(\s*document/.test(code),
  MODULE + ' observes the document. A whole-document observer runs on every DOM change every ' +
  'other module makes; this repo has measured damage from them.');

/* presentation only: no node creation beyond the one <style>, no reparenting,
   no handler binding, no writes to another element's style */
assert.strictEqual((code.match(/createElement\s*\(/g) || []).length, 1,
  'the module creates more than one element. It may create exactly ONE <style> and nothing else.');
[
  [/\bappendChild\s*\(/g, 2, 'appendChild'],
  [/\binsertBefore\s*\(/g, 0, 'insertBefore -- no reparenting'],
  [/\bremoveAttribute\s*\(/g, 0, 'removeAttribute'],
  [/\bsetAttribute\s*\(/g, 0, 'setAttribute'],
  [/\.innerHTML\s*=/g, 0, 'innerHTML assignment'],
  [/\baddEventListener\s*\(\s*['"](?!DOMContentLoaded)/g, 0,
    'an event listener on anything but DOMContentLoaded -- no control\'s behaviour may change'],
  [/\.style\s*\.\s*[a-zA-Z]/g, 0, 'an element.style write -- an inline style hide is invisible ' +
    'to availability checks and silently removes a feature']
].forEach(([re, max, why]) => {
  const n = (code.match(re) || []).length;
  assert.ok(n <= max, MODULE + ' uses ' + why + ' ' + n + ' time(s); ceiling is ' + max);
});
assert.ok(/classList\.toggle\(/.test(code) && !/body\.classList\.add\(/.test(code),
  'the body class must be written with classList.toggle(name, force). add()/remove() re-commit ' +
  'the attribute unconditionally, which is a whole-document style invalidation for no visual ' +
  'change -- this app was measured doing 86 such no-op writes in 44 seconds.');

/* ========================================================== the stub DOM ===
   Enough document for the module to install and revert against, and no more.
   It COUNTS what the module does rather than pretending to render it. */

function makeDom() {
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
      return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null };
    },
    getElementById(id) {
      return head.children.filter((n) => n.id === id)[0] || null;
    },
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const window = { document };
  return { window, document, head, classes };
}

function install(into) {
  const dom = into || makeDom();
  vm.runInNewContext(src, {
    window: dom.window, document: dom.document, console
  }, { filename: MODULE });
  return dom;
}

const dom = install();
const api = dom.window.__mlsUiClinical;

/* ============================================ 1. one sheet, one class ===== */

if (!api) fail(MODULE + ' did not register window.__mlsUiClinical');
assert.strictEqual(api.version, 'uc-1.0.0', 'version drifted: ' + api.version);
assert.strictEqual(typeof api.revert, 'function', '__mlsUiClinical.revert is not a function');
assert.strictEqual(typeof api.css, 'function',
  'the module must expose its CSS-building function so this suite can EXECUTE it ' +
  'rather than grep the source');

const styles = dom.head.children.filter((n) => n.tagName === 'STYLE');
assert.strictEqual(styles.length, 1,
  'the module injected ' + styles.length + ' style elements. Exactly ONE: every extra ' +
  '<style> insertion invalidates the whole document\'s styles, a synchronous hit on a ' +
  'clinic-scale DOM.');
assert.strictEqual(styles[0].id, api.styleId,
  'the injected sheet does not carry the id revert() looks for -- revert would leave it behind');
assert.ok(dom.classes.has(api.bodyClass),
  'the module did not put ' + api.bodyClass + ' on <body>; every selector it ships is scoped ' +
  'under that class, so without it the whole stylesheet is dead');

/* the emitted sheet and the function must agree -- otherwise this suite would be
   testing a code path that never ships */
const CSS = styles[0].textContent;
assert.strictEqual(CSS, api.css(),
  'the injected stylesheet is not what css() returns; this suite would be checking dead code');
assert.ok(CSS.length > 1200,
  'the emitted stylesheet is only ' + CSS.length + ' chars -- the module ran but produced ' +
  'almost nothing, and an empty haystack passes everything');

/* re-running the file must not double up */
{
  const twice = makeDom();
  install(twice);
  install(twice);
  assert.strictEqual(twice.head.children.filter((n) => n.tagName === 'STYLE').length, 1,
    'loading the module twice injected two stylesheets -- the __mlsUiClinical guard does not hold');
}

/* ------------------------------------------------------- revert, for real -- */
{
  const r = install();
  const a = r.window.__mlsUiClinical;
  assert.strictEqual(a.revert(), 'reverted', 'revert() should report what it did');
  assert.strictEqual(r.head.children.filter((n) => n.tagName === 'STYLE').length, 0,
    'revert() left the stylesheet in the document');
  assert.strictEqual(r.classes.size, 0,
    'revert() left ' + r.classes.size + ' class(es) on <body>: ' + [...r.classes].join(', '));
  assert.strictEqual(r.window.__mlsUiClinical, undefined,
    'revert() left window.__mlsUiClinical behind, so the module can never be re-installed');
}

/* ===================================================== 2. a CSS parser ==== */

function parse(css) {
  const rules = [];      /* {sel, decls, wrappers} */
  const keyframes = {};
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

/* paren-aware comma split -- var(--x,120ms) and cubic-bezier(.2,.7,.3,1) both
   contain commas, and splitting on /,/ shreds every declaration in this file.
   Selector lists need the same treatment: :not(:has(button:active)) too. */
function splitTop(str) {
  const out = []; let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function decls(body) {
  const out = [];
  let depth = 0, cur = '', q = '';
  for (const ch of body) {
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
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
assert.ok(rules.length >= 12,
  'the CSS parser found only ' + rules.length + ' style rules. It is broken, not the module, ' +
  'and a broken parser passes whatever anyone ships.');
assert.strictEqual(Object.keys(keyframes).length, 0,
  'this module must ship NO @keyframes -- it has no entrances by design (the day list is ' +
  'rebuilt with innerHTML on every state change, so an entrance there replays forever), and ' +
  'a keyframe here would also drag MOTION_TOKENS law 3 (no fill from opacity:0) into scope. ' +
  'Found: ' + Object.keys(keyframes).join(', '));

/* ================ 3. only compositor/paint properties animate ============= */

const LAYOUT = ['height', 'width', 'top', 'left', 'right', 'bottom',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'inset', 'font-size', 'border-width', 'flex', 'flex-basis', 'gap', 'line-height'];
const ALLOWED_ANIM = new Set(['transform', 'opacity', 'box-shadow',
  'border-color', 'background-color', 'color']);

const animatedProps = new Map();   /* prop -> [where] */
/* "moving" is every rule the kill switch has to reach, which is BOTH the rule
   that declares the transition AND the rules that declare the transform state
   it animates. Counting only `transition:` declarations would let a
   `:hover{transform:...}` ship with no off-switch -- reduced motion would then
   still slide the row, just instantly, which is not the same as off. */
const moving = [];

rules.forEach((r) => {
  const inReduced = r.wrappers.some((w) => /prefers-reduced-motion/i.test(w));
  if (inReduced) return;
  let declaresMotion = false;
  decls(r.decls).forEach((d) => {
    if (d.prop === 'transform' && !/^none\b/.test(d.value)) { declaresMotion = true; return; }
    if (d.prop !== 'animation' && d.prop !== 'animation-name' &&
        d.prop !== 'transition' && d.prop !== 'transition-property') return;
    if (/^none\b/.test(d.value)) return;
    declaresMotion = true;
    splitTop(d.value).forEach((part) => {
      const p = part.split(/\s+/)[0].toLowerCase();
      assert.notStrictEqual(p, 'all',
        r.sel + ' uses `transition: all`. That transitions layout properties too the moment ' +
        'anybody adds one, and nobody ever notices. (This module deliberately REPLACES the ' +
        'app\'s own `.ez3-prow{transition:.12s}` for exactly this reason.)');
      if (!animatedProps.has(p)) animatedProps.set(p, []);
      animatedProps.get(p).push(r.sel);
    });
  });
  if (declaresMotion) moving.push(r.sel);
});

assert.ok(moving.length >= 3,
  'only ' + moving.length + ' rules in the emitted sheet move -- the detector is broken, not ' +
  'the module');
assert.ok(moving.length <= 6,
  moving.length + ' rules move on a clinical surface. Restraint is a requirement here, not a ' +
  'preference: if a rule does not make the screen easier to use it should be deleted, and this ' +
  'ceiling is what stops the next pass from quietly turning the visit room into a carousel.');

LAYOUT.forEach((bad) => {
  assert.ok(!animatedProps.has(bad),
    MODULE + ' animates `' + bad + '`, at:\n  ' + (animatedProps.get(bad) || []).join('\n  ') +
    '\nThat is a reflow every frame, on a screen whose boot TBT is already dominated by ' +
    'forced layout.');
});
[...animatedProps.keys()].forEach((p) => {
  assert.ok(ALLOWED_ANIM.has(p),
    MODULE + ' animates `' + p + '`, which is not in the allow-set {' +
    [...ALLOWED_ANIM].join(', ') + '}, at:\n  ' + animatedProps.get(p).join('\n  ') +
    '\nThe allow-set is deliberately smaller than the forbidden list: a property nobody ' +
    'thought to ban must still fail.');
});
assert.ok(animatedProps.has('transform'),
  'nothing animates transform any more -- the detector is reading the wrong thing');

/* a static-spacing module must still never ANIMATE spacing, and it must never
   animate on a loop */
assert.ok(!/\binfinite\b/.test(CSS),
  'the emitted sheet contains an infinite animation. Nothing on a clinical surface may loop ' +
  'for the whole clinic day -- that is what keeps a laptop from ever reaching an idle frame ' +
  'rate. (The app\'s own ez3Pulse already does this and is reported, not copied.)');
assert.ok(!/animation-delay|\bboth\b|\bbackwards\b/.test(CSS),
  'the emitted sheet uses animation-delay or a backwards fill. MOTION_TOKENS law 3: a fill ' +
  'on a keyframe starting at opacity:0 leaves a surface permanently invisible if the ' +
  'animation never runs.');

/* ============= 4. reduced motion covers every rule that moves ============= */

const reduced = rules.filter((r) => r.wrappers.some((w) => /prefers-reduced-motion/i.test(w)));
assert.ok(reduced.length > 0,
  'there is no prefers-reduced-motion block at all. Non-negotiable: this is a clinical ' +
  'product and motion here is decoration.');

const killed = new Set();
const transformCleared = new Set();
reduced.forEach((r) => {
  const d = decls(r.decls);
  const killsAnim = d.some((x) => x.prop === 'animation' && /none/.test(x.value) && /!important/.test(x.value));
  const killsTrans = d.some((x) => x.prop === 'transition' && /none/.test(x.value) && /!important/.test(x.value));
  const killsXform = d.some((x) => x.prop === 'transform' && /none/.test(x.value) && /!important/.test(x.value));
  if (killsAnim && killsTrans) splitTop(r.sel).forEach((s) => killed.add(s.trim()));
  if (killsXform) splitTop(r.sel).forEach((s) => transformCleared.add(s.trim()));
});
assert.ok(killed.size >= 3,
  'the reduced-motion block names only ' + killed.size + ' selectors; the coverage check ' +
  'would be vacuous');

const uncovered = [];
moving.forEach((sel) => {
  splitTop(sel).forEach((one) => { if (!killed.has(one.trim())) uncovered.push(one.trim()); });
});
assert.deepStrictEqual(uncovered, [],
  'these rules move but prefers-reduced-motion: reduce does not switch them off:\n  ' +
  uncovered.join('\n  ') +
  '\nThe module derives its kill switch from its own MOVING table precisely so this cannot ' +
  'happen -- a transition declared outside that table is the only way to get here.');

/* the kill switch clears `transform` ONLY where this module set one. A blanket
   transform:none!important would reach app-owned transforms, i.e. a decoration
   module changing an existing behaviour in order to switch itself off. */
const setsTransform = new Set();
rules.forEach((r) => {
  if (r.wrappers.some((w) => /prefers-reduced-motion/i.test(w))) return;
  if (!decls(r.decls).some((d) => d.prop === 'transform' && !/^none\b/.test(d.value))) return;
  splitTop(r.sel).forEach((s) => setsTransform.add(s.trim()));
});
transformCleared.forEach((s) => {
  assert.ok(setsTransform.has(s),
    'the reduced-motion block clears transform on ' + s + ', which this module never sets a ' +
    'transform on. Clearing it there overrides whatever the APP set.');
});
setsTransform.forEach((s) => {
  assert.ok(transformCleared.has(s),
    s + ' sets a transform that prefers-reduced-motion never clears, so a doctor who asked ' +
    'the OS for less motion still gets the movement.');
});

/* ================= 5. the medical record does not move =================== */

const REQUIRED_CLINICAL = ['#noteBox', '#transcript', 'textarea', '[contenteditable="true"]'];

const exclusion = rules.filter((r) =>
  !r.wrappers.length &&
  splitTop(r.sel).some((s) => /#noteBox\b/.test(s)) &&
  decls(r.decls).some((d) => d.prop === 'animation' && /none/.test(d.value) && /!important/.test(d.value))
);
assert.strictEqual(exclusion.length, 1,
  'expected exactly ONE clinical-text exclusion rule that kills animation with !important; ' +
  'found ' + exclusion.length);

const exclSels = splitTop(exclusion[0].sel).map((s) => s.trim());
REQUIRED_CLINICAL.forEach((need) => {
  assert.ok(exclSels.some((s) => s.indexOf(need) > -1),
    'the clinical-text exclusion does not cover ' + need + '. Legibility of the medical ' +
    'record is untouchable and the exclusion is what makes that structural rather than a ' +
    'promise. Covered: ' + exclSels.join(', '));
});

/* ...and the exclusion must be PRECISE. A blanket `transition:none!important`
   on `textarea` deletes real app behaviour -- proved from the shipped page, not
   assumed. */
const appPage = read('ScribeFlow.html');
const textareaTransitions = (appPage.match(/textarea[^{}]{0,220}\{[^}]*transition[^}]*\}/g) || []).length;
assert.ok(textareaTransitions >= 3,
  'expected the shipped page to transition a textarea in several rules (it did at the time ' +
  'this module was written: input/select/textarea border-color+box-shadow+background, the ' +
  '.sf-select family, the --r-ctl family). Found ' + textareaTransitions + '. If the app ' +
  'genuinely stopped transitioning textareas, revisit the exclusion below -- do not just ' +
  'lower this number.');
assert.ok(!decls(exclusion[0].decls).some((d) => d.prop === 'transition'),
  'the clinical-text exclusion declares `transition`. That would delete the focus-ring settle ' +
  'on every text field in the product (' + textareaTransitions + ' shipped rules transition a ' +
  'textarea) -- "we dont lose any features" is the other half of the brief. This module ' +
  'declares no transition on any typing surface, so there is nothing of its own to switch off ' +
  'there; the animation clause is the belt and the structural check below is the braces.');

/* structural: no MOVING rule may reach a clinical-text host at all */
const CLINICAL_TOKENS = ['#noteBox', '#transcript', 'textarea', 'contenteditable',
  '.mlsf-note', '.ez3-transcript', '.ez3-note'];
moving.forEach((sel) => {
  CLINICAL_TOKENS.forEach((host) => {
    assert.ok(sel.indexOf(host) === -1,
      'a rule that MOVES reaches ' + host + ' via ' + sel + '. The transcript host is rebuilt ' +
      'about every 3s; motion in there is a permanent flicker in front of someone ' +
      'mid-recording, not a flourish.');
  });
});

/* ...and nothing may make clinical text harder to read */
const SHRINKING = ['font-size', 'font-weight', 'color', 'opacity', 'filter'];
rules.forEach((r) => {
  const touchesRecord = splitTop(r.sel).some((s) =>
    CLINICAL_TOKENS.some((h) => s.indexOf(h) > -1));
  if (!touchesRecord) return;
  decls(r.decls).forEach((d) => {
    assert.ok(SHRINKING.indexOf(d.prop) === -1,
      r.sel + ' declares `' + d.prop + ': ' + d.value + '`. Nothing in a polish pass may ' +
      'change the size, weight, colour or opacity of the medical record.');
  });
});

/* ============ 6. the module stands down while he is working ============== */

['mls-note-live', 'mls-recording', '.ez3fl-recbtn.live'].forEach((marker) => {
  assert.ok(CSS.indexOf(marker) > -1,
    'the emitted sheet has no stand-down for ' + marker + '. Nothing may move while he is ' +
    'recording or reading a note.');
});
/* body.mls-recording has NO writer anywhere in the repo, which is why the real
   DOM-fact marker must also be present AND the module must say so. A
   stand-down that can never engage, shipped without a note, is the exact
   pattern this repo calls a dead selector that looks like a fix. */
{
  const files = fs.readdirSync(ROOT).filter((f) => /\.(js|html)$/.test(f));
  const writers = files.filter((f) => {
    if (f === MODULE) return false;
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return /classList\s*\.\s*(add|toggle)\s*\(\s*['"]mls-recording['"]/.test(t);
  });
  if (writers.length === 0) {
    assert.ok(/body\.mls-recording[\s\S]{0,900}?NO WRITER|HONOURED BUT DEAD/.test(src),
      'nothing in the app puts body.mls-recording on <body>, so that stand-down can never ' +
      'engage. The module must say so in its header (it does today) so the next reader does ' +
      'not mistake a dead selector for a working guard. Writers found: none.');
    assert.ok(CSS.indexOf(':has(.ez3fl-recbtn.live)') > -1,
      'body.mls-recording has no writer, so the ONLY stand-down that can actually fire is the ' +
      'DOM fact `#mlsEz3:has(.ez3fl-recbtn.live)` (mls-connect.js toggles `live` on the rec ' +
      'button while a recording runs). It is missing from the emitted sheet.');
  }
}

/* Section 7 (no timers, no observers, presentation only) is deliberately run
   FIRST, above the stub DOM -- see the top of this file. It has to be, because
   the sandbox does not define setInterval/setTimeout/rAF/MutationObserver at
   all: a module that reaches for one dies with a bare ReferenceError from
   inside vm, and "ReferenceError: setInterval is not defined" is a far worse
   diagnostic than the named assertion. Proved by breaking it both ways. */

/* !important is allowed in exactly three places: the record exclusion, the
   stand-down, and the reduced-motion kill switch. Anywhere else it means this
   module is out-shouting another lane's rule on a control it does not own. */
rules.forEach((r) => {
  const bangs = decls(r.decls).filter((d) => /!important/.test(d.value));
  if (!bangs.length) return;
  const isKill = r.wrappers.some((w) => /prefers-reduced-motion/i.test(w));
  const isExcl = splitTop(r.sel).some((s) => CLINICAL_TOKENS.some((h) => s.indexOf(h) > -1));
  const isStand = /mls-note-live|mls-recording|ez3fl-recbtn\.live/.test(r.sel);
  assert.ok(isKill || isExcl || isStand,
    r.sel + ' uses !important (' + bangs.map((b) => b.prop).join(', ') + ') outside the record ' +
    'exclusion, the stand-down and the reduced-motion kill switch. Everywhere else this module ' +
    'wins on specificity or not at all -- out-!importanting a rule another lane owns is how two ' +
    'lanes end up fighting over one control.');
});

/* ============== 8. ANTI-VACUITY: every selector targets something ======== */

/* The haystack is the shipped app: the page, the engine bundle, and every
   feature module -- minus this module itself, so a token can never prove
   itself. */
const HAYSTACK = (() => {
  const out = [];
  const files = fs.readdirSync(ROOT).filter((f) =>
    f !== MODULE && (/^feat_.*\.js$/.test(f) || f === 'mls-connect.js' || f === 'ScribeFlow.html'));
  files.forEach((f) => {
    try { out.push({ file: f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') }); } catch (e) {}
  });
  return out;
})();
assert.ok(HAYSTACK.length > 50 && HAYSTACK.some((h) => h.file === 'ScribeFlow.html') &&
  HAYSTACK.some((h) => h.file === 'mls-connect.js'),
  'the anti-vacuity haystack did not load the shipped app (got ' + HAYSTACK.length +
  ' files). A missing haystack passes every selector.');

const IDENT = '[A-Za-z0-9_-]';

/* STRONG proof: the token is really written into the document somewhere.
   WEAK proof: the app STYLES it, i.e. it appears as a selector in the app's own
   stylesheets. Weak is still proof the name is not a typo, but the gate demands
   that most tokens be strong so the check cannot be satisfied by CSS text. */
function proveClass(tok) {
  /* the token sits in a class attribute -- either right after the opening quote
     (`class="ez3-note"`, `class="ez3-fstep' + ...`) or after a space inside the
     value (`class="pt-item active"`). The `^|\s` form alone misses the first
     case, which is most of this app, and that hole silently demoted 15 real
     markup proofs to "the app merely styles it". */
  const attr = new RegExp('class\\s*=\\s*(["\'])(?:(?:(?!\\1)[\\s\\S]){0,400}?\\s)?' +
    tok + '(?![A-Za-z0-9_-])');
  const js = new RegExp('classList\\s*\\.\\s*(?:add|remove|toggle|contains)\\s*\\(\\s*["\']' +
    tok + '["\']');
  /* the state modifiers (.done .seen .now .open .warn .live .active) are never
     literal attribute text -- the app builds them by concatenation, e.g.
     `'ez3-fstep' + (i + 1 < cur ? ' done' : '')`. A complete quoted word is the
     honest proof for those. */
  const concat = new RegExp('["\']\\s?' + tok + '\\s?["\']');
  const styled = new RegExp('\\.' + tok + '(?!' + IDENT + ')');
  for (const h of HAYSTACK) { if (attr.test(h.text)) return { how: 'strong', file: h.file }; }
  for (const h of HAYSTACK) { if (js.test(h.text)) return { how: 'strong', file: h.file }; }
  for (const h of HAYSTACK) { if (concat.test(h.text)) return { how: 'strong', file: h.file }; }
  for (const h of HAYSTACK) { if (styled.test(h.text)) return { how: 'weak', file: h.file }; }
  return null;
}
function proveId(tok) {
  const attr = new RegExp('id\\s*=\\s*["\']' + tok + '["\']');
  const js = new RegExp('getElementById\\s*\\(\\s*["\']' + tok + '["\']');
  const styled = new RegExp('#' + tok + '(?!' + IDENT + ')');
  for (const h of HAYSTACK) {
    if (attr.test(h.text) || js.test(h.text)) return { how: 'strong', file: h.file };
  }
  for (const h of HAYSTACK) {
    if (styled.test(h.text)) return { how: 'weak', file: h.file };
  }
  return null;
}

/* Pull the ids, classes and element names out of a selector. Pseudo NAMES are
   stripped; the CONTENTS of :not()/:has() are kept, because .hd and button in
   there are real targets that must be validated too. */
const KNOWN_ELEMENTS = new Set(['body', 'button', 'textarea', 'input', 'select', 'span', 'div', 'a']);
function tokensOf(sel) {
  const noAttr = sel.replace(/\[[^\]]*\]/g, ' ');
  const noPseudo = noAttr.replace(/::?[a-zA-Z-]+/g, ' ');
  const classes = (noPseudo.match(new RegExp('\\.' + IDENT + '+', 'g')) || [])
    .map((s) => s.slice(1));
  const ids = (noPseudo.match(new RegExp('#' + IDENT + '+', 'g')) || [])
    .map((s) => s.slice(1));
  const els = (noPseudo.match(/(^|[\s>()+~])([a-zA-Z][a-zA-Z0-9]*)/g) || [])
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, '')).filter(Boolean);
  return { classes, ids, els };
}

const own = new Set(api.ownTokens || []);
assert.deepStrictEqual([...own], [api.bodyClass],
  'the module declares own tokens beyond its body class: ' + [...own].join(', ') +
  '. Every other id and class it targets must be one the APP ships.');

const proofs = [];
const unproven = [];
const seen = new Set();
rules.concat(reduced).forEach((r) => {
  splitTop(r.sel).forEach((one) => {
    const t = tokensOf(one);
    t.classes.forEach((c) => {
      if (own.has(c) || seen.has('.' + c)) return;
      seen.add('.' + c);
      const p = proveClass(c);
      if (!p) unproven.push('.' + c + '  (in ' + one.trim() + ')');
      else proofs.push({ tok: '.' + c, how: p.how, file: p.file });
    });
    t.ids.forEach((i) => {
      if (seen.has('#' + i)) return;
      seen.add('#' + i);
      const p = proveId(i);
      if (!p) unproven.push('#' + i + '  (in ' + one.trim() + ')');
      else proofs.push({ tok: '#' + i, how: p.how, file: p.file });
    });
    t.els.forEach((e) => {
      if (seen.has(e)) return;
      seen.add(e);
      if (!KNOWN_ELEMENTS.has(e)) unproven.push('<' + e + '>  (in ' + one.trim() + ')');
    });
  });
});

assert.deepStrictEqual(unproven, [],
  'THESE SELECTOR PARTS MATCH NOTHING IN THE SHIPPED APP:\n  ' + unproven.join('\n  ') +
  '\nA selector that matches zero elements looks exactly like a fix that shipped: it costs a ' +
  'rule, shows nothing, and no test notices. This repo has done it before (#mlsfhpdf-btn for ' +
  '.mlsfhpdf-btn hid nothing at all).');

assert.ok(proofs.length >= 20,
  'only ' + proofs.length + ' selector tokens were checked; the anti-vacuity harvester is ' +
  'broken, not the module');
const strong = proofs.filter((p) => p.how === 'strong').length;
assert.ok(strong >= Math.ceil(proofs.length * 0.7),
  'only ' + strong + ' of ' + proofs.length + ' tokens are proved by real markup (an id/class ' +
  'attribute, a classList write, or a getElementById); the rest are proved only by appearing ' +
  'in the app\'s own stylesheets. If most of the targets exist only in CSS, this module is ' +
  'styling names nothing renders.');

/* the four surfaces the brief names by hand must be present, and must be
   proved in ScribeFlow.html specifically -- that is where they live */
[['#patientsView', 'id'], ['pt-item', 'class'], ['noteBox', 'id'], ['transcript', 'id']]
  .forEach(([tok, kind]) => {
    const bare = tok.replace(/^#/, '');
    const re = kind === 'id'
      ? new RegExp('id\\s*=\\s*["\']' + bare + '["\']|getElementById\\(\\s*["\']' + bare + '["\']')
      : new RegExp('class\\s*=\\s*["\'][^"\']*' + bare);
    assert.ok(re.test(appPage),
      tok + ' is not in ScribeFlow.html; the clinical surfaces this module targets must be the ' +
      'ones the page really renders.');
  });

/* the four defects this module was written for must still be the defects.
   If another lane fixes one upstream, the corresponding rule here becomes dead
   weight and this suite says so rather than going quietly green. */
const engine = read('mls-connect.js');
[
  [/#mlsEz3 \.ez3-fstep\{color:#79837C !important/, true,
   'the equalizer no longer forces #mlsEz3 .ez3-fstep colour with !important'],
  [/#mlsEz3 \.ez3-fstep\.done\{/, false,
   'someone added a #mlsEz3 .ez3-fstep.done rule upstream -- re-check whether the ::before ' +
   'check glyph is still needed, or whether it now doubles a colour fix'],
  [/\.ez3-qchip\.seen\{opacity:\.45;\}/, true,
   '.ez3-qchip.seen is no longer opacity-only; re-check the glyph and the .62 bump'],
  [/#mlsEz3 \.ez3-sm:not\(\.pri\):not\(\.warn\)\{background:/, true,
   '.ez3-sm.warn is no longer excluded from the amber equalizer; the consistency rule here ' +
   'may now be a duplicate'],
  [/\.ez3-prow>\.hd:hover\{background:rgba\(255,255,255,\.05\);?\}/, true,
   'the day row hover is no longer white-5%-on-white; re-check whether the lift is still the fix']
].forEach(([re, want, why]) => {
  assert.strictEqual(re.test(engine), want, why);
});
assert.ok(/\.pt-item\.active\{border-color:var\(--brand\);background:#eaf3ff/.test(appPage),
  'the patient list active row is no longer a blue fill; re-check the var(--soft) rule here');

/* ============ 9. the detectors are proved to fail, both directions ======= */
{
  /* the parser */
  const bad = parse('a{transition:all 1s}@media (hover:hover){b{transform:scale(.9)}}');
  assert.strictEqual(bad.rules.length, 2, 'the parser miscounts style rules');
  assert.strictEqual(bad.rules[1].wrappers.length, 1, 'the parser lost an at-rule wrapper');

  /* the comma splitter must survive var(), cubic-bezier() and :not(:has()) */
  assert.deepStrictEqual(
    splitTop('opacity var(--a,1ms) var(--b,cubic-bezier(.2,.7,.3,1)),transform 1ms'),
    ['opacity var(--a,1ms) var(--b,cubic-bezier(.2,.7,.3,1))', 'transform 1ms'],
    'the comma splitter shreds var() and cubic-bezier()');
  assert.deepStrictEqual(
    splitTop('x:has(> .hd:active):not(:has(button:active)),y[data-a="1,2"]'),
    ['x:has(> .hd:active):not(:has(button:active))', 'y[data-a="1,2"]'],
    'the comma splitter shreds :has()/:not() and attribute selectors, which this module uses');

  /* the layout-property detector */
  const lay = parse('#x{transition:height var(--mls-dur-2) ease}');
  const laid = decls(lay.rules[0].decls)[0];
  assert.strictEqual(laid.prop, 'transition', 'the declaration splitter is broken');
  assert.ok(LAYOUT.indexOf(splitTop(laid.value)[0].split(/\s+/)[0]) > -1,
    'the layout-property detector does not recognise an animated height -- it would pass ' +
    'anything');

  /* the declaration splitter must not break on content:"..." */
  const cd = decls('content:"\\2713";margin-right:5px');
  assert.strictEqual(cd.length, 2, 'the declaration splitter mishandles a quoted content value');

  /* the anti-vacuity detector must reject a name nothing renders */
  assert.strictEqual(proveClass('ez3-fstep-doneish'), null,
    'proveClass() accepted a fabricated class name; the anti-vacuity check would pass a typo');
  assert.strictEqual(proveId('mlsEz3NoSuchHost'), null,
    'proveId() accepted a fabricated id; the anti-vacuity check would pass a typo');
  assert.ok(proveClass('ez3-fstep'), 'proveClass() cannot see a class the app really styles');
  assert.ok(proveId('mlsEz3'), 'proveId() cannot see an id the app really renders');

  /* tokensOf must not turn a pseudo-class into a class token */
  const tk = tokensOf('body.mls-uic #mlsEz3 .ez3-prow:has(> .hd:active):not(:has(button:active))');
  assert.ok(tk.classes.indexOf('has') === -1 && tk.classes.indexOf('active') === -1,
    'tokensOf() leaked a pseudo-class name into the class list: ' + tk.classes.join(', '));
  assert.ok(tk.classes.indexOf('hd') > -1 && tk.ids.indexOf('mlsEz3') > -1,
    'tokensOf() lost a real target inside :has(): ' + JSON.stringify(tk));
  const tk2 = tokensOf('body.mls-uic [contenteditable="true"]');
  assert.ok(tk2.classes.length === 1 && tk2.classes[0] === 'mls-uic',
    'tokensOf() leaked an attribute selector into the class list: ' + tk2.classes.join(', '));
}

console.log('PASS ui-clinical-pass: uc-1.0.0 emits ONE stylesheet (' + CSS.length + ' chars, ' +
  rules.length + ' rules, 0 keyframes) and revert() removes it, the body class and the global; ' +
  'all ' + moving.length + ' moving rules are covered by prefers-reduced-motion (' + killed.size +
  ' selectors killed) and transform is cleared exactly where it is set; the only animated ' +
  'properties are ' + [...animatedProps.keys()].sort().join(' / ') + ' (no layout property, no ' +
  '`all`, no infinite, no fill); the medical record is excluded from animation on ' +
  exclSels.length + ' selectors WITHOUT deleting the ' + textareaTransitions + ' shipped ' +
  'textarea transitions; stand-down covers mls-note-live, mls-recording and the live DOM fact; ' +
  'no timer, no rAF, no observer, one createElement, no listener but DOMContentLoaded, no ' +
  'element.style write, and !important only in the exclusion / stand-down / kill switch; all ' +
  proofs.length + ' selector tokens are proved against the shipped app (' + strong +
  ' by real markup) and the 5 upstream defects it targets are all still present');
