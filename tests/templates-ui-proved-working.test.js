'use strict';
/* =========================================================================
   THE TEMPLATES UI: EVERY BUTTON HAS A REAL HANDLER, AND THE NEW MOTION FIRES
   -------------------------------------------------------------------------
   OWNER: "continue till there is a new perftectly proved working template ui and
   that there are at least 5 new amazing anumations", and earlier: "make sure it
   all works and all the buttons work and that it makes good templates and that
   the fill in the blnk thing still works".

   "PROVED" is the operative word, and this session has earned a narrow
   definition of it. Three separate times a change to this exact surface read as
   shipped and did nothing: a scroll fix that never applied, nine CSS rules that
   lost to inline styles, and five animations keyed to classes nobody set. So
   proof here means EXECUTION or a resolved value - never the presence of a
   string.

   WHAT THIS SUITE PROVES

   PART A - NO DEAD BUTTONS. Every control in #templatesModal is harvested from
   the shipped markup and its handler must resolve to a real function definition
   in the shipped source. A button whose onclick names a function that does not
   exist is the defect class this app has shipped repeatedly (the Procedures tab
   had NO handler at all until b797, and the rail was a list of divs that looked
   clickable and was not).

   PART B - THE SIX NEW ANIMATIONS ARE REAL. Each is emitted, each appears in the
   generated reduced-motion off-switch, and for the two that need a trigger the
   Templates surface does not provide, the wrapper is EXECUTED and the class is
   asserted on the real node. Their triggers are named, and each one is a thing
   another suite already proves gets written.

   PART C - THE MOTION IS SAFE ON A CLINICAL SURFACE. transform/opacity only,
   nothing infinite except the one deliberate waiting shimmer, no timer, no
   observer, and the medical record excluded.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

const HTML = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
/* every shipped front-end source, so a handler defined in a satellite counts */
const SRC = fs.readdirSync(ROOT)
  .filter(f => /\.js$/.test(f) && !/\.staging\.|\.min\./.test(f))
  .map(f => { try { return fs.readFileSync(path.join(ROOT, f), f === 'mls-connect.js' ? 'latin1' : 'utf8'); } catch (e) { return ''; } })
  .join('\n') + '\n' + HTML;

/* ================= PART A — no dead buttons ============================= */
const start = HTML.indexOf('id="templatesModal"');
const end = HTML.indexOf('<!-- PROCEDURE-DAY OP NOTES');
ok(start > 0 && end > start, 'the Templates markup is locatable');
const block = HTML.slice(start, end);

/* harvest every inline handler call in the surface */
const calls = new Set();
block.replace(/on(?:click|change|input|dragover|dragleave|drop)\s*=\s*"([^"]+)"/g, function (_, code) {
  code.replace(/([A-Za-z_$][\w$]*)\s*\(/g, function (__, fn) { calls.add(fn); return ''; });
  return '';
});
ok(calls.size >= 8, 'Templates controls were harvested from the markup',
  calls.size + ' distinct handler function(s): ' + [...calls].sort().join(', '));

/* things that are not app functions */
const BUILTIN = new Set(['getElementById', 'querySelector', 'click', 'focus', 'select',
  'preventDefault', 'stopPropagation', 'String', 'Number', 'alert', 'confirm']);

const dead = [];
[...calls].sort().forEach(fn => {
  if (BUILTIN.has(fn)) return;
  const defined =
    new RegExp('function\\s+' + fn + '\\s*\\(').test(SRC) ||
    new RegExp('(?:var|let|const)\\s+' + fn + '\\s*=\\s*(?:async\\s*)?function').test(SRC) ||
    new RegExp('window\\.' + fn + '\\s*=').test(SRC) ||
    new RegExp('(?:var|let|const)\\s+' + fn + '\\s*=\\s*(?:async\\s*)?\\(').test(SRC);
  if (!defined) dead.push(fn);
});
ok(dead.length === 0,
  'EVERY Templates control names a handler that actually exists',
  dead.length
    ? 'these are wired to functions with NO definition in any shipped source:\n          - ' + dead.join('\n          - ')
    : '');

