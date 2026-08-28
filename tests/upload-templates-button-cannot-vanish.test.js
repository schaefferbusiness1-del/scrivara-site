'use strict';
/*
 * The "📤 Upload templates" control is INJECTED, not authored into the page,
 * and it can disappear in three different silent ways. Each one produces the
 * same user-visible symptom the owner has reported before: a control that is
 * simply not there, or is there and does nothing.
 *
 *   1. IT IS ANCHORED TO PROSE. findAnchor() scans the whole document for an
 *      element whose text matches /prep op note/i, then climbs to a card-sized
 *      ancestor and inserts the button after it. If that wording is ever
 *      edited - a copy change, nothing more - findAnchor() returns null,
 *      inject() returns, and the button never appears. No error, no log.
 *
 *   2. ITS CLICK IS INTERCEPTED BY TEXT. A capture-phase listener matches
 *      /upload templates/i on the clicked element's text and redirects to the
 *      full Templates panel instead of a bare file picker. Rename the button
 *      and the interception stops matching: the button still appears, but now
 *      opens the raw file input the redirect exists to replace.
 *
 *   3. TWO NAVIGATORS ADDRESS IT BY ID AND BY LABEL. The command palette and
 *      the quick-action list both look for #mlsUplTplBtn, falling back to
 *      /Upload templates/i. Change either and those entries dead-end on
 *      "Upload templates not found."
 *
 * None of these is hypothetical bad luck: they are three text couplings between
 * files that are edited independently. This pins all three so a copy edit fails
 * here rather than in the doctor's hands.
 *
 * It deliberately does NOT assert where the button is placed or what it should
 * open. That is an open product question - the button is parked on the Op Notes
 * card because that is where the anchor prose lives, and whether it should be
 * is the owner's call, not this file's.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* The served shells, and the lane script that injects into each. */
const LANES = [
  ['1pScribeFlow.html', '1p-mls-connect.js'],
  ['1p/index.html', '1p-mls-connect.js'],
  ['ScribeFlow.html', 'mls-connect.js'],
  ['cloned/index.html', 'cloned-mls-connect.js']
];

let checks = 0;
function ok(v, m) { assert.ok(v, m); checks++; }

for (const [shell, script] of LANES) {
  const html = read(shell);
  const js = read(script);

  /* ---- 1. the anchor the injector hunts for still exists in the page ---- */
  const anchorRe = /\/prep op note\/i\.test\(t\)/;
  ok(anchorRe.test(js),
    script + ': the upload-templates injector no longer anchors on /prep op note/i. If the anchor ' +
    'changed, update this pin; if the injector changed shape, re-derive it - do not delete the check, ' +
    'because an unanchored injector is a button that never appears.');
  ok(/prep op note/i.test(html),
    shell + ': the prose the "Upload templates" button anchors to is GONE. findAnchor() will return ' +
    'null, inject() will return, and the button will never be added to the page - silently. If this ' +
    'copy was renamed on purpose, the injector at ' + script + ':findAnchor must be renamed with it.');

  /* ---- 2. the label the click interceptor matches is still the label ---- */
  ok(/b\.textContent\s*=\s*'📤 Upload templates';/.test(js),
    script + ': the upload-templates button label changed. Its click is intercepted by TEXT ' +
    '(/upload templates/i), so a rename makes the button open the raw file picker instead of the ' +
    'Templates panel the redirect exists to provide.');
  ok(/if\(!\/upload templates\/i\.test\(txt\)\) return;/.test(js),
    script + ': the capture-phase redirect no longer matches the quick-action by text, so the ' +
    'button falls back to a bare file input.');
  ok(/openTemplatesPanel\(\);/.test(js),
    script + ': the intercepted click no longer opens the Templates panel.');

  /* ---- 3. both navigators still address a control that exists ---- */
  ok(/b\.id\s*=\s*'mlsUplTplBtn';/.test(js),
    script + ': the upload-templates button lost the id both navigators address it by.');
  const navigators = [...js.matchAll(/mlsUplTplBtn/g)];
  ok(navigators.length >= 3,
    script + ': fewer references to #mlsUplTplBtn than the definition plus its two navigators (' +
    navigators.length + ') - a palette or quick-action entry has been orphaned and will report ' +
    '"Upload templates not found."');

  /* ---- and the file input it ultimately triggers is really in the page ---- */
  ok(/tplMultiFileInput/.test(js) && /tplMultiFileInput/.test(html),
    shell + ' / ' + script + ': the multi-file template input the uploader triggers is missing from ' +
    'one side, so the upload path dead-ends.');
}

console.log('PASS upload-templates button cannot vanish: ' + checks +
  ' checks across 4 served shells - the prose its injector anchors to still exists, the label its ' +
  'click interceptor matches is still its label, the panel redirect still fires, both navigators ' +
  'still address a control that exists, and the file input it triggers is present on both sides');
