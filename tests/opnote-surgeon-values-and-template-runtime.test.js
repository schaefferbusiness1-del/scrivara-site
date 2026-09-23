'use strict';
/* =============================================================================
   WHAT THE SURGEON TYPES REACHES THE PRACTICE, AND THE TEMPLATE THAT TRAVELS
   IS THE ONE THAT WROTE THE NOTE  (lane opnsvc-1.0.0)

   Measured before this lane, with the real backend and the real pages:
     - A surgeon typed "22-gauge 3.5-inch" and "1" into the two blanks on
       /opnotes.html, pressed Save and Mark done. The service kept the values
       BESIDE the note; the practice's "Get the surgeon's finished notes"
       (opPrepCheckReturned) reads the note text only and said "the wording
       has not changed". Both values were gone.
     - Mark done sent only the version, so a value typed and not saved was lost.
     - A re-fit that added blanks left the fields and "Needs you: N" describing
       the note as it was before.
     - The owner drafted a note from one template, moved the row's Template
       dropdown, and pressed Send: the surgeon received the note beside the
       template the dropdown showed NOW, not the one that wrote it.

   This suite EXECUTES the real code - the page's own inline script, and the
   real functions lifted out of 1pScribeFlow.html - against a stubbed network
   that answers the way the fixed service answers. It proves:

     1. After Save the page shows the note WITH the values in it, asks only for
        what is still missing, lists what went in, and the list count moves.
     2. A value the service could not place is shown to the surgeon by name.
     3. Mark done carries the words and every value on screen.
     4. A value that cannot go in is refused in the service's own sentence.
     5. A re-fit saves unsaved typing FIRST, then repaints the fields and the
        count from the list the service sends for the re-fitted note.
     6. The practice's read-back puts values still beside an old note into it
        at the exact offsets the service sends (checked against the text),
        and shows anything it cannot place on the card - never silently.
     7. A draft records the template that wrote it, even if the dropdown moves
        while the draft is running; Send refuses a row whose dropdown moved or
        whose template's words were edited since, sends the drafted template
        otherwise, and the whole-day Send refuses before anything is made.
        A note with no record of its template goes WITHOUT one (never the
        dropdown's guess), and the dialog says so before Send.
     8. No developer word reaches the surgeon.
     9. (review round 2) The record survives a reopened day: the real
        autosave puts it on the History draft and the real resume
        (feat_mls_opnote_prep.js adoptExistingDraft) reads it back, so moving
        the dropdown on a resumed draft is refused by name and the drafted
        template is what travels; a draft autosaved before this has none and
        goes without a template. The surgeon's page names a value still not in
        the note when the note is opened again and on Mark done, and the
        practice's card drops a value once the service no longer lists it.

   No network, no patient data, no browser. Every fixture is synthetic.
   ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function deq(actual, expected, message) { assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected, message); checks++; }

/* ---------------------------------------------------------------------------
   PART A - the surgeon's page, its own inline script
   ------------------------------------------------------------------------- */
const PAGE = read('opnotes.html');
const inline = (function () {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, body = null;
  while ((m = re.exec(PAGE))) { if (!/\bsrc\s*=/.test(m[1])) { assert(body === null, 'one inline script'); body = m[2]; } }
  assert(body && body.trim(), 'opnotes.html inline script not found');
  return body;
})();

function makeDom() {
  const nodes = new Map();
  const painted = [];
  function node(id) {
    const n = { id, _className: '', _textContent: '', _innerHTML: '', value: '', disabled: false, files: null };
    Object.defineProperty(n, 'className', { get() { return n._className; }, set(v) { n._className = String(v); } });
    Object.defineProperty(n, 'textContent', { get() { return n._textContent; }, set(v) { n._textContent = String(v); painted.push(String(v)); } });
    Object.defineProperty(n, 'innerHTML', {
      get() { return n._innerHTML; },
      /* A repaint replaces the fields it contains, as a real browser does: an
         <input value="..."> or <textarea> in the new markup starts again from
         what the markup says. */
      set(v) {
        n._innerHTML = String(v); painted.push(String(v));
        const inputs = /<input id="([^"]+)" value="([^"]*)"/g; let m;
        while ((m = inputs.exec(n._innerHTML))) { const f = nodes.get(m[1]) || node(m[1]); f.value = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'); nodes.set(m[1], f); }
        const ta = /<textarea id="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g;
        while ((m = ta.exec(n._innerHTML))) { const f = nodes.get(m[1]) || node(m[1]); f.value = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'); nodes.set(m[1], f); }
      }
    });
    return n;
  }
  return {
    painted,
    el(id) { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); } }
  };
}

