'use strict';

/* /1p VISITS & ENCOUNTERS — histview-1.0.0
 *
 * Owner, 2026-08-18: "I like the legal report thing u added but needs some
 * work and like the visits and encounters is just random text basically. Also
 * fix that under the patient's history — make sure the visits and encounters
 * are there and actually look good."
 *
 * MEASURED at the base commit, on the two surfaces he named:
 *   - the History room renders SAVED NOTES only (#histList <- getNotes()). The
 *     encounters an Athena pull brings across live in p.visits[] and had no
 *     surface in that room at all: a chart with seven pulled encounters and no
 *     recorded note read "No saved visits yet".
 *   - the Legal workspace printed each encounter's whole captured body as one
 *     undated run of text — no date heading, no section labels, the athenaOne
 *     index line and the exam and the plan all in one grey blob.
 *
 * What this suite pins:
 *
 *   PART 1  static — the block is delimited once in BOTH twins, publishes its
 *           API, never schedules on rAF, does NOT re-count visits (pvr-1.0.0 is
 *           still the one resolver), and never leaves /1p.
 *   PART 2  vm — the renderer's pure functions are EXECUTED against the owner's
 *           own two junk samples, a three-header note, a header-less blob and a
 *           legal item set. Deterministic, no browser, no DOM.
 *   PART 3  a real Chrome page — the History room renders the resolver's
 *           encounters as dated cards, newest first, grouped, sectioned,
 *           folded, with the index-only and junk states said in plain words and
 *           NO junk literal anywhere in the DOM; the count matches the
 *           resolver; exactly ONE control glows; nothing scrolls sideways.
 *           Then the SAME renderer is proved to be the one the Legal report
 *           uses, by reading its stamp off the live module.
 *
 * Synthetic names only. No login, no network, no PHI, no Athena.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ============================================================ PART 1: static */

const OPEN = '<!-- ===== histview-1.0.0';
const CLOSE = '<!-- ===== end histview-1.0.0';

let blockJs = '';
for (const name of SHELLS) {
  const src = read(name);
  eq(src.split(OPEN).length - 1, 1, `${name}: ${OPEN} must open exactly once`);
  eq(src.split(CLOSE).length - 1, 1, `${name}: ${CLOSE} must close exactly once`);
  ok(src.indexOf(OPEN) < src.indexOf(CLOSE), `${name}: histview-1.0.0 closes before it opens`);

  const block = src.slice(src.indexOf(OPEN), src.indexOf(CLOSE));
  ok(block.indexOf('window.__mlsEncView = API') > 0, `${name}: the block must publish window.__mlsEncView`);
  /* The CODE, not the block's prose: the header comment names the very stores
     the code must not touch (that is what it is explaining), so a whole-block
     grep for them measures the explanation instead of the renderer. */
  const codeStart = block.indexOf('<script>', block.indexOf('</style>'));
  const code = block.slice(codeStart + 8, block.indexOf('</script>', codeStart));
  ok(code.length > 4000, `${name}: the block's script could not be isolated`);

  /* THE RESOLVER STAYS THE ONE RESOLVER. pvr-1.0.0 exists because four readers
     each had their own rule for "how many visits does this patient have" and
     the same chart truthfully reported 0, 1 and 3 at one instant. A renderer
     that counted its own list for a section header would be the fifth. */
  ok(block.indexOf('window.__mlsPtVisits') > 0, `${name}: the renderer must ask pvr-1.0.0 for the list`);
  ok(block.indexOf('out.count = Number(res.count) || 0') > 0,
    `${name}: the count must be the RESOLVER's count, taken as-is`);
  eq(code.indexOf('patientNotes('), -1, `${name}: the renderer must not read the note store itself`);
  eq(code.indexOf('getNotes('), -1, `${name}: the renderer must not read the note store itself`);
  eq(code.indexOf('p.visits'), -1, `${name}: the renderer must not read p.visits[] itself`);

  /* rAF never fires in a non-compositing tab; a UI controller must not CALL it,
     and the next reader learns why from the block's own words. */
  eq(block.indexOf('requestAnimationFrame('), -1, `${name}: histview-1.0.0 must not schedule on requestAnimationFrame`);
  ok(block.indexOf('requestAnimationFrame') > 0, `${name}: the block must record WHY it does not use rAF`);

  /* Both grades of junk have to be nameable from the source, because they get
     two different answers and a later reader will otherwise collapse them. */
  for (const token of ['illegible', 'flagged', 'JUNK_LINE', 'INDEX_LINE']) {
    ok(block.indexOf(token) > 0, `${name}: the block must name ${token}`);
  }

  /* The resolver must hand the ROW back, or the renderer has to go and find it
     again and can end up rendering a different row than the one that counted. */
  ok(src.indexOf('visitId: str(v.id), fromStore: \'visits\', hasNote: false,') > 0,
    `${name}: pvr-1.0.0 must carry the resolved visit row`);
  ok(src.indexOf('noteRow: n') > 0, `${name}: pvr-1.0.0 must carry the resolved note row`);

  if (name === '1pScribeFlow.html') {
    /* the block's own header comment quotes the words "script tag", so the JS
       is taken from after the stylesheet closes, exactly as static-site's
       HTML-unaware extractor now can */
    const afterStyle = block.indexOf('</style>');
    const s = block.indexOf('<script>', afterStyle);
    const e = block.indexOf('</script>', s);
    ok(s > 0 && e > s, 'the block carries exactly one script');
    blockJs = block.slice(s + 8, e);
  }
}

