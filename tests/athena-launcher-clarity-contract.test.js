'use strict';

/* One Athena mental model: every contextual entry opens the existing unified
   What -> Where -> How sheet. No adjacent/proxy launcher may compete with it,
   and the separate section sorter must tell the truth about its local-only
   update before handing off to that sheet. Source-only; no network or writes. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const previewShell = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const connector = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const flow = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

assert(/id="pushAllEmrBtn"[^>]*>Review Athena actions<\/button>/.test(shell),
  'the canonical visit launcher must plainly open the Athena action review');
assert(!/id="sendEmrBtn"/.test(shell),
  'the retired adjacent Paste-note/Send launcher must not return');
assert(!/id="sendEmrBtn"/.test(previewShell),
  'the /1p preview must not retain the retired adjacent Paste-note/Send launcher');

const previewEntries = between(connector, '/* ---- entry points', 'window.__mlsAthenaPreview_revert');
const noteCardEntry = between(previewEntries, 'function ensureNoteCardBtn()', '/* (b) Easy (ez3) entry');
assert(/removeChild\(existing\)/.test(noteCardEntry),
  'the note card must remove any stale preview proxy in every capability state');
assert(!/createElement\(['"]button['"]\)|insertBefore\(/.test(noteCardEntry),
  'the note card must never manufacture an adjacent proxy launcher');
assert(/querySelector\('#ez3Send'\)[\s\S]*existing\.parentNode\.removeChild\(existing\)/.test(previewEntries),
  'Easy mode must keep its contextual launcher and remove the retired extra row');

const guided = between(connector, 'function makeCta(){', 'function boot(){');
assert(/querySelector\('\.'\+CLS\+'-send'\)/.test(guided) && /removeChild\(stale\)/.test(guided),
  'guided mode must remove a stale proxy launcher');
assert(!/createElement\(['"]button['"]\)/.test(guided),
  'guided mode must not manufacture another Athena launcher');

const gear = between(connector, 'function injectGear(){', 'function layout(){');
assert(/querySelectorAll\('\.mlsWbGear'\)/.test(gear) && /removeChild\(gears\[i\]\)/.test(gear),
  'the nonfunctional destination gear must be removed, not duplicated');
assert(!/createElement/.test(gear), 'the retired destination gear must never be recreated');

const localPanelAt = connector.indexOf('MLS draft sections - review &amp; confirm');
assert(localPanelAt >= 0, 'local MLS draft-section panel is missing');
const localPanel = connector.slice(localPanelAt - 900, localPanelAt + 3800);
assert(/id="emrIns"[^>]*>Update local MLS draft<\/button>/.test(localPanel),
  'the section sorter must name its action as a local draft update');
assert(/updates only the local MLS note draft; it never writes or sends anything to Athena/i.test(localPanel),
  'the section sorter must disclose its local-only boundary');
assert(/background:#FCFBF8[^']*color:#203b2e/.test(connector),
  'the local-only handoff text must keep readable dark-on-light contrast');
const localHandler = between(localPanel, "host.querySelector('#emrIns').onclick=function(){", 'function addBtn(){');
/* noteact-1.0.0 refactored the direct getElementById('mls-note') into a
   shared noteEl() resolver that also tries #noteBox/#mls-tx and tells the
   truth when no editor exists on screen (instead of claiming "Local draft
   updated" either way). Pin the PROPERTY - the handler still resolves the
   MLS note, one way or the other - not the literal call, and separately
   pin that noteEl() itself still names 'mls-note' among its fallbacks. */
assert(/noteEl\(\)|getElementById\('mls-note'\)/.test(localHandler),
  'the local update must still update the MLS note');
const noteElFn = between(connector, 'function noteEl(){', 'function ');
assert(/getElementById\('mls-note'\)/.test(noteElFn),
  'noteEl() dropped mls-note from its fallback chain');
assert(!/postMessage|mlsAppAthenaAction|pushEntireVisitToAthena|openUnifiedConfirmation/.test(localHandler),
  'the local update button must not cross the Athena bridge');

const panelEntry = between(connector, 'function enhance(panel) {', 'var mo = new MutationObserver');
assert(/b\.id = 'emrWbAthena'/.test(panelEntry) && /Review Athena actions/.test(panelEntry),
  'the section sorter needs one contextual handoff to the unified Athena review');
assert(/window\.pushEntireVisitToAthena\(null\)/.test(panelEntry),
  'the section-sorter handoff must delegate to the canonical visit review when available');

const takeover = between(flow, 'function enhancePanel(panel)', '/* ------------------------- suggested orders chips');
assert(/Review selected Athena actions/.test(takeover) && /wf2AthenaGuide/.test(takeover),
  'selected sections must enter the same clear What/Where/How review');
assert(/What &rarr; exact Athena Where &rarr; How/.test(takeover),
  'the contextual handoff must explain what the unified review shows');
assert(!/emrWbSave|actionButton\s*\(/.test(takeover),
  'the section sorter must not add a competing Athena Save/action control');
assert(!/mode\s*:\s*['"]execute['"]|mlsAppAthenaActionV2/.test(takeover),
  'opening the contextual review must not execute an Athena action');
assert(!/Placement still happens in Athena, by you/.test(flow) &&
  /READY order row can now be selected and separately confirmed/.test(flow) &&
  /rebuilt order row remains MANUAL in Athena/.test(flow) &&
  /rebuilt order row remains BLOCKED/.test(flow),
  'accepted-order feedback must reflect the rebuilt READY, MANUAL, or BLOCKED row instead of claiming every order is manual');

assert(/label: canPush \? '[^']*Save & review for Athena'/.test(shell),
  'an unsaved op note must say it saves locally and opens review, not claim it already sent');
assert(/return \{ label: '[^']*Review for Athena'/.test(shell),
  'a saved op note must open review without claiming it already sent');
assert(/label: canPush \? '[^']*Save & review for Athena'/.test(previewShell) && /return \{ label: '[^']*Review for Athena'/.test(previewShell),
  'the /1p preview must carry the same truthful op-note review labels');
assert(/supported catalog-bound imaging\/PT\/referral\/DME order/.test(shell) && /supported catalog-bound imaging\/PT\/referral\/DME order/.test(previewShell),
  'both canonical shells must describe supported order confirmations without claiming every order is manual');

console.log('PASS Athena launcher clarity: one canonical review model, proxies/gears retired, local sorter truthful, op-note handoff truthful, zero launcher execute path');
