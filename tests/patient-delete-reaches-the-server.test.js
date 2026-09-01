'use strict';

/* ptdel-1.0.0 (2026-08-28) — a deleted patient came back.
 *
 * deletePatientOnServer used to bail out silently whenever _serverPtIds did not
 * already hold the patient's server id:
 *
 *     const sid=_serverPtIds[externalId];
 *     if(!sid) return;               // no server id known - skip (don't error)
 *
 * _serverPtIds is a bare in-memory object, EMPTY on every page load until a boot
 * hydration finishes, and hydration is deliberately deferred behind user-input
 * quiet windows. So the ORDINARY case - open MLS, go to Patients, delete a row in
 * the first seconds - never issued a DELETE at all. The row vanished locally, the
 * toast said "Patient deleted.", and the next hydration re-added it verbatim. The
 * sign-out purge makes that certain rather than merely possible, because logout
 * wipes the local store and rebuilds it from /api/patients.
 *
 * These are PROPERTIES, executed against the real lifted functions with a stub
 * fetch, not greps:
 *   1. an unknown server id must still result in a DELETE being issued
 *   2. the DELETE must target the id resolved from the server list
 *   3. 404 counts as success (the row is gone - that was the goal)
 *   4. a genuine failure must NOT report success, or the caller lies to the doctor
 *   5. the caller must AWAIT the verdict rather than fire-and-forget
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];

function lift(src, name, kw) {
  const decl = (kw || 'async function ') + name + '(';
  const i = src.indexOf(decl);
  assert.ok(i >= 0, 'missing ' + name);
  const j = src.indexOf('{', i);
  let d = 0, e = -1;
  for (let k = j; k < src.length; k++) {
    const c = src[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced ' + name);
  return src.slice(i, e);
}

function build(src, opts) {
  const calls = [];
  const env = {
    backendMode: () => true,
    bkToken: () => 'tok',
    bkBase: () => 'https://api.test',
    handle401: () => { calls.push({ kind: '401' }); },
    _serverPtIds: Object.assign({}, opts.serverIds || {}),
    fetch: async (url, init) => {
      calls.push({ url: String(url), method: (init && init.method) || 'GET' });
      if (String(url).endsWith('/api/patients')) return opts.list;
      return opts.del;
    }
  };
  /* 2026-08-31: THIS SUITE HAD NOT RUN SINCE b1130. ptdel-1.3.0 split the
     resolver in two - _ptResolveServerIdEx became the real tri-state lookup and
     _ptResolveServerId stayed as a thin wrapper over it - and deletePatientOnServer
     was repointed at the Ex form. This build() still lifted only the wrapper, so
     every case below died on `_ptResolveServerIdEx is not defined` before a
     single assertion ran: a ReferenceError, not a failure, which is how the
     whole server-DELETE honesty contract went untested across four shells while
     the file still sat in the suite list. Lift the function the subject actually
     calls. No assertion below is changed or relaxed. */
  const body = lift(src, '_ptResolveServerIdEx') + '\n' + lift(src, '_ptResolveServerId') + '\n' +
    lift(src, 'deletePatientOnServer') +
    '\nreturn { del: deletePatientOnServer, ids: _serverPtIds };';
  const fn = new Function('backendMode', 'bkToken', 'bkBase', 'handle401', '_serverPtIds', 'fetch', body);
  const api = fn(env.backendMode, env.bkToken, env.bkBase, env.handle401, env._serverPtIds, env.fetch);
  return { api, calls, ids: env._serverPtIds };
}

const okList = { ok: true, status: 200, json: async () => ([{ external_id: 'ext-1', id: 55 }, { external_id: 'ext-2', id: 77 }]) };

