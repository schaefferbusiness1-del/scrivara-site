'use strict';
/* tplauto-1.0.0 (owner 2026-08-27, looking at the new "Use automatically when"
 * field: "this should be able to auto generate when it thinks it will be
 * used").
 *
 * He was being asked to hand-type the words that decide when a template is
 * picked. The template already contains the words that name it. This suite
 * EXECUTES the real extractor and the real settings editor lifted out of the
 * shipped shell - not a transcription of them - and pins:
 *
 *   - a suggestion is a SUBSET of the template's own text. Nothing is ever
 *     invented: every term comes back out of the template it was read from;
 *   - DISTINCTIVENESS decides the order. A term carried by every other
 *     template cannot tell two templates apart and is dropped outright; a rare
 *     term beats a common one at the same weight;
 *   - furniture, two-character words and pure numbers never survive, and the
 *     list is capped;
 *   - the prefill happens ONLY into an empty field, ONCE. A field the doctor
 *     cleared stays cleared - across a re-render, and across a save;
 *   - the explicit control re-suggests on demand, over the top;
 *   - an ambiguous note kind stays UNSET, which competes for every kind and is
 *     the safe answer;
 *   - a suggestion is DATA. A template carrying script-ish and regex-ish text
 *     is treated literally: nothing is eval'd, compiled into a RegExp, or
 *     written as markup, and a "__proto__" term is an ordinary key;
 *   - the draft-tuning "Use automatically when" field - the field he was
 *     actually looking at - reaches the SHELL's extractor at runtime, in a
 *     real browser, and fills itself.
 *
 * Both shells carry identical wiring, and the feature module's derived twins
 * carry it too.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
const shell = fs.readFileSync(path.join(root, SHELLS[0]), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks++; }

function sliceBetween(text, from, to, label) {
  const a = text.indexOf(from);
  assert.ok(a > 0, label + ': the opening anchor moved - ' + from);
  const b = text.indexOf(to, a);
  assert.ok(b > a, label + ': the closing anchor moved - ' + to);
  return text.slice(a, b);
}

/* ===== lift the REAL code out of the shipped shell ======================= */
const BLOCK_ANCHORS = [
  ["var MLS_TPL_SUGGEST_VERSION='tplauto-1.0.0';", '/* ===== tplpick-1.0.0', 'suggester'],
  ["var MLS_TPL_KINDS=['soap','insurance','op'];", '/* Which kind of note the generator is about to produce', 'picker'],
  ["var _tplUI={ selectedId:", 'var _tplLastDeleted=null;', 'editor state'],
  ['function renderTplDetail(){', 'function tplDetailSave(){', 'detail pane'],
  ['function tplDetailSave(){', 'async function tplRestoreRevision(', 'detail save'],
  ['function _tplSeedKeywords(t,library){', 'var _TPL_AI_LIMIT=4;', 'import seed']
];
const BLOCKS = BLOCK_ANCHORS.map(([a, b, label]) => sliceBetween(shell, a, b, label));
const SUGGESTER_SRC = BLOCKS[0];

/* THE SECOND SHELL IS THE SAME SHELL. A fix that lands in one and not the
   other is a fix half the doctors never get. */
{
  const twin = fs.readFileSync(path.join(root, SHELLS[1]), 'utf8');
  BLOCK_ANCHORS.forEach(([a, b, label], i) => {
    eq(sliceBetween(twin, a, b, label + ' (twin)'), BLOCKS[i],
      '1p/index.html carries a DIFFERENT ' + label + ' block than 1pScribeFlow.html');
  });
}

/* ===== a minimal, honest DOM for the lifted editor ======================= */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function unescHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const EDITOR_IDS = ['tplDetail', 'tplDetName', 'tplDetKw', 'tplKwWhy', 'tplDetKind',
  'tplDetKindWhy', 'tplDetText', 'tplDetStatus', 'tplDetRev'];

