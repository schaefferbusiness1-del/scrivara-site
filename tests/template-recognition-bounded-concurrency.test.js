'use strict';

/* b890 — template recognition used to send every /api/templates/split chunk
   STRICTLY SERIALLY. A 90-file op-note batch in which many files look
   multi-form is 90+ sequential AI round-trips, so the doctor watched a
   truthful progress bar crawl for minutes.

   Concurrency is only safe here if it changes the SPEED and nothing else, so
   this suite runs the real ScribeFlow recognition functions against a scripted
   backend and pins the four properties that a naive parallel rewrite breaks:

     1. requests really do overlap, and never exceed the declared limit;
     2. the reviewed list is in FILE order even when later files answer first
        (row order feeds the first-wins dedupe and the checkbox indices);
     3. the progress counts tick on COMPLETION, not on dispatch — "42/90" has
        to mean 42 files finished;
     4. the never-dead-end laws survive: a 403 and an empty AI answer both
        still land every uploaded file as a reviewable row. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* Pull a top-level function out of the page by brace matching, so the suite
   exercises the SHIPPED source rather than a paraphrase of it. */
function fn(name) {
  const decl = new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm');
  const at = html.search(decl);
  assert(at >= 0, 'ScribeFlow.html must still declare ' + name);
  let i = html.indexOf('{', at);
  let depth = 0;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces extracting ' + name);
}

function decl(pattern, label) {
  const m = html.match(pattern);
  assert(m, 'ScribeFlow.html must still declare ' + label);
  return m[0];
}

const AI_LIMIT = Number((html.match(/var\s+_TPL_AI_LIMIT\s*=\s*(\d+)/) || [])[1]);
assert(AI_LIMIT >= 2 && AI_LIMIT <= 8, '_TPL_AI_LIMIT must be a small bounded number, got ' + AI_LIMIT);

const SOURCE = [
  decl(/var _tplPendingSplit=\[\];/, '_tplPendingSplit'),
  decl(/var _tplUnreadableRows=\[\];/, '_tplUnreadableRows'),
  decl(/var _TPL_AI_LIMIT=\d+;/, '_TPL_AI_LIMIT'),
  decl(/var _tplAiInFlight=[^\n]*;/, 'the pool state'),
  fn('_tplAppendUnreadableRows'),
  fn('_tplMultiStatus'),
  fn('_tplFormHeaderCount'),
  fn('_looksMultiForm'),
  fn('_tplParseMeta'),
  fn('_tplTypeName'),
  fn('_tplSeedKeywords'),
  fn('_tplChunk'),
  fn('_tplDedupeTemplatesInfo'),
  fn('_tplDedupeTemplates'),
  fn('_tplAiSlot'),
  fn('_tplAiRelease'),
  fn('_tplPool'),
  fn('_tplSplitChunk'),
  fn('_tplFoundSoFar'),
  fn('_tplSplitOneInto'),
  fn('_tplPerFileFallback'),
  fn('tplMultiFile'),
  fn('tplAiSplit'),
].join('\n');

/* `responder(text, callIndex)` returns { status, templates, after } — `after`
   is how many event-loop turns the answer is held for, which is how a later
   request is made to finish FIRST. */
function harness(responder) {
  const el = () => ({ innerHTML: '', textContent: '', style: {} });
  const nodes = { tplMultiResult: el(), tplMultiStatus: el() };
  const calls = [];
  const ticks = [];
  let inFlight = 0;
  let maxInFlight = 0;
  let resolved = 0;

  const ctx = {
    console, Math, Date, JSON, Promise, String, Number, Array, Object, RegExp, setTimeout,
    document: { getElementById: id => nodes[id] || null },
    backendMode: () => true,
    bkToken: () => 'token',
    bkBase: () => 'https://api.test',
    _tplReadAnyFile: async file => file.__text,
    _renderTplSplitPreview() {},
    async fetch(url, init) {
      const text = JSON.parse(init.body).text;
      const ix = calls.length;
      calls.push({ url, text });
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      const plan = responder(text, ix) || {};
      for (let t = 0; t < (plan.after || 0); t++) await Promise.resolve();
      await new Promise(r => setTimeout(r, plan.delay || 0));
      inFlight--;
      resolved++;
      const status = plan.status || 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return { templates: plan.templates || [] }; },
      };
    },
  };
  ctx.window = ctx;
  ctx._tplPhaseTick = (kind, done, total, label, found) => {
    ticks.push({ kind, done, total, label, found, resolvedSoFar: resolved });
  };
  vm.createContext(ctx);
  new vm.Script(SOURCE, { filename: 'ScribeFlow.tpl.js' }).runInContext(ctx);

  return {
    ctx, calls, ticks, nodes,
    get maxInFlight() { return maxInFlight; },
    upload: files => ctx.tplMultiFile({ target: { files, value: '' } }),
  };
}

