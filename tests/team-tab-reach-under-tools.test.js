'use strict';
/*
 * Team must be reachable UNDER TOOLS — and the only thing that may withhold it
 * is the documented release hold, never a stray inline hide.
 *
 * WHAT WAS ACTUALLY FOUND, 2026-07-26, because the assignment guessed a
 * different cause and the difference matters:
 *
 *   #nav_team does carry an inline display:none. It is NOT stray and it is NOT
 *   a settings toggle. It has TWO owners and both are deliberate:
 *     1. the static markup ships style="display:none";
 *     2. applyAccessUI() computes it every time from
 *        `__MLS_TEAM_WORKSPACE_RELEASED === true && backendMode() && isHead`.
 *   `__MLS_TEAM_WORKSPACE_RELEASED` is defined with
 *   {value:false, writable:false, configurable:false} — deliberately
 *   IMMUTABLE — under the comment "Team/supervision is held until its role,
 *   persistence, and cosign paths are released". showView('team') fails closed
 *   on the same flag, and installHeldWorkflowNetworkBoundary() blocks
 *   /api/team/(lawyers|doctors) at the fetch layer.
 *
 * So Team is not "missing". It is HELD, by a clinical-supervision release gate
 * that tests/legal-network-workspace-held.test.js already pins. Releasing it
 * is a release decision, not a layout fix, and it is not a worker's to make.
 *
 * What this suite guarantees instead is the thing that WILL be true the moment
 * that flag flips: Tools already offers Team, and nothing else suppresses it.
 * BOTH DIRECTIONS are exercised against the shell's real available() so the
 * claim is functional, not a grep:
 *   - an element carrying inline display:none is NOT offered  (today)
 *   - the same element without it IS offered                  (after release)
 * If someone ever "fixes" this by deleting the inline hide while the workspace
 * is still held, the doctor gets a Tools row that toasts "The Team workspace
 * is not released." — a route that goes nowhere, which rule 10 forbids. That
 * is why the hold and the reachability are asserted together, here.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* ---- 1. Tools is the design: the dock does not grow a Team destination ----- */
assert(/tools:\s*\[[^\]]*'nav_team'/.test(shell),
  "the Tools destination no longer lists nav_team — Team's route is Tools, not a dock button");
assert(/\{\s*id:\s*'nav_team'\s*\}/.test(shell),
  'nav_team is no longer a TOOLS_SOURCES entry, so the Tools menu cannot offer it at all');
const dockDest = /MLS_DOCK_DEST:\s*\[([^\]]*)\]/.exec(shell);
assert(dockDest, 'the dock destination contract is gone');
assert(!/team/.test(dockDest[1]),
  'Team was added as a DOCK destination. The dock is the whole navigation story and it is fixed at Day/Patient/Visit/Review/AI Studio/Tools/Copilot — Team belongs under Tools.');

/* ---- 2. the hold is the ONLY thing suppressing it -------------------------- */
assert(/__MLS_TEAM_WORKSPACE_RELEASED:\{value:false,writable:false,configurable:false\}/.test(app),
  'the Team release flag is no longer an immutable false');
assert(app.includes("teamTab.style.display=(window.__MLS_TEAM_WORKSPACE_RELEASED===true&&backendMode()&&isHead)?'':'none'"),
  'the Team tab\'s visibility no longer derives from the release flag — if a different owner now hides it, Team will stay invisible after the workspace is released');
assert(app.includes("if(v==='team'&&window.__MLS_TEAM_WORKSPACE_RELEASED!==true)"),
  'showView no longer fails closed on the Team release flag');

/* ---- 3. BOTH DIRECTIONS, against the shell's real available() -------------- */
const availSrc = shell.slice(shell.indexOf('function available(el)'), shell.indexOf('function toolsItems()'));
assert(availSrc.includes("el.style.display === 'none'"),
  'available() no longer reads inline display, so this simulation would not reflect the shipped behaviour');
const ctx = vm.createContext({});
vm.runInContext(availSrc + '\nthis.available = available;', ctx);
const available = ctx.available;

const held = { hidden: false, disabled: false, style: { display: 'none' }, getAttribute: () => null };
const released = { hidden: false, disabled: false, style: { display: '' }, getAttribute: () => null };
assert.strictEqual(available(held), false,
  'a held Team tab is being offered in Tools anyway — the doctor would get a menu row that refuses');
assert.strictEqual(available(released), true,
  'a released Team tab would STILL not be offered in Tools — releasing the workspace would not be enough to make it reachable');

console.log('PASS team reach: Team is offered under Tools and nowhere else, its only suppressor is the immutable release hold, and available() withholds it while held / offers it once released');
