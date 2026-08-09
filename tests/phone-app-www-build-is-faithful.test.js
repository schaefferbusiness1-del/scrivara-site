'use strict';

/* The store bundle and the published page must be the same app.
 *
 * `mobile/www/index.html` is what Apple and Google review and what ends up on a
 * doctor's phone. `app.html` is what a reviewer reads and what is served at
 * mlsscribe.com/app.html. If those two ever diverge, every other test in this
 * repo is testing a file that is not the one shipped.
 *
 * So this test RUNS the real build script into a temporary directory and
 * compares the output to app.html, byte for byte, with only the stamped
 * values allowed to differ — and each stamped value must actually be the one
 * app.config.json asks for.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile');
const APP = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(MOBILE, 'app.config.json'), 'utf8'));

/* ---------- 0. app.config.json is the single source of identity ---------- */
{
  assert.ok(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(cfg.appId),
    `appId must be a reverse-DNS bundle id, got: ${cfg.appId}`);
  assert.ok(/^\d+\.\d+\.\d+$/.test(cfg.version), `version must be x.y.z, got: ${cfg.version}`);
  assert.ok(Number.isInteger(cfg.androidVersionCode) && cfg.androidVersionCode >= 1,
    'androidVersionCode must be a positive integer — Play refuses an upload that does not increase it');
  assert.ok(/^https:\/\//.test(cfg.apiBase) && !cfg.apiBase.endsWith('/'),
    'apiBase must be a bare https origin with no trailing slash');

  /* The derived Capacitor config must not have been hand-edited apart. */
  const cap = JSON.parse(fs.readFileSync(path.join(MOBILE, 'capacitor.config.json'), 'utf8'));
  assert.strictEqual(cap.appId, cfg.appId, 'capacitor.config.json appId drifted from app.config.json');
  assert.strictEqual(cap.appName, cfg.displayName, 'capacitor.config.json appName drifted');
  assert.strictEqual(cap.webDir, 'www', 'webDir must stay www');

  /* These two schemes ARE the app's CORS identity. The backend allowlist
     (scrivara-backend CANONICAL_NATIVE_APP_ORIGINS) admits exactly
     capacitor://localhost and https://localhost; changing either scheme here
     without changing that list breaks every request from the shipped app. */
  assert.strictEqual(cap.server.iosScheme, 'capacitor',
    'iosScheme must stay "capacitor" — the backend CORS allowlist admits capacitor://localhost');
  assert.strictEqual(cap.server.androidScheme, 'https',
    'androidScheme must stay "https" — the backend CORS allowlist admits https://localhost');
  assert.strictEqual(cap.server.cleartext, false, 'cleartext must stay off for a PHI app');
  assert.strictEqual(cap.android.allowMixedContent, false, 'mixed content must stay off for a PHI app');
}

/* ---------- 1. run the real build and diff it against app.html ----------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlsscribe-www-'));
let built;
try {
  /* Build in place (the script owns mobile/www) then read the result. The
     script is deterministic, so this is safe to run in a test. */
  execFileSync(process.execPath, [path.join(MOBILE, 'scripts', 'build-www.mjs')], {
    cwd: ROOT, stdio: 'pipe',
  });
  built = fs.readFileSync(path.join(MOBILE, 'www', 'index.html'), 'utf8');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* Reverse the stamps and require the result to be app.html EXACTLY. Any other
   difference — a hand edit, a stray line, a second copy of a function — shows
   up here as a byte mismatch. */
