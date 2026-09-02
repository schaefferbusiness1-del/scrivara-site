'use strict';

/*
 * Guarded changed-area release precheck.
 *
 * This is intentionally not a replacement for tests/run-all.js.  It is a
 * short, dependency-aware precheck for a small, already-reviewed change.  A
 * release is allowed only when every changed path belongs to an explicit
 * scope, the worktree is clean, and the scope has no full-gate trigger.  The
 * completed precheck prints FAST_GATE_PLAN and FAST_GATE_COMPLETE; a refused
 * release stops at FAST_GATE_REFUSED. A successful fast precheck still prints
 * full_gate_required=true when the change cannot
 * be promoted safely without the canonical GATE_COMPLETE=860 proof.
 *
 * Usage:
 *   node scripts/fast-release-gate.js --base=origin/main --mode=precheck
 *   node scripts/fast-release-gate.js --base=origin/main --mode=release
 *   node scripts/fast-release-gate.js --base=origin/main --plan
 *
 * --mode=release refuses to call a fast precheck a release when a full gate
 * is required.  The script performs no deployment, network mutation, or
 * browser interaction beyond the existing local focused tests it launches.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
/* Kept in sync with tests/run-all.js by the deterministic contract test. */
/* b1088 reconciliation: 875 registered at b1087
   + 1p-writeflow-opnote-clarity-progress = 876
   + 1p-phone-desktop-open-visit-relay = 877
   + 1p-phone-direct-mediarecorder-runtime = 878
   + sparse-safety-instruction-survives-focus = 879
   + generation-claim-repair-template-runtime = 880
   + generation-structured-profile-unlinked-runtime = 881
   + patient-chart-fields-normalize-at-the-door = 882.
   880 and 881 were NOT new suites: generation-claim-repair-template-runtime and
   generation-structured-profile-unlinked-runtime landed with ac8ffc49 /
   bfd2ad76 on 2026-08-27 and were never registered, so the gate had never once
   executed either of them. run-all's own registry check caught it while 879 was
   being added.
   2026-08-28 continued (the ledger had stopped at 882 while the constant moved,
   which defeats the point of keeping one - a completeness review caught that):
   + dock-settings-controls-never-throw = 883
       the two Settings dock controls, EXECUTED with their dynamically loaded
       owners present and absent (b1099)
   + upload-templates-button-cannot-vanish = 884
       the three silent ways the injected "Upload templates" control can
       disappear - anchor prose, click-interception label, navigator ids
   + phone-day-picker-and-stale-pull = 885
       the phone day control shipped in b1092 with no behavioural test at all;
       this executes goToDay and pullDay, and pins that a pull answering after
       the doctor has moved day is DROPPED rather than painted under the wrong
       heading (the phday-1.0.1 guard) */
/* 2026-08-28 patient-record lane: 885 -> 894. All NINE were added with a gate
   INVARIANT but were never registered in tests/run-all.js, which made run-all
   ERROR OUT instead of running - the canonical full gate was dead for those
   builds while the fast gate stayed green. run-all's own registry check is what
   caught it. Registering them moved GATE_PLAN total to 894.
   + suspect-notice-cannot-be-hidden = 886
   + patient-delete-reaches-the-server = 887
   + patient-delete-can-be-undone = 888
   + f5-automerge-needs-positive-identity = 889
   + patient-merge-is-durable = 890
   + merge-review-surface = 891
   + patient-demographics-are-editable = 892
   + prep-summary-is-folded-not-lost = 893
   + visit-timeline-not-shown-twice = 894 */
/*   + studio-widget-bridge-contract = 895 */
/*   + follow-residue-proof (residue-1.0.0, b1189) = 935 */
/*   + visit-template-scope-proof (vntpl-1.1.0, 2026-09-01) = 936 - the
       standard visit note only ever takes a VISIT-NOTE template; an operative
       report is left to the op-note room. */
/*   + capture-keeps-selection-proof (capsel-1.0.0, b1192) = 937 - an
       MLS-driven read or capture never changes the doctor's active patient;
       seven frozen capture-path writers keep their data work and skip only
       the selection change. */
