'use strict';
/*
 * COPILOT POWER — AGENTIC EXECUTORS (cpw-1.0.0)
 * -----------------------------------------------------------------------------
 * pullProviders and draftNote, EXECUTED in a VM with the app surface stubbed:
 *
 * - A tapped pull offer resolves providers through the verified roster
 *   (fail-closed: unverified names are SKIPPED and said so, never guessed),
 *   runs the canonical engine SEQUENTIALLY with includeHistory, and posts
 *   honest per-provider receipts including failures in the engine's words.
 * - Merely loading the module executes nothing (no tap, no pull).
 * - A busy engine refuses honestly instead of stacking a second pull.
 * - "Last, First" is ONE provider name — a comma split would shred every
 *   athena name, so non-JSON args only split on semicolons.
 * - draftNote selects the exact patient and opens the op-note prep flow;
 *   an ambiguous patient fails closed with no selection and no open.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_power.js'), 'utf8');

function tick(n) { return new Promise(r => setTimeout(r, n || 0)); }

function build(overrides) {
  const calls = { dayPull: [], said: [], toasts: [], selected: [], prepped: [] };
  const window = Object.assign({
    addEventListener() {}, removeEventListener() {},
    fetch: function () { return Promise.resolve({ ok: true }); },
    copilotSnapshot: function () { return {}; },
    toast: (m) => calls.toasts.push(String(m)),
    /* The REAL unify signature: append(role, text, extra) -> message. The
       1.0.0 stub took an object — mirroring the module's wrong assumption —
       so every receipt shipped as an EMPTY bubble and this suite stayed
       green. A stub must mirror the dependency, not the caller. */
    __mlsCopilotConvo: { append: (role, text, extra) => {
      const m = { role: role === 'user' ? 'user' : 'ai', text: String(text == null ? '' : text) };
      if (extra && typeof extra === 'object') for (const k in extra) { if (k !== 'role' && k !== 'text') m[k] = extra[k]; }
      calls.said.push(m.text);
      return m;
    } },
    _acctTodayKey: () => '2026-08-05',
    __mlsDayHistoryPull: { state: { running: false } },
    __mlsPullBusyAt: 0,
    __mlsProviderRoster: {
      resolve: (name) => {
        const n = String(name || '').toLowerCase();
        if (n.indexOf('smith') >= 0) return { name: 'Smith, Adam', stableKey: 'athena:smith, adam', id: 'pr1' };
        if (n.indexOf('jones') >= 0) return { name: 'Jones, Beth', stableKey: 'athena:jones, beth', id: 'pr2' };
        return null;
      },
      list: () => [], getReceipt: () => ({ complete: true })
    },
    __mlsSI: {
      dayPull: function (opts) {
        calls.dayPull.push(opts);
        return Promise.resolve({ ok: true, created: 3, repaired: 1, failed: 0 });
      }
    },
    __mlsCopilotActions: {
      resolvePatient: (target) => {
        if (String(target) === 'p-17') return { patient: { id: 'p-17', name: 'Exact Patient' }, reason: 'stable-id' };
        return { patient: null, reason: 'ambiguous-name', count: 2 };
      }
    },
    __mlsPick: { select: (id) => { calls.selected.push(id); return true; } },
    openOpPrepForPatient: (id) => { calls.prepped.push(id); }
  }, overrides || {});
  const context = { window, document: { readyState: 'complete', addEventListener() {} }, console, setTimeout, clearTimeout };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'feat_mls_copilot_power.js' });
  return { window, calls };
}

