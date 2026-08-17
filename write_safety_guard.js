/* MLS Assist — write-safety guard (wsg-2.0.0).
 *
 * wsg-2.0.0 (owner directive 2026-08-12, released 2026-08-17): the wsg-1.x
 * "preview-only" EXECUTE refusal for sign_encounter / stage_billing /
 * place_order is LIFTED. BLOCKED_EXECUTE_ACTIONS is empty; every supervised V2
 * action executes behind the same correctness gates (exact identity + encounter
 * lock, one-use token, fresh trusted click, verified prior note write before
 * sign, one action per confirm, no automatic chaining). The forbidden-control
 * matchers, the production test-content policy and the identity helpers are
 * unchanged.
 *
 * ONE module, THREE homes:
 *   1. Service worker (background.js `importScripts`) — action-policy gate,
 *      production test-content policy, account/practice verification helpers.
 *   2. Content script on athenanet (document_start, all frames) — a capture-
 *      phase interceptor that CONSUMES every synthetic (isTrusted === false)
 *      activation aimed at a final/irrevocable control. Extension code paths
 *      physically cannot click Sign / Sign off / Submit / Send / Approve /
 *      Finalize / Place order / Prescribe / Transmit, no matter which lane
 *      fired the click. Real user clicks (isTrusted === true) are untouched.
 *   3. Node unit tests — every matcher and policy below is a pure function.
 *
 * This file is PHI-free, LF-only, and safe to load anywhere (it only arms the
 * interceptor when it finds itself in a window on athenanet.athenahealth.com).
 *
 * Known limit (documented, not hidden): programmatic `form.submit()` fires no
 * event and cannot be intercepted from an isolated world. Athena's final
 * actions are button-driven, and the extension's own drivers never call
 * form.submit(); the in-driver clickOnce guard and the background policy gate
 * cover that residual path.
 */
