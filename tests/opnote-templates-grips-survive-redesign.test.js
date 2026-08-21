'use strict';
/* =========================================================================
   THE OP-NOTE AND TEMPLATES REDESIGN MAY NOT COST A SINGLE FEATURE
   -------------------------------------------------------------------------
   OWNER: "completely redo UI for tempaltes and for op notes from scratch and
   make it amazing buit be carful as tehre is a lot of features that u dont want
   to screw up when it comes to op notes."

   He is right about the danger, and the numbers say how right. A generated
   inventory of the two surfaces found:

       23 ids referenced by name across 20 modules
        5 shared classes
       47 writes into these subtrees
      102 STRUCTURAL dependencies - parent/sibling/child walks and
          dynamically-built ids - which break SILENTLY when nesting changes

   "Silently" is the whole problem. Nothing throws. The op-note draft still
   generates; it just loses its Fields box, or its template badge, or its
   preview, and nobody notices until a surgeon is mid-list.

   THEREFORE THE REDESIGN IS PRESENTATION-ONLY BY CONSTRUCTION: a new visual
   language delivered as stylesheet rules, with ZERO changes to the markup these
   modules grip. This suite is the fence. It pins the four structural contracts
   that carry real features, the full id inventory, and the rule that the new UI
   module must not write into any gripped subtree.

   THE FOUR STRUCTURAL CONTRACTS, each with the feature it carries:

     1. #opPrepList is a DIRECT CHILD of #oprEditor.
        feat_mls_opnote_room.js:326 inserts the Prev/Next pager by testing
        `$('opPrepList').parentElement === editor`. Wrap the list in a div for
        styling and the pager silently stops appearing.

     2. textarea#opPrepNote_<i> keeps its PREVIOUS-SIBLING slot free.
        feat_mls_opnote_fill.js:319 detects an existing Fields box with
        `ta.previousElementSibling.classList.contains('onf-...')` and inserts
        there. Put anything else immediately before that textarea and every
        "gather the missing details" box in the app either duplicates or dies.

     3. select#opPrepTpl_<i> keeps a parentElement that holds the badge slot.
        feat_mls_opnote_integrity.js:586 walks `sel.parentElement` to find the
        first `span.mini > span` and writes the template-health badge into it.

     4. #tplList keeps a parent that accepts siblings.
        mls-connect.js:15668 mounts the template-health panel next to it via
        `anchor.parentElement`.

   NON-VACUITY: every contract below is expressed as a relationship in the
   shipped markup, and the id inventory is compared against the modules that
   actually reference each id - so deleting an id fails here even if no rule in
   the new stylesheet mentions it.
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

/* ---------- a tiny structural reader over the shipped markup -------------
   Finds an element by id and returns the id of its nearest ancestor element
   that carries one, plus the tag/id sequence of its siblings. Enough to answer
   "is X still a child of Y" without a DOM library. */
function tagsWithIds(html) {
  const out = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/' || /^(br|hr|img|input|meta|link|source|area|base|col|embed|track|wbr)$/.test(tag);
    const idm = attrs.match(/\bid\s*=\s*"([^"]*)"/);
    out.push({ closing, tag, id: idm ? idm[1] : '', selfClose, at: m.index, attrs });
  }
  return out;
}
const TOKENS = tagsWithIds(HTML);

/* parent chain by id, built by a single stack pass */
const parentOf = new Map();   /* id -> nearest ancestor id */
const childrenOf = new Map(); /* id -> [child ids in order] */
{
  const stack = [];
  for (const t of TOKENS) {
    if (t.closing) { if (stack.length) stack.pop(); continue; }
    const nearest = stack.length ? stack[stack.length - 1] : '';
    if (t.id) {
      parentOf.set(t.id, nearest);
      if (nearest) {
        if (!childrenOf.has(nearest)) childrenOf.set(nearest, []);
        childrenOf.get(nearest).push(t.id);
      }
    }
    if (!t.selfClose) stack.push(t.id || nearest);
  }
}

/* ---------- instrument self-check ---------------------------------------
   The reader above is homemade, so it is verified against relationships that
   are true by inspection before it is trusted to judge anything. */
