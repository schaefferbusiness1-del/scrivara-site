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
const targetPath = path.join(root, 'tests', 'live-synthetic-a11y-responsive.js');
const original = fs.readFileSync(targetPath, 'utf8');
let patched = original;

patched = replaceOnce(
  patched,
  [
    "const PATIENT = { name: 'Synthetic A11y Patient', dob: '1980-01-02', mrn: 'SYN-A11Y-0001', sex: 'Female' };",
    "const TRANSCRIPT = 'Synthetic fixture only. Follow-up for mechanical back discomfort. No real patient data is represented.';"
  ].join('\n'),
  [
    "const PATIENT = { name: 'Synthetic A11y Patient', dob: '1980-01-02', mrn: 'SYN-A11Y-0001', sex: 'Female' };",
    'const VISIBLE_ROUTE = Object.freeze({',
    "  visit: '#mlsDock button[data-dest=\"visit\"]',",
    "  patients: '#mlsDock button[data-dest=\"patient\"]',",
    "  review: '#mlsDock button[data-dest=\"review\"]'",
    '});',
    "const TRANSCRIPT = 'Synthetic fixture only. Follow-up for mechanical back discomfort. No real patient data is represented.';"
  ].join('\n'),
  'declare visible Calm Shell route controls'
);

patched = replaceOnce(
  patched,
  [
    'async function key(cdp, value, shift = false) {',
    "  const map = { Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Space: ['Space', 32], ArrowDown: ['ArrowDown', 40] };",
    '  const [code, vk] = map[value] || [value, 0];',
    '  const modifiers = shift ? 8 : 0;',
    "  const text = value === 'Space' ? ' ' : (value === 'Enter' ? '\\r' : '');",
    "  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: value === 'Space' ? ' ' : value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, text, unmodifiedText: text });",
    "  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value === 'Space' ? ' ' : value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });",
    '  await sleep(80);',
    '}',
    '',
    'async function click(cdp, selector) {'
  ].join('\n'),
  [
    'async function key(cdp, value, shift = false) {',
    "  const map = { Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Space: ['Space', 32], ArrowDown: ['ArrowDown', 40] };",
    '  const [code, vk] = map[value] || [value, 0];',
    '  const modifiers = shift ? 8 : 0;',
    "  const text = value === 'Space' ? ' ' : (value === 'Enter' ? '\\r' : '');",
    "  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: value === 'Space' ? ' ' : value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, text, unmodifiedText: text });",
    "  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value === 'Space' ? ' ' : value, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });",
    '  await sleep(80);',
    '}',
    '',
    'async function keyboardRoute(cdp, route) {',
    "  const selector = VISIBLE_ROUTE[route] || '';",
    '  assert(selector, `No visible keyboard route is declared for ${route}`);',
    '  await focus(cdp, selector);',
    "  await key(cdp, 'Enter');",
    "  if (route === 'review') {",
    "    await wait(cdp, 'visible Review destination', `(() => {",
    "      const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    "      const dock=document.querySelector('#mlsDock button[data-dest=\"review\"]'),view=String(window.__mlsCurrentView||'');",
    "      const surface=view==='orders'?document.getElementById('ordersView'):view==='recs'?document.getElementById('recsView'):null;",
    "      const title=document.getElementById('mlsRdTitle');",
    "      return shown(dock)&&dock.getAttribute('aria-current')==='page'&&shown(surface)&&String(title&&title.textContent||'').trim()==='Review';",
    '    })()`);',
    '  } else {',
    '    await wait(cdp, `${route} route`, `window.__mlsCurrentView===${JSON.stringify(route)}`);',
    '  }',
    '  return selector;',
    '}',
    '',
    'async function click(cdp, selector) {'
  ].join('\n'),
  'add keyboard route driver'
);

patched = replaceOnce(
  patched,
  [
    'async function keyboardPatient(cdp) {',
    "  await focus(cdp, '#nav_patients'); await key(cdp, 'Enter');",
    "  await wait(cdp, 'Patients route', `window.__mlsCurrentView==='patients'`);"
  ].join('\n'),
  [
    'async function keyboardPatient(cdp) {',
    "  await keyboardRoute(cdp, 'patients');"
  ].join('\n'),
  'open Patients through visible keyboard navigation'
);

