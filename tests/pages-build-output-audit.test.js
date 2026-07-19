'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  auditBuiltSite,
  expectedPublicSourceFiles,
} = require('../scripts/audit-pages-build.js');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-pages-output-audit-'));

function assertWorkflowIsNonDeployingPagesAudit() {
  const workflowPath = path.join(root, '.github', 'workflows', 'pages-publication-audit.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const lines = workflow.split(/\r?\n/);
  const onIndex = lines.findIndex((line) => /^on:\s*$/.test(line));
  assert(onIndex >= 0, 'Pages audit workflow must have a block-style on section');

  const triggerNames = [];
  for (const line of lines.slice(onIndex + 1)) {
    if (/^[^\s#]/.test(line)) break;
    const trigger = line.match(/^ {2}([A-Za-z0-9_-]+):(?:\s|$)/);
    if (trigger) triggerNames.push(trigger[1]);
  }
  assert.deepStrictEqual(
    triggerNames.sort(),
    ['pull_request', 'workflow_dispatch'],
    'Pages audit workflow must run only for pull requests and manual dispatches',
  );

  const permissionIndex = lines.findIndex((line) => /^permissions:\s*$/.test(line));
  assert(permissionIndex >= 0, 'Pages audit workflow must declare exact read-only permissions');
  const permissionLines = [];
  for (const line of lines.slice(permissionIndex + 1)) {
    if (/^[^\s#]/.test(line)) break;
    const permission = line.match(/^ {2}([A-Za-z0-9_-]+):\s*([^#\s]+)\s*$/);
    if (permission) permissionLines.push(`${permission[1]}: ${permission[2]}`);
  }
  assert.deepStrictEqual(permissionLines, ['contents: read', 'pages: read'], 'Pages audit workflow permissions must remain exactly read-only');
  assert.doesNotMatch(workflow, /^\s*(?:environment|secrets?)\s*:/mi, 'Pages audit workflow must not bind a deployment environment or secrets');
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./i, 'Pages audit workflow must not consume secrets');
  assert.doesNotMatch(workflow, /^\s*[A-Za-z0-9_-]+:\s*write\s*$/mi, 'Pages audit workflow must not request a write permission');

  const expectedStepCommands = [
    'uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10',
    'uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'run: npm ci',
    'run: npm test',
    'uses: actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b',
    'uses: actions/jekyll-build-pages@44a6e6beabd48582f863aeeb6cb2151cc1716697',
    'run: node scripts/audit-pages-build.js --site-dir=_site',
  ];
  const actualStepCommands = lines
    .map((line) => line.trim().replace(/\s+#.*$/, ''))
    .filter((line) => /^(?:uses|run):\s*/.test(line));
  assert.deepStrictEqual(actualStepCommands, expectedStepCommands, 'Pages audit workflow steps must remain the exact ordered non-deploying allowlist');
  assert.match(workflow, /^\s*enablement:\s*false\s*$/m, 'configure-pages must never try to enable or mutate Pages');
  assert.match(workflow, /^\s*uses:\s*actions\/jekyll-build-pages@44a6e6beabd48582f863aeeb6cb2151cc1716697\s+# v1\s*$/m, 'Pages audit workflow must run the immutable GitHub Pages Jekyll action');
  assert.match(workflow, /^\s*run:\s*node scripts\/audit-pages-build\.js --site-dir=_site\s*$/m, 'Pages audit workflow must inspect the generated _site tree');
  assert.doesNotMatch(workflow, /^\s*uses:\s*\S*(?:upload|deploy)\S*\s*$/mi, 'Pages audit workflow must not use an upload or deployment action');
  assert(!triggerNames.includes('push'), 'Pages audit workflow must not have a push trigger');
}

function copyReviewedTree(fromRoot, toRoot) {
  for (const rel of expectedPublicSourceFiles(root)) {
    const source = path.join(fromRoot, ...rel.split('/'));
    const target = path.join(toRoot, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

try {
  assertWorkflowIsNonDeployingPagesAudit();

  const sourceRoot = path.join(tempRoot, 'source');
  const siteDir = path.join(tempRoot, '_site');
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(siteDir);
  copyReviewedTree(root, sourceRoot);
  copyReviewedTree(sourceRoot, siteDir);

  let report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, true, report.failures.join('\n'));
  assert(report.actual.length > 250, 'fixture must audit the complete production asset graph');

  const fixtureLeak = path.join(siteDir, 'api', 'agreements', 'signup-manifest');
  fs.mkdirSync(path.dirname(fixtureLeak), { recursive: true });
  fs.writeFileSync(fixtureLeak, '{"syntheticTestFixture":true}');
  report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, false);
  assert(report.failures.some((failure) => /unexpected.*api\/agreements\/signup-manifest/i.test(failure)), 'published API fixture was not rejected');
  fs.rmSync(path.join(siteDir, 'api'), { recursive: true, force: true });

  const stagingLeak = path.join(siteDir, 'feat_mls_staging_exact_actions.js');
  fs.writeFileSync(stagingLeak, '/* synthetic staging leak */');
  report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, false);
  assert(report.failures.some((failure) => /unexpected.*staging/i.test(failure)), 'published staging JavaScript was not rejected');
  fs.unlinkSync(stagingLeak);

  const indexPath = path.join(siteDir, 'index.html');
  const originalIndex = fs.readFileSync(indexPath);
  fs.appendFileSync(indexPath, '\n<!-- unexpected transform -->\n');
  report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, false);
  assert(report.failures.some((failure) => /built bytes differ.*index\.html/i.test(failure)), 'changed built bytes were not rejected');
  fs.writeFileSync(indexPath, originalIndex);

  const termsPath = path.join(siteDir, 'terms.html');
  fs.unlinkSync(termsPath);
  report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, false);
  assert(report.failures.some((failure) => /missing.*terms\.html/i.test(failure)), 'missing reviewed page was not rejected');
  fs.copyFileSync(path.join(sourceRoot, 'terms.html'), termsPath);

  const arbitrarySourceAndOutputFiles = [
    ['unreviewed-runtime.js', '/* should never become public by file extension */'],
    ['unreviewed-document.pdf', '%PDF-1.4 synthetic unreviewed document'],
    ['unreviewed-image.png', 'synthetic unreviewed image'],
    ['fonts/unreviewed-font.woff2', 'synthetic unreviewed font'],
    ['nested/index.html', '<!doctype html><title>Unreviewed nested page</title>'],
  ];
  for (const [rel, contents] of arbitrarySourceAndOutputFiles) {
    const source = path.join(sourceRoot, ...rel.split('/'));
    const output = path.join(siteDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(source, contents);
    fs.writeFileSync(output, contents);

    assert(!expectedPublicSourceFiles(sourceRoot).includes(rel), `${rel} was implicitly added to the reviewed inventory`);
    report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
    assert.strictEqual(report.ok, false, `${rel} was accepted without an inventory review`);
    assert(
      report.failures.some((failure) => failure.includes(`unexpected/unreviewed generated file: ${rel}`)),
      `${rel} was not rejected as an unexpected generated file`,
    );

    fs.unlinkSync(source);
    fs.unlinkSync(output);
  }

  const sourceTermsPath = path.join(sourceRoot, 'terms.html');
  const originalSourceTerms = fs.readFileSync(sourceTermsPath);
  fs.unlinkSync(sourceTermsPath);
  report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, false);
  assert(report.failures.some((failure) => /missing reviewed source file: terms\.html/i.test(failure)), 'missing reviewed source file was not rejected');
  fs.writeFileSync(sourceTermsPath, originalSourceTerms);

  const sourcePrivacyPath = path.join(sourceRoot, 'privacy.html');
  const originalSourcePrivacy = fs.readFileSync(sourcePrivacyPath);
  fs.unlinkSync(sourcePrivacyPath);
  fs.mkdirSync(sourcePrivacyPath);
  report = auditBuiltSite({ rootDir: sourceRoot, siteDir });
  assert.strictEqual(report.ok, false);
  assert(report.failures.some((failure) => /not a regular file: privacy\.html/i.test(failure)), 'non-regular reviewed source path was not rejected');
  fs.rmdirSync(sourcePrivacyPath);
  fs.writeFileSync(sourcePrivacyPath, originalSourcePrivacy);

  console.log(`PASS Pages build-output audit: ${expectedPublicSourceFiles(root).length} exact inventory files plus fixture/staging/mutation/missing/non-regular/arbitrary-asset adversarial cases`);
} finally {
  const allowedRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(tempRoot);
  assert(resolved.startsWith(allowedRoot + path.sep) && path.basename(resolved).startsWith('mls-pages-output-audit-'), 'refusing to remove unexpected test path');
  fs.rmSync(resolved, { recursive: true, force: true });
}
