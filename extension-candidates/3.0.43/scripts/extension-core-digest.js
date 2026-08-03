'use strict';
/* Deterministic MLS Assist extension CORE digest.
 *
 * The core digest is the SHA-256 over the 19 NON-manifest release files, in
 * release order, hashing `name + NUL + bytes + NUL` for each file. The
 * manifest is excluded because the digest itself is published inside
 * manifest.version_name ("<version>+core-sha256:<digest>"), which the live
 * mlsPong/mlsExtVersion ping exposes and the PHI-free acceptance collector
 * verifies against the expected build.
 *
 * Usage:
 *   node scripts/extension-core-digest.js            -> print digest
 *   node scripts/extension-core-digest.js --verify   -> compare against manifest.version_name (exit 1 on mismatch)
 *   node scripts/extension-core-digest.js --stamp    -> rewrite manifest.version_name with the current digest
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CORE_FILES = [
  'background.js',
  'destination_teach_navigation_guard.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'mls-popup.js',
  'mls-popup.css',
  'offscreen.html',
  'offscreen.js',
  'feat_codes_driver.js',
  'ext_reviews_reader.js',
  'write_safety_guard.js',
  'review_screen.js',
  'teach_destination_memory.js',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png'
];

function coreDigest() {
  const hash = crypto.createHash('sha256');
  for (const name of CORE_FILES) {
    hash.update(name, 'utf8');
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(path.join(ROOT, name)));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

const digest = coreDigest();
const manifestPath = path.join(ROOT, 'manifest.json');
const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestRaw);
const expectedName = manifest.version + '+core-sha256:' + digest;

const mode = process.argv[2] || '';
if (mode === '--stamp') {
  if (manifest.version_name === expectedName) {
    console.log('version_name already exact:', expectedName);
  } else {
    const stamped = manifestRaw.replace(/"version":\s*"([^"]+)",/,
      (all, version) => `"version": "${version}",\n  "version_name": "${version}+core-sha256:${digest}",`);
    const reparsed = JSON.parse(stamped.replace(/"version_name":\s*"[^"]*",\s*\n\s*"version_name":/, '"version_name":'));
    if (manifest.version_name) throw new Error('manifest already carries a version_name; remove it first for a clean stamp');
    if (reparsed.version_name !== expectedName) throw new Error('stamp verification failed');
    fs.writeFileSync(manifestPath, stamped);
    console.log('stamped version_name:', expectedName);
  }
} else if (mode === '--verify') {
  if (manifest.version_name !== expectedName) {
    console.error('MISMATCH');
    console.error('  manifest.version_name:', manifest.version_name || '(absent)');
    console.error('  computed             :', expectedName);
    process.exit(1);
  }
  console.log('OK', expectedName);
} else {
  console.log(digest);
}
