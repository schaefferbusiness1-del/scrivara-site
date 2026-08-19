'use strict';

/* lcd-1.0.0 - THE OPEN RESULT CARD IS LIVE
 *
 * OWNER, 2026-08-19, verbatim: "as the things in orange get pulled in the
 * background they should turn to green."
 *
 * After a day pull the result card lists one row per patient: a green history
 * verdict on the left and, in its own cell, the pulled-day NOTE column - green
 * "note saved", or orange "today's note not read this time (chart saved)" for
 * the notes the pass deferred. A background engine (notes-idle) then reads
 * those notes and files receipts. The card was a DEAD SNAPSHOT: the rows list
 * was painted once (p.__ppDoneRows, a one-shot) and the note tally was read
 * off the dayVerdict stamp taken at the instant the pull ended. The doctor sat
 * watching orange rows for notes that were already saved.
 *
 * WHAT THIS SUITE PROVES, and how:
 *   PART 1 (static) the two mechanisms that froze the card are gone, the
 *          identity clauses that make a flip safe are present, and neither new
 *          block adds a timer, a colour, or a non-ASCII byte.
 *   PART 2 (runtime, real headless Chrome, the real /1p shell) the card is
 *          driven through ITS OWN 900 ms loop off the engine state it really
 *          reads, and the flips are filed through the engine's REAL receipt
 *          feed (__mlsSI._notesIdleSyncFromReceipt), not by poking the DOM:
 *            (a) a finished card with N deferred rows paints them orange and
 *                counts them;
 *            (b) a MATCHING receipt flips that row's cell to the same green
 *                the "saved" cell uses - in place - and the tally recounts;
 *            (c) a NON-matching receipt (other day / unknown patient / a row
 *                with no day stamped) flips NOTHING;
 *            (d) an idle open card repaints ZERO times, and a closed card
 *                leaves no standing interval behind (timer census);
 *            (e) a flip that lands while the card is CLOSED is already
 *                settled on the card's first paint when it is opened.
 *
 * NO LOGIN, NO NETWORK, NO EXTENSION, NO PHI. Synthetic names and synthetic
 * patient ids only; none of them is ever asserted to be persisted anywhere.
 *
 * SAID OUT LOUD, NOT PROVEN HERE: this suite does not read a real Athena note.
 * The background READ itself is the notes-idle suite's subject; what is
 * measured here is what the card does once a receipt exists.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SI = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const MC = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function block(src, openNeedle, closeNeedle, label) {
  const a = src.indexOf(openNeedle);
  ok(a >= 0, `${label}: opening marker is missing`);
  const b = src.indexOf(closeNeedle, a);
  ok(b > a, `${label}: closing marker is missing or closes before it opens`);
  return src.slice(a, b + closeNeedle.length);
}

/* ==================================================== PART 1: static shape = */

