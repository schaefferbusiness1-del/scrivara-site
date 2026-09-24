'use strict';
/* capsaved-1.0.0 (MLS Assist 3.0.114): POST /api/assist/extract answers
   ok:true with chartSaved:false when the server could not tell the captured
   patient apart from another chart. No chart and no visit rows were written.
   The panel's Capture button, the autopilot's capturechart step and the
   scheduled backup all used to report that as a capture. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }

/* the helper itself, run for real */
const m = content.match(/function mlsCaptureNotSaved\(resp\) \{[\s\S]*?\n  \}\n/);
ok(m, 'content.js defines mlsCaptureNotSaved');
const ctx = {};
vm.runInNewContext(m[0] + '\nthis.f = mlsCaptureNotSaved;', ctx);
const refused = ctx.f({ ok: true, chartSaved: false, patient: 'Pat Example', visits: 0, identityConflict: 'uncorroborated' });
ok(/did not save it/.test(refused) && /Nothing was written/.test(refused), 'a refused capture says nothing was saved: ' + refused);
ok(!/Captured/.test(refused), 'a refused capture never says Captured');
ok(/Pat Example/.test(refused), 'names who was read');
ok(ctx.f({ ok: true, chartSaved: true, patient: 'Pat Example' }) === '', 'a saved capture is not flagged');
ok(ctx.f({ ok: true, patient: 'Pat Example' }) === '', 'an older server with no chartSaved field is not flagged');
ok(ctx.f(null) === '', 'no reply is not flagged');

/* both panel paths consult it before the success line */
const cap = content.slice(content.indexOf("$('#mls-cap').addEventListener"), content.indexOf('// --- insert into the focused EMR field'));
ok(cap.indexOf('mlsCaptureNotSaved(resp)') > 0, 'Capture button checks chartSaved');
ok(cap.indexOf('mlsCaptureNotSaved(resp)') < cap.indexOf("'✓ Captured '"), 'the refusal is checked before the success line');
ok(/resp\.separateChart === true \? ' as its own chart/.test(cap), 'a capture kept as its own chart says so');
const auto = content.slice(content.indexOf("if (a.type === 'capturechart')"), content.indexOf("if (a.type === 'pastenote')"));
ok(/ex && ex\.ok && mlsCaptureNotSaved\(ex\)\) \? mlsCaptureNotSaved\(ex\)/.test(auto), 'autopilot capturechart checks chartSaved first');

/* the scheduled backup counts it as an error, not a capture */
const bk = background.slice(background.indexOf('async function runNightlyBackup'), background.indexOf('/* MLS_NIGHTLY_BACKUP_SAFE_END */'));
ok(/if \(!\(c && c\.ok\) \|\| c\.chartSaved === false\) return finish\(\{ ok: false, captured: 0/.test(bk), 'backup: a refused capture is ok:false, captured:0');
ok(/did not save it/.test(bk), 'backup: the error says it was not saved');

console.log('extension-capture-says-when-nothing-was-saved: ' + checks + ' checks passed');
