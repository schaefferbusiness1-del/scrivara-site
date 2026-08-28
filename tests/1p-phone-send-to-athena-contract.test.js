/* phsend-1.0.0 (2026-08-18, phone lane): "send the note to Athena from the
 * phone" - the third leg after record and draft.
 *
 * The property this suite exists to defend is not "the button works". It is
 * that the phone NEVER claims a write that did not happen. Every degraded
 * path in this file - server too old, office computer asleep, extension gone,
 * write flow not loaded, confirmation closed, nobody came, job lost, phone
 * cancelled - must end with the doctor being told nothing was sent. A relay
 * that fails loudly is safe; one that fails quietly puts a note nowhere and
 * says it is filed.
 *
 * It also pins the boundary: sendNote STAGES a write for a human to confirm.
 * It never authorizes one on its own - the authorization is an arm minted by
 * MLS Assist - and this suite proves the runner refuses every final action
 * rather than relying on the server or the extension to be the only refusal.
 *
 * PART C (phconfirm-1.0.0, 2026-08-19) covers the owner's ruling that the
 * confirmation must be possible FROM THE PHONE. Two properties carry it:
 *   - the doctor can only confirm the thing he was actually shown (previewHash
 *     binding, checked on the server AND on the office computer AND against the
 *     sheet's own attribute immediately before the press), and
 *   - without window.__mlsExtensionCapabilities.phoneConfirmedWriteV1 the whole
 *     path is inert and behaviour is identical to the desktop-confirm flow.
 *
 * Run: node tests/1p-phone-send-to-athena-contract.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(root, n), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

const connect = read('1p-mls-connect.js');

/* ========================================================================
 * PART A - source contract
 * ======================================================================*/

// A1: the block is delimited so promotion to /cloned is a copy, not a diff-hunt
ok(connect.includes('/* ===== phsend-1.0.0 (2026-08-18, phone lane) ='),
  'the phsend block must carry an opening delimiter');
ok(connect.includes('/* ===== end phsend-1.0.0 ='),
  'the phsend block must carry a closing delimiter');

// A2: the relay dispatch is still an explicit allowlist, now with sendNote
const runnersLine = /var RELAY_RUNNERS = \{([^}]*)\}/.exec(connect);
ok(runnersLine, 'RELAY_RUNNERS must still be an explicit object literal');
ok(/sendNote:\s*runSendNote/.test(runnersLine[1]), 'sendNote must be registered as a relay runner');
for (const banned of ['sign_encounter', 'place_order', 'stage_billing', 'signEncounter', 'placeOrder']) {
  ok(!runnersLine[1].includes(banned), `RELAY_RUNNERS must never carry ${banned}`);
}

// A3: the runner's own action allowlist is exactly the two non-final actions
const actionsLine = /var PHSEND_ACTIONS = \{([^}]*)\}/.exec(connect);
ok(actionsLine, 'PHSEND_ACTIONS must be an explicit object literal');
const allowed = actionsLine[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).sort();
assert.deepStrictEqual(allowed, ['save_draft', 'write_note'],
  'PHSEND_ACTIONS must be exactly write_note and save_draft'); checks++;

// A4: the block must not contain a final action anywhere in it
const blockStart = connect.indexOf('/* ===== phsend-1.0.0 (2026-08-18, phone lane) =');
const blockEnd = connect.indexOf('/* ===== end phsend-1.0.0 =');
ok(blockStart > 0 && blockEnd > blockStart, 'the phsend block must be locatable');
const block = connect.slice(blockStart, blockEnd);
for (const banned of ['sign_encounter', 'place_order', 'stage_billing']) {
  ok(!block.includes(banned), `the phsend block must never name ${banned}`);
}
/* A4b: it must not try to synthesize the human's click. Checked against CODE
   with comments stripped - the block's own prose necessarily NAMES isTrusted
   to explain why it does not touch it, and a blunt substring check on the raw
   text would fail on the explanation rather than on a bypass. To stop the
   stripper from hiding a missing rationale (a gate that stopped looking), the
   prose requirement is asserted separately below. */
const blockCode = block.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
for (const bypass of ['dispatchEvent', 'isTrusted', 'execCommand', 'new Event', 'MouseEvent']) {
  ok(!blockCode.includes(bypass),
    `the phsend block's CODE must not touch ${bypass} - a synthesized event is never the authorization`);
}
/* A4c: `.click(` has exactly ONE legitimate call site now - pressing the sheet's
   own confirm control AFTER MLS Assist has been armed by the extension verb.
   A NAMED single exception, not a blanket allowance (a blanket one is how a
   gate stops looking): it must live in phsendPressStagedConfirm, that function
   must compare the sheet's own data-mls-preview-hash against the hash passed
   in, and the only caller must be behind the capability check. */
