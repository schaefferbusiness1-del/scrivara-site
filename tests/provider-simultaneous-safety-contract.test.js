'use strict';
/* 2026-07-22: the MLS Assist extension is ALLOWED to keep working while
 * providers are actively using Athena. This pin makes three things permanent:
 *
 *  1. NO provider-activity gating: no production code disables, pauses, or
 *     blocks the extension because providers are logged in / running / working.
 *     (A stale folder claim said the extension "cannot run when providers are
 *     running" — that claim is false and must never become code.)
 *  2. NO extension-disabling bridge messages: every message the app posts to
 *     the extension bridge is an action/read request — never a
 *     disable/suspend/deactivate command.
 *  3. NO focus stealing: the __mlsNoAthenaYank module stays installed — after
 *     a pull foregrounds athenaOne to read, the app brings the doctor BACK to
 *     the MLS tab instead of stranding them, and identity/connection verifiers
 *     fail closed without tab switches.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const conn = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* -------- collect every production-loaded script -------- */
const loaded = new Set(['mls-connect.js']);
const refRe = /["']((?:feat_|mls-)[A-Za-z0-9_.-]+\.js)["']/g;
let m;
for (const src of [conn, app]) {
  refRe.lastIndex = 0;
  while ((m = refRe.exec(src))) loaded.add(m[1]);
}
assert(loaded.size > 100, 'loader scan looks broken');

/* -------- 1. no provider-activity extension gating anywhere -------- */
const gating = [];
const gatingRes = [
  /provider[a-z_]*\s*(?:is|are)?\s*(?:active|running|logged|working)[\s\S]{0,80}?(?:disable|pause|suspend|block|deactivate)[\s\S]{0,40}?(?:ext|assist)/i,
  /(?:disable|pause|suspend|deactivate)[\s\S]{0,40}?(?:ext|assist)[\s\S]{0,80}?provider[a-z_]*\s*(?:active|running|logged|working)/i,
  /providersRunning|providersActive|whenProvidersRunning/i,
  /cannot\s+run\s+when\s+providers/i
];
function scanGating(name, source) {
  for (const re of gatingRes) {
    const hit = source.match(re);
    if (hit) gating.push(name + ': ' + String(hit[0]).slice(0, 120));
  }
}
for (const f of [...loaded].sort()) {
  let s; try { s = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
  scanGating(f, s);
}
scanGating('ScribeFlow.html', app);
assert.strictEqual(gating.length, 0,
  'provider-activity extension gating found (must never exist):\n' + gating.join('\n'));

/* -------- 2. bridge messages are never disable/suspend commands -------- */
const msgTypes = new Set();
const msgRe = /type:\s*['"](mlsApp[A-Za-z0-9_]+)['"]/g;
for (const src of [conn, app]) {
  msgRe.lastIndex = 0;
  while ((m = msgRe.exec(src))) msgTypes.add(m[1]);
}
assert(msgTypes.size >= 3, 'bridge message scan looks broken — found ' + msgTypes.size);
const disabling = [...msgTypes].filter(t => /disable|suspend|deactivate|shutdown|kill/i.test(t));
assert.strictEqual(disabling.length, 0,
  'extension-disabling bridge messages found: ' + disabling.join(', '));

/* -------- 3. the no-yank focus-return module stays installed -------- */
assert(conn.includes('window.__mlsNoAthenaYank = api'), 'no-yank module no longer installs');
const yank = conn.slice(conn.indexOf("/* MLS Scribe -- __mlsNoAthenaYank"), conn.indexOf('window.__mlsNoAthenaYank_revert') + 60);
assert(yank.includes("type: 'mlsAppFocusMlsTab'"), 'return-to-MLS signal is gone');
assert(yank.includes("source: 'mls-app'"), 'focus-return message lost its trusted source tag');
assert(/Worker/.test(yank), 'no-yank poll is no longer worker-driven (it would stall while the tab is hidden — the exact bug it fixes)');
assert(conn.includes('window.__mlsNoAthenaYank_revert'), 'no-yank module lost its revert');
/* the app half never yanks Athena forward itself: verifiers fail closed */
assert(yank.includes('no verifier ever foregrounds Athena'), 'fail-closed verifier doctrine dropped from the mechanism doc');

console.log('PASS provider-simultaneous safety: ' + loaded.size + ' scripts free of provider-activity extension gating, ' + msgTypes.size + ' bridge message types all non-disabling, and the no-yank focus-return mechanism pinned');
