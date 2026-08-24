'use strict';

/* /1p PATIENTS — ONE PULL OWNER, AND AN IDENTITY GUARD THAT CAN READ
 * (idread-1.0.0 + pullone-1.0.0, 2026-08-18)
 *
 * Owner, 2026-08-18: the cross-patient safety stop "keeps happening" on charts
 * that ARE the same patient; "these need to go; the main one should work" about
 * the per-field Read-from-Athena buttons; and "if it's on the program it should
 * work" about everything on the screen.
 *
 * The properties this suite pins, each with a control that fails when the fix
 * is doing nothing:
 *
 *   1. THE DOB READING. A birthday spelled ISO and a birthday spelled the way
 *      athenaOne's banner prints it are the same birthday. The raw-digit rule
 *      the guard used could never see that, and #ptDob's own placeholder tells
 *      the doctor to type ISO. CONTROL: the pre-fix rule (digits(a)===digits(b))
 *      is executed on the same rows and MUST refuse the ones the fix accepts -
 *      otherwise this suite is passing on a page where nothing changed.
 *
 *   2. THE NAME READING. A reader that lands on textContent returns the banner
 *      name with no separator ("AdaSample"). That is re-segmented; four
 *      genuinely different names must still be vetoed, including one that shares
 *      a surname and one that contains the other as a substring.
 *
 *   3. THE REQUIREMENT IS UNCHANGED. A different date, a different year and an
 *      absent DOB still prove nothing.
 *
 *   4. ONE PULL CONTROL. A cold chart drew FIVE per-field buttons; it now draws
 *      none, and exactly one whole-chart control, which survives the collapse
 *      the profile card ships with.
 *
 *   5. THE BUTTON SPEAKS. Pressing the Patients-screen pull put its progress
 *      report into #pullChartStatus, a node that lives inside the hidden
 *      History view, and its chip into a surface another module suppresses with
 *      display:none !important. CONTROL: __mlsPullOne.revert() restores exactly
 *      that silence.
 *
 *   6. IT LANDS ON WHAT WAS PULLED, INCLUDING THE SEVEN-TILE STRIP. The strip
 *      repaints synchronously for this pull and also listens for exact-patient
 *      record updates; it never waits for a lucky fallback-interval boundary.
 *      CONTROL: reverted, the same successful pull leaves the doctor on the
 *      History screen.
 *
 *   7. THE DEAD POINTER. The shipped message advertises an in-athena green
 *      panel that mounts nowhere on athenaOne v26.7 ax views. CONTROL: the
 *      production module must STILL ship that phrase, or this rewrite is
 *      rewriting nothing.
 *
 *   8. LANE NEUTRALITY. Not one byte reaches production or /cloned.
 *
 * PART 1 is static. PART 2 drives the real shell in real Chrome - no login, no
 * network, no PHI, synthetic names only.
 *
 * THE TRAP THIS SUITE AVOIDS: 1p-mls-connect.js and its feature modules are not
 * loaded by the page on its own - they ride a gate a login normally opens. A
 * measurement taken without window.__mlsEnsureUiBundle() measures a bare shell
 * and reports that everything is fine.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(a, b, message) { assert.strictEqual(a, b, `${message} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); checks++; }

/* ------------------------------------------------------------------ PART 1 */
function statics() {
  for (const shell of SHELLS) {
    const src = read(shell);
    for (const token of ['idread-1.0.0', 'pullone-1.0.0']) {
      ok(src.indexOf(token) > 0, `${shell}: ${token} is missing`);
    }
    ok(src.indexOf('<!-- ===== pullone-1.0.0') > 0, `${shell}: pullone-1.0.0 is not in a delimited block`);
    ok(src.indexOf('<!-- ===== end pullone-1.0.0') > 0, `${shell}: pullone-1.0.0 has no closing delimiter`);
    ok(src.indexOf('/* ===== idread-1.0.0') > 0, `${shell}: idread-1.0.0 is not in a delimited block`);
    ok(src.indexOf('/* ===== end idread-1.0.0') > 0, `${shell}: idread-1.0.0 has no closing delimiter`);
    /* the guard's DOB comparisons must go through the reader, not raw digits */
    ok(src.indexOf('_athenaHistoryDobSame(seenDob,target.dob)') > 0,
      `${shell}: the identity proof still compares raw DOB digits`);
    /* EVERY cross-patient sentence this shell can render must name the action
       that works and none may point at the in-athena green panel. */
    ok(src.indexOf('did not return matching DOB/MRN proof') < 0,
      `${shell}: the mismatch message still names a mechanism instead of the next step`);
    ok(src.indexOf('or select (or add) that same patient here, then pull again') > 0,
      `${shell}: the mismatch message no longer carries the advice that works`);
    /* The phrase is allowed exactly once more, inside pullone-1.0.0 itself,
       where it is the matcher this lane rewrites AWAY. Anywhere else in the
       shell it would be a message the doctor can actually be shown. */
    const outside = src.slice(0, src.indexOf('<!-- ===== pullone-1.0.0')) +
                    src.slice(src.indexOf('<!-- ===== end pullone-1.0.0'));
    ok(outside.indexOf('green MLS panel') < 0, `${shell}: a shell message advertises the dead in-athena panel`);
    ok(outside.indexOf('Pull history') < 0, `${shell}: a shell message still names the dead in-athena control`);
  }

  /* THE TWINS */
  const canon = (v) => String(v)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
    .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
  eq(canon(read('1p/index.html')) === read('1pScribeFlow.html'), true, 'the two /1p shells are not twins');

  /* THE PROMOTION (b1036, 2026-08-20): "production proper must stay clean
     forever" ended when the owner made the 1p lineage the official site -
     production is now DERIVED from /1p (scripts/derive-production-from-1p.js),
     so the invariant INVERTS: these lane blocks must be PRESENT in production,
     exactly as the derive emits them. Absence now means a broken derivation. */
  {
    /* Each token lives where its 1p source put it (idread in the shell, the
       wrapper names across shell+bundle) - assert against the pair, exactly
       the surface the old absence-check swept. */
    const prodPair = read('ScribeFlow.html') + read('mls-connect.js');
    for (const token of ['idread-1.0.0', 'pullone-1.0.0', 'pvrPullOne', '_athenaHistoryDobSame']) {
      ok(prodPair.indexOf(token) >= 0, `production lost ${token} — the derivation is broken`);
    }
  }
  {
    const shell = read('cloned/index.html');
    for (const token of ['idread-1.0.0', 'pullone-1.0.0']) {
      ok(shell.indexOf(token) >= 0, `cloned/index.html is missing ${token} — the derive did not promote this lane's shell blocks`);
    }
    ok(read('cloned-mls-connect.js').indexOf('pvrPullOne') >= 0,
      'cloned-mls-connect.js is missing pvrPullOne — the derive did not promote this lane\'s connect change');
  }

  /* THE TWO CONTROLS FOR THE OVERLAY. If either of these stops being true, the
     overlay above it is rewriting or mirroring something that no longer
     happens, and this suite must fail LOUDLY rather than keep passing. */
  const autopull = read('feat_athena_autopull.js');
  /* autopull v1.1 (tm-1.1, 2026-08-19): the mismatch message is truthful AT THE
     SOURCE — it no longer blames "a DIFFERENT patient open" (false since the
     extension's detect-3072 anchors the read to whoever was open at the click)
     and no longer ships the dead green-panel pointer pullone had to strip at
     display time. The overlay's rewrite is now an inert passthrough for a
     sentence that no longer exists; the pin flips to prove the dead pointer
     never returns to the source. */
  ok(autopull.indexOf('green MLS panel') < 0,
    'feat_athena_autopull.js reintroduced the dead green-panel pointer — tm-1.1 made the source message truthful; fix the source, never re-point at the retired panel');
  ok(autopull.indexOf('charts can never mix') > 0,
    'feat_athena_autopull.js dropped the mix promise from its stop message — the stop must still say what it protected');
  ok(autopull.indexOf('mlsAutoPullChip') > 0,
    'feat_athena_autopull.js no longer uses #mlsAutoPullChip — the mirror has nothing to read');
  const unify = read('feat_athena_ux_unify.js');
  ok(unify.indexOf("'#mlsAutoPullChip,.mlsac-toast{display:none !important;}'") > 0,
    'feat_athena_ux_unify.js no longer suppresses the pull chip — the mirror may be unnecessary now');
  ok(unify.indexOf("getComputedStyle(n).display !== 'none'") > 0,
    'feat_athena_ux_unify.js changed its fold gate — re-measure whether its own mirror is alive before keeping ours');

  /* THE STRIP DRAWS ONE CONTROL, NOT ONE PER FIELD */
  const conn = read('1p-mls-connect.js');
  ok(conn.indexOf("(f.read ? '<button type=\"button\" class=\"pvr-read\">Read from Athena</button>' : '')") < 0,
    '1p-mls-connect.js still draws a Read-from-Athena button per chip');
  ok(conn.indexOf("one.id = 'pvrPullOne'") > 0, '1p-mls-connect.js does not draw the one whole-chart pull control');
  ok(conn.indexOf(':not(#pvrPullOne){display:none!important;}') > 0,
    'the one pull control is hidden by the profile collapse the card ships with');
  ok(conn.indexOf("window.addEventListener('mls:patient-record-updated', onPatientRecordUpdated)") > 0,
    'same-patient chart updates do not trigger the seven-tile strip repaint');
  ok(conn.indexOf("window.removeEventListener('mls:patient-record-updated', onPatientRecordUpdated)") > 0,
    'the same-patient strip repaint listener cannot be cleanly reverted');
  for (const shell of SHELLS) {
    ok(read(shell).indexOf('if (calm && isFn(calm.ensure)) calm.ensure();') > 0,
      `${shell}: a successful pull still waits for the fallback strip timer before it looks complete`);
  }
}