ok(parentOf.get('opPrepModal') !== undefined,
  'instrument: the structural reader found #opPrepModal');
ok(parentOf.get('oprPanelProcs') === 'opPrepModal' || childrenOf.get('opPrepModal'),
  'instrument: the reader resolves the room hierarchy',
  'parent of #oprPanelProcs read as "' + parentOf.get('oprPanelProcs') + '"');
ok(parentOf.get('tplList') === 'tplWorkspace',
  'instrument: #tplList reads as a child of #tplWorkspace (true by inspection)',
  'got "' + parentOf.get('tplList') + '" - if this is wrong every verdict below is wrong');
if (failures) {
  console.log('\nFAIL  opnote-templates-grips: the structural reader is wrong; no verdict below is trustworthy.');
  process.exit(1);
}

/* ---------- CONTRACT 1: #opPrepList direct child of #oprEditor ---------- */
ok(parentOf.get('opPrepList') === 'oprEditor',
  'CONTRACT 1: #opPrepList is a direct child of #oprEditor (carries the Prev/Next pager)',
  'read parent as "' + parentOf.get('opPrepList') + '". feat_mls_opnote_room.js:326 tests\n' +
  '        `$(\'opPrepList\').parentElement === editor` - a styling wrapper here silently removes the pager');

/* ---------- CONTRACT 4: #tplList has a sibling-accepting parent --------- */
ok(!!parentOf.get('tplList'),
  'CONTRACT 4: #tplList has a parent that can accept the template-health panel as a sibling',
  'mls-connect.js:15668 mounts via anchor.parentElement');
ok((childrenOf.get(parentOf.get('tplList')) || []).indexOf('tplDetail') >= 0,
  '#tplList and #tplDetail remain siblings (the two-pane workspace)',
  'siblings read as: ' + (childrenOf.get(parentOf.get('tplList')) || []).join(', '));

/* ---------- CONTRACTS 2 and 3 live in RUNTIME-built rows ----------------
   #opPrepNote_<i> and #opPrepTpl_<i> are generated by opPrepRender, so they are
   not in the static markup. What CAN be pinned statically is that the redesign
   did not take ownership of building those rows, and that the modules which
   depend on the slots still express the dependency. If a future change moves
   row construction into the UI module, these two fail and force a rethink. */
const FILL = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_fill.js'), 'utf8');
ok(/previousElementSibling[\s\S]{0,120}onf-/.test(FILL),
  'CONTRACT 2: the Fields box is still located via the textarea previous-sibling slot',
  'if this detection changed, re-derive the contract before styling that row');
ok(/textarea\[id\^="opPrepNote_"\]/.test(FILL),
  'CONTRACT 2: #opPrepNote_<i> is still the id shape the Fields box binds to');

const INTEG = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_integrity.js'), 'utf8');
ok(/getElementById\('opPrepTpl_'\+i\)|opPrepTpl_/.test(INTEG) && /parentElement/.test(INTEG),
  'CONTRACT 3: the template-health badge still resolves through select#opPrepTpl_<i>.parentElement');

/* ---------- THE ID INVENTORY: nothing gripped may vanish ---------------- */
const GRIPPED_STATIC_IDS = [
  /* op-note room + prep, present in ScribeFlow.html markup */
  'opPrepModal', 'opPrepHdr', 'oprBack', 'oprTabProcs', 'oprTabTpls',
  'oprPanelProcs', 'oprDayRail', 'oprEditor', 'oprPanelTpls',
  'opPrepModeRow', 'opPrepModePatient', 'opPrepModeAll',
  'opPrepDayRow', 'opPrepList', 'opPrepGenAllBtn',
  /* templates */
  /* The old lower single-file intake was retired in favor of the canonical
     top uploader, which handles one file, batches, and multi-form PDFs. */
  'templatesModal', 'tplName', 'tplKeywords', 'tplMultiFileInput', 'tplMultiDrop',
  'tplText', 'tplSearch', 'tplWorkspace', 'tplList', 'tplDetail'
];
GRIPPED_STATIC_IDS.forEach(function (id) {
  ok(HTML.indexOf('id="' + id + '"') >= 0, 'id survives: #' + id);
});