const clickSites = (blockCode.match(/\.click\(/g) || []).length;
eq(clickSites, 1, 'exactly one .click( call site may exist in the phsend block');
const pressFn = /function phsendPressStagedConfirm\(previewHash\) \{([\s\S]*?)\n  \}/.exec(block);
ok(pressFn, 'the single press must live in the named function phsendPressStagedConfirm');
ok(pressFn[1].includes('.click()'), 'the press lives inside that function');
ok(/data-mls-preview-hash/.test(pressFn[1]), 'the press must read the sheet own preview hash');
ok(/onSheet !== String\(previewHash\)/.test(pressFn[1]),
  'the press must REFUSE when the sheet drifted off the hash the doctor confirmed');
ok(/go\.disabled/.test(pressFn[1]), 'the press must not fire at a disabled control');
/* and the caller is gated on the capability + a successful arm */
ok(/if \(!remote \|\| !staged \|\| arming \|\| pressing\) return;/.test(block),
  'the confirm handler must be gated on the capability and the staged state');
ok(/armed\.ok !== true \|\| armed\.armed !== true/.test(block),
  'the press must only follow a successful arm from the extension verb');

/* A4d: the extension verb is called exactly as specified to Fable */
ok(block.includes("type: 'mlsAppAthenaRemoteArmV1'"), 'the verb name must match the spec');
ok(block.includes("d.type !== 'mlsAppAthenaRemoteArmV1Result'"), 'the reply type must match the spec');
for (const field of ['requestId', 'action', 'previewHash', 'relayJobId', 'originDeviceId']) {
  ok(new RegExp(field + ':').test(block), `the arm request must carry ${field}`);
}
ok(/String\(d\.requestId \|\| ''\) !== requestId/.test(block),
  'the arm reply must be correlated by requestId, or two in flight resolve each other');
ok(/phoneConfirmedWriteV1 === true/.test(block),
  'the whole path must be gated on the phoneConfirmedWriteV1 capability');
ok(/isTrusted/.test(block) && /ATHENA_ACTION_V2_CLICK_GATE/.test(block),
  'the block must explain in prose WHY it cannot execute the write, so the next reader does not try');
ok(/cannot execute|does not try|never claims/i.test(block),
  'the block must state its own limit in words');

/* A5: /1p is now the official source for both production and /cloned. The
   phone-send relay must therefore promote with the bundle, byte-for-byte in
   this identity-neutral block, while the two unforked shared UI/writeflow
   modules remain uninvolved. This pins both the promotion law and the narrow
   note/save-only safety boundary. */
for (const shared of ['feat_mls_phone_ui.js', 'feat_mls_writeflow.js']) {
  const s = read(shared);
  ok(!s.includes('phsend'), `${shared} is an unforked shared module and must not carry phsend`);
  ok(!s.includes('sendNote'), `${shared} must not have been taught the sendNote kind`);
}
function exactPhsendBlock(source, label) {
  const start = source.indexOf('/* ===== phsend-1.0.0 (2026-08-18, phone lane) =');
  const end = source.indexOf('/* ===== end phsend-1.0.0 =', start);
  ok(start > 0 && end > start, `${label} must carry the promoted phsend block`);
  return source.slice(start, end);
}
const productionPhsend = exactPhsendBlock(read('mls-connect.js'), 'production mls-connect.js');
const clonedPhsend = exactPhsendBlock(read('cloned-mls-connect.js'), 'cloned-mls-connect.js');
eq(productionPhsend, block, 'production phsend must match its official 1p source exactly');
eq(clonedPhsend, block, 'cloned phsend must match its official 1p source exactly');

const productionDerive = read('scripts/derive-production-from-1p.js');
ok(/CONNECT_SRC\s*=\s*'1p-mls-connect\.js'/.test(productionDerive) && /CONNECT_OUT\s*=\s*'mls-connect\.js'/.test(productionDerive),
  'production mls-connect.js must remain officially derived from 1p-mls-connect.js');
const clonedDerive = read('scripts/derive-cloned-from-1p.js');
ok(/CONNECT_SRC\s*=\s*'1p-mls-connect\.js'/.test(clonedDerive) && /CONNECT_OUT\s*=\s*'cloned-mls-connect\.js'/.test(clonedDerive),
  'cloned-mls-connect.js must remain officially derived from 1p-mls-connect.js');

// A6: honesty vocabulary - staged and sent are different words, and every
// terminal failure line says nothing was sent.
ok(/staged: true, confirmed: true/.test(block), 'a success receipt must record both staging and confirmation');
const failureLines = block.match(/error: '[^']+'/g) || [];
ok(failureLines.length >= 6, 'the runner must have distinct honest failure sentences');
const notSent = failureLines.filter((l) => /[Nn]othing was (sent|opened|written)/.test(l));
ok(notSent.length >= 5,
  'every terminal failure must tell the doctor nothing was sent/opened/written, got ' + notSent.length);

/* ========================================================================
 * PART B - runtime. Evaluate the REAL relay module in a VM with fake time,
 * fake fetch and a fake DOM, then drive it exactly as the phone and the
 * office computer would.
 * ======================================================================*/
const relayStart = connect.indexOf('/* ===== __mlsRelayLink rl-1.0.0');
const relayEnd = connect.indexOf('/* ===== __mlsPhoneHome ph-1.0.0');
ok(relayStart > 0 && relayEnd > relayStart, 'the relay module must be locatable for runtime evaluation');
let relaySrc = connect.slice(relayStart, relayEnd);
relaySrc = relaySrc.slice(0, relaySrc.lastIndexOf('})();') + 5);
ok(relaySrc.includes('phsend-1.0.0'), 'the sliced relay module must contain the phsend block');

function makeEl(id, tag) {
  const el = {
    id, tag: tag || 'div', style: { cssText: '', display: '', width: '' },
    children: [], parentNode: null,
    textContent: '', type: '', className: '', disabled: false, value: '',
    nextSibling: null, _listeners: {}, _attrs: {}, _html: '',
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    /* innerHTML is parsed only far enough for these tests: elements carrying an
       id, their class, and their text. That is what the confirm sheet builds. */
    set innerHTML(v) {
      this._html = String(v);
      this.children.length = 0;
      const rx = /<(span|button|div|p)\b([^>]*)>([\s\S]*?)<\/\1>/g;
      let m;
      while ((m = rx.exec(String(v)))) {
        const attrs = m[2] || '';
        const idM = /\bid="([^"]+)"/.exec(attrs);
        const clsM = /\bclass="([^"]+)"/.exec(attrs);
        const child = makeEl(idM ? idM[1] : '', m[1]);
        if (clsM) child.className = clsM[1];
        const inner = m[3];
        child.textContent = inner.replace(/<[^>]*>/g, '');
        for (const am of attrs.matchAll(/([a-z-]+)="([^"]*)"/g)) child._attrs[am[1]] = am[2];
        /* nested id-bearing spans inside a button must be findable too */
        const nest = /<span\b([^>]*)>([\s\S]*?)<\/span>/g;
        let nm;
        while ((nm = nest.exec(inner))) {
          const nidM = /\bid="([^"]+)"/.exec(nm[1] || '');
          const nclsM = /\bclass="([^"]+)"/.exec(nm[1] || '');
          const sub = makeEl(nidM ? nidM[1] : '', 'span');
          if (nclsM) sub.className = nclsM[1];
          sub.textContent = nm[2].replace(/<[^>]*>/g, '');
          child.appendChild(sub);
        }
        this.appendChild(child);
      }
    },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      const cls = sel.replace('.', '');
      const walk = (n) => {
        for (const c of n.children) {
          if (c.className === cls) return c;
          const d = walk(c); if (d) return d;
        }
        return null;
      };
      return walk(this);
    },
    click() { this._clicks = (this._clicks || 0) + 1; (this._listeners.click || []).forEach((f) => f({})); },
    fire(type, ev) { (this._listeners[type] || []).forEach((f) => f(ev || {})); }
  };
  return el;
}

function harness(opts) {
  opts = opts || {};
  const timers = new Map();
  let nextId = 1, now = Date.now();
  const els = new Map();
  ['mlsPh3', 'mlsPh3Act', 'noteBox', '__body', '__head'].forEach((id) => els.set(id, makeEl(id)));
  els.get('noteBox').value = opts.noteText === undefined ? 'Reviewed note body.' : opts.noteText;
  const posted = [];
  const ctx = {
    console,
    Date: class extends Date { static now() { return now; } },
    Math,
    JSON,
    Promise,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Error,
    encodeURIComponent,
    isNaN,
    parseInt,
    parseFloat,
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { fn, due: now + ms, iv: ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, due: now + (ms || 0), iv: 0 }); return id; },
    clearTimeout(id) { timers.delete(id); },
    Worker: function () { throw new Error('no worker in test'); },
    Blob: function () {},
    URL: { createObjectURL() { return 'blob:x'; } },
    fetch: (url, init) => {
      posted.push({ url: String(url), init: init || {} });
      return Promise.resolve(opts.fetch ? opts.fetch(String(url), init || {}) : { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
    },
    sessionStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    document: {
      /* a real getElementById finds nodes the page created and appended, not
         only the ones the harness seeded - the send bar is created at runtime */
      getElementById: (id) => {
        if (els.has(id)) return els.get(id);
        const walk = (n) => {
          for (const c of n.children) {
            if (c.id === id) return c;
            const d = walk(c); if (d) return d;
          }
          return null;
        };
        for (const root of els.values()) { const hit = walk(root); if (hit) return hit; }
        return null;
      },
      createElement: (t) => makeEl('', t),
      addEventListener() {}, removeEventListener() {}
    }
  };
  ctx.document.body = els.get('__body');
  ctx.document.head = els.get('__head');
  ctx.document.documentElement = els.get('__body');
  ctx.window = ctx;
  ctx.self = ctx;
  /* the extension capability that gates the whole phone-confirm path */
  if (opts.capable) ctx.window.__mlsExtensionCapabilities = { phoneConfirmedWriteV1: true };
  /* real window message plumbing: the remote-arm verb is a postMessage
     round-trip, so the harness must be able to hear the request and answer it */
  const winListeners = [];
  const sentMessages = [];
  ctx.window.addEventListener = (t, fn) => { if (t === 'message') winListeners.push(fn); };
  ctx.window.removeEventListener = (t, fn) => { const i = winListeners.indexOf(fn); if (i > -1) winListeners.splice(i, 1); };
  ctx.window.postMessage = (m) => { sentMessages.push(m); };
  ctx.__sent = sentMessages;
  ctx.__reply = (data) => { winListeners.slice().forEach((f) => { try { f({ data }); } catch (e) {} }); };
  ctx.window.bkBase = () => 'https://api.test';
  ctx.window.bkToken = () => (opts.authed === false ? '' : 'tok');
  ctx.window.backendMode = () => opts.authed !== false;
  ctx.window.__mlsExtReportedVersion = opts.ext === false ? '' : '3.0.64';
  ctx.window.toast = () => {};
  if (opts.writeFlow !== false) {
    ctx.window.__mlsWriteFlow = {
      startAthenaAction: (action, o) => { ctx.__wf = { action, opts: o }; return Promise.resolve({ ok: true }); }
    };
  }
  ctx.window.__mlsPhoneUI = opts.phone === false ? undefined : {
    installed: true,
    state: () => ({ screen: opts.screen || 'visit', mounted: opts.mounted !== false, menu: false })
  };
  ctx.window.__mlsEasyV32 = {
    /* the REAL shape of snapshot().active (1p-mls-connect.js remote.snapshot):
       { id, name, dob, time } - and that id is the APPOINTMENT id. No mrn, no
       patientId. The harness must not invent fields the engine does not send. */
    remote: { snapshot: () => opts.snapshot === undefined
      ? { active: { id: 'appt-1', name: 'Synthetic Test', dob: '1980-01-01', time: '9:00 AM' }, phase: 'note', noteLen: 24, day: '2026-08-18' }
      : opts.snapshot }
  };
  ctx.window.__mlsDeviceRole = { effectiveRole: () => opts.role || 'office', deviceId: 'dev_office', deviceNoun: () => 'phone' };
  ctx.patients = opts.patients || [];
  ctx.window.patients = ctx.patients;

  vm.createContext(ctx);
  vm.runInContext(relaySrc, ctx, { filename: '1p-mls-connect.js#relay' });

  return {
    ctx,
    api: ctx.window.__mlsRelayLink,
    posted,
    els,
    sent: ctx.__sent,
    reply: ctx.__reply,
    /* stand up the desktop confirmation sheet the write flow would have built,
       carrying the same preview-hash attribute showActionConfirm sets */
    standUpSheet(previewHash) {
      els.set('mlsAthenaActionConfirm', makeEl('mlsAthenaActionConfirm'));
      const go = makeEl('mlsAthenaActionGo', 'button');
      go.setAttribute('data-mls-preview-hash', previewHash);
      go.setAttribute('data-mls-athena-action', 'write_note');
      els.set('mlsAthenaActionGo', go);
      return go;
    },
    tearDownSheet() { els.delete('mlsAthenaActionConfirm'); els.delete('mlsAthenaActionGo'); },
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 20000) {
        let soonest = null;
        for (const [id, t] of timers) { if (t.due <= target && (!soonest || t.due < soonest[1].due)) soonest = [id, t]; }
        if (!soonest) break;
        now = soonest[1].due;
        if (soonest[1].iv) soonest[1].due = now + soonest[1].iv; else timers.delete(soonest[0]);
        try { soonest[1].fn(); } catch (e) { /* module guards its own timers */ }
      }
      now = target;
    }
  };
}
const flush = () => new Promise((r) => setImmediate(r));

