'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_FILES = [
  'manifest.json',
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

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertSameList(actual, expected, label) {
  assert.deepStrictEqual(actual, expected, `${label} must contain the audited ${expected.length}-file allowlist in release order`);
}

function findPython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
  if (process.platform === 'win32') {
    candidates.push([
      path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe'),
      []
    ]);
  }
  candidates.push(['python3', []], ['python', []]);
  if (process.platform === 'win32') candidates.push(['py', ['-3']]);

  for (const [command, prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '--version'], { encoding: 'utf8', windowsHide: true });
    if (probe.status === 0) return { command, prefix };
  }
  throw new Error('Python 3 is required to build the deterministic extension ZIP');
}

function runBuilder(python, output) {
  const script = path.join(ROOT, 'scripts', 'build_extension_zip.py');
  const result = spawnSync(
    python.command,
    [...python.prefix, script, '--output', output],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true }
  );
  assert.strictEqual(result.status, 0, `extension ZIP builder failed:\n${result.stdout || ''}${result.stderr || ''}`);
  assert(fs.existsSync(output) && fs.statSync(output).isFile(), `builder did not create ${output}`);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xFFFF);
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054B50) return offset;
  }
  throw new Error('ZIP end-of-central-directory record was not found');
}

function parseZip(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  assert.strictEqual(buffer.readUInt16LE(eocd + 4), 0, 'multi-disk ZIPs are forbidden');
  assert.strictEqual(buffer.readUInt16LE(eocd + 6), 0, 'multi-disk ZIPs are forbidden');
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  assert.strictEqual(diskEntries, totalEntries, 'all ZIP entries must be on one disk');
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  assert.strictEqual(commentLength, 0, 'release ZIP must not contain an archive comment');
  assert.strictEqual(eocd + 22, buffer.length, 'release ZIP must not have trailing bytes');

  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index++) {
    assert.strictEqual(buffer.readUInt32LE(cursor), 0x02014B50, `invalid central directory entry ${index}`);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const modifiedTime = buffer.readUInt16LE(cursor + 12);
    const modifiedDate = buffer.readUInt16LE(cursor + 14);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    assert.strictEqual(flags & 1, 0, `${name} must not be encrypted`);
    assert.strictEqual(modifiedTime, 0, `${name} must use the fixed midnight timestamp`);
    assert.strictEqual(modifiedDate, 33, `${name} must use the fixed 1980-01-01 date`);
    assert.strictEqual(extraLength, 0, `${name} must not contain ZIP extra fields`);
    assert.strictEqual(entryCommentLength, 0, `${name} must not contain an entry comment`);
    assert.strictEqual(buffer.readUInt32LE(localOffset), 0x04034B50, `${name} has an invalid local header`);

    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localTime = buffer.readUInt16LE(localOffset + 10);
    const localDate = buffer.readUInt16LE(localOffset + 12);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localName = buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8');
    assert.strictEqual(localFlags, flags, `${name} local flags differ from the central directory`);
    assert.strictEqual(localMethod, method, `${name} local compression differs from the central directory`);
    assert.strictEqual(localTime, modifiedTime, `${name} local timestamp differs from the central directory`);
    assert.strictEqual(localDate, modifiedDate, `${name} local date differs from the central directory`);
    assert.strictEqual(localExtraLength, 0, `${name} local header must not contain extra fields`);
    assert.strictEqual(localName, name, `${name} local filename differs from the central directory`);

    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`${name} uses unsupported ZIP compression method ${method}`);
    assert.strictEqual(data.length, uncompressedSize, `${name} has the wrong uncompressed size`);
    assert.strictEqual(crc32(data), expectedCrc, `${name} failed CRC validation`);
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + entryCommentLength;
  }
  assert.strictEqual(cursor, centralOffset + centralSize, 'central directory size is inconsistent');
  return entries;
}

const crypto = require('crypto');

const manifest = readJson('manifest.json');
const published = readJson('extension-version.json');