function newHarness(templates) {
  const dom = Object.create(null);
  EDITOR_IDS.forEach(id => { dom[id] = { id, value: '', textContent: '', innerHTML: '', style: {} }; });
  const store = JSON.parse(JSON.stringify(templates || []));
  const toasts = [];
  const document = { getElementById(id) { return Object.prototype.hasOwnProperty.call(dom, id) ? dom[id] : null; } };
  const win = {};
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const api = new Function(
    'document', 'window', '_tplStore', 'getTemplates', 'setTemplates', 'getTemplateById',
    'getActiveTemplateId', 'esc', 'toast', 'renderTemplateList', 'renderTemplateActiveSelect',
    BLOCKS.join('\n')
    + '\nreturn {renderTplDetail:renderTplDetail,tplDetailSave:tplDetailSave,'
    + 'tplSuggestKeywords:tplSuggestKeywords,tplKwTyped:tplKwTyped,'
    + '_tplRenderSuggestNotes:_tplRenderSuggestNotes,_tplSeedKeywords:_tplSeedKeywords,'
    + '_tplUI:_tplUI,_tplSuggestOnce:_tplSuggestOnce,_tplSuggestLibrary:_tplSuggestLibrary,'
    + '_mlsTplSuggestFor:_mlsTplSuggestFor,_mlsTplSuggestKind:_mlsTplSuggestKind,'
    + '_mlsTplSuggestNorm:_mlsTplSuggestNorm,_mlsTplKindOf:_mlsTplKindOf};'
  )(
    document, win,
    () => store,
    () => clone(store),
    list => { store.length = 0; (list || []).forEach(t => store.push(t)); },
    id => { const hit = store.find(t => t && t.id === id); return hit ? clone(hit) : null; },
    () => '',
    escHtml,
    (msg, kind) => toasts.push({ msg: String(msg), kind: String(kind || '') }),
    () => {}, () => {}
  );
  /* What a browser does after innerHTML: the fields the markup declares now
     hold the values the markup gave them. */
  function mount() {
    const html = dom.tplDetail.innerHTML;
    const grab = (id, attr) => {
      const m = new RegExp('id="' + id + '"[^>]*?\\s' + attr + '="([^"]*)"').exec(html);
      return m ? unescHtml(m[1]) : null;
    };
    dom.tplDetName.value = grab('tplDetName', 'value') || '';
    dom.tplDetKw.value = grab('tplDetKw', 'value') || '';
    const body = /<textarea id="tplDetText"[^>]*>([\s\S]*?)<\/textarea>/.exec(html);
    dom.tplDetText.value = body ? unescHtml(body[1]) : '';
    const selected = /<option value="([a-z]*)" selected>/.exec(html);
    dom.tplDetKind.value = selected ? selected[1] : '';
    return html;
  }
  function render(id) {
    api._tplUI.selectedId = id;
    api._tplUI.dirty = false;
    api._tplUI.renderedId = '';
    api.renderTplDetail();
    return mount();
  }
  return { api, dom, store, toasts, render, mount, window: win };
}

/* ===== 1. a suggestion is a SUBSET of the template's own text ============ */
const OP_LIBRARY = [
  { id: 'a', name: 'Right Carpal Tunnel Release', kind: '', keywords: [], text:
    'PREOPERATIVE DIAGNOSIS: Right carpal tunnel syndrome\n'
    + 'PROCEDURE PERFORMED: Endoscopic carpal tunnel release\n'
    + 'ANESTHESIA: Local with sedation\nESTIMATED BLOOD LOSS: Minimal\n'
    + 'The carpal tunnel was decompressed. The transverse carpal ligament was divided under direct vision.' },
  { id: 'b', name: 'Left Knee Genicular Nerve Block', kind: '', keywords: [], text:
    'PREOPERATIVE DIAGNOSIS: Left knee osteoarthritis\n'
    + 'PROCEDURE PERFORMED: Genicular nerve block\nANESTHESIA: Local\n'
    + 'The genicular nerve branches were targeted under fluoroscopic guidance. The genicular block was completed.' },
  { id: 'c', name: 'Lumbar Epidural Steroid Injection', kind: '', keywords: [], text:
    'PREOPERATIVE DIAGNOSIS: Lumbar radiculopathy at L4-L5\n'
    + 'PROCEDURE PERFORMED: Transforaminal epidural steroid injection\nANESTHESIA: Local\n'
    + 'Epidural spread was confirmed. Steroid was injected at L4-L5.' }
];

