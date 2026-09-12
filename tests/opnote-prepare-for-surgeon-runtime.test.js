'use strict';
/* =============================================================================
   PREPARE THIS OP NOTE FOR A CLIENT SURGEON — the owner side, EXECUTED
   (lane opnote-svc-1.0.0, 2026-09-11)

   Owner, 2026-09-11: "I TAKE PATIENTS AND MAKE OP NOTES ALL DONE and then they
   just get the fill things and it's super super easy for them."

   The control on the op-note card hands a finished draft to an outside surgeon:
   it picks or creates the client, extracts the fields the draft could NOT fill,
   posts the job, and shows the scoped link exactly once.

   THE ONE THING THIS SUITE EXISTS FOR. The list of fields the surgeon is asked
   to fill must be EXACTLY window.opNoteBlankTokens(note) — the same canonical
   parser opPrepSave gates on. This repo has already shipped a second, looser
   placeholder parser that disagreed with the save gate, and the result was
   placeholder-bearing notes filed as complete. So the blanks here are driven
   through the REAL function lifted out of the shell, never a paraphrase, and
   the payload is measured at the wire.

   Also pinned: the existing card controls do not move (opPrepSave and
   opPrepSendToAthena are byte-compared against HEAD), the hunk is byte-identical
   in both 1p twins and present in all four shipped shells, and the link is
   rendered ONCE and is gone from the document when the dialog closes.

   No network, no patient data, no browser. Every fixture is synthetic.
   ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const EDITABLE = ['1pScribeFlow.html', '1p/index.html'];
/* All four pages. The two derived shells are what a doctor actually loads, so a
   control that survives the 1p edit but not the derivation is a control that
   does not ship. Like the other room suites, this is EXPECTED to be red between
   a 1p shell edit and the derive step. */
const ALL_PAGES = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* brace-balanced function lift, so a comment or a nested block cannot truncate it */
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
  const i = src.indexOf(a);
  assert(i >= 0, 'missing anchor: ' + a);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end anchor: ' + b);
  return src.slice(i, j);
}

const SHELL = read('1pScribeFlow.html');
const BLOCK_START = '/* ===== opnote-svc-1.0.0 - PREPARE THIS OP NOTE FOR A CLIENT SURGEON';
const BLOCK_END = 'function opPrepSave(i){';

/* =======================================================================
 * 1. THE CONTROL EXISTS ONCE PER SHELL, AND THE HUNK IS ONE HUNK
 * ===================================================================== */