(async function run() {
  for (const shell of SHELLS) {
    const file = path.join(root, shell);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'latin1');

    /* 1+2. THE BUG: server id unknown. A DELETE must still be issued, against the
       id resolved from the server list. */
    {
      const t = build(src, { serverIds: {}, list: okList, del: { ok: true, status: 200 } });
      const v = await t.api.del('ext-1');
      ok(v && v.ok, shell + ': delete with an unknown server id did not report success');
      const deletes = t.calls.filter(c => c.method === 'DELETE');
      eq(deletes.length, 1,
        shell + ': NO DELETE was issued when the server id was unknown - this is the original bug, ' +
        'the patient is removed locally and resurrects on the next hydration');
      ok(/\/api\/patients\/55$/.test(deletes[0].url),
        shell + ': the DELETE did not target the id resolved from the server list (got ' + deletes[0].url + ')');
    }

    /* 3. 404 is success - the row is gone, which is what we wanted. */
    {
      const t = build(src, { serverIds: { 'ext-1': 55 }, list: okList, del: { ok: false, status: 404 } });
      const v = await t.api.del('ext-1');
      ok(v && v.ok, shell + ': a 404 on delete was treated as failure, but the row is already gone');
    }

    /* 4. A REAL failure must not claim success. */
    for (const status of [500, 403, 429]) {
      const t = build(src, { serverIds: { 'ext-1': 55 }, list: okList, del: { ok: false, status: status } });
      const v = await t.api.del('ext-1');
      eq(v.ok, false,
        shell + ': HTTP ' + status + ' on the server delete reported SUCCESS - the doctor would be ' +
        'told the patient was deleted while the account copy survives');
    }

    /* a 401 must not silently look like success either */
    {
      const t = build(src, { serverIds: { 'ext-1': 55 }, list: okList, del: { ok: false, status: 401 } });
      const v = await t.api.del('ext-1');
      eq(v.ok, false, shell + ': a signed-out delete reported success');
    }

    /* when the server list cannot be read, we must NOT claim the row is gone */
    {
      const t = build(src, { serverIds: {}, list: { ok: false, status: 500, json: async () => ({}) }, del: { ok: true, status: 200 } });
      const v = await t.api.del('ext-1');
      ok(!v.ok || v.reason === 'no-server-row',
        shell + ': an unreadable server list produced an unqualified success');
    }

    /* 5. the CALLER must await the verdict and must not toast success unconditionally */
    const delFn = lift(src, 'deletePatient');
    /* ptfix-1.0.0 (b1169): deletePatient now delegates the "what goes WITH the
       record" half of the dialog to a named helper, so the lifted body needs it
       in scope. It is LIFTED, not stubbed - the sentence the doctor actually
       reads is exactly what the assertions below execute against. */
    const delDeps = lift(src, '_mlsPtDeleteLossSentence', 'function ') + '\n';
    ok(/await\s+deletePatientOnServer\(/.test(delFn),
      shell + ': deletePatient does not AWAIT the server delete - its outcome cannot affect what ' +
      'the doctor is told');
    ok(!/^\s*toast\('Patient deleted\.',''\);\s*$/m.test(delFn),
      shell + ': deletePatient still toasts success unconditionally');
    ok(/_delVerdict\s*&&\s*_delVerdict\.ok/.test(delFn),
      shell + ': the success toast is not gated on the server verdict');
    /* the local removal must still be additive-safe */
    ok(/allowRemovals\s*:\s*true/.test(delFn),
      shell + ': the local delete lost {allowRemovals:true} and would silently no-op');

    /* ptdel-1.1.0: the dialog must not promise more than the delete delivers.
       A chart that came off an Athena schedule WILL come back when that day is
       pulled again - the appointment is still real and the importer mints ids
       deterministically - so "This cannot be undone" is a false promise there.
       EXECUTED: run deletePatient and read the sentence it actually asked. */
    async function askedWhenDeleting(patient, appts) {
      let asked = '';
      const fn = new Function(
        'mlsConfirm', 'findPatient', 'savePatients', 'getPatients', 'backendMode', 'bkToken',
        'deletePatientOnServer', 'getNotes', 'saveNotes', 'getActivePtId', 'setActivePtId',
        'renderPatients', 'renderProfile', 'renderPatientBar', 'toast', 'window',
        delDeps + delFn + '\nreturn deletePatient;'
      )(
        m => { asked = String(m); return Promise.resolve(false); },  /* decline: nothing mutates */
        () => patient,
        () => {}, () => [], () => false, () => '',
        async () => ({ ok: true }), () => [], () => {}, () => '', () => {},
        () => {}, () => {}, () => {}, () => {},
        { _calAppts: appts || [] }
      );
      await fn('pt-1');
      return asked;
    }

    const scheduled = await askedWhenDeleting({ id: 'pt-1', source: 'athena-schedule' }, []);
    ok(/pulling that day/i.test(scheduled),
      shell + ': deleting a SCHEDULE-imported chart does not warn that pulling that day again ' +
      're-creates it - the dialog promises a permanence the delete cannot deliver');
    ok(!/cannot be undone/i.test(scheduled),
      shell + ': a schedule-imported chart is still told the delete "cannot be undone", which is ' +
      'false - it returns on the next pull of that day');

    const byAppt = await askedWhenDeleting({ id: 'pt-1' }, [{ patient_external_id: 'pt-1' }]);
    ok(/pulling that day/i.test(byAppt),
      shell + ': a chart with an appointment on the schedule is not warned about re-import');

    const plain = await askedWhenDeleting({ id: 'pt-1' }, [{ patient_external_id: 'someone-else' }]);
    ok(/cannot be undone/i.test(plain),
      shell + ': a chart with NO appointment lost the honest permanence warning');
    ok(!/pulling that day/i.test(plain),
      shell + ': a chart with no appointment is wrongly told a pull will bring it back');

    /* declining must change nothing at all */
    ok(/^\s*if\(!await mlsConfirm\(_delMsg\)\) return;/m.test(delFn) || /mlsConfirm\(_delMsg\)\) return;/.test(delFn),
      shell + ': declining the delete dialog does not abort before any mutation');

    /* ptdel-1.2.0: the dialog promises the notes "stay in History but become
       unassigned". saveNotes() writes localStorage ONLY while notes themselves
       sync through /api/records, so on any OTHER device the note came back still
       bound to the deleted patient. EXECUTED with a CONFIRMING stub so the
       mutation really runs. */
    async function deleteAndWatch(notes) {
      const queued = [];
      let retried = 0, saved = null;
      const fn = new Function(
        'mlsConfirm', 'findPatient', 'savePatients', 'getPatients', 'backendMode', 'bkToken',
        'deletePatientOnServer', 'getNotes', 'saveNotes', 'getActivePtId', 'setActivePtId',
        'renderPatients', 'renderProfile', 'renderPatientBar', 'toast', 'window',
        '_pendingBackupAdd', '_retryPendingBackups',
        delDeps + delFn + '\nreturn deletePatient;'
      )(
        () => Promise.resolve(true),               /* CONFIRM - let it mutate */
        () => ({ id: 'pt-1' }),
        () => {}, () => [], () => true, () => 'tok',
        async () => ({ ok: true, reason: 'deleted' }),
        () => notes, a => { saved = a; }, () => '', () => {},
        () => {}, () => {}, () => {}, () => {},
        { _calAppts: [] },
        id => queued.push(id), () => { retried++; }
      );
      await fn('pt-1');
      return { queued, retried, saved };
    }

    {
      const notes = [
        { id: 'n1', patientId: 'pt-1' },
        { id: 'n2', patientId: 'pt-1' },
        { id: 'n3', patientId: 'other' }
      ];
      const r = await deleteAndWatch(notes);
      eq(notes[0].patientId, '', shell + ': the deleted patient\'s note was not unassigned');
      eq(notes[2].patientId, 'other', shell + ': ANOTHER patient\'s note was unassigned by this delete');
      ok(notes[0].updated > 0,
        shell + ': the unassigned note\'s updated stamp was not bumped, so a stale server copy can ' +
        'win and re-bind it to the deleted patient');
      assert.deepStrictEqual(r.queued.slice().sort(), ['n1', 'n2'],
        shell + ': the unassigned notes were NOT queued for server sync - saveNotes writes ' +
        'localStorage only, so on another device they come back bound to the deleted patient');
      ok(r.retried > 0, shell + ': the pending-backup flush was never kicked, so the fix waits for a ' +
        'later unrelated event');
      ok(r.saved && r.saved.length === 3, shell + ': saveNotes was not called with the full note list');
    }

    /* nothing to unassign must not queue or flush anything */
    {
      const r = await deleteAndWatch([{ id: 'n9', patientId: 'someone-else' }]);
      eq(r.queued.length, 0, shell + ': a delete with no matching notes still queued a sync');
    }
  }

  console.log('PASS patient-delete-reaches-the-server: ' + checks + ' checks - an unknown server id ' +
    'still issues a DELETE against the resolved id, 404 counts as gone, real failures never report ' +
    'success, and the caller awaits the verdict before telling the doctor anything');
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