{
  const h = newHarness(OP_LIBRARY);
  const norm = h.api._mlsTplSuggestNorm;
  OP_LIBRARY.forEach(t => {
    const out = h.api._mlsTplSuggestFor(t, OP_LIBRARY);
    ok(out.terms.length > 0, 'no suggestion at all for "' + t.name + '"');
    const own = norm(String(t.name) + ' \n ' + String(t.text));
    out.terms.forEach(term => {
      ok(own.indexOf(term) !== -1,
        'INVENTED a term: "' + term + '" is not in "' + t.name + '" (' + JSON.stringify(out.terms) + ')');
      term.split(' ').forEach(word => {
        ok(String(t.name + ' ' + t.text).toLowerCase().indexOf(word) !== -1,
          'INVENTED a word: "' + word + '" is not in the raw text of "' + t.name + '"');
      });
    });
    ok(out.why.length > 0, 'a suggestion arrived without a reason for "' + t.name + '"');
    ok(/edit or clear them\.$/.test(out.why), 'the why line does not tell him he can clear it: ' + out.why);
  });
}

/* ===== 2. DETERMINISM: same inputs, same list, whatever the library order = */
{
  const h = newHarness(OP_LIBRARY);
  const first = h.api._mlsTplSuggestFor(OP_LIBRARY[0], OP_LIBRARY).terms;
  eq(h.api._mlsTplSuggestFor(OP_LIBRARY[0], OP_LIBRARY.slice().reverse()).terms, first,
    'the suggestion depends on the order of the library');
  eq(h.api._mlsTplSuggestFor(OP_LIBRARY[0], OP_LIBRARY).terms, first,
    'the suggestion is not stable across two identical calls');
  ok(first.indexOf('carpal tunnel') !== -1, 'the phrase that names the template did not survive: ' + JSON.stringify(first));
}

/* ===== 3. a DISTINCTIVE term beats one every template carries ============ */
{
  /* every template in this library is an epidural steroid injection; only the
     subject is a TARSAL tunnel release. "epidural" cannot tell them apart. */
  const common = 'PROCEDURE PERFORMED: Epidural steroid injection\nEpidural spread confirmed. Epidural catheter removed.';
  const lib = [
    { id: 's', name: 'Tarsal Tunnel Release With Epidural', keywords: [], text: 'Tarsal tunnel release performed. ' + common },
    { id: 'x', name: 'Cervical Epidural Steroid Injection', keywords: [], text: common },
    { id: 'y', name: 'Thoracic Epidural Steroid Injection', keywords: [], text: common },
    { id: 'z', name: 'Caudal Epidural Steroid Injection', keywords: [], text: common }
  ];
  const h = newHarness(lib);
  const out = h.api._mlsTplSuggestFor(lib[0], lib);
  ok(out.terms.indexOf('epidural') === -1,
    'a term carried by EVERY other template was suggested anyway: ' + JSON.stringify(out.terms));
  ok(out.terms.some(t => t.indexOf('tarsal') !== -1),
    'the one term that distinguishes this template was not suggested: ' + JSON.stringify(out.terms));

  /* the softer case: rare beats common at the same source weight. */
  const lib2 = [
    { id: 's2', name: 'Zygapophyseal Ablation Steroid', keywords: [], text: 'Zygapophyseal ablation. Steroid used.' },
    { id: 'p', name: 'Steroid Case One', keywords: [], text: 'Steroid used.' },
    { id: 'q', name: 'Plain Case Two', keywords: [], text: 'Nothing notable happened here.' }
  ];
  const h2 = newHarness(lib2);
  const t2 = h2.api._mlsTplSuggestFor(lib2[0], lib2).terms;
  const rare = t2.findIndex(t => t.indexOf('zygapophyseal') !== -1);
  const common2 = t2.findIndex(t => t.indexOf('steroid') !== -1);
  ok(rare !== -1, 'the rare term vanished: ' + JSON.stringify(t2));
  ok(common2 === -1 || rare < common2,
    'a term one of two other templates also carries outranked a term unique to this one: ' + JSON.stringify(t2));
}