/* ------------------------------------------------------------------ PART 2 */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.bin': 'application/octet-stream' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent(String(req.url).split('?')[0]);
      if (rel === '/') rel = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + rel);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('nf'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected. Synthetic names only, no PHI, no network. */
function harness() {
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }
  /* The exact string feat_athena_autopull.js renders on a cross-patient stop. */
  var SHIPPED_MISMATCH = '⚠ athenaOne has a DIFFERENT patient open than the one selected here — MLS ' +
    'stopped on purpose so charts can never mix. To pull the patient whose chart is open in Athena: select (or ' +
    'add) that same patient here first, then click again. Or use the green MLS panel inside Athena ' +
    '(“Pull history”) — it always pulls the open chart. Nothing was saved.';

  window.__t1 = {
    visible: visible,
    shipped: SHIPPED_MISMATCH,
    seedOne: function (patient) {
      try { savePatients([JSON.parse(JSON.stringify(patient))]); } catch (e) { return 'ERR ' + e.message; }
      try { saveNotes([]); } catch (e) {}
      try { setActivePtId(patient.id); } catch (e) {}
      try { showView('patients'); } catch (e) {}
      try { renderProfile(); renderPatients(); } catch (e) {}
      return getPatients().length;
    },
    /* THE DOB MATRIX, read off the real guard, with the pre-fix rule executed
       beside it on the identical rows as the causal control. */
    dobMatrix: function (base, rows) {
      var digits = function (v) { return String(v || '').replace(/[^0-9]/g, ''); };
      return rows.map(function (r) {
        /* A NEW RECORD PER ROW. Measured while writing this suite: the store
           merges an existing id and KEEPS the DOB it already had, so both
           mutate-in-place and re-seed-same-id left every row testing the seed
           DOB and refusing for a reason that had nothing to do with the guard.
           The read-back travels with the row so a dead instrument can never
           look like a verdict. */
        var fresh = JSON.parse(JSON.stringify(base));
        fresh.id = String(base.id) + '-dob' + rows.indexOf(r);
        fresh.dob = r[0];
        savePatients([fresh]);
        var list = getPatients() || [], back = {};
        for (var k = 0; k < list.length; k++) { if (String(list[k].id) === fresh.id) { back = list[k]; break; } }
        var target = { patientId: String(back.id || ''), name: String(back.name || ''), dob: String(back.dob || ''), mrn: String(back.mrn || '') };
        var now = false, err = '';
        try { now = window._athenaHistoryProofMatches(target, { chartName: target.name, chartDob: r[1], chartMrn: '' }); }
        catch (e) { err = String(e && e.message); }
        var before = !!(digits(r[1]) && digits(r[0]) && digits(r[1]) === digits(r[0]));
        return { stored: r[0], readBack: String(back.dob || ''), banner: r[1], now: now === true, before: before, err: err };
      });
    },
    nameMatrix: function (want, seens) {
      return seens.map(function (s) {
        var v = null; try { v = window._athenaHistoryNameCompatible(s, want); } catch (e) { v = 'THREW'; }
        return { seen: s, ok: v };
      });
    },
    stripControls: function () {
      var one = document.getElementById('pvrPullOne');
      return { perChip: document.querySelectorAll('#pf2Quick .pvr-read:not(#pvrPullOne)').length,
               one: !!one, oneVisible: visible(one), oneText: one ? String(one.textContent) : '',
               collapsed: !!(document.getElementById('profileCard') || {}).classList &&
                          document.getElementById('profileCard').classList.contains('pf2-collapsed') };
    },
    statusWhere: function () {
      var s = document.getElementById('pullChartStatus');
      var v = s && s.closest ? s.closest('[id$="View"]') : null;
      return { visible: visible(s), text: s ? String(s.textContent).replace(/\s+/g, ' ').trim() : '',
               view: v ? v.id : 'none',
               afterButton: !!(s && s.previousElementSibling && s.previousElementSibling.id === 'ptPullAthenaBtn') };
    },
    pressPtPull: function () { var b = document.getElementById('ptPullAthenaBtn'); if (!b) return 'MISSING'; b.click(); return 'clicked'; },
    /* A reader stub so the identity gate, the save and the landing all run for
       real. It never reaches the network or the extension. */
    stubReader: function (name, dob, mrn) {
      window._assistReadChart = function (ref, onStatus) {
        try { onStatus && onStatus('reading'); } catch (e) {}
        return Promise.resolve({ requestId: 'syn-1', text: 'ACTIVE PROBLEMS\nLumbar spinal stenosis\n',
          url: 'about:blank', opened: true, chartName: name, chartDob: dob, chartMrn: mrn,
          receipt: { kind: 'athena-chart-coverage', complete: true, identityObserved: true } });
      };
      window._parsePatientChart = function () {
        return Promise.resolve({ problems: 'Lumbar spinal stenosis', meds: 'Gabapentin 300 mg', allergies: 'NKDA',
          summary: 'Stable.', vitals: { bp: '128/78', hr: '72' },
          history: { pmh: 'Hypertension', psh: 'Appendectomy', social: 'Never smoker', family: 'Non-contributory',
            smoking: 'Never', immunizations: 'UTD', lmp: '', codeStatus: 'Full', pcp: 'Dr Sample', pharmacy: 'Sample Pharmacy' },
          coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' } });
      };
      return true;
    },
    pullFromHistory: function () {
      try { showView('history'); } catch (e) {}
      document.body.removeAttribute('data-p1-pull-landed');
      var btn = document.getElementById('pullChartBtn');
      return Promise.resolve(window.pullPatientChartViaAssist(btn, {})).then(function (r) { return r === true || !!(r && r.chartSaved === true); },
        function () { return false; });
    },
    /* The empty-state notice's own pull button. That notice is REMOVED by
       renderProfile the moment the chart has content, so this is the path where
       a status line parked beside the button leaves the document mid-pull. */
    pullFromNotice: function () {
      try { showView('patients'); renderProfile(); } catch (e) {}
      document.body.removeAttribute('data-p1-pull-landed');
      var btn = document.getElementById('profUnpulledPull');
      if (!btn) return Promise.resolve('NO-NOTICE');
      btn.click();
      return new Promise(function (res) { setTimeout(function () { res('clicked'); }, 2500); });
    },
    landing: function () {
      var pc = document.getElementById('profileCard');
      return { landed: document.body.getAttribute('data-p1-pull-landed') || '',
               patients: visible(document.getElementById('patientsView')),
               history: visible(document.getElementById('historyView')),
               card: visible(pc),
               strip: String((document.getElementById('pf2Quick') || {}).innerText || '').replace(/\s+/g, ' ') };
    },
    saved: function (id) {
      var p = (getPatients() || []).filter(function (x) { return x.id === id; })[0] || {};
      return { problems: String(p.problems || ''), meds: String(p.meds || ''), allergies: String(p.allergies || ''),
               landed: !!p.athenaChartImportedAt };
    }
  };
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  /* THE STEP WITHOUT WHICH THIS SUITE MEASURES A BARE SHELL. */
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
  });
  await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'pullone-harness@mlsscribe.test'; });
  await page.evaluate(harness);
}

