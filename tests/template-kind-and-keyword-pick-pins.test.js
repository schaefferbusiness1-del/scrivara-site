'use strict';
/* tplpick-1.0.0 (owner 2026-08-27: "add it so u can upload multiple templates
 * in settings for all the different kinds of note generation not just one and
 * also add keyword matching so it picks the correct template").
 *
 * Multi-upload already shipped. What did not: the library was ONE
 * undifferentiated pool scored against every note kind, so a SOAP generation
 * could be handed an op-note template; a keyword stored as "TFESI" could never
 * match, because the haystack was lowercased and the keyword was not; a bare
 * substring counted, so "esi" matched "obesity"; and ties fell to upload order.
 *
 * This suite EXECUTES the real picker lifted out of the shipped shell - not a
 * transcription of it - and pins:
 *   - the right template wins on the doctor's own keywords, and the receipt
 *     names which keywords won it;
 *   - the tiebreak is a deterministic TOTAL order: the same library in any
 *     upload order picks the same template;
 *   - no match is not a guess - the caller falls through to the doctor's
 *     default template, or to nothing, exactly as it did before this existed;
 *   - a legacy single-template library keeps behaving identically;
 *   - the picker never runs, compiles or renders anything out of a template.
 *     A library imported from fifty PDFs is untrusted data.
 * Both shells carry identical wiring. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const shell = fs.readFileSync(path.join(root, SHELLS[0]), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

/* ===== lift the REAL picker out of the shipped shell ===================== */
function sliceBetween(text, from, to, label) {
  const a = text.indexOf(from);
  assert.ok(a > 0, label + ': the opening anchor moved - ' + from);
  const b = text.indexOf(to, a);
  assert.ok(b > a, label + ': the closing anchor moved - ' + to);
  return text.slice(a, b);
}

const PICKER_SRC = sliceBetween(shell,
  "var MLS_TPL_KINDS=['soap','insurance','op'];",
  '/* Which kind of note the generator is about to produce',
  'picker block');

const picker = new Function(PICKER_SRC + '\nreturn {MLS_TPL_KINDS:MLS_TPL_KINDS,'
  + '_mlsTplKindOf:_mlsTplKindOf,_mlsTplKindLabel:_mlsTplKindLabel,'
  + '_mlsTplKeywords:_mlsTplKeywords,_mlsTplNameWords:_mlsTplNameWords,'
  + '_mlsTplHit:_mlsTplHit,_mlsTplBeats:_mlsTplBeats,'
  + '_mlsTplPick:_mlsTplPick,_mlsTplPickSentence:_mlsTplPickSentence};')();

const pick = picker._mlsTplPick;
const kindOf = picker._mlsTplKindOf;
const sentence = picker._mlsTplPickSentence;

/* ===== the library the rest of this suite scores against ================= */
const TFESI = { id: 't1', name: 'Lumbar transforaminal ESI', keywords: ['tfesi', 'transforaminal', 'l5-s1'], text: 'PROCEDURE: ...', kind: 'op' };
const GENIC = { id: 't2', name: 'Genicular nerve block', keywords: ['genicular', 'knee'], text: 'PROCEDURE: ...', kind: 'op' };
const SOAPT = { id: 't3', name: 'Office follow-up', keywords: ['follow-up', 'knee'], text: 'SUBJECTIVE: ...', kind: 'soap' };
const LEGACY = { id: 't4', name: 'Old import', keywords: ['knee'], text: 'anything' };   /* no kind: competes everywhere */
const LIB = [TFESI, GENIC, SOAPT, LEGACY];

/* ---- 1. the right template wins, and the receipt says WHY --------------- */
let r = pick(LIB, { procedure: 'Left L5-S1 transforaminal epidural steroid injection', reason: '', transcript: '' }, 'op');
eq(r.reason, 'matched', 'a named procedure did not match any template');
eq(r.id, 't1', 'the procedure title did not pick the TFESI template');
eq(r.matched, ['transforaminal', 'l5-s1'], 'the receipt did not name exactly the keywords that hit');
ok(r.score > 0, 'a match scored zero');

