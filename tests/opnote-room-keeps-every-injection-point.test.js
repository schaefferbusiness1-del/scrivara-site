'use strict';

/* THE ROOM KEEPS EVERY INJECTION POINT (Stage 4 of the workroom plan).
 *
 * The workroom transformed the op-note drafter's PRESENTATION only. A fleet
 * of satellites reaches INTO the room by id and structure; each anchor below
 * is load-bearing, and the b669 rule applies: removing one must fail HERE,
 * BY NAME, naming the satellite that dies - not as a mystery three modules
 * away. Both halves are pinned for each seam: the anchor in the room's
 * markup/render, and the satellite code that grips it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const onf = fs.readFileSync(path.join(root, 'feat_mls_opnote_fill.js'), 'utf8');
const hist = fs.readFileSync(path.join(root, 'feat_opnote_history.js'), 'utf8');
const opnp = fs.readFileSync(path.join(root, 'feat_mls_opnote_prep.js'), 'utf8');
const oni = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* 1. THE CONTAINER. Three satellites display-gate the entire Fields box on
 * this exact id + class-toggled open; the attribute run is byte-pinned. */
assert(app.includes('<div class="modal-bg opr-room" id="opPrepModal" role="dialog" aria-modal="true" aria-labelledby="opPrepHdr">'),
  'the room container attributes moved - onf/history/opnp modalOpen() gates and the a11y contract die');
assert(onf.includes("'opPrepModal'"), 'onf lost its grip on #opPrepModal - every .onf-fillbox in the app dies silently');
assert(hist.includes("'opPrepModal'"), 'opnote-history lost its grip on #opPrepModal - the relabeler dies');
assert(opnp.includes("'opPrepModal'"), 'opnote-prep lost its grip on #opPrepModal - its readiness UI dies');

/* 2. THE NOTE TEXTAREA + its FREE previous-sibling slot (onf inserts the
 * Fields box there). */
assert(app.includes('<textarea id="opPrepNote_'), 'the per-row note textarea id moved - onf has nowhere to put the Fields box');
assert(/opPrepNote_/.test(onf), 'onf no longer targets opPrepNote_ - the Fields box never renders');

/* 3. THE TEMPLATE SELECT + the badge slot: its parent row's FIRST span.mini
 * holds a span - the integrity badge writes there (oni ~:583). */
assert(app.includes('<span class="mini" style="color:var(--muted)">Template <span'),
  'the template label span.mini>span slot moved - the oni match-source badge dies');
assert(app.includes('<select id="opPrepTpl_'), 'the per-row template select id moved - oni and tpf lose the dropdown');
assert(/opPrepTpl_/.test(oni), 'oni no longer targets opPrepTpl_ - sticky manual picks and badges die');

/* 4. DRAFT-ALL: a real node with a real rect inside a .row - the tpf capture
 * interceptor and the history relabeler need THAT node. */
assert(app.includes('<div class="row" style="margin:6px 0 12px;flex-wrap:wrap;gap:8px">\n          <button class="btn-primary" id="opPrepGenAllBtn"'),
  'opPrepGenAllBtn left its .row - the tpf capture interceptor and the relabeler die');
assert(connect.includes('opPrepGenAllBtn'), 'mls-connect (tpf) no longer targets opPrepGenAllBtn');

/* 5. MODE/DAY PICKERS: opnp and the day-row injectors find these by id in the
 * rail; opPrepRender restyles them every pass. */
['opPrepModeRow', 'opPrepDayRow', 'opPrepModePatient', 'opPrepModeAll', 'opPrepDayInput', 'opPrepDayLbl'].forEach(function (id) {
  assert(app.includes('id="' + id + '"'), 'rail anchor #' + id + ' is gone - the mode/day pickers detach from the render');
});

/* 6. STATUS/EMPTY/LIST/PREVIEW: the render's own anchors, also gripped by the
 * bulk-draft progress and the preview updater. */
['opPrepStatus', 'opPrepEmpty', 'opPrepList'].forEach(function (id) {
  assert(app.includes('id="' + id + '"'), 'editor anchor #' + id + ' is gone - status/empty/list rendering dies');
});
assert(app.includes("id=\"opPrepPrev_'+i+'\""), 'the per-row preview anchor moved - _opProcChanged live preview dies');

/* 7. STAGE-4 PRESENTATION: one exit only (the modal-x; the bottom Close row
 * is retired), and the empty states teach in one sentence. */
assert(!/<div class="row" style="margin-top:14px"><button class="btn-ghost" onclick="closeOpPrep\(\)"/.test(app),
  'the second exit (bottom Close row) is back - the room has ONE exit');
assert(app.includes('onclick="closeOpPrep()" aria-label="Close op-note prep"'),
  'the one exit (modal-x) lost its accessible name');
assert(app.includes('gathers every missing detail into one <b>Fields</b> box'),
  'the rail note lost its one-sentence teaching line');
assert(app.includes('Upload your operative-note templates on the <b>Templates</b> tab first'),
  'the no-templates empty state no longer points at the in-room Templates tab');

console.log('PASS op-note room injection points: container attrs, note-slot, template select + badge slot, Draft-all row, mode/day rail, status/empty/list/preview anchors, one-exit + one-sentence empty states - each pinned with the satellite it keeps alive');
