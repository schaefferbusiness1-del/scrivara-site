'use strict';
/* tn-1.0.0 - SHARED TEAM NOTES ON A PATIENT.
 *
 * Owner, 2026-09-01: "i need it possible for a head docotr and the docotrs
 * under them to be able to like go in and see there vivists and leave shared
 * notes to each otehr for a patient and for it to be easy."
 *
 * The feature is a WRITABLE, SHARED, PERSISTENT surface, which makes the
 * failure modes worse than a derivation's. The five that would make it worse
 * than not having it at all:
 *
 *   1. LOSING A NOTE. Every other patient field in this app is either derived
 *      (a sweep rebuilds it) or pulled (a re-pull restores it). A team note has
 *      no other source: lose it and it is gone, and nobody knows a message is
 *      missing. Three separate paths could lose one and all three are executed
 *      below - a stale-reference upsertPatient write-back, a duplicate-chart
 *      merge, and a two-tab edit race.
 *   2. RESURRECTING A DELETED NOTE. The carry that fixes (1) is a UNION, and a
 *      union over a spliced array puts every deletion straight back. Proven
 *      that a delete is a tombstone and that it beats its own original.
 *   3. GENERATING WITHOUT BEING ASKED. An unrequested model paragraph in a
 *      shared clinical thread is a defect however good it is. Proven: no timer,
 *      no boot hook, and the transport is not touched by loading, rendering,
 *      expanding, or refusing.
 *   4. PASSING A NOTE OFF AS SOMETHING IT IS NOT. The app authenticates one
 *      account, not a doctor, so an author is what a human typed. Proven that
 *      ai:true survives an edit and renders its tag, and that the module claims
 *      no verified identity anywhere.
 *   5. RENDERING A NOTE AS MARKUP. Note text is the only free-text field in
 *      this app that one user writes and another user's browser renders.
 *      Proven through the shell's OWN esc(), not a copy of it.
 *
 * And the one that would make it pointless: being invisible. #profileCard ships
 * COLLAPSED, and the pf2 pass re-parents its children - so the wiring that
 * keeps this section visible and un-adopted is pinned in every lane below.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }
/* values built inside the vm carry that realm's prototypes, so deepStrictEqual
   fails on identical data. Compare the serialized form - this is about values. */
function deep(a, b, m) { checks++; assert.deepStrictEqual(JSON.parse(JSON.stringify(a === undefined ? null : a)), JSON.parse(JSON.stringify(b === undefined ? null : b)), m); }

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

const MODULE = 'feat_mls_team_notes.js';
const MERGE = 'feat_mls_patient_merge.js';
const src = read(MODULE);
const mergeSrc = read(MERGE);
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
const CONNECTS = ['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'];

new Function(src);      /* syntax gate - a module that cannot parse proves nothing */
new Function(mergeSrc);

/* ------------------------------------------------------------------ lift */
/* Pull one top-level function out of a shell so the REAL shipped code runs
   here rather than a paraphrase of it. */
function lift(text, name) {
  const i = text.indexOf('function ' + name + '(');
  assert.ok(i >= 0, 'missing function ' + name);
  let d = 0, e = -1;
  const j = text.indexOf('{', i);
  for (let k = j; k < text.length; k++) {
    const c = text[k];
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = k + 1; break; } }
  }
  assert.ok(e > 0, 'unbalanced function ' + name);
  return text.slice(i, e);
}

/* --------------------------------------------------------------- harness */

function fakeEl(id) {
  const el = {
    id: id, style: {}, value: '', _html: '', handlers: {}, attrs: {},
    parentNode: null, children: [],
    get innerHTML() { return el._html; },
    set innerHTML(v) { el._html = String(v); },
    addEventListener(t, f) { (el.handlers[t] = el.handlers[t] || []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
    querySelector() { return null; }
  };
  return el;
}
function target(attrs) {
  return {
    parentNode: null,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; }
  };
}
function evt(t) {
  return { target: t, preventDefault() {}, stopPropagation() {}, key: '', shiftKey: false };
}

/* The shell's REAL esc(), so the XSS proof measures the shipped escaper and
   not a lookalike written for this file. */
const realEsc = new Function(lift(read('1pScribeFlow.html'), 'esc') + '\nreturn esc;')();

function makeSandbox(opts) {
  opts = opts || {};
  let patients = opts.patients ? JSON.parse(JSON.stringify(opts.patients)) : [];
  const upserts = [];
  const toasts = [];
  const aiCalls = [];
  const timers = [];
  const store = {};
  const els = {};
  let renders = 0;

  const context = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, Promise, RegExp, Error,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval(fn, ms) { timers.push({ fn, ms, interval: true }); return timers.length; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    },
    document: {
      getElementById(id) { return Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null; },
      createElement(t) { return fakeEl(t); }
    },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; }
  };
  context.window = context;
  context.window.addEventListener = function () {};
  context.window.removeEventListener = function () {};
  context.window.dispatchEvent = function () { return true; };

  els[opts.boxId || 'pf2TeamNotes'] = fakeEl(opts.boxId || 'pf2TeamNotes');

  context.getPatients = function () { return patients.slice(); };
  context.activePatient = function () { return opts.noActive ? null : (patients[0] || null); };
  /* The real upsertPatient replaces the record wholesale (arr[i]=p) after
     running its carry block. This stand-in does the same two things, so a
     module bug that relies on mutation-in-place cannot hide here. */
  context.upsertPatient = function (p) {
    upserts.push(JSON.parse(JSON.stringify(p)));
    if (opts.upsertThrows) throw new Error('quota');
    const i = patients.findIndex((x) => String(x.id) === String(p.id));
    if (i >= 0) patients[i] = JSON.parse(JSON.stringify(p));
    else patients.unshift(JSON.parse(JSON.stringify(p)));
    return p;
  };
  context.toast = function (m, k) { toasts.push({ msg: String(m), kind: String(k || '') }); };
  context.renderProfile = function () { renders++; if (context.__mlsTeamNotesRender) context.__mlsTeamNotesRender(context.activePatient()); };
  context.esc = realEsc;
  context.backendMode = function () { return opts.backend !== false; };
  context.bkToken = function () { return opts.token === undefined ? 'tok' : opts.token; };
  context.getKey = function () { return ''; };
  context.friendlyError = function (e) { return 'friendly:' + (e && e.message); };
  if (opts.ai !== false) {
    context.aiCallRaw = function (sys, user, key, o) {
      aiCalls.push({ sys, user, key, opts: o });
      if (opts.aiRejects) return Promise.reject(new Error('402 no_access'));
      return Promise.resolve(opts.aiText === undefined ? 'A short overview of this patient.' : opts.aiText);
    };
  }

  vm.createContext(context);
  vm.runInContext(src, context);

  return {
    context, upserts, toasts, aiCalls, timers, els, store,
    api() { return context.window.__mlsTeamNotes; },
    box() { return els[opts.boxId || 'pf2TeamNotes']; },
    patients() { return patients; },
    pt() { return patients[0]; },
    renders() { return renders; },
    click(attrs) {
      const box = els[opts.boxId || 'pf2TeamNotes'];
      const hs = box.handlers.click || [];
      const e = evt(target(attrs));
      for (const h of hs) h(e);
    },
    key(id, k, shift) {
      const box = els[opts.boxId || 'pf2TeamNotes'];
      const hs = box.handlers.keydown || [];
      const t = els[id] || fakeEl(id);
      const e = { target: t, key: k, shiftKey: !!shift, preventDefault() {}, stopPropagation() {} };
      for (const h of hs) h(e);
    },
    input(id, value) { const el = els[id] || (els[id] = fakeEl(id)); el.value = value; return el; }
  };
}