patched = replaceOnce(
  patched,
  [
    "  await focus(cdp, '#mlsRdNewBtn'); await key(cdp, 'Enter');",
    "  await wait(cdp, 'keyboard New menu focus', `document.getElementById('mlsRdNewBtn').getAttribute('aria-expanded')==='true'&&document.activeElement&&document.activeElement.getAttribute('role')==='menuitem'`);",
    "  const menuFocus = await evalJs(cdp, `({text:(document.activeElement.textContent||'').trim(),role:document.activeElement.getAttribute('role')})`);",
    "  for (let i = 0; i < 6 && !/new patient/i.test(await evalJs(cdp, `(document.activeElement.textContent||'').trim()`)); i++) await key(cdp, 'ArrowDown');",
    "  assert(/new patient/i.test(await evalJs(cdp, `(document.activeElement.textContent||'').trim()`)), `New patient was not keyboard-reachable from the New menu: ${JSON.stringify(menuFocus)}`);",
    "  await key(cdp, 'Enter'); await wait(cdp, 'new-patient dialog', `document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptName')`);"
  ].join('\n'),
  [
    "  await focus(cdp, '#ptNewBtn');",
    "  const triggerFocus = await focusState(cdp, '#ptNewBtn');",
    "  assert(triggerFocus.active && triggerFocus.focusVisible, `Visible New patient control lacks keyboard focus: ${JSON.stringify(triggerFocus)}`);",
    "  await key(cdp, 'Enter'); await wait(cdp, 'new-patient dialog', `document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptName')`);"
  ].join('\n'),
  'open the patient dialog from the visible keyboard control'
);

patched = replaceOnce(
  patched,
  [
    "  await key(cdp, 'Escape'); await wait(cdp, 'Escape closes patient dialog', `!document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('mlsRdNewBtn')`);",
    "  await key(cdp, 'Enter'); await wait(cdp, 'New menu reopens', `document.activeElement&&document.activeElement.getAttribute('role')==='menuitem'`);",
    "  for (let i = 0; i < 6 && !/new patient/i.test(await evalJs(cdp, `(document.activeElement.textContent||'').trim()`)); i++) await key(cdp, 'ArrowDown');",
    "  await key(cdp, 'Enter');",
    "  await wait(cdp, 'patient dialog reopens', `document.getElementById('patientModal').classList.contains('show')&&document.activeElement.id==='ptName'`);"
  ].join('\n'),
  [
    "  await key(cdp, 'Escape'); await wait(cdp, 'Escape closes patient dialog', `!document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptNewBtn')`);",
    "  await key(cdp, 'Enter');",
    "  await wait(cdp, 'patient dialog reopens', `document.getElementById('patientModal').classList.contains('show')&&document.activeElement.id==='ptName'`);"
  ].join('\n'),
  'restore focus to and reopen from the visible patient control'
);

patched = replaceOnce(
  patched,
  "  const patient = await wait(cdp, 'saved synthetic patient and focus restore', `(() => {const p=window.activePatient&&window.activePatient();return p&&p.name===${JSON.stringify(PATIENT.name)}&&!document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('mlsRdNewBtn')?p:false})()`, 10000);",
  "  const patient = await wait(cdp, 'saved synthetic patient and focus restore', `(() => {const p=window.activePatient&&window.activePatient();return p&&p.name===${JSON.stringify(PATIENT.name)}&&!document.getElementById('patientModal').classList.contains('show')&&document.activeElement===document.getElementById('ptNewBtn')?p:false})()`, 10000);",
  'assert save restores the visible patient trigger'
);

patched = replaceOnce(
  patched,
  '  return { menuFocus, semantics, patient: { id: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn } };',
  '  return { triggerFocus, semantics, patient: { id: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn } };',
  'report the visible patient trigger focus'
);

patched = replaceOnce(
  patched,
  "  await focus(cdp, '#nav_visit'); await key(cdp, 'Enter'); await wait(cdp, 'Visit route', `window.__mlsCurrentView==='visit'`);",
  "  await keyboardRoute(cdp, 'visit');",
  'open Visit for note save through visible keyboard navigation'
);