let unstamped = built
  .split(`connect-src ${cfg.apiBase};`).join('connect-src https://scrivara-backend.onrender.com;')
  .split(`var API = '${cfg.apiBase}';`).join("var API = 'https://scrivara-backend.onrender.com';")
  .split(`<title>${cfg.displayName}</title>`).join('<title>MLS Scribe</title>')
  .split(`<meta name="apple-mobile-web-app-title" content="${cfg.displayName}">`)
    .join('<meta name="apple-mobile-web-app-title" content="MLS Scribe">')
  .split(`<h1>${cfg.displayName}</h1>`).join('<h1>MLS Scribe</h1>')
  .split(`<a href="${cfg.privacyUrl}" target="_blank" rel="noreferrer">Privacy</a>`)
    .join('<a href="privacy.html" target="_blank" rel="noreferrer">Privacy</a>')
  .split(`<a href="${cfg.termsUrl}" target="_blank" rel="noreferrer">Terms</a>`)
    .join('<a href="terms.html" target="_blank" rel="noreferrer">Terms</a>')
  .split('<!-- bundled app: no PWA manifest -->').join('<link rel="manifest" href="app-manifest.json">');

if (unstamped !== APP) {
  /* Report the first difference with context rather than dumping 47 KB. */
  let i = 0;
  while (i < Math.min(unstamped.length, APP.length) && unstamped[i] === APP[i]) i++;
  const line = APP.slice(0, i).split('\n').length;
  assert.fail(
    'mobile/www/index.html is not app.html with only the config values stamped.\n' +
    `  first difference at line ${line}\n` +
    `  app.html : ${JSON.stringify(APP.slice(i - 40, i + 60))}\n` +
    `  built    : ${JSON.stringify(unstamped.slice(i - 40, i + 60))}`
  );
}

/* ---------- 2. the stamped values really are the configured ones --------- */
{
  assert.ok(built.includes(`var API = '${cfg.apiBase}';`),
    'the built bundle does not point at the configured apiBase');
  assert.ok(built.includes(`connect-src ${cfg.apiBase};`),
    'the built bundle\'s CSP does not match the configured apiBase — the app could not reach its own API');
  assert.ok(built.includes(`<title>${cfg.displayName}</title>`), 'the built bundle has the wrong title');

  /* A bundled app must not try to fetch a PWA manifest that is not in it. */
  assert.ok(!built.includes('rel="manifest"'),
    'the bundled app still links a PWA manifest — that file is not in the binary');

  /* The ONLY absolute URLs in the bundle are the two legal documents, and both
     are <a target="_blank"> — links the system browser opens on a tap, never
     something fetched at startup. Anything else here is a launch-time network
     dependency the binary does not contain. */
  const externals = [...built.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(externals.sort(), [cfg.privacyUrl, cfg.termsUrl].sort(),
    'the bundled app references an unexpected absolute URL: ' + JSON.stringify(externals));
  for (const url of externals) {
    const tag = built.slice(built.indexOf(`href="${url}"`) - 3, built.indexOf(`href="${url}"`) + url.length + 60);
    assert.ok(/target="_blank"/.test(tag),
      `${url} is not target=_blank — it would try to navigate the app's own webview off its bundle`);
  }
}

/* ---------- 3. every asset the bundle references is IN the bundle -------- */
{
  const www = path.join(MOBILE, 'www');
  const refs = [...built.matchAll(/(?:src|href)="(?!https?:|data:|#)([^"]+)"/g)].map((m) => m[1]);
  for (const ref of new Set(refs)) {
    assert.ok(fs.existsSync(path.join(www, ref)),
      `the bundle references ${ref} but mobile/www/${ref} does not exist — it would 404 on a real phone`);
  }
  assert.ok(refs.length > 0, 'expected the bundle to reference at least its icons');
}

/* ---------- 4. www/ is not committed ------------------------------------- */
{
  const ignore = fs.readFileSync(path.join(MOBILE, '.gitignore'), 'utf8');
  assert.ok(/^www\/$/m.test(ignore),
    'mobile/www must stay ignored — a committed copy is a second app that can drift');
  for (const secret of ['keystore.properties', '*.keystore', '*.jks', 'AuthKey_*.p8']) {
    assert.ok(ignore.includes(secret),
      `mobile/.gitignore does not exclude ${secret} — signing material in git is an app hijack`);
  }
}

console.log('phone-app-www-build-is-faithful.test.js: OK — the store bundle is app.html with 5 stamped values and nothing else; every referenced asset is present; signing material is ignored');
