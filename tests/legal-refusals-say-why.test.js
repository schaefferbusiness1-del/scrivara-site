'use strict';
/* Legal writes the server refuses say why (sweepfix-1.0.0, 2026-09-23).
   The server refuses a secure message over 8,000 characters and an invoice
   over 40,000 with a 413 and a sentence naming the limit. The app showed a
   bare "Could not send." / "Could not save the invoice.", so the doctor kept
   retrying. Runs the real functions from 1pScribeFlow.html in a vm. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const mirror = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
function fnBlock(name) {
  const at = html.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' not found');
  const start = html.lastIndexOf('\n', at) + 1;
  let depth = 0, i = html.indexOf('{', at);
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}

for (const name of ['_legalErrText', 'sendLegalMessageDoctor', 'sendLawMessageLawyer', 'saveLegalInvoice']) {
  const at = mirror.indexOf('function ' + name + '(');
  assert(at >= 0 && mirror.slice(at, at + 1200) === html.slice(html.indexOf('function ' + name + '('), html.indexOf('function ' + name + '(') + 1200), name + ' is the same in 1p/index.html');
}

function harness(reply) {
  const toasts = [];
  const input = { value: 'x'.repeat(9000) };
  const ctx = {
    toasts,
    toast: (m, k) => toasts.push([m, k]),
    legalWorkspaceReleased: () => true,
    legalWorkspaceHeld() {},
    _legalReqId: () => 'req1',
    bkBase: () => 'https://api.example.test',
    bkToken: () => 'tok',
    loadLegalMessages() {}, loadLawMessages() {},
    _lawMsgReqId: 'req1',
    _legalCurrentReq: null,
    legalInvCollect: () => ({ items: [] }),
    document: { getElementById: (id) => (id === 'legalMsgInput' ? input : null) },
    fetch: async () => ({ ok: false, status: reply.status, json: async () => reply.body }),
    _legalFetchRetry: async (u, o) => ({ ok: false, status: reply.status, json: async () => reply.body }),
    Promise, setTimeout
  };
  vm.createContext(ctx);
  vm.runInContext(['_legalErrText', 'sendLegalMessageDoctor', 'sendLawMessageLawyer', 'saveLegalInvoice'].map(fnBlock).join('\n'), ctx);
  return { ctx, toasts, input };
}

(async () => {
  const tooLong = { status: 413, body: { error: 'This message is too long (8,000 characters max). Split it into shorter messages and send again.', code: 'MESSAGE_TOO_LONG' } };
  let h = harness(tooLong);
  await h.ctx.sendLegalMessageDoctor();
  assert.deepStrictEqual(h.toasts, [[tooLong.body.error, 'err']], 'the doctor is told the limit: ' + JSON.stringify(h.toasts));
  assert.strictEqual(h.input.value.length, 9000, 'the refused message stays in the box');
  h = harness(tooLong);
  await h.ctx.sendLawMessageLawyer();
  assert.deepStrictEqual(h.toasts, [[tooLong.body.error, 'err']], 'the attorney is told the limit too');

  const bigInvoice = { status: 413, body: { error: 'This invoice is too large to save (over 40,000 characters). Shorten or remove some line items and save again.', code: 'INVOICE_TOO_LARGE' } };
  h = harness(bigInvoice);
  await h.ctx.saveLegalInvoice();
  assert.deepStrictEqual(h.toasts, [[bigInvoice.body.error, 'err']], 'the invoice refusal says why');

  /* a code or an unreadable body keeps the plain message */
  h = harness({ status: 500, body: { error: 'ERR_INTERNAL' } });
  await h.ctx.sendLegalMessageDoctor();
  assert.deepStrictEqual(h.toasts, [['Could not send.', 'err']]);
  h = harness({ status: 502, body: null });
  await h.ctx.saveLegalInvoice();
  assert.deepStrictEqual(h.toasts, [['Could not save the invoice.', 'err']]);

  assert.match(html, /<textarea id="legalMsgInput" rows="2" maxlength="8000"/, 'the message box stops at the server limit');
  console.log('PASS legal refusals say why: a message over 8,000 characters or an oversized invoice shows the server\'s reason, the text stays, and the message box stops at the limit');
})().catch((e) => { console.error(e); process.exit(1); });