async function main() {
/* ---- B1: the runner refuses every final action, and touches nothing ---- */
{
  const h = harness({});
  for (const action of ['sign_encounter', 'place_order', 'stage_billing', 'submit_claim', '', 'WRITE_NOTE']) {
    const out = await h.api.runSendNote({ id: 'j1', payload: { action, noteText: 'x', patient: { name: 'A', dob: '1980-01-01' } } });
    eq(out.ok, false, `runSendNote must refuse ${action || '(empty)'}`);
    ok(/refused|relays only/i.test(out.error), `refusal for ${action || '(empty)'} must say so`);
    ok(/[Nn]othing was opened/.test(out.error), `refusal for ${action || '(empty)'} must say nothing was opened`);
    eq(h.ctx.__wf, undefined, `refusing ${action || '(empty)'} must never reach the write flow`);
  }
}

/* ---- B2: the runner refuses an empty note, a missing write flow, a
        missing extension, and a name-only identity ------------------------ */
{
  let h = harness({});
  let out = await h.api.runSendNote({ id: 'j', payload: { action: 'write_note', noteText: '   ', patient: { name: 'A', dob: '1980-01-01' } } });
  eq(out.ok, false, 'an empty note must be refused'); ok(/no reviewed note text/i.test(out.error), 'empty-note refusal names the cause');

  h = harness({ writeFlow: false });
  out = await h.api.runSendNote({ id: 'j', payload: { action: 'write_note', noteText: 'n', patient: { name: 'A', dob: '1980-01-01' } } });
  eq(out.ok, false, 'no write flow must be refused'); ok(/write flow has not loaded/i.test(out.error), 'names the cure');

  h = harness({ ext: false });
  out = await h.api.runSendNote({ id: 'j', payload: { action: 'write_note', noteText: 'n', patient: { name: 'A', dob: '1980-01-01' } } });
  eq(out.ok, false, 'no extension must be refused'); ok(/MLS Assist is not answering/i.test(out.error), 'names the extension');

  /* THE IDENTITY LAW: a name with no DOB and no MRN never resolves a chart. */
  h = harness({});
  out = await h.api.runSendNote({ id: 'j', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Tom Jones' } } });
  eq(out.ok, false, 'a name-only patient must be refused'); ok(/only a name/i.test(out.error), 'says the record is name-only');
  ok(/Add a DOB or MRN/i.test(out.error), 'gives the doctor the fix');
  eq(h.ctx.__wf, undefined, 'a name-only send must never reach the write flow');

  h = harness({});
  out = await h.api.runSendNote({ id: 'j', payload: { action: 'write_note', noteText: 'n', patient: {} } });
  eq(out.ok, false, 'a nameless patient must be refused');
}

/* ---- B3: ambiguity is refused rather than guessed ---------------------- */
{
  const twins = [
    { id: 'p1', name: 'Synthetic Test', dob: '1980-01-01', mrn: '111' },
    { id: 'p2', name: 'Synthetic Test', dob: '1980-01-01', mrn: '222' }
  ];
  const h = harness({ patients: twins });
  const out = await h.api.runSendNote({ id: 'j', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  eq(out.ok, false, 'two matching charts must be refused, never guessed');
  ok(/More than one MLS patient/i.test(out.error), 'says why it refused');
  ok(/will not guess/i.test(out.error), 'states the rule');
}

/* ---- B4: happy path - stages through the REAL entry point, waits for the
        human, then reports the confirmation as the receipt ---------------- */
{
  const h = harness({});
  const p = h.api.runSendNote({ id: 'j9', payload: { action: 'write_note', noteText: 'Reviewed note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' } } });
  await flush();
  ok(h.ctx.__wf, 'the runner must reach the write flow');
  eq(h.ctx.__wf.action, 'write_note', 'it must use the action the phone asked for');
  eq(h.ctx.__wf.opts.sections[0].text, 'Reviewed note body.', 'the reviewed note text must reach the write flow intact');
  eq(h.ctx.__wf.opts.sections[0].key, 'note', 'the note goes through the note route');
  eq(h.ctx.__wf.opts.patient.dob, '1980-01-01', 'the identity tuple travels');
  ok(String(h.ctx.__wf.opts.receiptSessionId).indexOf('phsend-') === 0, 'the receipt is tagged as a phone send');

  // the confirmation sheet appears, then a human confirms
  h.els.set('mlsAthenaActionConfirm', makeEl('mlsAthenaActionConfirm'));
  h.ctx.__wf.opts.onProbe({ ok: true });
  h.advance(4000); await flush();

  // the first thing the phone hears is that the chart is being checked
  let beats = h.posted.filter((r) => /\/progress$/.test(r.url));
  ok(beats.length >= 1, 'the office computer must report progress as soon as it starts');
  ok(/Checking the chart/.test(String(beats[0].init.body)), 'the first beat says the chart is being checked');

  /* THE LOAD-BEARING ONE: the server marks a job lost after 150 s of silence,
     and a human takes longer than that to walk over and press Confirm. Past
     the beat interval there must be a fresh beat, or every real send would be
     reported lost while the doctor was still on his way. */
  h.advance(101000); await flush();
  beats = h.posted.filter((r) => /\/progress$/.test(r.url));
  ok(beats.length >= 2, 'the office computer must keep beating while a human decides');
  ok(/Waiting for your confirmation/.test(String(beats[beats.length - 1].init.body)),
    'the beat must say what it is waiting for');

  h.els.delete('mlsAthenaActionConfirm');
  h.ctx.__wf.opts.onResult({ ok: true, verified: true }, { action: 'write_note', context: { encounterId: 'enc-7', visitDate: '2026-08-18', provider: 'Dr Synthetic' }, verifiedWrite: true });
  const out = await p;
  eq(out.ok, true, 'a confirmed write must come back ok');
  eq(out.data.confirmed, true, 'the receipt must record the human confirmation');
  eq(out.data.encounterId, 'enc-7', 'the receipt carries the exact encounter');
  eq(out.data.visitDate, '2026-08-18', 'the receipt carries the encounter date');
}

/* ---- B5: THE DANGEROUS PATHS. A closed sheet and an unconfirmed wait must
        both come back as failures, never as a send. ---------------------- */
{
  // (a) somebody closed the confirmation
  let h = harness({});
  let p = h.api.runSendNote({ id: 'jc', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.els.set('mlsAthenaActionConfirm', makeEl('mlsAthenaActionConfirm'));
  h.ctx.__wf.opts.onProbe({ ok: true });
  h.advance(2500); await flush();
  h.els.delete('mlsAthenaActionConfirm');
  h.advance(2500); await flush();
  let out = await p;
  eq(out.ok, false, 'a closed confirmation must NOT read as sent');
  ok(/closed on this computer without sending/i.test(out.error), 'says the sheet was closed');
  ok(/[Nn]othing was written/.test(out.error), 'says nothing was written');

  // (b) nobody ever came - WITH THE SHEET STILL STANDING, which is the real
  // shape of this case: showActionConfirm always builds the overlay, so a
  // deadline that only runs when the sheet is absent can never fire in the
  // one situation it exists for. (It did not, until phclean-1.0.0.)
  h = harness({});
  p = h.api.runSendNote({ id: 'jt', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.standUpSheet('pv_t');
  h.ctx.__wf.opts.onProbe({ ok: true, context: {} });
  h.advance(10 * 60 * 1000); await flush();
  out = await p;
  eq(out.ok, false, 'an unconfirmed send must fail even with the sheet still up, not hang forever');
  ok(/[Nn]obody confirmed/i.test(out.error), 'says nobody confirmed');
  ok(/note is safe in MLS/i.test(out.error), 'reassures the doctor the note is not lost');
  h.tearDownSheet();

  // (b2) and with NO sheet ever painted it still deadlines
  h = harness({});
  p = h.api.runSendNote({ id: 'jt2', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.advance(10 * 60 * 1000); await flush();
  out = await p;
  eq(out.ok, false, 'the deadline also holds when the sheet never appeared');

  // (c) Athena never answered after the confirm
  h = harness({});
  p = h.api.runSendNote({ id: 'jx', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.ctx.__wf.opts.onResult({ __timeout: true }, {});
  out = await p;
  eq(out.ok, false, 'a bridge timeout must not read as sent');
  ok(/uncertain/i.test(out.error), 'an uncertain outcome must be called uncertain');

  // (d) the write flow reported a refusal
  h = harness({});
  p = h.api.runSendNote({ id: 'jr', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.ctx.__wf.opts.onResult({ ok: false, error: 'Athena chart did not match.' }, { context: {} });
  out = await p;
  eq(out.ok, false, 'a refused write must come back false');
  eq(out.data, null, 'a refused write must carry no success receipt');
  ok(/did not match/.test(out.error), 'the real reason reaches the phone');
}

/* ---- B6: THE PHONE'S HALF. Degraded modes first, because those are the
        ones that lie if they are wrong. ---------------------------------- */
{
  // (a) an MLS server that predates the sendNote kind
  const h = harness({
    fetch: (url) => {
      if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeName: 'Front desk', officeId: 'dev_office' }) };
      if (/\/api\/relay\/jobs$/.test(url)) return { ok: false, status: 400, json: () => Promise.resolve({ error: 'unsupported job kind' }) };
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    }
  });
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } });
  await flush(); await flush();
  const st = h.api.sendState();
  eq(st.status, 'unavailable', 'an old server must produce an explicit unavailable state, not a spinner');
  ok(/cannot take notes from a phone yet/i.test(st.line), 'says the server cannot do it yet');
  ok(/[Nn]othing was sent/.test(st.line), 'says nothing was sent');
  ok(/note is safe here/i.test(st.line), 'tells the doctor the note survives');
}
{
  // (b) the office computer is asleep - fail BEFORE queuing into the void
  const h = harness({
    fetch: (url) => {
      if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: false, ext: false, officeName: 'Front desk' }) };
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'should-not-happen' }) };
    }
  });
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } });
  await flush(); await flush();
  const st = h.api.sendState();
  eq(st.status, 'failed', 'an offline office computer must fail fast');
  ok(/not answering/i.test(st.line), 'says the computer is not answering');
  ok(/[Nn]othing was sent/.test(st.line), 'says nothing was sent');
  eq(h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init.method === 'POST').length, 0,
    'no job may be queued into a void');
}
{
  // (c) not signed in
  const h = harness({ authed: false });
  await h.api.sendNoteToAthena({ noteText: 'n', patient: { name: 'A', dob: '1980-01-01' } });
  eq(h.api.sendState().status, 'failed', 'a signed-out phone must refuse');
  ok(/Sign in first/i.test(h.api.sendState().line), 'says to sign in');
}
{
  // (d) nothing to send
  const h = harness({});
  await h.api.sendNoteToAthena({ noteText: '   ' });
  eq(h.api.sendState().status, 'failed', 'an empty note must refuse');
  ok(/no note to send/i.test(h.api.sendState().line), 'says there is no note');
}

