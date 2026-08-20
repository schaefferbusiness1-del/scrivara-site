'use strict';

/*
 * ADMIN + FIRST-LOGIN RELEASE CONTRACT (r32)
 * ===========================================
 * This is intentionally a focused source/derived-lane contract.  The full
 * browser matrix still belongs to the release gate, but these assertions make
 * the failures that stranded invited clinicians impossible to reintroduce by
 * accident:
 *
 *   invite token -> generic exchange -> required password -> session
 *   owner Create & invite / positive access -> one server-owned Ready result
 *   Ready -> agreements -> resumable, capability-aware setup -> manual tour
 *   signing/countersign -> server-owned manifest + stored artifact truth
 *
 * The editable lane is 1p.  /cloned is accepted only when it is the exact
 * output of scripts/derive-cloned-from-1p.js; the production route must not
 * acquire this candidate before the owner separately promotes it.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const shell = read('1pScribeFlow.html');
const bundle = read('1p-mls-connect.js');
const productionShell = read('ScribeFlow.html');
const derive = require('../scripts/derive-cloned-from-1p.js');

let assertions = 0;
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); assertions += 1; }

/* Balanced extraction of named declarations.  Contracts below can follow one
   layer of helpers, so a harmless refactor does not force endpoint literals
   into every click handler merely to satisfy the test. */
function declaredFunctions(source) {
  const out = new Map();
  const re = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let match;
  while ((match = re.exec(source))) {
    const name = match[1];
    const open = source.indexOf('{', match.index);
    let depth = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let close = -1;
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1] || '';
      if (lineComment) { if (ch === '\n') lineComment = false; continue; }
      if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
      if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    /* A few unrelated legacy helpers contain regular-expression literals with
       braces.  This lightweight scanner deliberately skips those declarations
       instead of pretending to be a full JavaScript parser; every function
       this focused contract requests below is still required explicitly. */
    if (close <= open) { re.lastIndex = open + 1; continue; }
    out.set(name, source.slice(match.index, close + 1));
    re.lastIndex = close + 1;
  }
  return out;
}

const functions = declaredFunctions(shell);
function extractNamedFunction(name) {
  const signature = new RegExp('(?:async\\s+)?function\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{');
  const match = signature.exec(shell);
  if (!match) return '';
  const open = shell.indexOf('{', match.index);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < shell.length; i += 1) {
    const ch = shell[i];
    const next = shell[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return shell.slice(match.index, i + 1);
  }
  return '';
}
function fn(name) {
  const body = functions.get(name) || extractNamedFunction(name);
  assert(body, 'required function is missing: ' + name);
  if (!functions.has(name)) functions.set(name, body);
  return body;
}

