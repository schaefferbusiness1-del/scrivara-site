'use strict';

/* 2026-07-22 truth/navigation fixes across Settings, Analytics, phone setup,
 * the guided tour, and the assistant navigation registry. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const tooltip = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
const ax = fs.readFileSync(path.join(root, 'feat_mls_analysis_exact.js'), 'utf8');
const actions = fs.readFileSync(path.join(root, 'feat_mls_copilot_actions.js'), 'utf8');

/* Settings search: sections with matches outside .field markup must show the
   whole section (not a blank panel) and open collapsed reveals around hits. */
assert(tooltip.includes("String(section.textContent || '').toLowerCase().indexOf(q) >= 0"), 'section-level text fallback missing');
assert(tooltip.includes('openDetailsAround(f)'), 'matched fields do not open their collapsed reveals');
assert(tooltip.includes("section.querySelectorAll('details')).forEach(function (d) { d.open = true; })"), 'section fallback does not open collapsed reveals');

/* Display truth: Settings re-mirrors the actual nav layout on open. */
assert(app.includes('try{ applyNavLayout(); }catch(e){}'), 'openSettings no longer re-syncs the Display select with the real rail state');

/* Version truth: the Settings row and update banner describe the MLS Assist
   EXTENSION handshake; the in-app module version can never masquerade as an
   installed extension. */
assert(connect.includes('MLS Assist extension version'), 'controls row label conflates Assistant with the extension again');
assert(connect.includes("controlsRow('extension not detected in this browser', 'wait')"), 'not-detected row does not name the extension');
assert(connect.includes('A newer MLS Assist extension is ready'), 'update banner conflates Assistant with the extension again');
assert(!connect.includes('window.__mlsExtReportedVersion || (window.__mlsAsstFix && window.__mlsAsstFix.version)'), 'Installed badge can fall back to the in-app module version again');

/* Analytics: the Key-trends face stat is label-anchored — the top-diagnosis
   cohort count can never render under the Active-patients label. */
assert(ax.includes('re: /Active\\s*patients\\s*([\\d,]+)/i'), 'Key-trends face regex is not label-anchored');
assert(!ax.includes('(?:active\\s*)?patient/i'), 'loose first-number-before-"patient" face regex is back');

/* Phone setup: the menu row retries until the QR card is visible, opens
   collapsed sections around it, and says where it lives if it never mounts. */
const phoneAnchor = connect.indexOf("mi.innerHTML = '📱 Use on your phone';");
assert(phoneAnchor >= 0, 'phone menu row missing');
const phoneRow = connect.slice(phoneAnchor, phoneAnchor + 3000);
assert(phoneRow.includes('function land()'), 'phone menu row lost its retry landing');
assert(phoneRow.includes("closest('details')"), 'phone landing does not open collapsed sections');
assert(phoneRow.includes('Phone setup lives in Settings'), 'phone landing failure is silent');

/* Guided tour: the finish step claims tour completion, not setup readiness. */
assert(connect.includes("badge: '✅ Tour complete'"), 'tour finish badge claims readiness again');
assert(!connect.includes("badge: '✅ Ready', title: 'That’s everything — you’re ready'"), 'static setup-ready claim is back');
assert(connect.includes('Setup status is live in Settings → Integrations'), 'tour does not point at the live setup status');

/* Help text: Templates route is Menu → Templates in both shells. */
assert(!app.includes('More tools → Templates'), 'production help text points at the retired More-tools location');
assert(!staging.includes('More tools → Templates'), 'staging help text points at the retired More-tools location');
assert(app.includes('manage templates under Menu → 📄 Templates'), 'production help text lost the real Templates route');

/* Assistant navigation: template requests route to the Templates modal, never
   to AI Studio, and the registry separates the three assistant surfaces. */
assert(actions.includes("templates: 'templates', template: 'templates'"), 'templates alias missing');
assert(actions.includes("if (/template/.test(a)) return 'templates';"), 'template keyword routing missing');
assert(actions.includes("if (resolved === 'templates')"), 'doNavigate lost its Templates modal branch');
assert(connect.includes('MLS Assistant vs Copilot Voice vs MLS Assist'), 'capability registry lost the three-surface distinction');
assert(connect.includes('Drafts stay local in History — nothing reaches Athena until you explicitly review and confirm'), 'op-note prep entry no longer separates local drafting from Athena writeback');

console.log('PASS settings/analytics/navigation truth: search fallback, display sync, extension-version honesty, label-anchored analytics, phone landing, honest tour, template routing');
