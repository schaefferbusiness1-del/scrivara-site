'use strict';

/* feat_mls_ui_shell.js — the shell and dialog quality pass, policed.
 *
 * This gate EXECUTES the module and reads the stylesheet it actually emits. It
 * does not grep the source for rule text, because a rule can be present in the
 * source and never reach the sheet (a wrapper typo, a table row that hoists as
 * undefined) and that failure mode has already shipped in this repo once.
 *
 * Seven things are asserted, in descending order of how much they have cost:
 *
 *   1. ANTI-VACUITY. Every rule declares the strings from ScribeFlow.html that
 *      justify it, and every one must be present VERBATIM. A selector that
 *      matches nothing is the most common way a visual pass fails, and it is
 *      indistinguishable from a shipped fix. Every id and class token in every
 *      emitted selector is separately checked against the app source.
 *   2. THE CLIPPING REGRESSION. `#opPrepModal.opr-room .modal` was a DESCENDANT
 *      selector that reached a NESTED modal card and handed it height:100dvh +
 *      overflow:hidden, putting the Close button at y=1543 with 95px of
 *      available scroll. The owner reported it twice. So: no rule in this file
 *      may take .modal or .modal-bg as its subject, and no rule anywhere in the
 *      sheet may set height / max-height / display / overflow at all.
 *      .modal{max-height:90vh;overflow:auto} is load-bearing.
 *   3. REDUCED MOTION IS DERIVED. Every selector in the MOVING table must
 *      appear in the generated off-switch. If the generator is replaced with a
 *      hand-written block, this fails. The table is currently EMPTY on purpose
 *      (the shell already animates; see the module header), so this gate also
 *      enforces the stronger form of the same promise: with nothing in the
 *      table, the emitted sheet must contain no transition or animation
 *      declaration at ALL, and must not ship an off-switch it does not need.
 *      Both branches are exercised — see the non-vacuity run in the report.
 *   4. NOTHING ANIMATES LAYOUT. Every transition/animation value is scanned for
 *      layout-triggering properties.
 *   5. NO TIMER, NO FRAME LOOP, NO DOCUMENT WATCHER. The boot budget counts
 *      both interval and document-observer registrations against ceilings that
 *      are already at their limit.
 *   6. FOCUS STAYS VISIBLE. No rule may remove an outline without replacing it.
 *   7. HOVER IS POINTER-GATED, and any decorative layer is click-transparent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const MODULE_FILE = 'feat_mls_ui_shell.js';
const src = fs.readFileSync(path.join(root, MODULE_FILE), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ------------------------------------------------------------------ run it --
   A minimal document stand-in: enough for the module to install its sheet and
   its body class, and nothing more. If the module ever needs more than this it
   has stopped being a presentation-only satellite. */

function fakeDoc() {
  const nodes = {};
  const head = {
    children: [],
    appendChild(n) { this.children.push(n); n.parentNode = this; },
    removeChild(n) {
      const i = this.children.indexOf(n);
      assert(i >= 0, 'removeChild() called for a node this head does not own');
      this.children.splice(i, 1); n.parentNode = null; return n;
    }
  };
  const classes = [];
  return {
    doc: {
      readyState: 'complete',
      head,
      documentElement: head,
      body: {
        classList: {
          contains: (c) => classes.indexOf(c) >= 0,
          toggle: (c, force) => {
            const i = classes.indexOf(c);
            if (force === true && i < 0) classes.push(c);
            if (force === false && i >= 0) classes.splice(i, 1);
            return classes.indexOf(c) >= 0;
          }
        }
      },
      createElement: () => ({ id: '', textContent: '', parentNode: null }),
      getElementById: (id) => nodes[id] || null,
      addEventListener: () => {}
    },
    nodes, head, classes
  };
}

const env = fakeDoc();
const context = {
  window: {},
  document: env.doc,
  console
};
context.window.document = env.doc;
vm.createContext(context);
vm.runInContext(src, context, { filename: MODULE_FILE });

const api = context.window.__mlsUiShell;
assert(api, 'feat_mls_ui_shell.js did not install window.__mlsUiShell');
assert(typeof api._css === 'function', 'the module does not expose its CSS builder, so this gate cannot read what shipped');
assert(typeof api.revert === 'function', 'window.__mlsUiShell.revert() is gone');
assert.strictEqual(env.head.children.length, 1, 'the module must inject exactly one <style> element');
assert.strictEqual(env.head.children[0].id, 'mlsUiShellCss', 'the injected sheet lost its stable id, so it can be injected twice');
assert(env.classes.indexOf('mls-uish') >= 0, 'the body class every rule is scoped to was not added');

