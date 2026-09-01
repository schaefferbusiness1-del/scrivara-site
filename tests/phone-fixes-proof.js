'use strict';

/* phone-fixes-proof  (phfix-1.0.0, b1169)
 * ============================================================================
 * Five measured defects on the phone surface (ScribeFlow.html?ph...), each
 * pinned here by the PROPERTY that was wrong rather than by the spelling of
 * the fix. A refactor that keeps the property must keep this suite green; a
 * refactor that quietly restores the defect must red it.
 *
 *  55  CANCEL DID NOT STICK. phsendPollJob kept its interval id in a
 *      function-local and stored no handle, so api.cancelSend() could not stop
 *      it. Cancel closed the sheet, phcClose() zeroed phcState.jobId, and
 *      2.5 s later the still-running poll walked past phcOpen's own
 *      re-entrancy guard (which compares against that now-blank id) and put
 *      the sheet back - on top of whatever the doctor had moved on to, every
 *      2.5 s, for up to eleven minutes, carrying a live hold-to-send control
 *      for a note he had explicitly refused.
 *
 *  56  THE SHEET KEPT PHI PAST THE ACCOUNT BOUNDARY. #mlsPhConfirm is appended
 *      to document.body at z-index 2147483400 with the patient's name, DOB,
 *      MRN, encounter date, provider and the verbatim note. logout() does not
 *      reload - it hides #appScreen and shows #authScreen - and
 *      sfResetTransientSessionDom() clears only '.modal-bg.show' and a named
 *      id list that does not include this sheet. Nothing listened for
 *      mls:session-boundary anywhere in the relay module.
 *
 *  57  "SEND TO ATHENA" WAS ENABLED WHILE STILL RECORDING OR STILL WRITING.
 *      phsendPaint set btnEl.disabled = false unconditionally on every 1.2 s
 *      paint, and phsendNoteText() reads #noteBox LIVE at press time - so one
 *      thumb press during a resumed recording relayed the pre-resume text for
 *      a chart write, under a bar that at that moment read "Stop recording".
 *
 *  58  THE MOBILE NOTICE SHELF COVERED THE PHONE'S ONLY NAV CONTROL.
 *      mlsNoticeAnchor() measures #appHeader / #mlsCtxBar / #patientBar, all
 *      three of which the phone app sets to display:none, so the anchor
 *      collapsed to its 12px floor - straight across #mlsPh3Hdr and
 *      #mlsPh3Nav (Menu on the day screen, "< Day" on a visit).
 *
 *  59  TWO BARS EACH CLAIMED THE BOTTOM SAFE AREA. #mlsPh3Act reserves
 *      env(safe-area-inset-bottom) because it is normally the frame's bottom
 *      element; #mlsPhSendBar is inserted as its next sibling and reserves it
 *      again, so ~34px of home-indicator gap sat in the MIDDLE of the visit
 *      screen above a visible border.
 *
 * No network, no browser, no PHI, no extension. Source and a VM harness only.
 *
 * Run: node tests/phone-fixes-proof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; assert(cond, msg); }
function eq(a, b, msg) { checks++; assert.strictEqual(a, b, msg); }

const connect1p = read('1p-mls-connect.js');
const connectProd = read('mls-connect.js');
const connectCloned = read('cloned-mls-connect.js');
const shell1p = read('1pScribeFlow.html');
const shellLive = read('1p/index.html');
const shellProd = read('ScribeFlow.html');
const shellCloned = read('cloned/index.html');
const phoneUi = read('feat_mls_phone_ui.js');

const CONNECT_LANES = [['1p-mls-connect.js', connect1p], ['mls-connect.js', connectProd], ['cloned-mls-connect.js', connectCloned]];
const SHELL_LANES = [['1pScribeFlow.html', shell1p], ['1p/index.html', shellLive], ['ScribeFlow.html', shellProd], ['cloned/index.html', shellCloned]];

/* ==========================================================================
 * 0. THE VM HARNESS. The REAL relay module, evaluated with fake time, fake
 *    fetch and a fake DOM, then driven exactly as the phone would drive it.
 *    Adapted from tests/1p-phone-send-to-athena-contract.test.js, with two
 *    additions this suite needs: a window.addEventListener that records EVERY
 *    event type (the contract harness records only 'message', which would
 *    silently swallow the session-boundary listener item 56 is about), and a
 *    real classList (item 59 toggles one).
 * ========================================================================*/
const relayStart = connect1p.indexOf('/* ===== __mlsRelayLink rl-1.0.0');
const relayEnd = connect1p.indexOf('/* ===== __mlsPhoneHome ph-1.0.0');
ok(relayStart > 0 && relayEnd > relayStart, 'the relay module must be locatable for runtime evaluation');
let relaySrc = connect1p.slice(relayStart, relayEnd);
relaySrc = relaySrc.slice(0, relaySrc.lastIndexOf('})();') + 5);
ok(relaySrc.includes('phsend-1.0.0'), 'the sliced relay module must contain the phsend block');
ok(relaySrc.includes('phfix-1.0.0'), 'the sliced relay module must contain the phfix work');

