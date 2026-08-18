'use strict';

/* /1p PROFILE COHERENCE — pvr-1.0.0
 *
 * Owner, 2026-08-17, on a patient profile: "why does the patient's history look
 * so bad and why is there nothing under problems or medications?"
 *
 * The five properties this suite pins:
 *
 *   1. ONE RESOLVER. The Visit history panel's header, the profile's at-a-glance
 *      chip and pf2's VISITS tile all report the SAME number, for a patient
 *      whose visits are split across three stores (pulled Athena rows in
 *      p.visits[], a note recorded in MLS, and a draft that is not a visit).
 *      The causal control runs the identical page with the block reverted and
 *      requires the three to DISAGREE — otherwise this suite would pass on a
 *      page where the block does nothing.
 *
 *   2. THE EMPTY-STATE MATRIX. present / none / not_captured / not_pulled each
 *      produce a DIFFERENT sentence, and none of them is a bare em-dash. The
 *      distinction that matters most is inside 'not_documented': a section the
 *      pull could not read lands with EXACTLY the same status as a chart a
 *      doctor confirmed was clear (see the block's own note), so the receipt's
 *      sourceEvidence is the only thing that separates them — and its absence
 *      must resolve to the cautious state.
 *
 *   3. A NOTICE MAY NOT NAME A PATIENT. feat_save_verify's banner title carries
 *      one and fires on upsert, so a background save put another patient's name
 *      over the open chart. The de-identifier is executed against a real banner
 *      built by the real module.
 *
 *   4. THE TIMELINE RENDERS, collapsed to the latest three with a working
 *      "Show all", and there is exactly ONE "No visits yet" on an empty chart
 *      (there were two).
 *
 *   5. LANE NEUTRALITY. Not one byte of the block reaches production
 *      ScribeFlow.html / mls-connect.js / cloned.
 *
 * PART 1 is static (both twins + 1p-mls-connect.js, no browser).
 * PART 2 drives the real shell in real Chrome — no login, no network, no PHI,
 * synthetic names only.
 *
 * THE TRAP THIS SUITE AVOIDS: 1p-mls-connect.js and its 219 feature modules are
 * NOT loaded by the page on its own — they ride a gate a login normally opens.
 * A measurement taken without window.__mlsEnsureUiBundle() measures a bare
 * shell and reports that everything is fine.
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
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ============================================================ PART 1: static */

const OPEN = '<!-- ===== pvr-1.0.0';
const CLOSE = '<!-- ===== end pvr-1.0.0';

for (const name of SHELLS) {
  const src = read(name);
  eq(src.split(OPEN).length - 1, 1, `${name}: ${OPEN} must open exactly once`);
  eq(src.split(CLOSE).length - 1, 1, `${name}: ${CLOSE} must close exactly once`);
  ok(src.indexOf(OPEN) < src.indexOf(CLOSE), `${name}: pvr-1.0.0 closes before it opens`);

  const block = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));

  /* The resolver is delimited so a fifth reader cannot be added quietly. */
  eq(block.split('RESOLVER BEGIN').length - 1, 1, `${name}: the resolver must be marked BEGIN exactly once`);
  eq(block.split('RESOLVER END').length - 1, 1, `${name}: the resolver must be marked END exactly once`);

  for (const api of ['window.__mlsPtVisits', 'window.__mlsChartField', 'window.__mlsProfileCalm']) {
    ok(block.indexOf(api + ' = ') > 0, `${name}: ${api} must be published by the block`);
  }
  /* Every one of the four states must be nameable from the source. */
  for (const state of ["'present'", "'none'", "'not_captured'", "'not_pulled'"]) {
    ok(block.indexOf(state) > 0, `${name}: the block must name the ${state} state`);
  }
  /* rAF never fires in a non-compositing tab; a UI controller must not CALL it.
     Naming it in a comment is how the next reader learns why. */
  eq(block.indexOf('requestAnimationFrame('), -1, `${name}: pvr-1.0.0 must not schedule on requestAnimationFrame`);
  ok(block.indexOf('requestAnimationFrame') > 0, `${name}: the block must record WHY it does not use rAF`);

  /* The writer side of the honesty evidence, and its reader, in the same file. */
  ok(src.indexOf('function _athenaSurfaceNote(') > 0, `${name}: _athenaSurfaceNote must exist`);
  ok(src.indexOf('profileCoverage.sourceEvidence=') > 0, `${name}: _savePatientChart must stamp sourceEvidence`);
  ok(block.indexOf('r.sourceEvidence') > 0, `${name}: the block must READ sourceEvidence off the receipt`);
  /* Both return paths of the combine must be noted, or a chart with no briefing
     records nothing and the reader silently falls back to "unknown" forever. */
  eq(src.split('return _athenaSurfaceNote(note,').length - 1, 3,
    `${name}: all three _athenaChartTextForParse returns must pass through _athenaSurfaceNote`);
}

