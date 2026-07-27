'use strict';

/* THE DEFAULT PROVIDER IS WHOEVER IS SIGNED IN (b739). 'mine' resolved
 * realName() -> SCRAPED name, and the scraped name is whoever's Athena grid
 * happened to be open - which is how another provider became the default.
 * Now: explicit finder choice > explicit pick > stored display name >
 * SIGNED-IN ACCOUNT NAME > scrape; and an empty display name is seeded from
 * the account once, so every other consumer of that key resolves right too. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_athena_provider_picker.js'), 'utf8');

/* source pins */
assert(src.includes('var rn = realName() || accountProviderName();'),
  "the signed-in account must outrank the scraped fallback in 'mine'");
assert(src.includes("if (!realName() && accountProviderName()) lsSet('providerDisplayName', accountProviderName());"),
  'an empty display name must seed from the account, once, only when empty');

/* runtime: slice the resolution functions and drive the order */
const slice = src.slice(src.indexOf('function realName()'), src.indexOf('function apptDate'));
const store = {};
const ctx = {
  PICK_KEY: 'pick',   /* the module declares this above the slice; value is opaque */
  window: { bkUser: { name: 'Matthew Schaeffer' } },
  clean: s => String(s == null ? '' : s).trim(),
  lsGet: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  lsSet: (k, v) => { store[k] = String(v); },
  safe: (fn, d) => { try { return fn(); } catch (e) { return d; } },
  console
};
vm.createContext(ctx);
vm.runInContext(slice, ctx, { filename: 'provider-picker-slice.js' });

/* 1 - empty settings + a stale scrape: the ACCOUNT wins, and seeds the key */
store.providerName = 'Some Other Provider';
let d = ctx.selectedDoctor();
assert.strictEqual(d.name, 'Matthew Schaeffer', 'the signed-in doctor must be the default, not the scraped grid name');
assert.strictEqual(store.providerDisplayName, 'Matthew Schaeffer', 'the display name must be seeded from the account');

/* 2 - an explicit stored display name is never overwritten and still wins */
store.providerDisplayName = 'Dr Configured Name';
d = ctx.selectedDoctor();
assert.strictEqual(d.name, 'Dr Configured Name', 'an explicit Settings name still outranks the account');

/* 3 - an explicit non-mine pick outranks everything below it */
ctx.setPick('Dr Colleague');
d = ctx.selectedDoctor();
assert.strictEqual(d.name, 'Dr Colleague', 'an explicit pick must still win');
ctx.setPick('mine');

/* 4 - no account (signed out): falls back to scrape as before */
ctx.window.bkUser = null;
delete store.providerDisplayName;
d = ctx.selectedDoctor();
assert.strictEqual(d.name, 'Some Other Provider', 'without an account the old scrape fallback remains');

console.log('PASS provider default is the signed-in doctor: account outranks scrape, seeds once, never overwrites an explicit name, explicit picks still win, signed-out behavior unchanged');
