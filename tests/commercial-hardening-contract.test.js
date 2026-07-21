'use strict';
/* Commercial hardening 2026-07-21 (owner directive after a live pull aborted on
 * one transient blip): critical reads retry with backoff and fail CLOSED; and a
 * failed patient-mirror can no longer strand a save that the sign-out purge
 * would then destroy. These markers pin each protection. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const app = read('ScribeFlow.html');
const sched = read('feat_mls_schedimport_exact.js');

/* 1. Exact-import pre-reconcile calendar read retries before refusing the day
   (single attempt aborted a whole pull on one restart blip, live 2026-07-21). */
assert(sched.includes('readCalendarAttempt(1)') && sched.includes('readCalendarAttempt(n + 1)'),
  'schedimport calendar read lost its bounded retry');
assert(sched.includes('"calendar-read-unverified"'),
  'final calendar-read failure must still refuse the day fail-closed');

/* 2. Legacy import duplicate-check read: retry, and on failure REFUSE the
   import (it used to continue with an empty duplicate index — double-import risk). */
assert(app.includes('this prevents duplicate appointments'),
  'legacy import no longer refuses honestly when the existing calendar is unverifiable');
assert(!/existingKeys=\{\};\s*\n\s*try\{ var er=await fetch/.test(app),
  'legacy import regressed to the swallow-and-continue duplicate-check read');

/* 3. Boot hydration retries and tells an empty-store device the truth. */
assert(app.includes('__mlsHydrateFailNoticed'),
  'hydration failure on an empty device is silent again');
assert(/for\(let _h=1;_h<=3;_h\+\+\)/.test(app),
  'patient hydration lost its bounded retry');

/* 4. Patient-mirror pending queue: a failed mirror persists per-account and
   re-pushes while the session lives; only a server-confirmed write removes it.
   (Without this, mirror-failure + the sign-out clinical purge = data loss.) */
assert(app.includes("uns('pendingPtSync')"), 'patient pending-sync store missing');
assert(app.includes('_pendingSyncAdd(patient.id)') && app.includes('_pendingSyncRemove(patient.id)'),
  'patient mirror no longer queues failures / clears on confirmed writes');
assert(app.includes('_flushPendingSync'), 'pending-sync flush loop missing');

/* 5. The notes backup queue that inspired the pattern must itself remain. */
assert(app.includes('_pendingBackupAdd(rec.id)') && app.includes('_retryPendingBackups(false)'),
  'note backup queue/retry regressed');

/* 6. Verify-now auto visit binding (owner 2026-07-21): exactly ONE id-linked
   calendar row derives the visit identity so the doctor never has to reopen
   the patient from the scheduled row; the fail-closed refusal must remain
   for zero or ambiguous candidates, and matching is by immutable patient id
   only (never name). */
const connect = read('mls-connect.js');
assert(connect.includes('autoDerived:true'), 'verify-now lost its single-row auto visit binding');
assert(connect.includes('Open this patient from the exact scheduled visit'),
  'the fail-closed refusal for zero/ambiguous visit bindings must remain');
assert(connect.includes('patient_external_id||a.patientId))===trim(frozen.patientId)'),
  'auto visit binding must match by immutable patient id only');

console.log('PASS commercial hardening: retrying fail-closed calendar reads (exact + legacy), honest empty-device hydration, persistent patient/note mirror queues, and id-linked auto visit binding');
