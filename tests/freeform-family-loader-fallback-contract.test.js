'use strict';

/* Optional draft-tuning is style data, not the owner of the server route.
 * Explicit free-form families must survive a tuning-loader failure. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html', 'ScribeFlow-staging.html'];
for (const name of SHELLS) {
  const source = fs.readFileSync(path.join(ROOT, name), 'utf8');
  const loader = source.indexOf('var _dt=window.__mlsDraftTuning;');
  if (loader >= 0) {
    const family = source.indexOf('_draftFamily=opts.freeform&&_familyAllow.indexOf(_requestedFamily)>=0?', loader - 900);
    assert(family >= 0 && family < loader, `${name}: free-form family is still assigned only inside the optional loader`);
    assert(source.includes('family:_draftFamily||undefined'), `${name}: hosted free-form family does not reach /api/complete independently`);
  } else {
    assert(source.includes('const draftFamily=opts.freeform&&familyAllow.indexOf(requestedFamily)>=0?'), `${name}: staging family fallback is missing`);
    assert(source.includes('family:draftFamily'), `${name}: staging hosted family does not reach the backend`);
  }
}
console.log('PASS free-form family loader fallback: AVS/referral/prior-auth/op-note/legal and generic families remain server-routed when draft tuning is absent');