/* Idempotence: a second evaluation must not add a second sheet. */
env.nodes.mlsUiShellCss = env.head.children[0];
vm.runInContext(src, context, { filename: MODULE_FILE });
assert.strictEqual(env.head.children.length, 1, 'the module is not idempotent — a second load injected a second sheet');

const CSS = api._css();
const STATIC = api._static();
const MOVING = api._moving();
assert(CSS.length > 200, 'the emitted stylesheet is suspiciously small');
assert(STATIC.length >= 6, 'the static rule table has been gutted');

/* ------------------------------------------------------------- rule parser --
   Flatten the sheet into {selector, decls} pairs, walking at-rule wrappers.
   Written by hand rather than with a CSS library so this gate has no
   dependency (the suite runs on a bare node with no node_modules). */

function flatten(css) {
  const rules = [];
  let i = 0;
  function block(endAt) {
    let buf = '';
    while (i < css.length) {
      const ch = css[i];
      if (ch === '{') {
        const sel = buf.trim(); buf = ''; i++;
        if (sel.charAt(0) === '@') {
          block(true);                       /* an at-rule wrapper: recurse */
        } else {
          let decls = '';
          while (i < css.length && css[i] !== '}') { decls += css[i]; i++; }
          i++;
          rules.push({ selector: sel, decls: decls.trim() });
        }
        continue;
      }
      if (ch === '}') { i++; if (endAt) return; continue; }
      buf += ch; i++;
    }
  }
  block(false);
  return rules;
}

const rules = flatten(CSS);
assert(rules.length >= STATIC.length + MOVING.length,
  'the flattened sheet has fewer rules than the tables declare — rows are not reaching the stylesheet');

/* Split a selector list on top-level commas (never inside :is()/:not()). */
function selectorList(sel) {
  const out = []; let depth = 0, buf = '';
  for (let k = 0; k < sel.length; k++) {
    const c = sel[k];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/* The SUBJECT of a complex selector: the last compound, i.e. everything after
   the final top-level combinator. Parenthesised groups are skipped so
   `:is(a, b)` cannot be mistaken for a combinator boundary. */
function subject(one) {
  let depth = 0, cut = 0;
  for (let k = 0; k < one.length; k++) {
    const c = one[k];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) cut = k + 1;
  }
  return one.slice(cut).trim();
}

function hasProp(decls, names) {
  return new RegExp('(^|;)\\s*(' + names.join('|') + ')\\s*:', 'i').test(decls);
}

/* ============================================================ 1. ANTI-VACUITY
   The single most important assertion in this file. */

let evidenceCount = 0;
[].concat(STATIC, MOVING).forEach((row) => {
  const sel = row[0];
  const ev = row[2];
  assert(Array.isArray(ev) && ev.length,
    'rule `' + sel + '` ships with no evidence from ScribeFlow.html. Every selector must be ' +
    'justified by a string that is actually in the app.');
  ev.forEach((needle) => {
    assert(app.indexOf(needle) >= 0,
      'rule `' + sel + '` claims ScribeFlow.html contains:\n    ' + JSON.stringify(needle) +
      '\nIt does not. Either the app changed and this rule now matches nothing, or the ' +
      'evidence was never checked.');
    evidenceCount++;
  });
});
assert(evidenceCount >= 12, 'the evidence set shrank — rules are being added without proof');

/* Every id and class token in every EMITTED selector must exist in the app
   source. Ids must appear as a real id attribute; classes may be toggled at
   runtime, so they are accepted from the app markup or from the app own CSS. */

const OWN_TOKENS = ['mls-uish'];          /* the one class this module itself adds */
const idTok = /#([A-Za-z][\w-]*)/g;
const clsTok = /\.(-?[A-Za-z_][\w-]*)/g;

rules.forEach(({ selector }) => {
  let m;
  idTok.lastIndex = 0;
  while ((m = idTok.exec(selector))) {
    assert(app.indexOf('id="' + m[1] + '"') >= 0,
      'selector `' + selector + '` targets #' + m[1] + ', which is not an id in ScribeFlow.html. ' +
      'Runtime-built ids are out of scope for this module precisely because they cannot be proven here.');
  }
  clsTok.lastIndex = 0;
  while ((m = clsTok.exec(selector))) {
    const c = m[1];
    if (OWN_TOKENS.indexOf(c) >= 0) continue;
    const inMarkup = new RegExp('class="[^"]*\\b' + c.replace(/[-]/g, '\\-') + '\\b').test(app);
    const inCss = new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])').test(app);
    assert(inMarkup || inCss,
      'selector `' + selector + '` targets .' + c + ', which appears nowhere in ScribeFlow.html ' +
      '(neither as a class attribute nor in the app own stylesheet). This rule can never match.');
  }
});

/* ==================================================== 2. THE CLIPPING GUARD
   `.modal{max-height:90vh;overflow:auto}` is load-bearing. A descendant rule
   once reached a NESTED card and hid its Close button below the fold. */

