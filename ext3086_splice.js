/* ext 3.0.86 splice: het-1.2.0 appointment-id disambiguation (fail-closed).
   Latin1 index-splice per merge-resolution law; constants ASCII-only. */
const fs = require('fs');
const FILE = 'background.js';
let s = fs.readFileSync(FILE, 'latin1');

const anchor = 'att.apptCount = appts.length;\n        if (appts.length !== 1) { hetCommit(); return null; }';
const i = s.indexOf(anchor);
if (i < 0) { console.error('ANCHOR MISSING'); process.exit(1); }
if (s.indexOf(anchor, i + 1) >= 0) { console.error('ANCHOR NOT UNIQUE'); process.exit(1); }

const replacement = [
  'att.apptCount = appts.length;',
  '        /* het-1.2.0 (3.0.86, measured live 2026-08-31): a patient with TWO',
  '           same-day appointments paints BOTH AppointmentIDs into the stage',
  "           frame's embedded JSON, so the strictly-single count refused the",
  '           surface forever (apptCount:2, qualified:false) even though the',
  '           reviewed request names EXACTLY ONE expected appointment id. When',
  '           more than one distinct id is painted, bind IFF exactly one of them',
  "           equals the request's expected appointment id; any other shape keeps",
  '           the original refusal. The downstream candidate gate re-checks this',
  '           same id against expectedContext.appointmentId, so a mismatch can',
  '           never survive to a write. */',
  '        if (appts.length !== 1) {',
  '          var hetWantAppt = \'\';',
  '          try { hetWantAppt = digits((expectedContext && expectedContext.appointmentId) || \'\'); } catch (eHetWa) { hetWantAppt = \'\'; }',
  '          var hetApptHits = [];',
  '          for (var hetAi = 0; hetAi < appts.length; hetAi++) { if (hetWantAppt && digits(appts[hetAi]) === hetWantAppt) hetApptHits.push(appts[hetAi]); }',
  '          if (hetWantAppt && hetApptHits.length === 1) { appts = hetApptHits; }',
  '          else { hetCommit(); return null; }',
  '        }'
].join('\n');

s = s.slice(0, i) + replacement + s.slice(i + anchor.length);

// version bump 3.0.85 -> 3.0.86 in background.js constants
const vFrom = '3.0.85', vTo = '3.0.86';
const vCount = s.split(vFrom).length - 1;
console.log('version sites in background.js: ' + vCount);
s = s.split(vFrom).join(vTo);

fs.writeFileSync(FILE, s, 'latin1');

// manifest bump
let m = fs.readFileSync('manifest.json', 'latin1');
const mc = m.split(vFrom).length - 1;
if (mc < 1) { console.error('MANIFEST HAS NO ' + vFrom); process.exit(1); }
m = m.split(vFrom).join(vTo);
fs.writeFileSync('manifest.json', m, 'latin1');
console.log('manifest sites: ' + mc);
console.log('SPLICE OK');
