'use strict';

/*
 * Patricia Kirwin, live 2026-08-08: a schedule-imported record with ZERO chart
 * reads (no coverage receipt, 0 raw bytes) rendered its stored lone "NKDA" as
 * if it were a chart fact — an empty profile wearing a fabricated allergy
 * answer, on a patient the owner was looking at. 1,340 of 1,567 records are
 * in that never-read class.
 *
 * The card's contract: a lone NKDA-family value on a record no chart read has
 * ever landed for is UNVERIFIABLE BY THE RECEIPTS and must say so beside the
 * value. Real pulled content — and any record with a landed chart — renders
 * unchanged. This is an annotation, never a masking: the stored value stays
 * visible, its provenance becomes honest.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'latin1');

const start = app.indexOf('var _algShown=p.allergies;');
assert(start >= 0, 'the allergy annotation block is missing from the profile renderer');
const block = app.slice(start, app.indexOf("fieldBody('profAllergies'", start));

assert(/_athenaChartLanded\(p\)/.test(block), 'the annotation must gate on the landed-chart receipt, not on the value alone');
assert(/unverified \(no Athena chart pulled yet\)/.test(block), 'the annotation text must state WHY the value is unverifiable');
assert(/\^\\s\*\(\?:nkda\|nka\|no known/.test(block.replace(/\\/g, '\\\\')) || /nkda\|nka\|no known/.test(block), 'only the lone NKDA-family default is annotated - real allergen content is never touched');
assert(app.indexOf("fieldBody('profAllergies',_algShown,") >= 0, 'the annotated value must be what the card renders');

/* the landed gate itself must still exist and be receipt-based (b940) */
assert(/function _athenaChartLanded/.test(app), 'the landed-chart predicate must exist');
assert(/No Athena history pulled for this patient yet\./.test(app), 'the b940 honest not-pulled line must survive');

/* The calm-shell prep card carries the same three-state contract: NEVER-READ
   says "not pulled yet" in visible words; a landed chart's empty field keeps
   the quiet dash; content renders as content. Both arms pinned so the fix
   cannot collapse the states in either direction. */
{
  const shell = fs.readFileSync(path.join(ROOT, 'feat_mls_calm_shell.js'), 'latin1');
  const start = shell.indexOf('var neverRead = false;');
  assert(start >= 0, 'the calm-shell never-read state is missing');
  const block = shell.slice(start, shell.indexOf(".join('');", start));
  assert(/_athenaChartLanded/.test(block), 'the never-read test must ride the app receipt predicate, never a guess');
  assert(/empty && neverRead/.test(block) && /not pulled yet<\/span>/.test(block), 'a never-read empty field must say "not pulled yet" in visible words (pre-fix rendered the same dash as read-and-thin)');
  assert(/\} else if \(empty\) \{/.test(block) && /title="Not captured\. This does not mean the chart is empty/.test(block), 'a landed chart\'s empty field must KEEP the quiet dash - labeling everything not-pulled is as wrong as the default');
  assert(/these fields are unread, not empty/.test(block), 'the tooltip must state the unread-vs-empty distinction');
}

/* Owner 2026-08-09 ("every person is allergic to NKDA"): the three-state fired
   only on EMPTY fields, so a FILLED default (the stored NKDA on a never-read
   record) still rendered as a plain chart fact on the prep card. Fourth state:
   never-read + NKDA-class value renders the value PLUS the unverified label,
   exactly as b967 does on the profile surface. Both directions pinned: the
   label must appear for never-read NKDA, and a LANDED chart's NKDA must stay
   unannotated (a verified negative is a real chart fact). */
{
  /* utf8 read: the unverified label carries a real em-dash (matching b967's
     profile phrasing); a latin1 read splits it into three bytes and the pin
     misses (the ascii-apostrophes-poison-the-block-scanner class). */
  const shell = fs.readFileSync(path.join(ROOT, 'feat_mls_calm_shell.js'), 'utf8');
  const start = shell.indexOf('var neverRead = false;');
  const block = shell.slice(start, shell.indexOf(".join('');", start));
  assert(/\} else if \(neverRead && \/\^\\s\*\(\?:nkda\|nka\|no known \(\?:drug \)\?allerg\(\?:y\|ies\)\)\\b\/i\.test\(f\.value\)\) \{/.test(block),
    'the filled-default fourth state must gate on never-read AND the NKDA-class value');
  assert(/ — unverified \(no Athena chart pulled yet\)<\/span>/.test(block),
    'a never-read NKDA must carry the unverified label on the prep card');
  assert(/a stored default, not a verified chart fact/.test(block),
    'the tooltip must name the value as a stored default');
  const fourthAt = block.indexOf('} else if (neverRead &&');
  const dashAt = block.indexOf('} else if (empty) {');
  const contentAt = block.indexOf('} else {');
  assert(dashAt >= 0 && fourthAt > dashAt && contentAt > fourthAt,
    'state order must be: empty+neverRead, empty, filled-default, content - so a LANDED NKDA still renders plain (a verified negative is a chart fact)');
  const reverted = block.replace(/\} else if \(neverRead && [\s\S]*?\} else \{/, '} else {');
  assert(!/ — unverified \(no Athena chart pulled yet\)<\/span>/.test(reverted),
    'CONTROL: the pre-fix shape (no fourth state) must fail the label pin');
}

console.log('unverified-default-never-reads-as-fact: PASS (16 checks)');
