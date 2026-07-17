/* v2.9.31 multi-tab write lane: byte-safe latin1 edits to background.js.
 * Rules: ASCII-only insertions, LF-only line endings inside replacements,
 * every anchor must occur exactly once, CR census must be unchanged. */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'background.js');
const src = fs.readFileSync(FILE, 'latin1');
const crCount = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\r') n++; return n; };
const CR_BEFORE = crCount(src);

function replaceOnce(hay, oldStr, newStr, label) {
  const first = hay.indexOf(oldStr);
  if (first < 0) throw new Error('anchor missing: ' + label);
  if (hay.indexOf(oldStr, first + 1) >= 0) throw new Error('anchor not unique: ' + label);
  if (/[^\x00-\x7F]/.test(newStr)) throw new Error('non-ASCII in replacement: ' + label);
  if (/\r/.test(newStr)) throw new Error('CR in replacement: ' + label);
  return hay.slice(0, first) + newStr + hay.slice(first + oldStr.length);
}

let out = src;

/* 1. pickExactAthena -> pickAthenaWriteCandidates (returns the candidate SET) */
out = replaceOnce(out,
"  async function pickExactAthena(sender, expectedPatient, all) {\n" +
"    /* Final/financial actions are stricter than read and narrative-draft lanes:\n" +
"       more than one signed-in Athena tab is always ambiguous, even if an older\n" +
"       read flow remembered a target. */\n" +
"    var candidates = exactAthenaTabs(all);\n" +
"    if (candidates.length !== 1) return { __error: candidates.length ? 'ambiguous-athena-tabs' : 'no-athena-tab', __message: candidates.length ? 'More than one signed-in Athena tab is open. Leave exactly one Athena tab open, then retry. Nothing was changed.' : 'Open one signed-in Athena tab, then retry. Nothing was changed.' };\n" +
"    return candidates[0];\n" +
"  }",
"  async function pickAthenaWriteCandidates(all) {\n" +
"    /* v2.9.31 multi-tab support: more than one signed-in Athena tab no longer\n" +
"       blocks the supervised lane by itself. Ambiguity moved to the encounter\n" +
"       level - the probe injects read-only into EVERY signed-in Athena tab and\n" +
"       proceeds only when exactly one tab verifies the expected patient and\n" +
"       encounter context. Zero signed-in tabs and duplicate verified\n" +
"       encounters still fail closed. */\n" +
"    var candidates = exactAthenaTabs(all);\n" +
"    if (!candidates.length) return { __error: 'no-athena-tab', __message: 'Open one signed-in Athena tab, then retry. Nothing was changed.' };\n" +
"    return candidates;\n" +
"  }",
'pickExactAthena rewrite');

/* 2. Probe branch: scan every signed-in tab; require exactly one verified */
out = replaceOnce(out,
"        var all = await chrome.tabs.query({}), tab = await pickExactAthena(sender, p, all);\n" +
"        if (tab && tab.__error) return { ok: false, blocked: true, reason: tab.__error, error: tab.__message };\n" +
"        if (action === 'sign_encounter') {\n" +
"          proofRecord = matchingNoteWriteProof(noteWriteProofId, sender.tab.id, tab.id, p, previewHash, noteHash, canonicalNotePayload, null);\n" +
"          if (!proofRecord) return { ok: false, blocked: true, reason: noteWriteProofFailure(noteWriteProofId), error: 'Write and verify this exact reviewed note in this encounter before signing.' };\n" +
"        }\n" +
"        var probe = await injectOnce(tab.id, { mode: 'probe', action: action, expectedPatient: p, expectedContext: c, billing: b, order: checkedOrder.order, noteText: noteText, notePolicy: notePolicy, locked: null, taughtDestination: checkedTaught.value });\n" +
"        if (!probe || !probe.ok || !probe.contextVerified || !lockedContextShape(probe.context)) return probe && probe.ok ? { ok: false, blocked: true, reason: 'context-unverified' } : (probe || { ok: false, blocked: true, reason: 'context-unverified' });",
"        var all = await chrome.tabs.query({}), athCandidates = await pickAthenaWriteCandidates(all);\n" +
"        if (athCandidates && athCandidates.__error) return { ok: false, blocked: true, reason: athCandidates.__error, error: athCandidates.__message };\n" +
"        /* Probe every signed-in Athena tab read-only. Exactly ONE tab must\n" +
"           verify the expected patient+encounter context; zero verified tabs\n" +
"           returns the first honest probe failure, and duplicate verified\n" +
"           encounters fail closed as ambiguous-athena-tabs. The token minted\n" +
"           below stays bound to the single verified tab id. */\n" +
"        var tab = null, probe = null, probeFailure = null, verifiedTabCount = 0;\n" +
"        for (var athIdx = 0; athIdx < athCandidates.length; athIdx++) {\n" +
"          var athProbe = await injectOnce(athCandidates[athIdx].id, { mode: 'probe', action: action, expectedPatient: p, expectedContext: c, billing: b, order: checkedOrder.order, noteText: noteText, notePolicy: notePolicy, locked: null, taughtDestination: checkedTaught.value });\n" +
"          if (athProbe && athProbe.ok && athProbe.contextVerified && lockedContextShape(athProbe.context)) { verifiedTabCount++; if (!tab) { tab = athCandidates[athIdx]; probe = athProbe; } }\n" +
"          else if (!probeFailure) probeFailure = athProbe && athProbe.ok ? { ok: false, blocked: true, reason: 'context-unverified' } : (athProbe || { ok: false, blocked: true, reason: 'context-unverified' });\n" +
"        }\n" +
"        if (verifiedTabCount > 1) return { ok: false, blocked: true, reason: 'ambiguous-athena-tabs', error: 'The same verified encounter matched in more than one signed-in Athena tab. Close the duplicate encounter tab, then retry. Nothing was changed.' };\n" +
"        if (!tab || !probe) return probeFailure || { ok: false, blocked: true, reason: 'context-unverified' };\n" +
"        if (action === 'sign_encounter') {\n" +
"          proofRecord = matchingNoteWriteProof(noteWriteProofId, sender.tab.id, tab.id, p, previewHash, noteHash, canonicalNotePayload, null);\n" +
"          if (!proofRecord) return { ok: false, blocked: true, reason: noteWriteProofFailure(noteWriteProofId), error: 'Write and verify this exact reviewed note in this encounter before signing.' };\n" +
"        }",
'probe scan rewrite');