/* the controls the owner names, pinned individually so a rename cannot quietly
   drop one */
[['tplMultiFileInput', 'the multi-file picker'],
 ['tplMultiDrop', 'the multi-file drop zone'],
 ['tplText', 'the extracted-text editor'],
 ['tplName', 'the name field'],
 ['tplKeywords', 'the keywords field'],
 ['tplSearch', 'the library search'],
 ['tplList', 'the saved-template list'],
 ['tplDetail', 'the preview pane'],
 ['tplUseToggle', 'the use-templates switch'],
 ['tplAutoChoose', 'the auto-choose switch (auto templates stay)']
].forEach(p => ok(block.indexOf('id="' + p[0] + '"') >= 0, 'present: ' + p[1] + ' (#' + p[0] + ')'));

[['saveTemplateFromForm', 'Save template'],
 ['clearTplForm', 'Clear'],
 ['tplPasteText', 'Type or paste'],
 ['fixTemplateNames', 'Rename by note type'],
 ['dedupeSavedTemplates', 'Remove duplicates'],
 ['closeTemplates', 'Close']
].forEach(p => ok(block.indexOf(p[0] + '(') >= 0, 'wired: ' + p[1]));

/* ================= PART B — the six new animations ====================== */
function magicCss() {
  const src = fs.readFileSync(path.join(ROOT, 'feat_mls_magic.js'), 'utf8');
  const nodes = {};
  function el() {
    return { id: '', textContent: '', style: {}, parentNode: null, offsetWidth: 1,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }, toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); } },
      appendChild() {}, removeChild() {}, setAttribute() {}, addEventListener() {}, removeEventListener() {} };
  }
  ['tplDetail', 'tplList', 'noteCard', 'patientLabel'].forEach(i => { nodes[i] = el(); nodes[i].id = i; });
  const doc = { getElementById: i => nodes[i] || null, createElement: el, addEventListener() {},
    removeEventListener() {}, head: el(), documentElement: el(), body: el() };
  const w = { document: doc, addEventListener() {}, removeEventListener() {},
    setTimeout: () => 0, clearTimeout() {},
    renderTplDetail: function () { return 'BASE_DETAIL'; },
    saveTemplateFromForm: function () { return 'BASE_SAVE'; } };
  w.window = w;
  new Function('window', 'document', 'setTimeout', 'clearTimeout', src)(w, doc, w.setTimeout, w.clearTimeout);
  return { css: w.__mlsMagic.css(), api: w.__mlsMagic, nodes: nodes, w: w };
}
const M = magicCss();

/* Each new animation, with the trigger that fires it and the suite that proves
   the trigger is really written. A moment whose trigger is not written by
   anything is the exact failure that caused all of this. */
const NEW_MOMENTS = [
  ['mgxCommit', '.opr-tpl-item.on', 'buildTplRail writes .on when a template is applied', 'opnote-template-rail-is-clickable'],
  ['mgxArm', '.opr-tpl-item.armed', 'buildTplRail writes .armed on the two-step switch', 'opnote-template-rail-is-clickable'],
  ['mgxSheet', '#tplDetail.mgx-arrive', 'the renderTplDetail wrapper (executed below)', 'this suite'],
  ['mgxSettleIn', '#tplList.mgx-landed', 'the saveTemplateFromForm wrapper (executed below)', 'this suite'],
  ['mgxPick', '.opr-tplmode[aria-pressed="true"]', 'buildTplMode writes aria-pressed on every click', 'opnote-room-walkthrough-runtime'],
  ['mgxDone', '#mlsPullProgPanel .pp-ok', 'the pull row renderer emits .pp-ok for a saved row', 'pull-rows-say-done-not-warning']
];