/* The digest-bearing version_name must always equal the freshly recomputed
   deterministic core digest (SHA-256 over the 19 non-manifest release files
   in release order, name+NUL+bytes+NUL each). The live mlsPong buildId
   exposes this exact string, so a stale or hand-edited stamp is a release
   blocker, not a cosmetic drift. */
{
  const coreHash = crypto.createHash('sha256');
  for (const name of EXPECTED_FILES.filter(name => name !== 'manifest.json')) {
    coreHash.update(name, 'utf8');
    coreHash.update(Buffer.from([0]));
    coreHash.update(fs.readFileSync(path.join(ROOT, name)));
    coreHash.update(Buffer.from([0]));
  }
  const expectedVersionName = `${manifest.version}+core-sha256:${coreHash.digest('hex')}`;
  assert.strictEqual(manifest.version_name, expectedVersionName,
    'manifest.version_name must carry the exact current deterministic core digest (rerun scripts/extension-core-digest.js --stamp after removing the stale value)');
}
const checker = read('feat_mls_checker.js');
const checkerMatch = checker.match(/SERVER_EXT_VERSION\s*=\s*['"]([^'"]+)['"]/);
assert(checkerMatch, 'feat_mls_checker.js must declare SERVER_EXT_VERSION');
function compareVersions(a, b) {
  const left = String(a || '').split('.').map(Number), right = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] || 0) - (right[i] || 0); if (delta) return delta < 0 ? -1 : 1;
  }
  return 0;
}
assert(compareVersions(manifest.version, published.version) >= 0, 'isolated candidate must not be older than the published stable channel');
assert.strictEqual(checkerMatch[1], published.version, 'website checker must describe the published stable channel, not an isolated candidate');
assert(/^\d+(?:\.\d+){0,3}$/.test(manifest.version), 'manifest version is not Chrome-compatible');
assert(/r\.data\s*&&\s*r\.data\.version/.test(checker), 'checker must read the installed version carried by mlsPong');
assert(/compareVersions\(installed,\s*SERVER_EXT_VERSION\)/.test(checker), 'checker must compare installed and published extension versions');
assert(!/cannot read the installed extension version/i.test(checker), 'checker must not claim the installed version is inherently unreadable');

const downloadPage = read('get-extension.html');
assert(!/\bJSZip\b|cdnjs\.cloudflare\.com\/ajax\/libs\/jszip/i.test(downloadPage),
  'get-extension.html must not build a candidate from loose public source or a CDN ZIP library');