/* 3. Execute gate: locked tab must still be signed in; others are irrelevant */
out = replaceOnce(out,
"      /* Re-query the complete tab set at the last pre-mutation gate. A token\n" +
"         cannot remain valid if another signed-in Athena tab appeared, the\n" +
"         locked tab signed out, or a different Athena tab replaced it. */\n" +
"      var liveCandidates = exactAthenaTabs(await chrome.tabs.query({}));\n" +
"      if (liveCandidates.length !== 1 || Number(liveCandidates[0].id) !== Number(rec.athenaTabId)) return { ok: false, blocked: true, reason: 'token-tab-mismatch', error: liveCandidates.length > 1 ? 'More than one signed-in Athena tab is open. Leave exactly one Athena tab open, then retry. Nothing was changed.' : 'The locked Athena tab is no longer the only signed-in Athena tab. Nothing was changed.' };",
"      /* Re-query the complete tab set at the last pre-mutation gate. The\n" +
"         token stays bound to the exact tab that verified this encounter at\n" +
"         probe time; that tab must still be open and signed in. Other Athena\n" +
"         tabs no longer invalidate the token - the execute injection targets\n" +
"         only rec.athenaTabId and the driver re-verifies patient identity and\n" +
"         encounter context inside that tab before any mutation. */\n" +
"      var liveCandidates = exactAthenaTabs(await chrome.tabs.query({}));\n" +
"      var lockedLive = liveCandidates.filter(function (lt) { return Number(lt.id) === Number(rec.athenaTabId); });\n" +
"      if (lockedLive.length !== 1) return { ok: false, blocked: true, reason: 'token-tab-mismatch', error: 'The Athena tab this action was verified in is no longer open and signed in. Nothing was changed.' };",
'execute gate rewrite');

/* 4. Teach start: pick most recently used tab instead of aborting */
out = replaceOnce(out,
"      var tabs = exactAthenaTabs(await chrome.tabs.query({}));\n" +
"      if (!teachCurrent(session)) return { ok: false, state: 'failed', reason: 'cancelled', message: 'Teaching was cancelled before the watcher started.' };\n" +
"      if (tabs.length !== 1) {\n" +
"        clearTeachSession(session);\n" +
"        return { ok: false, state: 'failed', reason: tabs.length ? 'ambiguous-athena-tabs' : 'no-athena-tab', message: tabs.length ? 'Leave exactly one signed-in Athena tab open, then try again.' : 'Open one signed-in Athena tab, then try again.' };\n" +
"      }\n" +
"      session.athenaTabId = tabs[0].id;",
"      var tabs = exactAthenaTabs(await chrome.tabs.query({}));\n" +
"      if (!teachCurrent(session)) return { ok: false, state: 'failed', reason: 'cancelled', message: 'Teaching was cancelled before the watcher started.' };\n" +
"      if (!tabs.length) {\n" +
"        clearTeachSession(session);\n" +
"        return { ok: false, state: 'failed', reason: 'no-athena-tab', message: 'Open one signed-in Athena tab, then try again.' };\n" +
"      }\n" +
"      /* v2.9.31: multiple signed-in Athena tabs no longer abort teaching. The\n" +
"         watcher arms in the most recently used Athena tab and the status\n" +
"         message says so; clicks in other Athena tabs are not captured. */\n" +
"      if (tabs.length > 1) tabs.sort(function (ta, tb) { return (Number(tb.lastAccessed) || 0) - (Number(ta.lastAccessed) || 0); });\n" +
"      var teachTabNote = tabs.length > 1 ? ' Multiple Athena tabs are open - the most recently used one is being watched; click the destination in that exact tab.' : '';\n" +
"      session.athenaTabId = tabs[0].id;",
'teach start rewrite');

/* 5. Teach waiting messages carry the multi-tab note */
out = replaceOnce(out,
"      teachProgress(session, 'waiting', { ok: true, message: 'Waiting for the next Athena click. That teaching click will be blocked from activating the control.' });",
"      teachProgress(session, 'waiting', { ok: true, message: 'Waiting for the next Athena click. That teaching click will be blocked from activating the control.' + teachTabNote });",
'teach progress message');
out = replaceOnce(out,
"      return { ok: true, state: 'waiting', requestId: requestId, expiresAt: session.expiresAt, message: 'Connected. Waiting for the next Athena click.' };",
"      return { ok: true, state: 'waiting', requestId: requestId, expiresAt: session.expiresAt, message: 'Connected. Waiting for the next Athena click.' + teachTabNote };",
'teach connected message');

const CR_AFTER = crCount(out);
if (CR_AFTER !== CR_BEFORE) throw new Error('CR census changed: ' + CR_BEFORE + ' -> ' + CR_AFTER);
if (out.indexOf('pickExactAthena') >= 0) throw new Error('stale pickExactAthena reference remains');
fs.writeFileSync(FILE, out, 'latin1');
console.log('OK background.js: CRs', CR_AFTER, 'size', out.length);
