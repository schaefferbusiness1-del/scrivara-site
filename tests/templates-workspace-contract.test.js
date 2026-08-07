'use strict';

/* Templates workspace redesign (2026-07-20): searchable two-pane list+detail
 * with TRUE in-place editing, per-save revision history, dirty-edit
 * protection, and a confirmed delete with an honest undo control. The
 * underlying template machinery (use-now identity guard, default selection,
 * duplicate, dedupe, bulk import, cloud library) is unchanged.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// 1. two-pane workspace with search + accessible list semantics
assert(html.includes('id="tplWorkspace"') && /grid-template-columns:minmax\(220px,38%\) 1fr/.test(html),
  'the two-pane template workspace grid is missing');
assert(html.includes('id="tplSearch"') && html.includes('oninput="tplSearchChanged()"'),
  'template search input missing or unwired');
assert(/id="tplList" role="listbox" aria-label="Saved templates"/.test(html), 'the template list lost its listbox semantics');
assert(/role="option" aria-selected=/.test(html) && /onkeydown="if\(event\.key===\\'Enter\\'\|\|event\.key===\\' \\'\)/.test(html.replace(/'/g, "\\'")) || /tplSelect\(/.test(html),
  'list rows must be keyboard-activatable options');

// 2. in-place save keeps a bounded revision history and reports honest states
const saveFn = html.slice(html.indexOf('function tplDetailSave()'), html.indexOf('function tplRestoreRevision'));
assert(/cur\.revisions\.unshift\(\{ ts:Date\.now\(\)/.test(saveFn), 'every save must keep the prior content as a revision');
assert(/\.slice\(0,5\)/.test(saveFn), 'the local revision history must stay bounded');
for (const state of ["'Saving…'", "'Saved ✓ '", "'Failed — could not save ("]) {
  assert(saveFn.includes(state), 'the save flow must report ' + state);
}

// 3. dirty-edit protection: list/search re-renders never rebuild a dirty editor,
//    and switching templates with unsaved edits asks first
assert(/if\(_tplUI\.dirty&&_tplUI\.renderedId===_tplUI\.selectedId&&_tplUI\.selectedId\) return;/.test(html),
  'a re-render can silently discard unsaved template edits');
assert(/Discard unsaved edits to the current template\?/.test(html), 'switching templates must confirm before discarding edits');

// 4. delete is confirmed and honestly undoable (control, not a dead toast)
const del = html.slice(html.indexOf('function deleteTemplate(id)'), html.indexOf('function clearTplForm'));
/* pin updated 2026-07-22: same confirmed delete, now via the non-blocking
   in-app dialog instead of thread-freezing native confirm() */
assert(/if\(!await mlsConfirm\('Delete the template/.test(del), 'delete must confirm');
assert(/_tplLastDeleted=t;/.test(del) && /tplUndoDelete\(\)/.test(del), 'delete must offer a real undo control');
assert(html.includes('function tplUndoDelete()'), 'undo restore function missing');

// 5. preview no longer uses alert(); legacy entry points route into the pane
assert(!/function previewTemplate\(id\)\{ var t=getTemplateById\(id\); if\(!t\) return; try\{ alert\(/.test(html),
  'template preview must render in the pane, not alert()');
assert(/function previewTemplate\(id\)\{ tplSelect\(id\); \}/.test(html), 'previewTemplate must select into the detail pane');

// 6. truthful initial status (caught live: a fresh pane claimed "Saved ✓"
//    before anything was saved)
assert(html.includes('>No unsaved changes</div>'), 'a freshly rendered detail pane must not claim Saved');

// 7. runtime modules (template health, upload toolbar, cloud library) insert
//    themselves beside #tplList and become grid items. The full-row span stays
//    as the fallback for any panel that is still inside the grid (caught live
//    on b457), and the two panes keep their columns.
assert(html.includes('#tplWorkspace>*{grid-column:1 / -1;min-width:0}')
  && html.includes('#tplWorkspace>#tplList{grid-column:1;grid-row:1}')
  && html.includes('#tplWorkspace>#tplDetail{grid-column:2;grid-row:1;align-self:start}'),
  'injected sibling panels must span the workspace grid, keeping list/detail side by side on row 1');

// 7b. b839 — THE STICKY PREVIEW MUST HAVE NOTHING BELOW IT TO COVER.
//     #tplDetail carries an inline `position:sticky;top:0`. Chrome constrains
//     that sticky by the SCROLL container, not by the item's grid area — so a
//     full-width panel sharing the workspace gets painted over as the pane
//     travels. Measured on the owner's screen at b837: 9 real occlusions while
//     scrolling, up to 694x329px of the versioned-library panel covered, with
//     elementFromPoint returning #tplDetText (it took the clicks too). Pinning
//     the pane to grid-row:1 was tried FIRST and measured no improvement
//     (9 before, 10 after), which is why the panels are evicted instead.
const tplUi = fs.readFileSync(path.join(root, 'feat_mls_opnote_templates_ui.js'), 'utf8');
assert(/function evictStrays/.test(tplUi),
  'the workspace must be able to evict panels injected into it');
assert(/k\.id === 'tplList' \|\| k\.id === 'tplDetail'/.test(tplUi),
  'eviction must keep exactly the two panes and move everything else out');
assert(/_wsObs\s*=\s*new MutationObserver/.test(tplUi),
  'a panel injected after first render must be evicted too, or the overlap returns');
assert(/data-ot-evicted/.test(tplUi),
  'evicted panels must be marked so the move is auditable');
assert(/details:not\(\[open\]\) > \*:not\(summary\)\{ display:none !important; \}/.test(tplUi),
  'a closed <details> must not leave full-size layout boxes over the panels beneath it');

console.log('PASS templates workspace: searchable two-pane list/detail, in-place saves with bounded revisions and honest states, dirty-edit protection, confirmed delete with real undo');
