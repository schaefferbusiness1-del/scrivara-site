'use strict';

/* retryvis-1.0.0 - THE RETRY CONTROL IS ON SCREEN WHENEVER THE CARD'S OWN
 * COPY TELLS THE DOCTOR TO PRESS IT. Plain node: no Athena account, no
 * backend, no browser, no PHI. Everything below EXECUTES the shipped
 * pCounts() and READS the shipped copy table - nothing here reimplements
 * either of them.
 *
 * MEASURED LIVE (2026-09-02 05:1x, the owner's tab, the durable August month
 * pull in Staff prep): the month card's status line read
 *
 *   "Finished, with days that still need attention - press Retry.
 *    27 of 31 days saved · 4 need attention."
 *
 * while #ez3PullRetry computed display:none. The only buttons on screen were
 * "Start month pull" and "Pull today only". Pressing the hidden button
 * through the DOM re-armed the four needs-attention days and re-read them, so
 * the handler was right and only the visibility was wrong.
 *
 * WHICH RULE WAS ACTUALLY WRONG. Cancel was absent too, and the card's
 * durable-control branch shows Cancel for ANY resumable job - so that branch
 * never ran. pCounts opens with a no-in-tab-pull early return that painted
 * the four tiles from the saved manifest and returned BEFORE reaching a
 * single control. That is exactly the reloaded-tab case: a job that settled
 * while the tab was away has no in-tab P to adopt it. retryvis-1.0.0 paints
 * the one control the sentence names in that branch too, from the SAVED
 * manifest, and leaves Start where it was.
 *
 * TWO CLAIMS IN THE BRIEF THAT DO NOT HOLD, PINNED HERE SO NOBODY RE-DERIVES
 * THEM:
 *  (i)  "P.failedDays counts failed/retry days only, never needs-attention
 *       days" - p1RangeSyncP maps BOTH 'retry' and 'needs-attention' to
 *       'failed' and pushes both into P.failedDays. Asserted below.
 *  (ii) The three `(!P.running && P.failedDays.length)` sites at ~30938 /
 *       ~32922 / ~34510 are inside RETIRED historical Easy owners whose IIFE
 *       body opens with an unconditional `return;`. The file says so in those
 *       words - "SUPERSEDED - DEAD CODE ... Fix those, never these." They are
 *       pinned dead here rather than edited.
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const CONNECT = fs.readFileSync('1p-mls-connect.js', 'utf8');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];

let checks = 0;
function ok(cond, message) { checks++; assert.ok(cond, message); }
function eq(actual, expected, message) { checks++; assert.strictEqual(actual, expected, message); }

/* ---- the day-note-proof / attention-days-proof brace walker ---------------
   Comments are recognised BEFORE quotes: these blocks are documented in prose
   full of apostrophes, and opening quote-mode inside a comment desyncs the
   walker and truncates the slice. */
function balanced(source, signature, label) {
  const start = source.indexOf(signature);
  assert(start >= 0, 'slice not found: ' + (label || signature));
  let depth = 0, quote = '', i = source.indexOf('{', start);
  assert(i > start, 'slice has no body: ' + (label || signature));
  for (; i < source.length; i++) {
    const ch = source[i], prev = source[i - 1];
    if (quote) { if (ch === quote && prev !== '\\') quote = ''; continue; }
    if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i) + 1; continue; }
    if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated slice: ' + (label || signature));
}

/* =======================================================================
 * PART A - the shipped card, executed.
 *
 * The REAL pCounts() and pTile() run against a DOM stub. The stubs answer
 * exactly what the shipped code asks of the page and nothing more, so a
 * control that appears here appeared because the shipped rule said so.
 * ===================================================================== */
const pTileSrc = balanced(CONNECT, 'function pTile(id, val, label)', 'pTile');
const pCountsSrc = balanced(CONNECT, 'function pCounts()', 'pCounts');

const BUTTONS = ['ez3PullStart', 'ez3PullResume', 'ez3PullPause', 'ez3PullRetry', 'ez3PullCancel'];

