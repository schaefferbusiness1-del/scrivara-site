'use strict';

const fs = require('fs');
const path = require('path');

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
let patched = original;

patched = replaceOnce(
  patched,
  [
    'const ROUTES = [',
    "  { id: 'nav_visit', route: 'visit', label: 'Today', view: '#visitView' },",
    "  { id: 'nav_patients', route: 'patients', label: 'Patients', view: '#patientsView' },",
    "  { id: 'nav_calendar', route: 'calendar', label: 'Calendar', view: '#calendarView' },",
    "  { id: 'nav_history', route: 'history', label: 'History', view: '#historyView' },",
    "  { id: 'nav_analysis', route: 'analysis', label: 'Practice', view: '#analysisView' },",
    "  { id: 'nav_studio', route: 'studio', label: 'Tools', view: '#studioView' }",
    '];'
  ].join('\n'),
  [
    'const ROUTES = [',
    "  { id: 'nav_visit', route: 'visit', dest: 'visit', entry: '#mlsDock button[data-dest=\"visit\"]', label: 'Today', view: '#visitView' },",
    "  { id: 'nav_patients', route: 'patients', dest: 'patient', entry: '#mlsDock button[data-dest=\"patient\"]', label: 'Patients', view: '#patientsView' },",
    "  { id: 'nav_calendar', route: 'calendar', dest: 'day', entry: '#mlsDock button[data-dest=\"day\"]', label: 'Calendar', view: '#calendarView' },",
    "  { id: 'nav_history', route: 'history', dest: 'patient', entry: '', label: 'History', view: '#historyView' },",
    "  { id: 'nav_analysis', route: 'analysis', dest: 'studio', entry: '', label: 'Practice', view: '#analysisView' },",
    "  { id: 'nav_studio', route: 'studio', dest: 'studio', entry: '#mlsDock button[data-dest=\"studio\"]', label: 'AI Studio', view: '#studioView' }",
    '];'
  ].join('\n'),
  'map routes to the visible Calm Shell owner'
);

patched = replaceOnce(
  patched,
  [
    'async function click(cdp, selector) {',
    "  const point = await evalJs(cdp, `(() => {const rows=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&!el.hidden&&!el.closest('[inert],[aria-hidden=\"true\"]')&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0});if(rows.length!==1)return{ok:false,count:rows.length};const el=rows[0],r=el.getBoundingClientRect();el.scrollIntoView({block:'center',inline:'center'});const q=el.getBoundingClientRect();return{ok:true,x:q.left+q.width/2,y:q.top+q.height/2};})()`);",
    '  assert(point && point.ok, `Could not resolve one visible ${selector}: ${JSON.stringify(point)}`);',
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });",
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });",
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });",
    '  await sleep(100);',
    '}',
    '',
    'async function fill(cdp, selector, value) {'
  ].join('\n'),
  [
    'async function click(cdp, selector) {',
    "  const point = await evalJs(cdp, `(() => {const rows=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&!el.hidden&&!el.closest('[inert],[aria-hidden=\"true\"]')&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0});if(rows.length!==1)return{ok:false,count:rows.length};const el=rows[0],r=el.getBoundingClientRect();el.scrollIntoView({block:'center',inline:'center'});const q=el.getBoundingClientRect();return{ok:true,x:q.left+q.width/2,y:q.top+q.height/2};})()`);",
    '  assert(point && point.ok, `Could not resolve one visible ${selector}: ${JSON.stringify(point)}`);',
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });",
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });",
    "  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });",
    '  await sleep(100);',
    '}',
    '',
    'function routeNamed(name) {',
    '  const route = ROUTES.find(item => item.route === name);',
    '  if (!route) throw new Error(`Unknown route ${name}`);',
    '  return route;',
    '}',
    '',
    'async function visibleHistoryEntry(cdp, mark) {',
    '  return evalJs(cdp, `(() => {',
    "    const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0};",
    "    const norm=value=>String(value||'').replace(/\\s+/g,' ').trim();",
    "    const name=el=>norm(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||el.textContent);",
    "    const rows=[...document.querySelectorAll('button,a[href],[role=\"button\"],[role=\"tab\"],[role=\"menuitem\"]')].filter(el=>shown(el)&&/^history$/i.test(name(el)));",
    "    if(rows.length!==1)return{offered:false,count:rows.length};",
    "    if(${JSON.stringify(!!mark)})rows[0].setAttribute('data-control-audit-route','history');",
    "    return{offered:true,count:1};",
    '  })()`);',
    '}',
    '',
    'async function routeEntryVisible(cdp, route) {',
    "  if (route.route === 'history') return (await visibleHistoryEntry(cdp, false)).offered;",
    '  if (!route.entry) return false;',
    '  return evalJs(cdp, `(() => {',
    "    const el=document.querySelector(${JSON.stringify(route.entry)});if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0;",
    '  })()`);',
    '}',
    '',
    'async function openRoute(cdp, route) {',
    "  if (route.route === 'history') {",
    '    const historyEntry = await visibleHistoryEntry(cdp, true);',
    '    assert(historyEntry && historyEntry.offered, `No unique visible History entry: ${JSON.stringify(historyEntry)}`);',
    "    await click(cdp, '[data-control-audit-route=\"history\"]');",
    '  } else {',
    '    assert(route.entry, `No visible route driver is declared for ${route.route}`);',
    '    await click(cdp, route.entry);',
    '  }',
    '  await wait(cdp, `${route.label} route`, `window.__mlsCurrentView===${JSON.stringify(route.route)}`);',
    '}',
    '',
    'async function fill(cdp, selector, value) {'
  ].join('\n'),
  'add canonical visible route driver'
);

