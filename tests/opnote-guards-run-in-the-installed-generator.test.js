'use strict';
/*
 * THE GUARD MUST BE IN THE FUNCTION THAT ACTUALLY RUNS
 * -----------------------------------------------------------------------------
 * b925 and b927 put the drug guard, the date guard and both prompt carve-outs
 * into ScribeFlow.html's `_genOpNote`. feat_mls_opnote_integrity.js REPLACES
 * `window._genOpNote` with its own `generate` and stamps `__mlsopWrapped`, and
 * it builds its OWN system prompt. So every one of those layers sat in a
 * function nothing calls.
 *
 * QA proved it on live b926:
 *     window._genOpNote.__mlsopWrapped                    : true
 *     String(window._genOpNote).includes('_opGuardDrugBlanks') : FALSE
 *     return keys : ["note","missing","templateFidelity","templateMode","clinicalConsistency"]
 *     window.__mlsOpDrugGuard                             : null
 * and a fresh draft still read "80 mg triamcinolone ... 0.25% bupivacaine".
 *
 * A PATIENT-SAFETY FIX THAT SHIPPED AND DID NOTHING, twice, in two builds.
 *
 * The codebase already warns about this exact shadow — the comment at
 * feat_mls_opnote_integrity.js:416 says the abbreviation work had to move into
 * this module because "patching the shadowed ScribeFlow copy looked right and
 * shipped nothing". I quoted that line to QA and then did the same thing.
 * The sibling suites stayed green because they exercise the ScribeFlow
 * definition or its source text — never the installed function. That is the
 * failure this file exists to make impossible.
 *
 * SO THIS SUITE ASSERTS ON THE INSTALLER, NOT ON A FILE. It reads
 * feat_mls_opnote_integrity.js — the module that wins — and pins that the
 * generator it installs invokes the guards and carries the safety clauses.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const integrity = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const scribe = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 0. the premise: this module really is the one that wins ------------ */
assert(/window\._genOpNote\s*=/.test(integrity),
  'feat_mls_opnote_integrity.js no longer installs _genOpNote — if ownership moved, EVERY assertion below is pointed at the wrong file and must be re-aimed');
assert(/generate\.__mlsopWrapped\s*=\s*true/.test(integrity),
  'the installed generator no longer stamps __mlsopWrapped — the ownership marker QA probes on live is gone');

/* ---- 1. the installed generator calls both guards ----------------------- */
const at = integrity.indexOf('function generate(');
assert(at >= 0, 'the installed generator `generate` is gone from the integrity module');
let depth = 0, started = false, end = at;
for (let i = at; i < integrity.length; i++) {
  const c = integrity[i];
  if (c === '{') { depth++; started = true; }
  else if (c === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
}
const installed = integrity.slice(at, end);

assert(installed.includes('_opGuardDrugBlanks'),
  'the INSTALLED generator does not call _opGuardDrugBlanks — a definition in ScribeFlow.html is shadowed by this module and does nothing. This is the exact live b926 defect: the doctor gets "80 mg triamcinolone" and the guard never runs.');
assert(installed.includes('_opGuardProcedureDate'),
  'the INSTALLED generator does not call _opGuardProcedureDate — the date fix is shadowed the same way');

/* Order matters: the date guard may PREPEND a line, so it must run before the
   drug guard inspects the note, or a re-blanked drug field could be separated
   from the text the doctor reads. Cheap to pin, expensive to rediscover. */
/* Match the CALL SITES, not the names. The first version compared
   indexOf('_opGuardProcedureDate') against indexOf('_opGuardDrugBlanks') and
   failed on correct code, because the explanatory comment above the calls
   mentions the drug guard first. A test that reads prose as if it were
   execution order is measuring the wrong thing — the same class as everything
   else tonight, just aimed at itself. */
const dateCall = installed.indexOf('window._opGuardProcedureDate(');
const drugCall = installed.indexOf('window._opGuardDrugBlanks(');
assert(dateCall >= 0 && drugCall >= 0, 'the guards are named in the installed generator but never CALLED — mentioning is not invoking');
assert(dateCall < drugCall,
  'the guards run in the wrong order — the date guard must run first, since it prepends');

/* ---- 2. the guards are still single-sourced, not copy-pasted ------------ */
assert(scribe.includes('function _opGuardDrugBlanks'),
  'the drug guard implementation vanished from ScribeFlow.html');
assert(!/function\s+_opGuardDrugBlanks/.test(integrity),
  'the drug guard was COPIED into the integrity module — two implementations will diverge, and the one that is not running will be the one someone reads');

/* ---- 3. the prompt clauses moved too --------------------------------- */
assert(/var sys=/.test(integrity),
  'the integrity module no longer builds its own system prompt — re-check where the model instructions actually come from');
assert(/NEVER INVENT A DRUG OR A DOSE/.test(integrity),
  'the drug carve-out is not in the prompt THIS module sends — the ScribeFlow copy is never transmitted');
assert(/ALWAYS WRITE THE DATE OF PROCEDURE/.test(integrity),
  'the procedure-date instruction is not in the prompt THIS module sends');

/* ---- 4. THE GENERAL RULE, so the next fix does not repeat this ---------
   Every window.* function this module replaces is a place where a fix written
   against the app's own definition will silently do nothing. Enumerate them,
   so the list is visible to whoever ships the next op-note change rather than
   being rediscovered from a live defect report. */
/* `=` but not `==`. The first version counted `typeof window._opGuardDrugBlanks==='function'`
   as a REPLACEMENT, so the guards this module merely calls appeared in the list
   of functions it overwrites — a shadow list that names innocent functions is
   worse than none, because the next reader trusts it. */
const replaced = [...integrity.matchAll(/window\.(_op[A-Za-z]+|_genOpNote)\s*=(?!=)/g)].map((m) => m[1]);
const unique = [...new Set(replaced)].sort();
assert(unique.length >= 3,
  'the shadow list collapsed to ' + unique.length + ' — either this module stopped owning the op-note pipeline, or the pattern that finds the replacements has drifted');
assert(unique.includes('_genOpNote'), 'the generator is missing from the shadow list — the scan is not seeing the replacement it is meant to police');

console.log('PASS op-note guards run in the INSTALLED generator: feat_mls_opnote_integrity.js owns ' + unique.length +
  ' window functions (' + unique.join(', ') + '), its generate() calls both guards in prepend-then-inspect order, ' +
  'the implementations stay single-sourced in ScribeFlow.html, and both safety clauses are in the prompt this module actually sends');
