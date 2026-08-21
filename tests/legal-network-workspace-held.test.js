'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const tracker = fs.readFileSync(path.join(root, 'legal-tracker.js'), 'utf8');
const connector = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const legalPack = fs.readFileSync(path.join(root, 'feat_mls_legalpack.js'), 'utf8');
const redesign = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');
const copilotActions = fs.readFileSync(path.join(root, 'feat_mls_copilot_actions.js'), 'utf8');
const commandPalette = fs.readFileSync(path.join(root, 'feat_mls_command_palette.js'), 'utf8');

function functionBody(name) {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = marker.exec(app);
  assert(match, `missing function ${name}`);
  const open = app.indexOf('{', match.index);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < app.length; i += 1) {
    const ch = app[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return app.slice(open + 1, i);
  }
  throw new Error(`unterminated function ${name}`);
}

assert(app.includes('const MLS_LEGAL_WORKSPACE_RELEASED=false;'), 'legal workspace is not held by a literal release boundary');
assert(app.includes('const MLS_PUBLIC_EXPERT_WORKSPACE_RELEASED=false;'), 'public expert workspace is not held by a literal release boundary');
assert(/__MLS_LEGAL_WORKSPACE_RELEASED:\{value:false,writable:false,configurable:false\}/.test(app), 'connector legal release flag is not immutable false');
assert(/__MLS_TEAM_WORKSPACE_RELEASED:\{value:false,writable:false,configurable:false\}/.test(app), 'connector Team release flag is not immutable false');
assert(/__MLS_PUBLIC_EXPERT_WORKSPACE_RELEASED:\{value:false,writable:false,configurable:false\}/.test(app), 'public expert release flag is not immutable false');
assert(!/#mlsRdNav \.navtab\{\s*display:flex\s*!important/i.test(redesign), 'redesign CSS overrides inline release/role holds and can make hidden navigation pop back into view');
assert(/#mlsRdNav \.navtab:not\(\[style\*='display:none'\]\):not\(\[style\*='display: none'\]\):not\(\.nav-feat-off\)\{\s*display:flex\s*!important/i.test(redesign), 'redesign lacks the release-aware visible-tab selector');
assert(app.includes('installHeldWorkflowNetworkBoundary'), 'held workflow network boundary is missing');
assert(/lawyers\|doctors/.test(app) && /followups/.test(app), 'held network boundary omits team-commerce or follow-up APIs');
assert(!/<script[^>]+src="legal-tracker\.js/i.test(app), 'production app still loads the legacy case/payment tracker');
assert(!/<script[^>]+src="expert-marketplace-ui\.js/i.test(app), 'production app still loads the held public-expert editor');

const quickFindViews = (app.match(/var VIEWS=\[[^\n]+\];/) || [''])[0];
assert(quickFindViews && !/k:'legalreq'/.test(quickFindViews), 'Quick Find still advertises the held Legal workspace');
const showViewBody = functionBody('showView');
const viewMutation = showViewBody.indexOf('currentView=v');
for (const [route, flag] of [
  ['legalreq', '__MLS_LEGAL_WORKSPACE_RELEASED'],
  ['team', '__MLS_TEAM_WORKSPACE_RELEASED']
]) {
  const guard = showViewBody.indexOf(`v==='${route}'&&window.${flag}!==true`);
  const stop = showViewBody.indexOf('return false;', guard);
  assert(guard >= 0 && stop > guard && stop < viewMutation, `showView mutates state before rejecting held ${route}`);
}

for (const id of ['featIME', 'legalEnabled']) {
  assert(!new RegExp(`<[^>]+id="${id}"`, 'i').test(app), `${id} remains visible in Settings`);
}
const imeTag = (app.match(/<button[^>]+id="imeBtn"[^>]*>/i) || [''])[0];
assert(/\bhidden\b/.test(imeTag) && /\bdisabled\b/.test(imeTag) && /aria-hidden="true"/.test(imeTag), 'IME control is not held out of the UI');
assert(!/onclick=/.test(imeTag), 'IME control retains an executable click handler');
assert(/FEATURE_DEFAULTS=\{[^}]*featIME:false/.test(app), 'IME still defaults on');
assert(functionBody('legalEnabled').trim().startsWith("return window.__MLS_LEGAL_WORKSPACE_RELEASED===true"), 'stale Legal preference can bypass the immutable release flag');
assert(functionBody('generateIME').trim().startsWith("if(window.__MLS_LEGAL_WORKSPACE_RELEASED!==true)"), 'generateIME is not hard-gated first');

for (const id of ['anaDoctorReview', 'anaTeamGrades', 'expertCard']) {
  const tag = (app.match(new RegExp(`<div[^>]+id="${id}"[^>]*>`, 'i')) || [''])[0];
  assert(/\bhidden\b/.test(tag) && /aria-hidden="true"/.test(tag) && /display\s*:\s*none/.test(tag), `${id} is not statically held`);
}
for (const name of ['loadTeamPatients', 'generateEfficiencyReport', 'generateDoctorAnalysis', 'renderTeamGrades', 'loadReceptionists', 'addReceptionist', 'removeReceptionist']) {
  assert(functionBody(name).trim().startsWith('if(window.__MLS_TEAM_WORKSPACE_RELEASED!==true)'), `${name} is not hard-gated first`);
}
assert(/ptReceptionBtn:false/.test(app), 'More menu can still reveal staff provisioning');
for (const name of ['loadExpertProfile', 'saveExpertProfile']) {
  const body = functionBody(name);
  const guard = body.indexOf('!publicExpertWorkspaceReleased()');
  const network = body.indexOf('fetch(');
  assert(guard >= 0 && (network < 0 || guard < network), `${name} reaches expert profile work before the public release guard`);
}
assert(!/_params\.get\('seat_added'\)/.test(app), 'held paid-seat success callback still consumes URL state');
assert(!/_params\.get\('connect'\)/.test(app), 'held payout success callback still consumes URL state');

for (const asset of [
  'feat_mls_navfeat_keep.js', 'legal-chart-fill-ui.js', 'feat_mls_legal_exact.js',
  'feat_mls_team_exact.js', 'feat_mls_legal_paywidget.js', 'feat_mls_expert_top.js',
  'feat_mls_legal_pay_setup.js', 'feat_mls_staff_hub.js'
]) {
  assert(!connector.includes(asset), `production connector still loads held asset ${asset}`);
}
/* The read-only drafting pack graduated with the 1p -> production derivation.
   It is intentionally separate from the still-held networked legal product:
   require its canonical loader while continuing to forbid the intake,
   payment, messaging, signing and delivery graph above and below. */
assert(connector.includes("var A='feat_mls_legalpack.js',SRC='feat_mls_legalpack.js',V='p1-legal-1.0.0'"),
  'production connector does not load the promoted read-only Legal / IME pack');
assert(!/\/api\/legal\//.test(legalPack) && !/_legalFetchRetry\s*\(/.test(legalPack),
  'the promoted draft pack can reach the held networked legal API');

const supervisionMarker = connector.indexOf('/* ---- module: feat_supervision.js ---- */');
const supervisionGuard = connector.indexOf('if (window.__MLS_TEAM_WORKSPACE_RELEASED !== true) return;', supervisionMarker);
const supervisionExport = connector.indexOf('window.__mlsSupervision={', supervisionMarker);
assert(supervisionMarker >= 0 && supervisionGuard > supervisionMarker && supervisionGuard < supervisionExport,
  'embedded supervision mutations are reachable before the immutable Team release guard');

const legalChainMarker = connector.indexOf('/* ---- module: feat_legal_chain.js ---- */');
const legalChainGuard = connector.indexOf('if (window.__MLS_LEGAL_WORKSPACE_RELEASED !== true) return;', legalChainMarker);
const legalChainExport = connector.indexOf('window.__mlsLegalFee=feeHook;', legalChainMarker);
assert(legalChainMarker >= 0 && legalChainGuard > legalChainMarker && legalChainGuard < legalChainExport,
  'embedded legal/billing chain is reachable before the immutable legal release guard');

assert(connector.includes('var providers=[signedNotesProvider, athenaProvider, followupProvider];'), 'activity feed still exposes payment/BAA placeholders');
assert(!/label:'(?:Supervision queue|Flag legal \/ IME case|Legal requests|Team)'/.test(connector), 'command palette still exposes a held workspace');
assert(!/route:'(?:view:legalreq|view:team|settings:legal)'/.test(connector), 'Help/Find directory still routes into a held workspace');
assert(!/\/api\/copilot\/email|\bSend email\b/.test(copilotActions), 'Copilot artifact can still send an arbitrary-recipient email');
assert(copilotActions.includes('function copyEmailDraft') && !/\bteam\s*:\s*['"]team['"]/.test(copilotActions), 'Copilot local draft/held-Team boundary regressed');
assert(!/title:\s*['"]Legal requests['"]/.test(commandPalette), 'secondary command palette still exposes Legal requests');

for (const id of ['ptReceptionBtn', 'ptFollowupBtn', 'ptLawyerBtn', 'ptDoctorsBtn']) {
  const tag = (app.match(new RegExp(`<button[^>]+id="${id}"[^>]*>`, 'i')) || [])[0] || '';
  assert(/\bhidden\b/.test(tag) && /\bdisabled\b/.test(tag), `${id} is not hidden and disabled`);
  assert(!/onclick=/.test(tag), `${id} retains an executable click handler`);
}

const guardedLegal = [
  'loadLawyers', 'addLawyer', 'removeLawyer', 'generatePatientLegalReport',
  'loadLegalProfile', 'saveLegalProfile', 'submitLegalRequest', 'loadLawyerRequests',
  'fetchLegalAttachments', 'loadLegalRequestFilesText', 'loadLegalAttachments',
  'uploadLegalAttachment', 'renderClinicianAttachments', 'downloadLegalAttachment',
  'renderLegalToolAttachments', 'uploadDoctorAttachment', 'lawRequestAppearance',
  'deleteLegalRequest', 'submitSelfRequest', 'loadConnectStatus', 'startConnectOnboard',
  'loadLegalRequests', 'openLegalRequest', 'saveLegalInvoice', 'askAiQuestions',
  'loadLegalMessages', 'sendLegalMessageDoctor', 'loadLawMessages', 'sendLawMessageLawyer'
];

for (const name of guardedLegal) {
  const body = functionBody(name);
  const network = body.search(/(?:fetch|_legalFetchRetry)\s*\(/);
  if (network < 0) continue;
  const guard = body.search(/!legalWorkspaceReleased\s*\(\)/);
  assert(guard >= 0 && guard < network, `${name} can reach the network before the release guard`);
}

for (const name of ['openFollowups', 'renderFollowups', 'changeFollowupDays', 'toggleAutoFollowups', 'sendFollowups']) {
  const body = functionBody(name);
  const network = body.search(/fetch\s*\(/);
  const stop = body.indexOf('return false;');
  assert(stop >= 0 && (network < 0 || stop < network), `${name} can reach follow-up delivery`);
}

for (const name of ['loadDoctorSeats', 'renderDoctorSeats', 'addDoctorSeat', 'removeDoctorSeat']) {
  const body = functionBody(name);
  const network = body.search(/fetch\s*\(/);
  const stop = body.indexOf('return false;');
  assert(stop >= 0 && (network < 0 || stop < network), `${name} can reach paid seat mutation`);
}
assert(!/\/api\/connect/.test(functionBody('suRenderPayments')), 'setup wizard can still probe payout status');

const trackerStart = tracker.indexOf('window.mlsLegalTracker = function ()');
const trackerStop = tracker.indexOf('return;', trackerStart);
const legacyPaymentClaim = tracker.indexOf('Payment complete', trackerStop);
assert(trackerStart >= 0 && trackerStop > trackerStart && legacyPaymentClaim > trackerStop,
  'old cached legal tracker is not stopped before legacy delivery/payment states');

console.log('PASS held networked legal workspace: promoted read-only draft pack stays separate, no visible networked entry points or API path precedes release guards, and old cached tracker fails closed');
