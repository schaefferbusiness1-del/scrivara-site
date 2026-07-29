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
   skin that redeclares a property some narrow @media rule owns MUST scope
   itself to the widths it means. Otherwise it silently deletes a responsive
   rule that is still sitting in the file looking correct - which is exactly why
   this survived a read of both files.

   HOW IT CHECKS: it extracts the shipped skin from the module's own string
   table, parses which declarations sit inside a media query and which do not,
   parses every max-width block in ScribeFlow.html, and fails on any selector +
   property that a narrow rule owns and an UNCONDITIONED skin rule also sets.
   New collisions fail automatically; nothing has to be listed here by hand.
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
  const flush = function (selList, decls, inMedia) {
    if (inMedia) return;
    selList.split(',').forEach(function (sel) {
      const key = sel.trim().replace(/\s+/g, ' ');
      if (!key) return;
      const props = map.get(key) || new Set();
      decls.replace(/([-a-zA-Z]+)\s*:/g, function (_, p) { props.add(p.toLowerCase()); return ''; });
      map.set(key, props);
    });
  };
  /* a tiny two-level walker: @media { rules } and bare rules */
  const re = /@media[^{]*\{|([^{}]+)\{([^{}]*)\}|\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[0].charAt(0) === '@') { depth++; continue; }
    if (m[0] === '}') { if (depth > 0) depth--; continue; }
    flush(m[1], m[2], depth > 0);
  }
  return map;
}

/* ---------- every max-width rule in the document stylesheet ------------- */
function narrowRules(htmlFile) {
  const html = fs.readFileSync(path.join(ROOT, htmlFile), 'utf8');
  let css = '';
  html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, function (_, b) { css += b + '\n'; return ''; });
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map(); /* selector -> Set(prop) */
  const blocks = css.match(/@media[^{]*max-width[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g) || [];
  blocks.forEach(function (block) {
    const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'));
    body.replace(/([^{}]+)\{([^{}]*)\}/g, function (_, selList, decls) {
      selList.split(',').forEach(function (sel) {
        const key = sel.trim().replace(/\s+/g, ' ');
        if (!key) return;
        const props = out.get(key) || new Set();
        decls.replace(/([-a-zA-Z]+)\s*:/g, function (__, p) { props.add(p.toLowerCase()); return ''; });
        out.set(key, props);
      });
    });
  });
  return { rules: out, blockCount: blocks.length };
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
   Matching whole selector text is not enough. A rule written as
   `body.mls-ot3 #oprDayRail{border-right:...}` targets the very same element as
   the narrow `#oprDayRail{border-right:0}` and, because the body class ADDS
   specificity, it wins at EVERY width - a strictly worse version of the
   original defect. So collisions are also checked on the rightmost simple
   selector, which is the element actually being styled. */
function rightmostKey(sel) {
  const parts = sel.trim().split(/\s+|>/).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const id = last.match(/#[\w-]+/);
  if (id) return id[0];
  const cls = last.match(/\.[\w-]+/);
  return cls ? cls[0] : last;
}
const NARROW_BY_KEY = new Map();
NARROW.rules.forEach(function (props, sel) {
  const k = rightmostKey(sel);
  if (!NARROW_BY_KEY.has(k)) NARROW_BY_KEY.set(k, new Set());
  props.forEach(function (p) { NARROW_BY_KEY.get(k).add(p); });
});

EXEC_SKINS.forEach(function (entry) {
  const got = skinCssByExecution(entry[0], entry[1]);
  if (!ok(!got.err && got.css && got.css.length > 200,
      entry[0] + ': stylesheet obtained by EXECUTING the module',
      got.err || ('got ' + (got.css ? got.css.length : 0) + ' bytes'))) return;

  ok(/#oprDayRail|#oprEditor/.test(got.css),
    entry[0] + ': the executed stylesheet contains the rules under test (not vacuous)');

  const un = unconditionedDecls(got.css);
  const collisions = [];
  let unsound = 0;
  un.forEach(function (props, sel) {
    const key = rightmostKey(sel);
    /* ONLY ids are compared. A tag or generic class key is unsound: reducing
       `#opPrepList textarea` to `textarea` makes it look like it collides with a
       narrow rule on EVERY textarea, when in fact out-specifying a blanket rule
       for one specific element is the intended job of this module. Six such
       false positives were produced before this guard, and a suite that cries
       wolf gets switched off - so it only speaks where it can be right. */
    if (key.charAt(0) !== '#') { unsound++; return; }
    const narrow = NARROW_BY_KEY.get(key);
    if (!narrow) return;
    props.forEach(function (p) {
      if (narrow.has(p)) collisions.push(sel + ' { ' + p + ' }  -> same element as narrow ' + key);
    });
  });
  if (unsound) console.log('  note  ' + unsound + ' rule(s) target a tag/class rather than an id; not comparable this way');
  ok(collisions.length === 0,
    entry[0] + ': no unconditioned rule out-specifies a narrow @media rule',
    collisions.length
      ? 'a body-class-scoped rule targeting the same element wins at EVERY width:\n          - '
        + collisions.join('\n          - ')
        + '\n        Move these into the @media (min-width:901px) block.'
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