function card(options) {
  const manifest = options.manifest || null;
  const P = Object.prototype.hasOwnProperty.call(options, 'P') ? options.P : null;
  const cardMonth = options.cardMonth || '';
  const els = {}, spans = {}, texts = {};
  ['ez3cFound', 'ez3cSaved', 'ez3cDup', 'ez3cFail'].forEach((id) => {
    spans[id] = { textContent: '' };
    els[id] = { textContent: '', parentNode: { querySelector() { return spans[id]; } } };
  });
  BUTTONS.forEach((id) => { els[id] = { style: { display: 'none' }, disabled: false, textContent: '↻ Retry failed days' }; });
  els.ez3sMonth = { value: cardMonth };
  els.ez3PullBar = { style: { width: '' } };
  const ctx = vm.createContext({
    P, String, Math, Object, Number, Array, RegExp,
    $: (id) => els[id] || null,
    pSet: (id, txt) => { texts[id] = txt; if (els[id]) els[id].textContent = txt; },
    p1RangeState: () => manifest,
    p1RangeRunning: (st) => !!st && (st.status === 'running' || st.status === 'pending'),
    p1RangeResumable: (st) => !!st &&
      /^(paused|waiting-login|waiting-retry|storage-failed|needs-attention|account-changed)$/.test(String(st.status || ''))
  });
  vm.runInContext(pTileSrc, ctx, { filename: 'mls-connect:pTile' });
  vm.runInContext(pCountsSrc, ctx, { filename: 'mls-connect:pCounts' });
  vm.runInContext('pCounts()', ctx);
  const retry = els.ez3PullRetry;
  return {
    els, spans, texts,
    shown: retry.style.display !== 'none',
    label: String(retry.textContent || '')
  };
}

/* a month manifest in one named state, with the day counts the card reads */
function monthJob(status, opts) {
  const o = opts || {};
  const days = o.days == null ? 31 : o.days;
  const attention = o.attention == null ? 0 : o.attention;
  const failed = o.failed == null ? 0 : o.failed;
  return {
    kind: 'month', target: '2026-08', status,
    summary: {
      days, complete: days - attention - failed, withRows: 22, empty: 6,
      failed, needsAttention: attention,
      attention: Array.from({ length: attention }, (_, i) => ({ date: '2026-08-0' + (i + 1), reason: 'calendar-partial', missing: 2 }))
    }
  };
}

/* the in-tab pull object a tab that ran the job itself would hold. Built the
   way p1RangeSyncP builds it - see PART B, which proves that mapping. */
function inTabP(failedDays, running) {
  const keys = [];
  for (let d = 1; d <= 31; d++) keys.push('2026-08-' + String(d).padStart(2, '0'));
  const dayStatus = {};
  failedDays.forEach((k) => { dayStatus[k] = { status: 'failed', error: 'calendar-partial' }; });
  return {
    range: { ym: '2026-08', keys, label: 'August 2026' },
    provider: 'all', running: !!running, cancelled: false,
    dayStatus, found: 120, saved: 118, dups: 2, failedRows: 0,
    emptyDays: [], failedDays: failedDays.slice(), providersSeen: {}, log: []
  };
}

const ATTENTION_DAYS = ['2026-08-05', '2026-08-06', '2026-08-12', '2026-08-27'];

/* --- (a) the measured state: needs-attention, not running, N attention days */
{
  /* the reloaded tab - no in-tab pull object at all. THE MEASURED CASE. */
  const reloaded = card({ manifest: monthJob('needs-attention', { attention: 4 }), P: null, cardMonth: '2026-08' });
  ok(reloaded.shown,
    'a settled needs-attention month job on a tab with no in-tab pull object leaves #ez3PullRetry hidden - ' +
    'the card says "press Retry" over a control that is not on the screen (measured live 2026-09-02 05:1x)');
  ok(/need/i.test(reloaded.label),
    `the button offered for days that need attention still calls them failures: "${reloaded.label}"`);
  eq(reloaded.els.ez3cFail.textContent, '4', 'the fourth tile does not carry the manifest\'s needs-attention count');
  eq(reloaded.spans.ez3cFail.textContent, 'need attention', 'the fourth tile wears a label from the other engine');

  /* the same job on the tab that ran it - the durable control branch */
  const adopted = card({
    manifest: monthJob('needs-attention', { attention: 4 }),
    P: inTabP(ATTENTION_DAYS, false), cardMonth: '2026-08'
  });
  ok(adopted.shown, 'the durable control branch hides Retry over a settled needs-attention job');
  ok(/need/i.test(adopted.label),
    `the durable branch labels an attention retry as a failure retry: "${adopted.label}"`);
  ok(adopted.els.ez3PullResume.style.display === 'none',
    'a settled job offers Resume AND Retry - two controls for one press');

  /* zero failed days is the whole point: the job is not retrying by itself */
  const noFailed = card({
    manifest: monthJob('needs-attention', { attention: 4, failed: 0 }),
    P: inTabP([], false), cardMonth: '2026-08'
  });
  ok(noFailed.shown,
    'with the manifest in needs-attention and NOTHING in the retry pool the control disappears - ' +
    'which is exactly the state the card prints "press Retry" for');
}

/* --- (b) running -> hidden ------------------------------------------------ */
{
  const runningReloaded = card({ manifest: monthJob('running', { attention: 4 }), P: null, cardMonth: '2026-08' });
  eq(runningReloaded.shown, false, 'a RUNNING month job offers Retry on a reloaded tab');

  const runningAdopted = card({
    manifest: monthJob('running', { attention: 4 }),
    P: inTabP(ATTENTION_DAYS, true), cardMonth: '2026-08'
  });
  eq(runningAdopted.shown, false, 'a RUNNING month job offers Retry while it is still reading days');
}

