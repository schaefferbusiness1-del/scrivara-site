'use strict';
/* =========================================================================
   THE TEMPLATES PANEL SCROLLS TO ITS LAST CONTROL
   -------------------------------------------------------------------------
   OWNER, twice, the second time in capitals: "STILL CANT SCROLL DOWN IN
   TEMPLATES". The first report was read as a width problem and the width was
   fixed; the scrolling was never the width.

   THE MECHANISM. feat_mls_opnote_room.js reparents #templatesModal WHOLE into
   #oprPanelTpls so Templates becomes a tab of the op-note room. The room skin
   styles its own full-screen card with

       #opPrepModal.opr-room .modal { height:100dvh; max-height:100dvh;
                                     display:flex; overflow:hidden }

   which is a DESCENDANT selector — so once Templates lives inside the room it
   matches the Templates card too. The embedded override that follows it took
   back only `max-height`. The Templates card therefore rendered as a
   flex column clamped to exactly one viewport with overflow:hidden, and
   everything past the fold was CLIPPED — not scrolled off, clipped, so no
   amount of wheeling could reach it.

   MEASURED in an isolated repro of these exact rules (no PHI), before the fix:
       inner card   height 894px (=100dvh), display flex, overflow hidden
       content      scrollHeight 1620px
       the panel    scrollHeight 946 / clientHeight 851  -> 95px of travel
       Close button top y=1543 in an 894px viewport
                    onScreen false, elementFromPoint hit-test false
   and after handing back height/display/overflow:
       inner card   height 1581px (natural), display block, overflow visible
       the panel    scrollHeight 1652 / clientHeight 851 -> 801px of travel
       Close button top y=837 in an 894px viewport
                    onScreen TRUE, elementFromPoint hit-test TRUE

   WHY THIS SUITE EXISTS AND WHY IT IS NOT A GREP. The bug was a CASCADE bug:
   every individual declaration was correct and the string `overflow:auto` was
   present on the panel the whole time. Only the resolved value on the embedded
   card was wrong. So this suite resolves the cascade the way a browser does —
   it collects every shipped rule that MATCHES the embedded card's element
   path, orders by specificity then source order, and asserts the WINNING
   declarations. A future edit that re-clips the card by adding a
   higher-specificity rule elsewhere fails here even though no string this file
   searches for has changed.

   PART 2 — NO FEATURE LOSS. The owner's standing instruction on this fix was
   "make sure it all works perfect and that we dont lose any features in the
   porcess". A presentation fix must not delete a control, so the suite also
   pins every interactive element of the Templates card as an inventory: upload,
   paste, save, clear, search, rename-by-note-type, remove-duplicates, the
   list, the detail pane, and Close must all still be there.
   ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}

/* ---------- the element path of the reparented Templates card ------------
   #opPrepModal.modal-bg.opr-room.show
     > div.modal                       (the room's own full-screen card)
       > section#oprPanelTpls.on
         > div#templatesModal.modal-bg.show   (reparented, position:static)
           > div.modal                 (THE CARD UNDER TEST)                */
const PATH = [
  { tag: 'div', id: 'opPrepModal', cls: ['modal-bg', 'opr-room', 'show'] },
  { tag: 'div', id: '', cls: ['modal'] },
  { tag: 'section', id: 'oprPanelTpls', cls: ['on'] },
  { tag: 'div', id: 'templatesModal', cls: ['modal-bg', 'show'] },
  { tag: 'div', id: '', cls: ['modal'] }
];

/* ---------- a deliberately small matcher: tag / #id / .class compounds,
   descendant and child combinators. Anything it cannot parse is REPORTED,
   never silently skipped — a matcher that quietly drops the rule that breaks
   the page would make this suite lie. ---------------------------------- */
