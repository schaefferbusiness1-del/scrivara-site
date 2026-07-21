'use strict';

/* Owner goal 2026-07-21 (provider identity): a LOGIN/account name must never
 * silently become the clinical provider identity. "Michael Schaeffer" (the
 * account holder who filled the setup form) appeared as the provider in the
 * doctor's workflow while every Athena appointment said "Matthew Schaeffer,
 * MD". The data was corrected live (b475); this pins the SYSTEMIC guards so
 * the class of bug cannot come back, for any account:
 *
 *  - refreshMe seeds uns('providerName') only from an explicit provider
 *    PREFERENCE — never from the server's login-account fallback
 *    (practice.provider_source === 'account-fallback');
 *  - the setup wizard keeps the typed name as the ACCOUNT display name and
 *    refuses to seed the provider identity when a verified Athena roster
 *    exists and the name matches none of its providers;
 *  - the runtime provider resolver stays roster-exact-match with a refusal on
 *    ambiguity (never surname guessing), and no clinician name is hardcoded.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

// ---- refreshMe: preference-only provider seeding ----------------------------
assert(app.includes("if(pp.provider_name&&pp.provider_source!=='account-fallback') localStorage.setItem(uns('providerName')"),
  'refreshMe must refuse to seed providerName from the login-account fallback');

// ---- setup wizard: account name is not a provider claim ---------------------
assert(app.includes('function suProviderIdentityKey('), 'the wizard identity normalizer is missing');
assert(app.includes('suRosterMismatch'), 'the wizard roster-mismatch guard is missing');
const wizard = app.slice(app.indexOf('function suPersistIdentity()'), app.indexOf('function suFinish()'));
assert(wizard.indexOf("localStorage.setItem(uns('docname'), nm);") >= 0, 'the account display name is always kept');
assert(/suRosterMismatch[\s\S]*else if\(nm\)\{\s*localStorage\.setItem\(uns\('providerName'\), nm\);/.test(wizard),
  'providerName may only be seeded when the roster does not contradict the typed name');
assert(!/removeItem\(uns\('providerName'\)\)/.test(wizard),
  'the wizard must never delete an existing provider identity');

// ---- runtime resolver: roster exact match, refuse ambiguity, no hardcoding --
const resolver = connect.slice(connect.indexOf('function resolveProviderName()'), connect.indexOf('var provFn = function'));
assert(resolver.includes('unsGet("providerName")'), 'an explicit Practice setting must stay first');
assert(resolver.includes('exact.length === 1'), 'roster resolution must require exactly one identity match');
assert(resolver.includes('return "";'), 'ambiguity must resolve to empty (the UI asks), never a guess');
for (const name of ['Michael Schaeffer', 'Matthew Schaeffer', 'Schaeffer']) {
  assert(!connect.includes(`'${name}'`) && !connect.includes(`"${name}"`),
    `no clinician name may be hardcoded in the bundle (found ${name})`);
}

// ---- functional: the wizard normalizer matches real athenaOne shapes --------
const keyFn = app.slice(app.indexOf('function suProviderIdentityKey('), app.indexOf('function suRosterEntries('));
const ctx = { String };
vm.createContext(ctx);
vm.runInContext(keyFn + '\nthis.k = suProviderIdentityKey;', ctx);
assert.strictEqual(ctx.k('Schaeffer_Matthew_MD'), ctx.k('Matthew Schaeffer, MD'), 'machine roster names must match display names');
assert.strictEqual(ctx.k('Dr. Matthew Schaeffer'), ctx.k('Schaeffer, Matthew'), 'Dr. prefix and Last, First must normalize');
assert.notStrictEqual(ctx.k('Michael Schaeffer'), ctx.k('Matthew Schaeffer, MD'), 'different clinicians must never match');

console.log('PASS provider identity separation: preference-only seeding, wizard roster guard, roster-exact resolution with refusal on ambiguity, and no hardcoded clinician names');