/* ---- B7: the phone's happy lifecycle, end to end ---------------------- */
{
  let jobState = 'queued';
  const h = harness({
    fetch: (url, init) => {
      if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeName: 'Front desk', officeId: 'dev_office' }) };
      if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_test' }) };
      if (/\/api\/relay\/jobs\/rj_test$/.test(url)) {
        /* phverif-1.0.0: verifiedWrite:true added. The office computer ALWAYS
           emits this field (runSendNote sets verifiedWrite:!!meta.verifiedWrite),
           so a done-job without it modelled a message the desktop never sends -
           and the SENT assertions below therefore encoded the overclaim this
           suite exists to prevent. This leg is now a genuinely verified Athena
           write; B7b below covers the pressed-but-unverified case. */
        if (jobState === 'done') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'done', result: { ok: true, data: { confirmed: true, verifiedWrite: true, encounterId: 'enc-7', visitDate: '2026-08-18', provider: 'Dr Synthetic' } } } }) };
        if (jobState === 'taken') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'taken', progress: { note: 'Waiting for your confirmation on this computer.' } } }) };
        return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'queued' } }) };
      }
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    }
  });
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: 'Reviewed note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' }, apptId: 'appt-1', visitDay: '2026-08-18' });
  await flush(); await flush();

  const jobPost = h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init.method === 'POST')[0];
  ok(jobPost, 'the phone must queue a job');
  const sent = JSON.parse(jobPost.init.body);
  eq(sent.kind, 'sendNote', 'the job kind must be sendNote');
  eq(sent.payload.action, 'write_note', 'the action travels');
  eq(sent.payload.noteText, 'Reviewed note body.', 'the reviewed note travels');
  eq(sent.targetDeviceId, 'dev_office', 'the job must be aimed at the named office computer');
  ok(sent.dedupeKey && /^sendNote\|/.test(sent.dedupeKey), 'a dedupeKey must coalesce a double press');
  eq(h.api.sendState().status, 'queued', 'the phone shows queued while it waits');

  jobState = 'taken';
  h.advance(3000); await flush(); await flush();
  eq(h.api.sendState().status, 'working', 'the phone shows working once the office computer takes it');
  ok(/Waiting for your confirmation/.test(h.api.sendState().line), 'the phone mirrors the real progress line');

  jobState = 'done';
  h.advance(3000); await flush(); await flush();
  eq(h.api.sendState().status, 'sent', 'a confirmed job must show SENT');
  ok(/^SENT/.test(h.api.sendState().line), 'the sent line must lead with SENT');
  ok(/2026-08-18/.test(h.api.sendState().line), 'the sent line names the encounter it confirmed');

  // a double press must not queue a second staging (same dedupeKey)
  const before = h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init.method === 'POST').length;
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: 'Reviewed note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' }, apptId: 'appt-1' });
  await flush(); await flush();
  const after = h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init.method === 'POST');
  eq(after.length, before + 1, 'a resend posts once');
  eq(JSON.parse(after[after.length - 1].init.body).dedupeKey, sent.dedupeKey,
    'the same note for the same visit must carry the same dedupeKey so the server coalesces it');
}

