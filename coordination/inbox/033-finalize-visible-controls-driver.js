'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EXPECTED_INPUT_SHA256 = '99c6573e0a9000171e36666c655e94c00371dce746e7807f10adbfcd95f31731';
const EXPECTED_OUTPUT_SHA256 = '9085d2cf577b486dffd7515e522600e858d29d21c7071657e22e5748c1dc84aa';

function sha256(source) {
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text was ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const root = path.join(__dirname, '..', '..');
const targetPath = path.join(root, 'tests', 'live-visible-controls-audit.js');
const original = fs.readFileSync(targetPath, 'utf8');
const inputHash = sha256(original);
if (inputHash !== EXPECTED_INPUT_SHA256) {
  throw new Error(
    'prerequisite mismatch: expected the already-applied 026 target ' +
    EXPECTED_INPUT_SHA256 + ', received ' + inputHash +
    '; clean b790 users must apply the final 026 proposal instead'
  );
}

let patched = original;

patched = replaceOnce(
  patched,
  [
    'async function routeEntryVisible(cdp, route) {',
    '  return evalJs(cdp, `(() => {',
    '    const shown=el=>{if(!el||el.disabled||el.hidden||el.closest(\'[inert],[aria-hidden="true"]\'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!==\'none\'&&s.visibility!==\'hidden\'&&+s.opacity>0&&r.width>0&&r.height>0};',
    '    if(${JSON.stringify(route.route)}===\'history\'){const source=document.getElementById(\'nav_history\'),dock=document.querySelector(\'#mlsDock button[data-dest="patient"]\');return shown(dock)&&!!source&&!source.disabled&&!source.hidden&&!source.classList.contains(\'nav-feat-off\');}',
    '    if(!${JSON.stringify(route.entry)})return false;',
    '    return shown(document.querySelector(${JSON.stringify(route.entry)}));',
    '  })()`);',
    '}'
  ].join('\n'),
  [
    'async function visibleHistoryEntry(cdp, mark) {',
    '  return evalJs(cdp, `(() => {',
    '    const shown=el=>{if(!el||el.disabled||el.hidden||el.closest(\'[inert],[aria-hidden="true"]\'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!==\'none\'&&s.visibility!==\'hidden\'&&+s.opacity>0&&r.width>0&&r.height>0};',
    '    const norm=value=>String(value||\'\').replace(/\\s+/g,\' \').trim();',
    '    const name=el=>norm(el.getAttribute(\'aria-label\')||el.getAttribute(\'title\')||el.innerText||el.textContent);',
    '    const rows=[...document.querySelectorAll(\'button,a[href],[role="button"],[role="tab"],[role="menuitem"]\')].filter(el=>shown(el)&&/^history$/i.test(name(el)));',
    '    if(rows.length!==1)return{offered:false,count:rows.length};',
    '    if(${JSON.stringify(!!mark)})rows[0].setAttribute(\'data-control-audit-route\',\'history\');',
    '    return{offered:true,count:1};',
    '  })()`);',
    '}',
    '',
    'async function routeEntryVisible(cdp, route) {',
    '  if (route.route === \'history\') return (await visibleHistoryEntry(cdp, false)).offered;',
    '  if (!route.entry) return false;',
    '  return evalJs(cdp, `(() => {',
    '    const el=document.querySelector(${JSON.stringify(route.entry)});if(!el||el.disabled||el.hidden||el.closest(\'[inert],[aria-hidden="true"]\'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!==\'none\'&&s.visibility!==\'hidden\'&&+s.opacity>0&&r.width>0&&r.height>0;',
    '  })()`);',
    '}'
  ].join('\n'),
  'gate History route discovery on one genuinely visible action'
);

patched = replaceOnce(
  patched,
  [
    '  if (route.route === \'history\') {',
    '    await click(cdp, routeNamed(\'patients\').entry);',
    '    await wait(cdp, \'Patients route before History\', `window.__mlsCurrentView===\'patients\'`);',
    '    await wait(cdp, \'visible History segment\', `(() => {',
    '      const shown=el=>{if(!el||el.disabled||el.hidden||el.closest(\'[inert],[aria-hidden="true"]\'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!==\'none\'&&s.visibility!==\'hidden\'&&r.width>0&&r.height>0};',
    '      const el=[...document.querySelectorAll(\'#mlsRightNow .segbtn\')].find(x=>shown(x)&&/^history$/i.test(String(x.textContent||\'\').trim()));',
    '      if(!el)return false;el.setAttribute(\'data-control-audit-route\',\'history\');return true;',
    '    })()`);',
    '    await click(cdp, \'#mlsRightNow [data-control-audit-route="history"]\');',
    '  } else {'
  ].join('\n'),
  [
    '  if (route.route === \'history\') {',
    '    const historyEntry = await visibleHistoryEntry(cdp, true);',
    '    assert(historyEntry && historyEntry.offered, `No unique visible History entry: ${JSON.stringify(historyEntry)}`);',
    '    await click(cdp, \'[data-control-audit-route="history"]\');',
    '  } else {'
  ].join('\n'),
  'open History only through its verified visible action'
);

patched = replaceOnce(
  patched,
  [
    "  if (failures.length) await shot(cdp, path.join(artifactDir, `failure-${String(serial).padStart(3, '0')}-${cleanFile(candidate.id || candidate.label)}.png`));",
    "  return { status: failures.length ? 'FAIL' : 'PASS', route: route.route, control: candidate, setupWaitMs, changed, failures, after: { view: after.view, surfaces: after.surfaces, statuses: after.statuses, nativeDialogs: after.nativeDialogs.slice(-3), opens: after.opens.slice(-3) } };"
  ].join('\n'),
  [
    "  if (failures.length) await shot(cdp, path.join(artifactDir, `failure-${String(serial).padStart(3, '0')}-${cleanFile(candidate.id || candidate.label)}.png`));",
    "  if (candidate.id === 'ez3flToolsToggle' && /^hide tools?$/i.test(candidate.label)) {",
    "    const restoreControl = await evalJs(cdp, `(() => {const el=document.getElementById('ez3flToolsToggle');if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return{ok:false,reason:'missing-or-hidden'};const s=getComputedStyle(el),r=el.getBoundingClientRect(),name=String(el.getAttribute('aria-label')||el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim();return{ok:s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0&&el.getAttribute('aria-expanded')==='false'&&/^show tools?$/i.test(name),name,expanded:el.getAttribute('aria-expanded')};})()`);",
    "    assert(restoreControl && restoreControl.ok, `Tools hide exercise did not leave one visible Show tools restore control: ${JSON.stringify(restoreControl)}`);",
    "    await click(cdp, '#ez3flToolsToggle');",
    "    await wait(cdp, 'Visit tools restored through visible toggle', `(() => {const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0};const toggle=document.getElementById('ez3flToolsToggle'),name=toggle&&String(toggle.getAttribute('aria-label')||toggle.innerText||toggle.textContent||'').replace(/\\s+/g,' ').trim(),later=[...document.querySelectorAll('.ez3fl-quick .ez3fl-qchip')].filter(el=>el!==toggle&&shown(el));return shown(toggle)&&toggle.getAttribute('aria-expanded')==='true'&&/^hide tools?$/i.test(name)&&later.length>=3;})()`, 5000);",
    '  }',
    "  return { status: failures.length ? 'FAIL' : 'PASS', route: route.route, control: candidate, setupWaitMs, changed, failures, after: { view: after.view, surfaces: after.surfaces, statuses: after.statuses, nativeDialogs: after.nativeDialogs.slice(-3), opens: after.opens.slice(-3) } };"
  ].join('\n'),
  'restore the visible Visit tools precondition after measuring hide'
);

patched = replaceOnce(
  patched,
  '  let report = null;',
  [
    '  let report = null;',
    "  const partial = { phase: 'launch', routesInventoried: 0, controlsInventoried: 0, routeInventories: [], noPatientSafeControls: 0, mainControlsExercised: 0, newMenuActions: 0 };"
  ].join('\n'),
  'initialize bounded harness-failure progress'
);

patched = replaceOnce(
  patched,
  [
    '    const noPatientQuickTools = await auditNoPatient(cdp, artifactDir);',
    '    const phoneLifecycle = await auditPhoneLifecycle(cdp);',
    '    const fixture = await prepareFixture(cdp);',
    '    const dimTransition = await probeDimTransition(cdp, artifactDir);'
  ].join('\n'),
  [
    '    const noPatientQuickTools = await auditNoPatient(cdp, artifactDir);',
    "    partial.phase = 'no-patient'; partial.noPatientSafeControls = noPatientQuickTools.clusterActions.length;",
    '    const phoneLifecycle = await auditPhoneLifecycle(cdp);',
    "    partial.phase = 'phone-lifecycle';",
    '    const fixture = await prepareFixture(cdp);',
    "    partial.phase = 'fixture-ready';",
    '    const dimTransition = await probeDimTransition(cdp, artifactDir);',
    "    partial.phase = 'route-discovery';"
  ].join('\n'),
  'record completed pre-inventory phases'
);

patched = replaceOnce(
  patched,
  "    const requiredDemoRouteIds = ['nav_visit', 'nav_patients', 'nav_history', 'nav_studio'];",
  "    const requiredDemoRouteIds = ['nav_visit', 'nav_patients', 'nav_studio'];",
  'require only routes with declared visible demo entries'
);

patched = replaceOnce(
  patched,
  "      disposition: visibleRouteIds.includes(route.id) ? 'live-audited' : 'hosted-role-only'",
  "      disposition: visibleRouteIds.includes(route.id) ? 'live-audited' : (route.route === 'history' ? 'not-visible-not-audited' : 'hosted-role-only')",
  'name absent History coverage without implying a product failure'
);

patched = replaceOnce(
  patched,
  "      routeInventories.push({ route: route.route, label: route.label, controlCount: stableState.controls.length, routeControlCount: routeControls.length, controls: stableState.controls, surfaces: stableState.surfaces, statuses: stableState.statuses, nav: stableState.nav });",
  [
    "      routeInventories.push({ route: route.route, label: route.label, controlCount: stableState.controls.length, routeControlCount: routeControls.length, controls: stableState.controls, surfaces: stableState.surfaces, statuses: stableState.statuses, nav: stableState.nav });",
    "      partial.phase = 'route-inventory';",
    '      partial.routesInventoried = routeInventories.length;',
    '      partial.controlsInventoried = routeInventories.reduce((n, item) => n + item.routeControlCount, 0);',
    '      partial.routeInventories = routeInventories.map(item => ({ route: item.route, controlCount: item.controlCount, routeControlCount: item.routeControlCount }));'
  ].join('\n'),
  'persist bounded partial route and control counts'
);

patched = replaceOnce(
  patched,
  '    const newMenu = await auditNewMenu(cdp, artifactDir);',
  [
    '    const newMenu = await auditNewMenu(cdp, artifactDir);',
    "    partial.phase = 'control-exercises'; partial.newMenuActions = newMenu.length;"
  ].join('\n'),
  'record conditional visible New-menu coverage'
);

patched = replaceOnce(
  patched,
  '      const outcome = await exerciseCandidate(cdp, item.route, item.control, artifactDir, i + 1); exercises.push(outcome);',
  [
    '      const outcome = await exerciseCandidate(cdp, item.route, item.control, artifactDir, i + 1); exercises.push(outcome);',
    '      partial.mainControlsExercised = exercises.length;'
  ].join('\n'),
  'record completed control exercises'
);

patched = replaceOnce(
  patched,
  "      summary: { routesInventoried: routeInventories.length, hostedRoleRoutesExcluded: routeAvailability.filter(x => !x.visibleInDemo).length, controlsInventoried: routeInventories.reduce((n, x) => n + x.routeControlCount, 0), safeControlsExercised: exercises.length, safeControlFailures: exerciseFailures.length, newMenuActionsExercised: newMenu.length, newMenuFailures: newMenuFailures.length, fieldsInspected: inspected.length, explicitlyExcluded: exclusions.length, totalFailures: failures.length },",
  "      summary: { routesInventoried: routeInventories.length, routesNotVisibleOrAudited: routeAvailability.filter(x => !x.visibleInDemo).length, hostedRoleRoutesExcluded: routeAvailability.filter(x => x.disposition === 'hosted-role-only').length, controlsInventoried: routeInventories.reduce((n, x) => n + x.routeControlCount, 0), safeControlsExercised: exercises.length, safeControlFailures: exerciseFailures.length, newMenuActionsExercised: newMenu.length, newMenuFailures: newMenuFailures.length, fieldsInspected: inspected.length, explicitlyExcluded: exclusions.length, totalFailures: failures.length },",
  'separate unoffered History from hosted-role exclusions'
);

patched = replaceOnce(
  patched,
  "        explicitlyNotClaimed: ['hosted-role-only routes hidden from the no-backend demo role', 'Athena or other EMR page/data/write'",
  "        explicitlyNotClaimed: ['routes with no visible entry in this demo state, including History when absent', 'hosted-role-only routes hidden from the no-backend demo role', 'Athena or other EMR page/data/write'",
  'disclose absent History and other unoffered routes'
);

patched = replaceOnce(
  patched,
  "    const failed = { status: 'HARNESS-FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true, error: error.stack || String(error), blockedRequests, cdpExceptions, consoleErrors };",
  "    const failed = { status: 'HARNESS-FAIL', generatedAt: new Date().toISOString(), syntheticOnly: true, error: error.stack || String(error), partial, blockedRequests, cdpExceptions, consoleErrors };",
  'persist bounded partial progress on harness failure'
);

const outputHash = sha256(patched);
if (outputHash !== EXPECTED_OUTPUT_SHA256) {
  throw new Error(
    'patched output hash mismatch: expected ' + EXPECTED_OUTPUT_SHA256 +
    ', received ' + outputHash
  );
}

fs.writeFileSync(targetPath, patched, 'utf8');
console.log('Patched ' + targetPath + ' to ' + outputHash);
