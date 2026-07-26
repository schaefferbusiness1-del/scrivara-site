'use strict';
/*
 * Anything feat_mls_calm_views.js FOLDS must keep a route to it.
 *
 * This is the sibling of tests/shell-hidden-controls-keep-reach.js, which
 * guards the Calm Shell's global folds. The shell sends what it hides to the
 * Tools menu, which is right for capabilities; these are view-local chrome (a
 * date range, a refresh, a duplicate scrubber) and their route is a disclosure
 * button in the same view. Either way the rule is identical and it is the
 * owner's standing rule: ease of use WITHOUT losing features.
 *
 * THREE things are checked, because each has a different way of failing
 * silently:
 *
 *   1. Every view that folds anything declares a disclosure. A fold with no
 *      `more` is a deleted feature.
 *   2. Hiding is by CLASS under body.mls-cv, never inline. available() in the
 *      shell reads inline display, so an inline hide removes a control from the
 *      Ask index and the control inventory as well as from the screen.
 *   3. The module carries the RUNTIME invariant "a fold whose disclosure is not
 *      visible unfolds itself". A static list cannot catch the failure that
 *      actually happened here: analysisView's disclosure mounted into a card
 *      that the view's own rebuild module had already replaced, so the button
 *      existed, had an onclick, and had rect 0x0 — every existence check passed
 *      and the folded control had no route at all. Only a rect read catches it,
 *      and that has to live in the shipped code, not in this file.
 *
 * Proven in both directions before being trusted, per the b669 rule: removing
 * a `more:` declaration fails check 1, replacing a class fold with an inline
 * one fails check 2, deleting the visibility guard fails check 3, and the real
 * tree passes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_calm_views.js'), 'utf8');

/* ---- parse the config: each view's key, its folds, and whether it has a more */
const VIEW_BLOCK = /\{\s*\n\s*key:\s*'([a-z]+)',\s*\n\s*id:\s*'([A-Za-z]+)',([\s\S]*?)\n    \}(?=,\n|\n)/g;
const views = [];
let m;
while ((m = VIEW_BLOCK.exec(src))) {
  const body = m[3];
  const foldBlock = /fold:\s*\[([\s\S]*?)\]/.exec(body);
  const folds = foldBlock
    ? (foldBlock[1].match(/'([^']+)'/g) || []).map(s => s.slice(1, -1))
    : [];
  views.push({ key: m[1], id: m[2], folds, hasMore: /more:\s*\{/.test(body) });
}
assert(views.length >= 3, 'the calm-views config no longer parses — found ' + views.length + ' views. If the shape changed, change this parser deliberately; do not delete the check.');

/* ---- 1. every fold has a disclosure ---------------------------------------- */
const stranded = views.filter(v => v.folds.length && !v.hasMore);
assert.deepStrictEqual(stranded.map(v => v.key), [],
  'these views fold controls with no "more" disclosure, so the folded controls have no route back: ' + stranded.map(v => v.key).join(', '));

/* every fold selector must be scoped to its own view, or it can hide another
   worker's screen from a config nobody would think to read */
for (const v of views) {
  for (const sel of v.folds) {
    assert(sel.indexOf('#' + v.id) === 0,
      v.key + ' folds "' + sel + '", which is not scoped to #' + v.id + ' — a fold must not reach outside its own view');
  }
}

/* ---- 2. hidden by class, under the body gate, never inline ----------------- */
assert(/hide\.push\('body\.' \+ BODY_CLASS \+ ':not\(\.mls-cv-open-'/.test(src),
  'folds are no longer emitted as body-class CSS rules gated on the per-view open class');
assert(/display:none!important/.test(src),
  'the fold rule dropped !important — the calendar and studio build these nodes with INLINE display, which beats any stylesheet rule regardless of specificity, and the fold silently does nothing');
assert(!/\.style\.display\s*=\s*'none'/.test(src),
  'something in this module hides a control INLINE. available() reads inline display, so an inline hide removes the control from the Ask index and the control inventory as well as from the screen — hide by class.');

/* ---- 3. the runtime invariant is present ----------------------------------- */
const mountMore = src.slice(src.indexOf('function mountMore('), src.indexOf('function isOpen('));
assert(/var shown = visible\(b\)/.test(mountMore) && /if \(!shown && !isOpen\(v\)\)/.test(mountMore),
  'the "a fold whose disclosure is not visible unfolds itself" guard is gone. Existence checks pass on a rect-0x0 button; only a rect read catches an anchor that a view rebuild has replaced.');
assert(/classList\.add\('mls-cv-open-' \+ v\.key\)/.test(mountMore),
  'the invisible-disclosure guard no longer actually unfolds the view');
/* and it must be able to UN-fire. A one-way safety valve is a defect wearing a
   safety valve's clothes: a disclosure that is briefly unrendered (a narrow
   viewport, a mid-render frame) latched AI Studio permanently open at 33
   controls where the fold measures 17. */
assert(/else if \(shown && autoOpened\[v\.key\]\)/.test(mountMore) && /classList\.remove\('mls-cv-open-' \+ v\.key\)/.test(mountMore),
  'the invisible-disclosure guard is one-way again — once it opens a view nothing re-folds it');
assert(/autoOpened\[v\.key\] = false;\s*\/\* an explicit press is the doctor's/.test(src),
  'the auto-open withdrawal no longer distinguishes its own open from a press by the doctor, so it will re-fold a view the doctor deliberately opened');

/* ---- 4. the escape hatch survives ------------------------------------------ */
assert(/ui=classic/.test(src), 'the ?ui=classic escape hatch is gone');
assert(/revert:\s*function/.test(src), 'window.__mlsCalmViews.revert() is gone');

console.log('PASS calm views: ' + views.length + ' views, every fold class-hidden under body.mls-cv with a same-view disclosure, invisible-disclosure guard present, classic + revert intact');
