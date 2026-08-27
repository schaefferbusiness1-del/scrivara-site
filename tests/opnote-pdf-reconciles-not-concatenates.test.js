'use strict';
/* ONE DOCUMENT, ONE SET OF FACTS (opnq-1.0.0)
 *
 * Owner, 2026-08-26, from a real generated PDF:
 *   - the header said "Date of Procedure: [not dictated]" while the SAME
 *     document stated the exact date further down;
 *   - an earlier draft body was appended as ADDITIONAL DOCUMENTATION,
 *     duplicating patient and date with DIVERGENT values, so one page carried
 *     three different anesthesia statements.
 *
 * FOUR MECHANICS PRODUCED THAT PAGE, and each has its own section here.
 *
 * 1. THE LATE DATE. normalize()'s demographic lift only ever walked __pre - the
 *    text BEFORE the first recognised heading. A date line written UNDER a
 *    heading is not a heading (looksLikeHeading rejects it for its lowercase)
 *    and has no ALIAS, so it fell through to the body-line branch and stayed
 *    buried while the header printed [not dictated].
 * 2. A REPEATED CANONICAL HEADING did not create a second section: pushCanon
 *    appended into the same array, so two different Anesthesia statements
 *    became one run-on paragraph with nothing saying they disagreed.
 * 3. A SECOND DOCUMENT TITLE parsed as a heading, opened one unmatched block
 *    and swallowed the entire earlier draft into the tail verbatim.
 * 4. isNormalized() needed only seven canonical headings plus a title, which a
 *    doubled document satisfies - so exportPdf SKIPPED normalize entirely and
 *    printed both copies untouched.
 *
 * THE SAFETY OF THIS CHANGE IS THE LOSSLESS PROMISE THIS FILE IS BUILT ON
 * ("every source line ends up somewhere"). Section 5 asserts it directly: a
 * line may only disappear when it is provably a whitespace-equal DUPLICATE of
 * something already printed. A value that DISAGREES is labelled and kept.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const PRO_SRC = fs.readFileSync(path.join(root, 'mls-opnote-pro.js'), 'utf8');
const NOT_DICTATED = '[not dictated]';
const CONFLICT = 'CONFLICTING ENTRY (not reconciled): ';

function engine() {
  const ctx = {
    console, String, Number, Math, Date, JSON, Object, Array, RegExp, Error, isNaN, Promise,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    document: {
      readyState: 'complete', addEventListener() {}, getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} }, body: { appendChild() {} }
    },
    localStorage: { getItem: () => null, setItem() {} },
    navigator: { userAgent: 'node' }, location: { href: '' }, toast() {}
  };
  ctx.window = ctx;
  vm.runInNewContext(PRO_SRC, ctx, { filename: 'mls-opnote-pro.js' });
  assert(ctx.__mlsOpNotePro && typeof ctx.__mlsOpNotePro.normalize === 'function', 'the op-note composer did not install');
  return ctx.__mlsOpNotePro;
}
const pro = engine();
const headerLine = (out, label) => (out.split('\n').find((l) => l.indexOf(label + ': ') === 0) || '').slice(label.length + 2);
let checks = 0;

/* =======================================================================
 * 1. A DATE THE DOCUMENT ALREADY STATES REACHES THE HEADER
 * ===================================================================== */
const withTail = (tail) => 'OPERATIVE / PROCEDURE NOTE\n\n' +
  'Patient: Jordan Lee\nDOB: 1984-05-12\nMRN: QA-1\nProvider: Dr. X\n\n' +
  'PROCEDURE(S) PERFORMED: Bilateral L3-L5 radiofrequency ablation\n\n' +
  'INDICATIONS FOR PROCEDURE: Chronic facet-mediated low back pain.\n\n' +
  'DISPOSITION / POST-PROCEDURE PLAN:\n' + tail + '\nDischarged home in stable condition.\n';