/* ---- 2. THE UPPERCASE-KEYWORD BUG: "TFESI" could never match ------------ */
const SHOUTED = { id: 'u1', name: 'Shouted', keywords: ['TFESI', 'Transforaminal'], text: 'x' };
r = pick([SHOUTED], { procedure: '', reason: '', transcript: 'patient had a tfesi today' }, '');
eq(r.id, 'u1', 'a keyword stored in capitals still cannot match lowercase text');
eq(r.matched, ['tfesi'], 'the capitalized keyword was not normalized in the receipt');

/* ---- 3. THE SUBSTRING BUG: "esi" must not match "obesity" --------------- */
const ESI = { id: 'e1', name: 'ESI', keywords: ['esi'], text: 'x' };
eq(pick([ESI], { transcript: 'history of obesity and back pain' }, '').reason, 'no-match',
  '"esi" matched inside "obesity" - the word-boundary test is gone');
eq(pick([ESI], { transcript: 'lumbar esi performed' }, '').id, 'e1',
  '"esi" as its own word no longer matches');
/* a keyword carrying its own punctuation must still match */
eq(pick([{ id: 'p1', name: 'Level', keywords: ['l4-l5', 'c5-6'], text: 'x' }],
  { transcript: 'injection at l4-l5 today' }, '').matched, ['l4-l5'],
  'a hyphenated keyword stopped matching');

/* ---- 4. WHERE a keyword hits outranks THAT it hit ----------------------- */
const A = { id: 'a', name: 'Alpha', keywords: ['knee'], text: 'x' };
const B = { id: 'b', name: 'Bravo', keywords: ['shoulder'], text: 'x' };
r = pick([A, B], { procedure: 'shoulder injection', reason: '', transcript: 'knee knee knee' }, '');
eq(r.id, 'b', 'a transcript mention outranked the scheduled procedure title');
r = pick([A, B], { procedure: '', reason: 'shoulder pain', transcript: 'knee pain' }, '');
eq(r.id, 'b', 'a transcript mention outranked the booking reason');

/* ---- 5. THE KIND GATE: a declared template competes for that kind only -- */
r = pick(LIB, { transcript: 'knee pain follow-up visit' }, 'soap');
ok(r.id !== 't2', 'an op-note template was offered to a SOAP generation');
eq(r.id, 't3', 'the SOAP-declared template did not win its own kind');
r = pick(LIB, { transcript: 'knee pain follow-up visit' }, 'op');
ok(r.id !== 't3', 'a SOAP template was offered to an op-note generation');
/* an UNDECLARED template competes for every kind - every existing library */
eq(pick([LEGACY], { transcript: 'knee pain' }, 'soap').id, 't4', 'an undeclared template lost the SOAP kind');
eq(pick([LEGACY], { transcript: 'knee pain' }, 'op').id, 't4', 'an undeclared template lost the op kind');
eq(pick([LEGACY], { transcript: 'knee pain' }, 'insurance').id, 't4', 'an undeclared template lost the insurance kind');
/* a library with nothing of this kind says so, and picks nothing */
r = pick([TFESI], { transcript: 'transforaminal' }, 'soap');
eq(r.reason, 'no-candidate-of-this-kind', 'a kind with no candidates did not name itself');
eq(r.template, null, 'a kind with no candidates still returned a template');
eq(r.considered, 0, 'a skipped template was counted as considered');
/* an unknown/absent kind gates nothing */
eq(pick(LIB, { transcript: 'transforaminal' }, '').id, 't1', 'an unspecified kind wrongly gated the library');
eq(pick(LIB, { transcript: 'transforaminal' }, 'nonsense').id, 't1', 'an unrecognized kind was not treated as ungated');

