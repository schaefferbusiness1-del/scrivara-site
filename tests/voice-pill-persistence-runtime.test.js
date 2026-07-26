'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const start = connect.indexOf('function setR44Display(el, hidden)');
const end = connect.indexOf('function scopeAgenda()', start);
assert(start >= 0 && end > start, 'legacy display helper is missing');
const helper = connect.slice(start, end);

const values = { display: 'inline-flex' };
const priorities = { display: 'important' };
const attrs = new Map();
const el = {
  style: {
    getPropertyValue(name) { return values[name] || ''; },
    getPropertyPriority(name) { return priorities[name] || ''; },
    setProperty(name, value, priority) { values[name] = String(value); priorities[name] = priority || ''; },
    removeProperty(name) { delete values[name]; delete priorities[name]; }
  },
  setAttribute(name, value) { attrs.set(name, String(value)); },
  getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null; },
  removeAttribute(name) { attrs.delete(name); }
};

const context = vm.createContext({ window: {} });
vm.runInContext(`${helper}\nwindow.__setR44DisplayForTest = setR44Display;`, context);
const setDisplay = context.window.__setR44DisplayForTest;

// An enabled legacy preference must not erase the desktop layout owner's
// inline-important visibility. That erase caused the live two-second flicker.
setDisplay(el, false);
assert.strictEqual(values.display, 'inline-flex', 'enabled preference removed another owner\'s visible display');
assert.strictEqual(priorities.display, 'important', 'enabled preference weakened another owner\'s display priority');

// The helper may still hide a control for an explicit user preference, and it
// must be able to undo only that value when the preference is enabled again.
setDisplay(el, true);
assert.strictEqual(values.display, 'none', 'explicit hidden preference was not applied');
assert.strictEqual(attrs.get('data-mls-r44-display-owner'), '1', 'legacy hide did not record ownership');
setDisplay(el, false);
assert.strictEqual(values.display, undefined, 'legacy helper did not remove its own hidden display');
assert(!attrs.has('data-mls-r44-display-owner'), 'legacy display ownership marker was not cleared');

/* PIN UPDATED 2026-07-26, deliberately, and inverted.
 *
 * It used to require the ft-1.1.3 desktop FORCE-SHOW of the three bottom-left
 * pills — an owner order from 2026-07-21, implemented as an inline
 * `display:inline-flex !important` because that is the only declaration that
 * can beat a stylesheet !important rule.
 *
 * On 2026-07-26 the owner retired those pills (vc-2.0.0, b676) and the
 * retirement was written as CSS. FIVE independent `display:none!important`
 * rules now match each pill (mlsVcStyle, mlsCalmShellCss, mlsRdStyle x2,
 * mlsEz3GradientCss) and the surviving inline declaration outranked every one
 * of them, so the newer order lost to the older one at CSS precedence and
 * every CSS-reading test still passed.
 *
 * Measured on a running page, real Chrome, real trusted mouse clicks:
 *   1400x900  a click at the CENTRE of the dock's "Patient" button was
 *             received by #mlsCopVoiceBtn
 *   390x844   the same click was received by #mlsDaDock
 * So this is now the opposite assertion: nothing may force these three
 * retired controls back on screen with an inline declaration. Their routes
 * live in the Calm Shell's Tools menu and (on phones) the FAB menu. */
assert(connect.includes("version: 'ft-1.1.4'"), 'desktop visibility owner was not bumped for the pill retirement');
assert(!/setProperty\('display', 'inline-flex', 'important'\)/.test(connect),
  'something force-shows a retired bottom-left pill with an inline !important display again — that outranks all five stylesheet retirements and puts the pill back on top of the dock');
assert(/mlsCopVoiceBtn', 'mlsAsstFab', 'mlsDaDock'\]\.forEach[\s\S]{0,400}removeProperty\('display'\)/.test(connect),
  'the healing pass that clears an already-written inline display is gone, so a warm tab keeps the pills until it is reloaded');

console.log('PASS voice pill persistence: legacy settings cannot erase another owner\'s display, and nothing force-shows the retired bottom-left pills over the dock');
