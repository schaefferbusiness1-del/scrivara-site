'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const actions = fs.readFileSync(path.join(root, 'feat_athena_actions.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(source, begin, end) {
  const start = source.indexOf(begin);
  assert(start >= 0, `missing ${begin}`);
  const stop = source.indexOf(end, start + begin.length);
  assert(stop > start, `missing ${end}`);
  return source.slice(start, stop);
}

/* The on-screen status may use a friendly Last, First rendering. */
const helperSource = between(actions, 'function toLastFirst(name) {', '\n  // ---- styles');
const toLastFirst = vm.runInNewContext(`(${helperSource})`);
assert.strictEqual(toLastFirst('Tom Ndoci'), 'Ndoci, Tom');
assert.strictEqual(toLastFirst('Ndoci,Tom'), 'Ndoci,Tom');

/* But the bridge must preserve the raw identity. The extension owns the exact
   Athena query because it can retry a compound surname after an honest miss. */
const search = between(actions, 'function searchAndOpen(name, meta) {', '\n  // ---- pull the currently-open chart');
assert(/name:\s*name\s*,\s*raw:\s*name\s*,\s*displayName:\s*lf/.test(search),
  'searchAndOpen must send the raw patient identity and keep Last,First as display-only metadata');
assert(!/name:\s*lf\s*,\s*raw:\s*name/.test(search),
  'a preformatted comma query disables the extension compound-surname retry');
assert(/Searching [^\n]*esc\(lf\)/.test(search),
  'the visible timeline should still explain the Last,First search shape');

/* Pin the extension behavior that raw "MLS B1050 769189" relies on: first a
   normal Last,First query, then "B1050 769189,MLS" as the compound retry. */
const searchLane = between(background, 'async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn) {', '// ---- v1.40: Athena "Sign & Save"');
const driver = searchLane.slice(0, searchLane.indexOf('v2.9.6 COMPOUND-SURNAME RETRY'));
assert(/var searchStr = fq \? \(lname \+ ',' \+ fq\) : lname;/.test(driver),
  'the Athena driver must submit Last,First');
const compound = between(searchLane, 'v2.9.6 COMPOUND-SURNAME RETRY', 'if (findRes && findRes.opened)');
assert(/String\(msg\.name \|\| ''\)\.indexOf\(','\) < 0/.test(compound),
  'compound retry must be reachable only from the raw comma-less identity');
assert(/cTok\.slice\(-2\)\.join\(' '\) \+ ', ' \+ cTok\.slice\(0, -2\)\.join\(' '\)/.test(compound),
  'compound retry must move the final two surname tokens before the comma');

const beacon = between(connect, 'function beaconTick() {', 'var beaconIv = setInterval(beaconTick, 3000);');
assert(/nm\.indexOf\(','\) >= 0 \? nm\.replace/.test(beacon),
  'the active-patient beacon must preserve an identity already stored as Last,First');

console.log('PASS Athena patient search format: raw identity reaches the extension, UI remains Last,First, and compound surname retry stays reachable');
