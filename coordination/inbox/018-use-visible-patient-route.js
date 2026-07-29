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
  "  await click(cdp, '#nav_patients');",
  "  await click(cdp, '#mlsDock button[data-dest=\"patient\"]');",
  'route through visible Patient destination'
);

source = replaceOnce(
  source,
  [
    "  /* Use the clinician's top-bar New menu, not a fixture-only storage shortcut. */",
    "  await click(cdp, '#mlsRdNewBtn');",
    "  await waitFor(cdp, 'New menu', `document.getElementById('mlsRdNewMenu') && document.getElementById('mlsRdNewMenu').classList.contains('open')`);",
    "  const opened = await evaluate(cdp, `(() => {",
    "    const buttons=[...document.querySelectorAll('#mlsRdNewMenu button')];",
    "    const target=buttons.find(button=>/new patient/i.test(button.textContent||''));",
    "    if(!target)return {ok:false,labels:buttons.map(button=>(button.textContent||'').trim())};",
    "    target.click(); return {ok:true};",
    "  })()`);",
    "  assert(opened && opened.ok, `New > New patient action missing: ${JSON.stringify(opened)}`);"
  ].join('\n'),
  [
    "  /* Use the visible Patients-surface action, not the retired top-bar New menu. */",
    "  await click(cdp, '#ptNewBtn');"
  ].join('\n'),
  'open patient modal through visible action'
);

source = replaceOnce(
  source,
  "  await click(cdp, '#nav_visit');",
  "  await click(cdp, '#mlsDock button[data-dest=\"visit\"]');",
  'route through visible Visit destination'
);

fs.writeFileSync(target, source, 'utf8');
console.log('Patched ' + target);
