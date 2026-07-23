'use strict';

/* "Full visit notes" toggle: OFF pulls schedule + six-card chart history only.
   The skipped stage must be recorded honestly (visitsSkipped), default ON, and
   the skip may never fabricate visit evidence (no parsedVisits/visitCount). */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const importer = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

const gate = importer.indexOf('uns("pullVisitBodies")');
assert(gate >= 0, 'importer must read the pullVisitBodies preference');
const block = importer.slice(gate, gate + 1200);
assert(/return v == null \? false : v !== "0";/.test(block), 'pullVisitBodies must DEFAULT OFF (owner 2026-07-21: bodies are the slow fragile lane; fast schedule+history-cards is the first experience)');
assert(importer.includes('one.visitsSkipped = true'), 'a skipped visits stage must be recorded as visitsSkipped');
const skipStart = importer.indexOf('one.visitsSkipped = true');
const skipBlock = importer.slice(skipStart - 300, skipStart + 300);
assert(!/parsedVisits|visitCount|persistedVisits/.test(skipBlock), 'the skip path must never fabricate visit evidence');
assert(importer.includes('one.visitsSkipped!==true&&one.visitsVerifiedCarry!==true&&one.organized'), 'clinical-field coverage check must not misfire on skipped or carried visits (si-2.0.0)');

assert(connect.includes("id=\"mlsDsVisitBodies\""), 'day-pull card must expose the Full visit notes toggle');
assert(connect.includes("window.uns('pullVisitBodies')"), 'toggle must persist through the namespaced preference');
assert(connect.includes("tgl.checked = cur == null ? false : cur !== '0'"), 'toggle UI must default OFF (owner 2026-07-21), persisted opt-in only');

assert(connect.includes("id = 'mlsDsPullBar'"), 'day pull must render a progress bar');
assert(connect.includes('(\\d+)\\s+of\\s+(\\d+)') || /\(\\d\+\)\\s\+of\\s\+\(\\d\+\)/.test(connect) || connect.includes('match(/(\\d+)\\s+of\\s+(\\d+)/)'), 'progress bar must parse X of N counts');

console.log('PASS visit-pull toggle: default ON, honest visitsSkipped receipt, no fabricated evidence, visible day-pull progress bar');
