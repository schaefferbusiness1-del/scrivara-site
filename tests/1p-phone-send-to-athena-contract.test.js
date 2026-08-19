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
 * It also pins the boundary: sendNote STAGES a write for a human to confirm at
 * the office computer. It cannot execute one - MLS Assist arms an Athena
 * mutation only from a real trusted click (content.js
 * ATHENA_ACTION_V2_CLICK_GATE) - and this suite proves the runner refuses
 * every final action rather than relying on the server or the extension to be
 * the only refusal.
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
for (const bypass of ['.click(', 'dispatchEvent', 'isTrusted', 'execCommand']) {
  ok(!blockCode.includes(bypass),
    `the phsend block's CODE must not touch ${bypass} - the clinician's own press is the authorization`);
}
ok(/isTrusted/.test(block) && /ATHENA_ACTION_V2_CLICK_GATE/.test(block),
  'the block must explain in prose WHY it cannot execute the write, so the next reader does not try');
ok(/cannot execute|does not try|never claims/i.test(block),
  'the block must state its own limit in words');

/* A5: SHARED PRODUCTION FILES ARE UNTOUCHED. feat_mls_phone_ui.js has NO 1p
   fork, so it is the same bytes production serves - editing it would ship to
   live doctors on a green gate. Same for mls-connect.js and the unforked
   writeflow. This asserts the lane law was kept, not merely intended.
   cloned-mls-connect.js is deliberately NOT in this list: it is DERIVED from
   1p-mls-connect.js by scripts/derive-cloned-from-1p.js (CONNECT_SRC ->
   CONNECT_OUT), so it legitimately gains phsend when the lead re-derives, and
   pinning it empty here would turn this suite red on a correct derive. */
for (const shared of ['mls-connect.js', 'feat_mls_phone_ui.js', 'feat_mls_writeflow.js']) {
  const s = read(shared);
  ok(!s.includes('phsend'), `${shared} is a shared/production file and must not carry phsend`);
  ok(!s.includes('sendNote'), `${shared} must not have been taught the sendNote kind`);
}
// and the derive relationship must still hold, so the note above stays true
const derive = read('scripts/derive-cloned-from-1p.js');
ok(/CONNECT_SRC\s*=\s*'1p-mls-connect\.js'/.test(derive) && /CONNECT_OUT\s*=\s*'cloned-mls-connect\.js'/.test(derive),
  'cloned-mls-connect.js must still be derived from 1p-mls-connect.js (if this changes, re-check A5)');

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

function makeEl(id) {
  const el = {
    id, style: { cssText: '', display: '' }, children: [], parentNode: null,
    textContent: '', type: '', className: '', disabled: false, value: '',
    nextSibling: null, _listeners: {},
    setAttribute() {}, getAttribute() { return null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.push(c); return c; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
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
    click() { (this._listeners.click || []).forEach((f) => f({})); }
  };
  return el;
}

function harness(opts) {
  opts = opts || {};
  const timers = new Map();
  let nextId = 1, now = Date.now();
  const els = new Map();
  ['mlsPh3', 'mlsPh3Act', 'noteBox'].forEach((id) => els.set(id, makeEl(id)));
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
      createElement: (t) => makeEl(''),
      addEventListener() {}, removeEventListener() {}
    }
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.window.addEventListener = () => {};
  ctx.window.removeEventListener = () => {};
  ctx.window.postMessage = () => {};
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

  // (b) nobody ever came
  h = harness({});
  p = h.api.runSendNote({ id: 'jt', payload: { action: 'write_note', noteText: 'n', patient: { name: 'Synthetic Test', dob: '1980-01-01' } } });
  await flush();
  h.advance(10 * 60 * 1000); await flush();
  out = await p;
  eq(out.ok, false, 'an unconfirmed send must fail, not hang forever');
  ok(/[Nn]obody confirmed/i.test(out.error), 'says nobody confirmed');
  ok(/note is safe in MLS/i.test(out.error), 'reassures the doctor the note is not lost');

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
        if (jobState === 'done') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_test', status: 'done', result: { ok: true, data: { confirmed: true, encounterId: 'enc-7', visitDate: '2026-08-18', provider: 'Dr Synthetic' } } } }) };
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

} /* end main */

main().then(function () {
  console.log('PASS 1p phone send-to-athena (phsend-1.0.0): ' + checks +
    ' checks - final actions refused at the runner, no trusted-click bypass, shared production files untouched, identity law (name-only never resolves, ambiguity refused), real startAthenaAction staging, human-confirm beats, closed-sheet + nobody-came + timeout + refusal all fail honestly, phone lifecycle queued->working->SENT, old-server/offline/signed-out/lost/expired degraded modes, button placement and repaint survival');
}, function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
