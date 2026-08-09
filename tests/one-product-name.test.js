'use strict';

/* ONE PRODUCT NAME  (2026-08-08)
 * =============================================================================
 * Owner, having opened phone-setup.html on his own iPhone and read "Put
 * Scrivara on your iPhone" above an MLS logo and the mlsscribe.com address bar:
 *
 *   "No this should save mlsscribe everywhere fix everywhere what it says the
 *    wrong thing to."
 *
 * WHY A SWEEP AND NOT A LIST. The old name reached the store app, its web
 * manifest, its iOS display name, its Android strings.xml, the setup guide, the
 * desktop Settings card that sends people to that guide, and three store
 * documents — seven surfaces owned by four lanes. A test that named the files
 * already known to be wrong would have passed the moment the eighth appeared,
 * which is this repo's most-repeated defect shape. So this reads the REVIEWED
 * PUBLICATION INVENTORY — the list of what actually ships — plus the native
 * build inputs, and refuses the name anywhere a person can read it.
 *
 * AND WHY IT IS NOT A BLIND STRING BAN. Three lowercase forms are load-bearing
 * infrastructure and renaming any of them is an outage or a permanent fork:
 *
 *   scrivara-backend.onrender.com  the LIVE API host. Renaming it in the client
 *                                  points the whole product at nothing.
 *   com.scrivara.app               the bundle identifier / applicationId.
 *                                  Permanent once a store build is uploaded:
 *                                  a different id is a different app, with no
 *                                  upgrade path for anyone who installed the
 *                                  first one.
 *   scrivara.session.v1            the store app's own localStorage keys.
 *                                  Renaming them signs every installed phone
 *                                  out, silently, on one deploy.
 *
 * Those are asserted PRESENT below, as positive controls. A suite that only
 * banned a string would go green if somebody "fixed" the backend host too.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const OLD = /Scrivara/g;           /* the product name, as a person would read it */
const NEW = 'MLS Scribe';

/* ---- 1. the name is gone from everything a person reads ------------------ */

const inventory = JSON.parse(read('pages-publication-inventory.json'));
const shipped = inventory.paths.filter((p) => /\.(html|json|webmanifest|js)$/.test(p));

/* Native build inputs are not in the web inventory but ARE what lands under the
   icon on a phone, which is exactly the surface the owner was reading. */
const NATIVE = [
  'mobile/app.config.json',
  'mobile/capacitor.config.json',
  'mobile/android/app/src/main/res/values/strings.xml',
  'mobile/ios/App/App/Info.plist',
  'mobile/scripts/build-www.mjs'
].filter((p) => fs.existsSync(path.join(root, p)));

/* Comments explain WHY the name changed and necessarily contain it. Strip them
   the same way the repo's other prose-aware suites do, and grade the rest. */
function codeOnly(src, file) {
  let s = src;
  if (/\.(html)$/.test(file)) s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  if (/\.(plist|xml)$/.test(file)) s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'])\/\/[^\n]*/g, '$1');
  /* JSON has no comment syntax, so this repo carries prose in "_comment" keys.
     They are documentation and are stripped like any other comment. */
  s = s.replace(/"_comment"\s*:\s*\[[\s\S]*?\]/g, ' ').replace(/"_comment"\s*:\s*"[^"]*"/g, ' ');
  return s;
}

const offenders = [];
for (const rel of shipped.concat(NATIVE)) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const code = codeOnly(read(rel), rel);
  /* The ops filename in a runbook is a real file on a signing machine, not copy. */
  const hits = (code.replace(/Scrivara\.mobileprovision/g, ' ').match(OLD) || []).length;
  if (hits) {
    const line = code.split('\n').findIndex((l) => /Scrivara/.test(l)) + 1;
    offenders.push('    ' + rel + (line ? ':~' + line : '') + '  (' + hits + ')');
  }
}
assert.strictEqual(offenders.length, 0,
  'The old product name is still readable on ' + offenders.length + ' shipped surface(s). It reached ' +
  'seven surfaces across four lanes the first time, which is why this reads the publication inventory ' +
  'rather than a list of files:\n' + offenders.join('\n'));

/* ---- 2. and the new one is actually there -------------------------------- */
/* A ban alone passes on a file that says nothing at all. Each of these is a
   string a person reads: a page title, a Home Screen label, a store name. */
const MUST_SAY = [
  ['phone-setup.html', 'the setup guide the QR points at'],
  ['app-manifest.json', 'the web app manifest — the Home Screen label for an installed PWA'],
  ['mobile/android/app/src/main/res/values/strings.xml', 'the Android app label'],
  ['mobile/ios/App/App/Info.plist', 'the iOS display name'],
  ['mobile/app.config.json', 'the one place the native identity is defined']
];
for (const [rel, what] of MUST_SAY) {
  if (!fs.existsSync(path.join(root, rel))) continue;
  assert(read(rel).indexOf(NEW) >= 0, rel + ' no longer carries the product name at all — ' + what);
}
{
  const page = read('phone-setup.html');
  assert(/Put MLS Scribe on your/.test(page),
    'the guide headline is the sentence the owner photographed; it must name the product he owns');
  assert(/Do this on the MLS Scribe screen, not on this one/.test(page),
    'the one sentence that stops a doctor bookmarking the instructions must survive the rename');
}
{
  /* The two apps must not both install as "MLS": two identical labels on one
     Home Screen is a rename that solved nothing. */
  const full = JSON.parse(read('manifest.webmanifest'));
  const small = JSON.parse(read('app-manifest.json'));
  assert.notStrictEqual(String(small.short_name), String(full.short_name),
    'both apps now install under "' + full.short_name + '" — indistinguishable on a Home Screen');
  assert(/MLS/.test(String(small.short_name)) && /MLS/.test(String(full.short_name)),
    'both are still the same product and must both read as MLS');
}

/* ---- 3. the three infrastructure names are UNTOUCHED --------------------- */
/* Positive controls. Without these, "fix everywhere it says the wrong thing"
   reads as a licence to rename the live API host, and the suite would applaud. */
{
  const connect = read('mls-connect.js');
  assert(connect.indexOf('scrivara-backend.onrender.com') >= 0,
    'THE OUTAGE ONE: the live API host was renamed. It is an address, not a brand — the client would ' +
    'point at a hostname that does not resolve.');

  const gradle = read('mobile/android/app/build.gradle');
  assert(/applicationId "com\.scrivara\.app"/.test(gradle),
    'the Android applicationId was renamed. It is PERMANENT once a build is uploaded: a different id is ' +
    'a different app, a different listing, and no upgrade path for anyone already installed.');

  const cap = JSON.parse(read('mobile/capacitor.config.json'));
  assert.strictEqual(cap.appId, 'com.scrivara.app', 'the Capacitor bundle id must match the Android one');

  const app = read('app.html');
  assert(/scrivara\.session\.v1/.test(app) && /scrivara\.lastEmail\.v1/.test(app),
    'the store app\'s localStorage keys were renamed — every installed phone would be signed out ' +
    'silently on the next deploy, with no message explaining why');
}

console.log('PASS one product name: swept ' + (shipped.length + NATIVE.length) + ' shipped + native surfaces ' +
  'from the reviewed publication inventory (not a hand-list) — the old name is readable on none of them; ' +
  'the guide headline, both Home Screen labels and the native identity carry "MLS Scribe"; the two apps ' +
  'still install under DIFFERENT labels; and the live API host, the permanent bundle id and the session ' +
  'storage keys are asserted intact, so a broader rename cannot pass this as a fix.');
