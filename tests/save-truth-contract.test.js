'use strict';

/* Owner 2026-07-24: "Every save must be verified … Failed or uncertain saves
 * must be retried safely, clearly reported, and never duplicated or written to
 * the wrong chart. Do not hide the warning [or] assume the saves worked."
 *
 * Three false receipts were confirmed by audit and are pinned here:
 *  1. opPrepSave swallowed every persistence error and still painted
 *     "✓ Saved to <patient>'s History" — a finished OPERATIVE NOTE could vanish
 *     behind a green message (the notes store is plain JSON on the shared ~5MB
 *     origin budget, so QuotaExceededError is reachable).
 *  2. saveNoteToBackend treated 402/403 — the server REFUSING to store a note —
 *     as 'synced', dropping it from the retry queue and painting
 *     "☁ Synced · Backed up to your account" over a device-only copy; a 401
 *     returned 'queued' without ever queueing.
 *  3. Sign-out purges local clinical state by design, silently destroying notes
 *     the server never accepted.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function block(startMarker, endMarker, label) {
  const a = app.indexOf(startMarker);
  assert(a >= 0, label + ': start marker missing: ' + startMarker);
  const b = app.indexOf(endMarker, a + startMarker.length);
  assert(b > a, label + ': end marker missing: ' + endMarker);
  return app.slice(a, b);
}

// ---------------------------------------------------------------------------
// 1. The op-note save must PROVE the write before claiming it
// ---------------------------------------------------------------------------
{
  const save = block('function opPrepSave(i){', '\nfunction openTemplates', 'opPrepSave');

  assert(/__opSaved\s*=\s*\(\(typeof getNotes==='function'\?getNotes\(\):\[\]\)\|\|\[\]\)\.some/.test(save),
    'opPrepSave must read the note back out of the store before reporting success');

  const readBackAt = save.indexOf('__opSaved=((typeof getNotes');
  const successAt = save.indexOf('✓ Saved to ');
  assert(readBackAt >= 0 && successAt > readBackAt,
    'the read-back must happen BEFORE the success message is painted');

  const failAt = save.indexOf('could NOT be saved on this device');
  assert(failAt >= 0, 'a failed save must say so explicitly');
  assert(failAt < successAt,
    'the failure branch must return before the success message (owner: never claim a save that did not happen)');
  assert(/if\(!__opSaved\)\{[\s\S]{0,900}?return;/.test(save),
    'the failure branch must RETURN — it may never fall through into the success path');
  assert(/Copy the note text above before closing/.test(save),
    'a failed op-note save must tell the doctor how to keep the text (it is only in the DOM at that point)');
  assert(/Nothing was written to /.test(save),
    'a failed save must state that nothing reached the chart');

  // the backend mirror may only be attempted for a note that actually persisted
  const mirrorAt = save.indexOf('saveNoteToBackend(sv)');
  assert(mirrorAt > readBackAt, 'the server mirror must be attempted only after the local write is proven');
  assert(/if\(__opSaved\)\{[\s\S]{0,220}saveNoteToBackend/.test(save),
    'the server mirror must be gated on the proven local save');
}

// ---------------------------------------------------------------------------
// 2. Server-refused notes are never called "Synced"
// ---------------------------------------------------------------------------
{
  const backend = block('function saveNoteToBackend(rec){', '\n/* Best-effort server-side (soft) delete', 'saveNoteToBackend');

  assert(/if\(r\.status===401\)\{ _pendingBackupAdd\(rec\.id\); handle401\(\); return 'queued'; \}/.test(backend),
    'a 401 must QUEUE the note before handling the dead session (it previously returned "queued" without queueing)');
  assert(/if\(r\.ok\)\{ _pendingBackupRemove\(rec\.id\); _svrDeclinedRemove\(rec\.id\); return 'synced'; \}/.test(backend),
    'only a 2xx may be reported as synced');
  assert(/if\(r\.status===402 \|\| r\.status===403\)\{ _pendingBackupRemove\(rec\.id\); _svrDeclinedAdd\(rec\.id\); return 'declined'; \}/.test(backend),
    'a server refusal (402/403) must be recorded as declined — never as synced');
  assert(!/r\.ok \|\| r\.status===402 \|\| r\.status===403/.test(app),
    'no path may still fold 402/403 into the success branch');

  // the retry loop must agree with the save path
  const retry = block('async function _retryPendingBackups(manual){', '\nfunction saveNoteToBackend', 'retry loop');
  assert(/if\(r\.ok\)\{ _pendingBackupRemove\(rec\.id\); _svrDeclinedRemove\(rec\.id\); \}/.test(retry),
    'the retry loop must only de-queue on a real success');
  assert(/else if\(r\.status===402 \|\| r\.status===403\)\{ _pendingBackupRemove\(rec\.id\); _svrDeclinedAdd\(rec\.id\); \}/.test(retry),
    'the retry loop must mark refusals as declined');

  // the declined set must persist per account namespace
  assert(/function _svrDeclinedGet\(\)\{[\s\S]{0,200}uns\('serverDeclined'\)/.test(app),
    'declined notes must be tracked in the account-namespaced store');
}

// ---------------------------------------------------------------------------
// 3. The History chip tells the truth (three states, not two)
// ---------------------------------------------------------------------------
{
  const badge = block('const _syncBadge=(n)=> hosted', 'var _histHtml=ordered.map', 'sync badge');
  assert(/_declined\.has\(n\.id\)/.test(badge), 'the chip must check the declined set first');
  assert(/📱 Device only/.test(badge), 'a server-refused note must render as device-only');
  assert(/⏳ Syncing/.test(badge) && /☁ Synced/.test(badge), 'the queued and synced states must remain');
  const declinedAt = badge.indexOf('_declined.has'), syncedAt = badge.indexOf('☁ Synced');
  assert(declinedAt >= 0 && declinedAt < syncedAt,
    'declined must be evaluated before the synced fallback, or a refused note still reads as backed up');
}

// ---------------------------------------------------------------------------
// 4. Sign-out may not silently destroy work the server never accepted
// ---------------------------------------------------------------------------
{
  const logout = block('async function logout(force){', 'sfResetSessionBoundary', 'logout');
  assert(/_pendingBackupGet\(\)\|\|\[\]\)\.length\+\(_svrDeclinedGet\(\)\|\|\[\]\)\.length/.test(logout),
    'logout must count BOTH queued and server-refused notes before purging');
  assert(/NOT been backed up to your account/.test(logout),
    'the warning must state plainly that the notes are not backed up');
  assert(/cannot be recovered/.test(logout), 'the warning must state that the purge is irreversible');
  assert(/if\(!_okUnsynced\) return;/.test(logout), 'declining the warning must abort the sign-out');
  assert(/if\(force!==true && backendMode\(\)\)/.test(logout),
    'the forced inactivity logout must not block on a prompt (it cannot be answered)');
}

console.log('PASS save truth: op-note saves are proven before they are claimed, server-refused notes are never called synced (401 queues, 402/403 declined), the History chip shows all three states, and sign-out warns before purging unbacked work');