/* ---- 6. THE TIEBREAK IS A DETERMINISTIC TOTAL ORDER --------------------- */
const T1 = { id: 'z9', name: 'Zulu', keywords: ['knee'], text: 'x' };
const T2 = { id: 'a1', name: 'Alpha', keywords: ['knee'], text: 'x' };
const T3 = { id: 'm5', name: 'Mike', keywords: ['knee'], text: 'x' };
eq(pick([T1, T2, T3], { transcript: 'knee' }, '').id, 'a1', 'an exact tie did not fall to the alphabetically first name');
/* and it does not depend on upload order - the old bug was library order */
const perms = [[T1, T2, T3], [T2, T3, T1], [T3, T1, T2], [T3, T2, T1], [T2, T1, T3], [T1, T3, T2]];
perms.forEach(function (p, i) {
  eq(pick(p, { transcript: 'knee' }, '').id, 'a1', 'upload order ' + i + ' changed the winner');
});
/* "most specific" = most keywords matched, ahead of the alphabetical fall */
const BROAD = { id: 'b1', name: 'Aaa broad', keywords: ['knee'], text: 'x' };
const SPECIFIC = { id: 's1', name: 'Zzz specific', keywords: ['knee', 'genicular'], text: 'x' };
r = pick([BROAD, SPECIFIC], { transcript: 'genicular knee block' }, '');
eq(r.id, 's1', 'the broader template beat the more specific one');
eq(r.matched.length, 2, 'the more specific winner did not report both keywords');
/* a declared kind outranks an undeclared one at equal score */
const DECL = { id: 'zz', name: 'Zzz declared', keywords: ['knee'], text: 'x', kind: 'soap' };
const UNDECL = { id: 'aa', name: 'Aaa undeclared', keywords: ['knee'], text: 'x' };
eq(pick([UNDECL, DECL], { transcript: 'knee' }, 'soap').id, 'zz',
  'a template that declares this kind did not outrank an undeclared one');
/* two records identical but for id still resolve, and always the same way */
const D1 = { id: 'id-b', name: 'Same', keywords: ['knee'], text: 'x' };
const D2 = { id: 'id-a', name: 'Same', keywords: ['knee'], text: 'x' };
eq(pick([D1, D2], { transcript: 'knee' }, '').id, 'id-a', 'the id is not the final total-order tiebreak');
eq(pick([D2, D1], { transcript: 'knee' }, '').id, 'id-a', 'the id tiebreak is order-dependent');

/* ---- 7. NO MATCH IS NOT A GUESS ---------------------------------------- */
r = pick(LIB, { transcript: 'nothing in this sentence resembles the library' }, 'op');
eq(r.template, null, 'a zero-score library still produced a pick');
eq(r.reason, 'no-match', 'a zero-score library did not report no-match');
eq(r.matched, [], 'a no-match receipt carried matched keywords');
eq(pick([], { transcript: 'knee' }, '').reason, 'no-templates', 'an empty library did not report no-templates');
eq(pick(null, { transcript: 'knee' }, '').template, null, 'a null library threw or picked');

/* ---- 8. THE PICKER IS PURE - _tplStore hands out the SHARED cached array  */
const before = JSON.stringify(LIB);
pick(LIB, { procedure: 'transforaminal', reason: 'knee', transcript: 'genicular' }, 'op');
eq(JSON.stringify(LIB), before, 'the picker mutated the library it was given');

