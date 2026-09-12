'use strict';
/* =============================================================================
   SEND THE SURGEON'S LINK FROM INSIDE MLS, EXECUTED
   (lane opnote-send-1.0.0, 2026-09-11)

   Owner, 2026-09-11: the link was already minted and shown with a Copy button,
   and then he had to leave MLS, open his own mail, and paste it. This lane adds
   the press that does it for him.

   THE ONE THING THIS SUITE EXISTS FOR: ONE HAND-OFF MINTS ONE LINK. The link is
   the whole credential - anyone holding it can read that surgeon's op notes -
   so a hand-off that mints one to show and a second one to mail would leave a
   working key nobody ever sent, sitting in nobody's hands, live for 30 days.
   Every case below counts BOTH minting calls at the wire: the plain mint
   (POST .../link) and the mint-and-mail (POST .../link/send). The total is
   always exactly one, on the copy path and on the send path alike.

   Also pinned, because each was a way this could quietly go wrong:
     * the send is offered ONLY when that surgeon has an address on their card,
       and when there is none the owner is told, in one sentence, how to fix it;
     * a send that WORKED does not take the link away - it is still there with
       its Copy button, because a mail can silently not arrive;
     * a send that FAILED says so in one plain sentence and still leaves the
       link and Copy, so the owner can do it by hand;
     * a second press while the first is in flight does nothing at all;
     * the link never reaches a toast and never leaves through one;
     * every sentence these screens show is free of the words a surgeon should
       never have to read.

   No network, no patient data, no browser. Every fixture is synthetic.
   ============================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const EDITABLE = ['1pScribeFlow.html', '1p/index.html'];
/* All four pages. A control that survives the 1p edit but not the derivation is
   a control that does not ship, so like the other room suites this is EXPECTED
   to be red between a 1p shell edit and the derive step. */
const ALL_PAGES = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* brace-balanced function lift, so a comment or a nested block cannot truncate it */
function fn(src, decl) {
  const at = src.indexOf(decl);
  assert(at >= 0, 'missing declaration: ' + decl);
  let i = src.indexOf('{', at), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(at, j + 1); }
  }
  throw new Error('unterminated: ' + decl);
}
function between(src, a, b) {
  const i = src.indexOf(a);
  assert(i >= 0, 'missing anchor: ' + a);
  const j = src.indexOf(b, i);
  assert(j > i, 'missing end anchor: ' + b);
  return src.slice(i, j);
}

const SHELL = read('1pScribeFlow.html');
const BLOCK_START = '/* ===== opnote-svc-1.0.0 - PREPARE THIS OP NOTE FOR A CLIENT SURGEON';
const BLOCK_END = 'function opPrepSave(i){';

/* what a surgeon must never be made to read */
const JARGON = ['token', 'api', 'endpoint', 'json', 'payload', 'backend', 'sync', 'placeholder', 'error code'];
/* attributes carry placeholder="Email" and the link rides an input value, so the
   words are judged on what is actually READ, never on the markup around it */