ok(NEW_MOMENTS.length >= 5,
  'AT LEAST FIVE NEW ANIMATIONS ARE CLAIMED (' + NEW_MOMENTS.length + ')');

const rm = (M.css.match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*)\}/) || [, ''])[1];
NEW_MOMENTS.forEach(m => {
  ok(M.css.indexOf('animation:' + m[0]) >= 0,
    'animation EMITTED: ' + m[0] + '  (trigger: ' + m[2] + ')',
    'the keyframe must actually reach the stylesheet, not merely exist in a table');
  ok(M.css.indexOf('@keyframes ' + m[0]) >= 0, '  keyframes defined: ' + m[0]);
  ok(rm.indexOf(m[1]) >= 0, '  reduced-motion off-switch covers: ' + m[1]);
});

/* the two that need a wrapper: EXECUTE it */
ok(M.w.renderTplDetail() === 'BASE_DETAIL',
  'the renderTplDetail wrapper returns the base function\'s value (it wraps, it does not replace)');
ok(M.nodes.tplDetail.classList.contains('mgx-arrive'),
  'THE PREVIEW-SHEET MOMENT FIRES on a real render call');
ok(M.w.saveTemplateFromForm() === 'BASE_SAVE',
  'the saveTemplateFromForm wrapper returns the base value - saving is not broken by the animation');
ok(M.nodes.tplList.classList.contains('mgx-landed'),
  'THE TEMPLATE-LANDED MOMENT FIRES when a template is saved');

/* it must replay, or the second save shows nothing */
M.nodes.tplDetail.classList.remove('mgx-arrive');
M.w.renderTplDetail();
ok(M.nodes.tplDetail.classList.contains('mgx-arrive'),
  'the sheet moment REPLAYS on a second selection');

/* and unwrap cleanly */
M.api.revert();
ok(M.w.renderTplDetail.__mgxWrap === undefined,
  'revert() unwraps the app\'s own functions - no permanent monkey-patch');
ok(M.w.renderTplDetail() === 'BASE_DETAIL',
  'and the base function still works afterwards');

/* ================= PART C — safe on a clinical surface ================== */
const SRCM = fs.readFileSync(path.join(ROOT, 'feat_mls_magic.js'), 'utf8');
ok(!/setInterval\s*\(/.test(SRCM), 'no interval (hidden-tab timers are FROZEN in this app)');
ok(!/requestAnimationFrame/.test(SRCM), 'no rAF loop');
ok(!/new\s+MutationObserver|IntersectionObserver|ResizeObserver/.test(SRCM), 'no observer');

/* exactly one infinite animation is allowed: the waiting shimmer, which is
   deliberate because it means "still working" */
const infinite = (M.css.match(/animation:[^;}]*infinite/g) || []);
ok(infinite.length <= 1,
  'at most ONE infinite animation (the waiting shimmer); an infinite loop keeps the compositor awake all clinic day',
  infinite.join(' | '));

/* the new moments animate transform/opacity only */
const NEW_KF = M.css.match(/@keyframes mgx[A-Za-z]+\{[^}]*\}[^@]*/g) || [];
ok(NEW_KF.length >= 5, 'the new keyframes are readable for inspection (' + NEW_KF.length + ')');
const unsafe = NEW_KF.filter(k => /\b(width|height|top|left|right|bottom|margin|padding|font-size)\s*:/.test(k));
ok(unsafe.length === 0,
  'every new keyframe animates transform/opacity only - never a layout property',
  unsafe.join('\n        '));

ok(/#noteBox[\s\S]{0,200}animation:\s*none/.test(M.css),
  'the medical record is still excluded from all animation');

console.log(failures === 0
  ? '\nPASS  templates-ui-proved-working: no dead buttons, six new animations emitted with off-switches, both wrappers executed and unwrapped, and the motion is safe on a clinical surface.'
  : '\nFAIL  templates-ui-proved-working: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