function makeEl(id, tag) {
  const classes = [];
  const el = {
    id, tag: tag || 'div', style: { cssText: '', display: '', width: '', color: '', opacity: '', cursor: '' },
    children: [], parentNode: null,
    textContent: '', type: '', className: '', disabled: false, value: '',
    _listeners: {}, _attrs: {}, _html: '',
    /* LIVE sibling/child accessors. The contract harness this is adapted from
       carries `nextSibling: null` as a dead field and an insertBefore that
       ignores its reference node - fine for a bar appended to a frame, useless
       for phteam, whose whole placement claim is "directly under QUICK
       HISTORY". A test that cannot tell position from presence cannot check
       the thing the owner asked for. */
    get nextSibling() {
      const p = this.parentNode;
      if (!p) return null;
      const i = p.children.indexOf(this);
      return (i > -1 && i + 1 < p.children.length) ? p.children[i + 1] : null;
    },
    get firstChild() { return this.children.length ? this.children[0] : null; },
    classList: {
      add(c) { if (classes.indexOf(c) < 0) classes.push(c); },
      remove(c) { const i = classes.indexOf(c); if (i > -1) classes.splice(i, 1); },
      contains(c) { return classes.indexOf(c) > -1; },
      toggle(c, on) { if (on) this.add(c); else this.remove(c); }
    },
    _classes: classes,
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i > -1) this.children.splice(i, 0, c); else this.children.push(c);
      return c;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); c.parentNode = null; return c; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
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
  ['mlsPh3', 'mlsPh3Act', 'mlsPh3Body', 'noteBox', '__body', '__head'].forEach((id) => els.set(id, makeEl(id)));
  els.get('noteBox').value = opts.noteText === undefined ? 'Reviewed note body.' : opts.noteText;
  const posted = [];
  /* mutable so a leg can sign the phone out mid-flight */
  const live = { token: opts.authed === false ? '' : 'tok', snapshot: opts.snapshot === undefined
    ? { active: { id: 'appt-1', name: 'Synthetic Test', dob: '1980-01-01', time: '9:00 AM' }, phase: 'note', noteLen: 24, day: '2026-08-18' }
    : opts.snapshot };
  const ctx = {
    console, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error,
    Date: class extends Date { static now() { return now; } },
    encodeURIComponent, isNaN, parseInt, parseFloat,
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
    sessionStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m }; })(),
    localStorage: (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; })(),
    document: {
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
  if (opts.capable !== false) ctx.window.__mlsExtensionCapabilities = { phoneConfirmedWriteV1: true };
  /* EVERY event type is recorded here - that is the whole point of item 56 */
  const winListeners = Object.create(null);
  ctx.window.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
  ctx.window.removeEventListener = (t, fn) => {
    const a = winListeners[t]; if (!a) return;
    const i = a.indexOf(fn); if (i > -1) a.splice(i, 1);
  };
  ctx.window.postMessage = () => {};
  ctx.__listeners = winListeners;
  ctx.__fire = (type, detail) => { (winListeners[type] || []).slice().forEach((f) => { try { f({ type, detail }); } catch (e) {} }); };
  ctx.window.bkBase = () => 'https://api.test';
  ctx.window.bkToken = () => live.token;
  ctx.window.backendMode = () => true;
  ctx.window.__mlsExtReportedVersion = '3.0.64';
  ctx.window.toast = () => {};
  ctx.window.__mlsWriteFlow = { startAthenaAction: () => Promise.resolve({ ok: true }) };
  ctx.window.__mlsPhoneUI = {
    installed: true,
    state: () => ({ screen: opts.screen || 'visit', mounted: opts.mounted !== false, menu: false })
  };
  ctx.window.__mlsEasyV32 = { remote: { snapshot: () => live.snapshot } };
  ctx.window.__mlsDeviceRole = { effectiveRole: () => 'office', deviceId: 'dev_office', deviceNoun: () => 'phone' };
  ctx.patients = [];
  ctx.window.patients = ctx.patients;

  /* ---- the team-notes world (phteam-1.0.0) ----------------------------- */
  const store = { patients: opts.patients || [], upserts: [], reads: 0 };
  ctx.window.getPatients = () => store.patients;
  ctx.window.getActivePtId = () => String(opts.activePtId === undefined ? '' : opts.activePtId);
  ctx.window.activePatient = () => {
    const id = ctx.window.getActivePtId();
    return store.patients.filter((p) => String(p.id) === id)[0] || null;
  };
  ctx.window.upsertPatient = (copy) => {
    store.upserts.push(copy);
    /* the real store replaces the row; that is what makes the next read see it */
    for (let i = 0; i < store.patients.length; i++) {
      if (String(store.patients[i].id) === String(copy.id)) { store.patients[i] = copy; return; }
    }
    store.patients.push(copy);
  };
  ctx.window.esc = (s) => String(s);
  ctx.window.renderProfile = () => { store.reads++; };

  vm.createContext(ctx);
  vm.runInContext(relaySrc, ctx, { filename: '1p-mls-connect.js#relay' });
  /* THE REAL SHARED MODULE, in the same context. The add path is proven against
     the actual tn-1.0.0 code and the actual upsertPatient write, not a stub -
     a stub would agree with whatever the phone happened to call. */
  if (opts.teamNotes) vm.runInContext(read('feat_mls_team_notes.js'), ctx, { filename: 'feat_mls_team_notes.js' });

  return {
    ctx, live, posted, els, store,
    api: ctx.window.__mlsRelayLink,
    fire: ctx.__fire,
    listeners: winListeners,
    sheet() { return els.get('__body').children.filter((c) => c.id === 'mlsPhConfirm')[0] || null; },
    bar() { return ctx.document.getElementById('mlsPhSendBar'); },
    body() { return els.get('mlsPh3Body'); },
    card() { return ctx.document.getElementById('mlsPhTeam'); },
    /* THE PHONE'S REPAINT, faithfully: visitScreen() is written into
       #mlsPh3Body.innerHTML wholesale, so everything in there - including a
       card this file inserted - is gone. */
    repaintBody() {
      const b = els.get('mlsPh3Body');
      b.children.length = 0;
      for (const spec of [
        ['div', 'ph3-card', ''],                       /* the patient card */
        ['p', 'ph3-sect', 'Quick history'],
        ['div', 'ph3-card', 'DOB / MRN / Visits / Allergies'],
        ['p', 'ph3-sect', 'What was said'],
        ['textarea', 'ph3-ta', '']
      ]) {
        const el = makeEl(spec[0] === 'textarea' ? 'mlsPh3Tx' : '', spec[0]);
        el.className = spec[1];
        el.textContent = spec[2];
        b.appendChild(el);
      }
      return b;
    },
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      while (guard++ < 20000) {
        let soonest = null;
        for (const [id, t] of timers) { if (t.due <= target && (!soonest || t.due < soonest[1].due)) soonest = [id, t]; }
        if (!soonest) break;
        now = soonest[1].due;
        if (soonest[1].iv) soonest[1].due = now + soonest[1].iv; else timers.delete(soonest[0]);
        try { soonest[1].fn(); } catch (e) { /* the module guards its own timers */ }
      }
      now = target;
    }
  };
}
const flush = () => new Promise((r) => setImmediate(r));

const STAGE = {
  previewHash: 'pv_abc',
  identity: { name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501' },
  encounter: { date: '2026-08-19', provider: 'Dr Synthetic' }
};
const NOTE = 'Reviewed note body for the synthetic test patient.';

/* A relay server that stages the job and then never changes its mind - which
   is exactly the state the poll re-opened the sheet from. The cancel POST is
   made to FAIL, because that is the ordinary phone case (no signal, office
   computer gone) and a Cancel whose effect depends on it is not a Cancel. */
function stagedServer(count) {
  return (url, init) => {
    if (/presence/.test(url)) return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, online: true, ext: true, officeId: 'dev_office' }) };
    if (/\/api\/relay\/jobs$/.test(url) && init.method === 'POST') return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, id: 'rj_x' }) };
    if (/\/api\/relay\/jobs\/rj_x\/cancel$/.test(url)) { count.cancel++; return { ok: false, status: 503, json: () => Promise.resolve({ error: 'offline' }) }; }
    if (/\/api\/relay\/jobs\/rj_x$/.test(url)) { count.poll++; return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, job: { id: 'rj_x', status: 'taken', stage: STAGE } }) }; }
    return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  };
}
async function stagedAndOpen(count) {
  const h = harness({ fetch: stagedServer(count) });
  await h.api.sendNoteToAthena({ action: 'write_note', noteText: NOTE, patient: { name: 'Synthetic Test', dob: '1980-01-01' }, apptId: 'appt-1' });
  await flush(); await flush();
  h.advance(3000); await flush(); await flush();
  return h;
}

async function main() {

/* ==========================================================================
 * ITEM 55 - CANCEL STICKS.
 * ========================================================================*/
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  ok(h.sheet(), '55: the sheet must be up before Cancel can be tested');
  eq(h.api.confirmState().jobId, 'rj_x', '55: the sheet is bound to the staged job');
  const pollsAtCancel = count.poll;
  ok(pollsAtCancel > 0, '55: the poll must have been running');

  h.ctx.document.getElementById('mlsPhConfirmNo').click();
  await flush(); await flush();
  eq(h.sheet(), null, '55: Cancel closes the sheet');
  ok(/Not sent/.test(h.api.sendState().line), '55: Cancel says plainly that nothing was sent');
  ok(count.cancel >= 1, '55: Cancel still tells the server, even though it does not depend on it');

  /* THE DEFECT: two further poll windows. Before the fix a sheet came back on
     the very first one, and kept coming back. */
  h.advance(10000); await flush(); await flush(); await flush();
  eq(h.sheet(), null, '55: the poll must NOT re-open a sheet the doctor cancelled');
  eq(h.els.get('__body').children.filter((c) => c.id === 'mlsPhConfirm').length, 0,
    '55: no confirm sheet of any kind survives a Cancel');
  eq(count.poll, pollsAtCancel, '55: the poll itself is STOPPED by Cancel, not merely ignored');
  ok(!/Read the note and confirm/.test(h.api.sendState().line),
    '55: the phone must not go back to asking for a confirmation it was refused');
  eq(h.api.confirmState().open, false, '55: confirmState reports the sheet closed');
}

