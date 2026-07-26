'use strict';

/* MY CREATIONS — durability contract for "Build a custom tool".
 *
 * Every assertion here corresponds to a defect measured on the owner's live
 * signed-in tab on 2026-07-26, before the storage layer was rewritten:
 *
 *   1. studioSetSaved swallowed every exception, so a save that hit the browser
 *      quota persisted NOTHING and still showed a green "Saved to My creations."
 *      toast. (Proved live by forcing a QuotaExceededError on the real page,
 *      which was reachable: that profile held 1.86 MB with ~2.9 MB of headroom
 *      and a single generated tool may be 90,000 chars.)
 *   2. The key was the global 'sf_studio_widgets' while 175 other keys in the app
 *      are uns()-scoped, so creations crossed accounts on a shared workstation.
 *   3. Open/Delete addressed items by ARRAY INDEX, so any reorder acted on a
 *      different tool than the one clicked.
 *   4. Pressing Save twice made two identical cards.
 *   5. .slice(0,40) dropped the oldest creation silently — including a PINNED one
 *      the doctor had put in their top nav.
 *
 * It also pins the guarantee that makes "Save" mean anything at all: logout
 * purges the entire account namespace on shared clinical workstations, so the
 * list must ride the encrypted per-user prefs blob and come back at next
 * sign-in — merged by id, never gap-filled.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `could not extract ${start}`);
  return source.slice(a, b);
}

const storeSource = between(app, "var STUDIO_KEY_LEGACY='sf_studio_widgets';", 'var STUDIO_TEMPLATES=[');
const findSource = between(app, 'function _pinnedFindById(id)', 'function openPinnedWidget(id)');
const prefsValueSource = between(app, 'function _studioPrefsValue(', 'function syncPrefsToServer(opts){');

// ------------------------------------------------- shipped-source contract ---
assert(!/localStorage\.setItem\('sf_studio_widgets'/.test(app),
  'the global (non-account) creations key is still being written');
assert(/PREF_SYNC_KEYS[\s\S]{0,1200}'studio_widgets'/.test(app),
  'creations are not in PREF_SYNC_KEYS — they would not survive the logout purge');
assert(app.includes("openStudioSaved(\\'") && app.includes("deleteStudioSaved(\\'") &&
  app.includes("togglePinWidget(\\'"), 'saved-tool buttons must pass an id, not an array index');

// ------------------------------------------------------------------ harness ---
const KEY = 'sf_u::doc@example.com::studio_widgets';

function makeEnv(opts) {
  opts = opts || {};
  const storage = new Map();
  const env = { storage, toasts: [], statuses: [], dialogs: [], synced: [] };
  let quotaCap = opts.quotaCap || Infinity;

  const ctx = {
    console, JSON, String, Number, Boolean, Object, Array, Math, Date, RegExp, Error,
    isFinite, parseInt, parseFloat, Promise,
    /* Run deferred work inline. The account push is debounced, so a no-op
       setTimeout would make this suite blind to whether a write syncs at all -
       which is exactly the defect (measured live at b696) that 1b now pins. */
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {},
    localStorage: {
      getItem(k) { return storage.has(k) ? storage.get(k) : null; },
      setItem(k, v) {
        v = String(v);
        if (v.length > quotaCap) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        storage.set(k, v);
      },
      removeItem(k) { storage.delete(k); }
    },
    uns(key) { return 'sf_u::doc@example.com::' + key; },
    toast(m, k) { env.toasts.push({ message: String(m), kind: k || '' }); },
    studioStatus(m, c) { env.statuses.push({ message: String(m || ''), color: c || '' }); },
    studioFail(m) { env.statuses.push({ message: String(m || ''), failed: true }); },
    _ce(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, ''); },
    syncPrefsToServer() { env.synced.push(ctx._studioPrefsValue()); },
    renderStudioSaved() {},                     // DOM render is proved on the live page, not here
    _renderPinnedTabs() {},
    renderStudioWidget(html, title) { ctx.studioLastHtml = html; ctx.studioLastPrompt = title; },
    _openFullscreenWidget() {},
    mlsConfirm(msg) { env.dialogs.push(String(msg)); return Promise.resolve(opts.confirm !== false); },
    mlsPrompt(msg, def) { env.dialogs.push(String(msg)); return Promise.resolve(opts.promptValue === undefined ? def : opts.promptValue); },
    Blob: function () {},
    URL: { createObjectURL() { return 'blob:x'; }, revokeObjectURL() {} },
    document: {
      getElementById() { return null; },
      createElement() { return { click() {}, remove() {}, style: {} }; },
      body: { appendChild() {} }
    },
    studioLastHtml: '',
    studioLastPrompt: ''
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(storeSource + '\n' + findSource + '\n' + prefsValueSource, ctx, { filename: 'studio-store' });
  ctx.STUDIO_LOCAL_BUDGET = opts.localBudget || 1200000;
  ctx.STUDIO_CLOUD_BUDGET = opts.cloudBudget || 250000;

  env.ctx = ctx;
  env.saved = () => JSON.parse(storage.get(KEY) || '[]');
  env.setQuota = (n) => { quotaCap = n; };
  return env;
}