patched = replaceOnce(
  patched,
  [
    'async function keyboardHistory(cdp) {',
    "  await focus(cdp, '#nav_history'); await key(cdp, 'Enter');",
    "  await wait(cdp, 'History row', `window.__mlsCurrentView==='history'&&[...document.querySelectorAll('#histList .hist-item')].some(el=>(el.textContent||'').includes(${JSON.stringify(PATIENT.name)}))`);",
    "  const selector = '#histList .hist-item[data-live-a11y-history=\"1\"]';",
    "  const row = await evalJs(cdp, `(() => {const el=[...document.querySelectorAll('#histList .hist-item')].find(x=>(x.textContent||'').includes(${JSON.stringify(PATIENT.name)}));if(!el)return null;el.setAttribute('data-live-a11y-history','1');return{role:el.getAttribute('role'),tabindex:el.getAttribute('tabindex'),label:el.getAttribute('aria-label')}})()`);",
    "  assert.strictEqual(row.role, 'button'); assert.strictEqual(row.tabindex, '0'); assert(row.label, 'Saved History row lacks accessible name');",
    "  await focus(cdp, selector); await key(cdp, 'Enter'); await wait(cdp, 'saved-detail dialog focus', `document.querySelector('.mlsvnd-modal[role=\"dialog\"][aria-modal=\"true\"]')&&document.activeElement===document.querySelector('.mlsvnd-modal .mlsvnd-x')`);",
    "  const semantics = await evalJs(cdp, `(() => {const m=document.querySelector('.mlsvnd-modal');return{labelledby:m.getAttribute('aria-labelledby'),title:(document.getElementById(m.getAttribute('aria-labelledby'))||{}).textContent||'',focus:document.activeElement.getAttribute('aria-label')}})()`);",
    "  assert(semantics.labelledby && semantics.title, `Saved-detail dialog lacks a valid accessible title: ${JSON.stringify(semantics)}`);",
    "  const last = await evalJs(cdp, `(() => {const m=document.querySelector('.mlsvnd-modal'),shown=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};const rows=[...m.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex=\"-1\"])')].filter(shown);rows[rows.length-1].setAttribute('data-live-a11y-last','1');return rows.length})()`);",
    "  assert(last > 1, 'Saved-detail dialog had no complete focus order'); await focus(cdp, '.mlsvnd-modal [data-live-a11y-last=\"1\"]'); await key(cdp, 'Tab');",
    "  assert.strictEqual(await evalJs(cdp, `document.activeElement===document.querySelector('.mlsvnd-modal .mlsvnd-x')`), true, 'Saved-detail dialog did not trap Tab');",
    "  await key(cdp, 'Escape'); await wait(cdp, 'saved-detail Escape/restore', `!document.querySelector('.mlsvnd-scrim')&&document.activeElement===document.querySelector(${JSON.stringify(selector)})`);",
    '  return { row, semantics, focusCount: last };',
    '}'
  ].join('\n'),
  [
    'async function keyboardReview(cdp) {',
    "  const selector = await keyboardRoute(cdp, 'review');",
    '  const focus = await focusState(cdp, selector);',
    "  assert(focus.active && focus.focusVisible && (focus.outline !== 'none' || focus.shadow !== 'none'), `Review dock control lacks visible keyboard focus: ${JSON.stringify(focus)}`);",
    '  const surface = await evalJs(cdp, `(() => {',
    "    const shown=el=>{if(!el)return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    "    const view=String(window.__mlsCurrentView||''),dock=document.querySelector('#mlsDock button[data-dest=\"review\"]');",
    "    const owner=view==='orders'?document.getElementById('ordersView'):view==='recs'?document.getElementById('recsView'):null;",
    "    const title=document.getElementById('mlsRdTitle');",
    "    const segments=[...document.querySelectorAll('#mlsRightNow .segbtn')].filter(shown).map(el=>String(el.textContent||'').trim());",
    "    return{view:view,surfaceId:owner&&owner.id||'',surfaceVisible:shown(owner),dockCurrent:dock&&dock.getAttribute('aria-current')||'',title:String(title&&title.textContent||'').trim(),segments:segments};",
    '  })()`);',
    "  assert(['orders','recs'].includes(surface.view), `Review dock did not activate a canonical Review view: ${JSON.stringify(surface)}`);",
    "  assert.strictEqual(surface.surfaceVisible, true, `Review canonical surface is not visible: ${JSON.stringify(surface)}`);",
    "  assert.strictEqual(surface.dockCurrent, 'page', `Review dock control is not current: ${JSON.stringify(surface)}`);",
    "  assert.strictEqual(surface.title, 'Review', `Review surface title drifted: ${JSON.stringify(surface)}`);",
    "  assert(surface.segments.length > 0, `Review destination exposed no visible segment controls: ${JSON.stringify(surface)}`);",
    '  return { focus, surface };',
    '}'
  ].join('\n'),
  'replace hidden History traversal with the visible Review destination'
);

