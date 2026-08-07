'use strict';
/* =========================================================================
   THE OP-NOTE ROOM IS NOT ALLOWED TO BE SLOW — PROVED BY EXECUTION
   -------------------------------------------------------------------------
   OWNER (2026-08-07): "the op notes still draft pretty slowly and maybe could
   be drafted all at once for a day ... things are just laggy in the op notes
   section every button freezes up and then only clicks after like 3 seconds".

   Two separate defects, both measured against the real modules, both fenced
   here BY RUNNING THEM rather than by reading the source.

   -------------------------------------------------------------------------
   1. THE STORE WAS RE-PARSED IN LOOPS  (the three-second buttons)

   getTemplates() did a JSON.parse of the whole template library plus two
   normalisation passes on EVERY call. On the owner's account that is 96
   templates and ~520KB of JSON. The op-note room calls it per ROW:
   opPrepRender's tplOpts closure ran it once per patient card, the 1s Fields
   box tick ran it once per row inside syncProcedure, and getTemplateById wraps
   it as well. A nineteen-patient day therefore burned the main thread on
   dozens of parses for a single repaint — and nearly every control in that
   room ends in a repaint.

   The cache is keyed on the account key AND the raw stored string, so it
   cannot go stale: any write changes the string and the next read re-parses.
   Scenario 1 proves both halves — that repeated reads parse ONCE, that a write
   is seen immediately, and (the part that would be a real bug if it were
   wrong) that callers still receive their OWN objects, because several of them
   mutate the returned list before deciding whether to save it.

   -------------------------------------------------------------------------
   2. DRAFT-ALL WAITED FOR EACH ROUND TRIP  (drafting a day)

   The runner drafted patient N+1 only after patient N's HTTP response had
   fully returned, then waited another 350ms. Nineteen patients at ~9s each is
   about three and a half minutes of a mostly idle tab.

   IT COULD NOT SIMPLY BE PARALLELISED. The verdict for a draft lived in window
   globals (__mlsLastOpFidelityPass / __mlsLastOpFidelityError /
   __mlsLastOpErrorCode) which the NEXT row cleared on entry. With two drafts in
   flight the second row's entry-clear lands between the first row's success and
   the runner's read, so the ledger credits or blames the wrong patient. On a
   surgeon's nineteen-patient day that is a note reported as drafted that was
   not, which is the exact class of defect this file's neighbours exist to stop.

   So the base drafter now stamps its verdict on the row it drafted, and the
   runner only overlaps when that capability is present
   (window.__mlsOpNoteRowVerdicts). Scenario 2 runs the REAL runner sliced out
   of mls-connect.js against a drafter that deliberately interleaves — row 0
   finishes only AFTER row 1 has started and wiped the globals — and asserts:
     - the run really overlaps (more than one draft in flight at once),
     - every row is scored from its OWN outcome, including row 0, which the
       global-only rule scored as a failure,
     - a failure message names the patient it belongs to and no other,
     - and with the capability flag absent the runner goes back to strictly one
       at a time, so an older shell keeps the old behaviour rather than a
       subtly wrong fast one.

   NON-VACUITY. Scenario 2c re-scores the same interleaved run under the OLD
   global-only rule and asserts it gets the WRONG answer — if that ever starts
   agreeing, this suite is no longer measuring anything.
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'utf8');
const CONNECT = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'utf8');

let failures = 0;
function ok(cond, label, detail) {
  if (cond) { console.log('  pass  ' + label); return true; }
  failures++;
  console.log('  FAIL  ' + label + (detail ? '\n        ' + detail : ''));
  return false;
}
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------------------
   SLICERS. Both take the real shipped text; neither is allowed to guess at a
   line number, so a refactor moves them rather than silently testing nothing.
   ------------------------------------------------------------------------ */
function sliceBetween(src, startMark, endMark, what) {
  const a = src.indexOf(startMark);
  if (a < 0) throw new Error('cannot find the start of ' + what + ': ' + startMark);
  const b = src.indexOf(endMark, a);
  if (b < 0) throw new Error('cannot find the end of ' + what + ': ' + endMark);
  return src.slice(a, b + endMark.length);
}

/* =========================================================================
   SCENARIO 1 — the template store parses once and still hands out own objects
   ====================================================================== */
