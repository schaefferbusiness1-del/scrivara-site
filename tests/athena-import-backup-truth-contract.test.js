'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

for (const name of ['ScribeFlow.html', 'ScribeFlow-staging.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const start = html.indexOf('<!-- Athena imports and optional backups -->');
  const end = html.indexOf('</div><!-- /Integrations section -->', start);
  assert(start >= 0 && end > start, `${name} is missing the Athena import/backup truth section`);
  const section = html.slice(start, end);

  assert(/Schedule and chart-history pulls are clinician-started/.test(section),
    `${name} does not distinguish explicit schedule/history pulls from background backup`);
  assert(/Today\/Calendar can read the day or month you request/.test(section),
    `${name} no longer tells clinicians that explicit live schedule pulls are supported`);
  assert(/one exact patient chart already open/.test(section) && /never walks through every patient/.test(section),
    `${name} overstates the extension's optional nightly snapshot scope`);
  assert(/If a stable, verified chart is not open, nothing is read or sent/.test(section),
    `${name} does not state the extension's fail-closed chart requirement`);
  assert(!/extension\)[\s\S]{0,120}runs this exact nightly backup/i.test(section),
    `${name} still equates the extension snapshot with the server API backup`);
}

const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
assert(/Capture one open Athena chart nightly/.test(popup),
  'extension popup no longer describes its one-open-chart scope');
assert(/one currently open verified Athena chart/.test(popupJs),
  'extension popup runtime no longer reports its one-open-chart scope');

console.log('PASS Athena schedule pulls, supervised history, extension snapshot, and server backup are described as distinct workflows');