(async function main() {
  /* ---- loading executes nothing ---- */
  {
    const { window, calls } = build();
    await tick(5);
    assert.strictEqual(calls.dayPull.length, 0, 'no tap, no pull — loading must execute nothing');
    assert(window.__mlsCopilotPower.handles('pullProviders'));
    assert(window.__mlsCopilotPower.handles('draftNote'));
    assert(!window.__mlsCopilotPower.handles('navigate'), 'existing kinds stay with their owners');
  }

  /* ---- name parsing: "Last, First" is one provider ---- */
  {
    const { window } = build();
    /* JSON round-trip: VM-realm arrays fail deepStrictEqual prototype identity. */
    const p = (arg) => JSON.parse(JSON.stringify(window.__mlsCopilotPower.parseProvidersArg(arg)));
    assert.deepStrictEqual(p('Smith, Adam').providers, ['Smith, Adam'], 'a comma split would shred athena names');
    assert.deepStrictEqual(p('Smith, Adam; Jones, Beth').providers, ['Smith, Adam', 'Jones, Beth']);
    const j = p('{"providers":["Smith, Adam","Ghost, Doc"],"date":"2026-08-01"}');
    assert.deepStrictEqual(j.providers, ['Smith, Adam', 'Ghost, Doc']);
    assert.strictEqual(j.date, '2026-08-01');
    assert.strictEqual(p('{"providers":[],"date":"junk"}').date, '', 'a malformed date is dropped, not sent');
  }

  /* ---- the tapped offer: sequential pulls, honest receipts, fail-closed skip ---- */
  {
    const { window, calls } = build();
    const btn = { disabled: false, textContent: 'Pull the missing providers', classList: { add() {} } };
    const started = window.__mlsCopilotPower.run('pullProviders',
      '{"providers":["Smith, Adam","Jones, Beth","Ghost, Doc"],"date":"2026-08-01"}', btn);
    assert.strictEqual(started, true);
    assert.strictEqual(btn.disabled, true, 'the button must show the run is in progress — pending is not failure');
    await tick(10); await tick(10);
    assert.strictEqual(calls.dayPull.length, 2, 'exactly the two verified providers pull — the ghost is never guessed');
    assert.strictEqual(calls.dayPull[0].provider.stableKey, 'athena:smith, adam');
    assert.strictEqual(calls.dayPull[0].date, '2026-08-01');
    assert.strictEqual(calls.dayPull[0].includeHistory, true);
    assert.strictEqual(calls.dayPull[1].provider.stableKey, 'athena:jones, beth');
    assert.strictEqual(btn.disabled, false, 'the button recovers after the run');
    const finalReport = calls.said[calls.said.length - 1];
    assert(/Smith, Adam.*3 added/.test(finalReport), 'the receipt must carry the real created count');
    assert(/Ghost, Doc/.test(finalReport) && /never guesses/.test(finalReport), 'the skipped provider is named with the reason');
    assert(calls.said.every(t => String(t).trim().length > 0), 'every posted receipt must carry real text — an empty bubble is a dead receipts channel');
  }

  /* ---- early stop: providers never attempted are NAMED in the receipt ---- */
  {
    let first = true;
    const { window, calls } = build({
      __mlsSI: { dayPull: () => {
        if (first) { first = false; return Promise.resolve({ ok: false, reason: 'pull-in-flight' }); }
        return Promise.resolve({ ok: true, created: 1, repaired: 0, failed: 0 });
      } }
    });
    window.__mlsCopilotPower.run('pullProviders', '{"providers":["Smith, Adam","Jones, Beth"]}', null);
    await tick(10); await tick(10);
    const finalReport = calls.said[calls.said.length - 1];
    assert(/Not attempted/.test(finalReport) && /Jones, Beth/.test(finalReport),
      'a queue stopped early must name the providers it never ran — "finished" alone is a lie');
  }

  /* ---- engine failure reported in the engine's words ---- */
  {
    const { window, calls } = build({
      __mlsSI: { dayPull: () => Promise.resolve({ ok: false, reason: 'provider-roster-incomplete' }) }
    });
    window.__mlsCopilotPower.run('pullProviders', '{"providers":["Smith, Adam"]}', null);
    await tick(10);
    const finalReport = calls.said[calls.said.length - 1];
    assert(/not pulled/.test(finalReport) && /provider-roster-incomplete/.test(finalReport),
      'a refusal must surface the engine reason, never a fake success');
  }

  /* ---- busy engine refuses honestly, zero pulls ---- */
  {
    const { window, calls } = build({ __mlsDayHistoryPull: { state: { running: true } } });
    const started = window.__mlsCopilotPower.run('pullProviders', '{"providers":["Smith, Adam"]}', null);
    await tick(10);
    assert.strictEqual(started, false);
    assert.strictEqual(calls.dayPull.length, 0, 'a busy engine must never receive a second pull');
    assert(calls.said.some(t => /already in progress/.test(t)));
  }

  /* ---- no engine: honest refusal ---- */
  {
    const { window, calls } = build({ __mlsSI: undefined });
    assert.strictEqual(window.__mlsCopilotPower.run('pullProviders', '{"providers":["Smith, Adam"]}', null), false);
    assert.strictEqual(calls.dayPull.length, 0);
    assert(calls.said.some(t => /pull engine is not available/.test(t)));
  }

  /* ---- draftNote: exact patient -> select + open prep ---- */
  {
    const { window, calls } = build();
    assert.strictEqual(window.__mlsCopilotPower.run('draftNote', 'p-17', null), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.selected)), ['p-17']);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls.prepped)), ['p-17']);
  }

  /* ---- draftNote: ambiguous fails closed ---- */
  {
    const { window, calls } = build();
    assert.strictEqual(window.__mlsCopilotPower.run('draftNote', 'Ambiguous Name', null), false);
    assert.strictEqual(calls.selected.length, 0, 'an ambiguous patient must never be selected');
    assert.strictEqual(calls.prepped.length, 0);
    assert(calls.toasts.some(t => /Could not uniquely find/.test(t)));
  }

  console.log('PASS Copilot Power executors: confirm-by-tap pulls with honest receipts, fail-closed targeting');
})().catch(e => { console.error(e); process.exit(1); });