/* A file long enough and header-dense enough that _looksMultiForm sends it to
   the AI splitter — that is the path the 90-file batch actually took. */
function multiFormFile(i) {
  const body = ('Operative Report\nPatient Name: Case ' + i + '\n' +
    'Date of Procedure: 2026-08-05\n' + 'clinical narrative text '.repeat(60) + '\n\n')
    .repeat(3);
  assert(body.length > 4000, 'fixture must exceed the multi-form length gate');
  return { name: 'note-' + i + '.txt', __text: body, __ix: i };
}

async function run(label, body) {
  try {
    await body();
    console.log('  ok  ' + label);
  } catch (error) {
    console.error('  FAIL  ' + label);
    throw error;
  }
}

(async () => {
  console.log('template recognition: bounded concurrency');

  await run('requests overlap and never exceed _TPL_AI_LIMIT', async () => {
    const files = Array.from({ length: 12 }, (_, i) => multiFormFile(i));
    const h = harness(() => ({ after: 3, templates: [{ name: 'T', text: 'body' }] }));
    await h.upload(files);
    assert.strictEqual(h.calls.length, 12, 'every file must still reach the splitter once');
    assert(h.maxInFlight > 1, 'recognition is still serial — no two requests ever overlapped');
    assert.strictEqual(h.maxInFlight, AI_LIMIT,
      'the pool must saturate to exactly _TPL_AI_LIMIT, saw ' + h.maxInFlight);
  });

  await run('review order is FILE order even when later files answer first', async () => {
    const files = Array.from({ length: 8 }, (_, i) => multiFormFile(i));
    /* Answer in reverse: the LAST file's request resolves immediately, the
       first is held longest. Completion order is the exact inverse of input
       order, so any completion-ordered accumulator fails here. */
    const h = harness(text => {
      const ix = Number((text.match(/Case (\d+)/) || [])[1]);
      return { after: (8 - ix) * 2, templates: [{ name: 'Case ' + ix, text: 'PROCEDURE: Case ' + ix + ' body' }] };
    });
    await h.upload(files);
    /* .join keeps the comparison inside one realm — arrays built in the vm do
       not share this file's Array.prototype, so deepStrictEqual rejects a
       perfectly good match. */
    const order = h.ctx._tplPendingSplit.map(t => Number((t.text.match(/Case (\d+)/) || [])[1])).join(',');
    assert.strictEqual(order, '0,1,2,3,4,5,6,7', 'rows must be in file order, got ' + order);
  });

  await run('chunk order within one file survives out-of-order answers', async () => {
    /* One long file on the 1-2 file path. The parts are separated by form
       feeds so _tplChunk lands exactly one marker per chunk — a bare blob is
       hard-split at 6000 chars and would straddle them. */
    const one = { name: 'big.txt', __text: Array.from({ length: 4 }, (_, c) => 'PART' + c + ' ' + 'x'.repeat(5000)).join('\f') };
    const h = harness(text => {
      const c = Number((text.match(/PART(\d)/) || [])[1]);
      return { after: (4 - c) * 2, templates: [{ name: 'p' + c, text: 'PART' + c + ' recovered' }] };
    });
    await h.upload([one]);
    const order = h.ctx._tplPendingSplit.map(t => Number((t.text.match(/PART(\d)/) || [])[1])).join(',');
    assert.strictEqual(order, '0,1,2,3', 'chunk rows must stay in chunk order, got ' + order);
  });

  await run('progress counts tick on completion, never on dispatch', async () => {
    const files = Array.from({ length: 10 }, (_, i) => multiFormFile(i));
    /* Distinct rows, so the first-wins dedupe cannot shrink the final list and
       muddy the comparison between "found so far" and what was delivered. */
    const h = harness((text, ix) => ({ after: 2, templates: [{ name: 'T' + ix, text: 'PROCEDURE: Case ' + ix }] }));
    await h.upload(files);
    const delivered = h.ctx._tplPendingSplit.length;
    assert.strictEqual(delivered, 10, 'fixture should deliver ten distinct rows, got ' + delivered);
    const recognize = h.ticks.filter(t => t.kind === 'recognize');
    assert(recognize.length, 'the recognition bar must still be driven');
    let prevDone = -1;
    let prevFound = -1;
    recognize.forEach(t => {
      assert.strictEqual(t.total, 10, 'total must stay the file count, saw ' + t.total);
      assert(t.done >= prevDone, 'count went backwards: ' + prevDone + ' -> ' + t.done);
      assert(t.done <= t.total, 'count overran the total: ' + t.done + '/' + t.total);
      /* The load-bearing one: a count may never claim more files finished than
         the backend has actually answered. Dispatch-time ticks fail here. */
      assert(t.done <= t.resolvedSoFar,
        'claimed ' + t.done + ' done with only ' + t.resolvedSoFar + ' answers back');
      assert(t.found >= prevFound, 'found-so-far went backwards: ' + prevFound + ' -> ' + t.found);
      assert(t.found <= delivered, 'found-so-far overstated the result: ' + t.found + ' > ' + delivered);
      /* Every finished file owes at least one row — that is b889's law, and it
         means the found count can never lag the file count either. */
      assert(t.found >= t.done, 'reported ' + t.done + ' files done but only ' + t.found + ' templates');
      prevDone = t.done;
      prevFound = t.found;
    });
    const last = recognize[recognize.length - 1];
    assert.strictEqual(last.done, 10, 'the bar must finish at N/N');
    assert.strictEqual(last.found, 10, 'the final found count must match what was delivered');
  });

  await run('403 keeps every file and stops asking', async () => {
    const files = Array.from({ length: 10 }, (_, i) => multiFormFile(i));
    const h = harness(() => ({ status: 403, after: 1 }));
    await h.upload(files);
    assert.strictEqual(h.ctx._tplPendingSplit.length, 10,
      'an AI-unavailable account must still get one reviewable row per file');
    assert(h.calls.length <= AI_LIMIT,
      'the 403 latch must spare the rest of the batch; saw ' + h.calls.length + ' refusals');
  });

  await run('an empty AI answer keeps each file whole', async () => {
    const files = Array.from({ length: 6 }, (_, i) => multiFormFile(i));
    const h = harness(() => ({ templates: [] }));
    await h.upload(files);
    assert.strictEqual(h.ctx._tplPendingSplit.length, 6,
      'files the AI found nothing in must be kept, not dropped');
  });

  await run('a thrown request never loses its file', async () => {
    const files = Array.from({ length: 5 }, (_, i) => multiFormFile(i));
    const h = harness(() => { throw new Error('network down'); });
    await h.upload(files);
    assert.strictEqual(h.ctx._tplPendingSplit.length, 5,
      'a failed round-trip must fall back to the whole file, got ' + h.ctx._tplPendingSplit.length);
  });

  await run('the pool releases every slot it takes', async () => {
    const files = Array.from({ length: 9 }, (_, i) => multiFormFile(i));
    const h = harness((text, ix) => (ix % 3 === 0
      ? (() => { throw new Error('boom'); })()
      : { after: 1, templates: [{ name: 'T', text: 'body' }] }));
    await h.upload(files);
    assert.strictEqual(h.ctx._tplAiInFlight, 0,
      'slots leaked: ' + h.ctx._tplAiInFlight + ' still held after the run');
    assert.strictEqual(h.ctx._tplAiWaiters.length, 0, 'the wait queue must drain');
  });

  console.log('template recognition: bounded concurrency — all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
