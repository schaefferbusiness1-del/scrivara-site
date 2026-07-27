'use strict';

/* SWEEP FIXES b711 - two defects found walking every surface at b710:
 *
 * 1. The public preview's SAMPLE WORKSPACE strip (bottom-fixed, 50px) painted
 *    over the dock's lower half - the ask bar and every dock label were
 *    clipped for every prospect (measured 32px overlap at 2320x1287). Body
 *    padding cannot move fixed chrome; the dock itself lifts in preview mode.
 * 2. History rows for op-note drafts rendered the patient name TWICE
 *    ("Bernard P Brooks - Bernard P Brooks - B/L L5 TF ESI P"): the autosave
 *    stores cc name-prefixed (the format draft-resume matches on) and the row
 *    template leads with the name again. Display-only de-dup; stored cc is
 *    untouched.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const preview = fs.readFileSync(path.join(root, 'public-preview-runtime.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

/* 1 - the dock clears the strip, in preview mode only, both breakpoints */
assert(preview.includes('body.mls-public-preview #mlsDock{bottom:74px;}'),
  'the dock must lift above the 50px preview strip on desktop');
assert(preview.includes('body.mls-public-preview #mlsDock{bottom:112px;}'),
  'the dock must lift above the wrapped strip on phone');
/* the fix must actually be served: the frozen token moved in BOTH loaders */
assert(app.includes('public-preview-runtime.js?v=b711'),
  'the page must load the fixed preview runtime');
assert(sw.includes('/public-preview-runtime.js?v=b711'),
  'the service worker precache must fetch the fixed preview runtime');
assert(!app.includes('public-preview-runtime.js?v=b497') && !sw.includes('public-preview-runtime.js?v=b497'),
  'the retired preview-runtime cache token must be unreachable');

/* 2 - history titles never lead with the name twice */
assert(app.includes("if(_pnDedup && _ccRaw.lastIndexOf(_pnDedup+' — ', 0)===0)"),
  'the history row must strip a cc that already leads with the patient name');
const storeAt = app.indexOf("(op-note draft)'");
assert(storeAt !== -1 && app.slice(storeAt - 120, storeAt).includes("p.name+' — '"),
  'the STORED cc format stays name-prefixed - draft-resume and fixtures match on it');
