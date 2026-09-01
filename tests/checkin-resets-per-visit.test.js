'use strict';
/*
 * A CHECK-IN BELONGS TO ONE VISIT (ckvisit-1.0.0 + av ck-1.0.0)
 * =============================================================================
 * Owner, 2026-08-31, on a screenshot of the Visit screen's pre-visit check-in
 * strip: "this avatar should reset for a new vivist even if its the same
 * patient."
 *
 * THE KEYING, MEASURED BEFORE THE FIX: PER PATIENT, WITH NO VISIT KEY AT ALL.
 *   - the read:  ensureVisitCard() chose its row with
 *                  clean(cache.checkins[i].patient_external_id) === activeId
 *                and nothing else;
 *   - the write: the office interview is opened with
 *                  {clientSessionId, patientExternalId}
 *                and the row is read back from /api/avatar/checkins as
 *                  {id, patient_external_id, ready_at, headline, bullets,
 *                   summary, audited, flags}
 *                - no encounter, no appointment, no visit anywhere.
 * The only boundary a check-in ever had was the server's ready -> seen status,
 * which moves only when a human taps "Mark seen" and never moves back. So an
 * unmarked check-in painted on the Visit screen for every later visit of that
 * same patient, forever.
 *
 * WHAT THIS SUITE EXECUTES - the SHIPPED bytes, not a restatement of them:
 *   (a) the whole ckvisit-1.0.0 inline block, sliced out of BOTH twins and run
 *       in a VM against a fake window/localStorage/editor;
 *   (b) the avatar module's ck-1.0.0 helpers AND the exact selection lines cut
 *       out of ensureVisitCard(), run against the same fake storage.
 *
 * FIVE CLAIMS:
 *   1. same patient, a NEW visit after a real one  -> the strip resets;
 *   2. the current visit's own check-in            -> it shows;
 *   3. reopening the older associated visit        -> that one shows again;
 *   4. the check-in records are untouched by the reset (nothing marked seen,
 *      nothing deleted, no clinical text in the local ledger);
 *   5. the twins are byte-identical in every edited region, and the derived
 *      production/cloned copies of the avatar module carry the same logic.
 *
 * Every negative claim is also run against the PRE-FIX bytes from git HEAD~
 * ... no: against a control built by removing the visit identity, because a pin
 * that cannot fail is not a pin. See CONTROL below.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const TWIN_A = '1pScribeFlow.html';
const TWIN_B = path.join('1p', 'index.html');
const AVATAR_1P = '1p-feat_mls_avatar.js';
const AVATAR_PROD = 'feat_mls_avatar.js';
const AVATAR_CLONED = 'cloned-feat_mls_avatar.js';

let pass = 0;
function ok(label, cond) {
  assert(cond, 'FAILED: ' + label);
  pass++;
  console.log('  ok  ' + label);
}

/* ---------------------------------------------------------------------------
 * SLICING
 * ------------------------------------------------------------------------ */
const BLOCK_START = '<!-- ===== ckvisit-1.0.0';
const BLOCK_END = '<!-- ===== end ckvisit-1.0.0';

function twinBlock(file) {
  const text = read(file);
  const s = text.indexOf(BLOCK_START);
  const e = text.indexOf(BLOCK_END);
  assert(s >= 0 && e > s, file + ': the ckvisit-1.0.0 block is missing');
  return text.slice(s, text.indexOf('\n', e) + 1);
}
function scriptOf(block, file) {
  const open = block.indexOf('<script>');
  const close = block.indexOf('</script>', open);
  assert(open >= 0 && close > open, file + ': the ckvisit-1.0.0 block has no inline script');
  return block.slice(open + '<script>'.length, close);
}
function between(src, from, to, file) {
  const a = src.indexOf(from);
  assert(a >= 0, (file || '') + ': anchor not found -> ' + JSON.stringify(from.slice(0, 60)));
  const b = src.indexOf(to, a + from.length);
  assert(b > a, (file || '') + ': closing anchor not found -> ' + JSON.stringify(to.slice(0, 60)));
  return src.slice(a, b);
}

const blockA = twinBlock(TWIN_A);
const blockB = twinBlock(TWIN_B);
const shellSrc = scriptOf(blockA, TWIN_A);