/* ---- B7b: a PRESSED confirm with NO verified-write receipt must never read as
   SENT. `confirmed` records only that the relay round-tripped and a human
   pressed the sheet on the office computer. When Athena returns no verified
   receipt the write flow calls onResult with verifiedWrite null and the DESKTOP
   says "Athena did not return a verified note write ... MLS is not marking the
   write complete." Before phverif-1.0.0 the phone printed "SENT - confirmed"
   over the top of that. The phone may only claim a chart write when the desktop
   verified one. ------------------------------------------------------------ */
{
  let jobState = 'queued';
  const h = harness({
    fetch: (url, init) => {
      if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeName: 'Front desk', officeId: 'dev_office' }) };
      if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_test' }) };
      if (/\/api\/relay\/jobs\/rj_test$/.test(url)) {
        if (jobState === 'done') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'done', result: { ok: true, data: { confirmed: true, verifiedWrite: false, encounterId: 'enc-7', visitDate: '2026-08-18', provider: 'Dr Synthetic' } } } }) };
        return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'queued' } }) };
      }
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
    }
  });
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: 'Reviewed note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' }, apptId: 'appt-2', visitDay: '2026-08-18' });
  await flush(); await flush();
  jobState = 'done';
  h.advance(3000); await flush(); await flush();

  const st = h.api.sendState();
  eq(st.status, 'staged', 'a pressed confirm with no verified write must report staged, not sent');
  ok(!/^SENT/.test(st.line), 'the line must not lead with SENT when Athena confirmed nothing');
  ok(/NOT confirmed|not confirmed/.test(st.line), 'the line must say plainly that Athena has not confirmed a write');
  ok(/office computer/i.test(st.line), 'the line must point the doctor at where the note actually is');
}

/* ---- B7c: verifiedWrite MISSING, and verifiedWrite TRUTHY-BUT-NOT-TRUE.
   phverif-1.0.1 (2026-08-28): B7 covers true and B7b covers false, so the two
   shapes that actually break a `=== true` check were tested nowhere. A
   completeness review pointed out that loosening the phone's gate from
   `r0.data.verifiedWrite === true` to a truthy test would pass BOTH existing
   legs unchanged.
   Absent is the older office build, which emitted no such field at all; a
   truthy non-true value ('yes', 1) is what a future payload change could send.
   Neither is a verified chart write, and neither may read as SENT. ------- */
{
  for (const [label, dataExtra] of [
    ['the field is ABSENT (an older office build)', {}],
    ['the field is the STRING "true"', { verifiedWrite: 'true' }],
    ['the field is 1', { verifiedWrite: 1 }],
    ['the field is the string "yes"', { verifiedWrite: 'yes' }]
  ]) {
    let jobState = 'queued';
    const h = harness({
      fetch: (url, init) => {
        if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeName: 'Front desk', officeId: 'dev_office' }) };
        if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_test' }) };
        if (/\/api\/relay\/jobs\/rj_test$/.test(url)) {
          if (jobState === 'done') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'done', result: { ok: true, data: Object.assign({ confirmed: true, encounterId: 'enc-7', visitDate: '2026-08-18', provider: 'Dr Synthetic' }, dataExtra) } } }) };
          return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'queued' } }) };
        }
        return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
      }
    });
    await h.api.sendNoteToAthena({ action: 'write_note', noteText: 'Reviewed note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' }, apptId: 'appt-2', visitDay: '2026-08-18' });
    await flush(); await flush();
    jobState = 'done';
    h.advance(3000); await flush(); await flush();

    const st = h.api.sendState();
    eq(st.status, 'staged',
      'with ' + label + ', the phone reported ' + st.status + ' rather than staged. Only a STRICT ' +
      'verifiedWrite === true is a verified chart write; anything else is the phone claiming a write ' +
      'Athena never confirmed.');
    ok(!/^SENT/.test(st.line), 'with ' + label + ', the line led with SENT');
  }
}

/* ---- B8: the phone reports a lost / expired / unclaimed job honestly --- */
{
  for (const [status, extra, expectRe] of [
    ['lost', { result: { error: 'The office computer stopped responding mid-job.' } }, /stopped responding/i],
    ['canceled', {}, /[Nn]othing was sent/],
    ['done', { result: { ok: false, error: 'Athena chart did not match.' } }, /did not match/]
  ]) {
    const h = harness({
      fetch: (url, init) => {
        if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeId: 'dev_office' }) };
        if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_x' }) };
        if (/\/api\/relay\/jobs\/rj_x$/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: Object.assign({ id: 'rj_x', status }, extra) }) };
        return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
      }
    });
    await h.api.sendNoteToAthena({ noteText: 'n', patient: { name: 'A', dob: '1980-01-01' } });
    await flush(); await flush();
    h.advance(3000); await flush(); await flush();
    const st = h.api.sendState();
    ok(st.status !== 'sent', `a ${status} job must never show SENT`);
    ok(expectRe.test(st.line), `a ${status} job must explain itself, got: ${st.line}`);
  }
  // a 404 (expired queue, e.g. the server restarted) must not read as sent
  const h = harness({
    fetch: (url, init) => {
      if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeId: 'dev_office' }) };
      if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_g' }) };
      return { ok: false, status: 404, json: () => Promise.resolve({ error: 'no such job' }) };
    }
  });
  await h.api.sendNoteToAthena({ noteText: 'n', patient: { name: 'A', dob: '1980-01-01' } });
  await flush(); await flush();
  h.advance(3000); await flush(); await flush();
  eq(h.api.sendState().status, 'failed', 'an expired job must fail honestly');
  ok(/expired/i.test(h.api.sendState().line), 'says the request expired');
}

/* ---- B9: the button. It must exist only where it makes sense, and it must
        survive the phone repainting its action bar. --------------------- */
{
  const h = harness({});
  h.api.phsendMount();
  const frame = h.els.get('mlsPh3');
  const bar = frame.children.filter((c) => c.id === 'mlsPhSendBar')[0];
  ok(bar, 'the send bar must mount into the phone frame');
  ok(frame.children.indexOf(bar) > -1, 'the bar is a SIBLING of the action bar, not inside it');
  eq(bar.style.display, 'block', 'the bar shows on the visit screen with a drafted note');
  const go = bar.querySelector('.phsend-go');
  ok(go, 'the bar carries one button');
  eq(go.textContent, 'Send to Athena', 'the button is named for what it does');

  // the phone rebuilding its action bar must not destroy this control
  h.els.get('mlsPh3Act').children.length = 0;
  h.api.phsendMount();
  ok(frame.children.filter((c) => c.id === 'mlsPhSendBar').length === 1,
    'a repaint of the action bar must leave exactly one send bar, still mounted');
}
{
  // day screen: no send bar shown
  const h = harness({ screen: 'day' });
  h.api.phsendMount();
  eq(h.api.phsendVisible(), false, 'the send bar must not show on the day screen');
}
{
  // visit screen but no note drafted yet
  const h = harness({ snapshot: { active: { name: 'A', dob: '1980-01-01' }, phase: 'rec', noteLen: 0 } });
  h.api.phsendMount();
  eq(h.api.phsendVisible(), false, 'the send bar must not offer to send a note that does not exist yet');
}
{
  // no patient open
  const h = harness({ snapshot: { active: null, phase: 'idle', noteLen: 0 } });
  eq(h.api.phsendVisible(), false, 'the send bar must not show with no patient open');
}
{
  // not a phone at all
  const h = harness({ phone: false });
  eq(h.api.phsendVisible(), false, 'the send bar must never appear where there is no phone UI');
}

/* ---- B10: pressing the real button sends the real identity, and NEVER
        smuggles an appointment id in as a patient id. snapshot().active.id is
        an APPOINTMENT id; the two namespaces are different, and letting one
        stand in for the other is how a note resolves against a stranger's
        record. -------------------------------------------------------------*/
{
  const h = harness({
    fetch: (url, init) => {
      if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeId: 'dev_office' }) };
      if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_btn' }) };
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_btn', status: 'queued' } }) };
    }
  });
  h.api.phsendMount();
  const bar = h.els.get('mlsPh3').children.filter((c) => c.id === 'mlsPhSendBar')[0];
  bar.querySelector('.phsend-go').click();
  await flush(); await flush();

  const post = h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init.method === 'POST')[0];
  ok(post, 'pressing the button must queue a job');
  const body = JSON.parse(post.init.body);
  eq(body.kind, 'sendNote', 'the button queues a sendNote');
  eq(body.payload.patient.name, 'Synthetic Test', 'the open patient travels');
  eq(body.payload.patient.dob, '1980-01-01', 'the DOB travels as the second factor');
  eq(body.payload.patient.patientId, '',
    'the APPOINTMENT id must never travel as a patient id - different namespaces, wrong-chart risk');
  eq(body.payload.apptId, 'appt-1', 'the appointment id travels in its own field');
  eq(body.payload.noteText, 'Reviewed note body.', 'the drafted note text travels');
  eq(body.payload.action, 'write_note', 'the button asks for a note write, never a final action');
}

