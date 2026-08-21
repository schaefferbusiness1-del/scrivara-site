'use strict';
/* =========================================================================
   A RUNTIME SKIN MAY NOT SILENTLY OUTRANK THE RESPONSIVE RULES
   -------------------------------------------------------------------------
   MEASURED, 2026-07-29, in a PHI-free replica of the op-note room built from
   the real shipped CSS and the real shipped markup, at 390x844:

       #oprPanelProcs  grid-template-columns:  312px minmax(0px, 1fr)
       #oprRowNav      max-height:             none
       nine procedure buttons at left:305 width:92  ->  right edge 397 > 390
       nine controls unreachable

   On a 390px phone the op-note room still drew its 312px desktop sidebar,
   leaving about 78px for the editor, and pushed the Generate/Copy buttons of
   every procedure card past the right edge of the screen.

   ScribeFlow.html already had the correct narrow rules:
       @media (max-width:900px){ #oprPanelProcs{ grid-template-columns:1fr }
                                 #oprRowNav{ max-height:22vh } }

   They never applied. feat_mls_opnote_room.js builds its skin at RUNTIME and
   appends the <style> element to <head>, so its rules come LATER in source
   order than the document's own inline stylesheet. A media query contributes
   NOTHING to specificity, so at equal specificity the unconditioned runtime
   rule wins at every width and the responsive collapse is dead. It had been
   dead since that skin shipped on 2026-07-28.

   THE LAW THIS SUITE PINS, which is bigger than those two rules: a runtime
   skin that redeclares a property some narrow @media rule owns must leave an
   EFFECTIVE narrow owner in the cascade. Usually that means scoping the desktop
   declaration to min-width; a stronger document narrow selector or a later
   same/higher-specificity runtime narrow override is equally sound. Otherwise
   it silently deletes a responsive rule that is still sitting in the file
   looking correct - which is exactly why this survived a read of both files.

   HOW IT CHECKS: it extracts the shipped skin from the module's own string
   table, parses which declarations sit inside a media query and which do not,
   parses every max-width block in ScribeFlow.html and in executed runtime CSS,
   and fails when an UNCONDITIONED skin declaration would actually win at the
   narrow width. New collisions fail automatically; nothing is listed by hand.
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

/* ---------- extract a runtime skin's CSS from its own string table -------
   Comments are stripped FIRST. An apostrophe inside a JS comment (the module
   carried "ScribeFlow's") terminates a string scan early and swallows the very
   next rule - which made this instrument report a layout the app never renders
   before it was corrected. */
function skinCss(file, startMark) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const s = src.indexOf(startMark);
  if (s < 0) return null;
  const e = src.indexOf("].join('\\n')", s);
  if (e < 0) return null;
  let out = '';
  src.slice(s, e)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'((?:[^'\\]|\\.)*)'/g, function (_, str) {
      out += str.replace(/\\'/g, "'").replace(/\\\\/g, '\\') + '\n';
      return '';
    });
  return out;
}

/* ---------- which declarations are UNCONDITIONED (outside any @media)? --- */
function unconditionedDecls(css) {
  const map = new Map(); /* selector -> Set(prop) */
  let depth = 0, i = 0, buf = '';
  const flush = function (selList, decls, inMedia, at) {
    if (inMedia) return;
    const declared = [];
    decls.replace(/([-a-zA-Z]+)\s*:/g, function (_, p) { declared.push(p.toLowerCase()); return ''; });
    selList.split(',').forEach(function (sel) {
      const key = sel.trim().replace(/\s+/g, ' ');
      if (!key) return;
      const props = map.get(key) || new Set();
      if (!props.atByProperty) props.atByProperty = new Map();
      declared.forEach(function (p) { props.add(p); props.atByProperty.set(p, at); });
      map.set(key, props);
    });
  };
  /* a tiny two-level walker: @media { rules } and bare rules */
  const re = /@media[^{]*\{|([^{}]+)\{([^{}]*)\}|\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[0].charAt(0) === '@') { depth++; continue; }
    if (m[0] === '}') { if (depth > 0) depth--; continue; }
    flush(m[1], m[2], depth > 0, m.index);
  }
  return map;
}

