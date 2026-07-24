'use strict';

/* UI control coverage — slice S0 of UI_CHARTER_CALM_SHELL_2026-07-24.md.
 *
 * The owner's constraint on the whole UI rework is: "ease of use without losing
 * any features." This suite is what makes that mechanical instead of a promise.
 *
 * It regenerates the control inventory, refuses a stale committed manifest, and
 * then asserts that EVERY active control resolves to at least one reach path in
 * EVERY declared shell. When the Calm Shell hides the 13-tab rail, those tabs
 * have to show up in the dock map or this fails by name and source line.
 *
 * Deliberately not a rubber stamp: a control whose only reach path is Ask fails.
 * Ask reaches everything by construction, so allowing Ask-only would let the
 * shell quietly drop any control it liked.
 */

const fs = require('fs');
const path = require('path');
const inventory = require('../tools/ui-control-inventory.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(__dirname, 'fixtures', 'ui-control-manifest.json');
const REACH = path.join(__dirname, 'fixtures', 'ui-reach-map.json');
const SHELL_MODULE = path.join(ROOT, 'feat_mls_calm_shell.js');

const failures = [];
function fail(msg) { failures.push(msg); }

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* ---- 1. the committed manifest must be current -------------------------- */

if (!fs.existsSync(MANIFEST)) {
  throw new Error('ui-control-manifest.json is missing. Run: node tools/ui-control-inventory.js');
}

const committed = readJson(MANIFEST);
const fresh = inventory.build();

/* Deliberately excludes line numbers. Every edit anywhere in a 1.9 MB file
 * shifts thousands of lines, and failing other sessions' commits over a shifted
 * line would make this suite something people route around. What matters for
 * "no feature lost" is the SET of controls and where each one lives, so the
 * fingerprint is (file, kind, container, gated, label). Add, remove or relabel
 * a control and this fails until the manifest is regenerated — which is exactly
 * the moment a reach path has to be decided. */
function fingerprint(m) {
  return m.controls.map(function (c) {
    return [c.file, c.kind, c.view, c.gated ? 'G' : 'A', c.label].join('|');
  }).sort().join('\n');
}

if (fingerprint(committed) !== fingerprint(fresh)) {
  const a = fingerprint(committed).split('\n');
  const b = fingerprint(fresh).split('\n');
  const onlyFresh = b.filter(function (x) { return a.indexOf(x) === -1; }).slice(0, 8);
  const onlyCommitted = a.filter(function (x) { return b.indexOf(x) === -1; }).slice(0, 8);
  fail('Committed ui-control-manifest.json is STALE. Run: node tools/ui-control-inventory.js\n' +
    (onlyFresh.length ? '  new/changed in source:\n    ' + onlyFresh.join('\n    ') + '\n' : '') +
    (onlyCommitted.length ? '  in manifest but not in source:\n    ' + onlyCommitted.join('\n    ') : ''));
}

/* ---- 2. every control resolves in every shell --------------------------- */

const reach = readJson(REACH);
const shellNames = Object.keys(reach.shells);
const independent = reach.shellIndependent || {};

function resolve(control, shellName) {
  const shell = reach.shells[shellName];
  const view = control.view;

  const explicitKeys = [];
  if (control.domId) explicitKeys.push(control.domId);
  explicitKeys.push(view + '::' + control.label);
  explicitKeys.push(view);

  for (const key of explicitKeys) {
    const hit = shell.controls && shell.controls[key];
    if (hit) return Array.isArray(hit) ? hit.slice() : [hit];
  }

  if (Object.prototype.hasOwnProperty.call(independent, view)) return [independent[view]];

  if (shell.viewHomes && shell.viewHomes[view]) return ['panel'];

  if (shell.dock) {
    for (const dest of Object.keys(shell.dock)) {
      if (shell.dock[dest].indexOf(view) !== -1) return ['panel'];
    }
  }

  return [];
}

const active = fresh.controls.filter(function (c) { return !c.gated; });

for (const shellName of shellNames) {
  const orphans = [];
  const askOnly = [];
  for (const control of active) {
    const paths = resolve(control, shellName);
    if (!paths.length) {
      orphans.push(control);
      continue;
    }
    const visible = paths.filter(function (p) { return p !== 'ask'; });
    if (!visible.length) askOnly.push(control);
  }

  if (orphans.length) {
    fail('Shell "' + shellName + '": ' + orphans.length + ' control(s) have NO reach path — ' +
      'these features would be lost:\n' + orphans.slice(0, 25).map(function (c) {
        return '    ' + c.file + ':' + c.line + '  [' + c.view + ']  "' + c.label + '"';
      }).join('\n') + (orphans.length > 25 ? '\n    ...and ' + (orphans.length - 25) + ' more' : ''));
  }

  if (askOnly.length) {
    fail('Shell "' + shellName + '": ' + askOnly.length + ' control(s) are reachable ONLY by typing ' +
      'their name in Ask. A doctor has to be able to find them by looking:\n' +
      askOnly.slice(0, 15).map(function (c) {
        return '    ' + c.file + ':' + c.line + '  "' + c.label + '"';
      }).join('\n'));
  }
}

/* ---- 3. every view has a home in every shell ---------------------------- */

const views = Object.keys(fresh.views).filter(function (v) {
  return /View$/.test(v);
});

for (const shellName of shellNames) {
  const shell = reach.shells[shellName];
  for (const view of views) {
    let homed = Boolean(shell.viewHomes && shell.viewHomes[view]);
    if (!homed && shell.dock) {
      homed = Object.keys(shell.dock).some(function (dest) {
        return shell.dock[dest].indexOf(view) !== -1;
      });
    }
    if (!homed) {
      fail('Shell "' + shellName + '": view ' + view + ' has no home. ' +
        (fresh.views[view] || 0) + ' control(s) live there.');
    }
  }
}

/* ---- 4. the shell module must honour the contract ----------------------- */

if (fs.existsSync(SHELL_MODULE)) {
  const src = fs.readFileSync(SHELL_MODULE, 'utf8');
  const declared = [];
  const re = /MLS_DOCK_DEST\s*:\s*\[([^\]]*)\]/;
  const m = re.exec(src);
  if (!m) {
    fail('feat_mls_calm_shell.js must declare MLS_DOCK_DEST: [...] so the reach map and the ' +
      'shipped dock cannot drift apart.');
  } else {
    const found = m[1].match(/['"]([a-z]+)['"]/g) || [];
    found.forEach(function (q) { declared.push(q.replace(/['"]/g, '')); });
    const expected = Object.keys(reach.shells.calm.dock).sort();
    if (declared.slice().sort().join(',') !== expected.join(',')) {
      fail('Dock destinations drifted: module declares [' + declared.join(', ') +
        '], reach map declares [' + expected.join(', ') + '].');
    }
  }

  /* The rail is hidden, never removed — removal orphans every reader and test
     that keys off .mainnav, and it is not reversible without a reload. */
  if (/mainnav[^\n]{0,120}\.remove\(\)/.test(src) || /removeChild[^\n]{0,60}mainnav/.test(src)) {
    fail('feat_mls_calm_shell.js removes .mainnav from the DOM. Hide it with CSS instead ' +
      '(charter layer 1: hidden is not removed).');
  }

  /* Escape hatch: the owner must always be one click from the old shell. */
  if (!/ui=classic|calmShellOff|Classic layout/i.test(src)) {
    fail('feat_mls_calm_shell.js must ship the Classic layout escape hatch (charter rollout §4).');
  }

  /* showView stays the switcher. */
  if (/function\s+showView\s*\(/.test(src)) {
    fail('feat_mls_calm_shell.js re-implements showView(). The shell wraps it, never replaces it ' +
      '(b473 lesson: find the writer, never out-write it).');
  }

  /* One passive timer at most. A standing interval in the shell would run for
     every minute of a clinic day behind everything else the app is doing. */
  if (/setInterval\s*\(/.test(src)) {
    fail('feat_mls_calm_shell.js uses setInterval. The shell is event-driven: one scoped observer ' +
      'coalesced through rAF, plus self-cancelling timeouts.');
  }

  /* The displaced header controls must have a real home, not just a map entry. */
  if (!/TOOLS_SOURCES/.test(src)) {
    fail('feat_mls_calm_shell.js must build the Tools menu from the controls the shell displaces ' +
      '(Templates, Settings, Custom widget, Patient intake, Log out, overflow rail tabs). ' +
      'Without it the reach map claims dock:tools for controls nothing surfaces.');
  }

  if (!/revert\s*:/.test(src)) {
    fail('feat_mls_calm_shell.js must export revert() — every module in this app can be taken back out.');
  }

  /* A shell that delegates with el.click() sends isTrusted:false, and the app
     deliberately refuses that on controls which may only be driven by a real
     human gesture (startPhoneMic and startPhoneMicFromEasy return silently;
     feat_mls_exact_encounter_verify.js refuses audibly). Those controls must be
     SHOWN, never fired — and the guard must not quietly disappear in a later
     refactor, because the failure mode is a button that does nothing at all. */
  if (!/function\s+trustedGated\s*\(/.test(src)) {
    fail('feat_mls_calm_shell.js must keep trustedGated(): trusted-gesture controls are spotlighted, ' +
      'never proxied. isTrusted cannot be forged, so a proxied click on one is a silent no-op.');
  }
  ['phoneMicBtn', 'mlsSyncVerifyNow'].forEach(function (id) {
    if (src.indexOf(id) === -1) {
      fail('feat_mls_calm_shell.js no longer lists #' + id + ' as trusted-gesture gated. ' +
        'Proxying it would silently do nothing.');
    }
  });
  if ((src.match(/runControl\(/g) || []).length < 4) {
    fail('every place the shell acts on a control (right-now bar, Tools menu, Ask) must go through ' +
      'runControl(), so the trusted-gesture rule cannot be bypassed by one call site drifting.');
  }
  if (/isTrusted\s*[:=]/.test(src) || /new\s+MouseEvent|dispatchEvent\s*\(/.test(src)) {
    fail('feat_mls_calm_shell.js appears to synthesize an event. Trust is set by the browser and must ' +
      'never be faked to get past a clinical guard — spotlight the control instead.');
  }
}

/* ---- report ------------------------------------------------------------- */

if (failures.length) {
  console.error('FAIL ui-control-coverage\n\n' + failures.join('\n\n'));
  process.exit(1);
}

console.log('PASS ui-control-coverage: ' + active.length + ' active controls (' +
  (fresh.totals.controls - active.length) + ' gated) reach-checked across ' +
  shellNames.length + ' shells [' + shellNames.join(', ') + ']');
