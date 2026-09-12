'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let after = before;
const edits = [];
function replace(a, b) {
  assert(after.indexOf(a) >= 0 && after.indexOf(a) === after.lastIndexOf(a), 'nonunique binding splice');
  after = after.replace(a, b); edits.push([a, b]);
}
if (after.includes('const appointmentRecovery = msg.appointmentRecovery === true;')) {
  const start = after.indexOf("if (msg.type === 'mlsAppSearchOpenRequest')");
  const end = after.indexOf('// not ours', start);
  const tail = after.slice(start, end);
  const oldCatch = "} catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }";
  if (tail.includes(oldCatch)) {
    replace(tail, tail.replace(oldCatch, "} catch (e) { sendResponse({ ok: false, opened: false, reason: 'search-open-error', error: String((e && e.message) || e) }); }"));
    let inverse = after;
    for (const [a, b] of edits.slice().reverse()) inverse = inverse.replace(b, a);
    assert.strictEqual(inverse, before);
    fs.writeFileSync(target, Buffer.from(after, 'latin1'));
  }
  console.log('3.0.119 ordinary-read binding is already applied.'); process.exit(0);
}
replace('        const bootstrapIdentity = msg.bootstrapIdentity === true;', [
  '        const bootstrapIdentity = msg.bootstrapIdentity === true;',
  '        /* 3.0.119: exact-row recovery binds the ordinary full-text read to',
  '           its appointment lease without switching to identity-only mode. */',
  '        const appointmentRecovery = msg.appointmentRecovery === true;'
].join('\n'));
replace('          if (bootstrapIdentity && (!expectedAppointmentId || lease.appointmentIdBound !== true ||', '          if ((bootstrapIdentity || appointmentRecovery) && (!expectedAppointmentId || lease.appointmentIdBound !== true ||');
const handlerStart = after.indexOf("if (msg.type === 'mlsAppSearchOpenRequest')");
const handlerEnd = after.indexOf('// not ours', handlerStart);
const handler = after.slice(handlerStart, handlerEnd);
replace(handler, handler.replace("} catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }", "} catch (e) { sendResponse({ ok: false, opened: false, reason: 'search-open-error', error: String((e && e.message) || e) }); }"));
const start = after.indexOf('                if (bootstrapIdentity) {', after.indexOf('for (var scheduleTry = 0;'));
const end = after.indexOf('                if (sched && sched.opened) break;', start);
assert(start > 0 && end > start);
const old = after.slice(start, end);
replace(old, old.split(/\r?\n/).map((line, i) => i === 0 || !line ? line : '  ' + line).join('\n'));
let inverse = after;
for (const [a, b] of edits.slice().reverse()) inverse = inverse.replace(b, a);
assert.strictEqual(inverse, before, 'binding splice changed unrelated bytes');
fs.writeFileSync(target, Buffer.from(after, 'latin1'));
console.log('Applied 3.0.119 ordinary-read binding; inverse byte proof passed.');