patched = replaceOnce(
  patched,
  [
    'async function drawerProof(cdp, width) {',
    "  const initial = await evalJs(cdp, `(() => {const nav=document.getElementById('mlsRdNav'),b=document.getElementById('mlsRdRailBtn');return{hidden:nav.getAttribute('aria-hidden'),inert:nav.inert,expanded:b.getAttribute('aria-expanded'),label:b.getAttribute('aria-label')}})()`);",
    "  assert.deepStrictEqual(initial, { hidden: 'true', inert: true, expanded: 'false', label: 'Open primary navigation' }, `${width}px drawer starts exposed to keyboard/accessibility tree`);",
    "  await focus(cdp, '#mlsRdRailBtn'); await key(cdp, 'Enter');",
    "  await wait(cdp, `${width}px drawer opens and moves focus`, `document.getElementById('mlsRdRailBtn').getAttribute('aria-expanded')==='true'&&document.activeElement&&document.activeElement.closest('#mlsRdNav')`);",
    "  await key(cdp, 'Escape'); await wait(cdp, `${width}px drawer Escape close`, `document.getElementById('mlsRdRailBtn').getAttribute('aria-expanded')==='false'&&!document.documentElement.classList.contains('mls-rail-open')`); await sleep(250);",
    "  const closed = await evalJs(cdp, `(() => {const nav=document.getElementById('mlsRdNav'),b=document.getElementById('mlsRdRailBtn'),a=document.activeElement;return{inert:nav.inert,hidden:nav.getAttribute('aria-hidden'),activeId:a&&a.id,activeTag:a&&a.tagName,burgerVisible:(()=>{const s=getComputedStyle(b),r=b.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0})()}})()`);",
    "  assert.deepStrictEqual(closed, { inert:true, hidden:'true', activeId:'mlsRdRailBtn', activeTag:'BUTTON', burgerVisible:true }, `${width}px drawer did not restore focus/accessibility state: ${JSON.stringify(closed)}`);",
    '  return initial;',
    '}'
  ].join('\n'),
  [
    'async function compactDockProof(cdp, width) {',
    '  const initial = await evalJs(cdp, `(() => {',
    "    const shown=el=>{if(!el||el.disabled||el.hidden||el.closest('[inert],[aria-hidden=\"true\"]'))return false;const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};",
    "    const dock=document.getElementById('mlsDock'),burger=document.getElementById('mlsRdRailBtn'),rail=document.getElementById('mlsRdNav');",
    "    const labels=dock?[...dock.querySelectorAll('button[data-dest]')].filter(shown).map(el=>el.getAttribute('aria-label')||String(el.textContent||'').trim()):[];",
    '    return{dockVisible:shown(dock),legacyBurgerVisible:shown(burger),legacyRailVisible:shown(rail),labels:labels};',
    '  })()`);',
    "  assert.strictEqual(initial.dockVisible, true, `${width}px bottom dock is not visible: ${JSON.stringify(initial)}`);",
    "  assert.strictEqual(initial.legacyBurgerVisible, false, `${width}px retired rail opener is still visible: ${JSON.stringify(initial)}`);",
    "  assert.strictEqual(initial.legacyRailVisible, false, `${width}px retired rail is still visible: ${JSON.stringify(initial)}`);",
    "  assert(['Patient','Visit','Review'].every(label=>initial.labels.includes(label)), `${width}px bottom dock lost a primary destination: ${JSON.stringify(initial)}`);",
    '  const selector = VISIBLE_ROUTE.visit;',
    '  await focus(cdp, selector);',
    '  const focused = await focusState(cdp, selector);',
    "  assert(focused.active && focused.focusVisible && (focused.outline !== 'none' || focused.shadow !== 'none'), `${width}px Visit dock control lacks visible keyboard focus: ${JSON.stringify(focused)}`);",
    "  await key(cdp, 'Enter');",
    "  const activated = await wait(cdp, `${width}px Visit dock activation`, `(() => {const el=document.querySelector(${JSON.stringify(selector)});return window.__mlsCurrentView==='visit'&&el&&el.getAttribute('aria-current')==='page'&&document.activeElement===el?{view:window.__mlsCurrentView,current:el.getAttribute('aria-current'),active:true}:false})()`);",
    '  return { initial, focused, activated };',
    '}'
  ].join('\n'),
  'replace the obsolete narrow-screen drawer proof with bottom-dock keyboard coverage'
);

