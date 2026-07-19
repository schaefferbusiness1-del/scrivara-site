'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'feat_mls_header_exact.js'), 'utf8');

assert(!/@gmail\.com/i.test(source), 'shared clinician bundle contains personal-email admin policy');
assert(!/PERSONAL_EMAILS|u\.isAdmin\s*=\s*false/.test(source),
  'frontend still mutates authenticated admin identity using a client-only exception');
assert(/return !!u\.isAdmin/.test(source), 'Admin visibility does not follow the authenticated server claim');
assert(/authorization remains server-enforced/.test(source), 'server authorization boundary is not documented');

console.log('PASS admin identity: no personal-email policy in client; UI follows server claim and API remains authoritative');