{
  /* THE DEFECT */
  const out = pro.normalize(withTail('Date of Procedure: 08/25/2026'), {});
  assert.strictEqual(headerLine(out, 'Date of Procedure'), '08/25/2026',
    'the header still reads ' + JSON.stringify(headerLine(out, 'Date of Procedure')) + ' while the document itself states 08/25/2026 ' +
    'further down. The value is not being invented here - it is being READ from the note the doctor is looking at');
  /* and it is no longer stated twice */
  assert.strictEqual((out.match(/08\/25\/2026/g) || []).length, 1, 'the date now prints twice: once lifted, once still buried in the body');
  checks++;

  /* every heading spelling HEADER_KEYS maps to dop */
  for (const label of ['Date of Procedure', 'Date of Service', 'Service Date']) {
    const o = pro.normalize(withTail(label + ': 2026-08-25'), {});
    assert.strictEqual(headerLine(o, 'Date of Procedure'), '2026-08-25', 'a "' + label + ':" line under a heading did not reach the header');
  }
  checks++;

  /* an ALL-CAPS date line parses as a heading, so its value is a block body */
  const caps = pro.normalize(withTail('DATE OF PROCEDURE: 2026-08-25'), {});
  assert.strictEqual(headerLine(caps, 'Date of Procedure'), '2026-08-25', 'an ALL-CAPS date heading did not reach the header');
  assert(!/ADDITIONAL DOCUMENTATION:[\s\S]*DATE OF PROCEDURE/.test(caps), 'the consumed date block was also dumped into the tail');
  checks++;

  /* CONTROL A: truly unknown stays bracketed. This is the fabrication the
     b822 ladder was careful to avoid and it must stay avoided. */
  const unknown = pro.normalize(withTail('Follow up in two weeks.'), {});
  assert.strictEqual(headerLine(unknown, 'Date of Procedure'), NOT_DICTATED,
    'a note that states no procedure date anywhere now prints one. A creation date, a nearby date or today\'s date printed as ' +
    'when the case happened is a fabrication on a signed operative note');
  checks++;

  /* CONTROL B: a bare "Date:" in clinical prose is not a procedure date */
  const prose = pro.normalize(withTail('Date: to be arranged at follow-up'), {});
  assert.strictEqual(headerLine(prose, 'Date of Procedure'), NOT_DICTATED,
    'a "Date:" line in prose was lifted into the clinical Date of Procedure attestation');
  assert(/to be arranged at follow-up/.test(prose), 'and the prose was deleted from the note as well');
  checks++;

  /* CONTROL C: a value that does not parse as a date is left alone */
  const vague = pro.normalize(withTail('Date of Procedure: as previously scheduled'), {});
  assert.strictEqual(headerLine(vague, 'Date of Procedure'), NOT_DICTATED, 'a non-date value was printed as the procedure date');
  assert(/as previously scheduled/.test(vague), 'and it was deleted from the body');
  checks++;

  /* CONTROL D: a date already stated at the TOP always wins over a later one */
  const both = 'OPERATIVE / PROCEDURE NOTE\n\nPatient: Jordan Lee\nDate of Procedure: 2026-08-25\n\n' +
    'FINDINGS: ok\n\nDISPOSITION / POST-PROCEDURE PLAN:\nDate of Procedure: 2026-01-01\nHome.\n';
  const b = pro.normalize(both, {});
  assert.strictEqual(headerLine(b, 'Date of Procedure'), '2026-08-25', 'a later date overrode the one the note states at the top');
  assert(b.indexOf('2026-01-01') >= 0, 'the losing date was deleted rather than kept where it was written');
  checks++;
}

