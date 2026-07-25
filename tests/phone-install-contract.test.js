'use strict';
/* phone-install-contract — ph-install-1.0.0 (2026-07-25)
 *
 * WHY THIS EXISTS
 * manifest.webmanifest is what turns mlsscribe.com into an installed app on an
 * iPhone or Android home screen, and at b621 its CONTENT was asserted by
 * nothing at all — the only references anywhere in tests/ were "it parses as
 * JSON" and "the <link> target exists". So it had drifted:
 *   - theme_color was #2563eb (blue) while every page ships #2E6A4B (green),
 *     which is the colour Android paints the status bar and task switcher.
 *   - there was no `id`, so a future change to start_url would be treated as a
 *     DIFFERENT app and installed alongside the existing one instead of
 *     updating it — a second icon on the clinician's home screen.
 *   - background_color was #ffffff against an app whose canvas is #F7F5EF,
 *     which is the flash a user sees on every cold launch.
 *
 * Icons are checked on disk AND for real pixel dimensions, because a manifest
 * that names an icon of the wrong size fails installability silently — the
 * browser simply declines to offer the install, with nothing in the UI to say
 * why.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const manifest = JSON.parse(read('manifest.webmanifest'));

/* ---- identity ---- */
assert.strictEqual(manifest.id, '/ScribeFlow.html',
  'manifest must declare a stable `id`, or changing start_url installs a SECOND app beside the first');
assert.strictEqual(manifest.start_url, '/ScribeFlow.html',
  'start_url must be root-absolute so it resolves identically however the manifest is reached');
assert.strictEqual(manifest.scope, '/',
  'scope must cover the whole origin, or in-app navigations escape the installed window into a browser tab');
assert.strictEqual(manifest.display, 'standalone', 'installed MLS must run without browser chrome');

/* ---- colours must match the app the user actually sees ---- */
const shell = read('ScribeFlow.html');
const metaTheme = (shell.match(/name="theme-color"\s+content="([^"]+)"/) || [, ''])[1];
assert(metaTheme, 'ScribeFlow.html must declare a theme-color meta');
assert.strictEqual(manifest.theme_color.toLowerCase(), metaTheme.toLowerCase(),
  'manifest theme_color (' + manifest.theme_color + ') must match the app shell theme-color (' + metaTheme +
  ') — Android paints the status bar and task switcher from the manifest, so a mismatch is visible on every launch');
assert(/^#[0-9a-f]{6}$/i.test(manifest.background_color),
  'background_color must be an explicit hex — it is the cold-launch splash colour');

/* ---- icons must exist at the sizes they claim ---- */
function pngSize(buf) {
  /* 8-byte signature, then a length+type ("IHDR"), then width/height as
     big-endian uint32 at offsets 16 and 20. */
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

assert(Array.isArray(manifest.icons) && manifest.icons.length >= 3, 'manifest must declare icons');
let maskable = 0;
let has192 = false, has512 = false;
for (const icon of manifest.icons) {
  const file = path.join(root, icon.src);
  assert(fs.existsSync(file), 'manifest icon is missing on disk: ' + icon.src);
  const size = pngSize(fs.readFileSync(file));
  assert(size, 'manifest icon is not a readable PNG: ' + icon.src);
  const [dw, dh] = icon.sizes.split('x').map(Number);
  assert.strictEqual(size.w, dw, icon.src + ' claims width ' + dw + ' but is ' + size.w);
  assert.strictEqual(size.h, dh, icon.src + ' claims height ' + dh + ' but is ' + size.h);
  if (/maskable/.test(icon.purpose || '')) maskable++;
  if (dw === 192) has192 = true;
  if (dw === 512) has512 = true;
}
assert(has192 && has512, 'installability requires both a 192px and a 512px icon');
assert(maskable >= 1,
  'at least one maskable icon is required, or Android crops the square icon inside its adaptive mask');

/* ---- the manifest must actually be linked, or none of the above matters ---- */
assert(/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/.test(shell),
  'ScribeFlow.html must link the manifest — an unlinked manifest cannot install');

/* ---- the SW must be able to serve it offline ---- */
const sw = read('sw.js');
assert(/'\/manifest\.webmanifest'/.test(sw),
  'manifest.webmanifest must be in the service-worker SHELL so an installed app can cold-start offline');

/* ---- ph-offline-1.0.0: the URL the QR hands to phones must open offline ----
 * sw.js failed closed on ANY query, so ScribeFlow.html?phone=1 — the exact URL
 * in the pairing QR and the setup email — was a browser error page offline
 * while the byte-identical /ScribeFlow.html sat in the cache. The allowance is
 * an exact whitelist of secret-free mode flags, and must stay that way. */
assert(/SAFE_SHELL_QUERIES\s*=\s*new Set\(\['\?phone=1',\s*'\?phone=0'\]\)/.test(sw),
  'the offline query allowance must remain an EXACT whitelist of secret-free mode flags');
assert(/if \(url\.search && !SAFE_SHELL_QUERIES\.has\(url\.search\)\) return '';/.test(sw),
  'offlineShellKey must reject every query except the exact whitelist');
assert(!/SAFE_SHELL_QUERIES[\s\S]{0,400}token/.test(sw),
  'no capability-bearing query may ever enter the offline allowance');

console.log('PASS phone install contract: stable id, root-scoped start_url, manifest theme matches the shell, ' +
  manifest.icons.length + ' icons verified on disk at their declared pixel sizes, and the phone-mode URL opens offline');
