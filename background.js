try { importScripts('feat_codes_driver.js'); } catch (e) {}
function mlsHostOnly(u){ try { return new URL(u).hostname; } catch (e) { return ''; } }
function mlsIsAthenaTab(t) {
  try { return !!(t && /(^|\.)athenanet\.athenahealth\.com$/i.test(new URL(t.url || '').hostname)); } catch (e) { return false; }
}
/* Read-side focus rail: if the focused window is currently showing any tab
 * other than the tab a legacy cleanup wants to activate, preserve the user's
 * choice unless that current tab is athenaOne itself. Reads may make Athena
 * visible in the unfocused work strip, but they must never pull a user away
 * from another app/site. Write paths intentionally do not call this helper. */
async function mlsReadFocusWouldYank(targetTabId) {
  try {
    var w = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
    var tabs = (w && w.tabs) || [], cur = null;
    for (var i = 0; i < tabs.length; i++) { if (tabs[i] && tabs[i].active) { cur = tabs[i]; break; } }
    if (!cur || (targetTabId != null && cur.id === targetTabId)) return false;
    return !mlsIsAthenaTab(cur);
  } catch (e) { return true; } /* fail closed: a read never guesses it may focus */
}
// MLS Assist — background worker. Only place that holds the API key + talks to MLS. (v1.7 robust executor)
const DEFAULT_BACKEND = 'https://scrivara-backend.onrender.com';
// Maps each global element #index → { frameId, localIndex } so the autopilot can
// read AND act inside iframes (e.g. athenaNet, which is heavily iframed). Rebuilt
// on every mlsAssistElements call, consumed by mlsAssistExec for #index targets.
const _mlsFrameMap = {};

/* ===========================================================================
 * v1.74 FOCUS GUARDIAN — never strand the doctor on athenaOne.
 * Every app-initiated operation that foregrounds a non-MLS tab records "focus
 * debt" (self.__mlsFgNote). The debt is repaid — focus returned to the MLS app
 * tab — by the FIRST of:
 *   1) the app's explicit end-of-op mlsAppFocusMlsTab (unchanged, instant; the
 *      app-side b115 no-yank double-tap re-fires it to beat stragglers);
 *   2) the watchdog: debt present and the operation has gone quiet — 90s with
 *      no bridge traffic (a slow chart read can legitimately be silent ~70s,
 *      so never sooner; this is the every-path backstop for error/abort);
 *   3) a chrome.alarms backstop, so a sleeping service worker still repays.
 * The debt is cancelled if the USER brings the MLS tab forward themselves —
 * the guardian never fights a human. Read-only: activates tabs, clicks nothing.
 * =========================================================================== */
(function () {
  const FG = { debt: false, at: 0, appTabId: null };
  self.__mlsFg = FG;
  /* Which mlsscribe tab is "the app"? v1.75: the review-finder page is ALSO on
     mlsscribe.com, so a bare host match could return the doctor to the WRONG
     page. Prefer, in order: the tab that asked (remembered as appTabId), the
     ScribeFlow app page, then any mlsscribe tab. */
  function pickAppTab(all) {
    const mine = all.filter((t) => { try { return /(^|\.)mlsscribe\.com$/i.test(new URL(t.url || '').host); } catch (e) { return false; } });
    if (!mine.length) return null;
    if (FG.appTabId != null) { const remembered = mine.find((t) => t.id === FG.appTabId); if (remembered) return remembered; }
    return mine.find((t) => /ScribeFlow/i.test(t.url || '')) || mine[0];
  }
  self.__mlsFgPickAppTab = pickAppTab;
  async function fgFocusApp() {
    FG.debt = false;
    try { chrome.storage.session.set({ mlsFgDebt: null }); } catch (e) {}
    try {
      const all = await chrome.tabs.query({});
      const app = pickAppTab(all);
      if (app && !(await mlsReadFocusWouldYank(app.id))) { await chrome.tabs.update(app.id, { active: true }); if (app.windowId != null) await chrome.windows.update(app.windowId, { focused: true }); }
    } catch (e) {}
  }
  self.__mlsFgFocusApp = fgFocusApp;
  self.__mlsFgNote = function (senderTabId) {
    FG.debt = true; FG.at = Date.now();
    if (senderTabId != null) FG.appTabId = senderTabId;
    try { chrome.storage.session.set({ mlsFgDebt: { at: FG.at } }); } catch (e) {}
    try { chrome.alarms.create('mlsFgWatch', { delayInMinutes: 1 }); } catch (e) {}
  };
  self.__mlsFgBump = function () { if (FG.debt) { FG.at = Date.now(); try { chrome.storage.session.set({ mlsFgDebt: { at: FG.at } }); } catch (e) {} } };
  self.__mlsFgEnd = function () {
    FG.debt = false;
    FG.endAt = Date.now(); /* v1.89: lets the FocusMlsTab handler tell a straggler re-tap from a stale one */
    try { chrome.storage.session.set({ mlsFgDebt: null }); } catch (e) {}
  };
  setInterval(function () {
    if (!FG.debt) return;
    if (Date.now() - FG.at > 90000) fgFocusApp();
  }, 3000);
  try {
    chrome.alarms.onAlarm.addListener(function (a) {
      if (!a || a.name !== 'mlsFgWatch') return;
      try {
        chrome.storage.session.get(['mlsFgDebt'], function (st) {
          const d = st && st.mlsFgDebt;
          if (d && d.at && (Date.now() - d.at) > 90000) fgFocusApp();
          else if (d && d.at) { try { chrome.alarms.create('mlsFgWatch', { delayInMinutes: 1 }); } catch (e) {} }
        });
      } catch (e) {}
    });
  } catch (e) {}
  try {
    chrome.tabs.onActivated.addListener(function (info) {
      try {
        chrome.tabs.get(info.tabId, function (t) {
          try { if (t && /(^|\.)mlsscribe\.com$/i.test(new URL(t.url || '').host)) { FG.debt = false; chrome.storage.session.set({ mlsFgDebt: null }); } } catch (e) {}
        });
      } catch (e) {}
    });
  } catch (e) {}
  /* every OP-FAMILY bridge message = the op is still alive; refresh the quiet
     clock. v1.76: only 'mlsApp*' messages count (and never the FocusMlsTab
     return itself) — background chatter like the Settings module's 4-second
     mlsPing or the read-only mlsFgState probe must NOT hold the debt open,
     or the watchdog can never fire. Passive listener: returns undefined so it
     never interferes with the real handlers' sendResponse channels. */
  try {
    chrome.runtime.onMessage.addListener(function (m) {
      try {
        const ty = (m && m.type) || '';
        if (ty.indexOf('mlsApp') === 0 && ty !== 'mlsAppFocusMlsTab') { self.__mlsFgBump && self.__mlsFgBump(); self.__mlsQpTouch && self.__mlsQpTouch(); }
      } catch (e) {}
    });
  } catch (e) {}
})();

/* ===========================================================================
 * v2.9.5 QUIET PULL (__mlsQp) — pulls must never steal the doctor's focus.
 * Live-measured ground truth (2026-07-13, this machine): a Chrome window that
 * is fully COVERED (or minimized) is occluded — visibilityState hidden, rAF
 * 0/s, timers 1/s then 1/min. So a pull genuinely needs the athena tab VISIBLE
 * somewhere; the old approach made it visible by foregrounding it over the
 * doctor's work (tab yank) and the guardian yanked back after — the reported
 * "keeps pulling me to the athena tab". Instead:
 *   - qpEnsure(tab, senderTabId): make athena visible WITHOUT touching focus —
 *     move it once into a narrow work-strip window on the right edge (created
 *     focused:false) without resizing/unmaximizing the user's window. Already
 *     visible -> no-op. If the strip is still occluded,
 *     visible afterwards (user re-maximized over it, another app on top),
 *     return 'limp': the read proceeds throttled under the callers' existing
 *     budgets/retries, and the strip flashes the taskbar ONCE. Never focuses.
 *   - qpRelease(): put Athena back (original window+index, while preserving the
 *     user's current non-Athena tab) — fired by end-of-run mlsAppFocusMlsTab, a 120s
 *     quiet watchdog + alarms backstop (worker restarts), and before any
 *     write op (writes keep the proven foreground-for-write behavior).
 * Quiet pulls record NO focus debt, so the guardian never yanks the doctor
 * back to MLS either. Moves/resizes windows only; clicks nothing; never
 * focuses a window the doctor is using.
 * =========================================================================== */
(function () {
  'use strict';
  var QP = { active: false, winId: null, athenaTabId: null, orig: null, soloWin: false, athOrig: null,
             hostWinId: null, hostOrig: null, lastUse: 0, flashed: false, pending: null, restoring: null };
  self.__mlsQp = QP;
  var QP_QUIET_MS = 120000; /* run considered over after 2 min without op traffic */

  function qpTouch() {
    QP.lastUse = Date.now();
    if (QP.active) { try { chrome.alarms.create('mlsQpWatch', { delayInMinutes: 1 }); } catch (e) {} }
  }
  self.__mlsQpTouch = qpTouch;

  function persist() {
    try {
      chrome.storage.session.set({ mlsQpState: QP.active ? {
        winId: QP.winId, athenaTabId: QP.athenaTabId, orig: QP.orig, soloWin: QP.soloWin,
        athOrig: QP.athOrig, hostWinId: QP.hostWinId, hostOrig: QP.hostOrig, strip: QP.strip || null, at: Date.now() } : null });
    } catch (e) {}
  }

  function tabVisible(tabId) {
    return Promise.race([
      chrome.scripting.executeScript({ target: { tabId: tabId }, func: function () { return document.visibilityState; } })
        .then(function (r) { return !!(r && r[0] && r[0].result === 'visible'); })
        .catch(function () { return false; }),
      new Promise(function (res) { setTimeout(function () { res(false); }, 4000); })
    ]);
  }

  function qpSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function ensureBody(tab, senderTabId) {
    if (await tabVisible(tab.id)) return 'visible'; /* already on screen (incl. doctor parked on athena) */

    /* strip exists? re-assert it (user may have minimized it or covered it) —
       never focus. Live-measured: an unfocused bounds update RAISES the window
       above whatever covers it without stealing focus, so re-applying the strip
       bounds is the covered-mid-run recovery. */
    if (QP.active && QP.winId != null) {
      try {
        var w0 = await chrome.windows.get(QP.winId);
        if (w0.state === 'minimized') await chrome.windows.update(QP.winId, { state: 'normal' });
        if (QP.strip) await chrome.windows.update(QP.winId, { left: QP.strip.left, top: QP.strip.top, width: QP.strip.width, height: QP.strip.height });
      } catch (e) { QP.active = false; QP.winId = null; }
    }

    if (!QP.active) {
      /* the doctor's window = the window of the asking app tab, else last focused */
      var hostWin = null;
      try { if (senderTabId != null) { var st = await chrome.tabs.get(senderTabId); hostWin = await chrome.windows.get(st.windowId); } } catch (e) {}
      if (!hostWin) { try { hostWin = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }); } catch (e) {} }
      var athWin = null;
      try { athWin = await chrome.windows.get(tab.windowId, { populate: true }); } catch (e) {}
      var soloAthena = !!(athWin && athWin.tabs && athWin.tabs.length === 1 && athWin.tabs[0].id === tab.id);
      var base = (hostWin && hostWin.state !== 'minimized') ? hostWin : athWin;
      if (!base) return 'limp';
      var b = { left: base.left | 0, top: base.top | 0, width: base.width | 0, height: base.height | 0 };
      var stripW = Math.min(780, Math.max(520, Math.floor(b.width * 0.3)));
      var strip = { left: b.left + b.width - stripW, top: b.top, width: stripW, height: b.height };

      /* Never resize/unmaximize the user's working window for a READ. The
         unfocused Athena strip overlays the right edge; if the compositor still
         occludes it, callers use their bounded limp-mode retries. */
      QP.hostWinId = null; QP.hostOrig = null;

      if (soloAthena) {
        /* athena already has its own window: just place it — never focus it */
        QP.winId = tab.windowId; QP.soloWin = true; QP.orig = null;
        QP.athOrig = athWin ? { left: athWin.left, top: athWin.top, width: athWin.width, height: athWin.height, state: athWin.state } : null;
        try {
          var aw = await chrome.windows.get(tab.windowId);
          if (aw.state !== 'normal') await chrome.windows.update(tab.windowId, { state: 'normal' });
          await chrome.windows.update(tab.windowId, { left: strip.left, top: strip.top, width: strip.width, height: strip.height });
        } catch (e) {}
      } else {
        QP.orig = { windowId: tab.windowId, index: tab.index, active: !!tab.active }; QP.soloWin = false; QP.athOrig = null;
        try {
          var nw = await chrome.windows.create({ tabId: tab.id, focused: false, type: 'normal', left: strip.left, top: strip.top, width: strip.width, height: strip.height });
          QP.winId = (nw && nw.id != null) ? nw.id : null;
        } catch (e) { QP.winId = null; }
      }
      QP.athenaTabId = tab.id; QP.active = QP.winId != null; QP.flashed = false; QP.strip = strip;
      persist();
      if (!QP.active) return 'limp';
    }

    /* the moved tab should be the active tab of the strip window */
    try { var t2 = await chrome.tabs.get(tab.id); if (!t2.active) await chrome.tabs.update(tab.id, { active: true }); } catch (e) {}
    await qpSleep(400); /* let the compositor recompute occlusion */
    if (await tabVisible(tab.id)) return 'strip';
    await qpSleep(700);
    if (await tabVisible(tab.id)) return 'strip';
    /* still covered (doctor re-maximized / another app on top): read anyway,
       throttled, under the callers' existing budgets. Nudge ONCE, never focus. */
    if (!QP.flashed) { QP.flashed = true; try { if (QP.winId != null) chrome.windows.update(QP.winId, { drawAttention: true }); } catch (e) {} }
    return 'limp';
  }

  async function qpEnsure(tab, senderTabId) {
    qpTouch();
    if (!tab || tab.id == null) return 'limp';
    while (QP.pending) { try { await QP.pending; } catch (e) {} } /* serialize window surgery */
    if (QP.restoring) { try { await QP.restoring; } catch (e) {} }
    var p = ensureBody(tab, senderTabId).catch(function () { return 'limp'; });
    QP.pending = p;
    try { return await p; } finally { if (QP.pending === p) QP.pending = null; qpTouch(); }
  }
  self.__mlsQpEnsure = qpEnsure;

  async function releaseBody() {
    /* Moving an active Athena tab back into its original window can make it the
       destination window's active tab. Snapshot the user's current non-Athena
       tab and explicitly preserve it across that move. */
    var preserveTabId = null;
    try {
      var focused = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
      var focusedTabs = (focused && focused.tabs) || [];
      for (var pi = 0; pi < focusedTabs.length; pi++) {
        if (focusedTabs[pi].active && !mlsIsAthenaTab(focusedTabs[pi])) { preserveTabId = focusedTabs[pi].id; break; }
      }
    } catch (e) {}
    /* athena tab back to its original window+index — NOT activated */
    if (!QP.soloWin && QP.athenaTabId != null && QP.orig && QP.orig.windowId != null) {
      try {
        await chrome.windows.get(QP.orig.windowId);
        await chrome.tabs.move(QP.athenaTabId, { windowId: QP.orig.windowId, index: QP.orig.index });
      } catch (e) { /* original window is gone — athena keeps its own window; harmless */ }
    }
    if (QP.soloWin && QP.winId != null && QP.athOrig) {
      try {
        await chrome.windows.update(QP.winId, { left: QP.athOrig.left, top: QP.athOrig.top, width: QP.athOrig.width, height: QP.athOrig.height });
        if (QP.athOrig.state === 'maximized') await chrome.windows.update(QP.winId, { state: 'maximized' });
      } catch (e) {}
    }
    /* doctor's window back exactly as it was */
    if (QP.hostWinId != null && QP.hostOrig) {
      try {
        await chrome.windows.update(QP.hostWinId, { left: QP.hostOrig.left, top: QP.hostOrig.top, width: QP.hostOrig.width, height: QP.hostOrig.height });
        if (QP.hostOrig.state === 'maximized' || QP.hostOrig.state === 'fullscreen') await chrome.windows.update(QP.hostWinId, { state: QP.hostOrig.state });
      } catch (e) {}
    }
    if (preserveTabId != null) {
      try {
        var preserved = await chrome.tabs.get(preserveTabId);
        var nowFocused = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
        var nowTabs = (nowFocused && nowFocused.tabs) || [], nowActive = null;
        for (var ni = 0; ni < nowTabs.length; ni++) { if (nowTabs[ni].active) { nowActive = nowTabs[ni]; break; } }
        /* If the user selected a different non-Athena tab during restoration,
           that newer choice wins. Only undo activation caused by moving Athena. */
        if (preserved && !preserved.active && (!nowActive || mlsIsAthenaTab(nowActive))) await chrome.tabs.update(preserveTabId, { active: true });
      } catch (e) {}
    }
  }

  async function qpRelease(reason) {
    if (!QP.active && QP.hostOrig == null) return;
    if (QP.restoring) { try { await QP.restoring; } catch (e) {} return; }
    if (QP.pending) { try { await QP.pending; } catch (e) {} }
    var r = releaseBody().catch(function () {});
    QP.restoring = r;
    try { await r; } finally {
      QP.restoring = null; QP.active = false; QP.winId = null; QP.orig = null; QP.soloWin = false;
      QP.athOrig = null; QP.hostWinId = null; QP.hostOrig = null; QP.athenaTabId = null; QP.flashed = false;
      try { chrome.alarms.clear('mlsQpWatch'); } catch (e) {}
      persist();
    }
  }
  self.__mlsQpRelease = qpRelease;

  /* end-of-run detection: quiet watchdog + alarm backstop (worker restarts) */
  setInterval(function () { if (QP.active && QP.lastUse && (Date.now() - QP.lastUse) > QP_QUIET_MS) { qpRelease('quiet'); } }, 5000);
  try {
    chrome.alarms.onAlarm.addListener(function (a) {
      if (!a || a.name !== 'mlsQpWatch') return;
      if (QP.active && QP.lastUse && (Date.now() - QP.lastUse) > QP_QUIET_MS) qpRelease('alarm');
      else if (QP.active) { try { chrome.alarms.create('mlsQpWatch', { delayInMinutes: 1 }); } catch (e) {} }
    });
  } catch (e) {}
  /* adopt state across service-worker restarts so the layout is never stranded */
  try {
    chrome.storage.session.get(['mlsQpState'], function (st) {
      try {
        var s = st && st.mlsQpState;
        if (!s || QP.active) return;
        QP.active = true; QP.winId = s.winId; QP.athenaTabId = s.athenaTabId; QP.orig = s.orig || null;
        QP.soloWin = !!s.soloWin; QP.athOrig = s.athOrig || null; QP.hostWinId = s.hostWinId; QP.hostOrig = s.hostOrig || null; QP.strip = s.strip || null;
        QP.lastUse = Date.now(); qpTouch();
      } catch (e) {}
    });
  } catch (e) {}
})();

// ===========================================================================
// MLS Assist NOTE WRITE-BACK ENGINE (v1.27 — "section router + verified typing
// + patient-match gate"). Injected page-context helpers + worker-scope pure
// helpers used by the panel "Insert into chart" path and the app-driven paste.
//
// Three pillars (per Michael):
//   1) RELIABLE TYPING — one verified primitive (mlsRobustType): native value
//      setter / execCommand + framework events, then simulated paste, then
//      per-character keystrokes, RE-READING the field after each so we never
//      claim success on a controlled input that silently rejected the write.
//   2) SMART FIELD ROUTING — classify the MLS content into an athenaOne section
//      (insurance / diagnoses[ICD-10] / orders[CPT] / procedure / assessment&plan
//      / hpi / physical exam / ros / note) and find the field whose LABEL + SECTION
//      HEADING context matches — insurance never lands in the note body, codes
//      never land in free-text. Reports exactly which field each piece went to.
//   3) PATIENT SAFETY GATE — before ANY write, read the MLS active patient and the
//      open Athena chart identity (name/DOB/MRN) and MATCH. Write only on a
//      confident match; otherwise refuse and warn. (mlsReadChartIdentity /
//      mlsReadActivePatient / mlsMatchPatients.)
// NOTHING here ever clicks Save/Sign — these only fill fields.
// ===========================================================================

// ---- Section label patterns (how a field's section context is recognized) ----
// Duplicated inside injected functions because injected funcs must be self-contained.
function _mlsSectDefs() {
  return [
    { key:'insurance',       label:'Insurance',
      fieldRe:/insuranc|payer|payor|subscriber|policy|member\s*id|group\s*(number|no|#)|coverage|guarantor|plan\s*name/,
      sigs:['insurance:','primary insurance','secondary insurance','payer:','payor:','policy number','policy #','policy no','member id','group number','group #','subscriber','copay','co-pay','deductible','medicare','medicaid','bcbs','blue cross','aetna','cigna','unitedhealth','united health','umr','humana','tricare'] },
    { key:'diagnoses',       label:'Diagnoses (ICD-10)',
      fieldRe:/diagnos|\bicd\b|icd-?10|problem\s*list/,
      sigs:['icd-10','icd10','icd-10-cm','diagnosis:','diagnoses:','dx:','problem list','assessment codes'] },
    { key:'orders',          label:'Orders / Procedure codes (CPT)',
      fieldRe:/orders?\b|\bcpt\b|procedure\s*code|hcpcs|billing|charge|superbill|e&m|e\/m/,
      sigs:['cpt:','cpt code','cpt-','hcpcs','procedure code','billing code','charge:','superbill','e/m level','e&m level','order:','orders:'] },
    { key:'procedure',       label:'Procedure Documentation',
      fieldRe:/procedur|operativ|op.?note|injection|fluoro|epidural|nerve\s*block|\bblock\b|aspiration|biopsy|arthrocentesis|implant|anesthesia|\btemplate\b|\besi\b|\bmbb\b|\brfa\b|surg|document/,
      sigs:['preoperative diagnos','pre-operative diagnos','postoperative diagnos','post-operative diagnos','description of procedure','procedure performed','date of operation','indications for the procedure','indications for procedure','estimated blood loss','operative note','op note','fluorosc','needle','epidural steroid','transforaminal','medial branch','radiofrequency','local anesth','under anesthesia','informed consent was obtained','time out','sterile prep','type of anesthesia'] },
    { key:'assessment_plan', label:'Assessment & Plan',
      fieldRe:/assess|\bplan\b|impression|a&p|a\/p|decision\s*making/,
      sigs:['assessment:','impression:','plan:','differential','we will','recommend','refer to','follow up in','follow-up in','medical decision'] },
    { key:'hpi',             label:'HPI',
      fieldRe:/\bhpi\b|history of present|present illness|subjective|chief complaint|interval history/,
      sigs:['chief complaint','history of present illness','hpi:','presents with','complains of','since the last visit','interval history'] },
    { key:'physical_exam',   label:'Physical Exam',
      fieldRe:/physical exam|\bpe\b|\bexam\b|objective|findings/,
      sigs:['physical exam','on exam','inspection:','palpation','range of motion','tenderness','motor strength','reflexes','straight leg raise','gait','5/5'] },
    { key:'ros',             label:'Review of Systems',
      fieldRe:/review of systems|\bros\b/,
      sigs:['review of systems','ros:','denies fever','denies chest pain','constitutional:'] },
    { key:'progress',        label:'Note',
      fieldRe:/note|progress|narrative|free.?text|encounter|impression|document|hpi|assess|plan/,
      sigs:[] }
  ];
}

// Classify note text -> best target section key. Priority order makes a whole
// op/procedure note win when present; pure code/insurance blocks route to their field.
function mlsRouteSection(text) {
  var t = String(text || '').toLowerCase();
  var defs = _mlsSectDefs();
  var order = ['procedure','insurance','orders','diagnoses','assessment_plan','hpi','physical_exam','ros'];
  var scores = {};
  defs.forEach(function (d) { var n = 0; d.sigs.forEach(function (s) { if (t.indexOf(s) >= 0) n++; }); scores[d.key] = n; });
  // bare ICD-10 codes (e.g. M54.16) boost diagnoses; 5-digit CPT (e.g. 64483) boost orders
  if (/\b[a-tv-z][0-9][0-9ab](\.[0-9a-z]{1,4})?\b/i.test(text || '')) scores.diagnoses += 1;
  if (/\b(99[0-2]\d{2}|6[24]\d{3}|20\d{3}|72\d{3})\b/.test(text || '')) scores.orders += 1;
  var bestK = 'progress', bestN = 0;
  order.forEach(function (k) { if (scores[k] > bestN) { bestN = scores[k]; bestK = k; } });
  if (bestN < 2) bestK = 'progress';
  return { section: bestK, strength: bestN, scores: scores };
}

// Split a structured MLS note into labeled segments so each part is routed to the
// matching Athena field (insurance->insurance, ICD-10->diagnoses, CPT->orders,
// op-note narrative->Procedure Documentation, etc.). If no headers are recognized,
// returns a single segment routed by mlsRouteSection. Pure/worker-scope (testable).
function mlsSegmentNote(text) {
  var src = String(text || '');
  if (!src.trim()) return [];
  // An op/procedure note is ONE document — keep it whole, route to Procedure Documentation.
  if (mlsRouteSection(src).section === 'procedure') return [{ section: 'procedure', text: src }];
  var headerMap = [
    { re:/^\s*(insurance|primary insurance|payer|payor|coverage)\s*[:\-]/i, section:'insurance' },
    { re:/^\s*(icd-?10|icd-?10-cm|diagnos(is|es)|dx)\s*[:\-]/i, section:'diagnoses' },
    { re:/^\s*(cpt|cpt codes?|procedure codes?|hcpcs|orders?|billing|charges?)\s*[:\-]/i, section:'orders' },
    { re:/^\s*(procedure|operative note|op note|procedure note|procedure documentation|description of procedure)\s*[:\-]/i, section:'procedure' },
    { re:/^\s*(assessment( and plan| ?& ?plan)?|impression|a\/p|a&p)\s*[:\-]/i, section:'assessment_plan' },
    { re:/^\s*(plan)\s*[:\-]/i, section:'assessment_plan' },
    { re:/^\s*(hpi|history of present illness|subjective|chief complaint|cc)\s*[:\-]/i, section:'hpi' },
    { re:/^\s*(physical exam(ination)?|objective|exam)\s*[:\-]/i, section:'physical_exam' },
    { re:/^\s*(review of systems|ros)\s*[:\-]/i, section:'ros' }
  ];
  var lines = src.split(/\r?\n/);
  var segs = [], cur = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var matchedSection = null;
    for (var h = 0; h < headerMap.length; h++) { if (headerMap[h].re.test(line)) { matchedSection = headerMap[h].section; break; } }
    if (matchedSection) {
      if (cur) segs.push(cur);
      cur = { section: matchedSection, text: line };
    } else if (cur) {
      cur.text += '\n' + line;
    } else {
      cur = { section: null, text: line };
    }
  }
  if (cur) segs.push(cur);
  // collapse: if 0 or 1 recognized header, treat whole note as one routed segment
  var recognized = segs.filter(function (s) { return s.section; }).length;
  if (recognized <= 1) {
    var r = mlsRouteSection(src);
    return [{ section: r.section, text: src }];
  }
  // any leading unlabeled chunk -> route by its own content
  segs = segs.map(function (s) { if (!s.section) { s.section = mlsRouteSection(s.text).section; } s.text = s.text.replace(/\s+$/,''); return s; }).filter(function (s) { return s.text.trim(); });
  var merged = [];
  segs.forEach(function (s) { var last = merged[merged.length - 1]; if (last && last.section === s.section) { last.text += '\n' + s.text; } else { merged.push({ section: s.section, text: s.text }); } });
  return merged;
}

// ---- Robust, VERIFIED text entry primitive (injected). Single source of truth. ----
// v1.28 — hardened against the modes the autopilot log flagged ("read-only, masked, or a
// typeahead that needs a selection"): resolves a real EDITABLE field from a label/wrapper,
// clicks+focuses first, native-setter + bubbling input/change (execCommand insertText for
// contenteditable), simulated paste, per-character keystrokes that drive MASKED inputs,
// then SELECTS the matching item from any TYPEAHEAD list, and re-reads to CONFIRM after a
// settle + blur. Returns confirmed:false + stuck:true with a reason when nothing sticks.
async function mlsRobustType(el, txt) {
  txt = String(txt == null ? '' : txt);
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
  function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var sib = e.nextElementSibling, k = 0; while (sib && k < 3) { if (_isEd(sib)) return sib; var inS = sib.querySelector && sib.querySelector('input:not([type=hidden]),textarea,[contenteditable]'); if (_isEd(inS)) return inS; sib = sib.nextElementSibling; k++; } } catch (e4) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
  el = _resolve(el);
  if (!el || !_isEd(el)) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'no-field', into: 0 };
  if (el.readOnly || el.disabled) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'readonly', into: 0 };
  var CE = !!el.isContentEditable;
  function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
  var masked = isMasked();
  function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
  function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
  function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
  function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
  function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  try { el.click(); } catch (e) {}
  try { el.focus(); } catch (e) {}
  await sleep(0);
  async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
  async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return { picked: false }; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return { picked: false }; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return { picked: true, label: (pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) }; }
  var method = '';
  if (!masked) {
    try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
    await sleep(0); if (landed()) method = 'native';
    if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
  }
  if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = masked ? 'mask' : 'keystroke'; }
  var sug = { picked: false }; try { sug = await pickSuggestion(); } catch (e) {}
  if (sug.picked) { await sleep(60); method = method || (landed() ? 'typeahead' : 'typeahead-selected'); }
  await sleep(120);
  if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
  if (landed()) return { ok: true, confirmed: true, stuck: false, method: method || 'native', into: rd().length, picked: !!sug.picked, pickedLabel: sug.label || '' };
  if (sug.picked) return { ok: true, confirmed: false, stuck: false, method: 'typeahead-selected', into: rd().length, picked: true, pickedLabel: sug.label || '', reason: 'selected-suggestion-unconfirmed' };
  return { ok: false, confirmed: false, stuck: true, method: 'unconfirmed', into: rd().length, reason: masked ? 'masked-rejected' : 'not-stuck' };
}

// ---- Field scanner (injected, read-only): score editable fields for a target section ----
function mlsFieldScanner(noteText, forcedSection) {
  function vis(el) { try { if (el.disabled || el.readOnly) return false; var s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < .05) return false; var r = el.getBoundingClientRect(); return r.width > 110 && r.height > 18; } catch (e) { return false; } }
  function ownLabel(el) { try { var l = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'))) || ''; if (!l && el.id) { var lb = document.querySelector('label[for="' + el.id + '"]'); if (lb) l = (lb.textContent || '').trim(); } return String(l).replace(/\s+/g, ' ').trim().slice(0, 48); } catch (e) { return ''; } }
  function sectionHeading(el) { try { var n = el, hops = 0; while (n && hops < 5) { n = n.parentElement; hops++; if (!n) break; var hd = n.querySelector && n.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]'); if (hd) { var ht = (hd.textContent || '').trim(); if (ht && ht.length <= 64) return ht.replace(/\s+/g, ' '); } var al = n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('data-section') || n.getAttribute('data-sectionname')); if (al && al.length <= 64) return String(al).replace(/\s+/g, ' '); } } catch (e) {} return ''; }
  function hay(el) { var h = ownLabel(el) + ' ' + sectionHeading(el); try { var n = el, hops = 0; while (n && hops < 4) { n = n.parentElement; hops++; if (!n) break; var al = n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('data-section') || n.getAttribute('data-sectionname') || n.getAttribute('title')); if (al) h += ' ' + al; } } catch (e) {} return String(h).toLowerCase(); }
  var DEFS = (function () { return [
    { key:'insurance', label:'Insurance', fieldRe:/insuranc|payer|payor|subscriber|policy|member\s*id|group\s*(number|no|#)|coverage|guarantor|plan\s*name/ },
    { key:'diagnoses', label:'Diagnoses (ICD-10)', fieldRe:/diagnos|\bicd\b|icd-?10|problem\s*list/ },
    { key:'orders', label:'Orders / Procedure codes (CPT)', fieldRe:/orders?\b|\bcpt\b|procedure\s*code|hcpcs|billing|charge|superbill|e&m|e\/m/ },
    { key:'procedure', label:'Procedure Documentation', fieldRe:/procedur|operativ|op.?note|injection|fluoro|epidural|nerve\s*block|\bblock\b|aspiration|biopsy|arthrocentesis|implant|anesthesia|\btemplate\b|\besi\b|\bmbb\b|\brfa\b|surg|document/ },
    { key:'assessment_plan', label:'Assessment & Plan', fieldRe:/assess|\bplan\b|impression|a&p|a\/p|decision\s*making/ },
    { key:'hpi', label:'HPI', fieldRe:/\bhpi\b|history of present|present illness|subjective|chief complaint|interval history/ },
    { key:'physical_exam', label:'Physical Exam', fieldRe:/physical exam|\bpe\b|\bexam\b|objective|findings/ },
    { key:'ros', label:'Review of Systems', fieldRe:/review of systems|\bros\b/ },
    { key:'progress', label:'Note', fieldRe:/note|progress|narrative|free.?text|encounter|impression|document|hpi|assess|plan/ }
  ]; })();
  var BAD = /search|find|lookup|filter|chat|messag|comment|reason for|\baddress\b|e-?mail|phone|\bnpi\b|\bmrn\b|patient.?id|claim|login|password|user.?name|\bzip\b|\bcity\b|\bstate\b/;
  function route(t) { t = String(t || '').toLowerCase(); var order = ['procedure','insurance','orders','diagnoses','assessment_plan','hpi','physical_exam','ros']; var SIG = {
      procedure:['preoperative diagnos','postoperative diagnos','description of procedure','date of operation','indications for procedure','estimated blood loss','operative note','op note','fluorosc','epidural steroid','medial branch','radiofrequency','under anesthesia','informed consent was obtained','type of anesthesia'],
      insurance:['insurance:','primary insurance','payer:','policy number','member id','group number','subscriber','copay','deductible','medicare','medicaid','aetna','cigna','umr'],
      orders:['cpt:','cpt code','hcpcs','procedure code','billing code','e/m level','orders:'],
      diagnoses:['icd-10','icd10','diagnosis:','diagnoses:','problem list','dx:'],
      assessment_plan:['assessment:','impression:','plan:','differential','follow up in','follow-up in','recommend'],
      hpi:['chief complaint','history of present illness','hpi:','presents with','complains of','interval history'],
      physical_exam:['physical exam','on exam','palpation','range of motion','tenderness','reflexes','straight leg raise'],
      ros:['review of systems','ros:','denies fever','constitutional:'] };
    var bestK = 'progress', bestN = 0; order.forEach(function (k) { var n = 0; (SIG[k]||[]).forEach(function (s) { if (t.indexOf(s) >= 0) n++; }); if (n > bestN) { bestN = n; bestK = k; } });
    if (bestN < 2) bestK = 'progress'; return bestK; }
  function fieldSection(h) { for (var i = 0; i < DEFS.length; i++) { if (DEFS[i].fieldRe.test(h)) return DEFS[i].key; } return 'other'; }
  var target = forcedSection || route(noteText);
  var tdef = null; for (var d = 0; d < DEFS.length; d++) { if (DEFS[d].key === target) { tdef = DEFS[d]; break; } } if (!tdef) tdef = DEFS[DEFS.length - 1];
  function score(el) { var r = el.getBoundingClientRect(); var area = Math.min(r.width * r.height, 400000); var h = hay(el); var s = area / 1000;
    if (tdef.fieldRe.test(h)) s += 2000;
    if (/note|hpi|assess|plan|soap|progress|narrative|subjective|objective|impression|free.?text|document|history of present/.test(h)) s += 400;
    if (BAD.test(h)) s -= 1800;
    if ((el.tagName || '') === 'TEXTAREA') s += 120;
    if (el.isContentEditable) s += 100;
    try { if (el === document.activeElement) s += 9000; } catch (e) {}
    return s; }
  var cs = [].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"],input[type="text"],input:not([type])')).filter(vis);
  try { var act = document.activeElement; if (act && (act.tagName === 'TEXTAREA' || act.isContentEditable || act.tagName === 'INPUT') && cs.indexOf(act) < 0) { var ar = act.getBoundingClientRect(); if (ar.width > 40 && ar.height > 12) cs.push(act); } } catch (e) {}
  var ranked = cs.map(function (el) { var h = hay(el); return { el: el, sc: score(el), sec: fieldSection(h), label: (ownLabel(el) || sectionHeading(el) || (el.tagName || '').toLowerCase()) }; }).sort(function (a, b) { return b.sc - a.sc; });
  var best = ranked[0] || null;
  var cands = [], seen = {}; ranked.forEach(function (o) { var key = (o.label || '').toLowerCase(); if (o.label && !seen[key] && cands.length < 6) { seen[key] = 1; cands.push({ label: o.label, section: o.sec }); } });
  return { has: !!best, score: best ? best.sc : -1e12, count: cs.length, target: target, targetLabel: tdef.label, chosenSection: best ? best.sec : 'other', chosenLabel: best ? best.label : '', targetMatched: best ? tdef.fieldRe.test(hay(best.el)) : false, candidates: cands };
}

// ---- Field paster (injected): find best field for the target section, write+confirm ----
// v1.28 — self-contained for injection: the caller passes the precomputed `scan` (from
// mlsFieldScanner run across frames) so this function does NOT depend on out-of-scope
// helpers, and it routes the write through a NESTED copy of the hardened mlsRobustType.
// Async (executeScript awaits the result).
async function mlsNotePaster(text, forcedSection, scan) {
  if (!scan) { try { scan = mlsFieldScanner(text, forcedSection); } catch (e) { scan = { has: false }; } }
  if (!scan || !scan.has) return { ok: false, notfound: true, target: scan && scan.target, targetLabel: scan && scan.targetLabel, candidates: scan && scan.candidates };
  function vis(el) { try { if (el.disabled || el.readOnly) return false; var s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < .05) return false; var r = el.getBoundingClientRect(); return r.width > 110 && r.height > 18; } catch (e) { return false; } }
  function ownLabel(el) { try { var l = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'))) || ''; if (!l && el.id) { var lb = document.querySelector('label[for="' + el.id + '"]'); if (lb) l = (lb.textContent || '').trim(); } return String(l).replace(/\s+/g, ' ').trim().slice(0, 48); } catch (e) { return ''; } }
  function sectionHeading(el) { try { var n = el, hops = 0; while (n && hops < 5) { n = n.parentElement; hops++; if (!n) break; var hd = n.querySelector && n.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]'); if (hd) { var ht = (hd.textContent || '').trim(); if (ht && ht.length <= 64) return ht.replace(/\s+/g, ' '); } } } catch (e) {} return ''; }
  async function _robustType(el, txt) {
    txt = String(txt == null ? '' : txt);
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
    function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
    el = _resolve(el);
    if (!el || !_isEd(el)) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'no-field', into: 0 };
    if (el.readOnly || el.disabled) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'readonly', into: 0 };
    var CE = !!el.isContentEditable;
    function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function digits(s) { return String(s || '').replace(/\D/g, ''); }
    function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
    var masked = isMasked();
    function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
    function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
    function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
    function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
    function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) {}
    try { el.focus(); } catch (e) {}
    await sleep(0);
    async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
    async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return { picked: false }; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return { picked: false }; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return { picked: true }; }
    var method = '';
    if (!masked) {
      try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
      await sleep(0); if (landed()) method = 'native';
      if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
    }
    if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = masked ? 'mask' : 'keystroke'; }
    var sug = { picked: false }; try { sug = await pickSuggestion(); } catch (e) {}
    if (sug.picked) { await sleep(60); method = method || (landed() ? 'typeahead' : 'typeahead-selected'); }
    await sleep(120);
    if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
    if (landed()) return { ok: true, confirmed: true, stuck: false, method: method || 'native', into: rd().length };
    if (sug.picked) return { ok: true, confirmed: false, stuck: false, method: 'typeahead-selected', into: rd().length };
    return { ok: false, confirmed: false, stuck: true, method: 'unconfirmed', into: rd().length, reason: masked ? 'masked-rejected' : 'not-stuck' };
  }
  var probeLabel = scan.chosenLabel;
  var cs = [].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"],input[type="text"],input:not([type])')).filter(vis);
  try { var act = document.activeElement; if (act && (act.tagName === 'TEXTAREA' || act.isContentEditable || act.tagName === 'INPUT') && cs.indexOf(act) < 0) cs.push(act); } catch (e) {}
  var best = null; for (var i = 0; i < cs.length; i++) { var lab = (ownLabel(cs[i]) || sectionHeading(cs[i]) || (cs[i].tagName || '').toLowerCase()); if (lab === probeLabel) { best = cs[i]; break; } }
  if (!best) { try { if (document.activeElement && vis(document.activeElement)) best = document.activeElement; } catch (e) {} }
  if (!best) best = cs[0] || null;
  if (!best) return { ok: false, notfound: true, target: scan.target, targetLabel: scan.targetLabel, candidates: scan.candidates };
  var wr = await _robustType(best, text);
  try { best.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {}
  return { ok: !!wr.ok, confirmed: !!wr.confirmed, stuck: !!wr.stuck, method: wr.method, into: scan.chosenLabel || (best.tagName || '').toLowerCase(), len: wr.into, target: scan.target, targetLabel: scan.targetLabel, chosenSection: scan.chosenSection, chosenLabel: scan.chosenLabel, targetMatched: scan.targetMatched, candidates: scan.candidates };
}

// ---- Patient identity reader: open Athena chart (injected, runs per frame) ----
function mlsReadChartIdentity() {
  /* v1.52 REWRITE (live-verification ISSUE 5): the v1.51 extractor could not
     parse athenaOne's real chart banner - "Adam J SCHAEFFER / 20yo M |
     03-24-2006 | #7833832" - because its name regexes required a label or a
     lowercase surname, its DOB regex required a "DOB" label, and its fallback
     matched ACROSS NEWLINES (producing garbage like "Schaeffer,\n\nThe").
     This version parses the banner first, matches LINE-BY-LINE only, accepts
     ALL-CAPS tokens, reads the bare date + #MRN next to the age/sex chip, and
     prefers chart-route frames. ES5 on purpose (offline-unit-testable). */
  var raw = (document.body && document.body.innerText || '').replace(/ /g, ' ');
  var lo = raw.toLowerCase();
  var lines = [];
  var rl = raw.split(/\n+/);
  for (var li = 0; li < rl.length && lines.length < 400; li++) {
    var t0 = rl[li].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (t0) lines.push(t0);
  }
  var AGE_CHIP = /\b(\d{1,3})\s*(?:yo|y\/o|yrs?\.?|years?\s*old)\b/i;
  var BARE_DATE = /\b([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{4})\b/;
  var MRN_HASH = /#\s?(\d{4,})/;
  var STOP1 = /^(please|the|new|find|create|search|no|today|welcome|inbox|schedule|calendar|department|provider|patient|results|appointment|encounter|billing|orders|messages)$/i;
  /* v1.59: a candidate carrying a PROVIDER credential is the doctor, never the
     patient. athenaOne v26.3's appointment exam-prep/briefing view shows only
     "Matthew Schaeffer, MD" (no patient banner) - without this, the reader
     returned the provider as the "patient" and the pull refused everything. */
  var PROVCRED = /^(MD|DO|PA|PAC|NP|CRNA|APRN|DPM|DDS|DMD|RN|CRNP|FNP|DNP|PHD|MBBS|OD|MSN|LPN|CNM|DC|DPT|DR|PHYS|PT)$/i; /* v1.67: +PHYS/PT ("Schaeffer, Phys" live phantom) */
  function looksName(s) {
    if (!s || s.length > 60) return '';
    var m = /^([A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*){1,3})$/.exec(s) ||
            /^([A-Z][A-Za-z'\-]+\s*,\s*[A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*){0,2})$/.exec(s);
    if (!m) return '';
    var cand = m[1].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var toks = cand.replace(/,/g, ' ').split(/\s+/);
    for (var q = 0; q < toks.length; q++) { if (STOP1.test(toks[q])) return ''; }
    /* final-token-only credential check: kills "Schaeffer, MD" / "Matthew Schaeffer, MD"
       without false-rejecting real surnames like "Do, John" (Do = first token there). */
    if (PROVCRED.test(toks[toks.length - 1].replace(/[.\-]/g, ''))) return '';
    if (/^DR\.?$/i.test(toks[0])) return '';
    if (!/[A-Za-z]{2}/.test(cand)) return '';
    return cand;
  }
  var name = '', dob = '', mrn = '', via = '';
  function dstr(m) { return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + m[3]; }
  /* ---- pass 1: the chart banner (name on/above the "age sex | date | #id" line) ---- */
  for (var i = 0; i < lines.length && !name; i++) {
    var L = lines[i];
    var chip = AGE_CHIP.test(L);
    var hasHash = MRN_HASH.test(L), hasDate = BARE_DATE.test(L);
    if (!(chip || (hasHash && hasDate))) continue;
    var lead = L.split(/[·|]|\d/)[0].replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    name = looksName(lead);
    /* v1.64: the live encounter banner leads "LAST, First (f) -" - junk chips after
       the name break looksName's full-string match (live: "GEHRMAN, Ruth (f) -"
       yielded NO banner name, so a junk 'lastfirst' frame won). Validate a leading
       "LAST, First" PREFIX of the lead instead. */
    if (!name) {
      var pfx = /^([A-Z][A-Za-z'\-]+\s*,\s*[A-Z][A-Za-z'\-\.]+(?:\s+[A-Z][A-Za-z'\-\.]*)?)/.exec(lead);
      if (pfx) name = looksName(pfx[1].replace(/\s+$/, ''));
    }
    /* v1.60: the redesigned exam banner renders chip lines (e.g. the "ENG"
       language badge) BETWEEN the patient name and the demographics line -
       look back up to 3 lines, skipping short chip-like lines, instead of
       exactly one (this is why "Ruth GEHRMAN" was missed live). */
    if (!name) {
      for (var lb = 1; lb <= 3 && i - lb >= 0 && !name; lb++) {
        var PL = lines[i - lb];
        name = looksName(PL);
        if (name) break;
        var chippy = PL.length <= 8 || /^[A-Z]{2,4}$/.test(PL) || !/[A-Za-z]/.test(PL);
        if (!chippy) break;
      }
    }
    if (!name) continue;
    via = 'banner';
    var bd = BARE_DATE.exec(L); if (bd) dob = dstr(bd);
    var mh = MRN_HASH.exec(L); if (mh) mrn = mh[1];
    if ((!dob || !mrn) && i + 1 < lines.length) {
      if (!dob) { var bd2 = BARE_DATE.exec(lines[i + 1]); if (bd2) dob = dstr(bd2); }
      if (!mrn) { var mh2 = MRN_HASH.exec(lines[i + 1]); if (mh2) mrn = mh2[1]; }
    }
  }
  /* ---- pass 2: labeled fields + "Last, First" - SAME-LINE only (kills the
     cross-newline "Schaeffer,\n\nThe" class of garbage) ---- */
  for (var j = 0; j < lines.length && (!name || !dob || !mrn); j++) {
    var Lj = lines[j];
    if (!dob) { var dm = /(?:dob|d\.o\.b\.|date of birth|birth date)\s*[:\-]?\s*([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})/i.exec(Lj); if (dm) dob = dm[1]; }
    if (!mrn) { var mm = /(?:mrn|medical record(?:\s*(?:no|number|#))?|chart\s*#|patient\s*id)\s*[:\-#]?\s*([a-z]?\d[a-z0-9\-]{2,})/i.exec(Lj); if (mm) mrn = mm[1]; }
    if (!name) {
      var nm = /(?:patient(?:\s*name)?|name)\s*[:\-]\s*([A-Z][A-Za-z'\-]+\s*,\s*[A-Z][A-Za-z'\-\.]+(?:\s+[A-Z]\.?)?)/.exec(Lj);
      if (nm && looksName(nm[1])) { name = nm[1]; via = via || 'label'; }
    }
    if (!name) {
      var nm2 = /\b([A-Z][A-Za-z'\-]+,\s[A-Z][A-Za-z'\-\.]+(?:\s+[A-Z]\.?)?)\b/.exec(Lj);
      if (nm2) { var cand2 = looksName(nm2[1]); if (cand2) { name = cand2; via = via || 'lastfirst'; } }
    }
  }
  /* v1.60 pass 2b: banner-style "First MIDDLE? LASTALLCAPS" line on its own
     (e.g. "Ruth GEHRMAN", "Adam J SCHAEFFER") - weakest pass, still
     credential-guarded through looksName; grabs an adjacent bare DOB when present. */
  if (!name) {
    for (var j3 = 0; j3 < lines.length && !name; j3++) {
      var m2b = /^([A-Z][a-z'\-]+(?:\s+[A-Z]\.?)?\s+[A-Z][A-Z'\-]{2,})$/.exec(lines[j3]);
      if (!m2b) continue;
      var c2b = looksName(m2b[1]);
      if (!c2b) continue;
      name = c2b; via = via || 'firstlast';
      for (var j4 = j3; j4 <= j3 + 2 && j4 < lines.length && !dob; j4++) {
        var bd3 = BARE_DATE.exec(lines[j4]); if (bd3) dob = dstr(bd3);
      }
    }
  }
  var score = (dob ? 2 : 0) + (mrn ? 2 : 0) + (name ? 1 : 0) + (via === 'banner' ? 3 : 0);
  var kws = ['problem', 'medication', 'allerg', 'vital', 'diagnos', 'assessment', 'encounter'];
  for (var k = 0; k < kws.length; k++) { if (lo.indexOf(kws[k]) >= 0) score += 0.2; }
  try {
    var href = String(location.href || '');
    if (/encounter|\/chart|briefing|clinicals|patientid=|\/patient\//i.test(href)) score += 2;
    /* v1.81: +findpatient - the search RESULTS page shows every candidate's
       name + DOB; a row must never be adopted as the open chart's identity. */
    if (/stm\.esp|globalnav|statusbar|inbox|messag|findpatient\.esp/i.test(href)) score -= 4;
    /* v1.59: letters/athenaText/communicator frames carry OTHER patients' names
       (the live "Corbin Muetterties" phantom that blocked the Adam writeback) -
       demote them hard so they can never outrank the real chart banner frame. */
    if (/letter|athenatext|communicat|\bfax|printer|documentviewer|clinicaldocument/i.test(href)) score -= 5;
  } catch (e) {}
  if (/unread messages|message thread/.test(lo)) score -= 4;
  /* v1.60: hidden/stale lurking frames (zero-size body) carry phantom patients
     ("Monterosso, ROSEMARY" / "Corbin Muetterties" 6-23-1942) - demote hard. */
  var bodyW = 0, bodyH = 0;
  try { var brc = document.body.getBoundingClientRect(); bodyW = Math.round(brc.width); bodyH = Math.round(brc.height); } catch (e) {}
  if (bodyW < 60 || bodyH < 60) score -= 6;
  /* v1.52 fix #3 (identity-DOB leak): NEVER emit a DOB/MRN without a verified
     patient NAME from the same frame - a name-less frame's labeled date (the
     live '6-23-1942' garbage) must yield a fully blank identity. */
  if (!name) { dob = ''; mrn = ''; }
  return { name: name, dob: dob, mrn: mrn, score: score, via: via, w: bodyW, h: bodyH };
}

/* ---- v1.51: DOB capture for schedule reads (worker-scope, pure, testable) ----
 * athenaOne shows DOB on schedule rows / hover cards / list views. The DOM
 * scraper returns {time,name,provider}; this pass scans the frame TEXT for a
 * plausible DOB on the same line as (or the line after) each patient's name
 * and attaches it. Conservative: no match -> no dob (never guessed). */
function mlsPlausibleDob(s) {
  var m = /^([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{4})$/.exec(String(s || '').trim());
  if (!m) return '';
  var y = +m[3], mo = +m[1], d = +m[2];
  if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  var now = new Date();
  if (y > now.getFullYear()) return '';
  /* a "DOB" equal to today is almost always the schedule date bleeding through */
  var today = (now.getMonth() + 1) + '/' + now.getDate() + '/' + now.getFullYear();
  if ((mo + '/' + d + '/' + y) === today) return '';
  return ('0' + mo).slice(-2) + '/' + ('0' + d).slice(-2) + '/' + y;
}
function mlsAttachDobs(appts, text) {
  try {
    if (!appts || !appts.length || !text) return appts || [];
    var lines = String(text).split(/\r?\n/).slice(0, 4000);
    var lo = lines.map(function (l) { return l.toLowerCase(); });
    var DATE_RE = /\b([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{4})\b/g;
    appts.forEach(function (a) {
      if (!a || a.dob || !a.name) return;
      var t = String(a.name).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 1; });
      if (t.length < 1) return;
      var first = t[0], last = t[t.length - 1];
      for (var i = 0; i < lo.length; i++) {
        if (lo[i].indexOf(last) < 0) continue;
        if (t.length > 1 && lo[i].indexOf(first) < 0) continue;
        /* same line, else the immediate next line (athena wraps DOB under the name) */
        var hay = lines[i] + ' ' + (lines[i + 1] || '');
        var m2, found = '';
        DATE_RE.lastIndex = 0;
        while ((m2 = DATE_RE.exec(hay))) { var ok = mlsPlausibleDob(m2[1]); if (ok) { found = ok; break; } }
        if (found) { a.dob = found; break; }
      }
    });
  } catch (e) {}
  return appts;
}

/* ---- v1.51: schedule DATE navigation (injected; runs inside athena frames) ----
 * Best-effort by design: PROBE reports whether hands-free date-nav controls are
 * recognizable on this page; non-probe tries them and the caller VERIFIES by
 * re-reading the displayed date. The app (b57 pull engine) falls back to guided
 * follow-mode whenever this reports unsupported/failed — honesty over bravado. */
function mlsAthenaReadHeaderDate() {
  try {
    var t = (document.body && document.body.innerText || '').slice(0, 8000);
    var M = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
    var m = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)[a-z]*[,.]?\s{0,3}([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
    if (m) { var mo = M[String(m[2]).toLowerCase()]; if (mo) return m[4] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + m[3]).slice(-2); }
    var iso = /\b(20\d\d)-(\d{2})-(\d{2})\b/.exec(t); if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var us = /\b([01]?\d)\/([0-3]?\d)\/(20\d\d)\b/.exec(t); if (us) return us[3] + '-' + ('0' + us[1]).slice(-2) + '-' + ('0' + us[2]).slice(-2);
    return '';
  } catch (e) { return ''; }
}
// v1.55: click the athenaOne "Home" logo to return to the CLINICAL SCHEDULE (home),
// so the day/month history orchestrator can re-ground between patients (each patient's
// schedule row must be on screen to open the chart). Injected into ALL frames of the
// athena tab; only the GlobalNav frame carries the logo. READ-ONLY navigation — clicks
// the logo only (never Save/Sign/any chart control).
function mlsGoHomeDriverFn() {
  try {
    function vis(el) { try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }
    var el = document.querySelector('.menuitemlogo')
          || document.querySelector('[title="athenaOne Home"]')
          || document.querySelector('[class*="athenaone_logo"],[class*="athenanetlogo"]');
    if (!el) return { clicked: false, found: false, frame: location.hostname };
    var target = el;
    try { if (!/menuitemlogo/.test((el.className || '') + '') && el.closest) { target = el.closest('.menuitemlogo') || el.closest('a,[onclick],[role=button]') || el; } } catch (e) {}
    if (!vis(target) && !vis(el)) return { clicked: false, found: true, hidden: true, frame: location.hostname };
    try { target.click(); } catch (e) { try { el.click(); } catch (e2) { return { clicked: false, found: true, error: String((e2 && e2.message) || e2) }; } }
    return { clicked: true, found: true, frame: location.hostname };
  } catch (e) { return { clicked: false, error: String((e && e.message) || e) }; }
}

/* ===================== v1.59 CHART-READY / SELF-HEAL HELPERS =====================
 * athenaOne v26.3 changed schedule-click behavior: it now opens the appointment
 * EXAM-PREP / BRIEFING view ("...recently edited this chart... REFRESH CHART"
 * stale prompt, provider-only header) where the patient banner (name+DOB) has
 * NOT rendered. Reading there returns the provider as the "patient", so the
 * identity gate (correctly) refuses and the history pull saves nothing.
 * These helpers (a) detect that state and navigate into the REAL clinical chart
 * before any read, and (b) self-heal the documented athenaOne freeze (reload ->
 * CSRF "Continue" interstitial -> session intact). Safety gates are untouched. */
function mlsSleepW(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* executeScript with a hard timeout: a frozen athenaOne renderer can hang an
 * injection forever, which used to hang the whole pull ("gohome-failed" x17).
 * Resolves { r } on success, { err } on rejection, { timeout: true } on hang. */
function mlsExecTO(opts, ms) {
  return Promise.race([
    chrome.scripting.executeScript(opts).then(function (r) { return { r: r }; }, function (e) { return { err: String((e && e.message) || e) }; }),
    mlsSleepW(ms || 15000).then(function () { return { timeout: true }; })
  ]);
}
/* Prefer a BANNER-verified identity (the real chart header) over any other
 * frame's labeled/lastfirst guess - junk frames (letters/messaging) can carry
 * OTHER patients' names and must never outrank the visible chart banner. */
function mlsBestIdentityFrom(idr) {
  var banner = null, best = null;
  (idr || []).forEach(function (m) {
    var r = m && m.result; if (!r || !r.name) return;
    if (r.via === 'banner' && (!banner || (r.score || 0) > (banner.score || 0))) banner = r;
    if (!best || (r.score || 0) > (best.score || 0)) best = r;
  });
  return banner || best;
}
/* ---- v1.78: SHADOW-DOM identity reader (injected, runs per frame) ----------
 * athenaOne v26.3 renders the patient banner of some chart surfaces (the
 * clientsummary / airlock "briefing" view) inside OPEN shadow roots:
 * document.body.innerText never contains the name, so mlsReadChartIdentity
 * honestly finds nothing and every gate refuses (the live Adam write-back
 * refusal, root-caused 07-10 via mlsIdDiag: innerBanner:false, shadowBanner:true).
 * This ADDITIVE reader walks the rendered (flat) tree of each shadow host,
 * reconstructs LINES (block tags = line breaks, <slot>s flattened, nested
 * shadow roots descended), and parses ONLY text that lives inside shadow:
 *   A) the banner drawer's label block ("Legal First Name" / "Legal Last Name" /
 *      "Date of birth" / "Patient ID", value on the FOLLOWING line), else
 *   B) the demographics chip line ("20yo M | 03-24-2006 | #7833832") with the
 *      name JOINED from the 1-3 lines rendered directly above it (the banner
 *      splits "Adam J" / "SCHAEFFER" across elements - the line-based main
 *      parser can never assemble that, which is why the 07-09 shadow attempts
 *      failed).
 * Frames with NO shadow roots return blank immediately, so plain-DOM phantom
 * sources (athenaText / letters / hidden frames) can never surface here; the
 * main reader's URL/size demotions are applied on top anyway.
 * FALLBACK ONLY: call sites use this only when mlsReadChartIdentity yielded
 * nothing acceptable - the working pull path is untouched when the classic
 * banner is readable. Identity is only emitted with BOTH name and DOB. */
function mlsReadChartIdentityShadow() {
  var blank = { name: '', dob: '', mrn: '', score: 0, via: '', w: 0, h: 0 };
  try {
    var els = document.querySelectorAll('*');
    var hosts = [];
    var capEls = Math.min(els.length, 20000);
    for (var i = 0; i < capEls; i++) { if (els[i].shadowRoot) hosts.push(els[i]); }
    if (!hosts.length) return blank;
    var BLOCK = /^(div|p|li|tr|td|th|section|header|footer|h[1-6]|ul|ol|table|article|aside|nav|form|fieldset|dl|dt|dd|pre|address|hr|br)$/;
    var AGE_CHIP = /\b(\d{1,3})\s*(?:yo|y\/o|yrs?\.?|years?\s*old)\b/i;
    var BARE_DATE = /\b([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{4})\b/;
    var MRN_HASH = /#\s?(\d{4,})/;
    var PROVCRED = /^(MD|DO|PA|PAC|NP|CRNA|APRN|DPM|DDS|DMD|RN|CRNP|FNP|DNP|PHD|MBBS|OD|MSN|LPN|CNM|DC|DPT|DR|PHYS|PT)$/i;
    var STOP1 = /^(please|the|new|find|create|search|no|today|welcome|inbox|schedule|calendar|department|provider|patient|results|appointment|encounter|billing|orders|messages|close|camera|panel)$/i;
    function dstr(m) { return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + m[3]; }
    function okName(cand) {
      if (!cand || cand.length < 4 || cand.length > 60) return '';
      var m = /^([A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*){1,3})$/.exec(cand);
      if (!m) return '';
      var toks = cand.replace(/,/g, ' ').split(/\s+/);
      for (var q = 0; q < toks.length; q++) { if (STOP1.test(toks[q])) return ''; }
      if (PROVCRED.test(toks[toks.length - 1].replace(/[.\-]/g, ''))) return '';
      if (/^DR\.?$/i.test(toks[0])) return '';
      return cand;
    }
    function collect(root, out, depth) {
      if (depth > 25 || out.n > 4000) return;
      var kids = root.childNodes || [];
      for (var k = 0; k < kids.length; k++) {
        if (out.n > 4000) return;
        var n = kids[k];
        if (n.nodeType === 3) { var s = String(n.nodeValue || '').replace(/\s+/g, ' ').trim(); if (s) { out.items.push({ t: s }); out.n++; } }
        else if (n.nodeType === 1) {
          var tag = (n.tagName || '').toLowerCase();
          if (tag === 'script' || tag === 'style') continue;
          var isB = BLOCK.test(tag);
          if (isB) { out.items.push({ nl: 1 }); out.n++; }
          try {
            if (tag === 'slot' && n.assignedNodes) {
              var an = n.assignedNodes({ flatten: true });
              for (var a = 0; a < an.length; a++) {
                if (an[a].nodeType === 3) { var s2 = String(an[a].nodeValue || '').replace(/\s+/g, ' ').trim(); if (s2) { out.items.push({ t: s2 }); out.n++; } }
                else if (an[a].nodeType === 1) collect(an[a], out, depth + 1);
              }
            } else if (n.shadowRoot) collect(n.shadowRoot, out, depth + 1);
            else collect(n, out, depth + 1);
          } catch (e) {}
          if (isB) { out.items.push({ nl: 1 }); out.n++; }
        }
      }
    }
    function toLines(items) {
      var lines = [], cur = [];
      for (var x = 0; x < items.length; x++) {
        if (items[x].nl) { if (cur.length) { lines.push(cur.join(' ')); cur = []; } }
        else cur.push(items[x].t);
      }
      if (cur.length) lines.push(cur.join(' '));
      return lines;
    }
    function labelVal(lines, re) {
      for (var i2 = 0; i2 < lines.length - 1; i2++) { if (re.test(lines[i2])) return lines[i2 + 1]; }
      return '';
    }
    var bestR = null;
    for (var h = 0; h < hosts.length; h++) {
      var out = { items: [], n: 0 };
      collect(hosts[h].shadowRoot, out, 0);
      var lines = toLines(out.items);
      if (!lines.length) continue;
      var name = '', dob = '', mrn = '', via = '';
      /* strategy A: the label block (most explicit).
         v1.88: prefer "First Name Used" over "Legal First Name" - schedules and
         rosters carry the USED name (live: roster "Bob Dunne" vs legal "Robert"
         made the app gate refuse a correctly-opened chart). Same banner, same
         DOB - identity strength is unchanged. */
      var first = labelVal(lines, /^first name used$/i) || labelVal(lines, /^legal first name$/i);
      var middle = labelVal(lines, /^middle name$/i);
      var last = labelVal(lines, /^legal last name$/i);
      var dobA = labelVal(lines, /^date of birth$/i);
      var pidA = (labelVal(lines, /^patient id$/i).match(/#?\s?(\d{4,})/) || [])[1] || '';
      var isVal = function (s) { return s && s.length <= 40 && /^[A-Z]/.test(s) && !/name|birth|patient|gender|age|detail/i.test(s); };
      if (isVal(first) && isVal(last)) {
        var comp = first + ((middle && middle.length <= 20 && isVal(middle)) ? ' ' + middle : '') + ' ' + last;
        var okA = okName(comp.replace(/\s+/g, ' ').trim());
        var dm = BARE_DATE.exec(dobA || '');
        if (okA && dm) { name = okA; dob = dstr(dm); mrn = pidA; via = 'shadow-labels'; }
      }
      /* strategy B: chip line + join of the lines rendered above it */
      if (!name) {
        for (var i3 = 0; i3 < lines.length; i3++) {
          if (!AGE_CHIP.test(lines[i3]) || !BARE_DATE.test(lines[i3])) continue;
          var bd = BARE_DATE.exec(lines[i3]);
          var dobB = dstr(bd);
          var mh = MRN_HASH.exec(lines[i3]);
          var nameB = '';
          for (var kk = 3; kk >= 1 && !nameB; kk--) {
            if (i3 - kk < 0) continue;
            nameB = okName(lines.slice(i3 - kk, i3).join(' ').replace(/\s+/g, ' ').trim());
          }
          if (nameB) { name = nameB; dob = dobB; mrn = (mh && mh[1]) || ''; via = 'shadow-banner'; break; }
        }
      }
      if (!name || !dob) continue; /* shadow identity must be FULL (name+dob) - never a weak guess */
      var score = 2 + (mrn ? 2 : 0) + 1 + 3; /* dob+name+banner-grade, like the main reader */
      try {
        var href = String(location.href || '');
        if (/encounter|\/chart|briefing|clinicals|patientid=|\/patient\/|clientsummary|airlock/i.test(href)) score += 2;
        if (/stm\.esp|globalnav|statusbar|inbox|messag|findpatient\.esp/i.test(href)) score -= 4;
        if (/letter|athenatext|communicat|\bfax|printer|documentviewer|clinicaldocument/i.test(href)) score -= 5;
      } catch (e) {}
      var bodyW = 0, bodyH = 0;
      try { var brc = document.body.getBoundingClientRect(); bodyW = Math.round(brc.width); bodyH = Math.round(brc.height); } catch (e) {}
      if (bodyW < 60 || bodyH < 60) score -= 6;
      var r = { name: name, dob: dob, mrn: mrn, score: score, via: via, w: bodyW, h: bodyH };
      if (!bestR || (via === 'shadow-labels' && bestR.via !== 'shadow-labels') || (r.score > bestR.score && !(bestR.via === 'shadow-labels' && via !== 'shadow-labels'))) bestR = r;
    }
    return bestR || blank;
  } catch (e) { return blank; }
}
/* v1.78 helper: run the shadow reader across all frames and return an acceptable
 * FULL identity (name+dob, non-negative score) or null. Call sites use it only
 * after mlsReadChartIdentity found nothing acceptable. */
var __mlsShadowTryLast = new Map(); /* v1.89: tabId -> { ts, found } - shadow-scan cooldown state */
async function mlsShadowIdentityTry(tabId) {
  /* v1.89 cooldown (review finding 8): the 8s race below ABANDONS but cannot
     CANCEL the injected querySelectorAll('*')-over-20k-elements scan, and the
     chart-ready gate re-invokes this every poll round - abandoned scans stack
     on a slow chart and worsen the very freeze the timeout guards against.
     Within ~6s of the last attempt on the SAME tab: if that attempt FOUND an
     identity, serve it from cache (a found identity may be re-requested
     freely - it just never re-injects inside the window); if it found
     NOTHING, skip and return null (no re-scan). After 6s, scan normally. */
  try {
    var prev = __mlsShadowTryLast.get(tabId);
    if (prev && (Date.now() - prev.ts) < 6000) return prev.found || null;
  } catch (eCd) {}
  var found = null;
  try {
    /* v1.81: soft 8s timeout - an allFrames injection can hang on a half-loaded
       airlock view; the fallback must never hang its caller past the app's
       bridge budget (that turns into a false "athena frozen" tab reload). */
    var raced = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, func: mlsReadChartIdentityShadow }).then(function (r) { return { r: r }; }, function () { return { r: null }; }),
      new Promise(function (res) { setTimeout(function () { res({ timeout: true }); }, 8000); })
    ]);
    if (raced && !raced.timeout && raced.r) {
      var sb = mlsBestIdentityFrom(raced.r);
      if (sb && sb.name && sb.dob && (sb.score || 0) >= 0) found = sb;
    }
  } catch (e) {}
  try { __mlsShadowTryLast.set(tabId, { ts: Date.now(), found: found }); } catch (eC2) {}
  return found;
}
/* Injected (read-only nav): detect the exam-prep/briefing state and click ONLY a
 * safe "load the real clinical chart" control - the "REFRESH CHART" prompt or a
 * plain "Chart" link. Scans control elements via textContent (no innerText/layout
 * walk - the heavy all-frames innerText scan is what froze athenaOne at 78s).
 * NEVER clicks Save/Sign/orders/check-in/anything destructive (BAD blocklist). */
function mlsEnsureClinicalChartFn() {
  try {
    var out = { frame: '', url: '', briefing: false, refreshSeen: false, clicked: '', diag: '' };
    try { out.url = String(location.href || '').slice(0, 200); out.frame = location.hostname; } catch (e0) {}
    function vis(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e) { return false; } }
    function txt(el) { return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim(); }
    var BAD = /save|sign|order|delete|discard|remove|void|submit|bill|charge|check\s*-?\s*(in|out)|prescri|refill|dispense|cancel|log\s*out|apptmnt|reschedul/i;
    var isBriefingUrl = /\/appointment\/\d+/i.test(out.url) || /briefing|exam-?prep|qualitypane/i.test(out.url);
    var ctrls = [].slice.call(document.querySelectorAll('button,a,[role=button],[role=link],[role=tab],input[type=button],input[type=submit]')).slice(0, 900);
    var refresh = null, chartLink = null, examPrep = false;
    for (var i = 0; i < ctrls.length; i++) {
      var el = ctrls[i]; var t = txt(el) || String(el.value || '').trim();
      if (!t || t.length > 60 || BAD.test(t)) continue;
      if (/refresh\s+chart/i.test(t)) { out.refreshSeen = true; if (!refresh && vis(el)) refresh = el; continue; }
      if (/go\s+to\s+exam\s+prep/i.test(t)) { examPrep = true; continue; }
      if (!chartLink && /^(full\s+chart|patient\s+chart|chart)$/i.test(t) && vis(el)) { chartLink = el; }
    }
    out.briefing = !!(out.refreshSeen || examPrep || isBriefingUrl);
    if (!out.briefing) return out;
    var pick = refresh || chartLink;
    if (pick) {
      try { pick.scrollIntoView({ block: 'center' }); } catch (e1) {}
      try {
        var r2 = pick.getBoundingClientRect(), x = r2.left + r2.width / 2, y = r2.top + r2.height / 2;
        var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
        /* pointer/mouse prelude for framework handlers, then ONE real click (no
           'click' in the dispatch list - that double-fired the control). */
        ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e2) {} });
        try { pick.click(); } catch (e3) {}
      } catch (e4) { out.diag = String((e4 && e4.message) || e4).slice(0, 80); }
      out.clicked = refresh ? 'refresh-chart' : 'chart-link';
    }
    return out;
  } catch (e) { return { clicked: '', briefing: false, error: String((e && e.message) || e).slice(0, 100) }; }
}
/* Injected: after a reload athenaNet can show the "unable to complete the
 * requested action" CSRF interstitial with Continue/Cancel. Clicking Continue
 * restores the signed-in session (documented + live-proven recovery). Clicks
 * ONLY a button whose exact text is "Continue" and only when that interstitial
 * text is actually present. */
function mlsAthenaContinueFn() {
  try {
    var body = String((document.body && document.body.innerText) || '').slice(0, 12000);
    if (!/unable to complete|could not complete|session (has )?(expired|timed)|please try again/i.test(body)) return { seen: false };
    var ctrls = [].slice.call(document.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]'));
    for (var i = 0; i < ctrls.length; i++) {
      var t = String(ctrls[i].textContent || ctrls[i].value || '').replace(/\s+/g, ' ').trim();
      if (/^continue$/i.test(t)) { try { ctrls[i].click(); } catch (e) {} return { seen: true, clicked: true }; }
    }
    return { seen: true, clicked: false };
  } catch (e) { return { seen: false, error: String((e && e.message) || e).slice(0, 80) }; }
}
/* Worker-scope: reload the athena tab (the documented freeze recovery), wait for
 * load, then clear the "Continue" interstitial if it appears. Session survives. */
var __mlsReadsSinceReload = 0;
async function mlsRecoverAthenaTab(tabId) {
  try { await chrome.tabs.reload(tabId); } catch (e) {}
  await new Promise(function (res) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; try { chrome.tabs.onUpdated.removeListener(li); } catch (e) {} res(); } }, 20000);
    function li(id, info) { if (id === tabId && info && info.status === 'complete' && !done) { done = true; clearTimeout(to); try { chrome.tabs.onUpdated.removeListener(li); } catch (e) {} res(); } }
    chrome.tabs.onUpdated.addListener(li);
  });
  await mlsSleepW(1500);
  for (var k = 0; k < 3; k++) {
    var x = await mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: mlsAthenaContinueFn }, 8000);
    var seen = ((x && x.r) || []).map(function (m) { return m && m.result; }).filter(Boolean).some(function (v) { return v.seen; });
    if (!seen) break;
    await mlsSleepW(2200);
  }
  __mlsReadsSinceReload = 0;
  try { await mlsArmKeepAlive(tabId, true); } catch (eKa) {} /* v1.95: the reload just killed the page keep-alive - re-arm it ourselves */
}
/* v1.95 KEEP-ALIVE SELF-HEALING: the gentle ~55s Worker keep-alive lives in the
 * athena page and DIES on every reload/navigation (live 07-10: the freeze-guard
 * reload killed it mid-pull; a signed-out athena then blocks everything). The
 * extension now re-arms it itself: after every mlsRecoverAthenaTab, and on each
 * athena content-script hello while an MLS app tab is open. Page-context
 * (world MAIN), idempotent, tiny synthetic mousemove + 1px scroll only - the
 * exact gentle recipe the ops handbook mandates. NEVER re-authenticates. */
self.__mlsKaArmAt = self.__mlsKaArmAt || {};
function mlsKeepAlivePageFn() {
  try { if (window.__mlsKeepAlive && window.__mlsKeepAlive.armed) return 'already'; } catch (e) {}
  try {
    var w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},55000)'], { type: 'text/javascript' })));
    var KA = { armed: true, ticks: 0, errors: 0, by: 'mls-ext', stop: function () { try { w.terminate(); } catch (e) {} KA.armed = false; } };
    w.onmessage = function () { try { KA.ticks++; document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200 + (KA.ticks % 5), clientY: 300 + (KA.ticks % 7) })); window.scrollBy(0, 1); window.scrollBy(0, -1); } catch (e) { KA.errors++; } };
    window.__mlsKeepAlive = KA;
    return 'armed';
  } catch (e) { return 'err:' + String((e && e.message) || e).slice(0, 40); }
}
async function mlsArmKeepAlive(tabId, force) {
  try {
    var last = self.__mlsKaArmAt[tabId] || 0;
    if (!force && Date.now() - last < 8000) return; /* dedupe the load+pageshow hello burst; arming is idempotent ('already'), so stay aggressive - a 60s throttle left KA dead after back-to-back navs (live: CSRF-Continue right after a reload) */
    self.__mlsKaArmAt[tabId] = Date.now();
    await mlsExecTO({ target: { tabId: tabId }, world: 'MAIN', func: mlsKeepAlivePageFn }, 5000);
  } catch (e) {}
}
/* ===================== end v1.59 helpers ===================== */

async function mlsAthenaGotoDate(target, probe) {
  /* target = 'YYYY-MM-DD' */
  var out = { found: false, via: '', done: false, schedDate: '' };
  try {
    function visible(el) { try { var r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; } catch (e) { return false; } }
    function hdr() {
      var t = (document.body && document.body.innerText || '').slice(0, 8000);
      var M = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
      var m = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)[a-z]*[,.]?\s{0,3}([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i.exec(t);
      if (m) { var mo = M[String(m[2]).toLowerCase()]; if (mo) return m[4] + '-' + ('0' + mo).slice(-2) + '-' + ('0' + m[3]).slice(-2); }
      return '';
    }
    /* v1.66 strategy 0: athenaOne v26.3 dashboard WEEK STRIP (.calendar-nav day tabs
       "Sun 7/05 · Mon 7/06 · Tue 7/07 …"). Live-proven: real-clicking a day tab switches
       the schedule widget to that day (38 rows rendered for 7/07). Week arrows step to
       other weeks. This is the ONLY date nav on the v26.3 dashboard - the legacy date
       input/day arrows below don't exist there ("No date control recognized"). */
    var cnav = document.querySelector('.calendar-nav');
    if (cnav) {
      var TABRE = /^(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}\/\d{1,2})$/i;
      function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
      function mkDate(y, m, d) { var x = new Date(y, m - 1, d, 12, 0, 0, 0); return (x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d) ? x : null; }
      var targetDate = mkDate(parseInt(target.slice(0, 4), 10), parseInt(target.slice(5, 7), 10), parseInt(target.slice(8, 10), 10));
      if (!targetDate) { out.error = 'weekstrip: invalid target date'; return out; }
      var targetMs = targetDate.getTime();
      /* v1.69: TODAY's own tab renders as "Today" (no date) - the date matcher
         stepped straight past the current week (live: goto today overshot to May). */
      var _now = new Date();
      _now = new Date(_now.getFullYear(), _now.getMonth(), _now.getDate(), 12, 0, 0, 0);
      var isTargetToday = (target === iso(_now));
      function todayTab() {
        var els = Array.prototype.slice.call(cnav.querySelectorAll('*')).filter(function (n) {
          var t = (n.textContent || '').replace(/\s+/g, ' ').trim();
          return /^today$/i.test(t) && visible(n);
        });
        els.sort(function (a, b) { return (a.textContent || '').length - (b.textContent || '').length; });
        return els[0] || null;
      }
      function fullDateAttr(n) {
        try {
          var s = [n.getAttribute('data-date'), n.getAttribute('date'), n.getAttribute('value'), n.getAttribute('href'), n.getAttribute('aria-label'), n.getAttribute('title'), n.getAttribute('onclick')].filter(Boolean).join(' ');
          var a = /(20\d{2}|19\d{2})[-\/]([01]?\d)[-\/]([0-3]?\d)/.exec(s);
          if (a) { var d1 = mkDate(+a[1], +a[2], +a[3]); if (d1) return d1; }
          var b = /([01]?\d)[-\/]([0-3]?\d)[-\/](20\d{2}|19\d{2})/.exec(s);
          if (b) { var d2 = mkDate(+b[3], +b[1], +b[2]); if (d2) return d2; }
        } catch (e) {}
        return null;
      }
      function rawTabs() {
        cnav = document.querySelector('.calendar-nav') || cnav;
        var els = Array.prototype.slice.call(cnav.querySelectorAll('*')).filter(function (n) {
          var t = (n.textContent || '').replace(/\s+/g, ' ').trim();
          return TABRE.test(t) && visible(n);
        });
        /* smallest element per label (the tab itself, not a wrapper) */
        var byLabel = {};
        els.forEach(function (n) { var t = (n.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase(); if (!byLabel[t] || (n.textContent || '').length < (byLabel[t].textContent || '').length) byLabel[t] = n; });
        var outTabs = [];
        for (var k in byLabel) {
          var m = TABRE.exec(k); if (!m) continue;
          var md = m[2].split('/');
          outTabs.push({ el: byLabel[k], label: k, month: +md[0], day: +md[1], date: fullDateAttr(byLabel[k]) });
        }
        var td = todayTab();
        if (td) outTabs.push({ el: td, label: 'today', month: _now.getMonth() + 1, day: _now.getDate(), date: new Date(_now.getTime()), today: true });
        return outTabs;
      }
      function nearestYearDate(month, day, anchor) {
        var best = null, bd = Infinity, ay = anchor.getFullYear();
        for (var yy = ay - 1; yy <= ay + 1; yy++) {
          var d = mkDate(yy, month, day); if (!d) continue;
          var gap = Math.abs(d.getTime() - anchor.getTime());
          if (gap < bd) { bd = gap; best = d; }
        }
        return best;
      }
      var h0 = hdr();
      var hp = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h0 || '');
      var weekAnchor = hp ? mkDate(+hp[1], +hp[2], +hp[3]) : null;
      if (todayTab()) weekAnchor = new Date(_now.getTime());
      if (!weekAnchor) weekAnchor = new Date(_now.getTime());
      function datedTabs() {
        var a = rawTabs();
        for (var i = 0; i < a.length; i++) { if (!a[i].date) a[i].date = nearestYearDate(a[i].month, a[i].day, weekAnchor); }
        return a.filter(function (x) { return !!x.date; });
      }
      function rangeInfo() {
        var a = datedTabs().sort(function (x, y) { return x.date - y.date; });
        return { tabs: a, min: a.length ? a[0].date.getTime() : NaN, max: a.length ? a[a.length - 1].date.getTime() : NaN };
      }
      function stripSig() {
        return rawTabs().map(function (x) { return x.label; }).sort().join('|');
      }
      function realClk(el) {
        try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
        try {
          var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
          var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
          ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (tp) { try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e2) {} });
        } catch (e3) {}
        try { el.click(); } catch (e4) {}
      }
      function findTab() {
        var tabs = datedTabs();
        for (var k = 0; k < tabs.length; k++) { if (iso(tabs[k].date) === target) return tabs[k].el; }
        if (isTargetToday) return todayTab();
        return null;
      }
      out.found = true; out.via = 'weekstrip';
      if (probe) return out;
      var tab0 = findTab();
      if (!tab0) {
        /* Target not in the visible week. Compare FULL dates (never MMDD), then
           step a distance-derived number of weeks. The 104-week ceiling keeps a
           malformed/stale strip bounded while allowing practical cross-year and
           long-range month pulls. Each step waits for the strip signature to
           change instead of sleeping a fixed 2.6s when Athena responds quickly.
           v1.68: BOTH arrows carry "icon-streamlined-next" (live trap) - only their
           CONTAINERS (.nav-prev-week / .nav-next-week) disambiguate. Live-proven:
           3 container-targeted next-week clicks reached Jul 19-25 correctly. */
        var ri0 = rangeInfo();
        if (isFinite(ri0.min) && isFinite(ri0.max)) {
          var gap0 = targetMs < ri0.min ? (ri0.min - targetMs) : (targetMs - ri0.max);
          var maxSteps = Math.min(104, Math.max(8, Math.ceil(Math.max(0, gap0) / 604800000) + 3));
          for (var st = 0; st < maxSteps && !tab0; st++) {
            var ri = rangeInfo();
            if (!isFinite(ri.min) || !isFinite(ri.max)) break;
            if (targetMs >= ri.min && targetMs <= ri.max) { tab0 = findTab(); break; }
            var wantNext = targetMs > ri.max;
            var box = cnav.querySelector(wantNext ? '.nav-next-week' : '.nav-prev-week');
            var arr = box ? (box.querySelector('.icon,span,a,button') || box) : null;
            if (!arr) { /* legacy fallback: labeled arrows */
              var aws = Array.prototype.slice.call(cnav.querySelectorAll('a,button,[role=button],span')).filter(function (el) {
                if (!visible(el)) return false;
                var lab = ((el.getAttribute('aria-label') || '') + ' ' + (el.title || '') + ' ' + (el.className || '')).toLowerCase();
                return (wantNext ? /next(?!.*prev)|forward|right/ : /prev|back|left/).test(lab) && (el.textContent || '').trim().length < 4;
              });
              arr = aws[0] || null;
            }
            if (!arr) break;
            var before = stripSig();
            realClk(arr);
            var deadline = Date.now() + 2800;
            var changed = false;
            while (Date.now() < deadline) {
              await new Promise(function (r) { setTimeout(r, 180); });
              cnav = document.querySelector('.calendar-nav') || cnav;
              var after = stripSig();
              if (after && after !== before) { changed = true; break; }
            }
            /* Never advance the inferred year/week when Athena ignored the click;
               doing so makes unchanged MM/DD labels look like a different year. */
            if (!changed) break;
            weekAnchor = new Date(weekAnchor.getTime() + (wantNext ? 604800000 : -604800000));
            tab0 = findTab();
          }
        }
      }
      if (tab0) {
        realClk(tab0);
        await new Promise(function (r) { setTimeout(r, 1400); });
        var rf = rangeInfo();
        out.done = true; out.schedDate = target; out.steps = st || 0;
        out.visibleStart = isFinite(rf.min) ? iso(new Date(rf.min)) : '';
        out.visibleEnd = isFinite(rf.max) ? iso(new Date(rf.max)) : '';
        return out;
      }
      out.done = false; out.error = 'weekstrip: target day not reachable';
      return out;
    }
    /* strategy 1: a visible date input near the schedule */
    var inputs = Array.prototype.slice.call(document.querySelectorAll('input'));
    var di = null;
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i]; if (!visible(el)) continue;
      var tp = (el.type || '').toLowerCase();
      var h = ((el.id || '') + ' ' + (el.name || '') + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.className || '')).toLowerCase();
      if (tp === 'date') { di = el; break; }
      if ((tp === 'text' || tp === '') && /\bdate\b|caldate|scheddate|datepicker/.test(h) && !/dob|birth/.test(h)) { di = el; break; }
    }
    var arrows = Array.prototype.slice.call(document.querySelectorAll('a,button,[role="button"]')).filter(function (el) {
      if (!visible(el)) return false;
      var lab = ((el.getAttribute('aria-label') || '') + ' ' + (el.title || '') + ' ' + (el.id || '') + ' ' + (el.className || '')).toLowerCase();
      return /next\s*day|prev(ious)?\s*day|day\s*(forward|back)|nextday|prevday/.test(lab);
    });
    var cur = hdr();
    out.schedDate = cur;
    if (di) out.via = 'input'; else if (arrows.length >= 1 && cur) out.via = 'arrows';
    out.found = !!out.via;
    if (probe || !out.found) return out;
    if (out.via === 'input') {
      var mm = target.slice(5, 7), dd = target.slice(8, 10), yy = target.slice(0, 4);
      var val = ((di.type || '').toLowerCase() === 'date') ? target : (mm + '/' + dd + '/' + yy);
      di.focus(); di.value = val;
      di.dispatchEvent(new Event('input', { bubbles: true })); di.dispatchEvent(new Event('change', { bubbles: true }));
      ['keydown', 'keypress', 'keyup'].forEach(function (tpx) { di.dispatchEvent(new KeyboardEvent(tpx, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); });
      out.done = true;
      return out;
    }
    /* arrows: click toward the target, re-reading the header each step */
    var guard = 0;
    while (guard++ < 45) {
      cur = hdr(); if (!cur) break;
      if (cur === target) { out.done = true; out.schedDate = cur; return out; }
      var dir = cur < target ? 1 : -1;
      var btn = null;
      for (var k = 0; k < arrows.length; k++) {
        var lab2 = ((arrows[k].getAttribute('aria-label') || '') + ' ' + (arrows[k].title || '') + ' ' + (arrows[k].id || '') + ' ' + (arrows[k].className || '')).toLowerCase();
        var isNext = /next|forward/.test(lab2);
        if ((dir === 1 && isNext) || (dir === -1 && !isNext)) { btn = arrows[k]; break; }
      }
      if (!btn) break;
      btn.click();
      await new Promise(function (r) { setTimeout(r, 700); });
    }
    out.schedDate = hdr();
    out.done = (out.schedDate === target);
    return out;
  } catch (e) { out.error = String((e && e.message) || e); return out; }
}

// ---- Patient identity reader: MLS active patient (injected, runs on mlsscribe.com tab) ----
function mlsReadActivePatient() {
  function pick(o, keys) { for (var i = 0; i < keys.length; i++) { if (o && o[keys[i]] != null && String(o[keys[i]]).trim()) return String(o[keys[i]]).trim(); } return ''; }
  var p = null;
  try { if (window.activePatient && typeof window.activePatient === 'object') p = window.activePatient; } catch (e) {}
  /* v1.71: the live app exposes activePatient as a FUNCTION - missing it made the
     MLS-side identity fall through to a DOM scan that grabbed junk ("? (05-04-1968)"
     - another patient's DOB from the visible list). */
  try { if (!p && typeof window.activePatient === 'function') { var pf = window.activePatient(); if (pf && typeof pf === 'object') p = pf; } } catch (e) {}
  try { if (!p && typeof window.getActivePtId === 'function' && typeof window.getPatients === 'function') { var id = window.getActivePtId(); var list = window.getPatients() || []; p = list.filter(function (x) { return x && (x.id === id || x.client_id === id || x.external_id === id); })[0] || null; } } catch (e) {}
  var name = '', dob = '', mrn = '';
  if (p) { name = pick(p, ['name','fullName','patientName']); if (!name) { var fn = pick(p, ['firstName','first','givenName']); var ln = pick(p, ['lastName','last','familyName']); if (ln || fn) name = (ln ? ln + ', ' : '') + fn; } dob = pick(p, ['dob','dateOfBirth','birthDate','DOB']); mrn = pick(p, ['mrn','MRN','medicalRecordNumber','chartId']); }
  if (!name || !dob) {
    // fall back to the visible unified patient card / patient bar
    /* v1.73: prefer the app's controlled beacon ([data-mls-patient-card], well-formed
       "Last, First" + DOB) over the freeform patient card, and accept a middle
       initial ("Adam J Schaeffer" - the bare regex missed it, leaving name empty). */
    try { var bar = document.querySelector('[data-mls-patient-card], #mlsPatientCard, #patientBar') || document.body; var bt = (bar.innerText || ''); if (!dob) { var dm = /([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})/.exec(bt); if (dm) dob = dm[1]; } if (!mrn) { var mm = /(?:mrn|a-?\d|chart)\s*[:#\-]?\s*([a-z]?\d[a-z0-9\-]{2,})/i.exec(bt); if (mm) mrn = mm[1]; } if (!name) { var nm = /\b([A-Z][a-z'\-]+,\s+[A-Z][a-zA-Z'\-\. ]{1,30}|[A-Z][a-z'\-]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z'\-]+)\b/.exec(bt); if (nm) name = nm[1].trim(); } } catch (e) {}
  }
  return { name: name, dob: dob, mrn: mrn };
}

// ---- Patient matcher (pure/worker-scope, testable). Conservative: default refuse. ----
function mlsMatchPatients(mls, ath) {
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }).sort(); }
  function normDob(s) { var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; }
  function normMrn(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  var mDob = normDob(mls && mls.dob), aDob = normDob(ath && ath.dob);
  var mMrn = normMrn(mls && mls.mrn), aMrn = normMrn(ath && ath.mrn);
  var mName = normName(mls && mls.name), aName = normName(ath && ath.name);
  var dobBoth = mDob && aDob, mrnBoth = mMrn && aMrn, nameBoth = mName.length && aName.length;
  var dobMatch = dobBoth && mDob === aDob;
  var mrnMatch = mrnBoth && mMrn === aMrn;
  function nameOverlap() { if (!nameBoth) return 0; var setA = {}; aName.forEach(function (w) { setA[w] = 1; }); var hit = 0; mName.forEach(function (w) { if (setA[w]) hit++; }); return hit; }
  var nameHits = nameOverlap();
  var nameMatch = nameBoth && nameHits >= 2;
  var nameContradict = nameBoth && nameHits === 0;
  // contradiction on any strong identifier => mismatch
  if ((dobBoth && !dobMatch) || (mrnBoth && !mrnMatch) || nameContradict) return { status: 'mismatch', dobMatch: dobMatch, mrnMatch: mrnMatch, nameMatch: nameMatch };
  // confident match needs a strong identifier (DOB or MRN), or a full name + one weak signal
  if (dobMatch || mrnMatch || (nameMatch && (mDob || mMrn ? false : true) && nameHits >= 2 && (mName.length >= 2))) {
    if (dobMatch || mrnMatch) return { status: 'match', dobMatch: dobMatch, mrnMatch: mrnMatch, nameMatch: nameMatch };
  }
  return { status: 'uncertain', dobMatch: dobMatch, mrnMatch: mrnMatch, nameMatch: nameMatch };
}

// ---- Procedure-template prep driver (injected, runs per frame) ----
// Drives athenaOne so the op-note has a destination: PE tab -> Procedure
// Documentation -> add the chosen procedure template (e.g. "Injection Generic
// Template") -> leaves the editable skeleton box ready. The EXISTING note paster
// (mlsNotePaster) then ERASES that skeleton and inserts the op-note. NEVER clicks
// Save/Sign. Self-contained (no out-of-scope refs) for executeScript injection.
// mode 'probe' = READ-ONLY (no clicks): report what is reachable/present.
// mode 'prep'  = perform the add-template sequence (clicks navigation only).
async function mlsAthenaPrepProcTemplate(params, mode) {
  params = params || {}; mode = mode || 'prep';
  var sectionName = String(params.sectionName || 'Procedure Documentation');
  var template = String(params.template || 'Injection Generic Template');
  var tabName = String(params.tab || 'PE');
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function vis(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05; } catch (e) { return true; } }
  function txt(el) { return ((el && (el.textContent || el.innerText)) || '').replace(/\s+/g, ' ').trim(); }
  function clickEl(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
      try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {}
    });
    try { el.click(); } catch (e) {}
  }
  function nodes(sel) { try { return [].slice.call(document.querySelectorAll(sel)); } catch (e) { return []; } }
  // shortest visible element whose text matches re (so we hit the label, not a big container)
  function findByText(re, sel) {
    var els = nodes(sel || 'button,a,[role=button],[role=tab],[role=menuitem],[role=option],li,span,div,td');
    var hits = [];
    for (var i = 0; i < els.length; i++) { var el = els[i]; if (!vis(el)) continue; var t = txt(el); if (t && t.length <= 90 && re.test(t)) hits.push({ el: el, t: t, len: t.length }); }
    hits.sort(function (a, b) { return a.len - b.len; });
    return hits;
  }
  // the editable Injection-template skeleton box (INFORMED CONSENT / PROCEDURE / DISCUSSION)
  function findTemplateBox() {
    var eds = nodes('textarea,[contenteditable=""],[contenteditable="true"]').filter(vis);
    var best = null, bs = -1;
    for (var i = 0; i < eds.length; i++) {
      var el = eds[i];
      var c = (el.value != null ? el.value : (el.innerText || el.textContent || ''));
      var lo = String(c).toLowerCase();
      var r = el.getBoundingClientRect(), s = 0;
      if (/informed consent/.test(lo)) s += 50;
      if (/\bprocedure\b/.test(lo)) s += 18;
      if (/\bdiscussion\b/.test(lo)) s += 18;
      if (/sterile|injection|tolerated the procedure|dressing was applied/.test(lo)) s += 15;
      // a sizeable box sitting under a "Procedure Documentation" heading also counts
      try { var h = el.closest && el.closest('section,div,form'); if (h && new RegExp(sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(h.textContent || '')) s += 12; } catch (e) {}
      s += Math.min(r.width * r.height, 300000) / 25000;
      if (s > bs) { bs = s; best = el; }
    }
    return (best && bs >= 12) ? { el: best, score: Math.round(bs) } : null;
  }
  function sectionReachable() {
    // a visible "Procedure Documentation" heading/section already on screen
    return findByText(new RegExp(sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'h1,h2,h3,h4,h5,h6,legend,[role=heading],div,span,a,button').length > 0;
  }

  // ---------- PROBE (read-only) ----------
  var existing = findTemplateBox();
  var tabHit = findByText(new RegExp('^' + tabName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), 'a,button,[role=tab],[role=button],li,span')[0] || null;
  var observ = {
    url: location.href, frame: (function () { try { return window.top === window; } catch (e) { return false; } })(),
    templatePresent: !!existing, templateScore: existing ? existing.score : 0,
    sectionReachable: sectionReachable(), tabFound: !!tabHit, tabName: tabName,
    sectionName: sectionName, template: template
  };
  if (mode === 'probe') { return { ok: true, mode: 'probe', ready: !!existing, observed: observ }; }

  // ---------- PREP (navigation clicks only; never Save/Sign) ----------
  // 0) already there -> nothing to do; the paster will erase+fill it.
  if (existing) return { ok: true, ready: true, alreadyPresent: true, step: 'present', observed: observ };

  var steps = [];
  var secRe = new RegExp(sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // 1) open the tab dropdown (the caret beside the tab is what opens the menu) and choose the section.
  if (!sectionReachable()) {
    var openers = [];
    nodes('[aria-haspopup],button[aria-expanded],[class*=caret],[class*=dropdown],[class*=disclosure]').filter(vis).forEach(function (e) { openers.push(e); });
    if (tabHit) openers.push(tabHit.el);  // the tab label itself, as a fallback opener
    var secItem = null;
    for (var oi = 0; oi < openers.length && !secItem; oi++) {
      clickEl(openers[oi]); steps.push('open-attempt'); await sleep(450);
      secItem = findByText(secRe, '[role=menuitem],[role=option],li,a,button,div')[0];
      if (secItem || sectionReachable()) break;
    }
    if (secItem) { clickEl(secItem.el); steps.push('clicked-section'); await sleep(700); }
    else if (!sectionReachable()) return { ok: false, ready: false, step: 'section', steps: steps, msg: 'Could not reach "' + sectionName + '" from the ' + tabName + ' tab.', observed: observ };
  }
  if (findTemplateBox()) return { ok: true, ready: true, step: 'section-had-box', steps: steps };

  // 2) open the add/picker control and select the template by typeahead.
  var addCtrl = findByText(/add|\+|procedure documentation|search|select a procedure|choose/i, 'button,[role=button],a,input,[role=combobox]')[0];
  // prefer a search/typeahead input if present
  var input = nodes('input[type=text],input:not([type]),[role=combobox] input,[contenteditable=""]').filter(vis)[0] || null;
  if (addCtrl) { clickEl(addCtrl.el); steps.push('opened-picker'); await sleep(450); input = nodes('input[type=text],input:not([type]),[role=combobox] input').filter(vis)[0] || input; }
  if (input) {
    try { input.focus(); } catch (e) {}
    try {
      var pr = (input.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(input, template); else input.value = template;
    } catch (e) { try { input.value = template; } catch (e2) {} }
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    steps.push('typed-template'); await sleep(800);
  }
  // 3) pick the matching option from the typeahead list.
  var opt = findByText(new RegExp(template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '[role=option],li,.option,.item,td,a,button,div')[0]
         || findByText(/injection generic template|injection/i, '[role=option],li,.option,.item,td,a,button,div')[0];
  if (opt) { clickEl(opt.el); steps.push('picked-template'); await sleep(900); }
  else return { ok: false, ready: false, step: 'pick', steps: steps, msg: 'Opened Procedure Documentation but could not find the "' + template + '" option to add.', observed: observ };

  // 4) wait for the editable skeleton box to render.
  for (var w = 0; w < 8; w++) { if (findTemplateBox()) return { ok: true, ready: true, step: 'added', steps: steps }; await sleep(400); }
  return { ok: false, ready: false, step: 'render', steps: steps, msg: 'Added the template but the editable box did not appear in time.', observed: observ };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mlsRobustType: mlsRobustType, mlsFieldScanner: mlsFieldScanner, mlsNotePaster: mlsNotePaster, mlsRouteSection: mlsRouteSection, mlsSegmentNote: mlsSegmentNote, mlsMatchPatients: mlsMatchPatients, mlsReadChartIdentity: mlsReadChartIdentity, mlsReadActivePatient: mlsReadActivePatient, mlsAthenaPrepProcTemplate: mlsAthenaPrepProcTemplate };
}

// ---- Procedure-template PREP handler (op-note writeback step 1) ----
// Drives athenaOne to add the chosen procedure template so the op-note has a
// destination box, OR (mode 'probe') reports READ-ONLY what is reachable. The
// actual op-note text is then written by the existing verified paste path
// (mlsAppPasteNote), which erases the skeleton and inserts the note. NEVER Save/Sign.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'mlsAppPrepProcTemplateRequest') return;
  (async () => {
    try {
      const params = msg.params || {};
      const mode = msg.mode === 'probe' ? 'probe' : 'prep';
      const isMls = (u) => /mlsscribe\.com/.test(u || '');
      let emrTab = null;
      const su = (sender && sender.tab && sender.tab.url) || '';
      if (sender && sender.tab && /^https?:/.test(su) && !isMls(su)) emrTab = sender.tab;
      if (!emrTab) { const tabs = await chrome.tabs.query({}); emrTab = await mlsPickAthenaTab(tabs, { athenaOnly: true }); if (!emrTab) { const c = tabs.filter(t => /^https?:/.test(t.url || '') && !isMls(t.url || '') && !/athena/i.test(t.url || '')); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); emrTab = c[0]; } } /* v1.90 */
      if (!emrTab) return sendResponse({ ok: false, error: 'No EMR/chart tab is open. Open the patient encounter in athenaOne, then try again.' });
      let results = [];
      /* v2.9.14 (Codex E3 classification): PROBE mode is read-only — one bounded
         retry (18s envelope, tab revalidated, short settle) on a timeout/rejected/
         empty injection. PREP mode clicks/adds a template, so an outcome-unknown
         failure must NEVER be replayed — prep runs exactly once; callers re-PROBE
         to learn whether the template is now ready before any supervised second
         attempt. */
      if (mode === 'probe') {
        for (let pTry = 0; pTry < 2 && !results.length; pTry++) {
          const px = await mlsExecTO({ target: { tabId: emrTab.id, allFrames: true }, func: mlsAthenaPrepProcTemplate, args: [params, mode] }, 18000);
          if (px && px.r && px.r.length) { results = px.r; break; }
          if (pTry === 0) { try { await chrome.tabs.get(emrTab.id); } catch (eRv) { break; } await new Promise((r) => setTimeout(r, 700)); }
        }
      } else {
        try { results = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, func: mlsAthenaPrepProcTemplate, args: [params, mode] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: emrTab.id }, func: mlsAthenaPrepProcTemplate, args: [params, mode] }); }
      }
      let best = null;
      const score = (x) => (x.ready ? 100 : 0) + (x.observed && x.observed.sectionReachable ? 5 : 0) + (x.observed && x.observed.tabFound ? 2 : 0) + ((x.steps || []).length);
      (results || []).forEach(r => { const v = r && r.result; if (!v) return; if (!best || score(v) > score(best)) best = v; });
      sendResponse(best || { ok: false, error: 'Could not run the procedure-template step in any frame.' });
    } catch (e) { sendResponse({ ok: false, error: 'Prep failed: ' + (e && e.message || e) }); }
  })();
  return true;
});


function getCfg() { return new Promise(r => chrome.storage.local.get(['mlsBackend', 'mlsKey'], r)); }

// NO-API-KEY MODE: read the doctor's LIVE MLS login token straight out of an open,
// signed-in mlsscribe.com tab (same Bearer JWT the web app uses). This means the
// extension "just works" once they're logged into MLS — nothing to generate/paste.
// Cached briefly so we don't re-scan every single agent step.
let _sessTok = '', _sessAt = 0;
async function getSessionToken() {
  if (_sessTok && (Date.now() - _sessAt) < 60000) return _sessTok;
  try {
    const tabs = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] });
    // Prefer the most-recently-used MLS tab.
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (const tab of tabs) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; } }
        });
        const tok = (r && r.result || '').trim();
        if (tok) { _sessTok = tok; _sessAt = Date.now(); return tok; }
      } catch (e) { /* tab not scriptable (still loading / restricted) — try next */ }
    }
  } catch (e) {}
  return '';
}

async function callBackend(path, body) {
  const c = await getCfg();
  const base = (c.mlsBackend || DEFAULT_BACKEND).replace(/\/+$/, '');
  let key = (c.mlsKey || '').trim();
  let viaSession = false;
  if (!key) { key = await getSessionToken(); viaSession = true; }
  if (!key) return { error: 'Not connected. Open MLS (mlsscribe.com) in a tab and sign in — MLS Assist will use your login automatically. (Or add an API key via the toolbar icon.)' };
  try {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      // A stale session token? Drop the cache and tell them to re-sign-in.
      if (viaSession && r.status === 401) { _sessTok = ''; _sessAt = 0; return { error: 'Your MLS login expired — open mlsscribe.com and sign in again, then retry.' }; }
      return { error: d.error || ('Request failed (HTTP ' + r.status + ')') };
    }
    return d;
  } catch (e) { return { error: 'Network error: ' + e.message }; }
}
// Find the signed-in EMR/Athena tab broadly (known Athena domains, else EMR-ish host keywords,
// else the most-recently-active non-MLS http(s) tab). Shared by the Mode C search handlers; the
// real resilience is content-based scoring inside the injected driver, not the tab URL.
/* v1.50: TITLE-aware athena tab test — some athenaOne windows surface "athenaCollector
   v26.x ..." / "athenaOne" only in the TAB TITLE (URL variants the regex misses), which made
   the extension report a false "not connected". Title counts as athena too. */
function mlsTabTitleAthena(t) {
  return /athena\s*(one|net|collector|clinicals|health)|athenahealth|athenaone|athenanet/i.test((t && t.title) || '') && !/mlsscribe\.com/i.test((t && t.url) || '');
}
function mlsPickEmrTab(all) {
  return all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
      || all.find((t) => mlsTabTitleAthena(t))
      || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|report|claim|billing|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''))
      || (function () { const c = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || '')); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); return c[0]; })();
}
/* ============================================================================
 * v1.90 UNIFIED ATHENA TAB PICKER — mlsPickAthenaTab(all, opts)
 * Live failure (07-10): with TWO windows holding athena tabs, the per-handler
 * inline sorts had NO lastAccessed tiebreak, so score ties kept
 * chrome.tabs.query() order (older window first) and gotoDate probed a dead/
 * signed-out tab -> {ok:true,supported:false}. identity.athenahealth.com also
 * passes the /athenahealth/ pick regexes while yielding no usable frames.
 * ONE picker for every athena-target handler:
 *  1) prefer tabs whose content script recently said hello (mlsAthenaHello);
 *  2) verify with a cheap READ-ONLY executeScript ping that must return a real
 *     frame result (.calendar-nav / frameset presence = signed-in tiebreak);
 *  3) EXCLUDE identity./login hosts — raw athenanet.athenahealth.com only;
 *  4) fall back to legacy scoring (and, when opts.athenaOnly is falsy, to a
 *     generic non-athena EMR pick).
 * Never throws. <300ms typical: single candidate = no ping; verified result
 * cached 10s (bulk pulls fire many bridge messages back-to-back).
 * Revert: delete this block and restore the per-site old_strings in §3.3.
 * ========================================================================== */
self.__mlsAthReg = self.__mlsAthReg || {};            /* tabId -> last hello (ms) */
self.__mlsAthPickCache = self.__mlsAthPickCache || { tabId: null, at: 0 };
try { chrome.storage.session.get(['mlsAthReg'], function (st) { try { var m = st && st.mlsAthReg; if (m && typeof m === 'object') { for (var k in m) { if (self.__mlsAthReg[k] == null) self.__mlsAthReg[k] = m[k]; } } } catch (e) {} }); } catch (e) {}
try {
  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (!msg || msg.type !== 'mlsAthenaHello' || !sender || !sender.tab || sender.tab.id == null) return;
    try {
      var h = ''; try { h = new URL(sender.tab.url || '').host.toLowerCase(); } catch (e0) {}
      if (h !== 'athenanet.athenahealth.com') return; /* registration = raw product host ONLY */
      self.__mlsAthReg[sender.tab.id] = Date.now();
      try { chrome.storage.session.set({ mlsAthReg: self.__mlsAthReg }); } catch (e1) {}
      /* v1.95: self-heal the page keep-alive whenever MLS is in use (an app tab
         exists). Throttled inside mlsArmKeepAlive; never on login/identity hosts
         (this handler already returned for those). */
      try {
        var __kaTid = sender.tab.id;
        chrome.tabs.query({ url: '*://mlsscribe.com/*' }, function (apps) {
          /* v1.99: a PINNED tab keeps its keep-alive even with no app tab open -
             the pin IS the user's standing walk-away instruction. */
          var pinnedHere = false; try { pinnedHere = !!(self.__mlsAthPin && self.__mlsAthPin.tabId === __kaTid); } catch (e4) {}
          try { if (((apps && apps.length) || pinnedHere) && typeof mlsArmKeepAlive === 'function') mlsArmKeepAlive(__kaTid); } catch (e2) {}
        });
      } catch (e3) {}
    } catch (e) {}
    /* passive: no sendResponse -> port not held (v1.42 rule) */
  });
} catch (e) {}
try { chrome.tabs.onRemoved.addListener(function (tid) { try { delete self.__mlsAthReg[tid]; if (self.__mlsAthPickCache.tabId === tid) self.__mlsAthPickCache.tabId = null; chrome.storage.session.set({ mlsAthReg: self.__mlsAthReg }); } catch (e) {} }); } catch (e) {}
function mlsAthTabHost(t) { try { return new URL((t && t.url) || '').host.toLowerCase(); } catch (e) { return ''; } }
function mlsAthIsLoginish(t) {
  var h = mlsAthTabHost(t), u = ((t && t.url) || '').toLowerCase();
  if (/^(identity|login|signin|sso|auth|accounts|okta|myapps)\./.test(h)) return true;
  return /aws\.caas|\/login\b|sign-?in|\/auth\b|\/authn\b|\/oauth|\.oauth2\b|\/sso\b|accounts\.|\bwww\.athenahealth\.com\b|landing|portal|marketing/.test(u);
}
function mlsAthScore(t) {
  var u = ((t && t.url) || '').toLowerCase(), s = 0;
  if (mlsAthTabHost(t) === 'athenanet.athenahealth.com') s += 100;
  if (/athena/i.test((t && t.title) || '')) s += 60;
  if (/globalframeset|\/ax\/|dashboard|schedul|calendar|frontoffice|encounter/.test(u)) s += 40;
  if (mlsAthIsLoginish(t)) s -= 500;
  try { var hb = (self.__mlsAthReg || {})[t.id]; if (hb && (Date.now() - hb) < 300000) s += 80; } catch (e) {}
  if (t && t.active) s += 5;
  if (t && (t.discarded || t.status === 'unloaded')) s -= 300;
  return s;
}
function mlsAthPing(tabId, ms) { /* READ-ONLY reachability probe: must return >=1 real frame result */
  return mlsExecTO({ target: { tabId: tabId, allFrames: true }, func: function () {
    try { return { p: 1, cal: !!document.querySelector('.calendar-nav'), fs: !!document.querySelector('frameset,frame,iframe') }; } catch (e) { return { p: 1 }; }
  } }, ms || 1200).then(function (x) {
    var fr = ((x && x.r) || []).map(function (m) { return m && m.result; }).filter(Boolean);
    if (!fr.length) return { alive: false };
    return { alive: true, cal: fr.some(function (f) { return f.cal; }), fs: fr.some(function (f) { return f.fs; }) };
  }).catch(function () { return { alive: false }; });
}
function mlsPickGenericEmrTab(all) { /* non-athena EMR fallback (athena candidates were already considered+rejected) */
  try {
    return all.find(function (t) { return /epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|report|claim|billing|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com|athena/i.test((t.url || '') + ' ' + (t.title || '')); })
        || (function () { var c = all.filter(function (t) { return /^https?:/i.test(t.url || '') && !/mlsscribe\.com|athena|chrome:\/\//i.test((t.url || '') + ' ' + (t.title || '')); }); c.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); }); return c[0] || null; })();
  } catch (e) { return null; }
}
async function mlsPickAthenaTab(all, opts) {
  opts = opts || {};
  try {
    /* v1.99 TAB PIN: the user explicitly handed this athena tab to MLS via the
       tab picker - it wins over every heuristic below. A pinned tab sitting on a
       login/identity page means the SESSION DROPPED: return null so athenaOnly
       callers fail honestly and the picker surfaces 'signed out' - NEVER re-auth,
       never silently fall back to some other tab the user didn't choose. A
       CLOSED pinned tab auto-unpins (also handled by onRemoved). */
    var pin = self.__mlsAthPin;
    if (pin && pin.tabId != null) {
      var pt = null; try { pt = await chrome.tabs.get(pin.tabId); } catch (eP) { pt = null; }
      if (!pt) { try { mlsPinSet(null); } catch (eP2) {} }
      else if (mlsAthTabHost(pt) === 'athenanet.athenahealth.com' && !mlsAthIsLoginish(pt)) return pt;
      else return null;
    }
    if (!all) { try { all = await chrome.tabs.query({}); } catch (e0) { all = []; } }
    var http = (all || []).filter(function (t) { return t && t.id != null && /^https?:/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''); });
    var known = http.filter(function (t) { return /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || '') || mlsTabTitleAthena(t); });
    if (!known.length) return opts.athenaOnly ? null : mlsPickGenericEmrTab(http);
    known.sort(function (a, b) { return (mlsAthScore(b) - mlsAthScore(a)) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)) || ((b.id || 0) - (a.id || 0)); });
    if (mlsAthScore(known[0]) < 0) return opts.athenaOnly ? null : mlsPickGenericEmrTab(http); /* every athena tab is an identity/login page */
    var C = self.__mlsAthPickCache;
    if (C.tabId != null && (Date.now() - C.at) < 10000) { var cached = known.find(function (t) { return t.id === C.tabId; }); if (cached && mlsAthScore(cached) >= 0) return cached; }
    var pick = known[0];
    if (known.length > 1 && !opts.noPing) {
      var alive = null, shell = null;
      for (var i = 0; i < known.length && i < 3; i++) {
        if (mlsAthScore(known[i]) < 0) break;           /* never ping login pages */
        var pr = await mlsAthPing(known[i].id, 1200);
        if (!pr.alive) continue;
        if (!alive) alive = known[i];
        if (pr.cal || pr.fs) { shell = known[i]; break; } /* signed-in athenanet shell */
      }
      /* nothing alive: KEEP the top-scored pick — go-home freeze recovery must
         still receive the frozen tab so mlsRecoverAthenaTab can reload it. */
      pick = shell || alive || known[0];
    }
    C.tabId = pick.id; C.at = Date.now();
    return pick;
  } catch (e) {
    try { return (typeof mlsPickEmrTab === 'function') ? mlsPickEmrTab(all || []) : null; } catch (e2) { return null; }
  }
}
self.__mlsPickAthenaTab = mlsPickAthenaTab; /* console/diag handle */

/* ===================== v1.99 ATHENA TAB PIN (tab-picker backend) ==============
 * The user hands MLS an already-open athena tab from the in-app picker chip.
 * Pinned tab: wins every pick; keep-alive armed immediately and re-checked by a
 * 5-minute alarm (idempotent, gentle - the same 55s Worker keep-alive, never
 * setInterval, no heavy scans); never navigated except during a pull the user
 * started; if its session drops (login page) athena-side work pauses and the
 * picker shows 'signed out' - NEVER re-auth. Survives SW restarts (storage.session). */
self.__mlsAthPin = self.__mlsAthPin || { tabId: null, at: 0 };
try { chrome.storage.session.get(['mlsAthPin'], function (st) { try { var p = st && st.mlsAthPin; if (p && p.tabId != null && self.__mlsAthPin.tabId == null) self.__mlsAthPin = p; } catch (e) {} }); } catch (e) {}
function mlsPinSet(tabId) {
  self.__mlsAthPin = { tabId: (tabId == null ? null : tabId), at: Date.now() };
  try { chrome.storage.session.set({ mlsAthPin: self.__mlsAthPin }); } catch (e) {}
  try { if (tabId == null) chrome.alarms.clear('mlsPinWatch'); else chrome.alarms.create('mlsPinWatch', { periodInMinutes: 5 }); } catch (e) {}
}
async function mlsPinInfo() {
  var pin = self.__mlsAthPin || {};
  var out = { pinned: pin.tabId != null, tabId: pin.tabId == null ? null : pin.tabId, alive: false, signedOut: false, ka: '', title: '' };
  if (!out.pinned) return out;
  var t = null; try { t = await chrome.tabs.get(pin.tabId); } catch (e) { t = null; }
  if (!t) { mlsPinSet(null); out.pinned = false; out.tabId = null; return out; }
  out.title = String(t.title || '').slice(0, 70);
  if (mlsAthIsLoginish(t) || mlsAthTabHost(t) !== 'athenanet.athenahealth.com') { out.signedOut = true; return out; }
  var pr = await mlsAthPing(t.id, 1500);
  out.alive = !!pr.alive;
  try {
    var kx = await mlsExecTO({ target: { tabId: t.id }, world: 'MAIN', func: function () { try { return { armed: !!(window.__mlsKeepAlive && window.__mlsKeepAlive.armed), ticks: (window.__mlsKeepAlive && window.__mlsKeepAlive.ticks) || 0 }; } catch (e) { return { armed: false, ticks: 0 }; } } }, 2500);
    var kr = kx && kx.r && kx.r[0] && kx.r[0].result;
    if (kr) out.ka = kr.armed ? ('armed · ' + kr.ticks + ' ticks') : 'not armed';
  } catch (e) {}
  return out;
}
try { chrome.tabs.onRemoved.addListener(function (tid) { try { if (self.__mlsAthPin && self.__mlsAthPin.tabId === tid) mlsPinSet(null); } catch (e) {} }); } catch (e) {}
try {
  chrome.alarms.onAlarm.addListener(function (a) {
    if (!a || a.name !== 'mlsPinWatch') return;
    (async function () {
      try {
        var pin = self.__mlsAthPin;
        if (!pin || pin.tabId == null) { try { chrome.alarms.clear('mlsPinWatch'); } catch (e) {} return; }
        var t = null; try { t = await chrome.tabs.get(pin.tabId); } catch (e) { t = null; }
        if (!t) { mlsPinSet(null); return; }
        if (mlsAthIsLoginish(t)) return; /* session dropped: surface via pin state only - NEVER re-auth */
        await mlsArmKeepAlive(pin.tabId); /* idempotent gentle re-arm (walk-away guarantee) */
      } catch (e) {}
    })();
  });
} catch (e) {}
/* =================== end v1.99 athena tab pin ================================ */

/*MLS_ATHENA_DRIVE_START*/
async function mlsAthenaDrive(op, params, cfg) {
  params = params || {}; cfg = cfg || {};
  var D = (typeof document !== 'undefined') ? document : null;
  if (!D) return { ok: false, error: 'no-document' };
  function arr(x) { return Array.isArray(x) ? x : []; }
  function lc(x) { return String(x == null ? '' : x).toLowerCase(); }
  var C = {
    cptFieldLabels:   arr(cfg.cptFieldLabels).length   ? cfg.cptFieldLabels   : ['cpt', 'procedure code', 'proc code', 'service code', 'hcpcs', 'code'],
    procFieldLabels:  arr(cfg.procFieldLabels).length  ? cfg.procFieldLabels  : ['procedure', 'service', 'description', 'exam', 'visit type'],
    dateFromLabels:   arr(cfg.dateFromLabels).length   ? cfg.dateFromLabels   : ['service date from', 'date of service from', 'dos from', 'date from', 'start date', 'from date', 'from', 'start', 'begin'],
    dateToLabels:     arr(cfg.dateToLabels).length     ? cfg.dateToLabels     : ['service date to', 'date of service to', 'dos to', 'date to', 'end date', 'to date', 'through', 'thru', 'to', 'end'],
    runLabels:        arr(cfg.runLabels).length        ? cfg.runLabels        : ['run report', 'run', 'search', 'view report', 'generate', 'go', 'apply', 'find', 'filter', 'submit', 'update'],
    nextLabels:       arr(cfg.nextLabels).length       ? cfg.nextLabels       : ['next page', 'next', '›', '»', '>', 'older', 'show more', 'load more', 'more results'],
    nextSelectors:    arr(cfg.nextSelectors).length    ? cfg.nextSelectors    : ['a[rel="next"]', '[aria-label*="next" i]', '.pagination .next a', 'li.next a', 'button[title*="next" i]', '[data-page="next"]', '.paging-next', '.next-page'],
    rowSelectors:     arr(cfg.rowSelectors).length     ? cfg.rowSelectors     : ['table tbody tr', '[role="row"]', '.result-row', '.report-row', '.GridRow', '.athena-row', 'tr'],
    excludeClickLabels: arr(cfg.excludeClickLabels).length ? cfg.excludeClickLabels : ['save', 'sign', 'finalize', 'close encounter', 'post', 'delete', 'remove', 'discard', 'bill', 'submit claim', 'approve', 'void', 'cancel appointment'],
    maxRowChars: cfg.maxRowChars || 44000
  };

  function vis(el) {
    try {
      if (!el) return false;
      var win = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
      var s = (win && win.getComputedStyle) ? win.getComputedStyle(el) : null;
      if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
      if (el.hidden) return false;
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
      return true;
    } catch (e) { return true; }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
  function labelText(el) {
    var parts = [];
    try { ['aria-label', 'placeholder', 'title', 'name', 'id'].forEach(function (k) { var v = el.getAttribute && el.getAttribute(k); if (v) parts.push(v); }); } catch (e) {}
    try { if (el.id) { var lb = D.querySelector('label[for="' + cssEsc(el.id) + '"]'); if (lb && lb.textContent) parts.push(lb.textContent); } } catch (e) {}
    try { var wrap = el.closest && el.closest('label'); if (wrap && wrap.textContent) parts.push(wrap.textContent); } catch (e) {}
    try { var prev = el.previousElementSibling, hop = 0; while (prev && hop < 2) { var pt = (prev.textContent || '').trim(); if (pt && pt.length < 40) parts.push(pt); prev = prev.previousElementSibling; hop++; } } catch (e) {}
    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function hasAny(hay, labels) { for (var i = 0; i < labels.length; i++) { var l = lc(labels[i]); if (l && hay.indexOf(l) >= 0) return true; } return false; }
  function editableInputs() {
    var nodes = [].slice.call(D.querySelectorAll('input,textarea,[contenteditable=""],[contenteditable="true"]'));
    return nodes.filter(function (el) {
      var tg = (el.tagName || '').toUpperCase();
      if (tg === 'INPUT') { var t = lc(el.getAttribute('type') || 'text'); if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'].indexOf(t) >= 0) return false; }
      return vis(el);
    });
  }
  function findField(labels) {
    var ins = editableInputs(), best = null, bestS = -1;
    ins.forEach(function (el) {
      var hay = labelText(el), s = 0;
      labels.forEach(function (l, idx) { l = lc(l); if (l && hay.indexOf(l) >= 0) { s += 10 + (labels.length - idx); if (hay === l || hay.indexOf(l) === 0) s += 3; } });
      if (s > bestS) { bestS = s; best = el; }
    });
    return bestS > 0 ? best : null;
  }
  function findDateField(labels) {
    var ins = editableInputs(), best = null, bestS = -1;
    ins.forEach(function (el) {
      var hay = labelText(el), s = 0;
      labels.forEach(function (l) { l = lc(l); if (l && hay.indexOf(l) >= 0) s += 10; });
      var t = lc(el.getAttribute && el.getAttribute('type'));
      if (t === 'date') s += 4;
      if (/date|dob|dos/.test(hay)) s += 2;
      if (s > bestS) { bestS = s; best = el; }
    });
    return bestS > 0 ? best : null;
  }
  function clickables() { return [].slice.call(D.querySelectorAll('button,a,[role="button"],input[type="submit"],input[type="button"]')).filter(vis); }
  function btnText(el) { var t = (el.textContent || '') + ' ' + (el.value || '') + ' ' + labelText(el); return t.replace(/\s+/g, ' ').trim().toLowerCase(); }
  function findButton(labels) {
    var bs = clickables(), best = null, bestS = -1;
    bs.forEach(function (el) {
      var t = btnText(el); if (hasAny(t, C.excludeClickLabels)) return;
      var s = 0; labels.forEach(function (l, idx) { l = lc(l); if (!l) return; if (t === l) s += 20; else if (t.indexOf(l) >= 0) s += 10 + (labels.length - idx); });
      if (s > bestS) { bestS = s; best = el; }
    });
    return bestS > 0 ? best : null;
  }
  function isDisabled(el) {
    try {
      if (el.disabled) return true;
      if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
      if (/\bdisabled\b/.test((el.className || '') + '')) return true;
      if (el.closest && el.closest('.disabled,[aria-disabled="true"]')) return true;
    } catch (e) {}
    return false;
  }
  function findNext() {
    for (var i = 0; i < C.nextSelectors.length; i++) {
      try { var el = D.querySelector(C.nextSelectors[i]); if (el && vis(el) && !isDisabled(el)) { var t = btnText(el); if (!hasAny(t, C.excludeClickLabels)) return el; } } catch (e) {}
    }
    var bs = clickables(), best = null;
    for (var j = 0; j < bs.length; j++) {
      var e = bs[j]; if (isDisabled(e)) continue; var tt = btnText(e); if (hasAny(tt, C.excludeClickLabels)) continue;
      for (var k = 0; k < C.nextLabels.length; k++) { var l = lc(C.nextLabels[k]); if (!l) continue; if (tt === l) return e; if (tt.length <= 14 && tt.indexOf(l) >= 0) { best = best || e; } }
    }
    return best;
  }
  function extractRows() {
    var bestText = '', bestCount = 0, used = '';
    for (var i = 0; i < C.rowSelectors.length; i++) {
      try {
        var rows = [].slice.call(D.querySelectorAll(C.rowSelectors[i])).filter(vis);
        if (rows.length >= 2) {
          var txt = rows.map(function (r) { return ((r.innerText || r.textContent || '') + '').replace(/\s+/g, ' ').trim(); }).filter(function (s) { return s.length > 2; }).join('\n');
          if (rows.length > bestCount && txt) { bestCount = rows.length; bestText = txt; used = C.rowSelectors[i]; }
        }
      } catch (e) {}
    }
    if (!bestText) { try { bestText = (((D.body && (D.body.innerText || D.body.textContent)) || '') + '').slice(0, C.maxRowChars); } catch (e) {} }
    return { text: bestText.slice(0, C.maxRowChars), count: bestCount, selector: used };
  }
  function sigOf(s) { s = String(s || ''); var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return ((h >>> 0).toString(36)) + ':' + s.length; }
  function scoreReportSelf() {
    try {
      var t = (((D.body && (D.body.innerText || D.body.textContent)) || '') + ''), tl = t.toLowerCase(), s = 0;
      var dates = (t.match(/\b[01]?\d[\/\-][0-3]?\d[\/\-]\d{2,4}\b/g) || []).length; s += Math.min(dates, 200) * 2;
      var cpts = (t.match(/\b\d{5}\b/g) || []).length; s += Math.min(cpts, 200) * 1.5;
      ['cpt', 'procedure', 'service date', 'dos', 'claim', 'charge', 'mrn', 'dob', 'patient'].forEach(function (k) { if (tl.indexOf(k) >= 0) s += 5; });
      return Math.round(s);
    } catch (e) { return 0; }
  }
  function fireClick(el) {
    try { el.scrollIntoView && el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var V = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
      try { var Ctor = (V && (tp.indexOf('pointer') === 0 ? V.PointerEvent : V.MouseEvent)) || (V && V.Event); el.dispatchEvent(new Ctor(tp, { bubbles: true, cancelable: true })); }
      catch (e) { try { el.dispatchEvent(new Event(tp, { bubbles: true })); } catch (e2) {} }
    });
    try { el.click && el.click(); } catch (e) {}
  }
  function fmtDate(el, ymd) {
    var t = lc(el.getAttribute && el.getAttribute('type'));
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '')); if (!m) return ymd;
    if (t === 'date') return ymd; return m[2] + '/' + m[3] + '/' + m[1];
  }
  async function typeInto(el, val) {
    val = String(val == null ? '' : val);
    try { el.focus && el.focus(); } catch (e) {}
    var tg = (el.tagName || '').toUpperCase(), CE = el.isContentEditable;
    var V = (el.ownerDocument && el.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
    function setNative(v) {
      if (CE) { try { el.textContent = v; } catch (e) {} return; }
      try { var proto = tg === 'TEXTAREA' ? V.HTMLTextAreaElement.prototype : V.HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(proto, 'value'); if (d && d.set) { d.set.call(el, v); return; } } catch (e) {}
      try { el.value = v; } catch (e) {}
    }
    function fire(type, ctor, init) { try { el.dispatchEvent(new V[ctor](type, init || { bubbles: true })); } catch (e) { try { el.dispatchEvent(new Event(type, { bubbles: true })); } catch (e2) {} } }
    setNative(''); fire('input', 'InputEvent', { bubbles: true, inputType: 'deleteContentBackward' });
    setNative(val);
    fire('keydown', 'KeyboardEvent', { bubbles: true });
    fire('input', 'InputEvent', { bubbles: true, inputType: 'insertText', data: val });
    fire('keyup', 'KeyboardEvent', { bubbles: true });
    fire('change', 'Event', { bubbles: true });
    var got = CE ? (el.textContent || '') : (el.value || '');
    var want = val.replace(/\s+/g, '');
    return (got.replace(/\s+/g, '').indexOf(want.slice(0, Math.min(want.length, 8))) >= 0) || got.length > 0;
  }

  if (op === 'read') {
    var ex = extractRows(), nx = findNext();
    return { ok: true, op: 'read', text: ex.text, count: ex.count, selector: ex.selector, sig: sigOf(ex.text), hasNext: !!nx, nextDesc: nx ? btnText(nx).slice(0, 40) : '', score: scoreReportSelf() };
  }
  if (op === 'next') {
    var n2 = findNext(); if (!n2) return { ok: true, op: 'next', clicked: false };
    var desc = btnText(n2).slice(0, 40); fireClick(n2);
    return { ok: true, op: 'next', clicked: true, nextDesc: desc };
  }
  if (op === 'fill') {
    var res = { ok: true, op: 'fill', acted: false, controls: {} };
    var cpt = (params.cpt && params.cpt[0]) || '', proc = params.procedureName || '';
    var f = null;
    if (cpt) { f = findField(C.cptFieldLabels); if (f) { res.controls.cpt = labelText(f).slice(0, 40) || '(cpt)'; if (await typeInto(f, cpt)) { res.filledCpt = true; res.acted = true; } } }
    if (proc) { var pf = findField(C.procFieldLabels); if (pf && pf !== f) { res.controls.proc = labelText(pf).slice(0, 40) || '(proc)'; if (await typeInto(pf, proc)) { res.filledProc = true; res.acted = true; } } }
    var df = findDateField(C.dateFromLabels), dt = findDateField(C.dateToLabels);
    if (df && dt && df === dt) {
      var ds = editableInputs().filter(function (el) { var t = lc(el.getAttribute && el.getAttribute('type')); var h = labelText(el); return t === 'date' || /date|dos|from|to|through|thru/.test(h); });
      if (ds.length >= 2) { df = ds[0]; dt = ds[1]; }
    }
    if (params.dateFrom && df) { res.controls.from = labelText(df).slice(0, 40); if (await typeInto(df, fmtDate(df, params.dateFrom))) { res.filledFrom = true; res.acted = true; } }
    if (params.dateTo && dt) { res.controls.to = labelText(dt).slice(0, 40); if (await typeInto(dt, fmtDate(dt, params.dateTo))) { res.filledTo = true; res.acted = true; } }
    var rb = findButton(C.runLabels);
    if (rb) { res.controls.run = btnText(rb).slice(0, 40); fireClick(rb); res.clickedRun = true; res.acted = true; } else { res.noRunButton = true; }
    return res;
  }
  return { ok: false, error: 'bad-op' };
}
/*MLS_ATHENA_DRIVE_END*/

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  // Tell the popup how we're authenticating: a saved API key, the live MLS login, or nothing yet.
  if (msg.type === 'mlsConnStatus') {
    (async () => {
      const c = await getCfg();
      if ((c.mlsKey || '').trim()) return sendResponse({ mode: 'key' });
      const tok = await getSessionToken();
      sendResponse({ mode: tok ? 'session' : 'none' });
    })();
    return true;
  }
  if (msg.type === 'mlsAssistGenerate') { callBackend('/api/assist/note', { transcript: msg.transcript }).then(sendResponse); return true; }
  if (msg.type === 'mlsAssistAgentStep') { callBackend('/api/assist/agent-step', { goal: msg.goal, pageText: msg.pageText, screenshot: msg.screenshot, history: msg.history }).then(sendResponse); return true; }
  if (msg.type === 'mlsAssistExtract') { callBackend('/api/assist/extract', { pageText: msg.pageText, url: msg.url }).then(sendResponse); return true; }
  // Pull the day's SCHEDULE from the EMR tab (Athena) → return its page text so MLS can
  // parse the appointments and pre-load today's patients. Reads every frame (Athena is iframe-based).
  
  /* === MLS provider extractor (schedule provider capture) === */
/* mlsProv — schedule provider extractor (worker side), inlined into background.js. */
var mlsProv = (function () {
  'use strict';


  var RE_TIME = /\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i;
  var RE_TIME_G = /\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
  var RE_CRED = /(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
  var CRED_I = /^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
  var RE_APPTWORD = /\bappointment/i;
  var RE_NAMECOMMA = /([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
  var STOP = /^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;

  function S(x) { return x == null ? '' : String(x); }
  function clean(s) { return S(s).replace(/\s+/g, ' ').trim(); }

  function nameTokens(name) {
    return clean(name).toLowerCase().replace(/[^a-z' -]/g, ' ').split(/\s+/)
      .filter(function (t) { return t && t.length > 1 && !STOP.test(t) && !CRED_I.test(t); });
  }
  function hasTime(s) { return RE_TIME.test(S(s)); }
  function firstTime(s) { var m = S(s).match(RE_TIME_G); return m ? clean(m[0]) : ''; }

  function cleanProvider(s) {
    var t = clean(s);
    t = t.replace(/[•‣▪●>*\-–—]+\s*$/g, '');
    t = t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i, '');
    t = t.replace(/\b\d+\s*appointments?\b/i, '');
    t = t.replace(/\(\s*\d+\s*\)\s*$/, '');
    t = t.replace(/[\s,;:|–—-]+$/, '');
    return clean(t);
  }

  function looksLikeProviderHeader(line) {
    var t = clean(line);
    if (!t || t.length > 80) return false;
    if (hasTime(t)) return false;
    var hasCred = RE_CRED.test(t);
    var hasApptWord = RE_APPTWORD.test(t);
    var hasName = RE_NAMECOMMA.test(t) || /[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);
    if ((hasCred && hasName) || (hasApptWord && hasName)) return true;
    if (hasCred && RE_NAMECOMMA.test(t) && t.split(/\s+/).length <= 5) return true;
    return false;
  }

  function patientNameFromRow(line) {
    var t = clean(line);
    var mc = t.match(RE_NAMECOMMA);
    if (mc) return clean(mc[0]);
    var afterTime = t.replace(RE_TIME_G, ' ');
    var words = afterTime.split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w); });
    var picked = [];
    for (var i = 0; i < words.length && picked.length < 3; i++) {
      var w = words[i].replace(/[^A-Za-z'’-]/g, '');
      if (!w) continue;
      if (STOP.test(w) || CRED_I.test(w.toLowerCase())) { if (picked.length) break; else continue; }
      if (/^[A-Z]/.test(w)) picked.push(w); else if (picked.length) break;
    }
    return picked.join(' ');
  }

  function mlsExtractScheduleFromText(text) {
    var out = { appts: [], providers: [], diag: { strategy: 'text', lineCount: 0, headerCount: 0, apptCount: 0, providerCount: 0, credsSeen: [], providerNames: [] } };
    try {
      var raw = S(text);
      if (!raw.trim()) return out;
      var lines = raw.split(/\r?\n/).map(clean).filter(function (l) { return l.length; });
      out.diag.lineCount = lines.length;
      var current = '';
      var provSet = {}, provOrder = [], credSet = {};
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        if (looksLikeProviderHeader(ln)) {
          var p = cleanProvider(ln);
          if (p) {
            current = p;
            if (!provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
            var cm = ln.match(RE_CRED); if (cm && cm[1]) credSet[cm[1].toUpperCase()] = 1;
            out.diag.headerCount++;
          }
          continue;
        }
        if (hasTime(ln)) {
          var nm = patientNameFromRow(ln);
          if (nm) out.appts.push({ time: firstTime(ln), name: nm, provider: current || '' });
        }
      }
      var withAppts = {};
      out.appts.forEach(function (a) { if (a.provider) withAppts[a.provider.toLowerCase()] = a.provider; });
      var provs = Object.keys(withAppts).length ? provOrder.filter(function (p) { return withAppts[p.toLowerCase()]; }) : provOrder;
      out.providers = provs;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = provs.length;
      out.diag.providerNames = provs.slice(0, 20);
      out.diag.credsSeen = Object.keys(credSet);
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  function txt(el) { try { return clean(el.textContent); } catch (e) { return ''; } }

  function mlsExtractScheduleFromDom(doc) {
    var out = { appts: [], providers: [], diag: { strategy: 'dom', tables: 0, rowsScanned: 0, apptCount: 0, providerCount: 0, via: '', providerNames: [], credsSeen: [] } };
    try {
      if (!doc || !doc.querySelectorAll) return out;
      var provSet = {}, provOrder = [], credSet = {};
      function noteProv(p) {
        p = cleanProvider(p);
        if (p && /[A-Za-z]/.test(p) && p.length <= 60 && !provSet[p.toLowerCase()]) { provSet[p.toLowerCase()] = 1; provOrder.push(p); }
        if (p) { var cm = p.match(RE_CRED); if (cm && cm[1]) credSet[cm[1].toUpperCase()] = 1; }
        return p;
      }

      var grids = [].slice.call(doc.querySelectorAll('table, [role="grid"], [role="table"]'));
      out.diag.tables = grids.length;
      for (var g = 0; g < grids.length && !out.appts.length; g++) {
        var grid = grids[g];
        var headerCells = [].slice.call(grid.querySelectorAll('thead th, [role="columnheader"]'));
        var rows = [].slice.call(grid.querySelectorAll('tbody tr, [role="row"]'));
        if (!rows.length) rows = [].slice.call(grid.querySelectorAll('tr'));
        if (!headerCells.length && rows.length) headerCells = [].slice.call(rows[0].querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'));
        var provIdx = -1, nameIdx = -1;
        headerCells.forEach(function (h, idx) {
          var ht = txt(h).toLowerCase();
          if (provIdx < 0 && /(provider|rendering|resource|clinician|scheduling provider|doctor|seen by|with)/.test(ht) && !/patient/.test(ht)) provIdx = idx;
          if (nameIdx < 0 && /(patient|name)/.test(ht)) nameIdx = idx;
        });
        if (provIdx < 0) continue;
        rows.forEach(function (r) {
          out.diag.rowsScanned++;
          var cells = [].slice.call(r.querySelectorAll('th, td, [role="cell"], [role="gridcell"]'));
          if (!cells.length) return;
          var rowText = txt(r);
          if (!hasTime(rowText)) return;
          var prov = cells[provIdx] ? noteProv(txt(cells[provIdx])) : '';
          var nm = nameIdx >= 0 && cells[nameIdx] ? txt(cells[nameIdx]) : patientNameFromRow(rowText);
          if (nm) out.appts.push({ time: firstTime(rowText), name: clean(nm), provider: prov || '' });
        });
        if (out.appts.length) out.diag.via = 'table-column';
      }

      if (!out.appts.length) {
        var all = [].slice.call(doc.querySelectorAll('div,li,tr,section,article,a,span,p'));
        var seq = [];
        all.forEach(function (el) {
          var own = txt(el);
          if (!own || own.length > 400) return;
          if (own.length <= 80 && looksLikeProviderHeader(own) && el.querySelectorAll('*').length <= 6) {
            seq.push({ kind: 'prov', el: el, text: own });
          } else if (hasTime(own) && own.length < 300 && patientNameFromRow(own)) {
            var childHasBoth = false;
            for (var c = 0; c < el.children.length; c++) {
              var ct = txt(el.children[c]);
              if (hasTime(ct) && patientNameFromRow(ct)) { childHasBoth = true; break; }
            }
            if (!childHasBoth) seq.push({ kind: 'appt', el: el, text: own });
          }
        });
        var cur = '';
        seq.forEach(function (n) {
          out.diag.rowsScanned++;
          if (n.kind === 'prov') { cur = noteProv(n.text); }
          else {
            var inRow = '';
            if (RE_CRED.test(n.text)) {
              var mNme = n.text.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD)\b)/);
              if (mNme) inRow = noteProv(mNme[1]);
            }
            var nm2 = patientNameFromRow(n.text);
            if (nm2) out.appts.push({ time: firstTime(n.text), name: nm2, provider: inRow || cur || '' });
          }
        });
        if (out.appts.length && !out.diag.via) out.diag.via = 'grouped-dom';
      }

      var used = {};
      out.appts.forEach(function (a) { if (a.provider) used[a.provider.toLowerCase()] = a.provider; });
      out.providers = Object.keys(used).length ? provOrder.filter(function (p) { return used[p.toLowerCase()]; }) : provOrder;
      out.diag.apptCount = out.appts.length;
      out.diag.providerCount = out.providers.length;
      out.diag.providerNames = out.providers.slice(0, 20);
      out.diag.credsSeen = Object.keys(credSet);
    } catch (e) { out.diag.err = S(e && e.message || e).slice(0, 120); }
    return out;
  }

  function mlsMergeSchedule(domRes, textRes) {
    var dom = domRes || { appts: [], providers: [], diag: {} };
    var text = textRes || { appts: [], providers: [], diag: {} };
    var primary = (dom.providers && dom.providers.length) ? dom : text;
    var other = primary === dom ? text : dom;
    var seen = {}, providers = [];
    (primary.providers || []).concat(other.providers || []).forEach(function (p) {
      var k = clean(p).toLowerCase(); if (p && !seen[k]) { seen[k] = 1; providers.push(p); }
    });
    var appts = primary.appts && primary.appts.length ? primary.appts : (other.appts || []);
    /* v2.9.9 DEDUP (live: athenaOne renders the dashboard day list TWICE —
       sort-by-department + sort-by-time copies — so a 20-appt day arrived as 50
       rows incl. OPEN slots). Pass 1: exact provider|time|name dupes. Pass 2: a
       provider-less row whose time|name twin HAS a provider is the hidden-copy
       shadow — drop it (keeps b238's genuinely provider-less appts, which have
       no attributed twin). Count removals in diag — never silent. */
    var dropped = 0;
    try {
      var k1 = {}, p1 = [];
      appts.forEach(function (a) {
        var k = (a.provider || '') + '|' + (a.time || '') + '|' + String(a.name || '').toLowerCase();
        if (k1[k]) { dropped++; return; } k1[k] = 1; p1.push(a);
      });
      var hasProv = {};
      p1.forEach(function (a) { if (a.provider) hasProv[(a.time || '') + '|' + String(a.name || '').toLowerCase()] = 1; });
      var p2 = p1.filter(function (a) { if (!a.provider && hasProv[(a.time || '') + '|' + String(a.name || '').toLowerCase()]) { dropped++; return false; } return true; });
      appts = p2;
    } catch (eD) {}
    return {
      appts: appts,
      providers: providers,
      providerDiag: {
        source: primary === dom ? 'dom' : 'text',
        dupRowsRemoved: dropped,
        dom: dom.diag || {},
        text: text.diag || {},
        providerCount: providers.length,
        providerNames: providers.slice(0, 20)
      }
    };
  }
  return { fromText: mlsExtractScheduleFromText, fromDom: mlsExtractScheduleFromDom, merge: mlsMergeSchedule };
})();

  /* v1.47 AUTO-NAVIGATE (athenaOne-aware, two-step): when no schedule grid is showing,
     load the day view before scraping. READ-ONLY navigation: a hard deny-list blocks any
     write/sign/bill/book/reschedule control; only whitelisted schedule nav labels (or
     schedule-ish hrefs) are clicked. On athenaOne the top-nav "Calendar" is a menu-opener,
     so this (a) tries a direct schedule link/tab, else (b) clicks the Calendar menu-opener
     and then, polling this frame, clicks the schedule sub-item (e.g. "Today's Appointments").
     Runs per-frame via allFrames:true, so the frame that renders the submenu handles step 2.
     All label lists + timing are config-tunable via mls-assist-config.json's `nav` block. */
  async function mlsAthenaGotoSchedule(NAV){
    try{
      var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};
      var cl=function(x){return String(x==null?'':x).replace(/\s+/g,' ').trim();};
      var DENY=/save|sign|bill|charge|payment|checkout|delete|remove|cancel|submit|logout|log out|new appointment|book|create|reschedul|add\b/i;
      var OPENER=(NAV&&NAV.openerReSource)?new RegExp(NAV.openerReSource):/OpenMenu\(\{\s*"MENUNAME":\s*"calendar"/;
      var DIRECT=(NAV&&NAV.directLabels)||['calendar','schedule','scheduling','day sheet','front office'];
      var SUB=(NAV&&NAV.subLabels)||["today's appointments","view calendar","provider schedule","daily schedule","today's schedule","staff calendar","department calendar",'schedule','appointments'];
      var HREF=(NAV&&NAV.hrefReSource)?new RegExp(NAV.hrefReSource,'i'):/schedul|calendar|frontoffice|daysheet/i;
      var maxPolls=(NAV&&NAV.subPolls)||6, pollMs=(NAV&&NAV.subPollMs)||400;
      var did={};
      function vis(e){var r;try{r=e.getBoundingClientRect();}catch(_e){return false;}return !!(r&&r.width>0&&r.height>0);}
      function oc(e){try{return e.getAttribute('onclick')||'';}catch(_e){return '';}}
      var els=[].slice.call(document.querySelectorAll('a,button,div,li,span,[role="tab"],[role="menuitem"],[onclick]'));
      // STEP 1a: a real (non-menu) direct schedule link/tab in this frame
      var directClicked=false;
      for(var i=0;i<els.length;i++){var e=els[i];var t=cl(e.textContent).toLowerCase();if(!t||t.length>28||DENY.test(t))continue;var href='';try{href=e.getAttribute('href')||'';}catch(_e){}var lm=(DIRECT.indexOf(t)>=0 && !/OpenMenu/.test(oc(e)));var hm=!!href&&HREF.test(href);if((lm||hm)&&vis(e)){ e.click(); directClicked=true; did.direct=t; break; }}
      // STEP 1b: else click the calendar menu-opener (athenaOne)
      if(!directClicked){
        for(var j=0;j<els.length;j++){var e2=els[j];if(OPENER.test(oc(e2))&&vis(e2)){ e2.click(); did.opener=cl(e2.textContent).slice(0,20); break; }}
      }
      // STEP 2: poll this frame for the schedule sub-item (rendered after the opener click, possibly by another frame's instance)
      if(!directClicked){
        for(var pp=0;pp<maxPolls;pp++){
          await sleep(pollMs);
          var cand=null, e3s=[].slice.call(document.querySelectorAll('a,div,li,span,td,[onclick]'));
          for(var k=0;k<e3s.length;k++){var e3=e3s[k];var t3=cl(e3.textContent).toLowerCase();if(!t3||t3.length>30||e3.children.length>1||DENY.test(t3))continue;var idx=SUB.indexOf(t3);if(idx>=0&&vis(e3)){ if(!cand||idx<cand.idx)cand={el:e3,idx:idx,t:t3}; }}
          if(cand){ cand.el.click(); did.sub=cand.t; break; }
        }
      }
      return { clicked: !!(directClicked||did.sub), did: did };
    }catch(e){ return {clicked:false,err:String(e&&e.message||e).slice(0,60)}; }
  }

  /* ---- v1.51: hands-free schedule DATE navigation (read-only nav) ---- */
  if (msg.type === 'mlsAppGotoDateRequest') {
    (async () => {
      try {
        const date = String(msg.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendResponse({ ok: false, supported: false, error: 'bad date' });
        const all = await chrome.tabs.query({});
        const tab = await mlsPickAthenaTab(all, { athenaOnly: true }); /* v1.90 unified verified pick (live 07-10 two-window failure) */
        if (!tab) return sendResponse({ ok: false, supported: false, error: 'No athenaOne tab open.' });
        const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [date, !!msg.probe], func: mlsAthenaGotoDate });
        const hits = (res || []).map((r) => r && r.result).filter(Boolean);
        let found = hits.find((h) => h.found) || null;
        /* v1.93 diag (PHI-free: tab id + path + counts only) */
        const GDIAG = { tabId: tab.id, tabPath: (function () { try { return new URL(tab.url || '').pathname.slice(0, 40); } catch (e) { return ''; } })(), initFrames: hits.length, initFound: !!found, rounds: [] };
        /* v1.91 (§2.7): the driver can now ALWAYS reach the date control — when no
           frame shows one (athena parked on a chart/findpatient/letters view) the
           non-probe path below auto-recovers to the dashboard first. So a probe with
           an athena tab present is always supported; never advertise follow mode. */
        if (msg.probe) return sendResponse({ ok: true, supported: true, via: (found && found.via) || 'auto-recovery', controlVisible: !!found });
        if (!found) {
          /* v1.91 (§2.7): NEVER ask the user to move athena by hand. Drive athena
             back to the dashboard ourselves, then retry the weekstrip. Ladder:
             round 0 = Home-logo click (+ CSRF-Continue clear); round 1 = tab reload
             recovery + Home-logo click. Serialized with go-home via __mlsGroundBusy.
             Foregrounds athena for the dashboard render (same anti-throttle reason
             as go-home) and notes focus debt so the guardian returns MLS after. */
          if (self.__mlsGroundBusy) { const tw = Date.now(); while (self.__mlsGroundBusy && Date.now() - tw < 25000) { await mlsSleepW(500); } }
          self.__mlsGroundBusy = true;
          try {
            try { await (self.__mlsQpEnsure ? self.__mlsQpEnsure(tab, sender && sender.tab && sender.tab.id) : null); } catch (eF) {} /* v2.9.5 quiet pull: athena made visible in its work strip, never focused, no focus debt */
            for (let rec = 0; rec < 2 && !found; rec++) {
              /* v1.92: per-round try/catch + mlsExecTO everywhere. (v1.91/v1.92 root
                 cause found live: `found` was const, so the ladder's reassignment
                 threw a TypeError into the catch on every run - now `let` above.) */
              const RD = { rec: rec, home: false, cont: false, err: '', at: [] };
              GDIAG.rounds.push(RD);
              try {
                if (rec === 1) await mlsRecoverAthenaTab(tab.id);
                const hx = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsGoHomeDriverFn }, 9000);
                const hHits = ((hx && hx.r) || []).map((r) => r && r.result).filter(Boolean);
                RD.home = hHits.some((h) => h && h.clicked);
                if (!RD.home) {
                  const ix = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaContinueFn }, 6000);
                  const seen = ((ix && ix.r) || []).map((m) => m && m.result).filter(Boolean).some((v) => v && v.seen);
                  RD.cont = seen;
                  if (seen) { await mlsSleepW(2400); await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsGoHomeDriverFn }, 9000); }
                  else if (rec === 0 && !(hx && hx.r)) { continue; } /* injection itself dead (frozen renderer): escalate to the reload round */
                  /* goHome found no logo but the injection ran: the dashboard may
                     already be showing - still try the weekstrip below. */
                }
                for (let at = 0; at < 3 && !found; at++) {
                  await mlsSleepW(at === 0 ? 5200 : 3200); /* frameset rebuild settle */
                  const gx = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, args: [date, false], func: mlsAthenaGotoDate }, 40000);
                  const hits2 = ((gx && gx.r) || []).map((r) => r && r.result).filter(Boolean);
                  found = hits2.find((h) => h.found) || null;
                  RD.at.push((gx && gx.timeout) ? 'TO' : (gx && gx.err) ? ('E:' + String(gx.err).slice(0, 40)) : (found ? 'found:' + (found.via || '') : 'f' + hits2.length));
                }
              } catch (eRound) { RD.err = String((eRound && eRound.message) || eRound).slice(0, 80); }
            }
          } catch (eRec) {} finally { self.__mlsGroundBusy = false; }
          if (!found) return sendResponse({ ok: false, supported: true, diag: GDIAG, error: 'athena date navigation: the calendar view could not be reached automatically after two recovery attempts — retry the pull.' });
        }
        /* verify by re-reading the displayed date after the page settles */
        await new Promise((r) => setTimeout(r, 3000));
        /* v1.68: the v26.3 dashboard has NO single-date header - the old header-date
           read grabbed junk dates from noise frames ("athena is showing 2025-09-25")
           even when the weekstrip click WORKED. Verify weekstrip navs by the SELECTED
           day tab instead. */
        if (found.via === 'weekstrip') {
          const chk2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [date, found.visibleStart || ''], func: function (want, expectedStart) {
            try {
              var nav = document.querySelector('.calendar-nav'); if (!nav) return null;
              function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
              function fromMd(md) {
                var p = md.split('/'), mon = parseInt(p[0], 10), day = parseInt(p[1], 10);
                var anchor = /^\d{4}-\d{2}-\d{2}$/.test(expectedStart) ? new Date(parseInt(expectedStart.slice(0, 4), 10), parseInt(expectedStart.slice(5, 7), 10) - 1, parseInt(expectedStart.slice(8, 10), 10), 12) : new Date();
                var best = null, dist = Infinity;
                for (var y = anchor.getFullYear() - 1; y <= anchor.getFullYear() + 1; y++) {
                  var d = new Date(y, mon - 1, day, 12);
                  if (d.getMonth() !== mon - 1 || d.getDate() !== day) continue;
                  var gap = Math.abs(d.getTime() - anchor.getTime());
                  if (gap < dist) { best = d; dist = gap; }
                }
                return best ? iso(best) : '';
              }
              var nw = new Date();
              var isToday = (want === iso(nw));
              var els = Array.prototype.slice.call(nav.querySelectorAll('*'));
              for (var i = 0; i < els.length; i++) {
                var t = (els[i].textContent || '').replace(/\s+/g, ' ').trim();
                var m = /^(sun|mon|tue|wed|thu|fri|sat)\s+(\d{1,2}\/\d{2})$/i.exec(t);
                var isTodayTab = /^today$/i.test(t); /* v1.69: today's tab has no date */
                if (!m && !isTodayTab) continue;
                var sel = /select|active|current/i.test(els[i].className || '') || /select|active|current/i.test((els[i].parentElement || {}).className || '');
                if (!sel) continue;
                if (isTodayTab) return { match: isToday, sel: 'Today', selectedDate: iso(nw) };
                var selectedDate = fromMd(m[2]);
                return { match: selectedDate === want, sel: m[2], selectedDate: selectedDate };
              }
              return null;
            } catch (e) { return null; }
          } });
          const oks = (chk2 || []).map((r) => r && r.result).filter(Boolean);
          const hit = oks.find((o) => o.match);
          const shown = (oks[0] && oks[0].sel) || '';
          return sendResponse({ ok: !!hit, supported: true, via: 'weekstrip', schedDate: hit ? date : shown, diag: GDIAG, error: hit ? '' : ('athena week strip shows ' + (shown || 'no selected day') + ' instead of ' + date + '.') });
        }
        const chk = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaReadHeaderDate });
        const dates = (chk || []).map((r) => (r && r.result) || '').filter(Boolean);
        const onTarget = dates.indexOf(date) >= 0;
        return sendResponse({ ok: onTarget, supported: true, via: found.via, schedDate: onTarget ? date : (dates[0] || ''), error: onTarget ? '' : ('athena is showing ' + (dates[0] || 'an unreadable date') + ' instead of ' + date + '.') });
      } catch (e) { sendResponse({ ok: false, supported: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.55: return athenaOne to the CLINICAL SCHEDULE (home) by clicking the
     athenaOne Home logo. Read-only navigation. Foregrounds the athena tab first (same
     anti-throttle reason as the v1.54 read fix) so the schedule renders fast, then clicks
     the logo across frames and waits for the day view to load. Lets the app-side day/month
     history orchestrator re-ground between patients. ---- */
  if (msg.type === 'mlsAppGoHomeRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = await mlsPickAthenaTab(all, { athenaOnly: true }); /* v1.90 unified picker */
        if (!tab) return sendResponse({ ok: false, error: 'No signed-in athenaOne tab found.' });
        try { await (self.__mlsQpEnsure ? self.__mlsQpEnsure(tab, sender && sender.tab && sender.tab.id) : null); } catch (e) {} /* v2.9.5 quiet pull: visible-not-focused replaces foreground-for-read; no focus debt */
        /* v1.59: serialize concurrent go-home attempts (the app retries on its own
           18s timer while a recovery may still be running - don't reload twice). */
        if (self.__mlsGroundBusy) { const tw = Date.now(); while (self.__mlsGroundBusy && Date.now() - tw < 25000) { await mlsSleepW(500); } }
        self.__mlsGroundBusy = true;
        try {
          /* v1.59: athenaOne freezes after ~7-9 consecutive chart reads. Chunk the
             day loop at its natural boundary: on go-home, once enough reads have
             accumulated, reload the tab first (fresh renderer; session survives;
             the Continue interstitial is cleared automatically), then click Home. */
          if (__mlsReadsSinceReload >= 6) { await mlsRecoverAthenaTab(tab.id); }
          let x = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsGoHomeDriverFn }, 9000);
          let hits = ((x && x.r) || []).map((r) => r && r.result).filter(Boolean);
          let clicked = hits.some((h) => h && h.clicked);
          if (!clicked) {
            /* not found or frozen: clear a possible interstitial; if the injection
               itself hung/failed, recover the tab by reload; then retry once. */
            const ix = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaContinueFn }, 6000);
            const seen = ((ix && ix.r) || []).map((m) => m && m.result).filter(Boolean).some((v) => v.seen);
            if (seen) { await mlsSleepW(2500); }
            else if (x.timeout || !hits.length) { await mlsRecoverAthenaTab(tab.id); }
            x = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsGoHomeDriverFn }, 9000);
            hits = ((x && x.r) || []).map((r) => r && r.result).filter(Boolean);
            clicked = hits.some((h) => h && h.clicked);
          }
          await new Promise((r) => setTimeout(r, clicked ? 2600 : 400));
          return sendResponse({ ok: clicked, clicked: clicked, diag: hits });
        } finally { self.__mlsGroundBusy = false; }
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.99 tab picker: list / pin / state (read-only toward athena) ---- */
  if (msg.type === 'mlsListAthenaTabsRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const rows = [];
        for (const t of all) {
          if (!t || t.id == null || !/^https?:/i.test(t.url || '')) continue;
          const athena = /athenahealth|athenanet|athenaone/i.test(t.url || '') || mlsTabTitleAthena(t);
          if (!athena) continue;
          rows.push({
            id: t.id,
            title: String(t.title || t.url || '').slice(0, 80),
            loginish: mlsAthIsLoginish(t) || mlsAthTabHost(t) !== 'athenanet.athenahealth.com',
            active: !!t.active,
            hello: !!((self.__mlsAthReg || {})[t.id] && Date.now() - self.__mlsAthReg[t.id] < 300000),
            pinned: !!(self.__mlsAthPin && self.__mlsAthPin.tabId === t.id)
          });
        }
        rows.sort((a, b) => (a.loginish - b.loginish) || (b.pinned - a.pinned) || (b.hello - a.hello));
        sendResponse({ ok: true, tabs: rows.slice(0, 12) });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e).slice(0, 120) }); }
    })();
    return true;
  }
  if (msg.type === 'mlsPinAthenaTabRequest') {
    (async () => {
      try {
        const tid = msg.tabId == null ? null : Number(msg.tabId);
        if (tid == null) { mlsPinSet(null); return sendResponse({ ok: true, pinned: false, note: 'auto tab selection restored' }); }
        let t = null; try { t = await chrome.tabs.get(tid); } catch (e) { t = null; }
        if (!t) return sendResponse({ ok: false, error: 'That tab no longer exists — refresh the list.' });
        if (mlsAthIsLoginish(t) || mlsAthTabHost(t) !== 'athenanet.athenahealth.com') return sendResponse({ ok: false, error: 'That tab is on a sign-in page — sign in to athenaOne there first, then pick it.' });
        const pr = await mlsAthPing(t.id, 2000);
        mlsPinSet(t.id);
        try { self.__mlsAthReg[t.id] = Date.now(); chrome.storage.session.set({ mlsAthReg: self.__mlsAthReg }); } catch (e) {}
        await mlsArmKeepAlive(t.id, true);
        const info = await mlsPinInfo();
        sendResponse({ ok: true, pinned: true, tabId: t.id, alive: !!pr.alive, ka: info.ka, title: info.title });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e).slice(0, 120) }); }
    })();
    return true;
  }
  if (msg.type === 'mlsPinStateRequest') {
    (async () => { try { sendResponse(Object.assign({ ok: true }, await mlsPinInfo())); } catch (e) { sendResponse({ ok: false, reason: 'pin-state-error', error: 'Could not read the pinned athena tab state: ' + String((e && e.message) || e).slice(0, 80) }); } })(); /* v2.9.9: never a bare false (Codex E3) */
    return true;
  }
  /* ---- v1.60 DEV: reload the (unpacked) extension from disk. Lets the driving
     session iterate builds without a manual chrome://extensions click. Reload
     only - no data access; the worker re-reads whatever is on disk. ---- */
  if (msg.type === 'mlsDevReloadRequest') {
    try { sendResponse({ ok: true, reloading: true }); } catch (e) {}
    setTimeout(function () { try { chrome.runtime.reload(); } catch (e) {} }, 400);
    return true;
  }
  /* ---- v2.9.11: read the accumulated shadow-parser evidence (canonical-parser
     cutover data; see mlsNameShadowTotals aggregation in the schedule handler).
     Read-only; names in samples stay in-browser like all pull data. ---- */
  if (msg.type === 'mlsNameShadowStateRequest') {
    try {
      chrome.storage.local.get(['mlsNameShadowTotals'], function (st) {
        try { sendResponse({ ok: true, totals: (st && st.mlsNameShadowTotals) || null }); } catch (e2) {}
      });
    } catch (e) { try { sendResponse({ ok: false, reason: 'storage-error', error: String((e && e.message) || e).slice(0, 80) }); } catch (e3) {} }
    return true;
  }
  /* ---- v1.56: return focus to the MLS (mlsscribe) tab. Called by the app after a
     history pull foregrounded athenaOne, so the doctor is brought back to mlsscribe
     instead of being left on Athena. Read-only: activates the app tab only, clicks nothing. ---- */
  if (msg.type === 'mlsAppFocusMlsTab') {
    (async () => {
      try {
        /* v1.89 ANTI-YANK GATE: only pull the user back to MLS when a pull
           actually OWES a return — guardian debt open, or repaid within the
           last 15s (the app re-fires this at ~4s/~12s to beat stragglers).
           Live report: the unconditional handler yanked a user who had
           deliberately clicked over to athenaOne AFTER a pull finished. */
        const FGv = self.__mlsFg || {};
        const owed = !!FGv.debt || (FGv.endAt && (Date.now() - FGv.endAt) < 15000);
        try { self.__mlsFgEnd && self.__mlsFgEnd(); } catch (e) {} /* v1.74: op ended — settle the guardian debt */
        try { if (self.__mlsQpRelease) await self.__mlsQpRelease('app-end'); } catch (e) {} /* restore the work-strip before deciding whether a focus return is still safe */
        if (!owed) { return sendResponse({ ok: true, activated: false, skipped: 'no-focus-debt' }); }
        const all = await chrome.tabs.query({});
        /* v1.75: return to the tab that ASKED (the app), never to the review-finder
           page, which is also on mlsscribe.com. */
        let appTab = null;
        if (sender && sender.tab && /(^|\.)mlsscribe\.com$/i.test((function () { try { return new URL(sender.tab.url || '').host; } catch (e) { return ''; } })())) {
          appTab = all.find((t) => t.id === sender.tab.id) || sender.tab;
        }
        if (!appTab) appTab = self.__mlsFgPickAppTab ? self.__mlsFgPickAppTab(all) : null;
        if (appTab && await mlsReadFocusWouldYank(appTab.id)) {
          return sendResponse({ ok: true, activated: false, skipped: 'user-on-other-tab', tabId: appTab.id });
        }
        let activated = false;
        if (appTab) {
          await chrome.tabs.update(appTab.id, { active: true });
          if (appTab.windowId != null) await chrome.windows.update(appTab.windowId, { focused: true });
          try { const t2 = await chrome.tabs.get(appTab.id); activated = !!(t2 && t2.active); } catch (e) {}
        }
        sendResponse({ ok: !!appTab, activated: activated, tabId: appTab ? appTab.id : null });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.77 DIAGNOSTIC (read-only, NO PHI): what identity does the write gate
     read from the open chart, per frame? Returns initials + score + via only, so a
     refusal ("uncertain"/"mismatch") can be explained instead of guessed at.
     Reads identity; writes nothing, clicks nothing. ---- */
  if (msg.type === 'mlsIdDiag') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = await mlsPickAthenaTab(all); /* v1.90: was raw ath[0]/c[0] in query order */
        if (!tab) return sendResponse({ ok: false, error: 'no chart tab' });
        /* v2.9.13 (Codex E3): bounded READ-ONLY retry — 20s envelope; on timeout/
           rejection/zero-frames revalidate the tab and retry ONCE. Never retries a
           completed read, an identity result, or anything write-adjacent. */
        let idr = null;
        for (let idTry = 0; idTry < 2; idTry++) {
          const idx = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsReadChartIdentity }, 20000);
          if (idx && idx.r && idx.r.length) { idr = idx.r; break; }
          if (idTry === 0) { try { const t2 = await chrome.tabs.get(tab.id); if (!t2 || !/athenanet\.athenahealth\.com/i.test(mlsHostOnly(t2.url || ''))) break; } catch (eRv) { break; } await new Promise((r) => setTimeout(r, 700)); }
        }
        if (!idr) return sendResponse({ ok: false, error: 'identity read did not complete (renderer busy) — try again.' });
        const frames = (idr || []).map((m) => {
          const r = (m && m.result) || {};
          const nm = String(r.name || '');
          return {
            frameId: m && m.frameId,
            initials: nm ? nm.split(/[ ,]+/).filter(Boolean).map(w => w[0]).join('') : '',
            nameLen: nm.length,
            hasDob: !!r.dob, hasMrn: !!r.mrn,
            score: r.score || 0, via: r.via || ''
          };
        }).filter((f) => f.nameLen || f.hasDob || f.hasMrn);
        const best = mlsBestIdentityFrom(idr);
        /* v1.78: what does the SHADOW reader see? (initials only, no PHI) */
        let shadowBest = null;
        try {
          const sidr = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsReadChartIdentityShadow });
          const sb = mlsBestIdentityFrom(sidr);
          if (sb && sb.name) shadowBest = { initials: sb.name.split(/[ ,]+/).filter(Boolean).map(w => w[0]).join(''), hasDob: !!sb.dob, hasMrn: !!sb.mrn, score: sb.score || 0, via: sb.via || '' };
        } catch (e) {}
        /* structure probe: is the banner hiding in shadow DOM? (counts only, no text) */
        let struct = [];
        try {
          const sr = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: function () {
            var it = (document.body && document.body.innerText || '');
            var tc = (document.body && document.body.textContent || '');
            var shadows = 0, hosts = 0;
            try { var els = document.querySelectorAll('*'); for (var i = 0; i < els.length; i++) { if (els[i].shadowRoot) { shadows++; if (!hosts) hosts = 1; } } } catch (e) {}
            var nameShapedInInner = /^[A-Z][A-Za-z'\-\.]*(\s+[A-Z][A-Za-z'\-\.]*){1,3}$/m.test(it);
            /* where does a chart banner live? booleans only. */
            var BANNER = /\b\d{1,3}\s*yo\b/i;              /* the age chip */
            var DATEISH = /\b[01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{4}\b/;
            var innerBanner = BANNER.test(it) && DATEISH.test(it);
            var shadowBanner = false, shadowInnerLen = 0;
            try {
              var els2 = document.querySelectorAll('*');
              for (var j = 0; j < els2.length; j++) {
                var sr = els2[j].shadowRoot;
                if (!sr) continue;
                var st = '';
                try { var kids = sr.children || []; for (var k = 0; k < kids.length; k++) { st += '\n' + (kids[k].innerText || ''); } } catch (e) {}
                shadowInnerLen += st.length;
                if (BANNER.test(st) && DATEISH.test(st)) shadowBanner = true;
              }
            } catch (e) {}
            return { innerLen: it.length, textLen: tc.length, shadowRoots: shadows, nameShapedInInner: nameShapedInInner,
                     innerBanner: innerBanner, shadowBanner: shadowBanner, shadowInnerLen: shadowInnerLen,
                     tail: String(location.pathname || '').slice(-26) };
          } });
          struct = (sr || []).map(m => Object.assign({ frameId: m.frameId }, m.result || {})).filter(f => f.innerLen != null);
        } catch (e) {}
        let mlsPt = { name: '', dob: '', mrn: '' };
        try {
          const mt = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] });
          for (const t of mt) { const [mr] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: mlsReadActivePatient }); if (mr && mr.result && (mr.result.name || mr.result.dob)) { mlsPt = mr.result; break; } }
        } catch (e) {}
        const match = mlsMatchPatients(mlsPt, best || {});
        sendResponse({
          ok: true, frames: frames, struct: struct, shadowBest: shadowBest, readerHasShadow: (function(){ try { return typeof mlsReadChartIdentityShadow === 'function'; } catch(e){ return false; } })(),
          bestInitials: best && best.name ? best.name.split(/[ ,]+/).filter(Boolean).map(w => w[0]).join('') : '',
          bestScore: best ? (best.score || 0) : null, bestVia: best ? best.via : '', bestHasDob: !!(best && best.dob),
          mlsInitials: mlsPt.name ? mlsPt.name.split(/[ ,]+/).filter(Boolean).map(w => w[0]).join('') : '',
          mlsHasDob: !!mlsPt.dob,
          matchStatus: match.status, dobMatch: !!match.dobMatch, nameMatch: !!match.nameMatch
        });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.75 DIAGNOSTIC (read-only): report guardian state + which tab is active.
     Lets the app (and a driving session) VERIFY the doctor was returned to MLS,
     without any DOM access. Reads tab metadata only; clicks nothing. ---- */
  if (msg.type === 'mlsFgState') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const act = all.find((t) => t.active) || null;
        const host = (u) => { try { return new URL(u || '').host; } catch (e) { return ''; } };
        const FG = self.__mlsFg || {};
        sendResponse({
          ok: true,
          debt: !!FG.debt,
          quietMs: FG.at ? (Date.now() - FG.at) : null,
          activeHost: act ? host(act.url) : '',
          activeIsApp: !!(act && /(^|\.)mlsscribe\.com$/i.test(host(act.url)) && /ScribeFlow/i.test(act.url || '')),
          activeIsAthena: !!(act && /athenahealth|athenanet/i.test(act.url || '')),
          version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ''
        });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.51: reviews scrape driver (reputation lane; public pages, no PHI) ---- */
  if (msg.type === 'mlsAppScrapeReviewsRequest') {
    (async () => {
      try {
        const targets = Array.isArray(msg.targets) ? msg.targets.slice(0, 12) : [];
        if (!targets.length) return sendResponse({ ok: false, error: 'No review pages to read.' });
        const results = [];
        for (const t0 of targets) {
          const url = String((t0 && t0.url) || t0 || '');
          if (!/^https:\/\//i.test(url)) { results.push({ url, ok: false, error: 'not https' }); continue; }
          let tab = null;
          try {
            tab = await chrome.tabs.create({ url, active: false });
            await new Promise((res) => {
              let done = false; const to = setTimeout(() => { if (!done) { done = true; res(); } }, 20000);
              const li = (id, info) => { if (id === tab.id && info && info.status === 'complete' && !done) { done = true; clearTimeout(to); chrome.tabs.onUpdated.removeListener(li); res(); } };
              chrome.tabs.onUpdated.addListener(li);
            });
            await new Promise((r) => setTimeout(r, 2500));
            const resp = await new Promise((res) => {
              let d = false; const to = setTimeout(() => { if (!d) { d = true; res(null); } }, 25000);
              try { chrome.tabs.sendMessage(tab.id, { type: 'mlsExtReadReviews' }, (r2) => { void chrome.runtime.lastError; if (!d) { d = true; clearTimeout(to); res(r2 || null); } }); }
              catch (e) { if (!d) { d = true; clearTimeout(to); res(null); } }
            });
            results.push({ url, ok: !!(resp && resp.ok !== false && (resp.listing || resp.reviews)), data: resp || null, error: resp ? '' : 'reader did not answer' });
          } catch (e) { results.push({ url, ok: false, error: String((e && e.message) || e) }); }
          finally { try { if (tab) await chrome.tabs.remove(tab.id); } catch (e2) {} }
          await new Promise((r) => setTimeout(r, 2500)); /* politeness gap between sites */
        }
        sendResponse({ ok: true, results, version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '' });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.51: assisted-capture relay (reader → background → mlsscribe tab) ---- */
  if (msg.type === 'mlsExtScrapeCaptured') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: '*://mlsscribe.com/*' });
        for (const t of tabs) {
          try {
            await chrome.scripting.executeScript({ target: { tabId: t.id }, args: [msg.resp || null],
              func: (resp) => { try { window.postMessage({ source: 'mls-ext', type: 'mlsAppScrapeCaptured', resp: resp }, '*'); } catch (e) {} } });
          } catch (e) {}
        }
        sendResponse({ ok: true, relayed: tabs.length });
      } catch (e) { sendResponse({ ok: false, reason: 'relay-error', error: 'Could not relay the captured page to the MLS tab: ' + String((e && e.message) || e).slice(0, 80) }); } /* v2.9.9: never a bare false (Codex E3) */
    })();
    return true;
  }
  if (msg.type === 'mlsAppScheduleRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        /* v1.90: unified verified picker (heartbeat-preferred, reachability-pinged,
           identity/login excluded); non-athena EMR keyword fallback preserved. */
        let tab = await mlsPickAthenaTab(all, { athenaOnly: true })
               || all.find((t) => /epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com|athena/i.test(t.url || ''));
        // v1.38 truth fix: do NOT fall back to an unrelated most-recently-active tab and report it connected (phantom-tab bug).
        if (!tab) return sendResponse({ ok: false, reason: 'no-athena-tab', emr: 'none', host: '', id: msg.id, error: 'Open a signed-in athenaOne tab, then try again.' });
        const isRealAthena = /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(tab.url || '');
        // Read every frame WITH its URL so we can isolate the SCHEDULE/CALENDAR frame and
        // drop the noise (athenaText messaging, department lists) that would pollute parsing.
        // v1.45: fetch hosted config (data, not code) so selectors are tunable via the site w/o a store update.
        var __mlsCfg = null; try { var __cr = await fetch('https://mlsscribe.com/mls-assist-config.json?cb=' + Date.now()); if (__cr.ok) { __mlsCfg = await __cr.json(); } } catch (e) { __mlsCfg = null; }
        // v1.47 AUTO-NAVIGATE pre-step: only when NO frame currently shows a schedule grid,
        // click the Calendar/Schedule nav and wait for the day view to load, then scrape below.
        try {
          var __det = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: function(){ try{ var d=document; var hdr=!!d.querySelector('h1.fe_c_heading--subsection'); var times=((d.body&&d.body.innerText||'').match(/\b\d{1,2}:\d{2}\s*[ap]\.?m/gi)||[]).length; return { grid: hdr || times>=4 }; }catch(e){ return { grid:false }; } } });
          var __hasGrid = (__det||[]).some(function(r){ return r && r.result && r.result.grid; });
          if (!__hasGrid) {
            var __nav = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [ (__mlsCfg && __mlsCfg.nav) || null ], func: mlsAthenaGotoSchedule });
            var __clicked = (__nav||[]).some(function(r){ return r && r.result && r.result.clicked; });
            if (__clicked) { await new Promise(function(r){ setTimeout(r, (__mlsCfg && __mlsCfg.navWaitMs) || 3500); }); }
          }
        } catch (e) {}
        let results = [];
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            args: [ (__mlsCfg && (__mlsCfg.schedule || __mlsCfg)) || null ],
            func: async (CFG) => { try { /* inject_dom.js — SELF-CONTAINED DOM schedule/provider reader.
 * This exact function body is inlined into MLS Assist background.js's executeScript
 * `func` so it runs INSIDE the athenaOne schedule frame. It must reference nothing
 * outside itself. Returns { appts:[{time,name,provider}], providers:[...], diag:{} }.
 * Read-only; PHI (patient names) stays in the user's browser; diag is PHI-free. */
/* ===========================================================================
 * v2.9.13 CANONICAL NAME PARSER — SHADOW MODE ONLY (Codex E1 program, rev 3).
 * rev2 (Codex-staged) + rev3 live-shadow fix: the FIRST honest-counter pull
 * caught rev2 ingesting reason-text tails on real dashboard rows ("Tina Closs"
 * -> "Tina Closs Lumbar") — legacy's unstripped age chip accidentally FENCED
 * the name; rev2 stripped the fence to a space and sailed into "Lumbar Spine".
 * rev3: (a) debris strips (age/sex, DOB, MRN, status phrases, pipes, numbers)
 * become BOUNDARY markers, not spaces — the name cannot absorb tokens across a
 * debris site; (b) the parser tries only the FIRST TWO boundary segments
 * (leading time/status debris precedes the name; reason text follows it);
 * (c) the practice's anatomy vocabulary joins the stop list. Everything else
 * is rev2 (nickname field, age+sex unit, explicit suffix orders,
 * state/credential/one-letter rejection, suffix-free display).
 * =========================================================================== */
function mlsParseName(raw) {
  try {
    var s = String(raw == null ? '' : raw).replace(/’/g, "'").replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var nickname = '';
    var NICKWORD = /^[A-Za-z][A-Za-z'.\-]*(?:\s+[A-Za-z][A-Za-z'.\-]*)?$/;
    var NICKSTOP = /^(?:jr|sr|ii|iii|iv|v|esq|junior|senior|new patient|follow[ -]?up|self[ -]?pay|(?:left|right)(?:\s+(?:knee|hip|shoulder|ankle|foot|wrist|elbow))?|knee|hip|shoulder|ankle|foot|wrist|elbow|room|status|visit|injection|procedure)$/i;
    s = s.replace(/\(([^)]*)\)/g, function (whole, inside) {
      var n = String(inside || '').trim().replace(/^["']+|["']+$/g, '');
      if (!nickname && NICKWORD.test(n) && !NICKSTOP.test(n)) nickname = n;
      return ' ';
    });
    /* BND = hard name boundary. Debris does not just vanish — it fences. */
    var B = ' ‖ ';
    s = s.replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi, B);
    s = s.replace(/\b\d+\s*min(?:ute)?s?\b/gi, B);
    s = s.replace(/\b\d{1,3}\s*(?:yo|y\/o|yrs?\.?|years?(?:\s*old)?)\s*[MF]\b/gi, B);
    s = s.replace(/\b\d{1,3}\s*(?:yo|y\/o|yrs?\.?|years?(?:\s*old)?)\b/gi, B);
    s = s.replace(/\b[01]?\d[\/\-.][0-3]?\d[\/\-.]\d{2,4}\b/g, B);
    s = s.replace(/#\s?\d{3,}\b/g, B);
    s = s.replace(/\b(checked[\s-]?(?:in|out)|check[\s-]?(?:in|out)|self[\s-]?pay|walk[\s-]?in|no[\s-]?show|arrived|scheduled|confirmed|cancell?ed|copay|balance|room\s*\d*|status|new patient|follow[\s-]?up|office visit|telehealth|video visit)\b/gi, B);
    s = s.replace(/\b(?:left|right)\s+(?:knee|hip|shoulder|ankle|foot|wrist|elbow)\b.*$/i, B);
    s = s.replace(/\bgenicular\s+nerve\s+block\b.*$/i, B);
    s = s.replace(/[|•·]+/g, B);
    s = s.replace(/\b\d+\b/g, B);
    /* Split into boundary segments; the patient name lives in the first or
       second segment (leading debris precedes it; reason text follows it).
       Later segments are reason/status vocabulary — never eligible. */
    var segs = s.split(/‖/).map(function (x) { return x.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, ''); }).filter(Boolean).slice(0, 2);
    if (!segs.length) return null;
    var SFX = /^(jr|sr|ii|iii|iv|v|esq|junior|senior)\.?$/i;
    var SFXMAP = { jr: 'Jr', sr: 'Sr', ii: 'II', iii: 'III', iv: 'IV', v: 'V', esq: 'Esq', junior: 'Junior', senior: 'Senior' };
    function normSuffix(x) {
      var m = String(x || '').trim().match(SFX);
      return m ? SFXMAP[m[1].toLowerCase()] : '';
    }
    var PART = /^(de|del|della|da|di|du|van|von|der|den|la|le|los|st\.?|san|santa)$/i;
    var STOPX = /^(am|pm|open|est|new|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|min|mins|minute|minutes|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments|in|out|pay|self|md|do|np|pa|pac|aprn|fnp|dnp|rn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc|lumbar|cervical|thoracic|sacral|spine|neck|back|knee|hip|shoulder|ankle|foot|wrist|elbow|epidural|facet|joint|block|nerve|steroid|cortisone)$/i;
    var STATE = /^(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)$/i;
    var CRED = /^(md|do|np|pa|pac|aprn|fnp|dnp|rn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/i;
    var TOKRE = /^[A-Za-z][A-Za-z'.\-]*$/;
    function parseSeg(seg) {
      var s2 = seg, suffix = '';
      var commaParts = s2.split(/\s*,\s*/).filter(Boolean);
      if (commaParts.length >= 3 && normSuffix(commaParts[1])) {
        suffix = normSuffix(commaParts[1]);
        s2 = commaParts[0] + ', ' + commaParts.slice(2).join(' ');
      } else if (commaParts.length > 1 && normSuffix(commaParts[commaParts.length - 1])) {
        suffix = normSuffix(commaParts.pop());
        s2 = commaParts.join(', ');
      }
      s2 = s2.replace(/\s+(jr|sr|ii|iii|iv|v|esq|junior|senior)\.?(?=[\s,]|$)/gi, function (whole, value) {
        if (!suffix) suffix = normSuffix(value);
        return ' ';
      });
      s2 = s2.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/^[,\s]+|[,\s]+$/g, '');
      if (!s2) return null;
      var first = '', middle = '', last = '';
      var cm = s2.split(/\s*,\s*/).filter(Boolean);
      if (cm.length >= 2) {
        last = cm[0];
        var rawGiven = cm.slice(1).join(' ').split(/\s+/).filter(Boolean), given = [];
        if (rawGiven.length === 1 && (STATE.test(rawGiven[0].replace(/\./g, '')) || CRED.test(rawGiven[0].replace(/\./g, '')))) return null;
        for (var gi = 0; gi < rawGiven.length && given.length < 3; gi++) {
          var gt = rawGiven[gi];
          if (!TOKRE.test(gt) || STOPX.test(gt)) break;
          given.push(gt);
        }
        first = given[0] || '';
        middle = given.slice(1).join(' ');
      } else {
        var t = s2.split(/\s+/).filter(Boolean);
        while (t.length > 1 && /^[MF]$/.test(t[0]) && t[1] && t[1].length > 1) t.shift();
        var w = [];
        for (var i = 0; i < t.length; i++) {
          var tok = t[i];
          if (!TOKRE.test(tok)) { if (w.length) break; else continue; }
          if (STOPX.test(tok)) { if (w.length) break; else continue; }
          if (!/^[A-Z]/.test(tok) && !(w.length && PART.test(tok))) { if (w.length) break; else continue; }
          w.push(tok);
          if (w.length >= 3 && !PART.test(w[w.length - 1])) break;
          if (w.length >= 6) break;
        }
        if (!w.length) return null;
        if (w.length === 1) last = w[0];
        else {
          var li = w.length - 1;
          while (li - 1 > 0 && PART.test(w[li - 1])) li--;
          last = w.slice(li).join(' ');
          first = w[0];
          middle = w.slice(1, li).join(' ');
        }
      }
      var okTok = function (x) { return !x || /^[A-Za-z][A-Za-z' .\-]*$/.test(x); };
      if (!last || last.replace(/[^A-Za-z]/g, '').length < 2 || !okTok(last)) return null;
      if (!okTok(first) || (first && first.replace(/[^A-Za-z]/g, '').length < 2)) return null;
      if (!okTok(middle)) middle = '';
      var display = ((first ? first + ' ' : '') + (middle ? middle + ' ' : '') + last).replace(/\s+/g, ' ').trim();
      return { first: first, middle: middle, last: last, suffix: suffix, nickname: nickname, display: display, confident: !!(first && last) };
    }
    var bestRes = null;
    for (var si = 0; si < segs.length; si++) {
      var r = parseSeg(segs[si]);
      if (r && r.confident) return r;
      if (r && !bestRes) bestRes = r;
    }
    return bestRes;
  } catch (e) { return null; }
}

async function mlsSchedDomInline(doc, CFG){
  var out={appts:[],providers:[],diag:{strategy:'dom',via:'',tables:0,rowsScanned:0,apptCount:0,providerCount:0,providerNames:[],credsSeen:[],nameShadow:{checked:0,differs:0,canonicalRejected:0,canonicalAdded:0,samples:[]}}};
  var _nameShadowSeen={}; /* v2.9.13: checked = DISTINCT raw rows, not parser invocations (Codex counter fix) */
  try{
    var RT=/\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i, RTG=/\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
    var RC=/(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
    var CI=/^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
    var RA=/\bappointment/i, RN=/([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
    var STOP=/^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;
    /* v2.9.7: generational suffixes after a comma are NOT a first name. Live bug:
       dashboard row "Lawrence J Dipietrae, Jr 82yo M | 07-29-1943 ..." -> the
       "Last, First" regex matched "Dipietrae, Jr" and the FIRST NAME WAS LOST
       (downstream open/identity honestly refused). Strip ", Jr"-style suffixes
       BEFORE any name-shape matching. */
    var SFXRE=/,\s*(?:jr|sr|ii|iii|iv|esq|junior|senior)\.?(?=[^A-Za-z]|$)/gi;
    function cl(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
    function ht(s){return RT.test(String(s));}
    /* v2.9.12 TIME NORMALIZATION (owner bar: "times always accurate"): every
       meridian-bearing time leaves the scrape as canonical "H:MM AM/PM"
       ("4:00 pm" / "2:00PM" / "4:15 p.m." were all escaping in source format —
       the app's b242 meridian handling gets one consistent shape). Meridian-less
       times are NEVER guessed: passed through bare + counted in diag.bareTimes
       so the app's time_display/start_local enrichment knows to take over. */
    function ft(s){var m=String(s).match(RTG);if(!m)return '';var t=cl(m[0]);var p=/^(\d{1,2}):(\d{2})\s*([ap])/i.exec(t);if(p)return String(+p[1])+':'+p[2]+' '+p[3].toUpperCase()+'M';out.diag.bareTimes=(out.diag.bareTimes||0)+1;return t;}
    function cp(s){var t=cl(s);t=t.replace(/[•‣▪●>*\-–—]+\s*$/g,'');t=t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i,'');t=t.replace(/\b\d+\s*appointments?\b/i,'');t=t.replace(/\(\s*\d+\s*\)\s*$/,'');t=t.replace(/[\s,;:|–—-]+$/,'');t=t.replace(/\s*[Cc]lose\s*$/,'');return cl(t);}
    function lh(line){var t=cl(line);if(!t||t.length>80)return false;if(ht(t))return false;var hc=RC.test(t),ha=RA.test(t),hn=RN.test(t)||/[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);if((hc&&hn)||(ha&&hn))return true;if(hc&&RN.test(t)&&t.split(/\s+/).length<=5)return true;return false;}
    /* v2.9.13 shadow (Codex counter fix): checked counts DISTINCT normalized raw
       rows once; canonical FALSE NEGATIVES count as disagreements (kind:
       canonical-reject) instead of vanishing; canonical-only names are
       canonical-add. samples hold patient names -> BROWSER-LOCAL ONLY, never
       telemetry/server logs. NEVER changes output. */
    function _pnShadow(line,r){try{
      if(typeof mlsParseName!=='function')return;
      var raw=String(line||'').replace(/\s+/g,' ').trim();
      var key=raw.toLowerCase();
      if(!key||_nameShadowSeen[key])return;
      _nameShadowSeen[key]=1;
      var N=out.diag.nameShadow,ps=mlsParseName(raw);
      var oldName=String(r||'').replace(/\s+/g,' ').trim();
      var newName=(ps&&ps.confident)?ps.display:'';
      N.checked++;
      if(oldName.toLowerCase()!==newName.toLowerCase()){
        N.differs++;
        if(!newName)N.canonicalRejected++;
        if(!oldName)N.canonicalAdded++;
        if(N.samples.length<10)N.samples.push({kind:!newName?'canonical-reject':(!oldName?'canonical-add':'rename'),o:oldName,n:newName});
      }
    }catch(_eS){}}
    function pn(line){var r=_pnCore(line);_pnShadow(line,r);return r;}
    function _pnCore(line){var t=cl(line).replace(SFXRE,' ').replace(/\s+/g,' ');var mc=t.match(RN);if(mc)return cl(mc[0]);var af=t.replace(RTG,' ');var ws=af.split(/\s+/).filter(function(w){return /[A-Za-z]/.test(w);});var pk=[];for(var i=0;i<ws.length&&pk.length<3;i++){var w=ws[i].replace(/[^A-Za-z'’-]/g,'');if(!w)continue;if(STOP.test(w)||CI.test(w.toLowerCase())){if(pk.length)break;else continue;}if(/^[A-Z]/.test(w))pk.push(w);else if(pk.length)break;}return pk.join(' ');}
    function tx(el){try{return cl(el.textContent);}catch(e){return '';}}
    var provSet={},provOrder=[],credSet={};
    function np(p){p=cp(p);
      /* v2.9.7 LOCATION GUARD: "PA"/"MD" are US states AND credentials, so a
         location line like "Newtown Square, PA" passed the credential test and
         became a PROVIDER (live capture). If the candidate is exactly
         "<words>, PA|MD" and the part before the comma carries NO OTHER
         credential and no middle initial, treat it as a location and emit '' —
         an unattributed appt is honest; a location-provider poisons every
         provider dropdown. (Tradeoff: a plain "Marcus Welby, MD" header in this
         LAST-RESORT lane is also skipped; the primary structure/coord lanes
         match providers by credential-anchored header patterns and are
         unaffected.) */
      var lm=/^([A-Za-z .'’\-]+),\s*(PA|MD)\.?$/.exec(p||'');
      if(lm){var pre=lm[1];var hasCred=RC.test(pre);var hasMI=/\b[A-Z]\.?\s/.test(pre.replace(/^[A-Z]/,'x'));if(!hasCred&&!hasMI)return '';}
      if(p&&/[A-Za-z]/.test(p)&&p.length<=60&&!provSet[p.toLowerCase()]){provSet[p.toLowerCase()]=1;provOrder.push(p);}if(p){var cm=p.match(RC);if(cm&&cm[1])credSet[cm[1].toUpperCase()]=1;}return p;}
    if(!doc||!doc.querySelectorAll)return out;
    /* v2.9.8: NEVER parse schedule data out of the staff-messaging/coordinator/
       letters frames. Live catch: the stm.esp staff-message thread "LAURA
       ZAKORCHEMNY 4:00 pm meeting Matthew Schaeffer" was parsed into a 4:00 PM
       APPOINTMENT for the office manager — a fabricated patient on the pulled
       schedule. Schedule data may only come from schedule-shaped frames (the
       chart-identity readers already treat these frames as junk). */
    try{var _pth=String((doc.location&&doc.location.pathname)||'');if(/stm\.esp|\/coordinator\/|messaging|letters/i.test(_pth)){out.diag.skipped='non-schedule-frame';return out;}}catch(_eFx){}
    // === v1.48 STRUCTURE STRATEGY (athenaOne): appts are .PatientAppointment_appointment-container
    // buttons (UNIQUE id) inside per-provider .ScheduleColumn_schedule-column sections. Dedup by button id
    // (scroll-invariant); assign provider via the appt's ancestor column SECTION matched to its header by
    // the SECTION's x-center. Far more reliable than per-cell coordinate bucketing on the virtualized grid. ===
    try{
      if(doc.querySelector && doc.querySelector('[class*="PatientAppointment_appointment-container"], [class*="ScheduleColumn_schedule-column"]')){
        function _sleepS(ms){return new Promise(function(r){setTimeout(r,ms);});}
        var _prS=(CFG&&CFG.provReSource)?new RegExp(CFG.provReSource):/^[A-Z][A-Za-z'’.\-]+_[A-Za-z].*_(MD|DO|PA-?C|NP|CRNA|APRN|DPM|DDS|DMD|CRNP)\b/;
        var _prCS=/([A-Z][A-Za-z'’.\-]+_[A-Za-z][A-Za-z'’.\-]*_(?:MD|DO|PA-?C|NP|CRNA|APRN|DPM|DDS|DMD|CRNP))\b/;
        function _nmS(t0){var r=_nmSCore(t0);_pnShadow(t0,r);return r;} /* v2.9.10 shadow wrap */
        function _nmSCore(t){t=cl(t).replace(SFXRE,' ').replace(/\s+/g,' ');var m=t.match(/,\s*([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]*)?)\s*(?:\(|$)/);if(m)return cl(m[1]);var m2=t.match(/([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/);if(m2)return cl(m2[0]);return _pnCore(t);/* v2.9.9 (Codex E1 follow-up): comma-less container names no longer come back EMPTY — fall through to the suffix/stop-word-aware token parser */}
        /* v2.9.3 (owner: op-note auto-match): the appointment container also holds
           the appointment TYPE / reason-for-visit (e.g. "Left Knee Injection",
           "Genicular Nerve Block", "New Patient"). We keep it as `reason` so the
           app's op-note template auto-matcher (which scores against reason) has
           something to score. Read-only, additive; strips time/name/age/dob/mrn/
           status, leaving the type text. Per-container so it is not confused with
           another patient's row (unlike a flat-text parse). */
        function _reasonS(t){try{var nm=_nmS(t);var s=' '+cl(t)+' ';s=s.replace(RTG,' ');if(nm){nm.split(/[\s,]+/).forEach(function(w){w=w.replace(/[^A-Za-z]/g,'');if(w.length>1){try{s=s.replace(new RegExp('\\b'+w+'\\b','ig'),' ');}catch(_e){}}});}s=s.replace(/\b[01]?\d[\/\-.][0-3]?\d[\/\-.]\d{2,4}\b/g,' ');s=s.replace(/\b\d{1,3}\s*(?:yo|y\/o|yrs?|years?\s*old)\b/gi,' ');s=s.replace(/#\s?\d{3,}/g,' ').replace(/\b\d{2,}\b/g,' ');s=s.replace(/\b(arrived|checked\s*in|checked\s*out|scheduled|confirmed|cancell?ed|no\s*show|room|status|self\s*pay|copay|balance|male|female|mins?|minutes?)\b/gi,' ');s=s.replace(/[^A-Za-z0-9\/&'\- ]/g,' ').replace(/\s+/g,' ').trim();return s.slice(0,120);}catch(_e){return '';}}
        function _hdrsS(){var hs=[].slice.call(doc.querySelectorAll('*')).filter(function(e){var t=cl(e.textContent);return _prS.test(t)&&t.replace(/\s/g,'').length<48&&e.children.length<=4;});var o=[],sn={};hs.forEach(function(e){try{var r=e.getBoundingClientRect();if(r.width>20&&r.width<520){var mm=cl(e.textContent).match(_prCS);if(mm){var nm=mm[1];if(!sn[nm]){sn[nm]=1;o.push({nm:nm,cx:r.left+r.width/2});}}}}catch(_e){}});return o;}
        var _byIdS={};
        function _collectS(){var hdr=_hdrsS();[].slice.call(doc.querySelectorAll('[class*="ScheduleColumn_schedule-column"]')).forEach(function(col){var r;try{r=col.getBoundingClientRect();}catch(_e){return;}if(r.width<40)return;var ccx=r.left+r.width/2,best='',bd=1e9;hdr.forEach(function(h){var dd=Math.abs(ccx-h.cx);if(dd<bd){bd=dd;best=h.nm;}});var prov=(best&&bd<r.width)?best:'';[].slice.call(col.querySelectorAll('[class*="PatientAppointment_appointment-container"]')).forEach(function(b){var id=b.id||cl(b.textContent);if(_byIdS[id])return;var t=cl(b.textContent);_byIdS[id]={prov:prov,time:ft(t),name:_nmS(t),reason:_reasonS(t)};});});}
        var _scS=null,_allS=[].slice.call(doc.querySelectorAll('*')),_dvS=(doc.defaultView||window);
        for(var _si=0;_si<_allS.length;_si++){try{var _csS=_dvS.getComputedStyle(_allS[_si]);if(/(auto|scroll)/.test(_csS.overflowX)&&_allS[_si].scrollWidth>_allS[_si].clientWidth+50&&_allS[_si].clientWidth>300){if(!_scS||_allS[_si].scrollWidth>_scS.scrollWidth)_scS=_allS[_si];}}catch(_e){}}
        if(_scS){var _frS=(CFG&&CFG.scrollStepFrac)||0.45,_wmS=(CFG&&CFG.scrollWaitMs)||820;var _spS=Math.max(160,Math.round(_scS.clientWidth*_frS));var _ogS=_scS.scrollLeft;for(var _xS=0;_xS<=_scS.scrollWidth;_xS+=_spS){_scS.scrollLeft=_xS;_scS.dispatchEvent(new Event('scroll',{bubbles:true}));await _sleepS(_wmS);_collectS();}_scS.scrollLeft=0;_scS.dispatchEvent(new Event('scroll',{bubbles:true}));await _sleepS(400);_collectS();_scS.scrollLeft=_ogS;}else{_collectS();}
        try{var _dhS=doc.querySelector((CFG&&CFG.dateHdrSel)||'h1.fe_c_heading--subsection');if(_dhS){var _dS=new Date(cl(_dhS.textContent).replace(/^[A-Za-z]+,\s*/,''));if(!isNaN(_dS.getTime())){var _p2S=function(n){n=String(n);return n.length<2?'0'+n:n;};out.schedDate=_dS.getFullYear()+'-'+_p2S(_dS.getMonth()+1)+'-'+_p2S(_dS.getDate());}}}catch(_e){}
        var _idsS=Object.keys(_byIdS);
        if(_idsS.length){var _upS={},_unmS=0;_idsS.forEach(function(id){var a=_byIdS[id];if(!a.name)_unmS++;out.appts.push({time:a.time,name:a.name,provider:a.prov||'',reason:a.reason||''});if(a.prov)_upS[a.prov]=1;});out.providers=Object.keys(_upS);out.diag.via='structure-id';out.diag.strategy='structure-id';out.diag.apptCount=out.appts.length;out.diag.unnamedCount=_unmS;/* v2.9.9: rows whose name failed to parse are VISIBLE in diag, never silent */out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);if(out.appts.length)return out;}
      }
    }catch(_seS){out.diag.structErr=String(_seS&&_seS.message||_seS).slice(0,100);}
    // === v1.46 COORD STRATEGY (scroll-scrape): athenaOne Day grid VIRTUALIZES columns — only appts
    // in the visible viewport are in the DOM. So scroll the grid horizontally in steps and at each
    // step read the currently-visible provider headers + appt cells, bucketing each appt to the
    // column whose x-range contains it. Dedupe across steps by provider|time|name. Captures ALL
    // providers. Falls through to the old strategies if this isn't that kind of grid. ===
    try{
      function mlsPad2(n){n=String(n);return n.length<2?('0'+n):n;}
      function mlsParseDate(s){try{var d=new Date(String(s).replace(/^[A-Za-z]+,\s*/,''));if(!isNaN(d.getTime()))return d.getFullYear()+'-'+mlsPad2(d.getMonth()+1)+'-'+mlsPad2(d.getDate());}catch(e){}return '';}
      function mlsSleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
      var _dh=doc.querySelector((CFG&&CFG.dateHdrSel)||'h1.fe_c_heading--subsection');
      if(!_dh){var _hs=[].slice.call(doc.querySelectorAll('h1,h2,[class*="heading"],[class*="date"]'));for(var _i=0;_i<_hs.length;_i++){var _t0=cl(_hs[_i].textContent);if(/^[A-Z][a-z]+day,\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d\d/.test(_t0)){_dh=_hs[_i];break;}}}
      if(_dh)out.schedDate=mlsParseDate(cl(_dh.textContent));
      var _provRe=(CFG&&CFG.provReSource)?new RegExp(CFG.provReSource):/^[A-Z][A-Za-z'’.\-]+_[A-Za-z].*_(MD|DO|PA-?C|NP|CRNA|APRN|DPM|DDS|DMD)\b/;
      function _headCols(){
        var hs=[].slice.call(doc.querySelectorAll('*')).filter(function(e){var t=cl(e.textContent);return _provRe.test(t)&&t.replace(/\s/g,'').length<48&&e.children.length<=4;});
        var cols=[],seen={};
        hs.forEach(function(e){try{var r=e.getBoundingClientRect();if(r.width>20&&r.width<520){var nm=cp(cl(e.textContent));var key=nm.toLowerCase();if(nm&&!seen[key]){seen[key]=1;cols.push({name:nm,lo:r.left,rr:r.right});}}}catch(_e){}});
        cols.sort(function(a,b){return a.lo-b.lo;});
        for(var c=0;c<cols.length;c++){var nx=(c+1<cols.length)?cols[c+1].lo:(cols[c].rr+(cols[c].rr-cols[c].lo));cols[c].hi=(cols[c].rr<nx)?nx:cols[c].rr;}
        return cols;
      }
      var _cols0=_headCols();
      if(_cols0.length>=2){
        var _scroller=null,_all=[].slice.call(doc.querySelectorAll('*')),_dv=(doc.defaultView||window);
        for(var _s=0;_s<_all.length;_s++){try{var _cs=_dv.getComputedStyle(_all[_s]);if(/(auto|scroll)/.test(_cs.overflowX)&&_all[_s].scrollWidth>_all[_s].clientWidth+50&&_all[_s].clientWidth>300){if(!_scroller||_all[_s].scrollWidth>_scroller.scrollWidth)_scroller=_all[_s];}}catch(_e){}}
        var _seenA={};
        function _collect(){
          var cols=_headCols();
          var cells=[].slice.call(doc.querySelectorAll('div,li,a')).filter(function(e){var t=cl(e.textContent);return ht(t)&&t.length>10&&t.length<140&&pn(t)&&e.querySelectorAll('*').length<=8;});
          cells.forEach(function(e){try{var r=e.getBoundingClientRect();if(r.width<8||r.width>460)return;var t=cl(e.textContent);var nm=pn(t);if(!nm)return;var cx=r.left+Math.min(18,r.width/2);var prov='';for(var k=0;k<cols.length;k++){if(cx>=cols[k].lo-6&&cx<cols[k].hi){prov=cols[k].name;break;}}var tm=ft(t);var key=(prov||'')+'|'+tm+'|'+nm;if(_seenA[key])return;_seenA[key]=1;out.appts.push({time:tm,name:cl(nm),provider:prov||''});}catch(_e){}});
        }
        if(_scroller){
          var _frac=(CFG&&CFG.scrollStepFrac)||0.55;
          var _waitMs=(CFG&&CFG.scrollWaitMs)||780;
          var _stepPx=Math.max(200,Math.round(_scroller.clientWidth*_frac));
          var _steps=Math.min(40,Math.ceil(_scroller.scrollWidth/_stepPx)+2);
          var _orig=_scroller.scrollLeft;
          for(var _st=0;_st<_steps;_st++){try{_scroller.scrollLeft=_st*_stepPx;_scroller.dispatchEvent(new Event('scroll',{bubbles:true}));}catch(_e){}await mlsSleep(_waitMs);_collect();}
          try{_scroller.scrollLeft=0;_scroller.dispatchEvent(new Event('scroll',{bubbles:true}));}catch(_e){}await mlsSleep(400);_collect();
          try{_scroller.scrollLeft=_orig;}catch(_e){}
        } else { _collect(); }
        var _u={};out.appts.forEach(function(a){if(a.provider)_u[a.provider]=1;});
        out.providers=_cols0.map(function(c){return c.name;}).filter(function(n){return _u[n];});
        if(!out.providers.length)out.providers=_cols0.map(function(c){return c.name;});
        out.diag.via='coord-scroll';out.diag.strategy='coord-scroll';out.diag.apptCount=out.appts.length;out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);out.diag.scrolled=!!_scroller;
        if(out.appts.length) return out;
      }
    }catch(_ce){out.diag.coordErr=String(_ce&&_ce.message||_ce).slice(0,100);}
    var grids=[].slice.call(doc.querySelectorAll('table, [role="grid"], [role="table"]'));
    out.diag.tables=grids.length;
    for(var g=0;g<grids.length&&!out.appts.length;g++){
      var grid=grids[g];
      var hc=[].slice.call(grid.querySelectorAll('thead th, [role="columnheader"]'));
      var rows=[].slice.call(grid.querySelectorAll('tbody tr, [role="row"]'));
      if(!rows.length)rows=[].slice.call(grid.querySelectorAll('tr'));
      if(!hc.length&&rows.length)hc=[].slice.call(rows[0].querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'));
      var pi=-1,ni=-1;
      hc.forEach(function(h,idx){var t=tx(h).toLowerCase();if(pi<0&&/(provider|rendering|resource|clinician|scheduling provider|doctor|seen by|with)/.test(t)&&!/patient/.test(t))pi=idx;if(ni<0&&/(patient|name)/.test(t))ni=idx;});
      if(pi<0)continue;
      rows.forEach(function(r){out.diag.rowsScanned++;var cells=[].slice.call(r.querySelectorAll('th, td, [role="cell"], [role="gridcell"]'));if(!cells.length)return;var rt=tx(r);if(!ht(rt))return;var prov=cells[pi]?np(tx(cells[pi])):'';var nm=ni>=0&&cells[ni]?tx(cells[ni]):pn(rt);if(nm)out.appts.push({time:ft(rt),name:cl(nm),provider:prov||''});});
      if(out.appts.length)out.diag.via='table-column';
    }
    if(!out.appts.length){
      var all=[].slice.call(doc.querySelectorAll('div,li,tr,section,article,a,span,p'));
      var seq=[];
      all.forEach(function(el){var own=tx(el);if(!own||own.length>400)return;if(own.length<=80&&lh(own)&&el.querySelectorAll('*').length<=6){seq.push({k:'p',t:own});}else if(ht(own)&&own.length<300&&pn(own)){var cb=false;for(var c=0;c<el.children.length;c++){var ct=tx(el.children[c]);if(ht(ct)&&pn(ct)){cb=true;break;}}if(!cb)seq.push({k:'a',t:own});}});
      var cur='';
      seq.forEach(function(n){out.diag.rowsScanned++;if(n.k==='p'){cur=np(n.t);}else{var inRow='';if(RC.test(n.t)){var mN=n.t.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD)\b)/);if(mN)inRow=np(mN[1]);}var nm2=pn(n.t);if(nm2)out.appts.push({time:ft(n.t),name:nm2,provider:inRow||cur||''});}});
      if(out.appts.length&&!out.diag.via)out.diag.via='grouped-dom';
    }
    var used={};out.appts.forEach(function(a){if(a.provider)used[a.provider.toLowerCase()]=a.provider;});
    out.providers=Object.keys(used).length?provOrder.filter(function(p){return used[p.toLowerCase()];}):provOrder;
    out.diag.apptCount=out.appts.length;out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);out.diag.credsSeen=Object.keys(credSet);
    /* v2.9.7: ALWAYS stamp which lane produced the result (grouped-dom/table-column
       previously set via but left strategy='dom' — consumers could not tell which
       parser ran). */
    if(out.diag.via&&out.diag.strategy==='dom')out.diag.strategy=out.diag.via;
  }catch(e){out.diag.err=String(e&&e.message||e).slice(0,120);}
  return out;
}
 if (/stm\.esp|\/coordinator\/|messaging|letters/i.test(location.pathname || '')) { return { u: location.href, t: '', s: null }; } /* v2.9.8: messaging/coordinator frames are NOT schedule sources (fabricated-appt guard) */ var T = (document.body && document.body.innerText || '').slice(0, 22000); var s = null; try { s = await mlsSchedDomInline(document, CFG); } catch (e) { s = { diag: { err: String(e && e.message || e).slice(0,120) } }; } return { u: location.href, t: T, s: s }; } catch (e) { return { u: '', t: '', s: null }; } }
          });
        } catch (e) {
          results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000), s: null }) });
        }
        let frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        /* v2.9.10 (Codex E3 p3): ZERO readable frames = transient injection/renderer state
           (a live athena tab always exposes frame text; an honestly-empty schedule still
           does). Recover the tab once and re-read with the simple text reader before
           failing — bounded, never loops. */
        if (!frames.length && tab && tab.id != null) {
          try {
            await mlsRecoverAthenaTab(tab.id);
            const r2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => { try { if (/stm\.esp|\/coordinator\/|messaging|letters/i.test(location.pathname || '')) return { u: location.href, t: '', s: null }; return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000), s: null }; } catch (e) { return { u: '', t: '', s: null }; } } });
            const f2 = (r2 || []).map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
            if (f2.length) frames = f2;
          } catch (eR2) {}
        }
        // CONTENT-SCORE each frame for "looks like a schedule" — appointment times, day/date
        // labels, scheduling words. This is what makes us resilient to Athena changing their
        // frame names / URLs: we find the schedule by what's IN it, not where it lives.
        const scoreSched = (f) => {
          const u = (f.u || '').toLowerCase(), t = (f.t || ''), tl = t.toLowerCase();
          let s = 0;
          if (/schedul|calendar|appointment|booking|frontoffice|dashboard/.test(u)) s += 25;     // URL hint = bonus, not required
          s += Math.min((t.match(/\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?/gi) || []).length, 60) * 2; // clock times = strongest signal
          ['appointment', 'schedul', 'provider', 'booking', 'arrived', 'checked in', 'check-in', 'exam room', 'no show', 'walk-in'].forEach((k) => { if (tl.indexOf(k) >= 0) s += 6; });
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].forEach((d) => { if (tl.indexOf(d) >= 0) s += 2; });
          s -= /conversation|colleague|inbox|message/.test(tl) ? 20 : 0;                            // de-rank the messaging frame
          if (/stm\.esp|\/coordinator\/|messaging|letters/.test(u)) s -= 500;                       // v2.9.8: HARD-exclude staff-messaging frames (fabricated-appt guard)
          s += Math.min(t.length, 14000) / 500;                                                     // size as a minor tiebreaker
          return s;
        };
        let pick = null, best = -1;
        frames.forEach((f) => { const s = scoreSched(f); if (s > best) { best = s; pick = f; } });
        pick = pick || { u: tab.url, t: '' };
        // Include the page title so the parser can anchor the date range of a multi-day view.
        var __mlsTS = (typeof mlsProv!=='undefined') ? mlsProv.fromText((pick && pick.t) || '') : {appts:[],providers:[],diag:{}}; var __mlsM = (typeof mlsProv!=='undefined') ? mlsProv.merge(pick && pick.s, __mlsTS) : {appts:[],providers:[],diag:{}};
        /* v2.9.11: ACCUMULATE the shadow-parser evidence across pulls/days — the per-pull
           nameShadow would otherwise evaporate with the response, and the canonical-parser
           cutover needs durable counts (>=3 days incl. month pull + structure lane,
           checked>=1000, differs=0 or reviewed). Stays in chrome.storage.local (same
           in-browser boundary as the rest of the pull data); samples capped at 40. */
        try {
          var __sh = pick && pick.s && pick.s.diag && pick.s.diag.nameShadow;
          if (__sh && __sh.checked) {
            var __strat = (pick.s.diag.strategy || pick.s.diag.via || 'unknown');
            chrome.storage.local.get(['mlsNameShadowTotals'], function (st) {
              try {
                /* v2.9.13 schema:2 (Codex): the pre-fix call-count totals are smoke
                   evidence only — reset rather than mixing semantics. days key on the
                   SCHEDULE date (a month pull must prove distinct schedule days);
                   wall-clock fallback counts land in daysUnknown, which never
                   satisfies the 3-schedule-day cutover gate. */
                var T = (st && st.mlsNameShadowTotals && st.mlsNameShadowTotals.schema === 3)
                  ? st.mlsNameShadowTotals
                  : { schema: 3, checked: 0, differs: 0, canonicalRejected: 0, canonicalAdded: 0, samples: [], days: {}, daysUnknown: 0, strategies: {} };
                T.checked += __sh.checked; T.differs += __sh.differs;
                T.canonicalRejected += (__sh.canonicalRejected || 0);
                T.canonicalAdded += (__sh.canonicalAdded || 0);
                (__sh.samples || []).forEach(function (sm) { if (T.samples.length < 40) T.samples.push(sm); });
                var schedDay = (pick && pick.s && pick.s.schedDate) || '';
                if (schedDay) T.days[schedDay] = (T.days[schedDay] || 0) + __sh.checked;
                else T.daysUnknown = (T.daysUnknown || 0) + __sh.checked;
                T.strategies[__strat] = (T.strategies[__strat] || 0) + __sh.checked;
                T.updatedAt = Date.now();
                chrome.storage.local.set({ mlsNameShadowTotals: T });
              } catch (e2) {}
            });
          }
        } catch (eSh) {}
        sendResponse({ ok: true, emr: isRealAthena ? 'athena' : 'other-emr', host: mlsHostOnly(pick.u || tab.url), id: msg.id, text: ((tab.title ? ('[' + tab.title + ']\n') : '') + (pick.t || '')).slice(0, 22000), url: pick.u || tab.url, title: tab.title, frames: frames.length, appts: mlsAttachDobs(__mlsM.appts, (pick && pick.t) || ''), providers: __mlsM.providers, providerDiag: __mlsM.providerDiag, schedDate: (pick && pick.s && pick.s.schedDate) || '' });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // READ-ONLY: read the open Athena REPORT / claims / procedure / patient LIST tab so MLS can
  // enumerate patients by procedure/CPT (Study cohort, Mode B). Resilient by design: it finds
  // the EMR tab broadly, reads EVERY frame, and CONTENT-SCORES each for "looks like a report
  // table" (many dated rows, CPT-like 5-digit codes, $ charges, claim/procedure/service-date
  // headers). It returns the richest table frame PLUS a capped concatenation of the top frames
  // (a report can span frames), so the app's parser sees the whole list. It never writes.
  if (msg.type === 'mlsAppReportRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        /* v1.90: unified verified picker; non-athena EMR keyword fallback preserved. */
        let tab = await mlsPickAthenaTab(all, { athenaOnly: true })
               || all.find((t) => /epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|report|claim|billing|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com|athena/i.test(t.url || ''));
        // v1.38 truth fix: no arbitrary-tab fallback for a positive result (phantom-tab bug).
        if (!tab) return sendResponse({ ok: false, reason: 'no-athena-tab', emr: 'none', host: '', id: msg.id, error: 'Open a signed-in athenaOne report tab, then try again.' });
        const isRealAthena = /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(tab.url || '');
        let results = [];
        /* v2.9.14 (Codex E3 residual): HARD 45s envelope so a permanently hung
           executeScript can no longer hang this handler; a double rejection or
           timeout falls through to the existing zero-frames settle+re-read
           (single retry, NO reload — POST-generated report views must survive). */
        {
          const rx = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 60000) }; } catch (e) { return { u: '', t: '' }; } } }, 45000);
          if (rx && rx.r) results = rx.r;
          else { try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 60000) }) }); } catch (e) { results = []; } }
        }
        let frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        /* v2.9.11 (Codex E3 p3): zero readable frames on a live tab = transient injection/
           render state — settle and re-read ONCE. Deliberately NO tab reload here: a
           POST-generated report view would not survive a reload (unlike the schedule,
           which recovers to the dashboard safely). Never loops. */
        if (!frames.length && tab && tab.id != null) {
          try {
            await new Promise((r) => setTimeout(r, 1200));
            const r2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 60000) }; } catch (e) { return { u: '', t: '' }; } } });
            const f2 = (r2 || []).map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
            if (f2.length) frames = f2;
          } catch (eR2) {}
        }
        // CONTENT-SCORE each frame for "looks like a report/claims/procedure LIST" — what makes
        // us resilient to Athena renaming frames/URLs: we find the report by what's IN it.
        const scoreReport = (f) => {
          const u = (f.u || '').toLowerCase(), t = (f.t || ''), tl = t.toLowerCase();
          let s = 0;
          if (/report|claim|billing|procedure|encounter|export|analy|registr|worklist|patient.?list/.test(u)) s += 20; // URL hint = bonus, not required
          const dates = (t.match(/\b[01]?\d[\/\-][0-3]?\d[\/\-]\d{2,4}\b/g) || []).length;          // dated rows (DOB / service date)
          s += Math.min(dates, 200) * 2;
          const cpts = (t.match(/\b\d{5}\b/g) || []).length;                                         // CPT-like 5-digit codes
          s += Math.min(cpts, 200) * 1.5;
          const money = (t.match(/\$\s?\d/g) || []).length;                                          // charges
          s += Math.min(money, 100);
          ['cpt', 'procedure', 'service date', 'date of service', 'dos', 'claim', 'charge', 'billed', 'units', 'modifier', 'rendering', 'diagnosis', 'icd', 'mrn', 'date of birth', 'dob', 'patient name'].forEach((k) => { if (tl.indexOf(k) >= 0) s += 5; });
          s -= /conversation|colleague|inbox|message|chat/.test(tl) ? 25 : 0;                         // de-rank the messaging frame
          s += Math.min(t.length, 40000) / 600;                                                       // size as a minor tiebreaker
          return s;
        };
        const scored = frames.map((f) => ({ f: f, s: scoreReport(f) })).sort((a, b) => b.s - a.s);
        const best = scored[0] || { f: { u: tab.url, t: '' }, s: 0 };
        // A report can render across sibling frames; concat the top few scoring frames (capped)
        // so the app parser sees every patient row, not just the single best frame.
        let concat = '';
        for (const sc of scored) { if (sc.s <= 0) break; if (concat.length > 44000) break; concat += (concat ? '\n\n' : '') + (sc.f.t || ''); }
        const text = ((tab.title ? ('[' + tab.title + ']\n') : '') + (concat || best.f.t || '')).slice(0, 46000);
        sendResponse({ ok: true, emr: isRealAthena ? 'athena' : 'other-emr', host: mlsHostOnly(best.f.u || tab.url), id: msg.id, text: text, url: best.f.u || tab.url, title: tab.title, frames: frames.length, bestScore: Math.round(best.s) });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // ===== Mode C: DRIVE the athenaOne procedure search + paginate (READ-ONLY) =====
  // The injected mlsAthenaDrive runs in EVERY frame; we pick the frame that actually has the
  // controls / the report, so it is resilient to Athena's frames. It only operates the search
  // controls (CPT/procedure + dates + Run/Next) and NEVER clicks Save/Sign (excludeClickLabels).
  // FILL + RUN the search.
  if (msg.type === 'mlsAppSearchFill') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = await mlsPickAthenaTab(all); /* v1.90 unified picker (generic-EMR fallback built in) */
        if (!tab) return sendResponse({ ok: false, error: 'Open your signed-in athenaOne in another tab (a procedure/claims report or charge-search screen), then try again.' });
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaDrive, args: ['fill', msg.params || {}, msg.cfg || {}] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mlsAthenaDrive, args: ['fill', msg.params || {}, msg.cfg || {}] }); }
        const vals = results.map((r) => r && r.result).filter(Boolean);
        let acted = null;
        vals.forEach((v) => { if (v && v.acted) { if (!acted || (v.clickedRun && !acted.clickedRun)) acted = v; } });
        sendResponse({ ok: true, tabId: tab.id, acted: acted || { acted: false }, frames: vals.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // READ the current result page (best-scoring frame) + detect a Next control.
  if (msg.type === 'mlsAppSearchRead') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = (msg.tabId && all.find((t) => t.id === msg.tabId)) || await mlsPickAthenaTab(all); /* v1.90; SearchFill's tabId still wins */
        if (!tab) return sendResponse({ ok: false, error: 'No athenaOne tab found.' });
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaDrive, args: ['read', {}, msg.cfg || {}] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mlsAthenaDrive, args: ['read', {}, msg.cfg || {}] }); }
        const vals = results.map((r) => r && r.result).filter((v) => v && v.ok).sort((a, b) => (b.score || 0) - (a.score || 0));
        const best = vals[0] || { text: '', sig: '', hasNext: false, count: 0, score: 0, nextDesc: '' };
        let concat = '';
        for (const v of vals) { if ((v.score || 0) <= 0) break; if (concat.length > 44000) break; if (v.text) concat += (concat ? '\n\n' : '') + v.text; }
        sendResponse({ ok: true, tabId: tab.id, text: (concat || best.text || '').slice(0, 46000), sig: best.sig, hasNext: vals.some((v) => v.hasNext), nextDesc: best.nextDesc || '', rowCount: best.count || 0, bestScore: best.score || 0, frames: vals.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // CLICK the Next-page control in the best report frame.
  if (msg.type === 'mlsAppSearchNext') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = (msg.tabId && all.find((t) => t.id === msg.tabId)) || await mlsPickAthenaTab(all); /* v1.90; SearchFill's tabId still wins */
        if (!tab) return sendResponse({ ok: false, error: 'No athenaOne tab found.' });
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsAthenaDrive, args: ['next', {}, msg.cfg || {}] }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: mlsAthenaDrive, args: ['next', {}, msg.cfg || {}] }); }
        const clicked = results.map((r) => r && r.result).filter(Boolean).some((v) => v.clicked);
        sendResponse({ ok: true, tabId: tab.id, clicked: clicked });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }

  // Open + read ONE PATIENT'S CHART from Athena. If a patient name is given, try to

  // click that patient (in the schedule/search) to open their chart, then read the
  // frame that scores highest on clinical-chart keywords (so we never grab the schedule).
  if (msg.type === 'mlsAppChartRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        let tab = await mlsPickAthenaTab(all, { athenaOnly: true }); /* v1.90 unified picker */
        if (!tab) { const cand = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\/|athena/i.test(t.url || '')); cand.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); tab = cand[0]; }
        if (!tab) return sendResponse({ ok: false, error: 'Open the patient in your Athena tab, then try again.' });
        const want = String(msg.patient || '').trim();
        let opened = false;
        // Click a visible patient name, OR type the name into an Athena search box, so we
        // can OPEN the chart without the doctor having to click it themselves.
        const openFn = (name) => {
          try {
            const parts = name.toLowerCase().replace(/[^a-z\s,]/g, '').split(/[\s,]+/).filter(Boolean);
            if (!parts.length) return 'no';
            const last = parts[parts.length - 1], first = parts[0];
            /* v1.62: athenaOne v26.3 schedule rows are React-wired <div>s - a bare
               el.click() never navigates. Dispatch the real pointer/mouse sequence. */
            const realClick = (el) => {
              try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
              try {
                const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
                const o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
                ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach((tp) => {
                  try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e2) {}
                });
              } catch (e3) {}
              try { el.click(); } catch (e4) {}
            };
            const clickName = () => {
              /* v1.59 perf: textContent (no innerText layout-forcing walk) + element cap.
                 The all-frames innerText walk is what froze athenaOne for 78s. */
              const els = Array.from(document.querySelectorAll('a,button,[role="link"],[role="button"],[onclick],td,li,span,div')).slice(0, 5000);
              /* prefer the SMALLEST matching element (the name cell), not a huge wrapper */
              let best = null, bestLen = 1e9;
              for (const el of els) {
                const t = (el.textContent || '').trim().toLowerCase();
                if (t && t.length < 70 && t.indexOf(last) >= 0 && (parts.length < 2 || t.indexOf(first) >= 0)) {
                  const r = el.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0 && t.length < bestLen) { best = el; bestLen = t.length; }
                }
              }
              if (best) { realClick(best); return true; }
              return false;
            };
            if (clickName()) return 'clicked';
            const inputs = Array.from(document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])'));
            const box = inputs.find((i) => {
              const h = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.id || '')).toLowerCase();
              const r = i.getBoundingClientRect(); const t = (i.type || '').toLowerCase();
              if (r.width <= 0 || r.height <= 0) return false;
              // NEVER type a patient NAME into a numeric / ID field — that's what throws Athena's
              // "Patient ID must be numeric" error. Skip number/tel/date fields and any ID-ish label.
              if (t === 'number' || t === 'tel' || t === 'date' || t === 'email' || t === 'password') return false;
              if ((i.inputMode || '').toLowerCase() === 'numeric') return false;
              if (/patient\s*id|patientid|\bid\b|\bmrn\b|chart\s*(id|no|num)|\bnpi\b|account|claim|invoice|\bnumber\b|ssn|\bdob\b/.test(h)) return false;
              return /search|name|find|look\s*up|lookup|filter|patient/.test(h);
            });
            if (box) {
              box.focus(); box.value = name;
              box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true }));
              ['keydown', 'keypress', 'keyup'].forEach((tp) => box.dispatchEvent(new KeyboardEvent(tp, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
              return 'searched';
            }
            return 'no';
          } catch (e) { return 'no'; }
        };
        if (want) {
          let statuses = [];
          try { const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: openFn, args: [want] }); statuses = res.map((r) => r && r.result); } catch (e) {}
          if (statuses.indexOf('clicked') >= 0) { opened = true; await new Promise((r) => setTimeout(r, 1900)); }
          else if (statuses.indexOf('searched') >= 0) {
            // gave Athena the name — wait for results, then click the matching result.
            await new Promise((r) => setTimeout(r, 2600));
            try { const res2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: openFn, args: [want] }); if (res2.map((r) => r && r.result).indexOf('clicked') >= 0) { opened = true; await new Promise((r) => setTimeout(r, 1900)); } } catch (e) {}
          }
        }
        /* ===== v1.59 CHART-READY GATE =====
           athenaOne v26.3 lands schedule-clicks on the appointment EXAM-PREP /
           BRIEFING view where the patient banner (name+DOB) has not rendered, so
           reads there captured the PROVIDER as the "patient" and the identity
           gate refused everything (the 0-of-23 pull). Before reading: poll the
           chart identity; when the exam-prep view is detected, click its read-only
           "REFRESH CHART" / "Chart" control and WAIT for the real patient banner.
           Fails honestly if the clinical chart never loads. Gates untouched. */
        let ident = null, sawBriefing = false, navClicked = '', clickAt = 0, polls = 0, injFails = 0, noClickRounds = 0, fgByUs = false, identDiag = [];
        const T0 = Date.now(), BUDGET_MS = 52000; /* stays inside the app's 75s bridge timeout */
        /* v1.60: EXPECTED patient - a bare read that follows a search-open (the
           day/month pull pattern) must wait for THAT patient's banner, not accept
           whatever identity some stale/lurking frame still carries. */
        const expectName = want || ((self.__mlsExpectOpen && (Date.now() - self.__mlsExpectOpen.at) < 180000) ? self.__mlsExpectOpen.name : '');
        const nmm = (a, b) => { const nz = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); const ta = nz(a).split(' ').filter(x => x.length > 1), tb = nz(b).split(' ').filter(x => x.length > 1); const o = ta.filter(x => tb.indexOf(x) >= 0).length; return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1); };
        while (Date.now() - T0 < BUDGET_MS) {
          polls++;
          /* v1.63: 15s -> 20s. A heavy-but-alive chart load could eat two 15s injection
             timeouts and trigger a FALSE "athena-frozen-recovered" reload (v1.61 live
             finding). 2 x 20s + sleep still fits the 52s budget. */
          const ix = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsReadChartIdentity }, 20000);
          if (ix.timeout) {
            injFails++;
            if (injFails >= 2) { /* frozen renderer - documented recovery, then honest fail (the app retries) */
              await mlsRecoverAthenaTab(tab.id);
              return sendResponse({ ok: false, reason: 'athena-frozen-recovered', opened: opened, error: 'athenaOne stopped responding mid-read; the tab was reloaded and recovered. Pull again.' });
            }
            await mlsSleepW(1800); continue;
          }
          injFails = 0;
          const idrArr = ((ix && ix.r) || []).map((m) => m && m.result).filter(Boolean);
          identDiag = idrArr.map((r) => ({ via: r.via || '', named: !!r.name, sc: Math.round((r.score || 0) * 10) / 10, w: r.w || 0, h: r.h || 0 })).slice(0, 24);
          let cand = mlsBestIdentityFrom((ix && ix.r) || []);
          /* v1.78: shadow-DOM banner fallback (clientsummary/airlock surfaces) -
             fires ONLY when the classic reader found nothing acceptable, so the
             proven schedule-click -> clinical-chart path is untouched. The shadow
             reader emits identity only with BOTH name and DOB.
             v1.81: give the proven REFRESH-CHART/briefing nudge (below) the FIRST
             round - when the nudge can load the full clinical chart, its light-DOM
             banner is the best surface for BOTH identity and the text read; accept
             a shadow identity only from round 2, or once a nudge was clicked. */
          if ((polls >= 2 || navClicked) && (!cand || !cand.name || (cand.score || 0) < 0
              /* v1.86: ...or the classic identity is a WEAK non-banner grep that is
                 NOT the expected patient - on shadow-banner charts the classic
                 reader can only find care-team/provider names in the light DOM
                 (live: Barbara Clardy's chart kept reading "Mainline, Lauren M."
                 via lastfirst, so the shadow fallback never ran and the gate
                 refused her every pull). A banner-grade shadow identity beats a
                 lastfirst guess; if shadow finds nothing, behavior is unchanged. */
              || (cand.via !== 'banner' && expectName && !nmm(cand.name, expectName)))) {
            const sIdent = await mlsShadowIdentityTry(tab.id);
            if (sIdent) { cand = sIdent; identDiag.push({ via: sIdent.via || 'shadow', named: true, sc: Math.round((sIdent.score || 0) * 10) / 10, w: sIdent.w || 0, h: sIdent.h || 0 }); }
          }
          /* the RIGHT patient found (any via) -> done */
          if (cand && cand.name && expectName && nmm(cand.name, expectName)) { ident = cand; try { self.__mlsExpectOpen = null; } catch (e) {} break; }
          /* no expectation: a banner IS the open chart -> done (pre-v1.60 behavior, banner-only) */
          if (cand && cand.name && !expectName && cand.via === 'banner') { ident = cand; break; }
          /* catch-all: budget nearly spent - return the best we have; the app-side
             gate makes the final call (honest refuse on mismatch).
             v1.67: NEVER return a junk-frame identity (negative score = demoted
             letters/messaging/hidden frame - the live "Monterosso, ROSEMARY" phantom
             refused 5 of 15 on the 7/07 pull). Returning NO identity lets the app
             gate fall back to name-tokens-in-chart-text + schedule-DOB, which SAVES
             correctly when the real chart is on screen. */
          if (Date.now() - T0 > 42000 && cand && cand.name && (cand.score || 0) >= 0) { ident = cand; break; }
          if (Date.now() - T0 > 42000) { ident = null; break; }
          /* not the right identity yet: is this the exam-prep/briefing view? nudge it. */
          const ex = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsEnsureClinicalChartFn }, 10000);
          const evs = ((ex && ex.r) || []).map((m) => m && m.result).filter(Boolean);
          const briefingNow = evs.some((v) => v && v.briefing);
          sawBriefing = sawBriefing || briefingNow;
          const clickedNow = evs.find((v) => v && v.clicked);
          if (clickedNow) {
            navClicked = navClicked || clickedNow.clicked; clickAt = Date.now(); noClickRounds = 0;
            /* the chart load runs page JS; a hidden tab is throttled ~9x - foreground
               it for the load (day pulls already run foregrounded via go-home; when
               we take focus ourselves we hand it back to MLS below). */
            try { await (self.__mlsQpEnsure ? self.__mlsQpEnsure(tab, sender && sender.tab && sender.tab.id) : null); } catch (e) {} /* v2.9.5 quiet pull: work strip instead of tab yank (fgByUs stays false -> restoreFocus stays dormant) */
            await mlsSleepW(3200); continue;
          }
          if (navClicked) {
            /* we clicked into the clinical chart and it is loading (briefing markers
               gone) - keep waiting; accept a weaker identity only after settle AND
               only when nothing specific was expected (else wait for the match). */
            if (cand && cand.name && !expectName && (cand.score || 0) >= 0 && clickAt && (Date.now() - clickAt) > 12000) { ident = cand; break; } /* v1.67: junk-frame guard */
          } else if (!briefingNow) {
            if (cand && cand.name && !expectName && (cand.score || 0) >= 0) { ident = cand; break; } /* ordinary chart, name-only identity; v1.67: junk-frame guard */
            if (!expectName && polls >= (sawBriefing ? 8 : 3)) { ident = cand || null; break; } /* nothing more to wait for */
          }
          noClickRounds++;
          if (briefingNow && noClickRounds >= 5 && !navClicked) break; /* exam-prep with nothing safe to click -> fail honestly below */
          await mlsSleepW(2400);
        }
        const V59 = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
        const restoreFocus = async () => { if (!fgByUs) return; try { if (self.__mlsFgFocusApp) await self.__mlsFgFocusApp(); } catch (e) {} };
        if (sawBriefing && !(ident && ident.name)) {
          __mlsReadsSinceReload++;
          await restoreFocus();
          return sendResponse({ ok: false, reason: 'exam-prep-stuck', opened: opened, briefing: true, navClicked: navClicked, polls: polls, identDiag: identDiag, version: V59, error: 'athenaOne stayed on the appointment exam-prep view (no patient banner) - the clinical chart never loaded, so nothing was captured.' });
        }
        let results = [];
        {
          const tx = await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 18000) }; } catch (e) { return { u: '', t: '' }; } } }, 25000);
          if (tx.timeout) { /* frozen mid-read - recover and fail honestly (the app retries) */
            await mlsRecoverAthenaTab(tab.id);
            await restoreFocus();
            return sendResponse({ ok: false, reason: 'athena-frozen-recovered', opened: opened, version: V59, error: 'athenaOne stopped responding during the chart read; the tab was reloaded and recovered. Pull again.' });
          }
          if (tx.r) results = tx.r;
          else { try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 18000) }) }); } catch (e) { results = []; } }
        }
        __mlsReadsSinceReload++;
        /* v1.60 diag: per-frame text sizes BEFORE filtering (PHI-free) - tells us
           which frames the worker can even see when a pane goes missing. */
        const textDiag = (results || []).map((r) => (r && r.result ? (r.result.t || '').length : -1)).slice(0, 24);
        /* v1.50: drop messaging/nav/status noise frames (athenaText etc.) BEFORE scoring */
        /* v1.81: also drop findpatient.esp - its RESULTS table carries the patient's
           name AND DOB, and a read that runs while it is on screen must never hand
           that page back as "the chart" (live: the app gate had to refuse it). */
        const frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim() && !/stm\.esp|coordinator\/enterprise|globalnav\.esp|statusbar\.esp|schedulenavclose|findpatient\.esp/i.test(r.u || ''));
        const score = (txt) => { const s = (txt || '').toLowerCase(); let n = 0; ['problem', 'medication', 'allerg', 'history', 'vital', 'diagnos', 'assessment', 'date of birth', 'dob', 'surg', 'imaging', 'mri', 'immuniz'].forEach((k) => { if (s.indexOf(k) >= 0) n++; }); ['full encounter summary', 'encounter summary', 'performed by', 'reason for visit', 'follow-up', 'assessment & plan'].forEach((k) => { if (s.indexOf(k) >= 0) n += 3; }); if (/inbox|unread messages|message thread/.test(s)) n -= 4; return n; };
        /* v1.50: MERGE the clinical frames instead of picking ONE — on athenaOne the
           encounter summary (procedure name/date, performed by, assessment & plan,
           follow-up) lives in a SMALL separate frame that single-frame picking dropped,
           which is why pulled summaries were missing encounter-level detail. */
        const ranked = frames.map((f) => ({ f: f, s: score(f.t) })).sort((a, b) => b.s - a.s);
        const chosen = [];
        let used = 0; const CAP = 26000;
        ranked.forEach((r) => { if (r.s <= 0 || used >= CAP) return; chosen.push(r.f); used += Math.min((r.f.t || '').length, CAP - used); });
        frames.forEach((f) => { if (/full encounter summary|encounter summary/i.test(f.t || '') && chosen.indexOf(f) < 0) chosen.unshift(f); });
        let merged = ''; chosen.forEach((f) => { if (merged.length >= CAP) return; merged += (merged ? '\n\n===== (next chart frame) =====\n\n' : '') + (f.t || '').slice(0, Math.max(0, CAP - merged.length)); });
        const pick = (ranked.length ? ranked[0].f : null) || { u: tab.url, t: '' };
        /* v1.50 IDENTITY GATE: if a specific patient was requested and the open chart
           belongs to someone else, FAIL HONESTLY — never hand back another patient's
           chart (this once filed one chart into 62 records).
           v1.59: `ident` was already resolved (banner-verified) by the chart-ready
           gate above — no second heavy identity pass. */
        const nrm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const nMatch = (a, bb) => { if (!a || !bb) return true; const ta = nrm(a).split(' ').filter((x) => x.length > 1), tb = nrm(bb).split(' ').filter((x) => x.length > 1); const o = ta.filter((x) => tb.indexOf(x) >= 0).length; return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1); };
        const V = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
        if (want && ident && ident.name && !nMatch(ident.name, want)) {
          await restoreFocus();
          return sendResponse({ ok: false, reason: 'wrong-chart', chartName: ident.name, chartDob: ident.dob || '', opened: opened, version: V, error: 'The open athenaOne chart is ' + ident.name + ', not ' + want + '. Nothing was captured for ' + want + '.' });
        }
        if (want && !opened && !(ident && ident.name)) {
          await restoreFocus();
          return sendResponse({ ok: false, reason: 'unverified', opened: false, version: V, error: 'Could not open or verify ' + want + '\u2019s chart (no patient identity readable on the open page). Open the patient\u2019s chart in athenaOne, then pull again \u2014 nothing was captured.' });
        }
        await restoreFocus();
        /* v1.89: chartMrn - the athena patient/chart ID from the banner. The app
           uses it as the PRIMARY dedup key (name+DOB fallback), so it must ride
           along on every read that verified an identity. */
        sendResponse({ ok: true, text: merged.slice(0, 26000), url: pick.u || tab.url, title: tab.title, opened: opened, frames: frames.length, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', chartMrn: (ident && ident.mrn) || '', version: V, via: (ident && ident.via) || '', briefingNav: navClicked || '', identDiag: identDiag, textDiag: textDiag, expected: expectName ? 1 : 0 });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  /* ---- v1.51: read the OPEN athena chart's identity (for the writeback pre-gate) ---- */
  if (msg.type === 'mlsAssistChartIdentity') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        const tab = await mlsPickAthenaTab(all, { athenaOnly: true }); /* v1.90 unified picker */
        if (!tab) return sendResponse({ ok: false, error: 'no athena tab' });
        const idr = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsReadChartIdentity });
        let ident = mlsBestIdentityFrom(idr); /* v1.59: banner-preferred */
        /* v1.78/v1.86: shadow-DOM banner fallback (see mlsReadChartIdentityShadow);
           a banner-grade shadow identity also replaces a weak non-banner grep. */
        if (!ident || !ident.name || (ident.score || 0) < 0 || ident.via !== 'banner') { const sI = await mlsShadowIdentityTry(tab.id); if (sI && (!ident || ident.via !== 'banner')) ident = sI; }
        sendResponse({ ok: true, identity: ident ? { name: ident.name, dob: ident.dob || '', mrn: ident.mrn || '' } : null });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // Read the innerText of whatever tab is ACTIVE right now (so the agent sees the
  // tab it is currently on, even after a tab switch).
  if (msg.type === 'mlsAssistPageText') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ text: '' });
        // Read EVERY frame (top + iframes) so the agent can see iframe-based EMRs.
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => (document.body && document.body.innerText || '').slice(0, 6000) }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body && document.body.innerText || '').slice(0, 9000) }); }
        let text = '';
        for (const fr of results) { const t = fr && fr.result; if (t) { text += (text ? '\n---- (frame) ----\n' : '') + t; } if (text.length > 12000) break; }
        sendResponse({ text: text.slice(0, 12000), url: tab.url, title: tab.title });
      } catch (e) { sendResponse({ text: '' }); }
    })();
    return true;
  }
  // Numbered inventory of the interactive controls on the ACTIVE tab. The agent
  // targets these by #index, which is far more reliable than guessing labels.
  // MUST stay in lock-step with _inv() inside mlsAssistExec (same selector/order).
  if (msg.type === 'mlsAssistElements') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ list: [] });
        const perFrame = () => {
          function vis(el) { try { if (el.disabled) return false; if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return true; } catch (e) { return true; } }
          function lab(e) { var s = (e.innerText || e.value || (e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name'))) || e.id || ''); return String(s).replace(/\s+/g, ' ').trim().slice(0, 60); }
          var sel = 'button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick]';
          var nodes = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
          return nodes.map(function (e) { var tag = (e.tagName || '').toLowerCase(); var ty = e.getAttribute && e.getAttribute('type'); var role = e.getAttribute && e.getAttribute('role'); var ph = e.getAttribute && e.getAttribute('placeholder'); return tag + (ty ? ('[' + ty + ']') : '') + (role ? (' role=' + role) : '') + ' «' + (lab(e) || ph || '') + '»'; });
        };
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: perFrame }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: perFrame }); }
        const list = [], map = [];
        for (const fr of results) {
          const arr = (fr && fr.result) || [];
          for (let li = 0; li < arr.length; li++) {
            if (list.length >= 120) break;
            map.push({ frameId: fr.frameId || 0, localIndex: li });
            list.push(list.length + ': ' + arr[li]);
          }
          if (list.length >= 120) break;
        }
        _mlsFrameMap[tab.id] = map;
        sendResponse({ list });
      } catch (e) { sendResponse({ list: [] }); }
    })();
    return true;
  }
  // Execute a single agent action on the ACTIVE tab (or switch tabs). This lets the
  // autopilot act on whatever tab it is on, including after switching.
  if (msg.type === 'mlsAssistExec') {
    (async () => {
      try {
        const action = msg.action || {};
        if (action.type === 'switchtab') {
          const tabs = await chrome.tabs.query({});
          const t = String(action.target || '').toLowerCase().trim();
          const http = tabs.filter(x => /^https?:/.test(x.url || ''));
          let tab = t ? http.find(x => ((x.title || '').toLowerCase().includes(t) || (x.url || '').toLowerCase().includes(t))) : null;
          if (!tab) { const others = http.filter(x => !x.active).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); tab = others[0]; }
          if (!tab) return sendResponse({ ok: false, msg: 'No other tab to switch to.' });
          await chrome.tabs.update(tab.id, { active: true });
          try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
          return sendResponse({ ok: true, msg: 'Switched to: ' + (tab.title || tab.url || 'tab') });
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ ok: false, msg: 'No active tab.' });
        // Frame routing: a "#index" target may live inside an iframe (Athena, etc.).
        // Look it up in the map built by mlsAssistElements and run the action in THAT
        // frame, passing the element's local index so it resolves the exact control.
        let _execTarget = { tabId: tab.id };
        let _act = action;
        const _im = /^#(\d+)$/.exec(String(action.target || '').trim());
        if (_im && _mlsFrameMap[tab.id] && _mlsFrameMap[tab.id][+_im[1]]) {
          const _ent = _mlsFrameMap[tab.id][+_im[1]];
          if (_ent.frameId) _execTarget = { tabId: tab.id, frameIds: [_ent.frameId] };
          _act = Object.assign({}, action, { _localIdx: _ent.localIndex });
        }
        // Retry wrapper: web EMRs render asynchronously, so a target may not exist on
        // the first try. We re-run the injected executor a few times with a short
        // settle delay — but ONLY when the failure was "couldn't find it" (notfound).
        // Success returns immediately, so the happy path stays fast.
        const tries = (action && /^(click|confirm|type|select|pastenote)$/.test(action.type || '')) ? 5 : 1;
        let r = null;
        for (let i = 0; i < tries; i++) {
          [r] = await chrome.scripting.executeScript({
          target: _execTarget,
          args: [_act],
          func: async (act) => {
            function visible(el) {
              if (!el) return false;
              try {
                if (el.disabled) return false;
                if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
                const st = getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false;
                const rc = el.getBoundingClientRect();
                if (rc.width < 1 || rc.height < 1) return false;
                return true;
              } catch (e) { return true; }
            }
            function labelOf(e) {
              return ((e.innerText || e.value || (e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name') || e.id)) || '') + '').toLowerCase().replace(/\s+/g, ' ').trim();
            }
            // Rebuild the SAME ordered inventory the agent saw, so a "#index" target
            // maps to the exact element. Must match mlsAssistElements above.
            function _inv() {
              function vis(el) { try { if (el.disabled) return false; if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return true; } catch (e) { return true; } }
              var sel = 'button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick]';
              return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
            }
            function _byIdx(t) { var m = /^#(\d+)$/.exec(String(t || '').trim()); if (!m) return null; var el = _inv()[+m[1]]; return (el && visible(el)) ? el : (el || null); }
            // When frame-routed, the background passes the element's LOCAL index in this frame.
            function _local() { try { return (typeof act._localIdx === 'number') ? (_inv()[act._localIdx] || null) : null; } catch (e) { return null; } }
            // Scored finder — prefers an exact label, a visible & enabled element, an
            // interactive role, and one inside the viewport. Far more accurate than the
            // old "first substring match", which often clicked the wrong control.
            function findEl(target) {
              if (!target) return null;
              try { const el = document.querySelector(target); if (el && visible(el)) return el; } catch (e) {}
              const t = String(target).toLowerCase().replace(/\s+/g, ' ').trim();
              if (!t) return null;
              const cand = [...document.querySelectorAll('button,a,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input,textarea,select,label,[onclick],[contenteditable=""],[contenteditable="true"]')];
              const tc = t.replace(/[^a-z0-9 ]/g, '').trim();
              let best = null, bestScore = 19;
              for (const e of cand) {
                const lab = labelOf(e);
                if (!lab) continue;
                let s = -1;
                if (lab === t) s = 100;
                else if (lab.replace(/[^a-z0-9 ]/g, '').trim() === tc) s = 90;
                else if (lab.startsWith(t) || lab.endsWith(t)) s = 70;
                else if (lab.includes(t)) s = 50 - Math.min(40, Math.abs(lab.length - t.length));
                if (s < 0) continue;
                if (visible(e)) s += 30; else s -= 25;
                const tag = (e.tagName || '').toLowerCase();
                if (tag === 'button' || (e.getAttribute && e.getAttribute('role') === 'button') || tag === 'a') s += 6;
                try { const rc = e.getBoundingClientRect(); if (rc.top >= 0 && rc.top < innerHeight) s += 4; } catch (er) {}
                if (s > bestScore) { bestScore = s; best = e; }
              }
              return best;
            }
            function fireClick(el) {
              try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
              const r = el.getBoundingClientRect();
              const x = r.left + r.width / 2, y = r.top + r.height / 2;
              const opt = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
              for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                try { el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, opt)); } catch (e) {}
              }
              try { el.click(); } catch (e) {}
            }
            // v1.28 — hardened, VERIFIED text entry (same logic as top-level mlsRobustType):
            // resolves a real editable field from a label/wrapper, clicks+focuses, native
            // setter -> simulated paste -> per-character keystrokes that drive MASKED inputs,
            // then SELECTS a matching TYPEAHEAD suggestion, and re-reads after settle + blur.
            // Returns {ok, confirmed, stuck, picked, method, reason} so the loop can stop.
            async function typeInto(el, text) {
              var txt = String(text == null ? '' : text);
              var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
              function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
              function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var sib = e.nextElementSibling, k = 0; while (sib && k < 3) { if (_isEd(sib)) return sib; var inS = sib.querySelector && sib.querySelector('input:not([type=hidden]),textarea,[contenteditable]'); if (_isEd(inS)) return inS; sib = sib.nextElementSibling; k++; } } catch (e4) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
              el = _resolve(el);
              if (!el || !_isEd(el)) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'no-field', into: 0 };
              if (el.readOnly || el.disabled) return { ok: false, confirmed: false, stuck: true, method: 'none', reason: 'readonly', into: 0 };
              var CE = !!el.isContentEditable;
              function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
              function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
              function digits(s) { return String(s || '').replace(/\D/g, ''); }
              function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
              var masked = isMasked();
              function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
              function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
              function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
              function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
              function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
              try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
              try { el.click(); } catch (e) {}
              try { el.focus(); } catch (e) {}
              await sleep(0);
              async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
              async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return { picked: false }; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return { picked: false }; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return { picked: true, label: (pick.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) }; }
              var method = '';
              if (!masked) {
                try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
                await sleep(0); if (landed()) method = 'native';
                if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
              }
              if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = masked ? 'mask' : 'keystroke'; }
              var sug = { picked: false }; try { sug = await pickSuggestion(); } catch (e) {}
              if (sug.picked) { await sleep(60); method = method || (landed() ? 'typeahead' : 'typeahead-selected'); }
              await sleep(120);
              if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
              if (landed()) return { ok: true, confirmed: true, stuck: false, method: method || 'native', into: rd().length, picked: !!sug.picked, pickedLabel: sug.label || '' };
              if (sug.picked) return { ok: true, confirmed: false, stuck: false, method: 'typeahead-selected', into: rd().length, picked: true, pickedLabel: sug.label || '', reason: 'selected-suggestion-unconfirmed' };
              return { ok: false, confirmed: false, stuck: true, method: 'unconfirmed', into: rd().length, reason: masked ? 'masked-rejected' : 'not-stuck' };
            }
            function setSelectByText(sel, text) {
              const t = String(text || '').toLowerCase().trim();
              let opt = [...sel.options].find(o => (o.textContent || '').toLowerCase().trim() === t || (o.value || '').toLowerCase().trim() === t);
              if (!opt) opt = [...sel.options].find(o => ((o.textContent || '').toLowerCase().trim().includes(t)) || ((o.value || '').toLowerCase().trim() === t));
              if (!opt) return false;
              sel.value = opt.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
            }
            const a = act || {};
            if (a.type === 'select') {
              const t = String(a.target || '').toLowerCase().trim();
              let sel = null;
              var _bi = _local() || _byIdx(a.target); if (_bi && _bi.tagName === 'SELECT') sel = _bi;
              try { if (!sel) { const q = document.querySelector(a.target); if (q && q.tagName === 'SELECT') sel = q; } } catch (e) {}
              if (!sel) sel = [...document.querySelectorAll('select')].find(s => (((s.id || '') + ' ' + (s.name || '') + ' ' + (s.getAttribute('aria-label') || '') + ' ' + (s.getAttribute('title') || '')).toLowerCase().includes(t)));
              if (!sel) sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => (o.textContent || '').toLowerCase().includes(String(a.text || '').toLowerCase().trim())));
              if (!sel) return { ok: false, notfound: true, msg: 'No dropdown found for: ' + (a.target || '') };
              return setSelectByText(sel, a.text) ? { ok: true, msg: 'Set ' + (a.target || 'dropdown') + ' to ' + (a.text || '') } : { ok: false, msg: 'Option not found: ' + (a.text || '') };
            }
            if (a.type === 'click' || a.type === 'confirm') {
              const el = _local() || _byIdx(a.target) || findEl(a.target);
              if (!el) {
                const t = String(a.target || '').toLowerCase().trim();
                for (const s of document.querySelectorAll('select')) { const o = [...s.options].find(o => (o.textContent || '').toLowerCase().trim().includes(t)); if (o) { s.value = o.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, msg: 'Selected option: ' + (a.target || '') }; } }
                return { ok: false, notfound: true, msg: 'Could not find: ' + (a.target || '') };
              }
              fireClick(el); return { ok: true, msg: 'Clicked: ' + (a.target || '') };
            }
            if (a.type === 'type') {
              // findEl may return a <label>/wrapper for a label-style target like
              // "Name / label *"; typeInto._resolve() climbs to the real <input>.
              const el = _local() || _byIdx(a.target) || findEl(a.target) || (visible(document.activeElement) ? document.activeElement : null);
              if (!el) return { ok: false, notfound: true, msg: 'No field to type into.' };
              if (el.tagName === 'SELECT') return setSelectByText(el, a.text) ? { ok: true, confirmed: true, msg: 'Selected ' + (a.text || '') + ' in ' + (a.target || 'dropdown') } : { ok: false, msg: 'Option not found in dropdown.' };
              var _tr = await typeInto(el, a.text || '');
              if (_tr && _tr.confirmed) return { ok: true, confirmed: true, msg: 'Typed "' + String(a.text || '').slice(0, 40) + '" into ' + (a.target || 'field') + ' — verified (' + _tr.method + ').' };
              if (_tr && _tr.picked) return { ok: true, confirmed: false, picked: true, msg: 'Selected "' + (_tr.pickedLabel || a.text || '') + '" from the suggestion list for ' + (a.target || 'field') + ' — please confirm it shows in the field.' };
              return { ok: false, stuck: true, reason: (_tr && _tr.reason) || 'not-stuck', msg: 'Tried to type into ' + (a.target || 'the field') + ' every way (clicked it, native set, simulated paste, key-by-key, and looked for a suggestion list)' + ((_tr && _tr.reason === 'readonly') ? ', but it is read-only/disabled' : (_tr && _tr.reason === 'no-field') ? ', but it is not an editable field' : '') + ' and the text did not stick. Please click the field and type ' + (a.text ? '"' + String(a.text).slice(0, 40) + '"' : 'the value') + ' yourself.' };
            }
            if (a.type === 'pastenote') {
              function isEd(el2) { if (!el2) return false; var tg = (el2.tagName || '').toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') return /^(text|search|email|url|tel|)$/i.test(el2.type || ''); return !!el2.isContentEditable; }
              var cs = [...document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')].filter(function (el2) { if (!visible(el2)) return false; var rr = el2.getBoundingClientRect(); return rr.width > 120 && rr.height > 36; });
              cs.sort(function (x, y) { var rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect(); return (ry.width * ry.height) - (rx.width * rx.height); });
              var pe = cs[0] || (isEd(document.activeElement) ? document.activeElement : null);
              if (!pe) return { ok: false, notfound: true, msg: 'No note field found to paste into.' };
              pe.scrollIntoView({ block: 'center' }); var _pr = await typeInto(pe, a.text || '');
              if (_pr && _pr.confirmed) return { ok: true, confirmed: true, msg: 'Pasted the note into the chart field (' + ((a.text || '').length) + ' chars) — verified.' };
              return { ok: false, stuck: true, msg: 'Tried to paste the note every way but could not confirm it landed — click the note field in the EMR, or use the panel Insert/Copy.' };
            }
            if (a.type === 'scroll') { window.scrollBy(0, a.dir === 'up' ? -600 : 600); return { ok: true, msg: 'Scrolled.' }; }
            if (a.type === 'read') { return { ok: true, msg: 'Read the screen.' }; }
            return { ok: false, msg: 'Unknown action.' };
          }
          });
          const res = (r && r.result) || {};
          if (res.ok || !res.notfound || i === tries - 1) break; // stop on success, hard error, or last try
          await new Promise(res2 => setTimeout(res2, 350)); // settle, then retry
        }
        sendResponse((r && r.result) || { ok: false, msg: 'No result.' });
      } catch (e) { sendResponse({ ok: false, msg: 'Action failed: ' + e.message }); }
    })();
    return true;
  }
  // Paste the drafted note into the note field of the CURRENT tab, searching EVERY
  // frame (top + iframes) so iframe-based EMRs like athenaOne/Epic work. v1.26: picks
  // the best frame by note-field SCORE (identity + size), confirms the paste landed,
  // and retries once if it didn't. Returns {ok, confirmed, into}. Never clicks Save/Sign.
  if (msg.type === 'mlsPasteHere') {
    (async () => {
      try {
        const note = String(msg.note || '');
        if (!note.trim()) return sendResponse({ ok: false, error: 'empty' });
        let tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = t && t.id; }
        if (!tabId) return sendResponse({ ok: false, reason: 'no-tab', error: 'No target tab for the paste — click into the EMR tab first.' }); /* v2.9.9 */
        let last = { ok: false };
        for (let attempt = 0; attempt < 2; attempt++) {
          let measure = [];
          try { measure = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, args: [note], func: mlsFieldScanner }); }
          catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId }, args: [note], func: mlsFieldScanner }); }
          let winnerFrame = null, bestScore = -1e12, winnerScan = null;
          (measure || []).forEach(function (m) { if (m && m.result && m.result.has && m.result.score > bestScore) { bestScore = m.result.score; winnerFrame = (m.frameId != null ? m.frameId : 0); winnerScan = m.result; } });
          if (winnerFrame === null) { last = { ok: false, notfound: true }; await new Promise(r => setTimeout(r, 450)); continue; }
          const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [winnerFrame] }, args: [note, null, winnerScan], func: mlsNotePaster });
          last = (r && r.result) || { ok: false };
          if (last.ok && last.confirmed) break;
          await new Promise(res2 => setTimeout(res2, 450));
        }
        if (last.ok) sendResponse({ ok: true, confirmed: !!last.confirmed, into: last.into, method: last.method, target: last.target, targetLabel: last.targetLabel, chosenSection: last.chosenSection, chosenLabel: last.chosenLabel, targetMatched: !!last.targetMatched, candidates: last.candidates });
        else sendResponse({ ok: false, reason: last.notfound ? 'no-note-field' : 'paste-failed', error: last.notfound ? 'No note field was found on this page — open the note area, then try again.' : 'Found a note field but the paste did not land — click into the note area, then try again.' }); /* v2.9.9: never a bare false (Codex E3) */
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  // VERIFIED WRITE (v1.27) — the patient-safety gate + smart multi-field routing +
  // reliable typing, tied together. Flow: identify the open Athena chart's patient and
  // the MLS active patient, MATCH them, and ONLY write on a confident match (unless the
  // doctor explicitly overrides after seeing the mismatch). Then segment the note and
  // route each part to its matching Athena field (insurance->insurance, ICD-10->diagnoses,
  // CPT->orders, op-note->Procedure Documentation, ...), confirming each. Never Save/Sign.
  if (msg.type === 'mlsVerifiedWrite') {
    (async () => {
      try {
        const note = String(msg.note || '');
        const force = !!msg.force;
        if (!note.trim()) return sendResponse({ ok: false, error: 'Nothing to insert yet.' });
        const isMls = (u) => /mlsscribe\.com/.test(u || '');
        // 1) Find the EMR (Athena) tab — prefer the tab the panel is on, else newest non-MLS tab.
        let emrTab = null;
        const su = (sender && sender.tab && sender.tab.url) || '';
        if (sender && sender.tab && /^https?:/.test(su) && !isMls(su)) emrTab = sender.tab;
        if (!emrTab) { const tabs = await chrome.tabs.query({});
          /* v1.90: unified verified picker (identity/login excluded, reachability-pinged);
             newest non-athena tab stays the generic-EMR fallback. Identity gate below unchanged. */
          emrTab = await mlsPickAthenaTab(tabs, { athenaOnly: true });
          if (!emrTab) { const c = tabs.filter(t => /^https?:/.test(t.url || '') && !isMls(t.url || '') && !/athena/i.test((t.url || '') + ' ' + (t.title || ''))); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); emrTab = c[0]; } }
        if (!emrTab) return sendResponse({ ok: false, error: 'No EMR/chart tab is open. Open the patient chart in your EMR, then try again.' });
        // 2) Read the open chart's patient identity (banner-preferred; v1.59).
        let chartId = { name: '', dob: '', mrn: '', score: 0 };
        for (let idTry = 0; idTry < 3; idTry++) {
          /* v1.71: junk-frame guard (same as the v1.67 read-path fix) - a negative-scored
             identity is a demoted messaging/letters/hidden frame phantom ("Monterosso,
             ROSEMARY"); never adopt it as the chart identity. No identity -> honest
             'uncertain' refusal instead of a phantom mismatch. */
          try { const idr = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, func: mlsReadChartIdentity }); const bb = mlsBestIdentityFrom(idr); if (bb && (bb.score || 0) >= 0) chartId = bb; }
          catch (e) { try { const [ir] = await chrome.scripting.executeScript({ target: { tabId: emrTab.id }, func: mlsReadChartIdentity }); if (ir && ir.result && ir.result.name && (ir.result.score || 0) >= 0) chartId = ir.result; } catch (e2) {} }
          /* v1.78: shadow-DOM banner fallback - the v26.3 clientsummary banner is
             invisible to the classic reader (the live Adam refusal); the shadow
             reader supplies a FULL (name+dob) identity or nothing. The HARD GATE
             below is unchanged - this only gives it something real to match.
             v1.86: also let a banner-grade shadow identity REPLACE a weak
             non-banner grep (lastfirst care-team phantoms). */
          if (!(chartId.name && (chartId.via === 'banner' || chartId.via === 'shadow-labels' || chartId.via === 'shadow-banner'))) { const sI = await mlsShadowIdentityTry(emrTab.id); if (sI) chartId = sI; }
          if (chartId.name && (chartId.via === 'banner' || chartId.via === 'shadow-labels' || chartId.via === 'shadow-banner' || chartId.dob)) break;
          /* v1.59: the chart may be sitting on the exam-prep/briefing view (no patient
             banner) - nudge it onto the real clinical chart (read-only) and re-read.
             No foregrounding (v1.56 no-yank rule); the HARD GATE below is unchanged. */
          try { await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, func: mlsEnsureClinicalChartFn }); } catch (e3) {}
          await mlsSleepW(2600);
        }
        // 3) Read the MLS active patient — v1.72: from the REQUESTING tab first (with
        // two app tabs open, the old newest-tab loop read the OTHER tab's patient /
        // page junk), then fall back to the newest signed-in mlsscribe.com tab.
        let mlsPt = { name: '', dob: '', mrn: '' };
        try { if (sender && sender.tab && /mlsscribe\.com/.test(sender.tab.url || '')) { const [mr0] = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, func: mlsReadActivePatient }); if (mr0 && mr0.result && (mr0.result.name || mr0.result.dob)) mlsPt = mr0.result; } } catch (e) {}
        if (!mlsPt.name && !mlsPt.dob) try { const mt = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] }); mt.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); for (const t of mt) { try { const [mr] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: mlsReadActivePatient }); if (mr && mr.result && (mr.result.name || mr.result.dob || mr.result.mrn)) { mlsPt = mr.result; break; } } catch (e) {} } } catch (e) {}
        // 4) Match (conservative — default refuse). Names appear only in the doctor's own browser.
        const match = mlsMatchPatients(mlsPt, chartId);
        const patient = { mlsName: mlsPt.name || '', mlsDob: mlsPt.dob || '', mlsMrn: mlsPt.mrn || '', athName: chartId.name || '', athDob: chartId.dob || '', athMrn: chartId.mrn || '' };
        // 5) HARD GATE.
        if (match.status !== 'match' && !force) {
          return sendResponse({ ok: false, blocked: true, patientStatus: match.status, match: match, patient: patient,
            reason: match.status === 'mismatch' ? 'Patient mismatch — refusing to write into this chart.' : 'Could not confidently verify the patient — refusing to write.' });
        }
        // 6) Segment + route each piece to its matching field, confirming each.
        const segs = mlsSegmentNote(note);
        const wrote = [];
        for (const seg of segs) {
          let last = { ok: false };
          for (let attempt = 0; attempt < 2; attempt++) {
            let measure = [];
            try { measure = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, allFrames: true }, args: [seg.text, seg.section], func: mlsFieldScanner }); }
            catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId: emrTab.id }, args: [seg.text, seg.section], func: mlsFieldScanner }); }
            let wf = null, bs = -1e12, wfScan = null;
            (measure || []).forEach(m => { if (m && m.result && m.result.has && m.result.score > bs) { bs = m.result.score; wf = (m.frameId != null ? m.frameId : 0); wfScan = m.result; } });
            if (wf === null) { last = { ok: false, notfound: true, targetLabel: (measure[0] && measure[0].result && measure[0].result.targetLabel) || seg.section }; await new Promise(r => setTimeout(r, 400)); continue; }
            const [r] = await chrome.scripting.executeScript({ target: { tabId: emrTab.id, frameIds: [wf] }, args: [seg.text, seg.section, wfScan], func: mlsNotePaster });
            last = (r && r.result) || { ok: false };
            if (last.ok && last.confirmed) break;
            await new Promise(r => setTimeout(r, 400));
          }
          wrote.push({ section: seg.section, targetLabel: last.targetLabel || seg.section, chosenLabel: last.chosenLabel || '', confirmed: !!last.confirmed, written: !!last.ok, notfound: !!last.notfound, method: last.method || '' });
        }
        sendResponse({ ok: true, forced: force, patientStatus: match.status, match: match, patient: patient, wrote: wrote });
      } catch (e) { sendResponse({ ok: false, error: 'Verified write failed: ' + e.message }); }
    })();
    return true;
  }

  if (msg.type === 'mlsAppCaptureRequest') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const tab = (await mlsPickAthenaTab(tabs, { athenaOnly: true })) || (function () { const c = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com|athena/i.test(t.url || '')); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); return c[0]; })(); /* v1.90 */
        if (!tab) return sendResponse({ error: 'No EMR tab is open. Open the patient in your EMR in another tab, then try again.' });
        let pageText = '';
        try {
          const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body && document.body.innerText || '').slice(0, 20000) });
          pageText = (r && r.result) || '';
        } catch (e) { return sendResponse({ error: 'Could not read the EMR tab (' + e.message + ').' }); }
        if (!pageText.trim()) return sendResponse({ error: 'The EMR tab had no readable text.' });
        const res = await callBackend('/api/assist/extract', { pageText, url: tab.url });
        sendResponse(Object.assign({ fromTab: tab.url }, res));
      } catch (e) { sendResponse({ error: 'Capture failed: ' + e.message }); }
    })();
    return true;
  }
  // Send a finished MLS note INTO the EMR: find the patient's note field (across
  // frames, so Athena's iframes work), then paste. v1.26: scores frames by note-field
  // identity+size, confirms the text landed, and retries once. Never clicks Save/Sign.
  if (msg.type === 'mlsAppPasteRequest') {
    (async () => {
      try {
        const note = String(msg.note || '');
        if (!note.trim()) return sendResponse({ error: 'Nothing to send.' });
        const tabs = await chrome.tabs.query({});
        /* v1.90: unified verified picker; newest non-athena tab stays the generic-EMR fallback. */
        const tab = (await mlsPickAthenaTab(tabs, { athenaOnly: true })) || (function () { const c = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com|athena/i.test((t.url || '') + ' ' + (t.title || ''))); c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); return c[0]; })();
        if (!tab) return sendResponse({ error: 'No EMR tab is open. Open the patient in your EMR in another tab, then try again.' });

        // v1.57: same identity gate mlsVerifiedWrite already uses -- read the open chart's
        // identity + the MLS active patient, and refuse (unless the doctor explicitly forces)
        // if they are not a confident match. Runs in the background; no tab switch yet.
        let chartId = { name: '', dob: '', mrn: '', score: 0 };
        for (let idTry = 0; idTry < 3; idTry++) {
          /* v1.71: junk-frame guard (see mlsVerifiedWrite) */
          try { const idr = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsReadChartIdentity }); const bb = mlsBestIdentityFrom(idr); if (bb && (bb.score || 0) >= 0) chartId = bb; } catch (e) {}
          /* v1.78/v1.86: shadow-DOM banner fallback (see mlsVerifiedWrite) - gate unchanged;
             a banner-grade shadow identity also replaces a weak non-banner grep. */
          if (!(chartId.name && (chartId.via === 'banner' || chartId.via === 'shadow-labels' || chartId.via === 'shadow-banner'))) { const sI = await mlsShadowIdentityTry(tab.id); if (sI) chartId = sI; }
          if (chartId.name && (chartId.via === 'banner' || chartId.via === 'shadow-labels' || chartId.via === 'shadow-banner' || chartId.dob)) break;
          /* v1.59: chart may be on the exam-prep/briefing view (no patient banner) -
             nudge it onto the real clinical chart (read-only) and re-read. No
             foregrounding (v1.56 no-yank rule); the identity gate below is unchanged. */
          try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsEnsureClinicalChartFn }); } catch (e3) {}
          await mlsSleepW(2600);
        }
        let mlsPt = { name: '', dob: '', mrn: '' };
        /* v1.72: requesting-tab first (see mlsVerifiedWrite) */
        try { if (sender && sender.tab && /mlsscribe\.com/.test(sender.tab.url || '')) { const [mr0] = await chrome.scripting.executeScript({ target: { tabId: sender.tab.id }, func: mlsReadActivePatient }); if (mr0 && mr0.result && (mr0.result.name || mr0.result.dob)) mlsPt = mr0.result; } } catch (e) {}
        if (!mlsPt.name && !mlsPt.dob) try { const mt = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] }); mt.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); for (const t of mt) { try { const [mr] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: mlsReadActivePatient }); if (mr && mr.result && (mr.result.name || mr.result.dob || mr.result.mrn)) { mlsPt = mr.result; break; } } catch (e) {} } } catch (e) {}
        const match = mlsMatchPatients(mlsPt, chartId);
        if (match.status !== 'match' && !msg.force) {
          return sendResponse({ error: match.status === 'mismatch' ? 'Patient mismatch — refusing to write into this chart.' : 'Could not confidently verify the patient — refusing to write.', blocked: true, patientStatus: match.status });
        }

        // v1.56: do NOT foreground the EMR tab until a note field is confirmed on it. Foregrounding
        // before the field check meant a failed send yanked the doctor to Athena and stranded them
        // there. Measure first (in the background); foreground only to paste; and return focus to MLS
        // if a field was found but the paste failed.
        var _focusMls = async function () { try { var _all = await chrome.tabs.query({}); var _app = _all.find(function (t) { try { return /(^|\.)mlsscribe\.com$/i.test(new URL(t.url || '').host); } catch (e) { return false; } }); if (_app) { await chrome.tabs.update(_app.id, { active: true }); if (_app.windowId != null) await chrome.windows.update(_app.windowId, { focused: true }); } } catch (e) {} };
        let last = { ok: false }, foundField = false, _fg = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          let measure = [];
          try { measure = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [note], func: mlsFieldScanner }); }
          catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [note], func: mlsFieldScanner }); }
          let winnerFrame = null, bestScore = -1e12, winnerScan = null;
          (measure || []).forEach(function (m) { if (m && m.result && m.result.has && m.result.score > bestScore) { bestScore = m.result.score; winnerFrame = (m.frameId != null ? m.frameId : 0); winnerScan = m.result; } });
          if (winnerFrame === null) { await new Promise(r => setTimeout(r, 450)); continue; }

          // v1.57: refuse outright if the winning field classifies as Orders -- never foreground,
          // never paste. Matches the mlsAppPushVisit autopilot's existing hard order-block intent.
          if (winnerScan && winnerScan.chosenSection === 'orders') {
            return sendResponse({ error: 'Order entry by MLS Assist is disabled for safety — athenaOne orders auto-execute. Enter any orders in Athena yourself.', ordersBlocked: true });
          }

          foundField = true;
          if (!_fg) { try { if (self.__mlsQp && self.__mlsQp.active) await self.__mlsQpRelease('write'); } catch (eQ) {} try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {} _fg = true; } /* v2.9.5: paste keeps foreground-for-write; strip released first */
          const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [winnerFrame] }, args: [note, null, winnerScan], func: mlsNotePaster });
          last = (r && r.result) || { ok: false };
          if (last.ok && last.confirmed) break;
          await new Promise(res2 => setTimeout(res2, 450));
        }
        if (last.ok && last.confirmed) sendResponse({ ok: true, confirmed: true, into: last.into, method: last.method, target: last.target, targetLabel: last.targetLabel, chosenSection: last.chosenSection, chosenLabel: last.chosenLabel, targetMatched: !!last.targetMatched, candidates: last.candidates });
        else if (last.ok) sendResponse({ ok: true, confirmed: false, into: last.into, method: last.method, target: last.target, targetLabel: last.targetLabel, chosenSection: last.chosenSection, chosenLabel: last.chosenLabel, targetMatched: !!last.targetMatched, candidates: last.candidates, warn: 'Wrote to the field but could not confirm the text landed — please check the EMR before signing.' });
        else if (foundField) { await _focusMls(); sendResponse({ error: 'Found a note field but could not paste. Click into the EMR note area, then try again.' }); }
        else sendResponse({ error: 'Could not find a note field on the EMR page. Open the patient and click into the note area, then try again.' });
      } catch (e) { sendResponse({ error: 'Send failed: ' + e.message }); }
    })();
    return true;
  }
  if (msg.type === 'mlsAssistCapture') {
    try { chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => sendResponse({ dataUrl: dataUrl || '' })); }
    catch (e) { sendResponse({ dataUrl: '' }); }
    return true;
  }
});


// Self-update notifier: badge the icon when a newer version is published.
async function mlsCheckBadge() {
  try {
    const cur = chrome.runtime.getManifest().version;
    const r = await fetch('https://mlsscribe.com/extension-version.json?t=' + Date.now());
    const d = await r.json();
    const cmp = (a, b) => { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x > y) return 1; if (x < y) return -1; } return 0; };
    if (d && d.version && cmp(d.version, cur) > 0) { chrome.action.setBadgeText({ text: '↑' }); chrome.action.setBadgeBackgroundColor({ color: '#1f7ae0' }); }
    else chrome.action.setBadgeText({ text: '' });
  } catch (e) {}
}
try { mlsCheckBadge(); } catch (e) {}
try { chrome.runtime.onStartup.addListener(mlsCheckBadge); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(mlsCheckBadge); } catch (e) {}


// ===========================================================================
// NIGHTLY BACKUP (browser-side). At the chosen local time, the extension finds
// your logged-in EMR tab, captures the open chart, then walks the patient-list
// links it can see and captures each chart — sending them to MLS (encrypted).
// REQUIRES: this computer ON, Chrome running, and the EMR tab still SIGNED IN.
// Best-effort by design: web-UI scraping can miss patients an API sync wouldn't.
// ===========================================================================
const BK_KEY = 'mlsBackup';
function getBackup() { return new Promise(r => chrome.storage.local.get([BK_KEY], c => r(Object.assign({ enabled: false, hour: 2, minute: 0, maxPatients: 250 }, c[BK_KEY] || {})))); }
function setBackup(v) { return new Promise(r => chrome.storage.local.set({ [BK_KEY]: v }, () => r(v))); }

async function scheduleBackupAlarm() {
  try { await chrome.alarms.clear('mlsNightlyBackup'); } catch (e) {}
  const b = await getBackup();
  if (!b.enabled) return;
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), (b.hour | 0), (b.minute | 0), 0, 0);
  if (next.getTime() <= now.getTime() + 5000) next.setDate(next.getDate() + 1);
  try { chrome.alarms.create('mlsNightlyBackup', { when: next.getTime(), periodInMinutes: 1440 }); } catch (e) {}
}
try { chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'mlsNightlyBackup') runNightlyBackup('schedule'); }); } catch (e) {}
try { chrome.runtime.onStartup.addListener(scheduleBackupAlarm); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(scheduleBackupAlarm); } catch (e) {}
scheduleBackupAlarm();

function findEmrTab(tabs) {
  const c = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com|\/\/github\.com|mail\.google\.com|console\.twilio|dashboard\.stripe/.test(t.url || ''));
  const ath = c.find(t => /athena/i.test((t.url || '') + ' ' + (t.title || '')));
  if (ath) return ath;
  c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return c[0] || null;
}
async function tabInnerText(tabId, max) {
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, args: [max || 20000], func: (m) => (document.body && document.body.innerText || '').slice(0, m) }); return (r && r.result) || ''; }
  catch (e) { return ''; }
}
function waitTabComplete(tabId, timeout) {
  return new Promise(res => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { chrome.tabs.onUpdated.removeListener(l); } catch (e) {} res(); } }, timeout || 15000);
    function l(id, info) { if (id === tabId && info.status === 'complete') { done = true; clearTimeout(to); try { chrome.tabs.onUpdated.removeListener(l); } catch (e) {} res(); } }
    chrome.tabs.onUpdated.addListener(l);
  });
}
async function collectRoster(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const out = [], seen = new Set();
      const re = /patient|chart|clinical|encounter|\bexam\b|chartid|enc=|patientid|deptid|pat_id/i;
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href || '', raw = a.getAttribute('href') || '', txt = (a.innerText || '').trim();
        if (!/^https?:/.test(href)) continue;
        if (!re.test(href) && !re.test(raw)) continue;
        if (seen.has(href)) continue; seen.add(href);
        out.push({ href, txt: txt.slice(0, 80) });
        if (out.length >= 400) break;
      }
      return out;
    }});
    return (r && r.result) || [];
  } catch (e) { return []; }
}
async function runNightlyBackup(trigger) {
  const started = Date.now();
  const cfg = await getBackup();
  const finish = async (res) => { await setBackup(Object.assign(await getBackup(), { lastRun: res.at, lastResult: res })); return res; };
  const tabs = await chrome.tabs.query({});
  const emr = findEmrTab(tabs);
  if (!emr) return finish({ ok: false, error: 'No EMR tab is open. Leave an Athena tab open and signed in.', at: new Date().toISOString() });
  const firstText = await tabInnerText(emr.id, 6000);
  if (firstText.length < 1500 && /\b(log\s?in|sign\s?in|password|username)\b/i.test(firstText)) {
    return finish({ ok: false, error: 'The EMR tab looks signed out — nothing was backed up. Stay signed in to Athena overnight.', at: new Date().toISOString() });
  }
  let captured = 0, patients = 0, errors = 0;
  // 1) capture the chart currently open
  if (firstText.trim()) {
    const c = await callBackend('/api/assist/extract', { pageText: firstText, url: emr.url });
    if (c && c.ok) { captured++; if (c.patient) patients++; } else if (c && c.error) { errors++; }
  }
  // 2) walk patient-list links and capture each
  const roster = await collectRoster(emr.id);
  const origUrl = emr.url;
  const cap = Math.min(roster.length, cfg.maxPatients || 250);
  for (let i = 0; i < cap; i++) {
    try {
      await chrome.tabs.update(emr.id, { url: roster[i].href });
      await waitTabComplete(emr.id, 15000);
      await new Promise(r => setTimeout(r, 1300));
      const txt = await tabInnerText(emr.id, 20000);
      if (!txt.trim()) continue;
      const c = await callBackend('/api/assist/extract', { pageText: txt, url: roster[i].href });
      if (c && c.ok) { captured++; if (c.patient) patients++; } else if (c && c.error) { errors++; }
    } catch (e) { errors++; }
    await new Promise(r => setTimeout(r, 400));
  }
  try { await chrome.tabs.update(emr.id, { url: origUrl }); } catch (e) {}
  return finish({ ok: true, captured, patients, errors, scanned: roster.length, trigger: trigger || 'manual', at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'mlsGetBackup') { getBackup().then(sendResponse); return true; }
  if (msg.type === 'mlsSetBackup') { setBackup(Object.assign({ enabled: false, hour: 2, minute: 0, maxPatients: 250 }, msg.value || {})).then(scheduleBackupAlarm).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === 'mlsRunBackupNow') { runNightlyBackup('manual').then(sendResponse); return true; }
});

/* === MLS Assist v1.34 — Copy-every-visit driver (APPEND-ONLY to background.js) ==
 * Self-contained. Adds its own chrome.runtime.onMessage handler for
 * mlsAppAllVisitsRequest; does not modify existing handlers. Genuinely walks the
 * OPEN patient's encounters/visits list in athenaOne (frame-aware, content-scored),
 * reads each encounter's real content, and returns {ok, identity, visits[], diag}.
 *
 * v1.34 changes vs v1.32:
 *  - Frame-aware enumeration: scores every frame's candidate row-groups by
 *    encounter-likeness (date + type-keyword + clickable + code signals), not just
 *    "has a date", and picks the single best frame+group.
 *  - Two read paths: (A) EXPANDED — if rows already carry real content, read them
 *    in place with NO clicks (safest, read-only); (B) CLICK — only for thin rows,
 *    open each row, read the detail pane (content-scored across frames). Falls back
 *    A->B per-row when an expanded row is too thin.
 *  - HONEST progress: emits a per-visit line ONLY after a visit with REAL content
 *    is actually read; total M is the real enumerated count. Never a pre-counted
 *    "reading N of M" with no data behind it.
 *  - HONEST failure: if no encounters list is recognized, returns ok:false with a
 *    clear message — never a fabricated count.
 *  - SELF-DIAGNOSTIC: always attaches result.diag, a fully REDACTED structural
 *    fingerprint of the chart DOM (frame hosts, candidate selectors, row tag/class
 *    signatures, counts, and date/CPT/ICD booleans) — NO patient text, names, DOBs,
 *    dates, or codes — so the selectors can be tuned to a real chart from one run.
 *    The redacted diag is also saved to chrome.storage.local 'mlsAthenaVisitsDiag'.
 *  - READ-ONLY: clicks ONLY dated encounter rows; never Save/Sign/Submit/etc.
 *    (excludeClickLabels guard). Selectors tunable via chrome.storage.local
 *    'mlsAthenaVisitsCfg'. */
(function () {
  'use strict';
  try { if (self.__mlsAllVisitsHandler) return; self.__mlsAllVisitsHandler = 1; } catch (e) {}

  var ORCH_DEFAULT = { maxVisits: 60, waitMs: 1400, initialWaitMs: 1000, visitTabWaitMs: 2200 };
  var EMR_RE = /(athenahealth|athenanet|athenaone|athena\.io|\.px\.athena)/i;

  /* CANONICAL self-contained injected driver. Passed to chrome.scripting
   * .executeScript({func: mlsVisitsDriverFn}) — must reference no outer scope and
   * no eval (athenaOne CSP-safe). Read-only: only clicks dated encounter rows,
   * never Save/Sign/Submit. Embedded verbatim in background.js. */
  function mlsVisitsDriverFn(op, cfg, idx) {
    cfg = cfg || {};
    var DEFAULT = {
      rowSelectors: [
        'li.encounter-list-item',
        'tr', '[role="row"]', 'li',
        '.encounter', '.encounter-row', '.encounterrow', '[data-encounter-id]',
        '[data-encounterid]', '[id*="encounter" i]', '[class*="encounter" i]',
        '.visit', '.visit-row', '[class*="visit" i]', '[class*="timeline" i] li',
        '.athena-encounter', '.chart-encounter', '.documentencounter'
      ],
      detailSelectors: [
        '.encounter-detail', '.encounterdetail',
        '.documentation[data-encounter-id]', '.chart-detail[data-encounter-id]', '.notesection',
        '[class*="encounterbody" i]', '[class*="notebody" i]',
        '[id*="encounter-detail" i]'
      ],
      typeKeywords: [
        'office visit', 'encounter', 'telehealth', 'follow', 'follow-up', 'f/u',
        'new patient', 'established', 'consult', 'procedure', 'injection', 'block',
        'ablation', 'epidural', 'facet', 'esi', 'rfa', 'evaluation', 'eval',
        'visit', 'exam', 'phone', 'lab', 'imaging', 'mri', 'x-ray', 'progress note',
        'preop', 'postop', 'pre-op', 'post-op', 'surgery'
      ],
      excludeClickLabels: [
        'save', 'sign', 'finalize', 'post', 'bill', 'submit claim', 'submit',
        'delete', 'lock', 'addend', 'amend', 'discard', 'cancel appointment',
        'close encounter', 'check out', 'checkout'
      ],
      maxVisits: 60,
      minRealLen: 60,
      visitTabWaitMs: 2200
    };
    for (var k in DEFAULT) { if (cfg[k] == null) cfg[k] = DEFAULT[k]; }
    var DATE_RE = /(?:^|[^\d])(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})(?!\d)/;
    var CPT_RE = /\b\d{5}\b/g, ICD_RE = /\b[A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?\b/g;
    function txt(el) { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim(); }
    function low(s) { return String(s || '').toLowerCase(); }
    function excluded(s) { s = low(s); for (var i = 0; i < cfg.excludeClickLabels.length; i++) { if (s.indexOf(cfg.excludeClickLabels[i]) >= 0) return true; } return false; }
    function hasType(s) { s = low(s); for (var i = 0; i < cfg.typeKeywords.length; i++) { if (s.indexOf(cfg.typeKeywords[i]) >= 0) return true; } return false; }
    function hasDate(s) { return DATE_RE.test(String(s || '')); }
    function hasCpt(s) { CPT_RE.lastIndex = 0; return CPT_RE.test(String(s || '')); }
    function hasIcd(s) { ICD_RE.lastIndex = 0; return ICD_RE.test(String(s || '')); }
    function codes(s, re) { var out = [], m; re.lastIndex = 0; while ((m = re.exec(String(s || '')))) { var c = m[0].toUpperCase(); if (out.indexOf(c) < 0) out.push(c); if (out.length > 40) break; } return out; }
    function clickable(n) {
      try {
        if (n.matches && n.matches('a[href],button,[role="link"],[role="button"],[onclick],.clickable,.accordion-trigger')) return true;
        return !!(n.querySelector && n.querySelector('a[href],button,[role="link"],[role="button"],[onclick],td a, td'));
      } catch (e) { return false; }
    }

    // Score a single candidate row's text for "looks like an encounter row".
    function rowScore(t) {
      if (!t) return 0;
      var s = 0;
      if (hasDate(t)) s += 3;
      if (hasType(t)) s += 2;
      if (hasCpt(t)) s += 1;
      if (hasIcd(t)) s += 1;
      if (t.length >= 12 && t.length <= 400) s += 1;
      return s;
    }

    // Build candidate groups: for each selector, group matching nodes by parent,
    // keep groups whose members look like dated encounter rows; return scored groups.
    function candidateGroups() {
      var groups = [];
      for (var s = 0; s < cfg.rowSelectors.length; s++) {
        var nodes;
        try { nodes = Array.prototype.slice.call(document.querySelectorAll(cfg.rowSelectors[s])); } catch (e) { continue; }
        if (!nodes.length) continue;
        var byParent = new Map();
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i], t = txt(n);
          if (t.length < 8 || t.length > 1200) continue;
          if (!hasDate(t)) continue;
          if (excluded(t)) continue;
          var par = n.parentElement || n;
          if (!byParent.has(par)) byParent.set(par, []);
          byParent.get(par).push(n);
        }
        byParent.forEach(function (rows, par) {
          if (rows.length < 2) return; // a list has multiple dated rows
          var sc = 0, withType = 0, withCode = 0, withClick = 0, strongRows = 0, lens = [], uniqueDates = {};
          for (var j = 0; j < rows.length; j++) {
            var rt = txt(rows[j]);
            sc += rowScore(rt);
            if (hasType(rt)) withType++;
            if (hasCpt(rt) || hasIcd(rt)) withCode++;
            if (clickable(rows[j])) withClick++;
            try { if (rows[j].matches && rows[j].matches('li.encounter-list-item,.encounter-row,[data-encounter-id],[data-encounterid],.previous-visit,.patient-case')) strongRows++; } catch (e0) {}
            var dm = rt.match(DATE_RE); if (dm && dm[1]) uniqueDates[dm[1]] = 1;
            lens.push(rt.length);
          }
          lens.sort(function (a, b) { return a - b; });
          var median = lens[Math.floor(lens.length / 2)] || 0;
          /* Repeated structural descendants can all inherit the same date and
             masquerade as dozens of visits. Reward unique dated rows and Athena's
             real encounter-row classes; penalize repeated dates aggressively. */
          var uniqueDateCount = Object.keys(uniqueDates).length;
          var duplicateDates = Math.max(0, rows.length - uniqueDateCount);
          var groupScore = sc + uniqueDateCount * 6 + withType + Math.min(withClick, rows.length) + strongRows * 4 - duplicateDates * 7;
          groups.push({
            selector: cfg.rowSelectors[s], parent: par, rows: rows,
            count: rows.length, score: groupScore, withType: withType,
            withCode: withCode, withClick: withClick, strongRows: strongRows,
            uniqueDates: uniqueDateCount, median: median
          });
        });
      }
      groups.sort(function (a, b) { return b.score - a.score; });
      return groups;
    }

    function bestGroup() {
      var g = candidateGroups();
      /* Current Athena briefing charts expose a stable, patient-scoped visit
         contract. When present, it is authoritative; generic class/row scans
         are only fallbacks for other layouts and may contain dated descendants. */
      for (var i0 = 0; i0 < g.length; i0++) {
        if (g[i0].selector === 'li.encounter-list-item' && g[i0].strongRows === g[i0].count) return g[i0];
      }
      return g.length ? g[0] : null;
    }

    // ---- redacted structural fingerprint (NO PHI) ----------------------------
    function sigOf(node) {
      var classes = [];
      try { classes = (node.className && node.className.baseVal != null ? node.className.baseVal : (node.className || '')).toString().split(/\s+/).filter(Boolean).slice(0, 6); } catch (e) {}
      var childTags = {};
      try {
        var ch = node.children || [];
        for (var i = 0; i < ch.length && i < 30; i++) { var tg = (ch[i].tagName || '').toLowerCase(); if (tg) childTags[tg] = (childTags[tg] || 0) + 1; }
      } catch (e) {}
      var attrKeys = [];
      try { for (var a = 0; a < node.attributes.length && a < 12; a++) { var an = node.attributes[a].name; if (an !== 'class' && an !== 'style') attrKeys.push(an); } } catch (e) {}
      var t = txt(node);
      return {
        tag: (node.tagName || '').toLowerCase(),
        classes: classes,            // CSS class NAMES only (structural, no PHI)
        childTags: childTags,        // counts of child element tags
        attrKeys: attrKeys,          // attribute NAMES only (no values)
        textLen: t.length,           // length only (no text)
        hasDate: hasDate(t), hasCpt: hasCpt(t), hasIcd: hasIcd(t), hasType: hasType(t)
      };
    }
    function diagnose() {
      var host = '';
      try { host = location.hostname || ''; } catch (e) {}
      var groups = candidateGroups();
      var cands = groups.slice(0, 4).map(function (g) {
        return {
          selector: g.selector, count: g.count, score: g.score,
          withType: g.withType, withCode: g.withCode, withClick: g.withClick,
          medianLen: g.median, rowSig: g.rows[0] ? sigOf(g.rows[0]) : null
        };
      });
      // generic counts to see what's present even when no group qualified
      function cnt(sel) { try { return document.querySelectorAll(sel).length; } catch (e) { return -1; } }
      return {
        host: host,
        frameDepth: (function () { try { return window.top === window ? 0 : 1; } catch (e) { return 1; } })(),
        counts: { tr: cnt('tr'), role_row: cnt('[role="row"]'), li: cnt('li'), tables: cnt('table'), iframes: cnt('iframe'), encounterish: cnt('[class*="encounter" i],[id*="encounter" i]'), visitish: cnt('[class*="visit" i]') },
        groupCount: groups.length, candidates: cands
      };
    }

    // ---- operations ----------------------------------------------------------
    if (op === 'openVisits') {
      /* The briefing chart opens on whichever chart tab was last active. Drive
         the icon-identified Visits tab explicitly before enumerating; this is a
         read-only chart navigation and avoids mistaking Problems/Documents rows
         for encounters. */
      var icons = [];
      try { icons = Array.prototype.slice.call(document.querySelectorAll('.nimbus-icon-visits.chart-tab-icon,.nimbus-icon-visits')); } catch (e0) {}
      var tab = null;
      for (var oi = 0; oi < icons.length; oi++) {
        try {
          var cand = icons[oi].closest && icons[oi].closest('li.chart-tabs__list-item');
          if (!cand) continue;
          var rr = cand.getBoundingClientRect();
          if (rr.width > 1 && rr.height > 1) { tab = cand; break; }
          if (!tab) tab = cand;
        } catch (e1) {}
      }
      if (!tab) return { ok: false, reason: 'visits-tab-not-found' };
      if (/(^|\s)active(\s|$)/.test(String(tab.className || ''))) return { ok: true, active: true };
      try { tab.click(); return { ok: true, clicked: true }; } catch (e2) { return { ok: false, reason: 'visits-tab-click-failed' }; }
    }
    if (op === 'identity') {
      var body = txt(document.body), dob = '', name = '';
      var dm = body.match(/\b(?:DOB|D\.O\.B\.|Date of Birth|Born)\D{0,8}(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i); if (dm) dob = dm[1];
      var nm = body.match(/\bPatient\D{0,4}([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/); if (nm) name = nm[1];
      if (!name) { var h = document.querySelector('h1,h2,[data-patient-name],.patient-name,[class*="patientname" i]'); if (h) name = txt(h).slice(0, 60); }
      return { name: name, dob: dob };
    }
    if (op === 'diagnose') { return diagnose(); }
    if (op === 'enumerate') {
      var g = bestGroup();
      if (!g) return { ok: false, count: 0, score: 0 };
      var rows = g.rows.map(function (n, i) {
        var t = txt(n); var d = t.match(DATE_RE);
        return {
          index: i, date: d ? d[1] : '',
          type: t.replace(DATE_RE, '').slice(0, 80).trim(),
          rowText: t, textLen: t.length, hasCode: (hasCpt(t) || hasIcd(t)),
          // 'rich' = this row likely already contains the visit content
          rich: (t.length >= cfg.minRealLen && (hasCpt(t) || hasIcd(t) || t.length >= 220))
        };
      });
      var richCount = rows.filter(function (r) { return r.rich; }).length;
      return {
        ok: true, selector: g.selector, count: g.count, score: g.score,
        median: g.median, withClick: g.withClick, strongRows: g.strongRows || 0,
        uniqueDates: g.uniqueDates || 0, richCount: richCount, rows: rows
      };
    }
    if (op === 'readExpanded') {
      // Build visits directly from the chosen group's rows (no clicks).
      var g2 = bestGroup(); if (!g2) return { ok: false, visits: [] };
      var visits = g2.rows.map(function (n) {
        var raw = txt(n); var d = raw.match(DATE_RE);
        return {
          date: d ? d[1] : '',
          type: raw.replace(DATE_RE, '').slice(0, 80).trim(),
          raw: raw, cpt: codes(raw, CPT_RE), icd10: codes(raw, ICD_RE),
          source: 'athena-copy'
        };
      });
      return { ok: true, visits: visits };
    }
    if (op === 'click') {
      var g3 = bestGroup(); if (!g3) return { clicked: false, reason: 'no-group' };
      var row = g3.rows[idx]; if (!row) return { clicked: false, reason: 'no-row', count: g3.rows.length };
      if (excluded(txt(row))) return { clicked: false, reason: 'excluded' };
      var target = row;
      try { var c = row.querySelector && row.querySelector('a[href],button,[role="link"],[role="button"],td a,td'); if (c && !excluded(txt(c))) target = c; } catch (e) {}
      try { target.click(); } catch (e2) { return { clicked: false, reason: 'click-failed', error: String(e2) }; }
      return { clicked: true, len: txt(row).length };
    }
    if (op === 'detail') {
      // pick the container that best looks like a clinical note (content-scored)
      var best = null, bestScore = -1;
      /* Athena's Visits chart expands the selected encounter in-place. Reading
         that accordion row is both more precise and safer than selecting a page-
         sized generic container (which duplicated the whole chart for every
         dated row). */
      try {
        var opened = Array.prototype.slice.call(document.querySelectorAll('li.encounter-list-item.accordion-open,[class*="encounter" i].accordion-open'));
        for (var o2 = 0; o2 < opened.length; o2++) {
          var ot = txt(opened[o2]);
          if (ot.length >= cfg.minRealLen && ot.length > bestScore) { bestScore = ot.length; best = opened[o2]; }
        }
      } catch (e0) {}
      var sels = cfg.detailSelectors;
      for (var s2 = 0; !best && s2 < sels.length; s2++) {
        var nodes2; try { nodes2 = Array.prototype.slice.call(document.querySelectorAll(sels[s2])); } catch (e) { continue; }
        for (var j2 = 0; j2 < nodes2.length; j2++) {
          var t2 = txt(nodes2[j2]); if (t2.length < cfg.minRealLen) continue;
          var sc2 = Math.min(t2.length, 4000) / 1000;
          if (hasCpt(t2)) sc2 += 2; if (hasIcd(t2)) sc2 += 2; if (hasType(t2)) sc2 += 1; if (hasDate(t2)) sc2 += 1;
          if (sc2 > bestScore) { bestScore = sc2; best = nodes2[j2]; }
        }
      }
      /* Fail honestly when no encounter-scoped detail exists. A whole-document
         fallback fabricates duplicates and must never be treated as a visit. */
      if (!best) return { date: '', type: '', raw: '', cpt: [], icd10: [], len: 0, reason: 'no-encounter-detail' };
      var raw2 = txt(best); var d3 = raw2.match(DATE_RE);
      return { date: d3 ? d3[1] : '', type: '', raw: raw2, cpt: codes(raw2, CPT_RE), icd10: codes(raw2, ICD_RE), len: raw2.length };
    }
    return null;
  }

  // ---- orchestrator (background scope; chrome.* + closures OK) ---------------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function emit(tabId, message, n, total) { try { if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'mlsAppVisitsProgress', message: message, n: n, total: total }); } catch (e) {} }

  function pickEmrTab() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({}, function (tabs) {
          var cand = (tabs || []).filter(function (t) { return t.url && EMR_RE.test(t.url); });
          cand.sort(function (a, b) { return (b.active ? 1 : 0) - (a.active ? 1 : 0) || (b.id - a.id); });
          /* v1.90: unified verified picker; the old active-first order stays the fallback */
          try {
            if (typeof mlsPickAthenaTab === 'function') { Promise.resolve(mlsPickAthenaTab(tabs, { athenaOnly: true })).then(function (t) { resolve(t || cand[0] || null); }, function () { resolve(cand[0] || null); }); return; }
          } catch (e2) {}
          resolve(cand[0] || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function exec(tabId, frameIds, args) {
    var target = { tabId: tabId }; if (frameIds) target.frameIds = frameIds; else target.allFrames = true;
    if (args && args[0] === 'identity') {
      /* Reuse the production chart identity readers instead of the old generic
         body regex in mlsVisitsDriverFn. Run both plain-DOM and open-shadow-root
         variants; frame IDs remain attached so enumeration can bind identity to
         its exact briefing frame. */
      return Promise.all([
        chrome.scripting.executeScript({ target: target, func: mlsReadChartIdentity }).catch(function () { return []; }),
        chrome.scripting.executeScript({ target: target, func: mlsReadChartIdentityShadow }).catch(function () { return []; })
      ]).then(function (all) { return (all[0] || []).concat(all[1] || []); });
    }
    return chrome.scripting.executeScript({ target: target, func: mlsVisitsDriverFn, args: args }).catch(function () { return []; });
  }
  function bestResult(results, scoreFn) {
    var best = null, bestScore = -1, bestFrame = 0;
    (results || []).forEach(function (r) { if (!r || r.result == null) return; var sc = scoreFn(r.result); if (sc > bestScore) { bestScore = sc; best = r.result; bestFrame = r.frameId; } });
    return { result: best, frameId: bestFrame, score: bestScore };
  }
  function realVisit(v, minLen) {
    if (!v) return false;
    var raw = String(v.raw || '').trim();
    var hasCode = (Array.isArray(v.cpt) && v.cpt.length) || (Array.isArray(v.icd10) && v.icd10.length);
    return (raw.length >= (minLen || 60)) || hasCode;
  }
  function saveDiag(diag) {
    try { chrome.storage.local.set({ mlsAthenaVisitsDiag: { at: Date.now(), diag: diag } }); } catch (e) {}
    // Redacted (no-PHI) structural map — safe to log so it can be copied for selector tuning.
    try { console.log('[MLS Assist v1.34 diag — redacted, no PHI]', JSON.stringify(diag)); } catch (e) {}
  }

  function runAllVisits(appTabId, hint, cfg) {
    var identity = {}, identityResults = null, listFrame = 0, enumRes = null, diag = null;
    var minLen = cfg.minRealLen || 60;
    return pickEmrTab().then(function (emr) {
      if (!emr) return { ok: false, error: 'No signed-in athenaOne tab found. Open athenaOne with the patient chart, then retry.' };
      var emrId = emr.id;
      // === v1.54 THROTTLING FIX ===
      // Bring the athenaOne tab to the FOREGROUND before the read. A background
      // (unfocused) tab is throttled by Chrome: its rendering pauses and DOM
      // reads/layout run ~9x slower, so the per-encounter walk of the all-visits
      // reader overruns its timeout ("Couldn't read your visits…") — this is the
      // real cause of the reader failing during normal use (the MLS app tab is
      // focused, so athenaOne is a throttled background tab). Verified live:
      // foreground athenaOne read 38 visits; the same read timed out in the
      // background. We restore focus to the MLS tab when the read finishes.
      try { self.__mlsQpEnsure && self.__mlsQpEnsure(emr, appTabId); } catch (e) {} /* v2.9.5 quiet pull: work strip, never focused; settles during initialWaitMs; no focus debt */
      emit(appTabId, '🔍 Reading visits from athenaOne… (read-only)');
      return exec(emrId, null, ['openVisits', cfg])
        .then(function () { return sleep(cfg.visitTabWaitMs || 2200); })
        .then(function () { return sleep(cfg.initialWaitMs); })
        // identity
        .then(function () { return exec(emrId, null, ['identity', cfg]); })
        .then(function (idRes) { identityResults = idRes || []; identity = bestResult(idRes, function (r) { return (r && ((r.name ? 2 : 0) + (r.dob ? 1 : 0))) || 0; }).result || {}; })
        // redacted diagnostic (always, across frames; pick the richest frame's diag)
        .then(function () { return exec(emrId, null, ['diagnose', cfg]); })
        .then(function (dgRes) { var b = bestResult(dgRes, function (r) { return (r && r.groupCount) || 0; }); diag = b.result || null; saveDiag(diag); })
        // enumerate: pick the best frame+group
        .then(function () { return exec(emrId, null, ['enumerate', cfg]); })
        .then(function (enR) {
          /* Prefer Athena's explicit briefing-chart encounter contract across
             frames too. Messaging/status frames can contain many dated-looking
             <li> nodes and must never outscore the patient-scoped visit list. */
          var b = bestResult(enR, function (r) {
            if (!(r && r.ok)) return 0;
            return (r.selector === 'li.encounter-list-item' ? 100000 : 0) + (r.score || 0);
          });
          enumRes = b.result; listFrame = b.frameId;
          /* Bind identity to the SAME patient-scoped briefing frame that won
             encounter enumeration. Global/status/messaging frames may expose
             unrelated name/date text and must never supply the safety identity. */
          try {
            var sameFrameIds = (identityResults || []).filter(function (oneId) {
              return oneId && oneId.frameId === listFrame && oneId.result && (oneId.result.name || oneId.result.dob);
            });
            var exactIdentity = bestResult(sameFrameIds, function (r) {
              if (!r) return 0;
              return (r.score || 0) + (r.via === 'banner' ? 20 : 0) + (/shadow/i.test(String(r.via || '')) ? 15 : 0);
            }).result;
            if (exactIdentity) identity = exactIdentity;
          } catch (eId) {}
          if (!enumRes || !enumRes.ok || !enumRes.count) {
            return { ok: false, identity: identity, visits: [], diag: diag,
              error: 'No encounters/visits list recognized on this chart. Open the patient’s Encounters/Visits tab (or chart timeline), then retry. (A redacted DOM map was captured to tune the selectors — nothing was saved.)' };
          }
          var rows = enumRes.rows || [];
          var total = Math.min(rows.length, cfg.maxVisits);
          var richFrac = total ? (enumRes.richCount / total) : 0;
          // Path A: rows already carry real content -> read in place, no clicks.
          if (richFrac >= 0.6) {
            return exec(emrId, [listFrame], ['readExpanded', cfg]).then(function (rxR) {
              var rx = bestResult(rxR, function (r) { return (r && r.visits) ? r.visits.length : 0; }).result || { visits: [] };
              var visits = [];
              (rx.visits || []).slice(0, total).forEach(function (v) {
                if (realVisit(v, minLen)) { visits.push(v); emit(appTabId, 'Read visit ' + (v.date || (visits.length)) + ' (' + visits.length + ' of ' + total + ')…', visits.length, total); }
              });
              if (!visits.length) {
                return { ok: false, identity: identity, visits: [], diag: diag,
                  error: 'Found a visit list but none of the rows contained readable visit content. (Redacted DOM map captured; nothing saved.)' };
              }
              emit(appTabId, 'Read ' + visits.length + ' visit(s).', visits.length, total);
              return { ok: true, identity: identity, visits: visits, diag: diag, strategy: 'expanded', found: rows.length };
            });
          }
          // Path B: thin rows -> open each and read the detail pane.
          var visitsB = [];
          var i = 0;
          function step() {
            if (i >= total) {
              if (!visitsB.length) {
                return { ok: false, identity: identity, visits: [], diag: diag,
                  error: 'Opened the encounters but could not read readable content from any. The detail selectors need a tuning pass. (Redacted DOM map captured; nothing saved.)' };
              }
              emit(appTabId, 'Read ' + visitsB.length + ' visit(s).', visitsB.length, total);
              return { ok: true, identity: identity, visits: visitsB, diag: diag, strategy: 'click', found: rows.length };
            }
            var snap = rows[i] || {};
            return exec(emrId, [listFrame], ['click', cfg, i])
              .then(function () { return sleep(cfg.waitMs); })
              .then(function () { return exec(emrId, null, ['detail', cfg]); })
              .then(function (dR) {
                var d = bestResult(dR, function (r) { return (r && r.raw) ? r.raw.length : 0; }).result || {};
                var visit = {
                  date: snap.date || d.date || '',
                  type: snap.type || d.type || '',
                  raw: (d.raw && d.raw.length > (snap.textLen || 0)) ? d.raw : (d.raw || snap.rowText || ''),
                  cpt: d.cpt || [], icd10: d.icd10 || [],
                  source: 'athena-copy'
                };
                /* An explicit Athena encounter row is authoritative even when a
                   patient-case entry has only a short label/date and no long
                   note body. Preserve it as a minimal dated visit; generic
                   fallback rows still require the normal clinical-text length. */
                var acceptMin = (enumRes && enumRes.selector === 'li.encounter-list-item' && visit.date) ? Math.min(minLen, 20) : minLen;
                if (realVisit(visit, acceptMin)) {
                  visitsB.push(visit);
                  emit(appTabId, 'Read visit ' + (visit.date || visitsB.length) + ' (' + visitsB.length + ' of ' + total + ')…', visitsB.length, total);
                }
                i++;
                return step();
              });
          }
          return step();
        });
    }).catch(function (e) { return { ok: false, identity: identity, diag: diag, error: String((e && e.message) || e) }; })
      // v1.54: restore focus to the MLS tab after the read (we brought athenaOne to the foreground above to avoid background-tab throttling).
      // v1.74: also focus the window and settle the guardian debt (straggler sweep armed).
      .then(async function (res) {
        res = res || {};
        res.readerVersion = '2.9.15-visits-r1';
        if (enumRes) {
          res.selected = { selector: enumRes.selector || '', count: enumRes.count || 0,
            uniqueDates: enumRes.uniqueDates || 0, strongRows: enumRes.strongRows || 0 };
        }
        try { var FGv = self.__mlsFg || {}; if (FGv.debt && self.__mlsFgFocusApp) await self.__mlsFgFocusApp(); } catch (e) {}
        try { self.__mlsFgEnd && self.__mlsFgEnd(); } catch (e) {}
        return res;
      }); /* v2.9.5: only return focus if a legacy foreground actually took it (quiet pulls owe nothing) */
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'mlsAppAllVisitsRequest') return; // not ours; let other listeners handle
    var appTabId = sender && sender.tab && sender.tab.id;
    try {
      chrome.storage.local.get(['mlsAthenaVisitsCfg'], function (st) {
        var cfg = {}; var stored = (st && st.mlsAthenaVisitsCfg) || {};
        for (var k in ORCH_DEFAULT) cfg[k] = (stored[k] != null ? stored[k] : ORCH_DEFAULT[k]);
        for (var k2 in stored) if (cfg[k2] == null) cfg[k2] = stored[k2];
        runAllVisits(appTabId, msg.hint || {}, cfg).then(sendResponse, function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
      });
    } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    return true; // async response
  });

  // --- v1.40: publish the PROVEN read-all-visits engine so the Seamless overlay
  //     router can reuse it directly (the overlay was previously bound to a
  //     never-implemented name and so could never read the chart). Same cfg load,
  //     same engine, same honest failures - additive, no behavior change here. ---
  try {
    self.__mlsOverlayReadVisits = function (appTabId, hint) {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(['mlsAthenaVisitsCfg'], function (st) {
            var cfg = {}; var stored = (st && st.mlsAthenaVisitsCfg) || {};
            for (var k in ORCH_DEFAULT) cfg[k] = (stored[k] != null ? stored[k] : ORCH_DEFAULT[k]);
            for (var k2 in stored) if (cfg[k2] == null) cfg[k2] = stored[k2];
            runAllVisits(appTabId != null ? appTabId : null, hint || {}, cfg)
              .then(resolve, function (e) { resolve({ ok: false, error: String((e && e.message) || e) }); });
          });
        } catch (e) { resolve({ ok: false, error: String((e && e.message) || e) }); }
      });
    };
  } catch (e) {}
})();


/* === MLS Assist v1.36 — panel pull-to-app + read-only search-and-navigate driver (APPEND-ONLY to background.js) ===
 * One additional chrome.runtime.onMessage listener (Chrome supports multiple).
 * It returns true ONLY for its own message types and otherwise returns nothing,
 * so existing listeners are unaffected. NEVER clicks Save/Sign/finalize on a
 * chart (read-only navigation: typing in the search bar + opening a chart only).
 *
 *  - mlsAssistPullToApp: the panel "Pull from chart" button asks us to run the
 *    proven in-app Athena pull. We focus the MLS (mlsscribe.com) tab and trigger
 *    its real "Pull from Athena" flow (frame-aware v1.34 reader) so the open
 *    chart's patient + all visits land in MLS with the app's status/verify.
 *
 *  - mlsAppSearchOpenRequest: drive athenaOne's PATIENT SEARCH bar — type the
 *    "Last, First" name, run the search, find the matching result, open the
 *    chart. Content-scored selectors with fallbacks (robust without a live tune),
 *    plus a PHI-safe redacted structural diag for one-time tuning. */
(function () {
  'use strict';
  try { if (self.__mlsV136Wired) return; self.__mlsV136Wired = 1; } catch (e) {}

  // local EMR-tab picker (does not rely on the existing mlsPickEmrTab being in scope)
  /* v1.65: score athena candidates like the (working) chart-read/go-home pickers.
     The old "active-or-first" pick chose a SECOND athenahealth tab (a www portal/
     login page full of demdex trackers, zero schedule rows) while go-home/read drove
     the real athenanet tab - live-proven cause of the v1.64 'open-failed'. */
  function mlsScoreAthTab(t) {
    var u = (t.url || '').toLowerCase(); var s = 0;
    if (/athenanet\.athenahealth\.com/.test(u)) s += 100;
    if (/globalframeset|\/ax\/|dashboard|schedul|calendar|frontoffice/.test(u)) s += 40;
    if (/aws\.caas|\/login|sign-?in|\/auth|\/oauth|accounts\.|\bwww\.athenahealth\.com\b|landing|portal|marketing/.test(u)) s -= 200;
    if (t.active) s += 5;
    return s;
  }
  function pickEmrTab(all) {
    try {
      var http = all.filter(function (t) { return /^https?:\/\//.test(t.url || ''); });
      var known = http.filter(function (t) { return /athenahealth\.com|athenanet/i.test(t.url || ''); });
      if (known.length) { known.sort(function (a, b) { return (mlsScoreAthTab(b) - mlsScoreAthTab(a)) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)); }); return known[0]; }
      var emrish = http.filter(function (t) { return /emr|ehr|chart|clinical|epic|cerner|practice/i.test((t.url || '') + ' ' + (t.title || '')); });
      if (emrish.length) return emrish[0];
      var nonMls = http.filter(function (t) { return !/mlsscribe\.com|github\.com|google\.com\/search/i.test(t.url || ''); });
      return nonMls.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); })[0] || null;
    } catch (e) { return null; }
  }

  function findAppTab(all) {
    return all.find(function (t) { return /^https?:\/\/(www\.)?mlsscribe\.com\//.test(t.url || ''); }) || null;
  }

  // --- the page-side driver (self-contained; serialized to the tab) ---
  async function mlsSearchOpenDriverFn(name, phase) {
    try {
      /* v1.84: never scan/type on the findpatient RESULTS page - its rows are
         javascript: links this (isolated) world cannot navigate; clicking them
         reports a phantom "open" while nothing happens. The findpatient route
         owns that page. Other frames of the tab scan normally. */
      try { if (/findpatient\.esp/i.test(String(location.pathname || ''))) return { phase: phase, opened: false, filled: false, candidates: 0, diag: { frame: 'findpatient-excluded', topScore: -1 } }; } catch (e0) {}
      function vis(el) { try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }
      /* v1.90 (same normalization as the findpatient route): strip "(Bob)" nicknames
         for the SEARCH string only; drop generational suffixes after a comma
         (", Jr" is a suffix, not a first name). Apostrophes/hyphens kept. */
      var SUFX = /^(jr|sr|ii|iii|iv|v|esq|junior|senior)\.?$/i;
      var cleanN = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      var parts = cleanN.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      while (parts.length > 1 && SUFX.test(parts[parts.length - 1])) parts.pop();
      var lname = (parts[0] || '').toLowerCase();
      var fname = parts.slice(1).join(' ').trim().toLowerCase();
      /* v1.62: callers pass either "Last, First" OR "First Last" (the app's day-pull
         passes the display name "Ruth Gehrman"). Normalize BOTH so row-matching uses
         real first/last tokens, and athenaOne's search gets its expected
         "lastname,firstname" (no space) form. */
      if (parts.length < 2) {
        var toks = (parts[0] || '').split(/\s+/).filter(Boolean);
        while (toks.length > 1 && SUFX.test(toks[toks.length - 1])) toks.pop();
        if (toks.length >= 2) { lname = toks[toks.length - 1].toLowerCase(); fname = toks[0].toLowerCase(); }
      }
      var searchStr = (lname && fname) ? (lname + ',' + fname) : String(name || '').trim();
      if (phase === 'fill') {
        var inputs = [].slice.call(document.querySelectorAll('input,textarea')).filter(vis);
        function scoreInput(i) {
          var s = 0;
          var hay = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.id || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.title || '')).toLowerCase();
          if (/search/.test(hay)) s += 3;
          if (/patient|name|find|lookup|client|mrn|chart|quicksearch|global/.test(hay)) s += 3;
          var ty = (i.type || '').toLowerCase();
          if (ty === 'search') s += 3; if (ty === '' || ty === 'text') s += 1;
          if (ty === 'hidden' || ty === 'password' || ty === 'checkbox' || ty === 'radio') s -= 10;
          var r = i.getBoundingClientRect(); if (r.top < 170) s += 1; // global search usually top
          return s;
        }
        inputs.sort(function (a, b) { return scoreInput(b) - scoreInput(a); });
        var best = inputs[0];
        var diag = { frame: location.hostname, inputCount: inputs.length, topScore: best ? scoreInput(best) : -1 };
        if (!best || scoreInput(best) < 3) return { phase: 'fill', filled: false, diag: diag };
        try {
          var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
          var setter = proto && Object.getOwnPropertyDescriptor(proto, 'value');
          best.focus();
          /* v1.62: athenaOne's global search expects "lastname,firstname" (no space). */
          if (setter && setter.set) setter.set.call(best, searchStr); else best.value = searchStr;
          best.dispatchEvent(new Event('input', { bubbles: true }));
          best.dispatchEvent(new Event('change', { bubbles: true }));
          ['keydown', 'keypress', 'keyup'].forEach(function (t) {
            try { best.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); } catch (e) {}
          });
          var form = best.closest && best.closest('form');
          if (form) {
            var sb = [].slice.call(form.querySelectorAll('button,[role=button],input[type=submit]')).filter(vis).find(function (b) {
              return /search|find|go|lookup/i.test((b.textContent || '') + ' ' + (b.getAttribute('aria-label') || '') + ' ' + (b.value || ''));
            });
            if (sb) try { sb.click(); } catch (e) {}
          }
        } catch (e) { return { phase: 'fill', filled: false, diag: diag, error: String((e && e.message) || e) }; }
        diag.inputSig = { tag: best.tagName, type: (best.type || ''), hasPlaceholder: !!best.placeholder };
        return { phase: 'fill', filled: true, diag: diag };
      }
      if (phase === 'open') {
        var BAD = /save|sign|finalize|post|bill|submit|delete|lock|addend|amend|close encounter|check ?out|log ?out|sign ?off|cancel/i;
        function rowText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
        function scoreRow(tx, el) {
          if (!tx || tx.length > 220) return -1;
          /* v1.64: BAD-test only a CONTROL's own short label. A schedule ROW's status
             text ("Check-out", "Cancelled") must not disqualify the row - live 2026-07-09:
             42 of 52 afternoon rows carried "Check-out" and the blanket BAD test made
             EVERY open fail (the whole 0-of-N pull). Click-target choice in clickRow is
             BAD-filtered too, so a dangerous control still can't be clicked. */
          var isCtl = false;
          try { var tg0 = (el.tagName || '').toUpperCase(); isCtl = (tg0 === 'A' || tg0 === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button')); } catch (e0) {}
          if (isCtl && tx.length < 34 && BAD.test(tx)) return -1;
          var s = 0;
          if (lname && tx.indexOf(lname) !== -1) s += 4;
          if (fname && tx.indexOf(fname) !== -1) s += 3;
          if (lname && fname) { try { if (new RegExp(lname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*,\\s*' + fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(tx)) s += 3; } catch (e) {} }
          if (el.tagName === 'A' || el.getAttribute('role') === 'option' || el.getAttribute('role') === 'link') s += 1;
          return s;
        }
        // v1.61: include athenaOne's appointment-container buttons (the reader's
        // proven schedule-row selector) so we match the real schedule rows.
        // v1.62: + the global-search SUGGESTION dropdown items (live-observed: typing
        // "gehrman,ruth" opens a suggestion list; clicking its item opens the chart).
        var SEL = 'a,[role=option],[role=row],tr,li,[role=link],div[role=button],[class*="PatientAppointment_appointment-container"],[role=listbox] *,[class*="suggest"],[class*="typeahead"],[class*="autocomplete"]';
        function scanOnce() {
          var nodes = [].slice.call(document.querySelectorAll(SEL)).filter(vis);
          /* v1.66: when BOTH names are known, require BOTH to match (score >= 7) - a
             last-name-only hit (+4) could be the PROVIDER's label ("Schaeffer" x17 on
             the live dashboard) and clicking it navigates nowhere useful. */
          var best = null, bestSc = (lname && fname) ? 6 : 3;
          for (var i = 0; i < nodes.length; i++) { var tx = rowText(nodes[i]).toLowerCase(); var sc = scoreRow(tx, nodes[i]); if (sc > bestSc) { bestSc = sc; best = nodes[i]; } }
          return { el: best, sc: bestSc, scanned: nodes.length };
        }
        // v1.62: athenaOne v26.3 renders schedule rows as plain <div>s wired to React
        // synthetic events - a bare el.click() does NOTHING on them (live-proven: the
        // opener "clicked" and athena never navigated). Dispatch the real pointer/mouse
        // sequence, exactly like the verified mlsEnsureClinicalChartFn nav does.
        function realClick(el) {
          try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
          try {
            var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
            var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
            ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (tp) {
              try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e2) {}
            });
          } catch (e3) {}
          try { el.click(); } catch (e4) {}
        }
        function clickRow(row) {
          var clickT = null;
          // v1.53: prefer the child link whose text matches the patient NAME (not the
          // row's first <a>, which on a schedule row is often a time/status link).
          try {
            /* v1.64: never pick a click target whose own label is a dangerous control
               ("Check-out" button inside the row). */
            var cand = [].slice.call(row.querySelectorAll('a,[role=link],[role=button],[onclick]')).filter(vis).filter(function (a) { var tb = rowText(a); return !(tb.length < 34 && BAD.test(tb)); });
            clickT = cand.filter(function (a) { var t = rowText(a).toLowerCase(); return (lname && t.indexOf(lname) !== -1) || (fname && t.indexOf(fname) !== -1); })[0] || cand[0];
          } catch (e0) {}
          if (!clickT) {
            /* v1.64: the live dashboard row's name cell is a plain DIV.name (no a/role) -
               pick the SMALLEST visible descendant carrying the patient's name (the
               live-proven click target), BAD-filtered. */
            try {
              var els6 = [].slice.call(row.querySelectorAll('*')).filter(vis);
              var bestN = null, bl6 = 1e9;
              for (var ei6 = 0; ei6 < els6.length; ei6++) {
                var t6 = rowText(els6[ei6]).toLowerCase();
                if (t6 && t6.length < 70 && !BAD.test(t6) && ((lname && t6.indexOf(lname) !== -1) || (fname && t6.indexOf(fname) !== -1)) && t6.length < bl6) { bestN = els6[ei6]; bl6 = t6.length; }
              }
              if (bestN) clickT = bestN;
            } catch (e6) {}
          }
          if (!clickT) clickT = (row.querySelector && row.querySelector('a')) || row;
          realClick(clickT);
          // v1.62: if the chosen target was a non-navigating wrapper, also drive the row.
          if (clickT !== row) { try { realClick(row); } catch (e5) {} }
        }
        // fast path: the row is already rendered
        var hit = scanOnce();
        if (hit.el) { clickRow(hit.el); return { phase: 'open', opened: true, via: 'quick', candidates: 1, diag: { frame: location.hostname, scanned: hit.scanned, topScore: hit.sc } }; }
        // v1.61: SCROLL the virtualized schedule + re-scan. athenaOne renders only the
        // rows in the viewport, so a below-the-fold patient (e.g. Ruth Gehrman) was never
        // found by the old single-scan opener - "open-failed". The reader already scrolls
        // to capture all 52 appts; the opener now mirrors that. Bounded + scoped selectors
        // (no full-DOM innerText walk), so it does not free-scan / freeze athena.
        // v1.62 perf: the v1.61 version called getComputedStyle on EVERY div (thousands
        // on athenaOne) - slow enough to stall the frame's injection. Pre-filter cheaply
        // on scrollHeight/clientHeight (layout-only) and cap the candidate set.
        function findScrollers() {
          var out = [];
          var cands = [].slice.call(document.querySelectorAll('[class*="ScheduleColumn_schedule-column"],[class*="schedule"],[class*="calendar"],main,section')).slice(0, 400);
          for (var i = 0; i < cands.length && out.length < 3; i++) {
            var el = cands[i];
            try {
              if (!(el.scrollHeight > el.clientHeight + 60 && el.clientHeight > 150)) continue;
              var cs = getComputedStyle(el);
              if (/(auto|scroll)/.test(cs.overflowY)) out.push(el);
            } catch (e) {}
          }
          try { var se = document.scrollingElement; if (se && se.scrollHeight > (window.innerHeight + 60) && out.indexOf(se) < 0) out.push(se); } catch (e) {}
          return out;
        }
        var scrollers = findScrollers();
        var scannedTotal = hit.scanned;
        for (var si = 0; si < scrollers.length; si++) {
          var sc0 = scrollers[si], orig = 0; try { orig = sc0.scrollTop; } catch (e) {}
          var step = Math.max(220, Math.round((sc0.clientHeight || 400) * 0.8));
          var maxH = 0; try { maxH = sc0.scrollHeight; } catch (e) {}
          for (var y = 0; y <= maxH && y < 40000; y += step) {
            try { sc0.scrollTop = y; sc0.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (e) {}
            await new Promise(function (r) { setTimeout(r, 320); });
            var h2 = scanOnce(); if (h2.scanned > scannedTotal) scannedTotal = h2.scanned;
            if (h2.el) { clickRow(h2.el); return { phase: 'open', opened: true, via: 'scroll', candidates: 1, diag: { frame: location.hostname, scanned: scannedTotal, scrolledTo: y, topScore: h2.sc } }; }
          }
          try { sc0.scrollTop = orig; } catch (e) {}
        }
        /* v1.62: report a real topScore so bestFrameResult surfaces the SCHEDULE frame's
           diag instead of the empty top frame's (v1.61 dropped it and masked the truth). */
        return { phase: 'open', opened: false, candidates: 0, diag: { frame: location.hostname, scanned: scannedTotal, scrollers: scrollers.length, topScore: scannedTotal > 0 ? 0 : -1 } };
      }
      return { phase: phase, error: 'unknown phase' };
    } catch (e) { return { phase: phase, error: String((e && e.message) || e) }; }
  }

  function bestFrameResult(results, key) {
    // results: array of {result} from executeScript allFrames. Pick the frame
    // whose driver reports success / highest score.
    var rs = (results || []).map(function (r) { return r && r.result; }).filter(Boolean);
    var hit = rs.filter(function (r) { return r && (r.filled || r.opened); });
    if (hit.length) {
      hit.sort(function (a, b) { return ((b.diag && b.diag.topScore) || 0) - ((a.diag && a.diag.topScore) || 0); });
      return hit[0];
    }
    // none succeeded — return the richest diag for tuning
    rs.sort(function (a, b) { return ((b.diag && b.diag.topScore) || -2) - ((a.diag && a.diag.topScore) || -2); });
    return rs[0] || null;
  }

  function progress(tabId, message) { try { chrome.tabs.sendMessage(tabId, { type: 'mlsAppSearchOpenProgress', message: message }); } catch (e) {} }

  /* --- v1.78: "Find a Patient" opener (injected into the TOP frame; drives the
     content frame). The displayed schedule proved to be an UNRELIABLE open
     surface: it renders one department's rows only (live 07-10: the dashboard
     showed a single FROZEN slot for the selected department while the doctor's
     20 real patients were booked under another one -> 17/17 'open-failed').
     athenaOne's classic client/findpatient.esp page is fully programmatic -
     proven live: set input value + input/change, click Find, click the result
     row's Chart link. Read-only: searches and OPENS a chart; never touches
     Save/Sign/orders. Runs from the TOP frame (which never navigates) so the
     driver survives the content frame's two navigations. The result row shows
     name + DOB, so the match is verified BEFORE the chart is opened. */
  async function mlsFindPatientOpenDriverFn(name, dob) {
    try {
      function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
      /* v1.90 name-shape fix: strip "(Bob)" nicknames for the SEARCH string only;
         drop generational suffixes after a comma (", Jr" is a suffix, not a first
         name - live shape "Tom E Hatton, Jr" searched as "Tom E Hatton,Jr" -> 0
         results). Apostrophes/hyphens are athena's own spelling - kept. */
      var SUFX = /^(jr|sr|ii|iii|iv|v|esq|junior|senior)\.?$/i;
      var cleanN = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      var parts = cleanN.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      while (parts.length > 1 && SUFX.test(parts[parts.length - 1])) parts.pop();
      var lname = parts[0] || '', fname = parts.slice(1).join(' ').trim();
      if (parts.length < 2) {
        var toks = lname.split(/\s+/).filter(Boolean);
        while (toks.length > 1 && SUFX.test(toks[toks.length - 1])) toks.pop();
        if (toks.length >= 2) { lname = toks[toks.length - 1]; fname = toks.slice(0, -1).join(' '); }
      }
      if (!lname) return { opened: false, reason: 'no-name' };
      var fq = (fname.split(/\s+/)[0] || '');
      var searchStr = fq ? (lname + ',' + fq) : lname;
      function nrmDob(s) { var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3].length === 2 ? ((Number(m[3]) > 26 ? '19' : '20') + m[3]) : m[3]; return Number(m[1]) + '/' + Number(m[2]) + '/' + y; }
      var wantDob = nrmDob(dob);
      /* locate the main content frame: deepest big same-origin frame, skipping
         nav/status/messaging frames (prefers the proven /f1/f2/f2 slot). */
      var SKIP = /globalnav|statusbar|stm\.esp|schedulenavclose|coordinator\/enterprise|blank\.html/i;
      var best = null;
      (function walk(w, depth) {
        if (depth > 6) return;
        for (var i = 0; i < w.frames.length; i++) {
          var f = w.frames[i];
          try {
            void f.document;
            var p = String(f.location.pathname || '');
            var el = f.frameElement; var r = el ? el.getBoundingClientRect() : null;
            var area = r ? (r.width * r.height) : 0;
            if (!SKIP.test(p) && area > 150000) {
              if (!best || depth > best.depth || (depth === best.depth && area > best.area)) best = { w: f, depth: depth, area: area };
            }
            walk(f, depth + 1);
          } catch (e) {}
        }
      })(window, 0);
      if (!best) return { opened: false, reason: 'no-content-frame' };
      /* practice prefix + CSRF token, harvested from live frame URLs */
      var prefix = '';
      var tokOwn = '', tokAny = '';
      (function walkT(w, depth) {
        if (depth > 6) return;
        for (var i = 0; i < w.frames.length; i++) {
          var f = w.frames[i];
          try {
            void f.document;
            if (!prefix) { var pm = /^\/(\d+)\/(\d+)\//.exec(String(f.location.pathname || '')); if (pm) prefix = '/' + pm[1] + '/' + pm[2] + '/'; }
            var t = new URLSearchParams(String(f.location.search || '')).get('CSRFPROTECT') || '';
            if (t) { if (f === best.w) tokOwn = t; if (!tokAny && !/globalnav|statusbar/i.test(String(f.location.pathname || ''))) tokAny = t; }
            walkT(f, depth + 1);
          } catch (e) {}
        }
      })(window, 0);
      if (!prefix) { var pm2 = /^\/(\d+)\/(\d+)\//.exec(String(location.pathname || '')); if (pm2) prefix = '/' + pm2[1] + '/' + pm2[2] + '/'; }
      if (!prefix) return { opened: false, reason: 'no-practice-prefix' };
      var tok = tokOwn || tokAny || '';
      /* v1.80: findpatient.esp WITHOUT a findtext param renders a server-side
         "You cannot leave the find text field blank" ERROR page with NO form at
         all (live root cause of 'findpatient-no-load'). Navigate the way the
         global search does - filtertype/findtext/defaultaction - which renders
         the form WITH the search text pre-filled; then click Find to run the
         real search (the URL-only search itself returns nothing). */
      best.w.location.href = prefix + 'client/findpatient.esp?filtertype=NAME&findtext=' + encodeURIComponent(searchStr)
        + '&defaultaction=' + encodeURIComponent(prefix + 'client/clientsummary.esp')
        + (tok ? ('&CSRFPROTECT=' + encodeURIComponent(tok)) : '');
      var deadline = Date.now() + 14000, ready = false;
      while (Date.now() < deadline) {
        await sleep(400);
        try {
          var d2 = best.w.document;
          if (d2 && d2.body && d2.querySelector('input[type=text]')) { ready = true; break; }
        } catch (e) {}
      }
      if (!ready) return { opened: false, reason: 'findpatient-no-load' };
      /* v1.79: the page's own init can re-render/CLEAR the input after we fill it
         (live: Find submitted empty -> "You cannot leave the find text field
         blank"). Settle first; fill the first VISIBLE text input via the native
         value setter; RE-QUERY each try (re-renders replace the node); verify the
         value actually stuck before clicking Find; retry once if athena still
         reports a blank search. */
      await sleep(900);
      function findInput() {
        try {
          var ins = Array.prototype.slice.call(best.w.document.querySelectorAll('input[type=text]'));
          for (var q2 = 0; q2 < ins.length; q2++) { var rc = ins[q2].getBoundingClientRect(); if (rc.width > 50 && rc.height > 10) return ins[q2]; }
          return ins[0] || null;
        } catch (e) { return null; }
      }
      function setVal(el, v) {
        try {
          var proto = best.w.HTMLInputElement && best.w.HTMLInputElement.prototype;
          var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
          if (desc && desc.set) desc.set.call(el, v); else el.value = v;
        } catch (e) { try { el.value = v; } catch (e2) {} }
        try { el.dispatchEvent(new best.w.Event('input', { bubbles: true })); el.dispatchEvent(new best.w.Event('change', { bubbles: true })); } catch (e) {}
      }
      var filled = false;
      for (var ft = 0; ft < 4 && !filled; ft++) {
        var inp = findInput();
        if (!inp) { await sleep(500); continue; }
        try { inp.focus(); } catch (e) {}
        setVal(inp, searchStr);
        await sleep(600);
        var inpChk = findInput();
        if (inpChk && inpChk.value === searchStr) { filled = true; break; }
      }
      if (!filled) return { opened: false, reason: 'fill-not-sticking' };
      var resText = '';
      for (var fa = 0; fa < 2; fa++) {
        var findBtn = Array.prototype.slice.call(best.w.document.querySelectorAll('button,input[type=submit],input[type=button]')).filter(function (b) { return /^find$/i.test((b.innerText || b.value || '').trim()); })[0];
        if (!findBtn) return { opened: false, reason: 'no-find-button' };
        findBtn.click();
        var resDeadline = Date.now() + 12000;
        resText = '';
        while (Date.now() < resDeadline) {
          await sleep(450);
          try { resText = (best.w.document.body && best.w.document.body.innerText) || ''; } catch (e) { resText = ''; }
          if (/\d+\s+results?\s+found|no results|cannot leave the find text field blank/i.test(resText)) break;
        }
        if (/cannot leave the find text field blank/i.test(resText)) {
          var inpR = findInput();
          if (inpR) { setVal(inpR, searchStr); await sleep(500); }
          continue;
        }
        break;
      }
      if (!/\d+\s+results?\s+found/i.test(resText)) return { opened: false, reason: (/cannot leave the find text field blank/i.test(resText) ? 'blank-error' : (/no results/i.test(resText) ? 'no-results' : 'results-timeout')) };
      /* v1.85: the "N results found" TEXT renders BEFORE the rows' action links
         hydrate (live: 2 Marie Dunnes on screen but zero Chart links at scan
         time -> false 'no-name-match'). Poll for the links. */
      var chartAs = [];
      var linkDeadline = Date.now() + 6000;
      while (Date.now() < linkDeadline) {
        var d4 = best.w.document;
        chartAs = Array.prototype.slice.call(d4.querySelectorAll('a')).filter(function (a) { return /^chart$/i.test((a.innerText || '').trim()); });
        if (chartAs.length) break;
        await sleep(400);
      }
      if (!chartAs.length) return { opened: false, reason: 'rows-not-rendered' };
      d4 = best.w.document;
      var lnorm = lname.toLowerCase(), fnorm = fq.toLowerCase();
      /* v1.81: TWO-TIER first-name matching. A prefix like "pat" matches
         Patricia AND Patrick (live: "6 results found" -> every such patient
         failed 'ambiguous'). Tier 1 = the row's first-name cell EQUALS the
         token (or its first word does); tier 2 = prefix. A single tier-1 hit
         wins even when tier 2 is ambiguous. DOB (when the app sent one, or
         shown on the row) still disambiguates first. */
      var exact = [], prefix = [], vetoedExact = [], vetoedAny = 0;
      for (var c = 0; c < chartAs.length; c++) {
        var tr = chartAs[c].closest ? chartAs[c].closest('tr') : null;
        if (!tr) continue;
        var cells = Array.prototype.slice.call(tr.querySelectorAll('td,th')).map(function (x) { return (x.innerText || '').trim(); });
        var rowT = cells.join(' | ').toLowerCase();
        if (rowT.indexOf(lnorm) < 0) continue;
        var rowDob = '';
        for (var cd = 0; cd < cells.length; cd++) { var dm2 = /([01]?\d)\/([0-3]?\d)\/(\d{4})/.exec(cells[cd]); if (dm2) { rowDob = Number(dm2[1]) + '/' + Number(dm2[2]) + '/' + dm2[3]; break; } }
        var m = { a: chartAs[c], dob: rowDob };
        var isExact = false, isPrefix = false;
        if (!fnorm) { isPrefix = true; }
        else {
          for (var cx = 0; cx < cells.length; cx++) {
            var v = cells[cx].trim().toLowerCase();
            if (!v || v.length > 40) continue;
            var w0 = v.split(/\s+/)[0];
            if (v === fnorm || w0 === fnorm) { isExact = true; break; }
            /* v1.87: registered nicknames - athena renders "Robert (Bob)"; the
               roster says "Bob". A word-boundary hit inside the first-name cell
               counts as exact (the row still had to match the LAST name, and
               DOB / single-candidate gating still applies). */
            try { if (new RegExp('\\b' + fnorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(v)) { isExact = true; break; } } catch (e7) {}
            if (v.indexOf(fnorm) === 0) isPrefix = true;
          }
        }
        if (wantDob && rowDob && rowDob !== wantDob) {
          /* v1.94: do NOT silently drop DOB-vetoed name matches - report them.
             The store/roster DOB can be junk (live: LAURA ZAKORCHEMNY stored
             12/31/1940 vs athena 05/14/1990 -> every open refused forever). */
          if (isExact) vetoedExact.push(m);
          if (isExact || isPrefix) vetoedAny++;
          continue;
        }
        if (isExact) exact.push(m); else if (isPrefix) prefix.push(m);
      }
      var pool = exact.length ? exact : prefix;
      if (!pool.length) {
        if (vetoedExact.length === 1) return { opened: false, reason: 'dob-mismatch', count: 1, tier: 'exact', rowDob: vetoedExact[0].dob || '' };
        if (vetoedAny) return { opened: false, reason: 'dob-mismatch', count: vetoedAny, tier: vetoedExact.length ? 'exact' : 'prefix', rowDob: '' };
        return { opened: false, reason: 'no-name-match' };
      }
      if (pool.length > 1) return { opened: false, reason: 'ambiguous', count: pool.length, tier: exact.length ? 'exact' : 'prefix' };
      pool[0].a.click();
      /* v1.82: return IMMEDIATELY after the Chart click - same contract as the
         schedule-click route. The app's open bridge budget is ~18s and the READ
         side's chart-ready gate (52s budget, shadow-aware from round 2) is the
         component designed to wait for the chart to load. The v1.81 settle loop
         here pushed every open past the app's budget -> empty in-place reads. */
      return { opened: true, via: 'findpatient', rowDob: pool[0].dob || '' };
    } catch (e) { return { opened: false, error: String((e && e.message) || e) }; }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    // (A) Panel "Pull from chart" -> trigger the proven in-app pull without changing the user's tab
    if (msg.type === 'mlsAssistPullToApp') {
      (async function () {
        try {
          var all = await chrome.tabs.query({});
          var appTab = findAppTab(all);
          if (!appTab) { sendResponse({ ok: false, error: 'Open MLS (mlsscribe.com) in a tab first, then try again.' }); return; }
          /* v2.9.14 (Codex E3): READ-ONLY PREFLIGHT, retried once on transient
             injection failure — confirms a pull target exists BEFORE the
             click-bearing injection, which then runs EXACTLY once (a lost
             response channel can mean the pull already started; never re-click). */
          var pf = null;
          for (var pfTry = 0; pfTry < 2 && !pf; pfTry++) {
            try {
              var pr = await chrome.scripting.executeScript({ target: { tabId: appTab.id }, func: function () {
                try { return { hasBtn: !!document.getElementById('ptPullAthenaBtn'), hasShared: !!(window.__mlsAthenaActions && window.__mlsAthenaActions.pullOpenChart), hasAuto: !!(window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.run) }; } catch (e) { return null; }
              } });
              pf = pr && pr[0] && pr[0].result;
            } catch (ePf) { pf = null; }
            if (!pf && pfTry === 0) { await new Promise(function (r2) { setTimeout(r2, 600); }); }
          }
          if (!pf || (!pf.hasBtn && !pf.hasShared && !pf.hasAuto)) { sendResponse({ ok: false, reason: 'no-target', error: 'Open the MLS Visit or Patients page first, then try again.' }); return; }
          /* This is a read kickoff. Injection works in a background app tab, so
             never activate/focus it over whatever non-Athena tab the user chose. */
          var r = null;
          try {
            r = await chrome.scripting.executeScript({
              target: { tabId: appTab.id },
              func: function () {
                try {
                  var btn = document.getElementById('ptPullAthenaBtn');
                  if (btn) { btn.click(); return 'clicked'; }
                  if (window.__mlsAthenaActions && window.__mlsAthenaActions.pullOpenChart) { window.__mlsAthenaActions.pullOpenChart({ title: 'Pull from chart', patientName: null, intent: { brings: 'Pull from chart → brings in name, DOB and all visits.', mode: 'read' } }); return 'shared'; }
                  if (window.__mlsAthenaAutoPull && window.__mlsAthenaAutoPull.run) { window.__mlsAthenaAutoPull.run(); return 'autopull'; }
                  return 'no-target';
                } catch (e) { return 'err:' + (e && e.message); }
              }
            });
          } catch (eClick) {
            /* channel lost AFTER the click injection was dispatched — the pull may
               have started; report honestly, never re-click. */
            sendResponse({ ok: false, reason: 'pull-outcome-unknown', error: 'The pull request was sent but its result was lost — check the MLS tab: if no pull is running, click Pull again there.' });
            return;
          }
          var v = r && r[0] && r[0].result;
          if (v === 'no-target') { sendResponse({ ok: false, reason: 'no-target', error: 'Open the MLS Visit or Patients page first, then try again.' }); return; }
          if (typeof v === 'string' && v.indexOf('err:') === 0) { sendResponse({ ok: false, error: v.slice(4) }); return; }
          sendResponse({ ok: true, via: v });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }

    // (B) Search-and-navigate by name (read-only: type in search bar + open chart)
    if (msg.type === 'mlsAppSearchOpenRequest') {
      (async function () {
        var senderTab = sender && sender.tab && sender.tab.id;
        try {
          var all = await chrome.tabs.query({});
          var tab = (await mlsPickAthenaTab(all, { athenaOnly: true })) || pickEmrTab(all); /* v1.90 unified verified pick; legacy scorer (3711) stays the non-athena fallback */
          if (!tab) { sendResponse({ ok: false, error: 'Open your signed-in athenaOne in another tab, then try again.' }); return; }
          /* v1.91 (§2.9): athena reliably freezes after ~5-9 rapid chart opens+reads,
             and the findpatient-first flow never goes Home, so the go-home chunker
             (>=6) no longer runs on bulk pulls. Chunk HERE at the same natural
             boundary: reload-recover the tab BEFORE the next open once enough reads
             accumulated. Live 07-10 repro this prevents: alternating open-failures
             (Zakorchemny / Boyle / Pownall) with the tab CDP-frozen afterward. */
          if (__mlsReadsSinceReload >= 5) {
            if (senderTab) progress(senderTab, 'Giving athenaOne a breather (freeze-guard reload)…');
            await mlsRecoverAthenaTab(tab.id);
          }
          // === v1.53 ROUTE 1 — SCHEDULE/CALENDAR CLICK-OPEN (reliable on athenaOne v26.3) ===
          // The synthetic search-box 'fill' path below does NOT register a query on
          // athenaOne v26.3 (verified live: it types but the search never runs), so we
          // FIRST scan the CURRENT athenaOne page (schedule / calendar / dashboard —
          // exactly where the day+month bulk-pull patients already are) for the
          // patient's row and click their name link. Read-only: opens the chart, never
          // Save/Sign. Only if no matching row is on screen do we fall back to the
          // legacy search-box path.
          /* v1.78: TWO real routes, ordered by what last worked (sticky pref).
             Route A = schedule/dashboard row click (proven when the right
             department's schedule is displayed). Route B = findpatient.esp
             (schedule-INDEPENDENT; proven live 07-10 when route A failed
             17/17 on a wrong-department dashboard). After a route succeeds it
             goes first for the rest of the session, so bulk pulls do not burn
             ~20s per patient re-failing the broken route. */
          /* v1.85: findpatient FIRST by default - it is schedule-independent and
             verifies name+DOB on the result row BEFORE opening. The schedule
             scan is the fallback (it depends on the right department's schedule
             being displayed and can phantom-click name-bearing inbox rows). */
          var order = (self.__mlsOpenPref === 'schedule') ? ['sched', 'find'] : ['find', 'sched'];
          var sched = null, findRes = null;
          for (var oi = 0; oi < order.length; oi++) {
            if (order[oi] === 'sched') {
              if (senderTab) progress(senderTab, 'Looking for “' + (msg.name || '') + '” on the athenaOne schedule…');
              /* v1.89: a stuck-open Calendar nav dropdown can overlay the very
                 schedule rows this scan is about to read/click - close it first
                 (Escape + one gated neutral click; strictly zero-touch when no
                 menu overlay is visible). Sched route ONLY (wf_6): findpatient
                 navigates the content frame anyway. Never blocks the open. */
              try { if (typeof mlsDismissNavMenuFn === 'function') await mlsExecTO({ target: { tabId: tab.id, allFrames: true }, func: mlsDismissNavMenuFn }, 6000); } catch (eDm) {}
              var schedRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'open'] });
              sched = bestFrameResult(schedRes, 'open');
              if (sched && sched.opened) {
                try { self.__mlsOpenPref = 'schedule'; } catch (e0) {}
                /* v1.60: remember WHO we just opened - the follow-up bare chart read
                   uses this to wait for the RIGHT patient's banner instead of
                   accepting a stale/lurking frame's identity. */
                try { self.__mlsExpectOpen = { name: msg.name || '', at: Date.now() }; } catch (e0) {}
                sendResponse({ ok: true, opened: true, via: 'schedule-click', candidates: sched.candidates, diag: sched.diag }); return;
              }
            } else {
              if (senderTab) progress(senderTab, 'Searching athenaOne patients for “' + (msg.name || '') + '”…');
              /* v1.83: MAIN world - the result row's Chart link is a javascript:
                 URL (redirectToAirlock), and Chrome refuses javascript: navigations
                 initiated from an extension's ISOLATED world: the fill and Find
                 worked but every Chart click silently did nothing (live: the frame
                 sat on the results page while reads came back empty). Page-context
                 clicks are proven to navigate (the Adam chart open). */
              /* v1.91 (§2.9): a frozen/hung athena renderer surfaces here as an
                 injection timeout or a load/render failure. Recover the tab
                 (reload + Continue-clear) and retry this SAME patient once, so a
                 freeze costs a pause instead of an open-failure. Honest refusals
                 (ambiguous / no-results / no-name-match) never trigger a retry. */
              var fx = null;
              for (var fpTry = 0; fpTry < 2; fpTry++) {
                fx = await mlsExecTO({ target: { tabId: tab.id }, world: 'MAIN', args: [msg.name || '', msg.dob || ''], func: mlsFindPatientOpenDriverFn }, 42000);
                findRes = (fx && fx.r && fx.r[0] && fx.r[0].result) || null;
                if (findRes && findRes.opened) break;
                var rzn = (findRes && findRes.reason) || '';
                var retryable = (fx && fx.timeout) || !findRes || !!(findRes && findRes.error) || /^(findpatient-no-load|results-timeout|fill-not-sticking|no-content-frame|rows-not-rendered|blank-error|no-find-button)$/.test(rzn); /* v1.98: no-find-button = findpatient rendered inside an odd view layout (live: dept-calendar-parked tab) - a reload recovery restores the normal frameset */
                if (fpTry === 0 && retryable) {
                  if (senderTab) progress(senderTab, 'athenaOne stopped responding — reloading it and retrying “' + (msg.name || '') + '”…');
                  await mlsRecoverAthenaTab(tab.id);
                  continue;
                }
                break;
              }
              /* v1.94: the store/roster DOB can be junk. When the search found
                 EXACTLY ONE exact-name row and only the DOB veto blocked it,
                 re-run once with no DOB and open that single match. Read-only:
                 the chart read + every save/write gate still verifies the REAL
                 banner name+DOB downstream, so a true different-person row can
                 be opened but never saved against the wrong record. 2+ rows
                 stay refused (ambiguous) exactly as before. */
              if (findRes && findRes.reason === 'dob-mismatch' && findRes.count === 1 && findRes.tier === 'exact') {
                if (senderTab) progress(senderTab, 'DOB on file differs from athena for “' + (msg.name || '') + '” — opening the single exact name match (read-only)…');
                var fxo = await mlsExecTO({ target: { tabId: tab.id }, world: 'MAIN', args: [msg.name || '', ''], func: mlsFindPatientOpenDriverFn }, 42000);
                var fro = (fxo && fxo.r && fxo.r[0] && fxo.r[0].result) || null;
                if (fro && fro.opened) {
                  try { self.__mlsOpenPref = 'findpatient'; } catch (e0) {}
                  try { self.__mlsExpectOpen = { name: msg.name || '', at: Date.now() }; } catch (e0) {}
                  sendResponse({ ok: true, opened: true, via: 'findpatient', candidates: 1, dobOverride: true, rowDob: fro.rowDob || '', diag: { route: 'findpatient-dob-override', rowDobKnown: fro.rowDob ? 1 : 0 } }); return;
                }
                findRes = fro || findRes;
              }
              /* v2.9.6 COMPOUND-SURNAME RETRY (live case 2026-07-13: "Priscilla
                 Pennington Zytkowicz" -> searched "Zytkowicz,Priscilla" -> no-results,
                 but her athenaOne last name IS "Pennington Zytkowicz"; the reshaped
                 search opened her chart with the DOB row-verified). When the plain
                 first+last search honestly finds nothing and the requested comma-less
                 name has 3+ tokens, retry ONCE treating the LAST TWO tokens as the
                 surname ("Pennington Zytkowicz, Priscilla"). Read-only and
                 gate-neutral: the same DOB veto + ambiguity refusal run inside the
                 driver on the retry, and every downstream chart-read/write identity
                 gate is unchanged. A retry that also finds nothing keeps the original
                 honest refusal. */
              if (findRes && !findRes.opened && /^(no-results|no-name-match)$/.test(findRes.reason || '') && String(msg.name || '').indexOf(',') < 0) {
                var cTok = String(msg.name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
                while (cTok.length > 1 && /^(jr|sr|ii|iii|iv|v|esq|junior|senior)\.?$/i.test(cTok[cTok.length - 1])) cTok.pop();
                if (cTok.length >= 3) {
                  var cName = cTok.slice(-2).join(' ') + ', ' + cTok.slice(0, -2).join(' ');
                  if (senderTab) progress(senderTab, 'No match for “' + (msg.name || '') + '” — retrying with compound last name “' + cName + '”…');
                  var fxc = await mlsExecTO({ target: { tabId: tab.id }, world: 'MAIN', args: [cName, msg.dob || ''], func: mlsFindPatientOpenDriverFn }, 42000);
                  var frc = (fxc && fxc.r && fxc.r[0] && fxc.r[0].result) || null;
                  if (frc && (frc.opened || /^(ambiguous|dob-mismatch)$/.test(frc.reason || ''))) findRes = frc;
                }
              }
              if (findRes && findRes.opened) {
                try { self.__mlsOpenPref = 'findpatient'; } catch (e0) {}
                try { self.__mlsExpectOpen = { name: msg.name || '', at: Date.now() }; } catch (e0) {}
                sendResponse({ ok: true, opened: true, via: 'findpatient', candidates: 1, rowDob: findRes.rowDob || '', diag: { route: 'findpatient', rowDobKnown: findRes.rowDob ? 1 : 0 } }); return;
              }
              /* v1.84: if the search RAN and left its RESULTS page on screen
                 (ambiguous / no match), do NOT fall through to the schedule
                 scanner - it false-positives on the results rows (javascript:
                 links that cannot navigate from the isolated world; live:
                 phantom opens then junk reads "Mainline, Lauren" / "Fail, PTA"
                 that the app gate had to refuse). Fail honestly instead. */
              if (findRes && /^(ambiguous|no-results|no-name-match|blank-error|rows-not-rendered|dob-mismatch)$/.test(findRes.reason || '')) {
                sendResponse({ ok: false, opened: false, candidates: (findRes.count || 0),
                  error: findRes.reason === 'ambiguous' ? ('Found ' + (findRes.count || 'several') + ' possible matches for ' + (msg.name || '') + ' — refusing to open any of them without a DOB to disambiguate.')
                    : findRes.reason === 'dob-mismatch' ? ('athenaOne has ' + (findRes.count || 1) + ' name match(es) for ' + (msg.name || '') + ' but the DOB on file does not match any of them — check the stored DOB.')
                    : 'athenaOne patient search found no matching patient.',
                  findReason: findRes.reason }); return;
              }
            }
          }
          // === legacy fallback: synthetic global-search (kept for off-schedule patients; may fail on v26.3) ===
          if (senderTab) progress(senderTab, 'Not on the current view — trying the Athena patient search…');
          var fillRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'fill'] });
          var fill = bestFrameResult(fillRes, 'fill');
          if (!fill || !fill.filled) {
            sendResponse({ ok: false, opened: false, error: 'Could not find the Athena patient search box on this screen.', diag: fill && fill.diag });
            return;
          }
          if (senderTab) progress(senderTab, 'Searching “' + (msg.name || '') + '”…');
          await new Promise(function (r) { setTimeout(r, 1900); }); // let results render
          if (senderTab) progress(senderTab, 'Reading the results…');
          var openRes = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsSearchOpenDriverFn, args: [msg.name || '', 'open'] });
          var opened = bestFrameResult(openRes, 'open');
          if (opened && opened.opened) {
            try { self.__mlsExpectOpen = { name: msg.name || '', at: Date.now() }; } catch (e0) {}
            sendResponse({ ok: true, opened: true, candidates: opened.candidates, diag: opened.diag });
          } else {
            var cands = (openRes || []).map(function (r) { return r && r.result; }).filter(Boolean).reduce(function (a, r) { return a + ((r && r.candidates) || 0); }, 0);
            sendResponse({ ok: false, opened: false, candidates: cands, error: cands > 1 ? ('Found ' + cands + ' possible matches.') : 'No matching patient was found in the results.', diag: opened && opened.diag, findReason: (findRes && (findRes.reason || findRes.error)) || '' });
          }
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }
    // not ours — let other listeners handle it
  });
})();


// ---- v1.40: Athena "Sign & Save" driver (injected, runs per frame) ----------
// USER-INITIATED ONLY - fired because the doctor clicked "Sign and Save" in MLS,
// never autonomously. Self-contained for chrome.scripting injection.
//   mode 'probe' = READ-ONLY: locate the Sign/Save control(s); click NOTHING.
//   mode 'sign'  = click Sign & Save, confirm any dialog, then VERIFY the chart
//                  actually signed/saved. Reports signed:true ONLY on positive
//                  confirmation - it NEVER fabricates success.
async function mlsAthenaSignSave(mode) {
  mode = (mode === 'sign') ? 'sign' : 'probe';
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function vis(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05; } catch (e) { return false; } }
  function txt(el) { try { return ((el && (el.textContent || el.value || (el.getAttribute && el.getAttribute('aria-label')))) || '').replace(/\s+/g, ' ').trim(); } catch (e) { return ''; } }
  // Strict: the control must clearly mean "sign (and save/file)". Never destructive.
  var SIGN_RE = /\bsign\s*(?:&|and)?\s*(?:save|file)\b|\bsave\s*(?:&|and)\s*sign\b/i;
  var SIGN_ONLY_RE = /\bsign\b/i;
  var BAD_RE = /cancel|delete|discard|remove|unsign|void|addend|amend|reopen|log\s*out|sign\s*out|sign\s*off\s*&?\s*next|next\s*patient|close\s*(?:without|encounter)|don'?t\s*save/i;
  function findSignControls() {
    var els = [].slice.call(document.querySelectorAll('button,[role=button],input[type=submit],input[type=button],a[role=button]')).filter(vis);
    var hits = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], t = txt(el);
      if (!t || t.length > 40 || BAD_RE.test(t)) continue;
      var s = 0;
      if (SIGN_RE.test(t)) s += 10; else if (SIGN_ONLY_RE.test(t)) s += 4; else continue;
      if (/save|file/i.test(t)) s += 3;
      hits.push({ el: el, t: t, s: s, len: t.length });
    }
    hits.sort(function (a, b) { return (b.s - a.s) || (a.len - b.len); });
    return hits;
  }
  function signedIndicator() {
    var body = (document.body && document.body.innerText || '');
    if (/\bsigned\s*(?:by|on)\b|electronically\s*signed|note\s*signed|encounter\s*(?:signed|closed)|signed\s*(?:and|&)\s*(?:saved|filed)|successfully\s*signed|chart\s*closed/i.test(body)) return true;
    var toast = [].slice.call(document.querySelectorAll('[role=status],[role=alert],.toast,.notification,.success,[class*=success],[class*=signed]')).filter(vis);
    for (var i = 0; i < toast.length; i++) { if (/signed|filed|closed|success/i.test(txt(toast[i]))) return true; }
    return false;
  }
  function clickEl(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    var o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
      try { el.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {}
    });
    try { el.click(); } catch (e) {}
  }

  var controls = findSignControls();
  var alreadySigned = signedIndicator();
  var observed = { url: location.href, top: (function () { try { return window.top === window; } catch (e) { return false; } })(),
    controlFound: !!controls.length, controlText: controls.length ? controls[0].t : '', controlCount: controls.length, alreadySigned: alreadySigned };

  if (mode === 'probe') return { ok: true, mode: 'probe', ready: !!controls.length, observed: observed };

  // ----- SIGN (clicks; user-initiated; never invoked autonomously) -----
  if (alreadySigned) return { ok: true, signed: true, reason: 'already-signed', observed: observed };
  if (!controls.length) return { ok: false, signed: false, reason: 'no-control', msg: 'Could not find a Sign & Save control on this Athena screen.', observed: observed };

  clickEl(controls[0].el);
  await sleep(700);
  // a confirm dialog may appear -> click the AFFIRMATIVE sign/confirm button (not cancel)
  var dlg = [].slice.call(document.querySelectorAll('[role=dialog],[role=alertdialog],.modal,.dialog,[class*=modal],[class*=dialog]')).filter(vis);
  if (dlg.length) {
    var btns = [];
    dlg.forEach(function (d) { [].slice.call(d.querySelectorAll('button,[role=button],input[type=submit]')).filter(vis).forEach(function (b) { btns.push(b); }); });
    var pick = null;
    for (var i = 0; i < btns.length; i++) { var bt = txt(btns[i]); if (!bt || BAD_RE.test(bt)) continue; if (SIGN_RE.test(bt) || /\b(?:confirm|ok|yes|continue|accept)\b/i.test(bt)) { pick = btns[i]; if (SIGN_RE.test(bt)) break; } }
    if (pick) { clickEl(pick); await sleep(800); }
  }
  // verify - REQUIRE a positive signed indicator. Control disappearing alone is NOT proof.
  for (var w = 0; w < 10; w++) {
    if (signedIndicator()) return { ok: true, signed: true, reason: 'confirmed', observed: observed };
    await sleep(500);
  }
  return { ok: true, signed: false, reason: 'unconfirmed', msg: 'Clicked Sign & Save but could not confirm Athena finished signing - check the chart in Athena before relying on it.', observed: observed };
}

/* ===== v1.38: MLS Seamless Pop-up overlay router (appended) ===== */
/* =========================================================================
   MLS Seamless Pop-up  —  background.js ADDITIONS  (v0.2.0)

   APPEND-ONLY block for the MLS Assist service worker. It adds an intent
   router for the overlay and re-uses the EXISTING, in-production handlers —
   it does NOT rewrite them:
       mlsAppReadAllVisits  (read open patient + all visits, identity)   [reuse]
       mlsAppPasteNote      (frame-aware verified paste, never signs)    [reuse]
       (note generation goes through the existing backend call path)     [reuse]
   plus ONE new, FLAG-GATED driver: mlsAppWriteCodes (coding-field driver).

   HARD RAILS: read-only except the two deliberate gated writes; NEVER clicks
   Save/Sign/attest/submit-charges; success only when verified; no fabrication.

   The functions referenced as EXISTING (runReadAllVisits, runPasteNote,
   readChartIdentity, callBackendNote, namesMatch, dobsMatch, normDob,
   findAthenaTab, focusTab, validateCodesViaApp, saveVisitsViaApp) are the
   service worker's already-shipped internals; this block only orchestrates
   them. Names are bound defensively so a missing internal degrades honestly
   rather than throwing.
   ========================================================================= */
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  if (self.__mlsOverlayRouterInstalled) return;
  self.__mlsOverlayRouterInstalled = true;

  // ---- feature flag: the codes-into-pickers driver stays OFF until it has
  //      had one real athenaOne selector-tuning pass (see 04_codes_writeback).
  var FLAGS = { codesDriver: false };
  try { chrome.storage && chrome.storage.local.get(['mlsFlags'], function (v) {
    if (v && v.mlsFlags) Object.assign(FLAGS, v.mlsFlags);
  }); } catch (e) {}

  // ---- per-tab session: the identity locked at "Go" -----------------------
  var sessions = {};   // tabId -> { lockedIdentity:{name,dob} }
  function sess(tabId) { return (sessions[tabId] = sessions[tabId] || {}); }

  // ---- recording session: which overlay tab is currently recording --------
  //      (transcript chunks are streamed back to exactly this tab)
  var recordingTabId = null;

  // ---- defensive bind to existing service-worker internals ----------------
  function bind(name) { return (typeof self[name] === 'function') ? self[name] : null; }
  function fn(name) { return (typeof self[name] === 'function') ? self[name] : null; }

  // =====================================================================
  // v1.40 ROOT-CAUSE FIX: the overlay was bound to adapter names that were
  // NEVER implemented (findAthenaTab / readChartIdentity / runReadAllVisits /
  // runPasteNote / callBackendNote). Every binding resolved to null, so STATUS
  // always reported patientOpen:false and GO/GENERATE/WRITEBACK all failed -
  // the overlay was permanently stuck on "Open a patient in Athena". These
  // adapters wire the overlay to the PROVEN, in-production engines instead.
  // All read-only except the existing gated note paste. NEVER Save/Sign here.
  // =====================================================================

  // find the signed-in athenaOne / EMR tab (reuse the proven picker)
  function overlayFindEmrTab() {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.query({}, function (all) {
          var picker = fn('mlsPickEmrTab');
          resolve(picker ? (picker(all || []) || null) : ((all || []).filter(function (t) { return /athenahealth|athenanet|athenaone/i.test(t.url || ''); })[0] || null));
        });
      } catch (e) { resolve(null); }
    });
  }

  // read the OPEN chart's identity (read-only; best-scoring frame)
  function overlayReadIdentity(tabId) {
    var reader = fn('mlsReadChartIdentity');
    if (!reader || typeof chrome.scripting === 'undefined' || tabId == null) return Promise.resolve(null);
    return chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, func: reader })
      .then(function (res) {
        var best = mlsBestIdentityFrom(res); /* v1.59: banner-preferred */
        return best ? { name: best.name, dob: best.dob || '', mrn: best.mrn || '', score: best.score || 0 } : null;
      })
      .catch(function () { return null; });
  }

  function overlayNoteText(noteObj) {
    if (!noteObj) return '';
    if (typeof noteObj === 'string') return noteObj;
    var t = noteObj.soap || noteObj.text || noteObj.note || noteObj.content || '';
    if (!t && noteObj.insurance) t = noteObj.insurance;
    return String(t || '');
  }

  // verified, frame-scored paste of the note (PATIENT GATE already enforced by
  // doWriteBack). Reuses the proven mlsFieldScanner + mlsNotePaster path. Never signs.
  function overlayPasteNote(arg) {
    var noteObj = (arg && arg.note != null) ? arg.note : arg;
    var text = overlayNoteText(noteObj);
    var scanner = fn('mlsFieldScanner'), paster = fn('mlsNotePaster'), segmenter = fn('mlsSegmentNote');
    if (!text.trim()) return Promise.resolve({ error: 'Nothing to write.' });
    if (!scanner || !paster || typeof chrome.scripting === 'undefined') return Promise.resolve({ error: 'Write path unavailable - reload the extension.' });
    return overlayFindEmrTab().then(function (tab) {
      if (!tab) return { error: 'No signed-in athenaOne tab is open.' };
      var segs = segmenter ? segmenter(text) : [{ text: text, section: (noteObj && noteObj.section) || 'progress' }];
      var sections = [];
      var i = 0;
      function step() {
        if (i >= segs.length) return { sections: sections };
        var seg = segs[i];
        var last = { ok: false };
        var attempt = 0;
        function tryOnce() {
          var measureP;
          try { measureP = chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, args: [seg.text, seg.section], func: scanner }); }
          catch (e) { measureP = chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [seg.text, seg.section], func: scanner }); }
          return measureP.then(function (measure) {
            var wf = null, bs = -1e12, wfScan = null;
            (measure || []).forEach(function (m) { if (m && m.result && m.result.has && m.result.score > bs) { bs = m.result.score; wf = (m.frameId != null ? m.frameId : 0); wfScan = m.result; } });
            if (wf === null) { last = { ok: false, notfound: true, targetLabel: seg.section }; return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return null; }); }
            return chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [wf] }, args: [seg.text, seg.section, wfScan], func: paster })
              .then(function (r) { last = (r && r[0] && r[0].result) || { ok: false }; return null; });
          });
        }
        function loop() {
          if (attempt >= 2 || (last.ok && last.confirmed)) {
            sections.push({ section: last.chosenSection || last.targetLabel || seg.section, confirmed: !!last.confirmed, written: !!last.ok });
            i++; return step();
          }
          attempt++;
          return tryOnce().then(function () { if (last.ok && last.confirmed) { sections.push({ section: last.chosenSection || last.targetLabel || seg.section, confirmed: true, written: true }); i++; return step(); } return new Promise(function (r) { setTimeout(r, 380); }).then(loop); });
        }
        return loop();
      }
      return Promise.resolve(step());
    });
  }

  // backend note generation (reuse the proven authenticated backend call)
  function overlayBackendNote(req) {
    var cb = fn('callBackend');
    if (!cb) return Promise.reject(new Error('backend-unavailable'));
    req = req || {};
    var transcript = String(req.transcript || '');
    var typed = String(req.typedNotes || '');
    var combined = (transcript + (transcript && typed ? '\n\n' : '') + typed).trim();
    return cb('/api/assist/note', { transcript: combined }).then(function (d) {
      d = d || {};
      if (d.error) throw new Error(d.error);
      var n = d.note || d;
      var text = n.soap || n.text || n.note || n.content || (typeof n === 'string' ? n : '');
      return { soap: text, text: text, insurance: n.insurance || '', em_level: n.em_level || n.em || '', icd10: n.icd10 || n.icd || [], cpt: n.cpt || [] };
    });
  }

  function overlayFocusTab(tabId) {
    try { chrome.tabs.update(tabId, { active: true }, function (t) { try { if (t && t.windowId != null) chrome.windows.update(t.windowId, { focused: true }); } catch (e) {} }); } catch (e) {}
    return Promise.resolve({ ok: true });
  }

  var matcher = fn('mlsMatchPatients');
  var ext = {
    // read open patient + ALL visits - drive the PROVEN v1.34 visits engine
    readAllVisits: (typeof self.__mlsOverlayReadVisits === 'function')
      ? function (opts) { opts = opts || {}; return self.__mlsOverlayReadVisits((opts.appTabId != null ? opts.appTabId : null), {}); }
      : (bind('runReadAllVisits') || bind('mlsRunReadAllVisits')),
    pasteNote:     (fn('mlsNotePaster') ? overlayPasteNote : (bind('runPasteNote') || bind('mlsRunPasteNote'))),
    readIdentity:  (fn('mlsReadChartIdentity') ? overlayReadIdentity : (bind('readChartIdentity'))),
    backendNote:   (fn('callBackend') ? overlayBackendNote : (bind('callBackendNote') || bind('mlsCallBackendNote'))),
    signSave:      (fn('mlsAthenaSignSave') ? overlaySignSave : null),
    validateCodes: bind('validateCodesViaApp'),
    saveVisits:    bind('saveVisitsViaApp'),
    findTab:       (fn('mlsPickEmrTab') ? overlayFindEmrTab : (bind('findAthenaTab') || bind('mlsFindAthenaTab'))),
    focusTab:      overlayFocusTab,
    // robust patient-gate helpers (reuse the conservative mlsMatchPatients logic)
    namesMatch:    matcher ? function (a, b) { try { var m = matcher({ name: a }, { name: b }); return !!(m && m.nameMatch === true); } catch (e) { return false; } } : bind('namesMatch'),
    dobsMatch:     matcher ? function (a, b) { try { var m = matcher({ dob: a }, { dob: b }); return !!(m && m.dobMatch === true); } catch (e) { return false; } } : bind('dobsMatch'),
    normDob:       function (s) { var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || '')); if (!m) return ''; var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y; return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + y; },
    // Backend transcription of ONE complete §35 segment, using the doctor's JWT
    // (pulled from the mlsscribe tab, exactly as the rest of the worker does).
    // Contract: (Uint8Array|number[] bytes, mime) -> Promise<{ text }>.
    // The backend transcription endpoint is UNCHANGED - each segment is already
    // a complete, decodable file (the §35 fix). If this internal isn't present,
    // recording degrades HONESTLY to type-only (no fabricated transcript).
    transcribeSegment: bind('transcribeSegmentViaBackend') || bind('uploadAudioSegment') || bind('mlsTranscribeSegment')
  };

  // ---- v1.40 Sign & Save adapter: USER-INITIATED verified signing -----------
  // Re-reads the OPEN chart identity, re-checks it against the identity LOCKED at
  // "Go" (name + DOB), and only then injects the Sign & Save driver. Reports
  // signed:true ONLY when Athena confirmed the save/sign. Never autonomous.
  function overlaySignSave(opts) {
    opts = opts || {};
    var driver = fn('mlsAthenaSignSave');
    if (!driver || typeof chrome.scripting === 'undefined') return Promise.resolve({ error: 'sign-unavailable', message: 'Sign path unavailable - reload the extension.' });
    return overlayFindEmrTab().then(function (tab) {
      if (!tab) return { error: 'no-tab', message: 'No signed-in athenaOne tab is open.' };
      var mode = (opts.probe ? 'probe' : 'sign');
      return chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: driver, args: [mode] })
        .then(function (res) {
          var rs = (res || []).map(function (x) { return x && x.result; }).filter(Boolean);
          if (mode === 'probe') {
            var ready = rs.find(function (r) { return r && r.ready; }) || rs[0] || { ok: false };
            return ready;
          }
          var signed = rs.find(function (r) { return r && r.signed === true; });
          if (signed) return { ok: true, signed: true, observed: signed.observed };
          var clicked = rs.find(function (r) { return r && r.ok && r.reason === 'unconfirmed'; });
          if (clicked) return { ok: true, signed: false, reason: 'unconfirmed', message: clicked.msg };
          var none = rs.find(function (r) { return r && r.reason === 'no-control'; }) || rs[0] || { ok: false };
          return { ok: false, signed: false, reason: (none && none.reason) || 'sign-failed', message: (none && none.msg) || 'Could not complete Sign & Save in Athena.' };
        })
        .catch(function (e) { return { error: 'sign-exec-failed', message: String((e && e.message) || e) }; });
    });
  }

  function progress(tabId, message, kind) {
    try { chrome.tabs.sendMessage(tabId, { type: 'MLS_OVL_PROGRESS', message: message, kind: kind || 'run' }); } catch (e) {}
  }

  // ---- conservative identity match (reuse ext fns; safe fallback) ---------
  function identitiesMatch(a, b) {
    if (!a || !b || !a.name || !b.name) return false;
    var nameOk = ext.namesMatch ? !!ext.namesMatch(a.name, b.name)
      : norm(a.name) === norm(b.name);
    var da = ext.normDob ? ext.normDob(a.dob) : (a.dob || '');
    var db = ext.normDob ? ext.normDob(b.dob) : (b.dob || '');
    var dobOk = ext.dobsMatch ? !!ext.dobsMatch(a.dob, b.dob) : (!!da && da === db);
    return nameOk && dobOk;                 // require BOTH name and DOB
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // ====================================================================== //
  //  NEW: coding-field driver (flag-gated). Types each code into Athena's   //
  //  Diagnoses/Orders/E-M pickers, selects the EXACT-code row, verifies it  //
  //  in the committed list. NEVER picks a near match. NEVER saves/signs.    //
  //  Returns {ok, added:[], missed:[{code,reason}]}. Real selectors are     //
  //  tuned in the one live athenaOne pass; until then the flag is OFF and   //
  //  callers receive {deferred:true}.                                       //
  // ====================================================================== //
  function writeCodes(tabId, codes) {
    // OFF until one real athenaOne selector-tuning pass (04_codes_writeback.md).
    if (!FLAGS.codesDriver) {
      return Promise.resolve({ deferred: true, added: [], missed: [] });
    }
    var driver = (typeof self !== 'undefined' && self.__mlsCodesDriver) ? self.__mlsCodesDriver : null;
    if (!driver || !ext.findTab || typeof chrome.scripting === 'undefined') {
      return Promise.resolve({ deferred: true, added: [], missed: [] });
    }
    var tab = ext.findTab();
    if (!tab) return Promise.resolve({ deferred: true, added: [], missed: [] });

    // serialize the content-scored page-side driver into the Athena frames,
    // one bounded phase at a time: find -> type -> (wait) -> select -> verify.
    function phase(p, step) {
      return chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: driver.codesPickerDriverFn,
        args: [step.kind, step.code, p]
      }).then(function (res) {
        // pick the first frame that returned a definitive result
        var hit = (res || []).map(function (x) { return x && x.result; })
                             .filter(function (r) { return r && (r.ok || r.reason); });
        return hit.find(function (r) { return r.ok; }) || hit[0] || { ok: false, reason: 'no-frame' };
      }).catch(function () { return { ok: false, reason: 'exec-failed' }; });
    }
    function driveOne(step) {
      return phase('type', step).then(function (t) {
        if (!t.ok) return t;
        return new Promise(function (r) { setTimeout(r, 2500); })       // bounded wait for the result list
          .then(function () { return phase('select', step); })
          .then(function (s) { if (!s.ok) return s; return phase('verify', step); });
      });
    }
    return driver.runCodes(codes, driveOne, function (m, k) { progress(tabId, m, k); });
  }

  // ====================================================================== //
  //  Intent router                                                         //
  // ====================================================================== //
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('MLS_OVL_') !== 0) return;
    var tabId = sender && sender.tab && sender.tab.id;

    // ---------- STATUS (read-only, passive) ----------
    if (msg.type === 'MLS_OVL_STATUS') {
      Promise.resolve()
        .then(function () { return ext.findTab ? ext.findTab() : null; })
        .then(function (tab) {
          // passive: do NOT focus/navigate; just report what we can see
          var athenaOpen = !!tab;
          var patientOpen = false;
          // identity read is read-only; only attempt if a tab exists
          var idP = (athenaOpen && ext.readIdentity) ? ext.readIdentity(tab.id).catch(function () { return null; }) : Promise.resolve(null);
          return idP.then(function (id) {
            patientOpen = !!(id && id.name);
            if (patientOpen || !athenaOpen || typeof chrome.scripting === 'undefined') {
              sendResponse({ athenaOpen: athenaOpen, mlsApp: true, patientOpen: patientOpen, identity: (id && id.name) ? { name: id.name, dob: id.dob || '' } : null });
              return;
            }
            /* v1.50 fallback: identity text can be unreadable in some athena skins, but an
               open encounter/chart URL in ANY frame still proves a patient is open (fixes
               the overlay being stuck on "Open a patient in Athena"). */
            chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: function () { try { return location.href; } catch (e) { return ''; } } })
              .then(function (res) {
                var urls = (res || []).map(function (r) { return (r && r.result) || ''; });
                var open2 = urls.some(function (u) { return /\/encounter\/\d+|\/chart\/|patientid=\d+|\/patient\//i.test(u || ''); });
                sendResponse({ athenaOpen: athenaOpen, mlsApp: true, patientOpen: open2, identity: null });
              })
              .catch(function () { sendResponse({ athenaOpen: athenaOpen, mlsApp: true, patientOpen: false, identity: null }); });
          });
        })
        .catch(function () { sendResponse({ error: 'status-failed' }); });
      return true;
    }

    // ---------- GO: read patient + all visits (READ-ONLY) ----------
    if (msg.type === 'MLS_OVL_GO') {
      if (!ext.readAllVisits) { sendResponse({ ok: false, message: 'Reader unavailable — reload the extension.' }); return true; }
      progress(tabId, 'Reading the open patient…', 'run');
      /* v1.51 STALE-BINDING FIX: verify a patient chart is ACTUALLY open before
         reading/locking — a GO with no chart open used to bind whatever the
         reader last saw (live repro: locked "Corbin M." while Katz was wanted). */
      Promise.resolve()
        .then(function () { return ext.findTab ? ext.findTab() : null; })
        .then(function (tab) {
          if (!tab) return { block: 'No athenaOne tab is open — open athenaOne first.' };
          return (ext.readIdentity ? ext.readIdentity(tab.id).catch(function () { return null; }) : Promise.resolve(null))
            .then(function (id) {
              if (!id || !id.name) return { block: 'No patient chart is open in athenaOne — open the patient, then press Go. Nothing was read.' };
              return { ok: true };
            });
        })
        .then(function (pre) {
          if (pre && pre.block) { sendResponse({ ok: false, message: pre.block }); return; }
          return ext.readAllVisits({ onProgress: function (m) { progress(tabId, m, 'run'); } })
            .then(function (r) {
              r = r || {};
              if (!r.ok) { sendResponse({ ok: false, message: r.message || "Couldn't read this chart's visits — nothing saved." }); return; }
              if (tabId != null && r.identity) sess(tabId).lockedIdentity = r.identity;   // LOCK identity
              if (ext.saveVisits) { try { ext.saveVisits(r.visits, r.identity); } catch (e) {} }   // persist via app brain
              sendResponse({ ok: true, identity: r.identity, visits: r.visits, savedCount: (r.visits || []).length });
            });
        })
        .catch(function () { sendResponse({ ok: false, message: "Couldn't read this chart's visits — nothing saved." }); });
      return true;
    }

    // ---------- RECORD start/stop (reuses §35 recorder via offscreen doc) ----------
    if (msg.type === 'MLS_OVL_RECORD_START') { recordingTabId = tabId; startRecorder(tabId).then(function (r) { sendResponse(r); }); return true; }
    if (msg.type === 'MLS_OVL_RECORD_STOP')  { stopRecorder(tabId).then(function (r) { recordingTabId = null; sendResponse(r); }); return true; }

    // ---------- GENERATE: note + codes (backend, reuse) ----------
    if (msg.type === 'MLS_OVL_GENERATE') {
      if (!ext.backendNote) { sendResponse({ error: 'backend-unavailable', message: 'Note service unavailable.' }); return true; }
      progress(tabId, 'Writing the note…', 'run');
      ext.backendNote({ transcript: msg.transcript, typedNotes: msg.typedNotes })
        .then(function (note) {
          progress(tabId, 'Checking codes against your code sheet…', 'run');
          var vP = ext.validateCodes ? ext.validateCodes(note).catch(function () { return null; }) : Promise.resolve(null);
          return vP.then(function (codes) { sendResponse({ note: note, codes: codes }); });
        })
        .catch(function () { sendResponse({ error: 'generate-failed', message: "Couldn't generate the note." }); });
      return true;
    }

    // ---------- WRITEBACK: gate -> note paste -> codes (NEVER signs) ----------
    if (msg.type === 'MLS_OVL_WRITEBACK') {
      doWriteBack(tabId, msg).then(function (r) { sendResponse(r); })
        .catch(function () { sendResponse({ error: 'write-failed', message: 'Write failed.' }); });
      return true;
    }

    // ---------- FOCUS Athena tab (brings forward, clicks NOTHING) ----------
    if (msg.type === 'MLS_OVL_FOCUS_ATHENA') {
      Promise.resolve(ext.findTab ? ext.findTab() : null).then(function (tab) {
        if (tab && ext.focusTab) ext.focusTab(tab.id);
        sendResponse({ ok: true });
      });
      return true;
    }

    // ---------- SIGN & SAVE (USER-INITIATED ONLY; gated; verified) ----------
    // Fires ONLY because the doctor clicked "Sign and Save" in MLS (the overlay
    // "written" state, or the mlsscribe.com bridge) - never autonomously. Flow:
    // re-confirm the patient gate (name + DOB) against the identity locked at Go
    // OR the MLS active patient; (optionally) write the verified note; then
    // auto-click Athena's Sign & Save and report "signed" ONLY if Athena confirms.
    if (msg.type === 'MLS_OVL_SIGNSAVE') {
      if (msg.userInitiated !== true) { sendResponse({ error: 'not-user-initiated', message: 'Sign & Save must be triggered by your own click.' }); return true; }
      if (!ext.signSave) { sendResponse({ error: 'sign-unavailable', message: 'Sign path unavailable - reload the extension.' }); return true; }

      // Read the MLS active patient (read-only) as a gate target fallback.
      function readMlsActivePatient() {
        var reader = (typeof self.mlsReadActivePatient === 'function') ? self.mlsReadActivePatient : null;
        if (!reader || typeof chrome.scripting === 'undefined') return Promise.resolve(null);
        return chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] })
          .then(function (mt) {
            mt = mt || []; mt.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
            var i = 0;
            function next() {
              if (i >= mt.length) return null;
              var t = mt[i++];
              return chrome.scripting.executeScript({ target: { tabId: t.id }, func: reader })
                .then(function (r) { var v = r && r[0] && r[0].result; if (v && (v.name || v.dob)) return v; return next(); })
                .catch(function () { return next(); });
            }
            return next();
          }).catch(function () { return null; });
      }

      var locked = (tabId != null && sessions[tabId]) ? sessions[tabId].lockedIdentity : null;
      var targetP = locked ? Promise.resolve(locked)
        : (msg.mlsIdentity && msg.mlsIdentity.name) ? Promise.resolve(msg.mlsIdentity)
        : readMlsActivePatient();

      Promise.all([targetP, Promise.resolve(ext.findTab ? ext.findTab() : null)])
        .then(function (pair) {
          var target = pair[0], tab = pair[1];
          var readP = (tab && ext.readIdentity) ? ext.readIdentity(tab.id) : Promise.resolve(null);
          return readP.then(function (chartId) {
            var confident = target && target.name && chartId && chartId.name && identitiesMatch(target, chartId);
            if (!confident) {
              progress(tabId, '⛔ Could not confirm this is the right patient - did NOT write or sign.', 'fail');
              return { blocked: true, signed: false, mlsIdentity: target || null, chartIdentity: chartId || null,
                       message: 'Patient gate failed (name + DOB) - refusing to sign this chart.' };
            }
            // optional verified note write FIRST (gate already satisfied)
            var writeP = (msg.note != null && ext.pasteNote)
              ? (progress(tabId, '✓ Confirmed - writing the note before signing...', 'ok'), ext.pasteNote({ note: msg.note }))
              : Promise.resolve(null);
            return writeP.then(function (wr) {
              if (wr && wr.error) return { error: wr.error, signed: false, message: wr.error + ' - did NOT sign.' };
              progress(tabId, 'Signing & saving in athenaOne...', 'run');
              return ext.signSave({ probe: !!msg.probe }).then(function (r) {
                r = r || {};
                if (r.signed === true) progress(tabId, '✓ Athena confirmed - signed & saved.', 'ok');
                else progress(tabId, (r.message || 'Could not confirm signing - check Athena before relying on it.'), 'warn');
                if (wr && wr.sections) r.note = { sections: wr.sections };
                return r;
              });
            });
          });
        })
        .then(function (r) { sendResponse(r || { error: 'sign-failed', signed: false }); })
        .catch(function (e) { sendResponse({ error: 'sign-failed', signed: false, message: String((e && e.message) || e) }); });
      return true;
    }
  });

  // ====================================================================== //
  //  Increment 3 — offscreen §35 segmented recorder orchestration.          //
  //  BG owns the offscreen doc lifecycle + the authenticated upload; the    //
  //  offscreen doc owns mic capture + segmentation. Transcript text only    //
  //  ever comes from a REAL backend response (no fabrication).              //
  // ====================================================================== //
  var OFFSCREEN_PATH = 'offscreen.html';

  function hasOffscreenApi() {
    return (typeof chrome !== 'undefined' && chrome.offscreen &&
            typeof chrome.offscreen.createDocument === 'function');
  }

  function ensureOffscreen() {
    if (!hasOffscreenApi()) return Promise.resolve(false);
    // Avoid creating a second offscreen document if one already exists.
    var checkP;
    if (chrome.runtime.getContexts) {
      checkP = chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
        .then(function (ctxs) { return ctxs && ctxs.length > 0; })
        .catch(function () { return false; });
    } else if (typeof chrome.offscreen.hasDocument === 'function') {
      checkP = chrome.offscreen.hasDocument().catch(function () { return false; });
    } else {
      checkP = Promise.resolve(false);
    }
    return checkP.then(function (exists) {
      if (exists) return true;
      return chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Record the visit audio in complete §35 segments for backend transcription.'
      }).then(function () { return true; }).catch(function () { return false; });
    });
  }

  function closeOffscreen() {
    if (!hasOffscreenApi() || typeof chrome.offscreen.closeDocument !== 'function') return Promise.resolve();
    return chrome.offscreen.closeDocument().catch(function () {});
  }

  function startRecorder(tabId) {
    if (!hasOffscreenApi()) {
      // Honest degrade: no offscreen support -> type-only. Never fake a transcript.
      progress(tabId, 'Mic capture unavailable here — type your note instead.', 'warn');
      return Promise.resolve({ ok: false, reason: 'no-offscreen', typeOnly: true });
    }
    return ensureOffscreen().then(function (ready) {
      if (!ready) {
        progress(tabId, 'Couldn’t start the recorder — type your note instead.', 'warn');
        return { ok: false, reason: 'offscreen-failed', typeOnly: true };
      }
      progress(tabId, 'Recording… (talk through the visit)', 'run');
      return new Promise(function (resolve) {
        try {
          chrome.runtime.sendMessage({ type: 'MLS_OFFSCREEN_START' }, function (r) {
            if (chrome.runtime.lastError || !r || r.ok === false) {
              var reason = (r && r.reason) || 'recorder-start-failed';
              progress(tabId, reason === 'mic-denied'
                ? 'Microphone blocked — allow mic access or type your note.'
                : 'Couldn’t start the mic — type your note instead.', 'warn');
              resolve({ ok: false, reason: reason, typeOnly: true });
            } else { resolve({ ok: true }); }
          });
        } catch (e) { resolve({ ok: false, reason: 'recorder-start-failed', typeOnly: true }); }
      });
    });
  }

  function stopRecorder(tabId) {
    if (!hasOffscreenApi()) return Promise.resolve({ ok: true });
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: 'MLS_OFFSCREEN_STOP' }, function (r) {
          // close the doc to release the mic; ignore errors
          closeOffscreen().then(function () { resolve(r || { ok: true }); });
        });
      } catch (e) { closeOffscreen().then(function () { resolve({ ok: true }); }); }
    });
  }

  // ---- segments + errors coming back FROM the offscreen recorder ----------
  //      (a second listener; returns nothing for non-offscreen messages so it
  //       never interferes with the intent router above — the §136 convention)
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.from !== 'mls-offscreen') return;

    if (msg.type === 'MLS_OFFSCREEN_SEGMENT') {
      var tabId = recordingTabId;
      if (!ext.transcribeSegment) {
        // HONEST: capture works but the backend uploader isn't bound here.
        // Do NOT invent text. Tell the doctor once and let them type.
        if (tabId != null) progress(tabId, 'Captured audio, but transcription isn’t wired in this build — type your note.', 'warn');
        return; // no async response needed
      }
      Promise.resolve(ext.transcribeSegment(msg.bytes, msg.mime))
        .then(function (res) {
          var text = res && (res.text || res.transcript || '');
          if (text && tabId != null) {
            chrome.tabs.sendMessage(tabId, { type: 'MLS_OVL_TRANSCRIPT', text: text, append: true, seq: msg.seq });
          }
        })
        .catch(function () {
          if (tabId != null) progress(tabId, 'A segment didn’t transcribe — kept recording.', 'warn');
        });
      return;
    }

    if (msg.type === 'MLS_OFFSCREEN_ERROR') {
      var tid = recordingTabId;
      if (tid != null) {
        var human = msg.reason === 'mic-denied'
          ? 'Microphone blocked — allow mic access or type your note.'
          : 'Mic problem — type your note instead.';
        progress(tid, human, 'warn');
        try { chrome.tabs.sendMessage(tid, { type: 'MLS_OVL_RECORD_ERROR', reason: msg.reason }); } catch (e) {}
      }
      return;
    }
  });

  function doWriteBack(tabId, msg) {
    if (!ext.pasteNote) return Promise.resolve({ error: 'paste-unavailable', message: 'Write path unavailable — reload the extension.' });
    progress(tabId, 'Confirming this is the right chart…', 'run');

    // ---- HARD patient-match gate (re-read current chart vs lockedIdentity) ----
    var locked = (tabId != null && sessions[tabId]) ? sessions[tabId].lockedIdentity : null;
    // read the CURRENT open chart identity fresh from the Athena tab (read-only)
    return Promise.resolve(ext.findTab ? ext.findTab() : null).then(function (tab) {
      var readP = (tab && ext.readIdentity) ? ext.readIdentity(tab.id) : Promise.resolve(null);
      return readP.then(function (chartId) {
        var matchTarget = locked || null;
        var confident = matchTarget && chartId && identitiesMatch(matchTarget, chartId);
        if (!confident && !msg.override) {
          return { blocked: true, mlsIdentity: matchTarget, chartIdentity: chartId };
        }
        // ---- write the NOTE (segmented router handled inside pasteNote) ----
        progress(tabId, '✓ Confirmed — writing the note…', 'ok');
        return ext.pasteNote({ note: msg.note }).then(function (resp) {
          resp = resp || {};
          var sections = (resp.sections) ? resp.sections : [{
            section: resp.chosenSection || resp.into || 'note field',
            confirmed: !!resp.confirmed
          }];
          if (resp.error) return { error: resp.error, message: resp.error };
          // ---- write CODES (flag-gated) ----
          return writeCodes(tabId, msg.codes || (msg.note && { icd10: msg.note.icd10, cpt: msg.note.cpt, em_level: msg.note.em_level }))
            .then(function (codeRes) {
              return { note: { sections: sections }, codes: codeRes };
            });
        });
      });
    });
  }
})();


/* =========================================================================
 * MLS Assist v1.50 — version reporting + patient picker  (APPEND-ONLY)
 *  A) Version reporting: POSTs {component:'mls-assist', version} to the MLS
 *     backend /api/versions/report on install/startup + every 12h, and the
 *     content bridge announces the version to the MLS app page — powers the
 *     app's update-reminder row in Settings -> MLS Controls. Fire-and-forget;
 *     tolerates the endpoint not existing yet (older backend) silently.
 *  B) Patient picker: MLS_OVL_LIST_PATIENTS reads TODAY'S schedule from the
 *     open mlsscribe.com tab (no PHI leaves the browser); MLS_OVL_OPEN_PATIENT
 *     clicks/searches that patient open in athenaOne (NAVIGATION ONLY — the
 *     open helper only clicks patient-name elements / types into a patient
 *     SEARCH box, never Save/Sign/order controls) and reports the open chart's
 *     identity so the overlay can confirm the right patient is up.
 * ========================================================================= */
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.runtime) return;
  if (self.__mlsV150Installed) return; self.__mlsV150Installed = true;
  var VER = ''; try { VER = chrome.runtime.getManifest().version; } catch (e) {}

  function reportVersion() {
    try {
      fetch('https://scrivara-backend.onrender.com/api/versions/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: 'mls-assist', version: VER })
      }).catch(function () {});
    } catch (e) {}
  }
  try { chrome.runtime.onStartup.addListener(reportVersion); } catch (e) {}
  try { chrome.runtime.onInstalled.addListener(reportVersion); } catch (e) {}
  try {
    if (chrome.alarms) {
      chrome.alarms.create('mlsVersionReport', { periodInMinutes: 720 });
      chrome.alarms.onAlarm.addListener(function (a) { if (a && a.name === 'mlsVersionReport') reportVersion(); });
    }
  } catch (e) {}
  reportVersion();

  /* ---- injected: read TODAY'S patients from the MLS app tab (read-only) ---- */
  function mlsListTodayFn() {
    try {
      var out = [], seen = {};
      var d = new Date(); var td = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      var A = window._calAppts || [];
      A.forEach(function (a) {
        if (!a) return;
        var dt = String(a.date || a.appt_date || '');
        if (dt.indexOf(td) < 0) return;
        var nm = String(a.patient || a.name || '').trim();
        if (!nm || seen[nm.toLowerCase()]) return; seen[nm.toLowerCase()] = 1;
        out.push({ name: nm.slice(0, 60), time: String(a.time || '').slice(0, 12), prov: String(a.provider || '').slice(0, 40) });
      });
      return out.slice(0, 120);
    } catch (e) { return []; }
  }

  /* ---- injected: open ONE patient by name (same rules as the chart-request
     opener: click a visible patient-name element, else type into a patient
     SEARCH box — never a numeric/ID field, never action buttons) ---- */
  function mlsV150OpenFn(name) {
    try {
      var parts = name.toLowerCase().replace(/[^a-z\s,]/g, '').split(/[\s,]+/).filter(Boolean);
      if (!parts.length) return 'no';
      var last = parts[parts.length - 1], first = parts[0];
      var els = Array.prototype.slice.call(document.querySelectorAll('a,button,[role="link"],[role="button"],[onclick],td,li,span,div'));
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var t = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (t && t.length < 70 && t.indexOf(last) >= 0 && (parts.length < 2 || t.indexOf(first) >= 0)) {
          var r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { el.click(); return 'clicked'; }
        }
      }
      var inputs = Array.prototype.slice.call(document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])'));
      for (var k = 0; k < inputs.length; k++) {
        var inp = inputs[k];
        var h = ((inp.placeholder || '') + ' ' + (inp.name || '') + ' ' + (inp.getAttribute('aria-label') || '') + ' ' + (inp.id || '')).toLowerCase();
        var rr = inp.getBoundingClientRect(); var tp = (inp.type || '').toLowerCase();
        if (rr.width <= 0 || rr.height <= 0) continue;
        if (tp === 'number' || tp === 'tel' || tp === 'date' || tp === 'email' || tp === 'password') continue;
        if ((inp.inputMode || '').toLowerCase() === 'numeric') continue;
        if (/patient\s*id|patientid|\bid\b|\bmrn\b|chart\s*(id|no|num)|\bnpi\b|account|claim|invoice|\bnumber\b|ssn|\bdob\b/.test(h)) continue;
        if (!/search|name|find|look\s*up|lookup|filter|patient/.test(h)) continue;
        inp.focus(); inp.value = name;
        inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
        ['keydown', 'keypress', 'keyup'].forEach(function (tpe) { inp.dispatchEvent(new KeyboardEvent(tpe, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); });
        return 'searched';
      }
      return 'no';
    } catch (e) { return 'no'; }
  }

  function readIdent(tabId) {
    if (typeof mlsReadChartIdentity !== 'function' || typeof chrome.scripting === 'undefined') return Promise.resolve(null);
    return chrome.scripting.executeScript({ target: { tabId: tabId, allFrames: true }, func: mlsReadChartIdentity })
      .then(function (res) {
        var best = mlsBestIdentityFrom(res); /* v1.59: banner-preferred */
        return best ? { name: best.name, dob: best.dob || '' } : null;
      }).catch(function () { return null; });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'MLS_OVL_LIST_PATIENTS') {
      (async function () {
        try {
          var all = await chrome.tabs.query({});
          var app = all.find(function (t) { return /mlsscribe\.com/i.test(t.url || ''); });
          if (!app) return sendResponse({ ok: false, error: 'Open mlsscribe.com in another tab first (it holds today\u2019s schedule).' });
          var res = await chrome.scripting.executeScript({ target: { tabId: app.id }, func: mlsListTodayFn });
          var list = (res && res[0] && res[0].result) || [];
          sendResponse({ ok: true, patients: list, version: VER });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }

    if (msg.type === 'MLS_OVL_OPEN_PATIENT') {
      (async function () {
        try {
          var all = await chrome.tabs.query({});
          var tab = (typeof mlsPickAthenaTab === 'function') ? (await mlsPickAthenaTab(all, { athenaOnly: true })) : ((typeof mlsPickEmrTab === 'function') ? mlsPickEmrTab(all) : null);
          if (!tab || !/athena/i.test(((tab.url || '') + ' ' + (tab.title || '')))) return sendResponse({ ok: false, error: 'No signed-in athenaOne tab is open.' });
          var want = String(msg.name || '').trim().slice(0, 80);
          if (!want) return sendResponse({ ok: false, error: 'No patient name given.' });
          var opened = false, statuses = [];
          try { var r1 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsV150OpenFn, args: [want] }); statuses = (r1 || []).map(function (r) { return r && r.result; }); } catch (e) {}
          if (statuses.indexOf('clicked') >= 0) { opened = true; await new Promise(function (r) { setTimeout(r, 1900); }); }
          else if (statuses.indexOf('searched') >= 0) {
            await new Promise(function (r) { setTimeout(r, 2600); });
            try { var r2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: mlsV150OpenFn, args: [want] }); if ((r2 || []).map(function (r) { return r && r.result; }).indexOf('clicked') >= 0) { opened = true; await new Promise(function (r) { setTimeout(r, 1900); }); } } catch (e) {}
          }
          var ident = await readIdent(tab.id);
          sendResponse({ ok: true, opened: opened, identity: ident, version: VER });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
      })();
      return true;
    }
  });
})();


/* =========================================================================
 * MLS Assist v1.89 - mlsDismissNavMenuFn (injected; allFrames, ISOLATED world
 * is fine: synthetic Escape/click events cross worlds, and NO link/control is
 * ever clicked). This user's athenaOne can sit with the Calendar top-nav
 * dropdown OPEN, overlaying the surfaces the schedule scan reads (the menu
 * panel renders on demand and does NOT live in the globalnav frame's DOM, so
 * allFrames is required to reach whichever frame hosts it).
 * GATE (wf_6 tightening): acts ONLY when a VISIBLE overlaying element matching
 * [role=menu] / [class*=menu] with computed position fixed/absolute and
 * height > 60 exists in THIS frame - bare [aria-expanded=true] is NOT used
 * (it matches healthy drawers/accordions), so frames without a real menu
 * overlay are strictly zero-touch (no stray Escape into chart-frame modals).
 * ACTION: Escape keydown/keyup on the document, then ONE neutral click at the
 * (1,1) corner ONLY if elementFromPoint(1,1) is document.body/documentElement
 * (wf_6: never click anything that could be a control).
 * FUTURE NOTE (wf_4/wf_6): if this is ever escalated to clicking the Calendar
 * menu TOGGLE itself (a nav control / javascript:-style link), that click
 * MUST move to world:'MAIN' per the documented isolated-world rule - the
 * current isolated-world dispatch is acceptable ONLY because nothing
 * interactive is clicked. */
function mlsDismissNavMenuFn() {
  try {
    var out = { dismissed: false, seen: 0, clicked: false, frame: '' };
    try { out.frame = String(location.pathname || '').slice(0, 80); } catch (e0) {}
    function vis(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e) { return false; } }
    var cands = [];
    try { cands = [].slice.call(document.querySelectorAll('[role=menu],[class*="menu" i]')); } catch (e1) {}
    var open = [];
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i];
      if (!vis(el)) continue;
      try {
        var s = getComputedStyle(el);
        if (s.position !== 'fixed' && s.position !== 'absolute') continue; /* must OVERLAY content */
        if (el.getBoundingClientRect().height <= 60) continue;             /* real panel, not a chip */
        open.push(el);
      } catch (e2) {}
    }
    out.seen = open.length;
    if (!open.length) return out; /* nothing to do - zero-touch */
    var ko = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
    ['keydown', 'keyup'].forEach(function (t) {
      try { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent(t, ko)); } catch (e3) {}
      try { document.dispatchEvent(new KeyboardEvent(t, ko)); } catch (e4) {}
    });
    /* neutral click at the (1,1) corner - ONLY onto bare body/documentElement */
    try {
      var tgt = document.elementFromPoint(1, 1);
      if (tgt === document.body || tgt === document.documentElement) {
        var o = { bubbles: true, cancelable: true, view: window, clientX: 1, clientY: 1 };
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) {
          try { tgt.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e5) {}
        });
        out.clicked = true;
      }
    } catch (e6) {}
    out.dismissed = true;
    return out;
  } catch (e) { return { dismissed: false, seen: -1, error: String((e && e.message) || e).slice(0, 80) }; }
}


/* =========================================================================
 * MLS Assist v1.89 - mlsReadVisitsPaneDriverFn (injected, world:'MAIN', TOP
 * frame of the athena tab). READ-ONLY reader of the open chart's left-rail
 * "Visits" pane ("Visits and Cases", light DOM - live-verified 07-10).
 * Self-contained: chrome.scripting serializes this function alone, so NO
 * background helper (mlsExecTO / mlsBestIdentityFrom / nmm...) exists in here.
 * CONSTRAINTS (live-verified):
 *  - The caller MUST wrap this injection in an mlsExecTO-style timeout (the
 *    athenaOne renderer can freeze 45+ seconds after heavy interactions) and
 *    must never assume the tab is responsive.
 *  - The athenaOne tab should be VISIBLE/FOREGROUND for the duration of the
 *    read: the sleep() waits below ride the page's setTimeout, and Chrome
 *    clamps hidden-tab timers (>=1s, down to 1/min under intensive
 *    throttling) - a long-hidden tab can eat the whole budget in waits.
 *    All waits are ABSOLUTE Date.now() deadlines, never counted ticks.
 *  - Identity is verified IN HERE, on the live DOM, immediately before the
 *    rail click - refuses honestly on any mismatch; never reads first.
 *  - Clicks ONLY the left-rail item labeled exactly "Visits" (BAD-blocklist
 *    guarded). Never Save/Sign/orders/check-in. The click NAVIGATES the chart
 *    frame to the Visits pane: app-side ordering must be ReadChart FIRST,
 *    ReadVisits second, per patient.
 *  - If the rail item cannot be found: ok:false reason 'no-rail'. There is NO
 *    silent fallback to reading whatever surface is on screen (wf_6). */
async function mlsReadVisitsPaneDriverFn(name, dob, athenaId) {
  try {
    var T0 = Date.now();
    var CAP = 40;
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    if (!String(name || '').trim()) return { ok: false, reason: 'no-patient', error: 'mlsReadVisitsPaneDriverFn requires the requested patient name - refusing an un-gated visits read.' };
    /* ---- normalizers (inline; no background helpers exist in an injected fn) */
    function nrmName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function nameMatch(a, b) {
      var ta = nrmName(a).split(' ').filter(function (x) { return x.length > 1; });
      var tb = nrmName(b).split(' ').filter(function (x) { return x.length > 1; });
      var o = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
      return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
    }
    function nrmDob(s) {
      var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || ''));
      if (!m) return '';
      /* v1.89 (wf_4): DYNAMIC 2-digit-year pivot - anything "after next year"
         is 19xx. Never ship the hardcoded >26 pivot again. */
      var pivot = (new Date().getFullYear() % 100) + 1;
      var y = m[3].length === 2 ? ((Number(m[3]) > pivot ? '19' : '20') + m[3]) : m[3];
      var mo = Number(m[1]), dy = Number(m[2]);
      if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
      return mo + '/' + dy + '/' + y;
    }
    /* ---- 1) locate the chart content frame: deepest big same-origin frame,
       skipping nav/status/results frames (same recursive walk as the proven
       mlsFindPatientOpenDriverFn, + findpatient.esp in SKIP). Also remember
       every accessible frame for the identity scan. */
    var SKIP = /globalnav|statusbar|stm\.esp|schedulenavclose|coordinator\/enterprise|blank\.html|findpatient\.esp/i;
    var JUNK = /letter|athenatext|communicat|\bfax|printer|documentviewer|clinicaldocument|inbox|messag/i;
    var best = null, allFr = [];
    (function walk(w, depth) {
      if (depth > 6) return;
      for (var i = 0; i < w.frames.length; i++) {
        var f = w.frames[i];
        try {
          void f.document;
          allFr.push(f);
          var p = String(f.location.pathname || '');
          var el = f.frameElement; var r = el ? el.getBoundingClientRect() : null;
          var area = r ? (r.width * r.height) : 0;
          if (!SKIP.test(p) && area > 150000) {
            if (!best || depth > best.depth || (depth === best.depth && area > best.area)) best = { w: f, depth: depth, area: area };
          }
          walk(f, depth + 1);
        } catch (e) {}
      }
    })(window, 0);
    var W = (best && best.w) || window;
    /* ---- 2) compact shadow-aware LINE collector (inline; same walker shape
       as the live-proven mlsReadChartIdentityShadow: block tags break lines,
       <slot>s flatten, open shadow roots descend; bounded so a struggling
       renderer is never asked for more than ~8000 text nodes per document). */
    function docLines(doc, cap) {
      var BLOCK = /^(div|p|li|tr|td|th|section|header|footer|h[1-6]|ul|ol|table|article|aside|nav|form|fieldset|dl|dt|dd|pre|address|hr|br)$/;
      var out = { items: [], n: 0 };
      function coll(root, depth) {
        if (depth > 25 || out.n > cap) return;
        var kids = root.childNodes || [];
        for (var k = 0; k < kids.length; k++) {
          if (out.n > cap) return;
          var n = kids[k];
          if (n.nodeType === 3) { var s = String(n.nodeValue || '').replace(/\s+/g, ' ').trim(); if (s) { out.items.push({ t: s }); out.n++; } }
          else if (n.nodeType === 1) {
            var tag = (n.tagName || '').toLowerCase();
            if (tag === 'script' || tag === 'style') continue;
            var isB = BLOCK.test(tag);
            if (isB) { out.items.push({ nl: 1 }); out.n++; }
            try {
              if (tag === 'slot' && n.assignedNodes) {
                var an = n.assignedNodes({ flatten: true });
                for (var a = 0; a < an.length; a++) {
                  if (an[a].nodeType === 3) { var s2 = String(an[a].nodeValue || '').replace(/\s+/g, ' ').trim(); if (s2) { out.items.push({ t: s2 }); out.n++; } }
                  else if (an[a].nodeType === 1) coll(an[a], depth + 1);
                }
              } else if (n.shadowRoot) coll(n.shadowRoot, depth + 1);
              else coll(n, depth + 1);
            } catch (e) {}
            if (isB) { out.items.push({ nl: 1 }); out.n++; }
          }
        }
      }
      try { coll(doc.body || doc, 0); } catch (e) {}
      var lines = [], cur = [];
      for (var x = 0; x < out.items.length; x++) {
        if (out.items[x].nl) { if (cur.length) { lines.push(cur.join(' ')); cur = []; } }
        else cur.push(out.items[x].t);
      }
      if (cur.length) lines.push(cur.join(' '));
      return lines;
    }
    /* ---- 3) inline identity from the banner CHIP line ("20yo M | 03-24-2006
       | #7833832" - live-verified: the #id equals the stable athena patient id,
       NOT an encounter number). Name = SMALLEST join of the 1-3 lines rendered
       directly above the chip (kk=1..3 - never glue a badge line onto the
       name; wf_1 finding 3 fixed here, not replicated). */
    function identFrom(lines) {
      var AGE_CHIP = /\b(\d{1,3})\s*(?:yo|y\/o|yrs?\.?|years?\s*old)\b/i;
      var BARE_DATE = /\b([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{4})\b/;
      var MRN_HASH = /#\s?(\d{4,})/;
      var STOP1 = /^(please|the|new|find|create|search|no|today|welcome|inbox|schedule|calendar|department|provider|patient|results|appointment|encounter|billing|orders|messages|close|camera|panel|visits|history)$/i;
      var PROVCRED = /^(MD|DO|PA|PAC|NP|CRNA|APRN|DPM|DDS|DMD|RN|CRNP|FNP|DNP|PHD|MBBS|OD|MSN|LPN|CNM|DC|DPT|DR|PHYS|PT)$/i;
      function okName(cand) {
        if (!cand || cand.length < 4 || cand.length > 60) return '';
        if (!/^([A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*){1,3})$/.test(cand)) return '';
        var toks = cand.replace(/,/g, ' ').split(/\s+/);
        for (var q = 0; q < toks.length; q++) { if (STOP1.test(toks[q])) return ''; }
        if (PROVCRED.test(toks[toks.length - 1].replace(/[.\-]/g, ''))) return '';
        if (/^DR\.?$/i.test(toks[0])) return '';
        return cand;
      }
      /* v1.89.4/.5 (live, Bob Dunne): the banner can render MULTIPLE chip
         instances with different name shapes above them - the collapsed strip
         gives "DUNNE"/"Legal:"/"Robert DUNNE" while the expanded drawer gives
         "Bob Dunne Legal: Robert Dunne". Returning only the FIRST parse
         ("Robert DUNNE") made the gate refuse the roster name ("Bob Dunne").
         So: collect candidates from EVERY chip instance, split "X Legal: Y"
         combos into BOTH names, strip parens into tokens ("Robert (Bob)"),
         and return them ALL - the caller matches any. */
      var out = [];
      for (var i = 0; i < lines.length && out.length < 8; i++) {
        if (!AGE_CHIP.test(lines[i]) || !BARE_DATE.test(lines[i])) continue;
        var bd = BARE_DATE.exec(lines[i]);
        var mh = MRN_HASH.exec(lines[i]);
        var dobS = ('0' + bd[1]).slice(-2) + '/' + ('0' + bd[2]).slice(-2) + '/' + bd[3];
        var mrnS = (mh && mh[1]) || '';
        for (var kk = 1; kk <= 3; kk++) {
          if (i - kk < 0) break;
          var joined = lines.slice(i - kk, i).join(' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
          var parts = joined.split(/legal\s*:/i).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
          for (var pp = 0; pp < parts.length; pp++) {
            var nm = okName(parts[pp]);
            if (nm && !out.some(function (o) { return o.name === nm; })) out.push({ name: nm, dob: dobS, mrn: mrnS });
          }
        }
      }
      return out;
    }
    /* scan order: chart content frame first, then other non-skip non-junk
       frames (junk letters/messaging frames can carry OTHER patients' names
       and are excluded entirely), then the top document. First hit wins. */
    var scanWs = [];
    if (best && best.w) scanWs.push(best.w);
    for (var fi = 0; fi < allFr.length && scanWs.length < 9; fi++) {
      try {
        var pth = String(allFr[fi].location.pathname || '');
        if (allFr[fi] !== W && !SKIP.test(pth) && !JUNK.test(pth)) scanWs.push(allFr[fi]);
      } catch (eS) {}
    }
    scanWs.push(window);
    /* v1.89.2/.3 (live fixes, same day): the airlock banner renders ASYNC
       after a fresh findpatient open - a single-shot scan raced it and refused
       'unverified' (live: Bob backfill), and a naive retry then locked onto
       the PREVIOUS chart's stale banner and refused 'wrong-chart' while Bob's
       banner was still rendering. So: keep scanning until the identity
       MATCHES the requested patient or the deadline passes; only then refuse
       (wrong-chart if a stable different banner, unverified if none). The
       caller's 90s mlsExecTO still bounds the whole driver. */
    var ident = null, lastSeen = null, nameOnlyHit = null;
    var identDeadline = Date.now() + 15000;
    var wantDobPre = nrmDob(dob);
    while (!ident && Date.now() < identDeadline) {
      for (var si = 0; si < scanWs.length && !ident; si++) {
        var candList = [];
        try { candList = identFrom(docLines(scanWs[si].document, 8000)) || []; } catch (eI) {}
        for (var ci = 0; ci < candList.length; ci++) {
          if (candList[ci] && candList[ci].name) {
            if (!lastSeen) lastSeen = candList[ci];
            if (nameMatch(candList[ci].name, String(name || ''))) {
              /* v2.02 de-race: banner surfaces can expose SEVERAL name-matching
                 chip candidates whose nearby dates differ (appointment dates on
                 the briefing surface vs the real DOB chip - live: two corrected-
                 DOB patients refused wrong-dob on backfill opens then passed on
                 settled reads). When the caller supplied a DOB, keep scanning
                 until a candidate CONFIRMS it; a name-only candidate is kept as
                 the fallback and still refuses honestly at the deadline. Never
                 laxer: the accepted candidate must match name AND requested DOB. */
              if (!wantDobPre) { ident = candList[ci]; break; }
              if (nrmDob(candList[ci].dob) === wantDobPre) { ident = candList[ci]; break; }
              if (!nameOnlyHit) nameOnlyHit = candList[ci];
            }
          }
        }
      }
      if (!ident) await sleep(800);
    }
    if (!ident && nameOnlyHit) ident = nameOnlyHit; /* deadline: fall back to the name-matched candidate -> the DOB gate below refuses honestly */
    /* ---- 4) IDENTITY GATE - refuse honestly BEFORE any click/read ---------- */
    if (!ident || !ident.name) {
      if (lastSeen && lastSeen.name) return { ok: false, reason: 'wrong-chart', chartName: lastSeen.name, chartDob: lastSeen.dob || '', chartMrn: lastSeen.mrn || '', error: 'The open athenaOne chart is ' + lastSeen.name + ', not ' + name + '. No visits were read.' };
      return { ok: false, reason: 'unverified', error: 'No readable patient identity (banner chip) on the open athenaOne chart - refusing to read visits. Nothing was captured.' };
    }
    var wantDob = nrmDob(dob);
    if (wantDob) {
      var haveDob = nrmDob(ident.dob);
      /* wf_6: a requested DOB that the chart cannot confirm is a REFUSAL, not
         a pass-through - reason 'unverified-dob'. */
      if (!haveDob) return { ok: false, reason: 'unverified-dob', chartName: ident.name, chartMrn: ident.mrn || '', error: 'A DOB was requested but the open chart shows no readable DOB - refusing to read visits without full verification.' };
      if (haveDob !== wantDob) return { ok: false, reason: 'wrong-dob', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The open chart\'s DOB (' + ident.dob + ') does not match the requested DOB (' + dob + '). No visits were read.' };
    }
    var wantId = String(athenaId || '').replace(/\D/g, '');
    if (wantId && ident.mrn && String(ident.mrn).replace(/\D/g, '') !== wantId) return { ok: false, reason: 'wrong-id', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The open chart\'s patient ID #' + ident.mrn + ' does not match the requested #' + wantId + '. No visits were read.' };
    /* ---- 5) click the left-rail "Visits" item (small text label under the
       icon; live-observed rail: Find, Allergies, Problems, Meds, Vaccines,
       Vitals, Results, Visits, History, Quality, Care). Shadow-aware element
       scan, exact-label match, left-edge constraint, BAD-blocklist guard. */
    function visEl(el) { try { var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var win = (el.ownerDocument && el.ownerDocument.defaultView) || W; var s = win.getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e) { return false; } }
    var BAD = /save|sign|order|delete|discard|remove|void|submit|bill|charge|check\s*-?\s*(in|out)|prescri|refill|dispense|cancel|log\s*out/i;
    function realClick(el) {
      try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
      try {
        var win = (el.ownerDocument && el.ownerDocument.defaultView) || W;
        var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        var o = { bubbles: true, cancelable: true, view: win, clientX: x, clientY: y };
        ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (tp) {
          try { el.dispatchEvent(new win[tp.indexOf('pointer') === 0 ? 'PointerEvent' : 'MouseEvent'](tp, o)); } catch (e2) {}
        });
      } catch (e3) {}
      try { el.click(); } catch (e4) {}
    }
    function allEls(doc, cap) {
      var out = [], stack = [doc];
      while (stack.length && out.length < cap) {
        var root = stack.pop();
        var els; try { els = root.querySelectorAll('*'); } catch (e) { continue; }
        for (var i = 0; i < els.length && out.length < cap; i++) {
          out.push(els[i]);
          try { if (els[i].shadowRoot) stack.push(els[i].shadowRoot); } catch (e2) {}
        }
      }
      return out;
    }
    function clickRailLabel(label) {
      var re = new RegExp('^' + label + '$', 'i');
      var els = allEls(W.document, 14000);
      var cands = [];
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var own = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        var aria = String((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) || '').replace(/\s+/g, ' ').trim();
        var hit = (own && own.length <= 12 && re.test(own)) || (aria && aria.length <= 24 && re.test(aria));
        if (!hit) continue;
        if (!visEl(el)) continue;
        var r = el.getBoundingClientRect();
        if (r.left > 260) continue; /* left rail only - never a same-named control elsewhere */
        var tgt = (el.closest && el.closest('a,button,[role=button],[role=tab],[role=link],[role=menuitem],li')) || el.parentElement || el;
        var lbl = String((tgt.getAttribute && (tgt.getAttribute('aria-label') || tgt.getAttribute('title'))) || tgt.textContent || '').replace(/\s+/g, ' ').trim();
        if (BAD.test(lbl)) continue; /* read-only nav guard */
        cands.push({ el: tgt, left: r.left, top: r.top });
      }
      if (!cands.length) return false;
      cands.sort(function (a, b) { return (a.left - b.left) || (a.top - b.top); });
      realClick(cands[0].el);
      return true;
    }
    /* v1.89.1 (live find, same day): the rail labels are CSS ::after content
       (content:"Visits") on li.chart-tabs__list-item - they do NOT exist in
       textContent, so the text scan alone can never match. The DOM-stable
       selector is the data attribute: [data-chart-section-id="visits"]
       (siblings live-enumerated: browse/allergies/problems/medications/
       vaccine/vitals/results/visits/history/p4p/careManagement). Attribute
       selector FIRST; the text scan stays as a fallback for older layouts. */
    function clickRailByAttr(sectionId) {
      try {
        var lis = W.document.querySelectorAll('li.chart-tabs__list-item[data-chart-section-id="' + sectionId + '"],[data-chart-section-id="' + sectionId + '"]');
        for (var qi = 0; qi < lis.length; qi++) {
          var li = lis[qi];
          if (!visEl(li)) continue;
          var lbl = String((li.getAttribute && (li.getAttribute('aria-label') || li.getAttribute('data-icon-caption'))) || li.textContent || '').replace(/\s+/g, ' ').trim();
          if (BAD.test(lbl)) continue;
          realClick(li);
          return true;
        }
      } catch (eA) {}
      return false;
    }
    var clicked = false;
    var railDeadline = Date.now() + 12000; /* absolute deadline, short sleeps */
    while (!clicked && Date.now() < railDeadline) {
      clicked = clickRailByAttr('visits') || clickRailLabel('Visits');
      if (!clicked) await sleep(700);
    }
    if (!clicked) return { ok: false, reason: 'no-rail', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The left-rail "Visits" item was not found on the open chart. Refusing to read any other surface as if it were the verified Visits pane (wf_6) - nothing was captured.' };
    /* ---- 6) wait for the "Visits and Cases" pane (light DOM, live-verified:
       fully readable via innerText). Absolute deadline + short sleeps. */
    var paneDeadline = Date.now() + 16000, paneSeen = false, paneText = '';
    while (Date.now() < paneDeadline) {
      await sleep(500);
      try { paneText = String((W.document.body && W.document.body.innerText) || ''); } catch (eP) { paneText = ''; }
      if (/visits\s+and\s+cases/i.test(paneText)) { paneSeen = true; break; }
    }
    /* v2.01 (live root-cause, clientsummary layout): the section-id LI click can
       land on athena's top-nav Calendar menu instead of the Visits pane. Recover
       ONCE: Escape closes whatever menu opened, then re-run the click ladder and
       wait again - only then refuse. Never a manual-follow fallback. */
    if (!paneSeen) {
      try { W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (eEsc) {}
      await sleep(600);
      try { clickRailByAttr('visits') || clickRailLabel('Visits'); } catch (eRe) {}
      var paneDeadline2 = Date.now() + 10000;
      while (Date.now() < paneDeadline2) {
        await sleep(500);
        try { paneText = String((W.document.body && W.document.body.innerText) || ''); } catch (eP2) { paneText = ''; }
        if (/visits\s+and\s+cases/i.test(paneText)) { paneSeen = true; break; }
      }
    }
    if (!paneSeen) return { ok: false, reason: 'no-pane', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'Clicked the Visits rail item but the "Visits and Cases" pane did not render (retried once with menu-close recovery). No visits were read.' };
    await sleep(1200); /* let the entry list hydrate */
    /* ---- 7) the SHOW control - ONLY the trivially safe case: a real <select>
       carrying an "All Events" option that is not yet selected (native value
       setter + change event, then settle). Custom dropdowns / button menus are
       SKIPPED - opening those is a click risk for zero gain. */
    try {
      var sels = W.document.querySelectorAll('select');
      for (var sx = 0; sx < sels.length; sx++) {
        var opts = sels[sx].options || [];
        var allIx = -1;
        for (var ox = 0; ox < opts.length; ox++) { if (/all\s*events/i.test(String(opts[ox].text || ''))) { allIx = ox; break; } }
        if (allIx < 0) continue;
        if (sels[sx].selectedIndex === allIx) break; /* already showing everything */
        var proto = W.HTMLSelectElement && W.HTMLSelectElement.prototype;
        var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(sels[sx], opts[allIx].value); else sels[sx].selectedIndex = allIx;
        try { sels[sx].dispatchEvent(new W.Event('change', { bubbles: true })); } catch (eC) {}
        await sleep(1500);
        break;
      }
    } catch (eShow) {}
    /* ---- 8) parse entries. Live-verified row shape (two lines):
         "<type>"
         "<MM-DD-YYYY>, <Provider>, <Cred>, <Specialty>"
       e.g. "order group" / "07-03-2026, Matthew Schaeffer, MD, Phys. Med. & Rehab."
       Month/day RANGE-VALIDATED (wf_6). Output date is YYYY-MM-DD. */
    /* v2.02: PT/booking rows render the date with a TIME before the comma
       ("08-31-2026 4:00 PM, Michael A Wilson, DPT" - live: Scott Lake's pane is
       25 such rows and the old date-comma regex parsed ZERO of them, so the
       honesty invariant refused the whole chart). Optional time is allowed. */
    var ROW = /^([01]?\d)-([0-3]?\d)-(\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:[AP]\.?M\.?)?)?\s*,\s*(.+)$/i;
    var ROW2 = /^([01]?\d)[\/\.]([0-3]?\d)[\/\.](\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:[AP]\.?M\.?)?)?\s*,\s*(.+)$/i; /* slash/dot tolerance */
    var CRED = /^(MD|DO|PA-?C?|NP|CRNA|APRN|DPM|DDS|DMD|RN|CRNP|FNP|DNP|OD|CNM|DC|DPT)\.?$/i;
    var HDR = /visits\s+and\s+cases|arrange\s+by|^show\s*:|all\s*events/i;
    var _td = new Date();
    var TODAY_ISO = _td.getFullYear() + '-' + ('0' + (_td.getMonth() + 1)).slice(-2) + '-' + ('0' + _td.getDate()).slice(-2); /* v2.04: rows dated after today are bookings, not history */
    function parseEntries() {
      var lines2 = [];
      try { lines2 = String((W.document.body && W.document.body.innerText) || '').split(/\n+/).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean); } catch (eL) {}
      var visits = [], seen = {}, upcomingSkipped = 0;
      for (var li = 0; li < lines2.length && visits.length < CAP; li++) {
        var m2 = ROW.exec(lines2[li]) || ROW2.exec(lines2[li]);
        if (!m2) continue;
        var mo2 = Number(m2[1]), dy2 = Number(m2[2]), yr2 = Number(m2[3]);
        if (mo2 < 1 || mo2 > 12 || dy2 < 1 || dy2 > 31 || yr2 < 1900 || yr2 > 2100) continue; /* wf_6 range validation */
        var dateIso = m2[3] + '-' + ('0' + mo2).slice(-2) + '-' + ('0' + dy2).slice(-2);
        var rest = m2[4].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        var provider = rest[0] || '';
        if (rest[1] && CRED.test(rest[1])) provider += ', ' + rest[1];
        var type = '';
        if (li > 0) {
          var above = lines2[li - 1];
          if (above && above.length <= 60 && !ROW.test(above) && !ROW2.test(above) && !HDR.test(above)) type = above;
        }
        /* v2.02: "(upcoming)" rows are FUTURE bookings, not visit history - never
           file them (the old regex excluded them by accident; the time-tolerant
           one would let them through). They still count as PARSED rows so a pane
           of only-upcoming events is an honest empty, not a parser failure.
           v2.04: not every future booking carries the literal "(upcoming)"
           marker (live: 22 marker-less future rows filed across 7 patients -
           16 of them Scott Lake's scheduled PT sessions, plus "f/u ..."
           follow-ups). A future DATE is the authoritative signal: any row dated
           after today is a booking, not history - skip it and count it. Same-
           day rows are kept (today's completed visit is history). */
        if (/\(upcoming\)/i.test(type) || /\(upcoming\)/i.test(lines2[li]) || dateIso > TODAY_ISO) { upcomingSkipped++; continue; }
        var textHead = ((type ? type + ' | ' : '') + lines2[li]).slice(0, 220);
        /* dedup key = date + full textHead. KNOWN LIMITATION (documented in the
           bridge contract): two byte-identical same-day rows collapse to one. */
        var key = dateIso + '::' + textHead.toLowerCase();
        if (seen[key]) continue;
        seen[key] = 1;
        visits.push({ date: dateIso, type: type, provider: provider, textHead: textHead });
      }
      var ptext = '';
      try { ptext = String((W.document.body && W.document.body.innerText) || ''); } catch (eT) {}
      var declN = null;
      var mAll = /all\s*events\s*\(\s*(\d+)\s*\)/i.exec(ptext) || /\(\s*(\d+)\s*\)\s*events?\b/i.exec(ptext) || /\b(\d+)\s+events?\b/i.exec(ptext);
      if (mAll) declN = Number(mAll[1]);
      /* v2.02: a pane of ONLY "(upcoming)" bookings is an honest empty HISTORY
         (we parsed the rows, they're all future) - not a parser failure. */
      var explicitEmpty = declN === 0 || upcomingSkipped > 0 || /no\s+(visits|events|cases)\s*(recorded|found|yet|\.|$)/i.test(ptext) || /there\s+are\s+no\s+/i.test(ptext);
      return { visits: visits, upcomingSkipped: upcomingSkipped, declN: declN, explicitEmpty: explicitEmpty };
    }
    /* v2.03 SETTLE-POLL (live root-cause of the FIRST-TRY 'rows-not-parsed'
       refusals that surfaced as the app's "That Athena pull didn't work"
       banner): the "Visits and Cases" heading renders BEFORE the row list
       hydrates, and the old fixed 1200ms sleep + single-shot parse raced it
       (live: Patricia Dorak refused 1-2 tries, then parsed 29 rows on a later
       attempt). Poll the parse until rows appear OR an explicit zero/upcoming-
       only signal does; once something parses, require TWO consecutive equal
       row counts (a partially-hydrated list must never be filed as complete).
       Only after the row list genuinely never appears within the deadline does
       the retryable refusal fire. */
    var parsed = parseEntries();
    var parseDeadline = Date.now() + 14000;
    while (Date.now() < parseDeadline) {
      if (parsed.visits.length || parsed.explicitEmpty) {
        await sleep(800);
        var again = parseEntries();
        if (again.visits.length === parsed.visits.length) { parsed = again; break; }
        parsed = again;
        continue;
      }
      await sleep(700);
      parsed = parseEntries();
    }
    /* v2.01 HONESTY INVARIANT (live root-cause of 'no-visits-on-chart' on charts
       that visibly HAD visits): the clientsummary layout carries a "Visits and
       Cases" summary CARD whose heading satisfies paneSeen with zero readable
       rows - returning ok-empty there silently loses the patient's history.
       The REAL pane declares its count ("All Events (N)" / "N Events"). ok-empty
       is allowed ONLY with an explicit zero signal; a declared N>0 with zero
       parsed rows - or no count signal at all - is a retryable refusal. */
    if (!parsed.visits.length && !parsed.explicitEmpty) {
      return { ok: false, reason: 'rows-not-parsed', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', declaredEvents: (parsed.declN == null ? -1 : parsed.declN), error: 'The Visits and Cases heading rendered but no visit rows could be read within the settle deadline' + (parsed.declN != null ? ' (the pane declares ' + parsed.declN + ' events)' : ' (no event count found - probably the summary card, not the real pane)') + '. Refusing to report an empty history that may not be empty - retry will re-open the pane.' };
    }
    var visits = parsed.visits;
    return {
      ok: true, visits: visits, via: 'visits-pane',
      chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '',
      frame: (function () { try { return String(W.location.pathname || '').slice(0, 120); } catch (e) { return ''; } })(),
      ms: Date.now() - T0
    };
  } catch (e) { return { ok: false, reason: 'driver-error', error: String((e && e.message) || e).slice(0, 200) }; }
}


/* =========================================================================
 * MLS Assist v1.89 - mlsAppReadVisits handler. Registered in the same IIFE +
 * onMessage style as the existing v1.36 search-open block. Read-only.
 * Flow: single-flight gate -> athena-tab pick (mlsAssistChartIdentity's
 * scoring) -> ONE MAIN-world top-frame injection of mlsReadVisitsPaneDriverFn
 * (which does its own identity gate on the live DOM) under a 90s mlsExecTO
 * budget. Responds {ok, visits, reason, ...}. Never reloads the tab itself -
 * a timeout is an honest fail (the app's existing pull loop owns recovery). */
(function () {
  'use strict';
  try { if (self.__mlsV189VisitsWired) return; self.__mlsV189VisitsWired = 1; } catch (e) {}

  /* wf_9 single-flight: ONE visits read at a time, extension-wide. An
     overlapping app call (e.g. a retry firing while the first injection is
     still running) is rejected honestly with reason 'busy' - parallel
     MAIN-world drivers on the same athena tab are a proven freeze-maker.
     Module scope: resets only when the MV3 service worker restarts, which
     also kills the in-flight injection, so the flag can never wedge. */
  var __mlsVisitsBusy = 0;

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'mlsAppReadVisitsRequest') return; /* not ours - other listeners handle it */
    (async function () {
      var V = '';
      try { V = chrome.runtime.getManifest().version; } catch (eV) {}
      if (__mlsVisitsBusy) {
        sendResponse({ ok: false, reason: 'busy', version: V, error: 'A visits read is already running - one at a time. Retry after the current read finishes.' });
        return;
      }
      __mlsVisitsBusy = 1;
      try {
        var want = String(msg.patient || '').trim();
        if (!want) {
          sendResponse({ ok: false, reason: 'no-patient', version: V, error: 'mlsAppReadVisits requires the requested patient (name, ideally + DOB and athenaId) - refusing an un-gated visits read.' });
          return;
        }
        /* v1.90: unified verified athena-tab pick (heartbeat + reachability ping;
           identity/login hosts excluded — raw athenanet.athenahealth.com only). */
        var all = await chrome.tabs.query({});
        var tab = await mlsPickAthenaTab(all, { athenaOnly: true });
        if (!tab) {
          sendResponse({ ok: false, reason: 'no-athena-tab', version: V, error: 'Open your signed-in athenaOne in another tab, then try again.' });
          return;
        }
        /* v2.03 (live root-cause of the first-try 'rows-not-parsed' refusals
           behind the "That Athena pull didn't work" banner): the Visits pane's
           ROW LIST hydrates on the page's own rendering loop, which Chrome
           deprioritizes in a HIDDEN tab - the heading renders but the rows
           appear late or never (live: Dorak's pane declared "All Events (31)"
           with zero rows for minutes while hidden, then read fine once
           visible). The driver's contract has always required the athena tab
           VISIBLE for the read - enforce it HERE the way every pull engine
           does: foreground athena for the read; note focus debt ONLY when we
           took focus ourselves, so the guardian returns the doctor to MLS
           afterwards and a user already parked on athena is never yanked. */
        /* v2.9.5 quiet pull: the visible-for-read contract is now met by the
           work strip (visible, never focused) instead of stealing focus. */
        try { await (self.__mlsQpEnsure ? self.__mlsQpEnsure(tab, sender && sender.tab && sender.tab.id) : null); } catch (eF) {}
        /* 90s TOTAL budget (live: the athenaOne renderer can freeze 45+s after
           heavy interactions - every new injected driver must be mlsExecTO-
           wrapped and must not assume the tab is responsive). Identity gating
           happens INSIDE the driver, on the live DOM, so a mid-read chart swap
           cannot slip past a stale background-side check - and this handler
           adds NO extra mlsReadChartIdentity/mlsShadowIdentityTry passes on
           top (no finding-8 scan pile-up from this caller). */
        var fx = await mlsExecTO({ target: { tabId: tab.id }, world: 'MAIN', args: [want, String(msg.dob || ''), String(msg.athenaId || '')], func: mlsReadVisitsPaneDriverFn }, 90000);
        if (fx.timeout) {
          /* v1.91 (§2.9): a 90s hang means the renderer is frozen — recover it NOW
             (reload + Continue-clear) so the caller's retry finds a live tab,
             instead of leaving every subsequent open/read to fail on the frozen one. */
          try { await mlsRecoverAthenaTab(tab.id); } catch (eRc) {}
          sendResponse({ ok: false, reason: 'visits-timeout', version: V, error: 'athenaOne did not finish the visits read within 90s (renderer was frozen; the tab has been reloaded and recovered). Pull again.' });
          return;
        }
        if (fx.err) {
          sendResponse({ ok: false, reason: 'inject-failed', version: V, error: 'Could not inject the visits reader: ' + fx.err });
          return;
        }
        var r = fx && fx.r && fx.r[0] && fx.r[0].result;
        if (!r) {
          sendResponse({ ok: false, reason: 'no-result', version: V, error: 'The visits reader returned nothing (frame navigated mid-read?). Nothing was captured.' });
          return;
        }
        if (!r.ok) {
          sendResponse({ ok: false, reason: r.reason || 'visits-unreadable', version: V, error: r.error || 'The Visits and Cases pane could not be read.', chartName: r.chartName || '', chartDob: r.chartDob || '', chartMrn: r.chartMrn || '' });
          return;
        }
        try { __mlsReadsSinceReload++; } catch (eC) {} /* v1.91 (§2.9): visits reads are heavy too — count them toward the freeze-guard boundary */
        sendResponse({ ok: true, visits: (r.visits || []).slice(0, 40), via: r.via || 'visits-pane', frame: r.frame || '', chartName: r.chartName || '', chartDob: r.chartDob || '', chartMrn: r.chartMrn || '', ms: r.ms || 0, version: V });
      } catch (e) {
        sendResponse({ ok: false, reason: 'error', version: V, error: String((e && e.message) || e) });
      } finally {
        __mlsVisitsBusy = 0;
      }
    })();
    return true;
  });
})();



/* =========================================================================
 * MLS Assist v2.05 - UNIFIED WRITE DRIVER (mlsUnifiedWriteDriverFn) +
 * mlsAppWriteV2Request handler.
 *
 * WHY: the legacy write path (mlsFieldScanner/mlsNotePaster) runs as PER-FRAME
 * injections with light-DOM attribute selectors - on the current chart History
 * layout the visible note editor is a shadow-DOM contenteditable (and
 * [contenteditable=""]/["true"] also misses "plaintext-only"), so the scan
 * honestly found nothing and nothing was ever written. This driver uses the
 * visits reader's proven architecture instead: ONE top-frame world:'MAIN'
 * injection that walks frames AND shadow roots itself. It is fully generic -
 * no patient, provider, practice or department is hardcoded anywhere; the
 * identity gate reads the live banner, the section map is regex-by-meaning.
 *
 * HARD SAFETY (enforced at the LOWEST level, not just the caller):
 *  - Section keys orders/rx/prescriptions/billing/charges/referrals/pt/imaging
 *    are FORCED to target-only inside the driver: the best matching field is
 *    located and REPORTED (label/heading/frame) but never focused, never
 *    written, never submitted - regardless of what any caller passes.
 *  - The driver never dispatches events on anything but the chosen note field
 *    itself. No button is ever clicked except the read-only left-rail History
 *    nav item and a section's NOTE toggle (both navigation affordances,
 *    guarded by the same BAD-blocklist as the visits reader).
 *  - Identity gate runs IN here on the live DOM before any interaction:
 *    requested name (+DOB +athenaId when given) must match the banner chip or
 *    the driver refuses with the exact reason. Unsigned content only - the
 *    clinician reviews and signs in athenaOne.
 * ========================================================================= */
async function mlsUnifiedWriteDriverFn(name, dob, athenaId, sections) {
  try {
    var T0 = Date.now();
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    if (!String(name || '').trim()) return { ok: false, reason: 'no-patient', error: 'mlsUnifiedWriteDriverFn requires the patient name - refusing an un-gated write.' };
    if (!sections || !sections.length) return { ok: false, reason: 'no-sections', error: 'No sections supplied.' };
    var NEVER_EXECUTE = /^(orders?|rx|prescriptions?|billing|charges?|referrals?|pt|pt.?orders?|imaging|imaging.?orders?)$/i;
    /* ---- normalizers (identical to the proven visits driver) -------------- */
    function nrmName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
    function nameMatch(a, b) {
      var ta = nrmName(a).split(' ').filter(function (x) { return x.length > 1; });
      var tb = nrmName(b).split(' ').filter(function (x) { return x.length > 1; });
      var o = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
      return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
    }
    function nrmDob(s) {
      var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(String(s || ''));
      if (!m) return '';
      var pivot = (new Date().getFullYear() % 100) + 1;
      var y = m[3].length === 2 ? ((Number(m[3]) > pivot ? '19' : '20') + m[3]) : m[3];
      var mo = Number(m[1]), dy = Number(m[2]);
      if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
      return mo + '/' + dy + '/' + y;
    }
    /* ---- frame walk (same SKIP/JUNK as the visits driver) ------------------ */
    var SKIP = /globalnav|statusbar|stm\.esp|schedulenavclose|coordinator\/enterprise|blank\.html|findpatient\.esp/i;
    var JUNK = /letter|athenatext|communicat|\bfax|printer|documentviewer|clinicaldocument|inbox|messag/i;
    var best = null, allFr = [];
    (function walk(w, depth) {
      if (depth > 6) return;
      for (var i = 0; i < w.frames.length; i++) {
        var f = w.frames[i];
        try {
          void f.document;
          allFr.push(f);
          var p = String(f.location.pathname || '');
          var el = f.frameElement; var r = el ? el.getBoundingClientRect() : null;
          var area = r ? (r.width * r.height) : 0;
          if (!SKIP.test(p) && area > 150000) {
            if (!best || depth > best.depth || (depth === best.depth && area > best.area)) best = { w: f, depth: depth, area: area };
          }
          walk(f, depth + 1);
        } catch (e) {}
      }
    })(window, 0);
    var W = (best && best.w) || window;
    /* ---- shadow-aware line collector + chip identity (proven verbatim) ---- */
    function docLines(doc, cap) {
      var BLOCK = /^(div|p|li|tr|td|th|section|header|footer|h[1-6]|ul|ol|table|article|aside|nav|form|fieldset|dl|dt|dd|pre|address|hr|br)$/;
      var out = { items: [], n: 0 };
      function coll(root, depth) {
        if (depth > 25 || out.n > cap) return;
        var kids = root.childNodes || [];
        for (var k = 0; k < kids.length; k++) {
          if (out.n > cap) return;
          var n = kids[k];
          if (n.nodeType === 3) { var s = String(n.nodeValue || '').replace(/\s+/g, ' ').trim(); if (s) { out.items.push({ t: s }); out.n++; } }
          else if (n.nodeType === 1) {
            var tag = (n.tagName || '').toLowerCase();
            if (tag === 'script' || tag === 'style') continue;
            var isB = BLOCK.test(tag);
            if (isB) { out.items.push({ nl: 1 }); out.n++; }
            try {
              if (tag === 'slot' && n.assignedNodes) {
                var an = n.assignedNodes({ flatten: true });
                for (var a = 0; a < an.length; a++) {
                  if (an[a].nodeType === 3) { var s2 = String(an[a].nodeValue || '').replace(/\s+/g, ' ').trim(); if (s2) { out.items.push({ t: s2 }); out.n++; } }
                  else if (an[a].nodeType === 1) coll(an[a], depth + 1);
                }
              } else if (n.shadowRoot) coll(n.shadowRoot, depth + 1);
              else coll(n, depth + 1);
            } catch (e) {}
            if (isB) { out.items.push({ nl: 1 }); out.n++; }
          }
        }
      }
      try { coll(doc.body || doc, 0); } catch (e) {}
      var lines = [], cur = [];
      for (var x = 0; x < out.items.length; x++) {
        if (out.items[x].nl) { if (cur.length) { lines.push(cur.join(' ')); cur = []; } }
        else cur.push(out.items[x].t);
      }
      if (cur.length) lines.push(cur.join(' '));
      return lines;
    }
    function identFrom(lines) {
      var AGE_CHIP = /\b(\d{1,3})\s*(?:yo|y\/o|yrs?\.?|years?\s*old)\b/i;
      var BARE_DATE = /\b([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{4})\b/;
      var MRN_HASH = /#\s?(\d{4,})/;
      var STOP1 = /^(please|the|new|find|create|search|no|today|welcome|inbox|schedule|calendar|department|provider|patient|results|appointment|encounter|billing|orders|messages|close|camera|panel|visits|history)$/i;
      var PROVCRED = /^(MD|DO|PA|PAC|NP|CRNA|APRN|DPM|DDS|DMD|RN|CRNP|FNP|DNP|PHD|MBBS|OD|MSN|LPN|CNM|DC|DPT|DR|PHYS|PT)$/i;
      function okName(cand) {
        if (!cand || cand.length < 4 || cand.length > 60) return '';
        if (!/^([A-Z][A-Za-z'\-\.]*(?:\s+[A-Z][A-Za-z'\-\.]*){1,3})$/.test(cand)) return '';
        var toks = cand.replace(/,/g, ' ').split(/\s+/);
        for (var q = 0; q < toks.length; q++) { if (STOP1.test(toks[q])) return ''; }
        if (PROVCRED.test(toks[toks.length - 1].replace(/[.\-]/g, ''))) return '';
        if (/^DR\.?$/i.test(toks[0])) return '';
        return cand;
      }
      var out = [];
      for (var i = 0; i < lines.length && out.length < 8; i++) {
        if (!AGE_CHIP.test(lines[i]) || !BARE_DATE.test(lines[i])) continue;
        var bd = BARE_DATE.exec(lines[i]);
        var mh = MRN_HASH.exec(lines[i]);
        var dobS = ('0' + bd[1]).slice(-2) + '/' + ('0' + bd[2]).slice(-2) + '/' + bd[3];
        var mrnS = (mh && mh[1]) || '';
        for (var kk = 1; kk <= 3; kk++) {
          if (i - kk < 0) break;
          var joined = lines.slice(i - kk, i).join(' ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
          var parts = joined.split(/legal\s*:/i).map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
          for (var pp = 0; pp < parts.length; pp++) {
            var nm = okName(parts[pp]);
            if (nm && !out.some(function (o) { return o.name === nm; })) out.push({ name: nm, dob: dobS, mrn: mrnS });
          }
        }
      }
      return out;
    }
    var scanWs = [];
    if (best && best.w) scanWs.push(best.w);
    for (var fi = 0; fi < allFr.length && scanWs.length < 9; fi++) {
      try {
        var pth = String(allFr[fi].location.pathname || '');
        if (allFr[fi] !== W && !SKIP.test(pth) && !JUNK.test(pth)) scanWs.push(allFr[fi]);
      } catch (eS) {}
    }
    scanWs.push(window);
    var ident = null, identWin = null, lastSeen = null, nameOnlyHit = null, nameOnlyWin = null;
    var identDeadline = Date.now() + 15000;
    var wantDobPre = nrmDob(dob);
    while (!ident && Date.now() < identDeadline) {
      for (var si = 0; si < scanWs.length && !ident; si++) {
        var candList = [];
        try { candList = identFrom(docLines(scanWs[si].document, 8000)) || []; } catch (eI) {}
        for (var ci = 0; ci < candList.length; ci++) {
          if (candList[ci] && candList[ci].name) {
            if (!lastSeen) lastSeen = candList[ci];
            if (nameMatch(candList[ci].name, String(name || ''))) {
              if (!wantDobPre) { ident = candList[ci]; identWin = scanWs[si]; break; }
              if (nrmDob(candList[ci].dob) === wantDobPre) { ident = candList[ci]; identWin = scanWs[si]; break; }
              if (!nameOnlyHit) { nameOnlyHit = candList[ci]; nameOnlyWin = scanWs[si]; }
            }
          }
        }
      }
      if (!ident) await sleep(800);
    }
    if (!ident && nameOnlyHit) { ident = nameOnlyHit; identWin = nameOnlyWin; }
    if (!ident || !ident.name) {
      if (lastSeen && lastSeen.name) return { ok: false, reason: 'wrong-chart', chartName: lastSeen.name, chartDob: lastSeen.dob || '', chartMrn: lastSeen.mrn || '', error: 'The open athenaOne chart is ' + lastSeen.name + ', not ' + name + '. Nothing was written.' };
      return { ok: false, reason: 'unverified', error: 'No readable patient identity on the open athenaOne chart - refusing to write. Nothing was touched.' };
    }
    var wantDob = nrmDob(dob);
    if (wantDob) {
      var haveDob = nrmDob(ident.dob);
      if (!haveDob) return { ok: false, reason: 'unverified-dob', chartName: ident.name, chartMrn: ident.mrn || '', error: 'A DOB was requested but the open chart shows no readable DOB - refusing to write.' };
      if (haveDob !== wantDob) return { ok: false, reason: 'wrong-dob', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The open chart DOB (' + ident.dob + ') does not match the requested DOB (' + dob + '). Nothing was written.' };
    }
    var wantId = String(athenaId || '').replace(/\D/g, '');
    if (wantId && ident.mrn && String(ident.mrn).replace(/\D/g, '') !== wantId) return { ok: false, reason: 'wrong-id', chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', error: 'The open chart patient ID #' + ident.mrn + ' does not match the requested #' + wantId + '. Nothing was written.' };
    /* ---- v2.9.2 WRITE-TARGET SAFETY (owner: never write to the wrong place) -
       The identity gate above can legitimately match a patient whose chart is
       loaded in a BACKGROUND frame (e.g. the app opener pre-loaded it) while a
       generic field picker would choose a VISIBLE editable that sits in a
       DIFFERENT frame (a dashboard note box). That is "right patient verified,
       WRONG place." So before ANY write we require the chosen field to be
       either (a) inside the exact frame where we confirmed this patient, or
       (b) inside a frame chain that independently shows this same patient. If
       neither holds we REFUSE that field instead of writing to it. Read-only. */
    function frameChainOf(el) {
      var wins = [], w = null;
      try { w = (el.ownerDocument && el.ownerDocument.defaultView) || W; } catch (e) { w = W; }
      var g = 0;
      while (w && g++ < 6) {
        wins.push(w);
        var pw = null; try { pw = (w.parent && w.parent !== w) ? w.parent : null; } catch (e2) { pw = null; }
        w = pw;
      }
      return wins;
    }
    function targetChartMatches(el) {
      try {
        var wins = frameChainOf(el);
        if (identWin) { for (var q = 0; q < wins.length; q++) { if (wins[q] === identWin) return true; } }
        for (var i = 0; i < wins.length; i++) {
          var doc; try { doc = wins[i].document; } catch (e) { continue; }
          var cands = []; try { cands = identFrom(docLines(doc, 8000)) || []; } catch (e2) { cands = []; }
          for (var j = 0; j < cands.length; j++) {
            var c = cands[j];
            if (!c || !c.name) continue;
            if (!nameMatch(c.name, String(name || ''))) continue;
            if (wantDob && nrmDob(c.dob) !== wantDob) continue;
            if (wantId && c.mrn && String(c.mrn).replace(/\D/g, '') !== wantId) continue;
            return true;
          }
        }
      } catch (e) {}
      return false;
    }
    /* ---- deep editable collector: frames + shadow roots ------------------- */
    var BADF = /search|find|lookup|filter|chat|messag|comment|reason for|\baddress\b|e-?mail|phone|\bnpi\b|\bmrn\b|patient.?id|claim|login|password|user.?name|\bzip\b|\bcity\b|\bstate\b/i;
    function deepActive(doc) { var a = null; try { a = doc.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; } catch (e) {} return a; }
    function hostChainText(el, hops) {
      var out = [], n = el, h = 0;
      while (n && h < (hops || 7)) {
        try {
          var al = n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('title') || n.getAttribute('data-section') || n.getAttribute('data-sectionname'));
          if (al && al.length <= 80) out.push(al);
          if (n.querySelector) {
            var hd = n.querySelector('h1,h2,h3,h4,h5,h6,legend,[role="heading"]');
            if (hd) { var ht = String(hd.textContent || '').replace(/\s+/g, ' ').trim(); if (ht && ht.length <= 80) out.push(ht); }
          }
        } catch (e) {}
        var up = null;
        try { up = n.parentElement || (n.getRootNode && n.getRootNode().host) || null; } catch (e2) { up = null; }
        n = up; h++;
      }
      return out.join(' ');
    }
    function labelOf(el) {
      try {
        var l = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'))) || '';
        return String(l).replace(/\s+/g, ' ').trim().slice(0, 60);
      } catch (e) { return ''; }
    }
    function visEl(el, win) {
      try {
        if (el.disabled || el.readOnly) return false;
        var s = (win || window).getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.05) return false;
        var r = el.getBoundingClientRect();
        return r.width > 90 && r.height > 14;
      } catch (e) { return false; }
    }
    function collectEditables() {
      var cands = [];
      function walkRoot(root, win, act, budget) {
        var els; try { els = root.querySelectorAll('*'); } catch (e) { return budget; }
        for (var i = 0; i < els.length; i++) {
          if (--budget < 0) return budget;
          var el = els[i];
          try { if (el.shadowRoot) budget = walkRoot(el.shadowRoot, win, act, budget); } catch (eS) {}
          var tag = (el.tagName || '').toUpperCase();
          var isTA = tag === 'TEXTAREA';
          var isIN = tag === 'INPUT' && /^(text|search|)$/.test(String(el.getAttribute('type') || '').toLowerCase());
          var isCE = el.isContentEditable === true && el.getAttribute && el.getAttribute('contenteditable') != null;
          if (!isTA && !isIN && !isCE) continue;
          if (!visEl(el, win)) continue;
          var r = el.getBoundingClientRect();
          var hay = (labelOf(el) + ' ' + hostChainText(el)).toLowerCase();
          cands.push({ el: el, win: win, tag: tag, ce: isCE, area: Math.min(r.width * r.height, 400000), hay: hay, label: labelOf(el) || '', focused: el === act });
        }
        return budget;
      }
      var wins = [window];
      for (var fi2 = 0; fi2 < allFr.length; fi2++) {
        try { var p2 = String(allFr[fi2].location.pathname || ''); if (!SKIP.test(p2) && !JUNK.test(p2)) wins.push(allFr[fi2]); } catch (e) {}
      }
      for (var wi = 0; wi < wins.length && wi < 10; wi++) {
        try { walkRoot(wins[wi].document, wins[wi], deepActive(wins[wi].document), 14000); } catch (e) {}
      }
      return cands;
    }
    /* ---- section map (generic, by meaning - nothing account-specific) ----- */
    var DEFS = {
      history:    /surgical|procedure\s*history|past\s*medical|family\s*history|social\s*history|implant|histor/i,
      hpi:        /\bhpi\b|history of present|present illness|subjective|chief complaint|interval history/i,
      exam:       /physical exam|\bexam\b|objective|findings/i,
      assessment: /assess|impression|a&p|a\/p|diagnos|\bicd\b/i,
      plan:       /\bplan\b|follow.?up|recommendation|decision\s*making/i,
      orders:     /\borders?\b|\bcpt\b|procedure\s*code|hcpcs/i,
      rx:         /prescri|\brx\b|\bsig\b|pharmacy|dispense|refill|medication order/i,
      billing:    /billing|charge|superbill|e&m|e\/m|claim|\bcpt\b/i,
      note:       /note|progress|narrative|free.?text|document/i
    };
    function bestFieldFor(key, allowFocusFallback) {
      var re = DEFS[key] || DEFS.note;
      var cands = collectEditables();
      var top = null, topScore = -1e12;
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        var sc = c.area / 1000;
        if (re.test(c.hay)) sc += 2000;
        if (DEFS.note.test(c.hay)) sc += 300;
        if (BADF.test(c.hay)) sc -= 1800;
        if (c.tag === 'TEXTAREA') sc += 120;
        if (c.ce) sc += 100;
        if (c.focused) sc += 9000;
        c.score = sc;
        if (sc > topScore) { topScore = sc; top = c; }
      }
      if (!top) return null;
      var matched = re.test(top.hay);
      if (!matched && !(allowFocusFallback && top.focused)) return null;
      return top;
    }
    /* ---- History-pane navigation + NOTE-editor opener (read-only nav) ----- */
    var BADNAV = /save|sign|order|delete|discard|remove|void|submit|bill|charge|check\s*-?\s*(in|out)|prescri|refill|dispense|cancel|log\s*out/i;
    function realClick(el, win) {
      try { el.scrollIntoView({ block: 'center' }); } catch (e1) {}
      try {
        var w2 = win || (el.ownerDocument && el.ownerDocument.defaultView) || W;
        var r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        var o = { bubbles: true, cancelable: true, view: w2, clientX: x, clientY: y };
        ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup'].forEach(function (tp) {
          try { el.dispatchEvent(new w2[tp.indexOf('pointer') === 0 ? 'PointerEvent' : 'MouseEvent'](tp, o)); } catch (e2) {}
        });
      } catch (e3) {}
      try { el.click(); } catch (e4) {}
    }
    function frameText() { var t = ''; try { t = String((W.document.body && W.document.body.innerText) || ''); } catch (e) {} return t; }
    var HIST_HEAD = /surgical\s*&?\s*procedure\s*history/i;
    /* v2.07: the clientsummary CARD carries the same heading TEXT as the real
       History drawer, so innerText alone is a lie (the v2.05/06 runs "saw" the
       pane without ever opening it). The real signal is an ON-SCREEN heading
       ELEMENT (x > -50; the collapsed drawer's copies measure x ~ -420). Also:
       the rail click can open athena's top-nav Calendar menu instead (proven
       collision) - detect + Escape it before every step. */
    async function dismissNavMenu() {
      try {
        var els = W.document.querySelectorAll('a,li,span,div');
        for (var i = 0; i < els.length; i++) {
          var own = String(els[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (own === 'View Calendar' || own === 'Staff Directory') {
            var r = els[i].getBoundingClientRect();
            if (r.width > 2 && r.x >= 0) {
              try { W.document.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (e1) {}
              try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); } catch (e2) {}
              await sleep(350);
              return true;
            }
          }
        }
      } catch (e) {}
      return false;
    }
    function onScreenHeading(headingRe) {
      var els; try { els = W.document.querySelectorAll('div,section,li,h1,h2,h3,h4,span'); } catch (e) { return null; }
      for (var i = 0; i < els.length; i++) {
        var own = String(els[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (own && own.length < 60 && headingRe.test(own)) {
          try { var r = els[i].getBoundingClientRect(); if (r.width > 10 && r.x > -50) return els[i]; } catch (e2) {}
        }
      }
      return null;
    }
    var histDiag = { clicks: 0, frames: [] };
    function drawerEl() {
      /* v2.09 STRUCTURAL drawer detection (live-proven on the real chart): the
         History drawer is div[data-chart-section-id="history"], and its
         x-position IS the toggle state - x ~ 54 open, x ~ -420 collapsed.
         Heading-TEXT checks lie twice over (the read-only briefing card and the
         clientsummary card both render the heading + saved note text), and the
         rail LI is a TOGGLE, so a text-based "is it open" check made earlier
         builds flap the drawer open/closed. */
      var dv; try { dv = W.document.querySelectorAll('div[data-chart-section-id="history"]'); } catch (e) { dv = []; }
      for (var i = 0; i < dv.length; i++) {
        try { var r = dv[i].getBoundingClientRect(); if (r.width > 200 && r.x > -50) return dv[i]; } catch (e2) {}
      }
      return null;
    }
    function paneLive() { return !!drawerEl(); }
    async function openHistoryPane() {
      await dismissNavMenu();
      if (paneLive()) return true;
      var deadline = Date.now() + 16000;
      while (Date.now() < deadline) {
        var clicked = false;
        /* v2.09: the chart rail may live in a DIFFERENT frame than the one the
           size heuristic picked (live: a briefing frame won the pick while the
           chart frame owned the rail). Search every candidate frame and ADOPT
           the frame that has the clickable rail item. */
        for (var wi2 = 0; wi2 < scanWs.length && !clicked; wi2++) {
          try {
            var lis = scanWs[wi2].document.querySelectorAll('li.chart-tabs__list-item[data-chart-section-id="history"],[data-chart-section-id="history"]');
            for (var qi = 0; qi < lis.length; qi++) {
              var li = lis[qi];
              try { var rr = li.getBoundingClientRect(); if (rr.width < 2) continue; } catch (eR) { continue; }
              var lbl = String((li.getAttribute && (li.getAttribute('aria-label') || li.getAttribute('data-icon-caption'))) || li.textContent || '').replace(/\s+/g, ' ').trim();
              if (BADNAV.test(lbl)) continue;
              W = scanWs[wi2];
              histDiag.clicks++;
              try { histDiag.frames.push(String(W.location.pathname || '').slice(-18)); } catch (eHd) {}
              realClick(li, W); clicked = true; break;
            }
          } catch (eA) {}
        }
        if (clicked) {
          var pd = Date.now() + 6000;
          while (Date.now() < pd) {
            await sleep(500);
            await dismissNavMenu(); /* the click may have opened the Calendar menu instead */
            if (paneLive()) { await sleep(900); return true; } /* v2.09: let the slide-in settle + handlers attach */
          }
        }
        await sleep(700);
      }
      return paneLive();
    }
    async function openNoteEditor(headingRe) {
      /* v2.09: everything is SCOPED TO THE OPEN DRAWER CONTAINER (live-proven
         layout): the drawer stacks sections (Family / Social / Surgical &
         Procedure / Implant / Past Medical), each with its own heading. When a
         section is EMPTY its affordance is a small NOTE chip (~37px SPAN);
         when a note EXISTS the chip is replaced by the saved-note ROW - the
         clinician edits by clicking the note text itself. The "Add procedure"
         search box lives OUTSIDE the drawer and must never be picked. */
      await dismissNavMenu();
      var dr = drawerEl();
      if (!dr) return { ok: false, error: 'history-drawer-not-open' };
      function headingEl() {
        var els; try { els = dr.querySelectorAll('div,section,li,h1,h2,h3,h4,span'); } catch (e) { return null; }
        for (var i = 0; i < els.length; i++) {
          var own = String(els[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (own && own.length < 60 && headingRe.test(own)) {
            try { var r = els[i].getBoundingClientRect(); if (r.width > 10) return els[i]; } catch (e2) {}
          }
        }
        return null;
      }
      function inDrawer(el) {
        /* shadow-aware containment: contains() is false across shadow
           boundaries, so climb parentElement -> shadow host instead */
        var n = el, h = 0;
        while (n && h < 40) { if (n === dr) return true; n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null; h++; }
        return false;
      }
      function drawerEditors() {
        /* SHADOW-PIERCING collector scoped to the drawer - the note editor is
           a shadow-DOM contenteditable (live-proven: the successful write's
           method was ce-insert), invisible to plain querySelectorAll. */
        var out = [];
        function walkR(root, budget) {
          var els; try { els = root.querySelectorAll('*'); } catch (e) { return budget; }
          for (var i = 0; i < els.length; i++) {
            if (--budget < 0) return budget;
            var el2 = els[i];
            try { if (el2.shadowRoot) budget = walkR(el2.shadowRoot, budget); } catch (eS) {}
            var tag = (el2.tagName || '').toUpperCase();
            var okKind = tag === 'TEXTAREA' ||
              (tag === 'INPUT' && /^(text|search|)$/.test(String(el2.getAttribute('type') || '').toLowerCase())) ||
              (el2.isContentEditable === true);
            if (okKind && visEl(el2, W)) out.push(el2);
          }
          return budget;
        }
        walkR(dr, 12000);
        return out;
      }
      function nearestBelow(list, refY) {
        /* a section's editor sits BELOW its heading; anything above belongs to
           the previous section. 0..420px window inside the drawer. */
        var top = null, d0 = 1e9;
        for (var i = 0; i < list.length; i++) {
          try { var y = list[i].getBoundingClientRect().y; var d = y - refY; if (d >= -10 && d < d0) { d0 = d; top = list[i]; } } catch (e) {}
        }
        return (d0 <= 420) ? top : null;
      }
      var head = headingEl();
      if (!head) return { ok: false, error: 'section-heading-not-in-drawer' };
      try { head.scrollIntoView({ block: 'center' }); } catch (eSc) {}
      await sleep(250);
      var headY = 0; try { headY = head.getBoundingClientRect().y; } catch (e) {}
      var preAll = drawerEditors();
      var near0 = nearestBelow(preAll, headY);
      if (near0) return { ok: true, el: near0, head: head }; /* this section's editor already open */
      /* affordance ladder, all inside the drawer and below THIS heading:
         (1) the small NOTE chip (empty section);
         (2) the saved-note row (filled section) - a modest text block that is
             not chrome ("None recorded" / "Add ..." / "Last modified ...").
         BADNAV filters both; nothing here can be a Save/Sign/order control. */
      function findAffordance() {
        /* STRUCTURAL FIRST (live-inspected): athena's note UI is the
           "universal-text-area" (UTA) component - the note affordance is
           .uta-note-label-add-note.clickable (empty section) and the saved
           note's span.uta-note-label-note-text (filled section; clicking it
           bubbles to the clickable label and opens the editor - manually
           proven). Class names are the component's own stable API; the text
           heuristics below stay as a generic-EMR fallback. */
        try {
          var uta = dr.querySelectorAll('span.uta-note-label-note-text, .uta-note-label-add-note.clickable, .uta-note-label .clickable');
          var bestU = null, bDU = 1e9;
          for (var ui = 0; ui < uta.length; ui++) {
            var ru; try { ru = uta[ui].getBoundingClientRect(); } catch (eU) { continue; }
            if (ru.width < 2) continue;
            var ddu = ru.y - headY;
            if (ddu < 4 || ddu > 420) continue;
            if (ddu < bDU) { bDU = ddu; bestU = uta[ui]; }
          }
          if (bestU) return bestU;
        } catch (eUta) {}
        var toggles; try { toggles = dr.querySelectorAll('a,button,span,div,label'); } catch (e) { toggles = []; }
        var tg = null, tgD = 1e9, tgA = 1e12, kind = '';
        for (var ti = 0; ti < toggles.length; ti++) {
          var tt = String(toggles[ti].textContent || '').replace(/\s+/g, ' ').trim();
          if (!tt || BADNAV.test(tt)) continue;
          var ty; try { ty = toggles[ti].getBoundingClientRect(); } catch (e) { continue; }
          if (ty.width < 2) continue;
          var dd = ty.y - headY;
          if (dd < 4 || dd > 420) continue;
          if (/^NOTE$/i.test(tt) && ty.width <= 120) {
            if (kind !== 'chip' || dd < tgD) { tg = toggles[ti]; tgD = dd; kind = 'chip'; }
            continue;
          }
          if (kind === 'chip') continue; /* the chip always wins when present */
          if (tt.length >= 12 && ty.width >= 120 && ty.width <= 460 && ty.height <= 130 &&
              !/^(none recorded|add\b|show|hide|last modified|first-degree|patient does not)/i.test(tt)) {
            /* overlapping row candidates: the OUTER wrapper DIVs have no click
               handler (live-proven: clicking a 385px wrapper did nothing, the
               inner 350px SPAN opened the editor). Prefer the SMALLEST-AREA
               match; <= keeps the deepest on ties (document order = outer first). */
            var aa = ty.width * ty.height;
            if (kind !== 'row' || aa <= tgA) { tg = toggles[ti]; tgD = dd; tgA = aa; kind = 'row'; }
          }
        }
        return tg;
      }
      /* v2.09: up to 3 click attempts - a click during the drawer's slide-in /
         before handlers attach is silently ignored (live: same click worked on
         a settled drawer and did nothing right after opening). */
      var sawAffordance = false;
      for (var att = 0; att < 3; att++) {
        var tg2 = findAffordance();
        if (!tg2) { if (att === 0) break; await sleep(900); continue; }
        sawAffordance = true;
        var pre = drawerEditors();
        realClick(tg2, W);
        var dl = Date.now() + 4200;
        while (Date.now() < dl) {
          await sleep(400);
          var post = drawerEditors();
          var fresh = [];
          for (var pi = 0; pi < post.length; pi++) { if (pre.indexOf(post[pi]) < 0) fresh.push(post[pi]); }
          var pick = nearestBelow(fresh.length ? fresh : post, headY);
          if (pick) return { ok: true, el: pick, head: head };
          var da = deepActive(W.document);
          if (da && (da.tagName === 'TEXTAREA' || da.isContentEditable) && visEl(da, W) && inDrawer(da)) return { ok: true, el: da, head: head };
        }
        try { headY = head.getBoundingClientRect().y; } catch (eH2) {}
      }
      return { ok: false, error: sawAffordance ? 'editor-did-not-appear' : 'note-affordance-not-found' };
    }
    /* ---- field writer (notes only; never invoked for order-class) --------- */
    async function writeField(el, txt, head) {
      var CE = !!el.isContentEditable;
      function rd() { return CE ? String(el.innerText || el.textContent || '') : String(el.value || ''); }
      function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
      function setNative(v) {
        if (CE) { try { el.textContent = v; } catch (e) {} return; }
        var pr = (el.tagName === 'TEXTAREA') ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
        var d = null; try { d = Object.getOwnPropertyDescriptor(pr, 'value'); } catch (e) {}
        if (d && d.set) d.set.call(el, v); else el.value = v;
      }
      function fire(type, data) { try { el.dispatchEvent(new W.InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new W.Event('input', { bubbles: true })); } catch (e2) {} } }
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      realClick(el, W);
      try { el.focus(); } catch (e) {}
      await sleep(50);
      if (CE) {
        try { var rg = W.document.createRange(); rg.selectNodeContents(el); var se = W.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {}
        var okc = false;
        try { okc = W.document.execCommand('insertText', false, txt); } catch (e) { okc = false; }
        if (!okc) setNative(txt);
      } else {
        try { if (el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {}
        setNative(txt);
      }
      fire('insertText', txt);
      try { el.dispatchEvent(new W.Event('change', { bubbles: true })); } catch (e) {}
      await sleep(120);
      var cur = rd();
      var landed = txt ? (norm(cur).indexOf(norm(txt).slice(0, Math.min(norm(txt).length, 40))) >= 0) : (norm(cur) === '');
      /* v2.08 SAVE/PERSIST (owner requirement): a paste left focused is an
         unsaved DRAFT the clinician would have to re-save by hand - athena's
         History NOTE saves on BLUR. Blur the field, then click the section
         heading (neutral text, not a control) to move focus the way a human
         would; then confirm the section shows the text (athena usually
         collapses the editor and renders the saved note inline). */
      var persisted = false;
      if (landed) {
        try { el.dispatchEvent(new W.FocusEvent('blur', { bubbles: false })); } catch (e) {}
        try { el.dispatchEvent(new W.FocusEvent('focusout', { bubbles: true })); } catch (e) {}
        try { el.blur(); } catch (e) {}
        if (head) { try { realClick(head, W); } catch (e) {} }
        await sleep(900);
        if (txt) {
          var probe = norm(txt).slice(0, 30);
          try {
            var secTxt = '';
            if (head && head.parentElement) secTxt = norm(String(head.parentElement.textContent || ''));
            if (secTxt.indexOf(probe) >= 0) persisted = true;
            else if (norm(rd()).indexOf(probe) >= 0) persisted = true;
          } catch (e) {}
        } else {
          persisted = true; /* clear-then-blur = the manual delete gesture */
        }
      }
      return { written: true, verified: landed, persisted: persisted, into: cur.length, method: CE ? 'ce-insert' : 'native' };
    }
    /* ---- run the sections -------------------------------------------------- */
    var results = [], forcedHeld = [];
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s] || {};
      var key = String(sec.key || 'note');
      var wantExecute = !!sec.execute;
      if (NEVER_EXECUTE.test(key)) {
        if (wantExecute) forcedHeld.push(key);
        wantExecute = false; /* HARD: order-class is target-only, always */
      }
      var entry = { key: key, execute: wantExecute, found: false, written: false, verified: false, fieldLabel: '', fieldHeading: '', fieldTag: '', method: '', error: '' };
      try {
        if (sec.verify) {
          /* v2.09 READ-ONLY VERIFY: open the section's note editor and report
             its CURRENT text without writing anything - the honest "verify it
             landed" leg of write->verify->delete. Never modifies content. */
          entry.execute = false; entry.verifyRead = true;
          var elv = null, hVer = null;
          if (key === 'history') {
            var okPv = await openHistoryPane();
            if (okPv) {
              hVer = onScreenHeading(HIST_HEAD);
              var opv = await openNoteEditor(HIST_HEAD);
              if (opv.ok) { elv = opv.el; hVer = opv.head || hVer; } else entry.error = opv.error;
            } else entry.error = 'history-pane-not-reachable';
          } else entry.error = 'verify-supported-for-history-only';
          /* read-only diagnostics: what the driver actually sees around the
             heading (frame tail, rendered section text, chip/editor census) -
             lets a caller distinguish "summary card" from the real drawer. */
          try {
            entry.histDiag = histDiag;
            entry.paneTail = String(W.location.pathname || '').slice(-30);
            /* per-frame rail census: which frames exist and which own the rail */
            entry.railScan = [];
            for (var rf = 0; rf < allFr.length && entry.railScan.length < 14; rf++) {
              try {
                var rTail = String(allFr[rf].location.pathname || '').slice(-24);
                var rl = allFr[rf].document.querySelectorAll('[data-chart-section-id="history"]');
                var vis = 0;
                for (var rv2 = 0; rv2 < rl.length; rv2++) { try { if (rl[rv2].getBoundingClientRect().width >= 2) vis++; } catch (eV2) {} }
                entry.railScan.push(rTail + ':' + rl.length + '/' + vis);
              } catch (eRf) { entry.railScan.push('x'); }
            }
            try {
              var rl0 = window.document.querySelectorAll('[data-chart-section-id="history"]');
              entry.railTop = rl0.length;
            } catch (eT) {}
            if (hVer) {
              var hpv = hVer.parentElement || hVer;
              entry.sectionText = String(hpv.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 260);
              var hy = 0; try { hy = hVer.getBoundingClientRect().y; } catch (eY) {}
              var cens = { chips: 0, chipW: [], editors: 0 };
              var tgv; try { tgv = W.document.querySelectorAll('a,button,span,div,label'); } catch (eQ) { tgv = []; }
              for (var tv = 0; tv < tgv.length; tv++) {
                var ttv = String(tgv[tv].textContent || '').replace(/\s+/g, ' ').trim();
                if (!/^NOTE$/i.test(ttv)) continue;
                try { var rv = tgv[tv].getBoundingClientRect(); if (rv.width >= 2) { var dv = rv.y - hy; if (dv >= -10 && dv <= 320) { cens.chips++; if (cens.chipW.length < 6) cens.chipW.push(Math.round(rv.width)); } } } catch (eB) {}
              }
              var edv; try { edv = W.document.querySelectorAll('textarea,[contenteditable],input[type="text"],input:not([type])'); } catch (eE) { edv = []; }
              for (var ev2 = 0; ev2 < edv.length; ev2++) {
                if (!visEl(edv[ev2], W)) continue;
                try { var ry2 = edv[ev2].getBoundingClientRect().y - hy; if (ry2 >= -10 && ry2 <= 320) cens.editors++; } catch (eC2) {}
              }
              entry.census = cens;
            }
          } catch (eDg) {}
          if (elv) {
            entry.found = true;
            var txtv = elv.isContentEditable ? String(elv.innerText || elv.textContent || '') : String(elv.value || '');
            entry.textHead = txtv.replace(/\s+/g, ' ').trim().slice(0, 220);
            entry.textLen = txtv.replace(/\s+/g, ' ').trim().length;
            /* leave the untouched editor the way a human closes it: blur only */
            try { elv.blur(); } catch (eBv) {}
            if (hVer) { try { realClick(hVer, W); } catch (eCv) {} }
          }
          results.push(entry);
          continue;
        }
        if (!wantExecute) {
          var t = bestFieldFor(key, false);
          if (t) { entry.found = true; entry.fieldTag = t.tag + (t.ce ? '/contenteditable' : ''); entry.fieldLabel = t.label; entry.fieldHeading = t.hay.slice(0, 90); }
          else entry.error = 'no-matching-field-on-screen';
        } else {
          var el = null, opHead = null;
          if (key === 'history') {
            var okPane = await openHistoryPane();
            if (okPane) {
              var op = await openNoteEditor(HIST_HEAD);
              if (op.ok) { el = op.el; opHead = op.head || null; } else entry.error = op.error;
            } else entry.error = 'history-pane-not-reachable';
          }
          if (!el) {
            var b2 = bestFieldFor(key, true);
            if (b2 && (b2.focused || (DEFS[key] || DEFS.note).test(b2.hay))) el = b2.el;
          }
          if (!el) { if (!entry.error) entry.error = 'no-matching-field-on-screen'; }
          else if (!targetChartMatches(el)) {
            /* the field we located is NOT on this patient's open chart - refuse
               rather than write to the wrong place (e.g. a dashboard note box). */
            entry.found = true; entry.written = false; entry.verified = false;
            entry.error = 'target-not-on-open-chart';
          }
          else {
            entry.found = true;
            var wr = await writeField(el, String(sec.text == null ? '' : sec.text), opHead);
            entry.written = wr.written; entry.verified = wr.verified; entry.method = wr.method;
            entry.persisted = !!wr.persisted;
            entry.into = wr.into;
          }
        }
      } catch (eSec) { entry.error = String((eSec && eSec.message) || eSec).slice(0, 140); }
      results.push(entry);
    }
    return { ok: true, chartName: ident.name, chartDob: ident.dob || '', chartMrn: ident.mrn || '', forcedHeld: forcedHeld, results: results, ms: Date.now() - T0 };
  } catch (e) { return { ok: false, reason: 'driver-error', error: String((e && e.message) || e).slice(0, 200) }; }
}

/* v2.05 handler: single-flight, verified tab pick, freeze-guard, foreground-
 * for-write (hidden tabs neither hydrate nor commit edits reliably), 90s cap. */
(function () {
  'use strict';
  try { if (self.__mlsV205WriteWired) return; self.__mlsV205WriteWired = 1; } catch (e) {}
  var busy = 0;
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || msg.type !== 'mlsAppWriteV2Request') return;
    (async function () {
      var V = '';
      try { V = chrome.runtime.getManifest().version; } catch (eV) {}
      if (busy) { sendResponse({ ok: false, reason: 'busy', version: V, error: 'A write is already running - one at a time.' }); return; }
      busy = 1;
      try {
        var secs = Array.isArray(msg.sections) ? msg.sections : [];
        if (!String(msg.patient || '').trim() || !secs.length) { sendResponse({ ok: false, reason: 'bad-args', version: V, error: 'patient and sections are required.' }); return; }
        var all = await chrome.tabs.query({});
        var tab = await mlsPickAthenaTab(all, { athenaOnly: true });
        if (!tab) { sendResponse({ ok: false, reason: 'no-athena-tab', version: V, error: 'Open your signed-in athenaOne in another tab, then try again.' }); return; }
        if (__mlsReadsSinceReload >= 5) { try { await mlsRecoverAthenaTab(tab.id); } catch (eRc) {} }
        /* v2.9.5: writes keep the proven foreground-for-write path — leave quiet-pull
           mode first so the tab.active check below sees the restored layout. */
        try { if (self.__mlsQp && self.__mlsQp.active) { await self.__mlsQpRelease('write'); tab = await chrome.tabs.get(tab.id); } } catch (eQ) {}
        try {
          if (!tab.active) {
            await chrome.tabs.update(tab.id, { active: true });
            if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
            try { self.__mlsFgNote && self.__mlsFgNote(sender && sender.tab && sender.tab.id); } catch (eN) {}
          }
        } catch (eF) {}
        var fx = await mlsExecTO({ target: { tabId: tab.id }, world: 'MAIN', args: [String(msg.patient || ''), String(msg.dob || ''), String(msg.athenaId || ''), secs], func: mlsUnifiedWriteDriverFn }, 90000);
        if (fx.timeout) {
          try { await mlsRecoverAthenaTab(tab.id); } catch (eR2) {}
          sendResponse({ ok: false, reason: 'write-timeout', version: V, error: 'athenaOne did not finish the write within 90s (renderer recovered). Try again.' });
          return;
        }
        if (fx.err) { sendResponse({ ok: false, reason: 'inject-failed', version: V, error: 'Could not inject the write driver: ' + fx.err }); return; }
        var r = fx && fx.r && fx.r[0] && fx.r[0].result;
        if (!r) { sendResponse({ ok: false, reason: 'no-result', version: V, error: 'The write driver returned nothing (frame navigated mid-write?).' }); return; }
        try { __mlsReadsSinceReload++; } catch (eC) {}
        r.version = V;
        sendResponse(r);
      } catch (e) {
        sendResponse({ ok: false, reason: 'error', version: V, error: String((e && e.message) || e) });
      } finally { busy = 0; }
    })();
    return true;
  });
})();