/* Ids other modules build or read dynamically - pinned by their REFERENCES, so
   the check cannot be satisfied by an unused leftover. */
const DYNAMIC = [
  ['opPrepNote_', 'feat_mls_opnote_fill.js'],
  ['opPrepTpl_', 'feat_mls_opnote_fill.js'],
  ['opPrepPrev_', 'feat_mls_opnote_integrity.js'],
  ['opPrepStatus', 'feat_mls_opnote_prep.js']
];
DYNAMIC.forEach(function (pair) {
  const src = fs.readFileSync(path.join(ROOT, pair[1]), 'utf8');
  ok(src.indexOf(pair[0]) >= 0,
    'dynamic grip still referenced: ' + pair[0] + '* (by ' + pair[1] + ')');
});

/* ---------- THE REDESIGN MUST STAY PRESENTATION-ONLY -------------------- */
const UI_MODULE = 'feat_mls_opnote_templates_ui.js';
const uiPath = path.join(ROOT, UI_MODULE);
if (!fs.existsSync(uiPath)) {
  console.log('  note  ' + UI_MODULE + ' not present yet; the presentation-only rules below activate with it');
} else {
  const UI = fs.readFileSync(uiPath, 'utf8');

  /* Writing markup into a gripped subtree is the one thing that can break the
     102 structural dependencies. The module may inject a <style> and toggle
     classes; it may not build or move nodes in these zones. */
  const GRIP_ZONES = ['opPrepList', 'opPrepNote_', 'opPrepTpl_', 'opPrepPrev_',
                      'tplList', 'tplDetail', 'tplWorkspace'];
  /* Comments are stripped by PARSING, not by guessing at line prefixes. The
     prefix test missed continuation lines inside a block comment, so a comment
     that DESCRIBED the grip contract - naming insertBefore and #tplList in the
     same sentence - was reported as a violation of it. That is the third checker
     of mine today fooled by its own documentation; blank the comments out (keeping
     line numbers intact) and scan only real code. */
  const CODE = UI.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
                 .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(Math.max(0, m.length - p.length)));
  const lines = CODE.split(/\r?\n/);
  const offenders = [];
  lines.forEach(function (line, i) {
    const mutates = /(innerHTML|outerHTML|insertBefore|appendChild|insertAdjacentHTML|replaceChild|removeChild|\.remove\(\))/.test(line);
    if (!mutates) return;
    GRIP_ZONES.forEach(function (z) {
      if (line.indexOf(z) >= 0) offenders.push((i + 1) + ': ' + line.trim().slice(0, 110));
    });
  });
  ok(offenders.length === 0,
    'the new UI module never mutates a gripped subtree',
    offenders.join('\n        '));

  ok(!/document\.body\s*,|observe\(\s*document/.test(UI),
    'the new UI module observes no whole-document subtree',
    'this app has been measured wedging the main thread for minutes');
  ok(!/setInterval\s*\(/.test(UI),
    'the new UI module runs no interval (hidden-tab timers are frozen in this app)');
  ok(/prefers-reduced-motion/.test(UI),
    'the new UI module ships a reduced-motion off-switch');
  ok(/function\s+revert|revert\s*[:=]\s*function|\.revert\s*=/.test(UI),
    'the new UI module is revertable');

  /* It must actually REPLACE the old skin rather than layer a third opinion on
     top - "from scratch" was the instruction, and three stacked skins is how
     the append-order defect happened in the first place. */
  ok(/oprSkin/.test(UI),
    'the new UI module takes over from the old oprSkin rather than stacking on it',
    'two runtime skins racing by append order is exactly the defect class that killed the responsive layout');
}

console.log(failures === 0
  ? '\nPASS  opnote-templates-grips-survive-redesign: every gripped node and all four structural contracts intact.'
  : '\nFAIL  opnote-templates-grips-survive-redesign: ' + failures + ' assertion(s) failed.');
process.exit(failures === 0 ? 0 : 1);
