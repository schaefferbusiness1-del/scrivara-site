/* restamp-3055 - run RIGHT BEFORE the re-gate once main is green.
 * background.js changed after the first 3.0.55 stamp (fb-1.1/1.2), so the
 * digest, zip, bin, and every published sha constant are stale. This script:
 *   1. strips the stale version_name from manifest.json (the stamper refuses
 *      otherwise), re-stamps, verifies;
 *   2. rebuilds MLS_Assist_v3.0.55.zip, mirrors .bin, computes the sha;
 *   3. substitutes the OLD zip sha (read from _config.yml, the single source)
 *      with the NEW one across the 5 published/pinned files, exact counts.
 * PLAIN: counts asserted, all-or-nothing on the sweep. */
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');

let man = fs.readFileSync('manifest.json', 'latin1');
const vn = man.split('\n').filter(l => l.startsWith('  "version_name"'));
if (vn.length > 1) { console.error('manifest has ' + vn.length + ' version_name lines'); process.exit(1); }
if (vn.length === 1) {
  man = man.split('\n').filter(l => !l.startsWith('  "version_name"')).join('\n');
  fs.writeFileSync('manifest.json', man, 'latin1');
  console.log('stale version_name removed');
}
cp.execSync('node scripts/extension-core-digest.js --stamp', { stdio: 'inherit' });
cp.execSync('node scripts/extension-core-digest.js --verify', { stdio: 'inherit' });
cp.execSync('node scripts/build-extension-zip.js', { stdio: 'inherit' });
const zipBytes = fs.readFileSync('MLS_Assist_v3.0.55.zip');
fs.writeFileSync('MLS_Assist_v3.0.55.bin', zipBytes);
const NEW_SHA = crypto.createHash('sha256').update(zipBytes).digest('hex');

const cfg = fs.readFileSync('_config.yml', 'latin1');
const shaM = cfg.match(/[a-f0-9]{64}/);
if (!shaM) { console.error('no old sha in _config.yml'); process.exit(1); }
const OLD_SHA = shaM[0];
if (OLD_SHA === NEW_SHA) { console.log('sha unchanged (' + NEW_SHA.slice(0, 12) + ') - nothing to sweep'); process.exit(0); }

const plan = [
  ['get-extension.html', 1],
  ['_config.yml', 1],
  ['tests/extension-package.test.js', 1],
  ['tests/public-publication-boundary.test.js', 2],
  ['tests/public-release-truth-boundary.test.js', 1],
];
const staged = [];
for (const [rel, want] of plan) {
  let t = fs.readFileSync(rel, 'latin1');
  const n = t.split(OLD_SHA).length - 1;
  if (n !== want) { console.error('MISS ' + rel + ' expected ' + want + ' got ' + n); process.exit(1); }
  staged.push([rel, t.split(OLD_SHA).join(NEW_SHA)]);
}
for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');
console.log('RESTAMP OK: ' + OLD_SHA.slice(0, 12) + ' -> ' + NEW_SHA.slice(0, 12) + ' across ' + staged.length + ' files');