/* THE TWINS. */
{
  const canon = (v) => String(v)
    .replace("base-uri 'self'", "base-uri 'none'")
    .replace(/<!-- p1-live-1\.0\.0:[\s\S]*?<base href="\/1p">\r?\n/, '')
    .replace("route:'/1p/'", "route:'/1pScribeFlow.html'");
  eq(canon(read('1p/index.html')), read('1pScribeFlow.html'), 'the two /1p shells are no longer twins');
}

/* LANE NEUTRALITY — production must not have moved by one byte. */
for (const name of ['ScribeFlow.html', 'mls-connect.js', 'feat_mls_legalpack.js', 'feat_visits.js']) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  eq(src.indexOf('histview-1.0.0'), -1, `${name}: this lane's block leaked out of /1p`);
  eq(src.indexOf('__mlsEncView'), -1, `${name}: this lane's renderer leaked out of /1p`);
}

/* THE DETECTOR IS NOT FORKED: the legal pack asks the shell's renderer, and its
   own copy is demoted, in words, to the fallback its vm harness runs. */
{
  const legal = read('1p-feat_mls_legalpack.js');
  ok(legal.indexOf('window.__mlsEncView') > 0, 'the legal pack must reach for the shell renderer');
  ok(legal.indexOf('return shellScrub.scrub(body)') > 0, 'the legal pack must delegate scrubbing');
  ok(legal.indexOf('return shell.provider(row)') > 0, 'the legal pack must delegate provider extraction');
  ok(legal.indexOf('enc.reportSection(rows, { table: true })') > 0,
    'the exported "Visits & encounters" section must be built by the shared renderer');
  ok(legal.indexOf('encRow.textBlock(encRow.fromLegalItem(item), { head: false })') > 0,
    'the on-screen encounter body must be the shared renderer\'s sectioned text');
  ok(/OFFLINE FALLBACK/.test(legal), 'the legal pack must say IN WORDS that its own copy is only a fallback');
}

console.log(`PART 1 ok — ${checks} static checks`);

/* ================================================== PART 2: the renderer, run
   No DOM at all: the block must publish its API in a document-free realm, so
   these are the renderer's own decisions and not a page's. */

const api = (() => {
  const win = {};
  const ctx = { window: win, navigator: {}, setTimeout, clearTimeout, setInterval, clearInterval, console };
  vm.createContext(ctx);
  vm.runInContext(blockJs, ctx, { filename: 'histview-1.0.0' });
  return win.__mlsEncView;
})();
ok(api && api.version === 'histview-1.0.0', 'the renderer did not publish itself without a DOM');

/* -- the owner's OWN two screenshot samples ------------------------------- */
{
  const A = 'Office visit 02-02-2025\nrecently edited this chart at . Refresh to view the most current information.REFRESH CHART\n' +
    'Patient reports 6/10 low back pain radiating to the left calf.';
  const a = api.scrub(A);
  eq(a.by, 'histview-1.0.0', 'the scrubber does not stamp which detector ran');
  ok(!/REFRESH CHART|recently edited this chart/.test(a.text), 'the athenaOne banner survived cleaning');
  ok(/6\/10 low back pain radiating to the left calf/.test(a.text), 'the cleaner deleted the clinical line');
  eq(a.raw, A, 'the raw body was not preserved verbatim');
  eq(api.junk(A).illegible, false, 'a body with surviving clinical text was called illegible');

  /* the shape the screenshot actually shows: banner ON the clinical line */
  const inline = api.scrub('Assessment: lumbar radiculopathy. recently edited this chart at . Refresh to view the most current information.REFRESH CHART');
  ok(/Assessment: lumbar radiculopathy\./.test(inline.text),
    'a banner sharing a line with clinical text took the clinical text with it');

  const B = 'Print Premier Ortho and Philadelphia Hand to Shoulder\nwindow.Original = {}; window.Original.IsSafari = IsSafari;\n' +
    'Jotter = function(params) { var svgjottercontainerid = params.div; }\nImpression: L5-S1 disc herniation with left S1 radiculopathy.';
  const b = api.scrub(B);
  ok(!/window\.Original|IsSafari|Jotter|svgjottercontainerid|Print Premier Ortho/.test(b.text), 'captured page script survived cleaning');
  ok(/L5-S1 disc herniation with left S1 radiculopathy\./.test(b.text), 'the cleaner deleted the clinical impression');

  /* a body that is ENTIRELY junk: refused, and graded illegible */
  const allJunk = 'REFRESH CHART\nrecently edited this chart at .';
  eq(api.scrub(allJunk).refused, true, 'an entirely-suppressed body did not fall back to raw');
  eq(api.junk(allJunk).illegible, true, 'an entirely-junk body was not graded illegible');

  /* NEVER delete a clinical line — the near-misses a greedy pattern eats */
  ['Exam: loss of function (grade 3) in the left wrist.',
   'Patient function (ADLs) unchanged since the last visit.',
   'Discussed the variable response to the epidural injection.',
   'MRI window for repeat imaging is 6 weeks.',
   'The patient will print the work note at the front desk.'].forEach((line) => {
    const kept = api.scrub('Header\n' + line + '\nFooter');
    ok(kept.text.indexOf(line) >= 0, `the cleaner deleted a clinical line: ${JSON.stringify(line)}`);
    eq(kept.removed, 0, `the cleaner flagged a clinical line: ${JSON.stringify(line)}`);
  });
}

