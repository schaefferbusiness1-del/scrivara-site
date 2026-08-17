'use strict';
/* psq-1.0.0 - the pending patient-sync queue drains at the receipt.
 *
 * The queue had ONE driver: a 60-second interval that sent at most 25 ids per
 * pass. A managed pull that enqueues 300 patients therefore sat completely
 * untouched for up to a full minute after its terminal receipt, and if the
 * server was refusing (no progress, so the same-tick chain never re-armed) the
 * whole roster took 12 interval ticks - twelve minutes - to even be attempted.
 * Nothing on screen counted a single outstanding patient.
 *
 * This drives the SHIPPED queue functions in a VM on a virtual clock: no
 * network, no browser, no real patient. Every number below is measured by
 * running the real bytes, not asserted from the source text. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];

function slice(src, begin, end, what) {
  const a = src.indexOf(begin);
  assert(a >= 0, what + ': start marker missing');
  const b = src.indexOf(end, a);
  assert(b > a, what + ': end marker missing');
  return src.slice(a, b);
}
function extractFunction(source, name, file) {
  const anchor = '\nfunction ' + name + '(';
  const at = source.indexOf(anchor);
  assert(at >= 0, name + ' is missing from ' + file);
  let i = source.indexOf('{', at + anchor.length), depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  return source.slice(at + 1, i);
}

/* ---- virtual clock ----------------------------------------------------- */
function makeClock() {
  let now = 0, seq = 0;
  const intervals = new Map();
  let timeouts = [];
  return {
    now: () => now,
    setInterval(fn, ms) { const id = ++seq; intervals.set(id, { fn, ms: ms || 0, next: now + (ms || 0) }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(fn, ms) { const id = ++seq; timeouts.push({ id, fn, at: now + (ms || 0) }); return id; },
    clearTimeout(id) { timeouts = timeouts.filter((t) => t.id !== id); },
    runDueTimeouts() {
      const due = timeouts.filter((t) => t.at <= now);
      timeouts = timeouts.filter((t) => t.at > now);
      due.forEach((t) => { try { t.fn(); } catch (_) {} });
      return due.length;
    },
    hasDueTimeouts() { return timeouts.some((t) => t.at <= now); },
    advanceToNextInterval() {
      let next = Infinity;
      intervals.forEach((h) => { if (h.next < next) next = h.next; });
      if (next === Infinity) return false;
      now = next;
      intervals.forEach((h) => { if (h.next <= now) { h.next = now + h.ms; try { h.fn(); } catch (_) {} } });
      return true;
    },
    intervalCount() { return intervals.size; }
  };
}

/* ---- harness over the shipped queue ------------------------------------ */
function harness(file, options) {
  options = options || {};
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const QUEUE = slice(src, 'function _pendingSyncGet(key){',
    '\ntry{ setTimeout(function(){ try{ if(_pendingSyncGet().length) _armPendingSyncFlush(); }catch(e){} },5000); }catch(e){}',
    file + ' pending-sync queue');
  const BADGE = extractFunction(src, '_renderBackupBadge', file);

  const clock = makeClock();
  const store = new Map();
  const localStorage = {
    get length() { return store.size; },
    key(i) { const k = [...store.keys()][i]; return k === undefined ? null : k; },
    getItem(k) { k = String(k); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(String(k), String(v)); },
    removeItem(k) { store.delete(String(k)); }
  };
  const sends = [];
  const badgeEl = { id: '', textContent: '', style: { cssText: '' }, attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; }, remove() { badgeEl.__mounted = false; }, onclick: null };
  badgeEl.__mounted = false;
  let badgePaints = 0;
  const document = {
    getElementById(id) { if (id === '_backupBadge') badgePaints += 1; return (id === '_backupBadge' && badgeEl.__mounted) ? badgeEl : null; },
    createElement() { return badgeEl; },
    body: { appendChild(el) { el.__mounted = true; return el; } }
  };
  const paints = () => badgePaints;
  const patients = [];
  for (let i = 0; i < (options.patients || 300); i += 1) patients.push({ id: 'p' + i, name: 'Synthetic ' + i });

  const sandbox = {
    Object, JSON, Date: { now: () => clock.now() }, Array, String, Number, Promise, RegExp, Set, Math,
    console: { warn() {}, error() {}, log() {} },
    localStorage, document,
    window: { addEventListener() {}, removeEventListener() {} },
    setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    uns: (k) => 'sf_u::doc@example.com::' + k,
    __mlsPtsMirrorItemKey: (key, id) => key + '::id::' + encodeURIComponent(String(id)),
    __mlsPtsPendingMirrorMemoryByKey: Object.create(null),
    __mlsPtsBatchByKey: Object.create(null),
    encodeURIComponent, decodeURIComponent,
    backendMode: () => true,
    bkToken: () => 'synthetic-token',
    bkBase: () => 'https://synthetic.invalid',
    getPatients: () => patients,
    _pendingBackupGet: () => options.pendingNotes || [],
    _retryPendingBackups() {},
    syncPatientToServer(p) {
      sends.push({ id: p.id, at: clock.now() });
      return Promise.resolve({ ok: options.serverFails ? false : true });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(QUEUE + '\n' + BADGE +
    '\nthis.add=_pendingSyncAdd; this.get=_pendingSyncGet; this.flush=_flushPendingSync;' +
    '\nthis.kick=__mlsPendingSyncKick; this.budget=__mlsPendingSyncBudget; this.arm=_armPendingSyncFlush;' +
    '\nthis.badge=_renderBackupBadge; this.setFresh=function(v){__mlsPendingSyncFreshAt=v;};', sandbox);
  /* the real remove path is exercised by syncPatientToServer's caller; the
     shipped self-removal lives in syncPatientToServer, which is stubbed here,
     so mirror it exactly: an ok send removes the id. */
  const realSync = sandbox.syncPatientToServer;
  sandbox.syncPatientToServer = function (p, scope) {
    const r = realSync(p, scope);
    if (!options.serverFails) sandbox._pendingSyncRemove(p.id, scope && scope.pendingKey);
    return r;
  };
  return { sandbox, clock, sends, badgeEl, localStorage, paints };
}

const settle = async (n) => { for (let i = 0; i < (n || 60); i += 1) await new Promise((r) => setImmediate(r)); };

/* Run everything that can happen WITHOUT advancing the virtual clock: the
 * in-flight drain's awaits, and any zero-delay chain it schedules. Only when
 * nothing more can happen at this instant do we let a 60s tick fire. */
async function quiesce(h) {
  for (let round = 0; round < 400; round += 1) {
    const before = h.sends.length + h.sandbox.get().length;
    await settle(40);
    let ran = 0;
    while (h.clock.hasDueTimeouts() && ran < 200) { h.clock.runDueTimeouts(); ran += 1; await settle(20); }
    const after = h.sends.length + h.sandbox.get().length;
    if (!ran && after === before) return;
  }
}

async function runQueue(h, maxTicks) {
  let ticks = 0;
  for (;;) {
    await quiesce(h);
    if (h.sandbox.get().length === 0) break;
    if (ticks >= (maxTicks || 40)) break;
    if (!h.clock.advanceToNextInterval()) break;
    ticks += 1;
  }
  return { ticks, elapsedMs: h.clock.now(), sent: h.sends.length };
}

(async function main() {
  /* ---- the shipped wiring, in BOTH shells ---- */
  SHELLS.forEach((file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.strictEqual((src.match(/\/\* ===== psq-1\.0\.0/g) || []).length, 1, file + ': psq-1.0.0 block must appear once');
    assert(/__mlsPendingSyncKick\('batch-end'\)/.test(src),
      file + ': the patient batch\'s terminal receipt does not drain the pending queue');
    assert(/for\(let i=0;i<ids\.length&&i<budget;i\+\+\)/.test(src),
      file + ': the drain is still hard-capped at a constant');
    assert(/if\(pn\) parts\.push\(pn\+' patient'/.test(src),
      file + ': the outstanding patient count is still invisible');
    /* the fallback interval must NOT be removed - the kick is an addition */
    assert(/_pendingSyncTimer=setInterval\(function\(\)\{ _flushPendingSync\(\); \},60000\);/.test(src),
      file + ': the 60s safety-net interval was removed');
  });
  {
    const blocks = SHELLS.map((f) => slice(fs.readFileSync(path.join(ROOT, f), 'utf8'),
      '/* ===== psq-1.0.0', '/* ===== end psq-1.0.0 */', f));
    assert.strictEqual(blocks[0], blocks[1], 'the two 1p shells carry different psq blocks');
  }

  /* ---- 1. a 300-patient burst drains at the receipt, not on the timer ---- */
  {
    const h = harness(SHELLS[0], { patients: 300 });
    for (let i = 0; i < 300; i += 1) h.sandbox.add('p' + i);
    assert.strictEqual(h.sandbox.get().length, 300, 'the synthetic burst was not queued');
    assert.strictEqual(h.sends.length, 0, 'ids were sent before any drain ran');
    /* _pendingSyncGet scans EVERY localStorage key, so a per-add repaint would
     * make the pull quadratic in the queue length. */
    assert(h.paints() <= 2,
      'enqueuing 300 patients repainted the badge ' + h.paints() + ' times - the pull is quadratic in the queue');

    h.sandbox.kick('batch-end');                       /* the pull's terminal receipt */
    const result = await runQueue(h, 40);
    assert.strictEqual(h.sandbox.get().length, 0, 'the queue did not fully drain (' + h.sandbox.get().length + ' left)');
    assert.strictEqual(h.sends.length, 300, 'not every queued patient was sent: ' + h.sends.length);
    assert.strictEqual(h.sends[0].at, 0,
      'the first patient still waited ' + h.sends[0].at + 'ms for the interval instead of draining at the receipt');
    assert.strictEqual(result.ticks, 0,
      'the drain still needed ' + result.ticks + ' 60s interval tick(s) after the terminal receipt');
    console.log('  healthy 300-patient burst: first send at t=' + h.sends[0].at + 'ms, last at t=' +
      h.sends[300 - 1].at + 'ms, 60s ticks needed: ' + result.ticks);
  }

  /* ---- 2. a refusing server: the fresh budget is what bounds the wait ---- */
  {
    const h = harness(SHELLS[0], { patients: 300, serverFails: true });
    for (let i = 0; i < 300; i += 1) h.sandbox.add('p' + i);
    h.sandbox.kick('batch-end');
    await settle(20);
    assert.strictEqual(h.sends.length, 200,
      'a fresh pass attempted ' + h.sends.length + ' ids, not the fresh budget of 200');
    console.log('  refusing server, fresh: ' + h.sends.length + ' attempted in the first pass ' +
      '(old constant cap was 25 - 12 interval ticks / 12 minutes for 300)');
  }

  /* ---- 3. the budget really is time-bounded, executed both ways ---- */
  {
    const h = harness(SHELLS[0], { patients: 10 });
    h.sandbox.setFresh(-1);
    assert.strictEqual(h.sandbox.budget(), 25, 'a cold queue did not fall back to the idle budget');
    h.sandbox.setFresh(h.clock.now());
    assert.strictEqual(h.sandbox.budget(), 200, 'a fresh queue did not get the larger budget');
    h.sandbox.setFresh(h.clock.now() - 120001);
    assert.strictEqual(h.sandbox.budget(), 25, 'a stale-fresh marker kept the larger budget forever');
  }

  /* ---- 4. an empty queue is never kicked, and never arms a timer ---- */
  {
    const h = harness(SHELLS[0], { patients: 1 });
    assert.strictEqual(h.sandbox.kick('batch-end'), false, 'an empty queue was kicked');
    assert.strictEqual(h.clock.intervalCount(), 0, 'an empty queue armed the 60s interval');
    assert.strictEqual(h.sends.length, 0, 'an empty queue sent something');
  }

  /* ---- 5. the outstanding count is on screen ---- */
  {
    const h = harness(SHELLS[0], { patients: 5 });
    h.sandbox.badge();
    assert.strictEqual(h.badgeEl.__mounted, false, 'a badge appeared with nothing pending');

    for (let i = 0; i < 3; i += 1) h.sandbox.add('p' + i);
    h.sandbox.badge();
    assert.strictEqual(h.badgeEl.__mounted, true, 'three unsent patients produced no badge at all');
    assert(/3 patients syncing/.test(h.badgeEl.textContent),
      'the badge does not count the outstanding patients: ' + JSON.stringify(h.badgeEl.textContent));

    const both = harness(SHELLS[0], { patients: 5, pendingNotes: ['n1', 'n2'] });
    both.sandbox.add('p0');
    both.sandbox.badge();
    assert(/2 notes and 1 patient syncing/.test(both.badgeEl.textContent),
      'the badge does not report notes AND patients together: ' + JSON.stringify(both.badgeEl.textContent));

    /* and it clears itself once the queue drains */
    h.sandbox.kick('batch-end');
    await runQueue(h, 5);
    h.sandbox.badge();
    assert.strictEqual(h.badgeEl.__mounted, false, 'the badge outlived the queue it was counting');
  }

  console.log('PASS 1p pending patient sync drain (psq-1.0.0, 2 shells, 5 measured cases)');
})().catch((e) => { console.error(e); process.exit(1); });