/*   + write-next-press-proof (wfnext-1.0.0, 2026-09-01) = 938 - one trusted
       press authorizes one section (or, on MLS Assist 3.0.108+, the ordered
       batch it minted), the sheet re-arms with the next section named, and a
       read-only stage that will not settle is bounded instead of hanging. */
const FULL_GATE_TESTS = 938;
const DEFAULT_BASE = 'origin/main';
const DEFAULT_STEP_TIMEOUT_MS = 180000;
const DEFAULT_TOTAL_TIMEOUT_MS = 300000;

/* A release package is an executable publication artifact.  No untracked
   package is silently clean: every candidate must be the exact tracked build
   reviewed by the publication and digest contracts. */
const ALLOWED_UNTRACKED = Object.freeze(new Set());

const PROVENANCE_FILES = Object.freeze(new Set([
  '1p-mls-connect.js',
  'mls-connect.js',
  'cloned-mls-connect.js',
  '1pScribeFlow.html',
  '1p/index.html',
  'ScribeFlow.html',
  'cloned/index.html',
  'feat_athena_autopull.js',
]));

/* These are shared shells, not leaf modules.  Even when a shell diff happens
   to carry a provenance marker, the fast lane must not infer that the rest of
   the boot/router contract is unchanged.  They may appear in a provenance
   precheck (so the focused tests still run), but they always require the full
   release gate. */
const SHARED_SHELL_FILES = Object.freeze(new Set([
  '1pScribeFlow.html',
  '1p/index.html',
  'ScribeFlow.html',
  'cloned/index.html',
]));
const PROVENANCE_AUTHORITATIVE = '1p-mls-connect.js';
const PROVENANCE_DERIVED = Object.freeze(new Set(['mls-connect.js', 'cloned-mls-connect.js']));

const EXTENSION_FILES = Object.freeze(new Set([
  'manifest.json',
  'background.js',
  'destination_teach_navigation_guard.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'mls-popup.js',
  'mls-popup.css',
  'offscreen.html',
  'offscreen.js',
  'feat_codes_driver.js',
  'ext_reviews_reader.js',
  'write_safety_guard.js',
  'review_screen.js',
  'teach_destination_memory.js',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-128.png',
  'extension-version.json',
  'get-extension.html',
]));