/* ---------- every max-width rule in a stylesheet ------------------------- */
function narrowRulesFromCss(input) {
  /* Preserve offsets while blanking comments: runtime narrow rules must come
     AFTER the unconditional declaration they are expected to override. */
  const css = String(input || '').replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, ' '); });
  const out = new Map(); /* selector -> Set(prop) */
  const entries = [];    /* [{selector, props, at}] keeps cascade evidence */
  const blockRe = /@media[^{]*max-width[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g;
  let blockMatch, blockCount = 0;
  while ((blockMatch = blockRe.exec(css))) {
    blockCount++;
    const block = blockMatch[0];
    const bodyOpen = block.indexOf('{') + 1;
    const body = block.slice(bodyOpen, block.lastIndexOf('}'));
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let rule;
    while ((rule = ruleRe.exec(body))) {
      const selList = rule[1], decls = rule[2];
      const ruleProps = new Set();
      decls.replace(/([-a-zA-Z]+)\s*:/g, function (_, p) { ruleProps.add(p.toLowerCase()); return ''; });
      selList.split(',').forEach(function (sel) {
        const key = sel.trim().replace(/\s+/g, ' ');
        if (!key) return;
        const props = out.get(key) || new Set();
        ruleProps.forEach(function (p) { props.add(p); });
        out.set(key, props);
        entries.push({ selector: key, props: new Set(ruleProps), at: blockMatch.index + bodyOpen + rule.index });
      });
    }
  }
  return { rules: out, entries: entries, blockCount: blockCount };
}

function narrowRules(htmlFile) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  let css = '';
  html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_, b) { css += b + '\n'; return ''; });
  return narrowRulesFromCss(css);
}

const NARROW = narrowRules('ScribeFlow.html');
ok(NARROW.blockCount > 0,
  'ScribeFlow.html ships max-width media blocks to protect',
  'if this is 0 the suite is vacuous');
ok(NARROW.rules.has('#oprPanelProcs'),
  'the op-note room narrow rule is still in ScribeFlow.html (the one that was being overridden)',
  'if this selector moved, update this suite rather than deleting the check');

/* ---------- a skin that builds its CSS in a FUNCTION ---------------------
   String-scraping cannot read these, and "the extractor could not see it" must
   never look like "there was nothing to see". So the module is executed in a
   stub DOM and asked for its stylesheet directly - the same bytes it ships. */
function skinCssByExecution(file, globalName) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const el = function () {
    return { id: '', textContent: '', style: {}, parentNode: null,
             classList: { add() {}, remove() {}, contains() { return false; } },
             appendChild() {}, removeChild() {}, setAttribute() {} };
  };
  const doc = {
    getElementById() { return null; },
    createElement: el,
    addEventListener() {},
    head: el(),
    documentElement: el(),
    body: el()
  };
  const win = { document: doc };
  win.window = win;
  try {
    /* eslint-disable no-new-func */
    new Function('window', 'document', src)(win, doc);
  } catch (e) {
    return { err: String(e && e.message) };
  }
  const api = win[globalName];
  if (!api || typeof api.css !== 'function') return { err: 'no css() on window.' + globalName };
  try { return { css: api.css() }; } catch (e2) { return { err: String(e2 && e2.message) }; }
}

/* ---------- the runtime skins that could outrank them -------------------- */
const SKINS = [
  ['feat_mls_opnote_room.js', 'st.textContent = [']
];
/* ADD EVERY NEW STYLE-INJECTING MODULE HERE. */
const EXEC_SKINS = [
  ['feat_mls_opnote_templates_ui.js', '__mlsOpNoteTemplatesUi']
];

