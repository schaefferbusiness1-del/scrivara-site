/* Byte-safe editor for background.js (mixed-EOL file — Edit tools are unsafe).
 * Reads the file as latin1 (1 byte == 1 char), applies anchored insertions /
 * one exact replacement, verifies each anchor occurs exactly once BEFORE
 * writing, then verifies EOL integrity AFTER: CR count unchanged (every
 * inserted block is pure-LF) and total growth equals the inserted byte count.
 * Idempotent: refuses to run twice (marker check). */
'use strict';
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'background.js');
let buf = fs.readFileSync(target, 'latin1');
const beforeBytes = buf.length;
const beforeCRs = (buf.match(/\r/g) || []).length;

if (buf.includes('MLS_WRITE_SAFETY_GATE_START')) {
  console.error('ALREADY APPLIED — refusing to double-apply.');
  process.exit(2);
}

function countOccurrences(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; }
  return n;
}
function insertAfterLineContaining(anchor, block) {
  if (countOccurrences(buf, anchor) !== 1) throw new Error('anchor not unique: ' + JSON.stringify(anchor.slice(0, 60)));
  const at = buf.indexOf(anchor);
  const nl = buf.indexOf('\n', at + anchor.length);
  if (nl < 0) throw new Error('no newline after anchor');
  if (/\r/.test(block)) throw new Error('block contains CR');
  buf = buf.slice(0, nl + 1) + block + '\n' + buf.slice(nl + 1);
  return block.length + 1;
}
function insertBeforeLineContaining(anchor, block) {
  if (countOccurrences(buf, anchor) !== 1) throw new Error('anchor not unique: ' + JSON.stringify(anchor.slice(0, 60)));
  const at = buf.indexOf(anchor);
  let lineStart = buf.lastIndexOf('\n', at);
  lineStart = lineStart < 0 ? 0 : lineStart + 1;
  if (/\r/.test(block)) throw new Error('block contains CR');
  buf = buf.slice(0, lineStart) + block + '\n' + buf.slice(lineStart);
  return block.length + 1;
}
function replaceExact(from, to) {
  if (countOccurrences(buf, from) !== 1) throw new Error('replace anchor not unique: ' + JSON.stringify(from.slice(0, 60)));
  if ((to.match(/\r/g) || []).length !== (from.match(/\r/g) || []).length) throw new Error('replacement changes CR count');
  buf = buf.replace(from, to);
  return to.length - from.length;
}

let inserted = 0;

/* 1. Load the guard + teach memory modules in the service worker. */
inserted += insertAfterLineContaining(
  "try { importScripts('feat_codes_driver.js'); } catch (e) {}",
  "try { importScripts('write_safety_guard.js', 'teach_destination_memory.js'); } catch (e) {} /* wsg-1.0.0 + tdm-1.0.0; a load failure fail-closes final actions at the gate below */"
);

/* 2. Policy gate at the top of the V2 message handler. */
inserted += insertAfterLineContaining(
  "if (!/^(probe|execute)$/.test(mode) || !ACTIONS[action]) return { ok: false, blocked: true, reason: 'unknown-action' };",
  [
    "      /* MLS_WRITE_SAFETY_GATE_START (wsg-1.0.0) — sign/order/billing lanes are",
    "         PREVIEW-ONLY: probe stays available for the review screen; execute is",
    "         refused here, again inside the driver, and the athenanet synthetic-click",
    "         interceptor is the final backstop. Also enforces the Adam-only (7833832)",
    "         TEST-content policy on note writes. Fail-closed if the guard is absent. */",
    "      if (self.MLSWriteSafety) {",
    "        var wsGate = self.MLSWriteSafety.gateActionRequest({ mode: mode, action: action, expectedPatient: msg.expectedPatient, noteText: msg.noteText, isTest: msg.isTest === true });",
    "        if (wsGate) return wsGate;",
    "      } else if (mode === 'execute' && (action === 'sign_encounter' || action === 'place_order' || action === 'stage_billing')) {",
    "        return { ok: false, blocked: true, reason: 'write-safety-guard-missing', error: 'The write-safety guard failed to load; final actions are blocked. Nothing was changed.' };",
    "      }",
    "      /* MLS_WRITE_SAFETY_GATE_END */"
  ].join('\n')
);