patched = replaceOnce(
  patched,
  "if(el.closest('#mlsRdNav'))owner='primary-nav';",
  "if(el.closest('#mlsRdNav,#mlsDock'))owner='primary-nav';",
  'classify visible dock controls as primary navigation'
);

patched = replaceOnce(
  patched,
  "const nav=[...document.querySelectorAll('#mlsRdNav [data-mlsrd-primary=\"1\"]')].filter(shown).map(el=>({id:el.id,label:name(el),on:el.classList.contains('on')}));",
  "const nav=[...document.querySelectorAll('#mlsDock button[data-dest]')].filter(shown).map(el=>({id:el.getAttribute('data-dest')||'',label:name(el),on:el.getAttribute('aria-current')==='page'}));",
  'collect the visible primary navigation owner'
);

patched = replaceOnce(
  patched,
  "  await reloadReady(cdp); await click(cdp, '#nav_patients'); await wait(cdp, 'Patients route before dim probe', `window.__mlsCurrentView==='patients'`);",
  "  const patientsRoute = routeNamed('patients'), visitRoute = routeNamed('visit');\n  await reloadReady(cdp); await openRoute(cdp, patientsRoute);",
  'drive dim probe through visible Patients route'
);

patched = replaceOnce(
  patched,
  "  await evalJs(cdp, `window.__controlAuditDimStart=performance.now();document.getElementById('nav_visit').click();true`);",
  "  await evalJs(cdp, `window.__controlAuditDimStart=performance.now();document.querySelector(${JSON.stringify(visitRoute.entry)}).click();true`);",
  'drive first dim transition through visible Visit route'
);

patched = replaceOnce(
  patched,
  "    await evalJs(cdp, `document.getElementById('nav_patients').click();window.__controlAuditDimStart=performance.now();document.getElementById('nav_visit').click();true`);",
  "    await evalJs(cdp, `document.querySelector(${JSON.stringify(patientsRoute.entry)}).click();window.__controlAuditDimStart=performance.now();document.querySelector(${JSON.stringify(visitRoute.entry)}).click();true`);",
  'drive repeated dim transitions through visible routes'
);

patched = replaceOnce(
  patched,
  "  await click(cdp, '#nav_visit'); await wait(cdp, 'no-patient Today route', `window.__mlsCurrentView==='visit'`); await sleep(450);",
  "  await openRoute(cdp, routeNamed('visit')); await sleep(450);",
  'open no-patient Today through the visible route'
);

patched = replaceOnce(
  patched,
  "  const route = { id: 'nav_visit', route: 'visit', label: 'Today' };",
  "  const route = routeNamed('visit');",
  'reuse canonical Visit route metadata'
);

patched = replaceOnce(
  patched,
  "  await click(cdp, '#nav_patients'); await wait(cdp, 'Patients route', `window.__mlsCurrentView==='patients'`);",
  "  await openRoute(cdp, routeNamed('patients'));",
  'open fixture Patients through the visible route'
);

patched = replaceOnce(
  patched,
  [
    "  await click(cdp, '#mlsRdNewBtn'); await wait(cdp, 'New menu', `document.getElementById('mlsRdNewMenu').classList.contains('open')`);",
    "  const marked = await evalJs(cdp, `(() => {const b=[...document.querySelectorAll('#mlsRdNewMenu button')].find(x=>/new patient/i.test(x.textContent||''));if(!b)return false;b.id='controlAuditNewPatient';return true})()`);",
    "  assert(marked, 'New patient action missing'); await click(cdp, '#controlAuditNewPatient');"
  ].join('\n'),
  "  await click(cdp, '#ptNewBtn');",
  'create the synthetic patient through the visible Patients action'
);

patched = replaceOnce(
  patched,
  "  await click(cdp, '#nav_visit'); await wait(cdp, 'Visit route', `window.__mlsCurrentView==='visit'`); await fill(cdp, '#transcript', TRANSCRIPT);",
  "  await openRoute(cdp, routeNamed('visit')); await fill(cdp, '#transcript', TRANSCRIPT);",
  'open fixture Visit through the visible route'
);