/* ---- 9. THE PICKER NEVER RUNS CODE FROM A TEMPLATE ---------------------- */
/* the source itself: no interpreter, no compiler, no HTML sink */
[['eval(', 'eval'], ['new Function', 'Function compiler'], ['innerHTML', 'an HTML sink'],
 ['new RegExp', 'a RegExp compiled from data'], ['setTimeout', 'a deferred string'],
 ['document.', 'the DOM']].forEach(function (pair) {
  ok(PICKER_SRC.indexOf(pair[0]) === -1, 'the picker reaches for ' + pair[1] + ' (' + pair[0] + ')');
});
/* and executed: hostile records must be inert DATA */
const HOSTILE = [
  { id: 'h1', name: '</script><img src=x onerror=alert(1)>', keywords: ['alert(1)'], text: 'eval("globalThis.PWNED=1")' },
  { id: 'h2', name: '${globalThis.PWNED2=1}', keywords: ['c++', 'a(b', '[z-a]', '\\'], text: 'x' },
  { id: 'h3', name: 'proto', keywords: ['__proto__', 'constructor', 'prototype'], text: 'x' },
  { id: 'h4', name: 'Nulls', keywords: [null, undefined, '', '   ', 'real'], text: 'x' }
];
let threw = null;
try {
  r = pick(HOSTILE, { procedure: 'c++ and a(b and [z-a]', reason: '__proto__ constructor', transcript: 'real alert(1)' }, '');
} catch (e) { threw = e; }
eq(threw, null, 'a hostile template record threw: ' + (threw && threw.message));
eq(typeof globalThis.PWNED, 'undefined', 'template TEXT executed');
eq(typeof globalThis.PWNED2, 'undefined', 'a template NAME was interpolated');
eq(({}).polluted, undefined, 'the prototype was polluted by a keyword');
eq(Object.prototype.hasOwnProperty.call({}, '__proto__'), false, 'a "__proto__" keyword became an own property');
/* regex-special keywords still match LITERALLY - proof they were never compiled */
r = pick([HOSTILE[1]], { transcript: 'we used c++ here' }, '');
eq(r.matched, ['c++'], 'a keyword with regex metacharacters stopped matching literally');
r = pick([HOSTILE[1]], { transcript: 'the token a(b appears' }, '');
eq(r.matched, ['a(b'], 'an unbalanced-paren keyword stopped matching literally');
/* a "[z-a]" keyword would be an INVALID RegExp - matching it proves no compile */
r = pick([HOSTILE[1]], { transcript: 'literally [z-a] here' }, '');
eq(r.matched, ['[z-a]'], 'a keyword that is an invalid RegExp did not match literally');
/* empty and null keywords are dropped, not matched */
r = pick([HOSTILE[3]], { transcript: 'real thing' }, '');
eq(r.matched, ['real'], 'blank or null keywords were treated as matches');

/* ---- 10. KIND NORMALIZATION - the store can only hold four values ------- */
eq(picker.MLS_TPL_KINDS, ['soap', 'insurance', 'op'], 'the declared kind vocabulary changed');
[['soap', 'soap'], ['  OP  ', 'op'], ['Insurance', 'insurance'], ['', ''], ['nonsense', ''],
 [null, ''], [undefined, ''], ['<script>', '']].forEach(function (pair) {
  eq(kindOf({ kind: pair[0] }), pair[1], 'kind ' + JSON.stringify(pair[0]) + ' did not normalize to ' + JSON.stringify(pair[1]));
});
eq(kindOf(null), '', 'a null template threw on kind normalization');
eq(kindOf({}), '', 'a template with no kind is not treated as "any"');
/* every kind has a label the doctor can read, and "any" is not blank */
['', 'soap', 'insurance', 'op'].forEach(function (k) {
  ok(picker._mlsTplKindLabel(k).length > 3, 'kind ' + JSON.stringify(k) + ' has no readable label');
});
eq(picker._mlsTplKindLabel(''), 'Any note kind', 'the undeclared label stopped saying "any"');

/* ---- 11. THE RECEIPT NAMES THE TEMPLATE AND THE KEYWORDS THAT WON ------- */
r = pick(LIB, { procedure: 'Left L5-S1 transforaminal epidural steroid injection' }, 'op');
const s = sentence(r);
ok(s.indexOf('Lumbar transforaminal ESI') !== -1, 'the receipt does not name the template');
ok(s.indexOf('transforaminal') !== -1 && s.indexOf('l5-s1') !== -1, 'the receipt does not name the matched keywords');
ok(s.indexOf('Op / procedure note') !== -1, 'the receipt does not name the note kind');
eq(sentence(pick(LIB, { transcript: 'unrelated' }, 'op')), '', 'a no-match produced a receipt sentence anyway');
eq(sentence(null), '', 'a null pick produced a receipt sentence');
/* a keywordless template that won on its NAME says so honestly */
r = pick([{ id: 'n1', name: 'Genicular nerve block', keywords: [], text: 'x' }], { transcript: 'genicular block today' }, '');
eq(r.matched, [], 'a name-only win claimed keyword matches');
ok(sentence(r).indexOf('matched its name') !== -1, 'a name-only win does not say it matched on the name');

/* ===== 12. THE RESOLVER, EXECUTED: no match falls to the default ========= */
const RESOLVE_SRC = sliceBetween(shell,
  'function resolveActiveTemplate(visitText){',
  '/* Reformat the just-generated note to follow a template.',
  'resolveActiveTemplate');