const PT = () => ([{
  id: 'p1', name: 'Adam Schaeffer', sex: 'M', dob: '1980-02-11', mrn: '7833832',
  problems: 'Hypertension\nType 2 diabetes', meds: 'Metformin 500mg', allergies: 'Penicillin',
  summary: 'Followed for HTN and DM2.',
  visits: [
    { date: '2026-08-17', type: 'Follow-up', raw: 'BP 128/78, tolerating metformin.', bodyComplete: true },
    { date: '2026-08-03', type: 'Office visit', indexOnly: true },
    { date: '2026-07-20', type: 'Procedure', raw: 'Lesion excised.', bodyComplete: true }
  ],
  providerLink: {
    v: 1, primaryProvider: 'Matthew Schaeffer, MD', primaryProviderKey: 'matthew schaeffer',
    providersSeen: [
      { name: 'Matthew Schaeffer, MD', key: 'matthew schaeffer', count: 2, last: '2026-08-17', days: ['2026-08-17', '2026-07-20'] },
      { name: 'Dana Reyes, PA-C', key: 'dana reyes', count: 1, last: '2026-08-03', days: ['2026-08-03'] }
    ]
  }
}]);

/* =====================================================================
   1. THE MODEL - a note is added, edited, tombstoned and restored, and
      every mutation produces a NEW array and a NEW note object
   ===================================================================== */
{
  const sb = makeSandbox({ patients: PT() });
  const api = sb.api();

  const a = api.addNote([], { text: '  Watch his BP at the next visit.  ', author: ' Dr Reyes ', now: 1000, rnd: 0.123456789 });
  ok(a.ok, 'a note with text must be accepted');
  eq(a.list.length, 1, 'the first note must land');
  const n = a.list[0];
  eq(n.v, 1, 'a note must carry its schema version');
  eq(n.at, 1000, 'the note must be stamped with its creation time');
  eq(n.author, 'Dr Reyes', 'the author must be trimmed');
  eq(n.text, 'Watch his BP at the next visit.', 'the text must be trimmed');
  eq(n.ai, false, 'a human note must be ai:false, never undefined - the flag is what the tag renders from');
  ok(/^tn_[0-9a-z]+_[0-9a-z]*$/.test(n.id), 'the id must be the documented tn_ shape, got ' + n.id);
  deep(Object.keys(n).sort(), ['ai', 'at', 'author', 'id', 'text', 'v'], 'a plain note must carry exactly the documented keys');

  /* the input array is not touched */
  const base = a.list;
  const b = api.addNote(base, { text: 'Second', author: 'Dr Chen', now: 2000 });
  eq(base.length, 1, 'addNote must not mutate the array it was given');
  eq(b.list.length, 2, 'the second note must land');
  eq(b.list[0].text, 'Second', 'the thread must read newest first');

  /* empty is refused, and refused is not the same as saved */
  eq(api.addNote(base, { text: '   ', author: 'x', now: 3000 }).ok, false, 'whitespace-only must be refused');
  eq(api.addNote(base, { text: '', author: 'x', now: 3000 }).reason, 'empty', 'the refusal must say why');

  /* edit */
  const e = api.editNote(b.list, b.list[0].id, 'Second, corrected', 5000);
  ok(e.ok, 'an edit of a live note must be accepted');
  eq(e.list.length, 2, 'an edit must not change the note count');
  const edited = e.list.filter((x) => x.id === b.list[0].id)[0];
  eq(edited.text, 'Second, corrected', 'the edit must apply');
  eq(edited.ed, 5000, 'an edit must stamp ed');
  eq(edited.at, 2000, 'an edit must NOT move the creation time - the thread order is when it was written');
  eq(b.list[0].text, 'Second', 'editNote must not mutate the stored note object');
  eq(api.editNote(b.list, 'nope', 'x', 6000).reason, 'missing', 'editing an unknown id must refuse, never create');
  eq(api.editNote(b.list, b.list[0].id, '   ', 6000).ok, false, 'an edit cannot blank a note - use delete');

  /* delete is a TOMBSTONE */
  const d = api.removeNote(e.list, b.list[0].id, 7000);
  ok(d.ok, 'a delete must be accepted');
  eq(d.list.length, 2, 'a delete must NOT splice - the row stays as a tombstone');
  const tomb = d.list.filter((x) => x.id === b.list[0].id)[0];
  eq(tomb.del, true, 'the tombstone must be flagged');
  eq(tomb.delAt, 7000, 'the tombstone must carry its time');
  eq(tomb.text, 'Second, corrected', 'a tombstone keeps its text - a delete that shreds the text cannot be undone');
  eq(api.live(d.list).length, 1, 'a tombstoned note must not be live');
  eq(api.countOf({ teamNotes: d.list }), 1, 'the count must be of LIVE notes only');

  /* restore must outrank its own tombstone */
  const r = api.restoreNote(d.list, b.list[0].id, 8000);
  ok(r.ok, 'a restore must be accepted');
  eq(api.live(r.list).length, 2, 'the restored note must be live again');
  const back = r.list.filter((x) => x.id === b.list[0].id)[0];
  ok(api.rev(back) > 7000, 'THE RESTORE MUST OUTRANK ITS OWN TOMBSTONE (rev ' + api.rev(back) + ' vs delAt 7000) - otherwise the very next union puts the tombstone back');
  eq(api.removeNote(d.list, b.list[0].id, 9000).reason, 'missing', 'deleting an already-deleted note must refuse, not double-tombstone');
}

/* =====================================================================
   2. THE UNION - the one rule three separate call sites depend on
   ===================================================================== */
{
  const sb = makeSandbox({ patients: PT() });
  const api = sb.api();
  const A = { v: 1, id: 'tn_a', at: 100, author: 'X', text: 'first', ai: false };
  const B = { v: 1, id: 'tn_b', at: 200, author: 'Y', text: 'second', ai: false };

  deep(api.union([A], [B]).map((x) => x.id), ['tn_b', 'tn_a'], 'the union must keep both and sort newest first');
  eq(api.union([A, B], [A, B]).length, 2, 'the union must be idempotent - a note cannot double');
  deep(api.union([A], []).map((x) => x.id), ['tn_a'], 'a union with nothing must keep everything');

  /* higher revision wins, in BOTH argument orders */
  const Aedit = { v: 1, id: 'tn_a', at: 100, ed: 500, author: 'X', text: 'first, corrected', ai: false };
  eq(api.union([A], [Aedit])[0].text, 'first, corrected', 'the edited copy must win over the original');
  eq(api.union([Aedit], [A])[0].text, 'first, corrected', 'and it must win from the other argument order too');
  const Adel = { v: 1, id: 'tn_a', at: 100, ed: 500, del: true, delAt: 900, author: 'X', text: 'first', ai: false };
  eq(api.union([Aedit], [Adel])[0].del, true, 'a tombstone must beat an older edit');
  eq(api.union([Adel], [Aedit])[0].del, true, 'and from the other order');

  /* deterministic order for equal timestamps - two runs cannot disagree */
  const C = { v: 1, id: 'tn_c', at: 100, author: 'Z', text: 'c', ai: false };
  deep(api.union([A], [C]).map((x) => x.id), api.union([C], [A]).map((x) => x.id),
    'the union order must not depend on argument order when timestamps tie');

  /* junk is dropped, never thrown on */
  eq(api.union([null, undefined, 5, {}, { id: '' }, A], []).length, 1, 'malformed rows must be ignored, not crash the thread');
}