/* =======================================================================
 * PART C - phconfirm-1.0.0: confirming from the phone.
 * The owner asked for the press to move to the phone. The extension verb
 * makes that legitimate; these prove it stays safe, and that WITHOUT the
 * capability nothing about yesterday's behaviour changes.
 * =====================================================================*/

const STAGE_FETCH = (extra) => (url, init) => {
  if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeId: 'dev_office', officeName: 'Front desk' }) };
  if (/\/stage$/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, status: 'taken' }) };
  if (/\/progress$/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve(Object.assign({ ok: true, status: 'taken' }, extra && extra.progress ? extra.progress() : {})) };
  return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
};

/* ---- C1: NO CAPABILITY = yesterday's flow, unchanged ------------------ */
{
  const h = harness({ fetch: STAGE_FETCH() });      // capable: false
  const p = h.api.runSendNote({ id: 'jn', payload: { action: 'write_note', noteText: 'Note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.standUpSheet('pv_1');
  h.ctx.__wf.opts.onProbe({ ok: true, context: { patientName: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' } });
  /* past the slow keep-alive interval: the progress poster throttles to one
     post per 3s, so the onProbe line is swallowed and the first sentence the
     phone actually receives after it is the keep-alive beat. */
  h.advance(101000); await flush(); await flush();

  eq(h.posted.filter((r) => /\/stage$/.test(r.url)).length, 0,
    'without the capability the office computer must NOT stage anything for the phone');
  eq(h.sent.filter((m) => m && m.type === 'mlsAppAthenaRemoteArmV1').length, 0,
    'without the capability the arm verb is never sent');
  const beats = h.posted.filter((r) => /\/progress$/.test(r.url));
  ok(/confirmation on this computer/.test(String(beats[beats.length - 1].init.body)),
    'without the capability the doctor is still told to confirm at the computer');
  ok(!/on your phone/.test(beats.map((b) => String(b.init.body)).join(' ')),
    'without the capability nothing must ever point the doctor at his phone');
  // and it still completes the old way
  h.tearDownSheet();
  h.ctx.__wf.opts.onResult({ ok: true, verified: true }, { context: { encounterId: 'e1', visitDate: '2026-08-19' }, verifiedWrite: true });
  const out = await p;
  eq(out.ok, true, 'the desktop-confirm path still succeeds unchanged');
}

/* ---- C2: WITH the capability the office computer stages for the phone -- */
{
  const h = harness({ capable: true, fetch: STAGE_FETCH() });
  h.api.runSendNote({ id: 'js', payload: { action: 'write_note', noteText: 'Note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.standUpSheet('pv_abc');
  h.ctx.__wf.opts.onProbe({ ok: true, context: {
    patientName: 'Synthetic Test', dob: '1980-01-01', mrn: '55501',
    visitDate: '2026-08-19', provider: 'Dr Synthetic', encounterId: 'enc-77'
  } });
  await flush(); await flush();

  const stage = h.posted.filter((r) => /\/stage$/.test(r.url))[0];
  ok(stage, 'the office computer must stage the sheet for the phone');
  const sb = JSON.parse(stage.init.body);
  eq(sb.previewHash, 'pv_abc', 'the stage carries the sheet OWN preview hash, read off the confirm control');
  eq(sb.identity.name, 'Synthetic Test', 'the stage carries the identity ATHENA reported');
  eq(sb.identity.dob, '1980-01-01', 'the stage carries the DOB Athena reported');
  eq(sb.identity.mrn, '55501', 'the stage carries the MRN Athena reported - the third factor');
  eq(sb.encounter.date, '2026-08-19', 'the stage carries the encounter date');
  eq(sb.encounter.provider, 'Dr Synthetic', 'the stage carries the provider');
  eq(sb.encounter.id, 'enc-77', 'the stage carries the encounter id');
  eq(sb.action, 'write_note', 'the stage names the action');
}

/* ---- C3: THE HASH BINDING. An altered note must be refused ------------- */
{
  const h = harness({ capable: true, fetch: STAGE_FETCH({ progress: () => ({ phoneConfirm: { previewHash: 'pv_SOMETHING_ELSE', at: Date.now() } }) }) });
  const p = h.api.runSendNote({ id: 'jd', payload: { action: 'write_note', noteText: 'Note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.standUpSheet('pv_abc');
  h.ctx.__wf.opts.onProbe({ ok: true, context: { patientName: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' } });
  await flush(); await flush();
  h.advance(9000); await flush(); await flush();

  const out = await p;
  eq(out.ok, false, 'a confirmation that does not match the staged hash must NOT write');
  ok(/no longer matches/i.test(out.error), 'the refusal says the confirmation drifted');
  ok(/nothing was written/i.test(out.error), 'the refusal says nothing was written');
  eq(h.sent.filter((m) => m && m.type === 'mlsAppAthenaRemoteArmV1').length, 0,
    'a drifted confirmation must never even reach the arm verb');
}

/* ---- C4: the happy remote path - arm, then press the SAME sheet -------- */
{
  const h = harness({ capable: true, fetch: STAGE_FETCH({ progress: () => ({ phoneConfirm: { previewHash: 'pv_abc', at: Date.now() } }) }) });
  const p = h.api.runSendNote({ id: 'jok', payload: { action: 'write_note', noteText: 'Note body.', patient: { name: 'Synthetic Test', dob: '1980-01-01' }, originDeviceId: 'dev_phone_9' } });
  await flush();
  const go = h.standUpSheet('pv_abc');
  h.ctx.__wf.opts.onProbe({ ok: true, context: { patientName: 'Synthetic Test', dob: '1980-01-01', mrn: '55501', visitDate: '2026-08-19', provider: 'Dr Synthetic', encounterId: 'enc-77' } });
  await flush(); await flush();
  h.advance(9000); await flush(); await flush();

  const arm = h.sent.filter((m) => m && m.type === 'mlsAppAthenaRemoteArmV1')[0];
  ok(arm, 'a matching confirmation must send the arm verb');
  eq(arm.source, 'mls-app', 'the arm goes out on the app bridge');
  eq(arm.action, 'write_note', 'the arm names the non-final action');
  eq(arm.previewHash, 'pv_abc', 'the arm is bound to the hash the doctor confirmed');
  eq(arm.relayJobId, 'jok', 'the arm names the relay job');
  eq(arm.originDeviceId, 'dev_phone_9', 'the arm names the device that confirmed');
  ok(arm.requestId, 'the arm carries a correlation id');

  // nothing is pressed until the extension answers
  eq(go._clicks || 0, 0, 'the sheet control must NOT be pressed before the extension answers the arm');

  h.reply({ source: 'mls-ext', type: 'mlsAppAthenaRemoteArmV1Result', requestId: arm.requestId, resp: { ok: true, armed: true } });
  await flush(); await flush();

  eq(go._clicks || 0, 1, 'once armed, the sheet OWN confirm control is pressed exactly once');
  h.tearDownSheet();
  h.ctx.__wf.opts.onResult({ ok: true, verified: true }, { context: { encounterId: 'enc-77', visitDate: '2026-08-19', provider: 'Dr Synthetic' }, verifiedWrite: true });
  const out = await p;
  eq(out.ok, true, 'a phone-confirmed write reports ok');
  eq(out.data.confirmed, true, 'the receipt records the confirmation');
  eq(out.data.encounterId, 'enc-77', 'the receipt names the encounter written');
}

/* ---- C5: the extension refusing the arm must fail honestly ------------- */
{
  for (const [resp, re] of [
    [{ ok: false, reason: 'stale-hash' }, /would not accept/i],
    [{ ok: true, armed: false, reason: 'refused' }, /would not accept/i]
  ]) {
    const h = harness({ capable: true, fetch: STAGE_FETCH({ progress: () => ({ phoneConfirm: { previewHash: 'pv_abc', at: Date.now() } }) }) });
    const p = h.api.runSendNote({ id: 'jz', payload: { action: 'write_note', noteText: 'N.', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
    await flush();
    h.standUpSheet('pv_abc');
    h.ctx.__wf.opts.onProbe({ ok: true, context: { patientName: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' } });
    await flush(); await flush();
    h.advance(9000); await flush(); await flush();
    const arm = h.sent.filter((m) => m && m.type === 'mlsAppAthenaRemoteArmV1')[0];
    h.reply({ source: 'mls-ext', type: 'mlsAppAthenaRemoteArmV1Result', requestId: arm.requestId, resp });
    await flush(); await flush();
    const out = await p;
    eq(out.ok, false, 'a refused arm must not write');
    ok(re.test(out.error), 'the refusal is explained');
    ok(/[Nn]othing was written/.test(out.error), 'the refusal says nothing was written');
    ok(/office computer instead/.test(out.error), 'the doctor is told what to do instead');
  }
}

/* ---- C6: a sheet that drifted must not be pressed even after an arm ---- */
{
  const h = harness({ capable: true, fetch: STAGE_FETCH({ progress: () => ({ phoneConfirm: { previewHash: 'pv_abc', at: Date.now() } }) }) });
  const p = h.api.runSendNote({ id: 'jdr', payload: { action: 'write_note', noteText: 'N.', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.standUpSheet('pv_abc');
  h.ctx.__wf.opts.onProbe({ ok: true, context: { patientName: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' } });
  await flush(); await flush();
  h.advance(9000); await flush(); await flush();
  const arm = h.sent.filter((m) => m && m.type === 'mlsAppAthenaRemoteArmV1')[0];
  /* between the arm and the press the sheet is rebuilt for a different note */
  h.els.get('mlsAthenaActionGo').setAttribute('data-mls-preview-hash', 'pv_DIFFERENT');
  h.reply({ source: 'mls-ext', type: 'mlsAppAthenaRemoteArmV1Result', requestId: arm.requestId, resp: { ok: true, armed: true } });
  await flush(); await flush();
  const out = await p;
  eq(out.ok, false, 'a sheet that changed under the arm must not be pressed');
  ok(/could not complete/i.test(out.error), 'the failure is explained');
  ok(/[Nn]othing was written/.test(out.error), 'and says nothing was written');
}

/* ---- C7: THE PHONE CONFIRM SHEET ------------------------------------- */
const STAGE = {
  previewHash: 'pv_abc',
  identity: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' },
  encounter: { date: '2026-08-19', provider: 'Dr Synthetic', id: 'enc-77' }
};
const LONG_NOTE = Array.from({ length: 60 }, (_, i) => 'Line ' + (i + 1) + ' of the reviewed note.').join('\n');

function sheetOf(h) {
  return h.els.get('__body').children.filter((c) => c.id === 'mlsPhConfirm')[0] || null;
}
function allText(el) {
  let out = el.textContent || '';
  for (const c of el.children) out += ' ' + allText(c);
  return out;
}

{
  const h = harness({ capable: true });
  h.api.openConfirmSheet('j1', STAGE, LONG_NOTE);
  const sheet = sheetOf(h);
  ok(sheet, 'the confirm sheet must mount on the phone');
  eq(sheet.getAttribute('role'), 'dialog', 'the sheet is a dialog');
  eq(sheet.getAttribute('aria-modal'), 'true', 'the sheet is modal');

  const txt = allText(sheet);
  /* FULL IDENTITY - all three factors, visible */
  ok(/Synthetic Test/.test(txt), 'the sheet shows the patient name Athena reported');
  ok(/1980-01-01/.test(txt), 'the sheet shows the DOB');
  ok(/55501/.test(txt), 'the sheet shows the MRN');
  ok(/2026-08-19/.test(txt), 'the sheet shows the encounter date');
  ok(/Dr Synthetic/.test(txt), 'the sheet shows the provider');

  /* THE NOTE IS VERBATIM AND COMPLETE */
  const noteEl = h.ctx.document.getElementById('mlsPhConfirmNote');
  ok(noteEl, 'the sheet has a note panel');
  eq(noteEl.textContent, LONG_NOTE, 'the note must be shown EXACTLY and in full - never truncated');
  ok(noteEl.textContent.includes('Line 60 of'), 'the last line of a long note is present');

  /* it must say what it will and will not do */
  ok(/does not sign it/i.test(txt), 'the sheet says it does not sign');
  ok(/place any order/i.test(txt), 'the sheet says it places no order');

  /* THE CONFIRM IS DELIBERATE and names the patient */
  const goEl = h.ctx.document.getElementById('mlsPhConfirmGo');
  ok(goEl, 'the sheet has a confirm control');
  ok(/Hold to send/.test(goEl.textContent + ' ' + allText(goEl)), 'the control asks for a HOLD, not a tap');
  ok(/Synthetic Test/.test(allText(goEl)), 'the confirm control names the patient');
  ok(/Hold/.test(String(goEl.getAttribute('aria-label'))), 'the control describes the hold to screen readers');
  ok(h.ctx.document.getElementById('mlsPhConfirmNo'), 'the sheet offers Cancel');
  eq(h.api.confirmState().hash, 'pv_abc', 'the sheet is bound to the staged hash');
}

/* ---- C8: a short hold must NOT confirm; a full hold must -------------- */
{
  const h = harness({ capable: true, fetch: (url, init) => {
    if (/\/confirm$/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, confirmed: true }) };
    return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  } });
  h.api.openConfirmSheet('j2', STAGE, 'Note body.');
  const goEl = h.ctx.document.getElementById('mlsPhConfirmGo');

  // press and release well short of the hold time
  goEl.fire('pointerdown', {});
  h.advance(400);
  goEl.fire('pointerup', {});
  h.advance(3000); await flush();
  eq(h.posted.filter((r) => /\/confirm$/.test(r.url)).length, 0,
    'releasing early must NOT confirm - that is the whole point of a hold');
  ok(sheetOf(h), 'the sheet stays open after an aborted hold');

  // a full hold confirms exactly once
  goEl.fire('pointerdown', {});
  h.advance(1500); await flush(); await flush();
  const confirms = h.posted.filter((r) => /\/confirm$/.test(r.url));
  eq(confirms.length, 1, 'a completed hold confirms exactly once');
  eq(JSON.parse(confirms[0].init.body).previewHash, 'pv_abc',
    'the confirmation names the hash the doctor was shown');
  eq(sheetOf(h), null, 'the sheet closes once confirmed');
  eq(h.api.sendState().status, 'working', 'the phone then waits for the write');
}

/* ---- C9: Cancel must not confirm ------------------------------------- */
{
  const h = harness({ capable: true });
  h.api.openConfirmSheet('j3', STAGE, 'Note body.');
  h.ctx.document.getElementById('mlsPhConfirmNo').click();
  await flush();
  eq(h.posted.filter((r) => /\/confirm$/.test(r.url)).length, 0, 'Cancel must never confirm');
  eq(sheetOf(h), null, 'Cancel closes the sheet');
  ok(/Not sent/.test(h.api.sendState().line), 'Cancel says plainly that nothing was sent');
}

/* ---- C10: a server refusal of the confirmation is reported honestly ---- */
{
  const h = harness({ capable: true, fetch: (url) => {
    if (/\/confirm$/.test(url)) return { ok: false, status: 409, json: () => Promise.resolve({ error: 'that confirmation does not match what was staged - the note or the patient changed, so nothing was confirmed' }) };
    return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  } });
  h.api.openConfirmSheet('j4', STAGE, 'Note body.');
  await h.api.sendConfirmNow('j4', 'pv_abc');
  await flush();
  eq(h.api.sendState().status, 'failed', 'a refused confirmation must show as failed');
  ok(/does not match what was staged/.test(h.api.sendState().line), 'the server reason reaches the doctor');
  eq(sheetOf(h), null, 'the sheet closes rather than inviting a second doomed hold');
}

/* ---- C11: a reloaded phone cannot confirm a note it can no longer show - */
{
  const h = harness({ capable: true });
  h.api.openConfirmSheet('j5', STAGE, '');   // note text lost to a reload
  const goEl = h.ctx.document.getElementById('mlsPhConfirmGo');
  eq(goEl.disabled, true, 'with no note text to show, the confirm control must stand down');
  const noteEl = h.ctx.document.getElementById('mlsPhConfirmNote');
  ok(/no longer holds the exact note/i.test(noteEl.textContent), 'it says why it cannot confirm');
  ok(/office computer instead/i.test(noteEl.textContent), 'it names the way forward');
  goEl.fire('pointerdown', {});
  h.advance(2000); await flush();
  eq(h.posted.filter((r) => /\/confirm$/.test(r.url)).length, 0,
    'a stood-down control must not confirm even if pressed');
}

/* ---- C12: the poll opens the sheet when the desktop stages ------------- */
{
  let staged = false;
  const h = harness({ capable: true, fetch: (url, init) => {
    if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeId: 'dev_office' }) };
    if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_c' }) };
    if (/\/api\/relay\/jobs\/rj_c$/.test(url)) {
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: staged
        ? { id: 'rj_c', status: 'taken', stage: STAGE }
        : { id: 'rj_c', status: 'taken' } }) };
    }
    return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  } });
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: LONG_NOTE, patient: { name: 'Synthetic Test', dob: '1980-01-01' } });
  await flush(); await flush();
  h.advance(3000); await flush(); await flush();
  eq(sheetOf(h), null, 'no sheet before the desktop stages one');

  staged = true;
  h.advance(3000); await flush(); await flush();
  ok(sheetOf(h), 'the phone opens the confirm sheet as soon as the desktop stages it');
  eq(h.api.sendState().status, 'confirm', 'the phone reports that it is waiting on the doctor');
  eq(h.ctx.document.getElementById('mlsPhConfirmNote').textContent, LONG_NOTE,
    'the sheet shows the exact note this phone sent, in full');

  /* and it does not reopen a second sheet on every poll */
  h.advance(6000); await flush(); await flush();
  eq(h.els.get('__body').children.filter((c) => c.id === 'mlsPhConfirm').length, 1,
    'polling must not stack duplicate confirm sheets');
}

/* =======================================================================
 * PART D - phclean-1.0.0: the phone UI cleanup ("its kinda old").
 * feat_mls_phone_ui.js has no 1p fork, so it is production bytes and this
 * lane may not edit it. Everything here is either a fix in a file this lane
 * DOES own, or an overlay scoped to #mlsPh3.
 * =====================================================================*/

/* ---- D1: the version-nag banner had stopped being kept off the phone ---
 * This is the defect the ph3 rebuild recorded and then re-introduced: the
 * banner's ONLY phone guard tested `mls-phone`, and ph3 REMOVES that class
 * when it mounts. From ph3 onward it drew over the middle of a 375x812
 * screen at z-index 2147483100 - the same banner whose own comment records
 * it making 6 of 19 controls unclickable. */
{
  const phoneUi = read('feat_mls_phone_ui.js');
  ok(/classList\.remove\('mls-phone'\)/.test(phoneUi),
    'precondition: the phone module still removes mls-phone (if this changes, re-check the guard)');
  ok(/classList\.add\('mls-ph3'\)/.test(phoneUi),
    'precondition: the phone module still adds mls-ph3');

  const guard = /function banner\(msg, how\) \{([\s\S]*?)if \(\$\('mlsR46VerBanner'\)/.exec(connect);
  ok(guard, 'the nag banner guard must be locatable');
  ok(/contains\('mls-phone'\)/.test(guard[1]), 'the old class is still covered');
  ok(/contains\('mls-ph3'\)/.test(guard[1]), 'the CURRENT phone class must be covered too');
  ok(/__mlsPhoneUI/.test(guard[1]) && /\.mounted/.test(guard[1]),
    'the guard must also ask the durable question - is the phone app actually mounted');
  ok(/inherits every guard that class was carrying/.test(guard[1]),
    'the reason must be written down so the next rename does not silently do it again');
}

/* ---- D2: the touch-target floor, measured from the shipped stylesheet --
 * Declared sizes, not rendered ones - a rendered pass at 375x812 needs a
 * real browser and is reported separately. This is still a real regression
 * guard: every interactive ph3 class must declare at least 40px, either in
 * the phone stylesheet or through the phclean overlay. */
{
  const phoneUi = read('feat_mls_phone_ui.js');
  const INTERACTIVE = ['ph3-primary', 'ph3-secondary', 'ph3-dot', 'ph3-pill', 'ph3-arrow',
    'ph3-today', 'ph3-row', 'ph3-item', 'ph3-nx', 'ph3-find'];
  /* Both stylesheets are written as JS string FRAGMENTS - the phone module as
     an array ('...', '...') and the overlay as a concatenation ('...' + '...').
     A declaration therefore routinely straddles a fragment boundary, e.g.
        '#mlsPh3 .ph3-primary{display:flex;...width:100%;',
        'min-height:56px;border:0;...'
     so the joins must be closed up before any property can be read. Without
     this the parser silently reports 0 for a control that declares 56. */
  const joinFragments = (s) => s.replace(/'\s*,\s*\n\s*'/g, '').replace(/'\s*\+\s*\n\s*'/g, '');
  const sizeOf = (rawSrc, cls) => {
    const src = joinFragments(rawSrc);
    const rx = new RegExp('\\.' + cls + '\\{([^}]*)', 'g');
    let best = 0, seen = false;
    let m;
    while ((m = rx.exec(src))) {
      seen = true;
      const body = m[1];
      const mh = /(?:^|;)\s*min-height:(\d+(?:\.\d+)?)px/.exec(body);
      const h = /(?:^|;)\s*height:(\d+(?:\.\d+)?)px/.exec(body);
      const v = Number((mh && mh[1]) || (h && h[1]) || 0);
      if (v > best) best = v;
    }
    return seen ? best : null;
  };
  const overlayBlockStart = connect.indexOf('/* ===== phclean-1.0.0 (2026-08-19');
  ok(overlayBlockStart > 0, 'the phclean overlay block must exist');
  const overlay = connect.slice(overlayBlockStart, connect.indexOf('/* ===== end phsend-1.0.0 ='));

  const report = [];
  for (const cls of INTERACTIVE) {
    const before = sizeOf(phoneUi, cls);
    const after = sizeOf(overlay, cls) || before;
    report.push({ cls, before, after });
    ok(before !== null, `${cls} must exist in the phone stylesheet`);
    ok(after >= 40, `${cls} must declare at least 40px of touch height (declared ${after})`);
  }
  /* the one that was actually under the floor, pinned so it cannot slip back */
  const nx = report.filter((r) => r.cls === 'ph3-nx')[0];
  eq(nx.before, 30, 'ph3-nx was 30px in the shipped stylesheet');
  eq(nx.after, 44, 'ph3-nx must be raised to 44px by the overlay');
  /* and nothing else was quietly resized */
  for (const r of report) {
    if (r.cls === 'ph3-nx') continue;
    eq(r.after, r.before, `${r.cls} must be left exactly as the phone module declares it`);
  }
}

/* ---- D3: the overlay is injected, scoped, and only where it belongs ---- */
{
  const h = harness({});
  h.api.phsendMount();
  const style = h.ctx.document.getElementById('mlsPhCleanCss');
  ok(style, 'mounting the phone must inject the cleanup overlay');
  ok(/#mlsPh3 \.ph3-nx/.test(style.textContent), 'the overlay is scoped to the phone frame');
  ok(/44px!important/.test(style.textContent),
    'the size must be !important - the phone stylesheet loads after this one and would otherwise win on order');
  ok(!/body|html|\*\s*\{/.test(style.textContent), 'the overlay must not reach outside #mlsPh3');

  // injected once, not on every mount tick
  h.api.phsendMount();
  h.api.phsendMount();
  eq(h.els.get('__head').children.filter((c) => c.id === 'mlsPhCleanCss').length, 1,
    'the overlay must be injected exactly once');
}

} /* end main */

main().then(function () {
  console.log('PASS 1p phone send-to-athena (phsend-1.0.0): ' + checks +
    ' checks - final actions refused at the runner, one NAMED armed press and no other click, official 1p->production/cloned relay parity, identity law (name-only never resolves, ambiguity refused), real startAthenaAction staging, human-confirm beats, closed-sheet + nobody-came + timeout + refusal all fail honestly, phone lifecycle queued->working->SENT, old-server/offline/signed-out/lost/expired degraded modes, button placement and repaint survival; phconfirm: no-capability path byte-identical, stage carries Athena-reported identity, drifted hash never arms, arm verb per spec then one press, refused arm honest, sheet shows name+DOB+MRN+encounter+provider and the note in full, short hold does not confirm, Cancel does not confirm, reloaded phone stands the control down');
}, function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