const INVARIANTS = Object.freeze([
  { label: 'static-site', args: ['tests/static-site.test.js'], require: /PASS static site:/ },
  { label: 'production-derivation', args: ['scripts/derive-production-from-1p.js', '--check'], require: /PRISTINE/ },
  { label: 'cloned-derivation', args: ['scripts/derive-cloned-from-1p.js', '--check'], require: /PRISTINE/ },
  { label: 'public-publication-boundary', args: ['tests/public-publication-boundary.test.js'], require: /PASS public publication boundary:/ },
  { label: 'public-release-truth', args: ['tests/public-release-truth-boundary.test.js'], require: /PASS public release truth:/ },
  { label: 'public-release-preflight-contract', args: ['tests/public-release-preflight.test.js'], require: /PASS public release preflight:/ },
  { label: 'extension-package', args: ['tests/extension-package.test.js'], require: /PASS extension package:/ },
  { label: 'extension-core-digest', args: ['scripts/extension-core-digest.js', '--verify'], require: /^OK /m },
  { label: 'extension-badge', args: ['tests/extension-badge-never-claims-currency.test.js'], require: /PASS extension badge:/ },
  /* gatemiss-1.0.0 (2026-08-28): ADDED BECAUSE THE SAME MISTAKE HAPPENED TWICE
     IN ONE DAY. Neither of these suites appeared anywhere in this gate, so a
     shell or mls-connect edit could pass it while breaking them - and did:
       b1099 (dockfn) inserted two functions between clearDeviceData and its
             neighbour, breaking wipes-contract's extraction. A DEVICE-WIPE
             contract was red for four builds.
       b1103 (bpwhy) changed a control's label, making
             tests/fixtures/ui-control-manifest.json stale. Shipped red; caught
             only on the next neighbourhood run.
     Both times the diagnosis was the same: a changed-area net only covers the
     area you THINK you changed, and remembering to re-run the right suite is
     not a control. They are invariants rather than scope-focused because they
     guard the shipped shells whatever lane the change is in, and they are
     effectively free - measured 0s and 2s. */
  { label: 'ui-control-coverage', args: ['tests/ui-control-coverage.test.js'], require: /PASS ui-control-coverage:/ },
  { label: 'wipes-contract', args: ['tests/wipes-contract.test.js'], require: /PASS sj-2\.0 wipes contract:/ },
  /* copilotgate-1.0.0 (2026-08-28): the FIVE suites guarding an entire
     owner-listed feature area - Copilot answering from pulled visit history -
     were in run-all but in NO gate group, fast or focused. Nothing before a
     push exercised them.
     What they hold shut is the owner's own complaint: never say "not pulled
     from Athena" about data that WAS imported, keep missing data distinct from
     not-yet-pulled data, and answer visit/trend questions only from
     exact-patient VERIFIED bodies. The failure mode is silent and clinical -
     a Copilot that quietly widens to a foreign or unverified visit still
     answers fluently, and the answer looks right.
     They live here rather than in a FOCUSED group because the evidence they
     read is assembled in the shell, mls-connect AND the feat_ copilot files,
     so no single changed-area net covers them. Measured 85-106ms each, 0.5s
     for all five. */
  /* suspectvis-1.0.0 (2026-08-28): a PATIENT-SAFETY contract. The cross-patient
     contamination alert - the only surface warning that a chart's DOB, allergies,
     meds and problems may belong to someone else - was display:none in the card's
     DEFAULT state, from two independent causes at once (it anchored itself inside
     a fold that ships closed, and it was missing from the collapse allowlist).
     ~260 records carry that flag. An invariant, not a focused check, because the
     two halves live in different files and in different lanes: break either one
     and the alert silently disappears again. 343ms. */
  { label: 'suspect-notice-visible', args: ['tests/suspect-notice-cannot-be-hidden.test.js'], require: /PASS suspect-notice-cannot-be-hidden:/ },
  /* ptdel-1.0.0 (2026-08-28): a DATA-INTEGRITY contract. The single-row delete
     issued no DELETE at all whenever the in-memory server-id map was cold - which
     it is on every page load - so a deleted patient came back with their whole
     chart, and the toast said "Patient deleted." either way. An invariant because
     the honesty of the toast lives in the shell while the resolve/delete lives
     next to the hydration loader, and no changed-area net covers both. 102ms. */
  { label: 'patient-delete-reaches-server', args: ['tests/patient-delete-reaches-the-server.test.js'], require: /PASS patient-delete-reaches-the-server:/ },
  /* f5merge-1.0.0 (2026-08-28): a PATIENT-SAFETY contract. The F5 gate wraps
     upsertPatient and is the LAST thing before a new row is persisted, so its
     rule beats every stronger comparator upstream - and it merged two records on
     NAME ALONE whenever either side lacked a DOB, with no MRN veto and no
     uniqueness check. MRN is missing on ~76% of records here. An invariant
     because it guards WHO a record is, and because the gate sits in the shared
     engine where no changed-area net reliably reaches it. 118ms. */
  { label: 'f5-automerge-identity', args: ['tests/f5-automerge-needs-positive-identity.test.js'], require: /PASS f5-automerge-needs-positive-identity:/ },
  /* dedupsrv-1.0.0 (2026-08-28): the only real patient merge in the app undid
     itself - it saved the survivor list without {allowRemovals:true} so the
     row-guard carried the duplicates back, and it never deleted the absorbed row
     on the SERVER so hydration re-created them. Both halves must hold or the
     merge is theatre; an invariant because the local save and the server delete
     live in different files. 87ms. */
  { label: 'patient-merge-durable', args: ['tests/patient-merge-is-durable.test.js'], require: /PASS patient-merge-is-durable:/ },
  /* mergeui-1.0.0 (2026-08-28): the merge review surface. Guards two things that
     silently rot - a patient NAME reaching innerHTML unescaped, and the control
     surviving at zero duplicates as a dead button. Also pins that neither
     mounting nor refreshing the count can trigger a merge. 86ms. */
  { label: 'merge-review-surface', args: ['tests/merge-review-surface.test.js'], require: /PASS merge-review-surface:/ },
  /* ptedit-1.0.0 (2026-08-28): savePatient's edit branch was DEAD - every
     assignment to editingPtId was null - so "editing" a patient minted a
     duplicate and a wrong date of birth could not be corrected. The regression is
     silent and invisible (the modal looks identical), and it FEEDS the duplicate
     problem, so it is pinned as an invariant rather than left to a changed-area
     net. 106ms. */
  { label: 'patient-demographics-editable', args: ['tests/patient-demographics-are-editable.test.js'], require: /PASS patient-demographics-are-editable:/ },
  /* prepfold-1.0.0 (2026-08-28): the Doctor prep summary re-prints nine facts
     that each already have a card AND a tile on the same screen. It is FOLDED,
     not deleted, and this guards BOTH directions - a future 'cleanup' must not
     delete the clinical text, and a future change must not silently re-open the
     fold and put the wall of duplication back. 279ms. */
  { label: 'prep-summary-folded', args: ['tests/prep-summary-is-folded-not-lost.test.js'], require: /PASS prep-summary-is-folded-not-lost:/ },
  /* tlfold-1.0.0 (2026-08-28): the chart rendered the SAME visits twice. The
     classic timeline is FOLDED, not deleted, because feat_mls_timeline_sync
     appends visits that exist only as text inside p.summary and appear on no
     other surface - an earlier review proposed deleting this box and was wrong.
     Pinned in both directions: the fold must stay closed, and BOTH container ids
     must survive or the renderer and the shared sync module break. 112ms. */
  { label: 'visit-timeline-once', args: ['tests/visit-timeline-not-shown-twice.test.js'], require: /PASS visit-timeline-not-shown-twice:/ },
  /* wopen-1.0.0 / studiofast-1.0.0 (2026-08-28): two AI Studio defects the owner
     hit live - a built widget dying on MLS.openChart, and the Studio showing its
     lesser form for seconds before the upgrade arrived. The bridge is built as a
     STRING and injected into a sandboxed iframe, so the suite EXECUTES it: a
     method spelled right in source but throwing at runtime is the exact failure. */
  { label: 'studio-widget-bridge', args: ['tests/studio-widget-bridge-contract.test.js'], require: /PASS studio-widget-bridge-contract:/ },
  { label: 'copilot-longitudinal-context', args: ['tests/copilot-longitudinal-context-runtime.test.js'], require: /PASS Copilot longitudinal context:/ },
  { label: 'copilot-procedure-answer', args: ['tests/copilot-procedure-answer-runtime.test.js'], require: /PASS Copilot procedure answer:/ },
  { label: 'copilot-request-preflight', args: ['tests/copilot-request-preflight-runtime.test.js'], require: /PASS Copilot request preflight:/ },
  { label: 'copilot-request-binding', args: ['tests/copilot-request-binding-contract.test.js'], require: /PASS Copilot request binding:/ },
  { label: 'assistant-request-ownership', args: ['tests/assistant-request-ownership-runtime.test.js'], require: /PASS Assistant Copilot ownership:/ },
]);