for (const page of ALL_PAGES) {
  const src = read(page);
  const n = (src.match(/onclick="opPrepForSurgeon\('\+i\+'\)/g) || []).length;
  eq(n, 1, page + ': the Prepare for a surgeon control appears ' + n + ' times, expected exactly 1');
  ok(src.indexOf(BLOCK_START) >= 0, page + ': the opnote-svc handler block is missing');
}
{
  const a = between(read(EDITABLE[0]), BLOCK_START, BLOCK_END);
  const b = between(read(EDITABLE[1]), BLOCK_START, BLOCK_END);
  eq(a, b, 'the two 1p shells carry DIFFERENT handler code — they are byte-twins and every shell edit must land in both');
}
{
  /* It mounts in the SAME action row as Save and Send to Athena, after Send —
     measured on the shipped render string, not on a comment about it. */
  const row = between(SHELL, "h+='<div class=\"row\" style=\"margin-top:6px;gap:8px\">", "</div>';");
  ok(row.indexOf('opPrepSave(') >= 0 && row.indexOf('opPrepSendToAthena(') >= 0 && row.indexOf('opPrepForSurgeon(') >= 0,
    'the three card actions no longer share one row');
  ok(row.indexOf('opPrepSendToAthena(') < row.indexOf('opPrepForSurgeon('),
    'Prepare for a surgeon must follow Send to Athena, not precede it');
  ok(!/opPrepForSurgeon\([^)]*\)"[^>]*disabled/.test(row), 'the new control ships disabled');
}

/* =======================================================================
 * 2. THE EXISTING CONTROLS DID NOT MOVE
 * Byte-compared against HEAD, because "additive" is a claim, not a fact.
 * ===================================================================== */
{
  const headShell = spawnSync('git', ['show', 'HEAD:1pScribeFlow.html'], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64, windowsHide: true });
  eq(headShell.status, 0, 'could not read HEAD:1pScribeFlow.html to prove the existing controls are untouched');
  for (const decl of ['function opPrepSave(i){', 'function opPrepSendToAthena(i){', 'function opNoteBlankTokens(text){']) {
    eq(fn(SHELL, decl), fn(headShell.stdout, decl), decl + ' changed. This lane is additive: the op-note flow the owner already uses must be byte-identical.');
  }
}

/* =======================================================================
 * 3. THE BLANKS ARE THE CANONICAL ONES — no second parser anywhere
 * ===================================================================== */
{
  const block = between(SHELL, BLOCK_START, BLOCK_END);
  ok(/window\.opNoteBlankTokens\(/.test(block), 'the handler does not call the canonical blank parser at all');
  /* a placeholder parser of its own would have to name one of these shapes */
  for (const shape of ['[[', 'FILL:', 'not dictated', '{{']) {
    ok(block.indexOf(shape) === -1,
      'the handler mentions the placeholder shape ' + JSON.stringify(shape) + '. It must never re-derive blanks: a second, looser ' +
      'parser disagreeing with the save gate is exactly how a note with a blank in it was filed as complete before.');
  }
}

/* -------------------------------------------------------------------------
   The runtime. A small DOM plus the shell's own esc(), the REAL parser, and
   the REAL handler block — driven through a stubbed network.
   ------------------------------------------------------------------------- */
function runtime(options) {
  const opts = options || {};
  const calls = [];
  const lazy = new Map();
  const body = { children: [] };
  body.appendChild = function (n) { n.parentNode = body; body.children.push(n); return n; };
  body.removeChild = function (n) { const at = body.children.indexOf(n); if (at >= 0) body.children.splice(at, 1); n.parentNode = null; return n; };

  function makeNode(tag) {
    return { tag: tag, id: '', innerHTML: '', value: '', textContent: '', parentNode: null, attrs: {}, style: { cssText: '' }, selected: 0, setAttribute(k, v) { this.attrs[k] = String(v); }, select() { this.selected++; } };
  }
  const document = {
    body: body,
    createElement(tag) { return makeNode(tag); },
    getElementById(id) {
      for (const child of body.children) if (child.id === id) return child;
      if (!lazy.has(id)) lazy.set(id, makeNode('stub'));
      return lazy.get(id);
    }
  };
  const toasts = [];
  const copied = [];
  const ctx = {
    document,
    console, JSON, Object, String, Number, Boolean, Math, RegExp, Error, Promise, Array,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
    bkBase: () => 'https://synthetic-backend.invalid',
    bkToken: () => 'SYNTHETIC_CLINICIAN_CREDENTIAL',
    toast: (m, k) => toasts.push({ m, k }),
    /* tplcarry-2.0.0: the library lives outside the evaluated block, so it is
       supplied here with the same field names the real store uses. A test that
       left this out would make the template-carry assertions below pass
       vacuously on an empty library. */
    getTemplateById: (id) => (opts.templates || []).filter((t) => String(t.id) === String(id))[0] || null,
    getTemplates: () => (opts.templates || []).slice(),
    navigator: { clipboard: { writeText: (v) => { copied.push(String(v)); return Promise.resolve(); } } },
    fetch(url, init) {
      calls.push({ url: String(url), init: init || {} });
      const key = String(url).replace('https://synthetic-backend.invalid', '') + ' ' + String((init || {}).method || 'GET');
      const reply = (opts.replies || {})[key];
      if (!reply) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: { code: 'NOT_STUBBED', message: key } }) });
      return Promise.resolve({ ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body || {}) });
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fn(SHELL, 'function esc(s){'), ctx, { filename: '1pScribeFlow.html#esc' });
  vm.runInContext(fn(SHELL, 'function opNoteBlankTokens(text){') + '\nwindow.opNoteBlankTokens=opNoteBlankTokens;', ctx, { filename: '1pScribeFlow.html#blanks' });
  vm.runInContext(between(SHELL, BLOCK_START, BLOCK_END), ctx, { filename: '1pScribeFlow.html#opnote-svc' });
  ctx._opPrep = opts.rows || [];
  ctx.window._opPrep = ctx._opPrep;
  return { ctx, calls, toasts, copied, body, dialogHtml: () => body.children.map((c) => c.innerHTML).join('\n') };
}

