'use strict';
/* =============================================================================
   THE CLIENT-SURGEON OP-NOTE PAGE, BOOTED  (lane opnote-svc-1.0.0, 2026-09-11)

   opnotes.html is the whole product for an outside surgeon: their own drafted
   op notes, the few fields only they can supply, and the templates those notes
   are written from. Nothing else of the clinical app is reachable from it.

   This suite BOOTS the real page's inline script against a controlled DOM and a
   stubbed network — it never asserts on a string in the file and calls that a
   behaviour. Four things are proved:

     1. A LINK THAT IS NOT GOOD SHOWS ONE SENTENCE AND NOTHING ELSE.
        Not "mostly nothing": the job list, the editor and the upload area are
        measured as never written. A page that renders its furniture and then
        hides it is a page that fetched and painted a stranger's work first.
        Both shapes are driven — a malformed link (refused with ZERO requests)
        and a well-formed one the server refuses (401).

     2. THE ORDINARY WALK WORKS. List -> open -> fill the blanks -> Save ->
        Mark done, with the exact request bodies asserted, not just "a request
        happened". The save carries expectedVersion, and a 409 produces the one
        sentence that tells a surgeon what to do about it.

     3. A TEMPLATE UPLOAD POSTS name + text. The .docx path runs through the
        page's own extraction; a PDF or a photo is refused with advice instead
        of a failure.

     4. NO JARGON REACHES THE SURGEON. The word scan runs over BOTH the static
        visible copy and every sentence this walk actually painted at runtime —
        which is the only way to see the copy that lives inside the script.

   No network, no patient data, no browser. Every fixture is synthetic.
   ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const PAGE = 'opnotes.html';
const html = fs.readFileSync(path.join(root, PAGE), 'utf8');

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* The page's own inline script, lifted whole. */
const inline = (function () {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, body = null;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    assert(body === null, 'opnotes.html must carry exactly ONE inline script');
    body = m[2];
  }
  assert(body && body.trim(), 'opnotes.html inline script not found');
  return body;
})();

const GOOD = 'a'.repeat(64);

/* -------------------------------------------------------------------------
   A deliberately small DOM. The page reaches for getElementById and writes
   className / textContent / innerHTML / value, so that is exactly what exists
   here — anything the page reached for that is not modelled throws instead of
   silently returning undefined and passing.
   ------------------------------------------------------------------------- */
function makeDom() {
  const nodes = new Map();
  const painted = [];
  function node(id) {
    const n = {
      id: id,
      _className: '',
      _textContent: '',
      _innerHTML: '',
      value: '',
      files: null,
      clicked: 0,
      click() { this.clicked++; }
    };
    Object.defineProperty(n, 'className', {
      get() { return n._className; },
      set(v) { n._className = String(v); }
    });
    Object.defineProperty(n, 'textContent', {
      get() { return n._textContent; },
      set(v) { n._textContent = String(v); painted.push(String(v)); }
    });
    Object.defineProperty(n, 'innerHTML', {
      get() { return n._innerHTML; },
      set(v) { n._innerHTML = String(v); painted.push(String(v)); }
    });
    return n;
  }
  return {
    painted,
    el(id) { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); },
    document: {
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); }
    }
  };
}