/* THE SHELLS ARE TWINS. */
{
  const canon = (v) => String(v)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
    .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
  eq(canon(read('1p/index.html')), read('1pScribeFlow.html'), 'the two /1p shells are no longer twins');
}

/* LANE NEUTRALITY — production and /cloned must not have moved by one byte. */
for (const name of ['ScribeFlow.html', 'mls-connect.js', 'cloned-mls-connect.js', 'cloned/index.html']) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  eq(src.indexOf('pvr-1.0.0'), -1, `${name}: this lane's block leaked out of /1p`);
  eq(src.indexOf('__mlsPtVisits'), -1, `${name}: this lane's resolver leaked out of /1p`);
  eq(src.indexOf('_athenaSurfaceNote'), -1, `${name}: this lane's evidence writer leaked out of /1p`);
}

/* THE STRIP asks the resolvers rather than printing a dash. */
{
  const conn = read('1p-mls-connect.js');
  ok(conn.indexOf('window.__mlsPtVisits.resolve') > 0, '1p-mls-connect.js: the strip must ask the visit resolver');
  ok(conn.indexOf('function qfield(') > 0, '1p-mls-connect.js: qfield (the honesty reader) must exist');
  ok(conn.indexOf('window.__mlsChartField') > 0, '1p-mls-connect.js: the strip must ask the chart-field resolver');
  ok(conn.indexOf("'Read from Athena'") > 0 || conn.indexOf('Read from Athena<') > 0 || conn.indexOf('>Read from Athena') > 0,
    '1p-mls-connect.js: the strip must offer a one-tap re-read');
  /* the four tiles that must never render a bare dash again */
  for (const key of ["qfield(p, 'problems'", "qfield(p, 'meds'", "qfield(p, 'allergies'", "qfield(p, 'vitals'"]) {
    ok(conn.indexOf(key) > 0, `1p-mls-connect.js: ${key} must go through the honesty reader`);
  }
  /* the picker no longer calls scheduled appointments "visits" */
  ok(conn.indexOf('function pickCount(') > 0, '1p-mls-connect.js: the rail picker must use pickCount');
  ok(conn.indexOf("' appointment'") > 0, '1p-mls-connect.js: the rail picker must say what it counts');
}

console.log(`PART 1 ok — ${checks} static checks`);