/* ===== 4. furniture, short words and pure numbers never survive; cap holds  */
{
  const noisy = {
    id: 'n', name: 'The Patient Note 2026 ab', keywords: [], text:
      'PATIENT: \nHISTORY: \nEXAM: \nPLAN: \nDIAGNOSIS: \nPROCEDURE: \nSINCERELY,\nSIGNATURE: \n'
      + 'The patient was seen on 2026 for 12 minutes. ab xy of the note. '
      + 'Vertebroplasty was performed. Vertebroplasty cement was injected. '
      + 'Kyphoplasty balloon inflated. Kyphoplasty completed. '
      + 'Discography performed. Discography images stored. '
      + 'Rhizotomy attempted. Rhizotomy completed. '
      + 'Myelography obtained. Myelography reviewed. '
      + 'Vertebroplasty again. Kyphoplasty again. Discography again. Rhizotomy again. Myelography again. '
      + 'Sacroplasty performed. Sacroplasty finished. Chemonucleolysis performed. Chemonucleolysis finished. '
      + 'Nucleoplasty performed. Nucleoplasty finished. Annuloplasty performed. Annuloplasty finished.'
  };
  const h = newHarness([noisy]);
  const out = h.api._mlsTplSuggestFor(noisy, [noisy]);
  ok(out.terms.length <= 6, 'the cap was exceeded: ' + out.terms.length + ' ' + JSON.stringify(out.terms));
  ok(out.terms.length > 0, 'a template full of real procedure words suggested nothing');
  ['the', 'patient', 'history', 'exam', 'plan', 'note', 'procedure', 'diagnosis', 'sincerely', 'signature']
    .forEach(word => {
      ok(!out.terms.some(t => t.split(' ').indexOf(word) !== -1),
        'clinical furniture "' + word + '" was suggested: ' + JSON.stringify(out.terms));
    });
  out.terms.forEach(term => {
    term.split(' ').forEach(word => {
      ok(word.length >= 3, 'a word under three characters was suggested: "' + word + '"');
      ok(/[a-z]/.test(word), 'a pure number was suggested: "' + word + '"');
    });
  });
  ok(!out.terms.some(t => /\b(?:2026|12)\b/.test(t)), 'a bare number was suggested: ' + JSON.stringify(out.terms));
}