/* the synthetic draft the spec names: three placeholders, three different
   shapes, plus ordinary bracketed clinical prose that must count for nothing */
/* The template the draft above was written from. Synthetic, and long enough
   that the "text travelled" assertion cannot pass on a stub. */
const KNEE_TEMPLATE = {
  id: 'tpl_knee',
  name: 'Right knee arthroscopy',
  text: [
    'PREOPERATIVE DIAGNOSIS:',
    'POSTOPERATIVE DIAGNOSIS:',
    'PROCEDURE PERFORMED:',
    'ANESTHESIA:',
    'ESTIMATED BLOOD LOSS:',
    'FINDINGS:',
    'DESCRIPTION OF PROCEDURE:',
    'DISPOSITION:',
  ].join('\n'),
};

const DRAFT = [
  'PROCEDURE: Right knee arthroscopy with partial medial meniscectomy.',
  'ESTIMATED BLOOD LOSS: [ESTIMATED BLOOD LOSS]',
  'IMPLANT: [FILL: implant lot]',
  'GRAFT: [[graft_size]]',
  'FINDINGS: the medial compartment (left) was inspected [see image]; the patient had fallen through a window. [BP 128/76, HR 72]'
].join('\n');

const EXPECTED_BLANKS = [
  { key: 'graft_size', label: 'Graft Size' },
  { key: 'implant_lot', label: 'implant lot' },
  { key: 'estimated_blood_loss', label: 'ESTIMATED BLOOD LOSS' }
];

const LINK_URL = 'https://mlsscribe.com/opnotes.html#k=' + 'b'.repeat(64);

function happyReplies(extra) {
  return Object.assign({
    '/api/opnote-clients GET': { status: 200, body: { clients: [{ id: 'oc_synthetic1', label: 'Rivera', name: 'Dr Sam Rivera', practice: 'Northside Orthopaedics', openJobs: 0, completedJobs: 0, activeLink: null }] } },
    '/api/opnote-jobs POST': { status: 200, body: { job: { id: 'oj_synthetic1', status: 'draft', blankCount: 3, createdAt: 1 } } },
    '/api/opnote-clients/oc_synthetic1/link POST': { status: 200, body: { link: { id: 7, url: LINK_URL, token: 'b'.repeat(64), prefix: 'bbbbbbbb', expiresAt: 2 } } }
  }, extra || {});
}

