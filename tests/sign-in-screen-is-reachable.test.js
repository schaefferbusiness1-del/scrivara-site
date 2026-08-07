'use strict';

/* The sign-in screen must be usable by someone who cannot use a mouse.
 * ===========================================================================
 * Owner, 2026-08-05, relayed: "fix sign in screen" — no symptom given. Measured
 * on LIVE b875 before changing anything:
 *
 *   #tabLogin / #tabSignup were <div onclick=...> with no role, no tabindex and
 *   no aria-selected. focusable:false, and NOT in the tab order. A keyboard-only
 *   or screen-reader user had NO PATH to "Sign up" — they could not create an
 *   account at all.
 *
 *   #tabSignup measured 3.31:1 against the card's white at 14.5px/600. WCAG AA
 *   needs 4.5:1. That is the one control a new user must find.
 *
 *   #forgotLink measured 104x17px at 375px wide — a third of the 44px minimum,
 *   on the link someone locked out has to hit.
 *
 * WHY THE FIX HAD TO LAND IN ScribeFlow.html, AND THIS IS THE REAL LESSON:
 * the sign-in screen loads FOUR scripts. The whole feat_* module train lands
 * only AFTER login. feat_athena_tooltip_dedupe.js ALREADY adds role/tabindex/
 * aria-selected/keydown to these exact two ids, and feat_mls_ui_shell.js already
 * predicted the 3.32:1 contrast failure and concluded the fix "belongs in
 * feat_mls_login_exact.js" — and NEITHER of those files is ever loaded on the
 * screen they target. Both fixes were real, correct, and unreachable. Any future
 * sign-in fix that lives in a feat_* module is dead on arrival.
 *
 * Two things measured and found NOT broken, recorded so nobody "fixes" them:
 *   - Enter submits from both fields despite there being no <form> (a keydown
 *     handler does it), so adding a <form> would be churn;
 *   - the 13x13 consent checkboxes are wrapped in 227x75 and 227x135 <label>s,
 *     so the tappable area is the whole sentence, not the box.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. the tabs are real controls ---- */
for (const id of ['tabLogin', 'tabSignup']) {
  const tag = new RegExp('<button type="button" class="auth-tab[^"]*" id="' + id + '" role="tab" aria-selected="(true|false)"');
  assert(tag.test(html),
    id + ' must be a <button role="tab"> with aria-selected — as a bare <div onclick> it is not focusable and a keyboard user cannot reach Sign up');
}
assert(/class="auth-tabs" role="tablist"/.test(html), 'the tab strip must be a tablist');
assert(/onkeydown="_authTabsKeydown\(event\)"/.test(html), 'arrow-key navigation must be wired on the tablist');
assert(!/<div class="auth-tab[^"]*" id="tab(Login|Signup)"/.test(html), 'a div-based auth tab is back');

/* ---- 2. aria-selected is maintained, not just set once in the markup ---- */
const switchFn = html.slice(html.indexOf('function switchAuth(mode){'), html.indexOf('function switchAuth(mode){') + 1600);
assert(/setAttribute\('aria-selected',\s*mode==='login'\?'true':'false'\)/.test(switchFn),
  'switchAuth must keep tabLogin aria-selected truthful — the `on` class is invisible to a screen reader');
assert(/setAttribute\('aria-selected',\s*mode==='signup'\?'true':'false'\)/.test(switchFn),
  'switchAuth must keep tabSignup aria-selected truthful');

/* ---- 3. contrast: the value, and the retired one ---- */
assert(html.includes('color:#636E66 !important'), 'the unselected auth tab must use the AA-passing colour');
assert(!html.includes('color:#8A8F86 !important'), 'the 3.31:1 auth-tab colour is back');

/* the arithmetic, so this is a measurement and not a colour preference */
function ratio(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const lum = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return (1.0 + 0.05) / (L + 0.05);
}
const passing = ratio('#636E66'), failing = ratio('#8A8F86');
assert(passing >= 4.5, '#636E66 must clear WCAG AA on white, got ' + passing.toFixed(2));
assert(failing < 4.5, '#8A8F86 must be shown to fail, got ' + failing.toFixed(2) + ' — if this passes the test is measuring nothing');

/* ---- 4. button UA defaults are put back down ---- */
for (const prop of ['appearance:none', 'font-family:inherit', 'margin:0']) {
  assert(html.includes(prop + ' !important'),
    'the auth tabs are <button> now; ' + prop + ' must be reset or the UA default leaks through — .auth-tab is ALSO styled at runtime by feat_mls_login_exact.js, so a literal grep of this file is not the whole cascade');
}
assert(/\.auth-tab:focus-visible\{[^}]*outline:2px solid/.test(html),
  'a keyboard user must be able to SEE which tab has focus');

/* ---- 5. the forgot-password target ---- */
const forgot = html.slice(html.indexOf('id="forgotLink"') - 200, html.indexOf('id="forgotLink"') + 400);
assert(/display:inline-block/.test(forgot) && /padding:14px 10px/.test(forgot),
  'forgotLink must carry a real touch target (was 104x17 at 375px, minimum is 44)');

console.log('PASS sign-in screen is reachable: both tabs are focusable role=tab buttons in the tab order with '
  + 'maintained aria-selected and arrow-key navigation, the unselected tab clears WCAG AA (3.31 -> 5.31 measured live), '
  + 'button UA defaults are reset, and the forgot-password target meets 44px. Fixed in ScribeFlow.html because the '
  + 'sign-in screen loads 4 scripts and no feat_* module can reach it.');