function visible(html) {
  return String(html).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function noJargon(html, where) {
  const text = visible(html);
  for (const word of JARGON) {
    const re = new RegExp('\\b' + word.replace(/ /g, '\\s+') + '\\b', 'i');
    ok(!re.test(text), where + ' says ' + JSON.stringify(word) + ' to a doctor: ' + text.slice(0, 240));
  }
}

/* =======================================================================
 * 1. THE CONTROLS EXIST, ONCE PER SHELL, AND REACH THE WINDOW
 * An inline onclick= that is not exported resolves to nothing at all.
 * ===================================================================== */
for (const page of ALL_PAGES) {
  const src = read(page);
  for (const handler of ['opSurgeonMail', 'opSurgeonLinkOnly', 'opSurgeonSaveEmail']) {
    const clicks = (src.match(new RegExp('onclick="' + handler + '\\(\\)"', 'g')) || []).length;
    eq(clicks, 1, page + ': ' + handler + ' is wired to ' + clicks + ' controls, expected exactly 1');
    ok(src.indexOf('window.' + handler + '=' + handler) >= 0,
      page + ': ' + handler + ' is never put on the window, so its onclick can never resolve');
  }
}
{
  const a = between(read(EDITABLE[0]), BLOCK_START, BLOCK_END);
  const b = between(read(EDITABLE[1]), BLOCK_START, BLOCK_END);
  eq(a, b, 'the two 1p shells carry DIFFERENT handler code - they are byte-twins and every shell edit must land in both');
}
{
  /* the same trap the prepare suite sets: this lane must never grow a parser */
  const block = between(SHELL, BLOCK_START, BLOCK_END);
  for (const shape of ['[[', 'FILL:', 'not dictated', '{{']) {
    ok(block.indexOf(shape) === -1, 'the send lane mentions the placeholder shape ' + JSON.stringify(shape));
  }
}

/* -------------------------------------------------------------------------
   The runtime: a small DOM plus the shell's own esc(), the REAL parser and the
   REAL handler block, driven through a stubbed network.
   ------------------------------------------------------------------------- */
function runtime(options) {
  const opts = options || {};
  const calls = [];
  const linksMade = [];
  const lazy = new Map();
  const body = { children: [] };
  body.appendChild = function (n) { n.parentNode = body; body.children.push(n); return n; };
  body.removeChild = function (n) { const at = body.children.indexOf(n); if (at >= 0) body.children.splice(at, 1); n.parentNode = null; return n; };

  function makeNode(tag) {
    return { tag: tag, id: '', innerHTML: '', value: '', textContent: '', parentNode: null, attrs: {}, style: { cssText: '' }, selected: 0, setAttribute(k, v) { this.attrs[k] = String(v); }, select() { this.selected++; } };
  }
  const document = {
    body: body,
    createElement(tag) { return makeNode(tag); },
    getElementById(id) {
      for (const child of body.children) if (child.id === id) return child;
      if (!lazy.has(id)) lazy.set(id, makeNode('stub'));
      return lazy.get(id);
    }
  };
  const toasts = [];
  const copied = [];
  const ctx = {
    document,
    console, JSON, Object, String, Number, Boolean, Math, RegExp, Error, Promise, Array,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
    bkBase: () => 'https://synthetic-backend.invalid',
    bkToken: () => 'SYNTHETIC_CLINICIAN_CREDENTIAL',
    toast: (m, k) => toasts.push({ m, k }),
    navigator: { clipboard: { writeText: (v) => { copied.push(String(v)); return Promise.resolve(); } } },
    fetch(url, init) {
      calls.push({ url: String(url), init: init || {} });
      const key = String(url).replace('https://synthetic-backend.invalid', '') + ' ' + String((init || {}).method || 'GET');
      const reply = (opts.replies || {})[key];
      if (!reply) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: { code: 'NOT_STUBBED', message: key } }) });
      const good = reply.status >= 200 && reply.status < 300;
      /* A LINK THAT REALLY EXISTS, counted where it is really made. Asking the
         send route for one and being refused creates nothing; only an answer
         that carries a link back means a live credential now exists. */
      if (good && /\/link(\/send)?$/.test(String(url)) && reply.body && reply.body.link && reply.body.link.url) linksMade.push(String(reply.body.link.url));
      return Promise.resolve({ ok: good, status: reply.status, json: () => Promise.resolve(reply.body || {}) });
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fn(SHELL, 'function esc(s){'), ctx, { filename: '1pScribeFlow.html#esc' });
  vm.runInContext(fn(SHELL, 'function opNoteBlankTokens(text){') + '\nwindow.opNoteBlankTokens=opNoteBlankTokens;', ctx, { filename: '1pScribeFlow.html#blanks' });
  vm.runInContext(between(SHELL, BLOCK_START, BLOCK_END), ctx, { filename: '1pScribeFlow.html#opnote-svc' });
  ctx._opPrep = opts.rows || [];
  ctx.window._opPrep = ctx._opPrep;
  const mints = () => calls.filter((c) => /\/link$/.test(c.url) && c.init.method === 'POST');
  const sends = () => calls.filter((c) => /\/link\/send$/.test(c.url) && c.init.method === 'POST');
  return {
    ctx, calls, toasts, copied, body, mints, sends, linksMade,
    minted: () => linksMade.length,
    dialogHtml: () => body.children.map((c) => c.innerHTML).join('\n')
  };
}

/* A synthetic draft with two fields the write-up could not fill. */
const DRAFT = [
  'PROCEDURE: Left shoulder arthroscopy with subacromial decompression.',
  'ESTIMATED BLOOD LOSS: [ESTIMATED BLOOD LOSS]',
  'IMPLANT: [FILL: implant lot]'
].join('\n');

const LINK_URL = 'https://mlsscribe.com/opnotes.html#k=' + 'c'.repeat(64);
const MAIL_URL = 'https://mlsscribe.com/opnotes.html#k=' + 'd'.repeat(64);
const TO = 'surgeon@synthetic.invalid';

