'use strict';

/* AN AD-HOC VISIT WROTE ITSELF INTO A JULY HISTORY RECORD   (adhocid-1.0.0)
 * ============================================================================
 * OWNER, MEASURED LIVE 2026-09-11. He opened a patient by search - no
 * appointment, an ad-hoc encounter - recorded the visit, and the note was
 * auto-saved ON TOP OF a History record created in July. Not filed beside it:
 * into it. The old row's date stayed July, so the new work was not where he
 * went looking for it either.
 *
 * THE MECHANISM, traced through the shipped bytes.
 *   currentNoteId is the id of the History record being edited. It is set by
 *   loadRecordIntoEditor() (Continue this draft), read verbatim by
 *   noteRecordFromState(), and upsertNote()'s update branch replaces the row
 *   with that id and KEEPS its `created`. newVisit() nulls it - but a patient
 *   switch calls newVisit({patientSwitchReset:true}), which visitowner-1.0.0
 *   treats as an internal reset that PRESERVES the per-patient switch-back
 *   stash, and that stash carries `noteId`. restoreFor() put it straight back.
 *   So the next visit for that patient began life already pointing at an old
 *   row, and every save landed there.
 *
 * WHAT THIS SUITE PROVES, in a BOOTED page (no login, no network, synthetic
 * patient and synthetic text only):
 *
 *   1. RESTORE IS NOT REOPEN. A switch-back restore brings back every clinical
 *      byte and NO currentNoteId; the stashed id survives as provenance
 *      (window.__mlsContinuedFromNoteId -> rec.continuedFrom).
 *   2. THE SAVE MINTS A NEW ROW. The record written after that restore has a
 *      different id, `created` today, and the July record still holds its own
 *      transcript and its own `created`.
 *   3. HISTORY SHOWS IT FIRST. renderHistory()'s first row for that patient is
 *      the new record, not the July one.
 *   4. THE SECOND CURE WORKS ON ITS OWN. _mlsNoteIdStillOurs() is exercised
 *      directly: a continuing transcript KEEPS the id (an ordinary
 *      continue-this-draft save must still update the one row), a different
 *      visit MINTS one, and a record belonging to another patient MINTS one.
 *   5. NON-VACUITY. PART 4 puts the July id back by hand with a continuing
 *      transcript and proves the save DOES overwrite that row - i.e. the
 *      defect mechanism is live and reachable, and the two cures above are the
 *      only thing standing between it and the doctor.
 *   6. ONE VISIT IS STILL ONE ROW. PART 5 counts the other direction, which
 *      was MEASURED while writing this: dropping the restored id
 *      unconditionally cured the overwrite and produced a DUPLICATE History
 *      row for one visit (save, switch away, switch back, save again gave 2
 *      rows where b1232 gave 1). restoreFor re-adopts the id when this editor
 *      is still entitled to it by the same test, so the second save updates
 *      the one row - and the owner's July record, which fails that test, stays
 *      dropped.
 *
 * Run: node tests/1p-visitowner-adhoc-record-identity-runtime.test.js
 * ==========================================================================*/

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) {
  checks++;
  assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ')');
}

/* ==========================================================================
 * PART 1.  BOTH CANONICAL SHELLS CARRY THE SAME CURE
 * ======================================================================== */
const SHELLS = [['1pScribeFlow.html', read('1pScribeFlow.html')], ['1p/index.html', read(path.join('1p', 'index.html'))]];

