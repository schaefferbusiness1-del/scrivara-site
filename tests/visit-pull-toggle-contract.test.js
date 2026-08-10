'use strict';

/* "Full visit notes" toggle: OFF pulls schedule + six-card chart history only.
   The skipped stage must be recorded honestly (visitsSkipped), and the skip
   may never fabricate visit evidence (no parsedVisits/visitCount).

   2026-07-28 SUPERSESSION of the 2026-07-21 default-OFF call: the toggle that
   could opt anyone in never rendered (the b760 finding), so 47 of 51 live
   snapshot patients carried ONLY index-only visit stubs — no encounter body
   was ever read, organizePatientHistory early-returned fleet-wide, and no
   human had ever actually chosen the fast lane. The owner's standing bar
   (first-pull completeness, no silent omissions, "a normal user signs into
   Athena and that is all") requires bodies by DEFAULT. An explicit human
   choice — recorded via the pullVisitBodiesSet marker, which only the
   toggles write — is respected in both directions. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const importer = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const gate = importer.indexOf('var pullVisitBodies = safe(function () {');
assert(gate >= 0, 'importer must resolve the pullVisitBodies preference');
const block = importer.slice(gate, gate + 1600);
/* qol-2.0: the importer consults the ONE resolver (default ON + human-choice
   marker are execution-proven on the shipped resolver in
   pull-visit-bodies-default-on.test.js; per-site flip in qol-resolver-four-sites) */
assert(/__mlsVisitNotesPref/.test(block), 'the importer must consult the ONE resolver, never raw keys');
assert(/return vnp\.read\(\)\.on === true/.test(block), 'the resolved tri-state governs the batch');
assert(block.indexOf('_pullBodiesOverride') >= 0 && block.indexOf('_pullBodiesOverride') < block.indexOf('__mlsVisitNotesPref'),
  'the per-pull override is consulted BEFORE the resolver');
assert(importer.includes('one.visitsSkipped = true'), 'a skipped visits stage must be recorded as visitsSkipped');
const skipStart = importer.indexOf('one.visitsSkipped = true');
const skipBlock = importer.slice(skipStart - 300, skipStart + 300);
assert(!/parsedVisits|visitCount|persistedVisits/.test(skipBlock), 'the skip path must never fabricate visit evidence');
assert(importer.includes('one.visitsSkipped!==true&&one.visitsVerifiedCarry!==true&&one.organized'), 'clinical-field coverage check must not misfire on skipped or carried visits (si-2.0.0)');

assert(connect.includes("id=\"mlsDsVisitBodies\""), 'day-pull card must expose the Full visit notes toggle');
assert(connect.includes('r.write(tgl.checked === true)'), 'toggle must persist through the ONE resolver (which owns the namespaced keys)');
assert(connect.includes("tgl.checked = (r && typeof r.read === 'function') ? r.read().on === true : true"),
  'toggle UI must paint the resolved tri-state, defaulting ON (2026-07-28 supersession)');

assert(connect.includes("id = 'mlsDsPullBar'"), 'day pull must render a progress bar');
assert(connect.includes('(\\d+)\\s+of\\s+(\\d+)') || /\(\\d\+\)\\s\+of\\s\+\(\\d\+\)/.test(connect) || connect.includes('match(/(\\d+)\\s+of\\s+(\\d+)/)'), 'progress bar must parse X of N counts');

console.log('PASS visit-pull toggle: default ON, honest visitsSkipped receipt, no fabricated evidence, visible day-pull progress bar');
