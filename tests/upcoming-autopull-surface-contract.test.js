'use strict';
/* =============================================================================
 * upcoming-autopull-surface-contract.test.js  -  upnext-1.1.0
 *
 * The two doctor-visible halves of the quiet upcoming-days lane:
 *
 *   A. the Settings option "Pull upcoming visits automatically" - present in
 *      BOTH shells, default ON, one plain sentence, wired into the settings
 *      render path, and writing the exact key the engine reads back
 *   B. the day strip line that says an upcoming day is already here - in the
 *      SAME words Today's finished pull has always used, never over the top of
 *      a day's own pull receipt, and silent for a day nothing has read
 *
 * Both halves are EXECUTED here, not grepped for: the real functions are cut
 * out of the shipping files and run against stubs.
 *
 * Run: node tests/upcoming-autopull-surface-contract.test.js   (bare exit code)
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert.ok(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

/* cut one balanced `function name(...) { ... }` out of a shipping file */
function balancedFunction(src, signature, label) {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, 'could not find ' + label);
  let i = src.indexOf('{', start), depth = 0;
  assert.ok(i > start, 'could not find the body of ' + label);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced body for ' + label);
}

/* ===========================================================================
   A. the Settings option, in BOTH shells
   ========================================================================= */
const DEV_WORDS = /\b(ledger|receipt|lease|mutex|gate|payload|endpoint|serialize|idempotent|bridge|namespace|boolean|null|API|cache)\b/i;

SHELLS.forEach(function (rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const label = rel.replace(/\\/g, '/');

  ok(src.indexOf('id="setUpcomingAutoPull"') >= 0, label + ': the upcoming-visits setting is not in this shell');
  const at = src.indexOf('id="setUpcomingAutoPull"');
  const row = src.slice(src.lastIndexOf('<label', at), src.indexOf('</label>', at));
  ok(/\bchecked\b/.test(row.slice(0, row.indexOf('>', row.indexOf('<input')) + 1)),
    label + ': the setting does not ship checked - a doctor who never opens Settings gets nothing');
  ok(/Pull upcoming visits automatically/.test(row),
    label + ': the setting lost its plain name');

  const sentence = row.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  ok(/earlier visits/.test(sentence) && /note you write tomorrow/.test(sentence),
    label + ': the sentence no longer says WHY the next days are read');
  ok(!DEV_WORDS.test(sentence), label + ': the doctor-visible sentence carries developer words: ' + sentence);
  eq(sentence.split(/(?<=[.!?])\s+(?=[A-Z])/).length, 1,
    label + ': the setting grew past one plain sentence: ' + sentence);

  /* it is actually rendered when Settings opens */
  ok(/renderUpcomingAutoPullSetting\(\);/.test(src),
    label + ': nothing ever calls renderUpcomingAutoPullSetting - the box would never reflect the stored value');
  ok(src.indexOf('renderPullVisitBodiesSetting();') < src.indexOf('renderUpcomingAutoPullSetting();'),
    label + ': the new setting is not rendered alongside the pull settings it belongs with');

  /* and its read/write behaviour, EXECUTED */
  const prefFn = balancedFunction(src, 'function upcomingAutoPullPref()', label + ' upcomingAutoPullPref');
  const store = new Map();
  const ctx = {
    localStorage: {
      getItem: k => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)); },
      removeItem: k => { store.delete(String(k)); }
    }
  };
  ctx.window = ctx;
  ctx.window.uns = s => 'sf_u::doc@example.invalid::' + s;
  vm.runInNewContext(prefFn + '\nthis.__pref = upcomingAutoPullPref;', ctx, { filename: label + '-pref' });
  eq(ctx.__pref(), true, label + ': an account with nothing stored is not ON by default');
  store.set('sf_u::doc@example.invalid::upcomingAutoPull', '1');
  eq(ctx.__pref(), true, label + ': an explicit 1 did not read back ON');
  store.set('sf_u::doc@example.invalid::upcomingAutoPull', '0');
  eq(ctx.__pref(), false, label + ': an explicit 0 did not turn the lane off');
  /* the key the SHELL writes has to be the key the ENGINE reads */
  ok(/window\.uns\('upcomingAutoPull'\)/.test(src),
    label + ': the setting writes some key other than the one the engine reads');

  /* A verified write wakes the already-running scheduler. Failed writes return
     before this event, so the toast and the engine can never disagree. */
  const renderFn = balancedFunction(src, 'function renderUpcomingAutoPullSetting()',
    label + ' renderUpcomingAutoPullSetting');
  const events = [];
  const cb = {
    checked: true, dataset: {}, onChange: null,
    addEventListener(type, fn) { if (String(type) === 'change') this.onChange = fn; }
  };
  const ui = {
    localStorage: ctx.localStorage,
    document: { getElementById: id => String(id) === 'setUpcomingAutoPull' ? cb : null },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    toast: () => {}
  };
  ui.window = ui;
  ui.window.uns = ctx.window.uns;
  ui.window.dispatchEvent = event => { events.push(event); return true; };
  vm.runInNewContext(prefFn + '\n' + renderFn +
    '\nthis.__renderUpcoming = renderUpcomingAutoPullSetting;', ui, { filename: label + '-setting' });
  ui.__renderUpcoming();
  ok(typeof cb.onChange === 'function', label + ': the setting did not wire its change handler');
  eq(cb.checked, false, label + ': the rendered checkbox ignored the stored OFF value');
  cb.checked = true;
  cb.onChange();
  eq(store.get('sf_u::doc@example.invalid::upcomingAutoPull'), '1',
    label + ': turning the setting on did not persist ON');
  eq(events.length, 1, label + ': a successful setting write did not emit exactly one scheduler wake');
  eq(events[0].type, 'mls:upcoming-setting-changed', label + ': the setting emitted the wrong wake event');
  eq(events[0].detail.on, true, label + ': the ON wake did not carry the saved state');
  cb.checked = false;
  cb.onChange();
  eq(store.get('sf_u::doc@example.invalid::upcomingAutoPull'), '0',
    label + ': turning the setting off did not persist OFF');
  eq(events.length, 2, label + ': a successful OFF write did not emit one scheduler wake');
  eq(events[1].detail.on, false, label + ': the OFF wake did not carry the saved state');
  const realSetItem = ui.localStorage.setItem;
  ui.localStorage.setItem = () => { throw new Error('synthetic quota refusal'); };
  cb.checked = true;
  cb.onChange();
  eq(cb.checked, false, label + ': a refused write did not repaint the authoritative stored value');
  eq(events.length, 2, label + ': a refused write still emitted a scheduler wake');
  ui.localStorage.setItem = realSetItem;
});

