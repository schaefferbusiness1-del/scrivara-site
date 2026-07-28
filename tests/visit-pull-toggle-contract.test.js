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

const gate = importer.indexOf('uns("pullVisitBodies")');
assert(gate >= 0, 'importer must read the pullVisitBodies preference');
const block = importer.slice(gate, gate + 1600);
assert(/return chosen \? v !== "0" : true;/.test(block), 'pullVisitBodies must DEFAULT ON unless a recorded human choice says otherwise (2026-07-28; execution-proven in pull-visit-bodies-default-on.test.js)');
assert(/pullVisitBodiesSet/.test(block), 'the importer must consult the human-choice marker, not the bare legacy value');
assert(importer.includes('one.visitsSkipped = true'), 'a skipped visits stage must be recorded as visitsSkipped');
const skipStart = importer.indexOf('one.visitsSkipped = true');
const skipBlock = importer.slice(skipStart - 300, skipStart + 300);
assert(!/parsedVisits|visitCount|persistedVisits/.test(skipBlock), 'the skip path must never fabricate visit evidence');
assert(importer.includes('one.visitsSkipped!==true&&one.visitsVerifiedCarry!==true&&one.organized'), 'clinical-field coverage check must not misfire on skipped or carried visits (si-2.0.0)');

assert(connect.includes("id=\"mlsDsVisitBodies\""), 'day-pull card must expose the Full visit notes toggle');
assert(connect.includes("window.uns('pullVisitBodies')"), 'toggle must persist through the namespaced preference');
assert(connect.includes("tgl.checked = chosen ? cur !== '0' : true"), 'toggle UI must default ON and respect only a recorded human choice (2026-07-28 supersession)');

assert(connect.includes("id = 'mlsDsPullBar'"), 'day pull must render a progress bar');
assert(connect.includes('(\\d+)\\s+of\\s+(\\d+)') || /\(\\d\+\)\\s\+of\\s\+\(\\d\+\)/.test(connect) || connect.includes('match(/(\\d+)\\s+of\\s+(\\d+)/)'), 'progress bar must parse X of N counts');

console.log('PASS visit-pull toggle: default ON, honest visitsSkipped receipt, no fabricated evidence, visible day-pull progress bar');
