const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'lawyers.html'), 'utf8');
const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// The public attorney experience uses the same calm editorial design system as
// the main MLS homepage without replacing the working directory/request logic.
assert(html.includes('href="fonts/fonts.css"'), 'attorney page must load the shared MLS fonts');
assert(html.includes('<meta name="theme-color" content="#204034">'), 'attorney page theme must use MLS deep green');
assert(html.includes("--serif:'Newsreader'"), 'attorney page must use the editorial Newsreader heading face');
assert(html.includes("--sans:'Public Sans'"), 'attorney page must use the shared Public Sans body face');
assert(html.includes('--paper:#FBFAF7') && html.includes('--deep:#204034'), 'shared paper/deep-green palette is missing');
assert(html.includes('.hero h1 .grad{background:none;color:var(--green);font-style:italic}'), 'attorney hero must use the new editorial emphasis');
assert(html.includes('.dark{background:var(--deep)'), 'report-type band must use the redesigned MLS green');
assert(html.includes('<b>MLS Scribe</b><span class="tagpill">For Attorneys</span>'), 'attorney header must use the redesigned MLS brand lockup');
assert(html.includes('.nav .links a{color:var(--ink2);font-size:14.5px;font-weight:500;white-space:nowrap}'), 'attorney navigation labels must stay on one line');

// Directory, geolocation, request transport, and secure portal entry remain wired.
['dirSearch', 'dirSpec', 'dirState', 'dirGrid', 'dirStateMsg'].forEach(id => {
  assert(html.includes(`id="${id}"`), `expert directory control ${id} is missing`);
});
assert(html.includes("BACKEND_URL+'/api/public/experts'"), 'live expert directory endpoint is missing');
assert(html.includes('onsubmit="return submitRequest(event)"'), 'attorney request JavaScript handler is missing');
assert(html.includes('action="https://formsubmit.co/michael@mlsscribe.com" method="POST"'), 'request form needs a working no-JavaScript fallback');
assert(html.includes('const REQUEST_ENDPOINT="https://formsubmit.co/ajax/michael@mlsscribe.com"'), 'AJAX request transport is missing');
assert(html.includes('Already have an attorney portal login? <a href="ScribeFlow.html">Sign in here</a>'), 'attorney portal sign-in path is missing');
assert(html.includes('href="MLS_Sample_Report.pdf"'), 'sample report link is missing');
assert(fs.existsSync(path.join(root, 'MLS_Sample_Report.pdf')), 'sample report file is missing');

assert(home.includes('.sales-video{padding:76px 0 48px}'), 'homepage sales video should sit lower beneath the hero');

console.log('PASS attorney redesign: editorial MLS theme, live directory, request fallback, portal and sample-report paths');