function runResolve(opts) {
  const calls = { toasts: [], receiptFallback: 'unset', pickArgs: null };
  const fn = new Function('window', 'useTemplatesOn', 'templateAutoOn', 'pickTemplateForVisit',
    '_mlsVisitTemplateContext', '_mlsCurrentNoteKind', '_mlsTplPickSentence', '_mlsRenderTplPickReceipt',
    'getTemplateById', 'getActiveTemplateId', 'toast',
    RESOLVE_SRC + '\nreturn resolveActiveTemplate;')(
    { __mlsLastTemplatePick: opts.receipt || null },
    function () { return opts.on !== false; },
    function () { return opts.auto === true; },
    function (t, ctx, kind) { calls.pickArgs = { text: t, ctx: ctx, kind: kind }; return opts.picked || null; },
    function (t) { return { procedure: opts.procedure || '', reason: opts.reason || '', transcript: String(t || '') }; },
    function () { return opts.kind || 'soap'; },
    sentence,
    function (fb) { calls.receiptFallback = fb === undefined ? 'none' : fb; return ''; },
    function (id) { return opts.byId && opts.byId[id] ? opts.byId[id] : null; },
    function () { return opts.activeId || ''; },
    function (m) { calls.toasts.push(String(m)); });
  calls.result = fn('the transcript');
  return calls;
}

/* toggle OFF: nothing at all, exactly as before */
let c = runResolve({ on: false, auto: true, picked: TFESI, activeId: 't4', byId: { t4: LEGACY } });
eq(c.result, null, 'the OFF toggle no longer short-circuits');
eq(c.toasts.length, 0, 'the OFF toggle toasted');
eq(c.receiptFallback, 'unset', 'the OFF toggle rendered a receipt');

/* auto ON + a match: the pick wins and the doctor is told which keywords won */
c = runResolve({ auto: true, picked: TFESI, receipt: { reason: 'matched', name: TFESI.name, kind: 'op', matched: ['transforaminal'], matchedName: [] }, activeId: 't4', byId: { t4: LEGACY } });
eq(c.result.id, 't1', 'auto-choose no longer returns the picked template');
eq(c.toasts.length, 1, 'auto-choose did not announce the pick exactly once');
ok(c.toasts[0].indexOf('transforaminal') !== -1, 'the announcement does not name the matched keyword');
ok(c.toasts[0].indexOf(TFESI.name) !== -1, 'the announcement does not name the template');
/* the pick is handed the visit CONTEXT and the note KIND, not just the text */
eq(c.pickArgs.kind, 'soap', 'the note kind was not passed to the picker');
eq(c.pickArgs.ctx.transcript, 'the transcript', 'the transcript was not passed to the picker');
ok('reason' in c.pickArgs.ctx && 'procedure' in c.pickArgs.ctx, 'the picker was not given a visit context');

/* auto ON + NO match: falls to the doctor's default template - not a guess */
c = runResolve({ auto: true, picked: null, activeId: 't4', byId: { t4: LEGACY } });
eq(c.result.id, 't4', 'a no-match did not fall back to the default template');
eq(c.toasts.length, 0, 'a no-match announced a pick anyway');
eq(c.receiptFallback.id, 't4', 'the receipt was not told which default was used');

/* auto ON + no match + NO default: nothing. Never an invented template. */
c = runResolve({ auto: true, picked: null, activeId: '', byId: {} });
eq(c.result, null, 'a no-match with no default invented a template');
eq(c.receiptFallback, null, 'the receipt was not told that nothing was used');

/* auto OFF: the doctor's default, and the picker is NEVER consulted --------
   this is the legacy single-template user, unchanged. */
c = runResolve({ auto: false, picked: TFESI, activeId: 't4', byId: { t4: LEGACY } });
eq(c.result.id, 't4', 'auto-choose OFF stopped honoring the default template');
eq(c.pickArgs, null, 'auto-choose OFF still ran the keyword picker');
eq(c.toasts.length, 0, 'auto-choose OFF announced a pick');

/* A STALE RECEIPT MUST NOT SURVIVE INTO THE NEXT GENERATION. With auto-choose
   OFF the picker never runs, so whatever an earlier generation left on the
   window would otherwise name a template THIS note never saw. */