function boot(options) {
  const opts = options || {};
  const dom = makeDom();
  const calls = [];
  const replies = opts.replies || {};
  const window = {
    __mlsSensitiveUrl: Object.freeze({
      query: Object.freeze({}),
      fragment: Object.freeze(Object.prototype.hasOwnProperty.call(opts, 'k') ? { k: opts.k } : {})
    }),
    mammoth: opts.mammoth || null,
    mlsSensitiveFetch(url, init) {
      calls.push({ url: String(url), init: init || {} });
      const key = String(url).replace('https://scrivara-backend.onrender.com', '') + ' ' + String((init || {}).method || 'GET');
      const reply = Object.prototype.hasOwnProperty.call(replies, key) ? replies[key] : { status: 404, body: {} };
      if (typeof reply === 'function') return Promise.resolve(reply(init || {}));
      return Promise.resolve({
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json() { return Promise.resolve(reply.body || {}); }
      });
    }
  };
  const ctx = {
    window,
    document: dom.document,
    console, JSON, Object, String, Number, Boolean, Math, RegExp, Error, Promise, Array,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(inline, ctx, { filename: 'opnotes.html#inline' });
  return { ctx, dom, calls, window };
}

const DEAD = 'This link is no longer active. Ask for a new one.';

/* =========================================================================
   1. A LINK THAT IS NOT GOOD — ONE SENTENCE, NOTHING ELSE
   ======================================================================= */
async function refusedLink(label, bootOptions, expectedCalls) {
  const run = boot(bootOptions);
  await run.ctx.window.opnReady;
  eq(run.dom.el('gate').textContent, DEAD, label + ': the page did not say the one plain sentence');
  ok(!/\bhide\b/.test(run.dom.el('gate').className), label + ': the sentence is not visible');
  ok(/\bhide\b/.test(run.dom.el('app').className), label + ': the page kept its own furniture on screen');
  eq(run.dom.el('list').innerHTML, '', label + ': a job list was painted for a link that is not good');
  eq(run.dom.el('jobCard').innerHTML, '', label + ': an op-note editor was painted for a link that is not good');
  eq(run.dom.el('tplList').innerHTML, '', label + ': the template area was painted for a link that is not good');
  eq(run.dom.el('hdr').textContent, '', label + ': a surgeon name was painted for a link that is not good');
  eq(run.calls.length, expectedCalls, label + ': wrong number of requests (' + run.calls.length + ')');
  return run;
}

(async function suite() {
  /* a. no link at all */
  await refusedLink('missing link', {}, 0);
  /* b. a malformed one — refused with ZERO requests, so a guessed value never
        even reaches the server to be counted against a rate limit */
  await refusedLink('malformed link', { k: 'not-a-real-value' }, 0);
  /* c. a WELL-FORMED one the server refuses: expired, revoked, unknown — all
        three are the same sentence to a surgeon, and none of them leaks which */
  for (const status of [401, 403, 404]) {
    await refusedLink('refused link (' + status + ')', {
      k: GOOD,
      replies: { '/api/client/opnotes/session GET': { status: status, body: { error: { code: 'OPNOTE_LINK_EXPIRED' } } } }
    }, 1);
  }
  /* d. CAUSAL CONTROL: the same page, same shape of link, a server that says
        yes — if this did not paint, the assertions above would be measuring a
        page that never works rather than a page that refuses. */
  {
    const run = boot({
      k: GOOD,
      replies: { '/api/client/opnotes/session GET': { status: 200, body: { client: { name: 'Dr Sam Rivera', practice: 'Northside Orthopaedics' } } } }
    });
    await run.ctx.window.opnReady;
    eq(run.dom.el('hdr').textContent, 'Op notes for Dr Sam Rivera', 'control: a good link did not paint the surgeon name');
    ok(!/\bhide\b/.test(run.dom.el('app').className), 'control: a good link left the page hidden');
  }

  /* =======================================================================
     2. THE ORDINARY WALK
     ===================================================================== */
  const JOB = {
    id: 'oj_synthetic1',
    title: 'Right knee arthroscopy',
    status: 'draft',
    version: 4,
    noteText: 'PROCEDURE: Right knee arthroscopy.\nESTIMATED BLOOD LOSS: [ESTIMATED BLOOD LOSS]\nIMPLANT: [[graft_size]]',
    blanks: [
      { key: 'estimated_blood_loss', label: 'ESTIMATED BLOOD LOSS', value: '' },
      { key: 'graft_size', label: 'Graft Size', value: '' },
      { key: 'implant_lot', label: 'implant lot', value: '' }
    ]
  };
  const saveBodies = [];
  const completeBodies = [];
  const templateBodies = [];
  const happyReplies = {
    '/api/client/opnotes/session GET': { status: 200, body: { client: { name: 'Dr Sam Rivera', practice: 'Northside Orthopaedics' } } },
    '/api/client/opnotes/jobs GET': {
      status: 200,
      body: {
        jobs: [
          { id: 'oj_synthetic1', title: 'Right knee arthroscopy', status: 'draft', blankCount: 3, filledCount: 0, updatedAt: 2 },
          { id: 'oj_synthetic2', title: 'Left shoulder decompression', status: 'completed', blankCount: 2, filledCount: 2, updatedAt: 1 }
        ]
      }
    },
    '/api/client/opnotes/templates GET': { status: 200, body: { templates: [{ id: 'ot_1', name: 'Knee scope', charCount: 900, version: 1, updatedAt: 1 }] } },
    '/api/client/opnotes/jobs/oj_synthetic1 GET': { status: 200, body: { job: JOB } },
    '/api/client/opnotes/jobs/oj_synthetic1/save POST': (init) => {
      saveBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: () => Promise.resolve({ job: { version: 5, filledCount: 2, updatedAt: 9 } }) };
    },
    '/api/client/opnotes/jobs/oj_synthetic1/complete POST': (init) => {
      completeBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: () => Promise.resolve({ job: { status: 'completed', completedAt: 10 } }) };
    },
    '/api/client/opnotes/templates POST': (init) => {
      templateBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: () => Promise.resolve({ templates: [{ id: 'ot_2', name: 'Knee scope', charCount: 12, version: 2, updatedAt: 11 }] }) };
    }
  };

  const run = boot({
    k: GOOD,
    replies: happyReplies,
    mammoth: { extractRawText: () => Promise.resolve({ value: '  PROCEDURE:  right knee   arthroscopy \n\n\n\n TEMPLATE BODY ' }) }
  });
  await run.ctx.window.opnReady;

  /* the list, newest first, each row saying what it needs */
  const list = run.dom.el('list').innerHTML;
  ok(/Right knee arthroscopy/.test(list), 'the list did not name the op note');
  ok(/Needs you: 3 to fill/.test(list), 'the list did not say how many fields are left: ' + list.slice(0, 200));
  ok(/Left shoulder decompression/.test(list), 'a finished op note vanished from the list');
  ok(/>Done</.test(list), 'a finished op note is not shown as done');
  ok(list.indexOf('Right knee arthroscopy') < list.indexOf('Left shoulder decompression'), 'the list reordered what the server sent');

  /* the templates the notes are written from */
  ok(/Knee scope/.test(run.dom.el('tplList').innerHTML), 'the surgeon cannot see their own templates');

  /* open it */
  await run.ctx.opnOpenJob('oj_synthetic1');
  const card = run.dom.el('jobCard').innerHTML;
  ok(/Fill these in/.test(card), 'the blanks are not introduced');
  ok(/ESTIMATED BLOOD LOSS/.test(card), 'a blank label the draft could not fill is missing');
  ok(/id="opnB_estimated_blood_loss"/.test(card), 'a blank has no field of its own');
  ok(/id="opnB_graft_size"/.test(card) && /id="opnB_implant_lot"/.test(card), 'not every blank got a field');
  ok(/Type what you used\. Anything you leave empty stays as it is in the note\./.test(card), 'the blanks hint drifted');
  ok(/The note/.test(card) && /You can change any of this\./.test(card), 'the editor is not introduced as changeable');
  ok(/id="opnNote"/.test(card), 'there is no editor');
  ok(/PROCEDURE: Right knee arthroscopy/.test(card), 'the drafted note is not in the editor');
  ok(!/\bhide\b/.test(run.dom.el('jobCard').className), 'the op note opened hidden');

  /* fill two of the three and change a line of the note */
  run.dom.el('opnB_estimated_blood_loss').value = 'Minimal';
  run.dom.el('opnB_graft_size').value = '9 mm';
  run.dom.el('opnNote').value = 'PROCEDURE: Right knee arthroscopy.\nESTIMATED BLOOD LOSS: Minimal\nIMPLANT: 9 mm';

  await run.ctx.opnSaveJob();
  eq(saveBodies.length, 1, 'Save did not reach the server exactly once');
  eq(saveBodies[0].expectedVersion, 4, 'Save did not carry the version it opened — a silent overwrite');
  eq(saveBodies[0].noteText, 'PROCEDURE: Right knee arthroscopy.\nESTIMATED BLOOD LOSS: Minimal\nIMPLANT: 9 mm', 'Save sent something other than what is on screen');
  assert.deepStrictEqual(saveBodies[0].blanks, [
    { key: 'estimated_blood_loss', value: 'Minimal' },
    { key: 'graft_size', value: '9 mm' },
    { key: 'implant_lot', value: '' }
  ], 'Save sent the wrong blanks. An empty one must still be sent by key, so the server never has to guess which field a value belongs to.');
  checks++;
  eq(run.dom.el('jobMsg').textContent, 'Saved.', 'Save said something other than "Saved."');
  ok(/Needs you: 1 to fill/.test(run.dom.el('list').innerHTML), 'the list did not reflect what was just filled in');

  /* the second save carries the version the FIRST one returned */
  await run.ctx.opnSaveJob();
  eq(saveBodies[1].expectedVersion, 5, 'a second Save re-sent the stale version');

  await run.ctx.opnCompleteJob();
  eq(completeBodies.length, 1, 'Mark done did not reach the server');
  eq(completeBodies[0].expectedVersion, 5, 'Mark done did not carry the current version');
  eq(run.dom.el('jobMsg').textContent, 'Done. Nothing else to do.', 'the finish line drifted');
  ok(/>Done</.test(run.dom.el('list').innerHTML), 'a finished op note still asks to be filled in');

  /* somebody else got there first */
  {
    const conflict = boot({
      k: GOOD,
      replies: Object.assign({}, happyReplies, {
        '/api/client/opnotes/jobs/oj_synthetic1/save POST': { status: 409, body: { error: { code: 'OPNOTE_VERSION_CONFLICT' } } }
      })
    });
    await conflict.ctx.window.opnReady;
    await conflict.ctx.opnOpenJob('oj_synthetic1');
    await conflict.ctx.opnSaveJob();
    eq(conflict.dom.el('jobMsg').textContent, 'Someone else changed this note. Reload the page to see the newest one.',
      'a version conflict did not tell the surgeon what to do about it');
  }

  /* a link revoked mid-session falls back to the same one sentence */
  {
    const revoked = boot({
      k: GOOD,
      replies: Object.assign({}, happyReplies, {
        '/api/client/opnotes/jobs/oj_synthetic1/save POST': { status: 401, body: { error: { code: 'OPNOTE_LINK_REVOKED' } } }
      })
    });
    await revoked.ctx.window.opnReady;
    await revoked.ctx.opnOpenJob('oj_synthetic1');
    await revoked.ctx.opnSaveJob();
    eq(revoked.dom.el('gate').textContent, DEAD, 'a link revoked while the page was open did not close the page');
    ok(/\bhide\b/.test(revoked.dom.el('app').className), 'a revoked link left the op notes on screen');
  }

  /* a page with nothing waiting */
  {
    const empty = boot({
      k: GOOD,
      replies: Object.assign({}, happyReplies, { '/api/client/opnotes/jobs GET': { status: 200, body: { jobs: [] } } })
    });
    await empty.ctx.window.opnReady;
    ok(/Nothing waiting for you right now\./.test(empty.dom.el('list').innerHTML), 'an empty list says nothing at all');
  }

  /* =======================================================================
     3. TEMPLATES
     ===================================================================== */
  const fileEl = run.dom.el('tplFile');
  fileEl.files = [{
    name: 'Knee scope.docx',
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    text: () => Promise.resolve('')
  }];
  await run.ctx.opnReadTemplateFile(fileEl.files[0]);
  eq(templateBodies.length, 1, 'a Word template did not reach the server');
  eq(templateBodies[0].name, 'Knee scope', 'the template was not named after the file the surgeon chose');
  /* exactly what the clinical app's own _cleanExtractedText does: runs of three
     or more spaces collapse to two, runs of three or more newlines collapse to
     two, and the whole thing is trimmed — nothing more. Asserted verbatim so a
     "tidier" cleaner here could not quietly start editing a surgeon's template. */
  eq(templateBodies[0].text, 'PROCEDURE:  right knee  arthroscopy \n\n TEMPLATE BODY',
    'the Word text was sent raw — the page must run it through the same cleaning the clinical app uses');
  eq(run.dom.el('tplMsg').textContent, 'Template saved.', 'a saved template said something else');

  /* a plain text file takes the other branch of the same reader */
  await run.ctx.opnReadTemplateFile({ name: 'shoulder.txt', text: () => Promise.resolve('SHOULDER TEMPLATE\n\n\n\nCLOSURE') });
  eq(templateBodies.length, 2, 'a .txt template did not reach the server');
  eq(templateBodies[1].text, 'SHOULDER TEMPLATE\n\nCLOSURE', 'the text file was not cleaned the same way');

  /* a scan is refused with advice, and NOTHING is sent */
  await run.ctx.opnReadTemplateFile({ name: 'scan.pdf', text: () => Promise.resolve('%PDF') });
  eq(templateBodies.length, 2, 'a PDF was uploaded as if it were readable template text');
  eq(run.dom.el('tplMsg').textContent, 'Save it as a Word file or paste the text instead.', 'a PDF refusal did not say what to do instead');
  await run.ctx.opnReadTemplateFile({ name: 'photo.jpg', text: () => Promise.resolve('') });
  eq(templateBodies.length, 2, 'a photo was uploaded as if it were readable template text');

  /* the paste path, which is what that refusal points at */
  run.dom.el('tplName').value = 'Pasted shoulder';
  run.dom.el('tplPaste').value = 'SHOULDER TEMPLATE BODY';
  await run.ctx.opnSavePastedTemplate();
  eq(templateBodies.length, 3, 'pasted template text did not reach the server');
  eq(templateBodies[2].name, 'Pasted shoulder', 'the pasted template lost its name');
  eq(templateBodies[2].text, 'SHOULDER TEMPLATE BODY', 'the pasted template lost its text');
  eq(run.dom.el('tplName').value, '', 'the name field was not cleared after saving');

  /* the button the surgeon actually presses opens the file chooser */
  run.ctx.opnPickTemplate();
  eq(run.dom.el('tplFile').clicked, 1, 'the "Add or replace a template" button opens nothing');

  /* =======================================================================
     4. NO JARGON REACHES THE SURGEON
     Static copy AND every sentence this walk actually painted.
     ===================================================================== */
  const BANNED = /\b(?:tokens?|APIs?|endpoints?|JSON|sessions?|backend|sync|payloads?|placeholders?)\b|error code/i;
  function strip(s) {
    return String(s)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ');
  }
  const visibleAttrs = [];
  for (const m of html.matchAll(/\s(?:title|aria-label|alt|placeholder)\s*=\s*"([^"]*)"/gi)) visibleAttrs.push(m[1]);
  const surfaces = [strip(html), visibleAttrs.join(' ')].concat(run.dom.painted.map(strip));
  const hits = [];
  for (const surface of surfaces) {
    const hit = BANNED.exec(surface);
    if (hit) hits.push(hit[0] + ' in: ' + surface.replace(/\s+/g, ' ').trim().slice(0, 120));
  }
  assert.deepStrictEqual(hits, [], 'developer words reached the surgeon:\n  ' + hits.join('\n  '));
  checks++;
  ok(run.dom.painted.length > 10, 'the word scan ran against almost nothing painted — it would pass on a dead page');

  /* the page really is op notes only */
  const visible = strip(html).replace(/\s+/g, ' ');
  for (const absent of ['Patients', 'Visit', 'Schedule', 'Settings', 'Sign in', 'Log in', 'Athena']) {
    ok(visible.indexOf(absent) === -1, 'the page offers "' + absent + '", which belongs to the clinical app and not here');
  }

  console.log('PASS opnotes client page: ' + checks + ' checks — a link that is not good shows one sentence and nothing else, ' +
    'the fill/save/done walk carries its version, templates upload and paste, and no developer words reach the surgeon');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
