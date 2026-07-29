'use strict';

/* SLIDING SESSION REFRESH — client half (b742). The backend endpoint
 * (POST /api/auth/refresh, sms-2fa branch) rotates a valid day-old token to a
 * fresh 30-day one; this suite pins the client contract that makes shipping
 * BEFORE the backend deploy safe, and keeps the occluded-tab law honored. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.resolve(__dirname, '..', 'ScribeFlow.html'), 'utf8');

const start = app.indexOf('let _slideSessionLastAt');
const end = app.indexOf('/* Email-only convenience memory', start);
assert(start > 0 && end > start, 'the slideSession block must live beside the session helpers');
const block = app.slice(start, end);

/* 404-safe pre-deploy: a non-OK response returns BEFORE any json/token work,
 * so until the backend ships the endpoint every call is a silent no-op. */
assert(/if\(!res\.ok\) return;/.test(block), 'non-OK responses must be silent no-ops (404-safe pre-deploy)');
assert(/d&&d\.ok&&d\.refreshed&&d\.token/.test(block) && block.includes('setBkToken(d.token)'),
  'only an explicit refreshed:true response may rotate the stored token');

/* Auth plumbing: bearer from the canonical helper, endpoint exact. */
/* 2026-07-29: the bearer is the REQUEST-TIME capture (tok0 = bkToken()), so
   the same value that authenticated the call is the value the stale-response
   guard compares against - one token, one identity, no re-read race. */
assert(block.includes("'/api/auth/refresh'") && block.includes("'Authorization':'Bearer '+tok0"),
  'refresh must call the canonical endpoint with the request-time token capture');
assert(/if\(!backendMode\(\)\|\|!bkToken\(\)\) return;/.test(block), 'local mode and signed-out tabs must never call refresh');

/* Occluded-tab law: kicked by session start + visible tab return, NEVER a
 * timer. A hidden tab has no claim on session maintenance. */
assert(!/setInterval|setTimeout/.test(block), 'no timers — refresh rides real activity signals only');
assert(/visibilitychange/.test(block) && /visibilityState==='visible'/.test(block),
  'tab return is the recurring kick, and only when actually visible');
assert(/_slideSessionLastAt<6\*60\*60\*1000/.test(block), 'per-tab attempts are floored at one per 6h');

/* 2026-07-29 QA fleet: three harness-proven races - stale refresh after
   logout resurrects a dead token; same-tab account switch writes A's token
   under B's session; the token-only seed write tears the localStorage pair.
   The guard: capture token+email at request time, discard the response if
   either changed while the fetch was in flight. */
assert(/const tok0=bkToken\(\), em0=getSessionEmail\(\);/.test(block),
  'slideSession must capture request-time identity (token + email)');
assert(/if\(bkToken\(\)!==tok0\|\|getSessionEmail\(\)!==em0\) return;/.test(block),
  'slideSession must discard a stale refresh response when identity changed in flight');
assert(block.indexOf('!==tok0') < block.indexOf('setBkToken(d.token)'),
  'the identity guard must run BEFORE the token write');

/* startSession fires it without blocking the gate. */
assert(/try\{ slideSession\(\); \}catch\(e\)\{\}/.test(app), 'startSession must fire-and-forget the first slide');

console.log('PASS sliding refresh client: 404-safe pre-deploy, canonical auth, visibility-kicked with a 6h floor, no timers, gate never blocked');
