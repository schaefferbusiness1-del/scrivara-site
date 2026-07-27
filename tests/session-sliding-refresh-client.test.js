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
assert(block.includes("'/api/auth/refresh'") && block.includes("'Authorization':'Bearer '+bkToken()"),
  'refresh must call the canonical endpoint with the canonical token helper');
assert(/if\(!backendMode\(\)\|\|!bkToken\(\)\) return;/.test(block), 'local mode and signed-out tabs must never call refresh');

/* Occluded-tab law: kicked by session start + visible tab return, NEVER a
 * timer. A hidden tab has no claim on session maintenance. */
assert(!/setInterval|setTimeout/.test(block), 'no timers — refresh rides real activity signals only');
assert(/visibilitychange/.test(block) && /visibilityState==='visible'/.test(block),
  'tab return is the recurring kick, and only when actually visible');
assert(/_slideSessionLastAt<6\*60\*60\*1000/.test(block), 'per-tab attempts are floored at one per 6h');

/* startSession fires it without blocking the gate. */
assert(/try\{ slideSession\(\); \}catch\(e\)\{\}/.test(app), 'startSession must fire-and-forget the first slide');

console.log('PASS sliding refresh client: 404-safe pre-deploy, canonical auth, visibility-kicked with a 6h floor, no timers, gate never blocked');
