'use strict';

/* 2026-07-29 contract: a schedule row that re-renders while being verified is
 * re-located by its stable key and re-verified (bounded: 2 extra passes with a
 * short settle). If it still refuses:
 *   - a row PROVABLY carrying no appointment id and no patient identity (a
 *     hold/block/frame row) is named in the receipt as
 *     unverifiableRows:[{kind:'no-identity-cell',...}], is NOT counted in
 *     parsedCount, and the day completes only when
 *     expectedCount - provenNonClinical === parsedCount;
 *   - any identity-bearing or still-mutating row keeps the day incomplete
 *     exactly as before (kind:'mutating'). A patient row is never guessed.
 *
 * Rev-2 (3.0.33) SNAPSHOT contract: live DOM walks lose the race against
 * Athena's React check-in widget, which continuously replaces the row subtree
 * (live-proven Friday 2026-07-31, appt 45532929: the row vanished between two
 * probes seconds apart while ONE synchronous outerHTML capture read it
 * intact). The reader captures outerHTML in ONE synchronous read and parses
 * identity from that STRING (_snapIdentity): a string cannot churn. The
 * First-Last capitalized-pair shape is accepted ONLY when the same row
 * carries an appointment id AND the name sits in a patient-bound region
 * (encounter-link anchor / patient-name node / data-patient-name) - the
 * id + confident-name bar the structured lane already uses. Conflicting ids,
 * foreign times, and multiple distinct region names stay refused as mutating.
 *
 * Rev-3 (3.0.34) CONTENT-KEYED STABILITY + WELD-HARDENED SNAPSHOT PARSE:
 * live Friday 2026-07-31 proof - the dashboard paints every appointment as
 * TWO identical LI copies in parallel appointments-container lists, and the
 * async check-in columns re-render/re-sort one copy pair mid-walk. (a) An
 * unresolved instance whose appointment id (or normalized text) already
 * produced a parsed row is a duplicate render of captured content: STABLE
 * regardless of DOM node identity or position, never kind:'mutating'.
 * (b) The live 9:40 row was INTACT at rest yet _snapIdentity extracted
 * nothing: the name rides raw row text (no patient-bound region) and athena
 * welds tokens ("40min"+first name, last name+"NNyo"). _snapIdentity now
 * strips/normalizes the known athena tokens BEFORE a capitalized-pair scan
 * over the whole snapshot text - accepted ONLY with the appointment id on
 * the same row, single unambiguous pair run, 2-letter-plus tokens. (c) Every
 * snapshot-read receipt row now names the failing stage in snapshotParse:
 * 'no-id-on-row' | 'no-name-candidate' | 'ambiguous-candidates' | 'accepted'
 * (plus 'foreign-time' | 'id-conflict' | 'empty-snapshot' for the early
 * refusals), so the next live run reads the failure directly.
 *
 * Rev-4 (3.0.35) SURNAME-AMBIGUOUS SCHEDULING TOKENS: replaying the real
 * functions stage-by-stage against the live Friday 2026-07-31 row showed the
 * surname surviving strip-duration and then VANISHING at the bare-"min"
 * cleanup, because that rule carried an /i flag - a short capitalized surname
 * that spells a duration word was deleted, no adjacent capitalized pair could
 * form, and the receipt reported snapshotParse:'no-name-candidate' (the whole
 * reason that Friday was deterministically 6-of-7 in every mode). A second,
 * independent instance of the same collision sat one stage later: okTok
 * rejected every token matching STOP case-insensitively, and STOP carries
 * several real surnames (min/mins/minute/minutes, no, fu, np, est). Fix:
 * (a) the BARE-token min cleanup is case-sensitive, so lowercase duration
 * remnants still clear while a Capitalized surname survives - the preceding
 * \d+\s*min rule keeps its /i and still handles "40Min"/"40MIN"; (b) okTok
 * exempts a narrow scope-local list of surname-ambiguous STOP entries, since
 * okTok already demands a Capitalized token and athena's scheduling
 * vocabulary in this grid renders lowercase ("40min") or ALL-CAPS. The shared
 * STOP regex is NOT edited - other call sites depend on it. Genuine duration
 * text must still strip and must never become a name candidate.
 *
 * (c) The exemption alone traded a refusal for a WRONG NAME: an exempted token
 * landing next to a genuine pair EXTENDED it, so a row carrying Capitalized
 * status text imported "Roy Lee No" instead of "Roy Lee". For an identity gate
 * a wrong name is strictly worse than refusing the day, so an ambiguous token
 * may participate in a run ONLY when the run is exactly 2 tokens AND the other
 * token is not itself ambiguous. Refusing the join must NOT discard the run -
 * the tokens that legitimately formed it are still emitted, or Friday breaks
 * again. Runs of unambiguous tokens (including genuine three-part names) are
 * untouched.
 *
 * Rev-5 (3.0.36) DIAGNOSTIC ONLY - NAME THE DOM-VALIDATION REMOVAL: live
 * Friday 2026-07-31 on 3.0.35 still reported expected 7 / parsed 6 /
 * invalidRowsRemoved 1 with unverifiableRows EMPTY, because the row is dropped
 * at mlsMergeSchedule.filterSource - a stage BEFORE the re-verify lane that
 * unverifiableRows can see. Four distinct rejection causes hid behind one
 * short-circuit condition and the receipt could not say which one fired. The
 * stage now emits invalidRows[]: one bounded (<=20) entry per removed row
 * carrying the FIRST failing check as a closed-vocabulary `reason`, plus the
 * same non-clinical fields unverifiableRows uses (appointmentId, time,
 * provider, lane) and LENGTH/shape hints. Accept/reject is byte-identical -
 * pinned below by replaying every fixture through the pre-3.0.36 reader.
 *
 * Rev-6 (3.0.37) THE SURNAME-AMBIGUOUS STOP COLLISION AT THE SECOND CALL SITE:
 * the 3.0.36 diagnostic did its job. Live Friday 2026-07-31, real athenaOne:
 * expected 7 / parsed 6 / domValidRows 6 / invalidRowsRemoved 1 and now a NAME
 * for the casualty - reason 'single-name-token', appointmentId 45532929,
 * lane 'dom', textLen 7, nameTokenCount 1. The row is fully resolved to a named
 * appointment (unnamedCount 0, unverifiableRowCount 0) and is then killed in
 * mlsMergeSchedule.filterSource by nameTokens(n).length < 2: a 7-character
 * two-part name of which exactly ONE token survived tokenisation. That is the
 * 3.0.35 defect class at the OTHER call site - nameTokens filters through the
 * SHARED STOP regex, which carries entries that are real surnames
 * (min|mins|minute|minutes|no|fu|np|est). 3.0.35 exempted them inside okTok and
 * deliberately left STOP alone because other call sites read it; this is one of
 * those call sites. The exemption is scope-local to nameTokens and fail-closed
 * three ways: (a) only a token appearing as a whole CAPITALIZED word in the
 * original text may be exempted, (b) an ambiguous token may never OPEN a name -
 * at least one NON-ambiguous token must already have been kept, so 'No Show' /
 * 'No Answer' / 'No Fu' still refuse, and (c) length, CRED_I, RE_CRED,
 * isProviderUiLabel, isCapacitySlotName, firstTime and the shared STOP itself
 * are untouched. Both the BEFORE (3.0.36) and the AFTER reader are replayed
 * against the same fixtures below, so the fix can never be asserted vacuously.
 *
 * Rev-8 (3.0.38) THE ROW-INTERNAL HEADER: live Tue 2026-08-04, real athenaOne,
 * selected-provider mode. The schedule READ was clean - complete:true,
 * expectedCount 2, parsedCount 2 - and the day still imported ZERO rows:
 *   providerRosterReceipt: { reason:'legacy-unverified', complete:false,
 *     partial:true, observedCount:2, expectedCount:null,
 *     attributionCoverage:{ verdict:'row-unattributed', rows:2, headerCount:2,
 *                           unattributedRows:2, foreignRows:0 } }
 * TWO credentialed provider headers were harvested over ONE container.
 * Per-container binding requires exactly one, so neither row bound, and the
 * coverage rule refused the day. The second "header" is a PER-ROW artifact:
 * tiers 1 and 2 of _legacyHeaderTextsL query the WHOLE container with no row
 * exclusion, and tier 2 matches [class*="appointment-header"] by SUBSTRING, so
 * a per-row cell (appointment-header-detail) reading "Supervising: <Name> DO",
 * "Referred by <Name> MD" or "PCP: <Name> NP" registers as a COLUMN header.
 * THE FIX IS IN THE HARVEST, NEVER IN THE BINDING. Rows are NEVER bound
 * positionally: binding a visit to a clinician who did not render it is far
 * worse than refusing the day, and the coverage gate cannot even see a WRONG
 * binding (it counts EMPTY and OFF-ROSTER providers only, so a wrong bind reads
 * GREEN). Excluding a node that is not really a column header is monotonically
 * safe - it can only ever REMOVE a false header. Both outcomes below are
 * therefore acceptable: the row artifact drops out and the EXISTING
 * single-header binding works with the CORRECT provider, or a genuine second
 * column survives and the day refuses exactly as it does today. Tiers 3, 4 and
 * 5 are byte-identical (tier 5 already applied this discipline via
 * !list.contains(h)). MEASURED WHILE PINNING THIS: when a row artifact is the
 * ONLY tier-2 candidate, 3.0.37 sees exactly one header and binds EVERY row to
 * it - "Supervising: <Name> DO" attributed as the rendering clinician, receipt
 * complete:true reason:'complete'. That wrong bind is LIVE TODAY and the
 * coverage gate cannot see it. Section 4 below pins both halves of the
 * correction: re-bind to the genuine header when another tier holds one, refuse
 * when none does. BEFORE = extension-candidates/3.0.37 (the LIVE-PROVEN
 * build that produced the receipt above), AFTER = the candidate under test;
 * every fixture is replayed through both. Every patient name is SYNTHETIC and
 * every clinician name is fictional. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
/* 2026-07-29: this contract pins the STAGED candidate reader. Candidates live
   in extension-candidates/ so the published repo bytes stay coherent with the
   live feed; on publish, background.js itself carries these changes and the
   candidate path naturally wins either way. Newest candidate wins. */
const candidateChain = ['3.0.42', '3.0.41', '3.0.40', '3.0.38', '3.0.37', '3.0.36', '3.0.35', '3.0.34', '3.0.33', '3.0.32'].map(v => path.join(root, 'extension-candidates', v, 'background.js'));
const backgroundPath = candidateChain.find(p => fs.existsSync(p)) || path.join(root, 'background.js');
const background = fs.readFileSync(backgroundPath, 'utf8');

/* ---- source markers: the receipt + snapshot contract must exist verbatim ---- */
for (const marker of [
  "unverifiableRows: __unverifiableRows, unverifiableRowCount: __unverifiableRowCount, provenNonClinicalCount: __provenNonClinical,",
  "kind === 'no-identity-cell'",
  '__nonClinicalAccounted',
  '__parsedCount > 0 && __parsedCount >= __expectedCount && __unnamedCount === 0',
  "out.diag.unverifiableRows=_unvRowsS",
  "out.diag.unverifiableRows=_legacyUnvRowsL",
  'function _snapCapture(row)',
  'function _snapIdentity(html,expectTime,knownId)',
  'row.outerHTML',
  'out.diag.snapshotRecovered=_lgSnapRecovL',
  'out.diag.snapshotRecovered=_snapRecoveredS',
  'snapshot:a._snap===true',
  'snapshot:p._snapHad===true',
  /* rev-3 (3.0.34) invariants */
  'function _snapStripAthenaTokens(text)',
  'function _snapPairRuns(regionText)',
  "snapshotParse:a._snap===true?String(a._snapParse||''):''",
  "snapshotParse:p._snapHad===true?String(p._snapParse||''):''",
  'var _legacyParsedRawKeysL={}',
  'out.diag.duplicateUnverifiableCollapsed=_lgDupCollapsedL',
  /* rev-4 (3.0.35) invariants: the bare-token min cleanup is case-sensitive
     and okTok carries the scope-local surname-ambiguous exemption. */
  "s=s.replace(/\\bmin(?:ute)?s?\\b/g,' ');",
  'var SNAMB=/^(?:min|mins|minute|minutes|no|fu|np|est)$/i;',
  '(!STOP.test(w)||SNAMB.test(w))',
  'function okJoin(runJ,w)',
  'while(ti+1<toks.length&&okJoin(run,toks[ti+1]))',
  /* rev-5 (3.0.36) DIAGNOSTIC-ONLY invariants: the DOM-validation stage names
     the row it removes. The accept/reject condition itself is untouched. */
  'function filterSource(src, lane) {',
  "var domFiltered = filterSource(dom, 'dom'), textFiltered = filterSource(text, 'text');",
  'invalidRows: domFiltered.invalidRows.concat(textFiltered.invalidRows).slice(0, 20),',
  'invalidRows: Array.isArray(__pd.invalidRows) ? __pd.invalidRows.slice(0, 20) : [],',
  'if (invalidRows.length < 20) invalidRows.push({',
  /* rev-6 (3.0.37) invariants: the surname-ambiguous exemption is scope-local
     to nameTokens, is gated on a whole CAPITALIZED word, and can never OPEN a
     name (solid > 0 means a NON-ambiguous token was already kept). */
  '  var SNAMB = /^(?:min|mins|minute|minutes|no|fu|np|est)$/i;\n  function nameTokens(name) {',
  "if (/^[A-Z][a-z'\\u2019-]+$/.test(w)) capWord[w.toLowerCase()] = 1;",
  'if (!t || t.length < 2 || CRED_I.test(t)) return;',
  'if (!STOP.test(t)) { kept.push(t); solid++; return; }',
  'if (solid > 0 && SNAMB.test(t) && capWord[t] === 1) kept.push(t);',
  /* rev-7 (3.0.37) P0 invariants: the chart-open driver may never type a name
     into a numeric-only field, the guard is re-asserted immediately before the
     write, and the refusal is surfaced instead of silently skipped. */
  'function numericOnlyField(i) {',
  'function typableField(i) { return typedIsNumeric || !numericOnlyField(i); }',
  'var usable = inputs.filter(typableField);',
  'var best = usable[0];',
  "if (!typableField(best)) return { phase: 'fill', filled: false, diag: diag, reason: 'numeric-only-field-refused' };",
  "reason: (fill && fill.reason) || '',",
  /* rev-8 (3.0.38) invariants: the legacy header harvest excludes row-internal
     candidates at tiers 1 and 2 ONLY, records per-header provenance, and the
     per-container binding rule is untouched (never positional). */
  'function rowInternalH(n){',
  'n.closest(\'[class~="filled-appointment-row"]\')',
  'function addT(t,tierH,nodeH){',
  'if(rinH&&Number(tierH)<=2)return;',
  '_legacyHdrProvL.push({tier:Number(tierH)||0,rowInternal:rinH,textLen:t.length})',
  'addT(tx(h),1,h);',
  'addT(tx(h),2,h);',
  'if(dpv)addT(dpv,2,h);',
  'if(alv)addT(alv,3,list);',
  'addT(tx(sibH),4,sibH);',
  'if(!insideH)addT(tx(h),5,h);',
  'out.diag.headerProvenance=_legacyHdrProvL.slice(0,10);',
  'out.providerRosterReceipt.headerProvenance=out.diag.headerProvenance;'
]) assert(background.includes(marker), 'missing re-verify/snapshot invariant: ' + marker);