/* 55b: the second, independent stop - a response that was ALREADY on the wire
   when Cancel ran cannot re-open the sheet on its way back. Proven by asking
   phcOpen directly for the refused id, which is what that in-flight branch
   does. */
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  h.ctx.document.getElementById('mlsPhConfirmNo').click();
  await flush();
  h.api.openConfirmSheet('rj_x', STAGE, NOTE);
  eq(h.sheet(), null, '55b: a refused job id is never re-staged, even by a direct open');
  /* a DIFFERENT job is unaffected - this is a refusal, not a shutdown */
  h.api.openConfirmSheet('rj_other', STAGE, NOTE);
  ok(h.sheet(), '55b: a different job may still open its own sheet');
}

/* 55c: "Stop waiting" on the send bar is the same refusal and must behave the
   same way - it is the only Cancel a doctor can reach once the sheet is gone. */
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  h.advance(1500); await flush();
  const btn = h.bar().querySelector('.phsend-go');
  eq(btn.textContent, 'Stop waiting', '55c: while a send is in flight the button cancels');
  eq(btn.disabled, false, '55c: the cancel affordance is never disabled');
  const pollsBefore = count.poll;
  btn.click();
  await flush(); await flush();
  h.advance(10000); await flush(); await flush();
  eq(h.sheet(), null, '55c: Stop waiting must not leave a sheet coming back');
  eq(count.poll, pollsBefore, '55c: Stop waiting stops the poll');
}

/* 55d: source - the handle exists, cancel reaches it, and it does so BEFORE
   the network call, in every lane. */
for (const [name, src] of CONNECT_LANES) {
  ok(/var phsendPollIv = 0;/.test(src), `55d/${name}: the poll must keep a module-scoped handle`);
  ok(/function phsendStopPoll\(\)/.test(src), `55d/${name}: there must be one named way to stop the poll`);
  ok(/var phcRefused = '';/.test(src), `55d/${name}: a refused job id must be remembered`);
  const cancelFn = /api\.cancelSend = function \(\) \{([\s\S]*?)\n  \};/.exec(src);
  ok(cancelFn, `55d/${name}: api.cancelSend must be locatable`);
  const stopAt = cancelFn[1].indexOf('phsendStopPoll()');
  const fetchAt = cancelFn[1].indexOf('fetch(');
  ok(stopAt > -1, `55d/${name}: cancelSend must stop the poll`);
  ok(fetchAt > -1 && stopAt < fetchAt, `55d/${name}: cancelSend must stop the poll BEFORE the cancel POST it cannot rely on`);
  ok(/if \(jobId && phcRefused && phcRefused === String\(jobId\)\) return;/.test(src),
    `55d/${name}: phcOpen must refuse to reopen a refused job`);
}

/* ==========================================================================
 * ITEM 56 - NO PHI SURVIVES THE ACCOUNT BOUNDARY.
 * ========================================================================*/
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  const sheet = h.sheet();
  ok(sheet, '56: the sheet must be up before the boundary can be tested');
  /* everything the sheet is carrying, named */
  const idy = sheet.children[0] ? sheet.children[0].innerHTML : '';
  for (const secret of ['Synthetic Test', '1980-01-01', '55501', '2026-08-19', 'Dr Synthetic']) {
    ok(idy.indexOf(secret) > -1, `56: the sheet really does carry ${secret} before the boundary`);
  }
  eq(h.ctx.document.getElementById('mlsPhConfirmNote').textContent, NOTE,
    '56: the sheet really does carry the whole note before the boundary');
  ok(h.ctx.sessionStorage.getItem('mlsPhSendActive'), '56: a resume record really is on the device');

  ok((h.listeners['mls:session-boundary'] || []).length > 0,
    '56: the relay module must listen for the account boundary');
  h.fire('mls:session-boundary', { reason: 'logout' });
  await flush();

  eq(h.sheet(), null, '56: the sheet is gone at the account boundary');
  eq(h.ctx.document.getElementById('mlsPhConfirmNote'), null, '56: the note element is gone with it');
  eq(h.ctx.sessionStorage.getItem('mlsPhSendActive'), null, '56: the resume record is dropped');
  eq(h.api.sendState().status, 'idle', '56: the relay reports nothing in flight');
  eq(h.api.sendState().line, '', '56: no status line survives naming the previous account work');
  eq(h.api.confirmState().jobId, '', '56: the confirm binding is cleared');

  /* and the poll that would rebuild all three is stopped */
  const pollsAfter = count.poll;
  h.advance(10000); await flush(); await flush();
  eq(count.poll, pollsAfter, '56: the poll stops at the boundary rather than outliving the account');
  eq(h.sheet(), null, '56: nothing re-opens the sheet after the boundary');
}

/* 56b: the in-memory note bytes are dropped too - a sheet re-opened after the
   boundary must not be able to show the previous account's note. */
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  h.fire('mls:session-boundary', { reason: 'logout' });
  await flush();
  h.api.openConfirmSheet('rj_new', STAGE, h.api.sendState().noteSent);
  const note = h.ctx.document.getElementById('mlsPhConfirmNote');
  if (note) ok(note.textContent.indexOf(NOTE) < 0, '56b: the previous account note bytes are not still in memory');
  else ok(true, '56b: no sheet at all after the boundary is also correct');
}

/* 56c: a signed-out phone stops on the very next tick and shows nobody a
   chart, even if the boundary event never fires (a token expiring under it). */
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  ok(h.sheet(), '56c: the sheet must be up first');
  h.live.token = '';                      // the session ends under the phone
  h.advance(3000); await flush(); await flush();
  eq(h.sheet(), null, '56c: a signed-out phone drops the sheet on the next tick');
  const pollsAfter = count.poll;
  h.advance(10000); await flush(); await flush();
  eq(count.poll, pollsAfter, '56c: and stops asking the server about it');
}

/* 56d: phcOpen itself refuses to paint a chart on a signed-out device */
{
  const h = harness({ authed: false });
  h.api.openConfirmSheet('rj_z', STAGE, NOTE);
  eq(h.sheet(), null, '56d: a signed-out device never opens a confirm sheet');
}