const FOCUSED = Object.freeze({
  provenance: Object.freeze([
    { label: 'athena-autopull-partial-provenance', args: ['tests/athena-autopull-partial-provenance.test.js'], require: /athena-autopull-partial-provenance: ok/ },
    { label: 'prep-summary-debris', args: ['tests/prep-summary-debris.test.js'], require: /prep-summary-debris: ok/ },
    { label: 'partial-proof-carryforward', args: ['tests/partial-athena-proof-carryforward.test.js'], require: /partial-athena-proof-carryforward: ok/ },
    { label: 'complete-proof-carryforward', args: ['tests/upsert-athena-proof-carryforward.test.js'], require: /PASS athena proof guard:/ },
    { label: 'chart-refresh-merge', args: ['tests/chart-refresh-merge-runtime.test.js'], require: /PASS repeat chart refresh:/ },
    { label: 'prep-summary-source-browser', args: ['tests/prep-summary-source-browser-runtime.test.js'], require: /prep-summary-source-browser-runtime: 5 visible SOURCE states passed/ },
    /* This is the only existing focused browser confidence check for the
       patient/profile room.  It is deliberately retained despite its ~71s
       runtime; a VM-only provenance test is not enough for a UI release. */
    { label: 'profile-coherence-browser', args: ['tests/1p-profile-coherence.test.js'], require: /PART 1 ok/ },
    { label: 'preview-contract', args: ['tests/1p-preview-contract.test.js'], require: /PASS 1p preview contract:/ },
    { label: 'cloned-lane-contract', args: ['tests/cloned-lane-contract.test.js'], require: /PASS \/cloned lane contract:/ },
    { label: 'derived-backfill-parity', args: ['tests/1p-b121-backfill-footer-runtime.test.js'], require: /PASS b121 backfill footer/ },
  ]),
  extension: Object.freeze([
    { label: 'extension-read-path', args: ['tests/extension-read-path.test.js'], require: /PASS extension read paths:/ },
    { label: 'extension-manifest-text', args: ['tests/extension-manifest-text-integrity.test.js'], require: /PASS extension manifest text integrity:/ },
    { label: 'extension-host-scope', args: ['tests/extension-host-scope-contract.test.js'], require: /PASS extension host scope:/ },
    { label: 'extension-backend-origin', args: ['tests/extension-backend-origin-security.test.js'], require: /PASS extension backend origin security:/ },
    { label: 'athena-write-contract', args: ['tests/athena-write-contract.test.js'], require: /PASS/ },
    { label: 'primary-workflow-contract', args: ['tests/primary-workflow-contract.test.js'], require: /PASS/ },
    { label: 'write-receipt-contract', args: ['tests/write-claims-need-a-receipt.test.js'], require: /write-claims-need-a-receipt: OK/ },
  ]),
});

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function unique(values) {
  return [...new Set(values.map(normalizePath))].sort();
}