/* ===== 5. the prefill is EMPTY-FIELD-ONLY, and happens ONCE ============== */
{
  const lib = [
    { id: 'has-kw', name: 'Right Carpal Tunnel Release', kind: '', keywords: ['mine', 'only'], text: OP_LIBRARY[0].text },
    { id: 'no-kw', name: 'Left Knee Genicular Nerve Block', kind: '', keywords: [], text: OP_LIBRARY[1].text }
  ];
  const h = newHarness(lib);

  h.render('has-kw');
  eq(h.dom.tplDetKw.value, 'mine, only', 'the doctor\'s own keywords were overwritten by a suggestion');
  eq(h.dom.tplKwWhy.textContent, '', 'a filled field was given a "suggested" line');
  eq(h.dom.tplKwWhy.style.display, 'none', 'the why line is showing over a field nothing was suggested for');

  h.render('no-kw');
  ok(h.dom.tplDetKw.value.length > 0, 'an EMPTY keywords field was left empty - nothing was suggested');
  ok(h.dom.tplKwWhy.textContent.indexOf('Suggested from') === 0,
    'the prefill arrived without saying it was a suggestion: ' + JSON.stringify(h.dom.tplKwWhy.textContent));
  eq(h.dom.tplKwWhy.style.display, '', 'the why line was not shown for a prefilled field');
  const suggested = h.dom.tplDetKw.value;

  /* nothing was STORED by the proposal: it is a prefilled input he must save */
  eq(h.store.find(t => t.id === 'no-kw').keywords, [],
    'the suggestion wrote itself into the stored template without a save');

  /* ONCE. He clears it, the pane re-renders (a search keystroke, a list
     refresh) and the field must stay exactly as he left it. */
  h.dom.tplDetKw.value = '';
  h.api.tplKwTyped();
  h.api._tplUI.selectedId = 'no-kw'; h.api._tplUI.dirty = false; h.api._tplUI.renderedId = '';
  h.api.renderTplDetail();
  h.mount();
  eq(h.dom.tplDetKw.value, '', 'a field the doctor CLEARED was refilled by the next render');
  eq(h.dom.tplKwWhy.textContent, '', 'the why line came back over a field he had cleared');

  /* and across a save: the cleared field is stored empty, latched, and a
     brand-new session (a fresh once-latch) still does not refill it. */
  h.api.tplDetailSave();
  const stored = h.store.find(t => t.id === 'no-kw');
  eq(stored.keywords, [], 'the cleared field did not save as empty');
  eq(stored.autoKw, 1, 'the save did not record that he decided about this field');
  eq(stored.kwSuggested, 0, 'an empty field was recorded as still being the suggestion');

  const fresh = newHarness(h.store);
  fresh.render('no-kw');
  eq(fresh.dom.tplDetKw.value, '', 'a NEW session re-suggested into a field he had cleared and saved');
  eq(fresh.dom.tplKwWhy.textContent, '', 'a NEW session showed a why line over a field he had cleared and saved');

  /* ===== 6. the explicit control re-suggests, over the top ============== */
  fresh.dom.tplDetName.value = stored.name;
  fresh.dom.tplDetText.value = stored.text;
  fresh.api._tplUI.selectedId = 'no-kw';
  fresh.api.tplSuggestKeywords();
  eq(fresh.dom.tplDetKw.value, suggested,
    'the explicit control did not reproduce the suggestion it had made before');
  ok(fresh.dom.tplKwWhy.textContent.indexOf('Suggested from') === 0,
    'the explicit control filled the field without saying why');
  eq(fresh.api._tplUI.dirty, true, 'the explicit control left the editor looking saved');
  eq(fresh.dom.tplDetStatus.textContent, 'Suggested - not saved yet',
    'the status line does not say the suggestion is unsaved: ' + fresh.dom.tplDetStatus.textContent);

  /* it overwrites, because he asked for it */
  fresh.dom.tplDetKw.value = 'something he typed';
  fresh.api.tplSuggestKeywords();
  eq(fresh.dom.tplDetKw.value, suggested, 'the explicit control refused to overwrite when he asked for it');

  /* and a save that keeps the suggestion records it as one */
  fresh.api.tplDetailSave();
  const kept = fresh.store.find(t => t.id === 'no-kw');
  eq(kept.keywords.join(', '), suggested, 'the accepted suggestion did not save');
  eq(kept.kwSuggested, 1, 'an accepted suggestion was not recorded as suggested');
  eq(kept.autoKw, 1, 'the save did not latch the field');
}

/* ===== 7. the note KIND: named unambiguously, or left unset ============== */
{
  const h = newHarness([]);
  const kindOf = h.api._mlsTplSuggestKind;
  eq(kindOf('PREOPERATIVE DIAGNOSIS: x\nPROCEDURE PERFORMED: y\nANESTHESIA: local'), 'op',
    'an operative note did not read as an operative note');
  eq(kindOf('SUBJECTIVE:\nOBJECTIVE:\nASSESSMENT AND PLAN:'), 'soap',
    'a SOAP shell did not read as a SOAP note');
  eq(kindOf('This letter documents medical necessity. Policy number:\nMember ID:'), 'insurance',
    'a medical-necessity letter did not read as an insurance note');
  /* AMBIGUOUS -> UNSET. Unset already competes for every kind, which is the
     safe answer; guessing here is how the wrong template ships. */
  eq(kindOf('PREOPERATIVE DIAGNOSIS: x\nPROCEDURE PERFORMED: y\n'
    + 'This letter documents medical necessity for the payer. Policy number:'), '',
    'a template that names TWO kinds was assigned one of them anyway');
  eq(kindOf('ANESTHESIA: local\nINFORMED CONSENT: obtained'), '',
    'supporting words alone were enough to declare a kind');
  eq(kindOf('Follow-up in three months. Continue current treatment.'), '',
    'an ordinary paragraph was assigned a note kind');
  eq(kindOf(''), '', 'an empty template was assigned a note kind');

  /* the pane offers it, and only into an UNSET kind */
  const unset = { id: 'u', name: 'Right Carpal Tunnel Release', kind: '', keywords: [], text: OP_LIBRARY[0].text };
  const declared = { id: 'd', name: 'Right Carpal Tunnel Release', kind: 'soap', keywords: [], text: OP_LIBRARY[0].text };
  const h2 = newHarness([unset, declared]);
  h2.render('u');
  eq(h2.dom.tplDetKind.value, 'op', 'an unset note kind was not offered the one the template names');
  ok(h2.dom.tplDetKindWhy.textContent.indexOf('suggested') !== -1,
    'the suggested kind arrived without saying it was suggested');
  h2.render('d');
  eq(h2.dom.tplDetKind.value, 'soap', 'the doctor\'s own declared kind was overwritten by a guess');
  eq(h2.dom.tplDetKindWhy.textContent, '', 'a declared kind was labelled as suggested');
}