/* -- the parse: a note is never one grey blob again ----------------------- */
{
  const raw = 'SUBJECTIVE: Low back pain, 6/10, radiating to the left calf.\nWorse with sitting.\n' +
    'OBJECTIVE:\nStraight leg raise positive on the left.\n- Motor 5/5\n- Sensation intact\n' +
    'ASSESSMENT: L5-S1 disc herniation with left S1 radiculopathy.\n' +
    'PLAN: Transforaminal epidural steroid injection; recheck in 4 weeks.';
  const blocks = api.parseBody(raw);
  /* JSON round-trip: values crossing the vm realm carry THAT realm's
     prototypes, so a strict deep-equal fails on identity, not on content. */
  measured.parsedLabels = JSON.parse(JSON.stringify(blocks.map((b) => b.label)));
  assert.deepStrictEqual(measured.parsedLabels, ['Subjective', 'Objective', 'Assessment', 'Plan'],
    `a four-header note parsed into ${JSON.stringify(measured.parsedLabels)}`);
  checks++;
  const objective = blocks[1];
  ok(objective.parts.some((p) => p.list && p.list.length === 2), 'the bullet run under OBJECTIVE did not become a list');

  /* header-less: still paragraphs, never one blob */
  const blob = 'Patient returns for follow-up of right knee pain. ' +
    'Injection given four weeks ago with good relief. '.repeat(8) + 'Continue home exercise.';
  const flat = api.parseBody(blob);
  eq(flat.length, 1, 'a header-less body produced more than one section');
  ok(flat[0].parts.length >= 2, `a 500-character single-line body stayed one blob (${flat[0].parts.length} paragraph)`);
  measured.blobParagraphs = flat[0].parts.length;
}

/* -- the report section, with its ONE footnote ---------------------------- */
{
  const legible = 'ASSESSMENT: L5-S1 disc herniation.\nPLAN: Epidural steroid injection.';
  const built = api.reportSection([
    { date: '2026-08-10', title: 'Office visit', provider: 'M Sample', source: 'Stored visit', body: legible },
    { date: '2026-02-02', title: 'Injection', provider: 'M Sample', source: 'Stored visit', body: 'REFRESH CHART\nrecently edited this chart at .' }
  ]);
  eq(built.omitted, 1, 'the illegible encounter was not counted');
  ok(/AT A GLANCE/.test(built.text), 'the chronology has no scannable table');
  ok(/^DATE\s+TYPE\s+PROVIDER\s+IMPRESSION$/m.test(built.text), 'the table has no column header');
  ok(built.text.indexOf('2026-02-02') < built.text.indexOf('2026-08-10'), 'the table is not in date order');
  ok(/1 encounter was not legible at export time/.test(built.text), 'the omission is silent');
  ok(!/REFRESH CHART/.test(built.text), 'the EMR banner reached the exported report');
  ok(/ {2}ASSESSMENT\n {4}L5-S1 disc herniation\./.test(built.text), 'the readable encounter lost its labelled sections');
  measured.reportSection = built.text.split('\n').length;
}

console.log(`PART 2 ok — ${checks} checks (renderer executed without a DOM)`);

/* =========================================================== PART 3: runtime */

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

