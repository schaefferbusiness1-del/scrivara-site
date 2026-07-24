'use strict';

/* Audit finding H10 (verified): pre-visit intake "Create & attach" had no
 * in-flight guard. The ck-1.1.0 re-attach guard (__mlsIntakeMerged) is only
 * armed AFTER the merge completes — several awaits later — so a double tap ran
 * two merges concurrently, each seeing an empty guard, and created TWO
 * duplicate patient charts for one intake.
 *
 * The claim must be SYNCHRONOUS (before the first await) or the race is still
 * open, and it must be released in `finally` or a failed attach could never be
 * retried.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// ---- source contract -------------------------------------------------------
const wrapStart = app.indexOf('async function attachIntake(id, patientId){');
assert(wrapStart >= 0, 'attachIntake must still exist');
const wrap = app.slice(wrapStart, app.indexOf('async function _attachIntakeImpl'));

assert(/if\(__attaching\[id\]\) return;/.test(wrap), 'a second tap while one is in flight must be a no-op');
assert(/__attaching\[id\]=true;/.test(wrap), 'the intake id must be claimed');
assert(/finally\{ delete __attaching\[id\]; \}/.test(wrap), 'the claim must be released so a failed attach can be retried');
assert(!/await/.test(wrap.slice(0, wrap.indexOf('__attaching[id]=true;'))),
  'the claim must happen BEFORE any await, or the double-tap race is still open');
assert(/return await _attachIntakeImpl\(id, patientId\)/.test(wrap),
  'the wrapper must delegate to the original implementation unchanged');
assert(app.indexOf('async function _attachIntakeImpl(id, patientId){') > wrapStart,
  'the original body must survive as _attachIntakeImpl');
assert(/window\.__mlsIntakeMerged/.test(app), 'the ck-1.1.0 re-attach guard must remain — this is additive');

// ---- runtime: two concurrent taps must merge exactly once ------------------
const ctx = { console, Promise, setTimeout };
vm.createContext(ctx);
vm.runInContext(`
  var window = {};
  var merges = 0;
  async function _attachIntakeImpl(id, patientId){
    await new Promise(function(r){ setTimeout(r, 5); });   // the awaits the real one has
    merges++;
    return 'merged';
  }
  ${wrap}
  this.run = async function(){
    await Promise.all([attachIntake('i1', ''), attachIntake('i1', '')]);   // double tap
    var afterDouble = merges;
    await attachIntake('i1', '');                                          // deliberate later retry
    return { afterDouble: afterDouble, afterRetry: merges };
  };
`, ctx, { filename: 'attachIntake' });

ctx.run().then(function (r) {
  assert.strictEqual(r.afterDouble, 1, 'a double tap must produce exactly ONE merge (it produced ' + r.afterDouble + ')');
  assert.strictEqual(r.afterRetry, 2, 'a later deliberate attach must still work — the claim must not leak');
  console.log('PASS intake attach single-flight: a double tap creates exactly one chart, the claim is taken before any await and released in finally, and the ck-1.1.0 re-attach guard is untouched');
}).catch(function (e) { console.error(e); process.exit(1); });