function classifyChangedFiles(files) {
  const changed = unique(files);
  const reasons = [];
  const unknown = [];
  const fullTriggers = [];
  const provenance = [];
  const extension = [];

  for (const file of changed) {
    if (PROVENANCE_FILES.has(file)) {
      provenance.push(file);
      if (SHARED_SHELL_FILES.has(file)) fullTriggers.push(`shared shell changed: ${file}`);
      continue;
    }
    if (EXTENSION_FILES.has(file) || /^MLS_Assist_v\d+(?:\.\d+){1,3}\.(?:zip|bin)$/i.test(file)) {
      extension.push(file);
      continue;
    }
    if (/^tests\//i.test(file)) {
      fullTriggers.push(`test file changed: ${file}`);
      continue;
    }
    if (/^(?:scripts\/|package(?:-lock)?\.json$|backend\/|server\/|src\/|api\/)/i.test(file)) {
      fullTriggers.push(`release/build/backend/shared script changed: ${file}`);
      continue;
    }
    /* Shared loaders, service workers, public shell assets, and any feature
       module outside the narrowly reviewed provenance map have many consumers
       and cannot be safely inferred from one focused test family. */
    if (/^(?:sw\.js|service-worker(?:\/|\.)|feat_[^/]+\.js$|cloned-feat_[^/]+\.js$|1p-feat_[^/]+\.js$|public-preview-|app\.html$|index\.html$|_headers$|_redirects$)/i.test(file)) {
      fullTriggers.push(`shared contract or public runtime changed: ${file}`);
      continue;
    }
    unknown.push(file);
  }

  if (unknown.length) reasons.push(`unmapped changed file(s): ${unknown.join(', ')}`);
  if (fullTriggers.length) reasons.push(...fullTriggers);
  const hasAuthoritative = provenance.includes(PROVENANCE_AUTHORITATIVE);
  const changedDerived = provenance.filter((file) => PROVENANCE_DERIVED.has(file));
  if (hasAuthoritative && changedDerived.length !== PROVENANCE_DERIVED.size) {
    reasons.push('authoritative provenance module changed without both derived production/cloned outputs');
  }
  if (!hasAuthoritative && changedDerived.length) {
    reasons.push('derived provenance output changed without its authoritative 1p source');
  }
  if (provenance.length && extension.length) reasons.push('provenance and extension scopes changed together');
  if (!provenance.length && !extension.length && !unknown.length && !fullTriggers.length) reasons.push('no approved fast-gate scope matched');

  const scope = provenance.length && !extension.length ? 'provenance'
    : extension.length && !provenance.length ? 'extension'
      : 'full-required';
  const fullRequired = reasons.length > 0;
  return Object.freeze({
    changed,
    scope,
    provenance: Object.freeze(provenance),
    extension: Object.freeze(extension),
    unknown: Object.freeze(unknown),
    fullTriggers: Object.freeze(fullTriggers),
    reasons: Object.freeze(reasons),
    fullRequired,
    eligible: !fullRequired && (scope === 'provenance' || scope === 'extension'),
  });
}