/* =======================================================================
 * 1b. A PLACEHOLDER IN A HEADER SLOT IS STILL AN EMPTY SLOT (opnq-1.0.1)
 *
 * MEASURED after 1.0.0 landed: both lifts test the slot for truthiness, and
 * "[not dictated]" is a non-empty string. So a note whose own header line
 * already read "Date of Procedure: [not dictated]" - which is exactly what the
 * owner's PDF showed - kept the placeholder even when the document stated the
 * date further down, and in the DOUBLED shape the real date was filed as a
 * disagreement with the placeholder and printed as a CONFLICTING ENTRY under a
 * header that still claimed nothing was dictated.
 *
 * The vocabulary is the shell's own opNoteBlankTokens set, so the composer and
 * the canonical parser cannot disagree about what "unfilled" means.
 * ===================================================================== */
{
  const withHeaderSlot = (slot, tail) => 'OPERATIVE / PROCEDURE NOTE\n\n' +
    'Patient: Jordan Lee\nDOB: 1984-05-12\nMRN: QA-1\nDate of Procedure: ' + slot + '\nProvider: Dr. X\n\n' +
    'PROCEDURE(S) PERFORMED: Bilateral L3-L5 radiofrequency ablation\n\n' +
    'DISPOSITION / POST-PROCEDURE PLAN:\n' + tail + '\nDischarged home in stable condition.\n';

  /* THE DEFECT, in each spelling the app's canonical parser counts as a blank */
  for (const slot of [NOT_DICTATED, '[[procedure_date]]', '[FILL: date of procedure]', '_____']) {
    const out = pro.normalize(withHeaderSlot(slot, 'Date of Procedure: 08/25/2026'), {});
    assert.strictEqual(headerLine(out, 'Date of Procedure'), '08/25/2026',
      'a header slot holding ' + JSON.stringify(slot) + ' blocked the lift, so the header still says nothing while the ' +
      'document states 08/25/2026 further down');
    /* [not dictated] is also what every genuinely empty section prints, so only
       the slot-specific spellings can be asserted absent from the whole page. */
    if (slot !== NOT_DICTATED) {
      assert.strictEqual(out.indexOf(slot), -1, 'the placeholder survived alongside the value that replaced it');
    }
  }
  checks++;

  /* CONTROL A: a placeholder slot with NO date anywhere still prints the
     placeholder. Emptying the slot must not become a licence to invent. */
  const stillUnknown = pro.normalize(withHeaderSlot(NOT_DICTATED, 'Follow up in two weeks.'), {});
  assert.strictEqual(headerLine(stillUnknown, 'Date of Procedure'), NOT_DICTATED,
    'clearing a placeholder slot let a date be invented for a note that states none');
  checks++;

  /* CONTROL B: a real value in the slot is never cleared by this rule */
  const realWins = pro.normalize(withHeaderSlot('2026-08-25', 'Date of Procedure: 2026-01-01'), {});
  assert.strictEqual(headerLine(realWins, 'Date of Procedure'), '2026-08-25',
    'a real date in the header slot was treated as unfilled');
  assert(realWins.indexOf('2026-01-01') >= 0, 'and the losing date was deleted rather than kept where it was written');
  checks++;

  /* THE DOUBLED SHAPE. The first copy's slot is a placeholder; the second copy
     states the date in its own header zone, which no body lift can reach. */
  const doubled = (firstSlot, secondSlot) =>
    'OPERATIVE / PROCEDURE NOTE\n\nPatient: Jordan Lee\nDOB: 1984-05-12\nMRN: QA-1\nDate of Procedure: ' + firstSlot + '\n\n' +
    'ANESTHESIA: Monitored anesthesia care.\n\nPROCEDURE(S) PERFORMED: Bilateral L3-L5 RFA\n\n' +
    'FINDINGS: Concordant relief.\n\n' +
    'OPERATIVE / PROCEDURE NOTE\n\nPatient: Jordan Lee\nDOB: 1984-05-12\nDate of Procedure: ' + secondSlot + '\n\n' +
    'ANESTHESIA: Local anesthetic only.\n';

  const lifted = pro.normalize(doubled(NOT_DICTATED, '08/25/2026'), {});
  assert.strictEqual(headerLine(lifted, 'Date of Procedure'), '08/25/2026',
    'the second copy stated the only date in the document and it was filed as a disagreement with the placeholder instead of used');
  assert(lifted.indexOf(CONFLICT + 'Date of Procedure') < 0,
    'the only date the document states was printed as a CONFLICTING ENTRY - it conflicts with nothing');
  checks++;

  /* CONTROL C: two REAL divergent dates still behave as 1.0.0 pinned them -
     the primary copy wins the slot and the divergent one is LABELLED, never
     dropped. This is the assertion that keeps 1.0.1 from becoming a licence to
     silently reconcile real disagreements. */
  const divergent = pro.normalize(doubled('2026-08-25', '2026-01-01'), {});
  assert.strictEqual(headerLine(divergent, 'Date of Procedure'), '2026-08-25', 'the primary copy no longer wins the printed slot');
  assert(divergent.indexOf(CONFLICT + 'Date of Procedure: 2026-01-01') >= 0,
    'a second copy stating a DIFFERENT real date is no longer labelled - that is the dishonest document this suite exists to stop');
  checks++;

  /* CONTROL D: a placeholder in the SECOND copy is not a divergent claim, so
     it is not labelled as one - it claims nothing. */
  const placeholderSecond = pro.normalize(doubled('2026-08-25', NOT_DICTATED), {});
  assert.strictEqual(headerLine(placeholderSecond, 'Date of Procedure'), '2026-08-25', 'a placeholder overrode a real date');
  assert(placeholderSecond.indexOf(CONFLICT + 'Date of Procedure') < 0,
    'a placeholder was printed as though it disagreed with the date the document states');
  checks++;
}

