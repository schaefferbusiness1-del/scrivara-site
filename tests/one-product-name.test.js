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
 * SECOND PASS, same day: "fix what u have to get ride of the schribva anywhre
 * it sohudl always saya mlsscribe." The first pass changed only what a person
 * READS. This one takes the identifiers too — the bundle id, the Android Java
 * package, the storage keys, the npm package, the CI artifact names, the
 * signing profile, the gradle marker, and every remaining source comment.
 *
 * EXACTLY ONE FORM SURVIVES, AND IT IS AN ADDRESS, NOT A BRAND:
 *
 *   scrivara-backend.onrender.com   the LIVE API host — it answered HTTP 200
 *                                   while this was written. Renaming it in the
 *                                   client does not rename the server; it
 *                                   points the product at a hostname that
 *                                   returns 404, which is a total outage for
 *                                   every login, every pull and every note.
 *                                   The Render service must be renamed (or a
 *                                   custom domain attached) FIRST — then this
 *                                   string follows and this exemption is
 *                                   deleted. mlsscribe-backend.onrender.com
 *                                   404s today, so the name is free.
 *
 * It is asserted PRESENT below, as a positive control. A suite that only banned
 * a string would go green the day somebody "finished the job" and took the
 * product down doing it.
 *
 * TWO RENAMES NEEDED MORE THAN A REPLACE, and both are pinned here:
 *   - the store app's localStorage keys carry a MIGRATION, or every installed
 *     phone is signed out silently on the next deploy;
 *   - the gradle release-config MARKER and the script that greps for it are one
 *     contract. Renaming either alone makes configure-native.mjs re-inject the
 *     release block on every run, because it can never find the marker it wrote.
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

/* WHY THIS EXEMPTION IS A SHORT NAMED LIST AND NOT A BLANKET RULE.
   The first version of this suite stripped comments from EVERY file before
   grading, so that the files explaining the rename would not trip the ban they
   describe. That hole SHIPPED: 24 comment occurrences survived across the three
   ScribeFlow copies -- "Teach Scrivara", "Scrivara can run in TWO modes",
   "TEACH SCRIVARA", scrivara-api.example.com -- and this suite reported PASS on
   every one of them, because it had stopped looking at exactly the place they
   lived. Passing and checking-nothing are indistinguishable from outside.
   So comments are stripped ONLY in the two files whose job is to record why the
   name changed. Everywhere else, a comment counts. */
