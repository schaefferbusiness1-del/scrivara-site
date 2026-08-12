#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-loud-refusal.js  (lr-1.0)  2026-08-11
 *
 * LOUD REFUSAL + LABEL/DISPATCH HONESTY + QUOTA SURFACE - site-only patch.
 * Authority: handoff-2026-08-11/silent-refusal-DIAGNOSIS.md (defects A + B)
 * and the fix queue at the end of CONTINUE_PROMPT.md. Owner order: "fix all
 * these issues... without updating extension" - extension 3.0.61 untouched,
 * ZERO extension edits; every edit below lands in site files only
 * (ScribeFlow.html, feat_mls_calm_views.js, feat_mls_schedimport_exact.js,
 * mls-connect.js) and uses no bridge verb at all.
 *
 * THE THREE FIXES:
 *  1. EVERY pull refusal becomes visible - setS falls through to toast on
 *     element INVISIBILITY (not absence); the cv-handoff settle consumes the
 *     receipt and names the gate verbatim; the advisory in-flight gate
 *     (the diagnosis's only zero-trace exit) speaks, names gate + holder,
 *     and stamps lastPullResult + __mlsPullLastOutcome.
 *  2. LABEL/DISPATCH: pullScheduleViaAssist gains an explicit-date door;
 *     the calm_views calendar hero (labeled "Pull <day>") passes its labeled
 *     day. Every dateless caller (copilot pull-today, centerpiece Today,
 *     legacy hero) keeps TODAY - a blanket _calRefDate switch would have
 *     created the same lie in the opposite direction.
 *  3. QUOTA SURFACE (qv-1.1): a persistent chip bound to
 *     window.__mlsStoreWriteFailed, owned by the qv IIFE and nowhere else;
 *     the guard console line names the store key; __dayPullInner refuses
 *     LOUDLY (named reason + gate, spoken, receipt-stamped) while the flag
 *     is set, BEFORE any Athena navigation and BEFORE arming presence.
 *
 * PIN COMPATIBILITY (accounted for, no pin deleted):
 *  - qol-focus-comes-home F5 + qol-arm-inside-the-mutex: the anchor lines
 *    'if (pullRunning || foreignPullLease()) {' and the qol-2.3 arm line
 *    survive byte-verbatim; the quota gate inserts BETWEEN them, so
 *    advisoryIdx < armIdx still holds and the arm-callsite count stays 2.
 *  - history-retry-foreground-contract 4f: 'reason: "pull-in-flight"' and
 *    'No Athena navigation was started.' both survive in the day lane, and
 *    the busy refusal still precedes warmUpDay.
 *  - quota-verified-writes: the qv IIFE tail
 *    'window.__mlsQuotaGuard_revert = QG.revert;\n})();' is unchanged and
 *    every qvChip call sits inside try{}catch{} so a document-less harness
 *    cannot be broken by it.
 *
 * EOL SAFETY: ScribeFlow.html / mls-connect.js / feat_mls_schedimport_exact.js
 * are mixed-EOL. Files are read and written as latin1 (byte-preserving);
 * every edit is an exact byte splice with an occurrence==1 assertion. No
 * line-based rewrite, no normalization, ever. ASCII only in every replace
 * (the em-dash in the chip text is the — ESCAPE, six ASCII bytes).
 *
 * MODES:
 *   node patch-loud-refusal.js            -> DRY-RUN (writes nothing)
 *   node patch-loud-refusal.js --apply    -> apply splices (backups OUTSIDE
 *                                            the repo first)
 *
 * Exports { EDITS, applyToSources } so the contract suites could rebuild the
 * patched sources in memory without touching the repo.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');

const SF = 'ScribeFlow.html';
const CV = 'feat_mls_calm_views.js';
const SI = 'feat_mls_schedimport_exact.js';
const MC = 'mls-connect.js';

const J = lines => lines.join('\n');

const EDITS = [

  /* ==== FIX 2a: the explicit-date door (ScribeFlow) ======================= */
  {
    file: SF, id: 'sf-psva-signature',
    why: 'pullScheduleViaAssist gains an optional opts bag so a caller whose LABEL names a day can dispatch that day. Every existing caller passes at most (btn) and is untouched.',
    find: 'function pullScheduleViaAssist(btn){',
    replace: 'function pullScheduleViaAssist(btn, opts){'
  },

  /* ==== FIX 1a: setS speaks where a person can SEE (ScribeFlow) =========== */
  {
    file: SF, id: 'sf-sets-visibility',
    why: 'diagnosis silencer 1: the toast fall-through was gated on element ABSENCE; #heroPullStatus exists but is 0x0 inside the retired hero, so refusals were spoken into an invisible element. Now gated on VISIBILITY; returns whether the line was visible so the settle handler can avoid double-toasting.',
    find: "  var setS=function(m,kind){ var el=document.getElementById('heroPullStatus'); if(el){ el.textContent=m; el.style.color=(kind==='err')?'#ffe0e0':(kind==='ok'?'#d8ffe8':'rgba(255,255,255,.95)'); el.style.display='block'; } else { try{ toast(m, kind==='err'?'err':''); }catch(e){} } };",
    replace: "  var setS=function(m,kind){ var el=document.getElementById('heroPullStatus'); var _vis=false; if(el){ el.textContent=m; el.style.color=(kind==='err')?'#ffe0e0':(kind==='ok'?'#d8ffe8':'rgba(255,255,255,.95)'); el.style.display='block'; try{ var _vr=el.getBoundingClientRect(); _vis=!!(_vr&&_vr.width>0&&_vr.height>0); }catch(_ve){} } if(!_vis){ try{ toast(m, kind==='err'?'err':''); }catch(e){} } return _vis; }; /* lr-1.0: the retired hero's status line is 0x0 on the live layout - a message no one can see falls through to toast (VISIBILITY, not existence; diagnosis 2026-08-11 silencer 1) */"
  },

  /* ==== FIX 2b: dispatch honors the labeled day (ScribeFlow) ============== */
  {
    file: SF, id: 'sf-day-honors-label',
    why: 'diagnosis: hero labeled "Pull Tuesday, Jul 7" dispatched _acctTodayKey()=2026-08-11. An explicit valid opts.date wins; everything else keeps TODAY so pull-today callers stay honest too.',
    find: "    var _cvDay=(typeof _acctTodayKey==='function')?String(_acctTodayKey()||''):'';",
    replace: J([
      "    var _cvSel=(opts&&typeof opts==='object'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(String(opts.date||'')))?String(opts.date):''; /* lr-1.0: an entry whose LABEL names a day (the calendar hero) passes that day; every dateless caller keeps TODAY (copilot pull-today, centerpiece Today, legacy hero) so no label lies in either direction */",
      "    var _cvDay=_cvSel||((typeof _acctTodayKey==='function')?String(_acctTodayKey()||''):'');"
    ])
  },

  /* ==== FIX 1b: the settle CONSUMES the receipt (ScribeFlow) ============== */
  {
    file: SF, id: 'sf-receipt-consumed',
    why: 'diagnosis silencer 2: .then(_cvDone,_cvDone) discarded the receipt (psva-settle undefined in the live probe). One site - every dayPull caller inherits it. ok:false and rejections surface on the visible line AND a toast naming the gate verbatim; the receipt is returned, never swallowed.',
    find: '      var _cvDone=function(){ if(btn){ btn.disabled=false; btn.innerHTML=btn.dataset._t||btn.innerHTML; } };',
    replace: J([
      '      var _cvDone=function(res){',
      '        if(btn){ btn.disabled=false; btn.innerHTML=btn.dataset._t||btn.innerHTML; }',
      '        /* lr-1.0 (silent-refusal diagnosis 2026-08-11, silencer 2): this settle',
      '           used to DISCARD the receipt - a 12.8s roster-gate refusal painted zero',
      '           visible pixels while its verbatim reason sat in a 0x0 retired element.',
      '           Every ok:false receipt and every rejection now surfaces where the',
      '           doctor looks: the status line when visible, and ALWAYS a toast naming',
      '           the gate verbatim (e.g. provider-roster-incomplete). One site - every',
      '           dayPull caller inherits it. The receipt is returned, never swallowed. */',
      '        try{',
      '          var _rr=(res&&typeof res===\'object\'&&!(res instanceof Error))?res:null;',
      '          if((_rr&&_rr.ok===false)||(res instanceof Error)){',
      '            var _rm=_rr?(\'Pull refused (\'+String(_rr.reason||\'unspecified\')+\'): \'+String(_rr.error||\'no detail was given.\')):(\'Pull failed: \'+String((res&&res.message)||res));',
      '            if(setS(_rm,\'err\')){ try{ toast(_rm,\'err\'); }catch(_te){} }',
      '          }',
      '        }catch(_ce){}',
      '        return res;',
      '      };'
    ])
  },

  /* ==== FIX 2c: the calendar hero sends the day its label names (calm) ==== */
  {
    file: CV, id: 'cv-hero-sends-labeled-day',
    why: 'the hero label comes from calRefDate() (W._calRefDate) but both dispatch branches sent TODAY. When a valid selected day exists it now goes through the explicit-date door; the dateless branches survive for the no-label case only.',
    find: J([
      '        act: function () {',
      "          /* Prefer the app's own button so any handler it grows comes with it.",
      "             It only exists in the calendar's empty state, so a loaded calendar",
      '             falls back to the SAME call that button makes:',
      '             feat_task3_frontsync.js:477  pb.onclick = window.pullScheduleViaAssist() */',
      "          var btn = qs('#mlsT3Empty .t3e-pull');",
      '          if (btn && visible(btn)) { btn.click(); return true; }',
      "          if (typeof W.pullScheduleViaAssist === 'function') { W.pullScheduleViaAssist(); return true; }",
      '          return false;',
      '        }'
    ]),
    replace: J([
      '        act: function () {',
      "          /* lr-1.0 (label/dispatch honesty, diagnosis 2026-08-11): this hero's",
      '             label NAMES the selected day (calRefDate above) but both dispatch',
      '             branches sent TODAY - proven live, Pull Tuesday Jul 7 pulled',
      '             2026-08-11. A valid selected day now goes through',
      "             pullScheduleViaAssist's explicit-date door (lr-1.0, ScribeFlow).",
      '             The #mlsT3Empty .t3e-pull click and the bare call both dispatch',
      '             TODAY (frontsync:507), so they serve only the no-label case, where',
      '             the hero reads Pull this day\\u2019s schedule and today is the truth. */',
      "          var selDay = safe(function () { var r = String(W._calRefDate || ''); return /^\\d{4}-\\d{2}-\\d{2}$/.test(r) ? r : ''; }, '');",
      "          if (selDay && typeof W.pullScheduleViaAssist === 'function') { W.pullScheduleViaAssist(null, { date: selDay }); return true; }",
      "          var btn = qs('#mlsT3Empty .t3e-pull');",
      '          if (btn && visible(btn)) { btn.click(); return true; }',
      "          if (typeof W.pullScheduleViaAssist === 'function') { W.pullScheduleViaAssist(); return true; }",
      '          return false;',
      '        }'
    ])
  },

  /* ==== FIX 1c: the advisory gate leaves a NAMED receipt (schedimport) ==== */
  {
    file: SI, id: 'si-advisory-gate-receipt',
    why: "diagnosis click 2: the advisory in-flight refusal returned an inline object NOBODY stored - the only zero-trace exit in the gate chain, un-adjudicable after the fact. It now names gate + holder (lease kind + age), speaks through onStatus, and stamps lastPullResult + __mlsPullLastOutcome. The literals 'reason: \"pull-in-flight\"' and 'No Athena navigation was started.' survive for the pinned suites.",
    find: J([
      '    if (pullRunning || foreignPullLease()) {',
      '      return Promise.resolve({ ok: false, complete: false, reason: "pull-in-flight",',
      '        error: "Another explicit pull is already running. No Athena navigation was started." });',
      '    }'
    ]),
    replace: J([
      '    if (pullRunning || foreignPullLease()) {',
      '      /* lr-1.0 (silent-refusal diagnosis 2026-08-11, click 2): this advisory',
      '         refusal used to return an inline object NOBODY stored - the only',
      '         zero-trace exit in the whole gate chain, un-adjudicable after the',
      '         fact. It now names its gate and holder, speaks through onStatus, and',
      '         stamps the same receipts every other refusal leaves. Advisory check',
      "         only - the engine's own single-flight stays the authoritative gate. */",
      '      var _lrLease = foreignPullLease();',
      '      var _lrHolder = pullRunning ? "this tab\'s pull engine" : (_lrLease ? (String(_lrLease.kind || _lrLease.id || "foreign-lease") + " lease, " + Math.max(0, Math.round((Date.now() - Number(_lrLease.at || 0)) / 1000)) + "s old") : "a pull lease");',
      '      var _lrRefusal = { ok: false, complete: false, reason: "pull-in-flight", gate: "advisory-in-flight",',
      '        holder: _lrHolder, at: Date.now(),',
      '        error: "Another explicit pull is already running (" + _lrHolder + "). No Athena navigation was started." };',
      '      say(_lrRefusal.error, "err");',
      '      lastPullResult = _lrRefusal;',
      '      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: _lrRefusal.error }; });',
      '      return Promise.resolve(_lrRefusal);',
      '    }'
    ])
  },

  /* ==== FIX 3b: the quota preflight (schedimport) ========================= */
  {
    file: SI, id: 'si-quota-preflight',
    why: 'diagnosis defect B fix 2: dayPull reads __mlsStoreWriteFailed and refuses LOUDLY (named reason + gate, spoken, receipt-stamped) BEFORE any Athena navigation and BEFORE arming presence - no sizeable pull until the store absorbs writes again. The flag self-clears on the next verified write, so a healthy store is never blocked. Inserted BETWEEN the advisory gate and the arm line: both pinned anchors survive verbatim and advisory<arm ordering holds.',
    find: '    if (isFn(__armPresence)) __armPresence(); /* qol-2.3: presence assist belongs to the call that passed the advisory */\n',
    replace: J([
      '    /* lr-1.0 QUOTA PREFLIGHT (diagnosis 2026-08-11 defect B): when the write',
      '       verification guard has recorded a persist failure',
      '       (window.__mlsStoreWriteFailed, qv-1.0 mls-connect) the durable store is',
      '       no longer absorbing growth - pulling more would read charts into a',
      '       store that silently drops them on reload. Refuse LOUDLY before any',
      '       Athena navigation, name the gate, and leave the same receipts every',
      '       other refusal leaves. The flag self-clears on the next verified write,',
      '       so a healthy store is never blocked. */',
      '    var _lrQuota = safe(function () { return window.__mlsStoreWriteFailed; }, null);',
      '    if (_lrQuota) {',
      '      var _lrQAge = Math.max(0, Math.round((Date.now() - Number(_lrQuota.at || Date.now())) / 60000));',
      '      var _lrQFails = Number(safe(function () { return window.__mlsQuotaGuard && window.__mlsQuotaGuard.failures; }, 0) || 0);',
      '      var _lrQRefusal = { ok: false, complete: false, reason: "storage-full-writes-failing", gate: "quota-preflight",',
      '        failures: _lrQFails, lastFailAt: Number(_lrQuota.at || 0) || null, at: Date.now(),',
      '        error: "Local storage is FULL - a save failed to persist " + (_lrQAge ? _lrQAge + " min ago" : "just now") + ", so new pull data would not survive a reload. No Athena navigation was started. Free storage space (the storage fix is in progress), then pull again." };',
      '      say(_lrQRefusal.error, "err");',
      '      lastPullResult = _lrQRefusal;',
      '      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: _lrQRefusal.error }; });',
      '      return Promise.resolve(_lrQRefusal);',
      '    }',
      '    if (isFn(__armPresence)) __armPresence(); /* qol-2.3: presence assist belongs to the call that passed the advisory */',
      ''
    ])
  },

  /* ==== FIX 3a: the persistent chip (mls-connect, qv-1.1) ================= */
  {
    file: MC, id: 'mc-qvfail-chip-now',
    why: 'the chip appears the moment the condition does, not up to 4s later on the heal tick.',
    find: '    window.__mlsStoreWriteFailed = QG.lastFail;\n',
    replace: '    window.__mlsStoreWriteFailed = QG.lastFail;\n    try { qvChip(); } catch (eQc) {} /* qv-1.1: the persistent chip appears the moment the condition does */\n'
  },
  {
    file: MC, id: 'mc-console-names-key',
    why: 'diagnosis B3: keep the console line; add the store key name to it.',
    find: "    try { console.error('[mlsQuotaGuard] persist FAILED (' + reason + ') expected~' + expected + ' stored=' + got); } catch (eC) {}",
    replace: "    try { console.error('[mlsQuotaGuard] persist FAILED (' + reason + ') key=' + qvKey() + ' expected~' + expected + ' stored=' + got); } catch (eC) {} /* qv-1.1: the line names the store KEY */"
  },
  {
    file: MC, id: 'mc-clear-updates-chip',
    why: 'the chip clears the moment the flag does (a verified write), not up to 4s later.',
    find: 'window.__mlsStoreWriteFailed = null;',
    replace: 'window.__mlsStoreWriteFailed = null; try { qvChip(); } catch (eQc2) {} /* qv-1.1: the chip clears with the flag */'
  },
  {
    file: MC, id: 'mc-chip-fn',
    why: 'qv-1.1: the chip itself. ONE owner surface bound to the existing flag; no new state. pointer-events:none so it can never eat a control (a banner once ate the pull button); role=alert; text carries the agreed wording + failure count + age. Every call site wraps it in try{}catch{} so a document-less harness is untouched.',
    find: '  QG._heal = setInterval(function () {\n',
    replace: J([
      '  /* qv-1.1 (lr-1.0 train, diagnosis 2026-08-11 defect B): a PERSISTENT surface',
      '     for a persistent condition. The 60s rate-limited toast fired ~90s before',
      '     anyone looked (quotaUIVisible: [] in the validation sweep). This chip is',
      '     owned HERE and nowhere else, is bound to window.__mlsStoreWriteFailed,',
      '     and disappears only when the flag clears - which the guard already does',
      '     on the next verified write. No new state: flag + count already exist. */',
      '  function qvChip() {',
      '    try {',
      '      var f = window.__mlsStoreWriteFailed;',
      "      var el = document.getElementById('mlsQuotaChip');",
      '      if (!f) { if (el) el.remove(); return; }',
      '      if (!el) {',
      "        el = document.createElement('div');",
      "        el.id = 'mlsQuotaChip';",
      "        el.setAttribute('role', 'alert');",
      "        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:56px;z-index:2147483000;background:#7a1f1f;color:#fff;border:1px solid #d9534f;border-radius:10px;padding:8px 14px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);pointer-events:none;max-width:92vw;text-align:center;';",
      '        (document.body || document.documentElement).appendChild(el);',
      '      }',
      '      var n = Number((window.__mlsQuotaGuard && window.__mlsQuotaGuard.failures) || 0);',
      '      var age = Math.max(0, Math.round((Date.now() - Number(f.at || Date.now())) / 60000));',
      "      var txt = 'Local storage full \\u2014 changes safe in memory+sync, storage fix in progress (' + n + ' failed save' + (n === 1 ? '' : 's') + (age ? ', last ' + age + ' min ago' : ', just now') + ')';",
      '      if (el.textContent !== txt) el.textContent = txt;',
      '    } catch (eChip) {}',
      '  }',
      '  QG._chip = qvChip;',
      '  QG._heal = setInterval(function () {',
      ''
    ])
  },
  {
    file: MC, id: 'mc-heal-renders-chip',
    why: 'the heal tick re-asserts the chip: a rerender that removed it, or a flag cleared by another path, converges within 4s. Persistent means persistent.',
    find: "    try { if (typeof window.savePatients === 'function' && !chainHasQv(window.savePatients)) qvInstall(); } catch (e) {}\n",
    replace: "    try { if (typeof window.savePatients === 'function' && !chainHasQv(window.savePatients)) qvInstall(); } catch (e) {}\n    try { qvChip(); } catch (eQh) {} /* qv-1.1: re-assert the persistent surface every heal tick */\n"
  },
  {
    file: MC, id: 'mc-revert-removes-chip',
    why: 'revert() must take the chip down with the guard - an orphaned alert with no maintainer is its own defect.',
    find: '    try { if (window.savePatients && window.savePatients.__mlsQvGuarded && window.savePatients.__mlsQvOrig) window.savePatients = window.savePatients.__mlsQvOrig; } catch (e) {}\n',
    replace: "    try { if (window.savePatients && window.savePatients.__mlsQvGuarded && window.savePatients.__mlsQvOrig) window.savePatients = window.savePatients.__mlsQvOrig; } catch (e) {}\n    try { var elQr = document.getElementById('mlsQuotaChip'); if (elQr) elQr.remove(); } catch (eQr) {} /* qv-1.1: the chip dies with the guard */\n"
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * Copied verbatim from tests/patch-daynote-foldin.js (dn-1.0, proven live),
 * including the already-applied-judged-on-REPLACE-text refusal.
 * ------------------------------------------------------------------------- */
function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    /* ALREADY APPLIED comes FIRST and is judged on the REPLACE text, not on
     * the find's absence: several edits splice by prefix/suffix (their find
     * is contained in their replace), so the find SURVIVES a correct apply.
     * If the full replacement is present exactly once, this edit is done:
     * skip when tolerated, refuse otherwise (a second --apply must never
     * double-splice). */
    if (nRepl === 1) {
      if (opts.tolerateApplied) {
        log.push({ id: e.id, file: e.file, status: 'already-applied' });
        continue;
      }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    if (nRepl !== 0 && e.replace.indexOf(e.find) !== 0 && occurrences(e.replace, e.find) === 0) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': replacement already present alongside anchor');
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const files = Array.from(new Set(EDITS.map(e => e.file)));
  const sources = {};
  for (const f of files) {
    const full = path.join(ROOT, f);
    sources[f] = fs.readFileSync(full, 'latin1');
    console.log('read  ' + f + '  (' + sources[f].length + ' bytes, latin1)');
  }

  let result;
  try {
    result = applyToSources(sources, { tolerateApplied: !APPLY });
  } catch (err) {
    console.error('\nDRY-RUN: FAIL');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED - the repo carries lr-1.0; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL - PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs a git restore of the target files before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  for (const f of files) {
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS - ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (backups outside the repo first).');
    console.log('REMINDER after apply: the three lr-1.0 suites are registered in tests/run-all.js; run the full gate.');
    return;
  }

  /* Backups go OUTSIDE the repo (public-publication-boundary refuses root
   * debris; git history is the durable rollback). */
  const os = require('os');
  const bakDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr10-bak-'));
  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(path.join(bakDir, f + '.lr10.bak'), sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + path.join(bakDir, f + '.lr10.bak') + ')');
  }
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, ROOT };