/* =======================================================================
 * 2. A REPEATED SECTION IS RECONCILED, NOT CONCATENATED
 * ===================================================================== */
const twoAnesthesia = (second) => 'OPERATIVE / PROCEDURE NOTE\n\nPatient: Jordan Lee\nDOB: 1984-05-12\n\n' +
  'ANESTHESIA: Monitored anesthesia care.\n\nPROCEDURE(S) PERFORMED: Bilateral L3-L5 RFA\n\n' +
  'ANESTHESIA: ' + second + '\n\nFINDINGS: Concordant relief.\n';

{
  /* an identical restatement is a proven duplicate and is dropped */
  const dup = pro.normalize(twoAnesthesia('Monitored anesthesia care.'), {});
  assert.strictEqual((dup.match(/Monitored anesthesia care\./g) || []).length, 1,
    'an identical repeated section still prints twice');
  assert(dup.indexOf(CONFLICT) < 0, 'an identical repeat was labelled as a conflict');
  checks++;

  /* a DIVERGENT restatement is kept and labelled - never welded on silently */
  const div = pro.normalize(twoAnesthesia('Local anesthetic only.'), {});
  assert(div.indexOf(CONFLICT + 'Local anesthetic only.') >= 0,
    'two different anesthesia statements were concatenated into one section with nothing saying they disagree. This is the ' +
    'mechanism behind "three different anesthesia statements in one document"');
  assert(div.indexOf('Monitored anesthesia care.') >= 0, 'the first statement was dropped in favour of the second');
  checks++;

  /* whitespace-only differences count as identical */
  const spaced = pro.normalize(twoAnesthesia('Monitored   anesthesia\n care.'), {});
  assert(spaced.indexOf(CONFLICT) < 0, 'a whitespace-only restatement was reported as a divergence');
  checks++;
}

/* =======================================================================
 * 3. A DOUBLED DOCUMENT IS ONE DOCUMENT
 * ===================================================================== */
const COPY_ONE = 'OPERATIVE / PROCEDURE NOTE\n\n' +
  'Patient: Jordan Lee\nDOB: 1984-05-12\nMRN: QA-1\nDate of Procedure: 2026-08-25\nProvider: Dr. X\n\n' +
  'PROCEDURE(S) PERFORMED: Bilateral L3-L5 RFA\nANESTHESIA: Monitored anesthesia care.\n' +
  'INDICATIONS FOR PROCEDURE: Facet pain.\nFINDINGS: Concordant relief.\n' +
  'DESCRIPTION OF PROCEDURE: Lesions created at each level.\nCOMPLICATIONS: None\n' +
  'DISPOSITION / POST-PROCEDURE PLAN: Home.\n';
const COPY_TWO = COPY_ONE + '\nOPERATIVE / PROCEDURE NOTE\n\n' +
  'Patient: Jordan Lee\nDOB: 1984-05-12\nMRN: QA-9\nDate of Procedure: 2026-08-19\nProvider: Dr. Y\n\n' +
  'ANESTHESIA: Local anesthetic only.\nFINDINGS: Concordant relief.\n';