/* rev-8 (3.0.38) SAFETY PIN - the one thing this revision may NEVER do. A row
   binds ONLY to a container that owns exactly one header; anything else stays
   unattributed and the day refuses. If either line below ever drifts into a
   positional or best-guess bind, a visit can be attributed to a clinician who
   did not render it AND the coverage receipt will read GREEN while it happens
   (unattributedRows and foreignRows both count 0 for a wrongly-bound row). */
assert(background.includes('          if(local.length!==1)_legacyHeaderProofL=false;'),
  'the per-container single-header proof changed - a row must never be bound positionally');
assert(background.includes("          var provider=local.length===1?local[0]:(out.diag.singleProviderName||'');"),
  'the provider binding line changed - a row must bind only to a UNIQUE container header');
assert(background.includes('if(localOrder.length!==1){_legacySafe=false;return;}'),
  'the single-provider-scope proof changed - ambiguous containers must stay unsafe');
assert(!/rows\[\s*\w+\s*\]\s*\.provider\s*=\s*local\[/.test(background),
  'a positional header-to-row assignment appeared - this is the refused design');

/* The accept/reject condition is the one line that may NEVER drift here: this
   change adds accounting, not a test. Pin the condition and the kept-row push
   verbatim, and pin that the diagnostic block sits INSIDE the reject arm. */
assert(background.includes(
  '        if (!firstTime(a && a.time) || nt.length < 2 || isProviderUiLabel(n) || RE_CRED.test(n)) {\n          invalid++;'),
  'the DOM-validation accept/reject condition changed - this revision may only ADD accounting');
assert(background.includes('        kept.push(a);\n      });\n      return { appts: kept, slotRowsRemoved: slots, emptyRowsRemoved: empty, invalidRowsRemoved: invalid, invalidRows: invalidRows };'),
  'the kept-row path or the counter contract changed');
assert(!/invalidRowsRemoved:\s*invalidRows\.length/.test(background),
  'invalidRowsRemoved must stay the independent counter, never the array length');

/* a refused SNAMB join must never discard the run: the emit line is untouched */
assert(background.includes("if(run.length>=2)cands.push(run.slice(0,3).join(' '));"),
  'the run-emit line changed; a refused ambiguous join must still emit its legitimate tokens');

/* the shared STOP regex itself must stay untouched - other call sites read it */
assert(background.includes('var STOP=/^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|'),
  'the shared STOP regex was edited; the surname exemption must be scope-local to okTok');
assert(!background.includes("s=s.replace(/\\bmin(?:ute)?s?\\b/gi,' ');"),
  'the bare-token min cleanup still carries the /i flag that deletes a capitalized surname');

/* rev-6 (3.0.37): the exemption may only widen nameTokens. Every neighbouring
   filter the merge stage leans on must be byte-identical, and the pre-3.0.37
   unconditional STOP filter must be GONE - if it survived anywhere the new
   branch would be dead code and every assertion below would pass vacuously. */
assert(background.includes(
  "  var CRED_I = /^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;"),
  'CRED_I was edited; the surname exemption must not touch the credential filter');
assert(background.includes(
  '  var RE_CRED = /(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;'),
  'RE_CRED was edited; the surname exemption must not touch the credential filter');
assert(!background.includes(
  ".filter(function (t) { return t && t.length > 1 && !STOP.test(t) && !CRED_I.test(t); });"),
  'the pre-3.0.37 unconditional STOP filter is still present - the exemption is dead code');

/* rev-7 (3.0.37) P0: the exclusion must be a FILTER, not a score penalty. If
   the unfiltered selection line ever comes back, a Patient ID field that is the
   only input on screen wins again and athenaNet raises its blocking dialog. */
assert(!background.includes('        inputs.sort(function (a, b) { return scoreInput(b) - scoreInput(a); });\r\n        var best = inputs[0];'),
  'the chart-open driver selects from the UNFILTERED input list again - a numeric-only field can win');
assert(background.includes('if (/search/.test(hay)) s += 3;') &&
  background.includes('if (/patient|name|find|lookup|client|mrn|chart|quicksearch|global/.test(hay)) s += 3;'),
  'the scorer itself was edited; the numeric-field guard must not re-rank legitimate search fields');

/* ---- extract the packaged reader (the function Chrome actually injects) ---- */
const nameStart = background.indexOf('function mlsParseName(raw)');
const readerStart = background.indexOf('async function mlsSchedDomInline(doc, CFG)', nameStart);
const readerEnd = background.indexOf('\n if (/stm\\.esp|', readerStart);
assert(nameStart >= 0 && readerStart > nameStart && readerEnd > readerStart,
  'could not extract the packaged schedule reader from background.js');

class FakeEvent {
  constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
}
const runtimeContext = vm.createContext({ setTimeout, clearTimeout, Promise, Date, Event: FakeEvent });
const runtime = vm.runInContext(
  background.slice(nameStart, readerEnd) + '\n({ mlsParseName, mlsSchedDomInline });',
  runtimeContext,
  { timeout: 5000 }
);

/* ---- extract the handler's completeness equation and run it directly ---- */
const eqStart = background.indexOf('var __unverifiableRows = Array.isArray(__dd.unverifiableRows)');
const eqEnd = background.indexOf('/* sfp-1.0.0 STALENESS VERDICT', eqStart);
assert(eqStart >= 0 && eqEnd > eqStart, 'could not extract the schedule completeness equation');
const completeness = new Function(
  '__dd', '__parsedCount', '__expectedCount', '__unnamedCount', '__coverageComplete', '__authoritativeEmpty',
  background.slice(eqStart, eqEnd) +
  '\nreturn { complete: !!__complete, provenNonClinical: __provenNonClinical, unverifiableRows: __unverifiableRows };'
);
function receiptFor(diag, coverageComplete) {
  return completeness(
    diag,
    Number(diag.parsedCount || 0),
    Number(diag.candidateCount || 0),
    Number(diag.unnamedCount || 0),
    coverageComplete !== false,
    false
  );
}

/* ---- extract the snapshot toolkit and unit-test _snapIdentity directly ---- */
const helperStart = background.indexOf('var RT=/', readerStart);
const helperEnd = background.indexOf('function cp(s)', helperStart);
const snapStart = background.indexOf('function _snapCapture(row)', readerStart);
const snapEnd = background.indexOf('/* Strong legacy provider-scope proof', snapStart);
assert(helperStart > 0 && helperEnd > helperStart && snapStart > 0 && snapEnd > snapStart,
  'could not extract the snapshot toolkit');
const snapKit = vm.runInContext(
  background.slice(nameStart, readerStart) +
  '\nvar out={diag:{}};\n' +
  background.slice(helperStart, helperEnd) +
  '\n' + background.slice(snapStart, snapEnd) +
  '\n({ _snapIdentity, _snapPairName, _snapText, _snapStripAthenaTokens, _snapPairRuns });',
  vm.createContext({ Date, Math }),
  { timeout: 5000 }
);

const CHURN_HTML =
  '<li class="filled-appointment-row" data-appointment-id="45532929">' +
  '<span>9:40 AM</span>' +
  '<a class="encounter-link" href="/22724/6/ax/encounter/1/checkin">Reed Piper</a>' +
  '<span>68yo M 01-01-1958</span>' +
  '<div class="react-app-container">Check In</div>' +
  '</li>';
const DEBRIS_HTML_NO_ID =
  '<li class="filled-appointment-row">' +
  '<span>Lobby 12 Annex 34</span><span>9:40 AM</span>' +
  '<a class="encounter-link">Reed Piper</a>' +
  '</li>';
const DEBRIS_HTML_WITH_ID = DEBRIS_HTML_NO_ID.replace(
  'class="filled-appointment-row"', 'class="filled-appointment-row" data-appointment-id="45532929"');

{
  // u1: the live Friday shape - intact snapshot verifies id + region name + chip DOB
  const u1 = snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '45532929');
  assert.strictEqual(u1.ok, true, JSON.stringify(u1));
  assert.strictEqual(u1.name, 'Reed Piper');
  assert.strictEqual(u1.appointmentId, '45532929');
  assert.strictEqual(u1.time, '9:40 AM');
  assert.strictEqual(u1.dob, '01/01/1958', 'age+sex chip DOB was not self-validated from the string snapshot');

  // u2: the SAME region name WITHOUT an appointment id is not accepted (id gate)
  const u2 = snapKit._snapIdentity(DEBRIS_HTML_NO_ID, '9:40 AM', '');
  assert.strictEqual(u2.ok, false, 'First-Last region name verified without an appointment id');
  assert.strictEqual(u2.noIdentity, false, 'an identity-bearing row was classified non-clinical');

  // u3: identical row WITH the id verifies through the patient-bound region
  const u3 = snapKit._snapIdentity(DEBRIS_HTML_WITH_ID, '9:40 AM', '');
  assert.strictEqual(u3.ok, true, JSON.stringify(u3));
  assert.strictEqual(u3.name, 'Reed Piper');

  // u4: two distinct patient-bound region names are ambiguous - refused even with id
  const u4 = snapKit._snapIdentity(
    CHURN_HTML.replace('</li>', '<a class="encounter-link">Sally Jones</a></li>'), '9:40 AM', '45532929');
  assert.strictEqual(u4.ok, false, 'a two-patient row was guessed');

  // u5: a snapshot showing a different time is a foreign row - refused
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '8:00 AM', '45532929').ok, false);

  // u6: a snapshot id conflicting with the caller's stable key is a foreign row - refused
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '99999999').ok, false);

  // u7: an identity-less hold snapshot classifies non-clinical
  const u7 = snapKit._snapIdentity('<li class="filled-appointment-row"><span>9:40 AM</span> 30 min hold</li>', '9:40 AM', '');
  assert.strictEqual(u7.ok, false);
  assert.strictEqual(u7.noIdentity, true, JSON.stringify(u7));

  /* ---- rev-3 (3.0.34): welded live shape + snapshotParse stage naming ---- */
  // u8: the EXACT live Friday failure shape - id on a BUTTON child, NO
  // patient-bound region, "40min" welded into the first name and the last
  // name welded into "NNyo". Token normalization must recover the pair.
  const LIVE_WELD =
    '<li class="filled-appointment-row">' +
    '<button type="button" class="appt-btn" data-stitching-url="/x/y" data-metrics-stage="s1" data-appointment-id="45532929"></button>' +
    '<span>9:40 AM</span><span>40minRoy Lee</span><span>68yo F | 01-01-1958</span>' +
    '<span>F/U ESI LUMBAR &amp; MBB</span>' +
    '</li>';
  const u8 = snapKit._snapIdentity(LIVE_WELD, '9:40 AM', '45532929');
  assert.strictEqual(u8.ok, true, 'welded live-shape row did not verify: ' + JSON.stringify(u8));
  assert.strictEqual(u8.name, 'Roy Lee', '2-letter/3-letter capitalized pair was not recovered');
  assert.strictEqual(u8.appointmentId, '45532929');
  assert.strictEqual(u8.dob, '01/01/1958', 'age+sex chip DOB was not self-validated');
  assert.strictEqual(u8.snapshotParse, 'accepted');

  // u8b: fully welded single text node ("40minRoy Lee68yo F | ...") still parses
  const u8b = snapKit._snapIdentity(
    '<li class="filled-appointment-row">' +
    '<button type="button" class="appt-btn" data-appointment-id="45532929"></button>' +
    '<span>9:40 AM 40minRoy Lee68yo F | 01-01-1958 F/U ESI LUMBAR &amp; MBB</span></li>',
    '9:40 AM', '45532929');
  assert.strictEqual(u8b.ok, true, JSON.stringify(u8b));
  assert.strictEqual(u8b.name, 'Roy Lee');
  assert.strictEqual(snapKit._snapStripAthenaTokens('9:40 AM 40minRoy Lee68yo F | 01-01-1958 F/U ESI LUMBAR & MBB'),
    'Roy Lee F/U ESI LUMBAR MBB', 'athena token normalization drifted');

  // u9: the SAME welded pair WITHOUT an appointment id anywhere is never
  // accepted (id gate) and the receipt names the stage.
  const u9 = snapKit._snapIdentity(LIVE_WELD.replace(' data-appointment-id="45532929"', ''), '9:40 AM', '');
  assert.strictEqual(u9.ok, false, 'whole-text pair name verified without an appointment id');
  assert.strictEqual(u9.snapshotParse, 'no-id-on-row');

  // u10 (rev-9, 3.0.40): the OLD expectation here - two distinct pair runs
  // with an id stay refused as ambiguous - was the live Friday bug itself: a
  // hidden scheduled-by staff run vetoed the real patient and refused the day.
  // sn-1.0/1.1's chip anchor exists precisely to break that tie: the run
  // sitting against the patient's own age/sex chip is per-patient evidence the
  // bare staff run does not have. With the weld-hardened capture the
  // whole-text parse now resolves the CHIP-ADJACENT run confidently (id-gated
  // by sn-1.1), so the row verifies to the patient and the bare second run no
  // longer vetoes it.
  const u10 = snapKit._snapIdentity(LIVE_WELD.replace('</li>', '<span>Sally Jones</span></li>'), '9:40 AM', '45532929');
  assert.strictEqual(u10.ok, true, 'the chip-adjacent run must outrank a bare staff run: ' + JSON.stringify(u10));
  assert.strictEqual(u10.name, 'Roy Lee', 'the CHIP-ADJACENT run is the patient, never the bare run');
  // u10b: TWO patient-bound REGIONS still refuse as ambiguous - the chip
  // tie-break never overrides region-stage ambiguity, which runs first.
  const u10b = snapKit._snapIdentity(
    '<li class="filled-appointment-row" data-appointment-id="45532929">' +
    '<span>9:40 AM</span><a class="encounter-link">Roy Lee</a>' +
    '<a class="encounter-link">Sally Jones</a></li>',
    '9:40 AM', '45532929');
  assert.strictEqual(u10b.ok, false, 'two-region snapshot was guessed: ' + JSON.stringify(u10b));
  assert.strictEqual(u10b.snapshotParse, 'ambiguous-candidates');
  // u10c (sn-1.1): the SAME two-run snapshot without an appointment id anywhere
  // is refused by the id gate even though the chip-adjacent parse is confident -
  // the whole-text confident-parse lane carries the same id gate as every other
  // acceptance lane.
  const u10c = snapKit._snapIdentity(
    LIVE_WELD.replace(' data-appointment-id="45532929"', '').replace('</li>', '<span>Sally Jones</span></li>'),
    '9:40 AM', '');
  assert.strictEqual(u10c.ok, false, 'id-less chip-adjacent snapshot must not verify: ' + JSON.stringify(u10c));
  assert.strictEqual(u10c.snapshotParse, 'no-id-on-row');

  // u11: every verdict names its stage - accepted / foreign-time / id-conflict
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '45532929').snapshotParse, 'accepted');
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '8:00 AM', '45532929').snapshotParse, 'foreign-time');
  assert.strictEqual(snapKit._snapIdentity(CHURN_HTML, '9:40 AM', '99999999').snapshotParse, 'id-conflict');
  assert.strictEqual(snapKit._snapPairRuns('Roy Lee and Sally Jones').length, 2, '_snapPairRuns lost run separation');

  /* ---- rev-4 (3.0.35): surname-ambiguous scheduling tokens ---- *
   * SYNTHETIC names only. Each surname is a real, common surname that the
   * scheduling vocabulary also spells: "Min"/"Mins"/"Minute"/"Minutes" are
   * eaten by the bare-token min cleanup when it carries /i; "No", "Fu",
   * "Est", "Np" are additionally rejected by okTok because STOP matches them
   * case-insensitively. On 3.0.34 all three of these rows report
   * snapshotParse:'no-name-candidate' - the live Friday 6-of-7. */
  function liveRow(first, surname) {
    return '<li class="filled-appointment-row">' +
      '<button type="button" class="appt-btn" data-stitching-url="/x/y" data-appointment-id="45532929"></button>' +
      '<span>9:40 AM</span><span>40min' + first + ' ' + surname + '</span>' +
      '<span>68yo F | 01-01-1958</span><span>F/U ESI LUMBAR &amp; MBB</span></li>';
  }
  for (const surname of ['Min', 'No', 'Fu']) {
    const rowText = '9:40 AM 40minRoy ' + surname + '68yo F | 01-01-1958 F/U ESI LUMBAR & MBB';
    const stripped = snapKit._snapStripAthenaTokens(rowText);
    assert.strictEqual(stripped, 'Roy ' + surname + ' F/U ESI LUMBAR MBB',
      'athena token stripping ate a surname that spells a scheduling word: ' + surname + ' -> ' + JSON.stringify(stripped));
    assert(new RegExp('(?:^| )Roy(?: |$)').test(stripped), 'the first-name token did not survive the stripper: ' + surname);
    assert(new RegExp('(?:^| )' + surname + '(?: |$)').test(stripped), 'the surname token did not survive the stripper: ' + surname);

    const runs = snapKit._snapPairRuns(stripped);
    assert.strictEqual(runs.length, 1,
      'exactly one capitalized-pair candidate expected for surname ' + surname + ', got ' + JSON.stringify(runs));
    assert.strictEqual(runs[0], 'Roy ' + surname, 'the pair candidate is not the patient name: ' + JSON.stringify(runs));

    const parsed = snapKit._snapIdentity(liveRow('Roy', surname), '9:40 AM', '45532929');
    assert.strictEqual(parsed.ok, true, 'surname-ambiguous live row refused: ' + JSON.stringify(parsed));
    assert.strictEqual(parsed.name, 'Roy ' + surname);
    assert.strictEqual(parsed.appointmentId, '45532929');
    assert.strictEqual(parsed.dob, '01/01/1958', 'age+sex chip DOB was not self-validated for surname ' + surname);
    assert.strictEqual(parsed.snapshotParse, 'accepted',
      'the receipt did not accept surname ' + surname + ': ' + parsed.snapshotParse);
  }

  /* REGRESSION GUARD: genuine duration text is still stripped, and none of it
     may ever become a name candidate. Every one of these outputs is
     byte-identical on 3.0.34 and 3.0.35 - the fix moved nothing here. */
  assert.strictEqual(snapKit._snapStripAthenaTokens('9:40 AM 40min Roy Lee 68yo F'), 'Roy Lee',
    'a welded lowercase "40min" duration survived the stripper');
  assert.strictEqual(snapKit._snapStripAthenaTokens('9:40 AM 40Min Roy Lee 68yo F'), 'Roy Lee',
    '"40Min" is duration text - the digit-anchored rule keeps its /i flag');
  assert.strictEqual(snapKit._snapStripAthenaTokens('9:40 AM 40MIN Roy Lee 68yo F'), 'Roy Lee',
    '"40MIN" is duration text - the digit-anchored rule keeps its /i flag');
  assert.strictEqual(snapKit._snapStripAthenaTokens('10:10 AM 45 minutes'), '',
    'a spelled-out "45 minutes" duration survived the stripper');
  assert.strictEqual(snapKit._snapStripAthenaTokens('10:10 AM 15 min'), '',
    'a bare "15 min" hold slot survived the stripper');
  assert.strictEqual(snapKit._snapStripAthenaTokens('11:20 AM 30 min hold'), 'hold',
    'a bare lowercase "min" remnant survived the stripper');
  for (const durationText of ['9:40 AM 40min', '10:10 AM 45 minutes', '10:10 AM 15 min', '11:20 AM 30 min hold']) {
    assert.strictEqual(snapKit._snapPairRuns(snapKit._snapStripAthenaTokens(durationText)).length, 0,
      'duration text produced a name candidate: ' + durationText);
  }
  const durationRow = snapKit._snapIdentity(
    '<li class="filled-appointment-row"><button data-appointment-id="45532929"></button>' +
    '<span>9:40 AM</span><span>45 minutes</span></li>', '9:40 AM', '45532929');
  assert.strictEqual(durationRow.ok, false, 'a duration-only row with an appointment id was named as a patient');
  assert.strictEqual(durationRow.name, '');
  assert.strictEqual(durationRow.snapshotParse, 'no-name-candidate');
  /* ---- SNAMB run-participation rule: a WRONG name is worse than a refusal ----
   * A surname-ambiguous token may participate in a run ONLY when the run is
   * exactly 2 tokens AND the other token is not itself ambiguous. Without this
   * rule an exempted token that landed next to a genuine pair EXTENDED it and
   * the row imported a corrupted surname ("Roy Lee No"). Runs of unambiguous
   * tokens are entirely unaffected. */
  {
    const extended = snapKit._snapPairRuns('Roy Lee No');
    assert.strictEqual(extended.length, 1, 'expected exactly one candidate, got ' + JSON.stringify(extended));
    assert.strictEqual(extended[0], 'Roy Lee',
      'an ambiguous token extended a genuine pair into a corrupted name: ' + JSON.stringify(extended));
    assert.notStrictEqual(extended[0], 'Roy Lee No', 'the corrupted three-token name came back');

    /* THE POINT: refusing the join must not discard the run. The tokens that
       legitimately formed the pair are still emitted - dropping the whole run
       here would re-break Friday. */
    assert.strictEqual(snapKit._snapPairRuns('Roy Lee No').length, 1,
      'a refused ambiguous join discarded the legitimate run that preceded it');
    assert.strictEqual(snapKit._snapPairRuns('Roy Lee No Show')[0], 'Roy Lee',
      'a refused ambiguous join discarded the legitimate run before status text');

    /* both tokens ambiguous is never a name */
    assert.strictEqual(snapKit._snapPairRuns('No Fu').length, 0, '"No Fu" was accepted as a name');
    assert.strictEqual(snapKit._snapPairRuns('No Min').length, 0, '"No Min" was accepted as a name');
    assert.strictEqual(snapKit._snapPairRuns('Est Min').length, 0, '"Est Min" was accepted as a name');

    /* ambiguous FIRST, unambiguous second is a legitimate pair */
    const ambFirst = snapKit._snapPairRuns('Min Lee');
    assert.strictEqual(ambFirst.length, 1, '"Min Lee" lost its pair: ' + JSON.stringify(ambFirst));
    assert.strictEqual(ambFirst[0], 'Min Lee');

    /* a genuine three-token run of unambiguous tokens is unchanged from 3.0.34 -
       the length rule constrains ambiguous participation only */
    const three = snapKit._snapPairRuns('Roy James Lee');
    assert.strictEqual(three.length, 1, JSON.stringify(three));
    assert.strictEqual(three[0], 'Roy James Lee', 'the length rule leaked onto an unambiguous three-token name');
    assert.strictEqual(snapKit._snapPairRuns('Roy Lee and Sally Jones').length, 2,
      'run separation regressed under the participation rule');

    /* the whole-row shape this rule exists for: a real patient plus Capitalized
       status text on the same row still imports the REAL name, never "Roy Lee No" */
    const statusRow = snapKit._snapIdentity(
      '<li class="filled-appointment-row"><button data-appointment-id="45532929"></button>' +
      '<span>9:40 AM</span><span>40minRoy Lee</span><span>68yo F | 01-01-1958</span>' +
      '<span>No Show</span></li>', '9:40 AM', '45532929');
    assert.strictEqual(statusRow.ok, true, JSON.stringify(statusRow));
    assert.strictEqual(statusRow.name, 'Roy Lee',
      'Capitalized status text corrupted the imported surname: ' + JSON.stringify(statusRow.name));
    assert.notStrictEqual(statusRow.name, 'Roy Lee No');
    assert.strictEqual(statusRow.snapshotParse, 'accepted');
    assert.strictEqual(
      snapKit._snapStripAthenaTokens('9:40 AM 40minRoy Lee 68yo F | 01-01-1958 No Show'),
      'Roy Lee No Show', 'the stripper stopped delivering the status token - the rule is being tested vacuously');
  }

  /* the genuinely non-name scheduling vocabulary is still filtered */
  for (const chrome of ['Office Visit', 'Follow Up Consult', 'Telehealth Provider Department',
    'Arrived Scheduled Cancelled', 'Patient Department Appointment']) {
    assert.strictEqual(snapKit._snapPairRuns(chrome).length, 0,
      'scheduling vocabulary became a name candidate: ' + chrome);
  }
}