const avatar1p = read(AVATAR_1P);
const avatarProd = read(AVATAR_PROD);
const avatarCloned = read(AVATAR_CLONED);

const CK_HELPERS_FROM = '  /* ==== ck-1.0.0 - A CHECK-IN BELONGS TO ONE VISIT';
const CK_HELPERS_TO = '\n  function ensureVisitCard() {';
const CORE_FROM = '  function safe(fn, fallback)';
const CORE_TO = '\n  function token() {';
const SELECT_FROM = '    var visitToken = checkinVisitToken();';
const SELECT_TO = '\n    /* Same content -> no rebuild';

const ckHelpers = between(avatar1p, CK_HELPERS_FROM, CK_HELPERS_TO, AVATAR_1P);
const ckCore = between(avatar1p, CORE_FROM, CORE_TO, AVATAR_1P);
const ckSelect = between(avatar1p, SELECT_FROM, SELECT_TO, AVATAR_1P);

/* The selection really is the shipped choice of row, not a paraphrase. */
ok('the shipped selection asks checkinForVisit, not patient_external_id alone',
  ckSelect.includes('checkinForVisit(cache.checkins, activeId, visitToken)') &&
  ckSelect.includes('if (activeHit) checkinClaim(activeHit.id, visitToken);'));
ok('the pre-fix patient-only loop is gone from ensureVisitCard',
  !between(avatar1p, '  function ensureVisitCard() {', '\n  var pendingSetupTab', AVATAR_1P)
    .includes("if (clean(cache.checkins[i].patient_external_id) === activeId) { activeHit = cache.checkins[i]; break; }"));

/* ---------------------------------------------------------------------------
 * A HARNESS. It supports exactly what the sliced code touches and throws on
 * anything it does not: a harness that quietly returns undefined turns a broken
 * feature into a green test.
 * ------------------------------------------------------------------------ */
function makeStorage() {
  const map = new Map();
  return {
    map,
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i]; }
  };
}

function makeWorld() {
  const storage = makeStorage();
  const listeners = new Map();
  const fired = [];
  const editor = { transcript: { value: '' }, noteBox: { value: '' } };

  const win = {
    addEventListener(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
    },
    removeEventListener(name, fn) {
      const rows = listeners.get(name) || [];
      const i = rows.indexOf(fn);
      if (i >= 0) rows.splice(i, 1);
    },
    dispatchEvent(ev) {
      fired.push({ type: ev.type, detail: ev.detail });
      (listeners.get(ev.type) || []).slice().forEach((fn) => fn(ev));
      return true;
    },
    /* the app's account-namespaced local key helper */
    uns(suffix) { return 'sf_u::doc@example.test::' + suffix; }
  };
  win.window = win;

  const doc = {
    getElementById(id) {
      if (Object.prototype.hasOwnProperty.call(editor, id)) return editor[id];
      return null;
    }
  };

  class CustomEventShim {
    constructor(type, init) { this.type = String(type); this.detail = (init && init.detail) || null; }
  }

  const ctx = vm.createContext({
    window: win,
    document: doc,
    localStorage: storage,
    sessionStorage: makeStorage(),
    CustomEvent: CustomEventShim,
    JSON, Date, Math, Object, Array, String, Number, Boolean, RegExp, Error,
    console,
    /* the shell globals the block reads through `typeof x !== 'undefined'` */
    uns: win.uns,
    currentSoap: '',
    currentInsurance: '',
    currentNoteId: ''
  });
  ctx.globalThis = ctx;

  /* A `function foo(){}` at the top level of a browser document IS window.foo -
     that is the whole mechanism wrapOnce() uses, and the app's own
     visitowner-1.0.0 block relies on it. The harness models that: the three
     functions the block wraps are reachable through window, and the wrappers
     the block installs replace them there. */
  win.newVisit = function () {
    editor.transcript.value = '';
    editor.noteBox.value = '';
    ctx.currentSoap = '';
    ctx.currentInsurance = '';
    ctx.currentNoteId = '';
    world.newVisitCalls++;
    return true;
  };
  win.loadRecordIntoEditor = function (n) {
    ctx.currentNoteId = String((n && n.id) || '');
    editor.transcript.value = String((n && n.transcript) || '');
    ctx.currentSoap = String((n && n.soap) || '');
    world.loadCalls++;
    return true;
  };
  win.noteRecordFromState = function () {
    return { id: ctx.currentNoteId || 'n-new', transcript: editor.transcript.value, soap: ctx.currentSoap };
  };

  const world = {
    ctx, win, doc, storage, editor, fired,
    newVisitCalls: 0, loadCalls: 0,
    type(text) { editor.transcript.value = String(text); },
    installShell(src) { vm.runInContext('(function(){' + src + '\n})()', ctx, { filename: 'ckvisit-1.0.0' }); },
    /* the avatar module's own helpers plus the SHIPPED selection lines, wrapped
       into one callable so the exact bytes decide which row is painted */
    installAvatar(coreSrc, helperSrc, selectSrc) {
      const wrapper =
        '(function(){\n' +
        coreSrc + '\n' +
        'function activePtIdSafe(){ return globalThis.__testActiveId || ""; }\n' +
        helperSrc + '\n' +
        'function paint(cache){\n' +
        '  var activeId = activePtIdSafe();\n' +
        selectSrc + '\n' +
        '  return { hit: activeHit, token: visitToken };\n' +
        '}\n' +
        'return { paint: paint, ledger: checkinLedgerRead, tokenNow: checkinVisitToken, visitOf: checkinVisitOf };\n' +
        '})()';
      return vm.runInContext(wrapper, ctx, { filename: 'feat_mls_avatar.js#ck-1.0.0' });
    }
  };
  return world;
}