/* 3. Account/practice verification immediately before the execute injection. */
inserted += insertBeforeLineContaining(
  "executeBusy = true;",
  [
    "      /* MLS_WRITE_SAFETY_CONTEXT_GATE_START (wsg-1.0.0) — verify the signed-in",
    "         account (when the app supplied an expectation) and that the live Athena",
    "         tab's practice id matches the locked encounter's practice id. Supplied",
    "         expectations that cannot be verified BLOCK (fail-closed). */",
    "      if (self.MLSWriteSafety) {",
    "        var wsCtxGate = await self.MLSWriteSafety.verifyAccountPracticeGate({ tabId: rec.athenaTabId, expectedAccount: clean(msg.expectedAccount), expectedPracticeId: clean(msg.expectedPracticeId), lockedEncounterUrl: rec.locked && rec.locked.encounterUrl });",
    "        if (wsCtxGate && wsCtxGate.blocked) return wsCtxGate;",
    "      }",
    "      /* MLS_WRITE_SAFETY_CONTEXT_GATE_END */"
  ].join('\n')
);

/* 4a. In-driver guard: forbidden-control matcher + final-action refusal. */
inserted += insertAfterLineContaining(
  "    if (!ACTIONS[action]) return { ok: false, blocked: true, reason: 'unknown-action' };",
  [
    "    /* MLS_WRITE_SAFETY_DRIVER_GUARD_START (wsg-1.0.0) — self-contained in-page",
    "       defense in depth. The driver refuses to EXECUTE final/financial actions",
    "       and clickOnce refuses ANY control whose own label or machine name marks a",
    "       final/irrevocable action (sign, sign off, submit, send, approve, finalize,",
    "       place order, prescribe, transmit, post charges, file claim...). This list",
    "       mirrors write_safety_guard.js FORBIDDEN_LABEL_SOURCES / _ATTR_FRAGMENTS. */",
    "    var WS_FORBIDDEN_LABELS = [/\\bsign\\b/, /\\bsigns?\\s+and\\s+saves?\\b/, /\\bco\\s?sign\\b/, /\\battest\\b/, /\\bsubmit\\b/, /\\bsend\\b/, /\\bapprove\\b/, /\\bfinali[sz]e\\b/, /\\bplace\\s+orders?\\b/, /\\badd\\s+orders?\\b/, /\\bprescribe\\b/, /\\be\\s?(?:rx|prescribe|prescription)\\b/, /\\btransmit\\b/, /\\bpost\\s+charges?\\b/, /\\bfile\\s+claims?\\b/, /\\bsubmit\\s+claims?\\b/, /\\bbill\\s+(?:now|patient|insurance)\\b/, /\\bclose\\s+encounter\\b/, /\\bdelete\\s+(?:chart|patient|encounter)\\b/];",
    "    var WS_FORBIDDEN_ATTRS = ['signoff','sign-off','sign_off','signandsave','sign-and-save','sign_and_save','signsave','signencounter','sign-encounter','sign_encounter','placeorder','place-order','place_order','submitorder','submit-order','submit_order','sendorder','send-order','send_order','approveorder','approve-order','prescribe','e-rx','erx-send','sendrx','send-rx','transmitrx','transmit-rx','sendtopharmacy','send-to-pharmacy','finalizenote','finalize-note','finalize_note','postcharge','post-charge','post_charge','submitclaim','submit-claim','fileclaim','file-claim','closeencounter','close-encounter','mls-forbidden'];",
    "    function wsForbiddenControl(el) {",
    "      if (!el || el.nodeType !== 1) return false;",
    "      var wsLabels = [];",
    "      try { wsLabels = [el.textContent, el.value, el.getAttribute && el.getAttribute('aria-label'), el.getAttribute && el.getAttribute('title')].map(function (v) { return norm(v); }).filter(function (v) { return v && v.length <= 120; }); } catch (eWsL) {}",
    "      for (var wsI = 0; wsI < wsLabels.length; wsI++) for (var wsJ = 0; wsJ < WS_FORBIDDEN_LABELS.length; wsJ++) if (WS_FORBIDDEN_LABELS[wsJ].test(wsLabels[wsI])) return true;",
    "      var wsHay = '';",
    "      try { wsHay = [el.id, el.getAttribute && el.getAttribute('name'), el.getAttribute && el.getAttribute('data-action'), el.getAttribute && el.getAttribute('data-testid'), String(el.className || '')].join(' ').toLowerCase(); } catch (eWsH) {}",
    "      for (var wsK = 0; wsK < WS_FORBIDDEN_ATTRS.length; wsK++) if (wsHay.indexOf(WS_FORBIDDEN_ATTRS[wsK]) >= 0) return true;",
    "      return false;",
    "    }",
    "    if (mode === 'execute' && (action === 'sign_encounter' || action === 'place_order' || action === 'stage_billing')) {",
    "      return { ok: false, blocked: true, reason: 'write-safety-final-action-blocked', error: 'This action is preview-only by write-safety policy. Perform the final step yourself in athenaOne. Nothing was changed.' };",
    "    }",
    "    /* MLS_WRITE_SAFETY_DRIVER_GUARD_END */"
  ].join('\n')
);

