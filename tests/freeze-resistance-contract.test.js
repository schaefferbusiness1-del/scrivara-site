'use strict';
/* 2026-07-22 freeze resistance:
 *   - the "generation" refresh burst is bounded (no 10s+ tail) and is
 *     CANCELLED when generation settles (success or failure) via the
 *     mls:generation-complete event generateNote now dispatches
 *   - the provider-picker whole-document observer ignores its own mutations
 *   - the assistant/Copilot merge observer is rAF single-flight, never a
 *     synchronous per-mutation pass
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const fixpack = fs.readFileSync(path.join(root, 'feat_mls_fixpack_0701.js'), 'utf8');
const picker = fs.readFileSync(path.join(root, 'feat_athena_provider_picker.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function between(src, a, b) {
  const i = src.indexOf(a);
  assert(i >= 0, 'missing anchor: ' + a);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end anchor: ' + b);
  return src.slice(i, j);
}

/* ---- 1. bounded + cancellable generation burst ---- */
const bus = between(fixpack, 'function installRefreshBus()', 'if (document.readyState');
const genBurst = bus.match(/refreshBurst\('action,generation,note',\s*\[([^\]]*)\]/);
assert(genBurst, 'generation burst missing');
const delays = genBurst[1].split(',').map(s => Number(s.trim()));
assert(Math.max.apply(null, delays) <= 6000, 'generation burst tail exceeds 6s again: ' + genBurst[1]);
assert(bus.indexOf("cancelBurst('action,generation,note')") >= 0, 'generation settle does not cancel the burst');
assert(bus.indexOf("'mls:generation-complete', function () { cancelBurst") >= 0, 'cancel is not wired to mls:generation-complete');
assert(fixpack.indexOf('function cancelBurst(reason)') >= 0, 'cancelBurst helper missing');

/* burst/cancel token semantics: cancelling invalidates every pending timer */
{
  const timers = [];
  const ctx = {
    console, Object, Array, String, Number, Math, JSON,
    document: {},
    later(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    queueRefresh() { ctx.__refreshes = (ctx.__refreshes || 0) + 1; },
    FP: {}
  };
  vm.createContext(ctx);
  const burstSrc = between(fixpack, 'var refreshBurstSeq = {};', 'function addStyle(');
  vm.runInContext(burstSrc + '\nthis.refreshBurst = refreshBurst; this.cancelBurst = cancelBurst;', ctx, { filename: 'burst-cancel.js' });
  ctx.refreshBurst('gen', [10, 20, 30]);
  assert.strictEqual(timers.length, 3, 'burst did not schedule its delays');
  ctx.cancelBurst('gen');
  timers.forEach(t => t.fn());
  assert(!ctx.__refreshes, 'cancelBurst did not invalidate pending burst timers');
  ctx.refreshBurst('gen', [10]);
  timers[3].fn();
  assert.strictEqual(ctx.__refreshes, 1, 'a fresh burst after cancel must still refresh');
}

/* The engine owns truthful refusal/start/settlement; the legacy refresh event
   is emitted only as a derived settlement compatibility event. */
const lifecycle = between(app, 'var _mlsGenerationSequence=0;', 'function autoPopulateExtras(result){');
const gen = between(app, 'async function generateNote(){', 'function autoPopulateExtras(result){');
assert(lifecycle.includes("new CustomEvent('mls:generation-'+kind"), 'typed generation lifecycle event dispatcher is missing');
assert(lifecycle.includes("if(kind==='settled')") && lifecycle.includes("new CustomEvent('mls:generation-complete'"), 'legacy refresh settlement is not derived from the truthful settled event');
assert(lifecycle.includes("_mlsEmitGeneration('refused'") && lifecycle.includes("_mlsEmitGeneration('settled'"), 'a refusal does not publish a bounded settled lifecycle');
assert(gen.indexOf('finally{') >= 0 && gen.indexOf('_mlsSettleGeneration(run,', gen.indexOf('finally{')) > 0, 'started generation does not settle from finally');

/* ---- 2. provider-picker observer ignores its own mutations ---- */
const start = between(picker, 'function start() {', 'function revert() {');
assert(start.indexOf('#mlsPtfBox') >= 0 && start.indexOf('data-ptfix-orig') >= 0, 'provider-picker observer reacts to its own box/name rewrites (self-feedback loop)');
assert(/external/.test(start), 'provider-picker observer lost its external-mutation filter');

/* ---- 3. Copilot merge observer is rAF single-flight ---- */
const mergeSec = between(connect, 'if(window.__mlsAsstCopilotMerge) return;', 'feat_athena_msg_fix');
assert(mergeSec.indexOf('_mergePend') >= 0 && mergeSec.indexOf('requestAnimationFrame') >= 0, 'assistant/Copilot merge observer is synchronous per-mutation again');

console.log('PASS freeze resistance: bounded+cancellable generation refresh burst, settlement events on every generate exit, and self-feedback-proofed whole-document observers');