assert(!/var\s+FILES\s*=|fetch\(\s*['"]\/manifest\.json/i.test(downloadPage),
  'get-extension.html must not fetch candidate manifests or expose a loose-source package allowlist');
assert(/id=["']dl["'][^>]*href=["']MLS_Assist_v3.0.55.zip["']/i.test(downloadPage) && !/candidate package withheld/i.test(downloadPage),
  'manual download must offer exactly the stamped released package (owner directive 2026-07-20)');
assert(/e8f963d422cb172ac17cbe66aa7685b0dfb7da78c054d6751446f039b7b6ee24/.test(downloadPage),
  'download page must display the released package digest for verification');
assert(/extension-version\.json/.test(downloadPage), 'download page may display only the published-channel feed version');
assert(/chromewebstore\.google\.com\/detail\/mls-assist\/mpeidpagiccfdehcgfanlkibpafhogfg/.test(downloadPage),
  'download page must retain the known published Chrome Web Store channel');
/* b727: the b368 Mac-readiness copy was deleted at b430 with no pin, and the
 * Web Store drifted 19 versions behind the ZIP with the store as the
 * recommended path. The ZIP leads; the install steps and Mac wording are
 * load-bearing and may not be dropped by the next page rewrite. */
assert(/Load unpacked/i.test(downloadPage) && /Developer mode/i.test(downloadPage) && /manifest\.json/.test(downloadPage),
  'the load-unpacked install steps are gone again (b430 class)');
assert(/Remove any older MLS Assist first/i.test(downloadPage) && /keep exactly ONE/i.test(downloadPage),
  'the remove-the-old-copy step is gone - the duplicate-extension failure returns');
assert(/System Settings/.test(downloadPage) && /Microphone/.test(downloadPage),
  'the macOS microphone wording is gone again (b430 class)');
assert(/store copy can lag this released package/i.test(downloadPage),
  'the store button must state honestly that the store can lag the released ZIP');
const dlIdx = downloadPage.indexOf('id="dl"');
const storeIdx = downloadPage.indexOf('chromewebstore.google.com');
assert(dlIdx > 0 && storeIdx > dlIdx,
  'the exact released ZIP must LEAD the page; the store link follows it');

const builder = read('scripts/build_extension_zip.py');
const builderListMatch = builder.match(/PACKAGE_FILES\s*=\s*\((.*?)\)\s*\n/s);
assert(builderListMatch, 'build_extension_zip.py must declare PACKAGE_FILES');
const builderFiles = Array.from(builderListMatch[1].matchAll(/"([^"]+)"/g), match => match[1]);
assertSameList(builderFiles, EXPECTED_FILES, 'build_extension_zip.py');

assert.strictEqual(new Set(EXPECTED_FILES).size, 20, 'release allowlist must contain 20 unique files'); /* wsg-1.0.0: +write_safety_guard.js, review_screen.js, teach_destination_memory.js */
for (const name of EXPECTED_FILES) {
  assert.strictEqual(path.posix.basename(name), name, `release entry must be at ZIP root: ${name}`);
  assert(!name.includes('\\') && !name.includes('..'), `unsafe release entry: ${name}`);
  const source = path.join(ROOT, name);
  assert(fs.statSync(source).isFile(), `release source is missing or not a file: ${name}`);
  assert(!fs.lstatSync(source).isSymbolicLink(), `release source must not be a symlink: ${name}`);
}

const manifestAssets = [
  manifest.background && manifest.background.service_worker,
  manifest.action && manifest.action.default_popup,
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
  ...(manifest.content_scripts || []).flatMap(script => [...(script.js || []), ...(script.css || [])])
].filter(Boolean);
for (const asset of new Set(manifestAssets)) {
  assert(EXPECTED_FILES.includes(asset), `manifest asset is outside the release allowlist: ${asset}`);
  const assetPath = path.join(ROOT, asset);
  assert(fs.existsSync(assetPath) && fs.statSync(assetPath).isFile(), `manifest asset is missing: ${asset}`);
}
assert(EXPECTED_FILES.includes('offscreen.html') && /['"]offscreen\.html['"]/.test(read('background.js')),
  'offscreen document must be packaged and referenced by background.js');
assert(EXPECTED_FILES.includes('feat_codes_driver.js') && /importScripts\(['"]feat_codes_driver\.js['"]\)/.test(read('background.js')),
  'background importScripts dependency must be packaged');
assert(EXPECTED_FILES.includes('destination_teach_navigation_guard.js') && /destination_teach_navigation_guard\.js/.test(read('background.js')),
  'document-start teaching navigation guard must be packaged and registered');
for (const [html, script] of [['popup.html', 'popup.js'], ['offscreen.html', 'offscreen.js']]) {
  assert(new RegExp(`<script\\s+src=["']${script.replace('.', '\\.')}`).test(read(html)), `${html} must reference ${script}`);
  assert(EXPECTED_FILES.includes(script), `${script} must be packaged`);
}

for (const name of EXPECTED_FILES.filter(name => name.endsWith('.js'))) {
  const syntax = spawnSync(process.execPath, ['--check', path.join(ROOT, name)], { encoding: 'utf8' });
  assert.strictEqual(syntax.status, 0, `${name} failed JavaScript syntax validation:\n${syntax.stderr || syntax.stdout}`);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-extension-package-'));
try {
  const python = findPython();
  const expectedName = `MLS_Assist_v${manifest.version}.zip`;
  const firstPath = path.join(temporary, 'first', expectedName);
  const secondPath = path.join(temporary, 'second', expectedName);
  runBuilder(python, firstPath);
  runBuilder(python, secondPath);
  const firstZip = fs.readFileSync(firstPath);
  const secondZip = fs.readFileSync(secondPath);
  assert(firstZip.equals(secondZip), 'building identical sources twice must produce byte-identical ZIPs');

  const entries = parseZip(firstZip);
  assertSameList(entries.map(entry => entry.name), EXPECTED_FILES, 'release ZIP');
  for (const entry of entries) {
    assert(!entry.name.includes('/') && !entry.name.includes('\\') && !entry.name.includes('..'),
      `ZIP contains a non-root or unsafe entry: ${entry.name}`);
    const source = fs.readFileSync(path.join(ROOT, entry.name));
    assert(entry.data.equals(source), `ZIP entry differs from its source: ${entry.name}`);
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

/* /api/versions/report regression (live 2026-07-20): the worker's version
 * report is a cross-origin fetch; the backend's CORS allowlist covers web
 * origins and one canonical extension id, NOT arbitrary unpacked ids. The
 * fetch is reliable ONLY because the backend origin is a granted host
 * permission (MV3 host-permitted fetches skip CORS). Dropping this entry
 * silently kills version reporting on every unpacked install. */
{
  const hosts = manifest.host_permissions || [];
  assert(hosts.includes('https://scrivara-backend.onrender.com/*'),
    'manifest must keep the backend host permission — the worker version report relies on the CORS exemption');
  assert.strictEqual(hosts.filter(h => /onrender\.com/.test(h)).length, 1,
    'exactly one narrow backend origin — never a broader onrender grant');
  const bg = read('background.js');
  assert(bg.includes("fetch('https://scrivara-backend.onrender.com/api/versions/report'"),
    'background.js must report the running version to the backend versions endpoint');
}

console.log(`PASS extension package: v${manifest.version}, ${EXPECTED_FILES.length} exact root files, deterministic and byte-verified`);