function parsePorcelainLine(line) {
  const raw = String(line || '');
  if (!raw) return null;
  const status = raw.slice(0, 2);
  const file = normalizePath(raw.slice(3));
  return { status, file };
}

function inspectWorktreeStatus(lines) {
  const disallowed = [];
  const allowed = [];
  for (const line of lines || []) {
    const row = parsePorcelainLine(line);
    if (!row) continue;
    if (row.status === '??' && ALLOWED_UNTRACKED.has(row.file)) allowed.push(row.file);
    else disallowed.push(row);
  }
  return Object.freeze({ allowed: unique(allowed), disallowed: Object.freeze(disallowed) });
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs || 30000,
  });
  if (result.error) throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || result.stdout || '').trim()}`);
  return String(result.stdout || '');
}

function readChangedFiles(base) {
  const output = runGit(['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${base}...HEAD`]);
  return unique(output.split(/\r?\n/).filter(Boolean));
}

function readWorktreeStatus() {
  const output = runGit(['status', '--porcelain=v1', '--untracked-files=all']);
  return inspectWorktreeStatus(output.split(/\r?\n/).filter(Boolean));
}

function assertGitClean(status) {
  if (status.disallowed.length) {
    const detail = status.disallowed.map((row) => `${row.status} ${row.file}`).join(', ');
    throw new Error(`worktree is not clean; untracked release artifacts are not allowed: ${detail}`);
  }
}

function assertRequiredFiles(descriptors) {
  const missing = [];
  for (const descriptor of descriptors) {
    const relative = descriptor.args[0];
    if (relative.endsWith('.js') && !fs.existsSync(path.join(ROOT, relative))) missing.push(relative);
  }
  if (missing.length) throw new Error(`fast-gate test map names missing files: ${missing.join(', ')}`);
}

function runStep(descriptor, stepTimeoutMs) {
  const started = Date.now();
  const result = spawnSync(process.execPath, descriptor.args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    timeout: stepTimeoutMs,
  });
  const output = `${String(result.stdout || '')}${String(result.stderr || '')}`;
  process.stdout.write(output);
  if (result.error) throw new Error(`${descriptor.label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${descriptor.label}: exited ${result.status === null ? 'by timeout/signal' : result.status}`);
  if (descriptor.require && !descriptor.require.test(output)) throw new Error(`${descriptor.label}: expected completion marker was absent`);
  return Object.freeze({ label: descriptor.label, elapsedMs: Date.now() - started });
}

function parseArgs(argv) {
  const out = { base: DEFAULT_BASE, mode: 'precheck', plan: false, stepTimeoutMs: DEFAULT_STEP_TIMEOUT_MS, totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS };
  for (const arg of argv || []) {
    if (arg === '--plan' || arg === '--dry-run') out.plan = true;
    else if (arg.startsWith('--base=')) out.base = arg.slice('--base='.length);
    else if (arg.startsWith('--mode=')) out.mode = arg.slice('--mode='.length);
    else if (arg.startsWith('--step-timeout-ms=')) out.stepTimeoutMs = Number(arg.slice('--step-timeout-ms='.length));
    else if (arg.startsWith('--total-timeout-ms=')) out.totalTimeoutMs = Number(arg.slice('--total-timeout-ms='.length));
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!['precheck', 'release'].includes(out.mode)) throw new Error('--mode must be precheck or release');
  if (!Number.isInteger(out.stepTimeoutMs) || out.stepTimeoutMs < 1000 || out.stepTimeoutMs > 600000) throw new Error('--step-timeout-ms must be 1000..600000');
  if (!Number.isInteger(out.totalTimeoutMs) || out.totalTimeoutMs < 1000 || out.totalTimeoutMs > 900000) throw new Error('--total-timeout-ms must be 1000..900000');
  return out;
}

