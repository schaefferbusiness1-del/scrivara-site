'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INVENTORY_PATH = path.resolve(__dirname, '..', 'pages-publication-inventory.json');

function loadPublicationInventory() {
  const parsed = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.paths)) {
    throw new Error(`invalid Pages publication inventory: ${INVENTORY_PATH}`);
  }
  return Object.freeze(parsed.paths.slice());
}

const PUBLICATION_INVENTORY = loadPublicationInventory();

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function walkFiles(rootDir) {
  const rootStat = fs.lstatSync(rootDir);
  if (rootStat.isSymbolicLink()) throw new Error(`symbolic link is forbidden as publication root: ${rootDir}`);
  if (!rootStat.isDirectory()) throw new Error(`publication root is not a directory: ${rootDir}`);
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic link is forbidden in publication tree: ${absolute}`);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(toPosix(path.relative(rootDir, absolute)));
      else throw new Error(`unsupported publication entry: ${absolute}`);
    }
  }
  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function inventoryEntryFailure(rel) {
  if (typeof rel !== 'string' || !rel) return 'entry is not a non-empty string';
  if (rel.includes('\\')) return 'entry must use forward slashes';
  if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)) return 'absolute paths are forbidden';
  const parts = rel.split('/');
  if (path.posix.normalize(rel) !== rel || parts.some((part) => !part || part === '.' || part === '..')) {
    return 'entry is not a normalized root-relative path';
  }
  return '';
}

function inspectExpectedSources(rootDir) {
  const failures = [];
  const valid = new Set();
  const resolvedRoot = path.resolve(rootDir);
  let realRoot;

  try {
    const rootStat = fs.lstatSync(resolvedRoot);
    if (rootStat.isSymbolicLink()) failures.push(`reviewed source root is a symbolic link: ${resolvedRoot}`);
    else if (!rootStat.isDirectory()) failures.push(`reviewed source root is not a directory: ${resolvedRoot}`);
    else realRoot = fs.realpathSync(resolvedRoot);
  } catch (error) {
    failures.push(`reviewed source root is unavailable: ${resolvedRoot} (${error.message})`);
  }

  const seen = new Set();
  for (const rel of PUBLICATION_INVENTORY) {
    const syntaxFailure = inventoryEntryFailure(rel);
    if (syntaxFailure) {
      failures.push(`invalid reviewed inventory path ${JSON.stringify(rel)}: ${syntaxFailure}`);
      continue;
    }
    if (seen.has(rel)) {
      failures.push(`duplicate reviewed inventory path: ${rel}`);
      continue;
    }
    seen.add(rel);
    if (!realRoot) continue;

    const absolute = path.resolve(resolvedRoot, ...rel.split('/'));
    if (!isInside(resolvedRoot, absolute)) {
      failures.push(`reviewed source path escapes source root: ${rel}`);
      continue;
    }

    let cursor = resolvedRoot;
    let invalid = false;
    const parts = rel.split('/');
    for (let index = 0; index < parts.length; index += 1) {
      cursor = path.join(cursor, parts[index]);
      let stat;
      try {
        stat = fs.lstatSync(cursor);
      } catch (error) {
        failures.push(`missing reviewed source file: ${rel}`);
        invalid = true;
        break;
      }
      if (stat.isSymbolicLink()) {
        failures.push(`symbolic link is forbidden in reviewed source path: ${rel}`);
        invalid = true;
        break;
      }
      const isLeaf = index === parts.length - 1;
      if ((!isLeaf && !stat.isDirectory()) || (isLeaf && !stat.isFile())) {
        failures.push(`reviewed source path is not a regular file: ${rel}`);
        invalid = true;
        break;
      }
    }
    if (invalid) continue;

    const realSource = fs.realpathSync(absolute);
    if (!isInside(realRoot, realSource)) {
      failures.push(`reviewed source path resolves outside source root: ${rel}`);
      continue;
    }
    valid.add(rel);
  }

  return { failures, valid };
}

function expectedPublicSourceFiles() {
  return PUBLICATION_INVENTORY.slice();
}

function auditBuiltSite({ rootDir, siteDir }) {
  const sourceInspection = inspectExpectedSources(rootDir);
  const failures = sourceInspection.failures.slice();
  const expected = expectedPublicSourceFiles(rootDir);
  let actual = [];
  try {
    actual = walkFiles(siteDir);
  } catch (error) {
    failures.push(`generated publication tree is invalid: ${error.message}`);
  }
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  for (const rel of expected) {
    if (!actualSet.has(rel)) failures.push(`missing reviewed public file: ${rel}`);
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel)) failures.push(`unexpected/unreviewed generated file: ${rel}`);
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel) || !sourceInspection.valid.has(rel)) continue;
    const source = path.join(rootDir, ...rel.split('/'));
    const built = path.join(siteDir, ...rel.split('/'));
    const sourceBytes = fs.readFileSync(source);
    const builtBytes = fs.readFileSync(built);
    if (!sourceBytes.equals(builtBytes)) {
      failures.push(`built bytes differ from reviewed source: ${rel} (${sha256(builtBytes)} != ${sha256(sourceBytes)})`);
    }
  }

  return { ok: failures.length === 0, failures, expected, actual };
}

function parseArgs(argv) {
  let siteDir = '_site';
  for (const arg of argv) {
    if (arg.startsWith('--site-dir=')) siteDir = arg.slice('--site-dir='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return siteDir;
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const siteDir = path.resolve(rootDir, parseArgs(process.argv.slice(2)));
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    throw new Error(`built Pages directory is missing: ${siteDir}`);
  }
  const report = auditBuiltSite({ rootDir, siteDir });
  if (!report.ok) {
    console.error(`FAIL Pages publication output (${report.failures.length} issue${report.failures.length === 1 ? '' : 's'})`);
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS Pages publication output: ${report.actual.length} exact reviewed files; no fixtures, staging source, extension package, or archives`);
}

if (require.main === module) main();

module.exports = {
  PUBLICATION_INVENTORY,
  auditBuiltSite,
  expectedPublicSourceFiles,
  inspectExpectedSources,
};