/* ============================================================ PART 2: runtime */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected into the page. Synthetic names only, no PHI, no network. */
function harness() {
  var DAY = '2026-08-17';

  /* SPLIT-1 is the owner's chart, reproduced: visits living in three stores at
     once. Two Athena rows in p.visits[] (one of them on the same day as the
     recorded note, which must NOT double it), one completed note on its own
     day, and one DRAFT — which is not a visit and is the exact reason one
     surface said 1 while another said 3. Expected resolver answer: 3. */
  var PATIENTS = [
    { id: 'syn-split', name: 'Ada Sample', dob: '1962-03-04', mrn: 'MRN900001',
      problems: 'Lumbar spinal stenosis', meds: 'Gabapentin 300 mg', allergies: 'NKDA',
      athenaChartImportedAt: '2026-08-17T12:00:00.000Z',
      visits: [
        { id: 'v1', date: '2026-08-10', type: 'Office visit', raw: 'Follow-up, lumbar.', source: 'athena-copy', encounterId: 'enc-1' },
        { id: 'v2', date: '2026-07-01', type: 'Injection', raw: 'Lumbar medial branch block.', source: 'athena-copy', encounterId: 'enc-2' }
      ] },
    /* NONE — a verified receipt whose problems card says not_documented AND
       whose sourceEvidence proves the briefing surface was read. */
    { id: 'syn-none', name: 'Bo Sample', dob: '1955-06-06', mrn: 'MRN900002',
      problems: '', meds: '', allergies: 'NKDA', visits: [],
      athenaChartImportedAt: '2026-08-17T12:00:00.000Z',
      athenaProfileCoverage: {
        complete: true, exactIdentityVerified: true, patientId: 'syn-none', capturedAt: '2026-08-17T12:00:00.000Z',
        cards: { problems: { status: 'not_documented', populated: false }, meds: { status: 'not_documented', populated: false },
                 allergies: { status: 'found', populated: true } },
        sourceEvidence: { briefing: 'present', briefChars: 4200, problemsSurface: 1, medsSurface: 1, at: Date.now() }
      } },
    /* NOT CAPTURED — the same receipt, same status, same emptiness, and the
       sourceEvidence says neither surface was in front of the parser. This pair
       is the whole point: without the evidence these two records are
       byte-identical, and the old code called both of them "no problems". */
    { id: 'syn-miss', name: 'Cy Sample', dob: '1948-09-09', mrn: 'MRN900003',
      problems: '', meds: '', allergies: 'NKDA', visits: [],
      athenaChartImportedAt: '2026-08-17T12:00:00.000Z',
      athenaProfileCoverage: {
        complete: true, exactIdentityVerified: true, patientId: 'syn-miss', capturedAt: '2026-08-17T12:00:00.000Z',
        cards: { problems: { status: 'not_documented', populated: false }, meds: { status: 'not_documented', populated: false },
                 allergies: { status: 'found', populated: true } },
        sourceEvidence: { briefing: 'absent', briefChars: 0, problemsSurface: 0, medsSurface: 0, at: Date.now() }
      } },
    /* NOT PULLED — no chart has ever landed. */
    { id: 'syn-cold', name: 'Dee Sample', dob: '1970-01-02', mrn: 'MRN900004',
      problems: '', meds: '', allergies: '', visits: [] },
    /* FIVE visits, for the collapse-to-three timeline. */
    { id: 'syn-five', name: 'Eli Sample', dob: '1966-11-11', mrn: 'MRN900005',
      problems: 'Cervical radiculopathy', meds: '', allergies: 'NKDA',
      athenaChartImportedAt: '2026-08-17T12:00:00.000Z',
      visits: [1, 2, 3, 4, 5].map(function (i) {
        return { id: 'f' + i, date: '2026-0' + i + '-0' + i, type: 'Office visit',
          raw: 'Visit ' + i + ' body text for the timeline.', source: 'athena-copy', encounterId: 'fenc-' + i };
      }) },
    /* EMPTY — no visits at all, for the single-empty-state check. */
    { id: 'syn-empty', name: 'Fay Sample', dob: '1980-05-05', mrn: 'MRN900006',
      problems: '', meds: '', allergies: '', visits: [] }
  ];

  var NOTES = [
    /* same DAY as v1 above: must ENRICH that entry, never add a second */
    { id: 'n1', patientId: 'syn-split', date: '2026-08-10', cc: 'Back pain follow-up',
      text: 'Recorded in MLS on the same day as the pulled Athena row.', updated: 3 },
    /* its own day: must add one */
    { id: 'n2', patientId: 'syn-split', date: '2026-06-15', cc: 'Medication review',
      text: 'Recorded in MLS.', updated: 2 },
    /* a DRAFT is not a visit */
    { id: 'n3', patientId: 'syn-split', date: '2026-08-16', cc: 'Draft', isDraft: true,
      text: 'Unfinished.', updated: 1 }
  ];

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }

  window.__pvr = {
    visible: visible,
    seed: function () {
      var out = {};
      try { savePatients(PATIENTS.map(function (p) { return JSON.parse(JSON.stringify(p)); })); out.patients = getPatients().length; }
      catch (e) { out.ptErr = String(e && e.message); }
      try { saveNotes(NOTES.slice()); out.notes = (getNotes() || []).length; }
      catch (e) { out.noteErr = String(e && e.message); }
      window._calAppts = [
        { id: 'a1', name: 'Ada Sample', patient_external_id: 'syn-split', appt_date: DAY,
          start_at: DAY + 'T11:00:00', reason: 'Follow-up', dob: '1962-03-04' }
      ];
      try { renderPatients(); } catch (e) {}
      return out;
    },
    /* The Patients room must be the VISIBLE view: both the timeline module and
       pf2 bail on `profileCard.offsetParent === null`, so a measurement taken
       from another screen reads null for two of the three counters and looks
       exactly like a broken resolver. */
    toPatients: function () {
      try { var n = document.getElementById('nav_patients'); if (n) n.click(); } catch (e) {}
      try { if (typeof showView === 'function') showView('patients'); } catch (e) {}
      var pc = document.getElementById('profileCard');
      return { view: !!(document.getElementById('patientsView') && visible(document.getElementById('patientsView'))),
               card: !!(pc && pc.offsetParent !== null) };
    },
    /* pf2 ships the profile COLLAPSED (mls_pf2_collapsed defaults to '1'), which
       is why the strip is the surface that matters — but it also means the
       timeline below it is display:none until the doctor expands. Expand, or
       every visibility measurement below reads zero for the wrong reason. */
    expand: function () {
      try { localStorage.setItem('mls_pf2_collapsed', '0'); } catch (e) {}
      var pc = document.getElementById('profileCard');
      if (pc) pc.classList.remove('pf2-collapsed');
      var secs = document.querySelectorAll('#profileCard .pf2-sec');
      for (var i = 0; i < secs.length; i++) secs[i].classList.add('open');
      /* MEASURED: feat_mls_calm_shell.js also folds every profile section
         ("body.mls-calm #profileCard .mls-fold:not(.mls-open) > :not(:first-child)
         {display:none}"), so the timeline's own content is display:none even
         with pf2 expanded and its own collapse flag false. Without this the
         visibility numbers below read zero for a reason that has nothing to do
         with this lane. */
      var folds = document.querySelectorAll('#profileCard .mls-fold');
      for (var j = 0; j < folds.length; j++) folds[j].classList.add('mls-open');
      var content = document.querySelector('#mlsVisitHistoryExt .mlsxh-content');
      if (content) content.hidden = false;
      return !!(pc && !pc.classList.contains('pf2-collapsed') && content && getComputedStyle(content).display !== 'none');
    },
    open: function (id) {
      try { var n = document.getElementById('nav_patients'); if (n) n.click(); } catch (e) {}
      try { setActivePtId(id); } catch (e) {}
      try { renderProfile(); } catch (e) {}
      try { renderPatients(); } catch (e) {}
      try { if (window.__mlsVisitHistoryExt) window.__mlsVisitHistoryExt.rebuild(true); } catch (e) {}
      try { if (window.__mlsProfileCalm) window.__mlsProfileCalm.pass(); } catch (e) {}
      return String(id);
    },
    /* the three numbers, read off the SCREEN, not off the resolver */
    counts: function () {
      function num(txt) { var m = String(txt || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; }
      var panel = document.querySelector('#mlsVisitHistoryExt .mlsxh-count');
      var glance = document.querySelector('#profAtGlance span b');
      var strip = null;
      var qbs = document.querySelectorAll('#pf2Quick .qb');
      for (var i = 0; i < qbs.length; i++) {
        var k = qbs[i].querySelector('.qk');
        if (k && String(k.textContent).trim() === 'Visits') { strip = qbs[i].querySelector('.qv'); break; }
      }
      return {
        panel: panel ? num(panel.textContent) : null,
        glance: glance ? num(glance.textContent) : null,
        strip: strip ? num(strip.textContent) : null,
        stripText: strip ? String(strip.textContent) : '',
        resolver: (window.__mlsPtVisits ? window.__mlsPtVisits.resolve(activePatient()).count : null)
      };
    },
    resolveActive: function () {
      var r = window.__mlsPtVisits.resolve(activePatient());
      return { count: r.count, stored: r.stored, notes: r.notes, sources: r.sources,
               dates: r.entries.map(function (e) { return e.date; }),
               bodies: r.entries.map(function (e) { return (e.body || '').length; }) };
    },
    field: function (key) {
      var st = window.__mlsChartField.state(activePatient(), key);
      return { state: st.state, text: st.text, canRead: !!st.canRead };
    },
    /* what the chip actually shows for a field */
    chip: function (label) {
      var qbs = document.querySelectorAll('#pf2Quick .qb');
      for (var i = 0; i < qbs.length; i++) {
        var k = qbs[i].querySelector('.qk');
        if (k && String(k.textContent).trim() === label) {
          var v = qbs[i].querySelector('.qv');
          return { text: v ? String(v.textContent) : '', state: qbs[i].getAttribute('data-pvr-state') || '',
                   hasRead: !!qbs[i].querySelector('.pvr-read'), quiet: qbs[i].classList.contains('is-quiet') };
        }
      }
      return null;
    },
    /* Making the copy controls read as ONE secondary action must not take the
       only "Add a visit" with it: on a chart that already has visits the empty
       state is gone, and the copy bar's button is then the only one there is. */
    /* Measures the CSS DECISION rather than a button count: feat_ease and the
       copy bar are conditional modules that may not be present in a harness,
       and "0 buttons because the module never loaded" would look identical to
       "0 buttons because this lane hid the last one". The decision is the part
       this lane owns and the part that can regress. */
    addPaths: function () {
      var empty = !!document.querySelector('#mlsVisitHistoryExt .mlsxh-empty');
      var bodyEmpty = !!(document.body && document.body.classList.contains('pvr-empty'));
      var bar = document.getElementById('mlsCopyVisitsBar');
      if (!bar) { bar = document.createElement('div'); bar.id = 'mlsCopyVisitsBar';
        var pc = document.getElementById('profileCard'); if (pc) pc.appendChild(bar); }
      /* a stand-in carrying the exact id the rule targets, so the CSS decision
         is measurable even when feat_ease did not load in this harness */
      var ease = document.getElementById('mlsEaseAddVisit');
      if (!ease && bar) { ease = document.createElement('button'); ease.id = 'mlsEaseAddVisit'; ease.textContent = '➕ Add a visit'; bar.appendChild(ease); }
      var why = [];
      try {
        for (var s = 0; s < document.styleSheets.length; s++) {
          var rs; try { rs = document.styleSheets[s].cssRules; } catch (e) { continue; }
          if (!rs) continue;
          for (var r = 0; r < rs.length; r++) {
            var rule = rs[r];
            if (!rule.selectorText || !rule.style || String(rule.style.display || '') !== 'none') continue;
            try { if (ease && ease.matches(rule.selectorText)) why.push(rule.selectorText); } catch (e2) {}
          }
        }
      } catch (e3) {}
      /* Only THIS lane's rule is this lane's business. Another module already
         hides profile-card extras in visit-focus mode
         ("body.mls-vfocus:not(.vf-ptmore) #patientsView #profileCard .mls-moved"),
         so a raw display test measures that module and would fail here for a
         reason nothing in this lane can fix. */
      var mine = 0;
      for (var w = 0; w < why.length; w++) if (why[w].indexOf('pvr-empty') >= 0) mine++;
      return { empty: empty, bodyEmpty: bodyEmpty, why: why, pvrHides: mine > 0,
               inDoc: !!(ease && document.contains(ease)),
               easeHidden: ease ? (getComputedStyle(ease).display === 'none') : null };
    },
    emptyStates: function () {
      var host = document.getElementById('mlsVisitHistoryExt') || document.getElementById('profileCard');
      if (!host) return -1;
      var n = 0, all = host.querySelectorAll('div,span,p');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        /* leaf nodes only, so a wrapper does not count its own child's text */
        if (el.children.length) continue;
        if (String(el.textContent).trim().toLowerCase().indexOf('no visits yet') !== 0) continue;
        if (!visible(el)) continue;
        n++;
      }
      return n;
    },
    timeline: function () {
      var list = document.querySelector('#mlsVisitHistoryExt .mlsxh-list');
      if (!list) return null;
      /* The visit CARDS. renderList groups them under a <details> per year, so
         counting the list's direct children counts year groups, not visits. */
      var cards = list.querySelectorAll('.mlsxh-card');
      var rows = cards.length, hidden = 0, dated = 0;
      for (var i = 0; i < cards.length; i++) {
        if (!visible(cards[i])) hidden++;
        if (cards[i].querySelector('.mlsxh-cdate')) dated++;
      }
      var btn = list.querySelector('.pvr-showall');
      return { rows: rows, shown: rows - hidden, dated: dated,
               hasBtn: !!btn, btnText: btn ? btn.textContent : '' };
    },
    showAll: function () {
      var btn = document.querySelector('#mlsVisitHistoryExt .pvr-showall');
      if (btn) btn.click();
      return true;
    },
    /* a REAL banner from the REAL module, then the de-identifier */
    banner: function (name) {
      if (!window.__mlsSaveVerify || typeof window.__mlsSaveVerify.banner !== 'function') return { skipped: true };
      window.__mlsSaveVerify.banner('ok', '✓ Saved & verified: ' + name, ['2 visits stored.'], { ttl: 0 });
      var host = document.getElementById('mls-save-verify-stack');
      var before = host ? String(host.textContent) : '';
      var changed = window.__mlsProfileCalm.deidentify();
      var after = host ? String(host.textContent) : '';
      return { before: before, after: after, changed: changed,
               namedBefore: before.indexOf(name) >= 0, namedAfter: after.indexOf(name) >= 0 };
    },
    /* THE CAUSAL CONTROL. Undo the block, force every owner to repaint from its
       own code, and read the same three numbers off the same screen. */
    /* THE CAUSAL CONTROL. revert() withdraws all three globals the block
       published, so pf2 falls back to lastVisitInfo and qtxt exactly as it did
       before this lane, and every owner repaints from its own code. Force a
       fresh strip paint by clearing the signature pf2 uses to skip work. */
    control: function () {
      window.__mlsProfileCalm.revert();
      try { var q = document.getElementById('pf2Quick'); if (q) q.setAttribute('data-sig', ''); } catch (e) {}
      try { renderProfile(); } catch (e) {}
      try { window.dispatchEvent(new Event('mls:active-patient-changed')); } catch (e) {}
      try { if (window.__mlsVisitHistoryExt) window.__mlsVisitHistoryExt.rebuild(true); } catch (e) {}
      return { visits: !!window.__mlsPtVisits, field: !!window.__mlsChartField };
    },
    busy: function () {
      var pc = document.getElementById('profileCard');
      if (!pc) return null;
      return { nodes: pc.querySelectorAll('*').length,
               buttons: pc.querySelectorAll('button').length,
               visibleButtons: Array.prototype.filter.call(pc.querySelectorAll('button'), visible).length,
               dashes: Array.prototype.filter.call(pc.querySelectorAll('#pf2Quick .qv'), function (v) { return String(v.textContent).trim() === '—'; }).length };
    }
  };
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));

  try {
    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    /* THE STEP WITHOUT WHICH THIS SUITE MEASURES A BARE SHELL. */
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    });
    await page.evaluate(() => { window.__mlsHarnessAccountEmail = 'pvr-harness@mlsscribe.test'; });
    await page.evaluate(harness);

    /* The three published APIs actually exist on the page (not just in bytes). */
    const apis = await page.evaluate(() => ({
      visits: !!(window.__mlsPtVisits && window.__mlsPtVisits.version),
      field: !!(window.__mlsChartField && window.__mlsChartField.version),
      calm: !!(window.__mlsProfileCalm && window.__mlsProfileCalm.version),
      version: window.__mlsPtVisits && window.__mlsPtVisits.version
    }));
    ok(apis.visits && apis.field && apis.calm, `pvr-1.0.0 did not install: ${JSON.stringify(apis)}`);
    eq(apis.version, 'pvr-1.0.0', 'the installed block is not pvr-1.0.0');

    const seeded = await page.evaluate(() => window.__pvr.seed());
    eq(seeded.patients, 6, `the synthetic roster did not land: ${JSON.stringify(seeded)}`);
    eq(seeded.notes, 3, `the synthetic notes did not land: ${JSON.stringify(seeded)}`);

    /* -- 1. ONE RESOLVER, THREE STORES ---------------------------------- */
    /* The card only renders for an ACTIVE patient, so select before asking. */
    await page.evaluate(() => window.__pvr.open('syn-split'));
    await page.waitForTimeout(1200);
    const room = await page.evaluate(() => window.__pvr.toPatients());
    ok(room.card, `the profile card is not on screen, so nothing below measures the profile: ${JSON.stringify(room)}`);
    /* feat_visit_history_ext.js rides a deferred (idle) loader and rebuilds on
       a 3s fallback interval, so the timeline needs more than one tick. */
    await page.waitForFunction(() => !!document.querySelector('#mlsVisitHistoryExt .mlsxh-count'), null, { timeout: 30000 });
    await page.waitForTimeout(1600);

    const res = await page.evaluate(() => window.__pvr.resolveActive());
    measured.resolver = res;
    eq(res.stored, 2, `the resolver did not see both stored Athena rows: ${JSON.stringify(res)}`);
    eq(res.notes, 2, `the resolver must see 2 completed notes and skip the draft: ${JSON.stringify(res)}`);
    eq(res.count, 3, `two Athena rows + a note on a NEW day + a note on a KNOWN day must resolve to 3, got ${res.count} (${JSON.stringify(res)})`);
    eq(res.sources.athena, 2, `both Athena rows must be tagged athena: ${JSON.stringify(res.sources)}`);
    eq(res.sources.note, 1, `only the note on its own day may add a source row: ${JSON.stringify(res.sources)}`);
    eq(res.dates[0], '2026-08-10', `the timeline must be newest-first: ${JSON.stringify(res.dates)}`);
    ok(res.bodies[0] > 0, 'the resolved entry carries a scrubbed body for the expander');

    const counts = await page.evaluate(() => window.__pvr.counts());
    measured.countsAfter = counts;
    eq(counts.resolver, 3, 'the resolver disagrees with itself');
    eq(counts.panel, 3, `the Visit history panel says ${counts.panel}, the resolver says 3`);
    eq(counts.glance, 3, `the at-a-glance chip says ${counts.glance}, the resolver says 3`);
    eq(counts.strip, 3, `the pf2 VISITS tile says ${counts.strip}, the resolver says 3 (tile text: ${counts.stripText})`);

    /* -- 2. THE EMPTY-STATE MATRIX --------------------------------------- */
    const matrix = {};
    for (const [id, want] of [['syn-split', 'present'], ['syn-none', 'none'], ['syn-miss', 'not_captured'], ['syn-cold', 'not_pulled']]) {
      await page.evaluate((x) => window.__pvr.open(x), id);
      await page.waitForTimeout(900);
      const f = await page.evaluate(() => ({ problems: window.__pvr.field('problems'), meds: window.__pvr.field('meds') }));
      matrix[id] = f;
      eq(f.problems.state, want, `${id}: problems resolved to ${f.problems.state}, expected ${want}`);
      eq(f.meds.state, want === 'present' ? 'present' : want, `${id}: meds resolved to ${f.meds.state}, expected ${want}`);
    }
    measured.matrix = matrix;

    /* The two records that are BYTE-IDENTICAL apart from sourceEvidence must
       not produce the same sentence — that is the whole claim. */
    ok(matrix['syn-none'].problems.text !== matrix['syn-miss'].problems.text,
      'a chart Athena confirmed is clear and a chart whose problems surface was never read say the SAME sentence');
    ok(matrix['syn-none'].problems.text.toLowerCase().indexOf('none documented') >= 0,
      `the 'none' sentence must say so: ${matrix['syn-none'].problems.text}`);
    ok(matrix['syn-miss'].problems.text.toLowerCase().indexOf('not captured') >= 0,
      `the 'not_captured' sentence must say so: ${matrix['syn-miss'].problems.text}`);
    ok(matrix['syn-cold'].problems.text.toLowerCase().indexOf('not pulled') >= 0,
      `the 'not_pulled' sentence must say so: ${matrix['syn-cold'].problems.text}`);
    /* four states, four distinct sentences, none of them a dash */
    const sentences = ['syn-none', 'syn-miss', 'syn-cold'].map((k) => matrix[k].problems.text);
    eq(new Set(sentences).size, 3, `the three empty states must read differently: ${JSON.stringify(sentences)}`);
    for (const s of sentences) ok(s.trim() !== '—' && s.trim().length > 8, `an empty state is still a bare dash: ${JSON.stringify(s)}`);
    /* the two a re-read can fix offer one, the confirmed-clear one does not */
    eq(matrix['syn-none'].problems.canRead, false, 'a chart Athena confirmed is clear must not beg for a re-read');
    eq(matrix['syn-miss'].problems.canRead, true, 'a section that was never read must offer a re-read');
    eq(matrix['syn-cold'].problems.canRead, true, 'a chart that was never pulled must offer a re-read');

    /* And the STRIP renders those sentences rather than a dash. */
    await page.evaluate(() => window.__pvr.open('syn-miss'));
    await page.waitForTimeout(1200);
    const chip = await page.evaluate(() => ({ problems: window.__pvr.chip('Problems'), meds: window.__pvr.chip('Medications') }));
    measured.chip = chip;
    ok(chip.problems, 'the Problems chip is missing from the strip');
    ok(chip.problems.text.trim() !== '—', 'the Problems chip is still a bare em-dash');
    eq(chip.problems.state, 'not_captured', `the Problems chip state is ${chip.problems.state}`);
    eq(chip.problems.quiet, true, 'an unknown value must be rendered as quiet, not as a finding');
    ok(chip.meds && chip.meds.text.toLowerCase().indexOf('historical meds') >= 0,
      `the Medications chip must name the view that was not read: ${chip.meds && chip.meds.text}`);

    const busyAfter = await page.evaluate(() => window.__pvr.busy());
    measured.busyAfter = busyAfter;
    eq(busyAfter.dashes, 0, `${busyAfter.dashes} strip tiles still render a bare em-dash`);

    /* -- 3. A NOTICE MAY NOT NAME A PATIENT ------------------------------ */
    const notice = await page.evaluate(() => window.__pvr.banner('Ada Sample'));
    measured.notice = notice;
    if (notice.skipped) {
      ok(false, 'feat_save_verify did not load, so the PHI-free notice could not be proven');
    } else {
      ok(notice.namedBefore, 'the control failed: the real banner did not carry the name in the first place');
      eq(notice.namedAfter, false, `the save notice still names the patient: ${JSON.stringify(notice.after).slice(0, 200)}`);
      ok(notice.after.indexOf('Saved & verified') >= 0, 'the notice lost its meaning along with the name');
      ok(notice.after.indexOf('2 visits stored') >= 0, 'the notice lost its count');
    }

    /* -- 4. THE TIMELINE ------------------------------------------------- */
    await page.evaluate(() => window.__pvr.open('syn-five'));
    await page.waitForTimeout(1600);
    ok(await page.evaluate(() => window.__pvr.expand()), 'the profile would not expand, so nothing below it is visible');
    await page.waitForTimeout(1000);
    const tl = await page.evaluate(() => window.__pvr.timeline());
    measured.timeline = tl;
    ok(tl, 'the timeline did not render for a 5-visit chart');
    eq(tl.rows, 5, `the timeline rendered ${tl.rows} rows for 5 visits`);
    eq(tl.shown, 3, `the timeline must collapse to the latest 3, showed ${tl.shown}`);
    ok(tl.hasBtn, 'a collapsed timeline must offer "Show all"');
    ok(tl.btnText.indexOf('5') >= 0, `the "Show all" control must name the total: ${tl.btnText}`);
    await page.evaluate(() => window.__pvr.showAll());
    await page.waitForTimeout(500);
    const tl2 = await page.evaluate(() => window.__pvr.timeline());
    measured.timelineOpen = tl2;
    eq(tl2.shown, 5, `"Show all" showed ${tl2.shown} of 5`);

    /* ONE empty state on an empty chart (there were two). */
    await page.evaluate(() => window.__pvr.open('syn-empty'));
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__pvr.expand());
    await page.waitForTimeout(1000);
    const empties = await page.evaluate(() => window.__pvr.emptyStates());
    measured.emptyStates = empties;
    eq(empties, 1, `an empty chart shows ${empties} "No visits yet" empty states, must be exactly 1`);

    /* On an EMPTY chart the empty state owns the actions, so the bar's
       duplicate "Add a visit" steps aside. */
    const addEmpty = await page.evaluate(() => window.__pvr.addPaths());
    measured.addOnEmpty = addEmpty;
    eq(addEmpty.empty, true, 'an empty chart must be showing the timeline empty state');
    eq(addEmpty.bodyEmpty, true, 'the block did not record that the empty state is on screen');
    eq(addEmpty.pvrHides, true, 'with the empty state offering its own, this lane should stand the bar duplicate down');
    /* On a chart that HAS visits the empty state is gone, so the bar's button
       is the ONLY way to add one — quieting the copy controls may not take it. */
    await page.evaluate(() => window.__pvr.open('syn-five'));
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__pvr.expand());
    await page.waitForTimeout(1200);
    const addFull = await page.evaluate(() => window.__pvr.addPaths());
    measured.addOnFull = addFull;
    eq(addFull.empty, false, 'a 5-visit chart must not be showing an empty state');
    eq(addFull.bodyEmpty, false, 'the block still thinks the empty state is on screen');
    eq(addFull.pvrHides, false, 'a chart with visits lost its only "Add a visit" control to this lane');

    /* -- 5. THE CAUSAL CONTROL ------------------------------------------- */
    await page.evaluate(() => window.__pvr.open('syn-split'));
    await page.waitForTimeout(1400);
    const before = await page.evaluate(() => window.__pvr.counts());
    eq(before.panel, 3, 'the control run did not start from a coherent screen');

    /* BUSYNESS, on the same chart, before and after — the numbers the lead asked
       for. "after" is this block installed; "before" is the same page with it
       reverted, which is the only honest baseline because both are the same
       DOM built by the same modules. */
    await page.evaluate(() => window.__pvr.open('syn-miss'));
    await page.waitForTimeout(1400);
    measured.busyOn = await page.evaluate(() => window.__pvr.busy());
    await page.evaluate(() => window.__pvr.control());
    await page.waitForTimeout(1800);
    measured.busyOff = await page.evaluate(() => window.__pvr.busy());
    eq(measured.busyOn.dashes, 0, 'with the block on, no strip tile may be a bare dash');
    ok(measured.busyOff.dashes >= 2,
      `THE CONTROL PROVED NOTHING: reverted, the strip shows ${measured.busyOff.dashes} bare dashes; ` +
      'it showed at least two before this lane, so either the revert did not take or the dashes were never there');

    await page.evaluate(() => window.__mlsProfileCalm.install());
    await page.evaluate(() => window.__pvr.open('syn-split'));
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.__pvr.control());
    await page.waitForTimeout(1800);
    const ctrl = await page.evaluate(() => window.__pvr.counts());
    measured.countsControl = ctrl;
    const distinct = new Set([ctrl.panel, ctrl.glance, ctrl.strip].filter((x) => x !== null));
    ok(distinct.size > 1,
      `THE CONTROL PROVED NOTHING: with pvr-1.0.0 reverted the three surfaces still agree (${JSON.stringify(ctrl)}). ` +
      'Either the block is not what makes them agree, or the revert did not take.');
    eq(ctrl.panel, 2, `reverted, the panel must fall back to p.visits[].length = 2, got ${ctrl.panel}`);
    eq(ctrl.strip, 3, `reverted, the strip must fall back to the notes count INCLUDING the draft = 3, got ${ctrl.strip}`);

    /* the page must not have thrown on the way */
    const fatal = pageErrors.filter((m) => /__mlsPtVisits|__mlsChartField|__mlsProfileCalm|pvr/i.test(m));
    eq(fatal.length, 0, `pvr-1.0.0 threw at runtime: ${JSON.stringify(fatal)}`);
    measured.pageErrors = pageErrors.length;

  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`PASS 1p-profile-coherence: ${checks} checks — one resolver answers the Visit history panel, the ` +
    'at-a-glance chip and the pf2 VISITS tile with the same number over three stores (and the reverted control ' +
    'shows them disagreeing); the four chart-field states read as four different sentences and never as a bare ' +
    'dash, including the two records that differ ONLY by the receipt\'s sourceEvidence; the save notice no longer ' +
    'names a patient; the timeline collapses to the latest three with a working "Show all"; and an empty chart ' +
    'shows exactly one empty state');
}).catch((e) => {
  console.error('FAIL 1p-profile-coherence: ' + (e && e.message));
  console.error('MEASURED ' + JSON.stringify(measured));
  process.exit(1);
});