function usage() {
  return [
    'Usage: node scripts/fast-release-gate.js --base=REF [--mode=precheck|release] [--plan]',
    '',
    `The fast gate is a conservative changed-area precheck, not the ${FULL_GATE_TESTS}-suite replacement.`,
    '--mode=release refuses to call the result releasable when the full gate is required.',
    'FAST_GATE_COMPLETE is distinct from the canonical GATE_COMPLETE emitted by node tests/run-all.js.',
    'Untracked release packages are never permitted.',
  ].join('\n');
}

function buildPlan(classification) {
  const focused = classification.scope === 'provenance' ? FOCUSED.provenance
    : classification.scope === 'extension' ? FOCUSED.extension : [];
  const descriptors = [...INVARIANTS, ...focused];
  assertRequiredFiles(descriptors);
  return Object.freeze({
    invariants: INVARIANTS,
    focused,
    descriptors,
    fullGateRequired: classification.fullRequired,
    fullGateTests: FULL_GATE_TESTS,
  });
}

function runFastGate(options, dependencies = {}) {
  const git = dependencies.git || { readChangedFiles, readWorktreeStatus, assertGitClean };
  const changed = git.readChangedFiles(options.base);
  const status = git.readWorktreeStatus();
  git.assertGitClean(status);
  if (!changed.length) throw new Error(`no committed changes found between ${options.base} and HEAD`);
  const classification = classifyChangedFiles(changed);
  const plan = buildPlan(classification);
  const labels = plan.descriptors.map((item) => item.label);
  console.log(`FAST_GATE_PLAN scope=${classification.scope} changed=${changed.length} steps=${labels.length} full_gate_required=${classification.fullRequired} full_gate_tests=${FULL_GATE_TESTS}`);
  console.log(`FAST_GATE_CHANGED ${changed.join(', ')}`);
  if (classification.reasons.length) {
    for (const reason of classification.reasons) console.log(`FAST_GATE_ESCALATE ${reason}`);
  }
  if (options.mode === 'release' && !classification.eligible) {
    console.log('FAST_GATE_REFUSED release_allowed=false');
    return { code: 3, classification, plan, completed: 0 };
  }
  if (options.plan) {
    console.log(`FAST_GATE_PLAN_ONLY tests=${labels.join(', ')}`);
    return { code: classification.eligible ? 0 : 3, classification, plan, completed: 0 };
  }
  const started = Date.now();
  let completed = 0;
  for (const descriptor of plan.descriptors) {
    const remainingMs = options.totalTimeoutMs - (Date.now() - started);
    if (remainingMs <= 0) throw new Error(`fast gate exceeded total timeout of ${options.totalTimeoutMs}ms`);
    console.log(`FAST_GATE_STEP ${descriptor.label}`);
    runStep(descriptor, Math.min(options.stepTimeoutMs, remainingMs));
    completed++;
  }
  if (classification.fullRequired) {
    console.log(`FAST_GATE_COMPLETE completed=${completed} of=${plan.descriptors.length} full_gate_required=true release_allowed=false`);
    return { code: options.mode === 'release' ? 3 : 0, classification, plan, completed };
  }
  console.log(`FAST_GATE_COMPLETE completed=${completed} of=${plan.descriptors.length} full_gate_required=false release_allowed=true`);
  console.log('FAST_GATE_NOTE This is not GATE_COMPLETE; the canonical full gate remains available via node tests/run-all.js.');
  return { code: 0, classification, plan, completed };
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    return runFastGate(options).code;
  } catch (error) {
    console.error(`FAST_GATE_ERROR ${error.message}`);
    return 2;
  }
}

module.exports = {
  ALLOWED_UNTRACKED,
  DEFAULT_BASE,
  EXTENSION_FILES,
  FOCUSED,
  FULL_GATE_TESTS,
  INVARIANTS,
  PROVENANCE_FILES,
  assertGitClean,
  buildPlan,
  classifyChangedFiles,
  inspectWorktreeStatus,
  normalizePath,
  parseArgs,
  parsePorcelainLine,
  runFastGate,
  usage,
};

if (require.main === module) process.exitCode = main();