patched = replaceOnce(
  patched,
  "  await click(cdp, `#${route.id}`); await wait(cdp, `${route.label} route`, `window.__mlsCurrentView===${JSON.stringify(route.route)}`);",
  '  await openRoute(cdp, route);',
  'reset candidate exercise through the visible route'
);

patched = replaceOnce(
  patched,
  "    const label = expected[i]; await reloadReady(cdp); await click(cdp, '#nav_patients'); await wait(cdp, 'Patients route', `window.__mlsCurrentView==='patients'`);",
  "    const label = expected[i]; await reloadReady(cdp); await openRoute(cdp, routeNamed('patients'));",
  'open New-menu audit through the visible route'
);

patched = replaceOnce(
  patched,
  [
    'async function auditNewMenu(cdp, artifactDir) {',
    '  const results = [];',
    "  const expected = ['New patient', 'New visit', 'New appointment'];"
  ].join('\n'),
  [
    'async function auditNewMenu(cdp, artifactDir) {',
    '  const results = [];',
    "  await reloadReady(cdp); await openRoute(cdp, routeNamed('patients'));",
    "  const offered = await evalJs(cdp, `(() => {const el=document.getElementById('mlsRdNewBtn');if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()`);",
    "  if (!offered) return results;",
    "  const expected = ['New patient', 'New visit', 'New appointment'];"
  ].join('\n'),
  'exclude the retired New menu when it is not clinician-visible'
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
  "    const visibleRouteIds = await evalJs(cdp, `(() => {const shown=el=>{if(!el||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&+s.opacity>0&&r.width>0&&r.height>0};return ${JSON.stringify(ROUTES)}.filter(spec=>shown(document.getElementById(spec.id))).map(spec=>spec.id)})()`);",
  "    const visibleRouteIds = [];\n    for (const route of ROUTES) if (await routeEntryVisible(cdp, route)) visibleRouteIds.push(route.id);",
  'inventory canonical visible route entries'
);

patched = replaceOnce(
  patched,
  "      disposition: visibleRouteIds.includes(route.id) ? 'live-audited' : 'hosted-role-only'",
  "      disposition: visibleRouteIds.includes(route.id) ? 'live-audited' : (route.route === 'history' ? 'not-visible-not-audited' : 'hosted-role-only')",
  'name absent History coverage without implying a product failure'
);

patched = replaceOnce(
  patched,
  "      const route = routesToAudit[i]; await click(cdp, `#${route.id}`); await wait(cdp, `${route.label} route`, `window.__mlsCurrentView===${JSON.stringify(route.route)}`); await sleep(350);",
  '      const route = routesToAudit[i]; await openRoute(cdp, route); await sleep(350);',
  'open each audited route through its visible owner'
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
  "      const active = stableState.nav.filter(x => x.on); if (active.length !== 1 || active[0].id !== route.id) routeFailures.push({ kind: 'wrong-or-competing-nav-owner', route: route.route, nav: stableState.nav });",
  "      const active = stableState.nav.filter(x => x.on); if (active.length !== 1 || active[0].id !== route.dest) routeFailures.push({ kind: 'wrong-or-competing-nav-owner', route: route.route, nav: stableState.nav });",
  'check the visible dock active owner'
);

patched = replaceOnce(
  patched,
  "      const next = routesToAudit[(i + 1) % routesToAudit.length]; await click(cdp, `#${next.id}`); await wait(cdp, `${next.label} route`, `window.__mlsCurrentView===${JSON.stringify(next.route)}`); await click(cdp, `#${route.id}`); await wait(cdp, `${route.label} revisit`, `window.__mlsCurrentView===${JSON.stringify(route.route)}`); await sleep(1850);",
  "      const next = routesToAudit[(i + 1) % routesToAudit.length]; await openRoute(cdp, next); await openRoute(cdp, route); await sleep(1850);",
  'revisit through canonical visible routes'
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

patched = replaceOnce(
  patched,
  "'visible control inventory', 'safe reversible control clicks', 'New menu actions', 'route revisit consistency'",
  "'visible control inventory', 'safe reversible control clicks', 'visible creation controls', 'route revisit consistency'",
  'describe the visible creation-control coverage honestly'
);

patched = replaceOnce(
  patched,
  "      `Inventoried ${report.summary.controlsInventoried} route-owned visible controls across ${report.summary.routesInventoried} routes. Exercised ${report.summary.safeControlsExercised} safe controls plus ${report.summary.newMenuActionsExercised} New-menu actions.`, '',",
  "      `Inventoried ${report.summary.controlsInventoried} route-owned visible controls across ${report.summary.routesInventoried} routes. Exercised ${report.summary.safeControlsExercised} safe controls plus ${report.summary.newMenuActionsExercised} separately visible New-menu actions when offered.`, '',",
  'report conditional New-menu coverage'
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
  'restore visible Visit tools after measuring the hide exercise'
);

fs.writeFileSync(targetPath, patched, 'utf8');
console.log('Patched ' + targetPath);