function parseCompound(text) {
  const m = text.match(/^(?:([a-zA-Z][\w-]*)|\*)?((?:[#.][\w-]+)*)$/);
  if (!m) return null;
  const out = { tag: m[1] ? m[1].toLowerCase() : '', ids: [], cls: [] };
  (m[2] || '').replace(/([#.])([\w-]+)/g, function (_, k, n) {
    if (k === '#') out.ids.push(n); else out.cls.push(n);
    return '';
  });
  return out;
}
function compoundMatches(c, node) {
  if (c.tag && c.tag !== '*' && c.tag !== node.tag) return false;
  for (const id of c.ids) if (id !== node.id) return false;
  for (const k of c.cls) if (node.cls.indexOf(k) < 0) return false;
  return true;
}
/* returns true | false | null(unparseable)

   The CHILD combinator is honoured, and that is not a nicety: the fix for this
   very bug was to change `#opPrepModal.opr-room .modal` to
   `#opPrepModal.opr-room > .modal`. A matcher that treated every combinator as
   "descendant" would keep reporting the leak after it was closed - it would
   fail the FIXED file and pass the broken one. The instrument has to be at
   least as precise as the thing it measures. */
function selectorMatchesPath(sel) {
  const s = sel.trim();
  if (/[:[~+]/.test(s)) return null;                 /* pseudo/attr/sibling: out of scope */
  const toks = s.split(/\s+/).filter(Boolean);
  const compounds = [], combs = [];                  /* combs[k] joins compounds[k] -> compounds[k+1] */
  for (const t of toks) {
    if (t === '>') { combs[compounds.length - 1] = '>'; continue; }
    if (t.indexOf('>') >= 0) {                       /* `a>b` with no spaces */
      const pieces = t.split('>');
      for (let p = 0; p < pieces.length; p++) {
        if (!pieces[p]) return null;
        const c = parseCompound(pieces[p]);
        if (!c) return null;
        if (compounds.length) combs[compounds.length - 1] = (p === 0 ? (combs[compounds.length - 1] || ' ') : '>');
        if (p > 0) combs[compounds.length - 1] = '>';
        compounds.push(c);
      }
      continue;
    }
    const c = parseCompound(t);
    if (!c) return null;
    if (compounds.length && combs[compounds.length - 1] == null) combs[compounds.length - 1] = ' ';
    compounds.push(c);
  }
  if (!compounds.length) return null;

  /* right-to-left with backtracking over descendant steps */
  function walk(j, i) {
    if (j < 0) return true;
    if (i < 0) return false;
    if (!compoundMatches(compounds[j], PATH[i])) {
      /* only a descendant step may skip an ancestor */
      return (j < compounds.length - 1 && combs[j] === ' ') ? walk(j, i - 1) : false;
    }
    if (j === 0) return true;
    return combs[j - 1] === '>' ? walk(j - 1, i - 1) : walk(j - 1, i - 1) || walk(j, i - 1);
  }
  /* the rightmost compound must match the element itself, not an ancestor */
  if (!compoundMatches(compounds[compounds.length - 1], PATH[PATH.length - 1])) return false;
  return walk(compounds.length - 1, PATH.length - 1);
}
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const cls = (sel.match(/\.[\w-]+/g) || []).length + (sel.match(/\[[^\]]*\]/g) || []).length;
  const tag = (sel.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + cls * 100 + tag;
}

/* ---------- SELF-TEST THE INSTRUMENT ------------------------------------
   This suite's verdict is only worth the matcher's accuracy, and the matcher is
   the part I wrote today. So it is checked against selectors whose answer is
   known by inspection BEFORE it is used to judge the file. If any of these
   drift, every result below is meaningless and the suite says so. */
[
  ['#oprPanelTpls #templatesModal .modal', true, 'the embedded override reaches the card'],
  ['#opPrepModal.opr-room .modal', true, 'a DESCENDANT room rule would reach it (the old bug)'],
  ['#opPrepModal.opr-room > .modal', false, 'a CHILD room rule must NOT reach it (the fix)'],
  ['#opPrepModal.opr-room.show > .modal', false, 'nor the child entrance animation'],
  ['#templatesModal > .modal', true, 'its own parent, as a child step'],
  ['#oprPanelTpls > .modal', false, 'the panel is the grandparent, not the parent'],
  ['.modal-bg.show > .modal', true, 'the reparented container still carries modal-bg.show'],
  ['#settingsModal .modal', false, 'an unrelated dialog must not match'],
  ['div.modal', true, 'tag+class on the element itself'],
  ['section .modal', true, 'an ancestor tag step'],
  ['#opPrepModal > .modal', false, 'the room card is the child here, not this one']
].forEach(function (t) {
  const got = selectorMatchesPath(t[0]);
  ok(got === t[1], 'matcher self-test: ' + t[2],
    t[0] + '  expected ' + t[1] + ', got ' + got);
});
if (failures) {
  console.log('\nFAIL  templates-panel-scrolls: the selector matcher is wrong, so no verdict below can be trusted.');
  process.exit(1);
}

/* ---------- collect the shipped rules, outside any @media -------------- */
const styleBlocks = [];
HTML.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_, body) { styleBlocks.push(body); return ''; });
ok(styleBlocks.length > 0, 'ScribeFlow.html ships at least one <style> block');

const candidates = []; /* {sel, decls, spec, order, important} */
let order = 0;
let unparseable = [];
for (const block of styleBlocks) {
  /* strip comments, then strip @media bodies so a narrow-viewport rule cannot
     be mistaken for the desktop cascade this bug lives in */
  let css = block.replace(/\/\*[\s\S]*?\*\//g, '');
  css = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g, '');
  css.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, selList, decls) {
    for (const sel of selList.split(',')) {
      const s = sel.trim();
      if (!s || s.charAt(0) === '@') continue;
      if (!/\.modal(\b|$)/.test(s)) continue;      /* only rules that can reach the card */
      const m = selectorMatchesPath(s);
      if (m === null) { unparseable.push(s); continue; }
      if (m) candidates.push({ sel: s, decls: decls, spec: specificity(s), order: order++ });
    }
    return '';
  });
}

ok(candidates.length >= 1,
  'at least one shipped rule reaches the embedded Templates card',
  'matched ' + candidates.length + ' rule(s): ' + candidates.map(c => c.sel).join(' | '));

/* The fix has TWO independent layers and each is pinned on its own, so
   reverting either one alone still fails here.

   LAYER 1 - the room's full-screen rule must not reach a nested card at all.
   It is scoped to a direct child. Anyone who deletes the `>` reopens the exact
   defect the owner reported twice, so that is a failure even though layer 2
   would still be covering for it. */
const allCss = styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const roomRule = (allCss.match(/#opPrepModal\.opr-room[^{,]*\.modal(?=\s*\{)/g) || []);
ok(roomRule.length > 0,
  'the room full-screen rule is still in the stylesheet (suite is not testing a deleted feature)',
  'if this rule was renamed, update this suite - do not delete the assertion');
roomRule.forEach(function (sel) {
  ok(selectorMatchesPath(sel.trim()) === false,
    'LAYER 1: room rule is scoped so it cannot reach a nested card: ' + sel.trim(),
    'this selector DOES reach the embedded Templates card - it will clip it again');
});

/* LAYER 2 - the embedded override states the intent explicitly, so the panel
   owns scrolling even if a future rule sneaks back in. */
ok(candidates.some(c => /#oprPanelTpls\s+#templatesModal\s+\.modal/.test(c.sel)),
  'LAYER 2: the embedded-presentation override is present and reaches the card');
if (unparseable.length) {
  console.log('  note  ' + unparseable.length + ' .modal selector(s) out of matcher scope (pseudo/attr): '
    + unparseable.slice(0, 4).join(' | '));
}

/* ---------- resolve ---------- */
function resolve(prop) {
  let win = null;
  for (const c of candidates) {
    const re = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i');
    const m = c.decls.match(re);
    if (!m) continue;
    const raw = m[1].trim();
    const important = /!important/i.test(raw);
    const value = raw.replace(/\s*!important\s*/i, '').trim();
    const rank = (important ? 1e9 : 0) + c.spec * 1000 + c.order;
    if (!win || rank >= win.rank) win = { value: value, rank: rank, sel: c.sel, important: important };
  }
  return win;
}

const height = resolve('height');
const display = resolve('display');
const overflow = resolve('overflow');
const maxH = resolve('max-height');

function show(w) { return w ? (w.value + '   [from ' + w.sel + ']') : '(not set)'; }

/* CONTENT IS CUT OFF only when the box is HEIGHT-CONSTRAINED. So the invariant
   is stated in that order, and the overflow check is CONDITIONAL on a
   constraint existing - an unconstrained card with overflow:auto (which is what
   the base .modal rule gives it) clips nothing and must not be reported as a
   defect. A test that fails a working configuration teaches you to ignore it. */
const heightConstrained = !!(height && !/^(auto|unset|initial|revert)$/i.test(height.value));
const ceilingSet = !!(maxH && !/^(none|unset|initial|revert)$/i.test(maxH.value));

ok(!heightConstrained,
  'the embedded Templates card has no fixed height (the panel owns scrolling)',
  'resolved height = ' + show(height));

ok(!ceilingSet,
  'the embedded Templates card has no max-height ceiling',
  'resolved max-height = ' + show(maxH));

if (heightConstrained || ceilingSet) {
  ok(!!overflow && /^(visible|unset|initial|revert)$/i.test(overflow.value),
    'the height-constrained card at least does not CLIP its content',
    'resolved overflow = ' + show(overflow) +
    '  <- a height constraint plus overflow:hidden is the exact defect the owner hit twice');
} else {
  console.log('  pass  no height constraint, so overflow cannot cut anything off (resolved overflow = '
    + (overflow ? overflow.value : 'not set') + ')');
}

/* The card's children are stacked blocks (form, hr, headings, workspace). If a
   flex/grid container leaks in, `flex-direction` decides whether they stack or
   run across the page - so this stays a hard failure rather than a note. */
ok(!display || !/flex|grid/i.test(display.value),
  'the embedded Templates card lays out as normal flow, not as the room column',
  'resolved display = ' + show(display));

/* ---------- the FLOATING card must keep every one of those --------------
   The same override must not leak outward: opened classically (room refused
   to open, per the opr-1.5.0 fallback), Templates is a real modal again and
   NEEDS max-height + overflow:auto or it grows past the viewport. */
const floatBase = /\.modal\{[^}]*max-height:90vh;[^}]*overflow:auto[^}]*\}/.test(
  styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/ \{/g, '{')
  || '');
ok(
  /\.modal\{[^}]*max-height:\s*90vh[^}]*\}/.test(styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '')) &&
  /\.modal\{[^}]*overflow:\s*auto[^}]*\}/.test(styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '')),
  'the FLOATING .modal keeps max-height:90vh + overflow:auto (fallback posture unharmed)',
  'the embedded override is scoped under #oprPanelTpls, so it cannot reach a floating modal' +
  (floatBase ? '' : ''));

