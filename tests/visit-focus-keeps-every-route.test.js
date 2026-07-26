'use strict';

/*
 * Anything feat_mls_visit_focus.js takes off the Visit or Patients surface must
 * keep a route to it — and the hide must be by CLASS, never inline.
 *
 * WHY BOTH HALVES MATTER, from this repo's own history:
 *
 *   - available() (feat_mls_calm_shell.js) tests INLINE display. An inline
 *     `el.style.display = 'none'` therefore deletes a control from the Calm
 *     Shell's Tools menu SILENTLY: nothing throws, the screen looks tidier, and
 *     a feature is gone. A class-hide leaves inline display untouched, so Tools
 *     still offers it. This is the same defect shell-hidden-controls-keep-reach
 *     was written for after b560 stranded Copilot Voice, the MLS Assistant and
 *     Dictate for twenty builds.
 *   - A hide with no route is a deletion with better manners. The owner's
 *     standing constraint on the whole rework is ease of use WITHOUT losing
 *     features. ROUTES is where the second half is written down.
 *
 * This suite is deliberately STRUCTURAL rather than a runtime walk: 5 of the 11
 * selectors below only render in states a headless crawl cannot reach (a live
 * recognizer, a generated note, a widget deck with real cards). A gate that
 * only fires in the states it can reach teaches nothing about the others.
 *
 * NEGATIVE-TESTED IN BOTH DIRECTIONS before being trusted (the b669 rule):
 *   - deleting a ROUTES entry while leaving its CSS rule  -> FAILS (verified)
 *   - the tree as shipped                                 -> PASSES (verified)
 * A gate that has only ever been seen to pass has not been tested.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_visit_focus.js'), 'utf8');

/* ---- 1. the module hides nothing inline ---------------------------------- */