function reachableSource(entry, maxDepth = 4) {
  const seen = new Set();
  const visit = (name, depth) => {
    if (seen.has(name) || depth > maxDepth) return '';
    const body = functions.get(name) || extractNamedFunction(name);
    if (!body) return '';
    if (!functions.has(name)) functions.set(name, body);
    seen.add(name);
    let all = '\n/* ' + name + ' */\n' + body;
    const calls = body.match(/\b[A-Za-z_$][\w$]*\s*\(/g) || [];
    for (const raw of calls) all += visit(raw.replace(/\s*\($/, ''), depth + 1);
    return all;
  };
  return visit(entry, 0);
}

function functionContaining(needle) {
  const matches = [];
  for (const [name, body] of functions) if (body.includes(needle)) matches.push({ name, body });
  assert(matches.length, 'no function contains required behavior: ' + needle);
  matches.sort((a, b) => a.body.length - b.body.length);
  return matches[0];
}

/* -------------------------------------------------------------------------
 * 1. Every invite token uses the generic exchange, and the account must set a
 *    real password before startSession can reveal or hydrate the application.
 * ---------------------------------------------------------------------- */
ok(shell.includes('/api/auth/invite'), 'the 1p shell has no generic invite exchange');
ok(!shell.includes('/api/auth/lawyer-invite'),
  'the browser still dispatches an account invite through the lawyer-only endpoint');

const inviteFlow = fn('acceptAccountInvite');
ok(inviteFlow.includes('/api/auth/invite'), 'acceptAccountInvite does not exchange the token generically');
const awaitedPassword = inviteFlow.match(/await\s+([A-Za-z_$][\w$]*(?:Password|password)[\w$]*)\s*\(/);
ok(awaitedPassword, 'acceptAccountInvite does not await a required password step');
const passwordFlow = reachableSource('saveInvitePassword');
ok(passwordFlow.includes('/api/auth/invite/set-password'),
  'the invite password gate does not exchange its setupToken for a real session');
ok(/setupToken/.test(inviteFlow) && /setupToken/.test(passwordFlow),
  'the one-purpose setupToken is not carried from invite exchange into password setup');
ok(/if\s*\(\s*needsPassword\s*\)\s*setInviteSetupToken\s*\(/.test(inviteFlow) &&
   !/if\s*\(\s*needsPassword\s*\)\s*setBkToken\s*\(/.test(inviteFlow),
  'the password-required branch adopts the setup credential as a browser session');
ok(/setBkToken\s*\(/.test(passwordFlow),
  'password setup does not adopt the real session token returned after success');
const passwordAt = inviteFlow.indexOf(awaitedPassword[0]);
const sessionAt = inviteFlow.indexOf('startSession(');
ok(sessionAt > passwordAt, 'startSession can run before the required invite password step finishes');
ok(!/startSession\s*\([\s\S]{0,500}(?:prompt|require|set)[A-Za-z_$\s]*(?:Password|password)\s*\(/.test(inviteFlow),
  'the invite flow still starts the app and prompts for a password afterward');
ok(/(?:__mlsAuthHandoff|_authHandoff)\.invite/.test(shell) && /acceptAccountInvite\s*\(\s*_inviteTok\s*\)/.test(shell),
  'startup does not route the captured #invite token to acceptAccountInvite');
ok(!/if\s*\(\s*!r\.ok\s*\|\|\s*!d\.token\s*\)/.test(inviteFlow) && /needsPassword\s*\?\s*!setupToken/.test(inviteFlow),
  'invite exchange still requires the deprecated token alias instead of the primary setupToken');
const inviteResumeAt = shell.indexOf('if(backendMode()&&inviteSetupToken()&&invitePasswordDueFor(saved))');
const bearerRestoreAt = shell.indexOf('if(backendMode() && bkToken() && saved)');
ok(inviteResumeAt >= 0 && bearerRestoreAt > inviteResumeAt,
  'a refreshed one-purpose invite credential is checked only after the Bearer-session branch');
ok(/clearInvitePasswordFields/.test(passwordFlow) && fn('showInvitePasswordGate').includes('clearInvitePasswordFields()'),
  'plaintext invite passwords can survive a completed/reopened gate');
ok(fn('leaveInvitePasswordForLogin').includes("setInviteSetupToken('')") && /Return to sign in/.test(shell),
  'a lost password-commit response leaves the invited user trapped without a safe sign-in path');
ok(!/no password to type the first time/i.test(shell) && /choose their password before the first session starts/i.test(shell),
  'the attorney invite panel contradicts the password-first account contract');

/* -------------------------------------------------------------------------
 * 2. Owner provisioning is a real UI workflow, survives same-tab refresh
 *    without permanently storing the credential, and says "ready" only from
 *    the unified server result.
 * ---------------------------------------------------------------------- */
const createAt = shell.indexOf('Create &amp; invite account') >= 0
  ? shell.indexOf('Create &amp; invite account') : shell.indexOf('Create & invite account');
ok(createAt >= 0, 'Admin has no visible Create & invite account surface');
const createMarkup = shell.slice(createAt, createAt + 9000);
for (const label of ['name', 'email', 'role', 'practice', 'tier', 'clinical workspace']) {
  ok(new RegExp(label, 'i').test(createMarkup), 'Create & invite omits the ' + label + ' field/explanation');
}
for (const role of ['head', 'doctor', 'nurse', 'receptionist']) {
  ok(new RegExp('value=["\']' + role + '["\']', 'i').test(createMarkup), 'Create & invite cannot provision role ' + role);
}

const readyEndpoint = '/api/admin/accounts/ready';
ok(shell.includes(readyEndpoint), 'Admin is not wired to the atomic provisioning/readiness endpoint');
const readyClient = functionContaining(readyEndpoint);
const readyReach = reachableSource(readyClient.name);
ok(/action\s*:\s*['"]provision['"]/.test(shell), 'Create & invite never sends action:provision');
for (const field of ['name', 'email', 'role', 'plan', 'accessMode', 'clinicalApproved']) {
  ok(new RegExp('(?:^|[,\{]\s*)' + field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\s*:', 'm').test(shell),
    'provision payload omits ' + field);
}
ok(/practiceUserId\s*:/.test(shell), 'non-head provisioning has no practiceUserId payload');
ok(/readiness(?:\?\.)?\.state|readiness\s*&&[\s\S]{0,120}\.state/.test(shell),
  'the UI does not inspect the server-owned readiness.state before reporting success');
ok(/state\s*===?\s*['"]ready['"]|['"]ready['"]\s*===?\s*state/.test(shell),
  'the provisioning UI has no explicit Ready truth state');
ok(/['"]setup-only['"]/.test(shell) && /['"]blocked['"]/.test(shell),
  'the Admin UI does not distinguish setup-only and blocked readiness');
ok(/sessionStorage\.setItem\s*\(/.test(shell) && /inviteUrl/.test(shell),
  'the one-time invite/remediation card cannot survive a same-tab refresh');
ok(!/localStorage\.setItem\s*\([^\n]{0,160}invite/i.test(shell),
  'a one-time invite credential is persisted in localStorage instead of sessionStorage');
ok(/sessionStorage\.removeItem\s*\(/.test(shell),
  'the stored same-tab invite result has no explicit copy/clear cleanup path');
ok(/inviteUrl/i.test(createMarkup + readyReach) && /clipboard|copy/i.test(createMarkup + readyReach),
  'Create & invite has no durable Copy invite link result action');
ok(fn('adminPendingInviteKey').includes('uns(') && fn('sfResetSessionBoundary').includes('adminClearCreatedInvite'),
  'the raw unsent invite is global or survives an owner logout/account switch');
ok(fn('accountInviteLinkForCurrentLane').includes("path='/cloned'") && fn('adminRenderCreateResult').includes('accountInviteLinkForCurrentLane'),
  'an invite created from /cloned can still route the recipient to the official site');

/* -------------------------------------------------------------------------
 * 3. The plan picker consumes server metadata as a role-aware allowlist.  Raw
 *    catalog rows, internal seat SKUs, and contradictory toggle stacks are not
 *    acceptable targets for a clinician account.
 * ---------------------------------------------------------------------- */
ok(/adminAssignable/.test(shell), 'plan rendering ignores the server adminAssignable allowlist');
ok(/allowedRoles/.test(shell), 'plan rendering ignores allowedRoles metadata');
const planFilter = fn('adminPlanAllowedForUser');
ok(/internalSeat/.test(planFilter), 'plan rendering does not reject internal seat catalog rows');
ok(!/flags\s*&&\s*p\.flags\.perSeat/.test(planFilter),
  'valid per-provider Enterprise plans are rejected with the internal doctor seat');
ok(/capabilities/.test(shell), 'Admin never consumes normalized plan capabilities');
ok(/head/.test(shell) && /doctor/.test(shell) && /nurse/.test(shell) && /receptionist/.test(shell),
  'role-aware plan policy does not cover all provisionable roles');
ok(!/role===['"]nurse['"]\|\|role===['"]receptionist['"][\s\S]{0,40}return false/.test(planFilter) && /\^standard_/.test(fn('adminCreateRoleChanged')),
  'Admin hides the backend-allowed Standard cadence from nurse/receptionist provisioning');
ok(/Attorney portal accounts are intentionally unavailable/.test(shell),
  'the unreleased attorney portal is silently presented as an available admin provisioning path');
ok(!/option[^>]+value=["']doctor_seat_monthly["']/i.test(shell),
  'doctor_seat_monthly is still exposed as a target-user plan');
ok(!/onclick=["'][^"']*(?:adminSetPremium|adminSetLite)/i.test(shell),
  'independent Premium/Lite entitlement toggles still permit contradictory tier state');
ok(!/onclick=["'][^"']*adminSetRole\s*\(/i.test(shell),
  'legacy role buttons can mutate role independently of plan/practice/readiness');
ok(reachableSource('adminSelectedEnterprisePractice').includes('commercialEntitlement') && /effectiveTier/.test(fn('adminSelectedEnterprisePractice')),
  'Admin cannot recognize an active practice-level Enterprise entitlement');
const provisionFlow = fn('adminProvisionAccount');
ok(/setupPolicyVersion\s*:\s*2/.test(provisionFlow),
  'new clone-created accounts are not pinned to the server-enforced first-login policy');
ok(/adminProtectedPractice\s*\(\s*practiceRecord\s*\)/.test(provisionFlow) &&
   fn('adminProtectedPractice').includes('setupPolicyVersion') &&
   fn('adminProtectedPractice').includes("mode==='role-scoped'"),
  'Create & invite can attach a new protected account to an incompatible legacy practice');
ok(provisionFlow.includes('d.user.setupPolicyVersion') && fn('adminRenderCreateResult').includes('setupPolicyReady') &&
   /canSend\s*=\s*setupPolicyReady/.test(fn('adminRenderCreateResult')),
  'the UI can expose an invite before the server confirms protected setup policy v2');
ok(provisionFlow.includes('enterprisePractice') && /if\s*\(\s*!enterprisePractice\s*\)[\s\S]*request\.plan/.test(provisionFlow),
  'Enterprise-covered children are still assigned a second individual plan/override');
ok(/Enterprise via practice/.test(shell) && /individual plan controls disabled/.test(shell) && fn('adminManagedCommercial').includes('coverageAvailable===true'),
  'Admin cannot display or preserve a practice-managed Enterprise member');

/* -------------------------------------------------------------------------
 * 4. Every positive owner access action reaches the same Ready transaction;
 *    explicit Block is the only negative transition.  A 200 alone is not a
 *    Ready receipt.
 * ---------------------------------------------------------------------- */
for (const name of ['adminGrantPlan', 'adminSetAccess']) {
  const own = fn(name);
  const flow = reachableSource(name);
  ok(flow.includes(readyEndpoint), name + ' bypasses the unified Ready endpoint');
  ok(/action\s*:\s*['"]grant['"]/.test(flow), name + ' does not use action:grant for positive access');
  ok(/readiness/.test(flow) && /state/.test(flow), name + ' reports success without the readiness receipt');
  ok(!own.includes('/api/admin/billing/plan') && !/\/api\/admin\/users\/[\s\S]{0,80}\/access/.test(own),
    name + ' still mutates commercial access separately from workspace readiness');
}
const accessFlow = reachableSource('adminSetAccess');
ok(/action\s*:\s*['"]block['"]/.test(accessFlow), 'the explicit Block action does not use the atomic block transition');
ok(/clinicalApproved\s*:\s*true|clinicalApproved\s*:\s*approved/.test(shell),
  'positive access can be submitted without explicit clinical-workspace approval');
ok(/Ready/.test(shell) && /Setup only/.test(shell) && /Blocked/.test(shell),
  'Admin rows do not present the required Ready / Setup only / Blocked status model');
const releaseGrantFlow = fn('adminWkspGrant');
ok(releaseGrantFlow.includes('/api/admin/legal-release/grant') && !/accessMode\s*:|plan\s*:|adminReadyRequest/.test(releaseGrantFlow),
  'the release-only recovery control silently rewrites a paid/trial account to permanent Comp');
ok(/Release Grant/.test(shell) && /plan and trial status stay unchanged/.test(shell),
  'the release-only recovery control still presents itself as a full account-access grant');
const adminUsersFlow = fn('loadAdminUsers');
ok(!/adminWkspRevoke\([^)]*(?:email|u\.email)/.test(adminUsersFlow) &&
   !/adminResetPassword\([^)]*(?:email|u\.email)/.test(adminUsersFlow),
  'user-controlled email is interpolated into an admin inline handler');

/* -------------------------------------------------------------------------
 * 5. First login is one resumable coordinator.  Setup must not burn its marker
 *    behind loading/legal overlays and must filter work by effective role/tier
 *    capabilities.  The comprehensive product tour remains optional/manual.
 * ---------------------------------------------------------------------- */
const promptFlow = reachableSource('maybePromptSetup');
ok(/__mlsSessionReady|sfSessionReady/.test(promptFlow), 'setup does not wait for session readiness');
ok(/sfSessionLegalState/.test(promptFlow) && /['"]verified['"]/.test(promptFlow),
  'setup can launch before the clinical/legal decision is verified');
ok(/appScreen|revealed|appVisible/.test(promptFlow), 'setup can launch before the app is visibly revealed');
ok(/agreement|agCeremony|agGate/i.test(promptFlow), 'setup does not stand down while an agreement screen owns the view');
const ceremonyNeed = fn('agCeremonyNeeded');
ok(!/sessionStorage|localStorage|agSignedVersion|mlsAgCerSkip|agreements_signed_version/.test(ceremonyNeed) && /bkUser\.agreements/.test(ceremonyNeed) && /signerComplete/.test(ceremonyNeed),
  'the ceremony is not controlled exclusively by structured server agreement state');
ok(!/id=["']agCerSkip["']/.test(shell) && !fn('agCeremonySkip').includes("sessionStorage.setItem('mlsAgCerSkip'"),
  'the required agreement ceremony still exposes a browser-only skip path');
const promptMarkerAt = promptFlow.search(/setupPrompted|promptedAt|prompted\s*:/);
const openSetupAt = promptFlow.indexOf('openSetup(');
if (promptMarkerAt >= 0) ok(openSetupAt >= 0 && promptMarkerAt > openSetupAt,
  'setup writes its prompted marker before visibly mounting the modal');

ok(shell.includes('/api/onboarding/state'), 'resumable onboarding is not persisted through /api/onboarding/state');
for (const state of ['not_started', 'in_progress', 'deferred', 'completed']) {
  ok(shell.includes(state), 'onboarding state machine omits ' + state);
}
const setupFlow = reachableSource('openSetup') + reachableSource('suNext') + reachableSource('closeSetup');
ok(/method\s*:\s*['"]GET['"]|apiFetch\s*\([^,]+\)/.test(setupFlow),
  'setup never restores its server-side step/state');
ok(/method\s*:\s*['"]PUT['"]/.test(setupFlow), 'setup progress/defer/completion is never persisted');
ok(/step/.test(setupFlow) && /error/.test(setupFlow), 'resumable setup does not retain step/error state');
ok(/capabilities/.test(setupFlow), 'setup steps are not filtered by effective capabilities');
ok(/role/.test(setupFlow) && /tier|lite|premium/i.test(setupFlow), 'setup is not role/tier aware');
const clientSteps = fn('suClientCompleted');
for (const step of ['profile', 'practice', 'schedule', 'staff_prep', 'preferences']) {
  ok(clientSteps.includes(step), 'client-owned onboarding step is missing: ' + step);
}
for (const serverStep of ['password', 'agreements', 'tour']) {
  ok(!new RegExp(serverStep + '\\s*:').test(clientSteps), 'client can echo server-owned onboarding step ' + serverStep);
}
ok(fn('suSaveOnboarding').includes('suClientCompleted'), 'onboarding PUT does not strip server-derived completedSteps');
const resumeFlow = fn('suResumeStep');
ok(resumeFlow.includes("done.indexOf('schedule')") && resumeFlow.includes("done.indexOf('staff_prep')"),
  'setup cannot resume separately at schedule and Staff Prep');
ok(fn('suCanSchedule').includes("r==='nurse'") && fn('suHasCapability').includes("role==='nurse'"),
  'a Standard nurse is required to finish schedule setup server-side but the wizard skips those steps');
ok(fn('suFinish').includes('finished.status!==SU_STATUS.COMPLETED'),
  'the wizard can claim success locally while the server still reports a required step');
ok(/suIsProvider\(\)\s*&&\s*!pn/.test(fn('suNext')) && /if\s*\(\s*suIsProvider\(\)\s*\)\s*required\.push\(['"]practice['"]\)/.test(fn('suFinish')),
  'staff setup is blocked by the practice-authority step that only a provider is required to complete');
const openSetupFlow = fn('openSetup');
ok(openSetupFlow.includes("document.getElementById('su_retryBtn')") && /catch\s*\([^)]*\)[\s\S]*SU_STATE\s*=\s*\{[\s\S]*return false/.test(openSetupFlow),
  'manual setup continues with stale prior-account state after its GET fails');
ok(!/catch\s*\([^)]*\)\s*\{\s*\}\s*;?[\s\S]{0,120}(?:_suStep\+\+|suShowStep)/.test(fn('suNext')),
  'a required setup save can fail silently and still advance the wizard');
const setupNextFlow = fn('suNext');
const persistIdentityFlow = fn('suPersistIdentity');
ok(/await\s+suPersistIdentity\s*\(/.test(setupNextFlow) &&
   /await\s+syncProfileName\s*\(\s*\{\s*required\s*:\s*true\s*\}\s*\)/.test(persistIdentityFlow) &&
   /await\s+syncPrefsToServer\s*\(\s*\{\s*required\s*:\s*true\s*\}\s*\)/.test(persistIdentityFlow),
  'profile/practice onboarding is marked complete before its required account data is acknowledged by the server');
ok(fn('syncProfileName').includes('!r.ok') && fn('syncProfileName').includes('opts.required') &&
   fn('syncPrefsToServer').includes('return fetch') && fn('syncPrefsToServer').includes('opts.required'),
  'required guided-start saves still use fire-and-forget profile or preferences sync');
const accessUiFlow = fn('applyAccessUI');
for (const capability of ['analytics', 'patientCharts', 'scheduling', 'signClinicalNotes']) {
  ok(accessUiFlow.includes(capability), 'main role UI ignores server capability ' + capability);
}
ok(bundle.includes('window.__mlsManualToursOnly = true'), 'the comprehensive tour is no longer explicitly manual-only');
const autoTourGuards = (bundle.match(/if\s*\(\s*window\.__mlsManualToursOnly\s*\)\s*return/g) || []).length;
ok(autoTourGuards >= 3, 'one or more legacy/product tours can still auto-launch into a locked or wrong-tier view');

/* -------------------------------------------------------------------------
 * 6. Forms are server-owned evidence.  The owner sees the stored signer
 *    signature + exact assent/manifest before signing, and neither party is
 *    told "sent" or "fully executed" without the returned artifact truth.
 * ---------------------------------------------------------------------- */
for (const id of ['csMeta', 'csConsent', 'csSignerSig', 'csManifest']) {
  ok(shell.includes('id="' + id + '"'), 'countersign modal is missing #' + id);
}
const reviewFlow = reachableSource('openCountersign');
for (const token of ['signatureImg', 'validatedPng', 'assent', 'ceremonyKey', 'manifestId',
  'manifestVersion', 'manifestSha256', 'assentSha256', 'documents', 'documentId', 'sha256', 'intent', 'artifact']) {
  ok(reviewFlow.includes(token), 'countersign review does not render/validate server evidence field ' + token);
}
const manifestFlow = fn('agLoadManifest');
const manifestValidationFlow = fn('agValidateServerManifest');
ok(manifestFlow.includes('ACTIVE_MLS_AGREEMENTS') && manifestValidationFlow.includes('selected.push(shown)') && !/docs\.length\s*!==\s*MLS_AGREEMENTS\.length/.test(manifestValidationFlow),
  'the client rejects a role-appropriate workforce manifest unless it contains entity-level documents');
ok(fn('agRenderSections').includes('ACTIVE_MLS_AGREEMENTS') && fn('agBaaSection').includes('ACTIVE_MLS_AGREEMENTS'),
  'the ceremony still renders entity-level documents instead of the server-selected role manifest');
ok(fn('agResetManifestState').includes('ACTIVE_MLS_AGREEMENTS=MLS_AGREEMENTS') && fn('sfResetSessionBoundary').includes('agResetManifestState'),
  'a role-specific manifest can leak across an account switch in the same tab');
const syncFlow = reachableSource('csSyncState');
ok(/evidence|validatedPng|artifact/i.test(syncFlow),
  'owner countersign can be enabled before stored signer evidence is valid');
ok(reviewFlow.includes('manifestMatchesCurrent') && reviewFlow.includes('agValidateServerManifest') && reviewFlow.includes('d&&d.manifest') && !reviewFlow.includes('agLoadManifest'),
  'owner review does not use the target record manifest, or incorrectly asks for the admin account manifest');
ok(reviewFlow.includes("d.audience==='entity'") && reviewFlow.includes('d.countersignable===true') && reviewFlow.includes('targetAgreements'),
  'owner can countersign evidence that is not the current server-authorized entity agreement');
ok(reviewFlow.indexOf('targetAgreements.filter') > reviewFlow.indexOf("/api/admin/agreements/"),
  'browser agreement text is rendered before the target record manifest is fetched and verified');
ok(!reviewFlow.includes("+AG_ESIGN_CONSENT") && /Server-recorded signer intent/.test(reviewFlow),
  'owner review presents a current browser consent sentence as stored signer evidence');

ok(/function\s+applyDoctorRestrictions\s*\(\)\s*\{[\s\S]{0,180}!isLiteUser\(\)[\s\S]{0,80}clearDoctorRestrictions\(\)/.test(bundle),
  'leaving Lite does not reverse its direct navigation restrictions');
ok(/function\s+clearDoctorRestrictions\s*\(\)[\s\S]{0,900}classList\.remove\(['"]mls-lite['"]\)[\s\S]{0,300}mlsLiteBadge/.test(bundle) && bundle.includes('__mlsLiteOriginalDisplay'),
  'Lite cleanup does not restore owned navigation display, body class, and badge state');
ok(fn('resetRoleUi').includes("window.__mlsLite.clear"),
  'an account switch can retain Lite restrictions until the background timer runs');

/* Submission truth is owned by these two handlers. Following every named call
   from them walks through generic UI refresh functions and eventually reaches
   unrelated receipt downloaders plus the deliberately dead, retired browser
   PDF builders; that does not mean either submit path invokes those builders. */
const signFlow = fn('agSubmitSign');
ok(!signFlow.includes('agBuildReceiptPdf') && !signFlow.includes('receiptPdfBase64'),
  'signing still asks the browser to manufacture the authoritative receipt');
ok(!/requiresCountersign\s*:/.test(signFlow) && !/agreements\s*:[\s\S]{0,180}title\s*:/.test(signFlow),
  'signing still lets the browser choose server-owned titles/countersign requirements');
for (const token of ['documentId', 'sha256', 'intent', 'artifact', 'delivery']) {
  ok(signFlow.includes(token), 'signing response/payload omits server evidence field ' + token);
}
ok(!signFlow.includes('your signed forms were saved and sent to your administrator'),
  'signing still makes an unconditional saved-and-sent claim');
ok(/delivery[\s\S]{0,180}status|status[\s\S]{0,180}delivery/.test(signFlow),
  'signing copy does not branch on returned delivery.status');

const countersignFlow = fn('submitCountersign');
ok(!countersignFlow.includes('agBuildExecutedPdf') && !countersignFlow.includes('executedPdfBase64'),
  'countersigning still asks the browser to manufacture the authoritative executed agreement');
for (const expression of [
  /agreement(?:\?\.)?\.status[\s\S]{0,100}fully_executed|fully_executed[\s\S]{0,100}agreement(?:\?\.)?\.status/,
  /artifact(?:\?\.)?\.status[\s\S]{0,100}stored|stored[\s\S]{0,100}artifact(?:\?\.)?\.status/,
  /artifact(?:\?\.)?\.stored\s*===?\s*true/
]) ok(expression.test(countersignFlow), 'fully-executed UI is missing one server artifact truth predicate');
const executedClaimAt = countersignFlow.search(/fully executed/i);
const artifactTruthAt = countersignFlow.search(/artifact(?:\?\.)?\.status/);
ok(executedClaimAt > artifactTruthAt, 'the fully-executed claim appears before artifact truth is evaluated');
ok(/delivery/.test(countersignFlow), 'countersign result does not render delivery independently from execution');

const agreementListFlow = fn('loadAdminAgreements');
for (const proof of ['verified_ceremony===true', 'countersignable===true', "artifact.status==='stored'", "agreement.status==='fully_executed'", 'Needs current forms']) {
  ok(agreementListFlow.includes(proof), 'admin agreement list can mislabel unverified evidence; missing ' + proof);
}
for (const downloader of ['downloadAgreementReceipt', 'downloadAgreementExecuted']) {
  const source = fn(downloader);
  ok(source.includes("artifact.status!=='stored'") && source.includes('artifact.stored!==true'),
    downloader + ' does not require a verified stored server artifact');
}
const signerExecuted = fn('downloadMyExecutedAgreement');
ok(signerExecuted.includes('/api/agreements/me/executed') && signerExecuted.includes("artifact.status!=='stored'") && signerExecuted.includes('artifact.stored!==true'),
  'the signer cannot download a verified fully executed BAA');
ok(/onclick="openCountersign\('\+id\+'\)"/.test(agreementListFlow) && !/openCountersign\([^)]*name_signed/.test(agreementListFlow),
  'user-controlled signer name is interpolated into an owner-session click handler');
ok(/signer_setup_policy_version/.test(agreementListFlow) &&
   /Open current-site Admin/.test(agreementListFlow) &&
   /adminOpenLegacyAgreement/.test(agreementListFlow),
  'legacy policy-0 forms are left as a dead end inside the strict clone reviewer');
const legacyAgreementHandoff = fn('adminOpenLegacyAgreement');
ok(/\/ScribeFlow\.html/.test(legacyAgreementHandoff) && /noopener/.test(legacyAgreementHandoff),
  'legacy-form handoff does not open the current official Admin safely');

/* The server hashes are meaningful only when they identify the exact document
   text this shell displays. Pin that relationship at build time so a copy edit
   cannot silently create a signed hash/text mismatch. */
function evalConstArray(name, followingDeclaration) {
  const marker = 'const ' + name + '=';
  const start = shell.indexOf(marker);
  const end = shell.indexOf('\n' + followingDeclaration, start);
  assert(start >= 0 && end > start, 'cannot locate ' + name + ' source');
  return Function('"use strict";return (' + shell.slice(start + marker.length, end).replace(/;\s*$/, '') + ')')();
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const browserTemplates = evalConstArray('BROWSER_AGREEMENT_TEMPLATES', 'const MLS_AGREEMENTS');
const browserEvidence = evalConstArray('BROWSER_AGREEMENT_EVIDENCE', 'let _agManifest');
eq(browserTemplates.length, browserEvidence.length, 'agreement text/evidence counts differ');
browserTemplates.forEach((template, index) => {
  const digest = crypto.createHash('sha256').update(canonical(template)).digest('hex');
  eq(digest, browserEvidence[index][1], 'displayed agreement text hash drifted at index ' + index);
});

/* -------------------------------------------------------------------------
 * 7. The candidate really shipped through the derivation, not by hand, and
 *    the owner-requested production route remains untouched by this train.
 * ---------------------------------------------------------------------- */
const generated = derive.generate();
const generatedByName = new Map(generated.files.map(file => [file.name, file.text]));
const clonedShellName = derive.SHELL_OUT || 'cloned/index.html';
const clonedConnectName = derive.CONNECT_OUT || 'cloned-mls-connect.js';
ok(generatedByName.has(clonedShellName), 'derive did not emit the cloned shell');
ok(generatedByName.has(clonedConnectName), 'derive did not emit the cloned bundle');
eq(read(clonedShellName), generatedByName.get(clonedShellName),
  '/cloned shell is not the exact output of derive-cloned-from-1p.js');
eq(read(clonedConnectName), generatedByName.get(clonedConnectName),
  '/cloned bundle is not the exact output of derive-cloned-from-1p.js');
const clonedShell = read(clonedShellName);
for (const proof of [readyEndpoint, '/api/auth/invite', '/api/onboarding/state', 'Create &amp; invite account']) {
  ok(clonedShell.includes(proof), '/cloned is missing derived admin/onboarding proof: ' + proof);
}
ok(!productionShell.includes(readyEndpoint) && !productionShell.includes('Create &amp; invite account'),
  'the clone-only admin/onboarding candidate leaked into the production route');

console.log('PASS admin/onboarding clone contract: ' + assertions + ' assertions');
