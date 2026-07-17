'use strict';

/* Device-role contract (dr-1.0.0, 2026-07-16). Owner problems this pins:
 *  1. MacBooks/Windows laptops misidentified as phones — the old phone
 *     signal was `window.innerWidth <= 760`, so any narrow window became a
 *     phone. Window size must NEVER classify a device again.
 *  2. Laptops stuck on "waiting for office computer" — the relay must
 *     fail FAST with an honest fix when the office computer isn't
 *     heartbeating, and bail early when a queued job is never picked up.
 *  3. Stale sessions/heartbeats — every device heartbeats an explicit
 *     role (office | secondary | phone) + identity, and the Settings card
 *     lists devices with last-heartbeat + Forget. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const connect = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');

/* ---- module presence ---- */
assert(connect.includes("version: 'dr-1.0.0'"), 'device-role module is not installed');

/* ---- slice the ph module's wantPhone() ---- */
const phStart = connect.indexOf('__mlsPhoneHome ph-1');
assert(phStart > 0, 'phone-home module not found');
const wpStart = connect.indexOf('function wantPhone()', phStart);
assert(wpStart > 0, 'wantPhone not found');
const wpEnd = connect.indexOf('\n  }', wpStart);
const wantPhoneSrc = connect.slice(wpStart, wpEnd + 4);

/* 1) window width must never classify: */
assert(!/innerWidth/.test(wantPhoneSrc),
  'wantPhone still consults window width — narrow laptops would become phones again');
/* explicit role wins: */
assert(/__mlsDeviceRole/.test(wantPhoneSrc), 'wantPhone does not consult the explicit device role');
assert(/r === 'phone'/.test(wantPhoneSrc), 'explicit role must map phone->phone UI, others->full app');
/* fallback needs real handheld EVIDENCE (mobile UA + touch), not geometry: */
assert(/iPhone\|iPod\|Android/.test(wantPhoneSrc) && /maxTouchPoints/.test(wantPhoneSrc),
  'role-less fallback must require mobile UA + touch evidence');

/* runtime sim of the role-less fallback + explicit-role paths */
function simWantPhone(opts) {
  const sandbox = {
    sessionStorage: {
      _m: opts.session || {},
      getItem(k) { return this._m[k] == null ? null : this._m[k]; }
    },
    window: Object.assign({
      innerWidth: opts.innerWidth,
      __mlsDeviceRole: opts.role ? { role: () => opts.role } : undefined
    }, opts.touch ? { ontouchstart: null } : {}),
    navigator: { userAgent: opts.ua, maxTouchPoints: opts.touch ? 5 : 0 },
    extPresent: () => !!opts.ext
  };
  const fn = new Function('sessionStorage', 'window', 'navigator', 'extPresent',
    'return (' + wantPhoneSrc.replace('function wantPhone()', 'function ()') + ')();');
  return fn(sandbox.sessionStorage, sandbox.window, sandbox.navigator, sandbox.extPresent);
}
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

assert.equal(simWantPhone({ ua: MAC_UA, innerWidth: 500, ext: false }), false,
  'THE BUG: a narrow-windowed MacBook without the extension must NOT be a phone');
assert.equal(simWantPhone({ ua: WIN_UA, innerWidth: 600, ext: false }), false,
  'a narrow-windowed Windows laptop must NOT be a phone');
assert.equal(simWantPhone({ ua: IPHONE_UA, innerWidth: 390, ext: false, touch: true }), true,
  'a real iPhone (mobile UA + touch) still gets the phone UI');
assert.equal(simWantPhone({ ua: MAC_UA, innerWidth: 1400, ext: false, role: 'phone' }), true,
  'explicit phone role wins regardless of hardware');
assert.equal(simWantPhone({ ua: IPHONE_UA, innerWidth: 390, ext: false, touch: true, role: 'secondary' }), false,
  'explicit non-phone role wins even on a handheld');
assert.equal(simWantPhone({ ua: MAC_UA, innerWidth: 1400, ext: false, session: { mls_phone_mode: '1' } }), true,
  'QR ?phone=1 explicit entry still forces phone mode');

/* 2) relay honesty: presence pre-check + early queued bail ---- */
const rlStart = connect.indexOf('__mlsRelayLink rl-1');
const rl = connect.slice(rlStart, phStart);
assert(/FAIL-FAST/.test(rl) && rl.indexOf('/api/relay/presence') < rl.length,
  'pullDay must pre-check office presence before queueing');
assert(/queuedPolls > 12/.test(rl),
  'a job stuck in queued must bail early with an honest message, not grind 160s');
assert(/never picked the request up|went to sleep/.test(rl),
  'the early bail must explain the likely cause (sleep/closed) and the fix');
/* beacon gate: only the office computer claims office presence */
const beaconSrc = rl.slice(rl.indexOf('function beacon()'), rl.indexOf('var beaconIv'));
assert(/effectiveRole\(\) !== 'office'/.test(beaconSrc),
  'a secondary laptop with the extension must not beacon office presence');
/* phone bar names the office computer + honest no-office message */
assert(/officeName/.test(rl), 'presence display must name the office computer when known');
assert(/no office computer set up yet/.test(rl), 'missing-office state must say how to fix it');

/* 3) device registry: roles, identity, heartbeat, panel ---- */
const dr = connect.slice(connect.indexOf('__mlsDeviceRole dr-1'));
assert(/r === 'office' \|\| r === 'secondary' \|\| r === 'phone'/.test(dr),
  'roles must be exactly office | secondary | phone');
assert(/mls_device_id/.test(dr) && /mls_device_role/.test(dr) && /mls_device_name/.test(dr),
  'device identity/role/name must persist per device');
assert(/\/api\/relay\/devices\/heartbeat/.test(dr), 'heartbeat endpoint missing');
assert(/\/api\/relay\/devices'/.test(dr) || /\/api\/relay\/devices\?/.test(dr) || /'\/api\/relay\/devices', \{ headers/.test(dr),
  'device list endpoint missing');
assert(/\/forget/.test(dr), 'stale-device Forget action missing');
assert(/visibilitychange/.test(dr), 'wake-from-sleep must trigger a fresh heartbeat (Mac lid-close case)');
assert(/last heartbeat/.test(dr), 'panel must show last heartbeat');
assert(/\(this device\)/.test(dr), 'panel must mark the current device');
assert(/suggestRole/.test(dr) && !/innerWidth/.test(dr),
  'role suggestion must come from evidence, never window size');
assert(/What is this device\?/.test(dr), 'first-run role confirmation card missing — roles must be chosen, not silently inferred');
assert(/does not report the MLS Assist extension/.test(dr),
  'setting office role without the extension must warn (it cannot run pulls)');

console.log('PASS device-role contract: width never classifies, explicit roles win, relay fails fast + honest, registry heartbeats + panel with forget');