/* 56e: source - the listener, and the fields it drops, in every lane */
for (const [name, src] of CONNECT_LANES) {
  ok(/window\.addEventListener\('mls:session-boundary', function \(\) \{ try \{ phsendForgetSession\(\); \}/.test(src),
    `56e/${name}: the relay must bind phsendForgetSession to the account boundary`);
  const forget = /function phsendForgetSession\(\) \{([\s\S]*?)\n  \}/.exec(src);
  ok(forget, `56e/${name}: phsendForgetSession must be locatable`);
  for (const must of ['phsendStopPoll()', 'phcClose()', 'phsendWriteActive(null)', "phsendState.noteSent = ''"]) {
    ok(forget[1].indexOf(must) > -1, `56e/${name}: the boundary must drop ${must}`);
  }
  ok(/if \(!authed\(\)\) return;/.test(src), `56e/${name}: phcOpen must refuse on a signed-out device`);
}

/* ==========================================================================
 * ITEM 57 - SEND IS DISABLED WHILE RECORDING OR STILL WRITING.
 * ========================================================================*/
function barAt(phase, noteLen) {
  const h = harness({ snapshot: { active: { id: 'appt-1', name: 'Synthetic Test', dob: '1980-01-01' }, phase, noteLen, day: '2026-08-18' } });
  h.advance(3000);
  const bar = h.bar();
  return { h, bar, btn: bar ? bar.querySelector('.phsend-go') : null, line: bar ? bar.querySelector('.phsend-line') : null };
}
{
  /* recording, with a note already generated before the doctor tapped Resume:
     the exact case the defect describes */
  const rec = barAt('rec', 24);
  ok(rec.bar, '57: the send bar is still drawn while recording - it does not jump about');
  eq(rec.bar.style.display, 'block', '57: and it is visible');
  eq(rec.btn.disabled, true, '57: Send is DISABLED while the doctor is recording');
  ok(/Stop the recording/i.test(rec.line.textContent), '57: and the bar says why');
  eq(rec.h.api.phsendReady(), false, '57: phsendReady is false at phase rec');

  const gen = barAt('gen', 24);
  eq(gen.btn.disabled, true, '57: Send is DISABLED while the note is being written');
  ok(/still being written/i.test(gen.line.textContent), '57: and the bar says why');
  eq(gen.h.api.phsendReady(), false, '57: phsendReady is false at phase gen');

  const stopped = barAt('stopped', 24);
  eq(stopped.btn.disabled, true, '57: Send is DISABLED at any phase that is not a settled note');
  eq(stopped.h.api.phsendReady(), false, '57: phsendReady is false at phase stopped');

  const empty = barAt('note', 0);
  eq(empty.h.api.phsendReady(), false, '57: an empty note is not a settled note');

  const ready = barAt('note', 24);
  eq(ready.btn.disabled, false, '57: Send is enabled once the note is written');
  eq(ready.btn.textContent, 'Send to Athena', '57: and it offers the send');
  eq(ready.h.api.phsendReady(), true, '57: phsendReady is true only at phase note with a note');
}

/* 57b: the SECOND stop. A disabled attribute is a painting; the press itself
   must refuse, because phsendNoteText() reads #noteBox live at that moment. */
{
  const rec = barAt('rec', 24);
  rec.btn.click();
  const jobPosts = rec.h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init && r.init.method === 'POST');
  eq(jobPosts.length, 0, '57b: a press during recording must relay nothing');
  ok(/Stop the recording/i.test(rec.h.api.sendState().line), '57b: and it says why rather than failing silently');
}
{
  const gen = barAt('gen', 24);
  gen.btn.click();
  eq(gen.h.posted.filter((r) => /\/api\/relay\/jobs$/.test(r.url) && r.init && r.init.method === 'POST').length, 0,
    '57b: a press while the note is being written must relay nothing');
}

/* 57c: the disable must never reach the CANCEL affordance. A send in flight
   while the doctor resumes recording still has to be stoppable. */
{
  const count = { poll: 0, cancel: 0 };
  const h = await stagedAndOpen(count);
  h.live.snapshot = { active: { id: 'appt-1', name: 'Synthetic Test', dob: '1980-01-01' }, phase: 'rec', noteLen: 24, day: '2026-08-18' };
  h.advance(1500); await flush();
  const btn = h.bar().querySelector('.phsend-go');
  eq(btn.textContent, 'Stop waiting', '57c: a send in flight still offers the cancel');
  eq(btn.disabled, false, '57c: the cancel is never disabled by the readiness gate');
}

/* 57d: source - the unconditional re-enable is gone, in every lane */
for (const [name, src] of CONNECT_LANES) {
  ok(/function phsendReady\(\)/.test(src), `57d/${name}: a named readiness predicate must exist`);
  ok(/String\(sn\.phase \|\| ''\) === 'note' && Number\(sn\.noteLen \|\| 0\) > 0/.test(src),
    `57d/${name}: readiness must require a settled note AND a non-empty one`);
  ok(/btnEl\.disabled = !busy && !ready;/.test(src),
    `57d/${name}: the button must be disabled whenever it is neither busy nor ready`);
  ok(!/btnEl\.disabled = false;/.test(src),
    `57d/${name}: the unconditional re-enable must not come back`);
  ok(/if \(!phsendReady\(\)\) \{ phsendSet\('idle', phsendWhyNotReady\(\)\); return; \}/.test(src),
    `57d/${name}: the click handler must refuse on its own as well`);
}

/* ==========================================================================
 * ITEM 58 - THE NOTICE SHELF CLEARS THE PHONE'S ONE NAV CONTROL.
 * The anchor function is lifted out of the shell and MEASURED, rather than
 * grepped: the property is the number it returns, not the shape of the branch.
 * ========================================================================*/
function anchorFn(shellSrc, label) {
  const s = shellSrc.indexOf('function mlsNoticeAnchor(){');
  const e = shellSrc.indexOf('function mlsSyncNoticeAnchor(){', s);
  ok(s > 0 && e > s, `58/${label}: mlsNoticeAnchor must be locatable`);
  const box = { result: null };
  const sandbox = {
    document: null, window: null, getComputedStyle: null, Math, console,
    out: (v) => { box.result = v; }
  };
  vm.createContext(sandbox);
  vm.runInContext(shellSrc.slice(s, e) + '\nglobalThis.__anchor = mlsNoticeAnchor;', sandbox, { filename: label + '#anchor' });
  return (dom) => {
    sandbox.document = dom.document;
    sandbox.window = dom.window;
    sandbox.getComputedStyle = dom.getComputedStyle;
    return sandbox.__anchor();
  };
}
function fakeDom(o) {
  const rects = o.rects || {};
  const bodyClasses = o.bodyClasses || [];
  return {
    window: { innerHeight: o.vh || 812, innerWidth: o.vw || 375 },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', position: 'static' }),
    document: {
      body: { classList: { contains: (c) => bodyClasses.indexOf(c) > -1 } },
      querySelector: () => (o.modal ? {} : null),
      getElementById: (id) => (Object.prototype.hasOwnProperty.call(rects, id)
        ? { getBoundingClientRect: () => rects[id] } : null)
    }
  };
}
for (const [label, src] of SHELL_LANES) {
  const anchor = anchorFn(src, label);

  /* THE DEFECT, reproduced: the phone hides all three desktop bars. */
  const phone = anchor(fakeDom({
    bodyClasses: ['mls-redesign', 'mls-ph3'],
    rects: { mlsPh3Hdr: { height: 110, bottom: 110, top: 0, left: 0, right: 375, width: 375 } }
  }));
  ok(phone.top >= 110, `58/${label}: on the phone the notice must clear #mlsPh3Hdr (got ${phone.top})`);
  eq(phone.top, 120, `58/${label}: it sits 10px under the measured phone header, as on the desktop`);
  eq(phone.left, null, `58/${label}: the phone has no fixed rail, so the notice stays centred`);

  /* a header that has not painted yet still must not collapse to the floor */
  const early = anchor(fakeDom({ bodyClasses: ['mls-ph3'], rects: {} }));
  ok(early.top >= 70, `58/${label}: with no measurable phone header the anchor still clears it (got ${early.top})`);

  /* a taller notched header is measured, not assumed */
  const notched = anchor(fakeDom({
    bodyClasses: ['mls-ph3'],
    rects: { mlsPh3Hdr: { height: 157, bottom: 157, top: 0, left: 0, right: 390, width: 390 } }
  }));
  eq(notched.top, 167, `58/${label}: a notched phone header is measured, not assumed`);

  /* THE DESKTOP IS UNCHANGED - this fix must cost the surface it did not break */
  const desktop = anchor(fakeDom({
    bodyClasses: ['mls-redesign'], vh: 850,
    rects: { appHeader: { height: 82, bottom: 82, top: 0, left: 0, right: 1280, width: 1280 },
      mlsCtxBar: { height: 123, bottom: 205, top: 82, left: 0, right: 1180, width: 1180 } }
  }));
  eq(desktop.top, 215, `58/${label}: the desktop anchor is exactly what it was (b685 measurement)`);

  /* a modal still collapses the anchor on the phone, as it does on the desktop */
  const modal = anchor(fakeDom({
    bodyClasses: ['mls-ph3'], modal: true,
    rects: { mlsPh3Hdr: { height: 110, bottom: 110, top: 0, left: 0, right: 375, width: 375 } }
  }));
  eq(modal.top, 12, `58/${label}: a full-screen modal covers the header, so the anchor still collapses`);

  /* and the CSS floor is stated, after the rule it has to beat */
  const shelfRule = src.indexOf('body.mls-ph3 #mlsMobileNoticeShelf.mls-mobile-notice-active');
  const baseRule = src.indexOf('body.mls-redesign #mlsMobileNoticeShelf.mls-mobile-notice-active{\n    position:fixed !important;');
  ok(shelfRule > 0, `58/${label}: a ph3 floor must be stated for the notice shelf`);
  ok(baseRule > 0 && shelfRule > baseRule,
    `58/${label}: the ph3 floor must come after the rule it overrides, since specificity is equal`);
  ok(/body\.mls-ph3 #toast\{[\s\S]{0,200}?env\(safe-area-inset-top\)/.test(src),
    `58/${label}: the toast reads the same variable and must carry the same floor`);
}

/* 58b: the premise. If a future lane stops hiding the desktop bars on a phone,
   or renames the phone header, this fix is aimed at nothing. */
ok(/body\.mls-ph3 #appHeader/.test(phoneUi), '58b: the phone still hides #appHeader (the reason the anchor collapsed)');
ok(/body\.mls-ph3 #patientBar/.test(phoneUi), '58b: the phone still hides #patientBar');
ok(/id="mlsPh3Hdr"/.test(phoneUi), '58b: the phone header id the anchor now measures must still exist');
ok(/id="mlsPh3Nav"/.test(phoneUi), '58b: the one navigational control this protects must still exist');
ok(!fs.existsSync(path.join(ROOT, '1p-feat_mls_phone_ui.js')) && !fs.existsSync(path.join(ROOT, 'cloned-feat_mls_phone_ui.js')),
  '58b: feat_mls_phone_ui.js is still unforked, so these overlays face one copy');

/* ==========================================================================
 * ITEM 59 - ONE HOME INDICATOR, ONE GAP.
 * ========================================================================*/
{
  /* the premise, measured in the shipped stylesheet: both bars reserve it */
  ok(/#mlsPh3Act\{[\s\S]{0,240}?calc\(env\(safe-area-inset-bottom\) \+ 10px\)/.test(phoneUi.replace(/',\s*\n\s*'/g, '')) ||
     phoneUi.indexOf('calc(env(safe-area-inset-bottom) + 10px)') > -1,
    '59: the action bar still reserves the home-indicator gap when it is alone');
  for (const [name, src] of CONNECT_LANES) {
    ok(src.indexOf("padding:9px 12px calc(9px + env(safe-area-inset-bottom))") > -1,
      `59/${name}: the send bar still reserves the gap - it is the bottom element when shown`);
    ok(src.indexOf('#mlsPh3.ph3-sendbar-on #mlsPh3Act{padding-bottom:10px!important}') > -1,
      `59/${name}: the action bar must give the gap up while the send bar is below it`);
    ok(/if \(show\) fr\.classList\.add\('ph3-sendbar-on'\); else fr\.classList\.remove\('ph3-sendbar-on'\);/.test(src),
      `59/${name}: the class must be driven by the same 'show' that displays the bar`);
    /* comments stripped: the block's own prose has to be able to EXPLAIN why
       :has() was rejected without that explanation failing the check. */
    const cleanAt = src.indexOf('function phcleanStyle() {');
    const cleanBody = src.slice(cleanAt, src.indexOf('api.phcleanStyle = phcleanStyle;', cleanAt))
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    ok(cleanAt > 0 && cleanBody.indexOf(':has(') < 0,
      `59/${name}: the emitted rule must not depend on :has() support on the device in the doctor's hand`);
  }
}
{
  /* runtime: the class tracks the bar, both ways */
  const on = barAt('note', 24);
  ok(on.h.els.get('mlsPh3').classList.contains('ph3-sendbar-on'),
    '59: with the send bar shown the frame is marked, so the action bar drops its inset');
  eq(on.bar.style.display, 'block', '59: (the send bar really is the bottom element in that state)');

  /* leave the visit screen: the bar hides and the inset must come straight back */
  on.h.ctx.window.__mlsPhoneUI.state = () => ({ screen: 'day', tab: 'day', mounted: true, menu: false });
  on.h.advance(1500);
  eq(on.bar.style.display, 'none', '59: off the visit screen the send bar is hidden');
  eq(on.h.els.get('mlsPh3').classList.contains('ph3-sendbar-on'), false,
    '59: so the action bar is the bottom element again and takes its inset back');
}

/* ==========================================================================
 * PHTEAM-1.0.0 - SHARED TEAM NOTES ON THE PHONE.
 * Owner: "the note thing - if someone leaves notes it should show up here on
 * the phone app too." The property is not "a card appears": it is that the
 * card is the SAME thread the desktop writes, in the place he pointed at,
 * through one store, without touching Athena.
 * ========================================================================*/
const PT = {
  id: 'pt-1', name: 'Synthetic Test', dob: '1980-01-01', mrn: '55501',
  teamNotes: [
    { v: 1, id: 'tn_a', at: 1756000000000, author: 'Dr Alvarez', text: 'Left knee still swollen. Recheck in two weeks.' },
    { v: 1, id: 'tn_b', at: 1756100000000, author: 'MLS AI', ai: true, text: 'Summary of the 8/24 visit.' },
    { v: 1, id: 'tn_c', at: 1755000000000, author: 'Dr Okafor', text: 'Spoke to the family; they are on board.' },
    { v: 1, id: 'tn_d', at: 1754000000000, author: 'Dr Okafor', text: 'deleted note', del: true, delAt: 1754000001000 }
  ]
};
function clonePt(extra) { return JSON.parse(JSON.stringify(Object.assign({}, PT, extra || {}))); }
function teamHarness(o) {
  o = o || {};
  const h = harness(Object.assign({
    teamNotes: o.teamNotes !== false,
    patients: [clonePt(o.pt)],
    activePtId: o.activePtId === undefined ? 'pt-1' : o.activePtId,
    snapshot: { active: { id: 'appt-1', name: o.visitName || 'Synthetic Test', dob: o.visitDob || '1980-01-01' }, phase: 'note', noteLen: 24, day: '2026-08-18' }
  }, o.harness || {}));
  h.repaintBody();
  h.advance(3000);
  return h;
}
function cardText(h) {
  const c = h.card();
  if (!c) return '';
  const walk = (n) => {
    let out = String(n.textContent || '');
    for (const k of n.children) out += ' ' + walk(k);
    return out;
  };
  return walk(c);
}
function noteRows(h) {
  const list = h.ctx.document.getElementById('mlsPhTeamList');
  return list ? list.children.filter((c) => c.className === 'pht-n') : [];
}

/* TN1: THE MODULE IS ABSENT -> NOTHING. Not an empty card, not a placeholder. */
{
  const h = teamHarness({ teamNotes: false });
  eq(h.card(), null, 'TN1: with no team-notes module the phone renders no card at all');
  eq(h.ctx.document.getElementById('mlsPhTeamSect'), null, 'TN1: and no section heading either');
  eq(h.body().children.length, 5, 'TN1: the visit screen is exactly as the phone drew it');
}

/* TN2: PLACEMENT. Directly under QUICK HISTORY, above "What was said". */
{
  const h = teamHarness({});
  const kids = h.body().children;
  const qhHead = kids.findIndex((c) => String(c.textContent).trim() === 'Quick history');
  const sect = kids.findIndex((c) => c.id === 'mlsPhTeamSect');
  const card = kids.findIndex((c) => c.id === 'mlsPhTeam');
  const said = kids.findIndex((c) => String(c.textContent).trim() === 'What was said');
  ok(qhHead > -1 && sect > -1 && card > -1 && said > -1, 'TN2: every landmark must be on the screen');
  eq(sect, qhHead + 2, 'TN2: the Team notes heading sits immediately after the quick-history CARD');
  eq(card, sect + 1, 'TN2: and the card sits immediately after its own heading');
  ok(card < said, 'TN2: the notes come before the transcript, not at the bottom of the screen');
  eq(kids[sect].className, 'ph3-sect', 'TN2: the heading uses the phone\'s own section style');
  eq(kids[card].className, 'ph3-card', 'TN2: the card uses the same card style as QUICK HISTORY');
}

/* TN3: THE THREAD ITSELF - every live note, newest first, author + time, and
   the AI summary marked as one. A tombstoned note is not a note. */
{
  const h = teamHarness({});
  const rows = noteRows(h);
  eq(rows.length, 3, 'TN3: every LIVE shared note is shown (the tombstone is not)');
  const who = rows.map((r) => String(r.children[0].textContent));
  ok(/MLS AI/.test(who[0]), 'TN3: newest first - the 8/24 summary leads');
  ok(/Dr Alvarez/.test(who[1]), 'TN3: then the next newest');
  ok(/Dr Okafor/.test(who[2]), 'TN3: then the oldest');
  for (const w of who) ok(/\d/.test(w), 'TN3: each note carries a time, not just an author');
  const body0 = String(rows[0].children[1].textContent);
  eq(body0, 'Summary of the 8/24 visit.', 'TN3: the note text is shown verbatim');
  ok(rows[0].children.some((c) => c.className === 'pht-ai') ||
     String(rows[0].children[0].innerHTML || '').indexOf('pht-ai') > -1 ||
     rows[0].children[0].children.some((c) => c.className === 'pht-ai'),
    'TN3: the AI summary is labelled as AI-generated');
  ok(/review before relying on it/i.test(cardText(h)), 'TN3: and carries the review warning');
  ok(/deleted note/.test(cardText(h)) === false, 'TN3: a deleted note stays deleted on the phone too');
  eq(String(h.ctx.document.getElementById('mlsPhTeamCount').textContent), 'Team notes (3)',
    'TN3: the header counts the live thread');
}

/* TN4: THE ADD ROUND-TRIPS THROUGH THE SHARED STORE. Driven against the REAL
   tn-1.0.0 module and the REAL upsertPatient - no second store, no endpoint. */
{
  const h = teamHarness({});
  const before = h.store.upserts.length;
  const ta = h.ctx.document.getElementById('mlsPhTeamTa');
  const go = h.ctx.document.getElementById('mlsPhTeamGo');
  ok(ta && go, 'TN4: the composer and its button are on the card');
  ta.value = 'Called the pharmacy, they have the prior auth.';
  ta.fire('input', {});
  go.click();

  eq(h.store.upserts.length, before + 1, 'TN4: exactly one write, and it went through upsertPatient');
  const wrote = h.store.upserts[h.store.upserts.length - 1];
  eq(String(wrote.id), 'pt-1', 'TN4: it wrote the patient the phone had open');
  const stored = wrote.teamNotes.filter((n) => n && !n.del && n.text === 'Called the pharmacy, they have the prior auth.');
  eq(stored.length, 1, 'TN4: the note is in p.teamNotes - the same field the desktop reads');
  eq(stored[0].ai, false, 'TN4: a note a human typed is never stored as AI');
  ok(String(stored[0].id).indexOf('tn_') === 0, 'TN4: it carries the shared module\'s own id shape');
  /* nothing on the phone side invented a second home for it */
  ok(!wrote.phoneNotes && !wrote.teamNotesPhone, 'TN4: no second notes field was minted');

  /* and the doctor sees it AT ONCE, without waiting for a round trip */
  const rows = noteRows(h);
  eq(rows.length, 4, 'TN4: the new note is on screen immediately');
  eq(String(rows[0].children[1].textContent), 'Called the pharmacy, they have the prior auth.',
    'TN4: at the top, because it is the newest');
  eq(ta.value, '', 'TN4: the composer is cleared');
  ok(/Added\./.test(String(h.ctx.document.getElementById('mlsPhTeamSay').textContent)),
    'TN4: and it says so');
  eq(h.api.phteamState().draft, '', 'TN4: the mirrored draft is cleared with it');
}

/* TN4b: an empty note is refused out loud and writes nothing. */
{
  const h = teamHarness({});
  const before = h.store.upserts.length;
  h.ctx.document.getElementById('mlsPhTeamTa').value = '   ';
  h.ctx.document.getElementById('mlsPhTeamGo').click();
  eq(h.store.upserts.length, before, 'TN4b: an empty note writes nothing');
  ok(/Type the note first/i.test(String(h.ctx.document.getElementById('mlsPhTeamSay').textContent)),
    'TN4b: and says why rather than failing silently');
}

/* TN4c: a store that refuses says NOT SAVED - it never claims a note landed. */
{
  const h = teamHarness({});
  h.ctx.window.upsertPatient = () => { throw new Error('offline'); };
  h.ctx.document.getElementById('mlsPhTeamTa').value = 'This must not be claimed as saved.';
  h.ctx.document.getElementById('mlsPhTeamGo').click();
  const say = String(h.ctx.document.getElementById('mlsPhTeamSay').textContent);
  ok(/NOT saved|not saved/i.test(say), 'TN4c: a failed write says the note was NOT saved');
  ok(!/Added\./.test(say), 'TN4c: and never says it was added');
  eq(noteRows(h).length, 3, 'TN4c: nothing was added to the thread on screen either');
}

/* TN5: IDENTITY. The active chart must be provably the patient on screen. */
{
  const h = teamHarness({ visitDob: '1979-05-05' });   /* same name, different DOB */
  ok(h.card(), 'TN5: a card is still shown - silence would be worse');
  eq(noteRows(h).length, 0, 'TN5: but no other patient\'s notes are on it');
  ok(/cannot confirm the chart/i.test(cardText(h)), 'TN5: it says what it could not confirm');
  eq(h.ctx.document.getElementById('mlsPhTeamTa'), null, 'TN5: and offers no composer for a chart it cannot name');
}
{
  const h = teamHarness({ activePtId: '' });
  ok(h.card(), 'TN5: with no chart open the card still explains itself');
  ok(/No chart is open/i.test(cardText(h)), 'TN5: by name');
  eq(noteRows(h).length, 0, 'TN5: and shows nobody\'s notes');
}

/* TN6: THE PHONE'S REPAINT EATS THE CARD, AND THE DRAFT SURVIVES IT.
   caretIsOurs() protects only #mlsPh3Tx and #mlsPh3Find, so a background
   repaint arriving mid-word destroys this textarea. Losing a half-typed note
   that way is the ph2 transcript defect in a new hat. */
{
  const h = teamHarness({});
  h.ctx.document.getElementById('mlsPhTeamTa').value = 'Half a thought about the';
  h.ctx.document.getElementById('mlsPhTeamTa').fire('input', {});
  eq(h.api.phteamState().draft, 'Half a thought about the', 'TN6: the draft is mirrored on every keystroke');

  h.repaintBody();                                  /* the phone rebuilds the body */
  eq(h.card(), null, 'TN6: the repaint really does destroy the card');
  h.advance(1500);
  ok(h.card(), 'TN6: the next tick puts it back');
  eq(String(h.ctx.document.getElementById('mlsPhTeamTa').value), 'Half a thought about the',
    'TN6: with the half-typed note still in it');
  eq(noteRows(h).length, 3, 'TN6: and the thread is intact');
}

/* TN6b: an idle tick must NOT replace the composer under a typing thumb. */
{
  const h = teamHarness({});
  const ta = h.ctx.document.getElementById('mlsPhTeamTa');
  ta.value = 'still typing';
  ta.fire('input', {});
  h.advance(6000);
  eq(h.ctx.document.getElementById('mlsPhTeamTa'), ta,
    'TN6b: with nothing changed, the tick leaves the very same textarea node alone');
  eq(String(ta.value), 'still typing', 'TN6b: and what is in it');
}

/* TN6c: a note arriving from somebody else repaints the LIST without touching
   the composer - the sync case the owner asked for. */
{
  const h = teamHarness({});
  const ta = h.ctx.document.getElementById('mlsPhTeamTa');
  ta.value = 'mid-sentence';
  ta.fire('input', {});
  h.store.patients[0].teamNotes = h.store.patients[0].teamNotes.concat([
    { v: 1, id: 'tn_new', at: 1756900000000, author: 'Dr Alvarez', text: 'Just added from the office computer.' }
  ]);
  h.advance(1500);
  eq(noteRows(h).length, 4, 'TN6c: a colleague\'s note appears without a reload');
  eq(String(noteRows(h)[0].children[1].textContent), 'Just added from the office computer.',
    'TN6c: at the top, because it is the newest');
  eq(h.ctx.document.getElementById('mlsPhTeamTa'), ta, 'TN6c: the composer node is NOT replaced');
  eq(String(ta.value), 'mid-sentence', 'TN6c: and the half-typed note is untouched');
}

/* TN7: THE "N NEW" MARKER, counted against what this device last opened. */
{
  const h = harness({
    teamNotes: true, patients: [clonePt()], activePtId: 'pt-1',
    snapshot: { active: { id: 'appt-1', name: 'Synthetic Test', dob: '1980-01-01' }, phase: 'note', noteLen: 24, day: '2026-08-18' }
  });
  /* this device read the thread just before the two newest notes landed */
  h.ctx.sessionStorage.setItem('mlsPhTeamSeen', JSON.stringify({ 'pt-1': 1755500000000 }));
  h.repaintBody();
  h.advance(3000);
  const badge = h.ctx.document.getElementById('mlsPhTeamNew');
  eq(String(badge.textContent), '2 new', 'TN7: two notes arrived since this device last opened this patient');
  eq(badge.style.display, 'inline-block', 'TN7: and the marker is visible');
  eq(h.api.phteamState().newCount, 2, 'TN7: the count is reported, not guessed');

  /* it does not clear itself out from under the doctor while he is reading */
  h.advance(6000);
  eq(String(h.ctx.document.getElementById('mlsPhTeamNew').textContent), '2 new',
    'TN7: the marker survives the ticks it takes to read it');
}
{
  /* nothing new -> no marker at all */
  const h = harness({
    teamNotes: true, patients: [clonePt()], activePtId: 'pt-1',
    snapshot: { active: { id: 'appt-1', name: 'Synthetic Test', dob: '1980-01-01' }, phase: 'note', noteLen: 24, day: '2026-08-18' }
  });
  h.ctx.sessionStorage.setItem('mlsPhTeamSeen', JSON.stringify({ 'pt-1': 1756900000000 }));
  h.repaintBody();
  h.advance(3000);
  eq(String(h.ctx.document.getElementById('mlsPhTeamNew').textContent), '',
    'TN7: nothing new since the last opening means no marker');
  eq(h.ctx.document.getElementById('mlsPhTeamNew').style.display, 'none', 'TN7: and it is not drawn');
  /* the stamp moved forward, so the next opening measures from THIS one */
  const seen = JSON.parse(h.ctx.sessionStorage.getItem('mlsPhTeamSeen'));
  ok(Number(seen['pt-1']) > 1756900000000, 'TN7: opening the patient moves the seen stamp forward');
}

/* TN8: THE ACCOUNT BOUNDARY. A shared clinical thread and a patient-keyed seen
   map are both PHI-adjacent; neither may outlive the account that read them. */
{
  const h = teamHarness({});
  ok(h.card(), 'TN8: the card must be up first');
  ok(h.ctx.sessionStorage.getItem('mlsPhTeamSeen'), 'TN8: and the seen map really is on the device');
  h.fire('mls:session-boundary', { reason: 'logout' });
  eq(h.card(), null, 'TN8: the card is gone at the boundary');
  eq(h.ctx.document.getElementById('mlsPhTeamSect'), null, 'TN8: heading and all');
  eq(h.ctx.sessionStorage.getItem('mlsPhTeamSeen'), null, 'TN8: the patient-keyed seen map is dropped');
  eq(h.api.phteamState().draft, '', 'TN8: and any half-typed note with it');
}

/* TN9: NOTHING HERE GOES TO ATHENA, and nothing here can block a recording. */
{
  const h = teamHarness({});
  /* Measured across the CLICK, not across a stretch of time: the relay module
     this block lives in runs the office agent's own background poll, and
     counting that would be counting somebody else's traffic. The write is
     synchronous - it goes to the store, not to a socket - so the click is the
     whole window. */
  const before = h.posted.length;
  h.ctx.document.getElementById('mlsPhTeamTa').value = 'A note for the team.';
  h.ctx.document.getElementById('mlsPhTeamGo').click();
  await flush();
  eq(h.posted.length, before, 'TN9: adding a team note makes no request of any kind - the store owns the write');
  eq(h.store.upserts.length > 0, true, 'TN9: (it really did write - the count above is not zero-because-nothing-happened)');
  h.advance(6000);
  eq(h.posted.filter((r) => /\/api\/relay\/jobs\/.*\/(confirm|cancel)$/.test(r.url)).length, 0,
    'TN9: and nothing it did reaches the Athena relay');
  /* the send bar and its gate are untouched by any of this */
  eq(h.bar().querySelector('.phsend-go').disabled, false,
    'TN9: the Athena send control is exactly as the phase machine left it');
}
{
  const src = connect1p;
  const s = src.indexOf('/* ===== phteam-1.0.0 (b1169)');
  const e = src.indexOf('/* ===== end phteam-1.0.0 =', s);
  ok(s > 0 && e > s, 'TN9: the phteam block must be delimited');
  const block = src.slice(s, e);
  const code = block.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  for (const banned of ['write_note', 'save_draft', 'sign_encounter', 'place_order', 'stage_billing',
    'sendNoteToAthena', 'runSendNote', 'startAthenaAction', 'previewHash']) {
    ok(code.indexOf(banned) < 0, `TN9: the phteam block's CODE must never touch ${banned}`);
  }
  ok(code.indexOf('fetch(') < 0, 'TN9: the phteam block opens no network path of its own');
  for (const bypass of ['dispatchEvent', 'isTrusted', 'execCommand', 'MouseEvent', '.click(']) {
    ok(code.indexOf(bypass) < 0, `TN9: the phteam block must not touch ${bypass}`);
  }
  ok(code.indexOf('innerHTML') < 0,
    'TN9: a team note is clinical prose typed by a human and must be written with textContent');
  ok(/disabled/.test(code) === false, 'TN9: this card disables no control anywhere');
}

/* TN10: THE SEAM. The card is anchored to a heading another file renders, and
   mounts into a node another file builds. Both spellings live in two files
   with no shared constant, which is exactly how they drift apart in silence. */
{
  ok(phoneUi.indexOf("'<p class=\"ph3-sect\">Quick history</p>") > -1 ||
     /ph3-sect">Quick history</.test(phoneUi),
    'TN10: feat_mls_phone_ui.js no longer renders the "Quick history" heading the phone card anchors to');
  ok(phoneUi.indexOf("id=\"mlsPh3Body\"") > -1 || phoneUi.indexOf("'mlsPh3Body'") > -1,
    'TN10: feat_mls_phone_ui.js no longer builds #mlsPh3Body');
  ok(!/mlsPhTeam|phteam/.test(phoneUi),
    'TN10: the phone module must stay out of this - it has no 1p fork and this lane may not edit it');
  for (const [name, src] of CONNECT_LANES) {
    ok(src.indexOf("t !== 'quick history'") > -1, `TN10/${name}: the anchor must still match the heading by name`);
    ok(src.indexOf("getElementById('mlsPh3Body')") > -1, `TN10/${name}: the card must still mount into the phone's scroller`);
    ok(/if \(!phtApi\(\)\) \{ phtRemove\(\); return; \}/.test(src),
      `TN10/${name}: with no team-notes module the card must render nothing`);
    ok(/try \{ phtMount\(\); \} catch/.test(src), `TN10/${name}: the card must ride the existing phone timer`);
    ok(!/setInterval\(function \(\) \{ try \{ phtMount/.test(src),
      `TN10/${name}: it must not arm a second interval - the boot budget counts them`);
  }
}

/* TN11: THE SHARED MODULE. addFor is the one add-and-persist entry point, it
   is additive, and the desktop's own path is untouched. */
{
  const tn = read('feat_mls_team_notes.js');
  ok(/function addFor\(ptId, opts\)/.test(tn), 'TN11: feat_mls_team_notes.js must expose an add-and-persist entry point');
  ok(/addFor: addFor/.test(tn), 'TN11: and export it');
  const fn = /function addFor\(ptId, opts\) \{([\s\S]*?)\n  \}/.exec(tn);
  ok(fn, 'TN11: addFor must be locatable');
  ok(/persist\(ptId, res\.list\)/.test(fn[1]), 'TN11: it must go through the module\'s own persist (upsertPatient)');
  ok(/addNote\(listOf\(p\)/.test(fn[1]), 'TN11: and through the module\'s own addNote, so the union law applies');
  ok(fn[1].indexOf('savePatients') < 0, 'TN11: never savePatients - that write never leaves the device');
  ok(fn[1].indexOf('toast(') < 0, 'TN11: it must not toast - the caller owns its own surface');
  ok(/if \(opts\.repaint === true\)/.test(fn[1]), 'TN11: and must not repaint a desktop card unless asked');
  /* the desktop path is exactly what it was */
  ok(/function doAdd\(p\)/.test(tn) && /function commit\(ptId, res, okMsg\)/.test(tn),
    'TN11: the desktop add path must still be there, unchanged in shape');
  ok(!fs.existsSync(path.join(ROOT, '1p-feat_mls_team_notes.js')) &&
     !fs.existsSync(path.join(ROOT, 'cloned-feat_mls_team_notes.js')),
    'TN11: feat_mls_team_notes.js is unforked; a fork would give the three lanes two modules');
  /* and it is still loaded the deferred way, so the boot budget is untouched */
  for (const [name, src] of CONNECT_LANES) {
    const at = src.indexOf('feat_mls_team_notes.js');
    ok(at > 0, `TN11/${name}: the loader must still name the module`);
    ok(/requestIdleCallback|__mlsDeferAsset\(/.test(src.slice(Math.max(0, at - 400), at)),
      `TN11/${name}: the FIRST mention of the module must still be its deferred loader, or the boot budget counts it eager`);
  }
}

/* ==========================================================================
 * LANE PARITY. Every fix above is authored in 1p-mls-connect.js and DERIVED.
 * A hand-edit of a derived lane, or a derive that was never run, reds here.
 * ========================================================================*/
{
  const cut = (src, label) => {
    const s = src.indexOf('/* ===== phsend-1.0.0 (2026-08-18, phone lane) =');
    const e = src.indexOf('/* ===== end phsend-1.0.0 =', s);
    ok(s > 0 && e > s, `parity/${label}: the phsend block must be locatable`);
    return src.slice(s, e);
  };
  const base = cut(connect1p, '1p');
  eq(cut(connectProd, 'production'), base, 'parity: production phsend must match its 1p source byte for byte');
  eq(cut(connectCloned, 'cloned'), base, 'parity: cloned phsend must match its 1p source byte for byte');
  const marks = (base.match(/phfix-1\.0\.0 \(b1169\)/g) || []).length;
  ok(marks >= 6, `parity: the phfix work must be marked in the block (found ${marks})`);
  /* the shells carry the same anchor and the same floor */
  for (const [label, src] of SHELL_LANES) {
    ok(src.indexOf('phfix-1.0.0 (b1169)') > -1, `parity/${label}: the shell must carry the marked phfix work`);
  }
}

/* ==========================================================================
 * THE HARD LAWS, restated against the changed block. None of these fixes may
 * have widened what the phone can execute.
 * ========================================================================*/
{
  const s = connect1p.indexOf('/* ===== phsend-1.0.0 (2026-08-18, phone lane) =');
  const e = connect1p.indexOf('/* ===== end phsend-1.0.0 =', s);
  const block = connect1p.slice(s, e);
  const code = block.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  for (const banned of ['sign_encounter', 'place_order', 'stage_billing', 'submit_claim']) {
    ok(block.indexOf(banned) < 0, `law: the phsend block must never name ${banned}`);
  }
  for (const bypass of ['dispatchEvent', 'isTrusted', 'execCommand', 'new Event', 'MouseEvent']) {
    ok(code.indexOf(bypass) < 0, `law: the phsend block's CODE must not touch ${bypass}`);
  }
  eq((code.match(/\.click\(/g) || []).length, 1, 'law: still exactly one .click( call site in the phsend block');
  const actions = /var PHSEND_ACTIONS = \{([^}]*)\}/.exec(connect1p);
  ok(actions, 'law: PHSEND_ACTIONS must still be an explicit object literal');
  assert.deepStrictEqual(
    actions[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean).sort(),
    ['save_draft', 'write_note'], 'law: only write_note and save_draft may execute'); checks++;
}

console.log('PASS phone-fixes: ' + checks + ' checks - Cancel sticks (poll stopped AND the refused job remembered, with a failing cancel POST), '
  + 'the confirm sheet drops name/DOB/MRN/encounter/note plus its resume record and its poll at the account boundary and on a signed-out tick, '
  + 'Send is disabled and explained at phases rec/gen/stopped and refuses the press itself while the cancel stays live, '
  + 'the notice anchor measures #mlsPh3Hdr on a phone (desktop and modal behaviour unchanged) with a CSS floor behind it, '
  + 'one home-indicator gap instead of two, all in three connect lanes and four shells - and the two-action allowlist is untouched; '
  + 'plus phteam: the shared thread mounts directly under QUICK HISTORY, reads and writes through the one tn-1.0.0 store '
  + '(real module, real upsertPatient, no second field and no endpoint), an add round-trips and shows at once, a failed write says NOT saved, '
  + 'a chart it cannot prove is the patient on screen shows nobody notes, the phone repaint eats the card and the half-typed note survives it, '
  + 'a colleague note syncs in without touching the composer, the "N new" marker counts from this device last opening, '
  + 'and the card, the draft and the seen map all go at the account boundary - touching Athena nowhere.');
}

main().catch((e) => { console.error(e && e.stack || String(e)); process.exit(1); });