const COLD = { id: 'syn-cold', name: 'Dee Sample', dob: '1970-01-02', mrn: '900004', athenaId: '900004',
  problems: '', meds: '', allergies: '', visits: [] };

const DOB_ROWS = [
  /* accepted after idread-1.0.0 — every one of them the SAME birthday */
  ['1962-03-04', '03/04/1962'], ['1962-03-04', '3/4/1962'], ['03/04/1962', '3/4/1962'],
  ['03/04/1962', 'March 4, 1962'],
  /* accepted before AND after (the pre-fix rule already handled these) */
  ['03/04/1962', '03/04/1962'], ['1962-03-04', '1962-03-04'], ['03/04/1962', '03-04-1962'],
  /* must stay refused */
  ['03/04/1962', '04/03/1962'], ['03/04/1962', '03/04/1963'], ['03/04/1962', '']
];
const REFUSE_FROM = 7; /* rows at this index and beyond must refuse */

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  try {
    await boot(page, port);

    const apis = await page.evaluate(() => ({
      pullone: !!(window.__mlsPullOne && window.__mlsPullOne.installed),
      version: window.__mlsPullOne && window.__mlsPullOne.version,
      wrapped: !!(window.pullPatientChartViaAssist && window.pullPatientChartViaAssist.__pullOne),
      fieldUnified: !!(window.__mlsChartField && window.__mlsChartField.__pullOne),
      dobSame: typeof window._athenaHistoryDobSame,
      dobKey: typeof window._athenaHistoryDobKey
    }));
    measured.apis = apis;
    eq(apis.version, 'pullone-1.0.0', `pullone-1.0.0 did not install: ${JSON.stringify(apis)}`);
    eq(apis.wrapped, true, 'the chart pull is not wrapped, so nothing can land on the pulled chart');
    eq(apis.fieldUnified, true, 'the per-field read verb was not routed onto the app\'s own pull');
    eq(apis.dobSame, 'function', 'idread-1.0.0 did not install its date reader');

    const seeded = await page.evaluate((p) => window.__t1.seedOne(p), COLD);
    eq(seeded, 1, `the synthetic chart did not land in the store: ${JSON.stringify(seeded)}`);

    /* -- 1 + 3. THE DOB MATRIX, WITH ITS CAUSAL CONTROL ------------------- */
    const dob = await page.evaluate((a) => window.__t1.dobMatrix(a[0], a[1]), [COLD, DOB_ROWS]);
    measured.dob = dob;
    let recovered = 0;
    dob.forEach((r, i) => {
      /* the instrument, before the verdict: a row whose stored DOB did not
         actually reach the store measures nothing at all */
      eq(r.readBack, r.stored, `the store did not keep the DOB under test, so row ${i} measures nothing`);
      eq(r.err, '', `the guard threw on row ${i}: ${r.err}`);
      if (i >= REFUSE_FROM) {
        eq(r.now, false, `a chart that is NOT this patient was accepted: stored=${r.stored} banner=${JSON.stringify(r.banner)}`);
        eq(r.before, false, `the control is wrong: the pre-fix rule already accepted ${r.stored} vs ${r.banner}`);
      } else {
        eq(r.now, true, `the same birthday was refused: stored=${r.stored} banner=${JSON.stringify(r.banner)}`);
        if (!r.before) recovered++;
      }
    });
    /* THE CONTROL. If the pre-fix rule already accepted every row, this suite
       would pass on a page where idread-1.0.0 does nothing at all. */
    eq(recovered, 4, `idread-1.0.0 must recover exactly the four spellings the raw-digit rule could never read; recovered ${recovered}`);

    /* -- 2. THE NAME MATRIX ---------------------------------------------- */
    const SAME = ['Ann Cubbage Reilly', 'Cubbage Reilly, Ann', 'cubbage reilly a', 'AnnCubbageReilly',
      'ANNCUBBAGEREILLY', 'Ann Cubbag', 'Patient: Ann Cubbage Reilly', 'REILLY, ANN C.'];
    const DIFFERENT = ['Robert Nguyen', 'Mark Reilly', 'AnnSmith', 'Joann Reilly'];
    const names = await page.evaluate((a) => window.__t1.nameMatrix(a[0], a[1].concat(a[2])),
      ['Ann Cubbage Reilly', SAME, DIFFERENT]);
    measured.names = names;
    names.slice(0, SAME.length).forEach((r) => {
      eq(r.ok, true, `the same patient's name was read as a mismatch: ${JSON.stringify(r.seen)}`);
    });
    names.slice(SAME.length).forEach((r) => {
      eq(r.ok, false, `a DIFFERENT patient's name was accepted: ${JSON.stringify(r.seen)}`);
    });
    /* the run-together pair is the whole point of the re-segmentation */
    eq(names[3].ok, true, 'a textContent read of the banner ("AnnCubbageReilly") still vetoes the same patient');
    eq(names[SAME.length + 2].ok, false, '"AnnSmith" must not re-segment into "Ann Cubbage Reilly"');

    /* -- 7. THE DEAD POINTER --------------------------------------------- */
    const msg = await page.evaluate(() => {
      const input = window.__t1.shipped;
      return { input: input, out: window.__mlsPullOne.calmMismatch(input) };
    });
    measured.mismatch = msg.out;
    ok(msg.input.indexOf('green MLS panel') > 0, 'the control string no longer carries the dead pointer');
    eq(msg.out.indexOf('green MLS panel') < 0, true, `the rendered mismatch message still advertises the green panel: ${msg.out}`);
    eq(msg.out.indexOf('Pull history') < 0, true, `the rendered mismatch message still names the dead panel control: ${msg.out}`);
    ok(/nothing was saved/i.test(msg.out), `the rewrite dropped "Nothing was saved": ${msg.out}`);
    ok(/select \(or add\) that same patient here/i.test(msg.out), `the rewrite dropped the advice that works: ${msg.out}`);
    ok(/charts can never mix/i.test(msg.out), 'the rewrite weakened what the stop says it did');

    /* -- 4. ONE PULL CONTROL --------------------------------------------- */
    /* the DOB matrix above replaced the roster row by row; put the cold chart
       back and open it, or the strip measures an empty profile */
    eq(await page.evaluate((p) => window.__t1.seedOne(p), COLD), 1, 'the cold chart could not be re-seeded for the strip measurement');
    await page.waitForTimeout(2600);
    const strip = await page.evaluate(() => window.__t1.stripControls());
    measured.strip = strip;
    eq(strip.perChip, 0, `${strip.perChip} per-field Read-from-Athena buttons still render on one cold chart`);
    eq(strip.one, true, 'the one whole-chart pull control is missing from the strip');
    eq(strip.oneVisible, true, 'the one pull control is on the page but not visible');
    /* Pin moved 2026-08-19 with t9pullbutton's deliberate rename: the control's
       name states its real verb ("this patient's chart", VERB B) so it can never
       be confused with pull-whoever-is-open (VERB A). */
    ok(strip.oneText.indexOf("Pull this patient's chart") >= 0, `the one control says ${JSON.stringify(strip.oneText)}`);

    /* -- 5. THE BUTTON SPEAKS, WITH ITS CONTROL --------------------------- */
    await page.evaluate(() => window.__t1.pressPtPull());
    await page.waitForTimeout(2600);
    const said = await page.evaluate(() => window.__t1.statusWhere());
    measured.said = said;
    eq(said.visible, true, 'pressing the Patients-screen pull still says nothing the doctor can see');
    eq(said.view, 'patientsView', `the pull's status line answered into ${said.view} instead of the room the button is in`);
    eq(said.afterButton, true, 'the status line is not beside the button that was pressed');
    ok(said.text.length > 8, `the status line is visible but empty: ${JSON.stringify(said.text)}`);

    /* -- 6. IT LANDS ON WHAT WAS PULLED ---------------------------------- */
    await page.evaluate(() => window.__t1.stubReader('Dee Sample', '01/02/1970', '900004'));
    const pulled = await page.evaluate(() => window.__t1.pullFromHistory());
    const land = await page.evaluate(() => window.__t1.landing());
    const saved = await page.evaluate(() => window.__t1.saved('syn-cold'));
    measured.landing = land; measured.saved = saved;
    eq(pulled, true, 'the stubbed chart pull did not succeed, so the landing cannot be measured');
    /* the ISO-stored record vs the mm/dd/yyyy banner IS the owner's case */
    eq(saved.landed, true, 'the pull reported success but nothing was written to the chart');
    ok(saved.problems.indexOf('Lumbar spinal stenosis') >= 0, `the pulled problems were not saved: ${JSON.stringify(saved.problems)}`);
    eq(land.landed, 'syn-cold', `the pull did not land on the pulled patient: ${JSON.stringify(land.landed)}`);
    eq(land.patients, true, 'after a successful pull the doctor is not on the chart that was pulled');
    eq(land.history, false, 'the doctor was left on the visit list instead of the pulled chart');
    eq(land.card, true, 'the profile card is not on screen after the pull');
    ok(land.strip.indexOf('Lumbar spinal stenosis') >= 0,
      `the landing screen does not show what was pulled: ${land.strip.slice(0, 160)}`);

    /* -- 6b. THE OUTCOME SURVIVES THE NOTICE THAT CARRIED IT -------------- */
    /* #profUnpulledPull lives inside #profUnpulled, and a successful pull is
       exactly what makes renderProfile delete that notice. Measured before this
       was handled: the status line went with it and the pull ended silent. */
    /* A NEW id: the store merges an existing one and keeps the fields it already
       has, so re-seeding syn-cold would hand back the chart the pull above just
       filled and the unpulled notice would (correctly) not render at all. */
    const COLD2 = Object.assign({}, COLD, { id: 'syn-cold2' });
    await page.evaluate((p) => window.__t1.seedOne(p), COLD2);
    await page.waitForTimeout(1500);
    const noticePress = await page.evaluate(() => window.__t1.pullFromNotice());
    eq(noticePress, 'clicked', 'the unpulled-chart notice offers no pull button to press');
    const afterNotice = await page.evaluate(() => ({
      said: window.__t1.statusWhere(), land: window.__t1.landing(), saved: window.__t1.saved('syn-cold2')
    }));
    measured.afterNotice = afterNotice;
    eq(afterNotice.saved.landed, true, 'the notice\'s pull button did not save a chart');
    eq(afterNotice.said.visible, true, 'a successful pull from the unpulled-chart notice ends in silence');
    ok(afterNotice.said.text.length > 8, `the surviving status line is empty: ${JSON.stringify(afterNotice.said.text)}`);
    eq(afterNotice.land.landed, 'syn-cold2', 'the notice\'s pull did not land on the pulled chart');

    /* THE CAUSAL CONTROL for 5 and 6: reverted, the silence and the wrong
       destination both come straight back. Without this, both assertions above
       would pass on a page where this block does nothing. */
    const control = await page.evaluate(async () => {
      window.__mlsPullOne.revert();
      var p = getPatients()[0]; p.problems = ''; p.meds = ''; p.allergies = '';
      delete p.athenaChartImportedAt; savePatients([p]);
      try { showView('patients'); } catch (e) {}
      try { renderProfile(); } catch (e) {}
      var s = document.getElementById('pullChartStatus');
      if (s) { s.textContent = ''; s.style.display = 'none'; }
      var before = window.__t1.statusWhere();
      /* NOT ".__pullOne on the global": another module wraps the pull AFTER this
         block, so that flag reads false on the outer wrapper whether or not this
         block is still in the chain - an unwrap that did nothing would look
         clean. The block's own off switch is the honest reading. */
      var stillWrapped = !window.__mlsPullOne.isOff();
      var okPull = await window.__t1.pullFromHistory();
      return { homeView: before.view, okPull: okPull, stillWrapped: stillWrapped,
               land: window.__t1.landing(), said: window.__t1.statusWhere() };
    });
    await page.waitForTimeout(900);
    measured.control = control;
    eq(control.stillWrapped, false, 'the control failed: revert() did not unwrap the chart pull');
    eq(control.homeView, 'historyView', 'the control failed: the status line did not return to the History view on revert');
    eq(control.okPull, true, 'the control failed: the same pull did not succeed with the block reverted');
    eq(control.land.landed, '', 'the control failed: the landing marker survived revert()');
    eq(control.land.history, true, 'the control failed: the reverted build already navigated off the visit list');

    eq(pageErrors.filter((m) => /pullone|__mlsPullOne|_athenaHistoryDob|pvrPullOne/i.test(m)).length, 0,
      `this lane threw in the page: ${JSON.stringify(pageErrors.slice(0, 4))}`);
    measured.pageErrors = pageErrors.length;
  } finally {
    await browser.close();
    srv.close();
  }
}

(async () => {
  statics();
  await runtime();
  console.log(JSON.stringify(measured, null, 1));
  console.log(`PASS 1p-pull-one-owner-contract — ${checks} checks`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