patched = replaceOnce(
  patched,
  "  await focus(cdp, '#nav_visit'); await key(cdp, 'Enter'); await wait(cdp, 'Visit route for Athena review', `window.__mlsCurrentView==='visit'`);",
  "  await keyboardRoute(cdp, 'visit');",
  'return to Visit for Athena review through visible keyboard navigation'
);

patched = replaceOnce(
  patched,
  "    const navFocus = await (async()=>{await focus(cdp,'#nav_visit');await key(cdp,'Enter');return focusState(cdp,'#nav_visit')})();",
  "    const navSelector = await keyboardRoute(cdp, 'visit'); const navFocus = await focusState(cdp, navSelector);",
  'measure focus on the visible primary navigation owner'
);

patched = replaceOnce(
  patched,
  '    const note = await saveSyntheticNote(cdp); const history = await keyboardHistory(cdp);',
  '    const note = await saveSyntheticNote(cdp); const review = await keyboardReview(cdp);',
  'exercise the visible Review destination instead of hidden History'
);

patched = replaceOnce(
  patched,
  '    const responsive = []; let mobileNotices = null;',
  '    const responsive = [], compactNavigation = []; let mobileNotices = null;',
  'collect compact bottom-dock evidence'
);

patched = replaceOnce(
  patched,
  '      await viewport(cdp, width, height); if (width <= 768) await drawerProof(cdp, width);',
  '      await viewport(cdp, width, height); if (width <= 768) compactNavigation.push(await compactDockProof(cdp, width));',
  'run narrow-width keyboard coverage against the visible dock'
);

patched = replaceOnce(
  patched,
  'patient, note, history, athena, navFocus, baseline, responsive, mobileNotices',
  'patient, note, review, athena, navFocus, baseline, responsive, compactNavigation, mobileNotices',
  'report Review and compact dock evidence'
);

patched = replaceOnce(
  patched,
  "'keyboard-only primary navigation','New menu and patient dialog','saved History row and detail dialog'",
  "'keyboard-only visible Visit/Patient/Review dock navigation','visible New patient control and patient dialog','visible Review surface with canonical Orders/Recommendations state','compact bottom-dock keyboard focus at 360px and 768px'",
  'describe the visible keyboard coverage'
);

patched = replaceOnce(
  patched,
  "'microphone transcription']",
  "'microphone transcription','History route/detail because the current Calm Shell does not visibly offer History']",
  'state the excluded History coverage boundary'
);

patched = replaceOnce(
  patched,
  '- Keyboard-only primary navigation, New patient, saved History detail, and Athena review',
  '- Keyboard-only visible dock navigation, New patient, Review surface, and Athena review',
  'describe visible navigation in the generated report'
);

patched = replaceOnce(
  patched,
  "`- Horizontal overflow, top-bar overlap, and 24px primary target checks`,``,`## Advisory contrast samples`",
  "`- Horizontal overflow, top-bar overlap, and 24px primary target checks`,``,`## Not covered`,``,`- History route/detail is excluded because the current Calm Shell does not visibly offer History. Reachability is tracked as a separate product finding.`,``,`## Advisory contrast samples`",
  'state History exclusion in the generated report'
);

fs.writeFileSync(targetPath, patched, 'utf8');
console.log('Patched ' + targetPath);