const STALE = { reason: 'matched', name: 'From a previous visit', kind: 'op', matched: ['tfesi'], matchedName: [] };
c = runResolve({ auto: false, receipt: STALE, picked: null, activeId: 't4', byId: { t4: LEGACY } });
eq(c.result.id, 't4', 'auto-choose OFF stopped honoring the default template');
eq(c.receiptFallback.id, 't4', 'the receipt was not told which default was used');
/* the resolver clears the previous decision before making a new one */
ok(RESOLVE_SRC.indexOf('window.__mlsLastTemplatePick=null') !== -1,
  'the resolver no longer clears a previous generation\'s pick receipt');

/* ===== 13. THE RECEIPT RENDERER IS A TEXT SINK, EXECUTED ================= */
const RENDER_SRC = sliceBetween(shell,
  'function _mlsRenderTplPickReceipt(fallbackTpl){',
  '/* Reformat the just-generated note to follow a template.',
  '_mlsRenderTplPickReceipt');

function runRender(opts) {
  const el = { textContent: '', style: {} };
  Object.defineProperty(el, 'innerHTML', {
    set: function () { throw new Error('the receipt wrote innerHTML'); },
    get: function () { return undefined; }
  });
  const fn = new Function('window', 'document', 'useTemplatesOn', '_mlsTplPickSentence',
    RENDER_SRC + '\nreturn _mlsRenderTplPickReceipt;')(
    { __mlsLastTemplatePick: opts.receipt || null },
    { getElementById: function (id) { return id === 'tplPickReceipt' ? el : null; } },
    function () { return opts.on !== false; },
    sentence);
  const out = fn(opts.fallback);
  return { el: el, out: out };
}

let v = runRender({ receipt: { reason: 'matched', name: 'Lumbar TFESI', kind: 'op', matched: ['tfesi'], matchedName: [] } });
ok(v.el.textContent.indexOf('Lumbar TFESI') !== -1, 'the rendered receipt does not name the template');
ok(v.el.textContent.indexOf('tfesi') !== -1, 'the rendered receipt does not name the matched keyword');
eq(v.el.style.display, '', 'a receipt with content stayed hidden');
/* a hostile template NAME lands as text, never as markup */
v = runRender({ receipt: { reason: 'matched', name: '<img src=x onerror=alert(1)>', kind: '', matched: ['x'], matchedName: [] } });
ok(v.el.textContent.indexOf('<img src=x onerror=alert(1)>') !== -1, 'a hostile name was not written verbatim as text');
/* no match, with a default: says which default, plainly */
v = runRender({ receipt: { reason: 'no-match', name: '', matched: [], matchedName: [] }, fallback: { name: 'My default' } });
ok(v.el.textContent.indexOf('My default') !== -1, 'the receipt does not name the default that was used');
ok(v.el.textContent.indexOf('No template matched') !== -1, 'the receipt does not admit that nothing matched');
/* THE FALLBACK ARGUMENT OUTRANKS ANY PICK ON THE WINDOW. It is only passed on
   the path that really used the default, so a stale receipt from an earlier
   generation must never name a template THIS note never saw. */
v = runRender({ receipt: STALE, fallback: { name: 'My default' } });
ok(v.el.textContent.indexOf('My default') !== -1, 'a stale pick outranked the default that was really used');
ok(v.el.textContent.indexOf('From a previous visit') === -1, 'a previous visit\'s template is still named on this note');
/* no match, no default: says the note was left alone - never silent */
v = runRender({ receipt: { reason: 'no-match', name: '', matched: [], matchedName: [] } });
ok(v.el.textContent.indexOf('left unformatted') !== -1, 'the receipt does not say the note was left unformatted');
/* no template of this kind names that specific reason */
v = runRender({ receipt: { reason: 'no-candidate-of-this-kind', name: '', matched: [], matchedName: [] } });
ok(v.el.textContent.indexOf('this note kind') !== -1, 'the receipt does not name an empty note kind');
/* templates OFF, or an empty library: no receipt at all */
v = runRender({ on: false, receipt: { reason: 'matched', name: 'X', kind: '', matched: ['x'], matchedName: [] } });
eq(v.el.textContent, '', 'a receipt was shown with templates OFF');
eq(v.el.style.display, 'none', 'the receipt element stayed visible with templates OFF');
v = runRender({ receipt: { reason: 'no-templates', name: '', matched: [], matchedName: [] } });
eq(v.el.textContent, '', 'an empty library produced a receipt');