(function (root) {
  'use strict';
  if (root.MLSWriteSafety && root.MLSWriteSafety.version) return; // idempotent
  var VERSION = 'wsg-2.0.0';

  /* ------------------------------------------------------------------ *
   * Shared normalizers (mirror the V2 driver's conventions).           *
   * ------------------------------------------------------------------ */
  function text(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
  function norm(v) { return text(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function nameKey(v) {
    var raw = text(v), comma = /^\s*([^,]+),\s*(.+)$/.exec(raw);
    if (comma) raw = comma[2] + ' ' + comma[1];
    return norm(raw);
  }
  function simpleHash(v) {
    var s = String(v || ''), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* ------------------------------------------------------------------ *
   * 1. FORBIDDEN FINAL-ACTION CONTROLS                                   *
   *    The actual list the extension refuses to interact with.           *
   * ------------------------------------------------------------------ */
  /* Matched against the control's OWN normalized label (textContent / value /
     aria-label / title), never a container's. norm() folds "&"->"and",
     "Sign-off"->"sign off", "e-Rx"->"e rx". Word boundaries keep
     "assign"/"design"/"signature"/"billing"/"sending" (etc.) unmatched. */
  var FORBIDDEN_LABEL_SOURCES = [
    '\\bsign\\b',                        // Sign / Sign & Save / Sign off / Sign orders / Sign in
    '\\bsigns?\\s+and\\s+saves?\\b',
    '\\bco\\s?sign\\b',
    '\\battest\\b',
    '\\bsubmit\\b',
    '\\bsend\\b',
    '\\bapprove\\b',
    '\\bfinali[sz]e\\b',
    '\\bplace\\s+orders?\\b',
    '\\badd\\s+orders?\\b',
    '\\bprescribe\\b',
    '\\be\\s?(?:rx|prescribe|prescription)\\b',
    '\\btransmit\\b',
    '\\bpost\\s+charges?\\b',
    '\\bfile\\s+claims?\\b',
    '\\bsubmit\\s+claims?\\b',
    '\\bbill\\s+(?:now|patient|insurance)\\b',
    '\\bclose\\s+encounter\\b',
    '\\bdelete\\s+(?:chart|patient|encounter)\\b'
  ];
  var FORBIDDEN_LABEL_PATTERNS = FORBIDDEN_LABEL_SOURCES.map(function (s) { return new RegExp(s); });

  /* Attribute fragments: unambiguous machine names seen on final-action
     controls (id / name / data-action / data-testid / class tokens). These are
     substring matches on lowercased attribute values, so keep them SPECIFIC —
     never a bare "sign" or "order" (would swallow "signature", "orderable"). */
  var FORBIDDEN_ATTR_FRAGMENTS = [
    'signoff', 'sign-off', 'sign_off',
    'signandsave', 'sign-and-save', 'sign_and_save', 'signsave',
    'signencounter', 'sign-encounter', 'sign_encounter',
    'placeorder', 'place-order', 'place_order',
    'submitorder', 'submit-order', 'submit_order',
    'sendorder', 'send-order', 'send_order',
    'approveorder', 'approve-order',
    'prescribe', 'e-rx', 'erx-send', 'sendrx', 'send-rx', 'transmitrx', 'transmit-rx',
    'sendtopharmacy', 'send-to-pharmacy',
    'finalizenote', 'finalize-note', 'finalize_note',
    'postcharge', 'post-charge', 'post_charge',
    'submitclaim', 'submit-claim', 'fileclaim', 'file-claim',
    'closeencounter', 'close-encounter',
    'mls-forbidden' /* explicit test hook: data-mls-forbidden */
  ];

  /* Documented CSS selector list (mirrors the fragments; used for audits and
     by tests — runtime matching goes through isForbiddenControl so it also
     works on detached/fake elements). */
  var FORBIDDEN_SELECTORS = FORBIDDEN_ATTR_FRAGMENTS.map(function (f) {
    return '[id*="' + f + '" i],[name*="' + f + '" i],[data-action*="' + f + '" i],[data-testid*="' + f + '" i]';
  });

  var CONTROLISH = /^(button|a|input|select)$/i;
  var CONTROL_ROLES = { button: 1, menuitem: 1, link: 1, tab: 0 };

  function getAttr(el, name) {
    try { return el && el.getAttribute ? (el.getAttribute(name) || '') : ''; } catch (e) { return ''; }
  }
  function isControlish(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = String(el.tagName || '').toLowerCase();
    if (CONTROLISH.test(tag)) {
      if (tag === 'input') { var t = String(getAttr(el, 'type') || (el.type || '')).toLowerCase(); return t === 'button' || t === 'submit' || t === 'image' || t === ''; }
      return true;
    }
    var role = String(getAttr(el, 'role')).toLowerCase();
    if (role && CONTROL_ROLES[role]) return true;
    if (getAttr(el, 'onclick')) return true;
    return false;
  }
  function shortLabel(el) {
    var raw = [];
    try { raw = [el.textContent, el.value, getAttr(el, 'aria-label'), getAttr(el, 'title')].map(text).filter(Boolean); } catch (e) {}
    return raw.map(norm).filter(function (n) { return n && n.length <= 120; });
  }
  function attrHay(el) {
    var id = ''; try { id = String(el.id || ''); } catch (eId) {}
    var parts = [id || getAttr(el, 'id'), getAttr(el, 'name'), getAttr(el, 'data-action'), getAttr(el, 'data-testid'), getAttr(el, 'data-mls-forbidden') ? 'mls-forbidden' : ''];
    try { parts.push(String(el.className || '')); } catch (e) {}
    return parts.join(' ').toLowerCase();
  }
  /* THE guard question: "may extension code interact with this element?"
     Answer is NO when it is a control whose own label or machine name marks a
     final/irrevocable action. */
  function isForbiddenControl(el) {
    if (!isControlish(el)) return false;
    var labels = shortLabel(el);
    for (var i = 0; i < labels.length; i++) {
      for (var j = 0; j < FORBIDDEN_LABEL_PATTERNS.length; j++) {
        if (FORBIDDEN_LABEL_PATTERNS[j].test(labels[i])) return true;
      }
    }
    var hay = attrHay(el);
    for (var k = 0; k < FORBIDDEN_ATTR_FRAGMENTS.length; k++) {
      if (hay.indexOf(FORBIDDEN_ATTR_FRAGMENTS[k]) >= 0) return true;
    }
    return false;
  }
  /* Walk an event's composed path to the nearest control-ish node; return the
     forbidden control if the activation would land on one. */
  function findForbiddenInPath(path, fallbackTarget) {
    var nodes = Array.isArray(path) ? path.slice(0, 20) : [];
    if (fallbackTarget && nodes.indexOf(fallbackTarget) < 0) nodes.push(fallbackTarget);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el || el.nodeType !== 1) continue;
      if (isControlish(el)) return isForbiddenControl(el) ? el : null; // nearest control decides
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 2. ACTION POLICY — what the supervised V2 contract may EXECUTE      *
   * ------------------------------------------------------------------ */
  /* wsg-2.0.0: NO action is refused by policy any more. The owner (sole owner
     of MLS, directive 2026-08-12) lifted the wsg-1.x preview-only rule for the
     sign / order / billing lanes; probe stays read-only, execute proceeds to
     the driver's own supervised verification. The map is kept (empty) so the
     gate keeps one shape and a future policy can be re-pinned in one place. */
  var BLOCKED_EXECUTE_ACTIONS = {};
  var BLOCK_MESSAGE = 'This action is blocked by write-safety policy. Nothing was changed.';

  /* ------------------------------------------------------------------ *
   * 3. PRODUCTION TEST/STAGING POLICY                                   *
   * ------------------------------------------------------------------ */
  /* 3.0.25 (write audit #33): the former loose alternatives - an unanchored,
     case-INSENSITIVE TEST(ING)? (ONLY|NOTE|CONTENT|WRITE|ENTRY) and SELF-?TEST -
     hard-BLOCKED real clinical prose: "recommend testing only if symptoms
     persist", "self-test glucose", "TNM staging only after biopsy", "do not
     treat empirically". A blocked write is a refused note, not a warning.
     Deliberate test content is always MARKED, so match only (a) bracketed or
     parenthesised markers, case-insensitive, or (b) an ALL-CAPS header at the
     start of a line, case-SENSITIVE so ordinary sentences can never trip it.
     opts.isTest stays the explicit signal. TREAT is dropped: it names clinical
     care, not a records action - "DO NOT TREAT WITH PENICILLIN" is real charting. */
  var TEST_MARKER_RE = /\[(?:MLS[ _-])?(?:TEST|TESTING|STAGING|DO\s+NOT\s+(?:FILE|SIGN|BILL))\]|\((?:MLS[ _-])?TEST(?:\s+(?:ONLY|PATIENT|NOTE))?\)/i;
  var TEST_HEADER_RE = /^[ \t>*#-]*(?:MLS[ _-])?TEST(?:ING)?\s+(?:PATIENT|ONLY|NOTE|CONTENT|WRITE|ENTRY)\b|^[ \t>*#-]*STAGING\s+(?:ONLY|NOTE|CONTENT)\b|^[ \t>*#-]*DO\s+NOT\s+(?:FILE|SIGN|BILL)\b/m;
  /* Real clinical directives that must never ride inside TEST content. */
  var CLINICAL_DIRECTIVE_RES = [
    /\b\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|cc|units?|iu)\b/i,              // dosing
    /\bsig\s*[:.]/i,
    /\bdispense\b|\brefills?\s*[:#]?\s*\d/i,
    /\btake\s+\d/i,
    /\bprescrib\w*\b/i,
    /\b(?:start|begin|initiate)\s+(?:taking|therapy|treatment)\b/i,
    /\border(?:ed|ing)?\s+(?:an?\s+)?(?:mri|ct|x-?ray|ultrasound|lab|labs|blood\s+work|imaging|pt|physical\s+therapy)\b/i,
    /\brefer(?:ral|red)?\s+to\b/i,
    /\bfollow\s*-?\s*up\s+in\s+\d/i,
    /\binject(?:ion|ed)?\s+of\b/i,
    /\b(?:discontinue|stop\s+taking|increase|decrease)\s+\w+/i
  ];
  function looksLikeTestContent(t) { var s = String(t == null ? '' : t); return TEST_MARKER_RE.test(s) || TEST_HEADER_RE.test(s); }
  function containsClinicalDirectives(t) {
    var s = String(t == null ? '' : t);
    for (var i = 0; i < CLINICAL_DIRECTIVE_RES.length; i++) if (CLINICAL_DIRECTIVE_RES[i].test(s)) return true;
    return false;
  }
  /* Production builds never carry a named patient/MRN allowlist. Test and
     staging content belongs in a separately configured Athena Preview tenant
     with synthetic patients; until that boundary is explicit, fail closed. */
  function checkTestWritePolicy(opts) {
    opts = opts || {};
    var noteText = String(opts.noteText == null ? '' : opts.noteText);
    var flaggedTest = opts.isTest === true || looksLikeTestContent(noteText);
    if (flaggedTest) {
      return { ok: false, blocked: true, reason: 'test-content-production-disabled', error: 'Test or staging content cannot be written through the production extension. Use a configured Athena Preview sandbox with synthetic patients. Nothing was changed.' };
    }
    return null;
  }

  /* One gate for the V2 message handler: called with the parsed request
     BEFORE any token or injection work. Returns null when the request may
     proceed to the existing supervised checks. */
  function gateActionRequest(req) {
    req = req || {};
    var mode = String(req.mode || '').toLowerCase(), action = String(req.action || '').toLowerCase();
    if (mode === 'execute' && BLOCKED_EXECUTE_ACTIONS[action]) {
      return { ok: false, blocked: true, reason: 'write-safety-final-action-blocked', action: action, error: BLOCK_MESSAGE };
    }
    if (mode === 'execute' && (action === 'write_note' || action === 'save_draft')) {
      var testGate = checkTestWritePolicy({ patient: req.expectedPatient, noteText: req.noteText, isTest: req.isTest === true });
      if (testGate) return testGate;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 4. PROPOSAL CATEGORIZER + REVIEW STATUS                             *
   * ------------------------------------------------------------------ */
  var CATEGORY_LABELS = {
    note_text: 'Note text', diagnosis: 'Diagnosis', billing: 'Billing',
    order_like: 'Order-like', medication: 'Medication', referral: 'Referral', other: 'Other'
  };
  /* Diagnosis is preview-only too — matching the live product's own promise:
     "diagnoses, billing and orders remain preview-only". */
  var PREVIEW_ONLY_CATEGORIES = { medication: 1, order_like: 1, referral: 1, billing: 1, diagnosis: 1 };
  var KIND_MAP = {
    note: 'note_text', note_text: 'note_text', narrative: 'note_text', hpi: 'note_text', exam: 'note_text',
    soap: 'note_text', letter: 'note_text', summary: 'note_text', plan_text: 'note_text', assessment_text: 'note_text',
    diagnosis: 'diagnosis', dx: 'diagnosis', icd: 'diagnosis', assessment_codes: 'diagnosis',
    billing: 'billing', charges: 'billing', charge: 'billing', cpt: 'billing', em: 'billing', superbill: 'billing', codes: 'billing', claim: 'billing',
    order: 'order_like', orders: 'order_like', imaging: 'order_like', lab: 'order_like', labs: 'order_like',
    dme: 'order_like', pt: 'order_like', procedure_order: 'order_like',
    medication: 'medication', med: 'medication', meds: 'medication', rx: 'medication', prescription: 'medication',
    referral: 'referral'
  };
  function categorizeProposal(item) {
    item = item || {};
    var kind = norm(item.kind || item.type || '').replace(/ /g, '_');
    if (KIND_MAP[kind]) return KIND_MAP[kind];
    var body = [item.title, item.label, item.text, item.body].map(text).join(' \n ');
    if (!text(body)) return 'other';
    if (/\b(?:\d+(?:\.\d+)?\s?(?:mg|mcg|ml|cc|units?)\b|sig\s*:|dispense|refills?\b|prescri\w*|e-?rx)\b/i.test(body)) return 'medication';
    if (/\b(?:order(?:s|ed)?\b|mri\b|ct\s+scan|x-?ray|ultrasound|labs?\b|blood\s+work|dme\b|physical\s+therapy\s+\d|imaging\s+stud)/i.test(body)) return 'order_like';
    if (/\brefer(?:ral|red)?\b|\bspecialist\b/i.test(body)) return 'referral';
    if (/\b(?:cpt|e\/?m\s+(?:code|level)|billing|charges?\b|claims?\b|superbill|99\d{3}\b)/i.test(body)) return 'billing';
    if (/\bicd-?10\b|\bdiagnos\w+\b|\b[A-TV-Z]\d{2}\.\d{1,4}\b/i.test(body)) return 'diagnosis';
    if (kind || /\b(?:subjective|objective|assessment|plan|history of present illness|physical exam)\b/i.test(body)) return 'note_text';
    return 'other';
  }
  /* -> { category, categoryLabel, status } where status is one of
     'safe' | 'selected' | 'blocked' | 'needs-manual'. Only note_text is ever
     writable; unknown content fails closed to needs-manual. */
  function evaluateProposal(item) {
    item = item || {};
    var category = categorizeProposal(item);
    var status;
    if (PREVIEW_ONLY_CATEGORIES[category]) status = 'blocked';
    else if (category === 'note_text') status = item.selected === true ? 'selected' : 'safe';
    else status = 'needs-manual';
    return { category: category, categoryLabel: CATEGORY_LABELS[category] || category, status: status };
  }

  /* ------------------------------------------------------------------ *
   * 5. ACCOUNT / PRACTICE / PROVIDER / PATIENT IDENTITY HELPERS         *
   * ------------------------------------------------------------------ */
  /* athenaNet URLs carry the practice (context) id as the first numeric path
     segment: https://athenanet.athenahealth.com/<practiceId>/... */
  function practiceIdFromAthenaUrl(url) {
    try {
      var u = new URL(String(url || ''));
      if (!/(^|\.)athenahealth\.com$/i.test(u.hostname)) return '';
      var m = /^\/(\d{1,9})(?:\/|$)/.exec(u.pathname);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  /* Fail-closed rule: a supplied expectation that cannot be verified BLOCKS.
     With no expectation supplied, we still require the live tab and the locked
     encounter URL to agree on the practice when both expose one. */
  function verifyPracticeConsistency(opts) {
    opts = opts || {};
    var tabPractice = practiceIdFromAthenaUrl(opts.tabUrl);
    var lockedPractice = practiceIdFromAthenaUrl(opts.lockedEncounterUrl);
    if (tabPractice && lockedPractice && tabPractice !== lockedPractice) {
      return { ok: false, blocked: true, reason: 'practice-mismatch', error: 'The open Athena tab is in a different practice than the locked encounter. Nothing was changed.' };
    }
    var expected = digits(opts.expectedPracticeId);
    if (expected) {
      var observed = tabPractice || lockedPractice;
      if (!observed) return { ok: false, blocked: true, reason: 'practice-unverifiable', error: 'The expected practice could not be verified on the open Athena tab. Nothing was changed.' };
      if (observed !== expected) return { ok: false, blocked: true, reason: 'practice-mismatch', error: 'The open Athena tab is not the expected practice. Nothing was changed.' };
    }
    return null;
  }
  function verifyAccountGate(opts) {
    opts = opts || {};
    var expected = nameKey(opts.expectedAccount);
    if (!expected) return null;
    var observed = nameKey(opts.observedAccount);
    if (!observed) return { ok: false, blocked: true, reason: 'account-unverifiable', error: 'The expected signed-in Athena account could not be verified. Nothing was changed.' };
    if (observed !== expected && observed.indexOf(expected) < 0 && expected.indexOf(observed) < 0) {
      return { ok: false, blocked: true, reason: 'account-mismatch', error: 'A different Athena account is signed in than expected. Nothing was changed.' };
    }
    return null;
  }
  function verifyPatientIdentity(opts) {
    opts = opts || {};
    var expected = opts.expected || {}, observed = opts.observed || {};
    if (!nameKey(expected.name) || !nameKey(observed.name)) return { ok: false, blocked: true, reason: 'patient-unverifiable', error: 'Patient identity could not be read from the chart. Nothing was changed.' };
    if (nameKey(expected.name) !== nameKey(observed.name)) return { ok: false, blocked: true, reason: 'patient-mismatch', error: 'The open chart is a different patient. Nothing was changed.' };
    if (digits(expected.mrn) && digits(observed.mrn) && digits(expected.mrn) !== digits(observed.mrn)) return { ok: false, blocked: true, reason: 'patient-mismatch', error: 'The open chart has a different MRN. Nothing was changed.' };
    /* DOB: verified whenever BOTH sides expose one; a missing observed DOB is
       tolerated only when MRN already matched exactly. */
    var expDob = dateDigits(expected.dob), obsDob = dateDigits(observed.dob);
    if (expDob && obsDob && expDob !== obsDob) return { ok: false, blocked: true, reason: 'patient-mismatch', error: 'The open chart has a different date of birth. Nothing was changed.' };
    if (expDob && !obsDob && !(digits(expected.mrn) && digits(expected.mrn) === digits(observed.mrn))) {
      return { ok: false, blocked: true, reason: 'patient-dob-unverifiable', error: 'The chart did not expose a date of birth to verify. Nothing was changed.' };
    }
    return null;
  }
  function dateDigits(v) {
    var m = /([01]?\d)[\/\-.]([0-3]?\d)[\/\-.](\d{2,4})/.exec(String(v || ''));
    if (!m) return '';
    var y = m[3]; if (y.length === 2) y = (Number(y) > ((new Date().getFullYear() % 100) + 1) ? '19' : '20') + y;
    return Number(m[1]) + '/' + Number(m[2]) + '/' + y;
  }
  function verifyProviderMatch(opts) {
    opts = opts || {};
    var expected = norm(opts.expectedProvider), observed = norm(opts.observedProvider);
    if (!expected) return null;
    if (!observed) return { ok: false, blocked: true, reason: 'provider-unverifiable', error: 'The rendering provider could not be verified. Nothing was changed.' };
    if ((' ' + observed + ' ').indexOf(' ' + expected + ' ') < 0 && (' ' + expected + ' ').indexOf(' ' + observed + ' ') < 0) {
      return { ok: false, blocked: true, reason: 'provider-mismatch', error: 'The encounter belongs to a different provider. Nothing was changed.' };
    }
    return null;
  }

  /* Self-contained injected reader: PHI-free Athena chrome only (signed-in
     user label + practice id from the URL). Safe to run in any frame. */
  function readAthenaChromeFn() {
    try {
      function t(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
      var account = '';
      var sels = ['[data-testid*="user-menu" i]', '[data-testid*="username" i]', '[aria-label*="signed in" i]', '#globalusername', '.GlobalUserName', '.global-user-name', '.username', '[class*="userName"]'];
      for (var i = 0; i < sels.length && !account; i++) {
        try {
          var els = document.querySelectorAll(sels[i]);
          for (var j = 0; j < els.length; j++) {
            var v = t(els[j].getAttribute('aria-label') || els[j].textContent);
            if (v && v.length >= 3 && v.length <= 80) { account = v; break; }
          }
        } catch (e) {}
      }
      var practice = '';
      try { var m = /^\/(\d{1,9})(?:\/|$)/.exec(location.pathname); practice = m ? m[1] : ''; } catch (e2) {}
      return { account: account, practiceId: practice, host: location.hostname };
    } catch (e3) { return { account: '', practiceId: '', host: '' }; }
  }

  /* SW-side composite gate used by the V2 execute path just before injection.
     Always verifies practice consistency; verifies account only when an
     expectation is supplied (then fail-closed). */
  function verifyAccountPracticeGate(opts) {
    opts = opts || {};
    var hasChrome = typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.get === 'function';
    if (!hasChrome || opts.tabId == null) {
      return Promise.resolve(digits(opts.expectedPracticeId) || nameKey(opts.expectedAccount)
        ? { ok: false, blocked: true, reason: 'context-unverifiable', error: 'Account/practice expectations could not be verified. Nothing was changed.' }
        : null);
    }
    return chrome.tabs.get(opts.tabId).then(function (tab) {
      var tabUrl = tab && tab.url || '';
      var practiceGate = verifyPracticeConsistency({ tabUrl: tabUrl, lockedEncounterUrl: opts.lockedEncounterUrl, expectedPracticeId: opts.expectedPracticeId });
      if (practiceGate) return practiceGate;
      if (!nameKey(opts.expectedAccount)) return null;
      if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
        return { ok: false, blocked: true, reason: 'account-unverifiable', error: 'The signed-in Athena account could not be read. Nothing was changed.' };
      }
      return chrome.scripting.executeScript({ target: { tabId: opts.tabId }, func: readAthenaChromeFn })
        .then(function (r) {
          var read = r && r[0] && r[0].result || {};
          return verifyAccountGate({ expectedAccount: opts.expectedAccount, observedAccount: read.account });
        })
        .catch(function () {
          return { ok: false, blocked: true, reason: 'account-unverifiable', error: 'The signed-in Athena account could not be read. Nothing was changed.' };
        });
    }).catch(function () {
      return { ok: false, blocked: true, reason: 'context-unverifiable', error: 'The locked Athena tab could not be re-checked. Nothing was changed.' };
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. SYNTHETIC-CLICK INTERCEPTOR (athenanet frames only)              *
   *                                                                     *
   * ENFORCEMENT MODE (v2 refinement before first live load): athenaOne's *
   * own UI code may legitimately route a doctor's REAL click through a   *
   * programmatic .click() on a final control (isTrusted:false at the     *
   * final hop). Consuming those would break the doctor's own signing     *
   * workflow. Until live QA proves Athena's normal flows produce ZERO    *
   * monitor hits, the interceptor defaults to MONITOR (log + count, no   *
   * consume). Flip with chrome.storage.local {mlsWriteSafetyEnforce:     *
   * 'enforce'} — takes effect live via storage.onChanged. The extension's*
   * OWN final-action paths remain hard-blocked regardless by the bridge  *
   * gate, the background policy gate, and the in-driver clickOnce guard. *
   * ------------------------------------------------------------------ */
  var _blockLog = [];
  var ENFORCE_KEY = 'mlsWriteSafetyEnforce';
  var _enforcement = 'monitor'; // 'monitor' | 'enforce' — monitor is the fail-safe default
  function getEnforcement() { return _enforcement; }
  function _setEnforcement(mode) { _enforcement = mode === 'enforce' ? 'enforce' : 'monitor'; return _enforcement; }
  function loadEnforcement() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([ENFORCE_KEY], function (c) {
          try { _setEnforcement(c && c[ENFORCE_KEY]); } catch (e) {}
        });
        if (chrome.storage.onChanged) chrome.storage.onChanged.addListener(function (ch, area) {
          if (area === 'local' && ch && ch[ENFORCE_KEY]) { try { _setEnforcement(ch[ENFORCE_KEY].newValue); } catch (e) {} }
        });
      }
    } catch (e) {}
  }
  function recordBlock(entry) {
    _blockLog.push(entry);
    if (_blockLog.length > 50) _blockLog.shift();
    try {
      console.warn('[MLS write-safety]' + (entry.enforced ? ' BLOCKED' : ' [MONITOR] would block') +
        ' synthetic ' + entry.type + ' on forbidden control: "' + entry.label + '"');
    } catch (e) {}
  }
  function getBlockLog() { return _blockLog.slice(); }

  /* MLS_WRITE_SAFETY_INTERCEPTOR_START */
  function makeInterceptorHandler(win) {
    return function (ev) {
      try {
        if (!ev || ev.isTrusted === true) return; // real user input is never touched
        var path = [];
        try { path = ev.composedPath ? ev.composedPath() : []; } catch (e) {}
        var target = ev.target || null;
        var forbidden = null;
        if (String(ev.type).toLowerCase() === 'submit') {
          var submitter = ev.submitter || null;
          forbidden = submitter && isForbiddenControl(submitter) ? submitter : null;
        } else {
          forbidden = findForbiddenInPath(path, target);
        }
        if (!forbidden) return;
        var enforced = _enforcement === 'enforce';
        if (enforced) {
          try { ev.preventDefault(); } catch (e1) {}
          try { ev.stopImmediatePropagation(); } catch (e2) {}
          try { ev.stopPropagation(); } catch (e3) {}
        }
        recordBlock({ type: String(ev.type), enforced: enforced, mode: _enforcement, label: shortLabel(forbidden).join(' | ').slice(0, 120) || attrHay(forbidden).slice(0, 120), at: Date.now() });
      } catch (eOuter) {}
    };
  }
  var INTERCEPTED_EVENTS = ['click', 'auxclick', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'submit'];
  function installSyntheticClickInterceptor(win) {
    win = win || (typeof window !== 'undefined' ? window : null);
    if (!win || !win.addEventListener) return false;
    var KEY = '__mlsWriteSafetyInterceptorV1';
    if (win[KEY]) return true; // idempotent per window
    var handler = makeInterceptorHandler(win);
    for (var i = 0; i < INTERCEPTED_EVENTS.length; i++) {
      win.addEventListener(INTERCEPTED_EVENTS[i], handler, { capture: true, passive: false });
    }
    loadEnforcement();
    win[KEY] = { version: VERSION, handler: handler };
    return true;
  }
  /* MLS_WRITE_SAFETY_INTERCEPTOR_END */

  /* ------------------------------------------------------------------ *
   * Export + auto-arm                                                   *
   * ------------------------------------------------------------------ */
  root.MLSWriteSafety = {
    version: VERSION,
    // spec (read-only views for audits/tests)
    FORBIDDEN_LABEL_SOURCES: FORBIDDEN_LABEL_SOURCES.slice(),
    FORBIDDEN_ATTR_FRAGMENTS: FORBIDDEN_ATTR_FRAGMENTS.slice(),
    FORBIDDEN_SELECTORS: FORBIDDEN_SELECTORS.slice(),
    BLOCKED_EXECUTE_ACTIONS: BLOCKED_EXECUTE_ACTIONS,
    PREVIEW_ONLY_CATEGORIES: PREVIEW_ONLY_CATEGORIES,
    // matchers
    isControlish: isControlish,
    isForbiddenControl: isForbiddenControl,
    findForbiddenInPath: findForbiddenInPath,
    shortLabel: shortLabel,
    // policy
    gateActionRequest: gateActionRequest,
    checkTestWritePolicy: checkTestWritePolicy,
    looksLikeTestContent: looksLikeTestContent,
    containsClinicalDirectives: containsClinicalDirectives,
    // review categorization
    categorizeProposal: categorizeProposal,
    evaluateProposal: evaluateProposal,
    CATEGORY_LABELS: CATEGORY_LABELS,
    // identity
    practiceIdFromAthenaUrl: practiceIdFromAthenaUrl,
    verifyPracticeConsistency: verifyPracticeConsistency,
    verifyAccountGate: verifyAccountGate,
    verifyPatientIdentity: verifyPatientIdentity,
    verifyProviderMatch: verifyProviderMatch,
    verifyAccountPracticeGate: verifyAccountPracticeGate,
    readAthenaChromeFn: readAthenaChromeFn,
    // interceptor
    installSyntheticClickInterceptor: installSyntheticClickInterceptor,
    makeInterceptorHandler: makeInterceptorHandler,
    getBlockLog: getBlockLog,
    getEnforcement: getEnforcement,
    _setEnforcement: _setEnforcement, // tests + live QA flip; production flips via chrome.storage mlsWriteSafetyEnforce
    ENFORCE_KEY: ENFORCE_KEY,
    // internals exposed for tests
    _norm: norm, _digits: digits, _nameKey: nameKey, _simpleHash: simpleHash
  };

  try {
    if (typeof window !== 'undefined' && window.location &&
        String(window.location.hostname || '').toLowerCase() === 'athenanet.athenahealth.com') {
      installSyntheticClickInterceptor(window);
    }
  } catch (eArm) {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
