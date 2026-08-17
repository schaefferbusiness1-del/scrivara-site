'use strict';

/* /1p VISIT OWNERSHIP — ONE VISIT BELONGS TO ONE PATIENT
 *
 * Owner, 2026-08-17: "on the cloned site the visit page has a problem: once you
 * generate a note and switch patients it keeps the generated note."
 *
 * WHAT WAS ACTUALLY WRONG (measured on origin/main's shell, and re-measured
 * here every run by PART 3 below). newVisit() — which the patient-switch fix
 * calls after the switch lands — clears #transcript, #noteBox, currentSoap and
 * currentCoding, but NOT:
 *     #handoutBody  the after-visit summary textarea
 *     #emrTable     chief complaint / diagnoses / meds / orders / follow-up
 *     #codeCard     the ICD-10 and CPT chips
 *     lastEMR       the structured EMR object
 *     lastAIDraft   the AI's original draft
 * so with the SECOND patient active, noteRecordFromState() — the single record
 * builder behind saveDraft, saveCurrentNote, signNote and saveNoteToBackend —
 * returned patientId "syn-B" carrying "syn-A"'s chief complaint, EMR block and
 * patient handout. A record stamped for one patient holding another patient's
 * chart data is the cross-patient-contamination class, not a cosmetic bug.
 *
 * FOUR PROPERTIES, each with the failing surface named in its message:
 *   (a) generate for A, switch to B  -> no visit surface and no record built
 *       for B contains a single token of A's note.
 *   (b) switch back to A             -> A's unsaved work comes back. Clearing
 *       must not mean losing; a per-patient stash is the difference.
 *   (c) a write whose editor owner is not the active patient is REFUSED by
 *       every save/sign/copy/send entry point, with a toast, and writes
 *       nothing.
 *   (d) the patient banner is EMPTY until a patient is chosen (owner, same
 *       day: "when you first log into the app the top patient banner should be
 *       blank. no patient."), survives a same-tab reload on the same day, and
 *       is empty again after a sign-out / sign-in.
 *
 * PART 3 is the causal control: the same probe against origin/main's shell
 * bytes must SHOW the leak. A green PART 2 with a green PART 3 would mean the
 * probe stopped measuring, not that the bug was fixed.
 *
 * No login, no network, no PHI: two synthetic patients and the generator's own
 * offline-example branch, which runs the real showNote / renderCoding /
 * populateEMR / autoFillVisitComment write path with no API key.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ======================================================== PART 1: static */

const OPEN = '<!-- ===== visitowner-1.0.0';
const CLOSE = '<!-- ===== end visitowner-1.0.0';