let checked = 0;
SKINS.forEach(function (entry) {
  const css = skinCss(entry[0], entry[1]);
  if (!ok(css && css.length > 200, entry[0] + ': skin CSS extracted', 'got ' + (css ? css.length : 0) + ' bytes')) return;

  /* the extractor must be able to SEE the rules, or every verdict is vacuous */
  ok(/#oprPanelProcs/.test(css),
    entry[0] + ': extractor can see the rule that caused the bug',
    'a JS comment apostrophe silently truncates this scan - see the header');

  const un = unconditionedDecls(css);
  ok(un.size > 0, entry[0] + ': unconditioned declarations parsed', 'parsed ' + un.size + ' selector(s)');

  const collisions = [];
  un.forEach(function (props, sel) {
    const narrow = NARROW.rules.get(sel);
    if (!narrow) return;
    props.forEach(function (p) {
      if (narrow.has(p)) collisions.push(sel + ' { ' + p + ' }');
    });
    checked++;
  });

  ok(collisions.length === 0,
    entry[0] + ': no unconditioned skin rule overrides a narrow @media rule',
    collisions.length
      ? 'these are set unconditionally AND owned by a max-width rule, so the narrow rule can\n        never apply (append order beats a media query at equal specificity):\n          - '
        + collisions.join('\n          - ')
        + '\n        Gate them: wrap in @media (min-width:901px){ ... }'
      : '');
});

/* ---------- the same law, but keyed on the TARGETED ELEMENT --------------
   Matching whole selector text is not enough. Rules with different ancestor
   qualifiers can target the same id. The verdict must then follow the actual
   cascade: an unconditional runtime declaration is unsafe only when neither a
   stronger document narrow rule nor a later same/higher-specificity runtime
   narrow rule can override it. */
function rightmostKey(sel) {
  const parts = sel.trim().split(/\s+|>/).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const id = last.match(/#[\w-]+/);
  if (id) return id[0];
  const cls = last.match(/\.[\w-]+/);
  return cls ? cls[0] : last;
}

/* Enough of Selectors specificity for this contract: ids, then class/
   attribute/pseudo-class selectors, then element names. The first two columns
   decide every selector currently compared here; the element count preserves
   the correct tie-break for future simple additions. */
function specificity(sel) {
  const s = String(sel || '').replace(/:where\([^)]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classLike = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const stripped = s
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, ' ')
    .replace(/[>+~*,()]/g, ' ');
  const elements = stripped.split(/\s+/).filter(function (part) { return /^[a-z][\w-]*$/i.test(part); }).length;
  return [ids, classLike, elements];
}
function compareSpecificity(a, b) {
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] - b[i]; }
  return 0;
}
ok(compareSpecificity(
    specificity('#opPrepModal[data-mls-opnotes-state] #oprDayRail'),
    specificity('body.mls-ot3 #oprDayRail')) > 0,
  'specificity reader recognizes the stronger two-id narrow owner');

const NARROW_BY_KEY = new Map();
NARROW.rules.forEach(function (props, sel) {
  const k = rightmostKey(sel);
  if (!NARROW_BY_KEY.has(k)) NARROW_BY_KEY.set(k, []);
  NARROW_BY_KEY.get(k).push({ selector: sel, props: props });
});