/* ---------- PART 2: no feature loss ---------- */
const tplStart = HTML.indexOf('id="templatesModal"');
const tplEnd = HTML.indexOf('id="opPrepModal"');
ok(tplStart > 0 && tplEnd > tplStart, 'the Templates card markup is locatable');
const tplHtml = HTML.slice(tplStart, tplEnd);

const INVENTORY = [
  ['tplName', 'the template Name field'],
  ['tplKeywords', 'the keywords / specialty tags field'],
  /* The duplicate single-file uploader was deliberately retired. The one
     canonical uploader accepts one file, many files, or a multi-form PDF. */
  ['tplMultiFileInput', 'the consolidated file picker (Word / PDF / image / text)'],
  ['tplMultiDrop', 'the consolidated drag-and-drop zone'],
  ['tplText', 'the editable extracted-text area'],
  ['tplSearch', 'the template search box'],
  ['tplWorkspace', 'the two-pane workspace'],
  ['tplList', 'the saved-templates list'],
  ['tplDetail', 'the preview / edit detail pane']
];
for (const [id, label] of INVENTORY) {
  ok(tplHtml.indexOf('id="' + id + '"') >= 0, 'still present: ' + label + ' (#' + id + ')');
}
const ACTIONS = [
  ['tplPasteText(', 'Type or paste below'],
  ['saveTemplateFromForm(', 'Save template'],
  ['clearTplForm(', 'Clear'],
  ['fixTemplateNames(', 'Rename by note type'],
  ['dedupeSavedTemplates(', 'Remove duplicates'],
  ['closeTemplates(', 'Close']
];
for (const [call, label] of ACTIONS) {
  ok(tplHtml.indexOf(call) >= 0, 'still wired: ' + label);
}

/* The list's own inner scroller stays — it is what keeps a 200-template list
   from pushing the detail pane off screen. Removing it would "fix" scrolling
   by making the page enormous instead. */
ok(/id="tplList"[^>]*overflow-y:\s*auto/.test(tplHtml),
  '#tplList keeps its own inner scroller (a long list must not stretch the page)');

/* The detail pane is sticky on desktop so the preview stays put while the list
   scrolls; the phone media query already clears it. Pin both halves. */
ok(/id="tplDetail"[^>]*position:\s*sticky/.test(tplHtml),
  '#tplDetail stays sticky on desktop (preview holds while the list scrolls)');
ok(/@media\(max-width:640px\)\{[\s\S]{0,400}?#tplWorkspace>#tplDetail\{position:static!important\}/.test(
    HTML.replace(/\/\*[\s\S]*?\*\//g, '')),
  'on a phone the sticky is cleared (nothing to stick to in one column)');

console.log(failures === 0
  ? '\nPASS  templates-panel-scrolls: the embedded card is scrollable to its last control, and nothing was removed to get there.'
  : '\nFAIL  templates-panel-scrolls: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