{
  /* 4. THE BYPASS IS CLOSED */
  assert.strictEqual(pro.isNormalized(COPY_ONE), true, 'a single normalized note no longer round-trips as normalized');
  assert.strictEqual(pro.isNormalized(COPY_TWO), false,
    'a document holding two full copies of the note still counts as "already normalized", so exportPdf skips normalize() and ' +
    'prints both copies untouched - which is exactly the page the owner is holding');
  checks++;

  const out = pro.normalize(COPY_TWO, {});

  /* ONE demographics block, and it is the primary document's */
  assert.strictEqual((out.match(/^OPERATIVE \/ PROCEDURE NOTE$/gm) || []).length, 1, 'the output still carries two document titles');
  assert.strictEqual(headerLine(out, 'MRN'), 'QA-1', 'a later copy overwrote the primary document\'s MRN');
  assert.strictEqual(headerLine(out, 'Date of Procedure'), '2026-08-25', 'a later copy overwrote the primary document\'s procedure date');
  assert.strictEqual(headerLine(out, 'Provider'), 'Dr. X', 'a later copy overwrote the primary document\'s provider');
  checks++;

  /* the divergent identity is LABELLED, not dropped and not printed as an
     equal claim */
  for (const [label, value] of [['MRN', 'QA-9'], ['Date of Procedure', '2026-08-19'], ['Provider', 'Dr. Y']]) {
    assert(out.indexOf(CONFLICT + label + ': ' + value) >= 0,
      'the second copy\'s divergent ' + label + ' (' + value + ') is neither printed nor labelled - it was silently dropped, which ' +
      'trades one dishonest document for another');
  }
  checks++;

  /* the second copy is no longer dumped verbatim into the tail */
  assert(out.indexOf('ADDITIONAL DOCUMENTATION:') < 0,
    'the earlier draft is still appended verbatim as ADDITIONAL DOCUMENTATION:\n' + out.slice(out.indexOf('ADDITIONAL DOCUMENTATION:')));
  checks++;

  /* the identical FINDINGS restatement is dropped; the divergent ANESTHESIA is labelled */
  assert.strictEqual((out.match(/Concordant relief\./g) || []).length, 1, 'an identical restatement across the two copies still prints twice');
  assert(out.indexOf(CONFLICT + 'Local anesthetic only.') >= 0, 'the second copy\'s different anesthesia statement is not surfaced');
  checks++;

  /* every canonical section still says what the primary document said */
  assert(/PROCEDURE\(S\) PERFORMED:\nBilateral L3-L5 RFA/.test(out), 'the primary procedure line was lost');
  assert(/DISPOSITION \/ POST-PROCEDURE PLAN:\nHome\./.test(out),
    'the composer\'s OWN emitted disposition heading does not round-trip through its alias map, so a re-read note prints ' +
    '[not dictated] there while the real text lands in the tail');
  checks++;

  /* and every CANON heading resolves, not just that one */
  const CANON = [...(/var CANON\s*=\s*\[([\s\S]*?)\];/.exec(PRO_SRC)[1]).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert(CANON.length >= 14, 'the canonical heading list shrank: ' + CANON.length);
  for (const key of CANON) {
    const round = pro.parseNote(key + ':\nsome body text\n');
    assert(round.sec[key], 'the composer emits "' + key + ':" but cannot read it back - a re-read note loses that section into the tail');
  }
  checks++;
}

/* =======================================================================
 * 5. LOSSLESS: A LINE MAY ONLY VANISH IF IT IS A PROVEN DUPLICATE
 * ===================================================================== */
{
  const out = pro.normalize(COPY_TWO, {});
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const printed = out.split('\n').map(flat).filter(Boolean);
  const misses = [];
  for (const raw of COPY_TWO.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const f = flat(line);
    /* the whole line, its post-colon value, or the line under a conflict label */
    const value = flat(line.replace(/^[^:]*:\s*/, ''));
    const ok = printed.some((p) => p === f || p === value || p === flat(CONFLICT + line) ||
      p.indexOf(f) >= 0 || (value && p.indexOf(value) >= 0));
    if (!ok) misses.push(line);
  }
  assert.deepStrictEqual(misses, [],
    'normalize() dropped source content that is not a proven duplicate of something it printed. This file is documented LOSSLESS ' +
    '("every source line ends up somewhere") and the ADDITIONAL DOCUMENTATION block was that safety net; reconciling may only ' +
    'remove a whitespace-equal restatement, never a divergent one:\n  ' + misses.join('\n  '));
  checks++;
}

/* =======================================================================
 * 6. THE ANY-VIEW PDF BUTTON NO LONGER HANDS normalize() ONE RUN-ON LINE
 * ===================================================================== */
{
  const AV = fs.readFileSync(path.join(root, 'feat_opnote_pdf_anyview.js'), 'utf8');
  const at = AV.indexOf('function readTextFromBody(body) {');
  assert(at > 0, 'readTextFromBody moved');
  let d = 0, end = -1;
  for (let j = AV.indexOf('{', at); j < AV.length; j++) {
    if (AV[j] === '{') d++; else if (AV[j] === '}') { d--; if (!d) { end = j + 1; break; } }
  }
  const ctx = { String, Object, Array, console, S: (v) => String(v == null ? '' : v), safe: (f, d2) => { try { return f(); } catch (e) { return d2; } } };
  vm.createContext(ctx);
  vm.runInContext(AV.slice(at, end) + '\nthis.readTextFromBody = readTextFromBody;', ctx);

  /* the shape feat_opnote_onscreen.js builds: nested DIVs, no <pre> */
  const div = (t) => ({ textContent: t });
  const blocks = [div('OPERATIVE / PROCEDURE NOTE'), div('PROCEDURE(S) PERFORMED: Bilateral L3-L5 RFA'), div('FINDINGS: Concordant relief.')];
  const body = {
    querySelector: () => null,
    cloneNode: () => ({ querySelector: () => null, querySelectorAll: () => blocks, textContent: blocks.map((b) => b.textContent).join('') }),
    textContent: blocks.map((b) => b.textContent).join('')
  };
  const text = ctx.readTextFromBody(body);
  assert(text.split('\n').length >= 3,
    'a read body with no raw <pre> is still read as ONE run-on line, so every heading is lost and the whole note prints under ' +
    'ADDITIONAL DOCUMENTATION: ' + JSON.stringify(text));
  const parsed = pro.parseNote(text);
  assert(parsed.sec['PROCEDURE(S) PERFORMED'] && parsed.sec.FINDINGS, 'the recovered text still does not parse into sections');
  checks++;

  /* CONTROL: a raw <pre> is still preferred and returned untouched */
  const withPre = { querySelector: (sel) => (/pre/.test(sel) ? { textContent: 'RAW\nTEXT' } : null), cloneNode: () => ({}), textContent: '' };
  assert.strictEqual(ctx.readTextFromBody(withPre), 'RAW\nTEXT', 'the raw <pre> is no longer the preferred source');
  checks++;
}

console.log('PASS one document, one set of facts: a procedure date the note already states under a heading now reaches the header ' +
  '(while an absent one, a "Date:" prose line and an unparseable value all still print [not dictated]); a header slot already holding ' +
  'a placeholder - [not dictated], [[key]], [FILL:] or a rule of underscores - is treated as the empty slot it is, so the date the ' +
  'document states reaches the header instead of being filed as a disagreement with nothing, while two REAL divergent dates are still ' +
  'labelled and a note that states no date anywhere still prints [not dictated]; a repeated canonical heading ' +
  'is reconciled rather than concatenated - identical restatements dropped, divergent ones LABELLED; a doubled document no longer ' +
  'bypasses normalize(), prints ONE demographics block from the primary copy with every divergent identity labelled, and is never ' +
  'dumped verbatim as ADDITIONAL DOCUMENTATION; the lossless promise is asserted line by line; and the any-view PDF button no longer ' +
  'hands the composer one run-on line (' + checks + ' checks)');
