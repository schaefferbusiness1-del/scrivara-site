'use strict';

/* THE WHITE-LABEL PROMISE FAILED IN THE ONE ARTIFACT THAT LEAVES THE PRACTICE (b831)
 *
 * The Settings logo field says, in its own hint (ScribeFlow.html):
 *
 *     "Your logo appears on the printed/PDF letterhead, and the 'Prepared with MLS'
 *      line is removed for a clean, white-label note."
 *
 * Browser Print honoured both halves. NOT ONE jsPDF builder did: none drew the logo,
 * and every one printed "Generated with MLS" regardless of Premium. So a Premium
 * doctor uploaded their mark, saw it on Print, and then handed a patient or a lawyer
 * a PDF with no logo and a vendor footer — the promise failing in exactly the
 * artifact that leaves the building.
 *
 * THE TWO THINGS THIS TEST CARES ABOUT MOST, neither of which is the happy path:
 *
 *  1. AN UNREADABLE LOGO MUST NOT COST THE DOCTOR THEIR OPERATIVE NOTE. jsPDF's
 *     addImage throws on a malformed data URL, on an unsupported format, and on some
 *     truncated base64. Every failure mode must end with "no logo, letterhead
 *     unchanged" — never a lost export. Asserted by making addImage throw and
 *     requiring the letterhead still render.
 *
 *  2. WHITE-LABELLING MUST NOT DELETE A SAFETY WARNING. The old footer was one
 *     sentence doing two jobs: "Generated with MLS" is BRANDING, and "review and
 *     complete any [bracketed] items before signing" is a warning about incomplete
 *     content on a clinical document. Dropping the whole line for white-label would
 *     have quietly removed the warning. The branding goes; the warning stays, in
 *     both states.
 *
 * The logo is Premium-gated and accepts ONLY a data: image URL — the same gate
 * feat_mls_dictate_letter.js and renderLogoSetting() already apply. A remote URL or
 * a stray string must never reach addImage.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const PRO = fs.readFileSync(path.join(root, 'mls-opnote-pro.js'), 'utf8');

/* a 1x1 PNG and a 1x1 JPEG, both real data URLs */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofGh0dHRwlKzAoJTQrHR0oMTU/PzYqQ0hHOEo9SUZLTk9RUf/bAEMBCQkJDAsMGA0NGEUlHSVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUX/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

