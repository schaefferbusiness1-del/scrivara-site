#!/usr/bin/env node
/* Builds mobile/www/ — the assets Capacitor copies INTO the iOS and Android
 * binaries.
 *
 * There is exactly one source for the app: ../app.html. This script copies it
 * and stamps the values from app.config.json into it. It does not template, it
 * does not concatenate, and it does not have a second copy of anything — so the
 * page the App Store reviews and the page at mlsscribe.com/app.html cannot
 * drift apart. tests/phone-app-www-build-is-faithful.test.js re-runs this and
 * fails if they do.
 *
 * Every substitution below is REQUIRED. If a marker is missing the build stops
 * with the marker named, rather than shipping a binary that quietly kept a
 * stale API host or the wrong app name — which is the exact failure a string
 * -replacement build step is otherwise famous for.
 *
 *   node mobile/scripts/build-www.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..');
const ROOT = path.resolve(MOBILE, '..');
const WWW = path.join(MOBILE, 'www');

const cfg = JSON.parse(fs.readFileSync(path.join(MOBILE, 'app.config.json'), 'utf8'));

for (const key of ['displayName', 'appId', 'version', 'apiBase']) {
  if (!cfg[key] || typeof cfg[key] !== 'string') {
    throw new Error(`app.config.json is missing a usable "${key}"`);
  }
}
if (!/^https:\/\/[a-z0-9.-]+$/i.test(cfg.apiBase) || cfg.apiBase.endsWith('/')) {
  throw new Error(`apiBase must be a bare https origin with no trailing slash, got: ${cfg.apiBase}`);
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/i.test(cfg.appId)) {
  throw new Error(`appId must be a reverse-DNS bundle id, got: ${cfg.appId}`);
}

let html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');

/* [marker to find, what it becomes] — each must match EXACTLY ONCE. */
const stamps = [
  ["connect-src https://scrivara-backend.onrender.com;", `connect-src ${cfg.apiBase};`],
  ["var API = 'https://scrivara-backend.onrender.com';", `var API = '${cfg.apiBase}';`],
  ['<title>Scrivara</title>', `<title>${cfg.displayName}</title>`],
  ['<meta name="apple-mobile-web-app-title" content="Scrivara">',
    `<meta name="apple-mobile-web-app-title" content="${cfg.displayName}">`],
  ['<h1>Scrivara</h1>', `<h1>${cfg.displayName}</h1>`],
  /* A bundled app has no sibling pages, so a relative legal link is a 404 in
     the binary — and both stores require the privacy policy to be reachable
     from inside the app. Absolute, opened in the system browser. */
  ['<a href="privacy.html" target="_blank" rel="noreferrer">Privacy</a>',
    `<a href="${cfg.privacyUrl}" target="_blank" rel="noreferrer">Privacy</a>`],
  ['<a href="terms.html" target="_blank" rel="noreferrer">Terms</a>',
    `<a href="${cfg.termsUrl}" target="_blank" rel="noreferrer">Terms</a>`],
];
for (const [find, replace] of stamps) {
  const n = html.split(find).length - 1;
  if (n !== 1) {
    throw new Error(
      `build-www: marker appears ${n} times, expected exactly 1 — app.html changed shape.\n  marker: ${find}`
    );
  }
  html = html.replace(find, replace);
}

/* A bundled app has no service worker and no PWA manifest — it IS installed.
   Leaving the manifest link in would make the app fetch a file that is not in
   the bundle on every launch. */
const manifestLink = '<link rel="manifest" href="app-manifest.json">';
if (!html.includes(manifestLink)) throw new Error('build-www: manifest link marker missing from app.html');
html = html.replace(manifestLink, '<!-- bundled app: no PWA manifest -->');

fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });
fs.writeFileSync(path.join(WWW, 'index.html'), html);

/* the two icons the page itself references, so nothing 404s at runtime */
for (const asset of ['apple-touch-icon.png', 'icon-192.png']) {
  fs.copyFileSync(path.join(ROOT, asset), path.join(WWW, asset));
}

/* Capacitor's own config is DERIVED. Hand-editing it is how an appId drifts
   away from the store listing it was registered under. */
const capacitor = {
  appId: cfg.appId,
  appName: cfg.displayName,
  webDir: 'www',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: true },
  /* iosScheme 'capacitor' + androidScheme 'https' fix the app's two origins at
     capacitor://localhost and https://localhost. Those exact strings are the
     ones the backend's CORS allowlist admits (scrivara-backend
     src/server.js CANONICAL_NATIVE_APP_ORIGINS). Change either scheme here and
     every request from the shipped app fails CORS — change them together. */
  server: { androidScheme: 'https', iosScheme: 'capacitor', cleartext: false },
  plugins: { StatusBar: { overlaysWebView: false, style: 'DEFAULT' } },
};
fs.writeFileSync(path.join(MOBILE, 'capacitor.config.json'), JSON.stringify(capacitor, null, 2) + '\n');

const bytes = Buffer.byteLength(html);
console.log(`built mobile/www/`);
console.log(`  index.html      ${bytes} bytes  (from app.html, ${stamps.length} values stamped)`);
console.log(`  app             ${cfg.displayName}  ${cfg.appId}  v${cfg.version}`);
console.log(`  api             ${cfg.apiBase}`);
console.log(`  origins         capacitor://localhost (iOS) · https://localhost (Android)`);
