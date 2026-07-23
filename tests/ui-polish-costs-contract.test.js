'use strict';
/* 2026-07-22 evening polish pins:
 *  1. MODEL COSTS: gpt-5 (full power) is never offered or sent — owner
 *     directive, too expensive. The fake 'gpt-5o' id is gone (it was silently
 *     downgraded server-side, so "Best" lied). Best = real gpt-5-mini with the
 *     honest 4o cascade; stale stored choices migrate.
 *  2. SIGN-IN PROMPT: the disconnected-Athena prompt's click triggers cover
 *     the LIVE pull entry points (they used to match only retired buttons, so
 *     it never fired).
 *  3. CORNERS: the progress chip/panel live in a clear slot above the
 *     bottom-right chip band; the provider chip no longer sits under the
 *     assistant FAB; the top-bar Menu pill collapses at narrow widths like
 *     the account pill.
 *  4. DARK THEME: the equalizer overrides exist for the hardcoded-light
 *     satellites (account menu, tb menu, studio cards, assistant panel,
 *     progress chip/panel, list items).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const fixpack = fs.readFileSync(path.join(root, 'feat_mls_fixpack_0701.js'), 'utf8');
const signin = fs.readFileSync(path.join(root, 'feat_athena_signin_prompt.js'), 'utf8');
const ps = fs.readFileSync(path.join(root, 'feat_mls_progress_stages.js'), 'utf8');
const pp = fs.readFileSync(path.join(root, 'feat_mls_provider_passthrough.js'), 'utf8');
const tb = fs.readFileSync(path.join(root, 'feat_mls_topbar_unify.js'), 'utf8');
const dd = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');

/* ---- 1. model costs ---- */
assert(fixpack.includes("var MODELS = ['gpt-5-mini', 'gpt-4o', 'gpt-4o-mini'];"), 'note-model list must be exactly the affordable trio');
/* gpt-5 may appear ONLY defensively (migrating a stored choice away, stripping
   a stale option) — never as an offered option or cascade member */
assert(!fixpack.includes("['gpt-5',"), 'gpt-5 is offered as an option again');
const gpt5Mentions = (fixpack.match(/['"]gpt-5['"]/g) || []).length;
assert(gpt5Mentions === 2, 'unexpected gpt-5 references (want exactly the migration + option-strip pair): ' + gpt5Mentions);
assert(!fixpack.includes("'gpt-5o', 'Best"), 'the fake gpt-5o Best option is back');
assert(fixpack.includes("return 'gpt-5-mini';"), 'default note model must be gpt-5-mini');
assert(fixpack.includes("var MIG = 'mlsFpModelMig2';"), 'stored-model migration missing');
assert(/curM === 'gpt-5o' \|\| curM === 'gpt-5'/.test(fixpack), 'migration must retire both the fake and the expensive stored choices');
assert(/o\.value === 'gpt-5' \|\| o\.value === 'gpt-5o'/.test(fixpack), 'hot-upgraded selects must strip retired options');
assert(fixpack.includes("'Best — GPT-5 mini (newest, recommended)'"), 'the honest Best label is missing');
assert(!fixpack.includes("'GPT-5 — full power'"), 'the full-power option label survives');

/* ---- 2. sign-in prompt triggers ---- */
const trig = (signin.match(/var TRIGGER_SEL = '([^']+)'/) || [])[1] || '';
for (const id of ['#ez3PullNow', '#ez3PullStart', '#ez3sPullToday', '#ez3PullRetry', '#ez3HistPull', '[data-mls-athena-trigger]']) {
  assert(trig.includes(id), 'sign-in prompt triggers lost ' + id);
}
assert(signin.includes("VERSION = '1.3.0'"), 'sign-in prompt version not bumped for the trigger repair');

/* ---- 3. corners ---- */
assert(ps.includes("{position:fixed;right:84px;bottom:18px;z-index:2147483200;"), 'progress chip left its clear slot (would be buried under the chip band again)');
assert(ps.includes("{position:fixed;right:16px;bottom:64px;z-index:2147483199;"), 'progress panel slot/z regressed');
assert(pp.includes("position:fixed;left:18px;bottom:76px;z-index:99995;"), 'provider chip is back underneath the assistant FAB');
assert(tb.includes('.mlsTbBtnLabel{display:none;}') && tb.includes('@media(max-width:720px){#" + BTN_ID'), 'top-bar Menu pill does not collapse at narrow widths');
assert(tb.includes('class=\\"mlsTbBtnLabel\\"'), 'Menu label span is untagged (collapse rule cannot match)');

/* ---- 4. dark equalizer ---- */
for (const sel of ['body.theme-dark #mlsAccountMenuBtn', 'body.theme-dark .mls-account-pop', 'body.theme-dark #mlsTbMenuBtn', 'body.theme-dark #mlsTbMenuPanel', 'body.theme-dark #copilotCard', 'body.theme-dark #mlsAsstPanel', 'body.theme-dark #mlsPsChip', 'body.theme-dark #mlsPsPanel', 'body.theme-dark .pt-item']) {
  assert(dd.includes(sel), 'dark-theme equalizer lost: ' + sel);
}
assert(!/body\.theme-dark [^{]*\{[^}]*#F4F2EC/.test(dd.split('dark-theme equalizer')[1] || ''), 'equalizer uses a light hex inside a dark rule');

console.log('PASS ui polish + costs: affordable-only model picker with migration, live sign-in-prompt triggers, un-buried progress chip and provider chip, collapsing Menu pill, dark-theme equalizer');