for (const name of SHELLS) {
  const src = read(name);
  eq(src.split(OPEN).length - 1, 1, `${name}: ${OPEN} must open exactly once`);
  eq(src.split(CLOSE).length - 1, 1, `${name}: ${CLOSE} must close exactly once`);
  ok(src.indexOf(OPEN) < src.indexOf(CLOSE), `${name}: visitowner-1.0.0 closes before it opens`);

  const span = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));
  /* LANE NEUTRALITY — a block that names this lane cannot be promoted. */
  ok(!/__MLS_P1_PREVIEW/.test(span), `${name}: visitowner-1.0.0 references __MLS_P1_PREVIEW and cannot be promoted`);
  ok(!/\b1p-[\w.-]*\.js\b/.test(span), `${name}: visitowner-1.0.0 references a 1p-prefixed file and cannot be promoted`);
  ok(!/1pScribeFlow\.html/.test(span), `${name}: visitowner-1.0.0 references the 1p shell by name`);
  ok(!/['"]\/1p\//.test(span), `${name}: visitowner-1.0.0 references the /1p route`);

  /* The block must not blank a CONTAINER: #revEstBox holds #revEstTotal and
     #revEstBreak, and blanking it made renderRevenueEstimate() throw and kill
     generateNote() mid-run. Both halves of that lesson are pinned. */
  ok(/children && [a-z]+\.children\.length/.test(span) || span.indexOf('.children && ') >= 0,
    `${name}: visitowner-1.0.0 lost the refusal to blank a node that still has element children`);
  ok(span.indexOf("'revEstBox'") < 0,
    `${name}: visitowner-1.0.0 blanks #revEstBox again — that deletes #revEstTotal/#revEstBreak and renderRevenueEstimate() throws`);
  ok(span.indexOf("'code_icd'") >= 0 && span.indexOf("'code_cpt'") >= 0,
    `${name}: visitowner-1.0.0 stopped clearing the ICD/CPT chip strips`);

  /* Escape-bearing literals are authored, not shell-transported. This block
     deliberately carries no regex literal at all. */
  const blockLines = span.split('\n');
  blockLines.forEach((line, i) => {
    ok(!/[^\\\w]d\+/.test(line) && !/\/\^?d\{[0-9]/.test(line),
      `${name}: visitowner-1.0.0 line ${i + 1} looks like a lost-backslash regex: ${line.trim().slice(0, 120)}`);
  });
}

/* the twins carry a byte-identical block */
{
  const a = read('1pScribeFlow.html');
  const b = read('1p/index.html');
  const sliceOf = (s) => s.slice(s.indexOf(OPEN), s.indexOf(CLOSE) + CLOSE.length);
  eq(sliceOf(a), sliceOf(b), 'the twins carry different visitowner-1.0.0 blocks');
}

/* ======================================================= PART 2: runtime */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* One server for both parts. /baseline.html serves origin/main's shell bytes
   from a temp file; every other path serves this worktree, so the baseline
   loads the same unchanged modules the real shell does. */
function serve(baselineFile) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = (p === '/baseline.html') ? baselineFile : path.resolve(root, '.' + p);
      if (file !== baselineFile && !file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(p).toLowerCase()] || 'text/html; charset=utf-8' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Distinctive tokens from the offline example note. Any of these appearing on a
   surface while the OTHER patient is active is the defect. */
const TOKENS = ['doxycycline', 'Persistent cough', 'cute bronchitis', 'Ada Sample'];

/* Built as source so the visit globals are read as BARE identifiers: they are
   top-level `let` in a classic script, which does NOT put them on window — a
   window[name] probe returns undefined for every one and reports a clean app. */
const GLOBALS = ['currentSoap', 'currentInsurance', 'currentCoding', 'lastEMR', 'lastAIDraft',
  'currentAVS', 'currentReferral', 'currentHandout', 'currentChartSummary', 'currentIME',
  'currentRecs', 'currentOrders', 'currentPriorAuth', 'currentRedFlags', 'currentDdx',
  'currentProcNote', 'currentMips', 'finalText'];
const VALUE_IDS = ['noteBox', 'transcript', 'patientLabel', 'contextBox', 'visitComment',
  'handoutBody', 'paLetter', 'procNoteBody', 'fhirBody'];
const TEXT_IDS = ['emrTable', 'codeCard', 'optCard', 'avsBody', 'refBody', 'imeBody', 'billBody',
  'redflagBody', 'ddxBody', 'surgPlanBody', 'mipsBody', 'teachBody', 'revToolsOut', 'dsOut',
  'signLine', 'recsContent', 'revEstBox'];

function scanSource() {
  const g = GLOBALS.map((k) =>
    `try{look('global.${k}', typeof ${k}==='undefined'?null:(typeof ${k}==='string'?${k}:JSON.stringify(${k})));}catch(e){}`).join('\n');
  return `(function(TOK){
  var hits=[];
  function look(where,text){ if(text==null) return; var s=String(text);
    for(var i=0;i<TOK.length;i++){ var ix=s.indexOf(TOK[i]); if(ix>=0){ hits.push({at:where,tok:TOK[i],len:s.length}); return; } } }
  ${JSON.stringify(VALUE_IDS)}.forEach(function(id){ var e=document.getElementById(id); if(e) look('value#'+id, e.value); });
  ${JSON.stringify(TEXT_IDS)}.forEach(function(id){ var e=document.getElementById(id); if(e) look('text#'+id, e.textContent); });
  ${g}
  try{
    var r = noteRecordFromState(false);
    look('record.cc', r.cc); look('record.soap', r.soap); look('record.insurance', r.insurance);
    look('record.handout', r.handout); look('record.transcript', r.transcript);
    look('record.emr', r.emr?JSON.stringify(r.emr):null);
    look('record.coding', r.coding?JSON.stringify(r.coding):null);
    look('record.avs', r.avs); look('record.referral', r.referral); look('record.ime', r.ime);
    look('record.context', r.context); look('record.procNote', r.procNote);
  }catch(e){ hits.push({at:'record.THREW:'+String(e&&e.message).slice(0,60),tok:'',len:0}); }
  return hits;
})`;
}

/* Injected: synthetic roster + the real generator's offline branch. */
function harness() {
  window.__toasts = [];
  var realToast = window.toast;
  window.toast = function (m, k) {
    window.__toasts.push([String(m).slice(0, 200), String(k || '')]);
    try { return realToast.apply(this, arguments); } catch (e) { return null; }
  };
  window.__vo = {
    seed: function () {
      savePatients([
        { id: 'syn-A', name: 'Ada Sample', dob: '1970-01-01', mrn: 'MRN100001', athenaId: '900001', notes: [], visits: [] },
        { id: 'syn-B', name: 'Bo Sample', dob: '1981-02-02', mrn: 'MRN100002', athenaId: '900002', notes: [], visits: [] }
      ]);
      return getPatients().length;
    },
    /* The generator's own no-key branch: same showNote / renderCoding /
       populateEMR / autoFillVisitComment path, zero network. */
    generateForActive: async function () {
      window.hasAI = function () { return false; };
      document.getElementById('transcript').value = EXAMPLE;
      finalText = EXAMPLE;
      var okGen = await generateNote();
      /* the handout the doctor then presses for; filled the app's own way */
      var hb = document.getElementById('handoutBody');
      if (hb && !hb.value) {
        currentHandout = 'AFTER-VISIT SUMMARY for Ada Sample: acute bronchitis. Take doxycycline as prescribed.';
        hb.value = currentHandout;
        var hc = document.getElementById('handoutCard'); if (hc) hc.style.display = 'block';
      }
      return { ok: okGen, soapLen: currentSoap.length, cc: lastEMR && lastEMR.cc };
    },
    noteBox: function () { return String((document.getElementById('noteBox') || {}).value || ''); },
    transcript: function () { return String((document.getElementById('transcript') || {}).value || ''); },
    notesFor: function (pid) {
      return (getNotes() || []).filter(function (n) { return String(n.patientId || '') === String(pid); })
        .map(function (n) { return { id: n.id, patient: n.patient, soapLen: (n.soap || '').length, cc: n.cc }; });
    },
    toasts: function () { var t = window.__toasts.slice(); window.__toasts = []; return t; }
  };
}

async function bootShell(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'visit-owner@mlsscribe.test'; });
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
  });
  await page.evaluate(harness);
}

