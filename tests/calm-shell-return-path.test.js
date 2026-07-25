'use strict';

/* b587 — leaving the redesign must not be a one-way door.
 *
 * "Classic layout" writes mlsCalmShell='0', and enabled() honours that stored
 * preference on every later load. Until b587 nothing anywhere in the app read
 * that preference back the other way: measured on the running page at b585,
 * after one click on Classic layout there were ZERO visible controls in the
 * whole app mentioning the new layout, and the only routes back were typing
 * ?ui=calm by hand or clearing site data.
 *
 * That is the same defect class as shell-hidden-controls-keep-reach — a
 * capability with no route back — except the capability here is the entire
 * redesign, and the owner's one unambiguous piece of praise for it was "I love
 * the bottom bar".
 *
 * The dock still carries no permanent "go back" button, by design. The return
 * control exists ONLY in the classic layout, where the shell module is the one
 * thing that still knows the redesign is there.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* 1. The control exists and is a real, labelled control. */
assert(/function\s+mountReturn\s*\(/.test(shell),
  'feat_mls_calm_shell.js lost mountReturn(): the classic layout would again have no way back.');
assert(shell.includes("'mlsCalmReturn'"),
  'the return control lost its #mlsCalmReturn id, so nothing can find or test it.');
assert(/b\.textContent\s*=\s*'Use the new layout'/.test(shell),
  'the return control lost its visible label. An unlabelled chip is not a route back.');

/* 2. Boot offers it whenever the shell is switched off, rather than returning
 *    silently and leaving the user stranded. */
assert(/if\s*\(!enabled\(\)\)\s*return\s+mountReturn\(\);/.test(shell),
  'boot() no longer offers the return control when the shell is disabled. ' +
  'A stored mlsCalmShell=0 would strand the user in the classic layout forever.');

/* 3. Every user-initiated switch to classic offers the way back in the SAME
 *    gesture, so the user never sees a classic screen with no exit. Both call
 *    sites matter: the header button and the Tools menu row. */
const classicWrites = shell.match(/localStorage\.setItem\(STORE_KEY,\s*'0'\)/g) || [];
assert(classicWrites.length >= 2,
  'expected at least two switch-to-classic call sites (header button + Tools row), found ' +
  classicWrites.length + '. If a site was removed, confirm the remaining ones still mount the return.');

const mountCalls = (shell.match(/safe\(mountReturn\)/g) || []).length;
assert(mountCalls >= 2,
  'expected every user-initiated switch to classic to be followed by safe(mountReturn); found ' +
  mountCalls + ' call(s). A switch that does not mount the return recreates the one-way door.');

/* 4. Never before auth settles. The legacy #mlsFab shipped exactly this bug —
 *    a floating control painted over the login surface. */
assert(/authScreen[\s\S]{0,120}return false/.test(shell),
  'mountReturn() no longer refuses while the auth screen is visible; the return chip ' +
  'could paint over the login surface.');

/* 5. It must not be mounted from teardown() itself. teardown() also runs on
 *    boot()'s error path, where re-offering the shell that just threw invites a
 *    boot -> throw -> offer -> boot loop. */
const teardownBody = (function () {
  const start = shell.indexOf('function teardown()');
  assert(start > -1, 'teardown() is gone');
  const end = shell.indexOf('\n  function ', start + 10);
  return shell.slice(start, end > start ? end : start + 2000);
})();
assert(!/mountReturn/.test(teardownBody),
  'teardown() mounts the return control directly. It also runs on the boot error path, ' +
  'so the failing shell would keep offering itself. Mount from the user-initiated switches instead.');

console.log('PASS calm shell return path: leaving the redesign is reversible from the UI, never before auth, and not from the error path');