const BOX = ['height', 'max-height', 'min-height', 'display', 'overflow', 'overflow-x', 'overflow-y', 'flex-direction'];
const CLIP = ['height', 'max-height', 'display', 'overflow', 'overflow-x', 'overflow-y'];

rules.forEach(({ selector, decls }) => {
  selectorList(selector).forEach((one) => {
    const subj = subject(one);
    const isModal = /(^|[^#\w-])\.modal(-bg)?(?![\w-])/.test(subj);
    assert(!isModal,
      'rule `' + one + '` takes a modal card as its SUBJECT. This module is not allowed to style ' +
      '.modal or .modal-bg directly — that is the shape of the live regression where a rule ' +
      'clipped a nested dialog and the owner could not reach Close.');
    if (isModal) {
      assert(!hasProp(decls, CLIP), 'rule `' + one + '` clips a .modal');
    }
  });
  /* Belt to those braces: nothing in this sheet may set a clipping property on
     anything at all. min-height is allowed (it can only grow a control). */
  assert(!hasProp(decls, CLIP),
    'rule `' + selector + '` sets one of ' + CLIP.join('/') + '. No rule in this presentation ' +
    'pass may set a clipping property anywhere: `{' + decls + '}`');
});
/* min-height is the one box property this file may use, and only to raise a
   tap target. Assert it never appears on a modal-ish subject. */
rules.filter(r => hasProp(r.decls, ['min-height'])).forEach(({ selector, decls }) => {
  selectorList(selector).forEach((one) => {
    assert(!/(^|[^#\w-])\.modal(-bg)?(?![\w-])/.test(subject(one)),
      'min-height landed on a modal card: `' + one + '{' + decls + '}`');
  });
  assert(/min-height:\s*\d+px/.test(decls), 'min-height must be an explicit px floor: {' + decls + '}');
});
void BOX;

/* ================================================ 3. REDUCED MOTION DERIVED */

const rmStart = CSS.indexOf('@media (prefers-reduced-motion:reduce)');

if (MOVING.length === 0) {
  /* The stronger promise: nothing moves at all. There is then nothing for an
     off-switch to switch off, and shipping one would make the sheet read as if
     it animated something. */
  assert.strictEqual(rmStart, -1,
    'the MOVING table is empty but the sheet still ships a reduced-motion off-switch. Either a ' +
    'moving rule was removed without removing its kill switch, or the kill switch is now ' +
    'hand-written rather than derived.');
  rules.forEach(({ selector, decls }) => {
    assert(!/(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(decls),
      'rule `' + selector + '` declares motion but the MOVING table is empty, so no ' +
      'prefers-reduced-motion off-switch was generated for it: {' + decls + '}');
  });
  assert(!/@keyframes/.test(CSS), 'the sheet declares keyframes with an empty MOVING table');
} else {
  assert(rmStart >= 0, 'the prefers-reduced-motion off-switch is missing from the emitted sheet');
  const rmBlock = CSS.slice(rmStart);
  MOVING.forEach((row) => {
    assert(rmBlock.indexOf(row[0]) >= 0,
      'moving selector `' + row[0] + '` has no entry in the reduced-motion off-switch. The block ' +
      'must be GENERATED from the MOVING table, never hand-written.');
  });
  assert(/animation:none!important/.test(rmBlock) && /transition:none!important/.test(rmBlock),
    'the off-switch no longer clears both animation and transition');
  /* And nothing outside the MOVING table may declare motion. */
  const movingSelectors = MOVING.map(r => r[0]);
  rules.forEach(({ selector, decls }) => {
    if (!/(^|;)\s*(transition|animation)(-[a-z-]+)?\s*:/.test(decls)) return;
    if (/animation:none!important/.test(decls) || /transition:none!important/.test(decls)) return;
    assert(movingSelectors.indexOf(selector) >= 0,
      'rule `' + selector + '` declares motion but is not in the MOVING table, so the off-switch ' +
      'cannot reach it.');
  });
}

/* ============================================= 4. NOTHING ANIMATES LAYOUT */

const LAYOUT = /\b(height|width|top|left|right|bottom|margin|padding|inset|flex-basis)\b/;
rules.forEach(({ selector, decls }) => {
  const m = decls.match(/(?:^|;)\s*(?:transition|animation)\s*:\s*([^;]+)/gi) || [];
  m.forEach((decl) => {
    const value = decl.replace(/^[^:]*:/, '');
    assert(!LAYOUT.test(value),
      'rule `' + selector + '` animates a layout-triggering property: ' + decl.trim() +
      '. Only transform/opacity/colour/border/shadow may move.');
  });
});

/* ============================== 5. NO TIMER, NO FRAME LOOP, NO DOM WATCHER */

['setInterval', 'setTimeout', 'requestAnimationFrame', 'MutationObserver',
 'ResizeObserver', 'IntersectionObserver'].forEach((tok) => {
  assert(src.indexOf(tok) < 0,
    MODULE_FILE + ' mentions ' + tok + '. This app was measured wedging the main thread for ' +
    'minutes; the boot budget counts interval and document-observer registrations against ' +
    'ceilings that are already at their limit, and the cheapest way to be safe is to need neither.');
});
/* Presentation only: no markup may be rewritten and no handler rebound. */
['innerHTML', 'outerHTML', 'appendChild(', 'removeChild', 'insertBefore', 'setAttribute'].forEach((tok) => {
  if (tok === 'appendChild(' || tok === 'removeChild') return;   /* the sheet itself */
  assert(src.indexOf(tok) < 0, MODULE_FILE + ' touches markup via ' + tok + '; this pass is CSS only.');
});
assert((src.match(/createElement\(/g) || []).length === 1,
  MODULE_FILE + ' creates more than one element. It may create exactly one <style>.');

/* ================================================ 6. FOCUS STAYS VISIBLE */

rules.forEach(({ selector, decls }) => {
  if (/outline\s*:\s*(none|0)\b/i.test(decls) || /outline-width\s*:\s*0/i.test(decls)) {
    assert(/box-shadow\s*:\s*[^;]*\d/.test(decls) || /outline\s*:\s*[^;]*\dpx/.test(decls),
      'rule `' + selector + '` removes an outline without a visible replacement: {' + decls + '}');
  }
});
const focusRules = rules.filter(r => /:focus-visible/.test(r.selector));
assert(focusRules.length >= 2,
  'the focus-visible rules are gone. ScribeFlow.html declares :focus-visible exactly once ' +
  '(.hist-item), so dialog buttons rely on this module for a visible keyboard ring.');
focusRules.forEach(({ selector, decls }) => {
  assert(/outline\s*:\s*[23456]px\s+solid/.test(decls),
    'focus rule `' + selector + '` no longer draws an outline of at least 2px: {' + decls + '}');
});

/* ================================ 7. HOVER IS POINTER-GATED, LAYERS INERT */

const hoverWrapped = /@media \(hover:hover\) and \(pointer:fine\)\{[^]*?\}\}/;
const hoverRules = rules.filter(r => /:hover/.test(r.selector));
assert(hoverRules.length >= 1, 'the hover affordance on the dialog exit is gone');
hoverRules.forEach(({ selector }) => {
  const at = CSS.indexOf(selector + '{');
  const before = CSS.slice(0, at);
  const lastOpen = before.lastIndexOf('@media (hover:hover) and (pointer:fine){');
  assert(lastOpen >= 0 && before.indexOf('}', lastOpen) < 0,
    'hover rule `' + selector + '` is not inside @media (hover:hover) and (pointer:fine). On a ' +
    'touch screen a hover state sticks after a tap.');
});
void hoverWrapped;

rules.forEach(({ selector, decls }) => {
  if (/::(before|after)/.test(selector) && /content\s*:/.test(decls)) {
    assert(/pointer-events\s*:\s*none/.test(decls),
      'decorative layer `' + selector + '` is not pointer-events:none. This app has a history of ' +
      'invisible overlays eating clicks.');
  }
});

/* ============================================================ 8. REVERTIBLE */

api.revert();
assert.strictEqual(env.head.children.length, 0, 'revert() left the stylesheet in the document');
assert.strictEqual(env.classes.indexOf('mls-uish'), -1, 'revert() left the body class behind');
assert(!context.window.__mlsUiShell, 'revert() left window.__mlsUiShell installed');

/* ================================================== 9. IT STAYS IN ITS LANE
   The clinical surfaces belong to another pass. Nothing here may reach the
   note, the transcript, or the visit screen. */
['#noteBox', '#noteCard', '#transcript', '#visitView', '#ez3Wrap', '#visitOrdersBody',
 'textarea', 'contenteditable'].forEach((tok) => {
  assert(CSS.indexOf(tok) < 0,
    'the emitted sheet reaches ' + tok + '. The clinical surfaces are owned by a different pass, ' +
    'and nothing the doctor is reading or typing may be restyled from here.');
});



console.log('PASS ui shell pass: ' + rules.length + ' rules, ' + evidenceCount +
  ' verbatim app-source proofs, ' + MOVING.length + ' moving selector(s)' +
  (MOVING.length ? ' all in the generated reduced-motion off-switch' :
   ' and zero transition/animation declarations anywhere') +
  ', no clipping property and no .modal subject, no timer/observer, ' +
  focusRules.length + ' focus rings added and none removed');