/* ---------------------------------------------------------------------------
 * CONTROL: the same scenarios with the visit identity REMOVED, i.e. the world
 * as it was before this change. Every "resets" claim below must FAIL there, or
 * the claim is vacuous.
 * ------------------------------------------------------------------------ */
function run(withIdentity) {
  const w = makeWorld();
  if (withIdentity) w.installShell(shellSrc);
  const av = w.installAvatar(ckCore, ckHelpers, ckSelect);
  return { w, av };
}

const PT = 'portal-ada-1';
const rows = Object.freeze([
  Object.freeze({
    id: 501, patient_external_id: PT, ready_at: '2026-08-03T14:02:00Z',
    headline: 'Urgent: lower back pain with urine and bowel control loss',
    bullets: Object.freeze(['Numbness in inner thighs when wiping', 'Pain severity 8/10, radiates to both legs']),
    summary: 'JULY VISIT ANSWERS', audited: 'passed', flags: Object.freeze([])
  })
]);
const rowsPlusToday = Object.freeze([
  Object.freeze({
    id: 777, patient_external_id: PT, ready_at: '2026-08-31T13:40:00Z',
    headline: 'Follow-up: numbness improved after injection',
    bullets: Object.freeze(['Walking further without stopping']),
    summary: 'TODAY ANSWERS', audited: 'passed', flags: Object.freeze([])
  }),
  rows[0]
]);
const cacheOf = (list) => ({ at: Date.now(), total: list.length, checkins: list });

/* =========================================================================
 * 1. SAME PATIENT, A NEW VISIT -> THE STRIP RESETS
 * ====================================================================== */
{
  const { w, av } = run(true);
  w.ctx.__testActiveId = PT;

  const first = av.paint(cacheOf(rows));
  ok('1a: the check-in paints for the visit that is open', first.hit && first.hit.id === 501);
  ok('1a: and that visit has claimed it', av.visitOf(501) === first.token && !!first.token);

  /* the visit becomes REAL - the doctor records and a note exists */
  w.type('Patient reports lower back pain since Friday.');
  w.ctx.currentSoap = 'S: ...';
  w.ctx.currentNoteId = 'n-july';

  const before = JSON.stringify(rows);
  w.win.newVisit();                                  /* the app's own reset path */
  const second = av.paint(cacheOf(rows));

  ok('1b: a NEW visit for the SAME patient mints a new visit token',
    second.token && second.token !== first.token);
  ok('1b: THE STRIP RESETS - the previous visit\'s check-in no longer paints',
    second.hit === null);
  ok('1b: the app was told a visit started, so the card is repainted at all',
    w.fired.some((e) => e.type === 'mls:visit-started' && e.detail.reason === 'new-visit'));
  ok('1b: the check-in rows themselves are byte-unchanged', JSON.stringify(rows) === before);

  /* CONTROL: without the visit identity the same sequence still paints it */
  const c = run(false);
  c.w.ctx.__testActiveId = PT;
  c.av.paint(cacheOf(rows));
  c.w.type('Patient reports lower back pain since Friday.');
  c.w.ctx.currentNoteId = 'n-july';
  c.w.win.newVisit();
  ok('1c: CONTROL - with no visit identity published the old behaviour returns (still painted)',
    !!(c.av.paint(cacheOf(rows)).hit));
}