function bootPage(replies) {
  const dom = makeDom();
  const calls = [];
  const window = {
    __mlsSensitiveUrl: Object.freeze({ query: Object.freeze({}), fragment: Object.freeze({ k: 'a'.repeat(64) }) }),
    mammoth: null,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    mlsSensitiveFetch(url, init) {
      const key = String(url).replace('https://scrivara-backend.onrender.com', '') + ' ' + String((init || {}).method || 'GET');
      calls.push({ key, body: (init && init.body) ? JSON.parse(init.body) : null });
      const reply = Object.prototype.hasOwnProperty.call(replies, key) ? replies[key] : { status: 404, body: {} };
      const out = typeof reply === 'function' ? reply(init || {}) : reply;
      return Promise.resolve({ ok: out.status >= 200 && out.status < 300, status: out.status, json() { return Promise.resolve(out.body || {}); } });
    }
  };
  const ctx = { window, document: dom.document, console, JSON, Object, String, Number, Boolean, Math, RegExp, Error, Promise, Array, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(inline, ctx, { filename: 'opnotes.html#inline' });
  return { ctx, dom, calls };
}

const NOTE = 'DESCRIPTION: a [NEEDLE GAUGE] spinal needle was advanced. Dexamethasone 10 mg with ___ mL of 1% lidocaine was injected.\nCOMPLICATIONS: None';
const FILLED = NOTE.replace('[NEEDLE GAUGE]', '22-gauge 3.5-inch').replace('___ mL', '1 mL');
const JOB = {
  id: 'oj_zz1', title: 'ZZ Left L4-5 TFESI', status: 'draft', version: 1, noteText: NOTE, templateId: 'ot_full',
  blanks: [{ key: 'blank_line_1', label: 'Blank #1', value: '', state: 'open' }, { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '', state: 'open' }]
};
function pageReplies(extra) {
  return Object.assign({
    '/api/client/opnotes/session GET': { status: 200, body: { signedIn: true, client: { name: 'ZZ Dr Surgeon' } } },
    '/api/client/opnotes/templates GET': { status: 200, body: { templates: [{ id: 'ot_full', name: 'ZZ Lumbar TFESI' }, { id: 'ot_house', name: 'ZZ House TFESI' }] } },
    '/api/client/opnotes/jobs GET': { status: 200, body: { jobs: [{ id: 'oj_zz1', title: 'ZZ Left L4-5 TFESI', status: 'draft', blankCount: 2, filledCount: 0, updatedAt: 1 }] } },
    '/api/client/opnotes/jobs/oj_zz1 GET': { status: 200, body: { job: JSON.parse(JSON.stringify(JOB)) } }
  }, extra || {});
}
const settled = (over) => ({
  status: 200,
  body: { job: Object.assign({
    version: 2, updatedAt: 9, noteText: FILLED, blankCount: 2, filledCount: 2, notPlaced: [],
    blanks: [{ key: 'blank_line_1', label: 'Blank #1', value: '1', state: 'placed' }, { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '22-gauge 3.5-inch', state: 'placed' }]
  }, over || {}) }
});

/* ---------------------------------------------------------------------------
   PART B/C - the owner's app, the real functions lifted from the 1p shell
   ------------------------------------------------------------------------- */
const SHELL = read('1pScribeFlow.html');
function fn(src, decl) {
  const at = src.indexOf(decl);
  assert(at >= 0, 'missing declaration: ' + decl);
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error('unterminated: ' + decl);
}
function between(src, a, b) {
  const i = src.indexOf(a); assert(i >= 0, 'missing anchor: ' + a);
  const j = src.indexOf(b, i); assert(j > i, 'missing end anchor: ' + b);
  return src.slice(i, j);
}
const BLOCK = between(SHELL, '/* ===== opnote-svc-1.0.0 - PREPARE THIS OP NOTE FOR A CLIENT SURGEON', 'function opPrepSave(i){');

function owner(opts) {
  const calls = [];
  const lazy = new Map();
  const body = { children: [], appendChild(n) { n.parentNode = body; body.children.push(n); return n; }, removeChild(n) { body.children.splice(body.children.indexOf(n), 1); n.parentNode = null; return n; } };
  const mk = (tag) => ({ tag, id: '', innerHTML: '', value: '', textContent: '', style: { cssText: '', display: '' }, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } });
  const document = {
    body,
    createElement: mk,
    getElementById(id) { for (const c of body.children) if (c.id === id) return c; if (!lazy.has(id)) lazy.set(id, mk('stub')); return lazy.get(id); }
  };
  const storage = new Map();
  const toasts = [];
  const templates = opts.templates || [];
  const ctx = {
    document, console, JSON, Object, String, Number, Boolean, Math, Date, RegExp, Error, Promise, Array, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
    bkBase: () => 'https://synthetic-backend.invalid', bkToken: () => 'SYNTHETIC_CLINICIAN_CREDENTIAL',
    toast: (m, k) => toasts.push({ m, k }),
    localStorage: { getItem: (k) => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    navigator: { locks: null, clipboard: null },
    getTemplateById: (id) => templates.filter((t) => String(t.id) === String(id))[0] || null,
    getTemplates: () => templates.slice(),
    _opFinalizerRun(i, boundary) { const row = (ctx._opPrep || [])[i] || {}; return { ok: true, status: 'ready', boundary, note: String(row.note || ''), issues: [], repairs: [], receipt: {}, context: {} }; },
    _opFinalizerBatch(day, boundary) { return { ok: true, status: 'ready', boundary, rows: (day || []).map((x) => ({ rowIndex: x.i, result: ctx._opFinalizerRun(x.i, boundary) })) }; },
    opPrepAutosaveDraft() {}, opPrepRender() {},
    fetch(url, init) {
      const key = String(url).replace('https://synthetic-backend.invalid', '') + ' ' + String((init || {}).method || 'GET');
      calls.push({ key, body: (init && init.body) ? JSON.parse(init.body) : null });
      const reply = (opts.replies || {})[key];
      if (!reply) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: { code: 'NOT_STUBBED', message: key } }) });
      return Promise.resolve({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(JSON.parse(JSON.stringify(reply.body || {}))) });
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fn(SHELL, 'function esc(s){'), ctx, { filename: '1pScribeFlow.html#esc' });
  vm.runInContext(fn(SHELL, 'function opNoteBlankTokens(text){') + '\nwindow.opNoteBlankTokens=opNoteBlankTokens;', ctx, { filename: '1pScribeFlow.html#blanks' });
  vm.runInContext(BLOCK, ctx, { filename: '1pScribeFlow.html#opnote-svc' });
  ctx._opPrep = opts.rows || [];
  ctx.window._opPrep = ctx._opPrep;
  return { ctx, calls, toasts, dialog: () => body.children.map((c) => c.innerHTML).join('\n') };
}