/* ---- pure equation pins (the exact Friday arithmetic) ---- */
{
  const nonClinical = { unverifiableRows: [{ kind: 'no-identity-cell', time: '9:40 AM' }], unverifiableRowCount: 1 };
  assert.strictEqual(completeness(nonClinical, 6, 7, 1, true, false).complete, true,
    'expected 7 / parsed 6 / one proven non-clinical row must now complete');
  const mutating = { unverifiableRows: [{ kind: 'mutating', time: '9:40 AM' }], unverifiableRowCount: 1 };
  assert.strictEqual(completeness(mutating, 6, 7, 1, true, false).complete, false,
    'a mutating (possibly identity-bearing) row must keep the day incomplete');
  assert.strictEqual(completeness(nonClinical, 6, 8, 2, true, false).complete, false,
    'a second unaccounted row must keep the day incomplete');
  assert.strictEqual(completeness({ unverifiableRows: [], unverifiableRowCount: 0 }, 6, 7, 1, true, false).complete, false,
    'an unclassified unnamed row must keep the day incomplete');
  assert.strictEqual(completeness(nonClinical, 6, 7, 1, false, false).complete, false,
    'coverage failure still refuses regardless of classification');
  assert.strictEqual(completeness({ unverifiableRows: [], unverifiableRowCount: 0 }, 7, 7, 0, true, false).complete, true,
    'the unchanged all-verified branch must still complete');
}