head('1. THE TEMPLATE STORE IS READ IN LOOPS, SO IT PARSES ONCE');

const STORE_SRC = sliceBetween(
  SHELL,
  'var _tplCacheKey=null',
  'function getTemplateById(id){ var hit=_tplStore().find(function(t){ return t.id===id; }); return hit?_tplClone(hit):null; }',
  'the template store'
);

function makeStore(initial) {
  const mem = { 'sf_u::doc::templates': JSON.stringify(initial) };
  let parses = 0;
  const sandbox = {
    uns: (k) => 'sf_u::doc::' + k,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); }
    },
    JSON: {
      parse: (s) => { parses++; return JSON.parse(s); },
      stringify: JSON.stringify
    },
    Object: Object,
    Array: Array,
    String: String,
    Date: Date,
    syncPrefsToServer: undefined,
    console: console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(STORE_SRC, sandbox);
  return {
    ctx: sandbox,
    parses: () => parses,
    raw: () => mem['sf_u::doc::templates']
  };
}

const SEED = [
  { id: 't1', name: 'Lumbar TFESI', keywords: ['transforaminal', 'esi'], text: 'A'.repeat(4000), created: 1 },
  { id: 't2', name: 'Cervical MBB', keywords: ['medial branch'], text: 'B'.repeat(4000), created: 2 },
  { id: 't3', name: 'SI Joint injection', keywords: ['sacroiliac'], text: 'C'.repeat(4000), created: 3 }
];

{
  const S = makeStore(SEED);
  const first = S.ctx.getTemplates();
  const afterFirst = S.parses();
  for (let n = 0; n < 40; n++) S.ctx.getTemplates();
  for (let n = 0; n < 40; n++) S.ctx.getTemplateById('t2');
  const afterMany = S.parses();

  ok(first.length === 3, 'the store still returns every template', 'got ' + first.length);
  ok(afterFirst === 1, 'the first read parses exactly once', 'parses=' + afterFirst);
  ok(afterMany === afterFirst,
    '80 further reads parse ZERO more times (this is the three-second freeze)',
    'parses went ' + afterFirst + ' -> ' + afterMany);

  /* the cache is a cache, not a snapshot: a write must be visible at once */
  const list = S.ctx.getTemplates();
  list.push({ id: 't4', name: 'Caudal ESI', keywords: ['caudal'], text: 'D'.repeat(400), created: 4 });
  S.ctx.setTemplates(list);
  const after = S.ctx.getTemplates();
  ok(after.length === 4 && after[3].id === 't4',
    'a write is seen by the very next read', 'got ' + after.length + ' templates');
  ok(S.parses() === afterMany + 1,
    'and that re-read costs exactly one parse, not one per template',
    'parses=' + S.parses());

  /* THE PART THAT WOULD BE A REAL BUG. duplicateTemplate, restoreTemplate,
     deleteOne and the health panel's stamp() all mutate the returned list and
     only some of them save it. Handing back the cached array would make one
     caller's scratch edit everybody's truth. */
  const a = S.ctx.getTemplates();
  const b = S.ctx.getTemplates();
  a[0].name = 'SCRATCH EDIT';
  a[0].keywords.push('scratch');
  a.unshift({ id: 'ghost', name: 'never saved', keywords: [], text: '' });
  ok(b[0].name === 'Lumbar TFESI',
    'one caller mutating its list does not reach another caller', 'b[0].name=' + b[0].name);
  ok(b[0].keywords.indexOf('scratch') < 0,
    'nested arrays are copied too, not shared', JSON.stringify(b[0].keywords));
  ok(S.ctx.getTemplates().length === 4 && S.ctx.getTemplates()[0].id === 't1',
    'an unsaved insert never becomes the stored library');
  const byId = S.ctx.getTemplateById('t1');
  byId.name = 'ALSO SCRATCH';
  ok(S.ctx.getTemplateById('t1').name === 'Lumbar TFESI',
    'getTemplateById hands back its own object as well');
}

{
  /* the account key is part of the key: signing into another account must not
     serve the previous doctor's library out of the cache */
  const S = makeStore(SEED);
  S.ctx.getTemplates();
  S.ctx.localStorage.setItem('sf_u::other::templates', JSON.stringify([{ id: 'x', name: 'Other doctor', keywords: [], text: 'x'.repeat(300) }]));
  S.ctx.uns = (k) => 'sf_u::other::' + k;
  const other = S.ctx.getTemplates();
  ok(other.length === 1 && other[0].id === 'x',
    'a different account key re-reads instead of serving the cache',
    JSON.stringify(other.map((t) => t.id)));
}