const TPL_FULL = { id: 'tpl_full', name: 'ZZ Lumbar TFESI', kind: 'op', text: 'PROCEDURE PERFORMED:\nDESCRIPTION OF PROCEDURE: ZZ full narrative, a [NEEDLE GAUGE] needle.\nCOMPLICATIONS: None' };
const TPL_KNEE = { id: 'tpl_knee', name: 'ZZ Knee Arthroscopy', kind: 'op', text: 'OPERATION:\nFINDINGS:\nCOMPLICATIONS:' };

(async function suite() {
  /* =======================================================================
     1-2. Save shows the note with the values in it
     ===================================================================== */
  {
    const saves = [];
    const run = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/save POST': (init) => { saves.push(JSON.parse(init.body)); return settled(); }
    }));
    await run.ctx.window.opnReady;
    ok(/Needs you: 2 to fill/.test(run.dom.el('list').innerHTML), 'setup: the list did not ask for two');
    ok(/id="opnB_needle_gauge"/.test(run.dom.el('jobCard').innerHTML), 'setup: the first note did not open with its fields');
    run.dom.el('opnB_needle_gauge').value = '22-gauge 3.5-inch';
    run.dom.el('opnB_blank_line_1').value = '1';
    await run.ctx.opnSaveJob();
    deq(saves[0], { noteText: NOTE, blanks: [{ key: 'blank_line_1', value: '1' }, { key: 'needle_gauge', value: '22-gauge 3.5-inch' }], expectedVersion: 1 }, 'Save did not send the words and both values');
    eq(run.dom.el('opnNote').value, FILLED, 'after Save the note on screen does not have the values in it');
    const card = run.dom.el('jobCard').innerHTML;
    ok(!/id="opnB_/.test(card), 'a blank already in the note is still asked for');
    ok(!/Fill these in/.test(card), 'the page still says "Fill these in" with nothing left to fill');
    ok(/Already in the note: Blank #1: 1; NEEDLE GAUGE: 22-gauge 3\.5-inch\./.test(card), 'the page does not say what went into the note');
    eq(run.dom.el('jobMsg').textContent, 'Saved.');
    ok(/Needs you: 0 to fill/.test(run.dom.el('list').innerHTML), 'the list count did not follow the note');
    eq(run.ctx.opnOpen.version, 2);

    /* a value the service could not place is said out loud, by name */
    const run2 = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/save POST': settled({
        noteText: NOTE.replace('[NEEDLE GAUGE] ', ''), filledCount: 1,
        notPlaced: [{ key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '25-gauge' }],
        blanks: [{ key: 'blank_line_1', label: 'Blank #1', value: '', state: 'open' }, { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '25-gauge', state: 'cleared' }]
      })
    }));
    await run2.ctx.window.opnReady;
    run2.dom.el('opnB_needle_gauge').value = '25-gauge';
    await run2.ctx.opnSaveJob();
    const said = run2.dom.el('jobMsg');
    ok(/not put into the note/.test(said.textContent) && /NEEDLE GAUGE: 25-gauge/.test(said.textContent), 'a value that did not go in was not named: ' + said.textContent);
    eq(said.className, 'stop', 'a value that did not go in was reported as an ordinary success');
    ok(/id="opnB_blank_line_1"/.test(run2.dom.el('jobCard').innerHTML), 'the blank still waiting lost its field');

    /* opened again later, the page still names it - the practice's card does */
    const reopened = JSON.parse(JSON.stringify(JOB));
    reopened.notPlaced = [{ key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '25-gauge' }];
    const run3 = bootPage(pageReplies({ '/api/client/opnotes/jobs/oj_zz1 GET': { status: 200, body: { job: reopened } } }));
    await run3.ctx.window.opnReady;
    eq(run3.dom.el('jobMsg').textContent, 'This was not put into the note because its blank is no longer where it was, so type it in where it belongs: NEEDLE GAUGE: 25-gauge.',
      'a value still not in the note is not named when the note is opened again');
    eq(run3.dom.el('jobMsg').className, 'stop');
    const clean = bootPage(pageReplies());
    await clean.ctx.window.opnReady;
    eq(clean.dom.el('jobMsg').textContent, '', 'causal control: a note with nothing set aside opens with a message');
  }

  /* =======================================================================
     3-4. Mark done carries what is on screen; a refused value is said plainly
     ===================================================================== */
  {
    const dones = [];
    const run = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/complete POST': (init) => { dones.push(JSON.parse(init.body)); return settled({ status: 'completed', version: 2 }); }
    }));
    await run.ctx.window.opnReady;
    run.dom.el('opnB_needle_gauge').value = '22-gauge 3.5-inch';
    run.dom.el('opnB_blank_line_1').value = '1';
    await run.ctx.opnCompleteJob();
    deq(dones[0], { noteText: NOTE, blanks: [{ key: 'blank_line_1', value: '1' }, { key: 'needle_gauge', value: '22-gauge 3.5-inch' }], expectedVersion: 1 },
      'Mark done still sends only the version, so values typed and not saved are lost');
    eq(run.dom.el('opnNote').value, FILLED);
    eq(run.dom.el('jobMsg').textContent, 'Done. Nothing else to do.');
    ok(/>Done</.test(run.dom.el('list').innerHTML));

    /* done with a value still not in the note: it is named, and nothing says "nothing else to do" */
    const left = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/complete POST': settled({ status: 'completed', version: 2, notPlaced: [{ key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '25-gauge' }] })
    }));
    await left.ctx.window.opnReady;
    await left.ctx.opnCompleteJob();
    eq(left.dom.el('jobMsg').textContent, 'Marked done. This was not put into the note because its blank is no longer where it was, so type it in where it belongs: NEEDLE GAUGE: 25-gauge.');
    eq(left.dom.el('jobMsg').className, 'stop');

    const SAY = 'Something typed into a blank cannot go into the note as it is, so nothing was saved. Change it and save again.';
    const bad = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/save POST': { status: 422, body: { error: { code: 'OPNOTE_VALUE_REVIEW', message: SAY, details: { reasons: [{ code: 'UNBALANCED_DELIMITER' }] } } } }
    }));
    await bad.ctx.window.opnReady;
    bad.dom.el('opnB_needle_gauge').value = '22 {gauge';
    await bad.ctx.opnSaveJob();
    eq(bad.dom.el('jobMsg').textContent, SAY, 'a refused value did not get the plain sentence');
    eq(bad.dom.el('opnB_needle_gauge').value, '22 {gauge', 'a refused value was wiped from its field');
  }

  /* =======================================================================
     5. a re-fit saves first, then follows the service's new list
     ===================================================================== */
  {
    const order = [];
    const REFIT = 'DATE OF SERVICE: [DATE OF SERVICE]\n' + FILLED.replace('22-gauge 3.5-inch', '[NEEDLE GAUGE]') + '\nPLAN: [FOLLOW-UP]';
    const run = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/save POST': (init) => {
        order.push('save');
        return settled({ noteText: NOTE.replace('___ mL', '1 mL'), filledCount: 1,
          blanks: [{ key: 'blank_line_1', label: 'Blank #1', value: '1', state: 'placed' }, { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '', state: 'open' }] });
      },
      '/api/client/opnotes/jobs/oj_zz1/retemplate POST': (init) => {
        order.push('retemplate:' + JSON.parse(init.body).expectedVersion + ':' + JSON.parse(init.body).templateId);
        return { status: 200, body: { previousText: NOTE.replace('___ mL', '1 mL'), job: {
          version: 3, noteText: REFIT, templateId: 'ot_house', updatedAt: 11, blankCount: 4, filledCount: 1,
          blanks: [
            { key: 'blank_line_1', label: 'Blank #1', value: '1', state: 'placed' },
            { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '', state: 'open' },
            { key: 'date_of_service', label: 'DATE OF SERVICE', value: '', state: 'open' },
            { key: 'follow_up', label: 'FOLLOW-UP', value: '', state: 'open' }
          ] } } };
      }
    }));
    await run.ctx.window.opnReady;
    run.dom.el('opnB_blank_line_1').value = '1';                // typed, not saved
    run.dom.el('opnRefitPick').value = 'ot_house';
    await run.ctx.opnRefit();
    deq(order, ['save', 'retemplate:2:ot_house'], 'the rewrite ran before the typing on screen was saved, or lost the template picked');
    const card = run.dom.el('jobCard').innerHTML;
    for (const k of ['needle_gauge', 'date_of_service', 'follow_up']) ok(new RegExp('id="opnB_' + k + '"').test(card), 'the re-fitted note has no field for ' + k);
    ok(!/id="opnB_blank_line_1"/.test(card), 'a blank already in the note is asked for again after the re-fit');
    eq(run.dom.el('opnNote').value, REFIT, 'the re-fitted words are not on screen');
    ok(/Needs you: 3 to fill/.test(run.dom.el('list').innerHTML), '"Needs you" did not follow the re-fit: ' + run.dom.el('list').innerHTML);
    ok(!/\bhide\b/.test(run.dom.el('opnRefitUndo').className), 'Put it back is not offered after the rewrite');
    eq(run.ctx.opnUndoText, NOTE.replace('___ mL', '1 mL'));

    /* nothing is rewritten when the save in front of it is refused */
    const stop = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/save POST': { status: 409, body: { error: { code: 'OPNOTE_VERSION_CONFLICT' } } },
      '/api/client/opnotes/jobs/oj_zz1/retemplate POST': () => { throw new Error('the rewrite ran after its save was refused'); }
    }));
    await stop.ctx.window.opnReady;
    stop.dom.el('opnB_needle_gauge').value = '22-gauge';
    stop.dom.el('opnRefitPick').value = 'ot_house';
    await stop.ctx.opnRefit();
    ok(!stop.calls.some((c) => /retemplate/.test(c.key)), 'a rewrite ran after the save in front of it was refused');
    eq(stop.dom.el('opnB_needle_gauge').value, '22-gauge', 'the typing on screen was lost');
  }

  /* =======================================================================
     6. the practice's read-back: the safety net under an old note
     ===================================================================== */
  const OLD = 'DESCRIPTION: a [NEEDLE GAUGE] spinal needle. Dexamethasone 10 mg with ___ mL of 1% lidocaine.\nIMPLANT: [IMPLANT LOT]\nCOMPLICATIONS: None';
  const at = (s, t) => ({ at: OLD.indexOf(s), end: OLD.indexOf(s) + s.length, text: t || s });
  function returned(job) {
    return {
      '/api/opnote-jobs?status=completed GET': { status: 200, body: { jobs: [{ id: 'oj_back', status: 'completed' }] } },
      '/api/opnote-jobs/oj_back GET': { status: 200, body: { job } }
    };
  }
  {
    const row = { opKey: 'r1', opJobId: 'oj_back', appt: { name: 'ZZ Patient' }, note: OLD, gen: true };
    const o = owner({ rows: [row], replies: returned({
      id: 'oj_back', status: 'completed', noteText: OLD,
      blanks: [
        { key: 'blank_line_1', label: 'Blank #1', value: '1', state: 'open', kind: 'line', tokens: ['___'], spots: [at('___')] },
        { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '22-gauge 3.5-inch', state: 'open', kind: 'named', tokens: ['[NEEDLE GAUGE]'], spots: [at('[NEEDLE GAUGE]')] },
        { key: 'implant_lot', label: 'IMPLANT LOT', value: 'ZZ-LOT-7', state: 'open', kind: 'named', tokens: ['[IMPLANT LOT]'] }
      ],
      unplaced: [{ key: 'blank_line_3', label: 'Blank #3', value: '7' }]
    }) });
    await o.ctx.opPrepCheckReturned();
    eq(row.note, OLD.replace('[NEEDLE GAUGE]', '22-gauge 3.5-inch').replace('___ mL', '1 mL').replace('[IMPLANT LOT]', 'ZZ-LOT-7'),
      "the surgeon's values are still not in the note the practice reads back");
    deq(row.missing, [], 'the finished note still counts blanks');
    const st = o.ctx.document.getElementById('opPrepStatus').textContent;
    ok(/came back in the surgeon's own words/.test(st), 'a note whose values went in was reported unchanged: ' + st);
    ok(/1 value the surgeon typed could not be put into the note by itself/.test(st), 'a value the service kept aside was not mentioned: ' + st);
    deq(row.opSurgeonLeft, [{ label: 'Blank #3', value: '7' }]);
    ok(/Blank #3: 7/.test(o.ctx._opSurgeonLeftHtml(row)), 'the card does not show the value that could not be placed');
  }
  {
    /* an offset that does not point at its blank is never trusted */
    const row = { opKey: 'r2', opJobId: 'oj_back', appt: { name: 'ZZ Patient' }, note: OLD, gen: true };
    const o = owner({ rows: [row], replies: returned({
      id: 'oj_back', status: 'completed', noteText: OLD,
      blanks: [{ key: 'blank_line_1', label: 'Blank #1', value: '1', state: 'open', kind: 'line', tokens: ['___'], spots: [{ at: 3, end: 6, text: '___' }] }]
    }) });
    await o.ctx.opPrepCheckReturned();
    eq(row.note, OLD, 'a value went in at an offset that did not hold its blank');
    deq(row.opSurgeonLeft, [{ label: 'Blank #1', value: '1' }], 'the value that could not be placed was dropped');
  }
  {
    /* an older service with no spots: nothing is guessed, and nothing is silent */
    const row = { opKey: 'r3', opJobId: 'oj_back', appt: { name: 'ZZ Patient' }, note: OLD, gen: true };
    const o = owner({ rows: [row], replies: returned({
      id: 'oj_back', status: 'completed', noteText: OLD,
      blanks: [{ key: 'blank_line_1', label: 'Blank #1', value: '1' }, { key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '22-gauge' }]
    }) });
    await o.ctx.opPrepCheckReturned();
    eq(row.note, OLD);
    eq(row.opSurgeonLeft.length, 2, 'values from an older service vanished without a word');
    ok(/2 values the surgeon typed could not be put into the note by themselves/.test(o.ctx.document.getElementById('opPrepStatus').textContent));
  }
  {
    /* causal control: a note already settled by the service is left alone */
    /* ...and a value the card showed before is dropped once the service stops listing it (the surgeon typed it in) */
    const row = { opKey: 'r4', opJobId: 'oj_back', appt: { name: 'ZZ Patient' }, note: FILLED, gen: true, opSurgeonLeft: [{ label: 'NEEDLE GAUGE', value: '22-gauge 3.5-inch' }] };
    const o = owner({ rows: [row], replies: returned({
      id: 'oj_back', status: 'completed', noteText: FILLED,
      blanks: [{ key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '22-gauge 3.5-inch', state: 'placed', kind: 'named', tokens: ['[NEEDLE GAUGE]'] }], unplaced: []
    }) });
    await o.ctx.opPrepCheckReturned();
    eq(row.note, FILLED);
    eq(row.opSurgeonLeft, null, 'the card still asks for a value the service no longer lists');
    eq(o.ctx._opSurgeonLeftHtml(row), '');
    ok(/marked done, and the wording has not changed\.$/.test(o.ctx.document.getElementById('opPrepStatus').textContent));
  }

  /* =======================================================================
     7. the template that travels is the one that wrote the note
     ===================================================================== */
  {
    /* the draft itself records it - even if the dropdown moves mid-draft */
    const gen = between(SHELL, 'async function opPrepGenerateOne(i){', '/* Save (or update)');
    const o = owner({ rows: [], templates: [TPL_FULL, TPL_KNEE] });
    let release;
    const row = { opKey: 'rg', appt: { name: 'ZZ Patient', dob: '1970-01-01' }, patientId: 'zz-p1', proc: 'ZZ TFESI', tplId: 'tpl_full', note: '', missing: [], values: {}, gen: false };
    Object.assign(o.ctx, {
      _opPatientCtx: () => ({ patientId: 'zz-p1' }), _tplTextForDraft: (t) => t, _opTomorrowDateStr: () => 'ZZ',
      _genOpNote: () => new Promise((r) => { release = r; }),
      _opRowVerdict() {}, _opReconcileBlanks() {}, _isNeedleField: () => false, getOpFieldVals: () => [], _predictNeedleSize: () => ''
    });
    o.ctx._opPrep.push(row);
    vm.runInContext(gen, o.ctx, { filename: '1pScribeFlow.html#generate' });
    const drafting = o.ctx.opPrepGenerateOne(0);
    row.tplId = 'tpl_knee'; row.tplManual = true;              // the dropdown's own onchange, mid-draft
    release({ note: 'ZZ drafted words [NEEDLE GAUGE]', missing: [], templateMode: 'strict' });
    await drafting;
    eq(row.gen, true, 'setup: the draft did not land');
    eq(row.draftTplId, 'tpl_full', 'the draft did not record the template that wrote it');
    eq(row.draftTplHash, o.ctx._opTplTextHash(TPL_FULL.text), 'the draft did not record the words of that template');

    /* a draft the final check refuses still leaves its words on the row, so
       it records the template that wrote them all the same */
    const row2 = { opKey: 'rg2', appt: { name: 'ZZ Patient', dob: '1970-01-01' }, patientId: 'zz-p1', proc: 'ZZ TFESI', tplId: 'tpl_knee', note: '', missing: [], values: {}, gen: false,
      draftTplId: 'tpl_full', draftTplHash: 'tpl-stale' };
    o.ctx._opPrep.push(row2);
    o.ctx._genOpNote = async () => ({ note: 'ZZ knee words', missing: [], templateMode: 'strict' });
    const pass = o.ctx._opFinalizerRun;
    o.ctx._opFinalizerRun = (i, boundary) => boundary === 'generation' ? { ok: false, issues: [{ message: 'ZZ refused' }] } : pass(i, boundary);
    await o.ctx.opPrepGenerateOne(1);
    o.ctx._opFinalizerRun = pass;
    eq(row2.note, 'ZZ knee words', 'setup: the refused draft did not leave its words');
    eq(row2.draftTplId, 'tpl_knee', 'words from one template sit on the row under the name of another');
    eq(row2.draftTplHash, o.ctx._opTplTextHash(TPL_KNEE.text));
  }
  const drafted = () => ({ opKey: 'rs', appt: { name: 'ZZ Patient' }, proc: 'ZZ TFESI', note: 'ZZ drafted words [NEEDLE GAUGE]', gen: true, tplId: 'tpl_full' });
  const sendReplies = {
    '/api/opnote-clients GET': { status: 200, body: { clients: [{ id: 'oc_zz', name: 'ZZ Dr Surgeon', email: 'zz.surgeon@example.test' }] } },
    '/api/opnote-jobs POST': { status: 200, body: { job: { id: 'oj_sent', status: 'draft', blankCount: 1 } } },
    '/api/opnote-jobs/batch POST': { status: 200, body: { created: 2, asked: 2, results: [{ ok: true, id: 'oj_a' }, { ok: true, id: 'oj_b' }] } }
  };
  async function sendOne(row, templates) {
    const o = owner({ rows: [row], templates: templates || [TPL_FULL, TPL_KNEE], replies: sendReplies });
    await o.ctx.opPrepForSurgeon(0);
    o.ctx._opSurgeonRow = 0;          // the send press guards on its own, too
    o.ctx.document.getElementById('opSurgeonPick').value = 'oc_zz';
    await o.ctx.opSurgeonSend();
    return o;
  }
  {
    const o0 = owner({ rows: [], templates: [TPL_FULL] });
    const HASH = o0.ctx._opTplTextHash(TPL_FULL.text);

    /* dropdown moved after the draft: refused, nothing made */
    const moved = Object.assign(drafted(), { draftTplId: 'tpl_full', draftTplHash: HASH, tplId: 'tpl_knee', tplManual: true });
    let o = await sendOne(moved);
    eq(o.calls.length, 0, 'a note was sent (or a surgeon list opened) beside a template that did not write it');
    ok(o.toasts.some((t) => /^ZZ Patient.s op note: the template was changed after this note was drafted - redraft it, or switch the template back to \u201cZZ Lumbar TFESI\u201d\.$/.test(t.m)),
      'opening the hand-off did not say what happened and what to do: ' + JSON.stringify(o.toasts));
    ok(/Nothing was sent\. ZZ Patient.s op note: the template was changed after this note was drafted/.test(o.ctx.document.getElementById('opSurgeonMsg').textContent),
      'the send press itself does not refuse: ' + o.ctx.document.getElementById('opSurgeonMsg').textContent);

    /* switched back: the drafted template travels */
    const back = Object.assign(drafted(), { draftTplId: 'tpl_full', draftTplHash: HASH, tplId: 'tpl_full' });
    o = await sendOne(back);
    const sent = o.calls.filter((c) => c.key === '/api/opnote-jobs POST');
    eq(sent.length, 1);
    eq(sent[0].body.templateId, 'tpl_full');
    eq(sent[0].body.templateName, TPL_FULL.name);
    eq(sent[0].body.templateText, TPL_FULL.text, 'the drafted template did not travel with its note');

    /* the drafted template's words were edited since: refused */
    const edited = Object.assign(drafted(), { draftTplId: 'tpl_full', draftTplHash: HASH, tplId: 'tpl_full' });
    o = await sendOne(edited, [Object.assign({}, TPL_FULL, { text: TPL_FULL.text + '\nZZ EDITED LINE' }), TPL_KNEE]);
    eq(o.calls.length, 0, 'a note was sent beside template words that did not write it');
    ok(o.toasts.some((t) => /the template was edited after this note was drafted - redraft it so the surgeon gets the words that wrote it\./.test(t.m)));
    ok(/the template was edited after this note was drafted/.test(o.ctx.document.getElementById('opSurgeonMsg').textContent));

    /* a note with no record of its template goes WITHOUT one - never the
       dropdown's guess - and the dialog says so before Send */
    o = await sendOne(Object.assign(drafted(), { tplId: 'tpl_knee', tplManual: true }));
    const bare = o.calls.filter((c) => c.key === '/api/opnote-jobs POST');
    eq(bare.length, 1, 'setup: the note did not go');
    deq([bare[0].body.templateId, bare[0].body.templateName, bare[0].body.templateText], [null, '', ''], 'a note went beside the template the dropdown showed, not one that wrote it');
    eq(bare[0].body.noteText, 'ZZ drafted words [NEEDLE GAUGE]');
    const pick = owner({ rows: [drafted()], templates: [TPL_FULL, TPL_KNEE], replies: sendReplies });
    await pick.ctx.opPrepForSurgeon(0);
    ok(/It will go without a template beside it, because which template wrote it is not known here\. Redraft it if the surgeon should have the template too\./.test(pick.dialog()),
      'the dialog does not say the note goes without its template: ' + pick.dialog().replace(/<[^>]*>/g, ' ').slice(0, 300));
    const known = owner({ rows: [Object.assign(drafted(), { draftTplId: 'tpl_full', draftTplHash: HASH })], templates: [TPL_FULL, TPL_KNEE], replies: sendReplies });
    await known.ctx.opPrepForSurgeon(0);
    ok(!/without a template/.test(known.dialog()), 'causal control: a note whose template is known is said to go without one');

    /* the whole day: one moved row refuses the day before anything is made */
    const dayRows = [Object.assign(drafted(), { opKey: 'd1', draftTplId: 'tpl_full', draftTplHash: HASH }),
      Object.assign(drafted(), { opKey: 'd2', draftTplId: 'tpl_full', draftTplHash: HASH, tplId: 'tpl_knee' })];
    const day = owner({ rows: dayRows, templates: [TPL_FULL, TPL_KNEE], replies: sendReplies });
    day.ctx.document.getElementById('opSurgeonName').value = 'ZZ New Surgeon';
    await day.ctx.opSurgeonSendDay();
    eq(day.calls.length, 0, 'the day send made a surgeon or a job before refusing a row whose template moved');
    ok(/Nothing was sent\..*the template was changed after this note was drafted/.test(day.ctx.document.getElementById('opSurgeonMsg').textContent));
    dayRows[1].tplId = 'tpl_full';
    const day2 = owner({ rows: dayRows, templates: [TPL_FULL, TPL_KNEE], replies: sendReplies });
    day2.ctx.document.getElementById('opSurgeonPick').value = 'oc_zz';
    await day2.ctx.opSurgeonSendDay();
    const batch = day2.calls.filter((c) => c.key === '/api/opnote-jobs/batch POST');
    eq(batch.length, 1, 'setup: the corrected day did not send');
    deq(batch[0].body.jobs.map((j) => [j.templateId, j.templateText === TPL_FULL.text]), [['tpl_full', true], ['tpl_full', true]]);

    /* a day with one note whose template is not known: that one goes bare, the other keeps its own */
    const mixed = [Object.assign(drafted(), { opKey: 'm1', draftTplId: 'tpl_full', draftTplHash: HASH }), Object.assign(drafted(), { opKey: 'm2', tplId: 'tpl_knee' })];
    const day3 = owner({ rows: mixed, templates: [TPL_FULL, TPL_KNEE], replies: sendReplies });
    await day3.ctx.opPrepForSurgeon(0);
    ok(/1 of the 2 drafted op notes will go without a template beside it/.test(day3.dialog()), 'the day dialog does not count the note going without its template');
    day3.ctx.document.getElementById('opSurgeonPick').value = 'oc_zz';
    await day3.ctx.opSurgeonSendDay();
    const b3 = day3.calls.filter((c) => c.key === '/api/opnote-jobs/batch POST');
    eq(b3.length, 1);
    deq(b3[0].body.jobs.map((j) => [j.templateId, j.templateName, j.templateText === TPL_FULL.text]), [['tpl_full', TPL_FULL.name, true], [null, '', false]]);
    eq(b3[0].body.jobs[1].templateText, '');
  }

  /* =======================================================================
     9. the record survives a reopened day (review round 2)
     ===================================================================== */
  {
    const PREP = read('feat_mls_opnote_prep.js');
    const gen = between(SHELL, 'async function opPrepGenerateOne(i){', '/* Save (or update)');
    let store = [];
    const history = {
      getNotes: () => JSON.parse(JSON.stringify(store)),
      saveNotes: (ns) => { store = JSON.parse(JSON.stringify(ns)); },
      _opResolvePatient: () => ({ id: 'zz-p1', name: 'ZZ Patient' }), _opCcDate: () => '', _opQueueDraftBackup() {}, _opHistoryRepaintSoon() {}
    };
    const o = owner({ rows: [], templates: [TPL_FULL, TPL_KNEE] });
    Object.assign(o.ctx, history, {
      _opPatientCtx: () => ({ patientId: 'zz-p1' }), _tplTextForDraft: (t) => t, _opTomorrowDateStr: () => 'ZZ',
      _genOpNote: async () => ({ note: 'ZZ full-template words [NEEDLE GAUGE]', missing: [], templateMode: 'strict' }),
      _opRowVerdict() {}, _opReconcileBlanks() {}, _isNeedleField: () => false, getOpFieldVals: () => [], _predictNeedleSize: () => ''
    });
    vm.runInContext(fn(SHELL, 'function opPrepAutosaveDraft(i){'), o.ctx, { filename: '1pScribeFlow.html#autosave' });
    vm.runInContext(gen, o.ctx, { filename: '1pScribeFlow.html#generate' });
    const row = { opKey: 'rg', appt: { name: 'ZZ Patient', dob: '1970-01-01' }, patientId: 'zz-p1', proc: 'ZZ TFESI', tplId: 'tpl_full', note: '', missing: [], values: {}, gen: false };
    o.ctx._opPrep.push(row);
    await o.ctx.opPrepGenerateOne(0);
    eq(row.draftTplId, 'tpl_full', 'setup: the draft did not record its template');
    eq(store.length, 1, 'setup: the draft did not land in History');
    eq(store[0].opDraftTplId, 'tpl_full', 'the History draft does not carry the template that wrote it');
    eq(store[0].opDraftTplHash, o.ctx._opTplTextHash(TPL_FULL.text), 'the History draft does not carry the hash of that template');
    ok(!JSON.stringify(store[0]).includes(TPL_FULL.text), 'the History draft carries the template words themselves');

    /* the day is reopened: a fresh row, and the REAL resume */
    const resume = (notes, rowProps) => {
      const fresh = Object.assign({ opKey: 'rg', appt: { name: 'ZZ Patient', dob: '1970-01-01' }, patientId: 'zz-p1', proc: 'ZZ TFESI', tplId: 'tpl_full', note: '', missing: [], values: {}, gen: false }, rowProps || {});
      const actx = { window: {}, S: (x) => x == null ? '' : String(x), isFn: (f) => typeof f === 'function', trim: (x) => (x == null ? '' : String(x)).trim(), STATE: { resumedDrafts: 0 } };
      actx.window.getNotes = () => JSON.parse(JSON.stringify(notes)); actx.window._opResolvePatient = () => ({ id: 'zz-p1', name: 'ZZ Patient' }); actx.window._opCcDate = () => '';
      vm.createContext(actx);
      vm.runInContext(fn(PREP, 'function adoptExistingDraft(row) {'), actx, { filename: 'feat_mls_opnote_prep.js#adopt' });
      ok(actx.adoptExistingDraft(fresh), 'setup: the draft was not resumed');
      eq(fresh.note, 'ZZ full-template words [NEEDLE GAUGE]');
      return fresh;
    };
    const back = resume(store);
    eq(back.draftTplId, 'tpl_full', 'the resumed draft lost the template that wrote it');
    eq(back.draftTplHash, o.ctx._opTplTextHash(TPL_FULL.text));

    /* the reviewer's walk: move the dropdown on the resumed draft and press Send */
    back.tplId = 'tpl_knee'; back.tplManual = true;
    let s1 = await sendOne(back);
    eq(s1.calls.length, 0, 'a resumed draft went to the surgeon beside a template that did not write it');
    ok(s1.toasts.some((t) => /the template was changed after this note was drafted - redraft it, or switch the template back to \u201cZZ Lumbar TFESI\u201d\./.test(t.m)), JSON.stringify(s1.toasts));
    back.tplId = 'tpl_full';
    s1 = await sendOne(back);
    const went = s1.calls.filter((c) => c.key === '/api/opnote-jobs POST');
    eq(went.length, 1);
    deq([went[0].body.templateId, went[0].body.templateName, went[0].body.templateText], ['tpl_full', TPL_FULL.name, TPL_FULL.text], 'the resumed draft did not travel with the template that wrote it');

    /* the resumed row autosaves again: the record stays with the words */
    o.ctx._opPrep.splice(0, o.ctx._opPrep.length, back);
    back._noteId = store[0].id;
    back.note += '\nZZ owner edit';
    o.ctx.opPrepAutosaveDraft(0);
    eq(store[0].opDraftTplId, 'tpl_full', 'an autosave of the resumed draft dropped its template record');

    /* a draft autosaved before this change has no record: it goes WITHOUT a template */
    const legacy = [{ id: 'n_old', patientId: 'zz-p1', kind: 'opnote', isDraft: true, cc: 'ZZ Patient \u2014 ZZ TFESI (op-note draft)', text: 'ZZ full-template words [NEEDLE GAUGE]', updated: 1 }];
    const old = resume(legacy, { tplId: 'tpl_knee' });
    eq(old.draftTplId, '', 'a draft with no record was given one');
    const s2 = await sendOne(old);
    const bareOld = s2.calls.filter((c) => c.key === '/api/opnote-jobs POST');
    eq(bareOld.length, 1);
    deq([bareOld[0].body.templateId, bareOld[0].body.templateName, bareOld[0].body.templateText], [null, '', ''], 'a resumed draft with no record went beside the dropdown template');
  }

  /* =======================================================================
     both 1p twins carry the same code, and the derived shells carry it too
     ===================================================================== */
  {
    const twin = read('1p/index.html');
    eq(between(twin, '/* ===== opnote-svc-1.0.0 - PREPARE THIS OP NOTE FOR A CLIENT SURGEON', 'function opPrepSave(i){'), BLOCK, 'the two 1p shells carry different surgeon code');
    eq(between(twin, 'async function opPrepGenerateOne(i){', '/* Save (or update)'), between(SHELL, 'async function opPrepGenerateOne(i){', '/* Save (or update)'), 'the two 1p shells draft differently');
    for (const page of ['ScribeFlow.html', 'cloned/index.html']) {
      const src = read(page);
      ok(src.indexOf('function _opSurgeonTplProblem(row){') >= 0 && src.indexOf('row.draftTplId=String(tpl.id||\'\')') >= 0 && src.indexOf('function _opApplySurgeonValues(text,blanks){') >= 0,
        page + ' was not derived from the fixed 1p shell');
    }
  }

  /* =======================================================================
     8. no developer word reaches the surgeon
     ===================================================================== */
  {
    const run = bootPage(pageReplies({
      '/api/client/opnotes/jobs/oj_zz1/save POST': settled({ notPlaced: [{ key: 'needle_gauge', label: 'NEEDLE GAUGE', value: '25-gauge' }] })
    }));
    await run.ctx.window.opnReady;
    await run.ctx.opnSaveJob();
    const BANNED = /\b(?:tokens?|APIs?|endpoints?|JSON|sessions?|backend|sync|payloads?|placeholders?|offsets?)\b|error code/i;
    const hits = run.dom.painted.map((s) => String(s).replace(/<[^>]*>/g, ' ')).filter((s) => BANNED.test(s));
    deq(hits, [], 'developer words reached the surgeon');
  }

  console.log('PASS op-note surgeon values and template: ' + checks + ' checks - after Save and Mark done the surgeon sees the note with the values in it and only what is still missing, a value that could not go in is named on save, on done and on reopening, a re-fit saves first and follows the new list and count, the practice read-back puts values still beside an old note into it at checked offsets, shows anything it cannot place and drops what the service no longer lists, the draft records the template that wrote it - in History too, so a reopened day keeps it - and Send (one or the whole day) refuses a moved dropdown or edited template, sends the drafted one, and sends a note with no record WITHOUT a template (said in the dialog), twins and derived shells agree, no developer words');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
