/* A control's label is what a person reads. It is not its textContent.
 *
 * Owner, 2026-07-24: "i ahte this patient banner like wtf is this its aweful".
 * The right-now bar had rendered "Start Recording - Atoussa Salimi7:30 AM",
 * welding the surname onto the time. On a clinical screen that reads as a typo
 * in the patient's NAME, which is the worst possible place to have one.
 *
 * The mechanism is textContent flattening. Measured on the LIVE page at b581,
 * #ptPullAthenaBtn.textContent is 250 characters:
 *
 *   "Pull from AthenaOpens this patient's chart in your signed-in Athena tab
 *    (read-only) and brings their name, DOB and past visits into MLS.READ-ONLY
 *    Opens this patient's chart in your signed-in Athena tab (read-only) and
 *    brings their name, DOB and past visits into MLS."
 *
 * - a display:none sub-label and a role=tooltip pop, the tooltip text twice.
 * controlLabel() on that same live element returns "Pull from Athena · READ-ONLY".
 *
 * Two things were tried before and BOTH were wrong; neither should be retried:
 *   - Adding a separator to the shared label string. The ez3 shell omits one on
 *     purpose (.ez3-big small is display:block, so the patient renders on its
 *     own line there). Editing the string repairs one shell and breaks the other.
 *   - Fixing it in CSS. '#mlsRightNow button small{display:block}' was shipped
 *     and was dead code: the bar assigns textContent, so there is no <small>
 *     element left for a rule to match.
 *
 * So the label has to be derived correctly, centrally, and every DISPLAY site
 * has to use that derivation. This test pins both halves.
 *
 * Matching sites deliberately still use textOf(): trustedGated(), busyMaybe(),
 * spec.label lookups, CTX_MOVED/PT_MOVED and the transcript "0 words" probe all
 * WANT the flattened form, and for the trusted-gesture gate the broader string
 * fails safe (it spotlights rather than clicks). Those are not regressions.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* ------------------------------------------------------ 1. the derivation */

const START = 'function normLabel';
const END = '/* ---------------------------------------------------------------- enable */';
const a = src.indexOf(START);
const b = src.indexOf(END);
assert.ok(a > -1 && b > a, 'could not locate the label-derivation block in feat_mls_calm_shell.js');

/* A minimal node model. Visibility is answered from each node's OWN declared
 * style, exactly as the shell does - never from rects, because measured live
 * every child of a hidden ancestor reports width 0 and offsetParent null, so a
 * rect-based test would call every label empty. */
function text(value) { return { nodeType: 3, nodeValue: value }; }
function el(tagName, opts) {
  const o = opts || {};
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    childNodes: o.children || [],
    _style: o.style || {},
    _attrs: o.attrs || {},
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null; }
  };
  Object.defineProperty(node, 'textContent', {
    get() {
      return node.childNodes.map(c => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    }
  });
  return node;
}