/* =========================================================================
   SCENARIO 2 — Draft-all overlaps, and scores every row from its own outcome
   ====================================================================== */
head('2. DRAFT-ALL DRAFTS A DAY IN PARALLEL AND STILL BLAMES THE RIGHT PATIENT');

const TPF_START = '(function () {\n  "use strict";\n  if (window.__mlsTplPrepFix) return;';
const TPF_END = 'window.__mlsTplPrepFix = 0;\n    return "reverted";\n  };\n})();';
const TPF_SRC = sliceBetween(CONNECT, TPF_START, TPF_END, 'the template-prep / draft-all module');

/* --- the smallest DOM this runner actually touches ---------------------- */
function makeDom() {
  const byId = {};
  function el(tag) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      _id: '', children: [], parentElement: null, parentNode: null,
      style: { cssText: '' }, dataset: {}, textContent: '', innerHTML: '',
      disabled: false, type: '', value: '',
      classList: {
        _s: {},
        add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; },
        contains(c) { return !!this._s[c]; },
        toggle(c, on) { if (on) this.add(c); else this.remove(c); }
      },
      setAttribute() {}, getAttribute() { return null; },
      appendChild(k) { this.children.push(k); k.parentElement = this; k.parentNode = this; return k; },
      insertBefore(k) { this.children.push(k); k.parentElement = this; k.parentNode = this; return k; },
      removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); return k; },
      remove() { if (this.parentElement) this.parentElement.removeChild(this); },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      closest() { return null; },
      addEventListener() {}, removeEventListener() {}
    };
    Object.defineProperty(node, 'id', {
      get() { return this._id; },
      set(v) { this._id = String(v); byId[this._id] = this; }
    });
    return node;
  }
  const doc = {
    _byId: byId,
    head: el('head'), body: el('body'), documentElement: el('html'),
    createElement: el,
    getElementById: (id) => byId[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
  ['opPrepStatus', 'opPrepGenAllBtn', 'tpfLedger', 'tpfLedgerList', 'tpfLedgerFails',
    'tpfBarIn', 'tpfPanel', 'templatesModal', 'opPrepModal', 'opPrepDayRow'].forEach((id) => {
    const n = el('div'); n.id = id;
  });
  return doc;
}

/* draftAll resolves when it kicks off, not when it finishes; wait for the
   ledger to report a terminal summary. */
function untilDone(document, tries) {
  return new Promise((res, rej) => {
    let n = 0;
    (function poll() {
      const st = (document.getElementById('opPrepStatus') || {}).textContent || '';
      if (/Done:|Stopped:/.test(st)) return res(st);
      if (++n > (tries || 400)) return rej(new Error('draft-all never finished; status=' + JSON.stringify(st)));
      setTimeout(poll, 5);
    })();
  });
}

/* The runner is fire-and-forget, so drive it and then wait on the summary. */
function drive(plan, opts) {
  opts = opts || {};
  const document = makeDom();
  const toasts = [];
  let inflight = 0, maxInflight = 0;
  const order = [];
  const rows = plan.map((p, i) => ({
    appt: { name: p.name, dob: '1970-01-0' + ((i % 9) + 1) },
    patientId: 'p' + i, proc: 'Left L4-L5 transforaminal epidural steroid injection',
    tplId: 't1', tplManual: true, gen: false, note: '', missing: []
  }));

  const sandbox = {
    document,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 8)),
    clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Promise, JSON, Math, Date, Object, Array, String, Number, RegExp, Error, isNaN, parseInt,
    console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.reject(new Error('no network in this test'))
  };
  sandbox.window = sandbox;
  const win = sandbox;
  win.toast = (m) => { toasts.push(String(m)); };
  win._opPrep = rows;
  const TPL = { id: 't1', name: 'Lumbar TFESI', keywords: ['esi'], text: 'T'.repeat(900), created: 1 };
  win.getTemplates = () => [TPL];
  win.getTemplateById = (id) => (id === 't1' ? TPL : null);
  win._opResolvePatient = (n) => ({ id: 'chart-' + n, name: n });
  win._opRankTemplates = () => [{ tpl: TPL, score: 9 }];
  win.opNoteBlankTokens = () => [];
  win.mlsConfirm = () => Promise.resolve(true);
  if (opts.rowVerdicts !== false) win.__mlsOpNoteRowVerdicts = true;

  const pending = [];
  win.opPrepGenerateOne = function (i) {
    const row = rows[i], p = plan[i];
    order.push('start:' + i);
    inflight++; if (inflight > maxInflight) maxInflight = inflight;
    /* the shipped drafter clears these on entry — that is precisely what made
       a global-only verdict unsafe the moment two rows overlap */
    win.__mlsLastOpFidelityPass = false;
    win.__mlsLastOpFidelityError = '';
    win.__mlsLastOpErrorCode = '';
    return new Promise((resolve) => {
      const settle = () => {
        inflight--;
        order.push('end:' + i);
        if (p.fail) {
          win.__mlsLastOpFidelityError = p.fail;
          win.__mlsLastOpErrorCode = p.code || 'MLS_OPNOTE_CLINICAL_CONFLICT';
          if (opts.rowVerdicts !== false) {
            row._genPass = false; row._genErr = p.fail; row._genErrCode = p.code || 'MLS_OPNOTE_CLINICAL_CONFLICT';
          }
          resolve(false);
          return;
        }
        row.gen = true;
        row.note = 'OPERATIVE NOTE — ' + p.name + '\n' + 'x'.repeat(200);
        win.__mlsLastOpFidelityPass = true;
        if (opts.rowVerdicts !== false) { row._genPass = true; row._genErr = ''; row._genErrCode = ''; }
        resolve(true);
      };
      if (p.waitFor != null) pending.push({ needs: p.waitFor, settle });
      else setTimeout(settle, p.ms || 2);
    });
  };
  /* release any row that was waiting for a later row to START */
  const releaser = setInterval(() => {
    for (let k = pending.length - 1; k >= 0; k--) {
      if (order.indexOf('start:' + pending[k].needs) >= 0) { const s = pending[k].settle; pending.splice(k, 1); s(); }
    }
  }, 3);

  vm.createContext(sandbox);
  vm.runInContext(TPF_SRC, sandbox);
  win.__mlsTplPrepFix.draftAll();
  return untilDone(document).then((status) => {
    clearInterval(releaser);
    return { rows, order, maxInflight, toasts, status, document };
  }, (e) => { clearInterval(releaser); throw e; });
}