EXEC_SKINS.forEach(function (entry) {
  const got = skinCssByExecution(entry[0], entry[1]);
  if (!ok(!got.err && got.css && got.css.length > 200,
      entry[0] + ': stylesheet obtained by EXECUTING the module',
      got.err || ('got ' + (got.css ? got.css.length : 0) + ' bytes'))) return;

  ok(/#oprDayRail|#oprEditor/.test(got.css),
    entry[0] + ': the executed stylesheet contains the rules under test (not vacuous)');

  const un = unconditionedDecls(got.css);
  const runtimeNarrow = narrowRulesFromCss(got.css);
  const collisions = [];
  let unsound = 0, cascadeProtected = 0;
  un.forEach(function (props, sel) {
    const key = rightmostKey(sel);
    /* ONLY ids are compared. A tag or generic class key is unsound: reducing
       `#opPrepList textarea` to `textarea` makes it look like it collides with a
       narrow rule on EVERY textarea, when in fact out-specifying a blanket rule
       for one specific element is the intended job of this module. Six such
       false positives were produced before this guard, and a suite that cries
       wolf gets switched off - so it only speaks where it can be right. */
    if (key.charAt(0) !== '#') { unsound++; return; }
    const narrowOwners = NARROW_BY_KEY.get(key);
    if (!narrowOwners) return;
    const unconditionedSpecificity = specificity(sel);
    props.forEach(function (p) {
      const unconditionedAt = props.atByProperty ? props.atByProperty.get(p) : -1;
      const propertyOwners = narrowOwners.filter(function (owner) { return owner.props.has(p); });
      if (!propertyOwners.length) return;
      const strongerDocumentOwner = propertyOwners.some(function (owner) {
        return compareSpecificity(specificity(owner.selector), unconditionedSpecificity) > 0;
      });
      const laterRuntimeOwner = runtimeNarrow.entries.some(function (owner) {
        return rightmostKey(owner.selector) === key && owner.props.has(p) &&
          owner.at > unconditionedAt &&
          compareSpecificity(specificity(owner.selector), unconditionedSpecificity) >= 0;
      });
      if (strongerDocumentOwner || laterRuntimeOwner) { cascadeProtected++; return; }
      collisions.push(sel + ' { ' + p + ' }  -> same element as narrow ' + key);
    });
  });
  if (unsound) console.log('  note  ' + unsound + ' rule(s) target a tag/class rather than an id; not comparable this way');
  if (cascadeProtected) console.log('  note  ' + cascadeProtected + ' overlap(s) retain an effective narrow owner by specificity/source order');
  ok(collisions.length === 0,
    entry[0] + ': no unconditioned rule out-specifies a narrow @media rule',
    collisions.length
      ? 'an unconditioned rule has no stronger document narrow owner and no later\n        same/higher-specificity runtime narrow override:\n          - '
        + collisions.join('\n          - ')
        + '\n        Move it into a min-width block or add an effective narrow override.'
      : '');
  checked += un.size;
});

ok(checked > 0,
  'at least one skin selector was compared against a narrow rule (suite is not vacuous)',
  'checked ' + checked + ' overlapping selector(s)');

/* ---------- the two specific fixes, pinned by name ---------------------- */
const roomCss = skinCss('feat_mls_opnote_room.js', 'st.textContent = [') || '';
[['#oprPanelProcs', 'grid-template-columns', 'the 312px desktop sidebar'],
 ['#oprRowNav', 'max-height', 'the uncapped patient rail']
].forEach(function (t) {
  /* find the declaration and confirm a min-width guard opens before it */
  const at = roomCss.indexOf(t[0]);
  const decl = at >= 0 ? roomCss.slice(at, roomCss.indexOf('}', at) + 1) : '';
  const hasProp = new RegExp(t[1]).test(decl);
  if (!hasProp) { console.log('  note  ' + t[0] + ' no longer sets ' + t[1] + ' at all (also fine)'); return; }
  const before = roomCss.slice(0, at);
  const opens = (before.match(/@media[^{]*min-width[^{]*\{/g) || []).length;
  const closes = (before.match(/^\s*\}\s*$/gm) || []).length;
  ok(opens > closes,
    t[2] + ' (' + t[0] + ' ' + t[1] + ') is gated behind a min-width guard',
    'unguarded, it kills the narrow rule at every width');
});

console.log(failures === 0
  ? '\nPASS  runtime-skin-cannot-outrank-responsive: every unconditioned runtime rule leaves the narrow rules able to apply.'
  : '\nFAIL  runtime-skin-cannot-outrank-responsive: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
