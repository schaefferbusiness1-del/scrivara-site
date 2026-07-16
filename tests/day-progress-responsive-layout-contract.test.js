const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const agenda = fs.readFileSync(path.join(root, 'feat_mls_agenda_popover.js'), 'utf8');
const continuity = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

// The legacy patient bar uses an expanding middle grid track. The progress
// item may own that grid area, but must size to its contents instead of
// stretching across the track (the oversized blue bar from the owner capture).
assert(
  agenda.includes('justify-self:start;width:max-content;max-width:min(361px,100%);overflow:hidden;'),
  'legacy day-progress grid item can still stretch across the patient bar'
);
assert(
  agenda.includes('#patientBar>#mlsDayProgress .mdp-next{min-width:0;overflow:hidden;text-overflow:ellipsis;}'),
  'narrow legacy progress pills cannot safely shorten the next-patient label'
);

// Recent remains an intrinsic chip in its own desktop and mobile grid slot;
// its nowrap label cannot be squeezed or clipped by the progress item.
assert(
  agenda.includes('#patientBar>#mlsRecentPts{grid-column:3;grid-row:2;margin-left:0!important;justify-self:start;'),
  'desktop Recent control lost its fixed grid placement'
);
assert(
  agenda.includes('#patientBar>#mlsRecentPts{grid-column:1;grid-row:4;justify-self:start;min-width:max-content;'),
  'mobile Recent control is not kept at readable intrinsic width'
);
assert(
  agenda.includes('#patientBar>#mlsRecentPts .mrp-btn{max-width:100%;}'),
  'Recent button is not bounded by the available patient-bar width'
);

// The active-patient flex bar follows the same compact contract. It caps the
// pill at the former stable-label ceiling but no longer reserves that width or
// turns mobile progress into a full-width row.
assert(
  continuity.includes('#mlsCtxBar>#mlsDayProgress{box-sizing:border-box;flex:0 1 auto;min-width:0;max-width:min(361px,100%);width:max-content;align-self:flex-start;overflow:hidden;justify-content:flex-start;}'),
  'active-patient progress pill is not intrinsic and capped'
);
assert(!continuity.includes('flex:0 0 361px;min-width:361px'), 'active-patient progress still reserves a fixed 361px column');
assert(!continuity.includes('flex:1 1 100%;min-width:0;width:100%'), 'mobile progress still expands to a full-width blue bar');
assert(
  continuity.includes('#mlsCtxBar>#mlsRecentPts{box-sizing:border-box;flex:0 0 auto;min-width:max-content;max-width:100%;align-self:flex-start;}'),
  'active-patient Recent control can still shrink or clip'
);

assert(connect.includes("A+'?v=20260716ui115'"), 'compact active-bar CSS is not cache-busted');
assert(connect.includes('A+"?v=20260716ag-stable4"'), 'compact legacy-bar CSS is not cache-busted');

console.log('PASS day-progress responsive layout: compact progress pill and readable Recent control on desktop/mobile');
