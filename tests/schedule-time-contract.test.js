'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const whosNext = read('feat_mls_whosnext.js');
const frontsync = read('feat_task3_frontsync.js');
const background = read('background.js');
const inline = read('inject_dom.js');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing source marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

const timeHelpers = between(whosNext, 'function pad2(n)', 'function calSmart()');
const api = Function('window', 'S', `${timeHelpers}\nreturn { dOf, hhmm, wallTime, instantTime };`)(
  { _acctTz: () => 'America/New_York' },
  value => value == null ? '' : String(value)
);

assert.strictEqual(api.hhmm({ time_display: '7:05 PM' }), '19:05');
assert.strictEqual(api.hhmm({ start_local: '2026-07-13 08:30:00' }), '08:30');
assert.strictEqual(api.hhmm({ start_at: '2026-07-13T13:00:00Z' }), '09:00');
assert.strictEqual(api.hhmm({ time_display: '4:15 p.m.' }), '16:15');
assert.strictEqual(api.hhmm({}), '', 'missing time must stay missing, never default to 6 PM');
assert.strictEqual(api.hhmm({ start_at: null }), '', 'null start_at must not become the Unix epoch');
assert.strictEqual(api.dOf({ start_local: '2026-07-13 08:30:00' }), '2026-07-13');
assert.strictEqual(api.dOf({ start_at: '2026-07-14T01:30:00Z' }), '2026-07-13', 'UTC instants must use the account day');

// Every downstream calendar surface follows the same priority: explicit wall
// time, then a real instant converted in the account timezone, then legacy
// time. No hard-coded/default 18:00 lane is allowed.
const frontTime = between(frontsync, 'function hhmmOf(a)', "var swapping = false");
assert(frontTime.indexOf('a.time_display') < frontTime.indexOf('a.start_local'));
assert(frontTime.indexOf('a.start_local') < frontTime.indexOf('a.start_at'));
assert(frontTime.indexOf('a.start_at') < frontTime.indexOf('wall(a.time)'));
assert(frontTime.includes("return '';"));
assert(!/18:00|6:00\s*PM|6\s*PM/i.test(frontTime));

assert(/Meridian-less\s+times are NEVER guessed/.test(background));
assert(background.includes('out.diag.bareTimes'));
assert(inline.includes('scheduleStructure'));
assert(inline.includes('if(pui(p))return'), 'schedule column headers must never become provider names');
assert(/authoritative successfully-read empty day\. Only null means no\s+pull has happened/.test(whosNext), 'an empty schedule read must remain authoritative');

console.log('PASS schedule time: exact wall/instant precedence, account timezone, no 6 PM default, honest empty reads');