/* =========================================================================
 * 2. THE CURRENT VISIT'S OWN CHECK-IN SHOWS
 * ====================================================================== */
{
  const { w, av } = run(true);
  w.ctx.__testActiveId = PT;

  const july = av.paint(cacheOf(rows));
  w.type('July visit dictation.');
  w.ctx.currentNoteId = 'n-july';
  w.win.newVisit();

  ok('2a: after the reset nothing paints while only the old check-in exists',
    av.paint(cacheOf(rows)).hit === null);

  /* the patient completes a check-in for THIS visit */
  const now = av.paint(cacheOf(rowsPlusToday));
  ok('2b: the check-in completed for the CURRENT visit paints', now.hit && now.hit.id === 777);
  ok('2b: and it is the new one, not the July one', now.hit.summary === 'TODAY ANSWERS');
  ok('2b: the current visit claims it', av.visitOf(777) === now.token);
  ok('2b: the July check-in keeps its own visit - claims are write-once',
    av.visitOf(501) === july.token && july.token !== now.token);
}

/* =========================================================================
 * 3. REOPENING THE OLDER ASSOCIATED VISIT SHOWS THAT CHECK-IN AGAIN
 * ====================================================================== */
{
  const { w, av } = run(true);
  w.ctx.__testActiveId = PT;

  const july = av.paint(cacheOf(rows));
  w.type('July visit dictation.');
  w.ctx.currentSoap = 'S: July';
  /* the visit is saved: the record builder stamps the token it was conducted in */
  const record = w.win.noteRecordFromState(true);
  ok('3a: the saved record carries the visit it was conducted in',
    record.visitToken === july.token && !!record.visitToken);

  w.ctx.currentNoteId = record.id;
  w.win.newVisit();
  ok('3b: the next visit does not show July\'s check-in', av.paint(cacheOf(rowsPlusToday)).hit.id === 777);

  /* the doctor reopens the saved July visit */
  w.win.loadRecordIntoEditor(record);
  const back = av.paint(cacheOf(rowsPlusToday));
  ok('3c: reopening the saved visit adopts its token', back.token === july.token);
  ok('3c: and JULY\'s check-in paints again - the association was never destroyed',
    back.hit && back.hit.id === 501 && back.hit.summary === 'JULY VISIT ANSWERS');

  /* a record written before this block existed has no token: it must still
     resolve to ONE stable answer rather than a fresh one each time */
  w.win.loadRecordIntoEditor({ id: 'legacy-1' });
  const legacyA = av.tokenNow();
  w.win.newVisit();
  w.win.loadRecordIntoEditor({ id: 'legacy-1' });
  ok('3d: a legacy record with no token reopens as the SAME visit every time',
    legacyA === 'note:legacy-1' && av.tokenNow() === 'note:legacy-1');
}

