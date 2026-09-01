/* ext 3.0.87: patient goto retry before the destructive recovery ladder. */
const fs = require('fs');
let s = fs.readFileSync('background.js', 'latin1');

const alt = 'NEVER ask the user to move athena by hand.';
const j = s.indexOf(alt);
if (j < 0) { console.error('ANCHOR MISSING'); process.exit(1); }
if (s.indexOf(alt, j + 1) >= 0) { console.error('ANCHOR NOT UNIQUE'); process.exit(1); }
const i = s.lastIndexOf('if (!found) {', j);
if (i < 0 || j - i > 120) { console.error('ANCHOR SHAPE UNEXPECTED gap=' + (j - i)); process.exit(1); }

const insert = [
  '        if (!found) {',
  '          /* patient-retry-3.0.87 (measured live 2026-08-31): the initial',
  '             injection ran with a 12s budget; on a heavy renderer it times out',
  '             with the calendar strip PAINTED AND VISIBLE, and the recovery',
  '             below then drives athena Home - destroying the very view the',
  '             caller needed (the row hunt that follows finds an empty surface).',
  '             The recovery rounds already allow 40s for this same call, so one',
  '             non-destructive retry at that budget comes first. Nothing is',
  '             clicked beyond the day tab the call was always allowed to click.  */',
  '          try {',
  '            const rx2 = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, args: [date, false, __gotoGuard], func: mlsAthenaGotoDate }, Math.min(40000, __gotoLeft()), \'the patient date-navigation retry\');',
  '            const hits2b = ((rx2 && rx2.r) || []).map((r) => r && r.result).filter(Boolean);',
  '            found = hits2b.find((h) => h.found) || null;',
  '            GDIAG.patientRetry = { ran: true, found: !!found, timeout: !!(rx2 && rx2.timeout) };',
  '          } catch (ePr) { GDIAG.patientRetry = { ran: true, err: String((ePr && ePr.message) || ePr).slice(0, 60) }; }',
  '        }',
  ''
].join('\n');

s = s.slice(0, i) + insert + s.slice(i);

const vFrom = '3.0.86', vTo = '3.0.87';
const vc = s.split(vFrom).length - 1;
console.log('bg version sites: ' + vc);
s = s.split(vFrom).join(vTo);
fs.writeFileSync('background.js', s, 'latin1');

let m = fs.readFileSync('manifest.json', 'latin1');
const mc = m.split(vFrom).length - 1;
if (mc < 1) { console.error('MANIFEST MISSING ' + vFrom); process.exit(1); }
fs.writeFileSync('manifest.json', m.split(vFrom).join(vTo), 'latin1');
console.log('manifest sites: ' + mc);
console.log('SPLICE OK');