/* ===== 8. the import seed reads the whole template, not just the name ==== */
{
  const h = newHarness(OP_LIBRARY);
  const row = { name: 'Left Knee Genicular Nerve Block', text: OP_LIBRARY[1].text };
  h.api._tplSeedKeywords(row, OP_LIBRARY);
  ok(row.keywords && row.keywords.length, 'a keywordless import was seeded with nothing');
  ok(row.keywords.length <= 6, 'the import seed ignored the cap: ' + JSON.stringify(row.keywords));
  eq(row.kwSuggested, 1, 'the import seed did not mark its keywords as suggested');
  eq(row.kind, 'op', 'the import seed did not carry the note kind the text names');
  eq(row.kindSuggested, 1, 'the import seed did not mark the kind as suggested');

  /* the doctor's own explicit metadata always wins */
  const explicit = { name: 'Left Knee Genicular Nerve Block', text: OP_LIBRARY[1].text, keywords: ['his', 'own'] };
  h.api._tplSeedKeywords(explicit, OP_LIBRARY);
  eq(explicit.keywords, ['his', 'own'], 'the import seed overwrote keywords that came with the file');

  /* a template with nothing quotable still lands with keywords - the picker's
     kind gate starves on a keywordless library */
  const bare = { name: 'Tarsal Release', text: 'x' };
  h.api._tplSeedKeywords(bare, []);
  ok(bare.keywords && bare.keywords.length, 'the name-only fallback stopped seeding anything');
}

