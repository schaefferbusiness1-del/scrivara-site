'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const lawyers = fs.readFileSync(path.join(root, 'lawyers.html'), 'utf8');
const expert = fs.readFileSync(path.join(root, 'expert.html'), 'utf8');

function inlineScript(html, label) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert(scripts.length, `${label} inline script missing`);
  return scripts[scripts.length - 1][1];
}

function element(id) {
  const classes = new Set();
  return {
    id,
    style: {},
    className: '',
    innerHTML: '',
    textContent: '',
    value: '',
    children: [],
    attributes: {},
    classList: {
      add(...names) { names.forEach(name => classes.add(name)); },
      remove(...names) { names.forEach(name => classes.delete(name)); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    appendChild(child) { this.children.push(child); return child; },
    addEventListener() {},
    focus() {}
  };
}

function browserHarness(script, page, payload) {
  const elements = new Map();
  const requests = [];
  const document = {
    title: '',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
    createElement(tag) { return element(tag); }
  };
  const location = {
    href: `https://evaluation.example/${page}`,
    search: page === 'expert.html' ? '?id=clean-1' : ''
  };
  const context = {
    document,
    location,
    history: { replaceState() {} },
    URL,
    URLSearchParams,
    console,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => payload };
    }
  };
  context.window = context;
  vm.runInContext(script, vm.createContext(context), { filename: page });
  return { document, elements, requests };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function assertPrivateFetch(run, label) {
  assert.strictEqual(run.requests.length, 1, `${label} made an unexpected number of requests`);
  const options = run.requests[0].options || {};
  assert.strictEqual(options.cache, 'no-store', `${label} may cache the directory response`);
  assert.strictEqual(options.credentials, 'omit', `${label} sends ambient credentials`);
  assert.strictEqual(options.referrerPolicy, 'no-referrer', `${label} sends a referrer`);
}

const cleanProfile = {
  id: 'clean-1',
  name: 'Alex Rowan, MD',
  specialty: 'Physical medicine and rehabilitation',
  credentials: 'Physician-supplied credentials',
  states: ['IN'],
  bio: 'Focused clinical background.'
};

(async () => {
  assert(lawyers.includes('if(d.released!==true)'), 'directory does not require explicit released:true');
  assert(lawyers.includes('.filter(isReleasedProfile)'), 'directory does not filter held profile content');
  assert(expert.includes('d.released!==true||!isReleasedProfile(d.expert)'), 'detail page does not require explicit release and clean content');
  assert(lawyers.includes('No independently verified public experts are released yet'), 'directory held-state truth is missing');
  assert(expert.includes('No independently verified public expert profile is released here'), 'detail held-state truth is missing');
  assert(lawyers.includes('name="robots" content="noindex,nofollow,noarchive"'), 'held directory must not be indexed');
  assert(expert.includes('name="robots" content="noindex,nofollow,noarchive"'), 'held profile surface must not be indexed');

  for (const staleClaim of [
    'live directory',
    'participating physicians',
    'we’ll match your case',
    'Board-certified, still treating patients',
    'Actively practicing',
    'Deposition & trial ready',
    'Transparent fees',
    'Connecting attorneys with board-certified',
    'Request this expert',
    'Fees on request'
  ]) {
    assert(!lawyers.toLowerCase().includes(staleClaim.toLowerCase()), `lawyers page retains unsupported claim: ${staleClaim}`);
    assert(!expert.toLowerCase().includes(staleClaim.toLowerCase()), `expert page retains unsupported claim: ${staleClaim}`);
  }

  const lawyersScript = inlineScript(lawyers, 'lawyers.html');
  const expertScript = inlineScript(expert, 'expert.html');

  const heldDirectory = browserHarness(lawyersScript, 'lawyers.html', { released: false, experts: [cleanProfile] });
  await settle();
  assertPrivateFetch(heldDirectory, 'held directory');
  const heldDirectoryText = heldDirectory.document.getElementById('dirStateMsg').innerHTML;
  assert(heldDirectoryText.includes('No independently verified public experts are released yet'), 'released:false leaked a directory profile');
  assert(!heldDirectoryText.includes(cleanProfile.name), 'released:false rendered a physician identity');

  const missingReleaseDirectory = browserHarness(lawyersScript, 'lawyers.html', { experts: [cleanProfile] });
  await settle();
  assert(missingReleaseDirectory.document.getElementById('dirStateMsg').innerHTML.includes('No independently verified public experts are released yet'), 'missing directory release flag did not fail closed');

  /* h9-1.0.0 (2026-09-25): ONE release rule, the server's
     (expertDirectoryRelease.js, pinned in the backend suites). These pages
     used to re-check released rows with a different list and hid a profile the
     doctor was told is released: "Co-edited" in a bio, or a "Sample IME report"
     document. A released row is shown as released; a row with no id or name is
     still dropped because there is nothing to show. */
  const coEdited = { ...cleanProfile, id: 'released-2', name: 'Dana Reyes, MD', bio: 'Co-edited the 2024 regional spine trauma protocol.' };
  const nameless = { ...cleanProfile, id: 'nameless-1', name: '' };
  const releasedDirectory = browserHarness(lawyersScript, 'lawyers.html', { released: true, experts: [coEdited, cleanProfile, nameless] });
  await settle();
  assertPrivateFetch(releasedDirectory, 'released directory');
  const releasedGrid = releasedDirectory.document.getElementById('dirGrid').innerHTML + releasedDirectory.document.getElementById('dirFeatured').innerHTML;
  assert(releasedGrid.includes(cleanProfile.name), 'clean explicitly released profile did not render');
  assert(releasedGrid.includes(coEdited.name), 'a profile the server released was hidden by a second, client-side rule');
  assert(!releasedGrid.includes('nameless-1'), 'a released row with no name rendered');

  const heldDetail = browserHarness(expertScript, 'expert.html', { released: false, expert: cleanProfile });
  await settle();
  assertPrivateFetch(heldDetail, 'held detail');
  assert(heldDetail.document.getElementById('loadState').innerHTML.includes('No independently verified public expert profile is released here'), 'detail accepted released:false');
  assert.strictEqual(heldDetail.document.getElementById('content').style.display, 'none', 'held detail exposed profile content');

  const missingReleaseDetail = browserHarness(expertScript, 'expert.html', { expert: cleanProfile });
  await settle();
  assert(missingReleaseDetail.document.getElementById('loadState').innerHTML.includes('No independently verified public expert profile is released here'), 'detail accepted a missing release flag');

  const documentDetail = browserHarness(expertScript, 'expert.html', {
    released: true,
    expert: { ...cleanProfile, documents: [{ label: 'Sample IME report (redacted)', url: '/api/public/experts/clean-1/documents/1' }] }
  });
  await settle();
  assert(!documentDetail.document.getElementById('loadState').innerHTML.includes('No independently verified public expert profile is released here'),
    'a released profile read as unreleased because of a document label');
  assert.strictEqual(documentDetail.document.getElementById('content').style.display, 'block', 'a released profile with a document did not render');

  const releasedDetail = browserHarness(expertScript, 'expert.html', { released: true, expert: cleanProfile });
  await settle();
  assertPrivateFetch(releasedDetail, 'released detail');
  const content = releasedDetail.document.getElementById('content');
  assert.strictEqual(content.style.display, 'block', 'clean explicitly released detail did not render');
  assert(content.innerHTML.includes(cleanProfile.name), 'released detail omitted physician name');
  assert(content.innerHTML.includes('not independently verified by MLS'), 'released detail fails to qualify physician-supplied claims');
  assert(content.innerHTML.includes('Case intake and physician engagement are unavailable'), 'released detail looks actionable');

  console.log('PASS expert public release boundary: explicit release required, the server release rule is the only one, directory and detail fail closed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
