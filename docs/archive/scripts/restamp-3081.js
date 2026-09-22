/* restamp-3081 — gate-forced identity restamp after a background.js splice.
 * Adapted from restamp-3055 for the 3.0.81 package and today's pin layout:
 *   1. strip stale version_name, re-stamp + verify the core digest;
 *   2. rebuild MLS_Assist_v3.0.81.zip deterministically, mirror .bin;
 *   3. sweep the OLD package sha (read from _config.yml) to the NEW one across
 *      the 6 published/pinned files, exact counts, all-or-nothing. */
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
const zipBytes = fs.readFileSync('MLS_Assist_v3.0.81.zip');
fs.writeFileSync('MLS_Assist_v3.0.81.bin', zipBytes);
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
  ['tests/public-publication-boundary.test.js', 1],
  ['tests/public-release-truth-boundary.test.js', 1],
  ['tests/1p-preview-contract.test.js', 1],
];
const staged = [];
for (const [rel, want] of plan) {
  let t = fs.readFileSync(rel, 'latin1');
  const n = t.split(OLD_SHA).length - 1;
  if (n !== want) { console.error('MISS ' + rel + ' expected ' + want + ' got ' + n); process.exit(1); }
  staged.push([rel, t.split(OLD_SHA).join(NEW_SHA)]);
}
for (const [rel, t] of staged) fs.writeFileSync(rel, t, 'latin1');
const core = fs.readFileSync('manifest.json', 'latin1').match(/"version_name":\s*"([a-f0-9]{64})"/);
console.log('RESTAMP OK: package ' + OLD_SHA.slice(0, 12) + ' -> ' + NEW_SHA.slice(0, 12) + ' across ' + staged.length + ' files');
console.log('core sha256: ' + (core ? core[1] : 'UNKNOWN'));
console.log('package sha256: ' + NEW_SHA);