/* =====================================================================
   3. THE SHELL CARRY - executed, in every lane, from the shipped source
   ===================================================================== */
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');

  const carry = new Function(
    lift(html, '__mlsTeamNoteRev') + '\n' + lift(html, '__mlsTeamNotesUnion') + '\n' + lift(html, '__mlsTeamNotesCarry') +
    '\nreturn {rev:__mlsTeamNoteRev, union:__mlsTeamNotesUnion, carry:__mlsTeamNotesCarry};')();

  const stored = [
    { v: 1, id: 'tn_1', at: 100, author: 'Dr A', text: 'from A', ai: false },
    { v: 1, id: 'tn_2', at: 200, author: 'Dr B', text: 'from B', ai: false }
  ];

  /* THE LOSS THIS EXISTS TO PREVENT: a caller that read the patient before
     tn_2 was written now writes its older object back. */
  const stale = { id: 'p1', name: 'Adam', teamNotes: [stored[0]] };
  carry.carry(stale, { id: 'p1', teamNotes: stored });
  eq(stale.teamNotes.length, 2, shell + ': A STALE WRITE-BACK DROPPED A COLLEAGUE\'S NOTE - the carry must union, not fill');
  deep(stale.teamNotes.map((x) => x.id), ['tn_2', 'tn_1'], shell + ': the carried thread must be newest-first');

  /* a caller that never saw the field at all */
  const blind = { id: 'p1', name: 'Adam' };
  carry.carry(blind, { id: 'p1', teamNotes: stored });
  eq(blind.teamNotes.length, 2, shell + ': a caller carrying no teamNotes must inherit the stored thread');

  /* and the deletion must NOT be resurrected by that same union.
     BOTH DIRECTIONS MATTER, and the second one is the real-world case:
       (a) this tab deleted the note, the store still holds the live original;
       (b) SOMEBODY ELSE deleted it and THIS tab is the stale caller still
           holding the live copy - here the tombstone arrives as `src`, so a
           rev() that ignored delAt would tie on `at` and the incoming live
           copy would win by argument order alone. (a) passes by accident in
           that case; only (b) actually measures the rule. */
  const tomb = { v: 1, id: 'tn_1', at: 100, del: true, delAt: 900, author: 'Dr A', text: 'from A', ai: false };
  const deleter = { id: 'p1', teamNotes: [tomb, stored[1]] };
  carry.carry(deleter, { id: 'p1', teamNotes: stored });
  eq(deleter.teamNotes.filter((x) => x.id === 'tn_1')[0].del, true,
    shell + ': THE CARRY RESURRECTED A DELETED NOTE - a tombstone must beat the stored original');

  const staleHolder = { id: 'p1', teamNotes: [stored[0]] };
  carry.carry(staleHolder, { id: 'p1', teamNotes: [tomb, stored[1]] });
  eq(staleHolder.teamNotes.filter((x) => x.id === 'tn_1')[0].del, true,
    shell + ': A STALE TAB RESURRECTED SOMEONE ELSE\'S DELETION - the tombstone must win on its revision stamp, not on which side of the union it arrived from');
  eq(carry.rev(tomb), 900, shell + ': the revision stamp must count delAt, or a tombstone ties with its own original');
  ok(carry.rev(tomb) > carry.rev(stored[0]),
    shell + ': a tombstone must outrank the note it deletes');

  /* the newer note wins whichever side it arrives on */
  const fresh = { v: 1, id: 'tn_3', at: 300, author: 'Dr C', text: 'from C', ai: false };
  const writer = { id: 'p1', teamNotes: [fresh] };
  carry.carry(writer, { id: 'p1', teamNotes: stored });
  eq(writer.teamNotes.length, 3, shell + ': a new note plus the stored thread must be three notes');

  /* an empty/absent stored side must never blank a caller's notes */
  const only = { id: 'p1', teamNotes: [fresh] };
  carry.carry(only, { id: 'p1' });
  eq(only.teamNotes.length, 1, shell + ': an absent stored thread must not blank the incoming one');
  carry.carry(only, { id: 'p1', teamNotes: [] });
  eq(only.teamNotes.length, 1, shell + ': an empty stored thread must not blank the incoming one');

  /* the module's mirror and the shell's canonical copy must agree */
  const sb = makeSandbox({ patients: PT() });
  deep(sb.api().union([stored[0]], [stored[1]]).map((x) => x.id),
    carry.union([stored[0]], [stored[1]]).map((x) => x.id),
    shell + ': the module fallback union and the shell union disagree - two rules for one invariant');

  /* JSON round trip: POST/GET /api/patients store this as an opaque blob */
  deep(JSON.parse(JSON.stringify(stored)), stored, shell + ': a team note must survive the server round trip with no loss');
}

/* =====================================================================
   4. THE CARRY IS WIRED AT THE RIGHT POINT INSIDE upsertPatient
   ===================================================================== */
for (const shell of SHELLS) {
  const file = path.join(root, shell);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const up = lift(html, 'upsertPatient');

  ok(up.indexOf('__mlsTeamNotesCarry(p,__prev);') > 0,
    shell + ': upsertPatient never calls the team-notes carry - every stale write-back would drop notes');

  const iCarry = up.indexOf('__mlsTeamNotesCarry(p,__prev);');
  const iReplace = up.indexOf('arr[i]=p;');
  const iPrev = up.indexOf('const __prev=arr[i];');
  ok(iPrev >= 0 && iPrev < iCarry, shell + ': the carry must run after __prev is captured');
  ok(iCarry < iReplace, shell + ': THE CARRY MUST RUN BEFORE arr[i]=p - after the replacement there is no previous record left to carry from');

  /* it must sit in the same guarded block as the providerLink carry, which is
     the block that only runs when a previous record actually exists */
  const iPlv = up.indexOf('if(__prev.providerLink&&p.providerLink==null)');
  ok(iPlv > 0 && iCarry > iPlv && (iCarry - iPlv) < 700,
    shell + ': the team-notes carry must sit beside the providerLink carry inside the same __prev guard');
}

/* =====================================================================
   5. MERGE SURVIVAL - the real auto-merge, run on two duplicate charts
   ===================================================================== */
function mergeSandbox(pts) {
  const timers = [];
  const store = {};
  const saves = [];
  let patients = JSON.parse(JSON.stringify(pts));
  const context = {
    console, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].fn = null; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; }
    }
  };
  context.window = context;
  context.window.addEventListener = function () {};
  context.window.removeEventListener = function () {};
  context.getPatients = function () { return patients.slice(); };
  context.savePatients = function (arr) { saves.push(arr); patients = arr; return undefined; };
  vm.createContext(context);
  vm.runInContext(mergeSrc, context);
  return { context, timers, saves, patients: () => patients };
}

