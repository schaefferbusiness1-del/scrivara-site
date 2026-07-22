'use strict';

/* 2026-07-22 intake kiosk fixes: "Staff: exit" used a native prompt() (a
 * suppressed prompt made the button do nothing, silently), and browser Back
 * could strand the kiosk tab on about:blank. Contract: in-app password dialog
 * with visible errors, and a history trap that keeps the patient inside intake
 * while pointing staff at the protected exit.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

const start = app.indexOf('function _intakeActive()');
const end = app.indexOf('function intakeNextPatient()', start);
assert(start >= 0 && end > start, 'intake exit/back region missing');
const region = app.slice(start, end);

/* exit dialog */
assert(!/=\s*prompt\(/.test(region), 'Staff exit is back on native prompt()');
assert(region.includes("back.id='ikExitModal'"), 'in-app exit dialog missing');
assert(region.includes('role="dialog" aria-modal="true"'), 'exit dialog is not an accessible modal');
assert(region.includes('type="password"'), 'exit dialog lost its password input');
assert(region.includes("errEl.textContent='Password required to exit intake.'"), 'empty-password refusal is not visible');
assert(region.includes("errEl.textContent='Incorrect password — staying in patient intake.'"), 'wrong-password refusal is not visible');
assert(region.includes('Could not verify the password (offline?)'), 'offline verification failure is not visible');
assert(region.includes("bkBase()+'/api/auth/login'"), 'exit still re-authenticates against the account password');
assert(region.includes('resetIntakeForm(); // never leave a patient\'s answers on screen'), 'patient answers can survive the exit');

/* back trap */
assert(region.includes("window.addEventListener('popstate'"), 'no popstate handler for the kiosk');
assert(region.includes("history.pushState({mlsIntake:1},'',location.href)"), 'kiosk does not seed a history entry');
assert(region.includes('if(!_intakeActive()) return;'), 'back trap is not scoped to the active kiosk');
assert(region.includes('Staff: exit'), 'back trap does not point at the protected exit');
const openIntakeBody = region.slice(region.indexOf('function openIntake()'));
assert(openIntakeBody.includes('_installIntakeBackTrap();'), 'openIntake does not arm the back trap');

console.log('PASS intake kiosk: accessible password-gated exit with visible errors, Back stays safely inside intake');
