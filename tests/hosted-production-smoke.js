'use strict';

/*
 * Read-only smoke check for the public production ScribeFlow route.
 *
 * This intentionally does not sign in, create synthetic records, click
 * clinician actions, or call a mutating endpoint.  It is safe to run against
 * production and treats signed-out gating of clinician-only surfaces as an
 * expected boundary rather than a failure.
 *
 * Usage:
 *   node tests/hosted-production-smoke.js
 *   node tests/hosted-production-smoke.js --url=https://mlsscribe.com/ScribeFlow.html
 *   node tests/hosted-production-smoke.js --timeout=45000
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_URL = 'https://mlsscribe.com/ScribeFlow.html';

function parseArgs(argv) {
  const out = { url: process.env.MLS_HOSTED_URL || DEFAULT_URL, timeout: 30000, artifacts: '' };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) out.url = arg.slice(6);
    else if (arg.startsWith('--timeout=')) out.timeout = Number(arg.slice(10));
    else if (arg.startsWith('--artifacts=')) out.artifacts = arg.slice(12);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!/^https:\/\//i.test(out.url)) throw new Error('--url must use https://');
  if (!Number.isInteger(out.timeout) || out.timeout < 5000 || out.timeout > 120000) {
    throw new Error('--timeout must be an integer from 5000 through 120000');
  }
  return out;
}

function usage() {
  return 'Usage: node tests/hosted-production-smoke.js [--url=https://...] [--timeout=MS] [--artifacts=PATH]';
}

function parseBuild(text) {
  const match = String(text).match(/window\.__MLS_AV\s*=\s*['"]([A-Za-z0-9._-]+)/);
  return match ? match[1] : '';
}

function visible(el) {
  if (!el) return false;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return process.stdout.write(`${usage()}\n`);
  let playwright;
  try { playwright = require('playwright'); }
  catch (_) {
    throw new Error('Playwright is not installed. Run npm install before running the hosted smoke check.');
  }

  const target = new URL(options.url);
  /* A routine smoke run must leave the checkout clean. Persist a report only
     when the caller explicitly asks for --artifacts=PATH. */
  const artifactDir = options.artifacts ? path.resolve(ROOT, options.artifacts) : '';
  if (artifactDir) fs.mkdirSync(artifactDir, { recursive: true });
  const report = { status: 'FAIL', generatedAt: new Date().toISOString(), url: target.href, readOnly: true, policyBoundary: {} };
  let browser;
  try {
    const routeResponse = await fetch(target.href, { redirect: 'follow', signal: AbortSignal.timeout(options.timeout) });
    report.route = { status: routeResponse.status, finalUrl: routeResponse.url, contentType: routeResponse.headers.get('content-type') || '' };
    assert(routeResponse.ok, `hosted route returned HTTP ${routeResponse.status}`);
    const routeFinal = new URL(routeResponse.url);
    assert.strictEqual(routeFinal.origin, target.origin, `hosted route redirected to another origin: ${routeFinal.origin}`);
    assert.strictEqual(routeFinal.pathname, '/ScribeFlow.html', `hosted route redirected to unexpected path: ${routeFinal.pathname}`);
    const shell = await routeResponse.text();
    report.shellBytes = Buffer.byteLength(shell);
    report.build = parseBuild(shell);
    assert(report.shellBytes > 100000, `hosted shell is unexpectedly small (${report.shellBytes} bytes)`);
    assert(report.build, 'hosted shell did not publish its build token');

    const manifestUrl = new URL('/app-version.json', target).href;
    const manifestResponse = await fetch(manifestUrl, { redirect: 'follow', signal: AbortSignal.timeout(options.timeout) });
    assert(manifestResponse.ok, `build manifest returned HTTP ${manifestResponse.status}`);
    const manifestFinal = new URL(manifestResponse.url);
    assert.strictEqual(manifestFinal.origin, target.origin, `build manifest redirected to another origin: ${manifestFinal.origin}`);
    assert.strictEqual(manifestFinal.pathname, '/app-version.json', `build manifest redirected to unexpected path: ${manifestFinal.pathname}`);
    const manifest = await manifestResponse.json();
    report.manifest = { status: manifestResponse.status, url: manifestResponse.url, build: String(manifest.build || '') };
    assert(report.manifest.build, 'build manifest did not contain a build token');

    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const unsafeRequests = [];
    const externalRequests = [];
    await context.route('**/*', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        unsafeRequests.push({ method: request.method(), url: request.url() });
        return route.abort('blockedbyclient');
      }
      if (requestUrl.origin !== target.origin) externalRequests.push(request.url());
      return route.continue();
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const started = Date.now();
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: options.timeout });
    report.boot = { domContentLoadedMs: Date.now() - started, status: response ? response.status() : null };
    assert(response && response.ok(), `browser navigation did not return an OK response (${report.boot.status})`);
    await page.waitForFunction(() => document.readyState === 'complete' && !!document.body, { timeout: options.timeout });
    await page.waitForTimeout(500);
    const browserLocation = await page.evaluate(() => ({ origin: location.origin, pathname: location.pathname, href: location.href }));
    assert.strictEqual(browserLocation.origin, target.origin, `browser landed on another origin: ${browserLocation.origin}`);
    assert.strictEqual(browserLocation.pathname, '/ScribeFlow.html', `browser landed on unexpected path: ${browserLocation.pathname}`);
    report.boot.location = browserLocation;
    report.boot.completeMs = Date.now() - started;
    report.boot.bodyTextBytes = await page.locator('body').innerText().then((text) => text.length);
    assert(report.boot.bodyTextBytes > 20, 'hosted page booted with no meaningful body text');

    report.ui = await page.evaluate(({ build, manifestBuild }) => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
      };
      const text = document.body ? document.body.innerText : '';
      const lower = text.toLowerCase();
      const count = (selector) => document.querySelectorAll(selector).length;
      const visibleCount = (selector) => [...document.querySelectorAll(selector)].filter(isVisible).length;
      const hasAny = (terms) => terms.some((term) => lower.includes(term));
      const signedOut = /sign\s*in|log\s*in|create\s*an\s*account|welcome to mls/i.test(text);
      return {
        signedOutOrGated: signedOut,
        routeIdentity: location.pathname,
        buildInShell: build,
        buildInManifest: manifestBuild,
        primaryRouteAvailable: location.pathname.toLowerCase().endsWith('/scribeflow.html') || location.pathname === '/',
        study: {
          panelCount: count('#anaStudyBox'),
          visiblePanelCount: visibleCount('#anaStudyBox'),
          headingPresent: hasAny(['data study', 'practice data study']),
          visible: visibleCount('#anaStudyBox') > 0
        },
        procedure: {
          controlCount: count('#ptgb_procedure, #procType, #procNoteBody, [id*="procedure" i]'),
          visibleControlCount: visibleCount('#ptgb_procedure, #procType, #procNoteBody, [id*="procedure" i]'),
          textPresent: hasAny(['procedure', 'injection procedure note'])
        },
        build: {
          controlCount: count('#studioGenBtn, #studioPrompt, [id*="build" i]'),
          visibleControlCount: visibleCount('#studioGenBtn, #studioPrompt, [id*="build" i]'),
          textPresent: hasAny(['build a custom tool', 'build it', 'ai studio'])
        },
        duplicateStudyPanels: count('#anaStudyBox') > 1 || count('#anaStudyCard') > 1,
        bodyHasLoginGate: signedOut
      };
    }, { build: report.build, manifestBuild: report.manifest.build });
    assert(report.ui.primaryRouteAvailable, `unexpected final route: ${report.ui.routeIdentity}`);
    assert.strictEqual(report.ui.duplicateStudyPanels, false, 'duplicate Study panels detected');
    assert.strictEqual(report.ui.signedOutOrGated, true, 'fresh production context bypassed the signed-out boundary');
    const buildMatchesManifest = report.build === report.manifest.build || report.manifest.build.endsWith(`-${report.build}`);
    assert(buildMatchesManifest, `shell build ${report.build} does not match manifest ${report.manifest.build}`);
    assert.deepStrictEqual(unsafeRequests, [], `state-changing hosted requests were attempted: ${JSON.stringify(unsafeRequests)}`);
    assert.deepStrictEqual(externalRequests, [], `hosted shell contacted an unexpected third-party origin: ${JSON.stringify(externalRequests)}`);
    assert.deepStrictEqual(consoleErrors, [], `hosted shell logged browser errors: ${JSON.stringify(consoleErrors)}`);
    report.network = { unsafeRequests, externalRequestCount: externalRequests.length, externalRequests: externalRequests.slice(0, 20) };
    report.consoleErrors = consoleErrors.slice(0, 20);
    report.policyBoundary = {
      signedOutOrGated: report.ui.signedOutOrGated,
      study: report.ui.study.visible ? 'visible' : 'gated-or-not-rendered-in-public-context',
      procedure: report.ui.procedure.visibleControlCount ? 'visible' : 'gated-or-not-rendered-in-public-context',
      build: report.ui.build.visibleControlCount ? 'visible' : 'gated-or-not-rendered-in-public-context'
    };
    report.status = 'PASS';
    if (artifactDir) fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`PASS hosted production smoke: ${target.href}\nBuild: ${report.manifest.build}${artifactDir ? `\nArtifacts: ${artifactDir}` : ''}\n`);
  } catch (error) {
    report.error = error.stack || String(error);
    if (artifactDir) {
      try { fs.writeFileSync(path.join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); } catch (_) {}
      error.message += `\nArtifacts: ${artifactDir}`;
    }
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