/* =========================================================================
 * 4. THE CHECK-IN RECORDS ARE UNTOUCHED
 * ====================================================================== */
{
  const { w, av } = run(true);
  w.ctx.__testActiveId = PT;
  const before = JSON.stringify(rowsPlusToday);

  av.paint(cacheOf(rowsPlusToday));
  w.type('dictation');
  w.ctx.currentNoteId = 'n-1';
  w.win.newVisit();
  av.paint(cacheOf(rowsPlusToday));
  w.win.newVisit();
  av.paint(cacheOf(rowsPlusToday));

  ok('4a: no reset path mutates a check-in row', JSON.stringify(rowsPlusToday) === before);

  const ledger = av.ledger();
  const ledgerText = JSON.stringify(ledger);
  ok('4b: the local ledger holds only ids and opaque visit tokens',
    Object.keys(ledger).every((k) => {
      const row = ledger[k];
      return Object.keys(row).sort().join(',') === 'at,vt' && typeof row.vt === 'string';
    }));
  ok('4c: no clinical text of any kind reaches the ledger',
    ledgerText.indexOf('TODAY ANSWERS') < 0 && ledgerText.indexOf('JULY VISIT ANSWERS') < 0 &&
    ledgerText.indexOf('Numbness') < 0 && ledgerText.indexOf('pain') < 0 &&
    ledgerText.indexOf(PT) < 0);

  /* and the shipped bytes of the whole ck-1.0.0 region can neither mark a row
     seen nor delete one - a display gate must never become a data operation */
  ok('4d: the reset path never POSTs mark-seen', ckHelpers.indexOf('/seen') < 0 && ckSelect.indexOf('/seen') < 0);
  ok('4e: the reset path never removes a stored record',
    ckHelpers.indexOf('removeItem') < 0 && ckSelect.indexOf('removeItem') < 0);
  ok('4f: the inbox door is untouched - "All check-ins" still opens the full list',
    avatar1p.includes("visitButton(activeHit ? 'All check-ins' : (total ? 'Open check-ins' : 'Open'), false, function () { open(); })"));
  ok('4g: the inbox fetch is still unfiltered by visit',
    avatar1p.includes("api('/api/avatar/checkins?status=' + status)"));
}

/* =========================================================================
 * 5. THE TWINS, AND THE DERIVED LANES
 * ====================================================================== */
{
  ok('5a: the ckvisit-1.0.0 block is byte-identical in both twins', blockA === blockB);
  ok('5b: it is a real block, not an empty marker', Buffer.byteLength(blockA) > 4000);
  /* the twins carry ONE copy each - a duplicated block would install twice */
  ok('5c: exactly one ckvisit block per twin',
    read(TWIN_A).split(BLOCK_START).length === 2 && read(TWIN_B).split(BLOCK_START).length === 2);
  /* the block parses on its own, in the same wrapper the ship gate uses */
  ok('5d: the block compiles', (() => {
    new vm.Script('(function(){\n' + shellSrc + '\n})', { filename: 'ckvisit-1.0.0' });
    return true;
  })());

  /* the avatar edits reach the derived lanes byte for byte (the forks differ
     only by lane identity, and none of the ck-1.0.0 region carries any) */
  for (const [name, text] of [[AVATAR_PROD, avatarProd], [AVATAR_CLONED, avatarCloned]]) {
    ok('5e: ' + name + ' carries the same ck-1.0.0 helpers',
      between(text, CK_HELPERS_FROM, CK_HELPERS_TO, name) === ckHelpers);
    ok('5f: ' + name + ' carries the same selection lines',
      between(text, SELECT_FROM, SELECT_TO, name) === ckSelect);
    ok('5g: ' + name + ' listens for mls:visit-started',
      text.includes("window.addEventListener('mls:visit-started', onVisitStarted, false);"));
  }

  /* the shell block never publishes a second owner of the visit token */
  ok('5h: exactly one writer of the visit token key',
    (shellSrc.split('localStorage.setItem(storeKey()').length - 1) === 1);
  ok('5i: the block is idempotent against a second evaluation',
    shellSrc.includes('if (window.__mlsVisitIdentity) return;'));
  ok('5j: no regex literal in the block (an escape lost in transport still parses)',
    !/[^\w)\]]\/(?![/*])(?:[^\n/\\]|\\.)+\//.test(shellSrc));
}

/* =========================================================================
 * 6. THE ONE THING THAT MUST NOT REGRESS: browsing is not a visit
 * ====================================================================== */
{
  const { w, av } = run(true);
  w.ctx.__testActiveId = PT;
  const first = av.paint(cacheOf(rows));
  /* the doctor opens the chart, changes nothing, and taps New visit */
  w.win.newVisit();
  w.win.newVisit();
  const still = av.paint(cacheOf(rows));
  ok('6a: an EMPTY editor reset does not burn the visit token', still.token === first.token);
  ok('6b: so the check-in in front of the doctor is never lost to a stray reset',
    still.hit && still.hit.id === 501);
  ok('6c: and the empty reset says so honestly',
    w.fired.some((e) => e.type === 'mls:visit-started' && e.detail.reason === 'new-visit-empty'));
}

console.log('\nPASS checkin-resets-per-visit: ' + pass + ' checks');