/* 4b. clickOnce: last-instant refusal before any driver click. */
inserted += replaceExact(
  "function clickOnce(el) { try { el.scrollIntoView({ block: 'center' }); } catch (e) {} el.click(); }",
  "function clickOnce(el) { if (wsForbiddenControl(el)) throw new Error('forbidden-control-blocked'); try { el.scrollIntoView({ block: 'center' }); } catch (e) {} el.click(); }"
);

/* 5. Persist every validated teach capture per (practice, provider, action, section). */
inserted += insertBeforeLineContaining(
  "teachProgress(capturedSession, 'captured',",
  [
    "        /* MLS_TEACH_MEMORY_HOOK_START (tdm-1.0.0) — remember the validated,",
    "           PHI-free layout record so this destination survives per practice/",
    "           provider/layout. Recall is a hint only; writes still re-validate. */",
    "        try {",
    "          if (self.MLSTeachMemory && checked.context) {",
    "            self.MLSTeachMemory.saveCaptured({",
    "              practiceId: (self.MLSWriteSafety && self.MLSWriteSafety.practiceIdFromAthenaUrl(checked.context.encounterUrl)) || '',",
    "              provider: checked.context.provider || (capturedSession.context && capturedSession.context.provider) || '',",
    "              action: capturedSession.action,",
    "              target: validatedTarget",
    "            });",
    "          }",
    "        } catch (eTeachMemory) {}",
    "        /* MLS_TEACH_MEMORY_HOOK_END */"
  ].join('\n')
);

fs.writeFileSync(target, buf, 'latin1');

/* Post-write verification */
const after = fs.readFileSync(target, 'latin1');
const afterCRs = (after.match(/\r/g) || []).length;
if (afterCRs !== beforeCRs) { console.error('EOL DAMAGE: CR count changed', beforeCRs, '->', afterCRs); process.exit(1); }
if (after.length !== beforeBytes + inserted) { console.error('SIZE MISMATCH: expected', beforeBytes + inserted, 'got', after.length); process.exit(1); }
for (const marker of ['MLS_WRITE_SAFETY_GATE_START', 'MLS_WRITE_SAFETY_CONTEXT_GATE_START', 'MLS_WRITE_SAFETY_DRIVER_GUARD_START', 'MLS_TEACH_MEMORY_HOOK_START', "importScripts('write_safety_guard.js'"]) {
  if (countOccurrences(after, marker) !== 1) { console.error('MARKER MISSING/DUPED:', marker); process.exit(1); }
}
console.log('OK: applied. bytes', beforeBytes, '->', after.length, '(+' + inserted + '), CRs unchanged at', afterCRs);
