'use strict';
/* =========================================================================
   A CLASS YOU STYLE BUT NEVER SET IS DEAD CSS
   -------------------------------------------------------------------------
   OWNER: "WHERE IS ALL THE MAJIC ALY ANIMations".

   The answer was that feat_mls_magic.js shipped a stylesheet and nothing else.
   A repo-wide sweep found ZERO writers for every class it keyed off:

       .mg-drawn        0 writers
       .mg-settle       0 writers
       .mg-wait         0 writers
       body.mg-pt-swap  0 writers  (its only mention was the remove() in revert)
       body.mls-note-live 0 writers - and FOUR modules style on it

   Five "moments", none of which could ever fire. It passed every motion suite,
   because those check the shape of the CSS - that animations are tokenised, that
   a reduced-motion off-switch exists, that nothing animates a layout property.
   None of them asked the one question that mattered: does anything ever turn
   this on?

   The same defect had already been found once in this codebase, on
   `body.mls-recording`: three modules stand down on a class no `classList` call
   ever adds, so their stand-down guards can never fire either. A guard that
   cannot fire reads in review as a safety property that has been handled.

   THIS SUITE IS THE GENERAL LAW. For every module-owned trigger class - the
   bespoke ones a module invents to drive its own behaviour - there must be a real
   writer somewhere in the shipped source. It is deliberately scoped to
   module-invented prefixes rather than to every class in the app, because a
   stylesheet is perfectly entitled to style markup classes it does not own.
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

/* Every shipped front-end source, minus staging twins and test fixtures. */
const SOURCES = fs.readdirSync(ROOT)
  .filter(f => /\.(js|html)$/.test(f))
  .filter(f => !/\.staging\.|ScribeFlow_test|-staging|\.min\./.test(f));
ok(SOURCES.length > 20, 'the source sweep found the shipped files',
  'found ' + SOURCES.length);

const TEXT = {};
SOURCES.forEach(f => {
  try { TEXT[f] = fs.readFileSync(path.join(ROOT, f), /mls-connect\.js/.test(f) ? 'latin1' : 'utf8'); }
  catch (e) {}
});
const ALL = Object.keys(TEXT).map(k => TEXT[k]).join('\n');

/* The trigger-class families a module INVENTS for itself. Add a prefix here when
   a new module invents one. */
const TRIGGER_PREFIXES = ['mg-', 'mls-note-live', 'mls-recording', 'mls-ot3', 'mls-uic', 'mls-uish'];

/* Harvest every class our own modules STYLE that matches those families. */
const styled = new Set();
Object.keys(TEXT).forEach(f => {
  if (!/^feat_mls_|^mls-connect\.js$/.test(f)) return;
  /* Comments are stripped FIRST. A note explaining that a rule was REMOVED still
     mentions the class, and the harvester would then flag the very class the
     comment says is gone - the same trap that made a skin extractor choke on an
     apostrophe inside a comment. Only real selectors count. */
  const src = TEXT[f].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /\.((?:mg-|mls-)[a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const c = m[1];
    if (TRIGGER_PREFIXES.some(p => c === p || c.indexOf(p) === 0)) styled.add(c);
  }
});
ok(styled.size >= 4, 'trigger classes were harvested from the shipped modules',
  'found ' + styled.size + ': ' + [...styled].sort().join(', '));

/* A WRITER is a real classList mutation, a className assignment, or the class
   appearing inside a literal class="..." in shipped markup. A `remove()` alone is
   NOT a writer - that was exactly the mg-pt-swap trap, where the only mention
   outside the CSS was the teardown removing something nothing had added. */
function hasWriter(cls) {
  const esc = cls.replace(/[-]/g, '\\-');
  const patterns = [
    new RegExp('classList\\s*\\.\\s*add\\s*\\(\\s*[\'"]' + esc + '[\'"]'),
    new RegExp('classList\\s*\\.\\s*toggle\\s*\\(\\s*[\'"]' + esc + '[\'"]'),
    new RegExp('className\\s*(?:\\+)?=\\s*[\'"][^\'"]*' + esc),
    new RegExp('class\\s*=\\s*"[^"]*\\b' + esc + '\\b'),
    new RegExp('classList\\s*\\.\\s*add\\s*\\([^)]*\\b' + esc + '\\b')
  ];
  if (patterns.some(p => p.test(ALL))) return true;

  /* INDIRECT WRITER, via a named constant. Several modules do
        var BODY_CLASS = 'mls-ot3';  ...  document.body.classList.add(BODY_CLASS)
     and a literal-only search cannot see that. The first version of this suite
     reported three such classes as dead, which is a FALSE ALARM - and by this
     file's own argument, a suite that cries wolf gets switched off, so the
     detector has to be at least as clever as the code it judges.
     Resolved conservatively: the identifier must be bound to this exact class
     string, and the SAME FILE must pass that identifier to a classList mutation. */
  return Object.keys(TEXT).some(f => {
    const src = TEXT[f];
    const bind = new RegExp('(?:var|let|const)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[\'"]' + esc + '[\'"]');
    const m = src.match(bind);
    if (!m) return false;
    const id = m[1].replace(/\$/g, '\\$');
    return new RegExp('classList\\s*\\.\\s*(?:add|toggle)\\s*\\(\\s*' + id + '\\b').test(src);
  });
}

const dead = [];
[...styled].sort().forEach(cls => {
  if (!hasWriter(cls)) dead.push(cls);
});

ok(dead.length === 0,
  'EVERY module-owned trigger class this app styles is actually SET somewhere',
  dead.length
    ? 'these are styled but NEVER added - the rules keyed on them can never fire:\n          - '
      + dead.join('\n          - ')
      + '\n        Either wire a real writer, or delete the rules. A guard or a moment that\n' +
        '        cannot fire is worse than none, because review reads it as handled.'
    : '');

/* NON-VACUITY: the two classes this law was written for must be in scope and
   must now have writers. If a refactor renames them, this suite must fail loudly
   rather than pass on an empty set. */
ok(styled.has('mls-note-live'),
  'non-vacuity: body.mls-note-live is in scope (it was the worst offender - styled by four modules, set by none)');
ok(hasWriter('mls-note-live'),
  'body.mls-note-live now has a real writer',
  'four modules style on it; without a writer all four stand-downs are decorative');
ok(hasWriter('mg-pt-swap'),
  'the patient-swap moment now has a real writer',
  'its only previous mention outside the CSS was the remove() in revert()');

/* And the magic module must not have gone back to being pure CSS: it has to
   listen to something real. */
const MAGIC = TEXT['feat_mls_magic.js'] || '';
ok(/addEventListener\(\s*['"]mls:generation-complete/.test(MAGIC) ||
   /'mls:generation-complete'/.test(MAGIC),
  'the magic layer listens to a real app event rather than waiting for a class nobody sets',
  'mls:generation-complete is dispatched by the app at three sites');

console.log(failures === 0
  ? '\nPASS  styled-trigger-classes-have-writers: no module styles a trigger class that nothing turns on.'
  : '\nFAIL  styled-trigger-classes-have-writers: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