const sandbox = {
  W: {
    getComputedStyle(n) {
      const s = n._style || {};
      return {
        display: s.display || (/^(SMALL|DIV|P|LI|SECTION|BR)$/.test(n.tagName) ? 'block' : 'inline'),
        visibility: s.visibility || 'visible',
        opacity: s.opacity || '1'
      };
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(src.slice(a, b) + '\nthis.controlLabel = controlLabel; this.textOf = textOf;', sandbox);

const controlLabel = sandbox.controlLabel;
const textOf = sandbox.textOf;
assert.strictEqual(typeof controlLabel, 'function', 'controlLabel must exist');

/* The real #ptPullAthenaBtn shape, reproduced from the live DOM at b581. */
const TIP = "Opens this patient's chart in your signed-in Athena tab (read-only) and brings their name, DOB and past visits into MLS.";
const pullBtn = el('button', {
  children: [
    text('📥 Pull from Athena'),
    el('span', { style: { display: 'none' }, children: [text(TIP)] }),
    el('br'),
    el('span', { style: { display: 'block' }, children: [text('READ-ONLY')] }),
    el('span', { style: { display: 'block', visibility: 'hidden', opacity: '0' }, attrs: { role: 'tooltip' }, children: [text(TIP)] })
  ]
});

assert.strictEqual(
  controlLabel(pullBtn), 'Pull from Athena · READ-ONLY',
  'controlLabel must drop the hidden sub-label and the role=tooltip pop, and separate the tag'
);
assert.ok(
  textOf(pullBtn).indexOf('AthenaOpens') > -1,
  'sanity: the raw flattening really does weld - if this stops being true the fixture is stale'
);
assert.ok(
  controlLabel(pullBtn).indexOf(TIP) === -1,
  'a tooltip is text the doctor never chose to read; it must never become a label'
);

/* The ez3 shape: the patient lives in a block <small> with NO separator in the
 * markup, which renders correctly in that shell and welds when flattened. */
const ez3 = el('button', {
  children: [
    text('🎙 Start Recording — Atoussa Salimi'),
    el('small', { children: [text('7:30 AM · DOB 11/05/1968')] })
  ]
});
assert.strictEqual(controlLabel(ez3), 'Start Recording — Atoussa Salimi · 7:30 AM · DOB 11/05/1968');
assert.ok(/Salimi7:30/.test(textOf(ez3)), 'sanity: raw flattening welds the surname onto the time');

/* A plain control must be left exactly alone - no stray separators. */
assert.strictEqual(controlLabel(el('button', { children: [text('Tools')] })), 'Tools');

/* opacity:0 and visibility:hidden are each sufficient on their own. */
['opacity', 'visibility'].forEach((prop) => {
  const style = prop === 'opacity' ? { opacity: '0' } : { visibility: 'hidden' };
  const btn = el('button', { children: [text('Send'), el('span', { style, children: [text('SECRET')] })] });
  assert.strictEqual(controlLabel(btn), 'Send', 'a ' + prop + '-hidden child must not reach the label');
});

/* ------------------------------------------------- 2. every display site */

const displaySites = [
  {
    what: 'right-now button label',
    line: 'b.textContent = p.as || controlLabel(p.el);'
  },
  {
    what: 'right-now alias tooltip',
    line: 'if (p.as) b.title = \'Runs "\' + controlLabel(p.el) + \'" on this screen\';'
  },
  {
    what: 'segmented view tab label',
    line: "s.textContent = controlLabel(tab).replace(/\\s*\\d+$/, '');"
  },
  {
    what: 'right-now re-render signature',
    line: "picked.map(function (p) { return (p.as || controlLabel(p.el)) + (p.primary ? '!' : ''); }).join(',');"
  }
];

displaySites.forEach((site) => {
  assert.ok(
    src.indexOf(site.line) > -1,
    'the ' + site.what + ' must derive its text through controlLabel().\nExpected to find:\n  ' + site.line
  );
});

/* The signature and the rendered label must agree. If the signature is computed
 * from a different string than the one shown, the bar can churn when a hidden
 * tooltip changes, or fail to rebuild when two controls flatten to the same
 * text but read differently. */
assert.ok(
  src.indexOf("picked.map(function (p) { return (p.as || textOf(p.el))") === -1,
  'the re-render signature must not use textOf() while the button uses controlLabel()'
);

/* ------------------------------------- 3. a proxy is not the control ----- */

/* The label derivation was already correct and the bar STILL rendered prose.
 * Measured on the running page at b586, the right-now button's text node was
 * exactly "Pull from Athena" - controlLabel() had done its job - and
 * feat_athena_clarity.js had then appended a VISIBLE 300px .mlsac-sub paragraph,
 * a <br> and a READ-ONLY chip INTO the shell's button, because decorateOne()
 * matches any control whose textContent starts with a catalog label.
 *
 * This arm exists because the label layer CANNOT fix that, and the next person
 * will be tempted to try. Here is the proof: when the decorator's sub-label is
 * visible (which it is inside the bar - the display:none only applies on the
 * real control's own surface), controlLabel correctly includes it, because a
 * visible child IS part of what the button reads. */
const decoratedProxy = el('button', {
  attrs: { 'data-mls-proxy': '1' },
  children: [
    text('Pull from Athena'),
    el('span', { style: { display: 'block' }, children: [text(TIP)] }),   // .mlsac-sub, VISIBLE here
    el('br'),
    el('span', { style: { display: 'block' }, children: [text('READ-ONLY')] })
  ]
});
assert.ok(
  controlLabel(decoratedProxy).indexOf(TIP) > -1,
  'sanity: once the decorator has injected a VISIBLE sub-label, no label function can drop it - ' +
  'which is why the fix belongs in the decorator, not here'
);

const shell = src;
const clarity = fs.readFileSync(path.join(root, 'feat_athena_clarity.js'), 'utf8');

assert.ok(
  shell.indexOf("b.setAttribute('data-mls-proxy', '1');") > -1,
  'the right-now bar must mark its synthesised buttons as proxies'
);
assert.ok(
  shell.indexOf("s.setAttribute('data-mls-proxy', '1');") > -1,
  'the segmented view tabs must mark their synthesised buttons as proxies'
);
assert.ok(
  clarity.indexOf("btn.closest('[data-mls-proxy]')") > -1,
  'feat_athena_clarity must refuse to decorate a shell proxy - it matches controls by ' +
  'textContent PREFIX, so it decorated the toolbar reference as if it were the real control'
);

/* The guard has to run before the catalog match, otherwise a proxy still gets
 * data-mlsac stamped on it and reads as decorated to everything downstream. */
const decorateStart = clarity.indexOf('function decorateOne(btn)');
const guardAt = clarity.indexOf("btn.closest('[data-mls-proxy]')", decorateStart);
const matchAt = clarity.indexOf('matchEntry(btn)', decorateStart);
assert.ok(decorateStart > -1 && guardAt > -1 && matchAt > guardAt,
  'the proxy guard must run before matchEntry() stamps the control as decorated');

/* --------------------------------- 4. escape exactly once, at the source --- */

/* Same family as the welding above: text a doctor reads, mangled on its way to
 * the screen. feat_mls_patientpick.js:481 held the literal "today&#39;s schedule"
 * - already HTML-escaped - and then passed it through esc(), which escaped the
 * leading & again to &amp;. The browser parses "&amp;#39;" back to the visible
 * characters &#39;, so the picker note read "122 patients on today&#39;s schedule".
 *
 * That shipped with a workaround module, feat_mls_caption_entityfix.js, which
 * observed document.documentElement with {childList,subtree,characterData} for
 * the LIFETIME OF THE SESSION - the most expensive observer kind there is, woken
 * by every text change anywhere in the app - to repair one apostrophe. Fixing the
 * source retired that observer (boot-script-budget arm C: 60 -> 59).
 *
 * Pin the source, not the workaround: a pre-escaped literal must never be handed
 * to esc(). Raw-HTML uses of &#39; that never touch esc() (lines 535, 682) are
 * correct and deliberately not covered here. */
const pick = fs.readFileSync(path.join(root, 'feat_mls_patientpick.js'), 'utf8');
const escCalls = pick.match(/esc\([^)]*\)/g) || [];
const doubleEscaped = escCalls.filter((c) => /&(?:#\d+|amp|quot|lt|gt);/.test(c));
assert.deepStrictEqual(
  doubleEscaped, [],
  'a pre-escaped HTML entity is being passed through esc(), which escapes its & again ' +
  'and renders the raw entity to the doctor:\n  ' + doubleEscaped.join('\n  ')
);

console.log('shell-label-authority-contract: OK (' + displaySites.length +
  ' display sites, 7 derivation cases, proxy guard, escape-once)');
