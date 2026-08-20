'use strict';

/*
 * FIRST-LOGIN SERVER-STATE SAFETY CONTRACT
 * ========================================
 * These source-level checks deliberately pin decisions, not presentation:
 *
 *   - the server's structured agreement/readiness state owns first login;
 *   - a stored signer receipt is not the same as an executed practice BAA;
 *   - an authenticated setup-only response never destroys the session; and
 *   - practice Enterprise coverage cannot acquire a second access override.
 *
 * The editable source is the 1p lane. /cloned remains a generated artifact and
 * is intentionally not derived or inspected by this focused pre-derive test.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');

let assertions = 0;
function ok(value, message) { assert.ok(value, message); assertions += 1; }
function eq(actual, expected, message) { assert.deepStrictEqual(actual, expected, message); assertions += 1; }

/* Extract named declarations without depending on formatting or line numbers. */
function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const signature = new RegExp('(?:async\\s+)?function\\s+' + escaped + '\\s*\\([^)]*\\)\\s*\\{');
  const match = signature.exec(shell);
  if (!match) return '';
  const open = shell.indexOf('{', match.index);
  let depth = 0;
  let quote = '';
  let escapedChar = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < shell.length; i += 1) {
    const ch = shell[i];
    const next = shell[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escapedChar) escapedChar = false;
      else if (ch === '\\') escapedChar = true;
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

const declarations = new Map();
const declarationPattern = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
let declarationMatch;
while ((declarationMatch = declarationPattern.exec(shell))) {
  const name = declarationMatch[1];
  if (!declarations.has(name)) {
    const body = extractFunction(name);
    if (body) declarations.set(name, body);
  }
}

function fn(name) {
  const body = declarations.get(name) || extractFunction(name);
  assert(body, 'required function is missing: ' + name);
  return body;
}

function functionContaining(needle) {
  const hits = [];
  for (const [name, body] of declarations) {
    if (body.includes(needle)) hits.push({ name, body });
  }
  assert(hits.length, 'no named flow handles server state: ' + needle);
  hits.sort((a, b) => a.body.length - b.body.length);
  return hits[0];
}

function reachableSource(entry, maxDepth = 3) {
  const seen = new Set();
  const visit = (name, depth) => {
    if (seen.has(name) || depth > maxDepth) return '';
    const body = declarations.get(name) || extractFunction(name);
    if (!body) return '';
    seen.add(name);
    let out = '\n/* ' + name + ' */\n' + body;
    const calls = body.match(/\b[A-Za-z_$][\w$]*\s*\(/g) || [];
    for (const call of calls) out += visit(call.replace(/\s*\($/, ''), depth + 1);
    return out;
  };
  return visit(entry, 0);
}

function balancedBlock(source, open) {
  assert(open >= 0 && source[open] === '{', 'cannot locate balanced block');
  let depth = 0;
  let quote = '';
  let escapedChar = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escapedChar) escapedChar = false;
      else if (ch === '\\') escapedChar = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return { text: source.slice(open, i + 1), end: i + 1 };
  }
  assert.fail('unterminated balanced block');
}

/* -------------------------------------------------------------------------
 * 1. Structured /api/me agreement state is authoritative. A browser-written
 *    version marker can neither skip nor complete the current ceremony.
 * ---------------------------------------------------------------------- */
const ceremonyNeed = fn('agCeremonyNeeded');
ok(/(?:agreementState|agreements)(?:\?|\.)/.test(ceremonyNeed),
  'agCeremonyNeeded does not consume the structured server agreement state');
ok(/\brequired\b/.test(ceremonyNeed) && /\bsignerComplete\b/.test(ceremonyNeed),
  'ceremony dispatch is not based on server-owned required + signerComplete truth');
ok(!/agreements_signed_version/.test(ceremonyNeed),
  'a legacy version-only marker can still complete or suppress the current server agreement state');

const ceremonyDecision = Function(
  'bkUser', 'backendMode', 'bkToken', 'document', 'AGREEMENTS_VERSION', 'sfIsClonedSetupLane',
  ceremonyNeed + '\nreturn agCeremonyNeeded();'
);
const ceremonyFor = user => ceremonyDecision(
  user,
  () => true,
  () => 'valid-session-token',
  { body: { classList: { contains: () => false } } },
  'legacy-version-must-not-decide',
  () => false
);
eq(ceremonyFor({ agreements: { required: true, signerComplete: false }, agreements_signed_version: 'legacy-version-must-not-decide' }), true,
  'structured signerComplete:false can be overridden by a matching legacy marker');
eq(ceremonyFor({ agreements: { required: true, signerComplete: true }, agreements_signed_version: 'stale' }), false,
  'structured signerComplete:true can be overridden by a stale legacy marker');
eq(ceremonyFor({ agreements: { required: false, signerComplete: false } }), false,
  'the server’s role exemption does not suppress the ceremony');
eq(ceremonyFor({ agreements_signed_version: 'legacy-version-must-not-decide' }), true,
  'missing structured agreement state fails open through a legacy marker');
eq(ceremonyFor({ agreements: {}, agreements_signed_version: 'legacy-version-must-not-decide' }), true,
  'malformed structured agreement state fails open through a legacy marker');
const ceremonyKeyFlow = fn('agCeremonyKey');
for (const scopeField of ['manifestId', 'manifestSha256', 'audience', 'practiceUserId']) {
  ok(ceremonyKeyFlow.includes(scopeField), 'ceremony replay key is not scoped by ' + scopeField);
}

const signFlow = fn('agSubmitSign');
ok(!/bkUser\.agreements_signed_version\s*=/.test(signFlow),
  'sign success locally manufactures legacy agreement completion');
const signRefreshAt = signFlow.search(/await\s+[A-Za-z_$][\w$]*(?:Account)?Readiness\s*\(|await\s+refreshMe\s*\(|\/api\/me/);
const signSurfaceAt = signFlow.search(/(?:AccountSetupSurface|agreementState|agreements)(?:\s*\(|\?|\.)/);
const signRevealAt = signFlow.search(/\bstartSession\s*\(|\bmaybePromptSetup\s*\(|appScreen[^\n]{0,180}display\s*=/);
ok(signRefreshAt >= 0 && signSurfaceAt > signRefreshAt && (signRevealAt < 0 || signRevealAt > signSurfaceAt),
  'sign success can reveal/start setup before authoritative account readiness is refreshed and dispatched');
ok(/(?:surface|state)\s*===?\s*['"]pending['"][\s\S]{0,500}(?:show|render)[A-Za-z_$]*(?:Pending|Wait)[\s\S]{0,300}\breturn\b/i.test(signFlow),
  'sign success has no terminal waiting branch for a stored signature whose practice BAA is pending');

/* -------------------------------------------------------------------------
 * 2. A head who signed but is awaiting the MLS owner gets an actionable
 *    waiting screen. signerComplete prevents a second signature ceremony.
 * ---------------------------------------------------------------------- */
const headReason = 'PRACTICE_BAA_COUNTERSIGNATURE_REQUIRED';
const childReason = 'PRACTICE_BAA_REQUIRED';
const setupSurfaceFlow = fn('agAccountSetupSurface');
const pendingFlow = fn('showAgreementsPending');
const ceremonyDispatchAt = setupSurfaceFlow.indexOf('agCeremonyNeeded');
const practicePendingAt = setupSurfaceFlow.indexOf('agPracticeBaaReason');
ok(ceremonyDispatchAt >= 0 && practicePendingAt > ceremonyDispatchAt,
  'the countersignature-pending path ignores that the signer already completed their ceremony');

const surfaceDecision = Function(
  'bkUser', 'backendMode', 'bkToken', 'document', 'AGREEMENTS_VERSION', 'sfIsClonedSetupLane',
  [ceremonyNeed, fn('agReadinessReasons'), fn('agPracticeBaaReason'), setupSurfaceFlow].join('\n') +
    '\nreturn agAccountSetupSurface();'
);
const surfaceFor = user => surfaceDecision(
  user,
  () => true,
  () => 'valid-session-token',
  { body: { classList: { contains: () => false } } },
  'legacy-version-must-not-decide',
  () => false
);
eq(surfaceFor({ agreements: { required: true, signerComplete: true }, readiness: { state: 'setup-only', reasons: [headReason] } }), 'pending',
  'a head with a stored signature is sent back to ceremony instead of waiting for MLS countersignature');
eq(surfaceFor({ agreements: { required: true, signerComplete: true }, readiness: { state: 'setup-only', reasons: [childReason] } }), 'pending',
  'a child with a stored signature is sent back to ceremony instead of waiting for the practice agreement');
eq(surfaceFor({ agreements: { required: true, signerComplete: false }, readiness: { state: 'setup-only', reasons: [headReason] } }), 'ceremony',
  'an unsigned required account can skip its own ceremony merely because the practice BAA is pending');
eq(surfaceFor({ agreements: { required: true, signerComplete: true }, readiness: { state: 'ready', reasons: [] } }), '',
  'an agreement-complete Ready account remains trapped in a setup surface');
ok(pendingFlow.includes(headReason), 'the head countersignature reason is not rendered explicitly');
ok(/appScreen[\s\S]{0,180}display\s*=\s*['"]none['"]/.test(pendingFlow) &&
   /agreementsGate[\s\S]{0,180}display\s*=\s*['"]block['"]/.test(pendingFlow),
  'the countersignature-pending path does not keep the clinical app hidden behind the readiness gate');
ok(/agPendingWrap[\s\S]{0,180}display\s*=\s*['"]['"]/.test(pendingFlow),
  'the actionable pending surface is not made visible');
ok(/agCeremonyWrap[\s\S]{0,180}display\s*=\s*['"]none['"]/.test(pendingFlow) &&
   !/showAgreementsCeremony\s*\(|startSession\s*\(|maybePromptSetup\s*\(|hideAgreementsGate\s*\(/.test(pendingFlow),
  'the countersignature-pending branch can relaunch signing, reveal the app, or start setup');
ok(/(?:MLS|platform) owner[^.]{0,100}countersign|countersign[^.]{0,100}(?:MLS|platform) owner/i.test(pendingFlow),
  'the head waiting screen does not explain that the MLS owner must countersign');

const gateStart = shell.indexOf('<div id="agreementsGate"');
const gateEnd = shell.indexOf('<!-- ============ MAIN APP', gateStart);
assert(gateStart >= 0 && gateEnd > gateStart, 'cannot isolate hosted agreement/readiness gate markup');
const gateMarkup = shell.slice(gateStart, gateEnd);
ok(/downloadMyAgreementReceipt\s*\(/.test(gateMarkup),
  'the pending screen has no action to download the stored signer receipt');
ok(/retryLegalReadiness\s*\(/.test(gateMarkup),
  'the pending screen has no retry/check-again action');
ok(/agGateLogout\s*\(/.test(gateMarkup),
  'the pending screen has no safe logout action');

/* -------------------------------------------------------------------------
 * 3. A child with signerComplete waits for the practice authority's BAA. The
 *    child keeps their own stored completion and is not asked to sign again.
 * ---------------------------------------------------------------------- */
ok(pendingFlow.includes(childReason),
  'the child practice-BAA reason is not rendered explicitly');
ok(/own forms are signed|own signature is safely stored/i.test(pendingFlow),
  'the child practice-BAA path discards the child’s stored signer completion');
ok(/practice (?:owner|head|administrator)[^.]{0,140}(?:sign|agreement|BAA)|(?:sign|agreement|BAA)[^.]{0,140}practice (?:owner|head|administrator)/i.test(pendingFlow),
  'the child waiting screen does not explain the action required from the practice owner');

/* -------------------------------------------------------------------------
 * 4. HTTP 428 ACCOUNT_SETUP_REQUIRED is authenticated setup state, not an
 *    expired credential. Its branch must preserve token, session, and drafts.
 * ---------------------------------------------------------------------- */
ok(/\b428\b/.test(shell) && shell.includes('ACCOUNT_SETUP_REQUIRED'),
  'the frontend has no explicit authenticated ACCOUNT_SETUP_REQUIRED/428 path');
const setupFlow = fn('handleAccountSetupRequired');
ok(/status\s*!==?\s*428/.test(setupFlow) && /code\s*===?\s*['"]ACCOUNT_SETUP_REQUIRED['"]/.test(setupFlow),
  'setup handling is not jointly scoped to HTTP 428 and the server setup code');
ok(/agRefreshAccountReadiness/.test(setupFlow) && /agAccountSetupSurface/.test(setupFlow) &&
   /showAgreements(?:Ceremony|Pending|Gate)/.test(setupFlow),
  'ACCOUNT_SETUP_REQUIRED does not route back to the safe first-login gate');
ok(!/setBkToken\s*\(|\blogout\s*\(|\bhandle401\s*\(|\bbkUser\s*=\s*null|(?:session|local)Storage\.(?:clear|removeItem)\s*\(|(?:wipe|purge).*draft/i.test(setupFlow),
  'ACCOUNT_SETUP_REQUIRED can evict the valid bearer token/session');

const incompatibleLaneFlow = fn('sfRouteIncompatibleSetupAccount');
ok(/setupPolicyVersion/.test(incompatibleLaneFlow) && /agreements/.test(incompatibleLaneFlow) && /mode/.test(incompatibleLaneFlow) &&
   /policy\s*===?\s*2/.test(incompatibleLaneFlow) && /role-scoped/.test(incompatibleLaneFlow),
  'clone lane compatibility is not decided from persisted setup policy plus server agreement mode');
ok(/isAdmin|role\s*===?\s*['"]admin['"]|role\s*===?\s*['"]owner['"]/.test(incompatibleLaneFlow) &&
   /location\.replace[\s\S]{0,100}ScribeFlow\.html/.test(incompatibleLaneFlow),
  'legacy users are not routed to the compatible official UI, or the existing owner cannot remain in clone Admin');
const refreshIdentityFlow = fn('refreshMe');
ok(/bkUser\s*=\s*d\.user[\s\S]{0,700}sfRouteIncompatibleSetupAccount\s*\(\s*bkUser\s*\)[\s\S]{0,100}return\s+false/.test(refreshIdentityFlow),
  'saved-token startup can continue into the clone before account-policy lane routing');

const sessionStartFlow = fn('startSession');
const uiReadyAt = sessionStartFlow.indexOf('const _uiReady');
const setupSurfaceBeforeBundleAt = sessionStartFlow.indexOf('agAccountSetupSurface', uiReadyAt);
const optionalBundleAt = sessionStartFlow.indexOf('__mlsEnsureUiBundle', uiReadyAt);
ok(uiReadyAt >= 0 && setupSurfaceBeforeBundleAt > uiReadyAt && optionalBundleAt > setupSurfaceBeforeBundleAt,
  'first login can download the optional clinical UI bundle before dispatching the server-owned setup surface');
ok(/agAccountSetupSurface\s*\(\s*\)\s*\)\s*return\s+true/.test(sessionStartFlow.slice(uiReadyAt, optionalBundleAt)),
  'a signing or practice-BAA waiting surface does not suppress optional clinical bundle loading');

/* -------------------------------------------------------------------------
 * 5. Enterprise practice membership is server-owned commercial coverage.
 *    It suppresses all separate grant/plan paths, while explicit Block remains.
 * ---------------------------------------------------------------------- */
const enterpriseCovered = fn('adminIsEnterpriseCovered');
ok(/commercialEntitlement|adminCommercial/.test(enterpriseCovered) &&
   /source\s*===?\s*['"]practice-enterprise['"]/.test(enterpriseCovered),
  'Enterprise membership is inferred without commercialEntitlement.source=practice-enterprise');
const enterpriseDecision = Function(
  'user',
  [fn('adminCommercial'), enterpriseCovered].join('\n') + '\nreturn adminIsEnterpriseCovered(user);'
);
const covered = commercialEntitlement => enterpriseDecision({ commercialEntitlement });
eq(covered({ source: 'practice-enterprise', coverageActive: true, coverageBlocked: false, hasAccess: true }), true,
  'an exact active practice Enterprise entitlement is not recognized');
for (const [label, entitlement] of [
  ['wrong source', { source: 'direct', coverageActive: true, coverageBlocked: false, hasAccess: true }],
  ['inactive coverage', { source: 'practice-enterprise', coverageActive: false, coverageBlocked: false, hasAccess: true }],
  ['explicit Block', { source: 'practice-enterprise', coverageActive: false, coverageBlocked: true, hasAccess: false }],
  ['no effective access', { source: 'practice-enterprise', coverageActive: true, coverageBlocked: false, hasAccess: false }],
  ['missing coverage truth', { source: 'practice-enterprise', hasAccess: true }]
]) {
  eq(covered(entitlement), false, 'Enterprise predicate accepts ' + label + ' as active coverage');
}

const provisionFlow = fn('adminProvisionAccount');
ok(/adminProtectedPractice\s*\(\s*practiceRecord\s*\)/.test(provisionFlow),
  'new child provisioning can submit a legacy policy-0 practice and deadlock first login');
const practicePickerFlow = fn('adminPopulatePractices');
ok(/filter\s*\(\s*adminProtectedPractice\s*\)/.test(practicePickerFlow) &&
   /Needs protected setup/.test(practicePickerFlow),
  'practice picker does not distinguish protected v2 heads from legacy heads');
const enterpriseRequestGuard = /if\s*\(\s*!enterprisePractice\s*\)\s*\{/.exec(provisionFlow);
assert(enterpriseRequestGuard, 'cannot locate Enterprise provisioning payload guard');
const enterpriseRequestOpen = provisionFlow.indexOf('{', enterpriseRequestGuard.index);
const enterpriseRequestBlock = balancedBlock(provisionFlow, enterpriseRequestOpen);
ok(/request\.plan\s*=/.test(enterpriseRequestBlock.text) &&
   /request\.accessMode\s*=/.test(enterpriseRequestBlock.text) &&
   /request\.trialDays\s*=/.test(enterpriseRequestBlock.text),
  'normal individual provisioning lost its plan/access fields');
const provisionOutsideGuard = provisionFlow.slice(0, enterpriseRequestOpen) + provisionFlow.slice(enterpriseRequestBlock.end);
ok(!/request\.(?:plan|accessMode|trialDays)\s*=/.test(provisionOutsideGuard),
  'Enterprise-covered provisioning can attach an individual plan/access override');

const billingFlow = fn('loadAdminBilling');
ok(/else\s+if\s*\(\s*enterpriseCovered\s*\)[\s\S]{0,260}individual plan controls disabled/i.test(billingFlow),
  'Billing still offers individual plan controls for practice-enterprise members');

const usersFlow = fn('loadAdminUsers');
ok(/managedCommercial\s*\?[\s\S]{0,320}(?:Practice plan|practice billing)[\s\S]{0,180}\s*:\s*[\s\S]{0,760}(?:Comp|Trial)/i.test(usersFlow),
  'Admin Users does not recognize commercialEntitlement.source=practice-enterprise');
ok(/\bBlock\b/.test(usersFlow) && /adminSetAccess[\s\S]{0,100}blocked/.test(usersFlow),
  'suppressing Enterprise overrides also removed the explicit Block action');
ok(usersFlow.includes('Restore Enterprise') && usersFlow.includes('adminRestoreEnterprise') &&
   fn('adminCanRestoreEnterprise').includes('coverageAvailable===true') && fn('adminCanRestoreEnterprise').includes('coverageBlocked===true'),
  'an explicitly Blocked practice-Enterprise member has no owner action to restore coverage');
const restoreEnterpriseFlow = fn('adminRestoreEnterprise');
ok(/action\s*:\s*['"]grant['"]/.test(restoreEnterpriseFlow) &&
   !/(?:plan|accessMode|trialDays)\s*:/.test(restoreEnterpriseFlow) &&
   /adminReadinessState/.test(restoreEnterpriseFlow),
  'Restore Enterprise does not use the atomic Ready grant or silently adds an individual override');
ok(fn('adminManagedCommercial').includes('c.coverageAvailable===true') &&
   !fn('adminManagedCommercial').includes("stored==='practice_enterprise_member'"),
  'a lapsed Enterprise marker still disables the direct-plan recovery controls');
ok(fn('adminNeedsDirectPlan').includes("stored==='practice_enterprise_member'") &&
   fn('adminNeedsDirectPlan').includes('c.coverageAvailable!==true') &&
   usersFlow.includes('Choose direct plan') && usersFlow.includes('adminOpenDirectPlan'),
  'a lapsed Enterprise marker still offers plan-less Comp/Trial instead of an explicit direct-plan recovery');
const setAccessPlanRecovery = fn('adminSetAccess');
ok(/adminNeedsDirectPlan[\s\S]{0,320}adminOpenDirectPlan[\s\S]{0,80}return/.test(setAccessPlanRecovery),
  'a stale/injected Comp or Trial action can bypass direct-plan selection for a lapsed Enterprise marker');
ok(fn('adminCanRestorePaidSeat').includes("stored==='doctor_seat_monthly'") &&
   fn('adminCanRestorePaidSeat').includes("access==='blocked'") &&
   fn('adminCanRestorePaidSeat').includes("stripe==='active'") &&
   fn('adminCanRestorePaidSeat').includes("stripe==='trialing'") &&
   fn('adminCanRestorePaidSeat').includes('c.hasAccess===false') &&
   usersFlow.includes('Restore paid seat') && usersFlow.includes('adminRestorePaidSeat'),
  'an explicitly Blocked paid doctor seat has no reversible Ready action');
const restorePaidSeatFlow = fn('adminRestorePaidSeat');
ok(/action\s*:\s*['"]grant['"]/.test(restorePaidSeatFlow) &&
   !/(?:plan|accessMode|trialDays)\s*:/.test(restorePaidSeatFlow) &&
   /adminReadinessState/.test(restorePaidSeatFlow),
  'paid-seat restore does not use a plan-preserving atomic Ready grant');

const grantPlanFlow = fn('adminGrantPlan');
ok(/adminUserById|adminCommercial|adminIsEnterprise/.test(grantPlanFlow) &&
   /if\s*\([^\n]{0,260}(?:enterprise|managed)[^\n]{0,260}\)[\s\S]{0,320}\breturn\b/i.test(grantPlanFlow),
  'a stale/injected Grant Plan action can still send an override for an Enterprise member');

const setAccessFlow = fn('adminSetAccess');
ok(/adminUserById|adminCommercial|adminIsEnterprise/.test(setAccessFlow) && /\bblocking\b/.test(setAccessFlow) &&
   /if\s*\([^\n]{0,300}(?:enterprise|managed)[^\n]{0,300}!blocking[^\n]{0,120}\)[\s\S]{0,320}\breturn\b/i.test(setAccessFlow),
  'Comp/Trial can still be sent for an Enterprise member, or the guard also prevents explicit Block');
ok(/action\s*:\s*['"]block['"]/.test(setAccessFlow),
  'Enterprise safety removed the server-owned explicit Block transition');

console.log('PASS first-login server-state safety contract: ' + assertions + ' assertions');