(async function suite() {
  /* ---- the real parser, on the real draft --------------------------------- */
  {
    const r = runtime({ rows: [] });
    const blanks = r.ctx.window.opNoteBlankTokens(DRAFT);
    eq(blanks.length, 3, 'the canonical parser found ' + blanks.length + ' fields in a draft with exactly three placeholders');
    /* normalized across the vm realm boundary — deepStrictEqual compares
       prototypes, and objects minted inside the context carry that context's */
    assert.deepStrictEqual(JSON.parse(JSON.stringify(blanks)), EXPECTED_BLANKS, 'the canonical parser returned different keys/labels than the surgeon page will show');
    checks++;
    /* causal control: ordinary bracketed prose alone counts for nothing, so the
       three above are really placeholders and not "any bracket" */
    eq(r.ctx.window.opNoteBlankTokens('FINDINGS: the L4 (left) nerve [see image] was targeted. [sic]').length, 0,
      'ordinary bracketed clinical prose was counted as a field the surgeon must fill');
  }

  /* ---- nothing drafted yet: refused, and NOTHING is posted ---------------- */
  {
    const r = runtime({ rows: [{ note: '   ', proc: 'Right knee arthroscopy' }], replies: happyReplies() });
    await r.ctx.opPrepForSurgeon(0);
    eq(r.calls.length, 0, 'an empty card reached the server anyway');
    eq(r.body.children.length, 0, 'an empty card opened a dialog with nothing to hand over');
    ok(r.toasts.length === 1 && /Draft the op note first/.test(r.toasts[0].m), 'an empty card was refused silently');
  }

  /* ---- the ordinary hand-over -------------------------------------------- */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Right knee arthroscopy', tplId: 'tpl_knee' }],
      templates: [KNEE_TEMPLATE],
      replies: happyReplies(),
    });
    await r.ctx.opPrepForSurgeon(0);

    eq(r.calls.length, 1, 'opening the control made ' + r.calls.length + ' requests, expected exactly the client list');
    eq(r.calls[0].url, 'https://synthetic-backend.invalid/api/opnote-clients', 'the client list came from the wrong place');
    eq(r.calls[0].init.headers.Authorization, 'Bearer SYNTHETIC_CLINICIAN_CREDENTIAL', 'the owner call did not carry the clinician credential');

    const pick = r.dialogHtml();
    ok(/Prepare for a surgeon/.test(pick), 'the dialog does not name itself');
    ok(/Dr Sam Rivera/.test(pick), 'the surgeons the owner already works with are not offered');
    ok(/3 fields will be left for them to fill in/.test(pick),
      'the dialog does not say how much is left for the surgeon: ' + pick.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));
    ok(!/\bk=/.test(pick), 'a link was shown before anything was posted');

    r.ctx.document.getElementById('opSurgeonPick').value = 'oc_synthetic1';
    await r.ctx.opSurgeonSend();

    /* THE PAYLOAD, AT THE WIRE */
    const job = r.calls.filter((c) => /\/api\/opnote-jobs$/.test(c.url));
    eq(job.length, 1, 'the op note was posted ' + job.length + ' times');
    eq(job[0].init.method, 'POST', 'the job was not posted');
    eq(job[0].init.headers['Content-Type'], 'application/json', 'the job body was sent without saying what it is');
    const sent = JSON.parse(job[0].init.body);
    assert.deepStrictEqual(Object.keys(sent).sort(),
      ['blanks', 'clientId', 'noteText', 'templateId', 'templateName', 'templateText', 'title'],
      'the job body is not the agreed shape: ' + Object.keys(sent).join(','));
    checks++;
    eq(sent.clientId, 'oc_synthetic1', 'the job went to the wrong surgeon');
    eq(sent.templateId, 'tpl_knee', 'the job lost the template it was written from');
    /* tplcarry-2.0.0. templateId alone is an id in THIS app's library and means
       nothing to the service, so a job that carried only the id was filed with
       no template at all and the surgeon opened their page to an empty template
       list however many notes they had been sent. The words have to travel. */
    ok(typeof sent.templateName === 'string' && sent.templateName.length > 0,
      'the job carried no template NAME, so the surgeon\'s template list stays empty');
    ok(typeof sent.templateText === 'string' && sent.templateText.length > 20,
      'the job carried no template TEXT, so nothing can be put on the surgeon\'s list or offered as an alternative');
    checks += 2;
    eq(sent.title, 'Right knee arthroscopy', 'the job lost its procedure title');
    eq(sent.noteText, DRAFT, 'the job carried something other than the drafted note');
    assert.deepStrictEqual(sent.blanks, EXPECTED_BLANKS,
      'the blanks sent to the surgeon are not the canonical ones. They must be exactly opNoteBlankTokens(note) — the parser the ' +
      'save gate uses — or the surgeon is asked to fill a different set of fields than the one that decides the note is finished.');
    checks++;
    ok(!('patient' in sent) && !('patientId' in sent) && !('dob' in sent),
      'the job body carries patient identity. The surgeon page is outside this practice; only the note text and the fields go.');

    /* THE LINK: minted after the job, shown once, gone on close */
    const mint = r.calls.filter((c) => /\/link$/.test(c.url));
    eq(mint.length, 1, 'the link was minted ' + mint.length + ' times');
    eq(mint[0].url, 'https://synthetic-backend.invalid/api/opnote-clients/oc_synthetic1/link', 'the link was minted for the wrong surgeon');
    ok(r.calls.indexOf(job[0]) < r.calls.indexOf(mint[0]), 'a link was minted before the op note existed');

    const shown = r.dialogHtml();
    eq((shown.match(new RegExp(LINK_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1,
      'the link is not rendered exactly once');
    ok(/Copy this now - it is not shown again\./.test(shown), 'the dialog does not warn that the link is shown once');
    ok(/readonly/.test(shown), 'the link sits in an editable field');
    eq(r.body.children.length, 1, 'more than one dialog is open at a time');

    /* the Copy control really copies */
    r.ctx.document.getElementById('opSurgeonLink').value = LINK_URL;
    r.ctx.opSurgeonCopy();
    assert.deepStrictEqual(r.copied, [LINK_URL], 'the Copy button did not put the link on the clipboard');
    checks++;

    /* and closing really removes it */
    r.ctx.opSurgeonClose();
    eq(r.body.children.length, 0, 'the dialog stayed in the document after it was closed');
    ok(r.dialogHtml().indexOf(LINK_URL) === -1, 'the link is still in the document after the dialog closed');
  }

  /* ---- a brand-new surgeon is created first, then handed the note --------- */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: '', tplId: null }],
      replies: happyReplies({
        '/api/opnote-clients POST': { status: 200, body: { client: { id: 'oc_new9', label: 'Okafor', createdAt: 3 } } },
        '/api/opnote-clients/oc_new9/link POST': { status: 200, body: { link: { url: LINK_URL, prefix: 'bbbbbbbb', expiresAt: 4 } } }
      })
    });
    await r.ctx.opPrepForSurgeon(0);
    r.ctx.document.getElementById('opSurgeonPick').value = 'oc_synthetic1';
    r.ctx.document.getElementById('opSurgeonName').value = 'Dr Ada Okafor';
    r.ctx.document.getElementById('opSurgeonPractice').value = 'Lakeside Surgical';
    r.ctx.document.getElementById('opSurgeonEmail').value = 'synthetic@invalid.test';
    await r.ctx.opSurgeonSend();

    const made = r.calls.filter((c) => /\/api\/opnote-clients$/.test(c.url) && c.init.method === 'POST');
    eq(made.length, 1, 'a typed-in surgeon was not created');
    assert.deepStrictEqual(JSON.parse(made[0].init.body), { name: 'Dr Ada Okafor', practice: 'Lakeside Surgical', email: 'synthetic@invalid.test' },
      'the new surgeon was created with the wrong details');
    checks++;
    const sent = JSON.parse(r.calls.filter((c) => /\/api\/opnote-jobs$/.test(c.url))[0].init.body);
    eq(sent.clientId, 'oc_new9', 'the op note went to the surgeon that was picked, not the one that was just typed in');
    eq(sent.title, 'Op note', 'a card with no procedure text lost its title entirely');
    eq(sent.templateId, null, 'a card with no template sent something other than nothing');
    ok(/mlsscribe\.com\/opnotes\.html#k=/.test(r.dialogHtml()), 'the new surgeon was not given a link');
  }

  /* ---- nobody picked ----------------------------------------------------- */
  {
    const r = runtime({ rows: [{ note: DRAFT, proc: 'Knee scope' }], replies: { '/api/opnote-clients GET': { status: 200, body: { clients: [] } } } });
    await r.ctx.opPrepForSurgeon(0);
    await r.ctx.opSurgeonSend();
    eq(r.calls.filter((c) => /\/api\/opnote-jobs$/.test(c.url)).length, 0, 'an op note was posted with no surgeon to send it to');
    eq(r.ctx.document.getElementById('opSurgeonMsg').textContent, 'Pick a surgeon, or type a name to add one.',
      'a hand-over with nobody chosen failed silently');
  }

  /* ---- the server refuses the job: no link is minted, and it says so ------ */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Knee scope' }],
      replies: happyReplies({ '/api/opnote-jobs POST': { status: 500, body: { error: { code: 'OPNOTE_JOB_FAILED', message: 'internal' } } } })
    });
    await r.ctx.opPrepForSurgeon(0);
    r.ctx.document.getElementById('opSurgeonPick').value = 'oc_synthetic1';
    await r.ctx.opSurgeonSend();
    eq(r.calls.filter((c) => /\/link$/.test(c.url)).length, 0, 'a link was minted for an op note the server refused');
    eq(r.ctx.document.getElementById('opSurgeonMsg').textContent, 'That did not go through. Try again in a moment.',
      'a refused hand-over did not say anything a person can act on');
    ok(r.dialogHtml().indexOf('internal') === -1, 'the server\'s own words were echoed into the dialog');
  }

  console.log('PASS prepare for a surgeon: ' + checks + ' checks — three placeholders yield exactly three canonical blanks, ' +
    'the job payload is the agreed shape with no patient identity, and the link is shown once and removed on close');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
