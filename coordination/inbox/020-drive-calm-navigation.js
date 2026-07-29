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

const target = path.join(__dirname, '..', '..', 'tests', 'live-synthetic-smoke.js');
let source = fs.readFileSync(target, 'utf8');

source = replaceOnce(
  source,
  "      const nav=document.getElementById('mlsRdNav'), top=document.getElementById('mlsRdTop');",
  "      const nav=document.getElementById('mlsDock'), top=document.getElementById('mlsRdTop');",
  'sample visible dock geometry'
);

source = replaceOnce(
  source,
  "        activeNav:[...document.querySelectorAll('#mlsRdNav .navtab.on')].filter(visible).length,",
  "        activeNav:[...document.querySelectorAll('#mlsDock button[data-dest][aria-current=\"page\"]')].filter(visible).length,",
  'sample visible active destination'
);

source = replaceOnce(
  source,
  [
    "const ROUTES = {",
    "  nav_visit: { route: 'visit', view: '#visitView' },",
    "  nav_patients: { route: 'patients', view: '#patientsView' },",
    "  nav_calendar: { route: 'calendar', view: '#calendarView' },",
    "  nav_orders: { route: 'orders', view: '#ordersView' },",
    "  nav_recs: { route: 'recs', view: '#recsView' },",
    "  nav_history: { route: 'history', view: '#historyView' },",
    "  nav_analysis: { route: 'analysis', view: '#analysisView' },",
    "  nav_studio: { route: 'studio', view: '#studioView' },",
    "  nav_team: { route: 'team', view: '#teamView' },",
    "  nav_legalreq: { route: 'legalreq', view: '#legalReqView' },",
    "  nav_admin: { route: 'admin', view: '#adminView' }",
    "};",
    "const ACTION_TABS = new Set(['nav_staffpull', 'nav_help', 'mlsPtab_reviews', 'mlsPtab_send']);"
  ].join('\n'),
  [
    "const ROUTES = {",
    "  day: { route: 'calendar', view: '#calendarView' },",
    "  patient: { route: 'patients', view: '#patientsView' },",
    "  visit: { route: 'visit', view: '#visitView' },",
    "  review: { route: 'orders', view: '#ordersView' },",
    "  studio: { route: 'studio', view: '#studioView' }",
    "};"
  ].join('\n'),
  'map visible Calm destinations'
);

source = replaceOnce(
  source,
  "    return [...document.querySelectorAll('#mlsRdNav .mainnav > .navtab')].filter(shown).map(el=>({id:el.id,label:(el.innerText||el.textContent||'').replace(/\\\\s+/g,' ').trim()}));",
  "    return [...document.querySelectorAll('#mlsDock button[data-dest]:not([data-dest=\"tools\"])')].filter(shown).map(el=>({id:el.getAttribute('data-dest'),label:el.getAttribute('aria-label')||(el.innerText||el.textContent||'').replace(/\\\\s+/g,' ').trim()}));",
  'inventory visible Calm destinations'
);

source = replaceOnce(
  source,
  "  const unknown = visible.filter((item) => !ROUTES[item.id] && !ACTION_TABS.has(item.id));",
  "  const unknown = visible.filter((item) => !ROUTES[item.id]);",
  'require a strategy for every visible Calm destination'
);

source = replaceOnce(
  source,
  "    await click(cdp, `#${item.id}`);",
  "    await click(cdp, `#mlsDock button[data-dest=\"${item.id}\"]`);",
  'click visible Calm destination'
);

source = replaceOnce(
  source,
  "      return {active:[...document.querySelectorAll('#mlsRdNav .navtab.on')].filter(shown).map(el=>el.id), title:(document.getElementById('mlsRdTitle')||{}).textContent||''};",
  "      return {active:[...document.querySelectorAll('#mlsDock button[data-dest][aria-current=\"page\"]')].filter(shown).map(el=>el.getAttribute('data-dest')), title:(document.getElementById('mlsRdTitle')||{}).textContent||''};",
  'verify visible Calm destination owner'
);

source = replaceOnce(
  source,
  "  await click(cdp, '#nav_history');",
  [
    "  await click(cdp, '#mlsDock button[data-dest=\"visit\"]');",
    "  await waitFor(cdp, 'Visit destination before History', `window.__mlsCurrentView==='visit'`);",
    "  await waitFor(cdp, 'visible View completed notes action', `(() => {",
    "    const el=document.getElementById('ez3Hist');if(!el)return false;",
    "    const s=getComputedStyle(el),r=el.getBoundingClientRect();",
    "    return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;",
    "  })()`, 10000);",
    "  await click(cdp, '#ez3Hist');"
  ].join('\n'),
  'open History through visible Visit destination'
);

fs.writeFileSync(target, source, 'utf8');
console.log('Patched ' + target);