const EXPLAINS_THE_RENAME = new Set([
  /* feat_mls_phone_ui.js no longer needs an exemption: its header was rewritten
     to explain the change without naming the old brand (b983). */
  'mobile/app.config.json'      /* the _comment block records the decision */
]);
function codeOnly(src, file) {
  if (!EXPLAINS_THE_RENAME.has(file)) return src;   /* comments count */
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

/* ---- 3. the identifiers moved TOO, and each one that needed care got it --- */
{
  /* The bundle id, in all five places that must agree. It was still free: the
     runbook describes the store upload as a future step, and an id is permanent
     from the first upload onward — this was the last moment it could move. */
  const gradle = read('mobile/android/app/build.gradle');
  assert(/applicationId "com\.mlsscribe\.app"/.test(gradle), 'the Android applicationId must carry the new id');
  assert(/namespace = "com\.mlsscribe\.app"/.test(gradle), 'and so must the namespace');
  assert.strictEqual(JSON.parse(read('mobile/capacitor.config.json')).appId, 'com.mlsscribe.app',
    'the Capacitor bundle id must match the Android one');
  assert.strictEqual(JSON.parse(read('mobile/app.config.json')).appId, 'com.mlsscribe.app',
    'and so must the one place the native identity is defined');
  assert(fs.existsSync(path.join(root, 'mobile/android/app/src/main/java/com/mlsscribe/app/MainActivity.java')),
    'the Java package DIRECTORY must move with the id — a package declaration that does not match its ' +
    'path does not compile');
  assert(!fs.existsSync(path.join(root, 'mobile/android/app/src/main/java/com/scrivara')),
    'the old Java package directory is still on disk');
  assert(/package com\.mlsscribe\.app;/.test(read('mobile/android/app/src/main/java/com/mlsscribe/app/MainActivity.java')),
    'and the package declaration inside it');

  /* THE STORAGE KEYS CARRY A MIGRATION. Renaming them bare signs every
     installed phone out on the next deploy — silently, with no message, on an
     app whose whole job is to be already signed in when it is picked up. */
  const app = read('app.html');
  assert(/var TOK_KEY = 'mlsscribe\.session\.v1'/.test(app) && /var EMAIL_KEY = 'mlsscribe\.lastEmail\.v1'/.test(app),
    'the storage keys must carry the new name');
  assert(/scrivara\.session\.v1/.test(app) && /scrivara\.lastEmail\.v1/.test(app),
    'THE SIGN-OUT ONE: the OLD key names must still appear — in the migration that reads them. Renaming ' +
    'the keys without carrying the old values across logs every installed phone out.');
  const mig = app.slice(app.indexOf('function migrateStorageKeys'), app.indexOf('var IDLE_MS'));
  assert(/getItem\(TOK_KEY\) === null/.test(mig) && /getItem\(EMAIL_KEY\) === null/.test(mig),
    'the migration must only ADOPT into an EMPTY key — a leftover old value overwriting a live session ' +
    'is worse than not migrating at all');
  assert(/removeItem\('scrivara\.session\.v1'\)/.test(mig) && /removeItem\('scrivara\.lastEmail\.v1'\)/.test(mig),
    'and must clear the old keys, or it migrates on every launch forever');
  /* Longhand on purpose: phone-app-boundaries proves this app persists nothing
     but these two keys by matching the IDENTIFIER at each setItem call site, so
     a table-driven loop with a computed key is unprovable there. */
  assert(/localStorage\.setItem\(TOK_KEY, oldTok\)/.test(mig) && /localStorage\.setItem\(EMAIL_KEY, oldEmail\)/.test(mig),
    'the migration must write through the NAMED key constants — a computed key defeats the no-PHI-at-rest ' +
    'guard, which can only prove what it can see');

  /* THE GRADLE MARKER AND ITS READER ARE ONE CONTRACT. */
  const marker = '// mlsscribe: release config';
  assert(read('mobile/android/app/build.gradle').indexOf(marker) >= 0, 'the gradle marker must be renamed');
  assert(read('mobile/scripts/configure-native.mjs').indexOf(marker) >= 0,
    'and the script that greps for it must be renamed IN THE SAME COMMIT — otherwise it never finds the ' +
    'marker it wrote and re-injects the whole release block on every run');
  assert(!/scrivara: release config/.test(read('mobile/scripts/configure-native.mjs')),
    'no half-renamed marker may remain in the script');
}

/* ---- 4. the ONE address that must NOT move ------------------------------- */
/* A positive control. Without it, "get rid of it anywhere" reads as a licence
   to rename the live API host, and this suite would applaud the outage. */
{
  const HOST = 'scrivara-backend.onrender.com';
  assert(read('mls-connect.js').indexOf(HOST) >= 0,
    'THE OUTAGE ONE: the live API host was renamed in the client. Renaming it here does not rename the ' +
    'server — it points every login, pull and note at a hostname that returns 404. Rename the Render ' +
    'service (or attach a custom domain) FIRST, confirm it answers, and only then change this string.');
  assert(read('app.html').indexOf(HOST) >= 0, 'the store app points at the same live host');
  assert(read('mobile/app.config.json').indexOf(HOST) >= 0, 'and so does the native build config');
}

console.log('PASS one product name: swept ' + (shipped.length + NATIVE.length) + ' shipped + native surfaces ' +
  'from the reviewed publication inventory (not a hand-list) — the old name is readable on none of them; ' +
  'the guide headline, both Home Screen labels and the native identity carry "MLS Scribe"; the two apps ' +
  'still install under DIFFERENT labels; the bundle id moved in all five places that must agree AND its ' +
  'Java package directory moved with it; the storage keys moved WITH a migration that only adopts into ' +
  'an empty key and clears the old one; the gradle marker moved together with the script that greps for ' +
  'it; and the ONE surviving form — the live API host, which answers 200 and cannot be renamed from the ' +
  'client — is asserted PRESENT, so "finish the job" cannot pass this suite as a fix.');