for (const [label, src] of SHELLS) {
  /* The guard exists under the exact name noteRecordFromState feature-detects.
     noteRecordFromState calls it through a typeof check so a suite running that
     serializer in isolation still gets the shipped fail-open behaviour, and a
     typeof check is exactly how a misnamed handle becomes a silent no-op - so
     the name is pinned here, in both directions. */
  ok(src.indexOf('function _mlsNoteIdStillOurs(){') >= 0,
    label + ': _mlsNoteIdStillOurs is gone, so noteRecordFromState\'s typeof guard is a permanent no-op and any stale currentNoteId overwrites its record again');
  ok(/const _idOurs=\(typeof _mlsNoteIdStillOurs==='function'\)\?_mlsNoteIdStillOurs\(\):true;/.test(src),
    label + ': noteRecordFromState no longer asks whether it is entitled to the id it is about to overwrite');
  ok(/id: \(_idOurs\?currentNoteId:''\) \|\| \('n'\+Date\.now\(\)/.test(src),
    label + ': noteRecordFromState reuses currentNoteId unconditionally again');
  ok(src.indexOf('continuedFrom: _fromId,') >= 0,
    label + ': a minted record no longer records where it was continued from - the id would be silently discarded');
  ok(src.indexOf('function _mlsNoteTranscriptContinues(was,now){') >= 0,
    label + ': the continuation test is gone');
  ok(src.indexOf('function _mlsSetContinuedFromId(id){') >= 0,
    label + ': the provenance carrier is gone');

  /* The first cure: the switch-back restore hands back work, never a claim on
     a stored row. */
  ok(/safe\(function \(\) \{ if \(typeof currentNoteId !== 'undefined'\) currentNoteId = null; \}\);/.test(src),
    label + ': restoreFor restores currentNoteId from the stash again - this is the exact line that put an ad-hoc visit into a July record');
  ok(src.indexOf("_mlsSetContinuedFromId(str(d.noteId))") >= 0,
    label + ': restoreFor drops the stashed note id entirely instead of keeping it as provenance');
  ok(src.indexOf('currentNoteId = d.noteId || null') < 0,
    label + ': the old restore-the-id line is still present somewhere in the shell');
  /* ...and the other half: the id is re-adopted at the END of the restore
     when this editor is still entitled to it. Dropping it unconditionally
     cures the July overwrite and MEASURES a duplicate row in its place (save,
     switch away, switch back, save again = two rows for one visit), which is
     what PART 5 below counts. */
  ok(/currentNoteId = wasId;\n      if \(!_mlsNoteIdStillOurs\(\)\) currentNoteId = null;/.test(src),
    label + ': restoreFor no longer re-adopts an id this editor is still entitled to, so a save -> switch away -> switch back -> save mints a SECOND History row for one visit');
  ok(src.indexOf("if (typeof _mlsNoteIdStillOurs !== 'function') return;") >= 0,
    label + ': the re-adoption stopped failing closed - with the guard absent it would hand back an unchecked claim on a stored row');

  /* newVisit and loadRecordIntoEditor own the other two transitions. */
  ok(/currentNoteId=null;\n  _mlsSetContinuedFromId\(''\);/.test(src),
    label + ': a fresh visit no longer clears the continued-from provenance, so an unrelated record could inherit it');
  ok(/currentNoteId=n\.id;\n  _mlsSetContinuedFromId\(''\);/.test(src),
    label + ': opening a record no longer clears the continued-from provenance');

  /* The date a row wears and the place it sits are one number. */
  ok(src.indexOf('function _mlsNoteRecency(n){') >= 0,
    label + ': the one definition of "when did this visit last change" is gone');
  ok(src.indexOf('ordered=ordered.slice().sort(function(a,b){ return _mlsNoteRecency(b)-_mlsNoteRecency(a); });') >= 0,
    label + ': renderHistory no longer orders by the LATER of created/updated, so a row written today can sit under an old date');
  ok(src.indexOf('const d=new Date(_mlsNoteRecency(n)||Date.now());') >= 0,
    label + ': the History row label no longer uses the same number the list is ordered by');
}
{
  const a = SHELLS[0][1], b = SHELLS[1][1];
  const cut = (s) => s.slice(s.indexOf('/* ===== adhocid-1.0.0'), s.indexOf('function newVisit(opts){'));
  eq(cut(a), cut(b), 'the twins carry different adhocid-1.0.0 blocks');
}

/* ==========================================================================
 * PART 2.  THE BOOTED PAGE
 * ======================================================================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (rel === '/') rel = '/1pScribeFlow.html';
      const file = path.resolve(ROOT, '.' + rel);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(rel).toLowerCase()] || 'text/html; charset=utf-8' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* The exact id from the owner's own July record shape, and a July timestamp. */
const JULY_ID = 'n1784570529743lijx';
const JULY_TS = Date.UTC(2026, 6, 5, 15, 12, 0);          /* 2026-07-05 */
const JULY_TRANSCRIPT = 'Synthetic July encounter. Follow-up for right shoulder stiffness.';
const JULY_SOAP = 'S: Synthetic July subjective.\nO: Synthetic July objective.\nA: Synthetic July assessment.\nP: Synthetic July plan.';
const TODAY_TRANSCRIPT = 'Synthetic ad-hoc visit today. New complaint of left ankle swelling after a fall.';

(async () => {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
    await page.goto('http://127.0.0.1:' + port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'adhoc-identity@mlsscribe.test'; });
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const b = document.getElementById('appScreen'); if (b) b.style.display = '';
    });
    ok(await page.evaluate(() => !!(window.__mlsVisitOwner && window.__mlsVisitOwner.installed)),
      'visitowner-1.0.0 did not install on the booted shell - the restore path this suite is about never runs');

    /* ---- the world: two synthetic charts and one July record ----------- */
    const seeded = await page.evaluate(([julyId, julyTs, julyTranscript, julySoap]) => {
      savePatients([
        { id: 'syn-P', name: 'Pat Sample', dob: '1970-01-01', mrn: 'MRN-P-0001', notes: [], visits: [] },
        { id: 'syn-Q', name: 'Quinn Sample', dob: '1981-02-02', mrn: 'MRN-Q-0002', notes: [], visits: [] }
      ]);
      saveNotes([{
        id: julyId, patientId: 'syn-P', patient: 'Pat Sample', cc: 'Right shoulder stiffness',
        transcript: julyTranscript, soap: julySoap, noteProvenance: 'generated_soap',
        isDraft: false, signed: false, created: julyTs, updated: julyTs
      }]);
      return { patients: getPatients().length, notes: getNotes().length };
    }, [JULY_ID, JULY_TS, JULY_TRANSCRIPT, JULY_SOAP]);
    eq(seeded.patients, 2, 'the synthetic roster did not land');
    eq(seeded.notes, 1, 'the July record did not land');

    /* ---- arm the switch-back stash exactly as stashBeforeSwitch writes it */
    await page.evaluate(([julyId, txt]) => {
      selectPatient('syn-Q');
      const key = uns('visitDraftByPt');
      sessionStorage.setItem(key, JSON.stringify({
        'syn-P': {
          ptId: 'syn-P', ptName: 'Pat Sample',
          t: txt, box: '', soap: '', ins: '', fmt: 'soap',
          noteProvenance: 'typed', athenaNote: '', athenaNoteProvenance: 'none', athenaNoteSourceFingerprint: '',
          coding: null, emr: null, aiDraft: '', handout: '', context: '', comment: '',
          label: 'Pat Sample',
          /* THE POISON: written the last time the doctor left this chart with a
             History record open. */
          noteId: julyId,
          compromised: false,
          binding: {
            patient: { patientId: 'syn-P', name: 'Pat Sample', dob: '1970-01-01', mrn: 'MRN-P-0001' },
            source: 'saved-record', historical: false, identityConflict: false, routeBlocked: false,
            visitContext: { visitDate: '', provider: '', appointmentId: '', encounterId: '', encounterUrl: '' },
            noteTimestamp: null, displayDate: '', displayProvider: ''
          },
          ts: Date.now()
        }
      }));
      return true;
    }, [JULY_ID, TODAY_TRANSCRIPT]);
    await page.waitForTimeout(600);

    /* ---- the switch the owner made: back to that chart ----------------- */
    await page.evaluate(() => { selectPatient('syn-P'); showView('visit'); });
    await page.waitForTimeout(1500);

    /* Bare top-level `let`s are NOT on window in a classic script, so every
       probe below is a source expression evaluated in global scope. */
    const afterRestore = await page.evaluate(`({
      active: getActivePtId(),
      transcript: String((document.getElementById('transcript')||{}).value||''),
      noteId: (typeof currentNoteId === 'undefined') ? 'UNDEFINED' : currentNoteId,
      continuedFrom: String(window.__mlsContinuedFromNoteId || ''),
      restored: window.__mlsVisitOwner.restored
    })`);
    eq(afterRestore.active, 'syn-P', 'the switch back to the ad-hoc patient did not take');
    ok(afterRestore.restored >= 1, 'the per-patient switch-back stash never restored, so nothing below is measuring the reported path');
    eq(afterRestore.transcript, TODAY_TRANSCRIPT, 'the restore lost the doctor\'s unsaved transcript - clearing on switch must never mean losing');
    eq(afterRestore.noteId, null,
      'THE DEFECT: the restore handed back a claim on a stored History record. Anything saved now REPLACES that row and keeps its July `created`');
    eq(afterRestore.continuedFrom, JULY_ID,
      'the stashed note id was discarded instead of kept as provenance - where this work came from is now unrecoverable');

    /* ---- the save the owner made -------------------------------------- */
    const saved = await page.evaluate(`(function(){
      document.getElementById('noteBox').value = 'S: Synthetic today subjective.\\nO: Synthetic today objective.\\nA: Synthetic today assessment.\\nP: Synthetic today plan.';
      currentSoap = document.getElementById('noteBox').value;
      currentFormat = 'soap';
      var okSave = saveDraft();
      var notes = getNotes();
      return { okSave: okSave, ids: notes.map(function(n){ return n.id; }), notes: notes };
    })()`);
    ok(saved.okSave !== false, 'the save path refused outright, so this suite never reached the record it is about');
    eq(saved.notes.length, 2, 'the ad-hoc visit did not become its own History record');

    const july = saved.notes.find((n) => n.id === JULY_ID);
    const fresh = saved.notes.find((n) => n.id !== JULY_ID);
    ok(july, 'the July record is GONE - it was replaced rather than left alone');
    ok(fresh, 'no new record was written for the ad-hoc visit');
    ok(fresh.id !== JULY_ID, 'the ad-hoc visit reused the July record\'s id');
    eq(july.transcript, JULY_TRANSCRIPT, 'the July record\'s own transcript was overwritten by today\'s visit');
    eq(july.soap, JULY_SOAP, 'the July record\'s own note was overwritten by today\'s visit');
    eq(july.created, JULY_TS, 'the July record\'s created timestamp moved');
    eq(fresh.patientId, 'syn-P', 'the new record is not attached to the chart it was written in');
    eq(fresh.transcript, TODAY_TRANSCRIPT, 'the new record did not capture today\'s transcript');
    eq(fresh.continuedFrom, JULY_ID, 'the new record does not say which record this work was continued from');
    {
      const d = new Date(fresh.created), now = new Date();
      eq(d.toDateString(), now.toDateString(),
        'the new record was stamped with a day that is not today (' + d.toISOString() + ') - it will hide under an old date in History');
    }

    /* ---- History shows today's work first ------------------------------ */
    const rows = await page.evaluate(`(function(){
      renderHistory();
      var list = document.getElementById('histList');
      var items = list ? [].slice.call(list.querySelectorAll('.hist-item')) : [];
      return items.map(function(el){
        var m = /openNoteFromHistory\\('([^']+)'\\)/.exec(el.getAttribute('onclick') || '');
        var s = el.querySelector('.s');
        return { id: m ? m[1] : '', line: s ? s.textContent.trim().slice(0, 24) : '' };
      });
    })()`);
    ok(rows.length >= 2, 'History did not render both records (' + JSON.stringify(rows) + ')');
    eq(rows[0].id, fresh.id,
      'the July record is still the first row for this patient, so the work the doctor just did is hiding underneath it: ' + JSON.stringify(rows));
    ok(rows[0].line.indexOf(String(new Date().getFullYear())) >= 0 || /\d/.test(rows[0].line),
      'the first History row carries no date at all');

    /* ======================================================================
     * PART 3.  THE SECOND CURE, EXERCISED DIRECTLY
     * ==================================================================== */
    const guard = await page.evaluate(`(function(){
      var out = {};
      var tx = document.getElementById('transcript');
      var keep = currentNoteId;

      /* (a) the ordinary continue-this-draft save: same chart, the stored
             transcript with more dictation on the end -> KEEP the id */
      currentNoteId = ${JSON.stringify(JULY_ID)};
      tx.value = ${JSON.stringify(JULY_TRANSCRIPT)} + ' Additional dictation added today.';
      out.continued = _mlsNoteIdStillOurs();
      out.continuedRecordId = noteRecordFromState(false).id;

      /* (b) a different encounter entirely -> MINT */
      tx.value = ${JSON.stringify(TODAY_TRANSCRIPT)};
      out.different = _mlsNoteIdStillOurs();
      out.differentRecordId = noteRecordFromState(false).id;

      /* (c) whitespace-only reflow is NOT a different encounter */
      tx.value = ${JSON.stringify(JULY_TRANSCRIPT)}.replace(/ /g, '\\n  ');
      out.reflow = _mlsNoteIdStillOurs();

      /* (d) a record that belongs to another chart -> MINT */
      var arr = getNotes();
      arr.push({ id: 'n-other-chart', patientId: 'syn-Q', patient: 'Quinn Sample', transcript: '', soap: 'x', created: Date.now(), updated: Date.now() });
      saveNotes(arr);
      currentNoteId = 'n-other-chart';
      tx.value = '';
      out.otherChart = _mlsNoteIdStillOurs();
      out.otherChartRecordId = noteRecordFromState(false).id;

      /* (e) an id that names nothing on disk is never in the way */
      currentNoteId = 'n-not-stored-anywhere';
      out.unknown = _mlsNoteIdStillOurs();

      currentNoteId = keep;
      return out;
    })()`);
    eq(guard.continued, true,
      'an ordinary continue-this-draft save now mints a NEW row instead of updating the one the doctor is editing - the guard is too strong');
    eq(guard.continuedRecordId, JULY_ID, 'the continued save did not keep the record it is continuing');
    eq(guard.different, false,
      'a completely different encounter is still allowed to overwrite the stored record - the exact defect');
    ok(guard.differentRecordId !== JULY_ID, 'a different encounter still built a record carrying the stored id');
    eq(guard.reflow, true,
      'reformatting whitespace in the transcript is being read as a different visit, which would mint a duplicate row on every reflow');
    eq(guard.otherChart, false, 'a record belonging to another patient\'s chart can still be overwritten from this one');
    ok(guard.otherChartRecordId !== 'n-other-chart', 'the cross-chart save still built a record carrying the other chart\'s id');
    eq(guard.unknown, true, 'an id that names no stored record is being treated as a reason to mint - that is the fail-closed direction and it is wrong');

    /* ======================================================================
     * PART 4.  NON-VACUITY - the overwrite really is reachable
     * --------------------------------------------------------------------
     * Everything above says "the id is not reused". That only means something
     * if reusing it WOULD have overwritten the July row. Put the id back by
     * hand, with a transcript that genuinely continues the July visit (so the
     * guard is satisfied), and prove the save replaces that record in place -
     * same id, July `created` preserved, new bytes. This is the mechanism the
     * two cures stand in front of.
     * ==================================================================== */
    const overwrite = await page.evaluate(`(function(){
      currentNoteId = ${JSON.stringify(JULY_ID)};
      document.getElementById('transcript').value = ${JSON.stringify(JULY_TRANSCRIPT)} + ' Addendum dictated at the follow-up.';
      document.getElementById('noteBox').value = 'S: Synthetic addendum.\\nO: Synthetic addendum.\\nA: Synthetic addendum.\\nP: Synthetic addendum.';
      currentSoap = document.getElementById('noteBox').value;
      saveDraft();
      var n = getNotes().find(function(x){ return x.id === ${JSON.stringify(JULY_ID)}; });
      return { found: !!n, created: n ? n.created : 0, transcript: n ? n.transcript : '', count: getNotes().length };
    })()`);
    ok(overwrite.found, 'the control could not find the July record at all');
    eq(overwrite.created, JULY_TS, 'upsertNote stopped preserving `created` on an update - the control no longer models the reported defect');
    ok(overwrite.transcript.indexOf('Addendum dictated') >= 0,
      'reusing currentNoteId did NOT write into the stored record, so this suite is not measuring the mechanism it claims to guard');

    /* ======================================================================
     * PART 5.  ONE VISIT IS STILL ONE ROW
     * ----------------------------------------------------------------------
     * The cure above must not trade an overwrite for a duplicate. MEASURED in
     * this same booted page while writing it: dropping the restored id
     * UNCONDITIONALLY made an ordinary save -> switch away -> switch back ->
     * save again produce TWO History rows for one visit (1 before the change,
     * 2 after). A duplicate chart row is its own patient-safety problem - the
     * app carries a banner and a cleanup pass for exactly that - so restoreFor
     * re-adopts the id when, with the transcript and the patient back in
     * place, this editor is still entitled to it. The owner's July record
     * fails that same test and stays dropped; this visit passes it.
     * ==================================================================== */
    const resave = await page.evaluate(`(function(){
      /* a fresh, properly bound visit for the other chart */
      newVisit();
      selectPatient('syn-Q');
      return true;
    })()`);
    ok(resave === true, 'the second scenario could not start');
    /* PART 3 seeded one bare row on this chart to exercise the cross-chart
       refusal; it is not part of this count. */
    await page.waitForTimeout(800);
    const firstSave = await page.evaluate(`(function(){
      _athenaSetVisitBinding(_athenaFreezeVisitBinding(
        { patientId: 'syn-Q', name: 'Quinn Sample', dob: '1981-02-02', mrn: 'MRN-Q-0002' },
        { source: 'capture', visitContext: { visitDate: '', provider: '', appointmentId: '', encounterId: '', encounterUrl: '' } }), true);
      document.getElementById('transcript').value = 'Synthetic visit for Quinn. Cough for three days.';
      document.getElementById('noteBox').value = 'S: syn q.\\nO: syn q.\\nA: syn q.\\nP: syn q.';
      currentSoap = document.getElementById('noteBox').value;
      currentFormat = 'soap';
      var okSave = saveDraft();
      return { okSave: okSave, noteId: currentNoteId, rows: getNotes().filter(function(n){ return n.patientId === 'syn-Q' && n.id !== 'n-other-chart'; }).length };
    })()`);
    ok(firstSave.okSave !== false, 'the first save of the second scenario was refused');
    eq(firstSave.rows, 1, 'the first save did not produce exactly one row for that chart');
    ok(!!firstSave.noteId, 'the first save left no open record id at all');

    await page.evaluate(() => { selectPatient('syn-P'); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { selectPatient('syn-Q'); });
    await page.waitForTimeout(1500);
    const backAgain = await page.evaluate(`({
      noteId: (typeof currentNoteId === 'undefined') ? 'UNDEFINED' : currentNoteId,
      continuedFrom: String(window.__mlsContinuedFromNoteId || ''),
      transcript: String((document.getElementById('transcript')||{}).value||'')
    })`);
    eq(backAgain.noteId, firstSave.noteId,
      'the switch-back dropped an id this editor IS entitled to (same chart, the stored transcript unchanged) - the next save will mint a duplicate row for one visit');
    eq(backAgain.continuedFrom, '',
      'a re-adopted record is being labelled as continued from itself');

    const secondSave = await page.evaluate(`(function(){
      document.getElementById('transcript').value = String(document.getElementById('transcript').value || '') + ' Added after coming back.';
      document.getElementById('noteBox').value = 'S: syn q revised.\\nO: syn q.\\nA: syn q.\\nP: syn q.';
      currentSoap = document.getElementById('noteBox').value;
      var okSave = saveDraft();
      var mine = getNotes().filter(function(n){ return n.patientId === 'syn-Q' && n.id !== 'n-other-chart'; });
      return { okSave: okSave, rows: mine.length, ids: mine.map(function(n){ return n.id; }), transcript: mine[0] ? mine[0].transcript : '' };
    })()`);
    ok(secondSave.okSave !== false, 'the second save of the second scenario was refused');
    eq(secondSave.rows, 1,
      'one visit became ' + secondSave.rows + ' History rows after a switch away and back: ' + JSON.stringify(secondSave.ids));
    ok(secondSave.transcript.indexOf('Added after coming back') >= 0,
      'the re-save did not reach the one row it belongs to');

    ok(pageErrors.length === 0, 'the booted shell raised page errors: ' + JSON.stringify(pageErrors.slice(0, 4)));
  } finally {
    await browser.close();
    srv.close();
  }

  console.log('PASS 1p visitowner ad-hoc record identity: ' + checks + ' checks - a switch-back restore hands back every clinical byte and NO claim on a stored History row (the stashed id survives only as rec.continuedFrom); the ad-hoc save mints its own record, created today, leaving the July record\'s transcript, note and created untouched, and History lists the new one first; the entitlement guard keeps the id for a continued draft and for a whitespace reflow, mints for a different encounter and for another patient\'s chart, and never mints for an id that names nothing; and the overwrite it prevents is proved reachable by putting that id back by hand. One visit is still ONE row: a save, a switch away and a switch back re-adopt the id this editor is entitled to, so the next save updates that row instead of minting a duplicate');
})().catch((err) => { console.error(err); process.exit(1); });