/* Generate for A, switch to B, and report every surface still holding A. */
async function leakAfterSwitch(page) {
  await page.evaluate(() => { selectPatient('syn-A'); showView('visit'); });
  await page.waitForTimeout(300);
  const gen = await page.evaluate(() => window.__vo.generateForActive());
  await page.waitForTimeout(700);
  await page.evaluate(() => { selectPatient('syn-B'); });
  await page.waitForTimeout(1200);
  const hits = await page.evaluate(`(${scanSource()})(${JSON.stringify(TOKENS)})`);
  return { gen, hits };
}

async function runtime() {
  /* origin/main's shell bytes, for PART 3 */
  const baselineFile = path.join(os.tmpdir(), 'mls-visitowner-baseline-' + process.pid + '.html');
  const baseline = execFileSync('git', ['show', 'origin/main:1pScribeFlow.html'], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(baselineFile, baseline);

  const { srv, port } = await serve(baselineFile);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await bootShell(page, `http://127.0.0.1:${port}/1pScribeFlow.html`);

    ok(await page.evaluate(() => !!(window.__mlsVisitOwner && window.__mlsVisitOwner.installed)),
      'visitowner-1.0.0 did not install on the real shell');
    eq(await page.evaluate(() => window.__vo.seed()), 2, 'the synthetic roster did not land');

    /* ---- (a) A's note must not survive the switch to B ---------------- */
    const a = await leakAfterSwitch(page);
    ok(a.gen.ok === true && a.gen.soapLen > 500,
      `the generator did not produce a note to leak (ok=${a.gen.ok} soapLen=${a.gen.soapLen}) — this test would pass vacuously`);
    ok(String(a.gen.cc || '').indexOf('Persistent cough') >= 0,
      `the generator did not populate lastEMR, so the EMR half of this test is vacuous (cc=${JSON.stringify(a.gen.cc)})`);
    eq(a.hits.length, 0,
      'after switching from Ada Sample to Bo Sample these surfaces still hold Ada\'s note — a record built now would carry another patient\'s chart data: '
      + JSON.stringify(a.hits.map((h) => h.at + ' (' + h.tok + ')')));

    /* ---- (b) switching back must give Ada her work back --------------- */
    await page.evaluate(() => { selectPatient('syn-A'); });
    await page.waitForTimeout(1200);
    const back = await page.evaluate(() => ({
      active: getActivePtId(),
      noteBox: window.__vo.noteBox(),
      transcript: window.__vo.transcript(),
      restored: window.__mlsVisitOwner.restored,
      owner: window.__mlsVisitOwner.editorOwnerId()
    }));
    eq(back.active, 'syn-A', 'the switch back to Ada did not take');
    ok(back.noteBox.indexOf('doxycycline') >= 0,
      `switching back to Ada left her generated note gone (note box holds ${back.noteBox.length} chars) — clearing on switch must not mean losing`);
    ok(back.transcript.indexOf('cough') >= 0, 'switching back to Ada did not bring her transcript back');
    ok(back.restored >= 1, 'the per-patient draft slot never fired');
    eq(back.owner, 'syn-A', 'the restored editor is not owned by Ada');

    /* and Bo, whose chart the note passed through, holds none of it */
    const bosNotes = await page.evaluate(() => window.__vo.notesFor('syn-B'));
    eq(bosNotes.length, 0, `Bo Sample ended up with saved notes he never had: ${JSON.stringify(bosNotes)}`);

    /* NON-INTERFERENCE. The owner gate must not break the legitimate save the
       switch fix performs while the OUTGOING patient is still active — a guard
       that refuses everything would satisfy (a) and (c) and lose the work. */
    const adasNotes = await page.evaluate(() => window.__vo.notesFor('syn-A'));
    eq(adasNotes.length, 1, `Ada's work was not preserved to her own chart on the switch: ${JSON.stringify(adasNotes)}`);
    ok(adasNotes[0].soapLen > 500, `Ada's preserved record has only ${adasNotes[0].soapLen} chars of note`);
    ok(String(adasNotes[0].cc || '').indexOf('Persistent cough') >= 0,
      `Ada's preserved record lost her own chief complaint: ${JSON.stringify(adasNotes[0].cc)}`);

    /* ---- (c) a mismatched-owner write is refused everywhere ----------- */
    const refusals = await page.evaluate(() => {
      /* Ada's note is in the editor and owned by Ada. Move the active patient
         underneath it WITHOUT the reset path, which is exactly the state any
         future caller that forgets to reset would produce. */
      localStorage.setItem(uns('activePt'), 'syn-B');
      var out = { owner: window.__mlsVisitOwner.editorOwnerId(), active: getActivePtId(), before: (getNotes() || []).length };
      window.__toasts = [];
      out.saveDraft = (function () { try { return saveDraft(); } catch (e) { return 'THREW'; } })();
      out.saveCurrentNote = (function () { try { return saveCurrentNote(true); } catch (e) { return 'THREW'; } })();
      out.copyForEMR = (function () { try { return copyForEMR(); } catch (e) { return 'THREW'; } })();
      out.pushToAthena = (function () { try { return pushEntireVisitToAthena(null); } catch (e) { return 'THREW'; } })();
      out.signNote = (function () { try { return signNote(); } catch (e) { return 'THREW'; } })();
      out.after = (getNotes() || []).length;
      out.blocked = window.__mlsVisitOwner.blocked.slice();
      out.toasts = window.__toasts.slice();
      localStorage.setItem(uns('activePt'), 'syn-A');
      return out;
    });
    eq(refusals.owner, 'syn-A', 'the editor owner is not Ada, so this refusal test is vacuous');
    eq(refusals.active, 'syn-B', 'the active patient is not Bo, so this refusal test is vacuous');
    for (const fn of ['saveDraft', 'saveCurrentNote', 'copyForEMR', 'pushToAthena', 'signNote']) {
      eq(refusals[fn], false, `${fn}() did not refuse a note whose patient is not the active patient (returned ${JSON.stringify(refusals[fn])})`);
    }
    eq(refusals.after, refusals.before,
      `a refused write still changed the note store (${refusals.before} -> ${refusals.after})`);
    ok(refusals.blocked.length >= 5,
      `the guard recorded ${refusals.blocked.length} refusals for 5 blocked actions`);
    ok(refusals.blocked.every((b) => Object.keys(b).sort().join(',') === 'action,at'),
      `the guard diagnostic carries more than the action and the time: ${JSON.stringify(refusals.blocked[0])}`);
    ok(refusals.toasts.some((t) => t[0].indexOf('different patient') >= 0 && t[1] === 'err'),
      `the refusal was silent — the doctor gets no reason: ${JSON.stringify(refusals.toasts.slice(0, 3))}`);

    /* ---- (d) no patient until one is chosen --------------------------- */
    /* the state the app is in right now: Ada was CHOSEN in this tab today */
    const chosenNow = await page.evaluate(() => ({
      allowed: window.__mlsVisitOwner.restoredSelectionIsAllowed(),
      active: getActivePtId()
    }));
    eq(chosenNow.active, 'syn-A', 'expected Ada to still be the chosen patient');
    eq(chosenNow.allowed, true, 'a patient chosen in this tab today must survive a reload');

    /* a NEW TAB is a new session: same localStorage (activePt persists), fresh
       sessionStorage (the deliberate-choice marker does not). That is what
       "first log in" looks like, and it is where the banner was pre-filled. */
    const tab2 = await context.newPage();
    tab2.on('pageerror', (e) => pageErrors.push('tab2: ' + String(e.message).slice(0, 160)));
    await bootShell(tab2, `http://127.0.0.1:${port}/1pScribeFlow.html`);
    const fresh = await tab2.evaluate(() => ({
      storedActive: localStorage.getItem(uns('activePt')),
      chosenMarker: sessionStorage.getItem(uns('activePtChosen')),
      allowed: window.__mlsVisitOwner.restoredSelectionIsAllowed(),
      enforced: window.__mlsVisitOwner.enforceEmptyBanner('test'),
      active: getActivePtId(),
      bootCleared: window.__mlsVisitOwner.bootCleared
    }));
    eq(fresh.chosenMarker, null, 'a new tab must not inherit the deliberate-choice marker');
    eq(fresh.allowed, false, 'a selection nobody made in this session was treated as chosen');
    eq(fresh.active, '',
      `a fresh session opened with patient ${JSON.stringify(fresh.active)} already on the banner (localStorage held ${JSON.stringify(fresh.storedActive)}) — the doctor chose nobody`);
    ok(fresh.bootCleared >= 1, 'the banner was empty by luck, not by this block clearing it');

    /* pick -> the banner has a patient, and the choice is dated */
    const picked = await tab2.evaluate(() => {
      selectPatient('syn-B');
      return { active: getActivePtId(), allowed: window.__mlsVisitOwner.restoredSelectionIsAllowed() };
    });
    eq(picked.active, 'syn-B', 'picking a patient did not select them');
    await tab2.waitForTimeout(200);
    eq(await tab2.evaluate(() => window.__mlsVisitOwner.restoredSelectionIsAllowed()), true,
      'a patient the doctor just picked would not survive a reload');

    /* reload the SAME tab on the SAME day -> still that patient */
    await tab2.reload({ waitUntil: 'load' });
    await tab2.waitForTimeout(2000);
    await tab2.evaluate(() => { window.__mlsHarnessAccountEmail = 'visit-owner@mlsscribe.test'; });
    await tab2.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await tab2.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await tab2.waitForTimeout(4000);
    eq(await tab2.evaluate(() => getActivePtId()), 'syn-B',
      'a same-tab reload on the same day threw away the patient the doctor had chosen');

    /* a DAY change on the same tab -> empty again */
    eq(await tab2.evaluate(() => {
      sessionStorage.setItem(uns('activePtChosenDay'), '1999-01-01');
      window.__mlsVisitOwner.enforceEmptyBanner('day-change');
      return getActivePtId();
    }), '', 'yesterday\'s patient was still on the banner this morning');

    /* sign out -> sign in: empty, because the session that chose them ended */
    const afterSignOut = await tab2.evaluate(async () => {
      selectPatient('syn-B');
      await new Promise((r) => setTimeout(r, 50));
      var chosenBefore = sessionStorage.getItem(uns('activePtChosen'));
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { previousAccount: 'visit-owner@mlsscribe.test', nextAccount: '', reason: 'logout' } }));
      await new Promise((r) => setTimeout(r, 60));
      window.dispatchEvent(new CustomEvent('mls:session-boundary', { detail: { previousAccount: '', nextAccount: 'visit-owner@mlsscribe.test', reason: 'session-start' } }));
      await new Promise((r) => setTimeout(r, 60));
      return { chosenBefore: chosenBefore, chosenAfter: sessionStorage.getItem(uns('activePtChosen')), active: getActivePtId() };
    });
    eq(afterSignOut.chosenBefore, 'syn-B', 'the pick before sign-out was not recorded, so this leg is vacuous');
    eq(afterSignOut.chosenAfter, null, 'signing out left the deliberate-choice marker behind');
    eq(afterSignOut.active, '', 'signing out and back in reopened the previous session\'s patient');
    await tab2.close();

    eq(pageErrors.length, 0, `the shell threw during the run: ${JSON.stringify(pageErrors.slice(0, 3))}`);

    /* ============================================== PART 3: causal control */
    /* origin/main's shell, same probe. It must LEAK. */
    const ctl = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const basePage = await ctl.newPage();
    await bootShell(basePage, `http://127.0.0.1:${port}/baseline.html`);
    eq(await basePage.evaluate(() => !!window.__mlsVisitOwner), false,
      'origin/main already carries visitowner-1.0.0 — the control is no longer a control');
    eq(await basePage.evaluate(() => window.__vo.seed()), 2, 'the control roster did not land');
    const b = await leakAfterSwitch(basePage);
    ok(b.gen.ok === true, 'the control shell did not generate a note');
    const controlSurfaces = b.hits.map((h) => h.at);
    ok(b.hits.length > 0,
      'THE CONTROL DID NOT REPRODUCE THE BUG: origin/main\'s shell showed no leak after the same switch, so PART 2 passing proves nothing about the fix');
    for (const expected of ['record.cc', 'record.handout', 'global.lastEMR', 'value#handoutBody', 'text#emrTable']) {
      ok(controlSurfaces.indexOf(expected) >= 0,
        `the control lost one of the surfaces this fix exists for (${expected}); it found ${JSON.stringify(controlSurfaces)}`);
    }
    await ctl.close();
    console.log(`  control (origin/main) leaked ${b.hits.length} surfaces: ${JSON.stringify(controlSurfaces)}`);
  } finally {
    await browser.close();
    srv.close();
    try { fs.unlinkSync(baselineFile); } catch (e) {}
  }
}

runtime().then(() => {
  console.log(`1p-visit-owner-isolation-runtime: ${checks} checks passed`);
}).catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