assert.ok(
  !/\.style\.display\s*=/.test(src),
  'feat_mls_visit_focus.js writes style.display. available() reads INLINE ' +
  'display, so an inline hide silently removes the control from the Calm ' +
  'Shell Tools menu. Hide by class.'
);
assert.ok(
  !/\bstyle\.visibility\s*=/.test(src) && !/setAttribute\(\s*['"]hidden['"]/.test(src),
  'the module hides with visibility or the hidden attribute. Same problem: ' +
  'neither is a class, and neither keeps the Tools route honest.'
);

/* ---- 2. every hide rule is declared in ROUTES ---------------------------- */

/* The ROUTES table, read out of the source. Parsing it rather than requiring
 * the module keeps this suite free of a DOM. */
const routes = [];
const ROUTE_RE = /\{\s*sel:\s*'([^']+)',\s*\n\s*route:\s*'([^']*)',\s*\n\s*why:\s*'([^']*)'\s*\}/g;
let m;
while ((m = ROUTE_RE.exec(src))) routes.push({ sel: m[1], route: m[2], why: m[3] });

assert.ok(routes.length >= 10,
  'ROUTES parsed only ' + routes.length + ' entries. Either the table shrank or ' +
  'its shape changed and this parser no longer reads it — both are failures, ' +
  'because a table this suite cannot read enforces nothing.');

routes.forEach((r) => {
  assert.ok(r.route && r.route.trim().length > 8,
    'ROUTES entry "' + r.sel + '" has no usable route. A hidden control needs a ' +
    'control that is ON SCREEN and leads to it, not "it is still in the DOM".');
  assert.ok(r.why && r.why.trim().length > 12,
    'ROUTES entry "' + r.sel + '" has no reason. Every control removed from a ' +
    'clinical screen needs one on the record.');
});

/* Now the other direction: every selector that appears in a display:none rule
 * must be in ROUTES. This is the half that catches a hide added later without
 * a route — the failure mode the whole suite exists for. */
const cssBlock = /var CSS = \[([\s\S]*?)\n  \]\.join/.exec(src);
assert.ok(cssBlock, 'the CSS array is not where this suite expects it');

const declared = new Set(routes.map((r) => r.sel));
/* selectors are built by concatenation ('body.' + BODY + ' #x'), so normalize
 * to the part that names the target: everything from the first #view id on. */
function targets(selectorText) {
  return selectorText
    .split(',')
    .map((s) => s.trim())
    .map((s) => {
      const i = s.search(/#(visitView|patientsView)\b/);
      return i >= 0 ? s.slice(i).replace(/\s+/g, ' ').trim() : '';
    })
    .filter(Boolean);
}

const undeclared = [];
/* each CSS entry is a quoted JS string fragment; rebuild logical rules by
 * joining and then splitting on '}' */
const cssText = cssBlock[1]
  .replace(/'\s*\+\s*BODY\s*\+\s*'/g, 'mls-vfocus')
  .replace(/'\s*\+\s*PTMORE\s*\+\s*'/g, 'vf-ptmore')
  .replace(/'\s*\+\s*TOOLS\s*\+\s*'/g, 'vf-tools')
  .replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith("'"))
  .map((l) => l.replace(/^'/, '').replace(/',?$/, ''))
  .join('');

cssText.split('}').forEach((chunk) => {
  const open = chunk.indexOf('{');
  if (open < 0) return;
  const selector = chunk.slice(0, open);
  const body = chunk.slice(open + 1);
  if (!/display\s*:\s*none/.test(body)) return;
  targets(selector).forEach((t) => { if (!declared.has(t)) undeclared.push(t); });
});

assert.deepStrictEqual(undeclared, [],
  'these selectors are hidden with no ROUTES entry:\n  ' + undeclared.join('\n  ') +
  '\nEvery control this module takes off a clinical screen needs a named route ' +
  'back. Add it to ROUTES with the route and the reason, or stop hiding it.');

/* ---- 3. the disclosures it depends on must exist ------------------------- */

/* Each route names a real control. If one of these is renamed the route becomes
 * a sentence about a button that is not there — which is exactly the
 * "instruction points nowhere" defect (b602). */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

assert.ok(/id="ptMoreBtn"/.test(app),
  '#ptMoreBtn is gone. It is the route back for six hidden Patients controls; ' +
  'without it they are unreachable and this module is deleting features.');
assert.ok(/id="ptMore"/.test(app),
  '#ptMore is gone — the panel #ptMoreBtn opens, and the thing body.vf-ptmore mirrors.');
assert.ok(/'ez3QToolsToggle'/.test(connect) && /'ez3flToolsToggle'/.test(connect),
  'the "Visit shortcuts" chips are gone. They are the route back for the ' +
  'visit secondary row and the note-format chips.');
assert.ok(/uns\('ez3ToolsOpen'\)/.test(connect),
  "the ez3ToolsOpen preference key is gone. body.vf-tools mirrors it, so a " +
  'rename silently strands everything the Visit shortcuts chip reveals.');
assert.ok(/'ez3Change'/.test(connect),
  '#ez3Change is gone. The day-strip rule keys on it to mean "a visit is ' +
  'locked"; without it the strip would hide in every visit state, including ' +
  'the home screen where it is the only way to change day.');
assert.ok(/wd-starter/.test(fs.readFileSync(path.join(root, 'feat_mls_widget_deck.js'), 'utf8')),
  '.wd-starter is gone from the widget deck. The deck is hidden ONLY in that ' +
  'starter state; without the marker the rule would hide a doctor\'s real widgets.');

/* ---- 3b. EXACTLY ONE text-entry surface -------------------------------- */

/* Owner, 2026-07-26: "sometimes 2 textboxes pop up — all errors like this must
 * not make final product." Confirmed on his signed-in tab at b677:
 * #ez3flTranscript and #ez3Transcript both visible, same placeholder, one
 * screen. Two identical places to type the same visit.
 *
 * This pins the invariant in BOTH directions, because the dangerous failure is
 * not the duplicate — it is the over-correction. b653: an earlier rule asserted
 * the top lane owned the voice controls while the top lane rendered nothing,
 * and left a doctor with none at all. A rule that can hide the LAST transcript
 * is worse than one that shows two. */
assert.ok(
  /:has\(\.ez3fl-record:not\(\[hidden\]\) #ez3flTranscript:not\(\[hidden\]\)\) \.ez3-transcript-card\{display:none!important\}/.test(src),
  'the one-transcript rule is gone or was rewritten. It must stand the engine ' +
  "copy down ONLY when the lane's transcript is really present AND really not " +
  'hidden — both :not([hidden]) terms are load-bearing.'
);
assert.ok(
  /ez3fl-top-owns[^']*\.ez3-transcript-card\{display:none!important\}/.test(connect),
  "mls-connect.js's own class-keyed rule is gone. This module's rule is a " +
  'second, fact-based line of defence, not a replacement — the owner saw two ' +
  'boxes precisely because a single class-keyed rule can be wrong about who owns ' +
  'the transcript.'
);
/* If a THIRD transcript surface is ever added, neither rule knows about it and
 * the invariant silently stops being an invariant. */
{
  const ids = new Set();
  for (const re of [/id="(ez3[A-Za-z]*[Tt]ranscript)"/g, /id="(transcript)"/g]) {
    let x; while ((x = re.exec(app))) ids.add(x[1]);
  }
  for (const re of [/id="(ez3[A-Za-z]*[Tt]ranscript)"/g, /\.id = '(ez3[A-Za-z]*[Tt]ranscript)'/g, /id="(ez3fl[A-Za-z]*)"[^>]*>?/g]) {
    let x; while ((x = re.exec(connect))) if (/transcript/i.test(x[1])) ids.add(x[1]);
  }
  const known = ['transcript', 'ez3Transcript', 'ez3flTranscript'];
  const surprises = [...ids].filter((i) => !known.includes(i));
  assert.deepStrictEqual(surprises, [],
    'new transcript surface(s) found: ' + surprises.join(', ') +
    '\nThe one-transcript invariant names exactly three ids (the hidden canonical ' +
    '#transcript plus the two visible copies). A fourth is a third visible box ' +
    'waiting to happen — teach both rules about it, or do not add it.');
}

/* ---- 4. it stays inside its two views ----------------------------------- */

const strayScope = [];
cssText.split('}').forEach((chunk) => {
  const open = chunk.indexOf('{');
  if (open < 0) return;
  chunk.slice(0, open).split(',').forEach((s) => {
    const sel = s.trim();
    if (!sel) return;
    if (/#(visitView|patientsView)\b/.test(sel)) return;
    strayScope.push(sel);
  });
});
assert.deepStrictEqual(strayScope, [],
  'these rules are not scoped to #visitView or #patientsView:\n  ' + strayScope.join('\n  ') +
  '\nThis module owns two screens. A rule that escapes them lands on another ' +
  "worker's surface, where nobody measured it.");

/* ---- 5. it never proxies, and never navigates --------------------------- */

assert.ok(!/\.click\(\)/.test(src),
  'the module clicks a control. It is presentation only: proxying a control ' +
  'is how a trusted-gesture gate gets silently refused (isTrusted), and it is ' +
  'not what a stylesheet is for.');
/* `showView\s*\(` alone matched the ROUTES prose that EXPLAINS why
 * #dailyBriefBar's two navigation buttons are hidden — the suite failing on its
 * own rationale. Match a real call: showView('patients'). Recording the
 * near-miss because a gate that fires on a comment is a gate people delete. */
assert.ok(!/showView\s*\(\s*['"]/.test(src),
  'the module navigates. The dock is the whole navigation story — that is the ' +
  'reason #dailyBriefBar\'s two showView() buttons are hidden here in the ' +
  'first place.');

console.log('PASS visit-focus keeps every route: ' + routes.length + ' hide rules, ' +
  routes.length + ' named routes, 0 inline hides, 0 rules outside the two views');