/* ================= rev-5 (3.0.36): name the DOM-validation removal =========
 * Live Friday 2026-07-31, three consecutive runs on 3.0.35, real athenaOne,
 * identical every time: expectedCount 7, candidateCount 7, parsedCount 6,
 * domValidRows 6, invalidRowsRemoved 1, unverifiableRowCount 0,
 * unverifiableRows []. One candidate row is discarded at DOM validation -
 * BEFORE the re-verify/snapshot lane - and nothing named it or said why:
 * unverifiableRows only ever captures rows that REACH the re-verify lane, so a
 * row dropped earlier vanished from the accounting entirely.
 *
 * mlsMergeSchedule.filterSource is that stage. Its `invalid` counter has FOUR
 * distinct causes hidden behind one short-circuit condition:
 *   !firstTime(a.time)     -> 'no-time'
 *   nameTokens(n).length<2 -> 'single-name-token'
 *   isProviderUiLabel(n)   -> 'provider-ui-label'
 *   RE_CRED.test(n)        -> 'credentialed-name'
 * (the two sibling counters are already single-cause and self-naming:
 *  emptyRowsRemoved = no name at all, slotRowsRemoved = isCapacitySlotName.)
 *
 * This revision is DIAGNOSTIC ONLY. It must not change which rows are
 * accepted or rejected - only what the receipt can say about the rejections.
 * ========================================================================= */
{
  const mergeStart = background.indexOf('var mlsProv = (function () {');
  const mergeEnd = background.indexOf('/* A schedule surface must be proven', mergeStart);
  assert(mergeStart >= 0 && mergeEnd > mergeStart, 'could not extract mlsProv from the candidate reader');
  const prov = vm.runInNewContext(background.slice(mergeStart, mergeEnd) + '\nmlsProv;', Object.create(null), { timeout: 4000 });

  /* the CLOSED vocabulary - one entry per rejection branch, nothing else */
  const REASONS = ['no-time', 'single-name-token', 'provider-ui-label', 'credentialed-name'];
  const source = rows => ({ appts: rows.map(r => Object.assign({}, r)), providers: ['Matthew Schaeffer, MD'], diag: {} });
  const merge = (domRows, textRows) => prov.merge(source(domRows), source(textRows || []));
  const flat = v => JSON.parse(JSON.stringify(v || []));

  /* --- 1. ANTI-VACUITY: the exact live shape. Seven candidate rows, exactly
     one fails DOM validation. The receipt must name it, once, with a reason. */
  {
    const live = [
      { time: '8:00 AM', name: 'Doe, Bob', provider: 'Matthew Schaeffer, MD', appointmentId: 'a1' },
      { time: '8:20 AM', name: 'Field, Sarah', provider: 'Matthew Schaeffer, MD', appointmentId: 'a2' },
      { time: '9:00 AM', name: 'Roy Lee', provider: 'Matthew Schaeffer, MD', appointmentId: 'a3' },
      { time: '9:20 AM', name: 'Smith, John', provider: 'Matthew Schaeffer, MD', appointmentId: 'a4' },
      /* the discarded one: a torn read left one surviving name token */
      { time: '9:40 AM', name: 'Zzyzxqp', provider: 'Matthew Schaeffer, MD', appointmentId: '45532929', dob: '01/01/1958', mrn: '998877' },
      { time: '10:00 AM', name: 'Jones, Amy', provider: 'Matthew Schaeffer, MD', appointmentId: 'a6' },
      { time: '10:20 AM', name: 'Nguyen, Kim', provider: 'Matthew Schaeffer, MD', appointmentId: 'a7' }
    ];
    const d = merge(live).providerDiag;
    assert.strictEqual(d.domValidRows, 6, 'the live 7-of-which-1-invalid shape did not reproduce: ' + JSON.stringify(d));
    assert.strictEqual(d.invalidRowsRemoved, 1, 'the live shape did not reproduce a single invalid removal');
    const named = flat(d.invalidRows);
    assert.strictEqual(named.length, 1, 'the removed row is STILL anonymous - this is the whole defect: ' + JSON.stringify(d));
    assert.strictEqual(named[0].reason, 'single-name-token');
    assert.strictEqual(named[0].appointmentId, '45532929', 'the entry did not carry the appointment id that identifies the row');
    assert.strictEqual(named[0].time, '9:40 AM');
    assert.strictEqual(named[0].provider, 'Matthew Schaeffer, MD');
    assert.strictEqual(named[0].lane, 'dom');
    assert.strictEqual(named[0].textLen, 7, 'the shape hint must be the LENGTH of the rejected text');
    assert.strictEqual(named[0].nameTokenCount, 1);
    /* PHI: length and shape only - never the patient text, DOB or MRN */
    const serialized = JSON.stringify(named);
    for (const secret of ['Zzyzxqp', '01/01/1958', '998877', 'Doe', 'Nguyen']) {
      assert(!serialized.includes(secret), 'invalidRows leaked patient-identifying text: ' + secret);
    }
    for (const key of Object.keys(named[0])) {
      assert(['reason', 'time', 'provider', 'appointmentId', 'lane', 'textLen', 'nameTokenCount'].includes(key),
        'invalidRows entry grew an unaudited field: ' + key);
    }
  }

  /* --- 2. EVERY rejection branch is reachable and emits a DISTINCT reason,
     evaluated in the exact short-circuit order of the live condition. */
  {
    const branches = [
      { label: 'no-time', row: { time: '', name: 'Doe, Bob' }, reason: 'no-time' },
      { label: 'single-name-token', row: { time: '8:00 AM', name: 'Piper' }, reason: 'single-name-token' },
      { label: 'provider-ui-label', row: { time: '8:20 AM', name: 'Appointment date and time' }, reason: 'provider-ui-label' },
      { label: 'credentialed-name', row: { time: '8:40 AM', name: 'Schaeffer, Matthew MD' }, reason: 'credentialed-name' }
    ];
    const seen = new Set();
    for (const b of branches) {
      const d = merge([Object.assign({ provider: 'Matthew Schaeffer, MD', appointmentId: 'b-' + b.label }, b.row)]).providerDiag;
      assert.strictEqual(d.invalidRowsRemoved, 1, b.label + ' did not reach the invalid branch');
      const named = flat(d.invalidRows);
      assert.strictEqual(named.length, 1, b.label + ' was removed without being named');
      assert.strictEqual(named[0].reason, b.reason, b.label + ' named the wrong failing check: ' + JSON.stringify(named[0]));
      seen.add(named[0].reason);
    }
    assert.strictEqual(seen.size, branches.length, 'two rejection branches collapsed onto one reason');
    assert.deepStrictEqual([...seen].sort(), [...REASONS].sort(), 'the rejection vocabulary drifted from the code');
  }

  /* --- 3. the vocabulary is CLOSED: no empty, undefined or novel reason can
     escape, across every shape the stage can see (incl. the sibling counters,
     which must stay OUT of invalidRows so the identity below holds). */
  {
    const zoo = [
      { time: '', name: '' },                                   /* emptyRowsRemoved */
      { time: '8:00 AM', name: 'Open 30 min' },                 /* slotRowsRemoved  */
      { time: '8:20 AM', name: 'Blocked' },                     /* slotRowsRemoved  */
      { time: '', name: 'Spine,No' },                           /* invalid: no-time */
      { time: '9:00 AM', name: 'Spine,No' },                    /* invalid          */
      { time: '9:20 AM', name: 'Time' },                        /* invalid          */
      { time: '9:40 AM', name: 'Jones, Amy RN' },               /* invalid          */
      { time: '10:00 AM', name: 'Good, Row' }                   /* kept             */
    ].map((r, i) => Object.assign({ provider: 'Matthew Schaeffer, MD', appointmentId: 'z' + i }, r));
    const d = merge(zoo).providerDiag;
    const named = flat(d.invalidRows);
    assert.strictEqual(d.emptyRowsRemoved, 1, 'the empty-name counter moved: ' + JSON.stringify(d));
    assert.strictEqual(d.slotRowsRemoved, 2, 'the capacity-slot counter moved: ' + JSON.stringify(d));
    assert.strictEqual(named.length, d.invalidRowsRemoved,
      'invalidRows must hold exactly one entry per invalidRowsRemoved under the cap: ' + JSON.stringify(d));
    for (const entry of named) {
      assert(REASONS.includes(entry.reason), 'reason outside the closed vocabulary: ' + JSON.stringify(entry));
      assert(typeof entry.reason === 'string' && entry.reason.length > 0, 'empty reason: ' + JSON.stringify(entry));
      assert(typeof entry.textLen === 'number' && entry.textLen >= 0, 'textLen is not a shape hint: ' + JSON.stringify(entry));
      assert(entry.lane === 'dom' || entry.lane === 'text', 'lane must name the source reader: ' + JSON.stringify(entry));
    }
  }

  /* --- 4. both source lanes are named, not just the DOM one. */
  {
    const d = merge(
      [{ time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'd1' }],
      [{ time: '', name: 'Ghost, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 't1' }]
    ).providerDiag;
    const named = flat(d.invalidRows);
    assert.strictEqual(named.length, 1);
    assert.strictEqual(named[0].lane, 'text', 'a text-lane removal was mislabelled: ' + JSON.stringify(named[0]));
    assert.strictEqual(d.textInvalidRowsRemoved, 1);
    assert.strictEqual(d.domInvalidRowsRemoved, 0);
  }

  /* --- 5. BOUNDED: a pathological grid cannot bloat the receipt, and the
     independent counter still reports the true total. */
  {
    const many = Array.from({ length: 64 }, (_, i) => ({
      time: '', name: 'Row' + i + ', X', provider: 'Matthew Schaeffer, MD', appointmentId: 'c' + i
    }));
    const d = merge(many).providerDiag;
    assert.strictEqual(d.invalidRowsRemoved, 64, 'the counter must stay uncapped and exact');
    assert.strictEqual(flat(d.invalidRows).length, 20, 'invalidRows must be capped at 20 entries');
  }

  /* --- 6. BEHAVIOUR UNCHANGED versus the pre-3.0.36 reader. Replay every
     fixture through the newest source that does NOT carry the diagnostic and
     assert the merged rows, providers and EVERY existing providerDiag field
     are byte-identical - only the new invalidRows array may differ. */
  {
    const baselinePath = ['3.0.35', '3.0.34', '3.0.33', '3.0.32']
      .map(v => path.join(root, 'extension-candidates', v, 'background.js'))
      .concat([path.join(root, 'background.js')])
      .find(p => fs.existsSync(p) && !fs.readFileSync(p, 'utf8').includes('function filterSource(src, lane) {'));
    if (baselinePath) {
      const baseSrc = fs.readFileSync(baselinePath, 'utf8');
      const bs = baseSrc.indexOf('var mlsProv = (function () {');
      const be = baseSrc.indexOf('/* A schedule surface must be proven', bs);
      assert(bs >= 0 && be > bs, 'could not extract mlsProv from the behaviour baseline');
      const baseProv = vm.runInNewContext(baseSrc.slice(bs, be) + '\nmlsProv;', Object.create(null), { timeout: 4000 });
      assert.strictEqual(typeof baseProv.merge, 'function');

      const fixtures = [
        [[{ time: '8:00 AM', name: 'Doe, Bob', provider: 'Matthew Schaeffer, MD', appointmentId: 'x1' },
          { time: '9:40 AM', name: 'Zzyzxqp', provider: 'Matthew Schaeffer, MD', appointmentId: 'x2' }], []],
        [[{ time: '', name: '' }, { time: '8:00 AM', name: 'Open 30 min' }, { time: '9:00 AM', name: 'Spine,No' },
          { time: '9:20 AM', name: 'Appointment date and time' }, { time: '9:40 AM', name: 'Jones, Amy RN' },
          { time: '10:00 AM', name: 'Good, Row' }].map((r, i) => Object.assign({ provider: 'Matthew Schaeffer, MD', appointmentId: 'y' + i }, r)), []],
        [[{ time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm1' }],
         [{ time: '', name: 'Ghost, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm2' },
          { time: '8:00 AM', name: 'Good, Row', provider: 'Matthew Schaeffer, MD', appointmentId: 'm1' }]],
        [[], []],
        [Array.from({ length: 24 }, (_, i) => ({ time: '', name: 'Row' + i + ', X', provider: 'Matthew Schaeffer, MD', appointmentId: 'n' + i })), []]
      ];
      const strip = res => {
        const diag = Object.assign({}, res.providerDiag);
        delete diag.invalidRows;
        /* pp-1.1 (3.0.40): textOnlyRowCount/textOnlyRows are additive
           diagnostics of the same class as invalidRows - the merge's
           accept/reject behaviour stays byte-identical (the completeness gate
           consuming them lives handler-side and is pinned separately). */
        delete diag.textOnlyRowCount;
        delete diag.textOnlyRows;
        return JSON.parse(JSON.stringify({ appts: res.appts, providers: res.providers, providerDiag: diag }));
      };
      fixtures.forEach(([domRows, textRows], index) => {
        const before = baseProv.merge(source(domRows), source(textRows));
        const after = prov.merge(source(domRows), source(textRows));
        assert.deepStrictEqual(strip(after), strip(before),
          'fixture ' + index + ': the diagnostic changed accept/reject behaviour');
        assert.strictEqual(before.providerDiag.invalidRows, undefined,
          'the behaviour baseline already carries invalidRows - it is not a baseline');
      });
      console.log('  behaviour baseline: ' + path.relative(root, baselinePath) + ' (' + fixtures.length + ' fixtures, identical)');
    } else {
      console.log('  behaviour baseline: none present (every source carries the diagnostic)');
    }
  }
}

/* ================= rev-6 (3.0.37): the surname-ambiguous STOP collision at
 * the SECOND call site ====================================================
 * BEFORE = extension-candidates/3.0.36 (the build that produced the live
 * receipt), AFTER = the candidate under test. Both readers are replayed
 * against the same fixtures: the pair IS the contract. Every patient name here
 * is SYNTHETIC.
 * ======================================================================== */
{
  const provFrom = (src, label) => {
    const s = src.indexOf('var mlsProv = (function () {');
    const e = src.indexOf('/* A schedule surface must be proven', s);
    assert(s >= 0 && e > s, 'could not extract mlsProv from ' + label);
    return vm.runInNewContext(src.slice(s, e) + '\nmlsProv;', Object.create(null), { timeout: 4000 });
  };
  const priorPath = path.join(root, 'extension-candidates', '3.0.36', 'background.js');
  assert(fs.existsSync(priorPath),
    'the 3.0.36 before-reader is missing; the before/after pair cannot be proven');
  const priorSrc = fs.readFileSync(priorPath, 'utf8');
  assert(priorSrc.includes('function filterSource(src, lane) {'),
    '3.0.36 must carry the diagnostic - otherwise the receipt shape below is not what live reported');
  assert(!priorSrc.includes('if (solid > 0 && SNAMB.test(t) && capWord[t] === 1) kept.push(t);'),
    '3.0.36 already carries the surname exemption - it is not a BEFORE reader');
  assert(priorSrc.includes(
    ".filter(function (t) { return t && t.length > 1 && !STOP.test(t) && !CRED_I.test(t); });"),
    '3.0.36 no longer carries the unconditional STOP filter this revision replaces');

  const before = provFrom(priorSrc, '3.0.36'), after = provFrom(background, 'the candidate under test');
  const source = rows => ({ appts: rows.map(r => Object.assign({}, r)), providers: ['Matthew Schaeffer, MD'], diag: {} });
  const run = (p, domRows, textRows) => {
    const res = p.merge(source(domRows), source(textRows || []));
    /* pp-1.1 (3.0.40): textOnlyRowCount/textOnlyRows are additive diagnostics
       (same class as invalidRows in the rev-5 section) - the completeness gate
       consuming them is handler-side and pinned separately; strip them so
       every A/B in this block compares BEHAVIOUR, not diagnostic vocabulary. */
    if (res && res.providerDiag) { delete res.providerDiag.textOnlyRowCount; delete res.providerDiag.textOnlyRows; }
    return res;
  };
  const flat = v => JSON.parse(JSON.stringify(v || []));

  /* --- 1. THE LIVE ROW. The measured shape: seven candidate rows, the 9:40
     one carrying an appointment id, provider "Matthew Schaeffer, MD" and a
     7-character two-part name whose SECOND part is a surname-ambiguous token.
     3.0.36 must reject it exactly as live did; the candidate must keep it. */
  const liveSeven = name => [
    { time: '8:00 AM', name: 'Doe, Bob', provider: 'Matthew Schaeffer, MD', appointmentId: 'a1' },
    { time: '8:20 AM', name: 'Field, Sarah', provider: 'Matthew Schaeffer, MD', appointmentId: 'a2' },
    { time: '9:00 AM', name: 'Roy Lee', provider: 'Matthew Schaeffer, MD', appointmentId: 'a3' },
    { time: '9:20 AM', name: 'Smith, John', provider: 'Matthew Schaeffer, MD', appointmentId: 'a4' },
    { time: '9:40 AM', name: name, provider: 'Matthew Schaeffer, MD', appointmentId: '45532929', dob: '01/01/1958', mrn: '998877' },
    { time: '10:00 AM', name: 'Jones, Amy', provider: 'Matthew Schaeffer, MD', appointmentId: 'a6' },
    { time: '10:20 AM', name: 'Nguyen, Kim', provider: 'Matthew Schaeffer, MD', appointmentId: 'a7' }
  ];
  for (const name of ['Roy Min', 'Roy No', 'Roy Fu']) {
    /* BEFORE: the exact live receipt, reproduced */
    const b = run(before, liveSeven(name)).providerDiag;
    assert.strictEqual(b.domValidRows, 6, name + ': the live 6-of-7 did not reproduce on 3.0.36: ' + JSON.stringify(b));
    assert.strictEqual(b.invalidRowsRemoved, 1, name + ': 3.0.36 did not remove exactly one row');
    const removed = flat(b.invalidRows);
    assert.strictEqual(removed.length, 1, name + ': 3.0.36 removed the row without naming it');
    assert.strictEqual(removed[0].reason, 'single-name-token',
      name + ': the live rejection reason did not reproduce: ' + JSON.stringify(removed[0]));
    assert.strictEqual(removed[0].nameTokenCount, 1, name + ': the live nameTokenCount did not reproduce');
    assert.strictEqual(removed[0].textLen, name.length);
    assert.strictEqual(removed[0].appointmentId, '45532929');
    assert.strictEqual(removed[0].time, '9:40 AM');
    assert.strictEqual(removed[0].provider, 'Matthew Schaeffer, MD');
    assert.strictEqual(removed[0].lane, 'dom');

    /* AFTER: the whole point - the row is KEPT, and nothing else moved */
    const result = run(after, liveSeven(name));
    const a = result.providerDiag;
    assert.strictEqual(a.domValidRows, 7,
      name + ': the live row is STILL discarded at DOM validation: ' + JSON.stringify(a));
    assert.strictEqual(a.invalidRowsRemoved, 0, name + ': a row was still removed: ' + JSON.stringify(a));
    assert.deepStrictEqual(flat(a.invalidRows), [], name + ': invalidRows must be empty once the row is kept');
    assert.strictEqual(a.emptyRowsRemoved, b.emptyRowsRemoved, name + ': the empty-name counter moved');
    assert.strictEqual(a.slotRowsRemoved, b.slotRowsRemoved, name + ': the capacity-slot counter moved');
    const kept = result.appts.filter(x => x.appointmentId === '45532929');
    assert.strictEqual(kept.length, 1, name + ': the recovered row is not in the merged appointments');
    assert.strictEqual(kept[0].name, name, name + ': the surname was altered on the way through');
    assert.strictEqual(kept[0].time, '9:40 AM');
    /* the other six are untouched by the exemption */
    assert.strictEqual(result.appts.length, run(before, liveSeven(name)).appts.length + 1,
      name + ': the exemption changed more than the one row');
  }

  /* --- 2. FAIL-CLOSED. Every one of these must still be rejected, and must be
     rejected the SAME WAY it was on 3.0.36 - same counters, same reason. */
  const guards = [
    ['No Show', 'status text, no real patient'],
    ['No Answer', 'status text, no real patient'],
    ['No Fu', 'two ambiguous tokens'],
    ['No Min', 'two ambiguous tokens'],
    ['Est Min', 'two ambiguous tokens'],
    ['no min', 'lowercase duration remnant'],
    ['roy min', 'lowercase - names arrive Capitalized'],
    ['ROY MIN', 'ALL-CAPS - scheduling chrome, not a name'],
    ['40min', 'duration remnant'],
    ['15 min', 'duration remnant'],
    ['30 minutes', 'duration remnant'],
    ['Spine,No', 'punctuation-welded false row'],
    ['Time', 'single scheduling word'],
    ['Piper', 'single-token name'],
    ['Zzyzxqp', 'single-token name'],
    ['Appointment date and time', 'provider header string'],
    ['Patient Name', 'provider header string'],
    ['Rendering Provider', 'provider header string'],
    ['Schaeffer, Matthew MD', 'credentialed name'],
    ['Jones, Amy RN', 'credentialed name'],
    ['Min NP', 'credentialed name'],
    ['Open 30 min', 'capacity slot'],
    ['Blocked', 'capacity slot'],
    ['Hold 15 minutes', 'capacity slot'],
    ['Lunch', 'capacity slot']
  ];
  const shape = d => [d.domValidRows, d.invalidRowsRemoved, d.emptyRowsRemoved, d.slotRowsRemoved,
    (flat(d.invalidRows)[0] || {}).reason || ''].join('|');
  for (const [name, why] of guards) {
    const row = [{ time: '9:40 AM', name, provider: 'Matthew Schaeffer, MD', appointmentId: 'g1' }];
    const b = run(before, row).providerDiag, a = run(after, row).providerDiag;
    assert.strictEqual(a.domValidRows, 0, 'FAIL-CLOSED BREACH - ' + why + ' was imported as a patient: ' + JSON.stringify(name));
    assert.strictEqual(shape(a), shape(b),
      'the exemption changed how ' + JSON.stringify(name) + ' (' + why + ') is refused: 3.0.36 ' + shape(b) + ' -> ' + shape(a));
  }

  /* --- 3. genuine names are untouched, including the exact 2-token and
     3-token shapes the merge stage already accepted on 3.0.36. */
  for (const name of ['Good, Row', 'Doe, Bob', 'Roy Lee', 'Roy James Lee', 'Field, Sarah']) {
    const row = [{ time: '9:40 AM', name, provider: 'Matthew Schaeffer, MD', appointmentId: 'k1' }];
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(run(after, row))), JSON.parse(JSON.stringify(run(before, row))),
      'an unambiguous name changed behaviour: ' + JSON.stringify(name));
  }

  /* --- 4. A/B against 3.0.36 across the whole fixture zoo. ONLY the
     surname-ambiguous fixtures may differ; everything else stays
     deepStrictEqual, invalidRows included (this revision adds no accounting). */
  {
    const withProvider = rows => rows.map((r, i) =>
      Object.assign({ provider: 'Matthew Schaeffer, MD', appointmentId: 'f' + i }, r));
    const fixtures = [
      { label: 'live-seven/Roy Min', differs: true, dom: liveSeven('Roy Min') },
      { label: 'live-seven/Roy No', differs: true, dom: liveSeven('Roy No') },
      { label: 'live-seven/Roy Fu', differs: true, dom: liveSeven('Roy Fu') },
      { label: 'ambiguous-surname/Roy Minutes', differs: true, dom: withProvider([{ time: '9:40 AM', name: 'Roy Minutes' }]) },
      { label: 'ambiguous-surname/Roy Est', differs: true, dom: withProvider([{ time: '9:40 AM', name: 'Roy Est' }]) },
      { label: 'empty-day', differs: false, dom: [] },
      { label: 'counter-zoo', differs: false, dom: withProvider([
        { time: '', name: '' }, { time: '8:00 AM', name: 'Open 30 min' }, { time: '8:20 AM', name: 'Blocked' },
        { time: '', name: 'Spine,No' }, { time: '9:00 AM', name: 'Spine,No' }, { time: '9:20 AM', name: 'Time' },
        { time: '9:40 AM', name: 'Jones, Amy RN' }, { time: '10:00 AM', name: 'Good, Row' }]) },
      { label: 'status-rows', differs: false, dom: withProvider([
        { time: '8:00 AM', name: 'No Show' }, { time: '8:20 AM', name: 'No Answer' },
        { time: '8:40 AM', name: 'No Fu' }, { time: '9:00 AM', name: 'Good, Row' }]) },
      { label: 'duration-remnants', differs: false, dom: withProvider([
        { time: '8:00 AM', name: '40min' }, { time: '8:20 AM', name: '15 min' },
        { time: '8:40 AM', name: 'no min' }, { time: '9:00 AM', name: 'ROY MIN' }]) },
      { label: 'provider-headers', differs: false, dom: withProvider([
        { time: '8:00 AM', name: 'Appointment date and time' }, { time: '8:20 AM', name: 'Rendering Provider' },
        { time: '8:40 AM', name: 'Patient Name' }]) },
      { label: 'credentialed', differs: false, dom: withProvider([
        { time: '8:00 AM', name: 'Schaeffer, Matthew MD' }, { time: '8:20 AM', name: 'Jones, Amy RN' }]) },
      { label: 'text-lane', differs: false,
        dom: withProvider([{ time: '8:00 AM', name: 'Good, Row' }]),
        text: withProvider([{ time: '', name: 'Ghost, Row' }]) },
      { label: 'unambiguous-names', differs: false, dom: withProvider([
        { time: '8:00 AM', name: 'Roy Lee' }, { time: '8:20 AM', name: 'Roy James Lee' },
        { time: '8:40 AM', name: 'Doe, Bob' }]) },
      { label: 'bounded-64', differs: false,
        dom: Array.from({ length: 64 }, (_, i) => ({ time: '', name: 'Row' + i + ', X', provider: 'Matthew Schaeffer, MD', appointmentId: 'c' + i })) }
    ];
    const differed = [];
    for (const fx of fixtures) {
      const b = JSON.parse(JSON.stringify(run(before, fx.dom, fx.text)));
      const a = JSON.parse(JSON.stringify(run(after, fx.dom, fx.text)));
      const same = JSON.stringify(a) === JSON.stringify(b);
      if (!same) differed.push(fx.label);
      if (fx.differs) {
        assert(!same, 'fixture ' + fx.label + ' was supposed to change and did not - the fix is not reached here');
      } else {
        assert.deepStrictEqual(a, b, 'fixture ' + fx.label + ': behaviour changed outside the ambiguous-surname class');
      }
    }
    assert.deepStrictEqual(differed, fixtures.filter(f => f.differs).map(f => f.label),
      'the A/B difference set drifted from the ambiguous-surname fixtures');
    console.log('  A/B vs 3.0.36 (' + fixtures.length + ' fixtures): differ = ' + differed.join(', ') + '; all others deepStrictEqual');
  }
}

/* ================= structure-lane doubles ================= */
function appointment(id, text, options = {}) {
  const getText = typeof text === 'function' ? text : () => text;
  return {
    id: 'react-' + id,
    get textContent() { return getText(); },
    children: [],
    outerHTML: options.outerHTML,
    getAttribute(name) {
      if (name === 'data-appointment-id') return (options.appointmentId || '');
      return '';
    },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function countingColumn(left, appointments, counter) {
  return {
    children: appointments,
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect() { return { left, right: left + 200, width: 200 }; },
    querySelector(selector) {
      return selector.includes('PatientAppointment_appointment-container') ? (appointments[0] || null) : null;
    },
    querySelectorAll(selector) {
      if (selector.includes('PatientAppointment_appointment-container')) { counter.pulls++; return appointments; }
      return [];
    }
  };
}
function header(provider, left) {
  return {
    textContent: provider, children: [],
    scrollHeight: 0, clientHeight: 0, scrollWidth: 0, clientWidth: 0,
    getBoundingClientRect() { return { left, right: left + 200, width: 200 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function scheduleDoc({ columns, headers }) {
  const appointments = columns.reduce((all, col) => all.concat(col.children || []), []);
  const allNodes = headers.concat(columns, appointments);
  return {
    body: { innerText: '' },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
    getElementById(id) { return appointments.find(a => a.id === id) || null; },
    querySelector(selector) {
      if (selector.includes('data-appointment-id="')) {
        const m = selector.match(/data-appointment-id="([^"]+)"/);
        return (m && appointments.find(a => a.getAttribute('data-appointment-id') === m[1])) || null;
      }
      if (selector.includes('PatientAppointment_appointment-container')) return appointments[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector.includes('ScheduleColumn_schedule-column')) return columns;
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return headers;
      if (selector.includes('PatientAppointment_appointment-container')) return appointments;
      return [];
    }
  };
}

/* ================= legacy-lane doubles ================= */
function legacyRow(text, options = {}) {
  const getText = typeof text === 'function' ? text : () => text;
  return {
    id: options.id || '',
    get textContent() { return getText(); },
    children: [],
    outerHTML: options.outerHTML,
    getAttribute(name) { return (options.attrs && options.attrs[name]) || ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
}
function legacyContainer(rows, providerHeader) {
  return {
    textContent: '', children: rows,
    getAttribute() { return ''; },
    getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
    querySelector(selector) {
      if (selector.includes('filled-appointment-row')) return rows[0] || null;
      if (selector.includes('appointment-header2')) return providerHeader || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes('filled-appointment-row')) return rows;
      if (selector.includes('appointment-header2')) return providerHeader ? [providerHeader] : [];
      return [];
    }
  };
}
function legacyScheduleDoc(containers, providerHeaders) {
  const rows = containers.reduce((all, item) => all.concat(item.children || []), []);
  const allNodes = providerHeaders.concat(containers, rows);
  return {
    body: { innerText: 'Legacy Athena day schedule' },
    location: { pathname: '/schedule/day' },
    scrollingElement: null,
    defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '*') return allNodes;
      if (selector === '[class~="appointments-container"]') return containers;
      if (selector === '[class~="filled-appointment-row"]') return rows;
      if (selector === 'div,span,h1,h2,h3,h4,th,td') return providerHeaders;
      return [];
    }
  };
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }

(async () => {
  /* ============ rev-7 (3.0.37) P0: a name is NEVER typed into a numeric-only
   * field ==================================================================
   * LIVE, IN CLINIC: athenaNet threw a NATIVE blocking dialog - "Patient ID
   * must be numeric and should be greater than zero." - during a running pull.
   * A native dialog halts all JavaScript in that tab, so it wedged the pull AND
   * locked the physician out of athenaNet until he clicked OK, once per chart.
   * Cause: charts are opened by typing "lastname,firstname" into an input
   * chosen by scoreInput, and athenaNet's Patient ID box matches /patient/
   * (often /id/ and /mrn/ too), so it can WIN the scoring outright.
   * The guard is a hard EXCLUSION - a score penalty still wins when the bad
   * field is the only one on screen. Every name below is SYNTHETIC.
   * ===================================================================== */
  {
    const driverOf = (src, label) => {
      const s = src.indexOf('  async function mlsSearchOpenDriverFn(name, phase, requestGuard, appointmentId, requireAppointmentId) {');
      const e = src.indexOf('  function mlsAppointmentNavigationDelta(', s);
      assert(s >= 0 && e > s, 'could not extract the chart-open driver from ' + label);
      class FakeKeyboardEvent { constructor(type) { this.type = type; } }
      const sandbox = {
        Date, Math, Promise, setTimeout, clearTimeout, JSON, console,
        Event: FakeEvent, KeyboardEvent: FakeKeyboardEvent,
        window: { HTMLInputElement: function () {}, innerHeight: 900 },
        location: { pathname: '/22724/6/globalframeset.esp', hostname: 'athenanet.athenahealth.com' },
        getComputedStyle() { return { visibility: 'visible', display: 'block', overflowY: 'hidden' }; },
        document: { querySelectorAll() { return []; }, scrollingElement: null }
      };
      sandbox.self = sandbox;
      const ctx = vm.createContext(sandbox);
      const fn = vm.runInContext(src.slice(s, e) + '\nmlsSearchOpenDriverFn;', ctx, { timeout: 5000 });
      return { fn, ctx };
    };
    /* a synthetic athenaNet input. `mutateOnFocus` reproduces a re-render that
       swaps the field underneath us between selection and the write. */
    const field = spec => {
      const el = {
        tagName: 'INPUT',
        type: spec.type || 'text',
        placeholder: spec.placeholder || '',
        name: spec.name || '',
        id: spec.id || '',
        title: spec.title || '',
        value: '',
        typedEvents: [],
        focused: false,
        labels: spec.label ? [{ textContent: spec.label }] : null,
        getAttribute(n) {
          if (n === 'aria-label') return spec.ariaLabel || '';
          if (n === 'inputmode') return spec.inputmode || '';
          if (n === 'pattern') return spec.pattern || '';
          return '';
        },
        getBoundingClientRect() { return { width: 220, height: 24, top: spec.top === undefined ? 40 : spec.top, left: 0, right: 220 }; },
        focus() { this.focused = true; if (spec.mutateOnFocus) Object.assign(this, spec.mutateOnFocus); },
        dispatchEvent(e) { this.typedEvents.push(e && e.type); return true; },
        closest() { return null; }
      };
      el.__label = spec.__label || spec.placeholder || spec.name || spec.id || spec.ariaLabel || spec.label || '(field)';
      return el;
    };
    const fillWith = async (driver, fields, name) => {
      driver.ctx.document.querySelectorAll = sel => (/input,textarea/.test(sel) ? fields : []);
      return driver.fn(name, 'fill', { deadline: Date.now() + 60000, token: 'p0-token' });
    };
    /* the athenaNet shapes involved, synthetic */
    const patientIdNumber = () => field({ __label: 'Patient ID (type=number)', type: 'number', placeholder: 'Patient ID', name: 'patientid', top: 60 });
    const globalSearch = () => field({ __label: 'global patient search', type: 'search', placeholder: 'Search patients by name or ID', name: 'globalsearch', top: 20 });

    const priorPath37 = path.join(root, 'extension-candidates', '3.0.36', 'background.js');
    assert(fs.existsSync(priorPath37), 'the 3.0.36 before-driver is missing');
    const priorSrc37 = fs.readFileSync(priorPath37, 'utf8');
    assert(!priorSrc37.includes('function typableField(i)'),
      '3.0.36 already carries the numeric-field guard - it is not a BEFORE reader');

    /* --- P0.1 both fields present: the SEARCH field is chosen, never the
       numeric one, and the numeric one is not touched at all. */
    {
      const pid = patientIdNumber(), search = globalSearch();
      const d = driverOf(background, 'the candidate under test');
      const r = await fillWith(d, [pid, search], 'Lee, Roy');
      assert.strictEqual(r.filled, true, 'the legitimate search field was not used: ' + JSON.stringify(r));
      assert.strictEqual(search.value, 'lee,roy', 'the search string did not reach the search field');
      assert.strictEqual(pid.value, '', 'A NAME WAS TYPED INTO THE PATIENT ID FIELD - this is the dialog that locks the EMR');
      assert.deepStrictEqual(pid.typedEvents, [], 'the Patient ID field received events');
      assert.strictEqual(pid.focused, false, 'the Patient ID field was focused');
      assert.strictEqual(r.diag.numericFieldsRefused, 1, 'the refusal was not accounted: ' + JSON.stringify(r.diag));
    }

    /* --- P0.1b THE LIVE SHAPE. The scorer does not merely tie - a Patient ID
       box labelled "Patient ID Search" and sitting at the top of the screen
       OUTSCORES a plain lower-down name field (7 vs 4), so on 3.0.36 it WINS
       and the name goes straight into it. That is the dialog the owner hit. */
    {
      const pidSpec = { __label: 'Patient ID Search (outranks)', type: 'number', placeholder: 'Patient ID Search', name: 'patientidsearch', top: 20 };
      const weakSpec = { __label: 'plain name field', type: 'text', placeholder: 'Name', top: 400 };

      /* BEFORE: 3.0.36 types the NAME into the numeric Patient ID box */
      const pidB = field(pidSpec), weakB = field(weakSpec);
      const rb0 = await fillWith(driverOf(priorSrc37, '3.0.36'), [pidB, weakB], 'Lee, Roy');
      assert.strictEqual(rb0.filled, true, '3.0.36 did not fill at all - the live shape is not reproduced');
      assert.strictEqual(pidB.value, 'lee,roy',
        '3.0.36 did not put the name in the Patient ID box - the P0 assertion below would be vacuous');

      /* AFTER: the numeric box is excluded outright and the safe field is used */
      const pidA = field(pidSpec), weakA = field(weakSpec);
      const ra0 = await fillWith(driverOf(background, 'the candidate under test'), [pidA, weakA], 'Lee, Roy');
      assert.strictEqual(pidA.value, '', 'THE OUTRANKING PATIENT ID FIELD STILL WINS - the blocking dialog returns');
      assert.deepStrictEqual(pidA.typedEvents, [], 'the Patient ID field received events');
      assert.strictEqual(ra0.filled, true, 'the safe fallback field was not used: ' + JSON.stringify(ra0));
      assert.strictEqual(weakA.value, 'lee,roy', 'the search string did not reach the safe field');
      assert.strictEqual(ra0.diag.numericFieldsRefused, 1);
    }

    /* --- P0.2 ONLY the numeric Patient ID field, with a name-shaped string:
       the module must refuse to type AT ALL and say so. */
    {
      const pid = patientIdNumber();
      const d = driverOf(background, 'the candidate under test');
      const r = await fillWith(d, [pid], 'Lee, Roy');
      assert.strictEqual(r.filled, false, 'the driver typed a name into a numeric-only field: ' + JSON.stringify(r));
      assert.strictEqual(r.reason, 'numeric-only-field-refused', 'the refusal was not named: ' + JSON.stringify(r));
      assert.strictEqual(r.diag.numericFieldsRefused, 1);
      assert.strictEqual(pid.value, '', 'the field was written despite the refusal');
      assert.deepStrictEqual(pid.typedEvents, [], 'events were dispatched despite the refusal');

      /* ANTI-VACUITY: unmodified 3.0.36 walks straight into the dialog here. */
      const pidBefore = patientIdNumber();
      const before = driverOf(priorSrc37, '3.0.36');
      const rb = await fillWith(before, [pidBefore], 'Lee, Roy');
      assert.strictEqual(rb.filled, true,
        '3.0.36 did not reproduce the defect - the P0 assertions above would be vacuous: ' + JSON.stringify(rb));
      assert.strictEqual(pidBefore.value, 'lee,roy',
        '3.0.36 did not type the name into the Patient ID field - the live dialog is not reproduced here');
    }

    /* --- P0.3 every numeric-only SIGNAL is honoured, each on its own. */
    for (const spec of [
      { __label: 'type=number', type: 'number', placeholder: 'Enter value', top: 60 },
      { __label: 'inputmode=numeric', inputmode: 'numeric', placeholder: 'Enter value', top: 60 },
      { __label: 'inputmode=tel', inputmode: 'tel', placeholder: 'Enter value', top: 60 },
      { __label: 'pattern=\\d+', pattern: '\\d+', placeholder: 'Enter value', top: 60 },
      { __label: 'pattern=[0-9]*', pattern: '[0-9]*', placeholder: 'Enter value', top: 60 },
      { __label: 'pattern=^\\d{1,9}$', pattern: '^\\d{1,9}$', placeholder: 'Enter value', top: 60 },
      { __label: 'placeholder Patient ID', placeholder: 'Patient ID', top: 60 },
      { __label: 'placeholder Patient #', placeholder: 'Patient #', top: 60 },
      { __label: 'name patientid', name: 'patientid', placeholder: 'Enter value', top: 60 },
      { __label: 'aria-label Patient Number', ariaLabel: 'Patient Number', top: 60 },
      { __label: 'label Patient No.', label: 'Patient No.', placeholder: 'Enter value', top: 60 },
      { __label: 'title Patient ID', title: 'Patient ID', placeholder: 'Enter value', top: 60 }
    ]) {
      const bad = field(spec), good = globalSearch();
      const d = driverOf(background, 'the candidate under test');
      const r = await fillWith(d, [bad, good], 'Lee, Roy');
      assert.strictEqual(bad.value, '', 'a name was typed into a numeric-only field [' + spec.__label + ']');
      assert.strictEqual(r.filled, true, 'the legitimate field was lost [' + spec.__label + ']: ' + JSON.stringify(r));
      assert.strictEqual(good.value, 'lee,roy', 'the search string did not reach the search field [' + spec.__label + ']');

      const alone = field(spec);
      const d2 = driverOf(background, 'the candidate under test');
      const r2 = await fillWith(d2, [alone], 'Lee, Roy');
      assert.strictEqual(r2.filled, false, 'a lone numeric-only field was typed into [' + spec.__label + ']');
      assert.strictEqual(r2.reason, 'numeric-only-field-refused', 'the lone refusal was not named [' + spec.__label + ']');
      assert.strictEqual(alone.value, '', 'the lone numeric-only field was written [' + spec.__label + ']');
    }

    /* --- P0.4 an ALL-DIGITS search string may still use a numeric field. */
    {
      const pid = patientIdNumber();
      const d = driverOf(background, 'the candidate under test');
      const r = await fillWith(d, [pid], '4455661');
      assert.strictEqual(r.filled, true, 'an all-digits string was refused a numeric field: ' + JSON.stringify(r));
      assert.strictEqual(pid.value, '4455661');
      assert.strictEqual(r.diag.numericFieldsRefused, 0);
    }

    /* --- P0.5 belt-and-braces: a field that passes selection and then turns
       numeric before the write is NOT written to. */
    {
      const swap = field({ __label: 'search that re-renders into Patient ID', type: 'search',
        placeholder: 'Search patients', top: 20, mutateOnFocus: { type: 'number' } });
      const d = driverOf(background, 'the candidate under test');
      const r = await fillWith(d, [swap], 'Lee, Roy');
      assert.strictEqual(r.filled, false, 'the pre-write re-assert did not fire: ' + JSON.stringify(r));
      assert.strictEqual(r.reason, 'numeric-only-field-refused');
      assert.strictEqual(swap.value, '', 'the swapped field was written');
      assert.deepStrictEqual(swap.typedEvents, [], 'the swapped field received events');
    }

    /* --- P0.6 REGRESSION: with no numeric field in play, the normal athenaNet
       search path is chosen and driven exactly as on 3.0.36. */
    {
      const sets = [
        [{ __label: 'global search', type: 'search', placeholder: 'Search', name: 'globalsearch', top: 20 }],
        [{ __label: 'global search', type: 'search', placeholder: 'Search patients by name or ID', name: 'globalsearch', top: 20 },
         { __label: 'unrelated text', type: 'text', placeholder: 'Notes', top: 400 }],
        [{ __label: 'quicksearch', type: 'text', placeholder: 'Quicksearch', name: 'quicksearch', top: 15 },
         { __label: 'find patient', type: 'text', ariaLabel: 'Find a patient', top: 500 }],
        [{ __label: 'nothing usable', type: 'text', placeholder: 'Notes', top: 500 }],
        []
      ];
      for (const spec of sets) {
        const nowFields = spec.map(field), thenFields = spec.map(field);
        const now = await fillWith(driverOf(background, 'candidate'), nowFields, 'Lee, Roy');
        const then = await fillWith(driverOf(priorSrc37, '3.0.36'), thenFields, 'Lee, Roy');
        const strip = r => { const c = JSON.parse(JSON.stringify(r)); if (c.diag) delete c.diag.numericFieldsRefused; return c; };
        assert.deepStrictEqual(strip(now), strip(then),
          'the normal search path changed for [' + spec.map(s => s.__label).join(' + ') + ']');
        assert.deepStrictEqual(nowFields.map(f => f.value), thenFields.map(f => f.value),
          'a different field was written for [' + spec.map(s => s.__label).join(' + ') + ']');
        assert.deepStrictEqual(nowFields.map(f => f.typedEvents), thenFields.map(f => f.typedEvents),
          'the dispatched events changed for [' + spec.map(s => s.__label).join(' + ') + ']');
      }
    }
    console.log('  P0 numeric-field guard: Patient ID fields excluded (12 signals), the outranking Patient ID field no longer wins (3.0.36 types into it - proven), lone numeric field refused by name, all-digits still allowed, pre-write re-assert fires, 5 normal-search fixtures identical to 3.0.36');
  }

  /* 1. STRUCTURE: a row that mutates mid-verification is re-located by its
     stable anchor and re-verified on an extra pass. Nothing is refused. */
  {
    const counter = { pulls: 0 };
    const good = appointment('good', '9:20 AM Smith, John (58yo M)');
    const mutating = appointment('mut', () => counter.pulls >= 3
      ? '9:00 AM Miller, Anna (52yo F)'
      : '9:00 AM');
    const col = countingColumn(0, [good, mutating], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'mutating row was not recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.candidateCount, 2);
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert(Number(result.diag.reverifyPasses || 0) >= 1, 'no re-verify pass ran');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    assert(result.appts.some(a => a.name === 'Anna Miller'), 'recovered row lost its verified identity');
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, true);
  }

  /* 2. STRUCTURE: an identity-less row (no appointment id, no name shape, no
     DOB/MRN) that never verifies is named in the receipt as non-clinical,
     excluded from parsedCount, and the day now completes. */
  {
    const counter = { pulls: 0 };
    const good = appointment('good2', '8:00 AM Smith, John (58yo M)');
    const hold = appointment('hold', '10:10 AM 15 min');
    const col = countingColumn(0, [good, hold], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 1, 'identity-less row leaked into parsedCount');
    assert.strictEqual(result.diag.candidateCount, 2, 'identity-less row vanished from candidate accounting');
    assert.strictEqual(result.diag.unnamedCount, 1);
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1, 'unverifiable row was not named in the receipt');
    assert.strictEqual(rows[0].kind, 'no-identity-cell');
    assert.strictEqual(rows[0].time, '10:10 AM');
    assert(!('name' in rows[0]), 'receipt row must never carry name text');
    assert(!result.appts.some(a => a.time === '10:10 AM'), 'non-clinical row was imported');
    const receipt = receiptFor(result.diag, result.diag.viewportCoverage.complete);
    assert.strictEqual(receipt.provenNonClinical, 1);
    assert.strictEqual(receipt.complete, true, 'expectedCount - provenNonClinical === parsedCount must complete');
  }

  /* 3. STRUCTURE: an identity-bearing fragment that will not verify still
     refuses the day (kind mutating, never guessed, never completed). */
  {
    const counter = { pulls: 0 };
    const good = appointment('good3', '8:00 AM Smith, John (58yo M)');
    const fragment = appointment('frag', '10:30 AM Zeta');
    const col = countingColumn(0, [good, fragment], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 1);
    assert.strictEqual(result.diag.unnamedCount, 1);
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'mutating', 'identity fragment was classified non-clinical');
    assert(!result.appts.some(a => /zeta/i.test(a.name || '')), 'identity fragment was guessed into a patient');
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, false,
      'identity-bearing unverifiable row completed the day');
  }

  /* 4. LEGACY: a grid row that re-renders mid-read is re-located by its own
     node and re-verified; the day imports every real patient. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    let reads = 0;
    const good = legacyRow('10:40 AM Field, Sarah Office visit', { id: 'legacy-good' });
    const mutating = legacyRow(() => (++reads >= 2)
      ? '11:00 AM Green, Laura Office visit'
      : '11:00 AM', { id: 'legacy-mut' });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, mutating], provider)], [provider]), {});
    assert.strictEqual(result.diag.via, 'legacy-day-grid');
    assert.strictEqual(result.diag.parsedCount, 2, 'legacy mutating row was not recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.candidateCount, 2);
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    assert(result.appts.every(a => a.provider === 'Matthew_Schaeffer_MD'));
    assert.strictEqual(receiptFor(result.diag, true).complete, true);
  }

  /* 5. LEGACY: an identity-less hold/frame row is named non-clinical and the
     day completes without it; an identity fragment still refuses. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const good = legacyRow('11:10 AM Field, Sarah Office visit', { id: 'legacy-good-2' });
    const hold = legacyRow('11:20 AM 30 min', { id: 'legacy-hold' });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, hold], provider)], [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 1);
    assert.strictEqual(result.diag.candidateCount, 2);
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'no-identity-cell');
    assert.strictEqual(rows[0].lane, 'legacy-day-grid');
    assert.strictEqual(receiptFor(result.diag, true).complete, true);

    const fragment = legacyRow('11:40 AM Zeta', { id: 'legacy-frag' });
    const refused = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, fragment], provider)], [provider]), {});
    const refusedRows = plain(refused.diag.unverifiableRows || []);
    assert.strictEqual(refusedRows.length, 1);
    assert.strictEqual(refusedRows[0].kind, 'mutating');
    assert.strictEqual(receiptFor(refused.diag, true).complete, false,
      'legacy identity-bearing unverifiable row completed the day');
  }

  /* 6. LEGACY react-churn: live reads are ALWAYS torn (the check-in widget
     replaces the subtree), but the single synchronous outerHTML snapshot is
     intact - the row verifies from the string with id, region name, and
     self-validated chip DOB. This is the exact Friday 2026-07-31 shape. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const good = legacyRow('10:40 AM Field, Sarah Office visit', { id: 'legacy-good-3' });
    const churn = legacyRow(() => '9:40 AM', {
      id: 'legacy-churn',
      attrs: { 'data-appointment-id': '45532929' },
      outerHTML: CHURN_HTML
    });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, churn], provider)], [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'react-churn row was not snapshot-recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert.strictEqual(Number(result.diag.snapshotRecovered || 0), 1, 'snapshot recovery was not accounted');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    const recovered = result.appts.find(a => a.time === '9:40 AM');
    assert(recovered, 'snapshot-recovered row missing from appts');
    assert.strictEqual(recovered.name, 'Reed Piper');
    assert.strictEqual(recovered.appointmentId, '45532929');
    assert.strictEqual(recovered.dob, '01/01/1958');
    assert.strictEqual(recovered.provider, 'Matthew_Schaeffer_MD');
    assert.strictEqual(receiptFor(result.diag, true).complete, true);
  }

  /* 7. STRUCTURE react-churn: same defect on the structured surface - the
     pending anchor (appointment id) relocates the row and the snapshot
     verifies it through the normal dedup. */
  {
    const counter = { pulls: 0 };
    const good = appointment('good7', '8:00 AM Smith, John (58yo M)');
    const churn = appointment('churn7', () => '9:40 AM', {
      appointmentId: '45532929',
      outerHTML: CHURN_HTML.replace('filled-appointment-row', 'PatientAppointment_appointment-container')
    });
    const col = countingColumn(0, [good, churn], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'structure churn row was not snapshot-recovered: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.unnamedCount, 0);
    assert.strictEqual(Number(result.diag.snapshotRecovered || 0), 1);
    const recovered = result.appts.find(a => a.appointmentId === '45532929');
    assert(recovered, 'structure snapshot-recovered row missing');
    assert.strictEqual(recovered.name, 'Reed Piper');
    assert.strictEqual(recovered.provider, 'Doctor_One_MD');
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, true);
  }

  /* 8. LEGACY react-churn ambiguity: a snapshot naming TWO patient-bound
     regions is never guessed - the row stays mutating and the day refuses. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const good = legacyRow('10:40 AM Field, Sarah Office visit', { id: 'legacy-good-4' });
    const churn = legacyRow(() => '9:40 AM', {
      id: 'legacy-churn-2',
      attrs: { 'data-appointment-id': '45532929' },
      outerHTML: CHURN_HTML.replace('</li>', '<a class="encounter-link">Sally Jones</a></li>')
    });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([good, churn], provider)], [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 1, 'ambiguous two-patient snapshot was imported');
    assert(!result.appts.some(a => /piper|jones/i.test(a.name || '')), 'a guessed patient name leaked');
    const rows = plain(result.diag.unverifiableRows || []);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].kind, 'mutating');
    assert.strictEqual(rows[0].snapshot, true, 'refusal did not record that a snapshot was read');
    assert.strictEqual(rows[0].snapshotParse, 'ambiguous-candidates',
      'the receipt did not name the failing snapshot-parse stage');
    assert.strictEqual(receiptFor(result.diag, true).complete, false);
  }

  /* 9. LEGACY double-render collapse (rev-3): the live dashboard paints every
     appointment as TWO identical LI copies in parallel lists. When one copy
     parses and the other churns mid-walk, the churning copy is a duplicate
     render of ALREADY-CAPTURED content - content-keyed stability drops it
     instead of refusing the day as kind:'mutating'. */
  {
    const provider = legacyRow('Matthew_Schaeffer_MD');
    const copyA = legacyRow('9:40 AM Doe, Bob Office visit', {
      id: 'legacy-copy-a', attrs: { 'data-appointment-id': '45532929' }
    });
    /* copy B: same appointment id, torn text forever, no snapshot available */
    const copyB = legacyRow(() => '9:40 AM', {
      id: 'legacy-copy-b', attrs: { 'data-appointment-id': '45532929' }
    });
    const other = legacyRow('10:00 AM Field, Sarah Office visit', { id: 'legacy-other' });
    const result = await runtime.mlsSchedDomInline(
      legacyScheduleDoc(
        [legacyContainer([copyA, other], provider), legacyContainer([copyB], provider)],
        [provider]), {});
    assert.strictEqual(result.diag.parsedCount, 2, 'double-render collapse changed parsed truth: ' + JSON.stringify(result.diag));
    assert.strictEqual(result.diag.candidateCount, 2, 'the duplicate render leaked into candidate accounting');
    assert.strictEqual(result.diag.unnamedCount, 0, 'a duplicate render of captured content was counted unverifiable');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), [],
      'a same-id duplicate render produced a receipt refusal');
    assert.strictEqual(Number(result.diag.duplicateUnverifiableCollapsed || 0), 1,
      'the collapse was not accounted in diag');
    assert.strictEqual(result.appts.filter(a => a.appointmentId === '45532929').length, 1);
    assert.strictEqual(receiptFor(result.diag, true).complete, true,
      'relocated-only duplicate of identical captured content must not refuse the day');

    /* control: a genuinely unaccounted torn row (unique id, never parses)
       still refuses exactly as before - the collapse is id/content-keyed,
       not a blanket amnesty. */
    const foreign = legacyRow(() => '11:20 AM', {
      id: 'legacy-foreign', attrs: { 'data-appointment-id': '99911122' }
    });
    const refused = await runtime.mlsSchedDomInline(
      legacyScheduleDoc([legacyContainer([copyA, foreign], provider)], [provider]), {});
    const refusedRows = plain(refused.diag.unverifiableRows || []);
    assert.strictEqual(refusedRows.length, 1, 'a genuinely unaccounted row was collapsed away');
    assert.strictEqual(refusedRows[0].kind, 'mutating');
    assert.strictEqual(refusedRows[0].appointmentId, '99911122');
    assert.strictEqual(receiptFor(refused.diag, true).complete, false);
  }

  /* 10. STRUCTURE double-render collapse: a pending instance whose appointment
     id already produced a parsed candidate is skipped by the receipt build -
     node identity and position never enter the stability judgment. */
  {
    const counter = { pulls: 0 };
    const copyA = appointment('s-copy-a', '9:40 AM Doe, Bob (68yo F)', { appointmentId: '45532929' });
    const copyB = appointment('s-copy-b', () => '9:40 AM', { appointmentId: '45532929' });
    const good = appointment('s-good', '8:00 AM Smith, John (58yo M)');
    const col = countingColumn(0, [good, copyA, copyB], counter);
    const result = await runtime.mlsSchedDomInline(scheduleDoc({
      columns: [col], headers: [header('Doctor_One_MD', 0)]
    }), {});
    assert.strictEqual(result.diag.parsedCount, 2, JSON.stringify(result.diag));
    assert.strictEqual(result.diag.unnamedCount, 0,
      'a same-id duplicate render was counted unverifiable on the structured surface');
    assert.deepStrictEqual(plain(result.diag.unverifiableRows || []), []);
    assert.strictEqual(result.appts.filter(a => a.appointmentId === '45532929').length, 1);
    assert.strictEqual(receiptFor(result.diag, result.diag.viewportCoverage.complete).complete, true);
  }

  /* ============ rev-8 (3.0.38): THE ROW-INTERNAL HEADER =====================
   * The live Aug-4 shape, replayed through BOTH readers. On 3.0.37 the receipt
   * above must reproduce exactly; on the candidate the artifact must drop out
   * of the harvest and both rows must bind to the GENUINE COLUMN HEADER - that
   * last assertion is the whole safety case. A genuine two-column day must
   * STILL refuse on both builds: the fix may not manufacture completeness.
   * ===================================================================== */
  {
    const priorPath = path.join(root, 'extension-candidates', '3.0.37', 'background.js');
    assert(fs.existsSync(priorPath),
      'the 3.0.37 before-reader is missing; the before/after pair cannot be proven');
    const priorSrc = fs.readFileSync(priorPath, 'utf8');
    assert(priorSrc.includes('function _legacyHeaderTextsL(list){var texts=[],seenH={};function addT(t){'),
      '3.0.37 no longer carries the unguarded header harvest - it is not a BEFORE reader');
    assert(!priorSrc.includes('function rowInternalH(n){'),
      '3.0.37 already carries the row-internal exclusion - it is not a BEFORE reader');
    assert(background.includes('function rowInternalH(n){'),
      'the candidate under test does NOT carry the fix - every assertion below would be vacuous');

    const readerFrom = (src, label) => {
      const ns = src.indexOf('function mlsParseName(raw)');
      const rs = src.indexOf('async function mlsSchedDomInline(doc, CFG)', ns);
      const re = src.indexOf('\n if (/stm\\.esp|', rs);
      assert(ns >= 0 && rs > ns && re > rs, 'could not extract the schedule reader from ' + label);
      return vm.runInContext(src.slice(ns, re) + '\n({ mlsSchedDomInline });',
        vm.createContext({ setTimeout, clearTimeout, Promise, Date, Event: FakeEvent }), { timeout: 5000 });
    };
    /* the handler's attribution-coverage block, run directly - the receipt the
       owner actually sees is judged there, not in the reader. */
    const coverageFrom = (src, label) => {
      const s = src.indexOf('          var __acNorm = function (v) {');
      const e = src.indexOf('        } catch (__eAC) {}', s);
      assert(s >= 0 && e > s, 'could not extract the attribution-coverage block from ' + label);
      return new Function('__providerRoster', '__providerRosterReceipt', '__mlsM',
        '__complete', '__authoritativeEmpty', '__schedRequestId',
        src.slice(s, e) + '\nreturn __providerRosterReceipt;');
    };
    const beforeReader = readerFrom(priorSrc, '3.0.37');
    const covBefore = coverageFrom(priorSrc, '3.0.37');
    const covAfter = coverageFrom(background, 'the candidate under test');

    /* ---- week-tab / legacy-grid doubles with a working closest() ---- */
    function hdrNode(text, opts = {}) {
      return {
        get textContent() { return text; },
        children: [], className: opts.className || '',
        getAttribute(n) { return (opts.attrs && opts.attrs[n]) || ''; },
        getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        /* the ONE capability this revision reads: is this node inside a row? */
        closest(sel) { return (opts.row && String(sel).includes('filled-appointment-row')) ? opts.row : null; }
      };
    }
    function gridContainer(rows, opts = {}) {
      const c = {
        textContent: '', children: rows,
        getAttribute(n) { return (opts.attrs && opts.attrs[n]) || ''; },
        getBoundingClientRect() { return { left: 0, right: 240, top: 0, width: 240 }; },
        contains() { return false; },
        querySelector(s) {
          if (s.includes('filled-appointment-row')) return rows[0] || null;
          if (s.includes('appointment-header2')) return (opts.tier1 || [])[0] || null;
          return null;
        },
        querySelectorAll(s) {
          if (s.includes('filled-appointment-row')) return rows;
          if (s.includes('appointment-header2')) return opts.tier1 || [];
          if (s.includes('[class*="appointment-header"]')) return opts.tier2 || [];
          return [];
        }
      };
      if (opts.previousSibling) c.previousElementSibling = opts.previousSibling;
      if (opts.parentHeaders) c.parentElement = {
        children: [], textContent: '',
        querySelectorAll(s) { return s.includes('[class*="appointment-header"]') ? opts.parentHeaders : []; }
      };
      return c;
    }
    function gridDoc(containers, headers) {
      const rows = containers.reduce((all, item) => all.concat(item.children || []), []);
      const allNodes = (headers || []).concat(containers, rows);
      return {
        body: { innerText: 'Legacy Athena day schedule' },
        location: { pathname: '/schedule/day' },
        scrollingElement: null,
        defaultView: { getComputedStyle() { return { overflowX: 'hidden', overflowY: 'hidden' }; } },
        querySelector() { return null; },
        querySelectorAll(selector) {
          if (selector === '*') return allNodes;
          if (selector === '[class~="appointments-container"]') return containers;
          if (selector === '[class~="filled-appointment-row"]') return rows;
          if (selector === 'div,span,h1,h2,h3,h4,th,td') return headers || [];
          return [];
        }
      };
    }
    /* fictional clinicians; SYNTHETIC patients */
    const COLUMN = 'Dana Whitfield, MD';
    const ARTIFACT = 'Supervising: Priya Ramanathan, DO';
    const SECOND_COLUMN = 'Priya Ramanathan, DO';
    const twoRows = tag => [
      legacyRow('8:20 AM Doe, Bob Office visit', { id: tag + '-a' }),
      legacyRow('9:00 AM Field, Sarah Office visit', { id: tag + '-b' })
    ];
    /* judge the receipt the way the handler does: the schedule read is complete
       and request-bound on BOTH builds (2/2, unnamed 0) - only attribution moves */
    const judge = (cov, result) => cov(
      plain(result.providerRoster || []),
      Object.assign({}, plain(result.providerRosterReceipt || {}), { requestId: 'rq-a4' }),
      { appts: plain(result.appts) },
      receiptFor(result.diag, true).complete, false, 'rq-a4');

    /* ---- 1. THE LIVE AUG-4 SHAPE: one container, one genuine column header,
       one credentialed per-row artifact inside a filled-appointment-row ---- */
    const aug4Doc = () => {
      const rows = twoRows('aug4');
      const column = hdrNode(COLUMN, { className: 'appointment-header-container' });
      const artifact = hdrNode(ARTIFACT, { className: 'appointment-header-detail', row: rows[1] });
      return gridDoc([gridContainer(rows, { tier2: [column, artifact] })], [column, artifact]);
    };

    /* BEFORE (3.0.37, the live-proven build): the live receipt, reproduced */
    {
      const b = await beforeReader.mlsSchedDomInline(aug4Doc(), {});
      assert.strictEqual(b.diag.via, 'legacy-day-grid', JSON.stringify(b.diag));
      assert.strictEqual(b.diag.parsedCount, 2, 'the Aug-4 READ did not reproduce as complete 2/2 on 3.0.37');
      assert.strictEqual(b.diag.candidateCount, 2);
      assert.strictEqual(b.diag.unnamedCount, 0);
      assert.strictEqual(receiptFor(b.diag, true).complete, true,
        'the Aug-4 schedule read must be COMPLETE on 3.0.37 - the defect is attribution, not the read');
      assert.strictEqual(b.providers.length, 2,
        'the two-header harvest did not reproduce on 3.0.37: ' + JSON.stringify(b.providers));
      assert.strictEqual(b.providerRosterReceipt.complete, false);
      assert.strictEqual(b.providerRosterReceipt.partial, true);
      assert.strictEqual(b.providerRosterReceipt.reason, 'legacy-unverified');
      assert.strictEqual(b.providerRosterReceipt.observedCount, 2);
      assert.strictEqual(b.providerRosterReceipt.expectedCount, null);
      assert(b.appts.every(a => a.provider === ''), 'a row bound to a provider on 3.0.37');
      const bj = judge(covBefore, b);
      assert.strictEqual(bj.attributionCoverage.verdict, 'row-unattributed',
        'the live Aug-4 verdict did not reproduce on 3.0.37: ' + JSON.stringify(bj.attributionCoverage));
      assert.strictEqual(bj.attributionCoverage.headerCount, 2);
      assert.strictEqual(bj.attributionCoverage.rows, 2);
      assert.strictEqual(bj.attributionCoverage.unattributedRows, 2);
      assert.strictEqual(bj.attributionCoverage.foreignRows, 0);
      assert.strictEqual(bj.complete, false, 'the Aug-4 day imported on 3.0.37');
      assert.strictEqual(b.diag.headerProvenance, undefined,
        '3.0.37 already reports headerProvenance - the diagnostic assertions would be vacuous');

      /* AFTER: the artifact leaves the harvest and the day binds CORRECTLY */
      const a = await runtime.mlsSchedDomInline(aug4Doc(), {});
      assert.strictEqual(a.diag.parsedCount, 2, 'the fix changed the READ: ' + JSON.stringify(a.diag));
      assert.strictEqual(a.diag.candidateCount, 2);
      assert.strictEqual(a.diag.unnamedCount, 0);
      assert.deepStrictEqual(plain(a.providers), [COLUMN],
        'the row-internal artifact is STILL harvested as a column header: ' + JSON.stringify(a.providers));
      assert.strictEqual(a.providerRosterReceipt.complete, true,
        'the Aug-4 roster still refuses after the fix: ' + JSON.stringify(a.providerRosterReceipt));
      assert.strictEqual(a.providerRosterReceipt.partial, false);
      assert.strictEqual(a.providerRosterReceipt.observedCount, 1);
      /* THE SAFETY CASE: every row is bound to the GENUINE COLUMN HEADER, and
         never to the per-row artifact. A wrong bind reads GREEN on the coverage
         gate, so this assertion - not the receipt - is what proves the fix. */
      assert.strictEqual(a.appts.length, 2);
      assert(a.appts.every(x => x.provider === COLUMN),
        'rows did not bind to the genuine column header: ' + JSON.stringify(a.appts.map(x => x.provider)));
      assert(!a.appts.some(x => /Ramanathan|Supervising/i.test(x.provider || '')),
        'A ROW WAS BOUND TO THE PER-ROW ARTIFACT - a visit was attributed to a clinician who did not render it');
      const aj = judge(covAfter, a);
      assert.strictEqual(aj.complete, true, 'the Aug-4 day still does not import: ' + JSON.stringify(aj));
      assert.strictEqual(aj.attributionCoverage.headerCount, 1,
        'headerCount did not fall to 1: ' + JSON.stringify(aj.attributionCoverage));
      assert.strictEqual(aj.attributionCoverage.unattributedRows === undefined
        ? 0 : aj.attributionCoverage.unattributedRows, 0);

      /* the diagnostic names WHICH TIER produced each header and whether it was
         row-internal. Clinician names may ride a receipt; patient identity may
         not - only tier, a boolean and a LENGTH are carried. */
      const prov = plain(a.diag.headerProvenance || []);
      assert.deepStrictEqual(prov, [
        { tier: 2, rowInternal: false, textLen: COLUMN.length },
        { tier: 2, rowInternal: true, textLen: ARTIFACT.length }
      ], 'headerProvenance did not name the tier/rowInternal pair: ' + JSON.stringify(prov));
      assert.deepStrictEqual(plain(a.providerRosterReceipt.headerProvenance || []), prov,
        'headerProvenance did not ride the roster receipt');
      const provJson = JSON.stringify(prov);
      assert(!/Whitfield|Ramanathan|Doe|Field|Bob|Sarah/i.test(provJson),
        'headerProvenance leaked a name into the receipt: ' + provJson);
      assert(!/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(provJson), 'headerProvenance leaked a date');
    }

    /* ---- 2. CONTROL: a GENUINE two-column day still refuses on BOTH builds.
       The fix removes false headers; it must never manufacture completeness. */
    {
      const genuineTwo = () => {
        const rows = twoRows('two');
        const c1 = hdrNode(COLUMN, { className: 'appointment-header-container' });
        const c2 = hdrNode(SECOND_COLUMN, { className: 'appointment-header-container' });
        return gridDoc([gridContainer(rows, { tier2: [c1, c2] })], [c1, c2]);
      };
      for (const [label, reader, cov] of [['3.0.37', beforeReader, covBefore], ['candidate', runtime, covAfter]]) {
        const r = await reader.mlsSchedDomInline(genuineTwo(), {});
        assert.deepStrictEqual(plain(r.providers), [COLUMN, SECOND_COLUMN],
          label + ': a genuine column header was dropped from the harvest');
        assert.strictEqual(r.providerRosterReceipt.complete, false,
          label + ': a genuine two-column day was completed: ' + JSON.stringify(r.providerRosterReceipt));
        assert.strictEqual(r.providerRosterReceipt.reason, 'legacy-unverified');
        assert.strictEqual(r.providerRosterReceipt.observedCount, 2);
        assert(r.appts.every(x => x.provider === ''),
          label + ': a genuine two-column day guessed a provider onto a row');
        const j = judge(cov, r);
        assert.strictEqual(j.complete, false, label + ': the two-column control imported');
        assert.strictEqual(j.attributionCoverage.verdict, 'row-unattributed', label + ': the control verdict drifted');
        assert.strictEqual(j.attributionCoverage.headerCount, 2, label + ': the control headerCount drifted');
      }
      const rr = await runtime.mlsSchedDomInline(genuineTwo(), {});
      assert.deepStrictEqual(plain(rr.diag.headerProvenance), [
        { tier: 2, rowInternal: false, textLen: COLUMN.length },
        { tier: 2, rowInternal: false, textLen: SECOND_COLUMN.length }
      ], 'the genuine two-column control was misreported as row-internal');
    }

    /* ---- 3. A/B ACROSS THE TIER ZOO. ONLY the two row-internal-artifact
       fixtures may differ; tiers 3, 4 and 5 must be byte-identical, INCLUDING
       a tier-5 candidate that IS row-internal (tier 5 is deliberately not
       gated - it already has its own !list.contains(h) discipline). ---- */
    {
      const fixtures = [
        { label: 'aug4/tier2-row-internal-artifact', differs: true, build: aug4Doc },
        { label: 'aug4/tier1-row-internal-artifact', differs: true, build() {
            const rows = twoRows('t1');
            const column = hdrNode(COLUMN, { className: 'appointment-header2' });
            const artifact = hdrNode(ARTIFACT, { className: 'appointment-header2', row: rows[1] });
            return gridDoc([gridContainer(rows, { tier1: [column, artifact] })], [column, artifact]); } },
        { label: 'genuine-two-column', differs: false, build() {
            const rows = twoRows('gg');
            const c1 = hdrNode(COLUMN, { className: 'appointment-header-container' });
            const c2 = hdrNode(SECOND_COLUMN, { className: 'appointment-header-container' });
            return gridDoc([gridContainer(rows, { tier2: [c1, c2] })], [c1, c2]); } },
        { label: 'tier1/single-classic-column', differs: false, build() {
            const rows = twoRows('s1'); const c = hdrNode(COLUMN, { className: 'appointment-header2' });
            return gridDoc([gridContainer(rows, { tier1: [c] })], [c]); } },
        { label: 'tier2/single-variant-column', differs: false, build() {
            const rows = twoRows('s2'); const c = hdrNode(COLUMN, { className: 'appointment-header-container' });
            return gridDoc([gridContainer(rows, { tier2: [c] })], [c]); } },
        { label: 'tier3/container-attribute', differs: false, build() {
            const rows = twoRows('t3');
            return gridDoc([gridContainer(rows, { attrs: { 'data-provider-name': COLUMN } })], []); } },
        { label: 'tier4/previous-sibling', differs: false, build() {
            const rows = twoRows('t4'); const sib = hdrNode(COLUMN, { className: 'schedule-heading' });
            return gridDoc([gridContainer(rows, { previousSibling: sib })], [sib]); } },
        { label: 'tier5/parent-scope', differs: false, build() {
            const rows = twoRows('t5'); const h = hdrNode(COLUMN, { className: 'appointment-header-container' });
            return gridDoc([gridContainer(rows, { parentHeaders: [h] })], [h]); } },
        { label: 'tier5/parent-scope-ROW-INTERNAL', differs: false, build() {
            const rows = twoRows('t5r');
            const h = hdrNode(COLUMN, { className: 'appointment-header-detail', row: rows[0] });
            return gridDoc([gridContainer(rows, { parentHeaders: [h] })], [h]); } },
        { label: 'tier5/parent-scope-ambiguous', differs: false, build() {
            const rows = twoRows('t5a');
            const h1 = hdrNode(COLUMN, { className: 'appointment-header-container' });
            const h2 = hdrNode(SECOND_COLUMN, { className: 'appointment-header-container' });
            return gridDoc([gridContainer(rows, { parentHeaders: [h1, h2] })], [h1, h2]); } },
        { label: 'no-headers-anywhere', differs: false, build() {
            return gridDoc([gridContainer(twoRows('nh'), {})], []); } },
        { label: 'chrome-text-only', differs: false, build() {
            const rows = twoRows('ct');
            const chrome = hdrNode('Appointments for next week', { className: 'appointment-header-container' });
            return gridDoc([gridContainer(rows, { tier2: [chrome] })], [chrome]); } }
      ];
      /* headerProvenance is the NEW diagnostic; it may not mask a behaviour change */
      const strip = res => {
        const o = plain(res);
        if (o.diag) delete o.diag.headerProvenance;
        if (o.diag && o.diag.providerRosterReceipt) delete o.diag.providerRosterReceipt.headerProvenance;
        if (o.providerRosterReceipt) delete o.providerRosterReceipt.headerProvenance;
        /* 3.0.40 additive diagnostics (er-1.2 served-day provenance + pp-1.2
           census reconciliation + settled-empty proof) - all pinned by their
           own contracts (schedule-empty-day-settle, pull-reconciliation);
           stripped here so this A/B keeps comparing 3.0.37-era behaviour. */
        if (o.diag) {
          delete o.diag.unwalkedRows; delete o.diag.schedDateScope;
          delete o.diag.schedDateAmbiguous; delete o.diag.emptyProof; delete o.diag.emptyStable;
        }
        return o;
      };
      const differed = [];
      for (const fx of fixtures) {
        const b = strip(await beforeReader.mlsSchedDomInline(fx.build(), {}));
        const a = strip(await runtime.mlsSchedDomInline(fx.build(), {}));
        const same = JSON.stringify(a) === JSON.stringify(b);
        if (!same) differed.push(fx.label);
        if (fx.differs) {
          assert(!same, 'fixture ' + fx.label + ' was supposed to change and did not - the fix is not reached here');
        } else {
          assert.deepStrictEqual(a, b, 'fixture ' + fx.label + ': behaviour changed outside the row-internal class');
        }
      }
      assert.deepStrictEqual(differed, fixtures.filter(f => f.differs).map(f => f.label),
        'the A/B difference set drifted from the row-internal-artifact fixtures');
      /* the tier-5 row-internal fixture must have BEEN row-internal - otherwise
         "tier 5 untouched" is proven against a node that never tripped the rule */
      const t5 = await runtime.mlsSchedDomInline(
        fixtures.find(f => f.label === 'tier5/parent-scope-ROW-INTERNAL').build(), {});
      assert.deepStrictEqual(plain(t5.diag.headerProvenance),
        [{ tier: 5, rowInternal: true, textLen: COLUMN.length }],
        'the tier-5 control was not row-internal - the "tier 5 untouched" proof is vacuous');
      assert.deepStrictEqual(plain(t5.providers), [COLUMN], 'tier 5 lost its header to the tier-1/2 exclusion');
      console.log('  A/B vs 3.0.37 (' + fixtures.length + ' fixtures): differ = ' + differed.join(', ') + '; all others deepStrictEqual');
    }

    /* ---- 4. THE WRONG BIND 3.0.37 ALREADY SHIPS. When a row-internal
       artifact is the ONLY tier-2 candidate, 3.0.37 sees exactly one header,
       binds EVERY row to it, and stamps complete:true reason:'complete' - a
       visit attributed to a clinician who did not render it, with a GREEN
       receipt. This is the failure mode the coverage gate structurally cannot
       see (a wrongly-bound row has a provider that IS on the roster, so
       unattributedRows and foreignRows both read 0). Two outcomes, both right:
       (a) another tier holds the genuine column header, and the rows re-bind to
       the CORRECT clinician; (b) no other tier does, and the day refuses. A
       refusal is the correct trade against a wrong attribution. ---- */
    {
      const artifactOnly = extra => {
        const rows = twoRows('wb');
        const artifact = hdrNode(ARTIFACT, { className: 'appointment-header-detail', row: rows[1] });
        const opts = Object.assign({ tier2: [artifact] }, extra || {});
        const headers = [artifact].concat(extra && extra.previousSibling ? [extra.previousSibling] : []);
        return gridDoc([gridContainer(rows, opts)], headers);
      };

      /* (a) a genuine tier-4 sibling header exists */
      const sibling = hdrNode(COLUMN, { className: 'schedule-heading' });
      const bA = await beforeReader.mlsSchedDomInline(artifactOnly({ previousSibling: sibling }), {});
      assert.deepStrictEqual(plain(bA.providers), [ARTIFACT],
        '3.0.37 did not reproduce the artifact-only harvest: ' + JSON.stringify(bA.providers));
      assert(bA.appts.every(x => x.provider === ARTIFACT),
        '3.0.37 did not reproduce the wrong bind: ' + JSON.stringify(bA.appts.map(x => x.provider)));
      assert.strictEqual(bA.providerRosterReceipt.complete, true,
        'the 3.0.37 wrong bind must reproduce as a GREEN receipt - that is the whole point');
      assert.strictEqual(judge(covBefore, bA).complete, true,
        'the coverage gate must be structurally blind to a wrong bind on 3.0.37');

      const aA = await runtime.mlsSchedDomInline(artifactOnly({ previousSibling: sibling }), {});
      assert.deepStrictEqual(plain(aA.providers), [COLUMN],
        'the wrong bind survives: ' + JSON.stringify(aA.providers));
      assert(aA.appts.every(x => x.provider === COLUMN),
        'rows did not re-bind to the genuine header: ' + JSON.stringify(aA.appts.map(x => x.provider)));
      assert(!aA.appts.some(x => /Ramanathan|Supervising/i.test(x.provider || '')),
        'A VISIT IS STILL ATTRIBUTED TO THE SUPERVISING ARTIFACT');
      assert.strictEqual(aA.providerRosterReceipt.complete, true, 'the corrected day must still import');
      assert.deepStrictEqual(plain(aA.diag.headerProvenance), [
        { tier: 2, rowInternal: true, textLen: ARTIFACT.length },
        { tier: 4, rowInternal: false, textLen: COLUMN.length }
      ], 'the fall-through to tier 4 was not named on the receipt');

      /* (b) no other header source: refuse rather than attribute wrongly */
      const bB = await beforeReader.mlsSchedDomInline(artifactOnly(), {});
      assert(bB.appts.every(x => x.provider === ARTIFACT), '3.0.37 control did not reproduce the wrong bind');
      assert.strictEqual(bB.providerRosterReceipt.complete, true, '3.0.37 control was not green');

      const aB = await runtime.mlsSchedDomInline(artifactOnly(), {});
      assert.deepStrictEqual(plain(aB.providers), [], 'the artifact was still harvested with no other header source');
      assert(aB.appts.every(x => x.provider === ''), 'a row kept a provider it cannot prove');
      assert.strictEqual(aB.providerRosterReceipt.complete, false,
        'a day whose only header is a row artifact must REFUSE, not import');
      assert.strictEqual(aB.providerRosterReceipt.reason, 'no-provider-headers');
      assert.deepStrictEqual(plain(aB.diag.headerProvenance),
        [{ tier: 2, rowInternal: true, textLen: ARTIFACT.length }],
        'the refusal must name the row-internal candidate that caused it');
      console.log('  wrong-bind class: 3.0.37 attributes every row to a row-internal "Supervising:" artifact and reports complete:true; the candidate re-binds to the genuine header when one exists and refuses when none does');
    }
  }

  console.log('PASS mutating-row re-verify, snapshot string verification, content-keyed double-render collapse, snapshotParse stage naming, non-clinical receipt naming, DOM-validation removal naming (invalidRows, behaviour unchanged), surname-ambiguous STOP exemption in nameTokens (live row kept 6->7, fail-closed guards unchanged vs 3.0.36), row-internal header exclusion at harvest tiers 1-2 with headerProvenance (live Aug-4 binds to the GENUINE column header, the 3.0.37 wrong bind to a "Supervising:" row artifact is corrected or refused, genuine two-column day still refuses, tiers 3/4/5 identical to 3.0.37), and fail-closed identity refusal');
})().catch(error => { console.error(error); process.exit(1); });