/* --- the engine: the row's own day, and the flip marker ------------------- */
const dayBlock = block(
  SI,
  '/* ===== lcd-1.0.0 (the open result card is LIVE) =',
  '/* ===== end lcd-1.0.0 (row day + flip marker) ===== */',
  '1p-feat_mls_schedimport_exact.js lcd day/flip block'
);
ok(/function tnEntryDay\(/.test(dayBlock), 'the row-day resolver tnEntryDay is missing');
ok(/hit\.dnd = day/.test(dayBlock), 'the note column is never stamped with its own day, so nothing can prove a receipt belongs to a row');
ok(/wasOrange && col === "read"/.test(dayBlock), 'the flip marker is not conditioned on an actual orange->green transition');
/* the OLD value has to be read BEFORE the overwrite or the marker is a lie */
ok(dayBlock.indexOf('var wasOrange') < dayBlock.indexOf('hit.dn = col;'),
  'wasOrange is computed after hit.dn is overwritten - the flip marker would record every re-stamp as a recovery');

/* --- the engine: the receipt -> card bridge ------------------------------- */
const bridge = block(
  SI,
  '/* ===== lcd-1.0.0 (a background read reaches the OPEN result card) =',
  '/* ===== end lcd-1.0.0 (receipt -> card bridge) ===== */',
  '1p-feat_mls_schedimport_exact.js lcd bridge block'
);
ok(/function niRestampCard\(/.test(bridge), 'niRestampCard is missing');
/* IDENTITY LAW, as bytes */
ok(/String\(r\.pid \|\| ""\) !== pid/.test(bridge), 'the bridge does not match a row by its OWN patient id');
ok(/!r\.dnd \|\| String\(r\.dnd\) !== day/.test(bridge), 'the bridge does not refuse on a day mismatch or a missing day stamp');
ok(/q\.s !== "read"/.test(bridge), 'the bridge flips on something other than a READ receipt');
ok(/s\.running === true/.test(bridge), 'the bridge does not stand down while a pull is running');
ok(/indexOf\("unread:"\) !== 0 && was\.indexOf\("retrying:"\) !== 0/.test(bridge),
  'the bridge does not restrict itself to a cell that is currently orange');
/* it must never touch the history verdict or the saved/failed tally */
ok(!/\br\.ok\s*=/.test(bridge) && !/\.failed\s*=/.test(bridge) && !/ppTally/.test(bridge),
  'the bridge writes to the history verdict or the saved/failed tally - the day-note lane is verdict-neutral (dv3-1.0.0)');
/* no clock of its own; rAF never fires in a hidden tab and this rides one */
ok(!/setInterval|setTimeout|requestAnimationFrame/.test(bridge),
  'the bridge installs a timer or depends on rAF - it must ride the engine tick that already exists');
ok(/safe\(niRestampCard\)/.test(SI), 'niSurface never calls the bridge, so a background read still never reaches the card');
{
  const surfaceAt = SI.indexOf('function niSurface()');
  const callAt = SI.indexOf('safe(niRestampCard)');
  const earlyReturn = SI.indexOf('if (!day) return false;', surfaceAt);
  ok(callAt > surfaceAt && callAt < earlyReturn,
    'the bridge is called after niSurface\'s early return, so a card open on a day the engine has no line for never updates');
}

/* --- the renderer: the two freezes are gone ------------------------------- */
const liveCount = block(MC, '/* ===== lcd-1.0.0 (the open result card is LIVE) =', '/* ===== end lcd-1.0.0 (live count) ===== */', '1p-mls-connect.js lcd count block');
const liveRows = block(MC, '/* ===== lcd-1.0.0 (rows repaint on DATA change, not once) =', '/* ===== end lcd-1.0.0 (live rows) ===== */', '1p-mls-connect.js lcd rows block');

/* THE CAUSAL CONTROL: the one-shot that froze the rows must be GONE. If it
   comes back, every runtime assertion below turns vacuous.
   The needle carries its opening brace on purpose. The block comment above the
   replacement QUOTES the old guard to explain what changed, and a bare-literal
   search matched that prose and failed on a correct tree - a probe reading
   English as code. Only the statement form is the defect. */
ok(MC.indexOf('if (rowsElD && !p.__ppDoneRows) {') < 0,
  'the one-shot rows paint (if (rowsElD && !p.__ppDoneRows) { ... ) is back in the renderer - the card is a snapshot again');
{
  /* and the guard is not merely reformatted: nothing may branch on that flag */
  const stmtLike = MC.match(/if\s*\([^)]*!p\.__ppDoneRows[^)]*\)\s*\{/g) || [];
  eq(stmtLike.length, 0, `${stmtLike.length} statement(s) still branch on the one-shot __ppDoneRows flag`);
}
ok(/p\.__ppDoneRowsSig !== sigD/.test(liveRows), 'the rows paint is not signature-gated, so it either never repaints or repaints every tick');
ok(/rowsElD\.innerHTML !== htmlD/.test(liveRows), 'the rows paint is not guarded against an unchanged write');
ok(/p\.__ppDoneRows = 1/.test(liveRows), "dn-1.0's __ppDoneRows marker was dropped rather than kept");

/* the tally must read the live number, and must no longer read the frozen one */
ok(/var dvTnFailed = Math\.max\(0, \(dv \? Number\(dv\.tnFailed \|\| 0\) : 0\) - dnRecovered\)/.test(liveCount),
  'the live note count is not derived as the engine number minus proven recoveries');
ok(/rr\.dnLive === 1 && String\(rr\.dn \|\| ''\) === 'read'/.test(liveCount),
  'a recovery is counted without requiring BOTH the flip marker and a green cell');
{
  /* it may never rise above the engine's own count */
  ok(/Math\.max\(0,/.test(liveCount), 'the live count is not floored at zero');
  const doneLineTail = MC.slice(MC.indexOf('pulled-day note') - 400, MC.indexOf('pulled-day note') + 200);
  ok(/dvTnFailed > 0/.test(doneLineTail), 'the Result line still tests the frozen dayVerdict stamp');
  ok(!/Number\(dv\.tnFailed \|\| 0\) === 1/.test(doneLineTail), 'the Result line still pluralises off the frozen stamp');
  ok(/var attnD = failed \+ dvTnFailed;/.test(MC), 'the "need attention" tally still counts the frozen stamp');
}
ok(!/requestAnimationFrame/.test(liveRows) && !/requestAnimationFrame/.test(liveCount),
  'the live card depends on rAF, which never fires in a non-compositing tab');
ok(!/setInterval\(/.test(liveRows) && !/setInterval\(/.test(liveCount),
  'the live card installs a standing interval - it must ride the panel loop that already exists');

/* --- no new colour, no new byte class ------------------------------------ */
for (const [label, b] of [['engine day/flip', dayBlock], ['engine bridge', bridge], ['renderer count', liveCount], ['renderer rows', liveRows]]) {
  ok(!/#[0-9a-fA-F]{6}\b/.test(b), `${label}: a new hex colour was introduced - the flip must reuse the existing saved green`);
  const nonAscii = b.match(/[^\x00-\x7F]/g) || [];
  eq(nonAscii.length, 0, `${label}: ${nonAscii.length} non-ASCII byte(s) in a new block (the latin1/control-byte trap)`);
}

/* --- the green the flip lands on IS the saved green ----------------------- */
ok(/dnRaw === 'read' \? 'pp-ok'/.test(MC), 'a read note cell no longer uses the pp-ok class');
{
  const m = MC.match(/\.pp-ok\{color:(#[0-9A-Fa-f]{6})/);
  ok(m, 'the pp-ok colour could not be read out of the panel stylesheet');
  measured.savedGreen = m[1];
  eq(m[1].toUpperCase(), '#2E6A4B', 'the saved green moved - the flip target must move with it');
}

/* ======================================================= PART 2: runtime == */

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

const DAY = '2026-08-14';
const OTHER_DAY = '2026-08-13';
/* synthetic identities; none of these strings is real */
const P = { a: 'syn-pid-a', b: 'syn-pid-b', c: 'syn-pid-c', noday: 'syn-pid-noday', ghost: 'syn-pid-ghost' };
const N = { a: 'Quillon Ashgrove', b: 'Marisela Fenwick', c: 'Tobias Underhay', noday: 'Perpetua Vandersloot', d: 'Ignatius Blackmoor' };

/* the tick the card really runs on */
const TICK = 900;
const SETTLE = TICK * 3;

/* Line ranges for the timer census below: a stack frame inside either of these
   is a timer this change is answerable for. Computed here, from the shipped
   bytes, so the census cannot drift out of date silently. */
function lineOf(src, needle, label) {
  const i = src.indexOf(needle);
  ok(i >= 0, `timer census: could not locate ${label}`);
  return src.slice(0, i).split('\n').length;
}
const CARD_RANGE = [
  lineOf(MC, "var PANEL = 'mlsPullProgPanel'", 'the pull-progress card module start'),
  lineOf(MC, 'window.__mlsPullProgress_revert = function', 'the pull-progress card module end')
];
const NI_RANGE = [
  lineOf(SI, '/* ===== notes-idle-1.0.0', 'the notes-idle block start'),
  lineOf(SI, '/* ===== end notes-idle-1.0.0 ===== */', 'the notes-idle block end')
];
ok(CARD_RANGE[1] > CARD_RANGE[0] && NI_RANGE[1] > NI_RANGE[0], 'timer census: a module range is inverted');
measured.censusRanges = `1p-mls-connect.js ${CARD_RANGE.join('-')} · 1p-feat_mls_schedimport_exact.js ${NI_RANGE.join('-')}`;

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

    /* TIMER CENSUS, installed before a single page script runs.
       IT ATTRIBUTES, it does not just count. A first version counted every live
       interval in the page and read 181 -> 203 across the run: the app mounts
       feature modules lazily and each brings its own clock, so a raw total
       cannot answer "did the LIVE CARD leave a timer behind". Every interval is
       therefore recorded with the stack that created it, and the assertion is
       that NONE of the live ones was created inside the pull-progress card
       module or inside the notes-idle block - the two regions this change
       touches. The raw total is still reported, as context, never as a verdict. */
    await page.addInitScript(() => {
      window.__lcCensus = { live: new Map() };
      const si = window.setInterval, ci = window.clearInterval;
      window.setInterval = function () {
        const id = si.apply(this, arguments);
        try { window.__lcCensus.live.set(id, String((new Error()).stack || '')); } catch (e) {}
        return id;
      };
      window.clearInterval = function (id) { try { window.__lcCensus.live.delete(id); } catch (e) {} return ci.apply(this, arguments); };
    });

    await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    });
    await page.waitForTimeout(3000);

    /* THE INSTRUMENT MUST BE READY, or every assertion below grades a bare
       shell. Both are refusals, not silent skips. */
    const wired = await page.evaluate(() => ({
      pp: !!(window.__mlsPullProgress && typeof window.__mlsPullProgress._renderDone === 'function'),
      si: !!(window.__mlsSI && typeof window.__mlsSI._notesIdleSyncFromReceipt === 'function'
        && typeof window.__mlsSI._notesIdleRestampCard === 'function')
    }));
    ok(wired.pp, 'INSTRUMENT NOT READY: the pull-progress card module is not mounted');
    ok(wired.si, 'INSTRUMENT NOT READY: the importer / notes-idle feed is not mounted');

    const baselineIntervals = await page.evaluate(() => window.__lcCensus.live.size);
    measured.baselineLiveIntervals = baselineIntervals;

    /* ---- helpers, all in page context -------------------------------- */
    const readCard = () => page.evaluate(() => {
      const p = document.getElementById('mlsPullProgPanel');
      if (!p) return { open: false, fab: !!document.getElementById('mlsPullProgFab') };
      const rows = Array.from(p.querySelectorAll('.pp-row')).map((r) => {
        const sp = r.querySelectorAll('span');
        const note = sp[2] || null;
        return {
          who: sp[0] ? String(sp[0].textContent || '').trim() : '',
          hist: sp[1] ? String(sp[1].textContent || '').trim() : '',
          note: note ? String(note.textContent || '').trim() : '',
          noteCls: note ? String(note.className || '') : '',
          noteColor: note ? getComputedStyle(note).color : ''
        };
      });
      const grab = (k) => { const e = p.querySelector('[data-pp="' + k + '"]'); return e ? String(e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
      return {
        open: true, fab: !!document.getElementById('mlsPullProgFab'), rows,
        tally: grab('tally'), result: grab('current'), tallyMore: grab('tallyMore'),
        savedGreen: (function () { const g = p.querySelector('.pp-row .pp-ok'); return g ? getComputedStyle(g).color : ''; })()
      };
    });
    const orangeCount = (c) => c.rows.filter((r) => r.note && r.noteCls.indexOf('pp-ok') < 0).length;
    const greenCount = (c) => c.rows.filter((r) => r.note && r.noteCls.indexOf('pp-ok') >= 0).length;
    const noteOf = (c, who) => (c.rows.find((r) => r.who === who) || {});

    /* file a receipt through the engine's REAL feed. Two calls, because that
       is the real shape: the pull hands over a row it could not read, and the
       background engine later reports it read. */
    const fileDeferred = (pid, day) => page.evaluate(([pid, day]) => window.__mlsSI._notesIdleSyncFromReceipt(
      { patients: [{ patientId: pid, todayNote: false, todayNoteReason: 'pulled-day-note-deadline-exceeded' }] }, day
    ), [pid, day]);
    const fileRead = (pid, day) => page.evaluate(([pid, day]) => window.__mlsSI._notesIdleSyncFromReceipt(
      { patients: [{ patientId: pid, todayNote: true }] }, day
    ), [pid, day]);
    /* HOLD THE ENGINE IN ITS OWN PAUSED STATE while the CARD is the subject.
       niGate opens after NI_IDLE_MS (20 s) of no user input, and this suite
       runs longer than that - so without this the engine would start taking
       real read turns mid-measurement (they would refuse at the presence
       probe, there being no extension, but they would also burn attempts and
       move rows onto a backoff ladder underneath the assertions). A doctor
       touching the keyboard is exactly the condition the engine is built to
       pause for, so the suite supplies it rather than reaching inside the
       gate. Nothing about the receipt path is stubbed: the feed, the queue,
       the surface and the bridge are all the shipped ones. */
    const touch = () => page.evaluate(() => document.dispatchEvent(new Event('keydown', { bubbles: true })));
    const landNote = async (pid, day) => { await touch(); await fileDeferred(pid, day); await fileRead(pid, day); await touch(); await page.waitForTimeout(SETTLE); };

    const seedRun = (rows, dv) => page.evaluate(([rows, dv]) => {
      window.__mlsDayHistoryPull = { state: { __si: 1, running: true, total: rows.length, done: 0, ok: 0, failed: 0, chartOnly: 0, current: 'opening the next chart', rows: [] } };
      window.__lcRows = rows; window.__lcDv = dv;
    }, [rows, dv]);
    const finishRun = () => page.evaluate(() => {
      const rows = window.__lcRows;
      window.__mlsDayHistoryPull.state = {
        __si: 1, running: false, total: rows.length, done: rows.length,
        ok: rows.filter((r) => r.ok).length, failed: 0, chartOnly: 0,
        finishedAt: Date.now(), rows: rows, dayVerdict: window.__lcDv
      };
    });

    /* ============================================ (a) the orange baseline == */
    /* Five rows. Four histories saved with a note the pass did NOT read, one
       already green. One of the four deliberately carries NO day stamp - the
       fail-closed case. */
    const rows1 = [
      { k: N.a + '|' + P.a, name: N.a, pid: P.a, ok: true, reason: '', dn: 'unread:pulled-day-note-deadline-exceeded', dnd: DAY },
      { k: N.b + '|' + P.b, name: N.b, pid: P.b, ok: true, reason: '', dn: 'retrying:find-open-deadline', dnd: DAY },
      { k: N.c + '|' + P.c, name: N.c, pid: P.c, ok: true, reason: '', dn: 'unread:scoped-read-unverified', dnd: DAY },
      { k: N.noday + '|' + P.noday, name: N.noday, pid: P.noday, ok: true, reason: '', dn: 'unread:scoped-read-unverified' },
      { k: N.d + '|syn-pid-d', name: N.d, pid: 'syn-pid-d', ok: true, reason: '', dn: 'read', dnd: DAY }
    ];
    const dv1 = { ok: 5, failed: 0, total: 5, complete: false, tnFailed: 4, tnRead: 1, tnNotYet: 0, tnFuture: 0 };

    await seedRun(rows1, dv1);
    await page.waitForTimeout(SETTLE);
    await page.evaluate(() => { const f = document.getElementById('mlsPullProgFab'); if (f) f.click(); });
    await page.waitForTimeout(TICK * 2);
    await finishRun();
    await page.waitForTimeout(SETTLE);

    let card = await readCard();
    ok(card.open, 'the finished result card never opened, so nothing below is measured');
    eq(card.rows.length, 5, `the card should list 5 rows, it listed ${card.rows.length}`);
    eq(orangeCount(card), 4, `expected 4 deferred note cells, got ${orangeCount(card)}`);
    eq(greenCount(card), 1, `expected 1 already-saved note cell, got ${greenCount(card)}`);
    ok(/today.s note not read this time \(chart saved\)/.test(noteOf(card, 'Quillon').note),
      `the deferred row does not carry the deferred wording: "${noteOf(card, 'Quillon').note}"`);
    ok(/4 pulled-day notes not read yet/.test(card.result),
      `the Result line does not count the 4 deferred notes: "${card.result}"`);
    ok(/4 need attention/.test(card.tally), `the meta tally does not count the deferred notes: "${card.tally}"`);
    measured.a_baselineResult = card.result;
    const savedGreenPx = card.savedGreen;
    measured.a_savedGreenComputed = savedGreenPx;

    /* ============================================ (b) a MATCHING receipt === */
    await landNote(P.a, DAY);
    card = await readCard();
    ok(card.open, 'the card closed itself during the flip');
    const flipped = noteOf(card, 'Quillon');
    ok(flipped.noteCls.indexOf('pp-ok') >= 0, `the matching row did not turn green (class "${flipped.noteCls}")`);
    eq(flipped.note, 'note saved', `the flipped cell does not read as saved: "${flipped.note}"`);
    eq(flipped.noteColor, savedGreenPx, `the flipped cell is not the same green as the saved cell (${flipped.noteColor} vs ${savedGreenPx})`);
    eq(orangeCount(card), 3, `after one flip 3 cells should still be deferred, ${orangeCount(card)} were`);
    /* the tally recounted */
    ok(/3 pulled-day notes not read yet/.test(card.result),
      `the Result line did not recount after the flip: "${card.result}"`);
    ok(/3 need attention/.test(card.tally), `the meta tally did not recount after the flip: "${card.tally}"`);
    /* and the history verdict is untouched - the note lane is verdict-neutral */
    ok(/5 histories saved/.test(card.result), `the saved-history count moved when a note flipped: "${card.result}"`);
    eq(flipped.hist, '✓ saved', `the history verdict changed when the note flipped: "${flipped.hist}"`);
    measured.b_afterFlipResult = card.result;
    measured.b_flipColour = flipped.noteColor;

    /* ================================= (c) NON-matching receipts flip nothing */
    const before = await readCard();
    /* c1 - the SAME patient, a DIFFERENT day (the day-switch guard) */
    await landNote(P.b, OTHER_DAY);
    /* c2 - a patient the card has never heard of, on the right day */
    await landNote(P.ghost, DAY);
    /* c3 - a real matching pid+day, but the row carries NO day stamp: fail closed */
    await landNote(P.noday, DAY);
    card = await readCard();
    eq(orangeCount(card), 3, `a non-matching receipt flipped a row: ${orangeCount(card)} deferred cells remain, expected 3`);
    eq(noteOf(card, 'Marisela').noteCls.indexOf('pp-ok') >= 0, false, 'a receipt for ANOTHER DAY flipped this row');
    eq(noteOf(card, 'Perpetua').noteCls.indexOf('pp-ok') >= 0, false, 'a row with no day stamped was flipped on an unproven match');
    eq(card.result, before.result, `the Result line moved on receipts that matched nothing: "${before.result}" -> "${card.result}"`);
    measured.c_afterNonMatching = card.result;

    /* c4 - the retrying (calm, not-yet-orange) state flips too, on its own day */
    await landNote(P.b, DAY);
    card = await readCard();
    ok(noteOf(card, 'Marisela').noteCls.indexOf('pp-ok') >= 0, 'a row waiting on the retry never turns green when its note lands');
    eq(orangeCount(card), 2, `expected 2 deferred cells after the second flip, got ${orangeCount(card)}`);
    ok(/2 pulled-day notes not read yet/.test(card.result), `the Result line did not recount the second flip: "${card.result}"`);
    measured.c4_afterRetryingFlip = card.result;

    /* ---- both themes: the flip green tracks the saved green --------------- */
    const themes = await page.evaluate(() => {
      const out = {};
      const p = document.getElementById('mlsPullProgPanel');
      const read = () => {
        const cells = Array.from(p.querySelectorAll('.pp-row')).map((r) => r.querySelectorAll('span')[2]).filter(Boolean);
        const green = cells.filter((c) => c.className.indexOf('pp-ok') >= 0);
        const hist = p.querySelector('.pp-row span:nth-child(2).pp-ok');
        return { note: green.length ? getComputedStyle(green[0]).color : '', hist: hist ? getComputedStyle(hist).color : '' };
      };
      const had = document.body.classList.contains('theme-dark');
      document.body.classList.remove('theme-dark'); out.light = read();
      document.body.classList.add('theme-dark'); out.dark = read();
      if (!had) document.body.classList.remove('theme-dark');
      return out;
    });
    measured.themeGreens = JSON.stringify(themes);
    ok(themes.light.note && themes.light.hist, 'the light-theme colours could not be read back');
    eq(themes.light.note, themes.light.hist, `light theme: a flipped note cell is not the saved green (${themes.light.note} vs ${themes.light.hist})`);
    eq(themes.dark.note, themes.dark.hist, `dark theme: a flipped note cell is not the saved green (${themes.dark.note} vs ${themes.dark.hist})`);

    /* ==================== (d1) an idle open card repaints ZERO times ======= */
    const idleMutations = await page.evaluate((ms) => new Promise((res) => {
      const el = document.querySelector('#mlsPullProgPanel [data-pp="rows"]');
      if (!el) { res(-1); return; }
      let n = 0;
      const mo = new MutationObserver((recs) => { n += recs.length; });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      setTimeout(() => { mo.disconnect(); res(n); }, ms);
    }), TICK * 5);
    measured.d1_idleRepaintsOver5Ticks = idleMutations;
    eq(idleMutations, 0, `an unchanged open card rewrote its rows ${idleMutations} time(s) over 5 ticks - the paint is not guarded`);

    /* ==================== (d2) closed card leaves no timer behind ========== */
    await page.evaluate(() => { const b = document.getElementById('mlsPullProgHide'); if (b) b.click(); });
    await page.waitForTimeout(SETTLE);
    const closed = await readCard();
    eq(closed.open, false, 'the card is still open after Done');
    eq(closed.fab, false, 'the pill survived Done');

    /* the notes-idle clock disarms itself once its queue drains */
    await page.waitForFunction(() => {
      try { const r = window.__mlsSI.notesIdle(); return r.queued === 0 && r.timerKind === 'none'; } catch (e) { return false; }
    }, null, { timeout: 30000 }).catch(() => {});
    const ni = await page.evaluate(() => window.__mlsSI.notesIdle());
    measured.d2_notesIdle = `queued=${ni.queued} read=${ni.read} timerKind=${ni.timerKind} cardFlips=${ni.cardFlips}`;
    eq(ni.queued, 0, `the notes-idle queue did not drain (${ni.queued} still queued)`);
    eq(ni.timerKind, 'none', `the notes-idle clock is still armed with an empty queue (${ni.timerKind})`);
    /* two flips so far: the deferred row (b) and the retrying row (c4). The
       third, filed with the card closed, happens below. */
    eq(ni.cardFlips, 2, `the engine should have recorded 2 card flips by now, it recorded ${ni.cardFlips}`);

    const census = await page.evaluate(([cardRange, niRange]) => {
      const hits = { card: [], ni: [], total: 0 };
      window.__lcCensus.live.forEach((stack) => {
        hits.total++;
        const inRange = (file, range) => {
          const re = new RegExp(file.replace(/[.]/g, '\\.') + ':(\\d+):', 'g');
          let m;
          while ((m = re.exec(stack))) { const n = Number(m[1]); if (n >= range[0] && n <= range[1]) return true; }
          return false;
        };
        if (inRange('1p-mls-connect.js', cardRange)) hits.card.push(stack.split('\n').slice(1, 3).join(' | '));
        if (inRange('1p-feat_mls_schedimport_exact.js', niRange)) hits.ni.push(stack.split('\n').slice(1, 3).join(' | '));
      });
      return hits;
    }, [CARD_RANGE, NI_RANGE]);
    measured.d2_liveIntervals = `page total: baseline ${baselineIntervals} -> after close ${census.total} (the app's own module clocks; not a verdict)`;
    measured.d2_attributed = `from the card module: ${census.card.length} · from the notes-idle block: ${census.ni.length}`;
    eq(census.card.length, 0,
      `the live card left ${census.card.length} standing interval(s) behind after it was closed: ${census.card.join(' ;; ')}`);
    eq(census.ni.length, 0,
      `the receipt bridge left ${census.ni.length} standing interval(s) behind with an empty queue: ${census.ni.join(' ;; ')}`);

    /* a receipt filed with the card CLOSED still updates the DATA and paints
       nothing - which is what makes (e) possible without a poller. */
    await landNote(P.c, DAY);
    const afterClosed = await page.evaluate(() => {
      const p = document.getElementById('mlsPullProgPanel');
      const st = window.__mlsDayHistoryPull.state;
      const r = (st.rows || []).filter((x) => x.pid === 'syn-pid-c').pop();
      return { panel: !!p, dn: r ? r.dn : '(row gone)', dnLive: r ? r.dnLive === 1 : false };
    });
    eq(afterClosed.panel, false, 'a receipt filed with the card closed re-opened the card');
    eq(afterClosed.dn, 'read', 'a receipt filed with the card closed did not reach the row data');
    eq(afterClosed.dnLive, true, 'the closed-card flip was not recorded as a proven recovery');
    measured.d2_closedFlip = `panel=${afterClosed.panel} dn=${afterClosed.dn}`;

    /* ============ (e) a SECOND run: flips that land while the card is shut
                        are already settled on its first paint ============== */
    const rows2 = [
      { k: 'Ada Sample|syn-2a', name: 'Ada Sample', pid: 'syn-2a', ok: true, reason: '', dn: 'unread:pulled-day-note-deadline-exceeded', dnd: DAY },
      { k: 'Bo Sample|syn-2b', name: 'Bo Sample', pid: 'syn-2b', ok: true, reason: '', dn: 'unread:pulled-day-note-deadline-exceeded', dnd: DAY }
    ];
    const dv2 = { ok: 2, failed: 0, total: 2, complete: false, tnFailed: 2, tnRead: 0, tnNotYet: 0, tnFuture: 0 };
    await seedRun(rows2, dv2);
    await page.waitForTimeout(SETTLE);
    await finishRun();
    await page.waitForTimeout(SETTLE);
    /* the card is CLOSED (this run was never opened - the pill is the default) */
    const shut = await readCard();
    eq(shut.open, false, 'the second run opened its card by itself - (e) would prove nothing');
    ok(shut.fab, 'the second run has no pill to open, so the reopen path is unmeasurable');

    await landNote('syn-2a', DAY);
    await page.evaluate(() => { const f = document.getElementById('mlsPullProgFab'); if (f) f.click(); });
    await page.waitForTimeout(TICK * 2);
    card = await readCard();
    ok(card.open, 'the card did not open from the pill on the second run');
    eq(card.rows.length, 2, `the reopened card should list 2 rows, it listed ${card.rows.length}`);
    ok(noteOf(card, 'Ada').noteCls.indexOf('pp-ok') >= 0,
      'the card was opened AFTER the note landed and still painted the row orange - the first paint is not the settled state');
    eq(orangeCount(card), 1, `expected 1 remaining deferred cell on reopen, got ${orangeCount(card)}`);
    ok(/1 pulled-day note not read yet/.test(card.result),
      `the reopened card's Result line is not the settled count: "${card.result}"`);
    ok(!/2 pulled-day notes not read yet/.test(card.result),
      `the reopened card is still reporting the count frozen at the end of the pull: "${card.result}"`);
    measured.e_reopenedResult = card.result;

    ok(pageErrors.length === 0, 'the page threw during the run: ' + pageErrors.join(' | '));
    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
}

runtime().then(() => {
  console.log('MEASURED');
  for (const k of Object.keys(measured)) console.log('  ' + k + ': ' + measured[k]);
  console.log('1p-live-result-card: ' + checks + ' checks passed');
}, (err) => {
  console.error((err && err.stack) || err);
  process.exit(1);
});