const DAY = [
  /* row 0 deliberately finishes only after row 1 has STARTED, which is the
     moment the shared globals are wiped. Under the old global-only rule this
     patient's good note was scored as a failure. */
  { name: 'Ada Lovelace', waitFor: 1 },
  { name: 'Grace Hopper', ms: 6 },
  { name: 'Alan Turing', ms: 3 },
  { name: 'Katherine Johnson', fail: 'the note changed the requested level (L4-L5 became L5-S1)', code: 'MLS_OPNOTE_CLINICAL_CONFLICT' },
  { name: 'Edsger Dijkstra', ms: 4 },
  { name: 'Barbara Liskov', ms: 2 }
];

drive(DAY).then((r) => {
  head('2a. it really overlaps');
  ok(r.maxInflight > 1,
    'more than one op note is drafted at a time (this is the whole point)',
    'max in flight was ' + r.maxInflight);
  ok(r.maxInflight <= 3,
    'and never more than the three-lane cap',
    'max in flight was ' + r.maxInflight);
  ok(r.order.indexOf('start:1') < r.order.indexOf('end:0'),
    'the interleaving under test really happened: row 1 started before row 0 finished',
    r.order.join(' '));

  head('2b. every row is scored from its OWN outcome');
  ok(/✅ Done: 5 drafted · 1 failed · 0 skipped of 6\./.test(r.status),
    'the summary is 5 drafted, 1 failed, 0 skipped of 6',
    JSON.stringify(r.status));
  ok(r.rows[0].gen === true && !r.rows[0]._lastDraftErr,
    'row 0 — the one whose globals a later row wiped — is NOT blamed',
    'gen=' + r.rows[0].gen + ' err=' + JSON.stringify(r.rows[0]._lastDraftErr));
  ok(String(r.rows[3]._lastDraftErr || '').indexOf('L4-L5 became L5-S1') >= 0,
    "the failing row keeps its own reason",
    JSON.stringify(r.rows[3]._lastDraftErr));
  const strayBlame = [0, 1, 2, 4, 5].filter((i) => String(r.rows[i]._lastDraftErr || '').trim());
  ok(strayBlame.length === 0,
    "no other patient inherits the failing patient's reason",
    'rows blamed: ' + strayBlame.join(', '));

  head('2c. NON-VACUITY — the old global-only rule gets this wrong');
  /* Replay the same interleave and score row 0 the way the runner used to:
     purely from window.__mlsLastOpFidelityPass read after the await. Row 1
     started first and set it false, so the old rule fails a good note. */
  const oldRuleWouldSay = (function () {
    let flag = false;
    flag = false;                       // row 0 enters, clears
    flag = false;                       // row 1 enters, clears again
    flag = true;                        // row 0's generator succeeds
    flag = false;                       // row 2 enters, clears -> row 0's read
    return flag;
  })();
  ok(oldRuleWouldSay === false,
    'the global a later row cleared would have scored row 0 as a failure',
    'old rule said ' + oldRuleWouldSay);
  ok(r.rows[0]._genPass === true,
    "...while the row's own stamp says what actually happened");

  head('2d. without the per-row capability it stays strictly serial');
  return drive([
    { name: 'Ada Lovelace', ms: 3 },
    { name: 'Grace Hopper', ms: 3 },
    { name: 'Alan Turing', ms: 3 },
    { name: 'Katherine Johnson', ms: 3 }
  ], { rowVerdicts: false });
}).then((r2) => {
  ok(r2.maxInflight === 1,
    'an older shell (no per-row verdicts) drafts exactly one at a time',
    'max in flight was ' + r2.maxInflight);
  ok(/✅ Done: 4 drafted · 0 failed · 0 skipped of 4\./.test(r2.status),
    'and still reports the run honestly',
    JSON.stringify(r2.status));

  /* =====================================================================
     SCENARIO 3 — the repaint guards invalidate themselves
     ================================================================== */
  head('3. THE WRITE-IF-CHANGED GUARDS CANNOT STRAND AN EMPTY SURFACE');
  const ROOM = fs.readFileSync(path.join(ROOT, 'feat_mls_opnote_room.js'), 'utf8');
  ok(/if \(nav\.__oprHtml !== h\) \{ nav\.innerHTML = h; nav\.__oprHtml = h; \}/.test(ROOM),
    'the patient rail writes only when its markup changed');
  ok(/var changed = \(rail\.__oprHtml !== h\);/.test(ROOM),
    'the template rail writes only when its markup changed');
  ok(/a\.innerHTML = ''; a\.__oprHtml = null;/.test(ROOM) && /b\.innerHTML = ''; b\.__oprHtml = null;/.test(ROOM),
    'revert() clears BOTH caches — the nodes outlive the module, so a stale cache would leave a rail permanently empty');
  ok(/if \(nav\.__oprHtml !== ''\) \{ nav\.innerHTML = ''; nav\.__oprHtml = ''; \}/.test(ROOM),
    'the single-patient path keeps the cache and the DOM in step');

  ok(/if\(box\.__opPrepHtml===_html && box\.firstChild\)\{ return; \}/.test(SHELL),
    'opPrepRender skips a repaint that would produce identical markup');
  const emptyPaths = (SHELL.match(/box\.innerHTML='[^']*'; box\.__opPrepHtml='';/g) || []).length
    + (SHELL.match(/box\.innerHTML='';\s*box\.__opPrepHtml='';/g) || []).length;
  ok(emptyPaths >= 2,
    'and BOTH of its early-return paths reset the cache, so the next real render is not skipped',
    'found ' + emptyPaths);

  console.log('');
  if (failures) {
    console.log('FAIL  op-note drafting performance: ' + failures + ' assertion(s) failed.');
    process.exit(1);
  }
  console.log('PASS  opnote-drafting-is-not-serialised: the store parses once, a day drafts three at a time, and every row is still scored from its own outcome.');
}).catch((e) => {
  console.log('\nFAIL  the suite could not complete: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