/* Injected into the page. Synthetic names only. */
function harness() {
  var LONG = ['SUBJECTIVE: Neck pain for six months, worse overhead.',
    'Radiates to the right shoulder.', 'No bowel or bladder change.',
    'OBJECTIVE:', 'Spurling positive on the right.', 'Strength 5/5 throughout.',
    'Reflexes 2+ and symmetric.', 'Gait normal.', 'No clonus.',
    'ASSESSMENT: Cervical radiculopathy, C6 distribution.',
    'PLAN: Cervical epidural steroid injection.', 'Home exercise programme.',
    'Continue gabapentin.', 'Recheck in six weeks.', 'Return sooner for weakness.',
    'Work note provided.', 'Imaging reviewed with the patient.'].join('\n');
  var JUNK = 'REFRESH CHART\nrecently edited this chart at .';
  var MIXED = 'recently edited this chart at . Refresh to view the most current information.REFRESH CHART\n' +
    'window.Original = {}; IsSafari = function(){ return 0; }\nAssessment: lumbar radiculopathy, left S1.';

  var PATIENTS = [
    { id: 'hx-full', name: 'Ada Sample', dob: '1962-03-04', mrn: 'MRN700001',
      problems: 'Lumbar spinal stenosis', meds: 'Gabapentin 300 mg', allergies: 'NKDA',
      athenaChartImportedAt: '2026-08-18T12:00:00.000Z',
      visits: [
        /* 1. STRUCTURED: the reader's own fields, plus a sectioned body */
        { id: 'v1', date: '2026-08-10', type: 'Office visit', provider: 'M Sample, DO',
          raw: 'FINDINGS: Tender over the left L5 paraspinals.\nASSESSMENT: Low back pain with left L5 radiculopathy.\nPLAN: Transforaminal epidural steroid injection.',
          cpt: ['64483'], icd10: ['M54.16 - Radiculopathy, lumbar region'],
          meds: ['Gabapentin 300 mg TID'], findings: '', plan: '',
          scores: { 'Pain (NRS)': '6/10', 'Oswestry': '38%' },
          source: 'athena-copy', encounterId: 'hx-e1' },
        /* 2. DETAIL ONLY: no structured field at all, three headers in `detail` */
        { id: 'v2', date: '2026-07-05', type: 'Follow-up', provider: 'M Sample, DO',
          detail: 'SUBJECTIVE: Improved since the injection.\nOBJECTIVE: Straight leg raise negative.\nPLAN: Continue home exercise; recheck in three months.',
          source: 'athena-copy', encounterId: 'hx-e2' },
        /* 3. INDEX ONLY: the encounter index row was read, the note was not */
        { id: 'v3', date: '2026-06-02', type: 'Injection', indexOnly: true, raw: '',
          textHead: '06-02-2026, M Sample, DO, Orthopedic Surgery',
          source: 'athena-copy', encounterId: 'hx-e3' },
        /* 4. PURE JUNK: nothing survives cleaning */
        { id: 'v4', date: '2026-05-04', type: 'Office visit', raw: JUNK,
          source: 'athena-copy', encounterId: 'hx-e4' },
        /* 5. MIXED JUNK: junk AND a real assessment */
        { id: 'v5', date: '2026-04-06', type: 'Office visit', raw: MIXED,
          source: 'athena-copy', encounterId: 'hx-e5' },
        /* 6. LONG: seventeen lines, so the fold has something to fold */
        { id: 'v6', date: '2026-03-02', type: 'Consultation', provider: 'M Sample, DO',
          raw: LONG, source: 'athena-copy', encounterId: 'hx-e6' },
        /* 7. a short one, to take the list past the five-card fold */
        { id: 'v7', date: '2026-02-02', type: 'Office visit', provider: 'M Sample, DO',
          raw: 'Routine follow-up. No new complaints.', source: 'athena-copy', encounterId: 'hx-e7' }
      ] },
    { id: 'hx-empty', name: 'Bea Sample', dob: '1970-01-02', mrn: 'MRN700002',
      problems: '', meds: '', allergies: '', visits: [] }
  ];
  /* one MLS note, on its own day: the eighth encounter, and the MLS badge */
  var NOTES = [{ id: 'hx-n1', patientId: 'hx-full', date: '2026-01-15', cc: 'Medication review',
    text: 'SUBJECTIVE: Tolerating gabapentin.\nPLAN: Continue current dose.', updated: 5 }];

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    return !(cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0');
  }
  function section() { return document.getElementById('mlsHxSection'); }

  window.__hx = {
    seed: function () {
      var out = {};
      try { savePatients(PATIENTS.map(function (p) { return JSON.parse(JSON.stringify(p)); })); out.patients = getPatients().length; }
      catch (e) { out.ptErr = String(e && e.message); }
      try { saveNotes(NOTES.slice()); out.notes = (getNotes() || []).length; }
      catch (e) { out.noteErr = String(e && e.message); }
      return out;
    },
    open: function (id) {
      try { var n = document.getElementById('nav_history'); if (n) n.click(); } catch (e) {}
      try { if (id) setActivePtId(id); else if (typeof deselectPatient === 'function') deselectPatient(); } catch (e) {}
      try { renderHistory(); } catch (e) {}
      try { if (window.__mlsEncView) window.__mlsEncView.paint(true); } catch (e) {}
      return String(id || '');
    },
    /* what the SECTION says, read off the screen */
    read: function () {
      var host = section();
      if (!host) return null;
      var cards = host.querySelectorAll('.hx-card');
      var out = { hidden: !!host.hidden, count: host.querySelector('[data-hx-count]') ? host.querySelector('[data-hx-count]').textContent : '',
        cards: cards.length, shown: 0, dates: [], groups: [], keys: [], indexCards: 0, junkCards: 0,
        all: !!host.querySelector('[data-hx-all]'), allText: '', copies: host.querySelectorAll('[data-hx-copy]').length,
        reads: host.querySelectorAll('[data-hx-read]').length, mores: host.querySelectorAll('[data-hx-more]').length };
      var allBtn = host.querySelector('[data-hx-all]');
      out.allText = allBtn ? String(allBtn.textContent) : '';
      for (var i = 0; i < cards.length; i++) {
        if (visible(cards[i])) out.shown++;
        var d = cards[i].querySelector('.hx-date');
        out.dates.push(d ? String(d.textContent) : '');
        out.keys.push(cards[i].getAttribute('data-hx-key'));
        if (cards[i].getAttribute('data-hx-index') === '1') out.indexCards++;
        if (cards[i].getAttribute('data-hx-junk') === '1') out.junkCards++;
      }
      var heads = host.querySelectorAll('.hx-gh');
      for (var g = 0; g < heads.length; g++) out.groups.push(String(heads[g].textContent));
      out.text = String(host.innerText || '');
      return out;
    },
    /* one card, by the visit id its resolver key carries */
    card: function (nth) {
      var host = section(); if (!host) return null;
      var cards = host.querySelectorAll('.hx-card');
      var c = cards[nth]; if (!c) return null;
      var labels = [], ls = c.querySelectorAll('.hx-sl');
      for (var i = 0; i < ls.length; i++) labels.push(String(ls[i].textContent));
      return { key: c.getAttribute('data-hx-key'), index: c.getAttribute('data-hx-index') === '1',
        junk: c.getAttribute('data-hx-junk') === '1', illegible: c.getAttribute('data-hx-illegible') === '1',
        date: (c.querySelector('.hx-date') || {}).textContent || '',
        type: (c.querySelector('.hx-type') || {}).textContent || '',
        provider: (c.querySelector('.hx-prov') || {}).textContent || '',
        source: (c.querySelector('.hx-src') || {}).textContent || '',
        labels: labels, paras: c.querySelectorAll('.hx-p').length,
        lists: c.querySelectorAll('.hx-ul').length,
        more: !!c.querySelector('[data-hx-more]'),
        restHidden: (function () { var r = c.querySelector('.hx-rest'); return r ? !!r.hidden : null; })(),
        read: !!c.querySelector('[data-hx-read]'),
        /* innerText leaves the folded tail out, which is the point of a fold —
           so anything that may live past the twelve-line cut is measured on
           the markup instead. */
        text: String(c.innerText || ''), html: String(c.innerHTML || '') };
    },
    click: function (selector) {
      var host = section(); if (!host) return false;
      var el = host.querySelector(selector); if (!el) return false;
      el.click(); return true;
    },
    /* scoped to ONE card: the section-wide click lands on the first match,
       which is a different encounter's control */
    clickIn: function (nth, selector) {
      var host = section(); if (!host) return false;
      var card = host.querySelectorAll('.hx-card')[nth]; if (!card) return false;
      var el = card.querySelector(selector); if (!el) return false;
      el.click(); return true;
    },
    /* the junk literals, hunted across the WHOLE room, not just the section */
    junkInRoom: function () {
      var room = document.getElementById('historyView');
      var t = room ? (room.innerText || '') + ' ' + room.innerHTML : '';
      var hits = [];
      ['REFRESH CHART', 'recently edited this chart', 'IsSafari', 'window.Original', 'svgjotter'].forEach(function (needle) {
        if (t.indexOf(needle) >= 0) hits.push(needle);
      });
      return hits;
    },
    taps: function () {
      var host = section(); if (!host) return [];
      var small = [];
      var btns = host.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (!visible(btns[i])) continue;
        var r = btns[i].getBoundingClientRect();
        if (Math.min(r.width, r.height) < 40) small.push((btns[i].textContent || '').trim().slice(0, 24) + ':' + Math.round(Math.min(r.width, r.height)));
      }
      return small;
    },
    overflow: function () { return document.documentElement.scrollWidth - window.innerWidth; },
    say: function () { var host = section(); var s = host ? host.querySelector('.hx-say') : null; return s ? String(s.textContent) : ''; },
    resolver: function () {
      var p = activePatient();
      var r = window.__mlsPtVisits.resolve(p);
      var view = window.__mlsEncView.forPatient(p);
      return { count: r.count, viewCount: view.count, records: view.records.length,
        indexOnly: view.indexOnly, junk: view.junk, line: window.__mlsEncView.countLine(view) };
    },
    /* the legal side, on the SAME page and the SAME renderer */
    legal: function () {
      var pack = window.__mlsP1LegalPack;
      if (!pack || !pack.installed) return { skipped: 'legal pack not installed' };
      var stamp = null;
      try { stamp = pack.scrubBody('REFRESH CHART\nAssessment: lumbar radiculopathy.'); } catch (e) {}
      /* The workspace is clinical-users-only and this harness never signs in,
         so the eligibility the real app gets from a session is planted here.
         Nothing else about the module is relaxed. */
      var opened = false, text = '', access = '';
      try { window.bkUser = { role: 'doctor', isAdmin: false }; } catch (e) {}
      try { opened = pack.open(); } catch (e) { access = String(e && e.message); }
      try { var c = document.getElementById('mlsP1LegalCompile'); if (c) c.click(); } catch (e) {}
      try { text = pack.chronologyText(); } catch (e) { text = 'ERR ' + (e && e.message); }
      /* `bkUser` is a module-scoped binding in the shell, so a harness cannot
         hand this workspace the signed-in clinical session openOverlay()
         requires — and that gate is one this lane must not weaken. When the
         overlay stays shut, the SAME live module still builds the SAME model
         from the SAME chart, and the live renderer builds the report section
         from it: end to end, through both real modules, with only the session
         missing. Which path ran is reported, never hidden. */
      var built = 'model';
      if (!text) {
        try {
          var p = activePatient();
          var model = pack.buildModel(JSON.parse(JSON.stringify(p)),
            { patientId: String(p.id), name: String(p.name), dob: String(p.dob), mrn: String(p.mrn || '') });
          var visitItems = model.items.filter(function (it) { return it.category === 'visit'; });
          text = 'VISITS & ENCOUNTERS (' + visitItems.length + ')\n' +
            window.__mlsEncView.reportSection(visitItems, { table: true }).text;
        } catch (e2) { text = 'ERR ' + (e2 && e2.message); built = 'failed'; }
      } else built = 'overlay';
      var painted = '';
      try { var node = document.getElementById('mlsP1LegalChronology'); painted = node ? node.innerHTML : ''; } catch (e) {}
      try { pack.close(); } catch (e) {}
      return { stamp: stamp ? stamp.by : '', opened: opened, access: access, built: built, text: text, painted: painted };
    }
  };
}

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 180)));

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
      window.__mlsHarnessAccountEmail = 'histview-harness@mlsscribe.test';
    });
    await page.evaluate(harness);

    const live = await page.evaluate(() => ({
      enc: window.__mlsEncView ? window.__mlsEncView.version : '',
      pvr: window.__mlsPtVisits ? window.__mlsPtVisits.version : ''
    }));
    eq(live.enc, 'histview-1.0.0', 'histview-1.0.0 did not install on the running page');
    eq(live.pvr, 'pvr-1.0.0', 'the one visit resolver is not on the page, so nothing below measures the real list');

    const seeded = await page.evaluate(() => window.__hx.seed());
    eq(seeded.patients, 2, `the synthetic roster did not land: ${JSON.stringify(seeded)}`);
    eq(seeded.notes, 1, `the synthetic note did not land: ${JSON.stringify(seeded)}`);

    /* -- 1. THE VISITS ARE THERE ---------------------------------------- */
    await page.evaluate(() => window.__hx.open('hx-full'));
    await page.waitForFunction(() => {
      const n = document.getElementById('mlsHxSection');
      return !!(n && !n.hidden && n.querySelectorAll('.hx-card').length);
    }, null, { timeout: 30000 });
    await page.waitForTimeout(600);

    const res = await page.evaluate(() => window.__hx.resolver());
    measured.resolver = res;
    eq(res.count, 8, `the resolver sees ${res.count} encounters on the seeded chart, expected 8`);
    eq(res.viewCount, res.count, 'the renderer disagrees with the resolver about the count');
    eq(res.records, 8, `the renderer built ${res.records} cards for ${res.count} encounters`);
    eq(res.indexOnly, 1, `${res.indexOnly} index-only encounters, expected 1`);
    eq(res.junk, 2, `${res.junk} flagged encounters, expected 2`);

    const view = await page.evaluate(() => window.__hx.read());
    measured.view = { count: view.count, cards: view.cards, shown: view.shown, groups: view.groups.length,
      allText: view.allText, copies: view.copies, reads: view.reads, mores: view.mores };
    eq(view.hidden, false, 'the section is hidden on a chart that has encounters');
    eq(view.cards, 8, `${view.cards} cards rendered for 8 encounters`);
    eq(view.count, res.line, `the header says "${view.count}" and the resolver says "${res.line}"`);
    ok(/^8 visits · 1 index only · 2 being cleaned$/.test(view.count),
      `the header count is not the honest line: "${view.count}"`);

    /* newest first, and grouped by the month it happened in */
    const order = view.dates.map((d) => Date.parse(d));
    for (let i = 1; i < order.length; i++) {
      ok(order[i - 1] >= order[i],
        `the list is not newest-first: "${view.dates[i - 1]}" comes before "${view.dates[i]}"`);
    }
    ok(view.groups.length >= 2, `the list is not grouped by month (${view.groups.length} heading)`);
    eq(view.groups[0], 'August 2026', `the first month heading is "${view.groups[0]}"`);
    ok(/^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}$/.test(view.dates[0]),
      `a card's date is not a weekday-month-day-year line: "${view.dates[0]}"`);

    /* -- 2. THE BODY IS SECTIONS, NOT A BLOB ---------------------------- */
    const structured = await page.evaluate(() => window.__hx.card(0));
    measured.structuredCard = { labels: structured.labels, paras: structured.paras, lists: structured.lists, source: structured.source };
    eq(structured.source, 'Athena', `the source badge reads "${structured.source}"`);
    ok(structured.provider.indexOf('M Sample') >= 0, `the provider is missing from the card head: "${structured.provider}"`);
    for (const label of ['Findings', 'Assessment', 'Plan', 'Medications', 'Diagnoses (ICD-10)', 'Procedure codes (CPT)', 'Scores']) {
      ok(structured.labels.indexOf(label) >= 0,
        `the structured encounter has no "${label}" section (got ${JSON.stringify(structured.labels)})`);
    }
    ok(/64483/.test(structured.html), 'the stored CPT code never reached the card');
    ok(/Oswestry: 38%/.test(structured.html), 'the stored scores never reached the card');
    ok(/Gabapentin 300 mg TID/.test(structured.html), 'the stored medication list never reached the card');

    const detailOnly = await page.evaluate(() => window.__hx.card(1));
    measured.detailCard = { labels: detailOnly.labels, paras: detailOnly.paras };
    /* THE "random text" CASE: a body that lives only in `detail`, with three
       headers. Before this lane it had no surface at all; it must now be at
       least three labelled sections and never one run of text. */
    ok(detailOnly.labels.length >= 3,
      `a three-header detail-only note produced ${detailOnly.labels.length} labelled sections`);
    ok(detailOnly.paras >= 2, `a three-header detail-only note produced ${detailOnly.paras} paragraphs`);
    assert.deepStrictEqual(detailOnly.labels, ['Subjective', 'Objective', 'Plan'],
      `the detail-only note parsed into ${JSON.stringify(detailOnly.labels)}`);
    checks++;

    /* -- 3. INDEX ONLY SAYS SO, AND OFFERS THE APP'S OWN READ ----------- */
    const indexCard = await page.evaluate(() => window.__hx.card(2));
    measured.indexCard = { index: indexCard.index, read: indexCard.read, type: indexCard.type };
    eq(indexCard.index, true, 'the index-only encounter is not marked as one');
    ok(/Index only — full note not read yet/.test(indexCard.text),
      `the index-only card does not say so in plain words: "${indexCard.text.slice(0, 90)}"`);
    eq(indexCard.read, true, 'the index-only card offers no way to read the note');
    /* pullone-1.0.0 (2026-08-18): one verb for every pull on the chart, so this
       card says the same thing the header button and the strip control say. */
    /* Pin moved 2026-08-19 with t9pullbutton's deliberate rename. */
    ok(/Pull this patient's chart/.test(indexCard.text), 'the index-only action is not named');

    /* -- 4. THE JUNK IS NEVER DUMPED ------------------------------------ */
    const junkRoom = await page.evaluate(() => window.__hx.junkInRoom());
    measured.junkLiteralsInRoom = junkRoom;
    assert.deepStrictEqual(junkRoom, [],
      `EMR page furniture / captured page script reached the History room: ${JSON.stringify(junkRoom)}`);
    checks++;
    const pureJunk = await page.evaluate(() => window.__hx.card(3));
    const mixedJunk = await page.evaluate(() => window.__hx.card(4));
    measured.junkCards = { pure: { junk: pureJunk.junk, illegible: pureJunk.illegible },
      mixed: { junk: mixedJunk.junk, illegible: mixedJunk.illegible } };
    eq(pureJunk.junk, true, 'the pure-junk encounter is not flagged');
    eq(pureJunk.illegible, true, 'the pure-junk encounter is not graded illegible');
    ok(/MLS is cleaning it/.test(pureJunk.text),
      `the flagged card does not say what happened: "${pureJunk.text.slice(0, 120)}"`);
    eq(mixedJunk.junk, true, 'the mixed encounter is not flagged');
    eq(mixedJunk.illegible, false, 'an encounter whose assessment survived cleaning was called illegible');
    ok(/lumbar radiculopathy/i.test(mixedJunk.text),
      'the surviving clinical assessment was thrown away with the junk');
    ok(/MLS is cleaning it/.test(mixedJunk.text), 'the doctor is not told this note is being cleaned');

    /* -- 5. THE FOLDS --------------------------------------------------- */
    eq(view.shown, 5, `${view.shown} cards are on screen before "Show all", expected the newest 5`);
    eq(view.allText, 'Show all 8', `the show-all control reads "${view.allText}"`);
    await page.evaluate(() => window.__hx.click('[data-hx-all]'));
    await page.waitForTimeout(400);
    const afterAll = await page.evaluate(() => window.__hx.read());
    eq(afterAll.shown, 8, `after "Show all" ${afterAll.shown} cards are on screen`);
    measured.showAll = { before: view.shown, after: afterAll.shown };

    /* the long encounter folds its own body at ~12 lines */
    const longCard = await page.evaluate(() => window.__hx.card(5));
    measured.longCard = { more: longCard.more, restHidden: longCard.restHidden, labels: longCard.labels };
    eq(longCard.more, true, 'a seventeen-line note did not fold');
    eq(longCard.restHidden, true, 'the folded tail is not hidden');
    eq(await page.evaluate(() => window.__hx.clickIn(5, '[data-hx-more]')), true, 'the long note has no Show more control');
    await page.waitForTimeout(300);
    const longOpen = await page.evaluate(() => window.__hx.card(5));
    eq(longOpen.restHidden, false, '"Show more" did not reveal the rest of the note');

    /* -- 6. COPY, AND NOT ONE NAME IN THE STATUS LINE -------------------- */
    eq(view.copies, 8, `${view.copies} Copy controls for 8 encounters`);
    await page.evaluate(() => window.__hx.click('[data-hx-copy]'));
    await page.waitForTimeout(500);
    const said = await page.evaluate(() => window.__hx.say());
    measured.copySaid = said;
    ok(/copied|would not let/i.test(said), `the Copy control said nothing: "${said}"`);
    ok(said.indexOf('Ada') < 0 && said.indexOf('Sample') < 0, `the status line names a patient: "${said}"`);

    /* -- 7. ONE LIT CONTROL, AND NO SIDEWAYS SCROLL --------------------- */
    const glow = await page.evaluate(() => (window.__mlsNextGlow ? window.__mlsNextGlow.report() : null));
    measured.glow = glow ? { count: glow.count, lit: glow.lit.map((l) => l.id), room: glow.room } : null;
    ok(glow, 'nextglow-1.0.0 is not on the page');
    eq(glow.count, 1, `the History room has ${glow.count} glowing controls: ${JSON.stringify(measured.glow)}`);

    const widths = {};
    for (const width of [1024, 768, 390]) {
      await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
      await page.waitForTimeout(500);
      widths[width] = await page.evaluate(() => ({ over: window.__hx.overflow(), small: window.__hx.taps() }));
      ok(widths[width].over <= 0, `the History room scrolls sideways by ${widths[width].over}px at ${width}px`);
      assert.deepStrictEqual(widths[width].small, [],
        `tap targets under 40px at ${width}px: ${JSON.stringify(widths[width].small)}`);
      checks++;
    }
    measured.widths = widths;
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.waitForTimeout(400);

    /* -- 8. AN EMPTY CHART, AND NO CHART AT ALL -------------------------- */
    await page.evaluate(() => window.__hx.open('hx-empty'));
    await page.waitForTimeout(1400);
    const empty = await page.evaluate(() => window.__hx.read());
    measured.empty = { cards: empty.cards, count: empty.count, text: empty.text.slice(0, 120) };
    eq(empty.cards, 0, 'the empty chart rendered cards');
    ok(/^0 visits$/.test(empty.count), `the empty header reads "${empty.count}"`);
    ok(/No encounters on this chart yet/.test(empty.text), `the empty state is not in plain words: "${measured.empty.text}"`);
    ok(!/undefined|NaN|\[object/.test(empty.text), `the empty state shows developer language: "${measured.empty.text}"`);
    /* the empty state must NOT plant a second Pull control: #mlsCvNxt_history
       is already this room's one lit next step and says "Pull chart from
       Athena" for exactly this state. */
    const pulls = await page.evaluate(() => {
      const host = document.getElementById('mlsHxSection');
      if (!host) return -1;
      return Array.prototype.filter.call(host.querySelectorAll('button,a,[role=button]'),
        (e) => /\bpull\b/i.test(e.textContent || '')).length;
    });
    eq(pulls, 0, 'the empty state added a second "Pull" control to a room that already has one');

    await page.evaluate(() => window.__hx.open(''));
    await page.waitForTimeout(1600);
    const none = await page.evaluate(() => {
      const host = document.getElementById('mlsHxSection');
      const room = document.getElementById('historyView');
      return { hidden: !host || !!host.hidden, roomText: room ? String(room.innerText || '') : '' };
    });
    measured.noPatient = { hidden: none.hidden };
    eq(none.hidden, true, 'with no patient chosen the per-patient section is still on screen (CLUNKY 49/50)');
    eq(/Visits & encounters/.test(none.roomText), false, 'the section still speaks with no patient chosen');
    eq((none.roomText.match(/READ-ONLY/g) || []).length, 0, 'this lane put a READ-ONLY caption back on the patient-less room');

    /* -- 9. THE LEGAL REPORT USES THE SAME RENDERER ---------------------- */
    await page.evaluate(() => window.__hx.open('hx-full'));
    await page.waitForTimeout(1400);
    const legal = await page.evaluate(() => window.__hx.legal());
    measured.legal = { stamp: legal.stamp, opened: legal.opened, built: legal.built, skipped: legal.skipped,
      chars: (legal.text || '').length };
    ok(!legal.skipped, `the Legal / IME pack is not installed on the page: ${legal.skipped}`);
    /* THE DELEGATION, read off the LIVE module: the workspace's own scrubber
       reports which detector answered, and it must be the shared one. */
    eq(legal.stamp, 'histview-1.0.0',
      'the Legal workspace is still running its own copy of the junk detector rather than the shared one');
    ok(legal.built === 'overlay' || legal.built === 'model',
      `the report section could not be built at all: ${JSON.stringify(legal.built)}`);
    const text = String(legal.text || '');
    ok(/VISITS & ENCOUNTERS \(\d+\)/.test(text), 'the report has no Visits & encounters section');
    ok(/AT A GLANCE/.test(text), 'the chronology has no scannable table');
    ok(/^DATE\s+TYPE\s+PROVIDER\s+IMPRESSION$/m.test(text), 'the table has no column header');
    ok(/ {2}ASSESSMENT\n/.test(text), 'the exported encounters have no labelled sections — still a raw dump');
    ok(/not legible at export time/.test(text), 'the report omits an illegible body without saying so');
    ok(!/REFRESH CHART|IsSafari|window\.Original|svgjotter/.test(text),
      'EMR page furniture or captured page script reached the exported report');
    ok(/lumbar radiculopathy/i.test(text), 'the surviving clinical assessment was dropped from the export');
    /* the table's dates, in ascending order, one row per encounter */
    const tableDates = (text.slice(text.indexOf('AT A GLANCE')).match(/^\d{4}-\d{2}-\d{2}/gm) || []);
    measured.legalTableDates = tableDates;
    ok(tableDates.length >= 7, `the chronology table has ${tableDates.length} rows for 8 encounters`);
    for (let i = 1; i < tableDates.length; i++) {
      ok(tableDates[i - 1] <= tableDates[i], `the chronology table is not in date order: ${JSON.stringify(tableDates)}`);
    }
    /* p1-legal-undated-1.0.0. This suite MEASURED the defect for weeks without
       asserting it: the fixture's MLS note carries date:'2026-01-15' and
       updated:5, the legal pack dated it by `updated`, and new Date(5) is five
       milliseconds after the Unix epoch — so the first row of this very table
       read "1969-12-31". A date this table cannot support is now a defect
       here, where it was first visible. */
    eq(tableDates.filter((d) => d < '1990-01-01').length, 0,
      `an epoch date reached the chronology table: ${JSON.stringify(tableDates)}`);
    ok(tableDates.indexOf('2026-01-15') >= 0,
      `the MLS note was not dated by its own documented date: ${JSON.stringify(tableDates)}`);
    ok(!/1969|Dec 31, 1969|December 31, 1969/.test(text),
      'an epoch date reached the exported report');
    /* The legal guards this lane must not have touched, and the on-screen
       chronology's collapse, are only measurable through a real overlay - which
       needs the signed-in clinical session this harness deliberately does not
       fake. When it did not open, say so instead of pretending to have
       measured it: tests/1p-legal-bind-report-flow.test.js executes all three
       against the module directly and is kept green by this lane. */
    if (legal.opened) {
      ok(/READ-ONLY MEDICAL-LEGAL CHRONOLOGY/.test(text), 'the read-only header is gone from the chronology');
      ok(/No data was written or delivered/.test(text), 'the no-write attestation is gone from the chronology');
      ok(/Nothing here is invented/.test(text), 'the "nothing invented" line is gone from the chronology');
      const heads = (legal.painted.match(/data-row-toggle="/g) || []).length;
      const bodies = (legal.painted.match(/class="p1l-rowbody" id="mlsP1LegalRowBody\d+" hidden/g) || []).length;
      ok(heads > 0, 'the on-screen chronology renders no collapsible rows');
      eq(bodies, heads, 'an encounter body is rendered already expanded');
      ok(!/REFRESH CHART|IsSafari/.test(legal.painted), 'junk reached the on-screen chronology');
    } else {
      measured.legalOverlay = 'NOT MEASURED HERE — the workspace needs a signed-in clinical session; ' +
        'the report section was built from the live module\'s own buildModel through the live renderer instead';
    }

    /* the page must not have thrown on the way */
    const fatal = pageErrors.filter((m) => /__mlsEncView|histview|mlsHxSection/i.test(m));
    eq(fatal.length, 0, `histview-1.0.0 threw at runtime: ${JSON.stringify(fatal)}`);
    measured.pageErrors = pageErrors.length;

  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED ' + JSON.stringify(measured));
  console.log(`PASS 1p-histview-contract: ${checks} checks — the History room now renders the ONE resolver's ` +
    'encounters as dated, month-grouped, newest-first cards with the note\'s own sections labelled; index-only and ' +
    'junk-carrying bodies say so in plain words and not one junk literal reaches the room; the header count is the ' +
    'resolver\'s; five cards then "Show all", a twelve-line fold per note, a Copy per visit whose status line names ' +
    'nobody; one lit control and no sideways scroll at 1024/768/390 — and the Legal report\'s "Visits & encounters" ' +
    'section is built by the SAME renderer, proved by the stamp on the live module');
}).catch((e) => {
  console.error('FAIL 1p-histview-contract: ' + (e && e.message));
  console.error('MEASURED ' + JSON.stringify(measured));
  process.exit(1);
});
