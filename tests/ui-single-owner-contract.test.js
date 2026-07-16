'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

new Function(source); // eslint-disable-line no-new-func

const start = source.indexOf('single-owner UI + account access');
assert(start >= 0, 'single-owner UI module is missing');
const ui = source.slice(start);

assert(ui.includes("body.mls-has-easy-advanced-trigger #mlsEz3 .ez3-advrow{display:none!important;}"), 'duplicate Advanced toggle must be hidden only when the easy owner exists');
assert(ui.includes("var nextLabel = open ? 'Hide advanced workspace' : 'Advanced visit workspace'") && ui.includes('if (trigger.textContent !== nextLabel) trigger.textContent = nextLabel'), 'easy Advanced trigger must expose open/close state without redundant observer writes');
assert(ui.includes('initialAdvancedSettled') && ui.includes('owner.click()'), 'stale Advanced state must collapse once on entry');
assert(ui.includes("body.mls-has-exact-portal-action #mlsEz3 .ez3-portal{display:none!important;}"), 'generic portal link must yield to the exact active-patient action');
assert(ui.includes("document.body.classList.toggle('mls-has-exact-portal-action'"), 'portal ownership must reconcile as patients change');

assert(ui.includes('id="mlsAccountMenuBtn"') && ui.includes('Account &amp; security') && ui.includes('Sign out'), 'top-bar account access is incomplete');
assert(ui.includes("typeof W.getSessionEmail === 'function' && W.getSessionEmail()"), 'top-bar account identity must work for both hosted and local sessions');
assert(ui.includes("typeof W.openSettings === 'function'") && ui.includes('W.openSettings()'), 'top-bar account action must open the real settings modal');
assert(ui.includes("/(settings|sign out|log out)$/i"), 'legacy account rows must be consolidated under the top-bar owner even when they include icons');
assert(ui.includes("how-to guide|guided tour\\s*\\/\\s*how-to") && ui.includes("el.offsetParent !== null") && ui.includes("'duplicate-how-to'"), 'duplicate visible How-To entries must be consolidated without hiding the only visible guide');
assert(ui.includes('MutationObserver') && ui.includes('topObserver.observe(top') && ui.includes('visitObserver.observe(visit'), 'reconciliation observers must stay scoped to stable UI roots');
assert(ui.includes("portalObserver = new MutationObserver(function () { scheduleConcern('portal'); })") && ui.includes("if (queue.portal) safe(reconcilePortalOwner)"), 'portal mutations are not routed only to portal ownership reconciliation');
assert(ui.includes("target.closest('#tabLogin,#tabSignup')") && ui.includes("scheduleConcern('auth')") && ui.includes("if (queue.auth) safe(reconcileAuth)"), 'auth-tab changes are not routed only to auth reconciliation');
assert(!ui.includes('setTimeout(reconcileAll, 0)'), 'ordinary clicks can still trigger a whole-site reconciliation');
assert(ui.includes('if (avatar && avatar.textContent !== nextAvatar) avatar.textContent = nextAvatar') && ui.includes('if (id && id.textContent !== nextId) id.textContent = nextId'), 'account observer writes are not equality guarded');
assert(ui.includes('if (trigger.textContent !== nextLabel) trigger.textContent = nextLabel') && ui.includes("if (trigger.getAttribute('aria-expanded') !== (open ? 'true' : 'false'))"), 'advanced-workspace observer writes are not equality guarded');
assert(ui.includes("tabs.setAttribute('role', 'tablist')") && ui.includes("tab.setAttribute('role', 'tab')") && ui.includes("tab.setAttribute('aria-selected'"), 'auth mode controls must expose accessible tab semantics');
assert(ui.includes("/^(Enter| |Spacebar)$/") && ui.includes("tab.addEventListener('keydown', authTabKeydown)"), 'auth tabs must work from the keyboard');
assert(ui.includes("pass.setAttribute('minlength', '8')") && ui.includes("pass.removeAttribute('minlength'); /* preserve login compatibility */"), 'signup must enforce eight characters without blocking legacy login passwords');
assert(ui.includes("showResetError('Password must be at least 8 characters.')"), 'password reset must use the same eight-character standard');
assert(app.includes('id="authPass2" placeholder="••••••••" autocomplete="new-password" minlength="8"'), 'base signup markup does not enforce the eight-character contract before optional UI loads');
assert(app.includes('id="resetPass" placeholder="••••••••" autocomplete="new-password" minlength="8"') && app.includes('id="resetPass2" placeholder="••••••••" autocomplete="new-password" minlength="8"'), 'base reset markup does not enforce the eight-character contract');
assert(app.includes("const authMin=authMode==='signup'?8:6") && app.includes("if(mode==='signup') pass.setAttribute('minlength','8'); else pass.removeAttribute('minlength')"), 'base auth logic does not enforce eight characters only for fresh signup');
assert(app.includes("if(!p1 || p1.length<8){ showErr('Password must be at least 8 characters.')"), 'base reset handler still accepts a password shorter than eight characters');
assert(ui.includes('function revert()') && ui.includes('disconnect()') && ui.includes('removeEventListener'), 'single-owner module needs complete lifecycle cleanup');

assert(!/(?:background|content|inject_dom)\.js|manifest\.json|chrome\.runtime/i.test(ui), 'single-owner UI must not touch the extension');

console.log('PASS UI single owners: easy recorder, exact portal action, account access, and How-To are consolidated');
