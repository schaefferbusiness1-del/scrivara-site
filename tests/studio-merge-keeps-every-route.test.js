'use strict';
/*
 * Merging Analysis into AI Studio may not delete a single route to it.
 *
 * Owner, 2026-07-26: "add the analysis tab to the ai studio tab smartly".
 *
 * A merge is the easiest possible way to lose features silently. Analysis was
 * reachable from at least six places in this codebase — the rail tab, the
 * command palette, feat_mls_copilot_actions' router, feat_mls_copilot_voice_v2,
 * a custom tool's `navigate` action, and mls-connect's own Tools row — and
 * every one of them calls showView('analysis'). If that string stops resolving,
 * all six break at once and nothing throws: showView would simply hide every
 * view and leave a blank page.
 *
 * So the merge is built as ONE redirect rather than fifteen edited call sites,
 * and this suite pins the properties that make that safe.
 *
 * PROVEN IN BOTH DIRECTIONS before being trusted (the rule the b669 clearance
 * gate earned). Each of these was run and observed to fail:
 *   - deleting the showView wrapper
 *   - redirecting to a view other than studio
 *   - dropping 'practice' from the section list
 *   - removing the Tools-menu entry for nav_analysis
 *   - moving nav_analysis back under the dock's tools destination
 *   - dropping the inline-display sync that ax-3.0.0 depends on
 * and the real tree passes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const merge = fs.readFileSync(path.join(root, 'feat_mls_studio_merge.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');
const redesign = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* ---- 1. the redirect exists and lands on the merged surface ---------------- */
const hook = merge.slice(merge.indexOf('function hookShowView()'), merge.indexOf('/* ------------------------------------------------------------- reconcile'));
assert(hook.length > 100, 'the showView wrapper is gone — every route to Analysis now hides every view and shows a blank page');
assert(/if \(v === 'analysis'\)/.test(hook), 'the redirect no longer recognises the "analysis" route');
assert(/orig\.call\(this, 'studio'\)/.test(hook), 'the Analysis route no longer lands on AI Studio');
assert(/select\('practice'/.test(hook), 'the Analysis route lands on AI Studio but not on the Practice section');
assert(/W\.showView\.__mlsSmOrig = orig/.test(merge), 'the original showView is not kept, so revert() cannot restore it');

/* ---- 2. every caller still uses the string the redirect handles ------------ */
/* This is deliberately a REMINDER, not a ban: if someone rewrites a caller to
   navigate straight to 'studio' they lose the Practice selection, which is the
   silent half of this failure. */
for (const [file, why] of [
  ['feat_mls_command_palette.js', 'the command palette'],
  ['feat_mls_copilot_actions.js', "the Copilot's action router"],
  ['feat_mls_copilot_voice_v2.js', 'voice navigation']
]) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  assert(/['"]analysis['"]/.test(src), why + ' (' + file + ') no longer names the analysis route, so the merge redirect cannot catch it');
}
assert(app.includes("onclick=\"showView('analysis')\""), 'the rail tab no longer routes through showView(\'analysis\')');

/* ---- 3. three sections, and Practice is one of them ------------------------ */
const keys = (merge.match(/key: '([a-z]+)',\n      label:/g) || []).map(s => /'([a-z]+)'/.exec(s)[1]);
assert.deepStrictEqual(keys, ['ask', 'practice', 'build'],
  'the AI Studio sections changed. That is allowed, but Practice must exist and the redirect above must name a section that does.');

/* ---- 4. ax-3.0.0's inline-display dependency is honoured ------------------- */
/* feat_mls_analysis_exact.js render() begins:
     if (v.style.display === "none") { v.classList.remove(GRID_CLASS); return; }
   It reads the INLINE display. showView writes display:none on #analysisView
   for every route that is not 'analysis' — which, after this merge, is every
   route. Without the sync below, Practice renders the raw stacked cards and
   the tile grid never builds: measured, class="" and 0 tiles. */
const ax = fs.readFileSync(path.join(root, 'feat_mls_analysis_exact.js'), 'utf8');
assert(/if \(v\.style\.display === "none"\)/.test(ax),
  'feat_mls_analysis_exact no longer gates on the inline display. If that is now the computed display, syncAnalysisInline below can be simplified — but check it, do not assume it.');
assert(/function syncAnalysisInline\(key\)/.test(merge),
  'the inline-display sync is gone, so ax-3.0.0 will refuse to build the tile grid inside AI Studio');
assert(/an\.style\.display !== want\) an\.style\.display = want/.test(merge),
  'the inline-display sync no longer writes the value ax reads');

/* ---- 5. the routes that survive the fold ---------------------------------- */
assert(/\{ id: 'nav_analysis', as: '[^']+' \}/.test(shell),
  'the Tools menu no longer offers nav_analysis — folding it out of the rail without a Tools entry deletes a route');
assert(/studio: \['nav_studio', 'nav_analysis'\]/.test(shell),
  'nav_analysis no longer lights the AI Studio dock item, so every route into Practice lights the wrong destination');
assert(!/tools: \[[^\]]*'nav_analysis'/.test(shell),
  'nav_analysis is back under the Tools dock destination as well — currentDest() is last-match-wins, so it must appear in exactly one');
assert(/FOLDED_NAV=\['nav_history','nav_analysis'\]/.test(redesign),
  'nav_analysis must be FOLDED (marked, hidden, still routable), never dropped');

/* ---- 6. hiding is by class, and the switcher is the route back ------------- */
assert(!/\.style\.display\s*=\s*'none'/.test(merge.replace(/an\.style\.display = want/g, '')) ||
  /syncAnalysisInline/.test(merge),
  'sections are being hidden inline; available() reads inline display, so that would remove them from the Ask index and the control inventory too');
/* EVERY hide rule, not just one. The first version of this assertion only
   required a single `display:none!important` anywhere in the file, and a
   regression that stripped !important from one rule out of several passed it
   — caught while proving this suite in both directions, which is the whole
   argument for doing that. */
{
  /* Only the rules that fight sx and ax. Scoping matters: the first version of
     this check matched EVERY `{display:none}` in the file and flagged the
     media-query rule that hides the switcher's text hint on a phone — a rule
     that competes with nothing and correctly has no !important. A gate that
     cries wolf on healthy code trains the next person to delete it. */
  const hides = (merge.match(/^\s*(?:out\.push\(|')[^\n]*\{display:none[^}]*\}/gm) || [])
    .filter(r => /:not\(\.' \+ BODY_CLASS|BODY_CLASS \+ ':not\(|#studioTemplates/.test(r));
  assert(hides.length >= 2, 'the section hide rules are gone — found ' + hides.length);
  const weak = hides.filter(r => !/!important/.test(r));
  assert.deepStrictEqual(weak, [],
    'these section hide rules dropped !important: ' + JSON.stringify(weak) +
    ' — sx declares display:flex!important on #copilotCard and .sx-right and ax declares ' +
    'display:grid!important on #analysisView, so a plain rule loses silently and this module ' +
    'reports itself installed while doing nothing');
}
assert(/the section switcher is not visible; every section is shown/.test(merge),
  'the "a fold whose route back cannot be seen unfolds itself" invariant is gone');

/* ---- 7. it can be undone ---------------------------------------------------*/
assert(/ui=classic/.test(merge), 'the ?ui=classic escape hatch is gone');
assert(/revert: function/.test(merge), 'window.__mlsStudioMerge.revert() is gone');
assert(/wrap\.appendChild\(analysis\)/.test(merge),
  'revert() no longer puts #analysisView back where the shell expects it, so ?ui=classic leaves a half-migrated page');

/* ---- 8. run the section-membership map for real ---------------------------- */
/* Every member selector must be scoped to #studioView, or this module could
   hide another worker's screen from a config nobody would think to read. */
const memberBlock = merge.slice(merge.indexOf('var SECTIONS = ['), merge.indexOf('var KEYS ='));
const members = (memberBlock.match(/'#[^']+'/g) || []).map(s => s.slice(1, -1)).filter(s => s.indexOf('#studioView') === 0 || s.indexOf('#') === 0);
assert(members.length >= 5, 'the section membership map no longer parses — found ' + members.length);
for (const sel of members) {
  if (sel === '#copilotInput' || sel === '#studioPrompt') continue;   /* focus targets, not members */
  assert(sel.indexOf('#studioView') === 0,
    'section member "' + sel + '" is not scoped to #studioView — a section must not reach outside AI Studio');
}

/* sanity: the module parses */
new vm.Script(merge, { filename: 'feat_mls_studio_merge.js' });

console.log('PASS studio merge: showView(\'analysis\') redirects to AI Studio/Practice, ' + keys.length + ' sections, ax inline-display honoured, Tools + dock-lighting routes intact, class-hide only, revert restores the shell');