async function run() {
  // ------------------------------------------------ 1. a save never lies -----
  {
    const env = makeEnv({ quotaCap: 10 });               // every real write fails
    env.ctx.studioLastHtml = '<html><body>chart</body></html>';
    env.ctx.studioLastPrompt = 'A bar chart of visits per month';
    env.ctx.saveStudioWidget();

    assert.strictEqual(env.storage.has(KEY), false, 'nothing should persist when storage is full');
    assert.strictEqual(env.toasts.filter(t => /saved/i.test(t.message) && t.kind === 'ok').length, 0,
      'REGRESSION: a failed save reported success — the exact defect measured live');
    const told = env.statuses.filter(s => s.failed);
    assert(told.length === 1 && /not saved/i.test(told[0].message),
      'a failed save must say plainly that the tool was NOT saved');
  }

  // ------- 1b. EVERY writer syncs, including the one that never calls Save ---
  {
    // Measured live at b696: a tool built in the Studio showed "in your account"
    // while GET /api/prefs held no creations. mls-connect.js's auto-save wrapper
    // calls studioSetSaved DIRECTLY and never reached the sync call that lived in
    // saveStudioWidget - and auto-save is how most tools get saved.
    const env = makeEnv();
    env.ctx.studioSetSaved([{ title: 'Auto-saved by the build wrapper', html: '<i>auto</i>', ts: 1, auto: true }]);
    assert(env.synced.length >= 1,
      'a write that bypasses saveStudioWidget must still push the account copy');
    const pushed = JSON.parse(env.synced[env.synced.length - 1] || '[]');
    assert.strictEqual(pushed.length, 1, 'the auto-saved tool must be in the synced payload');
  }

  // --------------------------- 2. per-account key + legacy migration ---------
  {
    const env = makeEnv();
    env.storage.set('sf_studio_widgets', JSON.stringify([
      { title: 'An older tool from before accounts', html: '<b>legacy</b>', ts: 1000 }
    ]));
    const list = env.ctx.studioGetSaved();

    assert.strictEqual(list.length, 1, 'a creation saved before namespacing must migrate, not vanish');
    assert(env.storage.has(KEY), 'creations must live under the uns() account key');
    assert.strictEqual(env.storage.has('sf_studio_widgets'), false, 'the global key must be cleared after migration');
    assert(list[0].id, 'every creation gets a stable id');
  }

  // ------------------------- 3. delete addresses a TOOL, not a row -----------
  {
    const env = makeEnv();
    env.ctx.studioSetSaved([
      { title: 'Alpha', html: '<i>a</i>', ts: 3000, named: true },
      { title: 'Beta', html: '<i>b</i>', ts: 2000, named: true },
      { title: 'Gamma', html: '<i>c</i>', ts: 1000, named: true }
    ]);
    const beta = env.saved().filter(w => w.title === 'Beta')[0];

    // A second tab reorders the list between render and click. The old
    // index-based delete removed whatever happened to sit at that row.
    env.ctx.studioSetSaved(env.saved().slice().reverse());
    await env.ctx.deleteStudioSaved(beta.id);

    assert.deepStrictEqual(env.saved().map(w => w.title).sort(), ['Alpha', 'Gamma'],
      'Delete must remove the tool that was clicked');
    assert(env.dialogs.some(d => /delete/i.test(d)), 'deleting a creation must be confirmed first');

    // A deletion must reach the account NOW. Debounced, a doctor who deletes and
    // closes the tab inside the window leaves the account copy holding the tool,
    // and the next sign-in merges it straight back in.
    assert(env.synced.length >= 1, 'deleting a tool must sync the account copy immediately');
    const pushed = JSON.parse(env.synced[env.synced.length - 1] || '[]').map(w => w.title);
    assert(pushed.indexOf('Beta') < 0, 'the deleted tool must be gone from the synced copy, not resurrected later');
  }

  // ------------------------------ 4. saving twice is one tool ---------------
  {
    const env = makeEnv();
    env.ctx.studioLastHtml = '<html>same</html>';
    env.ctx.studioLastPrompt = 'A sorted table of my patients by number of visits, showing first and last visit date';
    env.ctx.saveStudioWidget();
    env.ctx.saveStudioWidget();                          // the "did that work?" second press

    assert.strictEqual(env.saved().length, 1, 'pressing Save twice must not make two cards');
    assert(/already saved/i.test(env.toasts[env.toasts.length - 1].message),
      'the second press should say it is already saved, not claim a new save');

    // The auto-save wrapper in mls-connect.js writes a raw entry after every
    // build: {title: the WHOLE request, html, ts, auto:true}. It must collapse
    // into the same tool and get a real name.
    env.ctx.studioSetSaved([{ title: env.ctx.studioLastPrompt, html: '<html>same</html>', ts: Date.now(), auto: true }].concat(env.saved()));
    const all = env.saved();
    assert.strictEqual(all.length, 1, 'the auto-saver must not duplicate a tool the doctor already saved');
    assert(all[0].title.length <= 47 && !/,/.test(all[0].title),
      'a creation gets a NAME, not the raw request sliced mid-word: ' + all[0].title);
    assert(/sorted table/i.test(all[0].prompt || ''), 'the original request is kept for Refine');
  }

  // ----------------- 5. eviction is loud, and never takes a pinned tab ------
  {
    const env = makeEnv({ localBudget: 800 });   // two of these tools fit; a third does not
    const big = (tag) => '<html>' + tag.repeat(200) + '</html>';
    env.ctx.studioSetSaved([{ title: 'Pinned board', html: big('p'), ts: 1000, pinned: true, named: true }]);
    env.ctx.studioLastHtml = big('n');
    env.ctx.studioLastPrompt = 'A new overdue worklist';
    env.ctx.saveStudioWidget();

    const titles = env.saved().map(w => w.title);
    assert(titles.indexOf('Pinned board') >= 0, 'a PINNED tool must never be evicted to make room');
    // "A new overdue worklist" is named "New overdue worklist" — the leading
    // article is dropped so a card reads like a title, not a sentence.
    assert(titles.indexOf('New overdue worklist') >= 0, 'the new tool must be saved: ' + titles.join(' | '));

    // Now overflow with unpinned tools and confirm the user is TOLD what went.
    env.toasts.length = 0;
    env.ctx.studioLastHtml = big('q');
    env.ctx.studioLastPrompt = 'Another tool';
    env.ctx.saveStudioWidget();
    const msg = env.toasts.map(t => t.message).join(' ');
    assert(/made room/i.test(msg), 'evicting an older tool must be reported, not silent: ' + msg);
    assert(env.saved().some(w => w.pinned), 'the pinned tool still survives the second eviction');
  }

  // --------------------------------- 6. a name the doctor typed sticks ------
  {
    const env = makeEnv({ promptValue: 'Monday board' });
    env.ctx.studioSetSaved([{ title: 'Bar chart of visits per month', html: '<i>x</i>', ts: 1 }]);
    const id = env.saved()[0].id;
    await env.ctx.renameStudioSaved(id);
    assert.strictEqual(env.saved()[0].title, 'Monday board', 'rename must persist');

    env.ctx.studioSetSaved(env.saved());                 // any later write must not rewrite it
    assert.strictEqual(env.saved()[0].title, 'Monday board',
      'normalisation must never overwrite a title the doctor typed');
  }

  // --------------------- 7. the account copy restores, and merges by id -----
  {
    const env = makeEnv();
    env.ctx.studioSetSaved([{ title: 'Local only', html: '<i>local</i>', ts: 5000, named: true }]);
    const cloud = JSON.stringify([
      { id: 'w_cloud_1', title: 'From my other laptop', html: '<i>cloud</i>', ts: 4000, updatedAt: 4000, named: true },
      { id: 'w_cloud_2', title: 'Pinned elsewhere', html: '<i>cloud2</i>', ts: 3000, updatedAt: 3000, pinned: true, named: true }
    ]);
    const changed = env.ctx._studioMergeFromCloud(cloud);

    assert.strictEqual(changed, true, 'a cloud copy with new tools must change this device');
    const titles = env.saved().map(w => w.title).sort();
    assert.deepStrictEqual(titles, ['From my other laptop', 'Local only', 'Pinned elsewhere'],
      'merge is a UNION — a device with one tool must not ignore the others, and must not lose its own');

    // A tool edited on this device is not clobbered by an older account copy.
    const mine = env.saved();
    const local = mine.filter(w => w.id === 'w_cloud_1')[0];
    local.title = 'Renamed here'; local.named = true; local.updatedAt = 9999;
    env.ctx.studioSetSaved(mine);
    env.ctx._studioMergeFromCloud(cloud);
    assert.strictEqual(env.saved().filter(w => w.id === 'w_cloud_1')[0].title, 'Renamed here',
      'an older account copy must not overwrite a newer local edit');
  }

  // ------------------ 8. the cloud copy can never 413 the whole prefs blob ---
  {
    const env = makeEnv({ cloudBudget: 4000 });
    const fat = (t) => '<html>' + t.repeat(1500) + '</html>';
    env.ctx.studioSetSaved([
      { title: 'Pinned', html: fat('a'), ts: 1000, pinned: true, named: true },
      { title: 'Recent', html: fat('b'), ts: 3000, named: true },
      { title: 'Old', html: fat('c'), ts: 2000, named: true }
    ]);
    const payload = env.ctx._studioPrefsValue();
    assert(payload.length <= 4000, 'the synced value must respect the cloud budget: ' + payload.length);
    const kept = JSON.parse(payload).map(w => w.title);
    assert(kept.indexOf('Pinned') >= 0, 'pinned tools are synced first — they are the doctor\'s tabs');
    assert(JSON.parse(env.storage.get(KEY)).length === 3, 'trimming the CLOUD copy must not delete anything locally');
  }

  console.log('PASS studio creations durability: honest failure, account-scoped key + migration, id-addressed delete, ' +
    'save idempotence with the auto-saver, loud eviction that spares pinned tabs, sticky rename, cloud union-merge, and a bounded sync payload');
}

run().catch((err) => { console.error('FAIL studio creations durability:', err && err.message || err); process.exit(1); });
