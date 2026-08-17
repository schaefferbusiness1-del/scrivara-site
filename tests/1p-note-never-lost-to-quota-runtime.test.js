'use strict';

/* nq-1.0.0 - a finished note is never lost to a full device.
 *
 * upsertNote() used to call saveNotes() (a bare localStorage.setItem with no
 * try/catch, 1pScribeFlow.html:9464) BEFORE saveNoteToBackend(). On a device at
 * the storage ceiling the QuotaExceededError threw out of upsertNote, so the
 * encrypted server write that would have ACCEPTED the note never ran and the
 * doctor was told "Could not save this visit" about a note that then existed
 * nowhere. This drives the shipped upsertNote in a VM: nothing here touches a
 * browser, a server, or any real note text. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];

function extractFunction(source, name, file) {
  const anchor = '\nfunction ' + name + '(';
  const at = source.indexOf(anchor);
  assert(at >= 0, name + ' is missing from ' + file);
  let i = source.indexOf('{', at + anchor.length), depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  assert(depth === 0, name + ' did not brace-balance in ' + file);
  return source.slice(at + 1, i);
}

function quota() {
  const e = new Error('The quota has been exceeded.');
  e.name = 'QuotaExceededError';
  return e;
}

function harness(source, file, options) {
  options = options || {};
  const log = [];
  const toasts = [];
  const stored = [];
  const sandbox = {
    console, Promise, Date, JSON, Array, Object, String, Number,
    currentVisitAthenaBinding: null,
    currentView: 'history',
    currentNoteId: '',
    _athenaGuardBoundEditor() { return true; },
    getNotes() { return []; },
    attachVisitToPatient() { log.push('attach'); },
    activePatient() { return null; },
    getActivePtId() { return ''; },
    saveNotes(arr) {
      log.push('saveNotes');
      if (options.quota) throw quota();
      stored.push(arr.length);
    },
    saveNoteToBackend(rec) {
      log.push('saveNoteToBackend');
      if (options.backend === 'absent') return undefined;
      if (options.backend === 'throws') throw new Error('bridge exploded');
      if (options.backend === 'rejects') return Promise.reject(new Error('offline'));
      return Promise.resolve(options.backend || 'synced');
    },
    renderHistory() { log.push('renderHistory'); },
    updateNavCounts() { log.push('updateNavCounts'); },
    renderPatients() {}, renderProfile() {},
    toast(message, kind) { toasts.push({ message: String(message), kind: String(kind || '') }); }
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(source, 'upsertNote', file) + '\nthis.upsertNote = upsertNote;', sandbox);
  return { sandbox, log, toasts, stored };
}

const drain = () => new Promise((resolve) => setImmediate(resolve));

(async function main() {
  for (const file of SHELLS) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');

    /* the delimited block is present and the OLD order is gone */
    assert(source.indexOf('/* ===== nq-1.0.0') >= 0 && source.indexOf('/* ===== end nq-1.0.0 */') >= 0,
      'the nq-1.0.0 block is missing from ' + file);
    const body = extractFunction(source, 'upsertNote', file);
    assert(body.indexOf('saveNoteToBackend') < body.indexOf('saveNotes(arr)'),
      'upsertNote in ' + file + ' still writes the device copy before starting the server write');

    /* 1. healthy device: unchanged behaviour, both writes happen, no toast */
    {
      const h = harness(source, file, {});
      h.sandbox.upsertNote({ id: 'note-1', isDraft: false });
      await drain();
      assert.deepStrictEqual(h.log.filter(x => /save/.test(x)), ['saveNoteToBackend', 'saveNotes'],
        'the server write must start before the device write in ' + file);
      assert.deepStrictEqual(h.stored, [1], 'the device copy was not written on a healthy device');
      assert.strictEqual(h.toasts.length, 0, 'a healthy save produced a storage warning in ' + file);
      assert.strictEqual(h.sandbox.currentNoteId, 'note-1', 'the saved note did not become current');
      assert(h.log.indexOf('renderHistory') >= 0, 'the history was not re-rendered after a healthy save');
    }

    /* 2. FULL DEVICE, server accepted it: upsertNote must NOT throw, and the
     *    doctor must be told exactly where the note is. */
    {
      const h = harness(source, file, { quota: true, backend: 'synced' });
      h.sandbox.upsertNote({ id: 'note-2', isDraft: false });
      await drain(); await drain();
      assert(h.log.indexOf('saveNoteToBackend') >= 0, 'the server write never started on a full device');
      assert(h.log.indexOf('renderHistory') >= 0,
        'a quota failure still aborted upsertNote after the server write in ' + file);
      const messages = h.toasts.map(t => t.message).join(' | ');
      assert(/out of space/.test(messages), 'the doctor was not told the device is full: ' + messages);
      assert(/Saved to your MLS account, not this device/.test(messages),
        'the doctor was not told the note reached the account: ' + messages);
    }

    /* 3. FULL DEVICE and the account did NOT take it: never claim a backup. */
    for (const outcome of ['queued', 'declined']) {
      const h = harness(source, file, { quota: true, backend: outcome });
      h.sandbox.upsertNote({ id: 'note-3-' + outcome, isDraft: false });
      await drain(); await drain();
      const messages = h.toasts.map(t => t.message).join(' | ');
      assert(!/Saved to your MLS account, not this device/.test(messages),
        'a ' + outcome + ' server write was reported as saved to the account in ' + file + ': ' + messages);
      assert(/has NOT reached your MLS account/.test(messages),
        'a ' + outcome + ' server write was not surfaced honestly in ' + file + ': ' + messages);
      assert(/copy the note text/.test(messages),
        'the doctor was given no recovery instruction for an unsaved note in ' + file);
    }
    {
      const h = harness(source, file, { quota: true, backend: 'rejects' });
      h.sandbox.upsertNote({ id: 'note-3-rejects', isDraft: false });
      await drain(); await drain();
      const messages = h.toasts.map(t => t.message).join(' | ');
      assert(/has NOT reached your MLS account/.test(messages),
        'a rejected server write was not surfaced honestly in ' + file + ': ' + messages);
    }

    /* 4. FULL DEVICE with no server at all (device-only account): the failure
     *    must still reach the caller. Silence here would be the worst outcome:
     *    a "saved" toast over a note that exists nowhere. */
    for (const backend of ['absent', 'throws']) {
      const h = harness(source, file, { quota: true, backend });
      assert.throws(() => h.sandbox.upsertNote({ id: 'note-4-' + backend, isDraft: false }),
        /quota/i, 'a full device with no server copy (' + backend + ') silently swallowed the loss in ' + file);
      const messages = h.toasts.map(t => t.message).join(' | ');
      assert(!/Saved to your MLS account/.test(messages),
        'a device-only save claimed an account backup in ' + file + ': ' + messages);
    }
  }

  /* the two shells must carry byte-identical logic */
  const bodies = SHELLS.map((file) => extractFunction(fs.readFileSync(path.join(root, file), 'utf8'), 'upsertNote', file));
  assert.strictEqual(bodies[0], bodies[1], 'the two 1p shells carry different upsertNote bodies');

  console.log('PASS 1p note never lost to quota (nq-1.0.0, 2 shells x 8 cases)');
})().catch((error) => { console.error(error); process.exit(1); });
