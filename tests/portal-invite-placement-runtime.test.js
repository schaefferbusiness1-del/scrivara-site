'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const fullSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const start = fullSource.indexOf('/* feat_portal_invite');
const end = fullSource.indexOf('/* ===== feat: MLS active-patient prominence', start);
assert(start >= 0 && end > start, 'patient portal feature boundary was not found');
const source = fullSource.slice(start, end);
assert(source.includes("if(em && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em))"), 'portal dialog must reject malformed email addresses before sending');
assert(source.includes('res.j && res.j.sent===false'), 'portal dialog must not report an unsent email as a successful send');
assert(fullSource.includes("#mlsCtxBar .mlsctx-actions>#mlsPortalInviteBtn"), 'phone layout must keep the selected-patient portal action visible');
assert(fullSource.includes("#mlsCtxBar .mlsctx-actions>.mlsctx-switch"), 'phone layout must keep patient switching beside the portal action');
assert(fullSource.includes('min-height:44px'), 'phone patient actions must remain touch-sized');

function makeHarness(options = {}) {
  const byId = Object.create(null);
  const observers = [];
  const fetches = [];
  const fetchResponses = Array.isArray(options.fetchResponses) ? options.fetchResponses.slice() : [];
  const alerts = [];
  let pendingMutations = 0;
  let observing = false;
  let active = Object.prototype.hasOwnProperty.call(options, 'active')
    ? options.active
    : { id: 'A', name: 'Patient A', dob: '01/01/1980', email: 'a@example.test' };
  let patients = Object.prototype.hasOwnProperty.call(options, 'patients')
    ? options.patients
    : (active ? [active] : []);

  function descendants(rootEl) {
    const out = [];
    (function visit(node) {
      for (const child of node.children || []) {
        out.push(child);
        visit(child);
      }
    })(rootEl);
    return out;
  }

  function hasClass(el, cls) {
    return (` ${el.className || ''} `).includes(` ${cls} `);
  }

  function matches(el, selector) {
    if (!el) return false;
    if (selector[0] === '#') return el.id === selector.slice(1);
    if (selector[0] === '.') return hasClass(el, selector.slice(1));
    if (selector === 'button[data-act="switch"]') {
      return el.tagName === 'BUTTON' && el.getAttribute('data-act') === 'switch';
    }
    return false;
  }

  function isConnected(el) {
    for (let cur = el; cur; cur = cur.parentNode) {
      if (document && cur === document.documentElement) return true;
    }
    return false;
  }

  class Element {
    constructor(tag) {
      this.tagName = String(tag || 'div').toUpperCase();
      this.nodeType = 1;
      this.children = [];
      this.parentNode = null;
      this.className = '';
      this.attributes = Object.create(null);
      this.listeners = Object.create(null);
      this.style = {};
      this._textContent = '';
      this.title = '';
      this.type = '';
      this.value = '';
      this.disabled = false;
      this._id = '';
      this._innerHTML = '';
    }

    set id(value) {
      if (this._id && byId[this._id] === this) delete byId[this._id];
      this._id = String(value || '');
      if (this._id) byId[this._id] = this;
    }
    get id() { return this._id; }

    set textContent(value) {
      this._textContent = String(value == null ? '' : value);
      /* Setting textContent produces a childList mutation even when callers
         assign the same string. This is the feedback loop the regression must
         model, rather than silently treating same-value writes as no-ops. */
      if (observing && isConnected(this)) pendingMutations += 1;
    }
    get textContent() { return this._textContent; }

    set innerHTML(value) {
      this._innerHTML = String(value || '');
      this.children.slice().forEach(child => this.removeChild(child));
      /* The production feature only needs these controls from its fixed modal
         markup. Materialize them so the test exercises the real handlers. */
      if (this._innerHTML.includes('id="mlsPiSend"')) {
        const email = new Element('input'); email.id = 'mlsPiEmail';
        const valueMatch = this._innerHTML.match(/id="mlsPiEmail"[^>]*value="([^"]*)"/);
        email.value = valueMatch ? valueMatch[1] : '';
        const msg = new Element('div'); msg.id = 'mlsPiMsg';
        const cancel = new Element('button'); cancel.id = 'mlsPiCancel'; cancel.textContent = 'Cancel';
        const send = new Element('button'); send.id = 'mlsPiSend'; send.textContent = 'Send login';
        this.appendChild(email); this.appendChild(msg); this.appendChild(cancel); this.appendChild(send);
      }
    }
    get innerHTML() { return this._innerHTML; }

    get nextSibling() {
      if (!this.parentNode) return null;
      const index = this.parentNode.children.indexOf(this);
      return index >= 0 ? (this.parentNode.children[index + 1] || null) : null;
    }

    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const index = before ? this.children.indexOf(before) : -1;
      if (index >= 0) this.children.splice(index, 0, child);
      else this.children.push(child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] || ''; }
    addEventListener(type, listener) {
      (this.listeners[type] || (this.listeners[type] = [])).push(listener);
    }
    querySelector(selector) {
      return descendants(this).find(node => matches(node, selector)) || null;
    }
    click() {
      const event = { target: this, preventDefault() {}, stopPropagation() {} };
      if (typeof this.onclick === 'function') this.onclick(event);
      for (const listener of this.listeners.click || []) listener.call(this, event);
    }
  }

  const document = {
    readyState: 'complete',
    createElement(tag) { return new Element(tag); },
    getElementById(id) {
      const el = byId[id];
      if (!el) return null;
      return el === this.documentElement || descendants(this.documentElement).includes(el) ? el : null;
    },
    querySelector(selector) {
      if (selector === '#mlsCtxBar .mlsctx-actions') {
        const bar = this.getElementById('mlsCtxBar');
        return bar ? bar.querySelector('.mlsctx-actions') : null;
      }
      return descendants(this.documentElement).find(node => matches(node, selector)) || null;
    },
    addEventListener() {}
  };
  document.documentElement = new Element('html');
  document.head = new Element('head');
  document.body = new Element('body');
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  const hiddenHero = new Element('div'); hiddenHero.id = 'visitHero'; hiddenHero.style.display = 'none';
  document.body.appendChild(hiddenHero);

  function MutationObserver(callback) { this.callback = callback; observers.push(this); }
  MutationObserver.prototype.observe = function observe() { observing = true; };

  const context = {
    console, Promise, Date, Math, JSON, Object, String, Array, RegExp,
    document,
    MutationObserver,
    localStorage: { getItem(key) { return key === 'sf_bk_token' ? 'test-token' : null; } },
    activePatient() { return active; },
    getPatients() { return patients; },
    requestAnimationFrame(fn) { fn(); return 1; },
    setTimeout() { return 1; }, clearTimeout() {},
    fetch(url, init) {
      fetches.push({ url, init, body: JSON.parse(init.body) });
      if (fetchResponses.length) {
        const spec = fetchResponses.shift();
        const status = Number(spec.status || (spec.ok === false ? 500 : 200));
        return Promise.resolve({
          ok: Object.prototype.hasOwnProperty.call(spec, 'ok') ? !!spec.ok : (status >= 200 && status < 300),
          status,
          json() { return Promise.resolve(spec.body || {}); }
        });
      }
      return new Promise(() => {});
    },
    alert(message) { alerts.push(message); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_portal_invite' });

  return {
    context, document, hiddenHero, observers, fetches, alerts,
    Element,
    setActive(value) { active = value; },
    setPatients(value) { patients = value; },
    reconcile() { observers.forEach(observer => observer.callback([])); },
    flushMutations(limit = 8) {
      let runs = 0;
      while (pendingMutations) {
        pendingMutations = 0;
        observers.forEach(observer => observer.callback([]));
        runs += 1;
        assert(runs <= limit, 'portal reconciliation created a self-sustaining mutation/animation-frame loop');
      }
      return runs;
    }
  };
}

async function main() {
  const h = makeHarness();
  const fallback = h.document.getElementById('mlsPortalInviteBtn');
  assert(fallback, 'portal button was not created for the active patient');
  assert.strictEqual(fallback.parentNode, h.hiddenHero, 'test did not reproduce the hidden early fallback placement');
  assert.strictEqual(h.fetches.length, 0, 'portal invite sent during injection');

  const bar = new h.Element('div'); bar.id = 'mlsCtxBar';
  const actions = new h.Element('div'); actions.className = 'mlsctx-actions';
  const chart = new h.Element('button'); chart.setAttribute('data-act', 'chart'); chart.textContent = 'Chart';
  const switchBtn = new h.Element('button'); switchBtn.className = 'mlsctx-switch'; switchBtn.setAttribute('data-act', 'switch'); switchBtn.textContent = 'Switch patient';
  actions.appendChild(chart); actions.appendChild(switchBtn); bar.appendChild(actions); h.document.body.appendChild(bar);
  h.reconcile();

  const visible = h.document.getElementById('mlsPortalInviteBtn');
  assert.strictEqual(visible, fallback, 'reconciliation duplicated the early portal button');
  assert.strictEqual(visible.parentNode, actions, 'portal button did not move into the visible patient actions');
  assert.strictEqual(visible.nextSibling, switchBtn, 'portal button was not placed immediately before Switch patient');
  assert.strictEqual(visible.textContent, 'Patient portal', 'portal action label is not clear');
  assert(visible.title.includes('Nothing sends until you click Send login'), 'portal action does not explain its explicit-send behavior');
  assert.strictEqual(h.fetches.length, 0, 'portal invite sent while moving the button');

  /* Model a real childList observer: assigning textContent queues another
     observer delivery even when the value is unchanged. Reconciliation must
     repair one stale label and then become completely quiescent. */
  visible.textContent = 'Legacy portal label';
  const observerRuns = h.flushMutations(5);
  assert.strictEqual(observerRuns, 2, 'portal label reconciliation did not settle after its one intentional text mutation');
  assert.strictEqual(visible.textContent, 'Patient portal', 'portal label was not repaired');
  assert.strictEqual(h.flushMutations(5), 0, 'idempotent portal reconciliation left another observer delivery queued');

  visible.click();
  assert(h.document.getElementById('mlsPiBack'), 'portal action did not open its review dialog');
  assert.strictEqual(h.fetches.length, 0, 'opening the portal dialog sent an invite before explicit confirmation');

  h.setActive({ id: 'B', name: 'Patient B', dob: '02/02/1980', email: 'b@example.test' });
  h.document.getElementById('mlsPiSend').click();
  assert.strictEqual(h.fetches.length, 0, 'stale patient-A dialog sent after switching to patient B');
  assert(/active patient changed/i.test(h.document.getElementById('mlsPiMsg').textContent), 'stale patient dialog did not explain why it was blocked');

  h.setActive({ id: 'A', name: 'Patient A', dob: '01/01/1980', email: 'a@example.test' });
  h.document.getElementById('mlsPiSend').click();
  assert.strictEqual(h.fetches.length, 1, 'explicit Send login did not start the invite request');
  assert.strictEqual(h.fetches[0].body.external_id, 'A', 'invite payload was not bound to the reviewed patient');

  h.setActive(null);
  h.reconcile();
  assert.strictEqual(h.document.getElementById('mlsPortalInviteBtn'), null, 'portal action remained available with no active patient');
  visible.click();
  assert.strictEqual(h.fetches.length, 1, 'detached portal control sent without an active patient');
  assert.strictEqual(h.alerts.length, 1, 'no-patient click did not fail safely');

  const partial = makeHarness({
    active: { id: undefined, athenaId: undefined, mrn: undefined, name: 'Name Only', dob: '', email: 'wrong@example.test' },
    patients: [{ id: undefined, name: 'Name Only', email: 'wrong@example.test' }]
  });
  assert.strictEqual(partial.document.getElementById('mlsPortalInviteBtn'), null, 'name-only patient placeholder received a portal action');
  assert.strictEqual(partial.fetches.length, 0, 'name-only patient placeholder triggered a send');

  const duplicate = makeHarness({
    active: { name: 'Duplicate Person', dob: '01/02/1980' },
    patients: [
      { name: 'Duplicate Person', dob: '01/02/1980', email: 'first@example.test' },
      { name: ' Duplicate   Person ', dob: '1980-01-02', email: 'second@example.test' }
    ]
  });
  assert.strictEqual(duplicate.document.getElementById('mlsPortalInviteBtn'), null, 'ambiguous duplicate name+DOB fallback received a portal action');
  assert.strictEqual(duplicate.fetches.length, 0, 'ambiguous duplicate fallback triggered a send');

  /* Both records intentionally have undefined IDs. The old `p.id===ap.id`
     comparison selected the first/wrong email. Exact name+DOB must select the
     sole matching record and produce one deterministic fallback external ID. */
  const fallbackIdentity = makeHarness({
    active: { id: undefined, athenaId: undefined, mrn: undefined, name: 'Fallback Person', dob: '03/04/1980' },
    patients: [
      { id: undefined, name: 'Wrong First Record', dob: '05/06/1980', email: 'wrong@example.test' },
      { id: undefined, name: 'Fallback Person', dob: '1980-03-04', email: 'right@example.test' }
    ]
  });
  const fallbackButton = fallbackIdentity.document.getElementById('mlsPortalInviteBtn');
  assert(fallbackButton, 'unique exact name+DOB fallback did not receive a portal action');
  fallbackButton.click();
  assert.strictEqual(fallbackIdentity.document.getElementById('mlsPiEmail').value, 'right@example.test', 'undefined IDs selected the wrong patient email');
  fallbackIdentity.document.getElementById('mlsPiSend').click();
  assert.strictEqual(fallbackIdentity.fetches.length, 1, 'unique exact name+DOB fallback did not send after explicit confirmation');
  assert.strictEqual(fallbackIdentity.fetches[0].body.external_id, 'demo:fallback person|19800304', 'fallback payload did not use its frozen deterministic external ID');

  const athenaIdentity = makeHarness({
    active: { id: undefined, athenaId: 'ATH-77', mrn: undefined, name: 'Athena Identity', email: 'athena@example.test' },
    patients: []
  });
  const athenaButton = athenaIdentity.document.getElementById('mlsPortalInviteBtn');
  assert(athenaButton, 'athenaId-only patient did not receive a portal action');
  athenaButton.click();
  athenaIdentity.document.getElementById('mlsPiSend').click();
  assert.strictEqual(athenaIdentity.fetches.length, 1, 'athenaId-only patient did not send after explicit confirmation');
  assert.strictEqual(athenaIdentity.fetches[0].body.external_id, 'ATH-77', 'payload dropped the frozen athenaId when local id was undefined');
  assert.strictEqual(athenaIdentity.fetches[0].body.mrn, '', 'undefined MRN was serialized as an identity value');

  /* Equal raw values in different namespaces are not equal identities. The
     stored MRN collision must not interfere with the exact local-id email,
     and switching to an Athena-ID collision must invalidate the open dialog. */
  const namespaceCollision = makeHarness({
    active: { id: 'COLLIDE-7', name: 'Local Id Patient', dob: '07/08/1980' },
    patients: [
      { mrn: 'COLLIDE-7', name: 'MRN Collision', dob: '08/09/1981', email: 'wrong-mrn@example.test' },
      { id: 'COLLIDE-7', name: 'Local Id Patient', dob: '07/08/1980', email: 'right-id@example.test' }
    ]
  });
  const collisionButton = namespaceCollision.document.getElementById('mlsPortalInviteBtn');
  assert(collisionButton, 'stable local-id patient did not receive a portal action');
  collisionButton.click();
  assert.strictEqual(namespaceCollision.document.getElementById('mlsPiEmail').value, 'right-id@example.test', 'local id incorrectly matched the same raw value in MRN namespace');
  namespaceCollision.setActive({ athenaId: 'COLLIDE-7', name: 'Athena Collision', dob: '09/10/1982', email: 'athena-collision@example.test' });
  namespaceCollision.document.getElementById('mlsPiSend').click();
  assert.strictEqual(namespaceCollision.fetches.length, 0, 'stale dialog accepted equal raw IDs from different namespaces');
  assert(/active patient changed/i.test(namespaceCollision.document.getElementById('mlsPiMsg').textContent), 'namespace collision was not reported as a patient change');

  const stableDemographicConflict = makeHarness({
    active: { id: 'STABLE-A', name: 'Same Demographic', dob: '11/12/1980' },
    patients: [
      { id: 'STABLE-B', name: 'Same Demographic', dob: '1980-11-12', email: 'wrong-stable@example.test' }
    ]
  });
  const conflictButton = stableDemographicConflict.document.getElementById('mlsPortalInviteBtn');
  assert(conflictButton, 'stable-id patient did not receive a portal action');
  conflictButton.click();
  assert.strictEqual(stableDemographicConflict.document.getElementById('mlsPiEmail').value, '', 'stable patient fell back to demographics on a different stable-id record');
  assert.strictEqual(stableDemographicConflict.fetches.length, 0, 'stable demographic conflict sent without explicit review');

  /* A locally saved patient can beat its best-effort background cloud mirror.
     A 404 must sync this exact chart and retry the same frozen invite once. */
  const repair = makeHarness({
    active: { id: 'LOCAL-17', name: 'Repair Patient', dob: '10/11/1977', mrn: 'MRN-17', email: 'repair@example.test', problems: ['lumbar pain'] },
    patients: [{ id: 'LOCAL-17', name: 'Repair Patient', dob: '10/11/1977', mrn: 'MRN-17', email: 'repair@example.test', problems: ['lumbar pain'] }],
    fetchResponses: [
      { status: 404, ok: false, body: { error: 'no such patient chart in your practice' } },
      { status: 200, ok: true, body: { id: 17, external_id: 'LOCAL-17' } },
      { status: 200, ok: true, body: { ok: true, sent: false } }
    ]
  });
  repair.document.getElementById('mlsPortalInviteBtn').click();
  repair.document.getElementById('mlsPiSend').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(repair.fetches.length, 3, 'missing cloud chart was not repaired and retried exactly once');
  assert(/\/api\/patient\/admin\/send-portal-invite$/.test(repair.fetches[0].url), 'first request was not the explicit invite');
  assert(/\/api\/patients$/.test(repair.fetches[1].url), '404 recovery did not use the authenticated patient upsert');
  assert.strictEqual(repair.fetches[1].body.external_id, 'LOCAL-17', 'chart recovery changed the frozen patient ID');
  assert.deepStrictEqual(repair.fetches[1].body.data.problems, ['lumbar pain'], 'chart recovery dropped stored patient history');
  assert.strictEqual(repair.fetches[2].body.external_id, 'LOCAL-17', 'retry changed the reviewed patient identity');
  assert(/could not be sent/i.test(repair.document.getElementById('mlsPiMsg').textContent), 'sent:false was reported as success after chart repair');

  const blockedRepair = makeHarness({
    fetchResponses: [
      { status: 404, ok: false, body: { error: 'no such patient chart in your practice' } },
      { status: 402, ok: false, body: { error: 'no_access' } }
    ]
  });
  blockedRepair.document.getElementById('mlsPortalInviteBtn').click();
  blockedRepair.document.getElementById('mlsPiSend').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(blockedRepair.fetches.length, 2, 'failed chart sync incorrectly retried the invite');
  assert(/active MLS access/i.test(blockedRepair.document.getElementById('mlsPiMsg').textContent), 'inactive account did not receive the correct portal access explanation');

  console.log('PASS patient portal placement: identity is frozen, missing charts repair once, and unsent/access failures stay honest');
}

main().catch(error => { console.error(error); process.exit(1); });