/* --- (c) finished clean -> hidden ---------------------------------------- */
{
  const cleanReloaded = card({ manifest: monthJob('complete', { attention: 0, failed: 0 }), P: null, cardMonth: '2026-08' });
  eq(cleanReloaded.shown, false, 'a month that finished clean still offers Retry on a reloaded tab');

  const cleanAdopted = card({
    manifest: monthJob('complete', { attention: 0, failed: 0 }),
    P: inTabP([], false), cardMonth: '2026-08'
  });
  eq(cleanAdopted.shown, false, 'a month that finished clean still offers Retry');

  /* and with no saved job at all, nothing this card can retry */
  const idle = card({ manifest: null, P: inTabP([], false), cardMonth: '2026-08' });
  eq(idle.shown, false, 'an idle card with an empty retry pool offers Retry');
}

/* --- (d) waiting-retry with failed days -> displayed (unchanged) ---------- */
{
  const waitingAdopted = card({
    manifest: monthJob('waiting-retry', { failed: 2 }),
    P: inTabP(['2026-08-28', '2026-08-30'], false), cardMonth: '2026-08'
  });
  ok(waitingAdopted.shown, 'the behaviour that already worked broke: waiting-retry with failed days hides Retry');
  eq(waitingAdopted.label, '↻ Retry failed days',
    `days the job will genuinely retry are no longer called that: "${waitingAdopted.label}"`);

  const waitingReloaded = card({ manifest: monthJob('waiting-retry', { failed: 2 }), P: null, cardMonth: '2026-08' });
  ok(waitingReloaded.shown, 'waiting-retry on a reloaded tab hides Retry');
  eq(waitingReloaded.label, '↻ Retry failed days',
    `the reloaded card renames a genuine retry: "${waitingReloaded.label}"`);

  /* a legacy in-tab run with no durable job keeps its own rule */
  const legacy = card({ manifest: null, P: inTabP(['2026-08-02'], false), cardMonth: '2026-08' });
  ok(legacy.shown, 'a stopped legacy run with a day in its retry pool no longer offers Retry');
  eq(legacy.label, '↻ Retry failed days', `the legacy run renamed its own retry: "${legacy.label}"`);
}

/* --- a year job is not this card's job ----------------------------------- */
{
  const year = card({
    manifest: { kind: 'year', target: '2026', status: 'needs-attention',
      summary: { days: 365, complete: 300, withRows: 200, empty: 60, failed: 0, needsAttention: 5, attention: [] } },
    P: null, cardMonth: '2026-08'
  });
  eq(year.shown, false,
    'the MONTH card offers Retry for a YEAR job\'s attention days - rptfix-1.0.0 gave that job to the Year card');
}

/* --- another month's saved job is not this card's job either -------------- */
{
  const other = card({ manifest: monthJob('needs-attention', { attention: 4 }), P: null, cardMonth: '2026-07' });
  eq(other.shown, false, 'a saved job for a DIFFERENT month paints its Retry onto this card');
}

/* =======================================================================
 * PART B - the copy and the control agree.
 *
 * The sentence is written by clunky-staffprep-1.0.0 in the shells, from the
 * SAME window.__mlsP1RangeJobs.state() the card's rule reads. Every status
 * whose sentence tells the doctor to press Retry must put the control on the
 * screen - on a reloaded tab and on the tab that ran the job.
 * ===================================================================== */
{
  const tables = SHELLS.map((rel) => {
    const src = fs.readFileSync(rel, 'utf8');
    const at = src.indexOf('<!-- ===== clunky-staffprep-1.0.0');
    const end = src.indexOf('<!-- ===== end clunky-staffprep-1.0.0');
    ok(at >= 0 && end > at, `${rel}: the clunky-staffprep-1.0.0 block is missing or unclosed`);
    const table = balanced(src.slice(at, end), 'var SAYS = ', `${rel}: SAYS`);
    const says = {};
    const line = /(?:'([^']+)'|([A-Za-z][A-Za-z0-9_]*))\s*:\s*'((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = line.exec(table))) says[m[1] || m[2]] = m[3];
    ok(Object.keys(says).length >= 8, `${rel}: the status sentence table did not parse (${Object.keys(says).length} entries)`);
    return { rel, says };
  });

  eq(JSON.stringify(tables[0].says), JSON.stringify(tables[1].says),
    'the two shells print different sentences for the same job status');

  const says = tables[0].says;
  const pressRetry = Object.keys(says).filter((k) => /press Retry/i.test(says[k]));
  ok(pressRetry.length > 0,
    'no status sentence tells the doctor to press Retry any more - re-aim this proof at whatever replaced it');

  pressRetry.forEach((status) => {
    const reloaded = card({ manifest: monthJob(status, { attention: 4 }), P: null, cardMonth: '2026-08' });
    ok(reloaded.shown,
      `the card says "${says[status]}" for status '${status}' and #ez3PullRetry is not on the screen (reloaded tab)`);
    const adopted = card({
      manifest: monthJob(status, { attention: 4 }),
      P: inTabP(ATTENTION_DAYS, false), cardMonth: '2026-08'
    });
    ok(adopted.shown,
      `the card says "${says[status]}" for status '${status}' and #ez3PullRetry is not on the screen (job's own tab)`);
  });

  /* and the sentence for a clean finish must not point at a control */
  ok(!/press Retry/i.test(says.complete || ''),
    'the "done" sentence tells the doctor to press Retry on a month with nothing left to read');
}

