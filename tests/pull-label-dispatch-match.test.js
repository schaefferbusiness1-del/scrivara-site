'use strict';
/* lr-1.0 control: THE PULL DISPATCHES THE DAY ITS LABEL NAMES.
 *
 * Diagnosis 2026-08-11: the calendar hero labeled "Pull Tuesday, Jul 7"
 * (label from _calRefDate, calm_views) dispatched _acctTodayKey() = TODAY
 * (ScribeFlow cv-handoff). Proven live: an instrumented click with
 * _calRefDate="2026-07-07" entered dayPull with date:"2026-08-11".
 *
 * The fix has two halves and BOTH are pinned here on the real shipped bytes:
 *   - ScribeFlow pullScheduleViaAssist honors an explicit { date } option
 *     (the labeled-day door) while every DATELESS caller keeps TODAY -
 *     copilot 'pull-today', centerpiece Today, and the legacy hero all say
 *     "today", so a blanket switch to _calRefDate would have created the
 *     same lie in the opposite direction;
 *   - the calm_views calendar hero (whose label NAMES the selected day)
 *     passes that day through the door instead of clicking the dateless
 *     #mlsT3Empty button.
 * The old shape fails by name: dispatch today under a Jul-7 label. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'latin1');
const cv = fs.readFileSync(path.join(root, 'feat_mls_calm_views.js'), 'latin1');

function extractBraced(src, startToken, from) {
  const at = src.indexOf(startToken, from || 0);
  assert.ok(at >= 0, 'extractor found: ' + startToken);
  const open = src.indexOf('{', at);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced braces after ' + startToken);
}

const psvaSrc = extractBraced(html, 'function pullScheduleViaAssist(');

function buildPsva(ctx) {
  const f = new Function('ctx',
    'var document = ctx.document;\n' +
    'var toast = ctx.toast;\n' +
    'var window = ctx.window;\n' +
    'var _acctTodayKey = ctx._acctTodayKey;\n' +
    psvaSrc + '\n' +
    'return pullScheduleViaAssist;');
  return f(ctx);
}

function makeCtx(captured) {
  const ctx = {
    document: { getElementById: () => null },
    toast: () => {},
    _acctTodayKey: () => '2026-08-11',
    window: {}
  };
  ctx.window.__mlsSI = {
    installed: true,
    dayPull: o => { captured.push(o); return Promise.resolve({ ok: true }); }
  };
  return ctx;
}

(async function () {
  let n = 0;
  const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

  /* ---- 1. the explicit-date door: a labeled entry sends its labeled day ---- */
  {
    const captured = [];
    const psva = buildPsva(makeCtx(captured));
    await psva(null, { date: '2026-07-07' });
    assert.strictEqual(captured.length, 1, 'guarded dispatch ran');
    assert.strictEqual(captured[0].date, '2026-07-07',
      'a caller labeled "Pull Tuesday, Jul 7" dispatches Jul 7 (old shape: _acctTodayKey() = 2026-08-11 regardless of the label)');
    ok('explicit date honored: the label and the dispatch are the same day');
  }

  /* ---- 2. every dateless caller keeps TODAY (pull-today stays today) ---- */
  {
    const captured = [];
    const psva = buildPsva(makeCtx(captured));
    await psva(null);
    assert.strictEqual(captured[0].date, '2026-08-11',
      'a dateless call (copilot pull-today, centerpiece Today, legacy hero) dispatches TODAY');
    ok('dateless callers unchanged: today means today');
  }

  /* ---- 3. a malformed date falls back to TODAY, never dispatches garbage ---- */
  {
    const captured = [];
    const psva = buildPsva(makeCtx(captured));
    await psva(null, { date: 'Jul 7' });
    assert.strictEqual(captured[0].date, '2026-08-11',
      'a non-YYYY-MM-DD date option is ignored, today dispatches');
    ok('malformed date option cannot poison the dispatch');
  }

  /* ---- 4. the calm_views calendar hero passes its labeled day ---- */
  const calIdx = cv.indexOf("key: 'calendar'");
  assert.ok(calIdx > 0, 'calendar view entry present');
  const histIdx = cv.indexOf("key: 'history'", calIdx);
  const actRaw = extractBraced(cv, 'act: function () {', calIdx);
  assert.ok(calIdx + actRaw.length < histIdx, 'extracted act belongs to the calendar view, not a later one');
  const actExpr = actRaw.slice(actRaw.indexOf('function'));

  function buildAct(ctx) {
    const f = new Function('ctx',
      'var W = ctx.W;\n' +
      'var qs = ctx.qs;\n' +
      'var visible = ctx.visible;\n' +
      'var safe = function (fn, fb) { try { return fn(); } catch (e) { return fb; } };\n' +
      'return (' + actExpr + ');');
    return f(ctx);
  }

  {
    const calls = [];
    const t3btn = { click: () => calls.push(['t3-click']) };
    const ctx = {
      W: {
        _calRefDate: '2026-07-07',
        pullScheduleViaAssist: function (btn, opts) { calls.push(['psva', btn, opts]); }
      },
      qs: sel => (sel.indexOf('t3e-pull') >= 0 ? t3btn : null),
      visible: () => true
    };
    const act = buildAct(ctx);
    const ran = act();
    assert.strictEqual(ran, true, 'act reports it ran');
    const psvaCalls = calls.filter(c => c[0] === 'psva');
    assert.strictEqual(psvaCalls.length, 1,
      'the hero calls pullScheduleViaAssist directly when a day label exists (old shape: clicked the dateless #mlsT3Empty button)');
    assert.ok(psvaCalls[0][2] && psvaCalls[0][2].date === '2026-07-07',
      'the hero passes its LABELED day - "Pull Tuesday, Jul 7" pulls Jul 7');
    assert.ok(!calls.some(c => c[0] === 't3-click'),
      'the dateless button is not clicked when a labeled day exists');
    ok('calendar hero sends the day its label names');
  }

  /* ---- 5. no selected day: the old preference order survives untouched ---- */
  {
    const calls = [];
    const t3btn = { click: () => calls.push(['t3-click']) };
    const ctx = {
      W: {
        _calRefDate: null,
        pullScheduleViaAssist: function (btn, opts) { calls.push(['psva', btn, opts]); }
      },
      qs: sel => (sel.indexOf('t3e-pull') >= 0 ? t3btn : null),
      visible: () => true
    };
    const act = buildAct(ctx);
    assert.strictEqual(act(), true, 'act still runs');
    assert.deepStrictEqual(calls, [['t3-click']],
      'with no day label the app\'s own button keeps preference (today semantics, label reads "Pull this day\'s schedule")');
    ok('no-label case: original button preference preserved');
  }

  console.log('# pull-label-dispatch-match: ' + n + ' groups passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
