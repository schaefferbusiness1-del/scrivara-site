'use strict';

/* Synthetic v3.0.79 contract: a discarded Athena tab is a recoverable,
 * user-visible sleeping state. Recovery is exact-tab-only, lease-scoped, and
 * never a signed-out or automatic-retry shortcut. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const app = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const feat = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');

function block(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert(start >= 0, `missing ${name}`);
  const brace = source.indexOf('{', start); let depth = 0; let quote = ''; let esc = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    if (quote) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

function harness({ focused = true, focusedWindowId = 2, leaseTab = 101, signedOut = false } = {}) {
  const tabs = {
    101: { id: 101, windowId: 2, active: false, discarded: true, status: 'unloaded', url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp' },
    202: { id: 202, windowId: 3, active: true, discarded: true, status: 'unloaded', url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp' }
  };
  const log = { updates: [], reloads: [], windows: [], pings: 0, releases: 0, ensures: 0 };
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, RegExp, Boolean, URL,
    setTimeout, clearTimeout,
    self: { __mlsQp: leaseTab ? { active: true, athenaTabId: leaseTab } : { active: false, athenaTabId: null } },
    chrome: {
      windows: {
        getLastFocused: async () => ({ id: focusedWindowId, focused }),
        update: async (id, patch) => { log.windows.push({ id, patch }); return { id, focused: true }; }
      },
      tabs: {
        get: async id => { if (!tabs[id]) throw new Error('missing'); return tabs[id]; },
        update: async (id, patch) => { log.updates.push({ id, patch }); tabs[id].active = true; tabs[id].discarded = false; tabs[id].status = 'complete'; return tabs[id]; },
        reload: async id => { log.reloads.push(id); tabs[id].discarded = false; tabs[id].status = 'complete'; return undefined; }
      }
    },
    mlsSleepW: async () => {},
    mlsAthTabSleeping: t => !!(t && (t.discarded === true || t.status === 'unloaded')),
    mlsAthTabHost: t => new URL(t.url).hostname,
    mlsAthIsLoginish: () => signedOut,
    mlsAthPing: async () => { log.pings++; return signedOut ? ({ alive: false, reachable: true, signedOut: true }) : ({ alive: true, reachable: true, signedOut: false }); },
    mlsAthRejectSignedOut: () => {}
  };
  ctx.self.__mlsQp.epoch = 0;
  ctx.self.__mlsQpRelease = async () => { log.releases++; ctx.self.__mlsQp.epoch++; ctx.self.__mlsQp.active = false; ctx.self.__mlsQp.athenaTabId = null; };
  ctx.self.__mlsQpEnsure = async tab => { log.ensures++; ctx.self.__mlsQp.active = true; ctx.self.__mlsQp.athenaTabId = tab.id; return 'visible'; };
  vm.createContext(ctx);
  vm.runInContext(`${block(background, 'mlsAthRecoverExactSleepingTab')}; this.recover = mlsAthRecoverExactSleepingTab;`, ctx);
  return { ctx, log };
}

(async () => {
  { const h = harness(); const r = await h.ctx.recover(101, { explicitUserPull: true, foregroundOk: true, appTabId: 9 }); assert(r.ok && r.reason === 'athena-tab-recovered'); assert.deepStrictEqual(h.log.reloads, [], 'recovery must never reload Athena'); assert.deepStrictEqual(h.log.updates.map(x => x.id), [101]); assert.deepStrictEqual(h.log.windows, [], 'recovery must not raise or focus a window'); assert(h.log.pings >= 1, 'activation was trusted without an all-frame reprobe'); assert.strictEqual(h.log.releases, 1); assert.strictEqual(h.log.ensures, 1); }
  { const h = harness({ leaseTab: 202 }); const r = await h.ctx.recover(101, { explicitUserPull: true, foregroundOk: true }); assert.strictEqual(r.reason, 'athena-lease-mismatch'); assert.strictEqual(h.log.releases, 0); assert.strictEqual(h.log.reloads.length, 0); }
  { const h = harness({ focused: false }); const r = await h.ctx.recover(101, { explicitUserPull: true, foregroundOk: true }); assert.strictEqual(r.reason, 'athena-tab-sleeping'); assert.strictEqual(h.log.reloads.length, 0); }
  { const h = harness({ focusedWindowId: 1 }); const r = await h.ctx.recover(101, { explicitUserPull: true, foregroundOk: true }); assert.strictEqual(r.reason, 'athena-tab-sleeping'); assert.strictEqual(h.log.updates.length, 0, 'a tab in another Chrome window was activated'); }
  { const h = harness(); const r = await h.ctx.recover(101, { explicitUserPull: false, foregroundOk: true }); assert.strictEqual(r.reason, 'athena-tab-sleeping'); assert.strictEqual(h.log.updates.length, 0, 'forged boolean flags bypassed the user gesture gate'); }
  { const h = harness({ signedOut: true }); const r = await h.ctx.recover(101, { explicitUserPull: true, foregroundOk: true }); assert.strictEqual(r.reason, 'athena-signed-out'); assert.strictEqual(h.log.releases, 0); }
  assert(app.includes("athena-tab-sleeping"), 'app keeps sleeping as a distinct receipt reason');
  assert(/Wake Athena and retry/.test(app), 'failed-pull UI lacks explicit recovery action');
  assert(/schedule rows only — no patient chart or history is opened/.test(app), 'Full Visit Notes OFF copy is stale');
  assert(/state: 'unset', on: false/.test(app), 'first use still defaults Full Visit Notes ON');
  assert(/permission\|stopped-by-user\|athena-tab-sleeping/.test(app), 'automatic convergence does not veto sleeping');
  assert(/isTrusted !== true/.test(fs.readFileSync(path.join(root, 'content.js'), 'utf8')) && /mlsAppWakeAthenaGestureArmRequest/.test(fs.readFileSync(path.join(root, 'content.js'), 'utf8')), 'wake bridge lacks trusted consumed gesture arm');
  assert(/wake-recovery-in-flight/.test(background), 'wake relay lacks one-flight/duplicate guard');
  assert(/requestId/.test(background) && /__mlsWakeRecoverySeen/.test(background), 'wake relay lacks stale request ownership guard');
  assert(/var proof = await mlsAthPing\(id, 3500\)/.test(background), 'recovery lacks same-tab all-frame reprobe');
  assert(/AUTOMATIC_HISTORY_RETRY_REASON = \/\^\(visit-bodies/.test(feat) && !/AUTOMATIC_HISTORY_RETRY_REASON\s*=\s*\/[^\n]*athena-tab-sleeping/.test(feat), 'history sweep must not auto-retry sleeping');
  console.log('PASS mac-sleep-recovery-contract: exact lease recovery, sleeping/signed-out distinction, no auto-retry, explicit UI, and OFF copy');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