/* ===== 9. a template is DATA. It is never run, compiled or rendered ====== */
{
  const hostile = {
    id: 'h', name: '<script>alert(1)</script> Tarsal c++ a(b [a-z',
    kind: '', keywords: [], text:
      'PROCEDURE PERFORMED: <img src=x onerror="alert(2)"> tarsal decompression\n'
      + '__proto__: polluted\nHeading (unbalanced: [a-z\n'
      + 'The tarsal tunnel was decompressed. The tarsal contents were inspected.\n'
      + '${process.exit(1)} and `backticks` and c++ again and a(b again'
  };
  const h = newHarness([hostile, OP_LIBRARY[0]]);
  const out = h.api._mlsTplSuggestFor(hostile, [hostile, OP_LIBRARY[0]]);
  const own = h.api._mlsTplSuggestNorm(hostile.name + ' \n ' + hostile.text);
  out.terms.forEach(term => {
    ok(own.indexOf(term) !== -1, 'a hostile template produced an invented term: ' + term);
    ok(!/[<>"'`${}()[\]\\]/.test(term), 'a suggested term carried markup or code punctuation: ' + JSON.stringify(term));
  });
  ok(out.terms.some(t => t.indexOf('tarsal') !== -1),
    'the hostile template\'s real clinical term was lost: ' + JSON.stringify(out.terms));
  /* "__proto__" as a term is an ordinary key, not a prototype write */
  ok(!Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), 'the prototype was written to');
  eq(({}).polluted, undefined, 'a bare object inherited a key out of a template');

  /* rendered, the hostile name and body come back ESCAPED, never as markup */
  const html = h.render('h');
  ok(html.indexOf('<script>alert(1)</script>') === -1, 'a template name was written into the pane as markup');
  ok(html.indexOf('&lt;script&gt;') !== -1, 'the hostile name was not escaped at all');
  ok(html.indexOf('onerror=') === -1 || html.indexOf('&lt;img') !== -1,
    'a template body was written into the pane as markup');
  /* the why line is TEXT, always */
  ok(h.dom.tplKwWhy.textContent.length > 0 && h.dom.tplKwWhy.innerHTML === '',
    'the why line was written as markup instead of text');

  /* and the extractor itself compiles nothing out of a template */
  ['eval(', 'new Function', 'new RegExp', 'RegExp(', 'innerHTML', 'setTimeout(', 'document.write']
    .forEach(bad => {
      ok(SUGGESTER_SRC.indexOf(bad) === -1,
        'the extractor reaches for ' + bad + ' - a template is untrusted data');
    });
  ok(/^[\x09\x0A\x0D\x20-\x7E]*$/.test(SUGGESTER_SRC), 'the extractor block is not ASCII');
}

/* ===== 10. the draft-tuning field carries the SAME wiring in every twin == */
const DT_FILES = ['1p-feat_mls_draft_tuning.js', 'feat_mls_draft_tuning.js', 'cloned-feat_mls_draft_tuning.js'];
DT_FILES.forEach(file => {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  ok(/<input type="text" class="mls-dt-short-field" id="mlsDtSectionWhen"/.test(src),
    file + ': the "Use automatically when" input changed shape');
  ok(src.indexOf('id="mlsDtSectionWhenSuggest"') !== -1, file + ': the explicit control is missing');
  ok(src.indexOf('id="mlsDtSectionWhenWhy"') !== -1, file + ': the why line is missing');
  ok(src.indexOf('window._mlsTplSuggestFor') !== -1,
    file + ': it does not reach the SHELL extractor - a second copy would drift');
  ok(src.indexOf('function offerWhenSuggestion') !== -1, file + ': the empty-field-only prefill is missing');
  ok(src.indexOf('if (profile.whenAuto || prior) return;') !== -1,
    file + ': a cleared rule could be proposed for again');
  ok(src.indexOf('whenAuto:') !== -1, file + ': the latch does not ride in the saved format');
  /* Nothing in the suggest path may block or slow a save. */
  ok(!/suggestWhenNow[\s\S]{0,400}await /.test(src), file + ': the explicit control awaits something');
});

/* ===== 11. RUNTIME: the field the owner was looking at fills itself ====== */
(async () => {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const host = `<!doctype html><html><body>
      <div id="settingsModal" class="show"><div class="modal">
        <div class="row"><button type="button" onclick="saveSettings()">Save settings</button></div>
      </div></div>
    </body></html>`;
    await page.route('https://mls-tplauto-runtime.test/**',
      route => route.fulfill({ status: 200, contentType: 'text/html', body: host }));
    await page.goto('https://mls-tplauto-runtime.test/settings');
    await page.evaluate(() => {
      window.uns = key => 'tplauto-runtime::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
    });
    /* THE SHELL'S OWN EXTRACTOR, lifted verbatim - this is the seam that
       matters: a feature module that cannot reach it is dead wiring. */
    await page.addScriptTag({ content: SUGGESTER_SRC });
    await page.addScriptTag({ path: path.resolve(root, 'feat_mls_draft_tuning.js') });

    ok(await page.evaluate(() => typeof window._mlsTplSuggestFor === 'function'),
      'runtime: the shell extractor did not publish itself on window');

    await page.selectOption('#mlsDtFamily', 'plan');
    await page.click('#mlsDtSectionAdd');
    const profileId = await page.inputValue('#mlsDtSectionProfile');
    eq(await page.inputValue('#mlsDtSectionWhen'), '',
      'runtime: a brand-new format with no template was given a rule out of nowhere');

    await page.fill('#mlsDtSectionName', 'Genicular block plan');
    await page.fill('#mlsDtSectionTemplateText',
      'Genicular nerve block discussed.\nRadiofrequency ablation offered.\nGenicular block scheduled.\n'
      + 'Radiofrequency ablation consent reviewed.');
    /* leave and come back: loadUi runs and the EMPTY rule is offered one */
    await page.selectOption('#mlsDtFamily', 'exam');
    await page.selectOption('#mlsDtFamily', 'plan');
    await page.selectOption('#mlsDtSectionProfile', profileId);

    const filled = await page.inputValue('#mlsDtSectionWhen');
    ok(filled.length > 0, 'runtime: the EMPTY "Use automatically when" field was not filled from the template');
    const source = 'genicular block plan genicular nerve block discussed radiofrequency ablation offered '
      + 'genicular block scheduled radiofrequency ablation consent reviewed';
    filled.split(',').map(s => s.trim()).forEach(term => {
      ok(term.length > 0 && source.indexOf(term) !== -1,
        'runtime: an INVENTED term reached the field: ' + JSON.stringify(term));
    });
    const why = await page.locator('#mlsDtSectionWhenWhy').textContent();
    ok(String(why).indexOf('Suggested from') === 0,
      'runtime: the field filled itself without saying why: ' + JSON.stringify(why));

    /* he clears it and saves: the rule stays cleared, latched inside the
       saved format, and reopening the editor does not propose again */
    await page.fill('#mlsDtSectionWhen', '');
    await page.evaluate(() => window.__mlsDraftTuning.saveFromUi());
    const savedRow = await page.evaluate(id => {
      const rows = window.__mlsDraftTuning.read().families.plan.profiles;
      return rows.find(r => r.id === id) || null;
    }, profileId);
    ok(savedRow, 'runtime: the format disappeared on save');
    eq(savedRow.when, '', 'runtime: a rule the doctor CLEARED did not save as cleared');
    eq(savedRow.whenAuto, 1, 'runtime: the save did not latch his decision to leave the rule empty');

    /* A FULL RELOAD, so the session latch is gone and only what was SAVED can
       still hold the line. This is the case that matters: he closes MLS, comes
       back tomorrow, and the rule he deleted must not be back. */
    await page.reload();
    await page.evaluate(() => {
      window.uns = key => 'tplauto-runtime::' + key;
      window.saveSettings = function () {};
      window.getGenLength = () => 'standard';
      window.getGenInstr = () => '';
    });
    await page.addScriptTag({ content: SUGGESTER_SRC });
    await page.addScriptTag({ path: path.resolve(root, 'feat_mls_draft_tuning.js') });
    await page.evaluate(() => window.__mlsDraftTuning.beginSettings());
    await page.selectOption('#mlsDtFamily', 'plan');
    await page.selectOption('#mlsDtSectionProfile', profileId);
    eq(await page.inputValue('#mlsDtSectionWhen'), '',
      'runtime: a RELOAD refilled a rule he had cleared and saved');

    /* the explicit control still works, because he is asking for it */
    await page.click('#mlsDtSectionWhenSuggest');
    const asked = await page.inputValue('#mlsDtSectionWhen');
    ok(asked.length > 0, 'runtime: "Suggest from this template" did nothing on a cleared, latched field');
    asked.split(',').map(s => s.trim()).forEach(term => {
      ok(source.indexOf(term) !== -1, 'runtime: the explicit control INVENTED a term: ' + JSON.stringify(term));
    });

    /* an empty template says so instead of failing silently */
    await page.click('#mlsDtSectionAdd');
    await page.click('#mlsDtSectionWhenSuggest');
    const empty = await page.locator('#mlsDtSectionWhenWhy').textContent();
    ok(String(empty).indexOf('Add the template') === 0,
      'runtime: the control was silent on a format with no template: ' + JSON.stringify(empty));
    eq(await page.inputValue('#mlsDtSectionWhen'), '',
      'runtime: a format with no template was given a rule anyway');
  } finally {
    await browser.close();
  }

  console.log('PASS template auto-suggest (tplauto-1.0.0): ' + checks + ' checks - the REAL extractor and the REAL '
    + 'settings editor, lifted out of the shipped shell and executed, propose the words that should choose a '
    + 'template out of the template\'s OWN text. Every term is a subset of what the doctor wrote; a term carried by '
    + 'every other template is dropped as worthless and a rare term outranks a common one; furniture, two-character '
    + 'words and bare numbers never survive and the list is capped at six. The prefill only ever touches an EMPTY '
    + 'field, once - a field he cleared stays cleared across a re-render, across a save, and across a new session - '
    + 'while "Suggest from this template" re-proposes on demand and says so. An ambiguous note kind stays UNSET, '
    + 'which competes for every kind. A hostile template carrying script tags, unbalanced parens and "__proto__" '
    + 'stays inert DATA: nothing is eval\'d, compiled into a RegExp, or written as markup. And the draft-tuning '
    + '"Use automatically when" field - the field the owner was looking at - reaches the SHELL\'s extractor in a '
    + 'real browser and fills itself, with the same clear-once-and-it-stays-cleared contract.');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