/* the engine's own name for that key, so the two halves cannot drift */
{
  const importer = fs.readFileSync(path.join(root, '1p-feat_mls_schedimport_exact.js'), 'utf8');
  ok(/UP_SETTING_SUFFIX = "upcomingAutoPull"/.test(importer),
    'the engine no longer reads the key the Settings option writes');
}

/* ===========================================================================
   B. the day strip line, EXECUTED against a stub day
   ========================================================================= */
{
  const fn = balancedFunction(connect, 'function dsQuietPulledState(day)', 'dsQuietPulledState');
  const ordinal = balancedFunction(connect, 'function dsOrdinal(n)', 'dsOrdinal');

  function run(opts) {
    const ctx = {
      console, Date, Math, String, Number, Object, Array, JSON,
      DS: { day: opts.day },
      todayKey: () => opts.today,
      rowsFor: () => new Array(opts.rows).fill({}),
      window: {}
    };
    ctx.window = Object.assign(ctx.window, { __mlsUpcomingPull: opts.upcoming });
    vm.runInNewContext(ordinal + '\n' + fn + '\nthis.__line = dsQuietPulledState;', ctx, { filename: 'ds-quiet' });
    return ctx.__line(opts.day);
  }

  const ready = { dayReady: () => ({ ready: true, at: 1, rows: 6 }) };
  const notReady = { dayReady: () => ({ ready: false, at: 0, rows: 0 }) };

  const todayLine = run({ day: '2026-09-11', today: '2026-09-11', rows: 6, upcoming: ready });
  ok(/ready/.test(todayLine), 'a quietly-pulled Today does not say it is ready');
  ok(/\btoday\b/.test(todayLine), 'the Today line does not name today the way the pull button does');
  ok(/6 charts/.test(todayLine), 'the line does not say how many charts are already here');

  const tomorrowLine = run({ day: '2026-09-12', today: '2026-09-11', rows: 4, upcoming: ready });
  ok(/Saturday the 12th/.test(tomorrowLine),
    'an upcoming day is not named the way the pull button names it: ' + tomorrowLine);
  ok(/ready/.test(tomorrowLine), 'an upcoming day that is already here does not say so');
  ok(/4 charts/.test(tomorrowLine), 'the upcoming line does not say how many charts are here');

  /* no new jargon: the same words, and nothing a doctor would have to learn */
  [todayLine, tomorrowLine].forEach(line => {
    ok(!DEV_WORDS.test(line), 'the day-strip line carries developer words: ' + line);
    ok(!/pulled|pull\b|import|sync|fetch/i.test(line.replace(/Pull [A-Z]/g, '')),
      'the day-strip line invented a verb the strip does not already use: ' + line);
  });

  /* silence everywhere else */
  eq(run({ day: '2026-09-12', today: '2026-09-11', rows: 4, upcoming: notReady }), '',
    'a day nothing has read still claims to be ready');
  eq(run({ day: '2026-09-12', today: '2026-09-11', rows: 0, upcoming: ready }), '',
    'a day with no rows on it still claims charts are here');
  eq(run({ day: '2026-09-12', today: '2026-09-11', rows: 4, upcoming: undefined }), '',
    'the strip claims a day is ready on a build where the lane never installed');
}

/* the line is wired in, exported, and can never overwrite a day's own receipt */
{
  ok(/var quiet = dsQuietPulledState\(DS\.day\);/.test(connect),
    'syncStrip no longer asks whether the selected day is already here');
  ok(/api\.pulledLine = function \(day\) \{ return dsQuietPulledState\(day\); \};/.test(connect),
    'the day-switch API no longer exposes the pulled line to its consumers');
  const start = connect.indexOf('var statusNode = $(\'mlsDsStatus\');');
  const block = connect.slice(start, connect.indexOf('} catch (eReceiptPaint) {}', start));
  ok(/if \(paintable && hydratedTerminal\)/.test(block),
    'a day with its own pull receipt no longer wins the status line');
  ok(block.indexOf('if (paintable && hydratedTerminal)') < block.indexOf('else if (paintable && quiet)'),
    'the quiet line was moved ahead of the day\'s own pull receipt');
  ok(!/DS\.pulling[^)]*\|\|/.test(block.slice(block.indexOf('else if'))) ,
    'the quiet branch re-derived its own idea of when the strip is busy');
}

console.log('upcoming-autopull-surface-contract: ' + checks + ' checks passed');