/* ---- the shared letterhead's logo accessor, executed ------------------- */
function logoAccessor(state) {
  const at = PRO.indexOf("Object.defineProperty(letterhead, 'logo'");
  assert(at > 0, 'the shared letterhead no longer exposes a logo accessor');
  let depth = 0, quote = '', esc = false, line = false, comment = false;
  const start = PRO.indexOf('{', at);
  let end = -1;
  for (let i = start; i < PRO.length; i++) {
    const ch = PRO[i], next = PRO[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (comment) { if (ch === '*' && next === '/') { comment = false; i++; } continue; }
    if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { comment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i + 1; break; }
  }
  assert(end > 0, 'unterminated logo accessor');
  /* the brace-matcher stops at the OPTIONS OBJECT's closing brace, which leaves the
     defineProperty call itself unclosed — "missing ) after argument list". Take the
     call's own closing paren too. */
  const close = PRO.indexOf(')', end);
  assert(close === end, 'expected the defineProperty call to close immediately after its options object');
  end = close + 1;
  const ctx = { String, RegExp, Object, console };
  ctx.safe = (fn, d) => { try { const v = fn(); return v === undefined ? d : v; } catch (e) { return d; } };
  ctx.lhOverride = { logo: null };
  ctx.window = {};
  if (state.premium !== undefined) ctx.window.effectivePremium = () => state.premium;
  if (state.logo !== undefined) ctx.window.getClinicLogo = () => state.logo;
  if (state.premiumThrows) ctx.window.effectivePremium = () => { throw new Error('entitlement check down'); };
  if (state.logoThrows) ctx.window.getClinicLogo = () => { throw new Error('storage unavailable'); };
  ctx.letterhead = {};
  vm.createContext(ctx);
  vm.runInContext(PRO.slice(at, end).replace(/^Object/, 'Object') + ';\nthis.v = letterhead.logo;', ctx);
  return ctx.v;
}

/* ---- 1. THE GATE ------------------------------------------------------- */
{
  assert.strictEqual(logoAccessor({ premium: true, logo: PNG }), PNG, 'a Premium PNG logo does not reach the letterhead');
  assert.strictEqual(logoAccessor({ premium: true, logo: JPG }), JPG, 'a Premium JPEG logo does not reach the letterhead');

  /* NOT Premium: the field is a Premium feature and the Settings preview gates it
     the same way, so the PDF must too */
  assert.strictEqual(logoAccessor({ premium: false, logo: PNG }), '', 'a non-Premium account got a logo on its PDF');

  /* ONLY a drawable data: image URL. Anything else must never reach addImage. */
  for (const [why, v] of [
    ['a remote URL', 'https://example.test/logo.png'],
    ['an SVG data URL (jsPDF addImage cannot draw it)', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['a bare base64 blob', 'iVBORw0KGgoAAAANSUhEUg=='],
    ['a stray string', 'my-logo'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['empty', ''],
    ['whitespace', '   ']
  ]) {
    assert.strictEqual(logoAccessor({ premium: true, logo: v }), '',
      why + ' was passed through as a drawable logo: ' + JSON.stringify(v));
  }

  /* nothing here may throw — it runs inside a PDF export */
  for (const st of [{}, { premium: true }, { premiumThrows: true, logo: PNG }, { premium: true, logoThrows: true }]) {
    assert.doesNotThrow(() => logoAccessor(st), 'the logo accessor threw for ' + JSON.stringify(Object.keys(st)));
    assert.strictEqual(logoAccessor(st), '', 'a failing gate must yield no logo, not undefined: ' + JSON.stringify(Object.keys(st)));
  }
}

/* ---- 2. THE FOOTER SPLITS BRANDING FROM THE SAFETY WARNING ------------- */
{
  const line = PRO.split('\n').filter((l) => l.includes('items before signing'));
  assert(line.length >= 2,
    'the footer no longer has two forms. It must: "Generated with MLS" is branding and goes for white-label, ' +
    'while "review and complete any [bracketed] items" is a warning about incomplete content on a clinical ' +
    'document and must stay in BOTH states.');
  const joined = line.join('\n');
  /* This was an `||` whose first operand was nonsense and whose second did the work
     — a tautology dressed as an assertion. Replaced with what it meant to say. */
  assert(/doc\.text\(_lhLogo\s*\n?\s*\?/.test(PRO),
    'the footer does not branch on whether the practice has its own logo, so white-labelling cannot happen');
  assert(/var _lhLogo = '';/.test(PRO) && /_lhLogo = String\(lh\.logo \|\| ''\)\.trim\(\)/.test(PRO),
    'the footer reads the logo per PAGE instead of once per export, so a header and its own footer can ' +
    'disagree about whether this document is white-labelled');
  assert(/'Review and complete any \[bracketed\] items before signing\.'/.test(joined),
    'the white-label footer dropped the [bracketed]-items warning along with the branding. White-labelling a ' +
    'clinical document must not quietly delete a warning about incomplete content.');
  assert(/'Generated with MLS — review and complete any \[bracketed\] items before signing\.'/.test(joined),
    'the non-white-label footer lost its original wording');
  /* both forms carry the warning */
  for (const l of line) {
    if (!/items before signing/.test(l)) continue;
    assert(/\[bracketed\] items before signing/.test(l), 'a footer form exists without the safety warning: ' + l.trim());
  }
}

/* ---- 3. AN UNREADABLE LOGO CANNOT COST THE EXPORT --------------------- */
/* The draw block is executed with an addImage that THROWS, which is what jsPDF does
   on a malformed or truncated image. The letterhead must still render. */
{
  /* b831: the draw is now ONE function, drawLetterheadLogo(), shared by four jsPDF
     builders and exposed on __mlsOpNotePro. It returns the VERTICAL SPACE CONSUMED,
     so a refusal is 0 and no caller can advance past a logo that was not drawn -
     which is a stronger contract than "remember not to move the cursor in a catch",
     and it is callable directly here instead of slicing an inlined block. */
  const fnSrc = (() => {
    const at = PRO.indexOf('function drawLetterheadLogo(doc, dataUrl, x, y, opts) {');
    assert(at > 0, 'drawLetterheadLogo is gone - the shared logo draw has been re-inlined');
    let depth = 0, quote = '', esc = false, line = false, comment = false;
    for (let i = PRO.indexOf('{', at); i < PRO.length; i++) {
      const ch = PRO[i], next = PRO[i + 1];
      if (line) { if (ch === '\n') line = false; continue; }
      if (comment) { if (ch === '*' && next === '/') { comment = false; i++; } continue; }
      if (quote) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === quote) quote = ''; continue; }
      if (ch === '/' && next === '/') { line = true; i++; continue; }
      if (ch === '/' && next === '*') { comment = true; i++; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return PRO.slice(at, i + 1);
    }
    throw new Error('unterminated drawLetterheadLogo');
  })();

  function draw(logo, addImageBehaviour, props) {
    const calls = [];
    const ctx = { String, Math, RegExp, console };
    ctx.doc = {
      getImageProperties: props === 'throw' ? () => { throw new Error('bad image'); } : () => props,
      addImage: (...a) => {
        calls.push(a);
        if (addImageBehaviour === 'throw') throw new Error('addImage: unsupported image');
      }
    };
    vm.createContext(ctx);
    vm.runInContext(fnSrc + '\nthis.consumed = drawLetterheadLogo(doc, ' + JSON.stringify(logo) + ', 56, 56);', ctx);
    /* the caller's cursor is `y += consumed`, so model it exactly that way */
    return { y: 56 + ctx.consumed, calls, consumed: ctx.consumed };
  }

  /* happy path: it draws and advances the cursor */
  const ok = draw(PNG, 'ok', { width: 240, height: 72 });
  assert.strictEqual(ok.calls.length, 1, 'the logo was not drawn');
  assert(ok.y > 56, 'the y-cursor did not advance past the logo, so the letterhead would overlap it');
  /* aspect ratio preserved inside the band, not squashed */
  const [, fmt, , , w, h] = ok.calls[0];
  assert.strictEqual(fmt, 'PNG', 'the image format was not detected from the data URL');
  assert(Math.abs((w / h) - (240 / 72)) < 0.01,
    'the logo was squashed instead of fitted: drew ' + w + 'x' + h + ' for a 240x72 source');
  assert(w <= 120.01 && h <= 36.01, 'the logo exceeded the letterhead band: ' + w + 'x' + h);

  /* JPEG detected separately */
  assert.strictEqual(draw(JPG, 'ok', { width: 100, height: 100 }).calls[0][1], 'JPEG',
    'a JPEG data URL was drawn as PNG');

  /* THE ONE THAT MATTERS: addImage throws and the export survives */
  const threw = draw(PNG, 'throw', { width: 240, height: 72 });
  assert.strictEqual(threw.y, 56,
    'addImage threw and the y-cursor advanced anyway, so the letterhead would print into a gap where no ' +
    'logo exists');
  /* and getImageProperties throwing must not stop the draw either */
  assert.doesNotThrow(() => draw(PNG, 'ok', 'throw'),
    'a jsPDF build without getImageProperties, or one that throws on it, kills the export');
  const noProps = draw(PNG, 'ok', null);
  assert.strictEqual(noProps.calls.length, 1, 'with no image properties available the logo must still be drawn at the band size');

  /* no logo: nothing drawn, cursor untouched, exactly as before this change */
  const none = draw('', 'ok', { width: 240, height: 72 });
  assert.strictEqual(none.calls.length, 0, 'addImage was called with no logo');
  assert.strictEqual(none.y, 56, 'the cursor moved for an absent logo');
}

/* ---- 4. FOUR BUILDERS, ONE OWNER (b831) -------------------------------
   The whole point of extracting the draw was that five builders needed it and five
   copies of an addImage call is the defect this effort keeps closing. Assert each
   one actually calls the shared function AND advances its cursor by the return
   value — a call whose result is discarded draws the logo and then prints the
   letterhead straight over it. */
{
  assert(/drawLetterheadLogo: drawLetterheadLogo,/.test(PRO),
    'drawLetterheadLogo is not exposed on __mlsOpNotePro, so no other builder can reach it');

  const CALLERS = [
    ['mls-opnote-pro.js', PRO, /y \+= drawLetterheadLogo\(doc, _lhLogo, margin, y\);/, 'the op-note PDF'],
    ['feat_fullhistory_pdf.js', null, /y \+= _pro\.drawLetterheadLogo\(doc, lh\.logo, margin, y\);/, 'the full-history PDF'],
    ['mls-procedure-report.js', null, /y \+= _pro\.drawLetterheadLogo\(doc, lh\.logo, margin, y\);/, 'the procedure report'],
    ['feat_after_visit_summary.js', null, /y \+= _pro\.drawLetterheadLogo\(doc, lh\.logo, marginX, y\);/, 'the after-visit summary handed to the PATIENT']
  ];
  for (const [file, pre, re, what] of CALLERS) {
    const src = pre || fs.readFileSync(path.join(root, file), 'utf8');
    assert(re.test(src),
      what + ' (' + file + ') does not draw the practice logo through the shared owner, or discards its ' +
      'return value — a discarded return means the letterhead prints straight over the logo');
    if (file !== 'mls-opnote-pro.js') {
      assert(/typeof _pro\.drawLetterheadLogo === 'function'/.test(src),
        file + ' calls the shared owner without checking it exists. mls-opnote-pro.js loads separately, so ' +
        'an absent engine must mean "no logo", not a thrown export.');
      assert(/catch \(eLogo\) \{\}/.test(src), file + ' does not contain the draw in a try/catch');
    }
  }

  /* the two builders NOT yet wired are named, so the gap is a decision */
  for (const f of ['ScribeFlow.html']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const wired = /drawLetterheadLogo/.test(src);
    assert(!wired,
      f + ' now draws the logo too. Good — but add it to the CALLERS list above so it is covered, rather ' +
      'than leaving it asserted-absent here. The two shell builders (downloadStudyPdf, legalTextToPdf) were ' +
      'deliberately left for a later increment.');
  }
}

console.log('PASS the premium logo reaches the PDF: the Settings field promised "your logo appears on the ' +
  'printed/PDF letterhead, and the Prepared with MLS line is removed" — browser Print honoured both and NOT ' +
  'ONE jsPDF builder did, so a Premium doctor handed out PDFs with no logo and a vendor footer. The logo is ' +
  'now on the shared letterhead, Premium-gated, accepting ONLY a drawable data: image URL (seven non-drawable ' +
  'shapes refused, including SVG and a remote URL), fitted to the band without squashing; a throwing addImage ' +
  'or getImageProperties leaves the letterhead exactly as it was rather than costing the doctor the export; ' +
  'and the footer drops the BRANDING while keeping the [bracketed]-items safety warning in both states. ' +
  'FOUR builders now draw it through ONE owner that returns the space consumed, so a refusal is 0 and no ' +
  'caller can advance past a logo that was not drawn; the two shell builders are asserted absent so that ' +
  'gap stays a decision');
