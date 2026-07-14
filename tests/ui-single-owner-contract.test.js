'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');

new Function(source); // eslint-disable-line no-new-func

const start = source.indexOf('single-owner UI + account access');
assert(start >= 0, 'single-owner UI module is missing');
const ui = source.slice(start);

assert(ui.includes("body.mls-has-easy-advanced-trigger #mlsEz3 .ez3-advrow{display:none!important;}"), 'duplicate Advanced toggle must be hidden only when the easy owner exists');
assert(ui.includes("trigger.textContent = open ? 'Hide advanced workspace' : 'Advanced visit workspace'"), 'easy Advanced trigger must expose open/close state');
assert(ui.includes('initialAdvancedSettled') && ui.includes('owner.click()'), 'stale Advanced state must collapse once on entry');
assert(ui.includes("body.mls-has-exact-portal-action #mlsEz3 .ez3-portal{display:none!important;}"), 'generic portal link must yield to the exact active-patient action');
assert(ui.includes("document.body.classList.toggle('mls-has-exact-portal-action'"), 'portal ownership must reconcile as patients change');

assert(ui.includes('id="mlsAccountMenuBtn"') && ui.includes('Account &amp; security') && ui.includes('Sign out'), 'top-bar account access is incomplete');
assert(ui.includes("typeof W.getSessionEmail === 'function' && W.getSessionEmail()"), 'top-bar account identity must work for both hosted and local sessions');
assert(ui.includes("typeof W.openSettings === 'function'") && ui.includes('W.openSettings()'), 'top-bar account action must open the real settings modal');
assert(ui.includes("/(settings|sign out|log out)$/i"), 'legacy account rows must be consolidated under the top-bar owner even when they include icons');
assert(ui.includes("how-to guide|guided tour\\s*\\/\\s*how-to") && ui.includes("el.offsetParent !== null") && ui.includes("'duplicate-how-to'"), 'duplicate visible How-To entries must be consolidated without hiding the only visible guide');
assert(ui.includes('MutationObserver') && ui.includes('topObserver.observe(top') && ui.includes('visitObserver.observe(visit'), 'reconciliation observers must stay scoped to stable UI roots');
assert(ui.includes("tabs.setAttribute('role', 'tablist')") && ui.includes("tab.setAttribute('role', 'tab')") && ui.includes("tab.setAttribute('aria-selected'"), 'auth mode controls must expose accessible tab semantics');
assert(ui.includes("/^(Enter| |Spacebar)$/") && ui.includes("tab.addEventListener('keydown', authTabKeydown)"), 'auth tabs must work from the keyboard');
assert(ui.includes("pass.setAttribute('minlength', '8')") && ui.includes("pass.removeAttribute('minlength'); /* preserve login compatibility */"), 'signup must enforce eight characters without blocking legacy login passwords');
assert(ui.includes("showResetError('Password must be at least 8 characters.')"), 'password reset must use the same eight-character standard');
assert(ui.includes('function revert()') && ui.includes('disconnect()') && ui.includes('removeEventListener'), 'single-owner module needs complete lifecycle cleanup');

assert(!/(?:background|content|inject_dom)\.js|manifest\.json|chrome\.runtime/i.test(ui), 'single-owner UI must not touch the extension');

console.log('PASS UI single owners: easy recorder, exact portal action, account access, and How-To are consolidated');