/* =======================================================================
 * PART C - the two claims that do not hold, pinned.
 * ===================================================================== */
{
  /* (i) p1RangeSyncP folds a needs-attention day into P.failedDays */
  const sync = balanced(CONNECT, 'function p1RangeSyncP(st)', 'p1RangeSyncP');
  ok(/day\.status === 'retry' \|\| day\.status === 'needs-attention'/.test(sync),
    'p1RangeSyncP no longer mirrors needs-attention days into the panel\'s retry pool, ' +
    'so an adopted job would hide the days the card is asking the doctor about');
  ok(/P\.failedDays\.push\(key\)/.test(sync), 'p1RangeSyncP no longer fills P.failedDays at all');

  /* (ii) the three historical copies of the rule are DEAD, not variants */
  const retired = CONNECT.split("var btnR = $('ez3PullRetry'); if (btnR) btnR.style.display = (!P.running && P.failedDays.length) ? '' : 'none';");
  eq(retired.length - 1, 3,
    `expected exactly 3 retired copies of the historical retry rule, found ${retired.length - 1} - ` +
    'if a live site now carries that shape it is missing the durable branch');
  ok(CONNECT.indexOf('SUPERSEDED - DEAD CODE, kept verbatim as the historical record') > 0,
    'the record that says those copies are dead ("Fix those, never these") has been removed');
  const owners = CONNECT.split('\n').reduce((acc, lineText, idx) => {
    if (/^\(function \(\) \{$/.test(lineText)) acc.push(idx);
    return acc;
  }, []);
  ok(owners.length > 0, 'no column-0 IIFE owners found, so the dead-code pin below would be vacuous');
  ['Retired historical Easy 3.4.1 owner', 'Retired historical Easy 3.2.1 owner', 'Retired historical Easy 3.1.1 owner']
    .forEach((marker) => {
      const at = CONNECT.indexOf(marker);
      ok(at > 0, `the retired owner comment "${marker}" is gone`);
      const after = CONNECT.slice(at, at + 400);
      ok(/\n\s*return;\n/.test(after),
        `"${marker}" no longer opens with an unconditional return - its copy of the retry rule is live again`);
    });

  /* the live rule is where the card's other controls are decided */
  const counts = balanced(CONNECT, 'function pCounts()', 'pCounts');
  ok(counts.indexOf("var btnU = $('ez3PullResume');") > 0, 'the control rule moved out of pCounts');
  ok(/retryvis-1\.0\.0/.test(counts), 'pCounts no longer carries the retryvis-1.0.0 record of what was measured');
  const earlyReturn = counts.indexOf('if (!P) {');
  const retryInEarly = counts.indexOf("var btnR0 = $('ez3PullRetry');");
  const retryInDurable = counts.indexOf("var btnR = $('ez3PullRetry');");
  ok(earlyReturn > 0 && retryInEarly > earlyReturn && retryInEarly < retryInDurable,
    'the no-in-tab-pull branch does not paint the Retry control, so a reloaded tab is back where it was measured');

  /* both twins ship the same file */
  ['mls-connect.js', 'cloned-mls-connect.js'].forEach((rel) => {
    const derived = fs.readFileSync(rel, 'utf8');
    ok(/retryvis-1\.0\.0/.test(derived), `${rel}: the derived lane did not follow - re-run the derive scripts`);
    eq(balanced(derived, 'function pCounts()', rel + ':pCounts'), counts,
      `${rel}: pCounts drifted from /1p beyond lane identity`);
  });
}

console.log('PASS retryvis-1.0.0: the Retry control is on screen for every status whose sentence says to press it, ' +
  'on a reloaded tab and on the job\'s own tab; it names attention days as attention days and genuine retries as ' +
  'retries; running, a clean finish, a year job and another month\'s job all keep it off - ' + checks + ' checks');