{
  /* Same human, same MRN, two charts - each with its own team thread. */
  const winnerNotes = [{ v: 1, id: 'tn_w', at: 500, author: 'Dr A', text: 'winner thread', ai: false }];
  const loserNotes = [
    { v: 1, id: 'tn_l1', at: 400, author: 'Dr B', text: 'loser thread', ai: false },
    { v: 1, id: 'tn_l2', at: 300, author: 'Dr C', text: 'loser thread 2', ai: true }
  ];
  const sb = mergeSandbox([
    { id: 'mr1', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', visits: [{ date: '2026-08-17' }], teamNotes: winnerNotes },
    { id: 'x2', name: 'Adam Schaeffer', dob: '1980-02-11', mrn: '7833832', visits: [], teamNotes: loserNotes }
  ]);
  const out = sb.context.window.__mlsPatientMerge.run({ silent: true });
  eq(out.merged, 1, 'the exact-MRN duplicate pair must merge');
  const survivors = sb.patients();
  eq(survivors.length, 1, 'one chart must survive');
  const kept = survivors[0].teamNotes;
  eq(kept.length, 3, 'THE MERGE DROPPED A TEAM NOTE - both threads are about the same human and both must survive');
  deep(kept.map((x) => x.id), ['tn_w', 'tn_l1', 'tn_l2'], 'the merged thread must be newest-first across both charts');
  eq(out.movedNotes, 2, 'the merge must report how many notes it carried across');
  eq(kept.filter((x) => x.ai === true).length, 1, 'an AI note must stay flagged through a merge');

  /* THE SCALAR FILL WOULD HAVE SILENTLY DISCARDED IT. This is the property the
     union exists for: FILL_FIELDS only writes into an EMPTY slot, so a winner
     that already had one note keeps only its own. */
  ok(mergeSrc.indexOf("'summary', 'meds'") > 0, 'FILL_FIELDS must still be the scalar list this test is contrasting with');
  ok(mergeSrc.indexOf('FILL_FIELDS') > 0 && !/FILL_FIELDS\s*=\s*\[[^\]]*teamNotes/.test(mergeSrc),
    'teamNotes must NOT be in FILL_FIELDS - a scalar fill would discard the loser\'s whole thread');
}
{
  /* a deletion made before the merge must stay deleted after it */
  const sb = mergeSandbox([
    { id: 'mr1', name: 'A B', dob: '1980-02-11', mrn: '7833832', visits: [{ date: '2026-08-17' }],
      teamNotes: [{ v: 1, id: 'tn_s', at: 100, del: true, delAt: 900, author: 'X', text: 'gone', ai: false }] },
    { id: 'x2', name: 'A B', dob: '1980-02-11', mrn: '7833832', visits: [],
      teamNotes: [{ v: 1, id: 'tn_s', at: 100, author: 'X', text: 'gone', ai: false }] }
  ]);
  sb.context.window.__mlsPatientMerge.run({ silent: true });
  const kept = sb.patients()[0].teamNotes;
  eq(kept.length, 1, 'the same note on both charts must not double');
  eq(kept[0].del, true, 'A MERGE RESURRECTED A DELETED NOTE - the tombstone must win');
}
{
  /* a winner with no thread at all must adopt the loser's */
  const sb = mergeSandbox([
    { id: 'mr1', name: 'A B', dob: '1980-02-11', mrn: '7833832', visits: [{ date: '2026-08-17' }] },
    { id: 'x2', name: 'A B', dob: '1980-02-11', mrn: '7833832', visits: [],
      teamNotes: [{ v: 1, id: 'tn_l', at: 100, author: 'X', text: 'kept', ai: false }] }
  ]);
  sb.context.window.__mlsPatientMerge.run({ silent: true });
  eq(sb.patients()[0].teamNotes.length, 1, 'a winner with no thread must adopt the loser\'s');
}
{
  /* and a merge of two note-free charts must not invent the field */
  const sb = mergeSandbox([
    { id: 'mr1', name: 'A B', dob: '1980-02-11', mrn: '7833832', visits: [{ date: '2026-08-17' }] },
    { id: 'x2', name: 'A B', dob: '1980-02-11', mrn: '7833832', visits: [] }
  ]);
  const out = sb.context.window.__mlsPatientMerge.run({ silent: true });
  eq(out.movedNotes, 0, 'a merge with no notes must report none moved');
  eq(sb.patients()[0].teamNotes, undefined, 'a merge must not mint an empty teamNotes array on a chart that never had one');
}

/* =====================================================================
   6. THE SURFACE - collapsed by default, count badge, one add box
   ===================================================================== */
{
  const sb = makeSandbox({ patients: PT() });
  const p = sb.pt();
  /* deliberately distinctive text: "one"/"two" would match inside ordinary
     markup ("background:none"), and a substring assertion that passes by
     accident proves nothing */
  p.teamNotes = [
    { v: 1, id: 'tn_1', at: 1000, author: 'Dr A', text: 'ZZALPHA', ai: false },
    { v: 1, id: 'tn_2', at: 2000, author: 'Dr B', text: 'ZZBETA', ai: false },
    { v: 1, id: 'tn_3', at: 3000, author: 'Dr C', text: 'ZZGAMMA', ai: false },
    { v: 1, id: 'tn_x', at: 500, del: true, delAt: 4000, author: 'Dr D', text: 'ZZDELETED', ai: false }
  ];
  eq(sb.context.__mlsTeamNotesRender(p), true, 'the render hook must report that it painted');
  const html = sb.box()._html;

  eq(sb.box().style.display, '', 'the box must be unhidden once it renders');
  ok(html.indexOf('Team notes') > 0, 'the section must be labelled Team notes');
  ok(/>3</.test(html), 'THE COUNT BADGE MUST SHOW 3 - the live notes only, not the tombstone');
  ok(html.indexOf('aria-expanded="false"') > 0, 'THE SECTION MUST BE COLLAPSED BY DEFAULT');
  eq(html.indexOf('mlsTnNew'), -1, 'a collapsed section must not render the add box - collapsed means collapsed');
  eq(html.indexOf('mls-tn-note'), -1, 'a collapsed section must not render any note rows');
  eq(html.indexOf('data-tn-id'), -1, 'a collapsed section must not render per-note controls');
  ok(html.indexOf('ZZALPHA') < 0 && html.indexOf('ZZGAMMA') < 0, 'a collapsed section must not render the note text');

  /* expand */
  sb.click({ 'data-tn-act': 'toggle' });
  const open = sb.box()._html;
  ok(open.indexOf('aria-expanded="true"') > 0, 'the toggle must expand the section');
  ok(open.indexOf('id="mlsTnNew"') > 0, 'the expanded section must offer ONE obvious add box');
  ok(open.indexOf('Enter saves') > 0, 'the add box must say Enter saves');
  ok(open.indexOf('ZZALPHA') > 0 && open.indexOf('ZZGAMMA') > 0, 'the expanded section must show the thread');
  ok(open.indexOf('ZZDELETED') < 0, 'a tombstoned note must never render');
  ok(open.indexOf('data-tn-act="ai"') > 0, 'the expanded section must offer the one-click summary');
  /* the button must not make a privacy claim that is false the moment it is
     used - pressing it sends the chart to the backend, and the tooltip has to
     say so rather than reassure */
  ok(open.indexOf('nothing is sent anywhere') < 0,
    'the AI button must not claim nothing is sent - pressing it sends the chart to the backend');
  ok(/sends the chart/.test(open), 'the AI button must say the chart is sent');
  ok(/nothing is generated or sent until you do/.test(open), 'the AI button must say it does nothing unasked');
  ok(open.indexOf('Recent visits') > 0, 'the expanded section must show the visit list');

  /* collapse again */
  sb.click({ 'data-tn-act': 'toggle' });
  ok(sb.box()._html.indexOf('aria-expanded="false"') > 0, 'the toggle must collapse again');

  /* a half-typed note must survive a collapse - losing what a doctor typed
     because they folded the section is the cheapest possible way to make a
     "shared notes" surface untrustworthy */
  const sbD = makeSandbox({ patients: PT() });
  sbD.context.__mlsTeamNotesRender(sbD.pt());
  sbD.click({ 'data-tn-act': 'toggle' });
  sbD.input('mlsTnNew', 'half typed, not saved yet');
  sbD.input('mlsTnAuthor', 'Dr Half');
  sbD.click({ 'data-tn-act': 'toggle' });   /* collapse */
  eq(sbD.upserts.length, 0, 'collapsing must not save a half-typed note');
  sbD.click({ 'data-tn-act': 'toggle' });   /* expand */
  ok(sbD.box()._html.indexOf('half typed, not saved yet') > 0,
    'A HALF-TYPED NOTE WAS LOST TO A COLLAPSE - the draft must survive the repaint');
  ok(sbD.box()._html.indexOf('value="Dr Half"') > 0, 'the half-typed author must survive too');

  /* a zero-note patient still renders, and says so honestly */
  const sb2 = makeSandbox({ patients: PT() });
  sb2.context.__mlsTeamNotesRender(sb2.pt());
  ok(sb2.box()._html.indexOf('none yet') > 0, 'a patient with no notes must say so rather than show a bare 0');
  eq(sb2.box().style.display, '', 'the section must still be reachable on a patient with no notes');

  /* no patient = no box at all */
  const sb3 = makeSandbox({ patients: PT() });
  eq(sb3.context.__mlsTeamNotesRender(null), false, 'no patient must paint nothing');
  eq(sb3.box().style.display, 'none', 'with no patient the box must be hidden, not empty-but-present');

  /* switching charts must re-collapse rather than carry the last one open */
  const sb4 = makeSandbox({ patients: PT() });
  sb4.context.__mlsTeamNotesRender(sb4.pt());
  sb4.click({ 'data-tn-act': 'toggle' });
  ok(sb4.box()._html.indexOf('aria-expanded="true"') > 0, 'sanity: it is open');
  sb4.context.__mlsTeamNotesRender({ id: 'p2', name: 'Other Person' });
  ok(sb4.box()._html.indexOf('aria-expanded="false"') > 0,
    'OPENING ONE CHART MUST NOT OPEN THE NEXT ONE - the section is collapsed by default per patient');
}

/* =====================================================================
   7. THE ROUND TRIP - add / edit / delete / undo actually persist
   ===================================================================== */
{
  const sb = makeSandbox({ patients: PT() });
  sb.context.__mlsTeamNotesRender(sb.pt());
  sb.click({ 'data-tn-act': 'toggle' });

  sb.input('mlsTnNew', 'Please recheck his BP next visit.');
  sb.input('mlsTnAuthor', 'Dana Reyes, PA-C');
  sb.click({ 'data-tn-act': 'add' });

  eq(sb.upserts.length, 1, 'adding a note must write through upsertPatient - savePatients would never reach the server, and an unshared note is not a shared note');
  const saved = sb.upserts[0];
  eq(saved.teamNotes.length, 1, 'the note must be in the written record');
  eq(saved.teamNotes[0].text, 'Please recheck his BP next visit.', 'the typed text must be what is stored');
  eq(saved.teamNotes[0].author, 'Dana Reyes, PA-C', 'the typed author must be what is stored');
  eq(saved.teamNotes[0].ai, false, 'a typed note must be ai:false');
  eq(sb.store['mls_team_note_author_v1'], 'Dana Reyes, PA-C', 'the last-used author must be remembered for next time');
  ok(sb.toasts.some((t) => t.kind === 'ok'), 'a successful add must be confirmed to the doctor');
  ok(sb.pt().teamNotes.length === 1, 'the store must now hold the note');

  /* the record written is a COPY, not the live row */
  ok(sb.upserts[0] !== sb.pt(), 'the write must be a copy - the store delta is a reference comparison');
  /* and every other field survives the copy */
  eq(saved.name, 'Adam Schaeffer', 'the copy must keep the rest of the chart');
  eq(saved.mrn, '7833832', 'the copy must keep the MRN');
  ok(saved.providerLink && saved.providerLink.v === 1, 'the copy must keep providerLink - a notes write must not drop another feature\'s field');

  /* the author is prefilled next time */
  const sb2 = makeSandbox({ patients: PT() });
  sb2.store['mls_team_note_author_v1'] = 'Dana Reyes, PA-C';
  sb2.context.__mlsTeamNotesRender(sb2.pt());
  sb2.click({ 'data-tn-act': 'toggle' });
  ok(sb2.box()._html.indexOf('value="Dana Reyes, PA-C"') > 0, 'the remembered author must be prefilled');
  ok(sb2.box()._html.indexOf('Matthew Schaeffer, MD') > 0, 'the roster\'s provider names must be offered as suggestions');

  /* Enter saves */
  const sb3 = makeSandbox({ patients: PT() });
  sb3.context.__mlsTeamNotesRender(sb3.pt());
  sb3.click({ 'data-tn-act': 'toggle' });
  sb3.input('mlsTnNew', 'Typed then Enter.');
  sb3.input('mlsTnAuthor', 'Dr A');
  sb3.key('mlsTnNew', 'Enter', false);
  eq(sb3.upserts.length, 1, 'ENTER MUST SAVE - the owner asked for easy');
  eq(sb3.upserts[0].teamNotes[0].text, 'Typed then Enter.', 'Enter must save what was typed');

  /* Shift+Enter must NOT save */
  const sb4 = makeSandbox({ patients: PT() });
  sb4.context.__mlsTeamNotesRender(sb4.pt());
  sb4.click({ 'data-tn-act': 'toggle' });
  sb4.input('mlsTnNew', 'Line one');
  sb4.key('mlsTnNew', 'Enter', true);
  eq(sb4.upserts.length, 0, 'Shift+Enter must add a line, not save');

  /* delete -> undo */
  const sb5 = makeSandbox({ patients: PT() });
  sb5.pt().teamNotes = [{ v: 1, id: 'tn_1', at: 1000, author: 'Dr A', text: 'one', ai: false }];
  sb5.context.__mlsTeamNotesRender(sb5.pt());
  sb5.click({ 'data-tn-act': 'toggle' });
  sb5.click({ 'data-tn-act': 'del', 'data-tn-id': 'tn_1' });
  eq(sb5.pt().teamNotes.length, 1, 'a delete must leave the tombstone in place, not splice');
  eq(sb5.pt().teamNotes[0].del, true, 'the stored note must be tombstoned');
  eq(sb5.api().forPatient('p1').length, 0, 'a deleted note must not be readable as live');
  ok(sb5.box()._html.indexOf('data-tn-act="undo"') > 0, 'a delete must offer undo');
  sb5.click({ 'data-tn-act': 'undo' });
  eq(sb5.api().forPatient('p1').length, 1, 'UNDO MUST BRING THE NOTE BACK');
  ok(sb5.box()._html.indexOf('data-tn-act="undo"') < 0, 'undo must not stay offered once it has been used');

  /* edit round trip */
  const sb6 = makeSandbox({ patients: PT() });
  sb6.pt().teamNotes = [{ v: 1, id: 'tn_1', at: 1000, author: 'Dr A', text: 'one', ai: false }];
  sb6.context.__mlsTeamNotesRender(sb6.pt());
  sb6.click({ 'data-tn-act': 'toggle' });
  sb6.click({ 'data-tn-act': 'edit', 'data-tn-id': 'tn_1' });
  ok(sb6.box()._html.indexOf('mlsTnEditText') > 0, 'editing must open an editor on that note');
  sb6.input('mlsTnEditText', 'one, corrected');
  sb6.click({ 'data-tn-act': 'editsave', 'data-tn-id': 'tn_1' });
  eq(sb6.pt().teamNotes[0].text, 'one, corrected', 'the edit must persist');
  ok(sb6.pt().teamNotes[0].ed > 0, 'the edit must be stamped');

  /* Enter saves in the editor too, resolved from the module's own editingId */
  const sb6b = makeSandbox({ patients: PT() });
  sb6b.pt().teamNotes = [{ v: 1, id: 'tn_1', at: 1000, author: 'Dr A', text: 'one', ai: false }];
  sb6b.context.__mlsTeamNotesRender(sb6b.pt());
  sb6b.click({ 'data-tn-act': 'toggle' });
  sb6b.click({ 'data-tn-act': 'edit', 'data-tn-id': 'tn_1' });
  sb6b.input('mlsTnEditText', 'corrected by Enter');
  sb6b.key('mlsTnEditText', 'Enter', false);
  eq(sb6b.pt().teamNotes[0].text, 'corrected by Enter', 'ENTER MUST SAVE AN EDIT - and the note id must come from editingId, not from re-reading the markup');
  ok(sb6b.box()._html.indexOf('mlsTnEditText') < 0, 'saving must close the editor');

  /* Cancel must abandon the edit, not save it */
  const sb6c = makeSandbox({ patients: PT() });
  sb6c.pt().teamNotes = [{ v: 1, id: 'tn_1', at: 1000, author: 'Dr A', text: 'original', ai: false }];
  sb6c.context.__mlsTeamNotesRender(sb6c.pt());
  sb6c.click({ 'data-tn-act': 'toggle' });
  sb6c.click({ 'data-tn-act': 'edit', 'data-tn-id': 'tn_1' });
  sb6c.input('mlsTnEditText', 'typed but abandoned');
  sb6c.click({ 'data-tn-act': 'editcancel' });
  eq(sb6c.pt().teamNotes[0].text, 'original', 'Cancel must abandon the edit');
  eq(sb6c.upserts.length, 0, 'Cancel must write nothing');

  /* a failed write must not claim success */
  const sb7 = makeSandbox({ patients: PT(), upsertThrows: true });
  sb7.context.__mlsTeamNotesRender(sb7.pt());
  sb7.click({ 'data-tn-act': 'toggle' });
  sb7.input('mlsTnNew', 'This will fail to save.');
  sb7.click({ 'data-tn-act': 'add' });
  ok(sb7.toasts.some((t) => t.kind === 'err'), 'A FAILED SAVE MUST SAY SO - a note that silently vanished is the worst outcome here');
  ok(!sb7.toasts.some((t) => t.kind === 'ok'), 'a failed save must not also report success');
}

/* =====================================================================
   8. XSS - through the shell's OWN esc(), on every field a user controls
   ===================================================================== */
{
  const sb = makeSandbox({ patients: PT() });
  const nasty = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const nastyAuthor = '"><script>alert(3)</script>';
  sb.pt().teamNotes = [{ v: 1, id: 'tn_1', at: 1000, author: nastyAuthor, text: nasty, ai: false }];
  sb.pt().name = '<b>Bad Name</b>';
  sb.context.__mlsTeamNotesRender(sb.pt());
  sb.click({ 'data-tn-act': 'toggle' });
  const html = sb.box()._html;

  ok(html.indexOf('<img') < 0, 'NOTE TEXT RENDERED AS MARKUP - an img tag survived escaping');
  ok(html.indexOf('<script') < 0, 'NOTE TEXT RENDERED AS MARKUP - a script tag survived escaping');
  /* The payload must survive only as INERT TEXT. "onerror=" is still present as
     characters - that is fine and unavoidable - so the property to measure is
     that no rendered TAG carries a handler, and that the payload sits behind an
     escaped angle bracket. Asserting the substring is absent would have been a
     test that fails on correct code. */
  const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
  ok(tags.length > 0, 'sanity: the section did render tags');
  ok(!tags.some((t) => /\son[a-z]+\s*=/i.test(t)),
    'A RENDERED TAG CARRIES AN INLINE EVENT HANDLER - this module wires by delegated listener and must emit none');
  ok(html.indexOf('&lt;img src=x onerror=') > 0, 'the whole payload must sit behind an escaped angle bracket, as inert text');
  ok(html.indexOf('&lt;img') > 0, 'the note text must appear escaped, so this test is measuring the right string');
  ok(html.indexOf('&lt;script') > 0, 'the author must appear escaped');
  /* the author lands in a text node AND the note id lands in an attribute -
     the shell's esc does not escape a single quote, so every attribute this
     module writes must be double-quoted */
  ok(/data-tn-id="[^"]*"/.test(html), 'note ids must live in double-quoted attributes - esc() does not escape a single quote');
  eq(realEsc(nastyAuthor).indexOf('"'), -1, 'sanity: the shell escaper does neutralize a double quote');

  /* a note id that arrived from the server carrying a quote cannot break out */
  const sb2 = makeSandbox({ patients: PT() });
  sb2.pt().teamNotes = [{ v: 1, id: 'tn_"><b>x</b>', at: 1000, author: 'A', text: 'hi', ai: false }];
  sb2.context.__mlsTeamNotesRender(sb2.pt());
  sb2.click({ 'data-tn-act': 'toggle' });
  ok(sb2.box()._html.indexOf('<b>x</b>') < 0, 'A HOSTILE NOTE ID BROKE OUT OF ITS ATTRIBUTE - the server blob is not trusted input');

  /* control characters are stripped on the way in, so a stored note stays readable */
  const sb3 = makeSandbox({ patients: PT() });
  const withNul = 'before' + String.fromCharCode(0) + String.fromCharCode(7) + 'after';
  const res = sb3.api().addNote([], { text: withNul, author: 'A', now: 1 });
  eq(res.list[0].text.indexOf(String.fromCharCode(0)), -1, 'control characters must be stripped from stored note text');
  ok(res.list[0].text.indexOf('before') === 0 && res.list[0].text.indexOf('after') > 0, 'stripping must not eat the real text');

  /* and the length caps hold */
  const long = sb3.api().addNote([], { text: 'x'.repeat(9000), author: 'y'.repeat(500), now: 1 });
  eq(long.list[0].text.length, sb3.api().TEXT_MAX, 'note text must be capped');
  eq(long.list[0].author.length, 80, 'the author must be capped');
}

/* =====================================================================
   9. THE VISIT LIST - derived, read-only, and it never guesses a provider
   ===================================================================== */
{
  const sb = makeSandbox({ patients: PT() });
  const api = sb.api();
  const p = sb.pt();
  const got = api.recentVisits(p, 6);

  eq(got.total, 3, 'every dated visit must be listed');
  deep(got.rows.map((r) => r.date), ['2026-08-17', '2026-08-03', '2026-07-20'], 'visits must read newest first');

  /* the attributed days get their provider; the unattributed one gets NOTHING */
  eq(got.rows[0].provider, 'Matthew Schaeffer, MD', 'a day providerLink attributed must name that provider');
  eq(got.rows[1].provider, 'Dana Reyes, PA-C', 'the head doctor must see the OTHER provider\'s visit too - that is the whole point');
  eq(got.rows[2].provider, 'Matthew Schaeffer, MD', 'the older attributed day must resolve too');

  const p2 = JSON.parse(JSON.stringify(p));
  p2.visits.push({ date: '2026-09-01', type: 'Unattributed' });
  eq(api.recentVisits(p2, 6).rows[0].provider, '',
    'AN UNATTRIBUTED DAY MUST STAY EMPTY - falling back to the primary provider would relabel another clinician\'s visit');
  eq(api.providerForDay(p, '2999-01-01'), '', 'an unknown day must resolve to nothing, never a guess');
  eq(api.providerForDay({ }, '2026-08-17'), '', 'a patient with no providerLink must resolve to nothing');

  /* the has-note indicator */
  eq(got.rows[0].documented, true, 'a visit with a stored body must read as documented');
  eq(got.rows[1].documented, false, 'an index-only visit must read as NOT documented');

  /* team notes tagged to a visit day are counted on that row */
  const p3 = JSON.parse(JSON.stringify(p));
  p3.teamNotes = [{ v: 1, id: 'tn_1', at: 1, author: 'A', text: 'about that day', ai: true, visit: '2026-08-17' }];
  const g3 = api.recentVisits(p3, 6);
  eq(g3.rows[0].teamNotes, 1, 'a note tagged to a visit day must be counted on that row');
  eq(g3.rows[1].teamNotes, 0, 'and not on the others');

  /* undated rows are skipped rather than rendered as a blank line */
  const p4 = JSON.parse(JSON.stringify(p));
  p4.visits.push({ type: 'No date at all' });
  eq(api.recentVisits(p4, 6).total, 3, 'an undated visit row must be skipped, not shown as an empty date');

  /* the list is capped and says so */
  const p5 = JSON.parse(JSON.stringify(p));
  p5.visits = [];
  for (let i = 1; i <= 10; i++) p5.visits.push({ date: '2026-08-' + ('0' + i).slice(-2), raw: 'body' });
  const g5 = api.recentVisits(p5, 6);
  eq(g5.total, 10, 'the total must be the real total');
  eq(g5.rows.length, 6, 'the rendered list must be capped');
  /* the capped notice, rendered - p5 has to BE the active patient, because the
     toggle repaints from activePatient() and not from whatever object was
     last passed in */
  const sbCap = makeSandbox({ patients: [p5] });
  sbCap.context.__mlsTeamNotesRender(sbCap.pt());
  sbCap.click({ 'data-tn-act': 'toggle' });
  ok(sbCap.box()._html.indexOf('most recent of 10') > 0, 'a capped list must say what it is hiding');

  /* READ-ONLY: rendering the visit list must never write */
  eq(sb.upserts.length, 0, 'THE VISIT LIST MUST BE READ-ONLY - rendering it wrote to the patient store');
  /* and it must not mutate the visits array it was handed */
  const before = JSON.stringify(p.visits);
  api.recentVisits(p, 6);
  eq(JSON.stringify(p.visits), before, 'deriving the visit list must not reorder or mutate p.visits');
}

/* =====================================================================
   10. THE AI - never unasked, honest when it cannot run, tagged when it does
   ===================================================================== */

/* NOT-ASKED is proven synchronously, before any await, so a broken async tail
   cannot be mistaken for a pass. */
{
  ok(!/setTimeout|setInterval|requestIdleCallback/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'THE MODULE MUST ARM NO TIMERS AT ALL - a timer is how an unasked generation happens');
  ok(!/addEventListener\(\s*['"](?:load|DOMContentLoaded|mls:)/.test(src),
    'the module must not hook boot or app events - it runs when a chart is opened and not before');

  const sb = makeSandbox({ patients: PT() });
  eq(sb.aiCalls.length, 0, 'loading the module must not call the AI');
  eq(sb.timers.length, 0, 'loading the module must arm no timers');
  sb.context.__mlsTeamNotesRender(sb.pt());
  eq(sb.aiCalls.length, 0, 'RENDERING must not call the AI');
  sb.click({ 'data-tn-act': 'toggle' });
  eq(sb.aiCalls.length, 0, 'EXPANDING the section must not call the AI');
  sb.input('mlsTnNew', 'a typed note');
  sb.click({ 'data-tn-act': 'add' });
  eq(sb.aiCalls.length, 0, 'adding a human note must not call the AI');
  eq(sb.upserts[0].teamNotes.filter((n) => n.ai === true).length, 0, 'nothing may be minted ai:true without a click');
}

/* the refusal, also synchronous - it must happen BEFORE the network */
{
  const sb = makeSandbox({ patients: PT(), token: '' });
  eq(sb.api().signedIn(), false, 'no token must read as not signed in - backendMode alone is not a session');
  sb.context.__mlsTeamNotesRender(sb.pt());
  sb.click({ 'data-tn-act': 'toggle' });
  sb.click({ 'data-tn-act': 'ai' });
  eq(sb.aiCalls.length, 0, 'AN UNAUTHENTICATED GENERATE MUST NOT TOUCH THE NETWORK');
  const err = sb.toasts.filter((t) => t.kind === 'err');
  ok(err.length === 1, 'the refusal must be painted exactly once');
  ok(/[Ss]ign in/.test(err[0].msg), 'the refusal must say the reason - that a session is needed');
  eq(sb.upserts.length, 0, 'a refused generation must write nothing');

  const sb2 = makeSandbox({ patients: PT(), backend: false });
  eq(sb2.api().signedIn(), false, 'no backend must read as not signed in');
}
{ /* a thin chart is refused rather than sent */
  const sb = makeSandbox({ patients: [{ id: 'p1', name: 'Nobody Yet' }] });
  sb.context.__mlsTeamNotesRender(sb.pt());
  sb.click({ 'data-tn-act': 'toggle' });
  sb.click({ 'data-tn-act': 'ai' });
  eq(sb.aiCalls.length, 0, 'a chart with nothing in it must not be sent to the model');
  ok(sb.toasts.some((t) => t.kind === 'err'), 'and the doctor must be told why');
}

/* the prompt input must be built from THIS record only */
{
  const sb = makeSandbox({ patients: PT() });
  const source = sb.api().chartSource(sb.pt());
  ok(source.indexOf('Adam Schaeffer') >= 0, 'the prompt must name the patient it is about');
  ok(source.indexOf('Hypertension') > 0, 'the prompt must carry the problem list');
  ok(source.indexOf('Metformin') > 0, 'the prompt must carry the medications');
  ok(source.indexOf('BP 128/78') > 0, 'the prompt must carry the most recent encounter body');
  ok(source.length <= 12000, 'the prompt must be bounded - the transport REFUSES an oversized prompt, it does not truncate');
  /* the shorter call was available and is deliberately not used; the module
     must SAY so in prose and must never actually reach for it in code */
  ok(src.indexOf('buildPatientContext') > 0,
    'the module must state, in prose, why it does not reuse buildPatientContext');
  ok(!/getContext|buildPatientContext/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')),
    'the prompt must NOT be built from buildPatientContext/getContext in CODE - those fold in the visit editor\'s textarea, which belongs to whatever visit is open, and reading ambient editor state into one patient\'s summary is the cross-patient contamination class');
  ok(!/after-visit summary|visit note|CLINICAL TIMELINE|SOAP/i.test(sb.api().AI_SYS),
    'the system prompt must avoid the DOC_WANTED trigger words, or an unrelated practice-code block is appended to it');
  ok(/ONLY facts present in the record/i.test(sb.api().AI_SYS), 'the system prompt must forbid inventing facts');
}

/* the transport is the app's own, with no new endpoint */
{
  ok(/window\.aiCallRaw\(/.test(src), 'the module must call the app\'s own aiCallRaw transport');
  ok(/freeform: true/.test(src), 'the call must be freeform - a non-freeform call routes to the SOAP generator and ignores the prompt entirely');
  ok(!/fetch\(|XMLHttpRequest|\/api\//.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'THE MODULE MUST NOT INVENT AN ENDPOINT - no fetch, no /api/ path of its own');
}

async function asyncProofs() {
  /* a clicked generation lands as an ai:true note with its review tag */
  {
    const sb = makeSandbox({ patients: PT(), aiText: 'Adam is a 46-year-old man followed for hypertension and type 2 diabetes.' });
    sb.context.__mlsTeamNotesRender(sb.pt());
    sb.click({ 'data-tn-act': 'toggle' });
    sb.click({ 'data-tn-act': 'ai' });
    eq(sb.aiCalls.length, 1, 'the click must reach the transport exactly once');
    eq(sb.aiCalls[0].opts.freeform, true, 'the call must be freeform');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    eq(sb.upserts.length, 1, 'the generated summary must be persisted');
    const note = sb.upserts[0].teamNotes[0];
    eq(note.ai, true, 'A GENERATED NOTE MUST BE STORED ai:true - that flag is the only thing that makes the tag honest');
    eq(note.text, 'Adam is a 46-year-old man followed for hypertension and type 2 diabetes.', 'the generated text must be stored');
    eq(note.visit, '2026-08-17', 'the summary must be tagged to the visit it is about');
    eq(note.author, 'MLS AI', 'a generated note must not be attributed to a human');

    /* the tag renders, and editing the text cannot remove it */
    const html = sb.box()._html;
    ok(html.indexOf('AI-generated') > 0, 'the AI tag must render on the note');
    const ed = sb.api().editNote(sb.pt().teamNotes, note.id, 'Edited by a human', 9e12);
    eq(ed.list.filter((x) => x.id === note.id)[0].ai, true,
      'EDITING AN AI NOTE MUST NOT CLEAR ITS ai FLAG - the tag is not removable by rewriting the text');
    ok(sb.toasts.some((t) => t.kind === 'ok' && /review/i.test(t.msg)), 'the doctor must be told to review it');
  }

  /* fence-wrapped output is unwrapped */
  {
    const sb = makeSandbox({ patients: PT(), aiText: '```\nPlain text inside a fence.\n```' });
    sb.context.__mlsTeamNotesRender(sb.pt());
    sb.click({ 'data-tn-act': 'toggle' });
    sb.click({ 'data-tn-act': 'ai' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    eq(sb.upserts[0].teamNotes[0].text, 'Plain text inside a fence.', 'a fenced reply must be unwrapped before it is stored');
  }

  /* an empty reply must not mint an empty note */
  {
    const sb = makeSandbox({ patients: PT(), aiText: '   ' });
    sb.context.__mlsTeamNotesRender(sb.pt());
    sb.click({ 'data-tn-act': 'toggle' });
    sb.click({ 'data-tn-act': 'ai' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    eq(sb.upserts.length, 0, 'an empty reply must add nothing');
    ok(sb.toasts.some((t) => t.kind === 'err'), 'and must say so');
  }

  /* a refused generation paints the app's own message and writes nothing */
  {
    const sb = makeSandbox({ patients: PT(), aiRejects: true });
    sb.context.__mlsTeamNotesRender(sb.pt());
    sb.click({ 'data-tn-act': 'toggle' });
    sb.click({ 'data-tn-act': 'ai' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    eq(sb.upserts.length, 0, 'a failed generation must write nothing');
    ok(sb.toasts.some((t) => t.kind === 'err' && /friendly:/.test(t.msg)),
      'a failed generation must paint the app\'s OWN error mapping, not a message invented here');
    /* the button must be usable again */
    eq(sb.api().status().busyAi, false, 'the busy lock must clear after a failure, or the button is dead until reload');
  }
  return true;
}

/* =====================================================================
   11. WIRING AND HOUSE SHAPE - every lane, byte-identical
   ===================================================================== */
{
  const BLOCKS = [
    '      if(__prev.providerLink&&p.providerLink==null)p.providerLink=__prev.providerLink;\n' +
    '      /* tn-1.0.0: and the team notes, by UNION - see __mlsTeamNotesCarry. The\n' +
    '         fill-only line above is right for a DERIVED field and wrong for\n' +
    '         human-authored text: a caller carrying an OLDER copy of teamNotes\n' +
    '         passes the ==null test and would silently drop a colleague\'s note. */\n' +
    '      __mlsTeamNotesCarry(p,__prev);',
    '      <div class="prof-box" style="margin-top:16px;display:none" id="pf2TeamNotes"></div>',
    "  try{ if(typeof window.__mlsTeamNotesRender==='function') window.__mlsTeamNotesRender(p); }catch(e){}"
  ];
  for (const shell of SHELLS) {
    const file = path.join(root, shell);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    BLOCKS.forEach((b, i) => {
      eq(html.split(b).length - 1, 1,
        shell + ': tn hook block #' + (i + 1) + ' must appear EXACTLY once - the four shells must be identical here');
    });
    /* the render hook must be inside renderProfile, not merely somewhere */
    const rp = lift(html, 'renderProfile');
    ok(rp.indexOf('__mlsTeamNotesRender') > 0, shell + ': the render hook must live inside renderProfile');
  }
}
{
  /* THE TWO HALVES THAT KEEP IT VISIBLE. Either one alone hides the section. */
  for (const c of CONNECTS) {
    const file = path.join(root, c);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');

    ok(text.indexOf(':not(#pf2TeamNotes){display:none!important;}') > 0,
      c + ': #pf2TeamNotes is not in the pf2-collapsed allowlist - the card ships COLLAPSED, so the whole section would be display:none in the state a doctor normally sees');
    ok(/if \(\/\^pf2\/\.test\(el\.id \|\| ''\)\) continue;/.test(text),
      c + ': the pf2 adopt loop no longer skips /^pf2/ ids - the box id relies on that escape hatch to avoid being buried in "Vitals & extras"');

    ok(text.indexOf('data-mls-asset="feat_mls_team_notes.js"') > 0, c + ': the loader has no duplicate-install guard');
    /* the guard READS the stamp the loader WRITES, so both spellings have to be
       the same file name - a stamp that drifts from the guard means the script
       is re-injected on every idle callback and nothing ever notices */
    ok(text.indexOf("s.setAttribute('data-mls-asset','feat_mls_team_notes.js');") > 0,
      c + ': the injected tag is not stamped with the asset name the duplicate-install guard queries for');
    ok(text.indexOf("s.src='feat_mls_team_notes.js?v='") > 0,
      c + ': the loader does not point at the module file');
    const at = text.indexOf('feat_mls_team_notes.js');
    ok(at > 0, c + ': the module is never loaded in this lane');
    const stanza = text.slice(Math.max(0, at - 400), at);
    ok(/__mlsDeferAsset\|\|window\.requestIdleCallback/.test(stanza),
      c + ': the team-notes module must load DEFERRED, past first paint');
  }
}
{ /* EVERY EDITED LANE MUST STILL PARSE. Three functions and two hook lines were
     spliced into the shell's 35k-line inline block, and that is exactly the
     edit that passes every grep in this file and still fails the parser - at
     which point the whole app stops booting and the report is "I can't log in",
     not "team notes are broken". Four shells and three bundles, compiled. */
  for (const shell of SHELLS) {
    const file = path.join(root, shell);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, n = 0;
    while ((m = re.exec(html))) {
      const attrs = m[1] || '';
      if (/\bsrc=/i.test(attrs)) continue;
      if (/type="(?!text\/javascript|module|application\/javascript)/i.test(attrs)) continue;
      n++;
      let boom = '';
      try { new vm.Script(m[2], { filename: shell + '#' + n }); } catch (e) { boom = String(e.message || e); }
      eq(boom, '', shell + ': inline script #' + n + ' does not parse - the app would not boot');
    }
    ok(n > 50, shell + ': only ' + n + ' inline scripts compiled - this gate is measuring the wrong document');
  }
  for (const c of CONNECTS) {
    const file = path.join(root, c);
    if (!fs.existsSync(file)) continue;
    let boom = '';
    try { new vm.Script(fs.readFileSync(file, 'utf8'), { filename: c }); } catch (e) { boom = String(e.message || e); }
    eq(boom, '', c + ': the bundle does not parse');
  }
  /* and the module itself, as the browser will actually take it */
  let modBoom = '';
  try { new vm.Script(src, { filename: MODULE }); } catch (e) { modBoom = String(e.message || e); }
  eq(modBoom, '', MODULE + ': the module does not parse');
}
{
  const inv = JSON.parse(read('pages-publication-inventory.json'));
  ok(inv.paths.indexOf('feat_mls_team_notes.js') >= 0,
    'the module is not in the publication inventory - it would 404 on the deployed site and the section would silently never appear');
}
{ /* ES5 house shape, and the ASCII rule this repo learned the hard way */
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/=>/.test(body), 'the module must stay ES5 (no arrow functions)');
  ok(!/\blet\b|\bconst\b/.test(body), 'the module must stay ES5 (var only)');
  ok(/window\.__mlsTeamNotes_revert/.test(src), 'the module must be revertible');
  ok(/var VERSION = 'tn-1\.0\.0'/.test(src), 'the release marker must be stated');
  for (let i = 0; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c > 126 || c < 9) { checks++; assert.fail('the module must be ASCII-only (glyphs are HTML entities) - found char code ' + c + ' at ' + i); }
  }
  checks++;
  /* the save must never be able to drop a chart */
  ok(!/allowRemovals/.test(body), 'the module must never mention allowRemovals in CODE - that flag exists to let a save DROP rows');
  ok(!/savePatients/.test(body), 'the module must write through upsertPatient only - savePatients does not reach the server, and a note that never leaves the device is not shared');
  /* it must not claim an identity the app cannot verify */
  ok(!/verified|authenticated/i.test(body), 'the module must not claim a verified author - the app authenticates one account, not a doctor');
}
{ /* the merge module keeps its own house shape after the tn change */
  const mbody = mergeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/=>/.test(mbody), 'the merge module must stay ES5 (no arrow functions)');
  ok(mergeSrc.indexOf("version: 'pm-1.0.5'") > 0, 'the merge release marker must move with the behaviour change');
}
{ /* the exported surface */
  const sb = makeSandbox({ patients: PT() });
  const api = sb.api();
  for (const fn of ['render', 'forPatient', 'status', 'addNote', 'editNote', 'removeNote', 'restoreNote', 'recentVisits', 'chartSource', 'signedIn']) {
    eq(typeof api[fn], 'function', 'window.__mlsTeamNotes.' + fn + ' must be exported');
  }
  eq(api.status().version, 'tn-1.0.0', 'status() must state the version');
  deep(api.forPatient('nobody'), [], 'forPatient must return an empty list for an unknown id, never a guess');

  /* revert leaves nothing behind */
  sb.context.__mlsTeamNotesRender(sb.pt());
  sb.context.window.__mlsTeamNotes_revert();
  eq(sb.box().style.display, 'none', 'revert must hide the box');
  eq(sb.box()._html, '', 'revert must empty the box');
  eq(typeof sb.context.window.__mlsTeamNotesRender, 'undefined', 'revert must remove the render hook');
}

/* The async tail is the last thing to run, and the summary line only prints if
   it actually completed - an async suite that exits 0 having run nothing is a
   documented failure mode of this harness. */
let asyncRan = false;
asyncProofs().then(function (done) {
  asyncRan = done === true;
  assert.ok(asyncRan, 'the async proofs did not run to completion');
  console.log('shared-notes: ' + checks + ' checks passed');
}, function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