const WITH_EMAIL = { id: 'oc_hasmail', label: 'Rivera', name: 'Dr Sam Rivera', practice: 'Northside Orthopaedics', email: TO, openJobs: 0, completedJobs: 0, activeLink: null };
const NO_EMAIL = { id: 'oc_nomail', label: 'Okafor', name: 'Dr Ada Okafor', practice: 'Lakeside Surgical', email: '', openJobs: 0, completedJobs: 0, activeLink: null };

function replies(client, extra) {
  return Object.assign({
    '/api/opnote-clients GET': { status: 200, body: { clients: [client] } },
    '/api/opnote-jobs POST': { status: 200, body: { job: { id: 'oj_synthetic', status: 'draft', blankCount: 2, createdAt: 1 } } },
    ['/api/opnote-clients/' + client.id + '/link POST']: { status: 200, body: { link: { id: 11, url: LINK_URL, prefix: 'cccccccc', expiresAt: 2 } } }
  }, extra || {});
}

/* Walk the pick dialog exactly as the owner does: open, choose, press Send. */
async function handOff(r, clientId) {
  await r.ctx.opPrepForSurgeon(0);
  r.ctx.document.getElementById('opSurgeonPick').value = clientId;
  await r.ctx.opSurgeonSend();
}

(async function suite() {
  /* ---- 1. AN ADDRESS ON THE CARD: the send is offered, and nothing minted -- */
  {
    const r = runtime({ rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy', tplId: 'tpl_shoulder' }], replies: replies(WITH_EMAIL) });
    await handOff(r, WITH_EMAIL.id);

    const screen = r.dialogHtml();
    ok(/Email it to them/.test(screen), 'a surgeon with an address on their card was not offered a send at all');
    ok(screen.indexOf(TO) >= 0, 'the screen does not say where it is about to go: ' + visible(screen).slice(0, 200));
    ok(/It will go to/.test(screen), 'the address is shown without saying what it is for');
    ok(/Just show me the link/.test(screen), 'the owner was left with no way to get the link himself');
    eq(r.minted(), 0,
      'a link was minted BEFORE the owner chose how to hand it over. The send press mints one of its own, so minting here is ' +
      'exactly how one hand-off ends up leaving two live links behind.');
    ok(screen.indexOf('#k=') === -1, 'a link was shown on the screen that was supposed to precede minting one');
    noJargon(screen, 'the hand-off screen');
  }

  /* ---- 2. NO ADDRESS: no send offered, one sentence and the field to fix it */
  {
    const r = runtime({ rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }], replies: replies(NO_EMAIL) });
    await handOff(r, NO_EMAIL.id);

    const screen = r.dialogHtml();
    ok(!/Email it to them/.test(screen),
      'a send was offered for a surgeon with no address on their card - a button whose only possible outcome is a refusal');
    ok(/No email address is saved for this surgeon, so add one here and the next op note can go straight to them\./.test(screen),
      'nothing told the owner why the send is missing or what to do about it: ' + visible(screen).slice(0, 240));
    ok(/onclick="opSurgeonSaveEmail\(\)"/.test(screen), 'the owner is told to add an address but given nothing to type it into');
    ok(screen.indexOf(LINK_URL) >= 0, 'the copy-only hand-off did not show the link');
    ok(/onclick="opSurgeonCopy\(\)"/.test(screen), 'the copy-only hand-off lost its Copy button');
    eq(r.mints().length, 1, 'the copy-only path minted ' + r.mints().length + ' links, expected exactly 1');
    eq(r.sends().length, 0, 'the copy-only path reached the send route');
    noJargon(screen, 'the no-address screen');
  }

  /* ---- 3. THE SEND WORKED: it says so, to whom, and KEEPS the link --------- */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }],
      replies: replies(WITH_EMAIL, {
        '/api/opnote-clients/oc_hasmail/link/send POST': { status: 200, body: { link: { id: 12, url: MAIL_URL, prefix: 'dddddddd', expiresAt: 3 }, sent: true } }
      })
    });
    await handOff(r, WITH_EMAIL.id);
    await r.ctx.opSurgeonMail();

    /* THE CALL, AT THE WIRE */
    eq(r.sends().length, 1, 'the send was asked for ' + r.sends().length + ' times');
    eq(r.sends()[0].url, 'https://synthetic-backend.invalid/api/opnote-clients/oc_hasmail/link/send', 'the send went to the wrong surgeon');
    eq(r.sends()[0].init.headers.Authorization, 'Bearer SYNTHETIC_CLINICIAN_CREDENTIAL', 'the send did not carry the clinician credential');
    eq(r.sends()[0].init.body, undefined,
      'the send carried a body. It has nothing to say: the surgeon, the note and the address are all already on the server, and ' +
      'anything sent here would be one more copy of them on the wire.');
    eq(r.minted(), 1,
      'the hand-off created ' + r.minted() + ' links. A send that mints on top of an already-minted link leaves a working ' +
      'credential nobody was ever given.');
    eq(r.mints().length, 0, 'the send path minted a plain link as well as sending one');

    const done = r.dialogHtml();
    ok(new RegExp('Sent to ' + TO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(done),
      'a successful send does not say it went, or does not say to whom: ' + visible(done).slice(0, 240));
    ok(done.indexOf(MAIL_URL) >= 0,
      'the send took the link away. Mail goes astray; the owner must still be able to hand it over himself.');
    ok(/onclick="opSurgeonCopy\(\)"/.test(done), 'the send took the Copy button away');
    ok(/Copy this now - it is not shown again\./.test(done), 'the one-time warning is gone from the screen that still shows the link');
    ok(!/Email it to them/.test(done), 'the send button is still offered after it already went, inviting a second mint');
    eq((done.match(new RegExp(MAIL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1, 'the link is not rendered exactly once');
    eq(r.body.children.length, 1, 'more than one dialog is open at a time');
    noJargon(done, 'the sent screen');

    /* it never leaves through a toast, and it is gone when the dialog closes */
    for (const t of r.toasts) ok(String(t.m).indexOf('#k=') === -1 && String(t.m).indexOf('mlsscribe.com/opnotes') === -1, 'a link was put into a toast: ' + t.m);
    r.ctx.opSurgeonClose();
    eq(r.body.children.length, 0, 'the dialog stayed in the document after it was closed');
    ok(r.dialogHtml().indexOf(MAIL_URL) === -1, 'the link is still in the document after the dialog closed');
  }

  /* ---- 4. THE MAIL DID NOT GO: one sentence, and the link is still there --- */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }],
      replies: replies(WITH_EMAIL, {
        '/api/opnote-clients/oc_hasmail/link/send POST': { status: 200, body: { link: { id: 13, url: MAIL_URL, prefix: 'dddddddd', expiresAt: 3 }, sent: false, reason: 'not switched on' } }
      })
    });
    await handOff(r, WITH_EMAIL.id);
    await r.ctx.opSurgeonMail();

    const screen = r.dialogHtml();
    ok(/The email did not go out\. Copy the link below and send it to them yourself\./.test(screen),
      'a refused send did not say what happened in words the owner can act on: ' + visible(screen).slice(0, 240));
    ok(screen.indexOf(MAIL_URL) >= 0, 'a refused send threw away the link it had already made');
    ok(/onclick="opSurgeonCopy\(\)"/.test(screen), 'a refused send left the owner the link but no way to copy it');
    ok(!/Sent to/.test(screen), 'a refused send still claims it was sent');
    ok(screen.indexOf('not switched on') === -1,
      'the server\'s own words were echoed into the dialog. Every sentence on this screen is written here, where it can be held to ' +
      'plain English, not wherever the answer happened to come from.');
    eq(r.minted(), 1, 'the refused hand-off created ' + r.minted() + ' links, expected exactly 1');
    noJargon(screen, 'the refused-send screen');
  }

  /* ---- 5. NOTHING CAME BACK: stay put, say so, keep the other way out ------ */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }],
      replies: replies(WITH_EMAIL, {
        '/api/opnote-clients/oc_hasmail/link/send POST': { status: 500, body: { error: { code: 'OPNOTE_SEND_FAILED', message: 'internal' } } }
      })
    });
    await handOff(r, WITH_EMAIL.id);
    await r.ctx.opSurgeonMail();

    const screen = r.dialogHtml();
    ok(/The email did not go out\. Show the link instead and send it to them yourself\./.test(screen),
      'a send that never answered failed silently: ' + visible(screen).slice(0, 240));
    ok(/Just show me the link/.test(screen), 'a failed send left the owner on a screen with no way forward');
    ok(screen.indexOf('internal') === -1, 'the server\'s own words were echoed into the dialog');
    eq(r.minted(), 0, 'a link was created by a send that the server refused outright');
    noJargon(screen, 'the failed-send screen');

    /* and the way out really works, and still only makes one link */
    await r.ctx.opSurgeonLinkOnly();
    ok(r.dialogHtml().indexOf(LINK_URL) >= 0, 'the fallback did not produce a link');
    eq(r.minted(), 1, 'the fallback after a failed send created ' + r.minted() + ' links, expected exactly 1');
    eq(r.sends().length, 1, 'the fallback went back to the send route instead of just minting');
  }

  /* ---- 6. A SECOND PRESS WHILE IT IS IN FLIGHT DOES NOTHING ---------------- */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }],
      replies: replies(WITH_EMAIL, {
        '/api/opnote-clients/oc_hasmail/link/send POST': { status: 200, body: { link: { id: 14, url: MAIL_URL, prefix: 'dddddddd', expiresAt: 3 }, sent: true } }
      })
    });
    await handOff(r, WITH_EMAIL.id);

    const first = r.ctx.opSurgeonMail();
    const inflight = r.dialogHtml();
    ok(/Sending\.\.\./.test(inflight), 'the button does not show that it is working: ' + visible(inflight).slice(0, 200));
    ok(/<button class="btn-primary" disabled>Sending\.\.\.<\/button>/.test(inflight), 'the working button is still pressable');
    ok(!/onclick="opSurgeonMail\(\)"/.test(inflight), 'the send is still wired up while it is already running');
    const second = r.ctx.opSurgeonMail();
    const third = r.ctx.opSurgeonLinkOnly();
    await first; await second; await third;

    eq(r.sends().length, 1, 'the send ran ' + r.sends().length + ' times. A surgeon must not be mailed twice off one press.');
    eq(r.minted(), 1, 'pressing twice created ' + r.minted() + ' links');
    ok(/Sent to/.test(r.dialogHtml()), 'the screen after a double press does not show the send that actually happened');
  }

  /* ---- 7. ADDING THE ADDRESS: it sticks, and it mints nothing more --------- */
  {
    const r = runtime({
      rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }],
      replies: replies(NO_EMAIL, {
        '/api/opnote-clients/oc_nomail PATCH': { status: 200, body: { client: { id: 'oc_nomail', label: 'Okafor', name: 'Dr Ada Okafor', email: 'added@synthetic.invalid' } } }
      })
    });
    await handOff(r, NO_EMAIL.id);
    r.ctx.document.getElementById('opSurgeonAddEmail').value = 'added@synthetic.invalid';
    await r.ctx.opSurgeonSaveEmail();

    const patches = r.calls.filter((c) => c.init.method === 'PATCH');
    eq(patches.length, 1, 'the address was saved ' + patches.length + ' times');
    assert.deepStrictEqual(JSON.parse(patches[0].init.body), { email: 'added@synthetic.invalid' },
      'saving an address sent something other than the address');
    checks++;

    const screen = r.dialogHtml();
    ok(/Saved\. The next op note for them can be emailed straight from here\./.test(screen),
      'saving an address said nothing about what it changed: ' + visible(screen).slice(0, 240));
    ok(screen.indexOf(LINK_URL) >= 0, 'saving an address threw away the link that was already on the screen');
    ok(/onclick="opSurgeonCopy\(\)"/.test(screen), 'saving an address took the Copy button away');
    ok(!/No email address is saved/.test(screen), 'the screen still says there is no address after one was saved');
    ok(!/Email it to them/.test(screen),
      'a send was offered after the address was saved. This link is already minted; sending now would mint a second one for the ' +
      'same op note, which is the one thing this lane must never do.');
    eq(r.minted(), 1, 'saving an address created ' + r.minted() + ' links in total, expected exactly 1');
    noJargon(screen, 'the address-saved screen');
  }

  /* ---- 8. EVERY SENTENCE ON THE WAY THROUGH, judged on the words ---------- */
  {
    const r = runtime({ rows: [{ note: DRAFT, proc: 'Left shoulder arthroscopy' }], replies: replies(WITH_EMAIL) });
    await r.ctx.opPrepForSurgeon(0);
    noJargon(r.dialogHtml(), 'the pick dialog');
    r.ctx.document.getElementById('opSurgeonPick').value = WITH_EMAIL.id;
    await r.ctx.opSurgeonSend();
    noJargon(r.dialogHtml(), 'the hand-off screen');
    await r.ctx.opSurgeonLinkOnly();
    noJargon(r.dialogHtml(), 'the link screen reached by choosing to copy');
    ok(r.dialogHtml().indexOf(LINK_URL) >= 0, 'choosing to copy did not produce a link');
    eq(r.minted(), 1, 'choosing to copy after being offered a send created ' + r.minted() + ' links, expected exactly 1');
    eq(r.sends().length, 0, 'choosing to copy still asked the send route for something');
  }

  console.log('PASS send the surgeon link: ' + checks + ' checks - one hand-off mints exactly one link on both paths, a send that ' +
    'worked keeps the link and names who got it, a send that failed keeps the link and says so, a second press does nothing, and no ' +
    'screen puts the link in a toast or a word of jargon in front of a surgeon');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