/* ===== 14. BOTH SHELLS, AND THE SETTINGS SURFACE ========================= */
SHELLS.forEach(function (name) {
  const text = fs.readFileSync(path.join(root, name), 'utf8');
  /* the picker itself, byte-identical in both shells */
  ok(text.indexOf(PICKER_SRC) !== -1, name + ': the picker block differs between the shells');
  ok(text.indexOf(RESOLVE_SRC) !== -1, name + ': resolveActiveTemplate differs between the shells');
  /* the doctor can DECLARE the kind in Settings, and it is normalized on save */
  ok(text.indexOf('<label for="tplDetKind">Note kind this template is for</label>') !== -1,
    name + ': the Settings note-kind selector is gone');
  ok(text.indexOf("cur.kind=_mlsTplKindOf({kind:String((document.getElementById('tplDetKind')||{}).value||'')});") !== -1,
    name + ': the note kind is no longer normalized on save');
  /* keywords stay a doctor-editable, comma-separated field */
  ok(text.indexOf('<label for="tplDetKw">Keywords') !== -1, name + ': the keywords field is gone');
  ok(text.indexOf("cur.keywords=String((document.getElementById('tplDetKw')||{}).value||'').split(',')") !== -1,
    name + ': keywords stopped being comma-separated');
  /* restoring a pre-kind revision must not silently un-declare the kind */
  ok(text.indexOf('if(r.kind!==undefined) cur.kind=_mlsTplKindOf(r);') !== -1,
    name + ': restoring an old revision can wipe a declared note kind');
  /* the receipt surface exists where the note is */
  ok(text.indexOf('<div id="tplPickReceipt"') !== -1, name + ': the pick receipt element is gone');
  ok(/id="tplPickReceipt"[^>]*aria-live="polite"/.test(text), name + ': the pick receipt is not announced');
  /* multi-upload - the thing that already worked - is untouched */
  ok(text.indexOf('id="tplMultiFileInput"') !== -1, name + ': the multi-template upload input disappeared');
  ok(text.indexOf('multiple style="display:none" onchange="tplMultiFile(event)"') !== -1,
    name + ': the multi-file upload stopped accepting many files');
  /* the ONE write door still owns every template write */
  ok(text.indexOf('function setTemplates(arr){') !== -1, name + ': the single template write door moved');
  /* a pick that never reached the note stops claiming the note */
  ok(text.indexOf('was not applied - the note is unchanged.') !== -1,
    name + ': a failed application leaves a receipt that still claims the note');
});

/* the kind rides inside the templates JSON that already syncs - no new key */
ok(shell.indexOf("'useTemplates','templateActive','templateAuto','intakeQuestions','templates',") !== -1,
  'the templates prefs-sync allowlist moved; a per-template kind must ride inside it');
ok(PICKER_SRC.indexOf('localStorage') === -1, 'the picker reads storage directly instead of being handed the library');

console.log('PASS template kind + keyword pick (tplpick-1.0.0): ' + checks + ' checks - the REAL picker, '
  + 'lifted out of the shipped shell and executed, picks the right template on the doctor\'s own keywords '
  + '(uppercase keywords now match; "esi" no longer matches "obesity"; the scheduled procedure outranks the '
  + 'transcript), gates every candidate by the note kind the doctor declared in Settings while undeclared '
  + 'legacy templates still compete for all of them, and breaks ties by a total order that is identical under '
  + 'all six upload permutations. No match is not a guess: the executed resolver falls to the doctor\'s default '
  + 'or to nothing, never consults the picker when auto-choose is off, and the executed receipt says which '
  + 'template won and which keywords won it - as text, never markup. Hostile template records (invalid-RegExp, '
  + 'unbalanced-paren and "__proto__" keywords, script tags in names, eval() in bodies) stay inert DATA.');
