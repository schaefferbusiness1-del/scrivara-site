'use strict';

/* An unassigned draft must not be offered to a different person.
 *
 * feat_autosave.js keys drafts as `kind + "::" + scopeId()`, and scopeId() ends
 * at activePtId(), which returns the literal string "none" when no patient is
 * selected. So EVERY unassigned/walk-in visit shares one bucket —
 * `transcript::none`.
 *
 * doRecover already refuses when the key changed ("A recovery prompt can
 * outlive a patient/history-note switch"), and that guard is correct — but it
 * has no power inside the shared bucket, because the key is identical for two
 * different walk-ins. And the bar named nobody: "Recover unsaved transcript
 * from 4 min ago?" is impossible to answer safely, because the doctor cannot
 * tell whose text it is.
 *
 * Reachable path: walk-in A, transcript pasted (stored under transcript::none),
 * A leaves before Generate so savedAt stays 0 → walk-in B → newVisit() clears
 * the box and its own DOM writes trip the observer → the Recover bar appears on
 * B's fresh visit screen → Recover puts A's transcript in B's box, fires input,
 * binds the visit, and Generate Note produces B's note from A's encounter.
 * Dictated text never enters this store (the recogniser writes .value with no
 * input event), so this is typed/pasted content.
 *
 * The core app already has this guard by name: ScribeFlow.html:6923 computes
 * `mismatch` and :6957 refuses a cross-patient restore outright.
 *
 * KNOWN LIMIT, deliberately not overclaimed: two consecutive walk-ins with NO
 * typed name in #patientLabel still share an indistinguishable bucket. This
 * change withholds the offer whenever the two labels are both present and
 * differ — which is proof of a different visit — and otherwise NAMES the owner
 * so the decision is the doctor's rather than a blind yes/no. The complete fix
 * is a per-visit instance id in the key; that is a larger change and is not
 * what this claims to be.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_autosave.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* the owner is recorded with every draft */
assert(/function ptLabelNow\(\)/.test(src),
  'no way to read who the visit is for, so a draft cannot record its owner');
assert(/ptLabel: ptLabelNow\(\)/.test(src),
  'the snapshot does not capture the patient label at save time');
assert(/o\.drafts\[key\] = \{ text: norm\(val\), ts: now\(\), kind: f\.kind, ptId: snap\.ptId, ptLabel: snap\.ptLabel \|\| "" \};/.test(src),
  'the stored draft does not carry its owner, so no later check can use it');

/* an offer that provably belongs to someone else is withheld */
assert(/var curLabel = ptLabelNow\(\);\n\s*if \(d\.ptLabel && curLabel && d\.ptLabel !== curLabel\) return;/.test(src),
  'a draft whose recorded owner differs from the current patient is still offered');

/* and what cannot be proven is NAMED rather than guessed at */
assert(/var who = d\.ptLabel \? \(" for " \+ d\.ptLabel\) : "";/.test(src),
  'the Recover bar does not name the draft owner');
assert(/"Recover unsaved " \+ \(f\.label \|\| "draft"\) \+ who \+ " from "/.test(src),
  'the Recover bar text no longer includes the owner');

/* the pre-existing key guard must survive - it covers the switch-after-prompt
   case that the owner check does not */
assert(/if \(keyFor\(f\) !== key\) \{ removeRecoverUI\(el\); return false; \}/.test(src),
  'doRecover lost its key guard, which is the protection for a prompt that outlived a patient switch');

/* the app-side guard this mirrors must still exist, or the asymmetry is back */
assert(/var _dpid=String\(d\.ptId\|\|''\)\.trim\(\)/.test(shell) && /belongs to '\+String\(d\.pt\|\|'another patient'\)/.test(shell),
  'the core app cross-patient draft refusal changed; re-check what this module must mirror');

console.log('PASS autosave draft owner: an unassigned draft records its owner, is withheld from a different one, and names itself in the offer');
